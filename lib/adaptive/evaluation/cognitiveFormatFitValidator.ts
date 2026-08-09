/**
 * cognitiveFormatFitValidator.ts
 *
 * Guard determinista mínimo (P3.2): un objetivo etiquetado application/transfer
 * no puede evaluarse con un variant que FORMAT_LIBRARY (pedagogicalFormatSelector.ts,
 * única fuente de verdad — no se duplica aquí) solo reconoce como recognition puro.
 * Ejemplos reales que este guard bloquea: "transfer" evaluado con
 * true_false_factual o mcq_best_answer (recall literal); "application" evaluado
 * con true_false_factual.
 *
 * NO es una cuota de variedad — es una verificación de COMPATIBILIDAD, no de
 * distribución. Un variant no catalogado (no aparece en FORMAT_LIBRARY, p.ej. uno
 * inventado por el LLM fuera del catálogo) no se rechaza por este guard — eso ya
 * lo cubre canonicalQuestionFormat/formatOk en diagnoseEvaluationBlock.
 */

import { cognitiveLevelsForVariant, type CognitiveLevel } from './pedagogicalFormatSelector'

export interface CognitiveFormatFitResult {
  valid: boolean
  reason?: string
}

const KNOWN_LEVELS = new Set<CognitiveLevel>(['recognition', 'comprehension', 'application', 'transfer'])

export function validateCognitiveFormatFit(question: {
  cognitiveTarget?: unknown
  variant?: unknown
}): CognitiveFormatFitResult {
  const cognitiveTarget = String(question.cognitiveTarget || '')
  if (!KNOWN_LEVELS.has(cognitiveTarget as CognitiveLevel)) return { valid: true } // fuera del taxonomy conocido: no juzgar
  const variant = String(question.variant || '')
  if (!variant) return { valid: true } // sin variant declarado: nada que verificar aquí

  const allowedLevels = cognitiveLevelsForVariant(variant)
  if (!allowedLevels) return { valid: true } // variant no catalogado: no rechazar por falta de dato

  if (!allowedLevels.includes(cognitiveTarget as CognitiveLevel)) {
    return { valid: false, reason: `COGNITIVE_FORMAT_MISMATCH:${cognitiveTarget}:${variant}` }
  }
  return { valid: true }
}
