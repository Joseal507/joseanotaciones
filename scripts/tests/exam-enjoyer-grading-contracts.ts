import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { InMemoryExamGenerationStore } from '../../lib/materialBrain/examGenerationStore'
import { POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-grade' }
const enjoyer = {
  sourceSelectionFingerprint: 'fp-grade', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1] },
  topicsIndex: [{ id: 't', title: 'Tema' }],
  globalOrderedAnalysis: [{ id: 'truth', kind: 'fact', name: 'Hecho', content: 'La afirmación canónica es verdadera.', importance: 'high', difficulty: 'medium', examTypes: ['true_false'], topicId: 't', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'evidence' }] }],
  uniqueConceptsIndex: [],
}
const store = new InMemoryExamGenerationStore<any>()
let semanticGradingCalls = 0

Object.assign(__routeDeps, {
  getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
  getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any,
  getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
  lookupStudyalMaterialEnjoyer: async () => enjoyer,
  materialEnjoyerStore: {} as any,
  gradingStore: new MemoryExamGradingStore(), examStore: store,
  // Grading redesign contract (F/G): closed-type questions (true_false
  // here) are graded deterministically server-side and must NEVER
  // trigger a provider call. Only answered semantic questions would.
  generateValidatedLegacyJson: async ({ prompt, validate, telemetryContext }: any) => {
    if (telemetryContext?.phase === 'semantic_grade') {
      semanticGradingCalls++
      const value = { judgments: [], report: null }
      assert.ok(validate(value).valid)
      return value
    }
    const block = prompt.split(/\n(?=\d+\.\s+slotId=)/).find((part: string) => /^\d+\.\s+slotId=/.test(part)) || ''
    const value = [{
      slotId: block.match(/slotId=(\S+)/)?.[1], type: 'true_false',
      sourceItemIds: (block.match(/sourceItemIds=([^\n]+)/)?.[1] || '').split(',').map((v: string) => v.trim()).filter(Boolean),
      prompt: '¿La afirmación es verdadera?',
    }]
    assert.ok(validate(value).valid)
    return value
  },
})

async function post(body: unknown) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { response, data: await response.json() }
}

async function main() {
  const started = await post({ mode: 'generate', sessionId: 'sess-1', durationMinutes: 15 })
  assert.equal(started.response.status, 200)
  assert.equal(started.data.status, 'ready')
  const examId = started.data.exam.id
  const correct = await post({ mode: 'evaluate', sessionId: 'sess-1', examId, answers: [true], confidences: ['high'] })
  assert.equal(correct.response.status, 200)
  assert.equal(correct.data.evaluation.score, 100, 'provider cannot override deterministic closed grading')
  assert.equal(correct.data.evaluation.perQuestion[0].gradedBy, 'deterministic')
  assert.equal(semanticGradingCalls, 0, 'closed-only exam must trigger zero grading provider calls')

  const forged = await post({ mode: 'evaluate', sessionId: 'sess-1', examId, answers: [false], exam: { questions: [{ correctAnswer: false }] } })
  assert.equal(forged.response.status, 400)
  assert.equal(forged.data.error, 'INVALID_CONFIG')
  const raw = await post({ mode: 'evaluate', sessionId: 'sess-1', examId, answers: [true], materialText: 'forbidden' })
  assert.equal(raw.response.status, 400)

  const legacy = await post({ mode: 'evaluate', sessionId: 'sess-1', answers: [true] })
  assert.equal(legacy.response.status, 409)
  assert.equal(legacy.data.error, 'LEGACY_EXAM_INCOMPATIBLE')
  console.log('exam-enjoyer-grading-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
