const KEY_QUIZZES = 'josea_quizzes_guardados';
const KEY_DECKS = 'josea_flashcard_decks';

export interface QuizGuardado {
  id: string;
  nombre: string;
  fechaCreacion: string;
  preguntas: {
    pregunta: string;
    opciones: string[];
    correcta: number;
    explicacion: string;
  }[];
  materiaNombre?: string;
  materiaColor?: string;
}

export interface FlashcardDeck {
  id: string;
  nombre: string;
  fechaCreacion: string;
  flashcards: { question: string; answer: string }[];
  materiaNombre?: string;
  materiaColor?: string;
  temaColor?: string;
}

const genId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

// ===== QUIZZES =====
export const getQuizzesGuardados = (): QuizGuardado[] => {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(KEY_QUIZZES);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

export const saveQuizzesGuardados = (quizzes: QuizGuardado[]) => {
  localStorage.setItem(KEY_QUIZZES, JSON.stringify(quizzes));
};

export const guardarQuiz = (quiz: Omit<QuizGuardado, 'id' | 'fechaCreacion'>) => {
  const quizzes = getQuizzesGuardados();
  const nuevo: QuizGuardado = {
    ...quiz,
    id: genId(),
    fechaCreacion: new Date().toLocaleDateString('es-ES'),
  };
  saveQuizzesGuardados([...quizzes, nuevo]);
  return nuevo;
};

export const eliminarQuizGuardado = (id: string) => {
  saveQuizzesGuardados(getQuizzesGuardados().filter(q => q.id !== id));
};

// ===== FLASHCARD DECKS =====
export const getFlashcardDecks = (): FlashcardDeck[] => {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(KEY_DECKS);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

export const saveFlashcardDecks = (decks: FlashcardDeck[]) => {
  localStorage.setItem(KEY_DECKS, JSON.stringify(decks));
};

export const guardarDeck = (deck: Omit<FlashcardDeck, 'id' | 'fechaCreacion'>) => {
  const decks = getFlashcardDecks();
  const nuevo: FlashcardDeck = {
    ...deck,
    id: genId(),
    fechaCreacion: new Date().toLocaleDateString('es-ES'),
  };
  saveFlashcardDecks([...decks, nuevo]);
  return nuevo;
};

export const actualizarDeck = (id: string, changes: Partial<FlashcardDeck>) => {
  const decks = getFlashcardDecks();
  saveFlashcardDecks(decks.map(d => d.id === id ? { ...d, ...changes } : d));
};

export const eliminarDeck = (id: string) => {
  saveFlashcardDecks(getFlashcardDecks().filter(d => d.id !== id));
};