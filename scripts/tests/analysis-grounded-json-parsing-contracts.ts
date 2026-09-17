import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { safeParseJson, classifyJsonParseFailure } from '../../lib/alai'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/analizar-teorico/route'

// ============================================================
// ANALISIS_JSON_GENERATION regression: live Free Mode -> Análisis
// generation returned HTTP 200 twice from OpenRouter/Gemini with
// unparseable JSON (PROVIDER_GENERATION_FAILED, ~61s spent on two
// failed attempts). Root causes found by direct source inspection of
// lib/alai.ts + app/api/analizar-teorico/route.ts:
//   1. extractBalancedJsonObject silently picked the FIRST balanced
//      object when the provider emitted more than one top-level value
//      (ambiguous) instead of rejecting.
//   2. No deterministic repair existed for output truncated mid-object
//      by maxTokens — JSON.parse only ever saw an unterminated string.
//   3. The second (retry) attempt in safeGroundedAlaiJson SHRANK
//      maxTokens (Math.min(maxTokens, 8200)), making a truncation
//      failure on attempt 1 MORE likely to truncate again on attempt 2.
//
// This file proves the parsing layer in isolation (no network, no
// provider, no route) — see PROVIDER_GENERATION_FAILED behavior itself
// is exercised indirectly since safeGroundedAlaiJson calls straight
// through to this same safeParseJson via alaiJson.
// ============================================================

function test(name: string, fn: () => void) {
  fn()
  console.log(`  ✅ ${name}`)
}

const VALID = {
  objetivos: ['entender X'],
  clase_narrativa: [{ titulo: 'a', explicacion: 'b', ejemplo: '', checkpoint: '', targetIds: [] }],
}

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-json' }
const enjoyerPayload = {
  sourceSelectionFingerprint: 'fp-json', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2, 3] },
  topicsIndex: [{ id: 't1', title: 'Tema uno' }],
  globalOrderedAnalysis: [
    { id: 'crit1', kind: 'concept', name: 'Concepto crítico', content: 'Definición autorizada', importance: 90, difficulty: 'medium', topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'q1' }] },
  ],
  uniqueConceptsIndex: [], relations: [],
}

function validAlaiPayload() {
  return {
    objetivos: ['Entender el concepto crítico'],
    si_no_sabes_nada: 'Explicación inicial.',
    mapa_inicial: 'Mapa inicial.',
    clase_narrativa: [{ titulo: 'Clase 1', explicacion: 'Explicación pedagógica suficientemente larga.', ejemplo: '', checkpoint: '¿Por qué importa?', targetIds: ['analysis_target:crit1'] }],
    panorama_completo: 'Panorama.',
    conexiones_clave: [], errores_comunes: [], preguntas_profesor: [],
    resumen_final: 'Resumen.', preguntas_sugeridas: [],
  }
}

async function postAnalisis() {
  const response = await POST(new NextRequest('http://localhost/api/analizar-teorico', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-json', nivel: 'universidad', materia: 'X', tema: 'Y' }),
  }))
  return { response, data: await response.json() }
}

function baseRouteDeps(alaiJsonImpl: () => Promise<any>) {
  const store = new Map<string, any>([['fp-json', enjoyerPayload]])
  const artifacts = new Map<string, any>()
  return {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({ id: 'sess-json', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any,
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    lookupStudyalMaterialEnjoyer: async (fingerprint: string) => store.get(fingerprint) ?? null,
    materialEnjoyerStore: {} as any,
    analysisArtifactStore: {
      async get(identity: string) { return artifacts.get(identity) ?? null },
      async set(identity: string, artifact: any) { artifacts.set(identity, artifact) },
    } as any,
    alaiJson: alaiJsonImpl,
  }
}

async function testRetryPolicy() {
  // K/I proxy: the route's alaiJson passthrough calls straight into the
  // hardened safeParseJson (via lib/alai.ts's real alaiJson in
  // production) — here we mock __routeDeps.alaiJson directly to control
  // exactly how many provider attempts happen, per handleGroundedAnalysisRequest's
  // documented "at most one retry" contract.

  // I/K: a single successful call never triggers a second provider call.
  {
    let calls = 0
    Object.assign(__routeDeps, baseRouteDeps(async () => { calls++; return validAlaiPayload() }))
    const { response, data } = await postAnalisis()
    assert.equal(response.status, 200)
    assert.equal(calls, 1, 'I: a recoverable/successful first attempt causes exactly 0 second provider calls')
    assert.equal(data.analisis.grounding.authorityType, 'studyal_material_enjoyer', 'M: Enjoyer remains the sole authority')
  }

  // J/K: first attempt throws INVALID_JSON, second attempt succeeds — at
  // most one retry, and it must succeed.
  {
    let calls = 0
    Object.assign(__routeDeps, baseRouteDeps(async () => {
      calls++
      if (calls === 1) { const e: any = new Error('ALAI: INVALID_JSON'); e.code = 'INVALID_JSON'; e.jsonFailureClass = 'TRUNCATED'; throw e }
      return validAlaiPayload()
    }))
    const { response } = await postAnalisis()
    assert.equal(response.status, 200)
    assert.equal(calls, 2, 'J: a genuinely unparseable first attempt gets exactly one retry, never more')
  }

  // K: two bad responses return an explicit controlled error, never a
  // silent success or an unbounded retry loop.
  {
    let calls = 0
    Object.assign(__routeDeps, baseRouteDeps(async () => {
      calls++
      const e: any = new Error('ALAI: INVALID_JSON'); e.code = 'INVALID_JSON'; e.jsonFailureClass = 'TRUNCATED'; throw e
    }))
    const { response, data } = await postAnalisis()
    assert.equal(response.status, 502)
    assert.equal(data.error, 'PROVIDER_GENERATION_FAILED')
    assert.equal(calls, 2, 'K: exactly two attempts total — no unbounded retry loop')
  }

  console.log('analysis-grounded-json-parsing-contracts: route retry policy (I/J/K) PASS')
}

async function testNoMaterialBrainAndEnjoyerLookupOnly() {
  // L/M: mirrors analysis-enjoyer-migration-contracts' own L/M proof —
  // reasserted here since this file specifically certifies the JSON
  // generation regression fix touched nothing about Brain/Enjoyer wiring.
  const fs = await import('node:fs')
  const routeSource = fs.readFileSync('app/api/analizar-teorico/route.ts', 'utf8')
  assert.ok(!routeSource.includes('restoreMaterialBrain') && !routeSource.includes('WorkerMaterialResultStore'),
    'L: no Material Brain runtime path was reintroduced by this fix')
  assert.ok(routeSource.includes('lookupStudyalMaterialEnjoyer') && !routeSource.includes('getOrCreateStudyalMaterialEnjoyer'),
    'M: Enjoyer remains lookup-only authority — this fix never builds/regenerates it')
  console.log('analysis-grounded-json-parsing-contracts: L/M (no Brain, Enjoyer lookup-only) PASS')
}

async function main() {
  test('A. valid strict JSON parses', () => {
    const raw = JSON.stringify(VALID)
    assert.deepEqual(safeParseJson(raw), VALID)
  })

  test('B. JSON inside ```json fence parses deterministically', () => {
    const raw = '```json\n' + JSON.stringify(VALID) + '\n```'
    assert.deepEqual(safeParseJson(raw), VALID)
  })

  test('C. harmless leading/trailing whitespace parses', () => {
    const raw = '\n\n   ' + JSON.stringify(VALID) + '   \n'
    assert.deepEqual(safeParseJson(raw), VALID)
  })

  test('D. unambiguous wrapper prose around one JSON object is handled', () => {
    const raw = 'Aquí tienes el análisis:\n' + JSON.stringify(VALID) + '\nEspero que ayude.'
    assert.deepEqual(safeParseJson(raw), VALID)
  })

  test('E. multiple ambiguous top-level JSON objects are rejected', () => {
    const raw = JSON.stringify(VALID) + '\n' + JSON.stringify({ objetivos: ['otro'] })
    assert.equal(safeParseJson(raw), null, 'must not silently pick the first of two top-level objects')
    assert.equal(classifyJsonParseFailure(raw), 'AMBIGUOUS_MULTIPLE_OBJECTS')
  })

  test('F. malformed/truncated JSON with no safe closing point is rejected', () => {
    const raw = '{"objetivos": ["a'  // truncated mid-string, no container ever closed
    assert.equal(safeParseJson(raw), null)
    assert.equal(classifyJsonParseFailure(raw), 'TRUNCATED')
  })

  test('G. valid JSON with schema-invalid shape still parses (schema validation is the route\'s job, not the parser\'s)', () => {
    const raw = JSON.stringify({ unexpected_top_level_field: true })
    assert.deepEqual(safeParseJson(raw), { unexpected_top_level_field: true })
  })

  test('H. truncation repair does not alter surviving academic content', () => {
    const full = {
      objetivos: ['entender fotosíntesis'],
      clase_narrativa: [
        { titulo: 'Fase luminosa', explicacion: 'ocurre en el tilacoide', ejemplo: '', checkpoint: '', targetIds: ['t1'] },
        { titulo: 'Fase oscura (Calvin)', explicacion: 'fija CO2 en el estroma', ejemplo: '', checkpoint: '', targetIds: ['t2'] },
      ],
      panorama_completo: 'sería el resto',
    }
    const serialized = JSON.stringify(full)
    // Simulate maxTokens truncation: cut off partway through the SECOND
    // clase_narrativa entry, after the FIRST one already closed cleanly.
    const cutAt = serialized.indexOf('"Fase oscura') + 15
    const truncated = serialized.slice(0, cutAt)
    const repaired = safeParseJson(truncated)
    assert.ok(repaired, 'a truncated-but-repairable payload must recover the complete leading content')
    assert.equal(repaired.objetivos[0], 'entender fotosíntesis', 'earlier untouched fields must be byte-identical')
    assert.equal(repaired.clase_narrativa[0].titulo, 'Fase luminosa')
    assert.equal(repaired.clase_narrativa[0].explicacion, 'ocurre en el tilacoide', 'no field content may be altered by the repair')
    // The incomplete trailing entry must not appear at all — repair never
    // invents/completes a partial value.
    assert.equal(repaired.clase_narrativa.length, 1, 'an incomplete trailing element must be dropped, never completed or invented')
  })

  test('I. classifyJsonParseFailure never throws on empty/garbage input', () => {
    assert.equal(classifyJsonParseFailure(''), 'EMPTY')
    assert.equal(classifyJsonParseFailure('   '), 'EMPTY')
    assert.equal(classifyJsonParseFailure('not json at all'), 'MALFORMED')
  })

  test('J. a repaired truncated array-of-objects payload keeps only complete entries', () => {
    const arr = { items: [{ a: 1 }, { a: 2 }, { a: 3 }] }
    const serialized = JSON.stringify(arr)
    const cutAt = serialized.lastIndexOf('{') + 3 // cut mid-third-object
    const truncated = serialized.slice(0, cutAt)
    const repaired = safeParseJson(truncated)
    assert.ok(repaired)
    assert.deepEqual(repaired.items, [{ a: 1 }, { a: 2 }])
  })

  await testRetryPolicy()
  await testNoMaterialBrainAndEnjoyerLookupOnly()

  console.log('analysis-grounded-json-parsing-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
