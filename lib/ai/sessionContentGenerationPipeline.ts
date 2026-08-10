import { runIdempotentGeneration } from './generationIdempotency'
import type { ValidationResult } from './generationPipeline'
import { classifyProviderFailure, shouldFallbackToGroq, type ProviderError } from './providerPolicy'

export type SessionContentStage = 'complete_generation' | 'directed_json_repair' | 'split_generation' | 'split_teaching' | 'split_assessment'

export interface SessionContentGenerationContext {
  stage: SessionContentStage
  attempt: 1 | 2 | 3
  rawText: string
  validationErrors: string[]
  acceptedContent?: unknown
  acceptedTeaching?: unknown
  providerFailure: boolean
  excludedProviders: string[]
  providerError?: ProviderError
}

export interface SessionContentCandidate {
  text: string
  provider?: string
  model?: string
}

export interface SessionContentPipelineResult<T> {
  status: 'validated' | 'budget_exhausted'
  content?: T
  stage?: SessionContentStage | 'local_json_repair'
  remoteCalls: number
  validationResult: ValidationResult
  rawOutputs: string[]
  durationMs: number
}

export interface SessionContentPipelineInput<T> {
  generationKey?: string
  generate: (context: SessionContentGenerationContext) => Promise<SessionContentCandidate>
  validate: (value: unknown) => ValidationResult | Promise<ValidationResult>
  validateTeaching?: (value: unknown) => ValidationResult | Promise<ValidationResult>
  validateAssessment?: (value: unknown, teaching: unknown) => ValidationResult | Promise<ValidationResult>
  assemble?: (teaching: unknown, assessment: unknown) => T
  telemetry?: (event: string, payload: Record<string, unknown>) => void
}

function normalizeControlCharacters(source: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (const character of source) {
    if (escaped) {
      result += character
      escaped = false
      continue
    }
    if (character === '\\' && inString) {
      result += character
      escaped = true
      continue
    }
    if (character === '"') {
      inString = !inString
      result += character
      continue
    }
    const code = character.charCodeAt(0)
    if (code < 0x20 && character !== '\n' && character !== '\r' && character !== '\t') {
      result += inString ? ' ' : character
    } else if (inString && character === '\n') result += '\\n'
    else if (inString && character === '\r') result += '\\r'
    else if (inString && character === '\t') result += '\\t'
    else result += character
  }
  return result
}

function extractBalancedObject(source: string): string | null {
  const start = source.indexOf('{')
  if (start < 0) return null
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) { escaped = false; continue }
    if (character === '\\' && inString) { escaped = true; continue }
    if (character === '"') { inString = !inString; continue }
    if (inString) continue
    if (character === '{') stack.push('}')
    else if (character === '[') stack.push(']')
    else if (character === '}' || character === ']') {
      if (stack.pop() !== character) return null
      if (stack.length === 0) return source.slice(start, index + 1)
    }
  }
  if (inString || stack.length === 0) return null
  return source.slice(start).trim().replace(/```\s*$/i, '').trim() + stack.reverse().join('')
}

export function repairJsonLocally(rawText: string): unknown | null {
  if (typeof rawText !== 'string' || !rawText.trim()) return null
  const withoutFences = rawText
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^\uFEFF/, '')
  const normalized = normalizeControlCharacters(withoutFences)
  const extracted = extractBalancedObject(normalized)
  if (!extracted) return null
  const withoutTrailingCommas = extracted.replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(withoutTrailingCommas)
  } catch {
    return null
  }
}

// Retry T\u00C9CNICO acotado para una \u00DANICA llamada remota que exige JSON
// estructurado \u2014 nunca pedagogical repair (coverage, duplicados, matching,
// drift), que sigue viviendo exclusivamente donde ya viv\u00EDa
// (diagnoseEvaluationBlock/repairEvaluationBlock), disparado solo cuando el
// JSON YA es v\u00E1lido pero el contenido pedag\u00F3gico no lo es. Esta funci\u00F3n no
// sabe nada de "bloques" ni "sesiones" \u2014 solo reintenta N veces una llamada
// que puede fallar al parsear, con la MISMA instrucci\u00F3n pedag\u00F3gica en cada
// intento (attempt() decide si a\u00F1ade un aviso de sintaxis en el retry).
// Extra\u00EDda como funci\u00F3n pura e inyectable espec\u00EDficamente para poder
// probarse sin red real ni mocks de fetch (el SDK de OpenAI usa
// require('node-fetch') internamente, no globalThis.fetch \u2014 no interceptable
// desde fuera sin tocar lib/alai.ts).
// Auditoría adversarial (Codex, misión REAL-SESSION QUALITY, A2.1
// CONFIRMADO P1): `params.attempt(...)` se llamaba fuera de cualquier
// try/catch — un throw del proveedor (timeout/429/5xx/network, clasificado
// como TEMPORARY_PROVIDER_FAILURE o RATE_LIMITED por classifyProviderFailure,
// nada que ver con OPENROUTER_CREDITS_EXHAUSTED) escapaba este loop en el
// PRIMER intento, sin consumir el resto de maxAttempts, produciendo un 503
// visible que un simple reload resolvía. `isTransientError` es opcional y
// puramente inyectable — sin él, el comportamiento previo (rethrow
// inmediato) se conserva exactamente igual. Reintenta el MISMO proveedor
// con el MISMO contenido (isRetry ya distingue el aviso de sintaxis en
// attempt()); nunca cambia de proveedor ni toca la política canónica.
export async function withTechnicalJsonRetry<T>(params: {
  maxAttempts: number
  attempt: (attemptNumber: number, isRetry: boolean) => Promise<string>
  parse: (raw: string) => T
  isTransientError?: (error: unknown) => boolean
  onAttemptFailed?: (attemptNumber: number, error: unknown) => void
  onRetryScheduled?: (attemptNumber: number, nextAttempt: number) => void
}): Promise<T> {
  let lastError: unknown
  for (let attemptNumber = 1; attemptNumber <= params.maxAttempts; attemptNumber++) {
    let raw: string
    try {
      raw = await params.attempt(attemptNumber, attemptNumber > 1)
    } catch (error) {
      lastError = error
      params.onAttemptFailed?.(attemptNumber, error)
      const transient = params.isTransientError?.(error) === true
      if (!transient || attemptNumber >= params.maxAttempts) throw error
      params.onRetryScheduled?.(attemptNumber, attemptNumber + 1)
      continue
    }
    try {
      return params.parse(raw)
    } catch (error) {
      lastError = error
      params.onAttemptFailed?.(attemptNumber, error)
      if (attemptNumber >= params.maxAttempts) throw error
      params.onRetryScheduled?.(attemptNumber, attemptNumber + 1)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function executeSessionContentPipeline<T>(
  input: SessionContentPipelineInput<T>,
): Promise<SessionContentPipelineResult<T>> {
  const startedAt = Date.now()
  const rawOutputs: string[] = []
  let remoteCalls = 0
  let rawText = ''
  let errors: string[] = []
  let acceptedContent: unknown
  let acceptedTeaching: unknown
  let lastProviderFailure = false
  let failedProvider: string | undefined
  let lastProviderError: ProviderError | undefined

  const validated = async (candidate: unknown): Promise<{ valid: boolean; validation: ValidationResult }> => {
    if (candidate === null || candidate === undefined) return { valid: false, validation: { valid: false, errors: ['INVALID_JSON'] } }
    const validation = await input.validate(candidate)
    return { valid: validation.valid, validation }
  }

  for (const stage of ['complete_generation', 'directed_json_repair'] as const) {
    remoteCalls += 1
    input.telemetry?.('session_content_remote_call_started', { stage, remoteCalls })
    try {
      const generated = await input.generate({
        stage,
        attempt: remoteCalls as 1 | 2,
        rawText,
        validationErrors: errors,
        acceptedContent,
        providerFailure: lastProviderFailure,
        excludedProviders: lastProviderFailure && failedProvider ? [failedProvider] : [],
        providerError: lastProviderError,
      })
      rawText = generated.text
      rawOutputs.push(rawText)
      lastProviderFailure = false
      failedProvider = undefined
      lastProviderError = undefined
      const candidate = repairJsonLocally(rawText)
      const checked = await validated(candidate)
      if (checked.valid) {
        return {
          status: 'validated', content: candidate as T,
          stage: stage === 'complete_generation' && rawText.trim().startsWith('{') ? stage : 'local_json_repair',
          remoteCalls, validationResult: checked.validation, rawOutputs, durationMs: Date.now() - startedAt,
        }
      }
      if (candidate !== null) acceptedContent = candidate
      errors = checked.validation.errors.length ? checked.validation.errors : ['INVALID_JSON']
    } catch (error) {
      lastProviderError = typeof error === 'object' && error && 'providerError' in error
        ? (error as { providerError?: ProviderError }).providerError
        : undefined
      lastProviderFailure = Boolean(lastProviderError)
      failedProvider = typeof error === 'object' && error && 'alaiProvider' in error
        ? String((error as { alaiProvider?: unknown }).alaiProvider || '') || undefined
        : undefined
      errors = [error instanceof Error ? error.message : String(error)]
      rawOutputs.push(rawText)
      if (lastProviderError && ['OPENROUTER_CREDITS_EXHAUSTED', 'CONTEXT_TOO_LARGE'].includes(classifyProviderFailure(lastProviderError))) break
    }
  }

  if (acceptedContent && input.validateTeaching) {
    const partial = acceptedContent as Record<string, unknown>
    const teachingCandidate = {
      sessionIntro: partial.sessionIntro,
      steps: partial.steps,
      sessionClosing: partial.sessionClosing,
    }
    const teachingValidation = await input.validateTeaching(teachingCandidate)
    if (teachingValidation.valid) acceptedTeaching = teachingCandidate
  }

  if (lastProviderError && ['OPENROUTER_CREDITS_EXHAUSTED', 'CONTEXT_TOO_LARGE'].includes(classifyProviderFailure(lastProviderError)) && input.validateTeaching && input.validateAssessment && input.assemble) {
    try {
      remoteCalls += 1
      const teachingGenerated = await input.generate({
        stage: 'split_teaching', attempt: remoteCalls as 2 | 3, rawText, validationErrors: errors,
        acceptedContent, acceptedTeaching, providerFailure: true, excludedProviders: [], providerError: lastProviderError,
      })
      rawOutputs.push(teachingGenerated.text)
      const teachingParsed = repairJsonLocally(teachingGenerated.text) as Record<string, unknown> | null
      const teaching = teachingParsed?.teaching_content || teachingParsed
      const teachingValidation = await input.validateTeaching(teaching)
      if (!teachingValidation.valid) throw new Error(teachingValidation.errors.join(','))

      remoteCalls += 1
      const assessmentGenerated = await input.generate({
        stage: 'split_assessment', attempt: remoteCalls as 2 | 3, rawText: teachingGenerated.text,
        validationErrors: [], acceptedContent, acceptedTeaching: teaching,
        providerFailure: true, excludedProviders: [], providerError: lastProviderError,
      })
      rawOutputs.push(assessmentGenerated.text)
      const assessmentParsed = repairJsonLocally(assessmentGenerated.text) as Record<string, unknown> | null
      const assessment = assessmentParsed?.assessment_content || assessmentParsed
      const assessmentValidation = await input.validateAssessment(assessment, teaching)
      if (!assessmentValidation.valid) throw new Error(assessmentValidation.errors.join(','))
      const assembled = input.assemble(teaching, assessment)
      const finalValidation = await input.validate(assembled)
      if (finalValidation.valid) return {
        status: 'validated', content: assembled, stage: 'split_assessment', remoteCalls,
        validationResult: finalValidation, rawOutputs, durationMs: Date.now() - startedAt,
      }
      errors = finalValidation.errors
    } catch (error) {
      errors = [error instanceof Error ? error.message : String(error)]
    }
    return { status: 'budget_exhausted', remoteCalls, validationResult: { valid: false, errors }, rawOutputs, durationMs: Date.now() - startedAt }
  }

  remoteCalls += 1
  input.telemetry?.('session_content_remote_call_started', { stage: 'split_generation', remoteCalls })
  try {
    const generated = await input.generate({
      stage: 'split_generation', attempt: (remoteCalls as 2 | 3), rawText, validationErrors: errors,
      acceptedContent, acceptedTeaching, providerFailure: lastProviderFailure,
      excludedProviders: lastProviderFailure && failedProvider ? [failedProvider] : [],
      providerError: lastProviderError,
    })
    rawOutputs.push(generated.text)
    const split = repairJsonLocally(generated.text) as Record<string, unknown> | null
    const teaching = acceptedTeaching || split?.teaching_content
    const assessment = split?.assessment_content
    if (teaching && assessment && input.validateTeaching && input.validateAssessment && input.assemble) {
      const teachingValidation = await input.validateTeaching(teaching)
      const assessmentValidation = await input.validateAssessment(assessment, teaching)
      if (teachingValidation.valid && assessmentValidation.valid) {
        const assembled = input.assemble(teaching, assessment)
        const finalValidation = await input.validate(assembled)
        if (finalValidation.valid) {
          return {
            status: 'validated', content: assembled, stage: 'split_generation', remoteCalls,
            validationResult: finalValidation, rawOutputs, durationMs: Date.now() - startedAt,
          }
        }
        errors = finalValidation.errors
      } else errors = [...teachingValidation.errors, ...assessmentValidation.errors]
    } else errors = ['SESSION_CONTENT_SPLIT_INVALID']
  } catch (error) {
    errors = [error instanceof Error ? error.message : String(error)]
  }
  return {
    status: 'budget_exhausted', remoteCalls, validationResult: { valid: false, errors },
    rawOutputs, durationMs: Date.now() - startedAt,
  }
}

export function runSessionContentGenerationPipeline<T>(
  input: SessionContentPipelineInput<T>,
): Promise<SessionContentPipelineResult<T>> {
  return runIdempotentGeneration(input.generationKey, () => executeSessionContentPipeline(input), () => {
    input.telemetry?.('session_content_duplicate_suppressed', { generationKey: input.generationKey })
  })
}
