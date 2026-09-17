import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { alai } from '../../lib/alai'
import { generateValidatedLegacyJson } from '../../lib/ai/legacyRouteGeneration'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { renderMessageContent } from '../../components/materias/ALAIStudyALChat'
import { VisualRenderer } from '../../components/visual/VisualRenderer'
import type { VisualSpec } from '../../lib/adaptive/visual/visualContract'
import type { ChatTurnResult, StoredChatTurn } from '../../lib/alai-chat/turnStore'

// Real route, retrieval, validation, transport orchestration, persistence and SSR.
// --live opts into paid provider calls; offline supplies only the provider response.
const live = process.argv.includes('--live')
const onlyCase = Number(process.argv.find(arg => arg.startsWith('--case='))?.split('=')[1])
Object.assign(globalThis, { React }) // tsx uses the classic transform for Next's preserved JSX.
const selection = buildSourceSelectionSnapshot(['academic-fixture'], { 'academic-fixture': [1] })
const concepts = [
  ['celula', 'Célula', 'La célula es la unidad básica de los seres vivos.'],
  ['tejido', 'Tejido', 'Un tejido es un conjunto de células con funciones relacionadas.'],
  ['organo', 'Órgano', 'Un órgano integra tejidos que realizan una función.'],
  ['sistema', 'Sistema', 'Un sistema reúne órganos que colaboran en una función.'],
  ['organismo', 'Organismo', 'Un organismo es un ser vivo individual.'],
]
const material = {
  sourceSelectionFingerprint: selection.fingerprint, materialIds: selection.materialIds, selectedPages: selection.selectedPages,
  topicsIndex: [{ id: 'bio', title: 'Cinco conceptos: célula, tejido, órgano, sistema, organismo' }],
  globalOrderedAnalysis: concepts.map(([id, name, content]) => ({ id, name, content, kind: 'concept', importance: 90, difficulty: 'basic', topicId: 'bio', materialId: 'academic-fixture', pages: [1], sourceSpans: [{ page: 1, quote: content }] })),
  uniqueConceptsIndex: [], relations: [],
}
const cases = [
  ['Explícame la fotosíntesis como si tuviera 12 años.', 'Las plantas usan luz, agua y dióxido de carbono para fabricar azúcares y liberar oxígeno.'],
  ['Balancea Fe + O2 -> Fe2O3 y explícame.', '1. Iguala el oxígeno: usa 3 O2 y 2 Fe2O3.\n2. Iguala el hierro: 4 Fe.\nResultado: 4 Fe + 3 O2 → 2 Fe2O3.'],
  ['Resuelve 2x² - 5x - 3 = 0 paso a paso.', '1. Factoriza: (2x + 1)(x - 3) = 0.\n2. Iguala cada factor a cero: x = -1/2 o x = 3.\n3. Sustituye ambas soluciones para comprobar.'],
  ['Grafícame y = x² - 4x + 3.', 'La parábola y = (x - 2)^2 - 1 abre hacia arriba. Su vértice es (2, -1), corta el eje x en (1, 0) y (3, 0) y el eje y en (0, 3).'],
  ['Ahora dime el vértice y las intersecciones.', 'El vértice es (2, -1). Las intersecciones son (1, 0), (3, 0) y (0, 3).'],
  ['Hazme un timeline de la Revolución Francesa.', '1. 1789: toma de la Bastilla.\n2. 1792: proclamación de la República.\n3. 1799: golpe de Estado de Napoleón.'],
  ['Compara mitosis y meiosis en tabla.', '| Proceso | Resultado |\n|---|---|\n| Mitosis | Dos células con igual dotación cromosómica |\n| Meiosis | Cuatro células haploides |'],
  ['Define estos 5 conceptos del material: célula, tejido, órgano, sistema y organismo.', concepts.map(([, name, content], i) => `${i + 1}. ${name}: ${content}`).join('\n')],
  ['Explícame la segunda idea más simple.', 'Un tejido es un grupo de células que trabajan juntas.'],
  ['Usa mi material y dime qué afirma sobre tejido.', 'En tu material, un tejido es un conjunto de células con funciones relacionadas.'],
  ['Ahora agrega contexto general, pero separa qué viene del material y qué es contexto externo.', 'En tu material: un tejido reúne células con funciones relacionadas.\nComo contexto general: el tejido muscular puede contraerse.'],
  ['Hazme 3 ejercicios parecidos y luego dame las respuestas.', '1. ¿Qué es una célula? Respuesta: la unidad básica de los seres vivos.\n2. ¿Qué es un tejido? Respuesta: un conjunto de células con funciones relacionadas.\n3. ¿Qué integra un órgano? Respuesta: tejidos.'],
  ['Corrige este párrafo en español y explícame los errores: «Los alumno estudia y aprende mucho».', 'Corrección: «Los alumnos estudian y aprenden mucho».\nEl sustantivo y los verbos deben concordar en plural con «los».'],
  ['Convierte esta explicación en bullets.', '- Los alumnos: plural.\n- Estudian y aprenden: verbos en plural.'],
  ['Hazlo más corto.', 'Los alumnos estudian y aprenden mucho.'],
]

async function main() {
  const records = new Map<string, StoredChatTurn>()
  __routeDeps.chatTurnStore = {
    async read(id) { return records.get(id) ?? null },
    async compareAndSet(id, expected, revision, record) {
      if ((records.get(id)?.revision ?? null) !== expected) return false
      records.set(id, { revision, record }); return true
    },
  }
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'academic-test-user' } }),
    getAuthoritativeFreeSession: async () => ({ id: 'academic-test', userId: 'academic-test-user', processMode: 'free', sourceSelection: selection }),
    getMaterial: async () => ({ id: 'academic-fixture', nombre: 'Organización biológica (fixture explícito)' }),
    lookupStudyalMaterialEnjoyer: async () => material,
  })
  let active = 0, calls = 0
  const measurements: { promptChars: number; usage: unknown; finishReason?: string; raw: string }[] = []
  __routeDeps.generateValidatedLegacyJson = input => generateValidatedLegacyJson({ ...input, provider: async params => {
    calls++
    const prompt = params.messages.map(m => m.content).join('\n')
    const used = active >= 7 && active <= 11
      ? [...prompt.matchAll(/\[ENJOYER_TARGET (chat_target:\S+)\]/g)].map(m => m[1]) : []
    const result = live ? await alai(params) : {
      text: JSON.stringify({ answer: cases[active][1], usedTargetIds: used, usedRelationIds: [], suggestedFollowups: [], externalKnowledgeUsed: !(active >= 7 && active <= 9) }),
      provider: 'offline', model: 'fixture', completion: { finishReason: 'stop', transportComplete: true, provider: 'offline', model: 'fixture', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0 } },
    }
    measurements.push({ promptChars: prompt.length, usage: result.completion?.usage, finishReason: result.completion?.finishReason, raw: result.text })
    return result
  } })
  let previous: ChatTurnResult | undefined
  let history: { role: string; content: string }[] = []
  const report: unknown[] = []
  const failures: string[] = []
  for (active = 0; active < cases.length; active++) {
    if (onlyCase && active + 1 !== onlyCase) continue
    const message = cases[active][0]
    const before = calls
    const body = { sessionId: 'academic-test', turnId: `functional-${active}`, attempt: 1, message, history, conversationContext: previous?.conversationContext }
    const post = () => POST(new NextRequest('http://localhost/api/alai-studyal-chat', { method: 'POST', body: JSON.stringify(body) }))
    const response = await post()
    const result = await response.json()
    try {
      assert.equal(response.status, 200, JSON.stringify(result))
      assert.ok(calls - before <= 2)
      assert.ok(result.answer.length > 0)
      if ([0, 1, 2, 3, 5, 6, 12, 13, 14].includes(active)) {
        assert.equal(result.provenance.sourceMode, 'GENERAL_ONLY')
        assert.doesNotMatch(result.answer, /no encontr[eé] respaldo|no puedo responder/i)
      }
      renderToStaticMarkup(<>{renderMessageContent(result.answer)}{result.visualSpec && <VisualRenderer spec={result.visualSpec as VisualSpec} mode="teach" />}</>)
      if (active === 3) {
        assert.equal(result.visualSpec?.engine, 'graph_2d')
        assert.equal(result.visualSpec.data.expression.replace(/\s/g, ''), 'x^2-4x+3')
        assert.ok(result.visualSpec.data.points.some((p: { x: number; y: number }) => p.x === 2 && p.y === -1))
      }
      if ([4, 8, 10, 11, 13, 14].includes(active)) assert.equal(result.conversationContext.subject, previous?.conversationContext.subject)
      if (active === 7) assert.equal(result.provenance.sourceMode, 'MATERIAL_ONLY')
      if (active === 10) assert.equal(result.provenance.sourceMode, 'MIXED')
      if (active === 13) assert.equal(result.requestedResponseShape, 'bullet_list')
      const completedCalls = calls
      assert.deepEqual(await (await post()).json(), result, 'completed turn must restore exactly')
      assert.equal(calls, completedCalls, 'restore costs zero calls')
      const conflict = await POST(new NextRequest('http://localhost/api/alai-studyal-chat', { method: 'POST', body: JSON.stringify({ ...body, message: `${message} Otra petición.` }) }))
      assert.equal(conflict.status, 409)
      assert.equal(calls, completedCalls)
    } catch (error) { failures.push(`${active + 1}: ${String(error)}`) }
    report.push({ case: active + 1, message, status: response.status, calls: calls - before, result })
    if (response.status === 200) {
      previous = result
      history = [...history, { role: 'user', content: message }, { role: 'assistant', content: result.answer }].slice(-6)
    }
    console.log(JSON.stringify({ case: active + 1, status: response.status, calls: calls - before, source: result.provenance?.sourceMode, shape: result.requestedResponseShape, visual: result.visualSpec?.engine, failure: failures.find(f => f.startsWith(`${active + 1}:`)) }))
  }
  const path = `/tmp/alai-academic-${live ? 'live' : 'offline'}${onlyCase ? `-${onlyCase}` : ''}.json`
  writeFileSync(path, JSON.stringify({ live, calls, measurements, report, failures }, null, 2))
  console.log(`Report: ${path}; calls=${calls}; failures=${failures.length}`)
  assert.deepEqual(failures, [])
}
main().catch(error => { console.error(error); process.exitCode = 1 })
