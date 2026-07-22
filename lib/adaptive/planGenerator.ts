import type { AdaptiveSetup } from '../studySessions';
import { buildLearningJourney } from './journeyBuilder';

export interface LegacyPlanSession {
  sessionNumber: number;
  type: string;
  title: string;
  objective: string;
  why: string;
  whatYouWillBeAbleToDo: string[];
  unitIds: string[];
  blockIds: string[];
  topicIds: string[];
  pages: number[];
  concepts: string[];
  prerequisites: number[];
  unlocks: number[];
  exitCriteria: string[];
  cognitiveLoad: 'light' | 'medium' | 'heavy';
  conceptCount: number;
  highImportanceCount: number;
  difficultyBreakdown: {
    basic: number;
    intermediate: number;
    advanced: number;
  };
  status: 'locked' | 'available' | 'active' | 'done';
}

export interface LegacyStudyPlan {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  materialTitle: string;
  programGoal: string;
  programObjectives: string[];
  coverageTarget: 100;
  totalCognitiveUnits: number;
  dependencyMap: {
    topicId: string;
    topicLabel: string;
    dependsOn: string[];
  }[];
  sessions: LegacyPlanSession[];
  totalSessions: number;
  blueprintVersion: number;
  setupSnapshot: AdaptiveSetup;
  cognitiveUnits: any[];
}

export function generateStudyPlan(
  rawBlueprint: any,
  setup: AdaptiveSetup,
  _userProfile: any,
  materialTitle: string,
): LegacyStudyPlan {
  const journey = buildLearningJourney(rawBlueprint, setup, materialTitle);

  const sessions: LegacyPlanSession[] = journey.chapters.map(ch => ({
    sessionNumber: ch.chapterNumber,
    type: ch.type === 'learning' ? 'deep' : ch.type,
    title: ch.title,
    objective: ch.objective,
    why: ch.why,
    whatYouWillBeAbleToDo: ch.exitCriteria || [],
    unitIds: [],
    blockIds: ch.blockIds,
    topicIds: ch.topicIds,
    pages: ch.pages,
    concepts: ch.concepts,
    prerequisites: ch.prerequisites,
    unlocks: ch.unlocks,
    exitCriteria: ch.exitCriteria || [],
    cognitiveLoad: ch.cognitiveLoad || 'medium',
    conceptCount: ch.concepts.length,
    highImportanceCount: 0,
    difficultyBreakdown: { basic: 0, intermediate: 0, advanced: 0 },
    status: ch.status,
  }));

  const topics = rawBlueprint?.topics?.length ? rawBlueprint.topics : (rawBlueprint?.topicsIndex || []);

  return {
    id: journey.id.replace('journey_', 'plan_'),
    version: journey.version,
    createdAt: journey.createdAt,
    updatedAt: Date.now(),
    materialTitle: materialTitle,
    programGoal: journey.programGoal,
    programObjectives: topics.map((t: any) => `Comprender ${t.title}`),
    coverageTarget: 100,
    totalCognitiveUnits: journey.arcs.reduce((s, a) => s + a.unitIds.length, 0),
    dependencyMap: [],
    sessions,
    totalSessions: sessions.length,
    blueprintVersion: journey.blueprintVersion,
    setupSnapshot: setup,
    cognitiveUnits: [],
  };
}
