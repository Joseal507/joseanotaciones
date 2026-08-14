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
  youtubeId?: string;
  youtubeThumbnail?: string;
  youtubeChannel?: string;
  youtubeWordCount?: number;
  analisis?: {
    keywords: string[];
    important_phrases: string[];
    summary: string;
    key_points?: string[];
    topics?: string[];
    difficulty?: string;
  };
  flashcards?: { question: string; answer: string }[];
  quiz?: {
    pregunta: string;
    opciones: string[];
    correcta: number;
    explicacion: string;
  }[];
}

export interface Tema {
  id: string;
  nombre: string;
  color: string;
  apuntes: Apunte[];
  documentos: Documento[];
}

export interface Materia {
  calificaciones?: import("./calificaciones").CalificacionesMateria;
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
    acertadas?: number;
    falladas?: number;
    total?: number;
  }[];
}

const isBrowser = () => typeof window !== 'undefined';

const KEY = 'studyal_materias';
const KEY_PERFIL = 'studyal_perfil';
const KEY_LAST_SYNC = 'studyal_last_sync';
const KEY_REVISION = 'studyal_materias_revision';

export type MateriasLookupResult =
  | { status: 'FOUND'; materias: Materia[]; revision: number }
  | { status: 'ABSENT'; materias: []; revision: number }
  | { status: 'ERROR'; error: string };

let pendingMateriasWrite: Promise<void> = Promise.resolve();
let lastQueuedSnapshot = '';

// ─── LOCAL STORAGE ───────────────────────────────────────

export const getMaterias = (): Materia[] => {
  if (!isBrowser()) return [];
  try {
    const data = localStorage.getItem(KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

const materiasLimpias = (materias: Materia[]) => materias.map(m => ({
  ...m,
  temas: m.temas.map(t => ({
    ...t,
    documentos: t.documentos.map(d => {
      const { archivoBase64, archivoUrl, ...resto } = d as any;
      return resto;
    }),
  })),
}));

export const saveMaterias = (materias: Materia[]) => {
  if (!isBrowser()) return Promise.resolve();
  const light = materiasLimpias(materias);
  try {
    localStorage.setItem(KEY, JSON.stringify(light));
  } catch {
    console.error('localStorage full');
  }
  const snapshot = JSON.stringify(light);
  if (snapshot === lastQueuedSnapshot) return pendingMateriasWrite;
  lastQueuedSnapshot = snapshot;
  // Serializar los writes evita que una respuesta vieja de autosave llegue
  // después de una nueva. El CAS del servidor protege también entre tabs.
  pendingMateriasWrite = pendingMateriasWrite
    .catch(() => undefined)
    .then(() => syncMateriasToSupabase(light))
    .catch((error) => {
      if (lastQueuedSnapshot === snapshot) lastQueuedSnapshot = '';
      window.dispatchEvent(new CustomEvent('studyal:materias-persist-error', {
        detail: { message: error instanceof Error ? error.message : String(error) },
      }));
    });
  return pendingMateriasWrite;
};

// ─── SUPABASE SYNC ────────────────────────────────────────

export const syncMateriasToSupabase = async (materias: Materia[]): Promise<void> => {
  const canonical = materiasLimpias(materias);
  let expectedRevision = Number(localStorage.getItem(KEY_REVISION) || 0);
  let lastError: unknown = new Error('PERSIST_FAILED');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('/api/materias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materias: canonical, expectedRevision }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Respuesta perdida tras commit: el retry ve conflicto, pero si el
        // snapshot durable es idéntico, la operación ya quedó aplicada.
        if (JSON.stringify(data.materias || []) === JSON.stringify(canonical)) {
          localStorage.setItem(KEY_REVISION, String(Number(data.revision || expectedRevision + 1)));
          localStorage.setItem(KEY_LAST_SYNC, new Date().toISOString());
          return;
        }
        window.dispatchEvent(new CustomEvent('studyal:materias-conflict', { detail: data }));
        throw new Error('MATERIAS_VERSION_CONFLICT');
      }
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP_${res.status}`);
      localStorage.setItem(KEY_REVISION, String(Number(data.revision || expectedRevision + 1)));
      localStorage.setItem(KEY_LAST_SYNC, new Date().toISOString());
      return;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message === 'MATERIAS_VERSION_CONFLICT') break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      expectedRevision = Number(localStorage.getItem(KEY_REVISION) || expectedRevision);
    }
  }
  console.error('Sync materias D1 error:', lastError);
  throw lastError;
};

export const lookupMateriasDesdeDB = async (): Promise<MateriasLookupResult> => {
  try {
    const res = await fetch('/api/materias', { cache: 'no-store' });
    if (!res.ok) return { status: 'ERROR', error: `HTTP_${res.status}` };

    const data = await res.json();
    if (!data.success) return { status: 'ERROR', error: data.error || 'INVALID_RESPONSE' };
    const materias: Materia[] = data.materias || [];
    const revision = Number(data.revision || 0);

    localStorage.setItem(KEY, JSON.stringify(materias));
    localStorage.setItem(KEY_REVISION, String(revision));
    localStorage.setItem(KEY_LAST_SYNC, new Date().toISOString());
    lastQueuedSnapshot = JSON.stringify(materias);
    return materias.length
      ? { status: 'FOUND', materias, revision }
      : { status: 'ABSENT', materias: [], revision };
  } catch {
    return { status: 'ERROR', error: 'NETWORK_ERROR' };
  }
};

export const cargarMateriasDesdeDB = async (): Promise<Materia[] | null> => {
  const result = await lookupMateriasDesdeDB();
  return result.status === 'ERROR' ? null : result.materias;
};

export const waitForMateriasPersistence = () => pendingMateriasWrite;

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
    a.download = `studyal_backup_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}.json`;
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
    const res = await fetch('/api/auth/session', { cache: 'no-store' });
    const session = await res.json();
    const userId = session?.user?.id;
    if (!userId) return;

    const { savePerfilDB } = await import('./db');
    await savePerfilDB(userId, perfil);
  } catch (err) {
    console.error('Perfil sync D1 error:', err);
  }
};

export const cargarPerfilDesdeDB = async (): Promise<PerfilEstudio | null> => {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store' });
    const session = await res.json();
    const userId = session?.user?.id;
    if (!userId) return null;

    const { getPerfilDB } = await import('./db');
    const perfilDB = await getPerfilDB(userId);
    const tieneData = Object.keys(perfilDB.flashcardsAcertadas || {}).length > 0
      || Object.keys(perfilDB.flashcardsFalladas || {}).length > 0
      || Object.keys(perfilDB.materiasStats || {}).length > 0;

    if (tieneData) {
      localStorage.setItem(KEY_PERFIL, JSON.stringify(perfilDB));
      return perfilDB;
    }

    return null;
  } catch {
    return null;
  }
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
  acertadas?: number,
  falladas?: number,
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
  const hoy = new Date().toISOString().split('T')[0];
  (perfil.sesiones as any[]).push({
    fecha: hoy,
    tipo: 'quiz',
    materiaId,
    puntuacion,
    acertadas: acertadas || 0,
    falladas: falladas || 0,
    total: (acertadas || 0) + (falladas || 0),
  });
  if (perfil.sesiones.length > 500) {
    perfil.sesiones = perfil.sesiones.slice(-500);
  }
  savePerfil(perfil);
};
