// ═══════════════════════════════════════════════════════════════
// StudyAL — Domain Model
// El dominio no es lineal. Subir de 20 a 30 es distinto
// que subir de 90 a 100. Esta función lo modela correctamente.
// ═══════════════════════════════════════════════════════════════

// ── Curva de aprendizaje no lineal ───────────────────────────────
// Basada en la curva de Ebbinghaus + zona de desarrollo próximo
export function applyNonLinearGain(
  currentDomain: number,
  rawGain: number,
): number {
  // El dominio se vuelve exponencialmente más difícil de subir
  // 0-50: multiplicador 1.2 (sube rápido)
  // 50-75: multiplicador 1.0 (normal)
  // 75-90: multiplicador 0.65 (lento)
  // 90-100: multiplicador 0.3 (muy lento)
  const multiplier =
    currentDomain < 50 ? 1.2 :
    currentDomain < 75 ? 1.0 :
    currentDomain < 90 ? 0.65 : 0.3

  const adjusted = rawGain * multiplier
  return Math.min(100, Math.round(currentDomain + adjusted))
}

// ── Confianza estadística del dominio ────────────────────────────
export type DomainConfidence = 'very_low' | 'low' | 'medium' | 'high' | 'very_high'

export interface DomainWithConfidence {
  domain: number
  confidence: DomainConfidence
  confidenceScore: number    // 0-100
  evidenceCount: number
  message: string
}

export function calculateDomainConfidence(
  domain: number,
  totalEvidenceEvents: number,   // cuántas veces respondió
  correctEvents: number,         // cuántas veces acertó
  totalConcepts: number,         // cuántos conceptos tiene el material
  conceptsCovered: number,       // cuántos conceptos han sido evaluados
): DomainWithConfidence {
  // Confianza sube con más evidencia
  const coverageRatio = totalConcepts > 0 ? conceptsCovered / totalConcepts : 0
  const evidenceScore = Math.min(100, totalEvidenceEvents * 4)
  const coverageScore = coverageRatio * 100
  const accuracyScore = totalEvidenceEvents > 0
    ? (correctEvents / totalEvidenceEvents) * 100
    : 0

  const confidenceScore = Math.round(
    evidenceScore * 0.4 +
    coverageScore * 0.35 +
    (accuracyScore > 0 ? 25 : 0)
  )

  const confidence: DomainConfidence =
    confidenceScore >= 80 ? 'very_high' :
    confidenceScore >= 60 ? 'high' :
    confidenceScore >= 40 ? 'medium' :
    confidenceScore >= 20 ? 'low' : 'very_low'

  const messages: Record<DomainConfidence, string> = {
    very_high: 'Basado en mucha evidencia. Este dominio es confiable.',
    high: 'Buena evidencia. El número refleja bien tu dominio real.',
    medium: 'Evidencia moderada. El número es una estimación razonable.',
    low: 'Poca evidencia. Necesitamos más preguntas para estar seguros.',
    very_low: 'Casi sin evidencia. Este número es solo una estimación inicial.',
  }

  return {
    domain,
    confidence,
    confidenceScore,
    evidenceCount: totalEvidenceEvents,
    message: messages[confidence],
  }
}

// ── Plateau detector ─────────────────────────────────────────────
// Detecta si el dominio está estancado (plateau de aprendizaje)
export interface PlateauStatus {
  isOnPlateau: boolean
  plateauLength: number   // cuántas sesiones sin subir
  recommendation: string
}

export function detectPlateau(
  domainHistory: number[],
  threshold: number = 2,  // puntos mínimos de mejora por sesión
): PlateauStatus {
  if (domainHistory.length < 3) {
    return { isOnPlateau: false, plateauLength: 0, recommendation: '' }
  }

  const recent = domainHistory.slice(-4)
  let plateauLength = 0

  for (let i = recent.length - 1; i > 0; i--) {
    if (Math.abs(recent[i] - recent[i - 1]) <= threshold) {
      plateauLength++
    } else {
      break
    }
  }

  const isOnPlateau = plateauLength >= 2

  return {
    isOnPlateau,
    plateauLength,
    recommendation: isOnPlateau
      ? plateauLength >= 3
        ? 'Llevas muchas sesiones sin avanzar. ALAI cambiará completamente el enfoque.'
        : 'El progreso se está estancando. Vamos a cambiar el tipo de práctica.'
      : '',
  }
}

// ── Proyección realista ───────────────────────────────────────────
export interface DomainProjection {
  sessionBySession: number[]
  estimatedDaysToTarget: number | null
  finalProjectedDomain: number
  isTargetReachable: boolean
  confidence: DomainConfidence
}

export function projectRealDomain(
  currentDomain: number,
  targetScore: number,
  avgGainPerSession: number,
  sessionsPerDay: number,
  maxSessions: number,
): DomainProjection {
  const projection: number[] = [currentDomain]
  let domain = currentDomain
  let daysToTarget: number | null = null
  let dayCount = 0
  let sessionCount = 0

  for (let i = 0; i < maxSessions; i++) {
    const adjusted = applyNonLinearGain(domain, avgGainPerSession)
    const gain = adjusted - domain
    domain = adjusted
    projection.push(domain)
    sessionCount++

    if (sessionCount % sessionsPerDay === 0) dayCount++

    if (domain >= targetScore && daysToTarget === null) {
      daysToTarget = dayCount === 0 ? 1 : dayCount
    }

    if (domain >= 99) break
  }

  const finalDomain = projection[projection.length - 1]
  const confidenceScore = Math.min(100, maxSessions * 12)
  const confidence: DomainConfidence =
    confidenceScore >= 80 ? 'high' :
    confidenceScore >= 50 ? 'medium' : 'low'

  return {
    sessionBySession: projection,
    estimatedDaysToTarget: daysToTarget,
    finalProjectedDomain: Math.round(finalDomain),
    isTargetReachable: finalDomain >= targetScore,
    confidence,
  }
}
