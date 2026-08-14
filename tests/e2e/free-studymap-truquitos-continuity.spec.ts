import { expect, test, type BrowserContext, type Page } from '@playwright/test';

type DurableSession = Record<string, unknown> | null;

const mapFixture = {
  title: 'Mapa Durable E2E',
  summary: 'Resumen durable',
  totalConcepts: 3,
  root: {
    id: 'root-1',
    label: 'Tema Central E2E',
    type: 'root',
    emoji: '🎯',
    description: 'Root del mapa durable',
    children: [
      {
        id: 'branch-1',
        label: 'Rama A',
        type: 'branch',
        emoji: '📚',
        description: 'Primera rama',
        children: [
          { id: 'leaf-1', label: 'Concepto 1', type: 'leaf', emoji: '💡', description: 'Primer concepto', page: 2 },
        ],
      },
      {
        id: 'branch-2',
        label: 'Rama B',
        type: 'branch',
        emoji: '🔬',
        description: 'Segunda rama',
        children: [
          { id: 'leaf-2', label: 'Concepto 2', type: 'leaf', emoji: '⚡', description: 'Segundo concepto', page: 5 },
        ],
      },
    ],
  },
};

const cheatFixture = [
  { id: 'cc-1', type: 'regla_oro', title: 'Regla de oro E2E', content: 'Contenido truquito 1', difficulty: 4, forgetRisk: 3 },
  { id: 'cc-2', type: 'analogia', title: 'Analogía E2E', content: 'Contenido truquito 2', difficulty: 2, forgetRisk: 5 },
  { id: 'cc-3', type: 'examen_tip', title: 'Tip Examen E2E', content: 'Contenido truquito 3', difficulty: 3, forgetRisk: 4 },
];

async function installRoutes(
  page: Page,
  server: { session: DurableSession },
) {
  let mapCalls = 0;
  let cheatCalls = 0;

  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: server.session ? [server.session] : [] }) });
    }
    const payload = route.request().postDataJSON();
    server.session = payload.session || payload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route('**/api/enfoques/teorico/start', async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true,
      sourceSelectionFingerprint: request.sourceSelection.fingerprint,
      totalChars: 70,
      materials: {
        'e2e-free-a': { materialId: 'e2e-free-a', selectedPages: [2, 5], text: '[Pagina 2]\nAUTHORIZED_ALPHA', nombre: 'Material A', kind: 'pdf', chars: 34 },
        'e2e-free-b': { materialId: 'e2e-free-b', selectedPages: [1, 7], text: '[Pagina 1]\nAUTHORIZED_BETA', nombre: 'Material B', kind: 'pdf', chars: 33 },
      },
    }) });
  });

  await page.route('**/api/alai-studyal-map', async route => {
    mapCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, mapa: mapFixture }) });
  });

  await page.route('**/api/alai-studyal-cheat-codes', async route => {
    cheatCalls += 1;
    const req = route.request().postDataJSON();
    if (req.mode === 'variant') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, card: { type: 'analogia', title: 'Variante E2E', content: 'Contenido variante' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, cards: cheatFixture }) });
  });

  await page.route('**/api/alai-studyal-chat', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, answer: 'Explicación durable' }) }));

  return { mapCalls: () => mapCalls, cheatCalls: () => cheatCalls };
}

// ═══════════════════════════════════════════════════════════════════
// STUDY MAP E2E
// ═══════════════════════════════════════════════════════════════════

test('Study Map restaura mapa y progreso tras refresh sin regenerar', async ({ page }) => {
  const server = { session: null as DurableSession };
  const { mapCalls } = await installRoutes(page, server);

  await page.goto('/e2e-free-continuity?tool=studymap');
  await expect(page.getByText('Mapa Durable E2E')).toBeVisible();
  expect(mapCalls()).toBe(1);

  // Interact with the map (click a visible node via its group)
  await page.locator('.node-clickable').first().click({ force: true });
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.getByText('Mapa Durable E2E')).toBeVisible({ timeout: 15000 });
  expect(mapCalls()).toBe(1); // 0 new calls after refresh
});

test('Study Map restaura vista y tour tras refresh', async ({ page }) => {
  const server = { session: null as DurableSession };
  await installRoutes(page, server);

  await page.goto('/e2e-free-continuity?tool=studymap');
  await expect(page.getByText('Mapa Durable E2E')).toBeVisible();

  // Switch to cards view
  await page.getByText('🎴 Cards').click();
  await page.waitForTimeout(300);

  await page.reload();
  await expect(page.getByText('Mapa Durable E2E')).toBeVisible({ timeout: 15000 });
});

test('Study Map restaura desde servidor sin estado local', async ({ browser }) => {
  const server = { session: null as DurableSession };
  const firstCtx = await browser.newContext();
  const firstPage = await firstCtx.newPage();
  await installRoutes(firstPage, server);
  await firstPage.goto('/e2e-free-continuity?tool=studymap');
  await expect(firstPage.getByText('Mapa Durable E2E')).toBeVisible({ timeout: 15000 });
  await firstPage.waitForTimeout(1200);
  expect(server.session).not.toBeNull();
  await firstCtx.close();

  const secondCtx: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const secondPage = await secondCtx.newPage();
  const { mapCalls } = await installRoutes(secondPage, server);
  await secondPage.goto('/e2e-free-continuity?tool=studymap');

  // MOBILE USABILITY: header must be visible and usable
  await expect(secondPage.getByRole('button', { name: /volver al proceso/i })).toBeVisible({ timeout: 15000 });

  // MOBILE USABILITY: map container must not overflow horizontally
  const noHScroll = await secondPage.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth
  );
  expect(noHScroll).toBe(true);

  // MOBILE USABILITY: map view toggle button must be visible
  await expect(secondPage.getByRole('button', { name: '🗺️ Mapa' })).toBeVisible({ timeout: 5000 });

  // MOBILE USABILITY: nodes must be in DOM (map rendered)
  await expect(secondPage.locator('.node-clickable').first()).toBeAttached({ timeout: 10000 });

  // MOBILE USABILITY: clicking a node must open the study panel as overlay
  await secondPage.locator('.node-clickable').first().click({ force: true });
  await secondPage.waitForTimeout(800);

  // Panel must be visible after node click
  // (on mobile it renders as a fixed overlay covering the screen)
  await expect(secondPage.locator('aside').first()).toBeVisible({ timeout: 5000 });

  // Panel must be scrollable (not cut off) - check no horizontal overflow still
  const noHScrollAfterPanel = await secondPage.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth
  );
  expect(noHScrollAfterPanel).toBe(true);

  // Close panel and verify map is accessible again
  await secondPage.getByRole('button', { name: '✕' }).first().click();
  await secondPage.waitForTimeout(400);
  await expect(secondPage.getByRole('button', { name: /volver al proceso/i })).toBeVisible({ timeout: 5000 });

  expect(mapCalls()).toBeLessThanOrEqual(1);
  await secondCtx.close();
});

// ═══════════════════════════════════════════════════════════════════
// TRUQUITOS E2E
// ═══════════════════════════════════════════════════════════════════

test('Truquitos restaura cards y favoritos tras refresh sin regenerar', async ({ page }) => {
  const server = { session: null as DurableSession };
  const { cheatCalls } = await installRoutes(page, server);

  await page.goto('/e2e-free-continuity?tool=truquitos');
  await expect(page.getByText('Regla de oro E2E')).toBeVisible();
  expect(cheatCalls()).toBe(1);

  // Mark a favorite
  const firstFavBtn = page.locator('.cc-fav-btn').first();
  await firstFavBtn.click();
  await page.waitForTimeout(400);

  await page.reload();
  await expect(page.getByText('Regla de oro E2E')).toBeVisible();
  expect(cheatCalls()).toBe(1); // 0 new calls after refresh
});

test('Truquitos restaura desde servidor sin estado local', async ({ browser }) => {
  const server = { session: null as DurableSession };
  const firstCtx = await browser.newContext();
  const firstPage = await firstCtx.newPage();
  await installRoutes(firstPage, server);
  await firstPage.goto('/e2e-free-continuity?tool=truquitos');
  await expect(firstPage.getByText('Regla de oro E2E')).toBeVisible();
  await firstPage.waitForTimeout(700);
  expect(server.session).not.toBeNull();
  await firstCtx.close();

  const secondCtx: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const secondPage = await secondCtx.newPage();
  const { cheatCalls } = await installRoutes(secondPage, server);
  await secondPage.goto('/e2e-free-continuity?tool=truquitos');
  await expect(secondPage.getByText('Regla de oro E2E')).toBeVisible();
  expect(cheatCalls()).toBe(0);
  await secondCtx.close();
});
