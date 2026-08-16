// ═══════════════════════════════════════════════════════════════
// StudyAL — Sistema de sesiones v4
// Una sesión = temaId + materialIds (1-5) + processMode
// Persiste en localStorage + sync servidor
// ═══════════════════════════════════════════════════════════════

export type ProcessMode = 'free' | 'adaptive' | 'manual';
export type Enfoque = 'teorico' | 'matematico' | 'mixto';
export type AdaptiveLifecycleState =
  | 'draft'
  | 'setup_complete'
  | 'generating'
  | 'ready'
  | 'studying'
  | 'completed'
  | 'error';
import { migrateJourneySessionKinds } from './adaptive/sessionKind';
import { buildSourceSelectionSnapshot } from './adaptive/sourceSelection';
import type { PersistedProgramLookup } from './adaptive/programRestore';
import { freeNavDebug } from './debug/freeNavDebug';

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
  userId?: string;
  temaId: string;
  enfoque: Enfoque;
  processMode: ProcessMode;
  studyMode: ProcessMode; // alias compat
  materialIds: string[];
  primaryMaterialId?: string;
  masteryMaterialKey?: string;
  materialNames: string[];
  selectedPages: Record<string, number[]>;
  sourceSelectionFingerprint?: string;
  flashcards?: any[];
  notes?: Record<string, any>;
  adaptiveSetup?: AdaptiveSetup;
  setupHash?: string; // identidad única del setup — evita contaminación entre pruebas
  blueprint?: any; // análisis completo del material
  journey?: any; // plan de aprendizaje (learning journey)
  sessionPreparation?: Record<string, unknown>;
  currentSessionNumber?: number;
  currentStep?: number;
  completedSessionNumbers?: number[];
  status?: 'not_started' | 'in_progress' | 'completed';
  adaptiveState?: AdaptiveLifecycleState;
  replaySessionNumber?: number;
  replayAttempt?: number;
  sessionContent?: Record<string, any>;
  recoveryQueues?: Record<string, unknown[]>;
  isProgramComplete?: boolean;
  unresolvedMicroIds?: string[];
  activeStudyMs?: number;
  breakHoursAcknowledged?: number;
  createdAt: number;
  updatedAt?: number;
  lastOpenedAt: number;
}

const STORAGE_KEY = 'studyal_sessions_v4';
const ADAPTIVE_ARTIFACTS_KEY = 'studyal_adaptive_artifacts_v1';
const lastPersistedHash = new Map<string, string>();
const pendingPersistence = new Map<string, { session: StudySession; timer: ReturnType<typeof setTimeout> }>();
const singleWriteInFlight = new Map<string, Promise<void>>();

// ───────────────────────────────────────────────────────────────
// authority contract (P0 — localStorage quota exhaustion redesign)
//
// SERVER = durable authority (survives everything, cross-device).
// MEMORY (memoryCache below) = active session state for this runtime —
// the ONLY thing every read/write in this module actually operates on.
// LOCALSTORAGE = best-effort cache to survive a page reload — writing to
// it can fail (quota) without that ever being visible to the session
// itself: a failed localStorage write must never look like "the session
// doesn't exist" to findSession/getSessionById/upsertSession.
//
// memoryCache is hydrated ONCE per runtime from localStorage (loadAll),
// then returned BY REFERENCE on every subsequent call — every write
// function already mutates the object returned by loadAll() in place
// (`all[id] = updated`), so as of this change those mutations are
// immediately visible to every other reader in this tab regardless of
// whether the best-effort localStorage write that follows succeeds.
let memoryCache: Record<string, StudySession> | null = null;
// Circuit breaker: once localStorage has failed a pruned retry, stop
// attempting further writes for the rest of this runtime — memory +
// server remain fully functional; we just stop paying the cost (and the
// console noise) of a quota that pruning already proved won't clear.
let localStorageWriteDisabled = false;

function isQuotaExceededError(error: unknown): boolean {
  // Duck-typed on purpose (not `instanceof DOMException`): real browsers,
  // Node's DOMException, and test doubles that simulate quota exhaustion
  // all agree on `.name`/`.code`, but aren't guaranteed to share a class.
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const code = (error as { code?: unknown }).code;
  return name === 'QuotaExceededError'
    || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || code === 22
    || code === 1014;
}

// Only affects what gets WRITTEN to the localStorage cache — never the
// live memoryCache object, never the server. Priority to keep: sessions
// with an unsynced write in flight (server doesn't have the latest yet),
// then the most recently opened sessions (the active session always has
// the freshest lastOpenedAt, so it is always kept first).
function pruneSessionsForQuota(sessions: Record<string, StudySession>): Record<string, StudySession> {
  const entries = Object.entries(sessions);
  const unsyncedIds = new Set(
    entries
      .map(([id]) => id)
      .filter(id => pendingPersistence.has(id) || singleWriteInFlight.has(id)),
  );
  const unsynced = entries.filter(([id]) => unsyncedIds.has(id));
  const rest = entries
    .filter(([id]) => !unsyncedIds.has(id))
    .sort((a, b) => Number(b[1].lastOpenedAt || 0) - Number(a[1].lastOpenedAt || 0));
  const KEEP_MOST_RECENT = 5;
  return Object.fromEntries([...unsynced, ...rest.slice(0, KEEP_MOST_RECENT)]);
}

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

function mergeSessionNotes(localNotes: Record<string, any> = {}, serverNotes: Record<string, any> = {}) {
  const localTools = localNotes.freeTools || {};
  const serverTools = serverNotes.freeTools || {};
  const freeTools: Record<string, any> = {};
  for (const tool of new Set([...Object.keys(localTools), ...Object.keys(serverTools)])) {
    const local = localTools[tool];
    const server = serverTools[tool];
    freeTools[tool] = Number(server?.revision || 0) >= Number(local?.revision || 0) ? server : local;
  }
  return {
    ...localNotes,
    ...serverNotes,
    freeTools,
  };
}

function normalizeSession(raw: any): StudySession {
  const mode = (raw?.processMode || raw?.studyMode || raw?.process_mode || raw?.study_mode || 'free') as ProcessMode;
  const rawJourney = raw?.journey || raw?.adaptiveProgram || raw?.adaptive_program || undefined;
  let journey = rawJourney;
  let sessionKindMigrationError = false;
  if (rawJourney?.chapters) {
    try {
      journey = migrateJourneySessionKinds(rawJourney, (event, payload) => {
        console.info('[adaptive-session-kind]', JSON.stringify({ event, ...payload }))
      }, { materialId: raw?.primaryMaterialId || raw?.primary_material_id || raw?.materialIds?.[0] || raw?.material_ids?.[0] }).journey;
    } catch (error) {
      sessionKindMigrationError = true;
      console.error('[adaptive-session-kind]', JSON.stringify({
        event: 'session_kind_resolution_failed',
        planId: rawJourney?.id || null,
        materialId: raw?.primaryMaterialId || raw?.primary_material_id || null,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  const resumeState = journey?.resumeState && typeof journey.resumeState === 'object'
    ? journey.resumeState
    : {};
  const sourceSelection = buildSourceSelectionSnapshot(
    Array.isArray(raw?.materialIds) ? raw.materialIds : raw?.material_ids,
    raw?.selectedPages && typeof raw.selectedPages === 'object' ? raw.selectedPages : raw?.selected_pages,
  );
  return {
    id: String(raw?.id || ''),
    userId: raw?.userId || raw?.user_id || undefined,
    temaId: String(raw?.temaId || raw?.tema_id || ''),
    enfoque: (raw?.enfoque || 'teorico') as Enfoque,
    processMode: mode,
    studyMode: mode,
    materialIds: sourceSelection.materialIds,
    primaryMaterialId: String(
      raw?.primaryMaterialId
      || raw?.primary_material_id
      || raw?.materialId
      || raw?.material_id
      || raw?.materialIds?.[0]
      || raw?.material_ids?.[0]
      || '',
    ).trim() || undefined,
    masteryMaterialKey: String(raw?.masteryMaterialKey || raw?.mastery_material_key || '').trim() || undefined,
    materialNames: Array.isArray(raw?.materialNames)
      ? raw.materialNames.map((x: any) => String(x || '').trim()).filter(Boolean)
      : Array.isArray(raw?.material_names)
        ? raw.material_names.map((x: any) => String(x || '').trim()).filter(Boolean)
        : [],
    selectedPages: sourceSelection.selectedPages,
    sourceSelectionFingerprint: sourceSelection.fingerprint,
    flashcards: Array.isArray(raw?.flashcards) ? raw.flashcards : undefined,
    notes: raw?.notes && typeof raw.notes === 'object' ? raw.notes : undefined,
    adaptiveSetup: raw?.adaptiveSetup || raw?.adaptive_setup || undefined,
    setupHash: raw?.setupHash || raw?.setup_hash || undefined,
    blueprint: raw?.blueprint || raw?.materialBlueprint || raw?.material_blueprint || undefined,
    journey,
    sessionPreparation: raw?.sessionPreparation || raw?.session_preparation || undefined,
    currentSessionNumber: Number(
      raw?.currentSessionNumber
      || raw?.current_session_number
      || resumeState.currentSessionNumber
      || 0,
    ) || undefined,
    currentStep: Number(raw?.currentStep ?? raw?.current_step ?? resumeState.currentStep ?? 0),
    completedSessionNumbers: Array.isArray(raw?.completedSessionNumbers)
      ? raw.completedSessionNumbers.map(Number).filter(Number.isFinite)
      : Array.isArray(raw?.completed_session_numbers)
        ? raw.completed_session_numbers.map(Number).filter(Number.isFinite)
        : Array.isArray(resumeState.completedSessionNumbers)
          ? resumeState.completedSessionNumbers.map(Number).filter(Number.isFinite)
          : undefined,
    status: raw?.status || resumeState.status || undefined,
    adaptiveState: sessionKindMigrationError ? 'error' : raw?.adaptiveState || raw?.adaptive_state || resumeState.adaptiveState || undefined,
    replaySessionNumber: Number(
      raw?.replaySessionNumber
      || raw?.replay_session_number
      || resumeState.replaySessionNumber
      || 0,
    ) || undefined,
    replayAttempt: Number(raw?.replayAttempt || raw?.replay_attempt || resumeState.replayAttempt || 0) || undefined,
    sessionContent:
      raw?.sessionContent && typeof raw.sessionContent === 'object'
        ? raw.sessionContent
        : raw?.session_content && typeof raw.session_content === 'object'
          ? raw.session_content
          : resumeState.sessionContent && typeof resumeState.sessionContent === 'object'
            ? resumeState.sessionContent
            : undefined,
    recoveryQueues:
      raw?.recoveryQueues && typeof raw.recoveryQueues === 'object'
        ? raw.recoveryQueues
        : raw?.recovery_queues && typeof raw.recovery_queues === 'object'
          ? raw.recovery_queues
          : resumeState.recoveryQueues && typeof resumeState.recoveryQueues === 'object'
            ? resumeState.recoveryQueues
            : undefined,
    isProgramComplete: raw?.isProgramComplete === true
      || raw?.is_program_complete === true
      || resumeState.isProgramComplete === true,
    unresolvedMicroIds: Array.isArray(raw?.unresolvedMicroIds)
      ? raw.unresolvedMicroIds.map(String).filter(Boolean)
      : Array.isArray(raw?.unresolved_micro_ids)
        ? raw.unresolved_micro_ids.map(String).filter(Boolean)
        : Array.isArray(resumeState.unresolvedMicroIds)
          ? resumeState.unresolvedMicroIds.map(String).filter(Boolean)
          : undefined,
    activeStudyMs: Math.max(0, Number(raw?.activeStudyMs ?? raw?.active_study_ms ?? resumeState.activeStudyMs ?? 0) || 0),
    breakHoursAcknowledged: Math.max(0, Number(raw?.breakHoursAcknowledged ?? raw?.break_hours_acknowledged ?? resumeState.breakHoursAcknowledged ?? 0) || 0),
    createdAt: Number(raw?.createdAt || raw?.created_at || Date.now()),
    updatedAt: Number(raw?.updatedAt || raw?.updated_at || 0) || undefined,
    lastOpenedAt: Number(raw?.lastOpenedAt || raw?.last_opened_at || Date.now()),
  };
}
function loadAll(): Record<string, StudySession> {
  // memoryCache is authoritative for this runtime once hydrated — every
  // write mutates it in place, so this never needs to re-read localStorage
  // (which may be stale, quota-broken, or simply behind an in-flight write)
  // to see the latest state.
  if (memoryCache) return memoryCache;
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return (memoryCache = {});
    const parsed = JSON.parse(raw);
    let artifacts: Record<string, {
      blueprint?: unknown;
      journey?: unknown;
      sessionContent?: unknown;
    }> = {};
    try {
      const artifactRaw = localStorage.getItem(ADAPTIVE_ARTIFACTS_KEY);
      if (artifactRaw) artifacts = JSON.parse(artifactRaw) || {};
    } catch (artifactError) {
      // AUDITORÍA DE CICLO DE VIDA (verificación focalizada, punto 4): degradar a
      // artifacts={} sigue siendo lo correcto (blueprint/journey/sessionContent
      // corruptos localmente se recuperan vía server backfill en loadContext),
      // pero antes no dejaba ningún rastro de que la degradación ocurrió.
      console.error('[study-sessions] adaptive_artifacts_parse_failed', JSON.stringify({
        message: artifactError instanceof Error ? artifactError.message : String(artifactError),
      }))
    }
    const normalized: Record<string, StudySession> = {};
    for (const [key, value] of Object.entries(parsed || {})) {
      const artifact = artifacts[key];
      const rawValue = value as Record<string, unknown>;
      // CRITICAL: si value.blueprint es null/undefined pero artifact lo tiene, usar artifact
      // Esto evita que syncs parciales borren blueprints válidos
      const mergedValue = artifact && typeof artifact === 'object'
        ? {
            ...rawValue,
            blueprint: rawValue.blueprint ?? artifact.blueprint,
            journey: rawValue.journey ?? artifact.journey,
            sessionContent: rawValue.sessionContent ?? artifact.sessionContent,
          }
        : rawValue;
      const sess = normalizeSession(mergedValue);
      if (sess.id) normalized[key] = sess;
    }
    return (memoryCache = normalized);
  } catch (loadAllError) {
    // AUDITORÍA DE CICLO DE VIDA (verificación focalizada, punto 4): perder TODAS
    // las sesiones locales es el fallo más severo de esta función — antes no
    // dejaba ningún diagnóstico, indistinguible de "el usuario nunca tuvo
    // sesiones".
    console.error('[study-sessions] loadAll_failed', JSON.stringify({
      message: loadAllError instanceof Error ? loadAllError.message : String(loadAllError),
    }))
    return (memoryCache = {});
  }
}

function buildLightSessions(sessions: Record<string, StudySession>): Record<string, any> {
  const lightSessions: Record<string, any> = {};
  for (const [key, session] of Object.entries(sessions)) {
    lightSessions[key] = {
      ...session,
      blueprint: undefined,
      journey: undefined,
      sessionContent: undefined,
    };
  }
  return lightSessions;
}

// Best-effort cache write. The session itself already lives in memoryCache
// (mutated in place by the caller before this runs) and is being persisted
// to the server via syncToServer — this function's only job is to keep
// localStorage warm for a fast reload, and it must never be allowed to make
// a session look lost. On quota exhaustion: prune obsolete entries from the
// CACHE PAYLOAD ONLY (never memoryCache, never the server) and retry once;
// if that still doesn't fit, stop trying for the rest of this runtime.
function saveAll(sessions: Record<string, StudySession>) {
  if (typeof window === 'undefined') return;
  if (localStorageWriteDisabled) return;

  let previousArtifacts: Record<string, { sessionContent?: Record<string, any> }> = {};
  try { previousArtifacts = JSON.parse(localStorage.getItem(ADAPTIVE_ARTIFACTS_KEY) || '{}') || {}; } catch { previousArtifacts = {}; }

  const writeSessionsKey = (payload: Record<string, StudySession>): true | unknown => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildLightSessions(payload)));
      return true;
    } catch (error) {
      return error;
    }
  };

  let result = writeSessionsKey(sessions);
  if (result !== true && isQuotaExceededError(result)) {
    console.warn('[study-sessions] saveAll_quota_exceeded_pruning', JSON.stringify({
      totalSessions: Object.keys(sessions).length,
    }));
    result = writeSessionsKey(pruneSessionsForQuota(sessions));
    if (result !== true) {
      localStorageWriteDisabled = true;
      console.error('[study-sessions] saveAll_disabled_local_cache', JSON.stringify({
        reason: 'quota_exceeded_after_pruned_retry',
        message: 'Disabling local StudySession cache for this runtime; continuing with memory + server authority.',
      }));
      return;
    }
  } else if (result !== true) {
    // AUDITORÍA DE CICLO DE VIDA (verificación focalizada, punto 4): un fallo aquí
    // (no-cuota) descarta silenciosamente la escritura local — el próximo
    // syncToServer seguirá intentando persistir al servidor igual, pero antes
    // no había ningún rastro de que la copia local se perdió.
    console.error('[study-sessions] saveAll_failed', JSON.stringify({
      message: result instanceof Error ? result.message : String(result),
    }))
    return;
  }

  try {
    const adaptiveArtifacts = Object.fromEntries(
      Object.entries(sessions)
        .filter(([, session]) =>
          session.processMode === 'adaptive'
          && Boolean(session.blueprint || session.journey || session.sessionContent),
        )
        .map(([key, session]) => [key, {
          blueprint: session.blueprint,
          journey: session.journey,
          // Un callback async puede terminar con un snapshot anterior al de
          // otra navegación/prefetch. Merge por número de sesión evita que
          // guardar N+1 borre un checkpoint N ya válido. Un valor `undefined`
          // explícito sigue pudiendo invalidar solo su propia clave.
          sessionContent: {
            ...(previousArtifacts[key]?.sessionContent || {}),
            ...Object.fromEntries(Object.entries(session.sessionContent || {}).filter(([, value]) => value !== undefined)),
          },
        }]),
    );
    localStorage.setItem(ADAPTIVE_ARTIFACTS_KEY, JSON.stringify(adaptiveArtifacts));
  } catch (artifactsError) {
    // Adaptive artifacts are a separate, lower-priority cache key (Free
    // Mode's freeTools data lives in STORAGE_KEY above, already handled).
    // A quota failure here does not warrant tripping the same circuit
    // breaker — Adaptive already has its own server-durable persistence.
    if (!isQuotaExceededError(artifactsError)) {
      console.error('[study-sessions] saveAll_artifacts_failed', JSON.stringify({
        message: artifactsError instanceof Error ? artifactsError.message : String(artifactsError),
      }))
    }
  }
}

export function persistableSnapshot(session: StudySession): Record<string, unknown> {
  return {
    id: session.id,
    userId: session.userId,
    temaId: session.temaId,
    processMode: session.processMode,
    materialIds: session.materialIds,
    selectedPages: session.selectedPages,
    sourceSelectionFingerprint: session.sourceSelectionFingerprint,
    notes: session.notes,
    adaptiveSetup: session.adaptiveSetup,
    setupHash: session.setupHash,
    blueprint: session.blueprint,
    journey: session.journey,
    sessionPreparation: session.sessionPreparation,
    currentSessionNumber: session.currentSessionNumber,
    currentStep: session.currentStep,
    completedSessionNumbers: session.completedSessionNumbers,
    status: session.status,
    adaptiveState: session.adaptiveState,
    replaySessionNumber: session.replaySessionNumber,
    replayAttempt: session.replayAttempt,
    sessionContent: session.sessionContent,
    recoveryQueues: session.recoveryQueues,
    isProgramComplete: session.isProgramComplete,
    unresolvedMicroIds: session.unresolvedMicroIds,
    activeStudyMs: session.activeStudyMs,
    breakHoursAcknowledged: session.breakHoursAcknowledged,
  };
}

export function snapshotHash(snapshot: Record<string, unknown>): string {
  const serialized = JSON.stringify(snapshot);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
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
  sourceFingerprint?: string,
): StudySession | null {
  const sessions = getSessionsByTema(temaId);
  const matKey = normalizeIds(materialIds);

  const matches = sessions.filter(s => {
    const sameMaterials = normalizeIds(s.materialIds) === matKey;
    const sameMode = processMode ? s.processMode === processMode : true;
    // Si se pasa setupHash, filtrar estrictamente por él
    // Esto evita que un setup diferente contamine otro
    const sameSetup = setupHash ? s.setupHash === setupHash : true;
    const sameSource = sourceFingerprint ? s.sourceSelectionFingerprint === sourceFingerprint : true;
    return sameMaterials && sameMode && sameSetup && sameSource;
  });

  return matches[0] || null;
}

export function selectSessionForSource(
  sessions: StudySession[],
  params: {
    materialIds: string[];
    processMode?: ProcessMode | null;
    sourceSelectionFingerprint?: string | null;
  },
): StudySession | null {
  const materialKey = normalizeIds(params.materialIds)
  const candidates = [...sessions]
    .filter(session => normalizeIds(session.materialIds) === materialKey)
    .filter(session => !params.processMode || session.processMode === params.processMode)
  const exactCandidates = params.sourceSelectionFingerprint
    ? candidates.filter(session => session.sourceSelectionFingerprint === params.sourceSelectionFingerprint)
    : candidates

  if (!params.sourceSelectionFingerprint) {
    const sourceIdentities = new Set(exactCandidates.map(session => session.sourceSelectionFingerprint || 'legacy:unknown'))
    const modes = new Set(exactCandidates.map(session => session.processMode))
    if (sourceIdentities.size > 1 || (!params.processMode && modes.size > 1)) return null
  }

  return exactCandidates
    .sort((left, right) => Number(right.lastOpenedAt || 0) - Number(left.lastOpenedAt || 0))[0] || null
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
  id?: string;
  userId?: string;
  temaId: string;
  enfoque: Enfoque;
  processMode: ProcessMode;
  materialIds: string[];
  primaryMaterialId?: string;
  masteryMaterialKey?: string;
  materialNames?: string[];
  selectedPages?: Record<string, number[]>;
  sourceSelectionFingerprint?: string;
  flashcards?: any[];
  adaptiveSetup?: AdaptiveSetup;
  setupHash?: string;
  blueprint?: any;
  journey?: any;
  currentSessionNumber?: number;
  currentStep?: number;
  completedSessionNumbers?: number[];
  status?: 'not_started' | 'in_progress' | 'completed';
  adaptiveState?: AdaptiveLifecycleState;
  replaySessionNumber?: number;
  replayAttempt?: number;
  sessionContent?: Record<string, any>;
  recoveryQueues?: Record<string, unknown[]>;
  isProgramComplete?: boolean;
  unresolvedMicroIds?: string[];
  activeStudyMs?: number;
  breakHoursAcknowledged?: number;
  createdAt?: number;
  updatedAt?: number;
  lastOpenedAt?: number;

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
  sessionId?: string;
  debugCaller?: string;
}): StudySession {
  const all = loadAll();
  const now = Date.now();

  const sourceSelection = buildSourceSelectionSnapshot(params.materialIds, params.selectedPages || {});
  const matIds = sourceSelection.materialIds;

  const mode = (params.processMode || 'free') as ProcessMode;
  const explicitSessionId = String((params as any).sessionId || '').trim();
  // FIX P0: siempre exigir match exacto de sourceSelectionFingerprint al
  // reutilizar una sesión existente — nunca "params.selectedPages ausente =
  // no filtrar por fingerprint". sourceSelection ya se computa arriba desde
  // params.selectedPages || {} (whole-document = fingerprint canónico de []),
  // así que esto es seguro para whole-document Y para selección explícita.
  // Antes, omitir selectedPages (el caso real de "documento completo" en
  // varios call-sites de TemaView) hacía que findSession() ignorara el
  // fingerprint por completo y reutilizara/fusionara CUALQUIER sesión
  // existente para el mismo material — aunque tuviera una selección de
  // páginas explícita distinta — corrompiendo la identidad de sesión.
  const viaExplicitId = Boolean(explicitSessionId && all[explicitSessionId]);
  const existing = viaExplicitId
    ? all[explicitSessionId]
    : findSession(params.temaId, matIds, mode, params.setupHash, sourceSelection.fingerprint);

  freeNavDebug('SESSION_UPSERT', {
    caller: params.debugCaller || 'unknown',
    outcome: existing ? (viaExplicitId ? 'FOUND_VIA_EXPLICIT_ID' : 'FOUND_VIA_FINGERPRINT') : 'CREATE_NEW',
    resolvedSessionId: existing?.id || null,
    explicitSessionId: explicitSessionId || null,
    temaId: params.temaId,
    processMode: mode,
    materialIds: matIds,
    selectedPages: sourceSelection.selectedPages,
    fingerprint: sourceSelection.fingerprint,
    candidatesForTema: getSessionsByTema(params.temaId).map(s => ({ id: s.id, materialIds: s.materialIds, fingerprint: s.sourceSelectionFingerprint, processMode: s.processMode })),
  });

  if (existing) {
    const updated: StudySession = {
      ...existing,
      userId: params.userId ?? existing.userId,
      enfoque: params.enfoque ?? existing.enfoque,
      processMode: mode,
      studyMode: mode,
      materialIds: matIds.length ? matIds : existing.materialIds,
      primaryMaterialId: params.primaryMaterialId ?? existing.primaryMaterialId ?? matIds[0],
      masteryMaterialKey: params.masteryMaterialKey ?? existing.masteryMaterialKey,
      materialNames: params.materialNames ?? existing.materialNames,
      selectedPages: params.selectedPages ? sourceSelection.selectedPages : existing.selectedPages,
      sourceSelectionFingerprint: params.selectedPages
        ? sourceSelection.fingerprint
        : existing.sourceSelectionFingerprint,
      flashcards: params.flashcards ?? existing.flashcards,
      notes: params.notes ?? existing.notes,
      adaptiveSetup: params.adaptiveSetup ?? existing.adaptiveSetup,
      setupHash: params.setupHash ?? existing.setupHash,
      blueprint: params.blueprint ?? existing.blueprint,
      journey: params.journey ?? existing.journey,
      currentSessionNumber: params.currentSessionNumber ?? existing.currentSessionNumber,
      currentStep: params.currentStep ?? existing.currentStep,
      completedSessionNumbers: params.completedSessionNumbers ?? existing.completedSessionNumbers,
      status: params.status ?? existing.status,
      adaptiveState: params.adaptiveState ?? existing.adaptiveState,
      replaySessionNumber: params.replaySessionNumber ?? existing.replaySessionNumber,
      replayAttempt: params.replayAttempt ?? existing.replayAttempt,
      sessionContent: params.sessionContent ?? existing.sessionContent,
      recoveryQueues: params.recoveryQueues ?? existing.recoveryQueues,
      // isProgramComplete NUNCA se acepta como parámetro arbitrario aquí — la única
      // autoridad es completeAdaptiveSession (deriveIsProgramComplete). Este upsert
      // genérico solo puede preservar el valor ya existente, nunca fijar uno nuevo.
      isProgramComplete: existing.isProgramComplete,
      unresolvedMicroIds: params.unresolvedMicroIds ?? existing.unresolvedMicroIds,
      activeStudyMs: params.activeStudyMs ?? existing.activeStudyMs,
      breakHoursAcknowledged: params.breakHoursAcknowledged ?? existing.breakHoursAcknowledged,
      updatedAt: now,
      lastOpenedAt: now,
    };
    all[existing.id] = updated;
    saveAll(all);
    syncToServer(updated);
    return updated;
  }

  const id = params.id || 'sess_' + now.toString(36) + Math.random().toString(36).slice(2, 8);
  const session: StudySession = {
    id,
    userId: params.userId,
    temaId: params.temaId,
    enfoque: params.enfoque,
    processMode: mode,
    studyMode: mode,
    materialIds: matIds,
    primaryMaterialId: params.primaryMaterialId || matIds[0],
    masteryMaterialKey: params.masteryMaterialKey,
    materialNames: params.materialNames ?? [],
    selectedPages: sourceSelection.selectedPages,
    sourceSelectionFingerprint: sourceSelection.fingerprint,
    flashcards: params.flashcards,
    notes: params.notes,
    adaptiveSetup: params.adaptiveSetup,
    setupHash: params.setupHash,
    blueprint: params.blueprint || undefined,
    journey: params.journey || undefined,
    currentSessionNumber: params.currentSessionNumber,
    currentStep: params.currentStep ?? 0,
    completedSessionNumbers: params.completedSessionNumbers || [],
    status: params.status || 'not_started',
    adaptiveState: params.adaptiveState || (params.adaptiveSetup?.completedAt ? 'setup_complete' : 'draft'),
    replaySessionNumber: params.replaySessionNumber,
    replayAttempt: params.replayAttempt,
    sessionContent: params.sessionContent,
    recoveryQueues: params.recoveryQueues,
    // Una sesión recién creada nunca puede nacer ya "completa" — misma razón que arriba.
    isProgramComplete: false,
    unresolvedMicroIds: params.unresolvedMicroIds,
    activeStudyMs: params.activeStudyMs || 0,
    breakHoursAcknowledged: params.breakHoursAcknowledged || 0,
    createdAt: params.createdAt || now,
    updatedAt: now,
    lastOpenedAt: now,
  };

  all[id] = session;
  saveAll(all);
  syncToServer(session);
  return session;
}

export function updateSessionById(
  sessionId: string,
  updater: (session: StudySession) => StudySession,
): StudySession | null {
  const all = loadAll();
  const existing = all[sessionId];
  if (!existing) return null;
  const now = Date.now();
  const updated = normalizeSession({
    ...updater(existing),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now,
    lastOpenedAt: now,
  });
  all[sessionId] = updated;
  saveAll(all);
  syncToServer(updated);
  return updated;
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
      freeNavDebug('CLEANUP_SESSIONS_DELETE', {
        sessionId: id,
        sessionMaterialIds: s.materialIds,
        existingMaterialIds,
        temaId,
      });
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
export function syncToServer(session: StudySession): void {
  if (typeof window === 'undefined') return;
  const hash = snapshotHash(persistableSnapshot(session));
  if (lastPersistedHash.get(session.id) === hash) return;
  const existingPending = pendingPersistence.get(session.id);
  if (existingPending) clearTimeout(existingPending.timer);
  const timer = setTimeout(() => {
    pendingPersistence.delete(session.id);
    const latestHash = snapshotHash(persistableSnapshot(session));
    if (lastPersistedHash.get(session.id) === latestHash) return;
    const write = async () => {
      await postSessionSnapshot(session, latestHash);
    };
    const previous = singleWriteInFlight.get(session.id) || Promise.resolve();
    const current = previous.catch(() => undefined).then(write).catch((writeError) => {
      console.error('[study-sessions] syncToServer_write_failed', JSON.stringify({
        sessionId: session.id,
        message: writeError instanceof Error ? writeError.message : String(writeError),
      }))
      return undefined
    });
    singleWriteInFlight.set(session.id, current);
    void current.finally(() => {
      if (singleWriteInFlight.get(session.id) === current) singleWriteInFlight.delete(session.id);
    });
  }, 150);
  pendingPersistence.set(session.id, { session, timer });
}

function adaptiveProgramSnapshot(session: StudySession): any {
  return session.journey
    ? {
        ...session.journey,
        resumeState: {
          currentSessionNumber: session.currentSessionNumber,
          currentStep: session.currentStep ?? 0,
          completedSessionNumbers: session.completedSessionNumbers || [],
          status: session.status || 'not_started',
          adaptiveState: session.adaptiveState || (session.adaptiveSetup?.completedAt ? 'setup_complete' : 'draft'),
          replaySessionNumber: session.replaySessionNumber,
          replayAttempt: session.replayAttempt || 0,
          sessionContent: session.sessionContent || {},
          sessionPreparation: session.sessionPreparation || {},
          recoveryQueues: session.recoveryQueues || {},
          isProgramComplete: session.isProgramComplete === true,
          unresolvedMicroIds: session.unresolvedMicroIds || [],
          activeStudyMs: session.activeStudyMs || 0,
          breakHoursAcknowledged: session.breakHoursAcknowledged || 0,
        },
      }
    : null;
}

async function postSessionSnapshot(session: StudySession, expectedHash: string): Promise<void> {
      const adaptiveProgram = adaptiveProgramSnapshot(session);
      console.info('[adaptive-program-persist]', JSON.stringify({
        event: 'program_commit_requested', programId: session.id,
        journeyId: session.journey?.id || null,
        blueprintPresent: Boolean(session.blueprint), journeyPresent: Boolean(session.journey),
        sourceSelection: { materialIds: session.materialIds, selectedPages: session.selectedPages },
        sourceSelectionFingerprint: session.sourceSelectionFingerprint || null,
        sessionPreparationKeys: Object.keys(session.sessionPreparation || {}),
        sessionContentKeys: Object.keys(session.sessionContent || {}),
        currentSessionNumber: session.currentSessionNumber || null,
        status: session.status || null,
      }));
      const response = await fetch('/api/study-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...session,
          setupHash: session.setupHash,
          adaptiveSetup: session.adaptiveSetup,
          // Enviar blueprint y journey con múltiples nombres para compatibilidad
          blueprint: session.blueprint || null,
          materialBlueprint: session.blueprint || null,
          journey: adaptiveProgram,
          adaptiveProgram,
        }),
      });
      // AUDITORÍA (StudyAL_Visual_System_Stress_Test, Bug 1, hallazgo Codex A):
      // la respuesta del POST nunca se comprobaba — un 401/413/500 (fetch NO
      // rechaza la promesa por status HTTP, solo por fallo de red) se trataba
      // como persistencia exitosa: lastPersistedHash se fijaba igual, así que
      // el próximo intento con el MISMO snapshot quedaba deduplicado para
      // siempre (nunca se reintentaba) — blueprint/journey podían quedar sin
      // persistir en el servidor de forma silenciosa e irrecuperable. Ahora un
      // rechazo lanza (el catch ya existente de abajo lo loguea) y
      // lastPersistedHash NO se marca, así que el siguiente syncToServer con
      // ese mismo snapshot vuelve a intentarlo.
      let ok = response.ok
      if (ok) {
        try {
          const parsed = await response.clone().json()
          if (parsed && parsed.success === false) ok = false
        } catch {
          // Cuerpo no-JSON con status 2xx: no penalizar — algunos caminos
          // legacy del Worker pueden responder sin json parseable.
        }
      }
      if (!ok) {
        throw new Error(`STUDY_SESSIONS_PERSIST_REJECTED:status=${response.status}`)
      }
      lastPersistedHash.set(session.id, expectedHash);
}

export async function persistSessionDurably(sessionId: string): Promise<StudySession> {
  const pending = pendingPersistence.get(sessionId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingPersistence.delete(sessionId);
  }
  const session = getSessionById(sessionId);
  if (!session) throw new Error('PROGRAM_COMMIT_SESSION_NOT_FOUND');
  const expectedHash = snapshotHash(persistableSnapshot(session));
  const previous = singleWriteInFlight.get(sessionId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(() => postSessionSnapshot(session, expectedHash));
  singleWriteInFlight.set(sessionId, current);
  try {
    await current;
  } finally {
    if (singleWriteInFlight.get(sessionId) === current) singleWriteInFlight.delete(sessionId);
  }
  return session;
}

export async function lookupSessionsFromServer(temaId?: string, sessionId?: string): Promise<PersistedProgramLookup<StudySession>> {
  if (typeof window === 'undefined') return { status: 'ERROR', sessions: [], error: 'CLIENT_ONLY_LOOKUP' };

  try {
    const params = new URLSearchParams();
    if (temaId) params.set('temaId', temaId);
    if (sessionId) params.set('sessionId', sessionId);
    const url = `/api/study-sessions${params.size ? `?${params.toString()}` : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();

    if (!res.ok || !json?.success || !Array.isArray(json.sessions)) {
      return {
        status: 'ERROR',
        sessions: sessionId
          ? [getSessionById(sessionId)].filter(Boolean) as StudySession[]
          : temaId ? getSessionsByTema(temaId) : Object.values(loadAll()),
        error: `DURABLE_LOOKUP_REJECTED:status=${res.status}`,
      };
    }

    const all = loadAll();

    for (const rawSess of json.sessions as any[]) {
      const sess = normalizeSession(rawSess);
      // CRITICAL: nunca dejar que el servidor sobreescriba con null/undefined
      // campos que tienen valor local (evita borrado por syncs parciales)
      const localExisting = all[sess.id];
      if (localExisting) {
        if (!sess.adaptiveSetup && localExisting.adaptiveSetup) sess.adaptiveSetup = localExisting.adaptiveSetup;
        if (!sess.setupHash && localExisting.setupHash) sess.setupHash = localExisting.setupHash;
        if (!sess.blueprint && localExisting.blueprint) sess.blueprint = localExisting.blueprint;
        if (!sess.journey && localExisting.journey) sess.journey = localExisting.journey;
        sess.sessionContent = {
          ...(localExisting.sessionContent || {}),
          ...(sess.sessionContent || {}),
        };
        sess.sessionPreparation = {
          ...(localExisting.sessionPreparation || {}),
          ...(sess.sessionPreparation || {}),
        };
        sess.recoveryQueues = {
          ...(localExisting.recoveryQueues || {}),
          ...(sess.recoveryQueues || {}),
        };
        if (!sess.activeStudyMs && localExisting.activeStudyMs) sess.activeStudyMs = localExisting.activeStudyMs;
        if (!sess.breakHoursAcknowledged && localExisting.breakHoursAcknowledged) {
          sess.breakHoursAcknowledged = localExisting.breakHoursAcknowledged;
        }
        sess.notes = mergeSessionNotes(localExisting.notes, sess.notes);
      }
      if (!sess?.id) continue;

      const local = all[sess.id];
      if (!local) {
        all[sess.id] = sess;
      } else {
        // Scalar navigation state follows the newest snapshot, but durable
        // adaptive artifacts are reconciled independently. A lightweight local
        // write can have a newer lastOpenedAt while lacking the server-only
        // blueprint/journey; using timestamp as an all-or-nothing authority made
        // a valid program look absent and triggered regeneration on "Seguir".
        const serverIsNewer = Number(sess.updatedAt || sess.lastOpenedAt || 0) >= Number(local.updatedAt || local.lastOpenedAt || 0)
        const shell = serverIsNewer ? sess : local
        all[sess.id] = normalizeSession({
          ...shell,
          adaptiveSetup: sess.adaptiveSetup || local.adaptiveSetup,
          setupHash: sess.setupHash || local.setupHash,
          blueprint: sess.blueprint || local.blueprint,
          journey: sess.journey || local.journey,
          sessionContent: { ...(local.sessionContent || {}), ...(sess.sessionContent || {}) },
          sessionPreparation: { ...(local.sessionPreparation || {}), ...(sess.sessionPreparation || {}) },
          recoveryQueues: { ...(local.recoveryQueues || {}), ...(sess.recoveryQueues || {}) },
          notes: mergeSessionNotes(local.notes, sess.notes),
          completedSessionNumbers: [...new Set([...(local.completedSessionNumbers || []), ...(sess.completedSessionNumbers || [])])],
          unresolvedMicroIds: serverIsNewer ? sess.unresolvedMicroIds : local.unresolvedMicroIds,
          isProgramComplete: local.isProgramComplete === true || sess.isProgramComplete === true,
        })
      }
    }

    // `all` IS memoryCache (loadAll() returns it by reference and the merge
    // loop above mutates it in place) — read the result directly from it
    // instead of re-reading through loadAll()/getSessionById(), which would
    // previously have gone straight back to localStorage and silently lost
    // this merge if the best-effort saveAll() below failed on quota.
    saveAll(all);
    const sessionList = Object.values(all);
    const sessions = sessionId
      ? sessionList.filter(s => s.id === sessionId)
      : temaId ? sessionList.filter(s => s.temaId === temaId).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt) : sessionList;
    return { status: sessions.length ? 'FOUND' : 'ABSENT', sessions };
  } catch (syncError) {
    // AUDITORÍA DE CICLO DE VIDA (verificación focalizada, punto 4): degradar a
    // datos locales sigue siendo correcto (nunca bloquear la sesión activa por
    // un fallo de red), pero antes esto era indistinguible de un sync exitoso
    // que simplemente no encontró cambios — sin rastro de que el servidor no
    // respondió.
    console.error('[study-sessions] syncSessionsFromServer_failed', JSON.stringify({
      temaId: temaId || null,
      message: syncError instanceof Error ? syncError.message : String(syncError),
    }))
    return {
      status: 'ERROR',
      sessions: sessionId
        ? [getSessionById(sessionId)].filter(Boolean) as StudySession[]
        : temaId ? getSessionsByTema(temaId) : Object.values(loadAll()),
      error: syncError instanceof Error ? syncError.message : String(syncError),
    };
  }
}

export function lookupSessionByIdFromServer(
  sessionId: string,
  temaId?: string,
): Promise<PersistedProgramLookup<StudySession>> {
  const exactId = String(sessionId || '').trim();
  if (!exactId) return Promise.resolve({ status: 'ABSENT', sessions: [] });
  return lookupSessionsFromServer(temaId, exactId);
}

export async function syncSessionsFromServer(temaId?: string): Promise<StudySession[]> {
  return (await lookupSessionsFromServer(temaId)).sessions;
}
