const CANONICAL_BLANK = '_____'

function formatCanonicalBlank(text: string): string {
  return text
    // Providers sometimes wrap only the blank in Markdown emphasis, e.g.
    // "** _____ **". The interactive FillBlankPresentation owns the visual
    // styling of the slot, so those wrappers must never leak into the UI.
    .replace(/\*\*\s*_____\s*\*\*/g, CANONICAL_BLANK)
    .replace(/\s*_____\s*/g, ` ${CANONICAL_BLANK} `)
    .replace(/\s+([.,;:?!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Compatibility for the known historical provider placeholder artifact only. */
export function canonicalizeLegacyFillBlankPrompt(value: unknown): string | null {
  const source = String(value || '')
  const normalized = source
    .replace(/\[(?:blank|blanco)\]|\[\[(?:blank|blanco)\]\]|\{\{?(?:blank|blanco)\}?\}|<blank>/gi, CANONICAL_BLANK)
    .replace(/\$1\s*(?=_{3,})/g, '')
    .replace(/_{3,}/g, CANONICAL_BLANK)
  if (normalized.includes('$1') || (normalized.match(/_____/g) || []).length !== 1) return null
  return formatCanonicalBlank(normalized)
}

function replaceSingleLiteral(source: string, literal: string): string | null {
  if (!literal) return null
  const first = source.indexOf(literal)
  if (first < 0 || source.indexOf(literal, first + literal.length) >= 0) return null
  return formatCanonicalBlank(`${source.slice(0, first)}${CANONICAL_BLANK}${source.slice(first + literal.length)}`)
}

/**
 * New generation contract: the provider identifies the canonical answer and
 * returns it verbatim in the stem. The backend creates the blank with literal
 * slicing, never a regex replacement string or capture-group token.
 */
export function canonicalizeGeneratedFillBlankPrompt(question: unknown, answer: unknown): string | null {
  const source = String(question || '').trim()
  const canonicalAnswer = String(answer || '').trim()
  const legacy = canonicalizeLegacyFillBlankPrompt(source)
  if (legacy) return legacy
  if (!source || !canonicalAnswer || source.includes('$1')) return null

  const wrappedCandidates = canonicalAnswer.startsWith('[') || canonicalAnswer.startsWith('{')
    ? [] : [`[${canonicalAnswer}]`, `{{${canonicalAnswer}}}`, `{${canonicalAnswer}}`]
  for (const candidate of wrappedCandidates) {
    const replaced = replaceSingleLiteral(source, candidate)
    if (replaced) return replaced
  }
  return replaceSingleLiteral(source, canonicalAnswer)
}

export function canonicalizePersistedFillBlankQuestion<T extends { type?: unknown; question?: unknown; prompt?: unknown }>(
  question: T,
): T {
  if (question?.type !== 'fill_blank') return question
  const source = typeof question.question === 'string' ? question.question : question.prompt
  const normalized = canonicalizeLegacyFillBlankPrompt(source)
  if (!normalized) return question
  return {
    ...question,
    ...(typeof question.question === 'string' ? { question: normalized } : {}),
    ...(typeof question.prompt === 'string' ? { prompt: normalized } : {}),
  }
}

export function mapEnjoyerQuizQuestionForUi<T extends {
  type?: unknown; question?: unknown; prompt?: unknown; wordBank?: unknown
}>(question: T): T {
  const canonical = canonicalizePersistedFillBlankQuestion(question)
  if (canonical?.type !== 'fill_blank') return canonical
  const bank = Array.isArray(canonical.wordBank)
    ? [...new Set(canonical.wordBank.map(String).map(value => value.trim()).filter(Boolean))]
    : []
  return { ...canonical, wordBank: bank }
}

export function mapEnjoyerQuizQuestionsForUi<T extends {
  type?: unknown; question?: unknown; prompt?: unknown; wordBank?: unknown
}>(questions: readonly T[]): T[] {
  return questions.map(mapEnjoyerQuizQuestionForUi)
}
