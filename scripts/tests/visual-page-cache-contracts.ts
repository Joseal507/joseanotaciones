import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildVisualPageCacheIdentity,
  getOrAnalyzeVisualPage,
  InMemoryVisualPageAnalysisStore,
  visualPageCacheKey,
  WorkerVisualPageAnalysisStore,
  type VisualPageCacheIdentity,
} from '../../lib/materials/visualPageCache'
import {
  VISUAL_PAGE_ANALYZER_VERSION,
  VISUAL_PAGE_MODEL,
  VISUAL_PAGE_PROMPT_VERSION,
  VISUAL_PAGE_PROVIDER,
  selectPagesNeedingVisualAnalysis,
  type VisualPageAnalysisResult,
} from '../../lib/materials/visualPageAnalysis'
import {
  computeMaterialContentFingerprint,
  computePdfPageFingerprint,
} from '../../lib/materials/pageContentSignals'

const fixedNow = () => new Date('2026-01-02T03:04:05.000Z')

function identity(overrides: Partial<VisualPageCacheIdentity> = {}): VisualPageCacheIdentity {
  return buildVisualPageCacheIdentity({
    materialFingerprint: 'material-fingerprint',
    page: 2,
    pageFingerprint: 'page-fingerprint',
    analyzerVersion: VISUAL_PAGE_ANALYZER_VERSION,
    promptVersion: VISUAL_PAGE_PROMPT_VERSION,
    provider: VISUAL_PAGE_PROVIDER,
    model: VISUAL_PAGE_MODEL,
    ...overrides,
  })
}

function analysis(
  cacheIdentity: VisualPageCacheIdentity,
  status: VisualPageAnalysisResult['status'] = 'success',
): VisualPageAnalysisResult {
  const text = status === 'success' ? 'Descripción visual válida y suficientemente extensa para el contrato determinístico.' : ''
  return {
    page: cacheIdentity.page,
    status,
    text,
    visualDescription: text,
    derivation: 'vision',
    provider: cacheIdentity.provider,
    model: cacheIdentity.model,
    attempts: status === 'no_api_key' ? 0 : 1,
    analyzerVersion: cacheIdentity.analyzerVersion,
    promptVersion: cacheIdentity.promptVersion,
    pageFingerprint: cacheIdentity.pageFingerprint,
  }
}

function testIdentityInvalidation() {
  const base = identity()
  assert.equal(visualPageCacheKey(base), visualPageCacheKey(identity()))
  assert.notEqual(visualPageCacheKey(base), visualPageCacheKey(identity({ pageFingerprint: 'changed-page' })))
  assert.notEqual(visualPageCacheKey(base), visualPageCacheKey(identity({ analyzerVersion: '9.0.0' })))
  assert.notEqual(visualPageCacheKey(base), visualPageCacheKey(identity({ promptVersion: '9.0.0' })))
  assert.notEqual(visualPageCacheKey(base), visualPageCacheKey(identity({ model: 'different-model' })))
}

async function testRestoreFirstAndSerializable() {
  const cacheIdentity = identity()
  const store = new InMemoryVisualPageAnalysisStore()
  let analyzeCalls = 0
  const analyze = async () => {
    analyzeCalls += 1
    return analysis(cacheIdentity)
  }
  const first = await getOrAnalyzeVisualPage({ identity: cacheIdentity, store, analyze, now: fixedNow })
  const second = await getOrAnalyzeVisualPage({ identity: cacheIdentity, store, analyze, now: fixedNow })
  assert.equal(first.cacheStatus, 'miss')
  assert.equal(second.cacheStatus, 'hit')
  assert.equal(analyzeCalls, 1)
  assert.equal(first.generatedAt, fixedNow().toISOString())
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(first)))
}

async function testStatusCachingPolicy() {
  const noContentIdentity = identity({ pageFingerprint: 'no-content' })
  const noContentStore = new InMemoryVisualPageAnalysisStore()
  let noContentCalls = 0
  const noContentAnalyze = async () => {
    noContentCalls += 1
    return analysis(noContentIdentity, 'no_content')
  }
  await getOrAnalyzeVisualPage({ identity: noContentIdentity, store: noContentStore, analyze: noContentAnalyze })
  const noContentHit = await getOrAnalyzeVisualPage({ identity: noContentIdentity, store: noContentStore, analyze: noContentAnalyze })
  assert.equal(noContentHit.cacheStatus, 'hit')
  assert.equal(noContentCalls, 1)

  for (const status of ['failed', 'no_api_key'] as const) {
    const cacheIdentity = identity({ pageFingerprint: status })
    const store = new InMemoryVisualPageAnalysisStore()
    let calls = 0
    const analyze = async () => {
      calls += 1
      return analysis(cacheIdentity, status)
    }
    await getOrAnalyzeVisualPage({ identity: cacheIdentity, store, analyze })
    await getOrAnalyzeVisualPage({ identity: cacheIdentity, store, analyze })
    assert.equal(calls, 2, `${status} no debe persistirse`)
  }
}

async function testConcurrentDedupe() {
  const cacheIdentity = identity({ pageFingerprint: 'concurrent' })
  const store = new InMemoryVisualPageAnalysisStore()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let analyzeCalls = 0
  const analyze = async () => {
    analyzeCalls += 1
    await gate
    return analysis(cacheIdentity)
  }
  const firstPromise = getOrAnalyzeVisualPage({ identity: cacheIdentity, store, analyze })
  const secondPromise = getOrAnalyzeVisualPage({ identity: cacheIdentity, store, analyze })
  await Promise.resolve()
  assert.equal(analyzeCalls, 1)
  release()
  const results = await Promise.all([firstPromise, secondPromise])
  assert.deepEqual(new Set(results.map(result => result.cacheStatus)), new Set(['miss', 'shared_inflight']))
}

async function testInFlightCleanupAfterThrow() {
  const cacheIdentity = identity({ pageFingerprint: 'throw-cleanup' })
  const store = new InMemoryVisualPageAnalysisStore()
  let analyzeCalls = 0
  await assert.rejects(() => getOrAnalyzeVisualPage({
    identity: cacheIdentity,
    store,
    analyze: async () => {
      analyzeCalls += 1
      throw new Error('transient-throw')
    },
  }), /transient-throw/)
  const recovered = await getOrAnalyzeVisualPage({
    identity: cacheIdentity,
    store,
    analyze: async () => {
      analyzeCalls += 1
      return analysis(cacheIdentity)
    },
  })
  assert.equal(recovered.status, 'success')
  assert.equal(analyzeCalls, 2)
}

async function testWorkerCorruptionIsExplicit() {
  const cacheIdentity = identity({ pageFingerprint: 'corrupt' })
  const store = new WorkerVisualPageAnalysisStore({
    getMaterialResult: async () => ({ payload: { broken: true } } as any),
    saveMaterialResult: async () => { throw new Error('save must not run') },
  })
  await assert.rejects(() => store.get(cacheIdentity), /VISUAL_PAGE_CACHE_CORRUPTED_PAYLOAD/)
}

function testLegacySelectionAndFixtureIdentities() {
  const pages = new Map([[1, 'x'.repeat(81)], [2, ''], [3, 'x'.repeat(80)], [4, '']])
  assert.deepEqual(selectPagesNeedingVisualAnalysis(pages, [1, 2, 3], { policy: 'legacy' }), [2, 3])
  assert.deepEqual(selectPagesNeedingVisualAnalysis(pages, [1, 4], { policy: 'legacy' }), [4])

  const pdf = readFileSync('tests/fixtures/real-materials/TAREA QUIMICA CLUTCH.pdf')
  const materialFingerprint = computeMaterialContentFingerprint(pdf)
  const keys = [1, 2, 3, 4, 5, 6].map(page => visualPageCacheKey(buildVisualPageCacheIdentity({
    materialFingerprint,
    page,
    pageFingerprint: computePdfPageFingerprint(materialFingerprint, page),
  })))
  assert.equal(new Set(keys).size, 6)
}

async function run() {
  testIdentityInvalidation()
  await testRestoreFirstAndSerializable()
  await testStatusCachingPolicy()
  await testConcurrentDedupe()
  await testInFlightCleanupAfterThrow()
  await testWorkerCorruptionIsExplicit()
  testLegacySelectionAndFixtureIdentities()
  console.log('visual-page-cache-contracts: PASS (providerCalls=0, leakage=0)')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
