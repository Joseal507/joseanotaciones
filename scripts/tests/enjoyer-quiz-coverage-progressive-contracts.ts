import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  isCanonicalQuizWrittenAnswerCorrect,
  resolveEnjoyerQuizDisplayedTotal,
  shouldRequestEnjoyerQuizBackgroundAdvance,
} from '../../lib/quiz/enjoyerProgressiveUi'
import {
  advanceEnjoyerQuizGeneration,
  buildEnjoyerAssessmentUniverse,
  generateEnjoyerQuizArtifact,
  startEnjoyerQuizGeneration,
  type EnjoyerAssessmentDesign,
  type EnjoyerAssessmentUniverse,
  type EnjoyerQuizArtifact,
  type EnjoyerQuizGenerationManifest,
  type EnjoyerQuizProvider,
  type EnjoyerQuizStore,
} from '../../lib/materialBrain/quiz/enjoyer'

const selection = buildSourceSelectionSnapshot(['material-a'], { 'material-a': [1, 2, 3] })
const topics = [1, 2, 3].map(index => ({ id: `topic-${index}`, title: `Topic ${index}`, order: index }))
const blocks = Array.from({ length: 18 }, (_, index) => {
  const topic = Math.floor(index / 6) + 1
  return { id: `source-${index + 1}`, kind: 'concept', label: `Knowledge ${index + 1}`,
    summary: `Supported academic statement ${index + 1}`, importance: index === 17 ? 5 : 80,
    difficulty: 'intermediate', materialId: 'material-a', pages: [topic], topicId: `topic-${topic}`,
    globalOrder: index, sourceSpans: [{ page: topic, quote: `Supported academic statement ${index + 1}` }] }
})
const payload = { blueprint: { sourceSelectionFingerprint: selection.fingerprint, topicsIndex: topics,
  globalOrderedAnalysis: blocks, uniqueConceptsIndex: [] } }
const universe = buildEnjoyerAssessmentUniverse(payload, selection)
const makeDesign = (ideal: number): EnjoyerAssessmentDesign => ({ fingerprint: selection.fingerprint,
  idealQuestionCountForFullCoverage: ideal, rationale: 'fixture', targetGroups: universe.targets.map((target, index) => ({
    id: `group-${index}`, targetIds: [target.id], rationale: 'fixture',
  })) })

function rawQuestion(index: number, targetIndex: number) {
  const target = universe.targets[targetIndex % universe.targets.length]
  return { type: 'multiple_choice', question: `Question ${index}?`, explanation: `Explanation ${index}`,
    assessmentTargetIds: [target.id], sourceItemIds: [target.sourceItemId],
    sourceSpans: [{ sourceItemId: target.sourceItemId, page: target.sourceSpans[0].page, quote: target.sourceSpans[0].quote }],
    options: [target.content, `Distractor ${index}`], correctAnswer: 0 }
}

function rawQuestionOfType(index: number, targetIndex: number, type: string) {
  const target = universe.targets[targetIndex % universe.targets.length]
  const next = universe.targets[(targetIndex + 1) % universe.targets.length]
  const base = { type, question: `${type} question ${index}?`, explanation: `Explanation ${index}`,
    assessmentTargetIds: type === 'matching' ? [target.id, next.id] : [target.id] }
  if (type === 'multiple_choice') return { ...base, options: [target.content, `Distractor ${index}`], correctAnswer: 0 }
  if (type === 'multi_select') return { ...base, options: [target.content, target.title, `Distractor ${index}`], correctAnswers: [0, 1] }
  if (type === 'true_false') return { ...base, correctAnswer: true }
  if (type === 'fill_blank') return { ...base, question: `${base.question} _____`, answer: target.content,
    wordBank: [target.content, `Distractor A ${index}`, `Distractor B ${index}`, `Distractor C ${index}`] }
  if (type === 'matching') return { ...base, pairs: [
    { left: target.title, right: target.content }, { left: next.title, right: next.content },
  ] }
  return { ...base, acceptedAnswers: [target.content], caseInsensitive: true }
}

class MemoryStore implements EnjoyerQuizStore {
  constructor(private artifacts = new Map<string, EnjoyerQuizArtifact>(),
    private manifests = new Map<string, EnjoyerQuizGenerationManifest>()) {}
  async get(id: string) { return this.artifacts.get(id) || null }
  async save(id: string, value: EnjoyerQuizArtifact) { this.artifacts.set(id, structuredClone(value)) }
  async getManifest(id: string) { return this.manifests.get(id) || null }
  async saveManifest(id: string, value: EnjoyerQuizGenerationManifest) { this.manifests.set(id, structuredClone(value)) }
}

async function main() {
  // A complete compressed budget remains honestly partial. A missing topic is
  // a soft representation warning here, not permission to discard valid,
  // grounded questions through terminal provider replacement.
  let serial = 0; let coverageRepairCalls = 0
  const undercovered: EnjoyerQuizProvider = async request => {
    if (request.mode === 'repair' && request.missingSlots === 1) {
      coverageRepairCalls++
      const targetIndex = universe.targets.findIndex(target => target.id === request.focusTargetIds?.[0])
      return { questions: [rawQuestion(100 + coverageRepairCalls, targetIndex)] }
    }
    return { questions: Array.from({ length: request.missingSlots || 0 }, () => rawQuestion(serial, serial++ % 12)) }
  }
  const repaired = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 's',
    config: { questionCount: 15, difficulty: 'medium', questionTypes: ['multiple_choice'] },
    provider: undercovered, design: makeDesign(30), generationId: 'coverage-repair' })
  assert.equal(repaired.questions.length, 15)
  assert.ok(repaired.coverage.topicCoverage.some(topic => topic.covered === 0))
  assert.equal(repaired.coverage.coverageStatus, 'partial')
  assert.equal(coverageRepairCalls, 0)
  assert.equal(repaired.meta.coverageRepairAttempts, 0)
  assert.equal(repaired.meta.questionsReplacedForCoverage, 0)
  assert.ok(repaired.questions.some(question => question.question === 'Question 11?'), 'strong existing questions survive')

  // Balanced compressed output needs no repair.
  serial = 0; coverageRepairCalls = 0
  const balanced = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 's',
    config: { questionCount: 15, difficulty: 'medium', questionTypes: ['multiple_choice'] },
    provider: async request => ({ questions: Array.from({ length: request.missingSlots || 0 }, () => {
      const next = serial++; return rawQuestion(200 + next, next % 3 * 6 + Math.floor(next / 3) % 6)
    }) }), design: makeDesign(30), generationId: 'balanced' })
  assert.equal(balanced.meta.coverageRepairAttempts, 0)

  // At/above ideal, uncovered identities trigger bounded replacement and honest partial if exhausted.
  serial = 0
  const fullBudget = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 's',
    config: { questionCount: 18, difficulty: 'medium', questionTypes: ['multiple_choice'] },
    provider: async request => {
      if (request.mode === 'repair' && request.missingSlots === 1) {
        const index = universe.targets.findIndex(target => target.id === request.focusTargetIds?.[0])
        return { questions: [rawQuestion(400 + index, index)] }
      }
      return { questions: Array.from({ length: request.missingSlots || 0 }, () => rawQuestion(300 + serial, serial++ % 17)) }
    }, design: makeDesign(18), generationId: 'full-budget' })
  assert.equal(fullBudget.questions.length, 18)
  assert.equal(fullBudget.coverage.coverageStatus, 'complete')
  assert.ok(fullBudget.meta.questionsReplacedForCoverage > 0)

  serial = 0
  const exhausted = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 's',
    config: { questionCount: 18, difficulty: 'medium', questionTypes: ['multiple_choice'] },
    provider: async request => request.mode === 'repair' && request.missingSlots === 1
      ? { questions: [{ question: '' }] }
      : { questions: Array.from({ length: request.missingSlots || 0 }, () => rawQuestion(500 + serial, serial++ % 17)) },
    design: makeDesign(18), generationId: 'exhausted' })
  assert.equal(exhausted.questions.length, 18)
  assert.equal(exhausted.meta.coverageRepairAttempts, 2)
  assert.equal(exhausted.coverage.coverageStatus, 'partial')

  // Active Enjoyer progressive generation: 8-question prefix, next-only advance, durable restore.
  serial = 0
  const calls: Array<{ mode: string; missing: number }> = []
  const progressiveProvider: EnjoyerQuizProvider = async request => {
    calls.push({ mode: request.mode, missing: request.missingSlots || 0 })
    return { questions: Array.from({ length: request.missingSlots || 0 }, () => rawQuestion(600 + serial, serial++)) }
  }
  const store = new MemoryStore()
  const initial = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'progressive-session',
    config: { questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] },
    design: makeDesign(10), generationId: 'progressive-generation', store, provider: progressiveProvider })
  assert.equal(initial.status, 'generating')
  assert.equal(initial.artifact.questions.length, 8)
  assert.equal(initial.manifest.readyCount, 8)
  const previousIds = initial.artifact.questions.map(question => question.id)
  const advanced = await advanceEnjoyerQuizGeneration({ universe, sessionId: 'progressive-session',
    config: initial.artifact.config, generationId: 'progressive-generation', store, provider: progressiveProvider })
  assert.equal(advanced.status, 'ready')
  assert.equal(advanced.artifact.questions.length, 10)
  assert.deepEqual(advanced.artifact.questions.slice(0, 8).map(question => question.id), previousIds)
  assert.deepEqual(calls.slice(0, 2).map(call => call.missing), [8, 2])
  const restored = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'progressive-session',
    config: initial.artifact.config, design: makeDesign(10), generationId: 'progressive-generation', store,
    provider: async () => { throw new Error('provider must not run on restore') } })
  assert.equal(restored.cacheStatus, 'hit')
  assert.equal(restored.status, 'ready')
  await assert.rejects(() => advanceEnjoyerQuizGeneration({ universe: { ...universe, fingerprint: 'wrong' },
    sessionId: 'progressive-session', config: initial.artifact.config, generationId: 'progressive-generation', store }),
  /MANIFEST_MISSING|SOURCE_SELECTION_MISMATCH/)

  // Live regression: only three accepted in the first 8-slot attempt never collapses the 25-slot identity.
  let sparseSerial = 0
  const sparseStore = new MemoryStore()
  const sparseInitial = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'sparse-session',
    config: { questionCount: 25, difficulty: 'medium', questionTypes: [
      'multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer',
    ] },
    design: makeDesign(40), generationId: 'sparse-generation', store: sparseStore,
    provider: async request => request.mode === 'generate'
      ? { questions: (request.requiredSlots || []).slice(0, 3).map(slot =>
        rawQuestionOfType(800 + sparseSerial, sparseSerial++, slot.type)) }
      : { questions: [{ question: '' }] } })
  assert.equal(sparseInitial.status, 'generating')
  assert.equal(sparseInitial.manifest.totalSlots, 25)
  assert.equal(sparseInitial.manifest.readyCount, 3)
  assert.equal(sparseInitial.artifact.questions.length, 3)
  assert.equal(sparseInitial.manifest.rejectionCounts.wrong_required_type, 2)
  const sparsePrefix = sparseInitial.artifact.questions.map(question => question.id)
  let sparse = sparseInitial
  while (sparse.status === 'generating') {
    sparse = await advanceEnjoyerQuizGeneration({ universe, sessionId: 'sparse-session',
      config: sparseInitial.artifact.config, generationId: 'sparse-generation', store: sparseStore,
      provider: async request => ({ questions: (request.requiredSlots || []).map(slot =>
        rawQuestionOfType(900 + sparseSerial, sparseSerial++, slot.type)) }) })
  }
  assert.equal(sparse.status, 'ready')
  assert.equal(sparse.manifest.totalSlots, 25)
  assert.equal(sparse.artifact.questions.length, 25)
  assert.deepEqual(sparse.artifact.questions.slice(0, 3).map(question => question.id), sparsePrefix)

  // Normal six-type model output aligns with the canonical UI/grading payloads in one provider round.
  const target = (index: number) => universe.targets[index]
  const grounding = (...indexes: number[]) => ({
    assessmentTargetIds: indexes.map(index => index % 2 ? target(index).sourceItemId : target(index).id),
  })
  const canonicalCandidates = [
    { type: 'multiple_choice', question: 'Canonical MC?', explanation: 'Grounded', ...grounding(0),
      options: [target(0).content, 'Distractor'], correctAnswer: target(0).content },
    { type: 'multi_select', question: 'Canonical multi?', explanation: 'Grounded', ...grounding(6, 7),
      options: [target(6).content, target(7).content, 'Distractor'], correctAnswers: [target(6).content, target(7).content] },
    { type: 'true_false', question: 'Canonical true or false?', explanation: 'Grounded', ...grounding(12),
      correctAnswer: 'verdadero' },
    { type: 'fill_blank', question: 'Complete: [BLANK]', explanation: 'Grounded', ...grounding(1),
      answer: target(1).content, wordBank: [target(1).content, 'Distractor A', 'Distractor B', 'Distractor C'] },
    { type: 'matching', question: 'Canonical matching?', explanation: 'Grounded', ...grounding(8, 13),
      pairs: [{ left: target(8).title, right: target(8).content }, { left: target(13).title, right: target(13).content }] },
    { type: 'short_answer', question: 'Canonical short answer?', explanation: 'Grounded', ...grounding(14),
      answer: target(14).content, caseInsensitive: true },
    { type: 'multiple_choice', question: 'Canonical MC two?', explanation: 'Grounded', ...grounding(2),
      options: [target(2).content, 'Distractor'], correctAnswer: 0 },
    { type: 'true_false', question: 'Canonical false?', explanation: 'Grounded', ...grounding(9), correctAnswer: false },
  ]
  let canonicalProviderCalls = 0
  const canonicalStore = new MemoryStore()
  const canonical = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'canonical-session',
    config: { questionCount: 8, difficulty: 'medium', questionTypes: [
      'multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer',
    ] }, design: makeDesign(40), generationId: 'canonical-generation', store: canonicalStore,
    provider: async request => {
      canonicalProviderCalls++
      assert.equal(request.mode, 'generate', 'normal valid output must not need a repair round')
      const queues = new Map<string, any[]>()
      for (const candidate of canonicalCandidates) queues.set(candidate.type,
        [...(queues.get(candidate.type) || []), candidate])
      return { questions: (request.requiredSlots || []).map((slot, index) =>
        queues.get(slot.type)?.shift() || rawQuestionOfType(1000 + index, index + 3, slot.type)) }
    } })
  assert.equal(canonicalProviderCalls, 1)
  assert.equal(canonical.artifact.questions.length, 8)
  assert.equal(canonical.manifest.missingSlotRepairAttempts, 0)
  assert.deepEqual(canonical.manifest.rejectionCounts, {})
  assert.ok(canonical.artifact.questions.every(question => question.grounding.evidence.length > 0),
    'canonical provenance is derived from accepted authority IDs')
  assert.ok(canonical.artifact.questions.every(question => question.grounding.assessmentTargetIds.every(id => id.startsWith('assessment:'))))
  const fill = canonical.artifact.questions.find(question => question.type === 'fill_blank')!
  assert.ok(fill.question.includes('_____'), 'fill blank renders an explicit blank')
  assert.equal(isCanonicalQuizWrittenAnswerCorrect([(fill as any).answer], (fill as any).answer), true,
    'fill blank canonical answer grades locally without an evaluate request')
  const matching = canonical.artifact.questions.find(question => question.type === 'matching')!
  assert.equal((matching as any).pairs.length, 2, 'matching payload round-trips')
  const short = canonical.artifact.questions.find(question => question.type === 'short_answer')!
  assert.equal(isCanonicalQuizWrittenAnswerCorrect((short as any).acceptedAnswers, target(14).content), true,
    'short-answer payload round-trips through local grading')

  const ui = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  assert.equal(resolveEnjoyerQuizDisplayedTotal({ manifestSlots: 25, requestedCount: 25, readyQuestions: 7 }), 25)
  assert.equal(resolveEnjoyerQuizDisplayedTotal({ manifestSlots: null, requestedCount: 25, readyQuestions: 7 }), 25)
  const partialUiState = { manifestSlots: 25, requestedCount: 25, readyQuestions: 7,
    status: 'generating' as const, advanceInFlight: false }
  assert.equal(shouldRequestEnjoyerQuizBackgroundAdvance(partialUiState), true,
    '7/25 must start one background advance immediately')
  assert.equal(shouldRequestEnjoyerQuizBackgroundAdvance({ ...partialUiState, advanceInFlight: true }), false,
    'an in-flight advance prevents overlap')
  assert.equal(shouldRequestEnjoyerQuizBackgroundAdvance({ ...partialUiState, readyQuestions: 15 }), true,
    '15/25 starts the next sequential chunk after the previous call finishes')
  assert.equal(shouldRequestEnjoyerQuizBackgroundAdvance({ ...partialUiState, readyQuestions: 25, status: 'ready' }), false,
    '25/25 stops background generation')
  assert.ok(ui.includes('currentIndex + 1} de {progressiveTotalQuestions}'),
    'playable header must use the canonical displayed-total selector')
  assert.ok(ui.includes("mode: 'advance'") && ui.includes("advanceTriggerReason: 'background_fill'"),
    'partial and restored manifests must retain sequential background advance behavior')
  assert.ok(ui.includes('mode: \'evaluate\'') && ui.includes('generationId,'),
    'open-answer evaluation must carry the persisted generation identity and avoid ARTIFACT_MISS')

  console.log('enjoyer-quiz-coverage-progressive-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
