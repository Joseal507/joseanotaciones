// ═══════════════════════════════════════════════════════════════
// OBJECTIVE SELECTOR v3 — Simple y limpio
// 
// Solo decide 3 cosas:
// 1. ¿Es nuevo? → introduce
// 2. ¿Acaba de fallar? → ayuda
// 3. ¿Ya sabe suficiente? → avanza
// 
// NO decide formatos. NO decide estrategias de enseñanza.
// Eso lo decide el LLM con el contexto completo.
// ═══════════════════════════════════════════════════════════════

import type {
  MicroState,
  MicroConcept,
  TeachingObjective,
  SessionState,
} from '../types'
import type { EvidenceProfile, EvidenceType } from './evidenceEngine'
import { emptyEvidenceProfile, suggestNextObjectiveFromEvidence, isMicroMastered } from './evidenceEngine'
import type { ErrorType } from './answerEvaluator'
import { selectBestStrategy } from './strategyRegistry'
import {
  diagnosePedagogicalState,
  detectKnowledgeIllusion,
  type PedagogicalReason,
} from './pedagogicalDecision'

export interface ObjectiveDecision {
  objective: TeachingObjective
  reason: string
  isFirstEncounter: boolean
  requiresQuestion: boolean
  requiresContent: boolean
  suggestedContentType: 'explanation' | 'example' | 'question' | 'feedback' | 'summary'
  forcedFormat?: string | null
  // Estrategia alternativa cuando el estudiante está atascado
  alternativeStrategy?: 'analogy' | 'simplify' | 'step_by_step' | 'worked_example' | 'different_angle' | null
  // Tipo de evidencia que está fallando repetidamente
  failingEvidenceType?: EvidenceType | null
  // ID de estrategia del registry seleccionada (si aplica)
  strategyId?: string | null
  // Plantilla de prompt de la estrategia seleccionada
  strategyPromptTemplate?: string | null
  // Razones estructuradas para tests y debugging
  reasons?: PedagogicalReason[]
  // Señal de ilusión de conocimiento detectada
  hasKnowledgeIllusion?: boolean
}

export function repairStrategyForFailure(failureNumber: number): 'simplify' | 'different_angle' | 'worked_example' {
  const strategies = ['simplify', 'different_angle', 'worked_example'] as const
  return strategies[Math.max(0, failureNumber - 1) % strategies.length]
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — Muy simple, muy limpia
// ═══════════════════════════════════════════════════════════════
export function selectObjective(
  microState: MicroState,
  microConcept: MicroConcept,
  sessionState: SessionState,
  initialKnowledgeLevel: string = 'some',
  evalPreference: string = 'mix_everything',
): ObjectiveDecision {
  const { evidence, timeline, totalInteractions } = microState

  // Contexto reciente
  const lastResponseIndex = timeline.findLastIndex(event =>
    event.eventType === 'answered_correctly' ||
    event.eventType === 'answered_partially' ||
    event.eventType === 'answered_incorrectly'
  )
  const lastResponseEvent = lastResponseIndex >= 0 ? timeline[lastResponseIndex] : undefined
  const lastOutcome = lastResponseEvent?.metadata?.outcome
  const interventionAfterLastResponse = lastResponseIndex >= 0 && timeline
    .slice(lastResponseIndex + 1)
    .some(event => event.eventType === 'explained_by_tutor' || event.eventType === 'example_shown')
  const consecutiveFails = countConsecutiveResponseFailures(timeline)

  // ─── DIAGNÓSTICO PEDAGÓGICO BASADO EN EVIDENCIA REAL ────────
  const evidenceProfile = microState.evidenceProfile
  const lastEvidence = evidenceProfile?.evidences?.[evidenceProfile.evidences.length - 1]
  const lastAssistanceLevel = lastEvidence?.assistanceLevel || 'independent'
  const lastSelfConfidence = lastEvidence?.selfReportedConfidence
  const lastResponseTimeMs = lastEvidence?.responseTimeMs
  const lastFormatUsed = lastEvidence?.formatUsed || 'multiple_choice'
  const lastInteractionContext = lastEvidence?.interactionContext

  // Contar cuántos revealed hubo en las últimas 3 evidencias
  const recentRevealedCount = (evidenceProfile?.evidences || [])
    .slice(-3)
    .filter(e => e.assistanceLevel === 'revealed').length

  const diagnosis = evidenceProfile ? diagnosePedagogicalState({
    profile: evidenceProfile,
    lastOutcome: lastOutcome as 'correct' | 'partial' | 'incorrect' | null,
    lastAssistanceLevel,
    selfReportedConfidence: lastSelfConfidence,
    responseTimeMs: lastResponseTimeMs,
    formatUsed: lastFormatUsed,
    interactionContext: lastInteractionContext,
    recentRevealedCount,
  }) : null

  const hasKnowledgeIllusion = diagnosis?.hasKnowledgeIllusion || false

  // ─── 0b. Si el micro ya cumple mastery contractual real, consolidar ───
  if (evidenceProfile && isMicroMastered(evidenceProfile, microConcept)) {
    return {
      objective: 'consolidate',
      reason: 'El micro ya cumple el contrato de dominio provisional',
      isFirstEncounter: false,
      requiresQuestion: false,
      requiresContent: true,
      suggestedContentType: 'summary',
      reasons: diagnosis?.reasons,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 0. ILUSIÓN DE CONOCIMIENTO — máxima prioridad pedagógica
  //    Si detectamos error con alta confianza, intervenir primero.
  // ═══════════════════════════════════════════════════════════
  if (hasKnowledgeIllusion && evidence.introduced && lastOutcome === 'incorrect' && !interventionAfterLastResponse) {
    return {
      objective: 'address_misconception',
      reason: 'Error con alta confianza autorreportada — ilusión de conocimiento detectada',
      isFirstEncounter: false,
      requiresQuestion: false,
      requiresContent: true,
      suggestedContentType: 'explanation',
      hasKnowledgeIllusion: true,
      reasons: diagnosis?.reasons || ['knowledge_illusion_detected', 'high_confidence_error'],
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 1. ¿NUEVO? → Introducir
  // ═══════════════════════════════════════════════════════════
  if (!evidence.introduced) {
    return {
      objective: 'introduce',
      reason: 'Primera vez con este microconcepto',
      isFirstEncounter: true,
      requiresQuestion: false,
      requiresContent: true,
      suggestedContentType: 'explanation',
    }
  }

  const consecutiveTeachingTurns = countConsecutiveSessionTeachingTurns(sessionState)
  if (consecutiveTeachingTurns >= 2) {
    const nextFromEvidence = suggestNextObjectiveFromEvidence(
      evidenceProfile || emptyEvidenceProfile(microConcept.id),
      microConcept,
    )
    return {
      objective: nextFromEvidence.objective as TeachingObjective,
      reason: 'Máximo de dos enseñanzas consecutivas alcanzado — solicitar evidencia',
      isFirstEncounter: false,
      requiresQuestion: true,
      requiresContent: false,
      suggestedContentType: 'question',
      forcedFormat: nextFromEvidence.forcedFormat || null,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 2. ¿ACABA DE FALLAR? → Estrategia alternativa según tipo de evidencia
  // ═══════════════════════════════════════════════════════════
  if (lastOutcome === 'incorrect' && !interventionAfterLastResponse) {
    // Detectar qué tipo de evidencia está fallando repetidamente
    const evidenceProfile = microState.evidenceProfile
    const incorrectByType = evidenceProfile?.incorrectCountByType
    const failingType: EvidenceType | null = incorrectByType
      ? (Object.entries(incorrectByType)
          .filter(([_, count]) => (count as number) >= 2)
          .sort(([_a, a], [_b, b]) => (b as number) - (a as number))[0]?.[0] as EvidenceType || null)
      : null

    // Tras 3+ fallos consecutivos: cambiar completamente de estrategia según qué falla
    if (consecutiveFails >= 3) {
      // Estrategia específica por tipo de evidencia que falla:
      // recognized → analogía (el concepto no está siendo reconocido)
      // recalled   → mnemotecnia o ejemplo muy concreto
      // explained  → simplificar — pedir explicación más básica
      // applied    → ejemplo resuelto paso a paso
      // connected  → mostrar conexión explícita
      const lastTurn = sessionState.recentTurns[sessionState.recentTurns.length - 1]
      const lastErrorType: ErrorType | null = (lastTurn?.content as any)?.errorDiagnosis?.errorType || null
      const isLikelyMisconception = (lastTurn?.content as any)?.errorDiagnosis?.isLikelyMisconception || false

      const errorToObjective: Partial<Record<ErrorType, TeachingObjective>> = {
        confused_similar_concept: 'explain_with_contrast',
        inverted_relationship: 'explain_effect_to_cause',
        incomplete_understanding: 'simplify_to_core',
        random_guess: 'explain_with_analogy',
        calculation_error: 'illustrate_with_worked_example',
        misread_question: 'verify_with_socratic_question',
        knowledge_gap: 'explain_with_analogy',
        misconception: 'address_misconception',
      }

      const evidenceToObjective: Partial<Record<EvidenceType, TeachingObjective>> = {
        recognized: 'explain_with_analogy',
        recalled: 'teach_mnemonic',
        explained: 'guided_reconstruction',
        applied: 'illustrate_with_worked_example',
        connected: 'connect_to_previous',
        transferred: 'test_boundary',
      }

      const chosenObjective: TeachingObjective =
        (lastErrorType && errorToObjective[lastErrorType]) ||
        (failingType && evidenceToObjective[failingType as EvidenceType]) ||
        (isLikelyMisconception ? 'address_misconception' : 'reconstruct_from_error')

      const evidenceStrategy =
        failingType === 'recognized' ? 'analogy' :
        failingType === 'recalled' ? 'simplify' :
        failingType === 'explained' ? 'different_angle' :
        failingType === 'applied' ? 'worked_example' :
        failingType === 'connected' ? 'step_by_step' :
        lastErrorType === 'confused_similar_concept' ? 'different_angle' :
        lastErrorType === 'inverted_relationship' ? 'different_angle' :
        lastErrorType === 'misconception' ? 'different_angle' :
        'analogy'
      const alternativeStrategy = consecutiveFails >= 3
        ? repairStrategyForFailure(consecutiveFails)
        : evidenceStrategy

      // Consultar el Strategy Registry para enriquecer la decisión
      const registryStrategy = selectBestStrategy({
        errorType: lastErrorType || undefined,
        evidenceGap: failingType as EvidenceType || undefined,
        cognitiveType: microConcept.cognitiveType,
        masteryScore: microState.evidenceProfile?.masteryScore || 0,
        consecutiveFails,
        preferFamily: 'repair',
      })

      return {
        objective: chosenObjective,
        reason: `${consecutiveFails} fallos en '${failingType || lastErrorType || 'concepto'}' → ${chosenObjective}`,
        isFirstEncounter: false,
        requiresQuestion: false,
        requiresContent: true,
        suggestedContentType: 'example',
        alternativeStrategy,
        failingEvidenceType: failingType,
        strategyId: registryStrategy?.id || null,
        strategyPromptTemplate: registryStrategy?.promptTemplate || null,
      }
    }
    if (consecutiveFails === 2) {
      return {
        objective: 'reconstruct_from_error',
        reason: 'Segundo fallo — cambiar de ángulo antes de volver a evaluar',
        isFirstEncounter: false,
        requiresQuestion: false,
        requiresContent: true,
        suggestedContentType: 'example',
        alternativeStrategy: repairStrategyForFailure(2),
      }
    }
    // Primer fallo: revelar respuesta y reexplicar inmediatamente
    return {
      objective: 'reveal_answer',
      reason: 'Fallo reciente — mostrar la respuesta y reexplicar',
      isFirstEncounter: false,
      requiresQuestion: false,
      requiresContent: true,
      suggestedContentType: 'feedback',
    }
  }

  // Parcial: bajar dificultad
  if (lastOutcome === 'partial' && consecutiveFails === 0 && !interventionAfterLastResponse) {
    const recentPartials = timeline.slice(-3).filter(e => e.metadata?.outcome === 'partial').length
    if (recentPartials >= 2) {
      return {
        objective: 'illustrate_with_example',
        reason: 'Múltiples parciales — simplificar con ejemplo',
        isFirstEncounter: false,
        requiresQuestion: false,
        requiresContent: true,
        suggestedContentType: 'example',
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 2b. PATRÓN PEDAGÓGICO — Enseñar más antes de evaluar
  //    Tras introducir, no salta directo a evaluar.
  //    Enseña, profundiza, ejemplifica → LUEGO verifica.
  // ═══════════════════════════════════════════════════════════
  const teachingEvents = timeline.filter(e =>
    e.eventType === 'introduced' || e.eventType === 'explained_by_tutor' || e.eventType === 'example_shown'
  ).length
  const questionEvents = timeline.filter(e =>
    e.eventType === 'answered_correctly' || e.eventType === 'answered_incorrectly' || e.eventType === 'answered_partially'
  ).length

  // Una introducción breve debe ir seguida de evidencia. Profundizar o mostrar
  // otro ejemplo se reserva para una respuesta parcial/incorrecta observada.
  if (
    (initialKnowledgeLevel === 'zero' || initialKnowledgeLevel === 'some') &&
    evidence.introduced && teachingEvents === 1 && questionEvents === 0
  ) {
    return {
      objective: 'illustrate_with_example',
      reason: 'Un único ejemplo breve antes de solicitar evidencia',
      isFirstEncounter: false,
      requiresQuestion: false,
      requiresContent: true,
      suggestedContentType: 'example',
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. ¿YA SABE SUFICIENTE? → Avanzar
  // El umbral depende del evalPreference del estudiante:
  //
  // QUICK_TEST: evaluación objetiva rigurosa
  //   → Necesita 3 respuestas correctas de FORMATOS DISTINTOS
  //   → Al menos 1 fill_blank (recall sin banco) o matching
  //   → Garantiza que no fue azar (MCQ sola no basta)
  //
  // WRITE_EXPLAIN: demostración profunda
  //   → Necesita 1 teach_back o open_response correcto
  //   → + al menos 1 MCQ/TF de verificación base
  //   → El teach_back es el cierre obligatorio antes de consolidar
  //
  // MIX_EVERYTHING: el sistema elige según tipo cognitivo
  //   → Necesita 2 correctas variadas + 1 de recall o explicación
  //   → Para tipos mathematical/procedural: fill_blank obligatorio
  //   → Para tipos conceptual/causal: explain_why o teach_back
  // ═══════════════════════════════════════════════════════════

  // Analizar qué tipos de formatos ya se usaron
  const formatsUsed = timeline
    .filter(e => (e.metadata as any)?.formatUsed)
    .map(e => (e.metadata as any)?.formatUsed as string)
  const hasRecallFormat = formatsUsed.some(f =>
    ['fill_blank', 'open_response', 'teach_back', 'explain_why', 'step_by_step_solver'].includes(f)
  )
  const hasExplainFormat = formatsUsed.some(f =>
    ['open_response', 'teach_back', 'explain_why'].includes(f)
  )
  const distinctFormats = new Set(formatsUsed.filter(Boolean)).size

  if (evalPreference === 'quick_test') {
    // QUICK_TEST: 3 correctas con al menos 1 formato de recall
    // fill_blank sin banco, matching, ordering — no solo MCQ
    const needsRecall = !hasRecallFormat && evidence.answeredCorrectly >= 2
    if (needsRecall) {
      return {
        objective: 'verify_understanding',
        reason: 'quick_test requiere al menos 1 formato de recall antes de consolidar',
        isFirstEncounter: false,
        requiresQuestion: true,
        requiresContent: false,
        suggestedContentType: 'question',
        forcedFormat: 'fill_blank',
      }
    }
    // El cierre se decide únicamente por isMicroMastered al inicio.

  } else if (evalPreference === 'write_explain') {
    // WRITE_EXPLAIN: necesita teach_back o open_response correcto
    // El teach_back es el cierre obligatorio
    const needsTeachBack = !hasExplainFormat && evidence.answeredCorrectly >= 1
    if (needsTeachBack) {
      return {
        objective: 'verify_understanding',
        reason: 'write_explain requiere que el estudiante explique con sus palabras',
        isFirstEncounter: false,
        requiresQuestion: true,
        requiresContent: false,
        suggestedContentType: 'question',
        forcedFormat: 'teach_back',
      }
    }
    // El cierre se decide únicamente por isMicroMastered al inicio.

  } else {
    // MIX_EVERYTHING: 2 correctas variadas + 1 recall o explicación
    const needsDepth = !hasRecallFormat && evidence.answeredCorrectly >= 2
    if (needsDepth) {
      // Para tipos matemáticos/procedurales: fill_blank de fórmula
      // Para tipos conceptuales/causales: explain_why
      const depthFormat = ['mathematical', 'procedural'].includes(microConcept.cognitiveType)
        ? 'fill_blank'
        : ['conceptual', 'causal', 'analytical'].includes(microConcept.cognitiveType)
        ? 'explain_why'
        : 'fill_blank'
      return {
        objective: 'verify_understanding',
        reason: `mix_everything: necesita profundidad (${depthFormat}) antes de consolidar`,
        isFirstEncounter: false,
        requiresQuestion: true,
        requiresContent: false,
        suggestedContentType: 'question',
        forcedFormat: depthFormat,
      }
    }
    // El cierre se decide únicamente por isMicroMastered al inicio.
  }

  // ═══════════════════════════════════════════════════════════
  // 4. ENTRE MEDIO → Verificar comprensión
  //    El LLM decide HOW (formato, pregunta, estrategia)
  //    El motor solo dice "verifica"
  // ═══════════════════════════════════════════════════════════
  // ─── FALLBACK GUIADO POR EVIDENCIA REAL ─────────────────────
  if (evidenceProfile) {
    const nextFromEvidence = suggestNextObjectiveFromEvidence(evidenceProfile, microConcept)

    if (nextFromEvidence.targetEvidence && nextFromEvidence.objective !== 'consolidate') {
      const questionObjectives = new Set([
        'verify_understanding',
        'test_application',
        'test_transfer',
        'recall_check',
      ])

      return {
        objective: nextFromEvidence.objective as TeachingObjective,
        reason: nextFromEvidence.reason,
        isFirstEncounter: false,
        requiresQuestion: !!nextFromEvidence.forcedFormat || questionObjectives.has(nextFromEvidence.objective),
        requiresContent: !nextFromEvidence.forcedFormat,
        suggestedContentType: !!nextFromEvidence.forcedFormat ? 'question' : 'explanation',
        forcedFormat: nextFromEvidence.forcedFormat || null,
      }
    }
  }

  return {
    objective: 'verify_understanding',
    reason: 'Verificar comprensión — el LLM decide cómo',
    isFirstEncounter: false,
    requiresQuestion: true,
    requiresContent: true,
    suggestedContentType: 'question',
    forcedFormat: null,
  }
}

// ═══════════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY
// ═══════════════════════════════════════════════════════════════
export function selectInteractionFormat(
  micro: MicroConcept,
  objective: TeachingObjective,
  sessionState: SessionState,
): string {
  return 'multiple_choice'
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function countConsecutiveResponseFailures(events: MicroState['timeline']): number {
  let count = 0
  for (let i = events.length - 1; i >= 0; i--) {
    const eventType = events[i].eventType
    if (eventType === 'answered_incorrectly') {
      count++
      continue
    }
    if (eventType === 'answered_correctly' || eventType === 'answered_partially') break
  }
  return count
}

function countConsecutiveSessionTeachingTurns(sessionState: SessionState): number {
  let count = 0
  for (let index = sessionState.recentTurns.length - 1; index >= 0; index--) {
    if (sessionState.recentTurns[index].content.type !== 'teaching') break
    count++
  }
  return count
}
