import type { EvalPreference } from './interactionLibrary'
import {
  EVALUATION_MODE_VIOLATION,
  normalizeEvaluationMode,
  validateQuestionTypeForMode,
} from '../../evaluation/evaluationModeContract'

export const RAPID_FORMATS = new Set([
  'multiple_choice', 'multi_select', 'true_false', 'fill_blank_bank',
  'matching', 'ordering', 'classify_groups', 'find_the_error',
  'choose_best_procedure',
])

export const SUPPORTED_INTERACTION_FORMATS = [
  'multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'fill_blank_bank',
  'matching', 'ordering', 'open_response', 'explain_why', 'teach_back',
  'practical_case', 'prediction', 'step_by_step_solver', 'numeric_short',
  'classify_groups', 'find_the_error', 'complete_procedure',
  'complete_reaction_or_formula', 'calculator_check', 'choose_best_procedure',
  'quick_check', 'formula_builder', 'concept_map', 'compare_contrast',
] as const

export function normalizeEvalPreference(value: unknown): EvalPreference {
  const normalized = normalizeEvaluationMode(value)
  return normalized === 'read_only' ? 'mix_everything' : normalized
}

export interface ContractInteraction {
  id?: string
  questionId?: string
  factKey?: string
  interactionType?: string
  type?: string
  prompt?: string
  data?: Record<string, unknown>
}

export interface InteractionRepairContext {
  microId: string
  microName: string
  objective: string
  evidenceType?: string
  sourceText?: string
  usedQuestionIds?: string[]
  usedFactKeys?: string[]
}

export interface PreparedInteraction {
  interaction: ContractInteraction
  status: 'valid' | 'repaired' | 'safe_fallback'
  reasonCodes: string[]
  qualityScore: number
  rejectedReasons: string[]
}

const text = (value: unknown) => String(value ?? '').trim()
const strings = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : []
const unique = (values: string[]) => [...new Set(values)]
const hasBlank = (value: unknown) => /_{2,}|\{\{blank\}\}|\[blank\]/i.test(text(value))
const PLACEHOLDER_DISTRACTOR = /^(concepto no relacionado|informaci[oó]n externa|opci[oó]n incorrecta|ninguna de las anteriores|alternativa falsa|respuesta equivocada)$/i
const generatedId = (prefix: string, seed: string) => `${prefix}_${Date.now()}_${seed.replace(/[^a-z0-9]+/gi, '').slice(0, 12) || 'safe'}`

function normalizeType(value: string): string {
  if (value === 'multiple_select') return 'multi_select'
  if (value === 'numeric') return 'numeric_short'
  if (value === 'classification') return 'classify_groups'
  return value
}

export function normalizeInteractionForPreference(
  interaction: ContractInteraction | null | undefined,
  preference: EvalPreference,
): ContractInteraction | null | undefined {
  if (!interaction) return interaction
  const rawData = interaction.data || {}
  const rawType = normalizeType(text(interaction.interactionType || interaction.type))
  const data: Record<string, unknown> = { ...rawData }
  if (!Array.isArray(data.bank)) data.bank = data.wordBank || data.options
  if (!Array.isArray(data.correctAnswers)) {
    const accepted = strings(data.acceptedAnswers)
    data.correctAnswers = accepted.length > 0 ? accepted : text(data.correctAnswer) ? [text(data.correctAnswer)] : []
  }
  const type = preference === 'quick_test' && rawType === 'fill_blank' ? 'fill_blank_bank' : rawType
  return { ...interaction, interactionType: type, type, data: { ...data, type } }
}

export function validateInteractionContract(interaction: ContractInteraction, preference: EvalPreference, visibleContext = ''): string[] {
  const errors: string[] = []
  const type = normalizeType(text(interaction.interactionType || interaction.type))
  const data = interaction.data || {}
  const prompt = text(interaction.prompt)
  if (!text(interaction.id)) errors.push('INTERACTION_ID_REQUIRED')
  if (!text(interaction.questionId)) errors.push('QUESTION_ID_REQUIRED')
  if (!text(interaction.factKey)) errors.push('FACT_KEY_REQUIRED')
  if (!type) errors.push('INTERACTION_TYPE_REQUIRED')
  else if (!(SUPPORTED_INTERACTION_FORMATS as readonly string[]).includes(type)) errors.push(`INTERACTION_TYPE_UNSUPPORTED:${type}`)
  if (!prompt) errors.push('PROMPT_REQUIRED')
  if (!validateQuestionTypeForMode(preference, type).valid) {
    errors.push(`${EVALUATION_MODE_VIOLATION}: format ${type} denied in ${preference}`)
  }

  const optionValues = Array.isArray(data.options) ? data.options : []
  const optionIds = optionValues.map((option, index) => typeof option === 'object' && option !== null ? text(Reflect.get(option, 'id')) : `option_${index}`)
  const optionTexts = optionValues.map(option => typeof option === 'object' && option !== null ? text(Reflect.get(option, 'text') || Reflect.get(option, 'label')) : text(option))
  const correctIndex = typeof data.correctIndex === 'number' ? data.correctIndex : -1
  const correctIds = unique([text(data.correctOptionId), ...strings(data.correctOptionIds)].filter(Boolean))

  if (type === 'multiple_choice' || type === 'choose_best_procedure') {
    if (optionTexts.length < 2) errors.push('OPTIONS_MIN_2')
    if (unique(optionIds).length !== optionIds.length || unique(optionTexts).length !== optionTexts.length) errors.push('OPTIONS_UNIQUE_REQUIRED')
    if (!(correctIndex >= 0 && correctIndex < optionTexts.length) && !correctIds.some(id => optionIds.includes(id))) errors.push('CORRECT_OPTION_INVALID')
  }
  if (type === 'multi_select') {
    const correctIndices = Array.isArray(data.correctIndices) ? data.correctIndices.filter(value => typeof value === 'number') as number[] : []
    if (optionTexts.length < 2) errors.push('OPTIONS_MIN_2')
    if (unique(optionTexts).length !== optionTexts.length) errors.push('OPTIONS_UNIQUE_REQUIRED')
    if (correctIndices.length === 0 && correctIds.length === 0) errors.push('CORRECT_OPTIONS_REQUIRED')
    if (correctIndices.some(index => index < 0 || index >= optionTexts.length) || correctIds.some(id => !optionIds.includes(id))) errors.push('CORRECT_OPTIONS_NOT_IN_OPTIONS')
  }
  if (type === 'true_false') {
    if (!text(data.statement)) errors.push('TRUE_FALSE_STATEMENT_REQUIRED')
    if (typeof data.correctAnswer !== 'boolean') errors.push('TRUE_FALSE_BOOLEAN_REQUIRED')
    if (!text(data.explanation || data.feedback)) errors.push('TRUE_FALSE_FEEDBACK_REQUIRED')
  }
  if (type === 'fill_blank' || type === 'fill_blank_bank') {
    if (!hasBlank(data.template || interaction.prompt)) errors.push('FILL_BLANK_EXPLICIT_BLANK_REQUIRED')
    const answers = strings(data.correctAnswers || data.acceptedAnswers)
    if (answers.length === 0) errors.push('FILL_BLANK_ACCEPTED_ANSWERS_REQUIRED')
    if (type === 'fill_blank_bank') {
      const bank = strings(data.bank || data.wordBank || data.options)
      if (bank.length < 3) errors.push('FILL_BLANK_BANK_WORD_BANK_MIN_3')
      if (unique(bank).length !== bank.length) errors.push('FILL_BLANK_BANK_OPTIONS_UNIQUE')
      if (answers.length > 0 && bank.filter(item => item === answers[0]).length !== 1) errors.push('FILL_BLANK_BANK_CORRECT_EXACTLY_ONCE')
      if (bank.some(item => PLACEHOLDER_DISTRACTOR.test(item))) errors.push('PLACEHOLDER_DISTRACTOR_DENIED')
      if (/^(el )?concepto (central|trabajado) es\s+_{2,}/i.test(text(data.template || interaction.prompt))) errors.push('TRIVIAL_FILL_BLANK_DENIED')
    }
  }
  if (type === 'matching') {
    const pairs = Array.isArray(data.pairs) ? data.pairs : []
    if (pairs.length < 2) errors.push('MATCHING_PAIRS_MIN_2')
    const left = pairs.map(pair => text(pair && typeof pair === 'object' ? Reflect.get(pair, 'left') : ''))
    const right = pairs.map(pair => text(pair && typeof pair === 'object' ? Reflect.get(pair, 'right') : ''))
    if (left.some(value => !value) || right.some(value => !value)) errors.push('MATCHING_SIDES_REQUIRED')
    if (unique(left).length !== left.length || unique(right).length !== right.length) errors.push('MATCHING_UNIQUE_REQUIRED')
  }
  if (type === 'ordering' || type === 'complete_procedure') {
    const items = strings(data.items || data.steps)
    const order = Array.isArray(data.correctOrder) ? data.correctOrder : []
    if (items.length < 2) errors.push('ORDERING_ITEMS_MIN_2')
    if (unique(items).length !== items.length) errors.push('ORDERING_ITEMS_UNIQUE')
    if (order.length !== items.length || unique(order.map(String)).length !== items.length) errors.push('ORDERING_COMPLETE_ORDER_REQUIRED')
  }
  if (type === 'open_response' || type === 'quick_check') {
    if (strings(data.acceptedAnswers || data.expectedKeywords || data.expectedConcepts || data.criteria).length === 0) errors.push('OPEN_RESPONSE_CRITERIA_REQUIRED')
  }
  if (type === 'explain_why' && strings(data.expectedFactors || data.acceptedAnswers || data.criteria).length === 0) errors.push('EXPLAIN_WHY_CRITERIA_REQUIRED')
  if (type === 'teach_back' && strings(data.rubric || data.requiredPoints || data.expectedKeywords).length === 0) errors.push('TEACH_BACK_POINTS_REQUIRED')
  if (type === 'practical_case') {
    if (!text(data.scenario || data.case)) errors.push('PRACTICAL_CASE_SCENARIO_REQUIRED')
    if (!text(data.question)) errors.push('PRACTICAL_CASE_QUESTION_REQUIRED')
    if (strings(data.expectedElements || data.criteria).length === 0) errors.push('PRACTICAL_CASE_CRITERIA_REQUIRED')
  }
  if (type === 'prediction') {
    if (!text(data.setup || data.situation)) errors.push('PREDICTION_SITUATION_REQUIRED')
    if (!text(data.question)) errors.push('PREDICTION_QUESTION_REQUIRED')
    if (!text(data.expectedAnswer) && strings(data.criteria).length === 0) errors.push('PREDICTION_ANSWER_REQUIRED')
  }
  if (type === 'step_by_step_solver') {
    if (!text(data.problem)) errors.push('STEP_SOLVER_PROBLEM_REQUIRED')
    if (strings(data.expectedSteps).length === 0 && !text(data.finalAnswer)) errors.push('STEP_SOLVER_SOLUTION_REQUIRED')
  }
  if (type === 'numeric_short' || type === 'calculator_check') {
    if (data.correctAnswer === undefined) errors.push('NUMERIC_EXPECTED_VALUE_REQUIRED')
    const tolerance = Number(data.tolerance ?? 0)
    if (!Number.isFinite(tolerance) || tolerance < 0) errors.push('NUMERIC_TOLERANCE_INVALID')
  }
  if (type === 'classify_groups') {
    const items = strings(data.items); const groups = strings(data.groups)
    const assignments = data.correctAssignments && typeof data.correctAssignments === 'object' ? data.correctAssignments : null
    if (items.length < 2 || groups.length < 2) errors.push('CLASSIFICATION_ITEMS_GROUPS_MIN_2')
    if (!assignments || items.some(item => !groups.includes(text(Reflect.get(assignments, item))))) errors.push('CLASSIFICATION_COMPLETE_ASSIGNMENTS_REQUIRED')
  }
  if (type === 'find_the_error') {
    const steps = strings(data.workedSolution || data.steps)
    if (steps.length < 2) errors.push('ERROR_DETECTION_STEPS_MIN_2')
    if (typeof data.errorStepIndex !== 'number' || data.errorStepIndex < 0 || data.errorStepIndex >= steps.length) errors.push('ERROR_DETECTION_INDEX_INVALID')
    if (!text(data.explanation)) errors.push('ERROR_DETECTION_EXPLANATION_REQUIRED')
  }
  if (type === 'complete_reaction_or_formula' || type === 'formula_builder') {
    if (!hasBlank(data.template || data.equation || interaction.prompt)) errors.push('FORMULA_BLANK_REQUIRED')
    if (strings(data.correctAnswers).length === 0 && data.correctAnswer === undefined) errors.push('FORMULA_ANSWER_REQUIRED')
  }
  if (type === 'concept_map') {
    if (strings(data.nodes).length < 2 || !Array.isArray(data.connections) || data.connections.length < 1) errors.push('CONCEPT_MAP_STRUCTURE_REQUIRED')
  }
  if (type === 'compare_contrast') {
    if (!text(data.itemA) || !text(data.itemB)) errors.push('COMPARE_ITEMS_REQUIRED')
    if (strings(data.expectedDifferences).length === 0 && strings(data.expectedSimilarities).length === 0) errors.push('COMPARE_CRITERIA_REQUIRED')
  }

  errors.push(...validateNoAnswerLeak(interaction, visibleContext))
  return unique(errors)
}

export function validateNoAnswerLeak(interaction: ContractInteraction, visibleContext = ''): string[] {
  const data = interaction.data || {}
  const template = text(data.template)
  const visibleTemplate = template.replace(/_{2,}|\{\{blank\}\}|\[blank\]/gi, ' ')
  const visible = [interaction.prompt, data.preamble, data.example, visibleTemplate, visibleContext].filter(Boolean).join(' ').toLowerCase()
  const answers = [data.correctAnswer, ...strings(data.correctAnswers)]
    .map(value => text(value).toLowerCase()).filter(value => value.length >= 3)
  return answers.some(answer => visible.includes(answer)) ? ['ANSWER_LEAKAGE_DETECTED: answer leakage detected'] : []
}

export function repairInteractionDeterministically(interaction: ContractInteraction, preference: EvalPreference, context: InteractionRepairContext): ContractInteraction {
  const normalized = normalizeInteractionForPreference(interaction, preference) || interaction
  const type = text(normalized.interactionType || normalized.type)
  const data: Record<string, unknown> = { ...(normalized.data || {}) }
  const seed = `${context.microId}_${context.objective}_${type}`
  const baseFactKey = text(normalized.factKey) || `${context.microId}:${context.objective}:${type}`
  const factKey = context.usedFactKeys?.includes(baseFactKey) ? `${baseFactKey}:${Date.now()}` : baseFactKey
  const repaired: ContractInteraction = {
    ...normalized,
    id: text(normalized.id) || generatedId('q', seed),
    questionId: text(normalized.questionId) || text(normalized.id) || generatedId('q', `${seed}_question`),
    factKey,
    prompt: text(normalized.prompt) || text(data.question || data.statement || data.problem) || `Trabaja ${context.microName}`,
    interactionType: type,
    type,
    data,
  }
  if (type === 'fill_blank_bank') {
    const answers = strings(data.correctAnswers)
    const answer = answers[0]
    const existing = unique(strings(data.bank))
    if (answer) data.bank = unique([answer, ...existing.filter(item => item !== answer && !PLACEHOLDER_DISTRACTOR.test(item))])
  }
  if ((type === 'multiple_choice' || type === 'choose_best_procedure') && Array.isArray(data.options)) {
    const options = unique(data.options.map(option => text(option)).filter(Boolean))
    data.options = options
  }
  return repaired
}

export function buildSafeFallbackInteraction(preference: EvalPreference, context: InteractionRepairContext): ContractInteraction {
  const seed = `${context.microId}_${context.objective}_${Date.now()}`
  const id = generatedId('q_safe', seed)
  const factSuffix = id.slice(-12)
  const source = text(context.sourceText) || context.microName
  if (preference !== 'quick_test' && ['test_application', 'test_transfer'].includes(context.objective)) {
    return {
      id, questionId: id, factKey: `${context.microId}:${context.objective}:safe_case:${factSuffix}`,
      interactionType: 'practical_case', type: 'practical_case', prompt: `Aplica ${context.microName} a este caso`,
      data: { type: 'practical_case', scenario: source, question: `¿Cómo se aplica ${context.microName}?`, expectedElements: [context.microName] },
    }
  }
  const statement = source.length > 12 ? source.split(/(?<=[.!?])\s+/)[0].slice(0, 240) : `${context.microName} forma parte del material estudiado.`
  return {
    id, questionId: id, factKey: `${context.microId}:${context.objective}:safe_check:${factSuffix}`,
    interactionType: 'true_false', type: 'true_false', prompt: 'Decide si esta afirmación coincide con el material',
    data: { type: 'true_false', statement, correctAnswer: true, explanation: `La afirmación se deriva del fragmento del material sobre ${context.microName}.` },
  }
}

export function measureDistractorQuality(interaction: ContractInteraction): { lexicalPlausibility: number; semanticProximity: number; sameCategory: number; noPlaceholders: boolean; noExactGiveaway: boolean } {
  const data = interaction.data || {}
  const options = strings(data.bank || data.wordBank || data.options)
  const answer = strings(data.correctAnswers)[0] || text(data.correctAnswer)
  const lengths = options.map(option => option.split(/\s+/).length)
  const comparable = lengths.length > 1 && Math.max(...lengths) - Math.min(...lengths) <= Math.max(2, Math.ceil((lengths.reduce((a, b) => a + b, 0) / lengths.length) * .8))
  const lexical = options.length >= 3 && comparable ? 1 : options.length >= 3 ? .5 : 0
  const prompt = text(data.template || interaction.prompt).toLocaleLowerCase()
  return { lexicalPlausibility: lexical, semanticProximity: lexical, sameCategory: comparable ? 1 : 0, noPlaceholders: options.every(option => !PLACEHOLDER_DISTRACTOR.test(option)), noExactGiveaway: !answer || !prompt.includes(answer.toLocaleLowerCase()) }
}

export function evaluatePedagogicalQuality(interaction: ContractInteraction, context: InteractionRepairContext, visibleContext = ''): { qualityScore: number; reasonCodes: string[]; rejectedReasons: string[] } {
  const type = normalizeType(text(interaction.interactionType || interaction.type))
  const prompt = text(interaction.prompt)
  const data = interaction.data || {}
  const reasons: string[] = []
  let score = 100
  if (prompt.length < 18) { score -= 20; reasons.push('PROMPT_TOO_THIN') }
  if (/^(que es|define|identifica)\b/i.test(prompt) && text(context.objective).match(/apply|transfer|discriminate|test_application|test_transfer/i)) { score -= 30; reasons.push('COGNITIVE_DEPTH_MISMATCH') }
  if (/piensa bien|recuerda lo estudiado|concepto central/i.test(prompt)) { score -= 35; reasons.push('GENERIC_OR_TRIVIAL_PROMPT') }
  const grounding = `${context.microName} ${context.sourceText || ''}`.toLowerCase()
  const promptTokens = prompt.toLowerCase().split(/\W+/).filter(token => token.length > 4)
  if (grounding.length > 20 && promptTokens.length > 0 && !promptTokens.some(token => grounding.includes(token))) { score -= 20; reasons.push('WEAK_MATERIAL_GROUNDING') }
  if (['multiple_choice', 'multi_select', 'fill_blank_bank', 'choose_best_procedure'].includes(type)) {
    const quality = measureDistractorQuality(interaction)
    if (!quality.noPlaceholders) { score -= 60; reasons.push('PLACEHOLDER_DISTRACTOR') }
    if (quality.lexicalPlausibility < 1) { score -= 20; reasons.push('LOW_LEXICAL_PLAUSIBILITY') }
    if (quality.sameCategory < 1) { score -= 15; reasons.push('MIXED_OPTION_CATEGORY') }
    if (!quality.noExactGiveaway) { score -= 35; reasons.push('ANSWER_GIVEAWAY') }
  }
  if (visibleContext && contentOverlap(prompt, visibleContext) > .85) { score -= 20; reasons.push('PROMPT_COPIES_TEACHING') }
  const qualityScore = Math.max(0, score)
  return { qualityScore, reasonCodes: reasons, rejectedReasons: qualityScore < 65 ? reasons : [] }
}

function contentOverlap(left: string, right: string): number {
  const words = (value: string) => new Set(value.toLowerCase().split(/\W+/).filter(word => word.length > 4))
  const a = words(left); const b = words(right)
  if (a.size === 0) return 0
  return [...a].filter(word => b.has(word)).length / a.size
}

export function prepareInteractionForDelivery(
  interaction: ContractInteraction,
  preference: EvalPreference,
  context: InteractionRepairContext,
  visibleContext = '',
): PreparedInteraction {
  const normalized = normalizeInteractionForPreference(interaction, preference) || interaction
  const initialErrors = validateInteractionContract(normalized, preference, visibleContext)
  const initialQuality = evaluatePedagogicalQuality(normalized, context, visibleContext)
  if (initialErrors.length === 0 && initialQuality.rejectedReasons.length === 0) return { interaction: normalized, status: 'valid', reasonCodes: initialQuality.reasonCodes, qualityScore: initialQuality.qualityScore, rejectedReasons: [] }
  const repaired = repairInteractionDeterministically(normalized, preference, context)
  const repairedErrors = validateInteractionContract(repaired, preference, visibleContext)
  const repairedQuality = evaluatePedagogicalQuality(repaired, context, visibleContext)
  if (repairedErrors.length === 0 && repairedQuality.rejectedReasons.length === 0) return { interaction: repaired, status: 'repaired', reasonCodes: [...initialErrors, ...initialQuality.reasonCodes], qualityScore: repairedQuality.qualityScore, rejectedReasons: initialQuality.rejectedReasons }
  const fallback = buildSafeFallbackInteraction(preference, context)
  const fallbackErrors = validateInteractionContract(fallback, preference, '')
  if (fallbackErrors.length > 0) throw new Error(`SAFE_FALLBACK_INVALID:${fallbackErrors.join(',')}`)
  const fallbackQuality = evaluatePedagogicalQuality(fallback, context, '')
  return { interaction: fallback, status: 'safe_fallback', reasonCodes: [...initialErrors, ...initialQuality.reasonCodes, ...repairedErrors, ...repairedQuality.reasonCodes], qualityScore: fallbackQuality.qualityScore, rejectedReasons: [...initialQuality.rejectedReasons, ...repairedQuality.rejectedReasons] }
}

export function assertInteractionContract(interaction: ContractInteraction, preference: EvalPreference, visibleContext = ''): void {
  const errors = validateInteractionContract(interaction, preference, visibleContext)
  if (errors.length > 0) throw new Error(`INVALID_INTERACTION: ${errors.join('; ')}`)
}

export function isPositiveInteger(value: unknown): boolean {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0
}

export function resolveMicroNames(ids: string[], micros: Array<{ id: string; name: string }>): string[] {
  const names = new Map(micros.map(micro => [micro.id, micro.name]))
  return ids.map(id => names.get(id) || 'Concepto del material')
}
