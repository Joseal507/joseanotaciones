'use client';

import { useState, useEffect } from 'react';
import { verificarRacha, cargarRachaDesdeDB, getHoyStr, RachaData } from '../lib/racha';
import { useIdioma } from '../hooks/useIdioma';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Props {
  compact?: boolean;
}

export default function RachaWidget({ compact = false }: Props) {
  const [racha, setRacha] = useState<RachaData | null>(null);
  const hoy = getHoyStr();
  const { tr, idioma } = useIdioma();

  useEffect(() => {
    setRacha(verificarRacha());
    cargarRachaDesdeDB().then((rachaDB) => {
      setRacha(rachaDB);
    }).catch(() => {});
  }, []);

  if (!racha) return null;

  const estudióHoy = racha.ultimoDia === hoy;
  const tieneRacha = racha.rachaActual > 0;

  const ultimos7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const diasEs = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const diasEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dias = idioma === 'en' ? diasEn : diasEs;
    ultimos7.push({
      fecha: str,
      dia: dias[d.getDay()],
      esHoy: str === hoy,
      estudió: racha.diasEstudiados.includes(str),
    });
  }

  // ─── COMPACT: badge pequeño tipo postit ───
  if (compact) {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 12px',
        borderRadius: 10,
        background: tieneRacha
          ? 'color-mix(in srgb,var(--gold) 18%,var(--bg-card))'
          : 'var(--bg-secondary)',
        border: `2px solid ${tieneRacha ? 'var(--gold)' : 'var(--border-color)'}`,
        boxShadow: tieneRacha ? '2px 2px 0 var(--gold)' : 'none',
        transform: 'rotate(-1.5deg)',
      }}>
        <span style={{ fontSize: 18 }}>🔥</span>
        <span style={{
          fontFamily: HAND, fontSize: 20, fontWeight: 900,
          color: tieneRacha ? 'var(--gold)' : 'var(--text-faint)',
          lineHeight: 1,
        }}>
          {racha.rachaActual}
        </span>
        {!estudióHoy && tieneRacha && (
          <span style={{
            fontFamily: HAND, fontSize: 14, fontWeight: 800,
            color: 'var(--red)',
            animation: 'nbBlink 1s infinite',
          }}>
            !
          </span>
        )}
      </div>
    );
  }

  // ─── FULL ───
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `2.5px solid var(--text-primary)`,
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: tieneRacha
        ? '4px 5px 0 var(--gold)'
        : '4px 5px 0 var(--text-primary)',
      transform: 'rotate(-0.4deg)',
      position: 'relative',
      width: '100%',
      maxWidth: 380,
    }}>
      {/* Banda título dorada */}
      <div style={{
        background: tieneRacha ? 'var(--gold)' : 'var(--bg-secondary)',
        padding: '6px 16px',
        borderBottom: '2px solid var(--text-primary)',
        position: 'relative',
      }}>
        <span style={{
          fontFamily: HAND, fontSize: 16, fontWeight: 800,
          color: tieneRacha ? '#000' : 'var(--text-muted)',

        }}>
          🔥 {idioma === 'en' ? 'Your Streak' : 'Tu racha'}
        </span>
      </div>

      <div style={{ padding: '18px 20px', position: 'relative' }}>
        {/* margen rojo cuaderno */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: 36, width: 1.5,
          background: '#ef4444', opacity: 0.25,
          pointerEvents: 'none',
        }}/>

        {/* Stats principales lado a lado */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          gap: 12,
          position: 'relative',
        }}>
          {/* Racha actual */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            transform: 'rotate(-1deg)',
          }}>
            <div style={{
              fontSize: 44,
              filter: tieneRacha ? 'drop-shadow(0 0 8px color-mix(in srgb, var(--gold) 60%, transparent))' : 'grayscale(0.6)',
              animation: tieneRacha ? 'nbFire 2s infinite' : 'none',
            }}>
              🔥
            </div>
            <div>
              <div style={{
                fontFamily: HAND, fontSize: 56, fontWeight: 900,
                color: tieneRacha ? 'var(--gold)' : 'var(--text-faint)',
                lineHeight: 0.9,
                textShadow: tieneRacha ? '0 0 12px color-mix(in srgb, var(--gold) 40%, transparent)' : 'none',
              }}>
                {racha.rachaActual}
              </div>
              <div style={{
                fontFamily: BODY, fontSize: 15, fontWeight: 700,
                color: 'var(--text-muted)',
                marginTop: 2,
              }}>
                {racha.rachaActual === 1 ? tr('diaRacha') : tr('diasRacha')}
              </div>
            </div>
          </div>

          {/* Mejor racha (postit) */}
          <div style={{
            background: 'color-mix(in srgb,var(--gold) 14%,var(--bg-secondary))',
            border: '2.5px dashed var(--gold)',
            borderRadius: 10,
            padding: '8px 12px',
            textAlign: 'center',
            transform: 'rotate(2deg)',
            boxShadow: '2px 3px 0 color-mix(in srgb, var(--gold) 40%, transparent)',
          }}>
            <div style={{
              fontFamily: BODY, fontSize: 12, fontWeight: 700,
              color: 'var(--text-muted)',
              lineHeight: 1,
            }}>
              {tr('mejorRacha')}
            </div>
            <div style={{
              fontFamily: HAND, fontSize: 26, fontWeight: 900,
              color: 'var(--text-primary)', lineHeight: 1.05,
              marginTop: 3,
            }}>
              🏆 {racha.mejorRacha}
            </div>
          </div>
        </div>

        {/* Aviso "estudiá hoy" o "ya estudiaste" */}
        {!estudióHoy && tieneRacha && (
          <div style={{
            background: 'color-mix(in srgb,var(--red) 14%,transparent)',
            border: '2.5px dashed var(--red)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 10,
            transform: 'rotate(0.5deg)',
            position: 'relative',
          }}>
            <span style={{ fontSize: 22, animation: 'nbShake 2s infinite' }}>⚠️</span>
            <p style={{
              fontFamily: HAND, fontSize: 17, fontWeight: 700,
              color: 'var(--red)', margin: 0, lineHeight: 1.15,
            }}>
              {tr('estudiaHoyRacha')} <strong>{racha.rachaActual}</strong> {tr('dias')}
            </p>
          </div>
        )}

        {estudióHoy && (
          <div style={{
            background: 'color-mix(in srgb,#4ade80 18%,transparent)',
            border: '2.5px solid #4ade80',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '2px 3px 0 #4ade8055',
            transform: 'rotate(-0.5deg)',
            position: 'relative',
          }}>
            <span style={{ fontSize: 22 }}>✅</span>
            <p style={{
              fontFamily: HAND, fontSize: 17, fontWeight: 800,
              color: '#16a34a', margin: 0, lineHeight: 1.15,
            }}>
              {tr('yaEstudiaste')}
            </p>
          </div>
        )}

        {/* Últimos 7 días */}
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1.5px dashed var(--border-color)',
          borderRadius: 10,
          padding: '10px 8px',
          marginBottom: 14,
          position: 'relative',
        }}>
          <p style={{
            fontFamily: BODY, fontSize: 13,
            color: 'var(--text-muted)',
            margin: '0 0 8px', textAlign: 'center',
          }}>
            ~ últimos 7 días ~
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-around', gap: 4 }}>
            {ultimos7.map((d, i) => (
              <div key={i} style={{ textAlign: 'center', flex: 1 }}>
                <div style={{
                  fontFamily: HAND, fontSize: 13, fontWeight: 800,
                  color: d.esHoy ? 'var(--gold)' : 'var(--text-faint)',
                  marginBottom: 4, lineHeight: 1,
                }}>
                  {d.dia}
                </div>
                <div style={{
                  width: 34, height: 34,
                  borderRadius: 8,
                  margin: '0 auto',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                  background: d.estudió
                    ? 'var(--gold)'
                    : d.esHoy
                      ? 'color-mix(in srgb,var(--gold) 18%,transparent)'
                      : 'var(--bg-card)',
                  border: d.estudió
                    ? '2.5px solid var(--text-primary)'
                    : d.esHoy
                      ? '2.5px dashed var(--gold)'
                      : '1.5px dashed var(--border-color)',
                  boxShadow: d.estudió ? '2px 2px 0 var(--text-primary)' : 'none',
                  transform: d.estudió
                    ? `rotate(${i % 2 === 0 ? -3 : 3}deg)`
                    : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
                  transition: 'transform 0.25s',
                }}>
                  {d.estudió ? '🔥' : d.esHoy ? '?' : '·'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hitos */}
        <div>
          <p style={{
            fontFamily: BODY, fontSize: 13,
            color: 'var(--text-muted)',
            margin: '0 0 6px',
          }}>
            ✨ hitos
          </p>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {[
              { dias: 3,   emoji: '⭐', label: idioma === 'en' ? '3 days'    : '3 días'    },
              { dias: 7,   emoji: '🌟', label: idioma === 'en' ? '1 week'    : '1 semana'  },
              { dias: 14,  emoji: '💫', label: idioma === 'en' ? '2 weeks'   : '2 semanas' },
              { dias: 30,  emoji: '🏆', label: idioma === 'en' ? '1 month'   : '1 mes'     },
              { dias: 60,  emoji: '👑', label: idioma === 'en' ? '2 months'  : '2 meses'   },
              { dias: 100, emoji: '💎', label: idioma === 'en' ? '100 days'  : '100 días'  },
            ].map((m, i) => {
              const desbloqueado = racha.rachaActual >= m.dias;
              return (
                <div key={m.dias} style={{
                  padding: '4px 10px',
                  borderRadius: 8,
                  fontFamily: HAND, fontSize: 14, fontWeight: 800,
                  background: desbloqueado
                    ? 'var(--gold)'
                    : 'var(--bg-secondary)',
                  color: desbloqueado ? '#000' : 'var(--text-faint)',
                  border: `2px ${desbloqueado ? 'solid' : 'dashed'} ${desbloqueado ? 'var(--text-primary)' : 'var(--border-color)'}`,
                  boxShadow: desbloqueado ? '2px 2px 0 var(--text-primary)' : 'none',
                  transform: desbloqueado
                    ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                    : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
                  opacity: desbloqueado ? 1 : 0.55,
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                  cursor: 'default',
                }}
                  onMouseEnter={(e:any)=>{
                    if (desbloqueado) e.currentTarget.style.transform = 'rotate(0deg) scale(1.08)';
                  }}
                  onMouseLeave={(e:any)=>{
                    e.currentTarget.style.transform = desbloqueado
                      ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                      : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`;
                  }}
                >
                  {m.emoji} {m.label}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes nbFire {
          0%, 100% { transform: scale(1) rotate(-3deg); }
          25%      { transform: scale(1.08) rotate(2deg); }
          50%      { transform: scale(1.04) rotate(-1deg); }
          75%      { transform: scale(1.1) rotate(3deg); }
        }
        @keyframes nbShake {
          0%, 100% { transform: rotate(0deg); }
          25%      { transform: rotate(-10deg); }
          75%      { transform: rotate(10deg); }
        }
        @keyframes nbBlink {
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}