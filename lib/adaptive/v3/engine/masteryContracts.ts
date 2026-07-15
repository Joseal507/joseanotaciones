// ═══════════════════════════════════════════════════════════════
// MASTERY CONTRACTS
//
// Define qué evidencia necesita cada tipo de conocimiento
// para considerarse "dominado".
//
// No todo micro se domina igual:
// - Un hecho simple: reconocer + recordar
// - Un procedimiento: recordar pasos + ejecutar + detectar errores
// - Un diagnóstico clínico: reconocer signos + formular hipótesis + decidir
// ═══════════════════════════════════════════════════════════════

import type { EvidenceType } from './evidenceEngine'
import type { CognitiveType } from '../types'

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface EvidenceRequirement {
  type: EvidenceType
  minStrong: number          // evidencias fuertes mínimas
  minMedium: number          // evidencias medium mínimas (si no hay strong)
  description: string        // qué significa esta evidencia en lenguaje humano
}

export interface MasteryContract {
  knowledgeType: CognitiveType
  label: string              // "Hecho simple", "Procedimiento", etc.
  requiredEvidence: EvidenceRequirement[]
  optionalEvidence: EvidenceRequirement[]
  minimumMasteryScore: number          // score mínimo del EvidenceEngine
  minimumIndependentSuccesses: number  // aciertos sin ayuda
  requiresDelayedRecall: boolean       // necesita retención tras tiempo
  requiresTransfer: boolean            // necesita uso en contexto nuevo
  requiresIntegration: boolean         // necesita conectar con otros micros
  maxAssistanceLevel: 'independent' | 'minimal_hint' | 'guided'  // nivel máximo de ayuda aceptable
}

// ═══════════════════════════════════════════════════════════════
// CONTRATOS POR TIPO COGNITIVO
// ═══════════════════════════════════════════════════════════════

export const MASTERY_CONTRACTS: Record<CognitiveType, MasteryContract> = {
  // ── DEFINITIONAL: hechos, nombres, fechas ──────────────────
  definitional: {
    knowledgeType: 'definitional',
    label: 'Definición o hecho',
    requiredEvidence: [
      { type: 'recognized', minStrong: 1, minMedium: 1, description: 'Reconoce el concepto' },
      { type: 'recalled', minStrong: 1, minMedium: 0, description: 'Recuerda sin opciones' },
    ],
    optionalEvidence: [
      { type: 'explained', minStrong: 0, minMedium: 1, description: 'Puede explicarlo' },
    ],
    minimumMasteryScore: 40,
    minimumIndependentSuccesses: 2,
    requiresDelayedRecall: true,
    requiresTransfer: false,
    requiresIntegration: false,
    maxAssistanceLevel: 'minimal_hint',
  },

  // ── CONCEPTUAL: teorías, modelos, principios ───────────────
  conceptual: {
    knowledgeType: 'conceptual',
    label: 'Concepto o teoría',
    requiredEvidence: [
      { type: 'recognized', minStrong: 1, minMedium: 0, description: 'Reconoce el concepto' },
      { type: 'explained', minStrong: 1, minMedium: 0, description: 'Explica con sus palabras' },
      { type: 'connected', minStrong: 0, minMedium: 1, description: 'Conecta con otros conceptos' },
    ],
    optionalEvidence: [
      { type: 'applied', minStrong: 0, minMedium: 1, description: 'Puede aplicarlo' },
      { type: 'transferred', minStrong: 0, minMedium: 1, description: 'Lo usa en contexto nuevo' },
    ],
    minimumMasteryScore: 55,
    minimumIndependentSuccesses: 3,
    requiresDelayedRecall: true,
    requiresTransfer: false,
    requiresIntegration: true,
    maxAssistanceLevel: 'minimal_hint',
  },

  // ── PROCEDURAL: pasos, algoritmos, protocolos ──────────────
  procedural: {
    knowledgeType: 'procedural',
    label: 'Procedimiento',
    requiredEvidence: [
      { type: 'recalled', minStrong: 1, minMedium: 0, description: 'Recuerda los pasos' },
      { type: 'applied', minStrong: 1, minMedium: 1, description: 'Ejecuta el procedimiento' },
    ],
    optionalEvidence: [
      { type: 'explained', minStrong: 0, minMedium: 1, description: 'Explica por qué cada paso' },
      { type: 'transferred', minStrong: 0, minMedium: 1, description: 'Aplica en caso diferente' },
    ],
    minimumMasteryScore: 60,
    minimumIndependentSuccesses: 3,
    requiresDelayedRecall: true,
    requiresTransfer: true,
    requiresIntegration: false,
    maxAssistanceLevel: 'independent',
  },

  // ── MATHEMATICAL: fórmulas, cálculos ───────────────────────
  mathematical: {
    knowledgeType: 'mathematical',
    label: 'Fórmula o cálculo',
    requiredEvidence: [
      { type: 'recalled', minStrong: 1, minMedium: 0, description: 'Recuerda la fórmula' },
      { type: 'applied', minStrong: 2, minMedium: 0, description: 'Resuelve problemas' },
    ],
    optionalEvidence: [
      { type: 'explained', minStrong: 0, minMedium: 1, description: 'Explica las variables' },
      { type: 'transferred', minStrong: 1, minMedium: 0, description: 'Resuelve variantes' },
    ],
    minimumMasteryScore: 65,
    minimumIndependentSuccesses: 4,
    requiresDelayedRecall: true,
    requiresTransfer: true,
    requiresIntegration: false,
    maxAssistanceLevel: 'independent',
  },

  // ── CAUSAL: causa-efecto ───────────────────────────────────
  causal: {
    knowledgeType: 'causal',
    label: 'Relación causa-efecto',
    requiredEvidence: [
      { type: 'recognized', minStrong: 1, minMedium: 0, description: 'Identifica la relación' },
      { type: 'explained', minStrong: 1, minMedium: 0, description: 'Explica la cadena causal' },
    ],
    optionalEvidence: [
      { type: 'applied', minStrong: 0, minMedium: 1, description: 'Predice efectos' },
      { type: 'transferred', minStrong: 0, minMedium: 1, description: 'Predice en contexto nuevo' },
    ],
    minimumMasteryScore: 55,
    minimumIndependentSuccesses: 3,
    requiresDelayedRecall: false,
    requiresTransfer: false,
    requiresIntegration: true,
    maxAssistanceLevel: 'minimal_hint',
  },

  // ── COMPARATIVE: X vs Y ────────────────────────────────────
  comparative: {
    knowledgeType: 'comparative',
    label: 'Comparación',
    requiredEvidence: [
      { type: 'recognized', minStrong: 1, minMedium: 0, description: 'Distingue los elementos' },
      { type: 'connected', minStrong: 1, minMedium: 0, description: 'Compara correctamente' },
    ],
    optionalEvidence: [
      { type: 'explained', minStrong: 0, minMedium: 1, description: 'Explica diferencias clave' },
    ],
    minimumMasteryScore: 50,
    minimumIndependentSuccesses: 2,
    requiresDelayedRecall: false,
    requiresTransfer: false,
    requiresIntegration: true,
    maxAssistanceLevel: 'minimal_hint',
  },

  // ── CHRONOLOGICAL: secuencias temporales ───────────────────
  chronological: {
    knowledgeType: 'chronological',
    label: 'Secuencia temporal',
    requiredEvidence: [
      { type: 'recalled', minStrong: 1, minMedium: 0, description: 'Recuerda el orden' },
    ],
    optionalEvidence: [
      { type: 'explained', minStrong: 0, minMedium: 1, description: 'Explica por qué ese orden' },
    ],
    minimumMasteryScore: 40,
    minimumIndependentSuccesses: 2,
    requiresDelayedRecall: true,
    requiresTransfer: false,
    requiresIntegration: false,
    maxAssistanceLevel: 'guided',
  },

  // ── CLASSIFICATORY: categorías, tipos ──────────────────────
  classificatory: {
    knowledgeType: 'classificatory',
    label: 'Clasificación',
    requiredEvidence: [
      { type: 'recognized', minStrong: 1, minMedium: 0, description: 'Clasifica correctamente' },
      { type: 'connected', minStrong: 0, minMedium: 1, description: 'Relaciona categorías' },
    ],
    optionalEvidence: [
      { type: 'applied', minStrong: 0, minMedium: 1, description: 'Clasifica nuevos elementos' },
    ],
    minimumMasteryScore: 45,
    minimumIndependentSuccesses: 2,
    requiresDelayedRecall: false,
    requiresTransfer: false,
    requiresIntegration: false,
    maxAssistanceLevel: 'minimal_hint',
  },

  // ── NARRATIVE: historias, relatos ──────────────────────────
  narrative: {
    knowledgeType: 'narrative',
    label: 'Narrativa o relato',
    requiredEvidence: [
      { type: 'recognized', minStrong: 1, minMedium: 0, description: 'Reconoce la historia' },
      { type: 'recalled', minStrong: 0, minMedium: 1, description: 'Recuerda elementos clave' },
    ],
    optionalEvidence: [],
    minimumMasteryScore: 35,
    minimumIndependentSuccesses: 1,
    requiresDelayedRecall: false,
    requiresTransfer: false,
    requiresIntegration: false,
    maxAssistanceLevel: 'guided',
  },

  // ── ANALYTICAL: análisis, interpretación ───────────────────
  analytical: {
    knowledgeType: 'analytical',
    label: 'Análisis',
    requiredEvidence: [
      { type: 'recognized', minStrong: 1, minMedium: 0, description: 'Identifica los elementos' },
      { type: 'explained', minStrong: 1, minMedium: 0, description: 'Analiza las relaciones' },
      { type: 'applied', minStrong: 1, minMedium: 0, description: 'Aplica el análisis' },
    ],
    optionalEvidence: [
      { type: 'transferred', minStrong: 0, minMedium: 1, description: 'Analiza caso nuevo' },
    ],
    minimumMasteryScore: 60,
    minimumIndependentSuccesses: 3,
    requiresDelayedRecall: false,
    requiresTransfer: true,
    requiresIntegration: true,
    maxAssistanceLevel: 'independent',
  },

  // ── APPLICATIVE: resolución de problemas ───────────────────
  applicative: {
    knowledgeType: 'applicative',
    label: 'Aplicación práctica',
    requiredEvidence: [
      { type: 'recalled', minStrong: 1, minMedium: 0, description: 'Recuerda el método' },
      { type: 'applied', minStrong: 2, minMedium: 0, description: 'Resuelve casos' },
      { type: 'transferred', minStrong: 1, minMedium: 0, description: 'Resuelve caso nuevo' },
    ],
    optionalEvidence: [
      { type: 'explained', minStrong: 0, minMedium: 1, description: 'Justifica la solución' },
    ],
    minimumMasteryScore: 65,
    minimumIndependentSuccesses: 4,
    requiresDelayedRecall: true,
    requiresTransfer: true,
    requiresIntegration: true,
    maxAssistanceLevel: 'independent',
  },
}

// ═══════════════════════════════════════════════════════════════
// VERIFICAR SI UN MICRO CUMPLE SU CONTRATO DE DOMINIO
// ═══════════════════════════════════════════════════════════════
export function checkMasteryContract(
  cognitiveType: CognitiveType,
  evidenceProfile: {
    strongCount: Record<EvidenceType, number>
    mediumCount: Record<EvidenceType, number>
    masteryScore: number
    totalEvidences: number
  },
  params?: {
    independentSuccesses?: number
    hasDelayedRecall?: boolean
    hasTransfer?: boolean
    hasIntegration?: boolean
    maxAssistanceLevelUsed?: 'independent' | 'minimal_hint' | 'guided' | 'assisted' | 'revealed'
  },
): {
  fulfilled: boolean
  missingRequired: string[]
  missingOptional: string[]
  fulfillmentPercent: number
  blockingReason: string | null
} {
  const contract = MASTERY_CONTRACTS[cognitiveType] || MASTERY_CONTRACTS.conceptual

  const missingRequired: string[] = []
  const missingOptional: string[] = []
  let requiredMet = 0
  let requiredTotal = contract.requiredEvidence.length

  // Verificar evidencias requeridas
  for (const req of contract.requiredEvidence) {
    const strong = evidenceProfile.strongCount[req.type] || 0
    const medium = evidenceProfile.mediumCount[req.type] || 0
    if (strong >= req.minStrong || (req.minStrong === 0 && medium >= req.minMedium)) {
      requiredMet++
    } else {
      missingRequired.push(req.description)
    }
  }

  // Verificar opcionales
  for (const opt of contract.optionalEvidence) {
    const strong = evidenceProfile.strongCount[opt.type] || 0
    const medium = evidenceProfile.mediumCount[opt.type] || 0
    if (strong < opt.minStrong && medium < opt.minMedium) {
      missingOptional.push(opt.description)
    }
  }

  // Score mínimo
  if (evidenceProfile.masteryScore < contract.minimumMasteryScore) {
    missingRequired.push(`Score ${evidenceProfile.masteryScore}% < ${contract.minimumMasteryScore}% requerido`)
  }

  // Verificar extras del contrato
  const p = params || {}
  let blockingReason: string | null = null

  if (contract.requiresDelayedRecall && !p.hasDelayedRecall) {
    blockingReason = blockingReason || 'Falta verificar retención tras tiempo'
  }
  if (contract.requiresTransfer && !p.hasTransfer) {
    blockingReason = blockingReason || 'Falta transferencia a contexto nuevo'
  }
  if (contract.requiresIntegration && !p.hasIntegration) {
    blockingReason = blockingReason || 'Falta integración con otros conceptos'
  }

  // Nivel de asistencia
  const assistanceLevels = ['independent', 'minimal_hint', 'guided', 'assisted', 'revealed']
  const maxAllowed = assistanceLevels.indexOf(contract.maxAssistanceLevel)
  const maxUsed = assistanceLevels.indexOf(p.maxAssistanceLevelUsed || 'independent')
  if (maxUsed > maxAllowed) {
    blockingReason = blockingReason || `Necesita demostrar dominio con menos ayuda (máx: ${contract.maxAssistanceLevel})`
  }

  const totalChecks = requiredTotal + (contract.minimumMasteryScore > 0 ? 1 : 0)
  const passed = requiredMet + (evidenceProfile.masteryScore >= contract.minimumMasteryScore ? 1 : 0)
  const fulfillmentPercent = totalChecks > 0 ? Math.round((passed / totalChecks) * 100) : 0

  const fulfilled = missingRequired.length === 0 && !blockingReason

  return {
    fulfilled,
    missingRequired,
    missingOptional,
    fulfillmentPercent,
    blockingReason,
  }
}

// ═══════════════════════════════════════════════════════════════
// OBTENER CONTRATO PARA UN TIPO COGNITIVO
// ═══════════════════════════════════════════════════════════════
export function getContractForType(cognitiveType: CognitiveType): MasteryContract {
  return MASTERY_CONTRACTS[cognitiveType] || MASTERY_CONTRACTS.conceptual
}

// ═══════════════════════════════════════════════════════════════
// RESUMEN DE DOMINIO MULTI-NIVEL (para UI)
// ═══════════════════════════════════════════════════════════════
export function getDomainLevels(
  cognitiveType: CognitiveType,
  evidenceProfile: {
    strongCount: Record<EvidenceType, number>
    mediumCount: Record<EvidenceType, number>
    masteryScore: number
  },
): {
  exposure: boolean       // Lo vio
  recognition: boolean    // Lo reconoce
  recall: boolean         // Lo recuerda sin ayuda
  comprehension: boolean  // Puede explicarlo
  application: boolean    // Puede usarlo
  connection: boolean     // Lo conecta con otros
  transfer: boolean       // Lo usa en contexto nuevo
  retention: boolean      // Lo recuerda tras tiempo
} {
  const s = evidenceProfile.strongCount
  const m = evidenceProfile.mediumCount

  return {
    exposure: evidenceProfile.masteryScore > 0 || (s.recognized + m.recognized) > 0,
    recognition: (s.recognized + m.recognized) >= 1,
    recall: (s.recalled + m.recalled) >= 1,
    comprehension: (s.explained + m.explained) >= 1,
    application: (s.applied + m.applied) >= 1,
    connection: (s.connected + m.connected) >= 1,
    transfer: (s.transferred + m.transferred) >= 1,
    retention: (s.retained + m.retained) >= 1,
  }
}
