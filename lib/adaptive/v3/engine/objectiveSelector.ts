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

export interface ObjectiveDecision {
  objective: TeachingObjective
  reason: string
  isFirstEncounter: boolean
  requiresQuestion: boolean
  requiresContent: boolean
  suggestedContentType: 'explanation' | 'example' | 'question' | 'feedback' | 'summary'
  forcedFormat?: string | null
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — Muy simple, muy limpia
// ═══════════════════════════════════════════════════════════════
export function selectObjective(
  microState: MicroState,
  microConcept: MicroConcept,
  sessionState: SessionState,
  initialKnowledgeLevel: string = 'some',
): ObjectiveDecision {
  const { evidence, timeline, totalInteractions } = microState

  // Contexto reciente
  const lastEvent = timeline[timeline.length - 1]
  const lastOutcome = lastEvent?.metadata?.outcome
  const consecutiveFails = countConsecutiveFromEnd(timeline, 'answered_incorrectly')

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

  // ═══════════════════════════════════════════════════════════
  // 2. ¿ACABA DE FALLAR? → Ayudar (no repetir)
  // ═══════════════════════════════════════════════════════════
  if (lastOutcome === 'incorrect') {
    // Tras muchos fallos consecutivos, cambiar de estrategia (ilustrar con ejemplo)
    // NUNCA avanzar sin haber acertado — un tutor sigue enseñando.
    if (consecutiveFails >= 4) {
      return {
        objective: 'illustrate_with_example',
        reason: `${consecutiveFails} fallos — cambiar estrategia con ejemplo concreto`,
        isFirstEncounter: false,
        requiresQuestion: false,
        requiresContent: true,
        suggestedContentType: 'example',
      }
    }
    // Revelar respuesta y reexplicar
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
  if (lastOutcome === 'partial' && consecutiveFails === 0) {
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

  // Ajustar patrón según nivel del estudiante:
  //   'zero'   → enseña 3 turnos (introduce + explain_deeper + example) antes de evaluar
  //   'some'   → enseña 2 turnos (introduce + example) antes de evaluar
  //   'good'   → salta directo a evaluar tras introduce (nivel avanzado)
  const isNovice = initialKnowledgeLevel === 'zero'
  const isIntermediate = initialKnowledgeLevel === 'some'

  // Después del primer contacto (introduce), profundizar SOLO si es novato
  if (isNovice && evidence.introduced && teachingEvents === 1 && questionEvents === 0) {
    return {
      objective: 'explain_deeper',
      reason: 'Estudiante nivel zero — profundizar antes de evaluar',
      isFirstEncounter: false,
      requiresQuestion: false,
      requiresContent: true,
      suggestedContentType: 'explanation',
    }
  }

  // Tras profundizar, mostrar ejemplo concreto (novato: tras 2 teach, intermedio: tras 1)
  const teachingBeforeExample = isNovice ? 2 : (isIntermediate ? 1 : 999)
  if (evidence.introduced && teachingEvents === teachingBeforeExample && questionEvents === 0) {
    return {
      objective: 'illustrate_with_example',
      reason: 'Consolidar con un ejemplo concreto antes de verificar',
      isFirstEncounter: false,
      requiresQuestion: false,
      requiresContent: true,
      suggestedContentType: 'example',
    }
  }

  // Cada 3 preguntas de evaluación, insertar re-enseñanza (variar entre teach/verify)
  // Solo si el estudiante ha estado acertando (no en fallos, ya hay reveal_answer arriba)
  if (questionEvents >= 3 && questionEvents % 3 === 0 && lastOutcome === 'correct') {
    const lastTeaching = timeline.slice().reverse().findIndex(e =>
      e.eventType === 'explained_by_tutor' || e.eventType === 'example_shown'
    )
    // Si hace muchas preguntas sin re-enseñanza, insertar conexión conceptual
    if (lastTeaching === -1 || lastTeaching >= 4) {
      return {
        objective: 'connect_to_previous',
        reason: 'Después de varias respuestas correctas, conectar con contexto más amplio',
        isFirstEncounter: false,
        requiresQuestion: false,
        requiresContent: true,
        suggestedContentType: 'explanation',
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. ¿YA SABE SUFICIENTE? → Avanzar
  // ═══════════════════════════════════════════════════════════
  // Consolidar SOLO si el estudiante DEMOSTRÓ aprendizaje real.
  // Nunca por número de interacciones — un tutor no salta sin evidencia.
  // Umbral base: 2 correctas mínimo (isReadyToAdvanceEvidence puede exigir más según dificultad)
  if (evidence.answeredCorrectly >= 2) {
    return {
      objective: 'consolidate',
      reason: `${evidence.answeredCorrectly} correctas — listo para consolidar`,
      isFirstEncounter: false,
      requiresQuestion: false,
      requiresContent: true,
      suggestedContentType: 'summary',
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 4. ENTRE MEDIO → Verificar comprensión
  //    El LLM decide HOW (formato, pregunta, estrategia)
  //    El motor solo dice "verifica"
  // ═══════════════════════════════════════════════════════════
  return {
    objective: 'verify_understanding',
    reason: 'Verificar comprensión — el LLM decide cómo',
    isFirstEncounter: false,
    requiresQuestion: true,
    requiresContent: true,    // También puede incluir contenido antes de la pregunta
    suggestedContentType: 'question',
    // NO forzar formato — dejar que el Content Generator decida
    // basándose en el tipo cognitivo, recursos, historial
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
function countConsecutiveFromEnd(events: any[], eventType: string): number {
  let count = 0
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].eventType === eventType) count++
    else break
  }
  return count
}
