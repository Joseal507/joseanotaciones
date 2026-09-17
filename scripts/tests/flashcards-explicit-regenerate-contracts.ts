import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import * as flashcardsRoute from '../../app/api/flashcards-v2/route'
import { getOrBuildFlashcardDeck as realGetOrBuildFlashcardDeck, lookupFlashcardDeck as realLookupFlashcardDeck } from '../../lib/materialBrain/flashcards'
import type { FlashcardDeck } from '../../lib/materialBrain/flashcards/types'
import type { FlashcardDeckStore } from '../../lib/materialBrain/flashcards/types'
import type { MaterialBrain, KnowledgeUnit } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

// ============================================================
// P0 mission ("EXPLICIT REGENERATE") — exercises the REAL POST()
// route handler (not deckStore.ts in isolation) end to end, proving
// the exact client-observable contract:
//   normal / refresh / navigation -> restore persisted deck
//   explicit regenerate:true -> bypass early-return, build a NEW deck,
//     replace the persisted one, for the SAME fingerprint
//   a subsequent normal request restores the NEW deck
// ============================================================

class InMemoryDeckStore implements FlashcardDeckStore {
  map = new Map<string, FlashcardDeck>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, deck: FlashcardDeck) { this.map.set(fp, deck) }
}

function unit(id: string, label: string): KnowledgeUnit {
  return {
    id, kind: 'concept', label, statement: `Statement for ${label}`,
    identity: { canonicalSubject: label, semanticKey: label.toLowerCase(), qualifiers: [] },
    importance: { tier: 'critical', signals: ['declared_in_material'], confidence: 1 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: 'q', chunkId: 'c-1' }],
    domainTags: [],
  } as any
}

function makeBrain(fingerprint: string): MaterialBrain {
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], {}), fingerprint },
    meta: {
      version: '1.0.0', builderVersion: '1.0.0', generatedAt: new Date().toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 0, chunkCount: 0 }, llmCallsUsed: 0, retries: 0,
      status: 'ready', sourceReadiness: 'ready', brainEnrichment: 'ready',
    },
    units: [unit('u1', 'Concepto A')], relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: 1, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

function generateFnWithMarker(marker: string) {
  return async (card: any) => ({
    ...card,
    question: `¿Qué establece el concepto sobre ${card.id} [${marker}]?`,
    answer: `Respuesta verificada [${marker}] con evidencia directa y detalle adicional del material autorizado.`,
    provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(),
    validated: true, validationErrors: [],
  })
}

function setupRouteDeps(deckStore: InMemoryDeckStore, brain: MaterialBrain, generateFn: any) {
  const deps = flashcardsRoute.__routeDeps
  deps.getServerSession = async () => ({ user: { id: 'u1' } }) as any
  deps.getMaterial = async (id: string) => ({ id, materialId: id, nombre: id, text_status: 'ready' } as any)
  deps.lookupMaterialBrain = async () => ({ status: 'ready', brain } as any)
  deps.lookupFlashcardDeck = async (_store: any, fp: string) => realLookupFlashcardDeck(deckStore, fp)
  deps.getOrBuildFlashcardDeck = async (b: MaterialBrain, _store: any, options: any) =>
    realGetOrBuildFlashcardDeck(b, deckStore, { ...options, generateFn })
}

function postRequest(materialIds: string[], selectedPages: Record<string, number[]>, regenerate?: boolean) {
  return new NextRequest('http://localhost/api/flashcards-v2', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ materialIds, selectedPages, ...(regenerate !== undefined ? { regenerate } : {}) }),
  })
}

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards explicit-regenerate contracts (real route) ──\n')

  await test('REGEN-A: normal request (no regenerate field) restores the persisted deck', async () => {
    const store = new InMemoryDeckStore()
    const brain = makeBrain('fp-regen-a')
    setupRouteDeps(store, brain, generateFnWithMarker('v1'))
    const first = await (await flashcardsRoute.POST(postRequest(['mat-a'], {}))).json()
    assert.equal(first.status, 'ready')
    const second = await (await flashcardsRoute.POST(postRequest(['mat-a'], {}))).json()
    assert.equal(second.status, 'ready')
    assert.deepEqual(second.deck.cards.map((c: any) => c.id).sort(), first.deck.cards.map((c: any) => c.id).sort())
    assert.ok(second.deck.cards[0].answer.includes('[v1]'), 'must be the SAME (v1) deck, not regenerated')
  })

  await test('REGEN-B: regenerate:true does NOT take the early lookupFlashcardDeck return path — it produces a genuinely new build', async () => {
    const store = new InMemoryDeckStore()
    const brain = makeBrain('fp-regen-b')
    setupRouteDeps(store, brain, generateFnWithMarker('v1'))
    await flashcardsRoute.POST(postRequest(['mat-a'], {}))
    // Swap the generator so a NEW build is observably different from the persisted one.
    setupRouteDeps(store, brain, generateFnWithMarker('v2'))
    const regenerated = await (await flashcardsRoute.POST(postRequest(['mat-a'], {}, true))).json()
    assert.equal(regenerated.status, 'ready')
    assert.ok(regenerated.deck.cards[0].answer.includes('[v2]'), 'explicit regenerate must produce a NEW deck, not the frozen v1 one')
  })

  await test('REGEN-C: the fingerprint/selection is identical across restore and regenerate', async () => {
    const store = new InMemoryDeckStore()
    const brain = makeBrain('fp-regen-c')
    setupRouteDeps(store, brain, generateFnWithMarker('v1'))
    const first = await (await flashcardsRoute.POST(postRequest(['mat-a'], {}))).json()
    setupRouteDeps(store, brain, generateFnWithMarker('v2'))
    const regenerated = await (await flashcardsRoute.POST(postRequest(['mat-a'], {}, true))).json()
    assert.equal(first.deck.scope.fingerprint, regenerated.deck.scope.fingerprint)
  })

  await test('REGEN-D: the new deck REPLACES the persisted one in the store', async () => {
    const store = new InMemoryDeckStore()
    const brain = makeBrain('fp-regen-d')
    setupRouteDeps(store, brain, generateFnWithMarker('v1'))
    await flashcardsRoute.POST(postRequest(['mat-a'], {}))
    setupRouteDeps(store, brain, generateFnWithMarker('v2'))
    await flashcardsRoute.POST(postRequest(['mat-a'], {}, true))
    const persisted = store.map.get('fp-regen-d')
    assert.ok(persisted!.cards[0].answer.includes('[v2]'), 'the store must hold the NEW deck, not the old one')
  })

  await test('REGEN-E: a normal request AFTER regenerate restores the NEW deck (not the original)', async () => {
    const store = new InMemoryDeckStore()
    const brain = makeBrain('fp-regen-e')
    setupRouteDeps(store, brain, generateFnWithMarker('v1'))
    await flashcardsRoute.POST(postRequest(['mat-a'], {}))
    setupRouteDeps(store, brain, generateFnWithMarker('v2'))
    await flashcardsRoute.POST(postRequest(['mat-a'], {}, true))
    setupRouteDeps(store, brain, generateFnWithMarker('v3')) // must NOT be reached
    const afterRefresh = await (await flashcardsRoute.POST(postRequest(['mat-a'], {}))).json()
    assert.ok(afterRefresh.deck.cards[0].answer.includes('[v2]'), 'refresh after regenerate must restore v2, never fall through to v3')
  })

  await test('REGEN-F: regenerate:false (or absent) never bypasses restore-first (freeze contract intact)', async () => {
    const store = new InMemoryDeckStore()
    const brain = makeBrain('fp-regen-f')
    setupRouteDeps(store, brain, generateFnWithMarker('v1'))
    await flashcardsRoute.POST(postRequest(['mat-a'], {}))
    setupRouteDeps(store, brain, generateFnWithMarker('v2'))
    const explicit = await (await flashcardsRoute.POST(postRequest(['mat-a'], {}, false))).json()
    assert.ok(explicit.deck.cards[0].answer.includes('[v1]'), 'regenerate:false must behave identically to omitting the field')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-explicit-regenerate-contracts: ALL PASS')
}

main()
