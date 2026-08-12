// StudyAL_Visual_System_Stress_Test — Layer B GAP "cancellation — demuestra
// ahorro" (pedido explícito del usuario). Prueba las 3 rutas REALES
// (app/api/adaptive/blueprint, generate-plan, session-copy) con una request
// que llega YA cancelada (mismo AbortSignal que produciría un cliente que
// navegó fuera antes de que el servidor alcanzara el checkpoint) y confirma
// NUMÉRICAMENTE que la siguiente llamada remota cara NUNCA se despacha —
// no por inspección de código, sino instrumentando el punto exacto que
// haría esa llamada (lib/alai para blueprint/session-copy,
// buildLearningJourney para generate-plan) y contando invocaciones reales.
//
// NOTA TÉCNICA: node:test's mock.module() no permite re-mockear el MISMO
// módulo dos veces en el mismo proceso — por eso lib/alai y next-auth se
// mockean UNA sola vez arriba, con contadores/modo mutables reseteados por
// test, en vez de un mock.module por test.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

const alaiCalls = { alai: 0, alaiJson: 0, alaiRequest: 0 }
let alaiMode: 'throw' | 'succeed' = 'throw'
function resetAlaiCalls() { alaiCalls.alai = 0; alaiCalls.alaiJson = 0; alaiCalls.alaiRequest = 0 }

mock.module('../../lib/alai', {
  namedExports: {
    alai: async () => {
      alaiCalls.alai += 1
      if (alaiMode === 'throw') throw new Error('alai NO debía invocarse tras abort')
      return { text: '{}', provider: 'openrouter', model: 'google/gemini-2.5-flash' }
    },
    alaiJson: async () => {
      alaiCalls.alaiJson += 1
      if (alaiMode === 'throw') throw new Error('alaiJson NO debía invocarse tras abort')
      return { topics: [], blocks: [] }
    },
    alaiRequest: async () => {
      alaiCalls.alaiRequest += 1
      if (alaiMode === 'throw') throw new Error('alaiRequest NO debía invocarse tras abort')
      return { choices: [{ message: { content: '[]' } }] }
    },
  },
})

mock.module('next-auth', {
  namedExports: { getServerSession: async () => ({ user: { id: 'cancel-test-user' } }) },
})

let journeyBuilderCalls = 0
mock.module('../../lib/adaptive/journeyBuilder', {
  namedExports: {
    buildLearningJourney: async () => { journeyBuilderCalls += 1; throw new Error('buildLearningJourney NO debía invocarse tras abort') },
  },
})

// ---------------------------------------------------------------------------
// A — /api/adaptive/blueprint: signal abortado antes de llegar al checkpoint
// -> alaiJson (la llamada remota cara de visión/estructura) NUNCA se invoca.
// ---------------------------------------------------------------------------
test('A: blueprint aborted -> alaiJson nunca se invoca (0 llamadas)', async () => {
  resetAlaiCalls()
  alaiMode = 'throw'

  const { POST } = await import('../../app/api/adaptive/blueprint/route')
  const { NextRequest } = await import('next/server')

  const req = new NextRequest('http://localhost/api/adaptive/blueprint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ materials: [{ materialId: 'm1', materialName: 'Material', text: 'contenido suficiente para superar el mínimo de extracción de texto requerido por la ruta', selectedPages: [] }] }),
    signal: abortedSignal(),
  })

  const res = await POST(req)
  const json = await res.json()

  assert.equal(res.status, 499, 'A: debe responder 499 (cancelado) inmediatamente, no procesar')
  assert.equal(json.cancelled, true, 'A: debe marcar cancelled=true explícitamente')
  assert.equal(alaiCalls.alaiJson, 0, 'A: alaiJson (visión/estructura) NUNCA debe invocarse tras un signal ya abortado — este es el ahorro real, no solo un código de error')
  console.log('cancellation-provider-call-avoidance: A (blueprint aborted -> 0 llamadas a alaiJson) PASS')
})

// ---------------------------------------------------------------------------
// B — /api/adaptive/generate-plan: signal abortado -> buildLearningJourney
// (la etapa cara siguiente, que en cascada llamaría a session-copy) NUNCA se
// invoca.
// ---------------------------------------------------------------------------
test('B: generate-plan aborted -> buildLearningJourney nunca se invoca (0 llamadas, por tanto session-copy tampoco)', async () => {
  journeyBuilderCalls = 0

  const { POST } = await import('../../app/api/adaptive/generate-plan/route')
  const { NextRequest } = await import('next/server')

  const validBlueprint = { version: 1, blocks: [{ id: 'b1' }], topics: [] }
  const validQuality = { status: 'complete', reasons: [], coverageCertified: true, planGenerationAllowed: true, certificationReasons: [] }

  const req = new NextRequest('http://localhost/api/adaptive/generate-plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      blueprint: validBlueprint, quality: validQuality, materialTitle: 'Material de prueba',
      setup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', evalPreference: 'mix_everything' },
    }),
    signal: abortedSignal(),
  })

  const res = await POST(req)
  const json = await res.json()

  assert.equal(res.status, 499, 'B: debe responder 499 (cancelado) inmediatamente')
  assert.equal(json.cancelled, true, 'B: debe marcar cancelled=true explícitamente')
  assert.equal(journeyBuilderCalls, 0, 'B: buildLearningJourney NUNCA debe invocarse tras un signal ya abortado — como session-copy solo se alcanza DESDE adentro de buildLearningJourney, esto prueba en cascada que session-copy tampoco se dispara')
  console.log('cancellation-provider-call-avoidance: B (generate-plan aborted -> 0 llamadas a buildLearningJourney, session-copy nunca se alcanza) PASS')
})

// ---------------------------------------------------------------------------
// C — /api/adaptive/session-copy: signal abortado -> alaiRequest (el único
// gasto LLM real de esta ruta) NUNCA se invoca.
// ---------------------------------------------------------------------------
test('C: session-copy aborted -> alaiRequest nunca se invoca (0 llamadas)', async () => {
  resetAlaiCalls()
  alaiMode = 'throw'

  const { POST } = await import('../../app/api/adaptive/session-copy/route')
  const { NextRequest } = await import('next/server')

  const req = new NextRequest('http://localhost/api/adaptive/session-copy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessions: [{ sessionNumber: 1, topicLabel: 'Topic', role: 'mechanism', concepts: [], blockCount: 3 }],
      materialTitle: 'Material de prueba',
      setup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying' },
    }),
    signal: abortedSignal(),
  })

  const res = await POST(req)
  const json = await res.json()

  assert.equal(res.status, 499, 'C: debe responder 499 (cancelado) inmediatamente')
  assert.equal(json.cancelled, true, 'C: debe marcar cancelled=true explícitamente')
  assert.equal(alaiCalls.alaiRequest, 0, 'C: alaiRequest (títulos/intros únicos) NUNCA debe invocarse tras un signal ya abortado')
  console.log('cancellation-provider-call-avoidance: C (session-copy aborted -> 0 llamadas a alaiRequest) PASS')
})

// ---------------------------------------------------------------------------
// D — control: SIN abortar, cada ruta SÍ debe alcanzar su llamada remota
// (prueba que el checkpoint no está bloqueando tráfico legítimo — el ahorro
// es condicional al abort, no un cortocircuito permanente).
// ---------------------------------------------------------------------------
test('D: control — sin abortar, blueprint SÍ alcanza alaiJson (el checkpoint no bloquea tráfico normal)', async () => {
  resetAlaiCalls()
  alaiMode = 'succeed'

  const { POST } = await import('../../app/api/adaptive/blueprint/route')
  const { NextRequest } = await import('next/server')

  const req = new NextRequest('http://localhost/api/adaptive/blueprint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ materials: [{ materialId: 'm1', materialName: 'Material', text: 'contenido suficiente para superar el mínimo de extracción de texto requerido por la ruta', selectedPages: [] }] }),
    // SIN signal abortado — un AbortController real, nunca abortado.
    signal: new AbortController().signal,
  })

  await POST(req).catch(() => undefined)
  assert.ok(alaiCalls.alaiJson > 0, 'D: sin abort, el pipeline SÍ debe alcanzar alaiJson — confirma que el checkpoint es condicional, no un bloqueo permanente')
  console.log('cancellation-provider-call-avoidance: D (control sin abort -> alaiJson SÍ se invoca) PASS')
})
