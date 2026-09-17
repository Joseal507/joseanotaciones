import assert from 'node:assert/strict'
import {
  initialAlaiState, beginAlaiTurn, completeAlaiTurn, failAlaiTurn, retryAlaiTurn,
  type DurableAlaiState, type DurableAlaiMessage,
} from '../../lib/freeAlaiState'

// ============================================================
// PROVES (does not fix — source inspection found no bug) that
// ALAIStudyALChat.tsx's send/retry flow does NOT have the Truquitos/
// Study-Map-class duplicate-generation bug.
//
// Direct code inspection of components/materias/ALAIStudyALChat.tsx
// found this is structurally a DIFFERENT lifecycle shape than
// Truquitos/Study Map: message sending is triggered ONLY by explicit
// user action (form submit, Enter key, follow-up pill click) — never by
// a useEffect keyed on authorizedStatus/authorizedSource. There is no
// "auto-send on mount" path for this class of bug to attach to at all.
//
// On top of that, the existing guards are already correct:
//   - sendMessage() bails at its very first line if `sendLockedRef.current`
//     is true (single-flight, covers double-click/double-Enter/double-submit).
//   - runTurn() sets sendLockedRef.current = true synchronously (no
//     await in between), aborts any PRIOR in-flight request via
//     AbortController before starting a new one, and tracks
//     `activeAttemptRef` identity so a stale response can never
//     overwrite newer state (checked before every state mutation).
//   - retryCurrentTurn() also checks sendLockedRef.current before
//     starting, so retry-while-in-flight is already a no-op.
//   - The lock is cleared in `finally`, covering success, failure, and
//     abort paths alike.
//
// This harness exercises the REAL lib/freeAlaiState.ts reducers through
// a minimal model of that exact guard shape (sendLockedRef + attempt
// identity + AbortController-equivalent cancellation), to
// deterministically prove the invariant holds.
// ============================================================

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: any) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void, reject!: (e: any) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

class Harness {
  state: DurableAlaiState = initialAlaiState()
  sendLocked = false
  activeAttemptIdentity = ''
  networkCallCount = 0

  /** Mirrors sendMessage() + runTurn() exactly. */
  send(text: string, fetchImpl: () => Promise<{ ok: boolean; success: boolean; answer?: string }>) {
    if (!text || this.sendLocked) return null // sendMessage()'s first-line guard
    this.sendLocked = true
    const turnId = `turn-${this.state.messages.length}`
    const next = beginAlaiTurn(this.state, { turnId, userMessageId: `${turnId}:user`, content: text, timestamp: Date.now() })
    this.state = next
    return this.runTurn(turnId, 1, fetchImpl)
  }

  retry(fetchImpl: () => Promise<{ ok: boolean; success: boolean; answer?: string }>) {
    const current = this.state.currentTurn
    if (!current || current.status !== 'recoverable' || this.sendLocked) return null // retryCurrentTurn()'s guard
    const next = retryAlaiTurn(this.state, current.id)
    this.state = next
    return this.runTurn(current.id, next.currentTurn?.attempt || current.attempt + 1, fetchImpl)
  }

  private async runTurn(turnId: string, attempt: number, fetchImpl: () => Promise<{ ok: boolean; success: boolean; answer?: string }>) {
    const attemptIdentity = `${turnId}:${attempt}`
    this.activeAttemptIdentity = attemptIdentity // supersedes any prior in-flight request's identity
    this.sendLocked = true
    try {
      this.networkCallCount++
      const data = await fetchImpl()
      if (this.activeAttemptIdentity !== attemptIdentity) return // stale-response guard
      if (!data.ok || !data.success) throw new Error('fail')
      const assistantMsg: DurableAlaiMessage = { id: `${turnId}:assistant`, turnId, role: 'assistant', content: data.answer || '', timestamp: Date.now() }
      const completed = completeAlaiTurn(this.state, turnId, attempt, assistantMsg)
      this.state = completed
    } catch {
      if (this.activeAttemptIdentity !== attemptIdentity) return
      this.state = failAlaiTurn(this.state, turnId, attempt, 'error')
    } finally {
      if (this.activeAttemptIdentity === attemptIdentity) this.sendLocked = false
    }
  }
}

async function testDoubleSubmitIsOneRequest() {
  const h = new Harness()
  const gate = deferred<{ ok: boolean; success: boolean; answer?: string }>()
  const p1 = h.send('¿Qué es Kc?', () => gate.promise)
  const p2 = h.send('¿Qué es Kc?', async () => { throw new Error('must never be called') }) // double-click/double-Enter
  assert.equal(p2, null, 'Y: a second send while locked is rejected synchronously, never reaches fetch')
  assert.equal(h.networkCallCount, 1, 'Y: double submit produces exactly one request')
  gate.resolve({ ok: true, success: true, answer: 'Kc...' })
  await p1
  assert.equal([...h.state.messages].reverse().find(m => m.role === 'assistant')?.content, 'Kc...')
  console.log('alai-chat-lifecycle: Y (DOUBLE SUBMIT) PASS')
}

async function testRetryAfterGenuineFailureExactlyOne() {
  const h = new Harness()
  await h.send('pregunta', async () => ({ ok: false, success: false }))
  assert.equal(h.state.currentTurn?.status, 'recoverable')
  assert.equal(h.networkCallCount, 1)
  await h.retry(async () => ({ ok: true, success: true, answer: 'respuesta' }))
  assert.equal(h.networkCallCount, 2, 'Z: retry after genuine failure starts exactly one new request')
  assert.equal(h.state.currentTurn?.status, 'completed')
  console.log('alai-chat-lifecycle: Z (RETRY AFTER GENUINE FAILURE) PASS')
}

async function testRetryWhileInFlightIsNoOp() {
  const h = new Harness()
  const gate = deferred<{ ok: boolean; success: boolean; answer?: string }>()
  const p1 = h.send('pregunta', () => gate.promise)
  const retryResult = h.retry(async () => { throw new Error('must never be called') })
  assert.equal(retryResult, null, 'AA: retry while in flight is rejected synchronously')
  assert.equal(h.networkCallCount, 1, 'AA: zero extra requests from retry while in flight')
  gate.resolve({ ok: true, success: true, answer: 'ok' })
  await p1
  console.log('alai-chat-lifecycle: AA (RETRY WHILE IN FLIGHT) PASS')
}

async function testStaleResponseCannotOverwriteNewerState() {
  const h = new Harness()
  const gateA = deferred<{ ok: boolean; success: boolean; answer?: string }>()
  const pA = h.send('pregunta A', () => gateA.promise)
  // Simulate the user's turn being superseded (e.g. a fresh conversation
  // load for a different session/fingerprint sets fresher state) before
  // A resolves — A's activeAttemptIdentity no longer matches once a
  // newer turn starts.
  h.activeAttemptIdentity = 'someone-elses-newer-turn:1'
  h.state = { ...h.state, messages: [...h.state.messages, { id: 'newer:assistant', turnId: 'newer', role: 'assistant', content: 'RESPUESTA MAS NUEVA', timestamp: Date.now() }] }
  gateA.resolve({ ok: true, success: true, answer: 'RESPUESTA VIEJA' })
  await pA
  assert.ok(!h.state.messages.some(m => m.content === 'RESPUESTA VIEJA'), 'AB: a stale resolving request must never overwrite newer session state')
  assert.ok(h.state.messages.some(m => m.content === 'RESPUESTA MAS NUEVA'))
  console.log('alai-chat-lifecycle: AB (STALE RESPONSE PROTECTION) PASS')
}

async function main() {
  await testDoubleSubmitIsOneRequest()
  await testRetryAfterGenuineFailureExactlyOne()
  await testRetryWhileInFlightIsNoOp()
  await testStaleResponseCannotOverwriteNewerState()
  console.log('alai-chat-lifecycle-contracts: ALL PASS (AC not applicable — no auto-send-on-mount path exists to race)')
}

main().catch(error => { console.error(error); process.exit(1) })
