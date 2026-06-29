// ═══════════════════════════════════════════════════════════════
// StudyAL — Actualizador del Programa Adaptativo v2
// Ahora el updater consulta al Strategy antes de decidir.
// El Strategy decide. El updater ejecuta.
// ═══════════════════════════════════════════════════════════════

import type { AdaptiveProgram, AdaptiveSession } from './program'
import { getDaysToExam } from './program'
import type { MaterialMastery } from '../masteryEngine'
import { calculateMasterySnapshot } from '../masteryEngine'
import { buildStudyStrategy, shouldUpdateStrategy } from './strategy'
import { buildProgramChangeMessage } from './narrative'
import { shouldFullReplan, fullReplanProgram } from './replanner'

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function insertSessionAfter(
  program: AdaptiveProgram,
  index: number,
  session: AdaptiveSession
): AdaptiveProgram {
  const newSessions = [...program.sessions]
  newSessions.splice(index + 1, 0, session)
  newSessions.forEach((s, i) => { s.sessionNumber = i + 1 })
  return { ...program, sessions: newSessions, updatedAt: Date.now() }
}

function createRepairSession(n: number, title?: string, objective?: string): AdaptiveSession {
  return {
    id: uid(),
    sessionNumber: n,
    title: title || 'Refuerzo necesario',
    objective: objective || 'Trabaja específicamente lo que falló.',
    estimatedMinutes: 15,
    purpose: 'repair',
    status: 'locked',
    expectedDomainGain: 10,
    steps: [
      {
        id: uid(), type: 'repair', engine: 'alai',
        title: 'Corrección dirigida',
        instruction: 'Vamos a trabajar exactamente lo que falló.',
        estimatedMinutes: 10, evidenceRequired: true, status: 'pending',
      },
      {
        id: uid(), type: 'micro_quiz', engine: 'quiz',
        title: 'Verificación',
        instruction: 'Comprobemos que ahora sí lo dominas.',
        estimatedMinutes: 5, evidenceRequired: true, status: 'pending',
      },
    ],
  }
}

function createMemorySession(n: number): AdaptiveSession {
  return {
    id: uid(),
    sessionNumber: n,
    title: 'Refuerzo de memoria',
    objective: 'Consolida conceptos en riesgo de olvidarse.',
    estimatedMinutes: 12,
    purpose: 'memorize',
    status: 'locked',
    expectedDomainGain: 8,
    steps: [
      {
        id: uid(), type: 'micro_flashcards', engine: 'flashcards',
        title: 'Flashcards de refuerzo',
        instruction: 'Estos conceptos están en riesgo de olvidarse. Reforcémoslos.',
        estimatedMinutes: 12, evidenceRequired: true, status: 'pending',
      },
    ],
  }
}

function createConsolidationSession(n: number): AdaptiveSession {
  return {
    id: uid(),
    sessionNumber: n,
    title: 'Consolidación final',
    objective: 'Asegura que tu dominio sea estable.',
    estimatedMinutes: 20,
    purpose: 'simulate',
    status: 'locked',
    expectedDomainGain: 8,
    steps: [
      {
        id: uid(), type: 'mini_exam', engine: 'examen',
        title: 'Verificación final',
        instruction: 'Una última comprobación antes de cerrar el programa.',
        estimatedMinutes: 20, evidenceRequired: true, status: 'pending',
      },
    ],
  }
}

// ── Analizar sesión completada ────────────────────────────────────
interface SessionAnalysis {
  domainGain: number
  hasIllusion: boolean
  hasForgettingRisk: boolean
  criticalConceptCount: number
  memoryIsLow: boolean
  examPassProbability: number
  weakConcepts: string[]
}

function analyzeSession(
  session: AdaptiveSession,
  mastery: MaterialMastery | null,
): SessionAnalysis {
  const domainGain = (session.domainAfter ?? 0) - (session.domainBefore ?? 0)

  if (!mastery) {
    return {
      domainGain, hasIllusion: false, hasForgettingRisk: false,
      criticalConceptCount: 0, memoryIsLow: false,
      examPassProbability: 0, weakConcepts: [],
    }
  }

  try {
    const snap = calculateMasterySnapshot(mastery)
    const concepts = mastery.concepts || []

    return {
      domainGain,
      hasIllusion: concepts.some(c => c.confidence > 65 && c.mistakes >= 2),
      hasForgettingRisk: concepts.some(
        c => c.forgettingRisk === 'very_high' || c.forgettingRisk === 'high'
      ),
      criticalConceptCount: snap.criticalConcepts.length,
      memoryIsLow: snap.memory < 40,
      examPassProbability: snap.examPassProbability,
      weakConcepts: snap.weakConcepts.map(c => c.name).slice(0, 3),
    }
  } catch {
    return {
      domainGain, hasIllusion: false, hasForgettingRisk: false,
      criticalConceptCount: 0, memoryIsLow: false,
      examPassProbability: 0, weakConcepts: [],
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════

export function updateAdaptiveProgramAfterSession(
  program: AdaptiveProgram,
  mastery: MaterialMastery | null,
): AdaptiveProgram {
  const currentIndex = program.currentSessionIndex
  const currentSession = program.sessions[currentIndex]
  if (!currentSession) return program

  let newProgram = { ...program }
  const analysis = analyzeSession(currentSession, mastery)
  const target = program.setup.targetScore
  const completedCount = program.sessions.filter(s => s.status === 'completed').length
  const currentDomain = currentSession.domainAfter ?? 0

  // ── Verificar si necesita replanning completo ─────────────────
  const replanTrigger = shouldFullReplan(newProgram, mastery, null, completedCount)
  if (replanTrigger.shouldReplan && completedCount >= 1) {
    const replanned = fullReplanProgram(newProgram, mastery, null, replanTrigger)
    return { ...replanned, updatedAt: Date.now() }
  }

  // ── DECISIONES DEL STRATEGY ───────────────────────────────────
  // El strategy evalúa si debe cambiar
  const currentStrategy = program.strategy
  let strategyChanged = false
  let changeMessage = ''

  if (currentStrategy && mastery) {
    const needsUpdate = shouldUpdateStrategy(
      currentStrategy, mastery, program.setup, completedCount
    )

    if (needsUpdate) {
      const newStrategy = buildStudyStrategy(mastery, program.setup)

      if (newStrategy.type !== currentStrategy.type) {
        strategyChanged = true
        changeMessage = buildProgramChangeMessage(
          analysis.domainGain <= 3 ? 'domain_gain_low' :
          analysis.hasIllusion ? 'illusion_detected' :
          analysis.hasForgettingRisk ? 'forgetting_risk' :
          currentDomain >= target ? 'target_reached' : 'domain_gain_high',
          { concepts: analysis.weakConcepts }
        )

        // Registrar cambio de estrategia
        const historyEntry = {
          fromType: currentStrategy.type,
          toType: newStrategy.type,
          changedAt: Date.now(),
          reason: changeMessage,
          sessionsCompleted: completedCount,
        }

        newProgram = {
          ...newProgram,
          strategy: newStrategy,
          strategyHistory: [
            ...(program.strategyHistory || []).slice(-9),
            historyEntry,
          ],
        }
      }
    }
  }

  const effectiveStrategy = newProgram.strategy || currentStrategy

  // ── INSERTAR SESIONES SEGÚN ANÁLISIS ─────────────────────────

  // 1. Subió fuerte Y no hay ilusión Y strategy no es repair → saltar refuerzo
  if (analysis.domainGain >= 15 && !analysis.hasIllusion) {
    const next = newProgram.sessions[currentIndex + 1]
    if (next && next.purpose === 'repair' && next.status !== 'completed') {
      newProgram.sessions[currentIndex + 1].status = 'skipped'
    }
  }

  // 2. Poco avance → reparación (si no hay ya una cerca)
  if (analysis.domainGain <= 3) {
    const nearRepair = newProgram.sessions
      .slice(currentIndex + 1, currentIndex + 3)
      .some(s => s.purpose === 'repair' && s.status !== 'completed')

    if (!nearRepair) {
      const repair = createRepairSession(
        newProgram.sessions.length + 1,
        undefined,
        analysis.weakConcepts.length > 0
          ? `Trabajar: ${analysis.weakConcepts.join(', ')}.`
          : undefined
      )
      newProgram = insertSessionAfter(newProgram, currentIndex, repair)
    }
  }

  // 3. Ilusión de conocimiento → sesión de desafío
  if (analysis.hasIllusion) {
    const nearChallenge = newProgram.sessions
      .slice(currentIndex + 1, currentIndex + 3)
      .some(s => s.purpose === 'apply' && s.status !== 'completed')

    if (!nearChallenge) {
      const challenge = createRepairSession(
        newProgram.sessions.length + 1,
        'Desafío de comprensión',
        'Comprueba si realmente dominas lo que crees saber.'
      )
      newProgram = insertSessionAfter(newProgram, currentIndex, challenge)
    }
  }

  // 4. Riesgo de olvido + memoria baja → sesión de memoria
  if (analysis.hasForgettingRisk && analysis.memoryIsLow) {
    const nearMemory = newProgram.sessions
      .slice(currentIndex + 1, currentIndex + 3)
      .some(s => s.purpose === 'memorize' && s.status !== 'completed')

    if (!nearMemory) {
      const memory = createMemorySession(newProgram.sessions.length + 1)
      newProgram = insertSessionAfter(newProgram, currentIndex, memory)
    }
  }

  // 5. Conceptos críticos → reparación específica
  if (analysis.criticalConceptCount >= 3 && analysis.domainGain < 10) {
    const nearCritical = newProgram.sessions
      .slice(currentIndex + 1, currentIndex + 2)
      .some(s => s.purpose === 'repair')

    if (!nearCritical) {
      const critical = createRepairSession(
        newProgram.sessions.length + 1,
        'Conceptos críticos',
        'Trabajar los conceptos que más te están costando.'
      )
      newProgram = insertSessionAfter(newProgram, currentIndex, critical)
    }
  }

  // 6. Alcanzó objetivo → consolidar
  if (currentDomain >= target) {
    const hasConsolidation = newProgram.sessions.some(
      s => s.title === 'Consolidación final'
    )
    if (!hasConsolidation) {
      const cons = createConsolidationSession(newProgram.sessions.length + 1)
      newProgram = insertSessionAfter(newProgram, currentIndex, cons)
    } else {
      newProgram.status = 'completed'
    }
  }

  // ── AVANZAR ÍNDICE ────────────────────────────────────────────
  const nextIndex = currentIndex + 1
  if (newProgram.sessions[nextIndex]) {
    newProgram.sessions[nextIndex].status = 'available'
    newProgram.currentSessionIndex = nextIndex
  } else {
    newProgram.status = 'completed'
  }

  newProgram.updatedAt = Date.now()
  return newProgram
}

// ── Mensaje de cambio de estrategia para UI ──────────────────────
export function getLatestStrategyChangeMessage(program: AdaptiveProgram): string | null {
  const history = program.strategyHistory
  if (!history || history.length === 0) return null
  return history[history.length - 1].reason
}
