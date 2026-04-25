'use client';

import { useState, useEffect, useRef } from 'react';
import { getMaterias, Materia } from '../lib/storage';
import { getSettings, saveSettings } from '../lib/settings';

type Fase = 'estudiar' | 'descanso' | 'descanso-largo';

const STORAGE_KEY = 'josea_pomodoro_pos';

export default function PomodoroFlotante() {
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [minimizado, setMinimizado] = useState(false);
  const [fase, setFase] = useState<Fase>('estudiar');
  const [segundos, setSegundos] = useState(25 * 60);
  const [corriendo, setCorriendo] = useState(false);
  const [ronda, setRonda] = useState(1);
  const [pomodorosHoy, setPomodorosHoy] = useState(0);
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [materiaId, setMateriaId] = useState('');
  const [config, setConfig] = useState({ estudiar: 25, descanso: 5, largo: 30 });
  const [showConfig, setShowConfig] = useState(false);
  const [xpGanado, setXpGanado] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [windowSize, setWindowSize] = useState({ w: 800, h: 600 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── MOUNT: leer settings y posición guardada ──────────
  useEffect(() => {
    setMounted(true);
    const w = window.innerWidth;
    const h = window.innerHeight;
    setWindowSize({ w, h });

    // Leer settings
    const s = getSettings();
    setEnabled(s.timerEnabled !== false);

    // Leer posición guardada o usar default (bottom-left, al lado del chat)
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        // Asegurar que esté dentro de la pantalla
        setPos({
          x: Math.min(Math.max(p.x, 0), w - 68),
          y: Math.min(Math.max(p.y, 0), h - 68),
        });
      } else {
        // Default: esquina bottom-right, separado del chat
        setPos({ x: w - 68, y: h - 76 });
      }
    } catch {
      setPos({ x: window.innerWidth - 68, y: window.innerHeight - 76 });
    }

    // Pomodoros de hoy
    try {
      const data = JSON.parse(localStorage.getItem('josea_pomodoros') || '{}');
      if (data.fecha === new Date().toDateString()) setPomodorosHoy(data.count || 0);
    } catch {}

    setMaterias(getMaterias());

    // Escuchar cambios de settings desde settings page
    const onStorage = () => {
      const s2 = getSettings();
      setEnabled(s2.timerEnabled !== false);
    };
    window.addEventListener('storage', onStorage);

    // Resize
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // ── TIMER ─────────────────────────────────────────────
  useEffect(() => {
    if (corriendo) {
      intervalRef.current = setInterval(() => {
        setSegundos(prev => {
          if (prev <= 1) { clearInterval(intervalRef.current!); terminarFase(); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [corriendo]);

  // ── SETTINGS POLL (para cuando cambian en la misma pestaña) ──
  useEffect(() => {
    if (!mounted) return;
    const interval = setInterval(() => {
      const s = getSettings();
      setEnabled(s.timerEnabled !== false);
    }, 1000);
    return () => clearInterval(interval);
  }, [mounted]);

  if (!mounted) return null;
  if (!enabled) return null;

  // ── DRAG ──────────────────────────────────────────────
  const startDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    hasMoved.current = false;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragOffset.current = { x: clientX - pos.x, y: clientY - pos.y };
    setDragging(true);

    const onMove = (ev: MouseEvent | TouchEvent) => {
      hasMoved.current = true;
      const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
      const newX = Math.min(Math.max(cx - dragOffset.current.x, 0), window.innerWidth - 68);
      const newY = Math.min(Math.max(cy - dragOffset.current.y, 0), window.innerHeight - 68);
      setPos({ x: newX, y: newY });
    };

    const onUp = () => {
      setDragging(false);
      // Guardar posición
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch {}
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  };

  const handleBtnClick = () => {
    if (hasMoved.current) return;
    if (minimizado) { setMinimizado(false); return; }
    setAbierto(!abierto);
  };

  // ── AUDIO ─────────────────────────────────────────────
  const tocarSonido = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
    } catch {}
  };

  const terminarFase = () => {
    setCorriendo(false);
    tocarSonido();
    if (fase === 'estudiar') {
      const n = pomodorosHoy + 1;
      setPomodorosHoy(n);
      localStorage.setItem('josea_pomodoros', JSON.stringify({ fecha: new Date().toDateString(), count: n }));
      setXpGanado(prev => prev + 50);
      if (ronda % 4 === 0) { setFase('descanso-largo'); setSegundos(config.largo * 60); }
      else { setFase('descanso'); setSegundos(config.descanso * 60); }
      setRonda(prev => prev + 1);
    } else {
      setFase('estudiar'); setSegundos(config.estudiar * 60);
    }
  };

  const iniciar = () => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    setCorriendo(true);
  };
  const pausar = () => setCorriendo(false);
  const resetear = () => { setCorriendo(false); setFase('estudiar'); setSegundos(config.estudiar * 60); setRonda(1); };
  const saltarFase = () => { setCorriendo(false); terminarFase(); };

  const mm = Math.floor(segundos / 60).toString().padStart(2, '0');
  const ss2 = (segundos % 60).toString().padStart(2, '0');
  const total = fase === 'estudiar' ? config.estudiar * 60 : fase === 'descanso' ? config.descanso * 60 : config.largo * 60;
  const progreso = ((total - segundos) / total) * 100;
  const colorFase = fase === 'estudiar' ? '#ef4444' : fase === 'descanso' ? '#4ade80' : '#60a5fa';
  const labelFase = fase === 'estudiar' ? 'Estudiar' : fase === 'descanso' ? 'Descanso' : 'Largo';

  // Panel: encima o abajo según posición
  const panelAbajo = pos.y < windowSize.h / 2;
  // Panel: izquierda o derecha según posición
  const panelLeft = Math.min(Math.max(pos.x - 120, 8), windowSize.w - 310);

  return (
    <>
      {/* Botón flotante */}
      <button
        onMouseDown={(e) => {
          hasMoved.current = false;
          dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          setDragging(true);
          const onMove = (ev: MouseEvent) => {
            hasMoved.current = true;
            const nx = Math.min(Math.max(ev.clientX - dragOffset.current.x, 0), window.innerWidth - 60);
            const ny = Math.min(Math.max(ev.clientY - dragOffset.current.y, 0), window.innerHeight - 60);
            setPos({ x: nx, y: ny });
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: nx, y: ny }));
          };
          const onUp = () => {
            setDragging(false);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        onTouchStart={(e) => {
          hasMoved.current = false;
          const t = e.touches[0];
          dragOffset.current = { x: t.clientX - pos.x, y: t.clientY - pos.y };
          setDragging(true);
          const onMove = (ev: TouchEvent) => {
            hasMoved.current = true;
            const tc = ev.touches[0];
            const nx = Math.min(Math.max(tc.clientX - dragOffset.current.x, 0), window.innerWidth - 60);
            const ny = Math.min(Math.max(tc.clientY - dragOffset.current.y, 0), window.innerHeight - 60);
            setPos({ x: nx, y: ny });
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: nx, y: ny }));
          };
          const onUp = () => {
            setDragging(false);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
          };
          window.addEventListener('touchmove', onMove, { passive: true });
          window.addEventListener('touchend', onUp);
        }}
        onClick={handleBtnClick}
        style={{
          position: 'fixed',
          left: pos.x + 'px',
          top: pos.y + 'px',
          width: minimizado ? '32px' : '52px',
          height: minimizado ? '32px' : '52px',
          borderRadius: '50%',
          background: corriendo ? colorFase : 'var(--bg-card)',
          border: `3px solid ${colorFase}`,
          cursor: 'pointer',
          fontSize: minimizado ? '13px' : '20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: corriendo ? `0 0 20px ${colorFase}60` : '0 4px 20px rgba(0,0,0,0.3)',
          zIndex: 9997,
          transition: dragging ? 'none' : 'width 0.2s, height 0.2s, opacity 0.2s',
          opacity: minimizado ? 0.5 : 1,
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        title="Pomodoro — arrastra para mover, click para abrir"
      >
        {corriendo && !minimizado
          ? <span style={{ fontSize: '11px', fontWeight: 900, color: '#000', letterSpacing: '-0.5px' }}>{mm}:{ss2}</span>
          : '⏱️'}
      </button>

      {/* Panel */}
      {abierto && !minimizado && (
        <div style={{
          position: 'fixed',
          left: panelLeft,
          top: panelAbajo ? pos.y + 62 : pos.y - 415,
          width: '296px',
          background: 'var(--bg-card)',
          borderRadius: '20px',
          border: `2px solid ${colorFase}`,
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          zIndex: 9996,
          overflow: 'hidden',
          fontFamily: '-apple-system, sans-serif',
          animation: 'slideUp 0.25s ease',
        }}>

          {/* Header */}
          <div style={{ padding: '12px 14px', background: 'var(--bg-secondary)', borderBottom: `2px solid ${colorFase}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>⏱️</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>Pomodoro</div>
                <div style={{ fontSize: '10px', color: colorFase, fontWeight: 700 }}>{labelFase} · R{ronda}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => setShowConfig(!showConfig)} style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px' }}>⚙️</button>
              <button onClick={() => setMinimizado(true)} title="Minimizar" style={{ background: 'none', border: 'none', fontSize: '15px', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px', lineHeight: 1 }}>▬</button>
              <button onClick={() => setAbierto(false)} style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)', padding: '3px' }}>✕</button>
            </div>
          </div>

          <div style={{ padding: '14px' }}>
            {/* Config */}
            {showConfig && (
              <div style={{ marginBottom: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '10px', fontSize: '12px' }}>
                <p style={{ fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>⚙️ Minutos</p>
                {([
                  { label: '📖 Estudio', key: 'estudiar' as const, min: 1, max: 60 },
                  { label: '☕ Descanso', key: 'descanso' as const, min: 1, max: 30 },
                  { label: '🛋️ Largo', key: 'largo' as const, min: 5, max: 60 },
                ]).map(({ label, key, min, max }) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button onClick={() => setConfig(c => ({ ...c, [key]: Math.max(min, c[key] - 1) }))}
                        style={{ width: '22px', height: '22px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 800 }}>-</button>
                      <span style={{ fontWeight: 800, color: 'var(--text-primary)', minWidth: '20px', textAlign: 'center' }}>{config[key]}</span>
                      <button onClick={() => setConfig(c => ({ ...c, [key]: Math.min(max, c[key] + 1) }))}
                        style={{ width: '22px', height: '22px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 800 }}>+</button>
                    </div>
                  </div>
                ))}
                <button onClick={() => { resetear(); setShowConfig(false); }}
                  style={{ width: '100%', padding: '6px', borderRadius: '8px', border: 'none', background: colorFase, color: '#000', fontWeight: 800, fontSize: '11px', cursor: 'pointer', marginTop: '4px' }}>
                  Aplicar y resetear
                </button>
              </div>
            )}

            {/* Timer círculo */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ position: 'relative', width: '130px', height: '130px', marginBottom: '8px' }}>
                <svg width="130" height="130" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="65" cy="65" r="56" fill="none" stroke="var(--bg-secondary)" strokeWidth="7" />
                  <circle cx="65" cy="65" r="56" fill="none" stroke={colorFase} strokeWidth="7"
                    strokeDasharray={`${2 * Math.PI * 56}`}
                    strokeDashoffset={`${2 * Math.PI * 56 * (1 - progreso / 100)}`}
                    strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '30px', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>{mm}:{ss2}</span>
                  <span style={{ fontSize: '9px', color: colorFase, fontWeight: 700, textTransform: 'uppercase' }}>{labelFase}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>⏱️ Hoy: <strong style={{ color: colorFase }}>{pomodorosHoy}</strong></span>
                <span>⭐ XP: <strong style={{ color: 'var(--gold)' }}>+{xpGanado}</strong></span>
              </div>
            </div>

            {/* Materia */}
            <select value={materiaId} onChange={e => setMateriaId(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '12px', marginBottom: '10px', outline: 'none' }}>
              <option value="">📚 Materia (opcional)</option>
              {materias.map(m => <option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>)}
            </select>

            {/* Controles */}
            <div style={{ display: 'flex', gap: '6px' }}>
              {!corriendo
                ? <button onClick={iniciar} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: colorFase, color: '#000', fontWeight: 900, fontSize: '14px', cursor: 'pointer' }}>▶ Iniciar</button>
                : <button onClick={pausar} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: colorFase, color: '#000', fontWeight: 900, fontSize: '14px', cursor: 'pointer' }}>⏸ Pausar</button>
              }
              <button onClick={resetear} style={{ padding: '10px 12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700 }}>↺</button>
              <button onClick={saltarFase} style={{ padding: '10px 12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700 }}>⏭</button>
            </div>

            {/* Rondas */}
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '10px' }}>
              {[1,2,3,4].map(r => (
                <div key={r} style={{ width: '10px', height: '10px', borderRadius: '50%', background: ronda > r ? colorFase : 'var(--bg-secondary)', border: `2px solid ${ronda === r ? colorFase : 'var(--border-color)'}`, transition: 'all 0.3s' }} />
              ))}
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </>
  );
}
