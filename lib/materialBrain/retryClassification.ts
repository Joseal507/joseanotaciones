// ============================================================
// Retry Classification — Material Brain
//
// Clasifica fallos de extracción para evitar retries ciegos
// de errores determinísticos.
//
// Clases:
//
// 1. transient
//    - timeout, network, 429, 5xx transitorios
//    → retry normal permitido
//
// 2. recoverable-format
//    - output truncado donde se pudieron salvar objetos completos
//    - JSON incompleto potencialmente corregible
//    → recovery parcial ya aplicado; retry dirigido si 0 unidades salvadas
//
// 3. deterministic-structural
//    - unidad viola invariantes estructurales/provenance de forma
//      que repetir exactamente el mismo request no tiene sentido
//    → NO hacer retries idénticos inútiles
// ============================================================

export type FailureClass =
  | 'transient'
  | 'recoverable-format'
  | 'deterministic-structural'

export interface ClassifiedFailure {
  class: FailureClass
  reason: string
  shouldRetry: boolean
  /** Si recoverable-format, cuántos objetos se pudieron salvar */
  recoveredCount?: number
}

/**
 * Patrones de error que indican fallo transitorio de red/proveedor.
 * Son strings que pueden aparecer en error.message o error.code.
 */
const TRANSIENT_PATTERNS = [
  'timeout',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'network',
  'fetch failed',
  '429',
  '500',
  '502',
  '503',
  '504',
  'rate limit',
  'rate_limit',
  'overloaded',
  'service unavailable',
  'temporarily unavailable',
]

/**
 * Patrones que indican problema de formato recuperable (output truncado,
 * JSON mal formado pero parseable parcialmente).
 */
const RECOVERABLE_FORMAT_PATTERNS = [
  'INVALID_JSON',
  'truncated',
  'partial_recovery',
  'incomplete',
]

/**
 * Patrones que indican fallo determinístico estructural.
 * Repetir el mismo request no va a cambiar el resultado.
 */
const DETERMINISTIC_PATTERNS = [
  'STRUCTURAL_VALIDATION_FAILED',
  'no_units_survived_validation',
  'provenance_violation',
  'schema_incompatible',
]

export function classifyFailure(
  error: unknown,
  context?: {
    recoveredCount?: number
    wasRecovered?: boolean
  },
): ClassifiedFailure {
  const message = extractErrorMessage(error)
  const lowerMessage = message.toLowerCase()

  // Primero: ¿es recoverable-format?
  if (context?.wasRecovered && (context.recoveredCount ?? 0) > 0) {
    return {
      class: 'recoverable-format',
      reason: `partial_recovery: ${context.recoveredCount} objects recovered`,
      shouldRetry: false, // ya recuperamos lo que se podía
      recoveredCount: context.recoveredCount,
    }
  }

  for (const pattern of RECOVERABLE_FORMAT_PATTERNS) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      const recoveredCount = context?.recoveredCount ?? 0
      return {
        class: 'recoverable-format',
        reason: `format issue: ${pattern}`,
        shouldRetry: recoveredCount === 0, // retry solo si no se salvó nada
        recoveredCount,
      }
    }
  }

  // Segundo: ¿es determinístico-estructural?
  for (const pattern of DETERMINISTIC_PATTERNS) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      return {
        class: 'deterministic-structural',
        reason: `deterministic failure: ${pattern}`,
        shouldRetry: false,
      }
    }
  }

  // Tercero: ¿es transitorio?
  for (const pattern of TRANSIENT_PATTERNS) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      return {
        class: 'transient',
        reason: `transient failure: ${pattern}`,
        shouldRetry: true,
      }
    }
  }

  // Default: tratarlo como transitorio con retry permitido
  // (conservador — preferimos reintentar una vez que perder cobertura)
  return {
    class: 'transient',
    reason: `unknown failure (treated as transient): ${message.slice(0, 120)}`,
    shouldRetry: true,
  }
}

function extractErrorMessage(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error) return String((error as any).message)
  return String(error)
}

/**
 * Determina si un chunk fallido debe reintentarse en la siguiente ronda,
 * considerando la clase del fallo y el número de intentos ya realizados.
 */
export function shouldRetryChunk(
  failure: ClassifiedFailure,
  attemptNumber: number,
  maxAttempts: number,
): boolean {
  if (attemptNumber >= maxAttempts) return false
  if (!failure.shouldRetry) return false
  return true
}
