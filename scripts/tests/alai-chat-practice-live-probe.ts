/** Explicit, opt-in live probe: real provider through the real route; auth/session/store are in-memory. Synthetic content only. */
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { withMaterialLanguage, detectMaterialLanguage } from '../../lib/materialLanguage'
import { PRACTICE_START_MESSAGE } from '../../lib/alai-chat/practice'
import type { ChatTurnStore, StoredChatTurn } from '../../lib/alai-chat/turnStore'
import { buildPayload, KEYS, F } from './five-material-fixture'
import { languageFixtures } from './material-language-authority-contracts'

const rows = new Map<string, StoredChatTurn>()
const store: ChatTurnStore = { async read(id) { return rows.get(id) ?? null }, async compareAndSet(id, expected, revision, record) { if ((rows.get(id)?.revision ?? null) !== expected) return false; rows.set(id, { revision, record }); return true } }
function install(payload: any, selection: any) {
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'u1' } }),
    getAuthoritativeFreeSession: async () => ({ id: 's1', userId: 'u1', processMode: 'free', sourceSelection: selection }),
    getMaterial: async (id: string) => ({ id }), lookupStudyalMaterialEnjoyer: async () => payload, chatTurnStore: store,
  })
}
let calls = 0
async function turn(body: Record<string, unknown>) {
  calls++
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-chat', { method: 'POST', body: JSON.stringify({ sessionId: 's1', attempt: 1, ...body }) }))
  return { status: response.status, data: await response.json() as any }
}
const transcript: unknown[] = []

async function main() {
  // ── Spanish chemistry ───────────────────────────────────────────────
  const es = (() => {
    const rowsEs: Array<[string, string, string]> = [
      ['c', 'Enlaces del carbono', 'El carbono tiene cuatro electrones de valencia y por eso puede formar cuatro enlaces covalentes.'],
      ['sp3', 'Hibridación sp3', 'La hibridación sp3 combina un orbital s y tres orbitales p y forma cuatro orbitales híbridos equivalentes con geometría tetraédrica y ángulos de 109.5 grados.'],
      ['sp2', 'Hibridación sp2', 'La hibridación sp2 combina un orbital s y dos orbitales p y forma geometría trigonal plana con ángulos de 120 grados.'],
      ['pi', 'Enlaces sigma y pi', 'Un doble enlace contiene un enlace sigma y un enlace pi formado por orbitales p paralelos.'],
    ]
    const selection = buildSourceSelectionSnapshot(['mat-q'], { 'mat-q': [1, 2] })
    return { selection, payload: withMaterialLanguage({ blueprint: { sourceSelectionFingerprint: selection.fingerprint, materialIds: ['mat-q'], selectedPages: selection.selectedPages,
      topicsIndex: [{ id: 't', title: 'Química orgánica', order: 0 }],
      globalOrderedAnalysis: rowsEs.map(([id, name, content], index) => ({ id, kind: 'concept', label: name, name, summary: content, content, importance: 90 - index, materialId: 'mat-q', pages: [index < 2 ? 1 : 2], topicId: 't', globalOrder: index, sourceSpans: [{ page: index < 2 ? 1 : 2, quote: content }] })), uniqueConceptsIndex: [] } }) }
  })()
  install(es.payload, es.selection)
  const start = await turn({ turnId: 'es-start', interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [], materia: 'Química', tema: 'Química orgánica' })
  assert.equal(start.status, 200, JSON.stringify(start.data)); transcript.push({ es_start: start.data.answer })
  assert.match(start.data.answer, /\?/); assert.equal(detectMaterialLanguage(start.data.answer), 'es'); assert.ok(start.data.evidence.length >= 1 && start.data.evidence.every((e: any) => e.materialId === 'mat-q'))
  assert.deepEqual(start.data.suggestedFollowups, [])
  const question = [{ role: 'assistant', content: '¿Qué tipo de hibridación presenta un carbono con geometría tetraédrica?' }]
  const context = start.data.conversationContext
  const right = await turn({ turnId: 'es-right', interactionMode: 'answer', message: 'sp³', history: question, conversationContext: context })
  transcript.push({ es_sp3: right.data.answer }); assert.equal(right.status, 200)
  assert.match(right.data.answer.slice(0, 160), /correct|exact|así es|efectivamente|muy bien/i, 'sp³ accepted as equivalent to sp3')
  assert.doesNotMatch(right.data.answer.slice(0, 120), /incorrect|no exactamente|no es correct/i)
  assert.match(right.data.answer, /\?\s*$/, 'continues with the next question')
  const angle = [{ role: 'assistant', content: '¿Cuál es aproximadamente el ángulo entre los orbitales híbridos sp3?' }]
  const wrong = await turn({ turnId: 'es-wrong', interactionMode: 'answer', message: '120 grados', history: angle, conversationContext: right.data.conversationContext })
  transcript.push({ es_120: wrong.data.answer }); assert.equal(wrong.status, 200)
  assert.match(wrong.data.answer, /109[.,]5/, 'incorrect answer is corrected with the material value')
  assert.match(wrong.data.answer.slice(0, 200), /no exactamente|incorrect|no es|no del todo|error|confund|sp2|trigonal/i)
  assert.match(wrong.data.answer, /\?\s*$/)
  const equivalent = await turn({ turnId: 'es-eq', interactionMode: 'answer', message: 'hibridación sp 3', history: question, conversationContext: wrong.data.conversationContext })
  transcript.push({ es_sp_3: equivalent.data.answer }); assert.match(equivalent.data.answer.slice(0, 160), /correct|exact|así es|efectivamente|muy bien/i)

  // ── Chinese ─────────────────────────────────────────────────────────
  const zhSelection = buildSourceSelectionSnapshot(['mat-zh'], { 'mat-zh': [1] })
  const zhPayload = withMaterialLanguage({ blueprint: { sourceSelectionFingerprint: zhSelection.fingerprint, materialIds: ['mat-zh'], selectedPages: zhSelection.selectedPages,
    topicsIndex: [{ id: 't', title: '光合作用', order: 0 }], globalOrderedAnalysis: [{ id: 'x', kind: 'concept', label: '光合作用', name: '光合作用', summary: languageFixtures.zh, content: languageFixtures.zh, importance: 90, materialId: 'mat-zh', pages: [1], topicId: 't', globalOrder: 0, sourceSpans: [{ page: 1, quote: languageFixtures.zh }] }], uniqueConceptsIndex: [] } })
  install(zhPayload, zhSelection)
  const zh = await turn({ turnId: 'zh-start', interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [] })
  transcript.push({ zh_start: zh.data.answer }); assert.equal(zh.status, 200); assert.match(zh.data.answer, /\p{Script=Han}/u); assert.match(zh.data.answer, /[?？]/)

  // ── English five materials + explicit override ──────────────────────
  const five = buildPayload(KEYS); install(five.payload, five.selection)
  const en = await turn({ turnId: 'en-start', interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [] })
  transcript.push({ en_start: en.data.answer }); assert.equal(en.status, 200)
  assert.equal(detectMaterialLanguage(en.data.answer), 'en', `EN start answer: ${en.data.answer}`); assert.match(en.data.answer, /\?/)
  assert.ok(en.data.evidence.length >= 1 && en.data.evidence.every((e: any) => e.materialId !== F.id && KEYS.some(k => e.materialId === `mat-${k}`)))
  const override = await turn({ turnId: 'en-es', interactionMode: 'answer', message: 'Explícamelo en español, no entiendo la pregunta.', history: [{ role: 'assistant', content: en.data.answer }], conversationContext: en.data.conversationContext })
  transcript.push({ en_override: override.data.answer }); assert.equal(override.status, 200)
  assert.equal(detectMaterialLanguage(override.data.answer), 'es', 'explicit current-turn override answers in Spanish')
  assert.equal((five.payload as any).blueprint.materialLanguage, 'en', 'canonical material language is untouched')
  const afterOverride = await turn({ turnId: 'en-next', interactionMode: 'answer', message: 'photosynthesis', history: [{ role: 'assistant', content: override.data.answer }], conversationContext: override.data.conversationContext })
  transcript.push({ en_next: afterOverride.data.answer }); assert.equal(afterOverride.status, 200)
  console.log(JSON.stringify({ providerTurns: calls, transcript }, null, 2))
  console.log(`LIVE PASS alai-chat-practice: ${calls} route turns (1 provider call each); es start/correct/equivalent/incorrect, zh start, en five-material start + response-scoped override`)
}
main().catch(error => { console.error(error); process.exit(1) })
