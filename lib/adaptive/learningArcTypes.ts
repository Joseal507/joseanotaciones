import type { LearningRole, LearningPathUnit } from './learningPathTypes';

export interface LearningArc {
  id: string;
  order: number;

  title: string;
  purpose: string;

  role: LearningRole;
  unitIds: string[];

  prerequisiteArcIds: string[];
  unlocksArcIds: string[];

  totalLoad: number;
}

export interface StudyChapter {
  id: string;
  arcId: string;
  segmentIndex: number;

  chapterNumber: number;
  kind: 'introduction' | 'learning' | 'final_review';

  title: string;
  hook: string;
  objective: string;
  why: string;
  unlockMessage: string;
  exitCriteria: string[];

  ownedConceptIds: string[];
  previewConceptIds: string[];
  reviewConceptIds: string[];

  unitIds: string[];
  topicIds: string[];
  blockIds: string[];
  pages: number[];
  concepts: string[];

  arcRole: LearningRole | 'orientation' | 'final_review';
  arcLabel: string;

  challengeLevel: 1 | 2 | 3 | 4 | 5;
  cognitiveLoad: 'light' | 'medium' | 'heavy';

  status: 'locked' | 'available' | 'done';
  prerequisites: number[];
  unlocks: number[];
}

export interface LearningJourney {
  id: string;
  version: number;
  createdAt: number;
  programGoal: string;
  programNarrative: string;
  programObjectives: string[];
  coverageTarget: 100;
  planBadges?: string[];
  arcs: LearningArc[];
  chapters: StudyChapter[];
  totalChapters: number;
  setupSnapshot: any;
  blueprintVersion: number;
  materialIds?: string[];
  selectedPages?: Record<string, number[]>;
  sourceSelectionFingerprint?: string;
}
