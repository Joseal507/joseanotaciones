import path from 'node:path'
import { statSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test.describe.configure({ timeout: 90_000 })

const fixtures = [
  'CLUTCH 1.pdf',
  'CLUTCH 2.pdf',
  'TAREA CLUTCH 2.pdf',
  'TAREA QUIMICA CLUTCH.pdf',
  'niels bohr.pdf',
  'falcons.pdf',
  'Documento_Juridico_Constitucional.docx',
  'Documento_Matematico_Calculo.docx',
  'Documento_Medico_Cardiovascular.docx',
]

const fixturePath = (name: string) => path.resolve(process.cwd(), 'tests/fixtures/real-materials', name)

for (const name of fixtures) {
  test(`ingesta real: ${name}`, async ({ page }) => {
    const openRouterRequests: string[] = []
    const uploadRequests: Array<{ contentType: string }> = []
    const uploadErrors: Array<{ status: number; body: string }> = []
    page.on('request', request => {
      if (/openrouter(?:\.ai)?/i.test(request.url())) openRouterRequests.push(request.url())
      if (request.method() === 'POST' && request.url().endsWith('/api/e2e-real-materials/extract')) {
        uploadRequests.push({
          contentType: request.headers()['content-type'] ?? '',
        })
      }
    })
    page.on('response', async response => {
      if (response.url().endsWith('/api/e2e-real-materials/extract') && !response.ok()) {
        uploadErrors.push({ status: response.status(), body: await response.text() })
      }
    })
    await page.goto('/e2e-real-materials')
    // The first route compilation in dev can outlive Playwright's 5 s default.
    // This marker is set only after React hydration, so it remains a functional
    // readiness assertion rather than a fixed sleep.
    await expect(page.getByTestId('real-materials-ready')).toHaveText('ready', { timeout: 60_000 })
    await expect(page.getByTestId('material-upload')).toBeEnabled()
    const expectedSize = statSync(fixturePath(name)).size
    const expectedType = name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    await page.getByTestId('material-upload').setInputFiles(fixturePath(name))
    const result = page.getByTestId('ingestion-result')
    await expect(result).toBeVisible()
    await expect(page.getByTestId('material-name')).toHaveText(name)
    await expect(result).toHaveAttribute('data-source-name', name)
    await expect(page.getByTestId('material-size')).toHaveText(String(expectedSize))
    await expect(page.getByTestId('material-type')).toHaveText(expectedType)
    await expect(page.getByTestId('multipart-boundary')).toHaveText('true')
    await expect.poll(async () => Number(await page.getByTestId('multipart-request-bytes').textContent())).toBeGreaterThan(0)
    await expect(page.getByTestId('server-received-name')).toHaveText(name)
    await expect(page.getByTestId('server-received-type')).toHaveText(expectedType)
    await expect(page.getByTestId('server-received-size')).toHaveText(String(expectedSize))
    await expect(page.getByTestId('server-buffer-length')).toHaveText(String(expectedSize))
    await expect(page.getByTestId('server-source-name')).toHaveText(name)
    expect(expectedSize).toBeGreaterThan(0)
    await expect(page.getByTestId('extraction-provider')).toHaveText('local')
    await expect(page.getByTestId('openrouter-used')).toHaveText('false')
    await expect.poll(async () => Number(await page.getByTestId('server-extraction-chars').textContent())).toBeGreaterThan(50)
    await expect.poll(async () => Number(await page.getByTestId('extraction-chars').textContent())).toBeGreaterThan(50)
    const delivered = page.getByTestId('extracted-text')
    await expect(delivered.locator('[data-academic-content]')).toHaveCount(1)
    await expect(delivered).not.toContainText(
      /INVALID_ACADEMIC_FRAGMENT|\[object Object\]|\{\{(?:internal|answer):|\\(?:text|mathrm|frac|ce)\b|\b(?:extm|exts|exth|mathrmm)\b/i,
    )
    if (name === 'TAREA CLUTCH 2.pdf') {
      await expect(page.getByTestId('extraction-classification')).toHaveText('scanned_pdf')
      await expect(page.getByTestId('extraction-method')).toHaveText('pdf-parse-partial')
    }
    await expect(page.getByTestId('graph-micros').locator('li')).not.toHaveCount(0)
    await expect(page.getByTestId('graph-micros')).not.toContainText(/(?:micro|concept|node)[_-]?\d+/i)
    await expect(page.locator('[data-testid*="legacy"], .adaptive-session-v2, .adaptive-program-home')).toHaveCount(0)
    expect(uploadRequests).toHaveLength(1)
    expect(uploadRequests[0].contentType).toMatch(/^multipart\/form-data;\s*boundary=.+/i)
    expect(uploadErrors).toEqual([])
    expect(openRouterRequests).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`${name.replace(/[^a-z0-9]+/gi, '-')}-ingested.png`), fullPage: true })
  })
}

test('dos materiales consecutivos no comparten identidad ni contenido visible', async ({ page }) => {
  await page.goto('/e2e-real-materials')
  await expect(page.getByTestId('real-materials-ready')).toHaveText('ready', { timeout: 60_000 })
  await expect(page.getByTestId('material-upload')).toBeEnabled()
  await page.getByTestId('material-upload').setInputFiles(fixturePath('niels bohr.pdf'))
  await expect(page.getByTestId('ingestion-result')).toHaveAttribute('data-source-name', 'niels bohr.pdf')
  const first = await page.getByTestId('identity-tokens').textContent()
  await page.getByTestId('material-upload').setInputFiles(fixturePath('falcons.pdf'))
  await expect(page.getByTestId('ingestion-result')).toHaveAttribute('data-source-name', 'falcons.pdf')
  const second = await page.getByTestId('identity-tokens').textContent()
  expect(second).not.toBe(first)
  await expect(page.getByTestId('material-name')).toHaveText('falcons.pdf')
})
