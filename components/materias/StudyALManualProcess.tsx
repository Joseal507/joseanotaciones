"use client";

import { useEffect, useMemo, useState } from "react";
import type { SourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection";
import { MANUAL_TOOL_IDS, MANUAL_TOOL_CAPS, type DurableManualTool } from "../../lib/manualToolState";
import { RADIUS, hardShadow, accentTint } from "../../lib/ui/surface";

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Props {
  materiales: any[];
  temaId?: string;
  sessionId: string;
  sourceSelection: SourceSelectionSnapshot;
  onClose: () => void;
  onOpenLeer: () => void;
  onOpenAlai: () => void;
  onOpenFlashcards: () => void;
  onOpenQuizzes: () => void;
  onOpenResumen: () => void;
  onOpenExamen: () => void;
  progressByTool?: Partial<Record<DurableManualTool, number>>;
}

interface ToolNode {
  id: DurableManualTool;
  n: string;
  title: string;
  desc: string;
  emoji: string;
  color: string;
  badgeColor: string;
  // Posición aproximada en el layout triangular (porcentajes del contenedor)
  x: number;
  y: number;
  action: () => void;
}

export default function StudyALManualProcess({
  materiales,
  sessionId,
  sourceSelection,
  onClose,
  onOpenLeer,
  onOpenAlai,
  onOpenFlashcards,
  onOpenQuizzes,
  onOpenResumen,
  onOpenExamen,
  progressByTool,
}: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 80);
    return () => window.clearTimeout(t);
  }, []);

  const tools: ToolNode[] = useMemo(() => [
    // VÉRTICE SUPERIOR: Leer
    { id: 'leer',       n: '', title: 'Leer el material', desc: 'Lee y comprende el contenido a tu propio ritmo.', emoji: '📖', color: '#38bdf8', badgeColor: '', x: 50, y: 8,  action: onOpenLeer },
    // MEDIO IZQUIERDO (sobre el lado C→A): ALAI
    { id: 'alai',       n: '', title: 'ALAI Chat',        desc: 'Pregunta cualquier duda y obtén respuestas.',       emoji: '✨', color: '#facc15', badgeColor: '', x: 18, y: 50,  action: onOpenAlai },
    // MEDIO DERECHO (sobre el lado A→B): Flashcards
    { id: 'flashcards', n: '', title: 'Flashcards',       desc: 'Crea tus propias tarjetas de estudio.',             emoji: '🩷', color: '#f472b6', badgeColor: '', x: 82, y: 50,  action: onOpenFlashcards },
    // VÉRTICE INFERIOR-IZQUIERDO: Examen
    { id: 'examen',     n: '', title: 'Examen manual',    desc: 'Evalúate por tu cuenta cuando lo necesites.',       emoji: '🔴', color: '#f87171', badgeColor: '', x: 15, y: 90,  action: onOpenExamen },
    // MEDIO DE LA BASE: Resumen
    { id: 'resumen',    n: '', title: 'Mi resumen',       desc: 'Escribe y organiza tus ideas claves en tus propias palabras.', emoji: '🟣', color: '#a78bfa', badgeColor: '', x: 50, y: 90,  action: onOpenResumen },
    // VÉRTICE INFERIOR-DERECHO: Quizzes
    { id: 'quizzes',    n: '', title: 'Quizzes',          desc: 'Crea tus propios quizzes y pon a prueba tu conocimiento.', emoji: '🟢', color: '#4ade80', badgeColor: '', x: 85, y: 90,  action: onOpenQuizzes },
  ], [onOpenLeer, onOpenAlai, onOpenFlashcards, onOpenQuizzes, onOpenResumen, onOpenExamen]);

  // Progreso total
  const totalProgress = useMemo(() => {
    let total = 0;
    for (const tool of MANUAL_TOOL_IDS) {
      total += Math.min(MANUAL_TOOL_CAPS[tool], progressByTool?.[tool] || 0);
    }
    return Math.min(100, Math.round(total));
  }, [progressByTool]);

  const completedCount = tools.filter(t => (progressByTool?.[t.id] || 0) >= MANUAL_TOOL_CAPS[t.id]).length;

  // Iluminación por lado del triángulo: cada lado es una meta binaria
  // (INCOMPLETO u COMPLETO), nunca una línea iluminada a medias por haber
  // tocado solo una de sus herramientas. Se deriva del estado durable real
  // de Manual (progressByTool/MANUAL_TOOL_CAPS -- la misma autoridad que ya
  // usa totalProgress/completedCount arriba), no de un flag visual local,
  // así que sobrevive volver al hub, refresh y reanudar sesión.
  const isToolComplete = (id: DurableManualTool) => (progressByTool?.[id] || 0) >= MANUAL_TOOL_CAPS[id];
  const leftComplete = isToolComplete('leer') && isToolComplete('alai') && isToolComplete('examen');
  const rightComplete = isToolComplete('flashcards') && isToolComplete('quizzes');
  const bottomComplete = isToolComplete('resumen');

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column',
      fontFamily: BODY, zIndex: 9999, overflow: 'auto',
    }}>
      {/* HEADER */}
      <div style={{
        padding: '20px 32px', background: 'transparent',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 24,
      }}>
        <button
          onClick={onClose}
          style={{
            padding: '8px 14px', borderRadius: RADIUS.control,
            border: '2px solid var(--blue)', background: 'transparent',
            color: 'var(--blue)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            fontFamily: BODY,
          }}
        >← volver al mapa</button>
      </div>

      {/* GRID PRINCIPAL: sidebar izq + zona triangular + sidebar der */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: '260px 1fr 260px',
        gap: 24, padding: '0 32px 40px',
        opacity: ready ? 1 : 0,
        transform: ready ? 'none' : 'translateY(8px)',
        transition: 'opacity 0.5s, transform 0.5s',
      }}>
        {/* SIDEBAR IZQUIERDO */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h1 style={{
              fontSize: 42, fontWeight: 900, margin: 0, lineHeight: 1,
              color: 'var(--text-primary)',
              fontFamily: BODY,
            }}>
              Modo <span style={{ color: 'var(--blue)' }}>Manual</span>
            </h1>
            <p style={{
              fontSize: 13, color: 'var(--text-faint)', marginTop: 12,
              lineHeight: 1.5,
            }}>
              Tú llevas el control. Estudia a tu ritmo usando las herramientas que necesites.
            </p>
          </div>

          {/* Material seleccionado */}
          <div style={{
            padding: 16, borderRadius: RADIUS.card, background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Material seleccionado
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 24 }}>📄</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                {materiales.length} {materiales.length === 1 ? 'documento' : 'documentos'}
              </div>
            </div>
          </div>

          {/* Progreso general con círculo */}
          <div style={{
            padding: 20, borderRadius: RADIUS.card, background: 'var(--bg-card)',
            border: '1px solid var(--border-color)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Tu progreso general
            </div>
            <div style={{ position: 'relative', width: 120, height: 120, margin: '0 auto' }}>
              <svg width="120" height="120" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" stroke="var(--border-color)" strokeWidth="8" fill="none" />
                <circle cx="60" cy="60" r="52" stroke="var(--blue)" strokeWidth="8" fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(totalProgress / 100) * 326.7} 326.7`}
                  transform="rotate(-90 60 60)"
                />
              </svg>
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1 }}>{totalProgress}%</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2, fontWeight: 600 }}>Progreso</div>
              </div>
            </div>
          </div>

          <div style={{
            padding: 12, borderRadius: RADIUS.control, borderLeft: '3px solid var(--border-color2)',
            background: 'var(--bg-card2)',
          }}>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0, lineHeight: 1.5 }}>
              "La constancia convierte el estudio en dominio."
            </p>
          </div>
        </div>

        {/* ZONA TRIANGULAR CENTRAL */}
        <div style={{
          position: 'relative', minHeight: 680,
        }}>
          {/* Grid papel */}
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.4,
            backgroundImage: `
              linear-gradient(color-mix(in srgb, var(--text-primary) 10%, transparent) 1px, transparent 1px),
              linear-gradient(90deg, color-mix(in srgb, var(--text-primary) 10%, transparent) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
            borderRadius: RADIUS.card,
          }} />

          {/* SVG con las 3 líneas triangulares que se iluminan */}
          <svg style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: 1,
          }} preserveAspectRatio="none">
            <defs>
              <linearGradient id="glow-top-right" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#f472b6" />
              </linearGradient>
              <linearGradient id="glow-right-left" x1="100%" y1="0%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#4ade80" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
              <linearGradient id="glow-left-top" x1="0%" y1="100%" x2="50%" y2="0%">
                <stop offset="0%" stopColor="#f87171" />
                <stop offset="100%" stopColor="#facc15" />
              </linearGradient>
            </defs>

            {/* Triángulo real: 3 líneas que se iluminan COMPLETAS cuando su
                grupo de herramientas está 100% hecho -- nunca a medias.
                Lado IZQUIERDO: Leer + ALAI Chat + Examen (las 3)
                Lado DERECHO:   Flashcards + Quizzes (las 2)
                Lado INFERIOR:  Mi resumen (la única de ese lado) */}

            {/* Lado derecho: Flashcards + Quizzes */}
            <line
              x1="52%" y1="16%" x2="83%" y2="86%"
              stroke={rightComplete ? 'url(#glow-top-right)' : 'rgba(148, 163, 184, 0.35)'}
              strokeWidth={rightComplete ? 4 : 1.5}
              strokeLinecap="round"
              style={{
                filter: rightComplete
                  ? 'drop-shadow(0 0 16px rgba(244, 114, 182, 0.8))'
                  : 'none',
                transition: 'all 0.4s ease',
              }}
            />
            {/* Lado inferior: Mi resumen */}
            <line
              x1="82%" y1="90%" x2="18%" y2="90%"
              stroke={bottomComplete ? 'url(#glow-right-left)' : 'rgba(148, 163, 184, 0.35)'}
              strokeWidth={bottomComplete ? 4 : 1.5}
              strokeLinecap="round"
              style={{
                filter: bottomComplete
                  ? 'drop-shadow(0 0 16px rgba(167, 139, 250, 0.8))'
                  : 'none',
                transition: 'all 0.4s ease',
              }}
            />
            {/* Lado izquierdo: Leer + ALAI Chat + Examen */}
            <line
              x1="17%" y1="86%" x2="48%" y2="16%"
              stroke={leftComplete ? 'url(#glow-left-top)' : 'rgba(148, 163, 184, 0.35)'}
              strokeWidth={leftComplete ? 4 : 1.5}
              strokeLinecap="round"
              style={{
                filter: leftComplete
                  ? 'drop-shadow(0 0 16px rgba(248, 113, 113, 0.8))'
                  : 'none',
                transition: 'all 0.4s ease',
              }}
            />
          </svg>

          {/* Tarjeta central Modo Manual */}
          <div style={{
            position: 'absolute',
            left: '50%', top: '50%',
            transform: 'translate(-50%, -50%) rotate(-1.5deg)',
            width: 200,
            background: '#fefce8',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: '20px 18px',
            boxShadow: hardShadow('rgba(0,0,0,.35)', 5, 6),
            textAlign: 'center',
            zIndex: 2,
          }}>
            {/* Cinta washi arriba */}
            <div style={{
              position: 'absolute',
              top: -8, left: '50%', transform: 'translateX(-50%) rotate(-3deg)',
              width: 60, height: 16,
              background: 'rgba(251, 191, 36, 0.5)',
              borderRadius: 2,
            }} />
            <h2 style={{
              fontSize: 26, fontWeight: 800, margin: '0 0 12px',
              color: '#0f172a', lineHeight: 1.1,
              fontFamily: BODY,
            }}>
              Modo<br/>Manual
            </h2>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, fontSize: 12, color: '#475569', marginBottom: 4,
            }}>
              🎯 {materiales.length} material{materiales.length !== 1 ? 'es' : ''}
            </div>
            {completedCount > 0 && (
              <div style={{
                fontSize: 11, color: '#0369a1', fontWeight: 700, marginTop: 8,
              }}>
                {completedCount}/6 completadas
              </div>
            )}
            <p style={{
              fontFamily: HAND, fontSize: 15, color: '#0369a1',
              margin: '12px 0 0', lineHeight: 1.3,
            }}>
              Tú decides qué estudiar y cómo hacerlo.
            </p>
          </div>

          {/* 6 nodos en pares por vértice */}
          {tools.map(tool => {
            const pct = progressByTool?.[tool.id] || 0;
            const cap = MANUAL_TOOL_CAPS[tool.id];
            const isCompleted = pct >= cap;
            return (
              <button
                key={tool.id}
                onClick={tool.action}
                style={{
                  position: 'absolute',
                  left: `${tool.x}%`, top: `${tool.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 200,
                  padding: '14px 16px',
                  background: 'var(--bg-card)',
                  border: `2px solid ${tool.color}`,
                  borderRadius: RADIUS.card,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: BODY,
                  boxShadow: hardShadow(tool.color, 2, 3),
                  transition: 'all 0.2s',
                  zIndex: 3,
                }}
                onMouseDown={e => {
                  e.currentTarget.style.transform = 'translate(-50%, -50%) scale(0.98)';
                }}
                onMouseUp={e => {
                  e.currentTarget.style.transform = 'translate(-50%, -50%)';
                }}
              >
                {/* Icono + título */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>{tool.emoji}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', flex: 1 }}>{tool.title}</span>
                  {isCompleted && <span style={{ fontSize: 16 }}>✅</span>}
                </div>

                {/* Descripción */}
                <p style={{
                  fontSize: 11, color: 'var(--text-faint)', margin: 0, lineHeight: 1.4,
                }}>
                  {tool.desc}
                </p>

                {/* Barra de progreso mini */}
                {pct > 0 && (
                  <div style={{
                    marginTop: 8, height: 4, background: 'var(--bg-card2)',
                    borderRadius: RADIUS.chip, overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, (pct / cap) * 100)}%`,
                      background: tool.color,
                      transition: 'width 0.4s',
                    }} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* SIDEBAR DERECHO */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{
            padding: 16, borderRadius: RADIUS.card, background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Progreso de estudio
            </div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--blue)' }}>
              {totalProgress}%
            </div>
          </div>

          <div style={{
            padding: 16, borderRadius: RADIUS.card, background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
              ⭐ Recomendación
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0, lineHeight: 1.5 }}>
              Usa las herramientas en el orden que necesites. Tú decides.
            </p>
          </div>

          <div style={{
            padding: 16, borderRadius: RADIUS.card,
            background: accentTint('var(--blue)', 10),
            border: '1px solid var(--blue-border)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)', marginBottom: 6 }}>
              💡
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              Este es tu espacio. Organiza tu estudio como mejor te funcione.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
