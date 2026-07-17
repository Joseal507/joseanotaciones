import { expect, test } from '@playwright/test'
import { evaluation, mockAdaptive, questionPage } from './adaptive-fixtures'

test('experiencia pedagógica: ayuda progresiva persiste y exige actividad independiente nueva', async ({ page }) => {
  const first = questionPage('guided-recognition', {
    questionId: 'guided-recognition-q', factKey: 'energy-transition-recognition', interactionType: 'multiple_choice',
    prompt: '¿Qué relación entre estados y energía coincide con el material?',
    data: { options: ['Una transición conecta estados permitidos', 'La energía siempre cambia de forma continua', 'Todo estado tiene energía aleatoria'], correctIndex: 0 },
  })
  const independent = questionPage('independent-discrimination', {
    questionId: 'independent-discrimination-q', factKey: 'energy-transition-discrimination', interactionType: 'true_false',
    prompt: 'Distingue una consecuencia nueva de los estados permitidos',
    data: { statement: 'Una transición entre estados puede asociarse con radiación.', correctAnswer: true, explanation: 'La diferencia energética se relaciona con la radiación.' },
  })
  const harness = await mockAdaptive(page, [
    { page: first },
    { page: independent, evaluation: evaluation('guided-recognition') },
  ])

  await page.goto('/e2e-adaptive')
  await expect(page.getByTestId('adaptive-help-button')).toBeVisible()
  await page.getByTestId('adaptive-help-button').click()
  await page.getByRole('button', { name: 'Dame una pista' }).click()
  const hint = page.getByTestId('adaptive-help-content')
  await expect(hint).toBeVisible()
  await expect(hint).not.toContainText('Una transición conecta estados permitidos')

  await page.reload()
  await expect(page.getByTestId('adaptive-help-content')).toBeVisible()
  await page.getByRole('button', { name: /Una transición conecta estados permitidos/ }).click()
  await expect(page.getByTestId('adaptive-feedback')).toBeVisible()
  expect(harness.bodies.at(-1)?.assistanceLevel).toBe('minimal_hint')

  await page.getByRole('button', { name: 'Más o menos' }).click()
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-page')).toHaveAttribute('data-question-id', 'independent-discrimination-q')
  await expect(page.getByTestId('adaptive-help-content')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '✓ Verdadero' })).toBeEnabled()
})

test('actividad evaluada no reaparece ni bloquea doble avance', async ({ page }) => {
  await mockAdaptive(page, [
    { page: questionPage('first-question') },
    { page: questionPage('second-question', { questionId: 'second-question-q', factKey: 'second-fact', prompt: 'Aplica la relación a un caso distinto: ____.' }), evaluation: evaluation('first-question') },
  ])
  await page.goto('/e2e-adaptive')
  await page.getByTestId('adaptive-word-bank').getByRole('button').first().click()
  await page.getByRole('button', { name: 'Responder →' }).click()
  await page.getByRole('button', { name: 'Más o menos' }).click()
  const continueButton = page.getByTestId('adaptive-continue')
  await continueButton.dblclick()
  await expect(page.getByTestId('adaptive-page')).toHaveAttribute('data-question-id', 'second-question-q')
  await expect(page.getByRole('button', { name: 'Responder →' })).toBeEnabled()
})
