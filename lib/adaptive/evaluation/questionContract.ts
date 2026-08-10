import type { CognitiveDimension, QuestionVariant } from '../v3/engine/masteryContract'
import { normalizeAcademicContent } from '../../academic-content/validation'
import { EVALUATION_MODE_VIOLATION, validateQuestionTypeForMode } from './evaluationModeContract'
import { CANONICAL_QUESTION_FORMATS, QUESTION_VARIANT_FORMAT, type CanonicalQuestionFormat } from './questionFormatRegistry'

export const QUESTION_FORMATS = CANONICAL_QUESTION_FORMATS
export type QuestionFormat = CanonicalQuestionFormat
export type QuestionDifficulty = 'easy' | 'medium' | 'hard'
export type EvaluationOutcome = 'correct' | 'incorrect' | 'invalid' | 'assisted'
export type MatchingSemantics = 'bijective' | 'many_to_one'

export interface ChoiceOption {
  id: string
  text: string
}

export interface MatchPair {
  id: string
  left: string
  right: string
  rightId: string
}

export interface ClassificationItem {
  id: string
  text: string
  category: string
}

interface QuestionBase {
  id: string
  conceptId: string
  conceptLabel: string
  teachingBlockId: string
  questionFamily: string
  variant: QuestionVariant
  difficulty: QuestionDifficulty
  targetDimension: CognitiveDimension
  questionText: string
  explanation: string
  hint: string
  estimatedSeconds: number
  evidencesNeeded: number
  factKey: string
  sessionId?: string
  targetObjectiveIds?: string[]
  targetStepIds?: string[]
  targetKeyPointIds?: string[]
  targetFactKeys?: string[]
  factKeys?: string[]
  evidenceProduced?: string[]
  sourceSpans?: Array<{ stepId: string; factKey: string; blockId?: string }>
  requiresNumericData?: boolean
  numericEvidence?: { values: string[]; units?: string[]; formulaIds?: string[] }
  selectionReason?: string
  selectedVariant?: QuestionVariant
  canonicalFormat?: QuestionFormat
  wasRecovery?: boolean
  roundNumber?: number
  // Firma HMAC server-authoritative (Codex Finding 2) — ver questionIntegrity.ts.
  // Presente solo en preguntas que salieron del servidor; el cliente la
  // transporta sin poder recalcularla.
  integrity?: string
}

export type CanonicalQuestion =
  | (QuestionBase & { format: 'multiple_choice' | 'scenario' | 'find_the_error'; options: ChoiceOption[]; correctAnswer: string })
  | (QuestionBase & { format: 'multi_select'; options: ChoiceOption[]; correctAnswer: string[] })
  | (QuestionBase & { format: 'true_false'; options: null; correctAnswer: boolean })
  | (QuestionBase & { format: 'word_bank'; options: ChoiceOption[]; correctAnswer: string[] })
  | (QuestionBase & {
      format: 'matching'
      options: MatchPair[]
      correctAnswer: Record<string, string>
      matchingSemantics: MatchingSemantics
      matchingOptionOrder: string[]
    })
  | (QuestionBase & { format: 'ordering'; options: ChoiceOption[]; correctAnswer: string[] })
  | (QuestionBase & { format: 'classify'; options: { categories: string[]; items: ClassificationItem[] }; correctAnswer: Record<string, string> })
  | (QuestionBase & { format: 'numeric_problem'; options: null; correctAnswer: { value: number; tolerance: number; unit?: string } })
  | (QuestionBase & { format: 'short_response'; options: null; correctAnswer: string })

export type CanonicalUserAnswer =
  | string | boolean | string[] | Record<string, string>
  | { value: number | string; unit?: string }

export interface QuestionValidation {
  valid: boolean
  errors: string[]
}

export interface GenerationContext {
  activeConceptId: string
  activeConceptLabel: string
  teachingBlockId: string
  targetDimension: CognitiveDimension
  questionFamily: string
  allowedConceptIds: string[]
  forbiddenConceptIds: string[]
  evaluationMode?: unknown
  sessionId?: string
  targetObjectiveIds?: string[]
  targetStepIds?: string[]
  targetKeyPointIds?: string[]
  factKeys?: string[]
  cognitiveTargetContract?: string
}

export type UnknownRecord = Record<string, unknown>

export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const primitiveText = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

export function safeStructuredText(value: unknown): string | null {
  const direct = primitiveText(value)
  if (direct !== null) return direct
  if (Array.isArray(value)) {
    const parts = value.map(safeStructuredText)
    return parts.every((part): part is string => part !== null) ? parts.join(' · ') : null
  }
  if (!isRecord(value)) return null
  for (const key of ['text', 'label', 'content', 'value', 'id'] as const) {
    const candidate = primitiveText(value[key])
    if (candidate) return candidate
  }
  return null
}

export function normalizeOptionToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim()
  }
  if (!isRecord(value)) return ''
  for (const candidate of [value.text, value.label, value.value, value.content, value.id]) {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const normalized = String(candidate).trim()
      if (normalized) return normalized
    }
  }
  return ''
}

const stableId = (value: unknown, index: number, prefix: string): string => {
  if (isRecord(value)) {
    const id = primitiveText(value.id) || primitiveText(value.value)
    if (id) return id
  }
  return `${prefix}_${index + 1}`
}

export function normalizeChoiceOptions(value: unknown): ChoiceOption[] | null {
  if (!Array.isArray(value)) return null
  const options = value.map((raw, index) => ({
    id: stableId(raw, index, 'option'),
    text: safeStructuredText(raw),
  }))
  if (options.some(option => !option.text)) return null
  return options.map(option => ({ id: option.id, text: option.text as string }))
}

function resolveChoiceIds(answer: unknown, options: ChoiceOption[]): string[] | null {
  const rawAnswers = Array.isArray(answer) ? answer : [answer]
  const resolved: string[] = []
  for (const raw of rawAnswers) {
    const candidates = isRecord(raw)
      ? [primitiveText(raw.id), primitiveText(raw.value), primitiveText(raw.text), primitiveText(raw.label), primitiveText(raw.content)]
      : [primitiveText(raw)]
    const matches = options.filter(option =>
      candidates.some(candidate => candidate === option.id || candidate === option.text)
    )
    if (matches.length !== 1) return null
    resolved.push(matches[0].id)
  }
  return resolved
}

function normalizePairs(value: unknown): MatchPair[] | null {
  if (isRecord(value)) {
    const pairs = Object.entries(value).map(([left, right], index) => ({
      id: `pair_${index + 1}`, rightId: `match_${index + 1}`, left, right: safeStructuredText(right),
    }))
    if (pairs.some(pair => !pair.left.trim() || !pair.right)) return null
    return pairs.map(pair => ({ ...pair, right: pair.right as string }))
  }
  if (!Array.isArray(value)) return null
  const pairs = value.map((raw, index) => {
    if (!isRecord(raw)) return null
    const left = safeStructuredText(raw.left ?? raw.prompt ?? raw.item)
    const right = safeStructuredText(raw.right ?? raw.answer ?? raw.match)
    const id = stableId(raw, index, 'pair')
    const rightId = primitiveText(raw.rightId) || primitiveText(raw.answerId) || `match_${id}`
    return left && right ? { id, rightId, left, right } : null
  })
  return pairs.every((pair): pair is MatchPair => pair !== null) ? pairs : null
}

function hashSeed(value: string): number {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededUnit(seed: number): () => number {
  let state = seed || 0x9e3779b9
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function buildStableMatchingOrder(questionId: string, rightIds: string[]): string[] {
  const unique = [...new Set(rightIds)]
  if (unique.length < 2) return unique
  const random = seededUnit(hashSeed(questionId))
  const shuffled = [...unique]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]]
  }
  if (shuffled.every((id, index) => id === unique[index])) {
    const offset = 1 + (hashSeed(`${questionId}:rotate`) % (unique.length - 1))
    return [...unique.slice(offset), ...unique.slice(0, offset)]
  }
  return shuffled
}

export function matchingDisplayOptions(
  question: Extract<CanonicalQuestion, { format: 'matching' }>,
): Array<{ id: string; content: string }> {
  const labels = new Map(question.options.map(pair => [pair.rightId, pair.right]))
  return question.matchingOptionOrder
    .map(id => ({ id, content: labels.get(id) || '' }))
    .filter(option => option.content)
}

function normalizeClassification(value: unknown): { categories: string[]; items: ClassificationItem[] } | null {
  if (!isRecord(value)) return null
  if (Array.isArray(value.categories) && Array.isArray(value.items)) {
    const categories = value.categories.map(safeStructuredText)
    const items = value.items.map((raw, index) => {
      if (!isRecord(raw)) return null
      const text = safeStructuredText(raw.text ?? raw.item ?? raw.label)
      const category = safeStructuredText(raw.category ?? raw.value)
      return text && category ? { id: stableId(raw, index, 'item'), text, category } : null
    })
    if (!categories.every((item): item is string => Boolean(item)) ||
        !items.every((item): item is ClassificationItem => item !== null)) return null
    return { categories: [...new Set(categories)], items }
  }
  const entries = Object.entries(value)
  const items = entries.map(([text, category], index) => {
    const normalized = safeStructuredText(category)
    return normalized ? { id: `item_${index + 1}`, text, category: normalized } : null
  })
  if (!items.every((item): item is ClassificationItem => item !== null)) return null
  return { categories: [...new Set(items.map(item => item.category))], items }
}

const dimensions: CognitiveDimension[] = ['recognition', 'comprehension', 'application', 'transfer']
const difficulties: QuestionDifficulty[] = ['easy', 'medium', 'hard']

export function normalizeGeneratedQuestion(
  raw: unknown,
  context: GenerationContext,
  id = `q_${Date.now()}`,
): CanonicalQuestion | null {
  if (!isRecord(raw)) return null
  const variant = safeStructuredText(raw.variant) as QuestionVariant | null
  if (!variant || !QUESTION_VARIANT_FORMAT[variant]) return null
  const format = QUESTION_VARIANT_FORMAT[variant]
  const targetDimension = safeStructuredText(raw.targetDimension) as CognitiveDimension | null
  const difficulty = safeStructuredText(raw.difficulty) as QuestionDifficulty | null
  const questionText = normalizeMathText(safeStructuredText(raw.questionText) || '')
  const quantitativeContract = format === 'numeric_problem' &&
    (variant === 'problem_solve' || context.cognitiveTargetContract === 'calculation' || context.cognitiveTargetContract === 'quantitative_application')
  const numericValues = questionText.match(/-?\d+(?:[.,]\d+)?/g) || []
  const units = [...new Set(Array.from(questionText.matchAll(/\b\d+(?:[.,]\d+)?\s*([A-Za-z%°]+)\b/g), match => match[1]))]
  const formulaIds = [...new Set(Array.from(questionText.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=/g), match => match[1]))]
  const base: QuestionBase = {
    id,
    conceptId: safeStructuredText(raw.conceptId) || '',
    conceptLabel: safeStructuredText(raw.conceptLabel) || context.activeConceptLabel,
    teachingBlockId: context.teachingBlockId,
    questionFamily: context.questionFamily || variant,
    variant,
    difficulty: difficulty && difficulties.includes(difficulty) ? difficulty : 'medium',
    targetDimension: targetDimension && dimensions.includes(targetDimension) ? targetDimension : context.targetDimension,
    questionText,
    explanation: normalizeMathText(safeStructuredText(raw.explanation) || ''),
    hint: normalizeMathText(safeStructuredText(raw.hint) || ''),
    estimatedSeconds: typeof raw.estimatedSeconds === 'number' ? raw.estimatedSeconds : 45,
    evidencesNeeded: typeof raw.evidencesNeeded === 'number' ? raw.evidencesNeeded : 1,
    factKey: context.factKeys?.[0] || safeStructuredText(raw.factKey) || `${context.activeConceptId}:${context.targetDimension}:${variant}:${(safeStructuredText(raw.questionText) || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 120)}`,
    sessionId: context.sessionId,
    targetObjectiveIds: context.targetObjectiveIds ? [...context.targetObjectiveIds] : [],
    targetStepIds: context.targetStepIds?.length ? [...context.targetStepIds] : [context.teachingBlockId],
    targetKeyPointIds: context.targetKeyPointIds ? [...context.targetKeyPointIds] : [],
    targetFactKeys: context.factKeys ? [...context.factKeys] : [],
    factKeys: context.factKeys?.length ? [...context.factKeys] : [],
    evidenceProduced: context.targetObjectiveIds ? [...context.targetObjectiveIds] : [],
    sourceSpans: (context.factKeys || []).map(factKey => ({
      stepId: context.teachingBlockId,
      factKey,
    })),
    requiresNumericData: quantitativeContract,
    selectedVariant: variant,
    canonicalFormat: format,
    selectionReason: safeStructuredText(raw.selectionReason) || undefined,
    wasRecovery: context.questionFamily === 'recovery_round' || context.questionFamily === 'recovery_question',
    ...(quantitativeContract ? { numericEvidence: { values:numericValues, ...(units.length ? { units } : {}), ...(formulaIds.length ? { formulaIds } : {}) } } : {}),
  }

  if (format === 'multiple_choice' || format === 'scenario' || format === 'find_the_error') {
    const options = normalizeChoiceOptions(raw.options)
    if (!options) return null
    const correct = resolveChoiceIds(raw.correctAnswer, options)
    return correct?.length === 1 ? { ...base, format, options, correctAnswer: correct[0] } : null
  }
  if (format === 'multi_select') {
    const options = normalizeChoiceOptions(raw.options)
    if (!options) return null
    const correct = resolveChoiceIds(raw.correctAnswer, options)
    return correct?.length ? { ...base, format, options, correctAnswer: [...new Set(correct)] } : null
  }
  if (format === 'true_false') {
    const answer = safeStructuredText(raw.correctAnswer)?.toLowerCase()
    if (!['true', 'false', 'verdadero', 'falso', 'sí', 'si', 'no'].includes(answer || '')) return null
    return { ...base, format, options: null, correctAnswer: ['true', 'verdadero', 'sí', 'si'].includes(answer as string) }
  }
  if (format === 'word_bank') {
    const options = normalizeChoiceOptions(raw.options)
    if (!options || !Array.isArray(raw.correctAnswer)) return null
    const answers = resolveChoiceIds(raw.correctAnswer, options)
    return answers ? { ...base, format, options, correctAnswer: answers } : null
  }
  if (format === 'ordering') {
    const options = normalizeChoiceOptions(raw.options ?? raw.correctAnswer)
    if (!options) return null
    const resolved = resolveChoiceIds(raw.correctAnswer ?? raw.options, options)
    return resolved ? { ...base, format, options, correctAnswer: resolved } : null
  }
  if (format === 'matching') {
    const pairs = normalizePairs(raw.options ?? raw.correctAnswer)
    if (!pairs) return null
    const matchingSemantics: MatchingSemantics =
      safeStructuredText(raw.matchingSemantics) === 'many_to_one' ? 'many_to_one' : 'bijective'
    const candidateIds = [...new Set(pairs.map(pair => pair.rightId))]
    if (matchingSemantics === 'bijective' && candidateIds.length !== pairs.length) return null
    const candidateLabels = new Map<string, string>()
    for (const pair of pairs) {
      const existing = candidateLabels.get(pair.rightId)
      if (existing !== undefined && existing !== pair.right) return null
      candidateLabels.set(pair.rightId, pair.right)
    }
    const persistedOrder = Array.isArray(raw.matchingOptionOrder)
      ? raw.matchingOptionOrder.map(primitiveText)
      : []
    const matchingOptionOrder = persistedOrder.every((item): item is string => Boolean(item)) &&
      persistedOrder.length === candidateIds.length &&
      new Set(persistedOrder).size === candidateIds.length &&
      persistedOrder.every(id => candidateIds.includes(id))
      ? persistedOrder
      : buildStableMatchingOrder(base.id, candidateIds)
    return {
      ...base,
      format,
      options: pairs,
      correctAnswer: Object.fromEntries(pairs.map(pair => [pair.id, pair.rightId])),
      matchingSemantics,
      matchingOptionOrder,
    }
  }
  if (format === 'classify') {
    const options = normalizeClassification(raw.options ?? raw.correctAnswer)
    if (!options) return null
    return { ...base, format, options, correctAnswer: Object.fromEntries(options.items.map(item => [item.id, item.category])) }
  }
  if (format === 'numeric_problem') {
    const answer = isRecord(raw.correctAnswer) ? raw.correctAnswer : { value: raw.correctAnswer }
    const value = Number(answer.value)
    const tolerance = Number(answer.tolerance ?? 0)
    if (!Number.isFinite(value) || !Number.isFinite(tolerance)) return null
    return { ...base, format, options: null, correctAnswer: { value, tolerance, unit: safeStructuredText(answer.unit) || undefined } }
  }
  const correctAnswer = safeStructuredText(raw.correctAnswer)
  return correctAnswer ? { ...base, format: 'short_response', options: null, correctAnswer } : null
}

const brokenLatex = /(?<![\\A-Za-z])(ightleftharpoons|rac|imes|exteV)\b|\\rac\b|\[object Object\]/i

export function normalizeMathText(text: string): string {
  if (!text || typeof text !== 'string') return text ?? '';
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\\\\(rightleftharpoons|frac|times|text)\b/g, '\\$1')
}

export function hasBrokenLatex(text: string): boolean {
  return brokenLatex.test(text)
}

const normalizedWords = (text: string): Set<string> =>
  new Set(text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/\\[a-z]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(word => word.length > 3))

export function questionSimilarity(a: CanonicalQuestion, b: CanonicalQuestion): number {
  const left = normalizedWords(`${a.questionText} ${choiceText(a)}`)
  const right = normalizedWords(`${b.questionText} ${choiceText(b)}`)
  const intersection = [...left].filter(word => right.has(word)).length
  const union = new Set([...left, ...right]).size
  const wordScore = union ? intersection / union : 0
  const trigrams = (text: string): Set<string> => {
    const clean = text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim()
    return new Set(Array.from({ length: Math.max(0, clean.length - 2) }, (_, index) => clean.slice(index, index + 3)))
  }
  const leftTrigrams = trigrams(a.questionText)
  const rightTrigrams = trigrams(b.questionText)
  const shared = [...leftTrigrams].filter(value => rightTrigrams.has(value)).length
  const charScore = leftTrigrams.size + rightTrigrams.size
    ? (2 * shared) / (leftTrigrams.size + rightTrigrams.size)
    : 0
  return Math.max(wordScore, charScore)
}

const choiceText = (question: CanonicalQuestion): string => {
  if (Array.isArray(question.options)) {
    return question.options.map(option => {
      if (!isRecord(option)) return normalizeOptionToString(option)
      const left = normalizeOptionToString(option.left)
      const right = normalizeOptionToString(option.right)
      if (left || right) return [left, right].filter(Boolean).join(' ')
      return normalizeOptionToString(option)
    }).join(' ')
  }
  if (question.format === 'classify') {
    return [
      ...question.options.categories,
      ...question.options.items.flatMap(item => [item.text, item.category]),
    ].join(' ')
  }
  return ''
}

function containsLiteralAnswer(question: CanonicalQuestion): boolean {
  if (typeof question.correctAnswer !== 'string') return false
  if (question.format === 'multiple_choice' || question.format === 'scenario' || question.format === 'find_the_error') return false
  const answer = question.correctAnswer.trim().toLowerCase()
  return answer.length > 12 && question.questionText.toLowerCase().includes(answer)
}

export function validateQuestion(
  question: CanonicalQuestion,
  context: GenerationContext,
  recent: CanonicalQuestion[] = [],
): QuestionValidation {
  const errors: string[] = []
  if (!QUESTION_FORMATS.includes(question.format)) errors.push('unsupported_format')
  if (context.evaluationMode !== undefined &&
      !validateQuestionTypeForMode(context.evaluationMode, question.format).valid) {
    errors.push(EVALUATION_MODE_VIOLATION)
  }
  if (question.questionText.trim().length < 8) errors.push('empty_question')
  // concept_mismatch y concept_not_allowed: solo validar si allowedConceptIds es estricto (1 elemento)
  // En recuperación (recovery_round) y evaluación normal, ser tolerante con variaciones del conceptId
  const isRecovery = context.questionFamily === 'recovery_round' || context.questionFamily === 'recovery_question'
  const isFlexibleContext = context.allowedConceptIds.length > 1 || isRecovery
  if (!isFlexibleContext && question.conceptId !== context.activeConceptId) {
    errors.push('concept_mismatch')
  }
  if (!isFlexibleContext && (!context.allowedConceptIds.includes(question.conceptId) || context.forbiddenConceptIds.includes(question.conceptId))) {
    errors.push('concept_not_allowed')
  }
  if (question.targetDimension !== context.targetDimension) errors.push('dimension_mismatch')
  for (const text of [question.questionText, question.explanation, question.hint, choiceText(question)]) {
    if (hasBrokenLatex(text)) errors.push('broken_latex_or_object')
    if (text && normalizeAcademicContent(text).requiresRegeneration) errors.push('invalid_academic_content')
  }
  if (containsLiteralAnswer(question)) errors.push('answer_revealed')
  if (question.requiresNumericData && question.format === 'numeric_problem' &&
      question.numericEvidence !== undefined && question.numericEvidence.values.length < 2) {
    errors.push('insufficient_numeric_data')
  }
  if (Array.isArray(question.options)) {
    if (question.options.length < 2) errors.push('too_few_options')
    const labels = question.options.map(option => {
      if (!isRecord(option)) return normalizeOptionToString(option)
      const left = normalizeOptionToString(option.left)
      const right = normalizeOptionToString(option.right)
      if (left || right) return [left, right].filter(Boolean).join('|')
      return normalizeOptionToString(option)
    })
    if (labels.some(label => !label || label.includes('[object Object]'))) errors.push('invalid_option')
    if (new Set(labels).size !== labels.length) errors.push('duplicate_options')
  }
  if (question.format === 'word_bank') {
    const blanks = question.questionText.match(/___/g)?.length || 0
    if (blanks !== question.correctAnswer.length) errors.push('word_bank_slot_mismatch')
    const bank = new Set(question.options.map(option => option.id))
    if (question.correctAnswer.some(answer => !bank.has(answer))) errors.push('word_bank_answer_missing')
  }
  if (question.format === 'ordering') {
    if (new Set(question.correctAnswer).size !== question.correctAnswer.length) errors.push('duplicate_ordering_answer')
    const ids = new Set(question.options.map(option => option.id))
    if (question.correctAnswer.some(id => !ids.has(id))) errors.push('ordering_answer_missing')
  }
  if (question.format === 'multi_select') {
    const ids = new Set(question.options.map(option => option.id))
    if (!question.correctAnswer.length || question.correctAnswer.some(id => !ids.has(id))) errors.push('invalid_multi_select_answer')
  }
  if (question.format === 'matching') {
    if (question.options.length < 2) errors.push('invalid_matching_pairs')
    const leftIds = new Set(question.options.map(pair => pair.id))
    const rightIds = new Set(question.options.map(pair => pair.rightId))
    const labelsByRightId = new Map<string, string>()
    const conflictingSharedLabel = question.options.some(pair => {
      const existing = labelsByRightId.get(pair.rightId)
      labelsByRightId.set(pair.rightId, pair.right)
      return existing !== undefined && existing !== pair.right
    })
    if (leftIds.size !== question.options.length ||
        (question.matchingSemantics === 'bijective' && rightIds.size !== question.options.length) ||
        Object.entries(question.correctAnswer).some(([leftId, rightId]) => !leftIds.has(leftId) || !rightIds.has(rightId))) {
      errors.push('invalid_matching_answer')
    }
    if (conflictingSharedLabel) errors.push('conflicting_matching_label')
    if (question.matchingOptionOrder.length !== rightIds.size ||
        new Set(question.matchingOptionOrder).size !== rightIds.size ||
        question.matchingOptionOrder.some(id => !rightIds.has(id))) errors.push('invalid_matching_order')
    const sourceOrder = [...rightIds]
    if (sourceOrder.length > 1 &&
        question.matchingOptionOrder.every((id, index) => id === sourceOrder[index])) {
      errors.push('trivial_matching_order')
    }
  }
  if (question.format === 'classify' && (question.options.categories.length < 2 || question.options.items.length < 2)) errors.push('invalid_classification')
  if (question.format === 'numeric_problem' &&
      (!Number.isFinite(question.correctAnswer.value) || question.correctAnswer.tolerance < 0)) errors.push('invalid_numeric_answer')
  if ((context.targetDimension === 'application' || context.targetDimension === 'transfer') &&
      question.format === 'true_false') errors.push('superficial_procedure_evidence')
  if (recent.some(previous => questionSimilarity(question, previous) >= 0.92)) errors.push('repeated_question')
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

export function restoreCanonicalQuestion(value: unknown, context: GenerationContext): CanonicalQuestion | null {
  if (!isRecord(value)) return null
  return normalizeGeneratedQuestion(value, context, safeStructuredText(value.id) || `restored_${Date.now()}`)
}
