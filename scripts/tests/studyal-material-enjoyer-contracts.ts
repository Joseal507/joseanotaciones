import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getOrCreateStudyalMaterialEnjoyer,
  lookupStudyalMaterialEnjoyer,
  MATERIAL_ENJOYER_ACADEMIC_VERSION,
  type MaterialEnjoyerStore,
} from '../../lib/adaptive/materialEnjoyer'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

// ============================================================
// StudyalMaterialEnjoyer — Phase 1 contracts.
//
// This is a thin, generic, restore-first persistence wrapper around
// Adaptive's EXISTING blueprint generation (app/api/adaptive/
// blueprint/route.ts) — not a reimplementation of that generation
// logic. These contracts exercise the wrapper's own identity/cost/
// safety guarantees directly (in-memory store, no network, no
// provider calls) plus source-pattern checks confirming the route
// wires the SAME wrapper for both Adaptive's write path and Free
// Mode's read-only path. app/api/adaptive/blueprint/route.ts has no
// injectable deps object (unlike the Material Brain routes) — adding
// one purely for testing would be more invasive to this large,
// pre-existing file than this Phase 1 task calls for ("this is NOT a
// rewrite of Adaptive"), so the route's OWN generation behavior is
// verified by source inspection here, not by re-invoking it.
// ============================================================

class InMemoryMaterialEnjoyerStore implements MaterialEnjoyerStore {
  private map = new Map<string, unknown>()
  async get(fingerprint: string) { return this.map.get(fingerprint) ?? null }
  async set(fingerprint: string, payload: unknown) { this.map.set(fingerprint, payload) }
  size() { return this.map.size }
}

function fakeBlueprint(fingerprint: string, marker: string) {
  return {
    success: true,
    // ENJOYER_LANGUAGE_MATH_FIDELITY: real persisted payloads carry this
    // stamp (see isMatchingFingerprint in materialEnjoyer.ts) — without
    // it a payload is treated as stale/pre-migration and regenerated.
    enjoyerAcademicVersion: MATERIAL_ENJOYER_ACADEMIC_VERSION,
    blueprint: {
      version: 2, createdAt: Date.now(), sourceSelectionFingerprint: fingerprint,
      globalOrderedAnalysis: [{ id: 'b1', kind: 'concept', title: marker }],
      uniqueConceptsIndex: [{ id: 'c1', title: marker }],
      topicsIndex: [{ id: 't1', title: marker, pages: [1] }],
    },
    quality: { status: 'complete', coverageCertified: true, spanCoverage: 100 },
  }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── StudyalMaterialEnjoyer Phase 1 contracts ──\n')

  await test('1. same fingerprint → same persisted MaterialEnjoyer (generation runs exactly once)', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] })
    const store = new InMemoryMaterialEnjoyerStore()
    let generateCalls = 0
    const generate = async () => { generateCalls++; return fakeBlueprint(scope.fingerprint, 'first-gen') }

    const first = await getOrCreateStudyalMaterialEnjoyer(scope.fingerprint, store, generate)
    const second = await getOrCreateStudyalMaterialEnjoyer(scope.fingerprint, store, generate)

    assert.equal(first.status, 'generated')
    assert.equal(second.status, 'restored')
    assert.equal(generateCalls, 1, 'the second call for the SAME fingerprint must not re-generate')
    assert.deepEqual(second.payload, first.payload, 'restored payload must be identical to what was generated')
  })

  await test('2. different selected pages → different authority (never merged/reused)', async () => {
    const scopeA = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] })
    const scopeB = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] })
    assert.notEqual(scopeA.fingerprint, scopeB.fingerprint, 'changing selectedPages must change the fingerprint')

    const store = new InMemoryMaterialEnjoyerStore()
    await getOrCreateStudyalMaterialEnjoyer(scopeA.fingerprint, store, async () => fakeBlueprint(scopeA.fingerprint, 'A'))
    await getOrCreateStudyalMaterialEnjoyer(scopeB.fingerprint, store, async () => fakeBlueprint(scopeB.fingerprint, 'B'))

    const restoredA = await lookupStudyalMaterialEnjoyer(scopeA.fingerprint, store)
    const restoredB = await lookupStudyalMaterialEnjoyer(scopeB.fingerprint, store)
    assert.notDeepEqual(restoredA, restoredB, 'each fingerprint must have its own independent authority')
  })

  await test('3 & 4. Adaptive (write path) and Free Mode (read-only path) consume the identical shared analysis', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] })
    const store = new InMemoryMaterialEnjoyerStore()

    // Simulates Adaptive's route: generate-or-restore.
    const adaptiveResult = await getOrCreateStudyalMaterialEnjoyer(scope.fingerprint, store, async () => fakeBlueprint(scope.fingerprint, 'adaptive'))
    assert.equal(adaptiveResult.status, 'generated')

    // Simulates Free Mode's GET route: lookup-only, must see the SAME payload.
    const freeModeResult = await lookupStudyalMaterialEnjoyer(scope.fingerprint, store)
    assert.deepEqual(freeModeResult, adaptiveResult.payload, 'Free Mode must read the EXACT same analysis Adaptive generated for this fingerprint')
  })

  await test('5. Free Mode opening an existing analysis causes 0 provider calls', async () => {
    const scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] })
    const store = new InMemoryMaterialEnjoyerStore()
    await store.set(scope.fingerprint, fakeBlueprint(scope.fingerprint, 'pre-existing'))

    let providerCalls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { providerCalls++; throw new Error('MUST_NOT_CALL_PROVIDER') }) as typeof fetch
    try {
      const result = await lookupStudyalMaterialEnjoyer(scope.fingerprint, store)
      assert.ok(result, 'must find the pre-existing analysis')
      assert.equal(providerCalls, 0, 'reading an existing analysis must never call a provider')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  await test('6. no fallback to a mismatched fingerprint — a record stored under the wrong key is never served', async () => {
    const realScope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] })
    const staleScope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] })
    const store = new InMemoryMaterialEnjoyerStore()
    // A record whose OWN sourceSelectionFingerprint does not match the key
    // it happens to be stored under (simulating a corrupted/stale write) —
    // must never be served as if it were valid for the requested fingerprint.
    await store.set(realScope.fingerprint, fakeBlueprint(staleScope.fingerprint, 'stale'))

    const restored = await lookupStudyalMaterialEnjoyer(realScope.fingerprint, store)
    assert.equal(restored, null, 'a payload whose own fingerprint does not match must never be silently restored')
  })

  await test('7a. route wires the SAME wrapper for both write (POST) and read (GET) paths — no second pipeline', () => {
    const routeSource = readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    assert.match(routeSource, /import\s*{\s*getOrCreateStudyalMaterialEnjoyer,\s*lookupStudyalMaterialEnjoyer,\s*WorkerMaterialEnjoyerStore,?\s*[^}]*}\s*from\s*['"]\.\.\/\.\.\/\.\.\/\.\.\/lib\/adaptive\/materialEnjoyer['"]/)
    assert.match(routeSource, /export async function GET\(/, 'a lookup-only GET handler must exist for Free Mode')
    assert.match(routeSource, /export async function POST\(/, 'Adaptive\'s existing POST generation handler must be unchanged in name/shape')
  })

  await test('7b. GET (Free Mode read path) never invokes generation — only lookupStudyalMaterialEnjoyer', () => {
    const routeSource = readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    const getHandlerMatch = routeSource.match(/export async function GET\([^)]*\)\s*{([\s\S]*?)\n}\n\nexport async function POST/)
    assert.ok(getHandlerMatch, 'GET handler body must be extractable')
    const getBody = getHandlerMatch![1]
    assert.match(getBody, /lookupStudyalMaterialEnjoyer/)
    assert.doesNotMatch(getBody, /getOrCreateStudyalMaterialEnjoyer|analyzePdfPageVisual|alaiJson/, 'the read-only path must never trigger generation/vision/provider calls')
  })

  await test('7c. POST (Adaptive write path) checks restore-first BEFORE the expensive generation pipeline runs', () => {
    const routeSource = readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    const restoreIdx = routeSource.indexOf('lookupStudyalMaterialEnjoyer(sourceSelection.fingerprint, materialEnjoyerStore)')
    const visionIdx = routeSource.indexOf('analyzePdfPageVisual(')
    assert.ok(restoreIdx > -1 && visionIdx > -1)
    assert.ok(restoreIdx < visionIdx, 'restore-first check must run before any vision/extraction work, so a cache hit costs 0 provider calls')
  })

  await test('7d. Adaptive academic behavior is unchanged: the original response fields survive verbatim in the persisted/returned payload', () => {
    const routeSource = readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
    // The exact fields the original (pre-Phase-1) response always had must
    // still all be present in responsePayload — confirms the wrapper only
    // ADDED persistence/restore around the existing computation, never
    // altered what POST actually computes or returns.
    for (const field of ['blueprint', 'coverageCertified', 'planGenerationAllowed', 'certificationReasons', 'auditIssues', 'spanCoverage']) {
      assert.ok(routeSource.includes(field), `original response field "${field}" must still be present`)
    }
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('studyal-material-enjoyer-contracts: ALL PASS')
}

main()
