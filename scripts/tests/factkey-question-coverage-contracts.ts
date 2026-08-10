import assert from 'node:assert/strict'
import {
  diagnoseEvaluationBlock, diagnoseEvaluationCoverage, runSessionPreparationFactory,
  type EvaluationPlan, type PreparedEvaluationBlock, type PreparedEvaluationQuestion,
  type PreparedTeachingContent,
} from '../../lib/ai/sessionPreparationFactory'
import { canonicalizeGeneratedSession, validateGeneratedSessionEvaluation } from '../../lib/adaptive/evaluation/sessionEvaluation'
import { missingRequiredFactKeys } from '../../lib/adaptive/evaluation/questionContract'

// FASE 1 — QUESTION COVERAGE (B): un factKey enseñado puede tener identidad
// evaluable estable (AssessmentObjective, ya arreglado) y AUN ASÍ nunca ser
// targeteado por ninguna pregunta real. Evidencia determinista previa (mismo
// caso, ejecutado con las funciones reales antes de este fix):
//   1 step, 3 keyPoints, 5 factKeys, preguntas cubren solo F1/F2/F3
//   → calculateAssessmentCoverage=1, canCompleteSessionFromAssessment=true,
//     canonicalizeGeneratedSession aceptaba la sesión — F4/F5 nunca evaluados.
//
// requiredFactKeys sale de block.coveredFactKeys (declarado en el plan desde
// el contenido enseñado real — buildDeterministicEvaluationPlan:
// uniq(steps.flatMap(s=>s.factKeys)) — NUNCA de objectives). coveredFactKeys
// sale exclusivamente de targetFactKeys de preguntas ya aceptadas (pasaron
// los checks de validez/duplicado). missingRequiredFactKeys() es la única
// definición de "missing factKeys", reusada tanto por diagnoseEvaluationBlock
// (preparación incremental) como por el STRICT COVERAGE BLOCKER
// (canonicalización final) — nunca dos implementaciones distintas.

const topics = [
  { text: '¿Qué papel cumple la fotosíntesis en la producción de energía celular?', options: ['La luz solar se convierte en glucosa', 'El oxígeno se convierte en dióxido de carbono'] },
  { text: 'Describe la función principal de la mitocondria dentro de la célula eucariota.', options: ['Genera ATP mediante respiración', 'Almacena información genética'] },
  { text: '¿Cuáles fueron las causas económicas que detonaron la revolución de 1910?', options: ['Desigualdad en la tenencia de tierra', 'Crecimiento del comercio exterior'] },
  { text: 'Calcula el cambio de entropía en un proceso termodinámico irreversible.', options: ['La entropía del universo aumenta', 'La entropía del universo permanece constante'] },
  { text: '¿Cómo afecta la gravedad la trayectoria de un proyectil lanzado horizontalmente?', options: ['Curva la trayectoria hacia abajo', 'Mantiene la trayectoria recta'] },
]
const mkq = (id: string, targetKeyPointIds: string[], targetFactKeys: string[], topic: typeof topics[number]): PreparedEvaluationQuestion => ({
  questionId: id, id, blockId: 'block_1', targetStepIds: ['step_1'], targetKeyPointIds, targetFactKeys,
  targetObjectiveIds: [], cognitiveTarget: 'comprehension', format: 'multiple_choice', prompt: topic.text,
  options: topic.options.map((text, i) => ({ id: i === 0 ? 'a' : 'b', text })), correctAnswer: 'a', feedback: 'ok', difficulty: 'medium',
})

const teaching: PreparedTeachingContent = {
  sessionId: 'fk-session', title: 't', introduction: 'i', closing: 'c',
  steps: [{
    stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'Step 1', type: 'concept', content: 'contenido',
    keyPoints: ['Punto 1', 'Punto 2', 'Punto 3'], keyPointIds: ['step_1:kp:1', 'step_1:kp:2', 'step_1:kp:3'],
    factKeys: ['F1', 'F2', 'F3', 'F4', 'F5'], importance: 'important', cognitiveTarget: 'comprehension', sourceReferences: [],
  }],
}
const block: PreparedEvaluationBlock = {
  blockId: 'block_1', afterStepId: 'step_1', coveredStepIds: ['step_1'],
  coveredKeyPointIds: ['step_1:kp:1', 'step_1:kp:2', 'step_1:kp:3'], coveredFactKeys: ['F1', 'F2', 'F3', 'F4', 'F5'],
  targetObjectiveIds: [], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 3,
  recommendedFormats: ['multiple_choice'], difficulty: 'medium',
  questions: [
    mkq('q1', ['step_1:kp:1'], ['F1'], topics[0]),
    mkq('q2', ['step_1:kp:2'], ['F2'], topics[1]),
    mkq('q3', ['step_1:kp:3'], ['F3'], topics[2]),
  ],
}

function keyPointTextMap(t: PreparedTeachingContent) {
  return new Map(t.steps.flatMap(step => step.keyPointIds.map((id, index) => [id, step.keyPoints[index]] as const)))
}
function buildRawSession(t: PreparedTeachingContent, blocks: PreparedEvaluationBlock[]) {
  const text = keyPointTextMap(t)
  return {
    sessionIntro: t.introduction, sessionClosing: t.closing,
    steps: t.steps.map(step => ({ ...step, id: step.stepId })),
    evaluationBlocks: blocks.map(b => ({
      id: b.blockId, ...b,
      coveredKeyPoints: b.coveredKeyPointIds.map(id => text.get(id)).filter(Boolean),
      questions: b.questions.map(q => ({
        ...q, id: q.questionId, type: q.format, coveredStepIds: q.targetStepIds,
        coveredKeyPoints: q.targetKeyPointIds.map(id => text.get(id)).filter(Boolean),
        questionText: q.prompt, explanation: q.feedback, targetDimension: q.cognitiveTarget,
      })),
    })),
  }
}

function main() {
  // ============================================================
  // A — 3 keyPoints / 5 factKeys / preguntas F1-F3 → NO complete, en AMBAS capas.
  // ============================================================
  const blockDiagnosis = diagnoseEvaluationBlock(block, block.questions, teaching)
  assert.equal(blockDiagnosis.code, 'PARTIAL_EVALUATION_COVERAGE', `A: diagnoseEvaluationBlock debe detectar F4/F5 faltantes: ${JSON.stringify(blockDiagnosis)}`)
  assert.deepEqual(blockDiagnosis.missingFactKeys, ['F4', 'F5'])

  const coverageDiagnosis = diagnoseEvaluationCoverage(teaching, [block])
  assert.equal(coverageDiagnosis.code, 'PARTIAL_EVALUATION_COVERAGE')
  assert.deepEqual(coverageDiagnosis.missingFactKeys, ['F4', 'F5'])
  assert.ok(coverageDiagnosis.affectedBlockIds.includes('block_1'))

  const rawIncomplete = buildRawSession(teaching, [block])
  const canonicalIncomplete = canonicalizeGeneratedSession(rawIncomplete, { sessionId: teaching.sessionId, kind: 'learning', evaluationMode: 'mix_everything' })
  assert.equal(canonicalIncomplete.session, null, 'A: la canonicalización final debe rechazar la sesión con F4/F5 sin evaluar')
  assert.ok(canonicalIncomplete.errors.some(e => e.includes('SESSION_EVALUATION_COVERAGE:required_fact_keys')))
  assert.ok(canonicalIncomplete.errors.some(e => e.includes('F4') && e.includes('F5')))

  // ============================================================
  // B/C — repair añade UNA pregunta que cubre F4+F5 simultáneamente → complete.
  // ============================================================
  const repairQuestion = mkq('q4', ['step_1:kp:1', 'step_1:kp:2', 'step_1:kp:3'], ['F4', 'F5'], topics[3])
  const completedBlock: PreparedEvaluationBlock = { ...block, questions: [...block.questions, repairQuestion] }
  const completedBlockDiagnosis = diagnoseEvaluationBlock(completedBlock, completedBlock.questions, teaching)
  assert.equal(completedBlockDiagnosis.code, 'EVALUATION_COMPLETE', `B/C: una sola pregunta cubriendo F4+F5 debe cerrar la cobertura: ${JSON.stringify(completedBlockDiagnosis)}`)
  assert.deepEqual(completedBlockDiagnosis.missingFactKeys, [])

  const canonicalComplete = canonicalizeGeneratedSession(buildRawSession(teaching, [completedBlock]), { sessionId: teaching.sessionId, kind: 'learning', evaluationMode: 'mix_everything' })
  assert.ok(canonicalComplete.session, `B/C/F: la sesión completa (incl. factKeys) debe ser válida: ${JSON.stringify(canonicalComplete.errors)}`)
  assert.ok(!canonicalComplete.errors.some(e => e.includes('SESSION_EVALUATION_COVERAGE')), 'B/C: no debe quedar ningún error de cobertura estricta')

  // ============================================================
  // D — pregunta duplicate/invalid que targetea F5 NO cuenta como coverage.
  // ============================================================
  const duplicateOfQ4 = { ...repairQuestion, questionId: 'q4-duplicate', id: 'q4-duplicate' } // prompt idéntico → duplicado literal
  const withDuplicateOnly: PreparedEvaluationBlock = { ...block, questions: [...block.questions, duplicateOfQ4] }
  // q4-duplicate es literalmente el mismo prompt que repairQuestion, pero repairQuestion
  // NO está presente aquí — solo su duplicado tras haber sido aceptado una vez no aplica;
  // en su lugar probamos: dos preguntas IDÉNTICAS que targetean F4/F5, la segunda debe
  // rechazarse como duplicada y F4/F5 deben seguir figurando como missing.
  const withRepeatedRepair: PreparedEvaluationBlock = { ...block, questions: [...block.questions, repairQuestion, { ...repairQuestion, questionId: 'q4-again', id: 'q4-again' }] }
  const dupDiagnosis = diagnoseEvaluationBlock(withRepeatedRepair, withRepeatedRepair.questions, teaching)
  assert.deepEqual(dupDiagnosis.duplicateQuestionIds, ['q4-again'])
  // La primera copia (repairQuestion, aceptada) ya cubre F4/F5 por sí sola —
  // el duplicado NO debe contarse dos veces como cobertura (comportamiento de
  // Fase 1 bajo prueba). El bloque sigue PARTIAL por una razón distinta y ya
  // existente (requiredReplacementCount cuenta duplicados como slot a
  // reemplazar, no relacionado con factKeys) — lo relevante aquí es que
  // missingFactKeys quede vacío pese al duplicado.
  assert.deepEqual(dupDiagnosis.missingFactKeys, [], 'D: un duplicado no debe hacer que F4/F5 vuelvan a marcarse como missing si ya los cubre la copia aceptada')
  // Caso estricto: SOLO la copia duplicada existe (invalid: sin targetKeyPointIds → estructuralmente inválida) — F4/F5 deben seguir missing.
  const onlyInvalidCoversF5: PreparedEvaluationBlock = { ...block, questions: [...block.questions, { ...repairQuestion, questionId: 'q4-invalid', id: 'q4-invalid', targetKeyPointIds: [] }] }
  const invalidDiagnosis = diagnoseEvaluationBlock(onlyInvalidCoversF5, onlyInvalidCoversF5.questions, teaching)
  assert.deepEqual(invalidDiagnosis.invalidQuestionIds, ['q4-invalid'])
  assert.deepEqual(invalidDiagnosis.missingFactKeys, ['F4', 'F5'], 'D: una pregunta inválida que targetea F4/F5 no debe contar como cobertura')
  void withDuplicateOnly

  // ============================================================
  // E — restore conserva missingFactKeys (roundtrip de persistencia real).
  // ============================================================
  const restoredDiagnosis = JSON.parse(JSON.stringify(coverageDiagnosis))
  assert.deepEqual(restoredDiagnosis.missingFactKeys, coverageDiagnosis.missingFactKeys)

  // ============================================================
  // G — factKeys duplicados normalizados no inflan required coverage.
  // ============================================================
  assert.deepEqual(missingRequiredFactKeys(['F1', 'F1', 'F2'], []), ['F1', 'F2'], 'G: factKeys requeridos duplicados deben normalizarse a únicos')
  const stepWithDuplicateFacts: PreparedTeachingContent = {
    ...teaching,
    steps: [{ ...teaching.steps[0], factKeys: ['F1', 'F1', 'F2', 'F2', 'F3'] }],
  }
  const dedupedBlock: PreparedEvaluationBlock = { ...block, coveredFactKeys: ['F1', 'F1', 'F2', 'F2', 'F3'] }
  const dedupedDiagnosis = diagnoseEvaluationBlock(dedupedBlock, [mkq('qa', ['step_1:kp:1'], ['F1'], topics[0]), mkq('qb', ['step_1:kp:2'], ['F2'], topics[1]), mkq('qc', ['step_1:kp:3'], ['F3'], topics[2])], stepWithDuplicateFacts)
  assert.equal(dedupedDiagnosis.code, 'EVALUATION_COMPLETE', `G: 3 factKeys únicos cubiertos por 3 preguntas — no debe pedir más solo por la duplicación: ${JSON.stringify(dedupedDiagnosis)}`)

  // ============================================================
  // H — ningún factKey puede desaparecer por factKeys.length > keyPoints.length
  //     (independiente de #7 — esto es la capa de generación/coverage, no el
  //     modelo de AssessmentObjective).
  // ============================================================
  const fewerKeyPoints: PreparedTeachingContent = {
    sessionId: 'h-session', title: 't', introduction: 'i', closing: 'c',
    steps: [{
      stepId: 'step_h', id: 'step_h', microId: 'mh', title: 'Step H', type: 'concept', content: 'c',
      keyPoints: ['Único punto'], keyPointIds: ['step_h:kp:1'], // 1 solo keyPoint
      factKeys: ['H1', 'H2', 'H3', 'H4', 'H5'], // 5 factKeys — mismo patrón adversarial que #7
      importance: 'important', cognitiveTarget: 'comprehension', sourceReferences: [],
    }],
  }
  const blockH: PreparedEvaluationBlock = {
    blockId: 'block_h', afterStepId: 'step_h', coveredStepIds: ['step_h'], coveredKeyPointIds: ['step_h:kp:1'],
    coveredFactKeys: ['H1', 'H2', 'H3', 'H4', 'H5'], // block.coveredFactKeys NO está acotado por keyPoints.length
    targetObjectiveIds: [], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1,
    recommendedFormats: ['multiple_choice'], difficulty: 'medium',
    questions: [{ ...mkq('qh1', ['step_h:kp:1'], ['H1'], topics[0]), blockId: 'block_h', targetStepIds: ['step_h'] }], // solo H1 cubierto
  }
  const diagnosisH = diagnoseEvaluationBlock(blockH, blockH.questions, fewerKeyPoints)
  assert.equal(diagnosisH.code, 'PARTIAL_EVALUATION_COVERAGE')
  assert.deepEqual(diagnosisH.missingFactKeys, ['H2', 'H3', 'H4', 'H5'], 'H: con 1 solo keyPoint, los 5 factKeys siguen siendo individualmente exigibles — ninguno desaparece')

  console.log('factkey-question-coverage-contracts: A-H PASS')
}

async function testRestoreRetry() {
  // E (complementario) — restore/retry vía runSessionPreparationFactory real.
  // requiredReplacementCount para este bloque = missingFactKeys.length = 2
  // (mecanismo YA EXISTENTE, no tocado por Fase 1: el repair debe devolver
  // EXACTAMENTE ese conteo — additions.length !== requiredReplacementCount
  // lanza INCREMENTAL_EVALUATION_REPAIR_COUNT_INVALID). Dentro de ese conteo
  // exacto, UNA de las 2 preguntas cubre F4+F5 simultáneamente (demuestra C:
  // una pregunta puede cubrir varios factKeys legítimamente) — la unión de
  // targetFactKeys de las 2 preguntas es lo que cuenta, no 1 factKey por
  // pregunta.
  const scenario = { teaching, plan: { blocks: [block] } as EvaluationPlan }
  let durable: any = null
  let repairAttempts = 0
  const input = () => ({
    sessionKind: 'learning' as const, generationKey: 'fk-restore', evalPreference: 'mix_everything',
    load: async () => durable, persist: async (s: any) => { durable = structuredClone(s) },
    generateTeaching: async () => scenario.teaching,
    planEvaluations: async () => scenario.plan,
    generateEvaluationBlock: async (b: any) => ({ ...b, questions: block.questions }),
    repairEvaluationBlock: async (b: any, missing: any) => {
      repairAttempts += 1
      assert.deepEqual(missing.missingFactKeys, ['F4', 'F5'], 'el repair debe recibir exactamente los factKeys faltantes')
      return [
        mkq('q-repaired-both', ['step_1:kp:1', 'step_1:kp:2', 'step_1:kp:3'], ['F4', 'F5'], topics[3]),
        mkq('q-repaired-extra', ['step_1:kp:1'], ['F4'], topics[4]),
      ]
    },
  })
  const first = await runSessionPreparationFactory(input())
  assert.equal(first.preparationStatus, 'ready', 'el repair debe resolver F4/F5 en un solo intento (una pregunta puede cubrir varios factKeys)')
  assert.equal(repairAttempts, 1)
  assert.ok(first.generatedEvaluationBlocks[0].questions.some(q => q.questionId === 'q-repaired-both' && q.targetFactKeys.includes('F4') && q.targetFactKeys.includes('F5')))

  // Restore real: segundo request con el mismo estado persistido no debe volver a reparar nada.
  const second = await runSessionPreparationFactory(input())
  assert.equal(second.preparationStatus, 'ready')
  assert.equal(repairAttempts, 1, 'restore no debe re-disparar un repair ya resuelto')
  const finalCoverage = diagnoseEvaluationCoverage(scenario.teaching, second.generatedEvaluationBlocks)
  assert.equal(finalCoverage.code, 'EVALUATION_COMPLETE')
  assert.deepEqual(finalCoverage.missingFactKeys, [])

  // F — preparation complete implica final validation complete también para factKeys.
  const rawRestored = buildRawSession(scenario.teaching, second.generatedEvaluationBlocks)
  const canonicalRestored = canonicalizeGeneratedSession(rawRestored, { sessionId: scenario.teaching.sessionId, kind: 'learning', evaluationMode: 'mix_everything' })
  assert.ok(canonicalRestored.session, `F: preparation ready debe implicar canonicalización válida: ${JSON.stringify(canonicalRestored.errors)}`)
  const finalValidation = validateGeneratedSessionEvaluation(canonicalRestored.session!, 'mix_everything', 'learning')
  assert.equal(finalValidation.valid, true)

  console.log('factkey-question-coverage-contracts: E (restore/retry) + F PASS')
}

main()
void testRestoreRetry()
