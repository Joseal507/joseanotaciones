import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { upsertSession, getSessionById } from '../../lib/studySessions';
import {
  computeFreeProcessProgress,
  writeFreeToolState,
  FREE_PROCESS_TOOL_CAPS,
  type DurableFreeTool,
} from '../../lib/freeToolState';

// ═══════════════════════════════════════════════════════════════════
// FREE MODE — canonical "Volver al proceso" navigation contract, and the
// binary use-progress model (2026 simplification): the Free percentage
// means ONLY "¿qué parte del ecosistema Free ya utilizó el estudiante?" —
// NOT mastery, NOT score, NOT completion. A tool contributes its FULL
// canonical cap the first time it is used successfully, idempotently,
// scoped to the exact (sessionId, sourceSelectionFingerprint) pair — the
// SAME durable FreeToolStateEnvelope authority used for continuity
// restore. There is no partial credit, no separate quality axis, and no
// "Dominio estimado" — deliberately simple and leak-free by construction.
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

const ALL_TOOLS: DurableFreeTool[] = ['repasar', 'analysis', 'studymap', 'truquitos', 'flashcards', 'quiz', 'exam', 'alai'];

// Minimal, per-tool "meaningfully used" state, matching lib/freeToolState.ts's
// isToolEnvelopeMeaningfullyUsed predicate exactly.
const MEANINGFUL_STATE: Record<DurableFreeTool, unknown> = {
  flashcards: { cards: [{ id: 'c1', front: 'Q', back: 'A' }] },
  quiz: { questions: [{ id: 'q1', prompt: 'P' }] },
  exam: { exam: { id: 'e1', questions: [{ id: 'q1' }] } },
  repasar: { phase: 'lectura' },
  studymap: { mapData: { title: 'Map', root: { id: 'root-1', label: 'Root', type: 'root' }, totalConcepts: 3 } },
  truquitos: { cards: [{ id: 't1', text: 'Truco' }] },
  analysis: { resultsByType: { resumen: { status: 'completed', content: '...' } } },
  alai: { messages: [{ id: 'u1', role: 'user', content: 'Explica esto' }, { id: 'a1', role: 'assistant', content: 'Claro...' }] },
};

// Not-yet-meaningful counterpart per tool: envelope exists (tool was
// "opened"/attempted) but generation never actually succeeded.
const NOT_MEANINGFUL_STATE: Record<DurableFreeTool, unknown> = {
  flashcards: { cards: [] },
  quiz: { questions: [] },
  exam: {},
  repasar: { phase: 'preview' },
  studymap: {},
  truquitos: { cards: [] },
  analysis: { resultsByType: {} },
  alai: { messages: [{ id: 'alai-welcome-v1', role: 'assistant', content: 'Hola, pregúntame algo.' }] },
};

try {
  // ── Navigation: all 8 Free tools expose "Volver al proceso" ──
  const TOOL_FILES: Record<DurableFreeTool, string> = {
    repasar: 'components/materias/ALAIStudyALRepasar.tsx',
    analysis: 'components/materias/AnalisisTeorico.tsx',
    studymap: 'components/materias/ALAIStudyMap.tsx',
    truquitos: 'components/materias/ALAIStudyALCheatCodes.tsx',
    flashcards: 'components/materias/ALAIStudyALCards.tsx',
    quiz: 'components/materias/ALAIStudyALQuizzes.tsx',
    exam: 'components/materias/ALAIStudyALExams.tsx',
    alai: 'components/materias/ALAIStudyALChat.tsx',
  };
  for (const [tool, path] of Object.entries(TOOL_FILES)) {
    const src = readFileSync(path, 'utf8');
    assert.match(src, /[Vv]olver al proceso/, `${tool} (${path}) must expose "Volver al proceso"`);
  }
  assert.equal(Object.keys(TOOL_FILES).length, 8);

  // ── ONE canonical navigation authority in page.tsx, used by all 6
  // top-level tools (studymap/truquitos live inside TemaView and never
  // unmount it, so they don't go through this function). ──
  const page = readFileSync('app/materias/page.tsx', 'utf8');
  assert.match(page, /function returnToFreeProcess\(/);
  for (const tool of ['flashcards', 'quiz', 'repasar', 'analisis', 'alai', 'examen']) {
    assert.match(page, new RegExp(`returnToFreeProcess\\('${tool}'`), `page.tsx must route ${tool}'s return through returnToFreeProcess`);
  }
  assert.doesNotMatch(page, /ALAIStudyALCards:onBack:user-clicked-back/);

  // ── Atomic Tool → Process transition: TemaView seeds openFree (and the
  // session/materials StudyAL Process needs) SYNCHRONOUSLY from
  // freeReturnSeed (in-app "Volver al proceso") OR from a URL marker
  // (real browser refresh while the hub is open — P0 fix) via lazy
  // useState initializers, never a post-mount effect — its own mind-map
  // view is never painted in between, in EITHER case. ──
  const temaView = readFileSync('components/materias/TemaView.tsx', 'utf8');
  assert.match(temaView, /useState\(\(\) => !!freeReturnSeed \|\| !!readFreeHubResumeSessionIdFromURL\(tema\?\.id\)\)/);
  assert.match(temaView, /freeReturnSeed \|\| readFreeHubResumeSessionIdFromURL\(tema\?\.id\) \? getSessionsByTema\(tema\?\.id \|\| ''\) : \[\]/);
  assert.match(temaView, /freeReturnSeed \? \(freeReturnSeed\.sessionId \|\| null\) : readFreeHubResumeSessionIdFromURL\(tema\?\.id\)/);
  // The reconstructedMasteryState hook that once caused the Study
  // Map/Truquitos hook-order crash must be declared before ALL early
  // returns (showCoach/showStudyMap/showCheatCodes), never after.
  const showCoachIdx = temaView.indexOf('if (showCoach)\n    return (');
  const reconstructedIdx = temaView.indexOf('const reconstructedMasteryState = useMemo');
  assert.ok(showCoachIdx > 0 && reconstructedIdx > 0 && reconstructedIdx < showCoachIdx,
    'reconstructedMasteryState must be declared before the showCoach/showStudyMap/showCheatCodes early-return chain');

  // ── A: no tool's dead progressive-percentage code paths remain in any
  // of the 8 components (Mission 4: eliminate generated/partial/completed
  // fractional reporting entirely). ──
  for (const [, path] of Object.entries(TOOL_FILES)) {
    const src = readFileSync(path, 'utf8');
    assert.doesNotMatch(src, /freeModeUse/, `${path} must not reference the removed freeModeUse progress event`);
    assert.doesNotMatch(src, /freeDomainPct/, `${path} must not reference the removed freeDomainPct progress event`);
    assert.doesNotMatch(src, /freeEvidenceQuality/, `${path} must not reference the removed freeEvidenceQuality axis`);
  }

  // ── B: all 8 tool caps sum EXACTLY 100 ──
  const capSum = ALL_TOOLS.reduce((sum, t) => sum + FREE_PROCESS_TOOL_CAPS[t], 0);
  assert.equal(capSum, 100, 'FREE_PROCESS_TOOL_CAPS must sum to exactly 100');
  assert.deepEqual(FREE_PROCESS_TOOL_CAPS, {
    alai: 5, studymap: 7, truquitos: 8, analysis: 10,
    repasar: 15, quiz: 16, flashcards: 18, exam: 21,
  });

  const source = buildSourceSelectionSnapshot(['mat-canon'], { 'mat-canon': [1, 2, 3] });
  const otherPagesSource = buildSourceSelectionSnapshot(['mat-canon'], { 'mat-canon': [1, 2, 3, 4, 5] });

  const session = upsertSession({
    id: 'free-canon-progress', temaId: 'tema-canon', enfoque: 'teorico', processMode: 'free',
    materialIds: source.materialIds, materialNames: ['Canon Material'], selectedPages: source.selectedPages,
  });

  // ── C: no tool ever used at all → 0% process progress, every tool false. ──
  const snapEmpty = computeFreeProcessProgress(getSessionById(session.id));
  assert.equal(snapEmpty.totalPercent, 0, 'no tool used yet must read exactly 0%');
  for (const tool of ALL_TOOLS) assert.equal(snapEmpty.byTool[tool], false, `${tool} must read unused before any envelope exists`);

  // ── D: an envelope existing but NOT meaningfully used (tool opened /
  // attempted, generation never actually succeeded) must NOT count. ──
  for (const tool of ALL_TOOLS) {
    writeFreeToolState(session.id, source.fingerprint, tool, NOT_MEANINGFUL_STATE[tool]);
  }
  const snapNotMeaningful = computeFreeProcessProgress(getSessionById(session.id));
  assert.equal(snapNotMeaningful.totalPercent, 0, 'merely opening/attempting tools (no successful generation) must still read 0%');

  // ── E: ALAI specifically — the welcome message alone (opening the chat,
  // no real question sent) must NOT count. ──
  assert.equal(snapNotMeaningful.byTool.alai, false, 'opening ALAI without sending a real question must not count');

  // ── F-M: each tool, the FIRST time it is meaningfully used, immediately
  // grants its FULL canonical cap — no waiting for study/completion/score. ──
  let runningTotal = 0;
  for (const tool of ALL_TOOLS) {
    writeFreeToolState(session.id, source.fingerprint, tool, MEANINGFUL_STATE[tool]);
    runningTotal += FREE_PROCESS_TOOL_CAPS[tool];
    const snap = computeFreeProcessProgress(getSessionById(session.id));
    assert.equal(snap.byTool[tool], true, `${tool} must read used immediately after first successful generation`);
    assert.equal(snap.totalPercent, runningTotal, `after ${tool}, total must equal the running sum of caps used so far (got ${snap.totalPercent}, expected ${runningTotal})`);
  }

  // ── N: all 8 tools used → total reaches EXACTLY 100, never more. ──
  const snapAll = computeFreeProcessProgress(getSessionById(session.id));
  assert.equal(snapAll.totalPercent, 100, 'all 8 tools used must sum to exactly 100%');

  // ── O: absolute idempotency — regenerating the SAME tool many times
  // (revision bumps) must NEVER double-count (never 18→36→54). ──
  for (let i = 0; i < 10; i++) {
    writeFreeToolState(session.id, source.fingerprint, 'flashcards', MEANINGFUL_STATE.flashcards);
  }
  const snapAfterRepeats = computeFreeProcessProgress(getSessionById(session.id));
  assert.equal(snapAfterRepeats.totalPercent, 100, 'regenerating an already-used tool 10 times must not inflate the total past 100');
  assert.equal(snapAfterRepeats.byTool.flashcards, true);

  // ── P: source-selection isolation — a DIFFERENT sourceSelectionFingerprint
  // (e.g. Material A pages 1-2 vs pages 1-5) must never inherit or leak
  // progress from another selection, even for the same material. ──
  const otherSession = upsertSession({
    id: 'free-canon-progress-other-pages', temaId: 'tema-canon', enfoque: 'teorico', processMode: 'free',
    materialIds: otherPagesSource.materialIds, materialNames: ['Canon Material'], selectedPages: otherPagesSource.selectedPages,
  });
  const snapOtherPages = computeFreeProcessProgress(getSessionById(otherSession.id));
  assert.equal(snapOtherPages.totalPercent, 0, 'a different page selection of the same material must start at 0%, never inherit the other selection\'s progress');

  // ── Q: session identity isolation — an envelope belonging to a
  // DIFFERENT sessionId must never be read into this session's progress. ──
  writeFreeToolState(otherSession.id, otherPagesSource.fingerprint, 'quiz', MEANINGFUL_STATE.quiz);
  const snapCanonAfterOther = computeFreeProcessProgress(getSessionById(session.id));
  assert.equal(snapCanonAfterOther.totalPercent, 100, 'writing progress into a different session must not affect this session\'s total');
  const snapOtherAfterOwnQuiz = computeFreeProcessProgress(getSessionById(otherSession.id));
  assert.equal(snapOtherAfterOwnQuiz.totalPercent, FREE_PROCESS_TOOL_CAPS.quiz, 'the other session must independently earn only its own quiz cap');

  // ── R: deterministic restore — recomputing from the same durable state
  // (fresh getSessionById, no mutation) must always return the identical
  // result; refresh/reopen must never drift the percentage. ──
  const reloaded1 = computeFreeProcessProgress(getSessionById(session.id));
  const reloaded2 = computeFreeProcessProgress(getSessionById(session.id));
  assert.deepEqual(reloaded1, reloaded2, 'recomputing from the same durable state must be perfectly deterministic');

  console.log('free-process-canonical-nav-progress-contracts: PASS (nav + binary use-progress model)');
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
}
