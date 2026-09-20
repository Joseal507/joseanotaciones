import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { POST, __routeDeps, gradeObjectiveQuestion } from '../../app/api/alai-studyal-exam/route'
import { examGradingFailureMessage } from '../../components/materias/ALAIStudyALExams'
import {
  InMemoryExamGenerationStore,
  examGenerationIdentity,
  EXAM_MANIFEST_SCHEMA_VERSION,
  type ExamResultRecord,
} from '../../lib/materialBrain/examGenerationStore'
import {
  MemoryExamGradingStore,
  gradingIdentity,
  type ExamGradingJob,
  type ExamGradingStore,
} from '../../lib/materialBrain/examGrading'
import { EXAM_ENJOYER_AUTHORITY_TYPE } from '../../lib/materialBrain/examEnjoyerContext'

const userId = 'exam-p0-user'
const fingerprint = 'exam-p0-fingerprint'

function fixture(sessionId: string, examId: string) {
  const criteria = [
    ['c-exact', 'deterministic', 'Exact option'],
    ['c-wrong', 'deterministic', 'Incorrect closed answer'],
    ['c-numeric', 'deterministic', 'Numeric equivalence'],
    ['c-academic', 'deterministic', 'Academic equivalence'],
    ['c-semantic', 'semantic', 'Semantic explanation'],
  ].map(([criterionId, gradingMode, label], index) => ({
    criterionId, targetIds: [`t-${index}`], operation: gradingMode === 'semantic' ? 'explain' : 'recall',
    canonicalCriterion: label, gradingMode, points: 1, skill: gradingMode === 'semantic' ? 'explanation' : 'retention',
    label, sourceItemId: `source-${index}`, materialId: 'material-a', pages: [1],
  }))
  const questions: any[] = [
    { id: 'q-exact', type: 'multiple_choice', options: ['A', 'B'], correctAnswer: 0 },
    { id: 'q-wrong', type: 'true_false', correctAnswer: true },
    { id: 'q-numeric', type: 'multiple_choice', options: ['4.2 × 10^-3 M', '10^-2.38 M'], correctAnswer: 0 },
    { id: 'q-academic', type: 'fill_blank', expectedAnswer: '1s² 2s²' },
    { id: 'q-semantic', type: 'short_answer', expectedAnswer: 'A catalyst changes rate, not equilibrium.' },
  ].map((question, index) => ({
    ...question, slotId: `slot-${index}`, section: 'Chemistry', prompt: `Question ${index}`,
    points: 1, skill: criteria[index].skill, difficulty: 'medium', assessmentCriteria: [criteria[index]],
    sourceMaterial: 'material-a', sourcePages: [1],
  }))
  const slots = questions.map((question, index) => ({
    id: question.slotId, type: question.type, skill: question.skill, difficulty: 'medium',
    sourceItemIds: [criteria[index].sourceItemId], primaryTargetId: criteria[index].targetIds[0],
    assessedTargetIds: criteria[index].targetIds, contextTargetIds: [], assessmentFocus: criteria[index].label,
    cognitiveOperation: criteria[index].operation, assessmentCriteria: [criteria[index]],
    answerAuthority: { kind: 'single_text', canonicalValue: criteria[index].canonicalCriterion },
    frozenSources: [{ sourceItemId: criteria[index].sourceItemId, materialId: 'material-a', pages: [1], content: `Canonical source ${index}` }],
  }))
  const identity = examGenerationIdentity(sessionId, fingerprint, examId)
  const blueprint: any = {
    authorityType: EXAM_ENJOYER_AUTHORITY_TYPE, fingerprint, materialLanguage: 'en', slots,
    coverage: { coveragePercent: 100 },
    targetUniverse: criteria.map((criterion, index) => ({ targetId: criterion.targetIds[0], label: criterion.label, pages: [1], canonicalRequirement: criterion.canonicalCriterion })),
  }
  return { identity, blueprint, questions, answers: [0, false, 1, '1s^2 2s^2', 'English. Español: reacción. 中文：催化剂不改变平衡。'] }
}

async function install(sessionId: string, examId: string, options: {
  gradingStore?: ExamGradingStore
  examStore?: InMemoryExamGenerationStore<any>
  grade: (input: any) => Promise<unknown>
}) {
  const built = fixture(sessionId, examId)
  const examStore = options.examStore || new InMemoryExamGenerationStore<any>()
  const now = new Date().toISOString()
  await examStore.saveManifest(built.identity, {
    schemaVersion: EXAM_MANIFEST_SCHEMA_VERSION, identity: built.identity, sessionId, fingerprint, examId,
    blueprint: built.blueprint, totalSlots: built.questions.length, status: 'ready',
    slots: Object.fromEntries(built.questions.map(question => [question.slotId, { status: 'ready', attempts: 1, questionId: question.id }])),
    providerAttemptsBudget: 10, providerAttemptsUsed: 1, createdAt: now, updatedAt: now,
  })
  await examStore.saveArtifact(built.identity, {
    examId, fingerprint, meta: { status: 'ready', generatedAt: now }, questions: built.questions,
  })
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: userId } }),
    getAuthoritativeFreeSession: async () => ({ id: sessionId, userId, processMode: 'free', sourceSelection: { fingerprint, materialIds: ['material-a'], selectedPages: { 'material-a': [1] } } }),
    getMaterial: async () => ({ id: 'material-a', nombre: 'Material A' }),
    gradingStore: options.gradingStore || new MemoryExamGradingStore(),
    examStore,
    generateValidatedLegacyJson: options.grade,
  })
  const post = async (answers = built.answers) => {
    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'evaluate', sessionId, examId, answers, confidences: answers.map(() => 'high') }),
    }))
    return { status: response.status, data: await response.json() }
  }
  return { ...built, examStore, post }
}

function goodJudgments(prompt: string) {
  const batch = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1))
  return { judgments: batch.map((item: any) => ({
    criterionId: item.criterion.criterionId, scorePercent: 100, status: 'correct', feedback: 'Equivalent and grounded.',
  })) }
}

async function main() {
  assert.equal(gradeObjectiveQuestion({ type: 'multiple_choice', options: ['A', 'B'], correctAnswer: 0 } as any, 0), true)
  assert.equal(gradeObjectiveQuestion({ type: 'multiple_choice', options: ['A', 'B'], correctAnswer: 0 } as any, 1), false)
  assert.equal(gradeObjectiveQuestion({ type: 'multiple_choice', options: ['4.2 × 10^-3 M', '10^-2.38 M'], correctAnswer: 0 } as any, 1), true)
  assert.equal(gradeObjectiveQuestion({ type: 'fill_blank', expectedAnswer: '1s² 2s²' } as any, '1s^2 2s^2'), true)

  let normalCalls = 0
  let semanticAnswer = ''
  const normal = await install('p0-normal-session', 'p0-normal-exam', { grade: async ({ prompt, beforeProviderAttempt, validate }: any) => {
    await beforeProviderAttempt(); normalCalls++
    const batch = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1))
    semanticAnswer = batch[0].answer
    const value = goodJudgments(prompt)
    assert.equal(validate(value).valid, true)
    return value
  } })
  const normalResult = await normal.post()
  assert.equal(normalResult.status, 200)
  assert.equal(normalResult.data.evaluation.score, 80)
  assert.equal(normalResult.data.evaluation.perQuestion[0].gradedBy, 'deterministic')
  assert.equal(normalResult.data.evaluation.perQuestion[1].correct, false)
  assert.equal(normalResult.data.evaluation.perQuestion[2].correct, true)
  assert.equal(normalResult.data.evaluation.perQuestion[3].correct, true)
  assert.equal(normalResult.data.evaluation.perQuestion[4].correct, true)
  assert.equal(normalCalls, 1)
  assert.equal(semanticAnswer, normal.answers[4], 'EN/ES/ZH/Unicode answer must reach semantic grading intact')

  let transportCalls = 0
  const repairedTransport = await install('p0-transport-session', 'p0-transport-exam', { grade: async ({ prompt, beforeProviderAttempt }: any) => {
    await beforeProviderAttempt(); transportCalls++
    try { throw new Error('503 Service Unavailable') } catch {}
    await beforeProviderAttempt(); transportCalls++
    return goodJudgments(prompt)
  } })
  assert.equal((await repairedTransport.post()).status, 200)
  assert.equal(transportCalls, 2, 'first provider failure must use exactly one bounded retry')

  let malformedCalls = 0
  const repairedMalformed = await install('p0-malformed-session', 'p0-malformed-exam', { grade: async ({ prompt, beforeProviderAttempt, validate }: any) => {
    await beforeProviderAttempt(); malformedCalls++
    assert.equal(validate({ judgments: [{ criterionId: 'c-semantic', scorePercent: '100', status: 'correct', feedback: 'bad' }] }).valid, false)
    await beforeProviderAttempt(); malformedCalls++
    const repaired = goodJudgments(prompt)
    assert.equal(validate(repaired).valid, true)
    return repaired
  } })
  assert.equal((await repairedMalformed.post()).status, 200)
  assert.equal(malformedCalls, 2, 'malformed semantic output must enter one repair attempt')

  const outageStore = new MemoryExamGradingStore()
  let outageCalls = 0
  const outage = await install('p0-outage-session', 'p0-outage-exam', { gradingStore: outageStore, grade: async ({ beforeProviderAttempt }: any) => {
    await beforeProviderAttempt(); outageCalls++
    await beforeProviderAttempt(); outageCalls++
    throw new Error('503 Service Unavailable')
  } })
  const unavailable = await outage.post()
  assert.equal(unavailable.status, 409)
  assert.equal(unavailable.data.partialEvaluation.score, null)
  assert.equal(unavailable.data.partialEvaluation.canContinue, false)
  const durable = (await outageStore.read(gradingIdentity(userId, outage.identity)))!.job
  assert.equal(durable.work[0].answer, outage.answers[4])
  assert.equal(durable.results['c-semantic'], undefined, 'provider failure must never fabricate an incorrect grade')
  assert.equal(durable.results['c-exact'].status, 'correct')
  assert.equal(durable.results['c-wrong'].status, 'incorrect')
  assert.ok(!examGradingFailureMessage(unavailable.data).includes('SEMANTIC_GRADING_RETRYABLE'))
  assert.ok(!examGradingFailureMessage(unavailable.data).includes('grading_incomplete'))

  __routeDeps.generateValidatedLegacyJson = async ({ prompt, beforeProviderAttempt }: any) => {
    await beforeProviderAttempt(); outageCalls++
    return goodJudgments(prompt)
  }
  const recovered = await outage.post()
  assert.equal(recovered.status, 200)
  assert.equal(recovered.data.evaluation.score, 80)
  assert.equal(outageCalls, 3, 'later retry must resume the frozen exam with one new provider call')
  const completedCalls = outageCalls
  assert.equal((await outage.post()).status, 200)
  assert.equal(outageCalls, completedCalls, 'completed grading replay must make zero provider calls')
  assert.equal((await outage.post([...outage.answers.slice(0, 4), 'different submission'])).status, 409)
  assert.equal(outageCalls, completedCalls)

  let concurrentCalls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const concurrent = await install('p0-concurrent-session', 'p0-concurrent-exam', { grade: async ({ prompt, beforeProviderAttempt }: any) => {
    await beforeProviderAttempt(); concurrentCalls++
    await gate
    return goodJudgments(prompt)
  } })
  const requestA = concurrent.post()
  const requestB = concurrent.post()
  while (concurrentCalls === 0) await new Promise(resolve => setTimeout(resolve, 1))
  release()
  const [responseA, responseB] = await Promise.all([requestA, requestB])
  assert.equal(responseA.status, 200)
  assert.equal(responseB.status, 200)
  assert.equal(concurrentCalls, 1, 'duplicate/concurrent Grade must share one semantic progression')

  let beforeProviderCalls = 0
  const failBeforeStore: ExamGradingStore = {
    read: async () => null,
    cas: async () => { throw new Error('EXAM_GRADING_PERSISTENCE_FAILED') },
  }
  const failBefore = await install('p0-before-persist-session', 'p0-before-persist-exam', { gradingStore: failBeforeStore, grade: async () => {
    beforeProviderCalls++
    return {}
  } })
  assert.equal((await failBefore.post()).status, 500)
  assert.equal(beforeProviderCalls, 0, 'persistence must succeed before provider work')
  assert.deepEqual(failBefore.answers, fixture('p0-before-persist-session', 'p0-before-persist-exam').answers)

  class FailOnceResultStore extends InMemoryExamGenerationStore<any> {
    failures = 1
    async saveResult(identity: string, record: ExamResultRecord) {
      if (this.failures-- > 0) throw new Error('EXAM_RESULT_SAVE_FAILED')
      return super.saveResult(identity, record)
    }
  }
  const failAfterExamStore = new FailOnceResultStore()
  let afterProviderCalls = 0
  const failAfter = await install('p0-after-persist-session', 'p0-after-persist-exam', { examStore: failAfterExamStore, grade: async ({ prompt, beforeProviderAttempt }: any) => {
    await beforeProviderAttempt(); afterProviderCalls++
    return goodJudgments(prompt)
  } })
  assert.equal((await failAfter.post()).status, 500)
  assert.equal(afterProviderCalls, 1)
  assert.equal((await failAfter.post()).status, 200)
  assert.equal(afterProviderCalls, 1, 'retry after final-result persistence failure must reuse completed grading')

  const ui = readFileSync('components/materias/ALAIStudyALExams.tsx', 'utf8')
  assert.ok(!ui.includes('new Error(data.error)'))
  assert.ok(ui.includes('pendingCriteria < previousPendingCriteria'))
  assert.ok(ui.includes('pendingSubmissionAnswers: finals'))
  for (const internal of ['SEMANTIC_GRADING_RETRYABLE', 'grading_incomplete', 'EXAM_GRADING_PERSISTENCE_FAILED']) {
    assert.ok(!examGradingFailureMessage({ error: internal, retryable: internal === 'SEMANTIC_GRADING_RETRYABLE', partialEvaluation: internal === 'grading_incomplete' ? { gradingStatus: internal } : undefined }).includes(internal))
  }

  console.log('exam-grading-p0-recovery-contracts: A-O PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
