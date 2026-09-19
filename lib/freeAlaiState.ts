import type { VisualSpec } from './adaptive/visual/visualContract';
import { chatUserMessage } from './alai-chat/errors';
export type AlaiMessageRole = 'user' | 'assistant';
export type AlaiTurnStatus = 'sending' | 'completed' | 'recoverable';
/** Who initiates. Orthogonal to source policy: 'ask' = student asks ALAI, 'answer' = ALAI asks the student. */
export type AlaiInteractionMode = 'ask' | 'answer';

export interface DurableAlaiMessage {
  id: string;
  turnId?: string;
  role: AlaiMessageRole;
  content: string;
  schemaVersion?: 1;
  provenance?: ChatProvenance;
  evidence?: ChatEvidence[];
  conversationContext?: ChatConversationContext;
  requestedResponseShape?: ResponseShape;
  fulfillment?: ChatEnvelope['fulfillment'];
  visualSpec?: VisualSpec;
  inMaterial?: boolean;
  outsideMaterialNote?: string;
  confidence?: 'alta' | 'media' | 'baja';
  sourceMaterial?: string;
  sourceMaterialName?: string;
  sourcePages?: number[];
  suggestedFollowups?: string[];
  timestamp?: number;
  /** Synthetic trigger (Responder start): sent to the server but never shown or replayed as history. */
  hidden?: boolean;
  /** StudyalMaterialEnjoyer grounding metadata (main Chat only) — additive, backward-compatible with older persisted messages that lack it or that used the pre-Enjoyer field names. */
  mode?: 'MATERIAL_ONLY' | 'GENERAL_ONLY' | 'MIXED';
  usedTargetIds?: string[];
  usedRelationIds?: string[];
  materialIds?: string[];
}

export interface DurableAlaiTurn {
  id: string;
  userMessageId: string;
  attempt: number;
  status: AlaiTurnStatus;
  error?: string;
  /** Frozen at turn start so retries replay the exact same request. Absent = 'ask' (legacy turns). */
  interactionMode?: AlaiInteractionMode;
  practiceStart?: boolean;
}

export interface DurableAlaiState {
  messages: DurableAlaiMessage[];
  currentTurn: DurableAlaiTurn | null;
  draft: string;
  /** Selected mode; absent = 'ask' (older persisted conversations). */
  interactionMode?: AlaiInteractionMode;
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
  input: { turnId: string; userMessageId: string; content: string; timestamp: number; interactionMode?: AlaiInteractionMode; practiceStart?: boolean; hidden?: boolean },
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
      ...(input.hidden ? { hidden: true } : {}),
    }],
    currentTurn: {
      id: input.turnId,
      userMessageId: input.userMessageId,
      attempt: 1,
      status: 'sending',
      ...(input.interactionMode === 'answer' ? { interactionMode: 'answer' as const, ...(input.practiceStart ? { practiceStart: true } : {}) } : {}),
    },
  };
}

export function alaiInteractionMode(state: Pick<DurableAlaiState, 'interactionMode'>): AlaiInteractionMode {
  return state.interactionMode === 'answer' ? 'answer' : 'ask';
}

/** Switching modes never edits messages or the in-flight turn; it only changes what the NEXT turn does. */
export function setAlaiInteractionMode(state: DurableAlaiState, mode: AlaiInteractionMode): DurableAlaiState {
  if (state.currentTurn?.status === 'sending' || alaiInteractionMode(state) === mode) return state;
  return { ...state, interactionMode: mode };
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
    currentTurn: { ...turn, status: 'recoverable', error: chatUserMessage(error) },
  };
}
import type { ChatConversationContext, ChatEvidence, ChatProvenance, ChatEnvelope, ResponseShape } from './alai-chat/contracts';
