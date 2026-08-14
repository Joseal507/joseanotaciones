import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
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
  const other = buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [3], 'mat-b': [1, 7] });
  const session = upsertSession({ id: 'free-flashcards-repasar', temaId: 'tema-free-tools', enfoque: 'teorico', processMode: 'free', materialIds: source.materialIds, materialNames: ['A', 'B'], selectedPages: source.selectedPages });

  const cards = [
    { id: 'c1', question: 'AUTHORIZED_ALPHA', answer: 'A', createdAt: 1 },
    { id: 'c2', question: 'AUTHORIZED_BETA', answer: 'B', createdAt: 2 },
  ];
  const flashcards = {
    cards,
    materialText: 'AUTHORIZED_ALPHA\nAUTHORIZED_BETA',
    rightTab: 'flashcards',
    studyMode: 'repite',
    studyOrder: 'lineal',
    favorites: ['c1'],
    deckCurrent: 1,
    deckFlipped: true,
    round: { kind: 'repite', shuffledIds: ['c1', 'c2'], currentId: 'c2', userAnswer: 'draft', evaluation: { nivel: 'correcta' }, revealed: true, done: false, position: 1, userConfidence: 66, history: ['c1'], progress: [] },
    finished: false,
  };
  assert.equal(writeFreeToolState(session.id, source.fingerprint, 'flashcards', flashcards)?.revision, 1);
  assert.deepEqual(readFreeToolState<typeof flashcards>(session.id, source.fingerprint, 'flashcards')?.state, flashcards); // A-D/F/G/J
  assert.equal(readFreeToolState(session.id, other.fingerprint, 'flashcards'), null); // E
  const edited = { ...flashcards, cards: [{ ...cards[0], answer: 'EDITED' }], favorites: [] };
  assert.equal(writeFreeToolState(session.id, source.fingerprint, 'flashcards', edited)?.revision, 2);
  assert.deepEqual(readFreeToolState<typeof edited>(session.id, source.fingerprint, 'flashcards')?.state, edited); // F-H

  const repasar = {
    phase: 'analisis', notes: 'Notas durables', explanation: 'Explicación durable', mode: 'nino',
    analysis: { score: 72, strengths: ['A'], missingConcepts: ['B'], confusions: [], feedback: 'Feedback durable', nextStep: 'Reparar', level: 'solid' },
    attempts: [{ id: 'a1', createdAt: 1, mode: 'nino', explanation: 'Explicación durable', analysis: { score: 72 } }],
    followUpAnswer: 'Reparación durable', teachCheck: { passed: true }, activeRepasarColor: '#abc',
  };
  writeFreeToolState(session.id, source.fingerprint, 'repasar', repasar);
  assert.deepEqual(readFreeToolState<typeof repasar>(session.id, source.fingerprint, 'repasar')?.state, repasar); // K-P/S/T

  const cardsSource = readFileSync('components/materias/ALAIStudyALCards.tsx', 'utf8');
  const repasarSource = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8');
  assert.match(cardsSource, /generationAttemptRef/); // I
  assert.match(cardsSource, /evaluationAttemptRef/); // H
  assert.doesNotMatch(cardsSource, /localStorage\.setItem\('flashcard_favs'/); // E
  assert.match(repasarSource, /analysisAttemptRef/); // Q
  assert.match(repasarSource, /verificationAttemptRef/); // R
  assert.doesNotMatch(repasarSource, /localStorage\.setItem\(storageKey/); // durable authority
  console.log('free-flashcards-repasar-continuity-contracts: A-T PASS');
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(globalThis, { window: originalWindow, localStorage: originalLocalStorage });
}
