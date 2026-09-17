import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-cheat-codes/route'
import { WorkerTruquitosStore, type ProseProvider } from '../../lib/truquitos/artifact'
import { payload, selection, validProse } from './truquitos-simple-architecture-contracts'

// ============================================================
// TRUQUITOS_503 contracts.
//
// A real live CLUTCH 2.pdf request returned:
//   POST /api/alai-studyal-cheat-codes 503 in 6077ms
// with NO provider call anywhere in the logs, and the UI kept
// silently showing the old schema-v1 artifact (0/13/0, "*****Kp*****",
// U+000C+"rac") with only a toast, no error.
//
// Root cause traced through the ACTUAL persistence boundary
// (WorkerTruquitosStore -> Cloudflare Worker /material-results/*):
// STUDYAL_API_URL (.env.local) points at the REMOTE deployed dev
// Worker (studyal-api-dev...workers.dev). The new
// `/material-results/truquitos-cas` route
// (cloudflare/studyal-api/src/index.ts) exists only in this LOCAL,
// uncommitted working tree — it has never been deployed. So the
// live request's flow was:
//   1. GET /material-results/by-material?resultType=truquitos_artifact
//      -> succeeds (this route already existed pre-migration) -> no
//      existing artifact -> WorkerTruquitosStore.compareAndSet(null,
//      initial) is attempted to reserve the first record.
//   2. POST /material-results/truquitos-cas on the REMOTE (undeployed)
//      Worker -> 404 "Not Found" -> `!response.ok` ->
//      WorkerTruquitosStore throws TRUQUITOS_PERSISTENCE_FAILED.
//   3. This happens BEFORE restoreOrGenerateTruquitos ever reaches the
//      provider call -> zero provider calls, exactly as observed.
//   4. handleGroundedTruquitosRequest's catch maps any non-
//      TRUQUITOS_GENERATING error to HTTP 503 -> exactly the observed
//      response.
//
// This file reproduces that exact failure OFFLINE (no real network,
// no live provider) by exercising the real WorkerTruquitosStore class
// against a stubbed `fetch` shaped exactly like "route not deployed
// yet", through the real POST() handler — proving the mechanism, not
// just asserting a hypothesis.
// ============================================================

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

const clientSource = fs.readFileSync('components/materias/ALAIStudyALCheatCodes.tsx', 'utf8')

async function main() {
  console.log('\n── TRUQUITOS_503 contracts ──\n')

  await test('1. reproduces the exact live 503: WorkerTruquitosStore against an undeployed truquitos-cas route (404) fails BEFORE any provider call, and the route surfaces it as 503', async () => {
    const originalFetch = globalThis.fetch
    const originalEnv = process.env.STUDYAL_API_URL
    const originalDeps = { ...__routeDeps }
    let providerCalls = 0
    try {
      process.env.STUDYAL_API_URL = 'https://studyal-api-dev.example.workers.dev'
      let sawByMaterial = false, sawCas = false
      globalThis.fetch = (async (input: any, init?: any) => {
        const url = String(input)
        if (url.includes('/material-results/by-material')) {
          sawByMaterial = true
          return new Response(JSON.stringify({ ok: true, result: null }), { status: 200 })
        }
        if (url.includes('/material-results/truquitos-cas')) {
          sawCas = true
          // The exact remote-deployment-gap shape: the route does not
          // exist yet on the deployed Worker.
          return new Response('Not Found', { status: 404 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }) as typeof fetch

      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'test-owner' } }),
        getAuthoritativeFreeSession: async () => ({ sourceSelection: selection }),
        getMaterial: async () => ({ id: 'material' }),
        lookupStudyalMaterialEnjoyer: async () => payload,
        truquitosStore: new WorkerTruquitosStore(),
        alai: async (p: Parameters<ProseProvider>[0]) => { providerCalls++; return validProse(p) },
      })

      const res = await POST(new NextRequest('http://localhost/api/alai-studyal-cheat-codes', {
        method: 'POST', body: JSON.stringify({ sessionId: 'live-clutch2' }),
      }))
      const body = await res.json()

      assert.equal(res.status, 503, `must reproduce the exact observed 503, got ${res.status}: ${JSON.stringify(body)}`)
      assert.equal(providerCalls, 0, 'must fail before ever reaching the provider — the exact "no provider call in logs" symptom')
      assert.ok(sawByMaterial, 'the read-first step must have been attempted')
      assert.ok(sawCas, 'the CAS reservation step must have been attempted and must be what actually failed')
    } finally {
      globalThis.fetch = originalFetch
      if (originalEnv === undefined) delete process.env.STUDYAL_API_URL; else process.env.STUDYAL_API_URL = originalEnv
      Object.assign(__routeDeps, originalDeps)
    }
  })

  await test('2. control: once the SAME persistence boundary succeeds (CAS route behaves as deployed), the request reaches the provider boundary and returns a ready schema-v2 artifact — proves the fix is deployment, not code', async () => {
    const originalFetch = globalThis.fetch
    const originalEnv = process.env.STUDYAL_API_URL
    const originalDeps = { ...__routeDeps }
    let providerCalls = 0
    try {
      process.env.STUDYAL_API_URL = 'https://studyal-api-dev.example.workers.dev'
      // Minimal in-memory stand-in for the D1-backed route, matching
      // the REAL route's request/response contract exactly (see
      // cloudflare/studyal-api/src/index.ts truquitos-cas handler).
      const rows = new Map<string, { payload: unknown; content_hash: string }>()
      globalThis.fetch = (async (input: any, init?: any) => {
        const url = String(input)
        if (url.includes('/material-results/by-material')) {
          const id = new URL(url).searchParams.get('materialId') || ''
          const row = rows.get(id)
          return new Response(JSON.stringify({ ok: true, result: row ? { payload: row.payload, content_hash: row.content_hash } : null }), { status: 200 })
        }
        if (url.includes('/material-results/truquitos-cas')) {
          const body = JSON.parse(String(init?.body || '{}'))
          const existing = rows.get(body.id)
          if (body.expectedRevision === null) {
            if (existing) return new Response(JSON.stringify({ ok: true, applied: false }), { status: 200 })
            rows.set(body.id, { payload: body.payload, content_hash: body.revision })
            return new Response(JSON.stringify({ ok: true, applied: true }), { status: 200 })
          }
          if (existing && existing.content_hash === body.expectedRevision) {
            rows.set(body.id, { payload: body.payload, content_hash: body.revision })
            return new Response(JSON.stringify({ ok: true, applied: true }), { status: 200 })
          }
          return new Response(JSON.stringify({ ok: true, applied: false }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }) as typeof fetch

      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'test-owner' } }),
        getAuthoritativeFreeSession: async () => ({ sourceSelection: selection }),
        getMaterial: async () => ({ id: 'material' }),
        lookupStudyalMaterialEnjoyer: async () => payload,
        truquitosStore: new WorkerTruquitosStore(),
        alai: async (p: Parameters<ProseProvider>[0]) => { providerCalls++; return validProse(p) },
      })

      const res = await POST(new NextRequest('http://localhost/api/alai-studyal-cheat-codes', {
        method: 'POST', body: JSON.stringify({ sessionId: 'live-clutch2-ok' }),
      }))
      const body = await res.json()

      assert.equal(res.status, 200, `expected a ready artifact once persistence works, got ${res.status}: ${JSON.stringify(body)}`)
      assert.equal(providerCalls, 1, 'exactly one provider call once the persistence boundary is healthy')
      assert.equal(body.success, true)
      assert.equal(body.meta.status, 'ready')
      assert.ok(body.cards.every((c: any) => c.schemaVersion === 2))

      // Reopen: 0 additional provider calls, same persisted artifact.
      const reopened = await POST(new NextRequest('http://localhost/api/alai-studyal-cheat-codes', {
        method: 'POST', body: JSON.stringify({ sessionId: 'live-clutch2-ok' }),
      }))
      assert.equal(reopened.status, 200)
      assert.equal(providerCalls, 1, 'reopen must add zero provider calls')
    } finally {
      globalThis.fetch = originalFetch
      if (originalEnv === undefined) delete process.env.STUDYAL_API_URL; else process.env.STUDYAL_API_URL = originalEnv
      Object.assign(__routeDeps, originalDeps)
    }
  })

  await test('3. UI fix: a failed regeneration only silently retains the current display when the retained cards are current-schema (v2) — legacy/corrupted retained cards surface the error instead of masquerading as fresh', () => {
    assert.match(clientSource, /retainedIsCurrentSchema/, 'the schema-aware retention guard must exist')
    assert.match(clientSource, /retained\.every\(\(c: any\) => c\?\.schemaVersion === 2\)/)
    assert.doesNotMatch(clientSource, /if \(\(persistedStateRef\.current\.cards \|\| \[\]\)\.length > 0\)/, 'the old unconditional (schema-blind) stale-retention condition must be gone')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('truquitos-worker-persistence-503-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
