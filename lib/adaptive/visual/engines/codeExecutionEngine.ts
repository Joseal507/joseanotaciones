import type { CodeExecutionDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'
import { normalizeToken, evaluateArithmeticWithVariables } from './shared'

export interface CodeExecutionExtraction { data: CodeExecutionDataSpec; sourceSpans: VisualSourceSpan[] }

// Patrones que, si aparecen en el lado derecho de una asignación o en
// cualquier línea, sacan esa línea (y por tanto TODO el código) fuera del
// subset seguro — control de flujo, definiciones, comparaciones, cualquier
// cosa que no sea aritmética pura sobre variables ya conocidas.
const UNSAFE_PATTERN = /==|!=|<=|>=|[<>]|\bif\b|\belse\b|\bfor\b|\bwhile\b|\bdef\b|\bclass\b|\bimport\b|\breturn\b|\blambda\b|[\[\]{}"'.,]/

// Deriva una traza determinista EJECUTANDO (sin eval()/Function(), ver
// evaluateArithmeticWithVariables) un subset explícito y seguro: líneas
// secuenciales `identificador = expresión aritmética` y, opcionalmente,
// `print(identificador)`. Nada de control de flujo, llamadas a funciones
// (salvo print de una variable), strings, listas ni módulos. Cualquier línea
// fuera de ese subset, o cualquier identificador usado antes de asignarse,
// hace fallar TODA la derivación (fail closed — nunca una traza parcial).
function deriveTraceFromCode(code: string): CodeExecutionDataSpec['steps'] | null {
  const lines = code.split('\n').map(line => line.trim()).filter(Boolean)
  if (!lines.length) return null

  const variables: Record<string, number> = {}
  const steps: CodeExecutionDataSpec['steps'] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1
    const printMatch = line.match(/^print\(\s*([A-Za-z_]\w*)\s*\)$/)
    if (printMatch) {
      const name = printMatch[1]
      if (!(name in variables)) return null
      steps.push({ line: lineNumber, variables: { ...variables }, output: String(variables[name]) })
      continue
    }
    const assignMatch = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/)
    if (!assignMatch) return null
    const [, name, expr] = assignMatch
    if (UNSAFE_PATTERN.test(line)) return null
    const value = evaluateArithmeticWithVariables(expr, variables)
    if (value === null) return null
    variables[name] = value
    steps.push({ line: lineNumber, variables: { ...variables } })
  }

  return steps.length ? steps : null
}

// Extrae el bloque de código (siempre literal/verbatim del material — nunca se
// reescribe) y la traza. Dos caminos, en orden:
//  1) Traza EXPLÍCITAMENTE descrita en el material (formato "Traza: línea 1
//     x=3; línea 2 y=6; línea 3 salida=6.") — compat con material que YA la
//     narra así.
//  2) Si no hay narración de traza, DERIVAR la traza determinísticamente
//     interpretando el código mismo (deriveTraceFromCode) — solo dentro del
//     subset seguro; fuera de él, null (fail closed, nunca se inventa).
// Nunca ejecuta código arbitrario ni infiere valores no derivables.
export function extractCodeExecutionSpec(sourceText: string, factKeys: string[], sourceStepId: string): CodeExecutionExtraction | null {
  const codeMatch = sourceText.match(/```(\w+)?\n([\s\S]*?)```/)
  if (!codeMatch) return null

  const language = codeMatch[1] || 'text'
  const code = codeMatch[2].trim()

  const traceSegment = sourceText.match(/Traza:\s*([^\n]+)/)?.[1]
  if (traceSegment) {
    const stepEntries = traceSegment.split(';').map(part => part.trim().replace(/\.$/, '')).filter(Boolean)
    const steps: CodeExecutionDataSpec['steps'] = []
    for (const entry of stepEntries) {
      const lineMatch = entry.match(/l[ií]nea\s*(\d+)\s+(.+)/i)
      if (!lineMatch) continue
      const line = Number(lineMatch[1])
      const rest = lineMatch[2]
      const outputMatch = rest.match(/salida\s*=\s*(.+)/i)
      const variables: Record<string, string | number | boolean> = {}
      for (const assignment of rest.matchAll(/(\w+)\s*=\s*([^,]+)/g)) {
        if (/^salida$/i.test(assignment[1])) continue
        const raw = assignment[2].trim()
        const numeric = Number(raw)
        variables[assignment[1]] = Number.isFinite(numeric) && raw !== '' ? numeric : raw
      }
      const step: CodeExecutionDataSpec['steps'][number] = { line, variables }
      if (outputMatch) step.output = outputMatch[1].trim()
      steps.push(step)
    }
    if (steps.length) {
      return {
        data: { language, code, steps },
        sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: traceSegment.trim() })),
      }
    }
  }

  const derivedSteps = deriveTraceFromCode(code)
  if (derivedSteps && derivedSteps.length) {
    return {
      data: { language, code, steps: derivedSteps },
      sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: code })),
    }
  }

  return null
}

export function gradeCodeExecutionInteraction(
  data: CodeExecutionDataSpec,
  verb: 'predict_output',
  response: unknown,
): VisualGradingResult {
  const submitted = response as { line?: number; variable?: string; value?: string } | null
  if (!submitted || typeof submitted.line !== 'number') {
    return { correct: false, score: 0, evidenceKind: 'visual_interpretation', feedback: 'Indica el valor predicho.', errorType: 'missing_response' }
  }
  const step = data.steps.find(candidate => candidate.line === submitted.line)
  if (!step) {
    return { correct: false, score: 0, evidenceKind: 'visual_interpretation', feedback: 'Línea fuera de la traza.', errorType: 'ungradeable' }
  }
  const expected = submitted.variable === 'output' || !submitted.variable
    ? step.output
    : step.variables[submitted.variable]
  const correct = expected !== undefined && normalizeToken(submitted.value) === normalizeToken(String(expected))
  return {
    correct,
    score: correct ? 100 : 0,
    evidenceKind: 'visual_interpretation',
    feedback: correct ? 'Traza predicha correctamente.' : `El valor esperado en la línea ${submitted.line} es "${expected}".`,
    errorType: correct ? null : 'execution_trace',
  }
}
