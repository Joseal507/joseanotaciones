import { nextAssistanceLevel, type AssistanceLevel } from '../adaptive/v3/engine/helpContract'
import type { AttemptRecord, ConceptRecord, UnitMeta, Verdict } from './types'

/**
 * Evidence-based learning signals. There is NO mastery number anywhere: a concept's standing is DERIVED from what the
 * student actually did, and only an INDEPENDENT correct answer (no hint / clarification / reveal since the question
 * was asked) can demonstrate it. An answer given after help is real progress ("corrected") but never independence.
 */
export const DELAYED_RECALL_MS = 20 * 60 * 60 * 1000
export const MAX_DIGEST_CHARS = 120
export const MAX_CARRYOVER_CARDS = 40

export type ConceptStatus = 'taught' | 'failed' | 'corrected' | 'demonstrated' | 'retained'

export const clip = (text: string, max: number): string => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max)

export function newConcept(meta: UnitMeta, klass: 'FULL' | 'PROJECTED', taughtSeq: number): ConceptRecord {
  return { unitRef: meta.unitRef, materialId: meta.materialId, label: clip(meta.label, 160), kind: clip(meta.kind, 40), pages: [...meta.pages], taughtClass: klass, taughtSeq, attempts: [], corrected: false, demonstratedIndependent: false, retained: false }
}

/** Escalates assistance monotonically (independent → minimal_hint → guided → assisted → revealed). */
export const escalate = (current: AssistanceLevel, requested: AssistanceLevel): AssistanceLevel => nextAssistanceLevel(current, requested)

export function recordAttempt(concept: ConceptRecord, attempt: Omit<AttemptRecord, 'digest'> & { digest: string }): ConceptRecord {
  const previousFailure = concept.attempts.some(a => a.verdict !== 'correct')
  const clean: AttemptRecord = { ...attempt, digest: clip(attempt.digest, MAX_DIGEST_CHARS) }
  const next: ConceptRecord = { ...concept, attempts: [...concept.attempts, clean].slice(-12) }
  if (attempt.verdict === 'correct') {
    if (previousFailure) next.corrected = true
    if (attempt.assistance === 'independent') {
      // A second independent success in a later block, or ≥20h later, is retention; the first one only demonstrates.
      if (concept.demonstratedIndependent && (attempt.blockIndex !== concept.demonstratedBlockIndex || attempt.at - (concept.demonstratedAt ?? attempt.at) >= DELAYED_RECALL_MS)) next.retained = true
      if (!concept.demonstratedIndependent) { next.demonstratedIndependent = true; next.demonstratedAt = attempt.at; next.demonstratedBlockIndex = attempt.blockIndex }
    }
  }
  return next
}

/** Weak = the latest word on this concept is a failure or a help-assisted success that no independent success followed. */
export function isWeak(concept: ConceptRecord): boolean {
  let weak = false
  for (const a of concept.attempts) {
    if (a.verdict !== 'correct') weak = true
    else if (a.assistance === 'independent') weak = false
  }
  return weak
}

export function conceptStatus(concept: ConceptRecord): ConceptStatus {
  if (!concept.attempts.length) return 'taught'
  if (isWeak(concept)) return concept.attempts[concept.attempts.length - 1].verdict === 'correct' ? 'corrected' : 'failed'
  if (concept.attempts.some(a => a.verdict === 'correct' && a.assistance === 'independent')) return concept.retained ? 'retained' : 'demonstrated'
  return 'taught'
}

export const isChecked = (concept: ConceptRecord): boolean => concept.attempts.length > 0
export const verdictRank: Record<Verdict, number> = { correct: 2, partial: 1, incorrect: 0 }
