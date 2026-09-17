import type { ImportanceRationale, ImportanceSignal, ImportanceTier } from './types'

// ============================================================
// Importance multi-señal. Nunca depende solo del juicio libre
// del LLM — ese juicio ('model_judged') es señal secundaria y,
// sola, nunca alcanza para declarar 'critical'. Cero keywords de
// materia: todas las señales son estructurales (formato del
// material, repetición, relaciones) o el propio juicio del modelo,
// nunca coincidencia de palabras de un dominio específico.
// ============================================================

const HEADING_LINE = /^\s{0,3}#{1,6}\s+.+$/m
const EMPHASIS_WRAP = /(\*\*|__)([^*_]{3,80})\1/

/**
 * Señal estructural barata en el momento de extracción: ¿la cita
 * aparece envuelta en énfasis (negrita) o justo debajo de un
 * encabezado del chunk? Ninguna de las dos cosas depende del
 * contenido/dominio — solo del formato que el propio material trae.
 */
export function detectStructuralEmphasis(chunkText: string, quote: string): { declared: boolean; emphasized: boolean } {
  const trimmedQuote = String(quote || '').trim()
  if (!trimmedQuote) return { declared: false, emphasized: false }

  const quoteIndex = chunkText.indexOf(trimmedQuote.slice(0, Math.min(40, trimmedQuote.length)))
  let declared = false
  if (quoteIndex >= 0) {
    const precedingWindow = chunkText.slice(Math.max(0, quoteIndex - 200), quoteIndex)
    declared = HEADING_LINE.test(precedingWindow)
  }

  const emphasized = EMPHASIS_WRAP.test(trimmedQuote) || (
    quoteIndex >= 0 && EMPHASIS_WRAP.test(chunkText.slice(Math.max(0, quoteIndex - 20), quoteIndex + trimmedQuote.length + 20))
  )

  return { declared, emphasized }
}

export interface ImportanceInputs {
  declaredInMaterial: boolean // detectStructuralEmphasis(...).declared, OR de todas las provenance tras merge
  examMarked: boolean // detectStructuralEmphasis(...).emphasized, OR de todas las provenance tras merge
  repeatedAcrossPages: boolean // provenance.length > 1 tras merge (evidencia independiente)
  prerequisiteFor: boolean // la unidad es destino de una relation 'depends_on'/'part_of'
  modelSuggestedTier: ImportanceTier | null
}

export function combineImportance(inputs: ImportanceInputs): ImportanceSignal {
  const signals: ImportanceRationale[] = []
  if (inputs.declaredInMaterial) signals.push('declared_in_material')
  if (inputs.repeatedAcrossPages) signals.push('repeated_across_pages')
  if (inputs.prerequisiteFor) signals.push('prerequisite_for')
  if (inputs.examMarked) signals.push('exam_marked')

  const structuralScore = signals.length
  if (inputs.modelSuggestedTier) signals.push('model_judged')

  let tier: ImportanceTier
  if (structuralScore >= 2) {
    tier = 'critical'
  } else if (structuralScore === 1) {
    // Una señal estructural garantiza al menos 'supporting'; el modelo
    // puede subirla a 'critical' pero nunca bajarla a 'contextual'.
    tier = inputs.modelSuggestedTier === 'critical' ? 'critical' : 'supporting'
  } else {
    // Sin ninguna señal estructural: el juicio del modelo decide entre
    // supporting/contextual, pero NUNCA declara 'critical' en solitario.
    tier = inputs.modelSuggestedTier === 'contextual' ? 'contextual' : (inputs.modelSuggestedTier ? 'supporting' : 'contextual')
  }

  const confidence = Math.min(0.95, 0.4 + structuralScore * 0.22 + (inputs.modelSuggestedTier ? 0.05 : 0))

  return { tier, signals, confidence: Math.round(confidence * 100) / 100 }
}
