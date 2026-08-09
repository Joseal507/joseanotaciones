import assert from 'node:assert/strict'
import { resolveAcademicDomain, type AcademicDomain } from '../../lib/adaptive/academicDomain'
import { planEvaluation, type EvaluationMode } from '../../lib/adaptive/evaluation/assessmentPlanner'
import { validateMaterialInvariantSession, type MaterialInvariantStep } from '../../lib/adaptive/generalityBarrier'
import { deriveNextSessionAction } from '../../lib/adaptive/sessionFinalTransition'
import {
  beginRecoveryReteach, beginRecoveryVerification, createRecoveryQueue,
  persistRecoveryVerificationQuestions, presentRecoveryVerificationQuestion,
  recordRecoveryCheck, recordRecoveryReteachContent,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

const domains: AcademicDomain[] = [
  'general_conceptual', 'mathematics', 'physics_quantitative', 'chemistry_quantitative',
  'chemistry_conceptual', 'biology', 'medicine', 'history', 'language', 'law', 'mixed',
]
const sizes = [1, 2, 5, 12, 27]
const modes: EvaluationMode[] = ['quick_test', 'write_explain', 'mix_everything']

let seed = 0x51a7c0de
const next = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed
}
const pick = <T>(values: readonly T[]): T => values[next() % values.length]

function opaqueId(prefix: string, caseIndex: number, position: number): string {
  return `${prefix}-${caseIndex.toString(36)}-${(position * 37 + 11).toString(36)}`
}

for (let caseIndex = 0; caseIndex < 5_000; caseIndex += 1) {
  const domain = pick(domains)
  const stepCount = pick(sizes)
  const mode = pick(modes)
  assert.equal(resolveAcademicDomain({ persistedDomain: domain }).academicDomain, domain)

  const steps: MaterialInvariantStep[] = Array.from({ length: stepCount }, (_, position) => ({
    id: opaqueId('node', caseIndex, position),
    importance: pick(['supporting', 'important', 'critical'] as const),
    keyPointIds: Array.from({ length: 1 + next() % 4 }, (_, keyPointIndex) =>
      opaqueId(`objective-${position}`, caseIndex, keyPointIndex)),
  }))
  if (steps.every(step => step.importance === 'supporting')) steps[0].importance = 'important'

  const blockSize = 1 + next() % 6
  const blocks = []
  for (let start = 0; start < steps.length; start += blockSize) {
    const blockSteps = steps.slice(start, start + blockSize)
    const coveredKeyPointIds = blockSteps.flatMap(step => step.keyPointIds)
    blocks.push({
      id: opaqueId('checkpoint', caseIndex, start),
      coveredStepIds: blockSteps.map(step => step.id),
      coveredKeyPointIds,
      questionTargetStepIds: coveredKeyPointIds.map(id => [blockSteps.find(step => step.keyPointIds.includes(id))!.id]),
      questionTargetKeyPointIds: coveredKeyPointIds.map(id => [id]),
    })
  }

  const invariant = validateMaterialInvariantSession({ kind: 'learning', steps, evaluationBlocks: blocks })
  assert.deepEqual(invariant.errors, [])
  assert.equal(invariant.coveredObjectiveCount, invariant.requiredObjectiveCount)

  const objectives = steps.flatMap(step => step.keyPointIds.map((id, objectiveIndex) => ({
    id,
    conceptId: step.id,
    conceptLabel: `Concept ${caseIndex}-${objectiveIndex}`,
    importance: step.importance === 'critical' ? 'high' as const : step.importance === 'important' ? 'medium' as const : 'low' as const,
    cognitiveLevel: pick(['recognition', 'comprehension', 'application', 'transfer'] as const),
    sourceStepId: step.id,
    sourceKeyPoint: id,
  })))
  const evaluation = planEvaluation(objectives, mode)
  assert.ok(evaluation.totalQuestions >= objectives.length)
  assert.equal(evaluation.questions.length, evaluation.totalQuestions)
  assert.ok(evaluation.questions.every(question => objectives.some(objective => objective.id === question.objectiveId)))

  const finalAction = deriveNextSessionAction({
    currentStepIndex: stepCount - 1,
    currentEvaluationBlock: blocks.length ? { id: blocks.at(-1)!.id, completed: true } : null,
    currentQuestionIndex: evaluation.totalQuestions,
    unansweredNormalQuestions: 0,
    pendingRecoveries: 0,
    activeRecovery: false,
    completedEvaluationBlocks: blocks.length,
    totalEvaluationBlocks: blocks.length,
    totalTeachingSteps: stepCount,
    sessionKind: 'learning',
    sessionCompletionResult: { isSessionComplete: true, objectiveCoverageRatio: 1 },
  })
  assert.deepEqual(finalAction, { type: 'complete_session' })
}

for (const incidental of ['Fundado en 1987', 'Capítulo XLII', 'ID record-2048', 'Resultado 75% favorable']) {
  assert.equal(resolveAcademicDomain({ materialTitle: incidental }).academicDomain, 'general_conceptual')
}

const introduction = validateMaterialInvariantSession({
  kind: 'introduction',
  steps: Array.from({ length: 4 }, (_, index) => ({ id: `orientation-${index}`, keyPointIds: [], importance: 'supporting' })),
  evaluationBlocks: [],
})
assert.equal(introduction.valid, true)

const finalReview = validateMaterialInvariantSession({
  kind: 'final_review',
  steps: [{ id: 'integration-node', keyPointIds: [], importance: 'supporting' }],
  evaluationBlocks: [],
})
assert.equal(finalReview.valid, true)

const recoveryQuestion = (id: string, family: string): CanonicalQuestion => ({
  id, conceptId: 'opaque-concept', conceptLabel: 'Concepto objetivo', teachingBlockId: 'opaque-step',
  questionFamily: family, variant: 'mcq_best_answer', format: 'multiple_choice', difficulty: 'medium',
  targetDimension: 'comprehension', questionText: `¿Qué relación corresponde al objetivo? ${id}`,
  options: [{ id: 'a', text: 'Relación válida' }, { id: 'b', text: 'Relación incompatible' }],
  correctAnswer: 'a', explanation: 'La relación válida conserva el objetivo.', hint: 'Compara las relaciones.',
  estimatedSeconds: 30, evidencesNeeded: 1, factKey: 'opaque-fact', factKeys: ['opaque-fact'],
  coveredStepIds: ['opaque-step'], coveredKeyPointIds: ['opaque-key-point'], coveredKeyPoints: ['Relación objetivo'],
})
let recovery = createRecoveryQueue([{
  question: recoveryQuestion('normal-source', 'normal-family'), answer: 'b',
  result: { outcome: 'incorrect', correct: false, errorType: 'conceptual' },
}])[0]
for (let round = 1; round <= 20; round += 1) {
  recovery = beginRecoveryReteach(recovery, `strategy-${round}`)
  recovery = recordRecoveryReteachContent(recovery, `Explicación específica e independiente para la ronda ${round}.`)
  recovery = beginRecoveryVerification(recovery)
  const checks = [
    recoveryQuestion(`round-${round}-v1`, `deterministic_recovery_${round}_a`),
    recoveryQuestion(`round-${round}-v2`, `deterministic_recovery_${round}_b`),
  ]
  recovery = persistRecoveryVerificationQuestions(recovery, checks, round * 100)
  for (const check of checks) {
    const presented = presentRecoveryVerificationQuestion(recovery, round * 100 + 1)
    assert.equal(presented.question?.id, check.id)
    recovery = recordRecoveryCheck(presented.item, check, { outcome: 'incorrect', correct: false, errorType: 'conceptual' }, 'independent', 'b').item
  }
  assert.equal(recovery.status, 'pending_reteach')
  assert.equal(recovery.microId, 'opaque-concept')
  assert.deepEqual(recovery.sourceStepIds, ['opaque-step'])
  assert.deepEqual(recovery.sourceKeyPoints, ['Relación objetivo'])
  assert.equal(recovery.totalStudentFailureRounds, round)
}
assert.notEqual(recovery.status, 'unresolved')

console.log('adaptive-generality-generative-contracts: 5000 deterministic cases PASS')
