import { expect, test } from '@playwright/test'
import { evaluation, mockAdaptive, questionPage } from './adaptive-fixtures'

test('21 respuesta numérica acepta unidad opcional compatible', async ({ page }) => {
  await page.goto('/e2e-adaptive?mode=numeric&answer=-3.4')
  await expect(page.getByTestId('numeric-result')).toHaveAttribute('data-semantic-outcome', 'mostly_correct')
})

test('22 respuesta semánticamente equivalente no exige texto exacto', async ({ page }) => {
  await mockAdaptive(page, [{ page: questionPage('semantic', { interactionType: 'open_response', prompt: 'Explica por qué los niveles son discretos.', data: { expectedConcepts: ['energías permitidas'] } }) }, { page: questionPage('next'), evaluation: { ...evaluation('semantic'), whatWasCorrect: 'Los electrones solo ocupan energías permitidas.' } }])
  await page.goto('/e2e-adaptive?preference=mix')
  await page.getByPlaceholder('Escribe tu respuesta...').fill('Un electrón únicamente puede estar en ciertos valores permitidos de energía.')
  await page.getByRole('button', { name: /Enviar respuesta/ }).click()
  await expect(page.getByTestId('adaptive-feedback')).toContainText('Correcto')
})

test('23 no aparece LaTeX crudo', async ({ page }) => {
  await mockAdaptive(page, [{ page: { type: 'theory', title: 'Fórmula', content: { blocks: [{ type: 'formula', latex: 'E_n=-\\frac{13.6}{n^2}', plain: 'E_n = -13.6/n^2' }] } } }])
  await page.goto('/e2e-adaptive')
  await expect(page.getByText(/\\frac|\$\$/)).toHaveCount(0)
})

test('24 no se duplica una fórmula', async ({ page }) => {
  await mockAdaptive(page, [{ page: { type: 'theory', title: 'Fórmula', content: { blocks: [{ type: 'formula', latex: 'E_n=-\\frac{13.6}{n^2}', plain: 'E_n = -13.6/n^2' }] } } }])
  await page.goto('/e2e-adaptive')
  await expect(page.locator('.katex-display')).toHaveCount(1)
})

test('25 una pregunta no contiene su propia respuesta', async ({ page }) => {
  await page.goto('/e2e-adaptive?mode=contracts&type=numeric_short&prompt=La%20respuesta%20es%20-3.4%20eV&answer=-3.4')
  await expect(page.getByTestId('contract-result')).toHaveAttribute('data-leak', 'true')
})
