import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState';
import { getSessionById, upsertSession } from '../../lib/studySessions';

const memory = new Map<string, string>();
const originalWindow = (globalThis as any).window;
const originalLocalStorage = (globalThis as any).localStorage;
const originalFetch = globalThis.fetch;

;(globalThis as any).window = {};
;(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) || null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
};
globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch;

try {
  const sourceA = buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [2, 5], 'mat-b': [1, 7] });
  const sourceB = buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [3], 'mat-b': [1, 7] });
  const free = upsertSession({ id: 'free-continuity-session', temaId: 'tema-free', enfoque: 'teorico', processMode: 'free', materialIds: sourceA.materialIds, materialNames: ['A', 'B'], selectedPages: sourceA.selectedPages });
  const adaptive = upsertSession({ id: 'adaptive-continuity-session', temaId: 'tema-free', enfoque: 'teorico', processMode: 'adaptive', materialIds: sourceA.materialIds, materialNames: ['A', 'B'], selectedPages: sourceA.selectedPages });

  const quiz = {
    quizState: 'quiz', config: { count: 2, difficulty: 'medium' },
    questions: [{ id: 'q1', question: 'AUTHORIZED_ALPHA', options: ['A', 'B'] }],
    currentIndex: 0, userAnswer: 'A', isLocked: true,
    history: [{ questionIndex: 0, correct: true, feedback: 'Grounded feedback' }],
    score: 1, finished: false,
  };
  assert.equal(writeFreeToolState(free.id, sourceA.fingerprint, 'quiz', quiz)?.revision, 1);
  assert.deepEqual(readFreeToolState<typeof quiz>(free.id, sourceA.fingerprint, 'quiz')?.state, quiz); // A-C/E
  assert.equal(readFreeToolState(free.id, sourceB.fingerprint, 'quiz'), null); // F
  assert.equal(readFreeToolState(adaptive.id, sourceA.fingerprint, 'quiz'), null); // mode isolation

  const finishedQuiz = { ...quiz, quizState: 'results', currentIndex: 1, finished: true, finalResult: { score: 1 } };
  assert.equal(writeFreeToolState(free.id, sourceA.fingerprint, 'quiz', finishedQuiz)?.revision, 2);
  assert.deepEqual(readFreeToolState<typeof finishedQuiz>(free.id, sourceA.fingerprint, 'quiz')?.state, finishedQuiz); // D/G-J

  const exam = {
    phase: 'exam', setup: { duration: 30 }, exam: { id: 'exam-1', questions: [{ id: 'e1' }] },
    currentQuestion: 0, answers: ['answer'], draftAnswer: 'new draft', confidences: ['high'],
    draftConfidence: 'high', marked: [0], deadlineAt: Date.now() + 60_000,
    questionTimes: [12], submissionError: '', evaluation: null,
  };
  writeFreeToolState(free.id, sourceA.fingerprint, 'exam', exam);
  assert.deepEqual(readFreeToolState<typeof exam>(free.id, sourceA.fingerprint, 'exam')?.state, exam); // K-N
  const recoverable = { ...exam, phase: 'exam', submissionError: 'temporary evaluation failure', pendingSubmissionAnswers: ['answer'] };
  writeFreeToolState(free.id, sourceA.fingerprint, 'exam', recoverable);
  assert.deepEqual(readFreeToolState<typeof recoverable>(free.id, sourceA.fingerprint, 'exam')?.state, recoverable); // O-Q
  const completed = { ...recoverable, phase: 'results', submissionError: '', evaluation: { score: 100 } };
  writeFreeToolState(free.id, sourceA.fingerprint, 'exam', completed);
  assert.deepEqual(readFreeToolState<typeof completed>(free.id, sourceA.fingerprint, 'exam')?.state, completed); // P/R
  assert.equal(getSessionById(free.id)?.notes?.freeTools?.quiz?.state?.finished, true);
  assert.equal(getSessionById(free.id)?.notes?.freeTools?.exam?.state?.evaluation?.score, 100);

  const quizSource = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8');
  const examSource = readFileSync('components/materias/ALAIStudyALExams.tsx', 'utf8');
  const sessionsSource = readFileSync('lib/studySessions.ts', 'utf8');
  assert.match(quizSource, /generationBusyRef/); // G
  assert.match(quizSource, /generationAttemptRef/); // H
  assert.match(quizSource, /evaluationBusyRef/); // I
  assert.doesNotMatch(quizSource, /Reportar error|aria-label="Más opciones"/);
  assert.match(examSource, /submissionError/); // O
  assert.match(examSource, /Reintentar corrección/); // P
  assert.match(examSource, /evaluationAttemptRef/); // U
  assert.match(examSource, /activeMaterialSelectedPages/); // T
  assert.doesNotMatch(examSource, /selectedPages=\{selectedPagesArr\}/); // T
  assert.match(examSource, /deadlineAt/); // N/S
  assert.match(sessionsSource, /mergeSessionNotes/);
  assert.match(sessionsSource, /notes: session\.notes/);

  console.log('free-tool-continuity-contracts: A-U PASS');
} finally {
  setTimeout(() => {
    globalThis.fetch = originalFetch;
    ;(globalThis as any).window = originalWindow;
    ;(globalThis as any).localStorage = originalLocalStorage;
  }, 700);
}
