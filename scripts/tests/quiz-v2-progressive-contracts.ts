import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import type { MaterialBrain } from '../../lib/materialBrain/types'
import {
  InMemoryQuizArtifactStore,
  applyQuizPresentation,
  advanceQuizGeneration,
  computePresentedSlotOrder,
  decodePartialQuizArtifact,
  decodePersistedQuizArtifact,
  getOrBuildQuizGeneration,
  generateQuizFromPlan,
  normalizeQuizConfig,
  planQuiz,
  quizArtifactIdentity,
  quizConfigFingerprint,
  type GenerateQuizBatchFn,
} from '../../lib/materialBrain/quiz'

const source = buildSourceSelectionSnapshot(['progressive-material'], { 'progressive-material': [1, 2, 3] })

function fixtureBrain(): MaterialBrain {
  const units = Array.from({ length: 18 }, (_, index) => {
    const id = `progressive-unit-${index + 1}`
    const label = `Concepto autorizado ${index + 1}`
    const statement = `${label} explica el principio académico número ${index + 1}.`
    return {
      id, kind: 'fact' as const,
      identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
      label, statement,
      importance: { tier: 'supporting' as const, signals: ['model_judged' as const], confidence: 0.9 },
      provenance: [{ materialId: 'progressive-material', page: (index % 3) + 1, quote: `${label} | ${statement}`, chunkId: `c-${index % 3}` }],
      evidence: [{ materialId: 'progressive-material', page: (index % 3) + 1, derivation: 'native_text' as const, quote: `${label} | ${statement}`, chunkId: `c-${index % 3}` }],
      domainTags: [],
    }
  })
  return {
    scope: source,
    meta: { version: '1', builderVersion: '2.2.0', generatedAt: '2026-01-01T00:00:00.000Z',
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 3 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'complete' },
    knowledgeExtraction: { chunksAttempted: 3, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length,
      unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  }
}

function adversarialGenerator(counter: { calls: number }, failAfter = Number.POSITIVE_INFINITY): GenerateQuizBatchFn {
  return async (plans, _language, attemptControl) => {
    counter.calls++
    attemptControl?.beforeProviderAttempt()
    if (counter.calls > failAfter) throw new Error('injected_provider_failure')
    return plans.map(plan => ({
      planId: plan.planId,
      id: 'provider-duplicate-id',
      type: 'multiple_choice',
      question: `Pregunta superficial válida y única para ${plan.planId}`,
      explanation: plan.units[0]?.statement || 'Explicación respaldada.',
      options: ['Respuesta hostil', 'Distractor uno', 'Distractor dos', 'Distractor tres'],
      correctAnswer: 3,
      difficulty: 'easy',
    }))
  }
}

async function main() {
  const brain = fixtureBrain()
  const config = normalizeQuizConfig({ questionCount: 12, difficulty: 'hard', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const calls = { calls: 0 }
  const generateBatch = adversarialGenerator(calls)
  const first = await getOrBuildQuizGeneration('progressive-session', brain, config, store, {
    mode: 'new', allocationSeed: 'progressive-seed-a', generateBatch, batchSize: 5,
  })

  // PROG-1..4: the global plan and final order are durable before/alongside the
  // first playable prefix, and every exposed item passes the partial decoder.
  assert.equal(first.manifest.presentedOrder.length, 12)
  assert.equal(Object.keys(first.manifest.slots).length, 12)
  assert.equal(first.status, 'generating')
  assert.equal(first.artifact.questions.length, 5)
  const partialValidation = decodePartialQuizArtifact(first.artifact, {
    sessionId: 'progressive-session', brain, config, configFingerprint: first.manifest.configFingerprint,
  })
  assert.equal(partialValidation.ok, true)
  if (partialValidation.ok) assert.deepEqual(partialValidation.artifact.questions, first.artifact.questions)
  const frozenOrder = [...first.manifest.presentedOrder]
  const firstQuestionSnapshot = JSON.stringify(first.artifact.questions[0])

  // PROG-5..9, 18..20: advances are monotonic, preserve frozen slots,
  // planner-owned difficulty/authority, deterministic presentation and dedupe.
  let current = first
  let previousReady = first.artifact.questions.length
  while (current.status === 'generating') {
    current = await advanceQuizGeneration('progressive-session', brain, config, store, {
      generationId: first.manifest.generationId, generateBatch, batchSize: 5,
    })
    assert.ok(current.artifact.questions.length >= previousReady)
    previousReady = current.artifact.questions.length
  }
  assert.equal(current.status, 'ready')
  assert.equal(current.artifact.questions.length, 12)
  assert.deepEqual(current.manifest.presentedOrder, frozenOrder)
  assert.ok(current.artifact.questions.every(question => question.type === 'multiple_choice' && question.difficulty === 'hard'))
  assert.equal(new Set(current.artifact.questions.map(question => question.id)).size, 12)
  assert.equal(new Set(current.artifact.questions.map(question => question.question)).size, 12)
  assert.equal(new Set(current.artifact.questions.map(question => question.grounding.slotId)).size, 12)
  assert.equal(new Set(current.artifact.questions.map(question => question.grounding.assessmentSemanticIdentity)).size, 12)
  for (const question of current.artifact.questions) {
    assert.equal(
      question.options?.[Number(question.correctAnswer)],
      question.grounding.answerTarget.kind === 'single_text' ? question.grounding.answerTarget.canonicalValue : '',
      'provider-owned answer must be overwritten',
    )
    assert.equal(question.difficulty, 'hard', 'provider-owned difficulty must be overwritten')
    assert.ok(question.grounding.answerTarget)
    assert.ok(question.grounding.groundingTarget.evidenceBackedAssertionIds.length > 0)
  }

  // PROG-10, 16, 17, 21: resume is a pure durable hit and the final artifact
  // remains accepted by the strict legacy-ready decoder.
  const callsAtReady = calls.calls
  const resumed = await getOrBuildQuizGeneration('progressive-session', brain, config, store, {
    mode: 'resume', generationId: first.manifest.generationId, generateBatch, batchSize: 5,
  })
  assert.equal(resumed.cacheStatus, 'hit')
  assert.equal(calls.calls, callsAtReady)
  assert.equal(JSON.stringify(resumed.artifact.questions[0]), firstQuestionSnapshot)
  assert.equal(decodePersistedQuizArtifact(resumed.artifact, {
    sessionId: 'progressive-session', brain, config, configFingerprint: resumed.manifest.configFingerprint,
  }).ok, true)

  // PROG-12: same-isolate concurrent advances share one in-flight operation;
  // merge-by-slot prevents duplicate/lost assignments.
  const concurrentStore = new InMemoryQuizArtifactStore()
  const concurrentCalls = { calls: 0 }
  const concurrentGenerate = adversarialGenerator(concurrentCalls)
  const concurrentFirst = await getOrBuildQuizGeneration('concurrent-session', brain, config, concurrentStore, {
    mode: 'new', generateBatch: concurrentGenerate, batchSize: 5,
  })
  const [advanceA, advanceB] = await Promise.all([
    advanceQuizGeneration('concurrent-session', brain, config, concurrentStore, {
      generationId: concurrentFirst.manifest.generationId, generateBatch: concurrentGenerate, batchSize: 5,
    }),
    advanceQuizGeneration('concurrent-session', brain, config, concurrentStore, {
      generationId: concurrentFirst.manifest.generationId, generateBatch: concurrentGenerate, batchSize: 5,
    }),
  ])
  assert.deepEqual(advanceA.artifact.questions.map(q => q.id), advanceB.artifact.questions.map(q => q.id))
  assert.equal(new Set(advanceA.artifact.questions.map(q => q.grounding.slotId)).size, advanceA.artifact.questions.length)

  // PROG-13/14: a later provider failure cannot erase or mutate ready siblings.
  const failureStore = new InMemoryQuizArtifactStore()
  const failureCalls = { calls: 0 }
  const failureFirst = await getOrBuildQuizGeneration('failure-session', brain, config, failureStore, {
    mode: 'new', generateBatch: adversarialGenerator(failureCalls, 1), batchSize: 5,
  })
  const readyBeforeFailure = failureFirst.artifact.questions.map(q => [q.grounding.slotId, q.id] as const)
  await advanceQuizGeneration('failure-session', brain, config, failureStore, {
    generationId: failureFirst.manifest.generationId,
    generateBatch: adversarialGenerator(failureCalls, 1), batchSize: 5,
  }).catch(() => undefined)
  const persistedAfterFailure = await failureStore.get(failureFirst.manifest.identity)
  assert.deepEqual(persistedAfterFailure?.questions.map(q => [q.grounding.slotId, q.id] as const), readyBeforeFailure)

  // PROG-15: NEW always owns an independent generation identity/manifest.
  const secondNew = await getOrBuildQuizGeneration('progressive-session', brain, config, store, {
    mode: 'new', allocationSeed: 'progressive-seed-b', generateBatch, batchSize: 5,
  })
  assert.notEqual(secondNew.manifest.generationId, first.manifest.generationId)
  assert.notEqual(secondNew.manifest.identity, first.manifest.identity)

  // PROG-22: a quiz no larger than the initial progressive batch is ready on
  // the first request and requires no advance round trip.
  const smallConfig = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const smallCalls = { calls: 0 }
  const small = await getOrBuildQuizGeneration('small-session', brain, smallConfig, new InMemoryQuizArtifactStore(), {
    mode: 'new', generateBatch: adversarialGenerator(smallCalls), batchSize: 5,
  })
  assert.equal(small.status, 'ready')
  assert.equal(small.artifact.questions.length, 3)
  assert.equal(smallCalls.calls, 1)

  const expectedIdentity = quizArtifactIdentity('progressive-session', brain.scope.fingerprint,
    quizConfigFingerprint(config), first.manifest.generationId)
  assert.equal(first.manifest.identity, expectedIdentity)

  // PROG-2 presentation equivalence: the slot permutation frozen before Q1
  // equals the legacy whole-array question permutation for the same identity.
  const legacyPlan = planQuiz(brain, config, { generationId: first.manifest.generationId })
  const legacyRaw = await generateQuizFromPlan(brain, legacyPlan, { generateBatch, batchSize: 5 })
  assert.equal(legacyRaw.status, 'ready')
  const presentationIdentity = { brainFingerprint: brain.scope.fingerprint,
    configFingerprint: legacyPlan.configFingerprint, generationId: first.manifest.generationId }
  const legacyPresented = applyQuizPresentation(legacyRaw.questions, presentationIdentity, config)
  assert.deepEqual(
    legacyPresented.questions.map(question => question.grounding.slotId),
    computePresentedSlotOrder(legacyPlan, presentationIdentity),
  )

  // PROG-7 uses a genuinely mixed supported selection and verifies the final
  // distribution against the frozen plan rather than merely checking Exact-N.
  const mixedConfig = normalizeQuizConfig({ questionCount: 8, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'true_false'] })
  const mixedStore = new InMemoryQuizArtifactStore()
  let mixed = await getOrBuildQuizGeneration('mixed-session', brain, mixedConfig, mixedStore, {
    mode: 'new', generateBatch, batchSize: 5,
  })
  while (mixed.status === 'generating') mixed = await advanceQuizGeneration(
    'mixed-session', brain, mixedConfig, mixedStore,
    { generationId: mixed.manifest.generationId, generateBatch, batchSize: 5 },
  )
  const plannedCounts = new Map<string, number>()
  for (const question of mixed.manifest.frozenPlan.plannedQuestions) {
    plannedCounts.set(question.questionType, (plannedCounts.get(question.questionType) || 0) + 1)
  }
  const actualCounts = new Map<string, number>()
  for (const question of mixed.artifact.questions) {
    actualCounts.set(question.type, (actualCounts.get(question.type) || 0) + 1)
  }
  assert.deepEqual(actualCounts, plannedCounts)
  const activeRoute = readFileSync('app/api/alai-studyal-quizzes/route.ts', 'utf8')
  assert.ok(activeRoute.includes('startEnjoyerQuizGeneration') && activeRoute.includes('advanceEnjoyerQuizGeneration'),
    'active Quiz route must use the Enjoyer progressive start/advance path')
  assert.ok(!activeRoute.includes('getOrBuildQuizGeneration(') && !activeRoute.includes('advanceQuizGeneration('),
    'active Enjoyer path must not fall back to the Material Brain progressive engine')
  console.log('quiz-v2-progressive-contracts: PASS (PROG-1..22 consolidated, provider=mock)')
}

main().catch(error => { console.error(error); process.exit(1) })
