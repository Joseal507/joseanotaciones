import { normalizeAcademicContent } from '../academic-content/validation'
import type { AcademicDocument } from '../academic-content/types'

interface AcademicStep {
  title?: unknown
  content?: unknown
  keyPoint?: unknown
  [key: string]: unknown
}

function normalizeField(value: unknown, field: string): { source: string; document: AcademicDocument } {
  const source = typeof value === 'string'
    ? value
    : value === null || value === undefined
      ? ''
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : ''
  const normalized = normalizeAcademicContent(source)
  if (!normalized.validation.valid) {
    throw new Error(`INVALID_ACADEMIC_FRAGMENT:${field}:${normalized.validation.issues.map(issue => issue.code).join(',')}`)
  }
  return { source: normalized.source, document: normalized.document }
}

/**
 * Compatibilidad de nombre para consumidores existentes.
 * Ya no reescribe fórmulas ni Unicode: valida mediante el AST universal y
 * conserva exactamente la fuente cuando es segura.
 */
export function sanitizeLatex(text: string): string {
  return normalizeField(text, 'content').source
}

export function sanitizeStep(step: AcademicStep): AcademicStep {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return step
  const title = normalizeField(step.title, 'step.title')
  const content = normalizeField(step.content, 'step.content')
  const keyPoint = step.keyPoint === null || step.keyPoint === undefined
    ? null
    : normalizeField(step.keyPoint, 'step.keyPoint')
  return {
    ...step,
    title: title.source,
    content: content.source,
    keyPoint: keyPoint?.source ?? null,
    academicContent: {
      title: title.document,
      content: content.document,
      keyPoint: keyPoint?.document ?? null,
    },
  }
}

export function sanitizeClassContent<T>(classContent: T): T {
  if (!classContent || typeof classContent !== 'object' || Array.isArray(classContent)) return classContent
  const record = classContent as Record<string, unknown>
  const intro = normalizeField(record.sessionIntro, 'sessionIntro')
  const closing = normalizeField(record.sessionClosing, 'sessionClosing')
  const steps = Array.isArray(record.steps) ? record.steps.map(step => sanitizeStep(step as AcademicStep)) : record.steps
  return {
    ...record,
    sessionIntro: intro.source,
    sessionClosing: closing.source,
    steps,
    academicContent: {
      sessionIntro: intro.document,
      sessionClosing: closing.document,
    },
  } as unknown as T
}
