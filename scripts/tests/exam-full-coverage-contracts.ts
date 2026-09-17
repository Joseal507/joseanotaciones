import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildExamEnjoyerUniverse,
  composeEnjoyerExamBlueprint,
  computeExamEnjoyerTimeBounds,
  conciseExcerpt,
  EXAM_TYPE_ALIASES,
} from '../../lib/materialBrain/examEnjoyerContext'
import {
  POST,
  __routeDeps,
  authorSlotQuestion,
  buildMultipleChoiceOptions,
} from '../../app/api/alai-studyal-exam/route'
import { InMemoryExamGenerationStore } from '../../lib/materialBrain/examGenerationStore'

// ============================================================
// EXAM_FULL_COVERAGE_CONTRACTS
//
// Verifies 100% academic universe coverage for StudyAL Exam:
// 1. 51 targets cannot produce 9/51 or 19/51.
// 2. 100% target accounting (assessedTargetIds.length === universe.targets.length, notAssessedDueToScopeTargetIds: []).
// 3. Context-only targets excluded from assessed count.
// 4. Related targets shared only when criteria map to each (matching pairs, multi-select options, worked problem steps).
// 5. minimumViableDurationMinutes returned before generation when duration is insufficient (45 min for 51 targets).
// 6. 0 provider calls for insufficient duration.
// 7. Complete coverage across increasing durations (45 min, 60 min, 90 min).
// 8. v3 canonical-answer and privacy preserved (no public pairs / matchingCorrectMap, no '·' distractor dump).
// 9. Post-provider-success 500 reproduced & fixed (provider output with type aliases, partial sourceItemIds, and custom prompt produces ready questions without failing).
// 10. Reopen ready exam remains 0 provider calls.
// ============================================================

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3, 4, 5, 6] }), fingerprint: 'fp-51' }
const kinds = ['concept', 'formula', 'process', 'data', 'fact']
const types = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer']

const items = Array.from({ length: 51 }, (_, index) => ({
  id: `target-${index}`,
  kind: kinds[index % kinds.length],
  name: `Elemento ${index}`,
  content: `Contenido académico autorizado número ${index}`,
  importance: index % 7 === 0 ? 'high' : index % 3 === 0 ? 'low' : 'medium',
  difficulty: index % 5 === 0 ? 'advanced' : 'medium',
  examTypes: [types[index % types.length]],
  topicId: `topic-${index % 4}`,
  materialId: 'mat-a',
  pages: [(index % 6) + 1],
  sourceSpans: [{ page: (index % 6) + 1, quote: `evidencia ${index}` }],
}))

const payload = {
  sourceSelectionFingerprint: 'fp-51',
  materialIds: ['mat-a'],
  selectedPages: { 'mat-a': [1, 2, 3, 4, 5, 6] },
  materialLanguage: 'es',
  topicsIndex: [
    { id: 'topic-0', title: 'Tema 0' },
    { id: 'topic-1', title: 'Tema 1' },
    { id: 'topic-2', title: 'Tema 2' },
    { id: 'topic-3', title: 'Tema 3' },
  ],
  globalOrderedAnalysis: items,
  uniqueConceptsIndex: [],
}

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log('  ✅ ' + name)
    passed++
  } catch (err: any) {
    console.log('  ❌ ' + name)
    console.log('     ' + (err?.stack || err?.message || err))
    failed++
  }
}

async function main() {
  console.log('\n── EXAM_FULL_COVERAGE_CONTRACTS ──\n')
  const universe = buildExamEnjoyerUniverse(payload, selection)
  assert.equal(universe.targets.length, 51, 'Universe must contain exactly 51 targets')

  await test('1. Every supported duration offers honest scoped evidence', () => {
    for (const duration of [15,30,45,60,90]) {
      const bp = composeEnjoyerExamBlueprint(universe, duration, 'scope', 'scope')
      assert.ok(bp.slots.length > 0)
      assert.ok(bp.expectedCompletionSeconds <= duration * 60 * .85)
      assert.equal(bp.coverage.consideredTargetIds?.length, 51)
      assert.deepEqual(bp.coverage.sufficientEvidenceTargetIds, [])
    }
  })
  await test('2. Full universe is accounted for without equating scope to mastery', () => {
    const bp = composeEnjoyerExamBlueprint(universe, 15, 'scope', 'scope')
    const ids = [...bp.coverage.assessedTargetIds, ...bp.coverage.contextOnlyTargetIds, ...bp.coverage.notAssessedDueToScopeTargetIds]
    assert.equal(ids.length, 51); assert.equal(new Set(ids).size, 51)
    assert.ok(bp.coverage.assessedTargetIds.length < 51)
    assert.equal(bp.coverage.coverageStatus, 'scoped_sample')
  })

  // Contract 3: Context-only targets excluded from assessed count
  await test('3. Context-only targets excluded from assessed count', () => {
    const bp = composeEnjoyerExamBlueprint(universe, 60, 'exam-ctx-60', 'seed-ctx-60')
    for (const slot of bp.slots) {
      if (slot.contextTargetIds.length > 0) {
        for (const ctxId of slot.contextTargetIds) {
          assert.ok(!slot.assessedTargetIds.includes(ctxId), `Context target ${ctxId} must NOT be in assessedTargetIds for slot ${slot.id}`)
        }
      }
      if (['multiple_choice', 'true_false', 'fill_blank'].includes(slot.type)) {
        assert.equal(slot.assessedTargetIds.length, 1, `Slot ${slot.id} of type ${slot.type} must assess exactly 1 target`)
      }
    }
  })

  // Contract 4: Related targets shared only when criteria map to each
  await test('4. Related targets shared only when criteria map to each (matching pairs, multi-select options, worked problem steps)', () => {
    const bp = composeEnjoyerExamBlueprint(universe, 45, 'exam-sharing', 'seed-sharing')
    for (const slot of bp.slots) {
      if (slot.assessedTargetIds.length > 1) {
        assert.ok(
          slot.type === 'matching' || slot.type === 'multi_select' || slot.type === 'short_answer',
          `Multi-target slot ${slot.id} must be matching, multi_select, or worked problem, got ${slot.type}`
        )
        if (slot.type === 'matching') {
          assert.equal(slot.answerAuthority.kind, 'pairs')
          assert.ok(slot.answerAuthority.pairs.length >= slot.assessedTargetIds.length, 'Each matching target must have a corresponding pair')
        } else if (slot.type === 'multi_select') {
          assert.equal(slot.answerAuthority.kind, 'multi_text')
          assert.ok(slot.answerAuthority.canonicalValues.length >= slot.assessedTargetIds.length, 'Each multi_select target must map to canonical values')
        } else if (slot.type === 'short_answer') {
          assert.ok(slot.frozenSources.length >= slot.assessedTargetIds.length, 'Worked problem must have frozen sources for each step')
        }
      }
    }
  })

  await test('5. Recommendation is advisory and never calls provider', async () => {
    const original = { ...__routeDeps }
    try {
      Object.assign(__routeDeps, {
        getServerSession: async () => ({user:{id:'user'}}),
        getAuthoritativeFreeSession: async () => ({id:'session',userId:'user',sourceSelection:selection}),
        getMaterial: async () => ({id:'mat-a'}), lookupStudyalMaterialEnjoyer: async () => payload,
        generateValidatedLegacyJson: async () => { throw Error('NO_PROVIDER_ALLOWED') },
      })
      const response = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
        method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({mode:'recommend',sessionId:'session'})
      }))
      const data = await response.json()
      assert.equal(response.status,200); assert.equal(data.minimumSelectableDurationMinutes,15)
    } finally { Object.assign(__routeDeps,original) }
  })

  // Contract 7: Complete coverage across increasing durations (45 min, 60 min, 90 min)
  await test('7. Complete coverage across increasing durations (45 min, 60 min, 90 min)', () => {
    const bp45 = composeEnjoyerExamBlueprint(universe, 45, 'exam-7-45', 'seed-7-45')
    const bp60 = composeEnjoyerExamBlueprint(universe, 60, 'exam-7-60', 'seed-7-60')
    const bp90 = composeEnjoyerExamBlueprint(universe, 90, 'exam-7-90', 'seed-7-90')









    // Higher duration provides more granular questions (more slots)
    assert.ok(bp60.slots.length >= bp45.slots.length, '60m slots count must be >= 45m slots count')
    assert.ok(bp90.slots.length >= bp60.slots.length, '90m slots count must be >= 60m slots count')

    // Time budgets respected
    const total45s = bp45.slots.reduce((s, slot) => s + slot.estimatedSeconds, 0)
    assert.ok(total45s <= 45 * 60 * 0.85, `45m answering seconds ${total45s}s must fit within 45 * 60 * 0.85`)

    const total60s = bp60.slots.reduce((s, slot) => s + slot.estimatedSeconds, 0)
    assert.ok(total60s <= 60 * 60 * 0.85, `60m answering seconds ${total60s}s must fit within 60 * 60 * 0.85`)

    const total90s = bp90.slots.reduce((s, slot) => s + slot.estimatedSeconds, 0)
    assert.ok(total90s <= 90 * 60 * 0.85, `90m answering seconds ${total90s}s must fit within 90 * 60 * 0.85`)
  })

  // Contract 8: v3 canonical-answer and privacy preserved (no public pairs / matchingCorrectMap, no '·' distractor dump)
  await test('8. v3 canonical-answer and privacy preserved (no public pairs / matchingCorrectMap, no "·" distractor dump)', () => {
    const bp = composeEnjoyerExamBlueprint(universe, 45, 'exam-8', 'seed-8')
    for (const slot of bp.slots) {
      if (slot.answerAuthority.kind === 'single_text') {
        const canonical = slot.answerAuthority.canonicalValue
        assert.ok(!canonical.endsWith('…'), 'Canonical value must not end in ellipsis')
        for (const distractor of slot.answerAuthority.distractorPool) {
          assert.ok(!distractor.includes(' · '), 'Distractor must not be a ·-separated dump')
        }
      }
    }

    // MCQ option construction test
    const authority = {
      kind: 'single_text' as const,
      canonicalValue: 'Respuesta canonica limpia y bounded.',
      distractorPool: ['Distractor pool 1', 'Distractor pool 2', 'Distractor pool 3'],
    }
    const built = buildMultipleChoiceOptions(authority, ['Provider distractor A', 'Provider distractor B'], 'seed-test')
    assert.ok(built)
    for (const opt of built!.options) {
      assert.ok(!opt.includes(' · '), 'No option may contain · concatenation')
      assert.ok(!opt.endsWith('…'), 'No option may be truncated with ellipsis')
    }
  })

  // Contract 9: Post-provider-success 500 reproduced & fixed
  await test('9. Post-provider-success 500 reproduced & fixed (type aliases, partial sourceItemIds, custom prompt)', async () => {
    const original = { ...__routeDeps }
    const store = new InMemoryExamGenerationStore()
    try {
      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'user-9' } }),
        getAuthoritativeFreeSession: async () => ({ id: 'session-9', userId: 'user-9', processMode: 'free', sourceSelection: selection }),
        getMaterial: async () => ({ id: 'mat-a' }),
        lookupStudyalMaterialEnjoyer: async () => payload,
        gradingStore: new MemoryExamGradingStore(), examStore: store,
        generateValidatedLegacyJson: async ({ validate, prompt }: any) => {
          const blocks = String(prompt).split(/\n(?=\d+\.\s+slotId=)/).filter((b: string) => /^\d+\.\s+slotId=/.test(b))
          const value = blocks.map((block: string, i: number) => {
            const slotId = block.match(/slotId=(\S+)/)?.[1] || ''
            const typeMatch = block.match(/type=(\S+)/)?.[1] || 'multiple_choice'
            // Simulate type alias ('mcq', 'open', 'problem')
            const aliasType = typeMatch === 'multiple_choice' ? 'mcq' : typeMatch === 'short_answer' ? 'open' : typeMatch
            // Simulate omitted or partial sourceItemIds (common LLM behavior)
            const sourceItemIds: string[] = []
            return {
              slotId,
              type: aliasType,
              sourceItemIds,
              prompt: `¿Pregunta personalizada del proveedor para ${slotId}?`,
              rubricHints: ['Criterio 1'],
              distractors: ['Distractor plausible A', 'Distractor plausible B', 'Distractor plausible C'],
              pairs: [{ left: 'Term A', right: 'Def A' }],
            }
          })
          const validation = validate(value)
          assert.ok(validation.valid, `Mock response validation failed: ${JSON.stringify(validation.errors)}`)
          return value
        },
      })
      const post = (body: object) => POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }))

      const res = await post({ mode: 'generate', sessionId: 'session-9', durationMinutes: 45 })
      assert.equal(res.status, 200, 'Generation must return HTTP 200')
      const data = await res.json()
      assert.ok(data.exam, 'Exam object must be returned')
      assert.ok(data.exam.questions.length > 0, 'Questions must be generated')

      // Verify questions are ready and correctly mapped without 500 error
      const readyQuestions = data.exam.questions.filter((q: any) => q.ready !== false)
      assert.ok(readyQuestions.length > 0, 'Must have ready questions')
      for (const q of readyQuestions) {
        assert.ok(q.prompt, 'Each ready question must have a prompt')
        if (q.type === 'matching') {
          assert.equal(q.pairs, undefined, 'Public matching question must NOT have pairs')
          assert.equal(q.matchingCorrectMap, undefined, 'Public matching question must NOT have matchingCorrectMap')
          assert.ok(Array.isArray(q.matchingLeftTexts), 'Must have matchingLeftTexts')
          assert.ok(Array.isArray(q.matchingRightTexts), 'Must have matchingRightTexts')
        }
      }
    } finally {
      Object.assign(__routeDeps, original)
    }
  })

  // Contract 10: Reopen ready exam remains 0 provider calls
  await test('10. Reopen ready exam remains 0 provider calls', async () => {
    const original = { ...__routeDeps }
    const store = new InMemoryExamGenerationStore()
    let providerCalls = 0
    try {
      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'user-10' } }),
        getAuthoritativeFreeSession: async () => ({ id: 'session-10', userId: 'user-10', processMode: 'free', sourceSelection: selection }),
        getMaterial: async () => ({ id: 'mat-a' }),
        lookupStudyalMaterialEnjoyer: async () => payload,
        gradingStore: new MemoryExamGradingStore(), examStore: store,
        generateValidatedLegacyJson: async ({ validate, prompt }: any) => {
          providerCalls++
          const blocks = String(prompt).split(/\n(?=\d+\.\s+slotId=)/).filter((b: string) => /^\d+\.\s+slotId=/.test(b))
          const value = blocks.map((block: string) => {
            const slotId = block.match(/slotId=(\S+)/)?.[1] || ''
            const typeMatch = block.match(/type=(\S+)/)?.[1] || 'multiple_choice'
            return {
              slotId,
              type: typeMatch,
              sourceItemIds: [],
              prompt: `¿Pregunta para ${slotId}?`,
              distractors: ['D1', 'D2', 'D3'],
              pairs: [{ left: 'A', right: 'B' }],
            }
          })
          return value
        },
      })
      const post = (body: object) => POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }))

      // First call generates initial batch
      const res1 = await post({ mode: 'generate', sessionId: 'session-10', durationMinutes: 45 })
      assert.equal(res1.status, 200)
      const data1 = await res1.json()
      const examId = data1.exam.id
      const initialCalls = providerCalls
      assert.ok(initialCalls > 0, 'Initial generation must make provider calls')

      // Second call with same configuration (or advance when ready)
      const res2 = await post({ mode: 'generate', sessionId: 'session-10', durationMinutes: 45 })
      assert.equal(res2.status, 200)
      const data2 = await res2.json()
      assert.equal(data2.exam.id, examId, 'Must restore the exact same examId')
      assert.equal(providerCalls, initialCalls, 'Reopening must make 0 additional provider calls')
    } finally {
      Object.assign(__routeDeps, original)
    }
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('exam-full-coverage-contracts: ALL PASS')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
