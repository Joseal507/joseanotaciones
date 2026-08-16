// ── ZERO-PAID-PROVIDER TEST GUARD (server startup hook) ────────────
// Next.js runs `register()` once when the server process starts, before any
// request is handled. This is a NO-OP in every environment except when
// STUDYAL_TEST_NO_PROVIDER_CALLS=1 — an env var set ONLY by
// playwright.config.ts's webServer.env (a local Playwright-spawned dev
// server). It is never present in .env, .env.local, .env.production, or any
// deployed environment, so this can never activate accidentally in
// production and production provider routing/policy is completely
// unchanged when unset.
//
// When active, it patches the process-wide fetch to throw BEFORE any real
// network request reaches a paid AI provider host — a backstop independent
// of lib/alai.ts's single chokepoint guard, covering the few other direct
// fetch('https://openrouter.ai/...') call sites (vision/OCR extraction,
// audio transcription, adaptive blueprint generation) that don't go through
// alai()/alaiJson(). Any Playwright test whose route mocks have a gap will
// see this error surface through the app's normal error handling and fail,
// instead of silently spending real provider credits.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.STUDYAL_TEST_NO_PROVIDER_CALLS !== '1') return;

  const BLOCKED_HOST_SUBSTRINGS = [
    'openrouter.ai',
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    if (BLOCKED_HOST_SUBSTRINGS.some(host => url.includes(host))) {
      throw new Error(
        `STUDYAL_TEST_MODE: blocked a real network call to a paid AI provider (${url}). ` +
        'This route was not mocked in the current Playwright test — add a ' +
        'page.route() fixture for the endpoint that triggers this call instead ' +
        'of letting the request reach the real provider.',
      );
    }

    return originalFetch(input as any, init);
  }) as typeof fetch;

  // eslint-disable-next-line no-console
  console.warn('[STUDYAL_TEST_MODE] Paid provider network guard installed — openrouter.ai calls will throw.');
}
