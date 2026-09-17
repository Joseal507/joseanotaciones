import assert from 'node:assert/strict'
import { resolveMaterialPreparationGate } from '../../components/materias/MaterialPreparationScreen'
import { canUseFreeTool, resolveMaterialCapabilities, type FreeTool, type MaterialCapabilities } from '../../lib/materialBrain/capabilities'

// ============================================================
// P0 — Free Mode tool readiness gate. Closes the reported bug: a user
// could open Flashcards (or any tool) while brainStatus had already
// flipped to 'ready' (SOURCE represented) but the tool's OWN capability
// (units/full enrichment) was still false — the tool's component then
// polled its generation endpoint repeatedly (POST /api/flashcards-v2
// 202, 202, 202...) as its de-facto readiness mechanism.
//
// Fix is a policy-level change to the EXISTING single canonical gate
// (`resolveMaterialPreparationGate`) and the EXISTING single canonical
// capability model (`resolveMaterialCapabilities` / `canUseFreeTool`)
// — no new state machine, no per-tool boolean invented. `vista` in
// app/materias/page.tsx already IS the persisted "which tool the user
// wants" — the gate now recomputes reactively as capabilities arrive,
// which is what gives auto-continue for free, with no extra
// pendingToolIntent plumbing.
//
// These are pure-function policy tests (no DOM, no fetch, no React) —
// the same testing shape MaterialPreparationScreen.tsx documents for
// itself. `material-brain-lifecycle-contracts.ts` already covers the
// hook's own fingerprint-reset/polling behavior in detail — not
// duplicated here.
// ============================================================

function caps(overrides: Partial<MaterialCapabilities> = {}): MaterialCapabilities {
  return {
    sourceReady: true, unitsReady: true, relationsReady: true, visionReady: true, richCoveragePercent: 100,
    examReady: true, alaiChatReady: true, repasarReady: true, flashcardsReady: true, quizReady: true,
    analysisReady: true, studyMapReady: true, truquitosReady: true,
    ...overrides,
  }
}

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── Free Mode tool readiness gate contracts ──\n')

test('TOOL-READY-1: hub (no active tool) renders even while Brain source is not yet ready-complete, as long as there IS a selection — generic browse never gates on tool capability', () => {
  const gate = resolveMaterialPreparationGate('ready', true, null, caps())
  assert.equal(gate.shouldGate, false, 'a null tool (hub/browse) never gates on a tool-specific capability')
})

test('TOOL-READY-2: brainStatus ready but flashcardsReady=false -> gate stays open (waiting), never a technical error', () => {
  const gate = resolveMaterialPreparationGate('ready', true, 'flashcards', caps({ flashcardsReady: false }))
  assert.equal(gate.shouldGate, true)
  assert.equal(gate.mode, 'preparing', 'this must read as ongoing preparation, never "failed" — real generation was never attempted, so 0 POST calls are ever made from a component that never mounts')
})

test('TOOL-READY-3 (auto-continue): once flashcardsReady flips true, the SAME gate call (same brainStatus) recomputes to open — proves the reactive re-render is sufficient, no extra event/state needed', () => {
  const before = resolveMaterialPreparationGate('ready', true, 'flashcards', caps({ flashcardsReady: false }))
  const after = resolveMaterialPreparationGate('ready', true, 'flashcards', caps({ flashcardsReady: true }))
  assert.equal(before.shouldGate, true)
  assert.equal(after.shouldGate, false, 'the exact same inputs except the capability flag must flip the tool open with no other state involved')
})

test('TOOL-READY-4: a fresh capabilities object (as the lifecycle hook resets to on fingerprint change) reads as not-ready, cancelling any illusion of a stale unlock', () => {
  const gate = resolveMaterialPreparationGate('ready', true, 'flashcards', null)
  assert.equal(gate.shouldGate, true, 'null capabilities (post fingerprint-change reset) must never be treated as ready')
})

for (const [tool, key] of [
  ['quiz', 'quizReady'], ['repasar', 'repasarReady'], ['exam', 'examReady'],
  ['studyMap', 'studyMapReady'], ['truquitos', 'truquitosReady'], ['analisis', 'analysisReady'],
] as [FreeTool, keyof MaterialCapabilities][]) {
  test(`TOOL-READY (matrix): ${tool} gates on exactly ${key}, no other flag`, () => {
    const notReady = resolveMaterialPreparationGate('ready', true, tool, caps({ [key]: false } as any))
    const ready = resolveMaterialPreparationGate('ready', true, tool, caps({ [key]: true } as any))
    assert.equal(notReady.shouldGate, true, `${tool} must gate when ${key}=false`)
    assert.equal(ready.shouldGate, false, `${tool} must open when ${key}=true`)
  })
}

test('TOOL-READY-11 (ALAI): gates on alaiChatReady == sourceReady alone — never on full enrichment, unlike Flashcards/Quiz/Exam', () => {
  // Source represented but nothing else — the real state for a brand
  // new upload the instant text extraction + base units resolve.
  const sourceOnly = caps({
    flashcardsReady: false, quizReady: false, examReady: false, studyMapReady: false, truquitosReady: false,
    analysisReady: false, repasarReady: false, alaiChatReady: true,
  })
  const alaiGate = resolveMaterialPreparationGate('ready', true, 'alai', sourceOnly)
  const flashcardsGate = resolveMaterialPreparationGate('ready', true, 'flashcards', sourceOnly)
  assert.equal(alaiGate.shouldGate, false, 'ALAI must be usable the instant source is represented, independent of every other tool')
  assert.equal(flashcardsGate.shouldGate, true, 'Flashcards must still wait — proves the two tools genuinely use different capability keys, not a shared flag')
})

test('TOOL-READY-14: preparing != failed — no Retry affordance implied while a capability is simply not ready yet', () => {
  const gate = resolveMaterialPreparationGate('ready', true, 'quiz', caps({ quizReady: false }))
  assert.equal(gate.mode, 'preparing')
  assert.notEqual(gate.mode, 'failed')
})

test('TOOL-READY-15: a terminal brainStatus failure surfaces as failed regardless of which tool was requested — Retry is meaningful here', () => {
  for (const tool of ['flashcards', 'quiz', 'exam', 'alai'] as FreeTool[]) {
    const gate = resolveMaterialPreparationGate('failed', true, tool, null)
    assert.equal(gate.mode, 'failed', `${tool} must surface a real failed state when the Brain itself failed`)
  }
})

test('TOOL-READY-19/server-authority cross-check: canUseFreeTool never trusts a null/undefined capabilities object as ready (matches server-route fail-closed default)', () => {
  assert.equal(canUseFreeTool('flashcards', null), false)
  assert.equal(canUseFreeTool('flashcards', undefined), false)
})

test('TOOL-READY-20: once every relevant capability is true, every tool opens normally', () => {
  const allReady = caps()
  for (const tool of ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam', 'studyMap', 'truquitos'] as FreeTool[]) {
    assert.equal(canUseFreeTool(tool, allReady), true, `${tool} must be usable once its capability is true`)
    assert.equal(resolveMaterialPreparationGate('ready', true, tool, allReady).shouldGate, false)
  }
})

test('capability model sanity: resolveMaterialCapabilities(null) never claims any tool ready (server fail-closed baseline)', () => {
  const c = resolveMaterialCapabilities(null)
  for (const tool of ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'exam', 'studyMap', 'truquitos'] as FreeTool[]) {
    assert.equal(canUseFreeTool(tool, c), false)
  }
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('free-tool-readiness-gate-contracts: ALL PASS')
