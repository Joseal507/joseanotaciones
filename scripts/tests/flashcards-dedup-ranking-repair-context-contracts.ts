import assert from 'node:assert/strict'
import { reconcilePedagogicalDuplicates, type PedagogicalJudgeFn } from '../../lib/materialBrain/flashcards/pedagogicalDedup'
import { validateDeck } from '../../lib/materialBrain/flashcards/validate'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import { buildRepairFeedbackBlock } from '../../lib/materialBrain/flashcards/generator'
import type { FlashcardDeckStore, GeneratedFlashcard, PlannedCard, RepairFeedback } from '../../lib/materialBrain/flashcards/types'
import { FLASHCARD_GENERATOR_VERSION } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

// ============================================================
// P0 mission ("dedup ranking + repair contextless concreto + self-
// containedness semántica + observabilidad") — evidence-driven fixes
// only, guided by the real audited run (68 candidates, 880 pairs, 500
// ambiguous EXACTLY at the cap; sk:temperatura sistema repaired past
// contextless_question with unlisted deictic phrasing). Every fixture
// below is domain-genericized where the mission requires it (Case C5).
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
    displayQualifiers: extra.displayQualifiers || extra.qualifiers || [],
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
function card(id: string, sourceUnitIds: string[], clusterId: string, question: string, answer: string): GeneratedFlashcard {
  return { id, sourceUnitIds, sourceRelationIds: [], retrievalObjective: id, cognitiveType: 'recall', rationale: 'r', conceptClusterId: clusterId, question, answer, provenance: [], generatorVersion: FLASHCARD_GENERATOR_VERSION, generatedAt: new Date().toISOString(), validated: true, validationErrors: [] }
}

const TRACE_DIR = path.join(process.cwd(), '.debug', 'flashcards-traces')

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards dedup-ranking + repair-context + self-containedness contracts ──\n')
  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  // ============================================================
  // FASE A — dedup priority ranking
  // ============================================================

  function buildBigPool(n: number, sharedGroupSize: number) {
    // n cards, all sharing ONE token (so all pairs are ambiguous, well
    // above MAX_AMBIGUOUS_PAIRS=500) — the first `sharedGroupSize` cards
    // ALSO share a sourceUnitId with each other (the priority signal);
    // the rest share nothing but vocabulary.
    const cards: GeneratedFlashcard[] = []
    for (let i = 0; i < n; i++) {
      const sharedSourceUnits = i < sharedGroupSize ? ['u-shared-priority'] : [`u-${i}`]
      cards.push(card(`c${i}`, sharedSourceUnits, `cluster${i}`, `Pregunta ${i}?`, `contenido compartido token${i} unico`))
    }
    return cards
  }

  await test('A1. pairs with shared sourceUnitIds are selected before equivalent pairs without, when >500 candidates compete for the cap', async () => {
    const priorityGroupSize = 20 // C(20,2)=190 pairs, all sharing 'u-shared-priority'
    const pool = buildBigPool(90, priorityGroupSize) // C(90,2)=4005 total ambiguous candidates >> 500
    const alwaysFalse: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: false }))
    const result = await reconcilePedagogicalDuplicates(pool, alwaysFalse)
    const d = result.diagnostics
    assert.ok(d.ambiguousPairsBeforeCap > 500, `fixture must exceed the cap, got ${d.ambiguousPairsBeforeCap}`)
    assert.equal(d.ambiguousPairsAfterCap, 500)
    // ALL 190 priority pairs (sourceUnitId overlap) must have made the cut — they always outrank vocabulary-only pairs.
    const selectedPriorityPairs = d.rankedPairs.filter(p => p.selectedForJudge && p.sharedSourceUnitCount > 0)
    assert.equal(selectedPriorityPairs.length, (priorityGroupSize * (priorityGroupSize - 1)) / 2, `all ${(priorityGroupSize * (priorityGroupSize - 1)) / 2} priority pairs must be selected, got ${selectedPriorityPairs.length}`)
  })

  await test('A2. shared sourceUnitIds never causes auto-merge by itself', async () => {
    const a = card('a1', ['u-shared'], 'clusterA', 'Pregunta totalmente distinta A', 'Respuesta A sin relacion alguna con la otra')
    const b = card('a2', ['u-shared'], 'clusterB', 'Pregunta totalmente distinta B', 'Respuesta B sin relacion alguna con la primera')
    const neverDuplicate: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: false }))
    const result = await reconcilePedagogicalDuplicates([a, b], neverDuplicate)
    assert.equal(result.mergedCount, 0, 'sharing a sourceUnitId must never merge cards on its own — the judge is still the authority')
    assert.equal(result.cards.length, 2)
  })

  await test('A3. MAX_AMBIGUOUS_PAIRS stays exactly 500 regardless of ranking', async () => {
    const pool = buildBigPool(90, 10)
    const alwaysFalse: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: false }))
    const result = await reconcilePedagogicalDuplicates(pool, alwaysFalse)
    assert.equal(result.diagnostics.ambiguousPairsAfterCap, 500)
    assert.ok(result.diagnostics.pairsDroppedByCap > 0)
    assert.equal(result.diagnostics.ambiguousPairsAfterCap + result.diagnostics.pairsDroppedByCap, result.diagnostics.ambiguousPairsBeforeCap)
  })

  await test('A4. provider judge call count does not increase because of ranking', async () => {
    let judgeCallsWithPriority = 0
    let judgeCallsWithoutPriority = 0
    const countingJudge = (counter: { n: number }): PedagogicalJudgeFn => async pairs => { counter.n++; return pairs.map(p => ({ pairId: p.pairId, duplicate: false })) }
    const c1 = { n: 0 }
    await reconcilePedagogicalDuplicates(buildBigPool(90, 20), countingJudge(c1))
    const c2 = { n: 0 }
    await reconcilePedagogicalDuplicates(buildBigPool(90, 0), countingJudge(c2))
    judgeCallsWithPriority = c1.n
    judgeCallsWithoutPriority = c2.n
    assert.equal(judgeCallsWithPriority, judgeCallsWithoutPriority, `ranking must not change the number of provider calls: ${judgeCallsWithPriority} vs ${judgeCallsWithoutPriority}`)
  })

  // ============================================================
  // FASE B — repair contextless con evidencia concreta
  // ============================================================

  await test('B1. contextless repair with a real qualifier receives requiredContextEvidence verbatim', async () => {
    const feedback: RepairFeedback = {
      plannedCardId: 'x', rejectionReasons: ['contextless_question'], requiredPreservations: [],
      requiredContextEvidence: ['Sistema cerrado con H2 e I2'],
    }
    const block = buildRepairFeedbackBlock(feedback)
    assert.ok(block.includes('Sistema cerrado con H2 e I2'), block)
    assert.ok(/do not invent context/i.test(block), block)
  })

  await test('B2. without a usable qualifier, no context is invented (fail-closed)', async () => {
    const feedback: RepairFeedback = {
      plannedCardId: 'x', rejectionReasons: ['contextless_question'], requiredPreservations: [],
      requiredContextEvidence: [],
    }
    const block = buildRepairFeedbackBlock(feedback)
    assert.ok(!/do not invent context/i.test(block), 'the evidence line must be OMITTED entirely when there is nothing real to hand over, never filled with a placeholder')
  })

  await test('B3. repair attempts stay bounded by the explicit per-target fuse (MAX_GENERATION_ATTEMPTS_PER_TARGET=8)', async () => {
    const u = unit('u-b3', 'event_or_data', 'Valor medido', '25 unidades', { qualifiers: ['Experimento 9'], provenance: [] }) // no provenance quote: the deterministic fallback returns null (unbuildable), preserving this test's LLM-only 8-attempt budget
    const b = brain('fp-b3', [u])
    let attempts = 0
    const generateFn = async (planned: PlannedCard) => {
      attempts++
      return { ...planned, question: '¿Cuál es el valor?', answer: '25.', provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: ['contextless_question'] }
    }
    await getOrBuildFlashcardDeck(b, new InMemoryDeckStore(), { generateFn: generateFn as any })
    // Product decision (adaptive retry budget): a card that never converges
    // now runs to the full explicit per-target fuse (1 initial + 7 repair
    // rounds) instead of stopping early — bounded, but no longer at 2.
    assert.equal(attempts, 8, `must run the full per-target attempt budget, got ${attempts}`)
  })

  await test('B4. sameCandidateFingerprint is correctly diagnosed in the trace', async () => {
    const u = unit('u-b4', 'event_or_data', 'Valor medido', '30 unidades', { qualifiers: ['Experimento 3'] })
    const b = brain('fp-b4', [u])
    const generateFn = async (planned: PlannedCard) => ({
      ...planned, question: '¿Cuál es el valor medido?', answer: 'El valor es 30.',
      provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: false, validationErrors: ['contextless_question'],
    })
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
    const attempts = fileContent.repairAttemptDiagnostics
    assert.ok(Array.isArray(attempts) && attempts.length > 0, 'repairAttemptDiagnostics must be recorded')
    // The mock always returns IDENTICAL question/answer -> every repair round must be flagged as a no-op.
    assert.ok(attempts.some((a: any) => a.sameCandidateFingerprint === true), JSON.stringify(attempts))
  })

  // ============================================================
  // FASE C — self-containedness semántica (discriminating context)
  // ============================================================

  await test('C1. universal conceptual question with no qualifier is valid', () => {
    const u = unit('u-c1', 'concept', 'Concepto general', 'Un principio general aplicable siempre, sin instancia especifica.')
    const p = pc('cc1', [u.id])
    const b = brain('fp-c1', [u])
    const result = validateDeck([card('cc1', [u.id], p.conceptClusterId, '¿Qué establece el principio general?', 'Establece una relacion general aplicable en cualquier caso.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, true, JSON.stringify(result[0].validationErrors))
  })

  await test('C2. instance-dependent value + UNLISTED generic deictic phrasing + no discriminating context -> contextless_question (real-deck shape: "en el contexto de X")', () => {
    const u = unit('u-c2', 'event_or_data', 'Valor medido', '448 unidades') // NO qualifiers at all
    const p = pc('cc2', [u.id])
    const b = brain('fp-c2', [u])
    // "en el contexto de X" is NOT in DEICTIC_REFERENT_PATTERNS — proves the fix is NOT phrase-list-dependent.
    const result = validateDeck([card('cc2', [u.id], p.conceptClusterId, '¿Cuál es el valor medido, mencionado en el contexto del experimento?', 'El valor medido es 448 unidades.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, false, 'an instance-bound value with zero qualifier evidence must be rejected regardless of question length/phrasing')
    assert.ok(result[0].validationErrors.includes('contextless_question'))
  })

  await test('C3. same class WITH a discriminating qualifier is valid', () => {
    const u = unit('u-c3', 'event_or_data', 'Valor medido', '448 unidades', { qualifiers: ['Sistema cerrado con reactivo A y B'] })
    const p = pc('cc3', [u.id])
    const b = brain('fp-c3', [u])
    const result = validateDeck([card('cc3', [u.id], p.conceptClusterId, 'En el sistema cerrado con reactivo A y B, ¿cuál es el valor medido?', 'El valor medido es 448 unidades.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, true, JSON.stringify(result[0].validationErrors))
  })

  await test('C4. a brand-new paraphrase (never in DEICTIC_REFERENT_PATTERNS) is still caught when structurally instance-dependent', () => {
    const u = unit('u-c4', 'event_or_data', 'Lectura registrada', '17 unidades') // no qualifiers
    const p = pc('cc4', [u.id])
    const b = brain('fp-c4', [u])
    // Deliberately novel phrasing, not modeled on any existing pattern.
    const result = validateDeck([card('cc4', [u.id], p.conceptClusterId, '¿Cuál fue la lectura obtenida bajo las condiciones descritas anteriormente en el ensayo?', 'La lectura fue de 17 unidades.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(result[0].validated, false, JSON.stringify(result[0].validationErrors))
    assert.ok(result[0].validationErrors.includes('contextless_question'))
  })

  await test('C5. cross-domain generality (medicine, not chemistry) — same rule applies with zero domain-specific code', () => {
    const uNoQualifier = unit('u-c5a', 'event_or_data', 'Presion arterial', '140/90 mmHg')
    const uQualified = unit('u-c5b', 'event_or_data', 'Presion arterial', '140/90 mmHg', { qualifiers: ['Paciente 7 con hipertension diagnosticada'] })
    const pA = pc('cc5a', [uNoQualifier.id])
    const pB = pc('cc5b', [uQualified.id])
    const b = brain('fp-c5', [uNoQualifier, uQualified])
    const results = validateDeck([
      card('cc5a', [uNoQualifier.id], pA.conceptClusterId, '¿Cuál es la presión arterial registrada en el caso descrito?', 'La presión arterial es 140/90 mmHg.'),
      card('cc5b', [uQualified.id], pB.conceptClusterId, 'Para el paciente 7 con hipertensión diagnosticada, ¿cuál es la presión arterial?', 'La presión arterial es 140/90 mmHg.'),
    ], { plannedCards: [pA, pB], targetedUnitIds: [uNoQualifier.id, uQualified.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1' } as any, b)
    assert.equal(results[0].validated, false, 'no-qualifier instance-bound value must fail in medicine exactly as in chemistry')
    assert.equal(results[1].validated, true, 'qualifier-backed value must pass in medicine exactly as in chemistry')
  })

  // ============================================================
  // FASE D — observabilidad para copyright / Tier-1 merge
  // ============================================================

  await test('D1. plan diagnostics distinguish created_directly vs deterministic_auto_merge vs relation_expansion', () => {
    const uSolo = unit('u-d1-solo', 'fact', 'Hecho aislado', 'Un hecho academico aislado y suficiente por si mismo distintivo.')
    const u1 = unit('u-d1-a', 'fact', 'Ley X', 'Establece que el fenomeno X ocurre bajo la condicion Y siempre.')
    const u2 = unit('u-d1-b', 'fact', 'Ley X', 'Se establece que el fenomeno X ocurre bajo la condicion Y siempre.') // near-verbatim -> auto-merge
    const plan = planFlashcards(brain('fp-d1', [uSolo, u1, u2]))
    const provenances = new Set(plan.mergeDiagnostics.map(d => d.mergeProvenance))
    assert.ok(provenances.has('created_directly'), JSON.stringify(plan.mergeDiagnostics))
    assert.ok(provenances.has('deterministic_auto_merge'), JSON.stringify(plan.mergeDiagnostics))
  })

  await test('D2. the trace registers the exact rule/score of a deterministic auto-merge', () => {
    const u1 = unit('u-d2-a', 'fact', 'Ley Y', 'El fenomeno Y depende exclusivamente de la variable Z en todo momento.')
    const u2 = unit('u-d2-b', 'fact', 'Ley Y', 'Se sabe que el fenomeno Y depende exclusivamente de la variable Z en todo momento.')
    const plan = planFlashcards(brain('fp-d2', [u1, u2]))
    const merged = plan.mergeDiagnostics.find(d => d.mergeProvenance === 'deterministic_auto_merge')
    assert.ok(merged, JSON.stringify(plan.mergeDiagnostics))
    assert.ok(merged!.autoMerge, 'autoMerge details must be present')
    assert.equal(merged!.autoMerge!.rule, 'AUTO_MERGE_THRESHOLD')
    assert.ok(merged!.autoMerge!.similarityScore >= 0.62)
    assert.equal(merged!.autoMerge!.inputPlannedCardIds.length, 2)
  })

  await test('D3. metadata diagnostics show which text surfaces were evaluated, per surviving target', () => {
    const u = unit('u-d3', 'fact', 'Hecho real', 'Un hecho academico real y distintivo sobre el tema estudiado.')
    const plan = planFlashcards(brain('fp-d3', [u]))
    assert.ok(plan.metadataDiagnostics.length > 0)
    const diag = plan.metadataDiagnostics[0]
    assert.equal(diag.sourceUnitId, u.id)
    assert.equal(diag.metadataPredicateResult, false)
    assert.equal(typeof diag.whichTextSurfacesMatched.label, 'boolean')
    assert.equal(typeof diag.whichTextSurfacesMatched.statement, 'boolean')
    assert.equal(typeof diag.whichTextSurfacesMatched.provenance, 'boolean')
    assert.equal(typeof diag.whichTextSurfacesMatched.retrievalObjective, 'boolean')
  })

  await test('D4. the persisted trace never contains full material/card text unnecessarily (fingerprints/booleans only)', async () => {
    const u = unit('u-d4', 'fact', 'Hecho secreto no debe aparecer literal', 'Contenido con una frase muy distintiva XYZQRST7788 que no debe filtrarse.')
    const b = brain('fp-d4', [u])
    const generateFn = async (planned: PlannedCard) => card(planned.id, planned.sourceUnitIds, planned.conceptClusterId, '¿Qué establece el hecho?', 'Respuesta con la frase distintiva XYZQRST7788 incluida aqui.')
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
    const raw = await readFile(savedPath, 'utf8')
    // The distinctive marker must never leak into mergeDiagnostics/metadataDiagnostics/repairAttemptDiagnostics sections specifically.
    const parsed = JSON.parse(raw)
    const diagnosticsOnly = JSON.stringify({ mergeDiagnostics: parsed.mergeDiagnostics, metadataDiagnostics: parsed.metadataDiagnostics, repairAttemptDiagnostics: parsed.repairAttemptDiagnostics, dedupDiagnostics: parsed.dedupDiagnostics })
    assert.ok(!diagnosticsOnly.includes('XYZQRST7788'), 'diagnostics-only sections must never contain raw source/candidate text')
  })

  await rm(TRACE_DIR, { recursive: true, force: true }).catch(() => {})

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-dedup-ranking-repair-context-contracts: ALL PASS')
}

main()
