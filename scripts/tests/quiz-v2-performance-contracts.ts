import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import type { MaterialBrain } from '../../lib/materialBrain/types'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import { getOrBuildProductionBrain } from '../../lib/materialBrain/productionStore'
import {
  computeAndAttachMaterialQuizCoverage,
  MATERIAL_QUIZ_COVERAGE_CONFIG,
  readCachedQuizCoverage,
} from '../../lib/materialBrain/quiz/coverageCache'

function fixtureBrain(): MaterialBrain {
  const scope = buildSourceSelectionSnapshot(['perf-material'], { 'perf-material': [1] })
  return {
    scope,
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status: 'ready',
    },
    units: Array.from({ length: 4 }, (_, index) => ({
      id: `u${index}`, kind: 'fact' as const,
      identity: { canonicalSubject: `Tema ${index}`, semanticKey: `tema-${index}`, qualifiers: [] },
      label: `Tema ${index}`, statement: `Hecho verificable ${index}`,
      importance: { tier: 'supporting' as const, signals: ['model_judged' as const], confidence: 0.9 },
      provenance: [{ materialId: 'perf-material', page: 1, quote: `Tema ${index} | Hecho verificable ${index}`, chunkId: 'c0' }],
      evidence: [{ materialId: 'perf-material', page: 1, derivation: 'native_text' as const, quote: `Tema ${index} | Hecho verificable ${index}`, chunkId: 'c0' }],
      domainTags: [],
    })),
    relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: 4, unitsAccepted: 4, unitsWithoutValidProvenance: 0, invalidStructural: 0, relationsDroppedAmbiguous: 0, warnings: [] },
    mergeLog: { exactDuplicatesMerged: 0, semanticDuplicatesMerged: 0, conflicts: [] },
  }
}

const brain = fixtureBrain()
const analysis = computeAndAttachMaterialQuizCoverage(brain)
assert.equal(brain.meta.llmCallsUsed, 0, 'QUIZ-PERF-2 recommendation performs no provider work')
assert.deepEqual(readCachedQuizCoverage(brain, MATERIAL_QUIZ_COVERAGE_CONFIG), analysis,
  'QUIZ-PERF-3 same fingerprint/config restores deterministic coverage')
const changedFingerprint = structuredClone(brain)
changedFingerprint.scope.fingerprint = 'different-source-fingerprint'
assert.equal(readCachedQuizCoverage(changedFingerprint, MATERIAL_QUIZ_COVERAGE_CONFIG), null,
  'IDEAL-PERF-7 source fingerprint invalidates recommendation')
const changedVersion = structuredClone(brain)
changedVersion.meta.builderVersion = 'different-builder-version'
assert.equal(readCachedQuizCoverage(changedVersion, MATERIAL_QUIZ_COVERAGE_CONFIG), null,
  'IDEAL-PERF-8 algorithm/builder identity invalidates recommendation')

const ui = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
assert.match(ui, /\.saq-count-pill\.active,\s*\.saq-count-pill\.ideal\.active\s*\{\s*color:\s*#0a0a0a;/,
  'VISUAL selected preset and dynamic recommendation use the same contrast rule')
assert.ok(ui.includes('if (coverageFingerprint === effectiveSourceSelection.fingerprint) return;'),
  'QUIZ-PERF-3 setup re-entry does not refetch valid server-owned completion coverage')
assert.ok(ui.includes("stage: 'setup_or_resume_ready'") && ui.includes("stage: 'first_question_ready'"),
  'performance stages are instrumented')

// New progressive coverage is server-owned completed evidence. A historical
// Material Brain recommendation may still be passed by the shared page, but
// Quiz must not consume it as current coverage authority.
assert.ok(!ui.includes('() => quizRecommendation || null'))
assert.ok(!ui.includes('if (quizRecommendation) return;'))
assert.doesNotMatch(ui, /quizRecommendation/)
const route = readFileSync('app/api/alai-studyal-quizzes/route.ts', 'utf8')
assert.ok(route.includes("if (body?.mode === 'coverage')") && route.includes('providerCalls: 0'))

// IDEAL-PERF-3/4/7/8/10: a legacy ready Brain is backfilled once, persisted,
// then reused; fingerprint/version are part of the cache identity.
async function testPersistentBackfill() {
  const legacy = fixtureBrain()
  legacy.meta.quizCoverageCache = undefined
  let writes = 0
  let builds = 0
  const store = {
    async get(fingerprint: string) { return fingerprint === legacy.scope.fingerprint ? legacy : null },
    async set(_fingerprint: string, value: MaterialBrain) { writes++; Object.assign(legacy, value) },
  }
  const firstRestore = await getOrBuildProductionBrain(legacy.scope, [], store, {
    buildFn: async () => { builds++; throw new Error('must_not_build') },
  })
  assert.equal(firstRestore.status, 'ready')
  assert.equal(writes, 1, 'legacy recommendation is persisted once')
  assert.equal(builds, 0)
  assert.ok(readCachedQuizCoverage(legacy, MATERIAL_QUIZ_COVERAGE_CONFIG))
  await getOrBuildProductionBrain(legacy.scope, [], store, {
    buildFn: async () => { builds++; throw new Error('must_not_build') },
  })
  assert.equal(writes, 1, 'second visit reuses persisted recommendation')
  assert.equal(builds, 0)

  const repeat = computeAndAttachMaterialQuizCoverage(structuredClone(fixtureBrain()))
  assert.deepEqual(repeat, analysis, 'IDEAL-PERF-9 optimized result remains deterministic/logically identical')
  console.log('quiz-v2-performance-contracts: PASS (IDEAL-PERF-1..10, providerCalls=0, persistentCoverage=true)')
}

testPersistentBackfill().catch(error => { console.error(error); process.exit(1) })
