import { test, expect } from '@playwright/test';

const FORBIDDEN = /Ya tienes una sesi[oó]n iniciada|Sesi[oó]n iniciada/i;

test.describe('auth transition never flashes the stale "session already active" screen', () => {
  test('fresh registration + login never shows the message and lands on Home via the canonical loader', async ({ page }) => {
    const email = `studyal-transition-${Date.now()}@example.com`;
    const password = 'Test1234pass';

    await page.goto('/auth');

    // Watch continuously through the whole transition — the bug is a ~1s
    // flash between successful auth and navigation, so a single post-hoc
    // check would miss it.
    const forbiddenSeen: string[] = [];
    const watcher = setInterval(async () => {
      try {
        const text = await page.locator('body').innerText({ timeout: 500 }).catch(() => '');
        if (FORBIDDEN.test(text)) forbiddenSeen.push(text);
      } catch {
        // page navigating — ignore
      }
    }, 100);

    await page.getByRole('button', { name: /Registrarse/i }).click();
    await page.getByPlaceholder('tu@email.com').fill(email);
    await page.getByPlaceholder('••••••••').first().fill(password);
    const confirmField = page.getByPlaceholder('••••••••').nth(1);
    await confirmField.fill(password);
    await page.getByRole('button', { name: /Crear cuenta/i }).click();

    await page.waitForURL('**/', { timeout: 30_000 });
    clearInterval(watcher);

    expect(forbiddenSeen, `forbidden "session already active" text was rendered: ${forbiddenSeen.join(' | ')}`).toHaveLength(0);
  });

  test('an already-authenticated user opening /auth is redirected silently to Home, never sees the message', async ({ page }) => {
    // Reuses the session cookie from the previous test in this worker via storageState is
    // overkill for a focused check; instead perform a fresh credentials login first.
    const email = `studyal-transition-b-${Date.now()}@example.com`;
    const password = 'Test1234pass';

    await page.goto('/auth');
    await page.getByRole('button', { name: /Registrarse/i }).click();
    await page.getByPlaceholder('tu@email.com').fill(email);
    await page.getByPlaceholder('••••••••').first().fill(password);
    await page.getByPlaceholder('••••••••').nth(1).fill(password);
    await page.getByRole('button', { name: /Crear cuenta/i }).click();
    await page.waitForURL('**/', { timeout: 30_000 });

    // Now already authenticated — open /auth directly.
    const forbiddenSeen: string[] = [];
    const watcher = setInterval(async () => {
      try {
        const text = await page.locator('body').innerText({ timeout: 500 }).catch(() => '');
        if (FORBIDDEN.test(text)) forbiddenSeen.push(text);
      } catch {
        // navigating — ignore
      }
    }, 100);

    await page.goto('/auth');
    await page.waitForURL('**/', { timeout: 30_000 });
    clearInterval(watcher);

    expect(forbiddenSeen, `forbidden "session already active" text was rendered: ${forbiddenSeen.join(' | ')}`).toHaveLength(0);
  });
});
