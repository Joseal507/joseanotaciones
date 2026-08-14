import { expect, test, type Page } from '@playwright/test';

async function installSource(page: Page) {
  await page.route('**/api/study-sessions**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [] }) }));
  await page.route('**/api/enfoques/teorico/start', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true,
      sourceSelectionFingerprint: body.sourceSelection.fingerprint,
      totalChars: 80,
      materials: {
        'e2e-free-a': { materialId: 'e2e-free-a', selectedPages: [2, 5], text: '[Pagina 2]\nAUTHORIZED_ALPHA', nombre: 'Material A', kind: 'pdf', chars: 35 },
        'e2e-free-b': { materialId: 'e2e-free-b', selectedPages: [1, 7], text: '[Pagina 1]\nAUTHORIZED_BETA', nombre: 'Material B', kind: 'pdf', chars: 34 },
      },
    }) });
  });
  await page.route('**/api/materials/*/download-url', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
}

test('Flashcards conserva mazo, tarjeta, respuesta y confianza tras refresh y reopen', async ({ page }) => {
  await installSource(page);
  let generationCalls = 0;
  await page.route('**/api/alai-studyal-cards', async route => {
    generationCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, flashcards: [
      { question: 'Pregunta durable alpha', answer: 'Respuesta durable alpha', sourceMaterialId: 'e2e-free-a', sourcePage: 2 },
      { question: 'Pregunta durable beta', answer: 'Respuesta durable beta', sourceMaterialId: 'e2e-free-b', sourcePage: 1 },
    ] }) });
  });
  await page.route('**/api/evaluar', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resultado: { nivel: 'correcta', porcentaje: 100, explicacion: 'Feedback durable', respuestaCorrecta: 'Respuesta durable alpha' } }) }));

  await page.goto('/e2e-free-continuity?tool=flashcards');
  await page.getByRole('button', { name: /Generar flashcards/i }).click();
  await expect(page.getByText('Pregunta durable alpha')).toBeVisible();
  await page.getByRole('button', { name: /Estudiar todas/i }).first().click();
  await page.getByRole('button', { name: /En orden/i }).click();
  await page.getByRole('button', { name: /Repite y Aprende/i }).click();
  await page.getByPlaceholder(/Escribe tu respuesta aquí/i).fill('Respuesta estudiante');
  await page.getByRole('button', { name: /Enviar/i }).click();
  await expect(page.getByText('Feedback durable')).toBeVisible();
  await page.getByRole('button', { name: /Lo sabía/i }).click();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByText('Feedback durable')).toBeVisible();
  await expect(page.getByText('Respuesta durable alpha').first()).toBeVisible();
  expect(generationCalls).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Repasar conserva explicación, feedback y verificación tras refresh y reopen', async ({ page }) => {
  await installSource(page);
  let analysisCalls = 0;
  let verificationCalls = 0;
  await page.route('**/api/alai-studyal-repasar', async route => {
    const body = route.request().postDataJSON();
    if (body.kind === 'teach-check') {
      verificationCalls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ check: { passed: true, message: 'Verificación durable aprobada' } }) });
    }
    analysisCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analysis: {
      score: 72, level: 'solid', strengths: ['Concepto alpha'], missingConcepts: ['Concepto beta'], confusions: [], weakConcepts: ['Concepto beta'],
      feedback: 'Feedback repasar durable', nextStep: 'Refuerza beta', summary: 'Feedback repasar durable',
      teachMissing: { title: 'Concepto beta', explanation: 'Explicación grounded beta' },
      followUpQuestions: [{ question: 'Explica beta' }],
    } }) });
  });

  await page.goto('/e2e-free-continuity?tool=repasar');
  await page.getByRole('button', { name: /3\. Explicar/i }).click();
  await page.getByPlaceholder('Escribe aquí tu explicación...').fill('Mi explicación durable');
  await page.getByRole('button', { name: /evaluar con este lector/i }).click();
  await expect(page.getByText('Feedback repasar durable').first()).toBeVisible();
  await page.getByPlaceholder(/Explícalo aquí con tus palabras/i).fill('Mi reparación durable');
  await page.getByRole('button', { name: /verificar concepto/i }).click();
  await expect(page.getByText('Verificación durable aprobada')).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByText('Feedback repasar durable').first()).toBeVisible();
  await expect(page.getByText('Verificación durable aprobada')).toBeVisible();
  expect(analysisCalls).toBe(1);
  expect(verificationCalls).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
