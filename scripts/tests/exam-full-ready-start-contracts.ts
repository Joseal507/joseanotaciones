import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import Exam, { isExamFullyReady } from '../../components/materias/ALAIStudyALExams'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { upsertSession } from '../../lib/studySessions'
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState'

async function main() {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
  const storage = new Map<string, string>()
  Object.assign(globalThis, {
    window, document, React, IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: { getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
  })
  window.HTMLElement.prototype.scrollIntoView = () => {}
  // All I/O is intercepted, including delayed session synchronization.
  globalThis.fetch = async () => Response.json({ success: false })
  const selection = buildSourceSelectionSnapshot(['gate-material'], { 'gate-material': [1] })
  const questions = Array.from({ length: 58 }, (_, i) => ({
    id: 'q' + i, type: 'true_false' as const, prompt: 'Frozen statement',
    points: 10, section: 'I', skill: 'retention' as const, difficulty: 'basic' as const,
    ready: true,
  }))
  const exam = { id: 'gate-exam', title: 'Exam', questions, sections: [], totalPoints: 580, estimatedDifficulty: 'medium' as const, coverage: '' }
  for (const status of ['generating', 'retrying', 'paused', 'failed', 'grading']) {
    assert.equal(isExamFullyReady(exam, status, 58, 58), false)
  }
  assert.equal(isExamFullyReady(exam, 'ready', 57, 58), false)
  assert.equal(isExamFullyReady({ ...exam, questions: [] }, 'ready', 0, 0), false)
  assert.equal(isExamFullyReady({ ...exam, questions: questions.map((q, i) => ({ ...q, ready: i !== 0 })) }, 'ready', 58, 58), false)
  const container = document.getElementById('root')!
  const root = createRoot(container)
  const cases = [
    { id: 'ready', status: 'ready', count: 58 },
    { id: 'partial', status: 'generating', count: 9 },
    { id: 'failed', status: 'failed', count: 57 },
    { id: 'readyAgain', status: 'ready', count: 58 },
  ]
  let staleStart: (() => void) | undefined
  try {
    for (const item of cases) {
      const session = upsertSession({ id: item.id, processMode: 'free', enfoque: 'mixto',
        materialIds: ['gate-material'], selectedPages: { 'gate-material': [1] }, temaId: item.id,
        notes: { freeTools: {} } })
      const fp = session.sourceSelectionFingerprint!
      writeFreeToolState(session.id, fp, 'exam', {
        phase: 'preview', exam, examId: exam.id, attemptId: item.id, duration: 90,
        genStatus: item.status, readyCount: item.count, totalSlots: 58,
        examMode: 'closed', adaptive: true, answers: [], confidences: [], questionTimes: [],
      })
      await act(async () => root.render(React.createElement(Exam, {
        materiales: [{ id: 'gate-material' }], tema: { id: item.id }, materia: {},
        onBack: () => {}, sessionId: session.id, sourceSelection: selection,
      })))
      const button = container.querySelector<HTMLButtonElement>('[data-testid="exam-start-taking"]')
      if (item.status !== 'ready') {
        assert.equal(button, null, item.id + ': no actionable start')
        // Invoke the actual callback captured while this same component was ready.
        assert.ok(staleStart)
        await act(async () => staleStart!())
        assert.equal(readFreeToolState<{phase: string}>(session.id, fp, 'exam')?.state.phase, 'preview')
      } else {
        assert.ok(button)
        if (item.id === 'ready') {
          const propsKey = Object.keys(button).find(key => key.startsWith('__reactProps'))
          assert.ok(propsKey)
          staleStart = (Reflect.get(button, propsKey) as {onClick: () => void}).onClick
        } else {
          await act(async () => button.click())
          assert.equal(readFreeToolState<{phase: string}>(session.id, fp, 'exam')?.state.phase, 'exam')
        }
      }
    }
  } finally { await act(async () => root.unmount()) }
  console.log('PASS full-ready production UI, stale programmatic handler, failed state and ready start')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
