import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { detectChatIntent, detectStrictMaterialOnly, detectSourcePolicy } from '../../lib/alai-chat/intent'
import { resolveConversation } from '../../lib/alai-chat/conversation'
import { retrieveForChat, buildChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'
import type { ChatTurnResult, StoredChatTurn } from '../../lib/alai-chat/turnStore'

const selection = buildSourceSelectionSnapshot(['sociology-fixture'], { 'sociology-fixture': [1, 2, 3] })
const concepts = [
  ['hecho-social', 'Hecho social', 'Los hechos sociales son formas de actuar, pensar y sentir exteriores al individuo que ejercen coacción.'],
  ['solidaridad-organica', 'Solidaridad orgánica', 'La solidaridad orgánica se basa en la diferenciación e interdependencia de funciones.'],
  ['anomia', 'Anomia', 'La anomia es la falta o debilitamiento de normas sociales reguladoras de la conducta.'],
]

const material = {
  sourceSelectionFingerprint: selection.fingerprint,
  materialIds: selection.materialIds,
  selectedPages: selection.selectedPages,
  topicsIndex: [{ id: 'soc', title: 'Sociología clásica de Durkheim' }],
  globalOrderedAnalysis: concepts.map(([id, name, content], i) => ({
    id, name, content, kind: 'concept', importance: 90, difficulty: 'basic',
    topicId: 'soc', materialId: 'sociology-fixture', pages: [i + 1],
    sourceSpans: [{ page: i + 1, quote: content }],
  })),
  uniqueConceptsIndex: [],
  relations: [],
}

async function main() {
  console.log('\n── ALAI Chat Philosophy Contracts ──\n')

  // 1. Intent: detectStrictMaterialOnly precision
  {
    assert.equal(detectStrictMaterialOnly('Solo usa mi material: define hecho social'), true)
    assert.equal(detectStrictMaterialOnly('Usa solo el material'), true)
    assert.equal(detectStrictMaterialOnly('usa solo mi pdf'), true)
    assert.equal(detectStrictMaterialOnly('no uses informacion externa'), true)
    assert.equal(detectStrictMaterialOnly('sin conocimiento general'), true)
    assert.equal(detectStrictMaterialOnly('respóndeme únicamente según el PDF'), true)
    assert.equal(detectStrictMaterialOnly('exclusivamente segun el documento'), true)
    assert.equal(detectStrictMaterialOnly('material only'), true)

    // Non-strict expressions must NOT trigger strict exclusivity:
    assert.equal(detectStrictMaterialOnly('Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.'), false)
    assert.equal(detectStrictMaterialOnly('¿Qué es un hecho social según el material?'), false)
    assert.equal(detectStrictMaterialOnly('Usa mi material y dime qué afirma sobre anomia'), false)
    assert.equal(detectStrictMaterialOnly('Explícame la fotosíntesis'), false)
    console.log('  ✅ 1. detectStrictMaterialOnly identifies only genuine strict exclusivity')
  }

  // 2. Intent: followup classification avoids false positives on standalone prompts
  {
    const mathIntent = detectChatIntent('Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.')
    assert.equal(mathIntent.followup, false, 'Standalone math prompt must not be flagged as followup')
    assert.equal(mathIntent.shape, 'numbered_steps')

    const whyShort = detectChatIntent('¿Por qué?')
    assert.equal(whyShort.followup, true, 'Short ¿Por qué? must be a followup')

    const andWhy = detectChatIntent('¿Y por qué?')
    assert.equal(andWhy.followup, true, '¿Y por qué? must be a followup')

    const explainWhyLong = detectChatIntent('Explica por qué la división del trabajo genera solidaridad orgánica')
    assert.equal(explainWhyLong.followup, false, 'Long standalone prompt with por qué must not be a followup')
    console.log('  ✅ 2. followup detection correctly separates standalone questions from conversational followups')
  }

  // 3. Retrieval: token optimization (out-of-domain query against open material yields 0 targets)
  {
    const context = buildChatEnjoyerContext(material, selection)
    const result = retrieveForChat({
      query: 'Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.',
      context,
      sourcePolicy: 'MIXED',
    })
    assert.equal(result.targets.length, 0, 'Math quadratic equation must match 0 targets in sociology material')
    assert.equal(result.materialRetrievalOutcome, 'no_relevant_target')
    console.log('  ✅ 3. Out-of-domain query retrieves 0 targets, preventing token bloating')
  }

  // 4. Conversation policy isolation: Turn 1 strict -> Turn 2 fresh math
  {
    const turn1 = resolveConversation('Solo usa mi material: define anomia', null)
    assert.equal(turn1.context.sourcePolicy, 'MATERIAL_ONLY')
    turn1.context.usedTargetIds = ['chat_target:anomia']

    // Turn 2 is a new topic:
    const turn2 = resolveConversation('Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.', turn1.context)
    assert.equal(turn2.intent.followup, false)
    assert.equal(turn2.context.sourcePolicy, 'MIXED', 'Turn 2 must reset to MIXED, not stay trapped in MATERIAL_ONLY')
    assert.deepEqual(turn2.context.usedTargetIds, [], 'Turn 2 must not inherit previous targets')
    assert.equal(turn2.retrievalQuery, 'Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.')

    // But an actual followup DOES inherit:
    const followupTurn = resolveConversation('¿Y por qué?', turn1.context)
    assert.equal(followupTurn.intent.followup, true)
    assert.equal(followupTurn.context.sourcePolicy, 'MATERIAL_ONLY', 'Genuine followup must inherit MATERIAL_ONLY')
    assert.deepEqual(followupTurn.context.usedTargetIds, ['chat_target:anomia'])
    console.log('  ✅ 4. Policy isolation: new topics reset to MIXED, true followups inherit policy')
  }

  // Setup route mock for end-to-end route tests
  const records = new Map<string, StoredChatTurn>()
  __routeDeps.chatTurnStore = {
    async read(id) { return records.get(id) ?? null },
    async compareAndSet(id, expected, revision, record) {
      if ((records.get(id)?.revision ?? null) !== expected) return false
      records.set(id, { revision, record }); return true
    },
  }
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'philosophy-user' } }),
    getAuthoritativeFreeSession: async () => ({ id: 'philosophy-session', userId: 'philosophy-user', processMode: 'free', sourceSelection: selection }),
    getMaterial: async () => ({ id: 'sociology-fixture', nombre: 'Sociología de Durkheim' }),
    lookupStudyalMaterialEnjoyer: async () => material,
  })

  let providerCalls = 0
  let lastPrompt = ''
  __routeDeps.generateValidatedLegacyJson = input => {
    providerCalls++
    lastPrompt = (input as any).prompt
    return Promise.resolve({
      answer: '1. Restamos 6: 2x² - 8x = -6.\n2. Dividimos entre 2: x² - 4x = -3.\n3. Factorizamos: (x - 1)(x - 3) = 0, por lo que x = 1 o x = 3.',
      usedTargetIds: [],
      usedRelationIds: [],
      suggestedFollowups: ['¿Cómo comprobar las soluciones?', '¿Cómo graficar la parábola?'],
      externalKnowledgeUsed: true,
    })
  }

  // 5. End-to-end: Math query with sociology material open -> GENERAL_ONLY, empty material chunks in prompt
  {
    providerCalls = 0
    lastPrompt = ''
    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'philosophy-session',
        turnId: 'philo-turn-1',
        attempt: 1,
        message: 'Resuelve 2x² - 8x + 6 = 0 paso a paso y explícame por qué haces cada paso.',
      }),
    })
    const res = await POST(req)
    const data: ChatTurnResult = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.success, true)
    assert.equal(data.provenance.sourceMode, 'GENERAL_ONLY')
    assert.equal(data.provenance.externalKnowledgeUsed, true)
    assert.deepEqual(data.usedTargetIds, [])
    assert.deepEqual(data.evidence, [])
    assert.equal(data.fulfillment, 'answered')
    assert.equal(providerCalls, 1)
    // Verify prompt does NOT contain any sociology targets:
    assert.ok(!lastPrompt.includes('hecho-social'), 'Prompt must NOT contain sociology targets')
    assert.ok(!lastPrompt.includes('Durkheim'), 'Prompt must NOT contain Durkheim')
    assert.ok(lastPrompt.includes('(No se recuperó evidencia relevante. Respeta la política de fuentes.)'))
    console.log('  ✅ 5. Math query answered via GENERAL_ONLY with ZERO material chunks in prompt')
  }

  // 6. Strict exclusivity exception: "Solo usa mi material" on unmentioned topic -> honest refusal with 0 provider calls
  {
    providerCalls = 0
    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'philosophy-session',
        turnId: 'philo-turn-2',
        attempt: 1,
        message: 'Solo usa mi material: resuelve 2x² - 8x + 6 = 0 paso a paso.',
      }),
    })
    const res = await POST(req)
    const data: ChatTurnResult = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.fulfillment, 'insufficient_material')
    assert.match(data.answer, /No encontré respaldo para esa petición/i)
    assert.equal(providerCalls, 0, 'Strict exclusivity refusal must make 0 provider calls')
    console.log('  ✅ 6. Strict exclusivity on missing topic honestly reports lack of coverage with 0 provider calls')
  }

  // 7. Material inspection exception: "¿Aparece la palabra fotosíntesis en el material?" -> honest inspection report with 0 provider calls
  {
    providerCalls = 0
    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'philosophy-session',
        turnId: 'philo-turn-3',
        attempt: 1,
        message: '¿Aparece la fotosíntesis en el material?',
      }),
    })
    const res = await POST(req)
    const data: ChatTurnResult = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.fulfillment, 'insufficient_material')
    assert.match(data.answer, /No encontré respaldo para esa petición/i)
    assert.equal(providerCalls, 0, 'Material inspection refusal must make 0 provider calls')
    console.log('  ✅ 7. Material inspection on missing topic honestly reports lack of coverage with 0 provider calls')
  }

  // 8. Relevant query with material open -> Uses targets and cites evidence
  {
    __routeDeps.generateValidatedLegacyJson = input => {
      providerCalls++
      return Promise.resolve({
        answer: 'Un hecho social es una forma de actuar, pensar y sentir exterior al individuo que ejerce una coacción sobre él.',
        usedTargetIds: ['chat_target:hecho-social'],
        usedRelationIds: [],
        suggestedFollowups: ['¿Qué tipos de solidaridad existen?'],
        externalKnowledgeUsed: false,
      })
    }
    providerCalls = 0
    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'philosophy-session',
        turnId: 'philo-turn-4',
        attempt: 1,
        message: 'Explícame qué es un hecho social.',
      }),
    })
    const res = await POST(req)
    const data: ChatTurnResult = await res.json()

    assert.equal(res.status, 200)
    assert.equal(data.provenance.sourceMode, 'MATERIAL_ONLY')
    assert.deepEqual(data.usedTargetIds, ['chat_target:hecho-social'])
    assert.equal(data.evidence.length, 1)
    assert.equal(data.evidence[0].targetId, 'chat_target:hecho-social')
    assert.deepEqual(data.evidence[0].pages, [1])
    assert.equal(data.sourceMaterial, 'sociology-fixture')
    assert.deepEqual(data.sourcePages, [1])
    console.log('  ✅ 8. Relevant query uses authorized targets with verified citations and pages')
  }

  console.log('\nAll 8 philosophy contracts passed successfully.\n')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
