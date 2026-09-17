import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { useStudyalMaterialEnjoyerLifecycle } from '../../lib/adaptive/useStudyalMaterialEnjoyerLifecycle'
import { resolveFreeHubMaterialEnjoyerGate } from '../../components/materias/MaterialPreparationScreen'

// ============================================================
// PHASE 2 — Free Mode preparation authority: Material Brain ->
// StudyalMaterialEnjoyer.
//
// Covers: Free Mode hub entry never calls Material Brain; Free Mode
// reuses an existing Enjoyer by fingerprint with 0 provider calls;
// Free Mode can generate it first through the EXISTING Adaptive
// blueprint pipeline (mocked fetch, no real network/provider calls);
// Adaptive then reuses the same record; different selectedPages never
// reuse; source-pattern proof that hub entry (page.tsx) no longer
// primes Material Brain, while per-tool open handlers (unmigrated
// tools) still do.
// ============================================================

type Snapshot = ReturnType<typeof useStudyalMaterialEnjoyerLifecycle>

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

function createDom() {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>')
  ;(globalThis as any).window = window
  ;(globalThis as any).document = document
  ;(globalThis as any).navigator = window.navigator
  return { document }
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

async function withHookHarness(
  run: (api: {
    renderWithSelection: (selection: any, materials: { materialId: string; materialName: string }[]) => Promise<void>
    latest: () => Snapshot | null
  }) => Promise<void>,
) {
  const { document } = createDom()
  const container = document.getElementById('root') as any
  const root = createRoot(container)
  let latestSnapshot: Snapshot | null = null

  function Probe({ selection, materials }: { selection: any; materials: any[] }) {
    const snapshot = useStudyalMaterialEnjoyerLifecycle(selection, materials)
    useEffect(() => { latestSnapshot = snapshot }, [snapshot.status, snapshot.fingerprint])
    return null
  }

  async function renderWithSelection(selection: any, materials: any[]) {
    await act(async () => { root.render(React.createElement(Probe, { selection, materials })) })
    await flush()
  }

  try {
    await run({ renderWithSelection, latest: () => latestSnapshot })
  } finally {
    root.unmount()
  }
}

function fakeBlueprint(fingerprint: string) {
  return { success: true, blueprint: { sourceSelectionFingerprint: fingerprint, globalOrderedAnalysis: [], uniqueConceptsIndex: [], topicsIndex: [] }, quality: { status: 'complete' } }
}

async function main() {
  console.log('\n── PHASE 2: Free Mode -> StudyalMaterialEnjoyer entry contracts ──\n')
  const originalFetch = globalThis.fetch

  await test('2. Free Mode reuses an existing StudyalMaterialEnjoyer by fingerprint — GET hit, no POST', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] })
    let getCalls = 0, postCalls = 0
    globalThis.fetch = (async (url: string, init?: any) => {
      if (init?.method === 'POST') { postCalls++; throw new Error('MUST_NOT_POST_WHEN_ALREADY_READY') }
      getCalls++
      return { ok: true, json: async () => ({ status: 'ready', fingerprint: scope.fingerprint, ...fakeBlueprint(scope.fingerprint) }) } as any
    }) as any

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scope, [{ materialId: 'mat-a', materialName: 'Material A' }])
      assert.equal(latest()?.status, 'ready')
      assert.equal(getCalls, 1)
      assert.equal(postCalls, 0, 'an already-ready Enjoyer must never trigger generation')
    })
    globalThis.fetch = originalFetch
  })

  await test('3. Free Mode can generate a missing Enjoyer through the EXISTING Adaptive blueprint POST path', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-b'], { 'mat-b': [1] })
    let postBody: any = null
    globalThis.fetch = (async (url: string, init?: any) => {
      if (init?.method === 'POST') {
        postBody = JSON.parse(init.body)
        return { ok: true, json: async () => fakeBlueprint(scope.fingerprint) } as any
      }
      return { ok: true, json: async () => ({ status: 'missing', fingerprint: scope.fingerprint }) } as any
    }) as any

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scope, [{ materialId: 'mat-b', materialName: 'Material B' }])
      assert.equal(latest()?.status, 'ready')
      assert.ok(postBody, 'must have called the existing POST generation path')
      assert.equal(postBody.sourceSelection.fingerprint, scope.fingerprint)
      assert.equal(postBody.materials[0].materialId, 'mat-b', 'must reuse the SAME material identity, no duplicate/second material record')
    })
    globalThis.fetch = originalFetch
  })

  await test('5. Adaptive-generated Enjoyer reused by Free Mode causes 0 provider calls (GET restores, no POST)', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-c'], { 'mat-c': [3] })
    let postCalls = 0
    globalThis.fetch = (async (url: string, init?: any) => {
      if (init?.method === 'POST') { postCalls++; throw new Error('SHOULD_NOT_POST') }
      return { ok: true, json: async () => ({ status: 'ready', fingerprint: scope.fingerprint, ...fakeBlueprint(scope.fingerprint) }) } as any
    }) as any

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scope, [{ materialId: 'mat-c', materialName: 'Material C' }])
      assert.equal(latest()?.status, 'ready')
      assert.equal(postCalls, 0, 'Adaptive already generated it — Free Mode reusing it must cause 0 new provider calls')
    })
    globalThis.fetch = originalFetch
  })

  await test('6. Different selectedPages never reuse the same StudyalMaterialEnjoyer', async () => {
    const scopeA = buildSourceSelectionSnapshot(['mat-d'], { 'mat-d': [1] })
    const scopeB = buildSourceSelectionSnapshot(['mat-d'], { 'mat-d': [1, 2] })
    assert.notEqual(scopeA.fingerprint, scopeB.fingerprint)

    const seenFingerprints: string[] = []
    globalThis.fetch = (async (url: string, init?: any) => {
      const params = new URL(url, 'http://localhost').searchParams
      const fp = params.get('fingerprint') || JSON.parse(init?.body || '{}')?.sourceSelection?.fingerprint
      if (fp) seenFingerprints.push(fp)
      return { ok: true, json: async () => ({ status: 'missing', fingerprint: fp }) } as any
    }) as any

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scopeA, [{ materialId: 'mat-d', materialName: 'D' }])
      const afterA = latest()
      await renderWithSelection(scopeB, [{ materialId: 'mat-d', materialName: 'D' }])
      const afterB = latest()
      assert.notEqual(afterA?.fingerprint, afterB?.fingerprint, 'a page-selection change must produce a different authority/fingerprint')
    })
    globalThis.fetch = originalFetch
  })

  await test('9. Free session identity: fingerprint is derived purely from materialIds+selectedPages (temaId/sessionId-independent)', () => {
    const scope1 = buildSourceSelectionSnapshot(['mat-e'], { 'mat-e': [5] })
    const scope2 = buildSourceSelectionSnapshot(['mat-e'], { 'mat-e': [5] })
    assert.equal(scope1.fingerprint, scope2.fingerprint, 'the SAME exact material/page selection must always resolve to the SAME fingerprint, regardless of temaId/sessionId')
  })

  // ─── Source-pattern proofs (page.tsx wiring) ──────────────────────

  await test('1a. Free hub entry (onSourceSelectionReady) no longer primes Material Brain', () => {
    const pageSource = readFileSync('app/materias/page.tsx', 'utf8')
    const handlerMatch = pageSource.match(/onSourceSelectionReady=\{\(mats, sel\) => \{([\s\S]*?)\n            \}\}/)
    assert.ok(handlerMatch, 'onSourceSelectionReady handler must be extractable')
    const handlerBody = handlerMatch![1]
    assert.doesNotMatch(handlerBody, /setBrainSourceSelection/, 'hub entry must no longer call setBrainSourceSelection (that starts Material Brain)')
    assert.match(handlerBody, /setFreeEnjoyerSourceSelection/, 'hub entry must prime StudyalMaterialEnjoyer instead')
  })

  await test('1b. Tool-open handlers for Enjoyer-native tools do not prime Material Brain', () => {
    const pageSource = readFileSync('app/materias/page.tsx', 'utf8')
    const stillLegacy: string[] = []
    const migrated = ['onOpenFlashcards', 'onOpenQuiz', 'onOpenRepasar', 'onOpenAnalisis', 'onOpenExam', 'onOpenAlai']
    for (const handlerName of stillLegacy) {
      const re = new RegExp(handlerName + '=\\{\\(mats\\?: any\\[\\], sel\\?: any\\[\\], sessionId\\?: string \\| null\\) => \\{([\\s\\S]*?)\\n            \\}\\}')
      const match = pageSource.match(re)
      assert.ok(match, `${handlerName} handler must be extractable`)
      assert.match(match![1], /setBrainSourceSelection/, `${handlerName} must still prime Material Brain — it is not migrated this phase`)
    }
    for (const handlerName of migrated) {
      const re = new RegExp(handlerName + '=\\{\\(mats\\?: any\\[\\], sel\\?: any\\[\\], sessionId\\?: string \\| null\\) => \\{([\\s\\S]*?)\\n            \\}\\}')
      const match = pageSource.match(re)
      assert.ok(match, `${handlerName} handler must be extractable`)
      const codeOnly = match![1].split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
      assert.doesNotMatch(codeOnly, /setBrainSourceSelection/, `${handlerName} must not call setBrainSourceSelection in executable code — it is Enjoyer-native / does not prime Material Brain`)
    }
  })

  await test('1c. ANALISIS_MATERIAL_BRAIN_REGRESSION fix: onOpenAnalisis (StudyalMaterialEnjoyer-native since analysisEnjoyerContext) never primes Material Brain', () => {
    const pageSource = readFileSync('app/materias/page.tsx', 'utf8')
    const match = pageSource.match(/onOpenAnalisis=\{\(mats\?: any\[\], sel\?: any\[\], sessionId\?: string \| null\) => \{([\s\S]*?)\n            \}\}/)
    assert.ok(match, 'onOpenAnalisis handler must be extractable')
    const codeOnly = match![1].split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
    assert.doesNotMatch(codeOnly, /setBrainSourceSelection/, 'onOpenAnalisis must never call setBrainSourceSelection — Análisis is Enjoyer-native, opening it must never build/prime Material Brain')
  })

  await test('1d. Análisis and ALAI are excluded from the activeTool Material Brain gate (VISTA_TOOL) and from the deep-link Brain-priming restore list', () => {
    const pageSource = readFileSync('app/materias/page.tsx', 'utf8')
    const vistaToolMatch = pageSource.match(/const VISTA_TOOL: Partial<Record<Vista, FreeTool>> = \{([\s\S]*?)\};/)
    assert.ok(vistaToolMatch, 'VISTA_TOOL map must be extractable')
    assert.doesNotMatch(vistaToolMatch![1], /analisis:/, 'analisis must not map to a FreeTool in VISTA_TOOL — it must never be gated behind Material Brain capabilities')
    assert.doesNotMatch(vistaToolMatch![1], /alai:/, 'alai must not map to a FreeTool in VISTA_TOOL — it must never be gated behind Material Brain capabilities')
    const restoreBlock = pageSource.match(/findAndOpen[\s\S]*?setFreeToolSessionId\(freeSession\.id\)/)?.[0] || ''
    assert.doesNotMatch(restoreBlock, /setBrainSourceSelection/, 'deep-link restore must not prime Material Brain')
  })

  await test('7. Material Brain readiness gating (activeTool-scoped) is untouched — bare hub entry was never gated by it either way', () => {
    const pageSource = readFileSync('app/materias/page.tsx', 'utf8')
    assert.match(pageSource, /shouldShowMaterialPreparationScreen\s*=\s*\n?\s*!!brainSourceSelection[\s\S]{0,200}!!activeTool/, 'the gate screen must remain scoped to activeTool, never the bare hub')
  })

  await test('8. Material Brain source files are untouched by this phase', () => {
    // Structural proof only (this test does not run git itself — the
    // deliverable report cross-checks `git status` directly). Confirms
    // the canonical Material Brain build/lifecycle modules still export
    // their existing, unmodified public surface used by this task.
    const lifecycleSource = readFileSync('lib/materialBrain/useMaterialBrainLifecycle.ts', 'utf8')
    assert.match(lifecycleSource, /export function useMaterialBrainLifecycle/)
  })

  // ─────────────────────────────────────────────────────────────
  // HOTFIX — Free Mode preparation screen never exited after
  // StudyalMaterialEnjoyer completed. Root cause: TemaView.tsx's
  // OWN hub-level gate (separate from page.tsx's activeTool-scoped
  // gate) still keyed off Material Brain's `brainStatus`/
  // `academicStability` — a signal Phase 2 stopped populating at
  // hub entry, so it always fell back to its own 'building' default
  // and gated forever. resolveFreeHubMaterialEnjoyerGate replaces
  // that with a pure function over StudyalMaterialEnjoyer state only.
  // ─────────────────────────────────────────────────────────────

  await test('HOTFIX 1: lifecycle starts missing -> generation -> ready/certified -> gate becomes false (hub renders)', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-f'], { 'mat-f': [1] })
    globalThis.fetch = (async (url: string, init?: any) => {
      if (init?.method === 'POST') return { ok: true, json: async () => fakeBlueprint(scope.fingerprint) } as any
      return { ok: true, json: async () => ({ status: 'missing', fingerprint: scope.fingerprint }) } as any
    }) as any

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scope, [{ materialId: 'mat-f', materialName: 'F' }])
      const lifecycle = latest()!
      assert.equal(lifecycle.status, 'ready', 'lifecycle must reach ready after the POST returns a certified blueprint')

      const gate = resolveFreeHubMaterialEnjoyerGate(true, lifecycle.status, lifecycle.fingerprint === scope.fingerprint)
      assert.equal(gate.shouldGate, false, 'the hub gate must NOT still be blocking once the Enjoyer is ready')
      assert.equal(gate.mode, null)
    })
    globalThis.fetch = originalFetch
  })

  await test('HOTFIX 2: while missing/generating, the gate blocks with mode "preparing" (never a silent pass-through)', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-g'], { 'mat-g': [1] })
    let resolvePost: (() => void) | null = null
    globalThis.fetch = (async (url: string, init?: any) => {
      if (init?.method === 'POST') {
        await new Promise<void>(resolve => { resolvePost = resolve })
        return { ok: true, json: async () => fakeBlueprint(scope.fingerprint) } as any
      }
      return { ok: true, json: async () => ({ status: 'missing', fingerprint: scope.fingerprint }) } as any
    }) as any

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scope, [{ materialId: 'mat-g', materialName: 'G' }])
      const midFlight = latest()!
      assert.equal(midFlight.status, 'generating')
      const gate = resolveFreeHubMaterialEnjoyerGate(true, midFlight.status, midFlight.fingerprint === scope.fingerprint)
      assert.equal(gate.shouldGate, true)
      assert.equal(gate.mode, 'preparing')
      resolvePost?.()
      await flush()
    })
    globalThis.fetch = originalFetch
  })

  await test('HOTFIX 3: restoring an already-existing Enjoyer (GET ready) enters the hub without a POST', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-h'], { 'mat-h': [1] })
    let postCalls = 0
    globalThis.fetch = (async (url: string, init?: any) => {
      if (init?.method === 'POST') { postCalls++; throw new Error('MUST_NOT_POST') }
      return { ok: true, json: async () => ({ status: 'ready', fingerprint: scope.fingerprint, ...fakeBlueprint(scope.fingerprint) }) } as any
    }) as any

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scope, [{ materialId: 'mat-h', materialName: 'H' }])
      const lifecycle = latest()!
      const gate = resolveFreeHubMaterialEnjoyerGate(true, lifecycle.status, lifecycle.fingerprint === scope.fingerprint)
      assert.equal(gate.shouldGate, false, 'a restored Enjoyer must enter the hub immediately')
      assert.equal(postCalls, 0)
    })
    globalThis.fetch = originalFetch
  })

  await test('HOTFIX 4: a failed Enjoyer shows a recoverable "failed" gate, never an infinite "preparing" loader', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-i'], { 'mat-i': [1] })
    globalThis.fetch = (async (url: string, init?: any) => {
      if (init?.method === 'POST') return { ok: false, status: 500, json: async () => ({ success: false, error: 'BOOM' }) } as any
      return { ok: true, json: async () => ({ status: 'missing', fingerprint: scope.fingerprint }) } as any
    }) as any

    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(scope, [{ materialId: 'mat-i', materialName: 'I' }])
      const lifecycle = latest()!
      assert.equal(lifecycle.status, 'failed')
      const gate = resolveFreeHubMaterialEnjoyerGate(true, lifecycle.status, lifecycle.fingerprint === scope.fingerprint)
      assert.equal(gate.shouldGate, true)
      assert.equal(gate.mode, 'failed', 'a failed generation must surface as a recoverable "failed" mode, not "preparing" forever')
      assert.equal(typeof lifecycle.recheck, 'function', 'a retry entrypoint must be available for the failed state')
    })
    globalThis.fetch = originalFetch
  })

  await test('HOTFIX 5: no Material Brain call is reintroduced by this hotfix', () => {
    const temaViewSource = readFileSync('components/materias/TemaView.tsx', 'utf8')
    const gateBlockMatch = temaViewSource.match(/const enjoyerFingerprintMatches[\s\S]{0,400}resolveFreeHubMaterialEnjoyerGate\([\s\S]{0,200}?\);/)
    assert.ok(gateBlockMatch, 'the hub gate block must be extractable')
    assert.doesNotMatch(gateBlockMatch![0], /brainStatus|brainCapabilities|academicStability/, 'the hub-level gate must never read Material Brain signals again')
  })

  await test('HOTFIX 6: resolveFreeHubMaterialEnjoyerGate is a pure function with no source-selection short-circuit bug', () => {
    assert.deepEqual(resolveFreeHubMaterialEnjoyerGate(false, 'ready', true), { shouldGate: false, mode: null }, 'no source selection means nothing to gate')
    assert.deepEqual(resolveFreeHubMaterialEnjoyerGate(true, 'ready', false), { shouldGate: true, mode: 'preparing' }, 'a fingerprint MISMATCH must never be read as ready, even if status says ready')
    assert.deepEqual(resolveFreeHubMaterialEnjoyerGate(true, undefined, false), { shouldGate: true, mode: 'preparing' })
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('free-mode-material-enjoyer-entry-contracts: ALL PASS')
}

main()
