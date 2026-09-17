import type { GraphDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'
import { evaluateExpression } from './shared'

export interface GraphExtraction { data: GraphDataSpec; sourceSpans: VisualSourceSpan[] }

// Extrae la expresión, dominio y puntos EXPLÍCITAMENTE presentes en el texto real del
// material. Nunca inventa una expresión ni un dominio que no esté escrito — si no hay
// expresión detectable, devuelve null (FASE 6).
export function extractGraphSpec(sourceText: string, factKeys: string[], sourceStepId: string): GraphExtraction | null {
  const normalized = sourceText.replace(/²/g, '^2').replace(/³/g, '^3').replace(/−/g, '-').replace(/×/g, '*')
  let match = normalized.match(/\b(f\s*\(\s*x\s*\)|y)\s*=\s*([^\n]+)/i)
  let rawExpression = match ? match[2] : ''
  let quote = match ? match[0] : ''

  if (!match) {
    const eqZero = normalized.match(/([0-9xX.+\-*/^() ]+)\s*=\s*0\b/)
    if (eqZero) {
      rawExpression = eqZero[1]
      quote = eqZero[0]
    } else {
      return null
    }
  }

  // Strip leading delimiter if present
  const cleanRaw = rawExpression.replace(/^\\\(|^\$|^\s*=\s*/, '').trim()
  // Split on sentence boundaries, punctuation + space, closing delimiters, or prose words
  const splitMatch = cleanRaw.split(/(?:\s+(?:abre|con|en|para|donde|tiene|cuya|cuyo|corte|vértice|vertice|raíces|raices)\b|[.,;]\s|[.,;]$|\\\)|\\]|\$)/i)
  const expression = (splitMatch[0] || '').trim().replace(/[.,;:+\-*/^]+$/, '').trim()

  if (!expression || expression.length > 512 || ![0, 1, 2].some(x => evaluateExpression(expression, x) !== null)) return null

  const domainMatch = sourceText.match(/-?\d+(?:\.\d+)?\s*(?:≤|<=)\s*x\s*(?:≤|<=)\s*-?\d+(?:\.\d+)?/)
  let domain: [number, number] = [-10, 10]
  if (domainMatch) {
    const numbers = domainMatch[0].match(/-?\d+(?:\.\d+)?/g)
    if (numbers && numbers.length === 2) domain = [Number(numbers[0]), Number(numbers[1])]
  }
  if (domain[0] >= domain[1] || domain.some(n => !Number.isFinite(n) || Math.abs(n) > 10000)) return null

function detectQuadraticParameters(expression: string): { isQuadratic: boolean; a: number; b: number; c: number } {
  const h = 0.005
  const evalAt = (x: number) => evaluateExpression(expression, x)
  const f_m1 = evalAt(-1), f_0 = evalAt(0), f_1 = evalAt(1)
  if (f_m1 === null || f_0 === null || f_1 === null) {
    return { isQuadratic: false, a: 0, b: 0, c: 0 }
  }

  const f_m1_ph = evalAt(-1 + h), f_m1_mh = evalAt(-1 - h)
  const f_0_ph = evalAt(h), f_0_mh = evalAt(-h)
  const f_1_ph = evalAt(1 + h), f_1_mh = evalAt(1 - h)
  if (f_m1_ph === null || f_m1_mh === null || f_0_ph === null || f_0_mh === null || f_1_ph === null || f_1_mh === null) {
    return { isQuadratic: false, a: 0, b: 0, c: 0 }
  }

  const d2_m1 = (f_m1_ph - 2 * f_m1 + f_m1_mh) / (h * h)
  const d2_0 = (f_0_ph - 2 * f_0 + f_0_mh) / (h * h)
  const d2_1 = (f_1_ph - 2 * f_1 + f_1_mh) / (h * h)

  if (!Number.isFinite(d2_m1) || !Number.isFinite(d2_0) || !Number.isFinite(d2_1)) {
    return { isQuadratic: false, a: 0, b: 0, c: 0 }
  }

  if (Math.abs(d2_m1 - d2_0) > 0.05 || Math.abs(d2_1 - d2_0) > 0.05 || Math.abs(d2_0) < 1e-4) {
    return { isQuadratic: false, a: 0, b: 0, c: 0 }
  }

  const a = d2_0 / 2
  const b = (f_0_ph - f_0_mh) / (2 * h)
  const c = f_0

  const f_2 = evalAt(2)
  if (f_2 !== null) {
    const expected_2 = a * 4 + b * 2 + c
    if (Math.abs(f_2 - expected_2) > 0.05) {
      return { isQuadratic: false, a: 0, b: 0, c: 0 }
    }
  }

  return { isQuadratic: true, a, b, c }
}

  const rawPoints = Array.from({ length: 161 }, (_, index) => {
    const x = domain[0] + ((domain[1] - domain[0]) * index) / 160
    const y = evaluateExpression(expression, x)
    return {
      x: Math.round(x * 1000) / 1000,
      y: y === null || !Number.isFinite(y) ? null : Math.round(y * 1000) / 1000,
    }
  })

  const validPointsCount = rawPoints.filter(p => p.y !== null).length
  if (validPointsCount < 20) return null

  // Split into segments across undefined points or steep asymptote jumps
  const segments: Array<Array<{ x: number; y: number }>> = []
  let currentSegment: Array<{ x: number; y: number }> = []

  for (let i = 0; i < rawPoints.length; i++) {
    const pt = rawPoints[i]
    if (pt.y === null || Math.abs(pt.y) > 1000) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment)
        currentSegment = []
      }
      continue
    }

    if (currentSegment.length > 0) {
      const prev = currentSegment[currentSegment.length - 1]
      const deltaY = Math.abs(pt.y - prev.y)
      const isSignFlip = (pt.y > 0 && prev.y < 0) || (pt.y < 0 && prev.y > 0)
      if ((isSignFlip && deltaY > 30) || deltaY > 150) {
        segments.push(currentSegment)
        currentSegment = []
      }
    }

    currentSegment.push({ x: pt.x, y: pt.y })
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment)
  }

  const sampledPoints: Array<{ x: number; y: number; label?: string }> = segments.flat()
  if (sampledPoints.length < 5) return null

  // Only label exact mathematical vertices for quadratic functions
  const quad = detectQuadraticParameters(expression)
  if (quad.isQuadratic && Math.abs(quad.a) > 1e-6) {
    const xv = Math.round((-quad.b / (2 * quad.a)) * 1000) / 1000
    const yvVal = evaluateExpression(expression, xv)
    if (yvVal !== null && Number.isFinite(yvVal) && xv >= domain[0] && xv <= domain[1]) {
      const yv = Math.round(yvVal * 1000) / 1000
      let existing = sampledPoints.find(p => Math.abs(p.x - xv) < 1e-4)
      if (existing) {
        existing.label = `Vértice (${xv}, ${yv})`
      } else {
        sampledPoints.push({ x: xv, y: yv, label: `Vértice (${xv}, ${yv})` })
        sampledPoints.sort((p1, p2) => p1.x - p2.x)
      }
    }

    const disc = quad.b * quad.b - 4 * quad.a * quad.c
    if (disc >= 0) {
      const sqrtD = Math.sqrt(disc)
      const r1 = Math.round(((-quad.b - sqrtD) / (2 * quad.a)) * 1000) / 1000
      const r2 = Math.round(((-quad.b + sqrtD) / (2 * quad.a)) * 1000) / 1000
      for (const r of [r1, r2]) {
        if (r >= domain[0] && r <= domain[1]) {
          let existing = sampledPoints.find(p => Math.abs(p.x - r) < 1e-4)
          if (existing) {
            if (!existing.label) existing.label = `Raíz (${r}, 0)`
          } else {
            sampledPoints.push({ x: r, y: 0, label: `Raíz (${r}, 0)` })
          }
        }
      }
      sampledPoints.sort((p1, p2) => p1.x - p2.x)
    }
  }

  // Detect Y-intercept at x = 0
  const yAtZero = evaluateExpression(expression, 0)
  if (yAtZero !== null && Number.isFinite(yAtZero) && domain[0] <= 0 && domain[1] >= 0) {
    const y0 = Math.round(yAtZero * 1000) / 1000
    let existing = sampledPoints.find(p => Math.abs(p.x) < 1e-4)
    if (existing) {
      if (!existing.label) existing.label = `Corte Y (0, ${y0})`
    } else {
      sampledPoints.push({ x: 0, y: y0, label: `Corte Y (0, ${y0})` })
      sampledPoints.sort((p1, p2) => p1.x - p2.x)
    }
  }

  return {
    data: { expression, domain, points: sampledPoints, segments },
    sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote })),
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
