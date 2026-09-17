import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* STUDYAL — REPASO FINAL LIVE BLOCKER: SESSION_AUTHORITY_FAILED:503     */
/* ON CONTINUE                                                          */
/*                                                                      */
/* Root cause: resolveRepasarEnjoyerAuthority re-fetches session         */
/* authority (getAuthoritativeFreeSession -> external STUDYAL_API_URL   */
/* dependency) on EVERY continuation request, even against an already-  */
/* persisted RepasoArtifact. A transient 5xx from that dependency threw  */
/* uncaught, hit the outer catch-all, and surfaced as an opaque 500 —    */
/* fully blocking Continue on an otherwise-healthy run, even though the */
/* SAME session id had just been authorized moments earlier for the     */
/* preceding answer request.                                            */
/*                                                                      */
/* Fix: a single, immediate, same-request retry of the SAME             */
/* authoritative check (getAuthoritativeFreeSessionWithTransientRetry)  */
/* — scoped locally to this route, `getAuthoritativeFreeSession` itself */
/* (shared by Quiz/Exam/StudyMap/Chat) is untouched — plus mapping a     */
/* still-failing transient shape to 503 (not 500) so the client knows   */
/* nothing was mutated and the exact same request is safe to retry.     */
/* ------------------------------------------------------------------ */

function harness(sessionId: string, selection: any, payload: any, generate: (input: any) => Promise<any>, authorityImpl: (sessionId: string, userId: string) => Promise<any>) {
  const snapshots = new Map<string, any>()
  const artifacts = new Map<string, any>()
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }),
    getAuthoritativeFreeSession: authorityImpl,
    getMaterial: async () => ({ id: selection.materialIds[0] }),
    lookupEnjoyer: async (fingerprint: string) => (fingerprint === selection.fingerprint ? payload : null),
    createRepasarSnapshotStore: () => ({
      async get(id: string) { return snapshots.get(id) || null },
      async set(snapshot: any) { snapshots.set(snapshot.snapshotId, snapshot) },
    }),
    createRepasoArtifactStore: () => ({
      async get(id: string) { return artifacts.get(id) || null },
      async set(artifact: any) { artifacts.set(artifact.artifactId, artifact) },
    }),
    generateValidatedLegacyJson: generate,
  })
  return artifacts
}

async function post(sessionId: string, body: Record<string, unknown>) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, ...body }),
  }))
  return { response, data: await response.json() }
}

function initialCoverageMock(targets: any[]) {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return { targetCoverage: targets.map(t => ({ targetId: t.id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '' })) }
    }
    throw new Error('unexpected provider call during initial diagnosis')
  }
}

function refuseQuestionAuthoringProvider() {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'repaso_recovery_question') throw new Error('question-authoring provider must not be called')
    throw new Error('unexpected provider call at open time')
  }
}

function twoTargetFixture(materialId: string) {
  const aQuote = 'Definición del Cociente de Reacción Q: Q compara las concentraciones actuales, no las de equilibrio.'
  const bQuote = 'Condición de Equilibrio Q = K: cuando el cociente de reacción iguala la constante de equilibrio, el sistema está en equilibrio.'
  // A third, decorative-only-at-open-time target — matching the exact live
  // shape ("...-repartitioned") — so answering group A genuinely leaves a
  // nextGroupId B for Continue to open next.
  const cQuote = 'Cuando el cociente de reacción Q es mayor que la constante de equilibrio K, el sistema se desplaza hacia los reactivos para restablecer el equilibrio.'
  // A 4th target in a DISTINCT topic — grouping is per-topic, so this
  // forms its own separate group (B) from the start of the plan,
  // matching the live shape where resolving group A leaves a distinct
  // nextGroupId for Continue to open next.
  const dQuote = 'Cuando el cociente de reacción Q es menor que la constante de equilibrio K, el sistema se desplaza hacia los productos para restablecer el equilibrio.'
  const targets = [
    { id: 'defQ', kind: 'concept', name: 'Definición del Cociente de Reacción (Q)', summary: aQuote, importance: 90, materialId, pages: [20], sourceSpans: [{ page: 20, quote: aQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'condEq', kind: 'concept', name: 'Condición de Equilibrio (Q = K)', summary: bQuote, importance: 88, materialId, pages: [20], sourceSpans: [{ page: 20, quote: bQuote }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'displacement', kind: 'concept', name: 'Desplazamiento del Equilibrio cuando Q > K', summary: cQuote, importance: 80, materialId, pages: [20], sourceSpans: [{ page: 20, quote: cQuote }], topicId: 'topic-1', sourceOrder: 2 },
    { id: 'displacementBelow', kind: 'concept', name: 'Desplazamiento del Equilibrio cuando Q < K', summary: dQuote, importance: 75, materialId, pages: [20], sourceSpans: [{ page: 20, quote: dQuote }], topicId: 'topic-2', sourceOrder: 3 },
  ]
  const selection = buildSourceSelectionSnapshot([materialId], { [materialId]: [20] })
  return {
    selection, targets,
    payload: {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'topic-1', title: 'Equilibrio', order: 0 }, { id: 'topic-2', title: 'Desplazamiento', order: 1 }],
      globalOrderedAnalysis: targets,
      uniqueConceptsIndex: [],
    },
  }
}

/* ------------------------------------------------------------------ */
/* 1. EXACT LIVE-SHAPED CONTRACT: artifact resolves group A, response    */
/* carries nextGroupId B, then the authority dependency behaves exactly */
/* like the live incident on the very next Continue.                    */
/* ------------------------------------------------------------------ */

async function testTransientAuthorityFailureDoesNotDamageArtifact() {
  const { selection, payload, targets } = twoTargetFixture('mat-auth')
  let authorityCalls = 0
  const authorityImpl = async (sessionId: string, userId: string) => {
    authorityCalls += 1
    return { id: sessionId, userId, processMode: 'free', sourceSelection: selection }
  }
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets), authorityImpl)
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, JSON.stringify(open.data))
  const groupA = artifacts.get(initial.artifactId).recoveryPlan.groups[0]

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: groupA.assessedTargetIds.map((id: string) => ({ targetId: id, status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' })) }
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: groupA.groupId,
    attemptClientId: 'a1', answer: 'Respuesta completa y correcta sobre Q y la condición de equilibrio.',
  })
  assert.equal(answer.response.status, 200, JSON.stringify(answer.data))
  assert.equal(answer.data.feedback.groupResolved, true)
  assert.ok(answer.data.nextGroupId, 'the live incident report shows a nextGroupId (group B) after resolving group A')
  const scoreAfterAnswer = answer.data.feedback.scoreAfter

  // --- Continue hits the EXACT live incident: the session-authority
  // dependency returns a transient 5xx. SUPERSEDED by the durable-
  // authority fix (REPASO_DURABLE_AUTHORITY_CERTIFIED): by this point the
  // artifact already has a `frozenAuthority` snapshot (backfilled by the
  // live call at `repaso-recovery-open` above, the first continuation
  // call after creation) — so this continuation NEVER reaches
  // getAuthoritativeFreeSession at all, and a simulated live outage has
  // zero effect. This is the intended, stronger outcome: not just a
  // successful retry, but no dependency on the live call whatsoever.
  Object.assign(__routeDeps, {
    getAuthoritativeFreeSession: async () => { throw new Error('SESSION_AUTHORITY_FAILED:503') },
    generateValidatedLegacyJson: refuseQuestionAuthoringProvider(),
  })
  const continuedDespiteOutage = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(continuedDespiteOutage.response.status, 200, `a durable-authority artifact must be unaffected by a live session-authority outage: ${JSON.stringify(continuedDespiteOutage.data)}`)
  assert.equal(continuedDespiteOutage.data.groupId, answer.data.nextGroupId, 'Continue must resume the exact next group (B), never regenerate or skip')

  const afterOutage = artifacts.get(initial.artifactId)
  assert.equal(afterOutage.recoveryPlan.groups.find((g: any) => g.groupId === groupA.groupId).status, 'resolved')
  assert.equal(afterOutage.scoreHistory[afterOutage.scoreHistory.length - 1].scoreAfter, scoreAfterAnswer, 'score survives the simulated outage unchanged')
  assert.equal(afterOutage.recoveryAttempts.length, 1, 'no duplicate recovery attempt was created')
}

/* ------------------------------------------------------------------ */
/* 2. A genuine 4xx (not a transient 5xx) must NEVER be retried or       */
/* silently accepted — the authority boundary stays fail-closed.        */
/* ------------------------------------------------------------------ */

async function testNonTransientAuthorityFailureIsNeverRetriedOrWeakened() {
  const { selection, payload, targets } = twoTargetFixture('mat-auth-2')
  let calls = 0
  const artifacts = harness('sess-2', selection, payload, initialCoverageMock(targets), async () => {
    calls += 1
    throw new Error('SESSION_AUTHORITY_FAILED:401')
  })
  const result = await post('sess-2', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  assert.equal(result.response.status, 500, 'a non-transient (4xx-shaped) authority failure must still fail — never silently accepted')
  assert.equal(calls, 1, 'a genuine non-transient authority failure must NEVER be retried — only the specific 5xx transient shape is')
}

/* ------------------------------------------------------------------ */
/* 3. A forged/mismatched client session id is still rejected — the      */
/* retry mechanism never becomes a path to trust arbitrary client        */
/* authority.                                                            */
/* ------------------------------------------------------------------ */

async function testForgedSessionIdStillRejectedAfterRetry() {
  const { selection, payload, targets } = twoTargetFixture('mat-auth-3')
  const artifacts = harness('sess-3', selection, payload, initialCoverageMock(targets), async (sessionId: string) => {
    // The authoritative source has no record of this session id at all —
    // even after any retry, this must resolve to "not found", never to a
    // fabricated authority for an unknown/forged session.
    void sessionId
    return null
  })
  const result = await post('sess-3-forged', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  assert.equal(result.response.status, 404)
  assert.equal(result.data.error, 'SESSION_NOT_FOUND')
}

async function main() {
  await testTransientAuthorityFailureDoesNotDamageArtifact()
  await testNonTransientAuthorityFailureIsNeverRetriedOrWeakened()
  await testForgedSessionIdStillRejectedAfterRetry()
  console.log('repaso-session-authority-resilience-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
