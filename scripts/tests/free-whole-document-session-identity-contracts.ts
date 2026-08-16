import assert from 'node:assert/strict';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { upsertSession, getSessionsByTema } from '../../lib/studySessions';
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState';

// ═══════════════════════════════════════════════════════════════════
// P0 REGRESSION — "documento completo" Free session identity corruption
//
// Real bug found in manual verification: a material with an EXISTING
// pages-[1,2] Free session, later opened again choosing "documento
// completo" (whole document, no explicit page selection), ended up bound
// to the WRONG session (the old pages-[1,2] one) instead of getting its
// own distinct whole-document identity. ALAI/Truquitos then rejected the
// mismatched (sessionId, sourceSelectionFingerprint) pair.
//
// Root cause: lib/studySessions.ts's upsertSession() only asked
// findSession() to filter by sourceSelectionFingerprint when
// params.selectedPages was truthy. Several TemaView.tsx call sites
// (ensureFreeSessionForTool and others) represent "documento completo" by
// omitting selectedPages entirely (Object.keys(pagesByMat).length ?
// pagesByMat : undefined stays undefined when no material has an explicit
// page array) — so upsertSession silently matched/reused ANY existing
// session for the same materialIds+processMode, regardless of its actual
// selectedPages/fingerprint, corrupting session identity.
//
// Canonical contract (lib/adaptive/sourceSelection.ts, unchanged by this
// fix): selectedPages[materialId] === [] IS the canonical "whole
// document" representation — filterTextToSelectedPages treats an empty
// selection as "keep full text", and hasExplicitPageSelection requires
// EVERY material to have a non-empty page array. Whole-document and an
// explicit page selection are — and must remain — distinct identities.
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

try {
  const temaId = 'tema-whole-doc';
  const materialId = 'mat-whole-doc';

  // ── Step 1: an explicit pages-[1,2] Free session already exists (as if
  // the user studied this exact 2-page material with an explicit page
  // selection on a previous occasion). ──
  const pagesSession = upsertSession({
    temaId, enfoque: 'teorico', processMode: 'free',
    materialIds: [materialId], materialNames: ['Material Whole Doc'],
    selectedPages: { [materialId]: [1, 2] },
  });
  const pagesSource = buildSourceSelectionSnapshot([materialId], { [materialId]: [1, 2] });
  assert.equal(pagesSession.sourceSelectionFingerprint, pagesSource.fingerprint);

  // ── Step 2: LATER, the user opens Free again for the SAME material,
  // this time choosing "documento completo" — no explicit page selection.
  // This mirrors TemaView.tsx's ensureFreeSessionForTool(), which omits
  // `selectedPages` entirely for this case (an empty pagesByMat map). ──
  const wholeDocCall = upsertSession({
    temaId, enfoque: 'teorico', processMode: 'free',
    materialIds: [materialId], materialNames: ['Material Whole Doc'],
    // selectedPages intentionally omitted — the real "documento completo" shape.
  });
  const wholeDocSource = buildSourceSelectionSnapshot([materialId], {});

  // ── A (PRIMARY REGRESSION): whole-document must get its OWN distinct
  // session, never the pre-existing pages-[1,2] session. ──
  assert.notEqual(wholeDocCall.id, pagesSession.id,
    'whole-document must not be silently merged into the pre-existing explicit-pages session');
  assert.deepEqual(wholeDocCall.selectedPages, { [materialId]: [] },
    'whole-document session must canonically store selectedPages=[] for the material');
  assert.equal(wholeDocCall.sourceSelectionFingerprint, wholeDocSource.fingerprint,
    'whole-document session must carry the canonical whole-document fingerprint, not the pages-session one');
  assert.notEqual(wholeDocCall.sourceSelectionFingerprint, pagesSession.sourceSelectionFingerprint);

  // ── B: exactly 2 distinct sessions now exist for this material+tema. ──
  const allForTema = getSessionsByTema(temaId);
  assert.equal(allForTema.length, 2, 'whole-document and explicit-pages must coexist as two distinct sessions');

  // ── C: idempotency — reopening "documento completo" again must resolve
  // to the SAME whole-document session, not create a third one. ──
  const wholeDocAgain = upsertSession({
    temaId, enfoque: 'teorico', processMode: 'free',
    materialIds: [materialId], materialNames: ['Material Whole Doc'],
  });
  assert.equal(wholeDocAgain.id, wholeDocCall.id, 'reopening whole-document must resume the SAME session, not create a new one');
  assert.equal(getSessionsByTema(temaId).length, 2, 'no phantom third session created on reopen');

  // ═══════════════════════════════════════════════════════════════════
  // D-F: the actual tool-facing contract — validOwner()-gated envelope
  // read/write, exactly what ALAI/Truquitos depend on (via
  // lib/freeToolState.ts). This is what manifested as "No se pudo
  // identificar la sesión Free para guardar esta conversación" and
  // SOURCE_SELECTION_INVALID-adjacent rejection in the real bug.
  // ═══════════════════════════════════════════════════════════════════

  // D: whole-document tool state persists and restores under the
  // whole-document session's own (sessionId, fingerprint) pair.
  const alaiState = { messages: [{ id: 'u1', role: 'user', content: 'Explica esto' }, { id: 'a1', role: 'assistant', content: 'Claro...' }] };
  const written = writeFreeToolState(wholeDocCall.id, wholeDocSource.fingerprint, 'alai', alaiState);
  assert.ok(written, 'ALAI must be able to save its conversation for the whole-document session — this is what failed in the real bug');
  const restored = readFreeToolState(wholeDocCall.id, wholeDocSource.fingerprint, 'alai');
  assert.deepEqual(restored?.state, alaiState);

  // E: the SAME tool state must NOT be readable under the explicit-pages
  // session's identity — whole-document and pages-[1,2] must stay isolated.
  const crossRead = readFreeToolState(pagesSession.id, pagesSource.fingerprint, 'alai');
  assert.equal(crossRead, null, 'explicit-pages session must never see the whole-document session\'s ALAI conversation');

  // F: explicit pages [1,2] is its own valid, independently-writable identity.
  const truquitosState = { cards: [{ id: 't1', text: 'Truco' }] };
  const writtenPages = writeFreeToolState(pagesSession.id, pagesSource.fingerprint, 'truquitos', truquitosState);
  assert.ok(writtenPages, 'explicit pages-[1,2] must remain a valid, writable session identity');
  assert.deepEqual(readFreeToolState(pagesSession.id, pagesSource.fingerprint, 'truquitos')?.state, truquitosState);

  // G: wrong-fingerprint rejection must still hold — this fix must not
  // weaken validOwner() into accepting any selection for the same material.
  const garbageRead = readFreeToolState(wholeDocCall.id, 'not-a-real-fingerprint', 'alai');
  assert.equal(garbageRead, null, 'a bogus fingerprint must still be rejected — source authority must not regress');
  const crossWrite = writeFreeToolState(pagesSession.id, wholeDocSource.fingerprint, 'alai', alaiState);
  assert.equal(crossWrite, null, 'writing with the whole-document fingerprint against the pages-session id must be rejected');

  console.log('free-whole-document-session-identity-contracts: A-G PASS');
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
}
