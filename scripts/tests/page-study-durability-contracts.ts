import './page-study-env'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { sha256, stateRecordId, turnRecordId, turnScopeOf, turnSlot } from '../../lib/pageStudy/identity'
import { PageStudyError, createPageStudy, loadPageStudy, resolveBlockAuthority, runPageStudyTurn, type BlockAuthority, type ServiceDeps } from '../../lib/pageStudy/service'
import { applyDeltaIfPending, currentBlock } from '../../lib/pageStudy/state'
import { WorkerPageStudyStore, type PageStudyTurnRecord } from '../../lib/pageStudy/store'
import type { PageStudyState, StateOp } from '../../lib/pageStudy/types'
import { makeWorker } from './page-study-worker-harness'

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const mats = ['QUIMICA', 'ALCANOS', 'CONFORMACIONES', 'ALQUENOS', 'ALQUINOS', 'AROMATICOS', 'HALUROS', 'ALCOHOLES'].map((name, i) => ({ materialId: `pdf-${i + 1}`, name, selectedPages: [] as number[] }))
const universe = Object.fromEntries(mats.map(m => [m.materialId, range(1, 30)]))
const userId = 'u1'
const RAW_PDF2 = 'RAW-PDF2-SOURCE-TEXT-must-never-cross-batches'

let providerCalls = 0
let clockNow = 1_700_000_000_000
const codeOf = async (work: Promise<unknown>): Promise<string> => { try { await work; return 'OK' } catch (e) { return e instanceof PageStudyError ? e.code : `RAW:${(e as Error).message}` } }

async function fresh(materials = mats) {
  const w = makeWorker()
  const deps: ServiceDeps = { store: w.store, now: () => (clockNow += 10) }
  const { state } = await createPageStudy(deps, { userId, temaId: 'tema-1', materials, blockSize: 15, universe })
  return { w, deps, planId: state.planId, initial: state }
}
type Ctx = Awaited<ReturnType<typeof fresh>>

/** One turn through the durable service with a counting fake provider. */
async function turn(ctx: Ctx, opsFn: (s: PageStudyState) => StateOp[], opts: { slot?: string; hash?: string; result?: Record<string, unknown>; onGenerate?: (a: BlockAuthority) => void; gate?: () => Promise<void>; expectedSeq?: number | null; deps?: ServiceDeps } = {}) {
  const deps = opts.deps ?? ctx.deps
  const { state } = await loadPageStudy(deps, { userId, planId: ctx.planId })
  const block = currentBlock(state)!
  const slot = opts.slot ?? turnSlot(block.blockKey, state.turnSeq + 1)
  return runPageStudyTurn(deps, {
    userId, planId: ctx.planId, slot, requestHash: opts.hash ?? sha256(['req', slot]), expectedSeq: opts.expectedSeq === null ? undefined : opts.expectedSeq ?? state.turnSeq + 1,
    generate: async g => { providerCalls++; opts.onGenerate?.(g.authority); await opts.gate?.(); return { result: opts.result ?? { text: `respuesta ${g.seq}`, seq: g.seq }, ops: opsFn(g.state) } },
  })
}
const completeOps = (s: PageStudyState): StateOp[] => [{ op: 'complete', blockKey: currentBlock(s)!.blockKey }]
const meta = (materialId: string, id: string, label = id) => ({ unitRef: `${materialId}::${id}`, materialId, label, kind: 'concept', pages: [1] })
const stateRow = (ctx: Ctx) => ctx.w.rows('page_study_state')
const storedState = async (ctx: Ctx) => (await ctx.w.store.readState(stateRecordId(userId, ctx.planId)))!

async function main() {
  // ── A. create / read PageStudyState ────────────────────────────────────────────────────────────────────────
  let ctx = await fresh()
  assert.equal(ctx.initial.plan.materials.length, 8); assert.equal(ctx.initial.plan.batches.length, 2)
  assert.equal(stateRow(ctx).length, 1); assert.equal(stateRow(ctx)[0].id, stateRecordId(userId, ctx.planId)); assert.equal(stateRow(ctx)[0].material_id, stateRow(ctx)[0].id)
  const again = await createPageStudy(ctx.deps, { userId, temaId: 'tema-1', materials: [...mats].reverse(), blockSize: 5, universe })
  assert.equal(again.created, false, 'restore first: creating the same plan again never overwrites'); assert.equal(again.state.plan.blockSize, 15, 'the STORED plan is authoritative')
  assert.equal(stateRow(ctx).length, 1); assert.deepEqual((await loadPageStudy(ctx.deps, { userId, planId: ctx.planId })).state, ctx.initial)
  const badWrites = [
    { kind: 'state', id: 'nope', revision: 'x', expectedRevision: null, payload: { version: 1 } },
    { kind: 'state', id: stateRecordId('other', 'p'), revision: 'x', expectedRevision: null, payload: { version: 1, revision: 3, state: { version: 1, planId: 'p', revision: 3 }, appliedTurns: [] } },
    { kind: 'turn', id: turnRecordId('u', 'p', 's'), scope: 'bad', revision: 'x', expectedRevision: null, payload: { version: 1 } },
  ]
  for (const body of badWrites) { const r = await ctx.w.request('https://worker.test/material-results/page-study-cas', { method: 'POST', body: JSON.stringify(body), headers: { 'x-studyal-worker-secret': 'page-study-test-secret' } }); assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60)) }
  const unauth = await ctx.w.request('https://worker.test/material-results/page-study-read?id=' + stateRecordId(userId, ctx.planId), { headers: {} } as RequestInit)
  assert.equal(unauth.status, 401, 'the Worker secret gate still applies to the new routes')

  // ── B/C. CAS: correct revision succeeds, stale fails, revision must advance by exactly one ────────────────────
  const s0 = await storedState(ctx)
  const bump = (n: number) => ({ ...s0.record, revision: n, state: { ...s0.record.state, revision: n } })
  assert.equal(await ctx.w.store.casState(stateRecordId(userId, ctx.planId), s0.token, 'tok-jump', bump(2)), false, 'C. skipping a revision is rejected')
  assert.equal(await ctx.w.store.casState(stateRecordId(userId, ctx.planId), 'wrong-token', 'tok-x', bump(1)), false, 'C. a stale token is rejected')
  assert.equal(await ctx.w.store.casState(stateRecordId(userId, ctx.planId), null, 'tok-y', s0.record), false, 'creation cannot overwrite an existing state')
  const out1 = await turn(ctx, completeOps); assert.equal(out1.state.revision, 1); assert.equal(out1.replayed, false)
  const s1 = await storedState(ctx); assert.equal(s1.record.revision, 1); assert.equal(await ctx.w.store.casState(stateRecordId(userId, ctx.planId), s0.token, 'tok-z', bump(1)), false, 'B/C. the pre-turn token is now stale')
  assert.equal(await codeOf(turn(ctx, completeOps, { expectedSeq: 1 })), 'PAGE_STUDY_STALE_TURN', 'C. a client holding an old sequence is told to refresh')
  try { await turn(ctx, completeOps, { expectedSeq: 1 }) } catch (e) { assert.equal((e as PageStudyError).state!.turnSeq, 1, 'the conflict carries the current authoritative state') }

  // ── D/E/F/G. reserve idempotent, hash conflict, completion idempotent, completed is immutable ───────────────
  ctx = await fresh(); let base = providerCalls
  const slot1 = turnSlot('pdf-1:1-15', 1); const id1 = turnRecordId(userId, ctx.planId, slot1); const scope = turnScopeOf(userId, ctx.planId)
  const hash = sha256('same-request'); const pend: PageStudyTurnRecord = { version: 1, slot: slot1, requestHash: hash, attempt: 1, status: 'pending', turnSeq: 1, baseRevision: 0 }
  assert.equal(await ctx.w.store.casTurn(id1, scope, null, 't1', pend), true); assert.equal(await ctx.w.store.casTurn(id1, scope, null, 't2', pend), false, 'D. reserving twice cannot create two records')
  assert.equal(ctx.w.rows('page_study_turn').length, 1); assert.equal((await ctx.w.store.readTurn(id1))!.token, 't1')
  assert.equal(await ctx.w.store.casTurn(id1, scope, 't1', 't3', { ...pend, requestHash: sha256('other') , status: 'completed', result: { a: 1 }, stateDelta: { baseRevision: 0, turnSeq: 1, at: 1, ops: [] } }), false, 'E. the request hash is immutable')
  assert.equal(await ctx.w.store.casTurn(id1, scope, 't1', 't4', { ...pend, attempt: 2, status: 'failed' }), false, 'a different attempt cannot close this reservation')
  base = providerCalls; assert.equal(await codeOf(turn(ctx, completeOps, { slot: slot1, hash })), 'PAGE_STUDY_TURN_IN_PROGRESS', 'a live reservation blocks a second run of the same slot'); assert.equal(providerCalls, base, 'and costs no provider call')
  ctx = await fresh(); base = providerCalls
  const first = await turn(ctx, completeOps, { result: { text: '光合作用 ✓ Δ𝐺', seq: 1 } }); const slotA = turnSlot('pdf-1:1-15', 1); const idA = turnRecordId(userId, ctx.planId, slotA); const hashA = sha256(['req', slotA])
  assert.equal(providerCalls, base + 1)
  const replay = await runPageStudyTurn(ctx.deps, { userId, planId: ctx.planId, slot: slotA, requestHash: hashA, generate: async () => { providerCalls++; throw new Error('must not run') } })
  assert.equal(replay.replayed, true, 'F. a completed slot returns the stored result'); assert.deepEqual(replay.result, first.result); assert.equal(replay.result.text, '光合作用 ✓ Δ𝐺', 'Unicode result survives storage'); assert.equal(providerCalls, base + 1, 'F/G. no regeneration')
  assert.equal(await codeOf(runPageStudyTurn(ctx.deps, { userId, planId: ctx.planId, slot: slotA, requestHash: sha256('different'), generate: async () => { providerCalls++; return { result: {}, ops: [] } } })), 'PAGE_STUDY_TURN_ID_CONFLICT', 'E. same slot + different request = conflict'); assert.equal(providerCalls, base + 1)
  const stored = (await ctx.w.store.readTurn(idA))!
  for (const status of ['pending', 'failed', 'completed'] as const) assert.equal(await ctx.w.store.casTurn(idA, scope, stored.token, 'tok-over', { ...stored.record, status, attempt: status === 'pending' ? 2 : stored.record.attempt }), false, `G. a completed turn cannot be overwritten (${status})`)
  assert.deepEqual((await ctx.w.store.readTurn(idA))!.record.result, first.result)

  // ── H. failed turn retries safely; repair/validation failure fails closed and preserves state ────────────────
  ctx = await fresh(); base = providerCalls
  const revBefore = (await storedState(ctx)).record.revision
  const slotH = turnSlot('pdf-1:1-15', 1)
  assert.match(await codeOf(runPageStudyTurn(ctx.deps, { userId, planId: ctx.planId, slot: slotH, requestHash: sha256('h'), generate: async () => { providerCalls++; throw new Error('provider down') } })), /provider down/)
  assert.equal(providerCalls, base + 1); assert.equal((await storedState(ctx)).record.revision, revBefore, 'provider failure preserves state'); assert.equal((await ctx.w.store.readTurn(turnRecordId(userId, ctx.planId, slotH)))!.record.status, 'failed')
  const retry = await runPageStudyTurn(ctx.deps, { userId, planId: ctx.planId, slot: slotH, requestHash: sha256('h'), expectedSeq: 1, generate: async g => { providerCalls++; return { result: { ok: true, attempt: g.attempt }, ops: completeOps(g.state) } } })
  assert.equal(retry.attempt, 2); assert.equal(retry.state.revision, 1); assert.equal(providerCalls, base + 2, 'H. the failed slot retried exactly once more')
  const badOps = [{ op: 'answer', verdict: 'correct', digest: 'x' } as StateOp]                       // nothing pending → unappliable
  ctx = await fresh(); base = providerCalls
  assert.equal(await codeOf(turn(ctx, () => badOps)), 'PAGE_STUDY_NO_PENDING', 'an invalid delta is refused BEFORE the turn is stored as completed')
  assert.equal((await ctx.w.store.readTurn(turnRecordId(userId, ctx.planId, turnSlot('pdf-1:1-15', 1))))!.record.status, 'failed'); assert.equal((await storedState(ctx)).record.revision, 0)
  assert.equal(await codeOf(turn(ctx, completeOps, { result: { big: 'x'.repeat(120_000) } })), 'PAGE_STUDY_INVALID_RESULT', 'oversize output fails closed'); assert.equal((await storedState(ctx)).record.revision, 0)

  // ── I/J. completed-but-unapplied delta rolls forward exactly once; a replay never applies twice ───────────────
  ctx = await fresh(); base = providerCalls
  ctx.w.faults.push({ match: (path, body) => path.endsWith('page-study-cas') && body?.kind === 'state' && body?.expectedRevision !== null, times: 1, mode: 'throw_before' })
  assert.equal(await codeOf(turn(ctx, completeOps)), 'PAGE_STUDY_STORAGE_UNAVAILABLE', 'the state write failed after the turn completed')
  assert.equal((await storedState(ctx)).record.revision, 0); assert.equal(ctx.w.rows('page_study_turn').filter(r => JSON.parse(r.payload).status === 'completed').length, 1)
  let writesBefore = ctx.w.stats.writes; const rolled = await loadPageStudy(ctx.deps, { userId, planId: ctx.planId })
  assert.equal(rolled.rolledForward, 1, 'I. recovered on load'); assert.equal(rolled.state.revision, 1); assert.equal(rolled.state.turnSeq, 1); assert.equal(ctx.w.stats.writes, writesBefore + 1, 'exactly one write')
  const again2 = await loadPageStudy(ctx.deps, { userId, planId: ctx.planId }); assert.equal(again2.rolledForward, 0, 'J. never applied twice'); assert.equal(again2.state.revision, 1)
  const slotJ = turnSlot('pdf-1:1-15', 1)
  const rep = await runPageStudyTurn(ctx.deps, { userId, planId: ctx.planId, slot: slotJ, requestHash: sha256(['req', slotJ]), generate: async () => { providerCalls++; return { result: {}, ops: [] } } })
  assert.equal(rep.replayed, true); assert.equal(rep.state.revision, 1); assert.equal(providerCalls, base + 1, 'the recovered turn was never regenerated')
  const delta = (await ctx.w.store.readTurn(turnRecordId(userId, ctx.planId, slotJ)))!.record.stateDelta!; assert.equal(applyDeltaIfPending(rolled.state, delta), rolled.state, 'reducer-level replay is a no-op')
  // write landed but the response was lost
  ctx = await fresh(); ctx.w.faults.push({ match: (path, body) => path.endsWith('page-study-cas') && body?.kind === 'state' && body?.expectedRevision !== null, times: 1, mode: 'throw_after' })
  assert.equal(await codeOf(turn(ctx, completeOps)), 'PAGE_STUDY_STORAGE_UNAVAILABLE'); const landed = await loadPageStudy(ctx.deps, { userId, planId: ctx.planId }); assert.equal(landed.state.revision, 1, 'advanced exactly once'); assert.equal(landed.rolledForward, 0)
  // completion write landed but its response was lost: the service confirms by re-reading, not by regenerating
  ctx = await fresh(); base = providerCalls
  ctx.w.faults.push({ match: (path, body) => path.endsWith('page-study-cas') && body?.kind === 'turn' && body?.payload?.status === 'completed', times: 1, mode: 'throw_after' })
  const lost = await turn(ctx, completeOps); assert.equal(lost.state.revision, 1); assert.equal(providerCalls, base + 1)

  // ── K. concurrency: no duplicate progression ─────────────────────────────────────────────────────────────
  ctx = await fresh(); base = providerCalls
  const slotK = turnSlot('pdf-1:1-15', 1); const gate = () => new Promise<void>(r => setTimeout(r, 25))
  const same = await Promise.all(Array.from({ length: 6 }, () => codeOf(runPageStudyTurn(ctx.deps, { userId, planId: ctx.planId, slot: slotK, requestHash: sha256('k'), expectedSeq: 1, generate: async g => { providerCalls++; await gate(); return { result: { n: 1 }, ops: completeOps(g.state) } } }))))
  assert.equal(providerCalls, base + 1, 'K. six concurrent identical submits made ONE provider call'); assert.ok(same.filter(c => c === 'OK').length >= 1 && same.every(c => c === 'OK' || c === 'PAGE_STUDY_TURN_IN_PROGRESS'), same.join(','))
  assert.equal((await storedState(ctx)).record.revision, 1); assert.equal((await storedState(ctx)).record.state.turnSeq, 1)
  ctx = await fresh(); base = providerCalls                                                              // two DIFFERENT slots racing for the same sequence number
  const race = await Promise.all([
    codeOf(runPageStudyTurn(ctx.deps, { userId, planId: ctx.planId, slot: turnSlot('pdf-1:1-15', 1), requestHash: sha256('a'), expectedSeq: 1, generate: async g => { providerCalls++; await gate(); return { result: { who: 'a' }, ops: completeOps(g.state) } } })),
    codeOf(runPageStudyTurn(ctx.deps, { userId, planId: ctx.planId, slot: 'pstudy:pdf-1:1-15:start', requestHash: sha256('b'), expectedSeq: 1, generate: async g => { providerCalls++; await gate(); return { result: { who: 'b' }, ops: completeOps(g.state) } } })),
  ])
  assert.equal(race.filter(c => c === 'OK').length, 1, `exactly one wins the sequence: ${race.join(',')}`); assert.ok(race.some(c => c === 'PAGE_STUDY_TURN_SUPERSEDED' || c === 'PAGE_STUDY_STALE_TURN'))
  const raced = await storedState(ctx); assert.equal(raced.record.revision, 1); assert.equal(raced.record.state.turnSeq, 1); assert.equal(raced.record.appliedTurns.length, 1, 'K. the sequence advanced once')

  // ── lease: an abandoned pending turn is recoverable, a live one is not stolen ────────────────────────────────
  ctx = await fresh(); base = providerCalls
  const slotL = turnSlot('pdf-1:1-15', 1); const idL = turnRecordId(userId, ctx.planId, slotL)
  assert.equal(await ctx.w.store.casTurn(idL, turnScopeOf(userId, ctx.planId), null, 'crashed', { version: 1, slot: slotL, requestHash: sha256(['req', slotL]), attempt: 1, status: 'pending', turnSeq: 1, baseRevision: 0 }), true)
  assert.equal(await codeOf(turn(ctx, completeOps)), 'PAGE_STUDY_TURN_IN_PROGRESS', 'a live reservation is never stolen'); assert.equal(providerCalls, base, 'and costs no provider call')
  ctx.w.db.prepare(`UPDATE material_results SET payload = json_set(payload, '$.startedAt', 1) WHERE id = ?`).run(idL); ctx.deps.now = () => Date.now()
  const taken = await turn(ctx, completeOps); assert.equal(taken.attempt, 2, 'an expired lease is taken over'); assert.equal(taken.state.revision, 1); assert.equal(providerCalls, base + 1)

  // ── L/M. one plan, authority batch switches 1–5 → 6–8, bounded carryover only ────────────────────────────────
  ctx = await fresh(); base = providerCalls
  const seen: BlockAuthority[] = []; const sourceOfPdf2 = RAW_PDF2                                   // the fake "provider" alone knows the PDF2 text
  const capture = (a: BlockAuthority) => seen.push(a)
  let s = ctx.initial
  while (currentBlock(s)!.materialId !== 'pdf-6') {
    const b = currentBlock(s)!
    if (b.blockKey === 'pdf-2:1-15') {
      const u = meta('pdf-2', 'sp2_p', 'Orbitales p sin hibridar'); void sourceOfPdf2
      await turn(ctx, st => [{ op: 'units', blockKey: b.blockKey, total: 1 }, { op: 'teach', blockKey: b.blockKey, klass: 'FULL', units: [u] }, { op: 'ask', ref: 'q', unitRefs: [u.unitRef], format: 'open', kind: 'mini' }], { onGenerate: capture })
      await turn(ctx, () => [{ op: 'answer', verdict: 'incorrect', digest: 'respondió 2', misconception: { statement: 'Cree que sp2 deja 2 p', correctStatement: 'sp2 deja 1 p sin hibridar' } }], { onGenerate: capture })
    }
    s = (await turn(ctx, completeOps, { onGenerate: capture })).state
  }
  const last5 = seen.filter(a => a.materialId === 'pdf-5').pop()!; assert.equal(last5.nextBatchIndex, 1, 'the last PDF-5 block knows the next block opens batch 2')
  assert.ok(seen.filter(a => a.materialId !== 'pdf-5').every(a => a.nextBatchIndex === null || a.materialId === 'pdf-5'))
  assert.deepEqual([...new Set(seen.map(a => a.batchIndex))], [0]); const at6 = resolveBlockAuthority(s)
  assert.equal(at6.batchIndex, 1); assert.deepEqual(at6.materialIds, ['pdf-6', 'pdf-7', 'pdf-8']); assert.equal(at6.selection.fingerprint, s.plan.batches[1].selection.fingerprint); assert.equal(at6.planId, ctx.planId)
  assert.ok([...seen, at6].every(a => a.selection.materialIds.length <= 5), 'L. every authority is a genuine ≤5 snapshot'); assert.ok(!at6.selection.materialIds.some(id => ['pdf-1', 'pdf-2', 'pdf-3', 'pdf-4', 'pdf-5'].includes(id)))
  assert.equal(stateRow(ctx).length, 1, 'L. still ONE durable plan/state record for the whole 8-PDF session'); assert.equal((await storedState(ctx)).record.state.planId, ctx.planId)
  const seenHashes = new Set(seen.map(a => a.fingerprint)); assert.equal(seenHashes.size, 1)
  assert.equal(s.carryover.length, 1, 'M. the PDF-2 weakness crossed the batch boundary'); assert.equal(s.carryover[0].materialId, 'pdf-2')
  const persisted = JSON.stringify(ctx.w.rows().map(r => r.payload)); assert.ok(!persisted.includes(RAW_PDF2), 'no raw source is ever written to the durable records'); assert.ok(!JSON.stringify({ s, at6 }).includes(RAW_PDF2))
  assert.doesNotMatch(JSON.stringify(s.carryover), /"(quote|summary|content|sourceSpans|text)"/); assert.doesNotMatch(JSON.stringify(stateRow(ctx).map(r => JSON.parse(r.payload).state.carryover)), /"(quote|summary|sourceSpans)"/)
  const svc = readFileSync('lib/pageStudy/service.ts', 'utf8') + readFileSync('lib/pageStudy/store.ts', 'utf8'); assert.doesNotMatch(svc, /buildSourceSelectionSnapshot\(/, 'the service never builds a snapshot itself (so it can never accept a truncated one)')
  const tampered = JSON.parse(JSON.stringify(s)) as PageStudyState; tampered.plan.batches[1].materialIds.push('pdf-1')
  assert.throws(() => resolveBlockAuthority(tampered), /PAGE_STUDY_PLAN_INTEGRITY/, 'a tampered batch fails closed')

  // ── N. restore / read / replay = ZERO provider calls and ZERO writes ───────────────────────────────────────────
  const callsBeforeRestore = providerCalls; const writesBeforeRestore = ctx.w.stats.writes
  for (let i = 0; i < 3; i++) {
    const reopened: ServiceDeps = { store: new WorkerPageStudyStore('https://worker.test', ctx.w.request) }               // a brand-new process/store
    const loaded = await loadPageStudy(reopened, { userId, planId: ctx.planId }); assert.equal(loaded.rolledForward, 0); assert.deepEqual(loaded.state, s)
    assert.equal((await createPageStudy(reopened, { userId, temaId: 'tema-1', materials: mats, blockSize: 15, universe })).created, false)
    const oldSlot = turnSlot('pdf-1:1-15', 1)
    const replayed = await runPageStudyTurn(reopened, { userId, planId: ctx.planId, slot: oldSlot, requestHash: sha256(['req', oldSlot]), generate: async () => { providerCalls++; return { result: {}, ops: [] } } }); assert.equal(replayed.replayed, true)
  }
  assert.equal(providerCalls, callsBeforeRestore, 'N. close / reopen / restore / replay made zero provider calls'); assert.equal(ctx.w.stats.writes, writesBeforeRestore, 'and zero writes')

  // ── O. Worker unavailable / undeployed / malformed → fail closed BEFORE any provider work ──────────────────────
  ctx = await fresh(); base = providerCalls
  const noApi: ServiceDeps = { store: new WorkerPageStudyStore('', fetch) }
  assert.equal(await codeOf(loadPageStudy(noApi, { userId, planId: ctx.planId })), 'PAGE_STUDY_STORAGE_UNAVAILABLE')
  assert.equal(await codeOf(turn(ctx, completeOps, { deps: noApi })), 'PAGE_STUDY_STORAGE_UNAVAILABLE')
  ctx.w.faults.push({ match: p => p.includes('page-study'), times: 99, mode: 'status', status: 404 })                   // route not deployed
  assert.equal(await codeOf(turn(ctx, completeOps)), 'PAGE_STUDY_STORAGE_UNAVAILABLE'); ctx.w.faults.length = 0
  ctx.w.faults.push({ match: p => p.includes('page-study'), times: 99, mode: 'throw_before' })
  assert.equal(await codeOf(turn(ctx, completeOps)), 'PAGE_STUDY_STORAGE_UNAVAILABLE'); ctx.w.faults.length = 0
  const malformed: ServiceDeps = { store: new WorkerPageStudyStore('https://worker.test', (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch) }
  assert.equal(await codeOf(loadPageStudy(malformed, { userId, planId: ctx.planId })), 'PAGE_STUDY_STORAGE_MALFORMED')
  ctx.w.faults.push({ match: (path, body) => path.endsWith('page-study-cas') && body?.kind === 'turn' && body?.expectedRevision === null, times: 1, mode: 'throw_before' })   // the reservation write itself fails
  assert.equal(await codeOf(turn(ctx, completeOps)), 'PAGE_STUDY_STORAGE_UNAVAILABLE'); ctx.w.faults.length = 0
  assert.equal(await codeOf(loadPageStudy(ctx.deps, { userId, planId: 'pstudy_plan:' + 'f'.repeat(64) })), 'PAGE_STUDY_STATE_NOT_FOUND')
  assert.equal(providerCalls, base, 'O. storage failures cost ZERO provider calls'); assert.equal((await storedState(ctx)).record.revision, 0)

  // ── P. existing CAS behaviour is unchanged (same real Worker, existing routes) ─────────────────────────────────
  const post = async (path: string, body: unknown) => (await (await ctx.w.request(`https://worker.test${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'x-studyal-worker-secret': 'page-study-test-secret' } })).json()) as Record<string, any>
  const chatId = 'alai_chat_turn:' + 'a'.repeat(64); const rh = 'b'.repeat(64)
  assert.equal((await post('/material-results/alai-chat-turn-cas', { id: chatId, revision: 'r1', expectedRevision: null, payload: { version: 1, requestHash: rh, attempt: 1, status: 'pending' } })).applied, true)
  assert.equal((await post('/material-results/alai-chat-turn-cas', { id: chatId, revision: 'r1b', expectedRevision: null, payload: { version: 1, requestHash: rh, attempt: 1, status: 'pending' } })).applied, false)
  const chatResult = { success: true, schema: 'alai-chat', version: 1, answer: 'hola', provenance: {}, conversationContext: {}, usedTargetIds: [], usedRelationIds: [], suggestedFollowups: [], evidence: [] }
  assert.equal((await post('/material-results/alai-chat-turn-cas', { id: chatId, revision: 'r2', expectedRevision: 'r1', payload: { version: 1, requestHash: rh, attempt: 1, status: 'completed', result: chatResult } })).applied, true)
  assert.equal((await post('/material-results/alai-chat-turn-cas', { id: chatId, revision: 'r3', expectedRevision: 'r2', payload: { version: 1, requestHash: rh, attempt: 2, status: 'pending' } })).applied, false, 'chat: completed stays immutable')
  const tId = 'truquitos:' + 'c'.repeat(64)
  assert.equal((await post('/material-results/truquitos-cas', { id: tId, revision: 't1', expectedRevision: null, payload: { a: 1 } })).applied, true); assert.equal((await post('/material-results/truquitos-cas', { id: tId, revision: 't2', expectedRevision: 'bad', payload: { a: 2 } })).applied, false); assert.equal((await post('/material-results/truquitos-cas', { id: tId, revision: 't2', expectedRevision: 't1', payload: { a: 2 } })).applied, true)
  assert.equal(ctx.w.rows().filter(r => r.result_type === 'alai_chat_turn').length, 1)
  const numstat = execSync('git diff --numstat 16744e0~1 16744e0 -- cloudflare/studyal-api/src/index.ts', { encoding: 'utf8' }).trim().split(/\s+/); assert.ok(Number(numstat[0]) > 0 && Number(numstat[1]) === 0, `the Worker change (checkpoint commit 16744e0) is additive only (added ${numstat[0]}, removed ${numstat[1]})`)
  assert.match(readFileSync('cloudflare/studyal-api/src/index.ts', 'utf8'), /\/material-results\/alai-chat-turn-cas[\s\S]*\/material-results\/page-study-cas[\s\S]*\/material-results\/truquitos-cas/, 'new routes sit beside, not inside, the existing ones')

  // ── Q. the certified max-5 source authority is untouched ───────────────────────────────────────────────────────
  assert.equal(buildSourceSelectionSnapshot(['a', 'b', 'c', 'd', 'e', 'f'], {}).materialIds.length, 5)
  const porcelain = execSync('git status --porcelain', { encoding: 'utf8' })
  // lib/pageStudy/state.ts intentionally left this list in Phase 5J: coverageOf()'s pagesDone
  // was derived independently of pct (whole-block-only vs. fractional), producing a labeled
  // contradiction ("0 de 2 páginas" next to "14% estudiado"). The fix only changed that
  // derivation (a display value); the reducer/CAS/replay semantics this guard protects are
  // untouched — see the adaptive-material-language-recovery/page-study Phase 5 contracts.
  for (const file of ['lib/adaptive/sourceSelection.ts', 'lib/adaptive/materialEnjoyer.ts', 'lib/materialBrain/chatEnjoyerContext.ts', 'lib/materialBrain/quiz/sessionAuthority.ts', 'lib/studySessions.ts', 'lib/alai-chat/turnStore.ts', 'app/api/alai-studyal-chat/route.ts', 'lib/materials/sourceIndex.ts', 'lib/pageStudy/grounding.ts', 'lib/pageStudy/evidence.ts', 'lib/pageStudy/batching.ts', 'lib/pageStudy/identity.ts']) assert.ok(!porcelain.split('\n').some(l => l.startsWith(' M') && l.endsWith(file)), `frozen file modified: ${file}`)
  console.log(`PASS page-study-durability: real Worker + real SQLite CAS; create/read, CAS, idempotent reserve/complete, conflicts, retry, roll-forward once, concurrency, lease, 8-PDF batch switch, restore=0 provider calls, fail-closed storage (provider calls total in scenario: ${providerCalls})`)
}
main().catch(error => { console.error(error); process.exit(1) })
