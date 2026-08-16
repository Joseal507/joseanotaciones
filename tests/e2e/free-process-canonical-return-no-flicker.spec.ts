import { expect, test, type Page } from '@playwright/test';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';

// ═══════════════════════════════════════════════════════════════════
// FREE MODE UX MISSION — canonical "Volver al proceso" / atomic Tool →
// StudyAL Process transition regression, against the REAL /materias flow
// (not a synthetic harness): materias -> materia -> tema -> select
// material -> resume into Free hub -> open Flashcards -> click
// "Volver al proceso".
//
// Proves TemaView's own mind-map view (the "empezar a estudiar" /
// "seguir estudiando" default view) is NEVER painted between Tool and
// Process — not "usually not observed", but genuinely never inserted into
// the DOM — via a MutationObserver installed before the click, which
// catches a mutation even if it never survives to a polled frame.
// ═══════════════════════════════════════════════════════════════════

const TEMA_ID = 'tema_nav_repro_1';
const MATERIA_ID = 'materia_nav_repro_1';
const MATERIAL_ID = 'mat_nav_repro_1';
const SESSION_ID = 'sess_nav_repro_1';

const snapshot = buildSourceSelectionSnapshot([MATERIAL_ID], { [MATERIAL_ID]: [1, 2] });

const materia = {
  id: MATERIA_ID,
  nombre: 'Materia Nav Repro',
  color: '#22d3ee',
  emoji: '📘',
  temas: [
    {
      id: TEMA_ID,
      nombre: 'Tema Nav Repro',
      color: '#22d3ee',
      apuntes: [],
      documentos: [
        { id: MATERIAL_ID, materialId: MATERIAL_ID, nombre: 'Material Nav Repro', kind: 'pdf', archivoUrl: '' },
      ],
    },
  ],
};

const studySession = {
  id: SESSION_ID,
  userId: 'e2e-user-1',
  temaId: TEMA_ID,
  enfoque: 'teorico',
  processMode: 'free',
  studyMode: 'free',
  materialIds: [MATERIAL_ID],
  primaryMaterialId: MATERIAL_ID,
  materialNames: ['Material Nav Repro'],
  selectedPages: { [MATERIAL_ID]: [1, 2] },
  sourceSelectionFingerprint: snapshot.fingerprint,
  createdAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
  lastOpenedAt: Date.now() - 60_000,
};

async function installRoutes(page: Page) {
  const state = { session: studySession as any };

  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));

  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'e2e-user-1', name: 'E2E User', email: 'e2e@test.local' }, expires: '2099-01-01T00:00:00.000Z' }),
  }));

  await page.route('**/api/materias', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, materias: [materia] }),
  }));

  await page.route('**/api/study-sessions**', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [state.session] }) });
    }
    const payload = req.postDataJSON();
    if (payload?.session) state.session = { ...state.session, ...payload.session };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route('**/api/enfoques/teorico/start', async route => {
    const req = route.request().postDataJSON();
    if (req?.sourceSelection) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sourceSelectionFingerprint: req.sourceSelection.fingerprint,
          totalChars: 40,
          materials: { [MATERIAL_ID]: { materialId: MATERIAL_ID, selectedPages: [1, 2], text: 'CONTENT', nombre: 'Material Nav Repro', kind: 'pdf', chars: 40 } },
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, materials: {} }) });
  });

  await page.route('**/api/materials/*/download-url', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, url: 'data:application/pdf;base64,JVBERi0xLjQK' }),
  }));
}

async function reachFlashcardsHub(page: Page) {
  await page.goto('/materias');
  await page.getByText('Materia Nav Repro', { exact: true }).click();
  await page.getByText('Tema Nav Repro', { exact: true }).click();
  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material Nav Repro' }).click();

  const estudiarBtn = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn).toBeVisible({ timeout: 10_000 });
  const label = (await estudiarBtn.textContent()) || '';
  await estudiarBtn.click();
  if (/empezar a estudiar/i.test(label)) {
    await page.getByRole('button', { name: 'Libre' }).click();
    await page.getByRole('button', { name: /Confirmar/ }).click();
  }

  await page.getByText('Flashcards', { exact: true }).click();
  await expect(page.getByRole('button', { name: /Generar flashcards/ })).toBeVisible({ timeout: 15_000 });
}

test('canonical "Volver al proceso": TemaView mind-map is NEVER inserted into the DOM during Tool -> Process', async ({ page }) => {
  test.setTimeout(60_000);
  await installRoutes(page);
  await reachFlashcardsHub(page);

  // Install a MutationObserver BEFORE clicking — catches a DOM insertion
  // even if it never survives to a polled/screenshotted frame.
  await page.evaluate(() => {
    (window as any).__mindMapFlashDetected = false;
    (window as any).__mindMapFlashSample = null;
    const MIND_MAP_MARKERS = ['empezar a estudiar', 'seguir estudiando', 'Click para abrir', 'Click para expandir'];
    const observer = new MutationObserver(() => {
      const text = document.body.innerText || '';
      for (const marker of MIND_MAP_MARKERS) {
        if (text.includes(marker)) {
          (window as any).__mindMapFlashDetected = true;
          (window as any).__mindMapFlashSample = marker;
          break;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    (window as any).__mindMapObserver = observer;
  });

  await page.getByRole('button', { name: /Volver al proceso/ }).click();

  // Give React/effects a moment to settle, then assert the StudyAL Process
  // hub (tool circle) is what actually rendered.
  await expect(page.getByText('Repasar', { exact: true })).toBeVisible({ timeout: 10_000 });

  const result = await page.evaluate(() => {
    (window as any).__mindMapObserver?.disconnect();
    return { detected: (window as any).__mindMapFlashDetected, sample: (window as any).__mindMapFlashSample };
  });

  expect(result.detected, `TemaView mind-map view was inserted into the DOM during the transition (marker: "${result.sample}")`).toBe(false);
});

test('canonical "Volver al proceso": exact session/source identity is preserved on return', async ({ page }) => {
  test.setTimeout(60_000);
  await installRoutes(page);
  await reachFlashcardsHub(page);

  const urlBefore = new URL(page.url());
  const sessionIdBefore = urlBefore.searchParams.get('freeSessionId');

  await page.getByRole('button', { name: /Volver al proceso/ }).click();
  await expect(page.getByText('Repasar', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Re-enter Flashcards from the resumed process — must be the SAME
  // session/materials, not a fresh selection flow.
  await page.getByText('Flashcards', { exact: true }).click();
  await expect(page.getByRole('button', { name: /Generar flashcards/ })).toBeVisible({ timeout: 15_000 });

  const urlAfter = new URL(page.url());
  expect(urlAfter.searchParams.get('freeSessionId')).toBe(sessionIdBefore);
  expect(sessionIdBefore).toBeTruthy();
});
