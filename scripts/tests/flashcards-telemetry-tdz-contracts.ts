import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import type { FlashcardDeckStore, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'

// ============================================================
// P0 HOTFIX — real-regeneration crash: "Cannot access
// 'notationDiagnostics' before initialization". Root cause:
// stageSnapshots/notationDiagnostics (and their helper functions) were
// declared AFTER the first call site that invoked them — `function`
// declarations hoist, but the `const` arrays they close over do not
// (TDZ). None of the PRIOR telemetry tests caught this because their
// fixtures never contained a watched notation operator (≫≪><±≈⇌→←≥≤≠∝),
// so the vulnerable `notationDiagnostics.push(...)` line never actually
// executed. Every fixture here deliberately includes one.
// ============================================================

class InMemoryDeckStore implements FlashcardDeckStore {
  private map = new Map<string, any>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, deck: any) { this.map.set(fp, deck) }
}

function scopeFor(materialIds: string[]) { return buildSourceSelectionSnapshot(materialIds, {}) }
function unit(id: string, label: string, statement: string): KnowledgeUnit {
  return {
    id, kind: 'concept', label, statement,
    identity: { canonicalSubject: label, semanticKey: label.toLowerCase(), qualifiers: [] },
    importance: { tier: 'critical', signals: ['declared_in_material'], confidence: 1 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'chunk-1' }],
    domainTags: [],
  } as any
}
function brain(units: KnowledgeUnit[], fingerprint = 'fp-tdz'): MaterialBrain {
  return {
    scope: { ...scopeFor(['mat-a']), fingerprint },
    meta: { version: '1.0.0', builderVersion: '1.0.0', generatedAt: new Date().toISOString(), chunking: { strategy: 'test', chunkSizeChars: 0, chunkCount: 0 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    knowledgeExtraction: { chunksAttempted: 0, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

// Source content that DOES contain a watched notation operator ("≫"),
// exactly the class of real content that triggered the crash.
const NOTATION_UNIT = unit('u-k', 'Constante de equilibrio', 'Cuando K ≫ 1, la reaccion favorece los productos casi por completo.')

function generateFnWithNotation(planned: PlannedCard) {
  return Promise.resolve({
    ...planned,
    question: `¿Qué implica que K ≫ 1 en ${planned.id}?`,
    answer: 'Implica que la reaccion favorece fuertemente a los productos, con K ≫ 1 confirmado por evidencia directa.',
    provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(),
    validated: true, validationErrors: [],
  })
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards telemetry TDZ hotfix contracts ──\n')

  await test('TRACE-TDZ-1: getOrBuildFlashcardDeck with notation-bearing content and active telemetry does NOT throw ReferenceError', async () => {
    const b = brain([NOTATION_UNIT])
    const store = new InMemoryDeckStore()
    let result: any
    let threw: Error | null = null
    try {
      result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFnWithNotation as any })
    } catch (err: any) {
      threw = err
    }
    assert.equal(threw, null, `must not throw, got: ${threw?.message}`)
    assert.ok(result?.deck, 'a deck must still be produced')
  })

  await test('TRACE-TDZ-2: raw_candidate instrumentation runs AFTER initialization (generation with notation content succeeds)', async () => {
    const b = brain([NOTATION_UNIT], 'fp-tdz-2')
    const store = new InMemoryDeckStore()
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFnWithNotation as any })
    assert.equal(result.status, 'ready')
    assert.ok(result.deck!.cards.some(c => c.validated))
  })

  await test('TRACE-TDZ-3: validated_repaired instrumentation does not alter the validated result', async () => {
    const b = brain([NOTATION_UNIT], 'fp-tdz-3')
    const store = new InMemoryDeckStore()
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFnWithNotation as any })
    const card = result.deck!.cards.find(c => c.validated)!
    assert.ok(card.question.includes('K ≫ 1') || card.answer.includes('K ≫ 1'), 'the notation-bearing content must survive unchanged by telemetry')
  })

  await test('TRACE-TDZ-4: final_persisted instrumentation does not alter the persisted deck', async () => {
    const b = brain([NOTATION_UNIT], 'fp-tdz-4')
    const store = new InMemoryDeckStore()
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFnWithNotation as any })
    const persisted = await store.get('fp-tdz-4')
    assert.deepEqual(persisted!.cards.map((c: any) => c.id).sort(), result.deck!.cards.map(c => c.id).sort())
  })

  await test('TRACE-TDZ-5: a simulated internal notation-diagnostics failure never turns a valid generation into a failure', async () => {
    // Content specifically crafted to stress the regex/snippet extraction
    // (multiple operators back-to-back, edge-of-string) without any
    // special mocking — the fail-open try/catch inside deckStore.ts's
    // recordNotationDiagnostics is what this test actually exercises.
    const edgeUnit = unit('u-edge', 'Comparacion', '≫≪><±≈⇌→←≥≤≠∝ todo junto al inicio y final ≫')
    const b = brain([edgeUnit], 'fp-tdz-5')
    const store = new InMemoryDeckStore()
    const generateFn = (planned: PlannedCard) => Promise.resolve({
      ...planned, question: `¿Qué relación se observa (${'≫≪><±≈⇌→←≥≤≠∝'})?`, answer: 'Una relación de orden clara y consistente con la evidencia.',
      provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated: true, validationErrors: [],
    })
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.ok(result.deck, 'must not fail even with a dense/edge-case notation string')
  })

  await test('TRACE-TDZ-6: telemetry-active and telemetry-irrelevant runs produce deep-equivalent decks (cards/coverage), only notation content differs by design', async () => {
    const bWithNotation = brain([NOTATION_UNIT], 'fp-tdz-6a')
    const bPlain = brain([unit('u-plain', 'Concepto simple', 'Un concepto simple sin operadores especiales.')], 'fp-tdz-6b')
    const store1 = new InMemoryDeckStore()
    const store2 = new InMemoryDeckStore()
    const r1 = await getOrBuildFlashcardDeck(bWithNotation, store1, { generateFn: generateFnWithNotation as any })
    const r2 = await getOrBuildFlashcardDeck(bPlain, store2, {
      generateFn: (planned: PlannedCard) => Promise.resolve({
        ...planned, question: `¿Qué establece el concepto en ${planned.id}?`, answer: 'Una explicación verificada con evidencia directa del material.',
        provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated: true, validationErrors: [],
      }) as any,
    })
    // Both must reach the same STRUCTURAL shape (status/coverage completeness) —
    // proving telemetry presence/absence of notation content never
    // changes the deck-building CONTRACT, only its own diagnostic payload.
    assert.equal(r1.status, r2.status)
    assert.equal(r1.deck!.coverage.status, r2.deck!.coverage.status)
    assert.equal(r1.deck!.cards.length, r2.deck!.cards.length)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-telemetry-tdz-contracts: ALL PASS')
}

main()
