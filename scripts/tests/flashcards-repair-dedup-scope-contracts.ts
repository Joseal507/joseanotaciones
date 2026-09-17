import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import { reconcileRepairCandidates, type PedagogicalJudgeFn } from '../../lib/materialBrain/flashcards/pedagogicalDedup'
import type { FlashcardDeckStore, PlannedCard, GeneratedFlashcard } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

// ============================================================
// FASE 1 (P0 mission — "FIX DE SCOPE DE DEDUP DURANTE REPAIR").
//
// Real-deck evidence: a repair round re-ran FULL-DECK pedagogical dedup
// (reconcilePedagogicalDuplicates over the ENTIRE accepted pool) on
// every round, accounting for the majority of a measured 67,146ms dedup
// cost across a 90.7s run. This suite proves the replacement contract:
// exactly ONE full-deck dedup pass per generation (fullDeckDedupRuns
// === 1), regardless of how many repair rounds run; every repair round
// instead dedupes ONLY its new candidates against each other and a
// NEIGHBOR subset of the accepted deck (same conceptClusterId or shared
// source ids) — never the whole pool, never O(N) or O(N²) in total deck
// size for the repair path.
// ============================================================

class InMemoryDeckStore implements FlashcardDeckStore {
  map = new Map<string, any>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, deck: any) { this.map.set(fp, deck) }
}

function scopeFor(materialIds: string[]) { return buildSourceSelectionSnapshot(materialIds, {}) }
function unit(id: string, label: string, statement: string, extra: any = {}): KnowledgeUnit {
  return {
    id, kind: 'concept', label, statement,
    identity: { canonicalSubject: extra.canonicalSubject ?? label, semanticKey: extra.semanticKey ?? label.toLowerCase(), qualifiers: extra.qualifiers || [] },
    importance: { tier: extra.tier || 'critical', signals: extra.signals || ['declared_in_material'], confidence: 1 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'chunk-1' }],
    domainTags: extra.domainTags || [],
    ...extra,
  } as any
}
function brain(units: KnowledgeUnit[], fingerprint = 'fp-repair-dedup'): MaterialBrain {
  return {
    scope: { ...scopeFor(['mat-a']), fingerprint },
    meta: { version: '1.0.0', builderVersion: '1.0.0', generatedAt: new Date().toISOString(), chunking: { strategy: 'test', chunkSizeChars: 0, chunkCount: 0 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    knowledgeExtraction: { chunksAttempted: 0, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}
function pc(id: string, sourceUnitIds: string[], clusterId = 'cluster-' + id): PlannedCard {
  return { id, sourceUnitIds, sourceRelationIds: [], retrievalObjective: id, cognitiveType: 'recall', rationale: 'r', conceptClusterId: clusterId }
}
function card(planned: PlannedCard, question: string, answer: string, validated = true, errors: string[] = []): GeneratedFlashcard {
  return { ...planned, question, answer, provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated, validationErrors: errors }
}
function bulkAcceptedCard(i: number): GeneratedFlashcard {
  const p = pc(`bulk-${i}`, [`u-bulk-${i}`], `cluster-bulk-${i}`)
  return card(p, `Pregunta ${i} totalmente distinta sobre un tema propio.`, `Respuesta ${i} distinta con contenido propio suficiente sustancial.`)
}

const TRACE_DIR = path.join(process.cwd(), '.debug', 'flashcards-traces')

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards repair-dedup scope contracts (FASE 1) ──\n')
  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  // ── Case A: 50+ existing valid cards + 1 pending target ─────────────
  await test('CASE-A: a repair round with 50+ accepted cards never runs full-deck dedup — only relevant neighbors are considered', async () => {
    const existing = Array.from({ length: 55 }, (_, i) => bulkAcceptedCard(i))
    const newTarget = pc('repaired-1', ['u-repaired-1'], 'cluster-repaired-1')
    const newCandidate = card(newTarget, 'Pregunta nueva completamente distinta.', 'Respuesta nueva completamente distinta y sustancial.')
    const result = await reconcileRepairCandidates([newCandidate], existing)
    assert.equal(result.diagnostics.existingNeighborCardsConsidered, 0, 'no existing card shares conceptClusterId/sourceUnitIds with the new candidate — none should be considered a neighbor')
    assert.equal(result.diagnostics.candidatePairs, 0, 'zero neighbor candidates means zero comparisons — never 55 comparisons')
    assert.equal(result.cards.length, 56, 'the new valid candidate must be added alongside all 55 untouched existing cards')
  })

  // ── Case B: repaired card duplicates a relevant existing card ───────
  await test('CASE-B: a repaired card duplicating a relevant existing neighbor is detected, not added as a redundant card, and coverage reconciles via the existing survivor', async () => {
    const existingNeighbor = card(pc('existing-1', ['u-shared'], 'cluster-shared'), 'Pregunta sobre X', 'La velocidad directa iguala la velocidad inversa en el equilibrio.')
    const unrelated = bulkAcceptedCard(0)
    const newTarget = pc('repaired-2', ['u-shared'], 'cluster-shared') // SAME conceptClusterId -> neighbor
    const newCandidate = card(newTarget, 'Pregunta sobre X repetida', 'La velocidad directa iguala la velocidad inversa en el equilibrio.')
    const alwaysDuplicate: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true }))
    const result = await reconcileRepairCandidates([newCandidate], [existingNeighbor, unrelated], alwaysDuplicate)
    assert.equal(result.mergedCount, 1)
    assert.ok(!result.cards.some(c => c.id === newCandidate.id), 'the new duplicate candidate must never be added as a separate card')
    const survivor = result.cards.find(c => c.id === existingNeighbor.id)
    assert.ok(survivor, 'the existing card must remain the survivor')
    assert.ok(survivor!.sourceUnitIds.includes('u-shared'), 'the survivor keeps covering the shared source')
  })

  // ── Case C: repaired card is genuinely distinct ──────────────────────
  await test('CASE-C: a genuinely distinct repaired card is incorporated and coverage increases', async () => {
    const existingNeighbor = card(pc('existing-2', ['u-shared2'], 'cluster-shared2'), 'Pregunta sobre Y', 'El catalizador acelera ambas reacciones por igual.')
    const newTarget = pc('repaired-3', ['u-shared2-other'], 'cluster-shared2')
    const newCandidate = card(newTarget, 'Pregunta totalmente distinta sobre Z', 'La constante de equilibrio Kc depende solo de la temperatura del sistema.')
    const neverDuplicate: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: false }))
    const result = await reconcileRepairCandidates([newCandidate], [existingNeighbor], neverDuplicate)
    assert.equal(result.mergedCount, 0)
    assert.ok(result.cards.some(c => c.id === newCandidate.id), 'the distinct new candidate must be incorporated')
    assert.equal(result.cards.length, 2)
  })

  // ── Case D: repair candidate in a different conceptCluster ──────────
  await test('CASE-D: a repair candidate in an unrelated conceptCluster is never compared against unrelated existing cards', async () => {
    const unrelatedA = card(pc('existing-3a', ['u-unrelated-a'], 'cluster-unrelated-a'), 'Q-A', 'A-A')
    const unrelatedB = card(pc('existing-3b', ['u-unrelated-b'], 'cluster-unrelated-b'), 'Q-B', 'A-B')
    const newTarget = pc('repaired-4', ['u-own'], 'cluster-own')
    const newCandidate = card(newTarget, 'Q-new', 'A-new')
    let judgeCalls = 0
    const countingJudge: PedagogicalJudgeFn = async pairs => { judgeCalls++; return pairs.map(p => ({ pairId: p.pairId, duplicate: false })) }
    const result = await reconcileRepairCandidates([newCandidate], [unrelatedA, unrelatedB], countingJudge)
    assert.equal(result.diagnostics.existingNeighborCardsConsidered, 0, 'neither unrelated card shares conceptClusterId or any sourceUnitId with the new candidate')
    assert.equal(result.diagnostics.candidatePairs, 0)
    assert.equal(judgeCalls, 0, 'no provider call should ever be needed when there is nothing to compare against')
  })

  // ── Case E: 2 repair rounds — full deck dedup = 1, each round = delta ─
  await test('CASE-E: with 2 repair rounds, fullDeckDedupRuns stays 1 and each round is delta-scoped, never full-pool', async () => {
    const uA = unit('uA', 'A', 'stmt a')
    const uB = unit('uB', 'B', 'stmt b')
    const uC = unit('uC', 'C', 'stmt c')
    const b = brain([uA, uB, uC])
    const store = new InMemoryDeckStore()
    const attemptByCard: Record<string, number> = {}
    const generateFn = async (planned: PlannedCard) => {
      attemptByCard[planned.id] = (attemptByCard[planned.id] || 0) + 1
      // uC needs 2 attempts to succeed (round 0 fails, round 1 succeeds); uA/uB succeed immediately.
      if (planned.sourceUnitIds.includes('uC') && attemptByCard[planned.id] === 1) {
        return card(planned, '', '', false, ['broken_academic_content'])
      }
      return card(planned, `Con base en el material autorizado, que establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} confirmado por evidencia directa del material.`)
    }
    let savedPath = ''
    const origLog = console.log
    console.log = (...args: any[]) => {
      const line = args.join(' ')
      if (line.includes('FLASHCARDS_TRACE_SAVED')) savedPath = JSON.parse(line.replace(/^.*FLASHCARDS_TRACE_SAVED\s*/, '')).path
      origLog(...args)
    }
    try {
      await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    } finally {
      console.log = origLog
    }
    assert.ok(savedPath, 'trace must have been persisted')
    const fileContent = JSON.parse(await readFile(savedPath, 'utf8'))
    const d = fileContent.dedupDiagnostics
    assert.equal(d.fullDeckDedupRuns, 1, `full-deck dedup must run exactly once regardless of repair rounds, got ${d.fullDeckDedupRuns}`)
    assert.ok(d.initialDedup.poolSize >= 3, 'initial dedup must have covered the initial pool')
    assert.ok(Array.isArray(d.repairDedupRounds) && d.repairDedupRounds.length >= 1, 'at least one repair round must be recorded as delta dedup')
    for (const round of d.repairDedupRounds) {
      assert.ok(round.newCards <= 1, `each repair round here regenerates only the single pending target, got ${round.newCards}`)
    }
  })

  // ── Case F: coverage monotonicity through the delta-dedup path ──────
  await test('CASE-F: a repair round that would duplicate/regress never decreases coverage below coverage_before', async () => {
    const uX = unit('uX', 'Igualdad de velocidades', 'En el equilibrio, la velocidad directa iguala a la velocidad inversa.')
    const uY = unit('uY', 'Cociente de reaccion', 'El cociente Q se compara con Kc para predecir el sentido del cambio.')
    const b = brain([uX, uY])
    const store = new InMemoryDeckStore()
    const generateFn = async (planned: PlannedCard) => {
      if (planned.sourceUnitIds.includes('uX')) {
        return card(planned, '¿Qué establece la igualdad de velocidades en el equilibrio?', 'La velocidad directa iguala a la velocidad inversa, con evidencia directa del material.')
      }
      return card(planned, '', '', false, ['broken_academic_content'])
    }
    const result = await getOrBuildFlashcardDeck(b, store, { generateFn: generateFn as any })
    const xCard = result.deck!.cards.find(c => c.sourceUnitIds.includes('uX'))
    assert.ok(xCard && xCard.validated, 'coverage for X must never regress because Y kept failing across repair rounds')
    assert.ok(result.deck!.coverage.coveredConceptClusterIds.length >= 1)
  })

  // ── Case G: provider-call scaling depends on delta, not on deck size ─
  await test('CASE-G: repair-dedup provider calls scale with the delta/neighbor set, NOT with total deck size N', async () => {
    const bigExisting = Array.from({ length: 200 }, (_, i) => bulkAcceptedCard(i))
    // Exactly 2 of the 200 existing cards are genuine neighbors of the new candidate.
    const neighbor1 = card(pc('neighbor-1', ['u-scale-shared'], 'cluster-scale'), 'Q-n1', 'A-n1 con contenido propio suficiente para no colisionar por accidente.')
    const neighbor2 = card(pc('neighbor-2', ['u-scale-shared'], 'cluster-scale'), 'Q-n2', 'A-n2 con contenido diferente y propio suficiente para no colisionar por accidente.')
    const existing = [...bigExisting, neighbor1, neighbor2]
    const newTarget = pc('repaired-scale', ['u-scale-shared'], 'cluster-scale')
    const newCandidate = card(newTarget, 'Q-nueva', 'A-nueva parcialmente relacionada con contenido propio suficiente.')
    let judgeCallCount = 0
    let totalPairsSentToJudge = 0
    const countingJudge: PedagogicalJudgeFn = async pairs => {
      judgeCallCount++
      totalPairsSentToJudge += pairs.length
      return pairs.map(p => ({ pairId: p.pairId, duplicate: false }))
    }
    const result = await reconcileRepairCandidates([newCandidate], existing, countingJudge)
    assert.equal(result.diagnostics.existingNeighborCardsConsidered, 2, `only the 2 genuine neighbors must be considered, not all 202 existing cards, got ${result.diagnostics.existingNeighborCardsConsidered}`)
    assert.ok(result.diagnostics.candidatePairs <= 3, `candidate pairs must be bounded by neighbor count (<=2 NEW-vs-existing + 0 NEW-vs-NEW), got ${result.diagnostics.candidatePairs}`)
    assert.ok(totalPairsSentToJudge <= 3, `provider call volume must depend on the delta (2 neighbors), never on N=200, got ${totalPairsSentToJudge} pairs sent`)
  })

  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-repair-dedup-scope-contracts: ALL PASS')
}

main()
