import assert from 'node:assert/strict'
import { mergeExtractions } from '../../lib/materialBrain/merge'
import { validateDeck } from '../../lib/materialBrain/flashcards/validate'
import { buildIdentity } from '../../lib/materialBrain/identity'
import type { PageChunk } from '../../lib/materialBrain/types'
import type { ChunkExtractionResult } from '../../lib/materialBrain/extraction'
import type { GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'

// ============================================================
// P0 mission ("QUALIFIER DISPLAY SAFETY") — identity.qualifiers stays
// the normalized/internal matching key; displayQualifiers is the
// ADDITIVE, verbatim, human-readable counterpart. Never reconstructed
// from the slug, never invented, never falls back to identity.qualifiers
// for visible text.
// ============================================================

function chunk(id: string, text: string): PageChunk {
  return { id, materialId: 'mat-a', pages: [1], order: 0, text }
}
function extraction(units: ChunkExtractionResult['units']): ChunkExtractionResult {
  return { units, relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0 }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards qualifier display-safety contracts ──\n')

  await test('QDS-1: displayQualifiers preserves the verbatim source text with symbols/subscripts', () => {
    const raw = extraction([{
      kind: 'fact', canonicalSubject: 'Reaccion de sintesis', qualifiers: ['H₂(g) + I₂(g) ⇌ 2 HI(g)'],
      label: 'Reaccion de sintesis', statement: 'La reaccion procede a temperatura constante.',
      quote: 'texto', page: 1, domainTags: [], modelSuggestedTier: 'critical',
    }])
    const { units } = mergeExtractions([{ chunk: chunk('c1', 'texto'), extraction: raw }])
    assert.equal(units.length, 1)
    assert.deepEqual(units[0].displayQualifiers, ['H₂(g) + I₂(g) ⇌ 2 HI(g)'])
  })

  await test('QDS-2: identity.qualifiers stays normalized/internal and DIFFERS from displayQualifiers', () => {
    const raw = extraction([{
      kind: 'fact', canonicalSubject: 'Reaccion de sintesis', qualifiers: ['H₂(g) + I₂(g) ⇌ 2 HI(g)'],
      label: 'Reaccion de sintesis', statement: 'stmt', quote: 'texto', page: 1, domainTags: [], modelSuggestedTier: 'critical',
    }])
    const { units } = mergeExtractions([{ chunk: chunk('c1', 'texto'), extraction: raw }])
    assert.notEqual(units[0].identity.qualifiers[0], units[0].displayQualifiers![0])
    assert.ok(!units[0].identity.qualifiers[0].includes('⇌'), 'identity.qualifiers must remain the stripped/normalized internal key')
  })

  await test('QDS-3: identity.qualifiers matches buildIdentity\'s own normalization exactly (unchanged semantics)', () => {
    const raw = extraction([{
      kind: 'fact', canonicalSubject: 'X', qualifiers: ['Experimento 3'], label: 'X', statement: 's',
      quote: 'texto', page: 1, domainTags: [], modelSuggestedTier: 'critical',
    }])
    const { units } = mergeExtractions([{ chunk: chunk('c1', 'texto'), extraction: raw }])
    const expected = buildIdentity('fact', 'X', ['Experimento 3'])
    assert.deepEqual(units[0].identity.qualifiers, expected.qualifiers)
  })

  await test('QDS-4: a repaired question shows the human-readable displayQualifier, never the normalized slug', () => {
    const raw = extraction([{
      kind: 'event_or_data', canonicalSubject: 'Concentracion final', qualifiers: ['H₂(g) + I₂(g) ⇌ 2 HI(g)'],
      label: 'Concentracion final', statement: 'stmt', quote: 'texto', page: 1, domainTags: [], modelSuggestedTier: 'critical',
    }])
    const { units } = mergeExtractions([{ chunk: chunk('c1', 'texto'), extraction: raw }])
    const u = units[0]
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r', conceptClusterId: 'k' }
    const b = brain([u])
    const card: GeneratedFlashcard = { ...pc, question: '¿Cuál es la concentracion final?', answer: '0.031 M', provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated: false, validationErrors: [] }
    const result = validateDeck([card], { plannedCards: [pc], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, true, JSON.stringify(result[0].validationErrors))
    assert.ok(result[0].question.includes('H₂(g) + I₂(g) ⇌ 2 HI(g)'), `must show human-readable qualifier, got: ${result[0].question}`)
    assert.ok(!/h2.*g.*i2.*g.*2.*hi.*g/i.test(result[0].question.toLowerCase().replace(/[^\w]/g, '')) || result[0].question.includes('⇌'),
      'must never show the hyphenated/normalized slug form')
    assert.ok(!result[0].question.includes('h2-g-i2-g-2-hi-g'), 'must never leak the internal slug')
  })

  await test('QDS-5: multiple qualifiers (e.g. "H2, N2, NH3") are joined from displayQualifiers, never from identity.qualifiers', () => {
    const raw = extraction([{
      kind: 'fact', canonicalSubject: 'Sintesis de amoniaco', qualifiers: ['H2', 'N2', 'NH3'],
      label: 'Sintesis de amoniaco', statement: 'stmt', quote: 'texto', page: 1, domainTags: [], modelSuggestedTier: 'critical',
    }])
    const { units } = mergeExtractions([{ chunk: chunk('c1', 'texto'), extraction: raw }])
    const u = units[0]
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r', conceptClusterId: 'k' }
    const b = brain([u])
    const card: GeneratedFlashcard = { ...pc, question: '¿Qué se puede afirmar sobre el proceso?', answer: 'Es exotermico.', provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated: false, validationErrors: [] }
    const result = validateDeck([card], { plannedCards: [pc], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, true, JSON.stringify(result[0].validationErrors))
    assert.ok(result[0].question.includes('H2') && result[0].question.includes('N2') && result[0].question.includes('NH3'))
  })

  await test('QDS-6: a legacy unit with NO displayQualifiers never falls back to identity.qualifiers for display — repair is a no-op, card follows the normal validator', () => {
    // Simulates a persisted-before-this-field unit: identity.qualifiers
    // present (as it always was) but displayQualifiers absent (legacy).
    const u: KnowledgeUnit = {
      id: 'u-legacy', kind: 'event_or_data', label: 'Valor legado', statement: 'stmt',
      identity: { canonicalSubject: 'Valor legado', semanticKey: 'valor legado', qualifiers: ['experimento-3'] },
      importance: { tier: 'critical', signals: ['declared_in_material'], confidence: 1 },
      provenance: [{ materialId: 'mat-a', page: 1, quote: 'q', chunkId: 'c-1' }],
      domainTags: [],
      // displayQualifiers intentionally absent
    } as any
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r', conceptClusterId: 'k' }
    const b = brain([u])
    const card: GeneratedFlashcard = { ...pc, question: '¿Cuál es el valor?', answer: '5', provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated: false, validationErrors: [] }
    const result = validateDeck([card], { plannedCards: [pc], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, false, 'without displayQualifiers, repair must be a no-op and the normal contextless gate must still reject')
    assert.equal(result[0].question, '¿Cuál es el valor?', 'question must be UNCHANGED — never falls back to identity.qualifiers as display text')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-qualifier-display-safety-contracts: ALL PASS')
}

function brain(units: KnowledgeUnit[]): MaterialBrain {
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], {}), fingerprint: 'fp-qds' },
    meta: { version: '1.0.0', builderVersion: '1.0.0', generatedAt: new Date().toISOString(), chunking: { strategy: 'test', chunkSizeChars: 0, chunkCount: 0 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    knowledgeExtraction: { chunksAttempted: 0, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

main()
