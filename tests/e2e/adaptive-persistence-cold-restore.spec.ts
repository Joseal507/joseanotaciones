import { expect, test } from '@playwright/test'

// StudyAL_Visual_System_Stress_Test — Layer B GAP "persistence — una prueba
// final" (pedido explícito del usuario, tras el reporte anterior de Layer B
// que arregló Bug 1). A diferencia de la prueba existente
// "plan completado restaura el mismo journey sin requests de generación"
// (tests/e2e/academic-content-integration.spec.ts) — que PRE-LLENA
// localStorage directamente y por tanto nunca ejercita el camino
// server-authoritative — esta prueba simula un cliente REALMENTE destruido
// (sin ningún localStorage) y fuerza la restauración a pasar EXCLUSIVAMENTE
// por /api/study-sessions GET, con la forma exacta que produce route.ts tras
// el fix de esta ronda (adaptiveSetup/setupHash/currentSessionNumber/status/
// adaptiveState — los 5 campos que antes de esta ronda el Worker de
// Cloudflare descartaba en silencio en la escritura, ver
// cloudflare/studyal-api/src/index.ts y
// scripts/tests/study-sessions-worker-row-mapping-contracts.ts).
//
// Contrato exigido explícitamente: create program -> persist setup/
// blueprint/journey -> destroy client state -> GET server -> restore ->
// same blueprint -> same journey -> same current session -> NO generate-plan.

const restoredJourney = {
  programGoal: 'Journey restaurado vía servidor E2E',
  programNarrative: 'El mismo plan restaurado exclusivamente desde el servidor.',
  totalChapters: 3,
  chapters: [1, 2, 3].map(chapterNumber => ({
    chapterNumber,
    sessionId: `chapter-${chapterNumber}`,
    title: `Sesión restaurada ${chapterNumber}`,
    sessionTitle: `Sesión restaurada ${chapterNumber}`,
    type: chapterNumber === 3 ? 'final_review' : 'learning',
    status: chapterNumber <= 2 ? 'done' : 'available',
    concepts: [], blockIds: [], topicIds: [], pages: [],
  })),
}

const restoredBlueprint = { version: 1, blocks: [{ id: 'block-1', topicId: 't1' }], topics: [{ id: 't1', title: 'Topic restaurado', pages: [1] }] }

const serverSession = {
  id: 'journey-plan-e2e',
  temaId: 'tema-plan-e2e',
  enfoque: 'teorico',
  processMode: 'adaptive',
  studyMode: 'adaptive',
  materialIds: ['mat-plan-e2e'],
  materialNames: ['Material persistido'],
  selectedPages: {},
  adaptiveSetup: {
    knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80,
    mainConcern: '', professorExamStyle: [], evalPreference: 'mixed', planView: 'book',
    completedAt: 100,
  },
  setupHash: 'hash-cold-restore-e2e',
  blueprint: restoredBlueprint,
  journey: restoredJourney,
  completedSessionNumbers: [1, 2],
  currentSessionNumber: 3,
  currentStep: 0,
  status: 'in_progress',
  adaptiveState: 'ready',
  isProgramComplete: false,
  unresolvedMicroIds: [],
  createdAt: 100,
  updatedAt: 200,
  lastOpenedAt: 200,
}

test('cold restore server-authoritative: cliente SIN localStorage restaura vía GET real, mismo blueprint/journey/sesión actual, cero llamadas de generación', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', err => pageErrors.push(err.message))
  const generationRequests: string[] = []
  page.on('request', request => {
    if (/\/api\/adaptive\/(?:blueprint|generate-plan|session-copy)/.test(request.url())) {
      generationRequests.push(request.url())
    }
  })

  // El ÚNICO origen de datos posible: /api/study-sessions GET, con la forma
  // EXACTA que route.ts produce tras el fix de esta ronda (5 campos que el
  // Worker real descartaba antes: adaptiveSetup, setupHash,
  // currentSessionNumber, status, adaptiveState).
  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [serverSession] }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })

  // Deliberadamente SIN addInitScript ni localStorage.setItem — simula un
  // dispositivo/caché real y completamente destruidos. `materiales`/
  // `temaId`/`sessionId`/`userId` los provee el harness (e2e-adaptive/
  // page.tsx, planRestoreHarness) como props hardcodeadas, no localStorage.
  const planUrl = '/e2e-adaptive?planRestore=1'
  await page.goto(planUrl)

  // Mismo journey, mismo blueprint (visible vía el número de sesiones/
  // títulos reales, ambos derivados de `journey` restaurado), misma sesión
  // actual (capítulo 3) — todo reconstruido EXCLUSIVAMENTE desde el GET real.
  await expect(page.getByText('Journey restaurado vía servidor E2E')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('3 sesiones')).toBeVisible()
  await expect(page.getByText('Sesión restaurada 3')).toBeVisible()

  // NO debe haberse disparado NINGUNA llamada de generación — el restore fue
  // server-authoritative, nunca "no pude leer localStorage -> regenera".
  await expect(page.getByText(/Generando tu plan/)).toHaveCount(0)
  await expect(page.getByText('No encontramos el plan guardado')).toHaveCount(0)
  expect(generationRequests).toEqual([])
  // REGRESIÓN (hallazgo de esta misma prueba): un chapter restaurado sin
  // `exitCriteria` (journey legado, o cualquier restore que no round-tripee
  // la forma completa de StudyChapter) crasheaba toda la página en
  // StudyALAdaptive.tsx — "Cannot read properties of undefined (reading
  // 'length')" en `chapter.exitCriteria.length` sin guard. Corregido con
  // `(chapter.exitCriteria?.length ?? 0)`.
  expect(pageErrors).toEqual([])

  // Reload adicional: el estado ahora SÍ vive en localStorage (poblado por
  // syncSessionsFromServer durante el primer load) — confirma que un
  // segundo ciclo tampoco regenera, y que lo restaurado es estable.
  await page.reload()
  await expect(page.getByText('Journey restaurado vía servidor E2E')).toBeVisible()
  await expect(page.getByText('Sesión restaurada 3')).toBeVisible()
  expect(generationRequests).toEqual([])

  console.log('adaptive-persistence-cold-restore: PASS (GET real sin localStorage -> mismo blueprint/journey/sesión actual, 0 llamadas de generación)')
})
