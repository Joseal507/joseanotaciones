import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps, REPASAR_TARGET_BATCH_SIZE } from '../../app/api/alai-studyal-repasar/route'

// ============================================================
// ADAPTIVE COMPLETE COVERAGE OVER THE ENTIRE ENJOYER UNIVERSE.
//
// Live bug: 51 requested targets, first provider response returned only
// 11 valid verdicts -> the other 40 silently defaulted to "omitted"
// ("no aparecieron"), even though the provider was simply never asked
// again for them. That is a TRANSPORT failure (the provider didn't
// answer), not an ACADEMIC verdict (the provider explicitly judged
// "missing") — and the two were being conflated.
//
// Fix: resolveRepasarCoverage (route.ts) loops in bounded rounds,
// re-requesting ONLY the still-unadjudicated targets each round, until
// either every canonical target has an explicit verdict or
// REPASAR_MAX_ADJUDICATION_ROUNDS is exhausted (-> explicit
// REPASAR_COVERAGE_INCOMPLETE_RETRYABLE error, never a fabricated
// domainMap). This suite proves that loop is dynamic, deterministic, and
// N-agnostic — 1, 10, 51, 150 targets all reach exactly 100% adjudication
// or an explicit, honest failure.
// ============================================================

const selection = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] })

function payloadWithN(n: number) {
  return {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic-1', title: 'Tema', order: 0 }],
    globalOrderedAnalysis: Array.from({ length: n }, (_, i) => ({
      id: `u${i}`, kind: 'concept', name: `Concepto ${i}`, summary: `Contenido autorizado ${i}`,
      importance: 60, materialId: 'mat-a', pages: [1],
      sourceSpans: [{ page: 1, quote: `Cita ${i}` }], topicId: 'topic-1', globalOrder: i,
    })),
    uniqueConceptsIndex: [],
  }
}

function extractRequestedTargetIds(messages: any[]): string[] {
  const text = (messages || []).map((m: any) => String(m?.content || '')).join('\n')
  return [...text.matchAll(/\[TARGET (\S+?)\]/g)].map(match => match[1])
}

/** coverageFn(requestedIds, callIndex) -> raw targetCoverage entries for
 *  THIS provider call. Lets each test script exactly which ids get
 *  answered on which round/call, independent of real batch chunking. */
function installMocks(coverageFn: (requestedIds: string[], callIndex: number) => any[]) {
  const snapshots = new Map<string, any>()
  let analysisBatchCallIndex = 0
  let totalProviderCalls = 0
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }),
    getAuthoritativeFreeSession: async () => ({ id: 'sess-dyn', userId: 'user-1', processMode: 'free', sourceSelection: selection }),
    getMaterial: async () => ({ id: 'mat-a' }),
    lookupEnjoyer: async (fingerprint: string) => (fingerprint === selection.fingerprint ? payloadFor : null),
    createRepasarSnapshotStore: () => ({
      async get(id: string) { return snapshots.get(id) || null },
      async set(snapshot: any) { snapshots.set(snapshot.snapshotId, snapshot) },
    }),
    generateValidatedLegacyJson: async ({ telemetryContext, validate, messages }: any) => {
      totalProviderCalls++
      if (telemetryContext?.phase === 'analysis_batch') {
        const requestedIds = extractRequestedTargetIds(messages)
        const value = { targetCoverage: coverageFn(requestedIds, analysisBatchCallIndex++) }
        assert.equal(validate(value).valid, true)
        return value
      }
      const value = {
        score: 50, feedback: 'ok', summary: 'ok', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
        repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [], targetIds: [] },
      }
      assert.equal(validate(value).valid, true)
      return value
    },
  })
  return { getAnalysisBatchCallCount: () => analysisBatchCallIndex, getTotalProviderCalls: () => totalProviderCalls }
}

let payloadFor: any

async function evaluateWithN(n: number, coverageFn: (requestedIds: string[], callIndex: number) => any[]) {
  payloadFor = payloadWithN(n)
  const mocks = installMocks(coverageFn)
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-dyn', explanation: 'Explicación de prueba suficientemente larga.', mode: 'libre' }),
  }))
  const data = await response.json()
  return { response, data, ...mocks }
}

const fullCoverage = (requestedIds: string[]) =>
  requestedIds.map(targetId => ({ targetId, status: 'covered', evidence: `ev ${targetId}`, demonstrated: `ev ${targetId}` }))

async function testA_10Targets() {
  const { response, data } = await evaluateWithN(10, fullCoverage)
  assert.equal(response.status, 200)
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 10)
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 10)
  console.log('repasar-dynamic-universe: A (10 targets) PASS')
}

async function testB_51Targets() {
  const { response, data, getAnalysisBatchCallCount } = await evaluateWithN(51, fullCoverage)
  assert.equal(response.status, 200)
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 51, 'B: exactly 51 adjudicated targets for a 51-target material')
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 51)
  assert.equal(getAnalysisBatchCallCount(), Math.ceil(51 / REPASAR_TARGET_BATCH_SIZE), 'B: processed across the expected number of batches')
  console.log(`repasar-dynamic-universe: B (51 targets, ${getAnalysisBatchCallCount()} canonical calls) PASS`)
}

async function testC_150Targets() {
  const { response, data, getAnalysisBatchCallCount } = await evaluateWithN(150, fullCoverage)
  assert.equal(response.status, 200)
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 150, 'C: exactly 150 adjudicated targets for a 150-target material')
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 150)
  assert.equal(getAnalysisBatchCallCount(), Math.ceil(150 / REPASAR_TARGET_BATCH_SIZE), 'C: as many batches as needed, no hardcoded total concept limit')
  console.log(`repasar-dynamic-universe: C (150 targets, ${getAnalysisBatchCallCount()} canonical calls) PASS`)
}

async function testD_firstBatchPartiallyReturns() {
  // 20 targets, batch size forces 2 batches (15 + 5). Simulate the FIRST
  // analysis_batch call (round 1, first chunk) answering only half its
  // own requested ids; the retry round must fill in exactly the rest.
  const { response, data } = await evaluateWithN(20, (requestedIds, callIndex) => {
    if (callIndex === 0) return requestedIds.slice(0, Math.ceil(requestedIds.length / 2)).map(id => ({ targetId: id, status: 'covered', evidence: `ev ${id}`, demonstrated: `ev ${id}` }))
    return fullCoverage(requestedIds)
  })
  assert.equal(response.status, 200, 'D: eventually completes once the retry round fills the gap')
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 20)
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 20, 'D: completed verdicts from round 1 are preserved, only the absent ids were retried')
  console.log('repasar-dynamic-universe: D (first batch partial, retry completes) PASS')
}

async function testE_multipleBatchesPartiallyReturn() {
  // 40 targets across multiple batches; EVERY batch in round 1 answers
  // only 60% of its own requested ids. The loop must keep narrowing
  // across rounds until complete, with no fabricated academic "missing".
  const { response, data } = await evaluateWithN(40, (requestedIds, callIndex) => {
    const answerCount = callIndex < Math.ceil(40 / REPASAR_TARGET_BATCH_SIZE)
      ? Math.ceil(requestedIds.length * 0.6)
      : requestedIds.length
    return requestedIds.slice(0, answerCount).map(id => ({ targetId: id, status: 'covered', evidence: `ev ${id}`, demonstrated: `ev ${id}` }))
  })
  assert.equal(response.status, 200, 'E: the loop continues correctly across multiple partially-returning batches')
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 40)
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 40, 'E: no academic "missing" fabricated for a target that simply needed another round')
  console.log('repasar-dynamic-universe: E (multiple partial batches, eventually complete) PASS')
}

async function testF_duplicateProviderIdsDoNotInflateCompletion() {
  // A response where the SAME target id appears twice is a semantic
  // anomaly (which of the two conflicting verdicts is real?) — the
  // stricter batch-semantics boundary now REJECTS such a duplicated id
  // entirely rather than silently accepting the first occurrence, so it
  // is retried instead of ever being double-counted. This mock duplicates
  // only on the FIRST call (proving the anomaly is detected and does not
  // corrupt the result), then answers cleanly on retry so completion is
  // still reached.
  const { response, data } = await evaluateWithN(5, (requestedIds, callIndex) =>
    callIndex === 0
      ? [...requestedIds, ...requestedIds].map(id => ({ targetId: id, status: 'covered', evidence: `ev ${id}`, demonstrated: `ev ${id}` }))
      : requestedIds.map(id => ({ targetId: id, status: 'covered', evidence: `ev ${id}`, demonstrated: `ev ${id}` })))
  assert.equal(response.status, 200)
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 5)
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 5, 'F: duplicate ids from the provider do not inflate the completed count')
  console.log('repasar-dynamic-universe: F (duplicate provider ids) PASS')
}

async function testG_unknownProviderIdIgnored() {
  const { response, data } = await evaluateWithN(5, (requestedIds, callIndex) => {
    if (callIndex === 0) {
      return [
        ...requestedIds.slice(0, 4).map(id => ({ targetId: id, status: 'covered', evidence: `ev ${id}`, demonstrated: `ev ${id}` })),
        { targetId: 'FABRICATED_TARGET_XYZ', status: 'covered', evidence: 'fabricada', demonstrated: 'fabricada' },
        // the 5th real target ('u4') is deliberately left unanswered this round
      ]
    }
    return fullCoverage(requestedIds)
  })
  assert.equal(response.status, 200, 'G: the real 5th target gets adjudicated in the retry round')
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 5, 'G: a fabricated id never grows the denominator')
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 5)
  console.log('repasar-dynamic-universe: G (unknown provider id ignored, real target retried) PASS')
}

async function testH_retryExhaustionExplicitError() {
  // One target (u2 of 5) NEVER receives a valid verdict, across every round.
  const { response, data } = await evaluateWithN(5, (requestedIds) =>
    requestedIds.filter(id => id !== 'u2').map(id => ({ targetId: id, status: 'covered', evidence: `ev ${id}`, demonstrated: `ev ${id}` })))
  assert.equal(response.status, 409, 'H: retry ceiling exhausted -> explicit retryable failure, never a fake-complete 200')
  assert.equal(data.error, 'REPASAR_COVERAGE_INCOMPLETE_RETRYABLE')
  assert.equal(data.totalTargets, 5)
  assert.equal(data.adjudicatedCount, 4)
  assert.deepEqual(data.remainingTargetIds, ['u2'])
  console.log('repasar-dynamic-universe: H (retry exhaustion -> explicit error, no fake domain map) PASS')
}

async function testI_singleTarget() {
  const { response, data } = await evaluateWithN(1, fullCoverage)
  assert.equal(response.status, 200)
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 1, 'I: a single-target material works correctly')
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 1)
  console.log('repasar-dynamic-universe: I (1 target) PASS')
}

async function testJ_sizeNotDivisibleByBatchSize() {
  // 31 is not a multiple of REPASAR_TARGET_BATCH_SIZE (15) -> final
  // batch is a small remainder (1).
  const { response, data, getAnalysisBatchCallCount } = await evaluateWithN(31, fullCoverage)
  assert.equal(response.status, 200)
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 31, 'J: a remainder-sized final batch still fully adjudicates')
  assert.equal(getAnalysisBatchCallCount(), Math.ceil(31 / REPASAR_TARGET_BATCH_SIZE))
  console.log('repasar-dynamic-universe: J (31 targets, non-divisible remainder) PASS')
}

async function testCanonicalOrderPreservedAcrossRoundsAndBatches() {
  // Deliberately answer targets out of order and across two rounds; the
  // final combined verdict order must still follow canonical Enjoyer
  // source order (u0, u1, u2, ...), never batch/round/response order.
  const { data } = await evaluateWithN(10, (requestedIds, callIndex) => {
    const ids = callIndex === 0 ? [...requestedIds].reverse() : requestedIds
    return ids.map(id => ({ targetId: id, status: 'covered', evidence: `ev ${id}`, demonstrated: `ev ${id}` }))
  })
  const orderedIds = [...data.analysis.domainMap.strengths].map((s: any) => s.id)
  // Display priorities are importance-ranked/bounded, but for a uniform
  // importance set they preserve source order among ties.
  const sorted = [...orderedIds].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  assert.deepEqual(orderedIds, sorted, 'canonical Enjoyer source order preserved regardless of provider response ordering')
  console.log('repasar-dynamic-universe: CANONICAL-ORDER PASS')
}

async function main() {
  await testA_10Targets()
  await testB_51Targets()
  await testC_150Targets()
  await testD_firstBatchPartiallyReturns()
  await testE_multipleBatchesPartiallyReturn()
  await testF_duplicateProviderIdsDoNotInflateCompletion()
  await testG_unknownProviderIdIgnored()
  await testH_retryExhaustionExplicitError()
  await testI_singleTarget()
  await testJ_sizeNotDivisibleByBatchSize()
  await testCanonicalOrderPreservedAcrossRoundsAndBatches()
  console.log('repasar-dynamic-universe-coverage-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
