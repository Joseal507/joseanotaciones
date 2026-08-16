import { expect, test, type Page } from '@playwright/test';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';

// ═══════════════════════════════════════════════════════════════════
// P0/P1 REGRESSION — Study Map / Truquitos hook-order crash.
//
// Root cause: TemaView.tsx declared `reconstructedMasteryState = useMemo(...)`
// AFTER the `if (showCoach) / if (showStudyMap) / if (showCheatCodes)`
// early-return chain. Whenever showStudyMap/showCheatCodes was true, the
// component returned BEFORE reaching that hook — a different hook count
// than renders where none of those flags were set — violating the Rules of
// Hooks. React detected it and crashed with "Rendered fewer hooks than
// expected" as soon as the SAME TemaView instance re-rendered across that
// boundary (e.g. reopening Study Map/Truquitos after returning to the
// process).
//
// This test drives the REAL /materias flow through every state transition
// named in the mission brief: loading -> restored -> empty -> generating ->
// generated -> interaction -> return -> reopen, for BOTH tools, and fails
// if React logs a hook-order error at any point.
// ═══════════════════════════════════════════════════════════════════

const TEMA_ID = 'tema_hook_regress_1';
const MATERIA_ID = 'materia_hook_regress_1';
const MATERIAL_ID = 'mat_hook_regress_1';
const SESSION_ID = 'sess_hook_regress_1';

const snapshot = buildSourceSelectionSnapshot([MATERIAL_ID], { [MATERIAL_ID]: [1, 2] });

const materia = {
  id: MATERIA_ID, nombre: 'Materia Hook Regress', color: '#22d3ee', emoji: '📘',
  temas: [{
    id: TEMA_ID, nombre: 'Tema Hook Regress', color: '#22d3ee', apuntes: [],
    documentos: [{ id: MATERIAL_ID, materialId: MATERIAL_ID, nombre: 'Material Hook Regress', kind: 'pdf', archivoUrl: '' }],
  }],
};

const studySession = {
  id: SESSION_ID, userId: 'e2e-user-1', temaId: TEMA_ID, enfoque: 'teorico',
  processMode: 'free', studyMode: 'free', materialIds: [MATERIAL_ID], primaryMaterialId: MATERIAL_ID,
  materialNames: ['Material Hook Regress'], selectedPages: { [MATERIAL_ID]: [1, 2] },
  sourceSelectionFingerprint: snapshot.fingerprint,
  createdAt: Date.now() - 60_000, updatedAt: Date.now() - 60_000, lastOpenedAt: Date.now() - 60_000,
};

async function installRoutes(page: Page) {
  const state = { session: studySession as any };
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await page.route('**/api/auth/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'e2e-user-1', name: 'E2E User', email: 'e2e@test.local' }, expires: '2099-01-01T00:00:00.000Z' }) }));
  await page.route('**/api/materias', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, materias: [materia] }) }));
  await page.route('**/api/study-sessions**', async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [state.session] }) });
    const payload = req.postDataJSON();
    if (payload?.session) state.session = { ...state.session, ...payload.session };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route('**/api/enfoques/teorico/start', async route => {
    const req = route.request().postDataJSON();
    if (req?.sourceSelection) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true, sourceSelectionFingerprint: req.sourceSelection.fingerprint, totalChars: 40,
          materials: { [MATERIAL_ID]: { materialId: MATERIAL_ID, selectedPages: [1, 2], text: 'CONTENT', nombre: 'Material Hook Regress', kind: 'pdf', chars: 40 } },
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, materials: {} }) });
  });
  await page.route('**/api/materials/*/download-url', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, url: 'data:application/pdf;base64,JVBERi0xLjQK' }) }));
  await page.route('**/api/alai-studyal-map', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, mapa: { title: 'Mapa', root: { id: 'root', label: 'Root', type: 'root', children: [{ id: 'a', label: 'A', type: 'branch', children: [] }] }, totalConcepts: 1 } }),
  }));
  await page.route('**/api/alai-studyal-cheat-codes', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, truquitos: [{ id: 'c1', type: 'mnemonic', title: 'T1', content: 'content 1' }] }),
  }));
}

function attachHookErrorCapture(page: Page) {
  const hookErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && /Rendered (fewer|more) hooks|hook-order|Rules of Hooks/.test(msg.text())) {
      hookErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    if (/Rendered (fewer|more) hooks|hook-order|Rules of Hooks/.test(err.message)) {
      hookErrors.push('PAGEERROR: ' + err.message);
    }
  });
  return hookErrors;
}

async function reachFreeHub(page: Page) {
  await page.goto('/materias');
  await page.getByText('Materia Hook Regress', { exact: true }).click();
  await page.getByText('Tema Hook Regress', { exact: true }).click();
  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material Hook Regress' }).click();
  const estudiarBtn = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn).toBeVisible({ timeout: 10_000 });
  const label = (await estudiarBtn.textContent()) || '';
  await estudiarBtn.click();
  if (/empezar a estudiar/i.test(label)) {
    await page.getByRole('button', { name: 'Libre' }).click();
    await page.getByRole('button', { name: /Confirmar/ }).click();
  }
}

for (const toolLabel of ['Study Map', 'Truquitos']) {
  test(`hook-order regression: ${toolLabel} survives generating -> generated -> interaction -> return -> reopen`, async ({ page }) => {
    test.setTimeout(60_000);
    const hookErrors = attachHookErrorCapture(page);
    await installRoutes(page);
    await reachFreeHub(page);

    // loading -> generating -> generated (empty durable state, fresh generation)
    await page.getByText(toolLabel, { exact: true }).click();
    await page.waitForTimeout(2_000);

    // interaction (best-effort click inside the tool's canvas — exercises
    // whatever local interaction state the tool tracks)
    await page.mouse.click(400, 300).catch(() => {});
    await page.waitForTimeout(300);

    // return -> reopen (restored durable state path — the exact transition
    // that crashed before the fix)
    const backBtn = page.getByRole('button', { name: /volver al proceso/i }).first();
    await expect(backBtn).toBeVisible({ timeout: 10_000 });
    await backBtn.click();
    await expect(page.getByText('Repasar', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByText(toolLabel, { exact: true }).click();
    await page.waitForTimeout(2_000);

    // return -> reopen a second time, to also catch any crash that only
    // manifests on the THIRD+ render across the boundary.
    await backBtn.click();
    await expect(page.getByText('Repasar', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByText(toolLabel, { exact: true }).click();
    await page.waitForTimeout(2_000);

    expect(hookErrors, `React hook-order error(s) detected: ${JSON.stringify(hookErrors)}`).toEqual([]);
  });
}
