export interface Apunte {
  id: string;
  titulo: string;
  contenido: string;
  fechaCreacion: string;
  fechaModificacion: string;
}

export interface Documento {
  id: string;
  nombre: string;
  contenido: string;
  tipo: string;
  fechaSubida: string;
  archivoUrl?: string; // URL del archivo original en Supabase Storage
  analisis?: {
    keywords: string[];
    important_phrases: string[];
    summary: string;
  };
  flashcards?: { question: string; answer: string }[];
}

export interface Tema {
  id: string;
  nombre: string;
  color: string;
  apuntes: Apunte[];
  documentos: Documento[];
}

export interface Materia {
  id: string;
  nombre: string;
  color: string;
  emoji: string;
  temas: Tema[];
}

export interface PerfilEstudio {
  flashcardsFalladas: { [pregunta: string]: number };
  flashcardsAcertadas: { [pregunta: string]: number };
  materiasStats: {
    [materiaId: string]: {
      nombre: string;
      color: string;
      totalFlashcards: number;
      acertadas: number;
      falladas: number;
      quizzes: number;
      quizPuntuacion: number;
    };
  };
  sesiones: {
    fecha: string;
    tipo: 'estudio' | 'quiz' | 'repaso';
    materiaId: string;
    puntuacion: number;
  }[];
}

const isBrowser = () => typeof window !== 'undefined';

const KEY = 'joseanotaciones_materias';
const KEY_PERFIL = 'josea_perfil';

export const getMaterias = (): Materia[] => {
  if (!isBrowser()) return [];
  try {
    const data = localStorage.getItem(KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

export const saveMaterias = (materias: Materia[]) => {
  if (!isBrowser()) return;
  localStorage.setItem(KEY, JSON.stringify(materias));
};

export const generateId = () =>
  Date.now().toString() + Math.random().toString(36).substr(2, 9);

export const COLORES = [
  '#f5c842', '#ff4d6d', '#38bdf8',
  '#f472b6', '#4ade80', '#fb923c', '#a78bfa',
];

export const EMOJIS = [
  '📚', '🔬', '🧮', '🌍', '💻',
  '🎨', '📖', '⚗️', '🧬', '📐', '🎭', '🏛️',
];

export const getPerfil = (): PerfilEstudio => {
  const empty: PerfilEstudio = {
    flashcardsFalladas: {},
    flashcardsAcertadas: {},
    materiasStats: {},
    sesiones: [],
  };
  if (!isBrowser()) return empty;
  try {
    const data = localStorage.getItem(KEY_PERFIL);
    return data ? JSON.parse(data) : empty;
  } catch { return empty; }
};

export const savePerfil = (perfil: PerfilEstudio) => {
  if (!isBrowser()) return;
  localStorage.setItem(KEY_PERFIL, JSON.stringify(perfil));
};

export const registrarResultado = (
  pregunta: string,
  acerto: boolean,
  materiaId: string,
  materiaNombre: string,
  materiaColor: string,
) => {
  if (!isBrowser()) return;
  const perfil = getPerfil();

  if (acerto) {
    perfil.flashcardsAcertadas[pregunta] = (perfil.flashcardsAcertadas[pregunta] || 0) + 1;
  } else {
    perfil.flashcardsFalladas[pregunta] = (perfil.flashcardsFalladas[pregunta] || 0) + 1;
  }

  if (!perfil.materiasStats[materiaId]) {
    perfil.materiasStats[materiaId] = {
      nombre: materiaNombre,
      color: materiaColor,
      totalFlashcards: 0,
      acertadas: 0,
      falladas: 0,
      quizzes: 0,
      quizPuntuacion: 0,
    };
  }

  if (acerto) {
    perfil.materiasStats[materiaId].acertadas++;
  } else {
    perfil.materiasStats[materiaId].falladas++;
  }
  perfil.materiasStats[materiaId].totalFlashcards++;

  savePerfil(perfil);
};

export const registrarQuiz = (
  materiaId: string,
  materiaNombre: string,
  materiaColor: string,
  puntuacion: number,
) => {
  if (!isBrowser()) return;
  const perfil = getPerfil();

  if (!perfil.materiasStats[materiaId]) {
    perfil.materiasStats[materiaId] = {
      nombre: materiaNombre,
      color: materiaColor,
      totalFlashcards: 0,
      acertadas: 0,
      falladas: 0,
      quizzes: 0,
      quizPuntuacion: 0,
    };
  }

  perfil.materiasStats[materiaId].quizzes++;
  perfil.materiasStats[materiaId].quizPuntuacion += puntuacion;

  perfil.sesiones.push({
    fecha: new Date().toLocaleDateString('es-ES'),
    tipo: 'quiz',
    materiaId,
    puntuacion,
  });

  savePerfil(perfil);
};