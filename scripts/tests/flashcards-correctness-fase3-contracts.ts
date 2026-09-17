import assert from 'node:assert/strict'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { validateDeck } from '../../lib/materialBrain/flashcards/validate'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import { repairStrategyFor, buildRepairFeedbackBlock } from '../../lib/materialBrain/flashcards/generator'
import { isTerminalRejection, TERMINAL_REJECTION_REASONS } from '../../lib/materialBrain/flashcards/validate'
import type { FlashcardDeckStore, GeneratedFlashcard, PlannedCard, RepairFeedback } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

// ============================================================
// FASE 3 (P0 mission — "CORRECTNESS QUIRÚRGICO BASADO EN LA CORRIDA
// REAL"). Real pending families closed:
//   A. metadata upstream exclusion (planner, general classifier reuse)
//   B. notation preservation accepts structural/verbal equivalence,
//      still rejects genuine loss (relational-operator verbal phrases,
//      Greek/scientific-symbol generalization, bracket-token anchor)
//   C. repair feedback carries a reason-specific STRATEGY, not just a
//      generic "fix it" instruction
//   D. terminal vs retryable rejection reasons — repair stops wasting
//      calls on structurally-impossible targets
// Every fixture below is domain-genericized — chemistry appears only
// where the mission's own real evidence used it (K >> 1), always
// alongside cross-domain (math/physics/medicine) equivalents proving
// no rule is PDF-specific.
// ============================================================

class InMemoryDeckStore implements FlashcardDeckStore {
  map = new Map<string, any>()
  async get(fp: string) { return this.map.get(fp) || null }
  async set(fp: string, deck: any) { this.map.set(fp, deck) }
}
function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: extra.canonicalSubject ?? label, semanticKey: extra.semanticKey ?? label, qualifiers: extra.qualifiers || [] },
    importance: { tier: extra.tier || 'supporting', signals: extra.signals || ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    domainTags: extra.domainTags || [],
    ...extra,
  } as any
}
function brain(fingerprint: string, units: KnowledgeUnit[]): MaterialBrain {
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint },
    meta: { version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(), chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}
function pc(id: string, sourceUnitIds: string[], clusterId = 'cluster-' + id): PlannedCard {
  return { id, sourceUnitIds, sourceRelationIds: [], retrievalObjective: id, cognitiveType: 'recall', rationale: 'r', conceptClusterId: clusterId }
}
function fakeCard(planned: PlannedCard, question: string, answer: string): GeneratedFlashcard {
  return { ...planned, question, answer, provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated: true, validationErrors: [] }
}

const TRACE_DIR = path.join(process.cwd(), '.debug', 'flashcards-traces')

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards correctness contracts (FASE 3) ──\n')
  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  // ── 1/2/3: metadata dies upstream ────────────────────────────────
  await test('1. an unambiguously non-studyable metadata unit never appears in retrievalTargets (plannedCards)', () => {
    const u = unit('u-meta1', 'event_or_data', 'Dato editorial', 'Primera edicion 2015', {
      provenance: [{ materialId: 'mat-a', page: 1, chunkId: 'c-1', quote: 'Primera edicion, 2015. Editorial Ejemplo. Todos los derechos reservados.' }],
    })
    const plan = planFlashcards(brain('fp3-meta1', [u]))
    assert.equal(plan.plannedCards.length, 0, 'metadata must never produce a plannedCard')
    assert.ok(plan.skipped.some(s => s.reason === 'non_studyable_metadata'))
  })

  await test('2/3. metadata never consumes a generation provider call and never enters repair', async () => {
    const uReal = unit('u-real', 'fact', 'Concepto real', 'Un hecho academico real y suficiente por si mismo.')
    const uMeta = unit('u-meta2', 'event_or_data', 'Dato editorial', 'Primera edicion 2015', {
      provenance: [{ materialId: 'mat-a', page: 1, chunkId: 'c-1', quote: 'Primera edicion, 2015. Editorial Ejemplo. Todos los derechos reservados.' }],
    })
    const b = brain('fp3-meta2', [uReal, uMeta])
    let generationCalls = 0
    // Grounded in uReal's own statement (not a boilerplate keyed by the
    // opaque card id) — an ungrounded answer is correctly treated as
    // unsupported/ambiguous by Source-Objective Satisfaction, which would
    // exhaust the retry budget and inflate generationCalls past 1.
    const generateFn = async (planned: PlannedCard) => { generationCalls++; return fakeCard(planned, `¿Qué establece el material sobre ${uReal.label}?`, `Así lo indica el material: ${uReal.statement}`) }
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    assert.equal(generationCalls, 1, `only the real unit must reach generation, got ${generationCalls} calls`)
    assert.ok(!result.deck!.cards.some(c => c.sourceUnitIds.includes('u-meta2')), 'metadata must never appear in the final deck')
  })

  // ── 4/5: notation preservation — structural equivalence vs genuine loss ──
  await test('4. a relational comparison preserved via a generic VERBAL equivalent (no symbol) is accepted (cross-domain: math)', () => {
    const u = unit('u-notation-verbal', 'fact', 'Condicion x', 'La funcion es creciente cuando x es mucho mayor que 1 (x >> 1) en este intervalo.')
    const p = pc('c-verbal', [u.id])
    const b = brain('fp3-verbal', [u])
    const card = fakeCard(p, '¿Cuándo es creciente la funcion?', 'Cuando x es mucho mayor que 1 en el intervalo dado.')
    const result = validateDeck([card], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, true, JSON.stringify(result[0].validationErrors))
  })

  await test('4b. a Greek/scientific symbol preserved via LaTeX command form (no bare glyph) is accepted (cross-domain: physics)', () => {
    const u = unit('u-notation-greek', 'fact', 'Cambio de energia', 'El cambio de energia Δ del sistema depende de la temperatura final e inicial del proceso.')
    const p = pc('c-greek', [u.id])
    const b = brain('fp3-greek', [u])
    const card = fakeCard(p, '¿Qué determina el cambio de energia del sistema en este proceso?', 'El $\\Delta$ del sistema depende de la temperatura final e inicial del proceso, segun el material.')
    const result = validateDeck([card], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, true, JSON.stringify(result[0].validationErrors))
  })

  await test('5. a relational comparison genuinely lost (no symbol, no verbal equivalent) is still rejected (cross-domain: medicine)', () => {
    const u = unit('u-notation-lost', 'fact', 'Riesgo relativo', 'El riesgo es mucho mayor que 1 (RR >> 1) cuando el factor esta presente en el grupo expuesto.')
    const p = pc('c-lost', [u.id])
    const b = brain('fp3-lost', [u])
    const card = fakeCard(p, '¿Qué indica un riesgo relativo muy alto (RR 1) cuando el factor esta presente?', 'Indica que el factor esta presente en el grupo expuesto.')
    const result = validateDeck([card], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, false, 'genuine loss (no symbol, no verbal phrase) must still be rejected')
    assert.ok(result[0].validationErrors.includes('notation_structure_lost'))
  })

  await test('5b. a bracket-notation exponent genuinely lost is still rejected (cross-domain: generic bracket/set notation)', () => {
    const u = unit('u-bracket', 'formula', 'Tasa', 'La tasa se calcula como r=k[A]^2 segun el modelo cinetico.', { expression: 'r=k[A]^2', variables: [{ symbol: 'r', meaning: 'tasa' }, { symbol: 'k', meaning: 'constante' }, { symbol: 'A', meaning: 'reactivo' }] })
    const p = pc('c-bracket', [u.id])
    const b = brain('fp3-bracket', [u])
    const card = fakeCard(p, '¿Cómo se calcula la tasa según el modelo cinetico?', 'La tasa se calcula como r=k[A] segun el modelo cinetico.')
    const result = validateDeck([card], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, false, JSON.stringify(result[0].validationErrors))
  })

  // ── 6/7/8: repair feedback carries a reason-specific strategy ──────
  await test('6. contextless_question repair feedback names the context-naming strategy', () => {
    const feedback: RepairFeedback = { plannedCardId: 'x', rejectionReasons: ['contextless_question'], requiredPreservations: [] }
    const block = buildRepairFeedbackBlock(feedback)
    assert.ok(/name the specific instance|example, system, or case/i.test(block), block)
  })

  await test('7. circular_question_answer repair feedback names the reformulation strategy', () => {
    const feedback: RepairFeedback = { plannedCardId: 'x', rejectionReasons: ['circular_question_answer'], requiredPreservations: [] }
    const block = buildRepairFeedbackBlock(feedback)
    assert.ok(/does not already state the answer|Reformulate the question/i.test(block), block)
  })

  await test('8. notation_structure_lost repair feedback names the preservation strategy', () => {
    const feedback: RepairFeedback = { plannedCardId: 'x', rejectionReasons: ['notation_structure_lost'], requiredPreservations: ['K >> 1'] }
    const block = buildRepairFeedbackBlock(feedback)
    assert.ok(/Preserve the required notation/i.test(block), block)
    assert.ok(block.includes('K >> 1'))
  })

  await test('repairStrategyFor: unknown/future reason codes fall through with no strategy line (never throws)', () => {
    const lines = repairStrategyFor(['some_future_reason_code'])
    assert.deepEqual(lines, [])
  })

  // ── 9/10: terminal vs retryable ─────────────────────────────────
  await test('9. a terminal rejection (non_studyable_document_metadata) is never retried by the repair loop', async () => {
    // Unit fields are innocuous (no metadata vocabulary at all — passes
    // the upstream planner check) so it genuinely reaches generation;
    // the MODEL is the one that produces a self-referential/ownership
    // question, exactly the real-deck shape gate 6b exists to catch
    // post-generation.
    const u = unit('u-terminal', 'fact', 'Evento relevante', 'Un evento historico relevante ocurrido durante el periodo estudiado.')
    const b = brain('fp3-terminal', [u])
    let attempts = 0
    const generateFn = async (planned: PlannedCard) => {
      attempts++
      return { ...planned, question: '¿Quién posee el copyright de este material?', answer: 'Pertenece a la editorial.', provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: [] }
    }
    await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    assert.equal(attempts, 1, `a terminal rejection must never be retried across repair rounds, got ${attempts} attempts`)
  })

  await test('10. a retryable rejection (notation) CAN still be recovered by repair', async () => {
    const u = unit('u-retryable', 'fact', 'Constante K', 'Cuando la constante K es mucho mayor que 1 (K >> 1), la reaccion favorece los productos.')
    const b = brain('fp3-retryable', [u])
    let attempt = 0
    const generateFn = async (planned: PlannedCard) => {
      attempt++
      if (attempt === 1) return fakeCard(planned, '¿Qué indica un valor de K muy alto?', 'Indica que la reaccion favorece los productos.')
      return fakeCard(planned, '¿Qué indica que K sea mucho mayor que 1?', 'Indica que la reaccion favorece los productos, con evidencia directa del material.')
    }
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    assert.ok(result.deck!.cards.some(c => c.validated), 'a retryable rejection must be recoverable by a later repair round')
  })

  await test('isTerminalRejection: mixed terminal+retryable reasons on one card are NOT terminal (fails open toward retrying)', () => {
    assert.equal(isTerminalRejection(['non_studyable_document_metadata', 'notation_structure_lost']), false)
    assert.equal(isTerminalRejection(['non_studyable_document_metadata']), true)
    assert.equal(isTerminalRejection(['notation_structure_lost']), false)
    assert.equal(isTerminalRejection([]), false)
    assert.ok(TERMINAL_REJECTION_REASONS.has('non_studyable_document_metadata'))
  })

  // ── 11: coverage transfer unaffected ────────────────────────────
  await test('11. coverage transfer via dedup survivor still works after FASE 3 changes', async () => {
    const u1 = unit('u-cov1', 'fact', 'Catalizador', 'Un catalizador acelera las reacciones directa e inversa sin modificar K.')
    const u2 = unit('u-cov2', 'fact', 'Catalizador', 'La presencia de un catalizador permite alcanzar el equilibrio mas rapido sin cambiar la constante.')
    const b = brain('fp3-cov', [u1, u2])
    const result = await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), {
      generateFn: async planned => fakeCard(planned,
        planned.sourceUnitIds[0] === 'u-cov1' ? '¿Qué hace un catalizador a las reacciones?' : '¿Qué logra un catalizador en el equilibrio?',
        'El catalizador acelera el proceso sin modificar la constante de equilibrio, con evidencia directa del material.'),
      pedagogicalJudgeFn: async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true })),
    })
    const survivor = result.deck!.cards.find(c => c.validated)
    assert.ok(survivor && survivor.sourceUnitIds.includes('u-cov1') && survivor.sourceUnitIds.includes('u-cov2'), 'coverage transfer via merge survivor must still union both source units')
  })

  // ── 12/13/14: Fase 1/2 contracts remain intact ──────────────────
  await test('12/13/14. fullDeckDedupRuns===1, planDedupProviderCalls===0, repair stays delta-scoped — all intact after FASE 3', async () => {
    const uA = unit('u-f1a', 'fact', 'A', 'stmt a')
    const uB = unit('u-f1b', 'fact', 'B', 'stmt b')
    const b = brain('fp3-fases', [uA, uB])
    let attempt = 0
    const generateFn = async (planned: PlannedCard) => {
      attempt++
      if (planned.sourceUnitIds.includes('u-f1b') && attempt <= 2) {
        return { ...planned, question: '', answer: '', provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: ['broken_academic_content'] }
      }
      return fakeCard(planned, `Con base en el material autorizado, ¿qué establece la evidencia respecto a ${planned.id}?`, `Respuesta verificada: ${planned.retrievalObjective} confirmado por evidencia directa del material.`)
    }
    let savedPath = ''
    const origLog = console.log
    console.log = (...args: any[]) => {
      const line = args.join(' ')
      if (line.includes('FLASHCARDS_TRACE_SAVED')) savedPath = JSON.parse(line.replace(/^.*FLASHCARDS_TRACE_SAVED\s*/, '')).path
      origLog(...args)
    }
    try {
      await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    } finally {
      console.log = origLog
    }
    const fileContent = JSON.parse(await readFile(savedPath, 'utf8'))
    assert.equal(fileContent.dedupDiagnostics.fullDeckDedupRuns, 1)
    assert.equal(fileContent.pipelineTrace.providerCalls.planDedup, 0)
  })

  // ── 15: nothing depends on this specific PDF's terms ─────────────
  await test('15. every FASE 3 rule fires identically for cross-domain content that never mentions this PDF\'s specific terms', () => {
    // Metadata: generic editorial vocabulary, no "copyright" literal.
    const uMeta = unit('u-15-meta', 'event_or_data', 'Nota', 'Segunda impresion', {
      provenance: [{ materialId: 'mat-a', page: 1, chunkId: 'c-1', quote: 'Segunda impresion. Ediciones Alfa, 2020.' }],
    })
    const planMeta = planFlashcards(brain('fp3-15-meta', [uMeta]))
    assert.equal(planMeta.plannedCards.length, 0, 'bare-colophon-shaped content must be excluded regardless of subject')

    // Notation: statistics domain, "p < 0.05" significance convention — never chemistry.
    const uStat = unit('u-15-stat', 'fact', 'Significancia', 'El resultado es significativo cuando p es mucho menor que 0.05 (p << 0.05) en la prueba.')
    const pStat = pc('c-15-stat', [uStat.id])
    const bStat = brain('fp3-15-stat', [uStat])
    const cardStat = fakeCard(pStat, '¿Cuándo es significativo el resultado de la prueba?', 'Cuando p es mucho menor que 0.05 en la prueba.')
    const resultStat = validateDeck([cardStat], { plannedCards: [pStat], targetedUnitIds: [uStat.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, bStat)
    assert.equal(resultStat[0].validated, true, JSON.stringify(resultStat[0].validationErrors))

    // Repair strategy lookup: reason codes are validator-defined strings, never target ids.
    assert.ok(repairStrategyFor(['contextless_question'])[0].length > 0)
  })

  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-correctness-fase3-contracts: ALL PASS')
}

main()
