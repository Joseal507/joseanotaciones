import assert from 'node:assert/strict'
import {
  evaluateVisualAnalysisQuality,
  type EvaluateVisualAnalysisQualityInput,
} from '../../lib/materials/visualAnalysisQuality'
import {
  analyzePdfPageVisual,
  buildVisualPagePrompt,
  resolveVisualOutputBudget,
  VISUAL_PAGE_ANALYZER_VERSION,
  VISUAL_PAGE_OUTPUT_BUDGET,
} from '../../lib/materials/visualPageAnalysis'
import {
  buildVisualPageCacheIdentity,
  getOrAnalyzeVisualPage,
  InMemoryVisualPageAnalysisStore,
  visualPageCacheKey,
} from '../../lib/materials/visualPageCache'
import { prepareMaterialBrainMultimodalSources } from '../../lib/materialBrain/multimodal'
import type { PageContentSignals } from '../../lib/materials/pageContentSignals'

let providerCalls = 0
const simple = { visualRiskScore: 0.38, embeddedImageCount: 1, rasterEdgeDensity: 0.02 }
const complex = { visualRiskScore: 0.54, embeddedImageCount: 2, rasterEdgeDensity: 0.05 }

// Representative, sanitized excerpts derived from the captured V5 real-gate output.
// The prior wrapper discarded finish_reason, so P1/P4/P6 use the observed truncation
// classification as finishReason='length'; these are not claimed as byte-exact fixtures.
const gateCases: Array<{ page: number; expected: 'GOOD'|'PARTIAL'|'BAD'; input: EvaluateVisualAnalysisQualityInput }> = [
  { page: 1, expected: 'PARTIAL', input: { description: 'Problema 15.5: CH3COO⁻ + HCN ⇌ CH3COOH + CN⁻. Identifique los pares conjugados ácido-base y escriba las fórmulas de HNO2, H2SO4, H2S y HCN. La lista incluye cinco reacciones etiquetadas a), b), c), d) y e).', pageMetrics: simple, finishReason: 'length' } },
  { page: 2, expected: 'BAD', input: { description: 'Page 2 Content Description: This page contains two main sections, each presenting chemistry problems related to acid-base chemistry', pageMetrics: complex, finishReason: 'stop' } },
  { page: 3, expected: 'GOOD', input: { description: 'Problema 15.43: Ka del ácido benzoico = 6.5 × 10⁻⁵; calcule el pH de una disolución 0.10 M. Problema 15.44: 0.0560 g de ácido acético en 50.0 mL, con Ka = 1.8 × 10⁻⁵. La lista relaciona concentración, ionización y pH.', pageMetrics: simple, finishReason: 'stop' } },
  { page: 4, expected: 'PARTIAL', input: { description: 'Tres diagramas a), b) y c) muestran pares de esferas azules y rojas conectadas. Los problemas 15.55–15.58 piden calcular pH de NH3 0.10 M y C5H5N 0.050 M, y relacionan Kb con ionización.', pageMetrics: complex, finishReason: 'length' } },
  { page: 5, expected: 'GOOD', input: { description: 'RESPUESTAS: 15.44 [H⁺] = [CH3COO⁻] = 5.8 × 10⁻⁵ M y [CH3COOH] = 0.0181 M. 15.48: 3.5%, 33% y 79%; el porcentaje de ionización aumenta con la dilución. 15.90: Al(OH)3 + OH⁻ → Al(OH)4⁻.', pageMetrics: simple, finishReason: 'stop' } },
  { page: 6, expected: 'PARTIAL', input: { description: 'Las respuestas indican que H⁺ convierte CN⁻ en HCN gaseoso; el equilibrio se desplaza hacia la derecha. [CN⁻] = 1.8 × 10⁻⁸ M en HF 1.00 M y 2.2 × 10⁻⁵ M en HCN 1.00 M, por lo que HF es el ácido más fuerte.', pageMetrics: simple, finishReason: 'length' } },
]

function classification(input: EvaluateVisualAnalysisQualityInput): 'GOOD'|'PARTIAL'|'BAD' {
  const quality = evaluateVisualAnalysisQuality(input)
  return !quality.accepted ? 'BAD' : quality.truncated ? 'PARTIAL' : 'GOOD'
}

async function main() {
  for (const fixture of gateCases) assert.equal(classification(fixture.input), fixture.expected, `P${fixture.page}`)
  const longGeneric = 'This page contains an image. There is a picture shown on this page. '.repeat(20)
  assert.equal(evaluateVisualAnalysisQuality({ description: longGeneric, pageMetrics: complex }).accepted, false)
  assert.equal(evaluateVisualAnalysisQuality({ description: 'F = ma; force increases when acceleration a increases.', pageMetrics: simple }).accepted, true)
  assert.equal(evaluateVisualAnalysisQuality({ description: 'Mass | 10 kg | 20 kg\nSpeed | 3 m/s | 6 m/s', pageMetrics: simple }).accepted, true)
  assert.equal(evaluateVisualAnalysisQuality({ description: 'There is an image shown on the page.', pageMetrics: complex }).accepted, false)
  const deterministic = evaluateVisualAnalysisQuality(gateCases[2].input)
  assert.deepEqual(evaluateVisualAnalysisQuality(gateCases[2].input), deterministic)

  const pdfBuffer = Buffer.from('quality-contract')
  const partial = await analyzePdfPageVisual({ pdfBuffer, page: 1, apiKey: 'test', pageMetrics: simple, provider: async () => { providerCalls++; return { text: gateCases[0].input.description, finishReason: 'length' } } })
  assert.equal(partial.status, 'partial')
  assert.equal(partial.attempts, 2)
  assert.equal(partial.quality?.truncated, true)
  const bad = await analyzePdfPageVisual({ pdfBuffer, page: 2, apiKey: 'test', pageMetrics: complex, provider: async () => { providerCalls++; return { text: gateCases[1].input.description, finishReason: 'stop' } } })
  assert.equal(bad.status, 'failed')
  assert.equal(bad.attempts, 2)

  const identity = buildVisualPageCacheIdentity({ materialFingerprint: 'm', page: 1, pageFingerprint: 'p' })
  const oldIdentity = buildVisualPageCacheIdentity({ materialFingerprint: 'm', page: 1, pageFingerprint: 'p', analyzerVersion: '1.1.0', promptVersion: '1.0.0' })
  assert.equal(VISUAL_PAGE_ANALYZER_VERSION, '1.2.0')
  assert.notEqual(visualPageCacheKey(identity), visualPageCacheKey(oldIdentity))
  assert.equal(resolveVisualOutputBudget({ visualRiskScore: 0.1, embeddedImageCount: 0 }), VISUAL_PAGE_OUTPUT_BUDGET.simple)
  assert.equal(resolveVisualOutputBudget({ visualRiskScore: 0.38, embeddedImageCount: 1 }), VISUAL_PAGE_OUTPUT_BUDGET.medium)
  assert.equal(resolveVisualOutputBudget({ visualRiskScore: 0.54, embeddedImageCount: 2 }), VISUAL_PAGE_OUTPUT_BUDGET.dense)
  assert.equal(resolveVisualOutputBudget({ visualRiskScore: 0.54, embeddedImageCount: 2 }), resolveVisualOutputBudget({ visualRiskScore: 0.54, embeddedImageCount: 2 }))
  for (const budget of [resolveVisualOutputBudget(), resolveVisualOutputBudget({ visualRiskScore: 1 })]) {
    assert.ok(budget >= VISUAL_PAGE_OUTPUT_BUDGET.simple && budget <= VISUAL_PAGE_OUTPUT_BUDGET.dense)
  }
  const prompt = buildVisualPagePrompt(4)
  assert.ok(prompt.includes('compact academic content directly'))
  assert.ok(!prompt.includes('Return a thorough description'))
  const lowPartialText = 'El gráfico etiqueta 2 variables: x → y; x aumenta cuando y disminuye.'
  const highPartialText = 'La tabla compara 10 kg y 20 kg en dos filas; el diagrama etiqueta fuerza F y aceleración a, muestra F = ma y relaciona mayor fuerza → mayor aceleración.'
  let retryCalls = 0
  const partialThenError = await analyzePdfPageVisual({ pdfBuffer, page: 3, apiKey: 'test', pageMetrics: simple, provider: async request => {
    retryCalls++
    assert.equal(request.maxTokens, VISUAL_PAGE_OUTPUT_BUDGET.medium)
    if (retryCalls === 1) return { text: lowPartialText, finishReason: 'length' }
    throw new Error('transport')
  } })
  assert.equal(partialThenError.status, 'partial')
  assert.equal(partialThenError.text, lowPartialText)
  assert.equal(partialThenError.attempts, 2)
  let improvingCalls = 0
  const improvingPartial = await analyzePdfPageVisual({ pdfBuffer, page: 4, apiKey: 'test', pageMetrics: complex, provider: async request => {
    improvingCalls++
    assert.equal(request.maxTokens, VISUAL_PAGE_OUTPUT_BUDGET.dense)
    return { text: improvingCalls === 1 ? lowPartialText : highPartialText, finishReason: 'length' }
  } })
  assert.equal(improvingPartial.status, 'partial')
  assert.equal(improvingPartial.text, highPartialText)
  let failedThenPartialCalls = 0
  const failedThenPartial = await analyzePdfPageVisual({ pdfBuffer, page: 5, apiKey: 'test', pageMetrics: simple, provider: async () => {
    failedThenPartialCalls++
    return failedThenPartialCalls === 1
      ? { text: 'This page contains an image and appears to show some content without further details.', finishReason: 'stop' }
      : { text: highPartialText, finishReason: 'length' }
  } })
  assert.equal(failedThenPartial.status, 'partial')
  assert.equal(failedThenPartial.text, highPartialText)
  let partialThenSuccessCalls = 0
  const partialThenSuccess = await analyzePdfPageVisual({ pdfBuffer, page: 6, apiKey: 'test', pageMetrics: simple, provider: async () => {
    partialThenSuccessCalls++
    return { text: highPartialText, finishReason: partialThenSuccessCalls === 1 ? 'length' : 'stop' }
  } })
  assert.equal(partialThenSuccess.status, 'success')
  assert.equal(partialThenSuccessCalls, 2)
  let immediateSuccessCalls = 0
  const immediateSuccess = await analyzePdfPageVisual({ pdfBuffer, page: 7, apiKey: 'test', pageMetrics: simple, provider: async () => {
    immediateSuccessCalls++
    return { text: highPartialText, finishReason: 'stop' }
  } })
  assert.equal(immediateSuccess.status, 'success')
  assert.equal(immediateSuccessCalls, 1)
  const store = new InMemoryVisualPageAnalysisStore()
  let saves = 0
  const trackingStore = { get: store.get.bind(store), save: async (...args: Parameters<typeof store.save>) => { saves++; await store.save(...args) } }
  await getOrAnalyzeVisualPage({ identity, store: trackingStore, analyze: async () => partial })
  assert.equal(saves, 0, 'partial must not be cached')
  const success = { ...partial, status: 'success' as const, quality: { ...partial.quality!, truncated: false } }
  await getOrAnalyzeVisualPage({ identity, store: trackingStore, analyze: async () => success })
  assert.equal(saves, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(success.quality)), success.quality)
  const partialSignal: PageContentSignals = {
    page: 1, textChars: 120, meaningfulTextChars: 120, embeddedImageCount: 1,
    vectorObjectCount: 0, vectorPathSegmentCount: 0, drawingOperationCount: 0,
    rasterInkRatio: 0.2, rasterColorRatio: 0, rasterEdgeDensity: 0.02,
    tableLikeSignal: false, formulaLikeSignal: true, captionLikeSignal: false,
    mode: 'text_and_vision', reasons: ['visual_content_present'], visualRiskScore: 0.38,
    visualContentPresent: true, pageFingerprint: 'signal-1', analyzerVersion: '2.0.0',
  }
  const brainPreparation = await prepareMaterialBrainMultimodalSources([{
    materialId: 'quality-material', nombre: 'quality.pdf', kind: 'pdf',
    text: '[Pagina 1]\nTexto académico verificable', knownPages: [1], storageKey: 'quality.pdf',
  }], {
    loadPdf: async () => pdfBuffer,
    analyzeSignals: async () => [partialSignal],
    visualStore: new InMemoryVisualPageAnalysisStore(),
    analyzeVisual: async () => partial,
  })
  assert.equal(brainPreparation.visualChunks.length, 0)
  assert.equal(brainPreparation.visualCoverage.status, 'partial')
  assert.deepEqual(brainPreparation.visualCoverage.failed, [{ materialId: 'quality-material', page: 1 }])
  console.log(JSON.stringify({ status: 'PASS', gate: gateCases.map(item => ({ page: item.page, classification: classification(item.input) })), analyzerVersion: VISUAL_PAGE_ANALYZER_VERSION, providerCallsReal: 0, mockProviderCalls: providerCalls }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
