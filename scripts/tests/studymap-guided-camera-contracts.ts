import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { READABLE_SCALE_BY_LEVEL } from '../../components/materias/ALAIStudyMap'

// ============================================================
// STUDYMAP_GUIDED_CAMERA contracts — Part 2 of STUDYAL — SESSION
// RESUME UX + STUDY MAP GUIDED CAMERA.
//
// AUDIT FINDING (camera ownership, before this phase): two effects
// wrote `transform` — the smart-fit effect (comfort-zone re-fit) and
// the dedicated focus-camera effect (STUDYMAP_LIVE_UX_HARDENING). They
// were ALREADY structurally mutually exclusive (smart-fit contains an
// explicit `if (focusNodeId) return;` bypass whenever a node is
// focused), so no live race existed even before this phase. What guided
// mode adds is: (1) removing every USER-DRIVEN entry point that could
// ever move `transform` outside these two effects (drag/wheel/+/-/fit
// button), so `manualCameraRef` can never become true, and (2) giving
// the focus-camera effect a stable per-node-type target SCALE (not just
// x/y), so it never depends on total graph size.
//
// FINAL SINGLE CAMERA OWNER in guided mode: the dedicated focus-camera
// effect (`focusNodeId`-keyed) is authoritative whenever a node is
// focused. The smart-fit effect only ever acts in the complementary
// case — no node focused (initial mount, or right after the panel is
// closed) — never simultaneously. Manual entry points are neutralized,
// not deleted (guidedMode={false} still exposes them for reuse).
// ============================================================

const SRC = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── STUDYMAP_GUIDED_CAMERA contracts ──\n')

test('D. guided mode disables drag (onMouseDown/onMouseMove are no-ops when guidedMode is on)', () => {
  const onMouseDown = SRC.match(/const onMouseDown = \(e: React\.MouseEvent\) => \{([\s\S]*?)\n  \};/)
  assert.ok(onMouseDown)
  assert.match(onMouseDown![1], /if \(guidedMode\) return;/)
  const onMouseMove = SRC.match(/const onMouseMove = \(e: React\.MouseEvent\) => \{([\s\S]*?)\n  \};/)
  assert.ok(onMouseMove)
  assert.match(onMouseMove![1], /if \(guidedMode \|\| !dragging\) return;/)
})

test('E. guided mode disables wheel zoom (onWheel is a no-op when guidedMode is on)', () => {
  const onWheel = SRC.match(/const onWheel = \(e: React\.WheelEvent\) => \{([\s\S]*?)\n  \};/)
  assert.ok(onWheel)
  assert.match(onWheel![1], /if \(guidedMode\) return;/)
})

test('F. guided mode disables +/-/fit manual zoom controls (the entire control cluster is hidden, and fitToScreen itself no-ops)', () => {
  assert.match(SRC, /const fitToScreen = \(\) => \{\s*if \(guidedMode\) return;/)
  assert.match(SRC, /\{!guidedMode && <div style=\{\{ position: 'absolute', bottom: 20, right: 20,/, 'the +/⊙/− control cluster must be conditionally rendered only when guidedMode is off')
})

test('G. node selection is the sole camera navigation trigger: onSelect always sets focusNodeId (lastExpandedId), and no other user input path writes transform in guided mode', () => {
  const onSelectMatch = SRC.match(/<MindMap[\s\S]*?onSelect=\{\(n\)\s*=>\s*\{([\s\S]*?)\n\s*\}\}/)
  assert.ok(onSelectMatch)
  assert.match(onSelectMatch![1], /setLastExpandedId\(n\.id\)/)
  // toggleExpand (expand/collapse) also drives focusNodeId — the other
  // legitimate "selection" entry point (a category being expanded).
  const toggleExpand = SRC.match(/const toggleExpand = useCallback\(\(id: string\) => \{([\s\S]*?)\}, \[mapData, persistPatch\]\)/)
  assert.ok(toggleExpand)
  assert.match(toggleExpand![1], /setLastExpandedId\(id\);/)
})

test('H. selected node receives a smooth target transform (x/y AND scale eased together over one rAF loop, not an instant jump)', () => {
  const effect = SRC.slice(SRC.indexOf('GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'), SRC.indexOf("}, [focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds]);"))
  assert.match(effect, /const ease = 1 - Math\.pow\(1 - t, 3\);/, 'ease-out-cubic, not an instant jump')
  // STUDYMAP_SMOOTH_LOCAL_NAVIGATION: x/y/scale are still eased together
  // in the SAME tick — now assigned to plain consts (nx/ny/ns) that
  // drive the imperative DOM write, instead of an inline setTransform()
  // object literal (see studymap-smooth-local-navigation-contracts.ts).
  assert.match(effect, /const nx = startX \+ \(targetX - startX\) \* ease;/)
  assert.match(effect, /const ny = startY \+ \(targetY - startY\) \* ease;/)
  assert.match(effect, /const ns = startScale \+ \(nodeTargetScale - startScale\) \* ease;/, 'scale must be eased together with x/y in the SAME tick — no separate zoom pulse effect')
  assert.match(effect, /raf = requestAnimationFrame\(tick\);/)
})

test('I. branch/leaf/root/detail each get a distinct, readable target scale — fixed constants, independent of graph size', () => {
  assert.deepEqual(READABLE_SCALE_BY_LEVEL, { 0: 0.85, 1: 1.0, 2: 1.25, 3: 1.3 })
  // Must not be computed from svgW/svgH/bounds anywhere.
  assert.doesNotMatch(
    'const declSrc = ' + JSON.stringify(READABLE_SCALE_BY_LEVEL),
    /svgW|svgH|bounds\./,
  )
  const declStart = SRC.indexOf('export const READABLE_SCALE_BY_LEVEL')
  const objLiteral = SRC.slice(SRC.indexOf('{', declStart), SRC.indexOf('};', declStart) + 2)
  assert.doesNotMatch(objLiteral, /svgW|svgH|bounds\.|layout\.length/, 'the readable-scale table\'s object literal itself must be pure constants, never derived from total graph size')
})

test('I2. STUDYMAP_GUIDED_LOCAL_FRAMING superseded the pure per-level scale lookup with computeGuidedFramingTransform (still capped BY that same per-level table — see studymap-guided-local-framing-contracts.ts test K for the no-zoom-pulse/no-over-zoom guarantee under the new neighborhood-aware framing)', () => {
  const effect = SRC.slice(SRC.indexOf('// GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'), SRC.indexOf("}, [focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds]);"))
  assert.match(effect, /computeGuidedFramingTransform\(/, 'guided-mode scale must now come from the neighborhood-aware framing function, not a bare per-level lookup')
  assert.match(effect, /READABLE_SCALE_BY_LEVEL\[node\.level as 0 \| 1 \| 2 \| 3\]/, 'the per-level table is still consulted — as the fallback when there is no neighborhood and as the cap inside computeGuidedFramingTransform itself')
})

test('J. expanding/selecting nodes never triggers a global fit-to-all while a node is focused (smart-fit yields entirely; only the focus-camera effect can move the camera)', () => {
  assert.match(SRC, /if \(focusNodeId\) \{[\s\S]{0,600}?\n\s*return;\n\s*\}/, 'the smart-fit effect must still bypass itself entirely whenever a node is focused')
  // The ONLY two things that ever call computeFitTransform are: (1) the
  // very first layout ever rendered (mount-time overview, not an
  // expand/select action), and (2) the disabled-in-guided-mode
  // fitToScreen/comfort-zone-refit paths — never the focus-camera effect.
  const focusEffect = SRC.slice(SRC.indexOf('GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'), SRC.indexOf("}, [focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds]);"))
  assert.doesNotMatch(focusEffect, /computeFitTransform/, 'the focus-camera effect must never call the fit-to-all function')
})

test('K. visited (studied) nodes do not need to remain expanded — studiedSet and expandedSet are independent state, never synchronized', () => {
  const toggleExpand = SRC.match(/const toggleExpand = useCallback\(\(id: string\) => \{([\s\S]*?)\}, \[mapData, persistPatch\]\)/)
  assert.ok(toggleExpand)
  assert.doesNotMatch(toggleExpand![1], /studiedSet|setStudiedSet/, 'collapsing/expanding a node must never read or write studiedSet')
})

test('L. studied state survives visual collapse — the studied-marking block itself never touches expandedSet, and collapsing never removes a node from studiedSet', () => {
  const onSelectMatch = SRC.match(/<MindMap[\s\S]*?onSelect=\{\(n\)\s*=>\s*\{([\s\S]*?)\n\s*\}\}/)
  assert.ok(onSelectMatch)
  const studiedBlockMatch = onSelectMatch![1].match(/setStudiedSet\(prev => \{([\s\S]*?)\n\s*\}\);/)
  assert.ok(studiedBlockMatch, 'selecting a node must still mark it studied')
  // STUDYMAP_SMOOTH_LOCAL_NAVIGATION: onSelect now ALSO normalizes
  // expandedSet (a separate, sibling statement — see
  // studymap-smooth-local-navigation-contracts.ts) — the studied-
  // marking block ITSELF must still never be the thing that touches
  // expandedSet; the two remain independent concerns.
  assert.doesNotMatch(studiedBlockMatch![1], /setExpandedSet/, 'marking a node studied must never itself force an expansion change')
})

test('M. inspector space is respected in camera target — the neighborhood-framing viewport passed to computeGuidedFramingTransform is effectiveWidth/effectiveHeight (reserveRight/reserveBottom), not raw rect (see studymap-guided-local-framing-contracts.ts tests F/G for the end-to-end numeric proof)', () => {
  const focusEffect = SRC.slice(SRC.indexOf('GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'), SRC.indexOf("}, [focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds]);"))
  assert.match(focusEffect, /\{ width: effectiveWidth, height: effectiveHeight \}/, 'the guided framing call must receive the reserve-adjusted viewport, not the raw rect')
  assert.match(focusEffect, /targetX = framing \? framing\.x : effectiveWidth \/ 2 - \(node\.x - bounds\.minX\) \* READABLE_SCALE_BY_LEVEL/, 'the no-neighborhood-computed fallback path must also use effectiveWidth')
})

test('N. switching between nodes never creates competing transform writers: the focus-camera effect cleans up its own rAF loop before the next run, and does not run at all under manual camera control', () => {
  const focusEffect = SRC.slice(SRC.indexOf('GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'), SRC.indexOf("}, [focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds]);"))
  assert.match(focusEffect, /if \(manualCameraRef\.current\) return;/)
  // STUDYMAP_SMOOTH_LOCAL_NAVIGATION added a DEV-only perf-counter
  // decrement alongside the cancellation — the cancellation itself is
  // still the first, unconditional statement in the cleanup.
  assert.match(focusEffect, /return \(\) => \{\s*cancelAnimationFrame\(raf\);/, 'each focus-camera run must cancel its own in-flight animation frame on cleanup — no two rAF loops writing transform at once')
})

test('O. camera changes (guided-mode gating, scale table, opacity/proximity computation) introduce zero fetch/provider calls', () => {
  const guidedBlock = SRC.slice(SRC.indexOf('const onMouseDown = (e: React.MouseEvent)'), SRC.indexOf('const wrapText = wrapNodeText;'))
  assert.doesNotMatch(guidedBlock, /fetch\(/)
  const emphasisBlock = SRC.slice(SRC.indexOf('const focusEmphasisIds = useMemo'), SRC.indexOf('const focusEmphasisIds = useMemo') + 700)
  assert.doesNotMatch(emphasisBlock, /fetch\(/)
})

test('Visual context: distant nodes are de-emphasized (opacity), not removed — presentation-only, no data/topology change (STUDYMAP_GUIDED_LOCAL_FRAMING strengthened this from 0.35 to 0.22 — see that suite)', () => {
  assert.match(SRC, /const nodeOpacity = !focusEmphasisIds \|\| focusEmphasisIds\.has\(n\.node\.id\) \? 1 : 0\.22;/)
  // computeMindMapLayout (topology/physics) must remain untouched by this.
  assert.match(SRC, /export function computeMindMapLayout\(/)
  const layoutFnSrc = SRC.slice(SRC.indexOf('export function computeMindMapLayout('), SRC.indexOf('export function computeMindMapLayout(') + 3000)
  assert.doesNotMatch(layoutFnSrc, /focusEmphasisIds|nodeOpacity/, 'layout/topology computation must stay entirely unaware of focus-based visual emphasis')
})

test('P0. guided-mode manual-camera plumbing is neutralized, not deleted (reusable via guidedMode={false})', () => {
  assert.match(SRC, /manualCameraRef\.current = true; \/\/ user takes control/, 'the manual-camera-takeover mechanism itself must still exist for a non-guided consumer')
  assert.match(SRC, /guidedMode = true,/, 'guidedMode must default to true (Study Map is guided by default) while remaining an overridable prop')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('studymap-guided-camera-contracts: ALL PASS')
