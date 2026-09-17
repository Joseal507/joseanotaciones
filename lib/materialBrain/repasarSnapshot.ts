import { randomUUID } from 'crypto'
import { getMaterialResult, saveMaterialResult } from '../materials/repository'
import type { MaterialBrain } from './types'
import {
  buildRepasarGroundedContext,
  type RepasarGroundedContext,
  type RepasarRelationContext,
  type RepasarReviewTarget,
} from './reviewContext'

// ============================================================
// Repasar attempt freeze (target-freeze contract).
//
// PROBLEM this solves: Free Mode enters at `sourceReady`, so a user can
// start a Repasar attempt while the Material Brain is still at
// enrichment revision R1 (deterministic exact-source base units). While
// the attempt is live, background enrichment upgrades leaves and writes
// R2 — and because a KnowledgeUnit's id is derived from
// (kind, semanticKey, qualifiers) (lib/materialBrain/identity.ts), a
// base unit whose canonicalSubject is `fallback:<chunkId>:<index>`
// becomes one or more rich units with COMPLETELY DIFFERENT ids. Repasar
// review-target ids ARE unit ids (reviewContext.buildRepasarReviewTargets),
// so the academic universe of an in-flight attempt would silently change
// mid-attempt: the coverage denominator moves, and the repairTargetIds
// the client legitimately received from `evaluate` no longer exist, so
// `teach-check` would drop them as unknown.
//
// CONTRACT:
// - An attempt freezes the MINIMAL academic universe it needs the moment
//   evaluation starts: {fingerprint, enrichmentRevision, targets,
//   relations}. NEVER the whole MaterialBrain (no checkpoints, no raw
//   extraction payloads, no chunk text).
// - evaluate → repair → teach-check (checkTeachMissing) → follow-up all
//   reference that same frozen snapshot, restored SERVER-SIDE by id.
// - Background enrichment keeps running and keeps writing new revisions.
//   A NEW attempt freezes the newest revision. An EXISTING attempt never
//   mutates.
// - The client may only send a snapshot IDENTITY (an opaque id). It can
//   never send target content, evidence, or a revision number — those
//   are always read back from the authoritative store.
// - enrichmentRevision is recorded as `null` when the brain genuinely
//   has no revision field (legacy brain). It is never fabricated.
// ============================================================

export const REPASAR_SNAPSHOT_SCHEMA_VERSION = '2.0.0'
export const REPASAR_SNAPSHOT_ENFOQUE = 'mixto' as const
export const REPASAR_SNAPSHOT_RESULT_TYPE = 'repasar_snapshot' as const

/** Canonical reader keys — the ONLY values the reader field may hold. */
export type RepasarReader = 'nino' | 'universitario' | 'profesor' | 'libre'

export interface RepasarFrozenSnapshot {
  schemaVersion: string
  snapshotId: string
  /** Canonical source identity this snapshot belongs to. Cross-fingerprint reuse is impossible. */
  fingerprint: string
  builderVersion: string
  authorityType?: 'studyal_material_enjoyer' | 'material_brain'
  /** Enrichment revision this attempt froze. `null` for a legacy brain with no revision identity — never fabricated. */
  enrichmentRevision: number | null
  createdAt: string
  /** The frozen academic universe — the only denominator this attempt may ever use. */
  targets: RepasarReviewTarget[]
  relations: RepasarRelationContext[]
  topics?: { id: string; title: string; order: number }[]
  /**
   * The reader (Niño/Universitario/Profesor/Evaluador neutral) selected
   * at the moment THIS attempt was created — frozen exactly like the
   * academic universe above. Absent only for a snapshot frozen before
   * this field existed (`undefined`, never fabricated); the route falls
   * back to 'libre' in that case. Every subsequent step of THIS SAME
   * attempt (teach-check, follow-up) must read the reader from here,
   * never re-trust a fresh client-sent value — that was the exact
   * source of the live "selected Niño, graded as Profesor" bug: the
   * reader was re-read from the request body on every call instead of
   * being frozen once at attempt creation.
   */
  reader?: RepasarReader
}

export interface RepasarSnapshotStore {
  get(snapshotId: string): Promise<RepasarFrozenSnapshot | null>
  set(snapshot: RepasarFrozenSnapshot): Promise<void>
}

function snapshotMaterialId(snapshotId: string): string {
  return `repasar_snapshot:${snapshotId}`
}

export interface WorkerRepasarSnapshotStoreDeps {
  getMaterialResult?: typeof getMaterialResult
  saveMaterialResult?: typeof saveMaterialResult
}

export class WorkerRepasarSnapshotStore implements RepasarSnapshotStore {
  private getResult: typeof getMaterialResult
  private saveResult: typeof saveMaterialResult

  constructor(deps: WorkerRepasarSnapshotStoreDeps = {}) {
    this.getResult = deps.getMaterialResult || getMaterialResult
    this.saveResult = deps.saveMaterialResult || saveMaterialResult
  }

  async get(snapshotId: string): Promise<RepasarFrozenSnapshot | null> {
    const result = await this.getResult(
      snapshotMaterialId(snapshotId), REPASAR_SNAPSHOT_ENFOQUE, REPASAR_SNAPSHOT_RESULT_TYPE,
    )
    const payload = result?.payload
    if (!payload || typeof payload !== 'object') return null
    if (!Array.isArray((payload as RepasarFrozenSnapshot).targets)) return null
    if (String((payload as RepasarFrozenSnapshot).snapshotId || '') !== snapshotId) return null
    return payload as RepasarFrozenSnapshot
  }

  async set(snapshot: RepasarFrozenSnapshot): Promise<void> {
    await this.saveResult({
      material_id: snapshotMaterialId(snapshot.snapshotId),
      enfoque: REPASAR_SNAPSHOT_ENFOQUE,
      result_type: REPASAR_SNAPSHOT_RESULT_TYPE,
      payload: snapshot,
      content_hash: `${snapshot.fingerprint}::${snapshot.enrichmentRevision ?? 'legacy'}::${snapshot.snapshotId}`,
    })
  }
}

/**
 * Freezes the minimal academic universe of ONE Repasar attempt from the
 * brain revision that is authoritative right now. Pure — no I/O.
 */
export function freezeRepasarSnapshot(
  brain: MaterialBrain,
  options: { snapshotId?: string; now?: () => number } = {},
): RepasarFrozenSnapshot {
  const grounded = buildRepasarGroundedContext(brain)
  const revision = brain.meta.enrichmentRevision
  return {
    schemaVersion: REPASAR_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: options.snapshotId || `rsnap_${randomUUID()}`,
    fingerprint: grounded.fingerprint,
    builderVersion: grounded.builderVersion,
    authorityType: 'material_brain',
    enrichmentRevision: typeof revision === 'number' ? revision : null,
    createdAt: new Date(options.now ? options.now() : Date.now()).toISOString(),
    targets: grounded.targets,
    relations: grounded.relations,
  }
}

/** Freezes an already-grounded Enjoyer authority without fabricating a Brain. */
export function freezeRepasarEnjoyerSnapshot(
  grounded: RepasarGroundedContext,
  options: { snapshotId?: string; now?: () => number; reader?: RepasarReader } = {},
): RepasarFrozenSnapshot {
  if (grounded.authorityType !== 'studyal_material_enjoyer') {
    throw new Error('INVALID_REPASAR_AUTHORITY')
  }
  return {
    schemaVersion: REPASAR_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: options.snapshotId || `rsnap_${randomUUID()}`,
    fingerprint: grounded.fingerprint,
    builderVersion: grounded.builderVersion,
    authorityType: 'studyal_material_enjoyer',
    enrichmentRevision: null,
    createdAt: new Date(options.now ? options.now() : Date.now()).toISOString(),
    targets: grounded.targets,
    relations: grounded.relations,
    topics: grounded.topics,
    reader: options.reader || 'libre',
  }
}

/** The frozen snapshot rendered back into the shape the prompt renderer consumes. */
export function snapshotGroundedContext(snapshot: RepasarFrozenSnapshot): RepasarGroundedContext {
  return {
    fingerprint: snapshot.fingerprint,
    builderVersion: snapshot.builderVersion,
    authorityType: snapshot.authorityType,
    targets: snapshot.targets,
    relations: snapshot.relations,
    topics: snapshot.topics,
  }
}

export interface RepasarSnapshotResolution {
  ok: boolean
  /** Present only when ok. */
  snapshot: RepasarFrozenSnapshot | null
  origin: 'restored' | 'frozen_now' | 'legacy_freeze' | null
  /** Present only when !ok. */
  code: 'SNAPSHOT_NOT_FOUND' | 'SNAPSHOT_SCOPE_MISMATCH' | 'LEGACY_SNAPSHOT_INCOMPATIBLE' | null
  status: number
}

export async function resolveRepasarEnjoyerSnapshot(params: {
  groundedContext: RepasarGroundedContext
  store: RepasarSnapshotStore
  intent: 'new_attempt' | 'continue_attempt'
  requestedSnapshotId?: string | null
  /** Only consulted for `intent: 'new_attempt'` — a NEW attempt legitimately
   * takes the reader the user currently has selected, freezing it from this
   * point on. A `continue_attempt` call ignores any reader the caller
   * passes here entirely; the restored snapshot's own `reader` is
   * authoritative (see the route, which never forwards a reader for that
   * intent). */
  requestedReader?: RepasarReader
}): Promise<RepasarSnapshotResolution> {
  const fingerprint = params.groundedContext.fingerprint
  if (params.intent === 'new_attempt') {
    const snapshot = freezeRepasarEnjoyerSnapshot(params.groundedContext, { reader: params.requestedReader })
    await params.store.set(snapshot)
    return { ok: true, snapshot, origin: 'frozen_now', code: null, status: 200 }
  }

  const requested = String(params.requestedSnapshotId || '').trim()
  if (!requested) {
    return { ok: false, snapshot: null, origin: null, code: 'LEGACY_SNAPSHOT_INCOMPATIBLE', status: 409 }
  }
  const restored = await params.store.get(requested)
  if (!restored) return { ok: false, snapshot: null, origin: null, code: 'SNAPSHOT_NOT_FOUND', status: 409 }
  if (restored.fingerprint !== fingerprint) {
    return { ok: false, snapshot: null, origin: null, code: 'SNAPSHOT_SCOPE_MISMATCH', status: 409 }
  }
  if (restored.schemaVersion !== REPASAR_SNAPSHOT_SCHEMA_VERSION
    || restored.authorityType !== 'studyal_material_enjoyer') {
    return { ok: false, snapshot: null, origin: null, code: 'LEGACY_SNAPSHOT_INCOMPATIBLE', status: 409 }
  }
  return { ok: true, snapshot: restored, origin: 'restored', code: null, status: 200 }
}

/**
 * Server authority for an attempt's academic universe.
 *
 * - `intent: 'new_attempt'` — always freezes the CURRENT brain revision
 *   (REP-FREEZE-5). Any client-sent id is ignored entirely.
 * - `intent: 'continue_attempt'` — restores the frozen snapshot by id and
 *   verifies it belongs to THIS session's fingerprint. A snapshot from a
 *   different fingerprint is rejected (never silently reused). A missing
 *   id (legacy persisted session, pre-freeze) establishes a CURRENT
 *   freeze rather than fabricating historical revision identity.
 */
export async function resolveRepasarSnapshot(params: {
  brain: MaterialBrain
  store: RepasarSnapshotStore
  intent: 'new_attempt' | 'continue_attempt'
  requestedSnapshotId?: string | null
}): Promise<RepasarSnapshotResolution> {
  const fingerprint = params.brain.scope.fingerprint

  if (params.intent === 'new_attempt') {
    const snapshot = freezeRepasarSnapshot(params.brain)
    await params.store.set(snapshot)
    return { ok: true, snapshot, origin: 'frozen_now', code: null, status: 200 }
  }

  const requested = String(params.requestedSnapshotId || '').trim()
  if (!requested) {
    // LEGACY RESUME: a session persisted before the freeze contract has
    // no snapshot identity. We do not invent one for the past — we
    // establish a current freeze so the rest of this operation is at
    // least internally consistent.
    const snapshot = freezeRepasarSnapshot(params.brain)
    await params.store.set(snapshot)
    return { ok: true, snapshot, origin: 'legacy_freeze', code: null, status: 200 }
  }

  const restored = await params.store.get(requested)
  if (!restored) return { ok: false, snapshot: null, origin: null, code: 'SNAPSHOT_NOT_FOUND', status: 409 }
  if (restored.fingerprint !== fingerprint) {
    return { ok: false, snapshot: null, origin: null, code: 'SNAPSHOT_SCOPE_MISMATCH', status: 409 }
  }
  return { ok: true, snapshot: restored, origin: 'restored', code: null, status: 200 }
}
