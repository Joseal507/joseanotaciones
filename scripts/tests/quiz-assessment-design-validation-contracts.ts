import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { assessDesignValidation, validateAssessmentDesign, defaultEnjoyerQuizProvider, getOrCreateEnjoyerAssessmentDesign,
  buildEnjoyerAssessmentUniverse, startEnjoyerQuizGeneration, advanceEnjoyerQuizGeneration,
  normalizeEnjoyerQuizConfig, type EnjoyerQuizArtifact, type EnjoyerQuizGenerationManifest, type EnjoyerQuizStore,
  type EnjoyerQuizProvider } from '../../lib/materialBrain/quiz/enjoyer'
import { POST, responseForArtifact, __routeDeps } from '../../app/api/alai-studyal-quizzes/route'

const selection = buildSourceSelectionSnapshot(['m'], { m: [1] })
const payload = { sourceSelectionFingerprint: selection.fingerprint, globalOrderedAnalysis: [
  { id: 'a', name: 'Alpha', summary: 'Alpha is a concept.', kind: 'concept', materialId: 'm', pages: [1], sourceSpans: [{ page: 1, quote: 'Alpha is a concept.' }] },
] }
const universe = buildEnjoyerAssessmentUniverse(payload, selection)
const design = validateAssessmentDesign({ idealQuestionCountForFullCoverage: 1, targetGroups: [{ id: 'g', targetIds: ['assessment:a'] }] }, universe)
class Store implements EnjoyerQuizStore {
  artifact: EnjoyerQuizArtifact | null = null
  manifest: EnjoyerQuizGenerationManifest | null = null
  async get() { return this.artifact && structuredClone(this.artifact) }
  async getManifest() { return this.manifest && structuredClone(this.manifest) }
  async save(_id: string, a: EnjoyerQuizArtifact) { this.artifact = structuredClone(a) }
  async saveManifest(_id: string, m: EnjoyerQuizGenerationManifest) { this.manifest = structuredClone(m) }
}
let count = 0
async function test(name: string, fn: () => unknown | Promise<unknown>) { await fn(); console.log(`PASS ${++count}: ${name}`) }
async function main() {
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN') }
  const originals = { ...__routeDeps }
  try {
    for (const [name, raw, reason] of [
      ['empty', {}, 'MALFORMED_DESIGN'], ['null', null, 'MALFORMED_DESIGN'],
      ['missing ideal', { targetGroups: [] }, 'INVALID_IDEAL_QUESTION_COUNT'],
      ['zero', { ...design, idealQuestionCountForFullCoverage: 0 }, 'INVALID_IDEAL_QUESTION_COUNT'],
      ['negative', { ...design, idealQuestionCountForFullCoverage: -1 }, 'INVALID_IDEAL_QUESTION_COUNT'],
      ['fraction', { ...design, idealQuestionCountForFullCoverage: 1.5 }, 'INVALID_IDEAL_QUESTION_COUNT'],
      ['101', { ...design, idealQuestionCountForFullCoverage: 101 }, 'QUESTION_COUNT_EXCEEDS_MAX'],
      ['no groups', { ...design, targetGroups: [] }, 'NO_VALID_TARGET_GROUPS'],
      ['empty group', { ...design, targetGroups: [{ targetIds: [] }] }, 'EMPTY_TARGET_GROUP'],
      ['unknown', { ...design, targetGroups: [{ targetIds: ['foreign-secret'] }] }, 'UNKNOWN_TARGET_ID'],
    ] as const) await test(name, () => assert.equal(assessDesignValidation(raw, universe).reasonCode, reason))
    await test('authorized aliases and missing coverage', () => {
      assert.equal(assessDesignValidation({ ...design, targetGroups: [{ targetIds: ['a'] }] }, universe).valid, true)
      assert.equal(assessDesignValidation(design, { ...universe, targets: [...universe.targets, { ...universe.targets[0], id: 'assessment:b' }] }).reasonCode, 'UNCOVERED_TARGETS')
    })
    await test('diagnostics never echo raw provider IDs or group prose', () => {
      for (const ids of [[], ['TOP SECRET ANSWER'], [null]]) {
        const result = assessDesignValidation({ ...design, targetGroups: [{ id: 'TOP SECRET GROUP', targetIds: ids }] }, universe)
        assert.ok(!result.valid)
        assert.ok(!JSON.stringify(result).includes('TOP SECRET'))
      }
      assert.equal(assessDesignValidation({ ...design, targetGroups: [{ targetIds: ['blocked'] }] }, { ...universe, unauthorizedTargetIds: new Set(['blocked']) }).reasonCode, 'UNAUTHORIZED_TARGET_ID')
    })
    let cached: unknown = null, writes = 0
    const persistence = {
      getMaterialResult: async () => cached ? ({ payload: cached } as NonNullable<Awaited<ReturnType<NonNullable<Parameters<typeof getOrCreateEnjoyerAssessmentDesign>[2]>['getMaterialResult']>>>) : null,
      saveMaterialResult: async (data: Parameters<NonNullable<Parameters<typeof getOrCreateEnjoyerAssessmentDesign>[2]>['saveMaterialResult']>[0]) => { cached = structuredClone(data.payload); writes++; return { ok: true } },
    }
    await test('actual JSON pipeline: invalid then valid => 2 calls, actual cache save/restore => 0', async () => {
      let calls = 0
      const stages: string[] = []
      const provider: EnjoyerQuizProvider = request => defaultEnjoyerQuizProvider(request, async input => {
        calls++; stages.push(String(input.stage))
        if (calls === 2) assert.match(JSON.stringify(input.messages), /MALFORMED_DESIGN/)
        return { text: JSON.stringify(calls === 1 ? {} : design), provider: 'offline', model: 'offline' }
      })
      const created = await getOrCreateEnjoyerAssessmentDesign(universe, provider, persistence)
      assert.equal(calls, 2); assert.equal(created.providerCalls, 2); assert.deepEqual(stages, ['normal', 'targeted_repair'])
      const before = writes
      const restored = await getOrCreateEnjoyerAssessmentDesign(universe, async () => { throw Error('NO_PROVIDER_ON_RESTORE') }, persistence)
      assert.equal(restored.providerCalls, 0); assert.equal(writes, before)
    })
    let exhaustion: unknown
    await test('actual JSON pipeline: invalid twice exhausts without a third call or save', async () => {
      let calls = 0
      const before = writes
      cached = null
      try {
        await getOrCreateEnjoyerAssessmentDesign(universe, request => defaultEnjoyerQuizProvider(request, async () => {
          calls++; return { text: '{}', provider: 'offline', model: 'offline' }
        }), persistence)
        assert.fail('must exhaust')
      } catch (error) { exhaustion = error; assert.match(String(error), /GENERATION_BUDGET_EXHAUSTED/) }
      assert.equal(calls, 2); assert.equal(writes, before); assert.equal(cached, null)
    })
    await test('historical ideal above 100 restores with zero calls and no overwrite', async () => {
      cached = { ...design, idealQuestionCountForFullCoverage: 137 }
      const snapshot = JSON.stringify(cached), before = writes
      const restored = await getOrCreateEnjoyerAssessmentDesign(universe, async () => { throw Error('NO_LEGACY_REGENERATION') }, persistence)
      assert.equal(restored.design.idealQuestionCountForFullCoverage, 137)
      assert.equal(restored.providerCalls, 0); assert.equal(writes, before); assert.equal(JSON.stringify(cached), snapshot)
    })
    const config = normalizeEnjoyerQuizConfig({ questionCount: 100, difficulty: 'medium', questionTypes: ['multiple_choice'] })
    const store = new Store()
    let authorCalls = 0
    const author: EnjoyerQuizProvider = async request => {
      authorCalls++
      return { questions: request.requiredSlots?.map((_, i) => ({ type: 'multiple_choice',
        question: `What is Alpha in assessment authoring batch ${authorCalls}, item ${i + 1}?`,
        explanation: 'Alpha is a concept.', assessmentTargetIds: ['assessment:a'], options: ['Alpha', 'Beta'], correctAnswer: 0 })) }
    }
    await test('actual generation and public response accept exactly 100', async () => {
      let result = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 's', config, design, generationId: 'g', store, provider: author })
      for (let i = 0; result.status === 'generating' && i < 20; i++) result = await advanceEnjoyerQuizGeneration({ universe, sessionId: 's', config, generationId: 'g', store, provider: author })
      assert.equal(result.status, 'ready'); assert.equal(result.artifact.questions.length, 100)
      assert.equal((await responseForArtifact(result.artifact, 'hit', result.manifest).json()).quiz.length, 100)
    })
    const goodArtifact = structuredClone(store.artifact!), goodManifest = structuredClone(store.manifest!)
    await test('restore mismatches reject before provider and preserve persisted work', async () => {
      for (const change of [
        (m: EnjoyerQuizGenerationManifest) => { m.totalSlots = 101 },
        (m: EnjoyerQuizGenerationManifest) => { m.typePlan.push('multiple_choice') },
        (m: EnjoyerQuizGenerationManifest) => { m.readyCount = 99 },
        (m: EnjoyerQuizGenerationManifest) => { m.config.questionCount = 99 },
        (m: EnjoyerQuizGenerationManifest) => { m.presentedOrder.pop() },
      ]) {
        store.artifact = structuredClone(goodArtifact); store.manifest = structuredClone(goodManifest)
        change(store.manifest)
        const frozen = JSON.stringify(store.artifact), before = authorCalls
        await assert.rejects(advanceEnjoyerQuizGeneration({ universe, sessionId: 's', config, generationId: 'g', store, provider: author }), /MANIFEST_CORRUPT/)
        await assert.rejects(startEnjoyerQuizGeneration({ payload, selection, sessionId: 's', config, design, generationId: 'g', store, provider: author }), /MANIFEST_CORRUPT/)
        assert.equal(authorCalls, before); assert.equal(JSON.stringify(store.artifact), frozen)
      }
      const oversized = structuredClone(goodArtifact); oversized.questions.push(oversized.questions[0])
      assert.throws(() => responseForArtifact(oversized, 'hit'), /MANIFEST_CORRUPT/)
      store.artifact = oversized; store.manifest = structuredClone(goodManifest)
      const before = authorCalls
      await assert.rejects(startEnjoyerQuizGeneration({ payload, selection, sessionId: 's', config, design, generationId: 'g', store, provider: author }), /MANIFEST_CORRUPT/)
      assert.equal(authorCalls, before); assert.deepEqual(store.artifact, oversized)
      assert.throws(() => normalizeEnjoyerQuizConfig({ ...config, questionCount: 101 }), /INVALID_CONFIG/)
    })
    Object.assign(__routeDeps, {
      getServerSession: async () => ({ user: { id: 'u' } }),
      getAuthoritativeFreeSession: async () => ({ sourceSelection: selection }),
      getMaterial: async () => ({ id: 'm' }), lookupEnjoyer: async () => payload,
      createStore: () => new Store(), createCompletionStore: () => ({ list: async () => [], insert: async (result: unknown) => ({ applied: true, result }) }),
    })
    const post = (mode?: string) => POST(new NextRequest('http://localhost/api/alai-studyal-quizzes', { method: 'POST', body: JSON.stringify({ mode, sessionId: 's', sourceSelectionFingerprint: selection.fingerprint, config }) }))
    await test('new route coverage bypasses historical provider design and uses zero calls', async () => {
      let routeDesignCalls = 0
      __routeDeps.getOrCreateDesign = async () => { routeDesignCalls++; throw exhaustion }
      const response = await post('coverage'); const body = await response.json()
      assert.equal(response.status, 200); assert.equal(body.providerCalls, 0); assert.equal(routeDesignCalls, 0)
    })
    await test('actual route never mislabels question exhaustion as design', async () => {
      __routeDeps.startGeneration = async () => { throw Error('GENERATION_BUDGET_EXHAUSTED:INVALID_QUIZ_ENJOYER_OUTPUT') }
      const response = await post(); assert.equal(response.status, 500); assert.equal((await response.json()).error, 'GENERATION_FAILED')
    })
    await test('completed production restore invokes zero authoring calls', async () => {
      store.artifact = goodArtifact; store.manifest = goodManifest
      const before = authorCalls
      const restored = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 's', config, design: { ...design, idealQuestionCountForFullCoverage: 137 }, generationId: 'g', store, provider: author })
      assert.deepEqual(restored.artifact, goodArtifact); assert.equal(authorCalls, before)
    })
    await test('mounted Quiz: coverage 422 exits loading, no loop, actual retry works', async () => {
      const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
      const storage = new Map<string, string>()
      const localStorage = { getItem: (k: string) => storage.get(k) || null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) }
      Object.assign(globalThis, { React, window, document, localStorage, IS_REACT_ACT_ENVIRONMENT: true })
      Object.defineProperty(window, 'localStorage', { value: localStorage, configurable: true })
      let coverageCalls = 0
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        assert.equal(body.mode, 'coverage')
        coverageCalls++
        return Response.json({ success: false, error: 'INVALID_ASSESSMENT_DESIGN', detail: 'UNCOVERED_TARGETS' }, { status: 422 })
      }
      const Quiz = (await import('../../components/materias/ALAIStudyALQuizzes')).default
      const root = createRoot(document.getElementById('root')!)
      const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)) }) }
      try {
        await act(async () => root.render(React.createElement(Quiz, { materiales: [], seleccion: [], sourceSelection: selection, sessionId: 'client-offline', onBack() {} })))
        await settle()
        assert.equal(coverageCalls, 1)
        assert.equal(document.querySelector('[aria-label="Calculando cantidad recomendada"]'), null)
        const retry = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Reintentar cobertura'))!
        assert.ok(retry)
        const generate = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Generar mi quiz'))!
        assert.ok(generate); assert.equal(generate.hasAttribute('disabled'), false)
        await act(async () => retry.dispatchEvent(new window.Event('click', { bubbles: true })))
        await settle(); assert.equal(coverageCalls, 2)
        assert.equal(document.querySelector('[aria-label="Calculando cantidad recomendada"]'), null)
      } finally { await act(async () => root.unmount()) }
    })
    console.log(`quiz-assessment-design-validation-contracts: ${count} production contracts PASS; live provider calls=0`)
  } finally { globalThis.fetch = savedFetch; Object.assign(__routeDeps, originals) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
