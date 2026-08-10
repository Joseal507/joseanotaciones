import type { SpatialVectorDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'

export interface SpatialVectorExtraction { data: SpatialVectorDataSpec; sourceSpans: VisualSourceSpan[] }

// Extrae fuerzas (etiqueta, magnitud, ángulo) EXPLÍCITAMENTE presentes en el texto
// (formato "Peso = 50 N a 270°"). Nunca infiere una fuerza que no esté escrita.
export function extractSpatialVectorSpec(sourceText: string, factKeys: string[], sourceStepId: string): SpatialVectorExtraction | null {
  const forceMatches = [...sourceText.matchAll(
    /([A-ZÁÉÍÓÚa-záéíóú][A-ZÁÉÍÓÚa-záéíóú\s]{1,20}?)\s*=\s*(\d+(?:\.\d+)?)\s*N\s*(?:a|en)\s*(\d+(?:\.\d+)?)\s*°/g,
  )]
  if (!forceMatches.length) return null

  const bodyMatch = sourceText.match(/Sobre (?:el|la)\s+([^\s]+(?:\s[^\s]+)?)\s+act[uú]an/i)
  const forces = forceMatches.map((match, index) => ({
    id: `force_${index + 1}`,
    label: match[1].trim(),
    magnitude: Number(match[2]),
    angleDeg: Number(match[3]),
    unit: 'N',
  }))

  return {
    data: { body: bodyMatch?.[1]?.trim() || 'cuerpo', forces, axes: { x: 'horizontal', y: 'vertical' } },
    sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: forceMatches[0][0] })),
  }
}

export function gradeSpatialVectorInteraction(
  data: SpatialVectorDataSpec,
  verb: 'place_vector',
  response: unknown,
): VisualGradingResult {
  const submitted = response as Record<string, { angleDeg?: number; magnitude?: number }> | null
  if (!submitted || typeof submitted !== 'object') {
    return { correct: false, score: 0, evidenceKind: 'visual_construction', feedback: 'Ubica cada fuerza en el diagrama.', errorType: 'missing_response' }
  }
  const angleTolerance = 5
  const results = data.forces.map(force => {
    const attempt = submitted[force.id]
    if (!attempt || typeof attempt.angleDeg !== 'number') return false
    const angleOk = Math.abs(attempt.angleDeg - force.angleDeg) <= angleTolerance
    if (force.magnitude === null) return angleOk
    const magnitudeTolerance = Math.max(0.5, force.magnitude * 0.05)
    const magnitudeOk = typeof attempt.magnitude === 'number' && Math.abs(attempt.magnitude - force.magnitude) <= magnitudeTolerance
    return angleOk && magnitudeOk
  })
  const hits = results.filter(Boolean).length
  const score = data.forces.length ? Math.round((hits / data.forces.length) * 100) : 0
  const correct = score === 100
  return {
    correct,
    score,
    evidenceKind: 'visual_construction',
    feedback: correct ? 'Diagrama de cuerpo libre correcto.' : 'Alguna fuerza tiene ángulo o magnitud incorrectos.',
    errorType: correct ? null : 'free_body_diagram',
  }
}
