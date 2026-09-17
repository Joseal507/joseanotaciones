import { downloadFromR2 } from '../materials/storage'
import {
  analyzePdfPagesContentSignals,
  computeMaterialContentFingerprint,
  computePdfPageFingerprint,
  type PageContentSignals,
} from '../materials/pageContentSignals'
import { visualAnalysisResultToEvidence } from '../materials/sourceEvidence'
import {
  analyzePdfPageVisual,
  buildVisionGateTelemetry,
  logVisionGateTelemetry,
  selectPagesNeedingVisualAnalysis,
  type AnalyzePdfPageVisualOptions,
  type VisualPageAnalysisResult,
} from '../materials/visualPageAnalysis'
import {
  buildVisualPageCacheIdentity,
  getOrAnalyzeVisualPage,
  WorkerVisualPageAnalysisStore,
  type VisualPageAnalysisStore,
} from '../materials/visualPageCache'
import { splitIntoPages } from './chunking'
import type {
  PageChunk,
  ResolvedSourceMaterial,
  SourceRef,
  VisualCoverage,
  VisualPreparationError,
} from './types'

export interface MultimodalPreparationOptions {
  loadPdf?: (material: ResolvedSourceMaterial) => Promise<Buffer>
  analyzeSignals?: typeof analyzePdfPagesContentSignals
  visualStore?: VisualPageAnalysisStore
  analyzeVisual?: (options: AnalyzePdfPageVisualOptions) => Promise<VisualPageAnalysisResult>
  /**
   * Two-level readiness — FAST path (P0 fast-entry architecture, MB-FAST-RUNTIME).
   * Page content signals are still computed (cheap, deterministic PDF
   * structural analysis, not a provider call) so `requested`/status stay
   * accurate, but the actual vision provider call (`analyzeVisual`) is
   * never invoked and no visualChunk is produced — matches the
   * "ZERO provider calls" contract for the fast base. Deferred pages are
   * picked up by a later enrichment pass.
   */
  skipVisualAnalysis?: boolean
}

export interface MultimodalPreparationResult {
  visualChunks: PageChunk[]
  visualCoverage: VisualCoverage
  signalsByMaterial: Record<string, PageContentSignals[]>
}

const productionVisualStore = new WorkerVisualPageAnalysisStore()

function sourceRef(materialId: string, page: number): SourceRef {
  return { materialId, page }
}

function selectedPagesFor(material: ResolvedSourceMaterial): number[] {
  if (material.knownPages?.length) return [...new Set(material.knownPages)].sort((a, b) => a - b)
  return [...new Set(splitIntoPages(material.text).map(segment => segment.page))].sort((a, b) => a - b)
}

function extractedTextByPage(material: ResolvedSourceMaterial): Map<number, string> {
  return new Map(splitIntoPages(material.text).map(segment => [segment.page, segment.text]))
}

function sanitizePreparationError(
  materialId: string,
  stage: VisualPreparationError['stage'],
  error: unknown,
): VisualPreparationError {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown visual preparation error')
  const message = raw
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/((?:api[_-]?key|token|secret|authorization))\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 500)
  const rawCode = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : error instanceof Error ? error.name : ''
  const code = rawCode.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80)
  return { materialId, stage, ...(code ? { code } : {}), message }
}

export async function prepareMaterialBrainMultimodalSources(
  materials: ResolvedSourceMaterial[],
  options: MultimodalPreparationOptions = {},
): Promise<MultimodalPreparationResult> {
  const loadPdf = options.loadPdf || (async material => {
    if (!material.storageKey) throw new Error('VISUAL_SOURCE_STORAGE_KEY_UNAVAILABLE')
    return downloadFromR2(material.storageKey)
  })
  const analyzeSignals = options.analyzeSignals || analyzePdfPagesContentSignals
  const visualStore = options.visualStore || productionVisualStore
  const analyzeVisual = options.analyzeVisual || analyzePdfPageVisual
  const requested: SourceRef[] = []
  const analyzed: SourceRef[] = []
  const failed: SourceRef[] = []
  const noContent: SourceRef[] = []
  const deferred: SourceRef[] = []
  const preparationErrors: VisualPreparationError[] = []
  const visualChunks: PageChunk[] = []
  const signalsByMaterial: Record<string, PageContentSignals[]> = {}

  for (const material of materials) {
    if (material.kind !== 'pdf' || !material.storageKey) continue
    const selectedPages = selectedPagesFor(material)
    if (!selectedPages.length) continue

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await loadPdf(material)
    } catch (error) {
      preparationErrors.push(sanitizePreparationError(
        material.materialId,
        options.loadPdf ? 'load_pdf' : 'download_pdf',
        error,
      ))
      continue
    }

    let pageSignals: PageContentSignals[]
    try {
      pageSignals = await analyzeSignals({
        pdfBuffer,
        selectedPages,
        extractedTextByPage: extractedTextByPage(material),
      })
      signalsByMaterial[material.materialId] = pageSignals
    } catch (error) {
      preparationErrors.push(sanitizePreparationError(material.materialId, 'page_intelligence', error))
      continue
    }

    const materialFingerprint = computeMaterialContentFingerprint(pdfBuffer)
    logVisionGateTelemetry(
      `material_brain:${material.materialId}`,
      buildVisionGateTelemetry(selectedPages, pageSignals),
    )
    const pagesNeedingVision = new Set(selectPagesNeedingVisualAnalysis(
      extractedTextByPage(material), selectedPages, { policy: 'intelligent', signals: pageSignals },
    ))
    for (const signal of pageSignals) {
      if (!pagesNeedingVision.has(signal.page)) continue
      const ref = sourceRef(material.materialId, signal.page)
      requested.push(ref)
      if (options.skipVisualAnalysis) { deferred.push(ref); continue }
      const pageFingerprint = computePdfPageFingerprint(materialFingerprint, signal.page)
      const identity = buildVisualPageCacheIdentity({
        materialFingerprint,
        page: signal.page,
        pageFingerprint,
      })
      let outcome
      try {
        outcome = await getOrAnalyzeVisualPage({
          identity,
          store: visualStore,
          analyze: () => analyzeVisual({
            pdfBuffer,
            page: signal.page,
            materialId: material.materialId,
            materialName: material.nombre,
            existingText: extractedTextByPage(material).get(signal.page) || '',
            contentFingerprint: materialFingerprint,
            pageFingerprint,
            pageMetrics: signal,
          }),
        })
      } catch {
        failed.push(ref)
        continue
      }

      if (outcome.status === 'success') {
        const evidence = visualAnalysisResultToEvidence(outcome, { materialId: material.materialId })
        if (!evidence) {
          failed.push(ref)
          continue
        }
        analyzed.push(ref)
        visualChunks.push({
          id: `${material.materialId}_v${signal.page}`,
          materialId: material.materialId,
          pages: [signal.page],
          order: 0,
          text: outcome.visualDescription,
          sourceKind: 'vision',
          evidence: [evidence],
        })
      } else if (outcome.status === 'no_content') {
        noContent.push(ref)
      } else {
        failed.push(ref)
      }
    }
  }

  visualChunks.sort((left, right) =>
    left.materialId.localeCompare(right.materialId) || left.pages[0] - right.pages[0])
  visualChunks.forEach((chunk, index) => { chunk.order = index })

  return {
    visualChunks,
    visualCoverage: {
      requested,
      analyzed,
      failed,
      noContent,
      status: preparationErrors.length > 0
        ? 'unavailable'
        : failed.length > 0 || deferred.length > 0
          ? 'partial'
          : requested.length > 0 ? 'complete' : 'not_required',
      ...(preparationErrors.length > 0 ? { preparationErrors } : {}),
    },
    signalsByMaterial,
  }
}
