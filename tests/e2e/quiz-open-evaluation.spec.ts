import { expect, test, type Page } from '@playwright/test'

const formula = '$1s^{2}2s^{2}2p^{2}$'
const short = { id: 'q1', type: 'short_answer', question: 'Escribe la configuración electrónica.',
  acceptedAnswers: [formula], explanation: `La configuración correcta es ${formula}.` }
const sentinel = { id: 'q2', type: 'multiple_choice', question: 'Pregunta siguiente', options: ['A', 'B'], correctAnswer: 0 }

async function setup(page: Page, question: object, failFirst = false) {
  let evaluations = 0
  await page.route('**/api/**', route => route.fulfill({ json: { success: true, sessions: [] } }))
  await page.route('**/api/alai-studyal-quizzes', async route => {
    const body = route.request().postDataJSON()
    if (body.mode === 'coverage') return route.fulfill({ json: { success: true, coverage: {
      totalAssessableTargets: 12, coveredTargetCount: 0, uncoveredTargetCount: 12,
      estimatedCoveragePercent: 0, mode: 'first_pass', representedSupportedTypeCount: 1,
      supportedSelectedTypeCount: 1, assessablePageCount: 1, sourceRegionCount: 1,
      supportedSelectedTypes: ['multiple_choice'], unsupportedSelectedTypes: [],
    } } })
    if (body.mode === 'evaluate') {
      evaluations++
      if (failFirst && evaluations === 1) return route.fulfill({ status: 503, json: { success: false } })
      return route.fulfill({ json: { success: true, resultado: { nivel: 'incorrecta', porcentaje: 0,
        analisis: 'La ocupación del orbital 2p debe ser dos.', respuestaCorrecta: formula,
        explicacion: `La configuración correcta es ${formula}.`, evaluationMode: 'semantic_provider', providerAttempts: 1 } } })
    }
    return route.fulfill({ json: { success: true, status: 'ready', quiz: [question, sentinel],
      artifactIdentity: 'quiz-evaluation-artifact', artifact: { generationId: 'quiz-evaluation-generation' },
      manifest: { totalSlots: 2, readyCount: 2, status: 'ready' } } })
  })
  await page.goto('/e2e-free-continuity?tool=quiz')
  await page.getByRole('button', { name: /Generar mi quiz/i }).click()
  return () => evaluations
}

test('short answer: technical failure stays editable/ungraded, retry shows academic feedback', async ({ page }) => {
  const calls = await setup(page, short, true)
  const answer = page.locator('textarea').first()
  await answer.fill('1s2 2s2 2p3')
  await page.getByRole('button', { name: 'Responder →', exact: true }).click()
  const feedback = page.locator('#quiz-feedback')
  await expect(feedback).toContainText('No pude evaluar esta respuesta con suficiente confianza')
  await expect(feedback.locator('.saq-feedback-pct')).toHaveCount(0)
  await expect(page.locator('[data-next-question]')).toHaveCount(0)
  await expect(answer).toBeEnabled()
  await expect(answer).toHaveValue('1s2 2s2 2p3')
  await expect(feedback.locator('.katex').first()).toBeVisible()
  expect(await feedback.innerText()).not.toContain('$')
  await page.getByRole('button', { name: 'Reintentar evaluación →' }).click()
  await expect(feedback).toContainText('Incorrecto')
  await expect(feedback).toContainText('0%')
  await expect(feedback.locator('.katex').first()).toBeVisible()
  expect(await feedback.innerText()).not.toContain('$')
  expect(calls()).toBe(2)
  await page.reload()
  await expect(page.locator('#quiz-feedback')).toContainText('Incorrecto')
  await expect(page.locator('#quiz-feedback .katex').first()).toBeVisible()
})

test('plain keyboard orbital answer is correct locally with zero provider/evaluation calls', async ({ page }) => {
  const calls = await setup(page, short)
  await page.locator('textarea').first().fill('1s2 2s2 2p2')
  await page.getByRole('button', { name: 'Responder →', exact: true }).click()
  await expect(page.locator('#quiz-feedback')).toContainText('¡Correcto!')
  await expect(page.locator('#quiz-feedback')).toContainText('100%')
  await expect(page.locator('#quiz-feedback .katex')).toHaveCount(1)
  expect(await page.locator('#quiz-feedback').innerText()).not.toContain('$')
  expect(calls()).toBe(0)
})

for (const type of ['multiple_choice', 'multi_select', 'true_false', 'fill_blank'] as const) {
  test(`closed/word-bank regression: ${type}`, async ({ page }) => {
    const question = { id: 'q1', type, question: type === 'fill_blank' ? 'El proceso se llama ____.' : 'Selecciona la respuesta correcta.',
      options: ['Fotosíntesis', 'Respiración'], correctAnswer: type === 'true_false' ? true : 0,
      correctAnswers: [0], answer: 'Fotosíntesis', wordBank: ['Fotosíntesis', 'Respiración'], explanation: 'La fotosíntesis usa energía luminosa.' }
    const calls = await setup(page, question)
    if (type === 'true_false') await page.getByRole('button', { name: 'V Verdadero', exact: true }).click()
    else await page.getByRole('button', { name: /Fotosíntesis/ }).click()
    if (type === 'multi_select' || type === 'fill_blank') await page.getByRole('button', { name: 'Responder →', exact: true }).click()
    await expect(page.locator('#quiz-feedback')).toContainText('¡Correcto!')
    await expect(page.locator('#quiz-feedback')).toContainText('100%')
    expect(calls()).toBe(0)
  })
}
