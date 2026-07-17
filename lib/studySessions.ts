// ═══════════════════════════════════════════════════════════════
// StudyAL — Sistema de sesiones persistentes v2
// Una sesión por (temaId + enfoque + materialIds + processMode)
// Fuente local inmediata + sync con D1 por usuario vía NextAuth
// ═══════════════════════════════════════════════════════════════

export type Enfoque = 'teorico' | 'matematico' | 'mixto';
export type ProcessMode = 'free';

export interface StudySession {
  id: string;
  temaId: string;
  enfoque: Enfoque;
  processMode: ProcessMode;        // CAMPO OBLIGATORIO — nunca opcional
  studyMode: ProcessMode;          // alias de processMode para compatibilidad
  materialIds: string[];
  selectedPages?: Record<string, number[]>;
  flashcards?: any[];
  notes?: any[];
  materialText?: string;
  currentPhase?: string;

  // ── Estado completo del modo adaptativo (para reanudar) ──

  processStyle?: string;           // 'book' | 'sessions' | etc
  targetScore?: number;
  examDate?: string;
  examDateCustom?: string;
  materialBlueprint?: any;
  // Mastery snapshot opcional (para no perder progreso)
  masterySnapshot?: any;

  createdAt: number;
  lastOpenedAt: number;
}

const BASE_KEY = 'study_sessions_v2';

function getStorageKey(): string {
  return BASE_KEY;
}

function loadAll(): Record<string, StudySession> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migrar sesiones viejas que no tienen processMode
    const migrated: Record<string, StudySession> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const s = v as any;
      const mode: ProcessMode = s.processMode || s.studyMode || 'free';
      migrated[k] = {
        ...s,
        processMode: mode,
        studyMode: mode,
      };
    }
    return migrated;
  } catch { return {}; }
}

function saveAll(sessions: Record<string, StudySession>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(sessions));
  } catch {}
}

function normalizeIds(ids: string[]): string {
  return [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))]
    .sort()
    .join(',');
}

// ── Obtener todas las sesiones de un tema ──────────────────────
export function getSessionsByTema(temaId: string): StudySession[] {
  const all = loadAll();
  return Object.values(all)
    .filter(s => s.temaId === temaId)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

// ── Buscar sesión exacta: tema + enfoque + materiales + modo ───
// El modo libre forma parte de la identidad de la sesión
export function findSession(
  temaId: string,
  enfoque: Enfoque,
  materialIds: string[],
  processMode?: ProcessMode,
): StudySession | null {
  const sessions = getSessionsByTema(temaId);
  const sortedIds = normalizeIds(materialIds);

  // Si se especifica el modo, buscar exacto
  if (processMode) {
    const exact = sessions.find(s =>
      s.enfoque === enfoque &&
      s.processMode === processMode &&
      normalizeIds(s.materialIds) === sortedIds
    );
    if (exact) return exact;
  }

  // Sin modo especificado: devolver la más reciente de cualquier modo
  return sessions.find(s =>
    s.enfoque === enfoque &&
    normalizeIds(s.materialIds) === sortedIds
  ) || null;
}

// ── Sincronizar sesión al servidor (fire & forget) ─────────────
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

// ── Crear o actualizar sesión ──────────────────────────────────
// processMode es OBLIGATORIO — si no se pasa explícitamente, es un bug
export function upsertSession(params: {
  temaId: string;
  enfoque: Enfoque;
  processMode: ProcessMode;        // requerido
  studyMode?: ProcessMode;         // alias — se sincroniza con processMode
  materialIds: string[];
  selectedPages?: Record<string, number[]>;
  flashcards?: any[];
  notes?: any[];
  materialText?: string;
  currentPhase?: string;

  targetScore?: number;
  examDate?: string;
  examDateCustom?: string;
  materialBlueprint?: any;
  masterySnapshot?: any;

  processStyle?: any;}): StudySession {
  const all = loadAll();
  const cleanMaterialIds = [
    ...new Set(
      (params.materialIds || [])
        .map(id => String(id || '').trim())
        .filter(Boolean)
    )
  ];

  // El modo siempre viene del parámetro — studyMode es alias de processMode
  const mode: ProcessMode = params.processMode;

  // Buscar sesión existente con MISMO modo
  const existing = findSession(params.temaId, params.enfoque, cleanMaterialIds, mode);

  const now = Date.now();

  if (existing) {
    const updated: StudySession = {
      ...existing,
      processMode: mode,
      studyMode: mode,
      selectedPages: params.selectedPages ?? existing.selectedPages,
      flashcards: params.flashcards ?? existing.flashcards,
      notes: params.notes ?? existing.notes,
      materialText: params.materialText ?? existing.materialText,
      currentPhase: params.currentPhase ?? existing.currentPhase,

      processStyle: params.processStyle ?? existing.processStyle,
      targetScore: params.targetScore ?? existing.targetScore,
      examDate: params.examDate ?? existing.examDate,
      examDateCustom: params.examDateCustom ?? existing.examDateCustom,
      materialBlueprint: params.materialBlueprint ?? existing.materialBlueprint,
      masterySnapshot: params.masterySnapshot ?? existing.masterySnapshot,
      lastOpenedAt: now,
    };
    all[existing.id] = updated;
    saveAll(all);
    syncSessionToServer(updated);
    return updated;
  }

  // Nueva sesión
  const id = 'sess_' + now.toString(36) + Math.random().toString(36).slice(2, 8);
  const newSession: StudySession = {
    id,
    temaId: params.temaId,
    enfoque: params.enfoque,
    processMode: mode,
    studyMode: mode,
    materialIds: cleanMaterialIds,
    selectedPages: params.selectedPages,
    flashcards: params.flashcards,
    notes: params.notes,
    materialText: params.materialText,
    currentPhase: params.currentPhase,

    processStyle: params.processStyle,
    targetScore: params.targetScore,
    examDate: params.examDate,
    examDateCustom: params.examDateCustom,
    materialBlueprint: params.materialBlueprint,
    masterySnapshot: params.masterySnapshot,
    createdAt: now,
    lastOpenedAt: now,
  };
  all[id] = newSession;
  saveAll(all);
  syncSessionToServer(newSession);
  return newSession;
}

// ── Eliminar sesión ────────────────────────────────────────────
export function deleteSession(sessionId: string) {
  const all = loadAll();
  delete all[sessionId];
  saveAll(all);
}

// ── Sesiones activas de un material ───────────────────────────
export function getMaterialSessions(temaId: string, materialId: string): StudySession[] {
  const target = String(materialId || '').trim();
  return getSessionsByTema(temaId).filter(s =>
    s.materialIds.some(id => String(id || '').trim() === target)
  );
}

// ── Limpiar sesiones huérfanas ─────────────────────────────────
export function cleanupSessions(temaId: string, existingMaterialIds: string[]) {
  if (!existingMaterialIds || existingMaterialIds.length === 0) return;
  const all = loadAll();
  const validSet = new Set(existingMaterialIds.filter(Boolean));
  if (validSet.size === 0) return;

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

// ── Migración de keys viejos ───────────────────────────────────
if (typeof window !== 'undefined') {
  try {
    const oldKeys = ['flashka_study_sessions_v1', 'study_sessions_v1_nextauth', 'study_sessions_v1'];
    for (const oldKey of oldKeys) {
      const oldData = localStorage.getItem(oldKey);
      if (oldData) {
        const newKey = getStorageKey();
        const existing = localStorage.getItem(newKey);
        if (!existing) {
          // Migrar y normalizar processMode
          try {
            const parsed = JSON.parse(oldData);
            const migrated: Record<string, any> = {};
            for (const [k, v] of Object.entries(parsed)) {
              const s = v as any;
              const mode = s.processMode || s.studyMode || 'free';
              migrated[k] = { ...s, processMode: mode, studyMode: mode };
            }
            localStorage.setItem(newKey, JSON.stringify(migrated));
          } catch {
            localStorage.setItem(newKey, oldData);
          }
        }
        localStorage.removeItem(oldKey);
      }
    }
  } catch {}
}

// ── Sync desde servidor ────────────────────────────────────────
export async function syncSessionsFromServer(temaId?: string): Promise<StudySession[]> {
  if (typeof window === 'undefined') return [];

  try {
    const res = await fetch(
      `/api/study-sessions${temaId ? `?temaId=${encodeURIComponent(temaId)}` : ''}`,
      { cache: 'no-store' }
    );
    const json = await res.json();

    if (!res.ok || !json?.success || !Array.isArray(json.sessions)) {
      return temaId
        ? getSessionsByTema(temaId)
        : Object.values(loadAll()).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    }

    const all = loadAll();
    for (const sess of json.sessions as StudySession[]) {
      if (!sess?.id) continue;
      // Normalizar modo al venir del servidor
      const mode: ProcessMode = sess.processMode || sess.studyMode || 'free';
      const normalized: StudySession = { ...sess, processMode: mode, studyMode: mode };
      const local = all[sess.id];
      if (!local || Number(sess.lastOpenedAt || 0) >= Number(local.lastOpenedAt || 0)) {
        all[sess.id] = normalized;
      }
    }

    saveAll(all);

    return temaId
      ? getSessionsByTema(temaId)
      : Object.values(loadAll()).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    return temaId
      ? getSessionsByTema(temaId)
      : Object.values(loadAll()).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }
}
