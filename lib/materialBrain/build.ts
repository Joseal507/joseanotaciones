import type { BrainScope, MaterialBrain, MaterialBrainChunkCheckpoint, PageChunk, ResolvedSourceMaterial } from './types'
import { MATERIAL_BRAIN_SCHEMA_VERSION } from './types'
import { chunkMaterials, DEFAULT_CHUNK_SIZE_CHARS, splitExtractionSubchunks } from './chunking'
import { extractChunk, type ChunkExtractionResult } from './extraction'
import { createChunkTelemetry, summarizeChunkRejectionsForLog } from './extractionTelemetry'

const IS_DEV = process.env.NODE_ENV !== 'production'
import { mergeExtractions } from './merge'
import { computeSourceCoverage, computeKnowledgeExtractionReport } from './coverage'
import { classifyFailure } from './retryClassification'
import { buildDeterministicFallbackExtraction } from './deterministicFallback'
import { resolveMaterialBrainReadiness } from './readiness'
import { isNonAcademicText } from './academicSegment'
import { mergeRichWithFallbackCoverage } from './coverageMerge'
import {
  prepareMaterialBrainMultimodalSources,
  type MultimodalPreparationOptions,
} from './multimodal'

export const MATERIAL_BRAIN_BUILDER_VERSION = '2.3.0'

export interface BuildCheckpointFlush {
  chunkCheckpoints: Record<string, MaterialBrainChunkCheckpoint>
  subchunkCheckpoints: Record<string, MaterialBrainChunkCheckpoint>
  llmCallsUsed: number
  retries: number
}

export interface BuildOptions extends MultimodalPreparationOptions {
  chunkSizeChars?: number
  maxDirectedRetries?: number
  concurrency?: number
  extractFn?: typeof extractChunk
  multimodal?: boolean
  previousBrain?: MaterialBrain
  /**
   * Early persistence (P0 resilience fix): called after EVERY extraction
   * round (initial + each retry round) with the checkpoints completed
   * SO FAR. The caller should durably persist these promptly so that a
   * crash/timeout/interruption mid-build never loses already-validated
   * leaves — the next attempt resumes from here instead of re-running
   * provider calls for work that already succeeded. Failures in this
   * callback must never abort the build (best-effort durability, not a
   * build precondition).
   */
  onCheckpointFlush?: (flush: BuildCheckpointFlush) => Promise<void>
  /**
   * Two-level readiness — FAST path (P0 fast-entry architecture).
   * When true, build the deterministic exact-source base for every
   * non-vision leaf immediately — ZERO provider calls. Produces a
   * fully sourceReadiness:'ready' brain (100% required coverage) in
   * milliseconds. Vision leaves are skipped entirely (progressive,
   * optional). Mutually exclusive with enrichmentPass.
   */
  skipRichExtraction?: boolean
  /**
   * Two-level readiness — ENRICHMENT path. Requires `previousBrain`
   * already at sourceReadiness:'ready'. Attempts REAL rich extraction
   * for a BOUNDED batch (enrichmentBatchSize) of leaves still marked
   * usedDeterministicFallback, with at most one directed retry each —
   * never the full maxDirectedRetries budget, per "do not make the
   * user wait for 3 attempts on the same leaf." Leaves outside the
   * batch, and any leaf already rich, are restored unchanged — never
   * re-run. A leaf that fails this pass simply KEEPS its existing
   * fallback checkpoint (never downgraded, never blocks anything) —
   * later enrichment passes may try again.
   */
  enrichmentPass?: boolean
  enrichmentBatchSize?: number
}

const DEFAULTS = {
  chunkSizeChars: DEFAULT_CHUNK_SIZE_CHARS,
  // Bounded — NOT unlimited. Initial attempt + 2 in-build retries per
  // leaf, then the deterministic fallback resolves it IMMEDIATELY in
  // THIS SAME build/request. Never waits for a second POST round-trip
  // to give up on a failing leaf (that was the real P0 bug: identical
  // scope kept getting resubmitted across separate requests).
  maxDirectedRetries: 2,
  // Bounded worker-pool concurrency for independent leaves. 3 was
  // conservative; provider/rate-limit budgets comfortably support more
  // for a preparation-critical path — see MB-PERF-1.
  concurrency: 5,
} as const

const RETRY_REPAIR_SUBCHUNK_CHARS = 600

// P0 — terminal enrichment budget (mission "Material Brain debe tener un
// final real y estable"). A leaf that keeps failing rich extraction
// must NOT stay a candidate forever across separate enrichment passes/
// requests/sessions — that was exactly the gap that let `brainEnrichment`
// sit at 'enriching' indefinitely. Counted in PASSES (each pass already
// gives a leaf up to 1 internal directed retry — see enrichmentPass
// below), not raw provider calls, and persisted on the checkpoint
// itself (`enrichmentAttempts`) so it survives refresh/new session/new
// server invocation. Once a leaf reaches this budget it is permanently
// excluded from future enrichment candidacy — its fallback becomes
// TERMINAL, not just "still pending".
export const MAX_ENRICHMENT_ATTEMPTS_PER_LEAF = 3

export function isCompletedCheckpointStatus(status: MaterialBrainChunkCheckpoint['status'] | undefined): boolean {
  return status === 'complete' || status === 'complete_no_content'
}

/**
 * P0 mission (Phase 3, "make academic loss impossible to hide") — aggregate
 * REAL per-leaf loss counters (droppedStructural/droppedInvalidProvenance —
 * already present on every FINAL, settled checkpoint, rich or fallback)
 * into one Brain-level signal. A leaf only reaches a completed status with
 * nonzero loss via the fallback capacity-ceiling safety valve
 * (deterministicFallback.ts) — never silently, since that valve always
 * sets these same counters. No new duplicate telemetry state: this
 * aggregates the existing fields verbatim. Exported (pure, no I/O) so it
 * is directly unit-testable without depending on real chunking sizes ever
 * being large enough to trip the ceiling end-to-end.
 */
export function computeContentLoss(
  checkpoints: Record<string, MaterialBrainChunkCheckpoint>,
): { hasLoss: boolean; affectedLeafIds: string[]; totalDroppedSegments: number } {
  const affectedLeafIds: string[] = []
  let totalDroppedSegments = 0
  for (const [leafId, checkpoint] of Object.entries(checkpoints)) {
    const loss = (checkpoint.extraction.droppedStructural || 0) + (checkpoint.extraction.droppedInvalidProvenance || 0)
    if (loss > 0) {
      affectedLeafIds.push(leafId)
      totalDroppedSegments += loss
    }
  }
  return { hasLoss: affectedLeafIds.length > 0, affectedLeafIds, totalDroppedSegments }
}

/**
 * Total validation loss for one extraction attempt — lower is better.
 * Used ONLY to compare two attempts for the SAME leaf within one
 * build (never across leaves, never as an absolute quality score).
 */
function extractionLossCount(extraction: ChunkExtractionResult): number {
  return (extraction.droppedStructural || 0) + (extraction.droppedInvalidProvenance || 0)
}

/**
 * True when `next` is NOT a worse result than `previous` for the same
 * leaf (mission: "no asumas que un retry completo debe reemplazar una
 * extracción parcialmente válida si eso reduce calidad"). Retries are
 * NOT guaranteed monotonic — a later attempt can come back with more
 * loss and fewer accepted units than an earlier one for the exact same
 * leaf (observed live: structuralLoss 0 -> 9). Without this guard the
 * retry loop below unconditionally overwrote `resultByChunkId` with
 * whatever the MOST RECENT attempt produced, discarding a strictly
 * better earlier attempt for no reason other than it came first.
 * Comparison: fewer total loss wins; a tie prefers more accepted units.
 */
function isNotWorseExtraction(next: ChunkExtractionResult, previous: ChunkExtractionResult): boolean {
  const nextLoss = extractionLossCount(next)
  const previousLoss = extractionLossCount(previous)
  if (nextLoss !== previousLoss) return nextLoss < previousLoss
  return next.units.length >= previous.units.length
}

/** Conservative deterministic negative classification; formulas remain academic. */
export function isDeterministicallyNonAcademicSegment(chunk: PageChunk): boolean {
  if (chunk.sourceKind === 'vision') return false
  return isNonAcademicText(chunk.text)
}

function extractionLeavesForCheckpoint(
  chunk: PageChunk,
  previous: Record<string, MaterialBrainChunkCheckpoint> | undefined,
  depth = 0,
): PageChunk[] {
  const checkpoint = previous?.[chunk.id]
  if (checkpoint?.status !== 'retryable_failed' || chunk.text.length <= RETRY_REPAIR_SUBCHUNK_CHARS || depth >= 2) {
    return [chunk]
  }
  const children = splitExtractionSubchunks(chunk, RETRY_REPAIR_SUBCHUNK_CHARS)
  if (children.length <= 1 || children[0].id === chunk.id) return [chunk]
  return children.flatMap(child => extractionLeavesForCheckpoint(child, previous, depth + 1))
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

export function extractionHasCompletenessLoss(extraction: ChunkExtractionResult): boolean {
  const explicitFailure = extraction.units.length === 0
    && extraction.warnings.some(w => w.includes('falló extracción'))
  const lossyRecovery = Boolean(extraction.telemetry?.wasRecovered)
    || (extraction.telemetry?.truncatedObjectsInResponse ?? 0) > 0
  const validationLoss = extraction.droppedInvalidProvenance > 0
    || extraction.droppedStructural > 0
  return explicitFailure || lossyRecovery || validationLoss
}

/**
 * E. Retry Classification: determina si un chunk fallido debe
 * reintentarse basándose en la clase del fallo.
 *
 * - transient → retry permitido
 * - recoverable-format con 0 unidades salvadas → retry dirigido
 * - recoverable-format con unidades salvadas → NO retry (ya se recuperó)
 * - deterministic-structural → NO retry (repetir el mismo request es inútil)
 */
function shouldRetryFailedChunk(extraction: ChunkExtractionResult): boolean {
  if (!extractionHasCompletenessLoss(extraction)) return false

  // A partially recovered/truncated response or a response that lost objects
  // during validation is not exhaustive. Retry only this chunk; if the bounded
  // retry remains lossy, persist it as retryable instead of certifying coverage.
  if (extraction.telemetry?.wasRecovered
    || (extraction.telemetry?.truncatedObjectsInResponse ?? 0) > 0
    || extraction.droppedInvalidProvenance > 0
    || extraction.droppedStructural > 0) return true

  // Buscar la clase del fallo en los warnings (extraction.ts la embebe)
  const failureWarning = extraction.warnings.find(w => w.includes('falló extracción'))
  if (!failureWarning) return false

  // Si el warning contiene [class:deterministic-structural], NO reintentar
  if (failureWarning.includes('[class:deterministic-structural]')) return false

  // Si el warning contiene [class:recoverable-format] y ya se recuperaron
  // unidades, NO reintentar (el recovery ya hizo su trabajo)
  if (failureWarning.includes('[class:recoverable-format]') && extraction.units.length > 0) return false

  // transient o recoverable-format sin unidades → retry
  return true
}

function failureReason(extraction: ChunkExtractionResult): string | undefined {
  return extraction.warnings.find(warning => warning.includes('falló extracción'))
    || extraction.warnings.find(warning => warning.includes('respuesta LLM truncada'))
    || (extraction.droppedInvalidProvenance > 0
      ? `knowledge_extraction_loss:invalid_provenance:${extraction.droppedInvalidProvenance}`
      : extraction.droppedStructural > 0
        ? `knowledge_extraction_loss:structural:${extraction.droppedStructural}`
        : undefined)
}

export function checkpointForExtraction(chunk: PageChunk, extraction: ChunkExtractionResult): MaterialBrainChunkCheckpoint {
  const reason = failureReason(extraction)
  return {
    status: !extractionHasCompletenessLoss(extraction)
      ? 'complete'
      : shouldRetryFailedChunk(extraction) ? 'retryable_failed' : 'terminal_failed',
    sourceKind: chunk.sourceKind || 'text',
    ...(reason ? { failureReason: reason } : {}),
    extraction,
  }
}

/** One rule controls both legacy migration/restore and directed retry. */
export function isExtractionCheckpointComplete(checkpoint: MaterialBrainChunkCheckpoint | undefined): boolean {
  if (checkpoint?.status === 'complete_no_content') {
    return checkpoint.extraction.units.length === 0 && checkpoint.extraction.relations.length === 0
      && !extractionHasCompletenessLoss(checkpoint.extraction)
  }
  return checkpoint?.status === 'complete' && !extractionHasCompletenessLoss(checkpoint.extraction)
}

function combineExtractions(chunk: PageChunk, extractions: ChunkExtractionResult[]): ChunkExtractionResult {
  const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)
  for (const extraction of extractions) {
    const child = extraction.telemetry
    if (!child) continue
    telemetry.rawUnits += child.rawUnits
    telemetry.rawRelations += child.rawRelations
    telemetry.acceptedUnits += child.acceptedUnits
    telemetry.acceptedRelations += child.acceptedRelations
    telemetry.rejectedUnits += child.rejectedUnits
    telemetry.rejectedRelations += child.rejectedRelations
    telemetry.rejectedUnitRecords.push(...child.rejectedUnitRecords)
    telemetry.wasRecovered ||= child.wasRecovered
    telemetry.truncatedObjectsInResponse += child.truncatedObjectsInResponse
    if (child.wasRecovered) telemetry.recoveryStrategy = 'partial_recovery'
  }
  return {
    units: extractions.flatMap(extraction => extraction.units),
    relations: extractions.flatMap(extraction => extraction.relations),
    warnings: extractions.flatMap(extraction => extraction.warnings),
    droppedInvalidProvenance: extractions.reduce((sum, extraction) => sum + extraction.droppedInvalidProvenance, 0),
    droppedStructural: extractions.reduce((sum, extraction) => sum + extraction.droppedStructural, 0),
    telemetry,
  }
}

export async function buildMaterialBrain(
  scope: BrainScope,
  materials: ResolvedSourceMaterial[],
  options: BuildOptions = {},
): Promise<MaterialBrain> {
  const opts = { ...DEFAULTS, ...options }
  const extractFn = options.extractFn || extractChunk
  const startedAt = new Date().toISOString()

  const textChunks = chunkMaterials(materials, { chunkSizeChars: opts.chunkSizeChars })
  const multimodal = options.multimodal === false
    ? { visualChunks: [], visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' as const }, signalsByMaterial: {} }
    : await prepareMaterialBrainMultimodalSources(materials, { ...options, skipVisualAnalysis: options.skipRichExtraction })
  const previousSubchunks = options.previousBrain?.meta.subchunkCheckpoints
  const textSubchunksByOuter = new Map(textChunks.map(chunk => [
    chunk.id,
    splitExtractionSubchunks(chunk).flatMap(subchunk =>
      extractionLeavesForCheckpoint(subchunk, previousSubchunks)),
  ]))
  const textSubchunks = textChunks.flatMap(chunk => textSubchunksByOuter.get(chunk.id) || [])
  const allChunks = [...new Map([...textSubchunks, ...multimodal.visualChunks]
    .map((chunk, order) => [chunk.id, { ...chunk, order }])).values()]
  const resultByChunkId = new Map<string, ChunkExtractionResult>()
  const checkpointByChunkId = new Map<string, MaterialBrainChunkCheckpoint>()
  let llmCallsUsed = 0
  let retries = 0

  const runRound = async (chunks: PageChunk[]) => {
    // MB-REALBUG-3 hard invariant: a canonically complete leaf is
    // absorbing — the scheduler must NEVER select it for execution
    // again. This is not defensive decoration; it is the exact
    // regression this mission is about, so it fails loudly rather than
    // silently re-running provider work.
    for (const chunk of chunks) {
      const existing = checkpointByChunkId.get(chunk.id)
      if (existing && isCompletedCheckpointStatus(existing.status)) {
        throw new Error(`FATAL_INVARIANT_VIOLATION: scheduler selected already-complete leaf "${chunk.id}" (status=${existing.status}) for execution`)
      }
    }
    // Per-leaf error isolation: one leaf throwing (unexpected — the
    // real extractFn never does) must never destroy its siblings'
    // already-resolved results within the same concurrent round. A
    // thrown leaf degrades to a retryable failure instead of losing
    // the whole round's progress (MB-RESIL-11 / Section 21).
    const outcomes = await mapWithConcurrency(chunks, opts.concurrency, async chunk => {
      llmCallsUsed++
      try {
        const { extraction } = await extractFn(chunk, chunk.id)
        return { chunk, extraction }
      } catch (error: any) {
        return {
          chunk,
          extraction: {
            units: [], relations: [], droppedInvalidProvenance: 0, droppedStructural: 0,
            warnings: [`chunk ${chunk.id} falló extracción tras agotar reintentos: ${error?.message || String(error)} [class:transient]`],
            telemetry: createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages),
          } satisfies ChunkExtractionResult,
        }
      }
    })
    for (const { chunk, extraction } of outcomes) {
      const priorExtraction = resultByChunkId.get(chunk.id)
      if (priorExtraction && !isNotWorseExtraction(extraction, priorExtraction)) {
        // This retry came back WORSE than the attempt already on file
        // for this exact leaf — keep the better one. The prior
        // checkpoint's status (very likely still 'retryable_failed',
        // since only retryable leaves get re-scheduled) is left
        // untouched, so the retry loop's own bound naturally decides
        // whether to try again, exactly as if this attempt had not
        // reduced quality at all.
        if (IS_DEV) {
          console.log('[MaterialBrain] material_brain_leaf_retry_discarded_worse_result', JSON.stringify({
            leafId: chunk.id,
            keptUnitsAccepted: priorExtraction.units.length, keptLoss: extractionLossCount(priorExtraction),
            discardedUnitsAccepted: extraction.units.length, discardedLoss: extractionLossCount(extraction),
          }))
        }
        continue
      }
      resultByChunkId.set(chunk.id, extraction)
      const checkpoint = checkpointForExtraction(chunk, extraction)
      checkpointByChunkId.set(chunk.id, checkpoint)
      // MB-REALBUG-1: explicit distinction between "provider returned
      // valid JSON" (generation_validated, logged deep inside the
      // generation pipeline) and "leaf is canonically complete" (this
      // event). A leaf can pass JSON/schema validation and STILL end up
      // retryable_failed here because individual units were rejected
      // for provenance/structural reasons afterward — that loss is
      // exactly what this event makes visible.
      console.log('[MaterialBrain] material_brain_leaf_finalized', JSON.stringify({
        leafId: chunk.id,
        finalStatus: checkpoint.status,
        unitsAccepted: extraction.units.length,
        relationsAccepted: extraction.relations.length,
        structuralLoss: extraction.droppedStructural,
        provenanceLoss: extraction.droppedInvalidProvenance,
        fallbackUsed: false,
        willRetry: checkpoint.status === 'retryable_failed',
        // DEV-only diagnostic (mission: "which validation condition
        // rejected these units, observed deterministically"). Reason
        // enum + kind only — never quotes/detail/canonicalSubject, so
        // no source-derived content or provider payload is logged.
        ...(IS_DEV && extraction.telemetry ? { rejections: summarizeChunkRejectionsForLog(extraction.telemetry) } : {}),
      }))
    }
  }

  // Early persistence (P0 resilience) — snapshot of everything resolved
  // SO FAR, flushed after every round so a crash/timeout mid-build never
  // discards already-validated leaves. Best-effort: a flush failure
  // never aborts the build.
  const flushProgress = async () => {
    if (!options.onCheckpointFlush) return
    const subchunkCheckpoints: Record<string, MaterialBrainChunkCheckpoint> = {}
    const chunkCheckpoints: Record<string, MaterialBrainChunkCheckpoint> = {}
    for (const chunk of allChunks) {
      const checkpoint = checkpointByChunkId.get(chunk.id)
      if (!checkpoint) continue
      if (chunk.sourceKind === 'vision') chunkCheckpoints[chunk.id] = checkpoint
      else subchunkCheckpoints[chunk.id] = checkpoint
    }
    try {
      await options.onCheckpointFlush({ chunkCheckpoints, subchunkCheckpoints, llmCallsUsed, retries })
    } catch { /* durability is best-effort; the final store.set remains authoritative */ }
  }

  const applyDeterministicFallback = (chunk: PageChunk) => {
    const rawFallbackExtraction = buildDeterministicFallbackExtraction(chunk)
    // Preserve the ORIGINAL attempt's recovery/truncation telemetry
    // markers (audit trail: "this leaf needed recovery before falling
    // back") while keeping the fallback's own accurate unit/relation
    // counts — never silently erase that a provider recovery happened.
    const priorAttempt = resultByChunkId.get(chunk.id)
    const priorTelemetry = priorAttempt?.telemetry
    if (priorTelemetry && rawFallbackExtraction.telemetry) {
      rawFallbackExtraction.telemetry.wasRecovered = priorTelemetry.wasRecovered
      rawFallbackExtraction.telemetry.recoveryStrategy = priorTelemetry.recoveryStrategy
      rawFallbackExtraction.telemetry.truncatedObjectsInResponse = priorTelemetry.truncatedObjectsInResponse
    }
    // Fallback safety (mission invariant: "fallback preserves lost
    // information but never dominates the Brain"): the last exhausted
    // attempt often already produced SOME validly-structured, richer
    // units alongside the ones that failed structural/provenance
    // validation (e.g. 12 accepted + 5 rejected) — giving up on further
    // retries must not throw those 12 away in favor of the cruder raw-
    // sentence fallback for the WHOLE leaf. Reuse the exact same
    // coverage-merge authority already used for the opposite direction
    // (fallback → rich upgrade, coverageMerge.ts) so this is one merge
    // rule, not a second one: the last attempt's own valid units are
    // the base, and deterministic fallback only fills what they did NOT
    // already cover.
    const fallbackExtraction = (priorAttempt && priorAttempt.units.length > 0)
      ? mergeRichWithFallbackCoverage(priorAttempt, rawFallbackExtraction)
      : rawFallbackExtraction
    resultByChunkId.set(chunk.id, fallbackExtraction)
    const fallbackCheckpoint: MaterialBrainChunkCheckpoint = {
      status: fallbackExtraction.units.length ? 'complete' : 'complete_no_content',
      sourceKind: 'text',
      // Always true here regardless of whether the merge below ends up
      // contributing any actual fallback-origin units to the final set
      // — this flag records that the leaf exhausted its retry budget
      // and went through the give-up path (a build-process fact other
      // logic, e.g. enrichment-pass upgrade eligibility, depends on),
      // not "the final content still contains raw fallback text".
      usedDeterministicFallback: true,
      extraction: fallbackExtraction,
    }
    checkpointByChunkId.set(chunk.id, fallbackCheckpoint)
    console.log('[MaterialBrain] material_brain_leaf_finalized', JSON.stringify({
      leafId: chunk.id, finalStatus: fallbackCheckpoint.status,
      unitsAccepted: fallbackExtraction.units.length, relationsAccepted: 0,
      // P0 fix: these used to be hardcoded 0 even when the fallback's own
      // capacity ceiling dropped content — now reflects the REAL counters
      // buildDeterministicFallbackExtraction produces (see deterministicFallback.ts).
      structuralLoss: fallbackExtraction.droppedStructural, provenanceLoss: fallbackExtraction.droppedInvalidProvenance,
      fallbackUsed: true, willRetry: false,
      // DEV-only diagnostic: the rich attempt's own rejection trail
      // (why it never became 'complete' before falling back) plus the
      // fallback extraction's own rejections, if any. Same safe shape
      // as the rich-path log above.
      //
      // BUGFIX (live evidence: "why does deterministic fallback report
      // the SAME malformed formula rejections as the prior attempt?"):
      // it never did — after mergeRichWithFallbackCoverage (c25709f),
      // `fallbackExtraction.telemetry` is `appendUncovered`'s spread of
      // the RICH side's own telemetry (`telemetry: rich.telemetry`,
      // coverageMerge.ts), i.e. the SAME object as `priorTelemetry`.
      // Reading it here for "fallbackRejections" just re-displayed the
      // prior attempt's own rejections a second time under a
      // misleading label. `buildDeterministicFallbackExtraction`
      // performs no JSON/schema validation at all (it builds units
      // directly from verbatim sentences) and structurally CANNOT
      // produce a `malformed_unit` rejection — using its OWN telemetry
      // (`rawFallbackExtraction`, before any merge) proves that.
      ...(IS_DEV ? {
        priorRejections: priorTelemetry ? summarizeChunkRejectionsForLog(priorTelemetry) : [],
        ...(rawFallbackExtraction.telemetry ? { fallbackRejections: summarizeChunkRejectionsForLog(rawFallbackExtraction.telemetry) } : {}),
      } : {}),
    }))
  }

  let enrichmentUpgradedAtLeastOneLeaf = false

  // MB-FAST-RUNTIME: vision leaves are deliberately skipped by the fast
  // (skipRichExtraction) and enrichment paths — "optional, handled
  // progressively later" — but every consumer downstream (mergeExtractions,
  // visualCheckpoints, brain.units/relations assembly) unconditionally
  // reads `.units`/`.extraction` off EVERY chunk in `allChunks`, vision
  // included. A skipped vision leaf must still get an honest, valid,
  // empty extraction+checkpoint — never left unset — so the shape of the
  // fast-base MaterialBrain is structurally identical to the fully rich
  // one, only its content differs. This is NOT deterministic fallback
  // (no verbatim quote to anchor a vision leaf to) — it truthfully
  // reports zero units/relations, not-yet-attempted.
  const applyPendingVisualPlaceholder = (chunk: PageChunk) => {
    const extraction: ChunkExtractionResult = {
      units: [], relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0,
      telemetry: createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages),
    }
    resultByChunkId.set(chunk.id, extraction)
    checkpointByChunkId.set(chunk.id, {
      status: 'complete_no_content', sourceKind: 'vision', extraction,
    })
  }

  if (options.skipRichExtraction) {
    // ─── FAST PATH (two-level readiness) — ZERO provider calls. ───
    // Restore any already-complete (possibly RICH) leaves from
    // previousBrain first — a fast-base build must never throw away
    // enrichment progress a prior attempt already achieved. Every
    // remaining non-vision leaf becomes a deterministic exact-source
    // base unit immediately. Vision leaves are simply skipped
    // (optional, handled progressively by a later enrichment pass).
    for (const chunk of allChunks) {
      const checkpoint = options.previousBrain?.meta.subchunkCheckpoints?.[chunk.id]
        || options.previousBrain?.meta.chunkCheckpoints?.[chunk.id]
      if (checkpoint && isCompletedCheckpointStatus(checkpoint.status)) {
        resultByChunkId.set(chunk.id, checkpoint.extraction)
        checkpointByChunkId.set(chunk.id, checkpoint)
      }
    }
    for (const chunk of allChunks) {
      if (resultByChunkId.has(chunk.id) || chunk.sourceKind === 'vision') continue
      applyDeterministicFallback(chunk)
    }
    for (const chunk of allChunks) {
      if (resultByChunkId.has(chunk.id) || chunk.sourceKind !== 'vision') continue
      applyPendingVisualPlaceholder(chunk)
    }
    await flushProgress()
  } else if (options.enrichmentPass) {
    // ─── ENRICHMENT PATH (two-level readiness) — bounded batch of
    // real rich extraction attempts, upgrading fallback-marked leaves
    // from `previousBrain`. Everything else is restored UNCHANGED —
    // never re-run, per the absorbing-complete-state invariant.
    const enrichmentPassStartedAt = Date.now()
    const previous = options.previousBrain
    const richBefore = previous?.meta.extractionQuality?.richPercent ?? 0
    for (const chunk of allChunks) {
      const checkpoint = previous?.meta.subchunkCheckpoints?.[chunk.id] || previous?.meta.chunkCheckpoints?.[chunk.id]
      if (checkpoint && isCompletedCheckpointStatus(checkpoint.status) && !checkpoint.usedDeterministicFallback) {
        resultByChunkId.set(chunk.id, checkpoint.extraction)
        checkpointByChunkId.set(chunk.id, checkpoint)
      }
    }
    const priorAttempts = (chunk: PageChunk) =>
      (previous?.meta.subchunkCheckpoints?.[chunk.id] || previous?.meta.chunkCheckpoints?.[chunk.id])?.enrichmentAttempts || 0
    // A leaf that already spent its enrichment budget is PERMANENTLY
    // excluded from candidacy — never re-attempted again, ever. This is
    // what prevents infinite enrichment for a persistently-failing leaf.
    const eligibleForEnrichment = allChunks
      .filter(chunk => !resultByChunkId.has(chunk.id) && chunk.sourceKind !== 'vision' && priorAttempts(chunk) < MAX_ENRICHMENT_ATTEMPTS_PER_LEAF)
    const upgradeCandidates = eligibleForEnrichment.slice(0, options.enrichmentBatchSize ?? 8)
    await runRound(upgradeCandidates)
    // At most ONE directed retry for this batch — never the full
    // maxDirectedRetries budget during enrichment (mission Section 6).
    const enrichmentRetryable = upgradeCandidates.filter(chunk => checkpointByChunkId.get(chunk.id)?.status === 'retryable_failed')
    if (enrichmentRetryable.length) {
      retries += enrichmentRetryable.length
      await runRound(enrichmentRetryable)
    }
    for (const chunk of upgradeCandidates) {
      const outcome = checkpointByChunkId.get(chunk.id)
      if (outcome && isCompletedCheckpointStatus(outcome.status) && !outcome.usedDeterministicFallback) {
        enrichmentUpgradedAtLeastOneLeaf = true
        // P0 coverage-monotonicity fix: a rich extraction that is
        // individually valid (zero structural/provenance loss on the
        // units it returned) is NOT thereby guaranteed exhaustive — it
        // can legitimately be a smaller, well-formed SUBSET of what the
        // fallback it is about to replace already proved existed. Never
        // let a "successful" upgrade silently drop coverage.
        const priorFallback = previous?.meta.subchunkCheckpoints?.[chunk.id] || previous?.meta.chunkCheckpoints?.[chunk.id]
        if (priorFallback?.usedDeterministicFallback) {
          const merged = mergeRichWithFallbackCoverage(outcome.extraction, priorFallback.extraction)
          if (merged !== outcome.extraction) {
            resultByChunkId.set(chunk.id, merged)
            checkpointByChunkId.set(chunk.id, { ...outcome, extraction: merged })
          }
        }
        continue
      }
      // Rich attempt failed this pass — KEEP the existing fallback
      // checkpoint (never downgrade, never leave retryable/blocking),
      // but record that ONE MORE real attempt was spent on this leaf —
      // durable across passes/sessions via `enrichmentAttempts`.
      const priorFallback = previous?.meta.subchunkCheckpoints?.[chunk.id] || previous?.meta.chunkCheckpoints?.[chunk.id]
      const attempts = priorAttempts(chunk) + 1
      if (priorFallback) {
        const updated = { ...priorFallback, enrichmentAttempts: attempts }
        resultByChunkId.set(chunk.id, updated.extraction)
        checkpointByChunkId.set(chunk.id, updated)
      } else {
        applyDeterministicFallback(chunk)
        const fresh = checkpointByChunkId.get(chunk.id)
        if (fresh) checkpointByChunkId.set(chunk.id, { ...fresh, enrichmentAttempts: attempts })
      }
    }
    // Any leaf outside this batch's slice (including budget-exhausted
    // leaves, which never entered `eligibleForEnrichment` at all):
    // restore from previousBrain unchanged.
    for (const chunk of allChunks) {
      if (resultByChunkId.has(chunk.id)) continue
      const checkpoint = previous?.meta.subchunkCheckpoints?.[chunk.id] || previous?.meta.chunkCheckpoints?.[chunk.id]
      if (checkpoint) {
        resultByChunkId.set(chunk.id, checkpoint.extraction)
        checkpointByChunkId.set(chunk.id, checkpoint)
      } else if (chunk.sourceKind !== 'vision') {
        applyDeterministicFallback(chunk)
      } else {
        applyPendingVisualPlaceholder(chunk)
      }
    }
    await flushProgress()
    // Telemetry (Section 14) — sized to tune enrichmentBatchSize
    // against real provider latency without guessing.
    const upgradedCount = upgradeCandidates.filter(chunk => {
      const cp = checkpointByChunkId.get(chunk.id)
      return cp && isCompletedCheckpointStatus(cp.status) && !cp.usedDeterministicFallback
    }).length
    console.log('[MaterialBrain] enrichment_batch_finalized', JSON.stringify({
      batchLeafCount: upgradeCandidates.length,
      providerAttempts: upgradeCandidates.length + enrichmentRetryable.length,
      durationMs: Date.now() - enrichmentPassStartedAt,
      richPercentBefore: richBefore,
      leavesUpgradedThisBatch: upgradedCount,
      leavesFailedThisBatch: upgradeCandidates.length - upgradedCount,
    }))
  } else {
    // ─── LEGACY / FULL PATH (unchanged) — used when the caller wants
    // a single build to fully resolve everything itself, rich
    // extraction with bounded retries, then immediate deterministic
    // fallback for whatever remains. Still the path production tests
    // exercise directly; two-level readiness in productionStore.ts
    // uses skipRichExtraction/enrichmentPass instead.
    for (const chunk of allChunks) {
      const checkpoint = options.previousBrain?.meta.subchunkCheckpoints?.[chunk.id]
        || options.previousBrain?.meta.chunkCheckpoints?.[chunk.id]
      if (isExtractionCheckpointComplete(checkpoint)
        || (checkpoint?.status === 'terminal_failed' && !shouldRetryFailedChunk(checkpoint.extraction))) {
        resultByChunkId.set(chunk.id, checkpoint.extraction)
        checkpointByChunkId.set(chunk.id, checkpoint)
      }
    }

    for (const chunk of allChunks) {
      if (resultByChunkId.has(chunk.id) || !isDeterministicallyNonAcademicSegment(chunk)) continue
      const extraction: ChunkExtractionResult = {
        units: [], relations: [], warnings: ['complete_no_content:deterministic_non_academic_segment'],
        droppedInvalidProvenance: 0, droppedStructural: 0,
        telemetry: createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages),
      }
      resultByChunkId.set(chunk.id, extraction)
      checkpointByChunkId.set(chunk.id, {
        status: 'complete_no_content', sourceKind: chunk.sourceKind || 'text', extraction,
      })
    }

    await runRound(allChunks.filter(chunk => !resultByChunkId.has(chunk.id)))
    await flushProgress()

    for (let round = 0; round < opts.maxDirectedRetries; round++) {
      // E. Solo reintentar chunks cuyo fallo lo justifica (no determinísticos)
      const retryableChunks = allChunks.filter(chunk => checkpointByChunkId.get(chunk.id)?.status === 'retryable_failed')
      if (retryableChunks.length === 0) break
      retries += retryableChunks.length
      await runRound(retryableChunks)
      await flushProgress()
    }

    // Deterministic exact-source fallback (P0 resilience) — the terminal
    // safety net for TEXT leaves that are STILL unresolved after bounded
    // provider retries/scope-narrowing. Never applied to vision leaves
    // (no verbatim quote to anchor to). Never invents knowledge — see
    // deterministicFallback.ts. This is what lets a persistent provider
    // JSON-formatting failure on one tiny leaf stop being a single point
    // of total failure for the whole material.
    //
    // CRITICAL: applied IMMEDIATELY, in THIS SAME build/request, right
    // after the bounded in-build retry loop above — never deferred to a
    // "next POST will catch it" cross-build cycle. The real production
    // bug this mission is about was EXACTLY that deferral: a leaf that
    // failed its bounded retries kept getting resubmitted with the
    // identical scope/prompt across separate requests instead of falling
    // back right away. "Bound attempts PER SCOPE" (mission) means the
    // bound is initial + maxDirectedRetries — once exhausted, fall back
    // now, in this build, so a single request converges to ready.
    for (const chunk of allChunks) {
      if (chunk.sourceKind === 'vision') continue
      const checkpoint = checkpointByChunkId.get(chunk.id)
      if (checkpoint && isCompletedCheckpointStatus(checkpoint.status)) continue
      applyDeterministicFallback(chunk)
      // This build already spent its FULL real budget in-build
      // (initial + maxDirectedRetries) before falling back — mark it
      // immediately exhausted so it never becomes a perpetual
      // "still enriching" candidate for a fingerprint that only ever
      // runs the legacy single-pass path.
      const fresh = checkpointByChunkId.get(chunk.id)
      if (fresh) checkpointByChunkId.set(chunk.id, { ...fresh, enrichmentAttempts: MAX_ENRICHMENT_ATTEMPTS_PER_LEAF })
    }
    await flushProgress()
  }

  const failedChunkIds = new Set(allChunks
    .filter(chunk => !isCompletedCheckpointStatus(checkpointByChunkId.get(chunk.id)?.status))
    .map(chunk => chunk.id))
  const failedRequiredChunkIds = new Set(
    textChunks.filter(chunk => (textSubchunksByOuter.get(chunk.id) || [])
      .some(subchunk => failedChunkIds.has(subchunk.id))).map(chunk => chunk.id),
  )

  const perChunkResults = allChunks.map(chunk => ({ chunk, extraction: resultByChunkId.get(chunk.id)! }))
  const { units, relations, mergeLog, unitsExtractedRaw, droppedAmbiguousRelations, relationWarnings } = mergeExtractions(perChunkResults)

  const sourceCoverage = computeSourceCoverage(textChunks, failedRequiredChunkIds, units)
  const knowledgeExtraction = computeKnowledgeExtractionReport(
    perChunkResults,
    failedChunkIds,
    unitsExtractedRaw,
    droppedAmbiguousRelations,
    relationWarnings,
  )
  for (const error of multimodal.visualCoverage.preparationErrors || []) {
    knowledgeExtraction.warnings.push(
      `visual_preparation_failed:${error.materialId}:${error.stage}:${error.code || 'unknown'}`,
    )
  }

  const readiness = resolveMaterialBrainReadiness({ sourceCoverageStatus: sourceCoverage.status })
  const status = readiness.status

  // Internal quality signal (Phase 7) — NEVER affects `status` above.
  // richPercent = leaves resolved with real provider-derived semantics;
  // fallbackPercent = leaves resolved via the deterministic exact-source
  // fallback; noContentPercent = deterministic non-academic classification.
  const qualityTotal = textSubchunks.length || 1
  let richCount = 0, fallbackCount = 0, noContentCount = 0
  for (const chunk of textSubchunks) {
    const checkpoint = checkpointByChunkId.get(chunk.id)
    if (checkpoint?.usedDeterministicFallback) fallbackCount++
    else if (checkpoint?.status === 'complete_no_content') noContentCount++
    else if (checkpoint?.status === 'complete') richCount++
  }
  const extractionQuality = {
    richPercent: Math.round((richCount / qualityTotal) * 100),
    fallbackPercent: Math.round((fallbackCount / qualityTotal) * 100),
    noContentPercent: Math.round((noContentCount / qualityTotal) * 100),
  }

  // Two-level readiness fields. sourceReadiness mirrors `status`
  // (required source representation) — the hub-gate contract.
  // brainEnrichment tracks how much of that representation is RICH
  // (provider semantics) vs deterministic fallback, independent of
  // sourceReadiness — enrichment progress never affects hub entry.
  const sourceReadiness: MaterialBrain['meta']['sourceReadiness'] =
    status === 'ready' ? 'ready' : status === 'failed' ? 'failed' : 'preparing'
  // P0 terminal state: a fallback leaf that has spent its FULL
  // enrichment budget (MAX_ENRICHMENT_ATTEMPTS_PER_LEAF real passes)
  // can never become a candidate again — see eligibleForEnrichment
  // above and the legacy-path stamp below. Once EVERY fallback leaf is
  // in that state (or there are none), there is no work left that could
  // ever change this brain's academic universe automatically — the
  // canonical distinction between 'enriching' (real work pending) and
  // 'degraded' (permanently done, some leaves just never went rich).
  const remainingEnrichmentWork = textSubchunks.some(chunk => {
    const checkpoint = checkpointByChunkId.get(chunk.id)
    return checkpoint?.usedDeterministicFallback
      && (checkpoint.enrichmentAttempts || 0) < MAX_ENRICHMENT_ATTEMPTS_PER_LEAF
  })
  const brainEnrichment: MaterialBrain['meta']['brainEnrichment'] =
    options.skipRichExtraction ? 'not_started'
      : fallbackCount === 0 ? 'ready'
        : remainingEnrichmentWork ? 'enriching'
          : 'degraded'
  const enrichmentRevision = enrichmentUpgradedAtLeastOneLeaf
    ? (options.previousBrain?.meta.enrichmentRevision || 0) + 1
    : (options.previousBrain?.meta.enrichmentRevision || 0)

  const subchunkCheckpoints = {
    ...(options.previousBrain?.meta.subchunkCheckpoints || {}),
    ...Object.fromEntries(textSubchunks.map(chunk => [chunk.id, checkpointByChunkId.get(chunk.id)!])),
  }
  const textOuterCheckpoints = Object.fromEntries(textChunks.map(chunk => {
    const children = textSubchunksByOuter.get(chunk.id) || []
    const childCheckpoints = children.map(child => checkpointByChunkId.get(child.id)!)
    const extraction = combineExtractions(chunk, children.map(child => resultByChunkId.get(child.id)!))
    const status: MaterialBrainChunkCheckpoint['status'] = childCheckpoints.every(checkpoint => isCompletedCheckpointStatus(checkpoint.status))
      ? (childCheckpoints.every(checkpoint => checkpoint.status === 'complete_no_content') ? 'complete_no_content' : 'complete')
        : childCheckpoints.some(checkpoint => checkpoint.status === 'retryable_failed')
        ? 'retryable_failed' : 'terminal_failed'
    const reason = childCheckpoints.find(checkpoint => !isCompletedCheckpointStatus(checkpoint.status))?.failureReason
    const usedDeterministicFallback = childCheckpoints.some(checkpoint => checkpoint.usedDeterministicFallback)
    const checkpoint: MaterialBrainChunkCheckpoint = {
      status, sourceKind: 'text', ...(reason ? { failureReason: reason } : {}),
      ...(usedDeterministicFallback ? { usedDeterministicFallback: true } : {}), extraction,
    }
    return [chunk.id, checkpoint]
  }))
  const visualCheckpoints = Object.fromEntries(multimodal.visualChunks.map(chunk => [
    chunk.id, checkpointByChunkId.get(chunk.id)!,
  ]))
  const chunkCheckpoints = { ...textOuterCheckpoints, ...visualCheckpoints }
  const completedRequiredSections = textChunks.filter(chunk => isCompletedCheckpointStatus(chunkCheckpoints[chunk.id]?.status)).length
  const failedVisualChunkIds = new Set(
    multimodal.visualChunks.filter(chunk => failedChunkIds.has(chunk.id)).map(chunk => chunk.id),
  )
  const completedOptionalSections = multimodal.visualCoverage.noContent.length
    + multimodal.visualChunks.filter(chunk => !failedVisualChunkIds.has(chunk.id)).length
  const optionalDetails = [
    ...multimodal.visualCoverage.failed.map(ref => `visual_failed:${ref.materialId}:${ref.page}`),
    ...[...failedVisualChunkIds].map(chunkId => `visual_extraction_failed:${chunkId}`),
    ...(multimodal.visualCoverage.preparationErrors || []).map(error =>
      `visual_preparation_failed:${error.materialId}:${error.stage}:${error.code || 'unknown'}`),
  ]

  // P0 mission (Phase 3, "make academic loss impossible to hide").
  const contentLoss = computeContentLoss({ ...subchunkCheckpoints, ...visualCheckpoints })

  return {
    scope,
    meta: {
      version: MATERIAL_BRAIN_SCHEMA_VERSION,
      builderVersion: MATERIAL_BRAIN_BUILDER_VERSION,
      generatedAt: startedAt,
      chunking: { strategy: 'page-aware-per-material', chunkSizeChars: opts.chunkSizeChars ?? DEFAULT_CHUNK_SIZE_CHARS, chunkCount: allChunks.length },
      llmCallsUsed,
      retries,
      status,
      sourceReadiness,
      brainEnrichment,
      enrichmentRevision,
      optionalGaps: {
        visual: optionalDetails.length > 0,
        ...(optionalDetails.length ? { details: optionalDetails } : {}),
      },
      requiredProgress: {
        completedRequiredSections,
        totalRequiredSections: textChunks.length,
        completedOptionalSections,
        totalOptionalSections: multimodal.visualCoverage.requested.length,
      },
      chunkCheckpoints,
      subchunkCheckpoints,
      extractionQuality,
      contentLoss,
    },
    units,
    relations,
    sourceCoverage,
    visualCoverage: multimodal.visualCoverage,
    knowledgeExtraction,
    mergeLog,
  }
}
