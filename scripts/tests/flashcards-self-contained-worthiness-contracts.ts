import assert from 'node:assert/strict'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { validateDeck } from '../../lib/materialBrain/flashcards/validate'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/index'
import type { FlashcardDeck, FlashcardDeckStore, GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Real-deck post-mortem closure (mission: "cierre REAL de Flashcards").
// A real 89-concept deck exposed 7 failure classes the synthetic FC-
// FINAL-* suite did not catch. This suite proves, generically (no
// chemistry/Clutch-2 hardcoding — one fixture per unrelated domain),
// that each class is now closed at the code level:
//
//   1. metadata that survives regex (colophon w/o trigger words)  -> SC-1/2
//   2. math/text duplication ("X" repeated back-to-back)          -> SC-3
//   3/4. pedagogical duplicate / near-zero information gain       -> SC-4/5
//   5. worked example over-fragmentation                          -> SC-6/7
//   6. figure/axis-label trivia                                   -> SC-8
//   7. CONTEXTLESS cards (P0, new canonical rule)                 -> SC-9..17
//        (cross-domain matrix: chemistry, medicine, history, law,
//         programming, statistics, graph/table — P10)
//   ROOT CAUSE: stale frozen decks never revalidated after a
//   validator fix                                                 -> SC-18
// ============================================================

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}, tier: 'critical' | 'supporting' | 'contextual' = 'supporting'): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: label, semanticKey: label, qualifiers: extra.qualifiers || [] },
    importance: { tier, signals: extra.signals || ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: statement, chunkId: 'c-1' }],
    evidence: [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: statement, chunkId: 'c-1' }],
    domainTags: extra.domainTags || [],
    // Test fixtures pass human-readable qualifier text (e.g. "Experimento 3") —
    // realistic displayQualifiers, same value, unless overridden via extra.
    displayQualifiers: extra.displayQualifiers || extra.qualifiers || [],
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

class InMemoryDeckStore implements FlashcardDeckStore {
  private map = new Map<string, FlashcardDeck>()
  async get(fingerprint: string) { return this.map.get(fingerprint) || null }
  async set(fingerprint: string, deck: FlashcardDeck) { this.map.set(fingerprint, deck) }
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
  console.log('\n── Flashcards self-contained/worthiness contracts ──\n')

  // ---------------------------------------------------------------
  // SC-1/2: metadata semantic gate (P6)
  // ---------------------------------------------------------------
  await test('SC-1: bare colophon (publisher+year, no trigger word, isolated, no relations) is excluded', () => {
    const units = [unit('u-colo', 'fact', 'Editorial', 'Prentice-Hall Inc., 2009.')]
    const plan = planFlashcards(brain('sc-1', units))
    assert.equal(plan.targetedUnitIds.length, 0, 'a bare imprint line with no domain relevance must never become a target')
  })

  await test('SC-2: subject-relevant author/year fact (connected to the graph, domain-tagged) is kept', () => {
    const units = [
      unit('u-author', 'fact', 'Publicación de la obra', 'La obra fue publicada por Prentice-Hall Inc. en 1998, marcando el inicio del movimiento.', { domainTags: ['historia-literaria'] }, 'critical'),
      unit('u-movement', 'concept', 'Movimiento literario', 'El movimiento surgió como respuesta a las convenciones previas.'),
    ]
    const plan = planFlashcards(brain('sc-2', units, [relation('r1', 'depends_on', 'u-movement', 'u-author')]))
    assert.ok(plan.targetedUnitIds.includes('u-author'), 'a publication fact the material actually teaches (connected, domain-tagged, critical) must NOT be excluded just because it mentions a publisher+year')
  })

  // ---------------------------------------------------------------
  // SC-3: math/text duplication root-cause fix
  // ---------------------------------------------------------------
  await test('SC-3: immediate self-repeated expression/number is rejected (generic, not chemistry-specific)', () => {
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: ['u1'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
    const badAnswers = [
      'La concentración calculada es aproximadamente 1.87×10−31.87×10−3 M.', // real-deck evidence, duplicated scientific notation
      'El resultado final es 42.500042.5000 unidades.', // generic numeric duplication, non-chemistry
    ]
    for (const answer of badAnswers) {
      const validated = validateDeck([fakeCard(pc, 'q', answer)] as any, plan as any)
      assert.equal(validated[0].validated, false, `"${answer}" must be rejected as duplicated content`)
    }
  })

  await test('SC-3b: legitimate short coincidental repeats are NOT falsely rejected', () => {
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: ['u1'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
    const goodAnswers = [
      'La velocidad de la luz es aproximadamente $3 \\times 10^8$ m/s en el vacío.',
      'El resultado obtenido es de 100 unidades tras aplicar el método descrito.',
    ]
    for (const answer of goodAnswers) {
      const validated = validateDeck([fakeCard(pc, '¿Cuál es el valor calculado según el método X?', answer)] as any, plan as any)
      assert.equal(validated[0].validated, true, `"${answer}" must NOT be falsely rejected: ${JSON.stringify(validated[0].validationErrors)}`)
    }
  })

  // ---------------------------------------------------------------
  // SC-4/5: card-worthiness / information value (P1)
  // ---------------------------------------------------------------
  await test('SC-4: a "context tag" answer (near-zero information gain) is rejected', () => {
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: ['u1'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
    const cases: [string, string][] = [
      ['¿En qué contexto se utiliza el término "constante de equilibrio"?', 'En el contexto de equilibrio químico.'],
      ['¿Con qué está relacionado el efecto de los cambios en la temperatura?', 'Con equilibrio químico.'],
      ['In what context is the term "derivative" used?', 'In the context of calculus.'],
    ]
    for (const [q, a] of cases) {
      const validated = validateDeck([fakeCard(pc, q, a)] as any, plan as any)
      assert.equal(validated[0].validated, false, `"${q}" -> "${a}" gives no real information and must be rejected`)
    }
  })

  await test('SC-5: a substantive answer sharing the same "context" phrasing is kept (info-gain present)', () => {
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: ['u1'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
    const validated = validateDeck([fakeCard(
      pc,
      '¿Qué establece la constante de equilibrio sobre un sistema en reposo?',
      'Establece la relación fija entre las concentraciones de productos y reactivos una vez alcanzado el equilibrio dinámico.',
    )] as any, plan as any)
    assert.equal(validated[0].validated, true)
  })

  // ---------------------------------------------------------------
  // SC-6/7: worked-example consolidation (P2) — generic across domains
  // ---------------------------------------------------------------
  await test('SC-6: intermediate worked-example data points are consolidated, not exploded 1:1', () => {
    const example = unit('u-ex', 'example', 'Cálculo del resultado final', 'Un ejemplo aplica el método para llegar a un resultado.', {}, 'critical')
    const subFacts = [
      unit('u-setup', 'fact', 'Dato inicial', 'El valor inicial del sistema es 10.'),
      unit('u-temp', 'fact', 'Temperatura', 'La temperatura del experimento es 25 grados.'),
      unit('u-step1', 'fact', 'Paso 1', 'Se aplica la primera transformación.'),
      unit('u-step2', 'fact', 'Paso 2', 'Se aplica la segunda transformación.'),
      unit('u-interim', 'fact', 'Cambio intermedio', 'El cambio intermedio calculado es 3.2.'),
    ]
    const conclusion = unit('u-final', 'fact', 'Resultado final', 'El resultado final del ejemplo es 7.8, la conclusión relevante.', {}, 'critical')
    const relations = [...subFacts, conclusion].map((u, i) => relation(`r-${i}`, 'example_of', u.id, 'u-ex'))
    const plan = planFlashcards(brain('sc-6', [example, ...subFacts, conclusion], relations))
    // Only the example itself + the critical-tier conclusion should
    // survive as independent targets — never one card per transient datum.
    assert.deepEqual([...plan.targetedUnitIds].sort(), ['u-ex', 'u-final'].sort(), `expected only the example + the critical conclusion, got ${JSON.stringify(plan.targetedUnitIds)}`)
    const consolidated = plan.skipped.filter(s => s.reason === 'consolidated_into_worked_example')
    assert.equal(consolidated.length, subFacts.length, 'every non-critical intermediate datum must be recorded as consolidated, never silently dropped')
  })

  await test('SC-7: the critical method/conclusion of a worked example remains covered (P2 does not lose the important part)', () => {
    const example = unit('u-ex2', 'example', 'Caso clínico ilustrativo', 'Un caso clínico ilustra el método diagnóstico.', {}, 'critical')
    const finding = unit('u-vital', 'fact', 'Signo vital anómalo', 'El paciente presenta una frecuencia cardiaca de 130 lpm.')
    const diagnosis = unit('u-dx', 'fact', 'Diagnóstico alcanzado', 'El diagnóstico alcanzado tras el caso es taquicardia sinusal.', {}, 'critical')
    const relations = [relation('r1', 'example_of', 'u-vital', 'u-ex2'), relation('r2', 'example_of', 'u-dx', 'u-ex2')]
    const plan = planFlashcards(brain('sc-7', [example, finding, diagnosis], relations))
    assert.ok(plan.targetedUnitIds.includes('u-dx'), 'the critical diagnostic conclusion must remain an independent target')
    assert.ok(!plan.targetedUnitIds.includes('u-vital'), 'the non-critical intermediate finding is consolidated into the example')
  })

  // ---------------------------------------------------------------
  // SC-8: figure/axis-label triviality (P3)
  // ---------------------------------------------------------------
  await test('SC-8: bare axis-label trivia is excluded unless the axis convention IS the lesson', () => {
    const trivial = unit('u-axis', 'fact', 'Eje X', 'El eje X representa el tiempo transcurrido.')
    const meaningful = unit('u-axis2', 'fact', 'Convención de escala', 'El eje Y representa la magnitud en escala logarítmica, la clave para interpretar el diagrama de Bode.', {}, 'critical')
    const plan = planFlashcards(brain('sc-8', [trivial, meaningful]))
    assert.ok(!plan.targetedUnitIds.includes('u-axis'), 'trivial axis-label fact must be excluded')
    assert.ok(plan.targetedUnitIds.includes('u-axis2'), 'a critical-tier axis/notation convention the material actually teaches must survive')
  })

  // ---------------------------------------------------------------
  // SC-9..17: SELF-CONTAINED RETRIEVAL (P0) — cross-domain matrix (P10)
  // ---------------------------------------------------------------
  function assertContextless(label: string, u: KnowledgeUnit, question: string, answer: string) {
    return test(label, () => {
      const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
      const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
      const b = brain('sc-ctx-' + u.id, [u])
      const validated = validateDeck([fakeCard(pc, question, answer)] as any, plan as any, b)
      assert.equal(validated[0].validated, false, `"${question}" must be rejected as contextless: ${JSON.stringify(validated[0].validationErrors)}`)
    })
  }
  // P0 mission ("REPAIRABLE context, never invented"): when the unit
  // already carries a qualifier, a naked/contextless question is now
  // deterministically repaired (qualifier prepended) and accepted —
  // `assertContextless` above stays reserved for the genuinely
  // NOT-REPAIRABLE case (no qualifiers at all on the unit).
  function assertRepaired(label: string, u: KnowledgeUnit, question: string, answer: string) {
    return test(label, () => {
      const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
      const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
      const b = brain('sc-repaired-' + u.id, [u])
      const validated = validateDeck([fakeCard(pc, question, answer)] as any, plan as any, b)
      assert.equal(validated[0].validated, true, `"${question}" should be repaired and accepted: ${JSON.stringify(validated[0].validationErrors)}`)
      assert.notEqual(validated[0].question, question, 'the question must actually be repaired')
    })
  }
  function assertSelfContained(label: string, u: KnowledgeUnit, question: string, answer: string) {
    return test(label, () => {
      const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
      const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
      const b = brain('sc-ctx-ok-' + u.id, [u])
      const validated = validateDeck([fakeCard(pc, question, answer)] as any, plan as any, b)
      assert.equal(validated[0].validated, true, `"${question}" must be accepted (self-contained): ${JSON.stringify(validated[0].validationErrors)}`)
    })
  }

  // Chemistry (the reported real bug — genericized as one of several domains)
  await assertRepaired(
    'SC-9 [chemistry]: naked numeric question without identifying experiment/system is deterministically repaired',
    unit('u-no2', 'event_or_data', 'Concentración final de NO2', 'aproximadamente 0.0310 M', { qualifiers: ['Experimento 3'] }),
    '¿Cuál es la concentración de NO2 en equilibrio?',
    'aproximadamente 0.0310.',
  )
  await assertSelfContained(
    'SC-10 [chemistry]: same fact WITH identifying experiment/system context is accepted',
    unit('u-no2b', 'event_or_data', 'Concentración final de NO2', 'aproximadamente 0.0310 M', { qualifiers: ['Experimento 3'] }),
    'En el Experimento 3 del sistema N2O4⇌2NO2, que comienza con [NO2]=0.0400 M, ¿qué concentración de NO2 se alcanza en el equilibrio?',
    'Aproximadamente 0.0310 M.',
  )

  // Medicine
  await assertRepaired(
    'SC-11 [medicine]: "what is the diagnosis" without any case findings is deterministically repaired',
    unit('u-dx1', 'fact', 'Diagnóstico del caso', 'El diagnóstico es neumonía bacteriana.', { qualifiers: ['Caso 2'] }),
    '¿Cuál es el diagnóstico?',
    'Neumonía bacteriana.',
  )
  await assertSelfContained(
    'SC-12 [medicine]: diagnosis question WITH case findings is accepted',
    unit('u-dx2', 'fact', 'Diagnóstico del caso', 'El diagnóstico es neumonía bacteriana.', { qualifiers: ['Caso 2'] }),
    'En el Caso 2, un paciente con fiebre, tos productiva y crepitantes en la auscultación pulmonar, ¿cuál es el diagnóstico más probable?',
    'Neumonía bacteriana.',
  )

  // Graph/figure
  await assertRepaired(
    'SC-13 [graph]: "what does the Y axis represent" without naming the graph is deterministically repaired',
    unit('u-y1', 'event_or_data', 'Interpretación del eje Y', 'representa la concentración molar', { qualifiers: ['Figura 4'] }),
    '¿Qué representa el eje Y?',
    'La concentración molar.',
  )

  // Table
  await assertRepaired(
    'SC-14 [table]: comparative question without naming the compared entities/table is deterministically repaired',
    unit('u-tab1', 'event_or_data', 'Valor más alto de la tabla', 'el compuesto C tuvo el valor más alto', { qualifiers: ['Tabla 2'] }),
    '¿Cuál tuvo el valor más alto?',
    'El compuesto C.',
  )
  await assertSelfContained(
    'SC-15 [table]: same comparison WITH the compared entities named is accepted',
    unit('u-tab2', 'event_or_data', 'Valor más alto de la tabla', 'el compuesto C tuvo el valor más alto', { qualifiers: ['Tabla 2'] }),
    'En la Tabla 2, que compara la solubilidad de los compuestos A, B y C, ¿cuál tuvo el valor más alto?',
    'El compuesto C.',
  )

  // Programming
  await assertRepaired(
    'SC-16 [programming]: "what does this code print" without the code itself is deterministically repaired',
    unit('u-code1', 'fact', 'Salida del fragmento de código', 'el fragmento imprime 42', { qualifiers: ['Fragmento 5'] }),
    '¿Qué imprime este código?',
    '42.',
  )

  // Statistics
  await assertRepaired(
    'SC-17 [statistics]: "what is the mean" without naming the dataset is deterministically repaired',
    unit('u-mean1', 'event_or_data', 'Media de la muestra', 'la media es 15.2', { qualifiers: ['Muestra B'] }),
    '¿Cuál es la media?',
    '15.2.',
  )

  // ---------------------------------------------------------------
  // SC-18: ROOT CAUSE — stale frozen decks now get revalidated when the
  // validator's own rule set changes (previously: a deck built under an
  // older, less strict validator was restored forever by restore-first,
  // even after validate.ts itself was fixed — the real reason corrupted/
  // contextless/duplicate cards survived in the live Clutch 2 deck).
  // ---------------------------------------------------------------
  await test('SC-18: a deck persisted without validatorVersion (pre-fix) is treated as stale and rebuilt', async () => {
    const b = brain('sc-18', [unit('u-no2c', 'event_or_data', 'Concentración final', 'aproximadamente 0.0310 M', { qualifiers: ['Experimento 3'] })])
    const store = new InMemoryDeckStore()
    // Simulate a deck frozen by an OLDER build, before validatorVersion
    // existed and before the contextless-question gate existed — the
    // exact shape of the real corrupted Clutch 2 deck.
    await store.set(b.scope.fingerprint, {
      scope: b.scope,
      meta: {
        schemaVersion: '1.0.0', plannerVersion: '1.1.0', generatorVersion: '1.0.0',
        // validatorVersion intentionally OMITTED — legacy shape
        status: 'ready', generatedAt: new Date(0).toISOString(), llmCallsUsed: 1, retries: 0,
      } as any,
      cards: [{
        id: 'stale', sourceUnitIds: ['u-no2c'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r',
        question: '¿Cuál es la concentración de NO2 en equilibrio?', answer: 'aproximadamente 0.0310.',
        provenance: [], generatorVersion: '1.0.0', generatedAt: new Date(0).toISOString(), validated: true, validationErrors: [],
      }],
      coverage: {
        targetedUnitIds: ['u-no2c'], targetedRelationIds: [], coveredUnitIds: ['u-no2c'], coveredRelationIds: [],
        status: 'complete', metrics: { plannedCards: 1, validCards: 1, failedCards: 0, targetedUnits: 1, coveredUnits: 1, targetedRelations: 0, coveredRelations: 0 },
      },
    })
    let calls = 0
    const result = await getOrBuildFlashcardDeck(b, store, {
      generateBatchFn: async cards => {
        calls++
        return new Map(cards.map(c => [c.id, fakeCard(c, 'En el Experimento 3, ¿qué concentración final de NO2 se alcanza?', 'Aproximadamente 0.0310 M.')]))
      },
    })
    assert.ok(calls > 0, 'SC-18: the stale pre-validatorVersion deck must NOT be trusted as-is — it must regenerate through the current gates')
    assert.equal(result.deck?.cards[0]?.question, 'En el Experimento 3, ¿qué concentración final de NO2 se alcanza?', 'the regenerated (self-contained) card must replace the stale contextless one')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-self-contained-worthiness-contracts: ALL PASS')
}

main()
