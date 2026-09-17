import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint } from '../../lib/materialBrain/examEnjoyerContext'
import { InMemoryExamGenerationStore, WorkerExamGenerationStore, examGenerationIdentity, restoreExamGeneration, getOrBuildExamGeneration, advanceExamGeneration } from '../../lib/materialBrain/examGenerationStore'
import { POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'

// This is a release gate, not a characterization suite: unresolved product
// invariants intentionally fail. Every provider and persistence dependency
// used by route tests is replaced; no environment/provider keys are needed.
const selection = buildSourceSelectionSnapshot(['cert-material'], { 'cert-material': [1] })
function source(id: string, content = `Contenido académico ${id}`, examTypes = ['short_answer']) {
  return { id, name: `Concepto ${id}`, content, kind: id === 'formula' ? 'formula' : 'fact', importance: 'high', difficulty: 'medium',
    examTypes, topicId: 'topic', materialId: 'cert-material', pages: [1], sourceSpans: [{ page: 1, quote: content }] }
}
function enjoyer(items = [source('one')], language = 'es') {
  return { sourceSelectionFingerprint: selection.fingerprint, materialIds: selection.materialIds,
    selectedPages: selection.selectedPages, materialLanguage: language,
    topicsIndex: [{ id: 'topic', title: 'Tema' }], globalOrderedAnalysis: items, uniqueConceptsIndex: [] }
}
type StoredQuestion = { id: string; slotId: string; prompt: string }
let calls = 0
let semanticCalls = 0
let prompts: string[] = []
function setup(payload = enjoyer()) {
  calls = 0; semanticCalls = 0; prompts = []
  const store = new InMemoryExamGenerationStore<StoredQuestion>()
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'cert-user' } }),
    getAuthoritativeFreeSession: async () => ({ id: 'cert-session', userId: 'cert-user', processMode: 'free', sourceSelection: selection }),
    getMaterial: async () => ({ id: 'cert-material' }),
    lookupStudyalMaterialEnjoyer: async () => payload,
    gradingStore: new MemoryExamGradingStore(), examStore: store,
    generateValidatedLegacyJson: async ({ prompt, telemetryContext, beforeProviderAttempt }: { prompt: string; telemetryContext?: Record<string, unknown>; beforeProviderAttempt?: () => Promise<void> }) => {
      calls++; prompts.push(prompt)
      if (telemetryContext?.phase === 'semantic_grade') {
        await beforeProviderAttempt?.(); semanticCalls++
        const work = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)) as Array<{criterion:{criterionId:string}}>
        return { judgments: work.map(item => ({ criterionId: item.criterion.criterionId, scorePercent: 100, status: 'correct', feedback: 'Correcto' })) }
      }
      return prompt.split(/\n(?=\d+\.\s+slotId=)/).filter(block => /^\d+\.\s+slotId=/.test(block)).map(block => {
        const slotId = block.match(/slotId=(\S+)/)?.[1]
        const type = block.match(/type=(\S+)/)?.[1]
        return {
          slotId, type,
          sourceItemIds: block.match(/sourceItemIds=([^\n]+)/)?.[1].split(','),
          prompt: `Explica el contenido de ${slotId} ___`,
          wordBank: type === 'fill_blank' ? ['distractor_A', 'distractor_B', 'distractor_C'] : undefined,
        }
      })
    },
  })
  return store
}
async function post(body: unknown) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: response.status, data: await response.json() }
}
const start = (extra = {}) => post({ mode: 'generate', sessionId: 'cert-session', durationMinutes: 30, ...extra })
const results: { name: string; passed: boolean; detail?: string }[] = []
async function check(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`) }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({ name, passed: false, detail }); console.error(`FAIL ${name}: ${detail}`)
  }
}
async function main() {
  await check('A/C: raw source and missing session never reach generation', async () => {
    setup()
    for (const body of [null, [], {}, { materialText: 'PDF raw contents' }, { mode: 'generate', sessionId: 'cert-session', content: 'raw' }, { mode: 'adapt', sessionId: 'cert-session' }]) {
      assert.equal((await post(body)).status, 400)
    }
    assert.equal(calls, 0)
  })
  await check('A/B: live dispatch restores Enjoyer, never calls Brain or raw helpers', () => {
    const routePath = fs.existsSync('app/api/alai-studyal-exam/route.ts')
      ? 'app/api/alai-studyal-exam/route.ts'
      : path.resolve(__dirname, '../../app/api/alai-studyal-exam/route.ts')
    const route = fs.readFileSync(routePath, 'utf8')
    const dispatch = route.slice(route.indexOf('export async function POST'))
    assert.ok(route.includes('lookupStudyalMaterialEnjoyer'))
    assert.doesNotMatch(route, /restoreMaterialBrain|buildMaterialBrain|KnowledgeUnit/)
    assert.doesNotMatch(dispatch, /generateExam\(|extractFacts\(|adaptExam\(/)
  })
  await check('D: exact persisted fingerprint mismatch fails without provider', async () => {
    setup({ ...enjoyer(), sourceSelectionFingerprint: 'wrong' })
    const response = await start()
    assert.equal(response.status, 409); assert.equal(response.data.error, 'SOURCE_SELECTION_MISMATCH'); assert.equal(calls, 0)
  })
  await check('A/E: restore transport failure returns an honest error without generation', async () => {
    setup()
    Object.assign(__routeDeps, { lookupStudyalMaterialEnjoyer: async () => { throw new Error('RESTORE_UNAVAILABLE') } })
    const response = await start()
    assert.equal(response.status, 500); assert.equal(response.data.error, 'RESTORE_UNAVAILABLE'); assert.equal(calls, 0)
  })
  await check('E/F: ready persisted artifact restores identical IDs/order with zero provider', async () => {
    const store = setup()
    const { data } = await start()
    const before = calls
    const restored = await restoreExamGeneration('cert-session', selection.fingerprint, data.exam.id, store)
    assert.ok(restored)
    const reopened = await post({ mode: 'advance', sessionId: 'cert-session', examId: data.exam.id })
    assert.equal(reopened.status, 200)
    assert.deepEqual(reopened.data.exam.questions, data.exam.questions)
    assert.equal(calls, before)
  })
  await check('E/K: retrying generate for an existing exam must not create another exam', async () => {
    setup()
    const first = await start()
    const before = calls
    const retry = await start({ examId: first.data.exam.id })
    assert.equal(retry.data.exam.id, first.data.exam.id, 'generate ignores existing examId and creates new authority')
    assert.equal(calls, before)
  })
  await check('E: Worker writes use stable row IDs for repeated artifact upserts', async () => {
    const writes: Array<{ id?: string }> = []
    const previousFetch = globalThis.fetch
    const previousApi = process.env.STUDYAL_API_URL
    try {
      process.env.STUDYAL_API_URL = 'https://offline.invalid'
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), 'https://offline.invalid/material-results/exam-generation-cas')
        writes.push(JSON.parse(String(init?.body)))
        return Response.json({ ok: true, applied: true })
      }
      const store = new WorkerExamGenerationStore<StoredQuestion>({ getMaterialResult: async () => null })
      const artifact = { examId: 'exam', fingerprint: selection.fingerprint, questions: [], meta: { status: 'ready' as const, generatedAt: 'frozen' } }
      await store.saveArtifact('identity', artifact)
      await store.saveArtifact('identity', artifact)
      assert.equal(writes.length, 2)
      assert.ok(writes[0].id)
      assert.equal(writes[0].id, writes[1].id)
    } finally {
      globalThis.fetch = previousFetch
      if (previousApi === undefined) delete process.env.STUDYAL_API_URL; else process.env.STUDYAL_API_URL = previousApi
    }
  })
  await check('G: answer key and rubric are private before submission', async () => {
    setup(enjoyer([source('one', 'Canonical secret answer', ['fill_blank'])]))
    const { data } = await start()
    assert.ok(data.exam)
    for (const question of data.exam.questions) {
      for (const key of ['expectedAnswer', 'correctAnswer', 'correctAnswers', 'rubricHints']) {
        assert.ok(!(key in question), `client receives ${key}`)
      }
    }
  })
  await check('H/P: client key forgery rejected and objective grading is deterministic', async () => {
    setup(enjoyer([source('one', 'Verdad académica.', ['true_false'])]))
    const { data } = await start()
    const body = { mode: 'evaluate', sessionId: 'cert-session', examId: data.exam.id, answers: [true] }
    assert.equal((await post({ ...body, exam: { questions: [{ correctAnswer: true }] } })).status, 400)
    const before = calls
    const first = await post(body); const second = await post(body)
    assert.equal(first.data.evaluation.score, 100)
    assert.deepEqual(first.data.evaluation, second.data.evaluation)
    assert.equal(calls, before)
  })
  await check('I: duplicate semantic submission restores result without another provider call', async () => {
    setup()
    const { data } = await start()
    const body = { mode: 'evaluate', sessionId: 'cert-session', examId: data.exam.id, answers: ['Contenido académico one'] }
    assert.equal((await post(body)).status, 200)
    assert.equal((await post(body)).status, 200)
    assert.equal(semanticCalls, 1, 'semantic result is not persisted/idempotent')
  })
  await check('J/Q: partial output retries only missing slots and fails honestly at budget', async () => {
    // Different topics so each source gets its OWN slot — same-topic
    // targets may now share one slot as primary+context (up to 2
    // context targets, see EXAM_PRODUCT_CORRECTION composer change),
    // which is not what this retry-mechanics test is exercising.
    const universe = buildExamEnjoyerUniverse(enjoyer([{ ...source('one'), topicId: 'topic-a' }, { ...source('two'), topicId: 'topic-b' }]), selection)
    const blueprint = composeEnjoyerExamBlueprint(universe, 30, 'partial', 'seed')
    const store = new InMemoryExamGenerationStore<StoredQuestion>()
    const batches: string[][] = []
    const generate = async (ids: string[]) => {
      batches.push(ids)
      return new Map(batches.length === 1 ? [[ids[0], { id: ids[0], slotId: ids[0], prompt: 'Valid complete question' }]] : [])
    }
    const first = await getOrBuildExamGeneration('s', selection.fingerprint, 'partial', blueprint, store, generate)
    let final = await advanceExamGeneration('s', selection.fingerprint, 'partial', store, generate)
    while (final.status === 'generating') {
      final = await advanceExamGeneration('s', selection.fingerprint, 'partial', store, generate)
    }
    assert.equal(first.status, 'generating'); assert.equal(final.status, 'failed')
    assert.deepEqual(batches[1], [blueprint.slots[1].id])
    assert.deepEqual(final.artifact.questions, first.artifact.questions)
  })
  await check('J/Q: thrown provider errors cannot bypass the slot retry ceiling', async () => {
    const blueprint = composeEnjoyerExamBlueprint(buildExamEnjoyerUniverse(enjoyer(), selection), 30, 'throws', 'seed')
    const store = new InMemoryExamGenerationStore<StoredQuestion>()
    let attempts = 0
    const generate = async (): Promise<Map<string, StoredQuestion>> => { attempts++; throw new Error('provider unavailable') }
    await getOrBuildExamGeneration('s', selection.fingerprint, 'throws', blueprint, store, generate).catch(() => {})
    const identity = examGenerationIdentity('s', selection.fingerprint, 'throws')
    for (let i = 0; i < 3; i++) {
      const manifest = await store.getManifest(identity); assert.ok(manifest)
      manifest.updatedAt = new Date(0).toISOString(); await store.saveManifest(identity, manifest)
      await advanceExamGeneration('s', selection.fingerprint, 'throws', store, generate).catch(() => {})
    }
    assert.ok(attempts <= 5, `provider was retried ${attempts} times despite retry ceiling`)
  })
  await check('K: UI completes generation before starting and never advances during attempt', () => {
    const clientPath = fs.existsSync('components/materias/ALAIStudyALExams.tsx')
      ? 'components/materias/ALAIStudyALExams.tsx'
      : path.resolve(__dirname, '../../components/materias/ALAIStudyALExams.tsx')
    const client = fs.readFileSync(clientPath, 'utf8')
    const startFunction = client.slice(client.indexOf('function startExam()'), client.indexOf('// ─── BACKGROUND ADVANCE'))
    assert.match(startFunction, /genStatus !== 'ready'/)
    assert.match(startFunction, /readyCount !== totalSlots/)
    assert.match(client, /if \(phase !== 'preview'\) return/)
    assert.match(client, /advanceBusyRef.current/)
  })
  await check('L: Enjoyer language survives into frozen exam authority', () => {
    for (const language of ['es', 'en']) {
      const blueprint = composeEnjoyerExamBlueprint(buildExamEnjoyerUniverse(enjoyer([source('one')], language), selection), 30, 'language', 'seed')
      assert.ok(Object.values(blueprint).includes(language), `${language} is discarded by the Exam universe/blueprint`)
    }
  })
  await check('M: formulas preserve distinct Enjoyer targets', () => {
    const items = [source('plus', 'ΔG = a+b'), { ...source('minus', 'ΔG = a-b'), name: 'Concepto plus' }]
    const universe = buildExamEnjoyerUniverse(enjoyer(items), selection)
    assert.equal(universe.targets.length, 2, 'punctuation-normalized dedup merges different equations')
  })
  await check('M/P: formula grading distinguishes plus/minus and case', async () => {
    for (const [expected, wrong] of [['ΔG = A+B', 'ΔG = A-B'], ['E = mc²', 'E = mc2'], ['H₂O ⇌ H⁺ + OH⁻', 'H2O = H + OH'], ['a/b', 'a*b'], ['CO', 'Co']]) {
      setup(enjoyer([source('formula', expected, ['fill_blank'])]))
      const { data } = await start()
      const body = { mode: 'evaluate', sessionId: 'cert-session', examId: data.exam.id }
      assert.equal((await post({ ...body, answers: [expected] })).data.evaluation.score, 100)
      assert.equal((await post({ ...body, answers: [wrong] })).data.error, 'EXAM_SUBMISSION_IMMUTABLE')
      setup(enjoyer([source('formula', expected, ['fill_blank'])]))
      const fresh = await start()
      assert.equal((await post({ ...body, examId: fresh.data.exam.id, answers: [wrong] })).data.evaluation.score, 0, `different formula ${wrong} was graded correct`)
    }
  })
  await check('N: all accepted targets have explicit blueprint coverage', () => {
    const universe = buildExamEnjoyerUniverse(enjoyer([source('one'), source('two')]), selection)
    const blueprint = composeEnjoyerExamBlueprint(universe, 30, 'coverage', 'seed')
    assert.equal(blueprint.coverage.coveragePercent, 100)
    assert.deepEqual(new Set(blueprint.representedTargetIds), new Set(universe.targets.map(target => target.id)))
  })
  await check('N/O: compressed multi-select retains every canonical answer', async () => {
    const store = setup(enjoyer(Array.from({ length: 80 }, (_, index) => source(`target-${index}`, `Hecho académico ${index}`, ['multi_select']))))
    const { data } = await start({ durationMinutes: 15 })
    assert.ok(data.exam)
    const restored = await restoreExamGeneration('cert-session', selection.fingerprint, data.exam.id, store)
    assert.ok(restored)
    // EXAM_FINAL blocker #3 fix means correctAnswers is no longer on
    // the PUBLIC response (data.exam.questions) — inspect the PRIVATE
    // persisted artifact instead, exactly as the handoff instructed.
    for (const privateQuestion of restored.artifact.questions) {
      const slot = restored.manifest.blueprint.slots.find(slot => slot.id === (privateQuestion.slotId || privateQuestion.id))
      assert.ok(slot)
      if (slot.answerAuthority.kind === 'multi_text') {
        assert.equal((privateQuestion as any).correctAnswers?.length, slot.answerAuthority.canonicalValues.length, 'option cap silently drops compressed targets')
      }
    }
    // And confirm the public DTO genuinely never carries the secret.
    for (const question of data.exam.questions.filter((q: { ready: boolean }) => q.ready)) {
      assert.ok(!('correctAnswers' in question), 'public response must never carry correctAnswers')
    }
  })
  await check('O: malformed required target is rejected or explicitly classified, never dropped', () => {
    const payload = enjoyer([source('one'), source('missing', '')])
    try {
      const universe = buildExamEnjoyerUniverse(payload, selection)
      assert.ok(JSON.stringify(universe).includes('missing'), 'required source missing from coverage denominator without decision')
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error
      assert.ok(error instanceof Error)
    }
  })
  const failed = results.filter(result => !result.passed)
  console.log(`EXAM FINAL GATE: ${results.length - failed.length}/${results.length} passed; ${failed.length} blocked; live provider calls: 0 (injected mocks only)`)
  process.exitCode = failed.length ? 1 : 0
}
main().catch(error => { console.error(error); process.exitCode = 1 })
