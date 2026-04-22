'use client';

import { useState, useEffect, useRef } from 'react';
import { getMaterias, Materia } from '../lib/storage';

type Fase = 'estudiar' | 'descanso' | 'descanso-largo';

export default function PomodoroFlotante() {
  const [abierto, setAbierto] = useState(false);
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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMaterias(getMaterias());
    const hoy = new Date().toDateString();
    const guardado = localStorage.getItem('josea_pomodoros');
    if (guardado) {
      try {
        const data = JSON.parse(guardado);
        if (data.fecha === hoy) setPomodorosHoy(data.count);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (corriendo) {
      intervalRef.current = setInterval(() => {
        setSegundos(prev => {
          if (prev <= 1) {
            clearInterval(intervalRef.current!);
            terminarFase();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [corriendo]);

  const tocarSonido = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } catch {}
  };

  const notificar = (msg: string) => {
    tocarSonido();
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('⏱️ Pomodoro', { body: msg });
    }
  };

  const terminarFase = () => {
    setCorriendo(false);
    if (fase === 'estudiar') {
      const n = pomodorosHoy + 1;
      setPomodorosHoy(n);
      localStorage.setItem('josea_pomodoros', JSON.stringify({ fecha: new Date().toDateString(), count: n }));
      setXpGanado(prev => prev + 50);
      notificar('¡Sesión completada! +50 XP 🎉 Toma un descanso.');
      if (ronda % 4 === 0) {
        setFase('descanso-largo');
        setSegundos(config.largo * 60);
      } else {
        setFase('descanso');
        setSegundos(config.descanso * 60);
      }
      setRonda(prev => prev + 1);
    } else {
      notificar('¡Descanso terminado! A estudiar 📚');
      setFase('estudiar');
      setSegundos(config.estudiar * 60);
    }
  };

  const iniciar = () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    setCorriendo(true);
  };

  const pausar = () => setCorriendo(false);

  const resetear = () => {
    setCorriendo(false);
    setFase('estudiar');
    setSegundos(config.estudiar * 60);
    setRonda(1);
  };

  const saltarFase = () => {
    setCorriendo(false);
    terminarFase();
  };

  const mm = Math.floor(segundos / 60).toString().padStart(2, '0');
  const ss = (segundos % 60).toString().padStart(2, '0');
  const total = fase === 'estudiar' ? config.estudiar * 60 : fase === 'descanso' ? config.descanso * 60 : config.largo * 60;
  const progreso = ((total - segundos) / total) * 100;

  const colorFase = fase === 'estudiar' ? '#ef4444' : fase === 'descanso' ? '#4ade80' : '#60a5fa';
  const labelFase = fase === 'estudiar' ? 'Estudiar' : fase === 'descanso' ? 'Descanso' : 'Descanso largo';

  return (
    <>
      {/* Botón flotante - relojito */}
      <button
        onClick={() => setAbierto(!abierto)}
        style={{
          position: 'fixed', bottom: '24px', right: '24px',
          width: '56px', height: '56px', borderRadius: '50%',
          background: corriendo ? colorFase : 'var(--bg-card)',
          border: `3px solid ${colorFase}`,
          cursor: 'pointer', fontSize: '22px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: corriendo ? `0 0 20px ${colorFase}60` : '0 4px 20px rgba(0,0,0,0.3)',
          zIndex: 9999, transition: 'all 0.3s ease',
        }}
      >
        {corriendo ? (
          <span style={{ fontSize: '12px', fontWeight: 900, color: corriendo ? '#000' : 'var(--text-primary)' }}>
            {mm}:{ss}
          </span>
        ) : '⏱️'}
      </button>

      {/* Panel */}
      {abierto && (
        <div style={{
          position: 'fixed', bottom: '90px', right: '24px',
          width: '300px', background: 'var(--bg-card)',
          borderRadius: '20px', border: `2px solid ${colorFase}`,
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          zIndex: 9998, overflow: 'hidden',
          fontFamily: '-apple-system, sans-serif',
          animation: 'slideUp 0.3s ease',
        }}>

          {/* Header */}
          <div style={{ padding: '14px 16px', background: 'var(--bg-secondary)', borderBottom: `2px solid ${colorFase}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>⏱️</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>Pomodoro</div>
                <div style={{ fontSize: '10px', color: colorFase, fontWeight: 700 }}>{labelFase} · Ronda {ronda}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => setShowConfig(!showConfig)} style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)' }}>⚙️</button>
              <button onClick={() => setAbierto(false)} style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>
          </div>

          <div style={{ padding: '16px' }}>

            {/* Config */}
            {showConfig && (
              <div style={{ marginBottom: '14px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '12px', fontSize: '12px' }}>
                <p style={{ fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px' }}>⚙️ Configuración (min)</p>
                {([
                  { label: '📖 Estudio', key: 'estudiar' as const, min: 1, max: 60 },
                  { label: '☕ Descanso', key: 'descanso' as const, min: 1, max: 30 },
                  { label: '🛋️ Largo', key: 'largo' as const, min: 5, max: 60 },
                ]).map(({ label, key, min, max }) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button onClick={() => setConfig(c => ({ ...c, [key]: Math.max(min, c[key] - 1) }))}
                        style={{ width: '22px', height: '22px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 800, fontSize: '12px' }}>-</button>
                      <span style={{ fontWeight: 800, color: 'var(--text-primary)', minWidth: '24px', textAlign: 'center' }}>{config[key]}</span>
                      <button onClick={() => setConfig(c => ({ ...c, [key]: Math.min(max, c[key] + 1) }))}
                        style={{ width: '22px', height: '22px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 800, fontSize: '12px' }}>+</button>
                    </div>
                  </div>
                ))}
                <button onClick={() => { resetear(); setShowConfig(false); }}
                  style={{ width: '100%', padding: '6px', borderRadius: '8px', border: 'none', background: colorFase, color: '#000', fontWeight: 800, fontSize: '12px', cursor: 'pointer', marginTop: '4px' }}>
                  Aplicar y resetear
                </button>
              </div>
            )}

            {/* Timer círculo */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ position: 'relative', width: '140px', height: '140px', marginBottom: '8px' }}>
                <svg width="140" height="140" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="70" cy="70" r="60" fill="none" stroke="var(--bg-secondary)" strokeWidth="8" />
                  <circle cx="70" cy="70" r="60" fill="none" stroke={colorFase} strokeWidth="8"
                    strokeDasharray={`${2 * Math.PI * 60}`}
                    strokeDashoffset={`${2 * Math.PI * 60 * (1 - progreso / 100)}`}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '32px', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
                    {mm}:{ss}
                  </span>
                  <span style={{ fontSize: '10px', color: colorFase, fontWeight: 700, textTransform: 'uppercase' }}>
                    {labelFase}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>⏱️ Hoy: <strong style={{ color: colorFase }}>{pomodorosHoy}</strong></span>
                <span>⭐ XP: <strong style={{ color: 'var(--gold)' }}>+{xpGanado}</strong></span>
              </div>
            </div>

            {/* Materia */}
            <select value={materiaId} onChange={e => setMateriaId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '12px', marginBottom: '12px', outline: 'none' }}>
              <option value="">📚 Materia (opcional)</option>
              {materias.map(m => (
                <option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>
              ))}
            </select>

            {/* Controles */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {!corriendo ? (
                <button onClick={iniciar}
                  style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: colorFase, color: '#000', fontWeight: 900, fontSize: '15px', cursor: 'pointer' }}>
                  ▶ Iniciar
                </button>
              ) : (
                <button onClick={pausar}
                  style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: colorFase, color: '#000', fontWeight: 900, fontSize: '15px', cursor: 'pointer' }}>
                  ⏸ Pausar
                </button>
              )}
              <button onClick={resetear}
                style={{ padding: '12px 14px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ↺
              </button>
              <button onClick={saltarFase}
                style={{ padding: '12px 14px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ⏭
              </button>
            </div>

            {/* Rondas */}
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '12px' }}>
              {[1,2,3,4].map(r => (
                <div key={r} style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: ronda > r ? colorFase : 'var(--bg-secondary)',
                  border: `2px solid ${ronda === r ? colorFase : 'var(--border-color)'}`,
                  transition: 'all 0.3s',
                }} />
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
