export type StudyMapStatus = 'idle' | 'generating' | 'completed' | 'recoverable';
export type StudyMapView = 'map' | 'cards' | 'outline';

export interface StudyMapNode {
  id: string;
  label: string;
  type: 'root' | 'branch' | 'leaf' | 'detail';
  children?: StudyMapNode[];
  color?: string;
  emoji?: string;
  page?: number;
  description?: string;
}

export interface StudyMapData {
  title: string;
  root: StudyMapNode;
  summary?: string;
  totalConcepts?: number;
}

export interface StudyMapExplanationState {
  answer: string;
  inMaterial?: boolean;
  outsideMaterialNote?: string;
  sourcePages?: number[];
  suggestedFollowups?: string[];
}

export interface DurableFreeStudyMapState {
  status: StudyMapStatus;
  attempt: number;
  mapData: StudyMapData | null;
  studiedNodeIds: string[];
  expandedNodeIds: string[];
  selectedNodeId: string | null;
  view: StudyMapView;
  showGuidedTour: boolean;
  tourIndex: number;
  explanationsByNodeId: Record<string, StudyMapExplanationState>;
  error?: string;
  generatedAt?: number;
}

export function initialFreeStudyMapState(): DurableFreeStudyMapState {
  return {
    status: 'idle',
    attempt: 0,
    mapData: null,
    studiedNodeIds: [],
    expandedNodeIds: [],
    selectedNodeId: null,
    view: 'map',
    showGuidedTour: false,
    tourIndex: 0,
    explanationsByNodeId: {},
  };
}

export function recoverInterruptedFreeStudyMap(
  state: DurableFreeStudyMapState,
): DurableFreeStudyMapState {
  if (state.status !== 'generating') return state;
  if (state.mapData) {
    return {
      ...state,
      status: 'completed',
    };
  }
  return {
    ...state,
    status: 'recoverable',
    error: 'La generación se interrumpió. Puedes reintentar este mismo Study Map.',
  };
}

export function beginFreeStudyMap(
  state: DurableFreeStudyMapState,
): DurableFreeStudyMapState {
  if (state.status === 'generating') return state;
  const { error: _error, ...rest } = state;
  return {
    ...rest,
    status: 'generating',
    attempt: state.attempt + 1,
  };
}

export function completeFreeStudyMap(
  state: DurableFreeStudyMapState,
  attempt: number,
  mapData: StudyMapData,
): DurableFreeStudyMapState {
  if (state.status !== 'generating' || state.attempt !== attempt) return state;
  const { error: _error, ...rest } = state;
  return {
    ...rest,
    status: 'completed',
    mapData,
    generatedAt: Date.now(),
    expandedNodeIds: state.expandedNodeIds.length > 0 ? state.expandedNodeIds : [mapData.root.id],
  };
}

export function failFreeStudyMap(
  state: DurableFreeStudyMapState,
  attempt: number,
  error: string,
): DurableFreeStudyMapState {
  if (state.status !== 'generating' || state.attempt !== attempt) return state;
  return {
    ...state,
    status: 'recoverable',
    error,
  };
}

export function updateFreeStudyMapState(
  state: DurableFreeStudyMapState,
  patch: Partial<
    Pick<
      DurableFreeStudyMapState,
      | 'studiedNodeIds'
      | 'expandedNodeIds'
      | 'selectedNodeId'
      | 'view'
      | 'showGuidedTour'
      | 'tourIndex'
      | 'explanationsByNodeId'
    >
  >,
): DurableFreeStudyMapState {
  return {
    ...state,
    ...patch,
  };
}
