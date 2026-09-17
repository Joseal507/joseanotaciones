import type { KnowledgeUnit } from './types'

// ============================================================
// Downstream eligibility — a PURE, deterministic classification over
// signals Material Brain already computes (origin, importance.tier,
// academicRole). Not a new scoring system: no new field is persisted
// on KnowledgeUnit, no new confidence math is introduced. This exists
// so Flashcards/Quiz/Free tools have ONE shared, documented answer to
// "should this unit become a question" instead of each consumer
// re-deriving its own ad-hoc heuristic from the same raw signals.
//
// This module does NOT change what gets extracted, merged, or
// persisted — it only classifies what is already there. Consumers are
// NOT modified in this change (explicitly out of scope); this is the
// authority they can adopt later.
// ============================================================

export type UnitEligibility =
  | 'core_academic_unit'
  | 'contextual_supporting_unit'
  | 'low_confidence_fallback'
  // Boilerplate/rejected text never survives to become a persisted
  // KnowledgeUnit (see academicRole.ts isDocumentBoilerplateText and
  // merge.ts/deterministicFallback.ts, which reject it before a unit
  // is ever created) — included here only so the eligibility space is
  // documented completely, never actually returned by classifyUnitEligibility.
  | 'boilerplate_rejected'

/**
 * Deterministic downstream eligibility for a single KnowledgeUnit.
 *
 * - `low_confidence_fallback`: the unit's own text came from the
 *   deterministic exact-source fallback (origin === 'fallback'), never
 *   a rich provider extraction. Still grounded and truthful, but never
 *   paraphrased/structured — downstream consumers may want to demand
 *   extra scrutiny (e.g. a stricter question-quality gate) before
 *   using it, or skip it entirely for lightweight review flows.
 * - `core_academic_unit`: importance.tier === 'critical' AND not a
 *   fallback-origin unit — the strongest, most confidently central
 *   content for this material.
 * - `contextual_supporting_unit`: everything else that made it into
 *   the Brain (tier 'supporting'/'contextual', non-fallback origin) —
 *   real, grounded content that is secondary rather than central.
 */
export function classifyUnitEligibility(unit: KnowledgeUnit): UnitEligibility {
  if (unit.origin === 'fallback') return 'low_confidence_fallback'
  if (unit.importance.tier === 'critical') return 'core_academic_unit'
  return 'contextual_supporting_unit'
}
