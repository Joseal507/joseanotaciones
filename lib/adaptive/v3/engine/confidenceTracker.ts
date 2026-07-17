// ═══════════════════════════════════════════════════════════════
// CONFIDENCE TRACKER
//
// Calibra la confianza del estudiante y registra el nivel de ayuda.
//
// Conceptos clave:
// - Confidence calibration: ¿su confianza coincide con su rendimiento?
//   - Overconfident: confianza alta + falla mucho → misconception peligrosa
//   - Underconfident: confianza baja + acierta mucho → conocimiento frágil
//   - Calibrated: confianza coincide con rendimiento
// - Assistance level: no es lo mismo acertar solo que con 3 pistas
//   - independent > minimal_hint > guided > assisted > revealed
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export const ASSISTANCE_LEVEL_ORDER = [
  'independent',
  'minimal_hint',
  'guided',
  'assisted',
  'revealed',
] as const

export type AssistanceLevel = (typeof ASSISTANCE_LEVEL_ORDER)[number]

export type CalibrationStatus =
  | 'calibrated'       // Confianza coincide con rendimiento
  | 'overconfident'    // Cree que sabe más de lo que sabe → peligroso
  | 'underconfident'   // Sabe más de lo que cree → frágil pero real
  | 'unknown'          // Insuficiente evidencia

export interface ConfidenceRecord {
  timestamp: number
  microId: string
  selfReportedConfidence: number  // 0-100 que reporta el estudiante
  actualOutcome: 'correct' | 'partial' | 'incorrect'
  actualScore: number
  assistanceLevel: AssistanceLevel
  responseTimeMs: number
}

export interface ConfidenceProfile {
  records: ConfidenceRecord[]
  // Estadísticas derivadas
  calibrationStatus: CalibrationStatus
  calibrationBias: number          // positivo = overconfident, negativo = underconfident
  avgSelfConfidence: number        // promedio de confianza reportada
  avgActualScore: number           // promedio de score real
  overconfidentCount: number       // veces que confianza > 70 pero falló
  underconfidentCount: number      // veces que confianza < 30 pero acertó
  // Distribución de ayuda
  independentSuccesses: number
  assistedSuccesses: number
  independentRate: number          // % de éxitos independientes vs total
}

// ═══════════════════════════════════════════════════════════════
// REGISTRAR CONFIANZA + AYUDA
// ═══════════════════════════════════════════════════════════════
export function recordConfidence(
  profile: ConfidenceProfile,
  params: {
    microId: string
    selfReportedConfidence: number
    actualOutcome: 'correct' | 'partial' | 'incorrect'
    actualScore: number
    assistanceLevel: AssistanceLevel
    responseTimeMs: number
  },
): ConfidenceProfile {
  const record: ConfidenceRecord = {
    timestamp: Date.now(),
    ...params,
  }

  const records = [...profile.records, record].slice(-100) // Últimos 100 registros

  return recalculateConfidenceProfile(records)
}

// ═══════════════════════════════════════════════════════════════
// RECALCULAR PERFIL DE CONFIANZA
// ═══════════════════════════════════════════════════════════════
function recalculateConfidenceProfile(records: ConfidenceRecord[]): ConfidenceProfile {
  if (records.length === 0) {
    return emptyConfidenceProfile()
  }

  let totalConfidence = 0
  let totalScore = 0
  let overconfidentCount = 0
  let underconfidentCount = 0
  let independentSuccesses = 0
  let assistedSuccesses = 0
  let totalSuccesses = 0

  for (const r of records) {
    totalConfidence += r.selfReportedConfidence
    totalScore += r.actualScore

    // Overconfident: dijo >70% pero falló
    if (r.selfReportedConfidence > 70 && r.actualOutcome === 'incorrect') {
      overconfidentCount++
    }
    // Underconfident: dijo <30% pero acertó bien
    if (r.selfReportedConfidence < 30 && r.actualOutcome === 'correct' && r.actualScore >= 80) {
      underconfidentCount++
    }

    // Ayuda
    if (r.actualOutcome === 'correct' || r.actualOutcome === 'partial') {
      totalSuccesses++
      if (r.assistanceLevel === 'independent') {
        independentSuccesses++
      } else {
        assistedSuccesses++
      }
    }
  }

  const avgSelfConfidence = Math.round(totalConfidence / records.length)
  const avgActualScore = Math.round(totalScore / records.length)
  const calibrationBias = avgSelfConfidence - avgActualScore

  // Determinar estado de calibración
  let calibrationStatus: CalibrationStatus = 'unknown'
  if (records.length >= 5) {
    if (Math.abs(calibrationBias) <= 15) {
      calibrationStatus = 'calibrated'
    } else if (calibrationBias > 15) {
      calibrationStatus = 'overconfident'
    } else {
      calibrationStatus = 'underconfident'
    }
  }

  const independentRate = totalSuccesses > 0
    ? Math.round((independentSuccesses / totalSuccesses) * 100)
    : 0

  return {
    records,
    calibrationStatus,
    calibrationBias: Math.round(calibrationBias),
    avgSelfConfidence,
    avgActualScore,
    overconfidentCount,
    underconfidentCount,
    independentSuccesses,
    assistedSuccesses,
    independentRate,
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVERTIR ASSISTANCE LEVEL A PESO DE EVIDENCIA
// Éxito independiente vale 1.0; con ayuda vale menos
// ═══════════════════════════════════════════════════════════════
export function assistanceLevelToWeight(level: AssistanceLevel): number {
  const weights: Record<AssistanceLevel, number> = {
    independent: 1.0,
    minimal_hint: 0.8,
    guided: 0.5,
    assisted: 0.3,
    revealed: 0.0,  // No cuenta como éxito real
  }
  return weights[level]
}

// ═══════════════════════════════════════════════════════════════
// ¿ES UN ÉXITO GENUINO?
// ═══════════════════════════════════════════════════════════════
export function isGenuineSuccess(
  outcome: 'correct' | 'partial' | 'incorrect',
  score: number,
  assistanceLevel: AssistanceLevel,
): boolean {
  // Solo cuenta como éxito genuino si:
  // - Respondió correctamente
  // - Sin ayuda o con pista mínima
  // - Score >= 80
  if (outcome !== 'correct') return false
  if (score < 80) return false
  if (assistanceLevel === 'assisted' || assistanceLevel === 'revealed') return false
  return true
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR ILUSIÓN DE CONOCIMIENTO
// (El estudiante cree que sabe pero no sabe)
// ═══════════════════════════════════════════════════════════════
export function hasKnowledgeIllusion(profile: ConfidenceProfile): {
  detected: boolean
  severity: 'mild' | 'moderate' | 'severe'
  message: string
} {
  if (profile.records.length < 5) {
    return { detected: false, severity: 'mild', message: '' }
  }

  const recentRecords = profile.records.slice(-10)
  const highConfidenceFails = recentRecords.filter(
    r => r.selfReportedConfidence > 70 && r.actualOutcome === 'incorrect'
  ).length

  if (highConfidenceFails >= 4) {
    return {
      detected: true,
      severity: 'severe',
      message: 'El estudiante consistentemente cree que sabe pero falla. Posible misconception profunda.',
    }
  }

  if (highConfidenceFails >= 2) {
    return {
      detected: true,
      severity: 'moderate',
      message: 'El estudiante a veces cree que sabe pero falla. Verificar comprensión real.',
    }
  }

  if (profile.calibrationStatus === 'overconfident') {
    return {
      detected: true,
      severity: 'mild',
      message: 'El estudiante tiende a sobreestimar su conocimiento.',
    }
  }

  return { detected: false, severity: 'mild', message: '' }
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR LATENCIA COMO SEÑAL PEDAGÓGICA
// ═══════════════════════════════════════════════════════════════
export function analyzeResponseTime(
  responseTimeMs: number,
  format: string,
): {
  fluency: 'instant' | 'fluent' | 'deliberate' | 'slow' | 'struggling'
  isLikelyGuess: boolean
  isLikelyReasoning: boolean
} {
  // Thresholds varían por formato
  const thresholds: Record<string, { fast: number; normal: number; slow: number }> = {
    multiple_choice: { fast: 3000, normal: 12000, slow: 30000 },
    true_false: { fast: 2000, normal: 8000, slow: 20000 },
    fill_blank: { fast: 5000, normal: 20000, slow: 45000 },
    matching: { fast: 10000, normal: 30000, slow: 60000 },
    ordering: { fast: 8000, normal: 25000, slow: 50000 },
    open_response: { fast: 15000, normal: 60000, slow: 120000 },
  }

  const t = thresholds[format] || thresholds.multiple_choice
  const ms = responseTimeMs

  let fluency: 'instant' | 'fluent' | 'deliberate' | 'slow' | 'struggling'
  if (ms < t.fast * 0.5) fluency = 'instant'
  else if (ms < t.fast) fluency = 'fluent'
  else if (ms < t.normal) fluency = 'deliberate'
  else if (ms < t.slow) fluency = 'slow'
  else fluency = 'struggling'

  // MCQ respondido en < 1.5 segundos → probablemente adivinó
  const isLikelyGuess = format === 'multiple_choice' && ms < 1500

  // Respuesta lenta pero correcta → razonamiento profundo
  const isLikelyReasoning = ms > t.normal && ms < t.slow * 1.5

  return { fluency, isLikelyGuess, isLikelyReasoning }
}

// ═══════════════════════════════════════════════════════════════
// PERFIL VACÍO
// ═══════════════════════════════════════════════════════════════
export function emptyConfidenceProfile(): ConfidenceProfile {
  return {
    records: [],
    calibrationStatus: 'unknown',
    calibrationBias: 0,
    avgSelfConfidence: 50,
    avgActualScore: 50,
    overconfidentCount: 0,
    underconfidentCount: 0,
    independentSuccesses: 0,
    assistedSuccesses: 0,
    independentRate: 0,
  }
}
