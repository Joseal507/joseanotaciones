import fs from "fs";
import re from "node:repl";

function w(path, content) {
  fs.writeFileSync(path, content.trimStart() + "\n");
  console.log("updated", path);
}

// limpiar línea vieja de app/materias/page.tsx por reemplazo textual simple
let m = fs.readFileSync("app/materias/page.tsx", "utf8");
m = m.replace(
`      const session = (await import('../../lib/supabase').then(m => m.supabase.auth.getSession())).data.session;
      await fetch(\`/api/materials/\${materialId}\`, {
        method: 'DELETE',
        headers: session?.access_token ? { Authorization: \`Bearer \${session.access_token}\` } : {},
      });`,
`      await fetch(\`/api/materials/\${materialId}\`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });`
);
fs.writeFileSync("app/materias/page.tsx", m);
console.log("patched app/materias/page.tsx");

// quizStorage sin Supabase: localStorage-first, con API hooks futuros
w("lib/quizStorage.ts", `
export type QuizGuardado = {
  id: string;
  nombre: string;
  materiaId?: string;
  materiaNombre?: string;
  temaId?: string;
  temaNombre?: string;
  preguntas: any[];
  fechaCreacion?: string;
  fechaActualizacion?: string;
};

export type FlashcardDeck = {
  id: string;
  nombre: string;
  materiaId?: string;
  materiaNombre?: string;
  temaId?: string;
  temaNombre?: string;
  flashcards: any[];
  fechaCreacion?: string;
  fechaActualizacion?: string;
};

const QUIZZES_KEY = 'studyal_quizzes_guardados';
const TEMP_QUIZZES_KEY = 'studyal_quizzes_temporales';
const DECKS_KEY = 'studyal_flashcard_decks';

function readArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function uid(prefix: string) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

// ===== QUIZZES =====
export function getQuizzesGuardados(): QuizGuardado[] {
  return readArray<QuizGuardado>(QUIZZES_KEY);
}

export function guardarQuiz(quiz: Partial<QuizGuardado> & { preguntas: any[] }): QuizGuardado {
  const now = new Date().toISOString();
  const quizzes = getQuizzesGuardados();

  const item: QuizGuardado = {
    id: quiz.id || uid('quiz'),
    nombre: quiz.nombre || 'Quiz sin título',
    materiaId: quiz.materiaId,
    materiaNombre: quiz.materiaNombre,
    temaId: quiz.temaId,
    temaNombre: quiz.temaNombre,
    preguntas: quiz.preguntas || [],
    fechaCreacion: quiz.fechaCreacion || now,
    fechaActualizacion: now,
  };

  const idx = quizzes.findIndex(q => q.id === item.id);
  if (idx >= 0) quizzes[idx] = item;
  else quizzes.unshift(item);

  writeArray(QUIZZES_KEY, quizzes);
  return item;
}

export function eliminarQuiz(id: string) {
  writeArray(QUIZZES_KEY, getQuizzesGuardados().filter(q => q.id !== id));
}

export function getQuizGuardado(id: string): QuizGuardado | null {
  return getQuizzesGuardados().find(q => q.id === id) || null;
}

// ===== QUIZZES TEMPORALES =====
export function getQuizzesTemporales(): QuizGuardado[] {
  return readArray<QuizGuardado>(TEMP_QUIZZES_KEY);
}

export function guardarQuizTemporal(quiz: Partial<QuizGuardado> & { preguntas: any[] }): QuizGuardado {
  const now = new Date().toISOString();
  const quizzes = getQuizzesTemporales();

  const item: QuizGuardado = {
    id: quiz.id || uid('quiz_temp'),
    nombre: quiz.nombre || 'Quiz temporal',
    materiaId: quiz.materiaId,
    materiaNombre: quiz.materiaNombre,
    temaId: quiz.temaId,
    temaNombre: quiz.temaNombre,
    preguntas: quiz.preguntas || [],
    fechaCreacion: quiz.fechaCreacion || now,
    fechaActualizacion: now,
  };

  const idx = quizzes.findIndex(q => q.id === item.id);
  if (idx >= 0) quizzes[idx] = item;
  else quizzes.unshift(item);

  writeArray(TEMP_QUIZZES_KEY, quizzes.slice(0, 50));
  return item;
}

export function eliminarQuizTemporal(id: string) {
  writeArray(TEMP_QUIZZES_KEY, getQuizzesTemporales().filter(q => q.id !== id));
}

export function limpiarQuizzesTemporales() {
  writeArray(TEMP_QUIZZES_KEY, []);
}

// ===== FLASHCARD DECKS =====
export function getFlashcardDecks(): FlashcardDeck[] {
  return readArray<FlashcardDeck>(DECKS_KEY);
}

export function guardarFlashcardDeck(deck: Partial<FlashcardDeck> & { flashcards: any[] }): FlashcardDeck {
  const now = new Date().toISOString();
  const decks = getFlashcardDecks();

  const item: FlashcardDeck = {
    id: deck.id || uid('deck'),
    nombre: deck.nombre || 'Deck sin título',
    materiaId: deck.materiaId,
    materiaNombre: deck.materiaNombre,
    temaId: deck.temaId,
    temaNombre: deck.temaNombre,
    flashcards: deck.flashcards || [],
    fechaCreacion: deck.fechaCreacion || now,
    fechaActualizacion: now,
  };

  const idx = decks.findIndex(d => d.id === item.id);
  if (idx >= 0) decks[idx] = item;
  else decks.unshift(item);

  writeArray(DECKS_KEY, decks);
  return item;
}

export function eliminarFlashcardDeck(id: string) {
  writeArray(DECKS_KEY, getFlashcardDecks().filter(d => d.id !== id));
}

export function getFlashcardDeck(id: string): FlashcardDeck | null {
  return getFlashcardDecks().find(d => d.id === id) || null;
}
`);
