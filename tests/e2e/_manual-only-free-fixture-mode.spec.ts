import { test, type Page } from '@playwright/test';
import { attachNoPaidProviderGuard, assertNoPaidProviderCallsObserved } from './_shared/noPaidProviderGuard';

// ═══════════════════════════════════════════════════════════════════
// MANUAL ZERO-COST TEST MODE
//
// Opens a real, interactive browser against the REAL 8 Free tool
// components (via the existing dev-only /e2e-free-continuity harness —
// app/e2e-free-continuity/page.tsx already 404s in production, per current
// project policy) with EVERY AI-generation endpoint pre-mocked to
// deterministic fixture data. Nothing here can reach a real paid provider:
// every route this session needs is intercepted client-side before it
// leaves the browser, PLUS the server-side instrumentation.ts/lib/alai.ts
// guard is armed as a backstop, PLUS attachNoPaidProviderGuard watches for
// any violation.
//
// Run it with:
//   npx playwright test tests/e2e/free-manual-fixture-mode.spec.ts --headed --debug
//
// That opens a real Chromium window AND the Playwright Inspector, paused
// and fully interactive — click any of the 8 tools, generate content,
// return to the process, reopen tools, watch Proceso/Dominio estimado
// update — for as long as you want, at zero cost. Close the Inspector
// window (or press the stop button) when you're done; nothing needs to be
// committed or cleaned up afterward.
// ═══════════════════════════════════════════════════════════════════

const mapFixture = {
  title: 'Mapa Manual Fixture',
  totalConcepts: 3,
  root: {
    id: 'root', label: 'Tema E2E Repro', type: 'root',
    children: [
      { id: 'b1', label: 'Rama 1', type: 'branch', children: [{ id: 'l1', label: 'Hoja 1', type: 'leaf', children: [] }] },
      { id: 'b2', label: 'Rama 2', type: 'branch', children: [{ id: 'l2', label: 'Hoja 2', type: 'leaf', children: [] }] },
    ],
  },
};

const cheatFixture = [
  { id: 'c1', type: 'mnemonic', title: 'Truquito 1', content: 'Contenido del truquito 1' },
  { id: 'c2', type: 'analogia', title: 'Truquito 2', content: 'Contenido del truquito 2' },
  { id: 'c3', type: 'mnemonic', title: 'Truquito 3', content: 'Contenido del truquito 3' },
];

const quizFixture = [
  { type: 'multiple_choice', question: 'Pregunta 1 de fixture manual', options: ['Opción A', 'Opción B', 'Opción C', 'Opción D'], answer: 'Opción A' },
  { type: 'multiple_choice', question: 'Pregunta 2 de fixture manual', options: ['Opción A', 'Opción B', 'Opción C', 'Opción D'], answer: 'Opción B' },
];

const flashcardsFixture = [
  { id: 'fc-1', question: 'Pregunta de flashcard 1', answer: 'Respuesta 1', sourcePage: 1 },
  { id: 'fc-2', question: 'Pregunta de flashcard 2', answer: 'Respuesta 2', sourcePage: 2 },
];

const analysisFixture = {
  titulo: 'Análisis Manual Fixture',
  nivel_detectado: 'universidad',
  objetivos: ['Objetivo de prueba'],
  si_no_sabes_nada: 'Base desde fixture manual.',
  mapa_inicial: 'Mapa inicial de prueba.',
  cobertura_material: [{ elemento: 'Concepto A', por_que_importa: 'Contenido de prueba.' }],
  clase_narrativa: [{ titulo: 'Clase de prueba', explicacion: 'Explicación de prueba.', ejemplo: 'Ejemplo', checkpoint: '¿Qué aprendiste?' }],
  panorama_completo: 'Panorama de prueba.',
  resumen_final_profesor: 'Resumen de prueba.',
  preguntale_alai: 'Pregunta de prueba.',
};

async function installFixtureRoutes(page: Page) {
  // Broad safety net FIRST (lowest priority): anything not explicitly
  // handled below gets a harmless generic success — never a real network
  // call, never a paid provider.
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));

  await page.route('**/api/materials/*/download-url', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, url: 'data:application/pdf;base64,JVBERi0xLjQK' }),
  }));

  await page.route('**/api/alai-studyal-map', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, mapa: mapFixture }),
  }));

  await page.route('**/api/alai-studyal-cheat-codes', async route => {
    const req = route.request().postDataJSON();
    if (req?.mode === 'variant') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, card: { type: 'analogia', title: 'Variante', content: 'Contenido variante' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, cards: cheatFixture }) });
  });

  await page.route('**/api/alai-studyal-quizzes', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, quiz: quizFixture }),
  }));

  await page.route('**/api/alai-studyal-cards', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, flashcards: flashcardsFixture }) });
  });

  await page.route('**/api/evaluar', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, nivel: 'correcta', porcentaje: 90, analisis: 'Buena respuesta (fixture manual).', respuestaCorrecta: '', explicacion: '' }),
  }));

  await page.route('**/api/analizar-teorico', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, analisis: analysisFixture }),
  }));

  await page.route('**/api/alai-studyal-chat', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, answer: 'Respuesta de ALAI (fixture manual), basada en el material autorizado.' }),
  }));

  await page.route('**/api/alai-studyal-repasar**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, explanation: 'Explicación de Repasar (fixture manual).' }),
  }));
}

test('MANUAL ZERO-COST MODE: interactive Free hub with all 8 tools pre-mocked (--headed --debug)', async ({ page }) => {
  test.setTimeout(0); // no timeout — this session is meant to be held open indefinitely

  const guard = attachNoPaidProviderGuard(page);
  await installFixtureRoutes(page);

  await page.goto('/e2e-free-continuity?tool=hub');

  // Confirm zero paid-provider signal before handing control to the user —
  // if this throws, a route mock above has a gap; fix it rather than
  // opening an interactive session that could spend real credits.
  assertNoPaidProviderCallsObserved(guard);

  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log('  MANUAL ZERO-COST TEST MODE — ready.');
  console.log('  Click any of the 8 tools in the StudyAL Process hub.');
  console.log('  All AI generation is fixture data — zero real cost.');
  console.log('  Resume/step in the Playwright Inspector, or just click');
  console.log('  around freely in the browser window.');
  console.log('════════════════════════════════════════════════════════════');
  console.log('');

  await page.pause();

  assertNoPaidProviderCallsObserved(guard);
});
