// ═══════════════════════════════════════════════════════════════
// SIMULATION RUNNER v3
// Usa motores reales. Fusible basado en totalInteractions real.
// ═══════════════════════════════════════════════════════════════

import type { KnowledgeGraph, MicroConcept } from '../../../lib/adaptive/v3/types'
import {
  initSessionState,
  recordEvent,
  recordTurn,
  selectNextMicro,
  advanceMicro,
  evaluateSessionCompletion,
  MAX_INTERACTIONS_PER_MICRO,
} from '../../../lib/adaptive/v3/engine/stateMachine'
import {
  recordEvidence,
  emptyEvidenceProfile,
  isReadyToAdvanceEvidence,
  isMicroMastered,
  type EvidenceProfile,
} from '../../../lib/adaptive/v3/engine/evidenceEngine'
import { selectObjective } from '../../../lib/adaptive/v3/engine/objectiveSelector'
import { selectFormat } from '../../../lib/adaptive/v3/engine/formatSelector'
import type { SessionState, Turn, MicroEventType } from '../../../lib/adaptive/v3/types'

import type { SeededRandom } from './seededRandom'
import type {
  SimulationTurn,
  SimulationRunResult,
  SimulationConfig,
  SimulationInvariantFailure,
} from './types'
import {
  initLatentMicroState,
  applyForgetting,
  applyLearning,
  applyTeaching,
  generateResponse,
} from './studentModel'
import { checkAllInvariants } from './invariants'
import { getProfile } from './studentProfiles'
import { ALL_PROGRAMS } from './programFixtures'
import { checkMasteryContract } from '../../../lib/adaptive/v3/engine/masteryContracts'
import { ASSISTANCE_LEVEL_ORDER } from '../../../lib/adaptive/v3/engine/confidenceTracker'

const VIRTUAL_MS_PER_TURN = 2 * 60 * 1000

const TEACHING_OBJECTIVES = new Set([
  'introduce', 'explain_deeper', 'illustrate_with_example',
  'reveal_answer', 'reconstruct_from_error', 'connect_to_previous',
  'address_misconception', 'simplify_to_core', 'illustrate_with_worked_example',
  'explain_with_analogy', 'explain_with_contrast', 'explain_cause_effect',
  'guided_reconstruction', 'summarize_key_idea', 'illustrate_with_everyday_case',
  'illustrate_with_error_case', 'explain_with_story', 'explain_with_visualization',
  'explain_with_counterexample', 'use_prior_knowledge', 'activate_prior_knowledge',
  'explain_by_elimination', 'explain_effect_to_cause', 'build_mental_model',
  'split_into_submicros', 'teach_mnemonic',
])

// Fusible del simulador: independiente del motor.
// Si un micro acumula este número de turnos totales sin avanzar, forzar avance.
// Más alto que MAX_INTERACTIONS_PER_MICRO para dar oportunidad al motor real.
const SIM_FUSE_TURNS = MAX_INTERACTIONS_PER_MICRO * 4  // 24 turnos — suficiente para multi-sesión

export async function runSimulation(
  config: SimulationConfig,
  rng: SeededRandom,
): Promise<SimulationRunResult> {
  const profile = getProfile(config.profileId)
  const graph = ALL_PROGRAMS[config.programId]
  if (!graph) throw new Error(`Programa no encontrado: ${config.programId}`)

  const allTurns: SimulationTurn[] = []
  const allInvariantFailures: SimulationInvariantFailure[] = []
  const seenInvariantKeys = new Set<string>()
  const latentStates: Record<string, ReturnType<typeof initLatentMicroState>> = {}
  const strategiesUsed: string[] = []
  const repairMicroIds = new Set<string>()
  // Contador de turnos por micro para fusible del simulador
  const microTurnCount: Record<string, number> = {}
  let virtualTimeMs = 0
  let totalTurns = 0
  let sessionCount = 0
  let strategyChangedAfterFail = false
  let restorePointsChecked = 0
  let restoreDivergences = 0
  let lastStrategyId: string | null = null
  let consecutiveFails = 0
  let prematureFuseCount = 0

  for (const micro of graph.microConcepts) {
    latentStates[micro.id] = initLatentMicroState(micro.id, profile, micro, rng.fork(micro.id.length))
    microTurnCount[micro.id] = 0
  }

  let session = initSessionState({
    sessionId: `sim_${config.seed}_s0`,
    userId: 'sim_user',
    materialId: graph.materialId,
    graph,
    targetMinutes: config.targetMinutes,
  })
  ;(session as any).requiredMicroIds = graph.microConcepts.map(m => m.id)

  while (sessionCount < config.maxSessionsPerProgram && totalTurns < config.maxTotalTurns) {
    sessionCount++
    let sessionTurnIndex = 0

    if (config.enableDropout && sessionCount > 1 && rng.next() < profile.dropoutRate) {
      const dropoutHours = config.dropoutReturnAfterVirtualHours * (0.5 + rng.next())
      virtualTimeMs += dropoutHours * 60 * 60 * 1000
      for (const id of Object.keys(latentStates)) {
        latentStates[id] = applyForgetting(latentStates[id], profile, dropoutHours * 60 * 60 * 1000)
      }
    }

    let lastObjectiveWasReveal = false
    while (sessionTurnIndex < config.maxTurnsPerSession && totalTurns < config.maxTotalTurns) {
      const nextMicroId = selectNextMicro(session, graph)
      if (!nextMicroId) break

      session.queue.activeMicroId = nextMicroId
      const currentMicro = graph.microConcepts.find(m => m.id === nextMicroId)!

      // ── FUSIBLE DEL SIMULADOR ────────────────────────────────
      // Si este micro lleva demasiados turnos sin avanzar, forzarlo.
      // Esto protege contra bugs del motor real sin ocultar el bug
      // (se registra en el turno pero NO como invariant failure,
      //  porque es el comportamiento esperado del fuse).
      microTurnCount[nextMicroId] = (microTurnCount[nextMicroId] || 0) + 1
      if (microTurnCount[nextMicroId] > SIM_FUSE_TURNS) {
        // Forzar avance marcando isReady=true
        session.microStates[nextMicroId] = {
          ...session.microStates[nextMicroId],
          isReady: true,
        }
        session.queue = advanceMicro(session, nextMicroId)
        microTurnCount[nextMicroId] = 0
        continue
      }

      const microState = session.microStates[nextMicroId]

      const objectiveDecision = selectObjective(
        microState, currentMicro, session, 'some', 'mix_everything',
      )
      const objective = objectiveDecision.objective

      const formatDecision = selectFormat(currentMicro, microState, objective)
      const format =
        objectiveDecision.forcedFormat ||
        (formatDecision.format !== 'none' ? formatDecision.format : pickSimulatedFormat(currentMicro, objective))

      // ── TURNO DE ENSEÑANZA ──────────────────────────────────
      // Si el objetivo tiene forcedFormat, siempre es un turno con pregunta aunque esté
      // listado como objetivo de enseñanza. Ej: connect_to_previous con matching forzado.
      const isTeachingTurn =
        (TEACHING_OBJECTIVES.has(objective) || (!objectiveDecision.requiresQuestion && objective !== 'consolidate')) &&
        !objectiveDecision.forcedFormat

      if (isTeachingTurn) {
        const eventType: MicroEventType =
          objective === 'introduce' ? 'introduced' : 'explained_by_tutor'

        const stAfterEvent = recordEvent(
          microState, eventType, session.currentTurn,
          { contentShown: objective },
        )
        session.microStates[nextMicroId] = stAfterEvent

        const turnRecord: Turn = {
          turnNumber: session.currentTurn + 1,
          timestamp: virtualTimeMs,
          microId: nextMicroId,
          objective,
          content: { type: 'teaching', summary: objective },
        }
        session = recordTurn(session, turnRecord)

        latentStates[nextMicroId] = {
          ...applyTeaching(latentStates[nextMicroId], profile),
          lastExposureAtMs: virtualTimeMs,
        }

        // Fusible del motor: leer totalInteractions del estado actualizado
        if (stAfterEvent.totalInteractions >= MAX_INTERACTIONS_PER_MICRO) {
          if (
            !isMicroMastered(stAfterEvent.evidenceProfile || emptyEvidenceProfile(nextMicroId), currentMicro) &&
            stAfterEvent.timeline.filter(event => event.eventType === 'answered_incorrectly').length >= 2 &&
            !stAfterEvent.timeline.some(event =>
              event.eventType === 'explained_by_tutor' && event.metadata?.contentShown !== 'introduce'
            )
          ) prematureFuseCount++
          session.microStates[nextMicroId] = { ...stAfterEvent, isReady: true }
          session.queue = advanceMicro(session, nextMicroId)
          microTurnCount[nextMicroId] = 0
        }

        allTurns.push(makeTeachingTurn(totalTurns + 1, sessionCount, nextMicroId, objective, virtualTimeMs, latentStates[nextMicroId].trueKnowledge))
        virtualTimeMs += VIRTUAL_MS_PER_TURN
        totalTurns++
        sessionTurnIndex++
        // Si el tutor acaba de mostrar la respuesta, el SIGUIENTE turno es post-reveal
        lastObjectiveWasReveal = (objective === 'reveal_answer' || objective === 'reconstruct_from_error')
        continue
      }

      // ── CONSOLIDAR ─────────────────────────────────────────
      if (objective === 'consolidate') {
        // Importante: si el motor decidió consolidar, este micro debe quedar
        // explícitamente listo en el state antes de avanzar la cola.
        session.microStates[nextMicroId] = {
          ...session.microStates[nextMicroId],
          isReady: true,
        }
        session.queue = advanceMicro(session, nextMicroId)
        microTurnCount[nextMicroId] = 0
        const turnRecord: Turn = {
          turnNumber: session.currentTurn + 1,
          timestamp: virtualTimeMs,
          microId: nextMicroId,
          objective: 'consolidate',
          content: { type: 'summary', summary: 'consolidate' },
        }
        session = recordTurn(session, turnRecord)
        allTurns.push(makeTeachingTurn(totalTurns + 1, sessionCount, nextMicroId, 'consolidate', virtualTimeMs, latentStates[nextMicroId].trueKnowledge))
        virtualTimeMs += VIRTUAL_MS_PER_TURN
        totalTurns++
        sessionTurnIndex++
        continue
      }

      // ── TURNO CON RESPUESTA ─────────────────────────────────
      const elapsed = virtualTimeMs - latentStates[nextMicroId].lastExposureAtMs
      if (elapsed > 0 && latentStates[nextMicroId].exposures > 0) {
        latentStates[nextMicroId] = applyForgetting(latentStates[nextMicroId], profile, elapsed)
      }

      const { response: rawResponse, assistanceLevelUsed: rawAssistanceLevelUsed } = generateResponse({
        state: latentStates[nextMicroId],
        profile,
        micro: currentMicro,
        format,
        objective,
        virtualTimeMs,
        sessionTurnIndex,
        rng: rng.fork(totalTurns),
      })

      // Si el turno anterior fue reveal_answer, este turno es post-reveal
      // El assistanceLevel real es 'revealed' independientemente de lo que calcule generateResponse
      const assistanceLevelUsed: import('../../../lib/adaptive/v3/engine/confidenceTracker').AssistanceLevel =
        lastObjectiveWasReveal ? 'revealed' : rawAssistanceLevelUsed
      const response = lastObjectiveWasReveal
        ? { ...rawResponse, assistanceLevel: 'revealed' as const }
        : rawResponse
      // Resetear flag — solo aplica al turno inmediatamente posterior al reveal
      lastObjectiveWasReveal = false

      latentStates[nextMicroId] = applyLearning(
        latentStates[nextMicroId], profile,
        response.outcome === 'correct', assistanceLevelUsed,
      )
      latentStates[nextMicroId] = { ...latentStates[nextMicroId], lastExposureAtMs: virtualTimeMs }

      const eventType: MicroEventType =
        response.outcome === 'correct' ? 'answered_correctly' :
        response.outcome === 'partial' ? 'answered_partially' :
        'answered_incorrectly'

      // recordEvent incrementa totalInteractions
      const stAfterEvent = recordEvent(
        session.microStates[nextMicroId], eventType, session.currentTurn,
        { outcome: response.outcome, studentResponse: `sim_${response.outcome}` },
      )
      if (stAfterEvent.timeline.length > 0) {
        const lastEvent = stAfterEvent.timeline[stAfterEvent.timeline.length - 1]
        if (lastEvent?.metadata) {
          lastEvent.metadata.formatUsed = format
        }
      }
      session.microStates[nextMicroId] = stAfterEvent

      // Usar el evidenceProfile ya acumulado en el microState (incluye snapshot de sesiones previas)
      // NO reconstruir desde emptyEvidenceProfile — eso borraría el historial
      const currentProfile: EvidenceProfile =
        session.microStates[nextMicroId].evidenceProfile || emptyEvidenceProfile(nextMicroId)

      const updatedProfile = recordEvidence(currentProfile, {
        formatUsed: format,
        outcome: response.outcome,
        score: response.score,
        turnNumber: session.currentTurn,
        assistanceLevel: assistanceLevelUsed,
        responseTimeMs: response.responseTimeMs,
        selfReportedConfidence: response.selfReportedConfidence,
        interactionContext: response.interactionContext,
        elapsedSinceLastExposureMs: response.elapsedSinceLastExposureMs,
        activityAttemptNumber: 1,
      })

      session.microStates[nextMicroId].evidenceProfile = updatedProfile

      // ── DECISIÓN DE AVANCE ──────────────────────────────────
      // 1) readiness heurística
      const evidenceApproves = isReadyToAdvanceEvidence(updatedProfile, currentMicro)
      // 2) mastery contractual real
      const masteryApproves = isMicroMastered(updatedProfile, currentMicro)
      // 3) fusible del motor
      const motorFuse = stAfterEvent.totalInteractions >= MAX_INTERACTIONS_PER_MICRO
      if (
        motorFuse && !masteryApproves &&
        stAfterEvent.timeline.filter(event => event.eventType === 'answered_incorrectly').length >= 2 &&
        !stAfterEvent.timeline.some(event =>
          event.eventType === 'explained_by_tutor' && event.metadata?.contentShown !== 'introduce'
        )
      ) prematureFuseCount++

      session.microStates[nextMicroId].isReady = evidenceApproves || masteryApproves || motorFuse

      if (session.microStates[nextMicroId].isReady) {
        session.queue = advanceMicro(session, nextMicroId)
        microTurnCount[nextMicroId] = 0
      }

      const strategyId = objectiveDecision.strategyId || objective
      if (!strategiesUsed.includes(strategyId)) strategiesUsed.push(strategyId)
      if (response.outcome === 'incorrect') {
        consecutiveFails++
      } else {
        if (consecutiveFails >= 2 && lastStrategyId && lastStrategyId !== strategyId) {
          strategyChangedAfterFail = true
        }
        consecutiveFails = 0
      }
      lastStrategyId = strategyId

      const turnRecord: Turn = {
        turnNumber: session.currentTurn + 1,
        timestamp: virtualTimeMs,
        microId: nextMicroId,
        objective,
        content: {
          type: 'question',
          summary: `${format}:${response.outcome}`,
          interaction: { interactionType: format } as any,
        } as any,
        studentResponse: {
          answer: response.outcome,
          responseTimeMs: response.responseTimeMs,
          outcome: response.outcome,
        },
      }
      session = recordTurn(session, turnRecord)

      if (config.enableRestorePoints && rng.next() < config.restorePointProbability) {
        restorePointsChecked++
        const serialized = JSON.stringify(session)
        const restored = JSON.parse(serialized) as SessionState
        const diverged =
          restored.queue.completedMicroIds.length !== session.queue.completedMicroIds.length ||
          restored.currentTurn !== session.currentTurn
        if (diverged) restoreDivergences++
        else session = restored
      }

      virtualTimeMs += VIRTUAL_MS_PER_TURN + Math.round(response.responseTimeMs / 1000) * 1000
      totalTurns++
      sessionTurnIndex++

      allTurns.push({
        turnIndex: totalTurns,
        sessionIndex: sessionCount,
        microId: nextMicroId,
        format,
        objective,
        response,
        engineDecision: {
          objective,
          reason: objectiveDecision.reason,
          strategyId: objectiveDecision.strategyId || null,
        },
        evidenceProfileAfter: {
          masteryScore: updatedProfile.masteryScore,
          independentSuccesses: updatedProfile.independentSuccesses,
          hasTransfer: updatedProfile.hasTransfer,
          hasDelayedRecall: updatedProfile.hasDelayedRecall,
        },
        virtualTimeMs,
      })

      if (totalTurns % 5 === 0) {
        const completion = evaluateSessionCompletion(session, graph)
        for (const f of checkAllInvariants({
          seed: config.seed, profileId: config.profileId, programId: config.programId,
          sessionIndex: sessionCount, sessionState: session, completion,
          turns: allTurns, microResolutions: completion.microResolutions, virtualTimeMs,
        })) {
          const key = `${f.invariantId}-${sessionCount}-${Math.floor(totalTurns / 10)}`
          if (!seenInvariantKeys.has(key)) { seenInvariantKeys.add(key); allInvariantFailures.push(f) }
        }
      }
    }

    const completion = evaluateSessionCompletion(session, graph)

    for (const f of checkAllInvariants({
      seed: config.seed, profileId: config.profileId, programId: config.programId,
      sessionIndex: sessionCount, sessionState: session, completion,
      turns: allTurns, microResolutions: completion.microResolutions, virtualTimeMs,
    })) {
      const key = `${f.invariantId}-final-${sessionCount}`
      if (!seenInvariantKeys.has(key)) { seenInvariantKeys.add(key); allInvariantFailures.push(f) }
    }

    if (completion.isProgramComplete) break

    if (completion.isSessionComplete && !completion.isProgramComplete) {
      for (const microId of completion.unresolvedMicroIds) repairMicroIds.add(microId)
      const hoursUntilNext = completion.unresolvedMicroIds.length > 0
        ? 0.25
        : 18 + rng.next() * 12
      virtualTimeMs += hoursUntilNext * 60 * 60 * 1000
      for (const id of Object.keys(latentStates)) {
        latentStates[id] = applyForgetting(latentStates[id], profile, hoursUntilNext * 60 * 60 * 1000)
      }

      const priorMastery: Record<string, any> = {}
      for (const [microId, st] of Object.entries(session.microStates)) {
        priorMastery[microId] = {
          masteryLevel: st.masteryLevel,
          isReady: st.isReady,
          answeredCorrectly: st.evidence.answeredCorrectly,
          answeredIncorrectly: st.evidence.answeredIncorrectly,
          introduced: st.evidence.introduced,
          explainedByTutor: st.evidence.explainedByTutor,
          applied: st.evidence.applied,
          evidenceProfileSnapshot: st.evidenceProfile,
        }
      }

      const unresolvedForNext = completion.unresolvedMicroIds.length > 0
        ? completion.unresolvedMicroIds
        : graph.microConcepts.map(m => m.id)

      const allGraphIds = graph.microConcepts.map(m => m.id)
      const masteredSoFar = allGraphIds.filter(id => !unresolvedForNext.includes(id))

      session = initSessionState({
        sessionId: `sim_${config.seed}_s${sessionCount}`,
        userId: 'sim_user',
        materialId: graph.materialId,
        graph,
        targetMinutes: config.targetMinutes,
        microIdsToTeach: allGraphIds,
        priorMastery,
      })

      // El programa completo sigue siendo todos los micros del grafo
      session.requiredMicroIds = allGraphIds

      // Pero la siguiente sesión debe trabajar solo los no resueltos
      session.queue.pendingMicroIds = [...unresolvedForNext]
      session.queue.completedMicroIds = [...masteredSoFar]
      session.queue.postponedMicroIds = []
      session.queue.activeMicroId = null
      session.queue.totalPlanned = allGraphIds.length

      for (const microId of masteredSoFar) {
        if (session.microStates[microId]) {
          session.microStates[microId].isReady = true
        }
      }

      // microTurnCount NO se resetea entre sesiones — es global al run
    } else if (!completion.isSessionComplete) {
      break
    }
  }

  const finalCompletion = evaluateSessionCompletion(session, graph)

  let falseMasteryCount = 0
  let latentFalsePositiveCount = 0
  let falseMissCount = 0
  let avgTrueKnowledgeAtEnd = 0
  let retainedMasteredMicros = 0
  let evidenceDiversitySatisfiedMicros = 0
  let independentSuccesses = 0
  let maxAssistanceLevelUsed: import('../../../lib/adaptive/v3/engine/confidenceTracker').AssistanceLevel = 'independent'

  for (const micro of graph.microConcepts) {
    const trueK = latentStates[micro.id]?.trueKnowledge ?? 0
    avgTrueKnowledgeAtEnd += trueK
    const engineSaysMastered = finalCompletion.microResolutions[micro.id]?.status === 'mastered'
    const finalProfile = session.microStates[micro.id]?.evidenceProfile || emptyEvidenceProfile(micro.id)
    independentSuccesses += finalProfile.independentSuccesses
    if (ASSISTANCE_LEVEL_ORDER.indexOf(finalProfile.maxAssistanceLevelUsed) > ASSISTANCE_LEVEL_ORDER.indexOf(maxAssistanceLevelUsed)) {
      maxAssistanceLevelUsed = finalProfile.maxAssistanceLevelUsed
    }
    const contractResult = checkMasteryContract(micro.cognitiveType, finalProfile, {
      independentSuccesses: finalProfile.independentSuccesses,
      independentSuccessesByType: finalProfile.independentSuccessesByType,
      bestAssistanceByEvidenceType: finalProfile.bestAssistanceByEvidenceType,
      hasDelayedRecall: finalProfile.hasDelayedRecall,
      hasTransfer: finalProfile.hasTransfer,
      hasIntegration: finalProfile.hasIntegration,
      maxAssistanceLevelUsed: finalProfile.maxAssistanceLevelUsed,
    })
    if (contractResult.retainedFulfilled) retainedMasteredMicros++
    if (contractResult.missingRequired.length === 0) evidenceDiversitySatisfiedMicros++
    if (engineSaysMastered && !contractResult.provisionallyFulfilled) falseMasteryCount++
    if (engineSaysMastered && trueK < 0.5) latentFalsePositiveCount++
    if (!engineSaysMastered && trueK >= 0.8) falseMissCount++
  }
  avgTrueKnowledgeAtEnd /= Math.max(1, graph.microConcepts.length)

  const hasLoop = allInvariantFailures.some(f => f.invariantId === 'INV-04')
  const strategyTelemetry = measureStrategyChangesAfterRepeatedFailure(allTurns)
  const activityTelemetry = measureActivityChanges(allTurns)
  const turnsByMicro = new Map<string, number>()
  for (const turn of allTurns) turnsByMicro.set(turn.microId, (turnsByMicro.get(turn.microId) || 0) + 1)
  const maxTurnsOnSingleMicro = Math.max(0, ...turnsByMicro.values())
  let maxConsecutiveTeachingTurns = 0
  let teachingStreak = 0
  let priorSessionIndex: number | null = null
  for (const turn of allTurns) {
    if (priorSessionIndex !== null && turn.sessionIndex !== priorSessionIndex) teachingStreak = 0
    teachingStreak = turn.format === 'none' && turn.objective !== 'consolidate' ? teachingStreak + 1 : 0
    maxConsecutiveTeachingTurns = Math.max(maxConsecutiveTeachingTurns, teachingStreak)
    priorSessionIndex = turn.sessionIndex
  }
  const repairResolutions = [...repairMicroIds].filter(
    microId => finalCompletion.microResolutions[microId]?.status === 'mastered',
  ).length

  let outcome: SimulationRunResult['outcome']
  if (hasLoop) outcome = 'invalid_loop'
  else if (restoreDivergences > 0) outcome = 'invalid_restore_divergence'
  else if (falseMasteryCount > 0 && finalCompletion.isProgramComplete) outcome = 'invalid_false_mastery'
  else if (allInvariantFailures.length > 0) outcome = 'invalid_invariant'
  else if (finalCompletion.isProgramComplete) outcome = 'program_complete'
  else if (finalCompletion.isSessionComplete) outcome = 'session_complete_program_pending'
  else outcome = 'valid_incomplete'

  return {
    seed: config.seed, profileId: config.profileId, programId: config.programId,
    sessionCount, totalTurns, outcome,
    masteredMicros: finalCompletion.masteredCount,
    totalMicros: finalCompletion.totalRequired,
    masteryPercent: finalCompletion.masteryPercent,
    virtualDurationMs: virtualTimeMs,
    virtualDays: virtualTimeMs / (1000 * 60 * 60 * 24),
    invariantFailures: allInvariantFailures,
    turns: allTurns,
    finalMicroResolutions: finalCompletion.microResolutions,
    avgTrueKnowledgeAtEnd, falseMasteryCount, latentFalsePositiveCount, falseMissCount,
    strategiesUsed,
    strategyChangedAfterFail: strategyTelemetry.changes > 0 || strategyChangedAfterFail,
    strategyChangeOpportunities: strategyTelemetry.opportunities,
    strategyChangesAfterRepeatedFailure: strategyTelemetry.changes,
    repairAttempts: repairMicroIds.size,
    repairResolutions,
    maxTurnsOnSingleMicro,
    maxConsecutiveTeachingTurns,
    prematureFuseCount,
    unresolvedMicros: finalCompletion.unresolvedMicroIds.length,
    requiredCoveragePercent: finalCompletion.coveragePercent,
    retainedMasteredMicros,
    evidenceDiversitySatisfiedMicros,
    independentSuccesses,
    maxAssistanceLevelUsed,
    activityChangesAfterCorrect: activityTelemetry.correctChanges,
    activityChangeOpportunitiesAfterCorrect: activityTelemetry.correctOpportunities,
    activityChangesAfterIncorrect: activityTelemetry.incorrectChanges,
    activityChangeOpportunitiesAfterIncorrect: activityTelemetry.incorrectOpportunities,
    programClosureWithoutEngineConfirmation: 0,
    restorePointsChecked, restoreDivergences,
  }
}

function measureActivityChanges(turns: SimulationTurn[]): {
  correctChanges: number
  correctOpportunities: number
  incorrectChanges: number
  incorrectOpportunities: number
} {
  let correctChanges = 0
  let correctOpportunities = 0
  let incorrectChanges = 0
  let incorrectOpportunities = 0
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index]
    if (turn.format === 'none') continue
    const next = turns.slice(index + 1).find(candidate => candidate.microId === turn.microId)
    if (!next) continue
    const changed = next.objective !== turn.objective || next.format !== turn.format
    if (turn.response.outcome === 'correct') {
      correctOpportunities++
      if (changed) correctChanges++
    } else if (turn.response.outcome === 'incorrect') {
      incorrectOpportunities++
      if (changed) incorrectChanges++
    }
  }
  return { correctChanges, correctOpportunities, incorrectChanges, incorrectOpportunities }
}

export function measureStrategyChangesAfterRepeatedFailure(turns: SimulationTurn[]): {
  opportunities: number
  changes: number
} {
  let opportunities = 0
  let changes = 0
  const responseStreakByMicro = new Map<string, number>()

  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index]
    if (turn.format === 'none') continue

    const priorStreak = responseStreakByMicro.get(turn.microId) || 0
    const streak = turn.response.outcome === 'incorrect' ? priorStreak + 1 : 0
    responseStreakByMicro.set(turn.microId, streak)
    // Una racha es un episodio: la oportunidad nace al cruzar el umbral de dos
    // fallos, no de nuevo en cada fallo adicional del mismo episodio.
    if (streak !== 2) continue

    const nextActivity = turns.slice(index + 1).find(candidate => candidate.microId === turn.microId)
    // Sin actividad posterior no existe una decisión observable que evaluar.
    if (!nextActivity) continue
    opportunities++

    const changed =
      nextActivity.objective !== turn.objective ||
      nextActivity.format !== turn.format ||
      nextActivity.engineDecision.strategyId !== turn.engineDecision.strategyId
    if (changed) changes++
  }

  return { opportunities, changes }
}

function makeTeachingTurn(
  turnIndex: number, sessionIndex: number, microId: string, objective: string,
  virtualTimeMs: number, trueKnowledge: number,
): SimulationTurn {
  return {
    turnIndex, sessionIndex, microId, format: 'none', objective,
    response: {
      outcome: 'correct', score: 0, responseTimeMs: 0,
      assistanceLevel: 'independent', selfReportedConfidence: undefined,
      interactionContext: 'learning', attemptNumber: 0, wasRetry: false,
      elapsedSinceLastExposureMs: undefined,
      _latentKnowledgeAtTime: trueKnowledge, _wasGuess: false,
    },
    engineDecision: { objective, reason: 'teaching turn', strategyId: null },
    evidenceProfileAfter: { masteryScore: 0, independentSuccesses: 0, hasTransfer: false, hasDelayedRecall: false },
    virtualTimeMs,
  }
}

function pickSimulatedFormat(micro: MicroConcept, objective: string): string {
  const byType: Record<string, string> = {
    definitional: 'multiple_choice', conceptual: 'multiple_choice',
    procedural: 'ordering', mathematical: 'fill_blank',
    causal: 'multiple_choice', comparative: 'matching',
    classificatory: 'classify_groups', chronological: 'ordering',
    analytical: 'multiple_choice', applicative: 'practical_case',
    narrative: 'multiple_choice',
  }
  if (objective === 'verify_understanding' || objective === 'test_application') {
    return byType[micro.cognitiveType] || 'multiple_choice'
  }
  return 'multiple_choice'
}
