import { expect, test } from '@playwright/test'
import { evaluation, mockAdaptive, questionPage, theoryPage } from './adaptive-fixtures'

test('06 loading perceptible oculta y bloquea el contenido anterior', async ({ page }) => {
  await mockAdaptive(page, [{ page: theoryPage('Contenido anterior') }, { page: questionPage('next-valid', { interactionType: 'fill_blank_bank' }) }], { delayAt: 1 })
  await page.goto('/e2e-adaptive')
  await expect(page.getByText('Contenido anterior')).toBeVisible()
  await page.getByTestId('adaptive-continue').click()
  const loading = page.getByTestId('adaptive-evaluating')
  await expect(loading).toBeVisible()
  await expect(loading).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByTestId('adaptive-loading-indicator')).toContainText('ALAI está preparando la siguiente actividad')
  await expect(page.getByTestId('adaptive-page')).toHaveCount(0)
  await expect(page.getByText('Contenido anterior')).toHaveCount(0)
  await expect(page.getByTestId('adaptive-loading-indicator').locator('span')).toHaveCSS('animation-name', 'v3LoadingPulse')
  await expect(page.getByTestId('adaptive-page')).toHaveAttribute('data-interaction-id', 'next-valid')
  await expect(loading).toHaveCount(0)
  await expect(page.getByTestId('adaptive-interaction')).toHaveCount(1)
})
