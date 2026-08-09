/**
 * recoveryTelemetry.ts
 *
 * Telemetría pedagógica de recovery y evaluación.
 * Mide calidad real: no solo si falló, sino por qué, cuánto tardó,
 * qué proveedor falló más, qué formatos generan más bloqueos.
 *
 * Sin side effects. Solo funciones puras que producen payloads de log.
 * Integrable sobre el motor existente sin cambiar contratos.
 */

// ─── Tipos de eventos ────────────────────────────────────────

export type RecoveryTelemetryEvent =
  | 'verification_generation_auto_retry_scheduled'
  | 'verification_generation_auto_retry_started'
  | 'verification_generation_auto_retry_succeeded'
  | 'verification_generation_auto_retry_abandoned'
  | 'recovery_provider_fragility_detected'
  | 'recovery_format_rejection_detected'
  | 'recovery_repetition_detected'
  | 'recovery_round_quality_summary'
  | 'recovery_session_summary'

export interface RetryScheduledPayload {
  event: 'verification_generation_auto_retry_scheduled'
  recoveryId: string
  recoveryTargetId: string
  verificationRound: number
  verificationGenerationVersion: number
  delayMs: number
  previousFailure?: string
  attemptsSoFar: number
  sessionId?: string
}

export interface RetryStartedPayload {
  event: 'verification_generation_auto_retry_started'
  recoveryId: string
  verificationRound: number
  verificationGenerationVersion: number
  sessionId?: string
}

export interface RetrySucceededPayload {
  event: 'verification_generation_auto_retry_succeeded'
  recoveryId: string
  verificationRound: number
  verificationGenerationVersion: number
  totalAutoRetries: number
  totalDurationMs: number
  sessionId?: string
}

export interface RetryAbandonedPayload {
  event: 'verification_generation_auto_retry_abandoned'
  recoveryId: string
  verificationRound: number
  verificationGenerationVersion: number
  reason: 'status_changed' | 'item_not_found' | 'max_versions_reached'
  sessionId?: string
}

export interface ProviderFragilityPayload {
  event: 'recovery_provider_fragility_detected'
  recoveryId: string
  provider: string
  model: string
  failureCode: string
  consecutiveProviderFailures: number
  sessionId?: string
}

export interface FormatRejectionPayload {
  event: 'recovery_format_rejection_detected'
  recoveryId: string
  rejectedFormat: string
  rejectionReason: string
  evaluationMode: string
  originalFormat: string
  sessionId?: string
}

export interface RepetitionPayload {
  event: 'recovery_repetition_detected'
  recoveryId: string
  questionId: string
  similarity: number
  previousQuestionId: string
  sessionId?: string
}

export interface RoundQualitySummaryPayload {
  event: 'recovery_round_quality_summary'
  recoveryId: string
  verificationRound: number
  totalGenerationAttempts: number
  totalAutoRetries: number
  questionsGenerated: number
  questionsAccepted: number
  questionsRejected: number
  rejectionReasons: string[]
  providerUsed: string
  formatUsed: string
  durationMs: number
  resolved: boolean
  sessionId?: string
}

export interface SessionSummaryPayload {
  event: 'recovery_session_summary'
  sessionId: string
  totalRecoveryItems: number
  resolvedItems: number
  unresolvedItems: number
  totalReteachRounds: number
  totalVerificationRounds: number
  totalAutoRetries: number
  averageRoundsToResolve: number
  mostProblematicFormat: string | null
  mostFrequentRejectionReason: string | null
}

export type RecoveryTelemetryPayload =
  | RetryScheduledPayload
  | RetryStartedPayload
  | RetrySucceededPayload
  | RetryAbandonedPayload
  | ProviderFragilityPayload
  | FormatRejectionPayload
  | RepetitionPayload
  | RoundQualitySummaryPayload
  | SessionSummaryPayload

// ─── Acumulador de métricas de recovery ──────────────────────
//
// Vive en memoria durante la sesión.
// Se resetea cuando se monta un nuevo SessionPage.
// No persiste — solo se usa para telemetría.

export interface RecoveryMetrics {
  recoveryId: string
  startedAt: number
  totalGenerationAttempts: number
  totalAutoRetries: number
  autoRetryStartedAt: number | null
  rejectionReasons: string[]
  formatRejections: string[]
  repetitionDetections: number
  providerFailures: Record<string, number>
  resolvedAt: number | null
}

const sessionMetrics = new Map<string, RecoveryMetrics>()

export function initRecoveryMetrics(recoveryId: string): void {
  if (!sessionMetrics.has(recoveryId)) {
    sessionMetrics.set(recoveryId, {
      recoveryId,
      startedAt: Date.now(),
      totalGenerationAttempts: 0,
      totalAutoRetries: 0,
      autoRetryStartedAt: null,
      rejectionReasons: [],
      formatRejections: [],
      repetitionDetections: 0,
      providerFailures: {},
      resolvedAt: null,
    })
  }
}

export function recordGenerationAttempt(recoveryId: string): void {
  const m = sessionMetrics.get(recoveryId)
  if (m) m.totalGenerationAttempts += 1
}

export function recordAutoRetry(recoveryId: string): void {
  const m = sessionMetrics.get(recoveryId)
  if (m) {
    m.totalAutoRetries += 1
    m.autoRetryStartedAt = m.autoRetryStartedAt ?? Date.now()
  }
}

export function recordRejectionReason(recoveryId: string, reason: string): void {
  const m = sessionMetrics.get(recoveryId)
  if (m) m.rejectionReasons.push(reason)
}

export function recordFormatRejection(recoveryId: string, format: string): void {
  const m = sessionMetrics.get(recoveryId)
  if (m) m.formatRejections.push(format)
}

export function recordRepetition(recoveryId: string): void {
  const m = sessionMetrics.get(recoveryId)
  if (m) m.repetitionDetections += 1
}

export function recordProviderFailure(recoveryId: string, provider: string): void {
  const m = sessionMetrics.get(recoveryId)
  if (m) {
    m.providerFailures[provider] = (m.providerFailures[provider] || 0) + 1
  }
}

export function recordResolved(recoveryId: string): void {
  const m = sessionMetrics.get(recoveryId)
  if (m) m.resolvedAt = Date.now()
}

export function getRecoveryMetrics(recoveryId: string): RecoveryMetrics | null {
  return sessionMetrics.get(recoveryId) ?? null
}

export function clearRecoveryMetrics(recoveryId: string): void {
  sessionMetrics.delete(recoveryId)
}

export function clearAllRecoveryMetrics(): void {
  sessionMetrics.clear()
}

// ─── Constructores de payloads ────────────────────────────────

export function buildRetryScheduledPayload(params: {
  recoveryId: string
  recoveryTargetId: string
  verificationRound: number
  verificationGenerationVersion: number
  delayMs: number
  previousFailure?: string
  sessionId?: string
}): RetryScheduledPayload {
  const m = sessionMetrics.get(params.recoveryId)
  return {
    event: 'verification_generation_auto_retry_scheduled',
    ...params,
    attemptsSoFar: m?.totalAutoRetries ?? 0,
  }
}

export function buildRetryStartedPayload(params: {
  recoveryId: string
  verificationRound: number
  verificationGenerationVersion: number
  sessionId?: string
}): RetryStartedPayload {
  return { event: 'verification_generation_auto_retry_started', ...params }
}

export function buildRetrySucceededPayload(params: {
  recoveryId: string
  verificationRound: number
  verificationGenerationVersion: number
  sessionId?: string
}): RetrySucceededPayload {
  const m = sessionMetrics.get(params.recoveryId)
  const now = Date.now()
  return {
    event: 'verification_generation_auto_retry_succeeded',
    ...params,
    totalAutoRetries: m?.totalAutoRetries ?? 0,
    totalDurationMs: m ? now - (m.autoRetryStartedAt ?? now) : 0,
  }
}

export function buildRetryAbandonedPayload(params: {
  recoveryId: string
  verificationRound: number
  verificationGenerationVersion: number
  reason: RetryAbandonedPayload['reason']
  sessionId?: string
}): RetryAbandonedPayload {
  return { event: 'verification_generation_auto_retry_abandoned', ...params }
}

export function buildRoundQualitySummary(params: {
  recoveryId: string
  verificationRound: number
  questionsGenerated: number
  questionsAccepted: number
  questionsRejected: number
  providerUsed: string
  formatUsed: string
  durationMs: number
  resolved: boolean
  sessionId?: string
}): RoundQualitySummaryPayload {
  const m = sessionMetrics.get(params.recoveryId)
  return {
    event: 'recovery_round_quality_summary',
    ...params,
    totalGenerationAttempts: m?.totalGenerationAttempts ?? 0,
    totalAutoRetries: m?.totalAutoRetries ?? 0,
    rejectionReasons: m?.rejectionReasons ?? [],
  }
}

export function buildSessionSummary(
  sessionId: string,
  recoveryIds: string[],
): SessionSummaryPayload {
  // TELEMETRÍA: best-effort. Nunca puede romper completion.
  // Filtramos undefined/null explícitamente antes de acceder a campos.
  const metrics = (recoveryIds ?? [])
    .map(id => {
      try { return sessionMetrics.get(id) ?? null }
      catch { return null }
    })
    .filter((m): m is RecoveryMetrics => m != null && typeof m === 'object')

  const resolved = metrics.filter(m => m != null && m.resolvedAt !== null)
  const unresolved = metrics.filter(m => m != null && m.resolvedAt === null)

  const allReasons = metrics.flatMap(m => m.rejectionReasons)
  const reasonCounts = allReasons.reduce<Record<string, number>>((acc, r) => {
    acc[r] = (acc[r] || 0) + 1
    return acc
  }, {})
  const mostFrequentReason = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const allFormats = metrics.flatMap(m => m.formatRejections)
  const formatCounts = allFormats.reduce<Record<string, number>>((acc, f) => {
    acc[f] = (acc[f] || 0) + 1
    return acc
  }, {})
  const mostProblematicFormat = Object.entries(formatCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const totalAutoRetries = metrics.reduce((sum, m) => sum + m.totalAutoRetries, 0)

  const averageRoundsToResolve = resolved.length > 0
    ? resolved.reduce((sum, m) => sum + m.totalGenerationAttempts, 0) / resolved.length
    : 0

  return {
    event: 'recovery_session_summary',
    sessionId,
    totalRecoveryItems: metrics.length,
    resolvedItems: resolved.length,
    unresolvedItems: unresolved.length,
    totalReteachRounds: metrics.reduce((sum, m) => sum + m.totalGenerationAttempts, 0),
    totalVerificationRounds: metrics.reduce((sum, m) => sum + m.totalAutoRetries, 0),
    totalAutoRetries,
    averageRoundsToResolve: Math.round(averageRoundsToResolve * 10) / 10,
    mostProblematicFormat,
    mostFrequentRejectionReason: mostFrequentReason,
  }
}
