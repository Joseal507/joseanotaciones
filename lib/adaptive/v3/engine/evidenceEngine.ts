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
import type { AssistanceLevel } from './confidenceTracker'
import { assistanceLevelToWeight, analyzeResponseTime } from './confidenceTracker'
import { getLegacyEvidenceWeight } from './pedagogicalDecision'
import { getContractForType } from './masteryContracts'

export const INTERACTION_CONTEXTS = [
  'learning',
  'immediate_practice',
  'interleaving',
  'delayed_retrieval',
  'spaced_review',
] as const

export type InteractionContext = (typeof INTERACTION_CONTEXTS)[number]

/**
 * Intervalo mínimo para considerar delayed recall real.
 * Reutiliza la misma política conservadora de 20 horas
 * usada por el tutor para programar retention checks.
 */
export const DELAYED_RECALL_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000

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
  assistanceLevel?: AssistanceLevel
  responseTimeMs?: number
  selfReportedConfidence?: number
  interactionContext?: InteractionContext
  elapsedSinceLastExposureMs?: number
}

export interface EvidenceProfile {
  microId: string
  evidences: Evidence[]
  // Contadores por tipo (solo respuestas correctas/parciales)
  strongCount: Record<EvidenceType, number>
  mediumCount: Record<EvidenceType, number>
  weakCount: Record<EvidenceType, number>
  // Patrones de error
  incorrectCountByType: Record<EvidenceType, number>
  attemptsCountByType: Record<EvidenceType, number>
  // Métricas de calidad de ejecución (necesarias para Mastery Contracts)
  independentSuccesses: number
  independentSuccessesByType: Record<EvidenceType, number>
  bestAssistanceByEvidenceType: Record<EvidenceType, AssistanceLevel | null>
  maxAssistanceLevelUsed: AssistanceLevel
  hasTransfer: boolean
  hasIntegration: boolean
  hasDelayedRecall: boolean
  // Meta
  totalEvidences: number
  totalIncorrect: number
  lastEvidenceAt: number | null
  masteryScore: number
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
    assistanceLevel?: AssistanceLevel
    responseTimeMs?: number
    selfReportedConfidence?: number
    interactionContext?: InteractionContext
    elapsedSinceLastExposureMs?: number
    activityAttemptNumber?: number
  },
): EvidenceProfile {
  const {
    formatUsed,
    outcome,
    score,
    turnNumber,
    isTransferContext,
    connectsToOtherMicro,
    assistanceLevel = 'independent',
    responseTimeMs,
    selfReportedConfidence,
    interactionContext,
    elapsedSinceLastExposureMs,
    activityAttemptNumber,
  } = params

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
  const attemptNumber = typeof activityAttemptNumber === 'number' && activityAttemptNumber >= 1
    ? Math.floor(activityAttemptNumber)
    : (updatedAttemptsCountByType[evidenceTypes[0] as EvidenceType] || 1)

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
    // 3er intento o más: sigue penalizando, pero no destruye por completo una demostración fuerte.
    // strong -> medium, medium -> weak, weak -> weak
    (rawStrength === 'strong' ? 'medium' : rawStrength === 'medium' ? 'weak' : 'weak')

  // Crear una evidencia por cada tipo
  const newEvidences: Evidence[] = evidenceTypes.map((type) => ({
    type,
    strength,
    turnNumber,
    timestamp: Date.now(),
    formatUsed,
    outcome,
    score,
    attemptNumber,
    confidenceMultiplier,
    assistanceLevel,
    responseTimeMs,
    selfReportedConfidence,
    interactionContext,
    elapsedSinceLastExposureMs,
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

const ASSISTANCE_LEVEL_ORDER: AssistanceLevel[] = [
  'independent',
  'minimal_hint',
  'guided',
  'assisted',
  'revealed',
]

function createEmptyBestAssistanceByType(): Record<EvidenceType, AssistanceLevel | null> {
  return {
    recognized: null,
    recalled: null,
    explained: null,
    applied: null,
    connected: null,
    transferred: null,
    retained: null,
  }
}

function createEmptyIndependentSuccessesByType(): Record<EvidenceType, number> {
  return {
    recognized: 0,
    recalled: 0,
    explained: 0,
    applied: 0,
    connected: 0,
    transferred: 0,
    retained: 0,
  }
}

function getMaxAssistanceLevelUsed(evidences: Evidence[]): AssistanceLevel {
  // Regla correcta:
  // - para cada tipo de evidencia, mirar el MENOR nivel de ayuda con el que
  //   se logró demostrar ese tipo con éxito;
  // - luego tomar el MAYOR entre esos mínimos.
  //
  // Esto evita que un reveal antiguo contamine para siempre el contrato si luego
  // el estudiante ya demostró el mismo tipo de evidencia de forma independiente.
  const bestByType = new Map<EvidenceType, AssistanceLevel>()

  for (const ev of evidences) {
    if (ev.outcome === 'incorrect') continue
    const currentLevel: AssistanceLevel = ev.assistanceLevel || 'independent'
    const prev = bestByType.get(ev.type)

    if (!prev) {
      bestByType.set(ev.type, currentLevel)
      continue
    }

    const prevIdx = ASSISTANCE_LEVEL_ORDER.indexOf(prev)
    const currIdx = ASSISTANCE_LEVEL_ORDER.indexOf(currentLevel)

    // conservar el MENOR nivel de ayuda observado para este tipo
    if (currIdx < prevIdx) {
      bestByType.set(ev.type, currentLevel)
    }
  }

  let maxLevel: AssistanceLevel = 'independent'
  for (const level of bestByType.values()) {
    if (ASSISTANCE_LEVEL_ORDER.indexOf(level) > ASSISTANCE_LEVEL_ORDER.indexOf(maxLevel)) {
      maxLevel = level
    }
  }

  return maxLevel
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

  const masteryScore = calculateMasteryScore(evidences)

  // Calcular métricas de calidad para el contrato
  // Solo cuenta como independentSuccess si assistanceLevel es explícitamente 'independent'
  // Evidencias legacy (sin assistanceLevel) NO cuentan como independientes.
  const independentSuccessesByType = createEmptyIndependentSuccessesByType()
  const bestAssistanceByEvidenceType = createEmptyBestAssistanceByType()

  for (const ev of evidences) {
    if (ev.outcome === 'incorrect') continue

    if (ev.assistanceLevel === 'independent' && ev.outcome === 'correct') {
      independentSuccessesByType[ev.type] = (independentSuccessesByType[ev.type] || 0) + 1
    }

    const currentLevel: AssistanceLevel = ev.assistanceLevel || 'independent'
    const prev = bestAssistanceByEvidenceType[ev.type]

    if (!prev) {
      bestAssistanceByEvidenceType[ev.type] = currentLevel
    } else {
      const prevIdx = ASSISTANCE_LEVEL_ORDER.indexOf(prev)
      const currIdx = ASSISTANCE_LEVEL_ORDER.indexOf(currentLevel)
      if (currIdx < prevIdx) {
        bestAssistanceByEvidenceType[ev.type] = currentLevel
      }
    }
  }

  const independentSuccesses = Object.values(independentSuccessesByType).reduce((a, b) => a + b, 0)

  const maxAssistanceLevelUsed = getMaxAssistanceLevelUsed(evidences)

  const hasTransfer = evidences.some(e => e.type === 'transferred' && e.outcome !== 'incorrect')
  const hasIntegration = evidences.some(e => e.type === 'connected' && e.outcome !== 'incorrect')
  const hasDelayedRecall = evidences.some(e => isDelayedRecallEvidence(e, evidences))

  return {
    microId,
    evidences,
    strongCount,
    mediumCount,
    weakCount,
    attemptsCountByType,
    incorrectCountByType,
    totalEvidences: evidences.length,
    totalIncorrect: 0,
    independentSuccesses,
    independentSuccessesByType,
    bestAssistanceByEvidenceType,
    maxAssistanceLevelUsed,
    hasTransfer,
    hasIntegration,
    hasDelayedRecall,
    lastEvidenceAt: evidences.length > 0 ? evidences[evidences.length - 1].timestamp : null,
    masteryScore,
  }
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR MASTERY SCORE (0-100)
// ═══════════════════════════════════════════════════════════════
function isDelayedRecallEvidence(evidence: Evidence, allEvidences: Evidence[]): boolean {
  if (evidence.outcome !== 'correct') return false

  // Interleaving NO implica delayed recall
  if (evidence.interactionContext === 'interleaving') return false

  // Solo contexts de revisión/recuperación pueden generar delayed recall
  const isReviewContext =
    evidence.interactionContext === 'spaced_review' ||
    evidence.interactionContext === 'delayed_retrieval' ||
    evidence.type === 'retained'

  if (!isReviewContext) return false

  // Debe haber separación temporal suficiente real
  let elapsedMs = evidence.elapsedSinceLastExposureMs
  if (typeof elapsedMs !== 'number') {
    // Fallback legacy: calcular desde evidencia previa más antigua del mismo micro
    const priorEvidences = allEvidences
      .filter(e => e.timestamp < evidence.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp)
    if (priorEvidences.length > 0) {
      elapsedMs = evidence.timestamp - priorEvidences[0].timestamp
    }
  }

  if (typeof elapsedMs !== 'number' || !isFinite(elapsedMs)) return false
  if (elapsedMs < DELAYED_RECALL_MIN_INTERVAL_MS) return false

  // Requiere asistencia independiente o como mucho pista mínima
  if (evidence.assistanceLevel === 'revealed' || evidence.assistanceLevel === 'assisted' || evidence.assistanceLevel === 'guided') {
    return false
  }

  return true
}

function calculateMasteryScore(evidences: Evidence[]): number {
  if (!evidences.length) return 0

  // Acumular score por tipo para aplicar el mismo cap por EvidenceType
  const scoreByType: Record<EvidenceType, number> = {
    recognized: 0, recalled: 0, explained: 0,
    applied: 0, connected: 0, transferred: 0, retained: 0,
  }

  for (const evidence of evidences) {
    if (evidence.outcome === 'incorrect') continue

    const typeWeight = EVIDENCE_WEIGHT[evidence.type]
    const strengthFactor =
      evidence.strength === 'strong' ? 1.0 :
      evidence.strength === 'medium' ? 0.6 : 0.3

    // Peso de ayuda: moderna usa assistanceLevel explícito; legacy usa descuento conservador
    const assistanceFactor =
      evidence.assistanceLevel === undefined
        ? getLegacyEvidenceWeight(evidence)
        : assistanceLevelToWeight(evidence.assistanceLevel)

    // Fluidez: respuestas extremadamente lentas o claramente guess pesan menos
    let fluencyFactor = 1.0
    if (typeof evidence.responseTimeMs === 'number' && isFinite(evidence.responseTimeMs)) {
      const analysis = analyzeResponseTime(evidence.responseTimeMs, evidence.formatUsed)
      if (analysis.isLikelyGuess) fluencyFactor *= 0.75
      if (analysis.fluency === 'slow') fluencyFactor *= 0.9
      if (analysis.fluency === 'struggling') fluencyFactor *= 0.8
    }

    // Bonus moderado por delayed recall real confirmado
    const delayedRecallBonus = isDelayedRecallEvidence(evidence, evidences) ? 1.15 : 1.0

    const contribution =
      typeWeight *
      strengthFactor *
      assistanceFactor *
      fluencyFactor *
      delayedRecallBonus

    scoreByType[evidence.type] += contribution
  }

  // Mantener el mismo cap pedagógico por tipo: máximo 2 evidencias fuertes por tipo
  let score = 0
  const evidenceTypes: EvidenceType[] = ['recognized', 'recalled', 'explained', 'applied', 'connected', 'transferred', 'retained']
  for (const type of evidenceTypes) {
    const weight = EVIDENCE_WEIGHT[type]
    score += Math.min(scoreByType[type], weight * 2)
  }

  // Normalizar a 0-100
  // Conservar 1 decimal para no colapsar diferencias reales de ayuda
  // (ej: independent 2.1 > minimal_hint 1.7 > guided 1.0 > assisted 0.6 > revealed 0.0)
  const maxScore = 48
  return Math.min(100, Math.round((score / maxScore) * 1000) / 10)
}

// ═══════════════════════════════════════════════════════════════
// ¿QUÉ EVIDENCIA FALTA?
// ═══════════════════════════════════════════════════════════════
export function getMissingEvidences(profile: EvidenceProfile, micro: MicroConcept): EvidenceType[] {
  const missing: EvidenceType[] = []
  const contract = getContractForType(micro.cognitiveType)

  for (const requirement of contract.requiredEvidence) {
    const strong = profile.strongCount[requirement.type] || 0
    const medium = profile.mediumCount[requirement.type] || 0
    const met =
      (requirement.minStrong > 0 && strong >= requirement.minStrong) ||
      (requirement.minMedium > 0 && strong + medium >= requirement.minMedium)
    if (!met) missing.push(requirement.type)
  }

  const maxAllowedAssistance = ASSISTANCE_LEVEL_ORDER.indexOf(contract.maxAssistanceLevel)
  for (const requirement of contract.requiredEvidence) {
    const bestAssistance = profile.bestAssistanceByEvidenceType[requirement.type]
    if (
      bestAssistance &&
      ASSISTANCE_LEVEL_ORDER.indexOf(bestAssistance) > maxAllowedAssistance &&
      !missing.includes(requirement.type)
    ) {
      missing.push(requirement.type)
    }
  }

  if (profile.independentSuccesses < contract.minimumIndependentSuccesses) {
    const independenceTarget = [...contract.requiredEvidence]
      .sort((left, right) =>
        profile.independentSuccessesByType[left.type] - profile.independentSuccessesByType[right.type]
      )[0]?.type
    if (independenceTarget && !missing.includes(independenceTarget)) {
      missing.push(independenceTarget)
    }
  }

  return missing
}

// ═══════════════════════════════════════════════════════════════
// ¿ESTÁ DOMINADO EL MICRO? — Usando contratos por tipo de conocimiento
// ═══════════════════════════════════════════════════════════════
export function isMicroMastered(profile: EvidenceProfile, micro: MicroConcept): boolean {
  // Dominio canónico = MasteryContract inmediato/provisional.
  // La retención (delayed recall) sigue siendo señal separada y NO bloquea
  // el dominio inicial del programa en esta fase.
  try {
    const { checkMasteryContract } = require('./masteryContracts')
    const result = checkMasteryContract(
      micro.cognitiveType,
      {
        strongCount: profile.strongCount,
        mediumCount: profile.mediumCount,
        masteryScore: profile.masteryScore,
        totalEvidences: profile.totalEvidences,
      },
      {
        independentSuccesses: profile.independentSuccesses,
        independentSuccessesByType: profile.independentSuccessesByType,
        bestAssistanceByEvidenceType: profile.bestAssistanceByEvidenceType,
        hasDelayedRecall: profile.hasDelayedRecall,
        hasTransfer: profile.hasTransfer,
        hasIntegration: profile.hasIntegration,
        maxAssistanceLevelUsed: profile.maxAssistanceLevelUsed,
      }
    )

    if (result.fulfilled) return true

    // Si la única razón restante es retención a largo plazo, considerar mastery provisional.
    // Esto evita exigir delayed recall para terminar el programa inicial.
    const onlyMissingRetention =
      result.blockingReason === 'Falta verificar retención tras tiempo' &&
      result.missingRequired.length === 0

    return onlyMissingRetention
  } catch {
    // Fallback conservador si no se puede cargar el módulo
    if (profile.masteryScore < 60) return false
    const missing = getMissingEvidences(profile, micro)
    const essentialMissing = missing.filter(e => e !== 'transferred' && e !== 'retained')
    return essentialMissing.length === 0
  }
}

// ═══════════════════════════════════════════════════════════════
// ¿ESTÁ SUFICIENTE PARA AVANZAR AL SIGUIENTE MICRO?
// ═══════════════════════════════════════════════════════════════
export function isReadyToAdvanceEvidence(profile: EvidenceProfile, micro: MicroConcept): boolean {
  // ─── BLOQUEO: revealed sin éxito independiente posterior ───
  // Si todos los éxitos fueron con ayuda máxima, no puede avanzar
  // por métricas brutas — exige al menos 1 demostración independiente.
  if (profile.independentSuccesses === 0 && profile.totalEvidences > 0) {
    // Solo bloquear si el nivel máximo fue assisted o revealed
    // minimal_hint puede avanzar con precaución en micros simples
    const maxIdx = ASSISTANCE_LEVEL_ORDER.indexOf(profile.maxAssistanceLevelUsed)
    const assistedIdx = ASSISTANCE_LEVEL_ORDER.indexOf('assisted')
    if (maxIdx >= assistedIdx) return false
  }

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
      forcedFormat: 'matching',
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
    independentSuccesses: 0,
    independentSuccessesByType: createEmptyIndependentSuccessesByType(),
    bestAssistanceByEvidenceType: createEmptyBestAssistanceByType(),
    maxAssistanceLevelUsed: 'independent',
    hasTransfer: false,
    hasIntegration: false,
    hasDelayedRecall: false,
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
