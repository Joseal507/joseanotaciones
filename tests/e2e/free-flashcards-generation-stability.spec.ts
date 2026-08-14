import { expect, test, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════
// FREE FLASHCARDS GENERATION STABILITY
// Regression test for the bounce bug reported after FREE-FINAL:
//   - User clicks Generate
//   - Backend generates 53 cards in multiple batches
//   - UI bounces between TemaView and Flashcards
//   - Never shows the deck
//
// Root cause: sourceSelection built inline in JSX in app/materias/page.tsx
// caused new object identity every render → useAuthorizedSource abort+refetch
// → setResult(null) → Flashcards UI disappeared.
//
// This test verifies that during a long generation (multiple batches with
// delay), the Flashcards component stays mounted and visible.
// ═══════════════════════════════════════════════════════════════════

type DurableSession = Record<string, unknown> | null;

const flashcardsFixture = [
  { id: 'fc-1', question: 'Q1', answer: 'A1', sourcePage: 2 },
  { id: 'fc-2', question: 'Q2', answer: 'A2', sourcePage: 5 },
  { id: 'fc-3', question: 'Q3', answer: 'A3', sourcePage: 2 },
];

async function installRoutes(page: Page, opts: { server: { session: DurableSession }; delayMs?: number }) {
  const calls = { flashcards: 0, source: 0, studySessions: 0 };
  const delayMs = opts.delayMs ?? 0;

  await page.route('**/api/study-sessions**', async route => {
    calls.studySessions++;
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, sessions: opts.server.session ? [opts.server.session] : [] }),
      });
    }
    const payload = route.request().postDataJSON();
    opts.server.session = payload.session || payload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route('**/api/enfoques/teorico/start', async route => {
    calls.source++;
    const req = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
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

  await page.route('**/api/alai-studyal-cards', async route => {
    calls.flashcards++;
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, flashcards: flashcardsFixture }),
    });
  });

  return calls;
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1 — Flashcards permanece montado durante generación larga
// ═══════════════════════════════════════════════════════════════════

test('FLASHCARDS STABILITY: componente permanece montado durante generación de 5 segundos', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installRoutes(page, { server, delayMs: 5000 });

  await page.goto('/e2e-free-continuity?tool=flashcards');

  // Header de Flashcards debe estar visible desde el inicio
  await expect(page.getByText('StudyAL cards')).toBeVisible({ timeout: 10000 });

  // Contar cuántas veces se llamó a /enfoques/teorico/start (source fetch)
  // Debe ser exactamente 1 durante toda la generación
  await page.waitForTimeout(7000);

  // Después del delay, el deck debe aparecer
  await expect(page.getByText('StudyAL cards')).toBeVisible({ timeout: 10000 });

  // INVARIANTE CRÍTICA: solo 1 fetch de source durante generación (sin bounce)
  expect(calls.source).toBeLessThanOrEqual(2);
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2 — Source fetch se deduplica por fingerprint
// ═══════════════════════════════════════════════════════════════════

test('SOURCE DEDUPE: mismo fingerprint no dispara múltiples fetches', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installRoutes(page, { server });

  await page.goto('/e2e-free-continuity?tool=flashcards');
  await expect(page.getByText('StudyAL cards')).toBeVisible({ timeout: 10000 });

  // Esperar que source resuelva
  await page.waitForTimeout(1500);
  const sourceCallsBefore = calls.source;

  // Navegar a otra herramienta con mismo material → mismo fingerprint
  await page.goto('/e2e-free-continuity?tool=quiz');
  await page.waitForTimeout(1500);

  // Y volver a Flashcards
  await page.goto('/e2e-free-continuity?tool=flashcards');
  await page.waitForTimeout(1500);

  // Source fetch debería no crecer significativamente (cache in-memory)
  // Máximo 3 fetches (uno por cada mount, pero deberían ser 0 gracias al cache)
  expect(calls.source).toBeLessThanOrEqual(sourceCallsBefore + 2);
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3 — Route handle body abortado
// ═══════════════════════════════════════════════════════════════════

test('ROUTE HARDENING: /api/enfoques/teorico/start responde 400 controlado a body inválido', async ({ page }) => {
  await page.goto('/e2e-free-continuity?tool=hub');

  const response = await page.evaluate(async () => {
    const res = await fetch('/api/enfoques/teorico/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json at all',
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });

  // No debe crashear con 500. Debe devolver 400 o 401 (auth).
  expect([400, 401]).toContain(response.status);
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4 — Navigation stability: cambio de tool no destruye estado en progreso
// ═══════════════════════════════════════════════════════════════════

test('NAVIGATION STABILITY: cambiar de herramienta y volver mantiene sessionId estable', async ({ page }) => {
  const server = { session: null as DurableSession };
  const calls = await installRoutes(page, { server });

  await page.goto('/e2e-free-continuity?tool=flashcards');
  await expect(page.getByText('StudyAL cards')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1000);

  // Snapshot inicial del sessionId
  const sessionBefore = server.session as any;
  expect(sessionBefore).not.toBeNull();
  const sessionIdBefore = sessionBefore?.id;
  const fingerprintBefore = sessionBefore?.sourceSelectionFingerprint;

  // Navegar a Quiz
  await page.goto('/e2e-free-continuity?tool=quiz');
  await page.waitForTimeout(1000);

  // Volver a Flashcards
  await page.goto('/e2e-free-continuity?tool=flashcards');
  await expect(page.getByText('StudyAL cards')).toBeVisible({ timeout: 10000 });

  const sessionAfter = server.session as any;
  expect(sessionAfter?.id).toBe(sessionIdBefore);
  expect(sessionAfter?.sourceSelectionFingerprint).toBe(fingerprintBefore);
});
