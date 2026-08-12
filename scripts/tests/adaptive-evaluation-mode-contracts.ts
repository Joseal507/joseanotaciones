import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EVALUATION_MODE_VIOLATION,
  allowedQuestionTypesForObjective,
  evaluationModeContract,
  normalizeEvaluationMode,
  questionTypeCapabilities,
  validateQuestionTypeForMode,
} from '../../lib/adaptive/evaluation/evaluationModeContract'
import {
  normalizeGeneratedQuestion,
  validateQuestion,
  type GenerationContext,
} from '../../lib/adaptive/evaluation/questionContract'
import {
  buildSafeFallbackInteraction,
  prepareInteractionForDelivery,
  validateInteractionContract,
} from '../../lib/adaptive/v3/engine/interactionContract'
import { invalidScoreResult } from '../../lib/adaptive/evaluation/scoring'

const context: GenerationContext = {
  activeConceptId: 'micro-1',
  activeConceptLabel: 'Concepto',
  teachingBlockId: 'step-1',
  targetDimension: 'comprehension',
  questionFamily: 'verification',
  allowedConceptIds: ['micro-1'],
  forbiddenConceptIds: [],
  evaluationMode: 'quick_test',
}

const open = normalizeGeneratedQuestion({
  variant: 'short_answer_define',
  conceptId: 'micro-1',
  conceptLabel: 'Concepto',
  targetDimension: 'comprehension',
  difficulty: 'medium',
  questionText: 'Explica con tus palabras el concepto enseñado.',
  correctAnswer: 'Respuesta esperada suficientemente completa',
  explanation: 'Explicación.',
  hint: 'Pista.',
}, context, 'open-1')!

const closed = normalizeGeneratedQuestion({
  variant: 'mcq_best_answer',
  conceptId: 'micro-1',
  conceptLabel: 'Concepto',
  targetDimension: 'comprehension',
  difficulty: 'medium',
  questionText: 'Selecciona la mejor explicación del concepto enseñado.',
  options: [{ id: 'a', text: 'Explicación adecuada' }, { id: 'b', text: 'Explicación incompatible' }],
  correctAnswer: 'a',
  explanation: 'Explicación.',
  hint: 'Pista.',
}, context, 'closed-1')!

assert.equal(normalizeEvaluationMode('quick_no_typing'), 'quick_test')
const quick = evaluationModeContract('quick_test')
assert.equal(quick.allowsTyping, false)
assert.equal(quick.allowsFreeText, false)
assert.equal(quick.allowsLongForm, false)
assert.equal(quick.requiresQuickInteraction, true)

for (const type of ['multiple_choice', 'multi_select', 'true_false', 'word_bank', 'matching', 'ordering', 'classify', 'scenario', 'find_the_error']) {
  assert.equal(validateQuestionTypeForMode('quick_test', type).valid, true, `${type} debe estar permitido`)
  assert.equal(questionTypeCapabilities(type).isClosedResponse, true)
}
for (const type of ['short_response', 'open_response', 'fill_blank', 'numeric_problem', 'numeric_short', 'practical_case', 'prediction']) {
  const result = validateQuestionTypeForMode('quick_test', type)
  assert.equal(result.valid, false, `${type} debe estar prohibido`)
  if (!result.valid) assert.equal(result.reason, EVALUATION_MODE_VIOLATION)
}

assert.ok(allowedQuestionTypesForObjective('quick_test', 'sequencing procedure').includes('ordering'))
assert.ok(allowedQuestionTypesForObjective('quick_test', 'association relation').includes('matching'))
assert.ok(allowedQuestionTypesForObjective('quick_test', 'multi component classification').includes('classify'))
assert.ok(allowedQuestionTypesForObjective('quick_test', 'recall completion').includes('word_bank'))

assert.ok(validateQuestion(open, context).errors.includes(EVALUATION_MODE_VIOLATION))
assert.equal(validateQuestion(closed, context).valid, true)
assert.equal(validateQuestionTypeForMode('write_explain', open.format).valid, true)

const interactionContext = {
  microId: 'micro-1',
  microName: 'Concepto',
  objective: 'test_transfer',
  sourceText: 'El material presenta una relación explícita entre dos ideas.',
}
const incompatibleInteraction = {
  id: 'open-i',
  questionId: 'open-i',
  factKey: 'micro-1:production',
  interactionType: 'open_response',
  prompt: 'Explica la relación con tus propias palabras.',
  data: { acceptedAnswers: ['relación'] },
}
assert.ok(validateInteractionContract(incompatibleInteraction, 'quick_test').some(error => error.includes(EVALUATION_MODE_VIOLATION)))
const prepared = prepareInteractionForDelivery(incompatibleInteraction, 'quick_test', interactionContext)
assert.equal(validateQuestionTypeForMode('quick_test', prepared.interaction.interactionType).valid, true)
assert.equal(prepared.status, 'safe_fallback')
const fallback = buildSafeFallbackInteraction('quick_test', interactionContext)
assert.equal(validateQuestionTypeForMode('quick_test', fallback.interactionType).valid, true)

const restored = JSON.parse(JSON.stringify({
  adaptiveSetup: { evalPreference: 'quick_test', completedAt: 100 },
  currentSessionNumber: 2,
  status: 'completed',
}))
assert.equal(restored.adaptiveSetup.evalPreference, 'quick_test')
assert.equal(normalizeEvaluationMode(restored.adaptiveSetup.evalPreference), 'quick_test')

const invalid = invalidScoreResult()
assert.equal(invalid.outcome, 'invalid')
assert.equal(invalid.correct, false)
assert.equal(invalid.needsReteaching, false)

const evalRouteSource = readFileSync('app/api/adaptive/session-eval/route.ts', 'utf8')
const sessionPageSource = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')
assert.ok(evalRouteSource.includes("runGenerationPipeline<QuestionBatch>"))
assert.ok(!evalRouteSource.includes('recoveryFallbackQuestions'))
assert.ok(!evalRouteSource.includes('mode_safe_fallback'))
assert.ok(sessionPageSource.includes('evaluation_mode_frontend_blocked'))
assert.ok(!sessionPageSource.includes('NEXT_PUBLIC_ENABLE_EXTREME_RECOVERY_FALLBACK'))
assert.ok(!sessionPageSource.includes('createDeterministicRecoveryFallback'))
assert.ok(!sessionPageSource.includes('{/* FALLBACK TEXT */}'))

console.log('adaptive-evaluation-mode-contracts: 38 invariantes PASS')
