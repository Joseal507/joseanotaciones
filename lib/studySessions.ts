// ═══════════════════════════════════════════════════════════════
// StudyAL — Sistema de sesiones v4
// Una sesión = temaId + materialIds (1-5) + processMode
// Persiste en localStorage + sync servidor
// ═══════════════════════════════════════════════════════════════

export type ProcessMode = 'free' | 'adaptive' | 'manual';
export type Enfoque = 'teorico' | 'matematico' | 'mixto';

export interface AdaptiveSetup {
  knowledgeLevel: 'never_seen' | 'know_little' | 'want_review' | 'already_know';
  examDateType: 'today' | 'tomorrow' | 'this_week' | 'custom' | 'just_studying';
  examDateCustom?: string | null;
  targetScore: number;
  mainConcern: string;  // texto libre del usuario
  professorExamStyle: string[];
  evalPreference: 'quick_test' | 'write_explain' | 'mixed' | 'read_only';
  planView: 'book' | 'levels' | 'missions';
  completedAt: number;
}

export interface StudySession {
  id: string;
  temaId: string;
  enfoque: Enfoque;
  processMode: ProcessMode;
  studyMode: ProcessMode; // alias compat
  materialIds: string[];
  materialNames: string[];
  selectedPages: Record<string, number[]>;
  flashcards?: any[];
  adaptiveSetup?: AdaptiveSetup;
  setupHash?: string; // identidad única del setup — evita contaminación entre pruebas
  createdAt: number;
  lastOpenedAt: number;
}

const STORAGE_KEY = 'studyal_sessions_v4';

// ───────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────
// Hash estable del setup para identificar unívocamente cada configuración
// Dos setups con distintos valores producen hashes distintos
export function hashSetup(setup: AdaptiveSetup): string {
  const key = [
    setup.knowledgeLevel || '',
    setup.examDateType || '',
    setup.examDateCustom || '',
    String(setup.targetScore || 0),
    (setup.professorExamStyle || []).slice().sort().join(','),
    setup.evalPreference || '',
    setup.planView || '',
  ].join('|');
  // Hash simple y estable (djb2)
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}


function normalizeIds(ids: string[]): string {
  return [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))]
    .sort()
    .join(',');
}

function normalizeSession(raw: any): StudySession {
  const mode = (raw?.processMode || raw?.studyMode || 'free') as ProcessMode;
  return {
    id: String(raw?.id || ''),
    temaId: String(raw?.temaId || ''),
    enfoque: (raw?.enfoque || 'teorico') as Enfoque,
    processMode: mode,
    studyMode: mode,
    materialIds: Array.isArray(raw?.materialIds) ? raw.materialIds.map((x: any) => String(x || '').trim()).filter(Boolean) : [],
    materialNames: Array.isArray(raw?.materialNames) ? raw.materialNames.map((x: any) => String(x || '').trim()).filter(Boolean) : [],
    selectedPages: raw?.selectedPages && typeof raw.selectedPages === 'object' ? raw.selectedPages : {},
    flashcards: Array.isArray(raw?.flashcards) ? raw.flashcards : undefined,
    adaptiveSetup: raw?.adaptiveSetup || undefined,
    setupHash: raw?.setupHash || undefined,
    createdAt: Number(raw?.createdAt || Date.now()),
    lastOpenedAt: Number(raw?.lastOpenedAt || Date.now()),
  };
}

function loadAll(): Record<string, StudySession> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const normalized: Record<string, StudySession> = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      const sess = normalizeSession(value);
      if (sess.id) normalized[key] = sess;
    }
    return normalized;
  } catch {
    return {};
  }
}

function saveAll(sessions: Record<string, StudySession>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {}
}

// ───────────────────────────────────────────────────────────────
// reads
// ───────────────────────────────────────────────────────────────
export function getSessionsByTema(temaId: string): StudySession[] {
  const all = loadAll();
  return Object.values(all)
    .filter(s => s.temaId === temaId)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function getSessionById(sessionId: string): StudySession | null {
  const all = loadAll();
  return all[sessionId] || null;
}

export function findSession(
  temaId: string,
  materialIds: string[],
  processMode?: ProcessMode,
  setupHash?: string,
): StudySession | null {
  const sessions = getSessionsByTema(temaId);
  const matKey = normalizeIds(materialIds);

  const matches = sessions.filter(s => {
    const sameMaterials = normalizeIds(s.materialIds) === matKey;
    const sameMode = processMode ? s.processMode === processMode : true;
    // Si se pasa setupHash, filtrar estrictamente por él
    // Esto evita que un setup diferente contamine otro
    const sameSetup = setupHash ? s.setupHash === setupHash : true;
    return sameMaterials && sameMode && sameSetup;
  });

  return matches[0] || null;
}

export function getMaterialSessions(temaId: string, materialId: string): StudySession[] {
  const target = String(materialId || '').trim();
  return getSessionsByTema(temaId).filter(s =>
    s.materialIds.some(id => String(id || '').trim() === target),
  );
}

// ───────────────────────────────────────────────────────────────
// writes
// ───────────────────────────────────────────────────────────────
export function upsertSession(params: {
  temaId: string;
  enfoque: Enfoque;
  processMode: ProcessMode;
  materialIds: string[];
  materialNames?: string[];
  selectedPages?: Record<string, number[]>;
  flashcards?: any[];
  adaptiveSetup?: AdaptiveSetup;
  setupHash?: string;

  // aliases viejos / compat
  studyMode?: any;
  currentPhase?: any;
  notes?: any;
  materialText?: any;
  targetScore?: any;
  examDate?: any;
  examDateCustom?: any;
  materialBlueprint?: any;
  masterySnapshot?: any;
  processStyle?: any;
}): StudySession {
  const all = loadAll();
  const now = Date.now();

  const matIds = [...new Set(
    (params.materialIds || [])
      .map(id => String(id || '').trim())
      .filter(Boolean),
  )].slice(0, 5);

  const mode = (params.processMode || 'free') as ProcessMode;
  const existing = findSession(params.temaId, matIds, mode);

  if (existing) {
    const updated: StudySession = {
      ...existing,
      enfoque: params.enfoque ?? existing.enfoque,
      processMode: mode,
      studyMode: mode,
      materialNames: params.materialNames ?? existing.materialNames,
      selectedPages: params.selectedPages ?? existing.selectedPages,
      flashcards: params.flashcards ?? existing.flashcards,
      adaptiveSetup: params.adaptiveSetup ?? existing.adaptiveSetup,
      setupHash: params.setupHash ?? existing.setupHash,
      lastOpenedAt: now,
    };
    all[existing.id] = updated;
    saveAll(all);
    syncToServer(updated);
    return updated;
  }

  const id = 'sess_' + now.toString(36) + Math.random().toString(36).slice(2, 8);
  const session: StudySession = {
    id,
    temaId: params.temaId,
    enfoque: params.enfoque,
    processMode: mode,
    studyMode: mode,
    materialIds: matIds,
    materialNames: params.materialNames ?? [],
    selectedPages: params.selectedPages ?? {},
    flashcards: params.flashcards,
    adaptiveSetup: params.adaptiveSetup,
    setupHash: params.setupHash,
    createdAt: now,
    lastOpenedAt: now,
  };

  all[id] = session;
  saveAll(all);
  syncToServer(session);
  return session;
}

export function updateSessionPages(
  sessionId: string,
  selectedPages: Record<string, number[]>,
): void {
  const all = loadAll();
  if (!all[sessionId]) return;

  all[sessionId] = {
    ...all[sessionId],
    selectedPages,
    lastOpenedAt: Date.now(),
  };

  saveAll(all);
  syncToServer(all[sessionId]);
}

export function deleteSession(sessionId: string): void {
  const all = loadAll();
  delete all[sessionId];
  saveAll(all);
}

export function cleanupSessions(temaId: string, existingMaterialIds: string[]): void {
  const all = loadAll();
  const validSet = new Set((existingMaterialIds || []).filter(Boolean));
  if (validSet.size === 0) return;

  let changed = false;

  for (const [id, s] of Object.entries(all)) {
    if (s.temaId !== temaId) continue;

    const validMats = s.materialIds.filter(mid => validSet.has(mid));
    if (validMats.length === 0) {
      delete all[id];
      changed = true;
    } else if (validMats.length !== s.materialIds.length) {
      all[id] = {
        ...s,
        materialIds: validMats,
      };
      changed = true;
    }
  }

  if (changed) saveAll(all);
}

// ───────────────────────────────────────────────────────────────
// sync
// ───────────────────────────────────────────────────────────────
function syncToServer(session: StudySession): void {
  if (typeof window === 'undefined') return;
  // Enviar setupHash y adaptiveSetup al servidor para persistencia robusta
  fetch('/api/study-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...session,
      setupHash: session.setupHash,
      adaptiveSetup: session.adaptiveSetup,
    }),
  }).catch(() => {});
}

export async function syncSessionsFromServer(temaId?: string): Promise<StudySession[]> {
  if (typeof window === 'undefined') return [];

  try {
    const url = `/api/study-sessions${temaId ? `?temaId=${encodeURIComponent(temaId)}` : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();

    if (!res.ok || !json?.success || !Array.isArray(json.sessions)) {
      return temaId ? getSessionsByTema(temaId) : Object.values(loadAll());
    }

    const all = loadAll();

    for (const rawSess of json.sessions as any[]) {
      const sess = normalizeSession(rawSess);
      if (!sess?.id) continue;

      const local = all[sess.id];
      if (!local || Number(sess.lastOpenedAt || 0) >= Number(local.lastOpenedAt || 0)) {
        all[sess.id] = sess;
      }
    }

    saveAll(all);
    return temaId ? getSessionsByTema(temaId) : Object.values(loadAll());
  } catch {
    return temaId ? getSessionsByTema(temaId) : Object.values(loadAll());
  }
}
