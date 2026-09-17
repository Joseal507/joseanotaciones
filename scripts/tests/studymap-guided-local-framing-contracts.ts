import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  computeGuidedFramingTransform,
  READABLE_SCALE_BY_LEVEL,
  MIN_GUIDED_SCALE,
  MAX_GUIDED_SCALE,
  type GuidedNeighborhoodMember,
  type ViewportRect,
} from '../../components/materias/ALAIStudyMap'

// ============================================================
// STUDYMAP_GUIDED_LOCAL_FRAMING contracts.
//
// Bug found in live test: single-node readable-scale framing
// (STUDYMAP_GUIDED_CAMERA) centered the selected node but did not
// guarantee its directly navigable neighbors (parent/children/rendered
// relation-detail children) stayed inside the viewport — a wide branch
// could clip siblings/children outside the frame, forcing the student
// to close the panel or move to another node just to discover them.
//
// Fix: computeGuidedFramingTransform replaces the single-node scale
// lookup with a neighborhood-aware fit — it still anchors on the
// selected node's own position (so it stays visually dominant/centered)
// but derives scale from the largest symmetric extent any neighborhood
// member needs around that anchor, capped by the node's own stylistic
// per-level scale (never over-zooms a sparse neighborhood) and hard-
// clamped to [MIN_GUIDED_SCALE, MAX_GUIDED_SCALE] (never zooms out to a
// whole-graph-fit scale for a dense one). Members the CALLER does not
// pass in (e.g. distant previously-expanded branches) structurally
// cannot affect the result — this is a pure function with no access to
// anything outside its `members` argument.
// ============================================================

const SRC = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── STUDYMAP_GUIDED_LOCAL_FRAMING contracts ──\n')

// Helper: does viewport-space rect [tx-halfW, tx+halfW] fully contain a
// member's own box, given the resulting transform?
function memberFullyVisible(m: GuidedNeighborhoodMember, boundsOrigin: { minX: number; minY: number }, transform: { x: number; y: number; scale: number }, viewport: ViewportRect): boolean {
  const screenLeft = transform.x + (m.x - m.width / 2 - boundsOrigin.minX) * transform.scale;
  const screenRight = transform.x + (m.x + m.width / 2 - boundsOrigin.minX) * transform.scale;
  const screenTop = transform.y + (m.y - m.height / 2 - boundsOrigin.minY) * transform.scale;
  const screenBottom = transform.y + (m.y + m.height / 2 - boundsOrigin.minY) * transform.scale;
  return screenLeft >= -0.5 && screenRight <= viewport.width + 0.5 && screenTop >= -0.5 && screenBottom <= viewport.height + 0.5;
}

const boundsOrigin = { minX: 0, minY: 0 };
const viewportDesktop: ViewportRect = { width: 1000, height: 700 };

// A typical branch: selected leaf, its parent (branch), 2 siblings-as-children? —
// build a realistic local neighborhood: parent above, 3 direct children spread horizontally.
const selected: GuidedNeighborhoodMember = { id: 'leaf-1', x: 500, y: 300, width: 215, height: 82 };
const parent: GuidedNeighborhoodMember = { id: 'branch-1', x: 500, y: 150, width: 235, height: 95 };
const child1: GuidedNeighborhoodMember = { id: 'detail-1', x: 250, y: 420, width: 185, height: 66 };
const child2: GuidedNeighborhoodMember = { id: 'detail-2', x: 500, y: 450, width: 185, height: 66 };
const child3: GuidedNeighborhoodMember = { id: 'detail-3', x: 780, y: 420, width: 185, height: 66 };
const localNeighborhood = [selected, parent, child1, child2, child3];

test('A. selected node itself is inside the usable viewport', () => {
  const t = computeGuidedFramingTransform(localNeighborhood, 'leaf-1', 2, boundsOrigin, viewportDesktop);
  assert.ok(t);
  assert.ok(memberFullyVisible(selected, boundsOrigin, t!, viewportDesktop));
})

test('B. direct parent is visible when applicable', () => {
  const t = computeGuidedFramingTransform(localNeighborhood, 'leaf-1', 2, boundsOrigin, viewportDesktop);
  assert.ok(t);
  assert.ok(memberFullyVisible(parent, boundsOrigin, t!, viewportDesktop));
})

test('C. all direct visible children are inside the usable viewport', () => {
  const t = computeGuidedFramingTransform(localNeighborhood, 'leaf-1', 2, boundsOrigin, viewportDesktop);
  assert.ok(t);
  for (const child of [child1, child2, child3]) {
    assert.ok(memberFullyVisible(child, boundsOrigin, t!, viewportDesktop), `child ${child.id} must be fully visible`);
  }
})

test('D. rendered relation-detail neighbors are inside the usable viewport (they are ordinary tree children for a leaf — same code path as C)', () => {
  // projectStudyMapToTree renders relation edges as type:'detail' CHILDREN
  // of a leaf (see app/api/alai-studyal-map/route.ts buildLeaf) — there is
  // no separate relation-edge structure on the client, so "direct relation
  // neighbors" are already covered by the same children-inclusion proven
  // in test C. This test documents that structural fact from the route.
  const routeSrc = readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
  assert.match(routeSrc, /const relationDetails = \(edgesByNode\.get\(node\.id\) \|\| \[\]\)\.map\(edge => \{/)
  assert.match(routeSrc, /children: relationDetails,/, 'relation edges must still surface as ordinary tree children of a leaf')
})

test('E. distant unrelated (previously expanded elsewhere) nodes do NOT affect guided scale — the function has no access to anything outside `members`', () => {
  const withoutDistant = computeGuidedFramingTransform(localNeighborhood, 'leaf-1', 2, boundsOrigin, viewportDesktop);
  const distantNoise: GuidedNeighborhoodMember[] = Array.from({ length: 40 }, (_, i) => ({
    id: `distant-${i}`, x: 5000 + i * 300, y: 5000 + i * 300, width: 235, height: 95,
  }));
  // Simulates a caller bug where distant nodes leak into the neighborhood
  // set — proves the CORRECT call-site (only real neighbors passed) is
  // what protects contract E in production; the function itself is pure
  // over whatever it's given, so the real guarantee lives in the
  // call-site test below (only focusEmphasisIds feeds `members`).
  const withDistantIncluded = computeGuidedFramingTransform([...localNeighborhood, ...distantNoise], 'leaf-1', 2, boundsOrigin, viewportDesktop);
  assert.notEqual(withDistantIncluded!.scale, withoutDistant!.scale, 'sanity: including distant members WOULD change the fit if they leaked in')
  // The real guarantee: the call site only ever builds `members` from
  // focusEmphasisIds (selected + immediate parent + direct children) —
  // never from the full `layout`/expandedSet.
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf('} else {\n      nodeTargetScale = transform.scale;'))
  assert.match(effectBody, /const neighborhoodIds = focusEmphasisIds \|\| new Set\(\[focusNodeId\]\);/)
  assert.match(effectBody, /layout\s*\n\s*\.filter\(n => neighborhoodIds\.has\(n\.node\.id\)\)/, 'neighborhood members must be filtered down from focusEmphasisIds, never the full layout/expandedSet')
})

test('F. StudyPanel-open viewport (reserveRight for the floating variant) is used correctly', () => {
  const narrowViewport: ViewportRect = { width: 1000 - 432, height: 700 }; // 400 + 16*2 floating panel reserve
  // A moderate neighborhood (parent + one child) that genuinely fits at a
  // readable scale even in the panel-narrowed viewport — isolates
  // "is the reduced viewport actually used" from the separate
  // dense-clamp trade-off already covered by test J.
  const moderateNeighborhood = [selected, parent, child2];
  const t = computeGuidedFramingTransform(moderateNeighborhood, 'leaf-1', 2, boundsOrigin, narrowViewport);
  assert.ok(t);
  for (const m of moderateNeighborhood) assert.ok(memberFullyVisible(m, boundsOrigin, t!, narrowViewport), `${m.id} must fit inside the panel-narrowed viewport`);
  // Confirm the narrower viewport actually constrained the result more
  // than the full-width one would have (proves reserveRight is live).
  const tWide = computeGuidedFramingTransform(moderateNeighborhood, 'leaf-1', 2, boundsOrigin, viewportDesktop);
  assert.ok(t!.scale <= tWide!.scale, 'the panel-narrowed viewport must never yield a LARGER scale than the full-width one')
  // The effect must feed effectiveWidth (already reserveRight-reduced) into this function, not raw rect.width.
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf('} else {\n      nodeTargetScale = transform.scale;'))
  assert.match(effectBody, /\{ width: effectiveWidth, height: effectiveHeight \}/)
})

test('G. StudyPanel-closed viewport (full width, reserveRight=0) is used correctly', () => {
  const t = computeGuidedFramingTransform(localNeighborhood, 'leaf-1', 2, boundsOrigin, viewportDesktop);
  assert.ok(t);
  for (const m of localNeighborhood) assert.ok(memberFullyVisible(m, boundsOrigin, t!, viewportDesktop));
})

test('H. opening the panel (narrower viewport) recomputes LOCAL framing, never a global fit — the guided branch never calls computeFitTransform', () => {
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf('} else {\n      nodeTargetScale = transform.scale;'))
  assert.doesNotMatch(effectBody, /computeFitTransform/, 'the guided-mode branch must never call the whole-graph fit function')
  // Recomputation is driven by reserveRight being an effect dependency —
  // a panel open/close (which changes reserveRight) re-triggers this
  // exact effect, reusing the SAME computeGuidedFramingTransform call.
  assert.match(SRC, /\}, \[focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds\]\);/)
})

test('I. closing the panel (wider viewport) recomputes LOCAL framing, never a global fit', () => {
  // Same code path as H — reserveRight changing back to 0 re-runs the
  // identical guided branch, which still never reaches computeFitTransform.
  const wideViewport: ViewportRect = { width: 1000, height: 700 };
  const t = computeGuidedFramingTransform(localNeighborhood, 'leaf-1', 2, boundsOrigin, wideViewport);
  assert.ok(t);
  assert.ok(t!.scale <= MAX_GUIDED_SCALE);
})

test('J. a dense local neighborhood — STUDYMAP_NAVIGABLE_VIEWPORT_FIT correction: navigation completeness beats the MIN_GUIDED_SCALE floor, so this now goes BELOW 0.85 rather than clip a navigable node (superseded — see studymap-navigable-viewport-fit-contracts.ts test F for the dedicated contract)', () => {
  const denseSelected: GuidedNeighborhoodMember = { id: 'leaf-x', x: 0, y: 0, width: 215, height: 82 };
  const wideSpread: GuidedNeighborhoodMember[] = Array.from({ length: 8 }, (_, i) => ({
    id: `child-${i}`, x: (i - 4) * 900, y: (i % 2 === 0 ? 1 : -1) * 500, width: 185, height: 66,
  }));
  const t = computeGuidedFramingTransform([denseSelected, ...wideSpread], 'leaf-x', 2, boundsOrigin, viewportDesktop);
  assert.ok(t);
  assert.ok(t!.scale < MIN_GUIDED_SCALE, 'an extremely dense/spread neighborhood must now go BELOW MIN_GUIDED_SCALE rather than clip a navigable node — never fit-to-all-graph smaller, but the local fit itself is authoritative');
  // Still every member must be fully visible at whatever scale was chosen — the whole point of the correction.
  const allMembers = [denseSelected, ...wideSpread];
  for (const m of allMembers) {
    const screenLeft = t!.x + (m.x - m.width / 2 - boundsOrigin.minX) * t!.scale;
    const screenRight = t!.x + (m.x + m.width / 2 - boundsOrigin.minX) * t!.scale;
    assert.ok(screenLeft >= -1 && screenRight <= viewportDesktop.width + 1, `${m.id} must be fully visible even at the corrected below-floor scale`);
  }
})

test('K. a sparse local neighborhood does not over-zoom unnecessarily (stays at the node\'s own stylistic scale, never zooms in to MAX just because it technically fits tighter)', () => {
  const sparseSelected: GuidedNeighborhoodMember = { id: 'leaf-y', x: 0, y: 0, width: 215, height: 82 };
  const oneCloseChild: GuidedNeighborhoodMember = { id: 'child-y', x: 40, y: 40, width: 185, height: 66 };
  const t = computeGuidedFramingTransform([sparseSelected, oneCloseChild], 'leaf-y', 2, boundsOrigin, viewportDesktop);
  assert.ok(t);
  assert.equal(t!.scale, READABLE_SCALE_BY_LEVEL[2], 'a sparse neighborhood must settle at the level\'s normal readable scale, not zoom in further just because the fit allows it');
})

test('L. the selected node stays visually dominant — framing anchors on the selected node\'s OWN position, not the neighborhood bounding-box centroid', () => {
  // Asymmetric neighborhood: one child far to the right, nothing to the left.
  const asymSelected: GuidedNeighborhoodMember = { id: 'leaf-z', x: 0, y: 0, width: 215, height: 82 };
  const farRightChild: GuidedNeighborhoodMember = { id: 'child-far', x: 600, y: 0, width: 185, height: 66 };
  const t = computeGuidedFramingTransform([asymSelected, farRightChild], 'leaf-z', 2, boundsOrigin, viewportDesktop);
  assert.ok(t);
  const selectedScreenX = t!.x + (asymSelected.x - boundsOrigin.minX) * t!.scale;
  // The selected node must land at (or extremely near) the viewport's
  // horizontal center — never dragged off-center toward the asymmetric
  // neighbor.
  assert.ok(Math.abs(selectedScreenX - viewportDesktop.width / 2) < 1, 'selected node must remain centered regardless of neighborhood asymmetry')
})

test('M. manual camera remains disabled in guided mode (unchanged by this phase)', () => {
  assert.match(SRC, /const onMouseDown = \(e: React\.MouseEvent\) => \{\s*if \(guidedMode\) return;/)
  assert.match(SRC, /const onWheel = \(e: React\.WheelEvent\) => \{\s*if \(guidedMode\) return;/)
  assert.match(SRC, /const fitToScreen = \(\) => \{\s*if \(guidedMode\) return;/)
  assert.match(SRC, /\{!guidedMode && <div style=\{\{ position: 'absolute', bottom: 20, right: 20,/, 'manual zoom controls must remain hidden in guided mode')
})

test('N. camera/framing computation introduces zero provider calls', () => {
  const declStart = SRC.indexOf('export function computeGuidedFramingTransform');
  const declEnd = SRC.indexOf('/** Pure — computes the transform that frames an svgW×svgH content box');
  const fnSrc = SRC.slice(declStart, declEnd);
  assert.doesNotMatch(fnSrc, /fetch\(/)
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf('} else {\n      nodeTargetScale = transform.scale;'))
  assert.doesNotMatch(effectBody, /fetch\(/)
})

test('P. computeGuidedFramingTransform is a strict superset of the single-node framing it replaces: it degenerates to the exact same target when the neighborhood is just the selected node itself', () => {
  const soloNode: GuidedNeighborhoodMember = { id: 'solo', x: 123, y: 456, width: 215, height: 82 };
  const t = computeGuidedFramingTransform([soloNode], 'solo', 2, boundsOrigin, viewportDesktop);
  assert.ok(t);
  assert.equal(t!.scale, READABLE_SCALE_BY_LEVEL[2], 'with no neighbors at all, the result must reduce to exactly the old single-node readable-scale target');
  assert.ok(Math.abs(t!.x - (viewportDesktop.width / 2 - soloNode.x * READABLE_SCALE_BY_LEVEL[2])) < 0.001);
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('studymap-guided-local-framing-contracts: ALL PASS')
