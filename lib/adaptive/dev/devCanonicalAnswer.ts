import type { CanonicalQuestion, CanonicalUserAnswer } from '../evaluation/questionContract'

// Herramienta DEV-ONLY (ver lib/dev/devTools.ts) para recorrer sesiones rápido en
// QA/UX sin responder manualmente decenas de preguntas. Construye la respuesta
// CANÓNICA correcta en el MISMO formato/shape que produciría la interacción real
// del estudiante para cada tipo de pregunta — NUNCA marca correct=true
// directamente ni toca mastery/evidence aquí: el valor que devuelve esta función
// se envía por el pipeline real (session-check -> scoring.ts ->
// recordAssessmentEvidence), exactamente como cualquier respuesta real tecleada
// por un estudiante. Un formato no cubierto lanza en vez de degradar
// silenciosamente a una respuesta adivinada.
export function buildDevCanonicalAnswer(question: CanonicalQuestion): CanonicalUserAnswer {
  switch (question.format) {
    case 'multiple_choice':
    case 'scenario':
    case 'find_the_error':
      return question.correctAnswer
    case 'multi_select':
      return [...question.correctAnswer]
    case 'true_false':
      return question.correctAnswer
    case 'word_bank':
    case 'ordering':
      return [...question.correctAnswer]
    case 'matching':
    case 'classify':
      return { ...question.correctAnswer }
    case 'numeric_problem': {
      const { value, unit } = question.correctAnswer
      return unit ? `${value} ${unit}` : String(value)
    }
    case 'short_response':
      return question.correctAnswer
    default: {
      const exhaustive: never = question
      throw new Error(`DEV_CANONICAL_ANSWER_UNSUPPORTED_FORMAT:${(exhaustive as CanonicalQuestion).format}`)
    }
  }
}
