import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildChatEnjoyerContext, retrieveForChat, renderChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'
const source = buildSourceSelectionSnapshot(['a', 'b'], { a: [5], b: [5] })
const context = buildChatEnjoyerContext({ sourceSelectionFingerprint: source.fingerprint, globalOrderedAnalysis: [
  { id: 'a', name: 'Célula animal', summary: 'La célula animal.', materialId: 'a', pages: [5], sourceSpans: [{ page: 99, quote: 'UNAUTHORIZED' }, { page: 5, quote: 'La célula animal.' }] },
  { id: 'b', name: 'Célula vegetal', summary: 'La célula vegetal.', materialId: 'b', pages: [5] },
] }, source)
assert.ok(context.targets.every(t => t.sourceSpans.every(s => s.page === 5)))
const result = retrieveForChat({ query: 'célula', context, sourcePolicy: 'MATERIAL_ONLY' })
assert.deepEqual(result.evidence.map(e => [e.materialId, e.pages]), [['a', [5]], ['b', [5]]])
assert.ok(!renderChatEnjoyerContext(result).includes('UNAUTHORIZED'))
context.targets[0].sourceSpans = [{ page: 5, quote: 'Q'.repeat(12000) }]
for (const maxChars of [0, 1, 100, 500, 8000]) {
  const bounded = retrieveForChat({ query: 'célula', context, limits: { maxChars } })
  assert.ok(renderChatEnjoyerContext(bounded).length <= maxChars)
  assert.ok(!bounded.targets.some(t => t.id === 'chat_target:a'))
}
const miss = retrieveForChat({ query: 'mitocondria inexistente', context, sourcePolicy: 'MATERIAL_ONLY' })
assert.equal(miss.mode, 'MATERIAL_ONLY')
assert.equal(miss.materialRetrievalOutcome, 'no_relevant_target')
console.log('alai-chat-phase-b-retrieval: PASS')
