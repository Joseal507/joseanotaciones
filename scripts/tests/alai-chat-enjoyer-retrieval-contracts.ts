import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildChatEnjoyerContext, retrieveForChat, renderChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-chat' }

const items = [
  { id: 'kc', kind: 'formula', name: 'Constante Kc', content: 'Kc es la constante de equilibrio en concentraciones molares', importance: 90, difficulty: 'advanced', topicId: 't-equilibrio', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'Kc se define como el cociente de concentraciones en el equilibrio' }] },
  { id: 'kp', kind: 'formula', name: 'Constante Kp', content: 'Kp es la constante de equilibrio en presiones parciales', importance: 85, difficulty: 'advanced', topicId: 't-equilibrio', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'Kp usa presiones parciales de gases' }] },
  { id: 'reaction-quotient', kind: 'concept', name: 'Cociente de reacción Q', content: 'Q compara las concentraciones actuales contra el equilibrio', importance: 70, difficulty: 'medium', topicId: 't-equilibrio', materialId: 'mat-a', pages: [2], sourceSpans: [{ page: 2, quote: 'Q se calcula igual que Kc pero en cualquier momento' }] },
  { id: 'unrelated-topic', kind: 'concept', name: 'Fotosíntesis', content: 'La fotosíntesis convierte luz solar en energía química en las plantas', importance: 60, difficulty: 'basic', topicId: 't-biologia', materialId: 'mat-a', pages: [3], sourceSpans: [{ page: 3, quote: 'La fotosíntesis ocurre en los cloroplastos' }] },
]

const relations = [
  { id: 'r1', type: 'related_formula', fromSourceItemId: 'kc', toSourceItemId: 'kp' },
]

function payload() {
  return {
    sourceSelectionFingerprint: 'fp-chat', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2, 3] },
    topicsIndex: [{ id: 't-equilibrio', title: 'Equilibrio químico' }, { id: 't-biologia', title: 'Biología' }],
    globalOrderedAnalysis: items, uniqueConceptsIndex: [], relations,
  }
}

function main() {
  const context = buildChatEnjoyerContext(payload(), selection)
  assert.equal(context.targets.length, 4)
  const kc = context.targets.find(t => t.sourceItemId === 'kc')!
  const kp = context.targets.find(t => t.sourceItemId === 'kp')!
  const q = context.targets.find(t => t.sourceItemId === 'reaction-quotient')!
  const bio = context.targets.find(t => t.sourceItemId === 'unrelated-topic')!

  // A: exact label match ranks the correct concept highly.
  {
    const result = retrieveForChat({ query: '¿Qué es Kc?', context })
    assert.equal(result.targets[0]?.id, kc.id, 'A: exact label match ranks the correct concept first')
  }

  // B: topic match retrieves appropriate targets (equilibrio-scoped question surfaces equilibrio targets, not biology).
  {
    const result = retrieveForChat({ query: '¿Cómo se relaciona la constante de equilibrio con el cociente de reacción?', context })
    const ids = result.targets.map(t => t.id)
    assert.ok(ids.includes(kc.id) || ids.includes(q.id), 'B: equilibrium-topic question retrieves equilibrium targets')
    assert.ok(!ids.includes(bio.id), 'B: unrelated topic is not pulled in by a topic-scoped question')
  }

  // C: lexical content match works even without an exact label hit.
  {
    const result = retrieveForChat({ query: '¿qué convierte la luz solar en energía?', context })
    assert.equal(result.targets[0]?.id, bio.id, 'C: lexical content overlap surfaces the right target')
  }

  // D: previous-turn target IDs preserve follow-up context for a short question with no lexical overlap.
  {
    const recentGrounding = { mode: 'MATERIAL_ONLY' as const, usedTargetIds: [kc.id], usedRelationIds: [], materialIds: ['mat-a'], pages: [1] }
    const result = retrieveForChat({ query: '¿y por qué?', context, recentGrounding })
    assert.ok(result.targets.some(t => t.id === kc.id), 'D: follow-up carries forward the previous turn\'s grounded target')
  }

  // E: explicit relation neighbor can be included without inventing relation type semantics.
  {
    const result = retrieveForChat({ query: '¿Qué es Kc?', context })
    assert.ok(result.targets.some(t => t.id === kp.id), 'E: the explicit relation neighbor (Kp) is included via connectivity boost')
    const rendered = renderChatEnjoyerContext(result)
    assert.ok(!rendered.toLowerCase().includes('causa') && !rendered.toLowerCase().includes('implica'),
      'E: rendered context never asserts a semantic meaning for the relation type beyond its literal label')
  }

  // F: unrelated targets stay outside the bounded context.
  {
    const result = retrieveForChat({ query: '¿Qué es Kc?', context })
    assert.ok(!result.targets.some(t => t.id === bio.id), 'F: an unrelated target (photosynthesis) never enters a chemistry-scoped retrieval')
  }

  // G: deterministic output for identical inputs.
  {
    const a = retrieveForChat({ query: '¿Qué es Kc?', context })
    const b = retrieveForChat({ query: '¿Qué es Kc?', context })
    assert.deepEqual(a.targets.map(t => t.id), b.targets.map(t => t.id), 'G: identical inputs produce identical target selection')
  }

  // H: context respects a maximum target/character budget.
  {
    const manyItems = Array.from({ length: 40 }, (_, i) => ({
      id: `bulk-${i}`, kind: 'concept', name: `Concepto masivo ${i} sobre equilibrio quimico`,
      content: `Contenido masivo ${i} sobre equilibrio quimico y constantes`, importance: 50, difficulty: 'medium',
      topicId: 't-equilibrio', materialId: 'mat-a', pages: [1], sourceSpans: [],
    }))
    const bulkContext = buildChatEnjoyerContext({ ...payload(), globalOrderedAnalysis: [...items, ...manyItems] }, selection)
    const result = retrieveForChat({ query: 'equilibrio quimico constantes', context: bulkContext, limits: { targets: 5, maxChars: 1500 } })
    assert.ok(result.targets.length <= 5, 'H: target count respects the configured limit')
    const rendered = renderChatEnjoyerContext(result)
    assert.ok(rendered.length < 4000, 'H: rendered context respects a bounded character budget, never the whole universe')
  }

  // I: pages/provenance survive retrieval.
  {
    const result = retrieveForChat({ query: '¿Qué es Kc?', context })
    const usedKc = result.targets.find(t => t.id === kc.id)!
    assert.deepEqual(usedKc.pages, [1])
    assert.equal(usedKc.sourceSpans[0]?.quote, 'Kc se define como el cociente de concentraciones en el equilibrio')
    assert.ok(result.pages.includes(1), 'I: retrieval result exposes provenance pages')
  }

  // J: unknown supplied (previous-turn) target IDs are discarded, never trusted.
  {
    const recentGrounding = { mode: 'MATERIAL_ONLY' as const, usedTargetIds: ['chat_target:does-not-exist'], usedRelationIds: [], materialIds: [], pages: [] }
    const result = retrieveForChat({ query: '¿y entonces?', context, recentGrounding })
    assert.ok(!result.targets.some(t => t.id === 'chat_target:does-not-exist'), 'J: an unknown previous-turn target id never becomes part of the bounded context')
  }

  console.log('alai-chat-enjoyer-retrieval-contracts: A-J ALL PASS')
}

main()
