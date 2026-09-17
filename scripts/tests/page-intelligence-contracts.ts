import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { extractPdf } from '../../lib/materials/extractors'
import {
  analyzePdfPageContentSignals,
  analyzePdfPagesContentSignals,
  decidePageAnalysisMode,
  type PageContentSignalMetrics,
} from '../../lib/materials/pageContentSignals'
import { selectPagesNeedingVisualAnalysis } from '../../lib/materials/visualPageAnalysis'

function metrics(overrides: Partial<PageContentSignalMetrics>): PageContentSignalMetrics {
  return {
    page: 1,
    textChars: 0,
    meaningfulTextChars: 0,
    embeddedImageCount: 0,
    vectorObjectCount: 0,
    vectorPathSegmentCount: 0,
    drawingOperationCount: 0,
    rasterInkRatio: 0,
    rasterColorRatio: 0,
    rasterEdgeDensity: 0,
    tableLikeSignal: false,
    formulaLikeSignal: false,
    captionLikeSignal: false,
    ...overrides,
  }
}

function testPureDecisionPolicy() {
  assert.equal(decidePageAnalysisMode(metrics({ meaningfulTextChars: 1200, textChars: 1200 })).mode, 'text')
  assert.equal(decidePageAnalysisMode(metrics({ meaningfulTextChars: 20, textChars: 20, embeddedImageCount: 1, rasterInkRatio: 0.2 })).mode, 'vision')
  assert.equal(decidePageAnalysisMode(metrics({ meaningfulTextChars: 700, textChars: 700, vectorObjectCount: 10, vectorPathSegmentCount: 50, drawingOperationCount: 12, rasterInkRatio: 0.1, captionLikeSignal: true })).mode, 'text_and_vision')
  assert.equal(decidePageAnalysisMode(metrics({ meaningfulTextChars: 900, textChars: 900, embeddedImageCount: 1, rasterInkRatio: 0.2 })).mode, 'text', 'VISION-1 decorative/background image does not override sufficient text')
  assert.equal(decidePageAnalysisMode(metrics({ meaningfulTextChars: 900, textChars: 900, embeddedImageCount: 1, rasterInkRatio: 0.2, tableLikeSignal: true })).mode, 'text_and_vision', 'VISION-3 structured table still needs vision')
  const blank = decidePageAnalysisMode(metrics({}))
  assert.equal(blank.mode, 'text')
  assert.deepEqual(blank.reasons, ['blank_no_visual_content', 'low_visual_risk'])
  assert.equal(decidePageAnalysisMode(metrics({ embeddedImageCount: 1, rasterInkRatio: 0.2 })).mode, 'vision')
  assert.equal(decidePageAnalysisMode(metrics({
    meaningfulTextChars: 68, textChars: 68, academicWordCount: 10,
    embeddedImageCount: 1, rasterInkRatio: 0.2,
  })).mode, 'text', 'meaningful compact prose is not a vision candidate solely due to char count')
  assert.equal(decidePageAnalysisMode(metrics({
    meaningfulTextChars: 24, textChars: 24, academicWordCount: 3, formulaLikeSignal: true,
    embeddedImageCount: 1, rasterInkRatio: 0.2,
  })).mode, 'text', 'formula plus short extracted representation is not automatically sent to vision')
  assert.equal(decidePageAnalysisMode(metrics({
    meaningfulTextChars: 18, textChars: 18, academicWordCount: 3,
    embeddedImageCount: 1, rasterInkRatio: 0.2,
  })).mode, 'vision', 'title-only visual divider may qualify')
  assert.equal(decidePageAnalysisMode(metrics({
    embeddedImageCount: 1, rasterInkRatio: 0.2,
  })).mode, 'vision', 'visual-heavy page with missing extraction qualifies')
}

function testAcademicDeckDocumentSafety() {
  const selectedPages = Array.from({ length: 43 }, (_, index) => index + 1)
  const pageMap = new Map(selectedPages.map(page => [page, `Academic explanation for concept ${page} with cause effect and evidence.`]))
  const signals = selectedPages.map(page => {
    const pageMetrics = metrics({
      page, textChars: 67, meaningfulTextChars: 67, academicWordCount: 10,
      embeddedImageCount: 1, rasterInkRatio: 0.18,
    })
    return { ...pageMetrics, ...decidePageAnalysisMode(pageMetrics), pageFingerprint: `deck-${page}`, analyzerVersion: 'test' }
  })
  assert.equal(
    selectPagesNeedingVisualAnalysis(pageMap, selectedPages, { policy: 'intelligent', signals }).length,
    0,
    '40+ page academic deck cannot become 40+/40+ candidates without explicit visual insufficiency evidence',
  )
}

function testLegacyAndIntelligentSelection() {
  const pageMap = new Map([[1, 'x'.repeat(1200)], [2, ''], [3, 'x'.repeat(700)], [4, ''], [5, 'x'.repeat(700)]])
  assert.deepEqual(selectPagesNeedingVisualAnalysis(pageMap, [1, 2, 3, 4], { policy: 'legacy' }), [2, 4])
  const signals = [
    { ...metrics({ page: 1, meaningfulTextChars: 1200 }), ...decidePageAnalysisMode(metrics({ page: 1, meaningfulTextChars: 1200 })) },
    { ...metrics({ page: 2 }), ...decidePageAnalysisMode(metrics({ page: 2 })) },
    { ...metrics({ page: 3, meaningfulTextChars: 700, embeddedImageCount: 1, rasterInkRatio: 0.2 }), ...decidePageAnalysisMode(metrics({ page: 3, meaningfulTextChars: 700, embeddedImageCount: 1, rasterInkRatio: 0.2 })) },
    { ...metrics({ page: 4, embeddedImageCount: 1, rasterInkRatio: 0.2 }), ...decidePageAnalysisMode(metrics({ page: 4, embeddedImageCount: 1, rasterInkRatio: 0.2 })) },
    { ...metrics({ page: 5, meaningfulTextChars: 700, embeddedImageCount: 1, rasterInkRatio: 0.2, captionLikeSignal: true }), ...decidePageAnalysisMode(metrics({ page: 5, meaningfulTextChars: 700, embeddedImageCount: 1, rasterInkRatio: 0.2, captionLikeSignal: true })) },
  ].map(signal => ({ ...signal, pageFingerprint: `page-${signal.page}`, analyzerVersion: 'test' }))
  assert.deepEqual(selectPagesNeedingVisualAnalysis(pageMap, [1, 2, 3, 4, 5], { policy: 'intelligent', signals }), [4, 5], 'VISION-5 only eligible mixed pages')
  assert.deepEqual(selectPagesNeedingVisualAnalysis(pageMap, [1, 2], { policy: 'intelligent', signals }), [])

  const textPages = new Map(Array.from({ length: 21 }, (_, index) => [index + 1, 'x'.repeat(900)]))
  const textSignals = Array.from({ length: 21 }, (_, index) => {
    const pageMetrics = metrics({ page: index + 1, meaningfulTextChars: 900, textChars: 900, embeddedImageCount: 1, rasterInkRatio: 0.2 })
    return { ...pageMetrics, ...decidePageAnalysisMode(pageMetrics), pageFingerprint: `text-${index + 1}`, analyzerVersion: 'test' }
  })
  assert.equal(selectPagesNeedingVisualAnalysis(textPages, 21, { policy: 'intelligent', signals: textSignals }).length, 0, 'VISION-4 21 text pages do not cause 21 vision calls')
}

function testAdaptiveAndMaterialBrainShareCanonicalPolicy() {
  const adaptive = readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
  const brain = readFileSync('lib/materialBrain/multimodal.ts', 'utf8')
  for (const source of [adaptive, brain]) {
    assert.match(source, /selectPagesNeedingVisualAnalysis\(/, 'VISION-9 shared selector')
    assert.match(source, /policy: 'intelligent'/, 'VISION-9 shared intelligent policy')
  }
}

function splitPages(text: string): Map<number, string> {
  const pages = new Map<number, string>()
  for (const chunk of text.split(/(?=\[Pagina \d+\])/)) {
    const match = chunk.match(/^\[Pagina (\d+)\]\n?([\s\S]*)$/)
    if (match) pages.set(Number(match[1]), match[2].replace(/\f/g, '').trim())
  }
  return pages
}

async function testFixtureAndDeterminism() {
  const originalFetch = globalThis.fetch
  let providerCalls = 0
  globalThis.fetch = (async () => {
    providerCalls += 1
    throw new Error('PAGE_INTELLIGENCE_MUST_NOT_CALL_PROVIDER')
  }) as typeof fetch
  try {
    const pdfBuffer = readFileSync('tests/fixtures/real-materials/TAREA QUIMICA CLUTCH.pdf')
    const extracted = await extractPdf(pdfBuffer, { localOnly: true })
    const extractedTextByPage = splitPages(extracted.text)
    const signals = await analyzePdfPagesContentSignals({
      pdfBuffer,
      selectedPages: [1, 2, 3, 4, 5, 6, 999],
      extractedTextByPage,
    })
    assert.deepEqual(signals.map(signal => signal.page), [1, 2, 3, 4, 5, 6])
    assert.equal(signals.find(signal => signal.page === 1)?.mode, 'text', 'native text is sufficient when the only visual signal is an embedded page image')
    for (const page of [2, 3, 4, 5, 6]) {
      assert.equal(signals.find(signal => signal.page === page)?.mode, 'vision')
    }
    const authorizedOnly = await analyzePdfPagesContentSignals({
      pdfBuffer,
      selectedPages: [2, 4, 999, 0],
      extractedTextByPage,
    })
    assert.deepEqual(authorizedOnly.map(signal => signal.page), [2, 4])
    const repeated = await analyzePdfPageContentSignals({
      pdfBuffer,
      page: 2,
      extractedText: extractedTextByPage.get(2) || '',
    })
    assert.deepEqual(repeated, signals.find(signal => signal.page === 2))
    assert.equal(providerCalls, 0)
    console.log(JSON.stringify({
      fixture: 'TAREA QUIMICA CLUTCH.pdf',
      providerCalls,
      pages: signals.map(signal => ({
        page: signal.page,
        chars: signal.meaningfulTextChars,
        images: signal.embeddedImageCount,
        vectors: signal.vectorPathSegmentCount,
        ink: signal.rasterInkRatio,
        edges: signal.rasterEdgeDensity,
        risk: signal.visualRiskScore,
        mode: signal.mode,
        reasons: signal.reasons,
      })),
    }))
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function run() {
  testPureDecisionPolicy()
  testLegacyAndIntelligentSelection()
  testAcademicDeckDocumentSafety()
  testAdaptiveAndMaterialBrainShareCanonicalPolicy()
  await testFixtureAndDeterminism()
  console.log('page-intelligence-contracts: PASS (providerCalls=0, leakage=0)')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
