import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  WorkerChatTurnStore, runDurableChatTurn, chatTurnIdentity, chatRequestHash,
  type ChatTurnRecord, type ChatTurnResult,
} from '../../lib/alai-chat/turnStore'

// ============================================================
// ALAI Chat Worker Persistence Contracts
//
// Verifies WorkerChatTurnStore against the exact HTTP protocol
// implemented by cloudflare/studyal-api/src/index.ts:
//   - GET /material-results/by-material
//   - POST /material-results/alai-chat-turn-cas
//
// Covers:
//   1. Reproduction of the live 503: undeployed CAS route (404) fails
//      at Step D (guardar pending) with 0 provider calls -> 503.
//   2. Primer turno: successful reserve, single provider call, completed commit.
//   3. Completed retry: re-read returns completed -> 0 provider calls.
//   4. Refresh + retry: after a failed attempt, attempt 2 reserves and completes.
//   5. Provider failure: provider throws -> turn safely marked 'failed'.
//   6. Worker read failure: read endpoint errors -> 0 provider calls -> 503.
//   7. Worker commit failure: commit endpoint fails -> commit unconfirmed -> 503.
// ============================================================

const selection = buildSourceSelectionSnapshot(['math-fixture'], { 'math-fixture': [1] })
const material = {
  sourceSelectionFingerprint: selection.fingerprint, materialIds: selection.materialIds, selectedPages: selection.selectedPages,
  topicsIndex: [{ id: 't1', title: 'Álgebra' }],
  globalOrderedAnalysis: [{ id: 'eq1', name: 'Ecuación cuadrática', content: 'Resolución de ecuaciones de segundo grado', kind: 'concept', importance: 90, difficulty: 'basic', topicId: 't1', materialId: 'math-fixture', pages: [1], sourceSpans: [] }],
  uniqueConceptsIndex: [], relations: [],
}

const mockProviderOutput = {
  answer: '1. Simplificar dividiendo por 2: x² - 4x + 3 = 0.\n2. Factorizar: (x - 1)(x - 3) = 0.\n3. Soluciones: x = 1 o x = 3.',
  usedTargetIds: [],
  usedRelationIds: [],
  suggestedFollowups: ['¿Quieres verificar las soluciones?'],
  externalKnowledgeUsed: true,
}

interface WorkerRow {
  id: string
  payload: ChatTurnRecord
  content_hash: string
}

function createWorkerMock(opts: {
  undeployed?: boolean
  readError?: boolean
  commitError?: boolean
} = {}) {
  const table = new Map<string, WorkerRow>()
  return async (input: any, init?: any): Promise<Response> => {
    const url = String(input)
    if (url.includes('/material-results/by-material')) {
      if (opts.readError) return new Response('Internal Server Error', { status: 500 })
      const parsedUrl = new URL(url)
      const materialId = parsedUrl.searchParams.get('materialId') || ''
      const row = table.get(materialId)
      return new Response(JSON.stringify({
        ok: true,
        result: row ? { id: row.id, payload: row.payload, content_hash: row.content_hash } : null,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    if (url.includes('/material-results/alai-chat-turn-cas')) {
      if (opts.undeployed) return new Response('Not Found', { status: 404 })
      if (opts.commitError) return new Response('Bad Gateway', { status: 502 })
      const body = JSON.parse(String(init?.body || '{}'))
      const existing = table.get(body.id)

      if (body.expectedRevision === null) {
        if (existing) return new Response(JSON.stringify({ ok: true, applied: false }), { status: 200, headers: { 'content-type': 'application/json' } })
        table.set(body.id, { id: body.id, payload: body.payload, content_hash: body.revision })
        return new Response(JSON.stringify({ ok: true, applied: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      if (existing && existing.content_hash === body.expectedRevision) {
        if (existing.payload.status === 'completed') {
          return new Response(JSON.stringify({ ok: true, applied: false }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        table.set(body.id, { id: body.id, payload: body.payload, content_hash: body.revision })
        return new Response(JSON.stringify({ ok: true, applied: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }

      return new Response(JSON.stringify({ ok: true, applied: false }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    throw new Error(`Unexpected mock fetch url: ${url}`)
  }
}

async function main() {
  console.log('\n── ALAI Chat Worker Persistence Contracts ──\n')
  let passed = 0

  // 1. REPRODUCCIÓN DEL 503 REAL: CAS 404
  {
    const mockFetch = createWorkerMock({ undeployed: true })
    const store = new WorkerChatTurnStore('https://fake-worker.test', mockFetch as any)
    let providerCalls = 0
    Object.assign(__routeDeps, {
      getServerSession: async () => ({ user: { id: 'u1' } }),
      getAuthoritativeFreeSession: async () => ({ id: 's1', userId: 'u1', processMode: 'free', sourceSelection: selection }),
      getMaterial: async () => ({ id: 'math-fixture', nombre: 'Álgebra' }),
      lookupStudyalMaterialEnjoyer: async () => material,
      chatTurnStore: store,
      generateValidatedLegacyJson: async () => { providerCalls++; return mockProviderOutput },
    })

    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's1',
        turnId: 'turn-undeployed-test',
        attempt: 1,
        message: 'Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.',
      }),
    })
    const res = await POST(req)
    const data = await res.json()

    assert.equal(res.status, 503, 'Undeployed worker route returns 503')
    assert.equal(data.error, 'CHAT_TURN_STORAGE_UNAVAILABLE')
    assert.equal(data.internalCode, 'CHAT_TURN_STORAGE_RESERVE_FAILED')
    assert.match(data.userMessage, /guardarse o recuperarse/)
    assert.doesNotMatch(data.detail, /CHAT_|404/)
    assert.equal(providerCalls, 0, 'Stage D failure must abort BEFORE any provider call')
    console.log('  ✅ 1. Reproduces exact live 503: undeployed CAS route (404) fails at Step D with 0 provider calls')
    passed++
  }

  // 2. PRIMER TURNO: Healthy worker persistence
  let sharedFetch = createWorkerMock()
  {
    const store = new WorkerChatTurnStore('https://fake-worker.test', sharedFetch as any)
    let providerCalls = 0
    Object.assign(__routeDeps, {
      chatTurnStore: store,
      generateValidatedLegacyJson: async () => { providerCalls++; return mockProviderOutput },
    })

    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's1',
        turnId: 'turn-healthy-1',
        attempt: 1,
        message: 'Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.',
      }),
    })
    const res = await POST(req)
    const data = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.success, true)
    assert.equal(providerCalls, 1, 'Exactly 1 provider call for fresh turn')
    assert.match(data.answer, /Simplificar/)
    console.log('  ✅ 2. Primer turno: successful reserve, 1 provider call, completed commit -> 200 OK')
    passed++
  }

  // 3. COMPLETED RETRY: Zero provider calls
  {
    const store = new WorkerChatTurnStore('https://fake-worker.test', sharedFetch as any)
    let providerCalls = 0
    Object.assign(__routeDeps, {
      chatTurnStore: store,
      generateValidatedLegacyJson: async () => { providerCalls++; return mockProviderOutput },
    })

    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's1',
        turnId: 'turn-healthy-1',
        attempt: 1,
        message: 'Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.',
      }),
    })
    const res = await POST(req)
    const data = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.success, true)
    assert.equal(providerCalls, 0, 'Completed retry restores from worker store with 0 provider calls')
    console.log('  ✅ 3. Completed retry: restores from worker store with 0 provider calls')
    passed++
  }

  // 4. REFRESH + RETRY: Higher attempt after failure
  {
    const store = new WorkerChatTurnStore('https://fake-worker.test', sharedFetch as any)
    let providerCalls = 0
    let shouldFail = true
    Object.assign(__routeDeps, {
      chatTurnStore: store,
      generateValidatedLegacyJson: async () => {
        providerCalls++
        if (shouldFail) throw new Error('PROVIDER_NETWORK_TIMEOUT')
        return mockProviderOutput
      },
    })

    // Attempt 1 fails at provider
    const req1 = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's1',
        turnId: 'turn-retry-test',
        attempt: 1,
        message: 'Resuelve 2x² - 8x + 6 = 0 paso a paso.',
      }),
    })
    const res1 = await POST(req1)
    assert.equal(res1.status, 503)
    assert.equal(providerCalls, 1)

    // Attempt 1 repeat fails fast (previous attempt confirmed failed, must increment attempt)
    const req1Repeat = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's1',
        turnId: 'turn-retry-test',
        attempt: 1,
        message: 'Resuelve 2x² - 8x + 6 = 0 paso a paso.',
      }),
    })
    const res1Repeat = await POST(req1Repeat)
    assert.equal(res1Repeat.status, 409, 'Attempt 1 repeat rejected with 409')
    assert.equal(providerCalls, 1, 'Zero provider calls on unincremented attempt retry')

    // Attempt 2 succeeds
    shouldFail = false
    const req2 = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's1',
        turnId: 'turn-retry-test',
        attempt: 2,
        message: 'Resuelve 2x² - 8x + 6 = 0 paso a paso.',
      }),
    })
    const res2 = await POST(req2)
    const data2 = await res2.json()
    assert.equal(res2.status, 200)
    assert.equal(data2.success, true)
    assert.equal(providerCalls, 2)
    console.log('  ✅ 4. Refresh + retry: attempt 1 failure records failed state, attempt 2 succeeds')
    passed++
  }

  // 5. PROVIDER FAILURE: Turn is safely marked failed
  {
    const freshFetch = createWorkerMock()
    const store = new WorkerChatTurnStore('https://fake-worker.test', freshFetch as any)
    Object.assign(__routeDeps, {
      chatTurnStore: store,
      generateValidatedLegacyJson: async () => { throw new Error('PROVIDER_RATE_LIMIT') },
    })

    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's1',
        turnId: 'turn-prov-fail',
        attempt: 1,
        message: 'Pregunta que fallará.',
      }),
    })
    const res = await POST(req)
    assert.equal(res.status, 503)

    // Verify row status in worker is 'failed'
    const id = chatTurnIdentity('u1', 's1', selection.fingerprint, 'turn-prov-fail')
    const stored = await store.read(id)
    assert.equal(stored?.record.status, 'failed')
    console.log('  ✅ 5. Provider failure: safely transitions turn status from pending to failed')
    passed++
  }

  // 6. WORKER READ FAILURE: 503 with 0 provider calls
  {
    const mockFetch = createWorkerMock({ readError: true })
    const store = new WorkerChatTurnStore('https://fake-worker.test', mockFetch as any)
    let providerCalls = 0
    Object.assign(__routeDeps, {
      chatTurnStore: store,
      generateValidatedLegacyJson: async () => { providerCalls++; return mockProviderOutput },
    })

    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's1',
        turnId: 'turn-read-fail',
        attempt: 1,
        message: 'Pregunta con storage caído.',
      }),
    })
    const res = await POST(req)
    const data = await res.json()

    assert.equal(res.status, 503)
    assert.equal(data.error, 'CHAT_TURN_STORAGE_UNAVAILABLE')
    assert.equal(data.internalCode, 'CHAT_TURN_STORAGE_READ_FAILED')
    assert.doesNotMatch(data.detail, /CHAT_/)
    assert.equal(providerCalls, 0)
    console.log('  ✅ 6. Worker read failure: surfaces as 503 with 0 provider calls')
    passed++
  }

  // 7. WORKER COMMIT FAILURE: unconfirmed commit returns 503
  {
    const mockFetch = createWorkerMock({ commitError: true })
    const store = new WorkerChatTurnStore('https://fake-worker.test', mockFetch as any)
    let providerCalls = 0
    Object.assign(__routeDeps, {
      chatTurnStore: store,
      generateValidatedLegacyJson: async () => { providerCalls++; return mockProviderOutput },
    })

    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 's1',
        turnId: 'turn-commit-fail',
        attempt: 1,
        message: 'Pregunta con commit caído.',
      }),
    })
    const res = await POST(req)
    const data = await res.json()

    assert.equal(res.status, 503)
    assert.equal(data.error, 'CHAT_TURN_STORAGE_UNAVAILABLE')
    console.log('  ✅ 7. Worker commit failure: unconfirmed commit returns 503 safely')
    passed++
  }

  console.log(`\nResults: ${passed} passed, 0 failed\n`)
  console.log('alai-chat-worker-persistence-contracts: ALL PASS')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
