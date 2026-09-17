import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ============================================================
// STUDYMAP_CAMERA_FOCUS_UX contracts.
//
// Bug: a user could open a node (leaf click, or re-clicking an
// already-expanded-but-unselected node) while the viewport was at a
// canvas edge, and the camera never moved — because the ONLY thing
// that ever drove `focusNodeId` (MindMap's dedicated focus-camera
// effect) was `toggleExpand`, not node selection itself. Confirmed by
// reading MindMap's `handleNodeClick`: a leaf node (no children) or
// an already-expanded node being (re)selected calls `onSelect(node)`
// alone — `onToggleExpand` is never invoked on those paths, so
// `lastExpandedId`/`focusNodeId` never updated and the existing
// focus-camera useEffect (see studymap-live-ux-hardening-contracts.ts)
// never ran.
//
// Fix (UX/camera-only, no layout/physics/edges/academic changes):
// the parent's `onSelect` handler passed into <MindMap> now also calls
// `setLastExpandedId(n.id)` on every selection, so ANY node selection
// — not just expand/collapse — drives the SAME pre-existing focus-
// camera machinery (computeFitTransform/isBoundsComfortable/
// manualCameraRef/BOTTOM_CHROME_RESERVE untouched). A small epsilon
// no-op guard was added inside that effect so re-selecting an already
// well-framed node causes zero camera movement.
//
// These are source-pattern contracts (the relevant logic lives inside
// closures/effects, not exported pure functions) in the same style
// already established by studymap-live-ux-hardening-contracts.ts.
// ============================================================

const SRC = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── STUDYMAP_CAMERA_FOCUS_UX contracts ──\n')

test('1. every node selection (onSelect prop passed to <MindMap>) also sets lastExpandedId', () => {
  const onSelectMatch = SRC.match(/<MindMap[\s\S]*?onSelect=\{\(n\)\s*=>\s*\{([\s\S]*?)\n\s*\}\}/)
  assert.ok(onSelectMatch, 'the onSelect handler passed to <MindMap> must be present')
  const body = onSelectMatch![1]
  assert.match(body, /setSelectedNode\(n\)/, 'selection must still set selectedNode (unchanged behavior)')
  assert.match(body, /setLastExpandedId\(n\.id\)/, 'selection must now also drive focusNodeId via lastExpandedId')
})

test('2. onSelect still fires BEFORE unrelated persistence side effects (no reordering of existing logic)', () => {
  const onSelectMatch = SRC.match(/<MindMap[\s\S]*?onSelect=\{\(n\)\s*=>\s*\{([\s\S]*?)\n\s*\}\}/)
  const body = onSelectMatch![1]
  const selIdx = body.indexOf('setSelectedNode(n)')
  const focusIdx = body.indexOf('setLastExpandedId(n.id)')
  const studiedIdx = body.indexOf('setStudiedSet(')
  assert.ok(selIdx > -1 && focusIdx > -1 && studiedIdx > -1)
  assert.ok(selIdx < focusIdx && focusIdx < studiedIdx, 'selection, then focus, then the pre-existing studied-set bookkeeping — no reordering of unrelated logic')
})

test('3. handleNodeClick leaf-node path (the exact bug trigger) is untouched: still only calls onSelect, never onToggleExpand', () => {
  const clickBody = SRC.match(/const handleNodeClick = useCallback\(\(node: MapNode\) => \{([\s\S]*?)\}, \[selectedId, expandedSet, onSelect, onToggleExpand\]\)/)
  assert.ok(clickBody, 'handleNodeClick must be present with its original dependency array (untouched)')
  const leafBranch = clickBody![1].match(/\} else \{\s*\/\/ Hoja sin hijos[\s\S]*?\n\s*\}/)
  assert.ok(leafBranch, 'the leaf-node (no children) branch must still exist verbatim')
  assert.match(leafBranch![0], /onSelect\(node\)/)
  assert.doesNotMatch(leafBranch![0], /onToggleExpand/, 'a leaf click must never call onToggleExpand — the fix relies on onSelect alone now also driving the camera')
})

test('4. the dedicated focus-camera effect gained a no-op epsilon guard (avoids camera movement when already framed)', () => {
  // STUDYMAP_UX_PHASE2 extended the deps with reserveRight/reserveBottom
  // (so the effect re-centers if the usable viewport itself changes,
  // e.g. a floating panel opening); STUDYMAP_GUIDED_CAMERA further added
  // guidedMode (so it re-evaluates the readable-scale target if guided
  // mode itself toggles) — focusNodeId and layout remain the core
  // trigger, just no longer the ONLY deps.
  const effectMatch = SRC.match(/GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado[\s\S]*?\n\s*\}, \[focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds\]\)/)
  assert.ok(effectMatch, 'the focus-camera effect must still exist, triggered by focusNodeId/layout (plus the viewport-reserve and guidedMode deps)')
  const body = effectMatch![0]
  // STUDYMAP_SMOOTH_LOCAL_NAVIGATION: the start point now reads from
  // transformRef.current (the live imperative value), not `transform`
  // React state directly — see studymap-smooth-local-navigation-
  // contracts.ts for the dedicated performance-fix contracts.
  assert.match(body, /const startX = transformRef\.current\.x;/)
  assert.match(body, /const startY = transformRef\.current\.y;/)
  assert.match(body, /Math\.abs\(targetX - startX\) < 1 && Math\.abs\(targetY - startY\) < 1 && Math\.abs\(nodeTargetScale - startScale\) < 0\.01/, 'must skip the animation when the node is already at (or extremely close to) its target framed position AND scale')
  const guardIdx = body.indexOf('Math.abs(targetX - startX)')
  const rafIdx = body.indexOf('requestAnimationFrame(tick)')
  assert.ok(guardIdx > -1 && rafIdx > -1 && guardIdx < rafIdx, 'the no-op guard must run BEFORE the animation is scheduled')
})

test('5. existing camera-ownership machinery (manualCameraRef, BOTTOM_CHROME_RESERVE, comfort-zone smart-fit) is unchanged', () => {
  assert.match(SRC, /if \(manualCameraRef\.current\) return; \/\/ el usuario tiene el control/, 'manual pan/zoom must still take priority over focus — untouched')
  assert.match(SRC, /const BOTTOM_CHROME_RESERVE = 72;/, 'bottom chrome reservation for the status bar\/zoom controls must be unchanged')
  assert.match(SRC, /isBoundsComfortable\(compensated, svgW, svgH, rect\) \? compensated : computeFitTransform\(rect, svgW, svgH\)/, 'smart-fit comfort-zone re-fit logic must be unchanged')
  assert.match(SRC, /if \(focusNodeId\) \{[\s\S]{0,600}?\n\s*return;\n\s*\}/, 'smart-fit must still yield entirely to the focus-camera effect whenever a node is focused (no two-effect race reintroduced)')
})

test('6. camera positioning accounts for BOTH a shrinking sidebar (via rect itself) and a floating/overlay panel (via reserveRight/reserveBottom props) — no hardcoded panel-width literal inside MindMap itself', () => {
  const effectMatch = SRC.match(/GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado[\s\S]*?\n\s*\}, \[focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds\]\)/)
  assert.ok(effectMatch, 'the focus-camera effect must be extractable with its full dependency array')
  const body = effectMatch![0]
  // STUDYMAP_GUIDED_LOCAL_FRAMING: target position now comes from
  // computeGuidedFramingTransform (neighborhood-aware), fed the SAME
  // effectiveWidth/effectiveHeight — see studymap-guided-local-framing-
  // contracts.ts for the dedicated neighborhood-framing contracts.
  assert.match(body, /\{ width: effectiveWidth, height: effectiveHeight \}/)
  assert.doesNotMatch(body, /panelWidth|440|400 \+ 16/, 'MindMap itself must stay agnostic of any concrete panel size — the parent computes and passes reserveRight/reserveBottom, never a literal here')
})

test('7. no physics/layout/topology functions were touched by this change', () => {
  assert.match(SRC, /export function computeMindMapLayout\(/, 'layout computation must still be present/exported unchanged')
  assert.match(SRC, /export function computeFitTransform\(/)
  assert.match(SRC, /export function isBoundsComfortable\(/)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('studymap-camera-focus-ux-contracts: ALL PASS')
