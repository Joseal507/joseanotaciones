import { expect, test } from '@playwright/test'

async function finishIntro(page: import('@playwright/test').Page) {
  await page.getByTestId('intro-next').click()
  await page.getByTestId('intro-next').click()
  await page.getByTestId('intro-enter-program').click()
}

test('01 introducción aparece una sola vez', async ({ page }) => {
  await page.goto('/e2e-adaptive?mode=intro')
  await expect(page.getByTestId('intro-material-title')).toHaveText('Bohr')
  await finishIntro(page)
  await expect(page.getByText('ALAI va a crear')).toHaveCount(0)
})

test('02 Finalizando no reinicia la introducción', async ({ page }) => {
  await page.goto('/e2e-adaptive?mode=intro')
  await finishIntro(page)
  await expect(page.getByText('Finalizando...')).toHaveCount(0)
  await expect(page.getByText('ALAI va a crear')).toHaveCount(0)
})

test('03 llega al libro canónico', async ({ page }) => {
  await page.goto('/e2e-adaptive?mode=intro')
  await finishIntro(page)
  await expect(page.getByTestId('canonical-book')).toBeVisible()
})
