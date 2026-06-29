
// ═══════════════════════════════════════════════════════════════
// StudyAL — Observabilidad del Sistema Adaptativo
// Trackea latency, chars, retries, provider, fallback y errores.
// Solo activo en development o para admins.
// ═══════════════════════════════════════════════════════════════

export type EndpointId =
  | 'adaptive/explain'
  | 'adaptive/quiz'
  | 'adaptive/flashcards'
  | 'adaptive/exam'
  | 'adaptive/chat'
  | 'adaptive/repair'
  | 'blueprint/build'
  | 'blueprint/graph'
  | 'mastery/update'

export type ErrorTaxonomy =
  | 'rate_limit'       // API key bloqueada
  | 'timeout'          // respuesta muy lenta
  | 'parse_error'      // JSON inválido del LLM
  | 'empty_response'   // LLM devolvió vacío
  | 'network_error'    // problema de red
  | 'auth_error'       // clave inválida
  | 'content_policy'   // contenido bloqueado
  | 'unknown'

export interface ApiCallRecord {
  id: string
  endpoint: EndpointId
  timestamp: number
  latencyMs: number
  inputChars: number
  outputChars: number
  topicTitle?: string
  targetConceptsCount: number
  provider: string
  model: string
  success: boolean
  retryCount: number
  usedFallback: boolean
  fallbackReason?: string
  errorType?: ErrorTaxonomy
  errorMessage?: string
}

export interface ObservabilityState {
  calls: ApiCallRecord[]           // últimas 100 llamadas
  totalCalls: number
  totalErrors: number
  avgLatencyMs: number
  errorsByType: Record<ErrorTaxonomy, number>
  successByEndpoint: Record<string, { ok: number; fail: number }>
  slowestCall: ApiCallRecord | null
  fastestCall: ApiCallRecord | null
  lastUpdated: number
}

// ── Singleton en memoria ─────────────────────────────────────
let _state: ObservabilityState = createEmptyState()

function createEmptyState(): ObservabilityState {
  return {
    calls: [],
    totalCalls: 0,
    totalErrors: 0,
    avgLatencyMs: 0,
    errorsByType: {
      rate_limit: 0, timeout: 0, parse_error: 0, empty_response: 0,
      network_error: 0, auth_error: 0, content_policy: 0, unknown: 0,
    },
    successByEndpoint: {},
    slowestCall: null,
    fastestCall: null,
    lastUpdated: Date.now(),
  }
}

// ── Registrar llamada ─────────────────────────────────────────
export function recordApiCall(record: Omit<ApiCallRecord, 'id'>): void {
  const full: ApiCallRecord = {
    ...record,
    id: Math.random().toString(36).slice(2, 10),
  }

  // Mantener máx 100
  _state.calls = [full, ..._state.calls].slice(0, 100)
  _state.totalCalls += 1
  if (!record.success) _state.totalErrors += 1

  // Avg latency
  const latencies = _state.calls.map(c => c.latencyMs)
  _state.avgLatencyMs = Math.round(
    latencies.reduce((a, b) => a + b, 0) / latencies.length
  )

  // Errors by type
  if (record.errorType) {
    _state.errorsByType[record.errorType] = (_state.errorsByType[record.errorType] || 0) + 1
  }

  // Success by endpoint
  if (!_state.successByEndpoint[record.endpoint]) {
    _state.successByEndpoint[record.endpoint] = { ok: 0, fail: 0 }
  }
  if (record.success) {
    _state.successByEndpoint[record.endpoint].ok += 1
  } else {
    _state.successByEndpoint[record.endpoint].fail += 1
  }

  // Slowest/fastest
  if (!_state.slowestCall || record.latencyMs > _state.slowestCall.latencyMs) {
    _state.slowestCall = full
  }
  if (!_state.fastestCall || record.latencyMs < _state.fastestCall.latencyMs) {
    _state.fastestCall = full
  }

  _state.lastUpdated = Date.now()
}

// ── Obtener estado actual ─────────────────────────────────────
export function getObservabilityState(): ObservabilityState {
  return _state
}

// ── Reset ─────────────────────────────────────────────────────
export function resetObservability(): void {
  _state = createEmptyState()
}

// ── Helper para medir una llamada ────────────────────────────
export async function measureApiCall<T>(
  endpoint: EndpointId,
  meta: {
    topicTitle?: string
    targetConceptsCount?: number
    inputChars: number
  },
  fn: () => Promise<{ result: T; outputChars: number; provider?: string; model?: string; retries?: number }>
): Promise<T> {
  const start = Date.now()
  let retryCount = 0
  let usedFallback = false
  let fallbackReason: string | undefined
  let errorType: ErrorTaxonomy | undefined
  let errorMessage: string | undefined
  let success = false
  let outputChars = 0
  let provider = 'unknown'
  let model = 'unknown'

  try {
    const res = await fn()
    success = true
    outputChars = res.outputChars
    provider = res.provider || 'groq'
    model = res.model || 'llama-3.3-70b'
    retryCount = res.retries || 0
    return res.result

  } catch (err: any) {
    errorMessage = err.message || 'Unknown error'
    errorType = classifyError(errorMessage)
    throw err

  } finally {
    recordApiCall({
      endpoint,
      timestamp: start,
      latencyMs: Date.now() - start,
      inputChars: meta.inputChars,
      outputChars,
      topicTitle: meta.topicTitle,
      targetConceptsCount: meta.targetConceptsCount ?? 0,
      provider,
      model,
      success,
      retryCount,
      usedFallback,
      fallbackReason,
      errorType,
      errorMessage,
    })
  }
}

function classifyError(message: string): ErrorTaxonomy {
  const m = message.toLowerCase()
  if (m.includes('rate') || m.includes('limit') || m.includes('429')) return 'rate_limit'
  if (m.includes('timeout') || m.includes('timed out')) return 'timeout'
  if (m.includes('parse') || m.includes('json')) return 'parse_error'
  if (m.includes('empty') || m.includes('vacío')) return 'empty_response'
  if (m.includes('network') || m.includes('fetch') || m.includes('econnrefused')) return 'network_error'
  if (m.includes('auth') || m.includes('unauthorized') || m.includes('401')) return 'auth_error'
  if (m.includes('policy') || m.includes('blocked')) return 'content_policy'
  return 'unknown'
}
