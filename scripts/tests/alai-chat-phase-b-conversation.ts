import assert from 'node:assert/strict'
import { resolveConversation, boundedHistory } from '../../lib/alai-chat/conversation'
import { detectChatIntent } from '../../lib/alai-chat/intent'
const first = resolveConversation('Solo usa mi material: dame cinco componentes de la célula', null).context
first.usedTargetIds = ['chat_target:cell']
for (const text of ['falta uno', 'el segundo', 'hazlo más corto', 'continúa', '¿por qué?', 'ponlo en tabla', 'ahora compáralo con una bacteria']) {
  const next = resolveConversation(text, first)
  assert.equal(next.context.subject, first.subject, text)
  assert.equal(next.context.sourcePolicy, 'MATERIAL_ONLY', text)
  assert.deepEqual(next.context.usedTargetIds, first.usedTargetIds)
  assert.ok(next.retrievalQuery.includes('célula'))
}
assert.equal(first.requestedCount, 5)
assert.equal(detectChatIntent('resuelve el segundo').ordinal, 2)
const general = resolveConversation('Usa solo conocimiento general: explica la revolución francesa', first).context
assert.equal(general.sourcePolicy, 'GENERAL_ONLY')
assert.deepEqual(general.usedTargetIds, [])
assert.match(resolveConversation('¿por qué?', general).context.subject, /revolución francesa/)
assert.equal(resolveConversation('no uses conocimiento general', general).context.sourcePolicy, 'MATERIAL_ONLY')
assert.equal(resolveConversation('usa conocimiento general también', first).context.sourcePolicy, 'MIXED')
assert.equal(boundedHistory(Array.from({ length: 50 }, () => ({ role: 'assistant', content: 'x'.repeat(5000) }))).map(x => x.content).join('').length, 7200)
assert.ok(resolveConversation('x'.repeat(5000), first).retrievalQuery.length <= 768)
console.log('alai-chat-phase-b-conversation: PASS')
