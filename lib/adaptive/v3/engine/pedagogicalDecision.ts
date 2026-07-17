// ═══════════════════════════════════════════════════════════════
// PEDAGOGICAL DECISION ENGINE
//
// Centraliza las reglas de decisión pedagógica basadas en
// evidencia real de Fases 1-4. No duplica fuentes de verdad:
// lee desde EvidenceProfile y devuelve razones estructuradas.
//
// Fuente canónica:
//   - EvidenceProfile (evidenceEngine.ts)
//   - AssistanceLevel (confidenceTracker.ts)
//   - MasteryContract (masteryContracts.ts)
// ═══════════════════════════════════════════════════════════════

import type { EvidenceProfile } from './evidenceEngine'
import type { AssistanceLevel } from './confidenceTracker'
import {
  ASSISTANCE_LEVEL_ORDER,
} from './confidenceTracker'
import {
  analyzeResponseTime,
} from './confidenceTracker'

// ═══════════════════════════════════════════════════════════════
// RAZONES ESTRUCTURADAS — para tests y debugging
// ═══════════════════════════════════════════════════════════════
export type PedagogicalReason =
  | 'insufficient_independent_evidence'
  | 'high_confidence_error'            // error con selfReportedConfidence >= 70
  | 'low_confidence_error'             // error con confianza baja o desconocida
  | 'assistance_too_high'              // maxAssistanceLevelUsed > contrato
  | 'revealed_no_mastery'              // el único acierto fue revealed
  | 'needs_delayed_recall'
  | 'needs_transfer'
  | 'needs_integration'
  | 'ready_for_transfer'
  | 'ready_for_integration'
  | 'mastery_confirmed'
  | 'recent_regression'
  | 'response_too_slow'
  | 'knowledge_illusion_detected'
  | 'assisted_only_evidence'           // todos los éxitos fueron assisted o revealed
  | 'single_success_not_enough'
  | 'needs_more_independent_practice'
  | 'ok_to_advance'
  | 'legacy_evidence_discounted'
  | 'interleaving_without_delay'
  | 'insufficient_delay_for_recall'
  | 'delayed_recall_confirmed'
  | 'assistance_resolved_to_higher_level'
  | 'assistance_from_previous_activity_ignored'
  | 'legacy_timestamp_unknown'

// ═══════════════════════════════════════════════════════════════
// RESULTADO DE DIAGNÓSTICO PEDAGÓGICO
// ═══════════════════════════════════════════════════════════════
export interface PedagogicalDiagnosis {
  // ¿Puede avanzar al siguiente micro?
  canAdvance: boolean
  // ¿Hay señal de ilusión de conocimiento?
  hasKnowledgeIllusion: boolean
  // ¿El dominio es solo superficial (assisted/revealed)?
  isFalseMastery: boolean
  // ¿Necesita demostración independiente urgente?
  needsIndependentDemo: boolean
  // ¿La respuesta fue extremadamente lenta?
  wasVerySlowResponse: boolean
  // ¿Fue un reintento después de ver la respuesta?
  wasPostRevealRetry: boolean
  // Nivel real de independencia del perfil
  independenceLevel: 'none' | 'low' | 'medium' | 'high'
  // Razones estructuradas
  reasons: PedagogicalReason[]
  // Acción sugerida (usa nombres canónicos del motor existente)
  suggestedAction:
    | 'consolidate'
    | 'verify_independent'
    | 'reconstruct_from_error'
    | 'address_misconception'
    | 'simplify_to_core'
    | 'illustrate_with_worked_example'
    | 'test_transfer'
    | 'connect_to_previous'
    | 'spaced_recall'
    | 'reveal_answer'
    | 'verify_understanding'
    | 'continue_practice'
}

// ═══════════════════════════════════════════════════════════════
// UMBRALES — explícitos y documentados
// ═══════════════════════════════════════════════════════════════

/** Confianza autorreportada >= este valor = "alta confianza" */
export const HIGH_CONFIDENCE_THRESHOLD = 70

/** Confianza autorreportada <= este valor = "baja confianza" */
export const LOW_CONFIDENCE_THRESHOLD = 30

/**
 * Multiplicador de peso para evidencias legacy sin assistanceLevel.
 * No se trata como evidencia fuerte para evitar inflar dominio.
 */
export const LEGACY_EVIDENCE_WEIGHT = 0.6

/**
 * Tiempo máximo razonable para considerar una respuesta "fluida".
 * Por encima de este umbral se registra como potencialmente lenta.
 * Solo aplica para formatos objetivos (MCQ, TF, fill_blank).
 * Fuente: analyzeResponseTime de confidenceTracker.ts
 */
export const SLOW_RESPONSE_THRESHOLD_MS: Record<string, number> = {
  multiple_choice: 30000,   // 30s
  true_false: 20000,        // 20s
  fill_blank: 45000,        // 45s
  matching: 60000,          // 60s
  ordering: 50000,          // 50s
  open_response: 120000,    // 2 min
  default: 60000,           // 1 min para el resto
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════

export function diagnosePedagogicalState(params: {
  profile: EvidenceProfile
  lastOutcome: 'correct' | 'partial' | 'incorrect' | null
  lastAssistanceLevel: AssistanceLevel
  selfReportedConfidence: number | undefined
  responseTimeMs: number | undefined
  formatUsed: string
  interactionContext: 'learning' | 'immediate_practice' | 'interleaving' | 'delayed_retrieval' | 'spaced_review' | undefined
  recentRevealedCount: number   // cuántos revealed hubo en las últimas N interacciones
}): PedagogicalDiagnosis {
  const {
    profile,
    lastOutcome,
    lastAssistanceLevel,
    selfReportedConfidence,
    responseTimeMs,
    formatUsed,
    interactionContext,
    recentRevealedCount,
  } = params

  const reasons: PedagogicalReason[] = []

  // ─── 1. Ilusión de conocimiento ──────────────────────────────
  // Definición estricta: error + alta confianza autorreportada real
  // NO se infiere desde el tipo de error solo
  const hasKnowledgeIllusion =
    lastOutcome === 'incorrect' &&
    typeof selfReportedConfidence === 'number' &&
    selfReportedConfidence >= HIGH_CONFIDENCE_THRESHOLD

  if (hasKnowledgeIllusion) {
    reasons.push('knowledge_illusion_detected')
    reasons.push('high_confidence_error')
  } else if (lastOutcome === 'incorrect') {
    reasons.push('low_confidence_error')
  }

  // ─── 2. Independencia real ───────────────────────────────────
  const totalEvidences = profile.totalEvidences
  const independentSuccesses = profile.independentSuccesses
  const maxAssistance = profile.maxAssistanceLevelUsed

  // Solo evidencias de éxito asistido o revelado sin ninguna independiente
  const onlyAssistedOrRevealed =
    totalEvidences > 0 &&
    independentSuccesses === 0 &&
    (ASSISTANCE_LEVEL_ORDER.indexOf(maxAssistance) >= ASSISTANCE_LEVEL_ORDER.indexOf('assisted'))

  if (onlyAssistedOrRevealed) {
    reasons.push('assisted_only_evidence')
  }

  // Revealed como única evidencia sin éxito independiente posterior
  const revealedNoMastery =
    lastAssistanceLevel === 'revealed' &&
    independentSuccesses === 0

  if (revealedNoMastery) {
    reasons.push('revealed_no_mastery')
  }

  // Insuficientes éxitos independientes para el perfil acumulado
  // Activa si hay al menos 1 evidencia y ningún éxito independiente
  if (independentSuccesses === 0 && totalEvidences >= 1) {
    reasons.push('insufficient_independent_evidence')
  } else if (independentSuccesses < 2 && totalEvidences >= 3) {
    reasons.push('insufficient_independent_evidence')
  }

  if (independentSuccesses === 1 && totalEvidences < 4) {
    reasons.push('single_success_not_enough')
  }

  // ─── 3. Nivel de asistencia excesivo ────────────────────────
  // Si el máximo nivel usado supera 'minimal_hint', el dominio es cuestionable
  const assistanceTooHigh =
    ASSISTANCE_LEVEL_ORDER.indexOf(maxAssistance) > ASSISTANCE_LEVEL_ORDER.indexOf('minimal_hint')

  if (assistanceTooHigh && independentSuccesses < 2) {
    reasons.push('assistance_too_high')
  }

  // ─── 4. Análisis de tiempo de respuesta ──────────────────────
  let wasVerySlowResponse = false
  if (typeof responseTimeMs === 'number' && lastOutcome === 'correct') {
    const threshold = SLOW_RESPONSE_THRESHOLD_MS[formatUsed] || SLOW_RESPONSE_THRESHOLD_MS.default
    wasVerySlowResponse = responseTimeMs > threshold
    if (wasVerySlowResponse) {
      reasons.push('response_too_slow')
    }
  }

  // ─── 5. Reintento post-reveal ────────────────────────────────
  const wasPostRevealRetry =
    lastAssistanceLevel === 'revealed' || recentRevealedCount > 0

  // ─── 6. Needs / legacy / delayed recall ─────────────────────
  // Legacy: si no hay ninguna evidencia con assistanceLevel explícito,
  // aplicar reason conservadora para debugging
  const hasLegacyEvidence = profile.evidences.some(e => e.assistanceLevel === undefined)
  if (hasLegacyEvidence) {
    reasons.push('legacy_evidence_discounted')
    // Si además no hay timestamps suficientes para delayed recall, marcarlo
    const hasUnknownLegacyTime = profile.evidences.some(e =>
      e.assistanceLevel === undefined &&
      e.interactionContext !== undefined &&
      e.interactionContext !== 'learning' &&
      e.interactionContext !== 'immediate_practice' &&
      typeof e.elapsedSinceLastExposureMs !== 'number'
    )
    if (hasUnknownLegacyTime) {
      reasons.push('legacy_timestamp_unknown')
    }
  }

  if (!profile.hasDelayedRecall && profile.masteryScore >= 40) {
    reasons.push('needs_delayed_recall')
    if (interactionContext === 'interleaving') {
      reasons.push('interleaving_without_delay')
    } else if (interactionContext === 'spaced_review' || interactionContext === 'delayed_retrieval') {
      reasons.push('insufficient_delay_for_recall')
    }
  } else if (profile.hasDelayedRecall) {
    reasons.push('delayed_recall_confirmed')
  }

  if (!profile.hasTransfer && profile.masteryScore >= 55) {
    reasons.push('needs_transfer')
  }
  if (!profile.hasIntegration && profile.masteryScore >= 50) {
    reasons.push('needs_integration')
  }

  // ─── 7. Señales positivas ────────────────────────────────────
  if (profile.hasTransfer && profile.independentSuccesses >= 2) {
    reasons.push('ready_for_transfer')
  }
  if (profile.hasIntegration && profile.independentSuccesses >= 2) {
    reasons.push('ready_for_integration')
  }

  // ─── 8. Nivel de independencia global del perfil ─────────────
  let independenceLevel: PedagogicalDiagnosis['independenceLevel'] = 'none'
  if (independentSuccesses >= 4) independenceLevel = 'high'
  else if (independentSuccesses >= 2) independenceLevel = 'medium'
  else if (independentSuccesses >= 1) independenceLevel = 'low'

  // ─── 9. ¿Puede avanzar? ──────────────────────────────────────
  // Condiciones para NO poder avanzar:
  const blockers = [
    // No puede avanzar si el único acierto fue revealed
    revealedNoMastery,
    // No puede avanzar si todos los éxitos fueron assisted/revealed sin demo independiente
    onlyAssistedOrRevealed,
    // No puede avanzar con ilusión de conocimiento activa
    hasKnowledgeIllusion,
    // No puede avanzar si no existe ninguna demostración independiente
    (independentSuccesses === 0 && totalEvidences > 0),
    // No puede avanzar con solo 1 evidencia independiente y pocas evidencias totales
    // (demasiado temprano para declarar dominio)
    (independentSuccesses === 1 && totalEvidences < 3),
  ]

  const canAdvance = blockers.every(b => !b)
  const isFalseMastery = onlyAssistedOrRevealed || (revealedNoMastery && totalEvidences > 0)
  const needsIndependentDemo = !canAdvance && (isFalseMastery || assistanceTooHigh)

  if (canAdvance && independentSuccesses >= 2) {
    reasons.push('ok_to_advance')
  }

  // ─── 10. Acción sugerida ─────────────────────────────────────
  let suggestedAction: PedagogicalDiagnosis['suggestedAction'] = 'continue_practice'

  if (hasKnowledgeIllusion) {
    suggestedAction = 'address_misconception'
  } else if (revealedNoMastery || onlyAssistedOrRevealed) {
    suggestedAction = 'verify_independent'
  } else if (assistanceTooHigh && independentSuccesses < 2) {
    suggestedAction = 'simplify_to_core'
  } else if (wasVerySlowResponse && lastOutcome === 'correct') {
    suggestedAction = 'continue_practice' // no penalizar, solo continuar
  } else if (interactionContext === 'spaced_review' && lastOutcome === 'correct' && lastAssistanceLevel === 'independent') {
    suggestedAction = 'consolidate'
  } else if (profile.masteryScore >= 60 && independentSuccesses >= 2 && !profile.hasTransfer) {
    suggestedAction = 'test_transfer'
  } else if (profile.masteryScore >= 50 && independentSuccesses >= 2 && !profile.hasIntegration) {
    suggestedAction = 'connect_to_previous'
  } else if (canAdvance && profile.masteryScore >= 40) {
    suggestedAction = 'consolidate'
  } else if (lastOutcome === 'incorrect') {
    suggestedAction = 'reconstruct_from_error'
  }

  return {
    canAdvance,
    hasKnowledgeIllusion,
    isFalseMastery,
    needsIndependentDemo,
    wasVerySlowResponse,
    wasPostRevealRetry,
    independenceLevel,
    reasons,
    suggestedAction,
  }
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR PRECEDENCIA DE ASSISTANCELEVEL
//
// La regla: conservar el MAYOR nivel de ayuda realmente recibido.
// Nunca heredar ayuda de una actividad anterior.
//
// Prioridad:
//   1. Valor del frontend (telemetría real de la actividad actual)
//   2. Valor inferido del route desde el objetivo del turno anterior
//      SOLO si el frontend no envió dato (undefined)
//   3. Default: 'independent'
//
// Restricción: el valor inferido del route no puede REDUCIR
// el nivel del frontend. Solo puede usarse como fallback.
// ═══════════════════════════════════════════════════════════════
function getHigherAssistanceLevel(
  a: AssistanceLevel,
  b: AssistanceLevel,
): AssistanceLevel {
  const idxA = ASSISTANCE_LEVEL_ORDER.indexOf(a)
  const idxB = ASSISTANCE_LEVEL_ORDER.indexOf(b)
  return idxA >= idxB ? a : b
}

export function resolveAssistanceLevel(
  frontendLevel: AssistanceLevel | undefined,
  routeInferredLevel: AssistanceLevel | undefined,
  options?: {
    sameActivity?: boolean
  },
): AssistanceLevel {
  const sameActivity = options?.sameActivity ?? false

  // Si ambas ayudas pertenecen al mismo intento/actividad:
  // conservar el MÁXIMO nivel de ayuda realmente recibido.
  if (sameActivity && frontendLevel !== undefined && routeInferredLevel !== undefined) {
    return getHigherAssistanceLevel(frontendLevel, routeInferredLevel)
  }

  // Si el frontend envió dato para una nueva actividad, gana él
  if (frontendLevel !== undefined) {
    return frontendLevel
  }

  // Si no hay dato del frontend, usar el inferido del route
  if (routeInferredLevel !== undefined) {
    return routeInferredLevel
  }

  // Fallback conservador
  return 'independent'
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR ILUSIÓN DE CONOCIMIENTO ESTRICTA
//
// Solo activa cuando el estudiante reportó confianza alta (>= 70)
// Y falló objetivamente.
// No se infiere de la severidad del error.
// ═══════════════════════════════════════════════════════════════
export function detectKnowledgeIllusion(params: {
  outcome: 'correct' | 'partial' | 'incorrect'
  selfReportedConfidence: number | undefined
  assistanceLevel: AssistanceLevel
}): boolean {
  // Solo cuenta como ilusión si:
  // 1. El resultado fue incorrecto
  // 2. El estudiante reportó confianza >= 70 explícitamente
  // 3. No fue una respuesta revelada (no puede haber ilusión en algo que no intentó)
  return (
    params.outcome === 'incorrect' &&
    typeof params.selfReportedConfidence === 'number' &&
    params.selfReportedConfidence >= HIGH_CONFIDENCE_THRESHOLD &&
    params.assistanceLevel !== 'revealed'
  )
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZAR PESO DE EVIDENCIA LEGACY
//
// Para evidencias sin assistanceLevel (sesiones antiguas):
// no tratar como evidencia fuerte para no inflar dominio.
// ═══════════════════════════════════════════════════════════════
export function getLegacyEvidenceWeight(evidence: {
  assistanceLevel?: AssistanceLevel
  outcome: string
}): number {
  if (evidence.assistanceLevel === undefined) {
    // Evidencia antigua: peso reducido conservador
    return LEGACY_EVIDENCE_WEIGHT
  }
  if (evidence.assistanceLevel === 'revealed') return 0
  if (evidence.assistanceLevel === 'assisted') return 0.3
  if (evidence.assistanceLevel === 'guided') return 0.5
  if (evidence.assistanceLevel === 'minimal_hint') return 0.8
  return 1.0 // independent
}
