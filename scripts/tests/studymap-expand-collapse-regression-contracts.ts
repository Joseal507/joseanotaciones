import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getGuidedVisibleContext,
  getGuidedAncestorPath,
  getGuidedForwardExpansion,
} from '../../components/materias/ALAIStudyMap'

// ============================================================
// STUDYMAP_EXPAND_COLLAPSE_REGRESSION contracts.
//
// EXACT TRACE of one node click, confirmed by reading handleNodeClick
// (components/materias/ALAIStudyMap.tsx) and the onSelect prop passed
// to <MindMap>:
//
//   onClick(node)
//   -> handleNodeClick(node)          [hasChildren, !isAlreadyExpanded]
//      -> onSelect(node)               (1st call, in this order)
//         -> setGuidedNavStack(...)
//         -> setSelectedNode(n)
//         -> setExpandedSet(prev => getGuidedForwardExpansion(root, n.id, prev))   <-- FIX
//         -> setLastExpandedId(n.id)
//         -> setStudiedSet(...)
//      -> onToggleExpand(node.id)       (2nd call, same click)
//         -> setExpandedSet(prev => { ...add/remove id based on prev... })
//         -> setLastExpandedId(id)
//   -> React batches both setExpandedSet calls; the second's `prev`
//      is exactly the first's result (React applies same-state updates
//      in enqueue order) -> one commit -> layout/render.
//
// ROOT CAUSE (regression introduced by STUDYMAP_SMOOTH_LOCAL_NAVIGATION):
// onSelect's normalization used getGuidedVisibleContext, which is
// INCLUSIVE of the clicked node itself. On the very first click of a
// collapsed branch, that pre-emptively added node.id to expandedSet
// BEFORE onToggleExpand ran. onToggleExpand's `next.has(id)` therefore
// read TRUE even though the node had never actually been expanded by
// the user — so it immediately REMOVED id (+ descendants), net
// collapsing what should have just opened. The branch never appeared
// to expand.
//
// FIX: onSelect now normalizes with getGuidedForwardExpansion, which
// uses the EXCLUSIVE getGuidedAncestorPath (root..parent, never the
// clicked node itself) and separately preserves the clicked node's
// PRE-CLICK membership (`prev.has(currentNodeId)`) — never
// unconditionally including it. onToggleExpand's subsequent add/remove
// decision is left completely authoritative for the clicked node.
// Back (handleGuidedBack) is untouched — it keeps the INCLUSIVE
// getGuidedVisibleContext, since Back has no competing click-driven
// toggle intent to preserve.
// ============================================================

const SRC = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── STUDYMAP_EXPAND_COLLAPSE_REGRESSION contracts ──\n')

type SimpleNode = { id: string; children?: SimpleNode[] };
const tree: SimpleNode = {
  id: 'root',
  children: [
    { id: 'A', children: [{ id: 'A1' }, { id: 'A2' }] },
    { id: 'B', children: [{ id: 'B1' }] },
  ],
};

// ── A/B: click-simulation harness, composing onSelect + onToggleExpand exactly like handleNodeClick ──
function simulateFirstClick(expandedSetBefore: Set<string>, clickedId: string): Set<string> {
  // onSelect's normalization (functional update reading the TRUE pre-click state)
  let next = getGuidedForwardExpansion(tree as any, clickedId, expandedSetBefore);
  // onToggleExpand, reading `next` (onSelect's result) as ITS prev
  const wasExpandedBeforeToggle = next.has(clickedId);
  next = new Set(next);
  if (wasExpandedBeforeToggle) next.delete(clickedId);
  else next.add(clickedId);
  return next;
}

test('A. collapsed branch click expands children (node.id ends up in expandedSet, ancestor path preserved)', () => {
  const before = new Set<string>(['root']); // only root expanded — A is collapsed
  const after = simulateFirstClick(before, 'A');
  assert.ok(after.has('A'), 'A must end up expanded after its first click');
  assert.ok(after.has('root'), 'ancestor path (root) must remain');
})

test('B. expanded branch click collapses children (re-clicking an already-expanded node removes it)', () => {
  const before = new Set<string>(['root', 'A']); // A already expanded
  const after = simulateFirstClick(before, 'A');
  assert.ok(!after.has('A'), 'A must end up collapsed after a second click');
  assert.ok(after.has('root'), 'ancestor path (root) must remain');
})

test('C. collapse is not immediately undone by guided context normalization (getGuidedForwardExpansion never force-adds the clicked node)', () => {
  const ancestorOnly = getGuidedAncestorPath(tree as any, 'A');
  assert.ok(!ancestorOnly.has('A'), 'the ancestor-path function must never include the target node itself');
  // Simulates: A is currently NOT expanded (e.g. right after a collapse) — normalizing again must not resurrect it.
  const composed = getGuidedForwardExpansion(tree as any, 'A', new Set(['root']));
  assert.ok(!composed.has('A'), 'normalization must preserve "not expanded" when that was the pre-click truth')
})

test('D. expansion is not immediately removed by guided context normalization (the regression this phase fixes)', () => {
  // The exact regression scenario: A was NOT expanded before the click,
  // onSelect\'s normalization runs BEFORE onToggleExpand adds it.
  const preClick = new Set<string>(['root']);
  const afterOnSelectNormalization = getGuidedForwardExpansion(tree as any, 'A', preClick);
  assert.ok(!afterOnSelectNormalization.has('A'), 'onSelect\'s own normalization must NOT pre-emptively expand the clicked node — that was the bug');
  // onToggleExpand then correctly sees "not yet expanded" and ADDS it (test A proves the composed final result).
})

test('E. unrelated old branches still collapse (B/B1 collapse away when navigating into A)', () => {
  const before = new Set<string>(['root', 'B', 'B1']); // B/B1 expanded from earlier exploration
  const after = simulateFirstClick(before, 'A');
  assert.ok(!after.has('B') && !after.has('B1'), 'unrelated branches must still be normalized away — this phase does not reintroduce accumulation');
})

test('F. ancestor path remains visible (root is always present for any descendant click)', () => {
  const after1 = simulateFirstClick(new Set(['root']), 'A');
  assert.ok(after1.has('root'));
  const before2 = new Set<string>(['root', 'A']);
  const after2 = simulateFirstClick(before2, 'A1'); // clicking a grandchild-level node (A1 has no children here, but exercise the path anyway via getGuidedAncestorPath directly)
  const ancestorPath = getGuidedAncestorPath(tree as any, 'A1');
  assert.deepEqual([...ancestorPath].sort(), ['A', 'root']);
})

test('G. camera frames newly expanded children — the focus-camera effect\'s neighborhood is unaffected by this fix (still derived from focusEmphasisIds/getNavigableNeighborhoodIds, independent of expandedSet composition)', () => {
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf("} else {\n      nodeTargetScale = transform.scale;"))
  assert.match(effectBody, /const neighborhoodIds = focusEmphasisIds \|\| new Set\(\[focusNodeId\]\);/)
})

test('H. camera reframes after collapse — focusNodeId is still set on every toggleExpand/onSelect call, so the SAME effect re-runs regardless of expand vs collapse', () => {
  const toggleExpand = SRC.match(/const toggleExpand = useCallback\(\(id: string\) => \{([\s\S]*?)\}, \[mapData, persistPatch\]\)/)
  assert.ok(toggleExpand)
  assert.match(toggleExpand![1], /setLastExpandedId\(id\);/)
})

test('I. re-click behavior is deterministic (simulateFirstClick toggles cleanly back and forth: expand, collapse, expand)', () => {
  let state = new Set<string>(['root']);
  state = simulateFirstClick(state, 'A'); assert.ok(state.has('A'), 'click 1: expand');
  state = simulateFirstClick(state, 'A'); assert.ok(!state.has('A'), 'click 2: collapse');
  state = simulateFirstClick(state, 'A'); assert.ok(state.has('A'), 'click 3: expand again');
})

test('J. Back still restores the previous LOCAL context using the INCLUSIVE getGuidedVisibleContext (unchanged, untouched by this fix)', () => {
  const backFn = SRC.slice(SRC.indexOf('const handleGuidedBack = useCallback'), SRC.indexOf('const handleGuidedBack = useCallback') + 1200)
  assert.match(backFn, /setExpandedSet\(getGuidedVisibleContext\(mapData\.root, targetNodeId\)\);/, 'Back must keep using the inclusive function — it has no click-driven toggle intent to preserve')
  assert.doesNotMatch(backFn, /getGuidedForwardExpansion/, 'Back must never use the click-toggle-aware composition — that is onSelect\'s concern only')
  // Sanity: the inclusive function still behaves as before.
  const ctx = getGuidedVisibleContext(tree as any, 'A');
  assert.deepEqual([...ctx].sort(), ['A', 'root']);
})

test('K. studiedSet is unaffected by this fix (still a pure add-only block, independent of expandedSet composition)', () => {
  const onSelectMatch = SRC.match(/<MindMap[\s\S]*?onSelect=\{\(n\)\s*=>\s*\{([\s\S]*?)\n\s*\}\}/)
  assert.ok(onSelectMatch)
  assert.match(onSelectMatch![1], /setStudiedSet\(prev => \{\s*const next = new Set\(prev\);\s*next\.add\(n\.id\);/)
})

test('L. explanation cache is unaffected by this fix (getGuidedForwardExpansion/getGuidedAncestorPath never reference it)', () => {
  const fwdStart = SRC.indexOf('export function getGuidedForwardExpansion')
  const fwdFn = SRC.slice(fwdStart, SRC.indexOf('\n}', fwdStart) + 2)
  assert.doesNotMatch(fwdFn, /explanationsByNodeId|onPersistExplanation/)
})

test('M. smooth-camera performance architecture is unchanged (imperative transformRef/contentRef hot path, one React sync at animation end, stable useEnergyLines deps)', () => {
  assert.match(SRC, /transformRef\.current = \{ x: nx, y: ny, scale: ns \};/)
  assert.match(SRC, /contentRef\.current\.style\.transform = `translate\(\$\{nx\}px, \$\{ny\}px\) scale\(\$\{ns\}\)`;/)
  const tickBody = SRC.slice(SRC.indexOf('const tick = (now: number) => {'), SRC.indexOf('raf = requestAnimationFrame(tick);\n    return () => {'))
  const perFrameSetTransform = tickBody.match(/if \(t < 1\) \{\s*raf = requestAnimationFrame\(tick\);\s*\} else \{\s*setTransform\(/)
  assert.ok(perFrameSetTransform, 'setTransform must still be reachable ONLY from the final-frame branch')
  assert.match(SRC, /\}, \[lines, canvasRef, chargeState, transformRef, boundsRef\]\);/, 'useEnergyLines must still depend on stable refs, not raw transform/bounds values')
})

test('N. zero provider calls (this fix touches only pure expandedSet-composition functions and a single call-site swap)', () => {
  const fwdStart = SRC.indexOf('export function getGuidedForwardExpansion')
  const fwdFn = SRC.slice(fwdStart, SRC.indexOf('\n}', fwdStart) + 2)
  const ancestorStart = SRC.indexOf('export function getGuidedAncestorPath')
  const ancestorFn = SRC.slice(ancestorStart, SRC.indexOf('\n}', ancestorStart) + 2)
  assert.doesNotMatch(fwdFn, /fetch\(/)
  assert.doesNotMatch(ancestorFn, /fetch\(/)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('studymap-expand-collapse-regression-contracts: ALL PASS')
