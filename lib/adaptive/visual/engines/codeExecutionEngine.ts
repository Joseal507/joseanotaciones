import type { CodeExecutionDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'
import { normalizeToken } from './shared'

export interface CodeExecutionExtraction { data: CodeExecutionDataSpec; sourceSpans: VisualSourceSpan[] }

// Extrae el bloque de código y la traza EXPLÍCITAMENTE descrita en el material
// (formato "Traza: línea 1 x=3; línea 2 y=6; línea 3 salida=6."). Nunca ejecuta el
// código ni infiere valores no declarados.
export function extractCodeExecutionSpec(sourceText: string, factKeys: string[], sourceStepId: string): CodeExecutionExtraction | null {
  const codeMatch = sourceText.match(/```(\w+)?\n([\s\S]*?)```/)
  const traceSegment = sourceText.match(/Traza:\s*([^\n]+)/)?.[1]
  if (!codeMatch || !traceSegment) return null

  const language = codeMatch[1] || 'text'
  const code = codeMatch[2].trim()

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
  if (!steps.length) return null

  return {
    data: { language, code, steps },
    sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: traceSegment.trim() })),
  }
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
