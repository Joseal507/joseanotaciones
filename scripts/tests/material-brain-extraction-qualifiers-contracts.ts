import assert from 'node:assert/strict'
import { extractChunkWithMockProvider } from '../../lib/materialBrain/extraction'
import { buildIdentity } from '../../lib/materialBrain/identity'
import type { PageChunk } from '../../lib/materialBrain/types'

// ============================================================
// Contract suite: extraction.ts's "qualifiers" prompt instruction now
// serves two purposes — (a) identity disambiguation between units
// sharing a canonicalSubject, AND (b) preserving the minimal
// instance/scenario context an instance-bound datum (event_or_data,
// measurements, example results) needs to stand alone. This suite
// does NOT call a real LLM — it drives extractChunkWithMockProvider,
// which runs the real normalizeRawUnit/processNormalizedPayload path
// against a scripted raw LLM JSON payload, to prove the pipeline
// faithfully carries whatever qualifiers content the model produces
// through to the final KnowledgeUnit identity, without the pipeline
// itself inventing, dropping, or otherwise altering that content.
// ============================================================

function chunk(text: string, page = 1): PageChunk {
  return { id: 'c-1', materialId: 'mat-a', pages: [page], order: 0, text, sourceKind: 'text' }
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── Material Brain extraction: qualifiers dual-purpose contracts ──\n')

  await test('QUAL-1: an instance-bound event_or_data unit with a literal scenario qualifier is preserved (not dropped)', async () => {
    const text = 'La temperatura del sistema es 448 grados centigrados en el ejemplo cerrado H2 mas I2 equilibrio 2HI.'
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'temperatura del sistema',
        qualifiers: ['ejemplo cerrado H2 mas I2 equilibrio 2HI'],
        label: 'Temperatura del sistema',
        statement: 'La temperatura del sistema es 448 grados centigrados',
        quote: 'La temperatura del sistema es 448 grados centigrados en el ejemplo cerrado H2 mas I2 equilibrio 2HI',
        page: 1,
        domainTags: ['Química'],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.units.length, 1, 'the unit must survive normalization')
    assert.deepEqual(extraction.units[0].qualifiers, ['ejemplo cerrado H2 mas I2 equilibrio 2HI'])
  })

  await test('QUAL-2: the qualifier text is carried through literally — pipeline does not rewrite/paraphrase it', async () => {
    const literalQualifier = 'sistema cerrado del ejemplo H2 + I2 <-> 2HI'
    const text = `Contexto: ${literalQualifier}. La concentracion inicial de H2 es 0.5 M.`
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'concentracion inicial H2',
        qualifiers: [literalQualifier],
        label: 'Concentración inicial de H2',
        statement: 'La concentracion inicial de H2 es 0.5 M',
        quote: `Contexto: ${literalQualifier}. La concentracion inicial de H2 es 0.5 M.`,
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.units[0].qualifiers[0], literalQualifier, 'qualifier text must reach RawExtractedUnit unmodified')
  })

  await test('QUAL-3: a non instance-bound event_or_data unit keeps qualifiers empty — pipeline never fabricates one', async () => {
    const text = 'El valor de la constante de Avogadro es 6.022e23 por mol.'
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'constante de Avogadro',
        qualifiers: [],
        label: 'Constante de Avogadro',
        statement: 'El valor de la constante de Avogadro es 6.022e23 por mol',
        quote: 'El valor de la constante de Avogadro es 6.022e23 por mol.',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.deepEqual(extraction.units[0].qualifiers, [], 'a universal constant must not receive an invented scenario qualifier')
  })

  await test('QUAL-4: a universal concept (no instance dependency) can still validly carry qualifiers: []', async () => {
    const text = 'Un catalizador acelera las reacciones directa e inversa por igual.'
    const mock = JSON.stringify({
      units: [{
        kind: 'concept',
        canonicalSubject: 'catalizador',
        qualifiers: [],
        label: 'Catalizador',
        statement: 'Un catalizador acelera las reacciones directa e inversa por igual',
        quote: 'Un catalizador acelera las reacciones directa e inversa por igual.',
        page: 1,
        domainTags: ['Química'],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.units.length, 1)
    assert.deepEqual(extraction.units[0].qualifiers, [])
  })

  // ============================================================
  // P4 (Material Brain fix): the model sometimes judges `qualifiers`
  // empty while still putting real distinguishing context into `quote`
  // (its own verbatim-source-text field) — two independent model outputs
  // with no cross-check. Real-deck evidence: the golden PDF's Kc=51
  // event_or_data unit had qualifiers:[] while its quote carried the full
  // HI/H2/I2 reaction notation. These tests cover the general rescue:
  // promote the quote as the qualifier ONLY when it demonstrably carries
  // novel content beyond the statement — never inventing, never a
  // domain-specific string match.
  // ============================================================

  await test('QUAL-6: qualifiers left empty by the model, but quote carries real novel content beyond the statement -> quote is promoted as the qualifier', async () => {
    const text = 'K c = [HI] 2 [H 2 ] [I 2 ] = 51'
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'Valor de la constante de equilibrio Kc',
        qualifiers: [],
        label: 'Valor de la constante de equilibrio Kc',
        statement: 'El valor de la constante de equilibrio Kc es 51.',
        quote: 'K c = [HI] 2 [H 2 ] [I 2 ] = 51',
        page: 1,
        domainTags: ['Química'],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.units.length, 1, 'the unit must survive normalization')
    assert.deepEqual(extraction.units[0].qualifiers, ['K c = [HI] 2 [H 2 ] [I 2 ] = 51'], 'the model\'s own verbatim quote — never a fabricated qualifier — must be promoted')
  })

  await test('QUAL-7: a table-row-shaped event_or_data (entity + condition novel vs statement) is rescued the same general way', async () => {
    const text = 'Fila: Muestra B, presion 2 atm, resultado 88 unidades.'
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'Resultado de la muestra',
        qualifiers: [],
        label: 'Resultado de la muestra',
        statement: 'El resultado es 88 unidades.',
        quote: 'Fila: Muestra B, presion 2 atm, resultado 88 unidades.',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.units.length, 1)
    assert.deepEqual(extraction.units[0].qualifiers, ['Fila: Muestra B, presion 2 atm, resultado 88 unidades.'], 'entity/condition context novel vs the statement must be promoted, not dropped')
  })

  await test('QUAL-8: quote identical (or near-identical) to statement is NOT promoted — no novel content means no evidence was actually lost', async () => {
    const text = 'La densidad del agua es 1 gramo por mililitro.'
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'Densidad del agua',
        qualifiers: [],
        label: 'Densidad del agua',
        statement: 'La densidad del agua es 1 gramo por mililitro.',
        quote: 'La densidad del agua es 1 gramo por mililitro.',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.deepEqual(extraction.units[0].qualifiers, [], 'a universal-shaped fact must never receive a fabricated/promoted qualifier just because its kind is event_or_data')
  })

  await test('QUAL-9: an overly long quote (paragraph-shaped) is never promoted as a qualifier — never copy full paragraphs', async () => {
    const longQuote = 'En este experimento extenso se registraron múltiples condiciones de temperatura, presión y concentración a lo largo de varias horas de observación continua para determinar el comportamiento del sistema en equilibrio dinámico completo.'
    const text = longQuote
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'Resultado del experimento',
        qualifiers: [],
        label: 'Resultado del experimento',
        statement: 'El resultado final fue estable.',
        quote: longQuote,
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.deepEqual(extraction.units[0].qualifiers, [], 'a paragraph-length quote must never be copied wholesale as a qualifier')
  })

  await test('QUAL-10: a non-event_or_data kind with empty qualifiers and a richer quote is left untouched — rescue is scoped to event_or_data only', async () => {
    const text = 'Un catalizador acelera la reaccion sin ser consumido en el proceso completo.'
    const mock = JSON.stringify({
      units: [{
        kind: 'concept',
        canonicalSubject: 'Catalizador',
        qualifiers: [],
        label: 'Catalizador',
        statement: 'Un catalizador acelera la reaccion.',
        quote: 'Un catalizador acelera la reaccion sin ser consumido en el proceso completo.',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.deepEqual(extraction.units[0].qualifiers, [], 'the rescue is specific to event_or_data (the only kind validate.ts hard-blocks on empty qualifiers) — other kinds are unaffected')
  })

  await test('QUAL-11: legacy payload with no quote at all is still handled safely (no crash, qualifiers stay empty)', async () => {
    const text = 'El valor medido es 10 unidades en el sistema de prueba.'
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'Valor medido',
        qualifiers: [],
        label: 'Valor medido',
        statement: 'El valor medido es 10 unidades.',
        quote: 'El valor medido es 10 unidades en el sistema de prueba.',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.units.length, 1, 'must not crash or drop the unit')
  })

  await test('QUAL-5: identity.semanticKey/canonicalSubject are unaffected by qualifiers content (dual-purpose change is qualifiers-only)', () => {
    const withQualifier = buildIdentity('event_or_data', 'temperatura del sistema', ['ejemplo cerrado H2 mas I2'])
    const withoutQualifier = buildIdentity('event_or_data', 'temperatura del sistema', [])
    assert.equal(withQualifier.semanticKey, withoutQualifier.semanticKey, 'semanticKey must derive from canonicalSubject only')
    assert.equal(withQualifier.canonicalSubject, withoutQualifier.canonicalSubject)
  })

  // ─── Live-evidence regression: c2:s1's "campos requeridos ausentes:
  // statement" for event_or_data units (CLUTCH 2 regeneration after
  // c25709f/1d91040). The model filled the schema-legal `value` field
  // and left `statement` empty — normalization, not weakened
  // validation: `statement` is still required in the final unit, just
  // computed from data the model already provided. ────────────────

  await test('QUAL-12 (live regression): event_or_data with value but no statement is normalized, not dropped', async () => {
    const text = 'A 100 grados centigrados, Kc para la reacción 2N2O4(g) equilibrio 4NO2(g) es 47.9 segun la tabla de datos experimentales.'
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'Valor de Kc para 2N2O4(g) equilibrio 4NO2(g) a 100 C',
        qualifiers: [],
        label: 'Valor de Kc a 100 C',
        value: '47.9',
        quote: 'A 100 grados centigrados, Kc para la reacción 2N2O4(g) equilibrio 4NO2(g) es 47.9',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.droppedStructural, 0, 'must not be rejected as structurally malformed — value is a real, schema-legal field')
    assert.equal(extraction.units.length, 1)
    assert.equal(extraction.units[0].statement, '47.9', 'statement is backfilled verbatim from the model\'s own value field, never invented')
    assert.equal(extraction.units[0].value, '47.9')
  })

  await test('QUAL-13: event_or_data with NEITHER value nor statement is still correctly rejected (normalization never accepts truly empty content)', async () => {
    const text = 'A 100 grados centigrados, Kc para la reacción es un valor puntual segun la tabla de datos.'
    const mock = JSON.stringify({
      units: [{
        kind: 'event_or_data',
        canonicalSubject: 'Valor de Kc a 100 C',
        qualifiers: [],
        label: 'Valor de Kc a 100 C',
        quote: 'A 100 grados centigrados, Kc para la reacción es un valor puntual',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'supporting',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.units.length, 0, 'no value AND no statement must still be rejected — this is not a case the normalization covers')
    assert.equal(extraction.droppedStructural, 1)
  })

  await test('QUAL-14: the value-backfill rescue is scoped to event_or_data only — a fact with a value-shaped field but no statement is still rejected', async () => {
    const text = 'El experimento reporta un dato adicional sin relacion con la constante de equilibrio en esta pagina.'
    const mock = JSON.stringify({
      units: [{
        kind: 'fact',
        canonicalSubject: 'Dato adicional',
        qualifiers: [],
        label: 'Dato adicional',
        value: '47.9',
        quote: 'El experimento reporta un dato adicional sin relacion con la constante',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'contextual',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.units.length, 0, 'the value->statement rescue must never apply to kinds other than event_or_data')
    assert.equal(extraction.droppedStructural, 1)
  })

  // ─── Live verification #2 regression: c1:s2's "campos requeridos
  // ausentes: statement" for FORMULA units (persisted after the
  // event_or_data fix — same underlying pattern, different kind: the
  // model fills the schema-legal `expression` field and leaves
  // `statement` empty). ─────────────────────────────────────────

  await test('QUAL-15 (live regression #2): formula with expression but no statement is normalized, not dropped', async () => {
    const text = 'Para la reacción generalizada aA + bB, Kc = [C]^c[D]^d dividido entre [A]^a[B]^b segun la tabla de constantes.'
    const mock = JSON.stringify({
      units: [{
        kind: 'formula',
        canonicalSubject: 'Constante de equilibrio Kc',
        qualifiers: [],
        label: 'Kc',
        expression: 'Kc=[C]^c[D]^d/[A]^a[B]^b',
        variables: [],
        quote: 'Para la reacción generalizada aA + bB, Kc = [C]^c[D]^d dividido entre [A]^a[B]^b',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'critical',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.droppedStructural, 0, 'must not be rejected as structurally malformed — expression is a real, schema-legal field for formula units')
    assert.equal(extraction.units.length, 1)
    assert.equal(extraction.units[0].statement, 'Kc=[C]^c[D]^d/[A]^a[B]^b', 'statement is backfilled verbatim from the model\'s own expression field, never invented')
    assert.equal(extraction.units[0].expression, 'Kc=[C]^c[D]^d/[A]^a[B]^b')
  })

  await test('QUAL-16: a formula with NEITHER expression nor statement is still correctly rejected', async () => {
    const text = 'La constante de equilibrio se define en esta seccion del material segun la tabla adjunta.'
    const mock = JSON.stringify({
      units: [{
        kind: 'formula',
        canonicalSubject: 'Constante de equilibrio Kc',
        qualifiers: [],
        label: 'Kc',
        variables: [],
        quote: 'La constante de equilibrio se define en esta seccion del material',
        page: 1,
        domainTags: [],
        modelSuggestedTier: 'critical',
      }],
      relations: [],
    })
    const { extraction } = await extractChunkWithMockProvider(chunk(text), mock)
    assert.equal(extraction.units.length, 0, 'no expression AND no statement must still be rejected')
    assert.equal(extraction.droppedStructural, 1)
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('material-brain-extraction-qualifiers-contracts: ALL PASS')
}

main()
