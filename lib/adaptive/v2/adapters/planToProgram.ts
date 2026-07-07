// ═══════════════════════════════════════════════════════════════
// Adapter: StoredPlan (v2) → AdaptiveProgram (v1)
// El libro visual usa el formato v1, adaptamos los datos v2.
// ═══════════════════════════════════════════════════════════════

import type { StoredPlan } from '../storage/plan'
import type { MaterialIntelligence, SessionBlueprint } from '../types'
import type {
  AdaptiveProgram,
  AdaptiveSession,
  AdaptiveStep,
  AdaptiveProgramSetup,
  SessionPurpose,
} from '../../program'

const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

function mapSessionKindToPurpose(kind: string): SessionPurpose {
  const map: Record<string, SessionPurpose> = {
    first_contact: 'understand',
    deep_dive: 'organize',
    connect_ideas: 'organize',
    practice_heavy: 'apply',
    rescue_weak_topics: 'repair',
    exam_simulation: 'simulate',
    final_review: 'simulate',
    consolidation: 'memorize',
  }
  return map[kind] || 'understand'
}

function buildBasicSteps(sessionMinutes: number, topicIds: string[], topicTitles: string[]): AdaptiveStep[] {
  const steps: AdaptiveStep[] = []

  steps.push({
    id: `step_intro_${genId()}`,
    type: 'explain',
    engine: 'repasar',
    title: 'Introducción',
    instruction: `Introducir topics: ${topicTitles.slice(0, 3).join(', ')}`,
    estimatedMinutes: 3,
    evidenceRequired: false,
    status: 'pending',
    conceptsTargeted: topicTitles.slice(0, 3),
  })

  steps.push({
    id: `step_teach_${genId()}`,
    type: 'explain',
    engine: 'analisis',
    title: 'Aprender conceptos',
    instruction: `Enseñar y verificar comprensión de: ${topicTitles.join(', ')}`,
    estimatedMinutes: Math.round(sessionMinutes * 0.6),
    evidenceRequired: true,
    status: 'pending',
    conceptsTargeted: topicTitles,
  })

  steps.push({
    id: `step_check_${genId()}`,
    type: 'active_recall',
    engine: 'alai',
    title: 'Verificar dominio',
    instruction: 'Verificar comprensión mediante recall activo',
    estimatedMinutes: Math.round(sessionMinutes * 0.3),
    evidenceRequired: true,
    status: 'pending',
    conceptsTargeted: topicTitles,
  })

  return steps
}

function convertSession(
  blueprint: SessionBlueprint,
  intelligence: MaterialIntelligence,
  index: number,
): AdaptiveSession {
  const topics = blueprint.targetTopics
    .map(id => intelligence.topics.find(t => t.id === id))
    .filter(Boolean) as any[]

  const topicTitles = topics.map(t => t.title)
  const topicsSourcePages = topics.flatMap(t => t.sourcePage ? [t.sourcePage] : [])

  const title = (blueprint as any).title || blueprint.mission.slice(0, 60)
  const purpose = mapSessionKindToPurpose(blueprint.sessionKind)

  return {
    id: blueprint.sessionId,
    sessionNumber: blueprint.sessionNumber,
    title,
    objective: blueprint.mission,
    estimatedMinutes: blueprint.estimatedMinutes,
    status: blueprint.status === 'ready' ? 'available'
      : blueprint.status === 'in_progress' ? 'in_progress'
      : blueprint.status === 'completed' ? 'completed'
      : 'locked',
    purpose,
    steps: buildBasicSteps(blueprint.estimatedMinutes, blueprint.targetTopics, topicTitles),
    expectedDomainGain: Math.round(15 + (blueprint.sessionNumber * 3)),
    topicId: topics[0]?.id,
    topicTitle: topics[0]?.title || title,
    targetConcepts: topicTitles,
    sourcePages: topicsSourcePages,
    evidenceGoal: blueprint.learningObjectives.map(lo => lo.objective).join('; '),
    sessionFormat: blueprint.sessionKind,
    blueprintConfidence: 100,
    planRationale: blueprint.mission,
    groupedTopicIds: blueprint.targetTopics,
  }
}

export function convertPlanToProgram(
  plan: StoredPlan,
  intelligence: MaterialIntelligence,
  setup: any,
): AdaptiveProgram {
  const sessions = plan.sessions.map((s, i) => convertSession(s, intelligence, i))

  const materialBlueprint = {
    materialId: plan.materialId,
    materialTitle: plan.materialTitle,
    validationPassed: true,
    subjectArea: intelligence.subjectArea,
    topics: intelligence.topics.map(t => ({
      id: t.id,
      title: t.title,
      concepts: t.keyFacts.map((f, i) => ({
        name: f.slice(0, 50),
        definition: f,
        difficulty: 50,
      })),
      difficulty: t.cognitiveLoad === 'heavy' ? 80 : t.cognitiveLoad === 'medium' ? 50 : 30,
      importance: t.importance === 'critical' ? 100
        : t.importance === 'high' ? 75
        : t.importance === 'medium' ? 50 : 25,
      sourcePages: t.sourcePage ? [t.sourcePage] : [],
    })),
    analyzedAt: intelligence.analyzedAt,
  }

  const setupCompat: AdaptiveProgramSetup = {
    initialKnowledgeLevel: setup.initialKnowledgeLevel || 'some',
    sessionLength: setup.sessionLength || 'medium',
    targetScore: setup.targetScore || 80,
    examDate: setup.examDate || null,
    dailyMinutes: setup.dailyMinutes || 45,
    evalPreference: setup.evalPreference || 'mix_everything',
  }

  return {
    id: plan.planId,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    materialIds: [plan.materialId],
    setup: setupCompat,
    status: 'active',
    sessions,
    currentSessionIndex: plan.currentSessionIndex,
    materialBlueprint,
    materialAnalysis: intelligence,
    strategy: {
      why: plan.strategy.reasoning,
      goals: plan.strategy.goals,
      projectedDomain: plan.strategy.projectedProgress,
      conflictDetected: plan.strategy.warnings.length > 0,
      conflictMessage: plan.strategy.warnings.join('. '),
    },
  }
}
