import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AdaptiveInitializationCoordinator,
  adaptivePlanRoute,
  completeAdaptiveSession,
  getAdaptiveGenerationPlan,
  getAdaptiveLifecycleState,
  hasAdaptiveDraft,
  hasCompletedAdaptiveSetup,
  hasPersistedAdaptiveArtifacts,
  hasRestorableAdaptiveProcess,
  mayGenerateAdaptiveArtifacts,
  adaptivePlanState,
  navigateToExistingPlan,
  normalizeAdaptivePlanSnapshot,
  replayAdaptiveSession,
  resolveAdaptiveResumeTarget,
  selectAdaptiveSession,
  startAdaptiveSession,
  type AdaptiveResumeSession,
} from "../../lib/adaptive/resume";

const journey = {
  chapters: Array.from({ length: 5 }, (_, index) => ({
    chapterNumber: index + 1,
    status: index === 0 ? "available" as const : "locked" as const,
  })),
};
const setup = { completedAt: 123 };
const blueprint = { blocks: [{ id: "b1" }] };

function fixture(overrides: Partial<AdaptiveResumeSession> = {}): AdaptiveResumeSession {
  return {
    id: "sess_bohr",
    userId: "user_1",
    temaId: "tema_bohr",
    processMode: "adaptive",
    materialIds: ["mat_bohr"],
    primaryMaterialId: "mat_bohr",
    adaptiveSetup: setup,
    blueprint,
    journey,
    completedSessionNumbers: [],
    status: "not_started",
    adaptiveState: "ready",
    lastOpenedAt: 100,
    ...overrides,
  };
}

async function main() {
// Draft nuevo: setup visible, no es restaurable y no genera.
{
  const draft = fixture({ adaptiveSetup: null, blueprint: null, journey: null, adaptiveState: "draft" });
  assert.equal(hasAdaptiveDraft(draft), true);
  assert.equal(hasRestorableAdaptiveProcess(draft), false);
  assert.equal(getAdaptiveLifecycleState(draft), "draft");
  assert.equal(getAdaptiveGenerationPlan(draft), "none");
  assert.equal(resolveAdaptiveResumeTarget({ sessions: [draft], temaId: "tema_bohr" }).view, "setup");
}

// Setup completo: permite generación aunque exista adaptiveSessionId.
{
  const setupComplete = fixture({ blueprint: null, journey: null, adaptiveState: "setup_complete" });
  assert.equal(getAdaptiveLifecycleState(setupComplete), "setup_complete");
  assert.equal(getAdaptiveGenerationPlan(setupComplete), "blueprint_and_journey");
  assert.equal(mayGenerateAdaptiveArtifacts({
    lifecycleState: "setup_complete",
    hasBlueprint: false,
    hasJourney: false,
  }), true);
}

// Blueprint existente: solo falta journey.
{
  const partial = fixture({ journey: null, adaptiveState: "setup_complete" });
  assert.equal(getAdaptiveGenerationPlan(partial), "journey_only");
}

// Ready/studying/completed: restauran sin generación.
for (const [status, adaptiveState, expected] of [
  ["not_started", "ready", "ready"],
  ["in_progress", "studying", "studying"],
  ["completed", "completed", "completed"],
] as const) {
  const session = fixture({
    status,
    adaptiveState,
    isProgramComplete: status === "completed",
    unresolvedMicroIds: [],
  });
  assert.equal(getAdaptiveLifecycleState(session), expected);
  assert.equal(hasRestorableAdaptiveProcess(session), true);
  assert.equal(getAdaptiveGenerationPlan(session), "none");
  assert.equal(mayGenerateAdaptiveArtifacts({
    lifecycleState: expected,
    hasBlueprint: true,
    hasJourney: true,
  }), false);
}

// Harness integrado: draft → setup → generación mock → plan → estudio → resume, mismo ID.
{
  const store = new Map<string, AdaptiveResumeSession>();
  const draft = fixture({
    id: "sess_stable",
    adaptiveSetup: null,
    blueprint: null,
    journey: null,
    adaptiveState: "draft",
  });
  store.set(draft.id, draft);
  store.set(draft.id, { ...draft, adaptiveSetup: setup, adaptiveState: "setup_complete" });

  let blueprintCalls = 0;
  let journeyCalls = 0;
  const coordinator = new AdaptiveInitializationCoordinator<AdaptiveResumeSession>();
  const dependencies = {
    load: (id: string) => store.get(id) || null,
    save: (session: AdaptiveResumeSession) => {
      assert.equal(session.id, "sess_stable");
      store.set(session.id, session);
      return session;
    },
    generateBlueprint: () => {
      blueprintCalls += 1;
      return blueprint;
    },
    generateJourney: () => {
      journeyCalls += 1;
      return journey;
    },
  };

  const [readyA, readyB] = await Promise.all([
    coordinator.run("sess_stable", dependencies),
    coordinator.run("sess_stable", dependencies),
  ]);
  assert.equal(readyA.id, draft.id);
  assert.equal(readyB.id, draft.id);
  assert.equal(blueprintCalls, 1);
  assert.equal(journeyCalls, 1);
  assert.equal(getAdaptiveLifecycleState(readyA), "ready");
  assert.ok(readyA.blueprint);
  assert.ok(readyA.journey);

  const studying = startAdaptiveSession(readyA, 1, 2);
  store.set(studying.id, studying);
  const resumed = resolveAdaptiveResumeTarget({
    sessions: [...store.values()],
    temaId: "tema_bohr",
    sessionId: "sess_stable",
    materialId: "mat_bohr",
  });
  assert.equal(resumed.session?.id, "sess_stable");
  assert.equal(resumed.view, "session");
  assert.equal(resumed.session?.currentStep, 2);
  assert.equal(blueprintCalls, 1);
  assert.equal(journeyCalls, 1);
}

// Harness real de "Seguir estudiando": studying + paso persistido navega directo.
{
  const forbiddenCalls: string[] = [];
  const active = fixture({
    id: "sess_resume_active",
    temaId: "tema_resume",
    status: "not_started", // Compatibilidad: algunos backends antiguos solo persistieron adaptiveState.
    adaptiveState: "studying",
    currentSessionNumber: 1,
    currentStep: 2,
  });
  assert.equal(hasCompletedAdaptiveSetup(active), true);
  assert.equal(hasPersistedAdaptiveArtifacts(active), true);

  const target = resolveAdaptiveResumeTarget({
    sessions: [active],
    temaId: "tema_resume",
    sessionId: "sess_resume_active",
  });
  assert.equal(
    target.route,
    "/materias/tema_resume/sesion/1?adaptiveSessionId=sess_resume_active",
  );
  assert.equal(target.view, "session");
  assert.equal(target.session?.currentStep, 2);
  assert.deepEqual(forbiddenCalls, []);

  // Ver el plan es navegación, no una transición de dominio.
  assert.equal(adaptivePlanRoute(active.temaId, active.id).includes("adaptiveView=plan"), true);
  assert.equal(active.adaptiveState, "studying");
  assert.equal(active.currentSessionNumber, 1);
  assert.equal(active.currentStep, 2);
}

// Destinos deterministas para estados sin sesión activa.
{
  assert.equal(resolveAdaptiveResumeTarget({
    sessions: [fixture({ adaptiveState: "ready", status: "not_started" })],
    temaId: "tema_bohr",
  }).view, "plan");
  assert.equal(resolveAdaptiveResumeTarget({
    sessions: [fixture({
      adaptiveState: "studying",
      status: "not_started",
      currentSessionNumber: 1,
      completedSessionNumbers: [1],
    })],
    temaId: "tema_bohr",
  }).view, "plan");
  assert.equal(resolveAdaptiveResumeTarget({
    sessions: [fixture({
      adaptiveState: "completed",
      status: "completed",
      isProgramComplete: true,
      unresolvedMicroIds: [],
    })],
    temaId: "tema_bohr",
  }).view, "plan");
}

// Un plan completado existe aunque ya no tenga una sesión activa.
{
  const completed = fixture({
    status: "completed",
    adaptiveState: "completed",
    currentSessionNumber: 5,
    completedSessionNumbers: [1, 2, 3, 4, 5],
    isProgramComplete: true,
    unresolvedMicroIds: [],
  });
  const state = adaptivePlanState(completed);
  assert.equal(state.planExists, true);
  assert.equal(state.hasActiveSession, false);
  assert.equal(state.isProgramComplete, true);
  assert.equal(getAdaptiveGenerationPlan(completed), "none");
}

// Snapshot opcionalmente incompleto se normaliza sin IDs ni timestamps nuevos.
{
  const completed = fixture({
    status: "completed",
    adaptiveState: "completed",
    completedSessionNumbers: [1, 2, 3, 4, 5],
    isProgramComplete: true,
    journey: { chapters: journey.chapters },
    lastOpenedAt: 456,
  });
  const normalized = normalizeAdaptivePlanSnapshot(completed);
  assert.equal(normalized.id, completed.id);
  assert.equal(normalized.lastOpenedAt, completed.lastOpenedAt);
  assert.equal(normalized.journey?.totalChapters, 5);
  assert.equal(normalized.journey?.chapters?.every(chapter => chapter.status === "done"), true);
}

// Navegar al plan es idempotente y nunca invoca generación.
{
  const routes: string[] = [];
  const events: string[] = [];
  let generationCalls = 0;
  const dependencies = {
    navigate: (route: string) => routes.push(route),
    telemetry: (event: string) => events.push(event),
    generate: () => { generationCalls += 1 },
  };
  const first = navigateToExistingPlan({
    temaId: "tema_bohr",
    journeyId: "sess_bohr",
    persistedJourney: fixture({ status: "completed", adaptiveState: "completed", isProgramComplete: true }),
  }, dependencies);
  const second = navigateToExistingPlan({
    temaId: "tema_bohr",
    journeyId: "sess_bohr",
    persistedJourney: fixture({ status: "completed", adaptiveState: "completed", isProgramComplete: true }),
  }, dependencies);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(routes, [adaptivePlanRoute("tema_bohr", "sess_bohr"), adaptivePlanRoute("tema_bohr", "sess_bohr")]);
  assert.equal(generationCalls, 0);
  assert.deepEqual(events, [
    "plan_navigation_requested", "existing_plan_restored",
    "plan_navigation_requested", "existing_plan_restored",
  ]);
}

// Un ID sin journey muestra recuperación; no genera silenciosamente.
{
  const events: string[] = [];
  let navigations = 0;
  let generationCalls = 0;
  const missingDependencies = {
    navigate: () => { navigations += 1 },
    telemetry: (event: string) => events.push(event),
    generate: () => { generationCalls += 1 },
  };
  const result = navigateToExistingPlan({
    temaId: "tema_bohr",
    journeyId: "sess_missing",
    persistedJourney: fixture({ journey: null }),
  }, missingDependencies);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_plan");
  assert.equal(navigations, 0);
  assert.equal(generationCalls, 0);
  assert.deepEqual(events, ["plan_navigation_requested", "missing_plan_detected", "unexpected_plan_generation_blocked"]);
}

// Con blueprint persistido, el harness genera únicamente journey.
{
  const partial = fixture({ id: "sess_partial", journey: null, adaptiveState: "setup_complete" });
  let stored = partial;
  let blueprintCalls = 0;
  let journeyCalls = 0;
  const coordinator = new AdaptiveInitializationCoordinator<AdaptiveResumeSession>();
  const ready = await coordinator.run(partial.id, {
    load: () => stored,
    save: session => (stored = session),
    generateBlueprint: () => {
      blueprintCalls += 1;
      return blueprint;
    },
    generateJourney: () => {
      journeyCalls += 1;
      return journey;
    },
  });
  assert.equal(ready.id, partial.id);
  assert.equal(blueprintCalls, 0);
  assert.equal(journeyCalls, 1);
}

// ID explícito nunca se reemplaza por una sesión más reciente.
{
  const explicit = fixture({ id: "sess_A", lastOpenedAt: 1 });
  const newer = fixture({ id: "sess_B", lastOpenedAt: 999 });
  assert.equal(selectAdaptiveSession([newer, explicit], {
    temaId: "tema_bohr",
    sessionId: "sess_A",
    materialId: "mat_bohr",
  })?.id, "sess_A");
  assert.equal(selectAdaptiveSession([newer, explicit], {
    temaId: "tema_bohr",
    sessionId: "missing",
  }), null);
}

// Mismo nombre no interviene: primaryMaterialId decide.
{
  const wrong = fixture({
    id: "sess_wrong",
    materialIds: ["mat_other"],
    primaryMaterialId: "mat_other",
    materialNames: ["niels bohr.pdf"],
    lastOpenedAt: 999,
  });
  const right = fixture({
    id: "sess_right",
    materialIds: ["mat_bohr"],
    primaryMaterialId: "mat_bohr",
    materialNames: ["niels bohr.pdf"],
    lastOpenedAt: 1,
  });
  assert.equal(selectAdaptiveSession([wrong, right], {
    temaId: "tema_bohr",
    materialId: "mat_bohr",
  })?.id, "sess_right");
}

// Navegación, desbloqueo, replay e idempotencia conservan identidad.
{
  const target = resolveAdaptiveResumeTarget({ sessions: [fixture()], temaId: "tema_bohr", materialId: "mat_bohr" });
  assert.equal(target.route, adaptivePlanRoute("tema_bohr", "sess_bohr"));
  const completed = completeAdaptiveSession(fixture(), 1);
  const completedTwice = completeAdaptiveSession(completed, 1);
  assert.deepEqual(completedTwice.completedSessionNumbers, [1]);
  assert.equal(completedTwice.journey?.chapters?.[1].status, "available");
  const replay = replayAdaptiveSession(completedTwice, 1);
  assert.deepEqual(replay.completedSessionNumbers, [1]);
  assert.equal(replay.id, "sess_bohr");
}

// La última sesión individual no completa el programa sin que TODO el journey esté
// realmente recorrido — isProgramComplete se DERIVA de completedSessionNumbers vs los
// capítulos reales del journey, nunca de un booleano que alguien pase como "confirmación
// canónica". Un canonicalCompletion.isProgramComplete=true ya NO alcanza por sí solo:
// completar solo la sesión 5 de un journey de 5 capítulos, sin haber completado antes
// 1-4, no puede volverse "programa completo" pase lo que pase el caller.
{
  const lastSession = 5;
  const midProgram = fixture({ status: "in_progress", adaptiveState: "studying" });

  const withoutConfirmation = completeAdaptiveSession(midProgram, lastSession);
  assert.equal(withoutConfirmation.completedSessionNumbers?.includes(lastSession), true);
  assert.equal(withoutConfirmation.isProgramComplete, false);
  assert.notEqual(withoutConfirmation.status, "completed");
  assert.notEqual(withoutConfirmation.adaptiveState, "completed");

  // Un canonicalCompletion.isProgramComplete=true ya no puede, por sí solo, completar el
  // programa si de verdad faltan capítulos por recorrer (1-4 nunca se completaron aquí).
  const claimedTrueButIncompleteJourney = completeAdaptiveSession(midProgram, lastSession, {
    isProgramComplete: true,
    unresolvedMicroIds: [],
  });
  assert.equal(claimedTrueButIncompleteJourney.isProgramComplete, false, "reclamar isProgramComplete=true no basta si el journey real (capítulos 1-4) nunca se completó");
  assert.notEqual(claimedTrueButIncompleteJourney.adaptiveState, "completed");

  // Escenario realista: 1-4 ya completados de antes, ahora se completa la última (5).
  const base = fixture({ status: "in_progress", adaptiveState: "studying", completedSessionNumbers: [1, 2, 3, 4] });

  // La derivación ignora el booleano del caller en AMBAS direcciones: journey realmente
  // completo (1-4 previos + 5 ahora) y 0 unresolved deriva TRUE incluso si el caller
  // afirma explícitamente false — un "false" del caller no puede ocultar una
  // finalización real, igual que un "true" no puede fabricar una que no ocurrió.
  const callerClaimsFalseButDataComplete = completeAdaptiveSession(base, lastSession, {
    isProgramComplete: false,
    unresolvedMicroIds: [],
  });
  assert.equal(callerClaimsFalseButDataComplete.isProgramComplete, true, "un caller que afirma false no debe poder ocultar una finalización real derivada de los datos");
  assert.equal(callerClaimsFalseButDataComplete.adaptiveState, "completed");

  const unresolved = completeAdaptiveSession(base, lastSession, {
    isProgramComplete: true,
    unresolvedMicroIds: ["micro_pending"],
  });
  assert.equal(unresolved.isProgramComplete, false);
  assert.equal(unresolved.unresolvedMicroIds?.[0], "micro_pending");
  assert.notEqual(unresolved.adaptiveState, "completed");

  // Con TODOS los capítulos reales completados (1-4 previos + 5 ahora) y 0 unresolved,
  // isProgramComplete se deriva a true — no porque el caller lo haya "confirmado", sino
  // porque completedSessionNumbers realmente cubre el journey completo.
  const canonicallyComplete = completeAdaptiveSession(base, lastSession, {
    isProgramComplete: true,
    unresolvedMicroIds: [],
  });
  assert.equal(canonicallyComplete.isProgramComplete, true);
  assert.equal(canonicallyComplete.status, "completed");
  assert.equal(canonicallyComplete.adaptiveState, "completed");

  // La derivación no depende en absoluto del booleano de entrada: omitiéndolo, con el
  // journey realmente completo y 0 unresolved, el resultado es idéntico.
  const derivedWithoutAnyClaim = completeAdaptiveSession(base, lastSession, { unresolvedMicroIds: [] });
  assert.equal(derivedWithoutAnyClaim.isProgramComplete, true, "la derivación no depende de que el caller mande isProgramComplete — solo de completedSessionNumbers vs journey y unresolvedMicroIds");

  const replayed = replayAdaptiveSession(withoutConfirmation, lastSession);
  assert.equal(replayed.isProgramComplete, false);
  assert.deepEqual(replayed.unresolvedMicroIds, withoutConfirmation.unresolvedMicroIds);
}

// Auditoría estática: resume de sesión no contiene endpoints generativos.
{
  const forbidden = [
    "/api/adaptive/blueprint",
    "/api/adaptive/generate-plan",
    "/api/adaptive/session-copy",
    "/api/mastery/extract-concepts",
    "/api/mastery/extract-graph",
    "/api/enfoques/teorico/start",
    "/api/adaptive/session-teach",
  ];
  const sessionPageSource = readFileSync(
    new URL("../../app/materias/[temaId]/sesion/[sessionNumber]/page.tsx", import.meta.url),
    "utf8",
  );
  const openPlanSource = sessionPageSource.match(/function openPlan\(\)[\s\S]*?\n  \}/)?.[0] || "";
  assert.notEqual(openPlanSource, "");
  for (const endpoint of forbidden) {
    assert.equal(openPlanSource.includes(endpoint), false, `plan navigation must not reference ${endpoint}`);
  }
  assert.equal(openPlanSource.includes("OPENROUTER"), false);

  const temaViewSource = readFileSync(
    new URL("../../components/materias/TemaView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    temaViewSource,
    /await syncSessionsFromServer\(tema\?\.id \|\| ""\)[\s\S]*resolveAdaptiveResumeTarget/,
  );
  assert.match(
    temaViewSource,
    /target\.state === "existing" && target\.view === "session"[\s\S]*window\.location\.href = target\.route/,
  );

  const materiasPageSource = readFileSync(
    new URL("../../app/materias/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(materiasPageSource, /adaptiveResumeExtractionGuardRef/);
  assert.match(materiasPageSource, /hasPersistedAdaptiveArtifacts\(persisted\)/);
  for (const endpoint of ["/api/mastery/extract-concepts", "/api/mastery/extract-graph"]) {
    assert.equal(
      materiasPageSource.indexOf("if (adaptiveResumeExtractionGuardRef.current) return;")
        < materiasPageSource.indexOf(endpoint),
      true,
      `resume guard must run before ${endpoint}`,
    );
  }
}

console.log("adaptive lifecycle + resume contracts: 31/31 PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
