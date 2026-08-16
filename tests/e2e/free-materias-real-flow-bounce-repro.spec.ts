import { expect, test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';

// ═══════════════════════════════════════════════════════════════════
// BUG REAL #2 — REPRODUCTION AGAINST THE REAL app/materias/page.tsx FLOW
// (not the synthetic /e2e-free-continuity harness, which never exercises
// the findAndOpen effect, useSession(), or lookupMateriasDesdeDB()).
//
// This file has TWO specs:
//
// 1. "URL-restore race" — captures the [free-nav-debug] timeline for the
//    cross-device-restore / refresh entry point (temaId+freeSessionId+
//    freeTool in the URL). Kept for regression coverage of that path.
//
// 2. "REAL interactive click flow" — the actual user-reported repro:
//    materias list -> materia -> tema -> select material node -> resume
//    into Free hub -> click Flashcards tool -> click Generar flashcards.
//    This drives TemaView's real click handlers (handleNodeClick,
//    "seguir estudiando", StudyALProcess tool cards) instead of URL
//    query params, so it exercises TemaView's onOpenFlashcards handler
//    (refreshSessions + upsertSession) that the URL-restore path skips
//    entirely (TemaView barely mounts before flipping to flashcards).
// ═══════════════════════════════════════════════════════════════════

const TEMA_ID = 'tema_e2e_repro_1';
const MATERIA_ID = 'materia_e2e_repro_1';
const MATERIAL_ID = 'mat_e2e_repro_1';
const SESSION_ID = 'sess_e2e_repro_1';

const snapshot = buildSourceSelectionSnapshot([MATERIAL_ID], { [MATERIAL_ID]: [1, 2] });

const materia = {
  id: MATERIA_ID,
  nombre: 'Materia E2E Repro',
  color: '#22d3ee',
  emoji: '📘',
  temas: [
    {
      id: TEMA_ID,
      nombre: 'Tema E2E Repro',
      color: '#22d3ee',
      apuntes: [],
      documentos: [
        {
          id: MATERIAL_ID,
          materialId: MATERIAL_ID,
          nombre: 'Material E2E Repro',
          kind: 'pdf',
          archivoUrl: '',
        },
      ],
    },
  ],
};

function nowIso() {
  return new Date().toISOString();
}

const studySession = {
  id: SESSION_ID,
  userId: 'e2e-user-1',
  temaId: TEMA_ID,
  enfoque: 'teorico',
  processMode: 'free',
  studyMode: 'free',
  materialIds: [MATERIAL_ID],
  primaryMaterialId: MATERIAL_ID,
  materialNames: ['Material E2E Repro'],
  selectedPages: { [MATERIAL_ID]: [1, 2] },
  sourceSelectionFingerprint: snapshot.fingerprint,
  createdAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
  lastOpenedAt: Date.now() - 60_000,
};

async function installRoutes(page: Page, opts: { generationDelayMs: number }) {
  const state = { session: studySession as any };
  const calls = { authSession: 0, materias: 0, studySessions: 0, enfoques: 0, alaiCards: 0 };
  const enfoquesBodies: any[] = [];

  // Catch-all first (lowest priority) — anything not explicitly handled below.
  await page.route('**/api/**', route => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route('**/api/auth/session', route => {
    calls.authSession++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'e2e-user-1', name: 'E2E User', email: 'e2e@test.local' },
        expires: '2099-01-01T00:00:00.000Z',
        // cache-buster so each parse is trivially a fresh object (real behavior too)
        _t: nowIso(),
      }),
    });
  });

  await page.route('**/api/materias', route => {
    calls.materias++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, materias: [materia], revision: calls.materias }),
    });
  });

  await page.route('**/api/study-sessions**', async route => {
    calls.studySessions++;
    const req = route.request();
    if (req.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, sessions: [state.session] }),
      });
    }
    const payload = req.postDataJSON();
    if (payload?.session) state.session = { ...state.session, ...payload.session };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route('**/api/enfoques/teorico/start', async route => {
    calls.enfoques++;
    const req = route.request().postDataJSON();
    enfoquesBodies.push(req);
    if (req?.sourceSelection) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          sourceSelectionFingerprint: req.sourceSelection.fingerprint,
          totalChars: 40,
          materials: {
            [MATERIAL_ID]: {
              materialId: MATERIAL_ID,
              selectedPages: [1, 2],
              text: '[Pagina 1]\nCONTENT A\n[Pagina 2]\nCONTENT B',
              nombre: 'Material E2E Repro',
              kind: 'pdf',
              chars: 40,
            },
          },
        }),
      });
    }
    // Legacy autoExtractConcepts path: plain materialIds, no sourceSelection.
    // Whatever bogus id it sends (evidence for Phase 13) — try to match, else 422-empty.
    const requestedIds: string[] = Array.isArray(req?.materialIds) ? req.materialIds : [];
    const matched = requestedIds.includes(MATERIAL_ID);
    if (!matched) {
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No se pudo extraer texto de ningún material' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        materials: { [MATERIAL_ID]: { text: 'CONTENT A CONTENT B', nombre: 'Material E2E Repro', kind: 'pdf' } },
      }),
    });
  });

  await page.route('**/api/materials/*/download-url', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, url: 'data:application/pdf;base64,JVBERi0xLjQK' }),
    });
  });

  await page.route('**/api/alai-studyal-cards', async route => {
    calls.alaiCards++;
    await new Promise(r => setTimeout(r, opts.generationDelayMs));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        flashcards: [
          { id: 'fc-1', question: 'Q1', answer: 'A1', sourcePage: 1 },
          { id: 'fc-2', question: 'Q2', answer: 'A2', sourcePage: 2 },
        ],
      }),
    });
  });

  return { calls, enfoquesBodies, state };
}

function attachTimelineCapture(page: Page) {
  const timeline: { t: number; text: string }[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[free-nav-debug]')) {
      timeline.push({ t: Date.now(), text });
    }
  });
  return timeline;
}

test('BUG REAL #2 REPRO (URL-restore path): real /materias findAndOpen restore + generation race, captured via [free-nav-debug]', async ({ page }) => {
  test.setTimeout(60_000);

  const timeline = attachTimelineCapture(page);
  const { calls, enfoquesBodies } = await installRoutes(page, { generationDelayMs: 6000 });

  // Real URL-restore entry point (same code path as cross-device restore /
  // Continue Studying / browser refresh — first-class app behavior, not a
  // test-only shortcut): app/materias/page.tsx's findAndOpen effect reads
  // temaId + freeSessionId + freeTool from the URL on mount.
  await page.goto(`/materias?temaId=${TEMA_ID}&freeSessionId=${SESSION_ID}&freeTool=flashcards`);

  // Flashcards should resolve into view (via findAndOpen's async restore).
  const generarButton = page.getByRole('button', { name: /Generar flashcards/ });
  await expect(generarButton).toBeVisible({ timeout: 15_000 });

  const t0 = Date.now();
  await generarButton.click();

  // While the 6s-delayed alai-studyal-cards POST is in flight, deliberately
  // provoke next-auth session refetches (visibilitychange + focus — next-auth's
  // SessionProvider listens for both) to test whether that churns `materias`
  // and re-triggers findAndOpen mid-generation.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
  }

  // Wait out the rest of the generation window.
  await page.waitForTimeout(Math.max(0, 7000 - (Date.now() - t0)));
  await page.waitForTimeout(2000);

  const deckVisible = await page.getByText('Q1').isVisible().catch(() => false);
  const generarButtonStillThere = await generarButton.isVisible().catch(() => false);
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));

  const bounceEvents = timeline.filter(e => e.text.includes('VIEW_TRANSITION'));

  const outDir = path.resolve(__dirname, '../../reports');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'free-nav-debug-repro-timeline.json'),
    JSON.stringify({ timeline, calls, enfoquesBodies, deckVisible, generarButtonStillThere, bodyTextSample: bodyText, bounceEventsAfterGenerate: bounceEvents.filter(e => e.t >= t0) }, null, 2),
  );

  expect(deckVisible, `Flashcards deck should be visible after generation. Body: ${bodyText}`).toBe(true);
  // No VIEW_TRANSITION should occur once generation has started (the only
  // legitimate transitions are the initial 'lista'->'tema'->'flashcards'
  // restore chain, which all happens before t0).
  const bounceAfterGenerate = bounceEvents.filter(e => e.t >= t0);
  expect(bounceAfterGenerate, `Unexpected view transitions during generation: ${JSON.stringify(bounceAfterGenerate)}`).toEqual([]);
});

test('BUG REAL #2 REPRO (real interactive click flow): materias -> materia -> tema -> select material -> Free hub -> Flashcards -> Generar, no bounce during slow generation', async ({ page }) => {
  test.setTimeout(90_000);

  const timeline = attachTimelineCapture(page);
  const { calls } = await installRoutes(page, { generationDelayMs: 8000 });

  await page.goto('/materias');

  // ── materias list -> materia ──
  await page.getByText('Materia E2E Repro', { exact: true }).click();

  // ── materia -> tema (real TemaView mount) ──
  await page.getByText('Tema E2E Repro', { exact: true }).click();

  // ── TemaView's mind-map: expand "Material" branch, select the document node ──
  // Click the `.node` card itself (not the inner text leaf) — the card is the
  // actual pointer-events:auto click target; the label div can be occluded by
  // its own ancestor during the camera-pan animation.
  await page.locator('.node').filter({ hasText: 'Material' }).first().click();
  await page.locator('.node').filter({ hasText: 'Material E2E Repro' }).click();

  // ── "seguir estudiando" (resume — a matching free session already exists
  // for this material in the fixture) or "empezar a estudiar" (fresh) ──
  const estudiarBtn = page.getByRole('button', { name: /seguir estudiando|empezar a estudiar/ });
  await expect(estudiarBtn).toBeVisible({ timeout: 10_000 });
  const estudiarLabel = (await estudiarBtn.textContent()) || '';
  await estudiarBtn.click();

  if (/empezar a estudiar/i.test(estudiarLabel)) {
    // Fresh flow: mode selector -> "Libre" -> SeleccionPaginas confirm (all
    // pages pre-selected by default for a 2-page material).
    await page.getByRole('button', { name: 'Libre' }).click();
    await page.getByRole('button', { name: /Confirmar/ }).click();
  }

  // ── Free hub (StudyALProcess) -> Flashcards tool ──
  await page.getByText('Flashcards', { exact: true }).click();

  const generarButton = page.getByRole('button', { name: /Generar flashcards/ });
  await expect(generarButton).toBeVisible({ timeout: 15_000 });

  const t0 = Date.now();
  await generarButton.click();

  // Provoke next-auth session refetch churn mid-generation (real trigger:
  // visibilitychange/focus, which SessionProvider listens for).
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
  }

  await page.waitForTimeout(Math.max(0, 9000 - (Date.now() - t0)));
  await page.waitForTimeout(2000);

  const deckVisible = await page.getByText('Q1').isVisible().catch(() => false);
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  const bounceEvents = timeline.filter(e => e.text.includes('VIEW_TRANSITION') && e.t >= t0);
  const mountEvents = timeline.filter(e => (e.text.includes('MOUNT') || e.text.includes('UNMOUNT')) && e.text.includes('TemaView') && e.t >= t0);

  const outDir = path.resolve(__dirname, '../../reports');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'free-nav-debug-real-click-timeline.json'),
    JSON.stringify({ timeline, calls, deckVisible, bodyTextSample: bodyText, bounceEventsAfterGenerate: bounceEvents, temaViewMountEventsAfterGenerate: mountEvents }, null, 2),
  );

  expect(deckVisible, `Flashcards deck should be visible after generation. Body: ${bodyText}`).toBe(true);
  expect(bounceEvents, `Unexpected view transitions during generation: ${JSON.stringify(bounceEvents)}`).toEqual([]);
  expect(mountEvents, `TemaView should not remount during Flashcards generation: ${JSON.stringify(mountEvents)}`).toEqual([]);
});
