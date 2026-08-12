export type SessionReadiness =
  | 'NOT_STARTED'
  | 'TEACHING_GENERATING'
  | 'TEACHING_READY'
  | 'EVALUATION_GENERATING'
  | 'REPAIRING'
  | 'READY'
  | 'RECOVERABLE'
  | 'FATAL'

export type PreparationCheckpoint = 'none' | 'teaching' | 'evaluation_plan' | 'evaluation_blocks' | 'assembled'

export interface PreparationReliabilitySummary {
  sessionId?: string
  generationKey: string
  origin: 'cold' | 'prefetch' | 'restore'
  startedAt: number
  readyAt?: number
  providerCalls: number
  retryCount: number
  repairCount: number
  discardedQuestions: number
  visualFailures: number
  prefetchHit: boolean
  persistRetries: number
  abortedBeforeProvider: number
  abortedAfterProvider: number
  staleResultsIgnored: number
  finalStatus: SessionReadiness
  fatalReason?: string
}

export interface ReadinessInput {
  hasValidTeaching: boolean
  hasValidEvaluationPlan: boolean
  mandatoryCoverageComplete: boolean
  assemblyCanonical: boolean
  activeStage?: string
  fatalReason?: string
}

export function deriveSessionReadiness(input: ReadinessInput): SessionReadiness {
  if (input.fatalReason && !input.hasValidTeaching) return 'FATAL'
  if (input.assemblyCanonical && input.hasValidTeaching && input.mandatoryCoverageComplete) return 'READY'
  if (!input.hasValidTeaching) return input.activeStage === 'teaching_generation' ? 'TEACHING_GENERATING' : 'NOT_STARTED'
  if (!input.hasValidEvaluationPlan) return input.activeStage === 'evaluation_planning' ? 'EVALUATION_GENERATING' : 'TEACHING_READY'
  if (!input.mandatoryCoverageComplete) return input.activeStage === 'evaluation_repair' ? 'REPAIRING' : 'RECOVERABLE'
  return input.activeStage === 'session_assembly_validation' ? 'RECOVERABLE' : 'EVALUATION_GENERATING'
}

export function checkpointForReadiness(readiness: SessionReadiness): PreparationCheckpoint {
  if (readiness === 'READY') return 'assembled'
  if (readiness === 'EVALUATION_GENERATING' || readiness === 'REPAIRING' || readiness === 'RECOVERABLE') return 'evaluation_plan'
  if (readiness === 'TEACHING_READY') return 'teaching'
  return 'none'
}

export type FailureDisposition = 'degradable' | 'retryable' | 'recoverable' | 'fatal'

export function classifyPreparationFailure(stage: string, hasValidTeaching: boolean): FailureDisposition {
  if (stage.startsWith('visual_')) return 'degradable'
  if (hasValidTeaching) return 'recoverable'
  if (stage === 'auth' || stage === 'material_validation' || stage === 'blueprint_validation') return 'fatal'
  return 'retryable'
}

export async function withBoundedRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { maxAttempts: number; onRetry?: (error: unknown, nextAttempt: number) => void },
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= Math.max(1, options.maxAttempts); attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (attempt < options.maxAttempts) options.onRetry?.(error, attempt + 1)
    }
  }
  throw lastError
}

export function createReliabilitySummary(generationKey: string, origin: PreparationReliabilitySummary['origin'] = 'cold'): PreparationReliabilitySummary {
  return {
    generationKey,
    origin,
    startedAt: Date.now(),
    providerCalls: 0,
    retryCount: 0,
    repairCount: 0,
    discardedQuestions: 0,
    visualFailures: 0,
    prefetchHit: false,
    persistRetries: 0,
    abortedBeforeProvider: 0,
    abortedAfterProvider: 0,
    staleResultsIgnored: 0,
    finalStatus: 'NOT_STARTED',
  }
}

export interface PreparationHttpResult {
  success?: boolean
  recoverable?: boolean
  classContent?: unknown
  preparationState?: unknown
}

export async function continueRecoverablePreparation<T extends PreparationHttpResult>(options: {
  request: (preparationState: unknown, attempt: number) => Promise<T>
  initialState?: unknown
  maxAttempts?: number
  wait?: (attempt: number) => Promise<void>
  onCheckpoint?: (state: unknown) => void
}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  let checkpoint = options.initialState
  let last: T | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await options.request(checkpoint, attempt)
    if (last.preparationState) {
      checkpoint = last.preparationState
      options.onCheckpoint?.(checkpoint)
    }
    if (last.success || !last.recoverable) return last
    if (attempt < maxAttempts) await (options.wait?.(attempt) ?? Promise.resolve())
  }
  return last!
}
