'use client';

import { useState, useEffect } from 'react';
import { usePomodoroContext } from '../../components/PomodoroProvider';
import { getMaterias, Materia } from '../../lib/storage';
import Link from 'next/link';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

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

  const colorFase = fase === 'estudiar' ? '#ef4444' : fase === 'descanso' ? '#4ade80' : '#60a5fa';
  const labelFase = fase === 'estudiar' ? '🔥 Enfócate' : fase === 'descanso' ? '☕ Descansa' : '🛋️ Descanso Largo';
  const descripcionFase = fase === 'estudiar' ? 'modo concentración total'
    : fase === 'descanso' ? 'respira, muévete un poco' : 'te lo mereces, relájate';

  const radio = 140;
  const circumference = 2 * Math.PI * radio;
  const strokeDashoffset = circumference * (1 - progreso);

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

  const anguloSegundos = ((segundos % 60) / 60) * 360 - 90;
  const radSeg = (anguloSegundos * Math.PI) / 180;
  const manecillaX = 180 + 120 * Math.cos(radSeg);
  const manecillaY = 180 + 120 * Math.sin(radSeg);

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
      background: 'var(--bg-primary)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 16px',
      position: 'relative',
    }}>

      {/* HEADER */}
      <div style={{
        width: '100%', maxWidth: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 22, gap: 12, flexWrap: 'wrap',
      }}>
        <Link href="/" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          color: 'var(--text-primary)', textDecoration: 'none',
          padding: '8px 16px',
          borderRadius: 10,
          border: '2.5px solid var(--text-primary)',
          background: 'var(--bg-card)',
          fontFamily: HAND, fontSize: 17, fontWeight: 800,
          boxShadow: '3px 3px 0 var(--text-primary)',
          transform: 'rotate(-1.5deg)',
          transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
        }}>
          ← Volver
        </Link>

        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            margin: 0,
            fontFamily: HAND, fontSize: 38, fontWeight: 900,
            color: 'var(--text-primary)',
            lineHeight: 1,
            transform: 'rotate(-1deg)',
            display: 'inline-block',
          }}>
            🍅 Pomodoro
          </h1>
          <svg width="180" height="6" style={{ display: 'block', margin: '4px auto 0' }}>
            <path d="M2 3 Q 90 0 178 4" stroke={colorFase} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
          </svg>
          <p style={{
            margin: '4px 0 0',
            fontFamily: BODY, fontSize: 15, fontStyle: 'italic',
            color: 'var(--text-muted)',
          }}>
            ~ técnica de concentración ~
          </p>
        </div>

        <button onClick={() => setShowConfig(!showConfig)}
          style={{
            padding: '8px 16px',
            borderRadius: 10,
            border: '2.5px solid var(--text-primary)',
            background: showConfig ? colorFase : 'var(--bg-card)',
            color: showConfig ? '#000' : 'var(--text-primary)',
            fontFamily: HAND, fontSize: 17, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 3px 0 var(--text-primary)',
            transform: 'rotate(1.5deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}>
          ⚙️ config
        </button>
      </div>

      {/* Línea rasgada */}
      <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{
        display: 'block', width: '100%', maxWidth: 700, height: 14, marginBottom: 16,
      }}>
        <path
          d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
          fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.4"
        />
      </svg>

      {/* CONFIG PANEL */}
      {showConfig && (
        <div style={{
          width: '100%', maxWidth: 600,
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 16,
          boxShadow: `5px 6px 0 ${colorFase}`,
          transform: 'rotate(-0.5deg)',
          marginBottom: 22,
          overflow: 'hidden',
          animation: 'fadeInPm 0.3s ease',
          position: 'relative',
        }}>
          {/* Cinta scotch */}
          <div style={{
            position: 'absolute', top: -10, left: '50%',
            transform: 'translateX(-50%) rotate(-3deg)',
            width: 80, height: 18,
            background: `color-mix(in srgb,${colorFase} 55%,transparent)`,
            border: `1px solid color-mix(in srgb,${colorFase} 30%,transparent)`,
            boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
            zIndex: 5,
          }}/>

          <div style={{
            background: colorFase,
            padding: '8px 22px',
            borderBottom: '2px solid var(--text-primary)',
          }}>
            <h3 style={{
              margin: 0, fontFamily: HAND, fontSize: 22, fontWeight: 900,
              color: '#000', fontStyle: 'italic',
              transform: 'rotate(-0.8deg)', display: 'inline-block',
            }}>
              ⚙️ Configurar tiempos
            </h3>
          </div>

          <div style={{ padding: 22 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12, marginBottom: 16,
            }}>
              {([
                { label: '🔥 Enfoque',   key: 'estudiar' as const, min: 1, max: 90, color: '#ef4444', rot: -1.5 },
                { label: '☕ Descanso',  key: 'descanso' as const, min: 1, max: 30, color: '#4ade80', rot: 1.5 },
                { label: '🛋️ Largo',    key: 'largo'    as const, min: 5, max: 60, color: '#60a5fa', rot: -1 },
              ]).map(({ label, key, min, max, color, rot }) => (
                <div key={key} style={{
                  background: 'var(--bg-secondary)',
                  border: `2.5px dashed ${color}`,
                  borderRadius: 12,
                  padding: 14,
                  textAlign: 'center',
                  transform: `rotate(${rot}deg)`,
                  transition: 'transform 0.25s',
                }}>
                  <p style={{
                    margin: '0 0 10px',
                    fontFamily: HAND, fontSize: 16, fontWeight: 800,
                    color, fontStyle: 'italic',
                  }}>
                    {label}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <button
                      onClick={() => setConfigLocal(c => ({ ...c, [key]: Math.max(min, c[key] - 1) }))}
                      style={{
                        width: 30, height: 30, borderRadius: 8,
                        border: '2px solid var(--text-primary)',
                        background: color, color: '#000',
                        fontFamily: HAND, fontSize: 20, fontWeight: 900,
                        cursor: 'pointer',
                        boxShadow: '1px 2px 0 var(--text-primary)',
                      }}>−</button>
                    <span style={{
                      fontFamily: HAND, fontSize: 30, fontWeight: 900,
                      color: 'var(--text-primary)', minWidth: 40, lineHeight: 1,
                    }}>
                      {configLocal[key]}
                    </span>
                    <button
                      onClick={() => setConfigLocal(c => ({ ...c, [key]: Math.min(max, c[key] + 1) }))}
                      style={{
                        width: 30, height: 30, borderRadius: 8,
                        border: '2px solid var(--text-primary)',
                        background: color, color: '#000',
                        fontFamily: HAND, fontSize: 20, fontWeight: 900,
                        cursor: 'pointer',
                        boxShadow: '1px 2px 0 var(--text-primary)',
                      }}>+</button>
                  </div>
                  <p style={{
                    margin: '6px 0 0',
                    fontFamily: BODY, fontSize: 13, fontStyle: 'italic',
                    color: 'var(--text-faint)',
                  }}>
                    ~ minutos ~
                  </p>
                </div>
              ))}
            </div>

            <button onClick={aplicarConfig}
              style={{
                width: '100%', padding: 12,
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: colorFase, color: '#000',
                fontFamily: HAND, fontSize: 20, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '3px 4px 0 var(--text-primary)',
                transform: 'rotate(-1deg)',
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}>
              ✅ Aplicar configuración
            </button>
          </div>
        </div>
      )}

      {/* SELECTOR DE FASE — pestañas cuaderno */}
      <div style={{
        display: 'flex', gap: 8,
        marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center',
      }}>
        {([
          { key: 'estudiar',       label: '🔥 Enfoque', color: '#ef4444' },
          { key: 'descanso',       label: '☕ Corto',   color: '#4ade80' },
          { key: 'descanso-largo', label: '🛋️ Largo',  color: '#60a5fa' },
        ] as const).map(({ key, label, color }, i) => {
          const active = fase === key;
          return (
            <button key={key}
              onClick={() => { if (!corriendo) resetear(); }}
              style={{
                padding: '8px 18px',
                borderRadius: 10,
                background: active ? color : 'var(--bg-card)',
                color: active ? '#000' : 'var(--text-muted)',
                border: `2.5px solid ${active ? color : 'var(--border-color)'}`,
                fontFamily: HAND, fontSize: 17, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: active ? '2px 3px 0 var(--text-primary)' : 'none',
                transform: active
                  ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                  : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* RELOJ */}
      <div style={{
        position: 'relative',
        marginBottom: 28,
        padding: 20,
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: '50%',
        boxShadow: `5px 6px 0 ${colorFase}, 0 0 32px ${colorFase}22`,
        transform: 'rotate(-0.5deg)',
      }}>
        <svg width="360" height="360" viewBox="0 0 360 360">
          <circle cx="180" cy="180" r="170"
            fill="var(--bg-card)"
            stroke="var(--text-primary)"
            strokeWidth="2"
          />
          <circle cx="180" cy="180" r={radio}
            fill="none"
            stroke="var(--bg-secondary)"
            strokeWidth="16"
          />
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
          <circle cx="180" cy="180" r={radio}
            fill="none"
            stroke={colorFase}
            strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(-90 180 180)"
            opacity="0.4"
            style={{ transition: 'stroke-dashoffset 1s linear', filter: 'blur(6px)' }}
          />

          {marcas.map((m, i) => (
            <line key={i}
              x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2}
              stroke={m.esMayor ? 'var(--text-primary)' : 'var(--border-color)'}
              strokeWidth={m.esMayor ? 2 : 1}
              strokeLinecap="round"
            />
          ))}

          {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map(n => {
            const ang = (n / 60) * 360 - 90;
            const rad = (ang * Math.PI) / 180;
            const r = 148;
            const x = 180 + r * Math.cos(rad);
            const y = 180 + r * Math.sin(rad);
            return (
              <text key={n} x={x} y={y}
                textAnchor="middle" dominantBaseline="middle"
                fill="var(--text-muted)"
                fontFamily={HAND}
                fontSize="13" fontWeight="800"
              >
                {n}
              </text>
            );
          })}

          <line x1="180" y1="180" x2={manecillaMinX} y2={manecillaMinY}
            stroke="var(--text-primary)" strokeWidth="3.5" strokeLinecap="round"
            style={{ transition: 'all 1s linear' }}
          />
          <line x1="180" y1="180" x2={manecillaX} y2={manecillaY}
            stroke={colorFase} strokeWidth="2.5" strokeLinecap="round"
            style={{ transition: 'all 1s linear' }}
          />

          <circle cx="180" cy="180" r="7" fill={colorFase} stroke="var(--text-primary)" strokeWidth="2"/>
          <circle cx="180" cy="180" r="3" fill="var(--bg-card)" />

          <text x="180" y="200"
            textAnchor="middle"
            fill="var(--text-primary)"
            fontFamily={HAND}
            fontSize="56"
            fontWeight="900"
            letterSpacing="-1"
          >
            {mm}:{ss}
          </text>

          <text x="180" y="226"
            textAnchor="middle"
            fill={colorFase}
            fontFamily={HAND}
            fontSize="16"
            fontWeight="800"
            fontStyle="italic"
          >
            {labelFase}
          </text>

          <text x="180" y="244"
            textAnchor="middle"
            fill="var(--text-muted)"
            fontFamily={HAND}
            fontSize="13"
            fontWeight="600"
            fontStyle="italic"
          >
            ~ {descripcionFase} ~
          </text>
        </svg>

        {corriendo && (
          <div style={{
            position: 'absolute',
            top: 14, right: 14,
            width: 14, height: 14,
            borderRadius: '50%',
            background: colorFase,
            border: '2px solid var(--text-primary)',
            animation: 'pulsePm 1.5s infinite',
            boxShadow: `0 0 10px ${colorFase}`,
          }} />
        )}
      </div>

      {/* STATS */}
      <div style={{
        display: 'flex', gap: 14, marginBottom: 22,
        flexWrap: 'wrap', justifyContent: 'center',
      }}>
        {[
          { label: 'pomodoros hoy', value: pomodorosHoy, emoji: '🍅', color: '#ef4444', rot: -2 },
          { label: 'ronda actual',  value: `${ronda}/4`, emoji: '🔄', color: colorFase, rot: 1.5 },
          { label: 'xp ganado',     value: `+${xpGanado}`, emoji: '⭐', color: '#fbbf24', rot: -1.5 },
        ].map(({ label, value, emoji, color, rot }) => (
          <div key={label} style={{
            background: 'var(--bg-card)',
            border: `2.5px solid var(--text-primary)`,
            borderRadius: 12,
            padding: '12px 18px',
            textAlign: 'center',
            minWidth: 110,
            boxShadow: `3px 4px 0 ${color}`,
            transform: `rotate(${rot}deg)`,
            transition: 'transform 0.25s',
          }}
            onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) translateY(-2px)'}
            onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${rot}deg)`}
          >
            <p style={{ margin: 0, fontSize: 22 }}>{emoji}</p>
            <p style={{
              margin: '4px 0',
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              color, lineHeight: 1,
            }}>
              {value}
            </p>
            <p style={{
              margin: 0,
              fontFamily: BODY, fontSize: 13, fontStyle: 'italic',
              color: 'var(--text-faint)', fontWeight: 600,
            }}>
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* Indicador rondas */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        {[1, 2, 3, 4].map(r => (
          <div key={r} style={{
            width: 18, height: 18, borderRadius: '50%',
            background: ronda > r ? colorFase : 'transparent',
            border: `2.5px solid ${ronda >= r ? colorFase : 'var(--border-color)'}`,
            transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
            boxShadow: ronda > r ? `2px 2px 0 var(--text-primary), 0 0 8px ${colorFase}` : 'none',
            transform: ronda > r ? `rotate(${(r % 2 === 0 ? -5 : 5)}deg)` : 'none',
          }} />
        ))}
      </div>

      {/* SELECTOR MATERIA */}
      <select value={materiaId} onChange={(e: any) => setMateriaId(e.target.value)}
        style={{
          width: '100%', maxWidth: 400,
          padding: '11px 16px',
          borderRadius: 12,
          border: '2.5px solid var(--text-primary)',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          fontFamily: HAND, fontSize: 18, fontWeight: 700,
          marginBottom: 22,
          outline: 'none',
          cursor: 'pointer',
          boxShadow: '3px 3px 0 var(--text-primary)',
          transform: 'rotate(-0.5deg)',
        }}>
        <option value="">📚 seleccionar materia (opcional)</option>
        {materias.map(m => (
          <option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>
        ))}
      </select>

      {/* CONTROLES */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 32, alignItems: 'center' }}>
        <button onClick={resetear}
          style={{
            width: 50, height: 50,
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontFamily: HAND, fontSize: 24, fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-2deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          title="Reiniciar"
          onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
          onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-2deg)';}}
        >
          ↺
        </button>

        <button onClick={corriendo ? pausar : iniciar}
          style={{
            padding: '14px 48px',
            borderRadius: 14,
            border: '2.5px solid var(--text-primary)',
            background: colorFase, color: '#000',
            fontFamily: HAND, fontSize: 24, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: `4px 5px 0 var(--text-primary), 0 6px 24px ${colorFase}55`,
            letterSpacing: 0.5,
            transform: 'rotate(-1deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseEnter={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(0deg) translateY(-3px)';
            e.currentTarget.style.boxShadow = `5px 7px 0 var(--text-primary), 0 8px 28px ${colorFase}66`;
          }}
          onMouseLeave={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(-1deg)';
            e.currentTarget.style.boxShadow = `4px 5px 0 var(--text-primary), 0 6px 24px ${colorFase}55`;
          }}
        >
          {corriendo ? '⏸ pausar' : '▶ iniciar'}
        </button>

        <button onClick={saltarFase}
          style={{
            width: 50, height: 50,
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontFamily: HAND, fontSize: 22, fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(2deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          title="Saltar fase"
          onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
          onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(2deg)';}}
        >
          ⏭
        </button>
      </div>

      {/* TIPS */}
      <div style={{
        maxWidth: 500,
        background: 'var(--bg-card)',
        border: `2.5px dashed ${colorFase}`,
        borderRadius: 14,
        padding: '16px 20px',
        textAlign: 'center',
        transform: 'rotate(-0.5deg)',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-3deg)',
          width: 60, height: 16,
          background: `color-mix(in srgb,${colorFase} 50%,transparent)`,
          border: `1px solid color-mix(in srgb,${colorFase} 30%,transparent)`,
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
        }}/>
        <p style={{
          margin: 0,
          fontFamily: BODY, fontSize: 18, fontWeight: 600,
          color: 'var(--text-muted)', fontStyle: 'italic',
          lineHeight: 1.4,
        }}>
          💡 {fase === 'estudiar'
            ? `~ silencia el teléfono, cierra redes y concéntrate en una sola tarea durante los próximos ${config.estudiar} min ~`
            : fase === 'descanso'
            ? '~ levántate, estira, toma agua. tu cerebro necesita esto ~'
            : '~ ¡excelente trabajo! 4 pomodoros completados. descanso largo bien merecido ~'}
        </p>
      </div>

      <style>{`
        @keyframes pulsePm {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
        @keyframes fadeInPm {
          from { opacity: 0; transform: translateY(-10px) rotate(-0.5deg); }
          to { opacity: 1; transform: translateY(0) rotate(-0.5deg); }
        }
      `}</style>
    </div>
  );
}