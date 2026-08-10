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
  if (question.format === 'matching' && answer && typeof answer === 'object' && !Array.isArray(answer)
    && Array.isArray(question.options)) {
    const options = question.options
    return Object.entries(answer)
      .map(([leftId, rightId]) => {
        const pair = options.find(option => option.id === leftId)
        const right = choiceLabel(question, String(rightId))
        return pair && right ? `${pair.left} → ${right}` : null
      })
      .filter((value): value is string => Boolean(value))
      .join('; ')
  }
  // Guard defensivo: presentAnswer se llama también con preguntas que no
  // pasaron por normalizeGeneratedQuestion (p.ej. recoveryFallback.ts sobre
  // la pregunta original de un fallo persistido) — un classify con options
  // malformado no debe crashear la presentación del feedback.
  if (question.format === 'classify' && answer && typeof answer === 'object' && !Array.isArray(answer)
    && question.options && Array.isArray(question.options.items)) {
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

// El LLM genera `explanation` en la misma llamada que la pregunta, sin ningún
// vínculo estructural con `correctAnswer` — la letra/número de opción que
// narra ahí puede no corresponder a la opción realmente marcada correcta (la
// UI, además, nunca muestra letras/números junto a las opciones, así que esa
// autorreferencia es siempre no verificable para el usuario). No podemos
// resolver A que letra del LLM se refiere en cada caso (podría estar hablando
// de una opción incorrecta a propósito, "la opción X es incorrecta porque…"),
// así que la única corrección segura y genérica es eliminar la autorreferencia
// en vez de intentar reescribirla — evita que el feedback afirme algo que
// contradice la respuesta canónica, sin arriesgar introducir una afirmación
// nueva y distinta igual de falsa.
const OPTION_TOKEN = "(?:[a-jA-J]|[0-9]{1,2})"
const OPTION_TOKEN_LIST = `${OPTION_TOKEN}(?:\\s*(?:,|y|and|or|o)\\s*${OPTION_TOKEN})*`
const OPTION_SELF_REFERENCE = new RegExp(
  `\\b(?:la|las|el|los)?\\s*(?:opci[oó]n(?:es)?|alternativa(?:s)?|choice|option)s?\\s*['"“”]?\\(?\\s*${OPTION_TOKEN_LIST}\\s*['"”]?\\)?`,
  'gi',
)

export function stripOptionSelfReferences(explanation: string | undefined | null): string {
  if (!explanation) return ''
  return explanation
    .replace(OPTION_SELF_REFERENCE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim()
}
