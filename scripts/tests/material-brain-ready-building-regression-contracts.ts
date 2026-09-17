import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getOrBuildProductionBrain } from '../../lib/materialBrain/productionStore'
import type { MaterialBrain, ResolvedSourceMaterial } from '../../lib/materialBrain/types'
import type { MaterialBrainStore } from '../../lib/materialBrain/cache'

// ============================================================
// REAL PRODUCTION BUG: "READY -> BUILDING regression".
//
// Real repro (43-page native PDF, fingerprint 7768fad92cf0a8a5): base
// build finishes, ALL leaves finalize (fallbackUsed:true, as designed
// for source_ready), the POST response shows
//   resultStatus:"ready", hasBrain:true, academicStability:"preparing"
// Then EVERY following request for the SAME fingerprint shows
//   resultStatus:"building", hasBrain:false
// until the client exhausts its safe-recovery budget and shows a hard
// error, even though nothing about the selection/fingerprint changed.
//
// ROOT CAUSE (found by tracing productionStore.ts's actual dispatch,
// not assumed): `runEnrichmentPass` — the function that keeps a
// sourceReadiness:'ready' brain's background enrichment moving forward
// — had NO stale-write / status-regression protection at all, unlike
// the analogous fresh-build path a few lines below it (which explicitly
// refuses to let its own final write clobber an already-'ready' brain).
// It persisted WHATEVER `status`/`sourceCoverage` this call's
// `buildMaterialBrain` computed, with no comparison against the
// CURRENTLY-persisted (already proven 'ready') brain. If that
// computation is ever anything other than 'ready' — a transient
// materials-resolution hiccup, a race between two concurrent enrichment
// passes for the same fingerprint (the client-side companion bug: the
// enrichment poller's useEffect depended on the `sourceSelection`
// OBJECT reference instead of its `fingerprint`, so it could tear down
// and restart on every incidental re-render, firing overlapping
// redundant POSTs — also fixed, see useMaterialBrainLifecycle.ts) — the
// persisted Brain's own `status` gets silently downgraded. The NEXT
// request's lookup then sees a non-'ready' status, falls out of BOTH
// the "ready" and "valid in-flight lease" branches in
// `getOrBuildProductionBrain`, and writes a BRAND NEW 'building'
// placeholder with a fresh 3-minute lease over a Brain that was fine
// moments earlier — exactly the observed hasBrain:false flood.
//
// FIX: `runEnrichmentPass` now refuses to let a background pass
// downgrade an already-'ready' persisted brain's status/coverage/units
// — it keeps the proven-good snapshot (still absorbing the harmless,
// additive checkpoint/enrichment-attempt-budget progress) and logs the
// anomaly (`enrichment_pass_status_regression_prevented`) so it stays
// diagnosable instead of silently swallowed.
// ============================================================

function material(id: string, text: string): ResolvedSourceMaterial {
  return { materialId: id, nombre: id, kind: 'pdf', text, knownPages: [1] } as any
}

class InMemoryStore implements MaterialBrainStore {
  map = new Map<string, MaterialBrain>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, b: MaterialBrain) { this.map.set(fp, b) }
}

/** Extract fn that DEGRADES coverage: simulates whatever transient
 * condition could make a bounded enrichment batch's own recomputation
 * come back worse than the already-durable 'ready' snapshot — the
 * scenario the fix must survive regardless of its exact cause. */
function degradingExtractFn() {
  return async (chunk: any) => ({
    extraction: {
      units: [], relations: [], droppedInvalidProvenance: 0, droppedStructural: 0,
      warnings: [`chunk ${chunk.id} synthetic transient failure [class:transient]`],
      telemetry: { chunkId: chunk.id, materialId: chunk.materialId, pages: chunk.pages, rawUnits: 0, rawRelations: 0, acceptedUnits: 0, acceptedRelations: 0, rejectedUnits: 0, rejectedRelations: 0, rejectedUnitRecords: [], wasRecovered: false, truncatedObjectsInResponse: 0 },
    },
  })
}

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Material Brain READY→BUILDING regression contracts ──\n')

  // ---------------------------------------------------------------
  // Exact real sequence: R1 builds base (ready+hasBrain), R2 SAME
  // fingerprint immediately must NOT regress to building+no-brain.
  // ---------------------------------------------------------------
  await test('READY-BUILD-1: R1 base build returns ready+hasBrain; R2 (same fingerprint, immediately after) must NOT return building+hasBrain:false', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-ready-1' }
    const materials = [material('mat-a', 'Contenido academico real de prueba suficientemente extenso. '.repeat(200))]
    const store = new InMemoryStore()

    const r1 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    assert.equal(r1.status, 'ready')
    assert.ok(r1.brain, 'R1 must return a brain')
    assert.equal(r1.brain!.meta.brainEnrichment, 'not_started')

    const r2 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    assert.equal(r2.status, 'ready', 'R2 must stay ready — this is the exact real regression')
    assert.ok(r2.brain, 'R2 must NOT drop the brain (the real bug: hasBrain:false)')
  })

  // ---------------------------------------------------------------
  // A buildLease still visible right after persisting the base Brain
  // must never make it disappear from a following read.
  // ---------------------------------------------------------------
  await test('READY-BUILD-2: a stale/lingering buildLease on the persisted record never hides an otherwise-ready brain', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-ready-2' }
    const materials = [material('mat-a', 'Contenido academico real de prueba suficientemente extenso. '.repeat(200))]
    const store = new InMemoryStore()

    const r1 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    assert.equal(r1.status, 'ready')

    // Simulate a lease object still present on the persisted 'ready'
    // brain (e.g. carried over from an earlier in-flight build that
    // hadn't cleared it) — a persisted-ready brain must win regardless.
    const persisted = await store.get(scope.fingerprint)
    assert.ok(persisted)
    await store.set(scope.fingerprint, {
      ...persisted!,
      meta: { ...persisted!.meta, buildLease: { ownerId: 'stale-owner', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() } },
    })

    const r2 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    assert.equal(r2.status, 'ready', 'a persisted-ready brain must win over a stale/lingering lease')
    assert.ok(r2.brain)
  })

  // ---------------------------------------------------------------
  // The direct mechanism: an enrichment pass that internally computes a
  // WORSE status than the already-durable 'ready' brain must never
  // persist that regression.
  // ---------------------------------------------------------------
  await test('READY-BUILD-3: an enrichment pass never downgrades an already-ready persisted brain, even if its own recomputation degrades', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-ready-3' }
    const materials = [material('mat-a', 'Contenido academico real de prueba suficientemente extenso para multiples leaves. '.repeat(200))]
    const store = new InMemoryStore()

    const r1 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    assert.equal(r1.status, 'ready')

    // Force the NEXT (enrichment) pass's own buildMaterialBrain call to
    // fail every chunk it touches — the exact class of transient
    // degradation the fix must absorb without losing the ready brain.
    const r2 = await getOrBuildProductionBrain(scope, materials, store, {
      twoLevelReadiness: true, chunkSizeChars: 250, extractFn: degradingExtractFn() as any,
    })
    assert.equal(r2.status, 'ready', 'the persisted brain must stay ready even when this pass\'s own recomputation would have been worse')
    assert.ok(r2.brain)
    assert.equal(r2.brain!.sourceCoverage.status, 'complete', 'sourceCoverage must not regress either')

    const persistedAfter = await store.get(scope.fingerprint)
    assert.equal(persistedAfter?.meta.status, 'ready', 'the STORED record itself must never show the regression')
  })

  // ---------------------------------------------------------------
  // Multi-request sequence toward terminal convergence, unaffected.
  // ---------------------------------------------------------------
  await test('READY-BUILD-4: R1 base, R2/R3/R4 enrichment passes converge toward terminal stability without ever losing the brain', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-ready-4' }
    const materials = [material('mat-a', 'Contenido academico real de prueba suficientemente extenso para catorce leaves reales aproximadamente. '.repeat(200))]
    const store = new InMemoryStore()

    let r = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    assert.equal(r.status, 'ready')
    for (let i = 0; i < 4; i++) {
      r = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, enrichmentBatchSize: 8 })
      assert.equal(r.status, 'ready', `pass ${i + 1} must stay ready`)
      assert.ok(r.brain, `pass ${i + 1} must return a brain`)
    }
  })

  // ---------------------------------------------------------------
  // Concurrency: two requests immediately after base-ready. One may be
  // the enrichment owner; the other may observe active work; but
  // NEITHER may make the brain disappear or deadlock.
  // ---------------------------------------------------------------
  await test('READY-BUILD-5: two concurrent requests right after base-ready never make the brain disappear or deadlock', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-ready-5' }
    const materials = [material('mat-a', 'Contenido academico real de prueba suficientemente extenso. '.repeat(200))]
    const store = new InMemoryStore()

    const r1 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    assert.equal(r1.status, 'ready')

    const [a, b] = await Promise.all([
      getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 }),
      getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 }),
    ])
    assert.equal(a.status, 'ready')
    assert.equal(b.status, 'ready')
    assert.ok(a.brain, 'concurrent request A must not lose the brain')
    assert.ok(b.brain, 'concurrent request B must not lose the brain')

    const persistedAfter = await store.get(scope.fingerprint)
    assert.equal(persistedAfter?.meta.status, 'ready', 'store must converge to a ready state after concurrent access, never building')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('material-brain-ready-building-regression-contracts: ALL PASS')
}

main()
