// ═══════════════════════════════════════════════════════════════
// StudyAL — Adaptive Brain
// Un solo cerebro. Todas las piezas obedecen.
//
// No es un módulo más.
// Es el único punto donde se fusionan:
//
//   StudentMemory + KnowledgeGraph + ForgettingCurve +
//   CausalEngine + PedagogicalUtility + UncertaintyModel +
//   Strategy + Replanner
//
// Y produce UNA SOLA DECISIÓN para el resto del sistema.
// ═══════════════════════════════════════════════════════════════

import type { MaterialMastery } from '../masteryEngine'
import { calculateMasterySnapshot } from '../masteryEngine'

import type { AdaptiveProgram, AdaptiveProgramSetup } from './program'
import { getDaysToExam, getCurrentSession } from './program'

import type { StudyStrategy } from './strategy'
import { buildStudyStrategy, enrichStrategyWithUtility } from './strategy'

import type { StudentMemory } from './studentMemory'
import { PATTERN_LABELS } from './studentMemory'

import { buildStrategyNarrative } from './narrative'
import type { StrategyNarrative } from './narrative'

import { calculateEngineUtility } from './utility'
import type { UtilityOption } from './utility'

import { shouldFullReplan, fullReplanProgram } from './replanner'

import { assignPhasesToSessions } from './phases'
import type { ProgramPhase } from './phases'

import { calculateDomainEstimate, getAdaptationAggressiveness } from './uncertaintyModel'
import type { DomainEstimate } from './uncertaintyModel'

import { detectPlateau, applyNonLinearGain, projectRealDomain } from './domainModel'

import { getConceptsDueForReview } from './forgettingCurve'
import type { ConceptForgettingProfile } from './forgettingCurve'

import { inferAtRiskConcepts } from './knowledgeGraph'
import type { StudentKnowledgeGraph } from './knowledgeGraph'

import {
  getBestSequenceForStudent,
  DEFAULT_SEQUENCES,
  evaluateProgramCandidates,
} from './causalEngine'

// ═══════════════════════════════════════════════════════════════
// TIPOS PÚBLICOS DEL BRAIN
// ═══════════════════════════════════════════════════════════════

export interface BrainContext {
  mastery: MaterialMastery | null
  memory: StudentMemory | null
  program: AdaptiveProgram | null
  setup: AdaptiveProgramSetup
  forgettingProfiles?: ConceptForgettingProfile[]
  knowledgeGraph?: StudentKnowledgeGraph
}

export interface BrainDecision {
  // ── Qué hacer ──────────────────────────────────────────────
  action:
    | 'create_program'     // No hay programa, crear uno
    | 'continue_program'   // Continuar sesión actual
    | 'replan_program'     // Replanificar todo
    | 'recover_first'      // Ausencia larga, recuperar antes
    | 'consolidate'        // Ya alcanzó el objetivo
    | 'emergency_mode'     // Examen muy cerca

  // ── Por qué ────────────────────────────────────────────────
  reasoning: string          // Explicación interna (para debug)
  userMessage: string        // Mensaje para el usuario en lenguaje simple

  // ── El programa resultante ──────────────────────────────────
  program: AdaptiveProgram | null

  // ── Estrategia ─────────────────────────────────────────────
  strategy: StudyStrategy | null

  // ── Narrativa de ALAI ───────────────────────────────────────
  narrative: StrategyNarrative | null

  // ── Mejor secuencia de motores para HOY ────────────────────
  recommendedSequence: string[]
  sequenceRationale: string

  // ── Dominio con incertidumbre ───────────────────────────────
  domainEstimate: DomainEstimate | null

  // ── Fases del programa ──────────────────────────────────────
  phases: ProgramPhase[]

  // ── Conceptos en riesgo de olvido ──────────────────────────
  urgentReviews: Array<{
    conceptName: string
    urgency: 'critical' | 'high' | 'medium'
  }>

  // ── Conceptos en riesgo por dependencias ───────────────────
  atRiskConcepts: Array<{
    conceptName: string
    riskScore: number
    reason: string
  }>

  // ── Predicción de dominio ───────────────────────────────────
  projection: {
    currentDomain: number
    afterNextSession: number
    toReachTarget: number | null  // sesiones estimadas
    isTargetReachable: boolean
  }

  // ── Plateau ─────────────────────────────────────────────────
  isOnPlateau: boolean
  plateauMessage?: string

  // ── Conflicto de objetivos ──────────────────────────────────
  hasConflict: boolean
  conflictMessage?: string
  realisticTarget?: number

  // ── Agresividad de la adaptación ───────────────────────────
  adaptationMode: 'conservative' | 'moderate' | 'aggressive'

  // ── Metadata ────────────────────────────────────────────────
  decidedAt: number
  confidence: number    // 0-100: qué tan seguro está el cerebro
}

// ── Estado interno del cerebro ───────────────────────────────────
export interface BrainState {
  currentDomain: number
  daysToExam: number | null
  hasProgram: boolean
  completedSessions: number
  daysSinceLastStudy: number | null
  isEmergency: boolean
  hasLongAbsence: boolean
  targetScore: number
}

// ═══════════════════════════════════════════════════════════════
// EL CEREBRO
// ═══════════════════════════════════════════════════════════════

export class AdaptiveBrain {
  private context: BrainContext

  constructor(context: BrainContext) {
    this.context = context
  }

  // ── MÉTODO PRINCIPAL ─────────────────────────────────────────
  // Llama a este método. Solo a este.
  // El cerebro decide todo lo demás.

  decide(): BrainDecision {
    const state = this.buildState()
    const action = this.chooseAction(state)

    switch (action) {
      case 'create_program':
        return this.decideCreateProgram(state)
      case 'emergency_mode':
        return this.decideEmergency(state)
      case 'recover_first':
        return this.decideRecovery(state)
      case 'consolidate':
        return this.decideConsolidate(state)
      case 'replan_program':
        return this.decideReplan(state)
      default:
        return this.decideContinue(state)
    }
  }

  // ── CONSTRUIR ESTADO INTERNO ──────────────────────────────────

  private buildState(): BrainState {
    const { mastery, program, setup } = this.context

    let currentDomain = 0
    if (mastery) {
      try {
        currentDomain = calculateMasterySnapshot(mastery).overallMastery
      } catch {}
    }

    const daysToExam = getDaysToExam(setup.examDate)
    const completedSessions = program?.sessions.filter(s => s.status === 'completed').length ?? 0

    // Días sin estudiar
    let daysSinceLastStudy: number | null = null
    if (mastery?.timeline?.length) {
      const last = mastery.timeline[mastery.timeline.length - 1]
      daysSinceLastStudy = Math.floor(
        (Date.now() - last.timestamp) / (1000 * 60 * 60 * 24)
      )
    }

    return {
      currentDomain,
      daysToExam,
      hasProgram: !!program && program.sessions.length > 0,
      completedSessions,
      daysSinceLastStudy,
      isEmergency: daysToExam !== null && daysToExam <= 2,
      hasLongAbsence: daysSinceLastStudy !== null && daysSinceLastStudy >= 5,
      targetScore: setup.targetScore,
    }
  }

  // ── ELEGIR ACCIÓN ─────────────────────────────────────────────

  private chooseAction(state: BrainState): BrainDecision['action'] {
    // Sin programa → crear
    if (!state.hasProgram) return 'create_program'

    // Emergencia → modo rescate
    if (state.isEmergency) return 'emergency_mode'

    // Ausencia larga → recuperar primero
    if (state.hasLongAbsence && state.completedSessions > 0) return 'recover_first'

    // Ya alcanzó el objetivo → consolidar
    if (state.currentDomain >= state.targetScore) return 'consolidate'

    // Verificar si necesita replanning
    const { mastery, memory, program } = this.context
    if (program && mastery) {
      const trigger = shouldFullReplan(program, mastery, memory, state.completedSessions)
      if (trigger.shouldReplan) return 'replan_program'
    }

    return 'continue_program'
  }

  // ── DECISIÓN: CREAR PROGRAMA ──────────────────────────────────

  private decideCreateProgram(state: BrainState): BrainDecision {
    const { mastery, memory, setup } = this.context

    const strategy = this.buildEnrichedStrategy(state)
    const program = this.generateProgram(strategy, mastery, setup)
    const narrative = buildStrategyNarrative(strategy, program, memory)
    const bestSeq = this.getBestSequence(strategy)
    const domainEstimate = this.calculateDomainEstimate(state, mastery)
    const phases = assignPhasesToSessions(program.sessions)
    const projection = this.buildProjection(state, strategy, program)

    return {
      action: 'create_program',
      reasoning: `Nuevo programa creado con estrategia ${strategy.type}`,
      userMessage: narrative.programCreated.explanation,
      program,
      strategy,
      narrative,
      recommendedSequence: bestSeq.sequence,
      sequenceRationale: bestSeq.rationale,
      domainEstimate,
      phases,
      urgentReviews: [],
      atRiskConcepts: [],
      projection,
      isOnPlateau: false,
      hasConflict: strategy.conflictDetected ?? false,
      conflictMessage: strategy.conflictMessage,
      realisticTarget: strategy.realisticTarget,
      adaptationMode: getAdaptationAggressiveness(domainEstimate!),
      decidedAt: Date.now(),
      confidence: strategy.confidenceLevel,
    }
  }

  // ── DECISIÓN: EMERGENCIA ──────────────────────────────────────

  private decideEmergency(state: BrainState): BrainDecision {
    const { mastery, memory, setup, program } = this.context

    const emergencySetup: AdaptiveProgramSetup = {
      ...setup,
      dailyMinutes: Math.min(setup.dailyMinutes, 25),
    }
    const strategy = buildStudyStrategy(mastery, emergencySetup, memory)
    const finalProgram = this.generateProgram(strategy, mastery, emergencySetup)
    const narrative = buildStrategyNarrative(strategy, finalProgram, memory)
    const domainEstimate = this.calculateDomainEstimate(state, mastery)
    const phases = assignPhasesToSessions(finalProgram.sessions)

    return {
      action: 'emergency_mode',
      reasoning: `Examen en ${state.daysToExam} días. Activando modo de emergencia.`,
      userMessage: state.daysToExam === 0
        ? 'Tu examen es hoy. Vamos directo a lo esencial.'
        : `Tu examen es mañana. Plan de rescate activado.`,
      program: finalProgram,
      strategy,
      narrative,
      recommendedSequence: ['analisis', 'flashcards', 'examen'],
      sequenceRationale: 'Máxima densidad de aprendizaje para el tiempo disponible.',
      domainEstimate,
      phases,
      urgentReviews: [],
      atRiskConcepts: [],
      projection: this.buildProjection(state, strategy, finalProgram),
      isOnPlateau: false,
      hasConflict: false,
      adaptationMode: 'aggressive',
      decidedAt: Date.now(),
      confidence: 75,
    }
  }

  // ── DECISIÓN: RECUPERACIÓN ────────────────────────────────────

  private decideRecovery(state: BrainState): BrainDecision {
    const { mastery, memory, setup, forgettingProfiles } = this.context

    const urgentReviews = forgettingProfiles
      ? getConceptsDueForReview(forgettingProfiles, 60).slice(0, 5).map(p => ({
          conceptName: p.conceptName,
          urgency: p.urgency,
        }))
      : []

    const strategy = buildStudyStrategy(mastery, setup, memory)
    const program = this.generateProgram(strategy, mastery, setup)
    const domainEstimate = this.calculateDomainEstimate(state, mastery)
    const phases = assignPhasesToSessions(program.sessions)

    return {
      action: 'recover_first',
      reasoning: `Ausencia de ${state.daysSinceLastStudy} días detectada.`,
      userMessage: `Llevas ${state.daysSinceLastStudy} días sin estudiar. Antes de avanzar, vamos a recuperar lo que el tiempo se pudo llevar.`,
      program,
      strategy,
      narrative: buildStrategyNarrative(strategy, program, memory),
      recommendedSequence: ['flashcards', 'quiz', 'alai'],
      sequenceRationale: 'Recuperación: primero memoria, luego verificación.',
      domainEstimate,
      phases,
      urgentReviews,
      atRiskConcepts: [],
      projection: this.buildProjection(state, strategy, program),
      isOnPlateau: false,
      hasConflict: false,
      adaptationMode: 'moderate',
      decidedAt: Date.now(),
      confidence: 80,
    }
  }

  // ── DECISIÓN: CONSOLIDAR ──────────────────────────────────────

  private decideConsolidate(state: BrainState): BrainDecision {
    const { mastery, memory, setup, program } = this.context

    const strategy = buildStudyStrategy(mastery, setup, memory)
    const finalProgram = program || this.generateProgram(strategy, mastery, setup)
    const domainEstimate = this.calculateDomainEstimate(state, mastery)
    const phases = assignPhasesToSessions(finalProgram.sessions)

    return {
      action: 'consolidate',
      reasoning: `Dominio ${state.currentDomain}% >= objetivo ${state.targetScore}%.`,
      userMessage: `Alcanzaste tu objetivo de ${state.targetScore}%. Solo falta confirmar que el dominio sea estable.`,
      program: finalProgram,
      strategy,
      narrative: buildStrategyNarrative(strategy, finalProgram, memory),
      recommendedSequence: ['examen', 'alai'],
      sequenceRationale: 'Consolidación: verificar sin introducir material nuevo.',
      domainEstimate,
      phases,
      urgentReviews: [],
      atRiskConcepts: [],
      projection: this.buildProjection(state, strategy, finalProgram),
      isOnPlateau: false,
      hasConflict: false,
      adaptationMode: 'conservative',
      decidedAt: Date.now(),
      confidence: 92,
    }
  }

  // ── DECISIÓN: REPLANIFICAR ────────────────────────────────────

  private decideReplan(state: BrainState): BrainDecision {
    const { mastery, memory, setup, program, knowledgeGraph } = this.context

    const trigger = shouldFullReplan(
      program!, mastery, memory, state.completedSessions
    )

    const replanned = fullReplanProgram(program!, mastery, memory, trigger)
    const strategy = replanned.strategy || buildStudyStrategy(mastery, setup, memory)
    const narrative = buildStrategyNarrative(
      strategy, replanned, memory,
      program?.strategy
    )

    // Knowledge Graph: conceptos en riesgo por dependencias
    const failedConcepts = mastery?.concepts
      .filter(c => c.mistakes >= 2)
      .map(c => c.id) || []

    const atRiskConcepts = knowledgeGraph
      ? inferAtRiskConcepts(knowledgeGraph, failedConcepts).slice(0, 4).map(r => ({
          conceptName: r.conceptName,
          riskScore: r.riskScore,
          reason: r.reason,
        }))
      : []

    // Plateau check
    const domainHistory = mastery?.timeline?.slice(-5).map(t => t.overallMastery) || []
    const plateau = detectPlateau(domainHistory)

    const domainEstimate = this.calculateDomainEstimate(state, mastery)
    const phases = assignPhasesToSessions(replanned.sessions)
    const bestSeq = this.getBestSequence(strategy)

    return {
      action: 'replan_program',
      reasoning: trigger.reason,
      userMessage: trigger.reason,
      program: replanned,
      strategy,
      narrative,
      recommendedSequence: bestSeq.sequence,
      sequenceRationale: bestSeq.rationale,
      domainEstimate,
      phases,
      urgentReviews: [],
      atRiskConcepts,
      projection: this.buildProjection(state, strategy, replanned),
      isOnPlateau: plateau.isOnPlateau,
      plateauMessage: plateau.recommendation,
      hasConflict: strategy.conflictDetected ?? false,
      conflictMessage: strategy.conflictMessage,
      realisticTarget: strategy.realisticTarget,
      adaptationMode: getAdaptationAggressiveness(domainEstimate!),
      decidedAt: Date.now(),
      confidence: strategy.confidenceLevel,
    }
  }

  // ── DECISIÓN: CONTINUAR ───────────────────────────────────────

  private decideContinue(state: BrainState): BrainDecision {
    const { mastery, memory, program, setup, knowledgeGraph, forgettingProfiles } = this.context

    const strategy = program?.strategy || buildStudyStrategy(mastery, setup, memory)

    // Conceptos urgentes de repasar
    const urgentReviews = forgettingProfiles
      ? getConceptsDueForReview(forgettingProfiles, 65).slice(0, 4).map(p => ({
          conceptName: p.conceptName,
          urgency: p.urgency,
        }))
      : []

    // Conceptos en riesgo por dependencias
    const failedConcepts = mastery?.concepts
      .filter(c => c.mistakes >= 2)
      .map(c => c.id) || []

    const atRiskConcepts = knowledgeGraph
      ? inferAtRiskConcepts(knowledgeGraph, failedConcepts).slice(0, 3).map(r => ({
          conceptName: r.conceptName,
          riskScore: r.riskScore,
          reason: r.reason,
        }))
      : []

    // Plateau check
    const domainHistory = mastery?.timeline?.slice(-5).map(t => t.overallMastery) || []
    const plateau = detectPlateau(domainHistory)

    const domainEstimate = this.calculateDomainEstimate(state, mastery)
    const phases = program ? assignPhasesToSessions(program.sessions) : []
    const bestSeq = this.getBestSequence(strategy)

    const currentSession = program ? getCurrentSession(program) : null
    const sessionMessage = currentSession
      ? `Sesión de hoy: "${currentSession.title}". ${currentSession.objective}`
      : 'Continúa con tu programa de estudio.'

    return {
      action: 'continue_program',
      reasoning: 'El programa sigue siendo válido. Continuar.',
      userMessage: sessionMessage,
      program: program!,
      strategy,
      narrative: buildStrategyNarrative(strategy, program!, memory),
      recommendedSequence: bestSeq.sequence,
      sequenceRationale: bestSeq.rationale,
      domainEstimate,
      phases,
      urgentReviews,
      atRiskConcepts,
      projection: this.buildProjection(state, strategy, program!),
      isOnPlateau: plateau.isOnPlateau,
      plateauMessage: plateau.recommendation,
      hasConflict: false,
      adaptationMode: getAdaptationAggressiveness(domainEstimate!),
      decidedAt: Date.now(),
      confidence: strategy.confidenceLevel,
    }
  }

  // ── HELPERS PRIVADOS ──────────────────────────────────────────

  private buildEnrichedStrategy(state: BrainState): StudyStrategy {
    const { mastery, memory, setup } = this.context
    const base = buildStudyStrategy(mastery, setup, memory)
    return enrichStrategyWithUtility(
      base, mastery, memory,
      setup.dailyMinutes,
      setup.targetScore,
      state.daysToExam,
    )
  }

  private generateProgram(
    strategy: StudyStrategy,
    mastery: MaterialMastery | null,
    setup: AdaptiveProgramSetup,
  ): AdaptiveProgram {
    // Import dinámico para evitar circular dependency
    const { generateAdaptiveProgram } = require('./generator')
    return generateAdaptiveProgram(mastery, setup)
  }

  private getBestSequence(strategy: StudyStrategy): {
    sequence: string[]
    rationale: string
  } {
    const { memory } = this.context
    const pattern = memory?.dominantPattern || 'unknown'

    if (strategy.learnedSequence && strategy.sequenceConfidence && strategy.sequenceConfidence > 50) {
      return {
        sequence: strategy.learnedSequence,
        rationale: `Secuencia aprendida de tu historial (confianza: ${strategy.sequenceConfidence}%).`,
      }
    }

    const defaultSeq = DEFAULT_SEQUENCES[pattern as keyof typeof DEFAULT_SEQUENCES]
      || strategy.recommendedEngines.slice(0, 3)

    return {
      sequence: defaultSeq,
      rationale: memory?.dominantPattern !== 'unknown'
        ? `Optimizada para tu perfil: ${PATTERN_LABELS[pattern as keyof typeof PATTERN_LABELS]}.`
        : 'Secuencia estándar optimizada para este nivel.',
    }
  }

  private calculateDomainEstimate(
    state: BrainState,
    mastery: MaterialMastery | null,
  ): DomainEstimate {
    if (!mastery) {
      return calculateDomainEstimate(state.currentDomain, 0, 0, 0, 0)
    }

    const totalEvents = mastery.timeline?.length || 0
    const correctEvents = mastery.concepts.reduce((sum, c) =>
      sum + (c.attempts - c.mistakes), 0
    )
    const totalConcepts = mastery.concepts.length
    const coveredConcepts = mastery.concepts.filter(c => c.attempts > 0).length
    const coverageRatio = totalConcepts > 0 ? coveredConcepts / totalConcepts : 0

    const scores = mastery.concepts
      .filter(c => c.previousScores.length >= 2)
      .map(c => {
        const diffs = c.previousScores.slice(1).map((s, i) =>
          Math.abs(s - c.previousScores[i])
        )
        return diffs.reduce((a, b) => a + b, 0) / diffs.length
      })
    const avgVariance = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 50
    const consistencyScore = Math.max(0, 100 - avgVariance * 2)

    return calculateDomainEstimate(
      state.currentDomain,
      totalEvents,
      correctEvents,
      coverageRatio,
      consistencyScore,
    )
  }

  private buildProjection(
    state: BrainState,
    strategy: StudyStrategy,
    program: AdaptiveProgram,
  ): BrainDecision['projection'] {
    const avgGain = program.sessions.reduce((sum, s) => sum + s.expectedDomainGain, 0) /
                    Math.max(1, program.sessions.length)

    const sessionsPerDay = Math.max(1, Math.floor(state.daysToExam || 7 > 0
      ? state.daysToExam! / Math.max(1, program.sessions.length)
      : 1
    ))

    const proj = projectRealDomain(
      state.currentDomain,
      state.targetScore,
      avgGain,
      sessionsPerDay,
      program.sessions.filter(s => s.status !== 'completed').length + 3,
    )

    const afterNext = proj.sessionBySession[1] ?? state.currentDomain

    // Estimar sesiones para alcanzar objetivo
    let sessionsToTarget: number | null = null
    for (let i = 0; i < proj.sessionBySession.length; i++) {
      if (proj.sessionBySession[i] >= state.targetScore) {
        sessionsToTarget = i
        break
      }
    }

    return {
      currentDomain: state.currentDomain,
      afterNextSession: afterNext,
      toReachTarget: sessionsToTarget,
      isTargetReachable: proj.isTargetReachable,
    }
  }
}
