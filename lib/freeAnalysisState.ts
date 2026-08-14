export type FreeAnalysisType = 'secundaria' | 'universidad' | 'medicina' | 'doctorado';
export type FreeAnalysisStatus = 'idle' | 'generating' | 'completed' | 'recoverable';

export interface FreeAnalysisEntry<T = unknown> {
  type: FreeAnalysisType;
  status: FreeAnalysisStatus;
  attempt: number;
  result?: T;
  error?: string;
  activeSection: string;
  readSections: string[];
  shownSelfChecks: Record<number, boolean>;
  shownCheckAnswers: Record<number, boolean>;
  doubtDraft: string;
  doubtAnswer: string;
  doubtError: string;
  completed: boolean;
}

export interface DurableFreeAnalysisState<T = unknown> {
  selectedType: FreeAnalysisType;
  resultsByType: Partial<Record<FreeAnalysisType, FreeAnalysisEntry<T>>>;
}

export function initialFreeAnalysisState<T = unknown>(
  selectedType: FreeAnalysisType = 'universidad',
): DurableFreeAnalysisState<T> {
  return { selectedType, resultsByType: {} };
}

export function initialFreeAnalysisEntry<T = unknown>(type: FreeAnalysisType): FreeAnalysisEntry<T> {
  return {
    type,
    status: 'idle',
    attempt: 0,
    activeSection: 'vision',
    readSections: [],
    shownSelfChecks: {},
    shownCheckAnswers: {},
    doubtDraft: '',
    doubtAnswer: '',
    doubtError: '',
    completed: false,
  };
}

export function recoverInterruptedFreeAnalysis<T>(
  state: DurableFreeAnalysisState<T>,
): DurableFreeAnalysisState<T> {
  let changed = false;
  const resultsByType = { ...state.resultsByType };
  for (const [type, entry] of Object.entries(resultsByType) as [FreeAnalysisType, FreeAnalysisEntry<T>][]) {
    if (entry?.status !== 'generating') continue;
    changed = true;
    resultsByType[type] = {
      ...entry,
      status: 'recoverable',
      error: 'La generación se interrumpió. Puedes reintentar este mismo análisis.',
    };
  }
  return changed ? { ...state, resultsByType } : state;
}

export function beginFreeAnalysis<T>(
  state: DurableFreeAnalysisState<T>,
  type: FreeAnalysisType,
): DurableFreeAnalysisState<T> {
  const current = state.resultsByType[type] || initialFreeAnalysisEntry<T>(type);
  if (current.status === 'generating') return state;
  const { error: _error, ...rest } = current;
  return {
    ...state,
    selectedType: type,
    resultsByType: {
      ...state.resultsByType,
      [type]: { ...rest, type, attempt: current.attempt + 1, status: 'generating' },
    },
  };
}

export function completeFreeAnalysis<T>(
  state: DurableFreeAnalysisState<T>,
  type: FreeAnalysisType,
  attempt: number,
  result: T,
): DurableFreeAnalysisState<T> {
  const current = state.resultsByType[type];
  if (!current || current.status !== 'generating' || current.attempt !== attempt) return state;
  const { error: _error, ...rest } = current;
  return {
    ...state,
    selectedType: type,
    resultsByType: {
      ...state.resultsByType,
      [type]: { ...rest, result, status: 'completed' },
    },
  };
}

export function failFreeAnalysis<T>(
  state: DurableFreeAnalysisState<T>,
  type: FreeAnalysisType,
  attempt: number,
  error: string,
): DurableFreeAnalysisState<T> {
  const current = state.resultsByType[type];
  if (!current || current.status !== 'generating' || current.attempt !== attempt) return state;
  return {
    ...state,
    resultsByType: {
      ...state.resultsByType,
      [type]: { ...current, status: 'recoverable', error },
    },
  };
}

export function updateFreeAnalysisEntry<T>(
  state: DurableFreeAnalysisState<T>,
  type: FreeAnalysisType,
  patch: Partial<FreeAnalysisEntry<T>>,
): DurableFreeAnalysisState<T> {
  const current = state.resultsByType[type] || initialFreeAnalysisEntry<T>(type);
  return {
    ...state,
    selectedType: type,
    resultsByType: { ...state.resultsByType, [type]: { ...current, ...patch, type } },
  };
}
