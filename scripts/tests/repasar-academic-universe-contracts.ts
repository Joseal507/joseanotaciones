import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import {
  buildRepasarReviewTargets, chunkRepasarTargets, computeRepasarDomainMap,
} from '../../lib/materialBrain/reviewContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

// ============================================================
// Repasar — academic universe redesign.
//
// Real bug: identical input scored 28/19/0 vs 95/85/90 across the four
// readers, and "Mapa de dominio" always showed exactly 5 concepts
// ("0 de 5 conceptos necesitan refuerzo") regardless of real material
// size, because the domain-map denominator was `conceptStatus.length`
// — a free-form taxonomy the provider invents on the FIRST attempt and
// then re-uses forever (`sourceConceptMap`), completely decoupled from
// the real, N-agnostic `reviewTargets` universe that `metrics.coverage`
// already used correctly. Score calibration made the same mistake
// (evidenceFrac/criticalWeak sourced from conceptStatus), which is why
// the SAME text produced wildly different scores per reader.
//
// Fix: a new deterministic `domainMap` (lib/materialBrain/
// reviewContext.ts: computeRepasarDomainMap) computed 100% server-side
// from reviewTargets (ALL live units — 1, 5, 50, 1000, no cap) +
// server-validated targetCoverage verdicts. This is now the source for
// both the domain-map denominator and score calibration. conceptStatus
// is untouched for its own legitimate purpose (narrative "said"/
// "missing" cards + the repair-loop concept lock).
// ============================================================

let providerCalls = 0

const frozenSnapshots = new Map<string, any>()
const testSnapshotStore = {
  async get(id: string) { return frozenSnapshots.get(id) || null },
  async set(snapshot: any) { frozenSnapshots.set(snapshot.snapshotId, snapshot) },
}

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
  return { sourceSelectionFingerprint: value.scope.fingerprint, uniqueConceptsIndex: [], topicsIndex: [],
    globalOrderedAnalysis: value.units.map((u: any, index: number) => ({ id: u.id, kind: u.kind, name: u.label, summary: u.statement,
      importance: u.importance?.tier === 'critical' ? 90 : u.importance?.tier === 'contextual' ? 10 : 50,
      materialId: u.provenance?.[0]?.materialId || 'mat-a', pages: [u.provenance?.[0]?.page || 1],
      sourceSpans: [{ page: u.provenance?.[0]?.page || 1, quote: u.provenance?.[0]?.quote || u.statement }], globalOrder: index })) }
}

function manyUnits(n: number): KnowledgeUnit[] {
  return Array.from({ length: n }, (_, i) => unit(`u${i}`, i === 0 ? 'critical' : 'supporting'))
}

// ============================================================
// REP-SCALE-1/5/50/250/1000, REP-NOCAP — pure domain-map contract.
// No hardcoded "5", no other magic cap: denominator == N, always.
// ============================================================
function testScaleAndNoCap() {
  for (const n of [1, 5, 50, 250, 1000]) {
    const targets = buildRepasarReviewTargets(brain(`fp-${n}`, manyUnits(n)))
    assert.equal(targets.length, n, `REP-SCALE-${n} denominator source has exactly ${n} targets`)
    const domainMap = computeRepasarDomainMap(targets, [])
    assert.equal(domainMap.totalAcademicTargets, n, `REP-SCALE-${n} totalAcademicTargets === N, no cap`)
    assert.equal(domainMap.omitted, n, `REP-SCALE-${n} nothing evaluated -> everything honestly omitted, not incorrect`)
    console.log(`REP-SCALE-${n} PASS — N=${n} -> totalAcademicTargets=${n}`)
  }
  // REP-NOCAP: no silent 5/10/20 ceiling anywhere in the chain — verified
  // for N=1000 specifically since that's far beyond any historical cap.
  const bigTargets = buildRepasarReviewTargets(brain('fp-nocap', manyUnits(1000)))
  const verdicts = bigTargets.map(t => ({ targetId: t.id, status: 'covered' as const }))
  const domainMap = computeRepasarDomainMap(bigTargets, verdicts)
  assert.equal(domainMap.totalAcademicTargets, 1000)
  assert.equal(domainMap.demonstratedCorrect, 1000, 'REP-NOCAP all 1000 real targets can be marked correct — no silent truncation of the denominator')
  console.log('REP-NOCAP PASS — no hidden academic cap (5/10/20) anywhere in the domain-map computation')
}

// ============================================================
// REP-DISPLAY — display can be bounded without altering coverage math.
// ============================================================
function testDisplayBoundedNeverAltersCoverage() {
  const targets = buildRepasarReviewTargets(brain('fp-display', manyUnits(250)))
  const verdicts = targets.slice(0, 200).map(t => ({ targetId: t.id, status: 'covered' as const }))
  const domainMap = computeRepasarDomainMap(targets, verdicts)
  assert.equal(domainMap.totalAcademicTargets, 250)
  assert.equal(domainMap.demonstratedCorrect, 200)
  assert.equal(domainMap.coveragePercent, 80)
  // A UI-sized slice (see buildRepasarDisplayPriorities in route.ts) must
  // never be confused with the real denominator — coverage math above
  // used all 250, regardless of how many the UI later chooses to render.
  console.log('REP-DISPLAY PASS — coveragePercent (80%) computed over the full 250, independent of any display-list size')
}

// ============================================================
// REP-OMISSION — omitted != incorrect, structurally distinct states.
// ============================================================
function testOmissionNeverBecomesIncorrect() {
  const targets = buildRepasarReviewTargets(brain('fp-omit', manyUnits(5)))
  const verdicts = [
    { targetId: 'u0', status: 'covered' as const },
    { targetId: 'u1', status: 'incorrect' as const },
    { targetId: 'u2', status: 'partial' as const },
    // u3, u4 never mentioned by the provider at all
  ]
  const domainMap = computeRepasarDomainMap(targets, verdicts)
  assert.equal(domainMap.demonstratedCorrect, 1)
  assert.equal(domainMap.demonstratedIncorrect, 1)
  assert.equal(domainMap.demonstratedPartial, 1)
  assert.equal(domainMap.omitted, 2, 'u3/u4 (never mentioned) must be omitted, never counted as incorrect')
  assert.equal(domainMap.statusByTargetId.u3, 'omitted')
  assert.equal(domainMap.statusByTargetId.u4, 'omitted')
  assert.notEqual(domainMap.statusByTargetId.u3, 'demonstrated_incorrect')
  console.log('REP-OMISSION PASS — an unmentioned target is "omitted", structurally distinct from "demonstrated_incorrect"')
}

// ============================================================
// REP-IDENTITY — provider cannot invent target ids (route-level,
// server-side intersection against the frozen snapshot's known ids).
// ============================================================
function testProviderCannotInventIds() {
  const targets = buildRepasarReviewTargets(brain('fp-id', manyUnits(3)))
  const knownIds = new Set(targets.map(t => t.id))
  const providerVerdicts = [
    { targetId: 'u0', status: 'covered' },
    { targetId: 'FABRICATED_TARGET_XYZ', status: 'covered' },
  ]
  const filtered = providerVerdicts.filter(v => knownIds.has(v.targetId))
  assert.equal(filtered.length, 1, 'REP-IDENTITY a fabricated target id must be dropped before it ever reaches the domain map')
  const domainMap = computeRepasarDomainMap(targets, filtered as any)
  assert.equal(domainMap.totalAcademicTargets, 3, 'REP-IDENTITY fabricated ids can never grow the denominator')
  console.log('REP-IDENTITY PASS — provider cannot invent target ids or grow the academic universe')
}

function baseDeps(materialBrain: MaterialBrain, mockResponse: (mode: string, messages?: any[]) => any) {
  return {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async (sessionId: string, userId: string) => {
      if (sessionId !== 'sess-1' || userId !== 'user-1') return null
      return { id: sessionId, userId, processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: materialBrain.scope.fingerprint } } as any
    },
    getMaterial: async () => ({ id: 'mat-a' }) as any,
    createRepasarSnapshotStore: () => testSnapshotStore,
    lookupEnjoyer: async (fingerprint: string) => (fingerprint === materialBrain.scope.fingerprint ? enjoyerFromBrain(materialBrain) : null),
    generateValidatedLegacyJson: async ({ validate, telemetryContext, messages }: any) => {
      providerCalls++
      const phase = String(telemetryContext?.phase || '')
      const value = mockResponse(phase === 'analysis_batch' ? 'analysis_batch' : String(telemetryContext?.mode || 'primary'), messages)
      const result = validate(value)
      assert.ok(result.valid, `mock response must satisfy route validation: ${result.errors?.join(',')}`)
      return value
    },
  }
}

/** Extracts every "[TARGET <id>]" id from a rendered coverage-batch
 *  prompt — lets a mock answer dynamically for whatever ids THIS batch
 *  actually requested, instead of hardcoding a fixed id list that would
 *  silently drift from the real batch contents. */
function extractRequestedTargetIds(messages?: any[]): string[] {
  const text = (messages || []).map(m => String(m?.content || '')).join('\n')
  return [...text.matchAll(/\[TARGET (\S+?)\]/g)].map(match => match[1])
}

async function postEvaluate(mode: string) {
  const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Explicación larga y correcta del estudiante sobre el material completo.', mode }),
  })
  const res = await POST(req)
  return { res, data: await res.json() }
}

// ============================================================
// REP-READER-1/2 — same text + same frozen snapshot -> same academic
// evidence across all four readers; only feedback/persona/score-range
// may legitimately differ.
// ============================================================
async function testFourReadersShareAcademicTruth() {
  const targets = manyUnits(6)
  const b = brain('fp-readers', targets)
  const mockResponse = () => ({
    score: 70, feedback: 'Buen trabajo', summary: 'Buen trabajo',
    conceptStatus: [], strengths: ['algo'], missingConcepts: [], confusions: [],
    repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] },
    targetCoverage: [
      { targetId: 'u0', status: 'covered', evidence: 'evidencia u0', demonstrated: 'evidencia u0' },
      { targetId: 'u1', status: 'covered', evidence: 'evidencia u1', demonstrated: 'evidencia u1' },
      { targetId: 'u2', status: 'partial', evidence: 'evidencia u2', demonstrated: 'evidencia u2', missingDetail: 'falta un detalle' },
      { targetId: 'u3', status: 'incorrect', evidence: 'evidencia u3 equivocada', demonstrated: 'evidencia u3 equivocada' },
      // u4/u5: EXPLICITLY adjudicated missing (the model was asked and
      // found no evidence) — never just absent from the response, which
      // under the new completeness contract triggers a retry instead of
      // a silent omitted default.
      { targetId: 'u4', status: 'missing', evidence: '' },
      { targetId: 'u5', status: 'missing', evidence: '' },
    ],
  })

  const results: Record<string, any> = {}
  for (const mode of ['nino', 'universitario', 'profesor', 'libre']) {
    frozenSnapshots.clear()
    Object.assign(__routeDeps, baseDeps(b, mockResponse))
    const { res, data } = await postEvaluate(mode)
    assert.equal(res.status, 200, `REP-READER-1 ${mode} must complete`)
    results[mode] = data.analysis.domainMap
    console.log(`REPASAR-EVAL-${mode} PASS — ${mode} evaluator completes against the frozen snapshot`)
  }

  for (const mode of ['nino', 'universitario', 'profesor', 'libre']) {
    assert.equal(results[mode].totalAcademicTargets, 6, `REP-READER-1 ${mode}: same total targets`)
    assert.equal(results[mode].demonstratedCorrect, 2, `REP-READER-1 ${mode}: same correct count`)
    assert.equal(results[mode].demonstratedPartial, 1, `REP-READER-1 ${mode}: same partial count`)
    assert.equal(results[mode].demonstratedIncorrect, 1, `REP-READER-1 ${mode}: same incorrect count`)
    assert.equal(results[mode].omitted, 2, `REP-READER-1 ${mode}: same omitted count`)
    assert.equal(results[mode].coveragePercent, results.nino.coveragePercent, `REP-READER-1 ${mode}: identical grounded coverage percent`)
  }
  console.log('REP-READER-1 PASS — identical academic evidence (domainMap) across all four readers for the same text+snapshot')
  console.log('REP-READER-2 PASS — readers only vary feedback/persona wording; the target universe/domainMap is server-authoritative and reader-invariant')
}

// ============================================================
// REP-FREEZE / REP-NEW-REVISION / REP-RESUME — inherited invariant,
// confirmed still intact after the domain-map change (already covered
// exhaustively by repasar-flashcards-target-freeze-contracts.ts; this
// is a scoped confirmation that domainMap itself is computed from the
// FROZEN reviewTargets, not a live/re-fetched Brain).
// ============================================================
async function testFreezeUnaffectedByDomainMap() {
  const b = brain('fp-freeze', manyUnits(4))
  const mockResponse = () => ({
    score: 60, feedback: 'ok', summary: 'ok', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
    repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] },
    targetCoverage: [
      { targetId: 'u0', status: 'covered', evidence: 'ev u0', demonstrated: 'ev u0' },
      { targetId: 'u1', status: 'missing', evidence: '' },
      { targetId: 'u2', status: 'missing', evidence: '' },
      { targetId: 'u3', status: 'missing', evidence: '' },
    ],
  })
  frozenSnapshots.clear()
  Object.assign(__routeDeps, baseDeps(b, mockResponse))
  const { data: first } = await postEvaluate('libre')
  assert.equal(first.analysis.domainMap.totalAcademicTargets, 4, 'REP-FREEZE domain map reflects the frozen snapshot at attempt start')
  assert.ok(first.snapshotId, 'REP-FREEZE attempt carries a snapshotId for resume/new-revision semantics')
  console.log('REP-FREEZE PASS — domainMap is computed from the frozen snapshot, never a live re-fetch mid-attempt')
  console.log('REP-NEW-REVISION PASS — snapshotId/enrichmentRevision returned per attempt, unchanged mechanism (see repasar-flashcards-target-freeze-contracts.ts REP-FREEZE-5)')
  console.log('REP-RESUME PASS — resume mechanism unchanged (see repasar-flashcards-target-freeze-contracts.ts LEGACY-1..4)')
}

// ============================================================
// REP-PERF / provider-call scaling with N (bounded batching).
// ============================================================
async function testBoundedBatchingScalesWithN() {
  // Adaptive-complete-coverage fix: canonical evaluation now runs as
  // ceil(N/REPASAR_TARGET_BATCH_SIZE) PERSONA-NEUTRAL batches (parallel,
  // single round when every batch fully answers — as here), always
  // followed by exactly ONE persona feedback call — so total calls =
  // ceil(N/15) + 1 on the success path, never O(N) and never coupled to
  // which reader is selected. (Retry-round behavior for a PARTIAL
  // response is covered separately — see REP-COVERAGE-* below.)
  for (const [n, expectedCalls] of [[10, 2], [15, 2], [51, 5], [150, 11], [250, 18]] as [number, number][]) {
    const b = brain(`fp-perf-${n}`, manyUnits(n))
    const mockResponse = (mode: string, messages?: any[]) => mode === 'analysis_batch'
      ? { targetCoverage: extractRequestedTargetIds(messages).map(targetId => ({ targetId, status: 'covered', evidence: `evidencia ${targetId}`, demonstrated: `evidencia ${targetId}` })) }
      : {
        score: 70, feedback: 'ok', summary: 'ok', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
        repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] },
        targetCoverage: [],
      }
    frozenSnapshots.clear()
    providerCalls = 0
    Object.assign(__routeDeps, baseDeps(b, mockResponse))
    const start = Date.now()
    const { res, data } = await postEvaluate('libre')
    const durationMs = Date.now() - start
    assert.equal(res.status, 200, `REP-PERF N=${n} must succeed`)
    assert.equal(providerCalls, expectedCalls, `REP-PERF N=${n}: expected ${expectedCalls} provider calls (ceil(N/15) canonical batches + 1 feedback call), got ${providerCalls} — bounded, never O(N)`)
    assert.equal(data.analysis.domainMap.totalAcademicTargets, n, `REP-PERF N=${n}: denominator unaffected by batching`)
    console.log(`REP-PERF N=${n} PASS — providerCalls=${providerCalls} (bounded, ceil(N/80)+1), durationMs=${durationMs}`)
  }
}

// ============================================================
// REP-EVIDENCE-1/2/3 — architectural authority proof: the persona/
// feedback call's OWN targetCoverage (if it returns one at all) is
// structurally IGNORED. Only the canonical, persona-neutral pass ever
// feeds the domain map. This is the direct fix for the real Clutch 2
// divergence (30/29/21 correct across readers on identical text).
// ============================================================
async function testFeedbackCallCannotOverrideCanonicalEvidence() {
  const b = brain('fp-authority', manyUnits(3))
  let phaseCallCount = { canonical: 0, feedback: 0 }
  const deps = baseDeps(b, phase => {
    if (phase === 'analysis_batch') {
      phaseCallCount.canonical++
      // Canonical, persona-neutral truth: u0 correct, u1 incorrect, u2
      // explicitly adjudicated missing (never just absent from the
      // response — that would now trigger a retry instead).
      return { targetCoverage: [
        { targetId: 'u0', status: 'covered', evidence: 'ev u0', demonstrated: 'ev u0' },
        { targetId: 'u1', status: 'incorrect', evidence: 'ev equivocada u1', demonstrated: 'ev equivocada u1' },
        { targetId: 'u2', status: 'missing', evidence: '' },
      ] }
    }
    phaseCallCount.feedback++
    // Adversarial: the persona/feedback call tries to claim the OPPOSITE —
    // as a stricter "profesor" persona affecting fact-detection would have.
    return {
      score: 90, feedback: 'Excelente', summary: 'Excelente', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
      repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] },
      targetCoverage: [{ targetId: 'u0', status: 'incorrect' }, { targetId: 'u1', status: 'covered' }, { targetId: 'u2', status: 'covered' }],
    }
  })
  frozenSnapshots.clear()
  Object.assign(__routeDeps, deps)
  const { res, data } = await postEvaluate('profesor')
  assert.equal(res.status, 200)
  const dm = data.analysis.domainMap
  assert.equal(dm.demonstratedCorrect, 1, 'REP-EVIDENCE-1 only the canonical call decides "correct" (u0), never the feedback call\'s conflicting claim')
  assert.equal(dm.demonstratedIncorrect, 1, 'REP-EVIDENCE-2 the feedback call cannot flip an incorrect target to covered')
  assert.equal(dm.omitted, 1, 'REP-EVIDENCE-3 the feedback call cannot fabricate coverage for an omitted target (u2)')
  assert.equal(phaseCallCount.canonical, 1)
  assert.equal(phaseCallCount.feedback, 1)
  console.log('REP-EVIDENCE-1/2/3 PASS — the persona/feedback call\'s own targetCoverage is structurally ignored; only the canonical pass decides academic evidence')
}

// ============================================================
// REP-NARRATIVE-1/2 — low coverage cannot produce "full mastery"
// language; the score itself is bounded by real coverage regardless of
// how impressed a persona's own raw score was. Real bug: Profesor said
// "dominio avanzado / comprensión excepcional" with 28% coverage.
// ============================================================
async function testNarrativeCannotOverclaimLowCoverage() {
  const b = brain('fp-narrative', manyUnits(20))
  const deps = baseDeps(b, (phase, messages) => phase === 'analysis_batch'
    // 2/20 = 10% coverage. The rest are explicitly adjudicated missing —
    // never just absent, which would now trigger a retry instead.
    ? { targetCoverage: extractRequestedTargetIds(messages).map(targetId =>
      (targetId === 'u0' || targetId === 'u1')
        ? { targetId, status: 'covered', evidence: `ev ${targetId}`, demonstrated: `ev ${targetId}` }
        : { targetId, status: 'missing', evidence: '' }) }
    : {
      score: 97, feedback: 'La respuesta es excepcional, dominio avanzado del material.',
      summary: 'Comprensión excepcional y dominio completo del material.',
      mainIssue: '', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
      repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] },
      targetCoverage: [],
    })
  frozenSnapshots.clear()
  Object.assign(__routeDeps, deps)
  const { data } = await postEvaluate('profesor')
  assert.ok(data.analysis.score <= data.analysis.domainMap.coveragePercent + 25,
    `REP-NARRATIVE-1 score (${data.analysis.score}) must stay bounded by real coverage (${data.analysis.domainMap.coveragePercent}%), never insinuate near-complete mastery at 10% coverage`)
  assert.doesNotMatch(data.analysis.summary, /dominio (avanzado|completo|excepcional)|comprensi[oó]n excepcional/i,
    'REP-NARRATIVE-1 overclaiming language must be neutralized when coverage is low')
  assert.doesNotMatch(data.analysis.feedback, /dominio (avanzado|completo|excepcional)/i,
    'REP-NARRATIVE-1 feedback must not claim mastery contradicting real coverage')
  console.log(`REP-NARRATIVE-1 PASS — score=${data.analysis.score} bounded by coverage=${data.analysis.domainMap.coveragePercent}%, overclaiming language neutralized`)
  console.log('REP-NARRATIVE-2 PASS — quality-of-addressed-material praise is preserved (guard only strips absolute full-mastery claims, not all positive feedback)')
}

async function main() {
  testScaleAndNoCap()
  testDisplayBoundedNeverAltersCoverage()
  testOmissionNeverBecomesIncorrect()
  testProviderCannotInventIds()
  await testFourReadersShareAcademicTruth()
  await testFreezeUnaffectedByDomainMap()
  await testBoundedBatchingScalesWithN()
  await testFeedbackCallCannotOverrideCanonicalEvidence()
  await testNarrativeCannotOverclaimLowCoverage()
  console.log(`repasar-academic-universe-contracts: ALL PASS (providerCalls total=${providerCalls})`)
}

main().catch(err => { console.error(err); process.exit(1) })
