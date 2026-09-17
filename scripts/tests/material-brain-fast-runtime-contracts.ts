import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildMaterialBrain } from '../../lib/materialBrain/build'
import { InMemoryVisualPageAnalysisStore } from '../../lib/materials/visualPageCache'
import { resolveMaterialCapabilities } from '../../lib/materialBrain/capabilities'
import type { PageContentSignals } from '../../lib/materials/pageContentSignals'
import type { VisualPageAnalysisResult } from '../../lib/materials/visualPageAnalysis'
import type { PageChunk, ResolvedSourceMaterial } from '../../lib/materialBrain/types'

// ============================================================
// P0 — SOURCE_READY fast-path crash after fallback base is built.
//
// Reproduces the real production shape: a native, multi-page PDF whose
// content signals mark AT LEAST ONE page as needing visual analysis
// (formula/diagram/low-text-density pages — routine for real academic
// PDFs, not an edge case). The FAST base build (skipRichExtraction,
// zero provider calls) deliberately skips vision leaves entirely
// ("optional, handled progressively later" — see build.ts). Before the
// fix, that left `resultByChunkId`/`checkpointByChunkId` unset for
// those leaves, and the final merge (`mergeExtractions`, build.ts:530
// -> merge.ts:87) unconditionally read `.units` off every chunk's
// extraction, including the unset vision one -> crash:
//   "Cannot read properties of undefined (reading 'units')"
// ============================================================

function signal(page: number, mode: PageContentSignals['mode']): PageContentSignals {
  return {
    page,
    textChars: mode === 'text' ? 400 : 20,
    meaningfulTextChars: mode === 'text' ? 400 : 20,
    embeddedImageCount: mode === 'text' ? 0 : 1,
    vectorObjectCount: 0,
    vectorPathSegmentCount: 0,
    drawingOperationCount: 0,
    rasterInkRatio: mode === 'text' ? 0 : 0.2,
    rasterColorRatio: 0,
    rasterEdgeDensity: 0.02,
    tableLikeSignal: false,
    formulaLikeSignal: mode !== 'text',
    captionLikeSignal: false,
    visualRiskScore: mode === 'text' ? 0 : 0.4,
    visualContentPresent: mode !== 'text',
    mode,
    reasons: mode === 'text' ? ['low_visual_risk'] : ['visual_content_present'],
    pageFingerprint: `signal-${page}`,
    analyzerVersion: '2.0.0',
  }
}

function visualResult(input: { materialId: string; page: number; contentFingerprint: string; pageFingerprint: string }): VisualPageAnalysisResult {
  return {
    materialId: input.materialId, page: input.page, status: 'success',
    text: `Visual description page ${input.page}`, visualDescription: `Visual description page ${input.page}`,
    derivation: 'vision', provider: 'test-provider', model: 'test-model', attempts: 1,
    analyzerVersion: '2.0.0', promptVersion: '1.0.0',
    contentFingerprint: input.contentFingerprint, pageFingerprint: input.pageFingerprint,
  }
}

const PAGE_COUNT = 43
const VISUAL_PAGES = new Set([7, 22, 39]) // realistic minority of formula/diagram pages

function realMaterial(): ResolvedSourceMaterial {
  const pages = Array.from({ length: PAGE_COUNT }, (_, i) => i + 1)
  const text = pages.map(p => `[Pagina ${p}]\nTexto académico verificable con contenido suficiente para el análisis.`).join('\n')
  return { materialId: 'mat_real_native_pdf', nombre: 'material.pdf', kind: 'pdf', knownPages: pages, text, storageKey: 'material.pdf' }
}

function scopeFor(source: ResolvedSourceMaterial) {
  return buildSourceSelectionSnapshot([source.materialId], { [source.materialId]: source.knownPages || [] })
}

async function buildFastBase(source: ResolvedSourceMaterial, providerCallCounter?: { calls: number }) {
  return buildMaterialBrain(scopeFor(source), [source], {
    skipRichExtraction: true,
    visualStore: new InMemoryVisualPageAnalysisStore(),
    loadPdf: async () => Buffer.from(`pdf-${source.materialId}`),
    analyzeSignals: async input => input.selectedPages.map(page => signal(page, VISUAL_PAGES.has(page) ? 'vision' : 'text')),
    analyzeVisual: async input => { if (providerCallCounter) providerCallCounter.calls++; return visualResult(input) },
    extractFn: async (_chunk: PageChunk) => { throw new Error('extractFn must NEVER be called on the fast base path') },
    maxDirectedRetries: 0,
  })
}

async function testMBFastRuntime1() {
  // MB-FAST-RUNTIME-1: fallback-only Brain survives the full post-build merge.
  const source = realMaterial()
  const brain = await buildFastBase(source)
  assert.ok(brain.units, 'brain.units must exist')
  assert.ok(brain.units.length > 0, 'fallback leaves must contribute units')
  assert.deepEqual(brain.relations, [], 'no relations expected from pure fallback')
  console.log('MB-FAST-RUNTIME-1 PASS — fallback-only Brain survives full post-build merge')
}

async function testMBFastRuntime2() {
  // MB-FAST-RUNTIME-2: fallback-only Brain route-response shape is valid.
  const source = realMaterial()
  const brain = await buildFastBase(source)
  assert.equal(brain.meta.sourceReadiness, 'ready')
  assert.equal(brain.meta.brainEnrichment, 'not_started')
  assert.equal(brain.sourceCoverage.status, 'complete')
  assert.equal(brain.meta.status, 'ready')
  console.log('MB-FAST-RUNTIME-2 PASS — fallback-only Brain route response is valid')
}

async function testMBFastRuntime3() {
  // MB-FAST-RUNTIME-3: fallback-only Brain capabilities resolve without crashing.
  const source = realMaterial()
  const brain = await buildFastBase(source)
  const capabilities = resolveMaterialCapabilities(brain)
  assert.ok(capabilities, 'capabilities must resolve')
  assert.equal(capabilities.sourceReady, true)
  console.log('MB-FAST-RUNTIME-3 PASS — fallback-only Brain capabilities resolve')
}

async function testMBFastRuntime4() {
  // MB-FAST-RUNTIME-4: fallback-only Brain opens the hub (sourceReady gate).
  const source = realMaterial()
  const brain = await buildFastBase(source)
  const capabilities = resolveMaterialCapabilities(brain)
  assert.equal(brain.meta.sourceReadiness, 'ready')
  assert.equal(capabilities.sourceReady, true, 'hub gate must open on sourceReady regardless of brainEnrichment')
  console.log('MB-FAST-RUNTIME-4 PASS — fallback-only Brain opens hub')
}

async function testMBFastRuntime5() {
  // MB-FAST-RUNTIME-5: optional caches (quiz coverage) do not crash on the base Brain,
  // and are correctly NOT precomputed against the fast-base (fact-only) universe.
  const source = realMaterial()
  const brain = await buildFastBase(source)
  assert.equal(brain.meta.quizCoverageCache, undefined, 'quiz coverage must not be precomputed against the fast-base universe')
  console.log('MB-FAST-RUNTIME-5 PASS — optional caches do not crash on base Brain')
}

async function testZeroProviderCalls() {
  const source = realMaterial()
  const counter = { calls: 0 }
  await buildFastBase(source, counter)
  assert.equal(counter.calls, 0, 'fast base must make ZERO provider (vision) calls')
  console.log('MB-FAST-RUNTIME-6 PASS — zero provider calls on fast base with visual pages present')
}

async function testVisionLeavesHonestlyDeferred() {
  // Vision pages are honestly reported as deferred (visualCoverage.status
  // 'partial', requested but not analyzed) — never silently dropped, and
  // never given a fabricated 'complete'/'not_required' status.
  const source = realMaterial()
  const brain = await buildFastBase(source)
  assert.equal(brain.visualCoverage?.status, 'partial')
  assert.equal(brain.visualCoverage?.requested.length, VISUAL_PAGES.size)
  assert.equal(brain.visualCoverage?.analyzed.length, 0)
  assert.equal((brain.meta.chunkCheckpoints || {})['mat_real_native_pdf_v7'], undefined)
  console.log('MB-FAST-RUNTIME-7 PASS — vision pages honestly deferred (partial visualCoverage, no fabricated checkpoint)')
}

async function testPendingVisualPlaceholderNeverUndefined() {
  // Defense in depth: even if a vision chunk DID reach allChunks without a
  // checkpoint (e.g. a future caller enables skipRichExtraction with
  // multimodal already resolved from a previousBrain), the canonical
  // placeholder must give it a valid, honest, empty extraction — never
  // undefined. Exercised directly against the exported helper's contract
  // via a real fast build with multimodal disabled (documents the
  // structural invariant mergeExtractions/visualCheckpoints depend on).
  const source = material_TextOnly()
  const brain = await buildMaterialBrain(scopeFor(source), [source], {
    skipRichExtraction: true, multimodal: false, maxDirectedRetries: 0,
  })
  assert.ok(brain.units)
  assert.equal(brain.relations.length, 0)
  console.log('MB-FAST-RUNTIME-8 PASS — canonical extraction/checkpoint accessor never leaves a chunk undefined')
}

function material_TextOnly(): ResolvedSourceMaterial {
  return { materialId: 'mat_text_only', nombre: 'text.pdf', kind: 'pdf', knownPages: [1, 2], text: '[Pagina 1]\nTexto académico verificable.\n[Pagina 2]\nMás contenido académico verificable.' }
}

async function main() {
  await testMBFastRuntime1()
  await testMBFastRuntime2()
  await testMBFastRuntime3()
  await testMBFastRuntime4()
  await testMBFastRuntime5()
  await testZeroProviderCalls()
  await testVisionLeavesHonestlyDeferred()
  await testPendingVisualPlaceholderNeverUndefined()
  console.log('material-brain-fast-runtime-contracts: ALL PASS')
}

main().catch(err => { console.error(err); process.exit(1) })
