// ═══════════════════════════════════════════════════════════════════
// TEMPORARY DEV-ONLY INSTRUMENTATION — BUG REAL #2 (Free Flashcards bounce)
// Prefix: [free-nav-debug]
// Safe to delete once the race is confirmed/fixed and verified manually.
// No-ops in production builds.
// ═══════════════════════════════════════════════════════════════════

const ENABLED = process.env.NODE_ENV !== 'production';

let renderSeq = 0;
export function nextFreeNavRenderId(): number {
  return ++renderSeq;
}

let instanceSeq = 0;
export function nextFreeNavInstanceId(prefix: string): string {
  return `${prefix}-${++instanceSeq}-${Date.now().toString(36)}`;
}

export function freeNavDebug(event: string, data?: Record<string, unknown>) {
  if (!ENABLED) return;
  // eslint-disable-next-line no-console
  console.log(`[free-nav-debug] ${event}`, data ? JSON.stringify(data) : '');
}

export function freeNavCallsite(skipFrames = 2): string {
  if (!ENABLED) return 'disabled';
  const stack = new Error().stack || '';
  const line = stack.split('\n')[skipFrames];
  return (line || 'unknown-callsite').trim().replace(/^at\s+/, '');
}
