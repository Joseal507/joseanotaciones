import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  POST,
  __routeDeps,
  buildRepasoRecoveryQuestionGrounding,
  isRepasoRecoveryQuestionSupported,
  isSpecificRepasoRecoveryQuestion,
} from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* Live chemistry group regression: N2O4/NO2 forward/reverse reaction */
/* group with a deferred formula sibling. Recovery must open (200),   */
/* produce a specific + supported question, ideally with ZERO         */
/* provider calls (deterministic composition), and never reach        */
/* REPASO_RECOVERY_QUESTION_UNSUPPORTED for this ordinary academic    */
/* case.                                                               */
/* ------------------------------------------------------------------ */

async function testLiveChemistryGroupRegression() {
  const selection = buildSourceSelectionSnapshot(['mat-chem'], { 'mat-chem': [7] })
  const directQuote = 'La reacción directa del N2O4 produce NO2 y su ley de velocidad se expresa como v = kf [N2O4].'
  const inverseQuote = 'La reacción inversa del NO2 regenera N2O4 según la evidencia presentada en el material.'
  const rateQuote = 'La ley de velocidad para la reacción directa relaciona la concentración de N2O4 con la velocidad observada.'
  const equalityQuote = 'Equilibrio químico' // deliberately decorative title — this sibling stays deferred
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic-1', title: 'Equilibrio N2O4/NO2', order: 0 }],
    globalOrderedAnalysis: [
      {
        id: 'concept_reaccion_directa_del_n2o4', kind: 'concept', name: 'Reacción directa del N2O4',
        summary: directQuote, importance: 90, materialId: 'mat-chem', pages: [7],
        sourceSpans: [{ page: 7, quote: directQuote }], topicId: 'topic-1', globalOrder: 0,
      },
      {
        id: 'formula_ley_de_velocidad_para_la_reaccion_direct', kind: 'formula', name: 'Ley de velocidad para la reacción directa',
        summary: rateQuote, importance: 85, materialId: 'mat-chem', pages: [7],
        sourceSpans: [{ page: 7, quote: rateQuote }], topicId: 'topic-1', globalOrder: 1,
      },
      {
        id: 'concept_reaccion_inversa_del_no2', kind: 'concept', name: 'Reacción inversa del NO2',
        summary: inverseQuote, importance: 80, materialId: 'mat-chem', pages: [7],
        sourceSpans: [{ page: 7, quote: inverseQuote }], topicId: 'topic-1', globalOrder: 2,
      },
      {
        id: 'formula_igualdad_de_velocidades_en_el_equilibrio', kind: 'formula', name: 'Igualdad de velocidades en el equilibrio',
        summary: equalityQuote, importance: 70, materialId: 'mat-chem', pages: [7],
        sourceSpans: [{ page: 7, quote: equalityQuote }], topicId: 'topic-1', globalOrder: 3,
      },
    ],
    uniqueConceptsIndex: [],
  }
  const snapshots = new Map<string, any>()
  const artifacts = new Map<string, any>()
  let recoveryQuestionCalls = 0
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }),
    getAuthoritativeFreeSession: async () => ({ id: 'sess-chem', userId: 'user-1', processMode: 'free', sourceSelection: selection }),
    getMaterial: async () => ({ id: 'mat-chem' }),
    lookupEnjoyer: async (fingerprint: string) => (fingerprint === selection.fingerprint ? payload : null),
    createRepasarSnapshotStore: () => ({
      async get(id: string) { return snapshots.get(id) || null },
      async set(snapshot: any) { snapshots.set(snapshot.snapshotId, snapshot) },
    }),
    createRepasoArtifactStore: () => ({
      async get(id: string) { return artifacts.get(id) || null },
      async set(artifact: any) { artifacts.set(artifact.artifactId, artifact) },
    }),
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: payload.globalOrderedAnalysis.map(t => ({
            targetId: t.id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '',
          })),
        }
      }
      if (telemetryContext?.phase === 'repaso_recovery_question') {
        recoveryQuestionCalls += 1
        return { question: 'idea principal del tema' } // should never be needed if deterministic wins
      }
      throw new Error('unexpected provider call')
    },
  })

  const initial = await POST(new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-chem', explanation: 'x', mode: 'libre', kind: 'repaso-initial' }),
  }))
  const initialData = await initial.json()
  assert.equal(initial.status, 200)
  const group = initialData.recoveryPlan.groups[0]
  assert.deepEqual(group.targetIds.sort(), [
    'concept_reaccion_directa_del_n2o4', 'concept_reaccion_inversa_del_no2',
    'formula_igualdad_de_velocidades_en_el_equilibrio', 'formula_ley_de_velocidad_para_la_reaccion_direct',
  ].sort())

  const open = await POST(new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-chem', artifactId: initialData.artifactId, kind: 'repaso-recovery-open' }),
  }))
  const openData = await open.json()
  assert.equal(open.status, 200, 'ordinary grounded chemistry group must not 409')
  assert.notEqual(openData.error, 'REPASO_RECOVERY_QUESTION_UNSUPPORTED')
  assert.deepEqual(openData.pagesToReview, [7])
  assert.ok(recoveryQuestionCalls <= 2, `provider calls must stay <=2, got ${recoveryQuestionCalls}`)

  const stored = artifacts.get(initialData.artifactId)
  const shrunk = stored.recoveryPlan.groups.find((g: any) => g.groupId === group.groupId)
  const remainder = stored.recoveryPlan.groups.find((g: any) => g.groupId !== group.groupId)
  assert.deepEqual(shrunk.targetIds.sort(), [
    'concept_reaccion_directa_del_n2o4', 'concept_reaccion_inversa_del_no2', 'formula_ley_de_velocidad_para_la_reaccion_direct',
  ].sort(), 'the decorative sibling is deferred, the three groundable targets stay in the opened group')
  assert.deepEqual(remainder.targetIds, ['formula_igualdad_de_velocidades_en_el_equilibrio'], 'deferred target preserved in a future Recovery group, never dropped')
  assert.equal(remainder.question, '')
}

/* ------------------------------------------------------------------ */
/* Validator normalization regressions                                */
/* ------------------------------------------------------------------ */

function chemGrounding() {
  const targets = [{
    id: 't1', label: 'Reacción directa del N2O4', statement: 'La reacción directa produce NO2 a partir de N2O4.',
    sourceSpans: [{ page: 7, quote: 'La reacción directa del N₂O₄ produce NO₂ según la ley de velocidad v = kf [N₂O₄].' }],
  }] as any
  return buildRepasoRecoveryQuestionGrounding({ targetIds: ['t1'], pages: [7] } as any, targets)
}

function testValidatorAcceptsUnicodeSubscriptVariants() {
  const grounding = chemGrounding()
  assert.equal(isSpecificRepasoRecoveryQuestion('Explica cómo ocurre la reacción directa del N2O4.', grounding.targets), true)
  assert.equal(isRepasoRecoveryQuestionSupported('Explica cómo ocurre la reacción directa del N2O4.', grounding), true)
  assert.equal(isRepasoRecoveryQuestionSupported('Explica cómo ocurre la reacción directa del N₂O₄.', grounding), true, 'unicode subscript form must be recognized as the same term')
  assert.equal(isRepasoRecoveryQuestionSupported('Explica cómo ocurre la reaccion directa del n2o4.', grounding), true, 'accent/case variants must normalize the same way')
}

function testValidatorRejectsGenericQuestions() {
  const grounding = chemGrounding()
  for (const bad of ['¿Cuál es la idea principal?', 'Explica este concepto.', '¿Qué aprendiste?', 'Describe el contexto.']) {
    assert.equal(isSpecificRepasoRecoveryQuestion(bad, grounding.targets), false, `must reject generic question: ${bad}`)
  }
}

function testValidatorRejectsUnsupportedRelation() {
  const targets = [{
    id: 'keq', label: 'Constante de equilibrio Keq', statement: 'Keq caracteriza la composición del sistema en equilibrio.',
    sourceSpans: [{ page: 8, quote: 'La constante de equilibrio Keq caracteriza la composición del sistema cuando alcanza el equilibrio.' }],
  }] as any
  const grounding = buildRepasoRecoveryQuestionGrounding({ targetIds: ['keq'], pages: [8] } as any, targets)
  assert.equal(isRepasoRecoveryQuestionSupported('¿Qué caracteriza la constante de equilibrio Keq?', grounding), true)
  assert.equal(isRepasoRecoveryQuestionSupported('¿Cómo se relaciona Keq con kf y kr?', grounding), false, 'a relationship absent from the readable evidence must stay rejected')
}

function main() {
  testValidatorAcceptsUnicodeSubscriptVariants()
  testValidatorRejectsGenericQuestions()
  testValidatorRejectsUnsupportedRelation()
  console.log('repaso-recovery-question-authoring-contracts (validator unit tests): PASS')
}

main()

testLiveChemistryGroupRegression()
  .then(() => console.log('repaso-recovery-question-authoring-contracts: ALL PASS'))
  .catch(error => { console.error(error); process.exit(1) })
