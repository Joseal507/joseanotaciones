import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  ENJOYER_FLASHCARD_GENERATOR_VERSION,
  lookupEnjoyerFlashcardDeck,
} from '../../lib/materialBrain/flashcards/enjoyerAdapter'
import {
  buildEnjoyerFlashcardPrompt,
  generateEnjoyerFlashcardDeck,
  type EnjoyerFlashcardProvider,
  type EnjoyerGenerationRequest,
} from '../../lib/materialBrain/flashcards/enjoyerGenerator'

const scope = buildSourceSelectionSnapshot(['dense-material'], { 'dense-material': [1, 2] })
const payload = { blueprint: {
  createdAt: 1700000000000,
  sourceSelectionFingerprint: scope.fingerprint,
  topicsIndex: [{ id: 'core', title: 'Core knowledge', order: 0 }],
  globalOrderedAnalysis: [
    {
      id: 'dense_source', kind: 'concept', label: 'Dense academic mechanism',
      summary: 'The system has a defining structure, changes through a mechanism, and produces a distinct observable consequence.',
      importance: 95, materialId: 'dense-material', pages: [1], topicId: 'core', globalOrder: 0,
    },
    {
      id: 'repair_source', kind: 'fact', label: 'Independent grounded fact',
      summary: 'A separate academic fact is explicitly stated by the analysis.',
      importance: 80, materialId: 'dense-material', pages: [2], topicId: 'core', globalOrder: 1,
    },
  ],
  uniqueConceptsIndex: [],
} }

const requests: EnjoyerGenerationRequest[] = []
let providerCalls = 0
const provider: EnjoyerFlashcardProvider = async request => {
  providerCalls++
  requests.push(request)
  if (request.mode === 'repair') {
    assert.deepEqual(request.sourceItems.map(item => item.id), ['repair_source'])
    return [
      { question: 'What independent fact does the analysis state?', answer: 'It states a separate academic fact.', sourceItemIds: ['repair_source'], pages: [2], sourceSpans: [{ sourceItemId: 'repair_source', page: 2 }] },
      { question: 'How is that independent fact characterized?', answer: 'It is explicitly grounded in the analysis.', sourceItemIds: ['repair_source'], pages: [2], sourceSpans: [{ sourceItemId: 'repair_source', page: 2 }] },
    ]
  }
  return [
    { question: 'What structure defines the system?', answer: 'It has a defining structure.', sourceItemIds: ['dense_source'], pages: [1], sourceSpans: [{ sourceItemId: 'dense_source', page: 1 }] },
    { question: 'How does the system change?', answer: 'It changes through a mechanism.', sourceItemIds: ['dense_source'], pages: [1], sourceSpans: [{ sourceItemId: 'dense_source', page: 1 }] },
    { question: 'What observable consequence does the system produce?', answer: 'It produces a distinct observable consequence.', sourceItemIds: ['dense_source'], pages: [1], sourceSpans: [{ sourceItemId: 'dense_source', page: 1 }] },
    { question: 'How does the system change?', answer: 'Duplicate wording must be rejected.', sourceItemIds: ['dense_source'], pages: [1], sourceSpans: [{ sourceItemId: 'dense_source', page: 1 }] },
  ]
}

async function main() {
  const prompt = buildEnjoyerFlashcardPrompt({
    mode: 'initial', fingerprint: scope.fingerprint, language: 'English',
    sourceItems: [], contextItems: [], existingCards: [],
  })
  assert.match(prompt, /one clear primary recall target/i, 'atomic primary target is explicit')
  assert.match(prompt, /Prefer two short atomic cards over one compound card/i, 'compound knowledge is split by provider instruction')
  assert.match(prompt, /Avoid questions joined by "and"/i, 'obvious compound questions are discouraged')
  assert.match(prompt, /minimum information needed/i, 'answers are instructed to stay atomic')
  assert.match(prompt, /Reuse|Reusing the same sourceItemIds/i, 'multiple cards may share source identity')
  assert.match(prompt, /complete academic coverage/i, 'atomicity preserves global coverage')

  const deck = await generateEnjoyerFlashcardDeck(payload, scope, { provider, maxRepairAttempts: 2 })
  const denseCards = deck.cards.filter(card => card.sourceItemIds.includes('dense_source'))
  assert.equal(denseCards.length, 3, '1 one dense source item may produce multiple atomic cards')
  assert.ok(denseCards.every(card => card.sourceItemIds.length === 1 && card.sourceItemIds[0] === 'dense_source'), '2 multiple cards legally share sourceItemIds')
  assert.equal(new Set(denseCards.map(card => card.question)).size, 3, '3 shared sourceItemIds do not trigger dedup')
  assert.equal(deck.cards.filter(card => card.question === 'How does the system change?').length, 1, '4 actual duplicate question is deduplicated')
  assert.ok(denseCards.every(card => card.answer.split(/[.!?]/).filter(Boolean).length === 1), '5 mocked compound information becomes atomic answers')
  assert.equal(deck.coverage.coveragePercent, 100, '6 atomic decomposition keeps complete source coverage')
  assert.notEqual(deck.cards.length, payload.blueprint.globalOrderedAnalysis.length, '7 no artificial fixed or one-per-source count')
  assert.ok(deck.cards.every(card => card.provenance.length > 0 && card.sourceItemIds.every(id => card.provenance.some(item => item.chunkId === id))), '8 every answer remains grounded in its source IDs')
  assert.equal(deck.meta.retries, 1, '9 uncovered source repair works with multiple cards per source')
  assert.ok(requests.find(request => request.mode === 'repair')?.existingCards.length === 3, 'repair sees all atomic existing cards without regenerating them')

  const activeSource = [
    readFileSync('lib/materialBrain/flashcards/enjoyerAdapter.ts', 'utf8'),
    readFileSync('lib/materialBrain/flashcards/enjoyerGenerator.ts', 'utf8'),
    readFileSync('app/api/flashcards-v2/route.ts', 'utf8'),
  ].join('\n')
  assert.ok(!/lookupMaterialBrain|getOrBuildProductionBrain|getOrBuildFlashcardDeck|\/api\/material-brain|KnowledgeUnit/.test(activeSource), '10 Material Brain remains absent')
  assert.ok(!/getOrCreateStudyalMaterialEnjoyer|\/api\/adaptive\/blueprint/.test(activeSource), '11 generation path does not regenerate Enjoyer')

  let cacheProviderCalls = 0
  const lookup = await lookupEnjoyerFlashcardDeck({ get: async () => deck, set: async () => undefined }, scope.fingerprint)
  if (!lookup.deck) cacheProviderCalls++
  assert.equal(lookup.status, 'ready')
  assert.equal(cacheProviderCalls, 0, '12 current atomic-version cache restore makes zero provider calls')
  assert.equal(deck.meta.generatorVersion, ENJOYER_FLASHCARD_GENERATOR_VERSION)
  assert.equal(providerCalls, 2, 'only initial generation and one bounded repair call occur')

  console.log(`enjoyer-flashcard-atomic-recall-contracts: 12/12 PASS (${deck.cards.length} cards, shared IDs preserved, 100% coverage)`)
}

main().catch(error => {
  console.error('enjoyer-flashcard-atomic-recall-contracts FAILED:', error)
  process.exit(1)
})
