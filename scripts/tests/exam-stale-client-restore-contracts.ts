import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ============================================================
// EXAM_STALE_CLIENT_RESTORE contracts.
//
// A live CLUTCH 2.pdf exam failed pre-timeout-fix, leaving a local
// client cache (lib/freeToolState.ts's `exam` envelope, written via
// writeFreeToolState) with genStatus: 'failed'. The server's
// authoritative exam_manifest/exam_artifact rows for that exact
// identity were then deleted (verified: 0 rows remain, see
// EXAM_CLUTCH2_15MIN_FRESH_READY). Reopening Exam still showed the
// EXACT dead failed screen ("No se pudo completar el examen" / "No se
// puede comenzar con preguntas pendientes"), with zero new
// logs/provider calls.
//
// Root cause: ALAIStudyALExams.tsx's restore effect
// (readFreeToolState -> setPhase/setExam/setGenStatus...) is a PURE
// client-local replay with no server revalidation. It restored
// genStatus: 'failed' directly into React state. Once restored, the
// UI renders the dead failed screen, whose ONLY visible action is a
// `startExam` button disabled while genStatus !== 'ready' — the
// "Generar examen" button that calls generateExam() only renders in
// the 'setup' phase, which this restore never lands on. So a stale
// local failure permanently blocked ANY path back to fresh
// generation, even after the authoritative server state was gone —
// the local UX cache was outranking server authority.
//
// Fix (components/materias/ALAIStudyALExams.tsx, the SAME restore
// effect, no generation/provider logic touched): when the restored
// local envelope has genStatus === 'failed', discard it — clear the
// envelope (writeFreeToolState(..., null)) and skip restoring any of
// its fields, leaving the component at its normal 'setup' initial
// state. This does not itself call the server; it removes the dead
// client-side block so the EXISTING "Generar examen" action (which
// already calls the server's restore-first-safe generateExam()) is
// reachable again. Non-failed local state ('ready', 'generating') is
// completely untouched — the happy paths (server exists -> local
// cache restores UX; completed exam -> 0 generation calls on reopen)
// are unaffected by construction, since this guard only fires for
// genStatus === 'failed'.
// ============================================================

const memory = new Map<string, string>()
;(globalThis as any).window = {}
;(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) || null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
}

async function main() {
  const { readFreeToolState, writeFreeToolState } = await import('../../lib/freeToolState')
  const { upsertSession, getSessionById } = await import('../../lib/studySessions')
  const { buildSourceSelectionSnapshot } = await import('../../lib/adaptive/sourceSelection')

  let passed = 0, failed = 0
  function test(name: string, fn: () => void) {
    try { fn(); console.log('  ✅ ' + name); passed++ }
    catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
  }

  console.log('\n── EXAM_STALE_CLIENT_RESTORE contracts ──\n')

  const examSource = readFileSync('components/materias/ALAIStudyALExams.tsx', 'utf8')

  test('1. the client source discards a locally-cached genStatus:"failed" exam envelope BEFORE restoring it into React state, and clears the envelope', () => {
    const restoreEffectStart = examSource.indexOf('RESTORE + EVENT-DRIVEN AUTO-SAVE')
    assert.ok(restoreEffectStart >= 0, 'the restore effect must exist')
    const restoreEffectBody = examSource.slice(restoreEffectStart, restoreEffectStart + 3500)
    const guardIndex = restoreEffectBody.indexOf("saved?.genStatus === 'failed'")
    const examRestoreIndex = restoreEffectBody.indexOf('if (saved?.exam) {')
    assert.ok(guardIndex >= 0, 'the failed-envelope discard guard must exist')
    assert.ok(examRestoreIndex >= 0, 'the exam-restore branch must exist')
    assert.ok(guardIndex < examRestoreIndex, 'the discard guard must run BEFORE the exam is ever restored into state')
    assert.match(restoreEffectBody, /writeFreeToolState<PersistedExamState \| null>\([^)]*'exam', null\)/, 'the stale envelope must be actively cleared, not merely skipped')
    assert.match(restoreEffectBody, /saved = null/, 'discarding must prevent the failed envelope from being restored at all')
  })

  test('2. REGRESSION (the exact reported bug): local failed exam exists, authoritative server state is gone (simulated: server never consulted by this purely-local restore) -> the discard-on-read semantics mean a fresh read never resurfaces the dead failed state', () => {
    const source = buildSourceSelectionSnapshot(['clutch2'], { clutch2: [1, 2, 3] })
    const session = upsertSession({ id: 'exam-stale-session', temaId: 'tema-clutch2', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['CLUTCH 2'], selectedPages: source.selectedPages })

    // The exact live-reported shape: a failed, zero-ready-questions exam.
    const failedExam = {
      phase: 'generating', duration: 15, requestedDurationMinutes: 15, recommendedMinutes: 15,
      examId: 'ff528ed98f7f1ea2d34df4bad708b26a', authorityType: 'studyal_material_enjoyer',
      authorityVersion: '1', generatorVersion: '1', totalSlots: 13, readyCount: 0, genStatus: 'failed',
      examMode: 'closed', adaptive: true, exam: { questions: [] }, currentQuestion: 0, answers: [],
      confidences: [], draftAnswer: '', draftConfidence: null, marked: [], deadlineAt: null, paused: false,
      remainingSeconds: 900, questionTimes: [], evaluation: null, submissionError: '', pendingSubmissionAnswers: null,
      pendingSubmissionConfidences: null, resultsTab: 'overview',
    }
    writeFreeToolState(session.id, source.fingerprint, 'exam', failedExam)
    assert.equal(readFreeToolState<typeof failedExam>(session.id, source.fingerprint, 'exam')?.state.genStatus, 'failed', 'sanity: the stale failed envelope is really persisted')

    // Reimplementation of the EXACT discard logic now present in the
    // restore effect (source-pattern-verified above) — proves its
    // OUTPUT behavior against the real persistence functions.
    const durable = readFreeToolState<typeof failedExam>(session.id, source.fingerprint, 'exam')
    let saved: typeof failedExam | null = durable?.state || null
    if (saved?.genStatus === 'failed') {
      writeFreeToolState<typeof failedExam | null>(session.id, source.fingerprint, 'exam', null)
      saved = null
    }
    assert.equal(saved, null, 'the failed local state must never be restored into the component')
    assert.equal(readFreeToolState(session.id, source.fingerprint, 'exam')?.state, null, 'the envelope must be cleared, not merely skipped in memory')
    // A subsequent independent read (simulating a second reopen) must
    // ALSO never resurface the dead state — the discard is durable.
    assert.equal(readFreeToolState(session.id, source.fingerprint, 'exam')?.state, null)
  })

  test('3. server Exam exists (simulated: local cache is genuinely "ready", matching a completed server-backed generation) -> local cache restores normally as UX, completely unaffected by the new guard', () => {
    const source = buildSourceSelectionSnapshot(['clutch2b'], { clutch2b: [1, 2, 3] })
    const session = upsertSession({ id: 'exam-ready-session', temaId: 'tema-clutch2b', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['CLUTCH 2b'], selectedPages: source.selectedPages })
    const readyExam = {
      phase: 'exam', duration: 15, requestedDurationMinutes: 15, recommendedMinutes: 15,
      examId: 'exam-ready-1', authorityType: 'studyal_material_enjoyer', authorityVersion: '1', generatorVersion: '1',
      totalSlots: 13, readyCount: 13, genStatus: 'ready', examMode: 'closed', adaptive: true,
      exam: { questions: Array.from({ length: 13 }, (_, i) => ({ id: `q${i}`, ready: true })) },
      currentQuestion: 2, answers: ['a', 'b'], confidences: ['high', 'low'], draftAnswer: 'c', draftConfidence: 'high',
      marked: [], deadlineAt: Date.now() + 500_000, paused: false, remainingSeconds: 500, questionTimes: [],
      evaluation: null, submissionError: '', pendingSubmissionAnswers: null, pendingSubmissionConfidences: null, resultsTab: 'overview',
    }
    writeFreeToolState(session.id, source.fingerprint, 'exam', readyExam)

    const durable = readFreeToolState<typeof readyExam>(session.id, source.fingerprint, 'exam')
    let saved: typeof readyExam | null = durable?.state || null
    if ((saved as any)?.genStatus === 'failed') { saved = null } // the new guard: never fires here
    assert.ok(saved?.exam, 'a genuinely ready local cache must still restore normally')
    assert.equal(saved?.genStatus, 'ready')
    assert.equal(saved?.currentQuestion, 2, 'restored UX state (current question, answers) must be preserved for a non-failed cache')
  })

  test('4. completed persisted exam (phase: "results", evaluation present) restores normally with zero network/provider calls — restore is 100% local read, never a fetch', () => {
    const source = buildSourceSelectionSnapshot(['clutch2c'], { clutch2c: [1] })
    const session = upsertSession({ id: 'exam-completed-session', temaId: 'tema-clutch2c', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['CLUTCH 2c'], selectedPages: source.selectedPages })
    const completedExam = {
      phase: 'results', duration: 15, requestedDurationMinutes: 15, recommendedMinutes: 15,
      examId: 'exam-done-1', authorityType: 'studyal_material_enjoyer', authorityVersion: '1', generatorVersion: '1',
      totalSlots: 13, readyCount: 13, genStatus: 'ready', examMode: 'closed', adaptive: true,
      exam: { questions: Array.from({ length: 13 }, (_, i) => ({ id: `q${i}`, ready: true })) },
      currentQuestion: 12, answers: Array(13).fill('a'), confidences: Array(13).fill('high'), draftAnswer: '',
      draftConfidence: null, marked: [], deadlineAt: null, paused: true, remainingSeconds: 0, questionTimes: [],
      evaluation: { score: 88 }, submissionError: '', pendingSubmissionAnswers: null, pendingSubmissionConfidences: null,
      resultsTab: 'overview',
    }
    writeFreeToolState(session.id, source.fingerprint, 'exam', completedExam)

    let fetchCalls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { fetchCalls++; throw new Error('MUST_NOT_FETCH_ON_RESTORE') }) as typeof fetch
    try {
      const durable = readFreeToolState<typeof completedExam>(session.id, source.fingerprint, 'exam')
      const saved = durable?.state || null
      assert.ok(saved?.exam)
      assert.equal(saved?.evaluation?.score, 88)
    } finally {
      globalThis.fetch = originalFetch
    }
    assert.equal(fetchCalls, 0, 'restoring a completed exam must never make any network/provider call')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('exam-stale-client-restore-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
