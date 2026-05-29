'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useMultiContent } from '../../lib/materials/useContent';

const HAND = "'Caveat', cursive";
const BODY = "'Inter', system-ui, sans-serif";

function toRgba(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length !== 6) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(94,234,212,${alpha})`;
}

function bezierPoint(t: number, p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

type EnergyLine = {
  key: string;
  fromX: number; fromY: number;
  ctrlX: number; ctrlY: number;
  toX: number; toY: number;
  color: string;
  active: boolean;
};

function useEnergyEngine(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  chargeState: React.MutableRefObject<Map<string, number>>,
  lines: EnergyLine[]
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize); resize();

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      lines.forEach(line => {
        const current = chargeState.current.get(line.key) || 0;
        let next = current;
        if (line.active) next = Math.min(1, current + 0.03);
        else next = Math.max(0, current - 0.025);
        chargeState.current.set(line.key, next);
        if (next <= 0.001) return;

        const p0 = { x: line.fromX, y: line.fromY };
        const p1 = { x: line.ctrlX, y: line.ctrlY };
        const p2 = { x: line.toX, y: line.toY };

        const totalSteps = 40;
        const chargedSteps = Math.floor(totalSteps * next);
        if (chargedSteps < 1) return;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const drawPath = () => {
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i <= chargedSteps; i++) {
            const t = i / totalSteps;
            const pt = bezierPoint(t, p0, p1, p2);
            ctx.lineTo(pt.x, pt.y);
          }
        };

        drawPath();
        ctx.strokeStyle = toRgba(line.color, 0.35);
        ctx.lineWidth = 8;
        ctx.shadowBlur = 22;
        ctx.shadowColor = line.color;
        ctx.stroke();

        drawPath();
        ctx.strokeStyle = toRgba(line.color, 0.9);
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 12;
        ctx.stroke();

        drawPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1;
        ctx.shadowBlur = 6;
        ctx.shadowColor = '#fff';
        ctx.stroke();

        if (next < 1) {
          const head = bezierPoint(next, p0, p1, p2);
          const grad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 16);
          grad.addColorStop(0, 'rgba(255,255,255,1)');
          grad.addColorStop(0.3, toRgba(line.color, 0.95));
          grad.addColorStop(1, toRgba(line.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(head.x, head.y, 16, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });

      raf = requestAnimationFrame(loop);
    };

    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [lines]);
}

function getDocEmoji(tipo: string) {
  if (tipo === 'pdf') return '📄';
  if (tipo === 'imagen') return '🖼️';
  if (tipo === 'word') return '📃';
  if (tipo === 'ppt') return '📊';
  if (tipo === 'youtube') return '▶️';
  return '📁';
}

interface Props {
  materiales: any[];
  onClose: () => void;
  onOpenFlashcards: () => void;
  onOpenQuiz: () => void;
  onOpenRepasar?: () => void;
  onComingSoon: (label: string) => void;
}

export default function TeoricoWorkspace({ materiales, onClose, onOpenFlashcards, onOpenQuiz, onOpenRepasar, onComingSoon }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chargeState = useRef<Map<string, number>>(new Map());

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [vp, setVp] = useState({ w: 1400, h: 900 });
  const [phase, setPhase] = useState<'enter' | 'idle'>('enter');

  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setPhase('idle'), 100);
    return () => clearTimeout(t);
  }, []);

  // ═══ LAYOUT ELÍPTICO — más ancho que alto ═══
  const HEADER_H = 140;
  const FOOTER_H = 90;

  const centerX = vp.w / 2;
  const centerY = HEADER_H + (vp.h - HEADER_H - FOOTER_H) / 2;

  // Tamaño del centro chico
  const centerSize = 160;

  // Radios elípticos (horizontal mayor que vertical → aprovechar el ancho)
  // Esto evita que se peguen verticalmente
  const radiusX = Math.min(vp.w * 0.42, 650);
  const radiusY = Math.min((vp.h - HEADER_H - FOOTER_H) * 0.42, 280);

  const NODE_SIZE = 120;

  // ═══ 12 HERRAMIENTAS ═══
  const tools = useMemo(() => [
    { id: 'repasar',      emoji: '🧠', label: 'Repasar',      desc: 'lectura activa',    colorRaw: '#22c55e', enabled: true,  action: () => onOpenRepasar?.() },
    { id: 'analisis',     emoji: '🔬', label: 'Análisis',     desc: 'desglose IA',       colorRaw: '#38bdf8', enabled: false, action: () => onComingSoon('Análisis Teórico') },
    { id: 'flashcards',   emoji: '🎴', label: 'Flashcards',   desc: 'memoriza',          colorRaw: '#f5c842', enabled: true,  action: () => onOpenFlashcards() },
    { id: 'quiz',         emoji: '🎯', label: 'Quiz',         desc: 'opción múltiple',   colorRaw: '#ef4444', enabled: true,  action: () => onOpenQuiz() },
    { id: 'chapbot',      emoji: '🤖', label: 'ChapBot',      desc: 'pregunta al doc',   colorRaw: '#f472b6', enabled: false, action: () => onComingSoon('ChapBot del documento') },
    { id: 'ejemplos',     emoji: '💡', label: 'Ejemplos',     desc: 'casos prácticos',   colorRaw: '#fbbf24', enabled: false, action: () => onComingSoon('Ejemplos') },
    { id: 'examen',       emoji: '📋', label: 'Examen',       desc: 'simulacro real',    colorRaw: '#dc2626', enabled: false, action: () => onComingSoon('Modo Examen') },
    { id: 'presentacion', emoji: '🎤', label: 'Presentación', desc: 'expón el tema',     colorRaw: '#8b5cf6', enabled: false, action: () => onComingSoon('Presentación') },
    { id: 'studymap',     emoji: '🗺️', label: 'Study Map',    desc: 'mapa mental',       colorRaw: '#06b6d4', enabled: false, action: () => onComingSoon('Study Map') },
    { id: 'truquitos',    emoji: '✨', label: 'Truquitos',    desc: 'mnemotecnia',       colorRaw: '#ec4899', enabled: false, action: () => onComingSoon('Truquitos') },
  ], [onOpenFlashcards, onOpenQuiz, onOpenRepasar, onComingSoon]);

  // Posiciones en órbita elíptica
  const orbitNodes = useMemo(() => {
    const n = tools.length;
    const startAngle = -Math.PI / 2;
    return tools.map((tool, i) => {
      const angle = startAngle + (i / n) * Math.PI * 2;
      return {
        ...tool,
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
        angle,
      };
    });
  }, [tools, centerX, centerY, radiusX, radiusY]);

  // Líneas de energía
  const energyLines: EnergyLine[] = useMemo(() => {
    return orbitNodes.map(node => {
      const dx = node.x - centerX;
      const dy = node.y - centerY;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ux = dx / len;
      const uy = dy / len;

      const fromX = centerX + ux * (centerSize / 2);
      const fromY = centerY + uy * (centerSize / 2);

      const midX = (fromX + node.x) / 2;
      const midY = (fromY + node.y) / 2;
      const perpX = -uy * 20;
      const perpY = ux * 20;

      return {
        key: node.id,
        fromX, fromY,
        ctrlX: midX + perpX,
        ctrlY: midY + perpY,
        toX: node.x,
        toY: node.y,
        color: node.colorRaw,
        active: hoveredId === node.id,
      };
    });
  }, [orbitNodes, hoveredId, centerX, centerY, centerSize]);

  useEnergyEngine(canvasRef, chargeState, energyLines);

  const principal = materiales[0];

  // ─── Resolver contenido de todos los materiales ───
  const { texts: contenidos, status: contentStatus, totalChars } = useMultiContent(
    materiales.map((m: any) => ({
      id: m.id,
      contenido: m.contenido,
      kind: m.kind ?? m.tipo,
      materialId: m.materialId,
    })),
    true,
  );

  // Texto combinado de todos los materiales (para flashcards y quiz multi-doc)
  const contenidoCombinado = Object.values(contenidos).join('\n\n---\n\n');

  // Enriquecer materiales con el texto resuelto
  const materialesConTexto = materiales.map((m: any) => ({
    ...m,
    contenido: contenidos[m.id] ?? m.contenido ?? '',
  }));

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-primary)',
      overflow: 'hidden',
      color: 'var(--text-primary)',
      fontFamily: HAND,
      animation: 'wsEnter 0.5s ease-out',
    }}>
      {/* FONDO CUADERNO */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(to bottom, transparent 0, transparent 47px, color-mix(in srgb, var(--text-primary) 7%, transparent) 47px, color-mix(in srgb, var(--text-primary) 7%, transparent) 48px, transparent 48px)`,
        backgroundSize: '100% 48px',
        pointerEvents: 'none', zIndex: 0,
      }} />
      <div style={{
        position: 'absolute', left: 80, top: 0, bottom: 0,
        width: 1.5,
        background: '#ef4444',
        opacity: 0.4,
        pointerEvents: 'none', zIndex: 0,
      }} />

      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }} />

      {/* Líneas guía SVG */}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
        {/* Anillo elíptico guía */}
        <ellipse cx={centerX} cy={centerY} rx={radiusX} ry={radiusY}
          stroke="color-mix(in srgb, var(--text-primary) 7%, transparent)"
          strokeWidth="1" strokeDasharray="3 7" fill="none" />

        {energyLines.map((line, i) => (
          <path
            key={i}
            d={`M ${line.fromX} ${line.fromY} Q ${line.ctrlX} ${line.ctrlY} ${line.toX} ${line.toY}`}
            stroke="color-mix(in srgb, var(--text-primary) 18%, transparent)"
            strokeWidth={1.4}
            strokeDasharray="4 6"
            fill="none"
          />
        ))}
      </svg>

      {/* ═══ HEADER ═══ */}
      <div style={{
        position: 'fixed', top: 24, left: 0, right: 0,
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'flex-start',
        padding: '0 32px',
        gap: 20,
        zIndex: 100, pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', justifyContent: 'flex-start', pointerEvents: 'auto' }}>
          <button onClick={onClose} className="ws-btn" style={{
            background: 'var(--bg-card)',
            border: '2px solid var(--text-primary)',
            padding: '10px 22px',
            borderRadius: 12,
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontFamily: HAND, fontSize: 20, fontWeight: 800,
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-2deg)',
            display: 'flex', alignItems: 'center', gap: 8,
            whiteSpace: 'nowrap',
          }}>
            <span>←</span> volver al mapa
          </button>
        </div>

        <div style={{
          textAlign: 'center',
          opacity: phase === 'idle' ? 1 : 0,
          transform: phase === 'idle' ? 'translateY(0)' : 'translateY(-20px)',
          transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s',
        }}>
          <div style={{
            fontFamily: HAND, fontSize: 17,
            color: 'var(--text-faint)',
            fontStyle: 'italic', letterSpacing: 1.5,
            transform: 'rotate(-1deg)',
            display: 'inline-block',
          }}>~ enfoque ~</div>
          <h1 style={{
            fontFamily: HAND,
            fontSize: 52,
            fontWeight: 900,
            color: 'var(--text-primary)',
            margin: '2px 0 0', lineHeight: 1,
            transform: 'rotate(-1deg)',
            display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 14,
          }}>
            <span style={{ fontSize: 44 }}>📖</span>
            <span>Te<span style={{ color: 'var(--red)' }}>ó</span>rico</span>
          </h1>
          <svg width="240" height="8" style={{ display: 'block', margin: '4px auto 0' }}>
            <path d="M5 4 Q 120 0 235 5"
              stroke="var(--gold)" strokeWidth="3"
              fill="none" strokeLinecap="round" opacity="0.85" />
          </svg>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', pointerEvents: 'auto' }}>
          <div className="ws-btn" style={{
            background: 'color-mix(in srgb, var(--gold) 22%, var(--bg-card))',
            border: '2px solid var(--text-primary)',
            padding: '10px 18px',
            borderRadius: 12,
            fontFamily: HAND, fontSize: 18,
            color: 'var(--text-primary)',
            fontWeight: 700,
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(2deg)',
            display: 'flex', alignItems: 'center', gap: 8,
            whiteSpace: 'nowrap',
          }}>
            📚 <span style={{ color: 'var(--red)', fontWeight: 900, fontSize: 24 }}>{materiales.length}</span>
            <span style={{ fontStyle: 'italic' }}>{materiales.length === 1 ? 'material' : 'materiales'}</span>
          </div>
        </div>
      </div>

      {/* ═══ CENTRO ═══ */}
      <div
        style={{
          position: 'absolute',
          left: centerX,
          top: centerY,
          width: centerSize,
          height: centerSize,
          marginLeft: -centerSize / 2,
          marginTop: -centerSize / 2,
          opacity: phase === 'idle' ? 1 : 0,
          transform: phase === 'idle' ? 'scale(1) rotate(-2deg)' : 'scale(0.5)',
          transition: 'all 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s',
          zIndex: 30,
        }}
      >
        <div style={{
          position: 'absolute',
          top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-3deg)',
          width: 70, height: 16,
          background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
          border: '1px solid color-mix(in srgb, var(--gold) 40%, transparent)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          borderRadius: 1,
          zIndex: 32,
        }}/>

        <div style={{
          position: 'absolute', inset: -12,
          border: '2px solid color-mix(in srgb, var(--gold) 50%, transparent)',
          borderRadius: 16,
          animation: 'cardPulse 2.5s ease-in-out infinite',
          pointerEvents: 'none',
        }} />

        <div style={{
          width: '100%', height: '100%',
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 14,
          boxShadow: '5px 6px 0 var(--text-primary), 0 14px 36px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', padding: '14px 10px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 18,
            width: 1.5, background: '#ef4444',
            opacity: 0.4, pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `linear-gradient(to bottom, transparent 0, transparent 24px, color-mix(in srgb, var(--text-primary) 7%, transparent) 24px, color-mix(in srgb, var(--text-primary) 7%, transparent) 25px, transparent 25px)`,
            backgroundSize: '100% 25px',
            pointerEvents: 'none',
          }} />

          <div style={{
            fontSize: 50, marginBottom: 4,
            position: 'relative', zIndex: 1,
            filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))',
          }}>
            {principal ? getDocEmoji(principal.tipo) : '📚'}
          </div>

          <div style={{
            fontFamily: HAND, fontSize: 18,
            color: 'var(--text-primary)',
            fontWeight: 800, lineHeight: 1.1,
            padding: '0 6px', maxWidth: '100%',
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            position: 'relative', zIndex: 1,
          }}>
            {contentStatus === 'loading' ? (
            <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--text-faint)' }}>
              extrayendo texto...
            </span>
          ) : principal ? principal.nombre : 'Sin material'}
          </div>

          {materiales.length > 1 && (
            <div style={{
              fontSize: 13, color: 'var(--text-faint)',
              fontFamily: BODY, fontStyle: 'italic',
              marginTop: 3, position: 'relative', zIndex: 1,
            }}>+ {materiales.length - 1} más</div>
          )}
        </div>
      </div>

      {/* ═══ NODOS ORBITALES ═══ */}
      {orbitNodes.map((tool, i) => {
        const isH = hoveredId === tool.id;
        const delay = 0.2 + i * 0.04;

        return (
          <div
            key={tool.id}
            style={{
              position: 'absolute',
              left: tool.x,
              top: tool.y,
              width: NODE_SIZE,
              height: NODE_SIZE,
              marginLeft: -NODE_SIZE / 2,
              marginTop: -NODE_SIZE / 2,
              opacity: phase === 'idle' ? (tool.enabled ? 1 : 0.6) : 0,
              transform: phase === 'idle' ? 'scale(1)' : 'scale(0.5)',
              transition: `opacity 0.5s ease-out ${phase === 'enter' ? delay : 0}s, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${phase === 'enter' ? delay : 0}s`,
              zIndex: isH ? 50 : 20,
            }}
          >
            <button
              onClick={() => tool.enabled && tool.action()}
              onMouseEnter={() => setHoveredId(tool.id)}
              onMouseLeave={() => setHoveredId(null)}
              disabled={!tool.enabled}
              className="ws-node"
              style={{
                width: '100%',
                height: '100%',
                background: tool.enabled
                  ? (isH ? `color-mix(in srgb, ${tool.colorRaw} 18%, var(--bg-card))` : 'var(--bg-card)')
                  : 'var(--bg-card)',
                border: `2px solid ${tool.enabled ? (isH ? tool.colorRaw : 'var(--text-primary)') : 'var(--border-color)'}`,
                borderRadius: 14,
                cursor: tool.enabled ? 'pointer' : 'not-allowed',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                textAlign: 'center', padding: '8px 6px',
                boxShadow: tool.enabled
                  ? (isH
                    ? `0 0 30px ${tool.colorRaw}aa, 0 0 60px ${tool.colorRaw}44, 0 6px 20px rgba(0,0,0,0.3)`
                    : '3px 4px 0 var(--text-primary)')
                  : '2px 2px 0 var(--border-color)',
                fontFamily: HAND,
                overflow: 'hidden',
                position: 'relative',
                transition: 'all 0.25s cubic-bezier(.2,.8,.2,1)',
              }}
            >
              {isH && tool.enabled && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: `radial-gradient(circle at 30% 30%, ${tool.colorRaw}33, transparent 70%)`,
                  pointerEvents: 'none',
                }} />
              )}

              <div style={{
                fontSize: isH && tool.enabled ? 38 : 32,
                marginBottom: 4,
                filter: isH && tool.enabled
                  ? `drop-shadow(0 0 12px ${tool.colorRaw}aa) drop-shadow(0 3px 5px rgba(0,0,0,0.2))`
                  : 'drop-shadow(0 2px 3px rgba(0,0,0,0.2))',
                transition: 'all 0.3s',
                position: 'relative', zIndex: 1,
              }}>{tool.emoji}</div>

              <div style={{
                fontSize: 18,
                fontWeight: 900,
                color: isH && tool.enabled
                  ? tool.colorRaw
                  : tool.enabled ? 'var(--text-primary)' : 'var(--text-faint)',
                fontFamily: BODY,
                lineHeight: 1,
                transition: 'color 0.3s',
                position: 'relative', zIndex: 1,
                whiteSpace: 'nowrap',
              }}>{tool.label}</div>

              {tool.enabled && (
                <svg width="55" height="4" style={{ marginTop: 2, position: 'relative', zIndex: 1 }}>
                  <path d="M2 2 Q 27 0 53 2.5"
                    stroke={tool.colorRaw}
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    opacity={isH ? 1 : 0.75} />
                </svg>
              )}

              <div style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                fontFamily: BODY,
                fontStyle: 'italic',
                marginTop: 2,
                lineHeight: 1.05,
                padding: '0 4px',
                position: 'relative', zIndex: 1,
              }}>{tool.desc}</div>

              {!tool.enabled && (
                <div style={{
                  fontSize: 9,
                  color: 'var(--text-faint)',
                  fontFamily: HAND,
                  fontWeight: 700,
                  marginTop: 2,
                  letterSpacing: 0.3,
                  fontStyle: 'italic',
                  opacity: 0.7,
                }}>~ pronto ~</div>
              )}
            </button>
          </div>
        );
      })}

      {/* BARRA INFERIOR */}
      {materiales.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%',
          transform: 'translateX(-50%) rotate(-1deg)',
          zIndex: 100,
          display: 'flex', gap: 8,
          background: 'var(--bg-card)',
          border: '2px solid var(--text-primary)',
          padding: '8px 14px',
          borderRadius: 12,
          maxWidth: '85vw',
          overflowX: 'auto',
          boxShadow: '3px 4px 0 var(--text-primary)',
          opacity: phase === 'idle' ? 1 : 0,
          transitionDelay: '0.7s',
          transition: 'opacity 0.5s ease-out',
          alignItems: 'center',
        }}>
          <div style={{
            fontFamily: BODY, fontSize: 16, fontWeight: 700,
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            display: 'flex', alignItems: 'center', gap: 5,
            paddingRight: 10, borderRight: '2px dashed var(--border-color)',
            marginRight: 4, whiteSpace: 'nowrap',
          }}>
            📖 estudiando:
          </div>
          {materiales.map((m: any, i: number) => (
            <div key={m.id || i} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 11px', borderRadius: 18,
              background: 'color-mix(in srgb, var(--gold) 18%, var(--bg-secondary))',
              border: '1.5px dashed var(--gold)',
              fontFamily: HAND, fontSize: 15, fontWeight: 700,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              transform: `rotate(${i % 2 === 0 ? -1 : 1}deg)`,
            }}>
              <span style={{ fontSize: 15 }}>{getDocEmoji(m.tipo)}</span>
              <span style={{
                maxWidth: 140,
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{m.nombre}</span>
            </div>
          ))}
        </div>
      )}

      <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes wsEnter {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cardPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        .ws-btn {
          transition: transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s, filter .2s;
        }
        .ws-btn:hover {
          transform: translateY(-3px) rotate(0deg) !important;
          box-shadow: 4px 6px 0 var(--text-primary) !important;
          filter: brightness(1.05);
        }
        .ws-node:hover {
          transform: translateY(-4px) scale(1.06);
        }
        .ws-node:active {
          transform: translateY(0) scale(0.97);
        }
        html, body { overflow: hidden !important; }
      `}</style>
    </div>
  );
}
