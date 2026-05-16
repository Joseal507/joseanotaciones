'use client';

import { useState, useEffect } from 'react';
import { usePomodoroContext } from '../../components/PomodoroProvider';
import { getMaterias, Materia } from '../../lib/storage';
import Link from 'next/link';

export default function PomodoroPage() {
  const {
    fase, segundos, corriendo, ronda, pomodorosHoy,
    xpGanado, config, materiaId,
    iniciar, pausar, resetear, saltarFase,
    setConfig, setMateriaId,
  } = usePomodoroContext();

  const [materias, setMaterias] = useState<Materia[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [configLocal, setConfigLocal] = useState(config);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setMaterias(getMaterias());
  }, []);

  useEffect(() => {
    setConfigLocal(config);
  }, [config]);

  if (!mounted) return null;

  const mm = Math.floor(segundos / 60).toString().padStart(2, '0');
  const ss = (segundos % 60).toString().padStart(2, '0');

  const total = fase === 'estudiar'
    ? config.estudiar * 60
    : fase === 'descanso'
    ? config.descanso * 60
    : config.largo * 60;

  const progreso = (total - segundos) / total;

  const colorFase = fase === 'estudiar'
    ? '#ef4444'
    : fase === 'descanso'
    ? '#4ade80'
    : '#60a5fa';

  const labelFase = fase === 'estudiar'
    ? '🔥 Enfócate'
    : fase === 'descanso'
    ? '☕ Descansa'
    : '🛋️ Descanso Largo';

  const descripcionFase = fase === 'estudiar'
    ? 'Modo concentración total'
    : fase === 'descanso'
    ? 'Respira, muévete un poco'
    : 'Te lo mereces, relájate';

  // SVG del reloj circular
  const radio = 140;
  const circumference = 2 * Math.PI * radio;
  const strokeDashoffset = circumference * (1 - progreso);

  // Marcas de minutos del reloj
  const marcas = Array.from({ length: 60 }, (_, i) => {
    const angulo = (i * 360) / 60 - 90;
    const rad = (angulo * Math.PI) / 180;
    const esMayor = i % 5 === 0;
    const r1 = esMayor ? 155 : 158;
    const r2 = 165;
    const x1 = 180 + r1 * Math.cos(rad);
    const y1 = 180 + r1 * Math.sin(rad);
    const x2 = 180 + r2 * Math.cos(rad);
    const y2 = 180 + r2 * Math.sin(rad);
    return { x1, y1, x2, y2, esMayor };
  });

  // Manecilla de segundos
  const anguloSegundos = ((segundos % 60) / 60) * 360 - 90;
  const radSeg = (anguloSegundos * Math.PI) / 180;
  const manecillaX = 180 + 120 * Math.cos(radSeg);
  const manecillaY = 180 + 120 * Math.sin(radSeg);

  // Manecilla de minutos
  const minutosRestantes = Math.floor(segundos / 60);
  const anguloMinutos = (minutosRestantes / (total / 60)) * 360 - 90;
  const radMin = (anguloMinutos * Math.PI) / 180;
  const manecillaMinX = 180 + 90 * Math.cos(radMin);
  const manecillaMinY = 180 + 90 * Math.sin(radMin);

  const aplicarConfig = () => {
    setConfig(configLocal);
    resetear();
    setShowConfig(false);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary, #0f0f1a)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 16px',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    }}>

      {/* Header */}
      <div style={{
        width: '100%',
        maxWidth: '600px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '32px',
      }}>
        <Link href="/" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: 'var(--text-muted, #888)',
          textDecoration: 'none',
          fontSize: '14px',
          fontWeight: 600,
          padding: '8px 14px',
          borderRadius: '10px',
          border: '1px solid var(--border-color, #333)',
          background: 'var(--bg-card, #1a1a2e)',
          transition: 'all 0.2s',
        }}>
          ← Volver
        </Link>

        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            margin: 0,
            fontSize: '22px',
            fontWeight: 900,
            color: 'var(--text-primary, #fff)',
          }}>
            ⏱️ Pomodoro
          </h1>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted, #888)' }}>
            Técnica de concentración
          </p>
        </div>

        <button
          onClick={() => setShowConfig(!showConfig)}
          style={{
            padding: '8px 14px',
            borderRadius: '10px',
            border: '1px solid var(--border-color, #333)',
            background: showConfig ? colorFase : 'var(--bg-card, #1a1a2e)',
            color: showConfig ? '#000' : 'var(--text-muted, #888)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          ⚙️ Config
        </button>
      </div>

      {/* Config Panel */}
      {showConfig && (
        <div style={{
          width: '100%',
          maxWidth: '600px',
          background: 'var(--bg-card, #1a1a2e)',
          borderRadius: '20px',
          border: `2px solid ${colorFase}`,
          padding: '24px',
          marginBottom: '24px',
          animation: 'fadeIn 0.3s ease',
        }}>
          <h3 style={{ margin: '0 0 16px', color: 'var(--text-primary, #fff)', fontSize: '16px', fontWeight: 800 }}>
            ⚙️ Configurar tiempos
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
            {([
              { label: '🔥 Enfoque', key: 'estudiar' as const, min: 1, max: 90, color: '#ef4444' },
              { label: '☕ Descanso', key: 'descanso' as const, min: 1, max: 30, color: '#4ade80' },
              { label: '🛋️ Largo', key: 'largo' as const, min: 5, max: 60, color: '#60a5fa' },
            ]).map(({ label, key, min, max, color }) => (
              <div key={key} style={{
                background: 'var(--bg-secondary, #111)',
                borderRadius: '14px',
                padding: '16px',
                border: `1px solid ${color}40`,
                textAlign: 'center',
              }}>
                <p style={{ margin: '0 0 12px', fontSize: '12px', color, fontWeight: 700 }}>{label}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <button
                    onClick={() => setConfigLocal(c => ({ ...c, [key]: Math.max(min, c[key] - 1) }))}
                    style={{
                      width: '28px', height: '28px', borderRadius: '8px',
                      border: 'none', background: color, color: '#000',
                      fontWeight: 900, fontSize: '16px', cursor: 'pointer',
                    }}
                  >-</button>
                  <span style={{ fontSize: '24px', fontWeight: 900, color: 'var(--text-primary, #fff)', minWidth: '36px' }}>
                    {configLocal[key]}
                  </span>
                  <button
                    onClick={() => setConfigLocal(c => ({ ...c, [key]: Math.min(max, c[key] + 1) }))}
                    style={{
                      width: '28px', height: '28px', borderRadius: '8px',
                      border: 'none', background: color, color: '#000',
                      fontWeight: 900, fontSize: '16px', cursor: 'pointer',
                    }}
                  >+</button>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--text-muted, #888)' }}>minutos</p>
              </div>
            ))}
          </div>

          <button
            onClick={aplicarConfig}
            style={{
              width: '100%', padding: '12px',
              borderRadius: '12px', border: 'none',
              background: colorFase, color: '#000',
              fontWeight: 900, fontSize: '15px',
              cursor: 'pointer',
            }}
          >
            ✅ Aplicar configuración
          </button>
        </div>
      )}

      {/* Selector de Fase */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '32px',
        background: 'var(--bg-card, #1a1a2e)',
        padding: '6px',
        borderRadius: '16px',
        border: '1px solid var(--border-color, #333)',
      }}>
        {([
          { key: 'estudiar', label: '🔥 Enfoque', color: '#ef4444' },
          { key: 'descanso', label: '☕ Corto', color: '#4ade80' },
          { key: 'descanso-largo', label: '🛋️ Largo', color: '#60a5fa' },
        ] as const).map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => {
              if (!corriendo) {
                const ctx = usePomodoroContext;
                resetear();
              }
            }}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              border: 'none',
              background: fase === key ? color : 'transparent',
              color: fase === key ? '#000' : 'var(--text-muted, #888)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* RELOJ CIRCULAR */}
      <div style={{ position: 'relative', marginBottom: '32px' }}>
        <svg width="360" height="360" viewBox="0 0 360 360">

          {/* Fondo oscuro del reloj */}
          <circle cx="180" cy="180" r="170"
            fill="var(--bg-card, #1a1a2e)"
            stroke="var(--border-color, #333)"
            strokeWidth="2"
          />

          {/* Track del progreso */}
          <circle cx="180" cy="180" r={radio}
            fill="none"
            stroke="var(--bg-secondary, #111)"
            strokeWidth="16"
          />

          {/* Arco de progreso */}
          <circle cx="180" cy="180" r={radio}
            fill="none"
            stroke={colorFase}
            strokeWidth="16"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(-90 180 180)"
            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s ease' }}
          />

          {/* Glow del arco */}
          <circle cx="180" cy="180" r={radio}
            fill="none"
            stroke={colorFase}
            strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(-90 180 180)"
            opacity="0.3"
            style={{ transition: 'stroke-dashoffset 1s linear', filter: 'blur(4px)' }}
          />

          {/* Marcas del reloj */}
          {marcas.map((m, i) => (
            <line key={i}
              x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2}
              stroke={m.esMayor ? 'var(--text-muted, #666)' : 'var(--border-color, #333)'}
              strokeWidth={m.esMayor ? 2 : 1}
              strokeLinecap="round"
            />
          ))}

          {/* Números del reloj */}
          {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map(n => {
            const ang = (n / 60) * 360 - 90;
            const rad = (ang * Math.PI) / 180;
            const r = 148;
            const x = 180 + r * Math.cos(rad);
            const y = 180 + r * Math.sin(rad);
            return (
              <text key={n} x={x} y={y}
                textAnchor="middle" dominantBaseline="middle"
                fill="var(--text-muted, #555)"
                fontSize="9" fontWeight="600"
              >
                {n}
              </text>
            );
          })}

          {/* Manecilla de minutos */}
          <line
            x1="180" y1="180"
            x2={manecillaMinX} y2={manecillaMinY}
            stroke="var(--text-primary, #fff)"
            strokeWidth="3"
            strokeLinecap="round"
            style={{ transition: 'all 1s linear' }}
          />

          {/* Manecilla de segundos */}
          <line
            x1="180" y1="180"
            x2={manecillaX} y2={manecillaY}
            stroke={colorFase}
            strokeWidth="2"
            strokeLinecap="round"
            style={{ transition: 'all 1s linear' }}
          />

          {/* Centro del reloj */}
          <circle cx="180" cy="180" r="6" fill={colorFase} />
          <circle cx="180" cy="180" r="3" fill="var(--bg-card, #1a1a2e)" />

          {/* Tiempo digital en el centro */}
          <text x="180" y="200"
            textAnchor="middle"
            fill="var(--text-primary, #fff)"
            fontSize="42"
            fontWeight="900"
            fontFamily="-apple-system, monospace"
            letterSpacing="-2"
          >
            {mm}:{ss}
          </text>

          {/* Label fase debajo del tiempo */}
          <text x="180" y="228"
            textAnchor="middle"
            fill={colorFase}
            fontSize="12"
            fontWeight="700"
            textLength="auto"
          >
            {labelFase}
          </text>

          {/* Descripción */}
          <text x="180" y="244"
            textAnchor="middle"
            fill="var(--text-muted, #666)"
            fontSize="10"
            fontWeight="500"
          >
            {descripcionFase}
          </text>

        </svg>

        {/* Indicador de estado corriendo */}
        {corriendo && (
          <div style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: colorFase,
            animation: 'pulse 1.5s infinite',
          }} />
        )}
      </div>

      {/* Stats */}
      <div style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '24px',
      }}>
        {[
          { label: 'Pomodoros hoy', value: pomodorosHoy, emoji: '🍅', color: '#ef4444' },
          { label: 'Ronda actual', value: `${ronda}/4`, emoji: '🔄', color: colorFase },
          { label: 'XP ganado', value: `+${xpGanado}`, emoji: '⭐', color: '#fbbf24' },
        ].map(({ label, value, emoji, color }) => (
          <div key={label} style={{
            background: 'var(--bg-card, #1a1a2e)',
            borderRadius: '14px',
            padding: '14px 18px',
            border: '1px solid var(--border-color, #333)',
            textAlign: 'center',
            minWidth: '100px',
          }}>
            <p style={{ margin: 0, fontSize: '20px' }}>{emoji}</p>
            <p style={{ margin: '4px 0', fontSize: '18px', fontWeight: 900, color }}>{value}</p>
            <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-muted, #888)', fontWeight: 600 }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Indicador de rondas */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '28px' }}>
        {[1, 2, 3, 4].map(r => (
          <div key={r} style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: ronda > r ? colorFase : 'transparent',
            border: `2px solid ${ronda >= r ? colorFase : 'var(--border-color, #333)'}`,
            transition: 'all 0.3s',
            boxShadow: ronda > r ? `0 0 8px ${colorFase}` : 'none',
          }} />
        ))}
      </div>

      {/* Selector de materia */}
      <select
        value={materiaId}
        onChange={e => setMateriaId(e.target.value)}
        style={{
          width: '100%',
          maxWidth: '400px',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid var(--border-color, #333)',
          background: 'var(--bg-card, #1a1a2e)',
          color: 'var(--text-primary, #fff)',
          fontSize: '14px',
          marginBottom: '20px',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        <option value="">📚 Seleccionar materia (opcional)</option>
        {materias.map(m => (
          <option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>
        ))}
      </select>

      {/* Controles */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '40px',
      }}>
        <button
          onClick={resetear}
          style={{
            padding: '14px 20px',
            borderRadius: '14px',
            border: '2px solid var(--border-color, #333)',
            background: 'var(--bg-card, #1a1a2e)',
            color: 'var(--text-muted, #888)',
            fontSize: '18px',
            cursor: 'pointer',
            fontWeight: 700,
            transition: 'all 0.2s',
          }}
          title="Reiniciar"
        >↺</button>

        <button
          onClick={corriendo ? pausar : iniciar}
          style={{
            padding: '14px 48px',
            borderRadius: '14px',
            border: 'none',
            background: colorFase,
            color: '#000',
            fontSize: '18px',
            fontWeight: 900,
            cursor: 'pointer',
            transition: 'all 0.2s',
            boxShadow: `0 4px 20px ${colorFase}60`,
            letterSpacing: '0.5px',
          }}
        >
          {corriendo ? '⏸ Pausar' : '▶ Iniciar'}
        </button>

        <button
          onClick={saltarFase}
          style={{
            padding: '14px 20px',
            borderRadius: '14px',
            border: '2px solid var(--border-color, #333)',
            background: 'var(--bg-card, #1a1a2e)',
            color: 'var(--text-muted, #888)',
            fontSize: '18px',
            cursor: 'pointer',
            fontWeight: 700,
            transition: 'all 0.2s',
          }}
          title="Saltar fase"
        >⏭</button>
      </div>

      {/* Tips */}
      <div style={{
        maxWidth: '500px',
        background: 'var(--bg-card, #1a1a2e)',
        borderRadius: '16px',
        padding: '20px',
        border: `1px solid ${colorFase}30`,
        textAlign: 'center',
      }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted, #888)', lineHeight: 1.6 }}>
          {fase === 'estudiar'
            ? '💡 Silencia el teléfono, cierra redes sociales y concéntrate en una sola tarea durante los próximos ' + config.estudiar + ' minutos.'
            : fase === 'descanso'
            ? '💡 Levántate, estira las piernas, toma agua. Tu cerebro necesita este descanso para procesar lo aprendido.'
            : '💡 ¡Excelente trabajo! Completaste 4 pomodoros. Tómate un descanso largo y bien merecido.'}
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.5); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
