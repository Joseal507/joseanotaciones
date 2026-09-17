import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getOrBuildProductionBrain, writeBrainRecord, createBuildingPlaceholder } from '../../lib/materialBrain/productionStore'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { MaterialBrain, ResolvedSourceMaterial } from '../../lib/materialBrain/types'
import type { MaterialBrainStore } from '../../lib/materialBrain/cache'

// ============================================================
// LIVE-RACE — the mission's explicit demand: PROVE, with a global
// write-boundary invariant + a canonical instrumented write path
// (`writeBrainRecord`, see productionStore.ts), that NO writer —
// named or not-yet-discovered — can ever replace an already-'ready'
// persisted Material Brain with building/partial/missing for the same
// fingerprint+builderVersion, absent explicit invalidation.
//
// The prior mission's fix only hardened `runEnrichmentPass`. Live
// evidence on a BRAND NEW fingerprint (360c71eb6c42b317) with ZERO
// enrichment-pass/rich-leaf logs proved a DIFFERENT writer (the fresh-
// build placeholder path, its checkpoint-flush callback, or its crash-
// fallback write — all racing on a store with NO compare-and-swap, per
// this file's own top comment) can also produce the regression. This
// suite protects ALL of them via one shared write boundary
// (`writeBrainRecord`), instrumented with `writer`/`requestId` tags so
// the NEXT live run identifies the exact culprit by name if it somehow
// still occurs.
// ============================================================

function material(id: string, text: string): ResolvedSourceMaterial {
  return { materialId: id, nombre: id, kind: 'pdf', text, knownPages: [1] } as any
}

class InMemoryStore implements MaterialBrainStore {
  map = new Map<string, MaterialBrain>()
  writeLog: { writer?: string }[] = []
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, b: MaterialBrain) { this.map.set(fp, b) }
}

function readyBrain(fingerprint: string): MaterialBrain {
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint },
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date().toISOString(),
      chunking: { strategy: 'page-aware-per-material', chunkSizeChars: 400, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status: 'ready', sourceReadiness: 'ready', brainEnrichment: 'not_started',
    },
    units: [{ kind: 'fact' } as any], relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: 1, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Material Brain LIVE-RACE (global monotonic write-boundary) contracts ──\n')

  // ---------------------------------------------------------------
  // LIVE-RACE-1: base request writes building placeholder then ready.
  // No later async write may change ready back to building.
  // ---------------------------------------------------------------
  await test('LIVE-RACE-1: full base-build sequence ends ready; store stays ready', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-1' }
    const materials = [material('mat-a', 'Contenido academico real de prueba suficientemente extenso. '.repeat(200))]
    const store = new InMemoryStore()
    const r = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, requestId: 'req-A' })
    assert.equal(r.status, 'ready')
    const persisted = await store.get('lr-1')
    assert.equal(persisted?.meta.status, 'ready')
  })

  // ---------------------------------------------------------------
  // LIVE-RACE-2: a DELAYED write carrying a stale 'building' snapshot
  // (simulating a late checkpoint-flush or crash-handler callback that
  // started BEFORE the ready write but lands AFTER it) must never win.
  // ---------------------------------------------------------------
  await test('LIVE-RACE-2: a stale building snapshot written AFTER a ready brain is rejected by the write boundary', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-2' }
    const store = new InMemoryStore()
    const ready = readyBrain('lr-2')
    await store.set('lr-2', ready)

    // Simulate a late-arriving writer (e.g. a checkpoint flush that read
    // 'building' BEFORE this ready write happened, and is only now
    // catching up over the network) trying to persist a stale snapshot.
    const stalePlaceholder = createBuildingPlaceholder(scope, 'stale-owner')
    await writeBrainRecord(store, scope, stalePlaceholder, {
      writer: 'enrichment_checkpoint_flush', requestId: 'req-STALE', reason: 'late_flush_simulation',
      storageRetries: 0, storageRetryDelayMs: 0,
    })

    const persisted = await store.get('lr-2')
    assert.equal(persisted?.meta.status, 'ready', 'the write boundary must reject the stale regression')
    assert.equal(persisted?.units.length, 1, 'the proven-good units must survive, not be replaced by the empty placeholder')
  })

  // ---------------------------------------------------------------
  // LIVE-RACE-3: two HTTP requests overlap — R1 builds base, R2
  // observes building. After R1 reaches ready, R2 cannot later
  // overwrite ready with building.
  // ---------------------------------------------------------------
  await test('LIVE-RACE-3: R2 observing an in-flight R1 build never later overwrites R1\'s ready result', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-3' }
    const materials = [material('mat-a', 'Contenido academico real de prueba suficientemente extenso. '.repeat(200))]
    const store = new InMemoryStore()

    // R1: full base build, reaches ready.
    const r1 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, requestId: 'req-R1' })
    assert.equal(r1.status, 'ready')

    // R2: simulates having observed the EARLIER 'building' placeholder
    // (before R1 finished) and now attempts its own late write of that
    // stale state — must be rejected.
    const staleFromR2 = createBuildingPlaceholder(scope, 'r2-owner')
    await writeBrainRecord(store, scope, staleFromR2, {
      writer: 'fresh_build_placeholder', requestId: 'req-R2', reason: 'late_overlap_simulation',
      storageRetries: 0, storageRetryDelayMs: 0,
    })

    const persisted = await store.get('lr-3')
    assert.equal(persisted?.meta.status, 'ready')
  })

  // ---------------------------------------------------------------
  // LIVE-RACE-4: three overlapping continuation requests. At most one
  // owns enrichment; none can replace ready with a placeholder.
  // ---------------------------------------------------------------
  await test('LIVE-RACE-4: three concurrent continuation requests never replace ready with a placeholder', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-4' }
    const materials = [material('mat-a', 'Contenido academico real de prueba suficientemente extenso. '.repeat(200))]
    const store = new InMemoryStore()
    await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })

    const results = await Promise.all([
      getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, requestId: 'req-C1' }),
      getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, requestId: 'req-C2' }),
      getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, requestId: 'req-C3' }),
    ])
    for (const r of results) assert.equal(r.status, 'ready')
    const persisted = await store.get('lr-4')
    assert.equal(persisted?.meta.status, 'ready')
  })

  // ---------------------------------------------------------------
  // LIVE-RACE-5: ready write + lingering lease. Read still returns
  // ready brain.
  // ---------------------------------------------------------------
  await test('LIVE-RACE-5: a lingering buildLease object on an otherwise-ready record never blocks a read', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-5' }
    const store = new InMemoryStore()
    const ready = readyBrain('lr-5')
    ;(ready.meta as any).buildLease = { ownerId: 'lingering', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }
    await store.set('lr-5', ready)
    const materials = [material('mat-a', 'x'.repeat(500))]
    const r = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250 })
    assert.equal(r.status, 'ready')
    assert.ok(r.brain)
  })

  // ---------------------------------------------------------------
  // LIVE-RACE-6: ready write + stale crash handler. Ready survives.
  // ---------------------------------------------------------------
  await test('LIVE-RACE-6: a stale crash-recovery write never downgrades an already-ready brain', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-6' }
    const store = new InMemoryStore()
    await store.set('lr-6', readyBrain('lr-6'))

    const staleFailedSnapshot: MaterialBrain = {
      ...createBuildingPlaceholder(scope, 'crash-owner'),
      meta: { ...createBuildingPlaceholder(scope, 'crash-owner').meta, status: 'failed' },
    }
    await writeBrainRecord(store, scope, staleFailedSnapshot, {
      writer: 'crash_recovery_write', requestId: 'req-CRASH', reason: 'simulated_stale_crash_handler',
      storageRetries: 0, storageRetryDelayMs: 0,
    })

    const persisted = await store.get('lr-6')
    assert.equal(persisted?.meta.status, 'ready')
  })

  // ---------------------------------------------------------------
  // LIVE-RACE-7: ready write + stale checkpoint flush. Ready survives.
  // ---------------------------------------------------------------
  await test('LIVE-RACE-7: a stale checkpoint-flush write never downgrades an already-ready brain', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-7' }
    const store = new InMemoryStore()
    await store.set('lr-7', readyBrain('lr-7'))

    const stale = createBuildingPlaceholder(scope, 'flush-owner')
    await writeBrainRecord(store, scope, stale, {
      writer: 'enrichment_checkpoint_flush', requestId: 'req-FLUSH', reason: 'simulated_stale_flush',
      storageRetries: 0, storageRetryDelayMs: 0,
    })

    const persisted = await store.get('lr-7')
    assert.equal(persisted?.meta.status, 'ready')
  })

  // ---------------------------------------------------------------
  // LIVE-RACE-8: real serialized store semantics (JSON round-trip,
  // matching the real Worker adapter's serialize/deserialize) preserve
  // ready.
  // ---------------------------------------------------------------
  await test('LIVE-RACE-8: JSON-serialized store round-trip (closest to the real Worker adapter) preserves ready under a stale write', async () => {
    class SerializingStore implements MaterialBrainStore {
      raw = new Map<string, string>()
      async get(fp: string) {
        const s = this.raw.get(fp)
        return s ? JSON.parse(s) : null
      }
      async set(fp: string, b: MaterialBrain) { this.raw.set(fp, JSON.stringify(b)) }
    }
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-8' }
    const store = new SerializingStore()
    await store.set('lr-8', readyBrain('lr-8'))

    const stale = createBuildingPlaceholder(scope, 'ser-owner')
    await writeBrainRecord(store, scope, stale, {
      writer: 'fresh_build_placeholder', requestId: 'req-SER', reason: 'serialized_store_stale_write',
      storageRetries: 0, storageRetryDelayMs: 0,
    })
    const persisted = await store.get('lr-8')
    assert.equal(persisted?.meta.status, 'ready', 'must survive real JSON serialize/deserialize round-trip semantics')
  })

  // ---------------------------------------------------------------
  // LIVE-RACE-9: all writes to same fingerprint/builderVersion are
  // monotonic unless explicit invalidation (different builderVersion).
  // ---------------------------------------------------------------
  await test('LIVE-RACE-9: a DIFFERENT builderVersion (explicit invalidation) is allowed to write over a ready brain', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-9' }
    const store = new InMemoryStore()
    await store.set('lr-9', readyBrain('lr-9'))

    const newVersionBuilding: MaterialBrain = {
      ...createBuildingPlaceholder(scope, 'newver-owner'),
      meta: { ...createBuildingPlaceholder(scope, 'newver-owner').meta, builderVersion: 'FUTURE-9.9.9' },
    }
    await writeBrainRecord(store, scope, newVersionBuilding, {
      writer: 'fresh_build_placeholder', requestId: 'req-NEWVER', reason: 'explicit_builderVersion_bump',
      storageRetries: 0, storageRetryDelayMs: 0,
    })
    const persisted = await store.get('lr-9')
    assert.equal(persisted?.meta.builderVersion, 'FUTURE-9.9.9', 'an explicit version bump must NOT be blocked by the monotonic guard')
  })

  // ---------------------------------------------------------------
  // LIVE-RACE-10: real request sequence through the actual orchestrator
  // — once first ready observed, no later response is building+no-brain.
  // ---------------------------------------------------------------
  await test('LIVE-RACE-10: real request sequence — once ready is first observed, no later call ever returns building+hasBrain:false', async () => {
    const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'lr-10' }
    const materials = [material('mat-a', 'Contenido academico real de prueba suficientemente extenso para varias pasadas. '.repeat(200))]
    const store = new InMemoryStore()

    const r1 = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, requestId: 'seq-1' })
    assert.equal(r1.status, 'ready')
    for (let i = 2; i <= 8; i++) {
      const r = await getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, chunkSizeChars: 250, enrichmentBatchSize: 8, requestId: `seq-${i}` })
      assert.notEqual(r.status, 'building', `request seq-${i} must never regress to building`)
      assert.ok(r.brain, `request seq-${i} must never lose the brain`)
    }
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('material-brain-live-race-contracts: ALL PASS')
}

main()
