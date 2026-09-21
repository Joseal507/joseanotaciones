import { NextResponse } from 'next/server'
import { PageStudyError } from './service'
import { buildPageStudyView } from './view'

/** Untrusted-input rules shared by the Page Study routes: the client never supplies authority. */
export const PLAN_ID_PATTERN = /^pstudy_plan:[a-f0-9]{64}$/
const FORBIDDEN_CLIENT_FIELDS = ['blockKey', 'block', 'pages', 'pageStart', 'pageEnd', 'materialId', 'materialIds', 'sourceSelection', 'selectedPages', 'fingerprint', 'batch', 'batchIndex', 'authority',
  'pending', 'pendingQuestion', 'mastery', 'evidence', 'provenance', 'state', 'stateDelta', 'delta', 'ops', 'coverage', 'carryover', 'materialLanguage', 'verdict', 'role']

export function forbiddenClientFields(body: Record<string, unknown>): string[] {
  return FORBIDDEN_CLIENT_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(body, key))
}

const USER_MESSAGE: Record<string, string> = {
  PAGE_STUDY_STORAGE_UNAVAILABLE: 'No se pudo guardar o recuperar tu progreso. Inténtalo de nuevo en unos segundos.',
  PAGE_STUDY_STORAGE_MALFORMED: 'No se pudo recuperar tu progreso de forma segura. Inténtalo de nuevo.',
  PAGE_STUDY_ENJOYER_NOT_READY: 'El material aún se está preparando. Inténtalo de nuevo en un momento.',
  PAGE_STUDY_SOURCE_UNAVAILABLE: 'No se pudo cargar el texto del material. Inténtalo de nuevo.',
  PAGE_STUDY_TURN_IN_PROGRESS: 'Tu mensaje anterior todavía se está procesando.',
  PAGE_STUDY_STALE_TURN: 'Tu sesión avanzó desde otra pestaña. Actualizamos el estado.',
  PAGE_STUDY_TURN_SUPERSEDED: 'Tu sesión avanzó desde otra pestaña. Actualizamos el estado.',
}
const STATUS: Record<string, number> = {
  PAGE_STUDY_STATE_NOT_FOUND: 404, PAGE_STUDY_EMPTY_MESSAGE: 400, PAGE_STUDY_INVALID_SLOT: 409, PAGE_STUDY_STALE_TURN: 409, PAGE_STUDY_TURN_ID_CONFLICT: 409,
  PAGE_STUDY_TURN_IN_PROGRESS: 409, PAGE_STUDY_TURN_SUPERSEDED: 409, PAGE_STUDY_FINISHED: 409, PAGE_STUDY_ENJOYER_NOT_READY: 409, PAGE_STUDY_ENJOYER_MISMATCH: 409,
  PAGE_STUDY_PLAN_INTEGRITY: 409, PAGE_STUDY_STORAGE_UNAVAILABLE: 503, PAGE_STUDY_STORAGE_MALFORMED: 503, PAGE_STUDY_SOURCE_UNAVAILABLE: 503, PAGE_STUDY_COMMIT_UNCONFIRMED: 503,
  PAGE_STUDY_UNAUTHORIZED_CONTEXT: 500,
}

/** Never leaks internal enums as user text: the client gets a stable code plus a human sentence, and the authoritative view when the state is known. */
export function pageStudyError(error: unknown): NextResponse {
  const code = error instanceof PageStudyError ? error.code : String((error as Error)?.message || '').startsWith('GENERATION_BUDGET_EXHAUSTED') ? 'PAGE_STUDY_GENERATION_FAILED' : 'PAGE_STUDY_GENERATION_FAILED'
  const status = STATUS[code] ?? 502
  const state = error instanceof PageStudyError ? error.state : undefined
  console.info('[page-study-turn] failed', { code, status })
  return NextResponse.json({ success: false, recoverable: status !== 400, error: code, userMessage: USER_MESSAGE[code] || 'No se pudo completar esta respuesta. Puedes reintentar el mismo mensaje.', ...(state ? { view: buildPageStudyView(state) } : {}) }, { status })
}
