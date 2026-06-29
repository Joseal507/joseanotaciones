// ═══════════════════════════════════════════════════════════════
// StudyAL — Uncertainty Model
// "Dominio 72%" no dice lo mismo con 3 evidencias que con 80.
// Este modelo distingue entre lo que el estudiante sabe
// y lo que el sistema está seguro de saber sobre el estudiante.
// ═══════════════════════════════════════════════════════════════

export type ConfidenceLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high'

export interface DomainEstimate {
  pointEstimate: number      // El dominio que mostramos (ej: 72%)
  lowerBound: number         // Intervalo de confianza inferior
  upperBound: number         // Intervalo de confianza superior
  confidence: ConfidenceLevel
  confidenceScore: number    // 0-100
  evidenceCount: number
  message: string
  recommendation: string
}

// ── Calcular estimación con incertidumbre ────────────────────────
export function calculateDomainEstimate(
  observedScore: number,
  evidenceCount: number,
  correctCount: number,
  coverageRatio: number,       // qué % del material fue evaluado (0-1)
  consistencyScore: number,    // qué tan consistentes son las respuestas (0-100)
): DomainEstimate {
  // Con poca evidencia, el intervalo es amplio
  const evidenceFactor = Math.min(1, evidenceCount / 20)
  const interval = Math.round((1 - evidenceFactor) * 30)

  const lowerBound = Math.max(0, observedScore - interval)
  const upperBound = Math.min(100, observedScore + interval)

  // Score de confianza combinado
  const evidenceScore = Math.min(100, evidenceCount * 5)
  const coverageScore = coverageRatio * 100
  const consistencyContrib = consistencyScore * 0.3

  const confidenceScore = Math.round(
    evidenceScore * 0.4 + coverageScore * 0.3 + consistencyContrib
  )

  const confidence: ConfidenceLevel =
    confidenceScore >= 85 ? 'very_high' :
    confidenceScore >= 65 ? 'high' :
    confidenceScore >= 45 ? 'medium' :
    confidenceScore >= 25 ? 'low' : 'very_low'

  const messages: Record<ConfidenceLevel, string> = {
    very_high: `Basado en ${evidenceCount} evaluaciones con alta cobertura. Este número es confiable.`,
    high: `Buena evidencia (${evidenceCount} evaluaciones). El número refleja bien tu dominio.`,
    medium: `Evidencia moderada (${evidenceCount} evaluaciones). Estimación razonable.`,
    low: `Poca evidencia (${evidenceCount} evaluaciones). Necesitamos más preguntas.`,
    very_low: `Casi sin evidencia (${evidenceCount} evaluaciones). Este número es solo una estimación inicial.`,
  }

  const recommendations: Record<ConfidenceLevel, string> = {
    very_high: 'El modelo tiene alta certeza sobre tu nivel.',
    high: 'El modelo tiene buena certeza. Sigue practicando para confirmarlo.',
    medium: 'Haz más preguntas para que el modelo calibre mejor tu nivel.',
    low: 'Se necesitan más evaluaciones antes de tomar decisiones pedagógicas importantes.',
    very_low: 'No hagas planes basados en este número todavía. Necesitamos mucha más evidencia.',
  }

  return {
    pointEstimate: observedScore,
    lowerBound,
    upperBound,
    confidence,
    confidenceScore,
    evidenceCount,
    message: messages[confidence],
    recommendation: recommendations[confidence],
  }
}

// ── Decidir si confiar en el dominio para adaptar ────────────────
export function shouldTrustDomainForAdaptation(estimate: DomainEstimate): boolean {
  return estimate.confidenceScore >= 40
}

// ── Ajustar agresividad de la adaptación según incertidumbre ─────
// Con poca confianza, ALAI debe ser más conservador
export function getAdaptationAggressiveness(
  estimate: DomainEstimate,
): 'conservative' | 'moderate' | 'aggressive' {
  if (estimate.confidenceScore >= 70) return 'aggressive'
  if (estimate.confidenceScore >= 40) return 'moderate'
  return 'conservative'
}

// ── Generar texto para mostrar al usuario ─────────────────────────
export function formatDomainWithUncertainty(estimate: DomainEstimate): string {
  if (estimate.confidence === 'very_high' || estimate.confidence === 'high') {
    return `${estimate.pointEstimate}%`
  }
  return `~${estimate.pointEstimate}%`
}

// ── Calcular confianza del modelo sobre un concepto específico ────
export interface ConceptUncertainty {
  conceptId: string
  estimated: number
  confident: boolean
  reason: string
}

export function assessConceptUncertainty(
  conceptDomain: number,
  attempts: number,
  mistakes: number,
  lastReviewedHoursAgo: number | null,
): ConceptUncertainty {
  // Poco intentado → poca confianza
  if (attempts < 2) {
    return {
      conceptId: '',
      estimated: conceptDomain,
      confident: false,
      reason: 'Muy pocas evaluaciones para estar seguros.',
    }
  }

  // Muchos errores recientes → el dominio mostrado es optimista
  const errorRate = mistakes / Math.max(1, attempts)
  if (errorRate > 0.5) {
    return {
      conceptId: '',
      estimated: conceptDomain,
      confident: false,
      reason: 'Alta tasa de errores. El dominio real puede ser menor.',
    }
  }

  // No revisado en mucho tiempo → el dominio decayó pero no lo sabemos
  if (lastReviewedHoursAgo !== null && lastReviewedHoursAgo > 72) {
    return {
      conceptId: '',
      estimated: conceptDomain,
      confident: false,
      reason: `No revisado en ${Math.round(lastReviewedHoursAgo / 24)} días. El olvido pudo reducirlo.`,
    }
  }

  return {
    conceptId: '',
    estimated: conceptDomain,
    confident: true,
    reason: 'Suficiente evidencia reciente.',
  }
}
