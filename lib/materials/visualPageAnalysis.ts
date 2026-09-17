import type {
  VisualPageAnalysisResult,
  VisualPageProvider,
  VisualPageProviderRequest,
} from './visualPageAnalysisTypes'
import type { PageContentSignals } from './pageContentSignals'
import { evaluateVisualAnalysisQuality, type VisualQualityPageMetrics } from './visualAnalysisQuality'

export type {
  VisualPageAnalysisResult,
  VisualPageAnalysisStatus,
  VisualPageProvider,
  VisualPageProviderRequest,
} from './visualPageAnalysisTypes'

export const VISUAL_PAGE_ANALYZER_VERSION = '1.2.0'
export const VISUAL_PAGE_PROMPT_VERSION = '1.1.0'
export const VISUAL_PAGE_PROVIDER = 'openrouter'
export const VISUAL_PAGE_MODEL = 'google/gemini-2.5-flash'
export const VISUAL_PAGE_MAX_TEXT_CHARS = 80
export const VISUAL_PAGE_BATCH_SIZE = 2
export const VISUAL_PAGE_MAX_ATTEMPTS = 2
export const VISUAL_PAGE_OUTPUT_BUDGET = {
  simple: 1800,
  medium: 3000,
  dense: 4500,
} as const

export type VisualPageSelectionPolicy = 'legacy' | 'intelligent'

export interface VisualPageSelectionOptions {
  policy?: VisualPageSelectionPolicy
  stripNoise?: (text: string) => string
  signals?: PageContentSignals[] | Map<number, PageContentSignals>
}

export interface VisionGateTelemetry {
  page: number
  chars: number
  signal: 'text_sufficient' | 'visual_heavy' | 'extraction_missing' | 'insufficient_extracted_representation' | 'signal_unavailable'
  formula: boolean
  visualEvidence: boolean
  needsVision: boolean
  reason: string
}

export function buildVisionGateTelemetry(
  selectedPages: number[],
  signals: PageContentSignals[] | Map<number, PageContentSignals>,
): VisionGateTelemetry[] {
  const byPage = signals instanceof Map ? signals : new Map(signals.map(signal => [signal.page, signal]))
  return [...new Set(selectedPages)].sort((a, b) => a - b).map(page => {
    const signal = byPage.get(page)
    if (!signal) return {
      page, chars: 0, signal: 'signal_unavailable', formula: false,
      visualEvidence: false, needsVision: false, reason: 'signal_unavailable',
    }
    const needsVision = signal.mode !== 'text'
    const reason = signal.reasons.includes('extraction_missing')
      ? 'extraction_missing'
      : signal.reasons.includes('insufficient_extracted_representation')
        ? 'insufficient_extracted_representation'
        : needsVision ? 'visual_heavy' : 'text_sufficient'
    return {
      page,
      chars: signal.meaningfulTextChars,
      signal: reason,
      formula: signal.formulaLikeSignal,
      visualEvidence: signal.visualContentPresent,
      needsVision,
      reason,
    }
  })
}

export function logVisionGateTelemetry(context: string, rows: VisionGateTelemetry[]): void {
  for (const row of rows) console.info('[vision-gate]', JSON.stringify({ context, ...row }))
  const reasons = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.reason] = (counts[row.reason] || 0) + 1
    return counts
  }, {})
  const candidates = rows.filter(row => row.needsVision).length
  console.info('[vision-gate-summary]', JSON.stringify({
    context,
    selected: rows.length,
    candidates,
    skipped: rows.length - candidates,
    reasons,
  }))
}

export interface AnalyzePdfPageVisualOptions {
  pdfBuffer: Buffer
  page: number
  materialId?: string
  materialName?: string
  existingText?: string
  apiKey?: string | null
  stripNoise?: (text: string) => string
  provider?: VisualPageProvider
  contentFingerprint?: string
  pageFingerprint?: string
  pageMetrics?: VisualQualityPageMetrics & Partial<PageContentSignals>
}

export function resolveVisualOutputBudget(
  signals?: Partial<PageContentSignals>,
): number {
  if (!signals) return VISUAL_PAGE_OUTPUT_BUDGET.simple
  const dense = (signals.visualRiskScore || 0) >= 0.5
    || (signals.embeddedImageCount || 0) >= 2
    || (signals.vectorPathSegmentCount || 0) >= 24
    || (signals.drawingOperationCount || 0) >= 12
    || (signals.rasterEdgeDensity || 0) >= 0.04
  if (dense) return VISUAL_PAGE_OUTPUT_BUDGET.dense
  const medium = signals.mode === 'text_and_vision'
    || (signals.visualRiskScore || 0) >= 0.3
    || (signals.embeddedImageCount || 0) >= 1
    || (signals.vectorPathSegmentCount || 0) >= 12
    || (signals.rasterInkRatio || 0) >= 0.2
  return medium ? VISUAL_PAGE_OUTPUT_BUDGET.medium : VISUAL_PAGE_OUTPUT_BUDGET.simple
}

export function buildVisualPagePrompt(page: number): string {
  return `Analyze ONLY page ${page}. Return compact academic content directly, in the document's language.
- Preserve all visible text, formulas, values, units, labels and captions.
- State the knowledge conveyed by graphs, tables, diagrams, illustrations and spatial relationships.
- Use concise headings or bullets. Do not add introductions, generic page commentary, repetition or a closing summary.
- Do not infer details that are not visible.`
}

function partialSignalCount(result: VisualPageAnalysisResult): number {
  const signals = result.quality?.academicSignals
  return signals
    ? signals.numericValues + signals.formulaOrSymbols + signals.structuredItems
      + signals.relationships + signals.labelsOrHeadings
    : 0
}

function betterPartial(
  current: VisualPageAnalysisResult | null,
  candidate: VisualPageAnalysisResult,
): VisualPageAnalysisResult {
  if (!current) return candidate
  const scoreDelta = (candidate.quality?.score || 0) - (current.quality?.score || 0)
  if (scoreDelta !== 0) return scoreDelta > 0 ? candidate : current
  const signalDelta = partialSignalCount(candidate) - partialSignalCount(current)
  if (signalDelta !== 0) return signalDelta > 0 ? candidate : current
  return candidate.visualDescription.length > current.visualDescription.length ? candidate : current
}

export const openRouterPdfVisualProvider: VisualPageProvider = async ({
  pdfBuffer,
  page,
  maxTokens,
  apiKey,
}: VisualPageProviderRequest) => {
  const base64 = pdfBuffer.toString('base64')
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://studyal.app',
      'X-Title': 'StudyAL Vision',
    },
    body: JSON.stringify({
      model: VISUAL_PAGE_MODEL,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:application/pdf;base64,${base64}` },
          },
          { type: 'text', text: buildVisualPagePrompt(page) },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`VISION_HTTP_${response.status}:${errorText.slice(0, 100)}`)
  }

  const data = await response.json()
  const choice = data?.choices?.[0]
  return {
    text: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? undefined,
  }
}

function resultBase(options: AnalyzePdfPageVisualOptions) {
  return {
    materialId: options.materialId,
    page: options.page,
    derivation: 'vision' as const,
    provider: VISUAL_PAGE_PROVIDER,
    model: VISUAL_PAGE_MODEL,
    analyzerVersion: VISUAL_PAGE_ANALYZER_VERSION,
    promptVersion: VISUAL_PAGE_PROMPT_VERSION,
    contentFingerprint: options.contentFingerprint,
    pageFingerprint: options.pageFingerprint,
  }
}

export async function analyzePdfPageVisual(
  options: AnalyzePdfPageVisualOptions,
): Promise<VisualPageAnalysisResult> {
  const apiKey = options.apiKey === undefined
    ? process.env.OPENROUTER_API_KEY
    : options.apiKey
  const base = resultBase(options)

  if (!apiKey) {
    console.warn(`  ⚠️ Sin OPENROUTER_API_KEY para visión en página ${options.page}`)
    return {
      ...base,
      status: 'no_api_key',
      text: '',
      visualDescription: '',
      attempts: 0,
    }
  }

  const maxTokens = resolveVisualOutputBudget(options.pageMetrics)
  const provider = options.provider || openRouterPdfVisualProvider
  let lastError: unknown
  let bestPartial: VisualPageAnalysisResult | null = null

  for (let attempt = 1; attempt <= VISUAL_PAGE_MAX_ATTEMPTS; attempt++) {
    try {
      const providerResponse = await provider({
        pdfBuffer: options.pdfBuffer,
        page: options.page,
        maxTokens,
        apiKey,
      })
      const text = typeof providerResponse === 'string' ? providerResponse : providerResponse.text
      const finishReason = typeof providerResponse === 'string' ? undefined : providerResponse.finishReason || undefined
      const quality = evaluateVisualAnalysisQuality({
        description: text,
        pageMetrics: options.pageMetrics,
        finishReason,
      })
      if (quality.accepted && !quality.truncated) {
        console.log(`  🖼️ Página ${options.page} enriquecida con visión: ${text.length} chars${attempt > 1 ? ` (intento ${attempt})` : ''}`)
        return {
          ...base,
          status: 'success',
          text,
          visualDescription: text,
          attempts: attempt,
          finishReason,
          quality,
        }
      }
      if (quality.accepted && quality.truncated) {
        bestPartial = betterPartial(bestPartial, {
          ...base,
          status: 'partial',
          text,
          visualDescription: text,
          attempts: attempt,
          finishReason,
          quality,
          error: 'VISION_RESPONSE_TRUNCATED',
        })
      }
      if (text.trim().length <= 50) {
        return {
          ...base,
          status: 'no_content',
          text: '',
          visualDescription: '',
          attempts: attempt,
          finishReason,
          quality,
        }
      }
      if (attempt < VISUAL_PAGE_MAX_ATTEMPTS) continue
      if (bestPartial) return { ...bestPartial, attempts: attempt }
      const status = 'failed'
      return {
        ...base,
        status,
        text,
        visualDescription: text,
        attempts: attempt,
        finishReason,
        quality,
        error: 'VISION_INSUFFICIENT_CONTENT',
      }
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`  ⚠️ Vision error página ${options.page} (intento ${attempt}/${VISUAL_PAGE_MAX_ATTEMPTS}): ${message}`)
    }
  }

  if (bestPartial) {
    return {
      ...bestPartial,
      attempts: VISUAL_PAGE_MAX_ATTEMPTS,
      error: 'VISION_RESPONSE_TRUNCATED',
    }
  }
  const error = lastError instanceof Error ? lastError.message : String(lastError)
  console.warn(`  ⚠️ Página ${options.page}: visión agotó ${VISUAL_PAGE_MAX_ATTEMPTS} intentos, queda sin enriquecer: ${error}`)
  return {
    ...base,
    status: 'failed',
    text: '',
    visualDescription: '',
    attempts: VISUAL_PAGE_MAX_ATTEMPTS,
    error,
  }
}

export function selectPagesNeedingVisualAnalysis(
  fullPageMap: Map<number, string>,
  allowedPages: number | number[],
  policyOrStripNoise: VisualPageSelectionOptions | ((text: string) => string) = {},
): number[] {
  const options: VisualPageSelectionOptions = typeof policyOrStripNoise === 'function'
    ? { policy: 'legacy', stripNoise: policyOrStripNoise }
    : policyOrStripNoise
  const policy = options.policy || 'legacy'
  const stripNoise = options.stripNoise || ((text: string) => text.trim())
  const pages = Array.isArray(allowedPages)
    ? [...new Set(allowedPages)].sort((a, b) => a - b)
    : Array.from({ length: allowedPages }, (_, index) => index + 1)

  if (policy === 'intelligent') {
    const byPage = options.signals instanceof Map
      ? options.signals
      : new Map((options.signals || []).map(signal => [signal.page, signal]))
    return pages.filter(page => {
      const signal = byPage.get(page)
      return signal?.mode === 'vision' || signal?.mode === 'text_and_vision'
    })
  }

  const selected = pages.filter(page => {
    const rawText = fullPageMap.get(page) || ''
    const cleanLength = stripNoise(rawText).length
    const raw = rawText.trim().toLowerCase()
    const isEmpty = !raw
      || raw === '(página vacía)'
      || raw === '(pagina vacia)'
      || cleanLength === 0
    return isEmpty
      || (cleanLength > 0 && cleanLength <= VISUAL_PAGE_MAX_TEXT_CHARS)
  })

  return selected.sort((a, b) =>
    stripNoise(fullPageMap.get(a) || '').length
      - stripNoise(fullPageMap.get(b) || '').length)
}

export function chunkVisualPagesIntoBatches<T>(
  items: T[],
  batchSize: number,
): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize))
  }
  return batches
}
