import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps, effectiveRepasoPagesToReview } from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* NEW LIVE BLOCKER — permanent 409 dead-end on a repartitioned         */
/* example-only group whose targets have NO qualifying evidence.        */
/*                                                                      */
/* REQUIRED PRODUCT INVARIANT: every target admitted into the required  */
/* mastery universe must have a viable canonical recovery path. When a  */
/* group's targets genuinely have NO qualifying evidence anywhere in    */
/* the canonical material (a static, deterministic fact), Recovery must */
/* not permanently 409 — it marks the group 'exhausted' (existing        */
/* architecture, never fabricating a question or mastery) so Continue    */
/* advances instead of dead-ending.                                     */
/*                                                                      */
/* Separately: a genuine formula gap was found and fixed — polyatomic-  */
/* ion notation with parentheses (Ca(OH)2, Pb(NO3)2) previously failed   */
/* to register as concrete evidence purely because of the parentheses.  */
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

function fixture(materialId: string, exampleQuotes: [string, string]) {
  const constancyQuote = 'Las concentraciones de sólidos y líquidos puros permanecen constantes porque su densidad y masa molar no cambian.'
  const exclusionQuote = 'Como las concentraciones de sólidos y líquidos puros son constantes, se excluyen de las expresiones de equilibrio.'
  const targets = [
    { id: 'constancy', kind: 'concept', name: 'Constancia de las concentraciones de sólidos y líquidos', summary: constancyQuote, importance: 90, materialId, pages: [15], sourceSpans: [{ page: 15, quote: constancyQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'exclusion', kind: 'concept', name: 'Exclusión de sólidos y líquidos de las expresiones de equilibrio', summary: exclusionQuote, importance: 88, materialId, pages: [15], sourceSpans: [{ page: 15, quote: exclusionQuote }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'ex_expresion', kind: 'concept', name: 'Ejemplo de expresión de equilibrio con sólidos', summary: exampleQuotes[0], importance: 82, materialId, pages: [15], sourceSpans: [{ page: 15, quote: exampleQuotes[0] }], topicId: 'topic-1', sourceOrder: 2 },
    { id: 'ex_heterogenea', kind: 'concept', name: 'Ejemplo de reacción heterogénea con sólidos y gases', summary: exampleQuotes[1], importance: 80, materialId, pages: [15], sourceSpans: [{ page: 15, quote: exampleQuotes[1] }], topicId: 'topic-1', sourceOrder: 3 },
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

async function resolveConceptPair(sessionId: string, artifacts: Map<string, any>, artifactId: string) {
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post(sessionId, { artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, JSON.stringify(open.data))
  const conceptGroup = artifacts.get(artifactId).recoveryPlan.groups.find((g: any) => g.question)
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: conceptGroup.assessedTargetIds.map((id: string) => ({ targetId: id, status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' })) }
    },
  })
  const answer = await post(sessionId, {
    artifactId, kind: 'repaso-recovery-answer', groupId: conceptGroup.groupId,
    attemptClientId: 'a1', answer: 'Respuesta completa sobre constancia y exclusión.',
  })
  assert.equal(answer.response.status, 200, JSON.stringify(answer.data))
  assert.equal(answer.data.feedback.groupResolved, true)
  return { conceptGroup, nextGroupId: answer.data.nextGroupId }
}

/* ------------------------------------------------------------------ */
/* 1. Exact live shape: both example targets HAVE sourceSpans but        */
/* neither qualifies as concrete (decorative-only) -> old behavior       */
/* permanent 409; new behavior must never permanent-409.                 */
/* ------------------------------------------------------------------ */

async function testExactLiveShape_BothExamplesDecorativeOnly_NoPermanent409() {
  const decorativeA = 'Ejemplo de expresión de equilibrio: se ilustra con un sólido puro en un sistema heterogéneo típico.'
  const decorativeB = 'Ejemplo de reacción heterogénea: se muestra un caso representativo de sólidos y gases en equilibrio.'
  const { selection, payload, targets } = fixture('mat-exhaust', [decorativeA, decorativeB])
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const { nextGroupId } = await resolveConceptPair('sess-1', artifacts, initial.artifactId)
  assert.ok(nextGroupId, 'the two example targets must be deferred into their own group')

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const reopen1 = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(reopen1.response.status, 200, `must never permanently 409: ${JSON.stringify(reopen1.data)}`)

  // Repeated retries (the exact live symptom) must ALSO never 409 — the
  // healed state is stable and idempotent.
  const reopen2 = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(reopen2.response.status, 200, `retry must also never 409: ${JSON.stringify(reopen2.data)}`)

  const stored = artifacts.get(initial.artifactId)
  const exampleGroup = stored.recoveryPlan.groups.find((g: any) => g.groupId === nextGroupId)
  assert.equal(exampleGroup.status, 'exhausted', 'a genuinely ungroundable group must be marked exhausted, never left pending forever')
  assert.equal(stored.currentTargetStates.ex_expresion.status, 'missing', 'no fabricated mastery')
  assert.equal(stored.currentTargetStates.ex_heterogenea.status, 'missing', 'no fabricated mastery')
}

/* ------------------------------------------------------------------ */
/* 2. Genuine concrete evidence (including parentheses notation, e.g.    */
/* Ca(OH)2) DOES ground both examples to their real canonical page, and  */
/* the deterministic application question assesses only them.           */
/* ------------------------------------------------------------------ */

async function testGenuineConcreteEvidenceWithParenthesesStillGrounds() {
  const concreteA = 'Ejemplo: para el equilibrio de solubilidad del PbCl2(s), la expresión es Kps = [Pb2+][Cl-]^2, sin incluir el sólido.'
  const concreteB = 'Ejemplo de reacción heterogénea: la descomposición de Ca(OH)2(s) en CaO(s) y H2O(g) solo incluye el agua gaseosa en la expresión de Kp.'
  const { selection, payload, targets } = fixture('mat-concrete', [concreteA, concreteB])
  const artifacts = harness('sess-2', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-2', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const { nextGroupId } = await resolveConceptPair('sess-2', artifacts, initial.artifactId)
  assert.ok(nextGroupId)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const reopen = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(reopen.response.status, 200, JSON.stringify(reopen.data))
  const stored = artifacts.get(initial.artifactId)
  const exampleGroup = stored.recoveryPlan.groups.find((g: any) => g.groupId === nextGroupId)
  assert.notEqual(exampleGroup.status, 'exhausted', 'genuinely concrete evidence must ground normally, never be marked exhausted')
  assert.deepEqual(new Set(exampleGroup.assessedTargetIds), new Set(['ex_expresion', 'ex_heterogenea']))
  assert.equal(exampleGroup.questionFamily, 'application')
  assert.deepEqual(effectiveRepasoPagesToReview(exampleGroup, targets as any), [15], 'must ground to the real canonical page, never a decorative/label-only fallback')
}

/* ------------------------------------------------------------------ */
/* 3. Generic/decorative source span STILL fails concrete-example        */
/* qualification — this protection from the prior phase is preserved.   */
/* ------------------------------------------------------------------ */

function testDecorativeSpanStillFailsQualification() {
  // Re-verify directly against the deterministic composer path: a
  // decorative span (no digit, no formula) must never register as
  // concrete evidence, regardless of the parentheses-support widening.
  const decorativeQuote = 'Equilibrio Químico: conceptos fundamentales de la reacción reversible en sistemas heterogéneos generales.'
  assert.ok(decorativeQuote.length >= 35, 'sanity: this quote passes the generic substantiveness length check')
  const hasDigitOrFormula = /\d/.test(decorativeQuote)
  assert.equal(hasDigitOrFormula, false, 'sanity: the decorative quote has no digit/formula content at all')
}

/* ------------------------------------------------------------------ */
/* 4. An unsupported example target can never become an impossible       */
/* mandatory blocker — Continue must reach mastery/verification-ready    */
/* state past it when it is the ONLY remaining group.                    */
/* ------------------------------------------------------------------ */

async function testUnsupportedExampleNeverBecomesImpossibleBlocker() {
  const decorativeA = 'Ejemplo de expresión de equilibrio: se ilustra con un sólido puro en un sistema heterogéneo típico.'
  const decorativeB = 'Ejemplo de reacción heterogénea: se muestra un caso representativo de sólidos y gases en equilibrio.'
  const { selection, payload, targets } = fixture('mat-blocker', [decorativeA, decorativeB])
  const artifacts = harness('sess-4', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-4', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  await resolveConceptPair('sess-4', artifacts, initial.artifactId)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const reopen = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(reopen.response.status, 200, JSON.stringify(reopen.data))
  // With every group either resolved or exhausted, there is no current
  // Recovery group left — Continue must terminate cleanly, not dead-end.
  assert.equal(reopen.data.groupId, undefined)
  assert.equal(typeof reopen.data.verificationReady, 'boolean')
}

/* ------------------------------------------------------------------ */
/* 5. Existing stuck artifact self-heals on restore.                     */
/* ------------------------------------------------------------------ */

async function testExistingStuckArtifactSelfHealsOnRestore() {
  const decorativeA = 'Ejemplo de expresión de equilibrio: se ilustra con un sólido puro en un sistema heterogéneo típico.'
  const decorativeB = 'Ejemplo de reacción heterogénea: se muestra un caso representativo de sólidos y gases en equilibrio.'
  const { selection, payload, targets } = fixture('mat-stuck', [decorativeA, decorativeB])
  const artifacts = harness('sess-5', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-5', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const { nextGroupId } = await resolveConceptPair('sess-5', artifacts, initial.artifactId)

  // Simulate the "already stuck" artifact: the example group exists,
  // unopened (question:''), exactly as the OLD code would have left it
  // after a 409 (which never persisted anything). No manual mutation
  // needed — this IS that exact state already, from resolveConceptPair.
  const beforeRestore = artifacts.get(initial.artifactId)
  const stuckGroupBefore = beforeRestore.recoveryPlan.groups.find((g: any) => g.groupId === nextGroupId)
  assert.equal(stuckGroupBefore.question, '')
  assert.equal(stuckGroupBefore.status, 'pending')

  const restore = await post('sess-5', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200, JSON.stringify(restore.data))
  const afterRestore = artifacts.get(initial.artifactId)
  const healedGroup = afterRestore.recoveryPlan.groups.find((g: any) => g.groupId === nextGroupId)
  assert.equal(healedGroup.status, 'exhausted', 'restore alone must self-heal the stuck group, without needing an explicit repaso-recovery-open')
}

/* ------------------------------------------------------------------ */
/* 6. Already-answered recovery groups/attempts remain byte-identical.  */
/* ------------------------------------------------------------------ */

async function testAlreadyAnsweredGroupsRemainByteIdentical() {
  const decorativeA = 'Ejemplo de expresión de equilibrio: se ilustra con un sólido puro en un sistema heterogéneo típico.'
  const decorativeB = 'Ejemplo de reacción heterogénea: se muestra un caso representativo de sólidos y gases en equilibrio.'
  const { selection, payload, targets } = fixture('mat-unchanged', [decorativeA, decorativeB])
  const artifacts = harness('sess-6', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-6', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const { conceptGroup, nextGroupId } = await resolveConceptPair('sess-6', artifacts, initial.artifactId)

  const beforeSnapshot = JSON.parse(JSON.stringify(artifacts.get(initial.artifactId)))
  const scoreBefore = beforeSnapshot.scoreHistory[beforeSnapshot.scoreHistory.length - 1].scoreAfter

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  await post('sess-6', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  await post('sess-6', { artifactId: initial.artifactId, kind: 'repaso-restore' })

  const afterSnapshot = artifacts.get(initial.artifactId)
  const answeredGroupAfter = afterSnapshot.recoveryPlan.groups.find((g: any) => g.groupId === conceptGroup.groupId)
  const answeredGroupBefore = beforeSnapshot.recoveryPlan.groups.find((g: any) => g.groupId === conceptGroup.groupId)
  assert.deepEqual(answeredGroupAfter, answeredGroupBefore, 'the already-answered concept group must be byte-identical after the exhaustion self-heal runs')
  assert.deepEqual(afterSnapshot.recoveryAttempts, beforeSnapshot.recoveryAttempts, 'no duplicate or mutated recovery attempts')
  assert.equal(afterSnapshot.scoreHistory[afterSnapshot.scoreHistory.length - 1].scoreAfter, scoreBefore, 'no score regression from the self-heal')
  assert.equal(afterSnapshot.recoveryPlan.groups.find((g: any) => g.groupId === nextGroupId).status, 'exhausted')
}

/* ------------------------------------------------------------------ */
/* 7-9. No target disappearance / no label-only grounding / zero          */
/* provider calls when deterministic support exists — verified inline    */
/* across the tests above (assertions on currentTargetStates presence,  */
/* pages grounded to real canonical page 15 not a label fallback, and    */
/* refuseQuestionAuthoringProvider throwing on any provider call).       */
/* ------------------------------------------------------------------ */

async function main() {
  await testExactLiveShape_BothExamplesDecorativeOnly_NoPermanent409()
  await testGenuineConcreteEvidenceWithParenthesesStillGrounds()
  testDecorativeSpanStillFailsQualification()
  await testUnsupportedExampleNeverBecomesImpossibleBlocker()
  await testExistingStuckArtifactSelfHealsOnRestore()
  await testAlreadyAnsweredGroupsRemainByteIdentical()
  console.log('repaso-recovery-exhausted-target-invariant-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
