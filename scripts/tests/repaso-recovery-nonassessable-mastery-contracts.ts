import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* MASTERY AUDIT — REPASO_EXHAUSTED_TARGET_INVARIANT_CERTIFIED removed   */
/* the technical 409 dead-end but left an ACADEMIC dead-end: an          */
/* exhausted-but-still-'missing' target permanently blocks               */
/* allTargetsResolved -> computeRepasoMasteryStatus stays 'not_ready'    */
/* forever -> verification_ready/Final Verification/mastered become      */
/* permanently unreachable, even though the reason is a SYSTEM coverage  */
/* failure, never a student mastery failure.                            */
/*                                                                      */
/* FIX: `RepasoArtifact.nonAssessableTargetIds` — an append-only,        */
/* artifact-level exclusion set populated exactly when                  */
/* skipEntirelyUngroundableRepasoGroups proves a target has no valid     */
/* canonical recovery path. The target's own state is untouched (still  */
/* genuinely 'missing', never fabricated 'covered', never deleted from   */
/* currentTargetStates/provenance) — it is excluded ONLY from the        */
/* mastery-readiness gate (allTargetsResolved/computeRepasoMasteryStatus)*/
/* and the Score v2 denominator (repasoScore).                          */
/* ------------------------------------------------------------------ */

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

function refuseQuestionAuthoringProvider() {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'repaso_recovery_question') throw new Error('question-authoring provider must not be called')
    throw new Error('unexpected provider call at open time')
  }
}

/* ------------------------------------------------------------------ */
/* Fixture: one genuinely assessable conceptual target + two decorative */
/* "Ejemplo de..." targets sharing the same page/topic (so they are     */
/* deferred into their own group and become exhausted together).       */
/* ------------------------------------------------------------------ */

function fixture(materialId: string) {
  const assessableQuote = 'Las concentraciones de sólidos y líquidos puros permanecen constantes porque su densidad y masa molar no cambian.'
  const decorativeA = 'Ejemplo de expresión de equilibrio: se ilustra con un sólido puro en un sistema heterogéneo típico.'
  const decorativeB = 'Ejemplo de reacción heterogénea: se muestra un caso representativo de sólidos y gases en equilibrio.'
  const targets = [
    { id: 'assessable', kind: 'concept', name: 'Constancia de las concentraciones de sólidos y líquidos', summary: assessableQuote, importance: 90, materialId, pages: [15], sourceSpans: [{ page: 15, quote: assessableQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'ex_a', kind: 'concept', name: 'Ejemplo de expresión de equilibrio con sólidos', summary: decorativeA, importance: 82, materialId, pages: [15], sourceSpans: [{ page: 15, quote: decorativeA }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'ex_b', kind: 'concept', name: 'Ejemplo de reacción heterogénea con sólidos y gases', summary: decorativeB, importance: 80, materialId, pages: [15], sourceSpans: [{ page: 15, quote: decorativeB }], topicId: 'topic-1', sourceOrder: 2 },
  ]
  const selection = buildSourceSelectionSnapshot([materialId], { [materialId]: [15] })
  return {
    selection, targets,
    payload: {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'topic-1', title: 'Equilibrio heterogéneo', order: 0 }],
      globalOrderedAnalysis: targets,
      uniqueConceptsIndex: [],
    },
  }
}

function initialCoverageMock(targets: any[]) {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return { targetCoverage: targets.map(t => ({ targetId: t.id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '' })) }
    }
    throw new Error('unexpected provider call during initial diagnosis')
  }
}

/** Opens, self-heals the exhausted example group, then resolves the assessable target. */
async function driveToVerificationReady(sessionId: string, artifacts: Map<string, any>, artifactId: string) {
  // The first open authors the assessable target's own question; the
  // repartition that carves the decorative pair into its own group
  // happens inside that same call, but that new group only becomes
  // CURRENT (and its exhaustion detected) once the assessable target is
  // answered — matching the real Continue-clicks-again live flow.
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open1 = await post(sessionId, { artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open1.response.status, 200, JSON.stringify(open1.data))
  const stored0 = artifacts.get(artifactId)
  const assessableGroup = stored0.recoveryPlan.groups.find((g: any) => g.question)
  assert.ok(assessableGroup, 'the assessable target must still be authored a real question')
  assert.deepEqual(assessableGroup.assessedTargetIds, ['assessable'])

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: [{ targetId: 'assessable', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }] }
    },
  })
  const answer = await post(sessionId, {
    artifactId, kind: 'repaso-recovery-answer', groupId: assessableGroup.groupId,
    attemptClientId: 'a1', answer: 'Las concentraciones de sólidos y líquidos puros son constantes.',
  })
  assert.equal(answer.response.status, 200, JSON.stringify(answer.data))
  assert.equal(answer.data.feedback.groupResolved, true)

  // Continue: the deferred example-only group is now current and must
  // self-heal to exhausted instead of 409-ing.
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open2 = await post(sessionId, { artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open2.response.status, 200, JSON.stringify(open2.data))
  const stored1 = artifacts.get(artifactId)
  const exampleGroup = stored1.recoveryPlan.groups.find((g: any) => g.status === 'exhausted')
  assert.ok(exampleGroup, 'the decorative example pair must self-heal to exhausted')

  // 1. exhausted/non-assessable target does not 409 (already proven by
  // the successful 200 above).
  // 2. it remains represented in provenance/artifact.
  assert.deepEqual(new Set(exampleGroup.targetIds), new Set(['ex_a', 'ex_b']))
  assert.deepEqual(new Set(stored1.nonAssessableTargetIds), new Set(['ex_a', 'ex_b']), 'the artifact must record these as non-assessable, append-only')

  return open2.data
}

/* ------------------------------------------------------------------ */
/* 3. does not count as student 'missing' for mastery readiness; 5. full */
/* Recovery completion with such targets present; 6. verification_ready */
/* is reachable.                                                        */
/* ------------------------------------------------------------------ */

async function testNonAssessableTargetsNeverBlockCompletion() {
  const { selection, payload, targets } = fixture('mat-va')
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const openData = await driveToVerificationReady('sess-1', artifacts, initial.artifactId)

  // The exhausted targets are STILL 'missing' — no fabricated mastery —
  // yet mastery status must already be 'mastered' directly: FINAL PRODUCT
  // FLOW retires the intermediate Final Verification gate entirely.
  const stored = artifacts.get(initial.artifactId)
  assert.equal(stored.currentTargetStates.ex_a.status, 'missing')
  assert.equal(stored.currentTargetStates.ex_b.status, 'missing')
  assert.equal(openData.masteryStatus, 'mastered', 'non-assessable targets must never block completion')
}

/* ------------------------------------------------------------------ */
/* 4. does not depress current score denominator.                       */
/* ------------------------------------------------------------------ */

async function testNonAssessableTargetsExcludedFromScoreDenominator() {
  const { selection, payload, targets } = fixture('mat-score')
  const artifacts = harness('sess-2', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-2', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const openData = await driveToVerificationReady('sess-2', artifacts, initial.artifactId)
  // 1 assessable target, now covered, with the two non-assessable
  // targets excluded from the denominator -> full marks on the
  // assessable universe (100), not depressed to 33 by the two
  // permanently-'missing' non-assessable targets.
  assert.equal(openData.score, 100, 'the score denominator must represent only assessable targets')
}

/* ------------------------------------------------------------------ */
/* 7. Final Verification can open. 8. mastered is reachable when all     */
/* assessable targets pass.                                             */
/* ------------------------------------------------------------------ */

async function testMasteredIsReachableDirectlyWithoutFinalVerification() {
  // FINAL PRODUCT FLOW: Final Verification is retired from the active
  // path. Reaching 'mastered' must require NO repaso-final-open/answer
  // call at all, and a NEW repaso-final-open must refuse to generate one
  // (410, zero provider calls) rather than opening a verification set.
  const { selection, payload, targets } = fixture('mat-final')
  const artifacts = harness('sess-3', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-3', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const openData = await driveToVerificationReady('sess-3', artifacts, initial.artifactId)
  assert.equal(openData.masteryStatus, 'mastered', 'mastered must be reachable directly once every ASSESSABLE target passes, regardless of non-assessable targets')
  assert.ok(openData.studentEvidencePaper, 'Paper 2 must already be available once mastered, with no Final Verification step required')

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async () => { throw new Error('no provider call must ever happen for repaso-final-open in the final product flow') },
  })
  const finalOpen = await post('sess-3', { artifactId: initial.artifactId, kind: 'repaso-final-open' })
  assert.equal(finalOpen.response.status, 410, `a NEW Final Verification set must never be generated: ${JSON.stringify(finalOpen.data)}`)
  assert.equal(finalOpen.data.error, 'REPASO_FINAL_VERIFICATION_RETIRED')
}

/* ------------------------------------------------------------------ */
/* 9. a genuinely assessable missing target still blocks readiness.     */
/* ------------------------------------------------------------------ */

async function testGenuinelyAssessableMissingTargetStillBlocksReadiness() {
  const { selection, payload, targets } = fixture('mat-blocked')
  const artifacts = harness('sess-4', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-4', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  // Self-heal the exhausted pair, but do NOT answer the assessable target.
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, JSON.stringify(open.data))

  const finalOpenAttempt = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-final-open' })
  assert.equal(finalOpenAttempt.response.status, 409, 'a genuinely assessable, still-missing target must keep blocking readiness')
  assert.equal(finalOpenAttempt.data.error, 'REPASO_VERIFICATION_NOT_READY')
}

/* ------------------------------------------------------------------ */
/* 10-11. generic/decorative evidence still cannot qualify; genuine      */
/* concrete evidence still remains assessable — both already covered by */
/* repaso-recovery-exhausted-target-invariant-contracts.ts and re-        */
/* asserted here at the mastery layer: a genuinely concrete example      */
/* target must NOT be recorded as non-assessable.                        */
/* ------------------------------------------------------------------ */

async function testGenuineConcreteExampleIsNeverMarkedNonAssessable() {
  const assessableQuote = 'Las concentraciones de sólidos y líquidos puros permanecen constantes porque su densidad y masa molar no cambian.'
  const concreteQuote = 'Ejemplo: para el equilibrio de solubilidad del PbCl2(s), la expresión es Kps = [Pb2+][Cl-]^2, sin incluir el sólido.'
  const materialId = 'mat-genuine'
  const targets = [
    { id: 'assessable', kind: 'concept', name: 'Constancia de las concentraciones de sólidos y líquidos', summary: assessableQuote, importance: 90, materialId, pages: [15], sourceSpans: [{ page: 15, quote: assessableQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'ex_concrete', kind: 'concept', name: 'Ejemplo de expresión de equilibrio con sólidos', summary: concreteQuote, importance: 82, materialId, pages: [15], sourceSpans: [{ page: 15, quote: concreteQuote }], topicId: 'topic-1', sourceOrder: 1 },
  ]
  const selection = buildSourceSelectionSnapshot([materialId], { [materialId]: [15] })
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic-1', title: 'Equilibrio', order: 0 }],
    globalOrderedAnalysis: targets,
    uniqueConceptsIndex: [],
  }
  const artifacts = harness('sess-5', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-5', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-5', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, JSON.stringify(open.data))
  const stored = artifacts.get(initial.artifactId)
  assert.deepEqual(stored.nonAssessableTargetIds || [], [], 'a genuinely concrete example must never be marked non-assessable')
}

/* ------------------------------------------------------------------ */
/* 12. already-answered groups/attempts remain unchanged; historical     */
/* scoreHistory is never rewritten.                                     */
/* ------------------------------------------------------------------ */

async function testAlreadyAnsweredGroupsAndHistoryUnchanged() {
  const { selection, payload, targets } = fixture('mat-history')
  const artifacts = harness('sess-6', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-6', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  await driveToVerificationReady('sess-6', artifacts, initial.artifactId)

  const before = JSON.parse(JSON.stringify(artifacts.get(initial.artifactId)))
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  await post('sess-6', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  await post('sess-6', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  const after = artifacts.get(initial.artifactId)

  assert.deepEqual(after.recoveryAttempts, before.recoveryAttempts, 'no duplicate/mutated recovery attempts')
  assert.deepEqual(after.scoreHistory, before.scoreHistory, 'historical scoreHistory entries are never rewritten')
  const answeredGroupBefore = before.recoveryPlan.groups.find((g: any) => g.status === 'resolved')
  const answeredGroupAfter = after.recoveryPlan.groups.find((g: any) => g.groupId === answeredGroupBefore.groupId)
  assert.deepEqual(answeredGroupAfter, answeredGroupBefore, 'the already-answered assessable group stays byte-identical')
}

async function main() {
  await testNonAssessableTargetsNeverBlockCompletion()
  await testNonAssessableTargetsExcludedFromScoreDenominator()
  await testMasteredIsReachableDirectlyWithoutFinalVerification()
  await testGenuinelyAssessableMissingTargetStillBlocksReadiness()
  await testGenuineConcreteExampleIsNeverMarkedNonAssessable()
  await testAlreadyAnsweredGroupsAndHistoryUnchanged()
  console.log('repaso-recovery-nonassessable-mastery-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
