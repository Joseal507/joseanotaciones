'use client';

import { useRef, useState } from 'react';
import { getRango, getProgresoRango } from '../lib/xpSystem';

const HAND = "'Caveat',cursive";

interface Stats {
  nombre: string;
  xpTotal: number;
  flashcards: number;
  precision: number;
  rachaActual: number;
  mejorRacha: number;
  rank: number;
  totalUsers: number;
  userId?: string;
  quizzes?: number;
  avatar?: string;
  universidad?: string;
  carrera?: string;
}

export default function PlayerCard({ stats }: { stats: Stats }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);
  const rango = getRango(stats.xpTotal);
  const { porcentaje } = getProgresoRango(stats.xpTotal);

  const maxFlash = 1000;
  const maxXp = 75000;
  const statBars = [
    { label: '🎴 Flashcards', value: stats.flashcards, max: maxFlash, color: '#f5c842' },
    { label: '🎯 Precisión',  value: stats.precision,  max: 100,      color: '#4ade80', suffix: '%' },
    { label: '⚡ XP',          value: stats.xpTotal,    max: maxXp,    color: '#38bdf8' },
    { label: '🔥 Racha',       value: stats.rachaActual,max: 100,      color: '#f97316', suffix: 'd' },
    { label: '🏆 Mejor',       value: stats.mejorRacha, max: 365,      color: '#a78bfa', suffix: 'd' },
    { label: '🤓 Quizzes',     value: stats.quizzes||0, max: 100,      color: '#f472b6' },
  ];

  const overall = Math.min(99, Math.round(
    (Math.min(stats.flashcards / maxFlash, 1) * 25) +
    (stats.precision / 100 * 25) +
    (Math.min(stats.xpTotal / maxXp, 1) * 25) +
    (Math.min(stats.mejorRacha / 100, 1) * 25)
  ));

  const overallColor = overall >= 80 ? '#f5c842' : overall >= 60 ? '#4ade80' : overall >= 40 ? '#38bdf8' : '#94a3b8';
  const inicial = (stats.nombre || 'U').charAt(0).toUpperCase();

  return (
    <div
      style={{ perspective: 1000, cursor: 'pointer', width: '100%', maxWidth: 320 }}
      onClick={() => setFlipped(!flipped)}
    >
      <div style={{
        position: 'relative',
        width: '100%',
        paddingBottom: '140%',
        transformStyle: 'preserve-3d',
        transition: 'transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
        transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}>

        {/* ── FRENTE ── */}
        <div ref={cardRef} style={{
          position: 'absolute', inset: 0,
          backfaceVisibility: 'hidden',
          borderRadius: 14,
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          overflow: 'hidden',
          boxShadow: `5px 6px 0 var(--text-primary), 0 12px 36px rgba(0,0,0,0.35)`,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Banda rango (header) */}
          <div style={{
            padding: '8px 14px',
            background: rango.marcoGradient,
            borderBottom: '2px solid var(--text-primary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            position: 'relative',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 22 }}>{rango.emoji}</span>
              <span style={{
                fontFamily: HAND, fontSize: 20, fontWeight: 900,
                color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                lineHeight: 1, fontStyle: 'italic',
              }}>
                {rango.nombre} {rango.id !== 'himmy' ? rango.division : ''}
              </span>
            </div>
            {/* Rank postit */}
            <div style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1.5px solid rgba(255,255,255,0.4)',
              borderRadius: 8,
              padding: '3px 10px',
              fontFamily: HAND,
              fontSize: 18, fontWeight: 900,
              color: '#fff',
              transform: 'rotate(3deg)',
              boxShadow: '2px 2px 0 rgba(0,0,0,0.4)',
            }}>
              #{stats.rank}
            </div>
          </div>

          {/* Avatar + Overall */}
          <div style={{
            padding: '14px 16px 8px',
            display: 'flex', gap: 14, alignItems: 'center',
            position: 'relative',
          }}>
            {/* margen rojo cuaderno sutil */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: 28, width: 1.5,
              background: '#ef4444', opacity: 0.18,
              pointerEvents: 'none',
            }}/>

            {/* Avatar tipo polaroid */}
            <div style={{
              width: 76, height: 76, borderRadius: 12,
              overflow: 'hidden', flexShrink: 0,
              border: '2.5px solid var(--text-primary)',
              background: stats.avatar ? 'transparent' : rango.marcoGradient,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: HAND,
              fontSize: 38, fontWeight: 900, color: '#fff',
              boxShadow: `3px 3px 0 ${rango.color}`,
              transform: 'rotate(-3deg)',
              transition: 'transform 0.3s',
            }}>
              {stats.avatar
                ? <img src={stats.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : inicial}
            </div>

            {/* OVR grande */}
            <div style={{ flex: 1, position: 'relative' }}>
              <div style={{
                fontFamily: HAND,
                fontSize: 52, fontWeight: 900,
                color: overallColor,
                lineHeight: 0.9,
                textShadow: `0 0 12px ${overallColor}55`,
                transform: 'rotate(-2deg)',
                display: 'inline-block',
              }}>
                {overall}
              </div>
              <div style={{
                fontFamily: HAND, fontSize: 14, fontWeight: 800,
                color: 'var(--text-muted)',
                fontStyle: 'italic',
                marginTop: 2,
                transform: 'rotate(-2deg)',
                display: 'inline-block',
              }}>
                ✦ OVR ✦
              </div>
            </div>
          </div>

          {/* Nombre */}
          <div style={{ padding: '0 16px 6px' }}>
            <div style={{
              fontFamily: HAND, fontSize: 26, fontWeight: 900,
              color: 'var(--text-primary)', lineHeight: 1.05,
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              {stats.nombre}
            </div>
            {(stats.universidad || stats.carrera) && (
              <div style={{
                fontFamily: HAND, fontSize: 13,
                color: 'var(--text-faint)', marginTop: 2,
                fontStyle: 'italic',
              }}>
                {stats.carrera && <span>{stats.carrera}</span>}
                {stats.carrera && stats.universidad && <span> · </span>}
                {stats.universidad && <span>{stats.universidad}</span>}
              </div>
            )}
          </div>

          {/* Separador dashed */}
          <div style={{
            margin: '4px 16px',
            borderTop: '1.5px dashed var(--border-color)',
          }}/>

          {/* Stat bars con vibra cuaderno */}
          <div style={{
            padding: '6px 16px 12px',
            flex: 1,
            display: 'flex', flexDirection: 'column',
            gap: 7, justifyContent: 'center',
          }}>
            {statBars.map((bar, i) => {
              const pct = Math.min(100, (bar.value / bar.max) * 100);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontFamily: HAND, fontSize: 14, fontWeight: 700,
                    color: 'var(--text-muted)',
                    width: 96, flexShrink: 0,
                  }}>
                    {bar.label}
                  </span>
                  <div style={{
                    flex: 1, height: 9,
                    background: 'var(--bg-secondary)',
                    border: '1.5px solid var(--text-primary)',
                    borderRadius: 5, overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: bar.color,
                      borderRadius: 3,
                      transition: 'width 1s cubic-bezier(.25,.8,.25,1)',
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3)`,
                    }} />
                  </div>
                  <span style={{
                    fontFamily: HAND, fontSize: 15, fontWeight: 800,
                    color: bar.color,
                    minWidth: 38, textAlign: 'right',
                  }}>
                    {bar.value.toLocaleString()}{bar.suffix || ''}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{
            padding: '6px 14px',
            background: 'var(--bg-secondary)',
            borderTop: '1.5px dashed var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{
              fontFamily: HAND, fontSize: 12, fontWeight: 700,
              color: 'var(--text-faint)', fontStyle: 'italic',
            }}>
              ✦ STUDYAL CARD ✦
            </span>
            <span style={{
              fontFamily: HAND, fontSize: 13, fontWeight: 700,
              color: 'var(--gold)', fontStyle: 'italic',
            }}>
              voltear →
            </span>
          </div>
        </div>

        {/* ── REVERSO ── */}
        <div style={{
          position: 'absolute', inset: 0,
          backfaceVisibility: 'hidden',
          transform: 'rotateY(180deg)',
          borderRadius: 14,
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          overflow: 'hidden',
          boxShadow: `5px 6px 0 var(--text-primary), 0 12px 36px rgba(0,0,0,0.35)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 22,
          gap: 14,
          position: 'relative',
        }}>
          {/* Banda arriba */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            background: rango.marcoGradient,
            padding: '6px 14px',
            borderBottom: '2px solid var(--text-primary)',
            textAlign: 'center',
          }}>
            <span style={{
              fontFamily: HAND, fontSize: 16, fontWeight: 800,
              color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              fontStyle: 'italic',
            }}>
              📲 mi perfil
            </span>
          </div>

          {/* QR Code estilo polaroid */}
          <div style={{
            background: '#fff',
            borderRadius: 8,
            padding: 14,
            paddingBottom: 24,
            border: '2.5px solid var(--text-primary)',
            boxShadow: `4px 4px 0 ${rango.color}`,
            transform: 'rotate(-2deg)',
            marginTop: 30,
          }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/u/${stats.userId || stats.nombre}` : '')}&bgcolor=ffffff&color=000000&format=svg`}
              alt="QR"
              style={{ width: 160, height: 160, display: 'block' }}
            />
          </div>

          {/* Info */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: HAND, fontSize: 24, fontWeight: 900,
              color: 'var(--text-primary)', marginBottom: 4,
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              {stats.nombre}
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: rango.marcoGradient,
              border: '2px solid var(--text-primary)',
              boxShadow: '2px 2px 0 var(--text-primary)',
              borderRadius: 8, padding: '4px 12px',
              transform: 'rotate(2deg)',
            }}>
              <span style={{ fontSize: 16 }}>{rango.emoji}</span>
              <span style={{
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                fontStyle: 'italic',
              }}>
                {rango.nombre} {rango.id !== 'himmy' ? rango.division : ''}
              </span>
            </div>
          </div>

          {/* Stats resumen */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
            {[
              { label: 'OVR',       value: overall,                       color: overallColor, rot: -1.5 },
              { label: 'Rank',      value: `#${stats.rank}`,              color: rango.color,  rot:  1.5 },
              { label: 'XP',        value: stats.xpTotal.toLocaleString(),color: '#f5c842',    rot: -1   },
              { label: 'Precisión', value: `${stats.precision}%`,         color: '#4ade80',    rot:  1   },
            ].map((s, i) => (
              <div key={i} style={{
                background: 'var(--bg-secondary)',
                border: `2px dashed ${s.color}`,
                borderRadius: 10,
                padding: '8px 6px',
                textAlign: 'center',
                transform: `rotate(${s.rot}deg)`,
                transition: 'transform 0.25s',
              }}
                onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.05)'}
                onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${s.rot}deg)`}
              >
                <div style={{
                  fontFamily: HAND, fontSize: 22, fontWeight: 900,
                  color: s.color, lineHeight: 1,
                }}>{s.value}</div>
                <div style={{
                  fontFamily: HAND, fontSize: 12, fontWeight: 700,
                  color: 'var(--text-faint)', fontStyle: 'italic',
                  marginTop: 2,
                }}>{s.label}</div>
              </div>
            ))}
          </div>

          <p style={{
            fontFamily: HAND, fontSize: 14,
            color: 'var(--text-muted)', margin: 0,
            fontStyle: 'italic',
          }}>
            ~ escanea o toca para voltear ~
          </p>
        </div>
      </div>
    </div>
  );
}
