import { expect, test } from '@playwright/test'

test('Free golden source/session handoff keeps one session and excludes forbidden pages', async ({ page }) => {
  let sourceCalls = 0
  await page.route('**/api/enfoques/teorico/start', async route => {
    sourceCalls += 1
    const request = route.request().postDataJSON()
    const fingerprint = request.sourceSelection.fingerprint
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        sourceSelectionFingerprint: fingerprint,
        totalChars: 31,
        materials: {
          'material-a': { materialId: 'material-a', selectedPages: [2], text: '[Pagina 2]\nAUTHORIZED_ALPHA', nombre: 'A', kind: 'pdf', chars: 29 },
          'material-b': { materialId: 'material-b', selectedPages: [3], text: '[Pagina 3]\nAUTHORIZED_BETA', nombre: 'B', kind: 'pdf', chars: 28 },
        },
      }),
    })
  })
  await page.goto('/e2e-adaptive?freeSourceAuthority=1')
  await expect(page.getByTestId('free-authorized-source')).toContainText('AUTHORIZED_ALPHA')
  await expect(page.getByTestId('free-authorized-source')).toContainText('AUTHORIZED_BETA')
  await expect(page.getByTestId('free-authorized-source')).not.toContainText('FORBIDDEN')
  const sessionId = await page.getByTestId('free-session-id').textContent()
  const fingerprint = await page.getByTestId('free-source-fingerprint').textContent()
  for (const tool of ['repasar', 'hub', 'flashcards', 'quiz', 'alai', 'hub']) {
    await page.getByRole('button', { name: tool, exact: true }).click()
    await expect(page.getByTestId('free-active-tool')).toHaveText(tool)
    await expect(page.getByTestId('free-session-id')).toHaveText(sessionId || '')
    await expect(page.getByTestId('free-source-fingerprint')).toHaveText(fingerprint || '')
  }
  await page.getByRole('button', { name: 'flashcards', exact: true }).click()
  await page.reload()
  await expect(page.getByTestId('free-active-tool')).toHaveText('flashcards')
  await expect(page.getByTestId('free-session-id')).toHaveText(sessionId || '')
  await expect(page.getByTestId('free-source-fingerprint')).toHaveText(fingerprint || '')
  expect(sourceCalls).toBe(2)
})

for (const tool of ['studymap', 'truquitos']) {
  test(`${tool} refresh preserves exact Free session and fingerprint`, async ({ page }) => {
    await page.route('**/api/enfoques/teorico/start', async route => {
      const request = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sourceSelectionFingerprint: request.sourceSelection.fingerprint,
          materials: {},
        }),
      })
    })
    await page.goto('/e2e-adaptive?freeSourceAuthority=1')
    const sessionId = await page.getByTestId('free-session-id').textContent()
    const fingerprint = await page.getByTestId('free-source-fingerprint').textContent()
    await page.getByRole('button', { name: tool, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`freeTool=${tool}`))
    await expect(page).toHaveURL(new RegExp(`freeSessionId=${sessionId}`))
    await page.reload()
    await expect(page.getByTestId('free-active-tool')).toHaveText(tool)
    await expect(page.getByTestId('free-session-id')).toHaveText(sessionId || '')
    await expect(page.getByTestId('free-source-fingerprint')).toHaveText(fingerprint || '')
  })
}
