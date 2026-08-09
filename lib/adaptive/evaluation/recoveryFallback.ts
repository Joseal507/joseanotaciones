import { presentAnswer } from './answerPresentation'
import {
  validateQuestion,
  type CanonicalQuestion,
  type CanonicalUserAnswer,
  type GenerationContext,
} from './questionContract'
import { validateQuestionTypeForMode } from './evaluationModeContract'

export interface DeterministicRecoveryFallbackInput {
  sourceQuestion: CanonicalQuestion
  studentAnswer: CanonicalUserAnswer
  evaluationMode: unknown
  roundNumber: number
  teachingContent?: string
}

function uniqueLabels(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function sourceOptionLabels(question: CanonicalQuestion): string[] {
  if (!Array.isArray(question.options)) return []
  return question.options.flatMap(option => {
    if ('text' in option) return [option.text]
    if ('right' in option) return [option.right]
    return []
  })
}

export function validateDeterministicRecoveryFallback(
  questions: CanonicalQuestion[],
  input: DeterministicRecoveryFallbackInput,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (questions.length !== 2) errors.push('fallback_requires_exactly_two_questions')
  if (new Set(questions.map(question => question.id)).size !== questions.length) errors.push('duplicate_fallback_question_id')
  if (new Set(questions.map(question => question.factKey)).size !== questions.length) errors.push('duplicate_fallback_fact_key')
  for (const question of questions) {
    if (question.conceptId !== input.sourceQuestion.conceptId) errors.push('fallback_concept_mismatch')
    if (!validateQuestionTypeForMode(input.evaluationMode, question.format).valid) errors.push('fallback_mode_violation')
    const context: GenerationContext = {
      activeConceptId: input.sourceQuestion.conceptId,
      activeConceptLabel: input.sourceQuestion.conceptLabel,
      teachingBlockId: input.sourceQuestion.teachingBlockId,
      targetDimension: question.targetDimension,
      questionFamily: question.questionFamily,
      allowedConceptIds: [input.sourceQuestion.conceptId],
      forbiddenConceptIds: [],
      evaluationMode: input.evaluationMode,
    }
    errors.push(...validateQuestion(question, context, []).errors.map(error => `fallback:${error}`))
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

export function createDeterministicRecoveryFallback(
  input: DeterministicRecoveryFallbackInput,
): CanonicalQuestion[] {
  const { sourceQuestion, roundNumber } = input
  const expected = presentAnswer(sourceQuestion, sourceQuestion.correctAnswer)
  const student = presentAnswer(sourceQuestion, input.studentAnswer)
  const labels = uniqueLabels([
    expected,
    student,
    ...sourceOptionLabels(sourceQuestion),
    'Una interpretación que no coincide con la evidencia enseñada.',
  ])
  const distractors = labels.filter(label => label !== expected).slice(0, 3)
  while (distractors.length < 2) {
    distractors.push(`Interpretación alternativa ${distractors.length + 1} no respaldada por el contenido.`)
  }
  const prefix = `${sourceQuestion.id}:recovery:${roundNumber}`
  const explanation = input.teachingContent?.trim() || sourceQuestion.explanation
  const questions: CanonicalQuestion[] = [
    {
      id: `${prefix}:selection`,
      conceptId: sourceQuestion.conceptId,
      conceptLabel: sourceQuestion.conceptLabel,
      teachingBlockId: sourceQuestion.teachingBlockId,
      questionFamily: 'deterministic_recovery_selection',
      variant: 'mcq_best_answer',
      difficulty: 'medium',
      targetDimension: 'recognition',
      format: 'multiple_choice',
      questionText: `Selecciona la respuesta respaldada por la explicación de ${sourceQuestion.conceptLabel}.`,
      options: [
        { id: 'expected', text: expected },
        ...distractors.map((text, index) => ({ id: `distractor_${index + 1}`, text })),
      ],
      correctAnswer: 'expected',
      explanation,
      hint: 'Contrasta cada opción con la explicación que acabas de estudiar.',
      estimatedSeconds: 30,
      evidencesNeeded: 1,
      factKey: `${prefix}:selection`,
    },
    {
      id: `${prefix}:claim`,
      conceptId: sourceQuestion.conceptId,
      conceptLabel: sourceQuestion.conceptLabel,
      teachingBlockId: sourceQuestion.teachingBlockId,
      questionFamily: 'deterministic_recovery_claim',
      variant: 'true_false_factual',
      difficulty: 'easy',
      targetDimension: 'recognition',
      format: 'true_false',
      questionText: `La explicación del concepto respalda esta respuesta: ${expected}`,
      options: null,
      correctAnswer: true,
      explanation,
      hint: 'Decide si la afirmación coincide con la respuesta esperada.',
      estimatedSeconds: 20,
      evidencesNeeded: 1,
      factKey: `${prefix}:claim`,
    },
  ]
  const validation = validateDeterministicRecoveryFallback(questions, input)
  if (!validation.valid) {
    throw new Error(`INVALID_DETERMINISTIC_RECOVERY_FALLBACK:${validation.errors.join(',')}`)
  }
  return questions
}
