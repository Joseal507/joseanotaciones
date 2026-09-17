export const FLASHCARD_EVALUATION_RETRY_MESSAGE = 'No pudimos evaluar tu respuesta. Inténtalo de nuevo.'

const VALID_FLASHCARD_EVALUATION_LEVELS = new Set([
  'INSANE',
  'correcta',
  'medio_correcta',
  'incorrecta',
  'muy_incorrecta',
])

export interface FlashcardEvaluationResult {
  nivel: string
  porcentaje?: number
  analisis?: string
  respuestaCorrecta?: string
  explicacion?: string
  consejo?: string
}

export interface FlashcardEvaluationRequest {
  pregunta: string
  respuestaCorrecta: string
  respuestaUsuario: string
  idioma: string
  contexto: string
}

export class FlashcardEvaluationTechnicalError extends Error {
  constructor() {
    super(FLASHCARD_EVALUATION_RETRY_MESSAGE)
    this.name = 'FlashcardEvaluationTechnicalError'
  }
}

export async function requestFlashcardEvaluation(
  request: FlashcardEvaluationRequest,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<FlashcardEvaluationResult> {
  const fetchImpl = options.fetchImpl || fetch
  const controller = new AbortController()
  let externallyAborted = options.signal?.aborted === true
  const abortFromCaller = () => {
    externallyAborted = true
    controller.abort()
  }
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (externallyAborted) controller.abort()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000)
  let response: Response
  try {
    response = await fetchImpl('/api/evaluar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-StudyAL-Technical-Errors': 'recoverable',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
  } catch (error) {
    if (externallyAborted) throw error
    throw new FlashcardEvaluationTechnicalError()
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }

  if (!response.ok) throw new FlashcardEvaluationTechnicalError()

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new FlashcardEvaluationTechnicalError()
  }

  const envelope = payload as { success?: unknown; resultado?: unknown } | null
  const candidate = envelope?.resultado
  if (
    envelope?.success !== true
    || !candidate
    || typeof candidate !== 'object'
    || !VALID_FLASHCARD_EVALUATION_LEVELS.has(String((candidate as { nivel?: unknown }).nivel || ''))
  ) {
    throw new FlashcardEvaluationTechnicalError()
  }

  return candidate as FlashcardEvaluationResult
}

export class FlashcardEvaluationGate {
  private inFlight = false

  async evaluate(
    request: FlashcardEvaluationRequest,
    options: Parameters<typeof requestFlashcardEvaluation>[1] = {},
  ): Promise<FlashcardEvaluationResult | null> {
    if (this.inFlight) return null
    this.inFlight = true
    try {
      return await requestFlashcardEvaluation(request, options)
    } finally {
      this.inFlight = false
    }
  }
}
