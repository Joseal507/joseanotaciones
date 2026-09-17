import type { QuizQuestionType } from '../../types/quiz'

export const QUIZ_ALLOCATION_INSUFFICIENT_COUNT = 'QUIZ_ALLOCATION_INSUFFICIENT_COUNT'

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function quizAllocationSeed(
  questionCount: number,
  selectedTypes: readonly QuizQuestionType[],
  _difficulty?: string,
): string {
  return `${questionCount}:${[...selectedTypes].sort().join(',')}`
}

export function seededQuizTypeOrder(
  selectedTypes: readonly QuizQuestionType[], seed: string,
): QuizQuestionType[] {
  return [...selectedTypes].sort((a, b) => stableHash(`${seed}:${a}`) - stableHash(`${seed}:${b}`)
    || a.localeCompare(b))
}

export function allocateQuizTypeCounts(
  questionCount: number,
  selectedTypes: readonly QuizQuestionType[],
  seed: string,
): Map<QuizQuestionType, number> {
  if (!selectedTypes.length) return new Map()
  if (questionCount < selectedTypes.length) throw new Error(QUIZ_ALLOCATION_INSUFFICIENT_COUNT)
  const base = Math.floor(questionCount / selectedTypes.length)
  const remainder = questionCount % selectedTypes.length
  const counts = new Map<QuizQuestionType, number>(selectedTypes.map(type => [type, base]))
  for (const type of seededQuizTypeOrder(selectedTypes, seed).slice(0, remainder)) {
    counts.set(type, (counts.get(type) || 0) + 1)
  }
  return counts
}
