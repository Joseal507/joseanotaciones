import { sanitizeLatex } from '../sanitizeLatex'

export interface PreparedReteachContent {
  content: string
  usedFallback: boolean
  validationReason?: string
}

export function prepareReteachContent(
  generatedContent: string,
  safeFallback: string,
): PreparedReteachContent {
  try {
    return {
      content: sanitizeLatex(generatedContent),
      usedFallback: false,
    }
  } catch (error) {
    return {
      content: safeFallback,
      usedFallback: true,
      validationReason: error instanceof Error ? error.message : 'INVALID_ACADEMIC_FRAGMENT',
    }
  }
}
