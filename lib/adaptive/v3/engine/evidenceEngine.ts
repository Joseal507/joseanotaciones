// ═══════════════════════════════════════════════════════════════
// EVIDENCE ENGINE
// 
// Reemplaza el sistema de "estados" (unseen/introduced/understood/mastered)
// por un perfil multidimensional de evidencias.
// 
// Cada micro acumula evidencias específicas: reconocido, recordado,
// explicado, aplicado, conectado, transferido, retenido.
// ═══════════════════════════════════════════════════════════════

import type { MicroConcept, MicroState, MicroTimelineEvent } from '../types'

// ═══════════════════════════════════════════════════════════════
// TIPOS DE EVIDENCIA
// ═══════════════════════════════════════════════════════════════
export type EvidenceType =
  | 'recognized'          // Identificó el concepto (MCQ, true_false)
  | 'recalled'            // Recordó datos precisos (fill_blank, quick_check)
  | 'explained'           // Explicó con sus palabras (open_response, teach_back)
  | 'applied'             // Aplicó a un caso (practical_case, step_by_step)
  | 'connected'           // Conectó con otro micro (concept_map, matching cross-micro)
  | 'transferred'         // Usó en contexto nuevo (practical_case con contexto diferente)
  | 'retained'            // Recordó tras el tiempo (recall_check después de N turnos)

export type EvidenceStrength = 'strong' | 'medium' | 'weak'

export interface Evidence {
  type: EvidenceType
  strength: EvidenceStrength
  turnNumber: number
  timestamp: number
  formatUsed: string          // qué formato de interacción lo generó
  outcome: 'correct' | 'partial' | 'incorrect'
  score: number               // 0-100
  attemptNumber: number       // cuántas veces intentó antes de acertar (1=primer intento)
  confidenceMultiplier: number // 1.0 primer intento, 0.7 segundo, 0.4 tercero+
}

export interface EvidenceProfile {
  microId: string
  evidences: Evidence[]
  // Contadores por tipo (solo respuestas correctas/parciales)
  strongCount: Record<EvidenceType, number>
  mediumCount: Record<EvidenceType, number>
  weakCount: Record<EvidenceType, number>
  // Patrones de error — cuántas veces falló por tipo de evidencia
  incorrectCountByType: Record<EvidenceType, number>
  // Intentos totales por tipo (para calcular tasa de error)
  attemptsCountByType: Record<EvidenceType, number>
  // Meta
  totalEvidences: number
  totalIncorrect: number       // total de respuestas incorrectas
  lastEvidenceAt: number | null
  masteryScore: number         // 0-100, calculado con confianza
}

// ═══════════════════════════════════════════════════════════════
// MAPA: formato de interacción → tipo(s) de evidencia que genera
// ═══════════════════════════════════════════════════════════════
const FORMAT_TO_EVIDENCE_TYPE: Record<string, EvidenceType[]> = {
  multiple_choice: ['recognized'],
  true_false: ['recognized'],
  fill_blank: ['recalled'],
  fill_blank_bank: ['recalled'],
  matching: ['recognized', 'connected'],           // matching genera dos tipos
  ordering: ['recalled', 'applied'],                // ordering es aplicación de secuencia
  classify_groups: ['recognized', 'applied'],
  step_by_step_solver: ['applied'],
  find_the_error: ['applied', 'explained'],
  complete_procedure: ['applied'],
  complete_reaction_or_formula: ['applied', 'recalled'],
  calculator_check: ['applied'],
  practical_case: ['applied', 'transferred'],
  prediction: ['applied', 'transferred'],
  choose_best_procedure: ['applied'],
  open_response: ['explained'],
  explain_why: ['explained'],
  teach_back: ['explained'],
  quick_check: ['recalled'],
  formula_builder: ['applied'],
  concept_map: ['connected'],
}

// ═══════════════════════════════════════════════════════════════
// PESO DE CADA TIPO DE EVIDENCIA (para el masteryScore)
// ═══════════════════════════════════════════════════════════════
const EVIDENCE_WEIGHT: Record<EvidenceType, number> = {
  recognized: 1,        // Reconocer es lo más básico
  recalled: 2,          // Recordar sin ayuda vale más
  explained: 4,         // Explicar con palabras propias es fuerte
  applied: 5,           // Aplicar a un caso es muy fuerte
  connected: 3,         // Conectar con otro micro es importante
  transferred: 6,       // Transferir a contexto nuevo es lo máximo
  retained: 3,          // Retención tras tiempo
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — REGISTRAR EVIDENCIA
// ═══════════════════════════════════════════════════════════════
export function recordEvidence(
  profile: EvidenceProfile,
  params: {
    formatUsed: string
    outcome: 'correct' | 'partial' | 'incorrect'
    score: number
    turnNumber: number
    isTransferContext?: boolean
    connectsToOtherMicro?: string
  },
): EvidenceProfile {
  const { formatUsed, outcome, score, turnNumber, isTransferContext, connectsToOtherMicro } = params

  // Determinar qué tipos de evidencia genera este formato
  let evidenceTypes = FORMAT_TO_EVIDENCE_TYPE[formatUsed] || ['recognized']

  // Ajustar según contexto especial
  if (isTransferContext && evidenceTypes.includes('applied')) {
    evidenceTypes = [...evidenceTypes.filter(t => t !== 'applied'), 'transferred']
  }
  if (connectsToOtherMicro && !evidenceTypes.includes('connected')) {
    evidenceTypes = [...evidenceTypes, 'connected']
  }

  // Trackear intentos totales y fallos POR TIPO DE EVIDENCIA
  const updatedAttemptsCountByType = { ...(profile.attemptsCountByType || {}) } as Record<EvidenceType, number>
  const updatedIncorrectCountByType = { ...(profile.incorrectCountByType || {}) } as Record<EvidenceType, number>
  for (const type of evidenceTypes as EvidenceType[]) {
    updatedAttemptsCountByType[type] = (updatedAttemptsCountByType[type] || 0) + 1
    if (outcome === 'incorrect') {
      updatedIncorrectCountByType[type] = (updatedIncorrectCountByType[type] || 0) + 1
    }
  }

  // Incorrectos no generan evidencia positiva — pero sí se registran en el perfil
  if (outcome === 'incorrect') {
    return {
      ...profile,
      attemptsCountByType: updatedAttemptsCountByType,
      incorrectCountByType: updatedIncorrectCountByType,
      totalIncorrect: (profile.totalIncorrect || 0) + 1,
    }
  }

  // Calcular attemptNumber: cuántos intentos previos tuvo en este tipo de evidencia
  const attemptNumber = (updatedAttemptsCountByType[evidenceTypes[0] as EvidenceType] || 1)

  // Multiplicador de confianza: primer intento = 1.0, segundo = 0.7, tercero+ = 0.4
  const confidenceMultiplier =
    attemptNumber <= 1 ? 1.0 :
    attemptNumber === 2 ? 0.7 : 0.4

  // Determinar fuerza de la evidencia (ajustada por confianza)
  const rawStrength = calculateStrength(outcome, score)
  // Degradar fuerza si la confianza es baja (muchos intentos previos)
  const strength: EvidenceStrength =
    confidenceMultiplier >= 1.0 ? rawStrength :
    confidenceMultiplier >= 0.7 ? (rawStrength === 'strong' ? 'medium' : rawStrength) :
    (rawStrength === 'strong' ? 'weak' : rawStrength === 'medium' ? 'weak' : 'weak')

  // Crear una evidencia por cada tipo
  const newEvidences: Evidence[] = evidenceTypes.map((type: any) => ({
    type,
    strength,
    turnNumber,
    timestamp: Date.now(),
    formatUsed,
    outcome,
    score,
    attemptNumber,
    confidenceMultiplier,
  }))

  const updatedEvidences = [...profile.evidences, ...newEvidences]

  const rebuilt = rebuildProfile(profile.microId, updatedEvidences)

  // Preservar los contadores de intentos y fallos
  return {
    ...rebuilt,
    attemptsCountByType: updatedAttemptsCountByType,
    incorrectCountByType: updatedIncorrectCountByType,
    totalIncorrect: (profile.totalIncorrect || 0),
  }
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR FUERZA DE LA EVIDENCIA
// ═══════════════════════════════════════════════════════════════
function calculateStrength(outcome: string, score: number): EvidenceStrength {
  if (outcome === 'correct' && score >= 85) return 'strong'
  if (outcome === 'correct' && score >= 60) return 'medium'
  if (outcome === 'partial' && score >= 50) return 'medium'
  return 'weak'
}

// ═══════════════════════════════════════════════════════════════
// RECONSTRUIR PERFIL A PARTIR DE EVIDENCIAS
// ═══════════════════════════════════════════════════════════════
export function rebuildProfile(microId: string, evidences: Evidence[]): EvidenceProfile {
  const emptyCount: Record<EvidenceType, number> = {
    recognized: 0, recalled: 0, explained: 0,
    applied: 0, connected: 0, transferred: 0, retained: 0,
  }

  const strongCount = { ...emptyCount }
  const mediumCount = { ...emptyCount }
  const weakCount = { ...emptyCount }
  const attemptsCountByType = { ...emptyCount }
  const incorrectCountByType = { ...emptyCount }

  for (const ev of evidences) {
    if (ev.strength === 'strong') strongCount[ev.type]++
    else if (ev.strength === 'medium') mediumCount[ev.type]++
    else weakCount[ev.type]++
  }

  const masteryScore = calculateMasteryScore(strongCount, mediumCount, weakCount)

  return {
    microId,
    evidences,
    strongCount,
    mediumCount,
    weakCount,
    attemptsCountByType,
    incorrectCountByType,
    totalEvidences: evidences.length,
    totalIncorrect: 0,  // se llena en recordEvidence
    lastEvidenceAt: evidences.length > 0 ? evidences[evidences.length - 1].timestamp : null,
    masteryScore,
  }
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR MASTERY SCORE (0-100)
// ═══════════════════════════════════════════════════════════════
function calculateMasteryScore(
  strong: Record<EvidenceType, number>,
  medium: Record<EvidenceType, number>,
  weak: Record<EvidenceType, number>,
): number {
  let score = 0
  const evidenceTypes: EvidenceType[] = ['recognized', 'recalled', 'explained', 'applied', 'connected', 'transferred', 'retained']

  for (const type of evidenceTypes) {
    const weight = EVIDENCE_WEIGHT[type]
    // Cada evidencia strong = 1.0, medium = 0.6, weak = 0.3
    const typeScore = (strong[type] * 1.0 + medium[type] * 0.6 + weak[type] * 0.3) * weight
    score += Math.min(typeScore, weight * 2)  // cap: max 2 evidencias fuertes por tipo
  }

  // Normalizar a 0-100
  // Máximo teórico: sum de todos los pesos × 2 = (1+2+4+5+3+6+3) × 2 = 48
  const maxScore = 48
  return Math.min(100, Math.round((score / maxScore) * 100))
}

// ═══════════════════════════════════════════════════════════════
// ¿QUÉ EVIDENCIA FALTA?
// ═══════════════════════════════════════════════════════════════
export function getMissingEvidences(profile: EvidenceProfile, micro: MicroConcept): EvidenceType[] {
  const missing: EvidenceType[] = []

  // Reconocimiento: al menos 1 fuerte
  if (profile.strongCount.recognized === 0 && profile.mediumCount.recognized === 0) {
    missing.push('recognized')
  }

  // Recall: para micros con datos precisos (fechas, nombres, fórmulas)
  const needsRecall = ['definitional', 'memorization', 'mathematical', 'chronological'].includes(micro.cognitiveType)
  if (needsRecall && profile.strongCount.recalled + profile.mediumCount.recalled === 0) {
    missing.push('recalled')
  }

  // Explicación: para conceptos abstractos
  const needsExplanation = ['conceptual', 'causal', 'analytical'].includes(micro.cognitiveType)
  if (needsExplanation && profile.strongCount.explained + profile.mediumCount.explained === 0) {
    missing.push('explained')
  }

  // Aplicación: para micros procedimentales, matemáticos o aplicativos
  const needsApplication = ['procedural', 'mathematical', 'applicative', 'analytical'].includes(micro.cognitiveType)
  if (needsApplication && profile.strongCount.applied + profile.mediumCount.applied === 0) {
    missing.push('applied')
  }

  // Conexión: solo si el micro tiene relaciones con otros
  if (micro.related && micro.related.length > 0) {
    if (profile.strongCount.connected + profile.mediumCount.connected === 0) {
      missing.push('connected')
    }
  }

  // Transferencia: solo si es importante (critical o high)
  if (micro.importance === 'critical' || micro.importance === 'high') {
    if (profile.strongCount.transferred === 0 && profile.mediumCount.transferred === 0) {
      missing.push('transferred')
    }
  }

  return missing
}

// ═══════════════════════════════════════════════════════════════
// ¿ESTÁ DOMINADO EL MICRO?
// ═══════════════════════════════════════════════════════════════
export function isMicroMastered(profile: EvidenceProfile, micro: MicroConcept): boolean {
  // No basta con score alto — deben cubrirse las evidencias requeridas
  if (profile.masteryScore < 60) return false

  const missing = getMissingEvidences(profile, micro)

  // Un micro está dominado si:
  // - masteryScore >= 60
  // - No le faltan evidencias esenciales para su tipo cognitivo
  const essentialMissing = missing.filter(e => e !== 'transferred' && e !== 'retained')
  return essentialMissing.length === 0
}

// ═══════════════════════════════════════════════════════════════
// ¿ESTÁ SUFICIENTE PARA AVANZAR AL SIGUIENTE MICRO?
// ═══════════════════════════════════════════════════════════════
export function isReadyToAdvanceEvidence(profile: EvidenceProfile, micro: MicroConcept): boolean {
  // ─── UMBRALES ADAPTATIVOS SEGÚN DIFICULTAD DEL MICRO ───
  // Micros fáciles (0-30): 2 aciertos y 40% mastery bastan
  // Micros medios (30-60): 3 aciertos y 55% mastery
  // Micros difíciles (60+): 4 aciertos y 70% mastery + variedad de formatos
  // Ajuste extra por importancia critical: +1 acierto requerido
  const difficulty = micro.difficulty || 50
  const isCritical = micro.importance === 'critical' || micro.importance === 'high'

  let minMastery = 40
  let minCorrect = 2
  if (difficulty >= 60) { minMastery = 70; minCorrect = 4 }
  else if (difficulty >= 30) { minMastery = 55; minCorrect = 3 }
  if (isCritical) minCorrect += 1

  const totalCorrect =
    profile.strongCount.recognized + profile.mediumCount.recognized +
    profile.strongCount.recalled + profile.mediumCount.recalled +
    profile.strongCount.explained + profile.mediumCount.explained +
    profile.strongCount.applied + profile.mediumCount.applied

  const hasRecognition = profile.strongCount.recognized + profile.mediumCount.recognized > 0
  const hasSomeUnderstanding =
    profile.strongCount.recalled + profile.mediumCount.recalled > 0 ||
    profile.strongCount.explained + profile.mediumCount.explained > 0 ||
    profile.strongCount.applied + profile.mediumCount.applied > 0

  // Avance normal adaptativo
  if (hasRecognition && hasSomeUnderstanding && profile.masteryScore >= minMastery && totalCorrect >= minCorrect) {
    return true
  }

  // REGLA MADRE: NUNCA avanzar si mastery = 0 (no ha acertado NADA).
  if (profile.masteryScore === 0) return false

  // NO tiene aciertos suficientes: NO avanzar todavía
  if (totalCorrect < minCorrect) return false

  // SAFETY: si tiene MUCHOS intentos (12+) con al menos algo de mastery, avanzar
  // (protege contra bucles infinitos, pero muy tolerante)
  if (profile.totalEvidences >= 12 && profile.masteryScore >= 30) return true

  return false
}

// ═══════════════════════════════════════════════════════════════
// SIGUIENTE OBJETIVO SUGERIDO BASADO EN EVIDENCIAS FALTANTES
// ═══════════════════════════════════════════════════════════════
export function suggestNextObjectiveFromEvidence(
  profile: EvidenceProfile,
  micro: MicroConcept,
): { objective: string; reason: string; targetEvidence: EvidenceType | null; forcedFormat?: string | null } {
  const missing = getMissingEvidences(profile, micro)

  if (missing.length === 0) {
    return {
      objective: 'consolidate',
      reason: 'Todas las evidencias requeridas están cubiertas',
      targetEvidence: null,
    }
  }

  // Priorizar por importancia pedagógica
  const priority: EvidenceType[] = ['recognized', 'recalled', 'explained', 'applied', 'connected', 'transferred']
  const nextEvidence = priority.find(e => missing.includes(e)) || missing[0]

  const objectiveMap: Record<EvidenceType, { objective: string; reason: string; forcedFormat?: string }> = {
    recognized: {
      objective: 'verify_understanding',
      reason: 'Falta evidencia de reconocimiento — verificar comprensión básica',
    },
    recalled: {
      objective: 'verify_understanding',
      reason: 'Falta evidencia de recall — probar memoria precisa',
      forcedFormat: 'fill_blank',
    },
    explained: {
      objective: 'verify_understanding',
      reason: 'Falta evidencia de explicación — el estudiante debe explicar con sus palabras',
      forcedFormat: 'teach_back',
    },
    applied: {
      objective: 'test_application',
      reason: 'Falta evidencia de aplicación — dar caso práctico',
    },
    connected: {
      objective: 'connect_to_previous',
      reason: 'Falta evidencia de conexión — relacionar con otros micros',
    },
    transferred: {
      objective: 'test_transfer',
      reason: 'Falta evidencia de transferencia — contexto nuevo',
    },
    retained: {
      objective: 'recall_check',
      reason: 'Verificar retención tras el tiempo',
    },
  }

  const mapping = objectiveMap[nextEvidence]
  return {
    objective: mapping.objective,
    reason: mapping.reason,
    targetEvidence: nextEvidence,
    forcedFormat: (mapping as any).forcedFormat || null,
  }
}

// ═══════════════════════════════════════════════════════════════
// PERFIL VACÍO (init)
// ═══════════════════════════════════════════════════════════════
export function emptyEvidenceProfile(microId: string): EvidenceProfile {
  const empty: Record<EvidenceType, number> = {
    recognized: 0, recalled: 0, explained: 0,
    applied: 0, connected: 0, transferred: 0, retained: 0,
  }
  return {
    microId,
    evidences: [],
    strongCount: { ...empty },
    mediumCount: { ...empty },
    weakCount: { ...empty },
    attemptsCountByType: { ...empty },
    incorrectCountByType: { ...empty },
    totalEvidences: 0,
    totalIncorrect: 0,
    lastEvidenceAt: null,
    masteryScore: 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// ETIQUETA HUMANA DEL PERFIL (para UI)
// ═══════════════════════════════════════════════════════════════
export function getProfileLabel(profile: EvidenceProfile, micro: MicroConcept): {
  label: string
  color: string
  description: string
} {
  if (profile.totalEvidences === 0) {
    return { label: 'Sin explorar', color: '#8b8b8b', description: 'Aún no se ha visto' }
  }

  if (isMicroMastered(profile, micro)) {
    return {
      label: 'Dominado',
      color: '#5a8a3a',
      description: `Todas las evidencias cubiertas (${profile.masteryScore}%)`,
    }
  }

  const missing = getMissingEvidences(profile, micro)
  if (missing.length > 0) {
    const missingLabels: Record<EvidenceType, string> = {
      recognized: 'reconocer',
      recalled: 'recordar',
      explained: 'explicar',
      applied: 'aplicar',
      connected: 'conectar',
      transferred: 'transferir',
      retained: 'retener',
    }
    const nextMissing = missingLabels[missing[0]]

    if (profile.masteryScore >= 40) {
      return {
        label: 'En progreso',
        color: '#d4a544',
        description: `Falta: ${nextMissing}`,
      }
    }
  }

  return {
    label: 'Empezando',
    color: '#3498db',
    description: `${profile.masteryScore}% de dominio`,
  }
}
