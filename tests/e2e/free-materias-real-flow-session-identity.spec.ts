import { expect, test, type Page } from '@playwright/test';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';

// ═══════════════════════════════════════════════════════════════════
// P0 GOLDEN — REAL /materias flow session identity + continuity + progress
//
// Drives the REAL production flow (materia -> tema -> material -> Free ->
// tools -> "Volver al proceso" -> reopen), never the synthetic
// /e2e-free-continuity harness. Only the AI generation endpoints are
// mocked; StudySession creation/persistence/restore, source selection,
// TemaView, and StudyALProcess are all the real production code paths.
// ═══════════════════════════════════════════════════════════════════

const TEMA_ID = 'tema_e2e_identity_1';
const MATERIA_ID = 'materia_e2e_identity_1';
const MATERIAL_ID = 'mat_e2e_identity_1';

const materia = {
  id: MATERIA_ID,
  nombre: 'Materia E2E Identity',
  color: '#22d3ee',
  emoji: '📘',
  temas: [
    {
      id: TEMA_ID,
      nombre: 'Tema E2E Identity',
      color: '#22d3ee',
      apuntes: [],
      documentos: [
        { id: MATERIAL_ID, materialId: MATERIAL_ID, nombre: 'Material E2E Identity', kind: 'pdf', archivoUrl: '' },
      ],
    },
  ],
};

function nowIso() { return new Date().toISOString(); }

const wholeDocSnapshot = buildSourceSelectionSnapshot([MATERIAL_ID], {});
const SESSION_ID = 'sess_e2e_identity_1';
const seedSession = {
  id: SESSION_ID,
  userId: 'e2e-user-1',
  temaId: TEMA_ID,
  enfoque: 'teorico',
  processMode: 'free',
  studyMode: 'free',
  materialIds: [MATERIAL_ID],
  primaryMaterialId: MATERIAL_ID,
  materialNames: ['Material E2E Identity'],
  selectedPages: { [MATERIAL_ID]: [] },
  sourceSelectionFingerprint: wholeDocSnapshot.fingerprint,
  createdAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
  lastOpenedAt: Date.now() - 60_000,
};

async function installRoutes(page: Page) {
  // Pre-seed a real "documento completo" Free session (as if the user
  // already started studying this material once) — mirrors the proven
  // working pattern from free-materias-real-flow-bounce-repro.spec.ts,
  // which resumes via "seguir estudiando" instead of driving the real
  // SeleccionPaginas dialog (which needs a real parseable PDF for pdf.js
  // to auto-select pages, unavailable to a fixture base64 stub).
  const server = { sessions: { [SESSION_ID]: seedSession } as Record<string, any> };
  const calls = { flashcards: 0, cheatCodes: 0, alaiChat: 0, enfoques: 0 };

  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));

  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'e2e-user-1', name: 'E2E User', email: 'e2e@test.local' }, expires: '2099-01-01T00:00:00.000Z', _t: nowIso() }),
  }));

  await page.route('**/api/materias', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, materias: [materia], revision: 1 }),
  }));

  await page.route('**/api/study-sessions**', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: Object.values(server.sessions) }) });
    }
    const payload = req.postDataJSON();
    const sess = payload?.session || payload;
    if (sess?.id) server.sessions[sess.id] = { ...(server.sessions[sess.id] || {}), ...sess };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route('**/api/enfoques/teorico/start', async route => {
    calls.enfoques++;
    const req = route.request().postDataJSON();
    if (req?.sourceSelection) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sourceSelectionFingerprint: req.sourceSelection.fingerprint,
          totalChars: 40,
          materials: { [MATERIAL_ID]: { materialId: MATERIAL_ID, selectedPages: [], text: '[Pagina 1]\nCONTENT A\n[Pagina 2]\nCONTENT B', nombre: 'Material E2E Identity', kind: 'pdf', chars: 40 } },
        }),
      });
    }
    const requestedIds: string[] = Array.isArray(req?.materialIds) ? req.materialIds : [];
    if (!requestedIds.includes(MATERIAL_ID)) {
      return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo extraer texto de ningún material' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, materials: { [MATERIAL_ID]: { text: 'CONTENT A CONTENT B', nombre: 'Material E2E Identity', kind: 'pdf' } } }) });
  });

  await page.route('**/api/materials/*/download-url', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, url: 'data:application/pdf;base64,JVBERi0xLjQK' }) }));

  await page.route('**/api/alai-studyal-cards', async route => {
    calls.flashcards++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, flashcards: [{ id: 'fc-1', question: 'Q1', answer: 'A1', sourcePage: 1 }, { id: 'fc-2', question: 'Q2', answer: 'A2', sourcePage: 2 }] }) });
  });

  await page.route('**/api/alai-studyal-cheat-codes', async route => {
    const req = route.request().postDataJSON();
    if (req?.mode === 'variant') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, card: { type: 'analogia', title: 'Variante', content: 'Variante' } }) });
    }
    calls.cheatCodes++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, cards: [{ id: 'cc-1', type: 'regla_oro', title: 'Regla Identity', content: 'Contenido identity', difficulty: 3, forgetRisk: 3 }] }) });
  });

  await page.route('**/api/alai-studyal-chat', async route => {
    calls.alaiChat++;
    const req = route.request().postDataJSON();
    const question = String(req?.message || '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, answer: `Respuesta identity: ${question}`, inMaterial: true, confidence: 'alta', sourceMaterial: MATERIAL_ID, sourceMaterialName: 'Material E2E Identity', sourcePages: [], suggestedFollowups: [] }) });
  });

  return { server, calls };
}

async function waitForProcessProgress(page: Page, trace: any[], expected: number, timeoutMs = 5000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const events = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
    last = events[events.length - 1];
    if (last && last.progress === expected) return last;
    await page.waitForTimeout(150);
  }
  return last;
}

function attachTrace(page: Page) {
  const events: any[] = [];
  page.on('console', msg => {
    const text = msg.text();
    const match = text.match(/^\[free-nav-debug\]\s+(STUDYAL_PROCESS_RENDER|CLEANUP_SESSIONS_DELETE|SESSION_UPSERT|ALAI_PERSIST|ALAI_PERSIST_SKIPPED)\s+(\{.*\})$/);
    if (match) {
      try { events.push({ event: match[1], ...JSON.parse(match[2]) }); } catch {}
    }
  });
  return events;
}

test('P0 GOLDEN REAL /materias: Flashcards -> volver al proceso -> reabrir -> Truquitos -> ALAI, identidad de sesión estable', async ({ page }) => {
  test.setTimeout(120_000);
  const trace = attachTrace(page);
  const { calls } = await installRoutes(page);

  await page.goto('/materias');
  await page.getByText('Materia E2E Identity', { exact: true }).click();
  await page.getByText('Tema E2E Identity', { exact: true }).click();

  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material E2E Identity' }).click();

  const estudiarBtn = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn).toBeVisible({ timeout: 10_000 });
  const estudiarLabel = (await estudiarBtn.textContent()) || '';
  expect(estudiarLabel, 'the pre-seeded whole-document session must be resumable, not treated as fresh').toMatch(/seguir estudiando/i);
  await estudiarBtn.click();

  // ── Open Flashcards, generate ──
  await page.getByText('Flashcards', { exact: true }).click();
  const generarButton = page.getByRole('button', { name: /Generar flashcards/ });
  await expect(generarButton).toBeVisible({ timeout: 15_000 });
  await generarButton.click();
  await expect(page.getByText('Q1')).toBeVisible({ timeout: 15_000 });

  // ── Volver al proceso ──
  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });

  const processEvents = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  const lastProcess = processEvents[processEvents.length - 1];
  expect(lastProcess, 'StudyALProcess must have rendered a trace event').toBeTruthy();
  expect(lastProcess.materialesLength, `Process must show 1 material, saw trace: ${JSON.stringify(lastProcess)}`).toBe(1);
  expect(lastProcess.sessionFound, `Process must resolve a real session, saw trace: ${JSON.stringify(lastProcess)}`).toBe(true);
  expect(lastProcess.freeToolsKeys, `Process must see the flashcards envelope, saw trace: ${JSON.stringify(lastProcess)}`).toContain('flashcards');
  expect(lastProcess.progress, `Progress must be 18 after Flashcards alone, saw trace: ${JSON.stringify(lastProcess)}`).toBe(18);

  const deleteEvents = trace.filter(e => e.event === 'CLEANUP_SESSIONS_DELETE');
  expect(deleteEvents, `No session should have been deleted by cleanupSessions: ${JSON.stringify(deleteEvents)}`).toEqual([]);

  // ── Real browser refresh on the Process view — a genuinely COLD START
  // (selectedIds/resumeSessionId/activeSessions all reset to their initial
  // values, unlike in-app "Volver al proceso" navigation which keeps
  // page.tsx mounted). This is the scenario most likely to reproduce
  // "0 materiales" if recovery from a URL-only cold start is broken. ──
  await page.reload();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  const processEventsAfterRefresh = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  const lastProcessAfterRefresh = processEventsAfterRefresh[processEventsAfterRefresh.length - 1];
  expect(lastProcessAfterRefresh.materialesLength, `Process must still show 1 material after a real browser refresh, saw trace: ${JSON.stringify(lastProcessAfterRefresh)}`).toBe(1);
  expect(lastProcessAfterRefresh.progress, `Progress must still be 18 after a real browser refresh, saw trace: ${JSON.stringify(lastProcessAfterRefresh)}`).toBe(18);
  expect(lastProcessAfterRefresh.sessionId, `Session identity must survive a real browser refresh, was ${lastProcess.sessionId}, saw trace: ${JSON.stringify(lastProcessAfterRefresh)}`).toBe(lastProcess.sessionId);

  // ── Reopen Flashcards — same deck, no regeneration ──
  const callsBeforeReopen = calls.flashcards;
  await page.getByText('Flashcards', { exact: true }).click();
  await expect(page.getByText('Q1')).toBeVisible({ timeout: 15_000 });
  expect(calls.flashcards, 'reopening Flashcards must not regenerate').toBe(callsBeforeReopen);
  await expect(page.getByText('No se pudo cargar el material')).toHaveCount(0);

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Truquitos', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── Truquitos ──
  await page.getByText('Truquitos', { exact: true }).click();
  await expect(page.getByText('Regla Identity')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('SOURCE_SELECTION_INVALID')).toHaveCount(0);
  await expect(page.getByText('No pude generar los Truquitos')).toHaveCount(0);

  const backFromTruquitos = page.getByRole('button', { name: /volver al proceso/i });
  await backFromTruquitos.click();
  await expect(page.getByText('ALAI', { exact: true })).toBeVisible({ timeout: 15_000 });

  const processEventsAfterTruquitos = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  const lastProcessAfterTruquitos = processEventsAfterTruquitos[processEventsAfterTruquitos.length - 1];
  expect(lastProcessAfterTruquitos.progress, `Progress must be 26 (flashcards 18 + truquitos 8), saw trace: ${JSON.stringify(lastProcessAfterTruquitos)}`).toBe(26);

  // ── ALAI ──
  await page.getByText('ALAI', { exact: true }).click();
  await expect(page.getByText('SOURCE_SELECTION_INVALID')).toHaveCount(0);
  await expect(page.getByText('No se pudo cargar el documento')).toHaveCount(0);
  await page.getByPlaceholder(/Escribe tu pregunta aquí/i).fill('Pregunta identity');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Respuesta identity: Pregunta identity')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No se pudo identificar la sesión Free para guardar esta conversación')).toHaveCount(0);

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  const finalProcessEvents = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  const finalProcess = finalProcessEvents[finalProcessEvents.length - 1];
  expect(finalProcess.progress, `Progress must be 31 (18+8+5), saw trace: ${JSON.stringify(finalProcess)}`).toBe(31);

  // ── Session identity must never have changed across the whole flow ──
  const distinctSessionIds = new Set(trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER').map((e: any) => e.sessionId));
  expect(distinctSessionIds.size, `Process must use the SAME session throughout the flow, saw: ${JSON.stringify([...distinctSessionIds])}`).toBe(1);

  const totalDeletes = trace.filter(e => e.event === 'CLEANUP_SESSIONS_DELETE');
  expect(totalDeletes, `No session should ever be deleted during this flow: ${JSON.stringify(totalDeletes)}`).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════
// FRESH SESSION CREATION — the exact real user path from the bug report:
// no pre-existing Free session, "empezar a estudiar" -> "Libre" ->
// SeleccionPaginas confirm ("documento completo": a single-page txt
// material, all pages auto-selected) -> Free created for the first time.
// Uses kind:'txt' + a data: URI archivoUrl so SeleccionPaginas can
// actually detect page count client-side (a fake PDF blob can't be
// parsed by pdf.js, which blocks "Confirmar").
// ═══════════════════════════════════════════════════════════════════

const TEMA_ID_2 = 'tema_e2e_fresh_1';
const MATERIA_ID_2 = 'materia_e2e_fresh_1';
const MATERIAL_ID_2 = 'mat_e2e_fresh_1';
const FIXTURE_TEXT_B64 = 'Q09OVEVOSURPIFdIT0xFIERPQyBFMkUgSURFTlRJVFkgTUFURVJJQUwgVEVYVE8gVU5JQ08=';

const materiaFresh = {
  id: MATERIA_ID_2,
  nombre: 'Materia E2E Fresh',
  color: '#a78bfa',
  emoji: '📗',
  temas: [
    {
      id: TEMA_ID_2,
      nombre: 'Tema E2E Fresh',
      color: '#a78bfa',
      apuntes: [],
      documentos: [
        { id: MATERIAL_ID_2, materialId: MATERIAL_ID_2, nombre: 'Material E2E Fresh', kind: 'txt', archivoUrl: `data:text/plain;base64,${FIXTURE_TEXT_B64}` },
      ],
    },
  ],
};

async function installFreshRoutes(page: Page) {
  const server = { sessions: {} as Record<string, any> };
  const calls = { flashcards: 0, cheatCodes: 0, alaiChat: 0 };

  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));

  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'e2e-user-2', name: 'E2E User 2', email: 'e2e2@test.local' }, expires: '2099-01-01T00:00:00.000Z', _t: nowIso() }),
  }));

  await page.route('**/api/materias', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, materias: [materiaFresh], revision: 1 }),
  }));

  await page.route('**/api/study-sessions**', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: Object.values(server.sessions) }) });
    }
    const payload = req.postDataJSON();
    const sess = payload?.session || payload;
    if (sess?.id) server.sessions[sess.id] = { ...(server.sessions[sess.id] || {}), ...sess };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route('**/api/enfoques/teorico/start', async route => {
    const req = route.request().postDataJSON();
    if (req?.sourceSelection) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sourceSelectionFingerprint: req.sourceSelection.fingerprint,
          totalChars: 40,
          materials: { [MATERIAL_ID_2]: { materialId: MATERIAL_ID_2, selectedPages: [], text: '[Pagina 1]\nCONTENIDO WHOLE DOC E2E IDENTITY', nombre: 'Material E2E Fresh', kind: 'txt', chars: 40 } },
        }),
      });
    }
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'No sourceSelection' }) });
  });

  await page.route('**/api/materials/*/download-url', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, url: `data:text/plain;base64,${FIXTURE_TEXT_B64}` }) }));

  await page.route('**/api/alai-studyal-cards', async route => {
    calls.flashcards++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, flashcards: [{ id: 'fc-1', question: 'Q1', answer: 'A1', sourcePage: 1 }] }) });
  });

  await page.route('**/api/alai-studyal-cheat-codes', async route => {
    const req = route.request().postDataJSON();
    if (req?.mode === 'variant') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, card: { type: 'analogia', title: 'Variante', content: 'Variante' } }) });
    }
    calls.cheatCodes++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, cards: [{ id: 'cc-1', type: 'regla_oro', title: 'Regla Fresh', content: 'Contenido fresh', difficulty: 3, forgetRisk: 3 }] }) });
  });

  await page.route('**/api/alai-studyal-chat', async route => {
    calls.alaiChat++;
    const req = route.request().postDataJSON();
    const question = String(req?.message || '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, answer: `Respuesta fresh: ${question}`, inMaterial: true, confidence: 'alta', sourceMaterial: MATERIAL_ID_2, sourceMaterialName: 'Material E2E Fresh', sourcePages: [], suggestedFollowups: [] }) });
  });

  return { server, calls };
}

test('P0 GOLDEN REAL /materias — FRESH creation: empezar a estudiar -> Libre -> Confirmar -> Flashcards -> volver al proceso, identidad estable', async ({ page }) => {
  test.setTimeout(120_000);
  const trace = attachTrace(page);
  const { calls } = await installFreshRoutes(page);

  await page.goto('/materias');
  await page.getByText('Materia E2E Fresh', { exact: true }).click();
  await page.getByText('Tema E2E Fresh', { exact: true }).click();

  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material E2E Fresh' }).click();

  const estudiarBtn = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn).toBeVisible({ timeout: 10_000 });
  const estudiarLabel = (await estudiarBtn.textContent()) || '';
  expect(estudiarLabel, 'no pre-existing session — must be the FRESH path').toMatch(/empezar a estudiar/i);
  await estudiarBtn.click();

  await page.getByRole('button', { name: 'Libre' }).click();
  const confirmBtn = page.getByRole('button', { name: /Confirmar/ });
  await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
  await confirmBtn.click();

  // ── Open Flashcards, generate ──
  await page.getByText('Flashcards', { exact: true }).click();
  const generarButton = page.getByRole('button', { name: /Generar flashcards/ });
  await expect(generarButton).toBeVisible({ timeout: 15_000 });
  await generarButton.click();
  await expect(page.getByText('Q1')).toBeVisible({ timeout: 15_000 });

  // ── Volver al proceso ──
  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });

  const processEvents = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  const lastProcess = processEvents[processEvents.length - 1];
  expect(lastProcess, 'StudyALProcess must have rendered a trace event').toBeTruthy();
  expect(lastProcess.materialesLength, `Process must show 1 material (FRESH path), saw trace: ${JSON.stringify(lastProcess)}`).toBe(1);
  expect(lastProcess.sessionFound, `Process must resolve a real session (FRESH path), saw trace: ${JSON.stringify(lastProcess)}`).toBe(true);
  expect(lastProcess.freeToolsKeys, `Process must see the flashcards envelope (FRESH path), saw trace: ${JSON.stringify(lastProcess)}`).toContain('flashcards');
  expect(lastProcess.progress, `Progress must be 18 after Flashcards alone (FRESH path), saw trace: ${JSON.stringify(lastProcess)}`).toBe(18);

  const deleteEvents = trace.filter(e => e.event === 'CLEANUP_SESSIONS_DELETE');
  expect(deleteEvents, `No session should have been deleted by cleanupSessions (FRESH path): ${JSON.stringify(deleteEvents)}`).toEqual([]);

  const callsBeforeReopen = calls.flashcards;
  await page.getByText('Flashcards', { exact: true }).click();
  await expect(page.getByText('Q1')).toBeVisible({ timeout: 15_000 });
  expect(calls.flashcards, 'reopening Flashcards must not regenerate (FRESH path)').toBe(callsBeforeReopen);
  await expect(page.getByText('No se pudo cargar el material')).toHaveCount(0);

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Truquitos', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── Truquitos (lives inside TemaView — different identity plumbing than
  // Flashcards, which lives at the page.tsx level) ──
  await page.getByText('Truquitos', { exact: true }).click();
  await expect(page.getByText('Regla Fresh')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('SOURCE_SELECTION_INVALID')).toHaveCount(0);
  await expect(page.getByText('No pude generar los Truquitos')).toHaveCount(0);

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('ALAI', { exact: true })).toBeVisible({ timeout: 15_000 });

  const processEventsAfterTruquitos = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  const lastProcessAfterTruquitos = processEventsAfterTruquitos[processEventsAfterTruquitos.length - 1];
  expect(lastProcessAfterTruquitos.progress, `Progress must be 26 (flashcards 18 + truquitos 8), FRESH path, saw: ${JSON.stringify(lastProcessAfterTruquitos)}`).toBe(26);

  // ── ALAI (page.tsx level, own onOpenAlai wrapper) ──
  await page.getByText('ALAI', { exact: true }).click();
  await expect(page.getByText('SOURCE_SELECTION_INVALID')).toHaveCount(0);
  await expect(page.getByText('No se pudo cargar el documento')).toHaveCount(0);
  await page.getByPlaceholder(/Escribe tu pregunta aquí/i).fill('Pregunta fresh');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Respuesta fresh: Pregunta fresh')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No se pudo identificar la sesión Free para guardar esta conversación')).toHaveCount(0);

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  const finalProcessEvents = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  const finalProcess = finalProcessEvents[finalProcessEvents.length - 1];
  expect(finalProcess.progress, `Progress must be 31 (18+8+5), FRESH path, saw: ${JSON.stringify(finalProcess)}`).toBe(31);

  const distinctSessionIds = new Set(trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER').map((e: any) => e.sessionId));
  expect(distinctSessionIds.size, `Process must use the SAME session throughout the FRESH flow, saw: ${JSON.stringify([...distinctSessionIds])}`).toBe(1);

  const allDeletes = trace.filter(e => e.event === 'CLEANUP_SESSIONS_DELETE');
  expect(allDeletes, `No session should ever be deleted during the FRESH flow: ${JSON.stringify(allDeletes)}`).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════
// P0 ABSOLUTO — FASE 11: golden real, cobertura completa
//
// materia -> tema -> material -> seleccionar páginas [1,2] (fixture real
// de 2 páginas, pdf.js/dividirTextoEnPaginas real, no fake blob) -> Start
// Free -> Flashcards -> volver -> reabrir -> salir a TemaView -> reabrir
// material ("Seguir estudiando") -> resume -> refresh -> Quiz -> Truquitos
// -> ALAI. Verifica UNA sola StudySession canónica durante todo el flujo.
// ═══════════════════════════════════════════════════════════════════

const TEMA_ID_3 = 'tema_e2e_full_1';
const MATERIA_ID_3 = 'materia_e2e_full_1';
const MATERIAL_ID_3 = 'mat_e2e_full_1';
// Texto de 2 páginas reales (dividirTextoEnPaginas corta por bloque
// separado por línea en blanco cuando el acumulado supera 1800 chars).
const TWO_PAGE_B64 = 'Q09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTk8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTm8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTm8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4gQ09OVEVOSURPIFBBR0lOQSBVTm8uIENPTlRFTklETyBQQUdJTkEgVU5PLiBDT05URU5JRE8gUEFHSU5BIFVOTy4KCkNPTlRFTklETyBQQUdJTkEgRE9TLg==';

const materiaFull = {
  id: MATERIA_ID_3, nombre: 'Materia E2E Full', color: '#f472b6', emoji: '📙',
  temas: [{
    id: TEMA_ID_3, nombre: 'Tema E2E Full', color: '#f472b6', apuntes: [],
    documentos: [{ id: MATERIAL_ID_3, materialId: MATERIAL_ID_3, nombre: 'Material E2E Full', kind: 'txt', archivoUrl: `data:text/plain;base64,${TWO_PAGE_B64}` }],
  }],
};

function fullAnalysisFixture(level: string) {
  return {
    titulo: `Análisis full ${level}`,
    nivel_detectado: level,
    objetivos: [`Objetivo full ${level}`],
    si_no_sabes_nada: `Base full ${level} explicada únicamente desde el material autorizado.`,
    mapa_inicial: `Mapa full ${level} con AUTHORIZED_ALPHA.`,
    cobertura_material: [{ elemento: 'AUTHORIZED_ALPHA', por_que_importa: 'Contenido seleccionado y autorizado para esta sesión.' }],
    clase_narrativa: [{ titulo: `Clase ${level}`, explicacion: 'Explicación full grounded con suficiente contenido.', ejemplo: 'AUTHORIZED_ALPHA', checkpoint: '¿Qué aprendiste?' }],
    panorama_completo: `Panorama full ${level} con las fuentes autorizadas.`,
    resumen_final_profesor: `Resumen full ${level} sin contenido no seleccionado.`,
    preguntale_alai: 'Pregunta sobre el análisis full.',
  };
}

const fullMapFixture = {
  title: 'Mapa Full E2E',
  summary: 'Resumen full',
  totalConcepts: 2,
  root: {
    id: 'root-1', label: 'Tema Central Full', type: 'root', emoji: '🎯', description: 'Root del mapa full',
    children: [
      { id: 'branch-1', label: 'Rama A', type: 'branch', emoji: '📚', description: 'Primera rama', children: [
        { id: 'leaf-1', label: 'Concepto 1', type: 'leaf', emoji: '💡', description: 'Primer concepto', page: 1 },
      ] },
    ],
  },
};

async function installFullRoutes(page: Page) {
  const server = { sessions: {} as Record<string, any> };
  const calls = { flashcards: 0, quiz: 0, cheatCodes: 0, alaiChat: 0, exam: 0, repasar: 0, analysis: 0, studymap: 0 };

  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
  await page.route('**/api/auth/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'e2e-user-full', name: 'E2E Full', email: 'e2e-full@test.local' }, expires: '2099-01-01T00:00:00.000Z', _t: nowIso() }) }));
  await page.route('**/api/materias', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, materias: [materiaFull], revision: 1 }) }));
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
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sourceSelectionFingerprint: req.sourceSelection.fingerprint, totalChars: 40, materials: { [MATERIAL_ID_3]: { materialId: MATERIAL_ID_3, selectedPages: [1, 2], text: '[Pagina 1]\nA\n[Pagina 2]\nB', nombre: 'Material E2E Full', kind: 'txt', chars: 40 } } }) });
    }
    // Real backend also supports a legacy materialIds-only shape (no
    // sourceSelection, whole-document text, no page filtering) — used by
    // MasteryCoach's concept extraction. That path returns 200, never 422;
    // mirror it so this mock matches app/api/enfoques/teorico/start/route.ts.
    const materialIds: string[] = Array.isArray(req?.materialIds) ? req.materialIds : [];
    if (materialIds.includes(MATERIAL_ID_3)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, materials: { [MATERIAL_ID_3]: { materialId: MATERIAL_ID_3, text: '[Pagina 1]\nA\n[Pagina 2]\nB', nombre: 'Material E2E Full', kind: 'txt', chars: 40 } } }) });
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
  await page.route('**/api/alai-studyal-exam', async route => {
    const body = route.request().postDataJSON();
    if (body?.mode === 'generate') {
      calls.exam++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, exam: {
        id: 'exam-full-1', title: 'Examen full', totalPoints: 10, estimatedDifficulty: 'medium', coverage: 'AUTHORIZED',
        sections: [{ id: 's1', title: 'Sección' }],
        questions: [{ id: 'e1', section: 'Sección', type: 'multiple_choice', prompt: 'Pregunta de examen full', points: 10, options: ['Respuesta A', 'Respuesta B'], correctAnswer: 0, skill: 'comprehension', difficulty: 'medium' }],
      } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, evaluation: {
      score: 100, skillScores: { comprehension: 100 }, strengths: ['Comprensión'], weaknesses: [], masteredConcepts: ['Concepto'], weakConcepts: [], weakPages: [], passProbability: 1, recommendation: 'Continúa', recoveryPlan: [],
    } }) });
  });
  await page.route('**/api/alai-studyal-repasar', async route => {
    const body = route.request().postDataJSON();
    if (body?.kind === 'teach-check') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ check: { passed: true, message: 'Verificación full aprobada' } }) });
    }
    calls.repasar++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analysis: {
      score: 72, level: 'solid', strengths: ['Concepto alpha'], missingConcepts: [], confusions: [], weakConcepts: [],
      feedback: 'Feedback repasar full', nextStep: 'Refuerza alpha', summary: 'Feedback repasar full',
      followUpQuestions: [],
    } }) });
  });
  await page.route('**/api/analizar-teorico', async route => {
    calls.analysis++;
    const req = route.request().postDataJSON();
    const level = String(req?.nivel || 'universidad');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, analisis: fullAnalysisFixture(level) }) });
  });
  await page.route('**/api/alai-studyal-map', async route => {
    calls.studymap++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, mapa: fullMapFixture }) });
  });
  await page.route('**/api/alai-studyal-cheat-codes', async route => {
    const req = route.request().postDataJSON();
    if (req?.mode === 'variant') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, card: { type: 'analogia', title: 'Variante', content: 'Variante' } }) });
    }
    calls.cheatCodes++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, cards: [{ id: 'cc-1', type: 'regla_oro', title: 'Regla Full', content: 'Contenido full', difficulty: 3, forgetRisk: 3 }] }) });
  });
  await page.route('**/api/alai-studyal-chat', async route => {
    calls.alaiChat++;
    const req = route.request().postDataJSON();
    const question = String(req?.message || '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, answer: `Respuesta full: ${question}`, inMaterial: true, confidence: 'alta', sourceMaterial: MATERIAL_ID_3, sourceMaterialName: 'Material E2E Full', sourcePages: [], suggestedFollowups: [] }) });
  });

  return { server, calls };
}

test('P0 ABSOLUTO FASE 12: golden real completo — 8/8 tools (Flashcards, Quiz, Repasar, Análisis, ALAI, Examen ALAI, Study Map, Truquitos), UNA sola StudySession canónica, progreso 100%', async ({ page }) => {
  test.setTimeout(240_000);
  const trace = attachTrace(page);
  const { calls } = await installFullRoutes(page);

  const enfoquesErrors: number[] = [];
  page.on('response', res => {
    if (res.url().includes('/api/enfoques/teorico/start') && res.status() >= 400) enfoquesErrors.push(res.status());
  });

  const assertSingleMatchingSession = (label: string) => {
    const upserts = trace.filter(e => e.event === 'SESSION_UPSERT');
    const lastUpsert = upserts[upserts.length - 1];
    expect(lastUpsert?.candidatesForTema?.length, `[${label}] exactly one matching Free session must exist, saw: ${JSON.stringify(lastUpsert?.candidatesForTema)}`).toBeLessThanOrEqual(1);
  };

  await page.goto('/materias');
  await page.getByText('Materia E2E Full', { exact: true }).click();
  await page.getByText('Tema E2E Full', { exact: true }).click();
  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material E2E Full' }).click();

  const estudiarBtn = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn).toBeVisible({ timeout: 10_000 });
  expect(await estudiarBtn.textContent(), 'no pre-existing session — must be the FRESH path').toMatch(/empezar a estudiar/i);
  await estudiarBtn.click();
  await page.getByRole('button', { name: 'Libre' }).click();
  const confirmBtn = page.getByRole('button', { name: /Confirmar/ });
  await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
  await confirmBtn.click();

  // ── Flashcards: generate → +18 ──
  await page.getByText('Flashcards', { exact: true }).click();
  await page.getByRole('button', { name: /Generar flashcards/ }).click();
  await expect(page.getByText('Q1')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  let processEvents = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  let last = processEvents[processEvents.length - 1];
  const sessionA = last.sessionId;
  expect(sessionA, 'a real session must have been resolved').toBeTruthy();
  expect(last.progress, `progress must be 18 after Flashcards, saw ${JSON.stringify(last)}`).toBe(18);
  assertSingleMatchingSession('after Flashcards');
  expect(last.freeToolsKeys, `envelope keys must include flashcards, saw ${JSON.stringify(last)}`).toContain('flashcards');

  // ── Reopen Flashcards — same deck, no regeneration ──
  const flashcardsCallsBefore = calls.flashcards;
  await page.getByText('Flashcards', { exact: true }).click();
  await expect(page.getByText('Q1')).toBeVisible({ timeout: 15_000 });
  expect(calls.flashcards, 'reopening Flashcards must not regenerate').toBe(flashcardsCallsBefore);
  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── Salir completamente al mapa del tema, reabrir el material ──
  await page.getByRole('button', { name: /volver al mapa/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '🏠' }).click();
  await page.waitForTimeout(500);
  await page.getByText('Materia E2E Full', { exact: true }).click();
  await page.getByText('Tema E2E Full', { exact: true }).click();
  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material E2E Full' }).click();

  const estudiarBtn2 = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn2).toBeVisible({ timeout: 10_000 });
  const label2 = (await estudiarBtn2.textContent()) || '';
  expect(label2, `must show "Seguir estudiando" — a durable Free session already exists. Saw: "${label2}"`).toMatch(/seguir estudiando/i);
  await estudiarBtn2.click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });

  processEvents = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  last = processEvents[processEvents.length - 1];
  expect(last.sessionId, `resuming after exit must resolve to the SAME session A (${sessionA}), saw ${last.sessionId}`).toBe(sessionA);
  expect(last.progress, 'progress must still be 18 after resume').toBe(18);
  assertSingleMatchingSession('after resume');

  // ── Real browser refresh on the hub ──
  await page.reload();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  processEvents = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  last = processEvents[processEvents.length - 1];
  expect(last.sessionId, 'session identity must survive a real browser refresh').toBe(sessionA);
  expect(last.progress, 'progress must still be 18 after refresh').toBe(18);
  assertSingleMatchingSession('after hub refresh');

  // ── Quiz: generate → +16 = 34 ──
  await page.getByText('Quiz', { exact: true }).click();
  await page.getByRole('button', { name: /Generar mi quiz/i }).click();
  await expect(page.getByText('¿Qué es AUTHORIZED_ALPHA?')).toBeVisible({ timeout: 15_000 });

  // ── Hard refresh WHILE ON Quiz — must recover the same question, no regen ──
  const quizCallsBefore = calls.quiz;
  await page.reload();
  await expect(page.getByText('¿Qué es AUTHORIZED_ALPHA?')).toBeVisible({ timeout: 15_000 });
  expect(calls.quiz, 'a Quiz hard refresh must not regenerate the quiz').toBe(quizCallsBefore);

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  last = await waitForProcessProgress(page, trace, 34);
  expect(last?.sessionId, 'same session A after Quiz').toBe(sessionA);
  expect(last?.progress, `progress must be 34 (18+16) after Quiz, saw ${JSON.stringify(last)}`).toBe(34);
  expect(last?.freeToolsKeys, `envelope keys must include quiz, saw ${JSON.stringify(last)}`).toContain('quiz');
  assertSingleMatchingSession('after Quiz');

  // ── Repasar: explicar + evaluar → +15 = 49 ──
  await page.getByText('Repasar', { exact: true }).click();
  await page.getByRole('button', { name: /3\. Explicar/i }).click();
  await page.getByPlaceholder('Escribe aquí tu explicación...').fill('Mi explicación full');
  await page.getByRole('button', { name: /evaluar con este lector/i }).click();
  await expect(page.getByText('Feedback repasar full').first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  last = await waitForProcessProgress(page, trace, 49);
  expect(last?.sessionId, 'same session A after Repasar').toBe(sessionA);
  expect(last?.progress, `progress must be 49 (34+15) after Repasar, saw ${JSON.stringify(last)}`).toBe(49);
  expect(last?.freeToolsKeys, `envelope keys must include repasar, saw ${JSON.stringify(last)}`).toContain('repasar');
  assertSingleMatchingSession('after Repasar');

  // ── Análisis: auto-generates on open → +10 = 59 ──
  await page.getByText('Análisis', { exact: true }).click();
  await expect(page.getByText('Análisis full universidad')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  last = await waitForProcessProgress(page, trace, 59);
  expect(last?.sessionId, 'same session A after Análisis').toBe(sessionA);
  expect(last?.progress, `progress must be 59 (49+10) after Análisis, saw ${JSON.stringify(last)}`).toBe(59);
  expect(last?.freeToolsKeys, `envelope keys must include analysis, saw ${JSON.stringify(last)}`).toContain('analysis');
  assertSingleMatchingSession('after Análisis');

  // ── ALAI: real question + answer → +5 = 64 ──
  await page.getByText('ALAI', { exact: true }).click();
  await page.getByPlaceholder(/Escribe tu pregunta aquí/i).fill('Pregunta full');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Respuesta full: Pregunta full')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('SOURCE_SELECTION_INVALID')).toHaveCount(0);
  await expect(page.getByText('No se pudo identificar la sesión Free para guardar esta conversación')).toHaveCount(0);

  // ── Hard refresh WHILE ON ALAI — must recover the same conversation ──
  const alaiCallsBefore = calls.alaiChat;
  await page.reload();
  await expect(page.getByText('Respuesta full: Pregunta full')).toBeVisible({ timeout: 15_000 });
  expect(calls.alaiChat, 'an ALAI hard refresh must not resend the question').toBe(alaiCallsBefore);

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  last = await waitForProcessProgress(page, trace, 64);
  expect(last?.sessionId, 'same session A after ALAI').toBe(sessionA);
  expect(last?.progress, `progress must be 64 (59+5) after ALAI, saw ${JSON.stringify(last)}`).toBe(64);
  expect(last?.freeToolsKeys, `envelope keys must include alai, saw ${JSON.stringify(last)}`).toContain('alai');
  assertSingleMatchingSession('after ALAI');

  // ── Examen ALAI: generate → +21 = 85 ──
  await page.getByText('Examen ALAI', { exact: true }).click();
  await page.getByRole('button', { name: /COMENZAR EXAMEN/i }).click();
  await expect(page.getByText('Pregunta de examen full')).toBeVisible({ timeout: 15_000 });

  // Exam has no "volver al proceso" during an active attempt (by design —
  // it is a timed evaluation) — exits via the "← Salir" header button.
  await page.getByRole('button', { name: /salir/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  last = await waitForProcessProgress(page, trace, 85);
  expect(last?.sessionId, 'same session A after Examen').toBe(sessionA);
  expect(last?.progress, `progress must be 85 (64+21) after Examen, saw ${JSON.stringify(last)}`).toBe(85);
  expect(last?.freeToolsKeys, `envelope keys must include exam, saw ${JSON.stringify(last)}`).toContain('exam');
  assertSingleMatchingSession('after Examen');

  // ── Study Map: auto-generates on open → +7 = 92 ──
  await page.getByText('Study Map', { exact: true }).click();
  await expect(page.getByText('Mapa Full E2E')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  last = await waitForProcessProgress(page, trace, 92);
  expect(last?.sessionId, 'same session A after Study Map').toBe(sessionA);
  expect(last?.progress, `progress must be 92 (85+7) after Study Map, saw ${JSON.stringify(last)}`).toBe(92);
  expect(last?.freeToolsKeys, `envelope keys must include studymap, saw ${JSON.stringify(last)}`).toContain('studymap');
  assertSingleMatchingSession('after Study Map');

  // ── Truquitos: auto-generates on open → +8 = 100 ──
  await page.getByText('Truquitos', { exact: true }).click();
  await expect(page.getByText('Regla Full')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /volver al proceso/i }).click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  last = await waitForProcessProgress(page, trace, 100);
  expect(last?.sessionId, 'same session A after Truquitos').toBe(sessionA);
  expect(last?.progress, `progress must be exactly 100 (92+8) after all 8 tools, saw ${JSON.stringify(last)}`).toBe(100);
  expect(last?.freeToolsKeys, `envelope keys must include all 8 tools, saw ${JSON.stringify(last)}`).toEqual(
    expect.arrayContaining(['flashcards', 'quiz', 'repasar', 'analysis', 'alai', 'exam', 'studymap', 'truquitos']),
  );
  assertSingleMatchingSession('after Truquitos (all 8 tools done)');

  // ── Final hard refresh on the hub after all 8 tools — 100% must survive ──
  await page.reload();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  processEvents = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  last = processEvents[processEvents.length - 1];
  expect(last.sessionId, 'session identity must survive the final refresh').toBe(sessionA);
  expect(last.progress, 'progress must still be 100 after the final refresh').toBe(100);

  // ── Exit to TemaView and reopen — must offer "Seguir estudiando" at 100% ──
  await page.getByRole('button', { name: /volver al mapa/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '🏠' }).click();
  await page.waitForTimeout(500);
  await page.getByText('Materia E2E Full', { exact: true }).click();
  await page.getByText('Tema E2E Full', { exact: true }).click();
  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material E2E Full' }).click();
  const estudiarBtn3 = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn3).toBeVisible({ timeout: 10_000 });
  expect(await estudiarBtn3.textContent(), 'must still show "Seguir estudiando" after the full 8-tool run').toMatch(/seguir estudiando/i);
  await estudiarBtn3.click();
  await expect(page.getByText('Flashcards', { exact: true })).toBeVisible({ timeout: 15_000 });
  last = await waitForProcessProgress(page, trace, 100);
  expect(last?.sessionId, 'resuming after the full run must resolve to session A').toBe(sessionA);
  expect(last?.progress, 'progress must still be 100 after resume').toBe(100);

  // ── No duplicate sessions ever, no unexplained deletions, no invalid source selection ──
  processEvents = trace.filter(e => e.event === 'STUDYAL_PROCESS_RENDER');
  const allSessionIds = new Set(processEvents.map((e: any) => e.sessionId));
  expect(allSessionIds.size, `exactly one session must have been used throughout, saw: ${JSON.stringify([...allSessionIds])}`).toBe(1);
  expect(trace.filter(e => e.event === 'CLEANUP_SESSIONS_DELETE'), 'no session should ever be deleted during this flow').toEqual([]);
  expect(enfoquesErrors, `no unexpected /enfoques/teorico/start errors during normal navigation, saw: ${JSON.stringify(enfoquesErrors)}`).toEqual([]);
});
