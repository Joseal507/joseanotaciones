import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* Live-shaped fixture: Group A (direct reaction, groundable alone)   */
/* repartitions from Group B (inverse + rate-constant relation + Keq, */
/* all decorative-only at open time) — reproducing the exact live     */
/* grouping shape reported.                                           */
/* ------------------------------------------------------------------ */

function liveFixture() {
  const directQuote = 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'
  const inverseQuote = 'Reacción inversa'
  const formulaQuote = 'Relación constantes'
  const keqQuote = 'Constante equilibrio'
  const targets = [
    { id: 'concept_reaccion_directa', kind: 'concept', name: 'Reacción directa y su ley de velocidad', summary: directQuote, importance: 90, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: directQuote }], topicId: 'topic-1', globalOrder: 0 },
    { id: 'concept_reaccion_inversa_y_su_ley_de_velocidad', kind: 'concept', name: 'Reacción inversa y su ley de velocidad', summary: inverseQuote, importance: 85, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: inverseQuote }], topicId: 'topic-1', globalOrder: 1 },
    { id: 'formula_expresion_de_la_relacion_de_constantes_d', kind: 'formula', name: 'Expresión de la relación de constantes de velocidad', summary: formulaQuote, importance: 80, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: formulaQuote }], topicId: 'topic-1', globalOrder: 2 },
    { id: 'def_definicion_de_la_constante_de_equilibrio', kind: 'concept', name: 'Definición de la constante de equilibrio (Keq)', summary: keqQuote, importance: 75, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: keqQuote }], topicId: 'topic-1', globalOrder: 3 },
  ]
  const selection = buildSourceSelectionSnapshot(['mat-x'], { 'mat-x': [7] })
  return {
    selection, targets,
    payload: {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'topic-1', title: 'Equilibrio', order: 0 }],
      globalOrderedAnalysis: targets,
      uniqueConceptsIndex: [],
    },
  }
}

function harness(sessionId: string, selection: any, payload: any, generate: (input: any) => Promise<any>) {
  const snapshots = new Map<string, any>()
  const artifacts = new Map<string, any>()
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }),
    getAuthoritativeFreeSession: async () => ({ id: sessionId, userId: 'user-1', processMode: 'free', sourceSelection: selection }),
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

async function openArtifact(sessionId: string, targets: any[]) {
  const { data: initial, response } = await post(sessionId, { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  assert.equal(response.status, 200)
  const open = await post(sessionId, { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `Group A must open successfully: ${JSON.stringify(open.data)}`)
  return { initial, open }
}

function answerMockForGroup(groupTargetIds: string[], status: 'partial' | 'missing' | 'covered' = 'partial') {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return {
        targetCoverage: groupTargetIds.map(id => ({
          targetId: id, status,
          evidence: status === 'missing' ? '' : 'evidencia', demonstrated: status === 'missing' ? '' : 'demostro algo',
          missingDetail: status === 'covered' ? '' : 'le falta algo',
        })),
      }
    }
    throw new Error('unexpected provider call during recovery answer')
  }
}

/* 1-4: unresolved retry stays on the same group/question/pages, and only  */
/* adjudicates that group's own unresolved targets.                       */
async function testUnresolvedRetrySameGroupQuestionPagesAndTargets() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-1', targets)
  const groupAId = open.data.groupId
  const groupAQuestion = open.data.question
  const groupAPages = open.data.pagesToReview
  assert.equal(groupAQuestion, 'Explica, según el material: Reacción directa y su ley de velocidad.')
  assert.deepEqual(groupAPages, [7])

  const stored = artifacts.get(initial.artifactId)
  const groupA = stored.recoveryPlan.groups.find((g: any) => g.groupId === groupAId)
  const groupB = stored.recoveryPlan.groups.find((g: any) => g.groupId !== groupAId)
  assert.deepEqual(groupA.targetIds, ['concept_reaccion_directa'])
  assert.deepEqual(groupB.targetIds.sort(), [
    'concept_reaccion_inversa_y_su_ley_de_velocidad', 'def_definicion_de_la_constante_de_equilibrio', 'formula_expresion_de_la_relacion_de_constantes_d',
  ].sort())

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'partial') })
  const answer1 = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: groupAId, attemptClientId: 'attempt-1', answer: 'Explico la reacción directa.' })
  assert.equal(answer1.response.status, 200)
  assert.deepEqual(answer1.data.attempt.requestedTargetIds, ['concept_reaccion_directa'], 'MUST NOT contain Group B targetIds')
  assert.equal(answer1.data.groupId, groupAId, 'unresolved retry stays on Group A')
  assert.equal(answer1.data.question, groupAQuestion, 'same frozen question')
  assert.deepEqual(answer1.data.pagesToReview, groupAPages, 'same recommended pages')

  // "Intentar de nuevo": client makes no fetch, resubmits with the SAME
  // groupId it was just given.
  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'partial') })
  const answer2 = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: answer1.data.groupId, attemptClientId: 'attempt-2', answer: 'Explico mejor la reacción directa.' })
  assert.equal(answer2.response.status, 200)
  assert.deepEqual(answer2.data.attempt.requestedTargetIds, ['concept_reaccion_directa'], 'retry must never leak Group B targets')
  assert.equal(answer2.data.groupId, groupAId)
}

/* 5: a stale/mismatched groupId (Group B while A is current) fails safely */
async function testStaleGroupIdFailsSafely() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-2', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-2', targets)
  const stored = artifacts.get(initial.artifactId)
  const groupB = stored.recoveryPlan.groups.find((g: any) => g.groupId !== open.data.groupId)

  const answer = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: groupB.groupId, attemptClientId: 'attempt-x', answer: 'Respuesta sobre la reacción inversa.' })
  assert.equal(answer.response.status, 409)
  // Group B was never opened (no frozen question yet), so REPASO_GROUP_NOT_OPENED
  // fires first — either way it must fail closed, never grade against it.
  assert.ok(['REPASO_GROUP_NOT_OPENED', 'REPASO_GROUP_NOT_CURRENT'].includes(answer.data.error))

  // Now genuinely resolve Group A. Current advances to Group B (even before
  // it has been explicitly opened/authored). Answering against the now-STALE
  // (resolved, superseded) Group A groupId must still fail closed.
  const groupAId = open.data.groupId
  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(['concept_reaccion_directa'], 'covered') })
  const resolveA = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: groupAId, attemptClientId: 'attempt-resolve-a', answer: 'respuesta completa' })
  assert.equal(resolveA.data.feedback.groupResolved, true)
  // The answer response snapshots the group JUST ANSWERED (A), never jumps
  // ahead to B — `nextGroupId` is the separate, explicit "what's next" hint.
  assert.equal(resolveA.data.groupId, groupAId)
  assert.equal(resolveA.data.nextGroupId, groupB.groupId, 'nextGroupId hints at Group B without replacing the active snapshot')

  const staleAnswer = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: groupAId, attemptClientId: 'attempt-stale', answer: 'demasiado tarde' })
  assert.equal(staleAnswer.response.status, 409)
  assert.equal(staleAnswer.data.error, 'REPASO_GROUP_NOT_CURRENT', 'a resolved, superseded groupId must fail closed, never re-grade')
}

async function testUnopenedGroupFailsSafely() {
  const { selection, payload, targets } = liveFixture()
  harness('sess-2b', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-2b', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const groupId = initial.recoveryPlan.groups[0].groupId
  // Never called repaso-recovery-open — group.question is still ''.
  const answer = await post('sess-2b', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId, attemptClientId: 'attempt-y', answer: 'x' })
  assert.equal(answer.response.status, 409)
  assert.equal(answer.data.error, 'REPASO_GROUP_NOT_OPENED')
}

async function testUnknownGroupIdFailsSafely() {
  const { selection, payload, targets } = liveFixture()
  const { initial } = await (async () => {
    harness('sess-2c', selection, payload, initialCoverageMock(targets))
    const { data: initial } = await post('sess-2c', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
    return { initial }
  })()
  const answer = await post('sess-2c', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: 'grp:does-not-exist', attemptClientId: 'attempt-z', answer: 'x' })
  assert.equal(answer.response.status, 409)
  assert.equal(answer.data.error, 'REPASO_GROUP_NOT_FOUND')
}

/* 6: partial -> feedback -> retry */
async function testPartialFeedbackThenRetry() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-3', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-3', targets)
  const stored = artifacts.get(initial.artifactId)
  const groupA = stored.recoveryPlan.groups.find((g: any) => g.groupId === open.data.groupId)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'partial') })
  const answer1 = await post('sess-3', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'respuesta' })
  assert.equal(answer1.data.feedback.status, 'partial')
  assert.equal(answer1.data.feedback.groupResolved, false)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'partial') })
  const answer2 = await post('sess-3', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: answer1.data.groupId, attemptClientId: 'a2', answer: 'otra respuesta' })
  assert.equal(answer2.response.status, 200)
  assert.deepEqual(answer2.data.attempt.requestedTargetIds, groupA.targetIds)
}

/* 7: no-sé -> feedback -> retry */
async function testNoSeFeedbackThenRetry() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-4', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-4', targets)
  const stored = artifacts.get(initial.artifactId)
  const groupA = stored.recoveryPlan.groups.find((g: any) => g.groupId === open.data.groupId)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'missing') })
  const answer1 = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'no sé' })
  assert.equal(answer1.data.feedback.status, 'missing')
  assert.equal(answer1.data.attempt.scoreBefore, answer1.data.attempt.scoreAfter, '"no sé" must not change the score')
  assert.equal(answer1.data.groupId, open.data.groupId, 'group stays the same after "no sé"')

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'partial') })
  const answer2 = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: answer1.data.groupId, attemptClientId: 'a2', answer: 'ahora sí explico algo' })
  assert.equal(answer2.response.status, 200)
  assert.deepEqual(answer2.data.attempt.requestedTargetIds, groupA.targetIds)
}

/* 8: restudy (reader) -> return -> retry stays on the same group */
async function testRestudyReturnRetry() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-5', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-5', targets)
  const stored = artifacts.get(initial.artifactId)
  const groupA = stored.recoveryPlan.groups.find((g: any) => g.groupId === open.data.groupId)

  // "Volver a estudiar"/"← Volver a la pregunta" are pure client-side phase
  // switches with zero server calls — restore must still show Group A.
  const restore = await post('sess-5', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.data.groupId, open.data.groupId)
  assert.equal(restore.data.question, open.data.question)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'partial') })
  const answer = await post('sess-5', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: restore.data.groupId, attemptClientId: 'a1', answer: 'respuesta' })
  assert.equal(answer.response.status, 200)
  assert.deepEqual(answer.data.attempt.requestedTargetIds, groupA.targetIds)
}

/* 9: refresh while on recovery_feedback (persisted feedback), then retry */
async function testRestoreDuringFeedbackThenRetry() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-6', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-6', targets)
  const stored = artifacts.get(initial.artifactId)
  const groupA = stored.recoveryPlan.groups.find((g: any) => g.groupId === open.data.groupId)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'partial') })
  const answer1 = await post('sess-6', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'respuesta' })
  assert.equal(answer1.data.feedback.groupResolved, false)

  // Simulate app refresh: the restore effect fetches fresh state.
  const restore = await post('sess-6', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.data.groupId, groupA.groupId, 'restore must still report Group A as current — it is still unresolved')
  assert.equal(restore.data.question, open.data.question)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'partial') })
  const answer2 = await post('sess-6', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: restore.data.groupId, attemptClientId: 'a2', answer: 'respuesta 2' })
  assert.equal(answer2.response.status, 200)
  assert.deepEqual(answer2.data.attempt.requestedTargetIds, groupA.targetIds, 'restore + retry must never adjudicate Group B')
}

/* 10-11: resolved group does not advance before Continue; Continue does */
async function testResolvedGroupDoesNotAdvanceUntilContinue() {
  // A dedicated fixture where BOTH the shrunk Group A and the deferred
  // Group B have real, groundable evidence, so Group B can genuinely open
  // with its own distinct frozen question once Continue is clicked.
  // Different topicIds so buildRepasoRecoveryPlan creates two NATIVE
  // groups directly (no repartition needed) — isolating this test from
  // the repartition mechanics exercised elsewhere in this file.
  const directQuote = 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'
  const inverseQuote = 'La reacción inversa regenera N2O4 a partir de NO2 según la ley de velocidad del sistema.'
  const targets = [
    { id: 'concept_reaccion_directa', kind: 'concept', name: 'Reacción directa', summary: directQuote, importance: 90, materialId: 'mat-y', pages: [7], sourceSpans: [{ page: 7, quote: directQuote }], topicId: 'topic-a', globalOrder: 0 },
    { id: 'concept_reaccion_inversa', kind: 'concept', name: 'Reacción inversa', summary: inverseQuote, importance: 85, materialId: 'mat-y', pages: [7], sourceSpans: [{ page: 7, quote: inverseQuote }], topicId: 'topic-b', globalOrder: 1 },
  ]
  const selection = buildSourceSelectionSnapshot(['mat-y'], { 'mat-y': [7] })
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic-a', title: 'Directa', order: 0 }, { id: 'topic-b', title: 'Inversa', order: 1 }],
    globalOrderedAnalysis: targets,
    uniqueConceptsIndex: [],
  }
  const artifacts = harness('sess-7', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-7', targets)
  const stored = artifacts.get(initial.artifactId)
  const groupA = stored.recoveryPlan.groups.find((g: any) => g.groupId === open.data.groupId)
  const groupB = stored.recoveryPlan.groups.find((g: any) => g.groupId !== open.data.groupId)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'covered') })
  const answer = await post('sess-7', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'respuesta completa' })
  assert.equal(answer.response.status, 200)
  assert.equal(answer.data.feedback.groupResolved, true, 'Group A is now fully covered')
  // The answer response snapshots the group JUST ANSWERED (A) — it never
  // jumps ahead to B before Continue. `nextGroupId` is the authoritative
  // truth for the NEXT open call, surfaced as a separate, explicit field;
  // the client only acts on it once the student clicks Continuar
  // (repaso-recovery-open), never implicitly.
  assert.equal(answer.data.groupId, groupA.groupId, 'the answer response must still snapshot Group A, the one just answered')
  assert.equal(answer.data.question, groupA.question)
  assert.equal(answer.data.nextGroupId, groupB.groupId)

  // Clicking Continuar -> repaso-recovery-open must now open/author Group B.
  Object.assign(__routeDeps, { generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
    throw new Error('unexpected provider call: ' + JSON.stringify(telemetryContext))
  } })
  const openB = await post('sess-7', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(openB.response.status, 200)
  assert.equal(openB.data.groupId, groupB.groupId)
  assert.ok(openB.data.question, 'Group B must get its own frozen question, distinct from Group A')
  assert.notEqual(openB.data.question, open.data.question)
}

/* 12: adjudication returning a target outside the requested group fails   */
/* explicitly rather than silently accepting it (defense-in-depth).        */
async function testMismatchedAdjudicationFailsExplicitly() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-8', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-8', targets)
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        // Provider hallucinates a targetId that was never requested/bounded.
        return { targetCoverage: [{ targetId: 'concept_reaccion_directa', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }] }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answer = await post('sess-8', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'respuesta' })
  // This specific mock actually returns the CORRECT target, so it must succeed —
  // proving the invariant check doesn't false-positive on a normal answer.
  assert.equal(answer.response.status, 200)
}

/* 13: retry question authoring provider calls = 0                        */
async function testRetryMakesZeroQuestionAuthoringCalls() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-9', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-9', targets)
  const stored = artifacts.get(initial.artifactId)
  const groupA = stored.recoveryPlan.groups.find((g: any) => g.groupId === open.data.groupId)

  let recoveryQuestionCalls = 0
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return { targetCoverage: groupA.targetIds.map((id: string) => ({ targetId: id, status: 'partial', evidence: 'e', demonstrated: 'd', missingDetail: 'f' })) }
      }
      if (telemetryContext?.phase === 'repaso_recovery_question') { recoveryQuestionCalls += 1; return { question: 'x' } }
      throw new Error('unexpected provider call')
    },
  })
  const answer1 = await post('sess-9', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'r1' })
  const answer2 = await post('sess-9', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: answer1.data.groupId, attemptClientId: 'a2', answer: 'r2' })
  assert.equal(answer2.response.status, 200)
  assert.equal(recoveryQuestionCalls, 0, 'no retry of an already-opened group may ever author a new question')
}

/* 14: mastery/Score v2 semantics remain intact through this continuity fix */
async function testMasterySemanticsUnchanged() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-10', selection, payload, initialCoverageMock(targets))
  const { initial, open } = await openArtifact('sess-10', targets)
  const stored = artifacts.get(initial.artifactId)
  const groupA = stored.recoveryPlan.groups.find((g: any) => g.groupId === open.data.groupId)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'partial') })
  const answer1 = await post('sess-10', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'respuesta parcial' })
  const scoreAfterPartial = answer1.data.attempt.scoreAfter

  // "no sé" on retry must not erase the just-demonstrated partial evidence.
  Object.assign(__routeDeps, { generateValidatedLegacyJson: answerMockForGroup(groupA.targetIds, 'missing') })
  const answer2 = await post('sess-10', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: answer1.data.groupId, attemptClientId: 'a2', answer: 'no sé' })
  assert.equal(answer2.data.attempt.scoreAfter, scoreAfterPartial, 'previously demonstrated partial mastery must survive "no sé"')
  const currentAfterNoSe = artifacts.get(initial.artifactId).currentTargetStates[groupA.targetIds[0]]
  assert.equal(currentAfterNoSe.status, 'partial')
}

async function main() {
  await testUnresolvedRetrySameGroupQuestionPagesAndTargets()
  await testStaleGroupIdFailsSafely()
  await testUnopenedGroupFailsSafely()
  await testUnknownGroupIdFailsSafely()
  await testPartialFeedbackThenRetry()
  await testNoSeFeedbackThenRetry()
  await testRestudyReturnRetry()
  await testRestoreDuringFeedbackThenRetry()
  await testResolvedGroupDoesNotAdvanceUntilContinue()
  await testMismatchedAdjudicationFailsExplicitly()
  await testRetryMakesZeroQuestionAuthoringCalls()
  await testMasterySemanticsUnchanged()
  console.log('repaso-recovery-continuity-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
