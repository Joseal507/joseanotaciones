export type InteractionPhase =
  | 'presenting'
  | 'answering'
  | 'evaluating'
  | 'showing_feedback'
  | 'collecting_confidence'
  | 'ready_to_continue'
  | 'advancing'
  | 'session_complete'

export interface InteractionState {
  phase: InteractionPhase
  interactionId: string
  questionId: string
  answer?: unknown
  evaluation?: { outcome: 'correct' | 'partial' | 'incorrect'; correctAnswer?: string }
  confidence?: number
  closeAfterContinue: boolean
}

export function beginInteraction(interactionId: string, questionId = interactionId): InteractionState {
  return { phase: 'answering', interactionId, questionId, closeAfterContinue: false }
}

export function beginPresentation(interactionId: string): InteractionState {
  return { phase: 'ready_to_continue', interactionId, questionId: interactionId, closeAfterContinue: false }
}

export function startEvaluation(state: InteractionState, answer: unknown): InteractionState {
  if (state.phase !== 'answering') return state
  return { ...state, phase: 'evaluating', answer }
}

export function receiveEvaluation(
  state: InteractionState,
  payload: { interactionId: string; questionId: string; outcome: 'correct' | 'partial' | 'incorrect'; correctAnswer?: string; shouldCloseSession?: boolean },
): InteractionState {
  if (state.phase !== 'evaluating' || payload.interactionId !== state.interactionId || payload.questionId !== state.questionId) return state
  return { ...state, phase: 'collecting_confidence', evaluation: payload, closeAfterContinue: payload.shouldCloseSession === true }
}

export function selectConfidence(state: InteractionState, confidence?: number): InteractionState {
  if (state.phase !== 'collecting_confidence') return state
  return { ...state, phase: 'ready_to_continue', confidence }
}

export function continueInteraction(state: InteractionState): InteractionState {
  if (state.phase !== 'ready_to_continue') return state
  return { ...state, phase: state.closeAfterContinue ? 'session_complete' : 'advancing' }
}

export function canRenderSessionComplete(shouldCloseSession: boolean, sessionPersisted: boolean): boolean {
  return shouldCloseSession && sessionPersisted
}

export function shouldRenderActiveContent(phase: 'ready' | 'evaluating' | 'loading'): boolean {
  return phase === 'ready'
}

export function canonicalSessionDestination(): 'book' {
  return 'book'
}
