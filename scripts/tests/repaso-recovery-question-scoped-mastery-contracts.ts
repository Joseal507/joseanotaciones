import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  POST,
  __routeDeps,
  deriveRepasoRecoveryQuestionExpectations,
  isRepasoPartialSatisfiedByQuestionScope,
} from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* FINAL REPASO BLOCKER — QUESTION-SCOPED EXPECTATIONS                  */
/* assessedTargetIds alone are necessary but not sufficient: a target   */
/* may hold richer canonical detail than the frozen question's own      */
/* wording actually asked for. A 'partial' verdict whose entire cited   */
/* gap is EXACT/NUMERIC detail the question never requested must not    */
/* block question resolution.                                           */
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
/* EXACT LIVE REGRESSION — three-target "connected" question, the       */
/* example target's canonical numeric detail (N2O4/NO2, Kc values) was  */
/* never requested by the question wording.                             */
/* ------------------------------------------------------------------ */

function liveFixture() {
  const inverseRuleQuote = 'La constante de equilibrio de la reacción inversa es el recíproco de la constante de la reacción directa: K_inversa = 1/K.'
  const inverseExampleQuote = 'Para la reacción N2O4(g) ⇌ 2NO2(g), si Kc = 0.212 a 100°C, la constante de la reacción inversa es Kc = 4.72.'
  const multipliedExampleQuote = 'Si una reacción se multiplica por un factor n, su constante de equilibrio se eleva a esa potencia: K^n. Por ejemplo, al duplicar la reacción (n=2), la nueva constante es K².'
  const targets = [
    { id: 'inverseRule', kind: 'concept', name: 'Constante de equilibrio para la reacción inversa', summary: inverseRuleQuote, importance: 90, materialId: 'mat-live', pages: [12], sourceSpans: [{ page: 12, quote: inverseRuleQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'inverseExample', kind: 'concept', name: 'Ejemplo de constante de equilibrio inversa', summary: inverseExampleQuote, importance: 85, materialId: 'mat-live', pages: [12], sourceSpans: [{ page: 12, quote: inverseExampleQuote }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'multipliedExample', kind: 'concept', name: 'Ejemplo de constante de equilibrio multiplicada', summary: multipliedExampleQuote, importance: 80, materialId: 'mat-live', pages: [12], sourceSpans: [{ page: 12, quote: multipliedExampleQuote }], topicId: 'topic-1', sourceOrder: 2 },
  ]
  const selection = buildSourceSelectionSnapshot(['mat-live'], { 'mat-live': [12] })
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

async function testLiveRegression_QuestionResolvesDespiteUnaskedNumericGap() {
  // Superseded by the SEMANTIC CHUNKING fix: the conceptual "inverseRule"
  // target and the two "Ejemplo de..." targets are no longer authored
  // into one mixed connected question — they split into a conceptual
  // question and a separate example/application question. This exercises
  // both steps end-to-end through the real production path.
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `open must succeed deterministically: ${JSON.stringify(open.data)}`)
  let stored = artifacts.get(initial.artifactId)
  const conceptGroup = stored.recoveryPlan.groups.find((g: any) => g.question)
  assert.deepEqual(conceptGroup.assessedTargetIds, ['inverseRule'], 'the conceptual target must not be mixed with the example targets')
  assert.ok(!/ejemplo/i.test(conceptGroup.question), `the conceptual question must not reference the examples: ${conceptGroup.question}`)

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call at answer time')
      return { targetCoverage: [{ targetId: 'inverseRule', status: 'covered', evidence: 'la nueva constante es 1/K', demonstrated: 'La reacción inversa usa el recíproco de la constante directa.', missingDetail: '' }] }
    },
  })
  const firstAnswer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: conceptGroup.groupId,
    attemptClientId: 'a1', answer: 'Cuando una reacción se invierte, su constante de equilibrio también se invierte, por lo que la nueva constante es 1/K.',
  })
  assert.equal(firstAnswer.response.status, 200, JSON.stringify(firstAnswer.data))
  assert.equal(firstAnswer.data.feedback.groupResolved, true)
  assert.ok(firstAnswer.data.nextGroupId, 'Continue must open the deferred example chunk next')

  stored = artifacts.get(initial.artifactId)
  const exampleGroup = stored.recoveryPlan.groups.find((g: any) => g.groupId === firstAnswer.data.nextGroupId)
  const opened = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(opened.response.status, 200)
  stored = artifacts.get(initial.artifactId)
  const openedExampleGroup = stored.recoveryPlan.groups.find((g: any) => g.groupId === exampleGroup.groupId)
  assert.deepEqual(new Set(openedExampleGroup.assessedTargetIds), new Set(['inverseExample', 'multipliedExample']))
  assert.equal(openedExampleGroup.questionFamily, 'application', `a chunk made entirely of "Ejemplo de..." targets must be authored as the application family: ${JSON.stringify(openedExampleGroup)}`)
  assert.ok(/ejemplo/i.test(openedExampleGroup.question), `expected wording that explicitly invokes the examples: ${openedExampleGroup.question}`)

  // A vague, generic (non-example) answer must NOT cover an application
  // question — the exact worked-example detail is now explicitly asked.
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call at answer time')
      return {
        targetCoverage: [
          {
            targetId: 'inverseExample', status: 'partial',
            evidence: 'si una reacción se invierte, su constante también se invierte (1/K)',
            demonstrated: 'Explicó la relación recíproca de forma general.',
            missingDetail: 'Falta el ejemplo numérico específico de la reacción N2O4(g) ⇌ 2NO2(g) y sus valores de Kc.',
          },
          { targetId: 'multipliedExample', status: 'covered', evidence: 'si se duplica la reacción, la nueva constante sería K²', demonstrated: 'Explicó que multiplicar por un factor eleva K a esa potencia, incluyendo la duplicación.', missingDetail: '' },
        ],
      }
    },
  })
  const vagueAnswer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: exampleGroup.groupId,
    attemptClientId: 'a2', answer: 'Cuando una reacción se invierte, su constante también se invierte. Si se duplica la reacción, la nueva constante sería K².',
  })
  assert.equal(vagueAnswer.response.status, 200, JSON.stringify(vagueAnswer.data))
  assert.equal(vagueAnswer.data.feedback.groupResolved, false, 'a generic conceptual answer must not resolve an application question requesting the exact example')
  assert.equal(artifacts.get(initial.artifactId).currentTargetStates.inverseExample.status, 'partial', 'the missing worked example must stay genuinely unresolved, never promoted')
}

/* ------------------------------------------------------------------ */
/* CASE B — EXACT EXAMPLE QUESTION: when the frozen wording itself      */
/* contains the exact numeric/formula detail, a 'partial' verdict       */
/* citing that same detail must keep blocking.                          */
/* ------------------------------------------------------------------ */

function testCaseB_ExactDetailInWordingStaysStrict() {
  const question = 'Para N2O4(g) ⇌ 2NO2(g), si Kc = 0.212 a 100 °C, ¿cuál es Kc para la reacción inversa?'
  const target = {
    id: 'inverseExample', label: 'Ejemplo de constante de equilibrio inversa',
    statement: 'Para la reacción N2O4(g) ⇌ 2NO2(g), si Kc = 0.212 a 100°C, la constante de la reacción inversa es Kc = 4.72.',
  } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [target], ['inverseExample'])
  assert.equal(expectation.requiresFullDetail, true, 'the question explicitly asked for the exact numeric example')
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'partial', demonstrated: 'Dijo que se toma el recíproco.' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, 'an exact-detail question must never be satisfied by a vague conceptual answer alone')
}

/* ------------------------------------------------------------------ */
/* NEGATIVE REGRESSIONS (per the phase's exact checklist)               */
/* ------------------------------------------------------------------ */

function testNegative1_OnlySaysKChanges() {
  const question = 'Explica cómo se conectan: Constante de equilibrio para la reacción inversa y Ejemplo de constante de equilibrio inversa.'
  const target = { id: 't1', label: 'Ejemplo de constante de equilibrio inversa', statement: 'N2O4(g) ⇌ 2NO2(g), Kc = 0.212, inversa Kc = 4.72.' } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [target], ['t1'])
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'missing', demonstrated: '' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, 'a "missing" verdict (no genuine evidence) must never be promoted')
}

function testNegative2_OmitsExplicitlyAskedSecondRule() {
  // Both the reciprocal rule AND the multiplication rule are explicitly
  // asked (two-target connected question); the student only addresses one
  // — the OTHER target's genuine conceptual gap must keep blocking.
  const question = 'Explica cómo se conectan: Constante de equilibrio para la reacción inversa y Constante de equilibrio multiplicada.'
  const multipliedTarget = { id: 'multiplied', label: 'Constante de equilibrio multiplicada', statement: 'Si se multiplica la reacción por un factor n, la constante se eleva a esa potencia: K^n.' } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [multipliedTarget], ['multiplied'])
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'partial', demonstrated: '' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, 'a genuine conceptual gap on an explicitly-asked target must keep blocking, even with no exact-detail marker to hide behind')
}

function testNegative3_ExactNumericQuestionVagueAnswerStaysIncomplete() {
  const question = 'Si Kc = 0.212 para N2O4(g) ⇌ 2NO2(g), ¿cuál es Kc para la reacción inversa?'
  const target = { id: 't1', label: 'Ejemplo de constante de equilibrio inversa', statement: 'N2O4(g) ⇌ 2NO2(g), Kc = 0.212, inversa Kc = 4.72.' } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [target], ['t1'])
  assert.equal(expectation.requiresFullDetail, true)
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'partial', demonstrated: 'Dijo que hay que tomar el recíproco.' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, '"take the reciprocal" without giving/applying the result must stay incomplete when the question explicitly asked for the numeric result')
}

function testNegative4_DeltaNAnsweredWithUnrelatedFormulaNoDefinition() {
  const question = '¿Qué representa Δn en la relación entre Kp y Kc?'
  const target = { id: 'deltaN', label: 'Definición de Δn en la relación Kc y Kp', statement: 'Δn representa la diferencia entre la suma de los moles de los productos gaseosos y la suma de los moles de los reactivos gaseosos.' } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [target], ['deltaN'])
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'partial', demonstrated: 'Mencionó la fórmula Kp = Kc(RT)^Δn sin definir Δn.' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, 'answering with an unrelated formula but no actual definition must not resolve a definition question')
}

function testNegative5_FormulaQuestionAnsweredVerballyWithoutFormula() {
  const question = '¿Cuál es la relación entre Kp y Kc?'
  const target = { id: 'kpkc', label: 'Relación entre Kp y Kc', statement: 'Kp = Kc(RT)^Δn relaciona ambas constantes de equilibrio.' } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [target], ['kpkc'])
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'partial', demonstrated: 'Dijo que Kp y Kc están relacionadas.' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, 'a vague verbal answer without the formula must not satisfy a formula-requesting question')
}

async function main() {
  await testLiveRegression_QuestionResolvesDespiteUnaskedNumericGap()
  testCaseB_ExactDetailInWordingStaysStrict()
  testNegative1_OnlySaysKChanges()
  testNegative2_OmitsExplicitlyAskedSecondRule()
  testNegative3_ExactNumericQuestionVagueAnswerStaysIncomplete()
  testNegative4_DeltaNAnsweredWithUnrelatedFormulaNoDefinition()
  testNegative5_FormulaQuestionAnsweredVerballyWithoutFormula()
  console.log('repaso-recovery-question-scoped-mastery-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
