import assert from 'node:assert/strict'
import { reconcilePedagogicalDuplicates } from '../../lib/materialBrain/flashcards/pedagogicalDedup'
import type { GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { PedagogicalJudgeFn } from '../../lib/materialBrain/flashcards/pedagogicalDedup'

// ============================================================
// PHASE 2 — pedagogical dedup QUALITY. Root cause (see delivery report):
// the deterministic candidate-discovery/bucketing/threshold pipeline was
// never the problem — every suspicious real-deck pair (catalyst family,
// Kc/Keq formula family, sólidos/líquidos family) DID reach the judge.
// The judge's own PROMPT was the bug: blanket exemptions ("cause vs
// consequence NEVER duplicates on that basis alone", "formula vs the
// meaning of one of its variables") let a card survive purely because it
// carried a different cognitiveType/sourceUnitId label, even when its
// answer content was a verbatim subset of (or literal duplicate of) its
// sibling. This suite reproduces the 3 real families with mock judges
// that follow the NEW contract (content-based subset/superset reasoning,
// `reason` + `preferSurvivor` honored) and proves the mechanism — not
// the LLM's judgment quality, which cannot be unit-tested — merges the
// right side and preserves coverage.
// ============================================================

function card(
  id: string,
  unitIds: string[],
  cognitiveType: PlannedCard['cognitiveType'],
  question: string,
  answer: string,
  extra: { relationIds?: string[]; conceptClusterId?: string } = {},
): GeneratedFlashcard {
  return {
    id, sourceUnitIds: unitIds, sourceRelationIds: extra.relationIds || [],
    retrievalObjective: 'x', cognitiveType, rationale: 'r', question, answer,
    conceptClusterId: extra.conceptClusterId,
    provenance: [], generatorVersion: '1.0.0', generatedAt: new Date().toISOString(),
    validated: true, validationErrors: [],
  } as any
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err?.stack || err)); failed++ }
}

async function main() {
  console.log('\n── Flashcards pedagogical-dedup QUALITY contracts (PHASE 2) ──\n')

  // ── Real-deck Group A: catalizadores (#2 / #40 / #45) ──
  await test('A. #2/#45 (near-identical question, #45 is the superset) deduplicate; #40 (distinct rate-mechanism target) survives', async () => {
    const c2 = card('c2', ['concept-cat-equilibrio'], 'recall',
      '¿Cómo afecta el uso de un catalizador al equilibrio químico?',
      'Cuando se utiliza un catalizador, el equilibrio se alcanza más rápido, pero la composición del equilibrio sigue siendo la misma.',
      { conceptClusterId: 'sk:equilibrio quimico' })
    const c40 = card('c40', ['concept-catalizadores'], 'recall',
      '¿Cuál es el efecto de los catalizadores en las velocidades de reacción?',
      'Los catalizadores aumentan la velocidad de las reacciones directa e inversa.',
      { conceptClusterId: 'sk:catalizadores' })
    const c45 = card('c45', ['concept-catalizadores', 'concept-cat-equilibrio'], 'comprehension',
      '¿Cómo afectan los catalizadores al equilibrio químico?',
      'Los catalizadores aumentan la velocidad de las reacciones directa e inversa, lo que provoca que se alcance el equilibrio químico más rápido, pero la composición del equilibrio permanece igual.',
      { relationIds: ['rel-cat-eq'], conceptClusterId: 'sk:catalizadores' })

    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => {
      const ids = [p.a.id, p.b.id].sort().join('|')
      if (ids === 'c2|c45') return { pairId: p.pairId, duplicate: true, reason: 'subset_superset', preferSurvivor: p.a.id === 'c45' ? 'a' : 'b' }
      if (ids === 'c40|c45') return { pairId: p.pairId, duplicate: false, reason: 'distinct_application' }
      return { pairId: p.pairId, duplicate: false, reason: 'complementary_knowledge' }
    })

    const result = await reconcilePedagogicalDuplicates([c2, c40, c45], judge)
    const survivorIds = result.cards.map(c => c.id).sort()
    assert.deepEqual(survivorIds, ['c40', 'c45'], `expected c2 merged into c45, c40 kept as its own card, got ${JSON.stringify(survivorIds)}`)
    const survivor45 = result.cards.find(c => c.id === 'c45')!
    assert.ok(survivor45.sourceUnitIds.includes('concept-cat-equilibrio'), 'coverage of c2\'s unit must be preserved via c45')
  })

  // ── Real-deck Group B: constante de equilibrio Kc/Keq (#11 / #13 / #14) ──
  await test('B. #13 (general question, subset of #11) merges into #11; #14 (named-reaction instance) survives distinct', async () => {
    const c11 = card('c11', ['formula-kfkr', 'formula-conc-generic'], 'recall',
      '¿Cuál es la expresión de la constante de equilibrio y qué significa cada variable?',
      'La expresión es $k_f / k_r = [NO_2]^2 / [N_2O_4]$. Donde $k_f$ es la constante de velocidad directa, $k_r$ la inversa, $[NO_2]$ y $[N_2O_4]$ las concentraciones.')
    const c13 = card('c13', ['formula-kfkr'], 'recall',
      '¿Cuál es la fórmula de la constante de equilibrio (Keq) y qué significa cada variable?',
      'La fórmula es $K_{eq} = k_f / k_r$. Donde $K_{eq}$ es la constante de equilibrio, $k_f$ la constante de velocidad hacia adelante, y $k_r$ la inversa.')
    const c14 = card('c14', ['formula-kfkr-n2o4', 'formula-conc-n2o4'], 'recall',
      '¿Cuál es la fórmula de la constante de equilibrio (Keq) para la reacción N2O4<=>2NO2 y qué significa cada variable?',
      'La fórmula es $K_{eq} = [NO_2]^2 / [N_2O_4]$. Donde $K_{eq}$ es la constante de equilibrio, $[NO_2]$ es la concentración de $NO_2$, y $[N_2O_4]$ la de $N_2O_4$.')

    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => {
      const ids = [p.a.id, p.b.id].sort().join('|')
      if (ids === 'c11|c13') return { pairId: p.pairId, duplicate: true, reason: 'subset_superset', preferSurvivor: p.a.id === 'c11' ? 'a' : 'b' }
      return { pairId: p.pairId, duplicate: false, reason: 'distinct_application' }
    })

    const result = await reconcilePedagogicalDuplicates([c11, c13, c14], judge)
    const survivorIds = result.cards.map(c => c.id).sort()
    assert.deepEqual(survivorIds, ['c11', 'c14'], `expected c13 merged into c11, c14 kept distinct, got ${JSON.stringify(survivorIds)}`)
    const survivor11 = result.cards.find(c => c.id === 'c11')!
    assert.ok(survivor11.sourceUnitIds.includes('formula-kfkr'), 'coverage of c13\'s unit must be preserved via c11')
  })

  // ── Real-deck Group C: sólidos y líquidos en equilibrio (#22 / #44 / #50) ──
  await test('C. #22/#50 (upstream near-duplicate units, same proposition) merge; #44 (distinct consequence) survives', async () => {
    const c22 = card('c22', ['concept-sl-1'], 'recall',
      '¿Cómo se describen las concentraciones de sólidos y líquidos en el contexto del equilibrio químico?',
      'Las concentraciones de sólidos y líquidos son esencialmente constantes.',
      { conceptClusterId: 'sk:concentraciones solidos liquidos' })
    const c50 = card('c50', ['concept-sl-2'], 'recall',
      'En un sistema a temperatura constante, ¿cómo se comportan las concentraciones de los sólidos y líquidos?',
      'Las concentraciones de sólidos y líquidos permanecen constantes.',
      { conceptClusterId: 'sk:constancia concentraciones solidos liquidos' })
    const c44 = card('c44', ['concept-sl-1', 'fact-expr-eq'], 'comprehension',
      '¿Por qué las concentraciones de sólidos y líquidos no aparecen en la expresión de equilibrio?',
      'Las concentraciones de sólidos y líquidos no aparecen en la expresión de equilibrio porque son esencialmente constantes.',
      { relationIds: ['rel-sl-expr'], conceptClusterId: 'sk:concentraciones solidos liquidos' })

    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => {
      const ids = [p.a.id, p.b.id].sort().join('|')
      if (ids === 'c22|c50') return { pairId: p.pairId, duplicate: true, reason: 'same_retrieval', preferSurvivor: p.a.id === 'c22' ? 'a' : 'b' }
      return { pairId: p.pairId, duplicate: false, reason: 'distinct_consequence' }
    })

    const result = await reconcilePedagogicalDuplicates([c22, c44, c50], judge)
    const survivorIds = result.cards.map(c => c.id).sort()
    assert.deepEqual(survivorIds, ['c22', 'c44'], `expected c50 merged into c22, c44 kept (real distinct consequence), got ${JSON.stringify(survivorIds)}`)
    const survivor22 = result.cards.find(c => c.id === 'c22')!
    assert.ok(survivor22.sourceUnitIds.includes('concept-sl-2'), 'coverage of c50\'s unit must be preserved via c22')
  })

  // ── Generic contract tests (1-10) ──

  await test('1. same proposition + different wording => merge', async () => {
    const a = card('a1', ['u1'], 'recall', '¿Qué es X?', 'X es una sustancia que reacciona con Y para formar Z.')
    const b = card('b1', ['u1'], 'recall', '¿Cómo se define X?', 'Se define X como la sustancia que reacciona con Y produciendo Z.')
    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true, reason: 'same_retrieval' }))
    const result = await reconcilePedagogicalDuplicates([a, b], judge)
    assert.equal(result.cards.filter(c => !c.sourceUnitIds.includes('__never__')).length, 1)
  })

  await test('2. different sourceUnitIds + same recovered knowledge => merge', async () => {
    const a = card('a2', ['u-alpha'], 'recall', '¿Qué ocurre con la presión al comprimir el gas?', 'La presión del gas aumenta al comprimirlo.')
    const b = card('b2', ['u-beta'], 'recall', '¿Qué le pasa a la presión si se reduce el volumen del gas?', 'Al reducir el volumen, la presión del gas aumenta.')
    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true, reason: 'same_answer_content' }))
    const result = await reconcilePedagogicalDuplicates([a, b], judge)
    assert.equal(result.cards.length, 1)
    assert.deepEqual(result.cards[0].sourceUnitIds.sort(), ['u-alpha', 'u-beta'], 'merge must preserve coverage union across different sourceUnitIds')
  })

  await test('3. same sourceUnit + genuinely distinct operations => keep both', async () => {
    const a = card('a3', ['u-shared'], 'recall', '¿Cuál es la fórmula de la ley de Ohm?', 'V = I × R.')
    const b = card('b3', ['u-shared'], 'application', 'Si I=2A y R=5Ω, ¿cuál es V?', 'V = 2 × 5 = 10V.')
    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: false, reason: 'distinct_application' }))
    const result = await reconcilePedagogicalDuplicates([a, b], judge)
    assert.equal(result.cards.length, 2)
  })

  await test('4. recall vs application, truly distinct knowledge => keep both', async () => {
    const a = card('a4', ['u-law'], 'recall', '¿Qué establece la segunda ley de Newton?', 'F = m × a.')
    const b = card('b4', ['u-law'], 'application', 'Un objeto de 2kg acelera a 3m/s². ¿Cuál es la fuerza neta?', 'F = 2 × 3 = 6N.')
    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: false, reason: 'distinct_application' }))
    const result = await reconcilePedagogicalDuplicates([a, b], judge)
    assert.equal(result.cards.length, 2)
  })

  await test('5. different declared cognitiveType but equivalent content => merge (labels are signals, not authority)', async () => {
    // Bucketed apart at cognitiveType level (recall/comprehension merge into
    // one bucket already; 'application' vs 'recall' would normally never
    // even compare) — this test exercises the case where they DO share a
    // conceptClusterId (cross-bucket cluster pass) and the judge correctly
    // recognizes the "application" card adds nothing beyond the recall card.
    const a = card('a5', ['u-x'], 'recall', '¿Qué establece la ley de conservación de la energía?', 'La energía total de un sistema aislado permanece constante.', { conceptClusterId: 'sk:conservacion-energia' })
    const b = card('b5', ['u-y'], 'application', 'En un sistema aislado, ¿qué ocurre con la energía total?', 'La energía total permanece constante, sin importar las transformaciones internas.', { conceptClusterId: 'sk:conservacion-energia' })
    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true, reason: 'same_retrieval' }))
    const result = await reconcilePedagogicalDuplicates([a, b], judge)
    assert.equal(result.cards.length, 1, 'a cognitiveType label difference must not shield an actual content duplicate')
  })

  await test('6. subset/superset: survivor keeps the coverage needed without losing it', async () => {
    const narrow = card('narrow6', ['u-n'], 'recall', '¿Qué le pasa a la velocidad de reacción con un catalizador?', 'Aumenta.')
    const broad = card('broad6', ['u-n', 'u-b'], 'comprehension', '¿Cómo afecta un catalizador a la reacción?', 'Un catalizador aumenta la velocidad de la reacción sin alterar la posición de equilibrio.', { relationIds: ['rel-x'] })
    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true, reason: 'subset_superset', preferSurvivor: p.a.id === 'broad6' ? 'a' : 'b' }))
    const result = await reconcilePedagogicalDuplicates([narrow, broad], judge)
    assert.equal(result.cards.length, 1)
    assert.equal(result.cards[0].id, 'broad6', 'the superset must survive, never the narrower subset')
    assert.deepEqual(result.cards[0].sourceUnitIds.sort(), ['u-b', 'u-n'])
    assert.deepEqual(result.cards[0].sourceRelationIds, ['rel-x'])
  })

  await test('7. coverage union after merge includes both sourceUnitIds and sourceRelationIds', async () => {
    const a = card('a7', ['u-p'], 'recall', '¿Qué es P?', 'P es una propiedad fundamental del sistema.', { relationIds: ['rel-p1'] })
    const b = card('b7', ['u-q'], 'recall', '¿Cómo se describe P?', 'P se describe como una propiedad fundamental del sistema.', { relationIds: ['rel-p2'] })
    const judge: PedagogicalJudgeFn = async pairs => pairs.map(p => ({ pairId: p.pairId, duplicate: true, reason: 'same_retrieval' }))
    const result = await reconcilePedagogicalDuplicates([a, b], judge)
    assert.equal(result.cards.length, 1)
    assert.deepEqual(result.cards[0].sourceUnitIds.sort(), ['u-p', 'u-q'])
    assert.deepEqual(result.cards[0].sourceRelationIds.sort(), ['rel-p1', 'rel-p2'])
  })

  await test('8. judge malformed/fabricated pairId => fails closed (kept distinct)', async () => {
    const a = card('a8', ['u-1'], 'recall', '¿Qué es M?', 'M es una magnitud escalar que caracteriza la masa de un cuerpo.')
    const b = card('b8', ['u-1'], 'recall', '¿Cómo se relaciona M con el peso?', 'El peso depende de M y de la aceleración gravitatoria del lugar.')
    const judge: PedagogicalJudgeFn = async () => [{ pairId: 'FABRICATED::NOT_REAL', duplicate: true, reason: 'same_retrieval' }]
    const result = await reconcilePedagogicalDuplicates([a, b], judge)
    assert.equal(result.cards.length, 2, 'a fabricated/mismatched pairId must never resolve a real pair — fail closed')
  })

  await test('9. deterministic obvious duplicate never reaches the judge (no extra call)', async () => {
    const a = card('a9', ['u-1'], 'recall', '¿Qué es N?', 'N es una magnitud escalar fundamental del sistema físico estudiado.')
    const b = card('b9', ['u-1'], 'recall', '¿Qué es N?', 'N es una magnitud escalar fundamental del sistema físico estudiado.')
    let judgeCalls = 0
    const judge: PedagogicalJudgeFn = async pairs => { judgeCalls++; return pairs.map(p => ({ pairId: p.pairId, duplicate: true })) }
    const result = await reconcilePedagogicalDuplicates([a, b], judge)
    assert.equal(result.cards.length, 1)
    assert.equal(judgeCalls, 0, 'a near-identical pair must resolve via the existing auto-merge threshold, never an extra judge call')
  })

  await test('10. deck with large N keeps judge cost bounded (unchanged candidate-discovery cost)', async () => {
    const cards: GeneratedFlashcard[] = []
    for (let i = 0; i < 200; i++) {
      cards.push(card(`n${i}`, [`u-${i}`], 'recall', `¿Qué es el hecho ${i}?`, `El hecho ${i} es una afirmación distinta y verificable número ${i}.`))
    }
    let judgeCalls = 0
    const judge: PedagogicalJudgeFn = async pairs => { judgeCalls++; return pairs.map(p => ({ pairId: p.pairId, duplicate: false })) }
    const result = await reconcilePedagogicalDuplicates(cards, judge)
    assert.equal(result.cards.length, 200, 'no false merges among genuinely distinct facts')
    assert.ok(judgeCalls < 20, `judge call count must stay bounded, got ${judgeCalls}`)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-pedagogical-dedup-quality-contracts: ALL PASS')
}

main()
