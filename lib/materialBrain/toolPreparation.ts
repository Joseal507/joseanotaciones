// ============================================================
// Localized tool-preparation UX (fast-entry architecture).
//
// Free Mode opens at sourceReady. Tools whose academic contract
// genuinely requires FULL rich enrichment (Exam, Study Map, Truquitos)
// can therefore be opened while background enrichment is still running.
// That is a NORMAL, self-resolving state — not an error.
//
// The route signals it with the distinct code BRAIN_ENRICHING (HTTP 409).
// The tool must then show its OWN calm, localized message and continue
// automatically:
//   - no generic error text
//   - no Retry button
//   - no forced Back
//   - no global MaterialPreparationScreen (Free Mode stays fully open,
//     ALAI Chat / Repasar / Flashcards / Análisis remain usable)
//
// BOUNDED FAILURE: polling is not infinite. After
// TOOL_PREPARATION_MAX_ATTEMPTS the tool stops pretending progress and
// shows TOOL_PREPARATION_EXHAUSTED_MESSAGE — calm, honest, and still
// non-blocking for the rest of Free Mode. If enrichment becomes
// available later, re-entering the tool resumes continuation.
// ============================================================

export const BRAIN_ENRICHING_CODE = 'BRAIN_ENRICHING'

export type PreparingToolId = 'exam' | 'studyMap' | 'truquitos'

export const TOOL_PREPARATION_MESSAGES: Record<PreparingToolId, string> = {
  exam: 'Terminando de preparar tu examen…',
  studyMap: 'Terminando de preparar tu mapa…',
  truquitos: 'Terminando de preparar tus truquitos…',
}

/** Shown once the bounded retry policy is exhausted. Never an error, never a dead end. */
export const TOOL_PREPARATION_EXHAUSTED_MESSAGE =
  'Esta herramienta todavía se está preparando.'

export const TOOL_PREPARATION_POLL_MS = 6000
export const TOOL_PREPARATION_MAX_ATTEMPTS = 20

/**
 * True when a response means "source is ready, rich enrichment is still
 * running" — the localized preparing state, never a generic error.
 * Accepts the parsed body and/or the HTTP status.
 */
export function isBrainEnrichingResponse(status: number, body: unknown): boolean {
  if (status !== 409) return false
  const code = (body as { error?: unknown } | null | undefined)?.error
  return String(code || '') === BRAIN_ENRICHING_CODE
}

export function toolPreparationMessage(tool: PreparingToolId, attempt: number): string {
  return attempt >= TOOL_PREPARATION_MAX_ATTEMPTS
    ? TOOL_PREPARATION_EXHAUSTED_MESSAGE
    : TOOL_PREPARATION_MESSAGES[tool]
}

export function shouldContinuePreparation(attempt: number): boolean {
  return attempt < TOOL_PREPARATION_MAX_ATTEMPTS
}
