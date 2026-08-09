import {
  normalizeGeneratedQuestion,
  validateQuestion,
  type CanonicalQuestion,
  type GenerationContext,
} from './questionContract'

export interface GenerationAttempt {
  raw: unknown
  attempt: number
}

export interface GenerationSuccess {
  success: true
  question: CanonicalQuestion
  attempts: number
}

export interface GenerationFailure {
  success: false
  invalidQuestion: true
  attempts: number
  errors: string[]
}

export async function generateValidQuestion(
  generate: (attempt: number, previousErrors: string[]) => Promise<unknown>,
  context: GenerationContext,
  recent: CanonicalQuestion[],
  maxAttempts = 3,
): Promise<GenerationSuccess | GenerationFailure> {
  let errors: string[] = []
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await generate(attempt, errors)
    const question = normalizeGeneratedQuestion(raw, context, `q_${Date.now()}_${attempt}`)
    if (!question) {
      errors = ['normalization_failed']
      continue
    }
    const validation = validateQuestion(question, context, recent)
    if (validation.valid) return { success: true, question, attempts: attempt }
    errors = validation.errors
  }
  return { success: false, invalidQuestion: true, attempts: maxAttempts, errors }
}
