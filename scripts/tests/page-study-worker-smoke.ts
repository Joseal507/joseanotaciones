/**
 * Opt-in REMOTE smoke test for the Page Study Worker routes (talks to the Worker in STUDYAL_API_URL).
 *   baseline:  PAGE_STUDY_SMOKE=1 npx tsx --env-file=.env.local scripts/tests/page-study-worker-smoke.ts baseline   (read-only, no writes)
 *   smoke:     PAGE_STUDY_SMOKE=1 npx tsx --env-file=.env.local scripts/tests/page-study-worker-smoke.ts smoke      (writes ISOLATED test rows, then deletes them)
 * It never imports or calls an LLM/provider. Every id is derived from a random `smoke-…` user, so no real user/session row can be touched.
 */
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { sha256, stateRecordId, turnRecordId, turnScopeOf, turnSlot } from '../../lib/pageStudy/identity'
import { createPageStudy, loadPageStudy, runPageStudyTurn } from '../../lib/pageStudy/service'
import { WorkerPageStudyStore, type PageStudyTurnRecord } from '../../lib/pageStudy/store'
import { currentBlock } from '../../lib/pageStudy/state'

const API = process.env.STUDYAL_API_URL || ''
const SECRET = process.env.WORKER_SHARED_SECRET || ''
const BASELINE = '/tmp/page-study-worker-baseline.json'
if (process.env.PAGE_STUDY_SMOKE !== '1') { console.error('refusing to run: set PAGE_STUDY_SMOKE=1'); process.exit(2) }
if (!API || !SECRET) { console.error('STUDYAL_API_URL / WORKER_SHARED_SECRET missing'); process.exit(2) }

const call = async (method: string, path: string, body?: unknown, auth = true) => {
  const response = await fetch(`${API}${path}`, { method, headers: { ...(auth ? { 'x-studyal-worker-secret': SECRET } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text()
  let json: unknown = null; try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: response.status, body: json ?? text.slice(0, 200) }
}
const rand = () => randomBytes(32).toString('hex')

/** Existing, unrelated behaviour we compare before and after the deploy. No writes: reads and invalid-body probes only. */
async function existingRoutes() {
  const probe = { chat: rand(), material: `smoke-none-${rand().slice(0, 12)}` }
  return {
    health: await call('GET', '/health', undefined, false),
    unauthorized: await call('GET', '/users/by-email?email=x@y.z', undefined, false),
    emailRequired: await call('GET', '/users/by-email?email='),
    byMaterialRequired: await call('GET', '/material-results/by-material'),
    byMaterialAbsent: await call('GET', `/material-results/by-material?materialId=${probe.material}`),
    chatCasInvalid: await call('POST', '/material-results/alai-chat-turn-cas', { id: 'bad' }),
    truquitosCasInvalid: await call('POST', '/material-results/truquitos-cas', { id: 'bad' }),
    examGenerationCasInvalid: await call('POST', '/material-results/exam-generation-cas', { id: 'bad' }),
    quizGenerationCasInvalid: await call('POST', '/material-results/quiz-generation-cas', { identity: 'bad' }),
  }
}
const newRoutes = async () => ({
  readNoAuth: await call('GET', `/material-results/page-study-read?id=${stateRecordId('u', 'p')}`, undefined, false),
  readInvalidId: await call('GET', '/material-results/page-study-read?id=nope'),
  readAbsent: await call('GET', `/material-results/page-study-read?id=${stateRecordId(`smoke-absent-${rand().slice(0, 8)}`, 'p')}`),
  turnsNoAuth: await call('GET', `/material-results/page-study-turns?scope=${turnScopeOf('u', 'p')}`, undefined, false),
  turnsInvalidScope: await call('GET', '/material-results/page-study-turns?scope=nope'),
  turnsEmpty: await call('GET', `/material-results/page-study-turns?scope=${turnScopeOf(`smoke-absent-${rand().slice(0, 8)}`, 'p')}&afterSeq=0`),
  casNoAuth: await call('POST', '/material-results/page-study-cas', { kind: 'state' }, false),
  casInvalid: await call('POST', '/material-results/page-study-cas', { kind: 'state', id: 'bad' }),
})

async function main() {
  const mode = process.argv[2]
  if (mode === 'baseline') {
    const snapshot = { at: new Date().toISOString(), api: API.replace(/^(https?:\/\/[^/]+).*/, '$1'), existing: await existingRoutes(), newRoutes: await newRoutes() }
    writeFileSync(BASELINE, JSON.stringify(snapshot, null, 2)); console.log(JSON.stringify(snapshot, null, 2)); return
  }
  assert.equal(mode, 'smoke')
  const before = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const created: string[] = []                                     // every row id we write, for exact cleanup
  let providerCalls = 0
  const importSpecs = [...readFileSync(__filename, 'utf8').matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])
  assert.ok(importSpecs.every(spec => !/alai|legacyRouteGeneration|openrouter|adaptive\/v3|materialBrain/.test(spec)), `the smoke test imports no provider module: ${importSpecs.join(', ')}`)

  // 1–2. reachability + authentication of the new routes
  const nr = await newRoutes()
  assert.equal(nr.readNoAuth.status, 401, '1. page-study-read rejects unauthenticated callers'); assert.equal(nr.turnsNoAuth.status, 401, '2. page-study-turns rejects unauthenticated callers'); assert.equal(nr.casNoAuth.status, 401, 'page-study-cas rejects unauthenticated callers')
  assert.equal(nr.readInvalidId.status, 400); assert.equal(nr.turnsInvalidScope.status, 400); assert.equal(nr.casInvalid.status, 400, '3. page-study-cas validates the record shape')
  assert.deepEqual(nr.readAbsent.body, { ok: true, result: null }, 'an absent record is an explicit null'); assert.deepEqual(nr.turnsEmpty.body, { ok: true, results: [] })

  const store = new WorkerPageStudyStore(API)
  const smokeUser = `smoke-${randomBytes(6).toString('hex')}`
  const deps = { store }

  // 3–4,9. state: create, read back, revision semantics — remote
  const seedPlan = await createPageStudy(deps, { userId: smokeUser, temaId: 'smoke-tema', materials: [{ materialId: 'smoke-m1' }, { materialId: 'smoke-m2' }], blockSize: 15, universe: { 'smoke-m1': Array.from({ length: 30 }, (_, i) => i + 1), 'smoke-m2': [1, 2, 3] } })
  assert.equal(seedPlan.created, true); const planId = seedPlan.state.planId; const stateId = stateRecordId(smokeUser, planId); created.push(stateId)
  const s0 = (await store.readState(stateId))!; assert.deepEqual(s0.record.state, seedPlan.state, '9. the state reads back exactly')
  assert.equal((await createPageStudy(deps, { userId: smokeUser, temaId: 'smoke-tema', materials: [{ materialId: 'smoke-m1' }, { materialId: 'smoke-m2' }], blockSize: 5, universe: { 'smoke-m1': Array.from({ length: 30 }, (_, i) => i + 1), 'smoke-m2': [1, 2, 3] } })).created, false, 'restore first: no overwrite')
  const bump = (n: number) => ({ ...s0.record, revision: n, state: { ...s0.record.state, revision: n } })
  assert.equal(await store.casState(stateId, s0.token, 'tk-skip', bump(2)), false, '4. skipping a revision is rejected remotely')
  assert.equal(await store.casState(stateId, 'stale', 'tk-stale', bump(1)), false, '4. stale token rejected'); assert.equal(await store.casState(stateId, null, 'tk-dup', s0.record), false, '4. creation cannot overwrite')
  assert.equal(await store.casState(stateId, s0.token, 'tk-ok', bump(1)), true, '4. correct token + next revision succeeds'); assert.equal((await store.readState(stateId))!.record.revision, 1)
  assert.equal(await store.casState(stateId, s0.token, 'tk-old', bump(1)), false, '4. the pre-write token is now stale')

  // 5–8. turn: reserve → complete, idempotency, conflict, immutability — remote, via the real service with a NON-provider fake
  const plan2 = await createPageStudy(deps, { userId: smokeUser, temaId: 'smoke-tema-2', materials: [{ materialId: 'smoke-m3' }], blockSize: 15, universe: { 'smoke-m3': [1, 2, 3, 4] } })
  const p2 = plan2.state.planId; created.push(stateRecordId(smokeUser, p2))
  const block = currentBlock(plan2.state)!; const slot = turnSlot(block.blockKey, 1); const turnId = turnRecordId(smokeUser, p2, slot); created.push(turnId)
  const run = (hash: string) => runPageStudyTurn(deps, { userId: smokeUser, planId: p2, slot, requestHash: hash, expectedSeq: 1, generate: async g => { providerCalls++; return { result: { text: '光合作用 ✓ smoke', seq: g.seq }, ops: [{ op: 'complete', blockKey: g.authority.blockKey }] } } })
  const h = sha256('smoke-request'); const first = await run(h)
  assert.equal(first.replayed, false); assert.equal(first.state.revision, 1, '5. reserve → complete → state applied, remotely')
  const again = await run(h); assert.equal(again.replayed, true, '6. same slot + same request is idempotent'); assert.deepEqual(again.result, first.result); assert.equal(providerCalls, 1, 'the fake generator ran exactly once')
  await assert.rejects(run(sha256('other')), /PAGE_STUDY_TURN_ID_CONFLICT/, '7. same slot + different hash conflicts')
  const done = (await store.readTurn(turnId))!; assert.equal(done.record.status, 'completed'); assert.equal((done.record.result as { text: string }).text, '光合作用 ✓ smoke', '9. Unicode round-trips remotely')
  for (const status of ['pending', 'failed', 'completed'] as const) assert.equal(await store.casTurn(turnId, turnScopeOf(smokeUser, p2), done.token, 'tk-over', { ...done.record, status, attempt: status === 'pending' ? 2 : done.record.attempt } as PageStudyTurnRecord), false, `8. a completed turn stays immutable (${status})`)
  assert.equal((await loadPageStudy(deps, { userId: smokeUser, planId: p2 })).rolledForward, 0)
  const listed = await store.listTurnsAfter(turnScopeOf(smokeUser, p2), 0, 10); assert.equal(listed.length, 1); assert.equal(listed[0].id, turnId); assert.equal((await store.listTurnsAfter(turnScopeOf(smokeUser, p2), 1, 10)).length, 0, '2. page-study-turns lists and filters by sequence')

  // 10. existing ALAI chat CAS still works (isolated id)
  const chatId = `alai_chat_turn:${rand()}`; created.push(chatId); const rh = rand(); const rev = (n: string) => n
  const chatResult = { success: true, schema: 'alai-chat', version: 1, answer: 'smoke', provenance: {}, conversationContext: {}, usedTargetIds: [], usedRelationIds: [], suggestedFollowups: [], evidence: [] }
  const chat = (revision: string, expected: string | null, payload: unknown) => call('POST', '/material-results/alai-chat-turn-cas', { id: chatId, revision, expectedRevision: expected, payload })
  assert.equal(((await chat(rev('c1'), null, { version: 1, requestHash: rh, attempt: 1, status: 'pending' })).body as any).applied, true, '10. chat reserve')
  assert.equal(((await chat(rev('c1b'), null, { version: 1, requestHash: rh, attempt: 1, status: 'pending' })).body as any).applied, false, '10. chat duplicate reserve')
  assert.equal(((await chat(rev('c2'), 'c1', { version: 1, requestHash: rh, attempt: 1, status: 'completed', result: chatResult })).body as any).applied, true, '10. chat complete')
  assert.equal(((await chat(rev('c3'), 'c2', { version: 1, requestHash: rh, attempt: 2, status: 'pending' })).body as any).applied, false, '10. chat completed stays immutable')
  const chatRead = await call('GET', `/material-results/by-material?materialId=${chatId}&enfoque=mixto&resultType=alai_chat_turn`); assert.equal((chatRead.body as any).result.id, chatId)

  // 11. every existing unrelated route answers exactly as before the deploy
  const after = await existingRoutes()
  assert.deepEqual(after, before.existing, '11. existing routes are unchanged (status + body) by the deploy')

  // cleanup: delete ONLY the rows this run created, then prove they are gone
  const inList = created.map(id => `'${id.replace(/'/g, '')}'`).join(',')
  execSync(`cd cloudflare/studyal-api && npx wrangler d1 execute studyal-dev-db --remote --command "DELETE FROM material_results WHERE id IN (${inList})"`, { stdio: 'pipe', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLOUDFLARE_|CF_|WRANGLER_)/.test(key))) }) // .env.local carries a CLOUDFLARE_API_TOKEN that would override wrangler's OAuth login
  for (const id of created) {
    const type = id.startsWith('pstudy_') ? `id=${id}` : ''
    const res = type ? await call('GET', `/material-results/page-study-read?${type}`) : await call('GET', `/material-results/by-material?materialId=${id}&enfoque=mixto&resultType=alai_chat_turn`)
    const gone = (res.body as any).result === null; assert.ok(gone, `cleanup left a row behind: ${id}`)
  }
  console.log(JSON.stringify({ result: 'REMOTE SMOKE PASS', api: API.replace(/^(https?:\/\/[^/]+).*/, '$1'), rowsCreatedThenDeleted: created.length, llmProviderCalls: 0, fakeGeneratorCalls: providerCalls, existingRoutesUnchanged: true, newRoutes: nr }, null, 2))
}
main().catch(error => { console.error('SMOKE ERROR', error?.message || error); process.exit(1) })
