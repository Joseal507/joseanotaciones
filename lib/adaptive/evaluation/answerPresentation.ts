import type { CanonicalQuestion, CanonicalUserAnswer } from './questionContract'

const choiceLabel = (
  question: CanonicalQuestion,
  id: string,
): string | null => {
  if (!Array.isArray(question.options)) return null
  if (question.format === 'matching') {
    return question.options.find(option => option.rightId === id)?.right ?? null
  }
  const option = question.options.find(candidate => candidate.id === id)
  return option && 'text' in option ? option.text : null
}

export function presentAnswer(
  question: CanonicalQuestion,
  answer: CanonicalUserAnswer,
): string {
  if (typeof answer === 'boolean') return answer ? 'Verdadero' : 'Falso'
  if (typeof answer === 'string') return choiceLabel(question, answer) ?? answer
  if (Array.isArray(answer)) {
    return answer.map(id => choiceLabel(question, id)).filter((label): label is string => Boolean(label)).join(', ')
  }
  if (question.format === 'matching' && answer && typeof answer === 'object' && !Array.isArray(answer)) {
    return Object.entries(answer)
      .map(([leftId, rightId]) => {
        const pair = question.options.find(option => option.id === leftId)
        const right = choiceLabel(question, String(rightId))
        return pair && right ? `${pair.left} → ${right}` : null
      })
      .filter((value): value is string => Boolean(value))
      .join('; ')
  }
  if (question.format === 'classify' && answer && typeof answer === 'object' && !Array.isArray(answer)) {
    return Object.entries(answer)
      .map(([itemId, category]) => {
        const item = question.options.items.find(candidate => candidate.id === itemId)
        return item && typeof category === 'string' ? `${item.text} → ${category}` : null
      })
      .filter((value): value is string => Boolean(value))
      .join('; ')
  }
  if (question.format === 'numeric_problem' && answer && typeof answer === 'object' && 'value' in answer) {
    return `${answer.value}${answer.unit ? ` ${answer.unit}` : ''}`
  }
  return ''
}
