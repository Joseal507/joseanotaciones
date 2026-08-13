"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Materia, Tema, Apunte, Documento } from "../../lib/storage";
import StudyALProcess from "./StudyALProcess";
import StudyALAdaptive from "./StudyALAdaptive";
import StudyALManual from "./StudyALManual";
import MasteryCoach from "./MasteryCoach";
import ALAIStudyALCheatCodes from "./ALAIStudyALCheatCodes";
import ALAIStudyMap from "./ALAIStudyMap";
import SeleccionPaginas, { type SeleccionResult } from "./SeleccionPaginas";
import ModalConvertirPDF from "./ModalConvertirPDF";
import StudyLoader from "../StudyLoader";
import {
  upsertSession,
  cleanupSessions,
  getSessionsByTema,
  getMaterialSessions,
  syncSessionsFromServer,
  lookupSessionByIdFromServer,
  type StudySession,
  selectSessionForSource,
} from "../../lib/studySessions";
import { resolveAdaptiveResumeTarget } from "../../lib/adaptive/resume";
import { buildSourceSelectionSnapshot, canonicalizeSelectedPages, mapPageSelectionsToMaterials } from "../../lib/adaptive/sourceSelection";

const HAND = "'Caveat', cursive";
const BODY = "'Inter', system-ui, sans-serif";
const HAND_BOLD = "'Caveat', cursive";

const getMaterialKey = (doc: any): string =>
  String(doc?.materialId || doc?.id || "");

const sameId = (a: any, b: any) => String(a || "") === String(b || "");

const normalizeMaterialIdsFromDocs = (docs: any[] = []) =>
  docs.map(getMaterialKey).filter(Boolean);

const normalizeIdStrict = (v: any) => String(v || "").trim();

// ═══════════════════════════════════════════════════════════════
// Sistema de sesiones unificado v3
// ═══════════════════════════════════════════════════════════════
// materialSession ya no se usa — sesiones unificadas en studySessions.ts





function hexToRgb(hex: string) {
  const clean = String(hex || "")
    .replace("#", "")
    .trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const to = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function mixHex(a: string, b: string, amount: number) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    ca.r + (cb.r - ca.r) * t,
    ca.g + (cb.g - ca.g) * t,
    ca.b + (cb.b - ca.b) * t,
  );
}

function colorDistance(a: string, b: string) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return 999;
  return Math.abs(ca.r - cb.r) + Math.abs(ca.g - cb.g) + Math.abs(ca.b - cb.b);
}

function buildSelectionPalette(baseColor: string) {
  const base = baseColor && baseColor.startsWith("#") ? baseColor : "#d6b26f";

  // Primero colores MUY diferenciables del sistema visual de StudyAL.
  // Luego variantes del tema para mantener identidad.
  return [
    "#f5c842", // gold
    "#38bdf8", // blue
    "#f472b6", // pink
    "#ef4444", // red
    "#4ade80", // green
    "#a78bfa", // purple
    "#fb923c", // orange
    mixHex(base, "#ffffff", 0.35),
    mixHex(base, "#000000", 0.35),
  ];
}

function stableHash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function sessionSignature(session: StudySession) {
  return (
    [...(session.materialIds || [])].map(String).sort().join("|") || session.id
  );
}

function sessionVisualColor(
  session: StudySession,
  allSessions: StudySession[],
  baseColor: string,
) {
  const palette = buildSelectionPalette(baseColor);

  const signatures = Array.from(
    new Set(allSessions.map(sessionSignature).filter(Boolean)),
  ).sort();

  const sig = sessionSignature(session);
  const index = signatures.indexOf(sig);

  if (index >= 0) return palette[index % palette.length];

  return palette[stableHash(session.id || sig) % palette.length];
}

function sessionColorForMaterial(
  sessions: StudySession[],
  materialKey: string,
  fallbackColor: string,
) {
  const session = sessionForMaterial(sessions, materialKey);
  return session
    ? sessionVisualColor(session, sessions, fallbackColor)
    : fallbackColor;
}

function sessionForMaterial(sessions: StudySession[], materialKey: string) {
  return (
    sessions.find((s) =>
      (s.materialIds || []).some((id: string) => sameId(id, materialKey)),
    ) || null
  );
}

function getDocEmoji(doc: Documento) {
  if (doc.tipo === "pdf") return "📄";
  if (doc.tipo === "imagen") return "🖼️";
  if (doc.tipo === "word") return "📃";
  if (doc.tipo === "ppt") return "📊";
  if (doc.tipo === "youtube") return "▶️";
  return "📁";
}

function toRgba(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3)
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    if (hex.length !== 6) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(245,200,66,${alpha})`;
}

// ═══ PALETA + VARIANTES DE PAPELITO POR ROL ═══
type PaperVariant =
  | "libreta-abierta"
  | "tag-grande"
  | "cuaderno-libro"
  | "carpeta-folder"
  | "postit-arrugado"
  | "hoja-papel"
  | "ticket-rojo"
  | "sticker-clip"
  | "papelito-simple";

function paperPalette(
  nodeId: string,
  nodeType: string,
): {
  paper: string;
  ink: string;
  inkSoft: string;
  shadow: string;
  variant: PaperVariant;
} {
  const id = (nodeId || "").toLowerCase();
  const type = (nodeType || "").toLowerCase();

  // Decisión: variante + color por id/type
  if (type === "root") {
    return {
      paper: "#fef3c7",
      ink: "#451a03",
      inkSoft: "#92400e",
      shadow: "rgba(252,211,77,0.6)",
      variant: "libreta-abierta",
    };
  }
  if (id === "cuaderno") {
    return {
      paper: "#fde047",
      ink: "#422006",
      inkSoft: "#78350f",
      shadow: "rgba(250,204,21,0.5)",
      variant: "cuaderno-libro",
    };
  }
  if (id === "material") {
    return {
      paper: "#67e8f9",
      ink: "#083344",
      inkSoft: "#0e7490",
      shadow: "rgba(34,211,238,0.5)",
      variant: "carpeta-folder",
    };
  }
  if (id === "rama-apuntes") {
    return {
      paper: "#fef08a",
      ink: "#422006",
      inkSoft: "#854d0e",
      shadow: "rgba(250,204,21,0.4)",
      variant: "postit-arrugado",
    };
  }
  if (id === "rama-subir") {
    return {
      paper: "#f9a8d4",
      ink: "#500724",
      inkSoft: "#9d174d",
      shadow: "rgba(244,114,182,0.45)",
      variant: "sticker-clip",
    };
  }
  if (id === "rama-yt") {
    return {
      paper: "#fca5a5",
      ink: "#450a0a",
      inkSoft: "#991b1b",
      shadow: "rgba(248,113,113,0.5)",
      variant: "ticket-rojo",
    };
  }
  if (id === "rama-pres") {
    return {
      paper: "#c4b5fd",
      ink: "#1e1b4b",
      inkSoft: "#4338ca",
      shadow: "rgba(167,139,250,0.45)",
      variant: "papelito-simple",
    };
  }
  if (id === "rama-ensayo" || id === "rama-grupal") {
    return {
      paper: "#fdba74",
      ink: "#431407",
      inkSoft: "#7c2d12",
      shadow: "rgba(251,146,60,0.45)",
      variant: "papelito-simple",
    };
  }
  if (id.startsWith("a-")) {
    return {
      paper: "#fef08a",
      ink: "#422006",
      inkSoft: "#854d0e",
      shadow: "rgba(250,204,21,0.4)",
      variant: "postit-arrugado",
    };
  }
  if (type === "doc" || id.startsWith("d-")) {
    return {
      paper: "#f8fafc",
      ink: "#0f172a",
      inkSoft: "#475569",
      shadow: "rgba(148,163,184,0.4)",
      variant: "hoja-papel",
    };
  }
  return {
    paper: "#fde047",
    ink: "#422006",
    inkSoft: "#78350f",
    shadow: "rgba(250,204,21,0.4)",
    variant: "papelito-simple",
  };
}

function paperRot(id: string) {
  let h = 0;
  for (let i = 0; i < (id || "").length; i++)
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 7) - 3;
}

// ═══════════════════════════════════════════════════════════════
// RUEDA DE ENFOQUES — EXPERIENCIA CINEMÁTICA
// ═══════════════════════════════════════════════════════════════
function EnfoqueWheel({ onClose, onSelect, color, materialesCount }: any) {
  const [hov, setHov] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    | "teorico"
    | "matematico"
    | "mixto"
    | "practico"
    | "practico"
    | "enter"
    | "idle"
    | null
  >("enter");

  useEffect(() => {
    const t = setTimeout(() => setPhase("idle"), 50);
    return () => clearTimeout(t);
  }, []);

  const items = [
    {
      id: "teorico",
      label: "Teórico",
      sub: "Lectura · Flashcards · Quiz",
      emoji: "📖",
      color: "#5eead4",
      enabled: true,
      desc: "Comprende conceptos, memoriza y autoevalúate",
    },
    {
      id: "matematico",
      label: "Matemático",
      sub: "Fórmulas · Ejercicios · Pasos",
      emoji: "📐",
      color: "#a78bfa",
      enabled: false,
      desc: "Resuelve problemas paso a paso",
    },
    {
      id: "teorico-mat",
      label: "Teórico-Mat.",
      sub: "Combinación completa",
      emoji: "🧮",
      color: "#fbbf24",
      enabled: false,
      desc: "Lo mejor de los dos mundos",
    },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background:
          "radial-gradient(ellipse at center, rgba(15,15,20,0.85), rgba(0,0,0,0.97))",
        backdropFilter: "blur(20px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: HAND,
        animation: "fadeIn 0.4s ease-out",
      }}
    >
      {/* Líneas de cuaderno de fondo */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(to bottom, transparent 0, transparent 47px, rgba(255,255,255,0.03) 47px, rgba(255,255,255,0.03) 48px, transparent 48px)`,
          backgroundSize: "100% 48px",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "8%",
          top: 0,
          bottom: 0,
          width: 1,
          background: "rgba(239,68,68,0.3)",
          pointerEvents: "none",
        }}
      />

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          textAlign: "center",
          transform: phase === "enter" ? "scale(0.85)" : "scale(1)",
          opacity: phase === "enter" ? 0 : 1,
          transition: "all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div
            style={{
              fontSize: 18,
              color: "rgba(255,255,255,0.5)",
              fontFamily: HAND,
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            ~ {materialesCount}{" "}
            {materialesCount === 1
              ? "material seleccionado"
              : "materiales seleccionados"}{" "}
            ~
          </div>
          <h1
            style={{
              fontSize: 56,
              color: "#fff",
              fontFamily: HAND,
              fontWeight: 700,
              margin: 0,
              lineHeight: 1,
              textShadow: "0 4px 30px rgba(255,255,255,0.2)",
            }}
          >
            ¿cómo quieres estudiar?
          </h1>
          <div
            style={{
              fontSize: 20,
              color: "rgba(255,255,255,0.6)",
              fontFamily: HAND,
              marginTop: 8,
              fontStyle: "italic",
            }}
          >
            elige tu enfoque ↓
          </div>
        </div>

        {/* Cards horizontales */}
        <div
          style={{
            display: "flex",
            gap: 20,
            justifyContent: "center",
            alignItems: "stretch",
            flexWrap: "wrap",
            maxWidth: 1100,
          }}
        >
          {items.map((item, i) => {
            const isH = hov === item.id;
            const c = item.color;
            return (
              <button
                key={item.id}
                onClick={() => item.enabled && onSelect(item.id)}
                onMouseEnter={() => setHov(item.id)}
                onMouseLeave={() => setHov(null)}
                disabled={!item.enabled}
                style={{
                  position: "relative",
                  width: 280,
                  minHeight: 340,
                  background:
                    isH && item.enabled
                      ? `linear-gradient(160deg, ${c}22, ${c}05)`
                      : "linear-gradient(160deg, #16161a, #0a0a0c)",
                  border: `1.5px solid ${item.enabled ? (isH ? c : `${c}66`) : "#333"}`,
                  borderRadius: 20,
                  padding: "28px 22px",
                  cursor: item.enabled ? "pointer" : "not-allowed",
                  opacity: item.enabled ? 1 : 0.5,
                  transform:
                    isH && item.enabled
                      ? "translateY(-12px) scale(1.03)"
                      : "translateY(0)",
                  transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  boxShadow:
                    isH && item.enabled
                      ? `0 20px 60px ${c}55, 0 0 80px ${c}33, inset 0 0 30px ${c}11`
                      : `0 10px 30px rgba(0,0,0,0.4), inset 0 0 0 ${c}00`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  fontFamily: HAND,
                  overflow: "hidden",
                  animation: `slideUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${0.1 + i * 0.08}s both`,
                }}
              >
                {/* Pestañita post-it */}
                <div
                  style={{
                    position: "absolute",
                    top: -2,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 60,
                    height: 12,
                    background: c,
                    borderRadius: "0 0 8px 8px",
                    boxShadow: `0 4px 12px ${c}88`,
                    opacity: item.enabled ? 1 : 0.3,
                  }}
                />

                {/* Brillo de fondo cuando hover */}
                {isH && item.enabled && (
                  <div
                    style={{
                      position: "absolute",
                      top: "-30%",
                      right: "-30%",
                      width: 200,
                      height: 200,
                      background: `radial-gradient(circle, ${c}44, transparent 70%)`,
                      pointerEvents: "none",
                    }}
                  />
                )}

                <div
                  style={{
                    fontSize: 70,
                    marginTop: 10,
                    marginBottom: 12,
                    filter:
                      isH && item.enabled
                        ? `drop-shadow(0 0 20px ${c}aa)`
                        : "none",
                    transition: "filter 0.4s",
                  }}
                >
                  {item.emoji}
                </div>

                <div
                  style={{
                    fontSize: 36,
                    fontWeight: 700,
                    color: isH && item.enabled ? c : "#fff",
                    fontFamily: HAND,
                    lineHeight: 1,
                    marginBottom: 6,
                    transition: "color 0.3s",
                  }}
                >
                  {item.label}
                </div>

                <div
                  style={{
                    fontSize: 16,
                    color: "rgba(255,255,255,0.55)",
                    fontFamily: HAND,
                    fontStyle: "italic",
                    marginBottom: 16,
                  }}
                >
                  {item.sub}
                </div>

                <div
                  style={{
                    fontSize: 17,
                    color: "rgba(255,255,255,0.8)",
                    fontFamily: BODY,
                    lineHeight: 1.3,
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 8px",
                  }}
                >
                  {item.desc}
                </div>

                {/* CTA */}
                <div
                  style={{
                    marginTop: 16,
                    padding: "8px 20px",
                    borderRadius: 30,
                    background: item.enabled
                      ? isH
                        ? c
                        : `${c}22`
                      : "rgba(255,255,255,0.05)",
                    color: item.enabled
                      ? isH
                        ? "#000"
                        : c
                      : "rgba(255,255,255,0.4)",
                    fontFamily: BODY,
                    fontSize: 18,
                    fontWeight: 700,
                    border: `1.5px solid ${item.enabled ? c : "#444"}`,
                    transition: "all 0.3s",
                  }}
                >
                  {item.enabled
                    ? isH
                      ? "empezar →"
                      : "seleccionar"
                    : "próximamente"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Cerrar */}
        <button
          onClick={onClose}
          style={{
            marginTop: 32,
            background: "transparent",
            border: "1.5px solid rgba(255,255,255,0.3)",
            padding: "10px 28px",
            borderRadius: 30,
            color: "rgba(255,255,255,0.8)",
            fontFamily: HAND,
            fontSize: 20,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.3s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.borderColor = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
          }}
        >
          ← volver
        </button>
      </div>

      <style>{`
        @keyframes studyBtnIn {
          from { opacity: 0; transform: translateX(-50%) translateY(40px) scale(0.85); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes sparkle {
          0%, 100% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 6px rgba(245,200,66,0.7)); }
          50%      { transform: scale(1.2) rotate(15deg); filter: drop-shadow(0 0 14px rgba(245,200,66,1)); }
        }
        @keyframes arrowSlide {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(6px); }
        }
        .study-btn-neon:hover {
          transform: translateY(-3px) scale(1.04);
          box-shadow:
            0 0 0 1px rgba(239,68,68,0.5),
            0 0 30px rgba(239,68,68,0.8),
            0 0 60px rgba(239,68,68,0.4),
            inset 0 1px 0 rgba(255,255,255,0.15) !important;
          border-color: #ff5555 !important;
        }
        .study-btn-neon:active {
          transform: translateY(1px) scale(0.98);
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(40px) scale(0.9); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ENERGÍA EN CURVAS
// ═══════════════════════════════════════════════════════════════
type CurveLine = {
  key: string;
  fromX: number;
  fromY: number;
  ctrlX: number;
  ctrlY: number;
  toX: number;
  toY: number;
  color: string;
  active: boolean;
  points?: { x: number; y: number }[];
};

function bezierPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function pointOnPolyline(points: { x: number; y: number }[], t: number) {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const segs: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    len: number;
  }[] = [];
  let total = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0.01) {
      segs.push({ a, b, len });
      total += len;
    }
  }

  if (total <= 0) return points[points.length - 1];

  let target = Math.max(0, Math.min(1, t)) * total;

  for (const seg of segs) {
    if (target <= seg.len) {
      const k = target / seg.len;
      return {
        x: seg.a.x + (seg.b.x - seg.a.x) * k,
        y: seg.a.y + (seg.b.y - seg.a.y) * k,
      };
    }
    target -= seg.len;
  }

  return segs[segs.length - 1].b;
}

function drawPolylineUntil(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  progress: number,
  toScreen: (x: number, y: number) => { x: number; y: number },
) {
  if (points.length < 2 || progress <= 0) return;

  const segs: {
    a: { x: number; y: number };
    b: { x: number; y: number };
    len: number;
  }[] = [];
  let total = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0.01) {
      segs.push({ a, b, len });
      total += len;
    }
  }

  if (!segs.length || total <= 0) return;

  let remaining = Math.max(0, Math.min(1, progress)) * total;
  const first = toScreen(segs[0].a.x, segs[0].a.y);

  ctx.beginPath();
  ctx.moveTo(first.x, first.y);

  for (const seg of segs) {
    if (remaining <= 0) break;

    if (remaining >= seg.len) {
      const b = toScreen(seg.b.x, seg.b.y);
      ctx.lineTo(b.x, b.y);
      remaining -= seg.len;
    } else {
      const k = remaining / seg.len;
      const x = seg.a.x + (seg.b.x - seg.a.x) * k;
      const y = seg.a.y + (seg.b.y - seg.a.y) * k;
      const p = toScreen(x, y);
      ctx.lineTo(p.x, p.y);
      break;
    }
  }
}

function useEnergyEngine(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  chargeState: React.MutableRefObject<Map<string, number>>,
  lines: CurveLine[],
  transform: { offsetX: number; offsetY: number; scale: number },
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", resize);
    resize();

    const toScreen = (x: number, y: number) => ({
      x: transform.offsetX + x * transform.scale,
      y: transform.offsetY + y * transform.scale,
    });

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      lines.forEach((line) => {
        const current = chargeState.current.get(line.key) || 0;
        let next = current;

        if (line.active) next = Math.min(1, current + 0.018);
        else next = Math.max(0, current - 0.018);

        chargeState.current.set(line.key, next);
        if (next <= 0.001) return;

        const pts =
          line.points && line.points.length >= 2
            ? line.points
            : [
                { x: line.fromX, y: line.fromY },
                { x: line.ctrlX, y: line.ctrlY },
                { x: line.toX, y: line.toY },
              ];

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        drawPolylineUntil(ctx, pts, next, toScreen);
        ctx.strokeStyle = toRgba(line.color, 0.26);
        ctx.lineWidth = 7;
        ctx.shadowBlur = 16;
        ctx.shadowColor = line.color;
        ctx.stroke();

        drawPolylineUntil(ctx, pts, next, toScreen);
        ctx.strokeStyle = toRgba(line.color, 0.78);
        ctx.lineWidth = 2.2;
        ctx.shadowBlur = 9;
        ctx.shadowColor = line.color;
        ctx.stroke();

        drawPolylineUntil(ctx, pts, next, toScreen);
        ctx.strokeStyle = "rgba(255,255,255,0.82)";
        ctx.lineWidth = 0.9;
        ctx.shadowBlur = 5;
        ctx.shadowColor = "#fff";
        ctx.stroke();

        if (next < 1) {
          const head = pointOnPolyline(pts, next);
          const hs = toScreen(head.x, head.y);
          const grad = ctx.createRadialGradient(hs.x, hs.y, 0, hs.x, hs.y, 18);
          grad.addColorStop(0, "rgba(255,255,255,1)");
          grad.addColorStop(0.28, toRgba(line.color, 0.95));
          grad.addColorStop(1, toRgba(line.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(hs.x, hs.y, 18, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });

      raf = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [lines, transform]);
}

export default function TemaView({
  materia,
  tema,
  onBack,
  onBackMateria,
  onGoHome,
  onAbrirApunte,
  onAbrirDocumento,
  onEliminarApunte,
  onEliminarDocumento,
  onNuevoApunte,
  onSubirDocumento,
  subiendoDoc,
  onAbrirUploader,
  onOpenFlashcards,
  onOpenQuiz,
  onOpenRepasar,
  onOpenAnalisis,
  onOpenAlai,
  onOpenExam,
  returnToEnfoque,
  returnSessionId,
  onClearReturnToEnfoque,
  autoOpenAdaptive,
  autoOpenAdaptiveSessionId,
  masteryState,
  masterySnapshot,
  masteryContext,
  onMasteryEvent,
  onInitMastery,
  userId,
}: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [adaptiveAutoOpenConsumed, setAdaptiveAutoOpenConsumed] = useState(false);
  const [modalArchivo, setModalArchivo] = useState<{
    nombre: string;
    tipo: "pptx" | "otro";
  } | null>(null);

  function detectarTipoArchivo(file: File): "valido" | "pptx" | "otro" {
    const nombre = file.name.toLowerCase();
    const mime = (file.type || "").toLowerCase();
    if (
      nombre.endsWith(".pptx") ||
      nombre.endsWith(".ppt") ||
      mime.includes("presentationml") ||
      mime.includes("powerpoint")
    )
      return "pptx";
    if (
      nombre.endsWith(".pdf") ||
      mime === "application/pdf" ||
      nombre.endsWith(".docx") ||
      mime.includes("wordprocessingml") ||
      nombre.endsWith(".txt") ||
      mime === "text/plain" ||
      mime.startsWith("image/") ||
      /\.(jpg|jpeg|png|webp|gif|bmp)$/.test(nombre)
    )
      return "valido";
    return "otro";
  }

  function handleArchivoValidado(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    for (const f of files) {
      const tipo = detectarTipoArchivo(f);
      if (tipo === "pptx" || tipo === "otro") {
        setModalArchivo({ nombre: f.name, tipo });
        e.target.value = "";
        return;
      }
    }
    onSubirDocumento(e);
  }
  const chargeState = useRef<Map<string, number>>(new Map());

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.8);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // ── Sesiones de estudio activas en este tema ──
  const [activeSessions, setActiveSessions] = useState<StudySession[]>([]);
  const [sessionsRestoring, setSessionsRestoring] = useState(true);
  // ── ID de sesión a reanudar (cuando se hace "seguir estudiando") ──
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  // Ref para el modo elegido — nunca se pisa por guards o re-renders
  const chosenModeRef = useRef<'free' | 'adaptive' | 'manual' | null>(null);



  // ── Modal de confirmación de borrado ──
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [showStudyMap, setShowStudyMap] = useState(false);
  const [showCoach, setShowCoach] = useState(false);
  const [coachBackToProcess, setCoachBackToProcess] = useState(false);
  const [pendingCoachTool, setPendingCoachTool] = useState<string | null>(null);
  const [showCheatCodes, setShowCheatCodes] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });

  const refreshSessions = useCallback(() => {
    if (!tema?.id) return;
    setSessionsRestoring(true);
    const existingIds = (tema.documentos || []).map(
      (d: any) => d.materialId || d.id,
    );
    cleanupSessions(tema.id, existingIds);
    setActiveSessions(getSessionsByTema(tema.id));

    syncSessionsFromServer(tema.id)
      .then((sessions) => {
        cleanupSessions(tema.id, existingIds);
        setActiveSessions(sessions);
      })
      .catch(() => {})
      .finally(() => setSessionsRestoring(false));
  }, [tema?.id, tema?.documentos]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const activeTool = showStudyMap ? 'studymap' : showCheatCodes ? 'truquitos' : null;
    const url = new URL(window.location.href);
    if (activeTool && resumeSessionId) {
      url.searchParams.set('temaId', tema?.id || '');
      url.searchParams.set('freeSessionId', resumeSessionId);
      url.searchParams.set('freeTool', activeTool);
    } else {
      return;
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }, [showStudyMap, showCheatCodes, resumeSessionId, tema?.id]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // ── Auto-reabrir StudyAL Process al volver de una herramienta ──
  // INSTANTÁNEO: usa datos locales, sin esperar al servidor
  useEffect(() => {
    if (!returnToEnfoque) return;
    let cancelled = false;

    async function restoreReturnedSession() {
      const localSessions = getSessionsByTema(tema?.id || "");
      let lastSession = localSessions.find(session => session.id === returnSessionId) || null;
      if (!lastSession && returnSessionId) {
        const lookup = await lookupSessionByIdFromServer(returnSessionId, tema?.id || undefined);
        if (cancelled) return;
        if (lookup.status === 'ERROR') return;
        if (lookup.status === 'FOUND') lastSession = lookup.sessions.find(session => session.id === returnSessionId) || null;
      }

      if (!lastSession) {
        onClearReturnToEnfoque?.();
        return;
      }

    const matIds = lastSession.materialIds || [];

    // Restaurar IDs seleccionados
      setSelectedIds(
      matIds
        .map((id: string) => {
          const doc = tema.documentos?.find(
            (d: any) => sameId(getMaterialKey(d), id) || sameId(d.id, id),
          );
          return doc?.id || id;
        })
        .filter(Boolean),
    );

      setEnfoqueElegido(lastSession.enfoque as any);

      if (lastSession.selectedPages) {
      const rebuilt = lastSession.materialIds.map(
        (matId: string, idx: number) => ({
          materialId: matId,
          materialIndex: idx,
          pages: lastSession.selectedPages![matId] || [],
        }),
      );
        setSeleccionResult(rebuilt as any);
      }

      setResumeSessionId(lastSession.id);

    // ── FUENTE DE VERDAD DEL MODO: processMode guardado en la sesión ──
    // Ya no necesitamos buscar en el mastery localStorage porque
    // studySessions.ts v2 siempre guarda processMode correctamente.
    // Fallback al mastery localStorage solo si la sesión es muy vieja (migración).
      let lastMode: 'free' | 'adaptive' = lastSession.processMode === 'adaptive' ? 'adaptive' : 'free';

    // Fallback de migración: sesiones viejas sin processMode
      if (lastMode === 'free') {
      try {
        const sortedIds = [...matIds].sort().join('-');
        const masteryKey = 'studyal_mastery_v2_' + sortedIds;
        const rawMastery = localStorage.getItem(masteryKey);
        if (rawMastery) {
          const parsed = JSON.parse(rawMastery);
          if (parsed?.processMode === 'adaptive' || parsed?.adaptiveProgram) {
            lastMode = 'adaptive';
          }
        }
      } catch {}
      }

    console.log("⚡ [returnToEnfoque] Sesión:", lastSession.id, "| processMode guardado:", lastSession.processMode, "| modo final:", lastMode);

      setStudyMode(lastMode);

    // Abrir el StudyAL Process directamente, sin pasar por el enfoque
      setOpenFree(true);
      onClearReturnToEnfoque?.();

    // Sincronizar con servidor en background (sin bloquear UI)
      syncSessionsFromServer(tema?.id || "").then(() => {
        refreshSessions();
      }).catch(() => {});
    }
    restoreReturnedSession().catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    returnToEnfoque,
    returnSessionId,
    tema?.id,
    tema?.documentos,
    onClearReturnToEnfoque,
    refreshSessions,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tool = params.get('freeTool');
    const exactSessionId = params.get('freeSessionId');
    if (!exactSessionId || (tool !== 'studymap' && tool !== 'truquitos')) return;
    let cancelled = false;
    lookupSessionByIdFromServer(exactSessionId, tema?.id || undefined).then(lookup => {
      if (cancelled || lookup.status !== 'FOUND') return;
      const restored = lookup.sessions.find(session =>
        session.id === exactSessionId && session.processMode === 'free' && session.temaId === tema?.id
      );
      if (!restored) return;
      const materialSet = new Set(restored.materialIds.map(String));
      const restoredDocs = (tema.documentos || []).filter((document: any) =>
        materialSet.has(String(document?.materialId || document?.id || ''))
      );
      if (restoredDocs.length !== restored.materialIds.length) return;
      const restoredSource = buildSourceSelectionSnapshot(restored.materialIds, restored.selectedPages);
      if (restoredSource.fingerprint !== restored.sourceSelectionFingerprint) return;
      setSelectedIds(restoredDocs.map((document: any) => String(document.id || document.materialId)));
      setSeleccionResult(restored.materialIds.map((materialId, materialIndex) => ({
        materialId,
        materialIndex,
        pages: restored.selectedPages[materialId] || [],
      })) as any);
      setResumeSessionId(restored.id);
      setStudyMode('free');
      chosenModeRef.current = 'free';
      setOpenFree(false);
      setShowStudyMap(tool === 'studymap');
      setShowCheatCodes(tool === 'truquitos');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [tema?.id, tema?.documentos]);

  const shouldAutoOpenAdaptive = autoOpenAdaptive && !adaptiveAutoOpenConsumed;

  function clearAdaptiveAutoOpenState() {
    setAdaptiveAutoOpenConsumed(true);
    if (typeof window === "undefined") return;

    try {
      localStorage.removeItem("studyal_open_tema_adaptive");
      localStorage.removeItem("studyal_open_adaptive_session_id");
    } catch {}

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("adaptiveSessionId");
      url.searchParams.delete("adaptiveView");
      const next = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""}${url.hash || ""}`;
      window.history.replaceState({}, "", next);
    } catch {}
  }

  // Auto-abrir adaptive cuando viene desde /sesion/[N] (volver al plan)
  useEffect(() => {
    if (!shouldAutoOpenAdaptive) return;
    let cancelled = false;
    async function restoreExactAdaptiveSession() {
      if (tema?.id) await syncSessionsFromServer(tema.id);
      if (cancelled) return;
      const allSessions = getSessionsByTema(tema?.id || "");
      const adaptiveSess = autoOpenAdaptiveSessionId
        ? allSessions.find((s: any) => s.id === autoOpenAdaptiveSessionId && s.processMode === "adaptive")
        : allSessions
            .filter((s: any) => s.processMode === "adaptive")
            .sort((a: any, b: any) => Number(b.lastOpenedAt || 0) - Number(a.lastOpenedAt || 0))[0];
      if (!adaptiveSess) return;

      const matIds = adaptiveSess.materialIds || [];
      setSelectedIds(
        matIds.map((id: string) => {
          const doc = tema.documentos?.find(
            (d: any) => sameId(getMaterialKey(d), id) || sameId(d.id, id),
          );
          return doc?.id || id;
        }).filter(Boolean),
      );
      if (adaptiveSess.selectedPages) {
        setSeleccionResult(matIds.map((matId: string, idx: number) => ({
          materialId: matId,
          materialIndex: idx,
          pages: (adaptiveSess.selectedPages as any)[matId] || [],
        })) as any);
      }
      setResumeSessionId(adaptiveSess.id);
      setStudyMode("adaptive");
      chosenModeRef.current = "adaptive";
      // Doble rAF: garantiza que React procesó todos los setState anteriores
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!cancelled) setOpenAdaptive(true);
      }));
    }
    restoreExactAdaptiveSession().catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoOpenAdaptive, autoOpenAdaptiveSessionId, tema?.id]);

  // Sincronizar selectedIds con documentos existentes (limpia IDs de docs borrados)
  // Se desactiva mientras se está borrando para evitar interferencia
  useEffect(() => {
    if (deleting) return; // No limpiar mientras borramos
    const existingIds = new Set(
      tema.documentos
        .flatMap((d: any) => [d.id, getMaterialKey(d)])
        .filter(Boolean),
    );
    setSelectedIds((prev) => {
      const filtered = prev.filter((id) => existingIds.has(id));
      if (filtered.length === 0 && prev.length > 0) {
        setShowSeleccion(false);
        setShowEnfoque(false);
        setEnfoqueElegido(null);
      }
      return filtered;
    });
  }, [tema.documentos, deleting]);

  // ═══ BLOQUEO ZOOM NAVEGADOR + PINCH→ZOOM MAPA ═══
  // - Pinch trackpad / Cmd+scroll → zoomea el MAPA (no la página)
  // - Cmd/Ctrl + (+/-/0) teclado → bloqueado
  // - Pinch nativo Safari → bloqueado
  useEffect(() => {
    // 1. Wheel: si trae ctrl/meta (= pinch o cmd+scroll) → zoom del mapa
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        // Convertir delta a factor de zoom (más suave que el scroll normal)
        // deltaY negativo = pinch out (zoom in), positivo = pinch in (zoom out)
        const factor = Math.exp(-e.deltaY * 0.01);
        setZoom((z) => Math.min(Math.max(z * factor, 0.5), 1.4));
      }
    };

    // 2. Gesture events (Safari macOS pinch nativo)
    let gestureStartZoom = 1;
    const onGestureStart = (e: any) => {
      e.preventDefault();
      gestureStartZoom = zoom;
    };
    const onGestureChange = (e: any) => {
      e.preventDefault();
      // e.scale: 1 = sin cambio, >1 pinch out, <1 pinch in
      const next = Math.min(Math.max(gestureStartZoom * e.scale, 0.5), 1.4);
      setZoom(next);
    };
    const onGestureEnd = (e: any) => {
      e.preventDefault();
    };

    // 3. Bloquear atajos teclado Cmd/Ctrl + (+, -, 0, =)
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key)) {
        e.preventDefault();
      }
    };

    document.addEventListener("wheel", onWheel, {
      passive: false,
      capture: true,
    });
    document.addEventListener("gesturestart", onGestureStart, {
      passive: false,
    });
    document.addEventListener("gesturechange", onGestureChange, {
      passive: false,
    });
    document.addEventListener("gestureend", onGestureEnd, { passive: false });
    document.addEventListener("keydown", onKey, { capture: true });

    // 4. Meta viewport (mobile/tablet pinch nativo)
    const meta = document.querySelector('meta[name="viewport"]');
    const prevViewport = meta?.getAttribute("content") || "";
    if (meta) {
      meta.setAttribute(
        "content",
        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
      );
    }

    return () => {
      document.removeEventListener("wheel", onWheel, { capture: true } as any);
      document.removeEventListener("gesturestart", onGestureStart as any);
      document.removeEventListener("gesturechange", onGestureChange as any);
      document.removeEventListener("gestureend", onGestureEnd as any);
      document.removeEventListener("keydown", onKey, { capture: true } as any);
      if (meta && prevViewport) {
        meta.setAttribute("content", prevViewport);
      }
    };
  }, [zoom]);

  const [showEnfoque, setShowEnfoque] = useState(false);
  const [openFree, setOpenFree] = useState(false);
  const [openAdaptive, setOpenAdaptive] = useState(false);
  const [openManual, setOpenManual] = useState(false);
  const [returningToEnfoque, setReturningToEnfoque] = useState(false);
  const [showSeleccion, setShowSeleccion] = useState(false);
  const [enfoqueElegido, setEnfoqueElegido] = useState<"teorico" | "matematico" | "mixto" | "practico" | null>("teorico");
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [studyMode, setStudyMode] = useState<'free' | 'adaptive' | 'manual'>('free');
  const [seleccionResult, setSeleccionResult] = useState<
    SeleccionResult[] | null
  >(null);
  const [contextMenu, setContextMenu] = useState<any>(null);
  const [vp, setVp] = useState({ w: 1400, h: 900 });


  const dragState = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startPan: { x: 0, y: 0 },
  });

  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);





  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragState.current.active) return;
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      setPan({
        x: dragState.current.startPan.x + dx,
        y: dragState.current.startPan.y + dy,
      });
    };
    const handleUp = () => {
      dragState.current.active = false;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const themeColor = tema.color || materia.color || "var(--gold)";
  const cuadernoColor = "#5eead4";
  const materialColor = "#a78bfa";

  const nodes = useMemo(() => {
    const list: any[] = [];
    const cOpen = expanded.includes("cuaderno");
    const mOpen = expanded.includes("material");

    list.push({
      id: "center",
      x: 0,
      y: -250,
      emoji: "📖",
      label: tema.nombre,
      sublabel: `${tema.apuntes.length} apuntes · ${tema.documentos.length} docs`,
      color: themeColor,
      size: 185,
      type: "root",
    });

    list.push({
      id: "cuaderno",
      x: -185,
      y: -25,
      emoji: "📓",
      label: "Cuaderno",
      sublabel: cOpen ? "Click para cerrar" : "Click para abrir",
      color: cuadernoColor,
      size: 130,
      type: "hub",
    });

    if (cOpen) {
      const cuadernoItems = [
        { id: "rama-apuntes", emoji: "📝", label: "Apuntes", enabled: true },
        { id: "rama-pres", emoji: "📊", label: "Presentación", enabled: false },
        { id: "rama-ensayo", emoji: "📜", label: "Ensayo", enabled: false },
        {
          id: "rama-grupal",
          emoji: "🤝",
          label: "Doc. Grupal",
          enabled: false,
        },
      ];
      const ramaCuadernoY = 135;
      const ramaCuadernoGap = 112;
      cuadernoItems.forEach((item, i) => {
        list.push({
          id: item.id,
          x: -320 + (i - 1.5) * ramaCuadernoGap,
          y: ramaCuadernoY,
          emoji: item.emoji,
          label: item.label,
          color: item.enabled ? cuadernoColor : "#555",
          size: item.id === "rama-subir" ? 115 : 100,
          type: "rama",
          disabled: !item.enabled,
          action: item.id === "rama-apuntes" ? onNuevoApunte : undefined,
        });
      });

      if (tema.apuntes.length > 0) {
        const apunteBaseX = -320 + -1.5 * ramaCuadernoGap;
        const apunteBaseY = ramaCuadernoY + 150;
        const n = tema.apuntes.length;
        const gapX = 128;
        tema.apuntes.forEach((a: any, i: number) => {
          list.push({
            id: `a-${a.id}`,
            x: apunteBaseX + (i - (n - 1) / 2) * gapX,
            y: apunteBaseY,
            emoji: "📝",
            label: a.titulo,
            color: cuadernoColor,
            size: 95,
            type: "apunte",
            data: a,
          });
        });
      }
    }

    list.push({
      id: "material",
      x: 185,
      y: -25,
      emoji: "📂",
      label: "Material",
      sublabel: mOpen ? "Click para cerrar" : "Click para abrir",
      color: materialColor,
      size: 145,
      type: "hub",
    });

    if (mOpen) {
      const materialItems = [
        {
          id: "rama-subir",
          emoji: "📎",
          label: "Subir Archivo",
          enabled: true,
          action: () => onAbrirUploader?.(),
        },
        { id: "rama-yt", emoji: "▶️", label: "YouTube", enabled: false },
      ];
      const ramaMaterialY = 135;
      const ramaMaterialGap = 132;
      materialItems.forEach((item, i) => {
        list.push({
          id: item.id,
          x: 320 + (i - 0.5) * ramaMaterialGap,
          y: ramaMaterialY,
          emoji: item.emoji,
          label: item.label,
          color: item.enabled ? materialColor : "#555",
          size: item.id === "rama-subir" ? 115 : 100,
          type: "rama",
          disabled: !item.enabled,
          action: item.action,
        });
      });

      if (tema.documentos.length > 0) {
        const subirRama = {
          x: 185 + -0.5 * ramaMaterialGap,
          y: ramaMaterialY,
        };
        const n = tema.documentos.length;
        const cols = n >= 10 ? 4 : n >= 5 ? 3 : 2;
        const gapX = n >= 10 ? 132 : n >= 5 ? 148 : 160;
        const gapY = n >= 10 ? 142 : n >= 5 ? 148 : 150;
        const startY = n >= 8 ? 330 : n >= 5 ? 285 : n >= 3 ? 245 : 210;

        tema.documentos.forEach((d: any, i: number) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const materialKey = getMaterialKey(d);
          const sel =
            selectedIds.includes(d.id) || selectedIds.includes(materialKey);
          // ── Buscar sesiones activas para este material ──
          const matSessions = activeSessions.filter((s) =>
            s.materialIds.some(
              (id: string) => sameId(id, materialKey) || sameId(id, d.id),
            ),
          );
          const firstSession = sessionForMaterial(activeSessions, materialKey);
          const visualColor = firstSession
            ? sessionColorForMaterial(activeSessions, materialKey, themeColor)
            : sel
              ? themeColor
              : materialColor;

          list.push({
            id: `d-${d.id}`,
            x: subirRama.x + (col - (cols - 1) / 2) * gapX,
            y: subirRama.y + startY + row * gapY,
            emoji: getDocEmoji(d),
            label: d.nombre,
            color: visualColor,
            size: n >= 10 ? 84 : n >= 5 ? 90 : 98,
            type: "doc",
            data: d,
            selected: sel,
            hasSession: matSessions.length > 0,
            sessionId: firstSession?.id || null,
            sessionCount: firstSession?.materialIds?.length || 0,
            sessions: matSessions,
          });
        });
      }
    }

    return list;
  }, [tema, expanded, selectedIds, themeColor, activeSessions]);

  const rawConns = useMemo(() => {
    const c: { f: string; t: string }[] = [
      { f: "center", t: "cuaderno" },
      { f: "center", t: "material" },
    ];
    if (expanded.includes("cuaderno")) {
      ["rama-apuntes", "rama-pres", "rama-ensayo", "rama-grupal"].forEach(
        (id) => c.push({ f: "cuaderno", t: id }),
      );
      tema.apuntes.forEach((a: any) =>
        c.push({ f: "rama-apuntes", t: `a-${a.id}` }),
      );
    }
    if (expanded.includes("material")) {
      ["rama-subir", "rama-yt"].forEach((id) =>
        c.push({ f: "material", t: id }),
      );
      tema.documentos.forEach((d: any) =>
        c.push({ f: "rama-subir", t: `d-${d.id}` }),
      );
    }
    return c;
  }, [tema, expanded]);

  const curves = useMemo(() => {
    return rawConns
      .map((c) => {
        const f = nodes.find((n: any) => n.id === c.f);
        const t = nodes.find((n: any) => n.id === c.t);
        if (!f || !t) return null;
        const midX = (f.x + t.x) / 2;
        const midY = (f.y + t.y) / 2;
        const dx = t.x - f.x;
        const dy = t.y - f.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const offsetMag = len * 0.2;
        const px = len > 0 ? -dy / len : 0;
        const py = len > 0 ? dx / len : 0;
        const ctrlX = midX + px * offsetMag;
        const ctrlY = midY + py * offsetMag;
        return {
          connKey: `${c.f}-${c.t}`,
          f,
          t,
          fromX: f.x,
          fromY: f.y,
          ctrlX,
          ctrlY,
          toX: t.x,
          toY: t.y,
          color:
            t?.type === "doc" || t?.type === "apunte" || t?.hasSession
              ? t.color || f.color
              : f.color || t.color,
          pathInfo: (() => {
            const vertical = Math.abs(t.y - f.y) >= Math.abs(t.x - f.x) * 0.45;
            const dirY = t.y >= f.y ? 1 : -1;
            const dirX = t.x >= f.x ? 1 : -1;

            const fromPad =
              f.type === "root"
                ? 88
                : f.type === "hub"
                  ? 76
                  : f.type === "rama"
                    ? 58
                    : 48;
            const toPad =
              t.type === "root"
                ? 88
                : t.type === "hub"
                  ? 76
                  : t.type === "rama"
                    ? 58
                    : t.type === "doc"
                      ? 58
                      : 48;

            const sx = vertical ? f.x : f.x + dirX * fromPad;
            const sy = vertical ? f.y + dirY * fromPad : f.y;
            const ex = vertical ? t.x : t.x - dirX * toPad;
            const ey = vertical ? t.y - dirY * toPad : t.y;

            const midY = sy + (ey - sy) * 0.48;
            const r = 10;

            const points = [
              { x: sx, y: sy },
              { x: sx, y: midY },
              { x: ex, y: midY },
              { x: ex, y: ey },
            ];

            return {
              d: [
                `M ${sx} ${sy}`,
                `L ${sx} ${midY - dirY * r}`,
                `Q ${sx} ${midY} ${sx + dirX * r} ${midY}`,
                `L ${ex - dirX * r} ${midY}`,
                `Q ${ex} ${midY} ${ex} ${midY + dirY * r}`,
                `L ${ex} ${ey}`,
              ].join(" "),
              points,
            };
          })(),

          pathD: undefined,
          points: undefined,
        };
      })
      .filter(Boolean)
      .map((c: any) => ({
        ...c,
        pathD: c.pathInfo?.d || c.pathD,
        points: c.pathInfo?.points || c.points,
      })) as any[];
  }, [rawConns, nodes]);

  const transform = useMemo(
    () => ({
      offsetX: vp.w / 2 + pan.x,
      offsetY: vp.h / 2 + pan.y,
      scale: zoom,
    }),
    [vp, pan, zoom],
  );

  const cameraAnimRef = useRef<number | null>(null);

  const animateCamera = useCallback(
    (nextZoom: number, nextPan: { x: number; y: number }, duration = 900) => {
      if (cameraAnimRef.current) {
        cancelAnimationFrame(cameraAnimRef.current);
        cameraAnimRef.current = null;
      }

      const startZoom = zoom;
      const startPan = pan;
      const start = performance.now();
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);

      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const k = ease(t);

        setZoom(startZoom + (nextZoom - startZoom) * k);
        setPan({
          x: startPan.x + (nextPan.x - startPan.x) * k,
          y: startPan.y + (nextPan.y - startPan.y) * k,
        });

        if (t < 1) {
          cameraAnimRef.current = requestAnimationFrame(step);
        } else {
          cameraAnimRef.current = null;
        }
      };

      cameraAnimRef.current = requestAnimationFrame(step);
    },
    [zoom, pan],
  );

  const selectedDocs = useMemo(() => {
    const selectedSet = new Set(selectedIds.map(String));

    // Selección normal desde selectedIds
    if (selectedSet.size > 0) {
      return tema.documentos.filter(
        (d: any) =>
          selectedSet.has(String(d.id)) || selectedSet.has(getMaterialKey(d)),
      );
    }

    // Fallback crítico: cuando se reanuda una sesión adaptativa y React aún
    // no ha aplicado selectedIds, reconstruir docs desde la sesión resumida.
    if (resumeSessionId) {
      const resumeSession = activeSessions.find((s) => s.id === resumeSessionId);
      if (resumeSession?.materialIds?.length) {
        const materialSet = new Set((resumeSession.materialIds || []).map(String));
        return tema.documentos.filter(
          (d: any) =>
            materialSet.has(String(d.id)) || materialSet.has(getMaterialKey(d)),
        );
      }
    }

    return [];
  }, [tema.documentos, selectedIds, resumeSessionId, activeSessions]);

  const adaptiveSelectedPages = useMemo(() => {
    const restored = resumeSessionId
      ? activeSessions.find(session => session.id === resumeSessionId)?.selectedPages
      : null;
    if (restored && Object.keys(restored).length) return restored;
    return mapPageSelectionsToMaterials(selectedDocs, seleccionResult);
  }, [activeSessions, resumeSessionId, seleccionResult, selectedDocs]);

  const freeSourceSelection = useMemo(() => buildSourceSelectionSnapshot(
    selectedDocs.map(getMaterialKey),
    adaptiveSelectedPages,
  ), [selectedDocs, adaptiveSelectedPages]);


  // Guard: si la selección actual no coincide con la sesión resumida, limpiar resume viejo
  useEffect(() => {
    if (!resumeSessionId) return;

    const resumeSession = activeSessions.find((s) => s.id === resumeSessionId);
    if (!resumeSession) {
      setResumeSessionId(null);
      setStudyMode("free");
      return;
    }

    const resumeKey = [...(resumeSession.materialIds || [])].map(String).sort().join(',');

    // Fuente real de selección actual:
    // 1) selectedDocs si ya está listo
    // 2) seleccionResult si todavía se está hidratando
    const currentMaterialIds =
      selectedDocs.length > 0
        ? selectedDocs.map((d: any) => getMaterialKey(d)).filter(Boolean)
        : Array.isArray(seleccionResult) && seleccionResult.length > 0
          ? seleccionResult.map((r: any) => String(r?.materialId || '')).filter(Boolean)
          : [];

    const currentKey = [...currentMaterialIds].sort().join(',');

    // Si todavía no hay selección reconstruida, NO limpiar la sesión.
    // Esto evita que al volver desde /sesion se pierda el resumeSessionId
    // antes de que React termine de hidratar selectedIds/seleccionResult.
    if (!currentKey) return;

    if (resumeKey !== currentKey) {
      setResumeSessionId(null);
      if (!chosenModeRef.current) {
        setStudyMode("free");
      }
    }
  }, [selectedDocs, seleccionResult, resumeSessionId, activeSessions]);


  useEffect(() => {
    if (!pendingCoachTool) return;
    if (showCoach) return;

    const currentSel =
      Array.isArray(seleccionResult) && seleccionResult.length
        ? seleccionResult
        : undefined;

    const tool = pendingCoachTool;
    setPendingCoachTool(null);

    requestAnimationFrame(() => {
      const toolMap: Record<string, () => void> = {
        repasar: () => onOpenRepasar?.(selectedDocs, currentSel as any, resumeSessionId || null),
        analisis: () => onOpenAnalisis?.(selectedDocs, currentSel as any, resumeSessionId || null),
        flashcards: () => onOpenFlashcards?.(selectedDocs, currentSel as any, resumeSessionId || null),
        quiz: () => onOpenQuiz?.(selectedDocs, currentSel as any, resumeSessionId || null),
        examen: () => onOpenExam?.(selectedDocs, currentSel as any, resumeSessionId || null),
        alai: () => onOpenAlai?.(selectedDocs, currentSel as any, resumeSessionId || null),
        studymap: () => setShowStudyMap(true),
        truquitos: () => setShowCheatCodes(true),
      };

      toolMap[tool]?.();
    });
  }, [
    pendingCoachTool,
    showCoach,
    seleccionResult,
    selectedDocs,
    resumeSessionId,
    onOpenRepasar,
    onOpenAnalisis,
    onOpenFlashcards,
    onOpenQuiz,
    onOpenExam,
    onOpenAlai,
  ]);

  const energyLines: CurveLine[] = useMemo(() => {
    return curves.map((c) => {
      const isActive =
        hoveredNode === c.t.id ||
        hoveredNode === c.f.id ||
        !!c.t.selected ||
        expanded.includes(c.t.id);
      return {
        key: c.connKey,
        fromX: c.fromX,
        fromY: c.fromY,
        ctrlX: c.ctrlX,
        ctrlY: c.ctrlY,
        toX: c.toX,
        toY: c.toY,
        color: c.color,
        active: isActive,
        points: c.points,
      };
    });
  }, [curves, hoveredNode, expanded]);

  useEnergyEngine(canvasRef, chargeState, energyLines, transform);

  const fitToView = () => {
    if (nodes.length === 0 || vp.w < 100 || vp.h < 100) return;

    const minX = Math.min(...nodes.map((n: any) => n.x - n.size / 2));
    const maxX = Math.max(...nodes.map((n: any) => n.x + n.size / 2));
    const minY = Math.min(...nodes.map((n: any) => n.y - n.size / 2));
    const maxY = Math.max(...nodes.map((n: any) => n.y + n.size / 2));

    const w = maxX - minX;
    const h = maxY - minY;

    // Zoom estable: no se achica cada vez que abres ramas.
    const preferredZoom = vp.w < 760 ? 0.82 : vp.w < 1100 ? 0.9 : 0.96;
    const fitZoom = preferredZoom;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    animateCamera(
      fitZoom,
      {
        x: 0,
        y: 70,
      },
      550,
    );
  };

  useEffect(() => {
    // Doble RAF para esperar a que el viewport tenga sus medidas reales
    // y evitar el "salto" inicial de cámara
    let raf1 = 0,
      raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        fitToView();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNodeClick = (n: any) => {
    if (n.type === "root" || n.id === "center") {
      fitToView();
      return;
    }

    if (n.id === "cuaderno" || n.id === "material") {
      const nextOpen = !expanded.includes(n.id);
      setExpanded((prev) =>
        prev.includes(n.id) ? prev.filter((x) => x !== n.id) : [...prev, n.id],
      );

      // Cámara: no zoom-out. Baja/sube hacia la rama abierta con tamaño estable.
      if (nextOpen) {
        const targetZoom = vp.w < 760 ? 0.82 : vp.w < 1100 ? 0.9 : 0.98;
        const docCount = Array.isArray(tema?.documentos)
          ? tema.documentos.length
          : 0;

        const focusX = n.id === "material" ? n.x : n.x;
        const focusY =
          n.id === "material"
            ? n.y +
              (docCount >= 8
                ? 520
                : docCount >= 5
                  ? 455
                  : docCount >= 3
                    ? 390
                    : 320)
            : n.y + 260;

        animateCamera(
          targetZoom,
          {
            x: -focusX * targetZoom,
            y: -focusY * targetZoom + 110,
          },
          550,
        );
      } else {
        const remainingOpen = expanded.filter((id) => id !== n.id);
        if (remainingOpen.length === 0) {
          setTimeout(() => fitToView(), 80);
        }
      }
      return;
    }
    if (n.disabled) return;
    if (n.action) {
      n.action();
      return;
    }
    if (n.type === "apunte") {
      onAbrirApunte(n.data);
      return;
    }
    if (n.type === "doc") {
      // ── Toggle inteligente con sesiones ──
      const matId = getMaterialKey(n.data);
      const matSessions = activeSessions.filter((s) =>
        s.materialIds.some((id: string) => sameId(id, matId)),
      );
      const clickedSession = matSessions[0] || null;

      setResumeSessionId(null);
      setStudyMode('free');
      setSelectedIds((prev) => {
        // ¿La selección actual coincide con alguna sesión completa?
        const currentMatchesSession = activeSessions.find((s) => {
          if (s.materialIds.length !== prev.length) return false;
          const setA = new Set(s.materialIds);
          return prev.every((id) => setA.has(id));
        });

        // CASO A: el material clickeado pertenece a una sesión
        if (clickedSession) {
          const sessionIds = clickedSession.materialIds;
          const prevMatIds = selectedDocs.map((d: any) => getMaterialKey(d));
          const isFullSessionSelected =
            sessionIds.length === prevMatIds.length &&
            sessionIds.every((id: string) =>
              prevMatIds.some((pid: string) => sameId(pid, id)),
            );

          if (isFullSessionSelected) {
            // Toggle OFF: la sesión completa ya estaba seleccionada → deseleccionar todo
            return [];
          }
          // Cambiar a esta sesión (limpia selección previa)
          return [...sessionIds].slice(0, 5);
        }

        // CASO B: el material clickeado NO pertenece a ninguna sesión
        // Si actualmente hay una sesión completa seleccionada → reemplazar por solo este
        if (currentMatchesSession) {
          return [matId];
        }

        // CASO C: selección libre normal (toggle clásico con límite 5)
        const wasSelected = prev.includes(matId);
        const next = wasSelected
          ? prev.filter((x) => x !== matId)
          : prev.length < 5
            ? [...prev, matId]
            : prev;

        const targetZoom = vp.w < 760 ? 1.15 : vp.w < 1100 ? 1.22 : 1.35;

        // Si seleccionas un documento, acercarse bastante.
        if (!wasSelected && next.includes(matId)) {
          animateCamera(
            targetZoom,
            {
              x: -n.x * targetZoom,
              y: -n.y * targetZoom - 160,
            },
            900,
          );
        }

        // Si deseleccionas y ya no queda ningún documento seleccionado,
        // volver automáticamente al nodo Material.
        if (wasSelected && next.length === 0 && expanded.includes("material")) {
          const materialNode = nodes.find((n) => n.id === "material");

          if (materialNode) {
            animateCamera(
              targetZoom,
              {
                x: -materialNode.x * targetZoom,
                y: -(materialNode.y + 320) * targetZoom + 110,
              },
              800,
            );
          }
        }

        return next;
      });
    }
  };

  if (showCoach)
    return (
      <MasteryCoach
        materiales={selectedDocs}
        tema={tema}
        materia={materia}
        masterySnapshot={masterySnapshot}
        onInitMastery={onInitMastery}
        onMasteryUpdate={onMasteryEvent}
        onClose={() => {
          setShowCoach(false);
          if (coachBackToProcess) {
            setOpenFree(true);
            setCoachBackToProcess(false);
          }
        }}
        onOpenTool={(tool) => {
          setCoachBackToProcess(false);
          setPendingCoachTool(tool);
          setShowCoach(false);
        }}
      />
    );

  if (showStudyMap)
    return (
      <ALAIStudyMap
        sessionId={resumeSessionId || ''}
        sourceSelection={freeSourceSelection}
        materiales={selectedDocs}
        seleccion={
          Array.isArray(seleccionResult) && seleccionResult.length
            ? seleccionResult
            : undefined
        }
        materia={materia}
        tema={tema}
        onMasteryEvent={onMasteryEvent}
        onBack={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('freeSessionId');
          url.searchParams.delete('freeTool');
          window.history.replaceState({}, '', `${url.pathname}${url.search}`);
          setShowStudyMap(false);
          setOpenFree(true);
        }}
      />
    );

  if (showCheatCodes)
    return (
      <ALAIStudyALCheatCodes
        sessionId={resumeSessionId || ''}
        sourceSelection={freeSourceSelection}
        materiales={selectedDocs}
        seleccion={
          Array.isArray(seleccionResult) && seleccionResult.length
            ? seleccionResult
            : undefined
        }
        materia={materia}
        tema={tema}
        masteryContext={masteryContext}
        onMasteryEvent={onMasteryEvent}
        onBack={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('freeSessionId');
          url.searchParams.delete('freeTool');
          window.history.replaceState({}, '', `${url.pathname}${url.search}`);
          setShowCheatCodes(false);
          setOpenFree(true);
        }}
      />
    );

  // ── Memoizar el masteryState reconstruido para evitar re-renders infinitos ──
  const reconstructedMasteryState = useMemo(() => {
    if (!resumeSessionId || !openFree) return masteryState;
    const all = getSessionsByTema(tema?.id || '');
    let sess: any = all.find(s => s.id === resumeSessionId);

    // Si la sesión clickeada NO tiene adaptiveProgram, buscar OTRA sesión del mismo material
    // que sí lo tenga (puede haber varias sesiones — usar la que tiene el programa completo).
    if (!sess?.adaptiveProgram) {
      const currentMatIds = (sess?.materialIds || []).map(String).sort().join('|');
      const alternative = all
        .filter((s: any) => !!s.adaptiveProgram)
        .filter((s: any) => {
          const sMatIds = (s.materialIds || []).map(String).sort().join('|');
          // Match por IDs exactos o solo hay 1 material total (asumir mismo)
          return sMatIds === currentMatIds || ((s.materialIds || []).length === 1 && (sess?.materialIds || []).length === 1);
        })
        .sort((a: any, b: any) => Number(b.lastOpenedAt || 0) - Number(a.lastOpenedAt || 0))[0];
      if (alternative) {
        console.log('🔁 [TemaView] Sesión clickeada sin program — usando alternativa:', alternative.id);
        sess = alternative;
      }
    }

    if (sess && (sess as any).adaptiveProgram) {
      console.log('🔁 [TemaView] Reconstruyendo masteryState desde sesión:', sess.id, '| program sessions:', (sess as any).adaptiveProgram?.sessions?.length, '| style:', (sess as any).processStyle);
      return {
        ...(masteryState || {}),
        processMode: sess.processMode || 'adaptive',
        adaptiveProgram: (sess as any).adaptiveProgram,
        processStyle: (sess as any).processStyle,
        targetScore: (sess as any).targetScore,
        examDate: (sess as any).examDate,
        examDateCustom: (sess as any).examDateCustom,
        materialBlueprint: (sess as any).materialBlueprint,
        sessionKey: (masteryState as any)?.sessionKey || sess.id,
      };
    }
    return masteryState;
  }, [resumeSessionId, openFree, tema?.id, masteryState]);

  // Loader instantáneo cuando venimos desde /sesion con autoOpenAdaptive
  // Evita ver el mapa del tema por un instante antes de abrir el plan
  if (shouldAutoOpenAdaptive && !openAdaptive)
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'radial-gradient(circle at 20% 10%, rgba(56,189,248,.14), transparent 28%), linear-gradient(135deg, var(--bg-primary), color-mix(in srgb, var(--bg-primary) 78%, #000))',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 16, color: 'var(--text-primary)',
      }}>
        <div style={{ fontSize: 48 }}>📖</div>
        <div style={{ fontFamily: HAND, fontSize: 28, color: '#38bdf8' }}>abriendo tu plan...</div>
        <div style={{
          width: 32, height: 32,
          border: '3px solid rgba(56,189,248,0.3)',
          borderTopColor: '#38bdf8',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );

  if (openAdaptive)
    return (
      <StudyALAdaptive
        materiales={selectedDocs}
        temaId={tema?.id}
        userId={userId || undefined}
        sessionId={resumeSessionId || undefined}
        selectedPages={adaptiveSelectedPages}
        onClose={() => {
          clearAdaptiveAutoOpenState();
          setOpenAdaptive(false);
          refreshSessions();
        }}
      />
    );

  if (openManual)
    return (
      <StudyALManual
        materiales={selectedDocs}
        temaId={tema?.id}
        onClose={() => {
          setOpenManual(false);
          refreshSessions();
        }}
      />
    );

  if (openFree)
    return (
      <StudyALProcess
        userId={userId || undefined}
        masteryState={reconstructedMasteryState}
        masterySnapshot={masterySnapshot}

        temaId={tema?.id}
        sessionId={resumeSessionId || ''}
        sourceSelection={freeSourceSelection}
        enfoque={enfoqueElegido || 'teorico'}
        onOpenStudyMap={() => {
          setShowStudyMap(true);
          setOpenFree(false);
        }}
        onOpenCheatCodes={() => {
          setShowCheatCodes(true);
          setOpenFree(false);
        }}
        materiales={selectedDocs}
        onOpenCoach={() => {
          setCoachBackToProcess(true);
          setOpenFree(false);
          setShowCoach(true);
        }}
        onClose={() => {
          setOpenFree(false);
          chosenModeRef.current = null; // Limpiar modo elegido al cerrar
          // NO borrar studyMode al cerrar
          // para que "seguir estudiando" recuerde el modo correcto
          refreshSessions();
        }}
        onOpenAnalisis={() => {
          const matsSeleccionados = selectedDocs;
          onOpenAnalisis?.(
            matsSeleccionados,
            Array.isArray(seleccionResult) && seleccionResult.length
              ? seleccionResult
              : undefined,
            resumeSessionId || null,
          );
        }}
        onOpenFlashcards={() => {
          const matsSeleccionados = selectedDocs;
          const rawSel = Array.isArray(seleccionResult) ? seleccionResult : [];

          const normalizePages = (value: any): number[] => {
            if (Array.isArray(value)) {
              return Array.from(
                new Set(
                  value
                    .map((n: any) => Number(n))
                    .filter((n: number) => Number.isFinite(n) && n > 0),
                ),
              ).sort((a: number, b: number) => a - b);
            }

            if (value && typeof value === "object") {
              const start = Number(
                value.start ??
                  value.from ??
                  value.startPage ??
                  value.paginaInicial,
              );
              const end = Number(
                value.end ?? value.to ?? value.endPage ?? value.paginaFinal,
              );

              if (
                Number.isFinite(start) &&
                Number.isFinite(end) &&
                start > 0 &&
                end >= start
              ) {
                return Array.from(
                  { length: end - start + 1 },
                  (_, i) => start + i,
                );
              }
            }

            return [];
          };

          const normalizedSel = matsSeleccionados
            .map((mat: any, idx: number) => {
              const matMaterialId = String(
                mat?.materialId || mat?.material_id || mat?.id || "",
              );
              const matDocumentId = String(mat?.id || "");

              const rawByMaterialIndex =
                rawSel.find(
                  (candidate: any) => Number(candidate?.materialIndex) === idx,
                ) || null;

              const rawById =
                rawSel.find((candidate: any) => {
                  const nestedCandidate =
                    candidate?.material ||
                    candidate?.documento ||
                    candidate?.doc ||
                    candidate?.source ||
                    candidate?.file ||
                    null;

                  const candidateIds = [
                    candidate?.materialId,
                    candidate?.material_id,
                    candidate?.documentId,
                    candidate?.document_id,
                    candidate?.docId,
                    candidate?.doc_id,
                    candidate?.id,
                    nestedCandidate?.materialId,
                    nestedCandidate?.material_id,
                    nestedCandidate?.id,
                  ]
                    .filter(Boolean)
                    .map((v: any) => String(v));

                  return (
                    candidateIds.includes(matMaterialId) ||
                    candidateIds.includes(matDocumentId)
                  );
                }) || null;

              const item: any =
                rawByMaterialIndex ?? rawById ?? rawSel[idx] ?? null;
              if (!item) return null;

              const pages =
                [
                  item?.pages,
                  item?.selectedPages,
                  item?.paginasSeleccionadas,
                  item?.paginas,
                  item?.pageNumbers,
                  item?.range,
                  item?.selection,
                ]
                  .map(normalizePages)
                  .find((arr: any) => Array.isArray(arr) && arr.length > 0) ||
                [];

              const text =
                item?.text ||
                item?.texto ||
                item?.content ||
                item?.contenido ||
                item?.selectedText ||
                item?.rawText ||
                item?.extract ||
                item?.selected?.text ||
                undefined;

              if (!pages.length && !text) return null;

              return {
                materialId: matMaterialId,
                documentId: matDocumentId,
                materialIndex: idx,
                pages,
                text,
              };
            })
            .filter(Boolean);

          console.log("📑 RAW seleccionResult:", rawSel);
          console.log("✅ NORMALIZED seleccionResult:", normalizedSel);
          console.log(
            "📘 matsSeleccionados:",
            matsSeleccionados.map((m: any) => m.materialId || m.id),
          );

          // ── Guardar sesión de estudio para persistencia ──
          let savedSessionId: string | null = null;
          try {
            const pagesByMat: Record<string, number[]> = {};
            normalizedSel.forEach((n: any) => {
              if (
                n?.materialId &&
                Array.isArray(n.pages) &&
                n.pages.length > 0
              ) {
                pagesByMat[n.materialId] = n.pages;
              }
            });
            const matIds = matsSeleccionados
              .map((m: any) => m?.materialId || m?.id)
              .filter(Boolean) as string[];

            if (tema?.id && matIds.length > 0) {
              // Leer el modo real desde la sesión activa que coincida con estos materiales
              const _matchingMode = studyMode || 'free';
              const sess = upsertSession({
                temaId: tema.id,
                enfoque: enfoqueElegido as any,
                processMode: _matchingMode,
                studyMode: _matchingMode,
                materialIds: matIds,
                materialNames: matsSeleccionados.map((m: any) => String(m?.nombre || m?.name || '').trim()).filter(Boolean),
                selectedPages: Object.keys(pagesByMat).length
                  ? pagesByMat
                  : undefined,
              } as any);
              savedSessionId = sess.id;
              refreshSessions();
              console.log(
                "💾 [TemaView] Sesión upsertada:",
                sess.id,
                "| flashcards en cache:",
                sess.flashcards?.length || 0,
              );
            }
          } catch (e) {
            console.warn("Error guardando sesión:", e);
          }

          onOpenFlashcards?.(
            matsSeleccionados,
            normalizedSel.length ? normalizedSel : undefined,
            resumeSessionId || savedSessionId,
          );
        }}
        onOpenQuiz={() => {
          const matsSeleccionados = selectedDocs;
          const rawSel = Array.isArray(seleccionResult) ? seleccionResult : [];

          const normalizePages = (value: any): number[] => {
            if (Array.isArray(value)) {
              return Array.from(
                new Set(
                  value
                    .map((n: any) => Number(n))
                    .filter((n: number) => Number.isFinite(n) && n > 0),
                ),
              ).sort((a: number, b: number) => a - b);
            }
            if (value && typeof value === "object") {
              const start = Number(
                value.start ??
                  value.from ??
                  value.startPage ??
                  value.paginaInicial,
              );
              const end = Number(
                value.end ?? value.to ?? value.endPage ?? value.paginaFinal,
              );
              if (
                Number.isFinite(start) &&
                Number.isFinite(end) &&
                start > 0 &&
                end >= start
              ) {
                return Array.from(
                  { length: end - start + 1 },
                  (_, i) => start + i,
                );
              }
            }
            return [];
          };

          const normalizedSel = matsSeleccionados
            .map((mat: any, idx: number) => {
              const matMaterialId = String(
                mat?.materialId || mat?.material_id || mat?.id || "",
              );
              const matDocumentId = String(mat?.id || "");
              const rawByIndex =
                rawSel.find((c: any) => Number(c?.materialIndex) === idx) ||
                null;
              const rawById =
                rawSel.find((c: any) => {
                  const ids = [
                    c?.materialId,
                    c?.material_id,
                    c?.documentId,
                    c?.id,
                  ]
                    .filter(Boolean)
                    .map((v: any) => String(v));
                  return (
                    ids.includes(matMaterialId) || ids.includes(matDocumentId)
                  );
                }) || null;
              const item: any = rawByIndex ?? rawById ?? rawSel[idx] ?? null;
              if (!item) return null;
              const pages =
                [item?.pages, item?.selectedPages, item?.paginas, item?.range]
                  .map(normalizePages)
                  .find((arr: any) => Array.isArray(arr) && arr.length > 0) ||
                [];
              const text =
                item?.text || item?.texto || item?.content || undefined;
              if (!pages.length && !text) return null;
              return {
                materialId: matMaterialId,
                documentId: matDocumentId,
                materialIndex: idx,
                pages,
                text,
              };
            })
            .filter(Boolean);

          onOpenQuiz?.(
            matsSeleccionados,
            normalizedSel.length ? normalizedSel : undefined,
            resumeSessionId || null,
          );
        }}
        onOpenRepasar={() => {
          const matsSeleccionados = selectedDocs;
          const rawSel = Array.isArray(seleccionResult) ? seleccionResult : [];

          const normalizePages = (value: any): number[] => {
            if (Array.isArray(value)) {
              return Array.from(
                new Set(
                  value
                    .map((n: any) => Number(n))
                    .filter((n: number) => Number.isFinite(n) && n > 0),
                ),
              ).sort((a: number, b: number) => a - b);
            }
            if (value && typeof value === "object") {
              const start = Number(
                value.start ??
                  value.from ??
                  value.startPage ??
                  value.paginaInicial,
              );
              const end = Number(
                value.end ?? value.to ?? value.endPage ?? value.paginaFinal,
              );
              if (
                Number.isFinite(start) &&
                Number.isFinite(end) &&
                start > 0 &&
                end >= start
              ) {
                return Array.from(
                  { length: end - start + 1 },
                  (_, i) => start + i,
                );
              }
            }
            return [];
          };

          const normalizedSel = matsSeleccionados
            .map((mat: any, idx: number) => {
              const matMaterialId = String(
                mat?.materialId || mat?.material_id || mat?.id || "",
              );
              const matDocumentId = String(mat?.id || "");
              const rawByIndex =
                rawSel.find((c: any) => Number(c?.materialIndex) === idx) ||
                null;
              const rawById =
                rawSel.find((c: any) => {
                  const ids = [
                    c?.materialId,
                    c?.material_id,
                    c?.documentId,
                    c?.id,
                  ]
                    .filter(Boolean)
                    .map((v: any) => String(v));
                  return (
                    ids.includes(matMaterialId) || ids.includes(matDocumentId)
                  );
                }) || null;
              const item: any = rawByIndex ?? rawById ?? rawSel[idx] ?? null;
              if (!item) return null;

              const pages =
                [item?.pages, item?.selectedPages, item?.paginas, item?.range]
                  .map(normalizePages)
                  .find((arr: any) => Array.isArray(arr) && arr.length > 0) ||
                [];

              const text =
                item?.text ||
                item?.texto ||
                item?.content ||
                item?.contenido ||
                item?.selectedText ||
                undefined;
              if (!pages.length && !text) return null;

              return {
                materialId: matMaterialId,
                documentId: matDocumentId,
                materialIndex: idx,
                pages,
                text,
              };
            })
            .filter(Boolean);

          let savedSessionId: string | null = null;
          try {
            const pagesByMat: Record<string, number[]> = {};
            normalizedSel.forEach((n: any) => {
              if (
                n?.materialId &&
                Array.isArray(n.pages) &&
                n.pages.length > 0
              ) {
                pagesByMat[n.materialId] = n.pages;
              }
            });

            const matIds = matsSeleccionados
              .map((m: any) => m?.materialId || m?.id)
              .filter(Boolean) as string[];

            if (tema?.id && matIds.length > 0) {
              const _repasarMode = studyMode || 'free';
              const sess = upsertSession({
                temaId: tema.id,
                enfoque: "teorico" as any,
                processMode: _repasarMode,
                studyMode: _repasarMode,
                materialIds: matIds,
                materialNames: matsSeleccionados.map((m: any) => String(m?.nombre || m?.name || '').trim()).filter(Boolean),
                selectedPages: Object.keys(pagesByMat).length
                  ? pagesByMat
                  : undefined,
                currentPhase: "repasar",
              } as any);
              savedSessionId = sess.id;
              setResumeSessionId(sess.id);
              refreshSessions();
            }
          } catch (e) {
            console.warn("Error guardando sesión de repasar:", e);
          }

          onOpenRepasar?.(
            matsSeleccionados,
            normalizedSel.length ? normalizedSel : undefined,
            resumeSessionId || savedSessionId,
          );
        }}
        onOpenAlai={() => {
          const matsSeleccionados = selectedDocs;
          const rawSel = Array.isArray(seleccionResult) ? seleccionResult : [];

          const normalizePages = (value: any): number[] => {
            if (Array.isArray(value)) {
              return Array.from(
                new Set(
                  value
                    .map((n: any) => Number(n))
                    .filter((n: number) => Number.isFinite(n) && n > 0),
                ),
              ).sort((a: number, b: number) => a - b);
            }
            if (value && typeof value === "object") {
              const start = Number(
                value.start ??
                  value.from ??
                  value.startPage ??
                  value.paginaInicial,
              );
              const end = Number(
                value.end ?? value.to ?? value.endPage ?? value.paginaFinal,
              );
              if (
                Number.isFinite(start) &&
                Number.isFinite(end) &&
                start > 0 &&
                end >= start
              ) {
                return Array.from(
                  { length: end - start + 1 },
                  (_, i) => start + i,
                );
              }
            }
            return [];
          };

          const normalizedSel = matsSeleccionados
            .map((mat: any, idx: number) => {
              const matMaterialId = String(
                mat?.materialId || mat?.material_id || mat?.id || "",
              );
              const matDocumentId = String(mat?.id || "");
              const rawByIndex =
                rawSel.find((c: any) => Number(c?.materialIndex) === idx) ||
                null;
              const rawById =
                rawSel.find((c: any) => {
                  const ids = [
                    c?.materialId,
                    c?.material_id,
                    c?.documentId,
                    c?.id,
                  ]
                    .filter(Boolean)
                    .map((v: any) => String(v));
                  return (
                    ids.includes(matMaterialId) || ids.includes(matDocumentId)
                  );
                }) || null;
              const item: any = rawByIndex ?? rawById ?? rawSel[idx] ?? null;
              if (!item) return null;

              const pages =
                [item?.pages, item?.selectedPages, item?.paginas, item?.range]
                  .map(normalizePages)
                  .find((arr: any) => Array.isArray(arr) && arr.length > 0) ||
                [];

              const text =
                item?.text ||
                item?.texto ||
                item?.content ||
                item?.contenido ||
                item?.selectedText ||
                undefined;
              if (!pages.length && !text) return null;

              return {
                materialId: matMaterialId,
                documentId: matDocumentId,
                materialIndex: idx,
                pages,
                text,
              };
            })
            .filter(Boolean);

          onOpenAlai?.(
            matsSeleccionados,
            normalizedSel.length ? normalizedSel : undefined,
            resumeSessionId || null,
          );
        }}
        onOpenExam={() => {
          const matsSeleccionados = selectedDocs;
          const rawSel = Array.isArray(seleccionResult) ? seleccionResult : [];

          const normalizePages = (value: any): number[] => {
            if (Array.isArray(value)) {
              return Array.from(
                new Set(
                  value
                    .map((n: any) => Number(n))
                    .filter((n: number) => Number.isFinite(n) && n > 0),
                ),
              ).sort((a: number, b: number) => a - b);
            }
            if (value && typeof value === "object") {
              const start = Number(
                value.start ??
                  value.from ??
                  value.startPage ??
                  value.paginaInicial,
              );
              const end = Number(
                value.end ?? value.to ?? value.endPage ?? value.paginaFinal,
              );
              if (
                Number.isFinite(start) &&
                Number.isFinite(end) &&
                start > 0 &&
                end >= start
              ) {
                return Array.from(
                  { length: end - start + 1 },
                  (_, i) => start + i,
                );
              }
            }
            return [];
          };

          const normalizedSel = matsSeleccionados
            .map((mat: any, idx: number) => {
              const matMaterialId = String(
                mat?.materialId || mat?.material_id || mat?.id || "",
              );
              const matDocumentId = String(mat?.id || "");
              const rawByIndex =
                rawSel.find((c: any) => Number(c?.materialIndex) === idx) ||
                null;
              const rawById =
                rawSel.find((c: any) => {
                  const ids = [
                    c?.materialId,
                    c?.material_id,
                    c?.documentId,
                    c?.id,
                  ]
                    .filter(Boolean)
                    .map((v: any) => String(v));
                  return (
                    ids.includes(matMaterialId) || ids.includes(matDocumentId)
                  );
                }) || null;
              const item: any = rawByIndex ?? rawById ?? rawSel[idx] ?? null;
              if (!item) return null;

              const pages =
                [item?.pages, item?.selectedPages, item?.paginas, item?.range]
                  .map(normalizePages)
                  .find((arr: any) => Array.isArray(arr) && arr.length > 0) ||
                [];

              const text =
                item?.text ||
                item?.texto ||
                item?.content ||
                item?.contenido ||
                item?.selectedText ||
                undefined;
              if (!pages.length && !text) return null;

              return {
                materialId: matMaterialId,
                documentId: matDocumentId,
                materialIndex: idx,
                pages,
                text,
              };
            })
            .filter(Boolean);

          onOpenExam?.(
            matsSeleccionados,
            normalizedSel.length ? normalizedSel : undefined,
            resumeSessionId || null,
          );
        }}
        onComingSoon={() => {}}
      />
    );

  // Sin loader: la restauración es instantánea desde datos locales

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0a0c",
        overflow: "hidden",
        color: "#fff",
        fontFamily: HAND,
      }}
    >
      {/* Fondo cuaderno */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(to bottom, transparent 0, transparent 47px, rgba(255,255,255,0.04) 47px, rgba(255,255,255,0.04) 48px, transparent 48px)`,
          backgroundSize: "100% 48px",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 80,
          top: 0,
          bottom: 0,
          width: 1.5,
          background: "rgba(239,68,68,0.5)",
          boxShadow: "0 0 8px rgba(239,68,68,0.3)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1,
        }}
      />
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept="application/pdf,.pdf,.docx,.txt,image/*"
        onChange={handleArchivoValidado}
      />
      {modalArchivo && (
        <ModalConvertirPDF
          fileName={modalArchivo.nombre}
          fileType={modalArchivo.tipo}
          onCerrar={() => setModalArchivo(null)}
        />
      )}

      {subiendoDoc && (
        <div
          style={{
            position: "fixed",
            top: 90,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            background: "rgba(245,200,66,0.1)",
            border: "1px solid rgba(245,200,66,0.4)",
            padding: "10px 26px",
            borderRadius: 40,
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              border: "2.5px solid #f5c842",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span style={{ fontWeight: 700, color: "#f5c842", fontSize: 18 }}>
            cargando...
          </span>
        </div>
      )}

      {/* TOP BAR */}
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 12,
          zIndex: 1000,
          pointerEvents: "none",
        }}
      ></div>

      {/* Estilos globales TemaView */}
      <style>{`
        @keyframes tvSyncPulse {
          0%, 100% { box-shadow: 0 0 8px #10b981, 0 0 0 0 rgba(16,185,129,0.45); }
          50% { box-shadow: 0 0 12px #10b981, 0 0 0 5px rgba(16,185,129,0); }
        }
        .tv-sync-dot {
          animation: tvSyncPulse 1.8s ease-in-out infinite;
        }
        @keyframes tvFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      {/* BREADCRUMB */}
      <div
        style={{
          position: "fixed",
          top: 56,
          left: 16,
          zIndex: 1000,
          background: "#0d0d10",
          border: "1.5px solid rgba(255,255,255,0.12)",
          padding: "6px 16px",
          borderRadius: 30,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 17,
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          maxWidth: "calc(50vw - 220px)",
          overflow: "hidden",
        }}
      >
        {/* 🏠 → mis materias */}
        <button
          onClick={() => onBack && onBack()}
          title="Mis materias"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            transition: "transform 0.2s, filter 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.18)";
            e.currentTarget.style.filter =
              "drop-shadow(0 0 6px rgba(245,200,66,0.8))";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.filter = "none";
          }}
        >
          🏠
        </button>
        <span style={{ opacity: 0.4 }}>›</span>
        {/* Nombre materia → vista materia (lista de temas) */}
        <button
          onClick={() => onBackMateria && onBackMateria()}
          title={`Volver a ${materia.nombre}`}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            color: "#fff",
            fontFamily: BODY,
            fontSize: 17,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 200,
            transition: "color 0.2s, text-shadow 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#f5c842";
            e.currentTarget.style.textShadow = "0 0 8px rgba(245,200,66,0.6)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#fff";
            e.currentTarget.style.textShadow = "none";
          }}
        >
          {materia.emoji} {materia.nombre}
        </button>
        <span style={{ opacity: 0.4 }}>›</span>
        <span
          style={{
            color: themeColor,
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 180,
          }}
        >
          {tema.nombre}
        </span>
      </div>

      {/* TIPS */}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          display: "flex",
          gap: 6,
          fontSize: 11.5,
          flexWrap: "nowrap",
          justifyContent: "center",
          opacity: 0.7,
          pointerEvents: "none",
        }}
      >
        {[
          { ico: "🖱", t: "Scroll para zoom" },
          { ico: "✋", t: "Drag para mover" },
          { ico: "👆", t: "Click para expandir" },
        ].map((tip, i) => (
          <div
            key={i}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-color2)",
              padding: "5px 11px",
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              fontFamily: BODY,
              fontWeight: 700,
              letterSpacing: 0.2,
              boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
            }}
          >
            <span style={{ fontSize: 12 }}>{tip.ico}</span>
            <span>{tip.t}</span>
          </div>
        ))}
      </div>

      {/* SYNC */}
      <div
        style={{
          position: "fixed",
          top: 20,
          right: 16,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 12,
          color: "var(--text-muted)",
          background: "var(--bg-card)",
          border: "1.5px solid var(--border-color2)",
          padding: "6px 12px",
          borderRadius: 999,
          fontFamily: BODY,
          fontWeight: 800,
          boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        }}
      >
        <span
          className="tv-sync-dot"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#10b981",
            boxShadow: "0 0 8px #10b981",
          }}
        />
        Sincronizado
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* BOTÓN ESTUDIAR — REDISEÑO ÉPICO                        */}
      {/* ═══════════════════════════════════════════════════════ */}
      {openFree === false && openAdaptive === false && openManual === false &&
        showEnfoque === false &&
        showSeleccion === false &&
        selectedIds.length > 0 &&
        expanded.includes("material") &&
        (() => {
          // ── Detectar sesión existente para estos materiales (v3 limpio) ──
          const selectedMatIds = selectedDocs
            .map((d: any) => getMaterialKey(d))
            .filter(Boolean)
            .sort();
          const currentSource = buildSourceSelectionSnapshot(
            selectedMatIds,
            mapPageSelectionsToMaterials(selectedDocs, seleccionResult),
          );
          const hasCurrentPageSelection = Array.isArray(seleccionResult) && seleccionResult.length > 0;
          const requestedMode = chosenModeRef.current || null;

          const matchingSession = selectSessionForSource(activeSessions, {
            materialIds: selectedMatIds,
            processMode: requestedMode,
            sourceSelectionFingerprint: hasCurrentPageSelection ? currentSource.fingerprint : null,
          });

          const isResumeMode = !!matchingSession;
          const resumeMode = (matchingSession?.processMode || 'free') as 'free' | 'adaptive' | 'manual';
          return (
            <div
              style={{
                position: "fixed",
                bottom: 10,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 1000,
                animation: "studyBtnIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              {/* Texto guía arriba */}
              <div
                style={{
                  fontFamily: HAND,
                  fontSize: 15,
                  color: isResumeMode ? "#f5c842" : "var(--red)",
                  fontStyle: "italic",
                  opacity: 0.85,
                  textShadow: isResumeMode
                    ? "0 0 8px #f5c842"
                    : "0 0 8px var(--red)",
                  letterSpacing: 0.5,
                }}
              >
                {isResumeMode
                  ? "↓ continuar donde lo dejaste ↓"
                  : "↓ dale al play ↓"}
              </div>

              {/* Row: Eliminar + Estudiar */}
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {/* BOTÓN ELIMINAR */}
                <button
                  onClick={() => setDeleteConfirmOpen(true)}
                  title={
                    selectedIds.length === 1
                      ? "Eliminar material"
                      : `Eliminar ${selectedIds.length} materiales`
                  }
                  style={{
                    position: "relative",
                    background:
                      "linear-gradient(135deg, rgba(20,20,25,0.95), rgba(40,15,15,0.95))",
                    color: "#fff",
                    border: "2px solid rgba(255,68,68,0.6)",
                    padding: "14px 18px",
                    borderRadius: 16,
                    fontFamily: HAND,
                    fontSize: 22,
                    fontWeight: 800,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    boxShadow:
                      "0 0 0 1px rgba(255,68,68,0.2), 0 0 16px rgba(255,68,68,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
                    transition: "all 0.3s cubic-bezier(.2,.8,.2,1)",
                    whiteSpace: "nowrap",
                    backdropFilter: "blur(8px)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 1px rgba(255,68,68,0.5), 0 0 24px rgba(255,68,68,0.6), inset 0 1px 0 rgba(255,255,255,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 1px rgba(255,68,68,0.2), 0 0 16px rgba(255,68,68,0.35), inset 0 1px 0 rgba(255,255,255,0.08)";
                  }}
                >
                  <span style={{ fontSize: 22 }}>🗑️</span>
                  <span
                    style={{
                      color: "#ff8888",
                      textShadow: "0 0 8px rgba(255,68,68,0.5)",
                    }}
                  >
                    eliminar
                  </span>
                </button>

                {/* BOTÓN ESTUDIAR / SEGUIR */}
                <button
                  onClick={async () => {
                    if (!isResumeMode && sessionsRestoring) return;
                    if (isResumeMode && matchingSession) {
                      // ── Reanudar sesión existente ──
                      setResumeSessionId(matchingSession.id);
                      setStudyMode(resumeMode as any);
                      chosenModeRef.current = resumeMode as any;

                      // Restaurar páginas seleccionadas si las tiene
                      if (matchingSession.selectedPages) {
                        const rebuilt = matchingSession.materialIds.map(
                          (matId: string, idx: number) => ({
                            materialId: matId,
                            materialIndex: idx,
                            pages: matchingSession.selectedPages![matId] || [],
                          }),
                        );
                        setSeleccionResult(rebuilt as any);
                      }

                      console.log("✅ Reanudando sesión:", matchingSession.id, "| mode:", resumeMode);
                      if (resumeMode === 'adaptive') {
                        const syncedSessions = await syncSessionsFromServer(tema?.id || "");
                        setActiveSessions(syncedSessions);
                        const target = resolveAdaptiveResumeTarget({
                          sessions: syncedSessions,
                          temaId: tema?.id || "",
                          sessionId: matchingSession.id,
                          materialId: matchingSession.primaryMaterialId || matchingSession.materialIds?.[0],
                        });
                        if (target.state === "existing" && target.view === "session") {
                          window.location.href = target.route;
                          return;
                        }
                        setOpenAdaptive(true);
                      } else if (resumeMode === 'manual') {
                        setOpenManual(true);
                      } else {
                        setOpenFree(true);
                      }
                    } else {
                      // ── Nueva sesión: elegir modo ──
                      setResumeSessionId(null);
                      setStudyMode('free');
                      setShowModeSelector(true);
                    }
                  }}
                  className="study-btn-neon"
                  disabled={!isResumeMode && sessionsRestoring}
                  style={{
                    position: "relative",
                    background: isResumeMode
                      ? "linear-gradient(135deg, rgba(25,20,15,0.95), rgba(45,35,10,0.95))"
                      : "linear-gradient(135deg, rgba(20,20,25,0.95), rgba(40,15,20,0.95))",
                    color: "#fff",
                    border: isResumeMode
                      ? "2px solid #f5c842"
                      : "2px solid var(--red)",
                    padding: "12px 24px",
                    borderRadius: 15,
                    fontFamily: HAND,
                    fontSize: 24,
                    fontWeight: 800,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    boxShadow: isResumeMode
                      ? "0 0 0 1px rgba(245,200,66,0.35), 0 0 20px rgba(245,200,66,0.5), 0 0 40px rgba(245,200,66,0.25), inset 0 1px 0 rgba(255,255,255,0.1)"
                      : "0 0 0 1px rgba(239,68,68,0.3), 0 0 20px rgba(239,68,68,0.5), 0 0 40px rgba(239,68,68,0.25), inset 0 1px 0 rgba(255,255,255,0.1)",
                    transition: "all 0.3s cubic-bezier(.2,.8,.2,1)",
                    whiteSpace: "nowrap",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 22,
                      filter: "drop-shadow(0 0 6px rgba(245,200,66,0.7))",
                      animation: "sparkle 2s ease-in-out infinite",
                      display: "inline-block",
                    }}
                  >
                    {isResumeMode ? "📖" : "✨"}
                  </span>

                  <span
                    style={{
                      letterSpacing: 0.3,
                      textShadow: isResumeMode
                        ? "0 0 10px rgba(245,200,66,0.6), 0 1px 2px rgba(0,0,0,0.5)"
                        : "0 0 10px rgba(239,68,68,0.6), 0 1px 2px rgba(0,0,0,0.5)",
                      background: isResumeMode
                        ? "linear-gradient(135deg, #fff, #fff5d0)"
                        : "linear-gradient(135deg, #fff, #ffd6d6)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    {isResumeMode ? "seguir estudiando" : "empezar a estudiar"}
                  </span>

                  <span
                    style={{
                      background: "rgba(239,68,68,0.15)",
                      color: "var(--red)",
                      padding: "4px 12px",
                      borderRadius: 20,
                      fontSize: 18,
                      fontWeight: 800,
                      fontFamily: HAND,
                      border: "1.5px solid var(--red)",
                      boxShadow:
                        "0 0 12px rgba(239,68,68,0.4), inset 0 0 8px rgba(239,68,68,0.2)",
                      minWidth: 42,
                      textAlign: "center",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      textShadow: "0 0 6px rgba(239,68,68,0.8)",
                    }}
                  >
                    {isResumeMode
                      ? (resumeMode === 'free' ? '🔓 libre' : resumeMode === 'adaptive' ? '🤖 adapt.' : '🎯 manual')
                      : `${selectedIds.length}/5`}
                  </span>

                  <span
                    style={{
                      fontSize: 22,
                      color: "var(--red)",
                      filter: "drop-shadow(0 0 6px var(--red))",
                      animation: "arrowSlide 1.5s ease-in-out infinite",
                      display: "inline-block",
                    }}
                  >
                    →
                  </span>
                </button>
              </div>
            </div>
          );
        })()}

      {/* ZOOM CONTROLS */}
      <div
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 200,
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "#0d0d10",
          border: "1px solid rgba(255,255,255,0.2)",
          padding: 4,
          borderRadius: 10,
          boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
        }}
      >
        <button
          onClick={() => setZoom((z) => Math.max(z * 0.85, 0.5))}
          style={zoomBtn}
          title="Zoom out"
        >
          −
        </button>
        <div
          style={{
            minWidth: 44,
            textAlign: "center",
            fontSize: 14,
            color: "#fff",
            fontWeight: 600,
            fontFamily: BODY,
          }}
        >
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={() => setZoom((z) => Math.min(z * 1.18, 1.4))}
          style={zoomBtn}
          title="Zoom in"
        >
          +
        </button>
        <div
          style={{
            width: 1,
            height: 20,
            background: "rgba(255,255,255,0.15)",
            margin: "0 2px",
          }}
        />
        <button onClick={fitToView} style={zoomBtn} title="Ajustar a pantalla">
          ⊡
        </button>
      </div>

      {/* ZOOM LABEL */}
      <div
        style={{
          position: "fixed",
          bottom: 16,
          left: 16,
          zIndex: 200,
          background: "#0d0d10",
          border: "1px solid rgba(255,255,255,0.15)",
          padding: "6px 14px",
          borderRadius: 10,
          fontSize: 14,
          fontFamily: BODY,
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        🔍 {Math.round(zoom * 100)}%
      </div>

      {/* ÁREA INTERACTIVA */}
      <div
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest(".node")) return;
          if ((e.target as HTMLElement).closest("button")) return;
          dragState.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            startPan: { ...pan },
          };
          document.body.style.cursor = "grabbing";
        }}
        onWheel={(e) => {
          e.preventDefault();
          const delta = e.deltaY > 0 ? 0.92 : 1.08;
          setZoom((z) => Math.min(Math.max(z * delta, 0.5), 1.4));
        }}
        style={{
          position: "absolute",
          inset: 0,
          cursor: "grab",
          zIndex: 2,
        }}
      >
        <svg
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <g
            transform={`translate(${transform.offsetX}, ${transform.offsetY}) scale(${transform.scale})`}
          >
            {curves.map((c, i) => (
              <path
                key={i}
                d={c.pathD}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={1.6}
                strokeDasharray="3 5"
                fill="none"
              />
            ))}
          </g>
        </svg>

        <div
          className="tv-canvas-mount"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            pointerEvents: "none",
            animation: "tvFadeIn 0.45s ease-out",
          }}
        >
          {nodes.map((n: any) => {
            const isH = hoveredNode === n.id;
            const isRoot = n.type === "root";
            const isHub = n.type === "hub";
            const isExpanded = expanded.includes(n.id);
            const pal = paperPalette(n.id, n.type);
            const variant = pal.variant;
            const rotBase = paperRot(n.id);
            const rot = n.selected ? 0 : isH ? rotBase * 0.18 : rotBase * 0.45;
            const scale = isH ? 1.07 : 1;
            const lift = isH || n.selected ? -3 : 0;

            // Dimensiones por variante (rompemos uniformidad)
            let cardW = n.size,
              cardH = isRoot || isHub ? n.size + 20 : n.size;
            let borderRad = 6;
            if (variant === "libreta-abierta") {
              cardW = n.size * 1.75;
              cardH = n.size * 1.05;
              borderRad = 8;
            } else if (variant === "tag-grande") {
              cardW = n.size * 1.6;
              cardH = n.size * 0.9;
              borderRad = 8;
            } else if (variant === "cuaderno-libro") {
              cardW = n.size * 0.92;
              cardH = n.size * 1.1;
              borderRad = 4;
            } else if (variant === "carpeta-folder") {
              cardW = n.size * 1.1;
              cardH = n.size * 0.95;
              borderRad = 4;
            } else if (variant === "ticket-rojo") {
              cardW = n.size * 1.15;
              cardH = n.size * 0.7;
              borderRad = 2;
            } else if (variant === "sticker-clip") {
              cardW = n.size;
              cardH = n.size;
              borderRad = 50;
            } else if (variant === "postit-arrugado") {
              cardW = n.size;
              cardH = n.size * 0.95;
              borderRad = 3;
            } else if (variant === "hoja-papel") {
              cardW = n.size * 0.95;
              cardH = n.size * 1.15;
              borderRad = 6;
            }

            const emojiSize = isRoot ? 40 : isHub ? 36 : 28;
            const labelSize = isRoot ? 24 : isHub ? 21 : 16;

            // Sombra común: si tiene sesión usa el color visual de la sesión, no dorado fijo
            const sessionGlowColor = n.hasSession ? n.color || themeColor : "";
            const sessionGlow = n.hasSession
              ? `0 0 0 2.5px ${sessionGlowColor}, 0 0 24px color-mix(in srgb, ${sessionGlowColor} 55%, transparent), 0 0 48px color-mix(in srgb, ${sessionGlowColor} 25%, transparent),`
              : "";
            const baseShadow = n.selected
              ? `${sessionGlow} 0 0 0 3px ${n.color || pal.ink}, 0 14px 32px color-mix(in srgb, ${n.color || pal.shadow} 45%, transparent), 0 6px 12px rgba(0,0,0,0.5)`
              : isH
                ? `${sessionGlow} 0 18px 38px rgba(0,0,0,0.55), 0 8px 16px color-mix(in srgb, ${n.color || pal.shadow} 35%, transparent)`
                : `${sessionGlow} 0 8px 20px rgba(0,0,0,0.5), 0 3px 6px rgba(0,0,0,0.3)`;

            return (
              <div
                key={n.id}
                className={`node paper-card variant-${variant}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleNodeClick(n);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                  if (n.type === "apunte" || n.type === "doc") {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ node: n, x: e.clientX, y: e.clientY });
                  }
                }}
                onMouseEnter={() => setHoveredNode(n.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{
                  position: "absolute",
                  left: n.x,
                  top: n.y,
                  width: cardW,
                  minHeight: cardH,
                  transform: `translate(-50%, calc(-50% + ${lift}px)) scale(${scale}) rotate(${rot}deg)`,
                  background:
                    variant === "libreta-abierta"
                      ? `linear-gradient(90deg, color-mix(in srgb, ${pal.paper} 92%, #000) 0%, ${pal.paper} 3%, ${pal.paper} 48%, color-mix(in srgb, ${pal.ink} 18%, transparent) 49.5%, color-mix(in srgb, ${pal.ink} 28%, transparent) 50%, color-mix(in srgb, ${pal.ink} 18%, transparent) 50.5%, ${pal.paper} 52%, ${pal.paper} 97%, color-mix(in srgb, ${pal.paper} 92%, #000) 100%)`
                      : variant === "sticker-clip"
                        ? `radial-gradient(circle at 30% 30%, color-mix(in srgb, ${pal.paper} 100%, #fff 8%) 0%, ${pal.paper} 50%, color-mix(in srgb, ${pal.paper} 85%, #000) 100%)`
                        : variant === "cuaderno-libro"
                          ? `linear-gradient(90deg, color-mix(in srgb, ${pal.paper} 70%, #000) 0%, color-mix(in srgb, ${pal.paper} 70%, #000) 16%, ${pal.paper} 16%, ${pal.paper} 100%)`
                          : variant === "carpeta-folder"
                            ? `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 92%, #000) 100%)`
                            : variant === "ticket-rojo"
                              ? `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 88%, #000) 100%)`
                              : variant === "hoja-papel"
                                ? `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 96%, #000) 100%)`
                                : variant === "postit-arrugado"
                                  ? `linear-gradient(135deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 92%, #fff) 50%, color-mix(in srgb, ${pal.paper} 90%, #000) 100%)`
                                  : variant === "tag-grande"
                                    ? `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 90%, #000) 100%)`
                                    : pal.paper,
                  border: n.hasSession
                    ? `2px solid ${n.color || themeColor}`
                    : variant === "sticker-clip"
                      ? `2px solid color-mix(in srgb, ${pal.ink} 25%, transparent)`
                      : `1px solid color-mix(in srgb, ${pal.ink} 30%, transparent)`,
                  borderRadius: borderRad,
                  padding:
                    variant === "cuaderno-libro"
                      ? "12px 10px 12px 22px"
                      : variant === "hoja-papel"
                        ? "12px 14px"
                        : "14px 10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  cursor: n.disabled ? "not-allowed" : "pointer",
                  opacity: n.disabled ? 0.55 : 1,
                  boxShadow: baseShadow,
                  transition:
                    "transform 0.38s cubic-bezier(0.22,1,0.36,1), box-shadow 0.25s, border-color 0.25s",
                  zIndex: n.selected ? 30 : isH ? 20 : 10,
                  overflow: "visible",
                  pointerEvents: "auto",
                }}
              >
                {/* ════════ ELEMENTOS POR VARIANTE ════════ */}

                {/* LIBRETA-ABIERTA (root): dos páginas con líneas, lomo fino, marcador */}
                {variant === "libreta-abierta" && (
                  <>
                    {/* Líneas horizontales SUTILES solo en zonas laterales (no cruzan el lomo) */}
                    <div
                      style={{
                        position: "absolute",
                        top: 38,
                        bottom: 28,
                        left: "7%",
                        width: "38%",
                        backgroundImage: `repeating-linear-gradient(180deg, transparent 0 13px, color-mix(in srgb, ${pal.ink} 11%, transparent) 13px 14px)`,
                        pointerEvents: "none",
                        zIndex: 1,
                        opacity: 0.6,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 38,
                        bottom: 28,
                        right: "7%",
                        width: "38%",
                        backgroundImage: `repeating-linear-gradient(180deg, transparent 0 13px, color-mix(in srgb, ${pal.ink} 11%, transparent) 13px 14px)`,
                        pointerEvents: "none",
                        zIndex: 1,
                        opacity: 0.6,
                      }}
                    />

                    {/* Estrellitas decorativas en las dos esquinas superiores */}
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 12,
                        fontSize: 13,
                        color: pal.ink,
                        opacity: 0.4,
                        pointerEvents: "none",
                        zIndex: 2,
                        transform: "rotate(-15deg)",
                        fontFamily: HAND,
                      }}
                    >
                      ✦
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 12,
                        fontSize: 13,
                        color: pal.ink,
                        opacity: 0.4,
                        pointerEvents: "none",
                        zIndex: 2,
                        transform: "rotate(15deg)",
                        fontFamily: HAND,
                      }}
                    >
                      ✦
                    </div>

                    {/* Marcador de lectura — pequeña cinta de tela que cuelga del lomo */}
                    <div
                      style={{
                        position: "absolute",
                        top: -2,
                        left: "50%",
                        width: 8,
                        height: 22,
                        transform: "translateX(-50%)",
                        background:
                          "linear-gradient(180deg, #c2410c 0%, #9a3412 100%)",
                        borderRadius: "0 0 2px 2px",
                        boxShadow:
                          "0 2px 3px rgba(0,0,0,0.35), inset -1px 0 0 rgba(0,0,0,0.2)",
                        pointerEvents: "none",
                        zIndex: 3,
                      }}
                    />
                    {/* Punta del marcador */}
                    <div
                      style={{
                        position: "absolute",
                        top: 18,
                        left: "50%",
                        width: 0,
                        height: 0,
                        transform: "translateX(-50%)",
                        borderLeft: "4px solid transparent",
                        borderRight: "4px solid transparent",
                        borderTop: "5px solid #9a3412",
                        pointerEvents: "none",
                        zIndex: 3,
                      }}
                    />

                    {/* Etiqueta "tema" arriba como sello */}
                    <div
                      style={{
                        position: "absolute",
                        top: -11,
                        left: 18,
                        transform: "rotate(-4deg)",
                        background: "#fef9c3",
                        color: pal.ink,
                        fontSize: 10,
                        fontWeight: 800,
                        fontFamily: HAND,
                        padding: "2px 9px",
                        border: `1.2px solid color-mix(in srgb, ${pal.ink} 30%, transparent)`,
                        borderRadius: 2,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.25)",
                        pointerEvents: "none",
                        zIndex: 4,
                        fontStyle: "italic",
                      }}
                    >
                      ~ tema ~
                    </div>
                  </>
                )}

                {/* TAG-GRANDE (root): doble cinta arriba + agujero izquierda tipo etiqueta */}
                {/* TAG-GRANDE (root): doble cinta arriba + agujero izquierda tipo etiqueta */}
                {variant === "tag-grande" && (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        top: -10,
                        left: "25%",
                        width: 50,
                        height: 16,
                        transform: `translateX(-50%) rotate(-6deg)`,
                        background:
                          "linear-gradient(180deg, rgba(245,245,240,0.7) 0%, rgba(220,220,210,0.55) 100%)",
                        border: "1px solid rgba(0,0,0,0.12)",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.25)",
                        pointerEvents: "none",
                        zIndex: 3,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: -10,
                        left: "75%",
                        width: 50,
                        height: 16,
                        transform: `translateX(-50%) rotate(5deg)`,
                        background:
                          "linear-gradient(180deg, rgba(245,245,240,0.7) 0%, rgba(220,220,210,0.55) 100%)",
                        border: "1px solid rgba(0,0,0,0.12)",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.25)",
                        pointerEvents: "none",
                        zIndex: 3,
                      }}
                    />
                    {/* Agujero refuerzo izquierda */}
                    <div
                      style={{
                        position: "absolute",
                        left: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: "rgba(0,0,0,0.15)",
                        border: `1.5px solid color-mix(in srgb, ${pal.ink} 35%, transparent)`,
                        pointerEvents: "none",
                        zIndex: 2,
                      }}
                    />
                  </>
                )}

                {/* CUADERNO-LIBRO: espiral metálica izquierda */}
                {variant === "cuaderno-libro" && (
                  <div
                    style={{
                      position: "absolute",
                      left: 6,
                      top: 8,
                      bottom: 8,
                      width: 4,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-around",
                      alignItems: "center",
                      pointerEvents: "none",
                      zIndex: 3,
                    }}
                  >
                    {[0, 1, 2, 3, 4, 5].map((k) => (
                      <div
                        key={k}
                        style={{
                          width: 8,
                          height: 4,
                          background:
                            "linear-gradient(180deg, #d4d4d8, #71717a)",
                          borderRadius: 2,
                          boxShadow:
                            "0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.4)",
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* CARPETA-FOLDER: pestaña tab arriba-izquierda */}
                {variant === "carpeta-folder" && (
                  <div
                    style={{
                      position: "absolute",
                      top: -12,
                      left: 8,
                      width: cardW * 0.35,
                      height: 14,
                      background: `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 90%, #000) 100%)`,
                      border: `1px solid color-mix(in srgb, ${pal.ink} 30%, transparent)`,
                      borderBottom: "none",
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 8,
                      pointerEvents: "none",
                      zIndex: 1,
                    }}
                  />
                )}

                {/* TICKET-ROJO: bordes dentados + línea perforada */}
                {variant === "ticket-rojo" && (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        left: -5,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "#000",
                        pointerEvents: "none",
                        zIndex: 2,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        right: -5,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "#000",
                        pointerEvents: "none",
                        zIndex: 2,
                      }}
                    />
                  </>
                )}

                {/* STICKER-CLIP: clip metálico arriba */}
                {variant === "sticker-clip" && (
                  <div
                    style={{
                      position: "absolute",
                      top: -16,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 22,
                      height: 32,
                      pointerEvents: "none",
                      zIndex: 3,
                    }}
                  >
                    <svg width="22" height="32" viewBox="0 0 22 32">
                      <path
                        d="M 6 4 Q 6 0 11 0 Q 16 0 16 4 L 16 22 Q 16 28 11 28 Q 6 28 6 22 L 6 8"
                        stroke="#9ca3af"
                        strokeWidth="2.5"
                        fill="none"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 6 4 Q 6 0 11 0 Q 16 0 16 4 L 16 22 Q 16 28 11 28 Q 6 28 6 22 L 6 8"
                        stroke="#e5e7eb"
                        strokeWidth="1"
                        fill="none"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                )}

                {/* POSTIT-ARRUGADO: cinta + textura de arruga */}
                {variant === "postit-arrugado" && (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        top: -8,
                        left: "50%",
                        width: cardW * 0.45,
                        height: 14,
                        transform: `translateX(-50%) rotate(${rotBase * 2}deg)`,
                        background:
                          "linear-gradient(180deg, rgba(245,245,240,0.6) 0%, rgba(220,220,210,0.5) 100%)",
                        border: "1px solid rgba(0,0,0,0.1)",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                        pointerEvents: "none",
                        zIndex: 3,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background:
                          "repeating-linear-gradient(45deg, transparent 0 8px, rgba(0,0,0,0.03) 8px 9px)",
                        borderRadius: borderRad,
                        pointerEvents: "none",
                        zIndex: 1,
                      }}
                    />
                  </>
                )}

                {/* HOJA-PAPEL: líneas de cuaderno horizontales + margen rojo izq */}
                {variant === "hoja-papel" && (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        backgroundImage:
                          "repeating-linear-gradient(180deg, transparent 0 14px, rgba(56,189,248,0.18) 14px 15px)",
                        borderRadius: borderRad,
                        pointerEvents: "none",
                        zIndex: 1,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        bottom: 6,
                        left: 10,
                        width: 1.5,
                        background: "rgba(239,68,68,0.5)",
                        pointerEvents: "none",
                        zIndex: 1,
                      }}
                    />
                  </>
                )}

                {/* PAPELITO-SIMPLE: cinta básica */}
                {variant === "papelito-simple" && (
                  <div
                    style={{
                      position: "absolute",
                      top: -8,
                      left: "50%",
                      width: cardW * 0.4,
                      height: 13,
                      transform: `translateX(-50%) rotate(${rotBase * 2}deg)`,
                      background:
                        "linear-gradient(180deg, rgba(245,245,240,0.6) 0%, rgba(220,220,210,0.5) 100%)",
                      border: "1px solid rgba(0,0,0,0.1)",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      pointerEvents: "none",
                      zIndex: 3,
                    }}
                  />
                )}

                {/* ESQUINA DOBLADA (no en sticker ni ticket ni cuaderno-libro) */}
                {variant !== "sticker-clip" &&
                  variant !== "ticket-rojo" &&
                  variant !== "cuaderno-libro" && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        right: 0,
                        width: 16,
                        height: 16,
                        background: `linear-gradient(135deg, transparent 50%, color-mix(in srgb, ${pal.ink} 22%, transparent) 50%)`,
                        borderBottomRightRadius: borderRad,
                        pointerEvents: "none",
                        zIndex: 2,
                      }}
                    />
                  )}

                {/* ════════ CONTENIDO COMÚN ════════ */}

                {/* LIBRETA-ABIERTA: layout especial 2 columnas (emoji izq, texto der) */}
                {variant === "libreta-abierta" ? (
                  <div
                    style={{
                      position: "relative",
                      zIndex: 2,
                      width: "100%",
                      height: "100%",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      alignItems: "center",
                      pointerEvents: "none",
                    }}
                  >
                    {/* Página izquierda: emoji grande */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        paddingRight: 8,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 52,
                          filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.3))",
                          lineHeight: 1,
                        }}
                      >
                        {n.emoji}
                      </div>
                    </div>
                    {/* Página derecha: nombre + sublabel + subrayado */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        paddingLeft: 8,
                        paddingRight: 6,
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: HAND,
                          fontSize: 26,
                          fontWeight: 800,
                          color: pal.ink,
                          lineHeight: 1.05,
                          letterSpacing: 0.3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          maxWidth: "100%",
                          textShadow: "0 1px 0 rgba(255,255,255,0.4)",
                        }}
                      >
                        {n.label}
                      </div>
                      {n.sublabel && (
                        <div
                          style={{
                            fontFamily: HAND,
                            fontSize: 13,
                            color: pal.inkSoft,
                            marginTop: 3,
                            fontStyle: "italic",
                            fontWeight: 600,
                            opacity: 0.85,
                          }}
                        >
                          {n.sublabel}
                        </div>
                      )}
                      <svg
                        width="60"
                        height="5"
                        style={{ marginTop: 4, opacity: 0.55 }}
                      >
                        <path
                          d="M3 3 Q 30 0 57 3.5"
                          stroke={pal.ink}
                          strokeWidth="1.8"
                          fill="none"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* EMOJI */}
                    <div
                      style={{
                        fontSize: emojiSize,
                        marginBottom: 4,
                        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))",
                        pointerEvents: "none",
                        position: "relative",
                        zIndex: 2,
                        lineHeight: 1,
                      }}
                    >
                      {n.emoji}
                    </div>

                    {/* LABEL */}
                    <div
                      style={{
                        fontFamily: HAND,
                        fontSize: labelSize,
                        fontWeight: 800,
                        color: pal.ink,
                        lineHeight: 1.05,
                        padding: "0 4px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        maxWidth: "100%",
                        letterSpacing: 0.2,
                        textShadow: "0 1px 0 rgba(255,255,255,0.35)",
                        pointerEvents: "none",
                        position: "relative",
                        zIndex: 2,
                      }}
                    >
                      {n.label}
                    </div>

                    {/* SUBLABEL */}
                    {n.sublabel && (
                      <div
                        style={{
                          fontFamily: HAND,
                          fontSize: 12,
                          color: pal.inkSoft,
                          marginTop: 2,
                          fontStyle: "italic",
                          fontWeight: 600,
                          opacity: 0.9,
                          pointerEvents: "none",
                          position: "relative",
                          zIndex: 2,
                        }}
                      >
                        {n.sublabel}
                      </div>
                    )}

                    {/* Subrayado handwritten en hubs/root */}
                    {(isRoot || isHub) && (
                      <svg
                        width={Math.min(70, cardW * 0.5)}
                        height="5"
                        style={{
                          marginTop: 4,
                          opacity: 0.6,
                          pointerEvents: "none",
                          position: "relative",
                          zIndex: 2,
                        }}
                      >
                        <path
                          d={`M3 3 Q ${Math.min(70, cardW * 0.5) / 2} 0 ${Math.min(70, cardW * 0.5) - 3} 3.5`}
                          stroke={pal.ink}
                          strokeWidth="1.8"
                          fill="none"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </>
                )}

                {/* CHECK seleccionado — sello rojo */}
                {n.selected && (
                  <div
                    style={{
                      position: "absolute",
                      top: -8,
                      right: -8,
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                      border: "2.5px solid #fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 15,
                      fontWeight: 900,
                      color: "#fff",
                      boxShadow:
                        "0 4px 10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.3)",
                      pointerEvents: "none",
                      zIndex: 5,
                      transform: "rotate(8deg)",
                    }}
                  >
                    ✓
                  </div>
                )}

                {/* Etiqueta "pronto" para disabled */}
                {n.disabled && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: -12,
                      left: "50%",
                      transform: "translateX(-50%) rotate(-2deg)",
                      background: "rgba(60,60,60,0.88)",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: HAND,
                      padding: "2px 10px",
                      borderRadius: 10,
                      fontStyle: "italic",
                      pointerEvents: "none",
                      zIndex: 5,
                      boxShadow: "0 2px 5px rgba(0,0,0,0.4)",
                    }}
                  >
                    pronto
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {contextMenu && (
        <div
          onClick={() => setContextMenu(null)}
          style={{ position: "fixed", inset: 0, zIndex: 9000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: contextMenu.x,
              top: contextMenu.y,
              background: "#1a1a1e",
              border: "1px solid #333",
              borderRadius: 14,
              padding: 6,
              minWidth: 160,
              boxShadow: "0 10px 40px rgba(0,0,0,0.8)",
            }}
          >
            <button
              onClick={() => {
                contextMenu.node.type === "apunte"
                  ? onEliminarApunte(contextMenu.node.data.id)
                  : onEliminarDocumento(contextMenu.node.data.id);
                setContextMenu(null);
              }}
              style={{ ...ctxBtn, color: "#ff4444" }}
            >
              🗑️ Eliminar
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* MODAL ELIMINAR MATERIALES                       */}
      {/* ═══════════════════════════════════════════════ */}
      {deleteConfirmOpen && (
        <div
          onClick={() => !deleting && setDeleteConfirmOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "rgba(0,0,0,0.78)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "linear-gradient(135deg, #1a1010, #2a1515)",
              border: "2px solid rgba(255,68,68,0.5)",
              borderRadius: 20,
              padding: 32,
              maxWidth: 460,
              width: "90%",
              boxShadow:
                "0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(255,68,68,0.3)",
              animation: "studyBtnIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            <div
              style={{
                fontSize: 48,
                textAlign: "center",
                marginBottom: 16,
                filter: "drop-shadow(0 0 12px rgba(255,68,68,0.6))",
              }}
            >
              🗑️
            </div>

            <div
              style={{
                fontFamily: HAND,
                fontSize: 28,
                fontWeight: 800,
                color: "#ff8888",
                textAlign: "center",
                marginBottom: 8,
                textShadow: "0 0 10px rgba(255,68,68,0.4)",
              }}
            >
              {selectedIds.length === 1
                ? "¿Eliminar este material?"
                : `¿Eliminar ${selectedIds.length} materiales?`}
            </div>

            <div
              style={{
                fontFamily: "Inter, sans-serif",
                fontSize: 14,
                color: "rgba(255,255,255,0.7)",
                textAlign: "center",
                marginBottom: 20,
                lineHeight: 1.5,
              }}
            >
              Esta acción no se puede deshacer. Los archivos se borrarán
              permanentemente junto con sus sesiones de estudio.
            </div>

            {/* Lista de materiales a borrar */}
            <div
              style={{
                maxHeight: 160,
                overflow: "auto",
                background: "rgba(0,0,0,0.3)",
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 20,
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {selectedDocs.map((d: any) => (
                <div
                  key={d.id}
                  style={{
                    fontFamily: "Inter, sans-serif",
                    fontSize: 13,
                    color: "rgba(255,255,255,0.85)",
                    padding: "4px 0",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>📄</span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.nombre}
                  </span>
                </div>
              ))}
            </div>

            {deleting && (
              <div
                style={{
                  marginBottom: 16,
                  padding: "10px 14px",
                  background: "rgba(255,68,68,0.08)",
                  borderRadius: 10,
                  border: "1px solid rgba(255,68,68,0.25)",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 13,
                  color: "#ffaaaa",
                  textAlign: "center",
                }}
              >
                Eliminando {deleteProgress.done} de {deleteProgress.total}...
                <div
                  style={{
                    marginTop: 6,
                    height: 4,
                    background: "rgba(0,0,0,0.4)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(deleteProgress.done / Math.max(1, deleteProgress.total)) * 100}%`,
                      background: "linear-gradient(90deg, #ff4444, #ff8888)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
                style={{
                  flex: 1,
                  padding: "12px 20px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.06)",
                  border: "1.5px solid rgba(255,255,255,0.15)",
                  color: "#fff",
                  fontFamily: HAND,
                  fontSize: 18,
                  fontWeight: 700,
                  cursor: deleting ? "not-allowed" : "pointer",
                  opacity: deleting ? 0.5 : 1,
                  transition: "all 0.2s",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (deleting) return; // guard anti doble-click
                  const idsToDelete = [...selectedIds]; // snapshot inmutable
                  setDeleting(true);
                  setDeleteProgress({ done: 0, total: idsToDelete.length });

                  // Cerrar modal ANTES de borrar para evitar re-clicks
                  setDeleteConfirmOpen(false);

                  let borrados = 0;
                  for (const id of idsToDelete) {
                    try {
                      const result = onEliminarDocumento?.(id);
                      // Esperar si es Promise
                      if (
                        result &&
                        typeof (result as any).then === "function"
                      ) {
                        await result;
                      }
                      borrados++;
                    } catch (e) {
                      console.warn("Error eliminando", id, e);
                    }
                    setDeleteProgress({
                      done: borrados,
                      total: idsToDelete.length,
                    });
                    // Pequeña pausa para que el servidor procese
                    await new Promise((r) => setTimeout(r, 300));
                  }

                  setSelectedIds([]);
                  setDeleting(false);
                  setDeleteProgress({ done: 0, total: 0 });
                  refreshSessions();
                }}
                disabled={deleting}
                style={{
                  flex: 1,
                  padding: "12px 20px",
                  borderRadius: 12,
                  background: "linear-gradient(135deg, #ff4444, #cc2222)",
                  border: "1.5px solid #ff4444",
                  color: "#fff",
                  fontFamily: HAND,
                  fontSize: 18,
                  fontWeight: 800,
                  cursor: deleting ? "not-allowed" : "pointer",
                  opacity: deleting ? 0.7 : 1,
                  boxShadow: "0 4px 16px rgba(255,68,68,0.4)",
                  transition: "all 0.2s",
                }}
              >
                {deleting ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}



      {showModeSelector && (
        <div
          onClick={() => setShowModeSelector(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(18px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Caveat', cursive",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 24,
            }}
          >
            {/* Líneas de cuaderno */}
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              backgroundImage: 'linear-gradient(to bottom, transparent 47px, rgba(255,255,255,0.03) 47px, rgba(255,255,255,0.03) 48px, transparent 48px)',
              backgroundSize: '100% 48px',
            }} />

            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                ~ {selectedIds.length} {selectedIds.length === 1 ? 'material seleccionado' : 'materiales seleccionados'} ~
              </div>
              <h2 style={{
                fontSize: 48, fontWeight: 900, color: '#fff', margin: 0,
                textShadow: '0 4px 30px rgba(255,255,255,0.15)',
              }}>
                ¿cómo querés estudiar?
              </h2>
              <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.55)', marginTop: 6, fontStyle: 'italic' }}>
                elegí tu modo ↓
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>

              {/* ── MODO LIBRE ── */}
              {[
                {
                  id: 'free',
                  emoji: '🔓',
                  label: 'Libre',
                  sub: 'Vos elegís el orden',
                  desc: 'Accedés a todas las herramientas sin restricciones. Estudiás como quieras.',
                  color: '#4ade80',
                  locked: false,
                },
                {
                  id: 'adaptive',
                  emoji: '🤖',
                  label: 'Adaptativo',
                  sub: 'La IA te guía',
                  desc: 'El sistema analiza tu rendimiento y decide qué estudiar, cuándo y en qué orden.',
                  color: '#38bdf8',
                  locked: false,
                },
                {
                  id: 'manual',
                  emoji: '🎯',
                  label: 'Manual',
                  sub: 'Vos configurás todo',
                  desc: 'Definís el orden, las herramientas y los tiempos. Control total del proceso.',
                  color: '#a78bfa',
                  locked: false,
                },
              ].map((mode) => {
                return (
                  <button
                    key={mode.id}
                    onClick={() => {
                      if (mode.locked) return;
                      setShowModeSelector(false);
                      setStudyMode(mode.id as any);
                      chosenModeRef.current = mode.id as any;
                      setEnfoqueElegido('teorico');
                      setShowSeleccion(true);
                    }}
                    disabled={mode.locked}
                    style={{
                      position: 'relative',
                      width: 260,
                      minHeight: 320,
                      background: mode.locked
                        ? 'linear-gradient(160deg, #111114, #0a0a0c)'
                        : `linear-gradient(160deg, ${mode.color}18, ${mode.color}05)`,
                      border: `1.5px solid ${mode.locked ? '#333' : mode.color + '88'}`,
                      borderRadius: 20,
                      padding: '28px 20px',
                      cursor: mode.locked ? 'not-allowed' : 'pointer',
                      opacity: mode.locked ? 0.55 : 1,
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      textAlign: 'center',
                      fontFamily: "'Caveat', cursive",
                      transition: 'all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      boxShadow: mode.locked
                        ? 'none'
                        : `0 10px 30px ${mode.color}33`,
                    }}
                    onMouseEnter={(e) => {
                      if (mode.locked) return;
                      e.currentTarget.style.transform = 'translateY(-10px) scale(1.03)';
                      e.currentTarget.style.borderColor = mode.color;
                      e.currentTarget.style.boxShadow = `0 20px 50px ${mode.color}55, 0 0 70px ${mode.color}22`;
                    }}
                    onMouseLeave={(e) => {
                      if (mode.locked) return;
                      e.currentTarget.style.transform = 'translateY(0) scale(1)';
                      e.currentTarget.style.borderColor = mode.color + '88';
                      e.currentTarget.style.boxShadow = `0 10px 30px ${mode.color}33`;
                    }}
                  >
                    {/* Pestañita top */}
                    <div style={{
                      position: 'absolute', top: -2, left: '50%',
                      transform: 'translateX(-50%)',
                      width: 55, height: 10,
                      background: mode.locked ? '#333' : mode.color,
                      borderRadius: '0 0 6px 6px',
                      opacity: mode.locked ? 0.4 : 1,
                    }} />

                    {/* Candado */}
                    {mode.locked && (
                      <div style={{
                        position: 'absolute', top: 12, right: 12,
                        fontSize: 16, opacity: 0.6,
                      }}>🔒</div>
                    )}

                    <div style={{
                      fontSize: 60, marginTop: 12, marginBottom: 10,
                      filter: mode.locked ? 'grayscale(1)' : `drop-shadow(0 0 16px ${mode.color}99)`,
                    }}>
                      {mode.emoji}
                    </div>

                    <div style={{
                      fontSize: 34, fontWeight: 800,
                      color: mode.locked ? '#555' : mode.color,
                      marginBottom: 4, lineHeight: 1,
                    }}>
                      {mode.label}
                    </div>

                    <div style={{
                      fontSize: 15, color: 'rgba(255,255,255,0.45)',
                      fontStyle: 'italic', marginBottom: 14,
                    }}>
                      {mode.sub}
                    </div>

                    <div style={{
                      fontSize: 15, color: 'rgba(255,255,255,0.75)',
                      fontFamily: "'Inter', sans-serif",
                      lineHeight: 1.4, flex: 1,
                    }}>
                      {mode.desc}
                    </div>

                    <div style={{
                      marginTop: 18,
                      padding: '7px 18px',
                      borderRadius: 30,
                      background: mode.locked ? 'rgba(255,255,255,0.04)' : mode.color + '22',
                      color: mode.locked ? '#444' : mode.color,
                      border: `1.5px solid ${mode.locked ? '#333' : mode.color}`,
                      fontSize: 16, fontWeight: 700,
                      fontFamily: "'Inter', sans-serif",
                    }}>
                      {mode.locked ? 'próximamente' : 'empezar →'}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setShowModeSelector(false)}
              style={{
                background: 'transparent',
                border: '1.5px solid rgba(255,255,255,0.25)',
                padding: '9px 26px', borderRadius: 30,
                color: 'rgba(255,255,255,0.75)',
                fontFamily: "'Caveat', cursive",
                fontSize: 18, fontWeight: 600,
                cursor: 'pointer',
                marginTop: 4,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.borderColor = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
              }}
            >
              ← volver
            </button>
          </div>
        </div>
      )}

      {showSeleccion && (
        <SeleccionPaginas
          materiales={selectedDocs}
          enfoque={enfoqueElegido}
          temaId={tema.id}
          themeColor={themeColor}
          onCancel={() => {
            setShowSeleccion(false);
            setEnfoqueElegido(null);
          }}
          onConfirm={(resultado) => {
            setSeleccionResult(resultado);

            let savedSessionId: string | null = null;
            try {
              const matsSeleccionados = selectedDocs;
              const matIds = matsSeleccionados
                .map((m: any) => getMaterialKey(m))
                .filter(Boolean);

              const pagesByMat: Record<string, number[]> = {};
              const items = Array.isArray(resultado) ? resultado : [];

              items.forEach((item: any, idx: number) => {
                const fallbackMatId = matIds[idx];
                const emittedId = String(item?.materialId || item?.material_id || item?.documentId || item?.document_id || "");
                const matchingDocument = selectedDocs.find((document: any) =>
                  sameId(document?.id, emittedId) || sameId(getMaterialKey(document), emittedId)
                ) || selectedDocs[idx];
                const matId = matchingDocument ? getMaterialKey(matchingDocument) : fallbackMatId;

                const rawPages =
                  item?.pages ||
                  item?.selectedPages ||
                  item?.paginas ||
                  item?.paginasSeleccionadas ||
                  item?.pageNumbers ||
                  [];

                const pages = Array.isArray(rawPages)
                  ? rawPages
                      .map((n: any) => Number(n))
                      .filter((n: number) => Number.isFinite(n) && n > 0)
                  : [];

                if (matId && pages.length) {
                  pagesByMat[matId] = Array.from(new Set(pages)).sort(
                    (a, b) => a - b,
                  );
                }
              });

              if (tema?.id && matIds.length > 0) {
                // Para modo adaptativo: NO crear sesión aquí.
                // La sesión adaptativa la crea StudyALAdaptive.next() cuando termina el setup.
                // Si ya existe una sesión adaptativa que estamos reanudando, la preservamos.
                if (studyMode === 'adaptive') {
                  if (resumeSessionId || autoOpenAdaptiveSessionId) {
                    savedSessionId = resumeSessionId || autoOpenAdaptiveSessionId || null;
                    console.log("♻️ Reanudando sesión adaptativa existente:", savedSessionId);
                  } else {
                    console.log("⏭️  Modo adaptativo: sesión se creará al terminar el setup");
                  }
                } else {
                  // Free y manual: sí guardamos aquí
                  const sess = upsertSession({
                    sessionId: resumeSessionId || undefined,
                    userId: userId || undefined,
                    temaId: tema.id,
                    enfoque: (enfoqueElegido || 'teorico') as any,
                    processMode: (studyMode || 'free') as any,
                    materialIds: matIds,
                    primaryMaterialId: matIds[0],
                    materialNames: selectedDocs.map((m: any) => String(m?.nombre || m?.name || '').trim()).filter(Boolean),
                    selectedPages: Object.keys(pagesByMat).length ? pagesByMat : {},
                  });
                  savedSessionId = sess.id;
                  setResumeSessionId(sess.id);
                  refreshSessions();
                  console.log("💾 Sesión guardada:", sess.id, "| modo:", studyMode);
                }
              }
            } catch (e) {
              console.warn("Error guardando sesión al entrar al enfoque:", e);
            }

            setShowSeleccion(false);

            // Abrir el modo que el usuario eligió
            if (studyMode === 'adaptive') {
              setOpenAdaptive(true);
            } else if (studyMode === 'manual') {
              setOpenManual(true);
            } else {
              setOpenFree(true);
            }
          }}
        />
      )}

      <link
        href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shine {
          0% { left: -100%; }
          50%, 100% { left: 150%; }
        }
        
        @keyframes arrowBounce {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(6px); }
        }
        @keyframes slideUpStudy {
          from { opacity: 0; transform: translateX(-50%) translateY(40px) scale(0.8); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        .study-btn:hover {
          transform: scale(1.05) translateY(-3px);
        }
        .concept-flow-light {
          stroke-dasharray: 52 150;
          animation: conceptFlow 1.15s linear infinite;
          filter:
            drop-shadow(0 0 6px rgba(255,255,255,1))
            drop-shadow(0 0 16px rgba(255,255,255,0.75));
        }
        @keyframes conceptFlow {
          from { stroke-dashoffset: 202; }
          to { stroke-dashoffset: 0; }
        }
        html, body { overflow: hidden !important; margin: 0; padding: 0; height: 100%; }
      `}</style>
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  background: "transparent",
  border: "none",
  borderRadius: 6,
  color: "#fff",
  cursor: "pointer",
  fontSize: 16,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 0.2s",
};

const ctxBtn: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  border: "none",
  background: "transparent",
  color: "#fff",
  textAlign: "left",
  cursor: "pointer",
  fontWeight: 600,
  fontFamily: BODY,
  fontSize: 17,
  borderRadius: 8,
};
