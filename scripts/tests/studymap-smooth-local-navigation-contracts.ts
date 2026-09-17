import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getGuidedVisibleContext } from '../../components/materias/ALAIStudyMap'

// ============================================================
// STUDYMAP_SMOOTH_LOCAL_NAVIGATION contracts.
//
// PART 1 — proven root causes of the reported camera jank:
//
//   1. useEnergyLines's effect took the raw `transform` VALUE as a
//      parameter, putting it in its dependency array. Every single
//      setTransform() call during a guided camera animation (formerly
//      once per rAF frame) therefore tore the ENTIRE effect down and
//      rebuilt it: cancelling+restarting its own infinite rAF loop,
//      removing+re-adding a window resize listener, and — the most
//      expensive part — re-running resize()'s
//      canvas.parentElement.getBoundingClientRect(), a SYNCHRONOUS
//      forced layout reflow, up to 60 times per second. This is the
//      dominant, structural cause of the reported jank.
//   2. The focus-camera animation called setTransform() (React state)
//      on every rAF tick — a full MindMap re-render (re-running
//      layout.map(...) for every currently-expanded node: wrapText,
//      color/opacity/glow computation, JSX allocation) up to 60 times
//      per second. This compounds (2) grows worse the more nodes
//      remain expanded — directly connecting Part 1 and Part 2's bugs.
//
// Fix: (1) useEnergyLines now reads transform/bounds through STABLE
// REFS (transformRef/boundsRef) — the values can change every frame
// without ever changing the ref's identity, so the effect never re-
// runs because of them. (2) The camera animation writes ONLY to
// transformRef + the DOM node directly (contentRef.style.transform)
// during every intermediate frame, and calls setTransform() (a real
// React state sync) exactly ONCE, on the final frame.
//
// PART 2 — expandedSet no longer accumulates indefinitely.
// getGuidedVisibleContext(root, currentNodeId) is the new canonical,
// pure helper: the MINIMAL set of node ids that must be expanded to
// render the current node's structural ancestor path plus itself
// (which reveals its own immediate forward children/relation-details).
// It is applied by REPLACING (never merging into) expandedSet on every
// guided navigation — forward selection AND Back — so unrelated
// branches opened earlier in the session collapse away automatically.
// ============================================================

const SRC = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── STUDYMAP_SMOOTH_LOCAL_NAVIGATION contracts ──\n')

// A tree: root -> [A, B] (two top-level branches); A -> [A1, A2]; A1 -> [A1a] (detail)
type SimpleNode = { id: string; children?: SimpleNode[] };
const tree: SimpleNode = {
  id: 'root',
  children: [
    { id: 'A', children: [{ id: 'A1', children: [{ id: 'A1a' }] }, { id: 'A2' }] },
    { id: 'B', children: [{ id: 'B1' }] },
  ],
};

test('A. root overview remains unchanged — the mount-time smart-fit path is untouched by this phase', () => {
  assert.match(SRC, /if \(prevOrigin === null\) \{/)
  assert.match(SRC, /setTransform\(computeFitTransform\(rect, svgW, svgH\)\);\s*\n\s*return;/)
})

test('B. forward navigation to A1 shows current (A1) + immediate forward children (A1a) — via getGuidedVisibleContext', () => {
  const ctx = getGuidedVisibleContext(tree as any, 'A1');
  assert.ok(ctx.has('A1'), 'current node');
  assert.ok(ctx.has('root') && ctx.has('A'), 'structural ancestors required to render the path down to A1');
  // A1's own children are revealed by expandedSet containing A1 itself
  // (computeMindMapLayout lays out a node's children iff the node ITSELF
  // is expanded) — not by A1a needing to be in the set.
})

test('C. navigating deeper (A -> A1) collapses unrelated previously-expanded branches (B, B1)', () => {
  // Simulates: student first expanded B/B1, then navigated to A1.
  const ctxAtA1 = getGuidedVisibleContext(tree as any, 'A1');
  assert.ok(!ctxAtA1.has('B') && !ctxAtA1.has('B1'), 'B/B1 must not be part of the new local context just because they were expanded earlier');
  assert.ok(!ctxAtA1.has('A2'), 'A1\'s OWN sibling A2 must also not be forced into the visible context — only the ancestor path + current node');
})

test('D. Back restores the previous node\'s LOCAL context (not the global expandedSet at the time of Back)', () => {
  const backFn = SRC.slice(SRC.indexOf('const handleGuidedBack = useCallback'), SRC.indexOf('const handleGuidedBack = useCallback') + 1200)
  assert.match(backFn, /setExpandedSet\(getGuidedVisibleContext\(mapData\.root, targetNodeId\)\);/, 'Back must normalize expandedSet to the DESTINATION node\'s own local context')
})

test('E. Back does not restore every historically expanded descendant (getGuidedVisibleContext never looks at descendants beyond the ancestor path)', () => {
  // Back from A1 to A: A\'s local context must NOT include A1\'s own
  // child A1a, nor B/B1, even though all of those may still be sitting
  // in the (now-superseded) global expandedSet from earlier exploration.
  const ctxAtA = getGuidedVisibleContext(tree as any, 'A');
  assert.deepEqual([...ctxAtA].sort(), ['A', 'root']);
})

test('F. Back to root shows root + immediate branches only (root\'s own children reveal exactly the top-level branches — the accepted overview shape)', () => {
  const ctxAtRoot = getGuidedVisibleContext(tree as any, 'root');
  assert.deepEqual([...ctxAtRoot], ['root']);
  // Root being the sole expanded id is exactly what computeMindMapLayout
  // needs to lay out ALL of root's direct children (every root branch) —
  // matches the accepted initial overview shape.
})

test('G. studiedSet survives visual collapse (independent state, never derived from or reset by expandedSet normalization)', () => {
  const onSelectMatch = SRC.match(/<MindMap[\s\S]*?onSelect=\{\(n\)\s*=>\s*\{([\s\S]*?)\n\s*\}\}/)
  assert.ok(onSelectMatch)
  assert.doesNotMatch(onSelectMatch![1], /setExpandedSet\(getGuidedVisibleContext[^)]*\)\)[^;]*;\s*setStudiedSet\(prev => \{[\s\S]*?next\.delete/, 'normalizing expandedSet must never delete anything from studiedSet')
  assert.match(onSelectMatch![1], /setStudiedSet\(prev => \{\s*const next = new Set\(prev\);\s*next\.add\(n\.id\);/, 'studied marking must still be a pure ADD, unaffected by expansion normalization')
  const backFn = SRC.slice(SRC.indexOf('const handleGuidedBack = useCallback'), SRC.indexOf('const handleGuidedBack = useCallback') + 1200)
  assert.doesNotMatch(backFn, /studiedSet|setStudiedSet/, 'Back must never read or write studiedSet')
})

test('H. explanation cache survives visual collapse (Back/normalization never touches explanationsByNodeId/onPersistExplanation)', () => {
  const backFn = SRC.slice(SRC.indexOf('const handleGuidedBack = useCallback'), SRC.indexOf('const handleGuidedBack = useCallback') + 1200)
  assert.doesNotMatch(backFn, /explanationsByNodeId|onPersistExplanation|activeExplainKeyRef/)
  const getContextFn = SRC.slice(SRC.indexOf('export function getGuidedVisibleContext'), SRC.indexOf('return new Set(chain.map(n => n.id));') + 40)
  assert.doesNotMatch(getContextFn, /explanationsByNodeId|onPersistExplanation/)
})

test('I. navigation stack remains deterministic (unchanged pure push/pop reducers)', () => {
  assert.match(SRC, /export function pushGuidedNavigation\(/)
  assert.match(SRC, /export function popGuidedNavigation\(/)
})

test('J. panel open/closed framing remains correct — reserveRight/reserveBottom still feed the same guided framing call, untouched by this phase', () => {
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf("} else {\n      nodeTargetScale = transform.scale;"))
  assert.match(effectBody, /\{ width: effectiveWidth, height: effectiveHeight \}/)
})

test('K. no global fit is introduced by this phase (guided branch still never calls computeFitTransform)', () => {
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf("} else {\n      nodeTargetScale = transform.scale;"))
  assert.doesNotMatch(effectBody, /computeFitTransform/)
})

test('L. only one camera animation may own rAF at a time (effect cleanup cancels the in-flight frame before any next run)', () => {
  const focusEffect = SRC.slice(SRC.indexOf('GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'), SRC.indexOf("}, [focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds]);"))
  assert.match(focusEffect, /return \(\) => \{\s*cancelAnimationFrame\(raf\);/)
})

test('M. starting new navigation cancels the previous animation (the effect deps include focusNodeId — a genuinely new focus always re-runs the effect, running the cleanup above first)', () => {
  assert.match(SRC, /\}, \[focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds\]\);/)
})

test('N. camera animation does not recompute academic tree/layout per frame (layout is memoized on [data, expandedSet], neither of which the animation tick ever touches)', () => {
  const tickBody = SRC.slice(SRC.indexOf('const tick = (now: number) => {'), SRC.indexOf('raf = requestAnimationFrame(tick);\n    return () => {'))
  assert.doesNotMatch(tickBody, /computeMindMapLayout|setExpandedSet|getGuidedVisibleContext|getNavigableNeighborhoodIds/, 'the per-frame tick must never call layout/tree/neighborhood computation')
  assert.match(SRC, /const \{ layout, bounds \} = useMemo\(\(\) => \{\s*if \(process\.env\.NODE_ENV !== 'production'\) perfRef\.current\.layoutComputations\+\+;\s*return computeMindMapLayout\(data, expandedSet\);\s*\}, \[data, expandedSet\]\);/, 'layout must remain memoized on [data, expandedSet] only')
})

test('O. the hot animation path does not require a full React re-render per frame — setTransform (React state) is called ONLY once, on the final frame, not inside the per-frame branch', () => {
  const tickBody = SRC.slice(SRC.indexOf('const tick = (now: number) => {'), SRC.indexOf('raf = requestAnimationFrame(tick);\n    return () => {'))
  assert.match(tickBody, /transformRef\.current = \{ x: nx, y: ny, scale: ns \};/, 'every frame writes the ref')
  assert.match(tickBody, /contentRef\.current\.style\.transform = `translate\(\$\{nx\}px, \$\{ny\}px\) scale\(\$\{ns\}\)`;/, 'every frame writes the DOM node directly, bypassing React')
  const perFrameSetTransform = tickBody.match(/if \(t < 1\) \{\s*raf = requestAnimationFrame\(tick\);\s*\} else \{\s*setTransform\(/)
  assert.ok(perFrameSetTransform, 'setTransform must be reachable ONLY from the t>=1 (final-frame) branch, never the t<1 (intermediate-frame) branch')
})

test('P. large/previously-expanded map does not change the local camera target (computeGuidedFramingTransform is still fed ONLY the current neighborhood, never the full layout/expandedSet)', () => {
  const effectBody = SRC.slice(SRC.indexOf('if (guidedMode) {'), SRC.indexOf("} else {\n      nodeTargetScale = transform.scale;"))
  assert.match(effectBody, /const neighborhoodIds = focusEmphasisIds \|\| new Set\(\[focusNodeId\]\);/)
  assert.match(effectBody, /layout\s*\n\s*\.filter\(n => neighborhoodIds\.has\(n\.node\.id\)\)/)
})

test('Q. camera/navigation/back cause zero provider calls', () => {
  const getContextFn = SRC.slice(SRC.indexOf('export function getGuidedVisibleContext'), SRC.indexOf('return new Set(chain.map(n => n.id));') + 40)
  assert.doesNotMatch(getContextFn, /fetch\(/)
  const backFn = SRC.slice(SRC.indexOf('const handleGuidedBack = useCallback'), SRC.indexOf('const handleGuidedBack = useCallback') + 1200)
  assert.doesNotMatch(backFn, /fetch\(/)
  const perfLogBlock = SRC.slice(SRC.indexOf("console.info('[studymap-camera-perf]'"), SRC.indexOf("console.info('[studymap-camera-perf]'") + 400)
  assert.doesNotMatch(perfLogBlock, /fetch\(/)
})

test('Performance diagnostic exists, DEV-only, and logs counts only (never material content — no label/statement/summary text)', () => {
  assert.match(SRC, /if \(isDev\) \{\s*perfRef\.current\.transformStateSyncs\+\+;/)
  const perfLogBlock = SRC.slice(SRC.indexOf("console.info('[studymap-camera-perf]'"), SRC.indexOf("console.info('[studymap-camera-perf]'") + 500)
  assert.match(perfLogBlock, /frames: frameCount,/)
  assert.match(perfLogBlock, /renderedNodeCount: layout\.length,/)
  assert.match(perfLogBlock, /expandedNodeCount: expandedSet\.size,/)
  assert.match(perfLogBlock, /layoutComputationsTotal: perfRef\.current\.layoutComputations,/)
  assert.match(perfLogBlock, /transformStateSyncsTotal: perfRef\.current\.transformStateSyncs,/)
  assert.match(perfLogBlock, /activeGuidedAnimations: perfRef\.current\.activeGuidedAnimations,/)
  assert.doesNotMatch(perfLogBlock, /label|statement|summary|\.title|\.description/i, 'must log counts only, never node labels/content')
})

test('useEnergyLines no longer depends on the raw transform/bounds VALUES — only on stable refs (the proven root cause of the effect-restart-every-frame bug)', () => {
  const hookSrc = SRC.slice(SRC.indexOf('function useEnergyLines('), SRC.indexOf('}, [lines, canvasRef, chargeState, transformRef, boundsRef]);') + 100)
  assert.match(hookSrc, /transformRef: React\.MutableRefObject<\{ x: number; y: number; scale: number \}>,/)
  assert.match(hookSrc, /boundsRef: React\.MutableRefObject<\{ minX: number; minY: number \}>,/)
  assert.match(hookSrc, /\}, \[lines, canvasRef, chargeState, transformRef, boundsRef\]\);/, 'transform/bounds VALUES must be gone from the dependency array — only the stable ref objects remain')
  assert.doesNotMatch(hookSrc, /transform: \{ x: number; y: number; scale: number \},\s*\n\s*bounds: \{ minX: number; minY: number \},/, 'the old raw-value parameters must be gone')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('studymap-smooth-local-navigation-contracts: ALL PASS')
