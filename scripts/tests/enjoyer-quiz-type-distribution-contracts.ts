import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  advanceEnjoyerQuizGeneration,
  buildEnjoyerAssessmentUniverse,
  buildEnjoyerQuizTypePlan,
  startEnjoyerQuizGeneration,
  type EnjoyerAssessmentDesign,
  type EnjoyerQuizArtifact,
  type EnjoyerQuizGenerationManifest,
  type EnjoyerQuizProvider,
  type EnjoyerQuizStore,
} from '../../lib/materialBrain/quiz/enjoyer'
import type { QuizQuestionType } from '../../lib/types/quiz'

const ALL_TYPES: QuizQuestionType[] = [
  'multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer',
]
const selection = buildSourceSelectionSnapshot(['material-a'], { 'material-a': [1] })
const items = Array.from({ length: 40 }, (_, index) => ({
  id: `source-${index}`, kind: 'concept', label: `Term ${index}`, summary: `Supported answer ${index}`,
  importance: 50, difficulty: 'intermediate', materialId: 'material-a', pages: [1], topicId: 'topic-1',
  globalOrder: index, sourceSpans: [{ page: 1, quote: `Term ${index} Supported answer ${index}` }],
}))
const payload = { blueprint: { sourceSelectionFingerprint: selection.fingerprint,
  topicsIndex: [{ id: 'topic-1', title: 'Topic', order: 1 }], globalOrderedAnalysis: items, uniqueConceptsIndex: [] } }
const universe = buildEnjoyerAssessmentUniverse(payload, selection)
const design: EnjoyerAssessmentDesign = { fingerprint: selection.fingerprint,
  idealQuestionCountForFullCoverage: 50, rationale: 'fixture', targetGroups: universe.targets.map(target => ({
    id: `group:${target.id}`, targetIds: [target.id], rationale: 'fixture',
  })) }

class MemoryStore implements EnjoyerQuizStore {
  private artifacts = new Map<string, EnjoyerQuizArtifact>()
  private manifests = new Map<string, EnjoyerQuizGenerationManifest>()
  async get(id: string) { return this.artifacts.get(id) || null }
  async save(id: string, artifact: EnjoyerQuizArtifact) { this.artifacts.set(id, structuredClone(artifact)) }
  async getManifest(id: string) { return this.manifests.get(id) || null }
  async saveManifest(id: string, manifest: EnjoyerQuizGenerationManifest) { this.manifests.set(id, structuredClone(manifest)) }
}

function counts(types: readonly QuizQuestionType[]) {
  return types.reduce<Record<string, number>>((result, type) => {
    result[type] = (result[type] || 0) + 1
    return result
  }, {})
}

let serial = 0
function question(type: QuizQuestionType, malformed = false) {
  const index = serial++ % (universe.targets.length - 1)
  const target = universe.targets[index]
  const next = universe.targets[index + 1]
  const base = { type, question: `${type} question ${serial}?`, explanation: 'Grounded explanation',
    assessmentTargetIds: type === 'matching' ? [target.id, next.id] : [target.id] }
  if (type === 'multiple_choice') return { ...base, options: [target.content, 'Distractor'], correctAnswer: 0 }
  if (type === 'multi_select') return { ...base, options: [target.content, target.title, 'Distractor'], correctAnswers: [0, 1] }
  if (type === 'true_false') return { ...base, correctAnswer: true }
  if (type === 'fill_blank') return { ...base, question: `${base.question} _____`, answer: target.content,
    wordBank: [target.content, `Distractor A ${index}`, `Distractor B ${index}`, `Distractor C ${index}`] }
  if (type === 'matching') return malformed ? { ...base, pairs: [] } : { ...base,
    pairs: [{ left: target.title, right: target.content }, { left: next.title, right: next.content }] }
  return { ...base, acceptedAnswers: [target.content], caseInsensitive: true }
}

const providerForSlots = (onRequest?: (request: Parameters<EnjoyerQuizProvider>[0]) => void): EnjoyerQuizProvider =>
  async request => {
    onRequest?.(request)
    return { questions: (request.requiredSlots || []).map(slot => question(slot.type)) }
  }

async function main() {
  const one = buildEnjoyerQuizTypePlan({ questionCount: 8, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  assert.deepEqual(counts(one), { multiple_choice: 8 })

  const two = counts(buildEnjoyerQuizTypePlan({ questionCount: 8, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'true_false'] }))
  assert.deepEqual(two, { multiple_choice: 4, true_false: 4 })

  const three = counts(buildEnjoyerQuizTypePlan({ questionCount: 8, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'matching', 'short_answer'] }))
  assert.deepEqual(Object.values(three).sort(), [2, 3, 3])

  const six = counts(buildEnjoyerQuizTypePlan({ questionCount: 6, difficulty: 'medium', questionTypes: ALL_TYPES }))
  assert.ok(ALL_TYPES.every(type => six[type] === 1))
  const twentyFivePlan = buildEnjoyerQuizTypePlan({ questionCount: 25, difficulty: 'medium', questionTypes: ALL_TYPES })
  assert.deepEqual(Object.values(counts(twentyFivePlan)).sort(), [4, 4, 4, 4, 4, 5])

  const store = new MemoryStore()
  const initial = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'types-progressive',
    config: { questionCount: 25, difficulty: 'medium', questionTypes: ALL_TYPES }, design,
    generationId: 'types-generation', store, provider: providerForSlots() })
  assert.equal(initial.status, 'generating')
  assert.equal(initial.artifact.questions.length, 8)
  assert.deepEqual(initial.manifest.typePlan, twentyFivePlan)
  assert.deepEqual(initial.artifact.questions.map(item => item.type), twentyFivePlan.slice(0, 8))

  const partialRestore = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'types-progressive',
    config: initial.artifact.config, design, generationId: 'types-generation', store,
    provider: async () => { throw new Error('restore must not generate') } })
  assert.equal(partialRestore.cacheStatus, 'hit')
  assert.deepEqual(partialRestore.manifest.typePlan, twentyFivePlan)

  let current = initial
  while (current.status === 'generating') current = await advanceEnjoyerQuizGeneration({ universe,
    sessionId: 'types-progressive', config: initial.artifact.config, generationId: 'types-generation', store,
    provider: providerForSlots() })
  assert.equal(current.artifact.questions.length, 25)
  assert.deepEqual(counts(current.artifact.questions.map(item => item.type)), counts(twentyFivePlan))
  assert.ok(current.artifact.questions.every(item => ALL_TYPES.includes(item.type)))

  let matchingRepairSeen = false
  const repairStore = new MemoryStore()
  const repaired = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'type-repair',
    config: { questionCount: 6, difficulty: 'medium', questionTypes: ALL_TYPES }, design,
    generationId: 'type-repair-generation', store: repairStore, provider: async request => ({
      questions: (request.requiredSlots || []).map(slot => {
        if (slot.type === 'matching' && request.mode === 'generate') return question(slot.type, true)
        if (slot.type === 'matching' && request.mode === 'repair') matchingRepairSeen = true
        return question(slot.type)
      }),
    }) })
  assert.equal(repaired.status, 'ready')
  assert.equal(matchingRepairSeen, true)
  assert.ok(ALL_TYPES.every(type => counts(repaired.artifact.questions.map(item => item.type))[type] === 1))
  assert.equal(repaired.manifest.redistributedSlots, 0)

  console.log('enjoyer-quiz-type-distribution-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
