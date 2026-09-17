import type { MaterialBrain } from './types'

// ============================================================
// Canonical academic-stability authority (P1, "Material Brain debe
// tener un final real y estable").
//
// `brain.meta.status === 'ready'` alone was never a safe signal for
// "this Brain can no longer change" — a ready-but-'enriching' Brain
// can still silently swap 1 fallback KnowledgeUnit for N rich units,
// changing unit ids and introducing relations that didn't exist before.
// This is the ONE function every tool/route/hub must consult to decide
// whether it is safe to CREATE a new academic artifact (a flashcard
// deck, a quiz, an exam, a review target, ...) against this exact
// fingerprint. Never re-derive this per tool.
//
//   preparing        — real work remains that CAN still change
//                       KnowledgeUnits/relations (source not yet
//                       represented, OR enrichment still has leaves
//                       with real attempts remaining).
//   stable_rich       — nothing left pending; every required leaf ended
//                        up with real provider-derived (rich) semantics.
//   stable_degraded    — nothing left pending that could change the
//                        universe further, but one or more leaves
//                        permanently settled for their deterministic
//                        exact-source fallback (spent their full
//                        enrichment budget, see build.ts). This is a
//                        LEGITIMATE terminal state, not a failure — a
//                        tool may generate against it exactly as
//                        against stable_rich.
//   failed            — no usable academic representation exists at
//                        all (required source coverage itself failed).
//
// stable_rich and stable_degraded are BOTH immutable with respect to
// automatic (background) enrichment — once reached, only an explicit
// future regenerate/reprocess action could ever produce a new revision
// (see enrichmentRevision). This is what makes it safe to gate new
// artifact generation on "stable" rather than waiting for unreachable
// 100% richness.
// ============================================================

export type AcademicStability = 'preparing' | 'stable_rich' | 'stable_degraded' | 'failed'

export function resolveMaterialAcademicStability(brain: MaterialBrain | null | undefined): AcademicStability {
  if (!brain) return 'preparing'
  if (brain.meta.status === 'failed') return 'failed'
  if (brain.meta.status !== 'ready') return 'preparing'

  const enrichment = brain.meta.brainEnrichment
  // A legacy brain (built before two-level readiness existed) went
  // through the old single-pass full pipeline — already as rich as it
  // will ever get, nothing left pending. Treat as stable_rich.
  if (enrichment === undefined) return 'stable_rich'
  if (enrichment === 'ready') return 'stable_rich'
  if (enrichment === 'degraded') return 'stable_degraded'
  if (enrichment === 'failed') return 'failed'
  // 'not_started' | 'enriching' — real work can still change the universe.
  return 'preparing'
}

/** True for either terminal-and-usable state — the actual gate condition for new-artifact generation. */
export function isAcademicallyStable(stability: AcademicStability): boolean {
  return stability === 'stable_rich' || stability === 'stable_degraded'
}
