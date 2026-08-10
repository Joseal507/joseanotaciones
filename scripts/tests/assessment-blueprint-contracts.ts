import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertRecoveryPreservesTarget,
  buildAssessmentBlueprint,
  calculateAssessmentCoverage,
  canCompleteSessionFromAssessment,
  getUnassessedObjectives,
  planAssessmentQuestions,
  recordAssessmentEvidence,
  validateQuestionAgainstAssessmentBlueprint,
  validateRecoveryAlignment,
} from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { validateExpectedItemCount } from '../../lib/ai/generationPipeline'

const steps = Array.from({ length: 6 }, (_, index) => ({
  id: `step-${index + 1}`,
  type: index === 2 ? 'connection' : 'concept',
  microId: `micro-${index + 1}`,
  factKeys: [`fact-${index + 1}`],
  cognitiveTarget: index === 2 ? 'transfer' as const : 'comprehension' as const,
  objectiveIds: [`objective-${index + 1}`],
  relatedBlockIds: [`fact-${index + 1}`],
  importance: 0.8,
}))

let blueprint = buildAssessmentBlueprint(steps, 'falcons-session')
assert.equal(blueprint.objectives.length, 6)
assert.equal(new Set(blueprint.objectives.map(objective => objective.objectiveId)).size, 6)
assert.equal(calculateAssessmentCoverage(blueprint), 0)
assert.equal(canCompleteSessionFromAssessment(blueprint), false)

for (const objective of blueprint.objectives.slice(0, 3)) {
  blueprint = recordAssessmentEvidence(blueprint, [objective.objectiveId], objective.factKeys, {
    valid: true, correct: true, independent: true, evidenceId: `evidence-${objective.objectiveId}`,
  })
}
assert.equal(calculateAssessmentCoverage(blueprint), 0.5)
assert.equal(getUnassessedObjectives(blueprint).length, 3)
assert.equal(canCompleteSessionFromAssessment(blueprint), false)

const missingPlan = planAssessmentQuestions({
  objectives: getUnassessedObjectives(blueprint),
  evaluationPreference: 'quick_test',
})
assert.equal(missingPlan.plannedQuestions.length, 3)
assert.equal(missingPlan.projectedCoverage, 1)
assert.ok(missingPlan.plannedQuestions.every(question => !question.preferredTypes.includes('short_response')))

const objective = blueprint.objectives[3]
const aligned = {
  targetObjectiveIds: [objective.objectiveId],
  microId: objective.microId,
  factKeys: objective.factKeys,
  cognitiveTarget: objective.cognitiveTarget,
  questionText: '¿Qué relación explica mejor la perseverancia y la conexión emocional?',
}
assert.equal(validateQuestionAgainstAssessmentBlueprint(aligned, blueprint).valid, true)
assert.equal(validateQuestionAgainstAssessmentBlueprint({
  ...aligned,
  questionText: 'Según el Paso 2, ¿qué estadio representa a Atlanta?',
}, blueprint).valid, false)

const drifted = {
  ...aligned,
  targetObjectiveIds: ['objective-1'],
  microId: 'stadium-identity',
  factKeys: ['stadium-fact'],
  questionText: '¿Qué estadio representa mejor la identidad de Atlanta?',
}
assert.deepEqual(validateRecoveryAlignment(aligned, drifted).errors, ['RECOVERY_TARGET_DRIFT'])
assert.throws(() => assertRecoveryPreservesTarget(aligned, drifted), /RECOVERY_TARGET_DRIFT/)
assert.doesNotThrow(() => assertRecoveryPreservesTarget(aligned, { ...aligned }))

assert.equal(validateQuestionAgainstAssessmentBlueprint({
  targetObjectiveIds: ['objective-4', 'objective-5'],
  microId: 'micro-4',
  factKeys: ['fact-4', 'fact-5'],
  cognitiveTarget: 'comprehension',
  questionText: 'Selecciona la explicación que exige utilizar ambas relaciones.',
}, blueprint).valid, false)

assert.deepEqual(validateExpectedItemCount(1, 1), { valid: true, errors: [] })
assert.ok(!validateExpectedItemCount(0, 1).errors.some(error => error.includes('requires_1_questions')))

for (const pending of getUnassessedObjectives(blueprint)) {
  blueprint = recordAssessmentEvidence(blueprint, [pending.objectiveId], pending.factKeys, {
    valid: true, correct: true, independent: true,
  })
}
assert.equal(calculateAssessmentCoverage(blueprint), 1)
assert.equal(canCompleteSessionFromAssessment(blueprint), true)

const sessionEvalRoute = readFileSync('app/api/adaptive/session-eval/route.ts', 'utf8')
const sessionTeachRoute = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
const sessionPage = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')
assert.doesNotMatch(sessionEvalRoute, /evaluation_question_regenerated_by_mode/)
assert.ok(!sessionPage.includes('for (let attempt = 1; attempt <= 3'))
assert.match(sessionTeachRoute, /runSessionContentGenerationPipeline[^]*generationKey/)
assert.match(sessionTeachRoute, /canonicalizeGeneratedSession\(result/)
assert.match(sessionTeachRoute, /evaluationBlocks/)
assert.doesNotMatch(sessionPage, /function prepareNormalEvaluation/)
assert.match(sessionPage, /startEvaluationBlock\(block\)/)
assert.match(sessionPage, /includeVerificationQuestions:\s*true/)

console.log('assessment-blueprint-contracts: 25 contracts PASS')
