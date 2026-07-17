// ═══════════════════════════════════════════════════════════════
// SIMULATION TYPES
// ═══════════════════════════════════════════════════════════════

import type { AssistanceLevel } from '../../../lib/adaptive/v3/engine/confidenceTracker'
import type { InteractionContext } from '../../../lib/adaptive/v3/engine/evidenceEngine'
import type { CognitiveType } from '../../../lib/adaptive/v3/types'

// ─── Perfil de estudiante simulado ──────────────────────────────
export type StudentProfileId =
  | 'expert'
  | 'honest_beginner'
  | 'high_confidence_misconception'
  | 'assistance_dependent'
  | 'slow_but_correct'
  | 'guesser'
  | 'memorizer_no_transfer'
  | 'deep_understanding'
  | 'forgetful'
  | 'resistant'
  | 'inconsistent'
  | 'dropout_returning'
  | 'low_confidence_expert'
  | 'hint_user'
  | 'reveal_then_recover'
  | 'legacy_student'

export type StudentProfileSegment = 'capable' | 'recoverable' | 'adversarial'

export interface SegmentMetrics {
  runs: number
  programComplete: number
  programCompletionRate: number
  avgTurnsPerMicro: number
  maxTurnsPerMicro: number
  repairSuccessRate: number | null
  strategyChangeRate: number | null
  strategyChangeOpportunities: number
  strategyChanges: number
  falseMasteryCases: number
}

export interface SimulatedStudentProfile {
  id: StudentProfileId
  label: string
  // Dominio latente base por tipo cognitivo [0-1]
  baseKnowledgeByType: Partial<Record<CognitiveType, number>>
  defaultBaseKnowledge: number
  // Calibración de confianza: positivo=overconfident, negativo=underconfident
  confidenceCalibration: number
  // Tasa de uso de ayudas
  hintUsageRate: number
  // Probabilidad de pedir reveal tras fallo
  revealRate: number
  // Tasa de olvido por hora virtual [0-1]
  forgettingRate: number
  // Tasa de mejora con práctica [0-1]
  learningRate: number
  // Tendencia a adivinar en MCQ
  guessRate: number
  // Si abandona sesiones
  dropoutRate: number
  // Velocidad de respuesta (multiplicador sobre baseline)
  responseSpeedMultiplier: number
  // Si mejora con el tiempo
  canImprove: boolean
}

// ─── Estado latente por micro (invisible para el motor) ──────────
export interface LatentMicroState {
  microId: string
  trueKnowledge: number        // 0-1 conocimiento real
  recallStrength: number       // 0-1 fuerza de memoria
  transferAbility: number      // 0-1 capacidad de transferir
  integrationAbility: number   // 0-1 capacidad de integrar
  misconceptionStrength: number // 0-1 fuerza de misconception activa
  fatigue: number              // 0-1 cansancio acumulado
  exposures: number            // cuántas veces fue expuesto
  lastExposureAtMs: number     // reloj virtual en ms
}

// ─── Respuesta simulada ──────────────────────────────────────────
export interface SimulatedResponse {
  outcome: 'correct' | 'partial' | 'incorrect'
  score: number                          // 0-100
  responseTimeMs: number
  assistanceLevel: AssistanceLevel
  selfReportedConfidence: number | undefined
  interactionContext: InteractionContext
  attemptNumber: number
  wasRetry: boolean
  elapsedSinceLastExposureMs: number | undefined
  // Solo para debugging — no va al motor
  _latentKnowledgeAtTime: number
  _wasGuess: boolean
}

// ─── Turno de simulación ─────────────────────────────────────────
export interface SimulationTurn {
  turnIndex: number
  sessionIndex: number
  microId: string
  format: string
  objective: string
  response: SimulatedResponse
  engineDecision: {
    objective: string
    reason: string
    strategyId: string | null
  }
  evidenceProfileAfter: {
    masteryScore: number
    independentSuccesses: number
    hasTransfer: boolean
    hasDelayedRecall: boolean
  }
  virtualTimeMs: number
}

// ─── Resultado de un run completo ───────────────────────────────
export type RunOutcome =
  | 'program_complete'
  | 'session_complete_program_pending'
  | 'valid_incomplete'
  | 'invalid_false_mastery'
  | 'invalid_loop'
  | 'invalid_restore_divergence'
  | 'invalid_invariant'

export interface SimulationRunResult {
  seed: number
  profileId: StudentProfileId
  programId: string
  sessionCount: number
  totalTurns: number
  outcome: RunOutcome
  // Métricas
  masteredMicros: number
  totalMicros: number
  masteryPercent: number
  virtualDurationMs: number
  virtualDays: number
  // Fallos
  invariantFailures: SimulationInvariantFailure[]
  // Historia completa (para replay)
  turns: SimulationTurn[]
  // Estado final para diagnóstico
  finalMicroResolutions: Record<string, string>
  // Trueknowledge promedio al finalizar
  avgTrueKnowledgeAtEnd: number
  // Falso positivo: engine dice mastered pero trueKnowledge < 0.5
  falseMasteryCount: number
  latentFalsePositiveCount: number
  // Falso negativo: engine NO dice mastered pero trueKnowledge >= 0.8
  falseMissCount: number
  // Estrategias usadas
  strategiesUsed: string[]
  // Cambio de estrategia tras fallos
  strategyChangedAfterFail: boolean
  strategyChangeOpportunities: number
  strategyChangesAfterRepeatedFailure: number
  repairAttempts: number
  repairResolutions: number
  // Restore points completados
  restorePointsChecked: number
  restoreDivergences: number
  maxTurnsOnSingleMicro: number
  maxConsecutiveTeachingTurns: number
  prematureFuseCount: number
  unresolvedMicros: number
  requiredCoveragePercent: number
  retainedMasteredMicros: number
  evidenceDiversitySatisfiedMicros: number
  independentSuccesses: number
  maxAssistanceLevelUsed: AssistanceLevel
  activityChangesAfterCorrect: number
  activityChangeOpportunitiesAfterCorrect: number
  activityChangesAfterIncorrect: number
  activityChangeOpportunitiesAfterIncorrect: number
  programClosureWithoutEngineConfirmation: number
}

// ─── Fallo de invariante ─────────────────────────────────────────
export interface SimulationInvariantFailure {
  invariantId: string
  description: string
  seed: number
  profileId: StudentProfileId
  programId: string
  sessionIndex: number
  turnIndex: number
  snapshot: Record<string, unknown>
  replayCommand: string
}

// ─── Reporte agregado ────────────────────────────────────────────
export interface SimulationReport {
  generatedAt: number
  totalRuns: number
  deterministicRuns: number
  stochasticRuns: number
  // Outcomes
  programComplete: number
  sessionCompleteOnly: number
  validIncomplete: number
  invariantFailures: number
  loopFailures: number
  restoreDivergences: number
  falseMasteryCases: number
  // Métricas pedagógicas
  avgSessionsToMastery: Record<StudentProfileId, number>
  avgTurnsPerMicro: number
  maxTurnsPerMicro: number
  maxConsecutiveTeachingTurns: number
  repeatedQuestionIds: number | null
  repeatedFactKeys: number | null
  repeatedNormalizedPrompts: number | null
  evidenceDiversityRate: number
  prematureFuseCount: number
  unresolvedMicros: number
  requiredCoverageForCompletedPrograms: number
  retainedMasteryRate: number
  programClosureWithoutEngineConfirmation: number
  independentSuccesses: number
  activityChangeAfterCorrectRate: number
  activityChangeAfterIncorrectRate: number
  avgVirtualDurationMs: number
  masteryCalibration: {
    falsePositiveRate: number   // engine:mastered pero trueKnowledge < 0.5
    falseNegativeRate: number   // engine:not-mastered pero trueKnowledge >= 0.8
  }
  repairSuccessRate: number
  strategyChangeRate: number
  segments: Record<StudentProfileSegment, SegmentMetrics>
  profiles: Partial<Record<StudentProfileId, SegmentMetrics>>
  activityFormatDistribution: Record<string, number>
  assistanceDistribution: Record<AssistanceLevel, number>
  sessionCloseReasons: Record<string, number>
  // Seeds con fallos (para regresión)
  failureSeeds: Array<{
    seed: number
    profileId: StudentProfileId
    programId: string
    invariantId: string
  }>
}

// ─── Configuración de simulación ────────────────────────────────
export interface SimulationConfig {
  seed: number
  profileId: StudentProfileId
  programId: string
  maxTurnsPerSession: number
  maxSessionsPerProgram: number
  maxTotalTurns: number
  targetMinutes: number
  enableRestorePoints: boolean
  restorePointProbability: number   // probabilidad de hacer restore en cada turno
  virtualTimeAccelerationFactor: number  // 1 = tiempo real, 3600 = 1s = 1h
  enableDropout: boolean
  dropoutReturnAfterVirtualHours: number
}

export const DEFAULT_CONFIG: Omit<SimulationConfig, 'seed' | 'profileId' | 'programId'> = {
  maxTurnsPerSession: 40,
  maxSessionsPerProgram: 15,
  maxTotalTurns: 300,
  targetMinutes: 20,
  enableRestorePoints: true,
  restorePointProbability: 0.05,
  virtualTimeAccelerationFactor: 3600,
  enableDropout: true,
  dropoutReturnAfterVirtualHours: 24,
}
