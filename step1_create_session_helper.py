import pathlib

# Crear archivo helper de sesiones
helper_path = pathlib.Path('lib/studySessions.ts')
helper_path.parent.mkdir(parents=True, exist_ok=True)

helper_code = '''// ═══════════════════════════════════════════════════════════════
// Sistema de sesiones de estudio persistentes en localStorage
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
  createdAt: number;
  lastOpenedAt: number;
}

const STORAGE_KEY = 'flashka_study_sessions_v1';

function loadAll(): Record<string, StudySession> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveAll(sessions: Record<string, StudySession>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
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
export function upsertSession(params: {
  temaId: string;
  enfoque: Enfoque;
  materialIds: string[];
  selectedPages?: Record<string, number[]>;
  flashcards?: any[];
  notes?: any[];
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
      lastOpenedAt: now,
    };
    all[existing.id] = updated;
    saveAll(all);
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
    createdAt: now,
    lastOpenedAt: now,
  };
  all[id] = newSession;
  saveAll(all);
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
    // Filtrar materiales que ya no existen
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
'''

helper_path.write_text(helper_code, encoding='utf-8')
print(f"✅ Helper creado: {helper_path}")
print("   - getSessionsByTema(temaId)")
print("   - findSession(temaId, enfoque, materialIds)")
print("   - upsertSession({...})")
print("   - deleteSession(id)")
print("   - getMaterialSessions(temaId, materialId)")
print("   - cleanupSessions(temaId, existingIds)")
