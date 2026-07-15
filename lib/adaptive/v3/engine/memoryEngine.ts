// ═══════════════════════════════════════════════════════════════
// MEMORY ENGINE — Modelo de memoria y olvido
//
// Implementa una versión simplificada del algoritmo FSRS
// (Free Spaced Repetition Scheduler) adaptada al contexto de StudyAL.
//
// Conceptos clave:
// - Stability (S): cuántos días dura el recuerdo antes de caer al 90%
// - Difficulty (D): qué tan difícil es el micro para este estudiante (1-10)
// - Retrievability (R): probabilidad actual de recordar (0.0-1.0)
// - nextReviewAt: cuándo debe reaparecer para spaced retrieval
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface MemoryState {
  microId: string
  // Modelo FSRS simplificado
  stability: number           // días hasta caer a 90% de retrievability
  difficulty: number          // 1-10 (1=trivial, 10=muy difícil para este estudiante)
  retrievability: number      // 0.0-1.0 probabilidad actual de recordar
  // Historial
  lastReviewAt: number        // timestamp del último repaso
  nextReviewAt: number        // timestamp del próximo repaso ideal
  successfulRetrievals: number
  failedRetrievals: number
  totalReviews: number
  // Calidad del último intento
  lastGrade: ReviewGrade      // 0-4 escala tipo Anki
  streak: number              // racha de correctas consecutivas
}

export type ReviewGrade =
  | 0  // Again: olvidó completamente
  | 1  // Hard: recordó con mucha dificultad
  | 2  // Good: recordó con esfuerzo normal
  | 3  // Easy: recordó fácilmente
  | 4  // Perfect: recordó instantáneamente, podría transferir

// ═══════════════════════════════════════════════════════════════
// CONSTANTES DEL MODELO
// ═══════════════════════════════════════════════════════════════

// Factor de retención objetivo (queremos que el estudiante recuerde con 90% de probabilidad)
const TARGET_RETRIEVABILITY = 0.90

// Intervalo inicial según dificultad y calidad
const INITIAL_INTERVALS: Record<ReviewGrade, number> = {
  0: 0.25,   // 6 horas
  1: 1,      // 1 día
  2: 3,      // 3 días
  3: 7,      // 1 semana
  4: 14,     // 2 semanas
}

// ═══════════════════════════════════════════════════════════════
// CREAR ESTADO DE MEMORIA INICIAL
// ═══════════════════════════════════════════════════════════════
export function createInitialMemoryState(microId: string, difficulty: number = 5): MemoryState {
  const now = Date.now()
  return {
    microId,
    stability: 1,              // 1 día inicial
    difficulty: Math.min(10, Math.max(1, difficulty)),
    retrievability: 1.0,       // Recién aprendido
    lastReviewAt: now,
    nextReviewAt: now + 24 * 60 * 60 * 1000,  // Mañana
    successfulRetrievals: 0,
    failedRetrievals: 0,
    totalReviews: 0,
    lastGrade: 2,
    streak: 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR RETRIEVABILITY ACTUAL (curva de olvido exponencial)
// R(t) = e^(-t/S) donde t = días desde último repaso, S = stability
// ═══════════════════════════════════════════════════════════════
export function calculateRetrievability(state: MemoryState): number {
  const now = Date.now()
  const daysSinceReview = (now - state.lastReviewAt) / (1000 * 60 * 60 * 24)
  const r = Math.exp(-daysSinceReview / state.stability)
  return Math.max(0, Math.min(1, r))
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR MEMORIA DESPUÉS DE UN REPASO
// ═══════════════════════════════════════════════════════════════
export function updateMemoryAfterReview(
  state: MemoryState,
  grade: ReviewGrade,
  assistanceLevel: 'independent' | 'hinted' | 'guided' | 'revealed' = 'independent',
): MemoryState {
  const now = Date.now()

  // Ajustar grade según nivel de ayuda
  // Si necesitó ayuda, la calidad real es menor
  const effectiveGrade: ReviewGrade = Math.max(0, grade - (
    assistanceLevel === 'hinted' ? 0 :
    assistanceLevel === 'guided' ? 1 :
    assistanceLevel === 'revealed' ? 2 : 0
  )) as ReviewGrade

  const currentR = calculateRetrievability(state)
  const daysSinceReview = (now - state.lastReviewAt) / (1000 * 60 * 60 * 24)

  // Actualizar dificultad según el rendimiento
  // Si le cuesta más de lo esperado → aumentar dificultad
  // Si le resulta fácil → disminuir dificultad
  const expectedGrade = 2  // "Good" como baseline
  const difficultyDelta = (expectedGrade - effectiveGrade) * 0.3
  const newDifficulty = Math.min(10, Math.max(1, state.difficulty + difficultyDelta))

  // Actualizar stability (estabilidad del recuerdo)
  let newStability: number

  if (effectiveGrade === 0) {
    // Olvidó completamente → reset de estabilidad
    newStability = INITIAL_INTERVALS[0]
  } else if (effectiveGrade === 1) {
    // Dificultad alta → pequeño incremento
    newStability = Math.max(state.stability * 0.8, 1)
  } else {
    // Recordó bien → incremento según fórmula FSRS simplificada
    const retrievabilityBonus = currentR > 0.9 ? 1.1 : 1.0  // Bonus si recordó muy bien
    const difficultyFactor = (11 - newDifficulty) / 10      // Conceptos difíciles crecen más lento
    const gradeFactor = effectiveGrade === 4 ? 1.5 : effectiveGrade === 3 ? 1.3 : 1.1

    newStability = state.stability * gradeFactor * difficultyFactor * retrievabilityBonus
    newStability = Math.min(365, Math.max(1, newStability))  // Cap: 1 año máximo
  }

  // Calcular próximo repaso
  // nextReview = stability * ln(TARGET_RETRIEVABILITY) / ln(1) — simplificado
  const daysUntilNextReview = newStability * (Math.log(TARGET_RETRIEVABILITY) / Math.log(0.9))
  const nextReviewAt = now + daysUntilNextReview * 24 * 60 * 60 * 1000

  const successful = effectiveGrade >= 2
  const newStreak = successful ? state.streak + 1 : 0

  return {
    ...state,
    stability: Math.round(newStability * 10) / 10,
    difficulty: Math.round(newDifficulty * 10) / 10,
    retrievability: successful ? Math.min(1.0, currentR * 1.1 + 0.1) : Math.max(0, currentR - 0.3),
    lastReviewAt: now,
    nextReviewAt: Math.round(nextReviewAt),
    successfulRetrievals: successful ? state.successfulRetrievals + 1 : state.successfulRetrievals,
    failedRetrievals: !successful ? state.failedRetrievals + 1 : state.failedRetrievals,
    totalReviews: state.totalReviews + 1,
    lastGrade: effectiveGrade,
    streak: newStreak,
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVERTIR OUTCOME DEL TUTOR → GRADE DEL MODELO DE MEMORIA
// ═══════════════════════════════════════════════════════════════
export function outcomeToGrade(
  outcome: 'correct' | 'partial' | 'incorrect',
  score: number,
  confidenceMultiplier: number = 1.0,
): ReviewGrade {
  if (outcome === 'incorrect') return 0
  if (outcome === 'partial') {
    return score >= 60 ? 1 : 0
  }
  // Correcto
  if (score >= 95 && confidenceMultiplier >= 1.0) return 4  // Perfect
  if (score >= 85 && confidenceMultiplier >= 0.7) return 3  // Easy
  if (score >= 70) return 2                                  // Good
  return 1                                                   // Hard (respondió bien pero con duda)
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR MICROS QUE NECESITAN REPASO URGENTE
// ═══════════════════════════════════════════════════════════════
export function getMicrosNeedingReview(
  memoryStates: Record<string, MemoryState>,
  options: {
    urgencyThreshold?: number    // retrievability < threshold = urgente (default: 0.7)
    maxCount?: number            // cuántos devolver (default: 5)
    includeNotDue?: boolean      // incluir aunque no sea la fecha (default: false)
  } = {},
): Array<{ microId: string; retrievability: number; urgency: 'critical' | 'high' | 'medium'; daysOverdue: number }> {
  const {
    urgencyThreshold = 0.7,
    maxCount = 5,
    includeNotDue = false,
  } = options

  const now = Date.now()
  const results: Array<{
    microId: string
    retrievability: number
    urgency: 'critical' | 'high' | 'medium'
    daysOverdue: number
  }> = []

  for (const [microId, state] of Object.entries(memoryStates)) {
    const currentR = calculateRetrievability(state)
    const isDue = now >= state.nextReviewAt
    const daysOverdue = Math.max(0, (now - state.nextReviewAt) / (1000 * 60 * 60 * 24))

    if (!isDue && !includeNotDue && currentR > urgencyThreshold) continue
    if (state.totalReviews === 0) continue  // Nunca revisado = no en memoria aún

    const urgency: 'critical' | 'high' | 'medium' =
      currentR < 0.5 ? 'critical' :
      currentR < 0.7 ? 'high' : 'medium'

    results.push({ microId, retrievability: currentR, urgency, daysOverdue })
  }

  // Ordenar: críticos primero, luego por retrievability ascendente
  return results
    .sort((a, b) => {
      const urgencyOrder = { critical: 0, high: 1, medium: 2 }
      if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) {
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency]
      }
      return a.retrievability - b.retrievability
    })
    .slice(0, maxCount)
}

// ═══════════════════════════════════════════════════════════════
// PREDECIR OLVIDO FUTURO
// ═══════════════════════════════════════════════════════════════
export function predictForgetting(
  state: MemoryState,
  daysAhead: number[],
): Record<number, number> {
  const result: Record<number, number> = {}
  const now = Date.now()

  for (const days of daysAhead) {
    const futureTime = now + days * 24 * 60 * 60 * 1000
    const daysSinceReview = (futureTime - state.lastReviewAt) / (1000 * 60 * 60 * 24)
    const r = Math.exp(-daysSinceReview / state.stability)
    result[days] = Math.round(Math.max(0, Math.min(1, r)) * 100) / 100
  }

  return result
}

// ═══════════════════════════════════════════════════════════════
// INTERVALO ÓPTIMO PARA EL PRÓXIMO REPASO
// ═══════════════════════════════════════════════════════════════
export function getOptimalReviewInterval(state: MemoryState): {
  days: number
  label: string
  retrievabilityAtReview: number
} {
  // Cuántos días hasta que la retrievability caiga al 90%
  const days = state.stability * (Math.log(0.9) / Math.log(Math.E)) * -1
  const safedays = Math.max(1, Math.round(days))

  const label =
    safedays <= 1 ? 'Mañana' :
    safedays <= 3 ? `En ${safedays} días` :
    safedays <= 7 ? `En ${safedays} días` :
    safedays <= 14 ? `En ${Math.round(safedays / 7)} semana(s)` :
    safedays <= 30 ? `En ${Math.round(safedays / 7)} semanas` :
    `En ${Math.round(safedays / 30)} mes(es)`

  // Retrievability en ese momento
  const retrievabilityAtReview = Math.exp(-safedays / state.stability)

  return {
    days: safedays,
    label,
    retrievabilityAtReview: Math.round(retrievabilityAtReview * 100) / 100,
  }
}

// ═══════════════════════════════════════════════════════════════
// RESUMEN DEL ESTADO DE MEMORIA DEL ESTUDIANTE
// ═══════════════════════════════════════════════════════════════
export function getMemorySummary(memoryStates: Record<string, MemoryState>): {
  totalTracked: number
  strongMemory: number     // retrievability >= 0.9
  goodMemory: number       // retrievability 0.7-0.9
  weakMemory: number       // retrievability 0.5-0.7
  forgetting: number       // retrievability < 0.5
  overdueCount: number     // ya deberían haberse repasado
  avgStability: number     // días promedio de estabilidad
  avgDifficulty: number    // dificultad promedio
} {
  const now = Date.now()
  const states = Object.values(memoryStates)

  if (states.length === 0) {
    return {
      totalTracked: 0,
      strongMemory: 0,
      goodMemory: 0,
      weakMemory: 0,
      forgetting: 0,
      overdueCount: 0,
      avgStability: 0,
      avgDifficulty: 5,
    }
  }

  let strong = 0, good = 0, weak = 0, forgetting = 0, overdue = 0
  let totalStability = 0, totalDifficulty = 0

  for (const state of states) {
    const r = calculateRetrievability(state)
    if (r >= 0.9) strong++
    else if (r >= 0.7) good++
    else if (r >= 0.5) weak++
    else forgetting++

    if (now >= state.nextReviewAt) overdue++
    totalStability += state.stability
    totalDifficulty += state.difficulty
  }

  return {
    totalTracked: states.length,
    strongMemory: strong,
    goodMemory: good,
    weakMemory: weak,
    forgetting,
    overdueCount: overdue,
    avgStability: Math.round(totalStability / states.length * 10) / 10,
    avgDifficulty: Math.round(totalDifficulty / states.length * 10) / 10,
  }
}
