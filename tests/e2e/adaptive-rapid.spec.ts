import { expect, test } from '@playwright/test'

test('19 rapid rechaza open_response y step_by_step', async ({ page }) => {
  for (const type of ['open_response', 'step_by_step_solver']) {
    await page.goto(`/e2e-adaptive?mode=contracts&type=${type}`)
    await expect(page.getByTestId('contract-result')).toHaveAttribute('data-valid', 'false')
    await expect(page.getByTestId('contract-result')).toContainText('denied in rapid')
  }
})

test('20 true_false continúa a una actividad rapid compatible y válida', async ({ page }) => {
  const { evaluation, mockAdaptive, questionPage } = await import('./adaptive-fixtures')
  await mockAdaptive(page, [
    { page: questionPage('rapid-tf', { interactionType: 'true_false', prompt: 'Evalúa la afirmación', data: { statement: 'Bohr propuso niveles cuantizados.', correctAnswer: true, explanation: 'La afirmación coincide con el material.' } }) },
    { page: questionPage('rapid-bank', { interactionType: 'fill_blank_bank', prompt: 'Completa la relación física indicada: ___', data: { template: 'Bohr propuso niveles de energía ___.', bank: ['cuantizados', 'continuos', 'aleatorios'], correctAnswers: ['cuantizados'] } }), evaluation: evaluation('rapid-tf') },
  ])
  await page.goto('/e2e-adaptive')
  await page.getByRole('button', { name: '✓ Verdadero' }).click()
  await expect(page.getByTestId('adaptive-feedback')).toBeVisible()
  await page.getByRole('button', { name: 'Más o menos' }).click()
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-interaction')).toHaveAttribute('data-interaction-type', /true_false|fill_blank_bank|multiple_choice|matching|ordering|numeric_short|practical_case|prediction/)
  await expect(page.getByTestId('adaptive-word-bank')).toBeVisible()
  await expect(page.getByRole('button', { name: 'cuantizados' })).toBeVisible()
  await expect(page.getByText(/INVALID_INTERACTION|Error del tutor|Algo salió mal/)).toHaveCount(0)
})

test('20b fill_blank_bank válido conserva tres distractores plausibles y la respuesta una vez', async ({ page }) => {
  const { mockAdaptive, questionPage } = await import('./adaptive-fixtures')
  await mockAdaptive(page, [{ page: questionPage('bank-contract', { interactionType: 'fill_blank_bank', prompt: 'Completa la relación física indicada: ___', data: { template: 'La radiación aparece en una transición ___.', bank: ['energética', 'orbital', 'nuclear'], correctAnswers: ['energética'] } }) }])
  await page.goto('/e2e-adaptive')
  await expect(page.getByTestId('adaptive-word-bank').getByRole('button')).toHaveCount(3)
})
