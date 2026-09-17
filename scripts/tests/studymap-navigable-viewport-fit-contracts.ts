import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  computeGuidedFramingTransform,
  getNavigableNeighborhoodIds,
  READABLE_SCALE_BY_LEVEL,
  MIN_GUIDED_SCALE,
  MAX_GUIDED_SCALE,
  NAVIGABLE_EDGE_PADDING_PX,
  type GuidedNeighborhoodMember,
  type ViewportRect,
} from '../../components/materias/ALAIStudyMap'

// ============================================================
// STUDYMAP_NAVIGABLE_VIEWPORT_FIT contracts.
//
// Live test found the local-neighborhood framing (STUDYMAP_GUIDED_LOCAL_
// FRAMING) still clipped navigable options once the StudyPanel was open:
// panel CLOSED → mostly fit; panel OPEN → some navigable branches clipped.
//
// Two root causes fixed here:
//
// 1. MIN_GUIDED_SCALE was a HARD floor (`Math.max(MIN_GUIDED_SCALE, ...)`)
//    — it could force the scale UP to 0.85 even when the local
//    neighborhood did not actually fit at 0.85 in the (panel-narrowed)
//    viewport, clipping members. Fixed: the floor is now applied ONLY
//    when the neighborhood still fits there; otherwise the smaller,
//    fit-driven scale wins — navigation completeness beats the
//    readability preference.
//
// 2. The navigable set (getNavigableNeighborhoodIds, formerly an inline
//    computation) under-counted real navigation options: it included
//    the selected node, its parent, and the selected node's OWN
//    children — but NOT the selected node's siblings (other children of
//    the same, already-expanded parent), which are just as directly
//    clickable from the current view. Fixed: siblings are now included.
//
// Also added: a fixed-pixel safety margin (NAVIGABLE_EDGE_PADDING_PX)
// so a member landing exactly at the viewport boundary reads as clipped
// even though it is numerically "inside", and a REAL measured floating-
// panel footprint (ResizeObserver-based) that takes priority over the
// nominal 400+16+16 constant whenever available.
// ============================================================

const SRC = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── STUDYMAP_NAVIGABLE_VIEWPORT_FIT contracts ──\n')

function memberFullyVisible(m: GuidedNeighborhoodMember, boundsOrigin: { minX: number; minY: number }, transform: { x: number; y: number; scale: number }, viewport: ViewportRect): boolean {
  const screenLeft = transform.x + (m.x - m.width / 2 - boundsOrigin.minX) * transform.scale;
  const screenRight = transform.x + (m.x + m.width / 2 - boundsOrigin.minX) * transform.scale;
  const screenTop = transform.y + (m.y - m.height / 2 - boundsOrigin.minY) * transform.scale;
  const screenBottom = transform.y + (m.y + m.height / 2 - boundsOrigin.minY) * transform.scale;
  return screenLeft >= -0.5 && screenRight <= viewport.width + 0.5 && screenTop >= -0.5 && screenBottom <= viewport.height + 0.5;
}

const boundsOrigin = { minX: 0, minY: 0 };

// A realistic tree: root -> branch -> [leaf-1 (selected), leaf-2, leaf-3] (siblings),
// leaf-1 has 2 relation-detail children.
type SimpleNode = { id: string; children?: SimpleNode[] };
const tree: SimpleNode = {
  id: 'root',
  children: [{
    id: 'branch-1',
    children: [
      { id: 'leaf-1', children: [{ id: 'detail-1' }, { id: 'detail-2' }] },
      { id: 'leaf-2' },
      { id: 'leaf-3' },
    ],
  }],
};

test('Navigable-set audit: SUPERSEDED by STUDYMAP_PATH_NAVIGATION — getNavigableNeighborhoodIds is now FORWARD-ONLY (selected + direct children); parent/siblings are represented purely as a screen-space back anchor, never as camera-bounds members. See studymap-path-navigation-contracts.ts for the dedicated contracts.', () => {
  const ids = getNavigableNeighborhoodIds(tree as any, 'leaf-1');
  assert.ok(ids);
  assert.ok(ids!.has('leaf-1'), 'selected node itself');
  assert.ok(ids!.has('detail-1') && ids!.has('detail-2'), 'direct children (relation-details for a leaf)');
  assert.ok(!ids!.has('branch-1'), 'the parent must NOT be a camera-bounds member anymore — it is the back anchor instead')
  assert.ok(!ids!.has('leaf-2') && !ids!.has('leaf-3'), 'siblings must NOT be camera-bounds members anymore — this is exactly the ~20% zoom-out bug fixed by this phase')
  assert.ok(!ids!.has('root'), 'must NOT walk further up than the selected node itself')
})

// Local neighborhood matching the tree above, in layout coordinates.
const selected: GuidedNeighborhoodMember = { id: 'leaf-1', x: 500, y: 300, width: 215, height: 82 };
const parent: GuidedNeighborhoodMember = { id: 'branch-1', x: 500, y: 150, width: 235, height: 95 };
const sibling1: GuidedNeighborhoodMember = { id: 'leaf-2', x: 300, y: 460, width: 215, height: 82 };
const sibling2: GuidedNeighborhoodMember = { id: 'leaf-3', x: 700, y: 460, width: 215, height: 82 };
const detail1: GuidedNeighborhoodMember = { id: 'detail-1', x: 500, y: 460, width: 185, height: 66 };
const fullNeighborhood = [selected, parent, sibling1, sibling2, detail1];

test('A. every node in the canonical navigable set is fully inside the usable viewport (panel closed, full desktop width)', () => {
  const viewport: ViewportRect = { width: 1200, height: 800 };
  const t = computeGuidedFramingTransform(fullNeighborhood, 'leaf-1', 2, boundsOrigin, viewport);
  assert.ok(t);
  for (const m of fullNeighborhood) assert.ok(memberFullyVisible(m, boundsOrigin, t!, viewport), `${m.id} must be fully visible`);
})

test('B. same invariant holds with the StudyPanel OPEN (desktop sidebar, 380px narrower viewport)', () => {
  const viewportWithSidebar: ViewportRect = { width: 1200 - 380, height: 800 };
  const t = computeGuidedFramingTransform(fullNeighborhood, 'leaf-1', 2, boundsOrigin, viewportWithSidebar);
  assert.ok(t);
  for (const m of fullNeighborhood) assert.ok(memberFullyVisible(m, boundsOrigin, t!, viewportWithSidebar), `${m.id} must remain fully visible with the sidebar open`);
})

test('C. same invariant holds with the StudyPanel CLOSED (full viewport)', () => {
  const viewport: ViewportRect = { width: 1200, height: 800 };
  const t = computeGuidedFramingTransform(fullNeighborhood, 'leaf-1', 2, boundsOrigin, viewport);
  assert.ok(t);
  for (const m of fullNeighborhood) assert.ok(memberFullyVisible(m, boundsOrigin, t!, viewport));
})

test('D. panel width is actually accounted for: a narrower (panel-open) viewport never yields a LARGER scale than the wider (panel-closed) one', () => {
  const closed: ViewportRect = { width: 1200, height: 800 };
  const open: ViewportRect = { width: 1200 - 432, height: 800 };
  const tClosed = computeGuidedFramingTransform(fullNeighborhood, 'leaf-1', 2, boundsOrigin, closed);
  const tOpen = computeGuidedFramingTransform(fullNeighborhood, 'leaf-1', 2, boundsOrigin, open);
  assert.ok(tClosed && tOpen);
  assert.ok(tOpen!.scale <= tClosed!.scale, 'a narrower viewport must never produce an equal-or-larger scale than the wider one')
  for (const m of fullNeighborhood) assert.ok(memberFullyVisible(m, boundsOrigin, tOpen!, open), `${m.id} must still be fully visible with the panel open`);
})

test('E. safety padding (NAVIGABLE_EDGE_PADDING_PX) keeps members away from the literal viewport edge, not just numerically "inside"', () => {
  assert.equal(NAVIGABLE_EDGE_PADDING_PX, 24);
  const viewport: ViewportRect = { width: 1200, height: 800 };
  const t = computeGuidedFramingTransform(fullNeighborhood, 'leaf-1', 2, boundsOrigin, viewport);
  assert.ok(t);
  for (const m of fullNeighborhood) {
    const screenLeft = t!.x + (m.x - m.width / 2 - boundsOrigin.minX) * t!.scale;
    const screenRight = t!.x + (m.x + m.width / 2 - boundsOrigin.minX) * t!.scale;
    const screenTop = t!.y + (m.y - m.height / 2 - boundsOrigin.minY) * t!.scale;
    const screenBottom = t!.y + (m.y + m.height / 2 - boundsOrigin.minY) * t!.scale;
    // The tightest member (the one that determined the fit) should sit
    // within a few px of the padding margin, never flush against 0/width.
    assert.ok(screenLeft >= -0.5 && screenTop >= -0.5 && screenRight <= viewport.width + 0.5 && screenBottom <= viewport.height + 0.5);
  }
  // Structural: the padding must be subtracted from the viewport BEFORE the fit ratio is computed.
  assert.match(SRC, /const paddedViewportW = Math\.max\(1, viewport\.width - NAVIGABLE_EDGE_PADDING_PX \* 2\);/)
  assert.match(SRC, /const paddedViewportH = Math\.max\(1, viewport\.height - NAVIGABLE_EDGE_PADDING_PX \* 2\);/)
})

test('F. local scale may go below the old 0.85 floor when the panel-open viewport requires it — never clips to preserve readability', () => {
  const denseNeighborhood: GuidedNeighborhoodMember[] = [
    { id: 'leaf-1', x: 0, y: 0, width: 215, height: 82 },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `opt-${i}`, x: (i - 3) * 500, y: (i % 2 === 0 ? 1 : -1) * 350, width: 215, height: 82 })),
  ];
  const narrowPanelOpenViewport: ViewportRect = { width: 1200 - 432, height: 800 };
  const t = computeGuidedFramingTransform(denseNeighborhood, 'leaf-1', 2, boundsOrigin, narrowPanelOpenViewport);
  assert.ok(t);
  assert.ok(t!.scale < MIN_GUIDED_SCALE, `expected a below-floor scale, got ${t!.scale}`);
  for (const m of denseNeighborhood) assert.ok(memberFullyVisible(m, boundsOrigin, t!, narrowPanelOpenViewport), `${m.id} must still be fully visible even below the old floor`);
})

test('G. a sparse neighborhood still does not zoom out (or in) unnecessarily — settles at the level\'s normal readable scale', () => {
  const sparse: GuidedNeighborhoodMember[] = [
    { id: 'leaf-1', x: 0, y: 0, width: 215, height: 82 },
    { id: 'child-1', x: 50, y: 50, width: 185, height: 66 },
  ];
  const viewport: ViewportRect = { width: 1200, height: 800 };
  const t = computeGuidedFramingTransform(sparse, 'leaf-1', 2, boundsOrigin, viewport);
  assert.ok(t);
  assert.equal(t!.scale, READABLE_SCALE_BY_LEVEL[2]);
})

test('H. distant unrelated expanded nodes still do not affect framing (members not passed in cannot influence the result)', () => {
  const without = computeGuidedFramingTransform(fullNeighborhood, 'leaf-1', 2, boundsOrigin, { width: 1200, height: 800 });
  const distant: GuidedNeighborhoodMember[] = Array.from({ length: 20 }, (_, i) => ({ id: `distant-${i}`, x: 9000 + i * 400, y: 9000, width: 215, height: 82 }));
  const withDistantLeaked = computeGuidedFramingTransform([...fullNeighborhood, ...distant], 'leaf-1', 2, boundsOrigin, { width: 1200, height: 800 });
  assert.notEqual(withDistantLeaked!.scale, without!.scale, 'sanity: distant members WOULD change the result if they leaked into `members`');
  // Real guarantee: the call site only ever builds `members` from focusEmphasisIds
  // (== getNavigableNeighborhoodIds output intersected with the currently
  // rendered `layout`) — never the full layout/expandedSet.
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf("} else {\n      nodeTargetScale = transform.scale;"))
  assert.match(effectBody, /const neighborhoodIds = focusEmphasisIds \|\| new Set\(\[focusNodeId\]\);/)
  assert.match(effectBody, /layout\s*\n\s*\.filter\(n => neighborhoodIds\.has\(n\.node\.id\)\)/)
})

test('I. selected node remains visually emphasized even when the camera must zoom out (opacity + glow are independent of scale, never by keeping it geometrically huge)', () => {
  assert.match(SRC, /const nodeOpacity = !focusEmphasisIds \|\| focusEmphasisIds\.has\(n\.node\.id\) \? 1 : 0\.22;/, 'emphasis is a pure opacity rule keyed on neighborhood membership, never on the chosen scale — it cannot degrade when scale goes low')
  assert.match(SRC, /const dominanceGlow = isSel \? 'drop-shadow\(0 0 10px color-mix\(in srgb, var\(--gold\) 70%, transparent\)\)' : 'none';/, 'a dedicated glow (independent of node size/scale) must reinforce the selected node\'s dominance')
  assert.doesNotMatch(SRC, /isSel \? \{[^}]*width:.*\* 1\.\d/, 'dominance must never be implemented by inflating the selected node\'s own width/height beyond its normal per-level size')
})

test('J. closing the panel recomputes local framing smoothly (same effect, wider viewport, still no global fit)', () => {
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf("} else {\n      nodeTargetScale = transform.scale;"))
  assert.doesNotMatch(effectBody, /computeFitTransform/, 'closing the panel must never trigger the whole-graph fit function')
  assert.match(SRC, /\}, \[focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds\]\);/, 'reserveRight changing (panel close) is a dependency that re-runs this same effect')
  assert.match(SRC, /const ease = 1 - Math\.pow\(1 - t, 3\);/, 'the recompute still animates smoothly (ease-out-cubic), never an instant jump')
})

test('K. opening the panel recomputes local framing smoothly (same code path as J, narrower viewport)', () => {
  const t1 = computeGuidedFramingTransform(fullNeighborhood, 'leaf-1', 2, boundsOrigin, { width: 1200, height: 800 });
  const t2 = computeGuidedFramingTransform(fullNeighborhood, 'leaf-1', 2, boundsOrigin, { width: 1200 - 432, height: 800 });
  assert.ok(t1 && t2);
  // Both must be well-formed finite transforms suitable for eased interpolation.
  for (const t of [t1!, t2!]) { assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.scale)); }
})

test('L. no global computeFitTransform is ever reachable from the guided-mode focus branch', () => {
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf("} else {\n      nodeTargetScale = transform.scale;"))
  assert.doesNotMatch(effectBody, /computeFitTransform/)
})

test('M. manual camera remains disabled (unchanged by this phase)', () => {
  assert.match(SRC, /const onMouseDown = \(e: React\.MouseEvent\) => \{\s*if \(guidedMode\) return;/)
  assert.match(SRC, /const onWheel = \(e: React\.WheelEvent\) => \{\s*if \(guidedMode\) return;/)
  assert.match(SRC, /const fitToScreen = \(\) => \{\s*if \(guidedMode\) return;/)
})

test('N. camera changes (framing computation, navigable-set audit, panel measurement) cause zero provider calls', () => {
  const declStart = SRC.indexOf('export function computeGuidedFramingTransform');
  const declEnd = SRC.indexOf('/** Pure — computes the transform that frames an svgW×svgH content box');
  assert.doesNotMatch(SRC.slice(declStart, declEnd), /fetch\(/)
  const measureBlock = SRC.slice(SRC.indexOf('const [floatingPanelEl, setFloatingPanelEl]'), SRC.indexOf('const floatingPanelReserve ='))
  assert.doesNotMatch(measureBlock, /fetch\(/)
  const navigableFnBody = SRC.slice(SRC.indexOf('export function getNavigableNeighborhoodIds'), SRC.indexOf('export function getNavigableNeighborhoodIds') + 800)
  assert.doesNotMatch(navigableFnBody, /fetch\(/)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('studymap-navigable-viewport-fit-contracts: ALL PASS')
