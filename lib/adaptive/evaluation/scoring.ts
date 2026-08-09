import { isRecord, type CanonicalQuestion, type CanonicalUserAnswer, type EvaluationOutcome } from './questionContract'

export interface ScoreResult {
  outcome: EvaluationOutcome
  correct: boolean
  score: number
  errorType: string | null
  needsReteaching: boolean
}

const normalize = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ')
    : ''

const asRecord = (value: CanonicalUserAnswer): Record<string, string> | null =>
  isRecord(value) && !Object.prototype.hasOwnProperty.call(value, 'value')
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
    : null

const setScore = (actual: string[], expected: string[]): ScoreResult => {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const hits = [...expectedSet].filter(item => actualSet.has(item)).length
  const extras = [...actualSet].filter(item => !expectedSet.has(item)).length
  const score = Math.max(0, Math.round(((hits - extras) / expectedSet.size) * 100))
  const correct = actualSet.size === expectedSet.size && hits === expectedSet.size
  return { outcome: correct ? 'correct' : 'incorrect', correct, score, errorType: correct ? null : 'selection', needsReteaching: !correct }
}

export function scoreQuestion(question: CanonicalQuestion, answer: CanonicalUserAnswer): ScoreResult {
  if (question.format === 'multiple_choice' || question.format === 'scenario' || question.format === 'find_the_error') {
    const correct = answer === question.correctAnswer
    return { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, errorType: correct ? null : 'selection', needsReteaching: !correct }
  }
  if (question.format === 'multi_select') {
    return setScore(Array.isArray(answer) ? answer : [], question.correctAnswer)
  }
  if (question.format === 'true_false') {
    const normalized = typeof answer === 'boolean' ? answer : ['true', 'verdadero', 'si', 'sí'].includes(normalize(answer))
    const correct = normalized === question.correctAnswer
    return { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, errorType: correct ? null : 'false_confidence', needsReteaching: !correct }
  }
  if (question.format === 'word_bank' || question.format === 'ordering') {
    const actual = Array.isArray(answer) ? answer : []
    const hits = question.correctAnswer.filter((expected, index) => normalize(actual[index]) === normalize(expected)).length
    const score = Math.round((hits / question.correctAnswer.length) * 100)
    const correct = score === 100
    return { outcome: correct ? 'correct' : 'incorrect', correct, score, errorType: correct ? null : question.format === 'ordering' ? 'procedure' : 'recall', needsReteaching: !correct }
  }
  if (question.format === 'matching' || question.format === 'classify') {
    const actual = asRecord(answer) || {}
    const entries = Object.entries(question.correctAnswer)
    if (!entries.length) return { outcome: 'invalid', correct: false, score: 0, errorType: null, needsReteaching: false }
    const hits = entries.filter(([id, expected]) => {
      const studentValue = actual[id]
      if (studentValue === undefined || studentValue === null) return false
      return normalize(String(studentValue)) === normalize(String(expected))
    }).length
    const score = Math.round((hits / entries.length) * 100)
    const correct = score === 100
    return { outcome: correct ? 'correct' : 'incorrect', correct, score, errorType: correct ? null : 'relation', needsReteaching: !correct }
  }
  if (question.format === 'numeric_problem') {
    const rawValue = isRecord(answer) && Object.prototype.hasOwnProperty.call(answer, 'value') ? answer.value : answer
    const textAnswer = String(rawValue).trim()
    const parsed = textAnswer.match(/^(-?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)\s*(.*)$/i)
    const rawUnit = isRecord(answer) && Object.prototype.hasOwnProperty.call(answer, 'unit')
      ? answer.unit : parsed?.[2]
    const value = Number((parsed?.[1] || textAnswer).replace(',', '.'))
    const unitMatches = !question.correctAnswer.unit || normalize(rawUnit) === normalize(question.correctAnswer.unit)
    const correct = Number.isFinite(value) && Math.abs(value - question.correctAnswer.value) <= question.correctAnswer.tolerance && unitMatches
    return { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, errorType: correct ? null : 'calculation', needsReteaching: !correct }
  }
  const expected = normalize(question.correctAnswer)
  const actual = normalize(answer)
  const correct = Boolean(actual) && (actual === expected || (expected.length > 12 && actual.includes(expected)))
  return { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, errorType: correct ? null : 'explanation', needsReteaching: !correct }
}

export const invalidScoreResult = (): ScoreResult => ({
  outcome: 'invalid', correct: false, score: 0, errorType: null, needsReteaching: false,
})
