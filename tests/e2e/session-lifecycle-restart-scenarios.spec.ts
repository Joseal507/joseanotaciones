import { expect, test, type Page } from '@playwright/test'

// Verificación focalizada (punto 2): READY/IN_PROGRESS/COMPLETED deben restaurarse
// DIRECTAMENTE desde sessionContent[N] ya persistido — CERO llamadas a
// /api/adaptive/session-teach — exactamente la rama de page.tsx que arranca en
// "if (cached && !cachedHasNoBlocks && !cachedPrefetchStale)" (línea ~501).
// FAILED_RECOVERABLE es la única de las cuatro que SÍ debe llamar a session-teach,
// y debe hacerlo reutilizando el sessionPreparation[N] parcial ya persistido (el
// mismo mecanismo probado end-to-end en session-teach-original-failure-reproduction).

const temaId = 'e2e-lifecycle-restart-tema'
const sessionId = 'e2e-lifecycle-restart-session'
const stepId = 'node-lifecycle-restart'

function classContent(sessionNumber: number) {
  return {
    sessionId: 'chapter-lifecycle', sessionTitle: 'Introducción del ciclo de vida', sessionNumber,
    sessionKind: 'introduction', materialType: 'general', academicDomain: 'general',
    sessionIntro: 'Inicio.',
    steps: [
      { id: `${stepId}-1`, type: 'intro', title: 'Paso uno', content: 'Contenido del paso uno.', keyPoints: ['punto uno'], importance: 'important', relatedBlockIds: [] },
      { id: `${stepId}-2`, type: 'concept', title: 'Paso dos', content: 'Contenido del paso dos.', keyPoints: ['punto dos'], importance: 'important', relatedBlockIds: [] },
    ],
    sessionClosing: 'Cierre.', totalSteps: 2,
    assessmentBlueprint: null, evaluationBlocks: [], evaluationProgress: {}, recoveryQueue: [],
  }
}

async function installSession(page: Page, opts: {
  sessionNumber: number
  completed: boolean
  currentSessionNumber: number
  currentStep: number
  withContent: boolean
  sessionPreparation?: Record<string, unknown>
}) {
  let sessionTeachCallCount = 0
  const sessionTeachRequestBodies: any[] = []
  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => {
    sessionTeachCallCount += 1
    sessionTeachRequestBodies.push(route.request().postDataJSON())
    return route.fulfill({ json: { success: true, classContent: classContent(opts.sessionNumber) } })
  })
  await page.addInitScript(({ sessionId, temaId, content, opts }) => {
    const journey = {
      id: 'journey_lifecycle_e2e', version: 1,
      chapters: [{ id: 'chapter-lifecycle', chapterNumber: opts.sessionNumber, kind: 'introduction', status: 'available', blockIds: [], unitIds: [] }],
      totalChapters: 1,
    }
    const session: any = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-lifecycle'], primaryMaterialId: 'material-lifecycle', materialNames: ['Material lifecycle'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [], topics: [] },
      journey, currentSessionNumber: opts.currentSessionNumber, currentStep: opts.currentStep,
      completedSessionNumbers: opts.completed ? [opts.sessionNumber] : [], status: opts.completed ? 'completed' : 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [],
      sessionContent: opts.withContent ? { [String(opts.sessionNumber)]: content } : {},
      sessionPreparation: opts.sessionPreparation || {},
      recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, content: classContent(opts.sessionNumber), opts })
  return { getCallCount: () => sessionTeachCallCount, getRequestBodies: () => sessionTeachRequestBodies }
}

test('READY restart: contenido preparado pero sesión no iniciada -> restaura directo, sin llamar session-teach', async ({ page }) => {
  const spy = await installSession(page, { sessionNumber: 3, completed: false, currentSessionNumber: 1, currentStep: 0, withContent: true })
  await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 2')).toBeVisible()
  expect(spy.getCallCount(), 'READY debe restaurar directo desde sessionContent persistido, sin regenerar').toBe(0)
})

test('IN_PROGRESS restart: sesión activa con progreso -> restaura en el MISMO paso, sin llamar session-teach', async ({ page }) => {
  const spy = await installSession(page, { sessionNumber: 3, completed: false, currentSessionNumber: 3, currentStep: 1, withContent: true })
  await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 2 de 2')).toBeVisible()
  expect(spy.getCallCount(), 'IN_PROGRESS debe restaurar en el mismo currentStep persistido, sin regenerar').toBe(0)
})

test('COMPLETED restart: sesión ya completada -> restaura completada, nunca regenera', async ({ page }) => {
  const spy = await installSession(page, { sessionNumber: 3, completed: true, currentSessionNumber: 1, currentStep: 0, withContent: true })
  await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Sesión completada')).toBeVisible()
  expect(spy.getCallCount(), 'COMPLETED debe restaurar el estado completado ya persistido, sin regenerar').toBe(0)
})

test('FAILED_RECOVERABLE restart+retry: sin sessionContent válido pero con sessionPreparation parcial -> reintenta reutilizando ese estado, no desde cero', async ({ page }) => {
  const partialPreparation = {
    preparationStatus: 'teaching_generation',
    currentGenerationStage: 'session_assembly_failed',
    lastTechnicalError: 'INVALID_ACADEMIC_FRAGMENT:content',
  }
  const spy = await installSession(page, {
    sessionNumber: 3, completed: false, currentSessionNumber: 3, currentStep: 0, withContent: false,
    sessionPreparation: { '3': partialPreparation },
  })
  await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 2')).toBeVisible()
  expect(spy.getCallCount(), 'FAILED_RECOVERABLE debe reintentar preparación (única rama de las 4 que llama session-teach)').toBeGreaterThan(0)
  const firstRequest = spy.getRequestBodies()[0]
  expect(firstRequest.preparationState, 'el retry debe reutilizar el sessionPreparation[3] parcial ya persistido, no partir de cero').toEqual(partialPreparation)
})
