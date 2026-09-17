import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { generateValidatedLegacyJson } from '../../lib/ai/legacyRouteGeneration'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { resolveConversation } from '../../lib/alai-chat/conversation'
import type { ChatTurnResult, StoredChatTurn } from '../../lib/alai-chat/turnStore'

const selection = buildSourceSelectionSnapshot(['timeline-fixture'], { 'timeline-fixture': [1, 2] })
const records = new Map<string, StoredChatTurn>()
const firstMessage = 'dime por qué Niels Bohr fue importante'
const datedFacts = ['Bohr presentó su modelo atómico en 1913.', 'Bohr recibió el Premio Nobel de Física en 1922.']
const undatedFacts = ['Bohr propuso un modelo atómico con niveles de energía.', 'Bohr contribuyó al estudio de la estructura del átomo.']

__routeDeps.chatTurnStore = {
  async read(id) { return records.get(id) ?? null },
  async compareAndSet(id, expected, revision, record) {
    if ((records.get(id)?.revision ?? null) !== expected) return false
    records.set(id, { revision, record })
    return true
  },
}
Object.assign(__routeDeps, {
  getServerSession: async () => ({ user: { id: 'timeline-user' } }),
  getAuthoritativeFreeSession: async () => ({ id: 'timeline-session', userId: 'timeline-user', processMode: 'free', sourceSelection: selection }),
  getMaterial: async () => ({ id: 'timeline-fixture', nombre: 'Historia de la ciencia' }),
})

async function runScenario(name: string, followup: string, hasDates: boolean, strict = false) {
  const facts = hasDates ? datedFacts : undatedFacts
  __routeDeps.lookupStudyalMaterialEnjoyer = async () => ({
    sourceSelectionFingerprint: selection.fingerprint,
    materialIds: selection.materialIds,
    selectedPages: selection.selectedPages,
    topicsIndex: [{ id: 'science', title: 'Historia de la ciencia' }],
    globalOrderedAnalysis: facts.map((content, index) => ({
      id: `event-${index}`, name: `Contribución de Bohr ${index + 1}`, content,
      kind: 'concept', importance: 90, topicId: 'science', materialId: 'timeline-fixture',
      pages: [index + 1], sourceSpans: [{ page: index + 1, quote: content }],
    })),
    uniqueConceptsIndex: [], relations: [],
  })

  let providerCalls = 0
  let authorizedContents: string[] = []
  // Inject only the transport. Actual routing, retrieval, JSON parsing, validation,
  // provenance, context serialization and persistence remain production code.
  __routeDeps.generateValidatedLegacyJson = input => generateValidatedLegacyJson({
    ...input,
    provider: async params => {
      providerCalls++
      const prompt = params.messages.map(message => message.content).join('\n')
      const blocks = [...prompt.matchAll(/\[ENJOYER_TARGET ([^\]]+)\][^\n]*\nLABEL: [^\n]*\nCONTENIDO: ([^\n]+)/g)]
      authorizedContents = blocks.map(block => block[2])
      const isTimeline = prompt.includes('Formato solicitado: lista cronológica.')
      // The offline answer depends on the actual retrieved evidence, never on the
      // fixture or assistant history. Missing retrieval must make this test fail.
      const dated = authorizedContents.filter(content => /\b\d{4}\b/.test(content))
      const answer = isTimeline
        ? dated.length
          ? dated.map((content, index) => `${index + 1}. ${content.match(/\b\d{4}\b/)![0]} — ${content}`).join('\n')
          : 'No encontré fechas explícitas en la evidencia recuperada.\n1. Sin fecha documentada — El modelo atómico describe niveles de energía.'
        : authorizedContents.join(' ') || 'La pregunta requiere contexto adicional.'
      return {
        text: JSON.stringify({ answer, usedTargetIds: blocks.map(block => block[1]), usedRelationIds: [], suggestedFollowups: [], externalKnowledgeUsed: false }),
        provider: 'offline', model: 'evidence-sensitive-fixture',
        completion: {
          finishReason: 'stop', transportComplete: true, provider: 'offline', model: 'evidence-sensitive-fixture',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, reasoningTokens: 0 },
        },
      }
    },
  })

  const post = async (turn: number, message: string, previous?: ChatTurnResult) => {
    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST', body: JSON.stringify({
        sessionId: 'timeline-session', turnId: `${name}-${turn}`, attempt: 1, message,
        conversationContext: previous?.conversationContext,
        history: previous ? [
          { role: 'user', content: firstMessage },
          // An unsupported date in old prose must never become evidence.
          { role: 'assistant', content: hasDates ? previous.answer : `${previous.answer} Fecha mencionada antes: 1913.` },
        ] : [],
      }),
    }))
    assert.equal(response.status, 200)
    return await response.json() as ChatTurnResult
  }

  const first = await post(1, strict ? `Solo usa mi material: ${firstMessage}` : firstMessage)
  assert.equal(first.usedTargetIds.length, 2)
  assert.equal(providerCalls, 1)
  const second = await post(2, followup, first)
  assert.equal(second.conversationContext?.operation, 'timeline')
  assert.equal(second.conversationContext?.subject, first.conversationContext?.subject, 'Timeline must retain the previous subject')
  assert.equal(second.conversationContext?.sourcePolicy, first.conversationContext?.sourcePolicy)
  assert.deepEqual(authorizedContents.sort(), [...facts].sort(), 'Only currently authorized dated/undated facts reach the provider')
  assert.deepEqual(second.usedTargetIds, first.usedTargetIds)
  assert.equal(second.provenance.sourceMode, 'MATERIAL_ONLY')
  assert.equal(second.provenance.externalKnowledgeUsed, false)
  assert.equal(second.provenance.materialEvidenceUsed, true)
  assert(second.evidence.every(e => e.materialId === 'timeline-fixture' && e.pages.every(page => page <= 2)))
  if (hasDates) {
    for (const date of ['1913', '1922']) assert(second.answer.includes(date), `Missing authorized date ${date}`)
    assert(!/no (?:encontr|se proporcion|hay)/i.test(second.answer), 'Must not claim available dates are absent')
  } else {
    assert.match(second.answer, /No encontré fechas explícitas en la evidencia recuperada/)
    assert(!/\b\d{4}\b/.test(second.answer), 'Prior assistant prose does not authorize a date')
  }
  assert.equal(providerCalls, 2, 'Exactly one provider call per turn; no repair or extra planner')
  console.log(`PASS ${name}`)
}

async function main() {
  await runScenario('dated-data', 'hazme un timeline a base de los datos', true)
  await runScenario('dated-typo', 'hazme un timeline a base de los datish', true)
  await runScenario('strict-chronology', 'hazme una cronología con estos datos', true, true)
  await runScenario('no-authorized-dates', 'hazme un timeline a base de los datos', false, true)

  const previous = resolveConversation('Solo usa mi material: explica la expedición científica', null).context
  previous.usedTargetIds = ['chat_target:expedition']
  for (const message of ['hazme un timeline', 'ahora una secuencia histórica con estos datos', 'ordena las fechas del contexto actual']) {
    const result = resolveConversation(message, previous)
    assert.equal(result.intent.shape, 'timeline')
    assert.equal(result.intent.followup, true)
    assert.equal(result.context.subject, previous.subject)
  }
  for (const message of [
    'Hazme un timeline de la Revolución Francesa',
    'Hazme una cronología de la computación',
    'La Revolución Francesa en un timeline',
    'Hazme un timeline a base de los datos de la Revolución Francesa',
  ]) {
    const result = resolveConversation(message, previous)
    assert.equal(result.intent.followup, false, 'An explicit new timeline topic must not inherit the old subject')
    assert.deepEqual(result.context.usedTargetIds, [])
  }
  console.log('ALAI timeline continuity contracts PASS: authorized dates, typo, strict policy, no dates, new topic, 1 call/turn')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
