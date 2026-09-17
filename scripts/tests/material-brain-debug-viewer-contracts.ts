import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { InMemoryMaterialBrainStore } from '../../lib/materialBrain/cache'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { MaterialBrain } from '../../lib/materialBrain/types'
import { deriveMaterialBrainDebugSummary } from '../../lib/materialBrain/debugView'
import { GET, __debugRouteDeps } from '../../app/api/material-brain/debug/route'

function brain(fingerprint: string, status: MaterialBrain['meta']['status']): MaterialBrain {
  const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] })
  assert.equal(scope.fingerprint, fingerprint)
  return {
    scope,
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: '2026-08-26T00:00:00.000Z',
      chunking: { strategy: 'page-aware', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 1, retries: 0, status,
    },
    units: [{
      id: 'unit-1', kind: 'concept',
      identity: { canonicalSubject: 'Equilibrium', semanticKey: 'equilibrium', qualifiers: [] },
      label: 'Equilibrium', statement: 'Forward and reverse rates are equal.',
      importance: { tier: 'critical', signals: ['declared_in_material'], confidence: 0.95 },
      provenance: [{ materialId: 'mat-a', page: 1, quote: 'Forward and reverse rates', chunkId: 'chunk-1' }],
      domainTags: ['chemistry'],
    }],
    relations: [],
    sourceCoverage: {
      requested: [{ materialId: 'mat-a', page: 1 }, { materialId: 'mat-a', page: 2 }],
      processed: [{ materialId: 'mat-a', page: 1 }],
      missing: [{ materialId: 'mat-a', page: 2 }], suspiciouslyEmpty: [], status: 'partial',
    },
    knowledgeExtraction: {
      chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: 1,
      unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [],
    },
    mergeLog: [],
  }
}

function request(scope: ReturnType<typeof buildSourceSelectionSnapshot>, fingerprint = scope.fingerprint) {
  const params = new URLSearchParams({
    materialIds: JSON.stringify(scope.materialIds),
    selectedPages: JSON.stringify(scope.selectedPages),
    fingerprint,
  })
  return new NextRequest(`http://localhost/api/material-brain/debug?${params}`)
}

async function main() {
  const original = { ...__debugRouteDeps }
  let providerCalls = 0
  let storeReads = 0
  const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] })
  const store = new InMemoryMaterialBrainStore()
  try {
    __debugRouteDeps.isDevelopment = () => true
    __debugRouteDeps.getServerSession = (async () => ({ user: { id: 'user-1' } })) as typeof __debugRouteDeps.getServerSession
    __debugRouteDeps.getMaterial = (async id => ({ id, nombre: 'Material A' })) as typeof __debugRouteDeps.getMaterial
    __debugRouteDeps.createStore = () => ({
      get: async fingerprint => { storeReads++; return store.get(fingerprint) },
      set: async () => { throw new Error('DEBUG_VIEWER_MUST_NOT_WRITE') },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { providerCalls++; throw new Error('DEBUG_VIEWER_MUST_NOT_CALL_PROVIDER') }) as typeof fetch
    try {
      __debugRouteDeps.isDevelopment = () => false
      assert.equal((await GET(request(scope))).status, 404, 'debug endpoint is unavailable in production')
      __debugRouteDeps.isDevelopment = () => true
      const missingResponse = await GET(request(scope))
      const missing = await missingResponse.json()
      assert.equal(missing.status, 'missing', 'missing state is returned without building')
      assert.equal(missing.brain, undefined)

      const readyBrain = brain(scope.fingerprint, 'ready')
      await store.set(scope.fingerprint, readyBrain)
      const readyResponse = await GET(request(scope))
      const ready = await readyResponse.json()
      assert.equal(ready.fingerprint, scope.fingerprint, 'viewer uses current fingerprint')
      assert.equal(ready.brain.scope.fingerprint, scope.fingerprint)
      assert.deepEqual(ready.brain.units, readyBrain.units, 'ready renders persisted units')
      assert.equal(JSON.stringify(ready.brain, null, 2), JSON.stringify(readyBrain, null, 2), 'raw JSON is the rendered Brain')

      const partialBrain = brain(scope.fingerprint, 'partial')
      await store.set(scope.fingerprint, partialBrain)
      const partial = await (await GET(request(scope))).json()
      assert.equal(partial.status, 'partial', 'partial state remains visible')
      assert.equal(deriveMaterialBrainDebugSummary(partial.brain).warnings.includes('Brain status = partial'), true)

      const readsBeforeMismatch = storeReads
      const otherScope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [2] })
      const mismatchResponse = await GET(request(otherScope, scope.fingerprint))
      assert.equal(mismatchResponse.status, 409, 'old fingerprint cannot restore another selection')
      assert.equal(storeReads, readsBeforeMismatch, 'fingerprint mismatch is rejected before store lookup')
      assert.equal(providerCalls, 0, 'opening viewer causes zero AI/provider calls')
    } finally {
      globalThis.fetch = originalFetch
    }

    const viewerSource = readFileSync('components/materias/MaterialBrainDebugViewer.tsx', 'utf8')
    assert.match(viewerSource, /No existe Material Brain para este fingerprint/)
    assert.match(viewerSource, /Brain partial/)
    assert.match(viewerSource, /Raw Brain JSON/)
    // The viewer now supports an explicit, user-confirmed regeneration
    // action (POST to the dedicated DEV-only debug/regenerate route) —
    // it must still never call production-facing build entrypoints or
    // provider/internal build functions directly.
    assert.doesNotMatch(viewerSource, /getOrBuild|analyzePdfPageVisual|OpenRouter/i)
    assert.match(viewerSource, /\/api\/material-brain\/debug\/regenerate/, 'regeneration goes through the dedicated DEV-only debug route')
    assert.doesNotMatch(viewerSource, /fetch\(\s*['"`]\/api\/material-brain['"`]/, 'viewer must never call the production build route directly')
    const processSource = readFileSync('components/materias/StudyALProcess.tsx', 'utf8')
    assert.match(processSource, /process\.env\.NODE_ENV !== ['"]production['"]/)
    assert.match(processSource, /Debug Material Brain/)
    console.log('material-brain-debug-viewer-contracts: PASS (fingerprint isolation, missing/partial/ready, raw parity, providerCalls=0)')
  } finally {
    Object.assign(__debugRouteDeps, original)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
