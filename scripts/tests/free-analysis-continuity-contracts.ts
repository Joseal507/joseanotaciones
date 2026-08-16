import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import {
  beginFreeAnalysis,
  completeFreeAnalysis,
  failFreeAnalysis,
  initialFreeAnalysisState,
  recoverInterruptedFreeAnalysis,
  updateFreeAnalysisEntry,
} from '../../lib/freeAnalysisState';
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
  const session = upsertSession({ id: 'free-analysis-a', temaId: 'tema-analysis', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });
  const otherSession = upsertSession({ id: 'free-analysis-b', temaId: 'tema-analysis-other', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });
  const adaptive = upsertSession({ id: 'adaptive-analysis', temaId: 'tema-analysis', enfoque: 'teorico', processMode: 'adaptive', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });

  let state = initialFreeAnalysisState<{ titulo: string }>('universidad');
  state = beginFreeAnalysis(state, 'universidad');
  const sameGeneration = beginFreeAnalysis(state, 'universidad');
  assert.equal(sameGeneration, state); // J
  const firstAttempt = state.resultsByType.universidad?.attempt || 0;
  state = completeFreeAnalysis(state, 'universidad', firstAttempt, { titulo: 'Resultado A' });
  state = updateFreeAnalysisEntry(state, 'universidad', { activeSection: 'clase', readSections: ['mapa', 'clase'], completed: true });
  writeFreeToolState(session.id, source.fingerprint, 'analysis', state);
  assert.deepEqual(readFreeToolState(session.id, source.fingerprint, 'analysis')?.state, state); // A/D/E/F/G
  assert.equal(readFreeToolState(otherSession.id, source.fingerprint, 'analysis'), null); // A
  assert.equal(readFreeToolState(session.id, otherSource.fingerprint, 'analysis'), null); // B/L
  assert.equal(readFreeToolState(adaptive.id, source.fingerprint, 'analysis'), null); // M

  let withSecondType = beginFreeAnalysis(state, 'medicina');
  const secondAttempt = withSecondType.resultsByType.medicina?.attempt || 0;
  withSecondType = completeFreeAnalysis(withSecondType, 'medicina', secondAttempt, { titulo: 'Resultado B' });
  assert.equal(withSecondType.resultsByType.universidad?.result?.titulo, 'Resultado A');
  assert.equal(withSecondType.resultsByType.medicina?.result?.titulo, 'Resultado B'); // C

  const interrupted = recoverInterruptedFreeAnalysis(beginFreeAnalysis(withSecondType, 'doctorado'));
  assert.equal(interrupted.resultsByType.doctorado?.status, 'recoverable'); // H
  const retry = beginFreeAnalysis(interrupted, 'doctorado');
  const retryAttempt = retry.resultsByType.doctorado?.attempt || 0;
  assert.equal(retryAttempt, 2); // I
  const completedRetry = completeFreeAnalysis(retry, 'doctorado', retryAttempt, { titulo: 'Resultado retry' });
  const stale = completeFreeAnalysis(completedRetry, 'doctorado', 1, { titulo: 'STALE' });
  assert.equal(stale, completedRetry); // K
  const failed = failFreeAnalysis(beginFreeAnalysis(completedRetry, 'secundaria'), 'secundaria', 1, 'provider failed');
  assert.equal(failed.resultsByType.secundaria?.status, 'recoverable'); // Q

  for (let count = 1; count <= 5; count += 1) {
    const ids = Array.from({ length: count }, (_, index) => `material-${index + 1}`);
    const pages = Object.fromEntries(ids.map((id, index) => [id, [index + 1, index + 7]]));
    const snapshot = buildSourceSelectionSnapshot(ids, pages);
    assert.equal(snapshot.materials.length, count);
    assert.deepEqual(snapshot.selectedPages, pages); // N/O/P
  }

  const component = readFileSync('components/materias/AnalisisTeorico.tsx', 'utf8');
  const page = readFileSync('app/materias/page.tsx', 'utf8');
  const authorizedSource = readFileSync('lib/materials/authorizedSource.ts', 'utf8');
  assert.match(component, /useAuthorizedSource\(effectiveSourceSelection(?:,\s*['"][^'"]+['"])?\)/); // N/O/P
  assert.match(component, /readFreeToolState<DurableFreeAnalysisState<Analisis>>/); // D/G
  assert.match(component, /AbortController/); // H/K
  assert.match(component, /generationLockedRef/); // J
  assert.doesNotMatch(component, /filtered\s*\|\|\s*fullText|filterTextByPages|localStorage/); // P/legacy isolation
  assert.match(authorizedSource, /AUTHORIZED_SOURCE_MISSING/); // P fail closed
  assert.match(page, /freeTool === 'analisis'/); // exact URL restore
  assert.match(page, /lookupSessionByIdFromServer\(freeSessionId, targetTemaId\)/); // Q: typed durable lookup
  assert.match(page, /lookup\.status !== 'FOUND'/); // Q: ERROR is never treated as ABSENT
  assert.doesNotMatch(component, /useXP|awardXP/); // S
  // R (2026 binary use-progress model): Análisis no longer reports any
  // freeModeUse/freeDomainPct progress event from this component at all —
  // its contribution to StudyAL Process is derived purely from the durable
  // envelope (a completed result in resultsByType), read by
  // lib/freeToolState.ts's computeFreeProcessProgress.
  assert.doesNotMatch(component, /freeModeUse|freeDomainPct|freeEvidenceQuality/);
  assert.match(component, /overflow-x: hidden/); // T
  console.log('free-analysis-continuity-contracts: A-T PASS');
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
}
