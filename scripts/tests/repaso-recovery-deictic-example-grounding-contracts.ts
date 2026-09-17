import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* REPASO RECOVERY LIVE BLOCKER — deictic "este ejemplo" question        */
/* pointed at a cover/title-only page.                                  */
/*                                                                      */
/* Root cause: an "Ejemplo de X" target's canonical evidence was judged */
/* "substantive" by the GENERIC length/shape heuristic (word count,     */
/* "=" presence) even though its actual quote was a decorative/title    */
/* snippet with no concrete instance (no worked equation, no number).   */
/* That let the deterministic composer author a deictic 'application'   */
/* question ("¿Qué muestra este ejemplo...?") whose recommended page    */
/* never shows an example at all. The two sibling CONCEPTUAL targets    */
/* were correctly separated (semantic chunking) — the bug is strictly   */
/* in the grounding/support of the resulting example-only question.     */
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

/* ------------------------------------------------------------------ */
/* Exact live shape: two conceptual targets with genuine substantive    */
/* evidence on page 1, plus an "Ejemplo de..." target whose ONLY span   */
/* is a decorative cover-page snippet (long/shaped enough to pass the   */
/* generic substantiveSourceSpan heuristic, but with no concrete        */
/* worked instance — no equation with real species/values, no number). */
/* ------------------------------------------------------------------ */

function liveFixture() {
  const processQuote = 'El proceso de aproximación al equilibrio ocurre cuando las velocidades de reacción directa e inversa se igualan progresivamente hasta estabilizarse.'
  const representationQuote = 'La representación de ecuaciones en equilibrio utiliza la doble flecha para indicar que la reacción ocurre en ambos sentidos simultáneamente.'
  // Decorative cover-page text: 4+ words, 12+ chars -> passes the
  // GENERIC substantiveSourceSpan shape check, but contains no digit and
  // no compound-formula token -> must NOT qualify as a concrete example.
  const decorativeCoverQuote = 'Equilibrio Químico: conceptos fundamentales de la reacción reversible'
  const targets = [
    { id: 'concept_proceso_aproximacion', kind: 'concept', name: 'Proceso de Aproximación al Equilibrio', summary: processQuote, importance: 90, materialId: 'mat-deictic', pages: [1], sourceSpans: [{ page: 1, quote: processQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'concept_representacion_ecuaciones', kind: 'concept', name: 'Representación de Ecuaciones en Equilibrio', summary: representationQuote, importance: 88, materialId: 'mat-deictic', pages: [1], sourceSpans: [{ page: 1, quote: representationQuote }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'ex_ejemplo_de_ecuacion_en_equilibrio', kind: 'concept', name: 'Ejemplo de Ecuación en Equilibrio', summary: decorativeCoverQuote, importance: 80, materialId: 'mat-deictic', pages: [1], sourceSpans: [{ page: 1, quote: decorativeCoverQuote }], topicId: 'topic-1', sourceOrder: 2 },
  ]
  const selection = buildSourceSelectionSnapshot(['mat-deictic'], { 'mat-deictic': [1] })
  return {
    selection, targets,
    payload: {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'topic-1', title: 'Equilibrio Químico', order: 0 }],
      globalOrderedAnalysis: targets,
      uniqueConceptsIndex: [],
    },
  }
}

async function testExactLiveShape_ExampleWithoutConcreteEvidenceNeverAuthoredDeictic() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `the conceptual pair must still open deterministically: ${JSON.stringify(open.data)}`)
  const stored = artifacts.get(initial.artifactId)

  // Semantic partitioning is preserved: the conceptual pair is authored
  // as its own question, never mixed with the example target.
  const conceptGroup = stored.recoveryPlan.groups.find((g: any) => g.question)
  assert.deepEqual(new Set(conceptGroup.assessedTargetIds), new Set(['concept_proceso_aproximacion', 'concept_representacion_ecuaciones']))

  // No target disappears from the plan.
  const allInPlan = new Set(stored.recoveryPlan.groups.flatMap((g: any) => g.targetIds))
  assert.ok(allInPlan.has('ex_ejemplo_de_ecuacion_en_equilibrio'), 'the example target must not disappear from the plan')

  // Resolve the conceptual pair, then Continue to the deferred example
  // target's own group.
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return {
        targetCoverage: conceptGroup.assessedTargetIds.map((id: string) => ({ targetId: id, status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' })),
      }
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: conceptGroup.groupId,
    attemptClientId: 'a1', answer: 'Respuesta completa sobre el proceso de aproximación y la representación de ecuaciones.',
  })
  assert.equal(answer.response.status, 200, JSON.stringify(answer.data))
  assert.equal(answer.data.feedback.groupResolved, true)
  assert.ok(answer.data.nextGroupId, 'the example target must be deferred into its own next group')

  // CORE INVARIANT: opening the example-only group must NOT author a
  // deictic question pointing at the decorative cover page. Superseded by
  // the REQUIRED PRODUCT INVARIANT fix (no permanent 409 dead-end): since
  // this target has NO concrete instance anywhere in canonical evidence —
  // a static fact — Recovery marks the group 'exhausted' (never
  // fabricating a question, never fabricating mastery) and Continue
  // advances past it instead of dead-ending.
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const exampleOpen = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(exampleOpen.response.status, 200, `an entirely-ungroundable example must self-heal to exhausted, never permanently 409: ${JSON.stringify(exampleOpen.data)}`)
  assert.equal(exampleOpen.data.groupId, undefined, 'there is no further open Recovery group to show')

  // No fabricated coverage/mastery: the example target's canonical state
  // must remain genuinely unresolved — never silently marked covered.
  const afterFailedOpen = artifacts.get(initial.artifactId)
  assert.equal(afterFailedOpen.currentTargetStates.ex_ejemplo_de_ecuacion_en_equilibrio.status, 'missing')
  // Still present, not dropped — available if genuine evidence is ever added.
  const exampleGroup = afterFailedOpen.recoveryPlan.groups.find((g: any) => g.targetIds.includes('ex_ejemplo_de_ecuacion_en_equilibrio'))
  assert.ok(exampleGroup, 'the target must not disappear from the plan')
  assert.equal(exampleGroup.status, 'exhausted', 'the group must be marked exhausted, an honest terminal state — never resolved (no fabricated mastery) and never a permanent blocker')
}

/* ------------------------------------------------------------------ */
/* Positive contract: an "Ejemplo de..." target WITH a genuine worked    */
/* instance (a real equation with species/values) still authors the      */
/* deictic application question exactly as before — this fix narrows     */
/* false positives only, it never blocks a genuinely groundable example. */
/* ------------------------------------------------------------------ */

async function testGenuineWorkedExampleStillAuthorsDeicticQuestion() {
  const concreteQuote = 'Ejemplo: para la reacción N2O4(g) ⇌ 2NO2(g), la expresión de equilibrio es Kc = [NO2]^2 / [N2O4].'
  const targets = [{
    id: 'ex_ejemplo_concreto', kind: 'concept', name: 'Ejemplo de Ecuación en Equilibrio', summary: concreteQuote,
    importance: 80, materialId: 'mat-deictic-2', pages: [4], sourceSpans: [{ page: 4, quote: concreteQuote }], topicId: 'topic-1', sourceOrder: 0,
  }]
  const selection = buildSourceSelectionSnapshot(['mat-deictic-2'], { 'mat-deictic-2': [4] })
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic-1', title: 'Equilibrio', order: 0 }],
    globalOrderedAnalysis: targets,
    uniqueConceptsIndex: [],
  }
  const artifacts = harness('sess-2', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-2', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `a genuinely groundable example must still open successfully: ${JSON.stringify(open.data)}`)
  const stored = artifacts.get(initial.artifactId)
  const group = stored.recoveryPlan.groups[0]
  assert.equal(group.questionFamily, 'application')
  assert.deepEqual(group.pages, [4], 'the recommended page must be the one that actually shows the worked example')
}

/* ------------------------------------------------------------------ */
/* Self-healing compatibility: a group frozen with a stale deictic       */
/* question BEFORE this fix (as if authored by the old buggy code) must  */
/* be repaired on repaso-restore (a page refresh) as well as on          */
/* repaso-recovery-open — never keep restoring the same misleading       */
/* question forever.                                                     */
/* ------------------------------------------------------------------ */

async function testSelfHealingRepairsStalePreFixQuestionOnRestoreAndOpen() {
  // The EXACT true live shape: the example target's ONLY evidence
  // anywhere in the selected pages is the decorative cover snippet —
  // there is no rescue span. This is the case that most needs
  // self-healing: without it, a page refresh (repaso-restore) would keep
  // replaying the stale misleading question forever, since
  // effectiveRepasoPagesToReview falls back to the frozen `group.pages`
  // once the fixed grounding legitimately finds nothing qualifying.
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-3', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-3', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-3', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, JSON.stringify(open.data))
  const conceptGroup = artifacts.get(initial.artifactId).recoveryPlan.groups.find((g: any) => g.question)

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: conceptGroup.assessedTargetIds.map((id: string) => ({ targetId: id, status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' })) }
    },
  })
  const answer = await post('sess-3', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: conceptGroup.groupId,
    attemptClientId: 'a1', answer: 'Respuesta completa.',
  })
  assert.equal(answer.response.status, 200, JSON.stringify(answer.data))
  assert.ok(answer.data.nextGroupId)

  // Simulate a PRE-FIX artifact: manually freeze the example group with
  // the OLD buggy deictic question pointing at the decorative page 1 —
  // exactly as the old code would have persisted it.
  const preFixArtifact = artifacts.get(initial.artifactId)
  const exampleGroupId = answer.data.nextGroupId
  preFixArtifact.recoveryPlan.groups = preFixArtifact.recoveryPlan.groups.map((g: any) => g.groupId === exampleGroupId ? {
    ...g,
    question: '¿Qué muestra este ejemplo sobre Ecuación en Equilibrio?',
    questionProvenance: 'template',
    assessedTargetIds: ['ex_ejemplo_de_ecuacion_en_equilibrio'],
    questionFamily: 'application',
    pages: [1],
  } : g)
  artifacts.set(initial.artifactId, preFixArtifact)

  // 1. repaso-restore (a page refresh) must NOT keep restoring the stale
  // misleading question. Since this target has NO concrete evidence
  // anywhere (a static fact), restore's self-heal chain both clears the
  // stale deictic question AND immediately recognizes the group can never
  // be grounded — marking it 'exhausted' in the SAME request, per the
  // REQUIRED PRODUCT INVARIANT (no permanent 409 dead-end).
  const restore = await post('sess-3', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200, JSON.stringify(restore.data))
  assert.notEqual(restore.data.question, '¿Qué muestra este ejemplo sobre Ecuación en Equilibrio?', 'restore must never keep surfacing the stale pre-fix deictic question')
  assert.equal(restore.data.groupId, undefined, 'there is no further open Recovery group to show once the only remaining target is exhausted')
  const afterRestore = artifacts.get(initial.artifactId)
  const healedGroup = afterRestore.recoveryPlan.groups.find((g: any) => g.groupId === exampleGroupId)
  assert.equal(healedGroup.question, '', 'the stale question must be cleared, never silently kept')
  assert.equal(healedGroup.status, 'exhausted', 'a target with no concrete evidence anywhere must be marked exhausted, not left as a permanent blocker')

  // 2. repaso-recovery-open must be fully idempotent with the healed
  // state — no re-fabrication, no error, no provider calls.
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const reopened = await post('sess-3', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.data))
  assert.equal(reopened.data.groupId, undefined)

  // No fabricated mastery: the example target's canonical state stays
  // genuinely unresolved throughout the whole heal/reopen sequence.
  const finalArtifact = artifacts.get(initial.artifactId)
  assert.equal(finalArtifact.currentTargetStates.ex_ejemplo_de_ecuacion_en_equilibrio.status, 'missing')
}

async function testAnsweredApplicationQuestionIsNeverTouchedBySelfHealing() {
  const concreteQuote = 'Ejemplo: para la reacción N2O4(g) ⇌ 2NO2(g), la expresión de equilibrio es Kc = [NO2]^2 / [N2O4].'
  const targets = [{
    id: 'ex_ejemplo_concreto', kind: 'concept', name: 'Ejemplo de Ecuación en Equilibrio', summary: concreteQuote,
    importance: 80, materialId: 'mat-heal-2', pages: [4], sourceSpans: [{ page: 4, quote: concreteQuote }], topicId: 'topic-1', sourceOrder: 0,
  }]
  const selection = buildSourceSelectionSnapshot(['mat-heal-2'], { 'mat-heal-2': [4] })
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic-1', title: 'Equilibrio', order: 0 }],
    globalOrderedAnalysis: targets,
    uniqueConceptsIndex: [],
  }
  const artifacts = harness('sess-4', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-4', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, JSON.stringify(open.data))
  const group = artifacts.get(initial.artifactId).recoveryPlan.groups[0]

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: [{ targetId: 'ex_ejemplo_concreto', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }] }
    },
  })
  const answer = await post('sess-4', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: group.groupId,
    attemptClientId: 'a1', answer: 'Respuesta completa con el ejemplo N2O4/NO2.',
  })
  assert.equal(answer.response.status, 200)
  assert.equal(answer.data.feedback.groupResolved, true)

  const frozenQuestion = group.question
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const restore = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200, JSON.stringify(restore.data))
  const afterRestore = artifacts.get(initial.artifactId).recoveryPlan.groups.find((g: any) => g.groupId === group.groupId)
  assert.equal(afterRestore.question, frozenQuestion, 'an ANSWERED application question must never be reset by self-healing, even if re-validation would fail')
  assert.equal(afterRestore.status, 'resolved')
}

async function main() {
  await testExactLiveShape_ExampleWithoutConcreteEvidenceNeverAuthoredDeictic()
  await testGenuineWorkedExampleStillAuthorsDeicticQuestion()
  await testSelfHealingRepairsStalePreFixQuestionOnRestoreAndOpen()
  await testAnsweredApplicationQuestionIsNeverTouchedBySelfHealing()
  console.log('repaso-recovery-deictic-example-grounding-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
