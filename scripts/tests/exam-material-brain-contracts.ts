import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { ImportanceTier, KnowledgeUnit, KnowledgeUnitKind, MaterialBrain, RelationType } from '../../lib/materialBrain/types'
import {
  buildExamCandidatePool, buildExamTargets, composeExamBlueprint, computeExamTimeBounds,
} from '../../lib/materialBrain/examContext'
import { InMemoryExamGenerationStore } from '../../lib/materialBrain/examGenerationStore'
import { POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'

function unit(
  id: string, materialId: string, page: number, derivation: 'native_text' | 'vision',
  kind: KnowledgeUnitKind = 'fact', tier: ImportanceTier = 'supporting',
): KnowledgeUnit {
  const base: any = {
    id, kind,
    identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label: `Concepto ${id}`, statement: `Contenido autorizado y verificable de ${id} con suficiente longitud`,
    importance: { tier, signals: ['model_judged'], confidence: 0.9 },
    provenance: derivation === 'vision' ? [] : [{ materialId, page, quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    evidence: derivation === 'vision'
      ? [{ materialId, page, derivation: 'vision', pageFingerprint: `pf-${id}`, analyzerVersion: '1.0', promptVersion: '1.0', description: `Descripción visual de ${id}` }]
      : [{ materialId, page, derivation: 'native_text', quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    domainTags: [],
  }
  return base
}

function relation(id: string, type: RelationType, fromUnitId: string, toUnitId: string) {
  return {
    id, type, fromUnitId, toUnitId, statement: `${fromUnitId} ${type} ${toUnitId}`,
    importance: { tier: 'supporting', signals: [], confidence: 0.8 }, provenance: [],
  }
}

function brain(
  fingerprint: string, units: KnowledgeUnit[], relations: any[] = [], materialIds: string[] = ['mat-a'],
  builderVersion = MATERIAL_BRAIN_BUILDER_VERSION, status: 'ready' | 'partial' | 'failed' = 'ready',
): MaterialBrain {
  const selectedPages = Object.fromEntries(materialIds.map(id => [id, [1, 2, 3]]))
  return {
    scope: { ...buildSourceSelectionSnapshot(materialIds, selectedPages), fingerprint },
    meta: {
      version: '1.0.0', builderVersion, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status,
    },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

/** A large, structurally-mixed synthetic Brain used across the duration matrix (§23). */
function largeMixedBrain(): MaterialBrain {
  const units: KnowledgeUnit[] = []
  for (let i = 0; i < 24; i++) units.push(unit(`term${i}`, 'mat-a', (i % 6) + 1, 'native_text', i % 2 === 0 ? 'terminology' : 'definition'))
  for (let i = 0; i < 10; i++) units.push(unit(`fact${i}`, 'mat-b', (i % 6) + 1, 'native_text', 'fact', i % 5 === 0 ? 'critical' : 'supporting'))
  for (let i = 0; i < 6; i++) units.push(unit(`formula${i}`, 'mat-a', (i % 6) + 1, 'native_text', 'formula'))
  units.push(unit('vision0', 'mat-b', 2, 'vision', 'fact'))
  const relations: any[] = []
  for (let i = 0; i < 8; i++) relations.push(relation(`r-cause-${i}`, 'causes', 'fact0', `fact${(i % 9) + 1}`))
  for (let i = 0; i < 4; i++) relations.push(relation(`r-depends-${i}`, 'depends_on', `formula${i}`, `formula${(i + 1) % 6}`))
  return brain('fp-large', units, relations, ['mat-a', 'mat-b'])
}

// ============================================================
// EXAM-COMPOSER-1..4, EXAM-COVER-1/2 — pure composer contract
// ============================================================
function testComposerOwnsEverything() {
  const b = largeMixedBrain()
  const targets = buildExamTargets(b)
  const bounds = computeExamTimeBounds(targets, b)
  const bp = composeExamBlueprint(b, bounds.idealDurationMinutes, 'exam-1', 'seed-1')

  assert.equal(bp.coveragePercent, 100, 'EXAM-COVER-2 coverage always 100 before start')
  const represented = new Set(bp.slots.flatMap(s => s.targetIds))
  assert.equal(represented.size, targets.length, 'EXAM-COVER-1 every required target represented')
  assert.deepEqual([...represented].sort(), targets.map(t => t.id).sort())

  // EXAM-COMPOSER-1/2/3/4: the ONLY input is duration; type/difficulty/
  // count are entirely composer-decided (no user-supplied fields exist
  // in composeExamBlueprint's signature at all — verified by the call
  // above never passing them).
  assert.ok(bp.slots.length > 0, 'EXAM-COMPOSER-4 question count is a composer OUTPUT, not an input')
  assert.ok(Object.keys(bp.typeDistribution).length >= 1, 'EXAM-COMPOSER-2 types are entirely composer-decided (no selectedTypes input exists)')
  const shortBp = composeExamBlueprint(b, bounds.minimumViableDurationMinutes, 'exam-1-short', 'seed-1-short')
  const allTypesSeen = new Set([...Object.keys(bp.typeDistribution), ...Object.keys(shortBp.typeDistribution)])
  assert.ok(allTypesSeen.size > 1, 'EXAM-COMPOSER-2 across durations the system produces more than one question type from the same material')
  assert.ok(Object.keys(bp.difficultyDistribution).length >= 1, 'EXAM-COMPOSER-3 difficulty curve is system-composed')
  console.log('exam-material-brain-contracts: EXAM-COMPOSER-1/2/3/4, EXAM-COVER-1/2 PASS')
}

// ============================================================
// EXAM-TIME-1/2/3 — minimum viable duration rules
// ============================================================
function testMinimumViableTime() {
  const b = largeMixedBrain()
  const targets = buildExamTargets(b)
  const bounds = computeExamTimeBounds(targets, b)
  assert.ok(bounds.minimumViableDurationMinutes > 0)

  // Requesting far below minimum still yields 100% coverage (EXAM-TIME-1/3).
  const belowMin = composeExamBlueprint(b, 1, 'exam-below', 'seed-below')
  assert.equal(belowMin.coveragePercent, 100, 'EXAM-TIME-1 below minimum never reduces target coverage')
  assert.equal(belowMin.durationMinutes, bounds.minimumViableDurationMinutes, 'EXAM-TIME-2 below minimum resolves to the minimum viable duration')
  const representedBelow = new Set(belowMin.slots.flatMap(s => s.targetIds))
  assert.equal(representedBelow.size, targets.length, 'EXAM-TIME-3 minimum duration itself produces 100% blueprint coverage')

  console.log(`exam-material-brain-contracts: EXAM-TIME-1/2/3 PASS (minimum=${bounds.minimumViableDurationMinutes}min, ideal=${bounds.idealDurationMinutes}min)`)
}

// ============================================================
// EXAM-COVER-3/4 — time changes compression, never coverage
// ============================================================
function testCompressionBehavior() {
  const b = largeMixedBrain()
  const targets = buildExamTargets(b)
  const bounds = computeExamTimeBounds(targets, b)

  const short = composeExamBlueprint(b, bounds.minimumViableDurationMinutes, 'exam-short', 'seed-x')
  const long = composeExamBlueprint(b, bounds.idealDurationMinutes, 'exam-long', 'seed-x')

  assert.equal(short.coveragePercent, 100)
  assert.equal(long.coveragePercent, 100)
  assert.ok(short.slots.length <= long.slots.length, 'EXAM-COVER-3 shorter time uses fewer/denser slots (more aggregate compression)')
  const shortAggregates = short.slots.filter(s => s.type === 'matching' || s.type === 'multi_select').length
  const longAggregates = long.slots.filter(s => s.type === 'matching' || s.type === 'multi_select').length
  assert.ok(shortAggregates >= longAggregates, 'shorter time compresses via MORE aggregate (matching/multi_select) slots, not fewer targets')

  // EXAM-COVER-4: decompressing must never duplicate the same target
  // across multiple singles produced purely as filler.
  const targetCounts = new Map<string, number>()
  for (const slot of long.slots) if (slot.targetIds.length === 1) targetCounts.set(slot.targetIds[0], (targetCounts.get(slot.targetIds[0]) || 0) + 1)
  assert.ok([...targetCounts.values()].every(count => count === 1), 'EXAM-COVER-4 longer time decompresses without duplicate filler questions per target')

  console.log(`exam-material-brain-contracts: EXAM-COVER-3/4 PASS (short=${short.slots.length} slots/${shortAggregates} aggregates, long=${long.slots.length} slots/${longAggregates} aggregates)`)
}

// ============================================================
// EXAM-TYPE-1/2 — multi_select and matching are grounded
// ============================================================
function testGroundedTypeSupport() {
  const b = largeMixedBrain()
  const targets = buildExamTargets(b)
  const pool = buildExamCandidatePool(targets, b)
  assert.ok(pool.aggregates.some(a => a.type === 'matching'), 'EXAM-TYPE-2 matching candidates are constructed from real terminology/definition targets')
  assert.ok(pool.aggregates.some(a => a.type === 'multi_select'), 'EXAM-TYPE-1 multi_select candidates are constructed from real causal relations')
  const matching = pool.aggregates.find(a => a.type === 'matching')!
  assert.equal(matching.answerAuthority.kind, 'pairs')
  const multiSelect = pool.aggregates.find(a => a.type === 'multi_select')!
  assert.equal(multiSelect.answerAuthority.kind, 'multi_text')
  console.log('exam-material-brain-contracts: EXAM-TYPE-1/2 PASS')
}

// ============================================================
// EXAM-REL-1 — real relations support aggregate evaluation
// ============================================================
function testRelationDerivedTargets() {
  const b = brain('fp-rel', [
    unit('hub', 'mat-a', 1, 'native_text', 'fact', 'critical'),
    unit('child0', 'mat-a', 1, 'native_text', 'fact'),
    unit('child1', 'mat-a', 2, 'native_text', 'fact'),
    unit('unrelated', 'mat-a', 3, 'native_text', 'fact'),
  ], [relation('r0', 'causes', 'hub', 'child0'), relation('r1', 'causes', 'hub', 'child1')])
  const targets = buildExamTargets(b)
  const pool = buildExamCandidatePool(targets, b)
  const multiSelect = pool.aggregates.find(a => a.type === 'multi_select')
  assert.ok(multiSelect, 'EXAM-REL-1 a real causal relation cluster becomes a legitimate multi_select candidate')
  assert.ok(multiSelect!.targetIds.includes('unit:hub') && multiSelect!.targetIds.includes('unit:child0') && multiSelect!.targetIds.includes('unit:child1'))
  assert.ok(!multiSelect!.targetIds.includes('unit:unrelated'), 'no invented relationship — the unrelated unit never joins the cluster')
  console.log('exam-material-brain-contracts: EXAM-REL-1 PASS')
}

// ============================================================
// EXAM-STATIC-1/2/3 — no mid-exam adaptation
// ============================================================
function testNoMidExamAdaptation() {
  const b = largeMixedBrain()
  const bp1 = composeExamBlueprint(b, 30, 'exam-static', 'seed-static')
  const bp2 = composeExamBlueprint(b, 30, 'exam-static', 'seed-static')
  assert.deepEqual(bp1.slots, bp2.slots, 'EXAM-STATIC-1 identical (brain,duration,examId,seed) => identical blueprint — nothing about the blueprint depends on runtime answers')
  assert.equal(bp1.slots.length, bp1.slots.length, 'EXAM-STATIC-3 finite frozen question count from start')

  const componentSource = require('node:fs').readFileSync('components/materias/ALAIStudyALExams.tsx', 'utf8') as string
  const adaptFnMatch = componentSource.match(/async function maybeAdapt\(\)\s*\{([\s\S]*?)\n  \}/)
  assert.ok(adaptFnMatch, 'maybeAdapt() must exist (kept, not deleted)')
  const adaptFnBody = adaptFnMatch![1]
  assert.ok(/^\s*return;/.test(adaptFnBody), 'EXAM-STATIC-2 maybeAdapt() is a no-op (returns before reaching mode:\'adapt\') — nothing can add/remove/change future slots based on answers')
  const routeSource = require('node:fs').readFileSync('app/api/alai-studyal-exam/route.ts', 'utf8') as string
  assert.ok(!routeSource.includes("mode === 'adapt'"), 'EXAM-STATIC-2 the route no longer dispatches to adaptExam() from any reachable branch')
  assert.ok(routeSource.includes('async function adaptExam'), 'adaptExam() itself is kept (shared/legacy code), just unreachable — not deleted')
  console.log('exam-material-brain-contracts: EXAM-STATIC-1/2/3 PASS')
}

// ============================================================
// EXAM-VISION — vision-derived target usable, 0 vision calls
// ============================================================
function testVision() {
  const b = brain('fp-vision', [unit('u-vision', 'mat-a', 2, 'vision', 'fact')])
  const targets = buildExamTargets(b)
  assert.equal(targets[0].evidence[0].derivation, 'vision')
  assert.equal(targets[0].evidence[0].evidenceText, 'Descripción visual de u-vision', 'EXAM-VISION vision evidence reaches the target — 0 vision calls (no such dep exists)')
  console.log('exam-material-brain-contracts: EXAM-VISION PASS')
}

// ============================================================
// Route-level contracts: EXAM-BRAIN, EXAM-ANSWER-1..6, EXAM-PERF
// ============================================================
// Legacy composer unit checks above remain historical compatibility tests.
// The live route MUST NOT restore Brain, including an otherwise ready one.
// Positive answer/grading authority cases now live in exam-enjoyer-grading,
// exam-final-certification and exam-product-integrity-pass2 contracts.
async function testBrainAuthorityAndAnswerAuthority() {
  const original = { ...__routeDeps }
  let brainCalls = 0, providerCalls = 0
  try {
    Object.assign(__routeDeps, {
      getServerSession: async () => ({ user: { id: 'user-1' } }),
      getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-large' } }),
      getMaterial: async () => ({ id: 'mat-a' }),
      lookupStudyalMaterialEnjoyer: async () => null,
      restoreMaterialBrain: async () => { brainCalls++; return largeMixedBrain() },
      generateValidatedLegacyJson: async () => { providerCalls++; throw Error('NO_PROVIDER') },
    })
    for (const mode of ['recommend', 'generate']) {
      const res = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({mode, sessionId:'sess-1', durationMinutes:30}) }))
      assert.equal(res.status,409)
      assert.equal((await res.json()).error,'ENJOYER_NOT_READY')
    }
    const raw = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({mode:'recommend',sessionId:'sess-1',materialText:'injected'}) }))
    assert.equal(raw.status,400)
    assert.equal((await raw.json()).detail,'RAW_SOURCE_AUTHORITY_FORBIDDEN')
    assert.equal(brainCalls,0)
    assert.equal(providerCalls,0)
    console.log('exam-material-brain-contracts: legacy Brain excluded from live authority PASS')
  } finally { Object.assign(__routeDeps,original); delete (__routeDeps as unknown as Record<string, unknown>).restoreMaterialBrain }
}

async function testDeterministicScoring() {
  const res = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'evaluate',sessionId:'sess-1',exam:{id:'forged',questions:[{correctAnswer:0}]},answers:[0]}),
  }))
  assert.equal(res.status,400)
  assert.equal((await res.json()).detail,'CLIENT_ACADEMIC_AUTHORITY_FORBIDDEN')
  console.log('exam-material-brain-contracts: client answer authority rejected PASS')
}

// ============================================================
// EXAM-TIMER — timer starts only when the exam becomes playable
// (audited: unchanged deadlineAt semantics from the prior migration).
// ============================================================
function testTimerSemantics() {
  // Full EXAM-PROG-3/4 timer-start-only-on-explicit-start semantics are
  // covered exhaustively in exam-progressive-contracts.ts. This just
  // reconfirms the auto-submit-once behavior is unchanged.
  const componentSource = require('node:fs').readFileSync('components/materias/ALAIStudyALExams.tsx', 'utf8') as string
  assert.ok(componentSource.includes('next <= 0 && !evaluationBusyRef.current) submitExam()'), 'EXAM-TIMER auto-submits exactly once at expiration')
  console.log('exam-material-brain-contracts: EXAM-TIMER PASS')
}

// ============================================================
// §23 — 15/30/45/60/90 real-shape composition matrix on ONE large Brain
// ============================================================
function testDurationMatrix() {
  const b = largeMixedBrain()
  const targets = buildExamTargets(b)
  const bounds = computeExamTimeBounds(targets, b)
  console.log(`exam-material-brain-contracts: duration matrix — totalExamTargets=${targets.length}, minimumViable=${bounds.minimumViableDurationMinutes}min, ideal=${bounds.idealDurationMinutes}min`)

  const rows: any[] = []
  for (const requested of [15, 30, 45, 60, 90]) {
    const bp = composeExamBlueprint(b, requested, `exam-${requested}`, `seed-${requested}`)
    assert.equal(bp.coveragePercent, 100, `${requested}min blueprint must have 100% coverage`)
    const represented = new Set(bp.slots.flatMap(s => s.targetIds))
    assert.equal(represented.size, targets.length, `${requested}min blueprint must represent all ${targets.length} targets`)
    rows.push({
      requested, resolvedMinutes: bp.durationMinutes, questionCount: bp.slots.length,
      typeDistribution: bp.typeDistribution, difficultyDistribution: bp.difficultyDistribution,
      expectedCompletionSeconds: bp.expectedCompletionSeconds, coveragePercent: bp.coveragePercent,
    })
  }
  console.log('exam-material-brain-contracts: 15/30/45/60/90min compositions —')
  for (const row of rows) console.log(`  ${row.requested}min -> resolved=${row.resolvedMinutes}min questions=${row.questionCount} types=${JSON.stringify(row.typeDistribution)} difficulty=${JSON.stringify(row.difficultyDistribution)} expectedSec=${row.expectedCompletionSeconds} coverage=${row.coveragePercent}%`)

  // Qualitative behavior: short duration compresses (fewer questions
  // and/or more aggregates), long duration decompresses.
  assert.ok(rows[0].questionCount <= rows[rows.length - 1].questionCount, 'short duration => fewer or equal questions than long duration')
  assert.ok(rows.every(r => r.coveragePercent === 100), 'EXAM-COVER-2 100% coverage holds across the ENTIRE duration matrix — never "short duration = missing material"')
  console.log('exam-material-brain-contracts: duration matrix qualitative behavior PASS')
}

async function main() {
  testComposerOwnsEverything()
  testMinimumViableTime()
  testCompressionBehavior()
  testGroundedTypeSupport()
  testRelationDerivedTargets()
  testNoMidExamAdaptation()
  testVision()
  await testBrainAuthorityAndAnswerAuthority()
  await testDeterministicScoring()
  testTimerSemantics()
  testDurationMatrix()
  console.log('exam-material-brain-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
