import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { InMemoryMaterialBrainStore } from '../../lib/materialBrain/cache'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import { createBuildingPlaceholder } from '../../lib/materialBrain/productionStore'
import type { BrainScope, MaterialBrain, ResolvedSourceMaterial } from '../../lib/materialBrain/types'
import { POST, __regenerateRouteDeps } from '../../app/api/material-brain/debug/regenerate/route'

// ============================================================
// Material Brain Debug Viewer — manual regeneration contracts.
//
// No LLM/network: buildFn is injected via getOrBuildProductionBrain's
// own test-injection point (options.buildFn) so these contracts stay
// deterministic while exercising the REAL canonical rebuild authority
// (getOrBuildProductionBrain + productionStore.forceRebuild), never a
// second pipeline.
// ============================================================

function readyBrain(scope: BrainScope, unitCount: number): MaterialBrain {
  const base = createBuildingPlaceholder(scope)
  return {
    ...base,
    meta: { ...base.meta, status: 'ready', buildLease: undefined },
    units: Array.from({ length: unitCount }, (_, i) => ({
      id: `unit-${i}`, kind: 'fact' as const,
      identity: { canonicalSubject: `Subject ${i}`, semanticKey: `subject ${i}`, qualifiers: [] },
      label: `Subject ${i}`, statement: `Statement ${i}`,
      importance: { tier: 'contextual' as const, signals: ['declared_in_material'], confidence: 0.8 },
      provenance: [{ materialId: scope.materialIds[0], page: 1, quote: `q${i}`, chunkId: 'c0' }],
      domainTags: [],
    })),
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
  }
}

function material(materialId: string, pages: number[]): ResolvedSourceMaterial {
  return { materialId, nombre: materialId, kind: 'pdf', knownPages: pages, text: pages.map(p => `[Pagina ${p}] Contenido ${materialId} p${p}.`).join('\n') }
}

function req(body: unknown) {
  return new NextRequest('http://localhost/api/material-brain/debug/regenerate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

async function main() {
  const original = { ...__regenerateRouteDeps }
  try {
    console.log('\n── Material Brain Debug Regeneration contracts ──\n')

    // 1. same material + same pages → same fingerprint
    {
      const a = buildSourceSelectionSnapshot(['mat-x'], { 'mat-x': [1, 2, 3] })
      const b = buildSourceSelectionSnapshot(['mat-x'], { 'mat-x': [1, 2, 3] })
      assert.equal(a.fingerprint, b.fingerprint)
      console.log('  ✅ 1. same material+pages → same fingerprint')
    }

    let buildCalls = 0
    __regenerateRouteDeps.isDevelopment = () => true
    __regenerateRouteDeps.getServerSession = (async () => ({ user: { id: 'user-1' } })) as typeof __regenerateRouteDeps.getServerSession
    __regenerateRouteDeps.getMaterial = (async (id: string, userId: string) =>
      userId === 'user-1' ? { id, nombre: id, storage_key: `key-${id}` } as any : null) as typeof __regenerateRouteDeps.getMaterial
    __regenerateRouteDeps.getMaterialText = (async () => ({ raw_text: '' } as any)) as typeof __regenerateRouteDeps.getMaterialText
    __regenerateRouteDeps.resolveStudyKind = (() => 'pdf') as typeof __regenerateRouteDeps.resolveStudyKind

    // 2 & 7 & 10: regenerate touches only that fingerprint, reuses the
    // existing material (no upload path involved — getMaterial/
    // getMaterialText are the only source loaders), and invokes the
    // canonical build exactly once per confirmed regenerate.
    {
      const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] })
      const otherScope = buildSourceSelectionSnapshot(['mat-b'], { 'mat-b': [1] })
      const store = new InMemoryMaterialBrainStore()
      await store.set(scope.fingerprint, readyBrain(scope, 3))
      await store.set(otherScope.fingerprint, readyBrain(otherScope, 5))

      buildCalls = 0
      __regenerateRouteDeps.createStore = () => store
      __regenerateRouteDeps.getOrBuildProductionBrain = (async (s, materials, storeArg, options: any) => {
        assert.equal(options?.forceRebuild, true, 'route always requests forceRebuild')
        buildCalls++
        const { getOrBuildProductionBrain: real } = await import('../../lib/materialBrain/productionStore')
        return real(s, materials, storeArg, {
          ...options,
          buildFn: async (sc: BrainScope) => readyBrain(sc, 9),
        })
      }) as typeof __regenerateRouteDeps.getOrBuildProductionBrain

      const response = await POST(req({ materialIds: scope.materialIds, selectedPages: scope.selectedPages, sourceSelectionFingerprint: scope.fingerprint }))
      const data = await response.json()
      assert.equal(response.status, 200)
      assert.equal(data.status, 'ready')
      assert.equal(data.brain.units.length, 9, 'regenerated brain reflects the new build, not the old one')
      assert.equal(buildCalls, 1, 'canonical build invoked exactly once')

      const untouched = await store.get(otherScope.fingerprint)
      assert.equal(untouched?.units.length, 5, 'a different fingerprint is never touched by this regenerate')
      console.log('  ✅ 2. regenerate only touches its own fingerprint')
      console.log('  ✅ 7. regenerate resolves the existing material — no upload path')
      console.log('  ✅ 10. confirmed regenerate invokes the canonical build exactly once')
    }

    // 3. fingerprint mismatch → reject
    {
      const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] })
      const response = await POST(req({ materialIds: scope.materialIds, selectedPages: scope.selectedPages, sourceSelectionFingerprint: 'stale-fingerprint' }))
      assert.equal(response.status, 409)
      const data = await response.json()
      assert.equal(data.error, 'FINGERPRINT_MISMATCH')
      console.log('  ✅ 3. fingerprint mismatch is rejected before any build')
    }

    // 4 & 5. concurrent / already-building → no duplicate provider build
    {
      const scope = buildSourceSelectionSnapshot(['mat-c'], { 'mat-c': [1] })
      const store = new InMemoryMaterialBrainStore()
      const building = createBuildingPlaceholder(scope)
      building.meta.buildLease = { ownerId: 'someone-else', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }
      await store.set(scope.fingerprint, building)

      let secondBuildCalls = 0
      __regenerateRouteDeps.getOrBuildProductionBrain = (async (s, materials, storeArg, options: any) => {
        const { getOrBuildProductionBrain: real } = await import('../../lib/materialBrain/productionStore')
        return real(s, materials, storeArg, {
          ...options,
          buildFn: async (sc: BrainScope) => { secondBuildCalls++; return readyBrain(sc, 1) },
        })
      }) as typeof __regenerateRouteDeps.getOrBuildProductionBrain
      // Route uses its own WorkerMaterialResultStore in production; for
      // this contract we verify the underlying authority directly since
      // the route always constructs a fresh WorkerMaterialResultStore —
      // exercised end-to-end via the productionStore contracts already
      // in the suite (material-brain-production-bridge-contracts.ts).
      const { getOrBuildProductionBrain } = await import('../../lib/materialBrain/productionStore')
      const result = await getOrBuildProductionBrain(scope, [material('mat-c', [1])], store, {
        forceRebuild: true,
        buildFn: async (sc: BrainScope) => { secondBuildCalls++; return readyBrain(sc, 1) },
      })
      assert.equal(result.status, 'building', 'an active lease blocks a second build even under forceRebuild')
      assert.equal(secondBuildCalls, 0, 'no second provider build starts while one is active')
      console.log('  ✅ 4. concurrent regenerate never starts a duplicate build')
      console.log('  ✅ 5. current building state blocks a second provider build')
    }

    // 6. material ownership incorrect → reject
    {
      const scope = buildSourceSelectionSnapshot(['mat-not-mine'], { 'mat-not-mine': [1] })
      __regenerateRouteDeps.getMaterial = (async () => null) as typeof __regenerateRouteDeps.getMaterial
      const response = await POST(req({ materialIds: scope.materialIds, selectedPages: scope.selectedPages, sourceSelectionFingerprint: scope.fingerprint }))
      assert.equal(response.status, 422)
      const data = await response.json()
      assert.match(data.error, /^MATERIAL_NOT_FOUND:/)
      __regenerateRouteDeps.getMaterial = (async (id: string, userId: string) =>
        userId === 'user-1' ? { id, nombre: id, storage_key: `key-${id}` } as any : null) as typeof __regenerateRouteDeps.getMaterial
      console.log('  ✅ 6. incorrect material ownership is rejected before any build')
    }

    // 9. opening the viewer → 0 provider calls (already covered by
    // material-brain-debug-viewer-contracts.ts; re-asserted here against
    // the regenerate route specifically: unauthenticated/production
    // requests must never reach getOrBuildProductionBrain).
    {
      let calls = 0
      __regenerateRouteDeps.getOrBuildProductionBrain = (async () => { calls++; return { status: 'ready' as const } }) as typeof __regenerateRouteDeps.getOrBuildProductionBrain
      __regenerateRouteDeps.isDevelopment = () => false
      const prodResponse = await POST(req({ materialIds: ['mat-a'], selectedPages: {}, sourceSelectionFingerprint: 'x' }))
      assert.equal(prodResponse.status, 404, 'regenerate endpoint does not exist in production')
      __regenerateRouteDeps.isDevelopment = () => true
      __regenerateRouteDeps.getServerSession = (async () => null) as typeof __regenerateRouteDeps.getServerSession
      const unauthResponse = await POST(req({ materialIds: ['mat-a'], selectedPages: {}, sourceSelectionFingerprint: 'x' }))
      assert.equal(unauthResponse.status, 401)
      assert.equal(calls, 0, 'no build is ever attempted without dev+auth')
      console.log('  ✅ 9. opening the viewer / unauthenticated access never reaches the build authority')
    }

    // 8. the regenerate button never renders outside DEV (source-gated,
    // mirroring the existing StudyALProcess.tsx convention).
    {
      const viewerSource = readFileSync('components/materias/MaterialBrainDebugViewer.tsx', 'utf8')
      assert.match(viewerSource, /IS_DEV\s*=\s*process\.env\.NODE_ENV\s*!==\s*['"]production['"]/)
      assert.match(viewerSource, /IS_DEV\s*&&\s*\(/, 'the regenerate button is gated behind the DEV-only flag')
      assert.match(viewerSource, /Regenerar Material Brain/)
      console.log('  ✅ 8. regenerate button is source-gated to non-production builds')
    }

    console.log('\nmaterial-brain-debug-regenerate-contracts: PASS\n')
  } finally {
    Object.assign(__regenerateRouteDeps, original)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
