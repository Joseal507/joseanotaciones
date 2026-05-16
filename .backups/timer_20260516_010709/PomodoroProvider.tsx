'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { darXP } from '../lib/xpClient';
import { dispararXPToast } from './XPToast';

type Fase = 'estudiar' | 'descanso' | 'descanso-largo';

interface PomodoroContextType {
  fase: Fase;
  segundos: number;
  corriendo: boolean;
  ronda: number;
  pomodorosHoy: number;
  xpGanado: number;
  config: { estudiar: number; descanso: number; largo: number };
  materiaId: string;
  iniciar: () => void;
  pausar: () => void;
  resetear: () => void;
  saltarFase: () => void;
  setConfig: (c: { estudiar: number; descanso: number; largo: number }) => void;
  setMateriaId: (id: string) => void;
}

const PomodoroContext = createContext<PomodoroContextType | null>(null);

export function usePomodoroContext() {
  const ctx = useContext(PomodoroContext);
  if (!ctx) throw new Error('usePomodoroContext debe usarse dentro de PomodoroProvider');
  return ctx;
}

interface XpMinutoToast {
  id: number;
  xp: number;
}

interface ToastNotif {
  id: number;
  mensaje: string;
  color: string;
  emoji: string;
}

export default function PomodoroProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [fase, setFase] = useState<Fase>('estudiar');
  const [segundos, setSegundos] = useState(25 * 60);
  const [corriendo, setCorriendo] = useState(false);
  const [ronda, setRonda] = useState(1);
  const [pomodorosHoy, setPomodorosHoy] = useState(0);
  const [xpGanado, setXpGanado] = useState(0);
  const [config, setConfigState] = useState({ estudiar: 25, descanso: 5, largo: 30 });
  const [materiaId, setMateriaId] = useState('');
  const [toastNotifs, setToastNotifs] = useState<ToastNotif[]>([]);
  const [xpMinutoToasts, setXpMinutoToasts] = useState<XpMinutoToast[]>([]);
  const [miniAbierto, setMiniAbierto] = useState(false);
  const [mounted, setMounted] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const segundosEstudiadosRef = useRef(0);
  const faseRef = useRef<Fase>('estudiar');
  const configRef = useRef({ estudiar: 25, descanso: 5, largo: 30 });
  const rondaRef = useRef(1);
  const pomodorosHoyRef = useRef(0);
  const xpGanadoRef = useRef(0);
  // Contador de segundos del minuto actual para dar XP por minuto
  const segundosMinutoRef = useRef(0);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { faseRef.current = fase; }, [fase]);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { rondaRef.current = ronda; }, [ronda]);
  useEffect(() => { pomodorosHoyRef.current = pomodorosHoy; }, [pomodorosHoy]);
  useEffect(() => { xpGanadoRef.current = xpGanado; }, [xpGanado]);

  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem('josea_pomodoros') || '{}');
      if (data.fecha === new Date().toDateString()) {
        setPomodorosHoy(data.count || 0);
      }
    } catch {}
  }, []);

  const mostrarNotif = useCallback((mensaje: string, color: string, emoji: string) => {
    const id = Date.now() + Math.random();
    setToastNotifs(prev => [...prev, { id, mensaje, color, emoji }]);
    setTimeout(() => setToastNotifs(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // Animación de +1 XP por minuto
  const mostrarXpMinuto = useCallback((xp: number) => {
    const id = Date.now() + Math.random();
    setXpMinutoToasts(prev => [...prev, { id, xp }]);
    setTimeout(() => setXpMinutoToasts(prev => prev.filter(t => t.id !== id)), 2000);
  }, []);

  const tocarSonido = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.8);
    } catch {}
  }, []);

  const darXpMinuto = useCallback(async () => {
    const XP_POR_MINUTO = 1;
    setXpGanado(prev => prev + XP_POR_MINUTO);
    mostrarXpMinuto(XP_POR_MINUTO);
    await darXP('timer', XP_POR_MINUTO, { tipo: 'minuto_estudio' });
  }, [mostrarXpMinuto]);

  const darXpSesion = useCallback(async (
    minutosEstudiados: number,
    sesionCompleta: boolean,
    duracionMinutos: number
  ) => {
    if (minutosEstudiados < 1) return;
    let bonus = 0;
    if (sesionCompleta) {
      if (duracionMinutos >= 50) bonus = 25;
      else if (duracionMinutos >= 25) bonus = 10;
    }
    const cantidad = Math.min(bonus, 30);
    if (cantidad <= 0) return;

    setXpGanado(prev => prev + cantidad);
    const result = await darXP('timer', cantidad, { minutosEstudiados, sesionCompleta, tipo: 'bonus_sesion' });

    if (sesionCompleta) {
      dispararXPToast({
        xp: result.ok ? result.xpGanado : cantidad,
        fuente: '⏱️ Sesión completa',
        emoji: '🏆',
        color: '#fbbf24',
        descripcion: `Bonus por ${minutosEstudiados} min de estudio`,
      });
    }
    segundosEstudiadosRef.current = 0;
    segundosMinutoRef.current = 0;
  }, []);

  const terminarFase = useCallback(() => {
    setCorriendo(false);
    tocarSonido();

    const fasaActual = faseRef.current;
    const cfg = configRef.current;
    const rondaActual = rondaRef.current;
    const pomHoy = pomodorosHoyRef.current;

    if (fasaActual === 'estudiar') {
      const mins = Math.floor(segundosEstudiadosRef.current / 60);
      darXpSesion(mins, true, cfg.estudiar);

      const n = pomHoy + 1;
      setPomodorosHoy(n);
      pomodorosHoyRef.current = n;
      localStorage.setItem('josea_pomodoros', JSON.stringify({
        fecha: new Date().toDateString(),
        count: n,
      }));

      if (rondaActual % 4 === 0) {
        setFase('descanso-largo');
        setSegundos(cfg.largo * 60);
        mostrarNotif('¡4 sesiones! Descanso largo 🛋️', '#60a5fa', '🛋️');
      } else {
        setFase('descanso');
        setSegundos(cfg.descanso * 60);
        mostrarNotif('¡Sesión completa! Descansa ☕', '#4ade80', '☕');
      }
      setRonda(prev => prev + 1);
    } else {
      setFase('estudiar');
      setSegundos(cfg.estudiar * 60);
      mostrarNotif('¡Descanso terminado! A estudiar 📚', '#ef4444', '📚');
    }
  }, [tocarSonido, mostrarNotif, darXpSesion]);

  // TIMER — vive en el Provider, persiste al navegar
  useEffect(() => {
    if (corriendo) {
      if (intervalRef.current) clearInterval(intervalRef.current);

      intervalRef.current = setInterval(() => {
        if (faseRef.current === 'estudiar') {
          segundosEstudiadosRef.current += 1;
          segundosMinutoRef.current += 1;

          // Dar 1 XP por cada minuto completo de estudio
          if (segundosMinutoRef.current >= 60) {
            segundosMinutoRef.current = 0;
            darXpMinuto();
          }
        }

        setSegundos(prev => {
          if (prev <= 1) {
            clearInterval(intervalRef.current!);
            intervalRef.current = null;
            setTimeout(() => terminarFase(), 0);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [corriendo, terminarFase, darXpMinuto]);

  const iniciar = useCallback(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    setCorriendo(true);
  }, []);

  const pausar = useCallback(() => {
    setCorriendo(false);
    if (faseRef.current === 'estudiar') {
      const mins = Math.floor(segundosEstudiadosRef.current / 60);
      if (mins >= 1) darXpSesion(mins, false, configRef.current.estudiar);
    }
  }, [darXpSesion]);

  const resetear = useCallback(() => {
    setCorriendo(false);
    segundosEstudiadosRef.current = 0;
    segundosMinutoRef.current = 0;
    setFase('estudiar');
    setSegundos(configRef.current.estudiar * 60);
    setRonda(1);
  }, []);

  const saltarFase = useCallback(() => {
    if (faseRef.current === 'estudiar') {
      const mins = Math.floor(segundosEstudiadosRef.current / 60);
      if (mins >= 1) darXpSesion(mins, false, configRef.current.estudiar);
    }
    setCorriendo(false);
    terminarFase();
  }, [terminarFase, darXpSesion]);

  const setConfig = useCallback((c: { estudiar: number; descanso: number; largo: number }) => {
    setConfigState(c);
    configRef.current = c;
  }, []);

  // Datos para el mini widget
  const mm = Math.floor(segundos / 60).toString().padStart(2, '0');
  const ss2 = (segundos % 60).toString().padStart(2, '0');
  const total = fase === 'estudiar'
    ? config.estudiar * 60
    : fase === 'descanso'
    ? config.descanso * 60
    : config.largo * 60;
  const progreso = total > 0 ? (total - segundos) / total : 0;
  const colorFase = fase === 'estudiar' ? '#ef4444' : fase === 'descanso' ? '#4ade80' : '#60a5fa';
  const labelFase = fase === 'estudiar' ? 'Enfoque' : fase === 'descanso' ? 'Descanso' : 'Largo';
  const enPaginaPomodoro = pathname === '/pomodoro';

  // Mostrar mini solo si hay timer activo y NO estamos en /pomodoro
  const mostrarMini = mounted && (corriendo || segundos !== total) && !enPaginaPomodoro;

  const miniR = 15;
  const miniCirc = 2 * Math.PI * miniR;
  const miniOffset = miniCirc * (1 - progreso);

  return (
    <PomodoroContext.Provider value={{
      fase, segundos, corriendo, ronda, pomodorosHoy,
      xpGanado, config, materiaId,
      iniciar, pausar, resetear, saltarFase,
      setConfig, setMateriaId,
    }}>
      {children}

      {/* ── MINI WIDGET (fuera de /pomodoro) ── */}
      {mostrarMini && (
        <div style={{
          position: 'fixed',
          top: '16px',
          left: '16px',
          zIndex: 9998,
          display: 'flex',
          alignItems: 'center',
          animation: 'miniSlideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          {/* Botón circular con progreso */}
          <button
            onClick={() => setMiniAbierto(!miniAbierto)}
            style={{
              width: '48px', height: '48px', borderRadius: '50%',
              border: `2px solid ${colorFase}`,
              background: 'var(--bg-card, #1a1a2e)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
              boxShadow: corriendo
                ? `0 0 16px ${colorFase}60, 0 2px 8px rgba(0,0,0,0.4)`
                : '0 2px 8px rgba(0,0,0,0.3)',
              padding: 0,
              transition: 'box-shadow 0.3s',
            }}
            title={corriendo ? `${mm}:${ss2} — ${labelFase}` : 'Timer pausado'}
          >
            {/* Arco de progreso */}
            <svg width="48" height="48" style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
              <circle cx="24" cy="24" r={miniR} fill="none" stroke="var(--border-color,#333)" strokeWidth="3" />
              <circle cx="24" cy="24" r={miniR} fill="none" stroke={colorFase} strokeWidth="3"
                strokeDasharray={miniCirc}
                strokeDashoffset={miniOffset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            {/* Tiempo dentro del círculo */}
            <span style={{
              fontSize: '9px', fontWeight: 900,
              color: 'var(--text-primary, #fff)',
              zIndex: 1, letterSpacing: '-0.3px',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {mm}:{ss2}
            </span>
            {/* Punto verde si está corriendo */}
            {corriendo && (
              <div style={{
                position: 'absolute', top: '-1px', right: '-1px',
                width: '10px', height: '10px', borderRadius: '50%',
                background: colorFase,
                border: '2px solid var(--bg-card, #1a1a2e)',
                animation: 'miniPulse 1.5s infinite',
              }} />
            )}
          </button>

          {/* Panel expandido al hacer click */}
          {miniAbierto && (
            <div style={{
              marginLeft: '10px',
              background: 'var(--bg-card, #1a1a2e)',
              border: `2px solid ${colorFase}`,
              borderRadius: '16px',
              padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: '12px',
              boxShadow: `0 4px 24px ${colorFase}30, 0 2px 8px rgba(0,0,0,0.3)`,
              animation: 'miniExpand 0.25s cubic-bezier(0.34,1.56,0.64,1)',
              whiteSpace: 'nowrap',
            }}>
              {/* Tiempo grande */}
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '20px', fontWeight: 900,
                  color: 'var(--text-primary, #fff)',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '-1px', lineHeight: 1,
                }}>
                  {mm}:{ss2}
                </div>
                <div style={{ fontSize: '9px', color: colorFase, fontWeight: 700, textTransform: 'uppercase', marginTop: '2px' }}>
                  {labelFase} · R{ronda}
                </div>
              </div>

              <div style={{ width: '1px', height: '28px', background: 'var(--border-color,#333)' }} />

              {/* XP */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '13px', fontWeight: 900, color: '#fbbf24' }}>+{xpGanado}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted,#888)', fontWeight: 600 }}>XP hoy</div>
              </div>

              <div style={{ width: '1px', height: '28px', background: 'var(--border-color,#333)' }} />

              {/* Controles */}
              <div style={{ display: 'flex', gap: '5px' }}>
                <button
                  onClick={e => { e.stopPropagation(); corriendo ? pausar() : iniciar(); }}
                  style={{
                    width: '30px', height: '30px', borderRadius: '8px',
                    border: 'none', background: colorFase, color: '#000',
                    fontSize: '13px', fontWeight: 900, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {corriendo ? '⏸' : '▶'}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); saltarFase(); }}
                  style={{
                    width: '30px', height: '30px', borderRadius: '8px',
                    border: '1px solid var(--border-color,#333)',
                    background: 'transparent', color: 'var(--text-muted,#888)',
                    fontSize: '11px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >⏭</button>
              </div>

              <div style={{ width: '1px', height: '28px', background: 'var(--border-color,#333)' }} />

              {/* Ir a pomodoro */}
              <button
                onClick={() => router.push('/pomodoro')}
                style={{
                  padding: '5px 9px', borderRadius: '8px',
                  border: `1px solid ${colorFase}44`,
                  background: `${colorFase}15`,
                  color: colorFase, fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                }}
              >↗</button>

              {/* Cerrar */}
              <button
                onClick={() => setMiniAbierto(false)}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--text-muted,#888)',
                  fontSize: '14px', cursor: 'pointer', padding: '2px',
                }}
              >✕</button>
            </div>
          )}
        </div>
      )}

      {/* ── ANIMACIONES XP POR MINUTO ── */}
      {xpMinutoToasts.map(t => (
        <div key={t.id} style={{
          position: 'fixed',
          top: enPaginaPomodoro ? '50%' : '72px',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10000,
          pointerEvents: 'none',
          animation: 'xpMinutoFloat 2s ease-out forwards',
        }}>
          <div style={{
            background: 'rgba(251,191,36,0.95)',
            color: '#000',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '14px',
            fontWeight: 900,
            boxShadow: '0 4px 16px rgba(251,191,36,0.4)',
            whiteSpace: 'nowrap',
          }}>
            ⭐ +{t.xp} XP
          </div>
        </div>
      ))}

      {/* ── NOTIFICACIONES DE FASE ── */}
      <div style={{
        position: 'fixed', bottom: '20px', right: '20px',
        zIndex: 9999, display: 'flex', flexDirection: 'column',
        gap: '8px', pointerEvents: 'none',
      }}>
        {toastNotifs.map(t => (
          <div key={t.id} style={{
            background: 'var(--bg-card,#1a1a2e)',
            border: `2px solid ${t.color}`,
            borderRadius: '14px', padding: '12px 18px',
            display: 'flex', alignItems: 'center', gap: '10px',
            boxShadow: `0 4px 20px ${t.color}30`,
            animation: 'notifIn 0.3s ease',
            minWidth: '220px', pointerEvents: 'none',
          }}>
            <span style={{ fontSize: '20px' }}>{t.emoji}</span>
            <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary,#fff)' }}>
              {t.mensaje}
            </p>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes miniSlideIn {
          from { opacity:0; transform:translateX(-20px) scale(0.9); }
          to   { opacity:1; transform:translateX(0) scale(1); }
        }
        @keyframes miniExpand {
          from { opacity:0; transform:scaleX(0.7) translateX(-10px); transform-origin:left; }
          to   { opacity:1; transform:scaleX(1) translateX(0); transform-origin:left; }
        }
        @keyframes miniPulse {
          0%,100% { opacity:1; transform:scale(1); }
          50%     { opacity:0.5; transform:scale(1.4); }
        }
        @keyframes notifIn {
          from { opacity:0; transform:translateX(20px); }
          to   { opacity:1; transform:translateX(0); }
        }
        @keyframes xpMinutoFloat {
          0%   { opacity:0; transform:translate(-50%,-50%) scale(0.8); }
          20%  { opacity:1; transform:translate(-50%,-60%) scale(1.1); }
          80%  { opacity:1; transform:translate(-50%,-90%) scale(1); }
          100% { opacity:0; transform:translate(-50%,-120%) scale(0.9); }
        }
      `}</style>
    </PomodoroContext.Provider>
  );
}
