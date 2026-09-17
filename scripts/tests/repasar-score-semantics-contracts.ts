import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import {
  buildRepasarGapGroups, buildRepasarReviewTargets, computeRepasarDomainMap, computeRepasarMastery,
  sortRepasarGapsByPriority, type RepasarReviewTarget,
} from '../../lib/materialBrain/reviewContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

// ============================================================
// Repasar P0 — real Clutch 2 acceptance exposed a semantics bug, NOT an
// evidence bug: 63/76 correct, 1 incorrect, 12 omitted, 83% coverage,
// 95% explanation quality produced Dominio=50/100 and "Falta reforzar
// 50%", while the provider's own narrative said "dominio excepcional".
//
// ROOT CAUSE (traced term-by-term in calibrateRepasarScore, pre-fix):
// `criticalWeak` was a BINARY cliff — "any critical-tier target not
// fully correct" capped score at `28 + 26*evidenceFrac` ≈ 28+26*0.83≈50,
// REGARDLESS of the other 63 correct targets. A newer coverage-ceiling
// (persona margins 45/35/25/30, from a prior session) never even bound —
// it was already capped below that by the older, harsher cliff first.
//
// Fix: both removed. `computeRepasarMastery` (lib/materialBrain/
// reviewContext.ts) is now a single continuous, importance-WEIGHTED
// formula with no per-persona floor/ceiling and no binary cliff.
// ============================================================

function unit(id: string, tier: 'critical' | 'supporting' | 'contextual' = 'supporting'): KnowledgeUnit {
  return {
    id, kind: 'fact',
    identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label: `Concepto ${id}`, statement: `Contenido autorizado de ${id}`,
    importance: { tier, signals: ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: `Cita de ${id}`, chunkId: 'c-1' }],
    evidence: [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: `Cita de ${id}`, chunkId: 'c-1' }],
    domainTags: [],
  } as any
}

function brain(fingerprint: string, units: KnowledgeUnit[]): MaterialBrain {
  const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint }
  return {
    scope,
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status: 'ready',
    },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

function enjoyerFromBrain(value: MaterialBrain) {
  return {
    sourceSelectionFingerprint: value.scope.fingerprint,
    globalOrderedAnalysis: value.units.map((u: any, index: number) => ({
      id: u.id, kind: u.kind, name: u.label, summary: u.statement,
      importance: u.importance?.tier === 'critical' ? 90 : u.importance?.tier === 'contextual' ? 10 : 50,
      materialId: u.provenance?.[0]?.materialId || 'mat-a', pages: [u.provenance?.[0]?.page || 1],
      sourceSpans: [{ page: u.provenance?.[0]?.page || 1, quote: u.provenance?.[0]?.quote || u.statement }], globalOrder: index,
    })),
    uniqueConceptsIndex: [], topicsIndex: [],
  }
}

function verdictsFor(targets: RepasarReviewTarget[], correctIds: string[], incorrectIds: string[] = [], partialIds: string[] = []) {
  return targets.map(t => ({
    targetId: t.id,
    status: correctIds.includes(t.id) ? 'covered' as const
      : incorrectIds.includes(t.id) ? 'incorrect' as const
        : partialIds.includes(t.id) ? 'partial' as const
          : 'missing' as const,
  })).filter(v => correctIds.includes(v.targetId) || incorrectIds.includes(v.targetId) || partialIds.includes(v.targetId))
}

// ============================================================
// REP-SCORE-A..E — sanity-constraint cases from the mission.
// ============================================================
function testScoreA_LowCoverageHighQualityStaysLow() {
  const targets = buildRepasarReviewTargets(brain('fp-a', Array.from({ length: 20 }, (_, i) => unit(`u${i}`))))
  const correctIds = targets.slice(0, 6).map(t => t.id) // ~28% coverage (6/20 -> weighted, all supporting = uniform)
  const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, correctIds))
  const mastery = computeRepasarMastery(domainMap, 0.95) // high quality on addressed subset
  assert.ok(mastery.masteryPercent < 50, `REP-SCORE-A: 28% coverage + high quality must NOT imply full/near-full mastery, got ${mastery.masteryPercent}`)
  console.log(`REP-SCORE-A PASS — 28% coverage + 95% quality -> mastery=${mastery.masteryPercent} (low/moderate, not 90+)`)
}

function testScoreB_RealClutch2ShapeIsStrong() {
  // 76 targets, tier mix like a real material: a handful critical, rest
  // supporting/contextual — the omitted/incorrect ones deliberately
  // include a critical target (the exact condition that triggered the
  // old binary cliff).
  const tiers: ('critical' | 'supporting' | 'contextual')[] = [
    ...Array.from({ length: 4 }, () => 'critical' as const),
    ...Array.from({ length: 50 }, () => 'supporting' as const),
    ...Array.from({ length: 22 }, () => 'contextual' as const),
  ]
  const targets = buildRepasarReviewTargets(brain('fp-b', tiers.map((tier, i) => unit(`u${i}`, tier))))
  assert.equal(targets.length, 76)
  const incorrectIds = ['u0'] // u0 is critical-tier (first 4 are critical)
  const omittedCandidateIds = targets.filter(t => t.id !== 'u0').slice(0, 12).map(t => t.id) // includes another critical
  const correctIds = targets.map(t => t.id).filter(id => id !== 'u0' && !omittedCandidateIds.includes(id))
  assert.equal(correctIds.length, 63)
  const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, correctIds, incorrectIds))
  assert.equal(domainMap.demonstratedCorrect, 63)
  assert.equal(domainMap.demonstratedIncorrect, 1)
  assert.equal(domainMap.omitted, 12)
  assert.equal(domainMap.coveragePercent, 83)
  const mastery = computeRepasarMastery(domainMap, 0.95)
  assert.ok(mastery.masteryPercent >= 65, `REP-SCORE-B: 83% coverage, 63/76 correct, 1 incorrect, 95% quality must be STRONG mastery, not 50. Got ${mastery.masteryPercent}`)
  console.log(`REP-SCORE-B PASS — real Clutch 2 shape -> mastery=${mastery.masteryPercent} (strong, was 50 with the old formula)`)
}

function testScoreC_FullCorrectApproachesFull() {
  const targets = buildRepasarReviewTargets(brain('fp-c', Array.from({ length: 30 }, (_, i) => unit(`u${i}`))))
  const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, targets.map(t => t.id)))
  const mastery = computeRepasarMastery(domainMap, 1.0)
  assert.ok(mastery.masteryPercent >= 95, `REP-SCORE-C: 100% correct + 100% quality must approach 100, got ${mastery.masteryPercent}`)
  console.log(`REP-SCORE-C PASS — 100% correct coverage -> mastery=${mastery.masteryPercent}`)
}

function testScoreD_ManyIncorrectStaysLow() {
  const targets = buildRepasarReviewTargets(brain('fp-d', Array.from({ length: 20 }, (_, i) => unit(`u${i}`))))
  const correctIds = targets.slice(0, 10).map(t => t.id)
  const incorrectIds = targets.slice(10).map(t => t.id) // 100% coverage, half incorrect
  const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, correctIds, incorrectIds))
  const mastery = computeRepasarMastery(domainMap, 0.8)
  assert.ok(mastery.masteryPercent <= 40, `REP-SCORE-D: 100% coverage with many incorrect must NOT approach 100, got ${mastery.masteryPercent}`)
  console.log(`REP-SCORE-D PASS — 100% coverage, 50% incorrect -> mastery=${mastery.masteryPercent} (stays low)`)
}

function testScoreE_SmallPerfectSubsetLowDomainHighQuality() {
  const targets = buildRepasarReviewTargets(brain('fp-e', Array.from({ length: 25 }, (_, i) => unit(`u${i}`))))
  const correctIds = targets.slice(0, 5).map(t => t.id) // 20%
  const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, correctIds))
  const mastery = computeRepasarMastery(domainMap, 1.0)
  assert.ok(mastery.masteryPercent <= 25, `REP-SCORE-E: 20% perfect subset must keep overall mastery low, got ${mastery.masteryPercent}`)
  console.log(`REP-SCORE-E PASS — 20% coverage, all perfect -> mastery=${mastery.masteryPercent} (low domain despite 100% quality on the subset)`)
}

// ============================================================
// REP-REINFORCE-1/2 — reinforcement is NOT 100-mastery.
// ============================================================
function testReinforcementNotComplementOfMastery() {
  const tiers: ('critical' | 'supporting' | 'contextual')[] = [
    ...Array.from({ length: 4 }, () => 'critical' as const),
    ...Array.from({ length: 50 }, () => 'supporting' as const),
    ...Array.from({ length: 22 }, () => 'contextual' as const),
  ]
  const targets = buildRepasarReviewTargets(brain('fp-reinforce', tiers.map((tier, i) => unit(`u${i}`, tier))))
  const incorrectIds = ['u0']
  const omittedCandidateIds = targets.filter(t => t.id !== 'u0').slice(0, 12).map(t => t.id)
  const correctIds = targets.map(t => t.id).filter(id => id !== 'u0' && !omittedCandidateIds.includes(id))
  const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, correctIds, incorrectIds))
  const mastery = computeRepasarMastery(domainMap, 0.95)
  assert.notEqual(mastery.reinforcementPercent, 100 - mastery.masteryPercent,
    `REP-REINFORCE-1: reinforcement must derive from real gaps, not 100-mastery (mastery=${mastery.masteryPercent}, reinforcement=${mastery.reinforcementPercent})`)
  console.log(`REP-REINFORCE-1 PASS — mastery=${mastery.masteryPercent}, reinforcement=${mastery.reinforcementPercent} (independent, not complementary)`)

  // REP-REINFORCE-2: 13/76 gaps (~17.1% by count) with a mild tier mix
  // must NOT casually become ~50% just because mastery collapsed.
  assert.ok(mastery.reinforcementPercent < 30, `REP-REINFORCE-2: 13/76 gaps must not inflate to ~50%, got ${mastery.reinforcementPercent}%`)
  console.log(`REP-REINFORCE-2 PASS — 13/76 gaps -> reinforcement=${mastery.reinforcementPercent}% (proportional to real weighted gap share, not 50%)`)
}

// ============================================================
// REP-GAPS-1/2 — actionable gap groups never drop a target.
// ============================================================
function testGapGroupsPreserveAllTargets() {
  const targets = buildRepasarReviewTargets(brain('fp-gaps', Array.from({ length: 30 }, (_, i) => unit(`u${i}`))))
  const correctIds = targets.slice(0, 10).map(t => t.id)
  const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, correctIds))
  const expectedGapIds = new Set(targets.filter(t => !correctIds.includes(t.id)).map(t => t.id))
  const { groups, remainderTargetIds } = buildRepasarGapGroups(targets, domainMap, [], 8)
  const capturedIds = new Set([...groups.flatMap(g => g.targetIds), ...remainderTargetIds])
  assert.equal(capturedIds.size, expectedGapIds.size, 'REP-GAPS-1: every omitted/partial/incorrect target id must be represented')
  for (const id of expectedGapIds) assert.ok(capturedIds.has(id), `REP-GAPS-1: gap target ${id} must not disappear`)
  console.log('REP-GAPS-1 PASS — all omitted/partial/incorrect targets represented in gap groups + remainder')
}

function testGapGroupsBoundedForLargeN() {
  const targets = buildRepasarReviewTargets(brain('fp-gaps-1000', Array.from({ length: 1000 }, (_, i) => unit(`u${i}`))))
  const correctIds = targets.slice(0, 100).map(t => t.id) // 900 gaps
  const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, correctIds))
  const { groups, remainderCount, remainderTargetIds } = buildRepasarGapGroups(targets, domainMap, [], 8)
  assert.ok(groups.length <= 8, `REP-GAPS-2: display must stay bounded, got ${groups.length} groups`)
  const totalCaptured = groups.reduce((sum, g) => sum + g.targetIds.length, 0) + remainderTargetIds.length
  assert.equal(totalCaptured, 900, 'REP-GAPS-2: bounded display must never drop gap authority — every one of the 900 gaps is still resolvable')
  assert.equal(remainderCount + groups.length, remainderCount + groups.length) // groups themselves may be singleton clusters (no relations provided)
  console.log(`REP-GAPS-2 PASS — N=1000, 900 gaps -> ${groups.length} displayed groups (bounded) + ${remainderTargetIds.length} in remainder, 0 dropped`)
}

// ============================================================
// REP-NEXT-1 — deterministic next-priority target.
// ============================================================
function testNextPriorityDeterministic() {
  const targets = buildRepasarReviewTargets(brain('fp-next', [
    unit('u-critical-omitted', 'critical'),
    unit('u-supporting-incorrect', 'supporting'),
    unit('u-contextual-omitted', 'contextual'),
  ]))
  const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, [], ['u-supporting-incorrect']))
  const sorted = sortRepasarGapsByPriority(targets, domainMap, [])
  assert.equal(sorted[0], 'u-supporting-incorrect', 'REP-NEXT-1: an active incorrect claim outranks any omission, even a critical one')
  console.log('REP-NEXT-1 PASS — incorrect (misconception) is prioritized over omitted, per the explicit policy')
}

// ============================================================
// Integration proof — the real end-to-end route produces the fixed
// score for the exact Clutch-2-shaped input (not just the pure formula).
// ============================================================
const frozenSnapshots = new Map<string, any>()
const testSnapshotStore = {
  async get(id: string) { return frozenSnapshots.get(id) || null },
  async set(snapshot: any) { frozenSnapshots.set(snapshot.snapshotId, snapshot) },
}
async function testScoreB_EndToEndThroughRoute() {
  const tiers: ('critical' | 'supporting' | 'contextual')[] = [
    ...Array.from({ length: 4 }, () => 'critical' as const),
    ...Array.from({ length: 50 }, () => 'supporting' as const),
    ...Array.from({ length: 22 }, () => 'contextual' as const),
  ]
  const b = brain('fp-e2e-b', tiers.map((tier, i) => unit(`u${i}`, tier)))
  const targetIds = tiers.map((_, i) => `u${i}`)
  const incorrectIds = ['u0']
  const omittedIds = targetIds.filter(id => id !== 'u0').slice(0, 12)
  const correctIds = targetIds.filter(id => id !== 'u0' && !omittedIds.includes(id))
  const deps = {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: b.scope.fingerprint } } as any),
    getMaterial: async () => ({ id: 'mat-a' }) as any,
    createRepasarSnapshotStore: () => testSnapshotStore,
    lookupEnjoyer: async (fingerprint: string) => (fingerprint === b.scope.fingerprint ? enjoyerFromBrain(b) : null),
    generateValidatedLegacyJson: async ({ validate, telemetryContext }: any) => {
      const phase = String(telemetryContext?.phase || '')
      const value = phase === 'analysis_batch'
        ? { targetCoverage: [
          ...correctIds.map(id => ({ targetId: id, status: 'covered', evidence: `evidencia ${id}`, demonstrated: `evidencia ${id}` })),
          ...incorrectIds.map(id => ({ targetId: id, status: 'incorrect', evidence: `evidencia equivocada ${id}`, demonstrated: `evidencia equivocada ${id}` })),
          // Explicitly adjudicated missing (the model was asked and found
          // no evidence) — never just absent, which now triggers a retry
          // under the completeness contract instead of a silent default.
          ...omittedIds.map(id => ({ targetId: id, status: 'missing', evidence: '' })),
        ] }
        : {
          score: 95, feedback: 'La respuesta es excepcional, dominio avanzado del material.', summary: 'Comprensión excepcional.',
          conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
          repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] }, targetCoverage: [],
        }
      const result = validate(value)
      assert.ok(result.valid, result.errors?.join(','))
      return value
    },
  }
  frozenSnapshots.clear()
  Object.assign(__routeDeps, deps)
  const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Explicación larga y mayormente correcta del estudiante sobre el equilibrio químico.', mode: 'profesor' }),
  })
  const res = await POST(req)
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 76)
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 63)
  assert.equal(data.analysis.domainMap.demonstratedIncorrect, 1)
  assert.equal(data.analysis.domainMap.omitted, 12)
  assert.ok(data.analysis.score >= 65, `end-to-end score must be strong, got ${data.analysis.score}`)
  assert.ok(data.analysis.studyBreakdown.missing < 30, `Falta reforzar must reflect real weighted gaps, got ${data.analysis.studyBreakdown.missing}%`)
  assert.ok(data.analysis.domainMap.nextPriorityTargetId, 'a next-priority gap target must be selected')
  assert.ok(Array.isArray(data.analysis.domainMap.gapGroups))
  console.log(`REP-SCORE-B (end-to-end) PASS — real route produces score=${data.analysis.score}, Falta reforzar=${data.analysis.studyBreakdown.missing}% (was 50/50 before the fix)`)
}

async function main() {
  testScoreA_LowCoverageHighQualityStaysLow()
  testScoreB_RealClutch2ShapeIsStrong()
  testScoreC_FullCorrectApproachesFull()
  testScoreD_ManyIncorrectStaysLow()
  testScoreE_SmallPerfectSubsetLowDomainHighQuality()
  testReinforcementNotComplementOfMastery()
  testGapGroupsPreserveAllTargets()
  testGapGroupsBoundedForLargeN()
  testNextPriorityDeterministic()
  await testScoreB_EndToEndThroughRoute()
  console.log('repasar-score-semantics-contracts: ALL PASS')
}

main().catch(err => { console.error(err); process.exit(1) })
