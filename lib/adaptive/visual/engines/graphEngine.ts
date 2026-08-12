import type { GraphDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'
import { evaluateExpression } from './shared'

export interface GraphExtraction { data: GraphDataSpec; sourceSpans: VisualSourceSpan[] }

// Extrae la expresión, dominio y puntos EXPLÍCITAMENTE presentes en el texto real del
// material. Nunca inventa una expresión ni un dominio que no esté escrito — si no hay
// expresión detectable, devuelve null (FASE 6).
export function extractGraphSpec(sourceText: string, factKeys: string[], sourceStepId: string): GraphExtraction | null {
  const term = String.raw`(?:\d+(?:\.\d+)?(?:\s*\*?\s*x(?:\s*\^\s*\d+)?)?|x(?:\s*\^\s*\d+)?)`
  const match = sourceText.match(new RegExp(String.raw`\b(f\s*\(\s*x\s*\)|y)\s*=\s*([+\-]?\s*${term}(?:\s*[+\-]\s*${term})*)`, 'i'))
  if (!match) return null
  const expression = match[2].trim().replace(/[.,;:]$/, '').trim()
  if (evaluateExpression(expression, 1) === null) return null

  const domainMatch = sourceText.match(/-?\d+(?:\.\d+)?\s*(?:≤|<=)\s*x\s*(?:≤|<=)\s*-?\d+(?:\.\d+)?/)
  let domain: [number, number] = [-10, 10]
  if (domainMatch) {
    const numbers = domainMatch[0].match(/-?\d+(?:\.\d+)?/g)
    if (numbers && numbers.length === 2) domain = [Number(numbers[0]), Number(numbers[1])]
  }

  const explicitPoints = [...sourceText.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)]
    .map(point => ({ x: Number(point[1]), y: Number(point[2]) }))

  const sampledPoints = explicitPoints.length
    ? explicitPoints
    : Array.from({ length: 5 }, (_, index) => {
        const x = domain[0] + ((domain[1] - domain[0]) * index) / 4
        const y = evaluateExpression(expression, x)
        return y === null ? null : { x, y: Math.round(y * 1000) / 1000 }
      }).filter((point): point is { x: number; y: number } => point !== null)

  return {
    data: { expression, domain, points: sampledPoints },
    sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: match[0] })),
  }
}

export function gradeGraphInteraction(
  data: GraphDataSpec,
  verb: 'select_region',
  response: unknown,
): VisualGradingResult {
  const submitted = response as { x?: number; y?: number } | null
  if (!submitted || typeof submitted.x !== 'number' || typeof submitted.y !== 'number') {
    return { correct: false, score: 0, evidenceKind: 'visual_interpretation', feedback: 'Respuesta incompleta.', errorType: 'missing_response' }
  }
  const expected = evaluateExpression(data.expression, submitted.x)
  if (expected === null) {
    return { correct: false, score: 0, evidenceKind: 'visual_interpretation', feedback: 'No se pudo evaluar la función en ese punto.', errorType: 'ungradeable' }
  }
  const tolerance = Math.max(0.25, Math.abs(expected) * 0.05)
  const correct = Math.abs(submitted.y - expected) <= tolerance
  return {
    correct,
    score: correct ? 100 : 0,
    evidenceKind: 'visual_interpretation',
    feedback: correct
      ? `Correcto: f(${submitted.x}) ≈ ${expected.toFixed(2)}.`
      : `El valor esperado en x=${submitted.x} es aproximadamente ${expected.toFixed(2)}.`,
    errorType: correct ? null : 'graph_interpretation',
  }
}
