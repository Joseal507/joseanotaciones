import { expect, test, type Page } from '@playwright/test'
import { runSessionContentGenerationPipeline } from '../../lib/ai/sessionContentGenerationPipeline'

const sessionId = 'e2e-session-kind-falcons'
const temaId = 'e2e-session-kind-tema'

test('session_content recupera una primera salida INVALID_JSON dentro de la misma operación', async () => {
  let remoteCalls = 0
  const startedAt = Date.now()
  const result = await runSessionContentGenerationPipeline({
    generationKey: 'e2e:chapter_2:invalid-json',
    generate: async context => {
      remoteCalls += 1
      return { text: context.stage === 'complete_generation'
        ? '{"steps": [}'
        : '{"steps":[{"id":"step_1"}],"evaluationBlocks":[]}' }
    },
    validate: value => {
      const candidate = value as { steps?: unknown[]; evaluationBlocks?: unknown[] }
      const valid = Array.isArray(candidate?.steps) && Array.isArray(candidate?.evaluationBlocks)
      return { valid, errors: valid ? [] : ['INVALID_JSON'] }
    },
  })
  expect(result.status).toBe('validated')
  expect(remoteCalls).toBe(2)
  expect(result.remoteCalls).toBe(2)
  console.log(`session_content INVALID_JSON recovery E2E latency: ${Date.now() - startedAt}ms`)
})

async function installFixture(page: Page) {
  const requests = { sessionEval: 0, planGeneration: 0 }
  page.on('request', request => {
    if (request.url().includes('/api/adaptive/session-eval')) requests.sessionEval += 1
    if (/\/api\/adaptive\/(?:blueprint|generate-plan)/.test(request.url())) requests.planGeneration += 1
  })
  await page.route('**/api/study-sessions**', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { success: true, sessions: [] } })
    : route.fulfill({ json: { success: true } }))
  await page.route('**/api/adaptive/session-eval', route => route.fulfill({ status: 500, body: 'SESSION_EVAL_FORBIDDEN' }))
  await page.addInitScript(({ sessionId, temaId }) => {
    if (localStorage.getItem('studyal_sessions_v4')?.includes(sessionId)) return
    const step = (id: string, title: string) => ({
      id, type: 'concept', title, content: `Contenido docente persistido para ${title}.`,
      keyPoint: null, keyPoints: [], importance: 'supporting', relatedBlockIds: [],
    })
    const content = (number: number, kind: string, title: string) => ({
      sessionId: `chapter-${number}`, sessionTitle: title, sessionNumber: number, sessionKind: kind,
      materialType: 'pdf', sessionIntro: `Inicio ${title}`, steps: [step(`${number}-a`, `${title} A`), step(`${number}-b`, `${title} B`)],
      sessionClosing: `Cierre ${title}`, totalSteps: 2, evaluationBlocks: [], evaluationProgress: {}, recoveryQueue: [],
    })
    const chapters = [
      { id: 'chapter-1', chapterNumber: 1, kind: 'introduction', status: 'available', blockIds: [], unitIds: [], arcRole: 'orientation' },
      { id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'locked', blockIds: ['b1'], unitIds: ['u1'], arcRole: 'mechanism' },
      { id: 'chapter-3', chapterNumber: 3, kind: 'final_review', status: 'locked', blockIds: [], unitIds: [], arcRole: 'final_review' },
    ]
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['falcons-material'], primaryMaterialId: 'falcons-material', materialNames: ['Falcons'], selectedPages: {},
      adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, mainConcern: '', professorExamStyle: [], evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, blocks: [{ id: 'b1' }], topics: [] },
      journey: { id: 'falcons-plan', version: 4, chapters, totalChapters: 3 },
      currentSessionNumber: 1, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: true, unresolvedMicroIds: [],
      sessionContent: { '1': content(1, 'introduction', 'Introducción Falcons'), '3': content(3, 'final_review', 'Integración Falcons') },
      recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey: session.journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId })
  return requests
}

test('introduction avanza, restaura y completa sin evaluación ni evidencia', async ({ page }) => {
  const requests = await installFixture(page)
  await page.goto(`/materias/${temaId}/sesion/1?adaptiveSessionId=${sessionId}`)
  await expect(page.getByTestId('adaptive-session-root')).toHaveAttribute('data-session-kind', 'introduction')
  await expect(page.getByText('Sesión sin evaluación.')).toBeVisible()
  await expect(page.getByText('Preparando evaluación...')).toHaveCount(0)
  await page.getByRole('button', { name: 'Continuar →' }).click()
  await page.reload()
  await expect(page.getByText('Paso 2 de 2')).toBeVisible()
  await page.getByRole('button', { name: '🎉 Terminar' }).click()
  await expect(page.getByText('Sesión completada')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Sesión completada')).toBeVisible()
  expect(requests.sessionEval).toBe(0)
  const stored = await page.evaluate(id => JSON.parse(localStorage.getItem('studyal_adaptive_artifacts_v1') || '{}')[id], sessionId)
  expect(stored.sessionContent['1'].assessmentBlueprint).toBeUndefined()
  expect(stored.sessionContent['1'].recoveryQueue).toEqual([])
})

test('final_review restaura, completa y vuelve al mismo plan sin generación ni evaluación', async ({ page }) => {
  const requests = await installFixture(page)
  await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
  await expect(page.getByTestId('adaptive-session-root')).toHaveAttribute('data-session-kind', 'final_review')
  await page.getByRole('button', { name: 'Continuar →' }).click()
  await page.reload()
  await expect(page.getByText('Paso 2 de 2')).toBeVisible()
  await page.getByRole('button', { name: '🎉 Terminar' }).click()
  await expect(page.getByText('Sesión completada')).toBeVisible()
  await page.getByRole('button', { name: '📋 Plan' }).click()
  await expect(page).toHaveURL(new RegExp(`adaptiveSessionId=${sessionId}.*adaptiveView=plan|adaptiveView=plan.*adaptiveSessionId=${sessionId}`), { timeout: 20_000 })
  expect(requests.sessionEval).toBe(0)
  expect(requests.planGeneration).toBe(0)
})

test('introduction → learning conserva el plan y solo reintenta session_content por acción explícita', async ({ page }) => {
  await installFixture(page)
  let sessionTeachRequests = 0
  await page.route('**/api/adaptive/session-teach', async route => {
    sessionTeachRequests += 1
    if (sessionTeachRequests === 1) {
      await route.fulfill({ status: 503, json: { success: false, error: 'SESSION_CONTENT_PREPARATION_FAILED', retryable: true } })
      return
    }
    await route.fulfill({ json: {
      success: true,
      classContent: {
        sessionId: 'chapter-2', sessionTitle: 'Falcons — aprendizaje', sessionNumber: 2,
        sessionKind: 'learning', materialType: 'pdf', sessionIntro: 'Aprendizaje Falcons.',
        steps: [{
          id: 'learning-step-1', type: 'concept', title: 'Liderazgo sostenido',
          content: 'Matt Ryan aportó estabilidad y liderazgo sostenido durante más de una década.',
          keyPoint: 'Liderazgo sostenido', keyPoints: ['Liderazgo sostenido'], importance: 'important',
          relatedBlockIds: ['b1'],
        }],
        sessionClosing: 'Cierre.', totalSteps: 1, evaluationProgress: {}, recoveryQueue: [],
        evaluationBlocks: [{
          id: 'learning-block-1', afterStepId: 'learning-step-1',
          coveredStepIds: ['learning-step-1'], coveredKeyPoints: ['Liderazgo sostenido'],
          questions: [{
            id: 'learning-question-1', conceptId: 'learning-step-1', conceptLabel: 'Liderazgo sostenido',
            teachingBlockId: 'learning-step-1', questionFamily: 'leadership', variant: 'true_false_factual',
            difficulty: 'easy', targetDimension: 'recognition', format: 'true_false',
            questionText: 'Matt Ryan aportó estabilidad y liderazgo sostenido.', options: null,
            correctAnswer: true, explanation: 'Coincide con el contenido enseñado.', hint: 'Recuerda el aporte.',
            estimatedSeconds: 15, evidencesNeeded: 1, factKey: 'Liderazgo sostenido',
            factKeys: ['Liderazgo sostenido'], coveredKeyPoints: ['Liderazgo sostenido'], coveredStepIds: ['learning-step-1'],
          }],
        }],
      },
    } })
  })

  await page.goto(`/materias/${temaId}/sesion/1?adaptiveSessionId=${sessionId}`)
  await page.getByRole('button', { name: 'Continuar →' }).click()
  await page.getByRole('button', { name: '🎉 Terminar' }).click()
  await page.getByRole('button', { name: 'Siguiente →' }).click()
  await expect(page.getByRole('button', { name: 'Reintentar preparar sesión' })).toBeVisible()
  await expect(page.getByText(/INVALID_JSON|SESSION_CONTENT|503/)).toHaveCount(0)
  expect(sessionTeachRequests).toBe(1)

  const retryStartedAt = Date.now()
  await page.getByRole('button', { name: 'Reintentar preparar sesión' }).click()
  await expect(page.getByTestId('adaptive-session-root')).toHaveAttribute('data-session-kind', 'learning')
  await expect(page.getByRole('heading', { name: 'Liderazgo sostenido' })).toBeVisible()
  expect(sessionTeachRequests).toBe(2)
  console.log(`session_content explicit retry E2E latency: ${Date.now() - retryStartedAt}ms`)
})
