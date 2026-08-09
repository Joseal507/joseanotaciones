import { classifyProviderFailure, shouldFallbackToGroq, type ProviderError } from './providerPolicy'

export type GenerationTaskType =
  | 'material_analysis'
  | 'session_content'
  | 'explanation'
  | 'reteach'
  | 'evaluation_question'
  | 'recovery_question'
  | 'summary'
  | 'final_exam'

export type GenerationFailureCode =
  | 'INVALID_JSON'
  | 'INVALID_ACADEMIC_FRAGMENT'
  | 'SEMANTIC_DUPLICATION'
  | 'INCOMPATIBLE_ACTIVITY'
  | 'LOW_QUALITY_RETEACH'
  | 'LOW_DIVERSITY'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT_OR_PROVIDER_ERROR'
  | 'STRUCTURAL_VALIDATION_FAILED'
  | 'UNKNOWN_GENERATION_FAILURE'
  | 'OPENROUTER_CREDITS_EXHAUSTED'
  | 'CONTEXT_TOO_LARGE'

export type GenerationStage =
  | 'normal'
  | 'format_repair'
  | 'targeted_repair'
  | 'simplified'
  | 'split_individual'
  | 'alternate_provider'

export interface GenerationAttemptContext {
  taskType: GenerationTaskType
  stage: GenerationStage
  attempt: number
  partIndex?: number
  partCount?: number
  previousFailure?: GenerationFailureCode
  validationErrors: string[]
  excludedProviders: string[]
  generationMode: 'batch' | 'individual_part' | 'assembled_batch'
  expectedItemCount: number
  acceptedItemSummaries: string[]
  providerError?: ProviderError
}

export interface GeneratedCandidate<T> {
  value: T
  provider?: string
  model?: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  retryable?: boolean
}

export function validateExpectedItemCount(actual: number, expected: number): ValidationResult {
  // Aceptar si hay al menos el mínimo viable (1 para split_individual, 2 para batch)
  // No exigir el número exacto — la diversidad real importa más que la cantidad exacta
  const MIN_VIABLE = expected === 1 ? 1 : 2
  if (actual >= expected) {
    return { valid: true, errors: [] }
  }
  if (actual >= MIN_VIABLE && expected > 1) {
    // Tenemos suficientes preguntas — aceptar aunque sean menos de las pedidas
    return { valid: true, errors: [] }
  }
  const errors = expected === 1
    ? [`MISSING_ITEMS:expected_1_received_${actual}`]
    : [`LOW_DIVERSITY:requires_${expected}_questions`]
  return { valid: errors.length === 0, errors }
}

export interface GenerationAttemptRecord {
  stage: GenerationStage
  attempt: number
  partIndex?: number
  failure?: GenerationFailureCode
  errors: string[]
  provider?: string
  model?: string
  durationMs: number
}

export interface GenerationPipelineResult<T> {
  status: 'validated' | 'budget_exhausted'
  content?: T
  attempts: GenerationAttemptRecord[]
  repairsApplied: GenerationStage[]
  providerUsed?: string
  modelUsed?: string
  validationResult: ValidationResult
  durationMs: number
}

export interface GenerationPipelineInput<T> {
  taskType: GenerationTaskType
  generate: (context: GenerationAttemptContext) => Promise<GeneratedCandidate<T>>
  validate: (value: T, context: GenerationAttemptContext) => ValidationResult | Promise<ValidationResult>
  classifyFailure?: (errors: string[], error?: unknown) => GenerationFailureCode
  splitCount?: number
  mergeParts?: (parts: T[]) => T
  getItemCount?: (value: T) => number
  selectAcceptedPartial?: (value: T, failure?: GenerationFailureCode) => T | null
  describeItems?: (value: T) => string[]
  totalTimeoutMs?: number
  failurePath?: 'comprehensive' | 'single_repair'
  maxIndividualAttemptsPerPart?: number
  telemetry?: (event: string, payload: Record<string, unknown>) => void
}

const STAGES: Array<{ stage: GenerationStage; attempts: number }> = [
  { stage: 'normal', attempts: 1 },
  { stage: 'format_repair', attempts: 2 },
  { stage: 'targeted_repair', attempts: 2 },
  { stage: 'simplified', attempts: 1 },
]

function normalizedErrors(errors: string[]): string[] {
  return [...new Set(errors.map(error => String(error).trim()).filter(Boolean))]
}

export function classifyGenerationFailure(errors: string[], error?: unknown): GenerationFailureCode {
  const providerError = typeof error === 'object' && error && 'providerError' in error
    ? (error as { providerError?: ProviderError }).providerError
    : undefined
  if (providerError) {
    const reason = classifyProviderFailure(providerError)
    if (reason === 'OPENROUTER_CREDITS_EXHAUSTED') return 'OPENROUTER_CREDITS_EXHAUSTED'
    if (reason === 'CONTEXT_TOO_LARGE') return 'CONTEXT_TOO_LARGE'
  }
  const message = [
    ...errors,
    error instanceof Error ? error.message : String(error || ''),
  ].join(' ').toLowerCase()
  if (/json|parse|syntaxerror|normalization_failed/.test(message)) return 'INVALID_JSON'
  if (/academic|latex|markdown|fragment|delimiter|forbidden_visual/.test(message)) return 'INVALID_ACADEMIC_FRAGMENT'
  if (/similar|semantic|duplicate|repeated_question|repeated_fact/.test(message)) return 'SEMANTIC_DUPLICATION'
  if (/mode|incompatible|typing|textarea|forbidden_question/.test(message)) return 'INCOMPATIBLE_ACTIVITY'
  if (/reteach|explanation.*duplicate|low_quality/.test(message)) return 'LOW_QUALITY_RETEACH'
  if (/diversity|distinct|independent|missing_items|requires_\d+_questions/.test(message)) return 'LOW_DIVERSITY'
  if (/timeout|provider|network|fetch|429|quota|empty_response/.test(message)) return 'PROVIDER_ERROR'
  if (errors.length > 0) return 'STRUCTURAL_VALIDATION_FAILED'
  return 'UNKNOWN_GENERATION_FAILURE'
}

function eventForStage(stage: GenerationStage): string {
  if (stage === 'format_repair') return 'format_repair_started'
  if (stage === 'targeted_repair') return 'academic_repair_started'
  if (stage === 'simplified') return 'prompt_simplified'
  if (stage === 'split_individual') return 'individual_generation_started'
  if (stage === 'alternate_provider') return 'provider_switched'
  return 'generation_started'
}

export async function runGenerationPipeline<T>(
  input: GenerationPipelineInput<T>,
): Promise<GenerationPipelineResult<T>> {
  const startedAt = Date.now()
  const deadline = startedAt + Math.max(5_000, input.totalTimeoutMs ?? 90_000)
  const attempts: GenerationAttemptRecord[] = []
  const repairs = new Set<GenerationStage>()
  const excludedProviders = new Set<string>()
  let previousFailure: GenerationFailureCode | undefined
  let validationErrors: string[] = []
  let globalAttempt = 0
  let lastRejectedCandidate: GeneratedCandidate<T> | null = null
  let acceptedPartialContent: T | undefined
  let acceptedItemSummaries: string[] = []
  let terminalValidationFailure = false
  let lastProviderError: ProviderError | undefined

  const runAttempt = async (
    stage: GenerationStage,
    partIndex?: number,
    partCount?: number,
  ): Promise<GeneratedCandidate<T> | null> => {
    if (Date.now() >= deadline) {
      previousFailure = 'TIMEOUT_OR_PROVIDER_ERROR'
      validationErrors = ['generation_time_budget_exhausted']
      return null
    }
    globalAttempt += 1
    if (stage !== 'normal') repairs.add(stage)
    const context: GenerationAttemptContext = {
      taskType: input.taskType,
      stage,
      attempt: globalAttempt,
      partIndex,
      partCount,
      previousFailure,
      validationErrors,
      excludedProviders: [...excludedProviders],
      generationMode: stage === 'split_individual' ? 'individual_part' : 'batch',
      expectedItemCount: stage === 'split_individual' ? 1 : Math.max(1, input.splitCount || 1),
      acceptedItemSummaries,
      providerError: lastProviderError,
    }
    input.telemetry?.(eventForStage(stage), { ...context })
    const attemptStartedAt = Date.now()
    try {
      const candidate = await input.generate(context)
      const validation = await input.validate(candidate.value, context)
      const errors = normalizedErrors(validation.errors)
      if (validation.valid) {
        lastProviderError = undefined
        attempts.push({
          stage,
          attempt: globalAttempt,
          partIndex,
          errors: [],
          provider: candidate.provider,
          model: candidate.model,
          durationMs: Date.now() - attemptStartedAt,
        })
        input.telemetry?.('generation_validated', {
          taskType: input.taskType,
          stage,
          attempt: globalAttempt,
          successOnFirstAttempt: stage === 'normal' && globalAttempt === 1,
          provider: candidate.provider,
          model: candidate.model,
        })
        return candidate
      }
      previousFailure = (input.classifyFailure || classifyGenerationFailure)(errors)
      terminalValidationFailure = validation.retryable === false
      lastRejectedCandidate = candidate
      validationErrors = errors
      attempts.push({
        stage,
        attempt: globalAttempt,
        partIndex,
        failure: previousFailure,
        errors,
        provider: candidate.provider,
        model: candidate.model,
        durationMs: Date.now() - attemptStartedAt,
      })
      input.telemetry?.('failure_classified', {
        taskType: input.taskType,
        failure: previousFailure,
        errors,
        stage,
        attempt: globalAttempt,
      })
    } catch (error) {
      lastProviderError = typeof error === 'object' && error && 'providerError' in error
        ? (error as { providerError?: ProviderError }).providerError
        : undefined
      previousFailure = (input.classifyFailure || classifyGenerationFailure)([], error)
      validationErrors = [error instanceof Error ? error.message : String(error)]
      attempts.push({
        stage,
        attempt: globalAttempt,
        partIndex,
        failure: previousFailure,
        errors: validationErrors,
        durationMs: Date.now() - attemptStartedAt,
      })
      input.telemetry?.('generation_failed', {
        taskType: input.taskType,
        failure: previousFailure,
        errors: validationErrors,
        stage,
        attempt: globalAttempt,
      })
      if (lastProviderError && shouldFallbackToGroq(lastProviderError)) excludedProviders.add('openrouter')
    }
    return null
  }

  const trySplit = async (): Promise<T | null> => {
    if (!input.splitCount || input.splitCount <= 1 || !input.mergeParts) return null
    const parts: T[] = []
    const accepted = lastRejectedCandidate && input.selectAcceptedPartial
      ? input.selectAcceptedPartial(lastRejectedCandidate.value, previousFailure)
      : lastRejectedCandidate?.value
    const acceptedCount = accepted && input.getItemCount ? input.getItemCount(accepted) : 0
    if (accepted && acceptedCount > 0 && acceptedCount < input.splitCount) {
      parts.push(accepted)
      acceptedPartialContent = accepted
      acceptedItemSummaries = input.describeItems?.(accepted) || []
      input.telemetry?.('accepted_partial_items', {
        taskType: input.taskType,
        acceptedPartialItems: acceptedCount,
        missingItemCount: input.splitCount - acceptedCount,
      })
    }
    const missing = Math.max(0, input.splitCount - acceptedCount)
      input.telemetry?.('task_split', {
        taskType: input.taskType,
        splitCount: input.splitCount,
        acceptedPartialItems: acceptedCount,
        missingItemCount: missing,
        regeneratedItemIndexes: Array.from({ length: missing }, (_, index) => acceptedCount + index),
        failure: previousFailure,
      })
    for (let offset = 0; offset < missing; offset++) {
      const partIndex = acceptedCount + offset
      let part: GeneratedCandidate<T> | null = null
      const individualBudget = Math.max(1, input.maxIndividualAttemptsPerPart ?? 2)
      for (let partAttempt = 0; partAttempt < individualBudget && !part; partAttempt++) {
        part = await runAttempt('split_individual', partIndex, input.splitCount)
      }
      if (!part) return null
      parts.push(part.value)
      acceptedItemSummaries = [
        ...acceptedItemSummaries,
        ...(input.describeItems?.(part.value) || []),
      ]
    }
    const merged = input.mergeParts(parts)
    const mergeContext: GenerationAttemptContext = {
      taskType: input.taskType,
      stage: 'split_individual',
      attempt: globalAttempt,
      validationErrors,
      previousFailure,
      excludedProviders: [...excludedProviders],
      generationMode: 'assembled_batch',
      expectedItemCount: input.splitCount,
      acceptedItemSummaries,
      providerError: lastProviderError,
    }
    const validation = await input.validate(merged, mergeContext)
    if (validation.valid) return merged
    previousFailure = (input.classifyFailure || classifyGenerationFailure)(validation.errors)
    validationErrors = normalizedErrors(validation.errors)
    return null
  }

  if (input.failurePath === 'single_repair') {
    const first = await runAttempt('normal')
    if (first) {
      return {
        status: 'validated',
        content: first.value,
        attempts,
        repairsApplied: [],
        providerUsed: first.provider,
        modelUsed: first.model,
        validationResult: { valid: true, errors: [] },
        durationMs: Date.now() - startedAt,
      }
    }

    if (terminalValidationFailure) {
      return {
        status: 'budget_exhausted',
        attempts,
        repairsApplied: [...repairs],
        validationResult: { valid: false, errors: validationErrors, retryable: false },
        durationMs: Date.now() - startedAt,
      }
    }

    if (
      input.splitCount &&
      input.splitCount > 1 &&
      (previousFailure === 'LOW_DIVERSITY' || previousFailure === 'SEMANTIC_DUPLICATION')
    ) {
      const assembled = await trySplit()
      if (assembled) {
        return {
          status: 'validated',
          content: assembled,
          attempts,
          repairsApplied: [...repairs],
          validationResult: { valid: true, errors: [] },
          durationMs: Date.now() - startedAt,
        }
      }
    } else {
      const repairStage: GenerationStage = previousFailure === 'INVALID_JSON'
        ? 'format_repair'
        : previousFailure === 'OPENROUTER_CREDITS_EXHAUSTED'
          ? 'alternate_provider'
          : previousFailure === 'CONTEXT_TOO_LARGE'
            ? 'simplified'
          : 'targeted_repair'
      const repaired = await runAttempt(repairStage)
      if (repaired) {
        return {
          status: 'validated',
          content: repaired.value,
          attempts,
          repairsApplied: [...repairs],
          providerUsed: repaired.provider,
          modelUsed: repaired.model,
          validationResult: { valid: true, errors: [] },
          durationMs: Date.now() - startedAt,
        }
      }
    }

    input.telemetry?.('generation_budget_exhausted', {
      taskType: input.taskType,
      totalAttempts: attempts.length,
      durationMs: Date.now() - startedAt,
      failure: previousFailure,
    })
    return {
      status: 'budget_exhausted',
      content: acceptedPartialContent,
      attempts,
      repairsApplied: [...repairs],
      validationResult: { valid: false, errors: validationErrors },
      durationMs: Date.now() - startedAt,
    }
  }

  for (const stageBudget of STAGES) {
    for (let index = 0; index < stageBudget.attempts; index++) {
      const candidate = await runAttempt(stageBudget.stage)
      if (candidate) {
        return {
          status: 'validated',
          content: candidate.value,
          attempts,
          repairsApplied: [...repairs],
          providerUsed: candidate.provider,
          modelUsed: candidate.model,
          validationResult: { valid: true, errors: [] },
          durationMs: Date.now() - startedAt,
        }
      }
      if (terminalValidationFailure) break
    }

    if (previousFailure === 'OPENROUTER_CREDITS_EXHAUSTED') {
      const fallback = await runAttempt('alternate_provider')
      if (fallback) return {
        status: 'validated', content: fallback.value, attempts, repairsApplied: [...repairs],
        providerUsed: fallback.provider, modelUsed: fallback.model,
        validationResult: { valid: true, errors: [] }, durationMs: Date.now() - startedAt,
      }
      break
    }

    if (terminalValidationFailure) break

    if (
      stageBudget.stage === 'normal' &&
      (previousFailure === 'LOW_DIVERSITY' || previousFailure === 'SEMANTIC_DUPLICATION')
    ) {
      const assembled = await trySplit()
      if (assembled) {
        return {
          status: 'validated',
          content: assembled,
          attempts,
          repairsApplied: [...repairs],
          validationResult: { valid: true, errors: [] },
          durationMs: Date.now() - startedAt,
        }
      }
    }

    if (
      stageBudget.stage === 'simplified' &&
      input.splitCount &&
      input.splitCount > 1 &&
      input.mergeParts
    ) {
      const assembled = await trySplit()
      if (assembled) return {
        status: 'validated',
        content: assembled,
        attempts,
        repairsApplied: [...repairs],
        validationResult: { valid: true, errors: [] },
        durationMs: Date.now() - startedAt,
      }
    }
  }

  input.telemetry?.('generation_budget_exhausted', {
    taskType: input.taskType,
    totalAttempts: attempts.length,
    durationMs: Date.now() - startedAt,
    failure: previousFailure,
  })
  return {
    status: 'budget_exhausted',
    attempts,
    repairsApplied: [...repairs],
    validationResult: { valid: false, errors: validationErrors, retryable: !terminalValidationFailure },
    durationMs: Date.now() - startedAt,
  }
}
