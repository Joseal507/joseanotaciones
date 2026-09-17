import assert from 'node:assert/strict'

import { extractCompleteObjects, recoverLLMResponse, findObjectEnd } from '../../lib/materialBrain/truncationRecovery'
import { quoteExistsInSource, quoteExistsInSourceStrict, normalizeWhitespace } from '../../lib/materialBrain/provenanceValidation'
import { classifyFailure, shouldRetryChunk } from '../../lib/materialBrain/retryClassification'
import { createChunkTelemetry, recordRejection, aggregateBuildTelemetry } from '../../lib/materialBrain/extractionTelemetry'
import { chunkMaterials, chunkMaterial, splitIntoPages, DEFAULT_CHUNK_SIZE_CHARS } from '../../lib/materialBrain/chunking'
import { tryRecoverUnitsFromRawLLMText } from '../../lib/materialBrain/extraction'
import type { PageChunk, ResolvedSourceMaterial } from '../../lib/materialBrain/types'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log('  ✅ ' + name)
    passed++
  } catch (err: any) {
    console.log('  ❌ ' + name)
    console.log('     ' + err.message)
    failed++
  }
}

// ─── helpers ─────────────────────────────────────────────────

function makeTruncatedJSON_3of4(): string {
  const part1 = '{"units":['
  const obj1 = '{"kind":"concept","canonicalSubject":"Fotosíntesis","page":1,"quote":"proceso fotosintético"},'
  const obj2 = '{"kind":"fact","canonicalSubject":"Clorofila","page":1,"quote":"pigmento verde"},'
  const obj3 = '{"kind":"definition","canonicalSubject":"ATP","page":2,"quote":"adenosín trifosfato"},'
  const obj4start = '{"kind":"formula","canonicalSubject":"Ecuación fotosíntesis","page":2,"quote":"6CO2'
  return part1 + obj1 + obj2 + obj3 + obj4start
}

function makeTruncatedJSON_insideFirst(): string {
  return '{"units":[{"kind":"concept","canonicalSubject":"Fo'
}

function makeTruncatedJSON_afterClose(): string {
  return '{"units":[{"a":1},{"b":2}],"rela'
}

function makeEscapedQuotesJSON(): string {
  return '{"units":[{"kind":"fact","canonicalSubject":"Cita con \\"comillas\\"","page":1,"quote":"texto con \\"escaped\\" quotes aquí"},{"kind":"concept","canonicalSubject":"Segundo","page":1,"quote":"normal"}],"relations":[]}'
}

function makeTruncatedWithEscapedQuote(): string {
  return '{"units":[{"kind":"fact","canonicalSubject":"Completo","page":1,"quote":"texto"},{"kind":"concept","canonicalSubject":"Truncado con \\"quote'
}

/**
 * Genera texto con párrafos reales separados por doble newline,
 * para que splitDensePage pueda cortar en límites de párrafo.
 * Cada párrafo tiene ~100 chars — una página de `charsPerPage` chars
 * tendrá charsPerPage/100 párrafos.
 */
function buildDenseText(pages: number, charsPerPage: number): string {
  const segments: string[] = []
  const charsPerParagraph = 100
  const paragraphsPerPage = Math.ceil(charsPerPage / charsPerParagraph)

  for (let i = 0; i < pages; i++) {
    const pageNum = i + 1
    const paragraphs: string[] = []
    for (let p = 0; p < paragraphsPerPage; p++) {
      // ~100 chars por párrafo
      paragraphs.push(
        'Este es el párrafo ' + (p + 1) + ' de la página ' + pageNum +
        '. Contiene información relevante sobre el tema estudiado número ' + (p + 1) + '.'
      )
    }
    segments.push('[Pagina ' + pageNum + ']\n' + paragraphs.join('\n\n'))
  }
  return segments.join('\n\n')
}

function makeLLMTruncatedOutput(): string {
  return [
    '{',
    '  "units": [',
    '    {',
    '      "kind": "fact",',
    '      "canonicalSubject": "Ácido clorhídrico",',
    '      "qualifiers": [],',
    '      "label": "Ácido clorhídrico",',
    '      "statement": "Es un ácido fuerte.",',
    '      "quote": "El ácido clorhídrico es un ácido fuerte",',
    '      "page": 1,',
    '      "domainTags": ["química"],',
    '      "modelSuggestedTier": "supporting"',
    '    },',
    '    {',
    '      "kind": "formula",',
    '      "canonicalSubject": "pH",',
    '      "qualifiers": [],',
    '      "label": "Cálculo de pH",',
    '      "statement": "Fórmula de pH.",',
    '      "quote": "El pH se calcula con logaritmos",',
    '      "page": 2,',
    '      "domainTags": ["química"],',
    '      "modelSuggestedTier": "critical"',
    '    },',
    '    {',
    '      "kind": "concept",',
    '      "canonicalSubject": "Truncado",',
    '      "qualifiers": [],',
    '      "label": "Truncado',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────
// TEST 1 — JSON válido completo sigue parseando normalmente
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 1: JSON válido completo ──')

test('objeto con array units parsea correctamente', () => {
  const json = JSON.stringify({
    units: [
      { kind: 'concept', canonicalSubject: 'Fotosíntesis', page: 1, quote: 'proceso de conversión' },
      { kind: 'fact', canonicalSubject: 'Clorofila', page: 1, quote: 'pigmento verde' },
    ],
    relations: [],
  })
  const result = recoverLLMResponse(json, ['units', 'relations'])
  assert.equal(result.strategy, 'full_parse')
  assert.equal(result.isPartial, false)
  assert.equal(result.result.units.length, 2)
  assert.equal(result.result.relations.length, 0)
})

test('array directo parsea correctamente', () => {
  const json = JSON.stringify([{ a: 1 }, { b: 2 }])
  const result = extractCompleteObjects(json)
  assert.equal(result.strategy, 'full_parse')
  assert.equal(result.recovered.length, 2)
  assert.equal(result.truncatedCount, 0)
})

test('JSON vacío retorna arrays vacíos sin error', () => {
  const result = recoverLLMResponse('{}', ['units', 'relations'])
  assert.equal(result.result.units.length, 0)
  assert.equal(result.result.relations.length, 0)
  assert.equal(result.isPartial, false)
})

test('JSON completo con relations también parsea correctamente', () => {
  const json = JSON.stringify({
    units: [{ kind: 'concept', canonicalSubject: 'X', page: 1, quote: 'cita X' }],
    relations: [{ type: 'depends_on', fromSubject: 'X', toSubject: 'Y', statement: 's', quote: 'q', page: 1 }],
  })
  const result = recoverLLMResponse(json, ['units', 'relations'])
  assert.equal(result.strategy, 'full_parse')
  assert.equal(result.result.units.length, 1)
  assert.equal(result.result.relations.length, 1)
})

// ─────────────────────────────────────────────────────────────
// TEST 2 — JSON truncado recupera objetos completos
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 2: JSON truncado — recupera completos ──')

test('3 objetos completos + 1 truncado → recupera 3', () => {
  const truncated = makeTruncatedJSON_3of4()
  const result = recoverLLMResponse(truncated, ['units', 'relations'])
  assert.equal(result.strategy, 'partial_recovery', 'estrategia: ' + result.strategy)
  assert.equal(result.result.units.length, 3, 'esperados 3, got ' + result.result.units.length)
  assert.equal(result.isPartial, true)
})

test('truncado justo después del cierre del último objeto completo', () => {
  const truncated = makeTruncatedJSON_afterClose()
  const result = recoverLLMResponse(truncated, ['units', 'relations'])
  assert.ok(result.result.units.length >= 2, 'esperados >=2, got ' + result.result.units.length)
})

test('truncado dentro del primer objeto → 0 recuperados sin crash', () => {
  const truncated = makeTruncatedJSON_insideFirst()
  const result = recoverLLMResponse(truncated, ['units', 'relations'])
  assert.equal(result.result.units.length, 0)
})

// ─────────────────────────────────────────────────────────────
// TEST 3 — KU parcialmente cortada NO aparece
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 3: Objeto parcial no aparece ──')

test('objeto truncado a la mitad no aparece en recovered', () => {
  const truncated =
    '{"units":[\n' +
    '  {"kind":"concept","canonicalSubject":"Célula","page":1,"quote":"unidad básica"},\n' +
    '  {"kind":"fact","canonicalSubject":"Mitocondria","page":1,"quote":"orgánulo energético"},\n' +
    '  {"kind":"definition","canonicalSubject":"ADN","page":2,"quote":"ácido desoxirribo'

  const result = recoverLLMResponse(truncated, ['units', 'relations'])
  assert.equal(result.result.units.length, 2, 'solo 2 completos, got ' + result.result.units.length)

  const subjects = (result.result.units as any[]).map((u: any) => u.canonicalSubject)
  assert.ok(!subjects.includes('ADN'), 'ADN (truncado) no debe aparecer')
  assert.ok(subjects.includes('Célula'))
  assert.ok(subjects.includes('Mitocondria'))
})

// ─────────────────────────────────────────────────────────────
// TEST 4 — Strings con { } y escaped quotes no rompen el recovery
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 4: Braces en strings y escaped quotes ──')

test('quote con braces dentro no confunde el parser de profundidad', () => {
  const json = JSON.stringify({
    units: [
      { kind: 'formula', canonicalSubject: 'Función delta', page: 1, quote: 'δ{x} = {1 si x=0}' },
      { kind: 'concept', canonicalSubject: 'Conjunto', page: 1, quote: 'conjunto {a, b, c}' },
    ],
    relations: [],
  })
  const result = recoverLLMResponse(json, ['units', 'relations'])
  assert.equal(result.result.units.length, 2)
  assert.equal(result.strategy, 'full_parse')
})

test('escaped quotes en strings no rompen el parser de estado', () => {
  const json = makeEscapedQuotesJSON()
  const result = recoverLLMResponse(json, ['units', 'relations'])
  assert.equal(result.result.units.length, 2, 'esperados 2, got ' + result.result.units.length)
})

test('findObjectEnd maneja braces anidados correctamente', () => {
  const source = '{"a":{"b":{"c":1}},"d":2}'
  const end = findObjectEnd(source, 0)
  assert.equal(end, source.length - 1)
})

test('JSON truncado con escaped quotes en objeto incompleto', () => {
  const truncated = makeTruncatedWithEscapedQuote()
  const result = recoverLLMResponse(truncated, ['units', 'relations'])
  assert.equal(result.result.units.length, 1, 'solo el completo, got ' + result.result.units.length)
  assert.equal((result.result.units[0] as any).canonicalSubject, 'Completo')
})

test('arrays anidados dentro de objetos no confunden la profundidad', () => {
  const json = JSON.stringify({
    units: [
      { kind: 'formula', canonicalSubject: 'F', page: 1, quote: 'q', variables: [{ symbol: 'x', meaning: 'var' }] },
      { kind: 'concept', canonicalSubject: 'C', page: 1, quote: 'q2' },
    ],
    relations: [],
  })
  const result = recoverLLMResponse(json, ['units', 'relations'])
  assert.equal(result.result.units.length, 2)
})

// ─────────────────────────────────────────────────────────────
// TEST 5 — Whitespace-only provenance mismatch se acepta
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 5: Whitespace normalization — acepta ──')

test('múltiples espacios en source vs uno en quote → acepta', () => {
  const source = 'El pH  disminuye  cuando  aumenta  la  concentración.'
  const quote = 'El pH disminuye cuando aumenta la concentración.'
  assert.ok(quoteExistsInSource(source, quote))
})

test('newline en source vs espacio en quote → acepta', () => {
  const source = 'El ácido\nfuerte se disocia\ncompleto en agua.'
  const quote = 'El ácido fuerte se disocia completo en agua.'
  assert.ok(quoteExistsInSource(source, quote))
})

test('tab en source vs espacio en quote → acepta', () => {
  const source = 'La presión\tatmosférica es de 1 atm.'
  const quote = 'La presión atmosférica es de 1 atm.'
  assert.ok(quoteExistsInSource(source, quote))
})

test('CR+LF en source → acepta', () => {
  const source = 'El agua\r\nhierve a 100°C.'
  const quote = 'El agua hierve a 100°C.'
  assert.ok(quoteExistsInSource(source, quote))
})

test('normalizeWhitespace colapsa secuencias mixtas', () => {
  const result = normalizeWhitespace('hola  \t\n  mundo   \r\n  !')
  assert.equal(result, 'hola mundo !')
})

// ─────────────────────────────────────────────────────────────
// TEST 6 — Cambio de palabra/significado en quote se rechaza
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 6: Cambio semántico en quote — rechaza ──')

test('cambio de "disminuye" a "aumenta" se rechaza (strict)', () => {
  const source = 'El pH disminuye cuando aumenta la concentración.'
  const quote = 'El pH aumenta cuando aumenta la concentración.'
  assert.ok(!quoteExistsInSourceStrict(source, quote))
})

test('cambio de número (100°C → 93°C) se rechaza (strict)', () => {
  const source = 'El agua hierve a 100°C a nivel del mar.'
  const quote = 'El agua hierve a 93°C a nivel del mar.'
  assert.ok(!quoteExistsInSourceStrict(source, quote))
})

test('quote completamente inventada se rechaza', () => {
  const source = 'La fotosíntesis ocurre en los cloroplastos.'
  const quote = 'La respiración celular ocurre en las mitocondrias.'
  assert.ok(!quoteExistsInSource(source, quote))
})

test('quote con orden de palabras diferente se rechaza en modo strict', () => {
  const source = 'Los ácidos donan protones según Brønsted-Lowry.'
  const quote = 'Según Brønsted-Lowry los ácidos donan protones.'
  assert.ok(!quoteExistsInSourceStrict(source, quote))
})

test('whitespace extra con palabras correctas → acepta en modo normal', () => {
  const source = 'Los  ácidos  donan  protones.'
  const quote = 'Los ácidos donan protones.'
  assert.ok(quoteExistsInSource(source, quote))
})

// ─────────────────────────────────────────────────────────────
// TEST 7 — Conteos raw/accepted/rejected coherentes
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 7: Conteos raw/accepted/rejected coherentes ──')

test('recordRejection mantiene rejectedUnits == rejectedUnitRecords.length', () => {
  const telemetry = createChunkTelemetry('chunk1', 'mat1', [1])
  // Solo usamos recordRejection — es la única fuente de verdad para rechazos
  recordRejection(telemetry, 'invalid_kind', { kind: 'unknown', detail: 'test' })
  recordRejection(telemetry, 'quote_not_in_source', { canonicalSubject: 'X' })

  assert.equal(telemetry.rejectedUnitRecords.length, 2)
  assert.equal(telemetry.rejectedUnits, 2, 'rejectedUnits debe coincidir con rejectedUnitRecords.length')
})

test('rawUnits = acceptedUnits + rejectedUnits cuando se setean correctamente', () => {
  const telemetry = createChunkTelemetry('chunk1', 'mat1', [1])
  // Simular: LLM emitió 5 unidades, 3 aceptadas, 2 rechazadas
  telemetry.rawUnits = 5
  telemetry.acceptedUnits = 3
  recordRejection(telemetry, 'invalid_kind')
  recordRejection(telemetry, 'quote_not_in_source')

  assert.equal(telemetry.rejectedUnits, 2)
  assert.equal(
    telemetry.acceptedUnits + telemetry.rejectedUnits,
    telemetry.rawUnits,
    'accepted + rejected debe igualar raw',
  )
})

test('agregación build: suma correcta de múltiples chunks', () => {
  const chunk1 = createChunkTelemetry('c1', 'm1', [1])
  chunk1.rawUnits = 10
  chunk1.acceptedUnits = 8
  // 2 rechazos
  recordRejection(chunk1, 'invalid_kind')
  recordRejection(chunk1, 'malformed_unit')

  const chunk2 = createChunkTelemetry('c2', 'm1', [2])
  chunk2.rawUnits = 6
  chunk2.acceptedUnits = 4
  chunk2.wasRecovered = true
  // 2 rechazos
  recordRejection(chunk2, 'quote_not_in_source')
  recordRejection(chunk2, 'invalid_provenance')

  const build = aggregateBuildTelemetry([chunk1, chunk2])
  assert.equal(build.totalRawUnits, 16)
  assert.equal(build.totalAcceptedUnits, 12)
  assert.equal(build.totalRejectedUnits, 4)
  assert.equal(build.chunksWithRecovery, 1)
  assert.equal(build.chunksTotal, 2)
  assert.equal(build.rejectionsByReason['invalid_kind'], 1)
  assert.equal(build.rejectionsByReason['malformed_unit'], 1)
  assert.equal(build.rejectionsByReason['quote_not_in_source'], 1)
  assert.equal(build.rejectionsByReason['invalid_provenance'], 1)
})

// ─────────────────────────────────────────────────────────────
// TEST 8 — Cada rejected unit conserva reason auditable
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 8: Reasons auditables en rejected units ──')

test('cada rechazo tiene reason y detail opcional', () => {
  const telemetry = createChunkTelemetry('c1', 'm1', [1])
  recordRejection(telemetry, 'invalid_kind', { kind: 'unknown_type', detail: 'kind inválido recibido del LLM' })
  recordRejection(telemetry, 'quote_not_in_source', { canonicalSubject: 'Fotosíntesis', page: 1, detail: 'quote no encontrada' })
  recordRejection(telemetry, 'malformed_unit', { detail: 'canonicalSubject ausente' })

  assert.equal(telemetry.rejectedUnitRecords.length, 3)
  assert.equal(telemetry.rejectedUnitRecords[0].reason, 'invalid_kind')
  assert.equal(telemetry.rejectedUnitRecords[0].kind, 'unknown_type')
  assert.ok(telemetry.rejectedUnitRecords[0].detail?.includes('inválido'))
  assert.equal(telemetry.rejectedUnitRecords[1].reason, 'quote_not_in_source')
  assert.equal(telemetry.rejectedUnitRecords[1].canonicalSubject, 'Fotosíntesis')
  assert.equal(telemetry.rejectedUnitRecords[2].reason, 'malformed_unit')
})

test('aggregated build telemetry preserva todas las reasons', () => {
  const c = createChunkTelemetry('c1', 'm1', [1])
  recordRejection(c, 'invalid_structure')
  recordRejection(c, 'incomplete_recovered_object')
  const build = aggregateBuildTelemetry([c])
  assert.equal(build.rejectionsByReason['invalid_structure'], 1)
  assert.equal(build.rejectionsByReason['incomplete_recovered_object'], 1)
})

// ─────────────────────────────────────────────────────────────
// TEST 9 — Error transient sigue permitiendo retry
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 9: Error transient → retry permitido ──')

test('timeout classified as transient → shouldRetry=true', () => {
  const failure = classifyFailure(new Error('Request timeout after 30000ms'))
  assert.equal(failure.class, 'transient')
  assert.equal(failure.shouldRetry, true)
})

test('429 rate limit classified as transient → shouldRetry=true', () => {
  const failure = classifyFailure(new Error('429 Too Many Requests: rate limit exceeded'))
  assert.equal(failure.class, 'transient')
  assert.equal(failure.shouldRetry, true)
})

test('503 service unavailable classified as transient', () => {
  const failure = classifyFailure(new Error('503 Service Unavailable'))
  assert.equal(failure.class, 'transient')
  assert.equal(failure.shouldRetry, true)
})

test('ECONNRESET classified as transient', () => {
  const failure = classifyFailure(new Error('read ECONNRESET'))
  assert.equal(failure.class, 'transient')
  assert.equal(failure.shouldRetry, true)
})

test('shouldRetryChunk: transient + attempts < max → true', () => {
  const failure = classifyFailure(new Error('timeout'))
  assert.equal(shouldRetryChunk(failure, 0, 3), true)
})

test('shouldRetryChunk: transient + attempts >= max → false', () => {
  const failure = classifyFailure(new Error('timeout'))
  assert.equal(shouldRetryChunk(failure, 3, 3), false)
})

// ─────────────────────────────────────────────────────────────
// TEST 10 — Error deterministic-structural NO dispara retries
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 10: Error deterministic-structural → NO retry ──')

test('STRUCTURAL_VALIDATION_FAILED classified as deterministic-structural', () => {
  const failure = classifyFailure(new Error('STRUCTURAL_VALIDATION_FAILED:no_units_survived_validation'))
  assert.equal(failure.class, 'deterministic-structural')
  assert.equal(failure.shouldRetry, false)
})

test('provenance_violation classified as deterministic-structural', () => {
  const failure = classifyFailure(new Error('provenance_violation: materialId mismatch'))
  assert.equal(failure.class, 'deterministic-structural')
  assert.equal(failure.shouldRetry, false)
})

test('shouldRetryChunk: deterministic-structural → false aunque haya intentos disponibles', () => {
  const failure = classifyFailure(new Error('STRUCTURAL_VALIDATION_FAILED:no_units_survived_validation'))
  assert.equal(shouldRetryChunk(failure, 0, 5), false)
})

test('recoverable-format con unidades salvadas → shouldRetry=false', () => {
  const failure = classifyFailure(new Error('INVALID_JSON'), { wasRecovered: true, recoveredCount: 3 })
  assert.equal(failure.class, 'recoverable-format')
  assert.equal(failure.shouldRetry, false)
})

test('recoverable-format con 0 unidades salvadas → shouldRetry=true', () => {
  const failure = classifyFailure(new Error('INVALID_JSON'), { wasRecovered: false, recoveredCount: 0 })
  assert.equal(failure.class, 'recoverable-format')
  assert.equal(failure.shouldRetry, true)
})

// ─────────────────────────────────────────────────────────────
// TEST 11 — Chunking conservador cubre 100% sin pérdida
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 11: Chunking conservador — cobertura total ──')

test('DEFAULT_CHUNK_SIZE_CHARS es 3500', () => {
  assert.equal(DEFAULT_CHUNK_SIZE_CHARS, 3500)
})

test('chunk único: texto pequeño no se divide innecesariamente', () => {
  const material: ResolvedSourceMaterial = {
    materialId: 'mat_test',
    nombre: 'Test',
    kind: 'pdf',
    knownPages: [1],
    text: '[Pagina 1]\nTexto corto.',
  }
  const chunks = chunkMaterial(material)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].materialId, 'mat_test')
  assert.equal(chunks[0].pages[0], 1)
})

test('texto denso (4000 chars/página con párrafos reales) se divide en más chunks que páginas', () => {
  // 4000 chars/página > 3500 umbral → debe dividirse
  const material: ResolvedSourceMaterial = {
    materialId: 'mat_dense',
    nombre: 'Dense',
    kind: 'pdf',
    text: buildDenseText(3, 4000),
  }
  const chunks = chunkMaterial(material)

  // Con 4000 chars/página y umbral 3500, cada página debe producir al menos 2 sub-chunks
  assert.ok(chunks.length > 3, 'páginas densas deben generar más chunks que páginas, got ' + chunks.length)

  const coveredPages = new Set(chunks.flatMap(c => c.pages))
  assert.ok(coveredPages.has(1), 'página 1 cubierta')
  assert.ok(coveredPages.has(2), 'página 2 cubierta')
  assert.ok(coveredPages.has(3), 'página 3 cubierta')

  const allText = chunks.map(c => c.text).join(' ')
  for (let p = 1; p <= 3; p++) {
    assert.ok(allText.includes('[Pagina ' + p + ']'), 'marcador Pagina ' + p + ' debe estar en algún chunk')
  }
})

test('páginas pequeñas se agrupan: menos chunks que páginas', () => {
  const parts: string[] = []
  for (let i = 0; i < 10; i++) {
    parts.push('[Pagina ' + (i + 1) + ']\nPágina corta ' + (i + 1) + '.')
  }
  const material: ResolvedSourceMaterial = {
    materialId: 'mat_small_pages',
    nombre: 'SmallPages',
    kind: 'pdf',
    text: parts.join('\n\n'),
  }
  const chunks = chunkMaterial(material)
  assert.ok(chunks.length < 10, 'páginas pequeñas deben agruparse, got ' + chunks.length)
  const coveredPages = new Set(chunks.flatMap(c => c.pages))
  for (let p = 1; p <= 10; p++) {
    assert.ok(coveredPages.has(p), 'página ' + p + ' debe estar cubierta')
  }
})

test('materialId se preserva en todos los chunks generados', () => {
  const material: ResolvedSourceMaterial = {
    materialId: 'mat_identity_check',
    nombre: 'IDCheck',
    kind: 'pdf',
    text: buildDenseText(4, 4000),
  }
  const chunks = chunkMaterial(material)
  for (const chunk of chunks) {
    assert.equal(chunk.materialId, 'mat_identity_check', 'chunk ' + chunk.id + ' tiene materialId incorrecto')
  }
})

test('no hay pérdida de contenido: texto total cubierto por todos los chunks', () => {
  // Verificar que el número de páginas cubiertas == número de páginas del material
  const material: ResolvedSourceMaterial = {
    materialId: 'mat_coverage',
    nombre: 'Coverage',
    kind: 'pdf',
    text: buildDenseText(5, 3000),
  }
  const chunks = chunkMaterial(material)
  const coveredPages = new Set(chunks.flatMap(c => c.pages))
  for (let p = 1; p <= 5; p++) {
    assert.ok(coveredPages.has(p), 'página ' + p + ' debe estar cubierta')
  }
})

// ─────────────────────────────────────────────────────────────
// TEST 12 — Multi-material/page provenance separada
// ─────────────────────────────────────────────────────────────
console.log('\n── TEST 12: Multi-material provenance separada ──')

test('página 2 de mat_a y página 2 de mat_b generan chunks distintos', () => {
  const matA: ResolvedSourceMaterial = {
    materialId: 'mat_a',
    nombre: 'Material A',
    kind: 'pdf',
    knownPages: [1, 2],
    text: '[Pagina 1]\nContenido A1.\n\n[Pagina 2]\nContenido A2.',
  }
  const matB: ResolvedSourceMaterial = {
    materialId: 'mat_b',
    nombre: 'Material B',
    kind: 'pdf',
    knownPages: [1, 2],
    text: '[Pagina 1]\nContenido B1.\n\n[Pagina 2]\nContenido B2.',
  }
  const chunks = chunkMaterials([matA, matB])

  const chunksA = chunks.filter(c => c.materialId === 'mat_a')
  const chunksB = chunks.filter(c => c.materialId === 'mat_b')
  assert.ok(chunksA.length > 0)
  assert.ok(chunksB.length > 0)

  for (const chunk of chunks) {
    assert.ok(chunk.materialId === 'mat_a' || chunk.materialId === 'mat_b')
  }

  const chunkWithA2 = chunks.find(c => c.materialId === 'mat_a' && c.pages.includes(2))
  const chunkWithB2 = chunks.find(c => c.materialId === 'mat_b' && c.pages.includes(2))
  assert.ok(chunkWithA2, 'debe existir chunk con mat_a página 2')
  assert.ok(chunkWithB2, 'debe existir chunk con mat_b página 2')
  assert.notEqual(chunkWithA2!.id, chunkWithB2!.id)
  assert.equal(chunkWithA2!.materialId, 'mat_a')
  assert.equal(chunkWithB2!.materialId, 'mat_b')
})

test('splitIntoPages no mezcla contenido de páginas distintas', () => {
  const text = '[Pagina 1]\nContenido uno.\n\n[Pagina 2]\nContenido dos.\n\n[Pagina 3]\nContenido tres.'
  const pages = splitIntoPages(text)
  assert.equal(pages.length, 3)
  assert.equal(pages[0].page, 1)
  assert.ok(pages[0].text.includes('uno'))
  assert.ok(!pages[0].text.includes('dos'))
  assert.equal(pages[1].page, 2)
  assert.ok(pages[1].text.includes('dos'))
  assert.ok(!pages[1].text.includes('tres'))
  assert.equal(pages[2].page, 3)
  assert.ok(pages[2].text.includes('tres'))
})

test('ningún chunk tiene materialId de dos materiales distintos', () => {
  const matA: ResolvedSourceMaterial = {
    materialId: 'mat_x',
    nombre: 'X',
    kind: 'pdf',
    text: buildDenseText(2, 2000),
  }
  const matB: ResolvedSourceMaterial = {
    materialId: 'mat_y',
    nombre: 'Y',
    kind: 'pdf',
    text: buildDenseText(2, 2000),
  }
  const chunks = chunkMaterials([matA, matB])
  for (const chunk of chunks) {
    assert.ok(chunk.materialId === 'mat_x' || chunk.materialId === 'mat_y')
  }
})

test('tryRecoverUnitsFromRawLLMText: extrae unidades de texto truncado con provenance válida', () => {
  const chunk: PageChunk = {
    id: 'c1',
    materialId: 'mat_test',
    pages: [1, 2],
    order: 0,
    text: '[Pagina 1]\nEl ácido clorhídrico es un ácido fuerte.\n\n[Pagina 2]\nEl pH se calcula con logaritmos.',
  }

  const result = tryRecoverUnitsFromRawLLMText(makeLLMTruncatedOutput(), chunk)
  assert.ok(result.units.length >= 2, 'debe recuperar al menos 2 unidades, got ' + result.units.length)
  assert.equal(result.wasRecovered, true)
  assert.ok(result.truncatedCount >= 1)

  const subjects = result.units.map(u => u.canonicalSubject)
  assert.ok(subjects.includes('Ácido clorhídrico'))
  assert.ok(subjects.includes('pH'))
  assert.ok(!subjects.includes('Truncado'))
})

// ─────────────────────────────────────────────────────────────
// Resumen
// ─────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
console.log('Tests: ' + (passed + failed) + ' total | ✅ ' + passed + ' passed | ❌ ' + failed + ' failed')
if (failed > 0) {
  console.log('\n❌ Algunos tests fallaron.')
  process.exit(1)
} else {
  console.log('\n✅ Todos los tests de hardening pasaron.')
}
