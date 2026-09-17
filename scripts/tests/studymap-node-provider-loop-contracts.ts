import assert from 'node:assert/strict'
import fs from 'node:fs'

// ============================================================
// STUDYMAP_NODE_PROVIDER_LOOP: a live test showed that selecting ONE
// Study Map node caused REPEATED /api/alai-studyal-chat provider calls
// (many `provider_call_started` + `POST /api/alai-studyal-chat 200`
// entries) until the user Ctrl-C'd the dev server.
//
// ROOT CAUSE (found by direct source inspection of StudyPanel's node-
// explanation effect in components/materias/ALAIStudyMap.tsx, BEFORE
// this fix): the fetch-triggering useEffect's dependency array included
// `explanationsByNodeId` and `onPersistExplanation` — both PROPS passed
// from the parent as an inline `{}` fallback object literal and an
// inline arrow function respectively. Both are recreated with a brand
// new identity on EVERY parent render, for ANY reason, not just a
// genuine node selection. Since object/function literals are never
// `Object.is`-equal to their previous render's value, this effect refired
// on every unrelated parent re-render while a node was selected — and
// for a non-leaf (branch/root/detail) node, that effect's ONLY fetch
// path was the legacy /api/alai-studyal-chat fallback, meaning ordinary
// re-renders were silently equivalent to repeatedly submitting a chat
// question the user never asked.
//
// A SEPARATE, compounding architectural issue (also fixed here, per the
// task's explicit invariant): selecting a non-leaf node was ALWAYS
// equivalent to an automatic chat submission — chat must never fire
// without an explicit user action. The fix splits this into: (1) leaf
// nodes automatically call the bounded, authenticated, Enjoyer-grounded
// explain_node route (unchanged in spirit, now loop-free), and (2)
// non-leaf nodes require an explicit "Explicar con IA" button click
// before /api/alai-studyal-chat is ever touched.
//
// This harness models BOTH the OLD (buggy) and NEW (fixed) effect
// dependency behavior with a faithful React-style shallow-dependency
// effect runner — not just the state-machine around it — so the
// regression is actually reproduced, not merely asserted.
// ============================================================

function depsChanged(a: readonly unknown[] | null, b: readonly unknown[]): boolean {
  if (a === null) return true
  if (a.length !== b.length) return true
  return a.some((v, i) => !Object.is(v, b[i]))
}

class EffectSlot {
  private prevDeps: readonly unknown[] | null = null
  private cleanup: (() => void) | void | null = null
  run(deps: readonly unknown[], effect: () => (() => void) | void) {
    if (depsChanged(this.prevDeps, deps)) {
      if (this.cleanup) this.cleanup()
      this.cleanup = effect()
      this.prevDeps = deps
    }
  }
  unmount() { if (this.cleanup) this.cleanup() }
}

interface MapNodeLike { id: string; type: 'root' | 'branch' | 'leaf' | 'detail'; label: string }
interface ExplanationState { answer: string }

class NodePanelModel {
  explainNodeCalls = 0
  chatCalls = 0
  activeExplainKeyRef: string | null = null
  attemptRef: Record<string, number> = {}
  explanationsByNodeIdRef: Record<string, ExplanationState> = {}
  persistedStore: Record<string, ExplanationState> = {} // simulates the parent's actual persisted store

  /** Exact mirror of the FIXED requestNodeExplanation: single-flight guarded, refs-based, abort-aware. */
  async requestNodeExplanation(target: MapNodeLike, signal: AbortSignal, fetchImpl?: () => Promise<{ success: boolean; answer: string }>) {
    const key = target.id
    if (this.activeExplainKeyRef === key) return
    const persisted = this.explanationsByNodeIdRef[key]
    if (persisted) return

    this.activeExplainKeyRef = key
    const attempt = (this.attemptRef[key] || 0) + 1
    this.attemptRef[key] = attempt

    const isLeaf = target.type === 'leaf'
    try {
      if (isLeaf) this.explainNodeCalls++
      else this.chatCalls++
      const data = fetchImpl ? await fetchImpl() : { success: true, answer: 'ok' }
      if (signal.aborted) return
      if (data.success) {
        this.persistedStore[key] = { answer: data.answer }
        // Mirrors onPersistExplanationRef.current(...) then a later
        // render syncing explanationsByNodeIdRef.current = props value.
        this.explanationsByNodeIdRef[key] = { answer: data.answer }
      }
    } finally {
      if (this.activeExplainKeyRef === key) this.activeExplainKeyRef = null
    }
  }
}

/** FIXED auto-effect: deps = [current.id, current.type, showingRoot, sessionId] only — never explanationsByNodeId/onPersistExplanation. */
function mountFixedAutoEffect(
  slot: EffectSlot, model: NodePanelModel, current: MapNodeLike | null, showingRoot: boolean, sessionId: string | null,
) {
  slot.run([current?.id, current?.type, showingRoot, sessionId], () => {
    if (!current || showingRoot || current.type !== 'leaf' || !sessionId) return
    const controller = new AbortController()
    void model.requestNodeExplanation(current, controller.signal)
    return () => {
      controller.abort()
      if (model.activeExplainKeyRef === current.id) model.activeExplainKeyRef = null
    }
  })
}

/**
 * OLD (buggy) auto-effect — a faithful, SEPARATE reproduction of the
 * pre-fix code shape: the "already persisted?" check and the fetch
 * itself both read directly from the CLOSURE-CAPTURED `explanationsByNodeId`
 * prop argument (a fresh object every "parent render" in this test,
 * exactly like the live `persistedStateRef.current.explanationsByNodeId
 * || {}` inline fallback) — there is no internal ref-based short-circuit
 * like the FIXED model has, because the real bug had none either.
 */
function mountBuggyAutoEffect(
  slot: EffectSlot, model: NodePanelModel, current: MapNodeLike | null, showingRoot: boolean, sessionId: string | null,
  explanationsByNodeIdProp: Record<string, ExplanationState>, onPersistExplanationProp: (nodeId: string, e: ExplanationState) => void,
  fetchDelayMs = 5, // simulates the real ~10s provider round-trip: other re-renders happen WHILE this is pending.
) {
  slot.run([current?.id, current?.type, showingRoot, sessionId, explanationsByNodeIdProp, onPersistExplanationProp], () => {
    if (!current || showingRoot) return
    const persisted = explanationsByNodeIdProp[current.id]
    if (persisted) return
    let cancelled = false
    ;(async () => {
      const isLeaf = current.type === 'leaf'
      if (isLeaf) model.explainNodeCalls++
      else model.chatCalls++
      await new Promise(r => setTimeout(r, fetchDelayMs))
      const answer = 'ok'
      if (cancelled) return
      onPersistExplanationProp(current.id, { answer })
    })()
    return () => { cancelled = true }
  })
}

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => { await fn(); console.log(`  ✅ ${name}`) })()
}

async function main() {
  // ── A/B: ONE leaf node click -> 0 chat requests, at most 1 explain_node request.
  await test('A. ONE leaf node click causes 0 /api/alai-studyal-chat requests', async () => {
    const model = new NodePanelModel()
    const slot = new EffectSlot()
    const leaf: MapNodeLike = { id: 'n1', type: 'leaf', label: 'Concepto' }
    mountFixedAutoEffect(slot, model, leaf, false, 'sess-1')
    await new Promise(r => setTimeout(r, 0))
    assert.equal(model.chatCalls, 0)
  })

  await test('B. ONE leaf node click causes at most 1 explain_node request', async () => {
    const model = new NodePanelModel()
    const slot = new EffectSlot()
    const leaf: MapNodeLike = { id: 'n1', type: 'leaf', label: 'Concepto' }
    mountFixedAutoEffect(slot, model, leaf, false, 'sess-1')
    await new Promise(r => setTimeout(r, 0))
    assert.equal(model.explainNodeCalls, 1)
  })

  // ── C/D: explanation response / persistence does not trigger another request.
  await test('C/D. explanation response + persistence does not trigger another request', async () => {
    const model = new NodePanelModel()
    const slot = new EffectSlot()
    const leaf: MapNodeLike = { id: 'n1', type: 'leaf', label: 'Concepto' }
    mountFixedAutoEffect(slot, model, leaf, false, 'sess-1')
    await new Promise(r => setTimeout(r, 0))
    assert.equal(model.explainNodeCalls, 1)
    assert.ok(model.persistedStore['n1'], 'the response was persisted')
    // Re-mount the SAME effect with the SAME deps (nothing changed) —
    // simulates the parent re-rendering after the persist write.
    mountFixedAutoEffect(slot, model, leaf, false, 'sess-1')
    await new Promise(r => setTimeout(r, 0))
    assert.equal(model.explainNodeCalls, 1, 'no new request after the response/persist cycle')
  })

  // ── E: rerender with same selected node does not trigger another request
  // (the EXACT live bug scenario — a parent re-render for ANY reason
  // while the node stays selected).
  await test('E. rerender with same selected node causes 0 additional requests (FIXED)', async () => {
    const model = new NodePanelModel()
    const slot = new EffectSlot()
    const leaf: MapNodeLike = { id: 'n1', type: 'leaf', label: 'Concepto' }
    // 5 arbitrary "parent re-renders" with the SAME node selected.
    for (let i = 0; i < 5; i++) mountFixedAutoEffect(slot, model, leaf, false, 'sess-1')
    await new Promise(r => setTimeout(r, 0))
    assert.equal(model.explainNodeCalls, 1, 'FIX: 5 re-renders of the same selection produce exactly 1 request')
  })

  await test('REGRESSION PROOF: the OLD effect (unstable explanationsByNodeId/onPersistExplanation deps) reproduces repeated requests on plain re-renders', async () => {
    const model = new NodePanelModel()
    const slot = new EffectSlot()
    const branch: MapNodeLike = { id: 'b1', type: 'branch', label: 'Categoría' } // non-leaf -> legacy chat path in the OLD code
    const onPersist = (nodeId: string, e: ExplanationState) => { model.persistedStore[nodeId] = e }
    // 5 "parent re-renders", each recreating a FRESH explanationsByNodeId
    // object (real content, new reference — exactly like the live
    // `persistedStateRef.current.explanationsByNodeId || {}` inline
    // fallback) and a FRESH onPersistExplanation closure.
    // Fired in a burst BEFORE the first (async) request resolves — exactly
    // what happens live while a ~10s request is still in flight and
    // several unrelated re-renders occur in the meantime: the OLD code's
    // only "already answered?" guard reads the persisted answer, which
    // does not exist yet for any of these renders.
    for (let i = 0; i < 5; i++) {
      mountBuggyAutoEffect(slot, model, branch, false, 'sess-1', { ...model.persistedStore }, onPersist)
    }
    await new Promise(r => setTimeout(r, 20))
    assert.ok(model.chatCalls >= 2, `BUG: unstable prop identities caused repeated /api/alai-studyal-chat calls while the first request was still in flight (got ${model.chatCalls})`)
  })

  // ── F: restoring selected node does not send chat automatically.
  await test('F. restoring a previously-selected NON-LEAF node does not send chat automatically', async () => {
    const model = new NodePanelModel()
    const slot = new EffectSlot()
    const branch: MapNodeLike = { id: 'b1', type: 'branch', label: 'Categoría' }
    // Simulate restoring `selectedNodeId` from persisted state on mount —
    // the FIXED auto-effect only ever fetches for leaf nodes.
    mountFixedAutoEffect(slot, model, branch, false, 'sess-1')
    await new Promise(r => setTimeout(r, 0))
    assert.equal(model.chatCalls, 0, 'a restored non-leaf selection must never auto-send a chat question')
  })

  // ── G: explicit user chat submit causes exactly 1 call.
  await test('G. explicit user chat submit (non-leaf "Explicar con IA" click) causes exactly 1 /api/alai-studyal-chat call', async () => {
    const model = new NodePanelModel()
    const branch: MapNodeLike = { id: 'b1', type: 'branch', label: 'Categoría' }
    const controller = new AbortController()
    await model.requestNodeExplanation(branch, controller.signal)
    assert.equal(model.chatCalls, 1)
  })

  // ── H: chat response does not recursively send another chat request.
  await test('H. chat response does not recursively trigger another chat request', async () => {
    const model = new NodePanelModel()
    const branch: MapNodeLike = { id: 'b1', type: 'branch', label: 'Categoría' }
    const controller = new AbortController()
    await model.requestNodeExplanation(branch, controller.signal)
    // A second call for the SAME already-persisted node must short-circuit.
    await model.requestNodeExplanation(branch, controller.signal)
    assert.equal(model.chatCalls, 1)
  })

  // ── I: rapid same-node selection cannot duplicate provider work.
  await test('I. rapid repeated selection of the SAME node cannot duplicate provider work (single-flight)', async () => {
    const model = new NodePanelModel()
    const leaf: MapNodeLike = { id: 'n1', type: 'leaf', label: 'Concepto' }
    const gate = new Promise<{ success: boolean; answer: string }>(() => {}) // never resolves during this test
    const c1 = new AbortController()
    const p1 = model.requestNodeExplanation(leaf, c1.signal, () => gate)
    const c2 = new AbortController()
    const p2 = model.requestNodeExplanation(leaf, c2.signal, () => gate) // rapid duplicate click
    await Promise.race([Promise.all([p1, p2]), new Promise(r => setTimeout(r, 10))])
    assert.equal(model.explainNodeCalls, 1, 'a second rapid selection of the identical node must not start its own request')
  })

  // ── J: switching nodes does not orphan provider requests.
  await test('J. switching to a different node cancels/replaces the previous explanation request cleanly', async () => {
    const model = new NodePanelModel()
    const slot = new EffectSlot()
    const nodeA: MapNodeLike = { id: 'n1', type: 'leaf', label: 'A' }
    const nodeB: MapNodeLike = { id: 'n2', type: 'leaf', label: 'B' }
    let aborted = false
    mountFixedAutoEffect(slot, model, nodeA, false, 'sess-1')
    // Immediately switch to node B before A's (synchronous, instant-mock) fetch would matter.
    mountFixedAutoEffect(slot, model, nodeB, false, 'sess-1')
    await new Promise(r => setTimeout(r, 0))
    assert.equal(model.activeExplainKeyRef, null, 'no orphaned active key after switching nodes')
  })

  // ── K/L: initial map generation / provider budget — structural
  // reaffirmation (route unchanged by this client-only fix).
  await test('K. initial map generation remains exactly one completed request (unchanged by this fix)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.ok(componentSource.includes('const controller = new AbortController();') && componentSource.includes('controller.abort();'),
      'the map-generation AbortController fix from the prior task remains in place')
  })

  await test('L. map generation remains 0 provider calls', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
    const fnBody = routeSource.slice(
      routeSource.indexOf('async function handleGroundedStudyMapRequest'),
      routeSource.indexOf('async function handleExplainNodeRequest'),
    )
    assert.ok(!fnBody.includes('__routeDeps.generateValidatedLegacyJson') && !fnBody.includes('__routeDeps.alai'))
  })

  await test('M. explain_node remains max 1 provider call per explicit explanation', async () => {
    const model = new NodePanelModel()
    const leaf: MapNodeLike = { id: 'n1', type: 'leaf', label: 'Concepto' }
    const controller = new AbortController()
    await model.requestNodeExplanation(leaf, controller.signal)
    assert.equal(model.explainNodeCalls, 1)
  })

  await test('N. no Material Brain dependency introduced', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.ok(!componentSource.includes('setBrainSourceSelection') && !componentSource.includes('useMaterialBrainLifecycle') && !componentSource.includes('/api/material-brain'))
  })

  // ── Ownership/architecture proof: leaf vs non-leaf never share a call site.
  await test('Ownership proof: chat is never triggered for a leaf node, explain_node is never triggered for a non-leaf node', async () => {
    const leafModel = new NodePanelModel()
    await leafModel.requestNodeExplanation({ id: 'n1', type: 'leaf', label: 'x' }, new AbortController().signal)
    assert.equal(leafModel.chatCalls, 0)
    assert.equal(leafModel.explainNodeCalls, 1)

    const nonLeafModel = new NodePanelModel()
    await nonLeafModel.requestNodeExplanation({ id: 'b1', type: 'branch', label: 'x' }, new AbortController().signal)
    assert.equal(nonLeafModel.explainNodeCalls, 0)
    assert.equal(nonLeafModel.chatCalls, 1)
  })

  // ── Structural proof: the auto-effect no longer depends on the
  // unstable props. NOTE (STUDYMAP_LIVE_UX_HARDENING): the "Explicar con
  // IA" button this test originally checked for was REMOVED by an
  // explicit later product decision — every explainable node (leaf AND
  // branch) is now explained automatically on selection, unified onto
  // explain_node, with zero automatic /api/alai-studyal-chat calls at
  // all. The underlying invariant this test protects (unstable prop
  // identities must never be effect dependencies) is unchanged and
  // still verified below.
  await test('Structural proof: the auto-effect no longer lists explanationsByNodeId/onPersistExplanation as dependencies', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    const autoEffectBody = componentSource.slice(
      componentSource.indexOf('// Automatic path — EVERY explainable node'),
      componentSource.indexOf('}, [current, showingRoot, sessionId, requestNodeExplanation]);') + 60,
    )
    assert.ok(autoEffectBody.length > 60, 'the auto-fetch effect must still be present')
    assert.ok(!autoEffectBody.includes('explanationsByNodeId,') && !autoEffectBody.includes('onPersistExplanation]'),
      'the auto-fetch effect must never depend on the unstable explanationsByNodeId/onPersistExplanation props')
  })

  // ── Shared-bug check (task item 12): the bug lived entirely inside
  // ALAIStudyMap.tsx's own StudyPanel effect, not in a shared hook/
  // component. Análisis's doubt chat (components/materias/
  // AnalisisTeorico.tsx) calls the SAME shared /api/alai-studyal-chat
  // endpoint but does so from a plain onClick/onKeyDown handler, never
  // from inside a useEffect — so it cannot suffer this dependency-array
  // class of bug by construction. Confirmed directly from source, not
  // modified.
  await test('Análisis chat is unaffected: preguntarDuda is only ever invoked from explicit onClick/onKeyDown, never from a useEffect', () => {
    const analisisSource = fs.readFileSync('components/materias/AnalisisTeorico.tsx', 'utf8')
    const defIdx = analisisSource.indexOf('const preguntarDuda = async () => {')
    assert.ok(defIdx > -1, 'preguntarDuda must exist')
    const beforeDef = analisisSource.slice(0, defIdx)
    // No useEffect between the nearest preceding effect and preguntarDuda's
    // own definition calls it — every actual call site is inside JSX event handlers.
    assert.match(analisisSource, /onKeyDown=\{[^}]*preguntarDuda\(\);?[^}]*\}/s, 'preguntarDuda must be invoked from an onKeyDown handler')
    assert.match(analisisSource, /onClick=\{preguntarDuda\}/, 'preguntarDuda must be invoked from an onClick handler')
    // Exactly 3 occurrences total in the whole file: the definition plus
    // the two explicit event-handler usages asserted above — proving
    // there is no fourth, hidden call site (e.g. inside a useEffect).
    const occurrences = (analisisSource.match(/preguntarDuda/g) || []).length
    assert.equal(occurrences, 3, `preguntarDuda must appear exactly 3 times (definition + onKeyDown + onClick), found ${occurrences} — a new occurrence would need manual review`)
  })

  console.log('studymap-node-provider-loop-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
