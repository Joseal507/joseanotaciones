import assert from 'node:assert/strict'
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { useMaterialBrainLifecycle } from '../../lib/materialBrain/useMaterialBrainLifecycle'
import { resolveMaterialAcademicStability } from '../../lib/materialBrain/academicStability'
import { buildMaterialBrain, MAX_ENRICHMENT_ATTEMPTS_PER_LEAF } from '../../lib/materialBrain/build'
import { getOrBuildProductionBrain } from '../../lib/materialBrain/productionStore'
import type { MaterialBrain, ResolvedSourceMaterial } from '../../lib/materialBrain/types'
import type { MaterialBrainStore } from '../../lib/materialBrain/cache'

// ============================================================
// P0 STALL FIX — "Material Brain preparation stalls after base build".
//
// ROOT CAUSE: useMaterialBrainLifecycle's background enrichment poller
// was keyed (as a React useEffect dependency) on `academicStability` —
// a value that stays the SAME string ('preparing') across many
// consecutive polls. React skips re-running an effect whose every
// dependency is reference/value-equal to the previous render, so once
// two consecutive polls both reported 'preparing', the effect never
// re-executed and no further timer was ever scheduled. This is
// reproduced end-to-end below (STALL-DOM-1) using the REAL hook against
// a real DOM harness — a pure-function/policy test cannot catch this
// class of bug, since the underlying build.ts/productionStore.ts
// mechanism itself was already proven correct (STALL-3/6/7/8/9).
// ============================================================

type Snapshot = ReturnType<typeof useMaterialBrainLifecycle>

function createDom() {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>')
  ;(globalThis as any).window = window
  ;(globalThis as any).document = document
  ;(globalThis as any).navigator = window.navigator
  return { document, window }
}

async function flush() {
  await act(async () => { await Promise.resolve() })
}

async function withHookHarness(
  run: (api: { renderWithSelection: (selection: any) => Promise<void>; latest: () => Snapshot | null }) => Promise<void>,
) {
  const { document } = createDom()
  const container = document.getElementById('root') as any
  const root = createRoot(container)
  let latestSnapshot: Snapshot | null = null
  function Probe({ selection }: { selection: any }) {
    const snapshot = useMaterialBrainLifecycle(selection)
    useEffect(() => { latestSnapshot = snapshot })
    return null
  }
  async function renderWithSelection(selection: any) {
    await act(async () => { root.render(React.createElement(Probe, { selection })) })
    await flush()
  }
  try {
    await run({ renderWithSelection, latest: () => latestSnapshot })
  } finally {
    root.unmount()
  }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

// ---- helpers for the build.ts/productionStore.ts level tests ----
function material(id: string, text: string): ResolvedSourceMaterial {
  return { materialId: id, nombre: id, kind: 'pdf', text, knownPages: [1] } as any
}
function richExtractFn(unitPrefix = 'rich') {
  return async (chunk: any) => ({
    extraction: {
      units: [{ kind: 'fact', canonicalSubject: chunk.id, semanticKey: chunk.id, qualifiers: [], label: chunk.id, statement: `${unitPrefix} ${chunk.id}`, domainTags: [], provenance: [{ materialId: chunk.materialId, page: chunk.pages[0], quote: 'x', chunkId: chunk.id }], evidence: [{ materialId: chunk.materialId, page: chunk.pages[0], derivation: 'native_text', quote: 'x', chunkId: chunk.id }], importance: { tier: 'supporting', signals: ['model_judged'], confidence: 0.9 } }],
      relations: [], droppedInvalidProvenance: 0, droppedStructural: 0, warnings: [],
      telemetry: { chunkId: chunk.id, materialId: chunk.materialId, pages: chunk.pages, rawUnits: 1, rawRelations: 0, acceptedUnits: 1, acceptedRelations: 0, rejectedUnits: 0, rejectedRelations: 0, rejectedUnitRecords: [], wasRecovered: false, truncatedObjectsInResponse: 0 },
    },
  })
}
function alwaysFailExtractFn() {
  return async (chunk: any) => ({
    extraction: {
      units: [], relations: [], droppedInvalidProvenance: 0, droppedStructural: 0,
      warnings: [`chunk ${chunk.id} falló extracción tras agotar reintentos: synthetic [class:transient]`],
      telemetry: { chunkId: chunk.id, materialId: chunk.materialId, pages: chunk.pages, rawUnits: 0, rawRelations: 0, acceptedUnits: 0, acceptedRelations: 0, rejectedUnits: 0, rejectedRelations: 0, rejectedUnitRecords: [], wasRecovered: false, truncatedObjectsInResponse: 0 },
    },
  })
}
class InMemoryStore implements MaterialBrainStore {
  map = new Map<string, MaterialBrain>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, b: MaterialBrain) { this.map.set(fp, b) }
}

async function main() {
  console.log('\n── Material Brain preparation-stall regression contracts ──\n')

  // ---- STALL-1/2: base fallback leaves ARE real enrichment candidates ----
  await test('STALL-1/2: source_ready base leaves initialize enrichmentAttempts=0 and remain enrichment candidates', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-stall-12' }
    const materials = [material('mat-a', 'Contenido academico de prueba suficientemente largo. '.repeat(60))]
    const base = await buildMaterialBrain(scope, materials, { chunkSizeChars: 400, skipRichExtraction: true })
    assert.equal(base.meta.brainEnrichment, 'not_started')
    const leaves = Object.values(base.meta.subchunkCheckpoints || {})
    assert.ok(leaves.length > 0)
    for (const leaf of leaves) {
      assert.equal(leaf.usedDeterministicFallback, true)
      assert.ok((leaf.enrichmentAttempts || 0) < MAX_ENRICHMENT_ATTEMPTS_PER_LEAF, 'STALL-2 base leaves must start with attempts < budget, never pre-exhausted')
    }
  })

  // ---- STALL-3/9: preparing state always implies runnable work exists ----
  await test('STALL-3/9: academicStability=preparing structurally implies runnable enrichment candidates remain (no impossible stuck state)', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-stall-39' }
    const materials = [material('mat-a', 'Contenido academico de prueba suficientemente largo. '.repeat(60))]
    const base = await buildMaterialBrain(scope, materials, { chunkSizeChars: 400, skipRichExtraction: true })
    const stability = resolveMaterialAcademicStability(base)
    assert.equal(stability, 'preparing')
    const runnable = Object.values(base.meta.subchunkCheckpoints || {}).filter(
      l => l.usedDeterministicFallback && (l.enrichmentAttempts || 0) < MAX_ENRICHMENT_ATTEMPTS_PER_LEAF,
    )
    assert.ok(runnable.length > 0, 'STALL-9: preparing with zero runnable leaves must never happen — build.ts computes brainEnrichment from exactly this condition')
  })

  // ---- STALL-4/5: multi-batch continuation through the REAL orchestration layer ----
  await test('STALL-4: 14 leaves, batchSize=8 -> continues through more than one pass to terminal', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-stall-4' }
    const materials = [material('mat-a', 'Contenido academico de prueba suficientemente largo para catorce leaves reales. '.repeat(150))]
    const store = new InMemoryStore()
    const r1 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    const totalLeaves = Object.keys(r1.brain?.meta.subchunkCheckpoints || {}).length
    assert.ok(totalLeaves >= 9, `fixture sanity: expected >=9 leaves for a multi-batch test, got ${totalLeaves}`)
    let pass = 0
    let brain = r1.brain!
    while (resolveMaterialAcademicStability(brain) === 'preparing' && pass < totalLeaves) {
      pass++
      const r = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, enrichmentBatchSize: 8, extractFn: richExtractFn() as any })
      brain = r.brain!
    }
    assert.ok(pass >= 2, `STALL-4: must require more than one enrichment pass for ${totalLeaves} leaves at batchSize=8, took ${pass}`)
    assert.equal(resolveMaterialAcademicStability(brain), 'stable_rich')
  })

  await test('STALL-5: 40 leaves, batchSize=8 -> 5+ continuation cycles to terminal, no remount required', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-stall-5' }
    const materials = [material('mat-a', 'Contenido academico extenso repetido muchas veces para generar cuarenta leaves reales de prueba sintetica. '.repeat(420))]
    const store = new InMemoryStore()
    const r1 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    const totalLeaves = Object.keys(r1.brain?.meta.subchunkCheckpoints || {}).length
    assert.ok(totalLeaves >= 30, `fixture sanity: expected >=30 leaves, got ${totalLeaves}`)
    let pass = 0
    let brain = r1.brain!
    while (resolveMaterialAcademicStability(brain) === 'preparing' && pass < totalLeaves) {
      pass++
      const r = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, enrichmentBatchSize: 8, extractFn: richExtractFn() as any })
      brain = r.brain!
    }
    assert.ok(pass >= 5, `STALL-5: ${totalLeaves} leaves at batchSize=8 must require >=5 passes, took ${pass}`)
    assert.equal(resolveMaterialAcademicStability(brain), 'stable_rich')
  })

  // ---- STALL-6: successful leaves disappear from candidates ----
  await test('STALL-6: a leaf upgraded to rich never becomes a candidate again', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-stall-6' }
    const materials = [material('mat-a', 'Contenido academico de prueba. '.repeat(40))]
    const store = new InMemoryStore()
    let calls = 0
    const countingExtract = async (chunk: any) => { calls++; return richExtractFn()(chunk) }
    await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 400 })
    const r2 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 400, extractFn: countingExtract as any })
    assert.equal(resolveMaterialAcademicStability(r2.brain), 'stable_rich')
    const callsAfterFirstPass = calls
    const r3 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 400, extractFn: countingExtract as any })
    assert.equal(calls, callsAfterFirstPass, 'STALL-6: once stable_rich, a further request must make ZERO additional provider calls')
    assert.equal(resolveMaterialAcademicStability(r3.brain), 'stable_rich')
  })

  // ---- STALL-7/8: failing leaves accumulate durable attempts -> stable_degraded ----
  await test('STALL-7/8: leaves that always fail rich extraction accumulate attempts durably and converge to stable_degraded', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-stall-78' }
    const materials = [material('mat-a', 'Contenido academico de prueba suficientemente largo. '.repeat(40))]
    const store = new InMemoryStore()
    let brain = (await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 400 })).brain!
    let passes = 0
    const leafCount = Object.keys(brain.meta.subchunkCheckpoints || {}).length
    while (resolveMaterialAcademicStability(brain) === 'preparing' && passes < MAX_ENRICHMENT_ATTEMPTS_PER_LEAF + 2) {
      passes++
      brain = (await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 400, enrichmentBatchSize: leafCount, extractFn: alwaysFailExtractFn() as any })).brain!
    }
    assert.equal(resolveMaterialAcademicStability(brain), 'stable_degraded')
    for (const leaf of Object.values(brain.meta.subchunkCheckpoints || {})) {
      assert.equal(leaf.usedDeterministicFallback, true, 'STALL-7 fallback is preserved, never lost')
      assert.ok((leaf.enrichmentAttempts || 0) >= MAX_ENRICHMENT_ATTEMPTS_PER_LEAF, 'STALL-8 attempts accumulated to the budget')
    }
  })

  // ================================================================
  // DOM-level reproduction of the ACTUAL production bug — proves the
  // real useMaterialBrainLifecycle hook, not just the underlying
  // build/store mechanism.
  // ================================================================
  const originalFetch = globalThis.fetch

  await test('STALL-DOM-1 (the real bug): background continuation survives MULTIPLE consecutive "preparing" responses and reaches a terminal state — this is the exact production stall reproduced and fixed', async () => {
    let postCalls = 0
    globalThis.fetch = (async (_input: any, init?: any) => {
      if (init?.method !== 'POST') {
        return new Response(JSON.stringify({ status: 'missing', fingerprint: 'x', builderVersion: null }), { status: 200 })
      }
      postCalls++
      if (postCalls === 1) {
        // base build (source_ready)
        return new Response(JSON.stringify({
          status: 'ready', brainEnrichment: 'not_started', academicStability: 'preparing',
          capabilities: { academicStability: 'preparing' },
        }), { status: 200 })
      }
      if (postCalls === 2 || postCalls === 3) {
        // enrichment passes still in progress — academicStability
        // STAYS THE SAME STRING ('preparing') across these responses,
        // which is EXACTLY the condition that broke the old
        // dependency-array-driven poller.
        return new Response(JSON.stringify({
          status: 'ready', brainEnrichment: 'enriching', academicStability: 'preparing',
          capabilities: { academicStability: 'preparing' },
        }), { status: 200 })
      }
      // pass 4: terminal
      return new Response(JSON.stringify({
        status: 'ready', brainEnrichment: 'ready', academicStability: 'stable_rich',
        capabilities: { academicStability: 'stable_rich' },
      }), { status: 200 })
    }) as any

    const selection = buildSourceSelectionSnapshot(['stall-mat'], { 'stall-mat': [1] })

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selection)
      assert.equal(latest()?.status, 'ready')
      assert.equal(latest()?.academicStability, 'preparing')

      // Wait through several enrichment poll cycles (ENRICHMENT_POLL_MS=800ms each).
      for (let i = 0; i < 5; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)) })
        await flush()
        if (latest()?.academicStability === 'stable_rich') break
      }

      assert.equal(latest()?.academicStability, 'stable_rich', 'STALL-DOM-1: the loop must reach the terminal state, never stall at "preparing" after the first repeat tick')
    })

    assert.ok(postCalls >= 4, `STALL-DOM-1: expected at least 4 POSTs (1 base + >=2 preparing polls + 1 terminal), got ${postCalls}`)
  })

  await test('STALL-11: a stale fingerprint\'s continuation cannot mutate the current selection\'s UI state', async () => {
    let postCallsA = 0
    const activeGen = { fingerprint: '' }
    globalThis.fetch = (async (_input: any, init?: any) => {
      if (init?.method !== 'POST') return new Response(JSON.stringify({ status: 'missing' }), { status: 200 })
      const body = JSON.parse(init.body)
      if (body.materialIds[0] === 'stale-mat') {
        postCallsA++
        // Deliberately slow — resolves AFTER the fingerprint has already changed below.
        await new Promise(r => setTimeout(r, 50))
        return new Response(JSON.stringify({ status: 'ready', brainEnrichment: 'enriching', academicStability: 'preparing' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'ready', brainEnrichment: 'ready', academicStability: 'stable_rich' }), { status: 200 })
    }) as any

    const staleSelection = buildSourceSelectionSnapshot(['stale-mat'], { 'stale-mat': [1] })
    const freshSelection = buildSourceSelectionSnapshot(['fresh-mat'], { 'fresh-mat': [1] })

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(staleSelection)
      await renderWithSelection(freshSelection) // switch fingerprint before the stale continuation's slow response lands
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
      await flush()
      assert.equal(latest()?.fingerprint, freshSelection.fingerprint, 'STALL-11: current UI must reflect the FRESH fingerprint')
      assert.equal(latest()?.academicStability, 'stable_rich', 'STALL-11: the stale slow response must never override the fresh selection\'s state')
    })
  })

  globalThis.fetch = originalFetch

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('material-brain-stall-contracts: ALL PASS')
}

main()
