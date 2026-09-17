/** Only these locally owned messages may be displayed for failed chat requests. */
export const CHAT_USER_MESSAGES = {
  generic: 'No pude completar esta respuesta. Puedes intentarlo de nuevo.',
  timeout: 'La respuesta tardó demasiado en generarse. Inténtalo otra vez.',
  provider: 'No pude completar la respuesta ahora mismo. Inténtalo de nuevo en un momento.',
  storage: 'Tu respuesta no pudo guardarse o recuperarse correctamente. Inténtalo de nuevo.',
  pending: 'Tu respuesta todavía se está procesando. Espera un momento y reintenta este mismo turno.',
  conflict: 'Este turno corresponde a otra petición. Envía tu pregunta como un mensaje nuevo.',
  auth: 'Tu sesión no está disponible. Vuelve a iniciar sesión para continuar.',
  material: 'No pude acceder al material seleccionado. Vuelve a abrirlo e inténtalo de nuevo.',
  input: 'No pude procesar esta petición. Revisa tu mensaje e inténtalo de nuevo.',
} as const

function errorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    return [v.internalCode, v.error, v.detail, v.message].filter(x => typeof x === 'string').join(' ')
  }
  return ''
}

export function chatUserMessage(value?: unknown): string {
  if (value && typeof value === 'object' && 'userMessage' in value) {
    const supplied = (value as { userMessage: unknown }).userMessage
    if (typeof supplied === 'string' && Object.values(CHAT_USER_MESSAGES).some(message => message === supplied)) return supplied
  }
  const text = errorText(value)
  // Round trips through persisted legacy errors must also be safe.
  if (Object.values(CHAT_USER_MESSAGES).some(message => message === text)) return text
  if (/CHAT_TURN_(?:STORAGE|COMMIT)|WORKER|\bCAS\b/i.test(text)) return CHAT_USER_MESSAGES.storage
  if (/CHAT_TURN_IN_PROGRESS/.test(text)) return CHAT_USER_MESSAGES.pending
  if (/CHAT_TURN_ID_CONFLICT/.test(text)) return CHAT_USER_MESSAGES.conflict
  if (/UNAUTHORIZED|UNAUTHENTICATED|SESSION_NOT_FOUND|AUTH_REQUIRED/i.test(text)) return CHAT_USER_MESSAGES.auth
  if (/ENJOYER|SOURCE_SELECTION|INVALID_CONFIG/.test(text)) return CHAT_USER_MESSAGES.material
  if (/TIMEOUT|TIMED? OUT|DEADLINE|AbortError/i.test(text)) return CHAT_USER_MESSAGES.timeout
  if (/OPENROUTER|PROVIDER|\b50[0234]\b|fetch failed/i.test(text)) return CHAT_USER_MESSAGES.provider
  if (/EMPTY_MESSAGE|MESSAGE_TOO_LONG|INVALID_TURN_IDENTITY/.test(text)) return CHAT_USER_MESSAGES.input
  return CHAT_USER_MESSAGES.generic
}

/** Diagnostic codes, never exception bodies or private provider responses. */
export function chatInternalCode(value: unknown): string {
  const text = errorText(value)
  return text.match(/\b(?:CHAT_|GENERATION_|STRUCTURAL_|INVALID_|ENJOYER_|SOURCE_|RAW_SOURCE_|PROVIDER_|OPENROUTER_)[A-Z_]+\b/)?.[0]
    || (/timeout|timed? out|deadline/i.test(text) ? 'CHAT_PROVIDER_TIMEOUT' : 'CHAT_INTERNAL_FAILURE')
}

export function isInternalChatText(text: string): boolean {
  return /\b(?:GENERATION_BUDGET_EXHAUSTED|STRUCTURAL_VALIDATION_FAILED|CHAT_[A-Z_]+|ENJOYER_NOT_READY|SOURCE_SELECTION_MISMATCH|provider_page_claim_forbidden_use_evidence|material_claim_without_evidence)\b|(?:^|\n)\s*(?:Error:|(?:Type|Syntax|Reference)Error:|at \S+\s*\([^\n]+:\d+:\d+\))/.test(text)
}

export function safeChatDisplayText(text: string): string {
  return isInternalChatText(text) || /^\s*(?:\{\s*"(?:answer|error|success|internalCode)"|```json\s*\{\s*"(?:answer|error)")/.test(text)
    ? CHAT_USER_MESSAGES.generic : text
}
