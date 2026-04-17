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
  archivoUrl?: string;
  archivoBase64?: string;
  archivoMime?: string;
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
const KEY_LAST_SYNC = 'josea_last_sync';

// ─── LOCAL STORAGE ───────────────────────────────────────

export const getMaterias = (): Materia[] => {
  if (!isBrowser()) return [];
  try {
    const data = localStorage.getItem(KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

export const saveMaterias = (materias: Materia[]) => {
  if (!isBrowser()) return;
  try {
    const light = materias.map(m => ({
      ...m,
      temas: m.temas.map(t => ({
        ...t,
        documentos: t.documentos.map(d => {
          const { archivoBase64, archivoUrl, ...resto } = d as any;
          return resto;
        }),
      })),
    }));
    localStorage.setItem(KEY, JSON.stringify(light));
  } catch {
    console.error('localStorage full');
  }
  // ✅ Sync a Supabase en background
  syncMateriasToSupabase(materias);
};

// ─── SUPABASE SYNC ────────────────────────────────────────

export const syncMateriasToSupabase = async (materias: Materia[]) => {
  try {
    const { supabase } = await import('./supabase');
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
    if (!session) return;

    const token = session.access_token;
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ tipo: 'materias', datos: materias }),
    });

    if (res.ok) {
      localStorage.setItem(KEY_LAST_SYNC, new Date().toISOString());
    }
  } catch (err) {
    console.error('Sync materias error (non-blocking):', err);
  }
};

export const cargarMateriasDesdeDB = async (): Promise<Materia[] | null> => {
  try {
    const { supabase } = await import('./supabase');
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
    if (!session) return null;

    const token = session.access_token;
    const res = await fetch('/api/sync', {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) return null;
    const data = await res.json();
    const materias: Materia[] = data.data?.materias || [];

    if (materias.length > 0) {
      localStorage.setItem(KEY, JSON.stringify(materias));
      localStorage.setItem(KEY_LAST_SYNC, new Date().toISOString());
      return materias;
    }
    return null;
  } catch {
    return null;
  }
};

export const getLastSync = (): string | null => {
  if (!isBrowser()) return null;
  return localStorage.getItem(KEY_LAST_SYNC);
};

// ─── BACKUP MANUAL ───────────────────────────────────────

export const exportarBackup = () => {
  if (!isBrowser()) return;
  try {
    const materias = getMaterias();
    const perfil = getPerfil();
    const backup = {
      version: '1.0',
      fecha: new Date().toISOString(),
      materias,
      perfil,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `joseanotaciones_backup_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error exportando backup:', err);
  }
};

export const importarBackup = (file: File): Promise<boolean> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target?.result as string);
        if (backup.materias && Array.isArray(backup.materias)) {
          localStorage.setItem(KEY, JSON.stringify(backup.materias));
          syncMateriasToSupabase(backup.materias);
        }
        if (backup.perfil) {
          localStorage.setItem(KEY_PERFIL, JSON.stringify(backup.perfil));
        }
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    reader.readAsText(file);
  });
};

// ─── PERFIL ──────────────────────────────────────────────

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
  syncPerfilToSupabase(perfil);
};

const syncPerfilToSupabase = async (perfil: PerfilEstudio) => {
  try {
    const { supabase } = await import('./supabase');
    const { savePerfilDB } = await import('./db');
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
    if (!session) return;
    await savePerfilDB(session.user.id, perfil);
  } catch (err) {
    console.error('Perfil sync error:', err);
  }
};

export const cargarPerfilDesdeDB = async (): Promise<PerfilEstudio | null> => {
  try {
    const { supabase } = await import('./supabase');
    const { getPerfilDB } = await import('./db');
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
    if (!session) return null;
    const perfilDB = await getPerfilDB(session.user.id);
    const tieneData = Object.keys(perfilDB.flashcardsAcertadas || {}).length > 0
      || Object.keys(perfilDB.flashcardsFalladas || {}).length > 0
      || Object.keys(perfilDB.materiasStats || {}).length > 0;
    if (tieneData) {
      localStorage.setItem(KEY_PERFIL, JSON.stringify(perfilDB));
      return perfilDB;
    }
    return null;
  } catch { return null; }
};

// ─── UTILS ───────────────────────────────────────────────

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
      nombre: materiaNombre, color: materiaColor,
      totalFlashcards: 0, acertadas: 0, falladas: 0, quizzes: 0, quizPuntuacion: 0,
    };
  }
  if (acerto) perfil.materiasStats[materiaId].acertadas++;
  else perfil.materiasStats[materiaId].falladas++;
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
      nombre: materiaNombre, color: materiaColor,
      totalFlashcards: 0, acertadas: 0, falladas: 0, quizzes: 0, quizPuntuacion: 0,
    };
  }
  perfil.materiasStats[materiaId].quizzes++;
  perfil.materiasStats[materiaId].quizPuntuacion += puntuacion;
  perfil.sesiones.push({
    fecha: new Date().toLocaleDateString('es-ES'),
    tipo: 'quiz', materiaId, puntuacion,
  });
  savePerfil(perfil);
};