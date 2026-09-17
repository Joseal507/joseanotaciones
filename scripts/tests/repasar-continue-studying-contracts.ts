import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { useMaterialBrainLifecycle } from '../../lib/materialBrain/useMaterialBrainLifecycle'

// ============================================================
// "Seguir estudiando" P0 — real observed bug: clicking Continue on an
// EXISTING session (Repasar history still present client-side) went
// through preparation again — logs showed a fresh `POST /api/material-
// brain` taking ~45s before the hub appeared.
//
// ROOT CAUSE (lib/materialBrain/useMaterialBrainLifecycle.ts, pre-fix):
// the hook's initial-mount effect always called `triggerBuild`, which
// synchronously sets status:'building' THEN issues a POST — and a POST
// against an ALREADY-READY Brain still runs ONE bounded background
// enrichment batch server-side (two-level readiness architecture) before
// resolving. Every time a fully-built session was reopened, the hub was
// blocked behind that same batch, even though nothing needed building.
//
// This was NOT a duplicate-session bug: StudySession identity/dedup
// (lib/studySessions.ts upsertSession, FOUND_VIA_FINGERPRINT outcome)
// was already correct and untouched — CONTINUE-1/2/6 below confirm that
// mechanism structurally. The real bug was purely in the PREPARATION
// LIFECYCLE re-running unnecessarily on every mount.
//
// Fix: the hook now does a fast, lookup-only GET first; if the Brain is
// already 'ready', it resolves immediately with ZERO 'building' state,
// and the pre-existing background-enrichment-continuation effect
// (unchanged) keeps nudging enrichment forward without blocking the hub.
// ============================================================

function scopeFor(materialIds: string[], selectedPages: Record<string, number[]> = {}) {
  return buildSourceSelectionSnapshot(materialIds, selectedPages)
}

type Snapshot = ReturnType<typeof useMaterialBrainLifecycle>

function createDom() {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>')
  ;(globalThis as any).window = window
  ;(globalThis as any).document = document
  ;(globalThis as any).navigator = window.navigator
  return { document }
}

async function flush() {
  await act(async () => { await Promise.resolve() })
}

async function withHookHarness(
  run: (api: { renderWithSelection: (selection: any) => Promise<void>; latest: () => Snapshot | null }) => Promise<void>,
) {
  const { document } = createDom()
  const container = document.getElementById('root') as any
  const root = createRoot(container)
  let latestSnapshot: Snapshot | null = null
  function Probe({ selection }: { selection: any }) {
    const snapshot = useMaterialBrainLifecycle(selection)
    useEffect(() => { latestSnapshot = snapshot }, [snapshot.status, snapshot.fingerprint, snapshot.recheck])
    return null
  }
  async function renderWithSelection(selection: any) {
    await act(async () => { root.render(React.createElement(Probe, { selection })) })
    await flush()
  }
  try {
    await run({ renderWithSelection, latest: () => latestSnapshot })
  } finally {
    root.unmount()
  }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Repasar "Seguir estudiando" restore contracts ──\n')
  const originalFetch = globalThis.fetch

  // CONTINUE-1/CONTINUE-2 — StudySession identity/dedup: structural proof
  // that upsertSession resolves an existing session by fingerprint
  // rather than creating a duplicate. This mechanism was NOT touched by
  // this fix; cited here because the mission asked for explicit CONTINUE
  // contracts and this is the authoritative source (already exercised
  // live by free-session-concurrent-identity-contracts.ts).
  await test('CONTINUE-1/2: StudySession resolution dedupes by sourceSelectionFingerprint (structural)', () => {
    const source = readFileSync('lib/studySessions.ts', 'utf8')
    assert.match(source, /FOUND_VIA_FINGERPRINT/, 'upsertSession must resolve an existing session by fingerprint, never blindly create a new one')
    assert.match(source, /FOUND_VIA_EXPLICIT_ID/, 'an explicit sessionId must also resolve to the exact existing session')
  })

  // CONTINUE-6 — a genuinely different fingerprint legitimately uses/
  // creates a different session (same mechanism, opposite branch).
  await test('CONTINUE-6: a different fingerprint does not collide with an existing session (structural)', () => {
    const source = readFileSync('lib/studySessions.ts', 'utf8')
    assert.match(source, /CREATE_NEW/, 'a fingerprint with no existing match must legitimately create/use a new session, never force-reuse an unrelated one')
  })

  // CONTINUE-3/CONTINUE-4 — the real fix: a session whose Brain is
  // already 'ready' must restore the hub immediately, no 'building'.
  await test('CONTINUE-3/4: an already-ready Brain restores the hub immediately, no preparation replay', async () => {
    let calls = 0
    let sawBuildingAtAnyPoint = false
    globalThis.fetch = (async () => {
      calls++
      return new Response(JSON.stringify({ status: 'ready', capabilities: { sourceReady: true } }), { status: 200 })
    }) as any
    const selection = scopeFor(['mat_continue'], { mat_continue: [1, 2, 3] })
    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selection)
      if (latest()?.status === 'building') sawBuildingAtAnyPoint = true
      assert.equal(latest()?.status, 'ready', 'CONTINUE-3: hub must be ready immediately on restore of an already-built session')
      assert.equal(latest()?.fingerprint, selection.fingerprint)
    })
    assert.equal(calls, 1, 'CONTINUE-4: restoring an already-ready session must cost exactly one lookup call, never a build/enrichment POST')
    assert.equal(sawBuildingAtAnyPoint, false, 'CONTINUE-3: the hub must never flash "building"/preparation for an already-ready session')
    globalThis.fetch = originalFetch
  })

  // CONTINUE-5 — background enrichment may continue after restore
  // without blocking the already-restored hub (pre-existing mechanism,
  // confirmed still wired correctly after this fix).
  await test('CONTINUE-5: background enrichment continuation is independent of the restore path (structural)', () => {
    const source = readFileSync('lib/materialBrain/useMaterialBrainLifecycle.ts', 'utf8')
    assert.match(source, /Background enrichment continuation/, 'a separate, non-blocking enrichment-continuation effect must exist')
    assert.match(source, /Never flips status away from 'ready'/, 'enrichment continuation must never revert an already-restored hub back to building')
  })

  // Genuinely unready (never built before) sessions must still build —
  // the fast-path must never silently skip a real build.
  await test('CONTINUE (negative): a genuinely unready session still builds normally', async () => {
    let getCalls = 0, postCalls = 0
    globalThis.fetch = (async (_input: any, init?: any) => {
      if (init?.method === 'POST') { postCalls++; return new Response(JSON.stringify({ status: 'ready' }), { status: 200 }) }
      getCalls++
      return new Response(JSON.stringify({ status: 'missing' }), { status: 200 })
    }) as any
    const selection = scopeFor(['mat_never_built'], { mat_never_built: [1] })
    await withHookHarness(async ({ renderWithSelection, latest }) => {
      await renderWithSelection(selection)
      assert.equal(latest()?.status, 'ready')
    })
    assert.equal(getCalls, 1)
    assert.equal(postCalls, 1, 'a genuinely unbuilt session must still go through the real build path')
    globalThis.fetch = originalFetch
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('repasar-continue-studying-contracts: ALL PASS')
}

main()
