import { presentAnswer } from './answerPresentation'
import {
  validateQuestion,
  type CanonicalQuestion,
  type CanonicalUserAnswer,
  type GenerationContext,
} from './questionContract'
import { validateQuestionTypeForMode } from './evaluationModeContract'
import type { MaterialLanguage } from '../../materialLanguage'

export interface DeterministicRecoveryFallbackInput {
  sourceQuestion: CanonicalQuestion
  studentAnswer: CanonicalUserAnswer
  evaluationMode: unknown
  roundNumber: number
  teachingContent?: string
  // Content language authority for this recovery round (same resolution as
  // the LLM path this fallback replaces) — 'und'/unsupported falls back to
  // English microcopy, never Spanish, so an English material never flips.
  materialLanguage?: MaterialLanguage
}

// This deterministic path has no model call to defer to — it needs its own
// static microcopy. Only the two languages StudyAL actually authors content
// in are hand-written; anything else (including 'und') resolves to English,
// which is never a silent mismatch the way defaulting to Spanish would be.
const FALLBACK_COPY = {
  en: {
    genericDistractor: 'An interpretation that does not match the evidence taught.',
    alternateDistractor: (n: number) => `Alternative interpretation ${n} not supported by the content.`,
    selectionPrompt: (conceptLabel: string) => `Select the answer supported by the explanation of ${conceptLabel}.`,
    selectionHint: 'Compare each option against the explanation you just studied.',
    claimPrompt: (conceptLabel: string, statement: string) => `Based on what you just studied about ${conceptLabel}, this statement is correct: "${statement}"`,
    claimHint: 'Compare the statement against the explanation you just studied — do not assume it is true.',
  },
  es: {
    genericDistractor: 'Una interpretación que no coincide con la evidencia enseñada.',
    alternateDistractor: (n: number) => `Interpretación alternativa ${n} no respaldada por el contenido.`,
    selectionPrompt: (conceptLabel: string) => `Selecciona la respuesta respaldada por la explicación de ${conceptLabel}.`,
    selectionHint: 'Contrasta cada opción con la explicación que acabas de estudiar.',
    claimPrompt: (conceptLabel: string, statement: string) => `Según lo que acabas de estudiar sobre ${conceptLabel}, esta afirmación es correcta: "${statement}"`,
    claimHint: 'Contrasta la afirmación con la explicación que acabas de estudiar, no la des por cierta.',
  },
} as const

function fallbackCopy(language: MaterialLanguage | undefined) {
  return language === 'es' ? FALLBACK_COPY.es : FALLBACK_COPY.en
}

// Hash de cadena determinista y estable (mismo input => mismo output
// siempre, sin Math.random, para mantener el fallback 100% reproducible y
// testeable) — usado únicamente para alternar de forma no fija qué
// afirmación se muestra en la pregunta de tipo claim.
function stableHashIsOdd(value: string): boolean {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash % 2 === 1
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
  const { sourceQuestion, roundNumber, materialLanguage } = input
  const copy = fallbackCopy(materialLanguage)
  const expected = presentAnswer(sourceQuestion, sourceQuestion.correctAnswer, materialLanguage)
  const student = presentAnswer(sourceQuestion, input.studentAnswer, materialLanguage)
  const labels = uniqueLabels([
    expected,
    student,
    ...sourceOptionLabels(sourceQuestion),
    copy.genericDistractor,
  ])
  const distractors = labels.filter(label => label !== expected).slice(0, 3)
  while (distractors.length < 2) {
    distractors.push(copy.alternateDistractor(distractors.length + 1))
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
      questionText: copy.selectionPrompt(sourceQuestion.conceptLabel),
      options: [
        { id: 'expected', text: expected },
        ...distractors.map((text, index) => ({ id: `distractor_${index + 1}`, text })),
      ],
      correctAnswer: 'expected',
      explanation,
      hint: copy.selectionHint,
      estimatedSeconds: 30,
      evidencesNeeded: 1,
      factKey: `${prefix}:selection`,
    },
    // Auditoría adversarial (Codex, misión REAL-SESSION QUALITY, B2
    // CONFIRMADO P0): esta pregunta SIEMPRE mostraba la respuesta canónica
    // completa en el enunciado y SIEMPRE tenía correctAnswer=true —
    // adivinable con 0% de comprensión real (basta con responder
    // "Verdadero" sin leer nada), produciendo evidencia basura y false
    // mastery. Igual que cualquier true_false legítimo del resto del
    // sistema, la afirmación mostrada debe alternar de forma determinista
    // entre la respuesta esperada (verdadero) y un distractor real
    // (falso) — nunca fijo, nunca 100% adivinable, y ya no repite
    // literalmente la respuesta como si fuera un hecho dado.
    (() => {
      const claimUsesDistractor = distractors.length > 0 && stableHashIsOdd(`${prefix}:claim`)
      const claimStatement = claimUsesDistractor ? distractors[0] : expected
      return {
        id: `${prefix}:claim`,
        conceptId: sourceQuestion.conceptId,
        conceptLabel: sourceQuestion.conceptLabel,
        teachingBlockId: sourceQuestion.teachingBlockId,
        questionFamily: 'deterministic_recovery_claim',
        variant: 'true_false_factual',
        difficulty: 'easy',
        targetDimension: 'recognition',
        format: 'true_false',
        questionText: copy.claimPrompt(sourceQuestion.conceptLabel, claimStatement),
        options: null,
        correctAnswer: !claimUsesDistractor,
        explanation,
        hint: copy.claimHint,
        estimatedSeconds: 20,
        evidencesNeeded: 1,
        factKey: `${prefix}:claim`,
      }
    })(),
  ]
  const validation = validateDeterministicRecoveryFallback(questions, input)
  if (!validation.valid) {
    throw new Error(`INVALID_DETERMINISTIC_RECOVERY_FALLBACK:${validation.errors.join(',')}`)
  }
  return questions
}
