export type AlaiMessageRole = 'user' | 'assistant';
export type AlaiTurnStatus = 'sending' | 'completed' | 'recoverable';

export interface DurableAlaiMessage {
  id: string;
  turnId?: string;
  role: AlaiMessageRole;
  content: string;
  inMaterial?: boolean;
  outsideMaterialNote?: string;
  confidence?: 'alta' | 'media' | 'baja';
  sourceMaterial?: string;
  sourceMaterialName?: string;
  sourcePages?: number[];
  suggestedFollowups?: string[];
  timestamp?: number;
}

export interface DurableAlaiTurn {
  id: string;
  userMessageId: string;
  attempt: number;
  status: AlaiTurnStatus;
  error?: string;
}

export interface DurableAlaiState {
  messages: DurableAlaiMessage[];
  currentTurn: DurableAlaiTurn | null;
  draft: string;
  activeMaterialId?: string;
  forcedPage?: number;
}

export const ALAI_WELCOME_MESSAGE: DurableAlaiMessage = {
  id: 'alai-welcome-v1',
  role: 'assistant',
  content: 'Ya analicé tu material. Pregúntame cualquier cosa del documento y te ayudo a entenderlo a fondo.',
  inMaterial: true,
  confidence: 'alta',
  sourcePages: [],
  suggestedFollowups: [],
  timestamp: 0,
};

export function initialAlaiState(): DurableAlaiState {
  return { messages: [{ ...ALAI_WELCOME_MESSAGE }], currentTurn: null, draft: '' };
}

export function recoverInterruptedAlaiState(state: DurableAlaiState): DurableAlaiState {
  if (state.currentTurn?.status !== 'sending') return state;
  return {
    ...state,
    currentTurn: {
      ...state.currentTurn,
      status: 'recoverable',
      error: 'La respuesta se interrumpió. Puedes reintentar este mismo turno.',
    },
  };
}

export function beginAlaiTurn(
  state: DurableAlaiState,
  input: { turnId: string; userMessageId: string; content: string; timestamp: number },
): DurableAlaiState {
  if (state.currentTurn?.status === 'sending') return state;
  return {
    ...state,
    draft: '',
    messages: [...state.messages, {
      id: input.userMessageId,
      turnId: input.turnId,
      role: 'user',
      content: input.content,
      timestamp: input.timestamp,
    }],
    currentTurn: {
      id: input.turnId,
      userMessageId: input.userMessageId,
      attempt: 1,
      status: 'sending',
    },
  };
}

export function retryAlaiTurn(state: DurableAlaiState, turnId: string): DurableAlaiState {
  const turn = state.currentTurn;
  if (!turn || turn.id !== turnId || turn.status !== 'recoverable') return state;
  const { error: _error, ...retryingTurn } = turn;
  return {
    ...state,
    currentTurn: { ...retryingTurn, attempt: turn.attempt + 1, status: 'sending' },
  };
}

export function completeAlaiTurn(
  state: DurableAlaiState,
  turnId: string,
  attempt: number,
  answer: DurableAlaiMessage,
): DurableAlaiState {
  const turn = state.currentTurn;
  if (!turn || turn.id !== turnId || turn.attempt !== attempt || turn.status !== 'sending') return state;
  const answerId = `${turnId}:assistant`;
  const authoritativeAnswer = { ...answer, id: answerId, turnId, role: 'assistant' as const };
  const withoutPreviousAnswer = state.messages.filter(message => message.id !== answerId);
  const { error: _error, ...completedTurn } = turn;
  return {
    ...state,
    messages: [...withoutPreviousAnswer, authoritativeAnswer],
    currentTurn: { ...completedTurn, status: 'completed' },
  };
}

export function failAlaiTurn(
  state: DurableAlaiState,
  turnId: string,
  attempt: number,
  error: string,
): DurableAlaiState {
  const turn = state.currentTurn;
  if (!turn || turn.id !== turnId || turn.attempt !== attempt || turn.status !== 'sending') return state;
  return {
    ...state,
    currentTurn: { ...turn, status: 'recoverable', error },
  };
}
