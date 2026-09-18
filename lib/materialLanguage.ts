/** Academic language belongs to the source, never the UI or conversation history.
 * `und` means preserve the source language; it never means Spanish or English.
 * No provider calls. Unknown languages can be named by the existing Enjoyer extraction.
 */
export type MaterialLanguage = string

export function normalizeMaterialLanguage(value: unknown): MaterialLanguage | undefined {
  if (typeof value !== 'string') return undefined
  const language = value.trim()
  return /^[\p{L}][\p{L}\p{N} -]{0,63}$/u.test(language) ? language : undefined
}

export function detectMaterialLanguage(text: string): MaterialLanguage {
  // Sample throughout the authorized content, not just the cover or first line.
  const sample = Array.from({ length: 12 }, (_, i) => text.slice(Math.floor(text.length * i / 12), Math.floor(text.length * i / 12) + 1000)).join(' ').toLowerCase()
  const letters = sample.match(/\p{L}/gu) || []
  if (letters.length < 20) return 'und'
  const scripts: [string, RegExp][] = [
    ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu], ['ko', /\p{Script=Hangul}/gu],
    ['zh', /\p{Script=Han}/gu], ['ar', /\p{Script=Arabic}/gu], ['he', /\p{Script=Hebrew}/gu],
    ['el', /\p{Script=Greek}/gu], ['th', /\p{Script=Thai}/gu],
  ]
  for (const [language, pattern] of scripts) {
    const count = (sample.match(pattern) || []).length
    if (count / letters.length > (language === 'ja' ? 0.08 : 0.35)) return language
  }
  const profiles: Record<string, string> = {
    en: 'the and of to is that for with as by this from into are which its can',
    es: 'el la los las que de y en una para con por del es se como esta',
    fr: 'le la les des et est une dans pour avec du qui que au sont ce',
    de: 'der die das und ist ein eine von mit den dem zu im auf werden',
    pt: 'o os as uma em não são para com dos das pela pelo que',
    it: 'il lo gli della delle che una per con sono nel nella anche',
    nl: 'het een van en is voor met zijn wordt deze door op',
    ru: 'и в на что это для из по как не с при',
    uk: 'і та в на що це для з як не є',
  }
  const words = sample.match(/\p{L}+/gu) || []
  const ranked = Object.entries(profiles).map(([language, profile]) => {
    const vocabulary = new Set(profile.split(' '))
    return { language, score: words.filter(word => vocabulary.has(word)).length }
  }).sort((a, b) => b.score - a.score)
  return ranked[0].score >= 3 && ranked[0].score > ranked[1].score * 1.15 ? ranked[0].language : 'und'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/** Only academic source fields participate in legacy backfill; enums/UI never do. */
export function resolveMaterialLanguage(payload: unknown): MaterialLanguage {
  const root = record(payload)
  const authority = root.blueprint ? record(root.blueprint) : root
  const stored = normalizeMaterialLanguage(authority.materialLanguage) || normalizeMaterialLanguage(root.materialLanguage)
  if (stored && stored !== 'und') return stored
  const items = authority.globalOrderedAnalysis || authority.blocks || authority.targets || authority.sourceItems || []
  const sample = Array.isArray(items) ? items.map(item => {
    const row = record(item)
    return [row.content, row.summary, row.statement, row.label, row.title].filter(v => typeof v === 'string').join(' ')
  }).join('\n') : ''
  return stored || detectMaterialLanguage(sample)
}

export function academicLanguageInstruction(language: MaterialLanguage = 'und', allowExplicitOverride = false): string {
  let languageName = language
  try { languageName = new Intl.DisplayNames(['en'], { type: 'language' }).of(language) || language } catch { /* Existing Enjoyer may use a language name. */ }
  const target = language === 'und' ? 'the dominant language of the authorized source material' : `${language}. ${languageName}`
  const tail = 'Do not translate source content. Preserve quoted source excerpts verbatim, including multilingual quotations. Structural repair and replacement must preserve this same language. Keep schema keys, IDs and enums unchanged.'
  if (allowExplicitOverride) {
    return `ACADEMIC LANGUAGE AUTHORITY: ${target}. This is the DEFAULT language for every human-readable academic field, title, explanation, question, answer, example and feedback; it overrides the language of templates, examples, UI and previous conversation. EXCEPTION: if the CURRENT user message explicitly asks for another language or a translation, fulfil it and answer in the requested language for this response only (never refuse a language request); the authority language itself is never mutated. ${tail}`
  }
  return `ACADEMIC LANGUAGE AUTHORITY: ${target}. Generate every human-readable academic field, title, explanation, question, answer, example and feedback in this language. This overrides the language of templates, examples, UI and previous conversation. ${tail} No implicit language override is allowed.`
}

/** Metadata-only backfill: preserves durable academic work and source identity. */
export function withMaterialLanguage<T>(payload: T): T {
  const root = record(payload)
  if (!Object.keys(root).length) return payload
  const materialLanguage = resolveMaterialLanguage(payload)
  return { ...root, materialLanguage, ...(root.blueprint ? { blueprint: { ...record(root.blueprint), materialLanguage } } : {}) } as T
}

/** Local grading chrome; unsupported languages use language-neutral verdict symbols.
 * Explanations always come from the source/provider, never these labels. */
export function academicVerdict(language: string, verdict: 'correct' | 'partial' | 'incorrect' | 'true' | 'false'): string {
  const labels: Record<string, string[]> = {
    en: ['Correct.', 'Partially correct.', 'Incorrect.', 'True', 'False'],
    es: ['Correcto.', 'Parcialmente correcto.', 'Incorrecto.', 'Verdadero', 'Falso'],
    zh: ['正确。', '部分正确。', '不正确。', '正确', '错误'],
    fr: ['Correct.', 'Partiellement correct.', 'Incorrect.', 'Vrai', 'Faux'],
    ja: ['正解です。', '一部正解です。', '不正解です。', '正しい', '誤り'],
  }
  const index = ['correct', 'partial', 'incorrect', 'true', 'false'].indexOf(verdict)
  return (labels[language.split('-')[0]] || ['✓', '◐', '✗', '✓', '✗'])[index]
}

/**
 * Multi-material rule (single authority): the dominant language of the authorized
 * materials wins, weighted by analysed source size. `und` never outvotes a concrete
 * language; ties resolve to the first-seen language so the result is deterministic.
 */
export function aggregateMaterialLanguage(entries: Array<{ language: MaterialLanguage; weight: number }>): MaterialLanguage {
  const totals = new Map<MaterialLanguage, number>()
  for (const { language, weight } of entries) {
    if (!language || language === 'und') continue
    totals.set(language, (totals.get(language) || 0) + Math.max(0, weight))
  }
  let best: MaterialLanguage = 'und'
  let bestWeight = -1
  for (const [language, weight] of totals) if (weight > bestWeight) { best = language; bestWeight = weight }
  return best
}
