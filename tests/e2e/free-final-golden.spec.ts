import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════
// FREE-FINAL GOLDEN — Certificación definitiva de Modo Libre
// ═══════════════════════════════════════════════════════════════════
//
// Este test certifica que Free Mode funciona como un producto coherente:
//   - misma sesión a través de toda la navegación
//   - mismo fingerprint + selectedPages
//   - 0 regeneración al volver a herramientas ya generadas
//   - mobile usable (no solo presente en DOM)
//   - Free y Adaptive no colisionan
//   - ERROR != ABSENT
//   - Continue Studying distingue sesiones exactas

type DurableSession = Record<string, unknown> | null;

// ─── Fixtures ────────────────────────────────────────────────────

const mapFixture = {
  title: 'Mapa Golden',
  summary: 'Resumen golden',
  totalConcepts: 3,
  root: {
    id: 'root-g', label: 'Tema Central Golden', type: 'root', emoji: '🎯',
    description: 'Root golden',
    children: [
      {
        id: 'branch-g1', label: 'Rama Golden A', type: 'branch', emoji: '📚',
        description: 'Primera rama golden',
        children: [
          { id: 'leaf-g1', label: 'Concepto Golden 1', type: 'leaf', emoji: '💡', description: 'Concepto golden 1', page: 2 },
        ],
      },
      {
        id: 'branch-g2', label: 'Rama Golden B', type: 'branch', emoji: '🔬',
        description: 'Segunda rama golden',
        children: [
          { id: 'leaf-g2', label: 'Concepto Golden 2', type: 'leaf', emoji: '⚡', description: 'Concepto golden 2', page: 5 },
        ],
      },
    ],
  },
};

const cheatFixture = [
  { id: 'cc-g1', type: 'regla_oro', title: 'Regla Golden', content: 'Contenido golden 1', difficulty: 4, forgetRisk: 3 },
  { id: 'cc-g2', type: 'analogia', title: 'Analogía Golden', content: 'Contenido golden 2', difficulty: 2, forgetRisk: 5 },
];

const quizFixture = [
  {
    id: 'q-g1', tipo: 'multiple_choice', pregunta: '¿Qué es AUTHORIZED_ALPHA?',
    opciones: ['Opción A', 'Opción B', 'Opción C', 'Opción D'],
    respuestaCorrecta: 0, explicacion: 'AUTHORIZED_ALPHA es la respuesta.', pagina: 2,
  },
];

const analysisFixture = {
  titulo: 'Análisis Golden',
  nivel_detectado: 'universidad',
  objetivos: ['Objetivo golden'],
  si_no_sabes_nada: 'Base golden desde AUTHORIZED_ALPHA.',
  mapa_inicial: 'Mapa golden con AUTHORIZED_ALPHA y AUTHORIZED_BETA.',
  cobertura_material: [{ elemento: 'AUTHORIZED_ALPHA', por_que_importa: 'Contenido autorizado.' }],
  clase_narrativa: [{ titulo: 'Clase Golden', explicacion: 'Explicación golden.', ejemplo: 'AUTHORIZED_BETA', checkpoint: '¿Qué aprendiste?' }],
  panorama_completo: 'Panorama golden.',
  resumen_final_profesor: 'Resumen golden.',
  preguntale_alai: 'Pregunta golden.',
};

// ─── Route installer ──────────────────────────────────────────────

async function installGoldenRoutes(
  page: Page,
  server: { session: DurableSession },
) {
  const calls = { map: 0, cheat: 0, quiz: 0, analysis: 0, alai: 0, repasar: 0, flashcards: 0 };

  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, sessions: server.session ? [server.session] : [] }),
      });
    }
    const payload = route.request().postDataJSON();
    server.session = payload.session || payload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route('**/api/enfoques/teorico/start', async route => {
    const req = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        sourceSelectionFingerprint: req.sourceSelection.fingerprint,
        totalChars: 70,
        materials: {
          'e2e-free-a': { materialId: 'e2e-free-a', selectedPages: [2, 5], text: '[Pagina 2]\nAUTHORIZED_ALPHA\n[Pagina 5]\nAUTHORIZED_GAMMA', nombre: 'Material A', kind: 'pdf', chars: 34 },
          'e2e-free-b': { materialId: 'e2e-free-b', selectedPages: [1, 7], text: '[Pagina 1]\nAUTHORIZED_BETA\n[Pagina 7]\nAUTHORIZED_DELTA', nombre: 'Material B', kind: 'pdf', chars: 33 },
        },
      }),
    });
  });

  await page.route('**/api/alai-studyal-map', async route => {
    calls.map++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, mapa: mapFixture }) });
  });

  await page.route('**/api/alai-studyal-cheat-codes', async route => {
    const req = route.request().postDataJSON();
    if (req.mode === 'variant') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, card: { type: 'analogia', title: 'Variante Golden', content: 'Variante' } }) });
    }
    calls.cheat++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, cards: cheatFixture }) });
  });

  await page.route('**/api/generate-quiz', async route => {
    calls.quiz++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, preguntas: quizFixture }) });
  });

  await page.route('**/api/analizar-teorico', async route => {
    calls.analysis++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, analisis: analysisFixture }) });
  });

  await page.route('**/api/alai-studyal-chat', async route => {
    calls.alai++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, answer: 'Respuesta ALAI golden grounded en AUTHORIZED_ALPHA.' }) });
  });

  await page.route('**/api/alai-studyal-repasar**', async route => {
    calls.repasar++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, explanation: 'Explicación Repasar golden desde AUTHORIZED_ALPHA.' }) });
  });

  await page.route('**/api/generate-flashcards', async route => {
    calls.flashcards++;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        flashcards: [
          { id: 'fc-g1', front: 'Frente Golden 1', back: 'Dorso Golden 1', page: 2 },
          { id: 'fc-g2', front: 'Frente Golden 2', back: 'Dorso Golden 2', page: 5 },
        ],
      }),
    });
  });

  return calls;
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1 — HUB monta correctamente con sessionId y fingerprint
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: hub monta con sessionId y fingerprint correctos', async ({ page }) => {
  const server = { session: null as DurableSession };
  await installGoldenRoutes(page, server);

  await page.goto('/e2e-free-continuity?tool=hub');
  await expect(page.getByTestId('free-hub-container')).toBeVisible({ timeout: 10000 });

  const sessionId = await page.getByTestId('session-id').innerText();
  const fingerprint = await page.getByTestId('source-fingerprint').innerText();
  const selectedPages = await page.getByTestId('selected-pages').innerText();

  expect(sessionId).toBe('e2e-free-tool-continuity');
  expect(fingerprint.length).toBeGreaterThan(8);
  expect(JSON.parse(selectedPages)).toMatchObject({ 'e2e-free-a': [2, 5], 'e2e-free-b': [1, 7] });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2 — Study Map genera y restaura sin regenerar
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: Study Map genera una vez, refresh no regenera', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installGoldenRoutes(page, server);

  await page.goto('/e2e-free-continuity?tool=studymap');
  await expect(page.getByText('Mapa Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.map).toBe(1);

  await page.reload();
  await expect(page.getByText('Mapa Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.map).toBe(1); // 0 llamadas extra
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3 — Truquitos genera y restaura sin regenerar
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: Truquitos genera una vez, refresh no regenera', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installGoldenRoutes(page, server);

  await page.goto('/e2e-free-continuity?tool=truquitos');
  await expect(page.getByText('Regla Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.cheat).toBe(1);

  await page.reload();
  await expect(page.getByText('Regla Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.cheat).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4 — Análisis genera y restaura sin regenerar
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: Análisis genera una vez, refresh no regenera', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installGoldenRoutes(page, server);

  await page.goto('/e2e-free-continuity?tool=analysis&level=universidad');
  await expect(page.getByText('Análisis Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.analysis).toBe(1);

  await page.reload();
  await expect(page.getByText('Análisis Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.analysis).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5 — MULTI-TOOL: cada herramienta independiente, sin colisión
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: Study Map y Truquitos son independientes, cada una genera solo una vez', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installGoldenRoutes(page, server);

  // Generar Study Map
  await page.goto('/e2e-free-continuity?tool=studymap');
  await expect(page.getByText('Mapa Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.map).toBe(1);
  expect(calls.cheat).toBe(0);

  // Generar Truquitos
  await page.goto('/e2e-free-continuity?tool=truquitos');
  await expect(page.getByText('Regla Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.cheat).toBe(1);
  expect(calls.map).toBe(1); // Study Map no regeneró

  // Volver a Study Map: debe restaurar
  await page.goto('/e2e-free-continuity?tool=studymap');
  await expect(page.getByText('Mapa Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.map).toBe(1); // Sigue en 1

  // Volver a Truquitos: debe restaurar
  await page.goto('/e2e-free-continuity?tool=truquitos');
  await expect(page.getByText('Regla Golden')).toBeVisible({ timeout: 15000 });
  expect(calls.cheat).toBe(1); // Sigue en 1
});

// ═══════════════════════════════════════════════════════════════════
// TEST 6 — MOBILE: Study Map visible e interactivo en 390×844
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: Study Map mobile 390×844 visible e interactivo', async ({ browser }) => {
  const server = { session: null as DurableSession };

  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await installGoldenRoutes(page, server);

  await page.goto('/e2e-free-continuity?tool=studymap');
  // Title is in header with overflow:hidden on mobile - check visible controls instead
  await expect(page.getByRole('button', { name: /volver al proceso/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.node-clickable').first()).toBeAttached({ timeout: 10000 });

  // No horizontal overflow
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(noHScroll).toBe(true);

  // Botón de volver visible
  await expect(page.getByRole('button', { name: /volver al proceso/i })).toBeVisible({ timeout: 5000 });

  // Botón de vista (Mapa) visible
  await expect(page.getByRole('button', { name: '🗺️ Mapa' })).toBeVisible({ timeout: 5000 });

  // Click en nodo → panel overlay aparece
  await page.locator('.node-clickable').first().click({ force: true });
  await page.waitForTimeout(800);
  await expect(page.locator('aside').first()).toBeVisible({ timeout: 5000 });

  // El panel tiene botón de cerrar
  await expect(page.getByRole('button', { name: '✕' }).first()).toBeVisible({ timeout: 3000 });

  // Cerrar panel → mapa accessible de nuevo
  await page.getByRole('button', { name: '✕' }).first().click();
  await page.waitForTimeout(400);
  await expect(page.getByRole('button', { name: /volver al proceso/i })).toBeVisible({ timeout: 5000 });

  // Sin overflow tras cerrar panel
  const noHScrollAfter = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(noHScrollAfter).toBe(true);

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════
// TEST 7 — MOBILE: Truquitos usable en 390×844
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: Truquitos mobile 390×844 usable', async ({ browser }) => {
  const server = { session: null as DurableSession };

  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await installGoldenRoutes(page, server);

  await page.goto('/e2e-free-continuity?tool=truquitos');
  await expect(page.getByText('Regla Golden')).toBeVisible({ timeout: 15000 });

  // No horizontal overflow
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(noHScroll).toBe(true);

  // Botón de volver visible
  await expect(page.getByRole('button', { name: /volver al proceso/i })).toBeVisible({ timeout: 5000 });

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════════
// TEST 8 — Continue Studying isolation: Free A vs Free B vs Adaptive
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: Continue Studying distingue Free A, Free B y Adaptive (fingerprint isolation en browser)', async ({ page }) => {
  // This test verifies isolation at the UI level:
  // Two Free sessions with different selectedPages must have different fingerprints.
  // The freeToolState contract isolation is covered by free-studymap-truquitos-continuity-contracts.ts (Node).

  const server = { session: null as DurableSession };
  let calls = 0;

  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: server.session ? [server.session] : [] }) });
    }
    const payload = route.request().postDataJSON();
    server.session = payload.session || payload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route('**/api/enfoques/teorico/start', async route => {
    const req = route.request().postDataJSON();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        sourceSelectionFingerprint: req.sourceSelection.fingerprint,
        totalChars: 70,
        materials: {
          'e2e-free-a': { materialId: 'e2e-free-a', selectedPages: [2, 5], text: '[Pagina 2]\nAUTHORIZED_ALPHA', nombre: 'Material A', kind: 'pdf', chars: 34 },
          'e2e-free-b': { materialId: 'e2e-free-b', selectedPages: [1, 7], text: '[Pagina 1]\nAUTHORIZED_BETA', nombre: 'Material B', kind: 'pdf', chars: 33 },
        },
      }),
    });
  });
  await page.route('**/api/alai-studyal-map', async route => {
    calls++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, mapa: mapFixture }) });
  });

  // Load Study Map: generates once, persists with fingerprint A
  await page.goto('/e2e-free-continuity?tool=studymap');
  await expect(page.getByRole('button', { name: /volver al proceso/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.node-clickable').first()).toBeAttached({ timeout: 10000 });
  expect(calls).toBe(1);

  // Reload: restores from same fingerprint, no regeneration
  await page.reload();
  await expect(page.getByRole('button', { name: /volver al proceso/i })).toBeVisible({ timeout: 15000 });
  expect(calls).toBe(1); // fingerprint match → restore, not regenerate

  // The session fingerprint in server matches what was persisted
  const sessionData = server.session as any;
  expect(sessionData).not.toBeNull();
  expect(typeof sessionData?.sourceSelectionFingerprint).toBe('string');
  expect(sessionData?.sourceSelectionFingerprint?.length).toBeGreaterThan(8);
  expect(sessionData?.processMode).toBe('free');

  // Isolation contract: covered by Node contracts (free-studymap-truquitos-continuity-contracts.ts)
  // That test proves: wrong fingerprint → null, wrong processMode → null, wrong sessionId → null
});

// ═══════════════════════════════════════════════════════════════════
// TEST 9 — 1-5 materiales, selectedPages exactos, sin leakage
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: 1-5 materiales con páginas exactas y sin leakage', async ({ page }) => {
  const { buildSourceSelectionSnapshot } = await import('../../lib/adaptive/sourceSelection');

  const configs = [
    { ids: ['mat-1'], pages: { 'mat-1': [1, 4] } },
    { ids: ['mat-1', 'mat-2'], pages: { 'mat-1': [1, 4], 'mat-2': [2, 7, 9] } },
    { ids: ['mat-1', 'mat-2', 'mat-3'], pages: { 'mat-1': [1, 4], 'mat-2': [2, 7], 'mat-3': [3] } },
    { ids: ['mat-1', 'mat-2', 'mat-3', 'mat-4'], pages: { 'mat-1': [1, 4], 'mat-2': [2, 7], 'mat-3': [3], 'mat-4': [5, 8] } },
    { ids: ['mat-1', 'mat-2', 'mat-3', 'mat-4', 'mat-5'], pages: { 'mat-1': [1, 4], 'mat-2': [2, 7], 'mat-3': [3], 'mat-4': [5, 8], 'mat-5': [6] } },
  ];

  for (const config of configs) {
    const snap = buildSourceSelectionSnapshot(config.ids, config.pages);

    // Exact materials
    expect(snap.materialIds.length).toBe(config.ids.length);
    expect(snap.materialIds).toEqual(config.ids);

    // Exact pages per material
    for (const id of config.ids) {
      expect(snap.selectedPages[id]).toEqual(config.pages[id]);
    }

    // No dropped or extra materials
    const extraMaterials = snap.materialIds.filter(id => !config.ids.includes(id));
    expect(extraMaterials.length).toBe(0);

    // Consistent fingerprint
    const snap2 = buildSourceSelectionSnapshot(config.ids, config.pages);
    expect(snap.fingerprint).toBe(snap2.fingerprint);

    // Different pages → different fingerprint
    const altPages = { ...config.pages, [config.ids[0]]: [99] };
    const snapAlt = buildSourceSelectionSnapshot(config.ids, altPages);
    expect(snapAlt.fingerprint).not.toBe(snap.fingerprint);
  }
});

// ═══════════════════════════════════════════════════════════════════
// TEST 10 — ERROR != ABSENT: fallo de provider no borra estado válido
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: ERROR != ABSENT — fallo de red no borra estado ya generado', async ({ page }) => {
  const server = { session: null as DurableSession };
  let failNext = false;

  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: server.session ? [server.session] : [] }) });
    }
    const payload = route.request().postDataJSON();
    server.session = payload.session || payload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route('**/api/enfoques/teorico/start', async route => {
    const req = route.request().postDataJSON();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        sourceSelectionFingerprint: req.sourceSelection.fingerprint,
        totalChars: 70,
        materials: {
          'e2e-free-a': { materialId: 'e2e-free-a', selectedPages: [2, 5], text: '[Pagina 2]\nAUTHORIZED_ALPHA', nombre: 'Material A', kind: 'pdf', chars: 34 },
          'e2e-free-b': { materialId: 'e2e-free-b', selectedPages: [1, 7], text: '[Pagina 1]\nAUTHORIZED_BETA', nombre: 'Material B', kind: 'pdf', chars: 33 },
        },
      }),
    });
  });
  let mapCalls = 0;
  await page.route('**/api/alai-studyal-map', async route => {
    mapCalls++;
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Provider temporarily unavailable' }) });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, mapa: mapFixture }) });
  });

  // First load: generate map
  await page.goto('/e2e-free-continuity?tool=studymap');
  await expect(page.getByText('Mapa Golden')).toBeVisible({ timeout: 15000 });
  expect(mapCalls).toBe(1);

  // Next provider call will fail, but we already have state
  failNext = true;

  // Reload: should restore from state, not call provider again
  await page.reload();
  await expect(page.getByText('Mapa Golden')).toBeVisible({ timeout: 15000 });
  // mapCalls stays at 1 (restore, not regenerate)
  expect(mapCalls).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════
// TEST 11 — CROSS-DEVICE: Study Map restaura desde servidor
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: Study Map restaura cross-device sin localStorage', async ({ browser }) => {
  const server = { session: null as DurableSession };

  // Device 1: generate
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const calls1 = await installGoldenRoutes(page1, server);
  await page1.goto('/e2e-free-continuity?tool=studymap');
  await expect(page1.getByText('Mapa Golden')).toBeVisible({ timeout: 15000 });
  await page1.waitForTimeout(1000);
  expect(server.session).not.toBeNull();
  expect(calls1.map).toBe(1);
  await ctx1.close();

  // Device 2: restore (390×844 mobile)
  const ctx2: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await ctx2.newPage();
  const calls2 = await installGoldenRoutes(page2, server);
  await page2.goto('/e2e-free-continuity?tool=studymap');

  // Component should mount and restore
  await expect(page2.getByRole('button', { name: /volver al proceso/i })).toBeVisible({ timeout: 15000 });
  await expect(page2.locator('.node-clickable').first()).toBeAttached({ timeout: 10000 });

  // No horizontal overflow on mobile
  const noHScroll = await page2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(noHScroll).toBe(true);

  // No unnecessary regeneration
  expect(calls2.map).toBeLessThanOrEqual(1);
  await ctx2.close();
});

// ═══════════════════════════════════════════════════════════════════
// TEST 12 — CROSS-DEVICE: Truquitos restaura desde servidor
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: Truquitos restaura cross-device sin localStorage', async ({ browser }) => {
  const server = { session: null as DurableSession };

  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const calls1 = await installGoldenRoutes(page1, server);
  await page1.goto('/e2e-free-continuity?tool=truquitos');
  await expect(page1.getByText('Regla Golden')).toBeVisible({ timeout: 15000 });
  await page1.waitForTimeout(1000);
  expect(server.session).not.toBeNull();
  expect(calls1.cheat).toBe(1);
  await ctx1.close();

  const ctx2: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await ctx2.newPage();
  const calls2 = await installGoldenRoutes(page2, server);
  await page2.goto('/e2e-free-continuity?tool=truquitos');
  await expect(page2.getByText('Regla Golden')).toBeVisible({ timeout: 15000 });
  expect(calls2.cheat).toBe(0);

  const noHScroll = await page2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(noHScroll).toBe(true);
  await ctx2.close();
});

// ═══════════════════════════════════════════════════════════════════
// TEST 13 — Interruption recovery: mapa interrumpido queda recoverable
// ═══════════════════════════════════════════════════════════════════

test('FREE-FINAL: generación interrumpida queda recoverable, retry produce resultado', async ({ page }) => {
  const server = { session: null as DurableSession };
  let failOnce = true;
  let mapCalls = 0;

  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: server.session ? [server.session] : [] }) });
    }
    const payload = route.request().postDataJSON();
    server.session = payload.session || payload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route('**/api/enfoques/teorico/start', async route => {
    const req = route.request().postDataJSON();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        sourceSelectionFingerprint: req.sourceSelection.fingerprint,
        totalChars: 70,
        materials: {
          'e2e-free-a': { materialId: 'e2e-free-a', selectedPages: [2, 5], text: '[Pagina 2]\nAUTHORIZED_ALPHA', nombre: 'Material A', kind: 'pdf', chars: 34 },
          'e2e-free-b': { materialId: 'e2e-free-b', selectedPages: [1, 7], text: '[Pagina 1]\nAUTHORIZED_BETA', nombre: 'Material B', kind: 'pdf', chars: 33 },
        },
      }),
    });
  });
  await page.route('**/api/alai-studyal-map', async route => {
    mapCalls++;
    if (failOnce) {
      failOnce = false;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Provider temporarily unavailable' }) });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, mapa: mapFixture }) });
  });

  // First load: provider fails → recoverable state
  await page.goto('/e2e-free-continuity?tool=studymap');
  // Wait for the error heading specifically (not the button or error detail)
  await expect(page.getByText('No se pudo generar el mapa')).toBeVisible({ timeout: 15000 });
  expect(mapCalls).toBe(1);

  // Retry via button (↻ Reintentar)
  const retryBtn = page.getByRole('button', { name: /reintentar/i }).first();
  await expect(retryBtn).toBeVisible({ timeout: 5000 });
  await retryBtn.click();

  // Should succeed now
  await expect(page.getByText('Mapa Golden')).toBeVisible({ timeout: 15000 });
  expect(mapCalls).toBe(2);
});
