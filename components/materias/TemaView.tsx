'use client';

import { useState, useRef, useEffect, useMemo , useCallback } from 'react';
import { Materia, Tema, Apunte, Documento } from '../../lib/storage';
import TeoricoWorkspace from './TeoricoWorkspace';
import SeleccionPaginas, { type SeleccionResult } from './SeleccionPaginas';
import ModalConvertirPDF from './ModalConvertirPDF';
import { upsertSession, cleanupSessions, getSessionsByTema, getMaterialSessions, type StudySession } from '../../lib/studySessions';


const HAND = "'Caveat', cursive";
const BODY = "'Inter', system-ui, sans-serif";
const HAND_BOLD = "'Caveat', cursive";

function getDocEmoji(doc: Documento) {
  if (doc.tipo === 'pdf') return '📄';
  if (doc.tipo === 'imagen') return '🖼️';
  if (doc.tipo === 'word') return '📃';
  if (doc.tipo === 'ppt') return '📊';
  if (doc.tipo === 'youtube') return '▶️';
  return '📁';
}

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
  return `rgba(245,200,66,${alpha})`;
}

// ═══ PALETA + VARIANTES DE PAPELITO POR ROL ═══
type PaperVariant = 'libreta-abierta'|'tag-grande'|'cuaderno-libro'|'carpeta-folder'|'postit-arrugado'|'hoja-papel'|'ticket-rojo'|'sticker-clip'|'papelito-simple';

function paperPalette(nodeId: string, nodeType: string): {
  paper: string; ink: string; inkSoft: string; shadow: string;
  variant: PaperVariant;
} {
  const id = (nodeId || '').toLowerCase();
  const type = (nodeType || '').toLowerCase();

  // Decisión: variante + color por id/type
  if (type === 'root') {
    return { paper: '#fef3c7', ink: '#451a03', inkSoft: '#92400e', shadow: 'rgba(252,211,77,0.6)', variant: 'libreta-abierta' };
  }
  if (id === 'cuaderno') {
    return { paper: '#fde047', ink: '#422006', inkSoft: '#78350f', shadow: 'rgba(250,204,21,0.5)', variant: 'cuaderno-libro' };
  }
  if (id === 'material') {
    return { paper: '#67e8f9', ink: '#083344', inkSoft: '#0e7490', shadow: 'rgba(34,211,238,0.5)', variant: 'carpeta-folder' };
  }
  if (id === 'rama-apuntes') {
    return { paper: '#fef08a', ink: '#422006', inkSoft: '#854d0e', shadow: 'rgba(250,204,21,0.4)', variant: 'postit-arrugado' };
  }
  if (id === 'rama-subir') {
    return { paper: '#f9a8d4', ink: '#500724', inkSoft: '#9d174d', shadow: 'rgba(244,114,182,0.45)', variant: 'sticker-clip' };
  }
  if (id === 'rama-yt') {
    return { paper: '#fca5a5', ink: '#450a0a', inkSoft: '#991b1b', shadow: 'rgba(248,113,113,0.5)', variant: 'ticket-rojo' };
  }
  if (id === 'rama-pres') {
    return { paper: '#c4b5fd', ink: '#1e1b4b', inkSoft: '#4338ca', shadow: 'rgba(167,139,250,0.45)', variant: 'papelito-simple' };
  }
  if (id === 'rama-ensayo' || id === 'rama-grupal') {
    return { paper: '#fdba74', ink: '#431407', inkSoft: '#7c2d12', shadow: 'rgba(251,146,60,0.45)', variant: 'papelito-simple' };
  }
  if (id.startsWith('a-')) {
    return { paper: '#fef08a', ink: '#422006', inkSoft: '#854d0e', shadow: 'rgba(250,204,21,0.4)', variant: 'postit-arrugado' };
  }
  if (type === 'doc' || id.startsWith('d-')) {
    return { paper: '#f8fafc', ink: '#0f172a', inkSoft: '#475569', shadow: 'rgba(148,163,184,0.4)', variant: 'hoja-papel' };
  }
  return { paper: '#fde047', ink: '#422006', inkSoft: '#78350f', shadow: 'rgba(250,204,21,0.4)', variant: 'papelito-simple' };
}

function paperRot(id: string) {
  let h = 0;
  for (let i = 0; i < (id || '').length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 7) - 3);
}




// ═══════════════════════════════════════════════════════════════
// RUEDA DE ENFOQUES — EXPERIENCIA CINEMÁTICA
// ═══════════════════════════════════════════════════════════════
function EnfoqueWheel({ onClose, onSelect, color, materialesCount }: any) {
  const [hov, setHov] = useState<string | null>(null);
  const [phase, setPhase] = useState<'teorico' | 'matematico' | 'mixto' | 'practico' | 'practico' | 'enter' | 'idle' | null>('enter');

  useEffect(() => {
    const t = setTimeout(() => setPhase('idle'), 50);
    return () => clearTimeout(t);
  }, []);

  const items = [
    {
      id: 'teorico',
      label: 'Teórico',
      sub: 'Lectura · Flashcards · Quiz',
      emoji: '📖',
      color: '#5eead4',
      enabled: true,
      desc: 'Comprende conceptos, memoriza y autoevalúate',
    },
    {
      id: 'matematico',
      label: 'Matemático',
      sub: 'Fórmulas · Ejercicios · Pasos',
      emoji: '📐',
      color: '#a78bfa',
      enabled: false,
      desc: 'Resuelve problemas paso a paso',
    },
    {
      id: 'teorico-mat',
      label: 'Teórico-Mat.',
      sub: 'Combinación completa',
      emoji: '🧮',
      color: '#fbbf24',
      enabled: false,
      desc: 'Lo mejor de los dos mundos',
    },
  ];

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'radial-gradient(ellipse at center, rgba(15,15,20,0.85), rgba(0,0,0,0.97))',
      backdropFilter: 'blur(20px)',
      zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: HAND,
      animation: 'fadeIn 0.4s ease-out',
    }}>
      {/* Líneas de cuaderno de fondo */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(to bottom, transparent 0, transparent 47px, rgba(255,255,255,0.03) 47px, rgba(255,255,255,0.03) 48px, transparent 48px)`,
        backgroundSize: '100% 48px',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', left: '8%', top: 0, bottom: 0,
        width: 1,
        background: 'rgba(239,68,68,0.3)',
        pointerEvents: 'none',
      }} />

      <div onClick={e => e.stopPropagation()} style={{
        position: 'relative',
        textAlign: 'center',
        transform: phase === 'enter' ? 'scale(0.85)' : 'scale(1)',
        opacity: phase === 'enter' ? 0 : 1,
        transition: 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{
            fontSize: 18, color: 'rgba(255,255,255,0.5)',
            fontFamily: HAND, letterSpacing: 1,
            marginBottom: 8,
          }}>~ {materialesCount} {materialesCount === 1 ? 'material seleccionado' : 'materiales seleccionados'} ~</div>
          <h1 style={{
            fontSize: 56, color: '#fff',
            fontFamily: HAND, fontWeight: 700,
            margin: 0, lineHeight: 1,
            textShadow: '0 4px 30px rgba(255,255,255,0.2)',
          }}>¿cómo quieres estudiar?</h1>
          <div style={{
            fontSize: 20, color: 'rgba(255,255,255,0.6)',
            fontFamily: HAND, marginTop: 8,
            fontStyle: 'italic',
          }}>elige tu enfoque ↓</div>
        </div>

        {/* Cards horizontales */}
        <div style={{
          display: 'flex', gap: 20,
          justifyContent: 'center', alignItems: 'stretch',
          flexWrap: 'wrap',
          maxWidth: 1100,
        }}>
          {items.map((item, i) => {
            const isH = hov === item.id;
            const c = item.color;
            return (
              <button key={item.id}
                onClick={() => item.enabled && onSelect(item.id)}
                onMouseEnter={() => setHov(item.id)}
                onMouseLeave={() => setHov(null)}
                disabled={!item.enabled}
                style={{
                  position: 'relative',
                  width: 280, minHeight: 340,
                  background: isH && item.enabled
                    ? `linear-gradient(160deg, ${c}22, ${c}05)`
                    : 'linear-gradient(160deg, #16161a, #0a0a0c)',
                  border: `1.5px solid ${item.enabled ? (isH ? c : `${c}66`) : '#333'}`,
                  borderRadius: 20,
                  padding: '28px 22px',
                  cursor: item.enabled ? 'pointer' : 'not-allowed',
                  opacity: item.enabled ? 1 : 0.5,
                  transform: isH && item.enabled ? 'translateY(-12px) scale(1.03)' : 'translateY(0)',
                  transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  boxShadow: isH && item.enabled
                    ? `0 20px 60px ${c}55, 0 0 80px ${c}33, inset 0 0 30px ${c}11`
                    : `0 10px 30px rgba(0,0,0,0.4), inset 0 0 0 ${c}00`,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', textAlign: 'center',
                  fontFamily: HAND,
                  overflow: 'hidden',
                  animation: `slideUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${0.1 + i * 0.08}s both`,
                }}>
                {/* Pestañita post-it */}
                <div style={{
                  position: 'absolute',
                  top: -2, left: '50%', transform: 'translateX(-50%)',
                  width: 60, height: 12,
                  background: c,
                  borderRadius: '0 0 8px 8px',
                  boxShadow: `0 4px 12px ${c}88`,
                  opacity: item.enabled ? 1 : 0.3,
                }} />

                {/* Brillo de fondo cuando hover */}
                {isH && item.enabled && (
                  <div style={{
                    position: 'absolute',
                    top: '-30%', right: '-30%',
                    width: 200, height: 200,
                    background: `radial-gradient(circle, ${c}44, transparent 70%)`,
                    pointerEvents: 'none',
                  }} />
                )}

                <div style={{
                  fontSize: 70,
                  marginTop: 10,
                  marginBottom: 12,
                  filter: isH && item.enabled ? `drop-shadow(0 0 20px ${c}aa)` : 'none',
                  transition: 'filter 0.4s',
                }}>{item.emoji}</div>

                <div style={{
                  fontSize: 36, fontWeight: 700,
                  color: isH && item.enabled ? c : '#fff',
                  fontFamily: HAND,
                  lineHeight: 1, marginBottom: 6,
                  transition: 'color 0.3s',
                }}>{item.label}</div>

                <div style={{
                  fontSize: 16, color: 'rgba(255,255,255,0.55)',
                  fontFamily: HAND, fontStyle: 'italic',
                  marginBottom: 16,
                }}>{item.sub}</div>

                <div style={{
                  fontSize: 17, color: 'rgba(255,255,255,0.8)',
                  fontFamily: BODY,
                  lineHeight: 1.3,
                  flex: 1, display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                }}>{item.desc}</div>

                {/* CTA */}
                <div style={{
                  marginTop: 16,
                  padding: '8px 20px',
                  borderRadius: 30,
                  background: item.enabled
                    ? (isH ? c : `${c}22`)
                    : 'rgba(255,255,255,0.05)',
                  color: item.enabled ? (isH ? '#000' : c) : 'rgba(255,255,255,0.4)',
                  fontFamily: BODY, fontSize: 18, fontWeight: 700,
                  border: `1.5px solid ${item.enabled ? c : '#444'}`,
                  transition: 'all 0.3s',
                }}>
                  {item.enabled ? (isH ? 'empezar →' : 'seleccionar') : 'próximamente'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Cerrar */}
        <button onClick={onClose} style={{
          marginTop: 32,
          background: 'transparent',
          border: '1.5px solid rgba(255,255,255,0.3)',
          padding: '10px 28px',
          borderRadius: 30,
          color: 'rgba(255,255,255,0.8)',
          fontFamily: HAND, fontSize: 20, fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.3s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
          e.currentTarget.style.borderColor = '#fff';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
        }}>
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
  fromX: number; fromY: number;
  ctrlX: number; ctrlY: number;
  toX: number; toY: number;
  color: string;
  active: boolean;
};

function bezierPoint(t: number, p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function useEnergyEngine(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  chargeState: React.MutableRefObject<Map<string, number>>,
  lines: CurveLine[],
  transform: { offsetX: number; offsetY: number; scale: number }
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize); resize();

    const toScreen = (x: number, y: number) => ({
      x: transform.offsetX + x * transform.scale,
      y: transform.offsetY + y * transform.scale,
    });

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      lines.forEach(line => {
        const current = chargeState.current.get(line.key) || 0;
        let next = current;
        if (line.active) next = Math.min(1, current + 0.025);
        else next = Math.max(0, current - 0.015);
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
          const first = toScreen(p0.x, p0.y);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i <= chargedSteps; i++) {
            const t = i / totalSteps;
            const pt = bezierPoint(t, p0, p1, p2);
            const sp = toScreen(pt.x, pt.y);
            ctx.lineTo(sp.x, sp.y);
          }
        };

        drawPath();
        ctx.strokeStyle = toRgba(line.color, 0.3);
        ctx.lineWidth = 7;
        ctx.shadowBlur = 18;
        ctx.shadowColor = line.color;
        ctx.stroke();

        drawPath();
        ctx.strokeStyle = toRgba(line.color, 0.85);
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10;
        ctx.stroke();

        drawPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1;
        ctx.shadowBlur = 6;
        ctx.shadowColor = '#fff';
        ctx.stroke();

        if (next < 1) {
          const head = bezierPoint(next, p0, p1, p2);
          const hs = toScreen(head.x, head.y);
          const grad = ctx.createRadialGradient(hs.x, hs.y, 0, hs.x, hs.y, 14);
          grad.addColorStop(0, 'rgba(255,255,255,1)');
          grad.addColorStop(0.3, toRgba(line.color, 0.9));
          grad.addColorStop(1, toRgba(line.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(hs.x, hs.y, 14, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });

      raf = requestAnimationFrame(loop);
    };

    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [lines, transform]);
}

export default function TemaView({ materia, tema, onBack, onBackMateria, onGoHome, onAbrirApunte, onAbrirDocumento, onEliminarApunte, onEliminarDocumento, onNuevoApunte, onSubirDocumento, subiendoDoc, onAbrirUploader, onOpenFlashcards, onOpenQuiz, onOpenRepasar, returnToEnfoque, onClearReturnToEnfoque }: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [modalArchivo, setModalArchivo] = useState<{ nombre: string; tipo: 'pptx' | 'otro' } | null>(null);

  function detectarTipoArchivo(file: File): 'valido' | 'pptx' | 'otro' {
    const nombre = file.name.toLowerCase();
    const mime = (file.type || '').toLowerCase();
    if (nombre.endsWith('.pptx') || nombre.endsWith('.ppt') || mime.includes('presentationml') || mime.includes('powerpoint')) return 'pptx';
    if (nombre.endsWith('.pdf') || mime === 'application/pdf' || nombre.endsWith('.docx') || mime.includes('wordprocessingml') || nombre.endsWith('.txt') || mime === 'text/plain' || mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp)$/.test(nombre)) return 'valido';
    return 'otro';
  }

  function handleArchivoValidado(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    for (const f of files) {
      const tipo = detectarTipoArchivo(f);
      if (tipo === 'pptx' || tipo === 'otro') {
        setModalArchivo({ nombre: f.name, tipo });
        e.target.value = '';
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
  // ── ID de sesión a reanudar (cuando se hace "seguir estudiando") ──
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);

  // ── Modal de confirmación de borrado ──
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });

  const refreshSessions = useCallback(() => {
    if (!tema?.id) return;
    const existingIds = (tema.documentos || []).map((d: any) => d.id);
    cleanupSessions(tema.id, existingIds);
    setActiveSessions(getSessionsByTema(tema.id));
  }, [tema?.id, tema?.documentos]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // ── Auto-reabrir enfoque cuando volvemos de flashcards ──
  useEffect(() => {
    if (!returnToEnfoque) return;
    onClearReturnToEnfoque?.();
    // Buscar la sesión activa más reciente para este tema
    const sessions = getSessionsByTema(tema?.id || '');
    if (sessions.length > 0) {
      const lastSession = sessions[sessions.length - 1];
      // Restaurar selección
      const matIds = lastSession.materialIds || [];
      setSelectedIds(matIds.map((id: string) => {
        const doc = tema.documentos?.find((d: any) => (d.materialId || d.id) === id);
        return doc?.id || id;
      }).filter(Boolean));
      // Restaurar enfoque
      setEnfoqueElegido(lastSession.enfoque as any);
      if (lastSession.selectedPages) {
        const rebuilt = lastSession.materialIds.map((matId: string, idx: number) => ({
          materialId: matId,
          materialIndex: idx,
          pages: lastSession.selectedPages![matId] || [],
        }));
        setSeleccionResult(rebuilt as any);
      }
      setResumeSessionId(lastSession.id);
      setOpenTeorico(true);
      console.log('🔄 Auto-reabriendo enfoque desde flashcards:', lastSession.id);
    }
  }, [returnToEnfoque]);

  // Sincronizar selectedIds con documentos existentes (limpia IDs de docs borrados)
  // Se desactiva mientras se está borrando para evitar interferencia
  useEffect(() => {
    if (deleting) return; // No limpiar mientras borramos
    const existingIds = new Set(tema.documentos.map((d: any) => d.id));
    setSelectedIds(prev => {
      const filtered = prev.filter(id => existingIds.has(id));
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
        setZoom(z => Math.min(Math.max(z * factor, 0.5), 1.4));
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
      if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) {
        e.preventDefault();
      }
    };

    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('gesturestart', onGestureStart, { passive: false });
    document.addEventListener('gesturechange', onGestureChange, { passive: false });
    document.addEventListener('gestureend', onGestureEnd, { passive: false });
    document.addEventListener('keydown', onKey, { capture: true });

    // 4. Meta viewport (mobile/tablet pinch nativo)
    const meta = document.querySelector('meta[name="viewport"]');
    const prevViewport = meta?.getAttribute('content') || '';
    if (meta) {
      meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    }

    return () => {
      document.removeEventListener('wheel', onWheel, { capture: true } as any);
      document.removeEventListener('gesturestart', onGestureStart as any);
      document.removeEventListener('gesturechange', onGestureChange as any);
      document.removeEventListener('gestureend', onGestureEnd as any);
      document.removeEventListener('keydown', onKey, { capture: true } as any);
      if (meta && prevViewport) {
        meta.setAttribute('content', prevViewport);
      }
    };
  }, [zoom]);

  const [showEnfoque, setShowEnfoque] = useState(false);
  const [openTeorico, setOpenTeorico] = useState(false);
  const [showSeleccion, setShowSeleccion] = useState(false);
  const [enfoqueElegido, setEnfoqueElegido] = useState<'teorico' | 'matematico' | 'mixto' | 'practico' | 'practico' | null>(null);
  const [seleccionResult, setSeleccionResult] = useState<SeleccionResult[] | null>(null);
  const [contextMenu, setContextMenu] = useState<any>(null);
  const [vp, setVp] = useState({ w: 1400, h: 900 });

  const dragState = useRef<{ active: boolean; startX: number; startY: number; startPan: { x: number; y: number } }>({
    active: false, startX: 0, startY: 0, startPan: { x: 0, y: 0 },
  });

  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
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
    const handleUp = () => { dragState.current.active = false; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const themeColor = tema.color || materia.color || '#5eead4';
  const cuadernoColor = '#5eead4';
  const materialColor = '#a78bfa';

  const nodes = useMemo(() => {
    const list: any[] = [];
    const cOpen = expanded.includes('cuaderno');
    const mOpen = expanded.includes('material');

    list.push({
      id: 'center', x: 0, y: 0,
      emoji: '📖', label: tema.nombre,
      sublabel: `~ ${tema.apuntes.length} apuntes · ${tema.documentos.length} docs ~`,
      color: themeColor, size: 140, type: 'root',
    });

    list.push({
      id: 'cuaderno', x: -300, y: 0,
      emoji: '📓', label: 'Cuaderno',
      sublabel: cOpen ? '~ click para cerrar ~' : '~ click para abrir ~',
      color: cuadernoColor, size: 120, type: 'hub',
    });

    if (cOpen) {
      const cuadernoItems = [
        { id: 'rama-apuntes', emoji: '📝', label: 'Apuntes', enabled: true },
        { id: 'rama-pres', emoji: '📊', label: 'Presentación', enabled: false },
        { id: 'rama-ensayo', emoji: '📜', label: 'Ensayo', enabled: false },
        { id: 'rama-grupal', emoji: '🤝', label: 'Doc. Grupal', enabled: false },
      ];
      const ramaCuadernoDist = 220;
      cuadernoItems.forEach((item, i) => {
        const angleDeg = 180 + (i - 1.5) * 35;
        const angle = angleDeg * (Math.PI / 180);
        list.push({
          id: item.id,
          x: -300 + Math.cos(angle) * ramaCuadernoDist,
          y: Math.sin(angle) * ramaCuadernoDist,
          emoji: item.emoji,
          label: item.label,
          color: item.enabled ? cuadernoColor : '#555',
          size: 100,
          type: 'rama',
          disabled: !item.enabled,
          action: item.id === 'rama-apuntes' ? onNuevoApunte : undefined,
        });
      });

      if (tema.apuntes.length > 0) {
        const apunteRama = {
          x: -300 + Math.cos((180 - 0.5 * 35) * Math.PI / 180) * ramaCuadernoDist,
          y: Math.sin((180 - 0.5 * 35) * Math.PI / 180) * ramaCuadernoDist,
        };
        const n = tema.apuntes.length;
        const arcSpread = Math.min(120, 30 + n * 15);
        const startAngle = 180 - arcSpread / 2;
        const dist = 180;
        tema.apuntes.forEach((a: any, i: number) => {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const angleDeg = startAngle + t * arcSpread;
          const angle = angleDeg * (Math.PI / 180);
          list.push({
            id: `a-${a.id}`,
            x: apunteRama.x + Math.cos(angle) * dist,
            y: apunteRama.y + Math.sin(angle) * dist,
            emoji: '📝',
            label: a.titulo,
            color: cuadernoColor,
            size: 95,
            type: 'apunte',
            data: a,
          });
        });
      }
    }

    list.push({
      id: 'material', x: 300, y: 0,
      emoji: '📂', label: 'Material',
      sublabel: mOpen ? '~ click para cerrar ~' : '~ click para abrir ~',
      color: materialColor, size: 120, type: 'hub',
    });

    if (mOpen) {
      const materialItems = [
        { id: 'rama-subir', emoji: '📎', label: 'Subir Archivo', enabled: true, action: () => onAbrirUploader?.() },
        { id: 'rama-yt', emoji: '▶️', label: 'YouTube', enabled: false },
      ];
      const ramaMaterialDist = 220;
      materialItems.forEach((item, i) => {
        const angleDeg = (i - 0.5) * 50;
        const angle = angleDeg * (Math.PI / 180);
        list.push({
          id: item.id,
          x: 300 + Math.cos(angle) * ramaMaterialDist,
          y: Math.sin(angle) * ramaMaterialDist,
          emoji: item.emoji,
          label: item.label,
          color: item.enabled ? materialColor : '#555',
          size: 100,
          type: 'rama',
          disabled: !item.enabled,
          action: item.action,
        });
      });

      if (tema.documentos.length > 0) {
        const subirRama = {
          x: 300 + Math.cos((-0.5 * 50) * Math.PI / 180) * ramaMaterialDist,
          y: Math.sin((-0.5 * 50) * Math.PI / 180) * ramaMaterialDist,
        };
        const n = tema.documentos.length;
        const arcSpread = Math.min(130, 40 + n * 18);
        const startAngle = -arcSpread / 2;
        const dist = 180;
        tema.documentos.forEach((d: any, i: number) => {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const angleDeg = startAngle + t * arcSpread;
          const angle = angleDeg * (Math.PI / 180);
          const sel = selectedIds.includes(d.id);
          // ── Buscar sesiones activas para este material ──
          const matSessions = activeSessions.filter(s => s.materialIds.includes(d.id));
          list.push({
            id: `d-${d.id}`,
            x: subirRama.x + Math.cos(angle) * dist,
            y: subirRama.y + Math.sin(angle) * dist,
            emoji: getDocEmoji(d),
            label: d.nombre,
            color: materialColor,
            size: 95,
            type: 'doc',
            data: d,
            selected: sel,
            hasSession: matSessions.length > 0,
            sessions: matSessions,
          });
        });
      }
    }

    return list;
  }, [tema, expanded, selectedIds, themeColor, activeSessions]);

  const rawConns = useMemo(() => {
    const c: { f: string; t: string }[] = [
      { f: 'center', t: 'cuaderno' },
      { f: 'center', t: 'material' },
    ];
    if (expanded.includes('cuaderno')) {
      ['rama-apuntes', 'rama-pres', 'rama-ensayo', 'rama-grupal'].forEach(id => c.push({ f: 'cuaderno', t: id }));
      tema.apuntes.forEach((a: any) => c.push({ f: 'rama-apuntes', t: `a-${a.id}` }));
    }
    if (expanded.includes('material')) {
      ['rama-subir', 'rama-yt'].forEach(id => c.push({ f: 'material', t: id }));
      tema.documentos.forEach((d: any) => c.push({ f: 'rama-subir', t: `d-${d.id}` }));
    }
    return c;
  }, [tema, expanded]);

  const curves = useMemo(() => {
    return rawConns.map(c => {
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
        f, t,
        fromX: f.x, fromY: f.y,
        ctrlX, ctrlY,
        toX: t.x, toY: t.y,
        color: t.color || f.color,
        pathD: `M ${f.x} ${f.y} Q ${ctrlX} ${ctrlY} ${t.x} ${t.y}`,
      };
    }).filter(Boolean) as any[];
  }, [rawConns, nodes]);

  const transform = useMemo(() => ({
    offsetX: vp.w / 2 + pan.x,
    offsetY: vp.h / 2 + pan.y,
    scale: zoom,
  }), [vp, pan, zoom]);

  const energyLines: CurveLine[] = useMemo(() => {
    return curves.map(c => {
      const isActive = hoveredNode === c.t.id || hoveredNode === c.f.id || !!c.t.selected || expanded.includes(c.t.id);
      return {
        key: c.connKey,
        fromX: c.fromX, fromY: c.fromY,
        ctrlX: c.ctrlX, ctrlY: c.ctrlY,
        toX: c.toX, toY: c.toY,
        color: c.color,
        active: isActive,
      };
    });
  }, [curves, hoveredNode, expanded]);

  useEnergyEngine(canvasRef, chargeState, energyLines, transform);

  const fitToView = () => {
    if (nodes.length === 0) return;
    const padding = 100;
    const minX = Math.min(...nodes.map((n: any) => n.x - n.size / 2));
    const maxX = Math.max(...nodes.map((n: any) => n.x + n.size / 2));
    const minY = Math.min(...nodes.map((n: any) => n.y - n.size / 2));
    const maxY = Math.max(...nodes.map((n: any) => n.y + n.size / 2));
    const w = maxX - minX + padding * 2;
    const h = maxY - minY + padding * 2;
    const availableW = vp.w - 100;
    const availableH = vp.h - 200;
    const scaleX = availableW / w;
    const scaleY = availableH / h;
    const newZoom = Math.min(scaleX, scaleY, 1);
    setZoom(Math.max(newZoom, 0.3));
    setPan({
      x: -(minX + maxX) / 2 * newZoom,
      y: -(minY + maxY) / 2 * newZoom,
    });
  };

  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded.join(','), tema.apuntes.length, tema.documentos.length]);

  const handleNodeClick = (n: any) => {
    if (n.id === 'cuaderno' || n.id === 'material') {
      setExpanded(prev => prev.includes(n.id) ? prev.filter(x => x !== n.id) : [...prev, n.id]);
      return;
    }
    if (n.disabled) return;
    if (n.action) { n.action(); return; }
    if (n.type === 'apunte') { onAbrirApunte(n.data); return; }
    if (n.type === 'doc') {
      // ── Toggle inteligente con sesiones ──
      const matId = n.data.id;
      const matSessions = activeSessions.filter(s => s.materialIds.includes(matId));
      const clickedSession = matSessions[0] || null;

      setSelectedIds(prev => {
        // ¿La selección actual coincide con alguna sesión completa?
        const currentMatchesSession = activeSessions.find(s => {
          if (s.materialIds.length !== prev.length) return false;
          const setA = new Set(s.materialIds);
          return prev.every(id => setA.has(id));
        });

        // CASO A: el material clickeado pertenece a una sesión
        if (clickedSession) {
          const sessionIds = clickedSession.materialIds;
          const isFullSessionSelected = sessionIds.length === prev.length
            && sessionIds.every(id => prev.includes(id));

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
        return prev.includes(matId)
          ? prev.filter(x => x !== matId)
          : prev.length < 5 ? [...prev, matId] : prev;
      });
    }
  };

  if (openTeorico) return (
    <TeoricoWorkspace
      materiales={tema.documentos.filter((d: any) => selectedIds.includes(d.id))}
      onClose={() => { setOpenTeorico(false); setSeleccionResult(null); setEnfoqueElegido(null); setResumeSessionId(null); refreshSessions(); }}
      onOpenFlashcards={() => {
              const matsSeleccionados = tema.documentos.filter((d: any) => selectedIds.includes(d.id));
              const rawSel = Array.isArray(seleccionResult) ? seleccionResult : [];

              const normalizePages = (value: any): number[] => {
                if (Array.isArray(value)) {
                  return Array.from(new Set(
                    value.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
                  )).sort((a: number, b: number) => a - b);
                }

                if (value && typeof value === 'object') {
                  const start = Number(
                    value.start ?? value.from ?? value.startPage ?? value.paginaInicial
                  );
                  const end = Number(
                    value.end ?? value.to ?? value.endPage ?? value.paginaFinal
                  );

                  if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
                    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
                  }
                }

                return [];
              };

              const normalizedSel = matsSeleccionados
                .map((mat: any, idx: number) => {
                  const matMaterialId = String(mat?.materialId || mat?.material_id || mat?.id || '');
                  const matDocumentId = String(mat?.id || '');

                  const rawByMaterialIndex =
                    rawSel.find((candidate: any) => Number(candidate?.materialIndex) === idx) || null;

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

                      return candidateIds.includes(matMaterialId) || candidateIds.includes(matDocumentId);
                    }) || null;

                  const item: any = rawByMaterialIndex ?? rawById ?? rawSel[idx] ?? null;
                  if (!item) return null;

                  const pages = [
                    item?.pages,
                    item?.selectedPages,
                    item?.paginasSeleccionadas,
                    item?.paginas,
                    item?.pageNumbers,
                    item?.range,
                    item?.selection,
                  ]
                    .map(normalizePages)
                    .find((arr: any) => Array.isArray(arr) && arr.length > 0) || [];

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

              console.log('📑 RAW seleccionResult:', rawSel);
              console.log('✅ NORMALIZED seleccionResult:', normalizedSel);
              console.log('📘 matsSeleccionados:', matsSeleccionados.map((m: any) => m.materialId || m.id));

              // ── Guardar sesión de estudio para persistencia ──
              let savedSessionId: string | null = null;
              try {
                const pagesByMat: Record<string, number[]> = {};
                normalizedSel.forEach((n: any) => {
                  if (n?.materialId && Array.isArray(n.pages) && n.pages.length > 0) {
                    pagesByMat[n.materialId] = n.pages;
                  }
                });
                const matIds = matsSeleccionados
                  .map((m: any) => m?.materialId || m?.id)
                  .filter(Boolean) as string[];

                if (tema?.id && enfoqueElegido && matIds.length > 0) {
                  const sess = upsertSession({
                    temaId: tema.id,
                    enfoque: enfoqueElegido as any,
                    materialIds: matIds,
                    selectedPages: Object.keys(pagesByMat).length ? pagesByMat : undefined,
                  });
                  savedSessionId = sess.id;
                  refreshSessions();
                  console.log('💾 [TemaView] Sesión upsertada:', sess.id, '| flashcards en cache:', sess.flashcards?.length || 0);
                }
              } catch (e) {
                console.warn('Error guardando sesión:', e);
              }

              onOpenFlashcards?.(
                matsSeleccionados,
                normalizedSel.length ? normalizedSel : undefined,
                resumeSessionId || savedSessionId
              );
            }}
      onOpenQuiz={() => {
              const matsSeleccionados = tema.documentos.filter((d: any) => selectedIds.includes(d.id));
              const rawSel = Array.isArray(seleccionResult) ? seleccionResult : [];

              const normalizePages = (value: any): number[] => {
                if (Array.isArray(value)) {
                  return Array.from(new Set(
                    value.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
                  )).sort((a: number, b: number) => a - b);
                }
                if (value && typeof value === 'object') {
                  const start = Number(value.start ?? value.from ?? value.startPage ?? value.paginaInicial);
                  const end   = Number(value.end   ?? value.to   ?? value.endPage   ?? value.paginaFinal);
                  if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
                    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
                  }
                }
                return [];
              };

              const normalizedSel = matsSeleccionados
                .map((mat: any, idx: number) => {
                  const matMaterialId = String(mat?.materialId || mat?.material_id || mat?.id || '');
                  const matDocumentId = String(mat?.id || '');
                  const rawByIndex = rawSel.find((c: any) => Number(c?.materialIndex) === idx) || null;
                  const rawById    = rawSel.find((c: any) => {
                    const ids = [c?.materialId, c?.material_id, c?.documentId, c?.id]
                      .filter(Boolean).map((v: any) => String(v));
                    return ids.includes(matMaterialId) || ids.includes(matDocumentId);
                  }) || null;
                  const item: any = rawByIndex ?? rawById ?? rawSel[idx] ?? null;
                  if (!item) return null;
                  const pages = [item?.pages, item?.selectedPages, item?.paginas, item?.range]
                    .map(normalizePages)
                    .find((arr: any) => Array.isArray(arr) && arr.length > 0) || [];
                  const text = item?.text || item?.texto || item?.content || undefined;
                  if (!pages.length && !text) return null;
                  return { materialId: matMaterialId, documentId: matDocumentId, materialIndex: idx, pages, text };
                })
                .filter(Boolean);

              onOpenQuiz?.(matsSeleccionados, normalizedSel.length ? normalizedSel : undefined);
            }}
      onOpenRepasar={() => {
              const matsSeleccionados = tema.documentos.filter((d: any) => selectedIds.includes(d.id));
              const rawSel = Array.isArray(seleccionResult) ? seleccionResult : [];

              const normalizePages = (value: any): number[] => {
                if (Array.isArray(value)) {
                  return Array.from(new Set(
                    value.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
                  )).sort((a: number, b: number) => a - b);
                }
                if (value && typeof value === 'object') {
                  const start = Number(value.start ?? value.from ?? value.startPage ?? value.paginaInicial);
                  const end   = Number(value.end   ?? value.to   ?? value.endPage   ?? value.paginaFinal);
                  if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
                    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
                  }
                }
                return [];
              };

              const normalizedSel = matsSeleccionados
                .map((mat: any, idx: number) => {
                  const matMaterialId = String(mat?.materialId || mat?.material_id || mat?.id || '');
                  const matDocumentId = String(mat?.id || '');
                  const rawByIndex = rawSel.find((c: any) => Number(c?.materialIndex) === idx) || null;
                  const rawById = rawSel.find((c: any) => {
                    const ids = [c?.materialId, c?.material_id, c?.documentId, c?.id]
                      .filter(Boolean)
                      .map((v: any) => String(v));
                    return ids.includes(matMaterialId) || ids.includes(matDocumentId);
                  }) || null;
                  const item: any = rawByIndex ?? rawById ?? rawSel[idx] ?? null;
                  if (!item) return null;

                  const pages = [item?.pages, item?.selectedPages, item?.paginas, item?.range]
                    .map(normalizePages)
                    .find((arr: any) => Array.isArray(arr) && arr.length > 0) || [];

                  const text = item?.text || item?.texto || item?.content || item?.contenido || item?.selectedText || undefined;
                  if (!pages.length && !text) return null;

                  return { materialId: matMaterialId, documentId: matDocumentId, materialIndex: idx, pages, text };
                })
                .filter(Boolean);

              onOpenRepasar?.(matsSeleccionados, normalizedSel.length ? normalizedSel : undefined);
            }}
      onComingSoon={() => {}}
    />
  );

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#0a0a0c',
      overflow: 'hidden',
      color: '#fff',
      fontFamily: HAND,
    }}>
      {/* Fondo cuaderno */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(to bottom, transparent 0, transparent 47px, rgba(255,255,255,0.04) 47px, rgba(255,255,255,0.04) 48px, transparent 48px)`,
        backgroundSize: '100% 48px',
        pointerEvents: 'none', zIndex: 0,
      }} />
      <div style={{
        position: 'absolute', left: 80, top: 0, bottom: 0,
        width: 1.5,
        background: 'rgba(239,68,68,0.5)',
        boxShadow: '0 0 8px rgba(239,68,68,0.3)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }} />
      <input ref={fileRef} type="file" hidden multiple accept="application/pdf,.pdf,.docx,.txt,image/*" onChange={handleArchivoValidado} />
      {modalArchivo && (
        <ModalConvertirPDF
          fileName={modalArchivo.nombre}
          fileType={modalArchivo.tipo}
          onCerrar={() => setModalArchivo(null)}
        />
      )}

      {subiendoDoc && (
        <div style={{
          position: 'fixed', top: 90, left: '50%',
          transform: 'translateX(-50%)', zIndex: 10000,
          background: 'rgba(245,200,66,0.1)',
          border: '1px solid rgba(245,200,66,0.4)',
          padding: '10px 26px', borderRadius: 40,
          backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ width: 16, height: 16, border: '2.5px solid #f5c842', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontWeight: 700, color: '#f5c842', fontSize: 18 }}>cargando...</span>
        </div>
      )}

      {/* TOP BAR */}
      <div style={{
        position: 'fixed', top: 12, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        gap: 12, zIndex: 1000, pointerEvents: 'none',
      }}>
        <button onClick={() => onGoHome && onGoHome()} style={{
          background: '#0d0d10',
          border: `1.5px solid ${cuadernoColor}`,
          padding: '6px 20px', borderRadius: 12,
          color: cuadernoColor, cursor: 'pointer',
          fontFamily: BODY, fontSize: 18, fontWeight: 600,
          boxShadow: `0 0 10px ${cuadernoColor}33`,
          pointerEvents: 'auto',
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 0 18px ${cuadernoColor}88`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = `0 0 10px ${cuadernoColor}33`; }}
        >← inicio</button>
      </div>

      {/* BREADCRUMB */}
      <div style={{
        position: 'fixed', top: 56, left: 16, zIndex: 1000,
        background: '#0d0d10',
        border: '1.5px solid rgba(255,255,255,0.12)',
        padding: '6px 16px', borderRadius: 30,
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 17, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        maxWidth: 'calc(50vw - 220px)',
        overflow: 'hidden',
      }}>
        {/* 🏠 → mis materias */}
        <button
          onClick={() => onBack && onBack()}
          title="Mis materias"
          style={{
            background: 'transparent', border: 'none', padding: 0, margin: 0,
            cursor: 'pointer', fontSize: 18, lineHeight: 1,
            transition: 'transform 0.2s, filter 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.18)'; e.currentTarget.style.filter = 'drop-shadow(0 0 6px rgba(245,200,66,0.8))'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.filter = 'none'; }}
        >🏠</button>
        <span style={{ opacity: 0.4 }}>›</span>
        {/* Nombre materia → vista materia (lista de temas) */}
        <button
          onClick={() => onBackMateria && onBackMateria()}
          title={`Volver a ${materia.nombre}`}
          style={{
            background: 'transparent', border: 'none', padding: 0, margin: 0,
            cursor: 'pointer', color: '#fff',
            fontFamily: BODY, fontSize: 17, fontWeight: 600,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: 200,
            transition: 'color 0.2s, text-shadow 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#f5c842'; e.currentTarget.style.textShadow = '0 0 8px rgba(245,200,66,0.6)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.textShadow = 'none'; }}
        >{materia.emoji} {materia.nombre}</button>
        <span style={{ opacity: 0.4 }}>›</span>
        <span style={{
          color: themeColor, fontWeight: 700,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: 180,
        }}>
          {tema.nombre}
        </span>
      </div>

      {/* TIPS */}
      <div style={{
        position: 'fixed', top: 56, left: '50%',
        transform: 'translateX(-50%)', zIndex: 1000,
        display: 'flex', gap: 6, fontSize: 13,
        flexWrap: 'wrap', justifyContent: 'center',
        maxWidth: 'calc(100vw - 500px)',
      }}>
        {[
          { ico: '🖱️', t: 'scroll → zoom' },
          { ico: '✋', t: 'drag → mover' },
          { ico: '👆', t: 'click → expandir' },
        ].map((tip, i) => (
          <div key={i} style={{
            background: '#0d0d10',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '4px 10px', borderRadius: 20,
            display: 'flex', alignItems: 'center', gap: 5,
            color: 'rgba(255,255,255,0.7)',
            whiteSpace: 'nowrap',
          }}>
            <span>{tip.ico}</span><span>{tip.t}</span>
          </div>
        ))}
      </div>

      {/* SYNC */}
      <div style={{
        position: 'fixed', top: 20, right: 16, zIndex: 1000,
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 16, color: 'rgba(255,255,255,0.7)',
        background: '#0d0d10',
        border: '1px solid rgba(255,255,255,0.1)',
        padding: '4px 12px', borderRadius: 20,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
        Sincronizado
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* BOTÓN ESTUDIAR — REDISEÑO ÉPICO                        */}
      {/* ═══════════════════════════════════════════════════════ */}
      {selectedIds.length > 0 && (() => {
        // ── Detectar si la selección actual coincide con una sesión guardada ──
        const matchingSession = activeSessions.find(s => {
          if (s.materialIds.length !== selectedIds.length) return false;
          const setA = new Set(s.materialIds);
          return selectedIds.every(id => setA.has(id));
        });
        const isResumeMode = !!matchingSession;
        return (
  <div style={{
    position: 'fixed', bottom: 32, left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    animation: 'studyBtnIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 8,
  }}>
    {/* Texto guía arriba */}
    <div style={{
      fontFamily: HAND,
      fontSize: 15,
      color: isResumeMode ? '#f5c842' : 'var(--red)',
      fontStyle: 'italic',
      opacity: 0.85,
      textShadow: isResumeMode ? '0 0 8px #f5c842' : '0 0 8px var(--red)',
      letterSpacing: 0.5,
    }}>
      {isResumeMode ? '↓ continuar donde lo dejaste ↓' : '↓ dale al play ↓'}
    </div>

    {/* Row: Eliminar + Estudiar */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>

    {/* BOTÓN ELIMINAR */}
    <button
      onClick={() => setDeleteConfirmOpen(true)}
      title={selectedIds.length === 1 ? 'Eliminar material' : `Eliminar ${selectedIds.length} materiales`}
      style={{
        position: 'relative',
        background: 'linear-gradient(135deg, rgba(20,20,25,0.95), rgba(40,15,15,0.95))',
        color: '#fff',
        border: '2px solid rgba(255,68,68,0.6)',
        padding: '14px 18px',
        borderRadius: 16,
        fontFamily: HAND,
        fontSize: 22,
        fontWeight: 800,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 0 0 1px rgba(255,68,68,0.2), 0 0 16px rgba(255,68,68,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
        transition: 'all 0.3s cubic-bezier(.2,.8,.2,1)',
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(8px)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,68,68,0.5), 0 0 24px rgba(255,68,68,0.6), inset 0 1px 0 rgba(255,255,255,0.08)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,68,68,0.2), 0 0 16px rgba(255,68,68,0.35), inset 0 1px 0 rgba(255,255,255,0.08)';
      }}
    >
      <span style={{ fontSize: 22 }}>🗑️</span>
      <span style={{
        color: '#ff8888',
        textShadow: '0 0 8px rgba(255,68,68,0.5)',
      }}>eliminar</span>
    </button>

    {/* BOTÓN ESTUDIAR / SEGUIR */}
    <button
      onClick={() => {
        if (isResumeMode && matchingSession) {
          // ── Saltar directo al enfoque guardado con sus páginas ──
          setEnfoqueElegido(matchingSession.enfoque as any);

          // Sincronizar los materiales seleccionados con los de la sesión reanudada
          const matIds = matchingSession.materialIds || [];
          setSelectedIds(matIds.map((id: string) => {
            const doc = tema.documentos?.find((d: any) => (d.materialId || d.id) === id);
            return doc?.id || id;
          }).filter(Boolean));
          if (matchingSession.selectedPages) {
            const rebuilt = matchingSession.materialIds.map((matId: string, idx: number) => ({
              materialId: matId,
              materialIndex: idx,
              pages: matchingSession.selectedPages![matId] || [],
            }));
            setSeleccionResult(rebuilt as any);
          }
          // Guardar sessionId para que ALAIStudyALCards pueda cargar el cache
          setResumeSessionId(matchingSession.id);
          setOpenTeorico(true);
          console.log('🔁 Continuando sesión:', matchingSession.id);
        } else {
          setResumeSessionId(null);
          setShowEnfoque(true);
        }
      }}
      className="study-btn-neon"
      style={{
        position: 'relative',
        background: isResumeMode
          ? 'linear-gradient(135deg, rgba(25,20,15,0.95), rgba(45,35,10,0.95))'
          : 'linear-gradient(135deg, rgba(20,20,25,0.95), rgba(40,15,20,0.95))',
        color: '#fff',
        border: isResumeMode ? '2px solid #f5c842' : '2px solid var(--red)',
        padding: '16px 32px',
        borderRadius: 16,
        fontFamily: HAND,
        fontSize: 28,
        fontWeight: 800,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: isResumeMode
          ? '0 0 0 1px rgba(245,200,66,0.35), 0 0 20px rgba(245,200,66,0.5), 0 0 40px rgba(245,200,66,0.25), inset 0 1px 0 rgba(255,255,255,0.1)'
          : '0 0 0 1px rgba(239,68,68,0.3), 0 0 20px rgba(239,68,68,0.5), 0 0 40px rgba(239,68,68,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
        transition: 'all 0.3s cubic-bezier(.2,.8,.2,1)',
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span style={{
        fontSize: 26,
        filter: 'drop-shadow(0 0 6px rgba(245,200,66,0.7))',
        animation: 'sparkle 2s ease-in-out infinite',
        display: 'inline-block',
      }}>{isResumeMode ? '📖' : '✨'}</span>

      <span style={{
        letterSpacing: 0.3,
        textShadow: isResumeMode
          ? '0 0 10px rgba(245,200,66,0.6), 0 1px 2px rgba(0,0,0,0.5)'
          : '0 0 10px rgba(239,68,68,0.6), 0 1px 2px rgba(0,0,0,0.5)',
        background: isResumeMode
          ? 'linear-gradient(135deg, #fff, #fff5d0)'
          : 'linear-gradient(135deg, #fff, #ffd6d6)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}>{isResumeMode ? 'seguir estudiando' : 'empezar a estudiar'}</span>

      <span style={{
        background: 'rgba(239,68,68,0.15)',
        color: 'var(--red)',
        padding: '4px 12px',
        borderRadius: 20,
        fontSize: 18,
        fontWeight: 800,
        fontFamily: HAND,
        border: '1.5px solid var(--red)',
        boxShadow: '0 0 12px rgba(239,68,68,0.4), inset 0 0 8px rgba(239,68,68,0.2)',
        minWidth: 42,
        textAlign: 'center',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        textShadow: '0 0 6px rgba(239,68,68,0.8)',
      }}>{isResumeMode ? matchingSession?.enfoque || 'teorico' : `${selectedIds.length}/5`}</span>

      <span style={{
        fontSize: 22,
        color: 'var(--red)',
        filter: 'drop-shadow(0 0 6px var(--red))',
        animation: 'arrowSlide 1.5s ease-in-out infinite',
        display: 'inline-block',
      }}>→</span>
    </button>
    </div>
  </div>
);
      })()}

      {/* ZOOM CONTROLS */}
      <div style={{
        position: 'fixed', bottom: 16, right: 16, zIndex: 200,
        display: 'flex', alignItems: 'center', gap: 4,
        background: '#0d0d10',
        border: '1px solid rgba(255,255,255,0.2)',
        padding: 4, borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
      }}>
        <button onClick={() => setZoom(z => Math.max(z * 0.85, 0.5))} style={zoomBtn} title="Zoom out">−</button>
        <div style={{
          minWidth: 44, textAlign: 'center',
          fontSize: 14, color: '#fff', fontWeight: 600,
          fontFamily: BODY,
        }}>{Math.round(zoom * 100)}%</div>
        <button onClick={() => setZoom(z => Math.min(z * 1.18, 1.4))} style={zoomBtn} title="Zoom in">+</button>
        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />
        <button onClick={fitToView} style={zoomBtn} title="Ajustar a pantalla">⊡</button>
      </div>

      {/* ZOOM LABEL */}
      <div style={{
        position: 'fixed', bottom: 16, left: 16, zIndex: 200,
        background: '#0d0d10',
        border: '1px solid rgba(255,255,255,0.15)',
        padding: '6px 14px', borderRadius: 10,
        fontSize: 14, fontFamily: BODY,
        display: 'flex', alignItems: 'center', gap: 6,
        color: 'rgba(255,255,255,0.7)',
      }}>
        🔍 {Math.round(zoom * 100)}%
      </div>

      {/* ÁREA INTERACTIVA */}
      <div
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest('.node')) return;
          if ((e.target as HTMLElement).closest('button')) return;
          dragState.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            startPan: { ...pan },
          };
          document.body.style.cursor = 'grabbing';
        }}
        onWheel={e => {
          e.preventDefault();
          const delta = e.deltaY > 0 ? 0.92 : 1.08;
          setZoom(z => Math.min(Math.max(z * delta, 0.5), 1.4));
        }}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: 'grab',
          zIndex: 2,
        }}
      >
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <g transform={`translate(${transform.offsetX}, ${transform.offsetY}) scale(${transform.scale})`}>
            {curves.map((c, i) => (
              <path key={i} d={c.pathD}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={1.6}
                strokeDasharray="3 5"
                fill="none"
              />
            ))}
          </g>
        </svg>

        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          pointerEvents: 'none',
        }}>
          {nodes.map((n: any) => {
            const isH = hoveredNode === n.id;
            const isRoot = n.type === 'root';
            const isHub = n.type === 'hub';
            const isExpanded = expanded.includes(n.id);
            const pal = paperPalette(n.id, n.type);
            const variant = pal.variant;
            const rotBase = paperRot(n.id);
            const rot = n.selected ? 0 : (isH ? rotBase * 0.25 : rotBase);
            const scale = isH ? 1.07 : 1;
            const lift = (isH || n.selected) ? -3 : 0;

            // Dimensiones por variante (rompemos uniformidad)
            let cardW = n.size, cardH = (isRoot || isHub) ? n.size + 20 : n.size;
            let borderRad = 6;
            if (variant === 'libreta-abierta')      { cardW = n.size * 1.75; cardH = n.size * 1.05; borderRad = 8; }
            else if (variant === 'tag-grande')        { cardW = n.size * 1.6; cardH = n.size * 0.9; borderRad = 8; }
            else if (variant === 'cuaderno-libro') { cardW = n.size * 0.92; cardH = n.size * 1.1; borderRad = 4; }
            else if (variant === 'carpeta-folder') { cardW = n.size * 1.1; cardH = n.size * 0.95; borderRad = 4; }
            else if (variant === 'ticket-rojo')   { cardW = n.size * 1.15; cardH = n.size * 0.7; borderRad = 2; }
            else if (variant === 'sticker-clip')  { cardW = n.size; cardH = n.size; borderRad = 50; }
            else if (variant === 'postit-arrugado') { cardW = n.size; cardH = n.size * 0.95; borderRad = 3; }
            else if (variant === 'hoja-papel')    { cardW = n.size * 0.9; cardH = n.size * 1.15; borderRad = 2; }

            const emojiSize = isRoot ? 40 : isHub ? 36 : 28;
            const labelSize = isRoot ? 24 : isHub ? 21 : 16;

            // Sombra común (con glow dorado si tiene sesión activa)
            const goldGlow = n.hasSession
              ? `0 0 0 2.5px #f5c842, 0 0 24px rgba(245,200,66,0.55), 0 0 48px rgba(245,200,66,0.25),`
              : '';
            const baseShadow = n.selected
              ? `${goldGlow} 0 0 0 3px ${pal.ink}, 0 14px 32px ${pal.shadow}, 0 6px 12px rgba(0,0,0,0.5)`
              : isH
                ? `${goldGlow} 0 18px 38px rgba(0,0,0,0.55), 0 8px 16px ${pal.shadow}`
                : `${goldGlow} 0 8px 20px rgba(0,0,0,0.5), 0 3px 6px rgba(0,0,0,0.3)`;

            return (
              <div key={n.id} className={`node paper-card variant-${variant}`}
                onClick={(e) => { e.stopPropagation(); handleNodeClick(n); }}
                onMouseDown={e => e.stopPropagation()}
                onContextMenu={e => {
                  if (n.type === 'apunte' || n.type === 'doc') {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ node: n, x: e.clientX, y: e.clientY });
                  }
                }}
                onMouseEnter={() => setHoveredNode(n.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{
                  position: 'absolute',
                  left: n.x, top: n.y,
                  width: cardW,
                  minHeight: cardH,
                  transform: `translate(-50%, calc(-50% + ${lift}px)) scale(${scale}) rotate(${rot}deg)`,
                  background: variant === 'libreta-abierta'
                    ? `linear-gradient(90deg, color-mix(in srgb, ${pal.paper} 92%, #000) 0%, ${pal.paper} 3%, ${pal.paper} 48%, color-mix(in srgb, ${pal.ink} 18%, transparent) 49.5%, color-mix(in srgb, ${pal.ink} 28%, transparent) 50%, color-mix(in srgb, ${pal.ink} 18%, transparent) 50.5%, ${pal.paper} 52%, ${pal.paper} 97%, color-mix(in srgb, ${pal.paper} 92%, #000) 100%)`
                    : variant === 'sticker-clip'
                    ? `radial-gradient(circle at 30% 30%, color-mix(in srgb, ${pal.paper} 100%, #fff 8%) 0%, ${pal.paper} 50%, color-mix(in srgb, ${pal.paper} 85%, #000) 100%)`
                    : variant === 'cuaderno-libro'
                      ? `linear-gradient(90deg, color-mix(in srgb, ${pal.paper} 70%, #000) 0%, color-mix(in srgb, ${pal.paper} 70%, #000) 16%, ${pal.paper} 16%, ${pal.paper} 100%)`
                      : variant === 'carpeta-folder'
                        ? `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 92%, #000) 100%)`
                        : variant === 'ticket-rojo'
                          ? `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 88%, #000) 100%)`
                          : variant === 'hoja-papel'
                            ? `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 96%, #000) 100%)`
                            : variant === 'postit-arrugado'
                              ? `linear-gradient(135deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 92%, #fff) 50%, color-mix(in srgb, ${pal.paper} 90%, #000) 100%)`
                              : variant === 'tag-grande'
                                ? `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 90%, #000) 100%)`
                                : pal.paper,
                  border: variant === 'sticker-clip'
                    ? `2px solid color-mix(in srgb, ${pal.ink} 25%, transparent)`
                    : `1px solid color-mix(in srgb, ${pal.ink} 30%, transparent)`,
                  borderRadius: borderRad,
                  padding: variant === 'cuaderno-libro' ? '12px 10px 12px 22px' : variant === 'hoja-papel' ? '14px 12px 12px' : '14px 10px 12px',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center',
                  cursor: n.disabled ? 'not-allowed' : 'pointer',
                  opacity: n.disabled ? 0.55 : 1,
                  boxShadow: baseShadow,
                  transition: 'transform 0.28s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.25s, border-color 0.25s',
                  zIndex: n.selected ? 30 : (isH ? 20 : 10),
                  overflow: 'visible',
                  pointerEvents: 'auto',
                }}
              >
                {/* ════════ ELEMENTOS POR VARIANTE ════════ */}

                {/* LIBRETA-ABIERTA (root): dos páginas con líneas, lomo fino, marcador */}
                {variant === 'libreta-abierta' && (
                  <>
                    {/* Líneas horizontales SUTILES solo en zonas laterales (no cruzan el lomo) */}
                    <div style={{
                      position: 'absolute',
                      top: 38, bottom: 28, left: '7%', width: '38%',
                      backgroundImage: `repeating-linear-gradient(180deg, transparent 0 13px, color-mix(in srgb, ${pal.ink} 11%, transparent) 13px 14px)`,
                      pointerEvents: 'none', zIndex: 1,
                      opacity: 0.6,
                    }} />
                    <div style={{
                      position: 'absolute',
                      top: 38, bottom: 28, right: '7%', width: '38%',
                      backgroundImage: `repeating-linear-gradient(180deg, transparent 0 13px, color-mix(in srgb, ${pal.ink} 11%, transparent) 13px 14px)`,
                      pointerEvents: 'none', zIndex: 1,
                      opacity: 0.6,
                    }} />

                    {/* Estrellitas decorativas en las dos esquinas superiores */}
                    <div style={{
                      position: 'absolute', top: 6, left: 12,
                      fontSize: 13, color: pal.ink, opacity: 0.4,
                      pointerEvents: 'none', zIndex: 2,
                      transform: 'rotate(-15deg)',
                      fontFamily: HAND,
                    }}>✦</div>
                    <div style={{
                      position: 'absolute', top: 6, right: 12,
                      fontSize: 13, color: pal.ink, opacity: 0.4,
                      pointerEvents: 'none', zIndex: 2,
                      transform: 'rotate(15deg)',
                      fontFamily: HAND,
                    }}>✦</div>

                    {/* Marcador de lectura — pequeña cinta de tela que cuelga del lomo */}
                    <div style={{
                      position: 'absolute',
                      top: -2, left: '50%',
                      width: 8, height: 22,
                      transform: 'translateX(-50%)',
                      background: 'linear-gradient(180deg, #c2410c 0%, #9a3412 100%)',
                      borderRadius: '0 0 2px 2px',
                      boxShadow: '0 2px 3px rgba(0,0,0,0.35), inset -1px 0 0 rgba(0,0,0,0.2)',
                      pointerEvents: 'none', zIndex: 3,
                    }} />
                    {/* Punta del marcador */}
                    <div style={{
                      position: 'absolute',
                      top: 18, left: '50%',
                      width: 0, height: 0,
                      transform: 'translateX(-50%)',
                      borderLeft: '4px solid transparent',
                      borderRight: '4px solid transparent',
                      borderTop: '5px solid #9a3412',
                      pointerEvents: 'none', zIndex: 3,
                    }} />

                    {/* Etiqueta "tema" arriba como sello */}
                    <div style={{
                      position: 'absolute',
                      top: -11, left: 18,
                      transform: 'rotate(-4deg)',
                      background: '#fef9c3',
                      color: pal.ink,
                      fontSize: 10,
                      fontWeight: 800,
                      fontFamily: HAND,
                      padding: '2px 9px',
                      border: `1.2px solid color-mix(in srgb, ${pal.ink} 30%, transparent)`,
                      borderRadius: 2,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
                      pointerEvents: 'none', zIndex: 4,
                      fontStyle: 'italic',
                    }}>~ tema ~</div>
                  </>
                )}

                {/* TAG-GRANDE (root): doble cinta arriba + agujero izquierda tipo etiqueta */}{/* TAG-GRANDE (root): doble cinta arriba + agujero izquierda tipo etiqueta */}
                {variant === 'tag-grande' && (
                  <>
                    <div style={{
                      position: 'absolute', top: -10, left: '25%',
                      width: 50, height: 16,
                      transform: `translateX(-50%) rotate(-6deg)`,
                      background: 'linear-gradient(180deg, rgba(245,245,240,0.7) 0%, rgba(220,220,210,0.55) 100%)',
                      border: '1px solid rgba(0,0,0,0.12)',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
                      pointerEvents: 'none', zIndex: 3,
                    }} />
                    <div style={{
                      position: 'absolute', top: -10, left: '75%',
                      width: 50, height: 16,
                      transform: `translateX(-50%) rotate(5deg)`,
                      background: 'linear-gradient(180deg, rgba(245,245,240,0.7) 0%, rgba(220,220,210,0.55) 100%)',
                      border: '1px solid rgba(0,0,0,0.12)',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
                      pointerEvents: 'none', zIndex: 3,
                    }} />
                    {/* Agujero refuerzo izquierda */}
                    <div style={{
                      position: 'absolute', left: 8, top: '50%',
                      transform: 'translateY(-50%)',
                      width: 14, height: 14,
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.15)',
                      border: `1.5px solid color-mix(in srgb, ${pal.ink} 35%, transparent)`,
                      pointerEvents: 'none', zIndex: 2,
                    }} />
                  </>
                )}

                {/* CUADERNO-LIBRO: espiral metálica izquierda */}
                {variant === 'cuaderno-libro' && (
                  <div style={{
                    position: 'absolute', left: 6, top: 8, bottom: 8,
                    width: 4,
                    display: 'flex', flexDirection: 'column',
                    justifyContent: 'space-around', alignItems: 'center',
                    pointerEvents: 'none', zIndex: 3,
                  }}>
                    {[0,1,2,3,4,5].map(k => (
                      <div key={k} style={{
                        width: 8, height: 4,
                        background: 'linear-gradient(180deg, #d4d4d8, #71717a)',
                        borderRadius: 2,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.4)',
                      }} />
                    ))}
                  </div>
                )}

                {/* CARPETA-FOLDER: pestaña tab arriba-izquierda */}
                {variant === 'carpeta-folder' && (
                  <div style={{
                    position: 'absolute', top: -12, left: 8,
                    width: cardW * 0.35,
                    height: 14,
                    background: `linear-gradient(180deg, ${pal.paper} 0%, color-mix(in srgb, ${pal.paper} 90%, #000) 100%)`,
                    border: `1px solid color-mix(in srgb, ${pal.ink} 30%, transparent)`,
                    borderBottom: 'none',
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 8,
                    pointerEvents: 'none', zIndex: 1,
                  }} />
                )}

                {/* TICKET-ROJO: bordes dentados + línea perforada */}
                {variant === 'ticket-rojo' && (
                  <>
                    <div style={{
                      position: 'absolute', left: -5, top: '50%',
                      transform: 'translateY(-50%)',
                      width: 10, height: 10,
                      borderRadius: '50%',
                      background: '#000',
                      pointerEvents: 'none', zIndex: 2,
                    }} />
                    <div style={{
                      position: 'absolute', right: -5, top: '50%',
                      transform: 'translateY(-50%)',
                      width: 10, height: 10,
                      borderRadius: '50%',
                      background: '#000',
                      pointerEvents: 'none', zIndex: 2,
                    }} />
                  </>
                )}

                {/* STICKER-CLIP: clip metálico arriba */}
                {variant === 'sticker-clip' && (
                  <div style={{
                    position: 'absolute', top: -16, left: '50%',
                    transform: 'translateX(-50%)',
                    width: 22, height: 32,
                    pointerEvents: 'none', zIndex: 3,
                  }}>
                    <svg width="22" height="32" viewBox="0 0 22 32">
                      <path d="M 6 4 Q 6 0 11 0 Q 16 0 16 4 L 16 22 Q 16 28 11 28 Q 6 28 6 22 L 6 8"
                        stroke="#9ca3af" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                      <path d="M 6 4 Q 6 0 11 0 Q 16 0 16 4 L 16 22 Q 16 28 11 28 Q 6 28 6 22 L 6 8"
                        stroke="#e5e7eb" strokeWidth="1" fill="none" strokeLinecap="round" />
                    </svg>
                  </div>
                )}

                {/* POSTIT-ARRUGADO: cinta + textura de arruga */}
                {variant === 'postit-arrugado' && (
                  <>
                    <div style={{
                      position: 'absolute', top: -8, left: '50%',
                      width: cardW * 0.45, height: 14,
                      transform: `translateX(-50%) rotate(${rotBase * 2}deg)`,
                      background: 'linear-gradient(180deg, rgba(245,245,240,0.6) 0%, rgba(220,220,210,0.5) 100%)',
                      border: '1px solid rgba(0,0,0,0.1)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      pointerEvents: 'none', zIndex: 3,
                    }} />
                    <div style={{
                      position: 'absolute', inset: 0,
                      background: 'repeating-linear-gradient(45deg, transparent 0 8px, rgba(0,0,0,0.03) 8px 9px)',
                      borderRadius: borderRad, pointerEvents: 'none', zIndex: 1,
                    }} />
                  </>
                )}

                {/* HOJA-PAPEL: líneas de cuaderno horizontales + margen rojo izq */}
                {variant === 'hoja-papel' && (
                  <>
                    <div style={{
                      position: 'absolute', inset: 0,
                      backgroundImage: 'repeating-linear-gradient(180deg, transparent 0 14px, rgba(56,189,248,0.18) 14px 15px)',
                      borderRadius: borderRad, pointerEvents: 'none', zIndex: 1,
                    }} />
                    <div style={{
                      position: 'absolute', top: 6, bottom: 6, left: 10,
                      width: 1.5, background: 'rgba(239,68,68,0.5)',
                      pointerEvents: 'none', zIndex: 1,
                    }} />
                  </>
                )}

                {/* PAPELITO-SIMPLE: cinta básica */}
                {variant === 'papelito-simple' && (
                  <div style={{
                    position: 'absolute', top: -8, left: '50%',
                    width: cardW * 0.4, height: 13,
                    transform: `translateX(-50%) rotate(${rotBase * 2}deg)`,
                    background: 'linear-gradient(180deg, rgba(245,245,240,0.6) 0%, rgba(220,220,210,0.5) 100%)',
                    border: '1px solid rgba(0,0,0,0.1)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    pointerEvents: 'none', zIndex: 3,
                  }} />
                )}

                {/* ESQUINA DOBLADA (no en sticker ni ticket ni cuaderno-libro) */}
                {variant !== 'sticker-clip' && variant !== 'ticket-rojo' && variant !== 'cuaderno-libro' && (
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 16, height: 16,
                    background: `linear-gradient(135deg, transparent 50%, color-mix(in srgb, ${pal.ink} 22%, transparent) 50%)`,
                    borderBottomRightRadius: borderRad,
                    pointerEvents: 'none', zIndex: 2,
                  }} />
                )}

                {/* ════════ CONTENIDO COMÚN ════════ */}

                {/* LIBRETA-ABIERTA: layout especial 2 columnas (emoji izq, texto der) */}
                {variant === 'libreta-abierta' ? (
                  <div style={{
                    position: 'relative', zIndex: 2,
                    width: '100%', height: '100%',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    alignItems: 'center',
                    pointerEvents: 'none',
                  }}>
                    {/* Página izquierda: emoji grande */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      paddingRight: 8,
                    }}>
                      <div style={{
                        fontSize: 52,
                        filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.3))',
                        lineHeight: 1,
                      }}>{n.emoji}</div>
                    </div>
                    {/* Página derecha: nombre + sublabel + subrayado */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      paddingLeft: 8, paddingRight: 6,
                      textAlign: 'center',
                    }}>
                      <div style={{
                        fontFamily: HAND,
                        fontSize: 26,
                        fontWeight: 800,
                        color: pal.ink,
                        lineHeight: 1.05,
                        letterSpacing: 0.3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        maxWidth: '100%',
                        textShadow: '0 1px 0 rgba(255,255,255,0.4)',
                      }}>{n.label}</div>
                      {n.sublabel && (
                        <div style={{
                          fontFamily: HAND,
                          fontSize: 13,
                          color: pal.inkSoft,
                          marginTop: 3,
                          fontStyle: 'italic',
                          fontWeight: 600,
                          opacity: 0.85,
                        }}>{n.sublabel}</div>
                      )}
                      <svg width="60" height="5" style={{ marginTop: 4, opacity: 0.55 }}>
                        <path d="M3 3 Q 30 0 57 3.5"
                          stroke={pal.ink} strokeWidth="1.8"
                          fill="none" strokeLinecap="round" />
                      </svg>
                    </div>
                  </div>
                ) : (
                  <>

                {/* EMOJI */}
                <div style={{
                  fontSize: emojiSize,
                  marginBottom: 4,
                  filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))',
                  pointerEvents: 'none',
                  position: 'relative', zIndex: 2,
                  lineHeight: 1,
                }}>{n.emoji}</div>

                {/* LABEL */}
                <div style={{
                  fontFamily: HAND,
                  fontSize: labelSize,
                  fontWeight: 800,
                  color: pal.ink,
                  lineHeight: 1.05,
                  padding: '0 4px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  maxWidth: '100%',
                  letterSpacing: 0.2,
                  textShadow: '0 1px 0 rgba(255,255,255,0.35)',
                  pointerEvents: 'none',
                  position: 'relative', zIndex: 2,
                }}>{n.label}</div>

                {/* SUBLABEL */}
                {n.sublabel && (
                  <div style={{
                    fontFamily: HAND,
                    fontSize: 12,
                    color: pal.inkSoft,
                    marginTop: 2,
                    fontStyle: 'italic',
                    fontWeight: 600,
                    opacity: 0.9,
                    pointerEvents: 'none',
                    position: 'relative', zIndex: 2,
                  }}>{n.sublabel}</div>
                )}

                {/* Subrayado handwritten en hubs/root */}
                {(isRoot || isHub) && (
                  <svg width={Math.min(70, cardW * 0.5)} height="5"
                    style={{ marginTop: 4, opacity: 0.6, pointerEvents: 'none', position: 'relative', zIndex: 2 }}>
                    <path d={`M3 3 Q ${Math.min(70, cardW*0.5)/2} 0 ${Math.min(70, cardW*0.5)-3} 3.5`}
                      stroke={pal.ink} strokeWidth="1.8" fill="none" strokeLinecap="round" />
                  </svg>
                )}
                  </>
                )}

                {/* CHECK seleccionado — sello rojo */}
                {n.selected && (
                  <div style={{
                    position: 'absolute', top: -8, right: -8,
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
                    border: '2.5px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 900, color: '#fff',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.3)',
                    pointerEvents: 'none', zIndex: 5,
                    transform: 'rotate(8deg)',
                  }}>✓</div>
                )}

                {/* Etiqueta "pronto" para disabled */}
                {n.disabled && (
                  <div style={{
                    position: 'absolute', bottom: -12, left: '50%',
                    transform: 'translateX(-50%) rotate(-2deg)',
                    background: 'rgba(60,60,60,0.88)',
                    color: '#fff', fontSize: 10, fontWeight: 700,
                    fontFamily: HAND, padding: '2px 10px',
                    borderRadius: 10, fontStyle: 'italic',
                    pointerEvents: 'none', zIndex: 5,
                    boxShadow: '0 2px 5px rgba(0,0,0,0.4)',
                  }}>pronto</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {contextMenu && (
        <div onClick={() => setContextMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 9000 }}>
          <div onClick={e => e.stopPropagation()} style={{
            position: 'absolute', left: contextMenu.x, top: contextMenu.y,
            background: '#1a1a1e', border: '1px solid #333',
            borderRadius: 14, padding: 6, minWidth: 160,
            boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
          }}>
            <button onClick={() => {
              contextMenu.node.type === 'apunte' ? onEliminarApunte(contextMenu.node.data.id) : onEliminarDocumento(contextMenu.node.data.id);
              setContextMenu(null);
            }} style={{ ...ctxBtn, color: '#ff4444' }}>🗑️ Eliminar</button>
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
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.78)',
            backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'linear-gradient(135deg, #1a1010, #2a1515)',
              border: '2px solid rgba(255,68,68,0.5)',
              borderRadius: 20,
              padding: 32,
              maxWidth: 460,
              width: '90%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(255,68,68,0.3)',
              animation: 'studyBtnIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            <div style={{
              fontSize: 48, textAlign: 'center', marginBottom: 16,
              filter: 'drop-shadow(0 0 12px rgba(255,68,68,0.6))',
            }}>🗑️</div>

            <div style={{
              fontFamily: HAND, fontSize: 28, fontWeight: 800,
              color: '#ff8888', textAlign: 'center', marginBottom: 8,
              textShadow: '0 0 10px rgba(255,68,68,0.4)',
            }}>
              {selectedIds.length === 1 ? '¿Eliminar este material?' : `¿Eliminar ${selectedIds.length} materiales?`}
            </div>

            <div style={{
              fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(255,255,255,0.7)',
              textAlign: 'center', marginBottom: 20, lineHeight: 1.5,
            }}>
              Esta acción no se puede deshacer. Los archivos se borrarán permanentemente
              junto con sus sesiones de estudio.
            </div>

            {/* Lista de materiales a borrar */}
            <div style={{
              maxHeight: 160, overflow: 'auto',
              background: 'rgba(0,0,0,0.3)', borderRadius: 10,
              padding: '10px 14px', marginBottom: 20,
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {tema.documentos.filter((d: any) => selectedIds.includes(d.id)).map((d: any) => (
                <div key={d.id} style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(255,255,255,0.85)',
                  padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span>📄</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.nombre}
                  </span>
                </div>
              ))}
            </div>

            {deleting && (
              <div style={{
                marginBottom: 16, padding: '10px 14px',
                background: 'rgba(255,68,68,0.08)', borderRadius: 10,
                border: '1px solid rgba(255,68,68,0.25)',
                fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#ffaaaa',
                textAlign: 'center',
              }}>
                Eliminando {deleteProgress.done} de {deleteProgress.total}...
                <div style={{
                  marginTop: 6, height: 4, background: 'rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${(deleteProgress.done / Math.max(1, deleteProgress.total)) * 100}%`,
                    background: 'linear-gradient(90deg, #ff4444, #ff8888)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleting}
                style={{
                  flex: 1, padding: '12px 20px', borderRadius: 12,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1.5px solid rgba(255,255,255,0.15)',
                  color: '#fff', fontFamily: HAND, fontSize: 18, fontWeight: 700,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.5 : 1,
                  transition: 'all 0.2s',
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
                      if (result && typeof (result as any).then === 'function') {
                        await result;
                      }
                      borrados++;
                    } catch (e) {
                      console.warn('Error eliminando', id, e);
                    }
                    setDeleteProgress({ done: borrados, total: idsToDelete.length });
                    // Pequeña pausa para que el servidor procese
                    await new Promise(r => setTimeout(r, 300));
                  }

                  setSelectedIds([]);
                  setDeleting(false);
                  setDeleteProgress({ done: 0, total: 0 });
                  refreshSessions();
                }}
                disabled={deleting}
                style={{
                  flex: 1, padding: '12px 20px', borderRadius: 12,
                  background: 'linear-gradient(135deg, #ff4444, #cc2222)',
                  border: '1.5px solid #ff4444',
                  color: '#fff', fontFamily: HAND, fontSize: 18, fontWeight: 800,
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.7 : 1,
                  boxShadow: '0 4px 16px rgba(255,68,68,0.4)',
                  transition: 'all 0.2s',
                }}
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEnfoque && (
        <EnfoqueWheel
          color={themeColor}
          materialesCount={selectedIds.length}
          onClose={() => setShowEnfoque(false)}
          onSelect={(id: string) => {
               if (id === 'teorico' || id === 'matematico' || id === 'mixto') {
                 const enfoqueId = id as any;
                 // ── Buscar sesión existente que coincida con selección actual + enfoque ──
                 const matchingSession = activeSessions.find(s => {
                   if (s.enfoque !== enfoqueId) return false;
                   if (s.materialIds.length !== selectedIds.length) return false;
                   const setA = new Set(s.materialIds);
                   return selectedIds.every(matId => setA.has(matId));
                 });

                 if (matchingSession && matchingSession.selectedPages) {
                   // ── Salto directo al enfoque con páginas guardadas ──
                   setEnfoqueElegido(enfoqueId);
                   const rebuilt = matchingSession.materialIds.map((matId: string, idx: number) => ({
                     materialId: matId,
                     materialIndex: idx,
                     pages: matchingSession.selectedPages![matId] || [],
                   }));
                   setSeleccionResult(rebuilt as any);
                   setShowEnfoque(false);
                   setOpenTeorico(true);
                   console.log('🚀 Salto directo a sesión existente:', matchingSession.id);
                 } else {
                   // Flujo normal
                   setEnfoqueElegido(enfoqueId);
                   setShowEnfoque(false);
                   setShowSeleccion(true);
                 }
               } else {
                 setShowEnfoque(false);
               }
             }}
        />
      )}

      {showSeleccion && enfoqueElegido && (
        <SeleccionPaginas
          materiales={tema.documentos.filter((d: any) => selectedIds.includes(d.id))}
          enfoque={enfoqueElegido}
          temaId={tema.id}
          themeColor={themeColor}
          onCancel={() => {
            setShowSeleccion(false);
            setEnfoqueElegido(null);
          }}
          onConfirm={(resultado) => {
            setSeleccionResult(resultado);
            setShowSeleccion(false);
            if (enfoqueElegido === 'teorico') {
              setOpenTeorico(true);
            } else if (enfoqueElegido === 'practico') {
              // Quiz: abrir directamente con la selección
              const matsSeleccionados = tema.documentos.filter((d: any) => selectedIds.includes(d.id));
              onOpenQuiz?.(matsSeleccionados, resultado as any);
            }
          }}
        />
      )}

      <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&display=swap" rel="stylesheet" />
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
        html, body { overflow: hidden !important; margin: 0; padding: 0; height: 100%; }
      `}</style>
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  width: 28, height: 28,
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  color: '#fff', cursor: 'pointer',
  fontSize: 16, fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.2s',
};

const ctxBtn: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  border: 'none', background: 'transparent',
  color: '#fff', textAlign: 'left', cursor: 'pointer',
  fontWeight: 600, fontFamily: BODY, fontSize: 17,
  borderRadius: 8,
};
