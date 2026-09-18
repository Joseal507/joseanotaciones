import type { BrainScope, KnowledgeRelation, KnowledgeUnit, Provenance } from '../types'

// ============================================================
// Flashcards V2 — contrato sobre Material Brain.
//
// Un deck NO es 1:1 con KnowledgeUnits. El planner decide qué
// conocimiento merece retrieval practice y con qué objetivo
// cognitivo; el generator produce la pregunta/respuesta; el
// validator evita duplicados semánticos sin colapsar objetivos
// legítimamente distintos.
// ============================================================

export type CognitiveType = 'recall' | 'comprehension' | 'application' | 'comparison' | 'procedure'

// ============================================================
// RetrievalUnit model (P3, formalized).
//
// `PlannedCard` IS the RetrievalUnit abstraction — the atomic thing a
// flashcard evaluates. Its cardinality against KnowledgeUnits/Relations
// is INTENTIONALLY N:M, never assumed 1:1, in either direction:
//
//   - 1 KnowledgeUnit -> 0 cards:   contextual importance, metadata,
//     dedup-merged into a survivor (planner.ts skipUnit / tryAdd).
//   - 1 KnowledgeUnit -> 1 card:    concept/definition/terminology/fact/
//     example/event_or_data — one retrieval objective is the norm.
//   - 1 KnowledgeUnit -> 2+ cards:  formula (recall + a taught
//     application), process with >=4 steps (recall + step ordering) —
//     each extra card carries a genuinely distinct retrievalObjective
//     and cognitiveType, never a mechanical per-variable/per-step split.
//   - 2 KnowledgeUnits -> 1 card:   a KnowledgeRelation (depends_on,
//     contrasts_with, applies_formula, ...) becomes ONE card whose
//     sourceUnitIds span both endpoints — the relation IS the retrieval
//     unit, not either unit alone.
//   - N KnowledgeUnits -> fewer cards: cross-unit semantic dedup
//     (planner.ts tier 1 + semanticDedup.ts tier 2) collapses units that
//     assert the same fact into the single surviving PlannedCard that
//     covers all of them (see SkippedTarget.mergedIntoCardId).
//
// This is what keeps "table"/list-like clusters of KnowledgeUnits from
// being forced into a naive 1-card-per-row cast: rows that are true
// duplicates collapse via dedup; rows that are genuinely distinct facts
// each keep their own card (never worse than 1:1 — see FC-FINAL-8/9 for
// the invariant this guarantees). There is currently no dedicated
// "table" KnowledgeUnitKind, so a table cannot get a synthesized
// single "list all rows" card the way a `process` gets a step-ordering
// card — that is a genuine Material Brain schema gap, not a Flashcards
// planner limitation, and is out of scope for this module to invent.
// ============================================================
export interface PlannedCard {
  /** Identidad determinística: hash de (unitIds + relationIds + retrievalObjective normalizado). */
  id: string
  sourceUnitIds: string[]
  sourceRelationIds: string[]
  /** Qué pieza de conocimiento distinta evalúa esta card exactamente. */
  retrievalObjective: string
  cognitiveType: CognitiveType
  /** Justificación auditable de por qué existe esta card. */
  rationale: string
  /**
   * Deterministic semantic-concept-cluster identity (see planner.ts's
   * `conceptClusterKeyFor`): units representing the SAME underlying
   * academic concept — via Brain `identity.semanticKey`/`canonicalSubject`
   * when present, normalized label otherwise — share this id even when
   * their labels/wording/unit kind differ. Downstream dedup/validation
   * consumes this directly instead of reconstructing semantic identity
   * from generated answer text. Two cards sharing a clusterId are NOT
   * automatically duplicates — they may test genuinely distinct
   * propositions within the same concept family — but they ARE eligible
   * for cross-cognitiveType comparison (see pedagogicalDedup.ts).
   */
  conceptClusterId: string
}

export interface SkippedTarget {
  unitId?: string
  relationId?: string
  reason:
    | 'contextual_importance'
    | 'example_without_critical_target'
    | 'unsupported_relation_type'
    | 'no_retrieval_value'
    | 'non_studyable_metadata'
    | 'semantic_duplicate_of_target'
    | 'consolidated_into_worked_example'
    | 'consolidated_into_shared_artifact'
  /** For 'semantic_duplicate_of_target': the surviving PlannedCard id that already covers this knowledge. */
  mergedIntoCardId?: string
  /** How the duplicate/exclusion decision was reached — auditable, never silent. */
  method?: 'deterministic' | 'provider_batch'
  /** Only meaningful for 'provider_batch' — the provider's own stated confidence, 0-1. */
  confidence?: number
}

/**
 * A same-conceptClusterId group of single-unit PlannedCards that
 * deterministic signals (contrast-flip, Jaccard) could NOT confidently
 * resolve as duplicate-or-distinct at plan time. Never auto-merged,
 * never silently discarded — both cards proceed to generation.
 * INFORMATIONAL ONLY (FASE 2 mission — "UNA SOLA autoridad de dedup"):
 * there is no plan-time provider resolution anymore. Genuine duplicates
 * among these are resolved post-generation by
 * reconcilePedagogicalDuplicates (pedagogicalDedup.ts), the single LLM
 * dedup authority in this pipeline, working over real question/answer
 * text — richer signal than a raw unit statement.
 */
export interface AmbiguousDuplicateGroup {
  label: string
  cardIds: string[]
}

// FASE D (observability for the 2 LOW-confidence findings — copyright,
// Tier-1 merge — that could not be resolved further without real
// KnowledgeUnit access). Privacy-minimal: ids, kinds, fingerprints,
// booleans, reason codes — never full label/statement/quote text.
export interface PlannedCardMergeDiagnostic {
  plannedCardId: string
  conceptClusterId: string
  sourceUnitIds: string[]
  sourceUnitKinds: string[]
  retrievalObjectiveFingerprint: string
  sourcePropositionFingerprints: string[]
  /** How this PlannedCard came to exist — the exact question the next real run needs to answer for sk:valor kc. */
  mergeProvenance: 'created_directly' | 'deterministic_auto_merge' | 'relation_expansion' | 'worked_example_consolidation'
  /** Only present when mergeProvenance === 'deterministic_auto_merge'. */
  autoMerge?: { inputPlannedCardIds: string[]; similarityScore: number; rule: string }
}

// Metadata-eligibility diagnostics — recorded for every surviving
// target's anchor source unit — proves WHICH text surface the upstream
// classifier saw (and which it missed), without ever persisting the
// unit's actual label/statement/quote content.
export interface MetadataEligibilityDiagnostic {
  sourceUnitId: string
  conceptClusterId: string
  metadataPredicateResult: boolean
  metadataReasonCode: 'structural' | 'ambiguous_topic_excluded' | 'bare_colophon' | 'not_metadata'
  whichTextSurfacesMatched: { label: boolean; statement: boolean; provenance: boolean; retrievalObjective: boolean }
}

export interface FlashcardPlan {
  plannerVersion: string
  plannedCards: PlannedCard[]
  /** Unidades que el planner decidió targetear (set, sin duplicados). */
  targetedUnitIds: string[]
  /** Relaciones que el planner decidió targetear. */
  targetedRelationIds: string[]
  skipped: SkippedTarget[]
  /** Plan-time ambiguity the deterministic tier flagged but did not resolve — informational, see AmbiguousDuplicateGroup. */
  ambiguousDuplicateGroups: AmbiguousDuplicateGroup[]
  /** FASE D observability — see PlannedCardMergeDiagnostic. */
  mergeDiagnostics: PlannedCardMergeDiagnostic[]
  /** FASE D observability — see MetadataEligibilityDiagnostic. */
  metadataDiagnostics: MetadataEligibilityDiagnostic[]
}

export interface GeneratedFlashcard extends PlannedCard {
  /** Canonical academic language of the source material (persisted Enjoyer authority). */
  materialLanguage?: string
  question: string
  answer: string
  /** Provenance del Brain (unit.provenance / relation.provenance), no del material crudo. */
  provenance: Provenance[]
  generatorVersion: string
  generatedAt: string
  validated: boolean
  validationErrors: string[]
  /**
   * P1 fix (surgical audit — repair loop had no targeted feedback):
   * when validate.ts's notation-preservation gate (6f) proves a specific
   * source snippet/operator was lost (e.g. "K >> 1"), it records that
   * snippet here — the SAME computation already used to decide
   * 'notation_structure_lost', never a second detector. Empty/absent
   * when no such loss was detected, or the card is otherwise valid.
   */
  requiredPreservations?: string[]
}

/**
 * P1 fix — repair-round context threaded from validator result into the
 * generator prompt, so a repair attempt targets the SPECIFIC reason its
 * predecessor failed instead of blindly re-rolling the identical prompt.
 * Always scoped to exactly one PlannedCard — never shared/stale feedback
 * from a different card or an earlier round of the SAME card.
 */
export interface RepairFeedback {
  plannedCardId: string
  /** validationErrors from the immediately preceding attempt for this card. */
  rejectionReasons: string[]
  /**
   * Specific source notation/structure the previous candidate lost and
   * must be preserved (meaning-preserving, not necessarily verbatim) —
   * sourced from GeneratedFlashcard.requiredPreservations, never
   * hardcoded to a particular operator/symbol.
   */
  requiredPreservations: string[]
  /** The rejected candidate itself, when useful context for the model to avoid repeating it. */
  previousCandidate?: { question: string; answer: string }
  /**
   * FASE B (repair contextless with concrete evidence): when
   * rejectionReasons includes 'contextless_question', the actual
   * identity.qualifiers text of this card's source units — the SAME
   * authorized evidence repairContextlessQuestion (validate.ts) already
   * uses deterministically. Never invented: absent/empty when no unit
   * carries a usable qualifier (fail-closed, matches the existing
   * NOT-REPAIRABLE contract).
   */
  requiredContextEvidence?: string[]
  /**
   * True when the immediately preceding repair attempt for this exact
   * card returned a question+answer byte-identical to what was already
   * rejected (a no-progress round) — the model reproduced the rejected
   * candidate instead of fixing it. Signals buildRepairFeedbackBlock to
   * add a stronger, subject-agnostic divergence instruction on top of
   * the normal per-reason repair strategy, never a substitute for it.
   */
  previousAttemptWasIdentical?: boolean
  /**
   * True once this card has shown it cannot converge by patching its own
   * previous wording — either a round reproduced it byte-identical
   * (lexical no-progress) or a round changed the text but failed for the
   * exact same rejectionReason set again (semantic no-progress). Once
   * true, the previous candidate must be treated as a failed draft, NOT
   * a source of truth: the prompt must rebuild the card from source
   * evidence rather than iterating on the rejected wording, and stays in
   * this mode for the rest of the run for this card — it never reverts
   * to patch-mode.
   */
  reconstructFromSource?: boolean
  /**
   * Escalation rung within the reconstruction ladder — ONLY populated for
   * the two reasons demonstrated (by real trace evidence) to freeze on a
   * fixed, repeated candidate even under reconstructFromSource:
   * template_leakage and circular_question_answer. A generic "try again"
   * instruction does not change the model's output at low temperature
   * when the rest of the prompt is unchanged — the fix is to change what
   * the prompt actually asks for, not just tell the model to be different.
   *   1 = rotate to a different CognitiveType than the card's own (see
   *       COGNITIVE_TYPE_ROTATION) — for template_leakage, additionally
   *       withhold the literal retrievalObjective text so there is
   *       nothing left to echo.
   *   2 = a code-constructed (non-LLM) candidate was already attempted
   *       from source fields alone and failed validation, OR could not be
   *       constructed (insufficient structured fields) — this is the
   *       final rung; remaining attempts keep rotating CognitiveType.
   * Never advances for any other rejectionReason — those keep the
   * original single-level reconstructFromSource behavior.
   */
  strategyLevel?: 1 | 2
  /** The CognitiveType the next attempt must use instead of the card's own — deterministic rotation, never invented. */
  cognitiveTypeOverride?: CognitiveType
  /**
   * When true, the prompt must NOT show the card's own retrievalObjective
   * text — template_leakage is caused by the model echoing that text
   * almost verbatim, so removing it from the prompt removes the thing
   * being echoed, rather than just asking the model not to echo it.
   */
  suppressRetrievalObjective?: boolean
}

export interface FlashcardDeckCoverageMetrics {
  plannedCards: number
  validCards: number
  failedCards: number
  targetedUnits: number
  coveredUnits: number
  targetedRelations: number
  coveredRelations: number
  /** Distinct semantic concept clusters targeted by the plan (see PlannedCard.conceptClusterId). */
  targetedConcepts: number
  /** Concept clusters backed by ≥1 VALIDLY-REPRESENTED card (see FlashcardDeckCoverage.coveredConceptClusterIds). */
  coveredConcepts: number
}

export interface FlashcardDeckCoverage {
  /** Unidades targeteadas por el planner (set). */
  targetedUnitIds: string[]
  /** Relaciones targeteadas por el planner (set). */
  targetedRelationIds: string[]
  /** Unidades targeteadas respaldadas por ≥1 card validada. */
  coveredUnitIds: string[]
  /** Relaciones targeteadas respaldadas por ≥1 card validada. */
  coveredRelationIds: string[]
  /** Distinct semantic concept clusters the plan targets (set of PlannedCard.conceptClusterId). */
  targetedConceptClusterIds: string[]
  /**
   * Concept clusters backed by ≥1 card that satisfies the FULL quality
   * contract (validated AND passes worthiness/notation/grounding — see
   * validate.ts) — "this planned pedagogical target is validly
   * represented", NOT merely "a valid-shaped card contains this source
   * unit id". This is the honest coverage signal; `coveredUnitIds`
   * above is kept for backward compatibility/debugging but must never
   * be read as a quality signal on its own.
   */
  coveredConceptClusterIds: string[]
  status: 'complete' | 'partial' | 'failed'
  metrics: FlashcardDeckCoverageMetrics
  /**
   * P0 hard invariant (coverage as a closing guarantee): true ONLY when
   * at least one uncovered target was classified 'failed_to_materialize_valid_target'
   * — the guaranteed, non-inventing deterministic fallback was never even
   * attempted for it before its budget ran out. That is a pipeline
   * defect, distinct from a target legitimately classified
   * 'unresolved_source' (the fallback WAS tried and the source itself
   * still lacked sufficient grounding — a real material limit, not a
   * bug). Absent/false for every deck where every uncovered target (if
   * any) is a genuine source limit. Callers (the API route) use this to
   * decide whether a 'failed' status may be surfaced as a normal
   * response or must be treated as an explicit internal failure.
   */
  hasUnrepresentableFailure?: boolean
}

export interface FlashcardDeckMeta {
  schemaVersion: string
  plannerVersion: string
  generatorVersion: string
  /**
   * Version of validate.ts's gate set (dedup/circularity/math/self-
   * containedness/...). ROOT CAUSE FIX: before this field existed, a
   * deck frozen under an OLDER, less strict validator was restored
   * forever by restore-first — fixing a gate in validate.ts never
   * invalidated already-persisted decks, so corrupted/contextless/
   * duplicate cards generated before the fix stayed frozen even after
   * the code was fixed. `undefined` = deck persisted before this field
   * existed -> treated as stale, same as a version mismatch.
   */
  validatorVersion: string
  status: 'building' | 'ready' | 'partial' | 'failed'
  /**
   * TARGET FREEZE: the Material Brain enrichment revision this deck was
   * generated against. A deck is a COMPLETE, self-contained artifact
   * (every card carries its own question/answer/provenance), so a later
   * background enrichment revision can never mutate it — this field is
   * the audit identity of the frozen universe, NOT an invalidation key
   * (it is deliberately absent from `content_hash`, so R2 does not
   * destroy an R1 deck). `null` = legacy brain with no revision identity;
   * never fabricated. `undefined` = deck persisted before this field.
   */
  enrichmentRevision?: number | null
  generatedAt: string
  llmCallsUsed: number
  retries: number
  /**
   * Count of pedagogically-duplicate cards merged by the global
   * retrieval-intent reconciliation pass (pedagogicalDedup.ts) — cards
   * with different labels/wording that tested the same retrievable
   * knowledge (e.g. 4 differently-worded Le Châtelier cards -> 1).
   * Dev/debug telemetry only, never shown in student UI.
   */
  pedagogicalMergesApplied?: number
}

export interface FlashcardDeck {
  scope: BrainScope
  meta: FlashcardDeckMeta
  cards: GeneratedFlashcard[]
  coverage: FlashcardDeckCoverage
}

export type FlashcardDeckLookupStatus = 'missing' | 'building' | 'ready' | 'partial' | 'failed'

export interface FlashcardDeckStore {
  get(fingerprint: string): Promise<FlashcardDeck | null>
  set(fingerprint: string, deck: FlashcardDeck): Promise<void>
}

export const FLASHCARD_DECK_SCHEMA_VERSION = '1.0.0'
// 1.1.0: tiered semantic dedup + worked-example consolidation + self-
// containedness eligibility signals — bump forces revalidation of any
// deck planned under the old 1:1-leaning planner.
// 1.2.0: generalized shared-artifact (table/graph/case/code) consolidation
// via qualifier-clustering — bump forces revalidation of any deck planned
// before non-example artifact clusters were folded away.
// 1.3.0: canonical semantic-concept clustering (identity.semanticKey /
// canonicalSubject drive cross-unit Tier-1 dedup identity instead of
// normalized label alone) + PlannedCard.conceptClusterId — bump forces
// revalidation of any deck planned before concept-cluster identity existed.
export const FLASHCARD_PLANNER_VERSION = '1.3.0'
export const FLASHCARD_GENERATOR_VERSION = '1.0.0'
// New field (see FlashcardDeckMeta.validatorVersion) — starts at 1.1.0,
// never 1.0.0, so every deck persisted before this field existed is
// treated as stale and revalidated under the current gate set.
// 1.2.0: global cross-label pedagogical (retrieval-intent) dedup pass
// added — bump forces revalidation of any deck built before it existed.
// 1.3.0: math structural-integrity gate (formula division/exponent loss,
// e.g. "P=(n/V)RT" -> "P=nVRT") + vague-relation-question worthiness gate
// added — bump forces revalidation of any deck validated before these
// gates existed.
// 1.4.0: general worthiness contract (unspecific-retrieval-question class,
// template-leakage detection), self-containedness fail-closed (removed the
// empty-qualifiers-fallback-to-label loophole, broadened deictic markers to
// definite articles) + generic unwrapped-math-marker notation gate + honest
// concept-cluster coverage — bump forces revalidation of any deck validated
// before these gates existed.
// 1.5.0: universal instance-context requirement (identity.qualifiers
// majority-overlap, no question-shape/length gating, no phrase list) +
// generic compact-notation preservation gate (fused letter+digit tokens,
// division/exponent/scientific-notation loss, generalized beyond
// FormulaUnit) — bump forces revalidation of any deck validated before
// these gates existed.
// 1.6.0: broadened document-metadata self-reference (genitive "del X",
// ownership phrasing "¿quién posee...?") + 4 additional generic vague-
// question verb-class shapes ("el concepto de", "el proceso de", "el
// paso para", "la característica principal de") — bump forces
// revalidation of any deck validated before these gates existed.
// 1.7.0: document-SCOPE question gate (self-reference + navigation verb
// "introduce/presenta/aborda/cubre/desarrolla/plantea" — distinct from
// metadata intent), obligation-modal ("se debe(n) calcular") added to
// the vague-procedure verb class, and internal-label-quoting leakage
// (a comparison question quoting a KnowledgeUnit label verbatim instead
// of composing a real question) — bump forces revalidation of any deck
// validated before these gates existed.
export const FLASHCARD_VALIDATOR_VERSION = '1.7.0'
