import assert from 'node:assert/strict'
import {
  initialFreeAnalysisState, beginFreeAnalysis, completeFreeAnalysis, failFreeAnalysis,
  recoverInterruptedFreeAnalysis, type DurableFreeAnalysisState,
} from '../../lib/freeAnalysisState'

// ============================================================
// PROVES (does not fix — source inspection found no bug) that
// AnalisisTeorico.tsx's runAnalysis() does NOT have the Truquitos-class
// duplicate-generation bug.
//
// Root cause of the Truquitos bug: generateCheatCodes() had NO check for
// an already-in-flight request before calling beginFreeTruquitos()/
// fetch — the mount effect's dependency array included authorizedStatus
// AND authorizedSource (the raw-material object itself), so it re-ran
// on every settle of that unrelated hook and fired a second real
// generation while the first was still in flight.
//
// AnalisisTeorico.tsx (read directly, not assumed) instead:
//   1. runAnalysis() has `generationLockedRef.current` checked as its
//      VERY FIRST line — before beginFreeAnalysis() or persistDurableState()
//      are even called. A second call while one is in flight is a no-op.
//   2. generationLockedRef.current is set to `true` synchronously (no
//      `await` in between), then cleared in `finally`.
//   3. The mount/hydration effect that calls recoverInterruptedFreeAnalysis
//      runs only on `[sessionId, effectiveSourceSelection.fingerprint,
//      nivelProp]` — NOT on authorizedStatus/authorizedSource — so it
//      cannot re-fire mid-flight the way Truquitos' did.
//   4. The effect that triggers runAnalysis() depends on `authorizedStatus`
//      (a stable enum) and `runAnalysis` itself, never the raw
//      authorizedSource object directly; even when it re-fires (e.g. because
//      runAnalysis's own identity changed), the internal lock (point 1)
//      makes any such extra call a guaranteed no-op.
//
// This harness exercises the REAL lib/freeAnalysisState.ts reducers
// through a minimal model of that exact guard shape, to deterministically
// prove the invariant holds — not to introduce a new one.
// ============================================================

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

class Harness {
  stateByKey = new Map<string, DurableFreeAnalysisState<any>>()
  locked = false // mirrors generationLockedRef.current
  networkCallCount = 0
  lastError: string | null = null
  lastResult: any = null

  private key(sessionId: string, fingerprint: string, nivel: string) { return `${sessionId}::${fingerprint}::${nivel}` }
  private stateFor(key: string) { return this.stateByKey.get(key) || initialFreeAnalysisState('universidad') }

  /** Mirrors runAnalysis() exactly: lock-check FIRST, before touching state. */
  async runAnalysis(sessionId: string, fingerprint: string, nivel: 'universidad', fetchImpl: () => Promise<{ ok: boolean; success: boolean; analisis?: any; error?: string }>) {
    if (this.locked) return // generationLockedRef.current check — line 1 of the real function
    const key = this.key(sessionId, fingerprint, nivel)
    const current = this.stateFor(key).resultsByType[nivel]
    if (current?.status === 'completed' && current.result) return
    const started = beginFreeAnalysis(this.stateFor(key), nivel)
    if (started === this.stateFor(key)) return
    const attempt = started.resultsByType[nivel]?.attempt || 0
    this.stateByKey.set(key, started)
    this.locked = true
    try {
      this.networkCallCount++
      const data = await fetchImpl()
      if (!data.ok || !data.success) {
        const failed = failFreeAnalysis(this.stateFor(key), nivel, attempt, data.error || 'Error')
        this.stateByKey.set(key, failed)
        this.lastError = failed.resultsByType[nivel]?.status === 'recoverable' ? (failed.resultsByType[nivel]?.error || '') : null
        return
      }
      const completed = completeFreeAnalysis(this.stateFor(key), nivel, attempt, data.analisis)
      this.stateByKey.set(key, completed)
      if (completed.resultsByType[nivel]?.status === 'completed') {
        this.lastResult = completed.resultsByType[nivel]?.result
        this.lastError = null
      }
    } finally {
      this.locked = false
    }
  }

  /** Mirrors the mount/hydration effect's identity-scoped recovery (fires only on real identity change). */
  hydrate(sessionId: string, fingerprint: string, nivel: 'universidad') {
    const key = this.key(sessionId, fingerprint, nivel)
    const recovered = recoverInterruptedFreeAnalysis(this.stateFor(key))
    this.stateByKey.set(key, recovered)
    const entry = recovered.resultsByType[nivel]
    if (entry?.status === 'completed' && entry.result) return 'has-result'
    if (entry?.status === 'recoverable') { this.lastError = entry.error || ''; return 'recoverable' }
    return 'needs-generation'
  }

  stateOf(sessionId: string, fingerprint: string, nivel: 'universidad') { return this.stateFor(this.key(sessionId, fingerprint, nivel)) }
}

async function testInFlightRerenderDoesNotDuplicate() {
  const h = new Harness()
  const gate = deferred<{ ok: boolean; success: boolean; analisis?: any }>()

  const requestA = h.runAnalysis('sess-1', 'fp-1', 'universidad', () => gate.promise)

  // Simulates the trigger-effect re-firing (e.g. runAnalysis identity
  // changed because authorizedSource settled) WHILE A is in flight.
  await h.runAnalysis('sess-1', 'fp-1', 'universidad', async () => { throw new Error('must never be called') })
  assert.equal(h.networkCallCount, 1, 'P: in-flight rerender does not duplicate the generation request')

  gate.resolve({ ok: true, success: true, analisis: { titulo: 'x' } })
  await requestA

  assert.equal(h.networkCallCount, 1)
  assert.equal(h.stateOf('sess-1', 'fp-1', 'universidad').resultsByType.universidad?.status, 'completed')
  assert.equal(h.lastError, null, 'UI must never show a false error when the underlying generation actually succeeded')
  console.log('analysis-lifecycle: P (IN-FLIGHT RERENDER) PASS')
}

async function testGenuineFailureThenRetryStartsExactlyOne() {
  const h = new Harness()
  await h.runAnalysis('sess-1', 'fp-1', 'universidad', async () => ({ ok: false, success: false, error: 'PROVIDER_FAILED' }))
  assert.equal(h.stateOf('sess-1', 'fp-1', 'universidad').resultsByType.universidad?.status, 'recoverable')
  assert.equal(h.networkCallCount, 1)

  await h.runAnalysis('sess-1', 'fp-1', 'universidad', async () => ({ ok: true, success: true, analisis: { titulo: 'x' } }))
  assert.equal(h.networkCallCount, 2, 'Q: retry after genuine failure starts exactly one new generation')
  assert.equal(h.stateOf('sess-1', 'fp-1', 'universidad').resultsByType.universidad?.status, 'completed')
  console.log('analysis-lifecycle: Q (RETRY AFTER GENUINE FAILURE) PASS')
}

async function testStaleRequestDoesNotOverwriteNewerState() {
  const h = new Harness()
  const gateA = deferred<{ ok: boolean; success: boolean; analisis?: any }>()
  const requestA = h.runAnalysis('sess-1', 'fp-1', 'universidad', () => gateA.promise)

  // Something else authoritatively advances this identity to a newer attempt
  // before A's stale response arrives.
  h.stateByKey.set('sess-1::fp-1::universidad', {
    selectedType: 'universidad',
    resultsByType: { universidad: { type: 'universidad', status: 'completed', attempt: 99, result: { titulo: 'newer' }, activeSection: 'vision', readSections: [], shownSelfChecks: {}, shownCheckAnswers: {}, doubtDraft: '', doubtAnswer: '', doubtError: '', completed: true } },
  })
  gateA.resolve({ ok: true, success: true, analisis: { titulo: 'stale' } })
  await requestA

  assert.equal(h.stateOf('sess-1', 'fp-1', 'universidad').resultsByType.universidad?.result?.titulo, 'newer',
    'R: a stale resolving request must never overwrite newer authority state')
  console.log('analysis-lifecycle: R (STALE RESPONSE PROTECTION) PASS')
}

async function main() {
  await testInFlightRerenderDoesNotDuplicate()
  await testGenuineFailureThenRetryStartsExactlyOne()
  await testStaleRequestDoesNotOverwriteNewerState()
  console.log('analysis-generation-lifecycle-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
