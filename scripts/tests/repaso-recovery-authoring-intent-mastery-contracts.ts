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
/* FINAL REPASO BLOCKER — EXPECTATION MUST COME FROM AUTHORING INTENT   */
/*                                                                      */
/* requiresExactDetail (marker-in-missingDetail scanning) was too       */
/* narrow: canonical enrichment beyond a question's ask can be a        */
/* number, a named example, a derivation, a causal rationale, a         */
/* condition — not just decimals/formulas. The fix replaces after-the-  */
/* fact text scanning with an AUTHORING-TIME structural signal: a       */
/* target canonically labeled "Ejemplo de X" bundles a general claim    */
/* plus extra worked-example detail; every OTHER target's own statement */
/* IS its single essential claim, so a 'partial' verdict on it always   */
/* blocks, regardless of family or wording.                             */
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
/* 2. EXACT LIVE REGRESSION — solids/liquids connected question         */
/* ------------------------------------------------------------------ */

function solidsLiquidsFixture() {
  const constancyQuote = 'Las concentraciones de sólidos y líquidos puros permanecen constantes porque su densidad y masa molar no cambian.'
  const exclusionQuote = 'Como las concentraciones de sólidos y líquidos puros son constantes, se excluyen de las expresiones de equilibrio.'
  const exampleExpressionQuote = 'Ejemplo: para CaCO3(s) ⇌ CaO(s) + CO2(g), la expresión de equilibrio es Kc = [CO2], porque los sólidos se omiten.'
  const exampleHeteroQuote = 'Ejemplo de reacción heterogénea: la descomposición de CaCO3(s) en CaO(s) y CO2(g) solo incluye el gas CO2 en la expresión de Kc.'
  const targets = [
    { id: 'constancy', kind: 'concept', name: 'Constancia de las concentraciones de sólidos y líquidos', summary: constancyQuote, importance: 90, materialId: 'mat-sl', pages: [15], sourceSpans: [{ page: 15, quote: constancyQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'exclusion', kind: 'concept', name: 'Exclusión de sólidos y líquidos de las expresiones de equilibrio', summary: exclusionQuote, importance: 88, materialId: 'mat-sl', pages: [15], sourceSpans: [{ page: 15, quote: exclusionQuote }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'exampleExpression', kind: 'concept', name: 'Ejemplo de expresión de equilibrio con sólidos', summary: exampleExpressionQuote, importance: 82, materialId: 'mat-sl', pages: [15], sourceSpans: [{ page: 15, quote: exampleExpressionQuote }], topicId: 'topic-1', sourceOrder: 2 },
    { id: 'exampleHetero', kind: 'concept', name: 'Ejemplo de reacción heterogénea con sólidos y gases', summary: exampleHeteroQuote, importance: 80, materialId: 'mat-sl', pages: [15], sourceSpans: [{ page: 15, quote: exampleHeteroQuote }], topicId: 'topic-1', sourceOrder: 3 },
  ]
  const selection = buildSourceSelectionSnapshot(['mat-sl'], { 'mat-sl': [15] })
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

async function testLiveRegression_SolidsLiquidsConnectedQuestionResolves() {
  const { selection, payload, targets } = solidsLiquidsFixture()
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `open must succeed deterministically: ${JSON.stringify(open.data)}`)
  const stored = artifacts.get(initial.artifactId)
  // The default chunk cap (3) means the 4-target group may repartition —
  // find whichever frozen group actually carries the connected question.
  const group = stored.recoveryPlan.groups.find((g: any) => g.question) ?? stored.recoveryPlan.groups[0]
  assert.ok(group.question.startsWith('Explica cómo se conectan:'), `expected the connected family: ${group.question}`)
  assert.ok(!/CaCO3|CaO|CO2/i.test(group.question), 'the connected question must not itself name the specific compound example')

  const studentAnswer = 'Las concentraciones de los sólidos y líquidos puros se consideran constantes, por eso no se incluyen en las expresiones de equilibrio. En una reacción heterogénea, la expresión de K solo incluye las especies cuya concentración puede variar, como los gases o las sustancias en disolución.'

  const assessedIds: string[] = group.assessedTargetIds
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call at answer time')
      const verdictFor = (id: string) => {
        if (id === 'constancy') return { targetId: id, status: 'covered', evidence: 'se consideran constantes', demonstrated: 'Las concentraciones de sólidos y líquidos puros son constantes.', missingDetail: '' }
        if (id === 'exclusion') return { targetId: id, status: 'covered', evidence: 'por eso no se incluyen en las expresiones de equilibrio', demonstrated: 'Se excluyen de la expresión de equilibrio por ser constantes.', missingDetail: '' }
        if (id === 'exampleExpression') return {
          targetId: id, status: 'partial',
          evidence: 'la expresión de K solo incluye las especies cuya concentración puede variar',
          demonstrated: 'Explicó que la expresión de equilibrio solo incluye especies de concentración variable.',
          missingDetail: 'Falta explicar la razón de densidad y masa molar constante, y no reprodujo el ejemplo específico de CaCO3(s) ⇌ CaO(s) + CO2(g).',
        }
        return {
          targetId: id, status: 'partial',
          evidence: 'en una reacción heterogénea, la expresión de K solo incluye las especies cuya concentración puede variar, como los gases',
          demonstrated: 'Explicó qué especies se incluyen en una reacción heterogénea (gases/disueltas).',
          missingDetail: 'No reprodujo el ejemplo específico de la descomposición de CaCO3 en CaO y CO2.',
        }
      }
      return { targetCoverage: assessedIds.map(verdictFor) }
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: group.groupId,
    attemptClientId: 'a1', answer: studentAnswer,
  })
  assert.equal(answer.response.status, 200, JSON.stringify(answer.data))
  assert.equal(answer.data.feedback.groupResolved, true, 'the conceptual connection actually asked was fully demonstrated')
  assert.equal(answer.data.feedback.status, 'correct')
  assert.equal(answer.data.feedback.title, 'Excelente')
  assert.ok(
    !answer.data.feedback.needsWork.some((n: string) => /densidad|masa molar|CaCO3|CaO|CO2/i.test(n)),
    `needsWork must never surface unasked enrichment: ${JSON.stringify(answer.data.feedback.needsWork)}`,
  )

  // No fabricated canonical mastery: genuine evidence preserved.
  const afterAnswer = artifacts.get(initial.artifactId)
  for (const id of assessedIds) {
    assert.equal(afterAnswer.currentTargetStates[id].status, 'covered')
    assert.ok(afterAnswer.currentTargetStates[id].evidence.length > 0)
  }
}

/* ------------------------------------------------------------------ */
/* 3-7. Family-specific unit contracts on the derivation itself          */
/* ------------------------------------------------------------------ */

function testWhyQuestion_RequiresCausalRationale() {
  // Regression #3 / counterexample A: a causal "why" question over a
  // non-"Ejemplo de" target must never be satisfiable by a bare restatement.
  const question = '¿Por qué las concentraciones de sólidos y líquidos puros se consideran constantes?'
  const target = { id: 'constancy', label: 'Constancia de las concentraciones de sólidos y líquidos', statement: 'Las concentraciones de sólidos y líquidos puros permanecen constantes porque su densidad y masa molar no cambian.' } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [target], ['constancy'])
  assert.equal(expectation.requiresFullDetail, true, 'a non-example target always requires its own full essential claim')
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'partial', demonstrated: 'Porque son constantes.' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, '"porque son constantes" restates the claim without the causal rationale — must stay unresolved')
}

function testExampleQuestion_RequiresRequestedExample() {
  // Regression #4 / counterexample B: a question authored specifically
  // about "el ejemplo" (application family, or explicit compound naming)
  // must require the exact worked example.
  const target = { id: 'exampleHetero', label: 'Ejemplo de reacción heterogénea con sólidos y gases', statement: 'Ejemplo de reacción heterogénea: la descomposición de CaCO3(s) en CaO(s) y CO2(g) solo incluye el gas CO2 en la expresión de Kc.' } as any

  const applicationQuestion = '¿Qué muestra este ejemplo sobre reacción heterogénea con sólidos y gases?'
  const [byFamily] = deriveRepasoRecoveryQuestionExpectations(applicationQuestion, [target], ['exampleHetero'], 'application')
  assert.equal(byFamily.requiresFullDetail, true, 'an application-family question about this exact example requires its full worked detail')

  const namedQuestion = 'Usa la descomposición de CaCO3 para explicar qué especies aparecen en la expresión de equilibrio.'
  const [byNaming] = deriveRepasoRecoveryQuestionExpectations(namedQuestion, [target], ['exampleHetero'])
  assert.equal(byNaming.requiresFullDetail, true, 'wording that explicitly names the compound requires its full worked detail')

  const genericAnswer = { status: 'partial' as const, demonstrated: 'Explicó heterogéneo en general.' }
  assert.equal(isRepasoPartialSatisfiedByQuestionScope(genericAnswer, byFamily.requiresFullDetail), false)
  assert.equal(isRepasoPartialSatisfiedByQuestionScope(genericAnswer, byNaming.requiresFullDetail), false)
}

function testConnectionQuestion_RequiresActualRelationship() {
  // Regression #5 / counterexample C: an isolated fact restatement does
  // not demonstrate the requested connection between two non-example
  // targets.
  const question = '¿Cómo se conectan la constancia de sólidos/líquidos y su exclusión de K?'
  const exclusionTarget = { id: 'exclusion', label: 'Exclusión de sólidos y líquidos de las expresiones de equilibrio', statement: 'Como las concentraciones de sólidos y líquidos puros son constantes, se excluyen de las expresiones de equilibrio.' } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [exclusionTarget], ['exclusion'])
  assert.equal(expectation.requiresFullDetail, true)
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'partial', demonstrated: 'Los sólidos no aparecen.' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, 'stating the isolated fact without the causal connection must not resolve a connection question')
}

function testDefinitionQuestion_RequiresDefinition() {
  // Regression #6 / counterexample D.
  const question = '¿Qué representa Δn?'
  const target = { id: 'deltaN', label: 'Definición de Δn en la relación Kc y Kp', statement: 'Δn representa la diferencia entre la suma de los moles de los productos gaseosos y la suma de los moles de los reactivos gaseosos.' } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [target], ['deltaN'])
  assert.equal(expectation.requiresFullDetail, true)
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'partial', demonstrated: 'Kp = Kc(RT)^Δn' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, 'giving only the formula does not define Δn')
}

function testFormulaQuestion_RequiresRequestedFormula() {
  // Regression #7.
  const question = '¿Cuál es la relación entre Kp y Kc?'
  const target = { id: 'kpkc', label: 'Relación entre Kp y Kc', statement: 'Kp = Kc(RT)^Δn relaciona ambas constantes de equilibrio.' } as any
  const [expectation] = deriveRepasoRecoveryQuestionExpectations(question, [target], ['kpkc'])
  assert.equal(expectation.requiresFullDetail, true)
  const satisfied = isRepasoPartialSatisfiedByQuestionScope(
    { status: 'partial', demonstrated: 'Kp y Kc están relacionadas.' },
    expectation.requiresFullDetail,
  )
  assert.equal(satisfied, false, 'a vague verbal answer without the formula must not satisfy a formula-requesting question')
}

/* ------------------------------------------------------------------ */
/* 8-9. RESTORE / RETRY — expectation is a pure projection of the       */
/* frozen question + family + canonical targets, so it is trivially     */
/* byte-identical across restore/retry without persisting anything.     */
/* ------------------------------------------------------------------ */

async function testRestoreRetry_ExpectationByteIdentical() {
  const { selection, payload, targets } = solidsLiquidsFixture()
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  const before = artifacts.get(initial.artifactId)
  const group = before.recoveryPlan.groups.find((g: any) => g.question)
  const beforeExpectations = deriveRepasoRecoveryQuestionExpectations(group.question, targets as any, group.assessedTargetIds, group.questionFamily)

  const restore = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200)
  const after = artifacts.get(initial.artifactId)
  const groupAfter = after.recoveryPlan.groups.find((g: any) => g.groupId === group.groupId)
  assert.equal(groupAfter.question, group.question)
  assert.deepEqual(groupAfter.assessedTargetIds, group.assessedTargetIds)
  assert.equal(groupAfter.questionFamily, group.questionFamily)
  const afterExpectations = deriveRepasoRecoveryQuestionExpectations(groupAfter.question, targets as any, groupAfter.assessedTargetIds, groupAfter.questionFamily)
  assert.deepEqual(afterExpectations, beforeExpectations, 'expectation must be byte-identical across restore — no provider call, no drift')
}

/* ------------------------------------------------------------------ */
/* 10. Deferred siblings — no false mastery / no disappearance          */
/* ------------------------------------------------------------------ */

async function testDeferredSiblings_NoFalseMasteryNoDisappearance() {
  const { selection, payload, targets } = solidsLiquidsFixture()
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  const stored = artifacts.get(initial.artifactId)
  const allTargetIds = targets.map(t => t.id)
  const totalAssessed = new Set(stored.recoveryPlan.groups.flatMap((g: any) => g.assessedTargetIds || []))
  const totalInPlan = new Set(stored.recoveryPlan.groups.flatMap((g: any) => g.targetIds || []))
  for (const id of allTargetIds) {
    assert.ok(totalInPlan.has(id), `${id} must not disappear from the recovery plan across chunking/deferral`)
  }
  // If chunking split the 4-target group, unassessed siblings must remain
  // available (present in some group's targetIds) — never silently
  // dropped and never silently marked covered ahead of time.
  for (const id of allTargetIds) {
    if (!totalAssessed.has(id)) {
      assert.notEqual(stored.currentTargetStates[id].status, 'covered', `${id} was never assessed and must not appear covered`)
    }
  }
}

async function main() {
  await testLiveRegression_SolidsLiquidsConnectedQuestionResolves()
  testWhyQuestion_RequiresCausalRationale()
  testExampleQuestion_RequiresRequestedExample()
  testConnectionQuestion_RequiresActualRelationship()
  testDefinitionQuestion_RequiresDefinition()
  testFormulaQuestion_RequiresRequestedFormula()
  await testRestoreRetry_ExpectationByteIdentical()
  await testDeferredSiblings_NoFalseMasteryNoDisappearance()
  console.log('repaso-recovery-authoring-intent-mastery-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
