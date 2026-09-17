import assert from 'node:assert/strict'
import type { ExamQuestion } from '../../lib/materials/types'

// ─── MODEL OF THE CLIENT ADVANCE CONSUMER (ALAIStudyALExams.tsx) ───

interface ClientExamState {
  examId: string
  sessionId: string
  phase: 'setup' | 'generating' | 'preview' | 'exam' | 'evaluating' | 'results'
  genStatus: 'generating' | 'ready' | 'failed'
  readyCount: number
  totalSlots: number
  currentQuestion: number
  exam: { questions: ExamQuestion[] } | null
}

function shouldScheduleAdvanceEffect(state: ClientExamState): boolean {
  if (!state.examId || !state.sessionId || state.genStatus !== 'generating') return false
  if (state.phase !== 'preview' && state.phase !== 'exam') return false
  return true
}

async function runClientTick(
  state: ClientExamState,
  advanceBusyRef: { current: boolean },
  fetchAdvance: () => Promise<any>,
  cancelled = false,
): Promise<{ executed: boolean; skipped: boolean; error?: string }> {
  if (cancelled || advanceBusyRef.current) return { executed: false, skipped: true }
  if (state.readyCount >= state.totalSlots) return { executed: false, skipped: true }
  advanceBusyRef.current = true
  try {
    const data = await fetchAdvance()
    if (cancelled) return { executed: false, skipped: true }

    // CONSUME VALID SERVER GENERATION STATUS BEFORE TREATING !success AS AN EXIT REASON
    if (data?.status === 'generating' || data?.status === 'ready' || data?.status === 'failed') {
      state.genStatus = data.status
    }
    if (typeof data?.totalSlots === 'number') {
      state.totalSlots = data.totalSlots
    }
    if (typeof data?.readyCount === 'number') {
      state.readyCount = data.readyCount
    }
    if (data?.exam && state.exam) {
      const merged = state.exam.questions.map((oldQ, i) => {
        const newQ = data.exam.questions[i]
        return newQ && newQ.ready !== false ? newQ : oldQ
      })
      state.exam = { ...data.exam, questions: merged }
    }
    if (!data?.success) return { executed: true, skipped: false, error: data?.error || 'failed' }
    return { executed: true, skipped: false }
  } finally {
    advanceBusyRef.current = false
  }
}

// ─── MODEL OF THE RENDERING FUNCTIONS (ALAIStudyALExams.tsx) ───

function renderUnreadyExamSlot(state: ClientExamState): { uiTitle: string; uiSubtitle: string; hasPreparing: boolean; hasExit: boolean } {
  const q = state.exam?.questions[state.currentQuestion]
  const qReady = q?.ready !== false
  if (qReady) {
    return { uiTitle: 'Pregunta Lista', uiSubtitle: '', hasPreparing: false, hasExit: false }
  }
  if (state.genStatus === 'failed') {
    return {
      uiTitle: 'No se pudo completar el examen.',
      uiSubtitle: `${state.readyCount} de ${state.totalSlots} preguntas quedaron listas.`,
      hasPreparing: false,
      hasExit: true,
    }
  }
  return {
    uiTitle: '🧠',
    uiSubtitle: 'Preparando la siguiente pregunta…',
    hasPreparing: true,
    hasExit: false,
  }
}

function renderPreviewHeader(state: ClientExamState): { heading: string; description: string; canStart: boolean; hasExit: boolean } {
  if (state.genStatus === 'failed') {
    return {
      heading: 'No se pudo completar el examen',
      description: `${state.readyCount} de ${state.totalSlots} preguntas quedaron listas.`,
      canStart: false,
      hasExit: true,
    }
  }
  return {
    heading: 'Tu examen está listo',
    description: state.genStatus === 'generating'
      ? 'Las primeras preguntas ya están listas. El resto se sigue preparando en segundo plano — puedes empezar ya.'
      : 'Todas las preguntas están listas.',
    canStart: true,
    hasExit: true,
  }
}

// ─── TEST SUITE ───

async function main() {
  console.log('── EXAM_FAILED_STATE_CLIENT_LIFECYCLE CONTRACTS ──\n')

  const initialQuestions: ExamQuestion[] = Array.from({ length: 19 }, (_, i) => {
    const isReady = i < 14
    return {
      id: `q_${i}`,
      slotId: `slot_${i}`,
      type: 'multiple_choice',
      prompt: isReady ? `Pregunta válida ${i}` : '',
      ready: isReady,
      options: isReady ? ['A', 'B', 'C', 'D'] : [],
      correctAnswer: 0,
    } as any
  })

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 1: success:false + status:"failed" updates client generation state
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 1: Client consumes status: "failed" on success: false ---')
  const clientState: ClientExamState = {
    examId: 'exam-9395d541',
    sessionId: 'sess-live',
    phase: 'exam',
    genStatus: 'generating',
    readyCount: 14,
    totalSlots: 19,
    currentQuestion: 0,
    exam: { questions: [...initialQuestions] },
  }
  const advanceBusyRef = { current: false }

  const serverFailedPayload = {
    success: false,
    error: 'EXAM_GENERATION_FAILED',
    status: 'failed',
    failureReason: 'SLOT_UNRESOLVABLE:exam_slot:2f31d3f5',
    readyCount: 17,
    totalSlots: 19,
    exam: {
      questions: initialQuestions.map((q, i) => {
        const isReady = i < 17
        return {
          ...q,
          prompt: isReady ? `Pregunta lista ${i}` : '',
          ready: isReady,
        }
      }),
    },
  }

  let serverCallCount = 0
  const mockFetch = async () => {
    serverCallCount++
    return serverFailedPayload
  }

  const result = await runClientTick(clientState, advanceBusyRef, mockFetch)
  assert.equal(serverCallCount, 1)
  assert.equal(result.executed, true)
  assert.equal(clientState.genStatus, 'failed', 'Client genStatus MUST transition to "failed"')
  assert.equal(clientState.readyCount, 17, 'Client readyCount MUST update to 17')
  assert.equal(clientState.totalSlots, 19, 'Client totalSlots MUST remain 19')
  assert.equal(advanceBusyRef.current, false, 'advanceBusyRef MUST be reset to false in finally')
  console.log('PASS 1: Client successfully consumes status="failed", readyCount=17, totalSlots=19 on success:false')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 2: Failed state schedules ZERO subsequent advance calls
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 2: Failed state schedules zero subsequent advance calls ---')
  const shouldContinueFailed = shouldScheduleAdvanceEffect(clientState)
  assert.equal(shouldContinueFailed, false, 'Failed state MUST NOT schedule advance effect')

  // Even if a lingering tick fires, clientState.genStatus === 'failed' stops execution
  let callCountAfterFailure = 0
  const runner = async () => {
    if (!shouldScheduleAdvanceEffect(clientState)) return { scheduled: false }
    callCountAfterFailure++
    await runClientTick(clientState, advanceBusyRef, mockFetch)
    return { scheduled: true }
  }

  const tickAttempt = await runner()
  assert.equal(tickAttempt.scheduled, false)
  assert.equal(callCountAfterFailure, 0, 'Zero subsequent advance calls must be scheduled or executed')
  console.log('PASS 2: Failed generation state completely stops automatic continuation (0 subsequent calls)')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 3: Ready state schedules ZERO subsequent advance calls
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 3: Ready state schedules zero subsequent advance calls ---')
  const readyState: ClientExamState = { ...clientState, genStatus: 'ready', readyCount: 19 }
  assert.equal(shouldScheduleAdvanceEffect(readyState), false, 'Ready state MUST NOT schedule advance effect')
  console.log('PASS 3: Ready generation state schedules zero subsequent advance calls')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 4: Generating + actionable work continues sequentially
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 4: Generating state continues sequentially ---')
  const generatingState: ClientExamState = { ...clientState, genStatus: 'generating', readyCount: 14 }
  assert.equal(shouldScheduleAdvanceEffect(generatingState), true, 'Generating state MUST allow sequential advance')

  let sequentialCalls = 0
  const mockSequentialFetch = async () => {
    sequentialCalls++
    if (sequentialCalls === 1) {
      return { success: true, status: 'generating', readyCount: 16, totalSlots: 19 }
    }
    return { success: true, status: 'ready', readyCount: 19, totalSlots: 19 }
  }

  // First chunk
  await runClientTick(generatingState, advanceBusyRef, mockSequentialFetch)
  assert.equal(generatingState.genStatus, 'generating')
  assert.equal(generatingState.readyCount, 16)
  assert.equal(shouldScheduleAdvanceEffect(generatingState), true, 'Generating state continues while not ready')

  // Second chunk finishes exam
  await runClientTick(generatingState, advanceBusyRef, mockSequentialFetch)
  assert.equal(generatingState.genStatus, 'ready')
  assert.equal(generatingState.readyCount, 19)
  assert.equal(shouldScheduleAdvanceEffect(generatingState), false, 'Transition to ready stops subsequent advance')
  console.log('PASS 4: Generating state continues sequentially until transitioning to ready')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 5: StrictMode / In-flight guard prevents concurrent duplicates
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 5: In-flight concurrency guard ---')
  let inFlightCalls = 0
  const slowFetch = async () => {
    inFlightCalls++
    await new Promise(r => setTimeout(r, 40))
    return { success: true, status: 'generating', readyCount: 15, totalSlots: 19 }
  }

  const parallelState: ClientExamState = { ...clientState, genStatus: 'generating', readyCount: 14 }
  const [t1, t2] = await Promise.all([
    runClientTick(parallelState, advanceBusyRef, slowFetch),
    runClientTick(parallelState, advanceBusyRef, slowFetch),
  ])
  assert.equal(t1.executed !== t2.executed, true, 'Exactly one concurrent call must execute')
  assert.equal(t1.skipped !== t2.skipped, true, 'The overlapping call must be skipped')
  assert.equal(inFlightCalls, 1, 'Provider/server must not receive duplicate concurrent calls')
  console.log('PASS 5: In-flight guard prevents concurrent duplicate requests without dropping sequential flow')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 6: Failed incomplete exam renders terminal UI, not "Preparando…"
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 6: Failed incomplete exam renders terminal UI ---')
  // User on question 17 (which is not ready, index 17)
  const failedExamState: ClientExamState = {
    ...clientState,
    genStatus: 'failed',
    readyCount: 17,
    totalSlots: 19,
    currentQuestion: 17,
  }

  const examSlotRender = renderUnreadyExamSlot(failedExamState)
  assert.equal(examSlotRender.hasPreparing, false, 'Failed exam MUST NOT render "Preparando la siguiente pregunta…"')
  assert.equal(examSlotRender.uiTitle, 'No se pudo completar el examen.')
  assert.equal(examSlotRender.uiSubtitle, '17 de 19 preguntas quedaron listas.')
  assert.equal(examSlotRender.hasExit, true, 'Failed exam must render exit button')

  // In preview phase
  const previewRender = renderPreviewHeader(failedExamState)
  assert.equal(previewRender.heading, 'No se pudo completar el examen')
  assert.equal(previewRender.description, '17 de 19 preguntas quedaron listas.')
  assert.equal(previewRender.canStart, false, 'Failed exam in preview MUST NOT allow "Comenzar examen"')
  assert.equal(previewRender.hasExit, true, 'Failed exam in preview must allow exit')
  console.log('PASS 6: Terminal failed UI displays honest completion counts (17 de 19) and never claims to be preparing')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 7: Existing ready questions are preserved
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 7: Preservation of ready questions on failure ---')
  assert.ok(clientState.exam)
  const readyQuestions = clientState.exam.questions.filter(q => q.ready !== false)
  assert.equal(readyQuestions.length, 17, 'All 17 ready questions must be preserved in exam state')
  for (let i = 0; i < 17; i++) {
    assert.equal(readyQuestions[i].id, `q_${i}`)
    assert.equal(readyQuestions[i].prompt, `Pregunta lista ${i}`)
  }
  console.log('PASS 7: All 17 existing ready questions are completely preserved and intact')

  console.log('\nALL 7 FAILED-STATE CLIENT LIFECYCLE CONTRACTS PASSED PERFECTLY!\n')
}

main().catch(err => {
  console.error('CONTRACT TEST FAILED:', err)
  process.exit(1)
})
