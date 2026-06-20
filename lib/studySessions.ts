// ═══════════════════════════════════════════════════════════════
// Sistema de sesiones de estudio persistentes.
 // Fuente local inmediata + sincronización con D1 por usuario vía NextAuth.
// ═══════════════════════════════════════════════════════════════
export type Enfoque = 'teorico' | 'matematico' | 'mixto';

export interface StudySession {
  id: string;                           // sess_xxx
  temaId: string;                       // tema al que pertenece
  enfoque: Enfoque;
  materialIds: string[];                // materiales en esta sesión
  selectedPages?: Record<string, number[]>; // páginas por materialId
  flashcards?: any[];                   // flashcards generadas
  notes?: any[];                        // notas/apuntes hechos
  materialText?: string;
  currentPhase?: string;
  createdAt: number;
  lastOpenedAt: number;
}

const BASE_KEY = 'study_sessions_v1';
const USER_KEY = 'nextauth';

function getStorageKey(): string {
  return `${BASE_KEY}_${USER_KEY}`;
}

function loadAll(): Record<string, StudySession> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveAll(sessions: Record<string, StudySession>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(sessions));
  } catch {}
}

// Obtener todas las sesiones de un tema
export function getSessionsByTema(temaId: string): StudySession[] {
  const all = loadAll();
  return Object.values(all)
    .filter(s => s.temaId === temaId)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

// Encontrar sesión por enfoque + materialIds (para no duplicar)
export function findSession(temaId: string, enfoque: Enfoque, materialIds: string[]): StudySession | null {
  const sessions = getSessionsByTema(temaId);
  const sortedIds = [...materialIds].sort().join(',');
  return sessions.find(s =>
    s.enfoque === enfoque &&
    [...s.materialIds].sort().join(',') === sortedIds
  ) || null;
}

// Crear o actualizar sesión
async function syncSessionToServer(session: StudySession) {
  if (typeof window === 'undefined') return;

  try {
    await fetch('/api/study-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(session),
    });
  } catch {}
}

export function upsertSession(params: {
  temaId: string;
  enfoque: Enfoque;
  materialIds: string[];
  selectedPages?: Record<string, number[]>;
  flashcards?: any[];
  notes?: any[];
  materialText?: string;
  currentPhase?: string;
}): StudySession {
  const all = loadAll();
  const existing = findSession(params.temaId, params.enfoque, params.materialIds);

  const now = Date.now();
  if (existing) {
    const updated: StudySession = {
      ...existing,
      selectedPages: params.selectedPages ?? existing.selectedPages,
      flashcards: params.flashcards ?? existing.flashcards,
      notes: params.notes ?? existing.notes,
      materialText: params.materialText ?? existing.materialText,
      currentPhase: params.currentPhase ?? existing.currentPhase,
      lastOpenedAt: now,
    };
    all[existing.id] = updated;
    saveAll(all);
    syncSessionToServer(updated);
    return updated;
  }

  const id = 'sess_' + now.toString(36) + Math.random().toString(36).slice(2, 8);
  const newSession: StudySession = {
    id,
    temaId: params.temaId,
    enfoque: params.enfoque,
    materialIds: params.materialIds,
    selectedPages: params.selectedPages,
    flashcards: params.flashcards,
    notes: params.notes,
    materialText: params.materialText,
    currentPhase: params.currentPhase,
    createdAt: now,
    lastOpenedAt: now,
  };
  all[id] = newSession;
  saveAll(all);
  syncSessionToServer(newSession);
  return newSession;
}

// Eliminar sesión
export function deleteSession(sessionId: string) {
  const all = loadAll();
  delete all[sessionId];
  saveAll(all);
}

// Saber si un material tiene alguna sesión activa
export function getMaterialSessions(temaId: string, materialId: string): StudySession[] {
  return getSessionsByTema(temaId).filter(s => s.materialIds.includes(materialId));
}

// Limpiar sesiones huérfanas (materiales que ya no existen)
export function cleanupSessions(temaId: string, existingMaterialIds: string[]) {
  const all = loadAll();
  const validSet = new Set(existingMaterialIds);
  let removed = 0;
  Object.values(all).forEach(s => {
    if (s.temaId !== temaId) return;
    const validMats = s.materialIds.filter(id => validSet.has(id));
    if (validMats.length === 0) {
      delete all[s.id];
      removed++;
    } else if (validMats.length !== s.materialIds.length) {
      all[s.id] = { ...s, materialIds: validMats };
    }
  });
  if (removed > 0) {
    saveAll(all);
    console.log('🧹 Sesiones huérfanas limpiadas:', removed);
  }
}

// ── Migración del key viejo (flashka_study_sessions_v1) → nuevo ──
if (typeof window !== 'undefined') {
  try {
    const oldKey = 'flashka_study_sessions_v1';
    const oldData = localStorage.getItem(oldKey);
    if (oldData) {
      const newKey = getStorageKey();
      if (!localStorage.getItem(newKey)) localStorage.setItem(newKey, oldData);
      localStorage.removeItem(oldKey);
    }
  } catch {}
}

export async function syncSessionsFromServer(temaId?: string): Promise<StudySession[]> {
  if (typeof window === 'undefined') return [];

  try {
    const res = await fetch(`/api/study-sessions${temaId ? `?temaId=${encodeURIComponent(temaId)}` : ''}`, {
      cache: 'no-store',
    });

    const json = await res.json();
    if (!res.ok || !json?.success || !Array.isArray(json.sessions)) {
      return temaId ? getSessionsByTema(temaId) : Object.values(loadAll()).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    }

    const all = loadAll();
    for (const sess of json.sessions as StudySession[]) {
      if (!sess?.id) continue;
      const local = all[sess.id];
      if (!local || Number(sess.lastOpenedAt || 0) >= Number(local.lastOpenedAt || 0)) {
        all[sess.id] = sess;
      }
    }

    saveAll(all);

    return temaId
      ? getSessionsByTema(temaId)
      : Object.values(loadAll()).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return temaId ? getSessionsByTema(temaId) : Object.values(loadAll()).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }
}
