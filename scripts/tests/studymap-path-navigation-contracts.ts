import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getNavigableNeighborhoodIds,
  pushGuidedNavigation,
  popGuidedNavigation,
  computeBackAnchorSide,
  computeGuidedFramingTransform,
  READABLE_SCALE_BY_LEVEL,
  type GuidedNeighborhoodMember,
  type ViewportRect,
} from '../../components/materias/ALAIStudyMap'

// ============================================================
// STUDYMAP_PATH_NAVIGATION contracts.
//
// Live test: after selecting a branch, the camera could zoom out to
// ~20% scale. Root cause: STUDYMAP_NAVIGABLE_VIEWPORT_FIT's neighborhood
// definition included the selected node's PARENT and ALL its SIBLINGS —
// correct for a small branch (a few sibling leaves) but catastrophic one
// level up, where selecting any of root's ~13 branches meant "siblings"
// = "every other root branch", forcing a whole-root-neighborhood fit.
//
// Product correction: Study Map now behaves like walking through a
// spatial map. The camera frames ONLY the current node + its forward
// (direct children) neighborhood — never siblings, never the parent's
// geometry. The previous node is represented by a deterministic,
// client-only navigation STACK and rendered as a compact, screen-space
// "back anchor" overlay that can never influence camera scale.
// ============================================================

const SRC = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── STUDYMAP_PATH_NAVIGATION contracts ──\n')

function memberFullyVisible(m: GuidedNeighborhoodMember, boundsOrigin: { minX: number; minY: number }, transform: { x: number; y: number; scale: number }, viewport: ViewportRect): boolean {
  const screenLeft = transform.x + (m.x - m.width / 2 - boundsOrigin.minX) * transform.scale;
  const screenRight = transform.x + (m.x + m.width / 2 - boundsOrigin.minX) * transform.scale;
  const screenTop = transform.y + (m.y - m.height / 2 - boundsOrigin.minY) * transform.scale;
  const screenBottom = transform.y + (m.y + m.height / 2 - boundsOrigin.minY) * transform.scale;
  return screenLeft >= -0.5 && screenRight <= viewport.width + 0.5 && screenTop >= -0.5 && screenBottom <= viewport.height + 0.5;
}

const boundsOrigin = { minX: 0, minY: 0 };

// Simulates the live-test scenario: root with 13 branches, one selected.
type SimpleNode = { id: string; children?: SimpleNode[] };
const manyBranches: SimpleNode[] = Array.from({ length: 13 }, (_, i) => ({
  id: `branch-${i}`,
  children: [{ id: `${i}-leaf-1` }, { id: `${i}-leaf-2` }, { id: `${i}-leaf-3` }],
}));
const rootTree: SimpleNode = { id: 'root', children: manyBranches };

test('A. root initial overview behavior is untouched by this phase (no source change to the mount-time smart-fit path)', () => {
  // The initial overview is produced by the SEPARATE smart-fit effect
  // (computeFitTransform on first-ever layout), never by
  // computeGuidedFramingTransform/getNavigableNeighborhoodIds — this
  // phase touches neither that effect's trigger nor its fit expression.
  assert.match(SRC, /if \(prevOrigin === null\) \{/)
  assert.match(SRC, /setTransform\(computeFitTransform\(rect, svgW, svgH\)\);\s*\n\s*return;/, 'the first-ever-layout overview fit must remain byte-for-byte unchanged')
})

test('B. entering a branch (root -> branch-3) excludes unrelated root siblings from the camera bounds', () => {
  const ids = getNavigableNeighborhoodIds(rootTree as any, 'branch-3');
  assert.ok(ids);
  assert.ok(ids!.has('branch-3'));
  for (let i = 0; i < 13; i++) {
    if (i === 3) continue;
    assert.ok(!ids!.has(`branch-${i}`), `sibling branch-${i} must NOT be a camera-bounds member`);
  }
})

test('C. the selected branch is readable (branch-level readable scale, not a diluted whole-root scale)', () => {
  const selected: GuidedNeighborhoodMember = { id: 'branch-3', x: 500, y: 300, width: 235, height: 95 };
  const children: GuidedNeighborhoodMember[] = [
    { id: '3-leaf-1', x: 250, y: 460, width: 215, height: 82 },
    { id: '3-leaf-2', x: 500, y: 480, width: 215, height: 82 },
    { id: '3-leaf-3', x: 750, y: 460, width: 215, height: 82 },
  ];
  const t = computeGuidedFramingTransform([selected, ...children], 'branch-3', 1, boundsOrigin, { width: 1200, height: 800 });
  assert.ok(t);
  assert.equal(t!.scale, READABLE_SCALE_BY_LEVEL[1], 'a normal-sized branch neighborhood must settle at the branch-level readable scale');
})

test('D. every direct child of the selected branch fits inside the usable viewport', () => {
  const selected: GuidedNeighborhoodMember = { id: 'branch-3', x: 500, y: 300, width: 235, height: 95 };
  const children: GuidedNeighborhoodMember[] = [
    { id: '3-leaf-1', x: 250, y: 460, width: 215, height: 82 },
    { id: '3-leaf-2', x: 500, y: 480, width: 215, height: 82 },
    { id: '3-leaf-3', x: 750, y: 460, width: 215, height: 82 },
  ];
  const viewport: ViewportRect = { width: 1200, height: 800 };
  const t = computeGuidedFramingTransform([selected, ...children], 'branch-3', 1, boundsOrigin, viewport);
  assert.ok(t);
  for (const c of children) assert.ok(memberFullyVisible(c, boundsOrigin, t!, viewport), `${c.id} must be fully visible`);
})

test('E. the back anchor fits — it is a fixed screen-space overlay, structurally unable to be clipped by graph-space camera math', () => {
  const backAnchorBlock = SRC.slice(SRC.indexOf('back anchor — a compact, SCREEN-SPACE'), SRC.indexOf('{/* Info bottom */}'))
  assert.match(backAnchorBlock, /position: 'absolute',/, 'the back anchor must be a position:absolute overlay within the same container as the info bar/zoom controls')
  assert.match(backAnchorBlock, /bottom: 76,/)
  assert.doesNotMatch(backAnchorBlock, /transform\.scale\s*\*/, 'the back anchor\'s own size/position must never be scaled by the graph camera transform')
})

test('F. the previous full neighborhood (parent + its other children) does NOT affect scale — computeGuidedFramingTransform never receives it', () => {
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf("} else {\n      nodeTargetScale = transform.scale;"))
  assert.match(effectBody, /const neighborhoodIds = focusEmphasisIds \|\| new Set\(\[focusNodeId\]\);/)
  // getNavigableNeighborhoodIds (which feeds focusEmphasisIds) must be
  // forward-only now — no parent/sibling walk.
  const fnSrc = SRC.slice(SRC.indexOf('export function getNavigableNeighborhoodIds'), SRC.indexOf('export function getNavigableNeighborhoodIds') + 700)
  assert.doesNotMatch(fnSrc, /chain\.length - 2|sibling/i, 'must not walk to the parent or iterate siblings anymore')
})

test('G. branch navigation (onSelect) pushes the navigation path', () => {
  const onSelectMatch = SRC.match(/<MindMap[\s\S]*?onSelect=\{\(n\)\s*=>\s*\{([\s\S]*?)\n\s*\}\}/)
  assert.ok(onSelectMatch)
  assert.match(onSelectMatch![1], /setGuidedNavStack\(prev => \(lastExpandedId && lastExpandedId !== n\.id\) \? pushGuidedNavigation\(prev, lastExpandedId\) : prev\);/)
})

test('H. Back pops to the previous node (pure reducer contract)', () => {
  const stack = pushGuidedNavigation(pushGuidedNavigation([], 'root'), 'branch-3');
  assert.deepEqual(stack, ['root', 'branch-3']);
  const popped = popGuidedNavigation(stack);
  assert.equal(popped.targetNodeId, 'branch-3');
  assert.deepEqual(popped.stack, ['root']);
  const popped2 = popGuidedNavigation(popped.stack);
  assert.equal(popped2.targetNodeId, 'root');
  assert.deepEqual(popped2.stack, []);
  const poppedEmpty = popGuidedNavigation(popped2.stack);
  assert.equal(poppedEmpty.targetNodeId, null, 'popping an empty stack must be a safe no-op, not throw');
})

test('I. Back restores the appropriate camera target (handleGuidedBack drives selection through the SAME setSelectedNode/setLastExpandedId path as any other node selection)', () => {
  const backFn = SRC.slice(SRC.indexOf('const handleGuidedBack = useCallback'), SRC.indexOf('const handleGuidedBack = useCallback') + 900)
  assert.match(backFn, /popGuidedNavigation\(prev\)/)
  assert.match(backFn, /setSelectedNode\(target\);/)
  assert.match(backFn, /setLastExpandedId\(targetNodeId\);/, 'setting focusNodeId is what drives the existing focus-camera effect toward the restored target — no separate camera code path')
})

test('J. forward navigation after Back behaves deterministically (push/pop compose correctly: A -> B -> Back -> C pushes exactly [A], never re-adds B)', () => {
  let stack = pushGuidedNavigation([], 'A'); // arrived at B, came from A
  const afterBack = popGuidedNavigation(stack); // Back from B -> A
  assert.equal(afterBack.targetNodeId, 'A');
  stack = afterBack.stack; // []
  // Now navigate forward from A to C — must push exactly ['A'], not duplicate anything from the earlier B visit.
  stack = pushGuidedNavigation(stack, 'A');
  assert.deepEqual(stack, ['A']);
})

test('K. StudyPanel-open usable viewport works for the branch-level forward neighborhood', () => {
  const selected: GuidedNeighborhoodMember = { id: 'branch-3', x: 500, y: 300, width: 235, height: 95 };
  const children: GuidedNeighborhoodMember[] = [
    { id: '3-leaf-1', x: 250, y: 460, width: 215, height: 82 },
    { id: '3-leaf-2', x: 500, y: 480, width: 215, height: 82 },
    { id: '3-leaf-3', x: 750, y: 460, width: 215, height: 82 },
  ];
  const narrowedViewport: ViewportRect = { width: 1200 - 380, height: 800 };
  const t = computeGuidedFramingTransform([selected, ...children], 'branch-3', 1, boundsOrigin, narrowedViewport);
  assert.ok(t);
  for (const m of [selected, ...children]) assert.ok(memberFullyVisible(m, boundsOrigin, t!, narrowedViewport), `${m.id} must fit with the sidebar open`);
})

test('L. StudyPanel-closed usable viewport works for the same forward neighborhood', () => {
  const selected: GuidedNeighborhoodMember = { id: 'branch-3', x: 500, y: 300, width: 235, height: 95 };
  const children: GuidedNeighborhoodMember[] = [
    { id: '3-leaf-1', x: 250, y: 460, width: 215, height: 82 },
    { id: '3-leaf-2', x: 500, y: 480, width: 215, height: 82 },
    { id: '3-leaf-3', x: 750, y: 460, width: 215, height: 82 },
  ];
  const fullViewport: ViewportRect = { width: 1200, height: 800 };
  const t = computeGuidedFramingTransform([selected, ...children], 'branch-3', 1, boundsOrigin, fullViewport);
  assert.ok(t);
  for (const m of [selected, ...children]) assert.ok(memberFullyVisible(m, boundsOrigin, t!, fullViewport));
})

test('M. no global fit is reachable from branch focus (the guided branch never calls computeFitTransform)', () => {
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf("} else {\n      nodeTargetScale = transform.scale;"))
  assert.doesNotMatch(effectBody, /computeFitTransform/)
})

test('N. no manual camera input (unchanged by this phase)', () => {
  assert.match(SRC, /const onMouseDown = \(e: React\.MouseEvent\) => \{\s*if \(guidedMode\) return;/)
  assert.match(SRC, /const onWheel = \(e: React\.WheelEvent\) => \{\s*if \(guidedMode\) return;/)
  assert.match(SRC, /const fitToScreen = \(\) => \{\s*if \(guidedMode\) return;/)
})

test('O. navigation/camera/back produces zero provider calls', () => {
  const navFnsSrc = SRC.slice(SRC.indexOf('export function pushGuidedNavigation'), SRC.indexOf('export function computeBackAnchorSide') + 500)
  assert.doesNotMatch(navFnsSrc, /fetch\(/)
  const backFn = SRC.slice(SRC.indexOf('const handleGuidedBack = useCallback'), SRC.indexOf('const handleGuidedBack = useCallback') + 900)
  assert.doesNotMatch(backFn, /fetch\(/)
})

test('P. studied state remains independent from the navigation stack', () => {
  const backFn = SRC.slice(SRC.indexOf('const handleGuidedBack = useCallback'), SRC.indexOf('const handleGuidedBack = useCallback') + 900)
  assert.doesNotMatch(backFn, /studiedSet|setStudiedSet/, 'Back must never read or write studiedSet')
  const onSelectMatch = SRC.match(/<MindMap[\s\S]*?onSelect=\{\(n\)\s*=>\s*\{([\s\S]*?)\n\s*\}\}/)
  assert.ok(onSelectMatch)
  const pushIdx = onSelectMatch![1].indexOf('setGuidedNavStack');
  const studiedIdx = onSelectMatch![1].indexOf('setStudiedSet');
  assert.ok(pushIdx > -1 && studiedIdx > -1 && pushIdx < studiedIdx, 'pushing navigation history and marking a node studied are two independent statements — neither reads the other\'s state')
})

test('Q. explanation cache remains independent from the navigation stack', () => {
  const backFn = SRC.slice(SRC.indexOf('const handleGuidedBack = useCallback'), SRC.indexOf('const handleGuidedBack = useCallback') + 900)
  assert.doesNotMatch(backFn, /explanationsByNodeId|onPersistExplanation|activeExplainKeyRef/, 'Back must never touch StudyPanel\'s persisted-explanation machinery — explanations stay keyed purely by node id')
})

// R is the full-suite regression sweep — run separately by the harness
// (see the certification report), not a single assertion here.

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('studymap-path-navigation-contracts: ALL PASS')
