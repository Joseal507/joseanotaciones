import assert from 'node:assert/strict'
import { validateDeck, repairUnwrappedNotation } from '../../lib/materialBrain/flashcards/validate'
import { normalizeAcademicContent } from '../../lib/academic-content/validation'
import type { GeneratedFlashcard, PlannedCard } from '../../lib/materialBrain/flashcards/types'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'

// ============================================================
// Final closure — two remaining risks from the semantic-architecture
// audit: (1) unwrapped/broken academic notation surviving validation,
// (2) instance-bound questions with no identifying context surviving
// validation because they didn't match a fixed phrase/shape list.
// Both fixes are GENERIC (structural signals from the Brain's own
// KnowledgeUnit — compact letter+digit fusion, division/exponent
// markers, identity.qualifiers presence) — no chemistry hardcoding, no
// phrase blacklist. Every fixture below is domain-genericized.
// ============================================================

function unit(id: string, kind: KnowledgeUnit['kind'], label: string, statement: string, extra: any = {}, tier: 'critical' | 'supporting' | 'contextual' = 'supporting'): KnowledgeUnit {
  return {
    id, kind, label, statement,
    identity: { canonicalSubject: label, semanticKey: '', qualifiers: extra.qualifiers || [] },
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
function brain(fingerprint: string, units: KnowledgeUnit[]): MaterialBrain {
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint },
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
  return { id, sourceUnitIds, sourceRelationIds: [], retrievalObjective: objective, cognitiveType: 'recall', rationale: 'r', conceptClusterId: 'c-' + id }
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
  console.log('\n── Flashcards notation + context closure contracts ──\n')

  // ---------------------------------------------------------------
  // NOTATION (a) subíndice perdido
  // ---------------------------------------------------------------
  await test('NOTATION-A: lost subscript ("N2O4" -> "N 2 O 4") is rejected', () => {
    const u = unit('n-a', 'fact', 'Descomposición', 'El compuesto N2O4 se descompone en NO2.')
    const p = pc('c1', [u.id])
    const b = brain('not-a', [u])
    const validated = validateDeck([fakeCard(p, '¿En qué se descompone el compuesto N2O4?', 'Se descompone en N 2 O 4 y produce NO 2.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, false)
    assert.ok(validated[0].validationErrors.includes('notation_structure_lost'))
  })

  // ---------------------------------------------------------------
  // NOTATION (b) exponente perdido
  // ---------------------------------------------------------------
  await test('NOTATION-B: lost exponent (source has ^, card drops it) is rejected — generalized beyond FormulaUnit', () => {
    const u = unit('n-b', 'event_or_data', 'Valor calculado', 'El resultado es x^2 según el cálculo realizado en el Experimento 5.', { qualifiers: ['Experimento 5'] })
    const p = pc('c2', [u.id])
    const b = brain('not-b', [u])
    const validated = validateDeck([fakeCard(p, 'En el Experimento 5, ¿cuál es el valor de x^2 obtenido?', 'El resultado es x2, sin el exponente correctamente indicado.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, false, JSON.stringify(validated[0].validationErrors))
  })

  // ---------------------------------------------------------------
  // NOTATION (c) división perdida (FormulaUnit path, already existed —
  // re-asserted here as part of the closure suite)
  // ---------------------------------------------------------------
  await test('NOTATION-C: lost division in a formula card is rejected', () => {
    const u = unit('n-c', 'formula', 'Fórmula P', 'La presión se calcula como P=(n/V)RT', { expression: 'P=(n/V)RT', variables: [{ symbol: 'P', meaning: 'presión' }, { symbol: 'n', meaning: 'moles' }, { symbol: 'V', meaning: 'volumen' }, { symbol: 'R', meaning: 'constante' }, { symbol: 'T', meaning: 'temperatura' }] })
    const p = pc('c3', [u.id])
    const b = brain('not-c', [u])
    const validated = validateDeck([fakeCard(p, '¿Cuál es la fórmula P?', 'P=nVRT')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, false)
  })

  // ---------------------------------------------------------------
  // NOTATION (d) notación científica
  // ---------------------------------------------------------------
  await test('NOTATION-D: scientific notation with lost exponent is rejected', () => {
    const u = unit('n-d', 'event_or_data', 'Concentración medida', 'La concentración medida es 1.87×10^-3 M en el Experimento 9.', { qualifiers: ['Experimento 9'] })
    const p = pc('c4', [u.id])
    const b = brain('not-d', [u])
    const validated = validateDeck([fakeCard(p, 'En el Experimento 9, ¿cuál fue la concentración medida?', 'La concentración medida fue 1.87×10-3 M, sin exponente correctamente marcado.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, false, JSON.stringify(validated[0].validationErrors))
  })

  // ---------------------------------------------------------------
  // NOTATION (e) expresión correcta equivalente
  // ---------------------------------------------------------------
  await test('NOTATION-E: correctly-wrapped equivalent notation is accepted', () => {
    const u = unit('n-e', 'fact', 'Descomposición', 'El compuesto N2O4 se descompone en NO2.')
    const p = pc('c5', [u.id])
    const b = brain('not-e', [u])
    const validated = validateDeck([fakeCard(p, '¿En qué se descompone el compuesto $N_2O_4$?', 'Se descompone en $NO_2$ según la reacción $N_2O_4 \\rightarrow 2NO_2$.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  // ---------------------------------------------------------------
  // NOTATION (f) texto normal con números que NO debe rechazarse
  // ---------------------------------------------------------------
  await test('NOTATION-F1: ordinary prose with plain numbers (dates, counts) is never rejected', () => {
    const u = unit('n-f1', 'fact', 'Fundación', 'La organización fue fundada en 1965 como la decimoquinta franquicia.')
    const p = pc('c6', [u.id])
    const b = brain('not-f1', [u])
    const validated = validateDeck([fakeCard(p, '¿En qué año fue fundada la organización?', 'Fue fundada en 1965, como la decimoquinta franquicia.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  await test('NOTATION-F2: a source unit with no fused letter+digit tokens never triggers the notation gate', () => {
    const u = unit('n-f2', 'concept', 'Concepto general', 'Un concepto general sin notación compacta alguna, solo texto descriptivo.')
    const p = pc('c7', [u.id])
    const b = brain('not-f2', [u])
    const validated = validateDeck([fakeCard(p, '¿Qué describe este concepto general?', 'Describe una idea general expresada completamente en texto, sin ninguna notación técnica.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  await test('NOTATION-F3: a genuinely fused token the card never restates is not penalized', () => {
    const u = unit('n-f3', 'fact', 'Reacción no mencionada', 'El compuesto H2SO4 participa en la reacción según la fuente.')
    const p = pc('c8', [u.id])
    const b = brain('not-f3', [u])
    // Card about a totally different aspect of the SAME unit, never
    // restating the H2SO4 token at all — nothing to verify, must pass.
    const validated = validateDeck([fakeCard(p, '¿Qué tipo de sustancia participa en la reacción descrita, según la fuente autorizada?', 'Un ácido fuerte participa en dicha reacción.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  // ---------------------------------------------------------------
  // CONTEXT — universal instance-context requirement (no blacklist)
  // ---------------------------------------------------------------
  await test('CONTEXT-1 [real mission example]: "¿A qué temperatura se permite que el sistema alcance el equilibrio?" rejected (qualifier not named, no shape/length trigger needed)', () => {
    const u = unit('ctx-1', 'event_or_data', 'Temperatura del sistema', '448°C', { qualifiers: ['Sistema cerrado con H2 e I2'] })
    const p = pc('c9', [u.id])
    const b = brain('ctx-1', [u])
    const validated = validateDeck([fakeCard(p, '¿A qué temperatura se permite que el sistema alcance el equilibrio?', 'A 448°C.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, false)
  })

  await test('CONTEXT-1b: same question WITH the qualifier named is accepted', () => {
    const u = unit('ctx-1b', 'event_or_data', 'Temperatura del sistema', '448°C', { qualifiers: ['Sistema cerrado con H2 e I2'] })
    const p = pc('c10', [u.id])
    const b = brain('ctx-1b', [u])
    const validated = validateDeck([fakeCard(p, 'Para el sistema cerrado con H2 e I2, ¿a qué temperatura se permite alcanzar el equilibrio?', 'A 448°C.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  // P0 mission ("REPAIRABLE context, never invented"): the unit's own
  // qualifier already names the missing context, so this is now
  // deterministically repaired (context prepended) and accepted —
  // distinct from the event_or_data-with-EMPTY-qualifiers case (which
  // stays a hard rejection, see the fail-closed test elsewhere in this
  // suite).
  await test('CONTEXT-2 [real mission example]: "¿Cuál es el valor obtenido?" for a qualified event_or_data unit is deterministically repaired via the qualifier', () => {
    const u = unit('ctx-2', 'event_or_data', 'Valor obtenido', '0.107 M', { qualifiers: ['Cálculo B en el Ejemplo 3'] })
    const p = pc('c11', [u.id])
    const b = brain('ctx-2', [u])
    const validated = validateDeck([fakeCard(p, '¿Cuál es el valor obtenido?', '0.107 M.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
    assert.ok(validated[0].question.includes('Cálculo B en el Ejemplo 3'))
  })

  await test('CONTEXT-3 [real mission valid example]: universal concept question with NO qualifiers is accepted', () => {
    const u = unit('ctx-3', 'concept', 'Equilibrio químico', 'El equilibrio químico es el estado donde las velocidades directa e inversa se igualan.')
    const p = pc('c12', [u.id])
    const b = brain('ctx-3', [u])
    const validated = validateDeck([fakeCard(p, '¿Qué es el equilibrio químico?', 'Es el estado donde las velocidades de reacción directa e inversa se igualan.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  await test('CONTEXT-4 [real mission valid example]: universal factual-relationship question with NO qualifiers is accepted', () => {
    const u = unit('ctx-4', 'fact', 'Efecto del catalizador', 'Un catalizador acelera tanto la reacción directa como la inversa por igual, sin desplazar el equilibrio.')
    const p = pc('c13', [u.id])
    const b = brain('ctx-4', [u])
    const validated = validateDeck([fakeCard(p, '¿Cómo afecta un catalizador al equilibrio químico?', 'Acelera igual la reacción directa e inversa, sin alterar la posición del equilibrio.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  await test('CONTEXT-5 [cross-domain, medicine]: diagnosis question without case-identifying qualifiers is deterministically repaired via the case qualifier', () => {
    const u = unit('ctx-5', 'fact', 'Diagnóstico del caso', 'neumonía bacteriana', { qualifiers: ['Caso 7: paciente de 45 años con fiebre y tos productiva'] })
    const p = pc('c14', [u.id])
    const b = brain('ctx-5', [u])
    const validated = validateDeck([fakeCard(p, '¿Cuál es el diagnóstico?', 'Neumonía bacteriana.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  await test('CONTEXT-5b [cross-domain, medicine]: same diagnosis question WITH the case identified is accepted', () => {
    const u = unit('ctx-5b', 'fact', 'Diagnóstico del caso', 'neumonía bacteriana', { qualifiers: ['Caso 7: paciente de 45 años con fiebre y tos productiva'] })
    const p = pc('c15', [u.id])
    const b = brain('ctx-5b', [u])
    const validated = validateDeck([fakeCard(p, 'Según el caso 7: paciente de 45 años con fiebre y tos productiva, ¿cuál es el diagnóstico más probable?', 'Neumonía bacteriana.')], { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any, b)
    assert.equal(validated[0].validated, true, JSON.stringify(validated[0].validationErrors))
  })

  // ---------------------------------------------------------------
  // P0-A (surgical audit, IMPLEMENTACIÓN AUTORIZADA): repairUnwrappedNotation
  // must never split a LaTeX/mhchem macro from its braced argument(s) —
  // confirmed corruption: \ce{N2O4 (g) -> 2 NO2 (g)} -> $\ce${N2O4 ...}
  // ---------------------------------------------------------------
  await test('REPAIR-MACRO-1: mhchem \\ce{...} macro stays intact (not split from its argument)', () => {
    const out = repairUnwrappedNotation('reaccion \\ce{N2O4 (g) -> 2 NO2 (g)} a 1 atm')
    assert.equal(out, 'reaccion $\\ce{N2O4 (g) -> 2 NO2 (g)}$ a 1 atm')
  })

  await test('REPAIR-MACRO-2: \\frac{a}{b} keeps both argument groups together', () => {
    const out = repairUnwrappedNotation('el valor de \\frac{a}{b} es constante')
    assert.equal(out, 'el valor de $\\frac{a}{b}$ es constante')
  })

  await test('REPAIR-MACRO-3: nested \\frac{\\sqrt{x}}{b} is wrapped as ONE unit, inner macro never double-wrapped', () => {
    const out = repairUnwrappedNotation('calcula \\frac{\\sqrt{x}}{b} aqui')
    assert.equal(out, 'calcula $\\frac{\\sqrt{x}}{b}$ aqui')
  })

  await test('REPAIR-MACRO-4: \\sqrt{x} stays intact', () => {
    assert.equal(repairUnwrappedNotation('calcula \\sqrt{x} para x=4'), 'calcula $\\sqrt{x}$ para x=4')
  })

  await test('REPAIR-MACRO-5: \\text{energia} stays intact', () => {
    assert.equal(repairUnwrappedNotation('el termino \\text{energia} aparece'), 'el termino $\\text{energia}$ aparece')
  })

  await test('REPAIR-MACRO-6: \\mathrm{kg} stays intact', () => {
    assert.equal(repairUnwrappedNotation('unidad \\mathrm{kg} de masa'), 'unidad $\\mathrm{kg}$ de masa')
  })

  await test('REPAIR-MACRO-7: \\mathbf{v} stays intact', () => {
    assert.equal(repairUnwrappedNotation('vector \\mathbf{v} en el plano'), 'vector $\\mathbf{v}$ en el plano')
  })

  await test('REPAIR-MACRO-8: nested macro-inside-macro (\\text{valor de \\mathbf{x}}) wraps as one unit, inner macro not separately wrapped', () => {
    const out = repairUnwrappedNotation('aqui \\text{valor de \\mathbf{x}} fin')
    assert.equal(out, 'aqui $\\text{valor de \\mathbf{x}}$ fin')
  })

  await test('REPAIR-MACRO-9: already-delimited math is never double-wrapped', () => {
    const out = repairUnwrappedNotation('la formula $\\frac{a}{b}$ ya esta correcta')
    assert.equal(out, 'la formula $\\frac{a}{b}$ ya esta correcta')
  })

  await test('REPAIR-OPERATOR-1: "K >> 1" is untouched by the macro repair', () => {
    assert.equal(repairUnwrappedNotation('si K >> 1 la reaccion es favorable'), 'si K >> 1 la reaccion es favorable')
  })

  await test('REPAIR-OPERATOR-2: "x <= 5" is untouched by the macro repair', () => {
    assert.equal(repairUnwrappedNotation('el dominio es x <= 5'), 'el dominio es x <= 5')
  })

  await test('REPAIR-OPERATOR-3: "A -> B" is untouched by the macro repair', () => {
    assert.equal(repairUnwrappedNotation('la transicion A -> B ocurre'), 'la transicion A -> B ocurre')
  })

  await test('REPAIR-MACRO-10 [validateDeck integration]: a card using \\ce{...} is no longer rejected as unwrapped_notation', () => {
    const u = unit('n-mhchem', 'fact', 'Descomposición N2O4', 'La reacción es N2O4 -> 2 NO2 a 1 atm.')
    const p = pc('c-mhchem', [u.id])
    const b = brain('not-mhchem', [u])
    const validated = validateDeck(
      [fakeCard(p, '¿Cual es la ecuacion de la reaccion de descomposicion a 1 atm, escrita con \\ce{N2O4 (g) -> 2 NO2 (g)}?', 'El tetraóxido de dinitrógeno gaseoso se descompone en dióxido de nitrógeno gaseoso.')],
      { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any,
      b,
    )
    assert.ok(!validated[0].validationErrors.includes('unwrapped_notation'), JSON.stringify(validated[0].validationErrors))
    assert.ok(validated[0].question.includes('$\\ce{N2O4 (g) -> 2 NO2 (g)}$'))
  })

  // ---------------------------------------------------------------
  // P0 (FLASHCARDS — SIMPLIFICACIÓN FINAL DEL PIPELINE): the validator
  // must accept exactly what the renderer can render — a correctly
  // mhchem-wrapped \ce{...} must never be rejected as broken_academic_content
  // merely because the validator's own KaTeX instance didn't load the
  // mhchem extension (render.ts always did; validation.ts now does too).
  // ---------------------------------------------------------------
  await test('REPAIR-MACRO-11 [P0]: a correctly-wrapped $\\ce{...}$ chemical equation is never rejected as broken_academic_content', () => {
    const u = unit('n-mhchem2', 'fact', 'Reaccion HI', 'H2(g) + I2(s) se combinan para formar HI(g) en equilibrio.')
    const p = pc('c-mhchem2', [u.id])
    const b = brain('not-mhchem2', [u])
    const validated = validateDeck(
      [fakeCard(p, '¿Cual es la ecuacion balanceada de la reaccion de formacion de HI?', 'La reaccion es $\\ce{H2(g) + I2(s) <=> 2HI(g)}$.')],
      { plannedCards: [p], targetedUnitIds: [u.id], targetedRelationIds: [], skipped: [], ambiguousDuplicateGroups: [], plannerVersion: '1.0.0' } as any,
      b,
    )
    assert.ok(!validated[0].validationErrors.includes('broken_academic_content'), JSON.stringify(validated[0].validationErrors))
  })

  await test('REPAIR-MACRO-12 [P0]: normalizeAcademicContent itself accepts \\ce{...} (direct katex/mhchem reproduction)', () => {
    const result = normalizeAcademicContent('La reaccion es $\\ce{H2(g) + I2(s) <=> 2HI(g)}$.')
    assert.equal(result.requiresRegeneration, false, 'katex must render \\ce{...} once mhchem is loaded, exactly like the renderer does')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('flashcards-notation-context-closure-contracts: ALL PASS')
}

main()
