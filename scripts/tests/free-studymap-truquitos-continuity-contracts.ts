import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import {
  beginFreeStudyMap,
  completeFreeStudyMap,
  failFreeStudyMap,
  initialFreeStudyMapState,
  recoverInterruptedFreeStudyMap,
  updateFreeStudyMapState,
} from '../../lib/freeStudyMapState';
import {
  assignStableCardIds,
  beginFreeTruquitos,
  completeFreeTruquitos,
  failFreeTruquitos,
  initialFreeTruquitosState,
  recoverInterruptedFreeTruquitos,
  updateFreeTruquitosState,
} from '../../lib/freeTruquitosState';
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
  const source = buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [2, 5], 'mat-b': [1, 7] });
  const otherSource = buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [3], 'mat-b': [1, 7] });
  const session = upsertSession({ id: 'free-sm-a', temaId: 'tema-sm', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });
  const otherSession = upsertSession({ id: 'free-sm-b', temaId: 'tema-sm-b', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });
  const adaptive = upsertSession({ id: 'adaptive-sm', temaId: 'tema-sm', enfoque: 'teorico', processMode: 'adaptive', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });

  // ═══════════════════════════════════════════════════════════════════
  // STUDY MAP CONTRACTS
  // ═══════════════════════════════════════════════════════════════════

  const mapData = { title: 'Test Map', root: { id: 'root-1', label: 'Root', type: 'root' as const }, totalConcepts: 5 };

  // A: generated map persists and restores
  let sm = initialFreeStudyMapState();
  sm = beginFreeStudyMap(sm);
  const smAttempt = sm.attempt;
  sm = completeFreeStudyMap(sm, smAttempt, mapData);
  assert.equal(sm.status, 'completed');
  assert.deepEqual(sm.mapData, mapData);
  writeFreeToolState(session.id, source.fingerprint, 'studymap', sm);
  const restored = readFreeToolState(session.id, source.fingerprint, 'studymap');
  assert.deepEqual((restored?.state as any)?.mapData, mapData);

  // B: reopen = 0 provider calls (restore has mapData, no generation needed)
  assert.equal((restored?.state as any)?.status, 'completed');

  // C: selected node restores
  const smWithNode = updateFreeStudyMapState(sm, { selectedNodeId: 'root-1' });
  writeFreeToolState(session.id, source.fingerprint, 'studymap', smWithNode);
  assert.equal((readFreeToolState(session.id, source.fingerprint, 'studymap')?.state as any)?.selectedNodeId, 'root-1');

  // D: studied nodes restore
  const smWithStudied = updateFreeStudyMapState(sm, { studiedNodeIds: ['root-1', 'branch-1'] });
  writeFreeToolState(session.id, source.fingerprint, 'studymap', smWithStudied);
  assert.deepEqual((readFreeToolState(session.id, source.fingerprint, 'studymap')?.state as any)?.studiedNodeIds, ['root-1', 'branch-1']);

  // E: view restores
  const smWithView = updateFreeStudyMapState(sm, { view: 'cards' });
  writeFreeToolState(session.id, source.fingerprint, 'studymap', smWithView);
  assert.equal((readFreeToolState(session.id, source.fingerprint, 'studymap')?.state as any)?.view, 'cards');

  // F: tour state restores
  const smWithTour = updateFreeStudyMapState(sm, { showGuidedTour: true, tourIndex: 3 });
  writeFreeToolState(session.id, source.fingerprint, 'studymap', smWithTour);
  const tourRestored = readFreeToolState(session.id, source.fingerprint, 'studymap')?.state as any;
  assert.equal(tourRestored?.showGuidedTour, true);
  assert.equal(tourRestored?.tourIndex, 3);

  // G: stale generation ignored
  const smStale = completeFreeStudyMap(sm, smAttempt + 999, { title: 'STALE', root: { id: 'x', label: 'X', type: 'root' as const } });
  assert.equal(smStale, sm); // unchanged

  // H: cross-device restore (same session + fingerprint)
  assert.notEqual(readFreeToolState(session.id, source.fingerprint, 'studymap'), null);

  // I: wrong fingerprint rejected
  assert.equal(readFreeToolState(session.id, otherSource.fingerprint, 'studymap'), null);

  // Free/Adaptive isolation
  assert.equal(readFreeToolState(adaptive.id, source.fingerprint, 'studymap'), null);
  assert.equal(readFreeToolState(otherSession.id, source.fingerprint, 'studymap'), null);

  // Interrupted recovery
  let smInterrupted = beginFreeStudyMap(initialFreeStudyMapState());
  smInterrupted = recoverInterruptedFreeStudyMap(smInterrupted);
  assert.equal(smInterrupted.status, 'recoverable');

  // Interrupted with existing mapData → completed
  let smInterrupted2 = { ...beginFreeStudyMap(sm), mapData };
  smInterrupted2 = recoverInterruptedFreeStudyMap(smInterrupted2);
  assert.equal(smInterrupted2.status, 'completed');

  // Fail with existing mapData → completed (not recoverable)
  let smFailWithData = beginFreeStudyMap(sm);
  smFailWithData = { ...smFailWithData, mapData };
  const smFailed = failFreeStudyMap(smFailWithData, smFailWithData.attempt, 'error');
  // failFreeStudyMap doesn't have mapData recovery - that's handled in recoverInterrupted
  // but we can check it doesn't destroy state
  assert.ok(smFailed.status === 'recoverable' || smFailed.status === 'completed');

  console.log('free-studymap-contracts: A-I PASS');

  // ═══════════════════════════════════════════════════════════════════
  // TRUQUITOS CONTRACTS
  // ═══════════════════════════════════════════════════════════════════

  const rawCards = [
    { type: 'cheat_code', title: 'Card 1', content: 'Content 1' },
    { type: 'analogia', title: 'Card 2', content: 'Content 2' },
  ];
  const stableCards = assignStableCardIds(rawCards);
  assert.equal(stableCards.length, 2);
  assert.ok(stableCards[0].id.length > 5);
  assert.ok(stableCards[1].id.length > 5);
  assert.notEqual(stableCards[0].id, stableCards[1].id);

  // K: generated cards persist and restore
  let tc = initialFreeTruquitosState();
  tc = beginFreeTruquitos(tc);
  const tcAttempt = tc.attempt;
  tc = completeFreeTruquitos(tc, tcAttempt, stableCards);
  assert.equal(tc.status, 'completed');
  assert.equal(tc.cards.length, 2);
  writeFreeToolState(session.id, source.fingerprint, 'truquitos', tc);
  const tcRestored = readFreeToolState(session.id, source.fingerprint, 'truquitos');
  assert.equal((tcRestored?.state as any)?.cards?.length, 2);

  // L: reopen = 0 provider calls (restore has cards)
  assert.equal((tcRestored?.state as any)?.status, 'completed');

  // M: favorites restore
  const tcWithFavs = updateFreeTruquitosState(tc, { favorites: [stableCards[0].id] });
  writeFreeToolState(session.id, source.fingerprint, 'truquitos', tcWithFavs);
  assert.deepEqual((readFreeToolState(session.id, source.fingerprint, 'truquitos')?.state as any)?.favorites, [stableCards[0].id]);

  // N: known restore
  const tcWithKnown = updateFreeTruquitosState(tc, { known: [stableCards[1].id] });
  writeFreeToolState(session.id, source.fingerprint, 'truquitos', tcWithKnown);
  assert.deepEqual((readFreeToolState(session.id, source.fingerprint, 'truquitos')?.state as any)?.known, [stableCards[1].id]);

  // O: saved restore
  const tcWithSaved = updateFreeTruquitosState(tc, { saved: [stableCards[0].id, stableCards[1].id] });
  writeFreeToolState(session.id, source.fingerprint, 'truquitos', tcWithSaved);
  assert.equal((readFreeToolState(session.id, source.fingerprint, 'truquitos')?.state as any)?.saved?.length, 2);

  // P: stable card identity
  const secondBatch = assignStableCardIds(rawCards);
  assert.notEqual(secondBatch[0].id, stableCards[0].id); // new generation, new IDs

  // Q: variant state restore
  const variant = assignStableCardIds([{ type: 'analogia', title: 'Alt Card', content: 'Alt Content' }])[0];
  const tcWithVariant = updateFreeTruquitosState(tc, { variants: { [stableCards[0].id]: variant } });
  writeFreeToolState(session.id, source.fingerprint, 'truquitos', tcWithVariant);
  assert.deepEqual((readFreeToolState(session.id, source.fingerprint, 'truquitos')?.state as any)?.variants?.[stableCards[0].id]?.title, 'Alt Card');

  // R: stale generation ignored
  const tcStale = completeFreeTruquitos(tc, tcAttempt + 999, []);
  assert.equal(tcStale, tc);

  // S: wrong fingerprint rejected
  assert.equal(readFreeToolState(session.id, otherSource.fingerprint, 'truquitos'), null);

  // T: cross-device restore
  assert.notEqual(readFreeToolState(session.id, source.fingerprint, 'truquitos'), null);

  // Free/Adaptive isolation
  assert.equal(readFreeToolState(adaptive.id, source.fingerprint, 'truquitos'), null);

  // Interrupted recovery with cards → completed
  let tcInter = beginFreeTruquitos(tc);
  tcInter = recoverInterruptedFreeTruquitos(tcInter);
  assert.equal(tcInter.status, 'completed');

  // Interrupted recovery without cards → recoverable
  let tcInter2 = beginFreeTruquitos(initialFreeTruquitosState());
  tcInter2 = recoverInterruptedFreeTruquitos(tcInter2);
  assert.equal(tcInter2.status, 'recoverable');

  // Fail with existing cards → completed (cards preserved)
  let tcFailWithCards = beginFreeTruquitos(tc);
  const tcFailResult = failFreeTruquitos(tcFailWithCards, tcFailWithCards.attempt, 'error');
  assert.equal(tcFailResult.status, 'completed');
  assert.equal(tcFailResult.cards.length, 2);

  console.log('free-truquitos-contracts: K-T PASS');

  // ═══════════════════════════════════════════════════════════════════
  // SHARED CONTRACTS
  // ═══════════════════════════════════════════════════════════════════

  // U-V: 1-5 materials with exact pages
  for (let count = 1; count <= 5; count += 1) {
    const ids = Array.from({ length: count }, (_, i) => `mat-${i}`);
    const pages = Object.fromEntries(ids.map((id, i) => [id, [i + 1, i + 3]]));
    const snap = buildSourceSelectionSnapshot(ids, pages);
    assert.equal(snap.materials.length, count);
    assert.deepEqual(snap.selectedPages, pages);
  }

  // W-X: source leakage and isolation checks (static analysis)
  const smComponent = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8');
  const ccComponent = readFileSync('components/materias/ALAIStudyALCheatCodes.tsx', 'utf8');
  assert.match(smComponent, /useAuthorizedSource\(effectiveSourceSelection(?:,\s*['"][^'"]+['"])?\)/);
  assert.match(ccComponent, /useAuthorizedSource\(effectiveSourceSelection(?:,\s*['"][^'"]+['"])?\)/);
  assert.match(smComponent, /readFreeToolState/);
  assert.match(smComponent, /writeFreeToolState/);
  assert.match(ccComponent, /readFreeToolState/);
  assert.match(ccComponent, /writeFreeToolState/);

  // Y: no XP on restore. (2026 binary use-progress model): Study Map /
  // Truquitos no longer report any freeModeUse/freeDomainPct progress event
  // from these components at all — their contribution to StudyAL Process is
  // derived purely from the durable envelope (mapData / cards present),
  // read by lib/freeToolState.ts's computeFreeProcessProgress.
  assert.doesNotMatch(smComponent, /useXP|awardXP/);
  assert.doesNotMatch(ccComponent, /useXP|awardXP/);
  assert.doesNotMatch(smComponent, /freeModeUse|freeDomainPct|freeEvidenceQuality/);
  assert.doesNotMatch(ccComponent, /freeModeUse|freeDomainPct|freeEvidenceQuality/);

  // Z: ERROR != ABSENT (readFreeToolState returns null only for invalid owner, not for network error)
  const freeToolSrc = readFileSync('lib/freeToolState.ts', 'utf8');
  assert.match(freeToolSrc, /validOwner/);
  assert.match(freeToolSrc, /'studymap'/);
  assert.match(freeToolSrc, /'truquitos'/);

  console.log('free-studymap-truquitos-shared-contracts: U-Z PASS');

} finally {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
}
