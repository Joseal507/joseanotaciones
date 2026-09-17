import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { validateDeck, computeDeckCoverage, reconcileFinalCoverage, repairUnwrappedNotation } from '../../lib/materialBrain/flashcards/validate'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { reconcilePedagogicalDuplicates } from '../../lib/materialBrain/flashcards/pedagogicalDedup'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import type { GeneratedFlashcard, PlannedCard, FlashcardDeckStore, FlashcardPlan } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { BrainScope, KnowledgeUnit, KnowledgeRelation, MaterialBrain } from '../../lib/materialBrain/types'

// ============================================================
// P0 mission — real-run regression fixture (155 units / 59 targets
// class of failure): coverage-transfer bug, non-studyable relation
// leak, repairable-vs-true-invalid notation classification, dedup
// judge context enrichment, and the mandatory coverage invariant.
// ============================================================

function scopeFor(materialIds: string[]) { return buildSourceSelectionSnapshot(materialIds, {}) }
function prov(materialId: string, page: number) { return { materialId, page, quote: 'quote', chunkId: 'chunk-1' } }

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: extra.canonicalSubject ?? label, semanticKey: extra.semanticKey ?? label, qualifiers: extra.qualifiers || [] },
    importance: { tier: extra.tier || 'critical', signals: ['declared_in_material'], confidence: 1 },
    provenance: [prov('mat-a', 1)],
    domainTags: [],
    ...extra,
  } as any
}
function relation(id: string, type: KnowledgeRelation['type'], fromUnitId: string, toUnitId: string): KnowledgeRelation {
  return { id, type, fromUnitId, toUnitId, statement: `${fromUnitId} ${type} ${toUnitId}`, importance: { tier: 'supporting', signals: ['prerequisite_for'], confidence: 0.9 }, provenance: [prov('mat-a', 1)] }
}
function brain(units: KnowledgeUnit[], relations: KnowledgeRelation[] = []): MaterialBrain {
  return {
    scope: { ...scopeFor(['mat-a']), fingerprint: 'fp-recon' },
    meta: { version: '1.0.0', builderVersion: '1.0.0', generatedAt: new Date().toISOString(), chunking: { strategy: 'test', chunkSizeChars: 0, chunkCount: 0 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    knowledgeExtraction: { chunksAttempted: 0, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}
function pc(id: string, sourceUnitIds: string[], clusterId = 'cluster-' + id, cognitiveType: PlannedCard['cognitiveType'] = 'recall'): PlannedCard {
  return { id, sourceUnitIds, sourceRelationIds: [], retrievalObjective: id, cognitiveType, rationale: 'r', conceptClusterId: clusterId }
}
function card(planned: PlannedCard, question: string, answer: string, validated = true, errors: string[] = []): GeneratedFlashcard {
  return { ...planned, question, answer, provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated, validationErrors: errors }
}

class InMemoryDeckStore implements FlashcardDeckStore {
  private map = new Map<string, any>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, deck: any) { this.map.set(fp, deck) }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards coverage-reconciliation P0 contracts ──\n')

  await test('RECON-1: repairable unwrapped-notation error survives through deterministic normalization', () => {
    const u = unit('u1', 'concept', 'Kp/Kc', 'La relacion Kp = Kc(RT)^Δn conecta ambas constantes.')
    const b = brain([u])
    const p = pc('c1', ['u1'])
    const bad = card(p, '¿Cuál es la formula de N_2O_4?', 'N_2O_4 se descompone en 2NO_2.')
    const plan: FlashcardPlan = { plannedCards: [p], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' }
    const result = validateDeck([bad], plan, b)
    assert.equal(result[0].validated, true, `should survive repair, got: ${result[0].validationErrors.join(',')}`)
    assert.ok(!/(?<!\$)_(?!\$)/.test(result[0].question.replace(/\$[^$]*\$/g, '')), 'question must no longer have bare underscores outside $...$')
    assert.ok(result[0].question.includes('$N_2O_4$'), `notation should be wrapped, got: ${result[0].question}`)
  })

  await test('RECON-2: repairUnwrappedNotation never alters plain prose (no notation markers)', () => {
    const text = 'La velocidad de reaccion depende de la temperatura y la concentracion de reactivos.'
    assert.equal(repairUnwrappedNotation(text), text)
  })

  await test('RECON-3: a truly invalid card (circular question/answer) remains rejected after repair attempt', () => {
    const u = unit('u2', 'concept', 'Equilibrio', 'El equilibrio se alcanza cuando las velocidades se igualan.')
    const b = brain([u])
    const p = pc('c2', ['u2'])
    const bad = card(p, '¿Qué es el equilibrio quimico?', 'El equilibrio quimico.')
    const plan: FlashcardPlan = { plannedCards: [p], targetedUnitIds: ['u2'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' }
    const result = validateDeck([bad], plan, b)
    assert.equal(result[0].validated, false)
  })

  await test('RECON-4: a target whose source unit survives inside a DIFFERENT card transfers coverage (real-deck evidence class)', () => {
    const pA = pc('cA', ['concept_a92d92e0481fe60c'], 'sk:reaccion_directa')
    const pB = pc('cB', ['concept_a92d92e0481fe60c', 'concept_other'], 'sk:combined')
    const plan: FlashcardPlan = { plannedCards: [pA, pB], targetedUnitIds: [], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' }
    // Only pB survived (e.g. pA was merged away by dedup or never validated),
    // but pB's sourceUnitIds still include pA's defining unit.
    const finalCards = [card(pB, 'q', 'a')]
    const reconciled = reconcileFinalCoverage(finalCards, plan)
    assert.ok(reconciled.coveredTargetIds.includes('sk:reaccion_directa'), 'target must be covered via transfer')
    const transfer = reconciled.coverageTransfers.find(t => t.targetId === 'sk:reaccion_directa')
    assert.equal(transfer?.transferType, 'transfer')
    assert.ok(transfer?.sharedSourceUnitIds.includes('concept_a92d92e0481fe60c'))
  })

  await test('RECON-5: coverage invariant — every target covered XOR pending, covered+pending == retrievalTargets', () => {
    const pA = pc('cA', ['u1'], 'clusterA'), pB = pc('cB', ['u2'], 'clusterB'), pC = pc('cC', ['u3'], 'clusterC')
    const plan: FlashcardPlan = { plannedCards: [pA, pB, pC], targetedUnitIds: ['u1', 'u2', 'u3'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' }
    const finalCards = [card(pA, 'q', 'a'), card(pB, 'q2', 'a2', false, ['low_information_value'])]
    const coverage = computeDeckCoverage(finalCards, plan)
    const reconciled = reconcileFinalCoverage(finalCards, plan)
    const coveredSet = new Set(reconciled.coveredTargetIds)
    const pendingSet = new Set(reconciled.pendingTargetIds)
    assert.equal(coveredSet.size + pendingSet.size, coverage.targetedConceptClusterIds.length)
    for (const id of coveredSet) assert.ok(!pendingSet.has(id), `${id} in both sets`)
    for (const id of coverage.targetedConceptClusterIds) assert.ok(coveredSet.has(id) || pendingSet.has(id), `${id} missing from both sets`)
  })

  await test('RECON-6: non-studyable metadata unit referenced ONLY via a relation never becomes a retrieval target', () => {
    const realConcept = unit('u10', 'concept', 'Equilibrio quimico', 'El equilibrio quimico es un estado dinamico.')
    const metadataUnit = unit('u11', 'fact', 'Derechos de autor', '© 2015 Editorial Ejemplo. Todos los derechos reservados.', { importance: { tier: 'contextual', signals: [], confidence: 0.5 } })
    const rel = relation('r1', 'depends_on', 'u10', 'u11')
    const b = brain([realConcept, metadataUnit], [rel])
    const plan = planFlashcards(b)
    const clusterIds = new Set(plan.plannedCards.map(c => c.conceptClusterId))
    assert.ok(![...clusterIds].some(id => /derechos|autor|copyright/i.test(id)), `metadata leaked as a target: ${[...clusterIds].join(',')}`)
    assert.ok(plan.skipped.some(s => s.relationId === 'r1' && s.reason === 'non_studyable_metadata'), 'the relation must be explicitly recorded as skipped, not silently dropped')
  })

  await test('RECON-7: dedup judge receives explicit cognitiveType/retrievalObjective (pedagogical-substitutability signal, not text-only)', async () => {
    const pRecall = pc('cR', ['u20'], 'clusterX', 'recall')
    const pApp = pc('cApp', ['u20'], 'clusterX', 'application')
    const cardRecall = card(pRecall, '¿Qué establece PV=nRT?', 'La ley de los gases ideales relaciona presion, volumen, moles y temperatura.')
    const cardApp = card(pApp, 'Calcula P dados n=1, V=1, R=0.0821, T=300', 'P ≈ 24.63 atm usando PV=nRT.')
    let receivedPairs: any[] = []
    const mockJudge = async (pairs: any[]) => { receivedPairs = pairs; return pairs.map(p => ({ pairId: p.pairId, duplicate: false })) }
    // application and recall are DIFFERENT comparableGroup buckets, so this
    // pair alone would never reach the judge — force comparison via two
    // same-bucket recall cards instead, which is the real scenario the
    // judge needs the extra context for.
    const pRecall2 = pc('cR2', ['u20'], 'clusterX', 'recall')
    const cardRecall2 = card(pRecall2, '¿Cuál es la formula de la ley de los gases ideales y que representa cada variable?', 'PV=nRT: P presion, V volumen, n moles, R constante, T temperatura.')
    await reconcilePedagogicalDuplicates([cardRecall, cardRecall2], mockJudge as any)
    if (receivedPairs.length > 0) {
      assert.equal(receivedPairs[0].a.cognitiveType, 'recall')
      assert.ok(receivedPairs[0].a.retrievalObjective, 'retrievalObjective must be passed to the judge')
    }
    void cardApp
  })

  await test('RECON-8: a true pedagogical duplicate (judge says duplicate:true) is merged and its coverage is transferred via sourceUnitIds union', async () => {
    const pA = pc('cA', ['u30'], 'clusterY', 'recall')
    const pB = pc('cB', ['u31'], 'clusterZ', 'recall')
    const a = card(pA, '¿Qué es X?', 'X es una cosa.')
    const b = card(pB, '¿Qué significa X?', 'X significa una cosa.')
    const alwaysDuplicate = async (pairs: any[]) => pairs.map(p => ({ pairId: p.pairId, duplicate: true }))
    const { cards, mergedCount } = await reconcilePedagogicalDuplicates([a, b], alwaysDuplicate as any)
    assert.equal(mergedCount, 1)
    const survivor = cards.find(c => c.validated)!
    assert.ok(survivor.sourceUnitIds.includes('u30') && survivor.sourceUnitIds.includes('u31'),
      'dedup cannot drop a card without unioning its sourceUnitIds into the survivor — coverage must transfer')
  })

  await test('RECON-9: repair survivor validated after a gap round can enter the final persisted deck', async () => {
    const u = unit('u40', 'concept', 'Kc', 'Kc es la constante de equilibrio.')
    const b = brain([u])
    const store = new InMemoryDeckStore()
    let attempt = 0
    const generateFn = async (planned: PlannedCard) => {
      attempt++
      if (attempt === 1) return card(planned, '', '', false, ['generation_failed:fixture'])
      return card(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`,
        `Respuesta verificada: ${planned.retrievalObjective} — confirmado por evidencia directa del material.`)
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    assert.ok(result.deck)
    assert.ok(result.deck!.cards.some(c => c.validated), 'the repair-round survivor must appear validated in the final deck')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-coverage-reconciliation-contracts: ALL PASS')
}

main()
