import { randomUUID } from 'node:crypto'
import type { BrainScope, MaterialBrain, MaterialBrainLookupStatus, ResolvedSourceMaterial } from './types'
import { MATERIAL_BRAIN_SCHEMA_VERSION } from './types'
import { MATERIAL_BRAIN_BUILDER_VERSION, buildMaterialBrain, type BuildOptions, type BuildCheckpointFlush } from './build'
import { lookupMaterialBrain } from './cache'
import type { MaterialBrainStore } from './cache'
import { getMaterialResult, saveMaterialResult } from '../materials/repository'
import type { MaterialResult } from '../materials/types'
import { classifyFailure } from './retryClassification'
import { mergeCheckpointRecords } from './checkpointMerge'
import {
  computeAndAttachMaterialQuizCoverage, MATERIAL_QUIZ_COVERAGE_CONFIG, readCachedQuizCoverage,
} from './quiz/coverageCache'

// ============================================================
// Backend de producción para MaterialBrain basado en la tabla
// material_results que ya expone lib/materials/repository.ts.
//
// Clave sintética (decisión de arquitectura):
//   material_id = "brain:" + scope.fingerprint
//   enfoque     = 'mixto'
//   result_type = 'material_brain'
//   content_hash = fingerprint + '::' + builderVersion
//
// No toca build.ts/index.ts/cache.ts — solo implementa
// MaterialBrainStore y expone un orquestador de producción con
// single-flight por isolate + placeholder persistido con TTL.
// El Worker actual solo expone upsert sin compare-and-swap; por eso la
// exclusión atómica entre isolates requiere soporte condicional del backend.
//
// Límite de tamaño: el Worker/D1 subyacente impone un tope práctico al
// JSON del payload. Se validó manualmente con un brain sintético de ~33 KB
// via saveMaterialResult/getMaterialResult contra el Worker real. Si un brain real supera
// el límite de fila del Worker, saveMaterialResult/getMaterialResult
// fallarán con error del Worker y la ruta responderá 500. Ese
// comportamiento es correcto: no debe truncarse ni devolverse un brain
// incompleto como si fuera válido.
// ============================================================

export const BRAIN_ENFOQUE = 'mixto' as const
export const BRAIN_RESULT_TYPE = 'material_brain' as const

/** TTL después del cual un placeholder 'building' se considera abandonado. */
export const BUILDING_STALE_MS = 3 * 60 * 1000

function brainMaterialId(fingerprint: string): string {
  return `brain:${fingerprint}`
}

export interface WorkerStoreDeps {
  getMaterialResult?: typeof getMaterialResult
  saveMaterialResult?: typeof saveMaterialResult
}

export class WorkerMaterialResultStore implements MaterialBrainStore {
  private getResult: (materialId: string, enfoque: typeof BRAIN_ENFOQUE, resultType: typeof BRAIN_RESULT_TYPE) => Promise<MaterialResult | null>
  private saveResult: typeof saveMaterialResult

  constructor(deps: WorkerStoreDeps = {}) {
    this.getResult = deps.getMaterialResult || getMaterialResult
    this.saveResult = deps.saveMaterialResult || saveMaterialResult
  }

  async get(fingerprint: string): Promise<MaterialBrain | null> {
    const result = await this.getResult(brainMaterialId(fingerprint), BRAIN_ENFOQUE, BRAIN_RESULT_TYPE)
    if (!result) return null

    const payload = result.payload
    if (!payload || typeof payload !== 'object' || !payload.scope || !payload.meta) {
      throw new Error(`MATERIAL_BRAIN_CORRUPTED_PAYLOAD:${fingerprint}`)
    }

    return payload as MaterialBrain
  }

  async set(fingerprint: string, brain: MaterialBrain): Promise<void> {
    const contentHash = `${brain.scope.fingerprint}::${brain.meta.builderVersion}`
    await this.saveResult({
      // ROOT-CAUSE FIX (real production bug: READY brain "regressing" to
      // BUILDING on the very next request): the Worker's upsert
      // conflicts on `id` alone. Without a stable id here, every save
      // (placeholder -> checkpoint flush -> final ready) minted a fresh
      // random id and INSERTed a brand-new row instead of updating one —
      // the SAME fingerprint accumulated multiple rows. The read query
      // (`ORDER BY created_at DESC LIMIT 1`) then had no reliable way to
      // pick the newest one once two writes landed in the same
      // second (`datetime('now')` is second-precision), so a request
      // could read back an OLDER 'building' row even though a newer
      // 'ready' row already existed. `material_id` is already unique
      // per Material Brain (`brain:{fingerprint}`) for this store, so
      // reusing it as the row id makes every save for the same
      // fingerprint a genuine UPDATE of the SAME row — never a new one.
      id: brainMaterialId(fingerprint),
      material_id: brainMaterialId(fingerprint),
      enfoque: BRAIN_ENFOQUE,
      result_type: BRAIN_RESULT_TYPE,
      payload: brain,
      content_hash: contentHash,
    })
  }
}

export function createBuildingPlaceholder(scope: BrainScope, ownerId?: string): MaterialBrain {
  const generatedAt = new Date().toISOString()
  const leaseOwnerId = ownerId || randomUUID()
  return {
    scope,
    meta: {
      version: MATERIAL_BRAIN_SCHEMA_VERSION,
      builderVersion: MATERIAL_BRAIN_BUILDER_VERSION,
      generatedAt,
      chunking: { strategy: 'page-aware-per-material', chunkSizeChars: 0, chunkCount: 0 },
      llmCallsUsed: 0,
      retries: 0,
      status: 'building',
      buildLease: {
        ownerId: leaseOwnerId, startedAt: generatedAt,
        expiresAt: new Date(Date.now() + BUILDING_STALE_MS).toISOString(),
      },
    },
    units: [],
    relations: [],
    sourceCoverage: {
      requested: [],
      processed: [],
      missing: [],
      suspiciouslyEmpty: [],
      status: 'failed',
    },
    knowledgeExtraction: {
      chunksAttempted: 0,
      chunksFailed: 0,
      failedChunkIds: [],
      unitsExtractedRaw: 0,
      unitsWithoutValidProvenance: 0,
      invalidStructural: 0,
      droppedAmbiguousRelations: 0,
      warnings: [],
    },
    mergeLog: [],
  }
}

export interface ProductionBuildOptions extends BuildOptions {
  /** Inyección para tests; en producción se usa buildMaterialBrain real. */
  buildFn?: (scope: BrainScope, materials: ResolvedSourceMaterial[], options?: BuildOptions) => Promise<MaterialBrain>
  storageRetries?: number
  storageRetryDelayMs?: number
  /**
   * Two-level readiness (P0 fast-entry architecture) — explicit opt-in
   * so every EXISTING caller/test keeps its current (legacy, single
   * full-pipeline build) behavior unchanged. When true:
   * - a genuinely missing brain gets the FAST deterministic base
   *   (skipRichExtraction) instead of the full rich pipeline — hub can
   *   open immediately;
   * - a brain already sourceReadiness:'ready' but brainEnrichment
   *   still catching up gets ONE bounded background enrichment batch
   *   per call, never re-entering a 'building' state.
   */
  twoLevelReadiness?: boolean
  /** Correlates every store write/log this call produces to the owning HTTP request (mission: prove WHO writes WHAT). */
  requestId?: string
  /**
   * Explicit, user-confirmed invalidation (Material Brain Debug Viewer's
   * "Regenerar" control — the ONLY caller of this flag). When true and no
   * OTHER build currently holds a valid lease for this fingerprint, the
   * persisted record is invalidated (fresh 'building' placeholder, no
   * checkpoint/unit carry-over from the previous brain) and rebuilt through
   * the exact same canonical path below — never a second build pipeline.
   * A valid concurrent lease still wins exactly like any other caller: this
   * never starts a second build for the same fingerprint.
   */
  forceRebuild?: boolean
}

const inFlightBuilds = new Map<string, Promise<{ status: MaterialBrainLookupStatus; brain?: MaterialBrain }>>()

// ============================================================
// CANONICAL WRITE BOUNDARY — every persisted write to the Material
// Brain store MUST go through this function. This is the mission-
// mandated instrumentation + the mission-mandated GLOBAL monotonic
// invariant, in one place, protecting ALL writers (not just
// runEnrichmentPass, which a prior narrower fix targeted and which
// did NOT close the live bug: a brand-new fingerprint regressed
// READY -> BUILDING with zero enrichment-pass logs, proving at least
// one OTHER writer — the fresh-build placeholder path, its
// checkpoint-flush callback, or its crash-fallback write — can also
// produce this regression, most plausibly via a TOCTOU race between
// two overlapping requests' own read-then-write sequences (the
// Worker backend has NO compare-and-swap — see this file's own top
// comment). This wrapper narrows that race at every call site: it
// re-reads the CURRENT persisted record immediately before writing
// and refuses to let an already-'ready' brain (same fingerprint +
// builderVersion, no explicit invalidation) be replaced by anything
// worse — while still allowing normal in-place evolution (units,
// relations, checkpoints, brainEnrichment, enrichmentRevision) to
// proceed freely. Every call is logged with a `writer` tag identifying
// the exact call site, so the NEXT live run pinpoints the culprit by
// name instead of by further inference.
// ============================================================

export type BrainWriter =
  | 'fresh_build_placeholder'
  | 'fresh_build_complete'
  | 'quiz_backfill'
  | 'enrichment_checkpoint_flush'
  | 'enrichment_final_write'
  | 'crash_recovery_write'
  | 'debug_force_rebuild_invalidate'

function countUnits(b: MaterialBrain | null | undefined): number { return b?.units?.length ?? 0 }
function countRelations(b: MaterialBrain | null | undefined): number { return b?.relations?.length ?? 0 }
function countCheckpoints(b: MaterialBrain | null | undefined): number {
  return Object.keys(b?.meta.chunkCheckpoints || {}).length + Object.keys(b?.meta.subchunkCheckpoints || {}).length
}

/** Exported for direct LIVE-RACE testing of the write-boundary invariant — never used outside productionStore.ts/tests in production code. */
export async function writeBrainRecord(
  store: MaterialBrainStore,
  scope: BrainScope,
  next: MaterialBrain,
  info: { writer: BrainWriter; requestId?: string; reason: string; storageRetries: number; storageRetryDelayMs: number },
): Promise<MaterialBrain> {
  const fingerprint = scope.fingerprint
  // Immediate pre-write re-read — narrows (does not eliminate, the
  // store has no CAS) the TOCTOU window between "decide what to write"
  // and "write it" for EVERY writer, not just the one that happened to
  // compute `next`.
  const justBeforeWrite = await store.get(fingerprint).catch(() => null)
  const sameLineage = !!justBeforeWrite
    && justBeforeWrite.scope.fingerprint === fingerprint
    && justBeforeWrite.meta.builderVersion === next.meta.builderVersion
  const wouldRegressReady = sameLineage && justBeforeWrite!.meta.status === 'ready' && next.meta.status !== 'ready'

  let toPersist = next
  if (wouldRegressReady) {
    // Global monotonic invariant (mission §13): a persisted 'ready'
    // brain can never be replaced by building/partial/missing for the
    // same fingerprint+builderVersion absent explicit invalidation.
    // Keep the proven-good snapshot's lifecycle fields, but STILL let
    // enrichment-shaped progress in `next` (units/relations/checkpoints/
    // brainEnrichment/enrichmentRevision) through — this is a status-
    // level floor, not a freeze of the whole record (mission §14).
    toPersist = {
      ...next,
      units: next.units.length ? next.units : justBeforeWrite!.units,
      relations: next.relations.length ? next.relations : justBeforeWrite!.relations,
      sourceCoverage: justBeforeWrite!.sourceCoverage,
      meta: {
        ...next.meta,
        status: justBeforeWrite!.meta.status,
        sourceReadiness: justBeforeWrite!.meta.sourceReadiness,
        buildLease: undefined,
        chunkCheckpoints: mergeCheckpointRecords(justBeforeWrite!.meta.chunkCheckpoints, next.meta.chunkCheckpoints),
        subchunkCheckpoints: mergeCheckpointRecords(justBeforeWrite!.meta.subchunkCheckpoints, next.meta.subchunkCheckpoints),
        enrichmentRevision: Math.max(justBeforeWrite!.meta.enrichmentRevision || 0, next.meta.enrichmentRevision || 0),
      },
    }
  }

  console.log('[MaterialBrain] material_brain_store_write', JSON.stringify({
    fingerprint,
    writer: info.writer,
    requestId: info.requestId ?? null,
    previousStatus: justBeforeWrite?.meta.status ?? null,
    nextStatus: toPersist.meta.status,
    previousHasLease: !!justBeforeWrite?.meta.buildLease,
    nextHasLease: !!toPersist.meta.buildLease,
    leaseOwner: toPersist.meta.buildLease?.ownerId ?? null,
    previousBrainEnrichment: justBeforeWrite?.meta.brainEnrichment ?? null,
    nextBrainEnrichment: toPersist.meta.brainEnrichment ?? null,
    unitsCount: countUnits(toPersist),
    relationsCount: countRelations(toPersist),
    checkpointCount: countCheckpoints(toPersist),
    reason: info.reason,
    blockedRegression: wouldRegressReady,
  }))

  await withStorageRetry(() => store.set(fingerprint, toPersist), info.storageRetries, info.storageRetryDelayMs)
  return toPersist
}

async function withStorageRetry<T>(
  operation: () => Promise<T>,
  retries: number,
  delayMs: number,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!classifyFailure(error).shouldRetry || attempt === retries) throw error
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }
  throw lastError
}

/**
 * Orquestador de producción.
 *
 * RESTORE FIRST → GENERATE ONLY WHEN ABSENCE IS PROVEN:
 * - Si lookup devuelve 'ready' (y builderVersion coincide), se devuelve sin reconstruir.
 * - Si devuelve 'building' reciente (< BUILDING_STALE_MS), se devuelve 'building' para poll.
 * - En cualquier otro caso (missing/partial/failed/building vencido) se escribe un
 *   placeholder 'building' y se dispara la construcción.
 *
 * Errores de red/Worker durante el lookup se propagan tal cual — NUNCA se convierten
 * en 'missing' silencioso.
 */
/**
 * Runs ONE bounded background enrichment batch against an already
 * sourceReadiness:'ready' brain. Never writes a 'building' placeholder
 * — the persisted status stays 'ready' throughout, so the hub gate
 * never flickers back to "preparing" while enrichment continues.
 * Re-reads + merges by checkpoint precedence before writing, same
 * stale-write protection as a full build.
 */
async function runEnrichmentPass(
  scope: BrainScope,
  materials: ResolvedSourceMaterial[],
  store: MaterialBrainStore,
  previousBrain: MaterialBrain,
  options: { storageRetries: number; storageRetryDelayMs: number; enrichmentBatchSize?: number; extractFn?: BuildOptions['extractFn']; requestId?: string } & BuildOptions,
): Promise<MaterialBrain> {
  // CRITICAL: must use the EXACT SAME chunking parameters that built
  // `previousBrain`, or leaf ids won't match and this pass silently
  // rebuilds different (typically far larger) chunks instead of
  // upgrading the fast base's actual leaves one by one.
  const enriched = await buildMaterialBrain(scope, materials, {
    ...options,
    chunkSizeChars: previousBrain.meta.chunking.chunkSizeChars || options.chunkSizeChars,
    previousBrain, enrichmentPass: true, enrichmentBatchSize: options.enrichmentBatchSize, extractFn: options.extractFn,
  })
  const current = await store.get(scope.fingerprint).catch(() => null)
  const base = current && current.meta.builderVersion === MATERIAL_BRAIN_BUILDER_VERSION ? current : previousBrain
  const merged: MaterialBrain = {
    ...enriched,
    meta: {
      ...enriched.meta,
      // Never regress the persisted brain's own progress if a
      // concurrent enrichment pass (or a fresh rebuild) advanced
      // further while this pass ran. The READY-status floor itself is
      // now enforced globally by writeBrainRecord below, not here.
      chunkCheckpoints: mergeCheckpointRecords(base.meta.chunkCheckpoints, enriched.meta.chunkCheckpoints),
      subchunkCheckpoints: mergeCheckpointRecords(base.meta.subchunkCheckpoints, enriched.meta.subchunkCheckpoints),
      enrichmentRevision: Math.max(base.meta.enrichmentRevision || 0, enriched.meta.enrichmentRevision || 0),
    },
  }
  return writeBrainRecord(store, scope, merged, {
    writer: 'enrichment_final_write', requestId: options.requestId, reason: 'enrichment_pass_complete',
    storageRetries: options.storageRetries, storageRetryDelayMs: options.storageRetryDelayMs,
  })
}

export async function getOrBuildProductionBrain(
  scope: BrainScope,
  materials: ResolvedSourceMaterial[],
  store: MaterialBrainStore,
  options: ProductionBuildOptions = {},
): Promise<{ status: MaterialBrainLookupStatus; brain?: MaterialBrain }> {
  const existingBuild = inFlightBuilds.get(scope.fingerprint)
  if (existingBuild) return existingBuild

  const operation: Promise<{ status: MaterialBrainLookupStatus; brain?: MaterialBrain }> = (async () => {
  const storageRetries = options.storageRetries ?? 1
  const storageRetryDelayMs = options.storageRetryDelayMs ?? 50
  const lookup = await withStorageRetry(
    () => lookupMaterialBrain(store, scope.fingerprint),
    storageRetries,
    storageRetryDelayMs,
  )

  if (lookup.status === 'ready' && lookup.brain && !options.forceRebuild) {
    // Legacy-ready Brains may predate the material-level Quiz recommendation.
    // Backfill once here, before Free Mode is entered, then persist it so Quiz
    // setup never owns this deterministic cost.
    //
    // CRITICAL (two-level readiness): only compute/cache this once
    // enrichment is stable (brainEnrichment undefined=legacy, or
    // 'ready'). Caching it against the FAST BASE universe (always
    // kind:'fact' only, zero relations) would silently freeze a wrong
    // ✦N recommendation that never gets recomputed once richer units
    // arrive — exactly capabilities.quizReady exists to prevent.
    const enrichmentStableForQuiz = lookup.brain.meta.brainEnrichment === undefined || lookup.brain.meta.brainEnrichment === 'ready'
    if (enrichmentStableForQuiz && !readCachedQuizCoverage(lookup.brain, MATERIAL_QUIZ_COVERAGE_CONFIG)) {
      computeAndAttachMaterialQuizCoverage(lookup.brain)
      await writeBrainRecord(store, scope, lookup.brain, {
        writer: 'quiz_backfill', requestId: options.requestId, reason: 'quiz_coverage_backfill',
        storageRetries, storageRetryDelayMs,
      })
    }

    // Two-level readiness: a brain can be sourceReadiness:'ready' (hub
    // may open) while brainEnrichment is still catching up. If so, run
    // ONE bounded enrichment batch NOW and return the (still 'ready')
    // result — never a 'building' placeholder, never blocking the hub.
    // A legacy brain built before this field existed (`undefined`) is
    // treated as already fully enriched — nothing to do.
    const enrichment = lookup.brain.meta.brainEnrichment
    if (options.twoLevelReadiness && enrichment && enrichment !== 'ready' && !options.buildFn) {
      const {
        buildFn: _enrichBuildFn, storageRetries: _enrichStorageRetries, storageRetryDelayMs: _enrichStorageRetryDelayMs,
        twoLevelReadiness: _enrichTwoLevel, previousBrain: _enrichPreviousBrain,
        ...enrichBuildOptions
      } = options
      const enriched = await runEnrichmentPass(scope, materials, store, lookup.brain, {
        ...enrichBuildOptions, storageRetries, storageRetryDelayMs, requestId: options.requestId,
      })
      return { status: 'ready', brain: enriched }
    }

    return { status: 'ready', brain: lookup.brain }
  }

  if (lookup.status === 'building' && lookup.brain) {
    // Persisted build lease (Phase 18) — the strongest available
    // cross-isolate single-flight guard given the Worker has no CAS.
    // A valid (non-expired) lease means someone else owns this build;
    // observe/poll instead of starting a competing one. An expired
    // lease can be taken over.
    const lease = lookup.brain.meta.buildLease
    const expiresAt = lease?.expiresAt ? new Date(lease.expiresAt).getTime() : NaN
    if (!Number.isNaN(expiresAt)) {
      if (Date.now() < expiresAt) return { status: 'building' }
    } else {
      // Legacy placeholder without a lease — fall back to the old
      // generatedAt+TTL heuristic.
      const generatedAt = new Date(lookup.brain.meta.generatedAt).getTime()
      if (!Number.isNaN(generatedAt) && Date.now() - generatedAt < BUILDING_STALE_MS) {
        return { status: 'building' }
      }
    }
  }

  // Explicit invalidation (forceRebuild only): the whole point of this
  // path is to discard the previous brain's units/checkpoints so the
  // rebuild reflects ONLY the current extraction/merge logic — never
  // carry over state from a brain built under old code. This is the
  // one deliberate, user-confirmed bypass of writeBrainRecord's
  // ready-regression guard (that guard exists for accidental races,
  // not for an explicit "throw this away and rebuild" request already
  // gated by dev-only + ownership + fingerprint verification upstream).
  const previousBrain = options.forceRebuild ? undefined : (lookup.brain || undefined)
  const ownerId = randomUUID()
  const placeholder = createBuildingPlaceholder(scope, ownerId)
  if (previousBrain?.meta.chunkCheckpoints) {
    placeholder.meta.chunkCheckpoints = previousBrain.meta.chunkCheckpoints
    placeholder.meta.subchunkCheckpoints = previousBrain.meta.subchunkCheckpoints
    placeholder.meta.requiredProgress = previousBrain.meta.requiredProgress
    placeholder.meta.optionalGaps = previousBrain.meta.optionalGaps
    placeholder.units = previousBrain.units
    placeholder.relations = previousBrain.relations
    placeholder.sourceCoverage = previousBrain.sourceCoverage
    placeholder.visualCoverage = previousBrain.visualCoverage
    placeholder.knowledgeExtraction = previousBrain.knowledgeExtraction
    placeholder.mergeLog = previousBrain.mergeLog
  }
  if (options.forceRebuild) {
    console.log('[MaterialBrain] material_brain_force_invalidate', JSON.stringify({
      fingerprint: scope.fingerprint, requestId: options.requestId ?? null,
      previousStatus: lookup.brain?.meta.status ?? null, previousUnitsCount: countUnits(lookup.brain),
    }))
    await withStorageRetry(() => store.set(scope.fingerprint, placeholder), storageRetries, storageRetryDelayMs)
    console.log('[MaterialBrain] material_brain_store_write', JSON.stringify({
      fingerprint: scope.fingerprint, writer: 'debug_force_rebuild_invalidate' satisfies BrainWriter,
      requestId: options.requestId ?? null, previousStatus: lookup.brain?.meta.status ?? null, nextStatus: 'building',
      previousHasLease: !!lookup.brain?.meta.buildLease, nextHasLease: true, leaseOwner: ownerId,
      previousBrainEnrichment: lookup.brain?.meta.brainEnrichment ?? null, nextBrainEnrichment: null,
      unitsCount: 0, relationsCount: 0, checkpointCount: 0, reason: 'debug_regenerate_explicit_invalidation', blockedRegression: false,
    }))
  } else {
    await writeBrainRecord(store, scope, placeholder, {
      writer: 'fresh_build_placeholder', requestId: options.requestId, reason: `lookup_status=${lookup.status}`,
      storageRetries, storageRetryDelayMs,
    })
  }

  // Early persistence (Phase 11/19): after every extraction round,
  // re-read whatever is currently persisted and merge checkpoints by
  // status precedence (complete always wins) before writing back. This
  // is what makes a crash/timeout mid-build lose NOTHING already
  // validated — the next attempt resumes from these durable leaves
  // instead of re-running provider calls for completed work.
  const onCheckpointFlush = async (flush: BuildCheckpointFlush) => {
    const current = await store.get(scope.fingerprint).catch(() => null)
    const base = current && current.meta.builderVersion === MATERIAL_BRAIN_BUILDER_VERSION ? current : placeholder
    if (base.meta.status === 'ready') return // a concurrent build already finished — never touch a ready brain here (also enforced globally by writeBrainRecord below)
    const merged: MaterialBrain = {
      ...base,
      meta: {
        ...base.meta,
        buildLease: { ownerId, startedAt: placeholder.meta.buildLease!.startedAt, expiresAt: new Date(Date.now() + BUILDING_STALE_MS).toISOString() },
        chunkCheckpoints: mergeCheckpointRecords(base.meta.chunkCheckpoints, flush.chunkCheckpoints),
        subchunkCheckpoints: mergeCheckpointRecords(base.meta.subchunkCheckpoints, flush.subchunkCheckpoints),
        llmCallsUsed: Math.max(base.meta.llmCallsUsed, flush.llmCallsUsed),
        retries: Math.max(base.meta.retries, flush.retries),
      },
    }
    await writeBrainRecord(store, scope, merged, {
      writer: 'enrichment_checkpoint_flush', requestId: options.requestId, reason: 'mid_build_checkpoint_flush',
      storageRetries, storageRetryDelayMs,
    }).catch(() => {}) // best-effort — never abort the build
  }

  const buildFn = options.buildFn || buildMaterialBrain
  const {
    buildFn: _,
    storageRetries: _storageRetries,
    storageRetryDelayMs: _storageRetryDelayMs,
    twoLevelReadiness: _twoLevelReadiness,
    ...buildOptions
  } = options
  // Two-level readiness: get sourceReady FAST (0 provider calls) —
  // rich enrichment is a SEPARATE, later, non-blocking process (see
  // runEnrichmentPass above). Only applies to the real buildMaterialBrain
  // path (a test-injected buildFn keeps its own exact behavior).
  const fastBaseOptions = options.twoLevelReadiness && !options.buildFn ? { skipRichExtraction: true as const } : {}
  console.log('[MaterialBrain] material_brain_request', JSON.stringify({
    fingerprint: scope.fingerprint,
    requestId: options.requestId ?? null,
    // 'full_build': plain buildMaterialBrain call, no twoLevelReadiness
    // fast-base split — this is NOT a legacy code path, it is the only
    // build mode that ever existed (twoLevelReadiness is the later,
    // opt-in optimization). Renamed from 'legacy_full_build' (a pure
    // log-label string, never parsed by any consumer — confirmed by
    // repo-wide search) to remove the misleading "legacy" implication.
    mode: fastBaseOptions.skipRichExtraction ? 'source_ready' : options.twoLevelReadiness ? 'enrichment_advance' : 'full_build',
  }))
  let brain: MaterialBrain
  try {
    brain = await buildFn(scope, materials, { ...buildOptions, ...fastBaseOptions, previousBrain, onCheckpointFlush })
    const enrichmentStableForQuiz = brain.meta.brainEnrichment === undefined || brain.meta.brainEnrichment === 'ready'
    if (brain.meta.status === 'ready' && enrichmentStableForQuiz && !readCachedQuizCoverage(brain, MATERIAL_QUIZ_COVERAGE_CONFIG)) {
      computeAndAttachMaterialQuizCoverage(brain)
    }
    // Stale-write protection on the final write too: if a concurrent
    // attempt already persisted a READY brain for this exact
    // fingerprint/builderVersion while we were building, that already-
    // ready brain wins outright — we never clobber it with our own
    // (possibly redundant) result.
    const beforeFinalWrite = await store.get(scope.fingerprint).catch(() => null)
    if (beforeFinalWrite?.meta.status === 'ready' && beforeFinalWrite.meta.builderVersion === MATERIAL_BRAIN_BUILDER_VERSION) {
      return { status: 'ready', brain: beforeFinalWrite }
    }
    if (beforeFinalWrite && beforeFinalWrite.meta.builderVersion === MATERIAL_BRAIN_BUILDER_VERSION) {
      brain = {
        ...brain,
        meta: {
          ...brain.meta,
          chunkCheckpoints: mergeCheckpointRecords(beforeFinalWrite.meta.chunkCheckpoints, brain.meta.chunkCheckpoints),
          subchunkCheckpoints: mergeCheckpointRecords(beforeFinalWrite.meta.subchunkCheckpoints, brain.meta.subchunkCheckpoints),
        },
      }
    }
    brain = await writeBrainRecord(store, scope, brain, {
      writer: 'fresh_build_complete', requestId: options.requestId, reason: `build_finished_status=${brain.meta.status}`,
      storageRetries, storageRetryDelayMs,
    })
  } catch (error) {
    // MB-RESIL-11 fix: the crash may have happened AFTER one or more
    // incremental flushes already persisted real progress — re-read
    // the CURRENT store state (not the stale pre-build `placeholder`
    // local variable, which knows nothing about those flushes) so the
    // failure marker never discards already-durable checkpoints.
    const latestPersisted = await store.get(scope.fingerprint).catch(() => null)
    const fallbackBase = latestPersisted && latestPersisted.meta.builderVersion === MATERIAL_BRAIN_BUILDER_VERSION
      ? latestPersisted
      : (previousBrain || placeholder)
    const fallback = fallbackBase.meta.status === 'ready' ? fallbackBase : {
      ...fallbackBase,
      meta: { ...fallbackBase.meta, status: fallbackBase.meta.status === 'building' ? 'failed' as const : fallbackBase.meta.status },
    }
    try {
      await writeBrainRecord(store, scope, fallback, {
        writer: 'crash_recovery_write', requestId: options.requestId, reason: `build_threw:${(error as Error)?.message || 'unknown'}`,
        storageRetries, storageRetryDelayMs,
      })
    } catch {
      // Preserve the original build/storage error; the placeholder TTL remains a fallback.
    }
    throw error
  }

  return { status: brain.meta.status, brain }
  })()

  inFlightBuilds.set(scope.fingerprint, operation)
  try {
    return await operation
  } finally {
    if (inFlightBuilds.get(scope.fingerprint) === operation) inFlightBuilds.delete(scope.fingerprint)
  }
}
