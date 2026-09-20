import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import { buildAuthorityBatches } from './batching'
import { startSlot, stateRecordId, turnRecordId, turnScopeOf, turnSlot } from './identity'
import { newRevisionToken, type PageStudyStateRecord, type PageStudyStore, type PageStudyTurnRecord, type StoredState, type StoredTurn } from './store'
import { applyDelta, createInitialState, createPageStudyPlan, currentBlock, studiedPagesOf } from './state'
import type { PageStudyState, StateDelta, StateOp } from './types'

/**
 * Server authority for Page Study. This module never talks to a provider: it only owns durability.
 * The caller supplies `generate` (a fake in the durability harness, the real tutor in a later phase) and it is invoked
 * at most once per turn slot, only after storage proved healthy, and never on any read / restore / replay path.
 */
export const APPLIED_WINDOW = 64
export const PAGE_STUDY_LEASE_MS = 150_000
export const MAX_RESULT_CHARS = 100_000

export class PageStudyError extends Error {
  constructor(public readonly code: string, public readonly state?: PageStudyState) { super(code) }
}
const fail = (code: string, state?: PageStudyState) => new PageStudyError(code, state)

export interface ServiceDeps { store: PageStudyStore; now?: () => number; uuid?: () => string; leaseMs?: number }
const clock = (d: ServiceDeps) => (d.now ?? Date.now)()
const token = (d: ServiceDeps) => (d.uuid ?? newRevisionToken)()

/** Any storage problem — including "route not deployed" — surfaces as one fail-closed error, BEFORE any provider work. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work() } catch (error) {
    if (error instanceof PageStudyError) throw error
    const message = String((error as Error)?.message || error)
    throw new PageStudyError(message.startsWith('PAGE_STUDY_STORAGE_MALFORMED') ? 'PAGE_STUDY_STORAGE_MALFORMED' : 'PAGE_STUDY_STORAGE_UNAVAILABLE')
  }
}

// ── authority-batch resolution ───────────────────────────────────────────────────────────────────────────────
export interface BlockAuthority {
  planId: string; blockKey: string; materialId: string; batchIndex: number; batchId: string
  materialIds: string[]; selection: SourceSelectionSnapshot; fingerprint: string
  blockPages: number[]; studiedPages: number[]; allowedPages: number[]
  nextBatchIndex: number | null                    // set when finishing this block moves the plan into another authority batch
}

/**
 * The canonical ≤5-material snapshot for the CURRENT block. It comes from the batches frozen in the plan; nothing here
 * feeds more than five materials to `buildSourceSelectionSnapshot`. Tampered/stale batches fail closed.
 */
export function resolveBlockAuthority(state: PageStudyState): BlockAuthority {
  const block = currentBlock(state)
  if (!block) throw fail('PAGE_STUDY_FINISHED', state)
  const batch = state.plan.batches[block.batchIndex]
  if (!batch || !batch.materialIds.includes(block.materialId) || batch.selection.materialIds.length > 5) throw fail('PAGE_STUDY_PLAN_INTEGRITY', state)
  const rebuilt = buildAuthorityBatches(state.plan.planId, state.plan.materials)[block.batchIndex]
  if (!rebuilt || rebuilt.batchId !== batch.batchId || rebuilt.selection.fingerprint !== batch.selection.fingerprint
    || JSON.stringify(rebuilt.materialIds) !== JSON.stringify(batch.materialIds)) throw fail('PAGE_STUDY_PLAN_INTEGRITY', state)
  const studied = studiedPagesOf(state, block.materialId)
  const following = state.plan.blocks[block.index + 1]
  return {
    planId: state.plan.planId, blockKey: block.blockKey, materialId: block.materialId, batchIndex: batch.index, batchId: batch.batchId,
    materialIds: [...batch.materialIds], selection: batch.selection, fingerprint: batch.selection.fingerprint,
    blockPages: [...block.pages], studiedPages: studied, allowedPages: [...new Set([...block.pages, ...studied])].sort((a, b) => a - b),
    nextBatchIndex: following && following.batchIndex !== block.batchIndex ? following.batchIndex : null,
  }
}

// ── state creation / loading / roll-forward ─────────────────────────────────────────────────────────────────
export async function createPageStudy(deps: ServiceDeps, input: Parameters<typeof createPageStudyPlan>[0]): Promise<{ state: PageStudyState; created: boolean }> {
  const plan = createPageStudyPlan(input)
  const id = stateRecordId(input.userId, plan.planId)
  return guarded(async () => {
    const existing = await deps.store.readState(id)
    if (existing) return { state: existing.record.state, created: false }   // restore first: the stored plan is authoritative, never overwritten
    const state = createInitialState(plan, clock(deps))
    const won = await deps.store.casState(id, null, token(deps), { version: 1, revision: 0, state, appliedTurns: [] })
    if (won) return { state, created: true }
    const winner = await deps.store.readState(id)
    if (!winner) throw new Error('PAGE_STUDY_STORAGE_UNAVAILABLE')
    return { state: winner.record.state, created: false }
  })
}

async function readStateRequired(deps: ServiceDeps, userId: string, planId: string): Promise<StoredState> {
  const stored = await deps.store.readState(stateRecordId(userId, planId))
  if (!stored) throw fail('PAGE_STUDY_STATE_NOT_FOUND')
  return stored
}

/** Applies one completed turn's delta to the state with a single CAS. Returns the new stored state, or null if the CAS was lost. */
async function commitDelta(deps: ServiceDeps, userId: string, stored: StoredState, turnId: string, delta: StateDelta): Promise<StoredState | null> {
  const state = stored.record.state
  if (delta.baseRevision !== state.revision || delta.turnSeq !== state.turnSeq + 1) return null
  const next = applyDelta(state, delta)
  const record: PageStudyStateRecord = { version: 1, revision: next.revision, state: next, appliedTurns: [...stored.record.appliedTurns.slice(-(APPLIED_WINDOW - 1)), turnId] }
  const nextToken = token(deps)
  const won = await deps.store.casState(stateRecordId(userId, state.planId), stored.token, nextToken, record)
  return won ? { token: nextToken, record } : null
}

/**
 * Authoritative state load. Any turn that completed but whose delta was never applied (crash / lost response between
 * the two writes) is rolled forward here — exactly once, guarded by the state CAS. Never touches a provider.
 */
export async function loadPageStudy(deps: ServiceDeps, input: { userId: string; planId: string }): Promise<{ state: PageStudyState; rolledForward: number }> {
  return guarded(async () => {
    let stored = await readStateRequired(deps, input.userId, input.planId)
    let rolledForward = 0
    const scope = turnScopeOf(input.userId, input.planId)
    for (let guard = 0; guard < 25; guard++) {
      const state = stored.record.state
      const candidates = await deps.store.listTurnsAfter(scope, state.turnSeq, 5)
      const next = candidates.find(t => t.record.status === 'completed' && t.record.turnSeq === state.turnSeq + 1 && t.record.stateDelta?.baseRevision === state.revision)
      if (!next) break
      const advanced = await commitDelta(deps, input.userId, stored, next.id, next.record.stateDelta!)
      if (advanced) { stored = advanced; rolledForward++ } else stored = await readStateRequired(deps, input.userId, input.planId)
    }
    return { state: stored.record.state, rolledForward }
  })
}

// ── idempotent, single-progression turns ────────────────────────────────────────────────────────────────────
export interface TurnGenerateInput { state: PageStudyState; authority: BlockAuthority; seq: number; attempt: number }
export interface TurnGenerateOutput { result: Record<string, unknown>; ops: StateOp[] }
export interface RunTurnInput {
  userId: string; planId: string; slot: string; requestHash: string; expectedSeq?: number
  generate: (input: TurnGenerateInput) => Promise<TurnGenerateOutput>
}
export interface TurnOutcome { result: Record<string, unknown>; state: PageStudyState; replayed: boolean; attempt: number }

export async function runPageStudyTurn(deps: ServiceDeps, input: RunTurnInput): Promise<TurnOutcome> {
  const { userId, planId, slot, requestHash } = input
  const turnId = turnRecordId(userId, planId, slot)
  const scope = turnScopeOf(userId, planId)
  const lease = deps.leaseMs ?? PAGE_STUDY_LEASE_MS

  // Everything up to `generate` is storage-only. A storage failure here means ZERO provider work.
  const { state } = await loadPageStudy(deps, { userId, planId })
  const existing = await guarded(() => deps.store.readTurn(turnId))

  const settle = async (turn: StoredTurn): Promise<TurnOutcome> => {
    const fresh = await guarded(() => readStateRequired(deps, userId, planId))
    let current = fresh
    if (!current.record.appliedTurns.includes(turnId) && turn.record.turnSeq === current.record.state.turnSeq + 1) {
      const advanced = await guarded(() => commitDelta(deps, userId, current, turnId, turn.record.stateDelta!))
      current = advanced ?? await guarded(() => readStateRequired(deps, userId, planId))
    }
    const applied = current.record.appliedTurns.includes(turnId) || turn.record.turnSeq <= current.record.state.turnSeq - APPLIED_WINDOW
    if (!applied) throw fail('PAGE_STUDY_TURN_SUPERSEDED', current.record.state)
    return { result: turn.record.result!, state: current.record.state, replayed: true, attempt: turn.record.attempt }
  }

  if (existing) {
    if (existing.record.requestHash !== requestHash) throw fail('PAGE_STUDY_TURN_ID_CONFLICT', state)
    if (existing.record.status === 'completed') return settle(existing)
    if (existing.record.status === 'pending' && clock(deps) - Number(existing.record.startedAt ?? 0) < lease) throw fail('PAGE_STUDY_TURN_IN_PROGRESS', state)
  }

  const seq = state.turnSeq + 1
  if (input.expectedSeq !== undefined && input.expectedSeq !== seq) throw fail('PAGE_STUDY_STALE_TURN', state)
  const block = currentBlock(state)
  if (!block) throw fail('PAGE_STUDY_FINISHED', state)
  if (slot !== turnSlot(block.blockKey, seq) && slot !== startSlot(block.blockKey)) throw fail('PAGE_STUDY_INVALID_SLOT', state)
  const authority = resolveBlockAuthority(state)

  const attempt = existing ? existing.record.attempt + 1 : 1
  const pending: PageStudyTurnRecord = { version: 1, slot, requestHash, attempt, status: 'pending', turnSeq: seq, baseRevision: state.revision, startedAt: clock(deps) }
  const reservedToken = token(deps)
  const reserved = await guarded(() => deps.store.casTurn(turnId, scope, existing?.token ?? null, reservedToken, pending))
  if (!reserved) {
    const winner = await guarded(() => deps.store.readTurn(turnId))
    if (winner && winner.record.requestHash === requestHash && winner.record.status === 'completed') return settle(winner)
    if (winner && winner.record.requestHash !== requestHash) throw fail('PAGE_STUDY_TURN_ID_CONFLICT', state)
    throw fail('PAGE_STUDY_TURN_IN_PROGRESS', state)
  }

  const markFailed = (code: string) => deps.store.casTurn(turnId, scope, reservedToken, token(deps), { ...pending, status: 'failed', error: code }).catch(() => false)
  let output: TurnGenerateOutput
  try { output = await input.generate({ state, authority, seq, attempt }) } catch (error) {
    await markFailed(String((error as Error)?.message || 'GENERATE_FAILED').slice(0, 120))   // state untouched; the slot may be retried
    throw error
  }
  const delta: StateDelta = { baseRevision: state.revision, turnSeq: seq, at: clock(deps), ops: output.ops }
  try {
    if (!output.result || typeof output.result !== 'object' || JSON.stringify(output.result).length > MAX_RESULT_CHARS) throw new Error('PAGE_STUDY_INVALID_RESULT')
    applyDelta(state, delta)                                                     // dry run: an unappliable delta is never stored as "completed"
  } catch (error) {
    await markFailed('INVALID_TURN_OUTPUT')
    throw fail(String((error as Error)?.message).startsWith('PAGE_STUDY_') ? (error as Error).message : 'PAGE_STUDY_INVALID_DELTA', state)
  }

  const completed: PageStudyTurnRecord = { ...pending, status: 'completed', result: output.result, stateDelta: delta }
  let committed = false
  try { committed = await deps.store.casTurn(turnId, scope, reservedToken, token(deps), completed) } catch { /* the write may have landed while the response was lost */ }
  if (!committed) {
    const check = await guarded(() => deps.store.readTurn(turnId))
    if (!(check && check.record.requestHash === requestHash && check.record.status === 'completed' && check.record.attempt === attempt)) throw fail('PAGE_STUDY_COMMIT_UNCONFIRMED', state)
  }

  // Second write. If it is lost or crashes here, the turn stays completed-but-unapplied and loadPageStudy rolls it forward.
  const fresh = await guarded(() => readStateRequired(deps, userId, planId))
  if (fresh.record.appliedTurns.includes(turnId)) return { result: output.result, state: fresh.record.state, replayed: false, attempt }
  const advanced = await guarded(() => commitDelta(deps, userId, fresh, turnId, delta))
  if (advanced) return { result: output.result, state: advanced.record.state, replayed: false, attempt }
  const after = await guarded(() => readStateRequired(deps, userId, planId))
  if (after.record.appliedTurns.includes(turnId)) return { result: output.result, state: after.record.state, replayed: false, attempt }
  throw fail('PAGE_STUDY_TURN_SUPERSEDED', after.record.state)
}
