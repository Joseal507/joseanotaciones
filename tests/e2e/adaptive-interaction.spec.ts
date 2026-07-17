import { expect, test } from '@playwright/test'
import { evaluation, mockAdaptive, questionPage, theoryPage } from './adaptive-fixtures'

test('04 Entendido avanza una sola vez', async ({ page }) => {
  const harness = await mockAdaptive(page, [{ page: theoryPage() }, { page: questionPage() }])
  await page.goto('/e2e-adaptive')
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-interaction')).toBeVisible()
  expect(harness.calls()).toBe(2)
})

test('05 doble clic produce una sola evaluación', async ({ page }) => {
  const harness = await mockAdaptive(page, [{ page: questionPage('q-double') }, { page: questionPage('q-next'), evaluation: evaluation('q-double') }])
  await page.goto('/e2e-adaptive')
  await page.getByRole('button', { name: '-3.4', exact: true }).click()
  await page.getByRole('button', { name: /Responder/ }).dblclick()
  await expect(page.getByTestId('adaptive-feedback')).toBeVisible()
  expect(harness.calls()).toBe(2)
})

async function reachFeedback(page: import('@playwright/test').Page) {
  const harness = await mockAdaptive(page, [
    { page: questionPage('q1') },
    { page: questionPage('q2'), evaluation: evaluation('q1') },
  ])
  await page.goto('/e2e-adaptive')
  await page.getByRole('button', { name: '-3.4', exact: true }).click()
  await page.getByRole('button', { name: /Responder/ }).click()
  return harness
}

test('07 evaluar muestra feedback completo', async ({ page }) => {
  await reachFeedback(page)
  const feedback = page.getByTestId('adaptive-feedback')
  await expect(feedback).toContainText('Correcto')
  await expect(feedback).toContainText('La respuesta conserva el significado y la unidad.')
})

test('08 confianza no avanza', async ({ page }) => {
  const harness = await reachFeedback(page)
  await page.getByRole('button', { name: 'Bastante seguro/a' }).click()
  await expect(page.getByTestId('adaptive-page')).toHaveAttribute('data-interaction-id', 'q1')
  expect(harness.calls()).toBe(2)
})

test('09 Continuar es el único avance', async ({ page }) => {
  await reachFeedback(page)
  await page.getByRole('button', { name: 'Bastante seguro/a' }).click()
  await expect(page.getByTestId('adaptive-page')).toHaveAttribute('data-interaction-id', 'q1')
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-page')).toHaveAttribute('data-interaction-id', 'q2')
})

test('10 última respuesta no cierra antes de Continuar', async ({ page }) => {
  await mockAdaptive(page, [{ page: questionPage('last') }, { page: questionPage('last'), evaluation: evaluation('last'), shouldCloseSession: true, sessionPersisted: true, summary: { microsCompleted: 1, microsTotal: 1 } }])
  await page.goto('/e2e-adaptive'); await page.getByRole('button', { name: '-3.4', exact: true }).click(); await page.getByRole('button', { name: /Responder/ }).click()
  await page.getByRole('button', { name: 'Más o menos' }).click()
  await expect(page.getByTestId('adaptive-session-summary')).toHaveCount(0)
})

test('11 nueva pregunta limpia confianza anterior', async ({ page }) => {
  const harness = await mockAdaptive(page, [
    { page: questionPage('q1') }, { page: questionPage('q2'), evaluation: evaluation('q1') },
  ])
  await page.goto('/e2e-adaptive')
  await page.getByRole('button', { name: '-3.4', exact: true }).click(); await page.getByRole('button', { name: /Responder/ }).click()
  await page.getByRole('button', { name: 'Bastante seguro/a' }).click()
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-page')).toHaveAttribute('data-interaction-id', 'q2')
  await expect(page.getByTestId('adaptive-confidence')).toHaveCount(0)
  await expect(page.getByTestId('adaptive-session')).toHaveAttribute('data-interaction-phase', 'answering')
  expect(harness.calls()).toBe(2)
})
