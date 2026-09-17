import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildEnjoyerAssessmentUniverse,
  computeEnjoyerQuizCoverage,
  enjoyerQuizArtifactIdentity,
  generateEnjoyerQuizArtifact,
  quizConfigFingerprint,
  type EnjoyerAssessmentDesign,
  type EnjoyerQuizProvider,
} from '../../lib/materialBrain/quiz/enjoyer'
import { POST, __routeDeps } from '../../app/api/alai-studyal-quizzes/route'

const selection = buildSourceSelectionSnapshot(['material-a'], { 'material-a': [1, 2, 3] })
const topics = [1, 2, 3].map(index => ({ id: `topic-${index}`, title: `Topic ${index}`, order: index }))
const blocks = Array.from({ length: 12 }, (_, index) => {
  const page = index % 3 + 1
  return {
    id: `source-${index + 1}`, kind: index === 0 ? 'formula' : index === 1 ? 'event_or_data' : 'concept',
    label: `Knowledge ${index + 1}`, summary: `Supported academic statement ${index + 1}`,
    importance: index === 11 ? 5 : 80 - index, difficulty: 'intermediate', examTypes: ['recall'],
    materialId: 'material-a', pages: [page], topicId: `topic-${page}`, globalOrder: index,
    sourceSpans: [{ page, quote: `Supported academic statement ${index + 1}` }],
  }
})
const payload = { sourceSelectionFingerprint: selection.fingerprint,
  blueprint: { sourceSelectionFingerprint: selection.fingerprint, topicsIndex: topics,
    globalOrderedAnalysis: blocks, uniqueConceptsIndex: [] } }
const universe = buildEnjoyerAssessmentUniverse(payload, selection)

function design(ideal: number): EnjoyerAssessmentDesign {
  return { fingerprint: selection.fingerprint, idealQuestionCountForFullCoverage: ideal,
    rationale: 'Density-aware mocked design', targetGroups: universe.targets.map((target, index) => ({
      id: `group-${index + 1}`, targetIds: [target.id], rationale: 'Mocked evaluable grouping',
    })) }
}
function rawQuestion(index: number, targetIndexes: number[], type: any = 'multiple_choice') {
  const targets = targetIndexes.map(i => universe.targets[i % universe.targets.length])
  const common = {
    type, question: `Unique question ${index}?`, explanation: `Supported explanation ${index}`,
    assessmentTargetIds: targets.map(target => target.id), sourceItemIds: targets.map(target => target.sourceItemId),
    sourceSpans: targets.map(target => ({ sourceItemId: target.sourceItemId,
      page: target.sourceSpans[0].page, quote: target.sourceSpans[0].quote })),
  }
  if (type === 'true_false') return { ...common, correctAnswer: true }
  if (type === 'short_answer') return { ...common, acceptedAnswers: [targets[0].content], caseInsensitive: true }
  return { ...common, options: [targets[0].content, `Distractor ${index}`], correctAnswer: 0 }
}

async function main() {
// 1, 3, 5-11, 16-18: pure Enjoyer generation, no Brain and no fixed one-target-one-question contract.
let serial = 0
const compressedProvider: EnjoyerQuizProvider = async request => {
  if (request.mode === 'design') return design(40)
  return { questions: (request.requiredSlots || []).map(slot => {
    const index = serial++
    // Nine represented targets across all three topics; repeated dense targets are legal.
    return rawQuestion(index, index === 0 ? [0, 3] : [index % 9 === 8 ? 11 : index % 9], slot.type)
  }) }
}
const compressed = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 'session-a',
  config: { questionCount: 15, difficulty: 'medium', questionTypes: ['multiple_choice', 'true_false'] },
  provider: compressedProvider, design: design(40), generationId: 'generation-compressed' })
assert.equal(compressed.questions.length, 15, 'requested=15 must return exactly 15 valid questions')
assert.ok(compressed.questions.some(question => question.grounding.sourceItemIds.length > 1), 'one question may cover related source items')
assert.ok(compressed.questions.filter(question => question.grounding.sourceItemIds.includes('source-2')).length > 1,
  'multiple questions may share one dense source item')
assert.deepEqual(new Set(compressed.questions.map(question => question.type)), new Set(['multiple_choice', 'true_false']),
  'provider chooses allowed types independent of Enjoyer kind')
assert.equal(compressed.coverage.coverageStatus, 'partial')
assert.ok(compressed.coverage.coveragePercent < 100, 'compressed coverage must not claim fake 100%')
assert.ok(compressed.coverage.topicCoverage.every(topic => topic.covered > 0), 'all topics represented under limited budget')
assert.ok(compressed.coverage.coveredTargetIds.includes('assessment:source-1'), 'formula survives without kind mapping')
assert.ok(compressed.coverage.coveredTargetIds.includes('assessment:source-12'),
  'importance is not an exclusion rule; unique low-importance knowledge remains represented')

serial = 0
const fullProvider: EnjoyerQuizProvider = async request => ({ questions: (request.requiredSlots || []).map(slot =>
  rawQuestion(serial, [serial++ % universe.targets.length], slot.type)) })
const full = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 'session-a',
  config: { questionCount: 12, difficulty: 'hard', questionTypes: ['short_answer'] },
  provider: fullProvider, design: design(10), generationId: 'generation-full' })
assert.equal(full.coverage.coverageStatus, 'complete', 'requested >= ideal can attain full target coverage')
assert.equal(full.coverage.coveragePercent, 100)
assert.ok(full.coverage.coveredTargetIds.includes('assessment:source-12'), 'low importance unique target remains coverable')

// 12-15: duplicate/unknown IDs are rejected; provider span copies are ignored in favor of canonical Enjoyer provenance.
let repairRequest: Parameters<EnjoyerQuizProvider>[0] | null = null
let badSerial = 0
const repairingProvider: EnjoyerQuizProvider = async request => {
  if (request.mode === 'generate') {
    const good = rawQuestion(badSerial++, [0])
    const duplicate = { ...rawQuestion(badSerial++, [1]), question: good.question }
    const unknown = { ...rawQuestion(badSerial++, [2]), assessmentTargetIds: ['assessment:unknown'] }
    const badSpan = { ...rawQuestion(badSerial++, [3]), sourceSpans: [{ sourceItemId: 'source-4', page: 3, quote: 'invented' }] }
    return { questions: [good, duplicate, unknown, badSpan] }
  }
  repairRequest = request
  return { questions: Array.from({ length: request.missingSlots || 0 }, (_, index) => rawQuestion(100 + index, [4 + index])) }
}
const repaired = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 'session-a',
  config: { questionCount: 4, difficulty: 'easy', questionTypes: ['multiple_choice'] },
  provider: repairingProvider, design: design(20), generationId: 'generation-repair' })
assert.equal(repaired.questions.length, 4)
assert.equal(repaired.questions[0].question, 'Unique question 0?', 'valid question is preserved during repair')
assert.ok(repairRequest && repairRequest.mode === 'repair' && repairRequest.missingSlots === 2)
assert.ok(repaired.questions.every(question => question.grounding.evidence.every(evidence => evidence.quote.startsWith('Supported academic statement'))),
  'canonical provenance is derived from Enjoyer rather than trusting provider-supplied span copies')
assert.equal(repaired.meta.repairAttempts, 1)

// 2 + 19: exact fingerprint and selected-page authority fail closed.
assert.throws(() => buildEnjoyerAssessmentUniverse({ ...payload,
  blueprint: { ...payload.blueprint, sourceSelectionFingerprint: 'wrong' } }, selection), /SOURCE_SELECTION_MISMATCH/)
const leaked = { ...payload, blueprint: { ...payload.blueprint,
  globalOrderedAnalysis: [{ ...blocks[0], pages: [99], sourceSpans: [{ page: 99, quote: blocks[0].summary }] }] } }
assert.throws(() => buildEnjoyerAssessmentUniverse(leaked, selection), /SOURCE_SELECTION_MISMATCH/)

// 4: a valid Enjoyer artifact lookup returns with zero generation/design provider calls.
const original = { ...__routeDeps }
let providerCalls = 0
const artifactIdentity = enjoyerQuizArtifactIdentity('session-a', selection.fingerprint,
  quizConfigFingerprint(full.config), full.meta.generationId)
Object.assign(__routeDeps as any, {
  getServerSession: async () => ({ user: { id: 'user-a' } }),
  getAuthoritativeFreeSession: async () => ({ id: 'session-a', sourceSelection: selection }),
  getMaterial: async () => ({ id: 'material-a' }),
  lookupEnjoyer: async () => payload,
  getOrCreateDesign: async () => { providerCalls++; throw new Error('must not run') },
  generateArtifact: async () => { providerCalls++; throw new Error('must not run') },
  createStore: () => ({ get: async (identity: string) => identity === artifactIdentity ? full : null, save: async () => {} }),
})
const lookupResponse = await POST(new NextRequest('http://localhost/api/alai-studyal-quizzes', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'lookup',
    sessionId: 'session-a', sourceSelectionFingerprint: selection.fingerprint, generationId: full.meta.generationId,
    config: full.config }),
}))
assert.equal(lookupResponse.status, 200)
assert.equal(providerCalls, 0)
Object.assign(__routeDeps as any, original)

// 20: active route has no Material Brain endpoint/store/readiness/KnowledgeUnit dependency.
const routeSource = readFileSync('app/api/alai-studyal-quizzes/route.ts', 'utf8')
const pageSource = readFileSync('app/materias/page.tsx', 'utf8')
assert.ok(!routeSource.includes('WorkerMaterialResultStore') && !routeSource.includes('MaterialBrain')
  && !routeSource.includes('restoreMaterialBrain') && !routeSource.includes('resolveMaterialCapabilities'))
const openQuiz = pageSource.slice(pageSource.indexOf('onOpenQuiz='), pageSource.indexOf('onOpenRepasar='))
assert.ok(!openQuiz.includes('setBrainSourceSelection'))

// Direct coverage identity remains target-based and honest.
const emptyCoverage = computeEnjoyerQuizCoverage(universe, [], 3, 40)
assert.equal(emptyCoverage.coverageStatus, 'failed')
assert.equal(emptyCoverage.coveragePercent, 0)

console.log('enjoyer-quiz-migration-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
