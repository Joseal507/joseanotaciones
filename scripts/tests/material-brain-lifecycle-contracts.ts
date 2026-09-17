import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { useMaterialBrainLifecycle } from '../../lib/materialBrain/useMaterialBrainLifecycle'
import { shouldBlockFlashcardsGeneration } from '../../components/materias/ALAIStudyALCards'
import { resolveMaterialPreparationGate } from '../../components/materias/MaterialPreparationScreen'
import { resolveSourceMaterialsForBrain } from '../../lib/materialBrain/resolve'
import * as materialBrainRoute from '../../app/api/material-brain/route'
import * as flashcardsRoute from '../../app/api/flashcards-v2/route'
import type { Material } from '../../lib/materials/types'

type Snapshot = ReturnType<typeof useMaterialBrainLifecycle>

function scopeFor(materialIds: string[], selectedPages: Record<string, number[]> = {}) {
  return buildSourceSelectionSnapshot(materialIds, selectedPages)
}

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log('  ✅ ' + name)
    passed++
  } catch (err: any) {
    console.log('  ❌ ' + name)
    console.log('     ' + (err?.message || err))
    failed++
  }
}

function createDom() {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>')
  ;(globalThis as any).window = window
  ;(globalThis as any).document = document
  ;(globalThis as any).navigator = window.navigator
  return { document, window }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

async function withHookHarness(
  run: (api: {
    renderWithSelection: (selection: any) => Promise<void>
    latest: () => Snapshot | null
    rootUnmount: () => void
  }) => Promise<void>,
) {
  const { document } = createDom()
  const container = document.getElementById('root') as any
  const root = createRoot(container)

  let latestSnapshot: Snapshot | null = null

  function Probe({ selection }: { selection: any }) {
    const snapshot = useMaterialBrainLifecycle(selection)
    useEffect(() => {
      latestSnapshot = snapshot
    }, [snapshot.status, snapshot.fingerprint, snapshot.recheck])
    return null
  }

  async function renderWithSelection(selection: any) {
    await act(async () => {
      root.render(React.createElement(Probe, { selection }))
    })
    await flush()
  }

  try {
    await run({
      renderWithSelection,
      latest: () => latestSnapshot,
      rootUnmount: () => root.unmount(),
    })
  } finally {
    root.unmount()
  }
}

async function main() {
  console.log('\n── Material Brain Lifecycle Contracts (real hook + route spies) ──\n')

  // Save originals to restore after test overrides
  const originalFetch = globalThis.fetch
  const mbDeps = materialBrainRoute.__routeDeps
  const fcDeps = flashcardsRoute.__routeDeps

  // 1. mismo fingerprint → hook no refira POST /api/material-brain una segunda vez
  await test('TEST 1: hook same fingerprint does not re-trigger a network call', async () => {
    // P0 fix: the first call for a fingerprint is now a lookup-only GET
    // (never a blind POST) — if it already reports 'ready', the hook
    // resolves immediately with zero 'building' flash and no POST at all.
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
    }) as any

    const selection = scopeFor(['mat_a'], { mat_a: [1, 2] })

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selection)
      assert.equal(latest()?.status, 'ready')
      await renderWithSelection({ ...selection }) // same fingerprint, new object
      assert.equal(latest()?.status, 'ready')
    })

    assert.equal(calls, 1, 'same fingerprint must not trigger a second network call')
  })

  // 2. fingerprint distinto → nuevo ciclo, descarta stale vieja
  await test('TEST 2: hook different fingerprint triggers new cycle and discards stale response', async () => {
    let resolvers: Array<(r: Response) => void> = []
    globalThis.fetch = ((input: any, init?: any) => {
      // The initial lookup-only GET reports "missing" (genuinely never
      // built before) so the hook falls through to the real POST/build
      // path below — preserving this test's original intent (verifying
      // the 'building' + stale-response-discard behavior of the POST
      // path itself).
      if (init?.method === 'POST') {
        return new Promise<Response>(resolve => resolvers.push(resolve)) as any
      }
      return Promise.resolve(new Response(JSON.stringify({ status: 'missing' }), { status: 200 })) as any
    }) as any

    const selectionA = scopeFor(['mat_a'], { mat_a: [1] })
    const selectionB = scopeFor(['mat_a'], { mat_a: [1, 2] })

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selectionA)
      assert.equal(latest()?.status, 'building')

      await renderWithSelection(selectionB)
      assert.equal(latest()?.status, 'building')

      // Resolve B first as ready
      resolvers[1](new Response(JSON.stringify({ status: 'ready' }), { status: 200 }))
      await flush()
      assert.equal(latest()?.status, 'ready')
      assert.equal(latest()?.fingerprint, selectionB.fingerprint)

      // Resolve A late as failed — must be discarded
      resolvers[0](new Response(JSON.stringify({ status: 'failed' }), { status: 200 }))
      await flush()
      assert.equal(latest()?.status, 'ready', 'stale response must not override newer fingerprint state')
      assert.equal(latest()?.fingerprint, selectionB.fingerprint)
    })
  })

  // 3. status building del backend → hook expone building
  await test('TEST 3: hook exposes building when backend says building', async () => {
    globalThis.fetch = (async (_input: any, init?: any) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ status: 'building' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'building', fingerprint: 'x', builderVersion: null }), { status: 200 })
    }) as any

    const selection = scopeFor(['mat_a'], { mat_a: [1] })

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selection)
      assert.equal(latest()?.status, 'building')
    })
  })

  // 4. status ready → recheck() works on hook real
  await test('TEST 4: hook recheck() triggers a new POST', async () => {
    // P0 fix: the initial mount now resolves via the lookup-only GET
    // (already 'ready' here — zero POSTs needed). recheck() is an
    // explicit, user/caller-initiated retry and still always goes
    // straight to triggerBuild (POST), unchanged — so exactly ONE POST
    // is expected here (from recheck), not two.
    let calls = 0
    globalThis.fetch = (async (_input: any, init?: any) => {
      if (init?.method === 'POST') {
        calls++
        return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'ready', fingerprint: 'x', builderVersion: '1.1.0' }), { status: 200 })
    }) as any

    const selection = scopeFor(['mat_a'], { mat_a: [1] })

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selection)
      assert.equal(latest()?.status, 'ready')
      latest()?.recheck()
      await flush()
      assert.equal(latest()?.status, 'ready')
    })

    assert.equal(calls, 1, 'recheck must trigger exactly one new POST (initial mount resolved via GET, no POST needed)')
  })

  await test('AUTO-PREP-1/2/3/5: retryable preparation resumes automatically and reaches ready', async () => {
    let calls = 0
    globalThis.fetch = (async (_input: any, init?: any) => {
      assert.equal(init?.method, 'POST')
      calls++
      return new Response(JSON.stringify(calls === 1 ? {
        status: 'partial',
        preparation: {
          requiredStatus: 'partial', completedRequiredSections: 3, totalRequiredSections: 4,
          requiredFailures: [{ chunkId: 'hidden', status: 'retryable_failed' }],
        },
      } : { status: 'ready', preparation: { requiredStatus: 'complete', requiredFailures: [] } }), { status: 200 })
    }) as any
    const selection = scopeFor(['auto-material'], { 'auto-material': [1] })
    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selection)
      assert.equal(latest()?.status, 'building')
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)) })
      await flush()
      assert.equal(calls, 2)
      assert.equal(latest()?.status, 'ready')
    })
  })

  await test('AUTO-PREP-11/12: terminal failure stops while transient 5xx remains bounded/recoverable', async () => {
    // P0 fix: the initial lookup-only GET also observes this same
    // partial/terminal-failure shape (it isn't 'ready', so the hook
    // falls through to the real POST) — one extra, cheap lookup call,
    // then exactly one POST attempt, still never entering automatic
    // retry for a genuinely terminal failure.
    let terminalPostCalls = 0
    let terminalTotalCalls = 0
    globalThis.fetch = (async (_input: any, init?: any) => {
      terminalTotalCalls++
      if (init?.method === 'POST') terminalPostCalls++
      return new Response(JSON.stringify({
        status: 'partial',
        preparation: { requiredStatus: 'failed', requiredFailures: [{ chunkId: 'hidden', status: 'terminal_failed' }] },
      }), { status: 200 })
    }) as any
    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scopeFor(['terminal-material'], { 'terminal-material': [1] }))
      assert.equal(latest()?.status, 'failed')
    })
    assert.equal(terminalPostCalls, 1, 'terminal work must not enter automatic retry (exactly one build attempt)')
    assert.equal(terminalTotalCalls, 2, 'one lookup-only GET (not ready) + one POST build attempt, never a retry loop')

    let transientCalls = 0
    globalThis.fetch = (async () => {
      transientCalls++
      return transientCalls === 1
        ? new Response('temporary', { status: 503 })
        : new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
    }) as any
    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scopeFor(['transient-material'], { 'transient-material': [1] }))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)) })
      await flush()
      assert.equal(latest()?.status, 'ready')
    })
    assert.equal(transientCalls, 2)
  })

  // 4b. brainStatus guard closes idle/undefined bypass explicitly
  await test('TEST 4b: flashcards brain gate blocks undefined/idle for user action and stops retries on partial/failed', async () => {
    assert.deepEqual(
      shouldBlockFlashcardsGeneration(undefined, false),
      { block: true, reason: 'building' },
      'undefined must be blocked conservatively on user click',
    )
    assert.deepEqual(
      shouldBlockFlashcardsGeneration('idle', false),
      { block: true, reason: 'building' },
      'idle must be blocked conservatively on user click',
    )
    assert.deepEqual(
      shouldBlockFlashcardsGeneration('ready', false),
      { block: false, reason: null },
      'ready must allow generation',
    )
    assert.deepEqual(
      shouldBlockFlashcardsGeneration('building', false),
      { block: true, reason: 'building' },
      'building must block user click',
    )

    assert.deepEqual(
      shouldBlockFlashcardsGeneration('building', true),
      { block: false, reason: null },
      'internal retry may continue while still building',
    )
    assert.deepEqual(
      shouldBlockFlashcardsGeneration(undefined, true),
      { block: false, reason: null },
      'internal retry may continue while status is still undefined/idle',
    )
    assert.deepEqual(
      shouldBlockFlashcardsGeneration('partial', true),
      { block: true, reason: 'partial' },
      'internal retry must stop once hook advanced to partial',
    )
    assert.deepEqual(
      shouldBlockFlashcardsGeneration('failed', true),
      { block: true, reason: 'failed' },
      'internal retry must stop once hook advanced to failed',
    )
  })

  // 4bb. EmptyGenerate must receive brainStatus in BOTH render paths
  await test('TEST 4bb: both EmptyGenerate call-sites receive brainStatus', async () => {
    const source = readFileSync('components/materias/ALAIStudyALCards.tsx', 'utf8')
    const emptyGenerateUsages = (source.match(/<EmptyGenerate\b/g) || []).length
    const brainStatusProps = (source.match(/brainStatus=\{brainStatus\}/g) || []).length

    assert.equal(emptyGenerateUsages, 2, 'el componente debe tener exactamente 2 call-sites de <EmptyGenerate>')
    assert.equal(
      brainStatusProps,
      2,
      'ambos call-sites de EmptyGenerate deben recibir brainStatus={brainStatus}',
    )
  })

  // 4c. restore/deep-link path primes lifecycle even without TemaView callback
  await test('TEST 4c: restore/deep-link selection reaches ready without onSourceSelectionReady callback', async () => {
    // P0 fix (CONTINUE-3/4): a restored/deep-linked selection whose
    // Brain is already ready must resolve via the single lookup-only
    // GET — no POST, no 'building' flash, hub renders immediately.
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
    }) as any

    // Simula exactamente el camino de restore de page.tsx:
    // la selección viene del freeSession restaurado (materialIds + selectedPages),
    // no del callback de TemaView.
    const restoredSessionSelection = buildSourceSelectionSnapshot(
      ['mat_restore_a', 'mat_restore_b'],
      { mat_restore_a: [1, 2], mat_restore_b: [3] },
    )

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(restoredSessionSelection)
      assert.equal(latest()?.status, 'ready')
      assert.equal(latest()?.fingerprint, restoredSessionSelection.fingerprint)
    })

    assert.equal(calls, 1, 'restore/deep-link selection must resolve via exactly one lookup call (GET), never a build POST when already ready')
  })

  // 5. cleanup: new selection clears stale ready
  await test('TEST 5: hook cleanup replaces old ready with new building cycle', async () => {
    let calls = 0
    globalThis.fetch = (async (_input: any, init?: any) => {
      calls++
      return new Response(JSON.stringify({ status: calls === 1 ? 'ready' : 'building' }), { status: 200 })
    }) as any

    const selectionA = scopeFor(['mat_a'], { mat_a: [1] })
    const selectionB = scopeFor(['mat_b'], { mat_b: [2] })

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selectionA)
      assert.equal(latest()?.status, 'ready')
      await renderWithSelection(selectionB)
      assert.equal(latest()?.status, 'building', 'new fingerprint must replace old ready state')
      assert.equal(latest()?.fingerprint, selectionB.fingerprint)
    })
  })

  // 6. flashcards route with non-ready brain → never invokes build/getOrBuildProductionBrain
  await test('TEST 6: flashcards route never builds brain on missing/building/partial/failed', async () => {
    const statuses = ['missing', 'building', 'partial', 'failed'] as const
    for (const status of statuses) {
      let buildCalls = 0
      let deckCalls = 0
      let lookupCalls = 0
      let ownershipChecks = 0

      fcDeps.getServerSession = async () => ({ user: { id: 'u1' } }) as any
      fcDeps.getMaterial = async () => { ownershipChecks++; return { id: 'mat_a' } as any }
      fcDeps.lookupMaterialBrain = async () => { lookupCalls++; return { status, brain: null } as any }
      fcDeps.lookupFlashcardDeck = async () => ({ status: 'missing', deck: null } as any)
      fcDeps.getOrBuildProductionBrain = async () => { buildCalls++; throw new Error('must not build') }
      fcDeps.getOrBuildFlashcardDeck = async () => { deckCalls++; throw new Error('must not build deck') }

      const req = new NextRequest('http://localhost/api/flashcards-v2', {
        method: 'POST',
        body: JSON.stringify({ materialIds: ['mat_a'], selectedPages: { mat_a: [1] } }),
        headers: { 'content-type': 'application/json' },
      })
      const res = await flashcardsRoute.POST(req)
      const data = await res.json()

      assert.equal(res.status, 202)
      assert.equal(data.status, status)
      assert.equal(ownershipChecks, 1)
      assert.equal(lookupCalls, 1)
      assert.equal(buildCalls, 0, 'getOrBuildProductionBrain must never be called')
      assert.equal(deckCalls, 0, 'getOrBuildFlashcardDeck must never be called when brain not ready')
    }
  })

  // 7. GET /api/material-brain never builds + ownership enforced
  await test('TEST 7: GET /api/material-brain never builds and enforces ownership', async () => {
    let buildCalls = 0
    let lookupCalls = 0
    let ownershipChecks = 0

    mbDeps.getServerSession = async () => ({ user: { id: 'u1' } }) as any
    mbDeps.getMaterial = async () => { ownershipChecks++; return { id: 'mat_a' } as any }
    mbDeps.lookupMaterialBrain = async () => { lookupCalls++; return { status: 'ready', brain: { meta: { builderVersion: '1.1.0' } } } as any }
    mbDeps.getOrBuildProductionBrain = async () => { buildCalls++; throw new Error('must not build') }

    const params = new URLSearchParams({
      materialIds: JSON.stringify(['mat_a']),
      selectedPages: JSON.stringify({ mat_a: [1] }),
    })

    const req = new NextRequest('http://localhost/api/material-brain?' + params.toString(), { method: 'GET' })
    const res = await materialBrainRoute.GET(req)
    const data = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.status, 'ready')
    assert.equal(ownershipChecks, 1)
    assert.equal(lookupCalls, 1)
    assert.equal(buildCalls, 0, 'GET must never call getOrBuildProductionBrain')
  })

  // 8. ownership deny → 422 and never reaches lookup
  await test('TEST 8: ownership failure short-circuits lookup in both routes', async () => {
    // material-brain GET
    let mbLookup = 0
    let mbBuild = 0
    mbDeps.getServerSession = async () => ({ user: { id: 'u1' } }) as any
    mbDeps.getMaterial = async () => null
    mbDeps.lookupMaterialBrain = async () => { mbLookup++; return { status: 'missing', brain: null } as any }
    mbDeps.getOrBuildProductionBrain = async () => { mbBuild++; throw new Error('must not build') }

    const params = new URLSearchParams({
      materialIds: JSON.stringify(['foreign_mat']),
      selectedPages: JSON.stringify({ foreign_mat: [1] }),
    })
    const getReq = new NextRequest('http://localhost/api/material-brain?' + params.toString(), { method: 'GET' })
    const getRes = await materialBrainRoute.GET(getReq)
    assert.equal(getRes.status, 422)
    assert.equal(mbLookup, 0)
    assert.equal(mbBuild, 0)

    // flashcards POST
    let fcLookup = 0
    let fcBuild = 0
    let fcDeck = 0
    fcDeps.getServerSession = async () => ({ user: { id: 'u1' } }) as any
    fcDeps.getMaterial = async () => null
    fcDeps.lookupMaterialBrain = async () => { fcLookup++; return { status: 'missing', brain: null } as any }
    fcDeps.lookupFlashcardDeck = async () => ({ status: 'missing', deck: null } as any)
    fcDeps.getOrBuildProductionBrain = async () => { fcBuild++; throw new Error('must not build') }
    fcDeps.getOrBuildFlashcardDeck = async () => { fcDeck++; throw new Error('must not build deck') }

    const postReq = new NextRequest('http://localhost/api/flashcards-v2', {
      method: 'POST',
      body: JSON.stringify({ materialIds: ['foreign_mat'], selectedPages: { foreign_mat: [1] } }),
      headers: { 'content-type': 'application/json' },
    })
    const postRes = await flashcardsRoute.POST(postReq)
    assert.equal(postRes.status, 422)
    assert.equal(fcLookup, 0)
    assert.equal(fcBuild, 0)
    assert.equal(fcDeck, 0)
  })

  // ════════════════════════════════════════════════════════════
  // Text extraction pending vs failed
  // ════════════════════════════════════════════════════════════

  await test('TEST P0: resolveSourceMaterialsForBrain distinguishes pending from real failure', async () => {
    const baseLoaders = {
      getMaterialText: async () => ({ material_id: 'mat_a', raw_text: '', created_at: '', updated_at: '' }),
      resolveStudyKind: () => 'pdf' as const,
    }

    await assert.rejects(
      async () => resolveSourceMaterialsForBrain('u1', ['mat_a'], {}, {
        ...baseLoaders,
        getMaterial: async () => ({ id: 'mat_a', text_status: 'pending' }) as Material,
      }),
      /MATERIAL_TEXT_PENDING:mat_a:pending/,
    )

    await assert.rejects(
      async () => resolveSourceMaterialsForBrain('u1', ['mat_a'], {}, {
        ...baseLoaders,
        getMaterial: async () => ({ id: 'mat_a', text_status: 'processing' }) as Material,
      }),
      /MATERIAL_TEXT_PENDING:mat_a:processing/,
    )

    await assert.rejects(
      async () => resolveSourceMaterialsForBrain('u1', ['mat_a'], {}, {
        ...baseLoaders,
        getMaterial: async () => ({ id: 'mat_a', text_status: 'error' }) as Material,
      }),
      /MATERIAL_TEXT_UNAVAILABLE:mat_a/,
    )

    await assert.rejects(
      async () => resolveSourceMaterialsForBrain('u1', ['mat_a'], {}, {
        ...baseLoaders,
        getMaterial: async () => ({ id: 'mat_a', text_status: 'ready' }) as Material,
      }),
      /MATERIAL_TEXT_UNAVAILABLE:mat_a/,
    )
  })

  await test('TEST P1: POST /api/material-brain returns extracting when text_status is pending', async () => {
    let extractionTriggers = 0
    mbDeps.getServerSession = async () => ({ user: { id: 'u1' } }) as any
    mbDeps.getMaterial = async () => ({ id: 'mat_a', text_status: 'pending' }) as any
    mbDeps.getMaterialText = async () => ({ material_id: 'mat_a', raw_text: '', created_at: '', updated_at: '' })
    mbDeps.ensureMaterialTextExtraction = async () => {
      extractionTriggers++
      return { status: 'processing' }
    }
    mbDeps.resolveStudyKind = () => 'pdf'
    mbDeps.lookupMaterialBrain = async () => ({ status: 'missing', brain: null } as any)
    mbDeps.getOrBuildProductionBrain = async () => { throw new Error('must not build') }

    const req = new NextRequest('http://localhost/api/material-brain', {
      method: 'POST',
      body: JSON.stringify({ materialIds: ['mat_a'], selectedPages: {} }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await materialBrainRoute.POST(req)
    const data = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.status, 'missing')
    assert.equal(data.textStatus, 'pending')
    assert.equal(extractionTriggers, 1, 'pending POST must trigger extraction ownership')
  })

  await test('TEST P2: POST /api/material-brain returns 422 when text extraction failed', async () => {
    mbDeps.getServerSession = async () => ({ user: { id: 'u1' } }) as any
    mbDeps.getMaterial = async () => ({ id: 'mat_a', text_status: 'error' }) as any
    mbDeps.getMaterialText = async () => ({ material_id: 'mat_a', raw_text: '', created_at: '', updated_at: '' })
    mbDeps.resolveStudyKind = () => 'pdf'
    mbDeps.lookupMaterialBrain = async () => ({ status: 'missing', brain: null } as any)
    mbDeps.getOrBuildProductionBrain = async () => { throw new Error('must not build') }

    const req = new NextRequest('http://localhost/api/material-brain', {
      method: 'POST',
      body: JSON.stringify({ materialIds: ['mat_a'], selectedPages: {} }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await materialBrainRoute.POST(req)
    const data = await res.json()

    assert.equal(res.status, 422)
    assert.match(data.error, /MATERIAL_TEXT_UNAVAILABLE:mat_a/)
  })

  await test('TEST P3: GET /api/material-brain returns aggregate textStatus', async () => {
    mbDeps.getServerSession = async () => ({ user: { id: 'u1' } }) as any
    mbDeps.getMaterial = async () => ({ id: 'mat_a', text_status: 'pending' }) as any
    mbDeps.lookupMaterialBrain = async () => ({ status: 'missing', brain: null } as any)
    mbDeps.getOrBuildProductionBrain = async () => { throw new Error('must not build') }

    const params = new URLSearchParams({
      materialIds: JSON.stringify(['mat_a']),
      selectedPages: JSON.stringify({}),
    })
    const req = new NextRequest('http://localhost/api/material-brain?' + params.toString(), { method: 'GET' })
    const res = await materialBrainRoute.GET(req)
    const data = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.status, 'missing')
    assert.equal(data.textStatus, 'pending')
  })

  await test('TEST P4: hook treats pending extraction as extracting, not failed', async () => {
    globalThis.fetch = (async (_input: any, init?: any) => {
      assert.equal(init?.method, 'POST')
      return new Response(JSON.stringify({ status: 'missing', textStatus: 'pending' }), { status: 200 })
    }) as any

    const selection = scopeFor(['mat_a'])

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selection)
      assert.equal(latest()?.status, 'extracting')
    })
  })

  await test('TEST P5: hook treats real 422 failure as failed', async () => {
    globalThis.fetch = (async (_input: any, init?: any) => {
      assert.equal(init?.method, 'POST')
      return new Response(JSON.stringify({ error: 'MATERIAL_TEXT_UNAVAILABLE:mat_a' }), { status: 422 })
    }) as any

    const selection = scopeFor(['mat_a'])

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selection)
      assert.equal(latest()?.status, 'failed')
    })
  })

  await test('TEST P6: extracting brain status renders extracting gate', async () => {
    const result = resolveMaterialPreparationGate('extracting', true)
    assert.equal(result.shouldGate, true)
    assert.equal(result.mode, 'extracting')
  })


  // ════════════════════════════════════════════════════════════
  // Material Preparation Gate — pure policy tests
  // ════════════════════════════════════════════════════════════
  await test('TEST A: idle + valid selection → gate preparing', async () => {
    const result = resolveMaterialPreparationGate('idle', true)
    assert.equal(result.shouldGate, true)
    assert.equal(result.mode, 'preparing')
  })

  await test('TEST B: building + valid selection → gate preparing', async () => {
    const result = resolveMaterialPreparationGate('building', true)
    assert.equal(result.shouldGate, true)
    assert.equal(result.mode, 'preparing')
  })

  await test('TEST C: ready + valid selection → no gate', async () => {
    const result = resolveMaterialPreparationGate('ready', true)
    assert.equal(result.shouldGate, false)
    assert.equal(result.mode, null)
  })

  await test('TEST D: partial + valid selection → recoverable gate', async () => {
    const result = resolveMaterialPreparationGate('partial', true)
    assert.equal(result.shouldGate, true)
    assert.equal(result.mode, 'partial')
  })

  await test('TEST E: failed + valid selection → recoverable gate', async () => {
    const result = resolveMaterialPreparationGate('failed', true)
    assert.equal(result.shouldGate, true)
    assert.equal(result.mode, 'failed')
  })

  await test('TEST F: deep-link flashcards preserves destination while gate opens/closes', async () => {
    const destination = 'flashcards'

    const gateWhileBuilding = resolveMaterialPreparationGate('building', true)
    assert.equal(destination, 'flashcards')
    assert.equal(gateWhileBuilding.shouldGate, true)
    assert.equal(gateWhileBuilding.mode, 'preparing')

    const gateWhenReady = resolveMaterialPreparationGate('ready', true)
    assert.equal(destination, 'flashcards')
    assert.equal(gateWhenReady.shouldGate, false)
    assert.equal(gateWhenReady.mode, null)
  })

  await test('TEST G: no valid source selection → no preparation loop', async () => {
    for (const status of ['idle', 'building', 'ready', 'partial', 'failed', undefined] as const) {
      const result = resolveMaterialPreparationGate(status, false)
      assert.equal(result.shouldGate, false, `status=${String(status)} without selection must not gate`)
      assert.equal(result.mode, null)
    }
  })

  await test('TEST H: MaterialPreparationScreen source contains zero fetch calls', async () => {
    const source = readFileSync('components/materias/MaterialPreparationScreen.tsx', 'utf8')
    const fetchCalls = (source.match(/\bfetch\s*\(/g) || []).length
    assert.equal(fetchCalls, 0, 'MaterialPreparationScreen must not contain fetch() calls')
  })


  await test('TEST I: TemaView only notifies parent source selection after openFree', async () => {
    const source = readFileSync('components/materias/TemaView.tsx', 'utf8')
    assert.match(
      source,
      /useEffect\(\(\) => \{\s*if \(!openFree\) return;[\s\S]*onSourceSelectionReady\?\.\(selectedDocs, adaptiveSelectedPages\);[\s\S]*\}, \[openFree, freeSourceSelection\?\.fingerprint\]\);/,
      'TemaView must guard PASO 4 with openFree before notifying the parent',
    )
  })

  await test('TEST J: TemaView primes source selection only when free mode is confirmed', async () => {
    const source = readFileSync('components/materias/TemaView.tsx', 'utf8')
    assert.match(
      source,
      /if \(studyMode === 'free'\) \{[\s\S]*onSourceSelectionReady\?\.\([\s\S]*Object\.keys\(pagesByMat\)\.length \? pagesByMat : \{\}[\s\S]*\);[\s\S]*\}/,
      'SeleccionPaginas confirm must prime source selection only for confirmed free mode',
    )
  })

  await test('AUTO-PREP-4/11 + progress UI: no manual Continue in retryable flow', async () => {
    const screenSource = readFileSync('components/materias/MaterialPreparationScreen.tsx', 'utf8')
    assert.ok(!screenSource.includes('Continuar preparación'))
    assert.ok(screenSource.includes('Estamos completando las últimas partes.'))
    assert.ok(screenSource.includes('secciones listas'))
    assert.ok(screenSource.includes('Agotamos las opciones seguras de recuperación automática'))
    const temaSource = readFileSync('components/materias/TemaView.tsx', 'utf8')
    assert.match(temaSource, /freePreparationGate\.shouldGate[\s\S]*MaterialPreparationScreen[\s\S]*StudyALProcess/)
  })

  // restore originals
  globalThis.fetch = originalFetch
  // Best effort restore deps references not needed after process exit

  console.log('\n' + '─'.repeat(60))
  console.log('Lifecycle tests: ' + (passed + failed) + ' total | ✅ ' + passed + ' passed | ❌ ' + failed + ' failed')
  if (failed > 0) {
    console.log('\n❌ Lifecycle contracts fallaron.')
    process.exit(1)
  } else {
    console.log('\n✅ Todos los lifecycle contracts pasaron.')
  }
}

main().catch(err => {
  console.error('❌ Error:', err)
  process.exit(1)
})
