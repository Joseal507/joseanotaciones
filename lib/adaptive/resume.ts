export type AdaptiveProcessState = "loading" | "existing" | "absent" | "error";
export type AdaptiveLifecycleState =
  | "draft"
  | "setup_complete"
  | "generating"
  | "ready"
  | "studying"
  | "completed"
  | "error";
export type AdaptiveSessionStatus = "not_started" | "in_progress" | "completed";

export interface AdaptiveJourneyChapter {
  chapterNumber: number;
  kind?: "introduction" | "learning" | "final_review";
  status?: "locked" | "available" | "done";
  [key: string]: unknown;
}

export interface AdaptiveJourney {
  chapters?: AdaptiveJourneyChapter[];
  totalChapters?: number;
  [key: string]: unknown;
}

export interface AdaptiveResumeSession {
  id: string;
  userId?: string;
  temaId: string;
  processMode?: string;
  studyMode?: string;
  materialIds: string[];
  primaryMaterialId?: string;
  masteryMaterialKey?: string;
  adaptiveSetup?: { completedAt?: number } | null;
  blueprint?: unknown;
  journey?: AdaptiveJourney | null;
  currentSessionNumber?: number;
  currentStep?: number;
  completedSessionNumbers?: number[];
  status?: AdaptiveSessionStatus;
  adaptiveState?: AdaptiveLifecycleState;
  replaySessionNumber?: number;
  replayAttempt?: number;
  isProgramComplete?: boolean;
  unresolvedMicroIds?: string[];
  lastOpenedAt?: number;
}

export interface CanonicalProgramCompletion {
  isProgramComplete?: boolean;
  unresolvedMicroIds?: string[];
}

export interface AdaptiveResumeTarget {
  state: Exclude<AdaptiveProcessState, "loading" | "error">;
  session: AdaptiveResumeSession | null;
  materialId: string | null;
  completedSessionNumbers: number[];
  unlockedSessionNumbers: number[];
  activeSessionNumber: number | null;
  route: string;
  view: "setup" | "plan" | "session";
}

export function mayGenerateAdaptiveArtifacts(input: {
  lifecycleState: AdaptiveLifecycleState;
  hasBlueprint: boolean;
  hasJourney: boolean;
}): boolean {
  return (input.lifecycleState === "setup_complete"
      || input.lifecycleState === "generating"
      || input.lifecycleState === "error")
    && (!input.hasBlueprint || !input.hasJourney);
}

export function hasValidAdaptiveBlueprint(session: AdaptiveResumeSession | null | undefined): boolean {
  const blueprint = session?.blueprint as { blocks?: unknown[]; globalOrderedAnalysis?: unknown[] } | undefined;
  return Boolean(blueprint && ((blueprint.blocks?.length || blueprint.globalOrderedAnalysis?.length || 0) > 0));
}

export function hasValidAdaptiveJourney(session: AdaptiveResumeSession | null | undefined): boolean {
  return Boolean(session?.journey?.chapters?.length);
}

export function hasCompletedAdaptiveSetup(
  session: AdaptiveResumeSession | null | undefined,
): boolean {
  return Boolean(session?.adaptiveSetup?.completedAt);
}

export function hasPersistedAdaptiveArtifacts(
  session: AdaptiveResumeSession | null | undefined,
): boolean {
  return hasCompletedAdaptiveSetup(session)
    && hasValidAdaptiveBlueprint(session)
    && hasValidAdaptiveJourney(session);
}

export interface AdaptivePlanState {
  planExists: boolean;
  hasActiveSession: boolean;
  isProgramComplete: boolean;
}

export function adaptivePlanState(
  session: AdaptiveResumeSession | null | undefined,
): AdaptivePlanState {
  const planExists = Boolean(session?.id && hasValidAdaptiveJourney(session));
  const completed = uniqueNumbers(session?.completedSessionNumbers);
  const activeNumber = Number(session?.currentSessionNumber || 0);
  const hasActiveSession = Boolean(
    planExists
    && activeNumber > 0
    && (session?.status === "in_progress" || session?.adaptiveState === "studying")
    && (!completed.includes(activeNumber) || session?.replaySessionNumber === activeNumber),
  );
  return {
    planExists,
    hasActiveSession,
    isProgramComplete: session?.isProgramComplete === true,
  };
}

export function getAdaptiveLifecycleState(
  session: AdaptiveResumeSession | null | undefined,
): AdaptiveLifecycleState {
  if (!session?.adaptiveSetup?.completedAt) return "draft";
  if (session.adaptiveState === "error") return "error";
  const hasBlueprint = hasValidAdaptiveBlueprint(session);
  const hasJourney = hasValidAdaptiveJourney(session);
  if (!hasBlueprint || !hasJourney) {
    return session.adaptiveState === "generating" ? "generating" : "setup_complete";
  }
  if (session.status === "completed"
    && session.isProgramComplete === true
    && (session.unresolvedMicroIds?.length || 0) === 0) return "completed";
  if (session.status === "in_progress") return "studying";
  if (session.adaptiveState === "studying") return "studying";
  return "ready";
}

export function hasAdaptiveDraft(session: AdaptiveResumeSession | null | undefined): boolean {
  return Boolean(session)
    && (session?.processMode || session?.studyMode) === "adaptive"
    && getAdaptiveLifecycleState(session) === "draft";
}

export function hasRestorableAdaptiveProcess(
  session: AdaptiveResumeSession | null | undefined,
): boolean {
  if (!session || (session.processMode || session.studyMode) !== "adaptive") return false;
  const state = getAdaptiveLifecycleState(session);
  return state === "ready" || state === "studying" || state === "completed";
}

export type AdaptiveGenerationPlan = "none" | "blueprint_and_journey" | "journey_only";

export function getAdaptiveGenerationPlan(
  session: AdaptiveResumeSession | null | undefined,
): AdaptiveGenerationPlan {
  if (!session?.adaptiveSetup?.completedAt) return "none";
  if (hasValidAdaptiveJourney(session) && hasValidAdaptiveBlueprint(session)) return "none";
  if (!hasValidAdaptiveBlueprint(session)) return "blueprint_and_journey";
  return "journey_only";
}

export interface AdaptiveInitializationDependencies<T extends AdaptiveResumeSession> {
  load: (sessionId: string) => T | null | Promise<T | null>;
  save: (session: T) => T | Promise<T>;
  generateBlueprint: (session: T) => unknown | Promise<unknown>;
  generateJourney: (session: T, blueprint: unknown) => AdaptiveJourney | Promise<AdaptiveJourney>;
}

export class AdaptiveInitializationCoordinator<T extends AdaptiveResumeSession> {
  private readonly inFlight = new Map<string, Promise<T>>();

  run(sessionId: string, deps: AdaptiveInitializationDependencies<T>): Promise<T> {
    const current = this.inFlight.get(sessionId);
    if (current) return current;

    const operation = this.initialize(sessionId, deps)
      .finally(() => this.inFlight.delete(sessionId));
    this.inFlight.set(sessionId, operation);
    return operation;
  }

  private async initialize(
    sessionId: string,
    deps: AdaptiveInitializationDependencies<T>,
  ): Promise<T> {
    const loaded = await deps.load(sessionId);
    if (!loaded || loaded.id !== sessionId) {
      throw new Error(`Adaptive session ${sessionId} not found`);
    }

    const plan = getAdaptiveGenerationPlan(loaded);
    if (plan === "none") return loaded;

    let session = await deps.save({ ...loaded, adaptiveState: "generating" });
    try {
      let blueprint = session.blueprint;
      if (plan === "blueprint_and_journey") {
        blueprint = await deps.generateBlueprint(session);
        session = await deps.save({ ...session, blueprint, adaptiveState: "generating" });
      }
      const journey = await deps.generateJourney(session, blueprint);
      return await deps.save({
        ...session,
        blueprint,
        journey,
        adaptiveState: "ready",
      });
    } catch (error) {
      await deps.save({ ...session, adaptiveState: "error" });
      throw error;
    }
  }
}

function uniqueNumbers(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(Number).filter(n => Number.isInteger(n) && n > 0))]
    .sort((a, b) => a - b);
}

export function canonicalMaterialId(session: AdaptiveResumeSession): string | null {
  const explicit = String(session.primaryMaterialId || "").trim();
  if (explicit) return explicit;
  return session.materialIds.map(String).map(id => id.trim()).find(Boolean) || null;
}

export function normalizeAdaptiveProgress<T extends AdaptiveResumeSession>(session: T): T {
  const completed = uniqueNumbers(session.completedSessionNumbers);
  const completedSet = new Set(completed);
  const chapters = Array.isArray(session.journey?.chapters)
    ? session.journey!.chapters!
    : [];

  for (const chapter of chapters) {
    if (chapter.status === "done") completedSet.add(Number(chapter.chapterNumber));
  }

  const normalizedCompleted = [...completedSet].filter(Number.isFinite).sort((a, b) => a - b);
  const nextUnlocked = normalizedCompleted.length
    ? Math.max(...normalizedCompleted) + 1
    : chapters.length ? Number(chapters[0].chapterNumber) : 1;

  const normalizedChapters = chapters.map(chapter => {
    const number = Number(chapter.chapterNumber);
    const status = completedSet.has(number)
      ? "done"
      : number === nextUnlocked
        ? "available"
        : "locked";
    return { ...chapter, status };
  });

  return {
    ...session,
    primaryMaterialId: canonicalMaterialId(session) || undefined,
    completedSessionNumbers: normalizedCompleted,
    journey: session.journey
      ? { ...session.journey, chapters: normalizedChapters }
      : session.journey,
  };
}

export function normalizeAdaptivePlanSnapshot<T extends AdaptiveResumeSession>(session: T): T {
  const normalized = normalizeAdaptiveProgress(session);
  if (!normalized.journey) return normalized;
  const chapters = normalized.journey.chapters || [];
  return {
    ...normalized,
    journey: {
      ...normalized.journey,
      totalChapters: Number(normalized.journey.totalChapters || chapters.length),
      chapters,
    },
  };
}

export function hasExistingAdaptiveProcess(session: AdaptiveResumeSession | null | undefined): boolean {
  return hasRestorableAdaptiveProcess(session);
}

function sameMaterial(session: AdaptiveResumeSession, materialId?: string | null): boolean {
  if (!materialId) return true;
  const target = String(materialId).trim();
  return canonicalMaterialId(session) === target
    || session.materialIds.some(id => String(id).trim() === target);
}

export function selectAdaptiveSession(
  sessions: AdaptiveResumeSession[],
  input: { temaId: string; sessionId?: string | null; materialId?: string | null },
): AdaptiveResumeSession | null {
  const adaptive = sessions
    .filter(session =>
      session.temaId === input.temaId
      && (session.processMode || session.studyMode) === "adaptive",
    )
    .map(normalizeAdaptiveProgress);

  if (input.sessionId) {
    return adaptive.find(session => session.id === input.sessionId) || null;
  }

  return adaptive
    .filter(session => sameMaterial(session, input.materialId))
    .sort((a, b) => Number(b.lastOpenedAt || 0) - Number(a.lastOpenedAt || 0))[0]
    || null;
}

export function adaptivePlanRoute(temaId: string, sessionId: string): string {
  return `/materias?temaId=${encodeURIComponent(temaId)}&adaptiveSessionId=${encodeURIComponent(sessionId)}&adaptiveView=plan`;
}

export interface ExistingPlanNavigationDependencies {
  navigate: (route: string) => void;
  telemetry?: (event: string, details?: Record<string, unknown>) => void;
}

export function navigateToExistingPlan(
  input: {
    temaId: string;
    journeyId: string;
    persistedJourney: AdaptiveResumeSession | null | undefined;
  },
  dependencies: ExistingPlanNavigationDependencies,
): { ok: true; route: string } | { ok: false; reason: "missing_plan" } {
  const details = { temaId: input.temaId, journeyId: input.journeyId };
  dependencies.telemetry?.("plan_navigation_requested", details);
  const normalized = input.persistedJourney
    ? normalizeAdaptivePlanSnapshot(input.persistedJourney)
    : null;
  if (!normalized || normalized.id !== input.journeyId || !hasValidAdaptiveJourney(normalized)) {
    dependencies.telemetry?.("missing_plan_detected", details);
    dependencies.telemetry?.("unexpected_plan_generation_blocked", details);
    return { ok: false, reason: "missing_plan" };
  }
  const route = adaptivePlanRoute(input.temaId, input.journeyId);
  dependencies.telemetry?.("existing_plan_restored", {
    ...details,
    status: normalized.status,
    isProgramComplete: normalized.isProgramComplete === true,
  });
  dependencies.navigate(route);
  return { ok: true, route };
}

export function adaptiveSessionRoute(
  temaId: string,
  sessionId: string,
  sessionNumber: number,
): string {
  return `/materias/${encodeURIComponent(temaId)}/sesion/${sessionNumber}?adaptiveSessionId=${encodeURIComponent(sessionId)}`;
}

export function resolveAdaptiveResumeTarget(input: {
  sessions: AdaptiveResumeSession[];
  temaId: string;
  sessionId?: string | null;
  materialId?: string | null;
}): AdaptiveResumeTarget {
  const session = selectAdaptiveSession(input.sessions, input);
  if (!session || !hasExistingAdaptiveProcess(session)) {
    return {
      state: "absent",
      session,
      materialId: session ? canonicalMaterialId(session) : input.materialId || null,
      completedSessionNumbers: [],
      unlockedSessionNumbers: [],
      activeSessionNumber: null,
      route: `/materias?temaId=${encodeURIComponent(input.temaId)}&adaptiveView=setup`,
      view: "setup",
    };
  }

  const completed = uniqueNumbers(session.completedSessionNumbers);
  const chapters = session.journey?.chapters || [];
  const unlocked = chapters
    .filter(chapter => chapter.status !== "locked")
    .map(chapter => Number(chapter.chapterNumber));
  const activeNumber = Number(session.currentSessionNumber || 0);
  const inProgress = (session.status === "in_progress" || session.adaptiveState === "studying")
    && activeNumber > 0
    && (!completed.includes(activeNumber) || session.replaySessionNumber === activeNumber);

  return {
    state: "existing",
    session,
    materialId: canonicalMaterialId(session),
    completedSessionNumbers: completed,
    unlockedSessionNumbers: uniqueNumbers(unlocked),
    activeSessionNumber: inProgress ? activeNumber : null,
    route: inProgress
      ? adaptiveSessionRoute(input.temaId, session.id, activeNumber)
      : adaptivePlanRoute(input.temaId, session.id),
    view: inProgress ? "session" : "plan",
  };
}

// El journey está realmente recorrido solo si TODOS sus capítulos aparecen en
// completedSessionNumbers — no "hay un capítulo siguiente" ni un conteo de sesiones.
// Fail-closed: sin capítulos o sin journey nunca se considera recorrido.
export function isAdaptiveJourneyFullyTraversed(
  journey: AdaptiveJourney | null | undefined,
  completedSessionNumbers: number[],
): boolean {
  const chapters = journey?.chapters || [];
  if (!chapters.length) return false;
  const completedSet = new Set(completedSessionNumbers.map(Number));
  return chapters.every(chapter => completedSet.has(Number(chapter.chapterNumber)));
}

// Única derivación de isProgramComplete — nunca a partir de un booleano recibido
// (ni del cliente ni de un valor ya almacenado). completedSessionNumbers solo gana una
// sesión tras pasar por sessionFinalTransition.ts (assessmentComplete real), así que
// "todas las sesiones completadas" no es un proxy de coverage — cada una ya exigió
// evidencia. unresolvedMicroIds es una segunda guarda explícita e independiente.
export function deriveIsProgramComplete(params: {
  journey?: AdaptiveJourney | null;
  completedSessionNumbers: number[];
  unresolvedMicroIds: string[];
}): boolean {
  return isAdaptiveJourneyFullyTraversed(params.journey, params.completedSessionNumbers)
    && params.unresolvedMicroIds.length === 0;
}

export function completeAdaptiveSession<T extends AdaptiveResumeSession>(
  rawSession: T,
  sessionNumber: number,
  canonicalCompletion?: CanonicalProgramCompletion,
): T {
  const session = normalizeAdaptiveProgress(rawSession);
  const completed = uniqueNumbers([...(session.completedSessionNumbers || []), sessionNumber]);
  const chapters = session.journey?.chapters || [];
  const hasNext = chapters.some(chapter => Number(chapter.chapterNumber) === sessionNumber + 1);
  const unresolvedMicroIds = Array.isArray(canonicalCompletion?.unresolvedMicroIds)
    ? canonicalCompletion.unresolvedMicroIds.map(String).filter(Boolean)
    : session.unresolvedMicroIds || [];
  // canonicalCompletion.isProgramComplete queda deliberadamente sin usar: su único
  // caller lo poblaba con el propio session.isProgramComplete ya almacenado, así que
  // confiar en él era circular (solo podía preservar un true existente, nunca derivar
  // uno nuevo). isProgramComplete se deriva siempre de datos verificables.
  const isProgramComplete = deriveIsProgramComplete({
    journey: session.journey,
    completedSessionNumbers: completed,
    unresolvedMicroIds,
  });
  const { replaySessionNumber: _replaySessionNumber, ...sessionWithoutReplay } = session;
  return normalizeAdaptiveProgress({
    ...sessionWithoutReplay,
    completedSessionNumbers: completed,
    currentSessionNumber: hasNext ? sessionNumber + 1 : sessionNumber,
    currentStep: 0,
    status: isProgramComplete ? "completed" : "not_started",
    adaptiveState: isProgramComplete ? "completed" : hasNext ? "ready" : "studying",
    isProgramComplete,
    unresolvedMicroIds,
  } as T);
}

export function startAdaptiveSession<T extends AdaptiveResumeSession>(
  rawSession: T,
  sessionNumber: number,
  currentStep = 0,
): T {
  const session = normalizeAdaptiveProgress(rawSession);
  return {
    ...session,
    currentSessionNumber: sessionNumber,
    currentStep,
    status: "in_progress",
    adaptiveState: "studying",
  };
}

export function replayAdaptiveSession<T extends AdaptiveResumeSession>(
  rawSession: T,
  sessionNumber: number,
): T {
  const session = normalizeAdaptiveProgress(rawSession);
  return {
    ...session,
    currentSessionNumber: sessionNumber,
    currentStep: 0,
    status: "in_progress",
    adaptiveState: "studying",
    replaySessionNumber: sessionNumber,
    replayAttempt: Number(session.replayAttempt || 0) + 1,
  };
}
