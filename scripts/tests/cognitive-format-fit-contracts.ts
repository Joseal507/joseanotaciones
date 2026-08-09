import assert from 'node:assert/strict'
import { validateCognitiveFormatFit } from '../../lib/adaptive/evaluation/cognitiveFormatFitValidator'
import { cognitiveLevelsForVariant } from '../../lib/adaptive/evaluation/pedagogicalFormatSelector'
import { diagnoseEvaluationBlock, type PreparedEvaluationQuestion, type PreparedTeachingContent, type EvaluationPlanBlock } from '../../lib/ai/sessionPreparationFactory'

// P3.2 — GUARD DE COMPATIBILIDAD COGNITIVA
//
// No es una cuota de variedad: es una verificación de compatibilidad usando
// FORMAT_LIBRARY (pedagogicalFormatSelector.ts) como única fuente de verdad de
// qué variants evalúan razonablemente qué nivel cognitivo. Bloquea el patrón que
// el reporte P3 pidió cerrar: "transfer" o "application" etiquetado sobre un
// variant que FORMAT_LIBRARY solo reconoce como recall literal.

assert.equal(validateCognitiveFormatFit({ cognitiveTarget: 'transfer', variant: 'true_false_factual' }).valid, false, 'transfer sobre true_false_factual (recall literal) debe bloquearse')
assert.equal(validateCognitiveFormatFit({ cognitiveTarget: 'transfer', variant: 'mcq_best_answer' }).valid, false, 'transfer sobre mcq_best_answer (recognition/comprehension/application, no transfer) debe bloquearse')
assert.equal(validateCognitiveFormatFit({ cognitiveTarget: 'application', variant: 'true_false_factual' }).valid, false, 'application sobre true_false_factual debe bloquearse — true_false solo cubre recognition/comprehension')

assert.equal(validateCognitiveFormatFit({ cognitiveTarget: 'transfer', variant: 'scenario_transfer' }).valid, true, 'transfer sobre scenario_transfer (variant real de FORMAT_LIBRARY con cognitiveMatch=[application,transfer]) debe permitirse')
assert.equal(validateCognitiveFormatFit({ cognitiveTarget: 'application', variant: 'scenario_apply_rule' }).valid, true, 'application sobre scenario_apply_rule debe permitirse')
assert.equal(validateCognitiveFormatFit({ cognitiveTarget: 'recognition', variant: 'true_false_factual' }).valid, true, 'recognition sobre true_false_factual debe permitirse (caso normal)')
assert.equal(validateCognitiveFormatFit({ cognitiveTarget: 'comprehension', variant: 'mcq_best_answer' }).valid, true, 'comprehension sobre mcq_best_answer debe permitirse')

// Fail-open ante datos no catalogados: no inventar taxonomía, no rechazar por falta de dato.
assert.equal(validateCognitiveFormatFit({ cognitiveTarget: 'transfer', variant: 'variant_no_catalogado_xyz' }).valid, true, 'variant no catalogado en FORMAT_LIBRARY no debe rechazarse por este guard')
assert.equal(validateCognitiveFormatFit({ cognitiveTarget: 'transfer' }).valid, true, 'sin variant declarado, no hay nada que verificar')
assert.equal(validateCognitiveFormatFit({ variant: 'true_false_factual' }).valid, true, 'sin cognitiveTarget conocido, no hay nada que verificar')

// La función de lookup expone exactamente los niveles de FORMAT_LIBRARY — control
// de que no se duplicó la taxonomía en un lugar nuevo.
assert.deepEqual(new Set(cognitiveLevelsForVariant('true_false_factual')), new Set(['recognition', 'comprehension']), 'true_false_factual: recognition+comprehension, según FORMAT_LIBRARY')
assert.equal(cognitiveLevelsForVariant('variant_no_catalogado_xyz'), null, 'variant no catalogado devuelve null, no un array vacío (vacío implicaría "nunca válido")')

// Integración real con diagnoseEvaluationBlock: una pregunta transfer sobre un
// variant de recall literal debe entrar a invalidQuestionIds, igual que el
// validator de matching — misma puerta única de validez estructural.
const teaching: PreparedTeachingContent = { sessionId: 's', title: 't', introduction: 'i', closing: 'c', steps: [] }
const block: EvaluationPlanBlock = {
  blockId: 'b1', afterStepId: 's1', coveredStepIds: ['s1'], coveredKeyPointIds: ['s1:kp:1'],
  coveredFactKeys: ['fact-1'], targetObjectiveIds: ['s1:objective:transfer'], cognitiveTargets: ['transfer'],
  recommendedQuestionCount: 1, recommendedFormats: ['true_false'], difficulty: 'hard',
}
const badTransferQuestion: PreparedEvaluationQuestion = {
  questionId: 'q-bad-transfer', blockId: 'b1', targetStepIds: ['s1'], targetKeyPointIds: ['s1:kp:1'],
  targetFactKeys: ['fact-1'], targetObjectiveIds: ['s1:objective:transfer'], cognitiveTarget: 'transfer',
  format: 'true_false', variant: 'true_false_factual', prompt: '¿Es correcto que X?', correctAnswer: true,
  feedback: 'x', difficulty: 'hard',
}
const diag = diagnoseEvaluationBlock(block, [badTransferQuestion], teaching, 'mix_everything')
assert.deepEqual(diag.invalidQuestionIds, ['q-bad-transfer'], 'transfer + true_false_factual debe marcarse inválido dentro de diagnoseEvaluationBlock (misma puerta que matching)')
assert.equal(diag.acceptedQuestionIds.includes('q-bad-transfer'), false)

const goodTransferQuestion: PreparedEvaluationQuestion = {
  ...badTransferQuestion, questionId: 'q-good-transfer', format: 'scenario', variant: 'scenario_transfer',
}
const diagGood = diagnoseEvaluationBlock(block, [goodTransferQuestion], teaching, 'mix_everything')
assert.deepEqual(diagGood.invalidQuestionIds, [], 'transfer + scenario_transfer debe aceptarse')
assert.deepEqual(diagGood.acceptedQuestionIds, ['q-good-transfer'])

console.log('cognitive-format-fit-contracts: 13 contracts PASS')
