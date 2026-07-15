// ═══════════════════════════════════════════════════════════════
// STUDENT MODEL
//
// Modelo cognitivo unificado del estudiante.
// Integra todos los motores en una sola fuente de verdad.
//
// Responde preguntas como:
// - ¿Qué sabe? (EvidenceProfile por micro)
// - ¿Qué cree incorrectamente? (Misconceptions)
// - ¿Qué hipótesis tiene el tutor? (LearningHypotheses)
// - ¿Cuándo olvidará? (MemoryStates)
// - ¿Qué tan confiable es su confianza? (ConfidenceProfile)
// - ¿Qué contrato de dominio debe cumplir? (MasteryContracts)
// - ¿Qué estrategias le funcionan? (StrategyEffectiveness)
// ═══════════════════════════════════════════════════════════════

import type { LearningHypothesis } from './hypothesisEngine'
import type { MemoryState } from './memoryEngine'
import type { Misconception } from './misconceptionTracker'
import type { ConfidenceProfile } from './confidenceTracker'
import type { EvidenceProfile } from './evidenceEngine'

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface StrategyEffectivenessRecord {
  strategyId: string
  microId: string
  usedAt: number
  outcomeAfter: 'improved' | 'unchanged' | 'worsened'
  evidenceGainedAfter: string[]   // tipos de evidencia ganados después
}

export interface LearnerProfile {
  // Identificación
  userId: string
  materialId: string
  // Preferencias observadas (no auto-reportadas)
  preferredRepresentations: string[]  // 'visual', 'analogy', 'narrative', 'formal'
  successfulStrategyIds: string[]     // estrategias que han funcionado
  failedStrategyIds: string[]         // estrategias que no han funcionado
  // Métricas de aprendizaje personales
  avgResponseTimeMs: number
  avgConfidenceReported: number
  avgActualScore: number
  independentSuccessRate: number      // % de éxitos sin ayuda
  // Patrones detectados
  tendencyToGuess: boolean
  hasKnowledgeIllusion: boolean
  isFastLearner: boolean              // domina micros con pocas interacciones
  needsMoreExamples: boolean          // aprende mejor con más ejemplos que definiciones
  prefersProcedural: boolean          // prefiere aprender haciendo sobre teoría
}

export interface StudentModel {
  userId: string
  materialId: string
  createdAt: number
  updatedAt: number

  // Evidencia multidimensional por micro
  evidenceProfiles: Record<string, EvidenceProfile>

  // Hipótesis activas del tutor
  hypotheses: LearningHypothesis[]

  // Estado de memoria (modelo de olvido)
  memoryStates: Record<string, MemoryState>

  // Misconceptions persistentes
  misconceptions: Misconception[]

  // Calibración de confianza
  confidenceProfile: ConfidenceProfile

  // Efectividad de estrategias aplicadas
  strategyEffectiveness: StrategyEffectivenessRecord[]

  // Perfil del aprendiz
  learnerProfile: LearnerProfile

  // Métricas globales del material
  totalMicrosStudied: number
  totalMicrosMastered: number
  materialCoveragePercent: number
  masteryPercent: number
  retentionPercent: number           // % con retrievability >= 0.9
  transferPercent: number            // % con evidencia de transferencia
}

// ═══════════════════════════════════════════════════════════════
// CREAR STUDENT MODEL INICIAL
// ═══════════════════════════════════════════════════════════════
export function createStudentModel(userId: string, materialId: string): StudentModel {
  const now = Date.now()
  return {
    userId,
    materialId,
    createdAt: now,
    updatedAt: now,
    evidenceProfiles: {},
    hypotheses: [],
    memoryStates: {},
    misconceptions: [],
    confidenceProfile: {
      records: [],
      calibrationStatus: 'unknown',
      calibrationBias: 0,
      avgSelfConfidence: 50,
      avgActualScore: 50,
      overconfidentCount: 0,
      underconfidentCount: 0,
      independentSuccesses: 0,
      assistedSuccesses: 0,
      independentRate: 0,
    },
    strategyEffectiveness: [],
    learnerProfile: {
      userId,
      materialId,
      preferredRepresentations: [],
      successfulStrategyIds: [],
      failedStrategyIds: [],
      avgResponseTimeMs: 0,
      avgConfidenceReported: 50,
      avgActualScore: 50,
      independentSuccessRate: 0,
      tendencyToGuess: false,
      hasKnowledgeIllusion: false,
      isFastLearner: false,
      needsMoreExamples: false,
      prefersProcedural: false,
    },
    totalMicrosStudied: 0,
    totalMicrosMastered: 0,
    materialCoveragePercent: 0,
    masteryPercent: 0,
    retentionPercent: 0,
    transferPercent: 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// OBTENER RESUMEN DIAGNÓSTICO DEL ESTUDIANTE
// Para que el tutor entienda el estado actual de un vistazo
// ═══════════════════════════════════════════════════════════════
export interface StudentDiagnostic {
  // Estado general
  overallStatus: 'learning' | 'progressing' | 'mastering' | 'struggling' | 'stalled'
  // Prioridades inmediatas
  urgentMicroIds: string[]           // Micros que necesitan atención ahora
  overdueReviewIds: string[]         // Micros que deberían repasar
  confirmedMisconceptions: Misconception[]
  confirmedHypotheses: LearningHypothesis[]
  // Oportunidades
  readyForTransfer: string[]         // Micros listos para transferencia
  readyForIntegration: string[]      // Micros listos para conectar
  // Alertas pedagógicas
  hasKnowledgeIllusion: boolean
  calibrationStatus: string
  independentSuccessRate: number
}

export function getStudentDiagnostic(model: StudentModel): StudentDiagnostic {
  const {
    hypotheses,
    misconceptions,
    memoryStates,
    evidenceProfiles,
    confidenceProfile,
    learnerProfile,
  } = model

  // Hipótesis confirmadas
  const confirmedHypotheses = hypotheses.filter(h => h.status === 'confirmed')

  // Misconceptions activas confirmadas
  const confirmedMisconceptions = misconceptions.filter(m =>
    ['confirmed', 'relapsed'].includes(m.status)
  )

  // Micros urgentes: misconception confirmada o hipótesis confirmada
  const urgentMicroIds = [
    ...confirmedHypotheses.flatMap(h => h.targetMicroIds),
    ...confirmedMisconceptions.flatMap(m => m.relatedMicroIds),
  ].filter((id, i, arr) => arr.indexOf(id) === i)

  // Micros que necesitan repaso por olvido
  const now = Date.now()
  const overdueReviewIds = Object.entries(memoryStates)
    .filter(([_, ms]) => now >= ms.nextReviewAt && ms.totalReviews > 0)
    .map(([id]) => id)

  // Micros listos para transferencia (applied pero no transferred)
  const readyForTransfer = Object.entries(evidenceProfiles)
    .filter(([_, ep]) => {
      const applied = (ep.strongCount.applied || 0) + (ep.mediumCount.applied || 0)
      const transferred = (ep.strongCount.transferred || 0) + (ep.mediumCount.transferred || 0)
      return applied >= 1 && transferred === 0
    })
    .map(([id]) => id)

  // Micros listos para integración (explained pero no connected)
  const readyForIntegration = Object.entries(evidenceProfiles)
    .filter(([_, ep]) => {
      const explained = (ep.strongCount.explained || 0) + (ep.mediumCount.explained || 0)
      const connected = (ep.strongCount.connected || 0) + (ep.mediumCount.connected || 0)
      return explained >= 1 && connected === 0
    })
    .map(([id]) => id)

  // Estado general
  let overallStatus: StudentDiagnostic['overallStatus'] = 'learning'
  if (confirmedMisconceptions.length > 0 || confirmedHypotheses.length >= 2) {
    overallStatus = 'struggling'
  } else if (model.masteryPercent >= 70) {
    overallStatus = 'mastering'
  } else if (model.materialCoveragePercent >= 50) {
    overallStatus = 'progressing'
  } else if (overdueReviewIds.length > 3 && model.materialCoveragePercent < 30) {
    overallStatus = 'stalled'
  }

  return {
    overallStatus,
    urgentMicroIds,
    overdueReviewIds,
    confirmedMisconceptions,
    confirmedHypotheses,
    readyForTransfer,
    readyForIntegration,
    hasKnowledgeIllusion: learnerProfile.hasKnowledgeIllusion,
    calibrationStatus: confidenceProfile.calibrationStatus,
    independentSuccessRate: learnerProfile.independentSuccessRate,
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR PERFIL DEL APRENDIZ basado en patrones observados
// ═══════════════════════════════════════════════════════════════
export function updateLearnerProfile(
  profile: LearnerProfile,
  observation: {
    strategyId: string
    outcome: 'improved' | 'unchanged' | 'worsened'
    responseTimeMs?: number
    selfConfidence?: number
    actualScore?: number
    wasIndependent?: boolean
  },
): LearnerProfile {
  const updated = { ...profile }

  // Registrar efectividad de estrategia
  if (observation.outcome === 'improved') {
    if (!updated.successfulStrategyIds.includes(observation.strategyId)) {
      updated.successfulStrategyIds = [...updated.successfulStrategyIds, observation.strategyId].slice(-20)
    }
  } else if (observation.outcome === 'worsened') {
    if (!updated.failedStrategyIds.includes(observation.strategyId)) {
      updated.failedStrategyIds = [...updated.failedStrategyIds, observation.strategyId].slice(-10)
    }
  }

  // Actualizar métricas promedio
  if (observation.responseTimeMs) {
    updated.avgResponseTimeMs = Math.round(
      (updated.avgResponseTimeMs * 0.9 + observation.responseTimeMs * 0.1)
    )
  }
  if (observation.selfConfidence !== undefined) {
    updated.avgConfidenceReported = Math.round(
      (updated.avgConfidenceReported * 0.9 + observation.selfConfidence * 0.1)
    )
  }
  if (observation.actualScore !== undefined) {
    updated.avgActualScore = Math.round(
      (updated.avgActualScore * 0.9 + observation.actualScore * 0.1)
    )
  }

  // Detectar patrones
  const confidenceDiff = updated.avgConfidenceReported - updated.avgActualScore
  updated.hasKnowledgeIllusion = confidenceDiff > 25

  updated.tendencyToGuess = updated.avgResponseTimeMs < 3000 && updated.avgActualScore < 55

  return updated
}
