import type { TimelineDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'

export interface TimelineExtraction { data: TimelineDataSpec; sourceSpans: VisualSourceSpan[] }

// Extrae eventos fechados EXPLÍCITAMENTE presentes en el material. Antes exigía
// el año pegado al inicio de su propia oración ("1848: descripción.") — una
// paráfrasis pedagógicamente equivalente ("El descubrimiento data de 1848,
// mientras que la publicación llegó en 1859...") nunca coincidía aunque ambos
// años siguieran ahí, grounded, sin inventar nada. Generalización estructural
// (no depende de ninguna frase ni asignatura específica): se segmenta por
// CLÁUSULA (frontera universal de prosa — punto, coma, punto y coma — no solo
// fin de oración, porque dos años pueden convivir en una misma oración de
// contraste/comparación), y cualquier cláusula que contenga un año de 4
// dígitos se toma como un evento. Supportive-only por diseño (ver
// visualNeedClassifier): nunca gatilla required_for_mastery, así que la
// ausencia de visual nunca bloquea.
export function extractTimelineSpec(sourceText: string, factKeys: string[], sourceStepId: string): TimelineExtraction | null {
  const clauses = sourceText.split(/(?<=[.!?,;])\s+|\n+/).map(s => s.trim()).filter(Boolean)
  const found: Array<{ year: number; label: string; raw: string }> = []
  for (const clause of clauses) {
    const yearMatch = clause.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)
    if (!yearMatch) continue
    const label = clause.replace(/[.!?,;]$/, '').trim()
    if (!label) continue
    found.push({ year: Number(yearMatch[1]), label, raw: clause })
  }
  if (found.length < 2) return null
  const sorted = [...found].sort((a, b) => a.year - b.year)
  const events = sorted.map((item, index) => ({
    id: `event_${index + 1}`,
    label: item.label,
    date: String(item.year),
    order: index + 1,
  }))
  return {
    data: { events },
    sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: found[0].raw })),
  }
}

export function gradeTimelineInteraction(
  data: TimelineDataSpec,
  verb: 'order_sequence',
  response: unknown,
): VisualGradingResult {
  const submitted = Array.isArray(response) ? response as string[] : null
  if (!submitted) {
    return { correct: false, score: 0, evidenceKind: 'visual_interpretation', feedback: 'Ordena los eventos.', errorType: 'missing_response' }
  }
  const expectedOrder = [...data.events].sort((a, b) => a.order - b.order).map(event => event.id)
  const hits = submitted.filter((id, index) => id === expectedOrder[index]).length
  const score = expectedOrder.length ? Math.round((hits / expectedOrder.length) * 100) : 0
  const correct = score === 100
  return {
    correct,
    score,
    evidenceKind: 'visual_interpretation',
    feedback: correct ? 'Orden cronológico correcto.' : 'El orden cronológico tiene al menos un evento fuera de lugar.',
    errorType: correct ? null : 'chronological_order',
  }
}
