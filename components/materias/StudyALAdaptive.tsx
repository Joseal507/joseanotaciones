"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import {
  getSessionsByTema,
  upsertSession,
  hashSetup,
  lookupSessionsFromServer,
  updateSessionById,
  type AdaptiveSetup,
} from "../../lib/studySessions";
import { generateStudyPlan, type LegacyStudyPlan } from "../../lib/adaptive/planGenerator";
import { roleBadge } from "../../lib/adaptive/narrativeFormatter";
import type { LearningJourney } from "../../lib/adaptive/journeyBuilder";
import { GenerationAttemptTracker } from "../../lib/adaptive/generationAttemptTracker";
import {
  adaptiveSessionRoute,
  getAdaptiveLifecycleState,
  mayGenerateAdaptiveArtifacts,
  normalizeAdaptivePlanSnapshot,
} from "../../lib/adaptive/resume";
import {
  classifyPersistedAdaptiveProgram,
  mayGenerateAfterRestore,
  shouldResumePreparation,
  restoreStateFromLookup,
  selectPersistedAdaptiveProgram,
  type ProgramRestoreState,
} from "../../lib/adaptive/programRestore";
import { buildSourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection";
import { computeSessionDependencyFingerprint, sharedSessionPreparationRequests } from "../../lib/adaptive/sessionPrefetch";

const HAND = "'Caveat', cursive";
const BODY = "'Inter', system-ui, sans-serif";

interface Props {
  materiales: any[];
  temaId?: string;
  userId?: string;
  sessionId?: string;
  selectedPages?: Record<string, number[]>;
  onClose: () => void;
}

type UserProfile = {
  nombre?: string | null;
  name?: string | null;
  username?: string | null;
  tipo_estudiante?: string | null;
  tipo_usuario?: string | null;
  universidad?: string | null;
  escuela?: string | null;
  carrera?: string | null;
  objetivo?: string | null;
  edad?: number | null;
  genero?: string | null;
};

function getMaterialId(material: any) {
  return String(material?.materialId || material?.id || "").trim();
}

const defaultSetup: AdaptiveSetup = {
  knowledgeLevel: "never_seen",
  examDateType: "just_studying",
  examDateCustom: "",
  targetScore: 80,
  mainConcern: "",
  professorExamStyle: [],
  evalPreference: "mixed",
  planView: "book",
  completedAt: 0,
};

const examStyleOptions = [
  { id: "multiple_choice", label: "Opción múltiple", emoji: "🔘" },
  { id: "true_false", label: "Verdadero / falso", emoji: "✅" },
  { id: "matching", label: "Relacionar", emoji: "🔗" },
  { id: "development", label: "Desarrollo", emoji: "✍️" },
  { id: "reading", label: "Comprensión lectora", emoji: "📖" },
  { id: "mixed", label: "Mixto / de todo", emoji: "🧩" },
  { id: "no_idea", label: "No tengo idea", emoji: "🤷" },
];

function cardStyle(active: boolean, color = "#38bdf8") {
  return {
    border: "2px solid " + (active ? color : "var(--border-color)"),
    background: active
      ? "linear-gradient(135deg, " + color + "22, var(--bg-card))"
      : "var(--bg-card)",
    color: active ? color : "var(--text-primary)",
    borderRadius: 18,
    padding: "16px 18px",
    cursor: "pointer",
    fontWeight: 900,
    fontFamily: BODY,
    textAlign: "left" as const,
    boxShadow: active ? "0 0 0 4px " + color + "18" : "none",
    transition: "all .18s ease",
    display: "flex",
    alignItems: "center",
    gap: 10,
  };
}

const kindEmoji: Record<string, string> = {
  topic: "📌",
  subtopic: "📎",
  concept: "💡",
  entity: "👤",
  definition: "📖",
  formula: "🔢",
  example: "📝",
  fact: "📍",
  common_mistake: "⚠️",
  table: "📊",
  image: "🖼️",
  note: "📋",
};

const kindLabel: Record<string, string> = {
  topic: "Topic",
  subtopic: "Subtopic",
  concept: "Concepto",
  entity: "Entidad",
  definition: "Definición",
  formula: "Fórmula",
  example: "Ejemplo",
  fact: "Dato",
  common_mistake: "Error común",
  table: "Tabla",
  image: "Imagen",
  note: "Nota",
};

const objetivoLabels: Record<string, string> = {
  mejorar_notas: "Mejorar mis notas",
  aprobar_examen: "Aprobar un examen",
  entender_materias: "Entender mejor mis materias",
  habito_estudio: "Crear un hábito de estudio",
  graduarme: "Graduarme",
};

const generoLabels: Record<string, string> = {
  hombre: "Hombre",
  mujer: "Mujer",
  otro: "Otro",
};

const knowledgeLabels: Record<string, string> = {
  never_seen: "Nunca lo he visto",
  know_little: "Lo conozco un poco",
  want_review: "Quiero repasarlo",
  already_know: "Ya lo domino, quiero practicar",
};

const evalLabels: Record<string, string> = {
  quick_test: "Evaluaciones rápidas sin escribir",
  write_explain: "Evaluaciones escribiendo / explicando",
  mixed: "Mixto",
  read_only: "Solo quiero leer",
};

const planViewLabels: Record<string, string> = {
  book: "Como un libro",
  levels: "Como niveles",
  missions: "Como misiones",
};

export default function StudyALAdaptive({
  materiales,
  temaId,
  userId,
  sessionId,
  selectedPages: selectedPagesProp,
  onClose,
}: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [setup, setSetup] = useState<AdaptiveSetup>({ ...defaultSetup });
  const [currentSetupHash, setCurrentSetupHash] = useState<string | null>(null);
  const [resolvedSession, setResolvedSession] = useState<any>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [restoreState, setRestoreState] = useState<ProgramRestoreState>('UNKNOWN');
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  // Blueprint
  const [blueprint, setBlueprint] = useState<any>(null);
  const [blueprintLoading, setBlueprintLoading] = useState(false);
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"perfil" | "setup" | "blueprint" | "plan">("perfil");
  const [studyPlan, setStudyPlan] = useState<LegacyStudyPlan | null>(null);
  const [journey, setJourney] = useState<LearningJourney | null>(null);
  const lastJourneyKeyRef = useRef<string | null>(null);
  const generationInFlightRef = useRef(false);
  const generationAuthorizedRef = useRef(false);
  // AUDITORÍA (StudyAL_Visual_System_Stress_Test, Bug 2): blueprint -> plan ->
  // session-copy no tenía ninguna política de cancelación — salir de esta vista
  // a mitad de generación dejaba todo el trabajo restante corriendo en
  // background, y una respuesta tardía de un intento abandonado podía
  // sobrescribir un intento nuevo (mismo sessionId). GenerationAttemptTracker
  // (lib/adaptive/generationAttemptTracker.ts — extraído para poder probar el
  // contrato token/stillCurrent/AbortController directamente, sin React/DOM,
  // ver scripts/tests/generation-attempt-tracker-contracts.ts) identifica el
  // intento VIGENTE (blueprint y journey del MISMO proceso comparten un solo
  // token, ya que journey siempre corre después de blueprint dentro del mismo
  // intento real) y su AbortController. Nunca se promete cancelar una llamada
  // YA despachada a OpenRouter/Groq — solo se evita aplicar/persistir su
  // resultado si llega tarde, y se evita lanzar la SIGUIENTE etapa cara
  // (generate-plan, session-copy) si el intento que la pidió ya no es el vigente.
  const generationTrackerRef = useRef(new GenerationAttemptTracker());
  function beginGenerationAttempt(): { token: number; signal: AbortSignal } {
    return generationTrackerRef.current.begin();
  }
  // Aborta cualquier llamada de red del intento vigente al desmontar el
  // componente (usuario navegó fuera del modo adaptativo) — cierra la
  // conexión HTTP saliente; no garantiza que el proveedor externo detenga
  // inferencia ya despachada, solo evita seguir pagando/aplicando etapas
  // futuras de ESTE proceso.
  useEffect(() => {
    return () => { generationTrackerRef.current.abortCurrent(); };
  }, []);
  const [journeyError, setJourneyError] = useState<string | null>(null);
  // AUDITORÍA (StudyAL_Visual_System_Stress_Test, Layer B GAP "no
  // regeneración silenciosa"): restoreGapAfterReady (ver loadSession más
  // abajo) fija journeyError con el mensaje honesto de hueco de
  // restauración — pero el efecto de limpieza de journey (más abajo,
  // "if (!setupReady || !blueprintReady || blueprintDegraded)") lo borraba
  // INCONDICIONALMENTE en el mismo tick, precisamente PORQUE blueprint está
  // ausente en el escenario de hueco (esa es la definición del hueco). El
  // usuario nunca llegaba a ver el mensaje de recovery ni el botón
  // "Reintentar preparación del plan" — la UI caía directo a "Preparando el
  // análisis inicial…" como si fuera un setup genuinamente nuevo. Este flag
  // le dice a ese efecto de limpieza que NO borre journeyError mientras el
  // hueco siga pendiente de una acción explícita del usuario.
  const restoreGapPendingRef = useRef(false);
  // AUDITORÍA (misma misión, hallazgo posterior): el botón "Reintentar
  // preparación del plan" solo marcaba generationAuthorizedRef.current=true
  // (un ref) — el efecto de generación de blueprint más abajo depende de
  // [sessionLoading, blueprint, blueprintError, blueprintLoading, journey,
  // lifecycleState], NINGUNO de los cuales cambia de VALOR en el escenario
  // de restoreGapAfterReady (lifecycleState ya era 'setup_complete' desde
  // el primer render, precisamente PORQUE blueprint/journey ya faltaban —
  // esa es la definición del hueco), así que el clic nunca disparaba un
  // nuevo render del efecto y la regeneración quedaba pedida pero nunca
  // ejecutada. Este contador, incrementado únicamente por una acción
  // explícita del usuario, garantiza que el efecto se reevalúe sin importar
  // si algún otro valor derivado coincide por casualidad con el anterior.
  const [regenerationTrigger, setRegenerationTrigger] = useState(0);
  const [blueprintQuality, setBlueprintQuality] = useState<any>(null);
  const setupReady = Boolean(setup?.completedAt);
  const blueprintReady = Boolean(
    blueprint && ((blueprint.blocks?.length || blueprint.globalOrderedAnalysis?.length || 0) > 0)
  );
  const blueprintDegraded = blueprintQuality?.status === "degraded";
  const journeyReady = Boolean(journey && journey.chapters && journey.chapters.length > 0);
  const prerequisitesReady = setupReady && blueprintReady && !blueprintDegraded;
  // Si degraded, mostrar error claro en vez del plan
  const canShowPlan = journeyReady;
  const showGeneratingPlan = prerequisitesReady && !journeyReady && !journeyError;
  const showIncompleteMessage = !setupReady;


  const materialIds = useMemo(() => {
    const fromProps = materiales.map((m: any) => getMaterialId(m)).filter(Boolean).slice(0, 5);
    if (fromProps.length > 0) return fromProps;
    return Array.isArray(resolvedSession?.materialIds) ? resolvedSession.materialIds.slice(0, 5) : [];
  }, [materiales, resolvedSession]);

  const materialNames = useMemo(() => {
    const fromProps = materiales
      .map((m: any) => String(m?.nombre || m?.name || "").trim())
      .filter(Boolean)
      .slice(0, 5);
    if (fromProps.length > 0) return fromProps;
    return Array.isArray(resolvedSession?.materialNames) ? resolvedSession.materialNames.slice(0, 5) : [];
  }, [materiales, resolvedSession]);

  const sourceSelection = useMemo(() => buildSourceSelectionSnapshot(
    materialIds,
    resolvedSession?.selectedPages && Object.keys(resolvedSession.selectedPages).length
      ? resolvedSession.selectedPages
      : selectedPagesProp || {},
  ), [materialIds, resolvedSession?.selectedPages, selectedPagesProp]);

  const lifecycleState = getAdaptiveLifecycleState(resolvedSession
    ? { ...resolvedSession, adaptiveSetup: setup, blueprint, journey }
    : {
        id: sessionId || "",
        temaId: temaId || "",
        processMode: "adaptive",
        materialIds,
        adaptiveSetup: setup,
        blueprint,
        journey,
      });

  // Load profile
  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      if (!userId) { setProfileLoading(false); return; }
      try {
        const res = await fetch("/api/user-profile?userId=" + encodeURIComponent(userId), {
          cache: "no-store", credentials: "same-origin",
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        const up = json?.data || null;
        if (up) {
          setProfile({
            nombre: up.nombre || up.name || null,
            name: up.name || up.nombre || null,
            username: up.username || null,
            tipo_estudiante: up.tipo_estudiante || up.tipo_usuario || null,
            tipo_usuario: up.tipo_usuario || null,
            universidad: up.universidad || null,
            escuela: up.escuela || null,
            carrera: up.carrera || null,
            objetivo: up.objetivo || null,
            edad: up.edad || null,
            genero: up.genero || null,
          });
        }
      } catch {
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }
    loadProfile();
    return () => { cancelled = true; };
  }, [userId]);

  // Load existing session setup + blueprint (server first, localStorage fallback)
  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setRestoreState('RESTORING');
      // El lookup durable es la autoridad. ERROR nunca equivale a ABSENT.
      let durableLookup = temaId
        ? await lookupSessionsFromServer(temaId)
        : { status: 'ABSENT' as const, sessions: [] };
      if (temaId && durableLookup.status === 'ERROR') {
        durableLookup = await lookupSessionsFromServer(temaId);
      }
      if (cancelled) return;

      const allAdaptive = temaId
        ? getSessionsByTema(temaId).filter((s: any) => s.processMode === "adaptive")
        : [];

      if (durableLookup.status === 'ERROR') {
        // Un artefacto local COMPLETO puede seguir sirviéndose durante una caída
        // temporal del lookup: nunca se interpreta como ABSENT ni autoriza IA.
        // Si tampoco existe ese checkpoint completo, se queda en RESTORE_ERROR.
        const localCheckpoint = selectPersistedAdaptiveProgram(allAdaptive, { sessionId, materialIds });
        if (classifyPersistedAdaptiveProgram(localCheckpoint) !== 'FOUND_VALID_PROGRAM') {
          setRestoreState('RESTORE_ERROR');
          setSessionLoadError('No pudimos verificar tu programa guardado. Reintentaremos la restauración sin crear uno nuevo.');
          setSessionLoading(false);
          return;
        }
        durableLookup = { status: 'FOUND', sessions: allAdaptive };
      }

      const keyOf = (ids?: string[]) =>
        [...new Set((ids || []).map((x: any) => String(x || "").trim()).filter(Boolean))]
          .sort()
          .join("|");

      const scoreSession = (s: any) => {
        let score = 0;
        if (s?.adaptiveSetup?.completedAt) score += 10;
        if (s?.blueprint) score += 20;
        if (s?.journey) score += 40;
        return score;
      };

      let sess = selectPersistedAdaptiveProgram(allAdaptive, {
        sessionId,
        materialIds,
        sourceSelectionFingerprint: resolvedSession?.sourceSelectionFingerprint,
      });

      const targetKey = keyOf(
        (sess?.materialIds?.length ? sess.materialIds : materialIds) as string[]
      );

      const bestSess =
        allAdaptive
          .filter((s: any) => !targetKey || keyOf((s.materialIds || []) as string[]) === targetKey)
          .sort((a: any, b: any) => {
            const diff = scoreSession(b) - scoreSession(a);
            if (diff !== 0) return diff;
            return Number(b.lastOpenedAt || 0) - Number(a.lastOpenedAt || 0);
          })[0] || null;

      if (!sessionId && bestSess && (!sess || scoreSession(bestSess) > scoreSession(sess))) {
        sess = bestSess;
      }

      console.log("[StudyALAdaptive] sesión resuelta:", {
        sessionId,
        temaId,
        materialIds,
        allAdaptiveCount: allAdaptive.length,
        allAdaptiveScores: allAdaptive.map((s: any) => ({ id: s.id, score: scoreSession(s), hasSetup: !!s?.adaptiveSetup?.completedAt, hasBlueprint: !!s?.blueprint, hasJourney: !!s?.journey })),
        chosen: sess?.id || null,
        chosenScore: scoreSession(sess),
        chosenHasSetup: !!sess?.adaptiveSetup?.completedAt,
        chosenHasBlueprint: !!sess?.blueprint,
        chosenHasJourney: !!sess?.journey,
      });

      if (cancelled) return;

      if (sessionId && !sess) {
        setRestoreState('NOTHING_EXISTS');
        setSessionLoadError("No se encontró el proceso adaptativo solicitado.");
      } else if (sess) {
        if (userId && (sess as any).userId && String((sess as any).userId) !== String(userId)) {
          setSessionLoadError("La sesión solicitada no pertenece al usuario actual.");
          setSessionLoading(false);
          return;
        }

        const normalizedSession = normalizeAdaptivePlanSnapshot(sess);
        const persistedState = restoreStateFromLookup(durableLookup, normalizedSession);
        setRestoreState(persistedState);
        setResolvedSession(normalizedSession);

        if (normalizedSession.adaptiveSetup?.completedAt) {
          setSetup(normalizedSession.adaptiveSetup);
          if (normalizedSession.setupHash) setCurrentSetupHash(normalizedSession.setupHash);
          setDone(true);
          // AUDITORÍA (StudyAL_Visual_System_Stress_Test, Bug 1C): "adaptiveState
          // === 'ready'" solo se fija cuando blueprint+journey YA se generaron
          // con éxito antes (ver el catch de generación más abajo,
          // `adaptiveState: "ready"`) — ese campo vive en la copia LIVIANA de la
          // sesión (studyal_sessions_v4), nunca se despoja como blueprint/journey/
          // sessionContent, así que sobrevive incluso cuando el artefacto pesado
          // (blueprint/journey) no restauró. Si el programa YA estaba listo antes
          // pero ahora falta blueprint o journey, esto es un FALLO DE RESTORE, no
          // una sesión que nunca generó nada — autorizar generación aquí
          // regeneraría el plan completo cada vez que el usuario sale y vuelve
          // tras cualquier hueco de restauración transitorio. Solo se autoriza
          // automáticamente cuando el programa nunca llegó a 'ready' (primera vez
          // real). Si ya estaba 'ready' y algo no restauró, se muestra un error
          // honesto reutilizando el mismo botón "Reintentar preparación del
          // plan" — la regeneración exige ahora una acción explícita del
          // usuario, nunca es automática tras un restore fallido.
          const restoreGapAfterReady = normalizedSession.adaptiveState === "ready" &&
            (!normalizedSession.blueprint || !normalizedSession.journey);
          if (restoreGapAfterReady) {
            restoreGapPendingRef.current = true;
            setJourneyError(
              "Ya habías completado la preparación de este plan, pero no pudimos restaurar todos los datos guardados. Puedes reintentar la restauración; no se generará un plan nuevo salvo que lo pidas explícitamente."
            );
          } else if (mayGenerateAfterRestore(persistedState) || shouldResumePreparation(persistedState)) {
            generationAuthorizedRef.current = true;
          }
        }

        let loadedBlueprint = normalizedSession.blueprint;
        if (!loadedBlueprint && temaId) {
          try {
            const raw = localStorage.getItem(`studyal_blueprint_${temaId}`);
            if (raw) loadedBlueprint = JSON.parse(raw);
          } catch {}
        }
        if (loadedBlueprint) {
          setBlueprint(loadedBlueprint);
          setStudyPlan(null);
          // Resetear key para que el journey pueda generarse si no existe
          lastJourneyKeyRef.current = null;
        }

        let loadedJourney = normalizedSession.journey;
        if (!loadedJourney && temaId) {
          try {
            const raw = localStorage.getItem(`studyal_journey_${temaId}`);
            if (raw) loadedJourney = JSON.parse(raw);
          } catch {}
        }
        if (loadedJourney) {
          setJourney(loadedJourney);
          setActiveTab("plan");
        } else if (normalizedSession.adaptiveSetup?.completedAt) {
          // No hay journey pero sí setup — intentar generar
          setActiveTab("plan");
          lastJourneyKeyRef.current = null;
          // Solo mostrar error si fue una sesión específica por sessionId — pero
          // NUNCA pisar el mensaje más específico de restoreGapAfterReady (arriba
          // en este mismo efecto): ambos casos comparten el mismo bloque de UI y
          // el mismo botón "Reintentar", pero el mensaje de hueco de restauración
          // es más preciso (explica que NO se generará un plan nuevo salvo acción
          // explícita) que este genérico "crear un plan nuevo explícitamente".
          if (sessionId && !loadedBlueprint && !restoreGapPendingRef.current) {
            setJourneyError("No encontramos el plan persistido solicitado. Puedes volver al mapa o crear un plan nuevo explícitamente.");
          }
        }
      } else setRestoreState('NOTHING_EXISTS');

      // Marcar como listo AL FINAL — después de setear blueprint y journey
      if (!cancelled) setSessionLoading(false);
    }

    loadSession().catch((error) => { if (!cancelled) {
      console.error('[adaptive-restore] durable_lookup_failed', error);
      setRestoreState('RESTORE_ERROR');
      setSessionLoadError('No pudimos verificar tu programa guardado. Reintentaremos la restauración sin crear uno nuevo.');
      setSessionLoading(false);
    } });
    return () => { cancelled = true; };
  }, [sessionId, temaId]);
  // Generate blueprint — solo si sessionLoading terminó Y no hay blueprint ya cargado
  useEffect(() => {
    if (sessionLoading) return;
    if (restoreState === 'UNKNOWN' || restoreState === 'RESTORING' || restoreState === 'FOUND_VALID_PROGRAM') return;
    if (blueprint) return;
    if (blueprintError) return;
    if (!generationAuthorizedRef.current) return;
    if (!mayGenerateAdaptiveArtifacts({
      lifecycleState,
      hasBlueprint: Boolean(blueprint),
      hasJourney: Boolean(journey),
    }) || blueprintLoading) return;
    generateBlueprint();
  }, [sessionLoading, restoreState, blueprint, blueprintError, blueprintLoading, journey, lifecycleState, regenerationTrigger]);

  async function generateBlueprint() {
    if (generationInFlightRef.current) return;
    generationInFlightRef.current = true;
    setBlueprintLoading(true);
    setBlueprintError(null);
    const { token: myToken, signal } = beginGenerationAttempt();
    const stillCurrent = () => generationTrackerRef.current.stillCurrent(myToken);

    try {
      const activeSessionId = resolvedSession?.id || sessionId;
      if (!activeSessionId) throw new Error("No existe un draft adaptativo canónico.");
      const generatingSession = updateSessionById(activeSessionId, current => ({
        ...current,
        adaptiveState: "generating",
      }));
      if (generatingSession) setResolvedSession(generatingSession);

      // Get text content for each material
      const materialsWithText = await Promise.all(
        materiales.slice(0, 5).map(async (m: any) => {
          const matId = m.materialId || m.id;
          let text = m.contenido || "";

          if (!text && matId) {
            try {
              const r = await fetch(`/api/materials/${matId}/download-url`, { credentials: "same-origin", signal });
              if (r.ok) {
                const d = await r.json();
                // Just use materialId for now — text extraction happens server side
                text = d.extractedText || "";
              }
            } catch {}
          }

          // Get session selectedPages
          const selectedPages = sourceSelection.selectedPages[getMaterialId(m)] || [];

          return {
            materialId: getMaterialId(m),
            materialName: m.nombre || m.name || "Material",
            text,
            selectedPages,
          };
        })
      );
      if (!stillCurrent()) return;

      const res = await fetch("/api/adaptive/blueprint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          materials: materialsWithText,
          userProfile: profile,
          adaptiveSetup: setup,
          generationToken: String(myToken),
        }),
        signal,
      });

      const json = await res.json();
      if (!stillCurrent()) return;
      if (!res.ok || !json.success) throw new Error(json.error || "Error generando blueprint");

      setBlueprint(json.blueprint);

      // Generar plan de aprendizaje
      try {
        const plan = await generateStudyPlan(
          json.blueprint,
          setup,
          profile,
          cleanMaterialName,
        );
        if (!stillCurrent()) return;
        setStudyPlan(plan);
        // Ir automáticamente al tab del plan cuando se genera
        setActiveTab("plan");
      } catch (planErr) {
      }
      if (!stillCurrent()) return;

      const blueprintSession = updateSessionById(activeSessionId, current => ({
        ...current,
        blueprint: json.blueprint,
        selectedPages: sourceSelection.selectedPages,
        sourceSelectionFingerprint: sourceSelection.fingerprint,
        adaptiveState: "generating",
      }));
      if (blueprintSession) setResolvedSession(blueprintSession);
    } catch (e: any) {
      // AUDITORÍA (Bug 2): un abort intencional (cleanup/token superseded)
      // nunca debe tratarse como fallo de generación — no marcar
      // adaptiveState:'error' ni mostrar blueprintError por una cancelación
      // deliberada, o el usuario vería un mensaje de error falso la próxima
      // vez que abra esta sesión.
      if (e?.name === "AbortError" || !stillCurrent()) return;
      setBlueprintError(e.message || "Error desconocido");
      const activeSessionId = resolvedSession?.id || sessionId;
      if (activeSessionId) {
        const failed = updateSessionById(activeSessionId, current => ({ ...current, adaptiveState: "error" }));
        if (failed) setResolvedSession(failed);
      }
    } finally {
      generationInFlightRef.current = false;
      setBlueprintLoading(false);
    }
  }

  // Limpiar extensión del nombre del material para mostrar
  const cleanMaterialName = useMemo(() => {
    const raw = materialNames[0] || "material";
    return raw
      .replace(/\.(pdf|docx?|pptx?|txt|png|jpg|jpeg|webp)$/i, '')
      .split(' ')
      .map((w: string) => w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w)
      .join(' ');
  }, [materialNames]);

  useEffect(() => {
    if (!setupReady || !blueprintReady || blueprintDegraded) {
      setJourney(null);
      // No pisar el mensaje de hueco de restauración pendiente — este efecto
      // existe para limpiar journeyError STALE cuando el blueprint todavía
      // no está listo en el flujo normal, pero el escenario de hueco se
      // define precisamente por blueprint ausente; borrarlo aquí anulaba el
      // mensaje de recovery en el mismo tick en que se mostraba.
      if (!restoreGapPendingRef.current) setJourneyError(null);
      return;
    }

    // ✅ Si ya tenemos journey cargado (de localStorage o sesión), no regenerar
    if (journey) {
      setActiveTab("plan");
      return;
    }
    if (journeyError) return;
    if (!generationAuthorizedRef.current) return;
    if (!mayGenerateAdaptiveArtifacts({
      lifecycleState,
      hasBlueprint: true,
      hasJourney: false,
    })) return;

    const journeyKey = JSON.stringify({
      material: materialNames[0] || "Material",
      setupHash: currentSetupHash || '',
      topicCount: (blueprint?.topics?.length || blueprint?.topicsIndex?.length || 0),
      blockCount: (blueprint?.blocks?.length || blueprint?.globalOrderedAnalysis?.length || 0),
    });

    // Evitar doble ejecución (StrictMode / rerenders)
    if (lastJourneyKeyRef.current === journeyKey) {
      return;
    }
    lastJourneyKeyRef.current = journeyKey;

    // AUDITORÍA (Bug 2): journey siempre corre DESPUÉS de blueprint dentro del
    // MISMO intento real — reutiliza el token/controller que blueprint ya
    // registró en vez de crear uno nuevo (eso invalidaría la identidad del
    // intento vigente sin motivo). Si por algún camino no había un controller
    // activo (p.ej. journey restaurado sin haber pasado por generateBlueprint
    // en este montaje), se crea uno propio para no dejar esta llamada sin
    // señal de cancelación.
    const existingSignal = generationTrackerRef.current.currentSignal;
    const { token: myToken, signal } = existingSignal
      ? { token: generationTrackerRef.current.currentToken, signal: existingSignal }
      : beginGenerationAttempt();
    const stillCurrent = () => generationTrackerRef.current.stillCurrent(myToken);

    // async IIFE para poder usar await dentro de useEffect
    (async () => {
    try {
      // Llamar al servidor para generar el journey
      // Esto evita el double-call de StrictMode y mantiene las keys seguras
      const res = await fetch('/api/adaptive/generate-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blueprint,
          setup,
          materialTitle: materialNames[0] || "Material",
          quality: blueprintQuality,  // pasar quality para que el servidor pueda bloquear
          generationToken: String(myToken),
        }),
        signal,
      });

      const data = await res.json();
      if (!stillCurrent()) return;

      // Si el blueprint está degradado, el servidor devuelve 422
      if (res.status === 422 && data.degraded) {
        setJourney(null);
        setBlueprintQuality(data.quality || blueprintQuality);
        setJourneyError('El análisis del material quedó incompleto. Intenta regenerar el análisis.');
        return;
      }

      if (!data.success || !data.journey) {
        throw new Error(data.error || 'No se pudo generar el plan');
      }

      const j = data.journey;
      setJourney(j);
      setJourneyError(null);
      const activeSessionId = resolvedSession?.id || sessionId;
      if (!activeSessionId) throw new Error("No existe un draft adaptativo canónico.");
      const readySession = updateSessionById(activeSessionId, current => ({
        ...current,
        blueprint: blueprint || current.blueprint,
        journey: j,
        selectedPages: sourceSelection.selectedPages,
        sourceSelectionFingerprint: sourceSelection.fingerprint,
        adaptiveState: "ready",
      }));
      if (readySession) setResolvedSession(readySession);
      // Pipeline continuo: en cuanto el plan es durable, empieza Session 1.
      // Usa el mismo attempt/signal del plan, por lo que salir del modo aborta
      // la petición y un resultado stale nunca se persiste.
      const firstChapter = (j.chapters || []).find((chapter: any) => chapter.chapterNumber === 1)
      if (readySession && firstChapter && firstChapter.kind !== 'final_review' && stillCurrent()) {
        const dependencyFingerprint = computeSessionDependencyFingerprint({
          chapterId:firstChapter.id, chapterBlockIds:firstChapter.blockIds || [], blueprintVersion:blueprint?.version || 0,
          journeyId:j.id || 'current', journeyVersion:j.version || j.id || 'current', setupSnapshot:setup,
          materialHash:sourceSelection.fingerprint,
        })
        const dedupeKey = `${readySession.id}:1:${dependencyFingerprint}`
        void sharedSessionPreparationRequests.run(dedupeKey, sharedSignal => fetch('/api/adaptive/session-teach', {
          method:'POST', headers:{'content-type':'application/json'}, signal:sharedSignal,
          body:JSON.stringify({
            session:firstChapter, blueprint, userProfile:profile || {}, setup,
            setupHash:currentSetupHash || readySession.setupHash,
            materialTitle:materialNames[0] || 'Material', materialType:'general',
            materialHash:sourceSelection.fingerprint, sourceSelectionFingerprint:sourceSelection.fingerprint,
            planVersion:j.id || j.version || 'current',
            totalSessions:(j.chapters || []).length, userId,
            allBlocks:blueprint?.blocks || [], allTopics:blueprint?.topics || [],
            primaryBlockIds:firstChapter.blockIds || [], requestOrigin:'prefetch',
            preparationState:(readySession.sessionPreparation as any)?.['1'],
          }),
        }).then(response=>response.json())).then(prefetched=>{
          if(!stillCurrent()||!prefetched?.success||!prefetched?.classContent)return
          prefetched.classContent._prefetchMeta = {
            dependencyFingerprint,
            preparedAt:Date.now(),
            sourceBlueprintVersion:blueprint?.version || 0,
            journeyVersion:j.version || j.id || 'current',
          }
          const persisted=updateSessionById(readySession.id,(current:any)=>({...current,sessionPreparation:{...(current.sessionPreparation||{}),'1':prefetched.classContent.preparationState},sessionContent:{...(current.sessionContent||{}),'1':prefetched.classContent}}))
          if(persisted)setResolvedSession(persisted)
        }).catch(prefetchError=>{if(prefetchError?.name!=='AbortError')console.warn('[adaptive-prefetch] session_1_failed_retryable')})
      }
    } catch (err: any) {
      // AUDITORÍA (Bug 2): mismo criterio que generateBlueprint — un abort
      // intencional (cleanup/token superseded) nunca es un error de producto.
      if (err?.name === "AbortError" || !stillCurrent()) return;
      console.error("[StudyALAdaptive] Error construyendo journey reactivo:", err?.message || err);
      lastJourneyKeyRef.current = null;
      setJourney(null);
      setJourneyError(err?.message || "No se pudo construir el plan adaptativo");
      const activeSessionId = resolvedSession?.id || sessionId;
      if (activeSessionId) {
        const failed = updateSessionById(activeSessionId, current => ({ ...current, adaptiveState: "error" }));
        if (failed) setResolvedSession(failed);
      }
    }
    })(); // fin async IIFE
  }, [
    setupReady,
    blueprintReady,
    blueprintDegraded,
    blueprint,
    setup,
    materialNames,
    lifecycleState,
    resolvedSession,
    sessionId,
    journeyError,
  ]);

  const userSummary = useMemo(() => {
    const nombre = profile?.nombre || profile?.name || profile?.username || "Estudiante";
    const tipo = profile?.tipo_estudiante || profile?.tipo_usuario || "usuario";
    const lugar = profile?.universidad || profile?.escuela || null;
    const carrera = profile?.carrera || null;
    const objetivo = profile?.objetivo || null;
    const edad = profile?.edad || null;
    const genero = profile?.genero || null;
    return { nombre, tipo, lugar, carrera, objetivo, edad, genero };
  }, [profile]);

  const stepTitles = [
    "¿Qué tanto conoces este material?",
    "¿Cuándo es tu examen?",
    "¿Qué nota buscas?",
    "¿Qué te preocupa más de este material?",
    "¿Cómo quieres estudiar?",
    "¿Cómo quieres ver tu plan?",
  ];

  function toggleExamStyle(id: string) {
    setSetup((prev) => {
      const set = new Set(prev.professorExamStyle || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, professorExamStyle: Array.from(set) };
    });
  }

  function canContinue() {
    if (step === 0) return !!setup.knowledgeLevel;
    if (step === 1) {
      if (setup.examDateType !== "custom") return true;
      return !!String(setup.examDateCustom || "").trim();
    }
    if (step === 2) return Number(setup.targetScore) >= 50;
    if (step === 3) return String(setup.mainConcern || "").trim().length >= 2 || setup.mainConcern === "(omitido)";

    if (step === 4) return !!setup.evalPreference;
    if (step === 5) return !!setup.planView;
    return true;
  }

  function next() {
    if (!canContinue()) return;
    if (step < stepTitles.length - 1) { setStep((s) => s + 1); return; }
    const finalSetup: AdaptiveSetup = { ...setup, completedAt: Date.now() };
    generationAuthorizedRef.current = true;
    setRestoreState('NOTHING_EXISTS');
    const newHash = hashSetup(finalSetup);
    setCurrentSetupHash(newHash);
    const activeSessionId = resolvedSession?.id || sessionId;
    const persisted = upsertSession({
      id: activeSessionId || undefined,
      userId,
      temaId: temaId || "",
      enfoque: "teorico",
      processMode: "adaptive",
      materialIds,
      primaryMaterialId: materialIds[0],
      materialNames,
      adaptiveSetup: finalSetup,
      setupHash: newHash,
      adaptiveState: "setup_complete",
      selectedPages: sourceSelection.selectedPages,
      sourceSelectionFingerprint: sourceSelection.fingerprint,
    });
    setResolvedSession(persisted);
    setSetup(finalSetup);
    setDone(true);
    // Limpiar estado anterior para evitar contaminación
    setBlueprint(null);
    setBlueprintQuality(null);
    setStudyPlan(null);
    setJourney(null);
    setJourneyError(null);
  }

  function back() {
    if (step > 0) setStep((s) => s - 1);
  }

  const progress = Math.round(((step + 1) / stepTitles.length) * 100);

  const examDateLabel =
    setup.examDateType === "today" ? "Hoy"
    : setup.examDateType === "tomorrow" ? "Mañana"
    : setup.examDateType === "this_week" ? "Esta semana"
    : setup.examDateType === "custom" ? (setup.examDateCustom || "Fecha personalizada")
    : "Solo quiero estudiar";

  const examStyleLabels = (setup.professorExamStyle || []).map((id) => {
    const found = examStyleOptions.find((x) => x.id === id);
    return found?.label || id;
  });

  // ═══════════════════════════════════════
  // DONE — RESUMEN COMPLETO
  // ═══════════════════════════════════════
  if (done) {


    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "radial-gradient(circle at 20% 10%, rgba(56,189,248,.14), transparent 28%), linear-gradient(135deg, var(--bg-primary), color-mix(in srgb, var(--bg-primary) 78%, #000))",
        color: "var(--text-primary)",
        display: "flex", flexDirection: "column",
        fontFamily: BODY,
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 24px",
          borderBottom: "1.5px solid var(--border-color)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexShrink: 0, gap: 16, flexWrap: "wrap",
          background: "color-mix(in srgb, var(--bg-card) 90%, transparent)",
        }}>
          <div>
            <div style={{ fontFamily: HAND, fontSize: 20, color: "#38bdf8" }}>🤖 modo adaptativo</div>
            <h1 style={{ margin: "4px 0 0", fontSize: 36, fontFamily: HAND, fontWeight: 900, color: "#fff" }}>
              {cleanMaterialName}
            </h1>
          </div>
          <button onClick={onClose} style={{
            padding: "12px 24px", background: "#38bdf8", color: "#000",
            border: "2px solid var(--text-primary)", borderRadius: 14,
            fontFamily: HAND, fontSize: 20, fontWeight: 800, cursor: "pointer",
          }}>← volver al mapa</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: 0, borderBottom: "1.5px solid var(--border-color)",
          flexShrink: 0,
          background: "color-mix(in srgb, var(--bg-card) 80%, transparent)",
          overflowX: "auto",
        }}>
          {([
            { id: "perfil",    label: "Yo soy este",          emoji: "👤" },
            { id: "setup",     label: "Mi setup",             emoji: "⚙️" },
            { id: "blueprint", label: "Análisis",             emoji: "🗺️" },
            { id: "plan",      label: "Mi plan",              emoji: "📋" },
          ] as const).map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: "12px 20px",
                background: activeTab === tab.id ? "rgba(56,189,248,.15)" : "transparent",
                border: "none",
                borderBottom: activeTab === tab.id ? "2px solid #38bdf8" : "2px solid transparent",
                color: activeTab === tab.id ? "#38bdf8" : "var(--text-muted)",
                fontFamily: BODY, fontSize: 13, fontWeight: 800,
                cursor: "pointer", transition: "all .2s",
                display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              }}>
              <span>{tab.emoji}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

          {/* TAB: PERFIL */}
          {activeTab === "perfil" && (
            <div style={{ maxWidth: 700, margin: "0 auto", display: "grid", gap: 16 }}>
              <div style={{ background: "var(--bg-card)", border: "1.5px solid var(--border-color)", borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: HAND, fontSize: 28, color: "#38bdf8", marginBottom: 16 }}>yo soy este</div>
                {profileLoading ? (
                  <div style={{ color: "var(--text-muted)" }}>Cargando perfil...</div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={{ fontSize: 28, fontFamily: HAND, fontWeight: 900, color: "#fff" }}>{userSummary.nombre}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {[
                        { label: "👤 " + userSummary.tipo, show: !!userSummary.tipo },
                        { label: "🎂 " + userSummary.edad + " años", show: !!userSummary.edad },
                        { label: "🏫 " + userSummary.lugar, show: !!userSummary.lugar },
                        { label: "📚 " + userSummary.carrera, show: !!userSummary.carrera },
                        { label: "🎯 " + userSummary.objetivo, show: !!userSummary.objetivo },
                      ].filter(x => x.show).map((x, i) => (
                        <div key={i} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: 999, padding: "6px 14px", fontSize: 14, fontWeight: 700 }}>{x.label}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ background: "var(--bg-card)", border: "1.5px solid var(--border-color)", borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: HAND, fontSize: 24, color: "#38bdf8", marginBottom: 12 }}>material seleccionado</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {materialNames.map((name, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--bg-secondary)", borderRadius: 12, fontSize: 14, fontWeight: 700 }}>
                      <span>📄</span> {name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: SETUP */}
          {activeTab === "setup" && (
            <div style={{ maxWidth: 700, margin: "0 auto" }}>
              <div style={{ background: "var(--bg-card)", border: "1.5px solid var(--border-color)", borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: HAND, fontSize: 28, color: "#38bdf8", marginBottom: 16 }}>así quise hacer mi setup para este material</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  {[
                    ["Conocimiento inicial", knowledgeLabels[setup.knowledgeLevel] || setup.knowledgeLevel],
                    ["Examen", examDateLabel],
                    ["Nota buscada", setup.targetScore + "%"],
                    ["Qué me preocupa", setup.mainConcern === "(omitido)" ? "No especificado" : (setup.mainConcern || "No definido")],
                    ["Cómo quiero ser evaluado", evalLabels[setup.evalPreference] || setup.evalPreference],
                    ["Cómo quiero ver el plan", planViewLabels[setup.planView] || setup.planView],
                  ].map(([label, value], i) => (
                    <div key={i} style={{ background: "var(--bg-secondary)", borderRadius: 14, padding: 16 }}>
                      <div style={{ color: "var(--text-faint)", fontSize: 12, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontWeight: 900, fontSize: 15 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: PLAN */}
          {activeTab === "plan" && (
            <div style={{ maxWidth: 680, margin: "0 auto" }}>
              {blueprintLoading && (
                <div style={{ textAlign: "center", padding: 60 }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>✨</div>
                  <div style={{ fontFamily: HAND, fontSize: 28, color: "#38bdf8", marginBottom: 8 }}>
                    Generando tu plan adaptativo...
                  </div>
                  <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    ALAI está analizando el material y construyendo<br/>
                    un recorrido diseñado específicamente para ti.
                  </div>
                  <div style={{
                    marginTop: 20,
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "8px 20px",
                    border: "1.5px solid #38bdf8",
                    borderRadius: 999,
                    color: "#38bdf8", fontSize: 14,
                  }}>
                    <div style={{
                      width: 12, height: 12,
                      border: "2px solid #38bdf8",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                    }} />
                    Analizando...
                  </div>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              )}

              {showGeneratingPlan && (
                <div style={{ textAlign: "center", padding: 60 }}>
                  <div style={{ fontSize: 42, marginBottom: 14 }}>📖</div>
                  <div style={{ fontFamily: HAND, fontSize: 26, color: "#38bdf8", marginBottom: 8 }}>
                    Generando tu plan...
                  </div>
                  <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    El análisis ya está listo. Ahora ALAI está organizando<br/>
                    el mejor recorrido posible para ti.
                  </div>
                </div>
              )}

              {showIncompleteMessage && (
                <div style={{ textAlign: "center", padding: 60 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                  <div style={{ fontFamily: HAND, fontSize: 24, color: "var(--text-muted)" }}>
                    Completa el setup para ver tu plan
                  </div>
                </div>
              )}

              {setupReady && !blueprintReady && !blueprintError && !blueprintLoading && !journeyError && (
                <div style={{ textAlign: "center", padding: 60 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                  <div style={{ fontFamily: HAND, fontSize: 24, color: "#38bdf8" }}>
                    Preparando el análisis inicial…
                  </div>
                </div>
              )}

              {journeyError && !journeyReady && (
                <div style={{
                  background: "rgba(239,68,68,.10)",
                  border: "1.5px solid rgba(239,68,68,.35)",
                  borderRadius: 18,
                  padding: 18,
                  marginBottom: 22,
                }}>
                  <div style={{ fontFamily: HAND, fontSize: 22, color: "#ef4444", marginBottom: 8 }}>
                    ⚠️ no se pudo construir el plan
                  </div>
                  <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    {journeyError}
                  </div>
                  <button
                    onClick={() => {
                      restoreGapPendingRef.current = false;
                      generationAuthorizedRef.current = true;
                      lastJourneyKeyRef.current = null;
                      setJourneyError(null);
                      const activeSessionId = resolvedSession?.id || sessionId;
                      if (activeSessionId) {
                        const retrying = updateSessionById(activeSessionId, current => ({
                          ...current,
                          adaptiveState: "setup_complete",
                        }));
                        if (retrying) setResolvedSession(retrying);
                      }
                      // Fuerza al efecto de generación a reevaluarse aunque
                      // lifecycleState ya fuera 'setup_complete' antes del clic
                      // (caso restoreGapAfterReady — ver declaración arriba).
                      setRegenerationTrigger(n => n + 1);
                    }}
                    style={{ marginTop: 14, padding: "10px 16px", borderRadius: 10, border: 0, cursor: "pointer" }}
                  >
                    Reintentar preparación del plan
                  </button>
                </div>
              )}

              {blueprintDegraded && (
                <div style={{
                  background: "rgba(251,191,36,.10)",
                  border: "1.5px solid rgba(251,191,36,.45)",
                  borderRadius: 18,
                  padding: 18,
                  marginBottom: 22,
                }}>
                  <div style={{ fontFamily: HAND, fontSize: 22, color: "#fbbf24", marginBottom: 8 }}>
                    ⚠️ análisis degradado
                  </div>
                  <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    El material fue analizado, pero la estructura pedagógica no quedó lo suficientemente confiable como para construir un recorrido completo.
                  </div>
                  {(blueprintQuality?.reasons?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                      {(blueprintQuality?.reasons ?? []).map((r: string, i: number) => (
                        <div key={i} style={{ fontSize: 13, color: "#fbbf24", display: "flex", gap: 8 }}>
                          <span>•</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {canShowPlan && journey && (
                <div style={{ display: "grid", gap: 0 }}>

                  {/* ── Header del programa ── */}
                  <div style={{
                    background: "var(--bg-card)",
                    border: "1.5px solid var(--border-color)",
                    borderRadius: 20, padding: 24, marginBottom: 24,
                  }}>
                    <div style={{ fontFamily: HAND, fontSize: 14, color: "#38bdf8", marginBottom: 4 }}>
                      📖 tu viaje de aprendizaje
                    </div>
                    <div style={{ fontFamily: HAND, fontSize: 30, fontWeight: 900, color: "#fff", marginBottom: 10 }}>
                      {journey?.programGoal ?? ""}
                    </div>
                    <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 14 }}>
                      {journey?.programNarrative ?? ""}
                    </div>

                    {(journey?.planBadges?.length ?? 0) > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                        {(journey?.planBadges ?? []).map((badge: string, i: number) => (
                          <span key={i} style={{
                            fontSize: 12,
                            padding: "4px 10px",
                            background: "rgba(56,189,248,.10)",
                            color: "#38bdf8",
                            borderRadius: 999,
                            fontWeight: 700,
                            border: "1px solid rgba(56,189,248,.25)"
                          }}>
                            {badge}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, padding: "4px 12px", background: "rgba(56,189,248,.12)", color: "#38bdf8", borderRadius: 999, fontWeight: 700 }}>
                        {journey?.totalChapters ?? 0} sesiones
                      </span>
                      <span style={{ fontSize: 13, padding: "4px 12px", background: "rgba(74,222,128,.12)", color: "#4ade80", borderRadius: 999, fontWeight: 700 }}>
                        {blueprintDegraded ? "cobertura en revisión" : "cobertura textual completa"}
                      </span>

                    </div>
                  </div>

                  {/* ── Mapa visual — el viaje ── */}
                  <div style={{ position: "relative" }}>
                    {(journey?.chapters ?? []).map((chapter, idx) => {
                      const isFirst = idx === 0;
                      const isLast = idx === journey.chapters.length - 1;
                      const isAvailable = chapter.status === "available";
                      const isDone = chapter.status === "done";
                      const isLocked = chapter.status === "locked";

                      const chapterColor =
                        chapter.kind === "introduction"  ? "#38bdf8" :
                        chapter.kind === "final_review"  ? "#4ade80" :
                        chapter.arcRole === "foundation"   ? "#38bdf8" :
                        chapter.arcRole === "problem"      ? "#fbbf24" :
                        chapter.arcRole === "mechanism"     ? "#4ade80" :
                        chapter.arcRole === "application"     ? "#a78bfa" :
                        chapter.arcRole === "context"  ? "#fb923c" :
                        chapter.arcRole === "integration"  ? "#f472b6" :
                        "#a78bfa";

                      const chapterEmoji =
                        chapter.kind === "introduction"  ? "📖" :
                        chapter.kind === "final_review"  ? "🏁" :
                        chapter.arcRole === "foundation"  ? "🗺️" :
                        chapter.arcRole === "problem"     ? "❓" :
                        chapter.arcRole === "mechanism"    ? "💡" :
                        chapter.arcRole === "application"    ? "🔬" :
                        chapter.arcRole === "context" ? "🌊" :
                        chapter.arcRole === "integration" ? "🏆" :
                        "📘";

                      return (
                        <div key={chapter.chapterNumber}
                          style={{ display: "flex", gap: 0, alignItems: "stretch" }}>

                          {/* Línea + nodo */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 48, flexShrink: 0 }}>
                            <div style={{
                              width: 40, height: 40, borderRadius: "50%",
                              background: isDone ? "#4ade80" : isAvailable ? chapterColor : "var(--bg-secondary)",
                              border: `2px solid ${isDone ? "#4ade80" : isAvailable ? chapterColor : "var(--border-color)"}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 18, flexShrink: 0,
                              boxShadow: isAvailable ? `0 0 16px ${chapterColor}44` : "none",
                              transition: "all .2s", zIndex: 1,
                            }}>
                              {isDone ? "✓" : isLocked ? "🔒" : chapterEmoji}
                            </div>
                            {!isLast && (
                              <div style={{
                                width: 2, flex: 1, minHeight: 24,
                                background: isDone
                                  ? "#4ade80"
                                  : `linear-gradient(to bottom, ${chapterColor}80, var(--border-color))`,
                              }} />
                            )}
                          </div>

                          {/* Tarjeta */}
                          <div
                            onClick={(e) => {
                              if (isLocked) return;
                              // Feedback visual inmediato
                              const target = e.currentTarget as HTMLDivElement;
                              target.style.transform = "scale(0.98)";
                              target.style.opacity = "0.6";
                              target.style.pointerEvents = "none";
                              // Overlay de loading
                              const overlay = document.createElement("div");
                              overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,0.85);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;color:#e2e8f0;font-size:16px;font-weight:600;flex-direction:column;gap:12px;`;
                              overlay.innerHTML = `<div style="font-size:48px">📚</div><div>Abriendo sesión ${chapter.chapterNumber}...</div>`;
                              document.body.appendChild(overlay);
                              const stableSessionId = resolvedSession?.id || sessionId;
                              if (!stableSessionId) return;
                              window.location.href = adaptiveSessionRoute(String(temaId || ""), stableSessionId, chapter.chapterNumber);
                            }}
                            style={{
                              flex: 1, marginLeft: 12,
                              marginBottom: isLast ? 0 : 12,
                              background: isAvailable
                                ? `linear-gradient(135deg, ${chapterColor}10, var(--bg-card))`
                                : "var(--bg-card)",
                              border: `1.5px solid ${isAvailable ? chapterColor + "60" : "var(--border-color)"}`,
                              borderRadius: 16,
                              padding: "18px 20px",
                              opacity: isLocked ? 0.65 : 1,
                              transition: "all .15s",
                              cursor: isLocked ? "not-allowed" : "pointer",
                            }}
                            onMouseEnter={(e) => {
                              if (!isLocked) {
                                (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                                (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 24px ${chapterColor}30`;
                              }
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                              (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                            }}
                          >
                            {/* Solo número de sesión */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 12, color: "var(--text-faint)", fontWeight: 700 }}>
                                Sesión {chapter.chapterNumber}
                              </span>
                            </div>

                            {/* Título narrativo */}
                            <div style={{
                              fontFamily: HAND, fontSize: 22, fontWeight: 900,
                              color: isLocked ? "var(--text-muted)" : "#fff",
                              lineHeight: 1.2, marginBottom: 8,
                            }}>
                              {chapter.title}
                            </div>

                            {/* Hook — solo en available o intro */}
                            {(!isLocked || chapter.kind === "introduction") && (
                              <div style={{
                                fontSize: 14, color: "var(--text-muted)",
                                lineHeight: 1.6, marginBottom: 10,
                              }}>
                                {chapter.hook}
                              </div>
                            )}

                            {/* Objetivo */}
                            {!isLocked && (
                              <div style={{
                                fontSize: 14, color: "var(--text-primary)",
                                lineHeight: 1.5, marginBottom: 10,
                                fontWeight: 600,
                              }}>
                                {chapter.objective}
                              </div>
                            )}

                            {/* Por qué existe */}
                            {!isLocked && chapter.kind === "learning" && (
                              <div style={{
                                fontSize: 12, color: "var(--text-faint)",
                                marginBottom: 10,
                                display: "flex", alignItems: "flex-start", gap: 6,
                              }}>
                                <span style={{ flexShrink: 0 }}>→</span>
                                <span>{chapter.why}</span>
                              </div>
                            )}

                            {/* Exit criteria — solo sesión activo/disponible, no intro */}
                            {isAvailable && chapter.kind !== "introduction" && (chapter.exitCriteria?.length ?? 0) > 0 && (
                              <div style={{
                                marginTop: 10, paddingTop: 10,
                                borderTop: "1px solid var(--border-color)",
                              }}>
                                <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6, fontWeight: 700 }}>
                                  AL TERMINAR ESTA SESIÓN PODRÁS:
                                </div>
                                <div style={{ display: "grid", gap: 4 }}>
                                  {chapter.exitCriteria.map((c, ci) => (
                                    <div key={ci} style={{
                                      fontSize: 12, color: "var(--text-muted)",
                                      display: "flex", gap: 6, alignItems: "flex-start",
                                    }}>
                                      <span style={{ color: chapterColor, flexShrink: 0 }}>✓</span>
                                      {c}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Unlock message */}
                            {!isLocked && chapter.kind !== "final_review" && chapter.unlockMessage && (
                              <div style={{
                                marginTop: 10, fontSize: 12,
                                color: chapterColor, fontWeight: 600,
                                display: "flex", alignItems: "flex-start", gap: 6,
                              }}>
                                <span>🔓</span>
                                <span>{chapter.unlockMessage}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer */}
                  <div style={{
                    marginTop: 24, padding: "16px 20px",
                    background: "var(--bg-secondary)",
                    borderRadius: 14, border: "1px solid var(--border-color)",
                  }}>
                    <div style={{ fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>🤖</span>
                      <span>
                        Este es tu <strong style={{ color: "var(--text-muted)" }}>plan actual</strong>.
                        ALAI puede reorganizarlo conforme obtiene evidencia real de tu aprendizaje.
                        La cobertura siempre será del 100%.
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: BLUEPRINT */}
          {activeTab === "blueprint" && (
            <div style={{ maxWidth: 900, margin: "0 auto" }}>
              {blueprintLoading && (
                <div style={{ textAlign: "center", padding: 60 }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
                  <div style={{ fontFamily: HAND, fontSize: 28, color: "#38bdf8", marginBottom: 8 }}>
                    ALAI está analizando el material...
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 15 }}>
                    Extrayendo topics, conceptos, fórmulas y más. Esto puede tomar un momento.
                  </div>
                  <div style={{
                    marginTop: 24,
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "8px 20px",
                    border: "1.5px solid #38bdf8",
                    borderRadius: 999,
                    color: "#38bdf8", fontSize: 14,
                  }}>
                    <div style={{
                      width: 14, height: 14,
                      border: "2px solid #38bdf8",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                    }} />
                    Analizando...
                  </div>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              )}

              {!blueprintLoading && blueprintError && (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
                  <div style={{ fontFamily: HAND, fontSize: 24, color: "#f87171", marginBottom: 12 }}>
                    Error generando el análisis
                  </div>
                  <div style={{ color: "var(--text-muted)", marginBottom: 20 }}>{blueprintError}</div>
                  <button onClick={() => {
                    generationAuthorizedRef.current = true;
                    void generateBlueprint();
                  }} style={{
                    padding: "10px 24px", background: "#38bdf8", color: "#000",
                    border: "none", borderRadius: 12,
                    fontFamily: BODY, fontWeight: 900, cursor: "pointer",
                  }}>Reintentar</button>
                </div>
              )}

              {!blueprintLoading && !blueprintError && !blueprint && setupReady && (
                <div style={{ textAlign: "center", padding: 60 }}>
                  <div style={{ fontSize: 44, marginBottom: 14 }}>🔍</div>
                  <div style={{ fontFamily: HAND, fontSize: 26, color: "#38bdf8" }}>
                    Preparando el análisis inicial…
                  </div>
                </div>
              )}

              {!blueprintLoading && !blueprintError && blueprint && (
                <div style={{ display: "grid", gap: 20 }}>
                  {/* Coverage summary */}
                  <div style={{
                    background: "var(--bg-card)", border: "1.5px solid var(--border-color)",
                    borderRadius: 20, padding: 20,
                    display: "flex", gap: 16, flexWrap: "wrap",
                  }}>
                    {[
                      { label: "Topics", value: blueprint.coverageSummary.totalTopics, emoji: "📌" },
                      { label: "Conceptos", value: blueprint.uniqueConceptsIndex?.filter((c: any) => c.kind === "concept" || c.kind === "definition" || c.kind === "formula").length ?? blueprint.coverageSummary.totalUniqueConcepts, emoji: "💡" },
                      { label: "Bloques analizados", value: blueprint.coverageSummary.totalBlocks, emoji: "🧩" },
                      { label: "Páginas cubiertas", value: (() => { const pages = new Set<number>(); (blueprint.globalOrderedAnalysis || []).forEach((b: any) => (b.pages || []).forEach((p: number) => pages.add(p))); return pages.size; })(), emoji: "📄" },
                    ].map((stat, i) => (
                      <div key={i} style={{
                        flex: "1 1 120px",
                        background: "var(--bg-secondary)", borderRadius: 14, padding: "12px 16px",
                        textAlign: "center",
                      }}>
                        <div style={{ fontSize: 24 }}>{stat.emoji}</div>
                        <div style={{ fontSize: 28, fontFamily: HAND, fontWeight: 900, color: "#38bdf8" }}>
                          {stat.value}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Topics index */}
                  {blueprint.topicsIndex?.length > 0 && (
                    <div style={{
                      background: "var(--bg-card)", border: "1.5px solid var(--border-color)",
                      borderRadius: 20, padding: 20,
                    }}>
                      <div style={{ fontFamily: HAND, fontSize: 24, color: "#38bdf8", marginBottom: 14 }}>
                        📌 Topics detectados ({blueprint.topicsIndex.length})
                      </div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {blueprint.topicsIndex.map((topic: any, i: number) => (
                          <div key={i} style={{
                            background: "var(--bg-secondary)", borderRadius: 12,
                            padding: "12px 16px",
                            borderLeft: "3px solid #38bdf8",
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                              <div>
                                <div style={{ fontWeight: 900, fontSize: 15 }}>
                                  {i + 1}. {topic.title}
                                </div>
                                {topic.summary && (
                                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                                    {topic.summary}
                                  </div>
                                )}
                              </div>
                              {topic.pages?.length > 0 && (
                                <div style={{
                                  fontSize: 12, color: "var(--text-faint)",
                                  flexShrink: 0, whiteSpace: "nowrap",
                                }}>
                                  p. {topic.pages.slice(0, 3).join(", ")}
                                  {topic.pages.length > 3 ? "..." : ""}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Global ordered analysis */}
                  {blueprint.globalOrderedAnalysis?.length > 0 && (
                    <div style={{
                      background: "var(--bg-card)", border: "1.5px solid var(--border-color)",
                      borderRadius: 20, padding: 20,
                    }}>
                      <div style={{ fontFamily: HAND, fontSize: 24, color: "#38bdf8", marginBottom: 14 }}>
                        🗺️ Análisis completo en orden ({blueprint.globalOrderedAnalysis.length} elementos)
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {blueprint.globalOrderedAnalysis.map((block: any, i: number) => (
                          <div key={i} style={{
                            background: "var(--bg-secondary)", borderRadius: 10,
                            padding: "10px 14px",
                            borderLeft: block.kind === "topic"
                              ? "3px solid #38bdf8"
                              : block.kind === "formula"
                                ? "3px solid #a78bfa"
                                : block.kind === "definition"
                                  ? "3px solid #4ade80"
                                  : block.kind === "common_mistake"
                                    ? "3px solid #ef4444"
                                    : block.kind === "entity"
                                      ? "3px solid #fbbf24"
                                      : block.kind === "fact"
                                        ? "3px solid #fb923c"
                                        : "3px solid var(--border-color)",
                            marginLeft: ["topic"].includes(block.kind) ? 0 : 16,
                          }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                              <span style={{ fontSize: 16, flexShrink: 0 }}>
                                {kindEmoji[block.kind] || "📋"}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  display: "flex", gap: 8, alignItems: "center",
                                  flexWrap: "wrap",
                                }}>
                                  <span style={{ fontWeight: 900, fontSize: 14 }}>{block.label}</span>
                                  <span style={{
                                    fontSize: 11, padding: "2px 8px",
                                    background: "var(--bg-card)", borderRadius: 999,
                                    color: "var(--text-faint)", flexShrink: 0,
                                  }}>
                                    {kindLabel[block.kind] || block.kind}
                                  </span>
                                </div>
                                {block.summary && (
                                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                                    {block.summary}
                                  </div>
                                )}
                                {(block.importance > 0 || block.difficulty || block.dependsOn?.length > 0) && (
                                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                                    {block.importance >= 80 && (
                                      <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(239,68,68,.15)", color: "#ef4444", borderRadius: 999, fontWeight: 800 }}>
                                        ★ {block.importance}% importancia
                                      </span>
                                    )}
                                    {block.importance >= 50 && block.importance < 80 && (
                                      <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(251,191,36,.15)", color: "#fbbf24", borderRadius: 999, fontWeight: 800 }}>
                                        {block.importance}% importancia
                                      </span>
                                    )}
                                    {block.difficulty && block.difficulty !== "basic" && (
                                      <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(167,139,250,.15)", color: "#a78bfa", borderRadius: 999, fontWeight: 800 }}>
                                        {block.difficulty === "advanced" ? "Avanzado" : "Intermedio"}
                                      </span>
                                    )}
                                    {block.dependsOn?.length > 0 && (
                                      <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(56,189,248,.12)", color: "#38bdf8", borderRadius: 999, fontWeight: 700 }}>
                                        depende de {block.dependsOn.length}
                                      </span>
                                    )}
                                    {block.bloomLevel && block.bloomLevel !== "understand" && (
                                      <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(52,211,153,.12)", color: "#34d399", borderRadius: 999, fontWeight: 700 }}>
                                        {{"remember":"🧠 Recordar","understand":"💡 Entender","apply":"⚙️ Aplicar","analyze":"🔍 Analizar","evaluate":"⚖️ Evaluar","create":"✨ Crear"}[block.bloomLevel as string] || block.bloomLevel}
                                      </span>
                                    )}
                                    {block.examProbability > 0 && block.examProbability !== 50 && (
                                      <span style={{ fontSize: 11, padding: "2px 8px", background: block.examProbability >= 80 ? "rgba(239,68,68,.1)" : "rgba(251,191,36,.1)", color: block.examProbability >= 80 ? "#ef4444" : "#fbbf24", borderRadius: 999, fontWeight: 700 }}>
                                        🎯 {block.examProbability}% examen
                                      </span>
                                    )}
                                    {block.estimatedMinutes > 0 && (
                                      <span style={{ fontSize: 11, padding: "2px 8px", background: "rgba(148,163,184,.1)", color: "var(--text-faint)", borderRadius: 999 }}>
                                        ⏱ {block.estimatedMinutes}min
                                      </span>
                                    )}
                                  </div>
                                )}
                                {block.misconceptions?.length > 0 && (
                                  <div style={{ marginTop: 6 }}>
                                    {block.misconceptions.map((m: string, mi: number) => (
                                      <div key={mi} style={{ fontSize: 11, color: "#fb923c", marginTop: 2, display: "flex", gap: 4, alignItems: "flex-start" }}>
                                        <span style={{ flexShrink: 0 }}>⚠️</span>
                                        <span>{m}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {block.relations?.length > 0 && (
                                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                    {block.relations.map((r: any, ri: number) => (
                                      <span key={ri} style={{ fontSize: 10, padding: "1px 7px", background: "rgba(56,189,248,.08)", color: "#38bdf8", borderRadius: 999, border: "1px solid rgba(56,189,248,.2)" }}>
                                        {{"requires":"necesita","explains":"explica","causes":"causa","contrasts":"contrasta con","extends":"extiende","example_of":"ejemplo de"}[r.type as string] || r.type} → {r.targetLabel || r.target || "?"}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {block.pages?.length > 0 && (
                                <div style={{ fontSize: 11, color: "var(--text-faint)", flexShrink: 0 }}>
                                  p.{block.pages[0]}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Unique concepts */}
                  {blueprint.uniqueConceptsIndex?.length > 0 && (
                    <div style={{
                      background: "var(--bg-card)", border: "1.5px solid var(--border-color)",
                      borderRadius: 20, padding: 20,
                    }}>
                      <div style={{ fontFamily: HAND, fontSize: 24, color: "#38bdf8", marginBottom: 14 }}>
                        💡 Índice de conocimiento ({blueprint.uniqueConceptsIndex.length} elementos)
                      </div>
                      {(() => {
                        const kindGroups: Record<string, any[]> = {};
                        const kindOrder = ["concept","definition","formula","entity","fact","example","note"];
                        const kindMeta: Record<string, { label: string; emoji: string; color: string }> = {
                          concept:    { label: "Conceptos",   emoji: "💡", color: "#38bdf8" },
                          definition: { label: "Definiciones", emoji: "📖", color: "#4ade80" },
                          formula:    { label: "Fórmulas",    emoji: "🔢", color: "#a78bfa" },
                          entity:     { label: "Entidades",   emoji: "👤", color: "#fbbf24" },
                          fact:       { label: "Datos",       emoji: "📍", color: "#fb923c" },
                          example:    { label: "Ejemplos",    emoji: "📝", color: "#34d399" },
                          note:       { label: "Notas",       emoji: "📋", color: "var(--text-faint)" },
                        };
                        for (const c of blueprint.uniqueConceptsIndex) {
                          const k = c.kind || "note";
                          if (!kindGroups[k]) kindGroups[k] = [];
                          kindGroups[k].push(c);
                        }
                        return (
                          <div style={{ display: "grid", gap: 14 }}>
                            {kindOrder.filter(k => kindGroups[k]?.length > 0).map(k => (
                              <div key={k}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: kindMeta[k].color, marginBottom: 6 }}>
                                  {kindMeta[k].emoji} {kindMeta[k].label} ({kindGroups[k].length})
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {kindGroups[k].map((concept: any, i: number) => (
                                    <div key={i} style={{
                                      background: "var(--bg-secondary)",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: 999, padding: "5px 12px",
                                      fontSize: 12, fontWeight: 700,
                                      display: "flex", alignItems: "center", gap: 5,
                                    }}>
                                      <span>{kindMeta[k].emoji}</span>
                                      <span>{concept.name}</span>
                                      {concept.importance >= 80 && (
                                        <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 900 }}>★</span>
                                      )}
                                      {concept.pages?.length > 1 && (
                                        <span style={{
                                          fontSize: 10, color: "var(--text-faint)",
                                          background: "var(--bg-card)", borderRadius: 999,
                                          padding: "1px 5px",
                                        }}>
                                          p.{concept.pages.slice(0,3).join(",")}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB: PLAN */}
          {false && (
            <div style={{ maxWidth: 680, margin: "0 auto" }}>
              {!studyPlan && (
                <div style={{ textAlign: "center", padding: 60 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                  <div style={{ fontFamily: HAND, fontSize: 24, color: "var(--text-muted)" }}>
                    {blueprintLoading
                      ? "Generando tu plan..."
                      : "Completa el setup y el análisis para ver tu plan"}
                  </div>
                </div>
              )}

              {studyPlan && (
                <div style={{ display: "grid", gap: 0 }}>
                  {/* Header del programa */}
                  <div style={{
                    background: "var(--bg-card)",
                    border: "1.5px solid var(--border-color)",
                    borderRadius: 20,
                    padding: 24,
                    marginBottom: 24,
                  }}>
                    <div style={{ fontFamily: HAND, fontSize: 14, color: "#38bdf8", marginBottom: 4 }}>
                      📖 tu viaje de aprendizaje
                    </div>
                    <div style={{ fontFamily: HAND, fontSize: 32, fontWeight: 900, color: "#fff", marginBottom: 12 }}>
                      {studyPlan.programGoal}
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                      <span style={{ fontSize: 13, padding: "4px 12px", background: "rgba(56,189,248,.12)", color: "#38bdf8", borderRadius: 999, fontWeight: 700 }}>
                        {studyPlan.totalSessions} sesiones
                      </span>
                      <span style={{ fontSize: 13, padding: "4px 12px", background: "rgba(74,222,128,.12)", color: "#4ade80", borderRadius: 999, fontWeight: 700 }}>
                        {blueprintDegraded ? "cobertura en revisión" : "cobertura textual completa"}
                      </span>
                    </div>
                    {canShowPlan && (journey?.programObjectives?.length ?? 0) > 0 && (
                      <div style={{ display: "grid", gap: 6 }}>
                        {(journey?.programObjectives ?? []).map((obj, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14, color: "var(--text-muted)" }}>
                            <span style={{ color: "#38bdf8", flexShrink: 0 }}>✦</span>
                            {obj}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Mapa visual — el viaje */}
                  <div style={{ position: "relative" }}>
                    {studyPlan.sessions.map((session, idx) => {
                      const isFirst = idx === 0;
                      const isLast = idx === studyPlan.sessions.length - 1;
                      const isAvailable = session.status === "available";
                      const isDone = session.status === "done";
                      const isLocked = session.status === "locked";

                      const typeConfig = {
                        introduction:  { emoji: "📖", color: "#38bdf8",  label: "Sesión" },
                        learning:      { emoji: "📘", color: "#a78bfa",  label: "Sesión" },
                        final_review:  { emoji: "🏁", color: "#4ade80",  label: "Sesión final" },
                      };
                      const cfg = typeConfig[session.kind];

                      const loadConfig = {
                        light:  { label: "fundamentos",    color: "#4ade80" },
                        medium: { label: "construcción",   color: "#fbbf24" },
                        heavy:  { label: "profundización", color: "#a78bfa" },
                      };
                      const loadCfg = loadConfig[session.cognitiveLoad] || loadConfig.medium;

                      return (
                        <div key={session.sessionNumber} style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
                          {/* Línea vertical + nodo */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 48, flexShrink: 0 }}>
                            {/* Nodo */}
                            <div style={{
                              width: 40, height: 40,
                              borderRadius: "50%",
                              background: isDone
                                ? "#4ade80"
                                : isAvailable
                                  ? cfg.color
                                  : "var(--bg-secondary)",
                              border: `2px solid ${isDone ? "#4ade80" : isAvailable ? cfg.color : "var(--border-color)"}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 18, flexShrink: 0,
                              boxShadow: isAvailable ? `0 0 12px ${cfg.color}44` : "none",
                              transition: "all .2s",
                              zIndex: 1,
                            }}>
                              {isDone ? "✓" : isLocked ? "🔒" : cfg.emoji}
                            </div>
                            {/* Línea */}
                            {!isLast && (
                              <div style={{
                                width: 2,
                                flex: 1,
                                minHeight: 24,
                                background: isDone
                                  ? "#4ade80"
                                  : `linear-gradient(to bottom, ${cfg.color}60, var(--border-color))`,
                              }} />
                            )}
                          </div>

                          {/* Tarjeta de la sesión */}
                          <div style={{
                            flex: 1,
                            marginLeft: 12,
                            marginBottom: isLast ? 0 : 12,
                            background: isAvailable
                              ? `linear-gradient(135deg, ${cfg.color}10, var(--bg-card))`
                              : "var(--bg-card)",
                            border: `1.5px solid ${isAvailable ? cfg.color + "60" : "var(--border-color)"}`,
                            borderRadius: 16,
                            padding: "16px 18px",
                            opacity: isLocked ? 0.6 : 1,
                            transition: "all .2s",
                          }}>
                            {/* Header de la tarjeta */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontSize: 11, padding: "2px 8px", background: `${cfg.color}18`, color: cfg.color, borderRadius: 999, fontWeight: 700 }}>
                                    {cfg.label} {session.sessionNumber}
                                  </span>
                                  <span style={{ fontSize: 11, color: loadCfg.color, fontWeight: 700 }}>
                                    · {loadCfg.label}
                                  </span>
                                </div>
                                <div style={{ fontFamily: HAND, fontSize: 20, fontWeight: 900, color: isLocked ? "var(--text-muted)" : "#fff", lineHeight: 1.2 }}>
                                  {session.title}
                                </div>
                              </div>
                            </div>

                            {/* Objetivo */}
                            <div style={{ fontSize: 14, color: isLocked ? "var(--text-faint)" : "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
                              {session.objective}
                            </div>

                            {/* Por qué existe */}
                            {!isLocked && session.why && (
                              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 10, display: "flex", alignItems: "flex-start", gap: 6 }}>
                                <span style={{ flexShrink: 0 }}>→</span>
                                <span>{session.why}</span>
                              </div>
                            )}

                            {/* Conceptos */}
                            {!isLocked && session.concepts.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                                {session.concepts.slice(0, 5).map((concept, ci) => (
                                  <span key={ci} style={{
                                    fontSize: 11, padding: "2px 8px",
                                    background: "var(--bg-secondary)",
                                    border: "1px solid var(--border-color)",
                                    borderRadius: 999, color: "var(--text-muted)", fontWeight: 600,
                                  }}>
                                    {concept}
                                  </span>
                                ))}
                                {session.concepts.length > 5 && (
                                  <span style={{ fontSize: 11, color: "var(--text-faint)", padding: "2px 4px" }}>
                                    +{session.concepts.length - 5} más
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Al terminar podrás */}
                            {!isLocked && session.kind === "introduction" && (
                              <div style={{ display: "grid", gap: 4 }}>
                                {session.whatYouWillBeAbleToDo.slice(0, 3).map((w, wi) => (
                                  <div key={wi} style={{ fontSize: 12, color: "var(--text-faint)", display: "flex", gap: 6 }}>
                                    <span style={{ color: cfg.color, flexShrink: 0 }}>✦</span>
                                    {w}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Criterios de salida — solo sesiones disponibles */}
                            {isAvailable && session.exitCriteria.length > 0 && (
                              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-color)" }}>
                                <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6, fontWeight: 700 }}>
                                  AL TERMINAR ESTA SESIÓN PODRÁS:
                                </div>
                                <div style={{ display: "grid", gap: 4 }}>
                                  {session.exitCriteria.map((c, ci) => (
                                    <div key={ci} style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 6, alignItems: "flex-start" }}>
                                      <span style={{ color: cfg.color, flexShrink: 0 }}>✓</span>
                                      {c}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Qué desbloquea */}
                            {!isLocked && session.unlocks.length > 0 && (
                              <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 6 }}>
                                <span>🔓</span>
                                <span>
                                  Desbloquea: {(() => {
                                    const nextSess = studyPlan.sessions.find(s => s.sessionNumber === session.unlocks[0]);
                                    return nextSess?.title || 'siguiente sesión';
                                  })()}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer del plan */}
                  <div style={{ marginTop: 24, padding: "16px 20px", background: "var(--bg-secondary)", borderRadius: 14, border: "1px solid var(--border-color)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>🤖</span>
                      <span>
                        Este es tu <strong style={{ color: "var(--text-muted)" }}>plan actual</strong>.
                        ALAI puede reorganizarlo conforme obtiene evidencia real de tu aprendizaje.
                        La cobertura siempre será del 100%.
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  // SETUP WIZARD
  // ═══════════════════════════════════════
  if (sessionLoading) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: BODY }}>
        {sessionId ? "Cargando tu proceso adaptativo…" : "Creando tu proceso adaptativo…"}
      </div>
    );
  }

  if (sessionLoadError) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", padding: 24, background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: BODY }}>
        <div style={{ maxWidth: 560, textAlign: "center" }}>
          <p>{sessionLoadError}</p>
          <button onClick={onClose}>Volver al tema</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, overflowY: "auto", padding: 24,
      background: "radial-gradient(circle at 20% 10%, rgba(56,189,248,.14), transparent 28%), linear-gradient(135deg, var(--bg-primary), color-mix(in srgb, var(--bg-primary) 78%, #000))",
      color: "var(--text-primary)",
    }}>
      <div style={{
        maxWidth: 920, margin: "0 auto",
        background: "color-mix(in srgb, var(--bg-card) 92%, transparent)",
        border: "1px solid color-mix(in srgb, #38bdf8 35%, var(--border-color))",
        borderRadius: 28, overflow: "hidden",
        boxShadow: "0 20px 80px rgba(0,0,0,.45)",
      }}>
        <div style={{ padding: "22px 24px 10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: HAND, fontSize: 22, color: "#38bdf8" }}>🤖 modo adaptativo</div>
              <h1 style={{ margin: "4px 0 0", fontFamily: HAND, fontSize: 42, color: "#fff" }}>setup de este material</h1>
            </div>
            <button onClick={onClose} style={{
              padding: "10px 18px", background: "transparent", color: "var(--text-muted)",
              border: "2px solid var(--border-color)", borderRadius: 14,
              fontFamily: HAND, fontSize: 20, cursor: "pointer",
            }}>← volver</button>
          </div>
          <div style={{ height: 8, background: "var(--bg-secondary)", borderRadius: 999, overflow: "hidden", marginTop: 16 }}>
            <div style={{ height: "100%", width: progress + "%", background: "#38bdf8", transition: "width .25s ease" }} />
          </div>
        </div>

        <div style={{ padding: 26 }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "var(--text-faint)", fontFamily: BODY, fontSize: 13 }}>
              Paso {step + 1} de {stepTitles.length}
            </div>
            <div style={{ color: "#fff", fontFamily: HAND, fontSize: 34, fontWeight: 900 }}>
              {stepTitles[step]}
            </div>
          </div>

          {step === 0 && (
            <div style={{ display: "grid", gap: 12 }}>
              {[
                ["never_seen", "🆕", "Nunca lo he visto"],
                ["know_little", "📘", "Lo conozco un poco"],
                ["want_review", "🔄", "Quiero repasarlo"],
                ["already_know", "🧠", "Ya lo domino, quiero practicar"],
              ].map(([id, emoji, label]) => (
                <button key={id}
                  onClick={() => setSetup((prev) => ({ ...prev, knowledgeLevel: id as any }))}
                  style={cardStyle(setup.knowledgeLevel === id)}>
                  <span style={{ fontSize: 28 }}>{emoji}</span>{label}
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div style={{ display: "grid", gap: 12 }}>
              {[
                ["today", "⚡", "Hoy"],
                ["tomorrow", "⏰", "Mañana"],
                ["this_week", "📅", "Esta semana"],
                ["just_studying", "📚", "Solo quiero estudiar"],
                ["custom", "🗓️", "Elegir fecha"],
              ].map(([id, emoji, label]) => (
                <button key={id}
                  onClick={() => setSetup((prev) => ({ ...prev, examDateType: id as any }))}
                  style={cardStyle(setup.examDateType === id)}>
                  <span style={{ fontSize: 28 }}>{emoji}</span>{label}
                </button>
              ))}
              {setup.examDateType === "custom" && (
                <input type="date" value={String(setup.examDateCustom || "")}
                  onChange={(e) => setSetup((prev) => ({ ...prev, examDateCustom: e.target.value }))}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    border: "2px solid #38bdf8", borderRadius: 16,
                    padding: "14px 16px", background: "var(--bg-secondary)",
                    color: "var(--text-primary)", fontFamily: BODY, fontSize: 16,
                  }} />
              )}
            </div>
          )}

          {step === 2 && (
            <div style={{ display: "grid", gap: 18 }}>
              <div style={{ fontFamily: HAND, fontSize: 48, color: "#38bdf8", textAlign: "center" }}>
                {setup.targetScore}%
              </div>
              <input type="range" min={50} max={100} step={5} value={setup.targetScore}
                onChange={(e) => setSetup((prev) => ({ ...prev, targetScore: Number(e.target.value) }))}
                style={{ width: "100%" }} />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {[60, 70, 80, 90, 100].map((score) => (
                  <button key={score}
                    onClick={() => setSetup((prev) => ({ ...prev, targetScore: score }))}
                    style={{ ...cardStyle(setup.targetScore === score), justifyContent: "center", minWidth: 70 }}>
                    {score}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: "grid", gap: 14 }}>
              <p style={{ color: "var(--text-muted)", fontFamily: BODY, fontSize: 14, margin: 0 }}>
                Escríbelo con tus palabras o toca omitir.
              </p>
              <textarea value={setup.mainConcern || ""}
                onChange={(e) => setSetup((prev) => ({ ...prev, mainConcern: e.target.value }))}
                placeholder="Ej: Me confundo con los conceptos, no entiendo las fórmulas..."
                rows={4}
                style={{
                  width: "100%", boxSizing: "border-box",
                  border: "2px solid #38bdf8", borderRadius: 16,
                  padding: "14px 16px", background: "var(--bg-secondary)",
                  color: "var(--text-primary)", fontFamily: BODY, fontSize: 16, resize: "vertical",
                }} />
              <button
                onClick={() => { setSetup((prev) => ({ ...prev, mainConcern: "(omitido)" })); setStep((s) => s + 1); }}
                style={{
                  padding: "10px 18px", background: "transparent",
                  color: "var(--text-muted)", border: "1.5px dashed var(--border-color)",
                  borderRadius: 12, fontFamily: BODY, fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}>
                Omitir →
              </button>
            </div>
          )}



          {step === 4 && (
            <div style={{ display: "grid", gap: 12 }}>
              {[
                ["quick_test", "⚡", "Evaluaciones rápidas sin escribir"],
                ["write_explain", "✍️", "Evaluaciones escribiendo / explicando"],
                ["mixed", "🧩", "Mixto"],
                ["read_only", "📖", "Solo quiero leer"],
              ].map(([id, emoji, label]) => (
                <button key={id}
                  onClick={() => setSetup((prev) => ({ ...prev, evalPreference: id as any }))}
                  style={cardStyle(setup.evalPreference === id)}>
                  <span style={{ fontSize: 28 }}>{emoji}</span>{label}
                </button>
              ))}
            </div>
          )}

          {step === 5 && (
            <div style={{ display: "grid", gap: 12 }}>
              {[
                ["book", "📘", "Como un libro", "Avanzas sesión por sesión, lineal y ordenado."],
                ["levels", "🪜", "Como niveles", "Subes de nivel al dominar cada bloque."],
                ["missions", "🗺️", "Como misiones", "Completas misiones y desbloqueas nuevas."],
              ].map(([id, emoji, label, desc]) => (
                <button key={id}
                  onClick={() => setSetup((prev) => ({ ...prev, planView: id as any }))}
                  style={{ ...cardStyle(setup.planView === id), flexDirection: "column", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 28 }}>{emoji}</span>
                    <strong>{label}</strong>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, fontWeight: 600 }}>
                    {desc}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "0 26px 24px", display: "flex", gap: 12 }}>
          <button onClick={back} disabled={step === 0} style={{
            padding: "12px 18px", background: "transparent",
            color: step === 0 ? "var(--text-faint)" : "var(--text-primary)",
            border: "2px solid var(--border-color)", borderRadius: 14,
            fontFamily: BODY, fontWeight: 900,
            cursor: step === 0 ? "not-allowed" : "pointer",
          }}>Atrás</button>
          <button onClick={next} disabled={!canContinue()} style={{
            flex: 1, padding: "12px 18px",
            background: canContinue() ? "#38bdf8" : "var(--bg-secondary)",
            color: canContinue() ? "#000" : "var(--text-faint)",
            border: "2px solid color-mix(in srgb, #38bdf8 45%, var(--border-color))",
            borderRadius: 14, fontFamily: BODY, fontWeight: 900,
            cursor: canContinue() ? "pointer" : "not-allowed",
          }}>
            {step === stepTitles.length - 1 ? "Guardar setup" : "Continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
