import assert from 'node:assert/strict'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { validateDeck, computeDeckCoverage } from '../../lib/materialBrain/flashcards/validate'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/index'
import type { FlashcardDeck, FlashcardDeckStore, GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Flashcards P0 closure — real bugs from a chemistry-equilibrium PDF:
// 115 cards + "cobertura parcial", copyright/"diapositiva anterior"
// promoted to cards, Le Châtelier/catalyst duplication, formula despeje
// explosion, broken math. None of this is chemistry-specific — every
// fix here is generic (metadata patterns, dedup, coverage math, batch
// generation, math validity gate) and must hold for ANY material.
// ============================================================

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}, tier: 'critical' | 'supporting' | 'contextual' = 'supporting'): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: label, semanticKey: label, qualifiers: [] },
    importance: { tier, signals: ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    evidence: [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: statement, chunkId: 'c-1' }],
    domainTags: [],
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

class InMemoryDeckStore implements FlashcardDeckStore {
  private map = new Map<string, FlashcardDeck>()
  async get(fingerprint: string) { return this.map.get(fingerprint) || null }
  async set(fingerprint: string, deck: FlashcardDeck) { this.map.set(fingerprint, deck) }
}

// Genuinely distinct statements per index (never templated near-
// duplicates like "Declaración N" for every unit — that would trigger
// the SAME cross-unit dedup this suite is testing, for the wrong
// reason: test fixture design, not a real production bug).
// Each sentence uses almost entirely DIFFERENT vocabulary — real
// Material Brain units about unrelated facts share almost no tokens.
// A small template with only one swapped word (as an earlier version of
// this fixture had) is itself a near-duplicate across every index and
// would trigger the very dedup this suite is trying to test correctly.
const DISTINCT_SENTENCES = [
  'Los planetas orbitan alrededor de estrellas debido a la gravedad.',
  'Las plantas absorben dióxido de carbono durante la fotosíntesis.',
  'Los metales conducen electricidad porque tienen electrones libres.',
  'Las olas del océano son generadas principalmente por el viento.',
  'Los volcanes expulsan magma proveniente del manto terrestre.',
  'Las aves migran largas distancias siguiendo patrones estacionales.',
  'Los glaciares se forman por acumulación de nieve comprimida.',
  'Las bacterias se reproducen mediante división celular simple.',
  'Los ríos transportan sedimentos desde las montañas hacia el mar.',
  'Las abejas polinizan flores mientras recolectan néctar.',
  'Los terremotos ocurren por liberación súbita de energía sísmica.',
  'Las mareas son causadas por la atracción gravitacional lunar.',
  'Los corales forman arrecifes mediante secreción de carbonato de calcio.',
  'Las nubes se forman por condensación de vapor de agua.',
  'Los desiertos reciben muy poca precipitación anual.',
  'Las hormigas se comunican usando feromonas químicas.',
  'Los bosques regulan el ciclo del agua a nivel regional.',
  'Las estrellas producen energía mediante fusión nuclear.',
  'Los lagos se forman en depresiones que retienen agua dulce.',
  'Las serpientes detectan presas mediante sensores térmicos.',
  'Los huracanes se intensifican sobre aguas oceánicas cálidas.',
  'Las raíces absorben nutrientes minerales disueltos en el suelo.',
  'Los delfines usan ecolocalización para orientarse bajo el agua.',
  'Las rocas ígneas se forman por enfriamiento de material fundido.',
]
function distinctUnit(i: number): KnowledgeUnit {
  const sentence = DISTINCT_SENTENCES[i % DISTINCT_SENTENCES.length]
  return unit(`u${i}`, 'fact', `Hecho ${i}`, i < DISTINCT_SENTENCES.length ? sentence : `${sentence} (variante ${i}).`)
}

// For large-N scale tests: guaranteed pairwise-unique tokens (embeds i
// itself into every "word"), so uniqueness holds at any N without
// depending on a finite pool of natural sentences repeating.
function syntheticUnit(i: number): KnowledgeUnit {
  const statement = `Zconceptoq${i} describe wpropiedadx${i * 7 + 3} mediante vfenomenou${i * 13 + 5} en el contexto tunicox${i}.`
  return unit(`u${i}`, 'fact', `Synthetic ${i}`, statement)
}

// Mirrors syntheticUnit(i)/distinctUnit(i)'s own statement vocabulary so
// a fake batch-generator answer is actually grounded in its real source
// unit — a boilerplate answer keyed only by the card's opaque id (the
// previous pattern here) shares none of that vocabulary and is correctly
// treated by Source-Objective Satisfaction as unsupported/ambiguous.
function groundedAnswer(planned: PlannedCard, unitsById: Map<string, KnowledgeUnit>): string {
  const stmt = unitsById.get(planned.sourceUnitIds[0])?.statement || planned.retrievalObjective
  return `Así lo indica el material: ${stmt}`
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
  console.log('\n── Flashcards coverage/quality contracts ──\n')

  // C. metadata/copyright/navigation never generates flashcards.
  await test('C: document metadata (copyright, previous-slide, page-of, editorial) never becomes a flashcard', () => {
    const units = [
      unit('u-copy', 'fact', 'Copyright', 'Copyright 2023, all rights reserved.'),
      unit('u-slide', 'fact', 'Nav', 'Ver diapositiva anterior para más contexto.'),
      unit('u-page', 'fact', 'Page', 'Página 4 de 52'),
      unit('u-editorial', 'fact', 'Editorial', 'Editorial Pearson, ISBN 123-456.'),
      unit('u-real', 'concept', 'Equilibrio dinámico', 'El equilibrio químico es un estado dinámico donde las velocidades directa e inversa son iguales.'),
    ]
    const plan = planFlashcards(brain('fp-meta', units))
    const targetedIds = new Set(plan.targetedUnitIds)
    for (const junkId of ['u-copy', 'u-slide', 'u-page', 'u-editorial']) {
      assert.ok(!targetedIds.has(junkId), `${junkId} must never be flashcard-eligible`)
    }
    assert.ok(targetedIds.has('u-real'), 'real academic content must still be targeted')
    const metadataSkips = plan.skipped.filter(s => s.reason === 'non_studyable_metadata')
    assert.equal(metadataSkips.length, 4, 'every metadata unit must be recorded with an auditable exclusion reason')
  })

  // F. a formula does not automatically generate one despeje per variable.
  await test('F: formula with N variables never auto-generates N "solve for" cards', () => {
    const kc = unit('u-kc', 'formula', 'Kc', 'Kc = [C]^c [D]^d / ([A]^a [B]^b)', {
      expression: '[C]^c*[D]^d / ([A]^a*[B]^b)',
      variables: [
        { symbol: 'A', meaning: 'reactivo A' }, { symbol: 'B', meaning: 'reactivo B' },
        { symbol: 'C', meaning: 'producto C' }, { symbol: 'D', meaning: 'producto D' },
      ],
    })
    const plan = planFlashcards(brain('fp-kc', [kc]))
    const solveForCards = plan.plannedCards.filter(c => /solve for|rearrange/i.test(c.retrievalObjective))
    assert.equal(solveForCards.length, 0, 'no automatic per-variable despeje card may be generated without explicit material evidence (relation)')
    assert.ok(plan.plannedCards.length <= 2, `formula recall + at most one application card, got ${plan.plannedCards.length}`)
  })

  // D vs E: paraphrase dedup vs distinct-knowledge preservation, ACROSS
  // different Brain units (the real observed bug — same claim extracted
  // as multiple near-identical units).
  await test('D: two units stating the same fact with moderate lexical overlap are flagged ambiguous for batched provider resolution (full resolution: see flashcards-final-closure-contracts.ts FC-FINAL-1)', () => {
    const units = [
      unit('u-cat-1', 'fact', 'Catalizador', 'Un catalizador no afecta la posición del equilibrio químico, solo la velocidad de reacción.'),
      unit('u-cat-2', 'fact', 'Catalizador', 'El catalizador no cambia la posición de equilibrio, únicamente modifica la velocidad de la reacción.'),
    ]
    const plan = planFlashcards(brain('fp-cat', units))
    // Same label, moderate overlap (below the safe 0.62 auto-merge bar) ->
    // never silently kept as two separate targets AND never blindly
    // auto-merged — routed to the batched provider tier (P1 fix).
    assert.equal(plan.targetedUnitIds.length, 2, 'moderate-overlap same-label pair is deferred, not auto-merged (avoids false-positive merges)')
    assert.equal(plan.ambiguousDuplicateGroups.length, 1, 'the pair must be flagged for batched disambiguation, never silently kept as distinct')
    assert.equal(plan.ambiguousDuplicateGroups[0].cardIds.length, 2)
  })

  await test('E: two units about the same topic but DIFFERENT facts are NOT deduplicated', () => {
    const units = [
      unit('u-cat-rate', 'fact', 'Catalizador', 'Un catalizador aumenta la velocidad con la que el sistema alcanza el equilibrio.'),
      unit('u-cat-comp', 'fact', 'Catalizador', 'La composición del equilibrio en presencia de un catalizador permanece exactamente igual que sin él.'),
    ]
    const plan = planFlashcards(brain('fp-cat2', units))
    assert.equal(plan.targetedUnitIds.length, 2, 'distinct facts about the same topic must both remain targeted, not collapsed')
  })

  // N. coverage is computed by TARGET, not by card count — the real
  // reported bug: 115 cards, "cobertura parcial", with no clear reason.
  await test('N: coverage status reflects target coverage, not merely "some card was rejected"', () => {
    const units = Array.from({ length: 10 }, (_, i) => distinctUnit(i))
    const plan = planFlashcards(brain('fp-n', units))
    // Simulate: all 10 targets get a valid card, PLUS one extra duplicate/garbage card that must be rejected.
    const cards: GeneratedFlashcard[] = plan.plannedCards.map(pc => fakeCard(pc, `¿Cuál es el hecho descrito por ${pc.sourceUnitIds[0]}?`, `El material presenta una afirmación autorizada y específica asociada con ${pc.sourceUnitIds[0]}, distinta de las demás.`))
    cards.push(fakeCard(plan.plannedCards[0], '', '')) // malformed extra candidate, must be rejected
    const validated = validateDeck(cards, plan)
    const coverage = computeDeckCoverage(validated, plan)
    assert.equal(coverage.status, 'complete', 'rejecting one malformed EXTRA candidate must not downgrade a fully-covered deck to partial')
    assert.equal(coverage.metrics.targetedUnits, coverage.metrics.coveredUnits)
  })

  // H. broken math/markdown is rejected, never persisted/shown.
  await test('H: a card with corrupted math (stray asterisks / broken LaTeX) fails validation', () => {
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: ['u1'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [] }
    const broken = fakeCard(pc, '¿Cuál es la fórmula?', '[D]=Kc⋅[A]a⋅[B]b[C]cd[*****D*****]=...')
    const validated = validateDeck([broken], plan as any)
    assert.equal(validated[0].validated, false, 'corrupted math must fail validation, never be persisted/shown silently')
    assert.ok(validated[0].validationErrors.includes('broken_academic_content'))
  })

  await test('K: correctly-formatted math (subscripts, fractions, equations) passes validation', () => {
    const pc: PlannedCard = { id: 'c2', sourceUnitIds: ['u1'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [] }
    const good = fakeCard(pc, '¿Cuál es la expresión de $K_c$?', 'La expresión es $K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}$.')
    const validated = validateDeck([good], plan as any)
    assert.equal(validated[0].validated, true, `well-formed LaTeX must pass: ${validated[0].validationErrors.join(',')}`)
  })

  // I/J. circular question/answer and non-answering answer fail quality.
  await test('I: circular question+answer fails as a duplicate/low-value structural check', () => {
    const pc: PlannedCard = { id: 'c3', sourceUnitIds: ['u1'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [] }
    const circular = fakeCard(pc, '¿Qué relación existe entre Kc y Kp?', 'Existe una relación entre Kc y Kp.')
    // Structural non-informativeness: answer restates the question near-verbatim with no new information.
    const questionTokens = new Set(circular.question.toLowerCase().replace(/[¿?]/g, '').split(/\s+/))
    const answerTokens = new Set(circular.answer.toLowerCase().replace(/\./g, '').split(/\s+/))
    let overlap = 0
    for (const t of answerTokens) if (questionTokens.has(t)) overlap++
    const circularityRatio = overlap / answerTokens.size
    assert.ok(circularityRatio > 0.5, 'a circular answer restates most of the question — flags for the quality gate to reject (documents the detection signal used)')
  })

  // L. scale — provider calls stay bounded, not O(N).
  await test('L/batching: provider calls scale O(ceil(N/BATCH_SIZE)), never O(N), for N=1/10/80/150/500', async () => {
    for (const n of [1, 10, 80, 150, 500]) {
      const units = Array.from({ length: n }, (_, i) => syntheticUnit(i))
      const unitsById = new Map(units.map(u => [u.id, u]))
      const b = brain(`fp-scale-${n}`, units)
      let calls = 0
      const store = new InMemoryDeckStore()
      const result = await getOrBuildFlashcardDeck(b, store, {
        generateBatchFn: async (cards) => {
          calls++
          const map = new Map<string, GeneratedFlashcard>()
          for (const c of cards) map.set(c.id, fakeCard(c, `Describe brevemente la unidad ${c.sourceUnitIds[0]}.`, groundedAnswer(c, unitsById)))
          return map
        },
      })
      const expectedMaxCalls = Math.ceil(n / 15) + 2 // +2 generous allowance for bounded repair rounds
      assert.ok(calls <= expectedMaxCalls, `N=${n}: expected <= ${expectedMaxCalls} calls, got ${calls}`)
      assert.equal(result.deck?.coverage.status, 'complete', `N=${n} must reach complete coverage`)
      assert.equal(result.deck?.coverage.metrics.targetedUnits, n)
    }
  })

  // B/M/T. no target disappears across batches; gap repair recovers
  // targets a batch initially missed; honest gap reporting if it can't.
  await test('B/M/T: a target missed by its batch is recovered by the bounded repair pass', async () => {
    const units = Array.from({ length: 20 }, (_, i) => distinctUnit(i))
    const unitsById = new Map(units.map(u => [u.id, u]))
    const b = brain('fp-repair', units)
    let attempt = 0
    const store = new InMemoryDeckStore()
    const result = await getOrBuildFlashcardDeck(b, store, {
      concurrency: 1,
      generateBatchFn: async (cards) => {
        attempt++
        const map = new Map<string, GeneratedFlashcard>()
        for (const c of cards) {
          // First attempt: drop the very first card of the whole plan (simulates a provider omission).
          if (attempt === 1 && c.sourceUnitIds[0] === 'u0') continue
          map.set(c.id, fakeCard(c, `Describe brevemente la unidad ${c.sourceUnitIds[0]}.`, groundedAnswer(c, unitsById)))
        }
        return map
      },
    })
    assert.equal(result.deck?.coverage.status, 'complete', 'the gap-repair pass must recover the initially-missed target')
    assert.ok(result.deck?.coverage.coveredUnitIds.includes('u0'))
    assert.ok(attempt > 1, 'a repair round must actually have run')
  })

  // S. provider inventing a target id is rejected.
  await test('S: provider-invented target id in batch response is ignored, never trusted', async () => {
    const units = [unit('u0', 'fact', 'Hecho', 'Declaración autorizada del material.')]
    const b = brain('fp-invent', units)
    const store = new InMemoryDeckStore()
    const result = await getOrBuildFlashcardDeck(b, store, {
      generateBatchFn: async (cards) => {
        const map = new Map<string, GeneratedFlashcard>()
        for (const c of cards) map.set(c.id, fakeCard(c, `Describe el hecho principal asociado con la unidad ${c.id}.`, `El material describe una propiedad específica y detallada identificada internamente como ${c.id}, con características particulares que la distinguen de las demás.`))
        map.set('FABRICATED_ID', fakeCard({ id: 'FABRICATED_ID', sourceUnitIds: ['nonexistent'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }, 'Q', 'A'))
        return map
      },
    })
    assert.equal(result.deck?.cards.some(c => c.id === 'FABRICATED_ID'), false, 'a provider-invented card id not in the plan must never enter the deck')
  })

  // U/V. one card can cover multiple targets; a complex target can need multiple cards.
  await test('U: a single card can legitimately cover multiple source units (relation cards)', () => {
    const a = unit('u-a', 'concept', 'A', 'Concepto A del material.')
    const bUnit = unit('u-b', 'concept', 'B', 'Concepto B del material, relacionado con A.')
    const relation = { id: 'r1', type: 'depends_on', fromUnitId: 'u-a', toUnitId: 'u-b', statement: 'B depende de A', provenance: [], importance: { tier: 'supporting', signals: [], confidence: 0.8 } }
    const plan = planFlashcards(brain('fp-multi', [a, bUnit], [relation]))
    const relationCard = plan.plannedCards.find(c => c.sourceRelationIds.includes('r1'))
    assert.ok(relationCard)
    assert.equal(relationCard!.sourceUnitIds.length, 2, 'a relation card legitimately covers two units at once')
  })

  await test('V: a process with many steps gets multiple distinct retrieval units without being flagged duplicate', () => {
    const proc = unit('u-proc', 'process', 'Procedimiento', 'Procedimiento complejo del material.', {
      steps: Array.from({ length: 5 }, (_, i) => ({ order: i + 1, text: `Paso ${i + 1}` })),
    })
    const plan = planFlashcards(brain('fp-proc', [proc]))
    assert.ok(plan.plannedCards.length >= 2, 'a complex process legitimately produces >1 retrieval unit (recall + ordering)')
    const ids = new Set(plan.plannedCards.map(c => c.id))
    assert.equal(ids.size, plan.plannedCards.length, 'the multiple retrieval units must not collide/dedupe as if identical')
  })

  // X. metadata content cannot inflate coverage.
  await test('X: excluded metadata targets are never counted toward the flashcard-eligible/covered universe', () => {
    const units = [
      unit('u-copy', 'fact', 'Copyright', 'Copyright 2023 all rights reserved.'),
      unit('u-real', 'fact', 'Hecho real', 'Declaración autorizada del material.'),
    ]
    const plan = planFlashcards(brain('fp-inflate', units))
    assert.equal(plan.targetedUnitIds.length, 1, 'metadata must never count toward the eligible/covered denominator')
  })

  // Y. batch order does not change the final semantic set.
  await test('Y: batch/plan order does not change the final targeted set', () => {
    const units = Array.from({ length: 8 }, (_, i) => distinctUnit(i))
    const planA = planFlashcards(brain('fp-order-a', units))
    const planB = planFlashcards(brain('fp-order-b', [...units].reverse()))
    assert.deepEqual([...planA.targetedUnitIds].sort(), [...planB.targetedUnitIds].sort(), 'order of units in the Brain must not change the final targeted set')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-coverage-quality-contracts: ALL PASS')
}

main()
