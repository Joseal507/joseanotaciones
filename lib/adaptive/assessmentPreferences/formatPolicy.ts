import type { AssessmentMode, ExamFormat } from '../planner/types'

const rapid = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank_bank', 'matching', 'ordering', 'numeric_short', 'classify_groups', 'choose_best_procedure']
const writing = ['open_response', 'explain_why', 'teach_back', 'find_the_error', 'compare_contrast', 'practical_case', 'prediction', 'step_by_step_solver']

export function formatsFor(mode: AssessmentMode, objective: string, exam: ExamFormat): string[] {
  if (mode === 'quick_test') {
    if (['transfer', 'apply', 'integrate'].includes(objective)) return exam === 'mathematical' ? ['numeric_short', 'choose_best_procedure', 'practical_case'] : ['practical_case', 'prediction', 'multiple_choice']
    return rapid
  }
  if (mode === 'write_explain') return objective === 'recognize' ? ['multiple_choice', ...writing] : writing
  if (objective === 'retrieve') return ['fill_blank_bank', 'open_response', 'numeric_short']
  if (objective === 'discriminate') return ['matching', 'classify_groups', 'compare_contrast', 'find_the_error']
  if (['apply', 'transfer'].includes(objective)) return ['practical_case', 'prediction', 'choose_best_procedure', 'explain_why']
  return [...rapid.slice(0, 4), ...writing.slice(0, 4)]
}
