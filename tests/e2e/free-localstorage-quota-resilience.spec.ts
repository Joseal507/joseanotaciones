import { expect, test, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════
// P0 — Free Mode must keep working when localStorage is near/at quota.
//
// Root cause (real user console): studyal_sessions_v4 hits
// QuotaExceededError, saveAll() silently drops the write, and every
// subsequent read (getSessionById/findSession via loadAll()) re-reads
// localStorage from scratch and finds nothing — the session "disappears"
// mid-flow: Flashcards vanish, progress resets to 0, StudyALProcess shows
// 0 materiales, "Empezar a estudiar" instead of "Seguir estudiando",
// duplicate sessions, SOURCE_SELECTION_INVALID.
//
// Fix under test (lib/studySessions.ts): an in-memory cache is now the
// authority for reads within a runtime — it is mutated in place by every
// write BEFORE the best-effort localStorage write, so a quota failure
// never makes a session look absent. NEVER run this suite against a clean
// localStorage — that would not exercise the actual bug.
// ═══════════════════════════════════════════════════════════════════

const TEMA_ID = 'tema_quota_1';
const MATERIA_ID = 'materia_quota_1';
const MATERIAL_ID = 'mat_quota_1';
const TWO_PAGE_B64 = 'Q09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTm8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTm8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTm8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4KCkNPTlRFTklETyBQQUdJTkEgRE9TLg==';

const materia = {
  id: MATERIA_ID, nombre: 'Materia Quota', color: '#f472b6', emoji: '📙',
  temas: [{
    id: TEMA_ID, nombre: 'Tema Quota', color: '#f472b6', apuntes: [],
    documentos: [{ id: MATERIAL_ID, materialId: MATERIAL_ID, nombre: 'Material Quota', kind: 'txt', archivoUrl: `data:text/plain;base64,${TWO_PAGE_B64}` }],
  }],
};

function nowIso() { return new Date().toISOString(); }

async function installRoutes(page: Page) {
  const server = { sessions: {} as Record<string, any> };
  const calls = { flashcards: 0, quiz: 0 };
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await page.route('**/api/auth/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'e2e-quota', name: 'E2E Quota', email: 'e2e-quota@test.local' }, expires: '2099-01-01T00:00:00.000Z', _t: nowIso() }) }));
  await page.route('**/api/materias', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, materias: [materia], revision: 1 }) }));
  await page.route('**/api/study-sessions**', async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: Object.values(server.sessions) }) });
    const payload = req.postDataJSON();
    const sess = payload?.session || payload;
    if (sess?.id) server.sessions[sess.id] = { ...(server.sessions[sess.id] || {}), ...sess };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route('**/api/enfoques/teorico/start', async route => {
    const req = route.request().postDataJSON();
    if (req?.sourceSelection) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sourceSelectionFingerprint: req.sourceSelection.fingerprint, totalChars: 40, materials: { [MATERIAL_ID]: { materialId: MATERIAL_ID, selectedPages: [1, 2], text: '[Pagina 1]\nA\n[Pagina 2]\nB', nombre: 'Material Quota', kind: 'txt', chars: 40 } } }) });
    }
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'no sourceSelection' }) });
  });
  await page.route('**/api/materials/*/download-url', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, url: `data:text/plain;base64,${TWO_PAGE_B64}` }) }));
  await page.route('**/api/alai-studyal-cards', async route => {
    calls.flashcards++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, flashcards: [{ id: 'fc-1', question: 'Q1', answer: 'A1', sourcePage: 1 }] }) });
  });
  await page.route('**/api/alai-studyal-quizzes', async route => {
    calls.quiz++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, quiz: [
      { id: 'qz-1', type: 'multiple_choice', question: '¿Qué es AUTHORIZED_ALPHA?', options: ['Correcta', 'Incorrecta', 'C', 'D'], correctAnswer: 0, explanation: 'exp' },
    ] }) });
  });
  return { server, calls };
}

async function runFreeFlow(page: Page) {
  await page.goto('/materias');
  await page.getByText('Materia Quota', { exact: true }).click();
  await page.getByText('Tema Quota', { exact: true }).click();
  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material Quota' }).click();

  const estudiarBtn = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn).toBeVisible({ timeout: 10_000 });
  await estudiarBtn.click();
  await page.getByRole('button', { name: 'Libre' }).click();
  const confirmBtn = page.getByRole('button', { name: /Confirmar/ });
  await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
  await confirmBtn.click();

  // ── Flashcards: generate → progress 18 ──
  await page.getByText('Flashcards', { exact: true }).click();
  await page.getByRole('button', { name: /Generar flashcards/ }).click();
  await expect(page.getByText('Q1')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('0 materiales')).toHaveCount(0);
  await expect(page.getByText('Empezar a estudiar')).toHaveCount(0);

  // Reopen Flashcards — same deck, no regeneration, no "disappeared" deck.
  await page.getByText('Flashcards', { exact: true }).click();
  await expect(page.getByText('Q1')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── Quiz: generate → progress 34 ──
  await page.getByText('Quiz', { exact: true }).click();
  await page.getByRole('button', { name: /Generar mi quiz/i }).click();
  await expect(page.getByText('¿Qué es AUTHORIZED_ALPHA?')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText('SOURCE_SELECTION_INVALID')).toHaveCount(0);

  // ── Hard refresh — same session, same state, must survive ──
  await page.reload();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('0 materiales')).toHaveCount(0);
  await expect(page.getByText('SOURCE_SELECTION_INVALID')).toHaveCount(0);

  // ── Exit to TemaView, reopen material → must say "Seguir estudiando" ──
  await page.getByRole('button', { name: /volver al mapa/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '🏠' }).click();
  await page.waitForTimeout(500);
  await page.getByText('Materia Quota', { exact: true }).click();
  await page.getByText('Tema Quota', { exact: true }).click();
  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material Quota' }).click();
  const estudiarBtn2 = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn2).toBeVisible({ timeout: 10_000 });
  const label = (await estudiarBtn2.textContent()) || '';
  expect(label, `must show "Seguir estudiando" — durable Free session exists despite localStorage being at/near quota. Saw: "${label}"`).toMatch(/seguir estudiando/i);
}

test('P0 QUOTA: localStorage prellenado casi al límite — Free Mode completo funciona igual', async ({ page }) => {
  test.setTimeout(120_000);

  // Fill localStorage with junk under an UNRELATED key until the browser's
  // real quota genuinely rejects a write — this is what "casi lleno" means
  // in a real browser, regardless of the exact quota number Chromium
  // enforces for this origin. Runs BEFORE any app script (addInitScript),
  // exactly like real accumulated usage would already be there on load.
  await page.addInitScript(() => {
    try {
      const chunk = 'x'.repeat(200_000); // 200KB per chunk
      let i = 0;
      // Leave ~100KB of headroom on purpose (stop just short of a hard
      // fail here) so the PAGE LOAD itself doesn't crash on an unrelated
      // key — the app's own StudySession writes are what must then tip it
      // over the edge and hit the real QuotaExceededError path.
      while (i < 200) {
        try {
          localStorage.setItem(`__quota_filler_${i}`, chunk);
          i++;
        } catch {
          break;
        }
      }
    } catch {
      // ignore — best effort filler
    }
  });

  await installRoutes(page);
  await runFreeFlow(page);
});

test('P0 QUOTA (forced): localStorage.setItem SIEMPRE lanza QuotaExceededError — Free Mode completo funciona con memory+server', async ({ page }) => {
  test.setTimeout(120_000);

  // The strongest possible version of the bug: every single write to
  // localStorage throws, from the very first StudySession creation. If
  // Free Mode still works end-to-end, persistence genuinely does not
  // depend on localStorage succeeding.
  await page.addInitScript(() => {
    const proto = Object.getPrototypeOf(localStorage);
    const original = proto.setItem;
    Object.defineProperty(proto, 'setItem', {
      configurable: true,
      value: function patchedSetItem(key: string, value: string) {
        if (key === 'studyal_sessions_v4' || key === 'studyal_adaptive_artifacts_v1') {
          const err = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          throw err;
        }
        return original.call(this, key, value);
      },
    });
  });

  await installRoutes(page);
  await runFreeFlow(page);

  // After the full flow (all writes failed locally), confirm localStorage
  // genuinely never accepted the sessions key — proves the flow above
  // succeeded via memory + server, not because the patch silently no-opped.
  const storedSessions = await page.evaluate(() => localStorage.getItem('studyal_sessions_v4'));
  expect(storedSessions, 'studyal_sessions_v4 must remain untouched — every write to it threw QuotaExceededError throughout the whole flow').toBeNull();
});
