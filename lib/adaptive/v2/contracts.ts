// ═══════════════════════════════════════════════════════════════
// StudyAL Adaptive V2 — Contratos de APIs
// 
// Cada API tiene un contrato claro de entrada y salida.
// Los motores nunca acceden al DOM ni a APIs externas directamente.
// ═══════════════════════════════════════════════════════════════

import type {
  StudentModel,
  MaterialIntelligence,
  PedagogicalState,
  PedagogicalDecision,
  StudyGoal,
  SessionBlueprint,
  BookPage,
  Interaction,
  EvidenceRecord,
  TopicNode,
  TopicMastery,
} from './types'

// ═══════════════════════════════════════════════════════════════
// API: analyze-material
// ═══════════════════════════════════════════════════════════════

export interface AnalyzeMaterialRequest {
  materialId: string
  materialTitle: string
  materialText: string
  totalPages?: number
  subjectHint?: string
}

export interface AnalyzeMaterialResponse {
  success: boolean
  intelligence?: MaterialIntelligence
  error?: string
}

// ═══════════════════════════════════════════════════════════════
// API: create-plan
// ═══════════════════════════════════════════════════════════════

export interface CreatePlanRequest {
  intelligence: MaterialIntelligence
  student: StudentModel
  goal: StudyGoal
}

export interface CreatePlanResponse {
  success: boolean
  sessions?: SessionBlueprint[]
  strategy?: {
    reasoning: string
    goals: string[]
    projectedProgress: number[]
    warnings: string[]
  }
  error?: string
}

// ═══════════════════════════════════════════════════════════════
// API: decide-next (EL CEREBRO)
// ═══════════════════════════════════════════════════════════════

export interface DecideNextRequest {
  // Estado actual
  state: PedagogicalState
  
  // Contexto completo
  student: StudentModel
  material: MaterialIntelligence
  sessionBlueprint: SessionBlueprint
  goal: StudyGoal
  
  // Historial de esta sesión
  sessionHistory: {
    pagesShown: BookPage[]
    evidenceCollected: EvidenceRecord[]
    interactionsCompleted: number
  }
  
  // Última respuesta del estudiante (si hubo)
  lastResponse?: {
    interactionId: string
    studentAnswer: any
    responseTimeSeconds: number
    confidence?: 'high' | 'medium' | 'low' | 'guess'
  }
}

export interface DecideNextResponse {
  success: boolean
  decision?: PedagogicalDecision
  
  // Si hubo evaluación, incluir el análisis
  evaluation?: {
    correct: boolean
    score: number
    dimension: string
    feedback: {
      whatWasCorrect: string
      whatWasMissing: string
      correctExplanation: string
      identifiedConcepts: string[]
      missedConcepts: string[]
    }
    evidenceRecord: EvidenceRecord
  }
  
  // Estado actualizado
  updatedState?: PedagogicalState
  updatedMastery?: TopicMastery
  
  // Si la sesión debe cerrarse
  shouldCloseSession?: boolean
  
  error?: string
}

// ═══════════════════════════════════════════════════════════════
// API: session-summary
// ═══════════════════════════════════════════════════════════════

export interface SessionSummaryRequest {
  sessionBlueprint: SessionBlueprint
  finalState: PedagogicalState
  evidenceRecords: EvidenceRecord[]
  masteryChanges: Array<{
    topicId: string
    before: TopicMastery
    after: TopicMastery
  }>
  student: StudentModel
}

export interface SessionSummaryResponse {
  success: boolean
  summary?: {
    headline: string
    whatYouLearned: string[]
    whatYouCanDoNow: string[]
    whatNeedsWork: string[]
    nextSessionPreview: string
    encouragement: string
    dominioGained: number
    conceptsMastered: string[]
    conceptsToReview: string[]
  }
  updatedPedagogicalMemory?: any
  error?: string
}

// ═══════════════════════════════════════════════════════════════
// Helpers para construir requests
// ═══════════════════════════════════════════════════════════════

export function buildInitialStudentModel(profile: any, setup: any): StudentModel {
  return {
    profile,
    setup,
    observed: {
      learnsBestWith: [],
      strugglesWith: [],
      averageResponseTimeSeconds: 30,
      pace: 'medium',
      confidenceCalibration: 'calibrated',
      falseConfidenceCount: 0,
      fatigueLevel: 'low',
      motivationLevel: 'medium',
      toleratesLongExplanations: true,
      prefersExamplesFirst: false,
      respondsWellToAnalogy: true,
      respondsWellToCases: true,
    },
    pedagogicalMemory: {
      recurringMistakes: [],
      effectiveFormats: [],
      ineffectiveFormats: [],
      effectiveStrategies: [],
      notes: [],
    },
    masteryByTopic: {},
  }
}

export function buildInitialPedagogicalState(sessionId: string): PedagogicalState {
  return {
    sessionId,
    startedAt: Date.now(),
    currentTopicId: null,
    currentTopicTitle: null,
    topicsCoveredThisSession: [],
    topicsRemaining: [],
    loopPhase: 'introducing',
    loopIteration: 0,
    recentPages: [],
    recentInteractions: [],
    recentEvidence: [],
    studentEnergy: 'fresh',
    streakCount: 0,
    strugglingCount: 0,
    totalPagesShown: 0,
    totalInteractions: 0,
    elapsedMinutes: 0,
  }
}

export function buildStudyGoal(setup: any): StudyGoal {
  const daysMap: Record<string, number> = {
    today: 0, tomorrow: 1, in_3_days: 3, in_1_week: 7,
    in_2_weeks: 14, in_1_month: 30, no_exam: 90,
  }
  const days = setup.examDate ? (daysMap[setup.examDate] ?? 14) : 14
  const target = Number(setup.targetScore) || 80
  
  let primaryObjective: any = 'deep_learning'
  let urgency: any = 'medium'
  
  if (days === 0) {
    primaryObjective = 'exam_tomorrow'
    urgency = 'critical'
  } else if (days <= 3) {
    primaryObjective = 'exam_tomorrow'
    urgency = 'high'
  } else if (days <= 7) {
    primaryObjective = 'exam_this_week'
    urgency = 'high'
  } else if (days <= 30) {
    primaryObjective = 'exam_this_month'
    urgency = 'medium'
  } else if (target >= 95) {
    primaryObjective = 'perfect_score'
    urgency = 'medium'
  } else if (target <= 65) {
    primaryObjective = 'just_pass'
    urgency = 'low'
  }
  
  return {
    primaryObjective,
    targetScore: target,
    daysUntilDeadline: days === 90 ? null : days,
    sessionDurationMinutes: setup.sessionLength === 'short' ? 12 : setup.sessionLength === 'long' ? 35 : 22,
    urgency,
    prioritizeSpeed: urgency === 'critical' || urgency === 'high',
    prioritizeDepth: urgency === 'low' && target >= 85,
    prioritizeApplication: primaryObjective === 'exam_tomorrow' || primaryObjective === 'exam_this_week',
    prioritizeConcepts: primaryObjective === 'deep_learning' || primaryObjective === 'perfect_score',
  }
}
