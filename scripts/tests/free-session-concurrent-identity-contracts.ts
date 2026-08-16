import assert from 'node:assert/strict';
import { upsertSession, getSessionsByTema } from '../../lib/studySessions';

// ═══════════════════════════════════════════════════════════════════
// P0 ABSOLUTO — canonical, idempotent StudySession identity for Free Mode
//
// Contract: for a fixed Free identity (temaId + processMode=free +
// normalized materialIds + normalized selectedPages, i.e. a fixed
// sourceSelectionFingerprint), N calls to upsertSession() — however many,
// however interleaved — MUST resolve to exactly ONE sessionId. This is
// what every tool-open handler in TemaView.tsx relies on implicitly:
// none of them check "does a session already exist" before calling
// upsertSession(); they all trust upsertSession() itself to be the single
// source of idempotent truth.
// ═══════════════════════════════════════════════════════════════════

const memory = new Map<string, string>();
const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
const originalLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
const originalFetch = globalThis.fetch;

Object.assign(globalThis, {
  window: {},
  localStorage: {
    getItem: (key: string) => memory.get(key) || null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  },
});
globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch;

async function main() {
try {
  const temaId = 'tema-concurrent';
  const materialIds = ['mat-concurrent'];
  const selectedPages = { 'mat-concurrent': [1, 2] };

  function upsertSameFreeIdentity(debugCaller: string) {
    // Simulate a real caller: some async prep (fetch/await), THEN the
    // synchronous upsertSession() call — mirrors how TemaView's onOpenX
    // wrappers are invoked from async-adjacent React event handlers.
    return Promise.resolve().then(() => upsertSession({
      debugCaller,
      temaId,
      enfoque: 'teorico',
      processMode: 'free',
      materialIds,
      materialNames: ['Material Concurrent'],
      selectedPages,
    }));
  }

  // ── A: 5 concurrent calls with identical identity → exactly 1 unique id ──
  {
    memory.clear();
    const results = await Promise.all([
      upsertSameFreeIdentity('caller-1'),
      upsertSameFreeIdentity('caller-2'),
      upsertSameFreeIdentity('caller-3'),
      upsertSameFreeIdentity('caller-4'),
      upsertSameFreeIdentity('caller-5'),
    ]);
    const uniqueIds = new Set(results.map(r => r.id));
    assert.equal(uniqueIds.size, 1, `5 concurrent upserts of the same Free identity must resolve to 1 unique id, got ${uniqueIds.size}: ${JSON.stringify([...uniqueIds])}`);
    assert.equal(getSessionsByTema(temaId).length, 1, 'exactly one durable session must exist for this tema after the burst');
  }

  // ── B: 10 concurrent calls with identical identity → exactly 1 unique id ──
  {
    memory.clear();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => upsertSameFreeIdentity(`caller-${i}`)),
    );
    const uniqueIds = new Set(results.map(r => r.id));
    assert.equal(uniqueIds.size, 1, `10 concurrent upserts of the same Free identity must resolve to 1 unique id, got ${uniqueIds.size}: ${JSON.stringify([...uniqueIds])}`);
    assert.equal(getSessionsByTema(temaId).length, 1, 'exactly one durable session must exist for this tema after the burst');
  }

  // ── C: sequential calls (the realistic pattern — each tool-open handler
  // fires one at a time, never truly parallel in a single-threaded UI)
  // must ALSO converge to the same id, regardless of call order or which
  // caller happens to run first. ──
  {
    memory.clear();
    const callers = ['ensureFreeSessionForTool', 'onOpenFlashcards', 'onOpenRepasar', 'startFree(SeleccionPaginas-confirm)'];
    const ids: string[] = [];
    for (const caller of callers) {
      const sess = await upsertSameFreeIdentity(caller);
      ids.push(sess.id);
    }
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, 1, `sequential upserts from every real tool-open caller must converge to 1 id, got ${uniqueIds.size}: ${JSON.stringify(ids)}`);
  }

  // ── D: a DIFFERENT identity (different selectedPages) for the SAME
  // material must never collapse into the same session — concurrency
  // safety must not come at the cost of source-selection isolation. ──
  {
    memory.clear();
    const [wholeDoc, explicitPages] = await Promise.all([
      Promise.resolve().then(() => upsertSession({ debugCaller: 'wholedoc', temaId, enfoque: 'teorico', processMode: 'free', materialIds, materialNames: ['M'] })),
      Promise.resolve().then(() => upsertSession({ debugCaller: 'pages', temaId, enfoque: 'teorico', processMode: 'free', materialIds, materialNames: ['M'], selectedPages })),
    ]);
    assert.notEqual(wholeDoc.id, explicitPages.id, 'concurrent creation of two genuinely DIFFERENT Free identities must never collapse into one session');
    assert.equal(getSessionsByTema(temaId).length, 2, 'both distinct identities must persist as two durable sessions');
  }

  console.log('free-session-concurrent-identity-contracts: A-D PASS');
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
}
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
