import assert from 'node:assert/strict'
import {
  initialFreeTruquitosState, beginFreeTruquitos, completeFreeTruquitos, failFreeTruquitos,
  recoverInterruptedFreeTruquitos, type DurableFreeTruquitosState, type TruquitosCard,
} from '../../lib/freeTruquitosState'

// ============================================================
// Faithfully mirrors the FIXED control flow now in
// components/materias/ALAIStudyALCheatCodes.tsx:
//   - generateCheatCodes(): guarded at entry by
//     inFlightGenerationKeyRef, keyed by `${sessionId}::${fingerprint}`,
//     cleared in `finally`.
//   - the mount/hydration effect (`run`): bails out immediately if a
//     generation is already in flight for the exact same identity,
//     instead of re-reading persisted state through
//     recoverInterruptedFreeTruquitos() (which — before the fix —
//     misclassified a live in-flight 'generating' status as
//     "interrupted", producing the false "no se pudo generar" error
//     and, on Retry, a second fully duplicate provider generation).
// This is a logic-level harness (no React/jsdom in this repo's test
// stack) — it exercises the REAL freeTruquitosState.ts reducer
// functions, with the exact same guard placement and key shape as the
// component, deterministically driving the async interleaving that
// caused the live bug.
// ============================================================

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: any) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void, reject!: (e: any) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function card(id: string): TruquitosCard {
  return { id, type: 'cheat_code', title: `T-${id}`, content: `contenido ${id}`, targetIds: [`unit:${id}`] }
}

class Harness {
  // Keyed by identity — mirrors readFreeToolState/writeFreeToolState's real
  // storage, which is scoped per (sessionId, fingerprint, tool), never a
  // single shared bucket across identities.
  stateByKey = new Map<string, DurableFreeTruquitosState>()
  inFlightKey: string | null = null
  networkCallCount = 0
  lastError = ''
  lastCards: TruquitosCard[] = []

  private key(sessionId: string, fingerprint: string) { return `${sessionId}::${fingerprint}` }
  private stateFor(key: string) { return this.stateByKey.get(key) || initialFreeTruquitosState() }

  /** Mirrors generateCheatCodes() exactly (single-flight guard + finally cleanup). */
  async generate(sessionId: string, fingerprint: string, fetchImpl: () => Promise<{ ok: boolean; success: boolean; cards?: TruquitosCard[]; error?: string }>) {
    const generationKey = this.key(sessionId, fingerprint)
    if (this.inFlightKey === generationKey) return // single-flight guard
    this.inFlightKey = generationKey

    const started = beginFreeTruquitos(this.stateFor(generationKey))
    const attempt = started.attempt
    this.stateByKey.set(generationKey, started)

    try {
      this.networkCallCount++
      const data = await fetchImpl()
      if (!data.ok || !data.success) {
        const failed = failFreeTruquitos(this.stateFor(generationKey), attempt, data.error || 'Error')
        this.stateByKey.set(generationKey, failed)
        this.lastError = failed.status === 'recoverable' ? (failed.error || '') : ''
        return
      }
      const completed = completeFreeTruquitos(this.stateFor(generationKey), attempt, data.cards || [])
      this.stateByKey.set(generationKey, completed)
      if (completed.status === 'completed') {
        this.lastCards = completed.cards
        this.lastError = ''
      }
    } finally {
      if (this.inFlightKey === generationKey) this.inFlightKey = null
    }
  }

  /** Mirrors the mount/hydration effect's guard (bail if same identity already in flight). */
  hydrate(sessionId: string, fingerprint: string) {
    const key = this.key(sessionId, fingerprint)
    if (this.inFlightKey === key) return 'skipped-in-flight'
    const state = this.stateFor(key)
    if ((state.cards || []).length > 0) return 'has-cards'
    const recovered = recoverInterruptedFreeTruquitos(state)
    this.stateByKey.set(key, recovered)
    if (recovered.status === 'recoverable') {
      this.lastError = recovered.error || ''
      return 'recoverable'
    }
    return 'needs-generation'
  }

  stateOf(sessionId: string, fingerprint: string) { return this.stateFor(this.key(sessionId, fingerprint)) }
}

async function testFirstOpenSingleCall() {
  const h = new Harness()
  await h.generate('sess-1', 'fp-1', async () => ({ ok: true, success: true, cards: [card('a')] }))
  assert.equal(h.networkCallCount, 1, 'FIRST OPEN: exactly 1 cards generation request')
  assert.equal(h.stateOf('sess-1', 'fp-1').status, 'completed')
  assert.equal(h.lastCards.length, 1)
  console.log('single-flight: FIRST OPEN PASS (1 call)')
}

async function testReopenWithPersistedResultZeroCalls() {
  const h = new Harness()
  await h.generate('sess-1', 'fp-1', async () => ({ ok: true, success: true, cards: [card('a')] }))
  const before = h.networkCallCount
  const outcome = h.hydrate('sess-1', 'fp-1')
  assert.equal(outcome, 'has-cards')
  assert.equal(h.networkCallCount, before, 'REOPEN: 0 additional generation requests when cards already persisted')
  console.log('single-flight: REOPEN WITH PERSISTED RESULT PASS (0 calls)')
}

/** THE core regression: reproduces the exact live bug shape. */
async function testInFlightRerenderDoesNotDuplicateAndNeverShowsFalseError() {
  const h = new Harness()
  const gate = deferred<{ ok: boolean; success: boolean; cards?: TruquitosCard[] }>()

  // Request A starts (e.g. from the mount effect's first run) and is still in flight.
  const requestA = h.generate('sess-1', 'fp-1', () => gate.promise)

  // The effect re-runs (authorizedStatus/authorizedSource settling) WHILE A is
  // still in flight — this is exactly what triggered the live duplicate.
  const hydrateOutcome = h.hydrate('sess-1', 'fp-1')
  assert.equal(hydrateOutcome, 'skipped-in-flight', 'effect re-run must skip re-deriving state while A is in flight')
  assert.notEqual(h.stateOf('sess-1', 'fp-1').status, 'recoverable', 'must NOT misclassify the live in-flight request as interrupted/failed')

  // A second automatic generation attempt (what the old code fired next) must be a no-op.
  const requestB = h.generate('sess-1', 'fp-1', async () => { throw new Error('B should never actually call fetch') })
  await requestB
  assert.equal(h.networkCallCount, 1, 'IN-FLIGHT RERENDER: still only 1 network call made so far')

  // A now succeeds.
  gate.resolve({ ok: true, success: true, cards: [card('a')] })
  await requestA

  assert.equal(h.networkCallCount, 1, 'exactly 1 provider-triggering request total for this open')
  assert.equal(h.stateOf('sess-1', 'fp-1').status, 'completed', 'UI must reflect success')
  assert.equal(h.lastError, '', 'UI must NEVER show "no se pudo generar" when the underlying generation actually succeeded')
  assert.equal(h.lastCards.length, 1)
  console.log('single-flight: IN-FLIGHT RERENDER PASS (0 duplicate calls, no false error)')
}

async function testSessionIdTransitionAllowsNewIdentityButNotDuplicate() {
  const h = new Harness()
  const gateA = deferred<{ ok: boolean; success: boolean; cards?: TruquitosCard[] }>()
  const requestA = h.generate('sess-1', 'fp-old', () => gateA.promise)

  // Identity changes (e.g. session/fingerprint actually changed) — a NEW
  // identity's hydration must NOT be blocked by the old identity's in-flight guard.
  const hydrateOutcome = h.hydrate('sess-2', 'fp-new')
  assert.equal(hydrateOutcome, 'needs-generation', 'a genuinely different identity is not blocked by another identity in flight')

  gateA.resolve({ ok: true, success: true, cards: [card('a')] })
  await requestA
  console.log('single-flight: SESSION/FINGERPRINT TRANSITION PASS')
}

async function testStaleResponseDoesNotOverwriteNewerState() {
  const h = new Harness()
  const gateA = deferred<{ ok: boolean; success: boolean; cards?: TruquitosCard[] }>()
  // A starts for sess-1/fp-1 and suspends at the fetch await.
  const requestA = h.generate('sess-1', 'fp-1', () => gateA.promise)

  // Meanwhile, something else authoritatively advances this identity's
  // persisted state to a newer attempt (e.g. a completed generation from
  // another tab, or — pre-fix — a duplicate request that already
  // completed). A's own `attempt` token was captured before this happened.
  h.stateByKey.set('sess-1::fp-1', { ...initialFreeTruquitosState(), status: 'completed', cards: [card('newer')], attempt: 99 })

  gateA.resolve({ ok: true, success: true, cards: [card('a')] })
  await requestA
  // completeFreeTruquitos() only applies when state.attempt matches the
  // request's own started attempt — A's stale attempt number must not match
  // the newer state's attempt, so the newer state survives untouched.
  assert.deepEqual(h.stateOf('sess-1', 'fp-1').cards.map(c => c.id), ['newer'], 'a stale resolving request must never overwrite newer state')
  console.log('single-flight: STALE RESPONSE PROTECTION PASS')
}

async function testRetryAfterRealFailure() {
  const h = new Harness()
  await h.generate('sess-1', 'fp-1', async () => ({ ok: false, success: false, error: 'PROVIDER_FAILED' }))
  assert.equal(h.stateOf('sess-1', 'fp-1').status, 'recoverable')
  assert.equal(h.networkCallCount, 1)

  await h.generate('sess-1', 'fp-1', async () => ({ ok: true, success: true, cards: [card('a')] }))
  assert.equal(h.networkCallCount, 2, 'RETRY AFTER REAL FAILURE: exactly 1 new generation request')
  assert.equal(h.stateOf('sess-1', 'fp-1').status, 'completed')
  console.log('single-flight: RETRY AFTER REAL FAILURE PASS')
}

async function testRetryWhileInFlightIsNoOp() {
  const h = new Harness()
  const gate = deferred<{ ok: boolean; success: boolean; cards?: TruquitosCard[] }>()
  const requestA = h.generate('sess-1', 'fp-1', () => gate.promise)

  // User mashes Retry while A is still in flight.
  await h.generate('sess-1', 'fp-1', async () => { throw new Error('must never be called') })
  await h.generate('sess-1', 'fp-1', async () => { throw new Error('must never be called') })
  assert.equal(h.networkCallCount, 1, 'RETRY WHILE IN FLIGHT: 0 additional generation requests')

  gate.resolve({ ok: true, success: true, cards: [card('a')] })
  await requestA
  assert.equal(h.networkCallCount, 1)
  console.log('single-flight: RETRY WHILE IN FLIGHT PASS (0 additional calls)')
}

async function main() {
  await testFirstOpenSingleCall()
  await testReopenWithPersistedResultZeroCalls()
  await testInFlightRerenderDoesNotDuplicateAndNeverShowsFalseError()
  await testSessionIdTransitionAllowsNewIdentityButNotDuplicate()
  await testStaleResponseDoesNotOverwriteNewerState()
  await testRetryAfterRealFailure()
  await testRetryWhileInFlightIsNoOp()
  console.log('truquitos-generation-single-flight-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
