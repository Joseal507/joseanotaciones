import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  calculateGlobalLearningAssessmentCoverage,
  migrateJourneySessionKinds,
  resolveSessionKind,
  shouldEvaluateSession,
  validateSessionEvaluationForKind,
} from '../../lib/adaptive/sessionKind'
import { canonicalizeGeneratedSession } from '../../lib/adaptive/evaluation/sessionEvaluation'

const steps = [
  { id: 'step_1', type: 'concept', title: 'A', content: 'Contenido evaluable suficiente.', keyPoints: ['kp-a'], importance: 'important' as const, relatedBlockIds: [] },
  { id: 'step_2', type: 'concept', title: 'B', content: 'Otro contenido evaluable suficiente.', keyPoints: ['kp-b'], importance: 'important' as const, relatedBlockIds: [] },
]
const question = (stepId: string, keyPoint: string) => ({
  id: `q-${stepId}`, conceptId: stepId, conceptLabel: stepId, teachingBlockId: stepId,
  format: 'true_false' as const, variant: 'true_false_factual' as const,
  targetDimension: 'recognition' as const, difficulty: 'easy' as const,
  questionText: `¿Es correcto ${keyPoint}?`, options: [], correctAnswer: true,
  explanation: keyPoint, factKey: keyPoint, factKeys: [keyPoint], targetObjectiveIds: [`o-${stepId}`],
  evidenceProduced: [`o-${stepId}`], coveredStepIds: [stepId], coveredKeyPoints: [keyPoint],
})
const block = {
  id: 'block-1', afterStepId: 'step_1', coveredStepIds: ['step_1'], coveredKeyPoints: ['kp-a'],
  questions: [question('step_1', 'kp-a')],
}

const nonEvaluatedRaw = {
  steps: Array.from({ length: 4 }, (_, index) => ({
    id: `step_${index + 1}`,
    type: 'concept',
    title: `Paso ${index + 1}`,
    content: `Contenido docente válido para el paso ${index + 1}.`,
    keyPoints: [`kp-${index + 1}`],
    importance: 'important',
  })),
  evaluationBlocks: [],
}
assert.ok(canonicalizeGeneratedSession(nonEvaluatedRaw, {
  sessionId: 'chapter_intro', kind: 'introduction', evaluationMode: 'quick_test',
}).session)
assert.ok(canonicalizeGeneratedSession(nonEvaluatedRaw, {
  sessionId: 'chapter_final', kind: 'final_review', evaluationMode: 'quick_test',
}).session)

assert.equal(resolveSessionKind({ kind: 'introduction' }).kind, 'introduction')
assert.equal(resolveSessionKind({ kind: 'learning' }).kind, 'learning')
assert.equal(resolveSessionKind({ kind: 'final_review' }).kind, 'final_review')
assert.equal(shouldEvaluateSession('introduction'), false)
assert.equal(shouldEvaluateSession('learning'), true)
assert.equal(shouldEvaluateSession('final_review'), false)

assert.equal(validateSessionEvaluationForKind({ sessionId: 'intro', kind: 'introduction', steps, evaluationBlocks: [] }, 'quick_test').valid, true)
assert.equal(validateSessionEvaluationForKind({ sessionId: 'final', kind: 'final_review', steps, evaluationBlocks: [] }, 'quick_test').valid, true)
const learningMissing = validateSessionEvaluationForKind({ sessionId: 'learn', kind: 'learning', steps, evaluationBlocks: [] }, 'quick_test')
assert.equal(learningMissing.valid, false)
assert.ok(learningMissing.errors.some(error => error.includes('sessionId=learn') && error.includes('kind=learning')))
assert.equal(validateSessionEvaluationForKind({ sessionId: 'intro', kind: 'introduction', steps, evaluationBlocks: [block] }, 'quick_test').valid, false)
assert.equal(validateSessionEvaluationForKind({ sessionId: 'final', kind: 'final_review', steps, evaluationBlocks: [block] }, 'quick_test').valid, false)

assert.equal(calculateGlobalLearningAssessmentCoverage([
  { sessionId: 'intro', kind: 'introduction', taughtKeyPoints: ['intro-a', 'intro-b'], assessedKeyPoints: [] },
  { sessionId: 'learn', kind: 'learning', taughtKeyPoints: ['kp-a'], assessedKeyPoints: ['kp-a'] },
  { sessionId: 'final', kind: 'final_review', taughtKeyPoints: ['review-a'], assessedKeyPoints: [] },
]).coverageRatio, 1)
assert.equal(calculateGlobalLearningAssessmentCoverage([
  { sessionId: 'learn-a', kind: 'learning', taughtKeyPoints: ['a'], assessedKeyPoints: ['a'] },
  { sessionId: 'learn-b', kind: 'learning', taughtKeyPoints: ['b'], assessedKeyPoints: [] },
]).coverageRatio, 0.5)

const telemetry: Array<{ event: string; payload: Record<string, unknown> }> = []
const migrated = migrateJourneySessionKinds({ id: 'plan-legacy', chapters: [
  { id: 'c-intro', type: 'intro', arcRole: 'orientation', chapterNumber: 1 },
  { id: 'c-learning', type: 'learning', arcRole: 'mechanism', chapterNumber: 2, blockIds: ['b1'] },
  { id: 'c-final', type: 'final_review', arcRole: 'final_review', chapterNumber: 3 },
] }, (event, payload) => telemetry.push({ event, payload }), { materialId: 'mat-1' })
assert.deepEqual(migrated.journey.chapters.map(chapter => chapter.kind), ['introduction', 'learning', 'final_review'])
assert.equal(migrated.migrated, true)
assert.equal(telemetry.filter(entry => entry.event === 'legacy_session_kind_migrated').length, 3)
assert.throws(() => migrateJourneySessionKinds({ id: 'ambiguous', chapters: [{ id: 'unknown', chapterNumber: 4 }] }), /LEGACY_SESSION_KIND_UNRESOLVED/)

const page = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')
assert.match(page, /shouldEvaluateSession\(resolvedKind\)/)
assert.doesNotMatch(page, /chapter\.type\s*!==\s*["']intro["']/)
assert.doesNotMatch(page, /sessionType:\s*chapter\.type/)
assert.match(page, /sessionKind:\s*SessionKind/)

const route = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
assert.match(route, /validateSessionEvaluationForKind/)
assert.doesNotMatch(route, /body\.sessionType/)

console.log('adaptive-session-kind-contracts: 15 contracts PASS')
