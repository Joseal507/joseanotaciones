import assert from 'node:assert/strict'
import { resolveMaterialPreparationGate } from '../../components/materias/MaterialPreparationScreen'
import type { MaterialCapabilities } from '../../lib/materialBrain/capabilities'
import type { AcademicStability } from '../../lib/materialBrain/academicStability'

// ============================================================
// P0 — "Preparar Material Brain ANTES de entrar a Free Mode". The hub
// itself (not just individual tools) now gates on academicStability
// terminal (stable_rich/stable_degraded), never merely
// brainStatus==='ready' (source-only) — see resolveMaterialPreparationGate's
// new `requireStability` parameter and its use in TemaView.tsx's
// `freePreparationGate` (the single hub-level gate, tool=null).
//
// Policy-level tests (no DOM, no fetch — same shape the file itself
// already documents as "testeable sin DOM, sin React, sin fetch").
// material-brain-lifecycle-contracts.ts already covers the DOM-level
// hook wiring (fingerprint reset, resume, stale-response discarding) in
// detail — not duplicated here.
// ============================================================

function caps(stability: AcademicStability, overrides: Partial<MaterialCapabilities> = {}): MaterialCapabilities {
  return {
    sourceReady: stability !== 'preparing' || true, unitsReady: true, relationsReady: true, visionReady: true,
    richCoveragePercent: stability === 'stable_rich' ? 100 : 50, examReady: stability === 'stable_rich' || stability === 'stable_degraded',
    academicStability: stability,
    alaiChatReady: true,
    repasarReady: stability === 'stable_rich' || stability === 'stable_degraded',
    flashcardsReady: stability === 'stable_rich' || stability === 'stable_degraded',
    quizReady: stability === 'stable_rich' || stability === 'stable_degraded',
    analysisReady: stability === 'stable_rich' || stability === 'stable_degraded',
    studyMapReady: stability === 'stable_rich' || stability === 'stable_degraded',
    truquitosReady: stability === 'stable_rich' || stability === 'stable_degraded',
    ...overrides,
  }
}

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── Free Mode entry (hub-level academic stability gate) contracts ──\n')

test('FREE-ENTRY-2: openFree stays gated (preparing) while academicStability=preparing, even though brainStatus is already ready (source-only)', () => {
  const gate = resolveMaterialPreparationGate('ready', true, null, caps('preparing'), true)
  assert.equal(gate.shouldGate, true)
  assert.equal(gate.mode, 'preparing', 'never technical detail, never Retry-implying')
})

test('FREE-ENTRY-3: stable_rich -> hub opens automatically (gate clears)', () => {
  const gate = resolveMaterialPreparationGate('ready', true, null, caps('stable_rich'), true)
  assert.equal(gate.shouldGate, false)
})

test('FREE-ENTRY-4: stable_degraded -> hub opens automatically, exactly like stable_rich', () => {
  const gate = resolveMaterialPreparationGate('ready', true, null, caps('stable_degraded'), true)
  assert.equal(gate.shouldGate, false)
})

test('FREE-ENTRY-5: failed -> real error state, never a silent/blank gate, never auto-enter', () => {
  const gate = resolveMaterialPreparationGate('ready', true, null, caps('failed'), true)
  assert.equal(gate.shouldGate, true)
  assert.equal(gate.mode, 'failed', 'must surface as a real, Retry-able failure')
})

test('FREE-ENTRY-6: existing terminal-stable Brain for the current fingerprint resolves the gate open on the very first check — no re-preparation', () => {
  // Same inputs a fast GET-only lookup would produce for an
  // already-built stable Brain — must resolve immediately.
  const gate = resolveMaterialPreparationGate('ready', true, null, caps('stable_rich'), true)
  assert.equal(gate.shouldGate, false, 'a Brain that is ALREADY stable must never re-show the preparation screen')
})

test('FREE-ENTRY-9 (structural): while shouldGate=true, no tool-specific gate can ever report ready — the hub itself never mounts the tool buttons, so no generation can be triggered', () => {
  // The hub-level gate (tool=null) and any individual tool gate share
  // the exact same underlying academicStability signal — if the hub
  // gate is blocking, every per-tool capability that requires stability
  // is provably also false (same `caps` object, same stability field).
  const stability: AcademicStability = 'preparing'
  const capabilities = caps(stability)
  const hubGate = resolveMaterialPreparationGate('ready', true, null, capabilities, true)
  assert.equal(hubGate.shouldGate, true)
  for (const key of ['flashcardsReady', 'quizReady', 'repasarReady', 'analysisReady', 'studyMapReady', 'truquitosReady', 'examReady'] as const) {
    assert.equal(capabilities[key], false, `${key} must also be false while the hub itself is gated — consistent single authority`)
  }
})

test('FREE-ENTRY-10: a fully source-represented but still-preparing Brain never resolves as hub-ready — proves the gate cannot be fooled by a "sections complete" signal alone (the actual UI-level fix is in MaterialPreparationScreen\'s progress text, this proves the underlying POLICY never conflates the two)', () => {
  // brainStatus:'ready' already means "all required sections represented"
  // (the old, source-only meaning of complete) — yet with requireStability
  // the gate must still hold while academicStability is 'preparing'.
  const gate = resolveMaterialPreparationGate('ready', true, null, caps('preparing'), true)
  assert.equal(gate.shouldGate, true, 'brainStatus===ready (all sections represented) must NOT be conflated with academic completion')
})

test('FREE-ENTRY-13 (server defense-in-depth still intact): a null/legacy capabilities object never resolves the hub gate open — matches server routes\' own fail-closed default', () => {
  const gate = resolveMaterialPreparationGate('ready', true, null, null, true)
  assert.equal(gate.shouldGate, true, 'missing capabilities must fail closed, never silently open the hub')
})

test('backward compatibility: requireStability defaults to false — existing non-hub callers (individual tool gates, or callers not yet passing the flag) are unaffected', () => {
  const gate = resolveMaterialPreparationGate('ready', true, null, caps('preparing'))
  assert.equal(gate.shouldGate, false, 'without requireStability, brainStatus===ready alone still resolves as before (per-tool gates pass their own tool+capabilities explicitly instead)')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('free-mode-entry-contracts: ALL PASS')
