import { createClient } from '@supabase/supabase-js';

const KEY_QUIZZES = 'josea_quizzes_guardados';
const KEY_DECKS = 'josea_flashcard_decks';
const KEY_QUIZ_TEMP = 'josea_quizzes_temp';

const isBrowser = () => typeof window !== 'undefined';
const genId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const getUserId = async (): Promise<string | null> => {
  try {
    const { data: { session } } = await getSupabase().auth.getSession();
    return session?.user?.id || null;
  } catch { return null; }
};

export type NivelQuiz = 'facil' | 'intermedio' | 'dificil';

export interface QuizGuardado {
  id: string;
  nombre: string;
  fechaCreacion: string;
  nivel?: NivelQuiz;
  preguntas: {
    pregunta: string;
    opciones: string[];
    correcta: number;
    explicacion: string;
  }[];
  materiaNombre?: string;
  materiaColor?: string;
  expiraEn?: number;
  enDeck?: boolean;
  esTemporal?: boolean;
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

export const getQuizzesGuardados = (): QuizGuardado[] => {
  if (!isBrowser()) return [];
  try {
    const data = localStorage.getItem(KEY_QUIZZES);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

export const saveQuizzesGuardados = (quizzes: QuizGuardado[]) => {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_QUIZZES, JSON.stringify(quizzes));
};

export const guardarQuiz = async (quiz: Omit<QuizGuardado, 'id' | 'fechaCreacion'>) => {
  const nuevo: QuizGuardado = {
    ...quiz,
    id: genId(),
    fechaCreacion: new Date().toLocaleDateString('es-ES'),
    esTemporal: false,
    expiraEn: undefined,
  };
  saveQuizzesGuardados([...getQuizzesGuardados(), nuevo]);

  const userId = await getUserId();
  if (userId) {
    try {
      await getSupabase().from('quizzes_guardados').upsert({
        id: nuevo.id,
        user_id: userId,
        nombre: nuevo.nombre,
        fecha_creacion: nuevo.fechaCreacion,
        preguntas: nuevo.preguntas,
        nivel: nuevo.nivel || 'intermedio',
        materia_nombre: nuevo.materiaNombre,
        materia_color: nuevo.materiaColor,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id,user_id' });
    } catch (e) { console.warn('Quiz sync error:', e); }
  }
  return nuevo;
};

export const eliminarQuizGuardado = async (id: string) => {
  saveQuizzesGuardados(getQuizzesGuardados().filter(q => q.id !== id));
  const userId = await getUserId();
  if (userId) {
    try {
      await getSupabase().from('quizzes_guardados')
        .delete().eq('id', id).eq('user_id', userId);
    } catch (e) { console.warn('Quiz delete error:', e); }
  }
};

export const cargarQuizzesDesdeDB = async (): Promise<QuizGuardado[]> => {
  const userId = await getUserId();
  if (!userId) return getQuizzesGuardados();
  try {
    const { data } = await getSupabase()
      .from('quizzes_guardados')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (data && data.length > 0) {
      const quizzes: QuizGuardado[] = data.map(r => ({
        id: r.id,
        nombre: r.nombre,
        fechaCreacion: r.fecha_creacion,
        nivel: r.nivel || 'intermedio',
        preguntas: r.preguntas || [],
        materiaNombre: r.materia_nombre,
        materiaColor: r.materia_color,
      }));
      saveQuizzesGuardados(quizzes);
      return quizzes;
    }
  } catch (e) { console.warn('cargarQuizzes error:', e); }
  return getQuizzesGuardados();
};

export const getQuizzesTemporales = (): QuizGuardado[] => {
  if (!isBrowser()) return [];
  try {
    const data = localStorage.getItem(KEY_QUIZ_TEMP);
    const todos: QuizGuardado[] = data ? JSON.parse(data) : [];
    const ahora = Date.now();
    const vigentes = todos.filter(q => q.expiraEn && q.expiraEn > ahora && !q.enDeck);
    if (vigentes.length !== todos.length) {
      localStorage.setItem(KEY_QUIZ_TEMP, JSON.stringify(vigentes));
    }
    return vigentes;
  } catch { return []; }
};

export const guardarQuizTemporal = (quiz: Omit<QuizGuardado, 'id' | 'fechaCreacion'>): QuizGuardado => {
  const nuevo: QuizGuardado = {
    ...quiz,
    id: genId(),
    fechaCreacion: new Date().toLocaleDateString('es-ES'),
    expiraEn: Date.now() + 24 * 60 * 60 * 1000,
    esTemporal: true,
    enDeck: false,
  };
  const actuales = getQuizzesTemporales();
  localStorage.setItem(KEY_QUIZ_TEMP, JSON.stringify([...actuales, nuevo]));
  return nuevo;
};

export const pasarTemporalADeck = async (id: string, nombre: string): Promise<boolean> => {
  const temporales = getQuizzesTemporales();
  const quiz = temporales.find(q => q.id === id);
  if (!quiz) return false;
  // Eliminar de temporales directamente
  const sinEste = temporales.filter(q => q.id !== id);
  localStorage.setItem(KEY_QUIZ_TEMP, JSON.stringify(sinEste));
  // Guardar en permanentes
  await guardarQuiz({ ...quiz, nombre, esTemporal: false });
  return true;
};

export const eliminarQuizTemporal = (id: string) => {
  const actuales = getQuizzesTemporales();
  localStorage.setItem(KEY_QUIZ_TEMP, JSON.stringify(actuales.filter(q => q.id !== id)));
};

export const getTiempoRestante = (expiraEn: number): string => {
  const diff = expiraEn - Date.now();
  if (diff <= 0) return 'Expirado';
  const horas = Math.floor(diff / (1000 * 60 * 60));
  const minutos = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (horas > 0) return `${horas}h ${minutos}m`;
  return `${minutos}m`;
};

export const getFlashcardDecks = (): FlashcardDeck[] => {
  if (!isBrowser()) return [];
  try {
    const data = localStorage.getItem(KEY_DECKS);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

export const saveFlashcardDecks = (decks: FlashcardDeck[]) => {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_DECKS, JSON.stringify(decks));
};

export const guardarDeck = async (deck: Omit<FlashcardDeck, 'id' | 'fechaCreacion'>) => {
  const nuevo: FlashcardDeck = {
    ...deck,
    id: genId(),
    fechaCreacion: new Date().toLocaleDateString('es-ES'),
  };
  saveFlashcardDecks([...getFlashcardDecks(), nuevo]);

  const userId = await getUserId();
  if (userId) {
    try {
      await getSupabase().from('flashcard_decks').upsert({
        id: nuevo.id,
        user_id: userId,
        nombre: nuevo.nombre,
        fecha_creacion: nuevo.fechaCreacion,
        flashcards: nuevo.flashcards,
        materia_nombre: nuevo.materiaNombre,
        materia_color: nuevo.materiaColor,
        tema_color: nuevo.temaColor,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id,user_id' });
    } catch (e) { console.warn('Deck sync error:', e); }
  }
  return nuevo;
};

export const actualizarDeck = async (id: string, changes: Partial<FlashcardDeck>) => {
  const decks = getFlashcardDecks();
  const updated = decks.map(d => d.id === id ? { ...d, ...changes } : d);
  saveFlashcardDecks(updated);

  const userId = await getUserId();
  if (userId) {
    try {
      await getSupabase().from('flashcard_decks')
        .update({ ...changes, updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', userId);
    } catch (e) { console.warn('Deck update error:', e); }
  }
};

export const eliminarDeck = async (id: string) => {
  saveFlashcardDecks(getFlashcardDecks().filter(d => d.id !== id));
  const userId = await getUserId();
  if (userId) {
    try {
      await getSupabase().from('flashcard_decks')
        .delete().eq('id', id).eq('user_id', userId);
    } catch (e) { console.warn('Deck delete error:', e); }
  }
};

export const cargarDecksDesdeDB = async (): Promise<FlashcardDeck[]> => {
  const userId = await getUserId();
  if (!userId) return getFlashcardDecks();
  try {
    const { data } = await getSupabase()
      .from('flashcard_decks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (data && data.length > 0) {
      const decks: FlashcardDeck[] = data.map(r => ({
        id: r.id,
        nombre: r.nombre,
        fechaCreacion: r.fecha_creacion,
        flashcards: r.flashcards || [],
        materiaNombre: r.materia_nombre,
        materiaColor: r.materia_color,
        temaColor: r.tema_color,
      }));
      saveFlashcardDecks(decks);
      return decks;
    }
  } catch (e) { console.warn('cargarDecks error:', e); }
  return getFlashcardDecks();
};
