export const ACTIVITY_TEMPLATES = [
  'correct_peer_mistake', 'best_explanation', 'build_response', 'find_distractor', 'guided_comparison',
  'predict_before_reveal', 'detect_exception', 'complete_reasoning', 'incorrect_step', 'new_case',
  'explain_connection', 'causal_order',
] as const
export type ActivityTemplate = typeof ACTIVITY_TEMPLATES[number]

export function pickTemplate(objective: string, used: string[]): ActivityTemplate {
  const candidates: ActivityTemplate[] = objective === 'repair' ? ['correct_peer_mistake', 'incorrect_step', 'complete_reasoning']
    : objective === 'transfer' || objective === 'apply' ? ['new_case', 'predict_before_reveal', 'build_response']
    : objective === 'discriminate' ? ['guided_comparison', 'detect_exception', 'find_distractor']
    : objective === 'integrate' ? ['explain_connection', 'causal_order', 'build_response']
    : ['best_explanation', 'complete_reasoning', 'build_response']
  return candidates.find(value => !used.includes(value)) || candidates[0]
}
