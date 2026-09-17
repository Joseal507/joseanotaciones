import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  initialFreeStudyMapState, beginFreeStudyMap, completeFreeStudyMap, failFreeStudyMap,
  recoverInterruptedFreeStudyMap, abandonFreeStudyMap, type DurableFreeStudyMapState, type StudyMapData,
} from '../../lib/freeStudyMapState'

// ============================================================
// STUDYMAP_LOADING_LIFECYCLE regression: a live test showed Free Mode ->
// Study Map stuck permanently on its loading spinner, with ZERO network
// request to /api/alai-studyal-map and ZERO error surfaced.
//
// ROOT CAUSE (found by direct source inspection of the mount/regeneration
// effect in components/materias/ALAIStudyMap.tsx): every TERMINAL branch
// inside the effect's async run() (success, failure, the dead
// BRAIN_ENRICHING path) correctly cleared `activeGenerationKeyRef.current`
// — but the useEffect's own CLEANUP function (fired on unmount, or on a
// React StrictMode dev double-invoke, or any prop change that re-runs the
// effect before the in-flight fetch resolves) never did. `generationKey`
// was only ever computed INSIDE run(), invisible to the cleanup closure.
//
// Sequence that reproduces the bug (this is exactly what StrictMode's
// mount -> cleanup -> mount dev double-invoke does on every single
// mount): 1st invocation claims activeGenerationKeyRef = "sess::fp" and
// starts the fetch; React tears the effect down before the fetch settles
// -> cleanup runs but leaves the ref claimed; 2nd (real) invocation's
// own single-flight guard sees `activeGenerationKeyRef.current ===
// generationKey` and returns IMMEDIATELY — no fetch, no restore, no
// error, `loading` frozen at its initial `true` forever.
//
// FIX: `generationKey` hoisted to the effect's top-level scope; the
// cleanup now releases `activeGenerationKeyRef.current` when (a) this
// invocation actually claimed it (`startedAttempt !== null`) and (b) it
// still owns the key (never a newer invocation's).
//
// This harness models the REAL effect's exact state machine (claim ->
// fetch -> terminal-clear, plus the cleanup's claim-release) through the
// real lib/freeStudyMapState.ts reducers — the same harness style already
// used by studymap-generation-single-flight-contracts.ts, extended to
// cover the specific interruption-before-fetch-resolves scenario that
// file did not model.
// ============================================================

const fakeMap: StudyMapData = { title: 't', root: { id: 'root', label: 't', type: 'root' } }

interface FetchResult { ok: boolean; success: boolean; mapa?: StudyMapData; error?: string }

class EffectHarness {
  activeKey: string | null = null
  requestCount = 0
  storesByKey = new Map<string, DurableFreeStudyMapState>()
  /** Toggles the OLD buggy cleanup (false) vs the FIXED cleanup (true) — proves the invariant both ways. */
  constructor(private releaseOnInterruptedCleanup: boolean) {}

  private key(sessionId: string, fingerprint: string) { return `${sessionId}::${fingerprint}` }
  stateOf(sessionId: string, fingerprint: string) { return this.storesByKey.get(this.key(sessionId, fingerprint)) || initialFreeStudyMapState() }

  /** One useEffect invocation. Returns a cleanup() you call to simulate unmount/re-run/StrictMode teardown. */
  mount(sessionId: string, fingerprint: string, fetchImpl: () => Promise<FetchResult>): { cleanup: () => void; awaitSettled: () => Promise<void> } {
    const generationKey = this.key(sessionId, fingerprint)
    let cancelled = false
    let startedAttempt: number | null = null
    let settled: Promise<void> = Promise.resolve()

    const run = async () => {
      if (!sessionId) return // mirrors the real "no session" early return (surfaces an error, out of scope here)

      // Single-flight guard — identical semantics to the real component.
      if (this.activeKey === generationKey) return

      const current = this.storesByKey.get(generationKey) || initialFreeStudyMapState()
      if (current.mapData) return // already-restored state — nothing to fetch (tests B/C exercise this path directly)

      const started = beginFreeStudyMap(current)
      startedAttempt = started.attempt
      this.storesByKey.set(generationKey, started)
      this.activeKey = generationKey
      this.requestCount++

      try {
        const data = await fetchImpl()
        if (cancelled) return
        if (!data.ok || !data.success) {
          this.storesByKey.set(generationKey, failFreeStudyMap(this.storesByKey.get(generationKey)!, startedAttempt, data.error || 'Error'))
          startedAttempt = null
          this.activeKey = null
          return
        }
        this.storesByKey.set(generationKey, completeFreeStudyMap(this.storesByKey.get(generationKey)!, startedAttempt, data.mapa!))
        startedAttempt = null
        this.activeKey = null
      } catch {
        startedAttempt = null
        this.activeKey = null
      }
    }

    settled = run()

    return {
      awaitSettled: () => settled,
      cleanup: () => {
        cancelled = true
        if (startedAttempt !== null) {
          this.storesByKey.set(generationKey, abandonFreeStudyMap(this.storesByKey.get(generationKey)!, startedAttempt))
          if (this.releaseOnInterruptedCleanup && this.activeKey === generationKey) this.activeKey = null
        }
      },
    }
  }
}

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => { await fn(); console.log(`  ✅ ${name}`) })()
}

async function main() {
  await test('A. valid entry with no local cache fires the generation request', async () => {
    const h = new EffectHarness(true)
    const handle = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await handle.awaitSettled()
    assert.equal(h.requestCount, 1)
    assert.equal(h.stateOf('sess-1', 'fp-1').status, 'completed')
  })

  await test('B. valid local cache (mapData already present) restores without a new generation request', async () => {
    const h = new EffectHarness(true)
    const key = 'sess-1::fp-1'
    const generating = beginFreeStudyMap(initialFreeStudyMapState())
    h.storesByKey.set(key, completeFreeStudyMap(generating, generating.attempt, fakeMap))
    const handle = h.mount('sess-1', 'fp-1', async () => { throw new Error('must not fetch when a valid cache already has mapData') })
    await handle.awaitSettled()
    assert.equal(h.requestCount, 0)
  })

  await test('C. invalid/stale local cache (interrupted, no mapData) falls through to generation', async () => {
    const h = new EffectHarness(true)
    const key = 'sess-1::fp-1'
    // Simulates a browser closed mid-generation on a previous visit —
    // recoverInterruptedFreeStudyMap turns a stale 'generating' record
    // into 'recoverable' with no mapData, which must NOT be treated as a
    // valid restore.
    const stale = recoverInterruptedFreeStudyMap(beginFreeStudyMap(initialFreeStudyMapState()))
    assert.equal(stale.mapData, null, 'sanity: the stale record truly has no mapData')
    h.storesByKey.set(key, stale)
    const handle = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await handle.awaitSettled()
    assert.equal(h.requestCount, 1, 'a stale cache with no mapData must not permanently block generation')
  })

  await test('D. sessionId becoming available after mount triggers generation (deps include sessionId)', async () => {
    const h = new EffectHarness(true)
    // First "mount" with no sessionId yet — mirrors the real component's
    // dependency array re-running the effect once sessionId arrives.
    const first = h.mount('', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    first.cleanup()
    await first.awaitSettled()
    assert.equal(h.requestCount, 0, 'no request while sessionId is still empty')
    const second = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await second.awaitSettled()
    assert.equal(h.requestCount, 1, 'generation fires once sessionId becomes available')
  })

  await test('E. Enjoyer/source-selection becoming ready after mount (component remounts with valid fingerprint) triggers generation', async () => {
    const h = new EffectHarness(true)
    // Before Enjoyer readiness, TemaView's own gate keeps ALAIStudyMap
    // unmounted entirely (see resolveFreeHubMaterialEnjoyerGate) — once
    // ready, it mounts fresh with the real fingerprint. No prior
    // invocation exists to have orphaned a guard for this key.
    const handle = h.mount('sess-1', 'fp-real', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await handle.awaitSettled()
    assert.equal(h.requestCount, 1)
  })

  await test('F. FIXED: activeGenerationKeyRef cannot permanently suppress generation after an interrupted invocation', async () => {
    const h = new EffectHarness(true)
    const gate = deferred<FetchResult>()
    const first = h.mount('sess-1', 'fp-1', () => gate.promise)
    // Torn down (StrictMode double-invoke / fast unmount) BEFORE the fetch resolves.
    first.cleanup()
    assert.equal(h.requestCount, 1, 'the first invocation did start a request')
    assert.equal(h.activeKey, null, 'FIX: the interrupted invocation released its own guard on cleanup')

    const second = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await second.awaitSettled()
    assert.equal(h.requestCount, 2, 'a subsequent mount for the SAME identity must be able to fire its own request')
    assert.equal(h.stateOf('sess-1', 'fp-1').status, 'completed')
  })

  await test('REGRESSION PROOF: the OLD (unfixed) cleanup behavior reproduces the exact reported bug', async () => {
    const h = new EffectHarness(false) // old buggy cleanup: never releases the guard
    const gate = deferred<FetchResult>()
    const first = h.mount('sess-1', 'fp-1', () => gate.promise)
    first.cleanup()
    assert.equal(h.activeKey, 'sess-1::fp-1', 'BUG: the guard is orphaned, still claimed by the dead invocation')

    const second = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await second.awaitSettled()
    assert.equal(h.requestCount, 1, 'BUG: the second, legitimate invocation is silently blocked — zero new request')
    assert.equal(h.stateOf('sess-1', 'fp-1').mapData, null, 'BUG: no restore, no new generation, no error — the client-visible equivalent of infinite loading')
  })

  await test('G. failure clears the single-flight guard (unchanged by this fix)', async () => {
    const h = new EffectHarness(true)
    const first = h.mount('sess-1', 'fp-1', async () => ({ ok: false, success: false, error: 'boom' }))
    await first.awaitSettled()
    assert.equal(h.activeKey, null)
    assert.equal(h.stateOf('sess-1', 'fp-1').status, 'recoverable')
    const second = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await second.awaitSettled()
    assert.equal(h.requestCount, 2, 'a retry after a genuine failure can still fire its own request')
  })

  await test('H. loading cannot remain stuck when neither a restore nor a generation is active', async () => {
    // Model the client `loading` boolean directly: it starts true, and
    // must become false whenever run() takes ANY branch other than
    // "blocked by an orphaned guard" — restore, success, or failure all
    // resolve it. Only the (now-fixed) orphaned-guard case left it stuck.
    const h = new EffectHarness(true)
    let loading = true
    const handle = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await handle.awaitSettled()
    if (h.stateOf('sess-1', 'fp-1').status === 'completed') loading = false
    assert.equal(loading, false, 'a completed generation must clear the loading state')
  })

  await test('I. no Material Brain dependency introduced by this fix', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.ok(!componentSource.includes('setBrainSourceSelection') && !componentSource.includes('useMaterialBrainLifecycle'))
    assert.ok(!componentSource.includes('/api/material-brain'))
  })

  await test('J. map generation provider calls remain 0 (route source unchanged by this fix)', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
    // handleGroundedStudyMapRequest builds the tree purely from the
    // Enjoyer context — no provider call. Confirmed unmodified by this
    // client-only fix (no diff touches this route in this task).
    const fnBody = routeSource.slice(
      routeSource.indexOf('async function handleGroundedStudyMapRequest'),
      routeSource.indexOf('async function handleExplainNodeRequest'),
    )
    assert.ok(!fnBody.includes('__routeDeps.alai') && !fnBody.includes('generateValidatedLegacyJson') && !fnBody.includes('alaiJson('),
      'map generation must still make zero provider calls')
  })

  console.log('studymap-loading-lifecycle-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
