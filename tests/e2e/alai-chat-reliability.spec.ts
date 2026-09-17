import { expect, test } from '@playwright/test'

test('ALAI muestra mensajes humanos ante fallos nuevos, legacy y restaurados', async ({ page }) => {
  let session: unknown = null
  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, sessions: session ? [session] : [] } })
    const body = route.request().postDataJSON(); session = body.session || body
    return route.fulfill({ json: { success: true } })
  })
  await page.route('**/api/enfoques/teorico/start', route => route.fulfill({ json: {
    success: true, sourceSelectionFingerprint: route.request().postDataJSON().sourceSelection.fingerprint,
    totalChars: 20, materials: { 'e2e-free-a': { materialId: 'e2e-free-a', selectedPages: [2, 5], text: 'Material autorizado', nombre: 'Material A', kind: 'pdf', chars: 20 } },
  } }))
  await page.route('**/api/materials/*/download-url', route => route.fulfill({ status: 404, json: {} }))
  const faults = [
    'GENERATION_BUDGET_EXHAUSTED:STRUCTURAL_VALIDATION_FAILED:provider_page_claim_forbidden_use_evidence',
    'GENERATION_BUDGET_EXHAUSTED:STRUCTURAL_VALIDATION_FAILED:material_claim_without_evidence',
    'CHAT_TRANSPORT_TIMEOUT', 'OPENROUTER provider 503 Error: private stack',
    'CHAT_TURN_STORAGE_READ_FAILED:WORKER database stack', 'CHAT_RECOVERABLE_FAILURE',
  ]
  let count = 0
  await page.route('**/api/alai-studyal-chat', route => {
    const detail = faults[Math.min(count++, faults.length - 1)]
    return route.fulfill({ status: 503, json: { success: false, error: detail, detail, userMessage: detail } })
  })
  await page.goto('/e2e-free-continuity?tool=alai')
  const forbidden = /GENERATION_BUDGET_EXHAUSTED|STRUCTURAL_VALIDATION_FAILED|provider_page_claim|material_claim_without_evidence|CHAT_RECOVERABLE_FAILURE|\bstack\b|Error:/
  for (let i = 0; i < faults.length; i++) {
    await page.getByPlaceholder(/Escribe tu pregunta aquí/i).fill(`Pregunta de prueba ${i + 1}`)
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await expect(page.getByTestId('alai-recoverable-turn')).toBeVisible()
    await expect(page.getByRole('button', { name: /Reintentar respuesta/i })).toBeVisible()
    expect(await page.locator('body').innerText()).not.toMatch(forbidden)
  }
  await page.reload()
  await expect(page.getByTestId('alai-recoverable-turn')).toBeVisible()
  expect(await page.locator('body').innerText()).not.toMatch(forbidden)
  expect(count).toBe(faults.length)
})
