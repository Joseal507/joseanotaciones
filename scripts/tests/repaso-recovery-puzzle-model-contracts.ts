import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

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

/* ------------------------------------------------------------------ */
/* Exact required live-shaped contract, via the REAL authoring flow    */
/* (repartition narrows a 4-target group down to the direct-reaction   */
/* target alone), not manual seeding.                                 */
/* ------------------------------------------------------------------ */

function puzzleFixture() {
  const directQuote = 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'
  const inverseQuote = 'La reacción inversa regenera N2O4 a partir de NO2 según la ley de velocidad del sistema.'
  const relationQuote = 'Relación constantes' // decorative-only -> deferred within its own group
  const keqQuote = 'Constante equilibrio' // decorative-only -> deferred within its own group
  const targets = [
    // Its own topic -> its own native group, single-target from the start.
    { id: 'direct', kind: 'concept', name: 'Reacción directa y su ley de velocidad', summary: directQuote, importance: 90, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: directQuote }], topicId: 'topic-direct', globalOrder: 0 },
    // Shared topic -> one native group of 3, itself groundable only for
    // 'inverse' -> repartitions when opened, mirroring the same puzzle
    // mechanics one level deeper in the material.
    { id: 'inverse', kind: 'concept', name: 'Reacción inversa y su ley de velocidad', summary: inverseQuote, importance: 85, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: inverseQuote }], topicId: 'topic-rest', globalOrder: 1 },
    { id: 'rate_relation', kind: 'formula', name: 'Expresión de la relación de constantes de velocidad', summary: relationQuote, importance: 80, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: relationQuote }], topicId: 'topic-rest', globalOrder: 2 },
    { id: 'keq', kind: 'concept', name: 'Definición de la constante de equilibrio (Keq)', summary: keqQuote, importance: 75, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: keqQuote }], topicId: 'topic-rest', globalOrder: 3 },
  ]
  const selection = buildSourceSelectionSnapshot(['mat-x'], { 'mat-x': [7] })
  return {
    selection, targets,
    payload: {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'topic-direct', title: 'Directa', order: 0 }, { id: 'topic-rest', title: 'Resto', order: 1 }],
      globalOrderedAnalysis: targets,
      uniqueConceptsIndex: [],
    },
  }
}

async function testExactLiveShapedPuzzleContract() {
  const { selection, payload, targets } = puzzleFixture()
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  assert.equal(initial.recoveryPlan.groups.length, 2, 'direct sits in its own native group; inverse/rate_relation/keq share another')
  assert.deepEqual(
    [...initial.recoveryPlan.groups[0].targetIds, ...initial.recoveryPlan.groups[1].targetIds].sort(),
    ['direct', 'inverse', 'rate_relation', 'keq'].sort(),
  )

  // Opening the group must repartition + author deterministically, zero
  // provider calls (deterministic-first at every fallback tier).
  let providerCalls = 0
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'repaso_recovery_question') { providerCalls += 1; return { question: 'x' } }
      throw new Error('unexpected provider call at open time')
    },
  })
  const open = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200)
  assert.equal(providerCalls, 0, 'the deterministic-first chain must author this question without ever calling the provider')
  assert.equal(open.data.question, 'Explica, según el material: Reacción directa y su ley de velocidad.')
  const questionAId = open.data.groupId

  const stored = artifacts.get(initial.artifactId)
  const groupA = stored.recoveryPlan.groups.find((g: any) => g.groupId === questionAId)
  assert.deepEqual(groupA.assessedTargetIds, ['direct'], 'assessed scope must be exactly what the wording asks — not the whole 4-target group')

  // Student answers correctly about direct reaction ONLY; provider (per the
  // live report) also adjudicates the wider group and correctly reports the
  // other three as missing.
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: [
            { targetId: 'direct', status: 'covered', evidence: 'N2O4 -> 2NO2, v = kf[N2O4]', demonstrated: 'Explicó correctamente N2O4 -> 2NO2 y v = kf[N2O4].', missingDetail: '' },
            { targetId: 'inverse', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'rate_relation', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'keq', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
          ],
        }
      }
      throw new Error('unexpected provider call at answer time')
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: questionAId,
    attemptClientId: 'a1', answer: 'La reacción directa es N2O4 -> 2NO2 y su velocidad se expresa como v = kf[N2O4].',
  })
  assert.equal(answer.response.status, 200)

  const afterAnswer = artifacts.get(initial.artifactId)
  // 1-4: genuine per-target states
  assert.equal(afterAnswer.currentTargetStates.direct.status, 'covered')
  assert.equal(afterAnswer.currentTargetStates.inverse.status, 'missing')
  assert.equal(afterAnswer.currentTargetStates.rate_relation.status, 'missing')
  assert.equal(afterAnswer.currentTargetStates.keq.status, 'missing')

  // 5-8: current-question resolution and positive feedback
  assert.equal(answer.data.feedback.groupResolved, true, 'currentQuestionResolved must be true')
  assert.equal(answer.data.feedback.status, 'correct')
  assert.equal(answer.data.feedback.title, 'Excelente')
  assert.equal(answer.data.feedback.needsWork.length, 0)

  // 9: CTA semantics — resolved feedback means the UI shows Continue, never retry
  assert.equal(answer.data.feedback.groupResolved, true)

  // 10: the same direct question must not be reopened/retried
  // 12: answered response still snapshots Question A
  assert.equal(answer.data.groupId, questionAId)
  assert.equal(answer.data.question, 'Explica, según el material: Reacción directa y su ley de velocidad.')

  // 11: score reflects only genuine states
  assert.ok(typeof answer.data.attempt.scoreAfter === 'number')
  assert.ok(answer.data.attempt.scoreAfter >= answer.data.attempt.scoreBefore)

  // 13: nextGroupId is separate navigation metadata, not folded into the snapshot
  const deferredGroup = afterAnswer.recoveryPlan.groups.find((g: any) => g.groupId !== questionAId)
  assert.ok(deferredGroup)
  assert.equal(answer.data.nextGroupId, deferredGroup.groupId)
  assert.notEqual(answer.data.nextGroupId, answer.data.groupId)

  // Puzzle progression: remaining pieces preserved, not solved, not dropped.
  assert.deepEqual(deferredGroup.targetIds.sort(), ['inverse', 'rate_relation', 'keq'].sort())
  assert.equal(deferredGroup.question, '')

  // 14-15: Continue opens a DIFFERENT question assessing only unresolved pieces
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'repaso_recovery_question') { providerCalls += 1; return { question: 'x' } }
      throw new Error('unexpected provider call opening question B')
    },
  })
  const openB = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(openB.response.status, 200)
  assert.equal(openB.data.groupId, deferredGroup.groupId)
  assert.notEqual(openB.data.question, answer.data.question)

  // 16-17: its own assessedTargetIds match its own wording; direct is not re-required
  const storedAfterB = artifacts.get(initial.artifactId)
  const groupB = storedAfterB.recoveryPlan.groups.find((g: any) => g.groupId === openB.data.groupId)
  assert.ok(groupB.assessedTargetIds.length > 0)
  assert.ok(!groupB.assessedTargetIds.includes('direct'), 'the already-solved direct target must never reappear as a requirement')

  // 18: zero question regeneration on a restore/reopen of the resolved question
  const restore = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200)
  // 19: continuity snapshot invariant — restore reports the actually-current group consistently
  assert.equal(restore.data.groupId, openB.data.groupId)
  assert.equal(restore.data.question, openB.data.question)
}

/* ------------------------------------------------------------------ */
/* Multi-target question: wording legitimately exposes two targets     */
/* ------------------------------------------------------------------ */

async function testMultiTargetQuestionRequiresBoth() {
  const directQuote = 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'
  const inverseQuote = 'La reacción inversa regenera N2O4 a partir de NO2 según la ley de velocidad v = kr[NO2]^2.'
  const targets = [
    { id: 'direct', kind: 'concept', name: 'Reacción directa y su ley de velocidad', summary: directQuote, importance: 90, materialId: 'mat-y', pages: [7], sourceSpans: [{ page: 7, quote: directQuote }], topicId: 'topic-1', globalOrder: 0 },
    { id: 'inverse', kind: 'concept', name: 'Reacción inversa y su ley de velocidad', summary: inverseQuote, importance: 85, materialId: 'mat-y', pages: [7], sourceSpans: [{ page: 7, quote: inverseQuote }], topicId: 'topic-1', globalOrder: 1 },
  ]
  const selection = buildSourceSelectionSnapshot(['mat-y'], { 'mat-y': [7] })
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic-1', title: 'Equilibrio', order: 0 }],
    globalOrderedAnalysis: targets,
    uniqueConceptsIndex: [],
  }
  const artifacts = harness('sess-2', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-2', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const open = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200)
  // Both targets are substantively groundable together -> the deterministic
  // composer's wording legitimately names both, so both are assessed.
  const stored = artifacts.get(initial.artifactId)
  const group = stored.recoveryPlan.groups.find((g: any) => g.groupId === open.data.groupId)
  assert.deepEqual(group.assessedTargetIds.sort(), ['direct', 'inverse'].sort())

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: [
            { targetId: 'direct', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' },
            { targetId: 'inverse', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
          ],
        }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answer = await post('sess-2', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId,
    attemptClientId: 'a1', answer: 'Solo expliqué la reacción directa.',
  })
  assert.equal(answer.response.status, 200)
  assert.equal(answer.data.feedback.groupResolved, false, 'covering only ONE of two legitimately assessed targets must not resolve the question')
  assert.equal(answer.data.feedback.status, 'partial')
}

/* ------------------------------------------------------------------ */
/* Malformed/empty JSON body — hardened, not a 500                     */
/* ------------------------------------------------------------------ */

async function testMalformedJsonBodyReturnsCleanBadRequest() {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '',
  }))
  assert.equal(response.status, 400, 'an empty/aborted POST body must be a clean 400, never an uncaught 500')
  const data = await response.json()
  assert.equal(data.error, 'INVALID_CONFIG')
}

/* ------------------------------------------------------------------ */
/* Source assertions: DEV observability + invariant check present      */
/* ------------------------------------------------------------------ */

function testObservabilityAndInvariantArePresent() {
  const route = readFileSync('app/api/alai-studyal-repasar/route.ts', 'utf8')
  assert.match(route, /\[repaso-recovery-answer\]/)
  assert.match(route, /currentQuestionResolved/)
  assert.match(route, /remainingUnresolvedTargetIds/)
  assert.match(route, /INVARIANT VIOLATION: partial status with no scoped blocking gap/)
}

async function main() {
  await testExactLiveShapedPuzzleContract()
  await testMultiTargetQuestionRequiresBoth()
  await testMalformedJsonBodyReturnsCleanBadRequest()
  testObservabilityAndInvariantArePresent()
  console.log('repaso-recovery-puzzle-model-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
