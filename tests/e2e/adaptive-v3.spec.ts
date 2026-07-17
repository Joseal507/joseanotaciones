import { expect, test } from '@playwright/test'
import { evaluation, mockAdaptive, questionPage, theoryPage } from './adaptive-fixtures'

async function answerFillBlank(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '-3.4', exact: true }).click()
  await page.getByRole('button', { name: /Responder/ }).click()
}

test('26 chat permite pregunta, respuesta, repregunta y scroll', async ({ page }) => {
  await mockAdaptive(page, [{ page: theoryPage() }], { ask: question => `Respuesta extensa para ${question}: ${'explicación '.repeat(24)}` })
  await page.goto('/e2e-adaptive')
  await page.getByTestId('adaptive-chat-launcher').click()
  const input = page.getByPlaceholder('Escribe tu duda…')
  for (const question of ['¿Por qué?', '¿Cómo se conecta?', '¿Puedes dar otro ejemplo?']) {
    await input.fill(question)
    await input.press('Enter')
    await expect(page.getByText(`Respuesta extensa para ${question}:`, { exact: false })).toBeVisible()
  }
  const scroll = page.getByTestId('adaptive-chat-scroll')
  await expect.poll(() => scroll.evaluate(node => node.scrollHeight > node.clientHeight && node.scrollTop > 0)).toBe(true)
})

test('27 refresh conserva interactionId, questionId y fase', async ({ page }) => {
  await mockAdaptive(page, [
    { page: questionPage('persisted-q') },
    { page: questionPage('next-q'), evaluation: evaluation('persisted-q') },
    { page: questionPage('next-q') },
  ])
  await page.goto('/e2e-adaptive')
  await answerFillBlank(page)
  await expect(page.getByTestId('adaptive-session')).toHaveAttribute('data-interaction-phase', 'collecting_confidence')
  await page.reload()
  await expect(page.getByTestId('adaptive-session')).toHaveAttribute('data-interaction-id', 'persisted-q')
  await expect(page.getByTestId('adaptive-session')).toHaveAttribute('data-question-id', 'persisted-q')
  await expect(page.getByTestId('adaptive-session')).toHaveAttribute('data-interaction-phase', 'collecting_confidence')
})

test('28 salir y volver conserva la sesión', async ({ page }) => {
  await mockAdaptive(page, [
    { page: questionPage('q-before-exit') },
    { page: questionPage('q-after-continue'), evaluation: evaluation('q-before-exit') },
    { page: questionPage('q-before-exit') },
  ])
  await page.goto('/e2e-adaptive')
  await answerFillBlank(page)
  await page.getByRole('button', { name: 'Más o menos' }).click()
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-page')).toHaveAttribute('data-interaction-id', 'q-after-continue')
  await page.getByRole('button', { name: /VOLVER AL LIBRO/ }).click()
  await page.getByRole('button', { name: 'Volver a estudiar' }).click()
  await expect(page.getByTestId('adaptive-page')).toHaveAttribute('data-interaction-id', 'q-after-continue')
})

test('29 repair no repite questionId', async ({ page }) => {
  await mockAdaptive(page, [
    { page: questionPage('repair-question') },
    { page: questionPage('repair-question'), evaluation: evaluation('repair-question', 'incorrect') },
    { page: questionPage('repair-question-new', { prompt: 'Compara el nivel inicial con el nivel excitado: ____.' }) },
  ])
  await page.goto('/e2e-adaptive')
  await answerFillBlank(page)
  await page.getByRole('button', { name: 'No estaba seguro/a' }).click()
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-page')).not.toHaveAttribute('data-question-id', 'repair-question')
})

test('30 repair no repite factKey sin intención explícita', async ({ page }) => {
  await mockAdaptive(page, [
    { page: questionPage('repair-a', { factKey: 'bohr-energy-fact' }) },
    { page: questionPage('repair-b', { factKey: 'bohr-energy-fact' }), evaluation: evaluation('repair-a', 'incorrect') },
    { page: questionPage('repair-c', { factKey: 'bohr-transition-fact', prompt: 'Determina el cambio de energía en un caso nuevo: ____.' }) },
  ])
  await page.goto('/e2e-adaptive')
  await answerFillBlank(page)
  await page.getByRole('button', { name: 'No estaba seguro/a' }).click()
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-page')).not.toHaveAttribute('data-fact-key', 'bohr-energy-fact')
})

test('31 final review no repite literalmente preguntas anteriores', async ({ page }) => {
  const literal = 'La energía indicada es ____ eV.'
  await mockAdaptive(page, [
    { page: questionPage('practice-q', { prompt: literal }) },
    { page: questionPage('final-review-q', { prompt: literal }), evaluation: evaluation('practice-q') },
    { page: questionPage('final-transfer-q', { prompt: 'Aplica el modelo de Bohr a una transición diferente: ____.' }) },
  ])
  await page.goto('/e2e-adaptive')
  await answerFillBlank(page)
  await page.getByRole('button', { name: 'Bastante seguro/a' }).click()
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-interaction')).not.toContainText(literal)
})

test('32 persistencia ocurre antes de navegar', async ({ page }) => {
  await mockAdaptive(page, [{ page: theoryPage(), shouldCloseSession: true, sessionPersisted: false, summary: { microsCompleted: 1, microsTotal: 1 } }])
  await page.goto('/e2e-adaptive')
  await expect(page.getByText('La sesión no confirmó su persistencia')).toBeVisible()
  await expect(page.getByTestId('canonical-book')).toHaveCount(0)
  await expect(page.getByTestId('adaptive-session-summary')).toHaveCount(0)
})

test('33 programa completo exige isProgramComplete true', async ({ page }) => {
  await mockAdaptive(page, [{
    page: questionPage('complete-gate'),
    isProgramComplete: false,
  }, {
    page: questionPage('complete-gate'), evaluation: evaluation('complete-gate'),
    shouldCloseSession: true, sessionPersisted: true, isProgramComplete: false,
    summary: { microsCompleted: 1, microsTotal: 1 },
  }])
  await page.goto('/e2e-adaptive')
  await answerFillBlank(page)
  await page.getByRole('button', { name: 'Bastante seguro/a' }).click()
  await page.getByTestId('adaptive-continue').click()
  await page.getByRole('button', { name: /Ver mi progreso/ }).click()
  await expect(page.getByTestId('program-complete')).toHaveCount(0)
  await expect(page.getByTestId('canonical-book')).toBeVisible()
})
