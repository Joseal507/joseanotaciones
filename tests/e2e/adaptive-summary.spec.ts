import { expect, test } from '@playwright/test'
import { evaluation, mockAdaptive, questionPage } from './adaptive-fixtures'

async function closeIntoSummary(page: import('@playwright/test').Page) {
  await mockAdaptive(page, [{ page: questionPage('sum') }, {
    page: questionPage('sum'), evaluation: evaluation('sum'), shouldCloseSession: true, sessionPersisted: true,
    summary: { microsCompleted: 2, microsTotal: 3, totalCorrect: 1, totalIncorrect: 1, studiedMicroNames: ['Energía cuantizada'], provisionallyMasteredMicroNames: ['Transiciones electrónicas'], reinforcementMicroNames: ['Espectro de emisión'], studiedMicroIds: ['micro_internal'] },
  }])
  await page.goto('/e2e-adaptive'); await page.getByRole('button', { name: '-3.4', exact: true }).click(); await page.getByRole('button', { name: /Responder/ }).click(); await page.getByRole('button', { name: 'Más o menos' }).click(); await page.getByTestId('adaptive-continue').click()
}

test('12 no aparecen microIds', async ({ page }) => {
  await closeIntoSummary(page)
  await expect(page.getByText(/micro_internal/)).toHaveCount(0)
})

test('13 resumen tiene scroll', async ({ page }) => {
  await closeIntoSummary(page)
  await expect(page.getByTestId('adaptive-summary-scroll')).toHaveCSS('overflow-y', 'auto')
})

test('14 resumen usa nombres humanos', async ({ page }) => {
  await closeIntoSummary(page)
  await expect(page.getByText('Energía cuantizada')).toBeVisible()
  await expect(page.getByText('Transiciones electrónicas')).toBeVisible()
  await expect(page.getByText('Espectro de emisión')).toBeVisible()
})

test('15 trabajado, dominado y refuerzo no se mezclan', async ({ page }) => {
  await closeIntoSummary(page)
  const studied = page.getByTestId('summary-studied')
  const mastered = page.getByTestId('summary-mastered')
  const reinforcement = page.getByTestId('summary-reinforcement')
  await expect(studied).toContainText('Energía cuantizada')
  await expect(studied).not.toContainText(/Transiciones electrónicas|Espectro de emisión/)
  await expect(mastered).toContainText('Transiciones electrónicas')
  await expect(mastered).not.toContainText(/Energía cuantizada|Espectro de emisión/)
  await expect(reinforcement).toContainText('Espectro de emisión')
  await expect(reinforcement).not.toContainText(/Energía cuantizada|Transiciones electrónicas/)
})
