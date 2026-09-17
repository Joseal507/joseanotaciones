import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ============================================================
// STUDYMAP_UX_PHASE2 contracts — detail inspector/panel + responsive
// map space ONLY. No Enjoyer/node-generation/edge/clustering/provider-
// ownership/language/math-fidelity change is in scope; those are
// covered exhaustively by the existing studymap-*-contracts.ts suite,
// which must still pass unmodified (only two pre-existing structural
// assertions were updated to match the new, still-equivalent
// effectiveWidth/reserve-deps shape — see studymap-live-ux-hardening-
// contracts.ts and studymap-camera-focus-ux-contracts.ts).
//
// Goals verified here (source-pattern contracts, same convention as
// studymap-live-ux-hardening-contracts.ts — the logic lives inside
// closures/effects/JSX, not exported pure functions):
//   1. map stays the dominant surface: the panel collapses away
//      entirely (returns null) whenever no node is selected, on every
//      screen tier — not just mobile as before Phase 2.
//   2. desktop panel is narrower (380 vs the old 440) and only ever
//      occupies flex space while a node is selected (collapsible).
//   3. a medium-screen tier renders the panel as a floating/absolute
//      overlay — never a flex sibling that permanently shrinks the map.
//   4. mobile keeps its existing full-overlay behavior (one of the two
//      explicitly allowed patterns) — untouched.
//   5. closing the panel releases camera focus (setLastExpandedId(null))
//      so the PRE-EXISTING smart-fit comfort-zone effect (unchanged)
//      re-measures the now-uncovered/regrown viewport — no new
//      recentering logic was added.
//   6. the floating panel's reserved footprint fed to MindMap's camera
//      math is the exact same width+margins the panel actually renders
//      with (no drift between CSS and the reservation math).
//   7. none of this touches fetch/provider code — zero provider calls
//      from panel open/close.
// ============================================================

const SRC = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── STUDYMAP_UX_PHASE2 panel/responsive contracts ──\n')

test('1. StudyPanel collapses to nothing whenever no node is selected, on every screen tier', () => {
  const fnStart = SRC.indexOf('function StudyPanel({')
  const gateIdx = SRC.indexOf('if (!node) return null;', fnStart)
  assert.ok(fnStart > -1 && gateIdx > -1, 'StudyPanel must gate its entire render on `node` being present')
  // Must appear BEFORE the returned <aside>, and must not be scoped to isMobile only.
  const asideIdx = SRC.indexOf('return (\n    <aside', gateIdx)
  assert.ok(asideIdx > gateIdx, 'the no-node gate must run before the panel markup is returned')
  const between = SRC.slice(gateIdx, asideIdx)
  assert.doesNotMatch(between, /isMobile\s*&&\s*!node/, 'the gate must not be conditioned on isMobile — it must apply to every tier')
})

test('2. desktop sidebar variant is narrower (380px) and is a flex sibling only while a node is selected', () => {
  const sidebarBlock = SRC.match(/\}\s*:\s*\{\s*\/\/ Desktop: a narrower sidebar[\s\S]*?width: 380,[\s\S]*?flexShrink: 0,/)
  assert.ok(sidebarBlock, 'the desktop sidebar style branch must set width: 380 with flexShrink: 0')
  assert.doesNotMatch(SRC, /width: 440,/, 'the old 440px fixed sidebar width must no longer exist anywhere in this component')
})

test('3. a medium-screen ("isFloating") variant renders the panel as an absolutely positioned overlay, not a flex sibling', () => {
  const floatingBlock = SRC.match(/\}\s*:\s*isFloating\s*\?\s*\{[\s\S]*?position: 'absolute',[\s\S]*?width: 400,[\s\S]*?zIndex: 150,/)
  assert.ok(floatingBlock, 'the isFloating style branch must exist with position:absolute and a fixed width distinct from the desktop sidebar')
})

test('4. mobile keeps its existing full-overlay style untouched', () => {
  assert.match(SRC, /\.\.\.\(isMobile \? \{\s*position: 'fixed',\s*inset: 0,\s*zIndex: 200,/, 'the mobile full-overlay branch (position:fixed, inset:0) must be unchanged')
})

test('5. closing the panel clears focusNodeId (lastExpandedId) so the existing smart-fit effect re-measures the viewport — no new camera code path introduced', () => {
  const onCloseMatch = SRC.match(/onClose=\{\(\) => \{([\s\S]*?)\n\s*\}\}\s*\n\s*onJumpToNode/)
  assert.ok(onCloseMatch, 'the onClose handler passed to <StudyPanel> must be present')
  const body = onCloseMatch![1]
  assert.match(body, /setSelectedNode\(null\)/)
  assert.match(body, /setLastExpandedId\(null\)/, 'closing must release camera focus so the pre-existing smart-fit comfort-zone effect (triggered by its focusNodeId dependency) re-checks the now-changed viewport')
  assert.match(body, /persistPatch\(\{ selectedNodeId: null \}\)/, 'the pre-existing persistence side effect on close must be unchanged')
})

test('6. no new camera/recentering logic was added — the smart-fit comfort-zone effect and its exact re-fit expression are unchanged', () => {
  assert.match(SRC, /isBoundsComfortable\(compensated, svgW, svgH, rect\) \? compensated : computeFitTransform\(rect, svgW, svgH\)/, 'the comfort-zone check/refit expression must be byte-for-byte unchanged from Phase 1/live-hardening')
})

test('7. the floating panel\'s reserved footprint is 0 whenever it is not actually shown, and otherwise prefers the REAL measured footprint over the nominal (400 + 16 + 16) fallback (STUDYMAP_NAVIGABLE_VIEWPORT_FIT — see studymap-navigable-viewport-fit-contracts.ts for the dedicated measurement contract)', () => {
  assert.match(SRC, /const FLOATING_PANEL_RESERVE = 400 \+ 16 \+ 16;/, 'the nominal fallback constant must still exist for the first-paint/measurement-unavailable case')
  assert.match(SRC, /const floatingPanelReserve = measuredFloatingReserve \?\? FLOATING_PANEL_RESERVE;/, 'a real measurement must take priority over the nominal constant whenever available')
  assert.match(SRC, /reserveRight=\{isFloatingPanel && selectedNode \? floatingPanelReserve : 0\}/, 'reserveRight passed to <MindMap> must be 0 whenever the floating panel is not actually shown (no node selected, or not on the medium tier)')
})

test('8. no fetch/provider call exists anywhere in the panel open/close/tier-detection code added by Phase 2', () => {
  const closeMatch = SRC.match(/onClose=\{\(\) => \{([\s\S]*?)\n\s*\}\}\s*\n\s*onJumpToNode/)
  const mediumTierMatch = SRC.match(/const \[isMediumScreen, setIsMediumScreen\][\s\S]*?const FLOATING_PANEL_RESERVE = 400 \+ 16 \+ 16;/)
  assert.ok(closeMatch && mediumTierMatch)
  assert.doesNotMatch(closeMatch![1], /fetch\(/)
  assert.doesNotMatch(mediumTierMatch![0], /fetch\(/)
})

test('9. Enjoyer/adapter/route academic-authority files are untouched by this UX-only phase', () => {
  const enjoyerAdapter = readFileSync('lib/materialBrain/studyMapEnjoyerContext.ts', 'utf8')
  assert.match(enjoyerAdapter, /export function buildStudyMapEnjoyerContext\(/, 'the Enjoyer adapter must still exist, unmodified in shape')
  const routeSource = readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
  assert.match(routeSource, /function projectStudyMapToTree\(/, 'tree/edge/clustering projection must still exist, unmodified in shape')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('studymap-ux-phase2-panel-contracts: ALL PASS')
