import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  beginRecoveryReteach,
  beginRecoveryVerification,
  createRecoveryQueue,
  persistRecoveryVerificationQuestions,
  presentRecoveryVerificationQuestion,
  recordRecoveryCheck,
  recordRecoveryReteachContent,
  REQUIRED_INDEPENDENT_RECOVERY_CHECKS,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

const question = (id: string, family: string): CanonicalQuestion => ({
  id, conceptId: 'micro-1', conceptLabel: 'Objetivo exacto', teachingBlockId: 'step_1',
  questionFamily: family, variant: 'mcq_best_answer', format: 'multiple_choice',
  difficulty: 'medium', targetDimension: 'comprehension', questionText: family.endsWith('-a')
    ? `Selecciona la consecuencia que demuestra el objetivo ${id}`
    : family.endsWith('-b')
      ? `Distingue el contraejemplo incompatible con el objetivo ${id}`
      : `Pregunta fuente ${id}`,
  options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswer: 'a',
  explanation: 'Explicación específica', hint: 'Pista', estimatedSeconds: 20,
  evidencesNeeded: 1, factKey: 'fact-1', factKeys: ['fact-1'],
  targetObjectiveIds: ['objective-1'],
  coveredStepIds: ['step_1'], coveredKeyPoints: ['Punto exacto'],
} as CanonicalQuestion)

assert.equal(REQUIRED_INDEPENDENT_RECOVERY_CHECKS, 2)

let item = createRecoveryQueue([{
  question: question('source', 'source-family'), answer: 'b',
  result: { outcome: 'incorrect', correct: false, errorType: 'conceptual' },
}])[0]

for (let round = 1; round <= 20; round += 1) {
  item = beginRecoveryReteach(item, `strategy-${round}`)
  item = recordRecoveryReteachContent(item, `Reexplicación específica nueva ${round}`)
  item = beginRecoveryVerification(item)
  item = persistRecoveryVerificationQuestions(item, [
    question(`round-${round}-v1`, `deterministic_recovery_${round}-a`),
    question(`round-${round}-v2`, `deterministic_recovery_${round}-b`),
  ])
  let presented = presentRecoveryVerificationQuestion(item)
  assert.ok(presented.question)
  item = recordRecoveryCheck(presented.item, presented.question!, { outcome: 'correct', correct: true }).item
  assert.notEqual(item.status, 'resolved', 'V1 correcta nunca resuelve la ronda')
  presented = presentRecoveryVerificationQuestion(item)
  assert.ok(presented.question)
  item = recordRecoveryCheck(presented.item, presented.question!, { outcome: 'incorrect', correct: false }, 'independent', 'b').item
  assert.equal(item.status, 'pending_reteach', 'V2 incorrecta reinicia toda la ronda')
  assert.equal(item.successfulIndependentChecks, 1, 'el crédito parcial queda histórico, no resuelve')
}
assert.equal(item.totalStudentFailureRounds, 20)
assert.equal(item.status, 'pending_reteach')

const teach = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
assert.doesNotMatch(teach, /NO incluyas evaluationBlocks ni preguntas/)
assert.match(teach, /const evaluationBlocks = session\.kind === 'learning'\s*\? preparedSession\.session\.evaluationBlocks/)
assert.doesNotMatch(teach.slice(teach.indexOf('export async function POST')), /nextAction:\s*["']skip_recovery["']/)
const reteach = readFileSync('app/api/adaptive/session-reteach/route.ts', 'utf8')
assert.doesNotMatch(reteach, /nextAction:\s*["']skip_recovery["']/)
assert.match(reteach, /exactamente dos|EXACTAMENTE 2/i)

console.log('adaptive-canonical-evaluation-contracts: PASS')
