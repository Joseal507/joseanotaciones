import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { generateValidatedLegacyJson } from '../../lib/ai/legacyRouteGeneration'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { renderMessageContent } from '../../components/materias/ALAIStudyALChat'
import { chatUserMessage, CHAT_USER_MESSAGES } from '../../lib/alai-chat/errors'
import { beginAlaiTurn, failAlaiTurn, initialAlaiState } from '../../lib/freeAlaiState'
import type { StoredChatTurn } from '../../lib/alai-chat/turnStore'

Object.assign(globalThis, { React })
const selection = buildSourceSelectionSnapshot(['bohr-fixture', 'other-fixture'], { 'bohr-fixture': [2, 4], 'other-fixture': [4] })
const material = {
  sourceSelectionFingerprint: selection.fingerprint, materialIds: selection.materialIds, selectedPages: selection.selectedPages,
  topicsIndex: [{ id: 'atomic', title: 'Modelo atómico' }],
  globalOrderedAnalysis: [
    { id: 'bohr', name: 'Modelo de Bohr', content: 'Bohr propuso niveles de energía discretos para los electrones.', importance: 95, materialId: 'bohr-fixture', pages: [2], sourceSpans: [{ page: 2, quote: 'Bohr propuso niveles de energía discretos para los electrones.' }] },
    { id: 'other', name: 'Comparación de modelos', content: 'Los modelos atómicos describen la estructura del átomo.', importance: 60, materialId: 'other-fixture', pages: [4], sourceSpans: [{ page: 4, quote: 'Los modelos atómicos describen la estructura del átomo.' }] },
  ], uniqueConceptsIndex: [], relations: [],
}
const good = { answer: 'Bohr propuso niveles de energía discretos para los electrones.', usedTargetIds: ['chat_target:bohr'], usedRelationIds: [], externalKnowledgeUsed: false, suggestedFollowups: [] }
let responses: (string | Error)[] = [], calls = 0, sequence = 0
let records = new Map<string, StoredChatTurn>()
const outcomes: Record<string, unknown>[] = []
const originals = { ...__routeDeps }
const info = console.info, log = console.log, warn = console.warn, error = console.error
console.info = (tag, value) => { if (tag === '[alai-chat-outcome]' && value && typeof value === 'object') outcomes.push(value) }
console.log = console.warn = console.error = () => {}

function reset(next: (string | Error)[]) {
  calls = 0; responses = next; records = new Map(); outcomes.length = 0
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'reliability-user' } }),
    getAuthoritativeFreeSession: async () => ({ id: 'reliability-session', userId: 'reliability-user', processMode: 'free', sourceSelection: selection }),
    getMaterial: async () => ({ id: 'bohr-fixture', nombre: 'Bohr (fixture)' }),
    lookupStudyalMaterialEnjoyer: async () => material,
  })
  __routeDeps.chatTurnStore = {
    async read(id) { return records.get(id) ?? null },
    async compareAndSet(id, expected, revision, record) {
      if ((records.get(id)?.revision ?? null) !== expected) return false
      records.set(id, JSON.parse(JSON.stringify({ revision, record }))); return true
    },
  }
  __routeDeps.generateValidatedLegacyJson = input => generateValidatedLegacyJson({ ...input, provider: async params => {
    assert.equal(params.transportRetries, 0); assert.equal(params.maxProviderAttempts, 1)
    const response = responses[Math.min(calls++, responses.length - 1)]
    if (response instanceof Error) throw response
    return { text: response, provider: 'offline', model: 'fault-injection', completion: {
      provider: 'offline', model: 'fault-injection', finishReason: 'stop', transportComplete: true,
      usage: { promptTokens: 100, completionTokens: 60, totalTokens: 160, reasoningTokens: 0 },
    } }
  } })
}
async function post(message: string, extra: Record<string, unknown> = {}) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'reliability-session', turnId: `fault-${sequence++}`, attempt: 1, message, ...extra }) }))
  return { status: response.status, body: await response.json() }
}
function safeFailure(body: Record<string, unknown>) {
  const message = chatUserMessage(body)
  assert.ok(Object.values(CHAT_USER_MESSAGES).some(value => value === message))
  assert.doesNotMatch(String(body.userMessage), /GENERATION_|STRUCTURAL_|provider_page_claim|material_claim_without_evidence|CHAT_|Error:|\bstack\b/)
  assert.doesNotMatch(String(body.detail || ''), /GENERATION_|STRUCTURAL_|CHAT_|Error:/)
}

async function main() {
  reset([JSON.stringify({ ...good, answer: `La página 99 es imprescindible. ${good.answer}`, suggestedFollowups: ['CHAT_RECOVERABLE_FAILURE'], provenance: { mode: 'FORGED' } })])
  const page = await post('de todas las paginas cual es una que no me puedo saltar', { turnId: 'page-turn' })
  assert.equal(page.status, 200); assert.equal(calls, 1); assert.doesNotMatch(page.body.answer, /99|página 99/)
  assert.match(page.body.answer, /niveles de energía/)
  assert.deepEqual(page.body.evidence, [{ targetId: 'chat_target:bohr', materialId: 'bohr-fixture', pages: [2] }])
  assert.deepEqual(page.body.suggestedFollowups, [])
  assert.ok(outcomes.some(o => o.finalOutcome === 'deterministic_salvage_success'))
  const restored = await post('de todas las paginas cual es una que no me puedo saltar', { turnId: 'page-turn', attempt: 2 })
  assert.deepEqual(restored.body, page.body); assert.equal(calls, 1)

  reset([JSON.stringify({ ...good, answer: 'La página 99 es fundamental.\n| Tema | Dato |\n| Bohr | niveles |' })])
  const repeated = await post('Compara el modelo de Bohr en tabla')
  assert.equal(repeated.status, 200); assert.equal(calls, 2)
  assert.equal(repeated.body.fulfillment, 'partial'); assert.doesNotMatch(repeated.body.answer, /99|\|/)
  assert.ok(outcomes.some(o => o.finalOutcome === 'safe_partial_success' && o.attemptCount === 2))

  reset([JSON.stringify({ ...good, answer: 'Según tu PDF, los quarks son plantas.', usedTargetIds: ['chat_target:forged'] })])
  const forged = await post('Explica los quarks')
  assert.equal(forged.body.success, false); safeFailure(forged.body); assert.ok(calls <= 2)

  reset(['{"answer":"Bohr propuso niveles de energía discretos.","usedTargetIds":["chat_target:bohr"],"externalKnowledgeUsed":false,"suggestedFollowups":[BROKEN]}'])
  const malformed = await post('Explica el modelo de Bohr')
  assert.equal(malformed.status, 200); assert.equal(calls, 1); assert.doesNotMatch(malformed.body.answer, /BROKEN|\{"answer/)

  for (const fault of [new Error('CHAT_TRANSPORT_TIMEOUT'), new Error('OPENROUTER provider 503: secret body'), new Error('unknown secret stack')]) {
    reset([fault]); const failed = await post('Explica la fotosíntesis')
    assert.equal(failed.body.success, false); safeFailure(failed.body); assert.ok(calls <= 2)
    if (fault.message.includes('TIMEOUT')) assert.equal(chatUserMessage(failed.body), CHAT_USER_MESSAGES.timeout)
  }

  reset([JSON.stringify(good)])
  __routeDeps.chatTurnStore.read = async () => { throw new Error('WORKER DB secret') }
  const storage = await post('Explica el modelo de Bohr')
  assert.equal(storage.status, 503); assert.equal(calls, 0); safeFailure(storage.body)
  assert.equal(chatUserMessage(storage.body), CHAT_USER_MESSAGES.storage)

  reset([JSON.stringify(good)])
  const cas = __routeDeps.chatTurnStore.compareAndSet
  __routeDeps.chatTurnStore.compareAndSet = async (id, expected, revision, record) => {
    if (record.status === 'completed') throw new Error('WORKER COMMIT unavailable')
    return cas(id, expected, revision, record)
  }
  const commit = await post('Explica el modelo de Bohr', { turnId: 'commit' })
  assert.equal(commit.status, 503); safeFailure(commit.body); assert.equal(calls, 1)
  const pending = await post('Explica el modelo de Bohr', { turnId: 'commit', attempt: 2 })
  assert.equal(pending.status, 409); assert.equal(calls, 1); safeFailure(pending.body)

  reset([JSON.stringify(good)])
  const strict = await post('Solo usa mi material y explica la fotosíntesis')
  assert.equal(strict.status, 200); assert.equal(calls, 0)
  assert.equal(strict.body.provenance.externalKnowledgeUsed, false); assert.match(strict.body.answer, /No encontré respaldo/)

  reset([JSON.stringify({ ...good, answer: 'La fotosíntesis transforma energía luminosa en energía química.', usedTargetIds: [], externalKnowledgeUsed: true })])
  const general = await post('Explica la fotosíntesis')
  assert.equal(general.status, 200); assert.equal(general.body.provenance.sourceMode, 'GENERAL_ONLY'); assert.equal(calls, 1)

  reset([JSON.stringify({ ...good, answer: `${good.answer}\nComo contexto general: la mecánica cuántica desarrolló una descripción más amplia.`, externalKnowledgeUsed: true })])
  const mixed = await post('Explica Bohr y agrega contexto general')
  assert.equal(mixed.status, 200); assert.equal(mixed.body.provenance.sourceMode, 'MIXED'); assert.equal(calls, 1)

  reset([JSON.stringify(good)])
  __routeDeps.getAuthoritativeFreeSession = async () => { throw new Error('unknown private infrastructure stack') }
  const unknown = await post('Explica Bohr'); safeFailure(unknown.body); assert.equal(calls, 0)

  for (const raw of ['GENERATION_BUDGET_EXHAUSTED:STRUCTURAL_VALIDATION_FAILED:provider_page_claim_forbidden_use_evidence', 'CHAT_RECOVERABLE_FAILURE', 'Error: private stack', '{"error":"material_claim_without_evidence"}']) {
    const state = beginAlaiTurn(initialAlaiState(), { turnId: 'ui', userMessageId: 'ui:user', content: 'Hola', timestamp: 1 })
    const failed = failAlaiTurn(state, 'ui', 1, raw)
    assert.equal(failed.currentTurn?.error, chatUserMessage(raw))
    const html = renderToStaticMarkup(<>{renderMessageContent(raw)}</>)
    assert.doesNotMatch(html, /GENERATION_BUDGET_EXHAUSTED|STRUCTURAL_VALIDATION_FAILED|provider_page_claim|material_claim_without_evidence|CHAT_RECOVERABLE_FAILURE|Error:|\bstack\b/)
  }
  log('ALAI reliability: 12 fault classes + restore/pending/commit + real renderer PASS; page salvage: 1 call instead of 2.')
}
main().catch(e => { error(e); process.exitCode = 1 }).finally(() => { Object.assign(__routeDeps, originals); console.info = info; console.log = log; console.warn = warn; console.error = error })
