export interface EnjoyerQuizUiProgressiveState {
  manifestSlots?: number | null
  requestedCount?: number | null
  readyQuestions: number
  status?: 'generating' | 'ready' | 'failed' | null
  advanceInFlight: boolean
}

export function resolveEnjoyerQuizDisplayedTotal(state: Pick<EnjoyerQuizUiProgressiveState,
  'manifestSlots' | 'requestedCount' | 'readyQuestions'>): number {
  const manifestSlots = Number(state.manifestSlots || 0)
  if (Number.isInteger(manifestSlots) && manifestSlots > 0) return manifestSlots
  const requestedCount = Number(state.requestedCount || 0)
  if (Number.isInteger(requestedCount) && requestedCount > 0) return requestedCount
  return Math.max(0, state.readyQuestions)
}

export function shouldRequestEnjoyerQuizBackgroundAdvance(state: EnjoyerQuizUiProgressiveState): boolean {
  const total = resolveEnjoyerQuizDisplayedTotal(state)
  return state.status === 'generating'
    && state.readyQuestions < total
    && !state.advanceInFlight
}

export const QUIZ_ADVANCE_AUTO_RETRY_DELAYS_MS = [1_500, 3_000, 6_000] as const

export function nextEnjoyerQuizAdvanceRetry(failedAttempts: number):
  { pause: false; nextFailedAttempts: number; delayMs: number }
  | { pause: true; nextFailedAttempts: number; delayMs: null } {
  const nextFailedAttempts = Math.max(0, Math.trunc(failedAttempts)) + 1
  if (nextFailedAttempts > QUIZ_ADVANCE_AUTO_RETRY_DELAYS_MS.length) {
    return { pause: true, nextFailedAttempts, delayMs: null }
  }
  return { pause: false, nextFailedAttempts,
    delayMs: QUIZ_ADVANCE_AUTO_RETRY_DELAYS_MS[nextFailedAttempts - 1] }
}

export function resumeEnjoyerQuizAdvance(generationId: string | null | undefined):
  { generationId: string; failedAttempts: 0; paused: false } | null {
  return generationId ? { generationId, failedAttempts: 0, paused: false } : null
}

/** Canonical response-to-playable-state mapper used by every Enjoyer Quiz UI entry path. */
export function mapEnjoyerQuizResponseQuestions<T extends {
  type?: unknown; question?: unknown; prompt?: unknown; wordBank?: unknown
}>(questions: readonly T[]): T[] {
  const mapped = mapEnjoyerQuizQuestionsForUi(questions)
  return mapped
}

function normalizeWrittenAnswer(value: unknown): string {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ\s]/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function isCanonicalQuizWrittenAnswerCorrect(expectedAnswers: string[], userAnswer: unknown): boolean {
  const normalizedUser = normalizeWrittenAnswer(userAnswer)
  return normalizedUser.length > 0 && expectedAnswers.some(answer => normalizeWrittenAnswer(answer) === normalizedUser)
}
import { mapEnjoyerQuizQuestionsForUi } from './fillBlankContract'
