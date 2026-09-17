import assert from 'node:assert/strict'
import { generateValidatedLegacyJson } from '../../lib/ai/legacyRouteGeneration'
import type { ALAIParams, ALAIResult } from '../../lib/alai'
import { normalizeChatCandidate, validateChatCandidate } from '../../lib/alai-chat/validation'
import { detectChatIntent } from '../../lib/alai-chat/intent'

const response = (finishReason: string, answer = 'Respuesta completa.') : ALAIResult => ({
  text: JSON.stringify({ answer, usedTargetIds: [], usedRelationIds: [], externalKnowledgeUsed: true }),
  provider: 'openrouter', model: 'fixture', completion: {
    finishReason, transportComplete: finishReason === 'stop', provider: 'openrouter', model: 'fixture',
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30, reasoningTokens: 0 },
  },
})
async function run(sequence: ALAIResult[]) {
  const requests: ALAIParams[] = []
  const pending = generateValidatedLegacyJson({
    taskType: 'explanation', prompt: 'Explica brevemente', forceJsonTransport: true, chatTransport: {},
    provider: async request => { requests.push(request); return sequence[Math.min(requests.length - 1, sequence.length - 1)] },
    normalize: normalizeChatCandidate,
    validate: (value, completion) => validateChatCandidate(normalizeChatCandidate(value), {
      intent: detectChatIntent('explica'), sourcePolicy: 'GENERAL_ONLY', transportComplete: completion?.transportComplete, requireSourceReport: true,
    }),
  })
  return { pending, requests }
}
async function main() {
  const normal = await run([response('stop')])
  assert.equal((await normal.pending).answer, 'Respuesta completa.')
  assert.equal(normal.requests.length, 1)
  assert.equal(normal.requests[0].transportRetries, 0)
  assert.equal(normal.requests[0].timeoutMs, 40000)
  assert.equal(normal.requests[0].forceJsonTransport, true)
  assert.equal(normal.requests[0].responseJsonSchema?.name, 'alai_chat_answer')
  assert.equal(normal.requests[0].responseJsonSchema?.strict, true)
  const repaired = await run([response('length', 'PARTIAL'), response('stop', 'Reparada completa.')])
  assert.equal((await repaired.pending).answer, 'Reparada completa.')
  assert.equal(repaired.requests.length, 2)
  assert.ok(repaired.requests.every(r => r.transportRetries === 0))
  const failure = await run([response('length', 'PARTIAL')])
  await assert.rejects(failure.pending, /GENERATION_BUDGET_EXHAUSTED/)
  assert.equal(failure.requests.length, 2)
  const malformed = response('stop'); malformed.text = '{"answer":"truncated'
  const recovered = await run([malformed, response('stop')])
  assert.equal((await recovered.pending).answer, 'Respuesta completa.')
  assert.equal(recovered.requests.length, 2)
  let calls = 0, aborted = false
  const start = Date.now()
  await assert.rejects(generateValidatedLegacyJson({
    taskType: 'explanation', chatTransport: { totalTimeoutMs: 25, attemptTimeoutMs: 25 },
    provider: async request => { calls++; request.signal?.addEventListener('abort', () => { aborted = true }); return new Promise<ALAIResult>(() => {}) },
    normalize: normalizeChatCandidate, validate: () => ({ valid: true, errors: [] }),
  }), /GENERATION_BUDGET_EXHAUSTED/)
  assert.equal(calls, 1)
  assert.ok(aborted)
  assert.ok(Date.now() - start < 1000)
  console.log('alai-chat-phase-b-transport: PASS')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
