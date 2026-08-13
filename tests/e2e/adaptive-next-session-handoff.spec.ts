import { expect, test } from '@playwright/test'
import { sourceSelectionFingerprint } from '../../lib/adaptive/sourceSelection'

test('Siguiente se une al prefetch N+1 en curso y conserva source snapshot', async ({ page }) => {
  const sessionId = 'e2e-next-handoff'
  const temaId = 'e2e-next-handoff-tema'
  const calls: Array<{ origin: string; fingerprint: string }> = []
  await page.route('**/api/study-sessions**', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { success: true, sessions: [] } })
    : route.fulfill({ json: { success: true } }))
  await page.route('**/api/adaptive/session-teach', async route => {
    const body = route.request().postDataJSON()
    calls.push({ origin: body.requestOrigin || 'cold', fingerprint: body.sourceSelectionFingerprint })
    await new Promise(resolve => setTimeout(resolve, 900))
    await route.fulfill({ json: { success: true, classContent: {
      sessionId: 'chapter-2', sessionTitle: 'Sesión 2', sessionNumber: 2, sessionKind: 'learning', materialType: 'pdf',
      sessionIntro: 'Inicio', steps: [{ id: 's2', type: 'concept', title: 'Contenido', content: 'AUTHORIZED_ALPHA y AUTHORIZED_BETA.', keyPoints: ['Autorizado'], importance: 'important', relatedBlockIds: ['a', 'b'] }],
      sessionClosing: 'Cierre', totalSteps: 1, evaluationProgress: {}, recoveryQueue: [],
      evaluationBlocks: [{ id: 'eval-2', afterStepId: 's2', coveredStepIds: ['s2'], coveredKeyPoints: ['Autorizado'], questions: [{ id: 'q2', questionId: 'q2', conceptId: 's2', conceptLabel: 'Contenido', teachingBlockId: 's2', questionFamily: 'handoff', variant: 'true_false_factual', difficulty: 'easy', targetDimension: 'recognition', format: 'true_false', questionText: 'El contenido es autorizado.', options: null, correctAnswer: true, explanation: 'Sí.', hint: 'Revisa.', estimatedSeconds: 15, evidencesNeeded: 1, factKey: 'f2', factKeys: ['f2'], coveredKeyPoints: ['Autorizado'], coveredStepIds: ['s2'] }] }],
    } } })
  })
  await page.addInitScript(({ sessionId, temaId }) => {
    const selectedPages = { mat_a: [2, 3], mat_b: [1, 7] }
    const intro = { sessionId: 'chapter-1', sessionTitle: 'Introducción', sessionNumber: 1, sessionKind: 'introduction', materialType: 'pdf', sessionIntro: 'Inicio', steps: [{ id: 'intro', type: 'intro', title: 'Inicio', content: 'Bienvenida.', keyPoints: [], importance: 'supporting', relatedBlockIds: [] }], sessionClosing: 'Cierre', totalSteps: 1, evaluationBlocks: [], evaluationProgress: {}, recoveryQueue: [] }
    const chapters = [{ id: 'chapter-1', chapterNumber: 1, kind: 'introduction', blockIds: [] }, { id: 'chapter-2', chapterNumber: 2, kind: 'learning', blockIds: ['a', 'b'] }]
    const session = { id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive', materialIds: ['mat_a', 'mat_b'], materialNames: ['A', 'B'], selectedPages, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, mainConcern: '', professorExamStyle: [], evalPreference: 'quick_test', planView: 'book', completedAt: 1 }, blueprint: { version: 2, blocks: [{ id: 'a' }, { id: 'b' }], topics: [] }, journey: { id: 'journey-handoff', version: 3, chapters, totalChapters: 2 }, currentSessionNumber: 1, currentStep: 0, completedSessionNumbers: [1], status: 'in_progress', adaptiveState: 'studying', sessionContent: { '1': intro }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1 }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey: session.journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId })

  await page.goto(`/materias/${temaId}/sesion/1?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Sesión completada')).toBeVisible()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].origin).toBe('prefetch')
  await page.getByRole('button', { name: 'Siguiente →' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(page.getByRole('heading', { level: 1, name: 'Sesión 2' })).toBeVisible({ timeout: 15_000 })
  expect(calls).toHaveLength(1)
  expect(calls[0].fingerprint).toBe(sourceSelectionFingerprint(['mat_a', 'mat_b'], { mat_a: [2, 3], mat_b: [1, 7] }))
  await expect(page.getByText(/FORBIDDEN_/)).toHaveCount(0)
})
