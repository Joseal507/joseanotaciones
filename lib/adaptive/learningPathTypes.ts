export type LearningRole =
  | 'foundation'
  | 'problem'
  | 'mechanism'
  | 'application'
  | 'integration'
  | 'context';

export interface CanonicalTopic {
  id: string;
  title: string;
  summary?: string;
  pages: number[];
  order?: number;
}

export interface CanonicalRelation {
  type: string;
  targetId: string | null;
  targetLabel: string;
}

export interface SourceSpan {
  page: number;          // página exacta donde aparece
  quote: string;         // fragmento literal del texto fuente (max 200 chars)
  certainty: 'supported' | 'inferred' | 'uncertain';
}

export interface CanonicalBlock {
  id: string;
  kind: string;
  label: string;
  summary: string;
  topicId: string | null;
  topicLabel: string;
  pages: number[];
  firstPage?: number;
  globalOrder: number;
  importance: number;
  difficulty: 'basic' | 'intermediate' | 'advanced';
  dependsOn: string[];
  relatedTo?: string[];
  relations: CanonicalRelation[];
  misconceptions?: string[];
  bloomLevel?: string;
  examProbability?: number;
  estimatedMinutes?: number;
  // Evidencia fuente — opcional por compatibilidad con pipeline legacy
  sourceSpans?: SourceSpan[];
}

export interface CanonicalConcept {
  id: string;
  name: string;
  kind: string;
  summary?: string;
  importance?: number;
  difficulty?: string;
  pages?: number[];
  dependsOn?: string[];
  relatedTo?: string[];
}

export interface CanonicalBlueprint {
  version?: number;
  createdAt?: number;
  topics: CanonicalTopic[];
  blocks: CanonicalBlock[];
  concepts: CanonicalConcept[];
  materials?: any[];
}

export interface LearningPathEdge {
  fromUnitId: string;
  toUnitId: string;
  reason: string;
}

export interface LearningPathUnit {
  id: string;

  title: string;
  purpose: string;

  topicIds: string[];
  conceptIds: string[];
  blockIds: string[];

  prerequisiteUnitIds: string[];
  unlocksUnitIds: string[];

  orderHint: number;
  dependencyDepth: number;

  cognitiveLoad: number;
  importance: number;
  difficulty: number;

  role: LearningRole;

  topicLabels: string[];
  concepts: string[];
  pages: number[];
}

export interface LearningPath {
  units: LearningPathUnit[];
  orderedUnitIds: string[];

  conceptOwnerUnit: Record<string, string>;

  edges: LearningPathEdge[];
}
