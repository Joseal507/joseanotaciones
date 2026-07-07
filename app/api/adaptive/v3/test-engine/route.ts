// ═══════════════════════════════════════════════════════════════
// /api/adaptive/v3/test-engine
// 
// Test del State Machine + Objective Selector.
// Simula 20 turnos con distintos resultados.
// Muestra cómo evoluciona el estado sin LLM.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { loadGraph } from '../../../../../lib/adaptive/v3/storage/graphStorage'
import {
  initSessionState,
  recordEvent,
  recordTurn,
  selectNextMicro,
  advanceMicro,
  calculateSessionProgress,
  shouldCloseSession,
} from '../../../../../lib/adaptive/v3/engine/stateMachine'
import { selectObjective, selectInteractionFormat } from '../../../../../lib/adaptive/v3/engine/objectiveSelector'
import type { MicroEventType } from '../../../../../lib/adaptive/v3/types'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId = 'test_v3', materialId = 'test_falcons_v3' } = body

    // Cargar grafo existente
    const graph = await loadGraph(userId, materialId)
    if (!graph) {
      return NextResponse.json({
        success: false,
        error: 'No hay grafo. Corre /api/adaptive/v3/build-graph primero',
      })
    }

    // Iniciar sesión
    let session = initSessionState({
      sessionId: 'test_session_' + Date.now(),
      userId,
      materialId,
      graph,
      targetMinutes: 20,
    })

    const trace: any[] = []

    // Simular hasta 20 turnos
    for (let turn = 1; turn <= 20; turn++) {
      // Verificar si debe cerrar
      if (shouldCloseSession(session)) {
        trace.push({ turn, action: 'CLOSE_SESSION', reason: 'shouldCloseSession=true' })
        break
      }

      // Seleccionar siguiente micro
      const microId = selectNextMicro(session, graph)
      if (!microId) {
        trace.push({ turn, action: 'NO_MORE_MICROS' })
        break
      }

      const micro = graph.microConcepts.find(m => m.id === microId)
      const microState = session.microStates[microId]
      if (!micro || !microState) continue

      // Marcar activo
      session.queue.activeMicroId = microId

      // Decidir objetivo
      const decision = selectObjective(microState, micro, session)
      const interactionFormat = selectInteractionFormat(micro, decision.objective, session)

      trace.push({
        turn,
        microName: micro.name,
        cognitiveType: micro.cognitiveType,
        importance: micro.importance,
        masteryBefore: microState.masteryLevel,
        objective: decision.objective,
        reason: decision.reason,
        format: interactionFormat,
        requiresQuestion: decision.requiresQuestion,
      })

      // SIMULAR EVENTOS
      // Turno 1-3 del micro: introducir
      // Turno 4-5: preguntar → 70% correcto, 30% incorrecto
      // Después: aplicar

      let event: MicroEventType = 'introduced'
      let outcome: 'correct' | 'partial' | 'incorrect' | null = null

      if (decision.objective === 'introduce') {
        event = 'introduced'
      } else if (decision.objective === 'verify_understanding') {
        // Simular: 70% correcto
        const random = Math.random()
        if (random < 0.7) {
          event = 'answered_correctly'
          outcome = 'correct'
        } else {
          event = 'answered_incorrectly'
          outcome = 'incorrect'
        }
      } else if (decision.objective === 'test_application') {
        const random = Math.random()
        if (random < 0.6) {
          event = 'applied_to_case'
          outcome = 'correct'
        } else {
          event = 'answered_incorrectly'
          outcome = 'incorrect'
        }
      } else if (decision.objective === 'test_transfer') {
        event = 'transferred_to_new_context'
        outcome = 'correct'
      } else if (decision.objective === 'reveal_answer' || decision.objective === 'reconstruct_from_error') {
        event = 'explained_by_tutor'
      } else if (decision.objective === 'consolidate') {
        // Marcar como completado y avanzar
        session.queue = advanceMicro(session, microId)
        trace.push({ turn, action: 'MICRO_COMPLETED', microName: micro.name })
        continue
      }

      // Actualizar estado del micro
      session.microStates[microId] = recordEvent(
        microState,
        event,
        turn,
        { outcome: outcome || undefined },
      )

      // Registrar turn
      session = recordTurn(session, {
        turnNumber: turn,
        timestamp: Date.now(),
        microId,
        objective: decision.objective,
        content: {
          type: decision.requiresQuestion ? 'question' : 'teaching',
          summary: `${decision.objective} para "${micro.name}"`,
        },
        studentResponse: outcome ? { answer: 'simulated', responseTimeMs: 30000, outcome } : undefined,
      })

      const microStateAfter = session.microStates[microId]
      trace[trace.length - 1] = {
        ...trace[trace.length - 1],
        event,
        outcome,
        masteryAfter: microStateAfter.masteryLevel,
        isReady: microStateAfter.isReady,
        correctCount: microStateAfter.evidence.answeredCorrectly,
        incorrectCount: microStateAfter.evidence.answeredIncorrectly,
      }

      // Si el micro está listo, avanzar
      if (microStateAfter.isReady) {
        session.queue = advanceMicro(session, microId)
        trace.push({ turn, action: 'MICRO_ADVANCED', microName: micro.name, mastery: microStateAfter.masteryLevel })
      }
    }

    const progress = calculateSessionProgress(session)

    return NextResponse.json({
      success: true,
      summary: {
        totalTurns: session.totalTurnsCompleted,
        totalCorrect: session.totalCorrect,
        totalIncorrect: session.totalIncorrect,
        microsCompleted: session.queue.completedMicroIds.length,
        microsTotal: session.queue.totalPlanned,
        microsPostponed: session.queue.postponedMicroIds.length,
        progress: progress.percent + '%',
        studentState: session.studentState,
        sessionClosed: shouldCloseSession(session),
      },
      microStatesFinal: Object.entries(session.microStates).map(([id, state]) => {
        const micro = graph.microConcepts.find(m => m.id === id)
        return {
          name: micro?.name,
          mastery: state.masteryLevel,
          correct: state.evidence.answeredCorrectly,
          incorrect: state.evidence.answeredIncorrectly,
          totalInteractions: state.totalInteractions,
          isReady: state.isReady,
        }
      }),
      trace,
    })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message, stack: err.stack })
  }
}
