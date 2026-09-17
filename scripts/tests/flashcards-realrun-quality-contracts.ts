import assert from 'node:assert/strict'
import { validateDeck } from '../../lib/materialBrain/flashcards/validate'
import type { GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Reproduces the EXACT real-deck failure classes reported after the
// Material Brain coverage-loss fix (which is confirmed no longer the
// bottleneck): weak/trivial questions that survived validation in a
// real 43-page chemistry deck (70 targets -> 33 cards). Each test
// below is a direct regression for one quoted real example.
// ============================================================

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: extra.canonicalSubject ?? label, semanticKey: extra.semanticKey ?? label, qualifiers: extra.qualifiers || [] },
    importance: { tier: 'supporting', signals: ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    evidence: [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: statement, chunkId: 'c-1' }],
    domainTags: [],
    ...extra,
  } as any
}
function brain(units: KnowledgeUnit[]): MaterialBrain {
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-real' },
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 }, llmCallsUsed: 0, retries: 0, status: 'ready',
    },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}
function pc(id: string, sourceUnitIds: string[], objective = id): PlannedCard {
  return { id, sourceUnitIds, sourceRelationIds: [], retrievalObjective: objective, cognitiveType: 'recall', rationale: 'r', conceptClusterId: 'cluster-' + id }
}
function fakeCard(planned: PlannedCard, question: string, answer: string): GeneratedFlashcard {
  return { ...planned, question, answer, provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: true, validationErrors: [] }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards real-run quality regressions ──\n')

  await test('REAL-1: "¿Qué tema introduce el material?" is rejected (document-scope question, not metadata)', () => {
    const u = unit('u1', 'concept', 'Equilibrio quimico', 'El equilibrio quimico se alcanza cuando las velocidades se igualan.')
    const b = brain([u])
    const p = pc('c1', ['u1'])
    const card = fakeCard(p, '¿Qué tema introduce el material?', 'El equilibrio quimico.')
    const plan = { plannedCards: [p], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any
    const result = validateDeck([card], plan, b)
    assert.equal(result[0].validated, false)
    assert.ok(result[0].validationErrors.includes('non_studyable_document_scope_question'))
  })

  await test('REAL-2: "¿Qué se debe calcular para la reacción dada a 448 °C?" is rejected (obligation-modal vague procedure)', () => {
    const u = unit('u2', 'process', 'Calculo de concentraciones', 'Para calcular las concentraciones de equilibrio se usa una tabla ICE.')
    const b = brain([u])
    const p = pc('c2', ['u2'])
    const card = fakeCard(p, '¿Qué se debe calcular para la reacción dada a 448 °C?', 'Las concentraciones en el equilibrio.')
    const plan = { plannedCards: [p], targetedUnitIds: ['u2'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any
    const result = validateDeck([card], plan, b)
    assert.equal(result[0].validated, false)
    assert.ok(result[0].validationErrors.includes('low_information_value'))
  })

  await test('REAL-3: "¿Cómo se relaciona \'Aproximación al equilibrio\' con \'Concepto de equilibrio\'?" is rejected (internal label leakage)', () => {
    const u1 = unit('u3', 'concept', 'Aproximación al equilibrio', 'El sistema se aproxima al equilibrio desde reactivos o productos.')
    const u2 = unit('u4', 'concept', 'Concepto de equilibrio', 'El equilibrio quimico es un estado dinamico donde las velocidades se igualan.')
    const b = brain([u1, u2])
    const p = pc('c3', ['u3', 'u4'])
    const card = fakeCard(p, "¿Cómo se relaciona 'Aproximación al equilibrio' con 'Concepto de equilibrio'?", 'Ambos describen el mismo estado dinamico.')
    const plan = { plannedCards: [p], targetedUnitIds: ['u3', 'u4'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any
    const result = validateDeck([card], plan, b)
    assert.equal(result[0].validated, false)
    assert.ok(result[0].validationErrors.includes('internal_label_leakage'))
  })

  await test('REAL-4: legitimate direct questions mentioning "el material" as chemistry substance are NOT falsely rejected', () => {
    const u = unit('u5', 'fact', 'Material del electrodo', 'El material del electrodo es platino inerte en esta celda.')
    const b = brain([u])
    const p = pc('c4', ['u5'])
    const card = fakeCard(p, '¿Cuál es el material del electrodo en esta celda?', 'Platino inerte.')
    const plan = { plannedCards: [p], targetedUnitIds: ['u5'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any
    const result = validateDeck([card], plan, b)
    assert.equal(result[0].validated, true, `should not be falsely rejected: ${result[0].validationErrors.join(',')}`)
  })

  await test('REAL-5: a comparison question with NO quoted labels (natural phrasing) is NOT falsely rejected', () => {
    const u1 = unit('u6', 'concept', 'Kc', 'Kc es la constante de equilibrio en terminos de concentraciones.')
    const u2 = unit('u7', 'concept', 'Kp', 'Kp es la constante de equilibrio en terminos de presiones parciales.')
    const b = brain([u1, u2])
    const p = pc('c5', ['u6', 'u7'])
    const card = fakeCard(p, '¿Cómo se relacionan Kc y Kp mediante la temperatura y el cambio en moles de gas?', 'La relacion es $K_p = K_c(RT)^{\\Delta n}$.')
    const plan = { plannedCards: [p], targetedUnitIds: ['u6', 'u7'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any
    const result = validateDeck([card], plan, b)
    assert.equal(result[0].validated, true, `should not be falsely rejected: ${result[0].validationErrors.join(',')}`)
  })

  await test('REAL-6: a general-principle question using "el sistema"/"la reacción" (no specific instance) is NOT falsely rejected by the scope gate', () => {
    const u = unit('u8', 'concept', 'Principio de Le Chatelier', 'El sistema se desplaza para contrarrestar la perturbacion aplicada.')
    const b = brain([u])
    const p = pc('c6', ['u8'])
    const card = fakeCard(p, '¿Qué hace el sistema al aplicar una perturbación segun Le Chatelier?', 'Se desplaza para contrarrestarla.')
    const plan = { plannedCards: [p], targetedUnitIds: ['u8'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any
    const result = validateDeck([card], plan, b)
    assert.equal(result[0].validated, true, `should not be falsely rejected: ${result[0].validationErrors.join(',')}`)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-realrun-quality-contracts: ALL PASS')
}

main()
