import assert from 'node:assert/strict'
import { planFlashcards } from '../../lib/materialBrain/flashcards/planner'
import { validateDeck } from '../../lib/materialBrain/flashcards/validate'
import { DOCUMENT_METADATA_TOPIC_PATTERN } from '../../lib/materialBrain/flashcards/documentMetadata'
import type { FlashcardPlan, GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Real-case mission: metadata eligibility (P3) + self-containedness /
// context gate (P4). Real bad cards from a live 75-target deck:
//
//   A. "¿Cuál es el año de los derechos de autor mencionados en el
//      texto?" — should never have been generated: pure document
//      colophon metadata, not academic content.
//   B. "¿Cuál es la reacción química que tiene lugar según el texto?"
//      — unresolved deixis ("según el texto"), unanswerable from the
//      card alone. Note: 11 words, so the OLD naked-value-question
//      length heuristic (<=9 words) silently let it through — this is
//      exactly why a length-independent deictic-referent check is
//      needed (see CTX-11/CTX-15 below).
//
// Every case below is genericized across domains — no chemistry/PDF-
// specific production logic, only the generic structural + deictic
// signals implemented in planner.ts / validate.ts.
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

function planWith(u: KnowledgeUnit): FlashcardPlan {
  return { plannerVersion: '1.0.0', plannedCards: [], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] } as any
}

async function main() {
  console.log('\n── Flashcards metadata eligibility + self-containedness/context contracts ──\n')

  // ---------------------------------------------------------------
  // META-CTX: planner-level metadata eligibility (P3)
  // ---------------------------------------------------------------
  await test('META-CTX-1: incidental copyright notice ("derechos de autor", no "reservados") is excluded', () => {
    const units = [unit('u-copy', 'fact', 'Nota legal', 'Derechos de autor © 2015 Editorial Ejemplo.')]
    const plan = planFlashcards(brain('meta-1', units))
    assert.equal(plan.targetedUnitIds.length, 0, 'a bare copyright notice must never become a target, even without the word "reservados"')
    assert.ok(plan.skipped.some(s => s.reason === 'non_studyable_metadata'), 'must be recorded with an auditable exclusion reason')
  })

  await test('META-CTX-2: publisher/footer metadata is excluded', () => {
    const units = [unit('u-pub', 'fact', 'Pie de página', 'Editorial Alfa, Imprenta Beta, 2020.')]
    const plan = planFlashcards(brain('meta-2', units))
    assert.equal(plan.targetedUnitIds.length, 0)
  })

  await test('META-CTX-3: page/navigation metadata is excluded', () => {
    const units = [
      unit('u-page', 'fact', 'Numeración', 'Página 4 de 120'),
      unit('u-nav', 'fact', 'Navegación', 'diapositiva anterior'),
    ]
    const plan = planFlashcards(brain('meta-3', units))
    assert.equal(plan.targetedUnitIds.length, 0)
  })

  await test('META-CTX-4: academic copyright-law fact (connected, domain-tagged, critical) is retained', () => {
    const units = [
      unit('u-law', 'fact', 'Duración del derecho de autor', 'El derecho de autor en muchas jurisdicciones dura la vida del autor más 70 años.', { domainTags: ['propiedad-intelectual'] }, 'critical'),
      unit('u-context', 'concept', 'Propiedad intelectual', 'La propiedad intelectual protege creaciones originales.'),
    ]
    const plan = planFlashcards(brain('meta-4', units, [relation('r1', 'depends_on', 'u-context', 'u-law')]))
    assert.ok(plan.targetedUnitIds.includes('u-law'), 'a material that actually teaches copyright law must not have that content suppressed')
  })

  await test('META-CTX-5: academic author/publication-year fact is retained when the material studies it', () => {
    const units = [
      unit('u-pubyear', 'fact', 'Año de publicación de la obra', 'La obra fue publicada por Prentice-Hall Inc. en 1998, marcando el inicio del movimiento estudiado.', { domainTags: ['historia-literaria'] }, 'critical'),
      unit('u-mov', 'concept', 'Movimiento literario', 'El movimiento surgió como respuesta a las convenciones previas.'),
    ]
    const plan = planFlashcards(brain('meta-5', units, [relation('r1', 'depends_on', 'u-mov', 'u-pubyear')]))
    assert.ok(plan.targetedUnitIds.includes('u-pubyear'))
  })

  await test('META-CTX-6: excluded metadata never counts as pending coverage', () => {
    const units = [unit('u-copy2', 'fact', 'Nota legal', 'Derechos de autor © 2015 Editorial Ejemplo.')]
    const plan = planFlashcards(brain('meta-6', units))
    // No targets at all -> computeDeckCoverage(status) will be 'complete'
    // for an empty deck, never 'partial'/'pending' for the excluded unit.
    assert.equal(plan.targetedUnitIds.length, 0)
    assert.equal(plan.skipped.filter(s => s.reason === 'non_studyable_metadata').length, 1)
  })

  // ---------------------------------------------------------------
  // META-CTX-7/8: validator-level second layer (generated-question intent)
  // ---------------------------------------------------------------
  await test('META-CTX-7 [real case A]: generated question about "the text\'s" copyright year is rejected even if the unit survived planning', () => {
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: ['u1'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
    const validated = validateDeck([fakeCard(pc, '¿Cuál es el año de los derechos de autor mencionados en el texto?', '2015.')] as any, plan as any)
    assert.equal(validated[0].validated, false)
    assert.ok(validated[0].validationErrors.includes('non_studyable_document_metadata'))
  })

  await test('META-CTX-8: a question about a real copyright-law CONCEPT (no self-reference to "the text") is NOT falsely rejected by the intent gate', () => {
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: ['u1'], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc], targetedUnitIds: ['u1'], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
    const validated = validateDeck([fakeCard(
      pc,
      '¿Cuánto dura el derecho de autor sobre una obra según la legislación estudiada en este curso?',
      'Dura la vida del autor más 70 años en la mayoría de jurisdicciones.',
    )] as any, plan as any)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  // ---------------------------------------------------------------
  // CTX: self-containedness / deictic-referent gate (P4), independent
  // of question length and unit kind — the real bug the old <=9-word
  // naked-value heuristic missed.
  // ---------------------------------------------------------------
  function assertRejectedCtx(label: string, u: KnowledgeUnit, question: string, answer: string) {
    return test(label, () => {
      const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
      const plan = planWith(u)
      const b = brain('ctx-bad-' + u.id, [u])
      const validated = validateDeck([fakeCard(pc, question, answer)] as any, plan as any, b)
      assert.equal(validated[0].validated, false, `"${question}" must be rejected as contextless: ${JSON.stringify(validated[0].validationErrors)}`)
    })
  }
  function assertAcceptedCtx(label: string, u: KnowledgeUnit, question: string, answer: string) {
    return test(label, () => {
      const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
      const plan = planWith(u)
      const b = brain('ctx-ok-' + u.id, [u])
      const validated = validateDeck([fakeCard(pc, question, answer)] as any, plan as any, b)
      assert.equal(validated[0].validated, true, `"${question}" must be accepted: ${JSON.stringify(validated[0].validationErrors)}`)
    })
  }
  // P0 mission ("REPAIRABLE context, never invented"): a question that
  // OMITS its unit's qualifier entirely (no fabricated/wrong instance
  // named) is now deterministically repaired — the authorized qualifier
  // text is prepended and the card is accepted with the repaired
  // question, never silently rejected when real context already exists
  // on the source unit.
  function assertRepairedCtx(label: string, u: KnowledgeUnit, question: string, answer: string) {
    return test(label, () => {
      const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
      const plan = planWith(u)
      const b = brain('ctx-repaired-' + u.id, [u])
      const validated = validateDeck([fakeCard(pc, question, answer)] as any, plan as any, b)
      assert.equal(validated[0].validated, true, `"${question}" should be repaired and accepted: ${JSON.stringify(validated[0].validationErrors)}`)
      assert.notEqual(validated[0].question, question, 'the question must actually be repaired (context added), not left untouched')
      for (const qualifier of u.identity.qualifiers) {
        assert.ok(validated[0].question.includes(qualifier), `repaired question must include the authorized qualifier "${qualifier}": ${validated[0].question}`)
      }
    })
  }

  await assertRepairedCtx(
    "CTX-1 [real case B, chemistry]: \"según el texto\" without explicit referent is deterministically repaired via the unit's qualifier (11-word case the old heuristic missed)",
    unit('u-rxn', 'fact', 'Reacción de equilibrio', 'N2O4(g) se descompone en 2NO2(g)', { qualifiers: ['Ejemplo 1'] }),
    '¿Cuál es la reacción química que tiene lugar según el texto?',
    'N2O4(g) ⇌ 2NO2(g)',
  )
  await assertAcceptedCtx(
    'CTX-1b: same question WITH the identifying example named is accepted',
    unit('u-rxn2', 'fact', 'Reacción de equilibrio', 'N2O4(g) se descompone en 2NO2(g)', { qualifiers: ['Ejemplo 1'] }),
    'En el Ejemplo 1, ¿cuál es la reacción química de equilibrio que tiene lugar?',
    'N2O4(g) ⇌ 2NO2(g)',
  )

  await assertRepairedCtx(
    'CTX-2: "en el ejemplo dado" without identity is deterministically repaired via the unit qualifier',
    unit('u-ex1', 'fact', 'Resultado del ejemplo', 'el resultado es 7.8', { qualifiers: ['Prueba 3'] }),
    '¿Cuál fue el resultado en el ejemplo dado?',
    '7.8',
  )

  await assertRepairedCtx(
    'CTX-3 [statistics]: contextless numeric question ("¿cuál es la concentración?" family) is deterministically repaired',
    unit('u-conc', 'event_or_data', 'Concentración final de NO2', 'aproximadamente 0.0310 M', { qualifiers: ['Experimento 3'] }),
    '¿Cuál es la concentración de NO2 en equilibrio?',
    'aproximadamente 0.0310 M',
  )
  await assertAcceptedCtx(
    'CTX-4: same numeric question with sufficient identifying context accepted',
    unit('u-conc2', 'event_or_data', 'Concentración final de NO2', 'aproximadamente 0.0310 M', { qualifiers: ['Experimento 3'] }),
    'En el Experimento 3, que inicia con [NO2]=0.0400 M, ¿qué concentración de NO2 se alcanza en el equilibrio?',
    'aproximadamente 0.0310 M',
  )

  await assertRepairedCtx(
    'CTX-5 [medicine]: clinical diagnosis without case facts is deterministically repaired via the case qualifier',
    unit('u-dx', 'fact', 'Diagnóstico del caso', 'neumonía bacteriana', { qualifiers: ['Caso 2'] }),
    '¿Cuál es el diagnóstico?',
    'Neumonía bacteriana.',
  )
  await assertAcceptedCtx(
    'CTX-6: clinical diagnosis with case facts accepted',
    unit('u-dx2', 'fact', 'Diagnóstico del caso', 'neumonía bacteriana', { qualifiers: ['Caso 2'] }),
    'En el Caso 2, paciente de 45 años con fiebre, tos productiva y crepitantes, ¿cuál es el diagnóstico más probable?',
    'Neumonía bacteriana.',
  )

  await assertRepairedCtx(
    'CTX-7 [programming]: code-output question without the code is deterministically repaired via the fragment qualifier',
    unit('u-code', 'fact', 'Salida del fragmento', 'imprime 42', { qualifiers: ['Fragmento 5'] }),
    '¿Qué imprime este código?',
    '42',
  )
  await assertAcceptedCtx(
    'CTX-8: code-output question with the code/context included is accepted',
    unit('u-code2', 'fact', 'Salida del fragmento', 'imprime 42', { qualifiers: ['Fragmento 5'] }),
    'Dado el Fragmento 5 (`print(6*7)`), ¿qué imprime este código?',
    '42',
  )

  await assertRepairedCtx(
    'CTX-9 [table]: graph/table comparison without entities is deterministically repaired via the table qualifier',
    unit('u-tab', 'event_or_data', 'Valor más alto', 'el compuesto C', { qualifiers: ['Tabla 2'] }),
    '¿Cuál tiene el valor más alto en esta gráfica?',
    'El compuesto C.',
  )
  await assertAcceptedCtx(
    'CTX-10: same comparison with explicit entities accepted',
    unit('u-tab2', 'event_or_data', 'Valor más alto', 'el compuesto C', { qualifiers: ['Tabla 2'] }),
    'En la Tabla 2, que compara los compuestos A, B y C, ¿cuál tiene el valor más alto?',
    'El compuesto C.',
  )

  await assertRepairedCtx(
    'CTX-11: unresolved "este sistema" pronoun/deixis is deterministically repaired via the reactor qualifier',
    unit('u-sys', 'fact', 'Comportamiento del sistema', 'el sistema se desplaza hacia la derecha', { qualifiers: ['Reactor 1'] }),
    '¿Hacia dónde se desplaza este sistema al aumentar la presión?',
    'Hacia la derecha.',
  )

  await test('CTX-12: authorized-context repair never invents facts (documented contract — repair only adds qualifiers/label already on the unit)', () => {
    // Contract check: the identity tokens the gate accepts as "resolved
    // context" come ONLY from the unit's own qualifiers/label (already-
    // authorized source data), never from free text — there is no code
    // path in this gate that fabricates values.
    const u = unit('u-inv', 'fact', 'Resultado final', 'el resultado es 9.1', { qualifiers: ['Prueba Alfa'] })
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = planWith(u)
    const b = brain('ctx-inv', [u])
    // A question that names a FABRICATED identifier not present on the
    // unit ("Ensayo Beta") must still fail — proving the gate checks
    // against the unit's actual authorized qualifiers, not just "any
    // identifier-shaped text".
    const validated = validateDeck([fakeCard(pc, '¿Cuál fue el resultado según el texto en el Ensayo Beta?', '9.1')] as any, plan as any, b)
    assert.equal(validated[0].validated, false, 'a fabricated/unauthorized identifier must not satisfy the context requirement')
  })

  await test('CTX-13: a NON-repairable contextless card (event_or_data, no qualifiers at all) leaves its target eligible for gap repair (not silently dropped from coverage targets)', () => {
    // event_or_data with EMPTY qualifiers is the NOT-REPAIRABLE case — no
    // authorized context exists anywhere on the unit to incorporate, so
    // this must stay a genuine rejection (unlike CTX-1/2/3/5/7/9/11,
    // which DO have a qualifier and are now deterministically repaired).
    const u = unit('u-gap', 'event_or_data', 'Concentración observada', 'aproximadamente 0.031 M', { qualifiers: [] })
    const pc: PlannedCard = { id: 'c1', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const plan = planWith(u)
    const b = brain('ctx-gap', [u])
    const validated = validateDeck([fakeCard(pc, '¿Cuál es la concentración observada?', 'aproximadamente 0.031 M')] as any, plan as any, b)
    assert.equal(validated[0].validated, false, JSON.stringify(validated[0].validationErrors))
    // The target unit is untouched in plan.targetedUnitIds — repair
    // logic (deckStore.ts) can retry it; it is never removed here.
    assert.ok((plan as any).targetedUnitIds.includes(u.id))
  })

  await test('CTX-15: a fully valid deck contains zero contextless-rejected cards', () => {
    const u1 = unit('u-final1', 'fact', 'Reacción de equilibrio', 'N2O4(g) se descompone en 2NO2(g)', { qualifiers: ['Ejemplo 1'] })
    const u2 = unit('u-final2', 'event_or_data', 'Concentración final de NO2', 'aproximadamente 0.0310 M', { qualifiers: ['Experimento 3'] })
    const pc1: PlannedCard = { id: 'c1', sourceUnitIds: [u1.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' }
    const pc2: PlannedCard = { id: 'c2', sourceUnitIds: [u2.id], sourceRelationIds: [], retrievalObjective: 'y', cognitiveType: 'recall', rationale: 'r' }
    const plan = { plannerVersion: '1.0.0', plannedCards: [pc1, pc2], targetedUnitIds: [u1.id, u2.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] }
    const b = brain('ctx-final', [u1, u2])
    const cards = [
      fakeCard(pc1, 'En el Ejemplo 1, ¿cuál es la reacción química de equilibrio que tiene lugar?', 'N2O4(g) ⇌ 2NO2(g)'),
      fakeCard(pc2, 'En el Experimento 3, ¿qué concentración de NO2 se alcanza en el equilibrio?', 'aproximadamente 0.0310 M'),
    ]
    const validated = validateDeck(cards as any, plan as any, b)
    assert.ok(validated.every(c => c.validated), JSON.stringify(validated.map(c => c.validationErrors)))
  })

  // ---------------------------------------------------------------
  // P0-B (surgical audit, IMPLEMENTACIÓN AUTORIZADA): isDocumentMetadata
  // must also inspect unit.provenance[].quote, not just label+statement —
  // root cause of "sk:copyright" (event_or_data_ab309763002fc97f)
  // surviving to become a retrieval target.
  // ---------------------------------------------------------------
  await test('META-PROV-A: label/statement are ambiguous (generic year) but provenance quote reveals a copyright colophon -> EXCLUDE', () => {
    // Mirrors the real case: an event_or_data unit whose OWN label/
    // statement is a bare abstracted year (never says "copyright"/"©"),
    // but the verbatim provenance quote is unambiguously a colophon.
    const units = [unit('u-prov-copy', 'event_or_data', 'Año', '2015', {
      provenance: [{ materialId: 'mat-a', page: 1, chunkId: 'c-1', quote: '© 2015 Editorial Ejemplo. Todos los derechos reservados.' }],
    })]
    const plan = planFlashcards(brain('meta-prov-a', units))
    assert.equal(plan.targetedUnitIds.length, 0, 'provenance-only copyright evidence must still exclude the unit')
    assert.ok(plan.skipped.some(s => s.reason === 'non_studyable_metadata'))
  })

  await test('META-PROV-B: label/statement are ambiguous but provenance quote reveals clear editorial/ISBN metadata -> EXCLUDE', () => {
    const units = [unit('u-prov-isbn', 'event_or_data', 'Identificador', '978-0-13-000000-0', {
      provenance: [{ materialId: 'mat-a', page: 1, chunkId: 'c-1', quote: 'ISBN 978-0-13-000000-0. Editorial Prentice Hall, 2015.' }],
    })]
    const plan = planFlashcards(brain('meta-prov-b', units))
    assert.equal(plan.targetedUnitIds.length, 0)
    assert.ok(plan.skipped.some(s => s.reason === 'non_studyable_metadata'))
  })

  await test('META-PROV-C: provenance mentions copyright but the material genuinely teaches it (domainTags present) -> NOT excluded', () => {
    // Same "copyright" vocabulary in the quote, but this unit carries the
    // Brain's own explicit domain declaration — a law/history-of-
    // publishing course teaching copyright itself must survive.
    const units = [unit('u-prov-legit', 'fact', 'Duración del copyright', 'El copyright dura la vida del autor más 70 años.', {
      domainTags: ['derecho-de-autor'],
      provenance: [{ materialId: 'mat-a', page: 1, chunkId: 'c-1', quote: 'El copyright, según la ley vigente, dura la vida del autor más 70 años.' }],
    })]
    const plan = planFlashcards(brain('meta-prov-c', units))
    assert.equal(plan.targetedUnitIds.length, 1, 'a unit the material genuinely TEACHES about copyright must not be excluded merely for mentioning it')
  })

  await test('META-PROV-D: an ordinary academic unit whose provenance quote is plain academic prose -> KEEP', () => {
    const units = [unit('u-prov-normal', 'event_or_data', 'Temperatura de reacción', '448°C', {
      qualifiers: ['Experimento 3'],
      provenance: [{ materialId: 'mat-a', page: 1, chunkId: 'c-1', quote: 'La reacción se llevó a cabo a 448°C en el Experimento 3.' }],
    })]
    const plan = planFlashcards(brain('meta-prov-d', units))
    assert.equal(plan.targetedUnitIds.length, 1, 'ordinary academic content must never be excluded')
  })

  // ---------------------------------------------------------------
  // P0 (FLASHCARDS — SIMPLIFICACIÓN FINAL DEL PIPELINE): planner and
  // validator must share ONE authority for document-metadata topic
  // classification — proven here by exercising vocabulary that the OLD
  // (pre-fix) planner-only pattern list never had (edition-year,
  // ownership phrasing) and confirming BOTH layers now agree.
  // ---------------------------------------------------------------
  await test('META-UNIFIED-1: edition/publication-year vocabulary (previously validator-only) now also excludes the source unit at the planner', () => {
    const units = [unit('u-unified-edition', 'event_or_data', 'Dato editorial', 'Primera edición, 2015.')]
    const plan = planFlashcards(brain('meta-unified-1', units))
    assert.equal(plan.targetedUnitIds.length, 0, 'edition-year vocabulary must now be caught by the planner, not just the validator')
    assert.ok(plan.skipped.some(s => s.reason === 'non_studyable_metadata'))
  })

  await test('META-UNIFIED-2: ownership-phrasing vocabulary (previously validator-only) now also excludes the source unit at the planner', () => {
    const units = [unit('u-unified-owner', 'event_or_data', 'Titularidad', 'A quién pertenece esta obra: Editorial Ejemplo.')]
    const plan = planFlashcards(brain('meta-unified-2', units))
    assert.equal(plan.targetedUnitIds.length, 0, 'ownership-phrasing vocabulary must now be caught by the planner, not just the validator')
  })

  await test('META-UNIFIED-3: a generated card whose question uses ownership phrasing is still rejected by the validator (gate 6b unaffected)', () => {
    const u = unit('u-unified-val', 'fact', 'Contenido real', 'contenido academico real')
    const plan: FlashcardPlan = { plannerVersion: '1.0.0', plannedCards: [], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [] } as any
    const pcard: PlannedCard = { id: 'c-unified', sourceUnitIds: [u.id], sourceRelationIds: [], retrievalObjective: 'x', cognitiveType: 'recall', rationale: 'r' } as any
    const b = brain('meta-unified-3', [u])
    const validated = validateDeck(
      [fakeCard(pcard, '¿A quién pertenece el copyright de este material?', 'Pertenece a la editorial.')],
      plan, b,
    )
    assert.ok(!validated[0].validated)
    assert.ok(validated[0].validationErrors.includes('non_studyable_document_metadata'))
  })

  await test('META-UNIFIED-4: the shared DOCUMENT_METADATA_TOPIC_PATTERN is literally the same instance both layers import', () => {
    // Structural proof there is exactly ONE pattern object, not two
    // independently-maintained regexes that merely happen to agree today.
    assert.ok(DOCUMENT_METADATA_TOPIC_PATTERN.test('a quién pertenece esta obra'))
    assert.ok(DOCUMENT_METADATA_TOPIC_PATTERN.test('primera edición, 2015'))
    assert.ok(DOCUMENT_METADATA_TOPIC_PATTERN.test('© 2015 Editorial Ejemplo'))
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-metadata-context-contracts: ALL PASS')
}

main()
