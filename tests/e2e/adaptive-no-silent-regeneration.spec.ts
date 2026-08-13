import { expect, test } from '@playwright/test'

// StudyAL_Visual_System_Stress_Test — Layer B GAP "NO REGENERACIÓN
// SILENCIOSA" (pedido explícito del usuario, sección 10). Contrato exacto:
// programa que YA llegó a READY antes + restore que temporalmente carece de
// blueprint/journey -> NUNCA generar automáticamente un blueprint/plan
// nuevo. Debe: reintentar restore (implícito, vía "Reintentar preparación
// del plan"), mostrar recovery explícito, y regenerar SOLO tras acción
// explícita del usuario (clic).
//
// Server GET devuelve deliberadamente adaptiveState:'ready' PERO sin
// blueprint/journey — exactamente el "hueco de restauración" (server
// devolvió el setup/estado pero blueprint/journey no llegaron, p.ej. por
// una falla de red parcial o una sesión vieja) que StudyALAdaptive.tsx debe
// distinguir de un setup genuinamente nuevo (restoreGapAfterReady).

const serverSessionWithGap = {
  id: 'journey-plan-e2e',
  temaId: 'tema-plan-e2e',
  enfoque: 'teorico',
  processMode: 'adaptive',
  studyMode: 'adaptive',
  materialIds: ['mat-plan-e2e'],
  materialNames: ['Material persistido'],
  selectedPages: { 'mat-plan-e2e': [1] },
  adaptiveSetup: {
    knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80,
    mainConcern: '', professorExamStyle: [], evalPreference: 'mixed', planView: 'book',
    completedAt: 100,
  },
  setupHash: 'hash-no-silent-regen-e2e',
  // Deliberadamente SIN blueprint ni journey — el hueco de restauración real.
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

test('no regeneración silenciosa: READY previo + blueprint/journey ausentes -> NUNCA autogenera, muestra recovery explícito, regenera SOLO tras clic', async ({ page }) => {
  const generationRequests: string[] = []
  page.on('request', request => {
    if (/\/api\/adaptive\/(?:blueprint|generate-plan)/.test(request.url())) {
      generationRequests.push(request.url())
    }
  })

  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [serverSessionWithGap] }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })
  // Si el usuario NO pulsa reintentar, esta ruta nunca debería alcanzarse —
  // si se alcanza sin el clic explícito, generationRequests lo capturará.
  await page.route('**/api/adaptive/blueprint', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'not_relevant_to_this_test' }) })
  })

  await page.goto('/e2e-adaptive?planRestore=1')

  // Recovery explícito visible — nunca la pantalla de "Generando tu plan".
  await expect(page.getByText(/no pudimos restaurar todos los datos guardados/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Generando tu plan/i)).toHaveCount(0)

  // Botón de reintento explícito visible — la única vía de regeneración.
  const retryButton = page.getByRole('button', { name: 'Reintentar preparación del plan' })
  await expect(retryButton).toBeVisible()

  // Antes de pulsar: CERO llamadas de generación — nada se disparó solo.
  expect(generationRequests).toEqual([])

  // Reload adicional (simula otra navegación/otro tick del restore) — sigue
  // sin regenerar solo, el gap persiste honestamente hasta que el usuario actúe.
  await page.reload()
  await expect(page.getByText(/no pudimos restaurar todos los datos guardados/i)).toBeVisible({ timeout: 15_000 })
  expect(generationRequests).toEqual([])

  // Acción explícita del usuario: SOLO ahora es correcto regenerar.
  await page.getByRole('button', { name: 'Reintentar preparación del plan' }).click()
  await expect.poll(() => generationRequests.length, { timeout: 10_000 }).toBeGreaterThan(0)
  console.log('adaptive-no-silent-regeneration: READY + gap -> 0 llamadas hasta el clic explícito, luego regenera PASS')
})
