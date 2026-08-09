// ═══════════════════════════════════════════════════════════════
// HYPOTHESIS ENGINE
//
// El tutor mantiene hipótesis sobre el estado cognitivo del estudiante.
// No convierte un solo error en verdad — acumula evidencia.
//
// Ciclo:
// 1. Error ocurre → generar hipótesis (confianza inicial baja)
// 2. Diseñar actividad para probar la hipótesis
// 3. Evaluar resultado → actualizar confianza
// 4. Si confianza >= 0.8 → hipótesis confirmada → intervención específica
// 5. Si confianza <= 0.15 → hipótesis rechazada → descartar
// ═══════════════════════════════════════════════════════════════

import type { ErrorType } from './answerEvaluator'
import type { EvidenceType } from './evidenceEngine'

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export type HypothesisType =
  | 'misconception'           // Creencia incorrecta específica
  | 'prerequisite_gap'        // Le falta un prerrequisito
  | 'memory_failure'          // Lo sabía pero lo olvidó
  | 'procedural_error'        // Entiende pero ejecuta mal el procedimiento
  | 'concept_confusion'       // Confunde dos conceptos similares
  | 'language_misread'        // Leyó mal o interpretó diferente
  | 'random_guess'            // Respondió sin razonar
  | 'overgeneralization'      // Aplica una regla correcta en contexto incorrecto
  | 'undergeneralization'     // No aplica una regla donde sí corresponde
  | 'inverted_relation'       // Tiene la relación al revés

export type HypothesisStatus =
  | 'suspected'   // Generada por 1 error, confianza baja
  | 'testing'     // Se diseñó actividad para probarla
  | 'confirmed'   // Confianza >= 0.80
  | 'rejected'    // Confianza <= 0.15
  | 'corrected'   // Estuvo confirmada, luego el estudiante demostró superarla
  | 'relapsed'    // Fue corregida pero volvió a aparecer

export interface LearningHypothesis {
  id: string
  type: HypothesisType
  // Qué cree el sistema que está pasando
  statement: string
  // Micros involucrados
  targetMicroIds: string[]
  // Tipo de error que la originó
  originatingErrorType: ErrorType | null
  // Tipo de evidencia que falta
  targetEvidenceType: EvidenceType | null
  // Confianza 0.0-1.0
  confidence: number
  // Evidencia que apoya o contradice
  supportingEvidenceIds: string[]   // IDs de interacciones que la confirman
  contradictingEvidenceIds: string[] // IDs de interacciones que la refutan
  // Estado
  status: HypothesisStatus
  // Timestamps
  createdAt: number
  lastUpdatedAt: number
  confirmedAt?: number
  correctedAt?: number
  relapseCount: number
}

// ═══════════════════════════════════════════════════════════════
// GENERAR HIPÓTESIS desde un diagnóstico de error
// ═══════════════════════════════════════════════════════════════
export function generateHypothesis(params: {
  microId: string
  errorType: ErrorType
  hypothesis: string
  isLikelyMisconception: boolean
  interactionId: string
  targetEvidenceType?: EvidenceType | null
}): LearningHypothesis {
  const { microId, errorType, hypothesis, isLikelyMisconception, interactionId, targetEvidenceType } = params

  // Mapear tipo de error → tipo de hipótesis
  const errorToHypothesisType: Record<ErrorType, HypothesisType> = {
    confused_similar_concept: 'concept_confusion',
    inverted_relationship: 'inverted_relation',
    incomplete_understanding: 'prerequisite_gap',
    random_guess: 'random_guess',
    calculation_error: 'procedural_error',
    misread_question: 'language_misread',
    knowledge_gap: 'memory_failure',
    misconception: 'misconception',
  }

  // Confianza inicial según tipo de error
  const initialConfidence: Record<ErrorType, number> = {
    confused_similar_concept: 0.45,  // Necesita más evidencia
    inverted_relationship: 0.55,     // Bastante específico
    incomplete_understanding: 0.35,
    random_guess: 0.25,              // Puede ser casualidad
    calculation_error: 0.50,
    misread_question: 0.30,          // Difícil de distinguir de knowledge_gap
    knowledge_gap: 0.40,
    misconception: isLikelyMisconception ? 0.60 : 0.35,
  }

  return {
    id: `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: errorToHypothesisType[errorType] || 'misconception',
    statement: hypothesis,
    targetMicroIds: [microId],
    originatingErrorType: errorType,
    targetEvidenceType: targetEvidenceType || null,
    confidence: initialConfidence[errorType] || 0.35,
    supportingEvidenceIds: [interactionId],
    contradictingEvidenceIds: [],
    status: 'suspected',
    createdAt: Date.now(),
    lastUpdatedAt: Date.now(),
    relapseCount: 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR HIPÓTESIS según nueva evidencia
// ═══════════════════════════════════════════════════════════════
export function updateHypothesis(
  hypothesis: LearningHypothesis,
  params: {
    outcome: 'correct' | 'partial' | 'incorrect'
    interactionId: string
    isIndependent: boolean  // sin ayuda del tutor
    score: number
  },
): LearningHypothesis {
  const { outcome, interactionId, isIndependent, score } = params

  let newConfidence = hypothesis.confidence
  const supporting = [...hypothesis.supportingEvidenceIds]
  const contradicting = [...hypothesis.contradictingEvidenceIds]

  if (outcome === 'incorrect') {
    // Error confirma la hipótesis
    const gain = isIndependent ? 0.20 : 0.10
    newConfidence = Math.min(0.95, newConfidence + gain)
    supporting.push(interactionId)
  } else if (outcome === 'correct' && score >= 80) {
    // Éxito independiente la refuta fuertemente
    const loss = isIndependent ? 0.30 : 0.15
    newConfidence = Math.max(0.05, newConfidence - loss)
    contradicting.push(interactionId)
  } else if (outcome === 'partial') {
    // Evidencia mixta: ligera reducción
    newConfidence = Math.max(0.10, newConfidence - 0.08)
    contradicting.push(interactionId)
  }

  // Determinar nuevo estado
  let status = hypothesis.status
  if (newConfidence >= 0.80 && status !== 'confirmed') {
    status = 'confirmed'
  } else if (newConfidence <= 0.15 && status !== 'rejected') {
    status = 'rejected'
  } else if (newConfidence > 0.15 && hypothesis.status === 'confirmed' && outcome === 'correct' && score >= 80) {
    status = 'corrected'
  } else if (hypothesis.status === 'corrected' && outcome === 'incorrect') {
    status = 'relapsed'
  } else if (status === 'suspected' && supporting.length >= 2) {
    status = 'testing'
  }

  return {
    ...hypothesis,
    confidence: Math.round(newConfidence * 100) / 100,
    supportingEvidenceIds: supporting,
    contradictingEvidenceIds: contradicting,
    status,
    lastUpdatedAt: Date.now(),
    confirmedAt: status === 'confirmed' && !hypothesis.confirmedAt ? Date.now() : hypothesis.confirmedAt,
    correctedAt: status === 'corrected' ? Date.now() : hypothesis.correctedAt,
    relapseCount: status === 'relapsed' ? hypothesis.relapseCount + 1 : hypothesis.relapseCount,
  }
}

// ═══════════════════════════════════════════════════════════════
// SELECCIONAR LA HIPÓTESIS MÁS RELEVANTE AHORA
// ═══════════════════════════════════════════════════════════════
export function getMostRelevantHypothesis(
  hypotheses: LearningHypothesis[],
  currentMicroId: string,
): LearningHypothesis | null {
  // Solo considerar hipótesis activas (no rechazadas ni corregidas)
  const active = hypotheses.filter(h =>
    ['suspected', 'testing', 'confirmed', 'relapsed'].includes(h.status) &&
    h.targetMicroIds.includes(currentMicroId)
  )

  if (active.length === 0) return null

  // Priorizar: confirmadas > alta confianza > relapsadas > sospechadas
  const sorted = active.sort((a, b) => {
    const priority = (h: LearningHypothesis) => {
      if (h.status === 'confirmed') return 100
      if (h.status === 'relapsed') return 80
      if (h.status === 'testing') return 60
      return h.confidence * 50
    }
    return priority(b) - priority(a)
  })

  return sorted[0]
}

// ═══════════════════════════════════════════════════════════════
// DISEÑAR ACTIVIDAD PARA PROBAR UNA HIPÓTESIS
// ═══════════════════════════════════════════════════════════════
export function designDiagnosticActivity(
  hypothesis: LearningHypothesis,
): {
  targetObjective: string
  targetEvidenceType: EvidenceType | null
  forcedFormat: string | null
  diagnosticReason: string
} {
  // Para cada tipo de hipótesis, diseñar la actividad que mejor la prueba
  const activityMap: Record<HypothesisType, {
    targetObjective: string
    targetEvidenceType: EvidenceType | null
    forcedFormat: string | null
    diagnosticReason: string
  }> = {
    misconception: {
      targetObjective: 'address_misconception',
      targetEvidenceType: 'recognized',
      forcedFormat: 'true_false',
      diagnosticReason: 'Verificar si la creencia incorrecta persiste',
    },
    concept_confusion: {
      targetObjective: 'explain_with_contrast',
      targetEvidenceType: 'recognized',
      forcedFormat: 'multiple_choice',
      diagnosticReason: 'Forzar distinción entre los conceptos confundidos',
    },
    inverted_relation: {
      targetObjective: 'explain_effect_to_cause',
      targetEvidenceType: 'explained',
      forcedFormat: 'ordering',
      diagnosticReason: 'Verificar si el estudiante puede ordenar correctamente la relación',
    },
    prerequisite_gap: {
      targetObjective: 'activate_prior_knowledge',
      targetEvidenceType: 'recalled',
      forcedFormat: 'fill_blank',
      diagnosticReason: 'Identificar cuál prerrequisito está fallando',
    },
    memory_failure: {
      targetObjective: 'recall_check',
      targetEvidenceType: 'recalled',
      forcedFormat: 'fill_blank',
      diagnosticReason: 'Verificar si recuerda sin contexto',
    },
    procedural_error: {
      targetObjective: 'illustrate_with_worked_example',
      targetEvidenceType: 'applied',
      forcedFormat: 'ordering',
      diagnosticReason: 'Verificar si puede seguir el procedimiento paso a paso',
    },
    language_misread: {
      targetObjective: 'verify_with_socratic_question',
      targetEvidenceType: 'explained',
      forcedFormat: 'open_response',
      diagnosticReason: 'Verificar comprensión del enunciado reformulado',
    },
    random_guess: {
      targetObjective: 'introduce',
      targetEvidenceType: 'recognized',
      forcedFormat: null,
      diagnosticReason: 'El estudiante no había visto este concepto — reintroducir',
    },
    overgeneralization: {
      targetObjective: 'verify_with_error_detection',
      targetEvidenceType: 'applied',
      forcedFormat: 'find_the_error',
      diagnosticReason: 'Mostrar caso donde la regla NO aplica',
    },
    undergeneralization: {
      targetObjective: 'test_transfer',
      targetEvidenceType: 'transferred',
      forcedFormat: 'practical_case',
      diagnosticReason: 'Verificar si puede aplicar en un contexto diferente',
    },
  }

  return activityMap[hypothesis.type] || {
    targetObjective: 'reconstruct_from_error',
    targetEvidenceType: null,
    forcedFormat: null,
    diagnosticReason: 'Hipótesis genérica — reexplicar con ángulo diferente',
  }
}

// ═══════════════════════════════════════════════════════════════
// PERFIL DE HIPÓTESIS (resumen para el tutor)
// ═══════════════════════════════════════════════════════════════
export function getHypothesisSummary(hypotheses: LearningHypothesis[]): {
  confirmedCount: number
  suspectedCount: number
  rejectedCount: number
  correctedCount: number
  mostCritical: LearningHypothesis | null
  hasActiveMisconception: boolean
} {
  const confirmed = hypotheses.filter(h => h.status === 'confirmed')
  const suspected = hypotheses.filter(h => h.status === 'suspected' || h.status === 'testing')
  const rejected = hypotheses.filter(h => h.status === 'rejected')
  const corrected = hypotheses.filter(h => h.status === 'corrected')

  const mostCritical = [...confirmed, ...suspected].sort((a, b) => b.confidence - a.confidence)[0] || null

  const hasActiveMisconception = hypotheses.some(
    h => h.type === 'misconception' && ['confirmed', 'relapsed'].includes(h.status)
  )

  return {
    confirmedCount: confirmed.length,
    suspectedCount: suspected.length,
    rejectedCount: rejected.length,
    correctedCount: corrected.length,
    mostCritical,
    hasActiveMisconception,
  }
}
