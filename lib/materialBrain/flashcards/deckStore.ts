import { getMaterialResult, saveMaterialResult } from '../../materials/repository'
import type { MaterialResult } from '../../materials/types'
import type { BrainScope, MaterialBrain } from '../types'
import { planFlashcards } from './planner'
import { generateFlashcard, generateFlashcardBatch, repairStrategyFor, buildDeterministicFallbackCard, COGNITIVE_TYPE_ROTATION, type GenerateFlashcardFn, type GenerationContext } from './generator'
import { validateDeck, computeDeckCoverage, reconcileFinalCoverage, isTerminalRejection } from './validate'
import { evaluateSourceObjectiveSatisfaction } from './sourceObjectiveSatisfaction'
import { reconcilePedagogicalDuplicates, reconcileRepairCandidates, defaultPedagogicalJudge, type PedagogicalJudgeFn, type PedagogicalDedupDiagnostics, type RepairDedupDiagnostics } from './pedagogicalDedup'
import { buildPipelineTraceCounts, logPipelineTrace, newTraceRunId } from './pipelineTrace'
import { persistFlashcardsTrace } from './tracePersistence'
import type { FlashcardDeck, FlashcardDeckLookupStatus, FlashcardDeckStore, RepairFeedback } from './types'
import {
  FLASHCARD_DECK_SCHEMA_VERSION,
  FLASHCARD_GENERATOR_VERSION,
  FLASHCARD_PLANNER_VERSION,
  FLASHCARD_VALIDATOR_VERSION,
} from './types'

// ============================================================
// Flashcard deck persistence — mismo patrón que productionStore.ts
// (Mission 2): tabla material_results, key sintética, restore-first,
// placeholder 'building' + TTL best-effort, error explícito ante
// payload corrupto.
//
// Clave sintética:
//   material_id = "flashcards_deck:" + scope.fingerprint
//   enfoque     = 'mixto'
//   result_type = 'flashcards_deck'
//   content_hash = fingerprint + '::' + plannerVersion + '::' + generatorVersion
// ============================================================

export const DECK_ENFOQUE = 'mixto' as const
export const DECK_RESULT_TYPE = 'flashcards_deck' as const
export const DECK_BUILDING_STALE_MS = 3 * 60 * 1000

function deckMaterialId(fingerprint: string): string {
  return `flashcards_deck:${fingerprint}`
}

function deckContentHash(fingerprint: string): string {
  return `${fingerprint}::${FLASHCARD_PLANNER_VERSION}::${FLASHCARD_GENERATOR_VERSION}::${FLASHCARD_VALIDATOR_VERSION}`
}

export interface WorkerDeckStoreDeps {
  getMaterialResult?: typeof getMaterialResult
  saveMaterialResult?: typeof saveMaterialResult
}

export class WorkerFlashcardDeckStore implements FlashcardDeckStore {
  private getResult: (materialId: string, enfoque: typeof DECK_ENFOQUE, resultType: typeof DECK_RESULT_TYPE) => Promise<MaterialResult | null>
  private saveResult: typeof saveMaterialResult

  constructor(deps: WorkerDeckStoreDeps = {}) {
    this.getResult = deps.getMaterialResult || getMaterialResult
    this.saveResult = deps.saveMaterialResult || saveMaterialResult
  }

  async get(fingerprint: string): Promise<FlashcardDeck | null> {
    const result = await this.getResult(deckMaterialId(fingerprint), DECK_ENFOQUE, DECK_RESULT_TYPE)
    if (!result) return null

    const payload = result.payload
    if (!payload || typeof payload !== 'object' || !payload.scope || !payload.meta) {
      throw new Error(`FLASHCARD_DECK_CORRUPTED_PAYLOAD:${fingerprint}`)
    }

    return payload as FlashcardDeck
  }

  async set(fingerprint: string, deck: FlashcardDeck): Promise<void> {
    await this.saveResult({
      material_id: deckMaterialId(fingerprint),
      enfoque: DECK_ENFOQUE,
      result_type: DECK_RESULT_TYPE,
      payload: deck,
      content_hash: deckContentHash(fingerprint),
    })
  }
}

export function createDeckBuildingPlaceholder(scope: BrainScope): FlashcardDeck {
  return {
    scope,
    meta: {
      schemaVersion: FLASHCARD_DECK_SCHEMA_VERSION,
      plannerVersion: FLASHCARD_PLANNER_VERSION,
      generatorVersion: FLASHCARD_GENERATOR_VERSION,
      validatorVersion: FLASHCARD_VALIDATOR_VERSION,
      status: 'building',
      generatedAt: new Date().toISOString(),
      llmCallsUsed: 0,
      retries: 0,
    },
    cards: [],
    coverage: {
      targetedUnitIds: [],
      targetedRelationIds: [],
      coveredUnitIds: [],
      coveredRelationIds: [],
      targetedConceptClusterIds: [],
      coveredConceptClusterIds: [],
      status: 'failed',
      metrics: {
        plannedCards: 0,
        validCards: 0,
        failedCards: 0,
        targetedUnits: 0,
        coveredUnits: 0,
        targetedRelations: 0,
        coveredRelations: 0,
        targetedConcepts: 0,
        coveredConcepts: 0,
      },
    },
  }
}

export async function lookupFlashcardDeck(
  store: FlashcardDeckStore,
  fingerprint: string,
): Promise<{ status: FlashcardDeckLookupStatus; deck: FlashcardDeck | null }> {
  const cached = await store.get(fingerprint)
  if (!cached) return { status: 'missing', deck: null }
  if (cached.scope.fingerprint !== fingerprint) return { status: 'missing', deck: null }
  if (cached.meta.plannerVersion !== FLASHCARD_PLANNER_VERSION) return { status: 'missing', deck: null }
  if (cached.meta.generatorVersion !== FLASHCARD_GENERATOR_VERSION) return { status: 'missing', deck: null }
  if (cached.meta.validatorVersion !== FLASHCARD_VALIDATOR_VERSION) return { status: 'missing', deck: null }
  return { status: cached.meta.status, deck: cached }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

// FASE D (observability, privacy-minimal): a cheap deterministic hash —
// never the raw question/answer text — used only to detect whether a
// repair round actually changed the candidate (FNV-1a, no crypto
// dependency needed for a diagnostic fingerprint).
function fingerprintText(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function chunkCards<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches.length ? batches : []
}

// Bounded scale (P0 fix — real bug: 115 flashcards took ~115 provider
// calls, one per card). A single call comfortably handles this many
// planned cards; provider calls scale O(ceil(N/BATCH_SIZE)), never
// O(N), and batches run in parallel (bounded concurrency below).
const FLASHCARD_BATCH_SIZE = 15
// Retry budget is PER TARGET, not a fixed number of global rounds: a
// target keeps getting fresh attempts (still batched together each round
// with whatever other targets are also still eligible, so cost stays
// O(rounds), never O(targets)) until it either produces a validated card
// or exhausts this many total attempts (round 0's plain generation counts
// as attempt 1). Product decision: failing to generate a good card 1-2
// times is a generator quality problem, not a reason to sacrifice
// coverage — but retries must still be bounded and explicit. 8 gives a
// target up to 7 real repair attempts; because rounds are batched across
// every still-pending target, the worst-case COST impact for the whole
// deck is bounded at 7 extra provider calls total (not per-card), same
// order of magnitude as the previous fixed 2-round cap. Never unbounded
// — a target that still fails after this is recorded as an honest,
// reported unresolved_generation_failure, never silently dropped.
const MAX_GENERATION_ATTEMPTS_PER_TARGET = 8

function createFailedCard(card: import('./types').PlannedCard, error: Error): import('./types').GeneratedFlashcard {
  return {
    ...card,
    question: '',
    answer: '',
    provenance: [],
    generatorVersion: FLASHCARD_GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    validated: false,
    validationErrors: [`generation_failed:${error.message}`],
  }
}

export interface DeckBuildOptions {
  /** Legacy single-card injection (test compatibility) — one call per planned card. */
  generateFn?: GenerateFlashcardFn
  /** Production path override — batched generation (see generateFlashcardBatch). */
  generateBatchFn?: typeof import('./generator').generateFlashcardBatch
  /**
   * The ONLY LLM dedup authority in the pipeline (FASE 2 mission — "UNA
   * SOLA autoridad de dedup"): batched provider adjudication for
   * post-generation ambiguous pairs (real question/answer/cognitiveType/
   * retrievalObjective — richer signal than plan-time raw unit
   * statements ever had). Planner-level dedup is 100% deterministic now
   * (see planDedupProviderCalls, always 0) — there is no equivalent
   * plan-time override option anymore.
   */
  pedagogicalJudgeFn?: PedagogicalJudgeFn
  language?: string
  concurrency?: number
  /**
   * Explicit user intent to build a NEW deck ("generar de nuevo").
   * Only this can replace an existing ready deck — background
   * enrichment never can. The new deck freezes the CURRENT brain
   * revision (FLASH-FREEZE-3).
   */
  regenerate?: boolean
}

/**
 * Orquestador de deck V2.
 *
 * RESTORE FIRST → GENERATE ONLY WHEN ABSENCE IS PROVEN:
 * - Deck ready con mismas versiones → devuélvelo.
 * - Building reciente → poll.
 * - En cualquier otro caso: placeholder building, plan, generar, validar, persistir.
 *
 * Errores de red/Worker durante el lookup se propagan tal cual — NUNCA se
 * convierten en 'missing' silencioso.
 */
export async function getOrBuildFlashcardDeck(
  brain: MaterialBrain,
  store: FlashcardDeckStore,
  options: DeckBuildOptions = {},
): Promise<{ status: FlashcardDeckLookupStatus; deck?: FlashcardDeck }> {
  const lookup = await lookupFlashcardDeck(store, brain.scope.fingerprint)

  // TARGET FREEZE (FLASH-FREEZE-1/2/4): an existing ready deck is
  // returned AS-IS, whatever enrichment revision the Brain has advanced
  // to since. The deck is self-contained (question/answer/provenance per
  // card), so richer units in a later revision can never rewrite it, and
  // `deckContentHash` deliberately excludes the revision so enrichment
  // cannot invalidate it either. Only an explicit `regenerate` intent
  // may build a newer deck.
  // A `partial` deck is ALSO existing valid work (real validated cards,
  // just not full coverage). Before the freeze contract it was rebuilt on
  // every request, which meant a later enrichment revision would silently
  // replace the user's R1 deck with richer cards. Restore-first applies
  // here too: only an explicit regenerate intent may supersede it.
  const restorable = lookup.deck
    && (lookup.status === 'ready'
      || (lookup.status === 'partial' && lookup.deck.cards.some(card => card.validated)))
  if (restorable && !options.regenerate) {
    return { status: lookup.status as FlashcardDeckLookupStatus, deck: lookup.deck! }
  }

  if (lookup.status === 'building' && lookup.deck && !options.regenerate) {
    const generatedAt = new Date(lookup.deck.meta.generatedAt).getTime()
    if (!Number.isNaN(generatedAt) && Date.now() - generatedAt < DECK_BUILDING_STALE_MS) {
      return { status: 'building' }
    }
  }

  const placeholder = createDeckBuildingPlaceholder(brain.scope)
  await store.set(brain.scope.fingerprint, placeholder)

  // ── OBSERVABILITY ONLY (P0 diagnostic mission) ──────────────────
  // Every counter/timer below is read-only bookkeeping around calls
  // that already happen — nothing here changes which functions run,
  // in what order, with what arguments, or what they return. See
  // pipelineTrace.ts for the pure classification/formatting logic.
  const traceStart = Date.now()
  const traceRunId = newTraceRunId()

  // ── OBSERVABILITY STATE — MUST be fully initialized here, before any
  // provider call/batch/validation/dedup/repair work begins. A prior
  // version declared `stageSnapshots`/`notationDiagnostics` (and their
  // helper functions) further down, AFTER the point they were first
  // invoked — `function` declarations are hoisted, but the `const`
  // arrays they close over are NOT (TDZ), so the first real regeneration
  // run hit "Cannot access 'notationDiagnostics' before initialization"
  // and the whole request 500'd. Telemetry must never be able to do
  // that: every push below is also wrapped in try/catch, so even a bug
  // inside this diagnostic code can only ever no-op, never fail the
  // deck build (fail OPEN, not fail the product).
  const stageSnapshots: import('./pipelineTrace').StageSnapshot[] = []
  function snapshotStage(round: number, stage: import('./pipelineTrace').StageSnapshot['stage'], cardsList: import('./types').GeneratedFlashcard[]) {
    try {
      stageSnapshots.push({
        round, stage,
        cardsById: new Map(cardsList.map(c => [c.id, {
          validated: c.validated,
          validationErrors: [...c.validationErrors],
          sourceUnitIds: [...c.sourceUnitIds],
        }])),
      })
    } catch { /* observability must never fail the build */ }
  }
  const notationDiagnostics: import('./pipelineTrace').NotationDiagnostic[] = []
  function notationSnippets(text: string): string[] {
    const re = /.{0,15}[≫≪><±≈⇌→←≥≤≠∝].{0,15}/g
    return text.match(re) || []
  }
  function recordNotationDiagnostics(boundary: import('./pipelineTrace').NotationDiagnostic['boundary'], round: number, cardsList: { id: string; question: string; answer: string }[]) {
    try {
      for (const c of cardsList) {
        const snippets = [...notationSnippets(c.question), ...notationSnippets(c.answer)]
        if (snippets.length) notationDiagnostics.push({ boundary, round, plannedCardId: c.id, snippets })
      }
    } catch { /* observability must never fail the build */ }
  }
  // ─────────────────────────────────────────────────────────────────

  // FASE 2 mission ("UNA SOLA autoridad de dedup"): there is no plan-time
  // provider dedup left to count — this constant IS the explicit proof.
  // `pedagogicalDedupProviderCalls` is the one real counter left, driven
  // exclusively by reconcilePedagogicalDuplicates/reconcileRepairCandidates.
  const planDedupProviderCalls = 0
  let pedagogicalDedupProviderCalls = 0
  const countingPedagogicalJudgeFn: PedagogicalJudgeFn = async (...args) => {
    pedagogicalDedupProviderCalls++
    return (options.pedagogicalJudgeFn || defaultPedagogicalJudge)(...args)
  }
  // ─────────────────────────────────────────────────────────────────

  // Dedup instrumentation (diagnostics-only, P0 mission: "explain the
  // ~68s without changing behavior") — accumulated across every
  // reconcilePedagogicalDuplicates call in this run (the initial pass
  // AND every repair round's pass), so the persisted trace reflects the
  // WHOLE run's dedup cost, not just one call.
  const dedupDiagnosticsAccumulator: PedagogicalDedupDiagnostics = {
    candidatePairs: 0, deterministicResolved: 0, ambiguousPairs: 0,
    judgeBatches: 0, judgeCalls: 0, judgeBatchSizes: [], judgeBatchDurationsMs: [],
    candidateConstructionMs: 0, deterministicResolutionMs: 0, judgeWallMs: 0, mergeFinalizationMs: 0,
    ambiguousPairsBeforeCap: 0, ambiguousPairsAfterCap: 0, sourceOverlapPairsBeforeCap: 0,
    sourceOverlapPairsAfterCap: 0, pairsDroppedByCap: 0, rankedPairs: [],
  }
  function accumulateDedupDiagnostics(d: PedagogicalDedupDiagnostics) {
    dedupDiagnosticsAccumulator.candidatePairs += d.candidatePairs
    dedupDiagnosticsAccumulator.deterministicResolved += d.deterministicResolved
    dedupDiagnosticsAccumulator.ambiguousPairs += d.ambiguousPairs
    dedupDiagnosticsAccumulator.judgeBatches += d.judgeBatches
    dedupDiagnosticsAccumulator.judgeCalls += d.judgeCalls
    dedupDiagnosticsAccumulator.judgeBatchSizes.push(...d.judgeBatchSizes)
    dedupDiagnosticsAccumulator.judgeBatchDurationsMs.push(...d.judgeBatchDurationsMs)
    dedupDiagnosticsAccumulator.candidateConstructionMs += d.candidateConstructionMs
    dedupDiagnosticsAccumulator.deterministicResolutionMs += d.deterministicResolutionMs
    dedupDiagnosticsAccumulator.judgeWallMs += d.judgeWallMs
    dedupDiagnosticsAccumulator.mergeFinalizationMs += d.mergeFinalizationMs
    dedupDiagnosticsAccumulator.ambiguousPairsBeforeCap += d.ambiguousPairsBeforeCap
    dedupDiagnosticsAccumulator.ambiguousPairsAfterCap += d.ambiguousPairsAfterCap
    dedupDiagnosticsAccumulator.sourceOverlapPairsBeforeCap += d.sourceOverlapPairsBeforeCap
    dedupDiagnosticsAccumulator.sourceOverlapPairsAfterCap += d.sourceOverlapPairsAfterCap
    dedupDiagnosticsAccumulator.pairsDroppedByCap += d.pairsDroppedByCap
    dedupDiagnosticsAccumulator.rankedPairs.push(...d.rankedPairs)
  }

  // FASE 1 (P0 mission — "dedup scope during repair"): the accepted deck
  // (bestValidCards) is passed through ONE full-deck
  // reconcilePedagogicalDuplicates call — ever, for the whole run.
  // `fullDeckDedupRuns` is the explicit, testable proof of that
  // contract: it must equal exactly 1 whether there are 0, 1, or
  // FLASHCARD_REPAIR_ROUNDS repair rounds. Every repair round instead
  // calls reconcileRepairCandidates (delta-scoped — new candidates vs.
  // neighbor existing cards only), which never increments this counter.
  let fullDeckDedupRuns = 0
  const initialDedup = { poolSize: 0, candidatePairs: 0, judgeBatches: 0, judgeCalls: 0 }
  const repairDedupRounds: (RepairDedupDiagnostics & { round: number })[] = []
  // ─────────────────────────────────────────────────────────────────

  // P0 mission ("guardar trace parcial si /api/flashcards-v2 termina en
  // error"): everything from here to the successful return is wrapped so
  // a thrown error still gets one best-effort partial trace file (DEV
  // only, fail-open) before the ORIGINAL error is re-thrown unchanged —
  // this never alters error handling/response shape, only adds a
  // diagnostic side-effect on the way out.
  let currentErrorStage = 'planning'
  try {
  // FASE 2 mission ("UNA SOLA autoridad de dedup"): the planner's own
  // dedup is 100% deterministic (identity/exact-source/Jaccard/contrast-
  // flip — see planFlashcards) — there is no plan-time provider call
  // left. Anything the deterministic tier could not confidently collapse
  // proceeds to generation and is resolved by reconcilePedagogicalDuplicates
  // below, the SINGLE LLM dedup authority in this pipeline, working over
  // real question/answer/cognitiveType/retrievalObjective — richer
  // signal than a raw unit statement ever was at plan time.
  const plan = planFlashcards(brain)
  const planningMs = Date.now() - traceStart
  const unitById = new Map(brain.units.map(u => [u.id, u]))
  const relationById = new Map(brain.relations.map(r => [r.id, r]))

  const concurrency = options.concurrency ?? 3
  const plannedCardById = new Map(plan.plannedCards.map(pc => [pc.id, pc]))

  // Integration point for the new source-objective-satisfaction authority
  // (sourceObjectiveSatisfaction.ts) — inserted right after structural
  // `validateDeck()`, before anything downstream (dedup, coverage) ever
  // sees the cards. A card that fails here is flipped back to
  // validated:false with its reasons appended to validationErrors — the
  // EXACT SAME field the repair loop, strategy ladder, and fuse already
  // key off of. No new retry system: a card rejected here re-enters
  // repair with a structured rejectionReason like any other. `ambiguous`
  // is treated identically to `rejected` here — this module's own
  // contract is that ambiguity must never silently count as satisfied.
  function applySourceObjectiveSatisfaction(cards: import('./types').GeneratedFlashcard[]): import('./types').GeneratedFlashcard[] {
    return cards.map(c => {
      if (!c.validated) return c
      const pc = plannedCardById.get(c.id)
      if (!pc) return c
      const units = c.sourceUnitIds.map(id => unitById.get(id)).filter((u): u is import('../types').KnowledgeUnit => !!u)
      const result = evaluateSourceObjectiveSatisfaction(pc, { question: c.question, answer: c.answer }, units)
      if (result.status === 'satisfied') return c
      return { ...c, validated: false, validationErrors: [...c.validationErrors, ...result.reasons] }
    })
  }

  function contextFor(cards: import('./types').PlannedCard[]): GenerationContext {
    const unitIds = new Set(cards.flatMap(c => c.sourceUnitIds))
    const relationIds = new Set(cards.flatMap(c => c.sourceRelationIds))
    return {
      units: [...unitIds].map(id => unitById.get(id)).filter(Boolean) as import('../types').KnowledgeUnit[],
      relations: [...relationIds].map(id => relationById.get(id)).filter(Boolean) as import('../types').KnowledgeRelation[],
    }
  }

  let generated: import('./types').GeneratedFlashcard[]

  // ── OBSERVABILITY ONLY: provider-call counters, tagged by stage via
  // `currentStage` (set right before each runBatches invocation, never
  // read by anything that affects behavior). ─────────────────────────
  let currentStage: 'generation' | 'repair' = 'generation'
  const providerCallCounts = { generation: 0, repair: 0 }
  // ─────────────────────────────────────────────────────────────────

  // Unified generation-for-a-target-set callable, usable both for the
  // pre-dedup repair loop AND the post-dedup repair pass below (P0,
  // "exact coverage must converge") — works identically whether the
  // caller injected a legacy single-card generateFn or the production
  // batched generateBatchFn.
  const generateFn = options.generateFn
  const generateBatchFn = options.generateBatchFn || generateFlashcardBatch
  // P1 fix: `feedbackByCardId` is only ever passed by the repair loop
  // below (round >= 1) — the initial call (`runBatches(plan.plannedCards)`,
  // no second arg) never carries repair verbosity into normal generation.
  const runBatches = async (
    cardsToGenerate: import('./types').PlannedCard[],
    feedbackByCardId?: Map<string, RepairFeedback>,
  ) => {
    if (generateFn) {
      const results = await mapWithConcurrency(cardsToGenerate, concurrency, async planned => {
        providerCallCounts[currentStage]++
        try {
          return await generateFn(planned, contextFor([planned]), options.language, feedbackByCardId?.get(planned.id))
        } catch (err) {
          return createFailedCard(planned, err as Error)
        }
      })
      return new Map(cardsToGenerate.map((pc, i) => [pc.id, results[i]]))
    }
    const batches = chunkCards(cardsToGenerate, FLASHCARD_BATCH_SIZE)
    const batchMaps = await mapWithConcurrency(batches, concurrency, async batch => {
      providerCallCounts[currentStage]++
      try {
        return await generateBatchFn(batch, contextFor(batch), options.language, feedbackByCardId)
      } catch {
        return new Map<string, import('./types').GeneratedFlashcard>()
      }
    })
    const merged = new Map<string, import('./types').GeneratedFlashcard>()
    for (const m of batchMaps) for (const [id, card] of m) merged.set(id, card)
    return merged
  }

  const tGenerationStart = Date.now()
  currentStage = 'generation'
  currentErrorStage = 'generation'
  const initial = await runBatches(plan.plannedCards)
  const generationMs = Date.now() - tGenerationStart
  generated = plan.plannedCards.map(pc => initial.get(pc.id) || createFailedCard(pc, new Error('missing_from_batch_response')))
  recordNotationDiagnostics('raw_candidate', 0, generated)
  snapshotStage(0, 'generated', generated)
  // Boundary A: source/Brain representation available for each target
  // (recorded here, not earlier, only because `unitById` isn't built
  // until after `plan` resolves — the helper itself was already
  // initialized above, before any provider work started).
  recordNotationDiagnostics('source_brain', -1, plan.plannedCards.map(pc => ({
    id: pc.id,
    question: '',
    answer: pc.sourceUnitIds.map(id => unitById.get(id)?.statement || '').join(' '),
  })))

  let tValidationMs = 0
  let dedupMs = 0
  let repairMs = 0
  const tv0 = Date.now()
  const firstPassCoverage = computeDeckCoverage(applySourceObjectiveSatisfaction(validateDeck(generated, plan, brain)), plan)
  tValidationMs += Date.now() - tv0

  // ── CANONICAL TARGET-BASED REPAIR LOOP (P0 mission) ─────────────────
  // reconcileFinalCoverage(bestValidCards, targets) -> pendingTargetIds ->
  // generate ONLY for those pending targets' PlannedCards -> validate ONLY
  // the new candidates -> candidatePool = bestValidCards UNION valid-new-
  // candidates (an invalid new candidate can never overwrite a previously
  // valid card, since it's simply never added to the pool) -> dedup ->
  // reconcile coverage -> ACCEPT the round only if coverage is monotonic
  // (every previously-covered target stays covered, total never shrinks);
  // otherwise the whole round's result is discarded and bestValidCards
  // stays exactly as it was. This closes the real regression where a
  // repair round's own generation/validation failure was silently
  // OVERWRITING an already-valid card for the same plannedCard.id,
  // destroying coverage that already existed.
  const tv1 = Date.now()
  let bestValidCards = applySourceObjectiveSatisfaction(validateDeck(generated, plan, brain))
  tValidationMs += Date.now() - tv1
  snapshotStage(0, 'validated', bestValidCards)
  recordNotationDiagnostics('validated_repaired', 0, bestValidCards)

  // P1 fix: the most recent generation+validation attempt for each
  // plannedCard.id, regardless of pass/fail — the ONLY source repair
  // feedback is built from, so a round always reacts to ITS OWN target's
  // immediately preceding attempt, never a stale or different card's.
  const lastAttemptByCardId = new Map(bestValidCards.map(c => [c.id, c]))

  const td0 = Date.now()
  currentErrorStage = 'dedup'
  let dedupResult = await reconcilePedagogicalDuplicates(bestValidCards, countingPedagogicalJudgeFn)
  dedupMs += Date.now() - td0
  fullDeckDedupRuns++
  initialDedup.poolSize = bestValidCards.length
  initialDedup.candidatePairs = dedupResult.diagnostics.candidatePairs
  initialDedup.judgeBatches = dedupResult.diagnostics.judgeBatches
  initialDedup.judgeCalls = dedupResult.diagnostics.judgeCalls
  accumulateDedupDiagnostics(dedupResult.diagnostics)
  bestValidCards = dedupResult.cards
  let dedupMergedTotal = dedupResult.mergedCount
  snapshotStage(0, 'dedup', bestValidCards)

  let bestCoverage = reconcileFinalCoverage(bestValidCards, plan)
  const repairTargetsInitial = bestCoverage.pendingTargetIds.length
  let repairAttempts = 0
  let repairGeneratedCandidates = 0
  const repairAttemptedPlannedCardIds = new Set<string>()
  const repairRounds: { pendingBeforeRound: number; generatedForPending: number; newlyCoveredThisRound: number; pendingAfterRound: number; noProgressStop: boolean; regressionRejected: boolean }[] = []
  // FASE D (observability, privacy-minimal): per-attempt record of WHAT
  // strategy/evidence a repair round actually sent, and whether the
  // resulting candidate even changed — never raw question/answer text,
  // only fingerprints. Answers Fase 4's open question ("same text twice,
  // different text same defect, or feedback never applied?") for the
  // NEXT real run without guessing.
  const repairAttemptDiagnostics: {
    plannedCardId: string; round: number
    previousRejectionReasons: string[]
    repairStrategy: string[]
    requiredContextEvidence: string[]
    candidateFingerprintBefore: string
    candidateFingerprintAfter: string
    sameCandidateFingerprint: boolean
    identicalCandidateDetected: boolean
    identicalCandidateEscalated: boolean
  }[] = []
  // Retry budget lives here, PER plannedCardId — round 0's plain
  // generation above already counts as attempt 1 for every card.
  const attemptsUsedByCardId = new Map<string, number>()
  for (const pc of plan.plannedCards) attemptsUsedByCardId.set(pc.id, 1)
  // Once a card enters reconstruction mode it never leaves it for the
  // rest of the run — see RepairFeedback.reconstructFromSource. The
  // value records WHY it escalated (diagnostics only): 'lexical' = a
  // round reproduced the previous candidate byte-for-byte;
  // 'semantic' = the text changed but failed for the exact same
  // rejectionReason set again.
  const reconstructModeByCardId = new Map<string, 'lexical' | 'semantic'>()
  // Escalation ladder. Level advances only once already in reconstruct
  // mode AND the same single reason persists again (any reason: real-deck
  // evidence showed a target stuck on `objective_not_recovered` — a
  // Phase 1 Source-Objective Satisfaction reason, not the original
  // template_leakage/circular_question_answer pair this ladder was first
  // built for — burn its entire budget with ZERO escalation, because the
  // ladder trigger was hardcoded to only those two reason strings. A
  // target reaching this point already passed the terminal-rejection
  // filter upstream (isTerminalRejection, in the targetCards filter) —
  // every reason seen here is inherently retryable, so gating escalation
  // on a specific reason allowlist was never a safety requirement, only
  // an artifact of which reasons the original evidence happened to show).
  // Capped at 2: level 1 rotates CognitiveType (+ withholds
  // retrievalObjective for template_leakage specifically); level 2
  // attempts ONE code-constructed candidate from source fields alone
  // before falling back to further CognitiveType rotation for any
  // remaining budget.
  const ladderLevelByCardId = new Map<string, number>()
  // P1 fix (repair stagnation, real-deck evidence: fingerprint A,A,B,B,B,B,B,B
  // — 6 identical LLM calls burned once strategyLevel saturated at 2):
  // `strategyLevel` controls LADDER SEMANTICS (whether the deterministic
  // fallback has been tried, whether retrievalObjective is withheld) and
  // must stay capped at 2 — generator.ts and every existing test interpret
  // strategyLevel semantically, not as a raw rotation counter. But
  // `rotateCognitiveType`'s rotation AMOUNT was wired directly to that same
  // capped value, so once strategyLevel hit 2 the requested CognitiveType
  // froze forever, even though COGNITIVE_TYPE_ROTATION's 5-state cycle had
  // 3 more distinct forms left to try within the SAME retry budget. This
  // counter is tracked separately, uncapped, and keeps advancing on every
  // escalation trigger after strategyLevel has already saturated —
  // `rotateCognitiveType` already loops `times` times through the cycle,
  // so any count naturally wraps with no changes needed there.
  const cognitiveRotationCountByCardId = new Map<string, number>()
  const deterministicFallbackAttemptedByCardId = new Set<string>()
  function rotateCognitiveType(base: import('./types').CognitiveType, times: number): import('./types').CognitiveType {
    let t = base
    for (let i = 0; i < times; i++) t = COGNITIVE_TYPE_ROTATION[t]
    return t
  }
  // Rolling per-card history (reasons + fingerprint per attempt, starting
  // with round 0) — kept ONLY to populate unresolvedGenerationFailures for
  // whichever cards still haven't validated once the budget runs out.
  const attemptHistoryByCardId = new Map<string, { reasons: string[]; fingerprint: string }[]>()
  for (const pc of plan.plannedCards) {
    const first = lastAttemptByCardId.get(pc.id)
    if (first) {
      attemptHistoryByCardId.set(pc.id, [{
        reasons: first.validationErrors,
        fingerprint: fingerprintText(`${first.question} ${first.answer}`),
      }])
    }
  }
  // P0 hard invariant (coverage as a closing guarantee, not an aspiration):
  // every unresolved target must be explicitly classified as ONE of —
  //   'unresolved_source'              — the deterministic, non-inventing
  //     fallback (buildDeterministicFallbackCard) was actually attempted
  //     for this target and STILL could not produce a valid card (either
  //     it returned null — not constructible from structured fields —, or
  //     it built a candidate that real validators/SOS still rejected).
  //     Since that path never invents anything, this is direct evidence
  //     the source itself lacks sufficient grounding — a legitimate
  //     material limit, not a pipeline defect.
  //   'failed_to_materialize_valid_target' — the guaranteed final-attempt
  //     fallback was never even attempted for this target (should not
  //     happen under the current per-target budget guarantee; if it
  //     does, it is a real pipeline defect, never silently reported as a
  //     normal partial success).
  // This is computed from data ALREADY tracked (deterministicFallbackAttemptedByCardId)
  // — no new mechanism, no new provider call, no new heuristic.
  const unresolvedGenerationFailures: {
    conceptClusterId: string
    plannedCardId: string
    attemptsUsed: number
    rejectionHistory: string[][]
    fingerprintHistory: string[]
    finalReason: string[]
    classification: 'unresolved_source' | 'failed_to_materialize_valid_target'
  }[] = []
  currentStage = 'repair'
  currentErrorStage = 'repair'

  let round = 0
  while (true) {
    const pendingBefore = bestCoverage.pendingTargetIds.length
    if (pendingBefore === 0) break // nothing left to repair

    const pendingSet = new Set(bestCoverage.pendingTargetIds)
    // Only PlannedCards whose target is STILL pending after transfer —
    // never regenerate a target a surviving card already covers. FASE 3
    // mission ("NO HACER REPAIR DE TARGETS IMPOSIBLES"): also exclude any
    // target whose most recent attempt failed for a TERMINAL reason (e.g.
    // non_studyable_document_metadata) — a different wording can never
    // change WHAT the content structurally is. Everything else stays
    // retryable UNTIL its own attempt budget (MAX_GENERATION_ATTEMPTS_PER_TARGET)
    // is exhausted — the retry fuse is per-card, never a shared round count.
    const targetCards = plan.plannedCards.filter(pc => {
      if (!pendingSet.has(pc.conceptClusterId)) return false
      const prev = lastAttemptByCardId.get(pc.id)
      if (prev && isTerminalRejection(prev.validationErrors)) return false
      return (attemptsUsedByCardId.get(pc.id) || 1) < MAX_GENERATION_ATTEMPTS_PER_TARGET
    })
    if (!targetCards.length) break // fully covered, everything remaining is terminal, or every remaining target exhausted its budget

    round++
    repairAttempts++
    repairGeneratedCandidates += targetCards.length
    for (const pc of targetCards) {
      repairAttemptedPlannedCardIds.add(pc.id)
      attemptsUsedByCardId.set(pc.id, (attemptsUsedByCardId.get(pc.id) || 1) + 1)
    }

    // Each target's feedback comes from ITS OWN most recent attempt only.
    // A card at ladder level >= 2 that hasn't tried the deterministic
    // fallback yet is routed to it INSTEAD of the LLM this round — no
    // feedback entry, no provider call for it at all.
    const feedbackByCardId = new Map<string, RepairFeedback>()
    const deterministicCandidates = new Map<string, import('./types').GeneratedFlashcard>()
    const llmTargetCards: import('./types').PlannedCard[] = []
    for (const pc of targetCards) {
      const prev = lastAttemptByCardId.get(pc.id)
      if (!prev) continue
      const ladderLevel = ladderLevelByCardId.get(pc.id) || 0
      // P0 fix (provider variance must never eliminate constructible
      // content): the fallback used to be tried ONLY once the no-progress
      // ladder happened to reach level 2 — a target whose rejection reason
      // kept genuinely varying (real exploration, never triggering the
      // no-progress detector) could exhaust its entire budget without the
      // deterministic, grounded-and-guaranteed-safe candidate ever being
      // attempted, even though it was buildable the whole time. On a
      // target's LAST remaining attempt, try the deterministic candidate
      // unconditionally (regardless of ladder state) — this is the
      // guarantee that a target only ends up genuinely unresolved because
      // the source itself lacks sufficient grounding to build ANY safe
      // candidate (multi-unit/relation cards, or a kind with no safe
      // structured field), never because the provider simply ran out of
      // tries.
      const isFinalAttempt = (attemptsUsedByCardId.get(pc.id) || 1) >= MAX_GENERATION_ATTEMPTS_PER_TARGET
      if ((ladderLevel >= 2 || isFinalAttempt) && !deterministicFallbackAttemptedByCardId.has(pc.id)) {
        deterministicFallbackAttemptedByCardId.add(pc.id)
        const fallback = buildDeterministicFallbackCard(pc, unitById.get(pc.sourceUnitIds[0]))
        if (fallback) {
          deterministicCandidates.set(pc.id, fallback)
          continue // never sent to the LLM this round
        }
        // Not constructible (multi-unit card, or a kind with no safe
        // structured field) — falls through to the LLM path below,
        // still at ladder level 2 (keeps rotating CognitiveType).
      }
      // FASE B ("repair contextless con evidencia concreta"): the SAME
      // authorized displayQualifiers text repairContextlessQuestion
      // (validate.ts) already trusts deterministically for THIS card's
      // source units — never invented, empty when no unit carries one
      // (fail-closed, matches the existing NOT-REPAIRABLE contract).
      const requiredContextEvidence = prev.validationErrors.includes('contextless_question')
        ? [...new Set(pc.sourceUnitIds.flatMap(id => unitById.get(id)?.displayQualifiers || []))]
        : []
      const reconstructTrigger = reconstructModeByCardId.get(pc.id)
      const dominantReason = prev.validationErrors[0]
      // Rotation amount tracks its OWN uncapped counter once the ladder
      // is active — see cognitiveRotationCountByCardId above. Falls back
      // to `ladderLevel` itself only as the initial seed (never observed
      // yet for this card), so the very first escalated round (level 1)
      // still requests exactly one rotation, matching prior behavior.
      const rotationCount = ladderLevel >= 1 ? (cognitiveRotationCountByCardId.get(pc.id) ?? ladderLevel) : 0
      llmTargetCards.push(pc)
      feedbackByCardId.set(pc.id, {
        plannedCardId: pc.id,
        rejectionReasons: prev.validationErrors,
        requiredPreservations: prev.requiredPreservations || [],
        previousCandidate: (prev.question || prev.answer) ? { question: prev.question, answer: prev.answer } : undefined,
        requiredContextEvidence,
        previousAttemptWasIdentical: reconstructTrigger === 'lexical',
        reconstructFromSource: reconstructTrigger !== undefined,
        strategyLevel: ladderLevel >= 1 ? (ladderLevel >= 2 ? 2 : 1) : undefined,
        cognitiveTypeOverride: ladderLevel >= 1 ? rotateCognitiveType(pc.cognitiveType, rotationCount) : undefined,
        suppressRetrievalObjective: ladderLevel >= 1 && dominantReason === 'template_leakage',
      })
    }

    const tr0 = Date.now()
    const repaired = await runBatches(llmTargetCards, feedbackByCardId)
    repairMs += Date.now() - tr0
    for (const [id, c] of deterministicCandidates) repaired.set(id, c)
    recordNotationDiagnostics('raw_candidate', round, [...repaired.values()])
    snapshotStage(round, 'generated', [...repaired.values()])

    const tv2 = Date.now()
    const newlyGenerated = targetCards.map(pc => repaired.get(pc.id) || createFailedCard(pc, new Error('missing_from_batch_response')))
    const validatedNew = applySourceObjectiveSatisfaction(validateDeck(newlyGenerated, plan, brain))
    tValidationMs += Date.now() - tv2
    // FASE D: record per-attempt diagnostics BEFORE lastAttemptByCardId
    // is overwritten below — "before" fingerprint is the attempt this
    // round's feedback was actually built from.
    for (const c of validatedNew) {
      const feedback = feedbackByCardId.get(c.id)
      // Deterministic-fallback candidates never got a feedback entry (they
      // skip the LLM path entirely) — fall back to lastAttemptByCardId
      // directly so the before/after comparison still works for them.
      const prevAttempt = lastAttemptByCardId.get(c.id)
      const before = feedback?.previousCandidate || (prevAttempt && (prevAttempt.question || prevAttempt.answer) ? { question: prevAttempt.question, answer: prevAttempt.answer } : undefined)
      const fingerprintBefore = before ? fingerprintText(`${before.question} ${before.answer}`) : ''
      const fingerprintAfter = fingerprintText(`${c.question} ${c.answer}`)
      const sameCandidateFingerprint = fingerprintBefore !== '' && fingerprintBefore === fingerprintAfter
      const reasonsBefore = feedback?.rejectionReasons || prevAttempt?.validationErrors || []
      const reasonsAfter = c.validationErrors
      // Semantic no-progress (type B): the text changed (not lexically
      // identical) but failed for the EXACT SAME rejectionReason set as
      // what was fed into this round — patching the wording isn't
      // converging, even though it isn't a literal repeat.
      const sameReasonSet = !c.validated && reasonsBefore.length > 0
        && reasonsBefore.length === reasonsAfter.length
        && [...new Set(reasonsBefore)].sort().join('|') === [...new Set(reasonsAfter)].sort().join('|')
      const wasAlreadyReconstructing = reconstructModeByCardId.has(c.id)
      const singleReasonAfter = [...new Set(reasonsAfter)]
      const scopedReason = !c.validated && singleReasonAfter.length === 1 ? singleReasonAfter[0] : null
      // P2 fix (alternating-failure stagnation, real-deck evidence: a
      // target cycling template_leakage -> notation_structure_lost ->
      // template_leakage -> ... never re-triggers sameReasonSet/
      // sameCandidateFingerprint, because both only look ONE round back —
      // an A/B/A/B/... cycle passes that check on every single step even
      // though the SAME already-rejected candidate keeps reappearing.
      // `attemptHistoryByCardId` (below) already records every prior
      // attempt for this card — read BEFORE this round's own result is
      // pushed into it (the push happens further down), so `priorHistory`
      // here never includes the current attempt. A revisit is judged by
      // STATE (fingerprint + its own normalized reason set together), not
      // by the reason alone: a genuinely NEW candidate that happens to
      // fail for a previously-seen reason (real exploration, mission Test
      // L2) must NOT be treated as no-progress just because the reason
      // recurs — only an exact fingerprint+reason repeat proves the
      // target is cycling through already-rejected states.
      const priorHistory = attemptHistoryByCardId.get(c.id) || []
      const normalizedReasonSetAfter = [...new Set(reasonsAfter)].sort().join('|')
      const stateSeenBefore = !c.validated && priorHistory.some(h =>
        h.fingerprint === fingerprintAfter && [...new Set(h.reasons)].sort().join('|') === normalizedReasonSetAfter,
      )
      if (!c.validated && (sameCandidateFingerprint || sameReasonSet || stateSeenBefore) && wasAlreadyReconstructing && scopedReason) {
        const currentLevel = ladderLevelByCardId.get(c.id) || 0
        ladderLevelByCardId.set(c.id, Math.min(currentLevel + 1, 2))
        // Ladder semantics (fallback-tried-once, suppressRetrievalObjective)
        // stay capped at 2, but the CognitiveType rotation itself must keep
        // advancing on every further no-progress trigger — otherwise a
        // target stuck at strategyLevel=2 burns its remaining budget on
        // byte-identical calls (real-deck evidence: template_leakage stuck
        // 6 rounds straight once the rotation amount froze at rotate(base,2)).
        const currentRotation = cognitiveRotationCountByCardId.get(c.id) ?? currentLevel
        cognitiveRotationCountByCardId.set(c.id, currentRotation + 1)
      }
      if (!c.validated && !reconstructModeByCardId.has(c.id)) {
        if (sameCandidateFingerprint) reconstructModeByCardId.set(c.id, 'lexical')
        else if (sameReasonSet) reconstructModeByCardId.set(c.id, 'semantic')
      }
      const history = attemptHistoryByCardId.get(c.id) || []
      history.push({ reasons: reasonsAfter, fingerprint: fingerprintAfter })
      attemptHistoryByCardId.set(c.id, history)
      repairAttemptDiagnostics.push({
        plannedCardId: c.id,
        round,
        previousRejectionReasons: reasonsBefore,
        repairStrategy: feedback ? repairStrategyFor(feedback.rejectionReasons) : [],
        requiredContextEvidence: feedback?.requiredContextEvidence || [],
        candidateFingerprintBefore: fingerprintBefore,
        candidateFingerprintAfter: fingerprintAfter,
        sameCandidateFingerprint,
        identicalCandidateDetected: sameCandidateFingerprint || sameReasonSet || stateSeenBefore,
        identicalCandidateEscalated: wasAlreadyReconstructing,
      })
    }
    for (const c of validatedNew) lastAttemptByCardId.set(c.id, c)
    snapshotStage(round, 'validated', validatedNew)
    recordNotationDiagnostics('validated_repaired', round, validatedNew)

    // Only NEW candidates that themselves validated ever enter the pool —
    // an invalid new attempt is simply dropped, never overwrites the
    // still-valid card already sitting in bestValidCards for that id.
    const validNewCandidates = validatedNew.filter(c => c.validated)

    // FASE 1 (P0 mission): delta-scoped dedup, NEVER the full accepted
    // pool again — reconcileRepairCandidates only compares the new
    // candidates against each other and against a NEIGHBOR subset of
    // bestValidCards (same conceptClusterId or shared source ids).
    // fullDeckDedupRuns is NOT incremented here.
    const td1 = Date.now()
    const roundDedupResult = await reconcileRepairCandidates(validNewCandidates, bestValidCards, countingPedagogicalJudgeFn)
    dedupMs += Date.now() - td1
    repairDedupRounds.push({ round, ...roundDedupResult.diagnostics })
    const dedupedPool = roundDedupResult.cards
    snapshotStage(round, 'dedup', dedupedPool)

    const nextCoverage = reconcileFinalCoverage(dedupedPool, plan)
    const prevCoveredSet = new Set(bestCoverage.coveredTargetIds)
    const nextCoveredSet = new Set(nextCoverage.coveredTargetIds)
    // MANDATORY invariant (P0 mission): coverage must be monotonic —
    // every target covered before this round must remain covered, and
    // the total covered count must never shrink. A round that would
    // regress coverage (e.g. dedup or a bad new candidate knocking out
    // an already-covered target) is rejected WHOLESALE — bestValidCards/
    // bestCoverage are left exactly as they were before this round ran.
    const isMonotonicImprovement = nextCoveredSet.size >= prevCoveredSet.size
      && [...prevCoveredSet].every(id => nextCoveredSet.has(id))

    if (isMonotonicImprovement) {
      bestValidCards = dedupedPool
      dedupMergedTotal += roundDedupResult.mergedCount
      bestCoverage = nextCoverage
    }

    const pendingAfter = bestCoverage.pendingTargetIds.length
    const newlyCovered = Math.max(0, pendingBefore - pendingAfter)
    repairRounds.push({
      pendingBeforeRound: pendingBefore, generatedForPending: targetCards.length,
      newlyCoveredThisRound: newlyCovered, pendingAfterRound: pendingAfter, noProgressStop: pendingAfter >= pendingBefore,
      regressionRejected: !isMonotonicImprovement,
    })
    // No aggregate no-progress break: continuation is governed entirely by
    // targetCards.length above — a round with zero remaining eligible
    // cards (everyone covered, terminal, or budget-exhausted) is what ends
    // the loop, never a shared "nothing improved this round" heuristic.
    // Bounded by construction: every card's attemptsUsed strictly
    // increases each time it appears in targetCards, so no card can
    // participate in more than MAX_GENERATION_ATTEMPTS_PER_TARGET - 1
    // rounds — the loop cannot run unbounded.
  }
  // Fuse: any target still pending after the loop above whose PlannedCard
  // exhausted its attempt budget (or was terminal) is recorded here for
  // visibility — never silently dropped, never marked covered artificially.
  {
    const stillPendingSet = new Set(bestCoverage.pendingTargetIds)
    for (const pc of plan.plannedCards) {
      if (!stillPendingSet.has(pc.conceptClusterId)) continue
      const used = attemptsUsedByCardId.get(pc.id) || 1
      const prev = lastAttemptByCardId.get(pc.id)
      const isTerminal = prev ? isTerminalRejection(prev.validationErrors) : false
      const exhausted = used >= MAX_GENERATION_ATTEMPTS_PER_TARGET || isTerminal
      if (!exhausted) continue
      const history = attemptHistoryByCardId.get(pc.id) || []
      // Terminal rejection (e.g. non_studyable_document_metadata) is
      // itself definitive, independent proof of non-representability —
      // never requires the fallback to also have been attempted.
      // Otherwise, classification hinges entirely on whether the
      // guaranteed, non-inventing fallback path was actually exercised
      // for this target before its budget ran out.
      const classification: 'unresolved_source' | 'failed_to_materialize_valid_target' =
        isTerminal || deterministicFallbackAttemptedByCardId.has(pc.id)
          ? 'unresolved_source'
          : 'failed_to_materialize_valid_target'
      unresolvedGenerationFailures.push({
        conceptClusterId: pc.conceptClusterId,
        plannedCardId: pc.id,
        attemptsUsed: used,
        classification,
        rejectionHistory: history.map(h => h.reasons),
        fingerprintHistory: history.map(h => h.fingerprint),
        finalReason: prev?.validationErrors || [],
      })
    }
  }
  // ─────────────────────────────────────────────────────────────────

  const validatedCards = bestValidCards // kept for pipelineTrace's bookend comparison (pre-any-dedup vs final)
  const coverageBeforeDedup = firstPassCoverage
  const dedupedCards = bestValidCards
  const pedagogicalMergesApplied = dedupMergedTotal
  let cards = bestValidCards

  // FASE 3 CORRECCIÓN (bug de semántica de coverage): a TERMINAL
  // rejection (see isTerminalRejection) only means "stop automatically
  // retrying THIS candidate" — it is NEVER proof the target itself is
  // non-academic. That distinction (academic eligibility) is decided
  // exclusively upstream, in planner.ts, BEFORE a PlannedCard ever
  // exists (isDocumentMetadata / isMetadataShapedObjective) — never here,
  // never by re-reading a validation outcome. A target whose only
  // candidate happened to end on a terminal reason stays exactly what it
  // structurally is: a still-pending academic target, still counted in
  // the denominator, exactly like any other unresolved gap. Silently
  // shrinking the denominator here would hide real, demonstrated
  // failures behind an artificially inflated coverage ratio — precisely
  // what this mission forbids.
  let coverage = computeDeckCoverage(cards, plan)
  recordNotationDiagnostics('final_persisted', -1, cards)

  // P0 hard invariant: a deck can only be reported as a normal, usable
  // outcome ('ready' when everything is covered, 'partial' when the ONLY
  // gaps are legitimate, demonstrated source limits) if no gap is
  // classified as 'failed_to_materialize_valid_target' — a target the
  // pipeline never even gave its guaranteed, non-inventing fallback
  // attempt to before exhausting its budget. That is a pipeline defect,
  // never presented as a successfully-terminated partial deck.
  const hasFailedToMaterializeTarget = unresolvedGenerationFailures.some(
    f => f.classification === 'failed_to_materialize_valid_target',
  )
  if (hasFailedToMaterializeTarget) coverage = { ...coverage, hasUnrepresentableFailure: true }
  const status: FlashcardDeck['meta']['status'] =
    coverage.status === 'partial' && hasFailedToMaterializeTarget
      ? 'failed'
      : coverage.status === 'complete' ? 'ready' : coverage.status

  const deck: FlashcardDeck = {
    scope: brain.scope,
    meta: {
      schemaVersion: FLASHCARD_DECK_SCHEMA_VERSION,
      plannerVersion: FLASHCARD_PLANNER_VERSION,
      generatorVersion: FLASHCARD_GENERATOR_VERSION,
      validatorVersion: FLASHCARD_VALIDATOR_VERSION,
      status,
      // Audit identity of the revision this deck froze. Never fabricated.
      enrichmentRevision: typeof brain.meta.enrichmentRevision === 'number'
        ? brain.meta.enrichmentRevision
        : null,
      generatedAt: new Date().toISOString(),
      llmCallsUsed: cards.filter(c => !c.validationErrors.some(e => e.startsWith('generation_failed:'))).length,
      retries: 0,
      pedagogicalMergesApplied,
    },
    cards,
    coverage,
  }

  await store.set(brain.scope.fingerprint, deck)

  // OBSERVABILITY ONLY: computed from the already-final `deck` — never
  // read afterwards, never able to change what was just persisted or
  // returned. Failure here must never fail deck generation itself.
  try {
    const { counts, pendingTargets, finalCoverage, detailedTargetTraces } = buildPipelineTraceCounts({
      brain, plan,
      generatedAfterRepairLoop: bestValidCards,
      validatedBeforeDedup: validatedCards,
      dedupedCards,
      finalCards: cards,
      coverageBeforeDedup,
      coverageFinal: coverage,
      repairTargetsInitial,
      repairAttempts,
      repairGeneratedCandidates,
      repairAttemptedPlannedCardIds,
      dedupMergedCount: pedagogicalMergesApplied,
      providerCalls: { generation: providerCallCounts.generation, repair: providerCallCounts.repair, dedupJudge: pedagogicalDedupProviderCalls, planDedup: planDedupProviderCalls },
      timingsMs: {
        planning: planningMs,
        generation: generationMs,
        validation: tValidationMs,
        dedup: dedupMs,
        repair: repairMs,
        total: Date.now() - traceStart,
      },
      repairRounds,
      stageSnapshots,
    })
    // DEV-only detail (per-target trace, notation-boundary diagnostics) —
    // production only ever sees the one FLASHCARDS_PIPELINE_TRACE summary
    // line, per the mission's own "no llenes producción con logs" rule.
    const devVerbose = process.env.NODE_ENV !== 'production'
    logPipelineTrace(brain.scope.fingerprint, counts, pendingTargets, finalCoverage, devVerbose, traceRunId, detailedTargetTraces, notationDiagnostics)

    // DEV-only file persistence — same objects just logged above, written
    // ONCE so a real regeneration's trace survives past terminal
    // scrollback. Fail-open (see tracePersistence.ts); never affects the
    // deck already built/persisted/returned above.
    await persistFlashcardsTrace({
      runId: traceRunId,
      fingerprint: brain.scope.fingerprint,
      createdAt: new Date().toISOString(),
      status: 'ok',
      pipelineTrace: counts,
      pendingTargets,
      targetTraces: detailedTargetTraces,
      notationDiagnostics,
      finalCoverage,
      dedupDiagnostics: {
        ...dedupDiagnosticsAccumulator,
        mergedCount: pedagogicalMergesApplied,
        fullDeckDedupRuns,
        initialDedup,
        repairDedupRounds,
      },
      // FASE D (observability for the 2 LOW-confidence findings from the
      // surgical audit — copyright, Tier-1 merge) — privacy-minimal,
      // never full unit/card text, only fingerprints/booleans/reason
      // codes/ids already computed above.
      repairAttemptDiagnostics,
      unresolvedGenerationFailures,
      mergeDiagnostics: plan.mergeDiagnostics,
      metadataDiagnostics: plan.metadataDiagnostics,
    })
  } catch (err) {
    console.log('[Flashcards] FLASHCARDS_PIPELINE_TRACE_ERROR', JSON.stringify({ fingerprint: brain.scope.fingerprint, runId: traceRunId, message: (err as Error)?.message }))
  }

  return { status, deck }
  } catch (err) {
    // P0 mission: best-effort PARTIAL trace on a real thrown error —
    // fail-open, DEV-only, then the ORIGINAL error is re-thrown
    // unchanged so route.ts's existing error handling is untouched.
    // Doubly fail-open here: persistFlashcardsTrace already never
    // throws, but this extra guard ensures NOTHING in this catch block
    // can ever mask the original error.
    try {
      await persistFlashcardsTrace({
        runId: traceRunId,
        fingerprint: brain.scope.fingerprint,
        createdAt: new Date().toISOString(),
        status: 'failed',
        errorStage: currentErrorStage,
        errorMessage: (err as Error)?.message || String(err),
      })
    } catch { /* never let trace persistence shadow the real error */ }
    throw err
  }
}
