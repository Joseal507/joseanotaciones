// ═══════════════════════════════════════════════════════════════
// SIMULATED STUDENT MODEL
// Genera respuestas y telemetría sin usar los motores reales.
// El motor de StudyAL NUNCA lee latentState.
// ═══════════════════════════════════════════════════════════════

import type { SeededRandom } from './seededRandom'
import type { SimulatedStudentProfile, LatentMicroState, SimulatedResponse } from './types'
import type { AssistanceLevel } from '../../../lib/adaptive/v3/engine/confidenceTracker'
import type { InteractionContext } from '../../../lib/adaptive/v3/engine/evidenceEngine'
import type { MicroConcept } from '../../../lib/adaptive/v3/types'

const OPEN_FORMATS = new Set(['open_response', 'teach_back', 'explain_why', 'practical_case', 'step_by_step_solver'])
const QUICK_FORMATS = new Set(['multiple_choice', 'true_false'])

/** Inicializar estado latente de un micro */
export function initLatentMicroState(microId: string, profile: SimulatedStudentProfile, micro: MicroConcept, rng: SeededRandom): LatentMicroState {
  const baseKnowledge = profile.baseKnowledgeByType[micro.cognitiveType] ?? profile.defaultBaseKnowledge
  // Variación individual por micro (±15%)
  const variation = (rng.next() - 0.5) * 0.30
  const trueKnowledge = Math.max(0.02, Math.min(0.98, baseKnowledge + variation))

  return {
    microId,
    trueKnowledge,
    recallStrength: trueKnowledge * (0.8 + rng.next() * 0.4),
    transferAbility: trueKnowledge * (profile.id === 'memorizer_no_transfer' ? 0.25 : 0.75 + rng.next() * 0.25),
    integrationAbility: trueKnowledge * (0.7 + rng.next() * 0.3),
    misconceptionStrength: profile.id === 'high_confidence_misconception' ? 0.6 + rng.next() * 0.3 : rng.next() * 0.2,
    fatigue: 0,
    exposures: 0,
    lastExposureAtMs: 0,
  }
}

/** Aplicar olvido según tiempo virtual transcurrido */
export function applyForgetting(state: LatentMicroState, profile: SimulatedStudentProfile, elapsedMs: number): LatentMicroState {
  if (elapsedMs <= 0) return state
  const hours = elapsedMs / (1000 * 60 * 60)
  const forgettingFactor = Math.exp(-profile.forgettingRate * hours)
  return {
    ...state,
    trueKnowledge: state.trueKnowledge * forgettingFactor,
    recallStrength: state.recallStrength * forgettingFactor,
  }
}

/** Aplicar aprendizaje tras una exposición */
export function applyLearning(state: LatentMicroState, profile: SimulatedStudentProfile, wasCorrect: boolean, assistanceLevel: AssistanceLevel): LatentMicroState {
  if (!profile.canImprove) return { ...state, exposures: state.exposures + 1 }

  const assistanceBonus = assistanceLevel === 'revealed' ? 0.3
    : assistanceLevel === 'assisted' ? 0.5
    : assistanceLevel === 'guided' ? 0.7
    : assistanceLevel === 'minimal_hint' ? 0.85
    : 1.0

  const learningGain = wasCorrect
    ? profile.learningRate * 0.05 * assistanceBonus
    : profile.learningRate * 0.02  // aprender del error también

  return {
    ...state,
    trueKnowledge: Math.min(0.98, state.trueKnowledge + learningGain),
    recallStrength: Math.min(0.98, state.recallStrength + learningGain * 0.8),
    exposures: state.exposures + 1,
  }
}

/** Modelar el aprendizaje producido por una intervención pedagógica real. */
export function applyTeaching(
  state: LatentMicroState,
  profile: SimulatedStudentProfile,
): LatentMicroState {
  if (!profile.canImprove) return state

  const learningGain = profile.learningRate * 0.08 * (1 - state.trueKnowledge)
  return {
    ...state,
    trueKnowledge: Math.min(0.98, state.trueKnowledge + learningGain),
    recallStrength: Math.min(0.98, state.recallStrength + learningGain * 0.6),
    transferAbility: Math.min(0.98, state.transferAbility + learningGain * 0.25),
    integrationAbility: Math.min(0.98, state.integrationAbility + learningGain * 0.25),
    misconceptionStrength: Math.max(
      0,
      state.misconceptionStrength * (1 - profile.learningRate * 0.08),
    ),
  }
}

/** Calcular probabilidad de éxito dado el estado y contexto */
function computeSuccessProbability(
  state: LatentMicroState,
  profile: SimulatedStudentProfile,
  micro: MicroConcept,
  format: string,
  assistanceLevel: AssistanceLevel,
  interactionContext: InteractionContext,
  rng: SeededRandom,
): { pSuccess: number; pPartial: number; isGuess: boolean } {
  let base = state.trueKnowledge

  // Dificultad del micro (0-100 → factor 0.5-1.0)
  const difficultyFactor = 1.0 - (micro.difficulty / 200)
  base *= difficultyFactor

  // Formatos abiertos son más difíciles de adivinar
  if (OPEN_FORMATS.has(format)) {
    base *= 0.85
    // Transferencia requiere habilidad específica
    if (format === 'practical_case' || interactionContext === 'delayed_retrieval') {
      base *= state.transferAbility / Math.max(state.trueKnowledge, 0.01)
    }
  }

  // Ayuda aumenta probabilidad
  const assistanceBoost = assistanceLevel === 'revealed' ? 0.90
    : assistanceLevel === 'assisted' ? 0.35
    : assistanceLevel === 'guided' ? 0.20
    : assistanceLevel === 'minimal_hint' ? 0.10
    : 0.0

  base = Math.min(0.98, base + assistanceBoost)

  // Olvido temporal en spaced review
  if (interactionContext === 'spaced_review' || interactionContext === 'delayed_retrieval') {
    base *= (state.recallStrength / Math.max(state.trueKnowledge, 0.01))
  }

  // Fatiga reduce performance
  base *= (1 - state.fatigue * 0.3)

  // Misconception activa reduce en conceptos relacionados
  if (state.misconceptionStrength > 0.5) {
    base *= (1 - state.misconceptionStrength * 0.4)
  }

  // Guess en MCQ
  let isGuess = false
  if (QUICK_FORMATS.has(format) && rng.next() < profile.guessRate) {
    // 25% de acertar por azar en MCQ (4 opciones), 50% en TF
    const guessChance = format === 'true_false' ? 0.5 : 0.25
    isGuess = true
    return { pSuccess: guessChance, pPartial: 0, isGuess }
  }

  base = Math.max(0.02, Math.min(0.97, base))
  const pPartial = base * 0.2  // 20% del tiempo éxito parcial en lugar de total

  return { pSuccess: base, pPartial, isGuess }
}

/** Generar respuesta simulada completa */
export function generateResponse(params: {
  state: LatentMicroState
  profile: SimulatedStudentProfile
  micro: MicroConcept
  format: string
  objective: string
  assistanceLevelOverride?: AssistanceLevel
  virtualTimeMs: number
  sessionTurnIndex: number
  rng: SeededRandom
}): { response: SimulatedResponse; assistanceLevelUsed: AssistanceLevel } {
  const { state, profile, micro, format, virtualTimeMs, sessionTurnIndex, rng } = params

  // Decidir nivel de ayuda
  let assistanceLevel: AssistanceLevel = 'independent'

  if (params.assistanceLevelOverride) {
    assistanceLevel = params.assistanceLevelOverride
  } else if (rng.next() < profile.revealRate) {
    assistanceLevel = 'revealed'
  } else if (rng.next() < profile.hintUsageRate) {
    assistanceLevel = rng.next() < 0.5 ? 'minimal_hint' : 'guided'
  } else if (profile.id === 'assistance_dependent' && rng.next() < 0.4) {
    assistanceLevel = 'assisted'
  }

  // Calcular contexto de interacción
  const interactionContext: InteractionContext = sessionTurnIndex <= 2
    ? 'learning'
    : sessionTurnIndex <= 5
    ? 'immediate_practice'
    : rng.next() < 0.15 ? 'interleaving' : 'immediate_practice'

  // Calcular probabilidad de éxito
  const { pSuccess, pPartial, isGuess } = computeSuccessProbability(
    state, profile, micro, format, assistanceLevel, interactionContext, rng.fork(sessionTurnIndex),
  )

  // Determinar outcome
  let outcome: 'correct' | 'partial' | 'incorrect'
  let score: number
  const roll = rng.next()

  if (roll < pSuccess - pPartial) {
    outcome = 'correct'
    score = 80 + Math.round(rng.next() * 20)
  } else if (roll < pSuccess) {
    outcome = 'partial'
    score = 40 + Math.round(rng.next() * 30)
  } else {
    outcome = 'incorrect'
    score = Math.round(rng.next() * 25)
  }

  // Revealed siempre da correcto en el turno siguiente (pero NO cuenta como independiente)
  if (assistanceLevel === 'revealed') {
    outcome = 'correct'
    score = 85 + Math.round(rng.next() * 10)
  }

  // Tiempo de respuesta
  const baseTimes: Record<string, number> = {
    multiple_choice: 8000, true_false: 5000, fill_blank: 15000,
    matching: 25000, ordering: 20000, open_response: 45000,
    practical_case: 50000, step_by_step_solver: 60000,
  }
  const baseTime = baseTimes[format] || 12000
  const speedFactor = profile.responseSpeedMultiplier
  const knowledgeFactor = 2.0 - state.trueKnowledge  // más conocimiento = más rápido
  const responseTimeMs = Math.round(baseTime * speedFactor * knowledgeFactor * (0.7 + rng.next() * 0.6))

  // Confianza autorreportada
  let selfReportedConfidence: number | undefined = undefined
  // Solo reportar el 70% del tiempo (simula que no siempre lo ponen)
  if (rng.next() < 0.70) {
    const trueConfidence = state.trueKnowledge * 100
    const calibrated = trueConfidence + (profile.confidenceCalibration * 100)
    const noise = (rng.next() - 0.5) * 30
    selfReportedConfidence = Math.round(Math.max(0, Math.min(100, calibrated + noise)))
    // Redondear a múltiplos de 20 (botones: 20, 40, 60, 80, 100)
    selfReportedConfidence = Math.round(selfReportedConfidence / 20) * 20
  }

  const elapsedSinceLastExposureMs = state.lastExposureAtMs > 0
    ? Math.max(0, virtualTimeMs - state.lastExposureAtMs)
    : undefined

  // Fatiga aumenta con el tiempo en sesión
  const fatigueFactor = Math.min(0.8, sessionTurnIndex * 0.02)

  return {
    response: {
      outcome,
      score,
      responseTimeMs,
      assistanceLevel,
      selfReportedConfidence,
      interactionContext,
      attemptNumber: state.exposures + 1,
      wasRetry: state.exposures > 0,
      elapsedSinceLastExposureMs,
      _latentKnowledgeAtTime: state.trueKnowledge,
      _wasGuess: isGuess,
    },
    assistanceLevelUsed: assistanceLevel,
  }
}
