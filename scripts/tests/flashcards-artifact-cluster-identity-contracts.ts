import assert from 'node:assert/strict'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Contract suite: planner.ts's artifactClusters must never consolidate
// (or silently subsume) distinct KnowledgeUnits on shared identity.qualifiers
// alone. Real regression (CLUTCH 2.pdf, "H2, H2, H2"): three genuinely
// different facts about H2 (initial concentration, change, equilibrium
// concentration) all carried qualifiers=["H2"] and were merged into ONE
// consolidated card, producing "En el contexto de H2, H2, H2: ...".
//
// Fix: the cluster key now also requires the SAME normalized statement
// (the same deterministic proposition-equality signal already used
// elsewhere in this module) — shared qualifiers alone is no longer
// sufficient evidence of equivalence. Default: preserve as separate
// PlannedCards unless statements are genuinely identical.
// ============================================================

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}, tier: 'critical' | 'supporting' | 'contextual' = 'supporting'): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: label, semanticKey: label, qualifiers: extra.qualifiers || [] },
    importance: { tier, signals: extra.signals || ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    evidence: [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: statement, chunkId: 'c-1' }],
    domainTags: extra.domainTags || [],
    displayQualifiers: extra.displayQualifiers || extra.qualifiers || [],
    ...extra,
  } as any
}

function brain(fingerprint: string, units: KnowledgeUnit[], relations: any[] = []): MaterialBrain {
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint },
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 }, llmCallsUsed: 0, retries: 0, status: 'ready',
    },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards artifactClusters identity-preservation contracts ──\n')

  await test('A: three distinct facts sharing qualifiers=["H2"] produce 3 separate targets, never 1 consolidated card', () => {
    const units = [
      unit('u-h2-initial', 'event_or_data', 'Concentración inicial de H2', 'La concentración inicial de H2 es 0.5 M.', { qualifiers: ['H2'] }),
      unit('u-h2-change', 'event_or_data', 'Cambio de concentración de H2', 'El cambio de concentración de H2 es -3x.', { qualifiers: ['H2'] }),
      unit('u-h2-equilibrium', 'event_or_data', 'Concentración de H2 en equilibrio', 'La concentración de H2 en equilibrio es 0.5 menos 3x.', { qualifiers: ['H2'] }),
    ]
    const plan = planFlashcards(brain('fp-h2-distinct', units))
    assert.equal(plan.targetedUnitIds.length, 3, 'all three distinct facts must remain independently targetable')
    for (const u of units) {
      assert.ok(!plan.skipped.some(s => s.unitId === u.id), `${u.id} must never be silently subsumed by a sibling sharing only the qualifier`)
    }
    // No card's retrievalObjective should reference more than one of these units at once (no forced consolidation).
    const cardsTouchingH2 = plan.plannedCards.filter(c => c.sourceUnitIds.some(id => units.some(u => u.id === id)))
    for (const c of cardsTouchingH2) {
      const touchedCount = c.sourceUnitIds.filter(id => units.some(u => u.id === id)).length
      assert.ok(touchedCount <= 1, `card ${c.id} must not bundle more than one of the three distinct H2 facts together`)
    }
  })

  await test('B: two units with an identical normalized statement (real duplicate) may still be consolidated', () => {
    const units = [
      unit('u-dup-1', 'fact', 'Dato repetido', 'El catalizador no altera la posición del equilibrio.', { qualifiers: ['catalizador'] }),
      unit('u-dup-2', 'fact', 'Dato repetido otra vez', 'El catalizador no altera la posición del equilibrio.', { qualifiers: ['catalizador'] }),
    ]
    const plan = planFlashcards(brain('fp-real-duplicate', units))
    // Both units are real duplicates (identical normalized statement) —
    // they are allowed to collapse into ONE consolidated retrieval task.
    const consolidated = plan.plannedCards.some(c =>
      c.sourceUnitIds.includes('u-dup-1') && c.sourceUnitIds.includes('u-dup-2'))
    assert.ok(consolidated, 'genuinely identical statements sharing a qualifier are still allowed to consolidate')
  })

  await test('C: same qualifier, different statements (non-critical tier) — never consolidated, never silently dropped', () => {
    const units = [
      unit('u-c1', 'fact', 'Hecho A sobre X', 'X reacciona con Y para formar Z.', { qualifiers: ['sistema-X'] }, 'supporting'),
      unit('u-c2', 'fact', 'Hecho B sobre X', 'La reacción entre X e Y es exotérmica.', { qualifiers: ['sistema-X'] }, 'supporting'),
    ]
    const plan = planFlashcards(brain('fp-same-qualifier-diff-fact', units))
    assert.equal(plan.targetedUnitIds.length, 2, 'both distinct facts must remain targets')
    assert.ok(!plan.skipped.some(s => s.unitId === 'u-c1' || s.unitId === 'u-c2'), 'neither fact may be silently subsumed just for sharing a qualifier with a differently-worded sibling')
  })

  await test('D: academicRole classification is unaffected by this change', () => {
    const units = [
      unit('u-h2-initial-2', 'event_or_data', 'Concentración inicial de H2', 'La concentración inicial de H2 es 0.5 M.', { qualifiers: ['H2'] }),
      unit('u-h2-change-2', 'event_or_data', 'Cambio de concentración de H2', 'El cambio de concentración de H2 es -3x.', { qualifiers: ['H2'] }),
    ]
    const plan = planFlashcards(brain('fp-academicrole-unaffected', units))
    assert.equal(plan.metadataDiagnostics.filter(d => d.metadataPredicateResult).length, 0, 'no unit here is metadata — classification path is untouched by this change')
  })

  await test('E/F: this change can only ever increase or hold plannedCards for a given input, never remove targeted units from coverage denominator', () => {
    const units = [
      unit('u-many-1', 'event_or_data', 'Dato 1 de Z', 'El valor de Z en el punto 1 es 10.', { qualifiers: ['Z'] }),
      unit('u-many-2', 'event_or_data', 'Dato 2 de Z', 'El valor de Z en el punto 2 es 20.', { qualifiers: ['Z'] }),
      unit('u-many-3', 'event_or_data', 'Dato 3 de Z', 'El valor de Z en el punto 3 es 30.', { qualifiers: ['Z'] }),
    ]
    const plan = planFlashcards(brain('fp-many-distinct', units))
    assert.equal(plan.targetedUnitIds.length, 3, 'every distinct unit stays in the coverage denominator — nothing is dropped by over-consolidation')
    assert.ok(plan.plannedCards.length >= 3, 'distinct facts must not be compressed below one PlannedCard each')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-artifact-cluster-identity-contracts: ALL PASS')
}

main()
