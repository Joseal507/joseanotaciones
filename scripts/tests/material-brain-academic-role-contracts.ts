import assert from 'node:assert/strict'
import { classifyAcademicRole, resolveAcademicRole } from '../../lib/materialBrain/academicRole'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { validateDeck, computeDeckCoverage } from '../../lib/materialBrain/flashcards/validate'
import type { FlashcardPlan, GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Contract suite: Material Brain is the SOLE authority for
// academic_content vs. document_metadata classification. Flashcards
// (planner/validator) must consume unit.academicRole /
// resolveAcademicRole() only — never re-classify SOURCE content with
// their own text-pattern heuristics. Regression target: "sk:copyright"
// (a copyright/colophon unit) must never reach generation.
// ============================================================

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}, tier: 'critical' | 'supporting' | 'contextual' = 'supporting'): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: label, semanticKey: label, qualifiers: extra.qualifiers || [] },
    importance: { tier, signals: extra.signals || [], confidence: 0.9 },
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

function fakeCard(planned: PlannedCard, question: string, answer: string): GeneratedFlashcard {
  return {
    ...planned, question, answer, provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(),
    validated: false, validationErrors: [],
  }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Material Brain academicRole authority contracts ──\n')

  await test('ROLE-1: legitimate academic unit classifies as academic_content and becomes a planner target', () => {
    const u = unit('u-content', 'concept', 'Constante Kc', 'Kc expresa la relación de concentraciones en el equilibrio químico.')
    assert.equal(classifyAcademicRole(u), 'academic_content')
    const plan = planFlashcards(brain('role-1', [u]))
    assert.equal(plan.plannedCards.length, 1, 'academic content must produce a PlannedCard')
    assert.ok(plan.plannedCards[0].sourceUnitIds.includes('u-content'))
  })

  await test('ROLE-2 (sk:copyright regression): a copyright/colophon unit classifies as document_metadata and is excluded BEFORE generation', () => {
    const u = unit('sk:copyright', 'fact', 'Copyright', '© 2024 Editorial Universitaria. Todos los derechos reservados.')
    assert.equal(classifyAcademicRole(u), 'document_metadata')
    const plan = planFlashcards(brain('role-2', [u]))
    assert.equal(plan.plannedCards.length, 0, 'document_metadata must never become a PlannedCard')
    assert.equal(plan.targetedUnitIds.length, 0, 'must never enter the coverage denominator')
    assert.ok(plan.skipped.some(s => s.unitId === 'sk:copyright' && s.reason === 'non_studyable_metadata'))
  })

  await test('ROLE-3: legacy unit without academicRole falls back to resolveAcademicRole (runtime classification)', () => {
    const legacy: any = unit('legacy-copyright', 'fact', 'Copyright', 'Copyright © 2024 Editorial Universitaria.')
    delete legacy.academicRole
    assert.equal(legacy.academicRole, undefined)
    assert.equal(resolveAcademicRole(legacy), 'document_metadata')
    const plan = planFlashcards(brain('role-3', [legacy]))
    assert.equal(plan.plannedCards.length, 0, 'legacy unit must still be excluded via the runtime resolver')
  })

  await test('ROLE-4: unknown academicRole is treated as eligible, never silently as metadata', () => {
    const u: any = unit('u-unknown', 'concept', 'X', 'Some studyable statement about X.')
    u.academicRole = 'unknown'
    assert.equal(resolveAcademicRole(u), 'unknown', 'an explicit unit.academicRole must be trusted as-is (no re-classification)')
    const plan = planFlashcards(brain('role-4', [u]))
    assert.equal(plan.plannedCards.length, 1, 'unknown must remain eligible for planning — no silent loss of content')
  })

  await test('ROLE-5: a metadata-only source never reaches generation (0 PlannedCards => 0 generation calls, by construction)', () => {
    const u = unit('u-meta-only', 'fact', 'ISBN', 'ISBN 978-0-000000-00-0, primera edición, 2015.')
    const plan = planFlashcards(brain('role-5', [u]))
    assert.equal(plan.plannedCards.length, 0)
    // deckStore only calls generateFn/generateBatchFn over plan.plannedCards —
    // an empty plannedCards set for this unit structurally guarantees zero
    // provider calls for it, with no separate mock required.
  })

  await test('ROLE-6: taught academic content that merely mentions a metadata-adjacent topic is NOT falsely excluded', () => {
    const u = unit(
      'u-copyright-law',
      'concept',
      'Derecho de autor',
      'El derecho de autor protege las obras originales durante la vida del autor más 70 años.',
      { domainTags: ['Law'], signals: ['declared_in_material', 'exam_marked'] },
      'critical',
    )
    assert.equal(classifyAcademicRole(u), 'academic_content', 'a course genuinely teaching copyright law must not be excluded as document colophon')
    const plan = planFlashcards(brain('role-6', [u]))
    assert.equal(plan.plannedCards.length, 1)
  })

  await test('ROLE-7: a generated card that is self-referential about the document is still rejected by validate.ts (card-shape gate unaffected)', () => {
    const u = unit('u-real', 'fact', 'Contenido real', 'contenido academico real')
    const plan: FlashcardPlan = { plannerVersion: '1.0.0', plannedCards: [], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] } as any
    const pcard: PlannedCard = { id: 'c-selfref', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' } as any
    const b = brain('role-7', [u])
    const validated = validateDeck(
      [fakeCard(pcard, '¿A quién pertenece el copyright de este material?', 'Pertenece a la editorial.')],
      plan, b,
    )
    assert.ok(!validated[0].validated)
    assert.ok(validated[0].validationErrors.includes('non_studyable_document_metadata'))
  })

  await test('ROLE-8: normal deck coverage for an all-academic-content plan is unaffected', () => {
    const units = [
      unit('u-a', 'concept', 'Fotosíntesis', 'La fotosíntesis convierte luz solar en energía química en las plantas.'),
      unit('u-b', 'concept', 'Mitosis', 'La mitosis es el proceso de división celular que produce células idénticas.'),
    ]
    const b = brain('role-8', units)
    const plan = planFlashcards(b)
    assert.equal(plan.plannedCards.length, 2)
    const generated: GeneratedFlashcard[] = plan.plannedCards.map(pc =>
      ({ ...fakeCard(pc, `Q for ${pc.sourceUnitIds[0]}`, 'A'), validated: true }))
    const coverage = computeDeckCoverage(generated, plan)
    assert.equal(coverage.status, 'complete')
    assert.equal(coverage.metrics.coveredConcepts, coverage.metrics.targetedConcepts)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('material-brain-academic-role-contracts: ALL PASS')
}

main()
