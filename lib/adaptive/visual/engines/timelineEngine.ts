import type { TimelineDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'

export interface TimelineExtraction { data: TimelineDataSpec; sourceSpans: VisualSourceSpan[] }

// Extrae eventos fechados EXPLÍCITAMENTE presentes en el material (formato
// "1848: descripción."). Supportive-only por diseño (ver visualNeedClassifier):
// nunca gatilla required_for_mastery, así que la ausencia de visual nunca bloquea.
export function extractTimelineSpec(sourceText: string, factKeys: string[], sourceStepId: string): TimelineExtraction | null {
  const matches = [...sourceText.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b[:\-]?\s*([^.\n]+)\./g)]
  if (matches.length < 2) return null
  const sorted = [...matches].sort((a, b) => Number(a[1]) - Number(b[1]))
  const events = sorted.map((match, index) => ({
    id: `event_${index + 1}`,
    label: match[2].trim(),
    date: match[1],
    order: index + 1,
  }))
  return {
    data: { events },
    sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: matches[0][0] })),
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
