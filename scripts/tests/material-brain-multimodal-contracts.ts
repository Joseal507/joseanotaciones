import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { extractPdf } from '../../lib/materials/extractors'
import {
  analyzePdfPagesContentSignals,
  computeMaterialContentFingerprint,
  computePdfPageFingerprint,
  decidePageAnalysisMode,
  type PageContentSignals,
} from '../../lib/materials/pageContentSignals'
import {
  analyzePdfPageVisual,
  VISUAL_PAGE_ANALYZER_VERSION,
  VISUAL_PAGE_MODEL,
  VISUAL_PAGE_PROMPT_VERSION,
  VISUAL_PAGE_PROVIDER,
  type VisualPageAnalysisResult,
} from '../../lib/materials/visualPageAnalysis'
import {
  buildVisualPageCacheIdentity,
  InMemoryVisualPageAnalysisStore,
  type VisualPageAnalysisStore,
} from '../../lib/materials/visualPageCache'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildMaterialBrain, MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import { extractChunkWithMockProvider, type ChunkExtractionResult } from '../../lib/materialBrain/extraction'
import { InMemoryMaterialBrainStore, lookupMaterialBrain } from '../../lib/materialBrain/cache'
import { resolveSourceMaterialsForBrain } from '../../lib/materialBrain/resolve'
import type { PageChunk, ResolvedSourceMaterial } from '../../lib/materialBrain/types'
import type { Material } from '../../lib/materials/types'

let providerCalls = 0

function signal(page: number, mode: PageContentSignals['mode'], chars = 0): PageContentSignals {
  return {
    page,
    textChars: chars,
    meaningfulTextChars: chars,
    embeddedImageCount: mode === 'text' ? 0 : 1,
    vectorObjectCount: 0,
    vectorPathSegmentCount: 0,
    drawingOperationCount: 0,
    rasterInkRatio: mode === 'text' ? 0 : 0.2,
    rasterColorRatio: 0,
    rasterEdgeDensity: 0.02,
    tableLikeSignal: false,
    formulaLikeSignal: false,
    captionLikeSignal: false,
    visualRiskScore: mode === 'text' ? 0 : 0.38,
    visualContentPresent: mode !== 'text',
    mode,
    reasons: mode === 'text' ? ['low_visual_risk'] : ['visual_content_present'],
    pageFingerprint: `signal-${page}`,
    analyzerVersion: '2.0.0',
  }
}

function extraction(units: ChunkExtractionResult['units'], relations: ChunkExtractionResult['relations'] = []): ChunkExtractionResult {
  return { units, relations, warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0 }
}

function unitFor(chunk: PageChunk, subject?: string) {
  const page = chunk.pages[0]
  const canonicalSubject = subject || (chunk.sourceKind === 'vision' ? `Visual page ${page}` : `Text page ${page}`)
  return {
    kind: 'fact' as const,
    canonicalSubject,
    qualifiers: [],
    label: canonicalSubject,
    statement: `${canonicalSubject} contains academic knowledge.`,
    ...(chunk.sourceKind === 'vision' ? {} : { quote: 'Texto académico verificable' }),
    page,
    domainTags: ['test'],
    modelSuggestedTier: 'supporting' as const,
  }
}

function visualResult(options: Parameters<typeof analyzePdfPageVisual>[0], status: VisualPageAnalysisResult['status'] = 'success'): VisualPageAnalysisResult {
  const description = status === 'success'
    ? `Controlled visual description for page ${options.page}, including a diagram and labeled relation.`
    : ''
  return {
    materialId: options.materialId,
    page: options.page,
    status,
    text: description,
    visualDescription: description,
    derivation: 'vision',
    provider: VISUAL_PAGE_PROVIDER,
    model: VISUAL_PAGE_MODEL,
    attempts: status === 'no_api_key' ? 0 : 1,
    analyzerVersion: VISUAL_PAGE_ANALYZER_VERSION,
    promptVersion: VISUAL_PAGE_PROMPT_VERSION,
    contentFingerprint: options.contentFingerprint,
    pageFingerprint: options.pageFingerprint,
  }
}

function material(id: string, pages: number[], text: string, storage = true): ResolvedSourceMaterial {
  return { materialId: id, nombre: `${id}.pdf`, kind: 'pdf', knownPages: pages, text, ...(storage ? { storageKey: `${id}.pdf` } : {}) }
}

function scopeFor(source: ResolvedSourceMaterial) {
  return buildSourceSelectionSnapshot([source.materialId], { [source.materialId]: source.knownPages || [] })
}

async function buildWithSignals(
  source: ResolvedSourceMaterial,
  signals: PageContentSignals[],
  options: {
    store?: VisualPageAnalysisStore
    analyzeVisual?: (input: Parameters<typeof analyzePdfPageVisual>[0]) => Promise<VisualPageAnalysisResult>
    extractFn?: (chunk: PageChunk, label: string) => Promise<{ extraction: ChunkExtractionResult }>
    pdf?: Buffer
  } = {},
) {
  return buildMaterialBrain(scopeFor(source), [source], {
    visualStore: options.store || new InMemoryVisualPageAnalysisStore(),
    loadPdf: async () => options.pdf || Buffer.from(`pdf-${source.materialId}`),
    analyzeSignals: async input => {
      assert.deepEqual(input.selectedPages, source.knownPages, 'selectedPages leakage')
      return signals
    },
    analyzeVisual: options.analyzeVisual || (async input => visualResult(input)),
    extractFn: options.extractFn || (async chunk => ({ extraction: extraction([unitFor(chunk)]) })),
    maxDirectedRetries: 0,
  })
}

async function testTextOnlyLegacy() {
  const source = material('text-only', [1], '[Pagina 1]\nTexto académico verificable con contenido suficiente.', false)
  let visualCalls = 0
  const brain = await buildWithSignals(source, [], { analyzeVisual: async input => { visualCalls++; return visualResult(input) } })
  assert.equal(visualCalls, 0)
  assert.equal(brain.meta.status, 'ready')
  assert.equal(brain.units.length, 1)
  assert.equal(brain.units[0].provenance[0].quote, 'Texto académico verificable')
  assert.equal(brain.units[0].evidence, undefined)
}

async function testVisualOnlyResolution() {
  const resolved = await resolveSourceMaterialsForBrain('user-1', ['visual-resolve'], { 'visual-resolve': [2] }, {
    getMaterial: async () => ({
      id: 'visual-resolve', nombre: 'visual.pdf', kind: 'pdf', storage_key: 'visual/source.pdf', text_status: 'ready',
    } as Material),
    getMaterialText: async () => null,
    resolveStudyKind: () => 'pdf',
  })
  assert.equal(resolved.materials[0].text, '')
  assert.equal(resolved.materials[0].storageKey, 'visual/source.pdf')
  assert.deepEqual(resolved.materials[0].knownPages, [2])
}

async function testVisualExtractionWithoutQuote() {
  const chunk: PageChunk = {
    id: 'visual_2', materialId: 'visual-only', pages: [2], order: 0,
    text: 'A diagram shows structure A connected to structure B.', sourceKind: 'vision', evidence: [],
  }
  const raw = JSON.stringify({ units: [{ kind: 'concept', canonicalSubject: 'Structure A', qualifiers: [], label: 'Structure A', statement: 'Structure A connects to B.', page: 2, domainTags: [], modelSuggestedTier: 'supporting' }], relations: [] })
  const result = await extractChunkWithMockProvider(chunk, raw)
  assert.equal(result.extraction.units.length, 1)
  assert.equal(result.extraction.units[0].quote, undefined)
}

async function testTextVisionMergeAndRelation() {
  const source = material('mixed', [1], '[Pagina 1]\nTexto académico verificable sobre mitocondria y ATP.')
  const extractFn = async (chunk: PageChunk) => {
    const units = [unitFor(chunk, 'Mitocondria'), {
      ...unitFor(chunk, 'ATP'), statement: 'ATP is produced by the mitochondrion.',
    }]
    const relations = chunk.sourceKind === 'vision' ? [{
      type: 'part_of' as const, fromSubject: 'ATP', toSubject: 'Mitocondria',
      statement: 'The diagram links ATP production to the mitochondrion.', page: 1,
    }] : []
    return { extraction: extraction(units, relations) }
  }
  const brain = await buildWithSignals(source, [signal(1, 'text_and_vision', 700)], { extractFn })
  const mitochondria = brain.units.find(unit => unit.label === 'Mitocondria')!
  assert.equal(brain.units.filter(unit => unit.label === 'Mitocondria').length, 1)
  assert.equal(mitochondria.provenance.length, 1)
  assert.equal(mitochondria.evidence?.length, 1)
  assert.equal(mitochondria.evidence?.[0].derivation, 'vision')
  assert.equal(brain.relations.length, 1)
  assert.equal(brain.relations[0].provenance.length, 0)
  assert.equal(brain.relations[0].evidence?.[0].derivation, 'vision')
}

async function testCacheMissThenHit() {
  const source = material('cache', [2], '')
  const store = new InMemoryVisualPageAnalysisStore()
  let analyzeCalls = 0
  const analyzeVisual = async (input: Parameters<typeof analyzePdfPageVisual>[0]) => {
    analyzeCalls += 1
    return visualResult(input)
  }
  await buildWithSignals(source, [signal(2, 'vision')], { store, analyzeVisual })
  assert.equal(analyzeCalls, 1)
  await buildWithSignals(source, [signal(2, 'vision')], { store, analyzeVisual })
  assert.equal(analyzeCalls, 1, 'cache HIT debe evitar analyze')
  const pdf = Buffer.from(`pdf-${source.materialId}`)
  const materialFingerprint = computeMaterialContentFingerprint(pdf)
  const identity = buildVisualPageCacheIdentity({ materialFingerprint, page: 2, pageFingerprint: computePdfPageFingerprint(materialFingerprint, 2) })
  assert.ok(await store.get(identity), 'MISS debe persistir resultado')
}

async function testFailureSemantics() {
  for (const status of ['failed', 'no_api_key', 'no_content'] as const) {
    const source = material(`failure-${status}`, [1], '[Pagina 1]\nTexto académico verificable que debe sobrevivir.')
    const brain = await buildWithSignals(source, [signal(1, 'text_and_vision', 600)], {
      analyzeVisual: async input => visualResult(input, status),
    })
    assert.equal(brain.meta.status, 'ready', 'optional vision outcome must not block complete native text')
    assert.equal(brain.units.length, 1)
    if (status === 'no_content') {
      assert.equal(brain.visualCoverage?.failed.length, 0)
      assert.equal(brain.visualCoverage?.noContent.length, 1)
      assert.equal(brain.visualCoverage?.status, 'complete')
    } else {
      assert.equal(brain.visualCoverage?.failed.length, 1)
      assert.equal(brain.meta.optionalGaps?.visual, true)
    }
  }
  const blank = material('blank', [1], '')
  let calls = 0
  const blankBrain = await buildWithSignals(blank, [signal(1, 'text')], {
    analyzeVisual: async input => { calls++; return visualResult(input) },
  })
  assert.equal(calls, 0)
  assert.equal(blankBrain.visualCoverage?.requested.length, 0)
  assert.equal(blankBrain.visualCoverage?.status, 'not_required')
}

async function testVisualPreparationCoverageSemantics() {
  const selectedPages = Array.from({ length: 10 }, (_, index) => index + 1)
  const source = material(
    'coverage-selection',
    selectedPages,
    selectedPages.map(page => `[Pagina ${page}]\nTexto académico verificable página ${page}.`).join('\n'),
  )
  const signals = selectedPages.map(page => signal(page, [2, 5, 9].includes(page) ? 'text_and_vision' : 'text', 600))
  const brain = await buildWithSignals(source, signals, {
    analyzeVisual: async input => visualResult(input, input.page === 5 ? 'failed' : 'success'),
  })
  assert.deepEqual(brain.visualCoverage?.requested.map(ref => ref.page), [2, 5, 9])
  assert.deepEqual(brain.visualCoverage?.analyzed.map(ref => ref.page), [2, 9])
  assert.deepEqual(brain.visualCoverage?.failed.map(ref => ref.page), [5])
  assert.equal(brain.visualCoverage?.status, 'partial')
  assert.equal(brain.sourceCoverage.status, 'complete')

  const unavailableSource = material(
    'preparation-unavailable',
    [1, 2, 3],
    '[Pagina 1]\nTexto académico verificable.\n[Pagina 2]\nMás texto autorizado.\n[Pagina 3]\nContenido final.',
  )
  const unavailable = await buildMaterialBrain(scopeFor(unavailableSource), [unavailableSource], {
    loadPdf: async () => Buffer.from('controlled-pdf'),
    analyzeSignals: async () => {
      const error = Object.assign(
        new Error('PDF render failed at https://signed.example/file?token=secret api_key=super-secret'),
        { code: 'PDF_RENDER_FAILED' },
      )
      throw error
    },
    analyzeVisual: async input => { providerCalls++; return visualResult(input) },
    extractFn: async chunk => ({ extraction: extraction([unitFor(chunk)]) }),
    maxDirectedRetries: 0,
  })
  assert.equal(unavailable.meta.status, 'ready')
  assert.equal(unavailable.meta.optionalGaps?.visual, true)
  assert.equal(unavailable.sourceCoverage.status, 'complete')
  assert.ok(unavailable.units.length > 0, 'text units must survive visual preparation failure')
  assert.equal(unavailable.knowledgeExtraction.chunksFailed, 0)
  assert.deepEqual(unavailable.visualCoverage?.requested, [])
  assert.deepEqual(unavailable.visualCoverage?.failed, [])
  assert.equal(unavailable.visualCoverage?.status, 'unavailable')
  assert.equal(unavailable.visualCoverage?.preparationErrors?.[0].stage, 'page_intelligence')
  assert.equal(unavailable.visualCoverage?.preparationErrors?.[0].code, 'PDF_RENDER_FAILED')
  const serializedError = JSON.stringify(unavailable.visualCoverage?.preparationErrors)
  assert.ok(!serializedError.includes('signed.example'))
  assert.ok(!serializedError.includes('super-secret'))
  assert.ok(unavailable.knowledgeExtraction.warnings.includes(
    'visual_preparation_failed:preparation-unavailable:page_intelligence:PDF_RENDER_FAILED',
  ))

  const loadFailure = await buildMaterialBrain(scopeFor(unavailableSource), [unavailableSource], {
    loadPdf: async () => { throw Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }) },
    analyzeSignals: async () => { throw new Error('must not run') },
    analyzeVisual: async input => { providerCalls++; return visualResult(input) },
    extractFn: async chunk => ({ extraction: extraction([unitFor(chunk)]) }),
    maxDirectedRetries: 0,
  })
  assert.equal(loadFailure.visualCoverage?.status, 'unavailable')
  assert.equal(loadFailure.visualCoverage?.preparationErrors?.[0].stage, 'load_pdf')
  assert.equal(loadFailure.visualCoverage?.preparationErrors?.[0].code, 'ETIMEDOUT')
  assert.deepEqual(loadFailure.visualCoverage?.requested, [])
  assert.deepEqual(loadFailure.visualCoverage?.failed, [])
}

async function testIntelligentDecisionAndVersion() {
  const decision = decidePageAnalysisMode({
    page: 1, textChars: 700, meaningfulTextChars: 700, embeddedImageCount: 1,
    vectorObjectCount: 0, vectorPathSegmentCount: 0, drawingOperationCount: 0,
    rasterInkRatio: 0.2, rasterColorRatio: 0, rasterEdgeDensity: 0.02,
    tableLikeSignal: false, formulaLikeSignal: false, captionLikeSignal: false,
  })
  assert.equal(decision.mode, 'text', 'VISION-1 embedded image alone does not override sufficient native text')
  assert.equal(MATERIAL_BRAIN_BUILDER_VERSION, '2.3.0')

  const source = material('version', [1], '[Pagina 1]\nTexto académico verificable.', false)
  const brain = await buildWithSignals(source, [])
  const cache = new InMemoryMaterialBrainStore()
  await cache.set(brain.scope.fingerprint, { ...brain, meta: { ...brain.meta, builderVersion: '1.1.0' } })
  assert.equal((await lookupMaterialBrain(cache, brain.scope.fingerprint)).status, 'missing')
}

function splitPages(text: string): Map<number, string> {
  const pages = new Map<number, string>()
  for (const chunk of text.split(/(?=\[Pagina \d+\])/)) {
    const match = chunk.match(/^\[Pagina (\d+)\]\n?([\s\S]*)$/)
    if (match) pages.set(Number(match[1]), match[2].replace(/\f/g, '').trim())
  }
  return pages
}

async function testChemistryFixture() {
  const pdf = readFileSync('tests/fixtures/real-materials/TAREA QUIMICA CLUTCH.pdf')
  const extracted = await extractPdf(pdf, { localOnly: true })
  const pages = splitPages(extracted.text)
  const signals = await analyzePdfPagesContentSignals({ pdfBuffer: pdf, selectedPages: [1, 2, 3, 4, 5, 6], extractedTextByPage: pages })
  assert.equal(signals.find(item => item.page === 1)?.mode, 'text')
  assert.ok(signals.filter(item => item.mode === 'vision').length >= 5)
  const source = material('chemistry-fixture', [1, 2, 3, 4, 5, 6], extracted.text)
  const brain = await buildWithSignals(source, signals, { pdf })
  for (const page of [2, 3, 4, 5, 6]) {
    assert.ok(brain.units.some(unit => unit.evidence?.some(evidence => evidence.page === page)), `missing visual knowledge page ${page}`)
  }
  assert.equal(brain.visualCoverage?.status, 'complete')
  assert.deepEqual(brain.visualCoverage?.requested.map(ref => ref.page), [2, 3, 4, 5, 6])
  assert.deepEqual(JSON.parse(JSON.stringify(brain.units.flatMap(unit => unit.evidence || []))), brain.units.flatMap(unit => unit.evidence || []))
  console.log(JSON.stringify({ fixture: 'TAREA QUIMICA CLUTCH.pdf', text: signals.filter(item => item.mode === 'text').length, vision: signals.filter(item => item.mode === 'vision').length, textAndVision: signals.filter(item => item.mode === 'text_and_vision').length, hypotheticalCacheHits: 0, hypotheticalCacheMisses: signals.filter(item => item.mode !== 'text').length }))
}

async function run() {
  await testTextOnlyLegacy()
  await testVisualOnlyResolution()
  await testVisualExtractionWithoutQuote()
  await testTextVisionMergeAndRelation()
  await testCacheMissThenHit()
  await testFailureSemantics()
  await testVisualPreparationCoverageSemantics()
  await testIntelligentDecisionAndVersion()
  await testChemistryFixture()
  assert.equal(providerCalls, 0)
  console.log('material-brain-multimodal-contracts: PASS (providerCalls=0, leakage=0)')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
