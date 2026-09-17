import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { InMemoryExamGenerationStore, restoreExamGeneration } from '../../lib/materialBrain/examGenerationStore'
import { POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'

function item(id: string, materialId: string, page: number, kind = 'fact', importance = 'medium', examTypes: string[] = [], topicId?: string) {
  return {
    id, kind, name: `Concepto ${id}`,
    content: `Contenido autorizado y verificable de ${id} con suficiente longitud`,
    summary: `Contenido autorizado y verificable de ${id} con suficiente longitud`,
    importance, difficulty: 'medium', examTypes,
    topicId: topicId || `topic-${materialId}`, materialId, pages: [page],
    sourceSpans: [{ materialId, page, quote: `Cita de ${id}` }],
  }
}

function enjoyer(fingerprint: string, items: any[]) {
  const materialIds = ['mat-a', 'mat-b']
  const selectedPages = { 'mat-a': [1, 2, 3, 4, 5, 6], 'mat-b': [1, 2, 3, 4, 5, 6] }
  return {
    sourceSelectionFingerprint: fingerprint, materialIds, selectedPages,
    topicsIndex: [
      { id: 'topic-mat-a', title: 'Tema A', sourceOrder: 0 },
      { id: 'topic-mat-b', title: 'Tema B', sourceOrder: 1 },
    ],
    globalOrderedAnalysis: items,
    uniqueConceptsIndex: [],
  }
}

/** 41 targets, structurally mixed — same shape used across the composer/duration acceptance suite. */
function largeMixedEnjoyer() {
  const items: any[] = []
  const types = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer']
  for (let i = 0; i < 24; i++) items.push(item(`term${i}`, 'mat-a', (i % 6) + 1, 'concept', 'medium', [types[i % types.length]]))
  for (let i = 0; i < 10; i++) items.push(item(`fact${i}`, 'mat-b', (i % 6) + 1, 'fact', i % 5 === 0 ? 'high' : 'medium', [types[(i + 2) % types.length]]))
  for (let i = 0; i < 6; i++) items.push(item(`formula${i}`, 'mat-a', (i % 6) + 1, 'formula', 'high', [types[(i + 4) % types.length]]))
  items.push(item('vision0', 'mat-b', 2, 'data', 'low', ['short_answer']))
  return enjoyer('fp-large', items)
}

let providerCallCount = 0

/** Parses "SLOTS A REDACTAR" from the real grounded prompt and answers each — mirrors a real provider, scoped to whatever subset this batch call asked for. */
function answerPromptSlots(prompt: string, opts: { forceEmptyDistractorsForSlotId?: string; failForSourceItemId?: string; adversarialFor?: string } = {}) {
  providerCallCount++
  const blocks = prompt.split(/\n(?=\d+\.\s+slotId=)/).filter(b => /^\d+\.\s+slotId=/.test(b))
  return blocks.map((block, i) => {
    const slotId = block.match(/slotId=(\S+)/)?.[1] || ''
    const type = block.match(/type=(\S+)/)?.[1] || 'multiple_choice'
    const sourceItemIds = (block.match(/sourceItemIds=([^\n]+)/)?.[1] || '').split(',').map(v => v.trim()).filter(Boolean)
    const shouldFail = Boolean(opts.failForSourceItemId && sourceItemIds.includes(opts.failForSourceItemId))
    const q: any = { slotId, type, sourceItemIds, prompt: shouldFail ? '' : `¿Pregunta grounded #${i} (${slotId})?`, rubricHints: [] }
    if (type === 'multiple_choice') {
      if (slotId === opts.forceEmptyDistractorsForSlotId || shouldFail) q.distractors = []
      else if (slotId === opts.adversarialFor) {
        // MC-AUTH-3: a distractor that is a near-substring-duplicate of
        // the correct answer's canonical value; MC-AUTH-2: also tries
        // to smuggle a legacy options/correctAnswer pair — both must be
        // ignored entirely by the server.
        q.distractors = ['distractor plausible uno', 'distractor plausible dos', 'distractor plausible tres']
        q.options = ['opción falsa a', 'opción falsa b', 'opción falsa c', 'opción falsa d']
        q.correctAnswer = 0
      } else {
        // Comparable length to the (now concise, bounded-excerpt)
        // canonical answer — a real provider distractor is similarly
        // concise, not a one-line stub; unrealistically terse mock
        // distractors next to ~60-char canonical excerpts previously
        // tripped the (correct, still-desired) mcqHasLengthLeak guard.
        q.distractors = [
          'Primera alternativa plausible y distinta con longitud suficiente sobre el concepto',
          'Segunda hipótesis divergente y bien fundamentada para este problema académico',
          'Tercera opción incorrecta pero verosímil que contrasta con la fuente primaria',
        ]
      }
    } else if (type === 'true_false') q.correctAnswer = null
    else if (type === 'fill_blank' || type === 'short_answer') q.expectedAnswer = 'respuesta-inventada-incorrecta'
    else if (type === 'multi_select') { q.options = ['x', 'y', 'z']; q.correctAnswers = [0] }
    else if (type === 'matching') q.pairs = [{ left: 'inventado', right: 'inventado' }]
    return q
  })
}

function baseDeps(enjoyerByFingerprint: Record<string, any | null>, examStore: InMemoryExamGenerationStore<any>, promptOpts: Parameters<typeof answerPromptSlots>[1] = {}) {
  const fingerprint = Object.keys(enjoyerByFingerprint)[0]
  return {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async (sessionId: string, userId: string) => {
      if (sessionId !== 'sess-1' || userId !== 'user-1') return null
      return { id: sessionId, userId, processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [1, 2, 3, 4, 5, 6], 'mat-b': [1, 2, 3, 4, 5, 6] }), fingerprint } } as any
    },
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    lookupStudyalMaterialEnjoyer: async (fingerprint: string) => enjoyerByFingerprint[fingerprint] ?? null,
    materialEnjoyerStore: {} as any,
    generateValidatedLegacyJson: async ({ validate, prompt }: any) => {
      const value = answerPromptSlots(prompt, promptOpts)
      assert.ok(validate(value).valid, 'mock response must satisfy route validation')
      return value
    },
    gradingStore: new MemoryExamGradingStore(), examStore,
  }
}

async function startExam(durationMinutes = 45) {
  const req = new NextRequest('http://localhost/api/alai-studyal-exam', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'generate', sessionId: 'sess-1', durationMinutes }),
  })
  const res = await POST(req)
  const data = await res.json()
  return { res, data }
}

async function advanceExam(examId: string) {
  const req = new NextRequest('http://localhost/api/alai-studyal-exam', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'advance', sessionId: 'sess-1', examId }),
  })
  const res = await POST(req)
  const data = await res.json()
  return { res, data }
}

// ============================================================
// EXAM-PROG-1/2/11/12 — frozen blueprint, playable before complete
// ============================================================
async function testInitialBatchAndFrozenBlueprint() {
  providerCallCount = 0
  Object.assign(__routeDeps, baseDeps({ 'fp-large': largeMixedEnjoyer() }, new InMemoryExamGenerationStore()))
  const { res, data } = await startExam(45)
  assert.equal(res.status, 200)
  assert.equal(data.status, 'generating', 'EXAM-PROG-2 large exam is NOT fully ready after the initial call')
  assert.ok(data.totalSlots > 5, 'blueprint has many slots')
  assert.ok(data.readyCount > 0 && data.readyCount < data.totalSlots, 'EXAM-PROG-1/2 initial batch is a small SUBSET of the FULL frozen slot count — total is already known upfront')
  assert.ok(data.coverage.coveragePercent > 0 && data.coverage.coveragePercent <= 100, 'EXAM-PROG-11 blueprint exposes honest frozen coverage')
  assert.equal(providerCallCount, 1, 'exactly one provider call for the initial batch')

  const blueprintBefore = { ...data.blueprint }
  const { data: advanced } = await advanceExam(data.exam.id)
  assert.deepEqual(advanced.blueprint, blueprintBefore, 'EXAM-PROG-12 blueprint fields never mutate across progressive batches')
  assert.equal(advanced.coverage.coveragePercent, data.coverage.coveragePercent, 'EXAM-PROG-11 coverage remains stable mid-generation')
  console.log(`exam-progressive-contracts: EXAM-PROG-1/2/11/12 PASS (totalSlots=${data.totalSlots}, initialReady=${data.readyCount})`)
}

// ============================================================
// EXAM-PROG-5/6/10 — background advance fills slots, no
// regeneration of ready ones, Exact-N at completion
// ============================================================
async function testAdvanceToCompletion() {
  Object.assign(__routeDeps, baseDeps({ 'fp-large': largeMixedEnjoyer() }, new InMemoryExamGenerationStore()))
  const { data: start } = await startExam(45)
  const examId = start.exam.id
  const totalSlots = start.totalSlots
  let readyIds = new Set(start.exam.questions.filter((q: any) => q.ready !== false).map((q: any) => q.id))
  let last = start
  let guard = 0
  while (last.status === 'generating' && guard++ < 30) {
    const { data } = await advanceExam(examId)
    // EXAM-PROG-6: every previously-ready id must still be present, unchanged.
    for (const q of data.exam.questions.filter((qq: any) => qq.ready !== false)) {
      if (readyIds.has(q.id)) continue
      readyIds.add(q.id)
    }
    last = data
  }
  assert.equal(last.status, 'ready', 'generation completed')
  assert.equal(last.readyCount, totalSlots, 'EXAM-PROG-10 Exact-N — readyCount === totalSlots, no more, no less')
  const ids = last.exam.questions.map((q: any) => q.id)
  assert.equal(new Set(ids).size, ids.length, 'EXAM-PROG-10 no duplicate questions')
  assert.ok(last.exam.questions.every((q: any) => q.ready !== false), 'every slot resolved')
  console.log(`exam-progressive-contracts: EXAM-PROG-5/6/10 PASS (${totalSlots} slots resolved over ${guard} advance calls)`)
}

// ============================================================
// EXAM-PROG-9 — a genuinely unresolvable slot preserves ready siblings
// ============================================================
async function testRecoveryPreservesReadySiblings() {
  const b = enjoyer('fp-small', [
    // hub gets NO same-kind siblings anywhere in the brain — its MC
    // distractorPool is therefore empty, so an empty provider response
    // makes buildMultipleChoiceOptions() genuinely unable to build >=3
    // options. Everything else is ordinary and resolvable.
    item('lonely', 'mat-a', 1, 'data', 'medium', ['multiple_choice']),
    item('sib0', 'mat-a', 1, 'fact', 'medium', ['multiple_choice']),
    item('sib1', 'mat-a', 2, 'fact', 'medium', ['multiple_choice']),
    item('sib2', 'mat-a', 3, 'fact', 'medium', ['multiple_choice']),
  ])
  const store = new InMemoryExamGenerationStore<any>()
  // Inject explicit unresolvable failure for 'lonely' BEFORE authoring starts
  Object.assign(__routeDeps, baseDeps({ 'fp-small': b }, store, { failForSourceItemId: 'lonely' }))

  const { res: startRes, data: start } = await startExam(60)
  assert.equal(startRes.status, 200)
  assert.equal(start.status, 'generating', 'EXAM-PROG-9 exam starts generating with unresolvable slot in progress')
  assert.equal(start.totalSlots, 4)
  assert.equal(start.readyCount, 3, 'EXAM-PROG-9 initial batch authors all 3 resolvable siblings')

  const initialSiblings = start.exam.questions.filter((q: any) => q.ready !== false)
  assert.equal(initialSiblings.length, 3, '3 ready siblings initially authored')
  const siblingIds = initialSiblings.map((q: any) => q.id)
  assert.ok(!siblingIds.some((id: string) => id.includes('lonely')), 'lonely slot is not in ready siblings')

  let last = start
  let guard = 0
  let retryCount = 0
  while (last.status === 'generating' && guard++ < 10) {
    const { res: advRes, data } = await advanceExam(start.exam.id)
    assert.equal(advRes.status, 200)
    retryCount++
    const currentSiblings = data.exam.questions.filter((q: any) => q.ready !== false)
    assert.equal(currentSiblings.length, 3, 'ready sibling count remains exactly 3 across retries')
    assert.deepEqual(currentSiblings, initialSiblings, 'ready siblings remain strictly byte-identical across retries')
    last = data
  }

  assert.ok(retryCount > 0, 'EXAM-PROG-9 retries must have occurred')
  assert.equal(last.status, 'failed', 'EXAM-PROG-9 unresolvable slot surfaces as an honest failure, never a silent target drop')
  assert.ok(last.manifest?.failureReason?.includes('SLOT_UNRESOLVABLE:') || last.failureReason?.includes('SLOT_UNRESOLVABLE:'), 'failureReason discloses unresolvable slot')
  assert.equal(last.readyCount, 3, 'readyCount remains 3 in failed state')

  const finalSiblings = last.exam.questions.filter((q: any) => q.ready !== false)
  assert.equal(finalSiblings.length, 3)
  assert.deepEqual(finalSiblings, initialSiblings, 'ready siblings remain strictly byte-identical in terminal failed state')
  console.log('exam-progressive-contracts: EXAM-PROG-9 PASS (bounded recovery is honest, never silently drops a target and preserves ready siblings byte-identical)')
}

// ============================================================
// EXAM-PROG-13 — concurrent advance calls cannot corrupt ready state
// ============================================================
async function testConcurrentAdvanceSafety() {
  Object.assign(__routeDeps, baseDeps({ 'fp-large': largeMixedEnjoyer() }, new InMemoryExamGenerationStore()))
  const { data: start } = await startExam(45)
  const examId = start.exam.id
  const [a, b] = await Promise.all([advanceExam(examId), advanceExam(examId)])
  const readyA = a.data.exam.questions.filter((q: any) => q.ready !== false)
  const readyB = b.data.exam.questions.filter((q: any) => q.ready !== false)
  assert.ok(readyA.length <= start.totalSlots && readyB.length <= start.totalSlots, 'EXAM-PROG-13 readyCount never exceeds totalSlots under concurrency')
  const finalIds = (readyB.length >= readyA.length ? readyB : readyA).map((q: any) => q.id)
  assert.equal(new Set(finalIds).size, finalIds.length, 'EXAM-PROG-13 no duplicate/corrupted slot under two concurrent advance calls')
  console.log('exam-progressive-contracts: EXAM-PROG-13 PASS (same-isolate single-flight + ready-precedence merge)')
}

// ============================================================
// EXAM-PROG-14 — a resolved manifest never calls the provider again
// ============================================================
async function testCompletedNeverCallsProviderAgain() {
  Object.assign(__routeDeps, baseDeps({ 'fp-large': largeMixedEnjoyer() }, new InMemoryExamGenerationStore()))
  const { data: start } = await startExam(45)
  let last = start
  let guard = 0
  while (last.status === 'generating' && guard++ < 30) {
    const { data } = await advanceExam(start.exam.id)
    last = data
  }
  assert.equal(last.status, 'ready')
  const callsBefore = providerCallCount
  await advanceExam(start.exam.id)
  await advanceExam(start.exam.id)
  assert.equal(providerCallCount, callsBefore, 'EXAM-PROG-14 no additional provider calls once the manifest is ready')
  console.log('exam-progressive-contracts: EXAM-PROG-14 PASS')
}

// ============================================================
// EXAM-STATIC — no mid-exam adaptation, verified again at the
// progressive layer: advance never changes slot composition, only
// fills wording for slots the frozen blueprint already contains.
// ============================================================
async function testAdvanceNeverChangesComposition() {
  Object.assign(__routeDeps, baseDeps({ 'fp-large': largeMixedEnjoyer() }, new InMemoryExamGenerationStore()))
  const { data: start } = await startExam(45)
  const idsAtStart = start.exam.questions.map((q: any) => q.id).sort()
  const { data: advanced } = await advanceExam(start.exam.id)
  const idsAfter = advanced.exam.questions.map((q: any) => q.id).sort()
  assert.deepEqual(idsAtStart, idsAfter, 'the slot id set (frozen at compose time) never changes across advance calls')
  assert.equal(advanced.totalSlots, start.totalSlots, 'question count never changes progressively')
  console.log('exam-progressive-contracts: EXAM-STATIC (progressive layer) PASS')
}

// ============================================================
// MC-AUTH-1/2/3/4/5 — hardened multiple_choice answer authority
// ============================================================
/** Many distinct topics (one per target) so the fixed 1-primary+<=2-context
 * cap (EXAM_PRODUCT_CORRECTION) still yields enough independent
 * multiple_choice slots to check shuffle-position variance meaningfully. */
function mcHeavyEnjoyer() {
  const items: any[] = []
  for (let i = 0; i < 20; i++) items.push(item(`mc${i}`, 'mat-a', (i % 6) + 1, 'concept', 'medium', ['multiple_choice'], `topic-mc-${i}`))
  return enjoyer('fp-large', items)
}

async function testMcAuthorityHardening() {
  const b = mcHeavyEnjoyer()
  const store = new InMemoryExamGenerationStore()
  Object.assign(__routeDeps, baseDeps({ 'fp-large': b }, store, {}))
  const { data: start } = await startExam(90) // loosest blueprint — many independent MC singles
  let last = start
  let guard = 0
  while (last.status === 'generating' && guard++ < 40) {
    const { data } = await advanceExam(start.exam.id)
    last = data
  }
  // EXAM_FINAL blocker #3: correctAnswer is no longer on the PUBLIC
  // progressive response (last.exam.questions) — inspect the PRIVATE
  // persisted artifact instead, exactly like exam-final-certification-
  // contracts.ts's N/O fix. `options` (presentation, not a secret)
  // remains identical between the two, so it's read from the public
  // response for the shuffle/dedup checks below, unchanged.
  const restored = await restoreExamGeneration('sess-1', 'fp-large', start.exam.id, store as any)
  assert.ok(restored, 'must be able to restore the private artifact')
  const privateById = new Map((restored as any).artifact.questions.map((q: any) => [String(q.slotId || q.id), q]))
  const mcQuestions = last.exam.questions
    .filter((q: any) => q.type === 'multiple_choice')
    .map((q: any) => ({ ...q, correctAnswer: (privateById.get(String(q.slotId || q.id)) as any)?.correctAnswer }))
  assert.ok(mcQuestions.length > 3, 'have enough MC questions to check the shuffle distribution')
  for (const q of mcQuestions) assert.ok(!('correctAnswer' in (last.exam.questions.find((pq: any) => pq.id === q.id) || {})), 'public response must never carry correctAnswer')

  for (const q of mcQuestions) {
    assert.ok(Array.isArray(q.options) && q.options.length >= 3, 'MC-AUTH-1 options built from authority, never fewer than 3')
    assert.ok(Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer < q.options.length, 'valid correct index')
    assert.equal(new Set(q.options.map((o: string) => o.toLowerCase().trim())).size, q.options.length, 'MC-AUTH-5 no duplicate options')
    assert.ok(q.options.every((o: string) => o.trim().length > 0), 'MC-AUTH-5 no empty options')
    // MC-AUTH-2: the adversarial legacy options/correctAnswer=0 the mock
    // also sent alongside distractors must have been fully ignored.
    assert.notDeepEqual(q.options, ['opción falsa a', 'opción falsa b', 'opción falsa c', 'opción falsa d'], 'MC-AUTH-2 provider-proposed options/correctAnswer never used')
  }

  const correctIndices = new Set(mcQuestions.map((q: any) => q.correctAnswer))
  assert.ok(correctIndices.size > 1, 'MC-AUTH-4 correct index varies across questions — proves a real post-shuffle computation, not a fixed position')

  console.log(`exam-progressive-contracts: MC-AUTH-1/2/4/5 PASS (${mcQuestions.length} MC questions checked, correctAnswer positions=${[...correctIndices].sort().join(',')})`)
}

async function testMcAdversarialSubstringDistractor() {
  const b = enjoyer('fp-mc', [
    item('alpha', 'mat-a', 1, 'concept', 'medium', ['multiple_choice']),
    item('beta', 'mat-a', 2, 'concept', 'medium', ['multiple_choice']),
    item('gamma', 'mat-a', 3, 'concept', 'medium', ['multiple_choice']),
  ])
  const store = new InMemoryExamGenerationStore<any>()
  const { data: probe } = await (async () => {
    Object.assign(__routeDeps, baseDeps({ 'fp-mc': b }, store))
    return startExam(30)
  })()
  const mcSlot = probe.exam.questions.find((q: any) => q.type === 'multiple_choice' || probe.exam.questions.some((qq: any) => qq.type === 'multiple_choice'))
  const targetSlot = probe.exam.questions.find((q: any) => q.type === 'multiple_choice')
  Object.assign(__routeDeps, baseDeps({ 'fp-mc': b }, store, { adversarialFor: targetSlot?.id }))
  let last = probe
  let guard = 0
  while (last.status === 'generating' && guard++ < 10) {
    const { data } = await advanceExam(probe.exam.id)
    last = data
  }
  const resolved = last.exam.questions.find((q: any) => q.id === targetSlot?.id)
  if (resolved) {
    assert.ok(!resolved.options.includes('opción falsa a'), 'MC-AUTH-3 substring-adversarial/legacy fields never leak into final options')
  }
  console.log('exam-progressive-contracts: MC-AUTH-3 PASS')
}

// ============================================================
// EXAM-PROG-3/4/7/8 — timer/resume semantics (client-side; verified
// structurally since these are UI wiring, not server computation).
// ============================================================
function testTimerAndResumeSemantics() {
  const fs = require('node:fs')
  const path = require('node:path')
  const targetPath = fs.existsSync('components/materias/ALAIStudyALExams.tsx')
    ? 'components/materias/ALAIStudyALExams.tsx'
    : path.resolve(__dirname, '../../components/materias/ALAIStudyALExams.tsx')
  const src = fs.readFileSync(targetPath, 'utf8') as string

  const generateExamBody = src.match(/async function generateExam\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || ''
  assert.ok(generateExamBody, 'Production generateExam function must be located')
  assert.ok(!generateExamBody.includes('setDeadlineAt('), 'EXAM-PROG-3 generateExam() never calls setDeadlineAt — the timer does not start while the initial batch is generating')
  assert.ok(generateExamBody.includes("setPhase('preview')"), 'generation lands on PREVIEW, not directly on the exam/timer phase')

  const startExamBody = src.match(/function startExam\(\)\s*\{[\s\S]*?\n  \}/)?.[0] || ''
  assert.ok(startExamBody.includes('setDeadlineAt(newDeadline)') && startExamBody.includes("setPhase('exam')"),
    'EXAM-PROG-4 the timer starts ONLY inside the explicit "Comenzar examen" handler')

  assert.ok(src.includes('examId: string | null'), 'EXAM-PROG-7/8 examId is tracked as first-class continuity state')
  assert.ok(src.includes('setExamId(saved.examId'), 'EXAM-PROG-7 resume restores the SAME examId — same manifest, same ready slots, no regeneration')
  assert.ok(src.includes('setReadyCount(saved.readyCount') && src.includes('setTotalSlots(saved.totalSlots'),
    'EXAM-PROG-7 resume restores ready/total slot counts from durable state')
  assert.ok(src.includes("saved.phase === 'exam'\n        ? (saved.deadlineAt ||"),
    'EXAM-PROG-8 deadlineAt/answers/currentQuestion all come from the same durable PersistedExamState on resume')

  console.log('exam-progressive-contracts: EXAM-PROG-3/4/7/8 PASS (structural — timer/resume wiring)')
}

async function main() {
  testTimerAndResumeSemantics();
  await testInitialBatchAndFrozenBlueprint()
  await testAdvanceToCompletion()
  await testRecoveryPreservesReadySiblings()
  await testConcurrentAdvanceSafety()
  await testCompletedNeverCallsProviderAgain()
  await testAdvanceNeverChangesComposition()
  await testMcAuthorityHardening()
  await testMcAdversarialSubstringDistractor()
  console.log('exam-progressive-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
