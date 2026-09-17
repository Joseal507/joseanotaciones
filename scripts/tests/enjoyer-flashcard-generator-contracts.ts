import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildEnjoyerDeck,
  ENJOYER_FLASHCARD_GENERATOR_VERSION,
  lookupEnjoyerFlashcardDeck,
  serializeEnjoyerForFlashcards,
  validateEnjoyerCoverage,
  validateProviderCards,
  type ProviderFlashcard,
} from '../../lib/materialBrain/flashcards/enjoyerAdapter'
import {
  generateEnjoyerFlashcardDeck,
  type EnjoyerFlashcardProvider,
  type EnjoyerGenerationRequest,
} from '../../lib/materialBrain/flashcards/enjoyerGenerator'

const scope = buildSourceSelectionSnapshot(['bohr'], { bohr: [1, 2, 3, 4, 5] })
const blueprint = {
  createdAt: 1700000000000,
  sourceSelectionFingerprint: scope.fingerprint,
  topicsIndex: [
    { id: 'foundations', title: 'Foundations', order: 0 },
    { id: 'atomic', title: 'Atomic model', order: 1 },
    { id: 'legacy', title: 'Legacy', order: 2 },
  ],
  globalOrderedAnalysis: [
    { id: 'early', kind: 'fact', label: 'Early scientific formation', summary: 'Bohr developed an early interest in atomic structure.', importance: 65, materialId: 'bohr', pages: [1], topicId: 'foundations', globalOrder: 0, sourceSpans: [{ page: 1, text: 'early interest in atomic structure' }] },
    { id: 'rutherford', kind: 'concept', label: 'Rutherford limitation', summary: 'Classical orbiting electrons would lose energy and make the atom unstable.', importance: 95, materialId: 'bohr', pages: [2], topicId: 'atomic', globalOrder: 1 },
    { id: 'equation', kind: 'formula', label: 'Energy-level equation', summary: 'En = -13.6 eV/n², where n is the principal energy level.', importance: 99, materialId: 'bohr', pages: [3], topicId: 'atomic', globalOrder: 2, sourceSpans: [{ page: 3, text: 'En = -13.6 eV/n²' }] },
    { id: 'transition', kind: 'process', label: 'Electron transitions', summary: 'An electron absorbs or emits a photon when changing energy level.', importance: 96, materialId: 'bohr', pages: [3], topicId: 'atomic', globalOrder: 3 },
    { id: 'nobel', kind: 'fact', label: 'Nobel Prize', summary: 'Bohr received the Nobel Prize in Physics in 1922 for atomic structure research.', importance: 92, materialId: 'bohr', pages: [4], topicId: 'legacy', globalOrder: 4 },
    { id: 'responsibility', kind: 'concept', label: 'Scientific responsibility', summary: 'Bohr advocated the responsible and peaceful use of scientific knowledge.', importance: 86, materialId: 'bohr', pages: [5], topicId: 'legacy', globalOrder: 5 },
  ],
  uniqueConceptsIndex: [
    { id: 'equation_duplicate', kind: 'formula', name: 'Energy-level equation', summary: 'En = -13.6 eV/n², where n is the principal energy level.', importance: 99, materialIds: ['bohr'], pages: [3], topicIds: ['atomic'] },
  ],
}

const payload = { success: true, blueprint }
const requests: EnjoyerGenerationRequest[] = []
let providerCalls = 0
const span = (sourceItemId: string, page: number) => [{ sourceItemId, page, quote: `${sourceItemId} grounded quote` }]

const provider: EnjoyerFlashcardProvider = async request => {
  providerCalls++
  requests.push(request)
  if (request.mode === 'repair') {
    assert.deepEqual(request.sourceItems.map(item => item.id), ['responsibility'], 'repair receives only uncovered items')
    assert.ok(request.contextItems.length > 0, 'repair receives bounded neighboring/topic context')
    assert.ok(request.existingCards.length > 0, 'repair receives existing cards for duplicate avoidance')
    return [{ question: 'What responsibility did Bohr assign to scientists?', answer: 'Science should be used responsibly and peacefully.', sourceItemIds: ['responsibility'], pages: [5], sourceSpans: span('responsibility', 5) }]
  }
  return [
    { question: 'How did the Rutherford limitation motivate Bohr?', answer: 'Classical orbiting electrons would make atoms unstable.', sourceItemIds: ['early', 'rutherford'], pages: [1, 2], sourceSpans: [...span('early', 1), ...span('rutherford', 2)] },
    { question: 'What is Bohr’s energy-level equation?', answer: 'En = -13.6 eV/n².', sourceItemIds: ['equation'], pages: [3], sourceSpans: span('equation', 3) },
    { question: 'What does n mean in the energy-level equation?', answer: 'n is the principal energy level.', sourceItemIds: ['equation'], pages: [3], sourceSpans: span('equation', 3) },
    { question: 'What connects electron transitions and Bohr’s Nobel recognition?', answer: 'Energy transitions explain spectra, while his atomic-structure research earned the Nobel Prize.', sourceItemIds: ['transition', 'nobel'], pages: [3, 4], sourceSpans: [...span('transition', 3), ...span('nobel', 4)] },
    { question: 'What is Bohr’s energy-level equation?', answer: 'Duplicate.', sourceItemIds: ['transition'], pages: [3], sourceSpans: span('transition', 3) },
    { question: 'Unsupported', answer: 'Unsupported.', sourceItemIds: ['false_id'], pages: [3], sourceSpans: span('false_id', 3) },
  ]
}

async function main() {
const source = serializeEnjoyerForFlashcards(payload, scope.fingerprint)
assert.equal(source.fingerprint, scope.fingerprint, '1/16 exact persisted Enjoyer fingerprint is the authority')
assert.equal(source.sourceItems.length, 6, 'exact duplicate index entry is excluded without losing academic blocks')
assert.equal(source.excludedSourceItems[0]?.reason, 'exact_duplicate')
assert.ok(source.sourceItems.some(item => item.id === 'equation' && /13\.6/.test(item.content)), '10 equation survives generator serialization')
assert.deepEqual(new Set(source.sourceItems.map(item => item.topicId)), new Set(['foundations', 'atomic', 'legacy']), '11 all topics survive generator serialization')

const deck = await generateEnjoyerFlashcardDeck(payload, scope, { provider, maxRepairAttempts: 2, language: 'English' })
assert.ok(requests[0].sourceItems.every(item => item.id && item.content && item.pages.length), '4 generator receives structured stable Enjoyer source IDs')
assert.ok(deck.cards.every(card => card.sourceItemIds.length && card.sourceUnitIds.join() === card.sourceItemIds.join()), '5 cards preserve mandatory sourceItemIds')
assert.equal(deck.cards.filter(card => card.sourceItemIds.length === 1 && card.sourceItemIds[0] === 'equation').length, 2, '6 one dense source item can produce multiple cards')
assert.ok(deck.cards.some(card => card.sourceItemIds.includes('transition') && card.sourceItemIds.includes('nobel')), '7 multiple related items can be covered by one card')
assert.notEqual(deck.cards.length, source.sourceItems.length, '8 card count is not tied to source/concept count')
assert.ok(!requests.some(request => request.sourceItems.length === 18), '9 no fixed maximum is filled')
assert.equal(deck.coverage.coverageStatus, 'complete')
assert.equal(deck.coverage.coveragePercent, 100)
assert.equal(deck.coverage.uncoveredSourceIds.length, 0)
assert.equal(deck.scope.fingerprint, scope.fingerprint, '16 fingerprint survives into deck')
assert.equal(deck.cards.filter(card => card.question === 'What is Bohr’s energy-level equation?').length, 1, '19 duplicate normalized question does not survive')

const beforeRepair = requests[0]
const initialValidation = validateProviderCards(await provider({ ...beforeRepair, mode: 'initial' }), source)
const initialCoverage = validateEnjoyerCoverage(source, initialValidation.cards)
assert.deepEqual(initialCoverage.uncoveredSourceIds, ['responsibility'], '12 identity validator detects uncovered source IDs')
assert.ok(requests.some(request => request.mode === 'repair'), '13 repair is called with uncovered items')
assert.equal(deck.meta.retries, 1, '14 repair raises coverage without whole-deck regeneration')
assert.ok(initialValidation.rejected >= 2, '15 false source IDs and duplicate questions are rejected')

const partialCards: ProviderFlashcard[] = initialValidation.cards
const partialDeck = buildEnjoyerDeck(source, scope, partialCards)
assert.equal(partialDeck.coverage.coverageStatus, 'partial', '20 partial coverage is never complete')
assert.ok(partialDeck.coverage.uncoveredSourceIds.length > 0)

let stored = deck
let cacheProviderCalls = 0
const currentLookup = await lookupEnjoyerFlashcardDeck({ get: async () => stored, set: async () => undefined }, scope.fingerprint)
if (currentLookup.deck) cacheProviderCalls += 0
assert.equal(currentLookup.status, 'ready')
assert.equal(cacheProviderCalls, 0, '17 current-version deck reuse causes zero provider calls')
stored = { ...deck, meta: { ...deck.meta, generatorVersion: 'enjoyer-2.0.0' } }
assert.equal((await lookupEnjoyerFlashcardDeck({ get: async () => stored, set: async () => undefined }, scope.fingerprint)).status, 'missing', '18 old deterministic deck version is invalidated')
assert.equal(deck.meta.generatorVersion, ENJOYER_FLASHCARD_GENERATOR_VERSION)

const adapterSource = readFileSync('lib/materialBrain/flashcards/enjoyerAdapter.ts', 'utf8')
const generatorSource = readFileSync('lib/materialBrain/flashcards/enjoyerGenerator.ts', 'utf8')
const routeSource = readFileSync('app/api/flashcards-v2/route.ts', 'utf8')
const activeSource = `${adapterSource}\n${generatorSource}\n${routeSource}`
assert.ok(!/getMaterialText|download-url|visualPageAnalysis|selectPagesNeedingVisualAnalysis|analyzeImage/.test(activeSource), '2 raw PDF/Vision is never analyzed')
assert.ok(!/lookupMaterialBrain|getOrBuildProductionBrain|getOrBuildFlashcardDeck|\/api\/material-brain|KnowledgeUnit/.test(activeSource), '3 Material Brain is never called/read')
assert.ok(/alaiJson/.test(generatorSource) && !/new OpenAI|new Anthropic/.test(generatorSource), 'existing provider infrastructure is reused')

console.log(`enjoyer-flashcard-generator-contracts: 20/20 PASS (${providerCalls} mocked provider calls, ${deck.cards.length} cards, 100% identity coverage)`)
}

main().catch(error => {
  console.error('enjoyer-flashcard-generator-contracts FAILED:', error)
  process.exit(1)
})
