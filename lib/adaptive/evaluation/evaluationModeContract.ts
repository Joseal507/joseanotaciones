export type CanonicalEvaluationMode =
  | 'quick_test'
  | 'write_explain'
  | 'mix_everything'
  | 'read_only'

export interface QuestionTypeCapabilities {
  requiresTextInput: boolean
  requiresTextarea: boolean
  requiresKeyboardComposition: boolean
  isClosedResponse: boolean
  expectedEvidence: 'recognition' | 'selection' | 'association' | 'sequence' | 'classification' | 'production' | 'calculation'
}

export interface EvaluationModeContract {
  mode: CanonicalEvaluationMode
  allowedQuestionTypes: readonly string[]
  forbiddenQuestionTypes: readonly string[]
  allowsFreeText: boolean
  allowsTyping: boolean
  allowsLongForm: boolean
  requiresQuickInteraction: boolean
  fallbackQuestionTypes: readonly string[]
  maxExpectedInteractionSeconds?: number
}

export const EVALUATION_MODE_VIOLATION = 'EVALUATION_MODE_VIOLATION'

const CLOSED_FORMATS = [
  'multiple_choice', 'mcq_single', 'multi_select', 'mcq_multiple',
  'true_false', 'word_bank', 'fill_blank_bank', 'fill_blank_select',
  'matching', 'ordering', 'classify', 'classification', 'classify_groups',
  'scenario', 'find_the_error', 'choose_best_procedure', 'hotspot',
] as const

const WRITING_FORMATS = [
  'short_response', 'short_answer_text', 'open_response', 'essay',
  'explain', 'explain_why', 'justify', 'teach_back', 'compare_contrast',
  'fill_blank', 'fill_blank_text', 'numeric_short',
  'numeric_problem', 'numeric_text_input', 'calculator_check', 'step_by_step_solver',
  'practical_case', 'prediction', 'quick_check', 'complete_procedure',
  'complete_reaction_or_formula', 'formula_builder', 'concept_map',
] as const

const contracts: Record<CanonicalEvaluationMode, EvaluationModeContract> = {
  quick_test: {
    mode: 'quick_test',
    allowedQuestionTypes: CLOSED_FORMATS,
    forbiddenQuestionTypes: WRITING_FORMATS,
    allowsFreeText: false,
    allowsTyping: false,
    allowsLongForm: false,
    requiresQuickInteraction: true,
    fallbackQuestionTypes: ['multiple_choice', 'true_false', 'word_bank', 'matching', 'ordering', 'classify'],
    maxExpectedInteractionSeconds: 60,
  },
  write_explain: {
    mode: 'write_explain',
    allowedQuestionTypes: [...CLOSED_FORMATS, ...WRITING_FORMATS],
    forbiddenQuestionTypes: [],
    allowsFreeText: true,
    allowsTyping: true,
    allowsLongForm: true,
    requiresQuickInteraction: false,
    fallbackQuestionTypes: ['short_response', 'multiple_choice'],
  },
  mix_everything: {
    mode: 'mix_everything',
    allowedQuestionTypes: [...CLOSED_FORMATS, ...WRITING_FORMATS],
    forbiddenQuestionTypes: [],
    allowsFreeText: true,
    allowsTyping: true,
    allowsLongForm: true,
    requiresQuickInteraction: false,
    fallbackQuestionTypes: ['multiple_choice', 'short_response'],
  },
  read_only: {
    mode: 'read_only',
    allowedQuestionTypes: [],
    forbiddenQuestionTypes: [...CLOSED_FORMATS, ...WRITING_FORMATS],
    allowsFreeText: false,
    allowsTyping: false,
    allowsLongForm: false,
    requiresQuickInteraction: false,
    fallbackQuestionTypes: [],
  },
}

export function normalizeEvaluationMode(value: unknown): CanonicalEvaluationMode {
  if (value === 'quick_test' || value === 'rapid' || value === 'quick' || value === 'quick_no_typing') return 'quick_test'
  if (value === 'write_explain') return 'write_explain'
  if (value === 'read_only') return 'read_only'
  return 'mix_everything'
}

export function evaluationModeContract(value: unknown): EvaluationModeContract {
  return contracts[normalizeEvaluationMode(value)]
}

export function questionTypeCapabilities(typeValue: unknown): QuestionTypeCapabilities {
  const type = String(typeValue || '').trim()
  if ((CLOSED_FORMATS as readonly string[]).includes(type)) {
    const expectedEvidence =
      type === 'matching' ? 'association'
      : type === 'ordering' ? 'sequence'
      : ['classify', 'classification', 'classify_groups'].includes(type) ? 'classification'
      : type === 'word_bank' || type === 'fill_blank_bank' || type === 'fill_blank_select' ? 'recognition'
      : 'selection'
    return {
      requiresTextInput: false,
      requiresTextarea: false,
      requiresKeyboardComposition: false,
      isClosedResponse: true,
      expectedEvidence,
    }
  }
  const calculation = ['numeric_problem', 'numeric_short', 'numeric_text_input', 'calculator_check'].includes(type)
  return {
    requiresTextInput: true,
    requiresTextarea: !calculation,
    requiresKeyboardComposition: true,
    isClosedResponse: false,
    expectedEvidence: calculation ? 'calculation' : 'production',
  }
}

export function validateQuestionTypeForMode(
  modeValue: unknown,
  questionType: unknown,
): { valid: true; mode: CanonicalEvaluationMode; capabilities: QuestionTypeCapabilities } |
   { valid: false; mode: CanonicalEvaluationMode; capabilities: QuestionTypeCapabilities; reason: typeof EVALUATION_MODE_VIOLATION } {
  const mode = normalizeEvaluationMode(modeValue)
  const contract = contracts[mode]
  const type = String(questionType || '').trim()
  const capabilities = questionTypeCapabilities(type)
  const permitted = contract.allowedQuestionTypes.includes(type)
    && (!contract.requiresQuickInteraction ||
      (capabilities.isClosedResponse &&
       !capabilities.requiresTextInput &&
       !capabilities.requiresTextarea &&
       !capabilities.requiresKeyboardComposition))
  return permitted
    ? { valid: true, mode, capabilities }
    : { valid: false, mode, capabilities, reason: EVALUATION_MODE_VIOLATION }
}

export function allowedQuestionTypesForObjective(modeValue: unknown, objective: string): string[] {
  const mode = normalizeEvaluationMode(modeValue)
  if (mode === 'read_only') return []
  if (mode !== 'quick_test') return [...contracts[mode].fallbackQuestionTypes]
  const normalized = objective.toLowerCase()
  if (/sequenc|order|procedur|chronolog/.test(normalized)) return ['ordering', 'choose_best_procedure']
  if (/associat|relation|connect|compar/.test(normalized)) return ['matching', 'classify']
  if (/classif|multi.?label|multi.?component|integrat/.test(normalized)) return ['classify', 'multi_select']
  if (/complet|recall|retrieve|memori/.test(normalized)) return ['word_bank', 'multiple_choice', 'true_false']
  return ['multiple_choice', 'scenario', 'find_the_error', 'true_false']
}

export function selectClosedFallbackType(modeValue: unknown, objective: string): string | null {
  return allowedQuestionTypesForObjective(modeValue, objective)[0] || null
}
