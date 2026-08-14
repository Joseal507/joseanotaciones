import { expect, test, type Page } from '@playwright/test';

async function installCommonRoutes(page: Page) {
  await page.route('**/api/study-sessions**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [] }) });
  });
  await page.route('**/api/enfoques/teorico/start', async route => {
    const request = route.request().postDataJSON();
    const fingerprint = request.sourceSelection.fingerprint;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true,
      sourceSelectionFingerprint: fingerprint,
      totalChars: 80,
      materials: {
        'e2e-free-a': { materialId: 'e2e-free-a', selectedPages: [2, 5], text: '[Pagina 2]\nAUTHORIZED_ALPHA', nombre: 'Material A', kind: 'pdf', chars: 35 },
        'e2e-free-b': { materialId: 'e2e-free-b', selectedPages: [1, 7], text: '[Pagina 1]\nAUTHORIZED_BETA', nombre: 'Material B', kind: 'pdf', chars: 34 },
      },
    }) });
  });
  await page.route('**/api/materials/*/download-url', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
}

test('Quiz conserva pregunta, respuesta, feedback y resultado tras refresh', async ({ page }) => {
  await installCommonRoutes(page);
  let generationCalls = 0;
  await page.route('**/api/alai-studyal-quizzes', async route => {
    generationCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, quiz: [
      { id: 'q1', type: 'multiple_choice', question: 'Pregunta durable uno', options: ['Correcta', 'Incorrecta'], correctAnswer: 0, explanation: 'Feedback durable uno.' },
      { id: 'q2', type: 'multiple_choice', question: 'Pregunta durable dos', options: ['Sí', 'No'], correctAnswer: 0, explanation: 'Feedback durable dos.' },
    ] }) });
  });

  await page.goto('/e2e-free-continuity?tool=quiz');
  await page.getByRole('button', { name: /Generar mi quiz/i }).click();
  await expect(page.getByText('Pregunta durable uno')).toBeVisible();
  await page.getByRole('button', { name: /^A Correcta$/ }).click();
  await expect(page.getByText('¡Correcto!')).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText('Pregunta durable uno')).toBeVisible();
  await expect(page.getByText('¡Correcto!')).toBeVisible();
  expect(generationCalls).toBe(1);

  await page.getByRole('button', { name: /Siguiente pregunta/i }).click();
  await page.getByRole('button', { name: /^A Sí$/ }).click();
  await page.getByRole('button', { name: /Ver resultados/i }).click();
  await expect(page.getByText(/Resultado|Resultados|Perfecto|Excelente/i).first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText(/Resultado|Resultados|Perfecto|Excelente/i).first()).toBeVisible();
  expect(generationCalls).toBe(1);
});

test('Examen preserva intento ante fallo de evaluación y reintenta el mismo examen', async ({ page }) => {
  await installCommonRoutes(page);
  let generationCalls = 0;
  let evaluationCalls = 0;
  await page.route('**/api/alai-studyal-exam', async route => {
    const body = route.request().postDataJSON();
    if (body.mode === 'generate') {
      generationCalls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, exam: {
        id: 'exam-durable-1', title: 'Examen durable', totalPoints: 10, estimatedDifficulty: 'medium', coverage: 'AUTHORIZED',
        sections: [{ id: 's1', title: 'Sección' }],
        questions: [{ id: 'e1', section: 'Sección', type: 'multiple_choice', prompt: 'Pregunta de examen durable', points: 10, options: ['Respuesta A', 'Respuesta B'], correctAnswer: 0, skill: 'comprehension', difficulty: 'medium' }],
      } }) });
    }
    evaluationCalls += 1;
    if (evaluationCalls === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Corrección temporalmente no disponible' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, evaluation: {
      score: 100, skillScores: { comprehension: 100 }, strengths: ['Comprensión'], weaknesses: [], masteredConcepts: ['Concepto'], weakConcepts: [], weakPages: [], passProbability: 1, recommendation: 'Continúa', recoveryPlan: [],
    } }) });
  });

  await page.goto('/e2e-free-continuity?tool=exam');
  await page.getByRole('button', { name: /COMENZAR EXAMEN/i }).click();
  await expect(page.getByText('Pregunta de examen durable')).toBeVisible();
  await page.getByRole('button', { name: 'Respuesta A' }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText('Pregunta de examen durable')).toBeVisible();
  expect(generationCalls).toBe(1);

  await page.getByRole('button', { name: /Entregar examen/i }).click();
  await page.getByRole('button', { name: /👍 Seguro/i }).click();
  await page.getByRole('checkbox').check();
  const signDialog = page.getByRole('heading', { name: 'Declaración de entrega' }).locator('..').locator('..');
  await signDialog.getByRole('button', { name: /Entregar examen/i }).click();
  await expect(page.getByText('Corrección temporalmente no disponible')).toBeVisible();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByText('Corrección temporalmente no disponible')).toBeVisible();
  await expect(page.getByText('Pregunta de examen durable')).toBeVisible();
  await page.getByRole('button', { name: /Reintentar corrección/i }).click();
  await expect(page.getByText(/100/).first()).toBeVisible();
  expect(generationCalls).toBe(1);
  expect(evaluationCalls).toBe(2);
});
