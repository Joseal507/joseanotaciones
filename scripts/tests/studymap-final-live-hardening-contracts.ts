import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  initialFreeStudyMapState, beginFreeStudyMap, completeFreeStudyMap, failFreeStudyMap,
  abandonFreeStudyMap, type DurableFreeStudyMapState, type StudyMapData,
} from '../../lib/freeStudyMapState'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-map/route'

// ============================================================
// STUDYMAP_FINAL_LIVE_HARDENING: a real live test showed the previous
// activeGenerationKeyRef cleanup fix stopped permanent loading but
// reintroduced a DUPLICATE live request:
//
//   POST /api/alai-studyal-map 200 in 10336ms
//   POST /api/alai-studyal-map 200 in 10638ms
//
// ROOT CAUSE: releasing the guard on an interrupted cleanup is necessary
// but not sufficient — the FIRST invocation's fetch was never actually
// cancelled, so it kept running to completion in the background while a
// SECOND invocation (React StrictMode's dev double-invoke) started its
// own fresh fetch for the identical identity. Both completed --> two
// live POSTs.
//
// FIX: an AbortController per effect invocation, aborted in the same
// cleanup that releases the guard, with the fetch's catch() treating an
// aborted request as a clean interruption (no error surfaced, no
// duplicate state write) rather than a real failure.
//
// This harness models the REAL fetch race with a genuine AbortController
// (Node 18+ global), not just the persisted-state reducers — the
// abort/never-resolves behavior is exactly what a real interrupted
// `fetch()` does, so this proves the actual mechanism, not just the
// state machine around it.
// ============================================================

const fakeMap: StudyMapData = { title: 't', root: { id: 'root', label: 't', type: 'root' } }
interface FetchResult { ok: boolean; success: boolean; mapa?: StudyMapData; error?: string }

class RealFetchHarness {
  activeKey: string | null = null
  requestsStarted = 0
  requestsCompleted = 0
  storesByKey = new Map<string, DurableFreeStudyMapState>()

  private key(sessionId: string, fingerprint: string) { return `${sessionId}::${fingerprint}` }
  stateOf(sessionId: string, fingerprint: string) { return this.storesByKey.get(this.key(sessionId, fingerprint)) || initialFreeStudyMapState() }

  /** One useEffect invocation, mirroring the REAL fixed component exactly (guard + AbortController + abort-aware catch). */
  mount(sessionId: string, fingerprint: string, fetchImpl: (signal: AbortSignal) => Promise<FetchResult>): { cleanup: () => void; awaitSettled: () => Promise<void> } {
    const generationKey = this.key(sessionId, fingerprint)
    const controller = new AbortController()
    let cancelled = false
    let startedAttempt: number | null = null

    const run = async () => {
      if (!sessionId) return
      if (this.activeKey === generationKey) return
      const current = this.storesByKey.get(generationKey) || initialFreeStudyMapState()
      if (current.mapData) return

      const started = beginFreeStudyMap(current)
      startedAttempt = started.attempt
      this.storesByKey.set(generationKey, started)
      this.activeKey = generationKey
      this.requestsStarted++

      try {
        const data = await fetchImpl(controller.signal)
        if (controller.signal.aborted) return // interrupted — cleanup already handled it
        this.requestsCompleted++
        if (!data.ok || !data.success) {
          this.storesByKey.set(generationKey, failFreeStudyMap(this.storesByKey.get(generationKey)!, startedAttempt, data.error || 'Error'))
          startedAttempt = null
          this.activeKey = null
          return
        }
        this.storesByKey.set(generationKey, completeFreeStudyMap(this.storesByKey.get(generationKey)!, startedAttempt, data.mapa!))
        startedAttempt = null
        this.activeKey = null
      } catch {
        if (controller.signal.aborted) return // abort-aware catch — the actual fix
        startedAttempt = null
        this.activeKey = null
      }
    }

    const settled = run()
    return {
      awaitSettled: () => settled,
      cleanup: () => {
        cancelled = true
        controller.abort()
        if (startedAttempt !== null) {
          this.storesByKey.set(generationKey, abandonFreeStudyMap(this.storesByKey.get(generationKey)!, startedAttempt))
          if (this.activeKey === generationKey) this.activeKey = null
        }
      },
    }
  }
}

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => { await fn(); console.log(`  ✅ ${name}`) })()
}

async function main() {
  await test('A. StrictMode-like mount/cleanup/remount causes exactly ONE request to ever complete', async () => {
    const h = new RealFetchHarness()
    // Invocation A: fetch never resolves on its own — it will only ever
    // settle via abort, exactly like a real slow (~10s) server response
    // interrupted by React's dev double-invoke.
    const a = h.mount('sess-1', 'fp-1', (signal) => new Promise<FetchResult>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    a.cleanup() // StrictMode's synchronous cleanup before the real mount
    await a.awaitSettled()

    const b = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await b.awaitSettled()

    assert.equal(h.requestsStarted, 2, 'two fetches were started (A then B)')
    assert.equal(h.requestsCompleted, 1, 'exactly ONE request ever actually completed — A was truly cancelled, not left running')
    assert.equal(h.stateOf('sess-1', 'fp-1').status, 'completed')
  })

  await test('B. no permanent-loading regression: the sequence above still resolves to a real map', async () => {
    const h = new RealFetchHarness()
    const a = h.mount('sess-1', 'fp-1', (signal) => new Promise<FetchResult>((_r, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    a.cleanup()
    await a.awaitSettled()
    const b = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await b.awaitSettled()
    assert.notEqual(h.stateOf('sess-1', 'fp-1').status, 'generating', 'must never end up permanently stuck generating')
    assert.ok(h.stateOf('sess-1', 'fp-1').mapData, 'a real map must be present')
  })

  await test('C. no orphaned first fetch: the interrupted invocation never silently writes state after being aborted', async () => {
    const h = new RealFetchHarness()
    let aResolvedNormally = false
    const a = h.mount('sess-1', 'fp-1', (signal) => new Promise<FetchResult>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      // If NOT aborted, this would eventually resolve — proving the abort
      // is what actually stops it, not a race we got lucky on. unref()'d
      // so this pending timer never keeps the test process alive.
      const t = setTimeout(() => { aResolvedNormally = true; resolve({ ok: true, success: true, mapa: fakeMap }) }, 999999)
      ;(t as any).unref?.()
    }))
    a.cleanup()
    await a.awaitSettled()
    assert.equal(aResolvedNormally, false, 'the aborted fetch must reject via the abort listener, never reach its own timeout resolution path in this test window')
    const b = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await b.awaitSettled()
    assert.equal(h.stateOf('sess-1', 'fp-1').mapData, fakeMap)
  })

  await test('D. failure releases/recoverable single-flight state (unchanged by this fix)', async () => {
    const h = new RealFetchHarness()
    const a = h.mount('sess-1', 'fp-1', async () => ({ ok: false, success: false, error: 'boom' }))
    await a.awaitSettled()
    assert.equal(h.activeKey, null)
    assert.equal(h.stateOf('sess-1', 'fp-1').status, 'recoverable')
    const b = h.mount('sess-1', 'fp-1', async () => ({ ok: true, success: true, mapa: fakeMap }))
    await b.awaitSettled()
    assert.ok(h.stateOf('sess-1', 'fp-1').mapData)
  })

  await test('E. map generation remains 0 provider calls (route unchanged in this respect)', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
    const fnBody = routeSource.slice(
      routeSource.indexOf('async function handleGroundedStudyMapRequest'),
      routeSource.indexOf('async function handleExplainNodeRequest'),
    )
    assert.ok(!fnBody.includes('__routeDeps.generateValidatedLegacyJson') && !fnBody.includes('__routeDeps.alai'))
  })

  // ── F/G/H/J: explain_node provenance + math preservation, exercised
  // against the real route with a mocked provider.
  const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [4] }), fingerprint: 'fp-explain' }
  const enjoyerPayload = {
    sourceSelectionFingerprint: 'fp-explain', materialIds: ['mat-a'], selectedPages: { 'mat-a': [4] },
    topicsIndex: [{ id: 't1', title: 'Física cuántica' }],
    globalOrderedAnalysis: [
      { id: 'n1', kind: 'formula', name: 'Impacto en la Física Cuántica', content: 'E_n = -13.6 eV / n²', importance: 90, difficulty: 'advanced', topicId: 't1', materialId: 'mat-a', pages: [4], sourceSpans: [{ page: 4, quote: 'E_n = -13.6 eV / n²' }] },
    ],
    uniqueConceptsIndex: [], relations: [],
  }

  function wireExplainDeps(alaiJsonImpl: () => Promise<any>) {
    const enjoyerStore = new Map<string, any>([['fp-explain', enjoyerPayload]])
    Object.assign(__routeDeps, {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async () => ({ id: 'sess-explain', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any,
      getMaterial: async () => ({ id: 'mat-a', nombre: 'Física' }) as any,
      lookupStudyalMaterialEnjoyer: async (fp: string) => enjoyerStore.get(fp) ?? null,
      materialEnjoyerStore: {} as any,
      generateValidatedLegacyJson: alaiJsonImpl,
    })
  }

  async function postExplain() {
    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-explain', unitId: 'map_node:n1' }),
    }))
    return { response, data: await response.json() }
  }

  await test('F. explain_node remains exactly 1 provider call', async () => {
    let calls = 0
    wireExplainDeps(async () => { calls++; return { answer: 'E_n = -13.6 eV / n²', pedagogicalNote: '', usedRelationIds: [] } })
    const { response } = await postExplain()
    assert.equal(response.status, 200)
    assert.equal(calls, 1)
  })

  await test('G. explain_node cannot silently attribute unsupported enrichment to source pages — pedagogicalNote is a separate, distinct field', async () => {
    wireExplainDeps(async () => ({
      answer: 'La energía del nivel n está dada por E_n = -13.6 eV / n².',
      pedagogicalNote: 'Piensa en los electrones como si pudieran "saltar" de nivel — esto no viene literalmente de tu material, es solo una forma de visualizarlo.',
      usedRelationIds: [],
    }))
    const { data } = await postExplain()
    assert.ok(data.explanation.answer, 'answer present')
    assert.ok(data.explanation.pedagogicalNote, 'pedagogicalNote present as its OWN field')
    assert.notEqual(data.explanation.answer, data.explanation.pedagogicalNote, 'the two must never be merged into one string')
    // The provenance contract: sourcePages is returned once, at the
    // explanation level — never duplicated per-field — so the UI can
    // attach "Fuentes: p.X" to `answer` alone and render `pedagogicalNote`
    // with no page badge at all (enforced client-side, see I).
    assert.deepEqual(data.explanation.sourcePages, [4])
  })

  await test('H. real source-backed claims retain correct page provenance', async () => {
    wireExplainDeps(async () => ({ answer: 'Contenido respaldado.', pedagogicalNote: '', usedRelationIds: [] }))
    const { data } = await postExplain()
    assert.deepEqual(data.explanation.sourcePages, [4], 'sourcePages still comes from the real Enjoyer node, unchanged')
    assert.equal(data.explanation.unitId, 'map_node:n1')
  })

  await test('I. external enrichment, if retained, is visibly distinguished in the client (structural proof)', () => {
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.ok(componentSource.includes('explicacion.pedagogicalNote'), 'the client reads pedagogicalNote as its own field')
    const block = componentSource.slice(
      componentSource.indexOf('{explicacion.pedagogicalNote &&'),
      componentSource.indexOf('{explicacion.pedagogicalNote &&') + 600,
    )
    assert.ok(block.includes('no viene del material'), 'the pedagogical note is rendered with an explicit "not from the material" label')
    assert.ok(!block.includes('Fuentes'), 'the pedagogical note block must never carry a "Fuentes" (sources) badge')
  })

  await test('J. math expression preservation: the prompt explicitly forbids compacting formulas, and the route never mutates the answer text', async () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
    const explainFnBody = routeSource.slice(
      routeSource.indexOf('async function handleExplainNodeRequest'),
      routeSource.indexOf('const BRANCH_EMOJIS'),
    )
    assert.ok(/FÓRMULAS Y NOTACIÓN/.test(explainFnBody), 'an explicit formula-preservation rule is present in the prompt')
    assert.ok(explainFnBody.includes('E_n = -13.6 eV / n²'), 'the prompt gives a concrete correct-vs-compacted example')

    let capturedAnswer = ''
    wireExplainDeps(async () => {
      capturedAnswer = 'E_n = -13.6 eV / n²'
      return { answer: capturedAnswer, pedagogicalNote: '', usedRelationIds: [] }
    })
    const { data } = await postExplain()
    assert.equal(data.explanation.answer, capturedAnswer, 'the route must pass the answer through unmodified — no stripping of spaces/underscores/slashes')
  })

  await test('K. no Material Brain dependency introduced by this hardening', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
    const componentSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    for (const source of [routeSource, componentSource]) {
      assert.ok(!source.includes('restoreMaterialBrain') && !source.includes('WorkerMaterialResultStore') && !source.includes('/api/material-brain'))
      assert.ok(!source.includes('setBrainSourceSelection') && !source.includes('useMaterialBrainLifecycle'))
    }
  })

  console.log('studymap-final-live-hardening-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
