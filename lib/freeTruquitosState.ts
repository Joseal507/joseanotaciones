export type TruquitosStatus = 'idle' | 'generating' | 'completed' | 'recoverable';
export type TruquitosQuickFilter = 'all' | 'favorites' | 'hard' | 'exam' | 'memory';

export interface TruquitosCard {
  id: string;
  type: string;
  stage?: string;
  title: string;
  content: string;
  concept?: string;
  difficulty?: number;
  forgetRisk?: number;
  sourcePages?: number[];
  sourceMaterial?: string;
  sourceMaterialName?: string;
  tags?: string[];
}

export interface DurableFreeTruquitosState {
  status: TruquitosStatus;
  attempt: number;
  cards: TruquitosCard[];
  favorites: string[];
  known: string[];
  saved: string[];
  variants: Record<string, TruquitosCard | null>;
  quickFilter: TruquitosQuickFilter;
  pdfCollapsed: boolean;
  activeMaterialIndex: number;
  forcedPage?: number;
  error?: string;
  generatedAt?: number;
}

export function initialFreeTruquitosState(): DurableFreeTruquitosState {
  return {
    status: 'idle',
    attempt: 0,
    cards: [],
    favorites: [],
    known: [],
    saved: [],
    variants: {},
    quickFilter: 'all',
    pdfCollapsed: false,
    activeMaterialIndex: 0,
    forcedPage: undefined,
  };
}

export function recoverInterruptedFreeTruquitos(
  state: DurableFreeTruquitosState,
): DurableFreeTruquitosState {
  if (state.status !== 'generating') return state;
  if (state.cards.length > 0) {
    return {
      ...state,
      status: 'completed',
    };
  }
  return {
    ...state,
    status: 'recoverable',
    error: 'La generación se interrumpió. Puedes reintentar estos Truquitos.',
  };
}

export function beginFreeTruquitos(
  state: DurableFreeTruquitosState,
): DurableFreeTruquitosState {
  if (state.status === 'generating') return state;
  const { error: _error, ...rest } = state;
  return {
    ...rest,
    status: 'generating',
    attempt: state.attempt + 1,
  };
}

export function completeFreeTruquitos(
  state: DurableFreeTruquitosState,
  attempt: number,
  cards: TruquitosCard[],
): DurableFreeTruquitosState {
  if (state.status !== 'generating' || state.attempt !== attempt) return state;
  const { error: _error, ...rest } = state;
  return {
    ...rest,
    status: 'completed',
    cards,
    generatedAt: Date.now(),
  };
}

export function failFreeTruquitos(
  state: DurableFreeTruquitosState,
  attempt: number,
  error: string,
): DurableFreeTruquitosState {
  if (state.status !== 'generating' || state.attempt !== attempt) return state;
  if (state.cards.length > 0) {
    return {
      ...state,
      status: 'completed',
    };
  }
  return {
    ...state,
    status: 'recoverable',
    error,
  };
}

export function updateFreeTruquitosState(
  state: DurableFreeTruquitosState,
  patch: Partial<
    Pick<
      DurableFreeTruquitosState,
      | 'favorites'
      | 'known'
      | 'saved'
      | 'variants'
      | 'quickFilter'
      | 'pdfCollapsed'
      | 'activeMaterialIndex'
      | 'forcedPage'
    >
  >,
): DurableFreeTruquitosState {
  return {
    ...state,
    ...patch,
  };
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function assignStableCardIds(
  rawCards: Array<Omit<TruquitosCard, 'id'> & Partial<Pick<TruquitosCard, 'id'>>>,
): TruquitosCard[] {
  return rawCards.map(card => ({
    ...card,
    id: typeof card.id === 'string' && card.id.trim() ? card.id : uid(),
  }));
}
