import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import type { MaterialResult, ResultType, EnfoqueType } from '../../lib/materials/types'
import type { QuizGenerationCasPayload } from '../../lib/materials/repository'
import {
  advanceEnjoyerQuizGeneration,
  assertEnjoyerQuizState,
  buildEnjoyerAssessmentUniverse,
  normalizeEnjoyerQuizConfig,
  runEnjoyerProgressiveChunk,
  startEnjoyerQuizGeneration,
  WorkerEnjoyerQuizStore,
  type EnjoyerGroundedQuizQuestion,
  type EnjoyerQuizArtifact,
  type EnjoyerQuizGenerationManifest,
  type EnjoyerQuizProvider,
  type EnjoyerQuizStore,
} from '../../lib/materialBrain/quiz/enjoyer'
import { composeProgressiveQuizScope, deriveQuizProgressiveCoverage } from '../../lib/materialBrain/quiz/progressiveCoverage'
import {
  nextEnjoyerQuizAdvanceRetry,
  QUIZ_ADVANCE_AUTO_RETRY_DELAYS_MS,
  resumeEnjoyerQuizAdvance,
} from '../../lib/quiz/enjoyerProgressiveUi'

const selection = buildSourceSelectionSnapshot(['quiz-cas-material'], { 'quiz-cas-material': [1] })

function fixturePayload(count: number) {
  return {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic', title: 'Topic', order: 0 }],
    globalOrderedAnalysis: Array.from({ length: count }, (_, index) => ({
      id: `target-${index}`, name: `Concept ${index}`,
      summary: `Concept ${index} is supported by authoritative evidence ${index}.`,
      kind: 'fact', importance: 100 - index, materialId: 'quiz-cas-material', pages: [1],
      globalOrder: index, topicId: 'topic',
      sourceSpans: [{ page: 1, quote: `Concept ${index} is supported by authoritative evidence ${index}.` }],
    })),
  }
}

const provider: EnjoyerQuizProvider = async request => ({
  questions: (request.requiredSlots || []).map(slot => {
    const target = request.universe.targets.find(item => item.id === slot.primaryTargetId)!
    return { slotId: slot.slotId, type: slot.type,
      question: `Which statement identifies ${target.title} for ${slot.slotId}?`,
      options: [target.title, `Not ${target.title}`], correctAnswer: 0, explanation: target.content }
  }),
})

type StoredRow = MaterialResult & { payload: EnjoyerQuizArtifact | EnjoyerQuizGenerationManifest }

class AtomicQuizRows {
  rows = new Map<string, StoredRow>()
  writes = 0
  async get(materialId: string, _enfoque: EnfoqueType, _resultType: ResultType): Promise<MaterialResult | null> {
    const row = this.rows.get(materialId)
    return row ? structuredClone(row) : null
  }
  async cas(input: QuizGenerationCasPayload): Promise<{ applied: boolean }> {
    const artifactId = `enjoyer_quiz:${input.identity}`
    const manifestId = `enjoyer_quiz_manifest:${input.identity}`
    const artifact = this.rows.get(artifactId)
    const manifest = this.rows.get(manifestId)
    const expectedMatches = (artifact?.content_hash || null) === input.expectedArtifactRevision
      && (manifest?.content_hash || null) === input.expectedManifestRevision
    const frozen = (artifact?.payload as EnjoyerQuizArtifact | undefined)?.meta?.status === 'ready'
      || (manifest?.payload as EnjoyerQuizGenerationManifest | undefined)?.status === 'ready'
    const scopeMatches = (!artifact && !manifest)
      || (JSON.stringify((artifact?.payload as EnjoyerQuizArtifact).scopePlan ?? null)
        === JSON.stringify((input.artifact as unknown as EnjoyerQuizArtifact).scopePlan ?? null)
        && JSON.stringify((manifest?.payload as EnjoyerQuizGenerationManifest).scopePlan ?? null)
          === JSON.stringify((input.manifest as unknown as EnjoyerQuizGenerationManifest).scopePlan ?? null))
    if (!expectedMatches || frozen || !scopeMatches) return { applied: false }
    const createdAt = new Date().toISOString()
    this.rows.set(artifactId, { id: artifactId, material_id: artifactId, enfoque: 'mixto', result_type: 'quiz',
      content_hash: input.revision, payload: structuredClone(input.artifact) as unknown as EnjoyerQuizArtifact, created_at: createdAt })
    this.rows.set(manifestId, { id: manifestId, material_id: manifestId, enfoque: 'mixto', result_type: 'quiz',
      content_hash: input.revision, payload: structuredClone(input.manifest) as unknown as EnjoyerQuizGenerationManifest, created_at: createdAt })
    this.writes++
    return { applied: true }
  }
}

class MemoryStore implements EnjoyerQuizStore {
  artifact: EnjoyerQuizArtifact | null
  manifest: EnjoyerQuizGenerationManifest | null
  constructor(artifact: EnjoyerQuizArtifact, manifest: EnjoyerQuizGenerationManifest) {
    this.artifact = structuredClone(artifact); this.manifest = structuredClone(manifest)
  }
  async get() { return this.artifact && structuredClone(this.artifact) }
  async getManifest() { return this.manifest && structuredClone(this.manifest) }
  async save(_id: string, value: EnjoyerQuizArtifact) { this.artifact = structuredClone(value) }
  async saveManifest(_id: string, value: EnjoyerQuizGenerationManifest) { this.manifest = structuredClone(value) }
}

async function main() {
  let passed = 0
  const test = async (name: string, run: () => void | Promise<void>) => {
    await run(); passed++; console.log(`PASS ${passed}: ${name}`)
  }
  const payload = fixturePayload(12)
  const universe = buildEnjoyerAssessmentUniverse(payload, selection)
  const config = normalizeEnjoyerQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const scopePlan = composeProgressiveQuizScope({ universe,
    coverage: deriveQuizProgressiveCoverage(universe, 'user', []), config, generationId: 'cas-generation' })
  const rows = new AtomicQuizRows()
  const deps = {
    getMaterialResult: rows.get.bind(rows),
    compareAndSwapQuizGeneration: rows.cas.bind(rows),
  }
  const firstStore = new WorkerEnjoyerQuizStore(deps)
  const generated = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'session', config,
    scopePlan, generationId: 'cas-generation', store: firstStore, provider })
  assert.equal(generated.status, 'generating')
  assert.equal(generated.artifact.questions.length, 8)

  await test('paired Worker store CAS gives one winner and preserves every accepted sibling', async () => {
    const storeA = new WorkerEnjoyerQuizStore(deps)
    const storeB = new WorkerEnjoyerQuizStore(deps)
    const [snapshotA, snapshotB] = await Promise.all([storeA.loadState(generated.manifest.identity), storeB.loadState(generated.manifest.identity)])
    assert.ok(snapshotA.artifact && snapshotA.manifest && snapshotB.artifact && snapshotB.manifest)
    const missing = scopePlan.slots.filter(slot => !snapshotA.artifact!.questions.some(q => q.grounding.slotId === slot.slotId))
    const candidate = (snapshot: typeof snapshotA, slotIndex: number) => {
      const slot = missing[slotIndex]
      const seed = snapshot.artifact!.questions[0]
      const question: EnjoyerGroundedQuizQuestion = {
        ...structuredClone(seed), id: `candidate-${slotIndex}`, question: `Candidate ${slotIndex}`,
        grounding: { ...structuredClone(seed.grounding), slotId: slot.slotId,
          assessmentTargetIds: [slot.primaryTargetId], sourceItemIds: [slot.primaryTargetId] },
      }
      const artifact = { ...structuredClone(snapshot.artifact!), questions: [...snapshot.artifact!.questions, question] }
      const manifest = { ...structuredClone(snapshot.manifest!), readyCount: artifact.questions.length,
        presentedOrder: artifact.questions.map(item => item.grounding.slotId) }
      assertEnjoyerQuizState(artifact, manifest, config)
      return { artifact, manifest }
    }
    const a = candidate(snapshotA, 0)
    const b = candidate(snapshotB, 1)
    const [writeA, writeB] = await Promise.all([
      storeA.compareAndSwapState(generated.manifest.identity, snapshotA, a.artifact, a.manifest),
      storeB.compareAndSwapState(generated.manifest.identity, snapshotB, b.artifact, b.manifest),
    ])
    assert.equal(Number(writeA.applied) + Number(writeB.applied), 1)
    const winner = await storeA.loadState(generated.manifest.identity)
    assert.equal(winner.artifact?.questions.length, 9)
    assert.deepEqual(winner.artifact?.questions.slice(0, 8), generated.artifact.questions)
    const stale = await storeB.compareAndSwapState(generated.manifest.identity, snapshotB, b.artifact, b.manifest)
    assert.equal(stale.applied, false)
    assert.deepEqual((await storeB.loadState(generated.manifest.identity)).artifact, winner.artifact)
  })

  await test('two production chunk workers share the CAS lease and only one authors the unresolved slot', async () => {
    const storeA = new WorkerEnjoyerQuizStore(deps)
    const storeB = new WorkerEnjoyerQuizStore(deps)
    const snapshot = await storeA.loadState(generated.manifest.identity)
    assert.ok(snapshot.artifact && snapshot.manifest)
    let calls = 0
    const countedProvider: EnjoyerQuizProvider = async request => { calls++; return provider(request) }
    await Promise.all([
      runEnjoyerProgressiveChunk({ artifact: snapshot.artifact, manifest: snapshot.manifest,
        store: storeA, provider: countedProvider }),
      runEnjoyerProgressiveChunk({ artifact: structuredClone(snapshot.artifact),
        manifest: structuredClone(snapshot.manifest), store: storeB, provider: countedProvider }),
    ])
    const final = await storeA.loadState(generated.manifest.identity)
    assert.equal(calls, 1)
    assert.equal(final.artifact?.questions.length, 10)
    assert.equal(final.manifest?.status, 'ready')
    assert.deepEqual(final.artifact?.questions.slice(0, 8), generated.artifact.questions)
  })

  await test('ready state cannot regress and frozen scopePlan cannot be replaced', async () => {
    const store = new WorkerEnjoyerQuizStore(deps)
    const ready = await store.loadState(generated.manifest.identity)
    assert.equal(ready.manifest?.status, 'ready')
    const regressedArtifact = { ...structuredClone(ready.artifact!), meta: { ...ready.artifact!.meta, status: 'generating' as const } }
    const changedManifest = { ...structuredClone(ready.manifest!), status: 'generating' as const,
      scopePlan: { ...ready.manifest!.scopePlan!, scopeFingerprint: 'f'.repeat(64) } }
    const stale = await store.compareAndSwapState(generated.manifest.identity, ready, regressedArtifact, changedManifest)
    assert.equal(stale.applied, false)
    assert.equal((await store.loadState(generated.manifest.identity)).manifest?.status, 'ready')
    assert.deepEqual((await store.loadState(generated.manifest.identity)).manifest?.scopePlan, scopePlan)
  })

  await test('one-sided or mismatched scopePlan fails before provider authoring', async () => {
    const baseRows = new AtomicQuizRows()
    const baseStore = new WorkerEnjoyerQuizStore({ getMaterialResult: baseRows.get.bind(baseRows),
      compareAndSwapQuizGeneration: baseRows.cas.bind(baseRows) })
    const base = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'corrupt', config, scopePlan,
      generationId: 'corrupt-generation', store: baseStore, provider })
    const corruptions: Array<[EnjoyerQuizArtifact, EnjoyerQuizGenerationManifest]> = [
      [structuredClone(base.artifact), { ...structuredClone(base.manifest), scopePlan: undefined }],
      [{ ...structuredClone(base.artifact), scopePlan: undefined }, structuredClone(base.manifest)],
      [structuredClone(base.artifact), { ...structuredClone(base.manifest),
        scopePlan: { ...base.manifest.scopePlan!, scopeFingerprint: '0'.repeat(64) } }],
    ]
    for (const [artifact, manifest] of corruptions) {
      const store = new MemoryStore(artifact, manifest)
      let calls = 0
      await assert.rejects(() => advanceEnjoyerQuizGeneration({ universe, sessionId: 'corrupt', config,
        generationId: 'corrupt-generation', store, provider: async request => { calls++; return provider(request) } }),
      /MANIFEST_CORRUPT|MANIFEST_MISSING/)
      assert.equal(calls, 0)
    }
  })

  await test('client advance retries are finite and manual resume retains generation identity', () => {
    let failedAttempts = 0
    const delays: number[] = []
    while (true) {
      const retry = nextEnjoyerQuizAdvanceRetry(failedAttempts)
      failedAttempts = retry.nextFailedAttempts
      if (retry.pause) break
      delays.push(retry.delayMs)
    }
    assert.deepEqual(delays, [...QUIZ_ADVANCE_AUTO_RETRY_DELAYS_MS])
    assert.equal(failedAttempts, 4)
    const resumed = resumeEnjoyerQuizAdvance('same-generation-id')
    assert.deepEqual(resumed, { generationId: 'same-generation-id', failedAttempts: 0, paused: false })
  })

  await test('mounted client pauses after three automatic retries and manually resumes the same generation', async () => {
    const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
    const storage = new Map<string, string>()
    const localStorage = { getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeSetTimeout(handler, Number(timeout) >= 1_000 ? 1 : Number(timeout), ...args)) as typeof window.setTimeout
    const requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)
    const cancelAnimationFrame = (handle: number) => window.clearTimeout(handle)
    Object.assign(window, { requestAnimationFrame, cancelAnimationFrame })
    Object.assign(globalThis, { React, window, document, localStorage, requestAnimationFrame, cancelAnimationFrame,
      HTMLElement: window.HTMLElement, Element: window.Element, SVGElement: window.SVGElement,
      IS_REACT_ACT_ENVIRONMENT: true })
    Object.defineProperty(window, 'localStorage', { value: localStorage, configurable: true })
    const question = (id: string, slotId: string) => ({ id, type: 'multiple_choice', question: `Question ${id}?`,
      options: ['Correct', 'Wrong'], correctAnswer: 0, explanation: 'Grounded.',
      grounding: { planId: 'plan', slotId, candidateId: id, sourceUnitIds: [], sourceRelationIds: [],
        evidence: [], supportingText: 'Grounded.' } })
    const q1 = question('q1', 'slot-1')
    const q2 = question('q2', 'slot-2')
    const manifest = (status: 'generating' | 'ready', readyCount: number) => ({
      totalSlots: 2, readyCount, status, presentedOrder: readyCount === 1 ? ['slot-1'] : ['slot-1', 'slot-2'],
    })
    let advanceCalls = 0
    const seenGenerationIds: string[] = []
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'))
      if (body.mode === 'coverage') return Response.json({ success: true, coverage: {
        totalAssessableTargets: 12, coveredTargetCount: 0, uncoveredTargetCount: 12,
        estimatedCoveragePercent: 0, mode: 'first_pass', representedSupportedTypeCount: 1,
        supportedSelectedTypeCount: 1, assessablePageCount: 1, sourceRegionCount: 1,
        supportedSelectedTypes: ['multiple_choice'], unsupportedSelectedTypes: [],
      } })
      if (body.mode === 'advance') {
        advanceCalls++
        seenGenerationIds.push(body.generationId)
        if (advanceCalls <= 4) return Response.json({ success: false, error: 'ADVANCE_FAILED' }, { status: 503 })
        return Response.json({ success: true, status: 'ready', quiz: [q1, q2], manifest: manifest('ready', 2),
          artifactIdentity: 'artifact-b', artifact: { generationId: 'generation-b' } })
      }
      return Response.json({ success: true, status: 'generating', quiz: [q1], manifest: manifest('generating', 1),
        artifactIdentity: 'artifact-b', artifact: { generationId: 'generation-b',
          sourceSelectionFingerprint: selection.fingerprint, configFingerprint: 'config' } })
    }
    const quizModule = await import('../../components/materias/ALAIStudyALQuizzes')
    const Quiz = quizModule.default
    const pausedHtml = renderToStaticMarkup(<quizModule.QuizProgressiveGenerationRecovery paused onRetry={() => undefined} />)
    const activeHtml = renderToStaticMarkup(<quizModule.QuizProgressiveGenerationRecovery paused={false} onRetry={() => undefined} />)
    assert.match(pausedHtml, /data-quiz-generation-retry/)
    assert.match(pausedHtml, /Reintentar generación/)
    assert.doesNotMatch(activeHtml, /data-quiz-generation-retry/)
    const root = createRoot(document.getElementById('root')!)
    const settle = async (rounds = 15) => {
      for (let index = 0; index < rounds; index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    }
    try {
      await act(async () => root.render(React.createElement(Quiz, { materiales: [], seleccion: [],
        sourceSelection: selection, sessionId: 'durable-client', onBack() {} })))
      await settle(50)
      const generate = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Generar mi quiz'))
      assert.ok(generate, document.body.innerHTML.slice(0, 1_000))
      await act(async () => generate.dispatchEvent(new window.Event('click', { bubbles: true })))
      await settle(100)
      assert.equal(advanceCalls, 4)
      const retry = document.querySelector('[data-quiz-generation-retry]')
      assert.ok(retry, document.body.innerHTML.slice(0, 3_000))
      assert.ok(document.body.textContent?.includes('Question q1?'))
      await act(async () => retry.dispatchEvent(new window.Event('click', { bubbles: true })))
      await settle()
      assert.equal(advanceCalls, 5)
      assert.ok(seenGenerationIds.every(id => id === 'generation-b'))
      assert.equal(document.querySelector('[data-quiz-generation-retry]'), null)
      assert.ok(document.body.textContent?.includes('Question q1?'))
    } finally {
      await act(async () => root.unmount())
    }
  })

  await test('Worker endpoint performs paired D1 CAS and generic upsert cannot overwrite its stable rows', () => {
    const worker = readFileSync('cloudflare/studyal-api/src/index.ts', 'utf8')
    assert.match(worker, /material-results\/quiz-generation-cas/)
    assert.match(worker, /env\.DB\.batch\(statements\)/)
    assert.match(worker, /enjoyer_quiz_manifest:/)
    assert.match(worker, /NOT \(material_results\.result_type = 'quiz'/)
  })

  console.log(`quiz-final-durability-contracts: ${passed} PASS; provider=mock; live D1 mutations=0`)
}

main().catch(error => { console.error(error); process.exit(1) })
