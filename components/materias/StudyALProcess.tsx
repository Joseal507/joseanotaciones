"use client";

import { useEffect, useMemo, useState } from "react";
import type { SourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection";
import { useAuthorizedSource } from "../../lib/materials/useAuthorizedSource";
import type { MaterialMastery } from "../../lib/masteryEngine";
import { getSessionById } from "../../lib/studySessions";
import { computeFreeProcessProgress, type DurableFreeTool } from "../../lib/freeToolState";
import { freeNavDebug } from "../../lib/debug/freeNavDebug";

function getDocEmoji(tipo: string) {
  if (tipo === "pdf") return "📄";
  if (tipo === "imagen") return "🖼️";
  if (tipo === "word") return "📃";
  if (tipo === "ppt") return "📊";
  if (tipo === "youtube") return "▶️";
  return "📁";
}

function getMaterialId(material: any) {
  return String(
    material?.materialId ||
    material?.id ||
    material?.nombre ||
    "",
  ).trim();
}

interface Props {
  materiales: any[];
  temaId?: string;
  enfoque?: string;
  onClose: () => void;
  onOpenCoach?: () => void;
  onOpenFlashcards: () => void;
  onOpenQuiz: () => void;
  onOpenRepasar?: () => void;
  onOpenAnalisis?: () => void;
  onOpenAlai?: () => void;
  onOpenExam?: () => void;
  onOpenStudyMap?: () => void;
  onOpenCheatCodes?: () => void;
  onComingSoon: (label: string) => void;
  masterySnapshot?: any;
  masteryState?: MaterialMastery | null;
  userId?: string | null;
  sessionId: string;
  sourceSelection: SourceSelectionSnapshot;
}

const VB_W = 800;
const VB_H = 680;
const CIRCLE = { cx: 400, cy: 340, r: 215 };

function polarToXY(angleDeg: number, radius = CIRCLE.r) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;

  return {
    x: CIRCLE.cx + Math.cos(rad) * radius,
    y: CIRCLE.cy + Math.sin(rad) * radius,
  };
}

function describeArc(
  startAngle: number,
  endAngle: number,
  radius = CIRCLE.r,
) {
  const start = polarToXY(endAngle, radius);
  const end = polarToXY(startAngle, radius);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export default function StudyALProcess({
  materiales,
  onClose,
  onOpenFlashcards,
  onOpenQuiz,
  onOpenRepasar,
  onOpenAnalisis,
  onOpenAlai,
  onOpenExam,
  onOpenStudyMap,
  onOpenCheatCodes,
  onComingSoon,
  temaId,
  userId,
  sessionId,
  sourceSelection,
}: Props) {
  const [ready, setReady] = useState(false);

  const { result: authorizedSource, status: contentStatus } = useAuthorizedSource(sourceSelection, 'StudyALProcess');
  const totalChars = authorizedSource?.totalChars || 0;
  const estimatedPages = Math.max(1, Math.round(totalChars / 1600));

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  // ── PROGRESO DE FREE MODE — "¿qué parte del ecosistema Free ya usó el
  // estudiante para esta selección exacta?" ────────────────────────────
  // Derivado DIRECTAMENTE de los envelopes durables (StudySession.notes.
  // freeTools) — la MISMA autoridad que restaura cada herramienta. No hay
  // contador paralelo: usar exitosamente una herramienta por primera vez
  // ya escribió su envelope (continuidad), así que el progreso es un
  // efecto secundario gratuito de esa escritura, no un evento aparte.
  // Recalculado en cada montaje de StudyALProcess (siempre fresco, nunca
  // stale) — ver lib/freeToolState.ts para el contrato completo.
  const session = getSessionById(sessionId);
  const { totalPercent: progress, byTool } = computeFreeProcessProgress(session);

  freeNavDebug('STUDYAL_PROCESS_RENDER', {
    sessionId,
    materialesLength: materiales.length,
    sourceSelectionFingerprint: sourceSelection?.fingerprint,
    sessionFound: !!session,
    sessionMaterialIds: session?.materialIds,
    sessionSelectedPages: session?.selectedPages,
    sessionFingerprint: session?.sourceSelectionFingerprint,
    freeToolsKeys: Object.keys(session?.notes?.freeTools || {}),
    progress,
    totalChars,
  });

  // tools[].id usa ids en español; los envelopes usan DurableFreeTool
  // (inglés para analysis/exam). Un solo mapeo, en un solo lugar.
  const TOOL_ID_TO_DURABLE: Record<string, DurableFreeTool> = {
    repasar: 'repasar', analisis: 'analysis', studymap: 'studymap', truquitos: 'truquitos',
    flashcards: 'flashcards', quiz: 'quiz', examen: 'exam', alai: 'alai',
  };
  const completed: Record<string, boolean> = {};
  for (const [id, durableTool] of Object.entries(TOOL_ID_TO_DURABLE)) {
    completed[id] = byTool[durableTool];
  }

  const tools = useMemo(
    () => [
      {
        id: "repasar",
        n: "01",
        title: "Repasar",
        desc: "Comprende las ideas principales del material.",
        emoji: "📖",
        color: "var(--gold)",
        colorHex: "var(--gold)",
        tape: "var(--gold)",
        angle: 0,
        action: () => onOpenRepasar?.(),
      },
      {
        id: "analisis",
        n: "02",
        title: "Análisis",
        desc: "Conecta conceptos y descubre relaciones.",
        emoji: "🔬",
        color: "var(--blue)",
        colorHex: "#38bdf8",
        tape: "#38bdf8",
        angle: 45,
        action: () => onOpenAnalisis?.(),
      },
      {
        id: "studymap",
        n: "03",
        title: "Study Map",
        desc: "Organiza el tema en un mapa visual completo.",
        emoji: "🗺️",
        color: "#22d3ee",
        colorHex: "#22d3ee",
        tape: "#22d3ee",
        angle: 90,
        action: () => onOpenStudyMap?.(),
      },
      {
        id: "truquitos",
        n: "04",
        title: "Truquitos",
        desc: "Atajos mentales para recordar mejor.",
        emoji: "🧠",
        color: "#a78bfa",
        colorHex: "#a78bfa",
        tape: "#a78bfa",
        angle: 135,
        action: () => onOpenCheatCodes?.(),
      },
      {
        id: "flashcards",
        n: "05",
        title: "Flashcards",
        desc: "Convierte la información en memoria a largo plazo.",
        emoji: "🎴",
        color: "var(--pink)",
        colorHex: "#f472b6",
        tape: "#f472b6",
        angle: 180,
        action: onOpenFlashcards,
      },
      {
        id: "quiz",
        n: "06",
        title: "Quiz",
        desc: "Pon a prueba tu comprensión.",
        emoji: "🎯",
        color: "#ef4444",
        colorHex: "#ef4444",
        tape: "#ef4444",
        angle: 225,
        action: onOpenQuiz,
      },
      {
        id: "examen",
        n: "07",
        title: "Examen ALAI",
        desc: "Simula una evaluación real.",
        emoji: "📝",
        color: "var(--red)",
        colorHex: "var(--red)",
        tape: "var(--red)",
        angle: 270,
        action: () => onOpenExam?.(),
      },
      {
        id: "alai",
        n: "08",
        title: "ALAI",
        desc: "Pregunta y profundiza sobre el material.",
        emoji: "✨",
        color: "var(--gold)",
        colorHex: "var(--gold)",
        tape: "var(--gold)",
        angle: 315,
        action: () => onOpenAlai?.(),
      },
    ],
    [
      onOpenRepasar,
      onOpenAnalisis,
      onOpenStudyMap,
      onOpenCheatCodes,
      onOpenFlashcards,
      onOpenQuiz,
      onOpenExam,
      onOpenAlai,
    ],
  );

  const completedCount = tools.filter(
    (tool) => completed[tool.id],
  ).length;

  const ARC_SPAN = 40;
  const ARROW_RADIUS = CIRCLE.r + 140;

  const arrows = tools.map((tool, index) => {
    const next = tools[(index + 1) % tools.length];
    const startAngle = tool.angle + 16;
    const endAngle = next.angle - 16;
    const adjustedEnd =
      endAngle < startAngle ? endAngle + 360 : endAngle;

    return {
      id: `arrow-${tool.id}`,
      toColor: next.colorHex,
      start: polarToXY(startAngle, ARROW_RADIUS),
      end: polarToXY(adjustedEnd, ARROW_RADIUS),
      active: Boolean(completed[tool.id] && completed[next.id]),
    };
  });

  return (
    <div className="sap-screen">
      <div className="sap-board-bg" />
      <div className="sap-board-grain" />

      <div className="sap-topbar">
        <button className="sap-back" onClick={onClose}>
          ← volver al mapa
        </button>
      </div>

      <main className={`sap-canvas ${ready ? "ready" : ""}`}>
        <aside className="sap-left">
          <div className="sap-hero">
            <h1>
              The Study<span>AL</span> Process
            </h1>

            <svg
              width="260"
              height="12"
              viewBox="0 0 260 12"
              className="sap-hero-underline"
            >
              <path
                d="M4 7 Q 70 2 130 6 T 256 5"
                stroke="var(--red)"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
            </svg>

            <p>Herramientas libres para dominar este material.</p>
          </div>

          <div className="sap-card">
            <h4>Material seleccionado</h4>

            <div className="sap-mat-icons">
              {materiales.slice(0, 3).map((material: any, index: number) => (
                <span
                  key={material.id || index}
                  className="sap-mat-chip"
                >
                  {getDocEmoji(material.tipo)}
                </span>
              ))}

              {materiales.length > 3 && (
                <span className="sap-mat-chip sap-mat-more">
                  +{materiales.length - 3}
                </span>
              )}
            </div>

            <p className="sap-card-meta">
              {contentStatus === "loading"
                ? "extrayendo texto..."
                : `${estimatedPages} páginas · ${materiales.length} ${
                    materiales.length === 1
                      ? "documento"
                      : "documentos"
                  }`}
            </p>
          </div>

          <div className="sap-card">
            <h4>Tu progreso general</h4>

            <div className="sap-donut-wrap">
              <svg viewBox="0 0 120 120" className="sap-donut">
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  stroke="var(--border-color2)"
                  strokeWidth="10"
                  fill="none"
                  opacity="0.4"
                />

                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  stroke="var(--gold)"
                  strokeWidth="10"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(progress / 100) * 314} 314`}
                  transform="rotate(-90 60 60)"
                />
              </svg>

              <div className="sap-donut-text">
                <strong>{progress}%</strong>
                <small>Proceso</small>
              </div>
            </div>
          </div>

          <div className="sap-quote">
            <span className="sap-quote-mark">❝</span>
            <p>La consistencia convierte el estudio en dominio.</p>
          </div>
        </aside>

        <section className="sap-center">
          <svg
            className="sap-circle-svg"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
          >
            <defs>
              <marker
                id="arrowActive"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path
                  d="M0,0 L10,5 L0,10 z"
                  fill="var(--gold)"
                />
              </marker>

              <marker
                id="arrowMuted"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path
                  d="M0,0 L10,5 L0,10 z"
                  fill="#3a3a4a"
                />
              </marker>
            </defs>

            <circle
              cx={CIRCLE.cx}
              cy={CIRCLE.cy}
              r={CIRCLE.r}
              fill="none"
              stroke="#2a2a3a"
              strokeWidth="1"
              strokeDasharray="3 7"
              opacity="0.5"
            />

            {tools.map((tool) => {
              const arcPath = describeArc(
                tool.angle - ARC_SPAN / 2,
                tool.angle + ARC_SPAN / 2,
              );

              return (
                <path
                  key={`arc-${tool.id}`}
                  d={arcPath}
                  fill="none"
                  stroke={
                    completed[tool.id]
                      ? tool.colorHex
                      : "#2f2f40"
                  }
                  strokeWidth={completed[tool.id] ? 4.5 : 3}
                  strokeLinecap="round"
                  opacity={completed[tool.id] ? 1 : 0.85}
                />
              );
            })}

            {arrows.map((arrow) => {
              const midX = (arrow.start.x + arrow.end.x) / 2;
              const midY = (arrow.start.y + arrow.end.y) / 2;
              const dx = midX - CIRCLE.cx;
              const dy = midY - CIRCLE.cy;
              const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
              const pushX = midX + (dx / len) * 28;
              const pushY = midY + (dy / len) * 28;

              return (
                <path
                  key={arrow.id}
                  d={`M ${arrow.start.x} ${arrow.start.y} Q ${pushX} ${pushY} ${arrow.end.x} ${arrow.end.y}`}
                  fill="none"
                  stroke={arrow.active ? arrow.toColor : "#3a3a4a"}
                  strokeWidth={arrow.active ? 2 : 1.5}
                  strokeDasharray="5 5"
                  opacity={arrow.active ? 0.85 : 0.5}
                  markerEnd={
                    arrow.active
                      ? "url(#arrowActive)"
                      : "url(#arrowMuted)"
                  }
                />
              );
            })}
          </svg>

          <div className="sap-paper-center">
            <div className="sap-paper-tape" />
            <div className="sap-paper-icon">📖</div>
            <h2>
              Trust
              <br />
              the Process
            </h2>

            <div className="sap-paper-stats">
              <div>
                📚 {materiales.length}{" "}
                {materiales.length === 1
                  ? "material"
                  : "materiales"}
              </div>
              <div>📄 {estimatedPages} páginas</div>
            </div>

            {completedCount === tools.length && (
              <div className="sap-paper-done">
                ✨ ¡Proceso completo!
              </div>
            )}
          </div>

          {tools.map((tool) => {
            const point = polarToXY(
              tool.angle,
              CIRCLE.r + 78,
            );

            return (
              <button
                key={tool.id}
                className={`sap-sticky ${
                  completed[tool.id] ? "done" : ""
                }`}
                style={
                  {
                    "--c": tool.color,
                    "--tape": tool.tape,
                    left: `${(point.x / VB_W) * 100}%`,
                    top: `${(point.y / VB_H) * 100}%`,
                  } as React.CSSProperties
                }
                onClick={tool.action}
              >
                <div className="sap-sticky-tag">{tool.n}</div>
                <div className="sap-sticky-tape" />

                <div className="sap-sticky-head">
                  <span className="sap-sticky-emoji">
                    {tool.emoji}
                  </span>
                  <strong>{tool.title}</strong>
                </div>

                <p>{tool.desc}</p>
              </button>
            );
          })}
        </section>

        <aside className="sap-right">
          <div className="sap-card sap-card-progress">
            <h4>Progreso de estudio</h4>
            <strong className="sap-big-progress">
              {progress}%
            </strong>
          </div>

          <div className="sap-card">
            <h4>⭐ Recomendación</h4>
            <p className="sap-card-text">
              Usa las herramientas en el orden que necesites.
            </p>
          </div>

          <div className="sap-tip">
            <span>💡</span>
            <p>
              Cada herramienta te acerca a tu mejor versión
              académica.
              <br />
              <b>~ ALAI</b>
            </p>
          </div>
        </aside>
      </main>

      <div className="sap-coming-row">
        <small>Próximamente</small>

        <div className="sap-coming-grid">
          {[
            ["Ejemplos", "💡"],
            ["Presentación", "🎤"],
            ["Audio Resumen", "🎧"],
            ["Mapa Mental", "🧩"],
          ].map(([label, icon]) => (
            <button
              key={label}
              onClick={() => onComingSoon(label)}
              className="sap-coming-pill"
            >
              <span>{icon}</span>
              <strong>{label}</strong>
              <em>Próximamente</em>
            </button>
          ))}
        </div>
      </div>

      <style>{`
        .sap-screen{position:fixed;inset:0;overflow:auto;background:var(--bg-primary);color:var(--text-primary)}
        .sap-board-bg{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--gold) 5%,transparent),transparent 55%)}
        .sap-board-grain{position:absolute;inset:0;pointer-events:none;opacity:.07;background-image:linear-gradient(to right,color-mix(in srgb,var(--text-primary) 18%,transparent) 1px,transparent 1px),linear-gradient(to bottom,color-mix(in srgb,var(--text-primary) 18%,transparent) 1px,transparent 1px);background-size:40px 40px}
        .sap-topbar{position:sticky;top:0;z-index:30;padding:14px 24px;background:linear-gradient(to bottom,var(--bg-primary) 70%,transparent)}
        .sap-back{color:var(--blue);border:2px solid var(--blue);background:var(--bg-card);border-radius:14px;padding:9px 16px;font-size:13px;font-weight:800;cursor:pointer;box-shadow:3px 4px 0 var(--blue)}
        .sap-canvas{position:relative;z-index:5;display:grid;grid-template-columns:210px 1fr 220px;gap:20px;padding:0 24px 18px;max-width:1500px;margin:0 auto;align-items:start;opacity:0;transform:translateY(8px);transition:.4s}
        .sap-canvas.ready{opacity:1;transform:none}
        .sap-hero h1{font-size:28px;line-height:1;font-weight:900;letter-spacing:-1px;margin:0}
        .sap-hero h1 span{color:var(--red)}
        .sap-hero p{margin:0;color:var(--text-faint);font-size:12px}
        .sap-card{background:var(--bg-card);border:1.5px solid var(--border-color2);border-radius:14px;padding:12px;margin-bottom:12px}
        .sap-card h4{margin:0 0 8px;font-size:12.5px;color:var(--text-secondary)}
        .sap-card-meta,.sap-card-text{margin:6px 0 0;color:var(--text-faint);font-size:11.5px}
        .sap-mat-icons{display:flex;gap:6px;flex-wrap:wrap}
        .sap-mat-chip{width:34px;height:34px;display:grid;place-items:center;background:var(--bg-secondary);border:1.5px solid var(--border-color);border-radius:8px}
        .sap-donut-wrap{position:relative;width:96px;height:96px;margin:auto}
        .sap-donut{width:100%;height:100%}
        .sap-donut-text{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .sap-donut-text strong,.sap-big-progress{font-size:28px;color:var(--gold)}
        .sap-donut-text small{font-size:9px;color:var(--text-faint)}
        .sap-quote{color:var(--text-faint);font-size:12px}
        .sap-center{position:relative;width:100%;aspect-ratio:${VB_W}/${VB_H};max-width:820px;margin:auto}
        .sap-circle-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
        .sap-paper-center{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-1deg);width:180px;min-height:215px;background:repeating-linear-gradient(to bottom,#f5ecd6 0 26px,#ead9b3 26px 27px);color:#1a1a1a;border:2px solid rgba(0,0,0,.3);border-radius:6px;padding:22px 14px;text-align:center;box-shadow:7px 10px 0 rgba(0,0,0,.45);z-index:7}
        .sap-paper-tape{position:absolute;top:-12px;left:50%;width:80px;height:22px;transform:translateX(-50%) rotate(-2deg);background:var(--gold);opacity:.88}
        .sap-paper-icon{font-size:24px}
        .sap-paper-center h2{font-size:22px;line-height:1}
        .sap-paper-stats{font-size:11px;font-weight:800;display:flex;flex-direction:column;gap:3px}
        .sap-paper-done{margin-top:8px;padding:5px;background:rgba(214,178,111,.3);border:1px solid var(--gold);border-radius:8px;font-size:10px;font-weight:900}
        .sap-sticky{position:absolute;width:148px;padding:10px 9px;background:var(--bg-card);border:2px solid var(--c);border-radius:4px;color:var(--text-primary);cursor:pointer;text-align:left;box-shadow:0 6px 18px rgba(0,0,0,.4);transform:translate(-50%,-50%);z-index:8}
        .sap-sticky:hover{transform:translate(-50%,-50%) scale(1.06)}
        .sap-sticky.done{background:color-mix(in srgb,var(--c) 16%,var(--bg-card))}
        .sap-sticky-tape{position:absolute;top:-9px;left:50%;width:50px;height:13px;transform:translateX(-50%) rotate(-3deg);background:var(--tape)}
        .sap-sticky-tag{position:absolute;top:-9px;right:8px;background:var(--c);color:#0a0a0a;font-size:9.5px;font-weight:950;padding:2px 6px;border-radius:4px}
        .sap-sticky-head{display:flex;gap:6px;margin-bottom:4px}
        .sap-sticky-head strong{font-size:12.5px;color:var(--c)}
        .sap-sticky p{margin:0;font-size:10px;color:var(--text-muted)}
        .sap-tip{background:color-mix(in srgb,var(--gold) 8%,transparent);border:1.5px dashed var(--gold-border);border-radius:12px;padding:10px;display:flex;gap:8px}
        .sap-tip p{margin:0;font-size:11.5px;color:var(--text-muted)}
        .sap-tip b{color:var(--gold)}
        .sap-forecast{display:flex;justify-content:space-between;padding:8px;border-radius:10px;background:rgba(255,255,255,.03);margin-top:6px;font-size:11px}
        .sap-forecast strong{color:var(--gold)}
        .sap-coming-row{position:relative;z-index:5;max-width:1500px;margin:0 auto 20px;padding:0 24px;text-align:center}
        .sap-coming-grid{display:grid;grid-template-columns:repeat(4,minmax(0,150px));gap:12px;justify-content:center}
        .sap-coming-pill{background:var(--bg-card);border:1.5px dashed var(--border-color2);border-radius:12px;padding:12px 8px;color:var(--text-secondary);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px}
        .sap-coming-pill em{font-size:9.5px;font-style:normal;color:var(--text-faint)}
        @media(max-width:960px){.sap-canvas{grid-template-columns:1fr}.sap-left,.sap-right{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
        @media(max-width:640px){.sap-left,.sap-right{grid-template-columns:1fr}.sap-coming-grid{grid-template-columns:repeat(2,1fr)}.sap-sticky{width:122px}}
      `}</style>
    </div>
  );
}
