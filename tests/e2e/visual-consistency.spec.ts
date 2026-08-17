import { expect, test, type Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════
// VERIFICACIÓN VISUAL — sistema unificado de theme / paleta / tipografía.
//
// No hace pixel-diff ni snapshots frágiles: comprueba el DOM real y
// computedStyle, que es lo que de verdad define "se siente una sola app".
// Se ejecuta explícitamente (playwright.config lo excluye por el patrón
// visual-*.spec.ts) con:
//   npx playwright test tests/e2e/visual-consistency.spec.ts --config=playwright.visual.config.ts
// ═══════════════════════════════════════════════════════════════════

// Superficies que renderizan sin sesión autenticada.
const PUBLIC_SURFACES = ['/landing', '/auth', '/legal', '/terminos'];

async function seedTheme(
  page: Page,
  opts: { dark?: boolean; tema?: string; custom?: Record<string, string> } = {},
) {
  const { dark = true, tema = 'default', custom } = opts;
  await page.addInitScript(
    ([d, t, c]) => {
      localStorage.setItem('studyal_darkmode', d ? 'dark' : 'light');
      const settings: Record<string, unknown> = { tema: t };
      if (c) settings.customTheme = c;
      localStorage.setItem('studyal_settings', JSON.stringify(settings));
    },
    [dark, tema, custom ?? null] as const,
  );
}

function readVars(page: Page) {
  return page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      gold: s.getPropertyValue('--gold').trim(),
      red: s.getPropertyValue('--red').trim(),
      blue: s.getPropertyValue('--blue').trim(),
      pink: s.getPropertyValue('--pink').trim(),
      bg: s.getPropertyValue('--bg-primary').trim(),
      dataTheme: document.documentElement.getAttribute('data-theme'),
      isLight: document.documentElement.classList.contains('light'),
    };
  });
}

// ── CHECK 1 — FONT ────────────────────────────────────────────────
test('font: toda la UI resuelve a la familia canónica', async ({ page }) => {
  await seedTheme(page);
  for (const path of PUBLIC_SURFACES) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(bodyFont, `body font en ${path}`).toMatch(/Jakarta/i);

    // Ningún nodo visible puede quedar en una familia cursiva heredada.
    const cursive = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll<HTMLElement>('body *').forEach(el => {
        if (el.closest('.katex, .ebloque, [contenteditable]')) return;
        if (el.classList.contains('brand-study-home')) return;
        const ff = getComputedStyle(el).fontFamily;
        if (/Caveat|Brush Script|Patrick Hand|Pacifico/i.test(ff)) {
          bad.push(`${el.tagName}.${el.className} -> ${ff}`);
        }
      });
      return bad.slice(0, 10);
    });
    expect(cursive, `fuentes cursivas en ${path}`).toEqual([]);
  }
});

// ── CHECK 2 — ITALIC ──────────────────────────────────────────────
test('italic: cero cursiva en la UI salvo el logo del Home', async ({ page }) => {
  await seedTheme(page);
  for (const path of PUBLIC_SURFACES) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const italics = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll<HTMLElement>('body *').forEach(el => {
        // Contenido con tipografía propia: no es chrome de StudyAL.
        if (el.closest('.katex, .ebloque, [contenteditable], blockquote')) return;
        if (el.classList.contains('brand-study-home')) return;
        if (!el.textContent?.trim()) return;
        if (getComputedStyle(el).fontStyle === 'italic') {
          bad.push(`${el.tagName}.${el.className}`);
        }
      });
      return bad.slice(0, 10);
    });
    expect(italics, `cursivas en ${path}`).toEqual([]);
  }
});

// ── CHECK 3/4 — LIGHT & DARK ──────────────────────────────────────
test('dark: tokens oscuros aplicados', async ({ page }) => {
  await seedTheme(page, { dark: true });
  await page.goto('/landing', { waitUntil: 'domcontentloaded' });
  const v = await readVars(page);
  expect(v.isLight).toBe(false);
  expect(v.bg).toBe('#000000');
  await page.screenshot({ path: 'reports/playwright/visual-dark.png', fullPage: false });
});

test('light: tokens claros aplicados', async ({ page }) => {
  await seedTheme(page, { dark: false });
  await page.goto('/landing', { waitUntil: 'domcontentloaded' });
  const v = await readVars(page);
  expect(v.isLight).toBe(true);
  expect(v.bg).toBe('#f8f8f8');
  await page.screenshot({ path: 'reports/playwright/visual-light.png', fullPage: false });
});

// ── CHECK 5 — PALETA ──────────────────────────────────────────────
test('paleta: cada preset reescribe los tokens de accent', async ({ page }) => {
  await seedTheme(page, { tema: 'neon' });
  await page.goto('/landing', { waitUntil: 'domcontentloaded' });
  const neon = await readVars(page);
  expect(neon.dataTheme).toBe('neon');
  expect(neon.gold).toBe('#00f5d4');
  expect(neon.red).toBe('#f72585');

  // La paleta debe sobrevivir la navegación entre superficies.
  await page.goto('/terminos', { waitUntil: 'domcontentloaded' });
  expect((await readVars(page)).gold).toBe('#00f5d4');
});

test('paleta custom: alimenta los mismos tokens que los presets', async ({ page }) => {
  await seedTheme(page, {
    tema: 'custom',
    custom: { name: 'mine', gold: '#123456', red: '#654321', blue: '#abcdef', pink: '#fedcba' },
  });
  await page.goto('/landing', { waitUntil: 'domcontentloaded' });
  const v = await readVars(page);
  expect(v.dataTheme).toBe('custom');
  expect(v.gold).toBe('#123456');
  expect(v.blue).toBe('#abcdef');
});

// ── ANTI-FOUC ─────────────────────────────────────────────────────
test('anti-FOUC: el theme se aplica desde <head>, antes de pintar el body', async ({ page }) => {
  await seedTheme(page, { dark: false });
  const response = await page.goto('/landing', { waitUntil: 'domcontentloaded' });

  // 1) El bootstrap debe ser un script bloqueante DENTRO de <head>. Si
  //    estuviera en <body> o se ejecutara en un useEffect, el navegador
  //    ya habría pintado un frame con el tema por defecto (oscuro).
  const html = (await response!.text());
  const scriptIdx = html.indexOf('studyal_darkmode');
  const headEndIdx = html.indexOf('</head>');
  expect(scriptIdx, 'el bootstrap de theme debe existir en el HTML').toBeGreaterThan(-1);
  expect(scriptIdx, 'el bootstrap debe estar dentro de <head>').toBeLessThan(headEndIdx);

  // 2) Y para cuando el DOM está listo, la preferencia ya está aplicada.
  const applied = await page.evaluate(() => ({
    light: document.documentElement.classList.contains('light'),
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim(),
  }));
  expect(applied.light).toBe(true);
  expect(applied.bg).toBe('#f8f8f8');
});
