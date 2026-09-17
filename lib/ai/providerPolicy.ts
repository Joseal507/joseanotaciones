export type ProviderFailureReason =
  | 'OPENROUTER_CREDITS_EXHAUSTED'
  | 'INVALID_RESPONSE'
  | 'CONTEXT_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'TEMPORARY_PROVIDER_FAILURE'
  | 'AUTH_ERROR'
  | 'PROVIDER_CONFIGURATION_ERROR'
  | 'UNKNOWN_PROVIDER_ERROR'

export interface ProviderError {
  provider?: string
  status?: number
  statusCode?: number
  message?: string
  body?: unknown
  responseBody?: unknown
}

const financialExhaustion = /\b(?:insufficient\s+(?:credits?|balance)|credits?\s+(?:exhausted|depleted)|quota\s+exhausted|payment\s+required|credit\s+limit\s+reached|out\s+of\s+credits?)\b/i
const invalidResponse = /INVALID_JSON|INVALID_ACADEMIC_FRAGMENT|STRUCTURAL_VALIDATION_FAILED|SESSION_EVALUATION_COVERAGE|RECOVERY_TARGET_DRIFT|LOW_DIVERSITY|SEMANTIC_DUPLICATION|INCOMPATIBLE_ACTIVITY|parse|truncat|empty.response|schema|render/i
// The OpenAI SDK's OWN client-side request-option validator
// (`validatePositiveInteger` in openai/core.js) throws this exact message
// shape BEFORE any network request is attempted, whenever a per-call
// option object merely contains a `timeout`/`maxRetries` key with a
// non-integer value (including an explicitly-set `undefined`). This is a
// deterministic local/config defect, never a transient network condition
// — despite literally containing the word "timeout", it must never be
// bucketed with TEMPORARY_PROVIDER_FAILURE (which implies "retry may
// help"): no number of retries or repair stages can fix a client-side
// options object bug. Matched on the SDK's own fixed error text, not on
// domain/academic keywords.
const providerConfigurationError = /\bmust be an? (?:positive )?integer\b/i

const textOf = (error: ProviderError): string => [
  error.message,
  typeof error.body === 'string' ? error.body : error.body ? JSON.stringify(error.body) : '',
  typeof error.responseBody === 'string' ? error.responseBody : error.responseBody ? JSON.stringify(error.responseBody) : '',
].filter(Boolean).join(' ')

export function classifyProviderFailure(error: ProviderError): ProviderFailureReason {
  const provider = String(error.provider || '').toLowerCase()
  const status = Number(error.status ?? error.statusCode ?? 0)
  const message = textOf(error)
  if (providerConfigurationError.test(message)) return 'PROVIDER_CONFIGURATION_ERROR'
  if (provider === 'openrouter' && [402, 403, 429].includes(status) && financialExhaustion.test(message)) return 'OPENROUTER_CREDITS_EXHAUSTED'
  if (status === 413 || /context.too.large|maximum context|context length|token limit/i.test(message)) return 'CONTEXT_TOO_LARGE'
  if (invalidResponse.test(message)) return 'INVALID_RESPONSE'
  if (status === 429 || /rate limit|too many requests/i.test(message)) return 'RATE_LIMITED'
  if ([408, 500, 502, 503, 504].includes(status) || /timeout|timed out|temporar|network|fetch failed/i.test(message)) return 'TEMPORARY_PROVIDER_FAILURE'
  if ([401, 403].includes(status)) return 'AUTH_ERROR'
  return 'UNKNOWN_PROVIDER_ERROR'
}

export function shouldFallbackToGroq(error: ProviderError): boolean {
  return classifyProviderFailure(error) === 'OPENROUTER_CREDITS_EXHAUSTED'
}

export function sanitizedProviderMessage(error: ProviderError): string {
  return textOf(error).replace(/(?:sk|key|token)-[A-Za-z0-9_-]{8,}/gi, '[redacted]').replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]').slice(0, 240)
}
