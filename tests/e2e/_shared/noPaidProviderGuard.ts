import type { Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════
// ZERO-PAID-PROVIDER TEST GUARD — client-side half.
//
// Server-side half: instrumentation.ts + lib/alai.ts's
// assertNoRealProviderCallsInTestMode() throw BEFORE any real network call
// reaches a paid provider, when STUDYAL_TEST_NO_PROVIDER_CALLS=1 (set only
// by playwright.config.ts's webServer.env — see that file).
//
// This helper gives tests explicit, positive proof of zero paid-provider
// calls, on two independent signals:
//   1. Direct network observation: the Playwright browser context itself
//      never issues a request to a paid provider host (defense in depth —
//      the app should never call these directly from the client anyway).
//   2. The server-side guard's error marker never surfaces through the
//      app's normal error handling (console/page errors) — proof that no
//      route mock had a gap that let a request reach the real provider.
//
// Usage: call attachNoPaidProviderGuard(page) BEFORE navigating, then
// assertNoPaidProviderCallsObserved() at the end of the test (or rely on
// the thrown error during the test if either signal fires immediately).
// ═══════════════════════════════════════════════════════════════════

const BLOCKED_HOST_SUBSTRINGS = ['openrouter.ai'];
const GUARD_ERROR_MARKER = 'STUDYAL_TEST_MODE: blocked a real network call';

export interface PaidProviderGuard {
  violations: string[];
}

export function attachNoPaidProviderGuard(page: Page): PaidProviderGuard {
  const guard: PaidProviderGuard = { violations: [] };

  page.on('request', request => {
    const url = request.url();
    if (BLOCKED_HOST_SUBSTRINGS.some(host => url.includes(host))) {
      guard.violations.push(`Direct browser request to paid provider host: ${url}`);
    }
  });

  page.on('console', msg => {
    if (msg.type() === 'error' && msg.text().includes(GUARD_ERROR_MARKER)) {
      guard.violations.push(`Server-side guard fired (route mock gap): ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    if (err.message.includes(GUARD_ERROR_MARKER)) {
      guard.violations.push(`Server-side guard fired (route mock gap): ${err.message}`);
    }
  });

  return guard;
}

export function assertNoPaidProviderCallsObserved(guard: PaidProviderGuard) {
  if (guard.violations.length > 0) {
    throw new Error(
      `Zero-paid-provider guard FAILED — ${guard.violations.length} violation(s):\n` +
      guard.violations.map(v => `  - ${v}`).join('\n'),
    );
  }
}
