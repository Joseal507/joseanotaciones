import { expect, test } from '@playwright/test'
import { mockAdaptive, theoryPage } from './adaptive-fixtures'

test('16 Ver mi progreso vuelve al libro canónico', async ({ page }) => {
  await mockAdaptive(page, [{ page: theoryPage(), shouldCloseSession: true, sessionPersisted: true, summary: { microsCompleted: 1, microsTotal: 1 } }])
  await page.goto('/e2e-adaptive'); await page.getByTestId('adaptive-continue').click(); await page.getByRole('button', { name: /Ver mi progreso/ }).click()
  await expect(page.getByTestId('canonical-book')).toBeVisible()
})

test('17 Ver mi programa vuelve al libro canónico', async ({ page }) => {
  await mockAdaptive(page, [{ page: theoryPage() }]); await page.goto('/e2e-adaptive')
  await page.getByRole('button', { name: /VOLVER AL LIBRO/ }).click()
  await page.getByRole('button', { name: 'Ver mi programa' }).click()
  await page.getByRole('button', { name: /VOLVER AL LIBRO/ }).click()
  await expect(page.getByTestId('canonical-book')).toBeVisible()
})

test('18 no aparece ninguna vista legacy', async ({ page }) => {
  await mockAdaptive(page, [{ page: theoryPage() }]); await page.goto('/e2e-adaptive')
  await expect(page.getByTestId('adaptive-session')).toBeVisible()
  await expect(page.locator('[data-testid*="legacy"], .adaptive-session-v2, .adaptive-program-home')).toHaveCount(0)
})
