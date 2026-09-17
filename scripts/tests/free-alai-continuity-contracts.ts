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
import { NextRequest } from 'next/server';
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route';

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
  assert.doesNotMatch(component, /useAuthorizedSource/); // ALAI Chat is Enjoyer-native, never loads raw material text
  // Source identity is no longer asserted by a client-supplied fingerprint field.
  // The 2026 Material Brain + Full Authorized Source Index Chat migration made the
  // SERVER the sole authority: the client sends only `sessionId`, and
  // app/api/alai-studyal-chat/route.ts resolves the authoritative
  // SourceSelectionSnapshot (and therefore the fingerprint) from that sessionId via
  // getAuthoritativeFreeSession. This is strictly stronger than trusting the client.
  // Client-side persistence identity is still fingerprint-scoped (below).
  assert.match(component, /sessionId,/); // route receives session identity
  assert.doesNotMatch(component, /sourceSelectionFingerprint\s*:/); // never client-asserted
  assert.doesNotMatch(component, /materialText\s*,\s*$/m); // raw source authority never posted
  assert.match(component, /writeFreeToolState\(sessionId, effectiveSourceSelection\.fingerprint, 'alai'/);
  assert.match(component, /readFreeToolState<DurableAlaiState>\(\s*\n\s*sessionId,\s*\n\s*effectiveSourceSelection\.fingerprint,/);
  const chatRoute = readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8');
  assert.match(chatRoute, /RAW_SOURCE_AUTHORITY_FORBIDDEN/); // mirrors Repasar's pattern
  assert.match(chatRoute, /getAuthoritativeFreeSession\(sessionId, userId\)/);
  assert.match(chatRoute, /sourceSelection\.fingerprint/); // fingerprint is always server-derived from the authoritative session, never client-supplied
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
  // ============================================================
  // CHAT-CONTINUITY — runtime source-identity contracts for the
  // StudyalMaterialEnjoyer-grounded Chat path. These replace the old
  // "client asserts sourceSelectionFingerprint" contract with proof of
  // the real, server-authoritative mechanism.
  // ============================================================

  const PAGES_A = [1, 2, 3, 4, 5];
  const PAGES_B = [11, 12, 13, 14];
  const selectionA = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': PAGES_A });
  const selectionB = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': PAGES_B });
  assert.notEqual(selectionA.fingerprint, selectionB.fingerprint);

  function enjoyerFor(fingerprint: string, materialIds: string[], selectedPages: Record<string, number[]>, targetId: string, page: number) {
    return {
      sourceSelectionFingerprint: fingerprint, materialIds, selectedPages,
      topicsIndex: [{ id: 't1', title: 'Equilibrio químico' }],
      globalOrderedAnalysis: [{
        id: targetId, kind: 'definition', name: 'Constante de equilibrio',
        content: `Contenido exclusivo de la pagina ${page} sobre equilibrio quimico, constante y presion parcial.`,
        importance: 60, difficulty: 'medium', topicId: 't1', materialId: 'mat-a', pages: [page],
        sourceSpans: [{ page, quote: 'equilibrio quimico' }],
      }],
      uniqueConceptsIndex: [], relations: [],
    };
  }

  /** Provider that cites exactly the ids retrieval actually offered in the prompt. */
  function honestProvider(prompt: string) {
    return {
      answer: 'Respuesta grounded.',
      usedTargetIds: [...prompt.matchAll(/\[ENJOYER_TARGET (chat_target:\S+)\]/g)].map(m => m[1]),
      usedRelationIds: [...prompt.matchAll(/\[ENJOYER_RELATION (\S+)\]/g)].map(m => m[1]),
      externalKnowledgeUsed: false,
      suggestedFollowups: [],
    };
  }

  let lastPrompt = '';
  let providerFn: (prompt: string) => any = honestProvider;
  let activePages: number[] = PAGES_A;
  let activeFingerprint = selectionA.fingerprint;
  let activeEnjoyer: any = enjoyerFor(selectionA.fingerprint, ['mat-a'], { 'mat-a': PAGES_A }, 'unit:a', 3);

  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async (sessionId: string, userId: string) => {
      if (sessionId !== 'sess-chat' || userId !== 'user-1') return null;
      // Authoritative selection comes from the SERVER, never from the request body.
      return { id: sessionId, userId, processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': activePages }), fingerprint: activeFingerprint } } as any;
    },
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Quimica.pdf', kind: 'pdf' }) as any,
    lookupStudyalMaterialEnjoyer: async (fingerprint: string) => (fingerprint === activeFingerprint ? activeEnjoyer : null),
    materialEnjoyerStore: {} as any,
    generateValidatedLegacyJson: async ({ prompt }: any) => { lastPrompt = prompt; return providerFn(prompt); },
  });

  async function chat(message: string, previousGrounding: any = null, extra: Record<string, unknown> = {}) {
    const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-chat', message, previousGrounding, ...extra }),
    });
    const res = await POST(req);
    return { res, data: await res.json() };
  }

  function useSelection(pages: number[], fingerprint: string, targetId: string, targetPage: number) {
    activePages = pages;
    activeFingerprint = fingerprint;
    activeEnjoyer = enjoyerFor(fingerprint, ['mat-a'], { 'mat-a': pages }, targetId, targetPage);
  }

  // ── CHAT-CONTINUITY same fingerprint ─────────────────────────
  // Same session + same source fingerprint: the durable conversation
  // resumes, and the grounded route answers from the authorized pages.
  useSelection(PAGES_A, selectionA.fingerprint, 'unit:a', 3);
  const chatSession = upsertSession({ id: 'sess-chat', temaId: 'tema-chat', enfoque: 'teorico', processMode: 'free', materialIds: selectionA.materialIds, materialNames: ['A'], selectedPages: selectionA.selectedPages });
  let chatState = beginAlaiTurn(initialAlaiState(), { turnId: 't1', userMessageId: 't1:user', content: '¿Qué es la constante de equilibrio?', timestamp: 1 });
  const first = await chat('¿Qué es la constante de equilibrio?');
  assert.equal(first.res.status, 200);
  assert.equal(first.data.success, true);
  assert.ok(first.data.sourcePages.length > 0, 'grounding must be non-empty (non-vacuous contract)');
  assert.ok(first.data.sourcePages.every((page: number) => PAGES_A.includes(page)), 'grounding must stay inside the authorized pages');
  chatState = completeAlaiTurn(chatState, 't1', 1, {
    id: 'ignored', role: 'assistant', content: first.data.answer, timestamp: 2,
    mode: first.data.mode, usedTargetIds: first.data.usedTargetIds, usedRelationIds: first.data.usedRelationIds,
    materialIds: first.data.materialIds, sourcePages: first.data.sourcePages,
  });
  writeFreeToolState(chatSession.id, selectionA.fingerprint, 'alai', chatState);
  assert.deepEqual(readFreeToolState(chatSession.id, selectionA.fingerprint, 'alai')?.state, chatState);
  console.log('CHAT-CONTINUITY same fingerprint: PASS');

  // ── CHAT-CONTINUITY changed fingerprint ──────────────────────
  // A different source fingerprint must NOT restore the old conversation,
  // and the route's grounding must not leak the previous selection's pages.
  assert.equal(readFreeToolState(chatSession.id, selectionB.fingerprint, 'alai'), null);
  useSelection(PAGES_B, selectionB.fingerprint, 'unit:b', 13);
  const afterSwitch = await chat('¿Qué es la constante de equilibrio?');
  assert.equal(afterSwitch.res.status, 200);
  assert.ok(afterSwitch.data.sourcePages.length > 0, 'grounding must be non-empty (non-vacuous contract)');
  assert.ok(afterSwitch.data.sourcePages.every((page: number) => PAGES_B.includes(page)), 'no page from fingerprint A may appear under fingerprint B');
  assert.doesNotMatch(lastPrompt, /pagina 3 sobre equilibrio/i);
  assert.equal(readFreeToolState(chatSession.id, selectionB.fingerprint, 'alai'), null);
  console.log('CHAT-CONTINUITY changed fingerprint: PASS');

  // ── CHAT-CONTINUITY changed pages ────────────────────────────
  // SAME sessionId, changed selected pages → new fingerprint → the old
  // chat state must not leak, and the server re-resolves authority itself.
  const selectionAplus = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [...PAGES_A, 9] });
  assert.notEqual(selectionAplus.fingerprint, selectionA.fingerprint);
  assert.equal(readFreeToolState(chatSession.id, selectionAplus.fingerprint, 'alai'), null);
  useSelection([...PAGES_A, 9], selectionAplus.fingerprint, 'unit:a9', 9);
  const widened = await chat('¿Qué dice la pagina 9?');
  assert.equal(widened.res.status, 200);
  assert.ok(widened.data.sourcePages.length > 0, 'grounding must be non-empty (non-vacuous contract)');
  assert.ok(widened.data.sourcePages.every((page: number) => [...PAGES_A, 9].includes(page)));
  // Old fingerprint's durable state is still intact and still scoped to it.
  assert.deepEqual(readFreeToolState(chatSession.id, selectionA.fingerprint, 'alai')?.state, chatState);
  console.log('CHAT-CONTINUITY changed pages: PASS');

  // ── CHAT-CONTINUITY forged previousGrounding ─────────────────
  // previousGrounding is a CLIENT-supplied continuity hint, never an
  // authority: ids are only resolvable inside the server-resolved
  // fingerprint's brain/source index, and any id the provider echoes that
  // retrieval did not actually offer is dropped server-side.
  useSelection(PAGES_A, selectionA.fingerprint, 'unit:a', 3);
  const forged = {
    mode: 'MATERIAL_ONLY',
    usedTargetIds: ['chat_target:unit:b', 'chat_target:from-another-fingerprint'],
    usedRelationIds: ['relation:forged'],
    materialIds: ['mat-zzz'],
    pages: [13],
  };
  providerFn = (prompt: string) => ({
    ...honestProvider(prompt),
    // Adversarial: echo the forged ids back as if they had been used.
    usedTargetIds: [...honestProvider(prompt).usedTargetIds, ...forged.usedTargetIds],
    usedRelationIds: forged.usedRelationIds,
  });
  const forgedFollowup = await chat('¿y por qué?', forged);
  assert.equal(forgedFollowup.res.status, 200);
  for (const id of forged.usedTargetIds) assert.ok(!forgedFollowup.data.usedTargetIds.includes(id), `forged target id leaked: ${id}`);
  for (const id of forged.usedRelationIds) assert.ok(!forgedFollowup.data.usedRelationIds.includes(id));
  assert.ok(!forgedFollowup.data.materialIds.includes('mat-zzz'));
  assert.ok(forgedFollowup.data.sourcePages.every((page: number) => PAGES_A.includes(page)), 'forged pages must not enter the answer');
  // Nothing of fingerprint B survived: an entirely forged hint grounds nothing,
  // so the answer is honestly reported as GENERAL_ONLY rather than fake-material.
  assert.equal(forgedFollowup.data.mode, 'GENERAL_ONLY');
  assert.equal(forgedFollowup.data.inMaterial, false);
  assert.equal(forgedFollowup.data.confidence, 'baja');
  providerFn = honestProvider;

  // Non-vacuity counterpart: a LEGITIMATE previousGrounding (ids that really
  // belong to the server-resolved fingerprint) DOES carry the follow-up
  // forward. Same code path, same short query — only the ids' provenance
  // differs, which is exactly the property under test.
  const genuine = {
    mode: first.data.mode,
    usedTargetIds: first.data.usedTargetIds,
    usedRelationIds: first.data.usedRelationIds,
    materialIds: first.data.materialIds,
    pages: first.data.sourcePages,
  };
  assert.ok(genuine.usedTargetIds.length > 0, 'fixture must produce real grounding to carry forward');
  const genuineFollowup = await chat('¿y por qué?', genuine);
  assert.equal(genuineFollowup.res.status, 200);
  assert.ok(genuineFollowup.data.usedTargetIds.some((id: string) => genuine.usedTargetIds.includes(id)),
    'genuine prior-turn grounding must carry forward into the follow-up');
  assert.ok(genuineFollowup.data.sourcePages.every((page: number) => PAGES_A.includes(page)));
  console.log('CHAT-CONTINUITY forged previousGrounding: PASS');

  // Raw source authority can never be smuggled back in alongside sessionId.
  const smuggled = await chat('¿Qué es Kc?', null, { materialText: 'TEXTO NO AUTORIZADO' });
  assert.equal(smuggled.res.status, 400);
  assert.equal(smuggled.data.internalCode, 'RAW_SOURCE_AUTHORITY_FORBIDDEN');
  assert.doesNotMatch(smuggled.data.detail, /RAW_SOURCE|FORBIDDEN/);

  // ── CHAT-CONTINUITY legacy state ─────────────────────────────
  // Conversations persisted before the grounding fields existed restore
  // intact, contribute no grounding hint, and never bypass source identity.
  const legacyState = {
    messages: [
      { id: 'alai-welcome-v1', role: 'assistant' as const, content: 'Bienvenida', timestamp: 0 },
      { id: 'legacy:user', role: 'user' as const, content: 'Pregunta vieja', timestamp: 1 },
      { id: 'legacy:assistant', role: 'assistant' as const, content: 'Respuesta vieja', sourcePages: [3], timestamp: 2 },
    ],
    currentTurn: null,
    draft: '',
  };
  writeFreeToolState(chatSession.id, selectionA.fingerprint, 'alai', legacyState);
  const restoredLegacy = readFreeToolState<typeof legacyState>(chatSession.id, selectionA.fingerprint, 'alai');
  assert.deepEqual(restoredLegacy?.state, legacyState);
  // Legacy messages carry no usedTargetIds → no previousGrounding.
  const legacyGroundedTurn = [...legacyState.messages].reverse()
    .find(message => message.role === 'assistant' && (message as any).usedTargetIds?.length);
  assert.equal(legacyGroundedTurn, undefined);
  // And it is still scoped: a different fingerprint cannot read it.
  assert.equal(readFreeToolState(chatSession.id, selectionB.fingerprint, 'alai'), null);
  const legacyTurn = await chat('¿Qué es la constante?', null);
  assert.equal(legacyTurn.res.status, 200);
  assert.ok(legacyTurn.data.sourcePages.length > 0, 'grounding must be non-empty (non-vacuous contract)');
  assert.ok(legacyTurn.data.sourcePages.every((page: number) => PAGES_A.includes(page)));
  console.log('CHAT-CONTINUITY legacy state: PASS');

  // ── CHAT-CONTINUITY refresh/resume ───────────────────────────
  // A turn interrupted by a refresh is restored as recoverable (never lost,
  // never silently regenerated) under the SAME session+fingerprint identity.
  const sending = beginAlaiTurn(chatState, { turnId: 't2', userMessageId: 't2:user', content: 'Pregunta interrumpida', timestamp: 5 });
  writeFreeToolState(chatSession.id, selectionA.fingerprint, 'alai', sending);
  const afterRefresh = readFreeToolState<typeof sending>(chatSession.id, selectionA.fingerprint, 'alai');
  assert.ok(afterRefresh);
  const recovered = recoverInterruptedAlaiState(afterRefresh.state);
  assert.equal(recovered.currentTurn?.status, 'recoverable');
  assert.equal(recovered.messages.filter(message => message.id === 't2:user').length, 1);
  const resumed = completeAlaiTurn(retryAlaiTurn(recovered, 't2'), 't2', 2, { id: 'ignored', role: 'assistant', content: 'Respuesta tras refresh', timestamp: 6 });
  assert.equal(resumed.currentTurn?.status, 'completed');
  writeFreeToolState(chatSession.id, selectionA.fingerprint, 'alai', resumed);
  assert.deepEqual(readFreeToolState(chatSession.id, selectionA.fingerprint, 'alai')?.state, resumed);
  assert.equal(readFreeToolState(chatSession.id, selectionB.fingerprint, 'alai'), null);
  console.log('CHAT-CONTINUITY refresh/resume: PASS');

  console.log('free-alai-continuity-contracts: A-V PASS');
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
  });
