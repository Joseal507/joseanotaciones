import type { SessionKind } from './sessionKind'

export type SessionAction =
  | { type: 'show_next_normal_question' }
  | { type: 'show_next_recovery' }
  | { type: 'show_next_teaching_step' }
  | { type: 'complete_current_block' }
  | { type: 'complete_session' }
  | { type: 'blocked'; reason: string }

export interface SessionCompletionResult {
  isSessionComplete: boolean
  objectiveCoverageRatio: number
}

export interface SessionTransitionState {
  currentStepIndex: number
  currentEvaluationBlock: { id: string; completed: boolean } | null
  currentQuestionIndex: number
  unansweredNormalQuestions: number
  pendingRecoveries: number
  latentRecoveries: number
  activeRecovery: boolean
  completedEvaluationBlocks: number
  totalEvaluationBlocks: number
  totalTeachingSteps: number
  sessionKind: SessionKind
  sessionCompletionResult: SessionCompletionResult
}

export function deriveNextSessionAction(state: SessionTransitionState): SessionAction {
  if (state.unansweredNormalQuestions > 0) return { type:'show_next_normal_question' }
  if (state.activeRecovery || state.pendingRecoveries > 0 || state.latentRecoveries > 0) return { type:'show_next_recovery' }
  if (state.currentEvaluationBlock && !state.currentEvaluationBlock.completed) return { type:'complete_current_block' }
  if (state.currentStepIndex < state.totalTeachingSteps - 1) return { type:'show_next_teaching_step' }
  if (state.completedEvaluationBlocks < state.totalEvaluationBlocks) return { type:'blocked', reason:'evaluation_blocks_incomplete' }
  if (state.sessionCompletionResult.objectiveCoverageRatio < 1) return { type:'blocked', reason:'objective_coverage_incomplete' }
  if (!state.sessionCompletionResult.isSessionComplete) return { type:'blocked', reason:'engine_session_incomplete' }
  return { type:'complete_session' }
}

export function getPrimaryActionLabel(action: SessionAction): string {
  switch (action.type) {
    case 'show_next_normal_question': return 'Siguiente pregunta →'
    case 'show_next_recovery': return 'Revisar error →'
    case 'show_next_teaching_step': return 'Continuar →'
    case 'complete_current_block': return 'Continuar →'
    case 'complete_session': return '🎉 Terminar'
    case 'blocked':
      return action.reason === 'objective_coverage_incomplete'
        ? 'Completar evaluación pendiente →'
        : action.reason === 'evaluation_blocks_incomplete'
          ? 'Finalizar bloque pendiente →'
          : action.reason === 'engine_session_incomplete'
            ? 'Resolver pendiente →'
            : 'Continuar →'
  }
}

export function clampTeachingStepIndex(index: number, totalTeachingSteps: number): number {
  return Math.max(0, Math.min(index, Math.max(0, totalTeachingSteps - 1)))
}

export function getRecoveryActionLabel(state:{
  explanationVisible?:boolean
  roundFailed?:boolean
  resolved?:boolean
  hasMoreTeachingSteps?:boolean
}):string{
  if(state.explanationVisible)return 'Verificar comprensión →'
  if(state.roundFailed)return 'Revisar de nuevo →'
  if(state.resolved)return state.hasMoreTeachingSteps===false ? '🎉 Terminar' : 'Continuar →'
  return 'Continuar recuperación →'
}
