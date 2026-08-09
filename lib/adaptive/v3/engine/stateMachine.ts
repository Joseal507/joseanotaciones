// ═══════════════════════════════════════════════════════════════
// STATE MACHINE
// 
// Código puro. NO usa LLM.
// Maneja el estado de cada microconcepto durante la sesión.
// Actualiza timeline, evidencia, mastery level según eventos.
// ═══════════════════════════════════════════════════════════════

import type {
  MicroState,
  MicroTimelineEvent,
  MicroEventType,
  MasteryLevel,
  MicroConcept,
  KnowledgeGraph,
  SessionState,
  Turn,
  TeachingQueue,
} from '../types'
import { isMicroMastered, emptyEvidenceProfile } from './evidenceEngine'
import {
  calculateAssessmentCoverage,
  getUnresolvedObjectives,
  type AssessmentBlueprint,
} from '../../evaluation/assessmentBlueprint'

// Fusible: ningún micro puede tener más de este número de interacciones
// Si se supera, se marca como estudiado con mastery bajo y se avanza
export const MAX_INTERACTIONS_PER_MICRO = 6

// ═══════════════════════════════════════════════════════════════
// INICIALIZAR ESTADO DE UN MICRO
// ═══════════════════════════════════════════════════════════════
export function initMicroState(microId: string): MicroState {
  return {
    microId,
    timeline: [],
    evidence: {
      introduced: false,
      explainedByTutor: false,
      explainedByStudent: false,
      answeredCorrectly: 0,
      answeredIncorrectly: 0,
      applied: false,
      transferred: false,
      connected: false,
      recalled: false,
    },
    masteryLevel: 'unseen',
    isReady: false,
    needsReview: false,
    totalInteractions: 0,
    lastInteractionAt: null,
    timeSpentSeconds: 0,
    errorsCommitted: [],
    misunderstandings: [],
  }
}
// ═══════════════════════════════════════════════════════════════
// INICIALIZAR SESSION STATE COMPLETO
// ═══════════════════════════════════════════════════════════════
export function initSessionState(params: {
  sessionId: string
  userId: string
  materialId: string
  graph: KnowledgeGraph
  targetMinutes: number
  microIdsToTeach?: string[]  // Si no se pasa, usa todos los del grafo
  priorMastery?: Record<string, any>  // Mastery global de sesiones anteriores
}): SessionState {
  const now = Date.now()
  const microIds = params.microIdsToTeach || params.graph.microConcepts.map(m => m.id)

  // Inicializar estado de cada micro — inyectar mastery previo si existe
  const microStates: Record<string, MicroState> = {}
  for (const microId of microIds) {
    const prior = params.priorMastery?.[microId]
    // Solo aplicar memoria previa si el estudiante ya respondió correctamente
    // Si solo fue "introducido" pero sin aciertos reales → empezar de cero
    if (prior && prior.answeredCorrectly > 0) {
      // Este micro ya fue trabajado en sesiones anteriores — no empezar desde cero
      const base = initMicroState(microId)
      const microConcept = params.graph.microConcepts.find(m => m.id === microId)
      microStates[microId] = {
        ...base,
        masteryLevel: prior.masteryLevel || base.masteryLevel,
        // Readiness y fusible son locales a la sesión. La evidencia histórica
        // persiste abajo, pero una repair necesita un presupuesto real para actuar.
        isReady: false,
        totalInteractions: 0,
        evidenceProfile: prior.evidenceProfileSnapshot,
        // Guardar nombre real del micro para el mastery storage
        ...(microConcept ? { microName: microConcept.name } : {}),
        sourcePages: microConcept?.sourcePages || [],
        evidence: {
          ...base.evidence,
          introduced: prior.introduced || false,
          explainedByTutor: prior.explainedByTutor || false,
          applied: prior.applied || false,
          answeredCorrectly: prior.answeredCorrectly || 0,
          answeredIncorrectly: prior.answeredIncorrectly || 0,
        },
      }
    } else {
      const microConceptFresh = params.graph.microConcepts.find(m => m.id === microId)
      const freshState = initMicroState(microId)
      if (microConceptFresh) {
        freshState.microName = microConceptFresh.name
        ;freshState.sourcePages = microConceptFresh.sourcePages || []
      }
      microStates[microId] = freshState
    }
  }

  // Construir cola inicial usando topological sort
  const orderedIds = topologicalSortMicros(params.graph, microIds)

  return {
    sessionId: params.sessionId,
    userId: params.userId,
    materialId: params.materialId,
    startedAt: now,
    currentTurn: 0,
    totalTurnsCompleted: 0,
    elapsedSeconds: 0,
    targetMinutes: params.targetMinutes,
    microStates,
    queue: {
      sessionId: params.sessionId,
      pendingMicroIds: orderedIds,
      activeMicroId: null,
      completedMicroIds: [],
      postponedMicroIds: [],
      totalPlanned: orderedIds.length,
      createdAt: now,
    },
    recentTurns: [],
    totalCorrect: 0,
    totalIncorrect: 0,
    totalPartial: 0,
    consecutiveCorrect: 0,
    consecutiveIncorrect: 0,
    studentState: {
      energy: 'fresh',
      pace: 'medium',
      confidence: 'medium',
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// TOPOLOGICAL SORT — Ordenar micros respetando prerequisitos
// ═══════════════════════════════════════════════════════════════
export function topologicalSortMicros(graph: KnowledgeGraph, microIds: string[]): string[] {
  const microSet = new Set(microIds)
  const microMap = new Map(graph.microConcepts.map(m => [m.id, m]))
  const sorted: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(id: string) {
    if (visited.has(id) || visiting.has(id) || !microSet.has(id)) return
    visiting.add(id)
    const micro = microMap.get(id)
    if (!micro) { visiting.delete(id); return }

    // Visitar prerequisitos primero
    for (const prereqId of micro.prerequisites) {
      if (microSet.has(prereqId)) visit(prereqId)
    }

    visiting.delete(id)
    visited.add(id)
    sorted.push(id)
  }

  // Priorizar críticos primero
  const priorityOrder = [...microIds].sort((a, b) => {
    const ma = microMap.get(a)
    const mb = microMap.get(b)
    const impOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    const ai = ma ? impOrder[ma.importance] : 4
    const bi = mb ? impOrder[mb.importance] : 4
    if (ai !== bi) return ai - bi
    // Menos prerequisitos primero
    return (ma?.prerequisites.length || 0) - (mb?.prerequisites.length || 0)
  })

  for (const id of priorityOrder) visit(id)
  return sorted
}

// ═══════════════════════════════════════════════════════════════
// REGISTRAR EVENTO EN EL TIMELINE
// ═══════════════════════════════════════════════════════════════
export function recordEvent(
  microState: MicroState,
  event: MicroEventType,
  turnNumber: number,
  metadata: MicroTimelineEvent['metadata'] = {},
): MicroState {
  const timelineEvent: MicroTimelineEvent = {
    timestamp: Date.now(),
    turnNumber,
    eventType: event,
    metadata,
  }

  const updated: MicroState = {
    ...microState,
    timeline: [...microState.timeline, timelineEvent],
    totalInteractions: microState.totalInteractions + 1,
    lastInteractionAt: Date.now(),
  }

  // Actualizar evidencia según el evento
  updated.evidence = updateEvidence(updated.evidence, event, metadata)

  // Recalcular mastery level (código, no LLM)
  updated.masteryLevel = calculateMasteryLevel(updated.evidence, updated.timeline)

  // ¿Está listo para avanzar?
  updated.isReady = isReadyToAdvance(updated)

  // ¿Necesita review?
  updated.needsReview = needsReview(updated)

  return updated
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR EVIDENCIA SEGÚN EVENTO
// ═══════════════════════════════════════════════════════════════
function updateEvidence(
  evidence: MicroState['evidence'],
  event: MicroEventType,
  metadata: MicroTimelineEvent['metadata'],
): MicroState['evidence'] {
  const updated = { ...evidence }

  switch (event) {
    case 'introduced':
      updated.introduced = true
      break
    case 'explained_by_tutor':
      updated.explainedByTutor = true
      break
    case 'answered_correctly':
      updated.answeredCorrectly += 1
      break
    case 'answered_partially':
      // Cuenta parcial como medio correcto
      break
    case 'answered_incorrectly':
      updated.answeredIncorrectly += 1
      break
    case 'applied_to_case':
      updated.applied = true
      break
    case 'transferred_to_new_context':
      updated.transferred = true
      updated.applied = true
      break
    case 'connected_to_other_micro':
      updated.connected = true
      break
  }

  return updated
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR MASTERY LEVEL (código puro, determinista)
// ═══════════════════════════════════════════════════════════════
export function calculateMasteryLevel(
  evidence: MicroState['evidence'],
  timeline: MicroTimelineEvent[],
): MasteryLevel {
  // Sin evidencia
  if (!evidence.introduced) return 'unseen'

  // Detectar struggling: muchos errores seguidos
  const recentEvents = timeline.slice(-5)
  const recentIncorrect = recentEvents.filter(e => e.eventType === 'answered_incorrectly').length
  const recentCorrect = recentEvents.filter(e => e.eventType === 'answered_correctly').length

  if (evidence.answeredIncorrectly >= 3 && recentIncorrect >= 2 && recentCorrect === 0) {
    return 'struggling'
  }

  // Progresión positiva
  if (evidence.transferred) return 'mastered'
  if (evidence.connected && evidence.applied) return 'connected'
  if (evidence.applied) return 'applied'
  if (evidence.answeredCorrectly >= 2) return 'understood'
  if (evidence.answeredCorrectly === 1) return 'partially_understood'
  if (evidence.explainedByTutor && evidence.answeredIncorrectly === 0) return 'introduced'
  if (evidence.introduced) return 'introduced'

  return 'unseen'
}

// ═══════════════════════════════════════════════════════════════
// ¿ESTÁ LISTO PARA AVANZAR AL SIGUIENTE MICRO?
// ═══════════════════════════════════════════════════════════════
export function isReadyToAdvance(microState: MicroState): boolean {
  const { masteryLevel, evidence, totalInteractions } = microState

  // FUSIBLE: si superó el máximo de interacciones, avanzar siempre
  // Evita bucles infinitos. El micro queda marcado como 'struggling' para revisión posterior.
  // El sistema NO abandona el micro — lo añade a reinforcementMicroIds para sesión futura.
  if (totalInteractions >= MAX_INTERACTIONS_PER_MICRO) return true

  // Ya dominado
  if (masteryLevel === 'mastered' || masteryLevel === 'connected') return true

  // Aplicado exitosamente
  if (masteryLevel === 'applied' && evidence.answeredCorrectly >= 2) return true

  // Entendido con evidencia sólida
  if (masteryLevel === 'understood' && evidence.answeredCorrectly >= 2 && evidence.answeredIncorrectly <= 1) {
    return true
  }

  // REGLA CLAVE: NUNCA avanzar sin al menos 1 intento real (enseñanza + 1 interacción)
  if (evidence.answeredCorrectly === 0 && totalInteractions < 3) return false

  // Struggling: pasar si tuvo enseñanza + al menos 1 intento
  if (masteryLevel === 'struggling' && totalInteractions >= 4 && evidence.answeredCorrectly >= 1) return true

  // Si tuvo enseñanza y al menos 1 intento aunque no sea correcto, avanzar tras el fusible
  if (evidence.introduced && totalInteractions >= MAX_INTERACTIONS_PER_MICRO) return true

  return false
}

// ═══════════════════════════════════════════════════════════════
// ¿NECESITA REVIEW?
// ═══════════════════════════════════════════════════════════════
export function needsReview(microState: MicroState): boolean {
  const { evidence, lastInteractionAt } = microState

  if (!lastInteractionAt) return false

  // Si estuvo struggling, siempre necesita review
  if (microState.masteryLevel === 'struggling') return true

  // Si tiene errores acumulados sin corregir
  if (evidence.answeredIncorrectly > evidence.answeredCorrectly) return true

  return false
}

// ═══════════════════════════════════════════════════════════════
// SELECCIONAR SIGUIENTE MICRO DE LA COLA
// ═══════════════════════════════════════════════════════════════
export function selectNextMicro(sessionState: SessionState, graph: KnowledgeGraph): string | null {
  const { queue, microStates } = sessionState

  // Si hay uno activo y no está listo para avanzar, seguir con ese
  if (queue.activeMicroId) {
    const activeState = microStates[queue.activeMicroId]
    if (activeState && !activeState.isReady) {
      return queue.activeMicroId
    }
  }

  // Buscar siguiente en la cola pendiente
  for (const microId of queue.pendingMicroIds) {
    const microState = microStates[microId]
    if (!microState) continue

    // Verificar que sus prerequisitos estén satisfechos
    const micro = graph.microConcepts.find(m => m.id === microId)
    if (!micro) continue

    const prereqsSatisfied = micro.prerequisites.every(prereqId => {
      const prereqState = microStates[prereqId]
      if (!prereqState) return true // Si no está en la sesión, no bloquea
      return prereqState.isReady || prereqState.masteryLevel === 'mastered' ||
             prereqState.masteryLevel === 'applied' || prereqState.masteryLevel === 'understood'
    })

    if (prereqsSatisfied) return microId
  }

  // No hay más micros pendientes con prereqs satisfechos
  // Verificar postponed
  if (queue.postponedMicroIds.length > 0) {
    return queue.postponedMicroIds[0]
  }

  return null
}

// ═══════════════════════════════════════════════════════════════
// MARCAR MICRO COMO ATASCADO — necesita refuerzo posterior
// Se llama cuando el fusible dispara (MAX_INTERACTIONS alcanzado)
// El micro avanza pero queda en reinforcementMicroIds para revisión
// ═══════════════════════════════════════════════════════════════
export function markMicroAsNeedsReinforcement(
  sessionState: SessionState,
  microId: string,
): SessionState {
  const reinforcement: string[] = sessionState.reinforcementMicroIds || []
  if (!reinforcement.includes(microId)) {
    return {
      ...sessionState,
      reinforcementMicroIds: [...reinforcement, microId],
    }
  }
  return sessionState
}

// ═══════════════════════════════════════════════════════════════
// AVANZAR MICRO EN LA COLA
// ═══════════════════════════════════════════════════════════════
export function advanceMicro(sessionState: SessionState, completedMicroId: string): TeachingQueue {
  const queue = { ...sessionState.queue }

  // Sacar de pending
  queue.pendingMicroIds = queue.pendingMicroIds.filter(id => id !== completedMicroId)
  queue.postponedMicroIds = queue.postponedMicroIds.filter(id => id !== completedMicroId)

  // Agregar a completed si no está
  if (!queue.completedMicroIds.includes(completedMicroId)) {
    queue.completedMicroIds.push(completedMicroId)
  }

  queue.activeMicroId = null

  return queue
}

// ═══════════════════════════════════════════════════════════════
// POSPONER MICRO (cuando está struggling)
// ═══════════════════════════════════════════════════════════════
export function postponeMicro(sessionState: SessionState, microId: string): TeachingQueue {
  const queue = { ...sessionState.queue }

  queue.pendingMicroIds = queue.pendingMicroIds.filter(id => id !== microId)

  if (!queue.postponedMicroIds.includes(microId)) {
    queue.postponedMicroIds.push(microId)
  }

  queue.activeMicroId = null

  return queue
}

// ═══════════════════════════════════════════════════════════════
// REGISTRAR TURN EN LA SESIÓN
// ═══════════════════════════════════════════════════════════════
export function recordTurn(sessionState: SessionState, turn: Turn): SessionState {
  const updated = { ...sessionState }

  updated.currentTurn += 1
  updated.totalTurnsCompleted += 1
  updated.elapsedSeconds = Math.floor((Date.now() - sessionState.startedAt) / 1000)

  // Mantener solo los últimos 10 turns en memoria
  updated.recentTurns = [...sessionState.recentTurns, turn].slice(-10)

  // Actualizar contadores
  if (turn.studentResponse?.outcome === 'correct') {
    updated.totalCorrect += 1
    updated.consecutiveCorrect += 1
    updated.consecutiveIncorrect = 0
  } else if (turn.studentResponse?.outcome === 'incorrect') {
    updated.totalIncorrect += 1
    updated.consecutiveIncorrect += 1
    updated.consecutiveCorrect = 0
  } else if (turn.studentResponse?.outcome === 'partial') {
    updated.totalPartial += 1
    updated.consecutiveCorrect = 0
  }

  // Actualizar estado del estudiante
  updated.studentState = inferStudentState(updated)

  return updated
}

// ═══════════════════════════════════════════════════════════════
// INFERIR ESTADO DEL ESTUDIANTE (código puro)
// ═══════════════════════════════════════════════════════════════
export function inferStudentState(sessionState: SessionState): SessionState['studentState'] {
  const minutesElapsed = sessionState.elapsedSeconds / 60

  // Energía
  let energy: 'fresh' | 'engaged' | 'tired' | 'frustrated' = 'engaged'
  if (minutesElapsed < 3) energy = 'fresh'
  else if (minutesElapsed > 25) energy = 'tired'
  if (sessionState.consecutiveIncorrect >= 3) energy = 'frustrated'

  // Ritmo (basado en tiempo promedio por turno)
  const avgSecondsPerTurn = sessionState.totalTurnsCompleted > 0
    ? sessionState.elapsedSeconds / sessionState.totalTurnsCompleted
    : 30
  let pace: 'fast' | 'medium' | 'slow' = 'medium'
  if (avgSecondsPerTurn < 15) pace = 'fast'
  else if (avgSecondsPerTurn > 60) pace = 'slow'

  // Confianza (basada en tasa de aciertos)
  const totalAnswered = sessionState.totalCorrect + sessionState.totalIncorrect + sessionState.totalPartial
  const correctRate = totalAnswered > 0 ? sessionState.totalCorrect / totalAnswered : 0.5
  let confidence: 'high' | 'medium' | 'low' = 'medium'
  if (correctRate > 0.75) confidence = 'high'
  else if (correctRate < 0.4) confidence = 'low'

  return { energy, pace, confidence }
}

// ═══════════════════════════════════════════════════════════════
// ¿DEBERÍA CERRAR LA SESIÓN?
// ═══════════════════════════════════════════════════════════════
export function shouldCloseSession(sessionState: SessionState): boolean {
  // CIERRE REAL: todos los micros requeridos deben haber sido trabajados
  // (introducidos + practicados) y estar listos o haber alcanzado el fusible.
  const requiredMicroIds: string[] =
    sessionState.requiredMicroIds ??
    Array.from(new Set([
      ...sessionState.queue.pendingMicroIds,
      ...sessionState.queue.postponedMicroIds,
      ...sessionState.queue.completedMicroIds,
      ...(sessionState.queue.activeMicroId ? [sessionState.queue.activeMicroId] : []),
    ]))

  if (requiredMicroIds.length === 0) return false

  const allRequiredStudied = requiredMicroIds.every((microId: string) => {
    const st = sessionState.microStates[microId]
    if (!st) return false

    const taught = !!(st.evidence?.introduced || st.evidence?.explainedByTutor)
    const practiced = ((st.evidence?.answeredCorrectly || 0) + (st.evidence?.answeredIncorrectly || 0)) > 0
    const readyOrFused = !!st.isReady || st.totalInteractions >= MAX_INTERACTIONS_PER_MICRO

    return taught && practiced && readyOrFused
  })

  return allRequiredStudied
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR PROGRESO DE LA SESIÓN
// ═══════════════════════════════════════════════════════════════
export function calculateSessionProgress(sessionState: SessionState): {
  percent: number
  completed: number
  total: number
  currentMicro: string | null
} {
  const total = sessionState.queue.totalPlanned
  const completed = sessionState.queue.completedMicroIds.length
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  return {
    percent,
    completed,
    total,
    currentMicro: sessionState.queue.activeMicroId,
  }
}

// ═══════════════════════════════════════════════════════════════
// EVALUACIÓN DE FINALIZACIÓN DEL PROGRAMA
//
// sessionComplete: la sesión puede cerrar (micros procesados)
// programComplete: TODOS los micros DOMINADOS según evidencia real
//
// Son contratos INDEPENDIENTES. Una sesión completa con micros
// struggling NO finaliza el programa.
// ═══════════════════════════════════════════════════════════════

export type SessionCloseReason =
  | 'all_micros_processed'
  | 'budget_exhausted'
  | 'unresolved_micros_deferred'

export type MicroResolutionStatus =
  | 'mastered'
  | 'unresolved_fused'      // salió por fusible sin dominio
  | 'unresolved_struggling' // struggling persistente
  | 'in_progress'           // aún en la sesión
  | 'not_started'           // no se trabajó

export interface SessionCompletionResult {
  isSessionComplete: boolean
  closeReason: SessionCloseReason | null
  isProgramComplete: boolean
  // Micros que salieron de la sesión sin dominio real
  unresolvedMicroIds: string[]
  // Razones por micro
  microResolutions: Record<string, {
    status: MicroResolutionStatus
    reason: string
  }>
  // Métricas
  masteredCount: number
  totalRequired: number
  masteryPercent: number
  coveragePercent: number
  assessmentCoverageRatio?: number
  unresolvedObjectiveIds?: string[]
}

export function evaluateSessionCompletion(
  sessionState: SessionState,
  graph?: { microConcepts: MicroConcept[] } | null,
  assessment?: {
    blueprint: AssessmentBlueprint
    recoveryGroups?: Array<{ targets?: Array<{ status: string }> }>
  } | null,
): SessionCompletionResult {
  const requiredMicroIds: string[] =
    sessionState.requiredMicroIds ??
    Array.from(new Set([
      ...sessionState.queue.pendingMicroIds,
      ...sessionState.queue.postponedMicroIds,
      ...sessionState.queue.completedMicroIds,
      ...(sessionState.queue.activeMicroId ? [sessionState.queue.activeMicroId] : []),
    ]))

  const totalRequired = requiredMicroIds.length
  const microResolutions: Record<string, { status: MicroResolutionStatus; reason: string }> = {}
  const unresolvedMicroIds: string[] = []
  let masteredCount = 0
  let studiedCount = 0

  for (const microId of requiredMicroIds) {
    const st = sessionState.microStates[microId]

    if (!st) {
      microResolutions[microId] = { status: 'not_started', reason: 'micro not in session state' }
      continue
    }

    const taught = !!(st.evidence?.introduced || st.evidence?.explainedByTutor)
    const practiced = ((st.evidence?.answeredCorrectly || 0) + (st.evidence?.answeredIncorrectly || 0)) > 0
    if (taught && practiced) studiedCount++

    // ─── CRITERIO CANÓNICO DE DOMINIO ────────────────────────
    // Usa isMicroMastered() que internamente invoca checkMasteryContract
    // según el cognitiveType real del micro.
    // El fusible (MAX_INTERACTIONS) NUNCA produce dominio.
    const evidenceProfile = st.evidenceProfile || emptyEvidenceProfile(microId)
    const fused = st.totalInteractions >= MAX_INTERACTIONS_PER_MICRO

    // Obtener micro del grafo para cognitiveType real
    // Si no tenemos el grafo, usar fallback conservador (definitional)
    const microFromGraph = graph?.microConcepts?.find(m => m.id === microId)
    const microForContract: MicroConcept = microFromGraph || {
      id: microId,
      cognitiveType: 'definitional', // fallback conservador
      difficulty: 50,
      importance: 'medium',
      name: microId,
      shortDescription: '',
      fullDefinition: '',
      sourceQuotes: [],
      sourceChunkIds: [],
      sourcePages: [],
      examples: [],
      formulas: [],
      procedures: [],
      commonErrors: [],
      prerequisites: [],
      enables: [],
      related: [],
      extractedAt: 0,
      topicGroup: '',
      estimatedMinutes: 10,
    }

    const isDominatedByEvidence = isMicroMastered(evidenceProfile, microForContract)

    if (isDominatedByEvidence) {
      masteredCount++
      microResolutions[microId] = { status: 'mastered', reason: 'evidence-based mastery' }
    } else if (fused && !isDominatedByEvidence) {
      unresolvedMicroIds.push(microId)
      microResolutions[microId] = {
        status: st.masteryLevel === 'struggling' ? 'unresolved_struggling' : 'unresolved_fused',
        reason: 'max_interactions_reached_without_mastery',
      }
    } else if (taught && practiced && !isDominatedByEvidence) {
      unresolvedMicroIds.push(microId)
      microResolutions[microId] = {
        status: 'in_progress',
        reason: st.isReady ? 'ready_but_not_mastered' : 'still_working',
      }
    } else {
      microResolutions[microId] = { status: 'not_started', reason: 'not_yet_processed' }
    }
  }

  // Session complete: misma lógica que shouldCloseSession
  const assessmentCoverageRatio = assessment ? calculateAssessmentCoverage(assessment.blueprint) : undefined
  const unresolvedObjectiveIds = assessment
    ? getUnresolvedObjectives(assessment.blueprint).map(objective => objective.objectiveId)
    : []
  const activeRecoveryTargets = assessment?.recoveryGroups?.flatMap(group =>
    (group.targets || []).filter(target => target.status !== 'demonstrated'),
  ) || []
  const assessmentAllowsCompletion = !assessment ||
    (assessmentCoverageRatio === 1 && unresolvedObjectiveIds.length === 0 && activeRecoveryTargets.length === 0)
  const isSessionComplete = shouldCloseSession(sessionState) && assessmentAllowsCompletion

  // Program complete: TODOS los required micros dominados por evidencia real
  const isProgramComplete =
    totalRequired > 0 &&
    masteredCount === totalRequired &&
    unresolvedMicroIds.length === 0 &&
    assessmentAllowsCompletion

  const closeReason: SessionCloseReason | null = isSessionComplete
    ? (unresolvedMicroIds.length > 0 ? 'unresolved_micros_deferred' : 'all_micros_processed')
    : null

  const masteryPercent = totalRequired > 0
    ? Math.round((masteredCount / totalRequired) * 100)
    : 0

  const coveragePercent = totalRequired > 0
    ? Math.round((studiedCount / totalRequired) * 100)
    : 0

  return {
    isSessionComplete,
    closeReason,
    isProgramComplete,
    unresolvedMicroIds,
    microResolutions,
    masteredCount,
    totalRequired,
    masteryPercent,
    coveragePercent,
    ...(assessmentCoverageRatio !== undefined ? { assessmentCoverageRatio } : {}),
    ...(assessment ? { unresolvedObjectiveIds } : {}),
  }
}
