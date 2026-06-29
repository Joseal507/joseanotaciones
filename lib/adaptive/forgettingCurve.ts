// ═══════════════════════════════════════════════════════════════
// StudyAL — Individual Forgetting Curve
// Cada concepto tiene su propia curva de olvido.
// No todos olvidan igual. No todos los conceptos se olvidan igual.
// Basado en el modelo de memoria de Ebbinghaus + estabilidad dinámica
// ═══════════════════════════════════════════════════════════════

export interface ConceptForgettingProfile {
  conceptId: string
  conceptName: string

  // Parámetros individuales de la curva (aprenden durante el uso)
  stability: number        // días hasta olvidar el 50% — crece con cada repaso
  retrievability: number   // 0-100: qué tanto recuerda AHORA mismo
  halfLife: number         // días: cuánto tarda en perder la mitad del dominio

  // Historial de repasos
  reviews: Array<{
    timestamp: number
    score: number          // 0-100
    wasCorrect: boolean
    stabilityBefore: number
    stabilityAfter: number
  }>

  // Predicciones
  nextOptimalReview: number  // timestamp del momento ideal para repasar
  forgettingRisk: number     // 0-100 ahora mismo
  predictedScoreIn: {
    hours1: number
    hours6: number
    days1: number
    days3: number
    days7: number
    days14: number
  }
}

// ── Constantes del modelo ─────────────────────────────────────────
const MIN_STABILITY = 0.5    // días mínimos antes de olvidar
const MAX_STABILITY = 365    // días máximos (dominio perfecto)
const STABILITY_GAIN_CORRECT = 2.0    // multiplicador si responde bien
const STABILITY_GAIN_WRONG = 0.5      // penalización si falla

// ── Crear perfil de olvido para un concepto nuevo ────────────────
export function createForgettingProfile(
  conceptId: string,
  conceptName: string,
  initialScore: number,
): ConceptForgettingProfile {
  // Estabilidad inicial basada en el score
  const initialStability = Math.max(MIN_STABILITY, (initialScore / 100) * 3)

  return {
    conceptId,
    conceptName,
    stability: initialStability,
    retrievability: initialScore,
    halfLife: initialStability,
    reviews: [],
    nextOptimalReview: Date.now() + initialStability * 24 * 60 * 60 * 1000,
    forgettingRisk: 0,
    predictedScoreIn: calculatePredictions(initialScore, initialStability),
  }
}

// ── Calcular recuperabilidad actual ──────────────────────────────
// R(t) = e^(-t / S) donde t = tiempo desde último repaso, S = estabilidad
export function calculateRetrievability(
  lastScore: number,
  lastReviewTimestamp: number,
  stability: number,
): number {
  const hoursElapsed = (Date.now() - lastReviewTimestamp) / (1000 * 60 * 60)
  const daysElapsed = hoursElapsed / 24

  const retention = Math.exp(-daysElapsed / stability)
  return Math.round(lastScore * retention)
}

// ── Actualizar curva después de un repaso ────────────────────────
export function updateForgettingCurve(
  profile: ConceptForgettingProfile,
  score: number,
  wasCorrect: boolean,
): ConceptForgettingProfile {
  const now = Date.now()
  const stabilityBefore = profile.stability

  // Actualizar estabilidad según resultado
  let newStability: number
  if (wasCorrect) {
    // Cada respuesta correcta aumenta la estabilidad
    // Más efectivo si ya tenía alta estabilidad (espaciado óptimo)
    const timeFactor = profile.reviews.length > 0
      ? Math.min(2, (now - profile.reviews[profile.reviews.length - 1].timestamp) / (stabilityBefore * 24 * 60 * 60 * 1000))
      : 1
    newStability = Math.min(MAX_STABILITY, stabilityBefore * STABILITY_GAIN_CORRECT * (1 + timeFactor * 0.3))
  } else {
    // Error reduce la estabilidad
    newStability = Math.max(MIN_STABILITY, stabilityBefore * STABILITY_GAIN_WRONG)
  }

  // Calcular cuándo repasar próximamente
  // Óptimo: cuando la recuperabilidad cae al 90%
  const optimalDelay = newStability * Math.log(10 / 9) * 24 * 60 * 60 * 1000
  const nextReview = now + optimalDelay

  const newReview = {
    timestamp: now,
    score,
    wasCorrect,
    stabilityBefore,
    stabilityAfter: newStability,
  }

  const forgettingRisk = calculateForgettingRisk(score, newStability)

  return {
    ...profile,
    stability: newStability,
    retrievability: score,
    halfLife: newStability * Math.LN2,
    reviews: [...profile.reviews.slice(-19), newReview],
    nextOptimalReview: nextReview,
    forgettingRisk,
    predictedScoreIn: calculatePredictions(score, newStability),
  }
}

// ── Calcular riesgo de olvido actual ─────────────────────────────
function calculateForgettingRisk(lastScore: number, stability: number): number {
  const hoursElapsed = (Date.now() - Date.now()) / (1000 * 60 * 60)
  // Para conceptos recién revisados
  if (hoursElapsed < 1) return Math.max(0, 100 - lastScore)

  const retention = Math.exp(-hoursElapsed / 24 / stability)
  const currentScore = lastScore * retention
  return Math.round(Math.max(0, 100 - currentScore))
}

// ── Calcular predicciones de dominio futuro ───────────────────────
function calculatePredictions(
  currentScore: number,
  stability: number,
): ConceptForgettingProfile['predictedScoreIn'] {
  const predict = (hours: number) => {
    const days = hours / 24
    const retention = Math.exp(-days / stability)
    return Math.round(Math.max(0, currentScore * retention))
  }

  return {
    hours1: predict(1),
    hours6: predict(6),
    days1: predict(24),
    days3: predict(72),
    days7: predict(168),
    days14: predict(336),
  }
}

// ── Obtener conceptos que necesitan repaso ahora ─────────────────
export function getConceptsDueForReview(
  profiles: ConceptForgettingProfile[],
  urgencyThreshold: number = 70,  // % de riesgo para considerarlo urgente
): Array<ConceptForgettingProfile & { urgency: 'critical' | 'high' | 'medium' }> {
  return profiles
    .map(p => {
      const currentRetrievability = p.reviews.length > 0
        ? calculateRetrievability(
            p.reviews[p.reviews.length - 1].score,
            p.reviews[p.reviews.length - 1].timestamp,
            p.stability,
          )
        : p.retrievability

      const risk = 100 - currentRetrievability
      return { ...p, currentRisk: risk }
    })
    .filter(p => p.currentRisk >= urgencyThreshold)
    .sort((a, b) => b.currentRisk - a.currentRisk)
    .map(p => ({
      ...p,
      urgency: p.currentRisk >= 85 ? 'critical' as const :
               p.currentRisk >= 70 ? 'high' as const : 'medium' as const,
    }))
}

// ── Generar agenda de repasos para los próximos N días ───────────
export interface ReviewScheduleEntry {
  date: Date
  dayLabel: string
  concepts: Array<{
    conceptId: string
    conceptName: string
    predictedScore: number
    urgency: string
  }>
  estimatedMinutes: number
}

export function generateReviewSchedule(
  profiles: ConceptForgettingProfile[],
  days: number = 7,
): ReviewScheduleEntry[] {
  const schedule: ReviewScheduleEntry[] = []
  const now = Date.now()

  for (let d = 0; d < days; d++) {
    const dayStart = now + d * 24 * 60 * 60 * 1000
    const dayEnd = dayStart + 24 * 60 * 60 * 1000

    const dueConceptsThisDay = profiles.filter(
      p => p.nextOptimalReview >= dayStart && p.nextOptimalReview < dayEnd
    )

    if (dueConceptsThisDay.length === 0) continue

    const date = new Date(dayStart)
    const dayLabel = d === 0 ? 'Hoy' :
                     d === 1 ? 'Mañana' :
                     `En ${d} días`

    schedule.push({
      date,
      dayLabel,
      concepts: dueConceptsThisDay.map(p => ({
        conceptId: p.conceptId,
        conceptName: p.conceptName,
        predictedScore: p.predictedScoreIn.days1,
        urgency: p.forgettingRisk > 70 ? 'high' : 'medium',
      })),
      estimatedMinutes: Math.max(5, dueConceptsThisDay.length * 2),
    })
  }

  return schedule
}
