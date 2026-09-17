import assert from 'node:assert/strict'
import { InMemoryMaterialBrainStore, lookupMaterialBrain } from '../../lib/materialBrain/cache'
import {
  BUILDING_STALE_MS,
  createBuildingPlaceholder,
  getOrBuildProductionBrain,
  WorkerMaterialResultStore,
} from '../../lib/materialBrain/productionStore'
import { resolveSourceMaterialsForBrain } from '../../lib/materialBrain/resolve'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import {
  ACIDS_BASES_MATERIAL,
  MULTI_MATERIAL_A,
  MULTI_MATERIAL_B,
} from '../materialBrain/fixtures'
import type { Material, MaterialResult, MaterialText } from '../../lib/materials/types'
import type { BrainScope, MaterialBrain, ResolvedSourceMaterial } from '../../lib/materialBrain/types'

// ============================================================
// Production bridge contracts — Material Brain.
//
// Estos tests no usan LLM ni red real (salvo Paso 0, ya ejecutado
// aparte). Mockean el store y la función de build para verificar
// restore-first, invalidación, anti-duplicado best-effort y
// resolución de materiales con selección parcial.
// ============================================================

function coverageStatusFor(status: MaterialBrain['meta']['status']) {
  if (status === 'ready') return 'complete'
  if (status === 'partial') return 'partial'
  return 'failed'
}

function makeBrain(
  scope: BrainScope,
  status: MaterialBrain['meta']['status'],
  overrides: { generatedAt?: string; builderVersion?: string } = {},
): MaterialBrain {
  const base = createBuildingPlaceholder(scope)
  const generatedAt = overrides.generatedAt || base.meta.generatedAt
  return {
    ...base,
    meta: {
      ...base.meta,
      status,
      generatedAt,
      builderVersion: overrides.builderVersion || base.meta.builderVersion,
      // Keep the lease consistent with an overridden generatedAt — a
      // stale-placeholder test must produce an actually-expired lease,
      // mirroring the real invariant that lease dates track generatedAt.
      buildLease: base.meta.buildLease && {
        ...base.meta.buildLease,
        startedAt: generatedAt,
        expiresAt: new Date(new Date(generatedAt).getTime() + BUILDING_STALE_MS).toISOString(),
      },
    },
    sourceCoverage: {
      ...base.sourceCoverage,
      status: coverageStatusFor(status),
    },
  }
}

function scopeFor(materialIds: string[], selectedPages: Record<string, number[]> = {}) {
  return buildSourceSelectionSnapshot(materialIds, selectedPages)
}

function mockStoreThatThrowsOnGet(error: Error): MaterialBrainStore {
  return {
    get: async () => {
      throw error
    },
    set: async () => {},
  }
}

async function main() {
  console.log('\n--- Material Brain Production Bridge Contracts ---\n')

  // ----------------------------------------------------------
  // Restore-first: segunda llamada devuelve ready sin reconstruir
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    let builds = 0
    const buildFn = async (s: BrainScope, _m: ResolvedSourceMaterial[], _opts?: any) => {
      builds++
      return makeBrain(s, 'ready')
    }
    const store = new InMemoryMaterialBrainStore()

    const r1 = await getOrBuildProductionBrain(scope, [], store, { buildFn })
    assert.equal(r1.status, 'ready', 'primera llamada debe construir y devolver ready')
    assert.equal(builds, 1)

    const r2 = await getOrBuildProductionBrain(scope, [], store, { buildFn })
    assert.equal(r2.status, 'ready', 'segunda llamada debe devolver ready desde caché')
    assert.equal(builds, 1, 'restore-first: no debe reconstruir')
    console.log('✅ restore-first')
  }

  // ----------------------------------------------------------
  // Invalidación por fingerprint distinto
  // ----------------------------------------------------------
  {
    const scope12 = scopeFor(['mat_a'], { mat_a: [1, 2] })
    const scope123 = scopeFor(['mat_a'], { mat_a: [1, 2, 3] })
    let builds = 0
    const buildFn = async (s: BrainScope) => {
      builds++
      return makeBrain(s, 'ready')
    }
    const store = new InMemoryMaterialBrainStore()

    await getOrBuildProductionBrain(scope12, [], store, { buildFn })
    assert.equal(builds, 1)

    await getOrBuildProductionBrain(scope123, [], store, { buildFn })
    assert.equal(builds, 2, 'fingerprint distinto debe disparar reconstrucción')
    console.log('✅ invalidación por fingerprint distinto')
  }

  // ----------------------------------------------------------
  // Invalidación por builderVersion distinta
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const store = new InMemoryMaterialBrainStore()
    const stale = makeBrain(scope, 'ready', { builderVersion: '0.0.1-stale' })
    await store.set(scope.fingerprint, stale)

    const lookup = await lookupMaterialBrain(store, scope.fingerprint)
    assert.equal(lookup.status, 'missing', 'brain con builderVersion vieja debe tratarse como missing')

    let builds = 0
    const buildFn = async (s: BrainScope) => {
      builds++
      return makeBrain(s, 'ready')
    }
    const result = await getOrBuildProductionBrain(scope, [], store, { buildFn })
    assert.equal(result.status, 'ready')
    assert.equal(builds, 1, 'debe reconstruir tras detectar builderVersion obsoleta')
    console.log('✅ invalidación por builderVersion distinta')
  }

  // ----------------------------------------------------------
  // Anti-duplicado de builds concurrentes: building reciente -> poll
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    let builds = 0
    let releaseBuild: (() => void) | undefined
    const buildFn = async (s: BrainScope) => {
      builds++
      await new Promise<void>((resolve) => {
        releaseBuild = resolve
      })
      return makeBrain(s, 'ready')
    }
    const store = new InMemoryMaterialBrainStore()

    // Esperamos a que el primer llamado escriba el placeholder 'building'
    // antes de lanzar la segunda llamada — así ejercitamos el camino en el
    // que la segunda lectura encuentra un building reciente y no reconstruye.
    let placeholderResolved = false
    let resolvePlaceholder: (() => void) | undefined
    const placeholderPromise = new Promise<void>((resolve) => {
      resolvePlaceholder = resolve
    })
    const originalSet = store.set.bind(store)
    store.set = async (fingerprint: string, brain: MaterialBrain) => {
      await originalSet(fingerprint, brain)
      if (brain.meta.status === 'building' && !placeholderResolved) {
        placeholderResolved = true
        resolvePlaceholder?.()
      }
    }

    const p1 = getOrBuildProductionBrain(scope, [], store, { buildFn })
    await placeholderPromise

    const p2 = getOrBuildProductionBrain(scope, [], store, { buildFn })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(builds, 1, 'solo el primer build debe haberse iniciado')

    assert.ok(releaseBuild, 'releaseBuild debe estar definido')
    releaseBuild!()
    const [r1, r2] = await Promise.all([p1, p2])
    assert.equal(r1.status, 'ready')
    assert.equal(r2.status, 'ready', 'llamada concurrente debe converger sobre el mismo build')
    assert.equal(builds, 1)
    console.log('✅ anti-duplicado de builds concurrentes')
  }

  // ----------------------------------------------------------
  // Building placeholder vencido -> permite reconstrucción
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const staleGeneratedAt = new Date(Date.now() - BUILDING_STALE_MS - 1000).toISOString()
    const staleBuilding = makeBrain(scope, 'building', { generatedAt: staleGeneratedAt })
    const store = new InMemoryMaterialBrainStore()
    await store.set(scope.fingerprint, staleBuilding)

    let builds = 0
    const buildFn = async (s: BrainScope) => {
      builds++
      return makeBrain(s, 'ready')
    }
    const result = await getOrBuildProductionBrain(scope, [], store, { buildFn })
    assert.equal(result.status, 'ready')
    assert.equal(builds, 1, 'building vencido debe permitir reconstrucción')
    console.log('✅ building placeholder vencido permite reconstrucción')
  }

  // ----------------------------------------------------------
  // Resolución multi-material con selectedPages parciales
  // ----------------------------------------------------------
  {
    const mat = ACIDS_BASES_MATERIAL
    const material: Material = {
      id: mat.materialId,
      nombre: mat.nombre,
      kind: 'pdf',
      normalized_kind: undefined,
    } as Material
    const text: MaterialText = {
      material_id: mat.materialId,
      raw_text: mat.text,
      created_at: '',
      updated_at: '',
    }

    const loaders = {
      getMaterial: async (id: string) => (id === mat.materialId ? material : null),
      getMaterialText: async (id: string) => (id === mat.materialId ? text : null),
      resolveStudyKind: (m: Pick<Material, 'kind' | 'normalized_kind'>) => m.normalized_kind || m.kind,
    }

    const selectedPages = { [mat.materialId]: [1, 2] }
    const { scope, materials } = await resolveSourceMaterialsForBrain(
      'user1',
      [mat.materialId],
      selectedPages,
      loaders,
    )

    assert.equal(scope.materialIds.length, 1)
    assert.deepEqual(scope.selectedPages[mat.materialId], [1, 2])
    assert.equal(materials.length, 1)

    const resolved = materials[0]
    assert.ok(resolved.text.includes('[Pagina 1]'), 'debe incluir página 1 seleccionada')
    assert.ok(resolved.text.includes('[Pagina 2]'), 'debe incluir página 2 seleccionada')
    assert.ok(!resolved.text.includes('[Pagina 3]'), 'no debe filtrar página 3 no seleccionada')
    assert.deepEqual(resolved.knownPages, [1, 2])
    console.log('✅ resolución con selectedPages parciales')
  }

  // ----------------------------------------------------------
  // Multi-material: page 2 de A != page 2 de B
  // ----------------------------------------------------------
  {
    const mapMaterial = (m: typeof MULTI_MATERIAL_A): Material =>
      ({ id: m.materialId, nombre: m.nombre, kind: 'pdf', normalized_kind: undefined }) as Material
    const mapText = (m: typeof MULTI_MATERIAL_A): MaterialText =>
      ({ material_id: m.materialId, raw_text: m.text, created_at: '', updated_at: '' })

    const materials = [MULTI_MATERIAL_A, MULTI_MATERIAL_B]
    const byId = Object.fromEntries(materials.map((m) => [m.materialId, m]))

    const loaders = {
      getMaterial: async (id: string) => mapMaterial(byId[id]),
      getMaterialText: async (id: string) => mapText(byId[id]),
      resolveStudyKind: (m: Pick<Material, 'kind' | 'normalized_kind'>) => m.normalized_kind || m.kind,
    }

    const selectedPages = {
      [MULTI_MATERIAL_A.materialId]: [1, 2],
      [MULTI_MATERIAL_B.materialId]: [1, 2],
    }

    const { scope, materials: resolved } = await resolveSourceMaterialsForBrain(
      'user1',
      [MULTI_MATERIAL_A.materialId, MULTI_MATERIAL_B.materialId],
      selectedPages,
      loaders,
    )

    assert.equal(scope.materialIds.length, 2)
    assert.equal(resolved.length, 2)
    assert.notEqual(
      `${resolved[0].materialId}:p2`,
      `${resolved[1].materialId}:p2`,
      'las páginas 2 de dos materiales distintos deben ser fuentes distintas',
    )
    assert.ok(resolved[0].text.includes('[Pagina 2]'))
    assert.ok(resolved[1].text.includes('[Pagina 2]'))
    console.log('✅ multi-material con páginas coincidentes mantienen identidad separada')
  }

  // ----------------------------------------------------------
  // Partial cacheado nunca se devuelve como ready
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const partial = makeBrain(scope, 'partial')
    const store = new InMemoryMaterialBrainStore()
    await store.set(scope.fingerprint, partial)

    let builds = 0
    const buildFn = async (s: BrainScope) => {
      builds++
      return makeBrain(s, 'ready')
    }
    const result = await getOrBuildProductionBrain(scope, [], store, { buildFn })
    assert.equal(result.status, 'ready')
    assert.equal(builds, 1, 'brain partial cacheado debe disparar reconstrucción')
    console.log('✅ partial cacheado nunca se sirve como ready')
  }

  // ----------------------------------------------------------
  // Fallback: error de red en el lookup se propaga, no se enmascara
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    const store = mockStoreThatThrowsOnGet(new Error('WORKER_NETWORK_ERROR'))
    let builds = 0
    const buildFn = async (s: BrainScope) => {
      builds++
      return makeBrain(s, 'ready')
    }

    try {
      await getOrBuildProductionBrain(scope, [], store, { buildFn })
      assert.fail('debe propagar el error de red del store')
    } catch (err: any) {
      assert.ok(String(err?.message || err).includes('WORKER_NETWORK_ERROR'), 'el error del Worker debe propagarse')
    }
    assert.equal(builds, 0, 'no debe reconstruir cuando el lookup falla por red')
    console.log('✅ error de red en lookup se propaga explícitamente')
  }

  // ----------------------------------------------------------
  // Payload corrupto en Worker -> error explícito, no rebuild
  // ----------------------------------------------------------
  {
    const scope = scopeFor(['mat_a'])
    let builds = 0
    const buildFn = async (s: BrainScope) => {
      builds++
      return makeBrain(s, 'ready')
    }

    const corruptedResult: MaterialResult = {
      id: 'res-corrupt',
      material_id: `brain:${scope.fingerprint}`,
      enfoque: 'mixto' as any,
      result_type: 'material_brain' as any,
      payload: 'not-a-brain-json',
      created_at: new Date().toISOString(),
    }

    const store = new WorkerMaterialResultStore({
      getMaterialResult: async () => corruptedResult,
      saveMaterialResult: async () => corruptedResult,
    })

    try {
      await getOrBuildProductionBrain(scope, [], store, { buildFn })
      assert.fail('debe lanzar MATERIAL_BRAIN_CORRUPTED_PAYLOAD')
    } catch (err: any) {
      assert.ok(
        String(err?.message || err).includes(`MATERIAL_BRAIN_CORRUPTED_PAYLOAD:${scope.fingerprint}`),
        'debe incluir fingerprint en el error',
      )
    }
    assert.equal(builds, 0, 'no debe reconstruir ante payload corrupto')
    console.log('✅ payload corrupto en Worker se reporta como error, no como missing')
  }

  console.log('\n✅ Todos los contratos del production bridge pasaron.')
}

main().catch((error) => {
  console.error('❌ material-brain-production-bridge-contracts falló:', error)
  process.exit(1)
})
