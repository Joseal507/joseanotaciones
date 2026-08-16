import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import {
  beginAlaiTurn,
  completeAlaiTurn,
  failAlaiTurn,
  initialAlaiState,
  recoverInterruptedAlaiState,
  retryAlaiTurn,
} from '../../lib/freeAlaiState';
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState';
import { upsertSession } from '../../lib/studySessions';

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
  const source = buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [2, 8], 'mat-b': [1, 13] });
  const otherSource = buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [3], 'mat-b': [1, 13] });
  const session = upsertSession({ id: 'free-alai-a', temaId: 'tema-alai', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });
  const otherSession = upsertSession({ id: 'free-alai-b', temaId: 'tema-alai-other', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });
  const adaptive = upsertSession({ id: 'adaptive-alai', temaId: 'tema-alai', enfoque: 'teorico', processMode: 'adaptive', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });

  let state = beginAlaiTurn(initialAlaiState(), { turnId: 'turn-a', userMessageId: 'turn-a:user', content: 'Pregunta A', timestamp: 1 });
  assert.equal(state.messages.filter(message => message.id === 'turn-a:user').length, 1); // C/K
  state = completeAlaiTurn(state, 'turn-a', 1, { id: 'ignored', role: 'assistant', content: 'Respuesta A', timestamp: 2 });
  assert.equal(state.messages.filter(message => message.id === 'turn-a:assistant').length, 1); // C/I
  writeFreeToolState(session.id, source.fingerprint, 'alai', state);
  assert.deepEqual(readFreeToolState(session.id, source.fingerprint, 'alai')?.state, state); // A/D/F
  assert.equal(readFreeToolState(otherSession.id, source.fingerprint, 'alai'), null); // A
  assert.equal(readFreeToolState(session.id, otherSource.fingerprint, 'alai'), null); // B/L
  assert.equal(readFreeToolState(adaptive.id, source.fingerprint, 'alai'), null); // M

  const interrupted = recoverInterruptedAlaiState(beginAlaiTurn(state, { turnId: 'turn-b', userMessageId: 'turn-b:user', content: 'Pregunta B', timestamp: 3 }));
  assert.equal(interrupted.currentTurn?.status, 'recoverable'); // G
  const retry = retryAlaiTurn(interrupted, 'turn-b');
  assert.equal(retry.messages.filter(message => message.id === 'turn-b:user').length, 1); // H
  assert.equal(retry.currentTurn?.attempt, 2);
  const completedRetry = completeAlaiTurn(retry, 'turn-b', 2, { id: 'ignored', role: 'assistant', content: 'Respuesta B', timestamp: 4 });
  const stale = completeAlaiTurn(completedRetry, 'turn-b', 1, { id: 'ignored', role: 'assistant', content: 'STALE', timestamp: 5 });
  assert.deepEqual(stale, completedRetry); // J
  assert.equal(completedRetry.messages.filter(message => message.id === 'turn-b:assistant').length, 1); // I
  const failed = failAlaiTurn(retry, 'turn-b', 2, 'provider failed');
  assert.equal(failed.currentTurn?.status, 'recoverable'); // Q

  for (let count = 1; count <= 5; count += 1) {
    const ids = Array.from({ length: count }, (_, index) => `material-${index + 1}`);
    const pages = Object.fromEntries(ids.map((id, index) => [id, [index + 1, index + 7]]));
    const snapshot = buildSourceSelectionSnapshot(ids, pages);
    assert.equal(snapshot.materials.length, count);
    assert.deepEqual(snapshot.selectedPages, pages); // O/P
  }

  const component = readFileSync('components/materias/ALAIStudyALChat.tsx', 'utf8');
  const page = readFileSync('app/materias/page.tsx', 'utf8');
  const authorizedSource = readFileSync('lib/materials/authorizedSource.ts', 'utf8');
  assert.match(component, /useAuthorizedSource\(effectiveSourceSelection(?:,\s*['"][^'"]+['"])?\)/); // N/O
  assert.match(component, /sourceSelectionFingerprint: effectiveSourceSelection\.fingerprint/);
  assert.doesNotMatch(component, /filtered\s*\|\|\s*fullText|filterTextByPages/); // N
  assert.match(authorizedSource, /AUTHORIZED_SOURCE_MISSING/); // N: fail closed
  assert.match(page, /freeTool === 'alai'/); // U
  assert.match(page, /sourceSelectionFingerprint/); // U
  assert.doesNotMatch(component, /useXP|awardXP/); // T
  // S (2026 binary use-progress model): ALAI no longer reports any
  // freeModeUse/freeDomainPct progress event from this component at all —
  // its contribution to StudyAL Process is derived purely from the durable
  // envelope (a real user question + a real non-welcome answer), read by
  // lib/freeToolState.ts's computeFreeProcessProgress.
  assert.doesNotMatch(component, /freeModeUse|freeDomainPct|freeEvidenceQuality/);
  assert.match(component, /activeAttemptRef/); // J
  assert.match(component, /AbortController/); // G/J
  assert.match(component, /max-width: 100vw/); // V
  assert.match(component, /overflow-x: hidden/); // V
  console.log('free-alai-continuity-contracts: A-V PASS');
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
}
