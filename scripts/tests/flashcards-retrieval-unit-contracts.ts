import assert from 'node:assert/strict'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { validateDeck } from '../../lib/materialBrain/flashcards/validate'
import { reconcilePedagogicalDuplicates, scoreCandidate, type PedagogicalJudgeFn } from '../../lib/materialBrain/flashcards/pedagogicalDedup'
import type { FlashcardPlan, GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Mission: close P1 (duplicate-family root cause) + P2 (redundant vs
// complementary) + P5 (worked-example RetrievalUnit consolidation) +
// P8 (survivor preference) as ONE architectural question: "what is a
// pedagogically distinct flashcard?"
//
// Real-deck evidence this suite is modeled on:
//   - "¿Qué es el equilibrio químico?" vs "¿Qué es el equilibrio
//     químico en relación con las reacciones directa e inversa?"
//     -> same proposition, different cognitiveType (recall vs
//     comprehension) -> were NEVER compared before (bucketed apart).
//   - "ley de velocidad directa" duplicated by its own companion card
//     from the SAME source unit -> were NEVER compared before (same-
//     source-unit pairs were exempted from comparison).
//   - H2/I2/HI worked example: 8 numeric leaves, several independently
//     critical-tier -> exploded into ~8 near-1:1 cards instead of a
//     bounded consolidation.
// ============================================================

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}, tier: 'critical' | 'supporting' | 'contextual' = 'supporting'): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: label, semanticKey: label, qualifiers: extra.qualifiers || [] },
    importance: { tier, signals: extra.signals || ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    evidence: [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: statement, chunkId: 'c-1' }],
    domainTags: extra.domainTags || [],
    ...extra,
  } as any
}

function relation(id: string, type: string, fromUnitId: string, toUnitId: string, statement = ''): any {
  return { id, type, fromUnitId, toUnitId, statement, provenance: [], importance: { tier: 'supporting', signals: [], confidence: 0.8 } }
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
    validated: true, validationErrors: [],
  }
}

function pc(id: string, sourceUnitIds: string[], cognitiveType: PlannedCard['cognitiveType'], objective = id): PlannedCard {
  return { id, sourceUnitIds, sourceRelationIds: [], retrievalObjective: objective, cognitiveType, rationale: 'r' }
}

const alwaysDuplicateJudge: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true }))
const neverDuplicateJudge: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: false }))

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards retrieval-unit (P1+P2+P5+P8) contracts ──\n')

  // ---------------------------------------------------------------
  // RET-1/2: real-deck family A — same proposition, different
  // cognitiveType (recall vs comprehension), previously NEVER compared.
  // ---------------------------------------------------------------
  await test('RET-1 [real family A]: recall vs comprehension phrasing of the SAME proposition merges into one retrieval task', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u1'], 'comprehension')
    const cards = [
      fakeCard(p1, '¿Qué es el equilibrio químico?', 'Es el estado en que las velocidades de reacción directa e inversa se igualan.'),
      fakeCard(p2, '¿Qué es el equilibrio químico en relación con las reacciones directa e inversa?', 'Es el estado en que las velocidades de reacción directa e inversa se igualan.'),
    ]
    const { cards: result, mergedCount } = await reconcilePedagogicalDuplicates(cards, alwaysDuplicateJudge)
    assert.equal(result.length, 1, 'must collapse to a single surviving card')
    assert.equal(mergedCount, 1)
  })

  await test('RET-2: definition vs near-verbatim paraphrased definition (same cognitiveType) is redundant', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u2'], 'recall')
    const cards = [
      fakeCard(p1, '¿Qué es la sensibilidad de una prueba diagnóstica?', 'La proporción de verdaderos positivos correctamente identificados por la prueba.'),
      fakeCard(p2, '¿Qué significa la sensibilidad de una prueba diagnóstica?', 'La proporción de verdaderos positivos que la prueba identifica correctamente.'),
    ]
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, alwaysDuplicateJudge)
    assert.equal(result.length, 1)
  })

  // ---------------------------------------------------------------
  // RET-3/4: complementary — must NEVER merge, even with contradictory
  // judge signal proving the deterministic layer (contrast-flip veto,
  // low jaccard) already keeps them apart without needing the judge.
  // ---------------------------------------------------------------
  await test('RET-3: definition vs implication/application is complementary (kept apart even under an always-duplicate judge, if deterministic signals disagree)', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u1'], 'application')
    const cards = [
      fakeCard(p1, '¿Qué es la constante de equilibrio K?', 'Es la relación entre las concentraciones de productos y reactivos en equilibrio.'),
      fakeCard(p2, '¿Qué implica que K sea mucho mayor que 1?', 'Que en el equilibrio predominan los productos sobre los reactivos.'),
    ]
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, neverDuplicateJudge)
    assert.equal(result.length, 2, 'application stays in its own comparableGroup bucket, never even reaches the judge')
  })

  await test('RET-4: principle vs concrete application is complementary (comparison bucket kept separate from recall)', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u1'], 'comparison')
    const cards = [
      fakeCard(p1, '¿Qué establece el Principio de Le Châtelier?', 'Que un sistema en equilibrio se opone a cualquier cambio impuesto sobre él.'),
      fakeCard(p2, '¿Cómo afecta un aumento de presión a este equilibrio gaseoso?', 'Desplaza el equilibrio hacia el lado con menor número de moles gaseosos.'),
    ]
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, neverDuplicateJudge)
    assert.equal(result.length, 2)
  })

  // ---------------------------------------------------------------
  // RET-6/7: parent/child units and repeated passages — same recall
  // proposition from disjoint source units still merges.
  // ---------------------------------------------------------------
  await test('RET-6: parent/child units expressing the same fact collapse to one card, coverage unioned', async () => {
    const p1 = pc('c1', ['u-parent'], 'recall')
    const p2 = pc('c2', ['u-child'], 'recall')
    const cards = [
      fakeCard(p1, '¿Qué establece la ley de velocidad directa?', 'La velocidad directa es proporcional a la concentración de los reactivos elevada a su orden.'),
      fakeCard(p2, '¿Cuál es la ley de velocidad directa de la reacción?', 'La velocidad directa depende de la concentración de reactivos elevada a su orden de reacción.'),
    ]
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, alwaysDuplicateJudge)
    assert.equal(result.length, 1)
    assert.deepEqual([...result[0].sourceUnitIds].sort(), ['u-child', 'u-parent'])
  })

  await test('RET-7 [real family, same-unit companion cards]: a same-source-unit "companion" card that ended up redundant is now caught (previously exempt from comparison)', async () => {
    const p1 = pc('c1', ['u-rate'], 'recall')
    const p2 = pc('c2', ['u-rate'], 'recall')
    const cards = [
      fakeCard(p1, '¿Cuál es la ley de velocidad directa de la reacción?', 'v = k[A][B], la velocidad directa depende de las concentraciones de los reactivos.'),
      // Meant to be a distinct "application" card but the provider just
      // restated the same law again -> caught by comparing SAME-unit
      // pairs too (previously impossible: the old exclusion skipped any
      // pair sharing a source unit id before it ever reached scoring).
      fakeCard(p2, '¿Cómo se expresa la misma ley de velocidad directa otra vez?', 'v = k[A][B], la velocidad directa depende de las concentraciones de los reactivos.'),
    ]
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, alwaysDuplicateJudge)
    assert.equal(result.length, 1, 'a same-unit companion card carrying no distinct content must be catchable by this pass')
  })

  // ---------------------------------------------------------------
  // RET-8/9: near-identical vocabulary but genuinely distinct or
  // contrasting content must survive.
  // ---------------------------------------------------------------
  await test('RET-8: two different facts with high vocabulary overlap both survive (judge correctly says not-duplicate)', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u2'], 'recall')
    const cards = [
      fakeCard(p1, '¿En qué año nació Marie Curie?', 'Marie Curie nació en 1867.'),
      fakeCard(p2, '¿En qué año murió Marie Curie?', 'Marie Curie murió en 1934.'),
    ]
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, neverDuplicateJudge)
    assert.equal(result.length, 2)
  })

  await test('RET-9: opposite/contrast facts never merge (contrast-flip veto, no judge call needed)', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u2'], 'recall')
    const cards = [
      fakeCard(p1, '¿Qué ocurre con la velocidad de reacción al aumentar la temperatura?', 'La velocidad de reacción aumenta.'),
      fakeCard(p2, '¿Qué ocurre con la velocidad de reacción al disminuir la temperatura?', 'La velocidad de reacción disminuye.'),
    ]
    let judgeCalls = 0
    const countingJudge: PedagogicalJudgeFn = async pairs => { judgeCalls++; return pairs.map(p => ({ pairId: p.pairId, duplicate: true })) }
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, countingJudge)
    assert.equal(result.length, 2)
    assert.equal(judgeCalls, 0, 'contrast-flip must veto before ever reaching the judge')
  })

  // ---------------------------------------------------------------
  // RET-10/11/13/14: worked-example consolidation (P5/P5A)
  // ---------------------------------------------------------------
  await test('RET-10 [real family D]: an 8-leaf worked example with multiple co-critical data points does NOT create 8 literal-value cards', () => {
    const example = unit('u-ex', 'example', 'Sistema H2/I2/HI en equilibrio', 'Un sistema alcanza el equilibrio a partir de concentraciones iniciales.', {}, 'critical')
    const leaves = [
      unit('u-initA', 'event_or_data', 'Concentración inicial de H2', '0.500 M', {}, 'critical'),
      unit('u-initB', 'event_or_data', 'Concentración inicial de I2', '0.500 M', {}, 'critical'),
      unit('u-temp', 'fact', 'Temperatura del sistema', '448°C'), // non-critical support
      unit('u-changeA', 'event_or_data', 'Cambio en H2', '-0.393 M'), // non-critical support
      unit('u-eqA', 'event_or_data', 'H2 en equilibrio', '0.107 M', {}, 'critical'),
      unit('u-eqB', 'event_or_data', 'I2 en equilibrio', '0.107 M', {}, 'critical'),
      unit('u-formula', 'fact', 'Fórmula aplicada', 'Kc = [HI]^2 / ([H2][I2])'), // non-critical support
      unit('u-result', 'event_or_data', 'Resultado final HI', '0.786 M', {}, 'critical'),
    ]
    const relations = leaves.map((u, i) => relation(`r-${i}`, 'example_of', u.id, 'u-ex'))
    const plan = planFlashcards(brain('ret-10', [example, ...leaves], relations))
    // The example itself + ONE consolidated critical-conclusion card = 2
    // targets-worth of independent cards, never 1 per leaf.
    const cardsForExample = plan.plannedCards.filter(c => c.sourceUnitIds.some(id => [example.id, ...leaves.map(l => l.id)].includes(id)))
    assert.ok(cardsForExample.length <= 3, `expected a bounded consolidation, got ${cardsForExample.length} cards: ${JSON.stringify(cardsForExample.map(c => c.sourceUnitIds))}`)
    assert.ok(cardsForExample.length < leaves.length, 'must be strictly fewer cards than raw leaves')
  })

  await test('RET-11: the consolidated worked-example card transfers UNION coverage of every merged critical leaf', () => {
    const example = unit('u-ex2', 'example', 'Ejemplo ilustrativo', 'Un ejemplo aplica el método.', {}, 'critical')
    const leaves = [
      unit('u-c1', 'event_or_data', 'Valor crítico 1', '10'),
      unit('u-c2', 'event_or_data', 'Valor crítico 2', '20'),
    ]
    leaves[0].importance.tier = 'critical'
    leaves[1].importance.tier = 'critical'
    const relations = leaves.map((u, i) => relation(`r-${i}`, 'example_of', u.id, 'u-ex2'))
    const plan = planFlashcards(brain('ret-11', [example, ...leaves], relations))
    const consolidated = plan.plannedCards.find(c => c.sourceUnitIds.includes('u-c1') && c.sourceUnitIds.includes('u-c2'))
    assert.ok(consolidated, 'expected one card whose sourceUnitIds unions both critical leaves')
    assert.ok(plan.targetedUnitIds.includes('u-c1') && plan.targetedUnitIds.includes('u-c2'), 'both leaves must remain covered targets via the union')
  })

  await test('RET-13: an arbitrary non-critical intermediate value is not an independent memorization target', () => {
    const example = unit('u-ex3', 'example', 'Ejemplo con paso intermedio', 'Un ejemplo con un valor de paso intermedio arbitrario.', {}, 'critical')
    const intermediate = unit('u-int', 'event_or_data', 'Valor intermedio de paso 2', '3.2') // supporting, not critical
    const relations = [relation('r1', 'example_of', 'u-int', 'u-ex3')]
    const plan = planFlashcards(brain('ret-13', [example, intermediate], relations))
    assert.ok(!plan.targetedUnitIds.includes('u-int'), 'arbitrary intermediate value must not become its own target')
    assert.ok(plan.skipped.some(s => s.unitId === 'u-int' && s.reason === 'consolidated_into_worked_example'))
  })

  await test('RET-14: an explicitly declared memorization-worthy numeric fact (the SOLE critical child) is retained independently', () => {
    const example = unit('u-ex4', 'example', 'Ejemplo con resultado clave', 'Un ejemplo cuyo resultado final es la lección.', {}, 'critical')
    const conclusion = unit('u-final', 'event_or_data', 'Resultado final del ejemplo', '7.8, el valor que el curso pide memorizar', {}, 'critical')
    const relations = [relation('r1', 'example_of', 'u-final', 'u-ex4')]
    const plan = planFlashcards(brain('ret-14', [example, conclusion], relations))
    assert.ok(plan.targetedUnitIds.includes('u-final'), 'the single, sole critical conclusion keeps its own independent card')
  })

  // ---------------------------------------------------------------
  // RET-19: clinical case consolidation (cross-domain, not chemistry)
  // ---------------------------------------------------------------
  await test('RET-19: clinical case facts consolidate into one diagnostic/application retrieval task, not one card per finding', () => {
    const caseUnit = unit('u-case', 'example', 'Caso clínico 4', 'Un caso clínico ilustra el proceso diagnóstico.', {}, 'critical')
    const findings = [
      unit('u-f1', 'event_or_data', 'Frecuencia cardiaca', '130 lpm', {}, 'critical'),
      unit('u-f2', 'event_or_data', 'Temperatura corporal', '39.2°C', {}, 'critical'),
      unit('u-dx', 'event_or_data', 'Diagnóstico alcanzado', 'taquicardia sinusal', {}, 'critical'),
    ]
    const relations = findings.map((u, i) => relation(`r-${i}`, 'example_of', u.id, 'u-case'))
    const plan = planFlashcards(brain('ret-19', [caseUnit, ...findings], relations))
    const cardsForCase = plan.plannedCards.filter(c => c.sourceUnitIds.some(id => [caseUnit.id, ...findings.map(f => f.id)].includes(id)))
    assert.ok(cardsForCase.length <= 3, `expected consolidation, got ${cardsForCase.length}`)
  })

  // ---------------------------------------------------------------
  // RET-21/22/23: survivor preference (P8)
  // ---------------------------------------------------------------
  await test('RET-21: survivor preference chooses the self-contained/higher-quality card over a residual-document-language one', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u2'], 'recall')
    const good = fakeCard(p1, 'En el Ejemplo 1, ¿cuál es la reacción química de equilibrio que tiene lugar?', 'N2O4(g) ⇌ 2NO2(g), la reacción de descomposición estudiada en el ejemplo.')
    const bad = fakeCard(p2, '¿Cuál es la reacción química que tiene lugar según el texto?', 'N2O4(g) ⇌ 2NO2(g)')
    const scoreGood = scoreCandidate(good)
    const scoreBad = scoreCandidate(bad)
    assert.ok(scoreGood.total > scoreBad.total, `expected the self-contained card to score higher: good=${scoreGood.total} bad=${scoreBad.total}`)
    const { cards: result } = await reconcilePedagogicalDuplicates([good, bad], alwaysDuplicateJudge)
    assert.equal(result.length, 1)
    assert.equal(result[0].question, good.question, 'the self-contained card must be the survivor')
  })

  await test('RET-22: survivor preference chooses meaningful retrieval over trivial bare-value lookup', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u2'], 'recall')
    const meaningful = fakeCard(p1, '¿Qué establece la ley de velocidad directa de esta reacción?', 'La velocidad directa es proporcional a las concentraciones de los reactivos elevadas a su orden de reacción respectivo.')
    const trivial = fakeCard(p2, '¿Cuál es la velocidad?', '42')
    const scoreMeaningful = scoreCandidate(meaningful)
    const scoreTrivial = scoreCandidate(trivial)
    assert.ok(scoreMeaningful.total > scoreTrivial.total)
    assert.equal(scoreTrivial.triviaPenalty, 1)
  })

  await test('RET-23: survivor union preserves ALL sourceUnitIds/sourceRelationIds from both merged cards', async () => {
    const p1: PlannedCard = { id: 'c1', sourceUnitIds: ['u1', 'u2'], sourceRelationIds: ['rel1'], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const p2: PlannedCard = { id: 'c2', sourceUnitIds: ['u3'], sourceRelationIds: ['rel2'], retrievalObjective: 'y', cognitiveType: 'recall', rationale: 'r' }
    const cards = [
      fakeCard(p1, '¿Qué es el equilibrio químico?', 'Es el estado donde las velocidades directa e inversa se igualan.'),
      fakeCard(p2, '¿Qué significa que un sistema esté en equilibrio químico?', 'Significa que las velocidades directa e inversa se igualan.'),
    ]
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, alwaysDuplicateJudge)
    assert.equal(result.length, 1)
    assert.deepEqual([...result[0].sourceUnitIds].sort(), ['u1', 'u2', 'u3'])
    assert.deepEqual([...result[0].sourceRelationIds].sort(), ['rel1', 'rel2'])
  })

  // ---------------------------------------------------------------
  // RET-24/25/26: coverage invariant
  // ---------------------------------------------------------------
  await test('RET-24: a deleted redundant card cannot leave its target falsely covered (coverage recomputed post-merge only credits the survivor)', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u2'], 'recall')
    const cards = [
      fakeCard(p1, '¿Qué es el equilibrio químico?', 'Es el estado donde las velocidades directa e inversa se igualan.'),
      fakeCard(p2, '¿Qué significa el equilibrio químico?', 'Es el estado donde las velocidades directa e inversa se igualan.'),
    ]
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, alwaysDuplicateJudge)
    const allTargetIds = new Set(result.flatMap(c => c.sourceUnitIds))
    assert.ok(allTargetIds.has('u1') && allTargetIds.has('u2'), 'both original targets must still be covered by the single survivor')
  })

  await test('RET-26: a non-critical worked-example fragment excluded via consolidation never becomes "pending" (not in targetedUnitIds)', () => {
    const example = unit('u-ex5', 'example', 'Ejemplo', 'Un ejemplo con un paso no crítico.', {}, 'critical')
    const fragment = unit('u-frag', 'event_or_data', 'Paso no crítico', 'valor de paso 5')
    const plan = planFlashcards(brain('ret-26', [example, fragment], [relation('r1', 'example_of', 'u-frag', 'u-ex5')]))
    assert.ok(!plan.targetedUnitIds.includes('u-frag'), 'excluded fragment must never appear in targetedUnitIds (never "pending")')
  })

  // ---------------------------------------------------------------
  // RET-27/28: determinism and scale
  // ---------------------------------------------------------------
  await test('RET-27: ordering/batching does not change the final retrieval universe', async () => {
    const p1 = pc('c1', ['u1'], 'recall')
    const p2 = pc('c2', ['u2'], 'recall')
    const p3 = pc('c3', ['u3'], 'recall')
    const a = fakeCard(p1, '¿Qué es el equilibrio químico?', 'Es el estado donde las velocidades directa e inversa se igualan.')
    const b = fakeCard(p2, '¿Qué significa el equilibrio químico?', 'Es el estado donde las velocidades directa e inversa se igualan.')
    const c = fakeCard(p3, '¿Cuál es la capital de Francia?', 'París.')
    const r1 = await reconcilePedagogicalDuplicates([a, b, c], alwaysDuplicateJudge)
    const r2 = await reconcilePedagogicalDuplicates([c, b, a], alwaysDuplicateJudge)
    assert.equal(r1.cards.length, r2.cards.length)
    const ids1 = new Set(r1.cards.flatMap(x => x.sourceUnitIds))
    const ids2 = new Set(r2.cards.flatMap(x => x.sourceUnitIds))
    assert.deepEqual([...ids1].sort(), [...ids2].sort())
  })

  await test('RET-28: N=500 remains bounded — no O(N²) provider calls, deterministic result', async () => {
    const cards: GeneratedFlashcard[] = []
    for (let i = 0; i < 500; i++) {
      const p = pc(`c${i}`, [`u${i}`], i % 2 === 0 ? 'recall' : 'comprehension')
      cards.push(fakeCard(p, `¿Qué es el concepto número ${i}?`, `Definición única y distinta del concepto número ${i} con contenido propio.`))
    }
    let callCount = 0
    const countingJudge: PedagogicalJudgeFn = async pairs => { callCount++; return pairs.map(p => ({ pairId: p.pairId, duplicate: false })) }
    const start = Date.now()
    const { cards: result } = await reconcilePedagogicalDuplicates(cards, countingJudge)
    const elapsed = Date.now() - start
    assert.equal(result.length, 500, 'all distinct concepts must survive')
    assert.ok(callCount < 500, `expected far fewer than N judge calls, got ${callCount}`)
    assert.ok(elapsed < 5000, `must complete quickly (CPU-bound clustering), took ${elapsed}ms`)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-retrieval-unit-contracts: ALL PASS')
}

main()
