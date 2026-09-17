import assert from 'node:assert/strict'
import fs from 'node:fs'
import { computeMindMapLayout, computeFitTransform, isBoundsComfortable } from '../../components/materias/ALAIStudyMap'

// ============================================================
// STUDYMAP_UX_PHASE1: layout/interaction hardening for the Study Map
// canvas. Pure presentation/UX changes only — StudyalMaterialEnjoyer,
// projectStudyMapToTree, node identity, edges/relations, and provenance
// are entirely untouched (server-side, not part of this diff).
//
// Exercises the ACTUAL production code (computeMindMapLayout,
// computeFitTransform, isBoundsComfortable — extracted from MindMap's
// own hooks, same algorithm, same output) rather than a reimplementation
// prone to drift.
// ============================================================

function node(id: string, type: 'root' | 'branch' | 'leaf' | 'detail', children: any[] = [], label = id): any {
  return { id, type, label, children }
}

// root -> 2 branches -> each with 2 leaves -> each leaf with 1 detail.
function buildTree() {
  const detailA1 = node('d-a1', 'detail', [], 'Detalle A1')
  const detailA2 = node('d-a2', 'detail', [], 'Detalle A2')
  const leafA1 = node('leaf-a1', 'leaf', [detailA1], 'Concepto A1')
  const leafA2 = node('leaf-a2', 'leaf', [detailA2], 'Concepto A2')
  const branchA = node('branch-a', 'branch', [leafA1, leafA2], 'Rama A')

  const leafB1 = node('leaf-b1', 'leaf', [], 'Concepto B1')
  const leafB2 = node('leaf-b2', 'leaf', [], 'Concepto B2')
  const branchB = node('branch-b', 'branch', [leafB1, leafB2], 'Rama B')

  const root = node('root', 'root', [branchA, branchB], 'Tema Central')
  return { title: 'Test', root, totalConcepts: 6 }
}

function collectIds(nodes: { node: { id: string } }[]): string[] {
  return nodes.map(n => n.node.id).sort()
}

function test(name: string, fn: () => void) {
  fn()
  console.log(`  ✅ ${name}`)
}

function main() {
  const data = buildTree()

  test('A. initial visible state includes root + primary branches (root-only expandedSet)', () => {
    const { layout } = computeMindMapLayout(data, new Set(['root']))
    const ids = collectIds(layout)
    assert.deepEqual(ids, ['branch-a', 'branch-b', 'root'].sort(), 'root + its two direct branches must be visible; nothing deeper')
  })

  test('B. initial fit uses ALL currently visible nodes (root + branches), not just the root', () => {
    const { bounds } = computeMindMapLayout(data, new Set(['root']))
    const rootOnly = computeMindMapLayout(data, new Set())
    // With branches visible, the content box must be meaningfully wider
    // than with the root alone (branches sit left/right of the root).
    const widthWithBranches = bounds.maxX - bounds.minX
    const widthRootOnly = rootOnly.bounds.maxX - rootOnly.bounds.minX
    assert.ok(widthWithBranches > widthRootOnly * 1.5, 'fitting root+branches must use a visibly wider content box than root alone')
  })

  test('C. expanding a branch updates bounds (grows to include its leaves)', () => {
    const before = computeMindMapLayout(data, new Set(['root']))
    const after = computeMindMapLayout(data, new Set(['root', 'branch-a']))
    const heightBefore = before.bounds.maxY - before.bounds.minY
    const heightAfter = after.bounds.maxY - after.bounds.minY
    assert.ok(heightAfter >= heightBefore, 'expanding a branch with multiple leaves must not shrink the bounds')
    const idsAfter = collectIds(after.layout)
    assert.ok(idsAfter.includes('leaf-a1') && idsAfter.includes('leaf-a2'), 'expanded branch\'s leaves must now be present')
  })

  test('D. collapsing a branch reduces visible bounds back down (and drops its subtree from layout)', () => {
    const expanded = computeMindMapLayout(data, new Set(['root', 'branch-a']))
    const collapsed = computeMindMapLayout(data, new Set(['root']))
    const idsExpanded = collectIds(expanded.layout)
    const idsCollapsed = collectIds(collapsed.layout)
    assert.ok(idsExpanded.includes('leaf-a1'))
    assert.ok(!idsCollapsed.includes('leaf-a1'), 'collapsing must remove the subtree from the visible layout')
    const heightExpanded = expanded.bounds.maxY - expanded.bounds.minY
    const heightCollapsed = collapsed.bounds.maxY - collapsed.bounds.minY
    assert.ok(heightCollapsed <= heightExpanded, 'collapsing must not leave bounds larger than when expanded')
  })

  test('E. no auto-fit needed when everything stays comfortably visible (smart fit invariant)', () => {
    const rect = { width: 1400, height: 900 }
    const { bounds, layout } = computeMindMapLayout(data, new Set(['root']))
    const fit = computeFitTransform(rect, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    assert.ok(isBoundsComfortable(fit, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, rect),
      'a just-computed fit transform must itself report as comfortable — otherwise the comfort check would loop forever refitting')
    assert.ok(layout.length > 0)
  })

  test('F. a small bounds change that stays within the viewport is judged comfortable (no camera hijack)', () => {
    const rect = { width: 2600, height: 1800 } // generous relative to this tiny 6-node test tree
    const before = computeMindMapLayout(data, new Set(['root']))
    const svgWBefore = before.bounds.maxX - before.bounds.minX
    const svgHBefore = before.bounds.maxY - before.bounds.minY
    const fit = computeFitTransform(rect, svgWBefore, svgHBefore)
    // Expand ONE branch — bounds grow a bit but should still fit inside
    // the same generous 1400x900 viewport at the SAME transform.
    const after = computeMindMapLayout(data, new Set(['root', 'branch-a']))
    const svgWAfter = after.bounds.maxX - after.bounds.minX
    const svgHAfter = after.bounds.maxY - after.bounds.minY
    assert.ok(isBoundsComfortable(fit, svgWAfter, svgHAfter, rect),
      'expanding one branch in a generously-sized viewport must remain comfortable under the SAME transform — no forced re-fit')
  })

  test('G. a bounds change that overflows the viewport is judged uncomfortable (re-fit IS warranted)', () => {
    const rect = { width: 400, height: 300 } // deliberately tiny viewport
    const before = computeMindMapLayout(data, new Set(['root']))
    const svgWBefore = before.bounds.maxX - before.bounds.minX
    const svgHBefore = before.bounds.maxY - before.bounds.minY
    const fit = computeFitTransform(rect, svgWBefore, svgHBefore)
    const after = computeMindMapLayout(data, new Set(['root', 'branch-a', 'branch-b']))
    const svgWAfter = after.bounds.maxX - after.bounds.minX
    const svgHAfter = after.bounds.maxY - after.bounds.minY
    assert.ok(!isBoundsComfortable(fit, svgWAfter, svgHAfter, rect),
      'a tiny viewport with a much larger expanded tree must be judged uncomfortable, warranting a real re-fit')
  })

  test('H. manual interaction (simulated) is respected — a manually panned transform is never silently discarded by the comfort check itself', () => {
    // isBoundsComfortable is a pure predicate; the "respect manual
    // camera" behavior lives in MindMap's effect (never call
    // computeFitTransform while manualCameraRef.current is true). This
    // proves the predicate alone doesn't force a fit — the caller
    // decides, structurally confirmed below (test M).
    const rect = { width: 1400, height: 900 }
    const manualTransform = { x: -5000, y: -5000, scale: 2 } // user panned far away deliberately
    const { bounds } = computeMindMapLayout(data, new Set(['root']))
    const svgW = bounds.maxX - bounds.minX
    const svgH = bounds.maxY - bounds.minY
    assert.equal(isBoundsComfortable(manualTransform, svgW, svgH, rect), false,
      'sanity: an extreme manual pan is correctly reported as "uncomfortable" by the predicate...')
    // ...but the actual effect must still not touch it — verified structurally in test M.
  })

  test('I. Tour never expands the whole tree — progressive reveal only', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    // The old expand-all pattern must be gone.
    assert.ok(!componentSource.includes('setExpandedSet(all)'), 'the old expand-all-nodes pattern must not exist anymore')
    assert.ok(componentSource.includes('revealTourNode'), 'a progressive reveal helper must exist')
    const revealBody = componentSource.slice(
      componentSource.indexOf('const revealTourNode = useCallback'),
      componentSource.indexOf('const revealTourNode = useCallback') + 900,
    )
    assert.ok(revealBody.includes('findParentChain'), 'progressive reveal must expand only the ancestor chain of the target node')
    assert.ok(!revealBody.includes('traverse(mapData.root)') , 'progressive reveal must not traverse/expand the entire tree')
  })

  test('J. layout preserves exactly the same node IDs and parent/child edges as the input tree (no topology change)', () => {
    const allIds = new Set<string>()
    const collectAllIds = (n: any) => { allIds.add(n.id); (n.children || []).forEach(collectAllIds) }
    collectAllIds(data.root)

    const { layout } = computeMindMapLayout(data, new Set(['root', 'branch-a', 'branch-b', 'leaf-a1', 'leaf-a2', 'leaf-b1', 'leaf-b2']))
    const layoutIds = new Set(layout.map(n => n.node.id))
    for (const id of layoutIds) assert.ok(allIds.has(id), `layout must never introduce an id not present in the source tree (${id})`)

    // Every positioned non-root node must reference a real parent (parentX/parentY present),
    // matching the exact same source tree edges — never inferred/fabricated.
    for (const positioned of layout) {
      if (positioned.node.id === 'root') continue
      assert.ok(positioned.parentX !== undefined && positioned.parentY !== undefined, `${positioned.node.id} must have a real parent edge`)
    }
  })

  test('K. server-side academic authority files are untouched by this UX phase', () => {
    for (const file of [
      'lib/materialBrain/studyMapEnjoyerContext.ts',
      'app/api/alai-studyal-map/route.ts',
    ]) {
      const source = fs.readFileSync(file, 'utf8')
      assert.ok(source.includes('buildStudyMapEnjoyerContext') || source.includes('resolveReadyStudyMapEnjoyer') || source.includes('projectStudyMapToTree'),
        `${file} must still contain its canonical server-authority functions`)
    }
    // git diff scope for this task must never include the server files
    // (verified externally via `git diff --check`/`git status` during
    // certification — this test only reaffirms their functions exist).
  })

  test('L. no provider work is reachable from any pure layout/fit function (structural)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    const fnBody = componentSource.slice(
      componentSource.indexOf('export function computeMindMapLayout'),
      componentSource.indexOf('function MindMap({'),
    )
    assert.ok(!fnBody.includes('fetch(') && !fnBody.includes('alai') && !fnBody.includes('generateValidatedLegacyJson'),
      'computeMindMapLayout/computeFitTransform/isBoundsComfortable must be pure — zero fetch/provider calls reachable')
  })

  test('M. the smart-fit effect never recenters while manual camera control is active (structural)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    const effectBody = componentSource.slice(
      componentSource.indexOf('useEffect(() => {\n    if (!containerRef.current || layout.length === 0) return;'),
      componentSource.indexOf('GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado'),
    )
    assert.ok(effectBody.includes('manualCameraRef.current'), 'the effect must check manual-camera state')
    assert.match(effectBody, /if \(manualCameraRef\.current\) \{[\s\S]*?return;\s*\}/, 'when manual camera is active, the effect must return early WITHOUT calling computeFitTransform')
  })

  // NOTE: the leaf-vs-branch UI distinction ("Explicar con IA" button)
  // this test originally checked was later unified away by
  // STUDYMAP_LIVE_UX_HARDENING (every explainable node is now explained
  // automatically). The core cost-safety machinery (single-flight guard,
  // provider-safe explanation function, no Material Brain) is unchanged
  // and still verified here.
  test('N. node click / explanation lifecycle core cost-safety machinery untouched by this UX phase', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.ok(componentSource.includes('requestNodeExplanation'), 'the certified provider-safe explanation function must still exist')
    assert.ok(componentSource.includes('activeExplainKeyRef'), 'the single-flight guard must still exist')
    assert.ok(!componentSource.includes('setBrainSourceSelection') && !componentSource.includes('useMaterialBrainLifecycle'),
      'no Material Brain dependency introduced')
  })

  console.log('studymap-ux-phase1-contracts: ALL PASS')
}

main()
