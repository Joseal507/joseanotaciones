"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  getSessionById,
  upsertSession,
  findSession,
  hashSetup,
  type AdaptiveSetup,
} from "../../lib/studySessions";
import { generateStudyPlan, type LegacyStudyPlan } from "../../lib/adaptive/planGenerator";
import { buildLearningJourney } from "../../lib/adaptive/journeyBuilder";
import { roleBadge } from "../../lib/adaptive/narrativeFormatter";
import type { LearningJourney } from "../../lib/adaptive/journeyBuilder";

const HAND = "'Caveat', cursive";
const BODY = "'Inter', system-ui, sans-serif";

interface Props {
  materiales: any[];
  temaId?: string;
  userId?: string;
  sessionId?: string;
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
  onClose,
}: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [setup, setSetup] = useState<AdaptiveSetup>({ ...defaultSetup });
  const [currentSetupHash, setCurrentSetupHash] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  // Blueprint
  const [blueprint, setBlueprint] = useState<any>(null);
  const [blueprintLoading, setBlueprintLoading] = useState(false);
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"plan">("plan");
  const [studyPlan, setStudyPlan] = useState<LegacyStudyPlan | null>(null);
  const [journey, setJourney] = useState<LearningJourney | null>(null);
  const [journeyError, setJourneyError] = useState<string | null>(null);
  const [blueprintQuality, setBlueprintQuality] = useState<any>(null);
  const setupReady = Boolean(setup?.completedAt);
  const blueprintReady = Boolean(
    blueprint && ((blueprint.blocks?.length || blueprint.globalOrderedAnalysis?.length || 0) > 0)
  );
  const blueprintDegraded = blueprintQuality?.status === "degraded";
  const journeyReady = Boolean(journey && journey.chapters && journey.chapters.length > 0);

  const prerequisitesReady = setupReady && blueprintReady && !blueprintDegraded;
  const canShowPlan = journeyReady;
  const showGeneratingPlan = prerequisitesReady && !journeyReady && !journeyError;
  const showIncompleteMessage = !blueprintLoading && !prerequisitesReady && !journeyError;


  const materialIds = useMemo(
    () => materiales.map((m: any) => getMaterialId(m)).filter(Boolean).slice(0, 5),
    [materiales],
  );

  const materialNames = useMemo(
    () =>
      materiales
        .map((m: any) => String(m?.nombre || m?.name || "").trim())
        .filter(Boolean)
        .slice(0, 5),
    [materiales],
  );

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

  // Load existing session setup + blueprint
  useEffect(() => {
    const sess = sessionId
      ? getSessionById(sessionId)
      : temaId && materialIds.length > 0
        ? findSession(temaId, materialIds, "adaptive")
        : null;

    if (sess?.adaptiveSetup?.completedAt) {
      setSetup(sess.adaptiveSetup);
      setDone(true);
      if ((sess as any).blueprint) {
        setBlueprint((sess as any).blueprint);
        // Regenerar plan desde blueprint + setup guardados
        try {
          const bp = (sess as any).blueprint;
          const savedPlan = generateStudyPlan(
            bp,
            sess.adaptiveSetup!,
            null,
            (sess as any).materialNames?.[0] || "Material",
          );
          setStudyPlan(savedPlan);
        } catch (e) {
        }
      }
    }
  }, [sessionId, temaId, materialIds]);

  // Generate blueprint after setup is done
  useEffect(() => {
    if (!done || blueprint || blueprintLoading) return;
    generateBlueprint();
  }, [done]);

  async function generateBlueprint() {
    setBlueprintLoading(true);
    setBlueprintError(null);

    try {
      // Get text content for each material
      const materialsWithText = await Promise.all(
        materiales.slice(0, 5).map(async (m: any) => {
          const matId = m.materialId || m.id;
          let text = m.contenido || "";

          if (!text && matId) {
            try {
              const r = await fetch(`/api/materials/${matId}/download-url`, { credentials: "same-origin" });
              if (r.ok) {
                const d = await r.json();
                // Just use materialId for now — text extraction happens server side
                text = d.extractedText || "";
              }
            } catch {}
          }

          // Get session selectedPages
          const sess = sessionId
            ? getSessionById(sessionId)
            : temaId ? findSession(temaId, materialIds, "adaptive") : null;
          const selectedPages = sess?.selectedPages?.[getMaterialId(m)] || [];

          return {
            materialId: getMaterialId(m),
            materialName: m.nombre || m.name || "Material",
            text: text.slice(0, 20000),
            selectedPages,
          };
        })
      );

      const res = await fetch("/api/adaptive/blueprint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          materials: materialsWithText,
          userProfile: profile,
          adaptiveSetup: setup,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Error generando blueprint");

      setBlueprint(json.blueprint);

      // Generar plan de aprendizaje
      try {
        const plan = generateStudyPlan(
          json.blueprint,
          setup,
          profile,
          cleanMaterialName,
        );
        setStudyPlan(plan);
        // Ir automáticamente al tab del plan cuando se genera
        setActiveTab("plan");
      } catch (planErr) {
      }

      // Guardar blueprint en la sesión del setup actual
      if (temaId && currentSetupHash) {
        upsertSession({
          temaId,
          enfoque: "teorico",
          processMode: "adaptive",
          materialIds,
          materialNames,
          adaptiveSetup: setup,
          setupHash: currentSetupHash,
          ...({ blueprint: json.blueprint } as any),
        });
      }
    } catch (e: any) {
      setBlueprintError(e.message || "Error desconocido");
    } finally {
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
    // Si no hay todo lo necesario, limpiar estado coherentemente
    if (!setupReady || !blueprintReady || blueprintDegraded) {
      setJourney(null);
      setJourneyError(null);
      return;
    }

    try {
      const j = buildLearningJourney(
        blueprint,
        setup,
        materialNames[0] || "Material",
      );
      setJourney(j);
      setJourneyError(null);
    } catch (err: any) {
      console.error("[StudyALAdaptive] Error construyendo journey reactivo:", err?.message || err);
      setJourney(null);
      setJourneyError(err?.message || "No se pudo construir el plan adaptativo");
    }
  }, [
    setupReady,
    blueprintReady,
    blueprintDegraded,
    blueprint,
    setup,
    materialNames,
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
    const newHash = hashSetup(finalSetup);
    setCurrentSetupHash(newHash);
    // Crear SIEMPRE una sesión nueva con el setup actual
    // No reutilizar sesiones de otros setups del mismo material
    upsertSession({
      temaId: temaId || "",
      enfoque: "teorico",
      processMode: "adaptive",
      materialIds,
      materialNames,
      adaptiveSetup: finalSetup,
      setupHash: newHash,
    });
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



        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

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
                        {blueprintDegraded ? "cobertura en revisión" : "100% incluido"}
                      </span>
                      {(journey?.arcs?.length ?? 0) > 0 && (
                        <span style={{ fontSize: 13, padding: "4px 12px", background: "rgba(167,139,250,.12)", color: "#a78bfa", borderRadius: 999, fontWeight: 700 }}>
                          {journey.arcs.length} arcos pedagógicos
                        </span>
                      )}
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
                        chapter.type === "intro"  ? "#38bdf8" :
                        chapter.type === "final_review"  ? "#4ade80" :
                        chapter.arcRole === "foundation"   ? "#38bdf8" :
                        chapter.arcRole === "problem"      ? "#fbbf24" :
                        chapter.arcRole === "mechanism"     ? "#4ade80" :
                        chapter.arcRole === "application"     ? "#a78bfa" :
                        chapter.arcRole === "context"  ? "#fb923c" :
                        chapter.arcRole === "integration"  ? "#f472b6" :
                        "#a78bfa";

                      const chapterEmoji =
                        chapter.type === "intro"  ? "📖" :
                        chapter.type === "final_review"  ? "🏁" :
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
                          <div style={{
                            flex: 1, marginLeft: 12,
                            marginBottom: isLast ? 0 : 12,
                            background: isAvailable
                              ? `linear-gradient(135deg, ${chapterColor}10, var(--bg-card))`
                              : "var(--bg-card)",
                            border: `1.5px solid ${isAvailable ? chapterColor + "60" : "var(--border-color)"}`,
                            borderRadius: 16,
                            padding: "18px 20px",
                            opacity: isLocked ? 0.65 : 1,
                            transition: "all .2s",
                          }}>
                            {/* Arc label + número */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{
                                fontSize: 11, padding: "2px 8px",
                                background: `${chapterColor}18`, color: chapterColor,
                                borderRadius: 999, fontWeight: 700,
                              }}>
                                {chapter.type === "intro"
                                ? "Fundamentos"
                                : roleBadge(chapter.arcRole)}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
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
                            {(!isLocked || chapter.type === "intro") && (
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
                            {!isLocked && chapter.type === "learning" && (
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
                            {isAvailable && chapter.type !== "intro" && chapter.exitCriteria.length > 0 && (
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
                            {!isLocked && chapter.type !== "final_review" && chapter.unlockMessage && (
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
          {false && (
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
                  <button onClick={generateBlueprint} style={{
                    padding: "10px 24px", background: "#38bdf8", color: "#000",
                    border: "none", borderRadius: 12,
                    fontFamily: BODY, fontWeight: 900, cursor: "pointer",
                  }}>Reintentar</button>
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
                        {blueprintDegraded ? "cobertura en revisión" : "100% incluido"}
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
                        intro:         { emoji: "📖", color: "#38bdf8",  label: "Sesión" },
                        deep:          { emoji: "📘", color: "#a78bfa",  label: "Sesión" },
                        integration:   { emoji: "🔗", color: "#fbbf24",  label: "Sesión" },
                        final_review:  { emoji: "🏁", color: "#4ade80",  label: "Sesión final" },
                      };
                      const cfg = typeConfig[session.type] || typeConfig.deep;

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
                            {!isLocked && session.type === "intro" && (
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
