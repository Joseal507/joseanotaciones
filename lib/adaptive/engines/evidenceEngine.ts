// ═══════════════════════════════════════════════════════════════
// Evidence Engine
// Cada interacción genera evidencia multidimensional.
// El mastery no es un score — es la suma calibrada de evidencias.
// ═══════════════════════════════════════════════════════════════

export type EvidenceDimension =
  | 'recognition'      // Reconoce el concepto cuando lo ve
  | 'comprehension'    // Entiende qué significa y por qué
  | 'recall'           // Lo recuerda sin ayuda
  | 'application'      // Lo puede usar en un problema
  | 'transfer'         // Lo usa en un contexto nuevo
  | 'retention'        // Lo recuerda después de tiempo
  | 'differentiation'  // Lo diferencia de conceptos parecidos

export type EvidenceStrength =
  | 'strong_positive'   // Correcto + alta confianza + rápido
  | 'weak_positive'     // Correcto + baja confianza o lento
  | 'neutral'           // No concluyente
  | 'weak_negative'     // Incorrecto pero sabe que no sabe
  | 'strong_negative'   // Incorrecto con alta confianza (falsa confianza)

export interface EvidenceRecord {
  id: string
  conceptId: string
  dimension: EvidenceDimension
  strength: EvidenceStrength
  weight: number              // 0.0 - 1.0 (importancia de esta evidencia)
  format: string              // multiple_choice, matching, case_study, etc.
  responseTimeSeconds: number
  confidence: 'high' | 'medium' | 'low' | 'guess'
  timestamp: number
}

export interface ConceptEvidence {
  conceptId: string
  conceptName: string
  dimensions: Record<EvidenceDimension, number>  // 0-100 por dimensión
  overallMastery: number                          // 0-100 score compuesto
  evidenceCount: number
  strongestDimension: EvidenceDimension
  weakestDimension: EvidenceDimension
  hasFalseConfidence: boolean
  lastUpdated: number
  history: EvidenceRecord[]
}

// ── Pesos de evidencia por formato ───────────────────────────────
// Cada formato aporta más o menos evidencia según su exigencia cognitiva
export const FORMAT_EVIDENCE_WEIGHT: Record<string, number> = {
  multiple_choice: 0.30,
  true_false: 0.25,
  fill_blank: 0.40,
  matching: 0.45,
  ordering: 0.50,
  short_answer: 0.60,
  open_explanation: 0.75,
  comparison: 0.70,
  cause_effect: 0.75,
  case_study: 0.90,
  problem: 0.85,
  error_detection: 0.80,
  active_recall: 0.85,
  harder_problem: 0.90,
  transfer_case: 0.95,
  inverse_teaching: 0.95,
  metacognition: 0.50,
}

// ── Qué dimensión evalúa cada formato ────────────────────────────
export const FORMAT_TO_DIMENSION: Record<string, EvidenceDimension[]> = {
  multiple_choice: ['recognition', 'comprehension'],
  true_false: ['recognition', 'comprehension'],
  fill_blank: ['recall', 'recognition'],
  matching: ['differentiation', 'recall'],
  ordering: ['comprehension', 'recall'],
  short_answer: ['recall', 'comprehension'],
  open_explanation: ['comprehension', 'recall'],
  comparison: ['differentiation', 'comprehension'],
  cause_effect: ['comprehension', 'application'],
  case_study: ['application', 'transfer'],
  problem: ['application'],
  error_detection: ['differentiation', 'comprehension'],
  active_recall: ['recall', 'comprehension'],
  harder_problem: ['application', 'transfer'],
  transfer_case: ['transfer'],
  inverse_teaching: ['comprehension', 'application'],
  metacognition: ['retention'],
}

// ── Calcular fuerza de evidencia ─────────────────────────────────
export function calculateEvidenceStrength(
  correct: boolean,
  confidence: 'high' | 'medium' | 'low' | 'guess',
  responseTimeSeconds: number,
): EvidenceStrength {
  const isFast = responseTimeSeconds < 12
  const isSlow = responseTimeSeconds > 60

  // Correcto con alta confianza y rápido → dominio real
  if (correct && confidence === 'high' && !isSlow) return 'strong_positive'

  // Correcto pero lento o inseguro → sabe pero no automatizado
  if (correct && (confidence === 'medium' || confidence === 'low' || isSlow)) return 'weak_positive'

  // Correcto pero adivinó
  if (correct && confidence === 'guess') return 'weak_positive'

  // Incorrecto con ALTA confianza → falsa confianza
  if (!correct && confidence === 'high') return 'strong_negative'

  // Incorrecto pero reconoce que no sabe
  if (!correct && (confidence === 'low' || confidence === 'guess')) return 'weak_negative'

  // Incorrecto con confianza media
  if (!correct && confidence === 'medium') return 'weak_negative'

  return 'neutral'
}

// ── Convertir fuerza a delta numérico ────────────────────────────
const STRENGTH_DELTA: Record<EvidenceStrength, number> = {
  strong_positive: 1.0,
  weak_positive: 0.5,
  neutral: 0.0,
  weak_negative: -0.4,
  strong_negative: -0.8,
}

// ── Crear registro de evidencia ──────────────────────────────────
export function createEvidenceRecord(params: {
  conceptId: string
  format: string
  correct: boolean
  confidence: 'high' | 'medium' | 'low' | 'guess'
  responseTimeSeconds: number
  isTeachingBlock?: boolean
}): EvidenceRecord[] {
  const { conceptId, format, correct, confidence, responseTimeSeconds, isTeachingBlock } = params

  // Los bloques de enseñanza no generan evidencia (solo se marcan como vistos)
  if (isTeachingBlock) return []

  const dimensions = FORMAT_TO_DIMENSION[format] || ['comprehension']
  const weight = FORMAT_EVIDENCE_WEIGHT[format] || 0.5
  const strength = calculateEvidenceStrength(correct, confidence, responseTimeSeconds)
  const timestamp = Date.now()

  return dimensions.map(dimension => ({
    id: `ev_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    conceptId,
    dimension,
    strength,
    weight,
    format,
    responseTimeSeconds,
    confidence,
    timestamp,
  }))
}

// ── Crear ConceptEvidence vacío ──────────────────────────────────
export function createEmptyConceptEvidence(conceptId: string, conceptName: string): ConceptEvidence {
  return {
    conceptId,
    conceptName,
    dimensions: {
      recognition: 0,
      comprehension: 0,
      recall: 0,
      application: 0,
      transfer: 0,
      retention: 0,
      differentiation: 0,
    },
    overallMastery: 0,
    evidenceCount: 0,
    strongestDimension: 'recognition',
    weakestDimension: 'recognition',
    hasFalseConfidence: false,
    lastUpdated: Date.now(),
    history: [],
  }
}

// ── Actualizar ConceptEvidence con nuevas evidencias ─────────────
export function applyEvidence(
  current: ConceptEvidence,
  newEvidences: EvidenceRecord[],
): ConceptEvidence {
  if (newEvidences.length === 0) return current

  const updated: ConceptEvidence = {
    ...current,
    dimensions: { ...current.dimensions },
    history: [...current.history, ...newEvidences].slice(-30), // últimos 30
    lastUpdated: Date.now(),
    evidenceCount: current.evidenceCount + newEvidences.length,
  }

  // Aplicar cada evidencia a su dimensión
  for (const ev of newEvidences) {
    const delta = STRENGTH_DELTA[ev.strength] * ev.weight * 25 // escala 0-25 por evidencia
    const currentValue = updated.dimensions[ev.dimension] || 0
    updated.dimensions[ev.dimension] = Math.max(0, Math.min(100, currentValue + delta))

    if (ev.strength === 'strong_negative') {
      updated.hasFalseConfidence = true
    }
  }

  // Calcular mastery compuesto
  updated.overallMastery = calculateOverallMastery(updated.dimensions, updated.hasFalseConfidence)

  // Detectar dimensión más fuerte y más débil
  const dimEntries = Object.entries(updated.dimensions) as [EvidenceDimension, number][]
  const activeDims = dimEntries.filter(([_, v]) => v > 0)
  if (activeDims.length > 0) {
    updated.strongestDimension = activeDims.reduce((a, b) => a[1] >= b[1] ? a : b)[0]
    updated.weakestDimension = activeDims.reduce((a, b) => a[1] <= b[1] ? a : b)[0]
  }

  return updated
}

// ── Pesos por dimensión para el score compuesto ──────────────────
const DIMENSION_WEIGHTS: Record<EvidenceDimension, number> = {
  recognition: 0.10,      // Nivel más bajo
  comprehension: 0.18,
  recall: 0.15,
  differentiation: 0.12,
  application: 0.22,      // Alto peso — aplicar es lo importante
  transfer: 0.15,
  retention: 0.08,
}

// ── Calcular mastery global ──────────────────────────────────────
export function calculateOverallMastery(
  dimensions: Record<EvidenceDimension, number>,
  hasFalseConfidence: boolean,
): number {
  let score = 0
  let totalWeight = 0

  for (const [dim, value] of Object.entries(dimensions) as [EvidenceDimension, number][]) {
    if (value > 0) {
      const w = DIMENSION_WEIGHTS[dim]
      score += value * w
      totalWeight += w
    }
  }

  if (totalWeight === 0) return 0

  const normalized = score / totalWeight
  const penalty = hasFalseConfidence ? 10 : 0
  return Math.max(0, Math.min(100, Math.round(normalized - penalty)))
}

// ── Identificar qué dimensiones necesitan más evidencia ──────────
export function getNeededDimensions(
  evidence: ConceptEvidence,
  targetMasteryLevel: number = 75,
): EvidenceDimension[] {
  const needed: Array<[EvidenceDimension, number]> = []

  for (const [dim, value] of Object.entries(evidence.dimensions) as [EvidenceDimension, number][]) {
    if (value < targetMasteryLevel) {
      const gap = targetMasteryLevel - value
      const importance = DIMENSION_WEIGHTS[dim]
      needed.push([dim, gap * importance])
    }
  }

  // Ordenar por prioridad: dimensiones importantes con gap grande primero
  return needed.sort((a, b) => b[1] - a[1]).map(([dim]) => dim)
}

// ── ¿El concepto está dominado? ──────────────────────────────────
export function isConceptMastered(
  evidence: ConceptEvidence,
  targetLevel: 'pass' | '80' | '90' | '100' = '80',
): boolean {
  const thresholds = {
    pass: { overall: 60, minEvidences: 2, requiredDims: ['recognition', 'comprehension'] as EvidenceDimension[] },
    '80': { overall: 75, minEvidences: 3, requiredDims: ['comprehension', 'recall'] as EvidenceDimension[] },
    '90': { overall: 85, minEvidences: 4, requiredDims: ['comprehension', 'application'] as EvidenceDimension[] },
    '100': { overall: 92, minEvidences: 5, requiredDims: ['application', 'transfer'] as EvidenceDimension[] },
  }

  const threshold = thresholds[targetLevel]

  if (evidence.overallMastery < threshold.overall) return false
  if (evidence.evidenceCount < threshold.minEvidences) return false
  if (evidence.hasFalseConfidence && evidence.overallMastery < 85) return false

  for (const dim of threshold.requiredDims) {
    if (evidence.dimensions[dim] < threshold.overall - 10) return false
  }

  return true
}

// ── Estado del concepto en lenguaje humano ───────────────────────
export function getConceptStatus(evidence: ConceptEvidence): {
  label: string
  color: string
  canAdvance: boolean
} {
  const m = evidence.overallMastery

  if (m >= 85) return { label: 'Dominado', color: '#5a8a3a', canAdvance: true }
  if (m >= 70) return { label: 'Bien encaminado', color: '#a8854a', canAdvance: true }
  if (m >= 50) return { label: 'En desarrollo', color: '#d6b26f', canAdvance: false }
  if (m >= 30) return { label: 'Empezando', color: '#c66d3c', canAdvance: false }
  if (evidence.evidenceCount === 0) return { label: 'Sin evidencia', color: '#8b7355', canAdvance: false }
  return { label: 'Necesita refuerzo', color: '#8b1a1a', canAdvance: false }
}
