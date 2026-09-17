import assert from 'node:assert/strict'
import { chatRequestHash, chatTurnIdentity, runDurableChatTurn, WorkerChatTurnStore, type ChatTurnResult, type StoredChatTurn, type ChatTurnStore } from '../../lib/alai-chat/turnStore'

async function main() {
  let saved: StoredChatTurn | null = null, calls = 0, readFails = false, loseCommitResponse = false
  const store: ChatTurnStore = {
    async read() { if (readFails) throw new Error('storage unavailable'); return saved },
    async compareAndSet(_id, expectedRevision, revision, record) {
      if ((saved?.revision ?? null) !== expectedRevision) return false
      saved = { revision, record }
      if (loseCommitResponse && record.status === 'completed') throw new Error('response lost after commit')
      return true
    },
  }
  const result: ChatTurnResult = {
    success: true, schema: 'alai-chat', version: 1, answer: 'Respuesta durable.',
    requestedResponseShape: 'prose', sourcePolicy: 'GENERAL_ONLY',
    provenance: { sourceMode: 'GENERAL_ONLY', materialRetrievalOutcome: 'not_checked', externalKnowledgeUsed: true, materialEvidenceUsed: false },
    evidence: [], usedTargetIds: [], usedRelationIds: [], suggestedFollowups: [], fulfillment: 'answered',
    conversationContext: { version: 1, subject: 'tema', operation: 'prose', sourcePolicy: 'GENERAL_ONLY', usedTargetIds: [], usedRelationIds: [] },
  }
  const params = { store, id: chatTurnIdentity('u', 's', 'fp', 't'), requestHash: chatRequestHash('pregunta'), attempt: 1, generate: async () => { calls++; return result } }
  readFails = true
  await assert.rejects(runDurableChatTurn(params), /storage unavailable/)
  assert.equal(calls, 0)
  readFails = false; loseCommitResponse = true
  assert.deepEqual(await runDurableChatTurn(params), result)
  assert.deepEqual(await runDurableChatTurn(params), result)
  assert.equal(calls, 1, 'lost HTTP response and retry restore completed result')
  await assert.rejects(runDurableChatTurn({ ...params, requestHash: chatRequestHash('different') }), /CONFLICT/)
  assert.notEqual(chatRequestHash('same', { subject: 'A' }), chatRequestHash('same', { subject: 'B' }))
  saved = { revision: 'pending', record: { version: 1, requestHash: params.requestHash, attempt: 1, status: 'pending' } }
  await assert.rejects(runDurableChatTurn({ ...params, attempt: 2 }), /IN_PROGRESS/)
  assert.equal(calls, 1)
  saved = null; loseCommitResponse = false
  await assert.rejects(runDurableChatTurn({ ...params, generate: async () => { throw new Error('failed generation') } }), /failed generation/)
  await assert.rejects(runDurableChatTurn(params), /PREVIOUS_ATTEMPT_FAILED/)
  assert.deepEqual(await runDurableChatTurn({ ...params, attempt: 2 }), result)
  assert.equal(calls, 2)
  const brokenRead = new WorkerChatTurnStore('https://fixture.test', async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  await assert.rejects(brokenRead.read(params.id), /STORAGE_MALFORMED/)
  console.log('alai-chat-durability-contracts: ALL PASS')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
