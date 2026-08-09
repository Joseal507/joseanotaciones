import type { QuestionVariant } from '../v3/engine/masteryContract'

export const CANONICAL_QUESTION_FORMATS = [
  'multiple_choice', 'multi_select', 'true_false', 'word_bank', 'ordering',
  'matching', 'classify', 'scenario', 'find_the_error', 'numeric_problem',
  'short_response',
] as const

export type CanonicalQuestionFormat = typeof CANONICAL_QUESTION_FORMATS[number]

export interface QuestionFormatCapabilities {
  renderer: CanonicalQuestionFormat
  scorer: 'choice' | 'exact_set' | 'boolean' | 'position' | 'semantic_ids' | 'classification' | 'numeric' | 'semantic_text'
  closedResponse: boolean
  supportsPartialScore: boolean
  automaticSelectionEnabled: boolean
}

export const QUESTION_VARIANT_FORMAT = {
  mcq_best_answer: 'multiple_choice', mcq_best_explanation: 'multiple_choice',
  mcq_except: 'multiple_choice', mcq_most_likely: 'multiple_choice',
  mcq_least_likely: 'multiple_choice', mcq_cause: 'multiple_choice',
  mcq_consequence: 'multiple_choice', mcq_next_step: 'multiple_choice',
  mcq_analogy: 'multiple_choice', mcq_application: 'multiple_choice',
  mcq_compare: 'multiple_choice', mcq_rule_example: 'multiple_choice',
  mcq_example_rule: 'multiple_choice',
  multi_select_correct: 'multi_select', multi_select_incorrect: 'multi_select',
  multi_select_causes: 'multi_select', multi_select_consequences: 'multi_select',
  multi_select_features: 'multi_select', multi_select_required_steps: 'multi_select',
  multi_select_valid_statements: 'multi_select', mcq_all_that_apply: 'multi_select',
  true_false_factual: 'true_false', true_false_negation: 'true_false',
  true_false_relationship: 'true_false', true_false_application: 'true_false',
  word_bank_fill: 'word_bank', word_bank_formula: 'word_bank',
  word_bank_definition: 'word_bank', word_bank_equation: 'word_bank',
  word_bank_process: 'word_bank',
  matching_concept_def: 'matching', matching_cause_effect: 'matching',
  matching_formula_name: 'matching', matching_example_rule: 'matching',
  matching_term_function: 'matching', matching_structure_function: 'matching',
  matching_problem_method: 'matching', matching_error_correction: 'matching',
  ordering_steps: 'ordering', ordering_events: 'ordering', ordering_process: 'ordering',
  ordering_magnitude: 'ordering', ordering_priority: 'ordering', ordering_chronology: 'ordering',
  classify_category: 'classify', classify_valid_invalid: 'classify',
  classify_affected_not: 'classify', classify_examples: 'classify',
  classify_causes: 'classify', classify_structures: 'classify', classify_processes: 'classify',
  scenario_predict: 'scenario', scenario_diagnose: 'scenario',
  scenario_choose_action: 'scenario', scenario_compare: 'scenario',
  scenario_apply_rule: 'scenario', scenario_transfer: 'scenario', scenario_what_if: 'scenario',
  scenario_clinical: 'scenario', scenario_experimental: 'scenario',
  find_error_calculation: 'find_the_error', find_error_reasoning: 'find_the_error',
  find_error_definition: 'find_the_error', find_error_procedure: 'find_the_error',
  find_error_formula: 'find_the_error', find_error_interpretation: 'find_the_error',
  problem_solve: 'numeric_problem', numeric_missing_value: 'numeric_problem',
  numeric_compare: 'numeric_problem', numeric_estimate: 'numeric_problem',
  numeric_intermediate_step: 'numeric_problem',
  short_answer_define: 'short_response', short_answer_compare: 'short_response',
  short_answer_summarize: 'short_response', explain_why_cause: 'short_response',
  explain_why_consequence: 'short_response', justify_answer: 'short_response',
  teach_back: 'short_response', problem_setup: 'short_response',
} as const satisfies Record<QuestionVariant, CanonicalQuestionFormat>

export const QUESTION_FORMAT_CAPABILITIES: Record<CanonicalQuestionFormat, QuestionFormatCapabilities> = {
  multiple_choice: { renderer: 'multiple_choice', scorer: 'choice', closedResponse: true, supportsPartialScore: false, automaticSelectionEnabled: true },
  multi_select: { renderer: 'multi_select', scorer: 'exact_set', closedResponse: true, supportsPartialScore: true, automaticSelectionEnabled: true },
  true_false: { renderer: 'true_false', scorer: 'boolean', closedResponse: true, supportsPartialScore: false, automaticSelectionEnabled: true },
  word_bank: { renderer: 'word_bank', scorer: 'position', closedResponse: true, supportsPartialScore: true, automaticSelectionEnabled: true },
  ordering: { renderer: 'ordering', scorer: 'position', closedResponse: true, supportsPartialScore: true, automaticSelectionEnabled: true },
  matching: { renderer: 'matching', scorer: 'semantic_ids', closedResponse: true, supportsPartialScore: true, automaticSelectionEnabled: true },
  classify: { renderer: 'classify', scorer: 'classification', closedResponse: true, supportsPartialScore: true, automaticSelectionEnabled: true },
  scenario: { renderer: 'scenario', scorer: 'choice', closedResponse: true, supportsPartialScore: false, automaticSelectionEnabled: true },
  find_the_error: { renderer: 'find_the_error', scorer: 'choice', closedResponse: true, supportsPartialScore: false, automaticSelectionEnabled: true },
  numeric_problem: { renderer: 'numeric_problem', scorer: 'numeric', closedResponse: false, supportsPartialScore: false, automaticSelectionEnabled: true },
  short_response: { renderer: 'short_response', scorer: 'semantic_text', closedResponse: false, supportsPartialScore: true, automaticSelectionEnabled: false },
}

const RAW_FORMAT_ALIASES: Record<string, CanonicalQuestionFormat> = {
  mcq: 'multiple_choice', mcq_single: 'multiple_choice', multiple_choice: 'multiple_choice',
  mcq_multiple: 'multi_select', multiselect: 'multi_select', multi_select: 'multi_select',
  boolean: 'true_false', true_false: 'true_false',
  fill_in_the_blank: 'word_bank', fill_blank: 'word_bank', fill_blank_bank: 'word_bank', word_bank: 'word_bank',
  matching: 'matching', ordering: 'ordering', classification: 'classify', classify_groups: 'classify', classify: 'classify',
  scenario: 'scenario', find_error: 'find_the_error', find_the_error: 'find_the_error',
  numeric: 'numeric_problem', numeric_short: 'numeric_problem', numeric_problem: 'numeric_problem',
  short_answer_text: 'short_response', open_response: 'short_response', short_response: 'short_response',
}

export function canonicalQuestionFormat(value: unknown): CanonicalQuestionFormat | null {
  const token = String(value || '').trim().toLowerCase()
  return (QUESTION_VARIANT_FORMAT as Record<string, CanonicalQuestionFormat>)[token]
    || RAW_FORMAT_ALIASES[token]
    || null
}

export function isVariantFormatCompatible(variant: QuestionVariant, format: unknown): boolean {
  return QUESTION_VARIANT_FORMAT[variant] === canonicalQuestionFormat(format)
}
