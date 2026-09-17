import assert from 'node:assert/strict'
import {
  initialFreeStudyMapState, beginFreeStudyMap, completeFreeStudyMap, failFreeStudyMap,
  type DurableFreeStudyMapState, type StudyMapData,
} from '../../lib/freeStudyMapState'

// ============================================================
// Study Map audit finding (proven from source, not assumed): the
// mount/regeneration effect in ALAIStudyMap.tsx had the SAME root cause
// as the Truquitos bug — its dependency array includes authorizedStatus/
// authorizedSource (fetched only for the unrelated "explain node"
// feature), and unlike Análisis's runAnalysis() (which checks
// generationLockedRef.current as its literal first line), this effect
// had NO check for an already-in-flight request before calling
// beginFreeStudyMap()/fetch. beginFreeStudyMap() no-ops (returns the
// same state) when already 'generating', but the caller never checked
// for that no-op, so a re-run fired a second real POST
// /api/alai-studyal-map.
//
// Severity note: unlike Truquitos, Study Map's grounded path makes ZERO
// provider calls to build the map itself (fully deterministic), so this
// was a duplicate-network-request/redundant-server-work bug, not a
// wasted-provider-cost bug — but the same class of issue, fixed with the
// same class of remedy: an `activeGenerationKeyRef` single-flight guard
// keyed by `${sessionId}::${fingerprint}`, checked as the first thing in
// the effect's run(), set right before the fetch, and cleared at every
// terminal branch (enrichment/fail/success).
//
// This harness exercises the REAL lib/freeStudyMapState.ts reducers
// through a minimal model of that exact guard shape.
// ============================================================

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

const fakeMap: StudyMapData = { title: 't', root: { id: 'root', label: 't', type: 'root' } }

class Harness {
  stateByKey = new Map<string, DurableFreeStudyMapState>()
  activeKey: string | null = null // mirrors activeGenerationKeyRef.current
  networkCallCount = 0

  private key(sessionId: string, fingerprint: string) { return `${sessionId}::${fingerprint}` }
  private stateFor(key: string) { return this.stateByKey.get(key) || initialFreeStudyMapState() }

  /** Mirrors the FIXED run() exactly: single-flight guard first, then acquire/release around the fetch. */
  async run(sessionId: string, fingerprint: string, fetchImpl: () => Promise<{ ok: boolean; success: boolean; mapa?: StudyMapData; error?: string }>) {
    const key = this.key(sessionId, fingerprint)
    if (this.activeKey === key) return // single-flight guard — the fix

    const state = this.stateFor(key)
    if (state.mapData) return // already have a result, nothing to do

    const started = beginFreeStudyMap(state)
    const attempt = started.attempt
    this.stateByKey.set(key, started)
    this.activeKey = key
    try {
      this.networkCallCount++
      const data = await fetchImpl()
      if (!data.ok || !data.success) {
        this.stateByKey.set(key, failFreeStudyMap(this.stateFor(key), attempt, data.error || 'Error'))
        return
      }
      this.stateByKey.set(key, completeFreeStudyMap(this.stateFor(key), attempt, data.mapa!))
    } finally {
      if (this.activeKey === key) this.activeKey = null
    }
  }

  stateOf(sessionId: string, fingerprint: string) { return this.stateFor(this.key(sessionId, fingerprint)) }
}

async function testInFlightRerenderDoesNotDuplicate() {
  const h = new Harness()
  const gate = deferred<{ ok: boolean; success: boolean; mapa?: StudyMapData }>()

  const requestA = h.run('sess-1', 'fp-1', () => gate.promise)

  // The effect re-fires (authorizedSource/authorizedStatus settling)
  // WHILE A is still in flight — this is exactly what caused the
  // duplicate POST /api/alai-studyal-map before the fix.
  await h.run('sess-1', 'fp-1', async () => { throw new Error('must never be called') })
  assert.equal(h.networkCallCount, 1, 'M: in-flight rerender does not duplicate the map-build request')

  gate.resolve({ ok: true, success: true, mapa: fakeMap })
  await requestA

  assert.equal(h.networkCallCount, 1)
  assert.equal(h.stateOf('sess-1', 'fp-1').status, 'completed')
  console.log('studymap-single-flight: M (IN-FLIGHT RERENDER) PASS')
}

async function testRetryAfterGenuineFailure() {
  const h = new Harness()
  await h.run('sess-1', 'fp-1', async () => ({ ok: false, success: false, error: 'BUILD_FAILED' }))
  assert.equal(h.stateOf('sess-1', 'fp-1').status, 'recoverable')
  assert.equal(h.networkCallCount, 1)

  await h.run('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
  assert.equal(h.networkCallCount, 2, 'retry after a genuine failure starts exactly one new request')
  assert.equal(h.stateOf('sess-1', 'fp-1').status, 'completed')
  console.log('studymap-single-flight: RETRY AFTER GENUINE FAILURE PASS')
}

async function testReopenWithPersistedResultZeroCalls() {
  const h = new Harness()
  await h.run('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
  const before = h.networkCallCount
  await h.run('sess-1', 'fp-1', async () => { throw new Error('must never be called') })
  assert.equal(h.networkCallCount, before, 'L: reopen with a persisted result makes 0 additional requests')
  console.log('studymap-single-flight: REOPEN WITH PERSISTED RESULT PASS (0 calls)')
}

async function main() {
  await testInFlightRerenderDoesNotDuplicate()
  await testRetryAfterGenuineFailure()
  await testReopenWithPersistedResultZeroCalls()
  console.log('studymap-generation-single-flight-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
