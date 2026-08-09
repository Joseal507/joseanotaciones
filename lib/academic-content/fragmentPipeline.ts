import { normalizeAcademicContent } from './validation'
import type { AcademicDocument, AcademicValidation } from './types'

export interface AcademicFragmentResult {
  valid: boolean
  source: string
  document: AcademicDocument
  validation: AcademicValidation
  attempts: number
}

export async function normalizeOrRegenerateAcademicFragment(
  source: string,
  regenerate: (fragment: string, issues: string[], attempt: number) => Promise<string>,
  maxRegenerations = 2,
): Promise<AcademicFragmentResult> {
  let candidate = source
  for (let attempt = 0; attempt <= maxRegenerations; attempt++) {
    const normalized = normalizeAcademicContent(candidate)
    if (normalized.validation.valid) {
      return {
        valid: true,
        source: normalized.source,
        document: normalized.document,
        validation: normalized.validation,
        attempts: attempt,
      }
    }
    if (attempt === maxRegenerations) {
      return {
        valid: false,
        source: '',
        document: normalized.document,
        validation: normalized.validation,
        attempts: attempt,
      }
    }
    candidate = await regenerate(
      candidate,
      normalized.validation.issues.map(issue => issue.code),
      attempt + 1,
    )
  }
  throw new Error('Unreachable academic fragment state')
}
