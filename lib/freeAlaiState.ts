import type { VisualSpec } from './adaptive/visual/visualContract';
import { chatUserMessage } from './alai-chat/errors';
import { boundedHistory } from './alai-chat/conversation';
export type AlaiMessageRole = 'user' | 'assistant';
export type AlaiTurnStatus = 'sending' | 'completed' | 'recoverable';
/**
 * ALAI has TWO independent threads inside one session: 'ask' (Preguntar, student asks ALAI) and 'answer'
 * (Responder, ALAI asks the student). Each owns its messages, draft, turns and durable identity;
 * only the authorized material/Enjoyer is shared. Orthogonal to source policy.
 */
export type AlaiThread = 'ask' | 'answer';
export type AlaiInteractionMode = AlaiThread;

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
  /** Responder: the pending question this turn answers ('start' for the first question). Frozen for retries. */
  practiceSlot?: string;
}

export interface DurableAlaiState {
  messages: DurableAlaiMessage[];
  currentTurn: DurableAlaiTurn | null;
  draft: string;
  /** Which thread is visible; absent = 'ask'. Only meaningful on the root (Preguntar) record. */
  selectedThread?: AlaiThread;
  /** The Responder thread. Absent until first opened; never contains the Preguntar welcome. */
  practiceThread?: DurableAlaiState;
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

function recoverThread(state: DurableAlaiState): DurableAlaiState {
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

export function recoverInterruptedAlaiState(state: DurableAlaiState): DurableAlaiState {
  const root = recoverThread(state);
  const practice = state.practiceThread ? recoverThread(state.practiceThread) : undefined;
  return practice === state.practiceThread ? root : { ...root, practiceThread: practice };
}

export function beginAlaiTurn(
  state: DurableAlaiState,
  input: { turnId: string; userMessageId: string; content: string; timestamp: number; interactionMode?: AlaiInteractionMode; practiceStart?: boolean; practiceSlot?: string; hidden?: boolean },
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
      ...(input.interactionMode === 'answer' ? { interactionMode: 'answer' as const, ...(input.practiceStart ? { practiceStart: true } : {}), ...(input.practiceSlot ? { practiceSlot: input.practiceSlot } : {}) } : {}),
    },
  };
}

export function selectedAlaiThread(root: Pick<DurableAlaiState, 'selectedThread'>): AlaiThread {
  return root.selectedThread === 'answer' ? 'answer' : 'ask';
}

export function initialPracticeThread(): DurableAlaiState {
  return { messages: [], currentTurn: null, draft: '' };
}

/** The visible state of one thread. 'ask' is the root record itself (legacy-compatible); 'answer' is nested. */
export function alaiThreadState(root: DurableAlaiState, thread: AlaiThread): DurableAlaiState {
  return thread === 'answer' ? root.practiceThread ?? initialPracticeThread() : root;
}

/** Write one thread back without touching the other one. */
export function withAlaiThreadState(root: DurableAlaiState, thread: AlaiThread, next: DurableAlaiState): DurableAlaiState {
  if (thread === 'answer') return { ...root, practiceThread: next };
  return { ...next, selectedThread: root.selectedThread, ...(root.practiceThread ? { practiceThread: root.practiceThread } : {}) };
}

/** Switching threads never edits messages or turns; it is refused while any turn is in flight. */
export function selectAlaiThread(root: DurableAlaiState, thread: AlaiThread): DurableAlaiState {
  if (root.currentTurn?.status === 'sending' || root.practiceThread?.currentTurn?.status === 'sending' || selectedAlaiThread(root) === thread) return root;
  return { ...root, selectedThread: thread };
}

/** Identity of the pending Responder question: the durable turn that generated the last assistant message. */
export function alaiPendingQuestionRef(thread: DurableAlaiState): string | null {
  for (let index = thread.messages.length - 1; index >= 0; index--) {
    const message = thread.messages[index];
    if (message.role === 'assistant') return message.conversationContext?.practiceQuestionRef || null;
  }
  return null;
}

export type AlaiPracticePhase = 'EMPTY' | 'STARTING' | 'EVALUATING' | 'RECOVERABLE' | 'QUESTION_PENDING';

/** Derived, never stored: a tab switch cannot change it. Only a submitted answer / generated turn moves it. */
export function alaiPracticePhase(thread: DurableAlaiState): AlaiPracticePhase {
  const turn = thread.currentTurn;
  const hasQuestion = thread.messages.some(message => message.role === 'assistant');
  if (turn?.status === 'sending') return hasQuestion ? 'EVALUATING' : 'STARTING';
  if (turn?.status === 'recoverable') return 'RECOVERABLE';
  return hasQuestion ? 'QUESTION_PENDING' : 'EMPTY';
}

/** Responder may generate its first question ONLY when the thread is genuinely new: no messages, no turn. */
export function needsPracticeStart(root: DurableAlaiState): boolean {
  const thread = alaiThreadState(root, 'answer');
  return thread.messages.length === 0 && !thread.currentTurn;
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

/**
 * The request for the turn currently in flight on ONE thread. Everything comes from that thread and the frozen
 * turn, so a retry replays exactly the same request and the other thread can never leak into it.
 */
export function buildAlaiTurnRequest(
  thread: DurableAlaiState,
  input: { sessionId?: string; turnId: string; attempt: number; materia: string; tema: string; masteryContext?: unknown },
): Record<string, unknown> {
  const turn = thread.currentTurn;
  const userMessage = thread.messages.find(message => message.id === turn?.userMessageId);
  const lastAssistant = [...thread.messages].reverse().find(message => message.role === 'assistant');
  return {
    sessionId: input.sessionId,
    message: userMessage?.content ?? '',
    turnId: input.turnId,
    attempt: input.attempt,
    conversationContext: lastAssistant?.conversationContext,
    // Frozen on the turn, so a retry replays the exact same mode/slot.
    ...(turn?.interactionMode === 'answer' ? { interactionMode: 'answer', practiceSlot: turn.practiceSlot, ...(turn.practiceStart ? { practiceStart: true } : {}) } : {}),
    // Bounded — deterministic retrieval/grounding is the academic authority, not accumulated assistant prose.
    history: boundedHistory(thread.messages
      .filter(message => message.id !== userMessage?.id && !message.hidden)
      .slice(-6)
      .map(message => ({ role: message.role, content: message.content }))),
    materia: input.materia,
    tema: input.tema,
    masteryContext: input.masteryContext,
  };
}
