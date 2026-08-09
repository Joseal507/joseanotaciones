import assert from 'node:assert/strict'
import {
  MAX_VERIFICATION_GENERATION_ATTEMPTS,
  createRecoveryQueue,
  validateRecoveryTargetAlignment,
  type RecoveryFailure,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import type { SessionEvaluationQuestion } from '../../lib/adaptive/evaluation/sessionEvaluation'

function question(id: string, stepId: string, keyPoint: string, factKey: string): SessionEvaluationQuestion {
  return {
    id,
    conceptId: 'micro-1',
    conceptLabel: 'Concepto objetivo',
    teachingBlockId: stepId,
    questionFamily: `family-${id}`,
    variant: 'mcq_best_answer',
    difficulty: 'medium',
    targetDimension: 'comprehension',
    format: 'multiple_choice',
    questionText: `¿Qué afirmación demuestra ${keyPoint}?`,
    options: [{ id: 'a', text: 'Correcta' }, { id: 'b', text: 'Incorrecta' }],
    correctAnswer: 'a',
    explanation: `Explicación académica de ${keyPoint}.`,
    hint: 'Contrasta ambas opciones.',
    estimatedSeconds: 30,
    evidencesNeeded: 1,
    factKey,
    factKeys: [factKey],
    targetObjectiveIds: [`objective-${keyPoint}`],
    coveredStepIds: [stepId],
    coveredKeyPoints: [keyPoint],
  }
}

function failure(source: SessionEvaluationQuestion): RecoveryFailure {
  return {
    question: source,
    answer: 'b',
    result: { outcome: 'incorrect', correct: false, errorType: 'conceptual' },
  }
}

assert.ok(MAX_VERIFICATION_GENERATION_ATTEMPTS >= 2, 'el pipeline de generación admite al menos dos llamadas técnicas por ronda')

const firstQuestion = question('q-1', 'step-1', 'kp-1', 'fact-1')
const secondQuestion = question('q-2', 'step-1', 'kp-2', 'fact-2')
const queue = createRecoveryQueue([failure(firstQuestion), failure(secondQuestion)])
assert.equal(queue.length, 2, 'dos fallos distintos conservan targets distintos aunque compartan micro')

const first = queue[0]
assert.equal(first.sourceQuestionId, 'q-1')
assert.deepEqual(first.sourceStepIds, ['step-1'])
assert.deepEqual(first.sourceKeyPoints, ['kp-1'])
assert.deepEqual(first.sourceFactKeys, ['fact-1'])
assert.equal(first.roundId, `${first.recoveryId}:round:0`)
assert.equal(first.roundNumber, 0)
assert.equal(first.originalExplanation, firstQuestion.explanation)
assert.equal(first.latestFailedVerification, null)

assert.deepEqual(validateRecoveryTargetAlignment(first, firstQuestion), { valid: true, errors: [] })
const drifted = { ...firstQuestion, coveredKeyPoints: ['kp-neighbor'] }
assert.deepEqual(validateRecoveryTargetAlignment(first, drifted), {
  valid: false,
  errors: ['RECOVERY_TARGET_DRIFT'],
})

console.log('adaptive-recovery-target-contracts: 10 contracts PASS')
