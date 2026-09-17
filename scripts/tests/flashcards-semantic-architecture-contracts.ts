import assert from 'node:assert/strict'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { validateDeck, computeDeckCoverage } from '../../lib/materialBrain/flashcards/validate'
import { reconcilePedagogicalDuplicates } from '../../lib/materialBrain/flashcards/pedagogicalDedup'
import type { GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Flashcards semantic architecture — closes the audit's real-deck
// findings (57 concepts / 45 cards, catalyst-family triplication,
// solids/liquids triplication, fragment questions, contextless worked-
// example questions, degraded notation, honest coverage). Every
// fixture is domain-genericized (no chemistry-specific production
// logic) even where it MODELS a chemistry real case.
// ============================================================

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}, tier: 'critical' | 'supporting' | 'contextual' = 'supporting'): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: extra.canonicalSubject || label, semanticKey: extra.semanticKey || '', qualifiers: extra.qualifiers || [] },
    importance: { tier, signals: extra.signals || ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    evidence: [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: statement, chunkId: 'c-1' }],
    domainTags: extra.domainTags || [],
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
  return { ...planned, question, answer, provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(), validated: true, validationErrors: [] }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards semantic-architecture contracts (canonical clustering + honest coverage) ──\n')

  // ---------------------------------------------------------------
  // Fixture A — semantic redundancy (catalyst-family triplication,
  // real-deck cards #4/#40/#41): three units sharing a Brain-declared
  // semanticKey, phrased across recall/comprehension/application, with
  // near-identical actual content (no genuine distinct operation).
  // ---------------------------------------------------------------
  await test('Fixture A: same-semanticKey units spanning recall/comprehension/application collapse when content is materially redundant', async () => {
    const units = [
      unit('u-cat-1', 'fact', 'Efecto del catalizador en el equilibrio', 'Un catalizador acelera tanto la reacción directa como la inversa por igual, sin alterar la posición del equilibrio.', { semanticKey: 'catalizador-efecto-equilibrio' }),
      unit('u-cat-2', 'fact', 'Efecto de los catalizadores en las reacciones', 'Los catalizadores aceleran por igual las reacciones directa e inversa, sin desplazar el equilibrio.', { semanticKey: 'catalizador-efecto-equilibrio' }),
      unit('u-cat-3', 'fact', 'Efecto del catalizador en la composición', 'Un catalizador acelera igualmente ambas reacciones, por lo que la composición en equilibrio no cambia.', { semanticKey: 'catalizador-efecto-equilibrio' }),
    ]
    const plan = planFlashcards(brain('sem-a', units))
    const cards = [
      fakeCard(plan.plannedCards.find(c => c.sourceUnitIds.includes('u-cat-1'))!, '¿Cómo afecta el uso de un catalizador al equilibrio químico?', 'Acelera igual la reacción directa e inversa, sin alterar la posición del equilibrio.'),
      fakeCard(plan.plannedCards.find(c => c.sourceUnitIds.includes('u-cat-2'))!, '¿Cuál es el efecto de los catalizadores en las reacciones químicas?', 'Aceleran por igual la reacción directa e inversa, sin desplazar el equilibrio.'),
      fakeCard(plan.plannedCards.find(c => c.sourceUnitIds.includes('u-cat-3'))!, '¿Cómo afecta un catalizador a la composición del equilibrio?', 'No la cambia, porque acelera igualmente ambas reacciones.'),
    ].map((c, i) => ({ ...c, cognitiveType: (['recall', 'comprehension', 'application'] as const)[i] }))
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true })))
    assert.ok(result.length < 3, `expected redundant catalyst-family cards to collapse, got ${result.length} survivors`)
  })

  // ---------------------------------------------------------------
  // Fixture B — complementary cards (K>>1 vs K<<1) must survive.
  // ---------------------------------------------------------------
  await test('Fixture B: interpret K>>1 vs compare K>>1/K<<1 survive as complementary even sharing a semanticKey', async () => {
    const units = [
      unit('u-k1', 'fact', 'Interpretación de K mucho mayor que 1', 'Cuando K es mucho mayor que 1, el equilibrio favorece fuertemente a los productos.', { semanticKey: 'constante-equilibrio-K' }),
      unit('u-k2', 'fact', 'Comparación entre K mucho mayor y mucho menor que 1', 'K>>1 indica predominio de productos; K<<1 indica predominio de reactivos — son extremos opuestos.', { semanticKey: 'constante-equilibrio-K' }),
    ]
    const plan = planFlashcards(brain('sem-b', units))
    const cards = [
      fakeCard(plan.plannedCards.find(c => c.sourceUnitIds.includes('u-k1'))!, '¿Qué indica un valor de K mucho mayor que 1?', 'Que el equilibrio favorece fuertemente a los productos.'),
      fakeCard(plan.plannedCards.find(c => c.sourceUnitIds.includes('u-k2'))!, '¿Cuál es la diferencia entre K mucho mayor que 1 y K mucho menor que 1?', 'K>>1 favorece productos; K<<1 favorece reactivos — describen extremos opuestos del equilibrio.'),
    ].map((c, i) => ({ ...c, cognitiveType: (['recall', 'comparison'] as const)[i] }))
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: false })))
    assert.equal(result.length, 2, 'genuinely complementary cards must both survive')
  })

  // ---------------------------------------------------------------
  // Fixture C — vague questions (real-deck #7/#27/#44) cannot earn
  // valid coverage.
  // ---------------------------------------------------------------
  function assertVagueRejected(label: string, question: string) {
    return test(label, () => {
      const u = unit('u-vague', 'fact', 'Constante de equilibrio', 'La constante de equilibrio relaciona concentraciones de productos y reactivos.')
      const plan = planFlashcards(brain('sem-c-' + label, [u]))
      const pc = plan.plannedCards[0]
      const validated = validateDeck([fakeCard(pc, question, 'Se relaciona con el equilibrio químico y las velocidades de reacción.')], plan)
      assert.equal(validated[0].validated, false, `"${question}" must not earn valid coverage`)
    })
  }
  await assertVagueRejected('Fixture C1: "en qué contexto se utiliza" rejected', '¿En qué contexto se utiliza el término "constante de equilibrio"?')
  await assertVagueRejected('Fixture C2: "qué es posible calcular" rejected', '¿Qué es posible calcular para una reacción a una temperatura específica?')
  await assertVagueRejected('Fixture C3: "de qué depende" rejected', '¿De qué depende el cálculo de las concentraciones de equilibrio de los compuestos?')

  // ---------------------------------------------------------------
  // Fixture D — worked example without context: empty qualifiers, no
  // label-fallback rescue.
  // ---------------------------------------------------------------
  await test('Fixture D: event_or_data unit with EMPTY qualifiers and a naked-value question is rejected — label fallback does not rescue it', () => {
    const u = unit('u-nolabel', 'event_or_data', 'Concentración final de HI', 'aproximadamente 0.786 M') // no qualifiers at all
    const plan = planFlashcards(brain('sem-d', [u]))
    const pc = plan.plannedCards[0]
    const validated = validateDeck([fakeCard(pc, '¿Cuál es la concentración de HI en la mezcla en equilibrio?', 'Aproximadamente 0.786 M.')], plan, brain('sem-d', [u]))
    assert.equal(validated[0].validated, false, 'must be rejected — no qualifier exists to prove which system/example this belongs to')
  })

  // ---------------------------------------------------------------
  // Fixture E — notation degradation on a non-formula card.
  // ---------------------------------------------------------------
  // P0 mission ("REPAIRABLE FORMAT ERROR", not automatic content
  // invalidity): unwrapped notation is now deterministically wrapped in
  // $...$ before this gate runs (see repairUnwrappedNotation in
  // validate.ts) — a purely-formatting defect no longer discards an
  // otherwise-correct card. This test now proves the REPAIR path
  // specifically: bare input survives as a validated card with
  // corrected, wrapped notation, distinct from Fixture E2's "already-
  // correct input" case below.
  await test('Fixture E: unwrapped subscript/superscript notation on a non-FormulaUnit card is deterministically repaired and accepted', () => {
    const u = unit('u-notation', 'fact', 'Descomposición de un compuesto', 'Un compuesto se descompone en dos productos gaseosos.')
    const plan = planFlashcards(brain('sem-e', [u]))
    const pc = plan.plannedCards[0]
    const validated = validateDeck([fakeCard(pc, '¿Cuál es la ecuación de descomposición del compuesto N_2 O_4?', 'Se descompone en 2 NO_2 según la reacción N_2O_4 -> 2NO_2.')], plan)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
    assert.ok(validated[0].question.includes('$N_2') , `notation should be wrapped, got: ${validated[0].question}`)
  })

  await test('Fixture E2: the SAME notation properly wrapped in $...$ is accepted', () => {
    const u = unit('u-notation2', 'fact', 'Descomposición de un compuesto', 'Un compuesto se descompone en dos productos gaseosos.')
    const plan = planFlashcards(brain('sem-e2', [u]))
    const pc = plan.plannedCards[0]
    const validated = validateDeck([fakeCard(pc, '¿Cuál es la ecuación de descomposición del compuesto $N_2O_4$?', 'Se descompone según $N_2O_4 \\rightarrow 2NO_2$.')], plan)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  // ---------------------------------------------------------------
  // Fixture F — multi-unit card allowed (no regression to 1:1).
  // ---------------------------------------------------------------
  await test('Fixture F: one genuinely good card covering multiple tightly related units is allowed', async () => {
    const p: PlannedCard = { id: 'multi1', sourceUnitIds: ['u1', 'u2', 'u3'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'application', rationale: 'r', conceptClusterId: 'cluster-multi' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [p], targetedUnitIds: ['u1', 'u2', 'u3'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
    const card = fakeCard(p, 'Dado el sistema descrito en el Experimento 4, con concentraciones iniciales de A y B conocidas, ¿cuál es la concentración de C en equilibrio?', 'Aplicando la constante de equilibrio con los valores dados, C = 0.42 M.')
    const validated = validateDeck([card], plan as any)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
    const coverage = computeDeckCoverage(validated, plan as any)
    assert.deepEqual([...coverage.coveredUnitIds].sort(), ['u1', 'u2', 'u3'])
  })

  // ---------------------------------------------------------------
  // Fixture G — coverage integrity: only pedagogically valid
  // representation contributes to coverage.
  // ---------------------------------------------------------------
  await test('Fixture G: valid + duplicate + vague + contextless + notation-corrupt cards — only the valid one earns coverage', () => {
    const uValid = unit('g-valid', 'fact', 'Ley de conservación de la masa', 'La masa total se conserva en una reacción química cerrada.')
    const uVague = unit('g-vague', 'fact', 'Constante K', 'La constante de equilibrio K relaciona concentraciones.')
    const uContextless = unit('g-ctx', 'event_or_data', 'Concentración final', 'valor medido en el experimento') // no qualifiers
    const uNotation = unit('g-notation', 'fact', 'Fórmula molecular', 'El compuesto tiene fórmula molecular conocida.')
    const units = [uValid, uVague, uContextless, uNotation]
    const plan = planFlashcards(brain('sem-g', units))
    const pcFor = (id: string) => plan.plannedCards.find(c => c.sourceUnitIds.includes(id))!
    const b = brain('sem-g', units)
    const cards = [
      fakeCard(pcFor('g-valid'), '¿Qué establece la ley de conservación de la masa en una reacción química cerrada?', 'Que la masa total de reactivos y productos permanece constante.'),
      fakeCard(pcFor('g-vague'), '¿Con qué concepto está relacionada la constante de equilibrio?', 'Con el equilibrio químico y las velocidades de reacción.'),
      fakeCard(pcFor('g-ctx'), '¿Cuál es la concentración final medida?', 'El valor medido en el experimento.'),
      fakeCard(pcFor('g-notation'), '¿Cuál es la fórmula molecular N_2 O_4 del compuesto?', 'Su fórmula molecular es N_2O_4.'),
    ]
    const validated = validateDeck(cards, plan, b)
    const coverage = computeDeckCoverage(validated, plan)
    assert.ok(coverage.coveredUnitIds.includes('g-valid'), 'the genuinely valid card must count')
    assert.ok(!coverage.coveredUnitIds.includes('g-vague'), 'the vague card must NOT count')
    assert.ok(!coverage.coveredUnitIds.includes('g-ctx'), 'the contextless card must NOT count')
    assert.ok(!coverage.coveredUnitIds.includes('g-notation'), 'the notation-corrupt card must NOT count')
    assert.equal(coverage.status, 'partial', 'deck must honestly report partial, never claim complete on 1/4 valid targets')
  })

  // ---------------------------------------------------------------
  // Honest coverage: targetedConceptClusterIds / coveredConceptClusterIds
  // ---------------------------------------------------------------
  await test('Concept-cluster coverage: a merged redundant pair reports 1 targeted, 1 covered concept cluster (not 2)', async () => {
    const units = [
      unit('u-dup1', 'fact', 'Definición de equilibrio', 'El equilibrio químico es el estado donde las velocidades directa e inversa se igualan.', { semanticKey: 'equilibrio-quimico-def' }),
      unit('u-dup2', 'fact', 'Significado de equilibrio', 'El equilibrio químico es el estado donde las velocidades directa e inversa se igualan.', { semanticKey: 'equilibrio-quimico-def' }),
    ]
    const plan = planFlashcards(brain('sem-cluster', units))
    const cards = plan.plannedCards.map((pc, i) => fakeCard(pc, i === 0 ? '¿Qué es el equilibrio químico?' : '¿Qué significa el equilibrio químico?', 'Es el estado donde las velocidades directa e inversa se igualan.'))
    const validated = validateDeck(cards, plan)
    const { cards: merged } = await reconcilePedagogicalDuplicates(validated, async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true })))
    const coverage = computeDeckCoverage(merged, plan)
    assert.equal(coverage.targetedConceptClusterIds.length, 1, 'both units share one concept cluster')
    assert.equal(coverage.coveredConceptClusterIds.length, 1)
    assert.equal(coverage.metrics.targetedConcepts, 1)
    assert.equal(coverage.metrics.coveredConcepts, 1)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-semantic-architecture-contracts: ALL PASS')
}

main()
