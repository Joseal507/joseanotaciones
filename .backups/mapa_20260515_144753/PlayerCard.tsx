'use client';

import { useRef, useState } from 'react';
import { getRango, getProgresoRango } from '../lib/xpSystem';

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

  // Stat bars
  const maxFlash = 1000;
  const maxXp = 75000;
  const statBars = [
    { label: '🎴 Flashcards', value: stats.flashcards, max: maxFlash, color: '#f5c842' },
    { label: '🎯 Precisión', value: stats.precision, max: 100, color: '#4ade80', suffix: '%' },
    { label: '⚡ XP', value: stats.xpTotal, max: maxXp, color: '#38bdf8' },
    { label: '🔥 Racha', value: stats.rachaActual, max: 100, color: '#f97316', suffix: 'd' },
    { label: '🏆 Mejor', value: stats.mejorRacha, max: 365, color: '#a78bfa', suffix: 'd' },
    { label: '🤓 Quizzes', value: stats.quizzes || 0, max: 100, color: '#f472b6' },
  ];

  // Overall rating (0-99)
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
      style={{ perspective: '1000px', cursor: 'pointer', width: '100%', maxWidth: 320 }}
      onClick={() => setFlipped(!flipped)}
    >
      <div style={{
        position: 'relative',
        width: '100%',
        paddingBottom: '140%',
        transformStyle: 'preserve-3d',
        transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        transform: flipped ? 'rotateY(180deg)' : 'rotateY(0)',
      }}>

        {/* ── FRENTE ── */}
        <div ref={cardRef} style={{
          position: 'absolute', inset: 0,
          backfaceVisibility: 'hidden',
          borderRadius: 20,
          background: `linear-gradient(145deg, #0a0a1a 0%, #111827 50%, ${rango.color}15 100%)`,
          border: `2px solid ${rango.color}66`,
          overflow: 'hidden',
          boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 20px ${rango.color}22`,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header con rango */}
          <div style={{
            padding: '14px 16px 10px',
            background: rango.marcoGradient,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>{rango.emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                {rango.nombre} {rango.id !== 'himmy' ? rango.division : ''}
              </span>
            </div>
            <div style={{
              background: 'rgba(0,0,0,0.4)',
              borderRadius: 8,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 800,
              color: '#fff',
            }}>
              #{stats.rank}
            </div>
          </div>

          {/* Avatar + Overall */}
          <div style={{ padding: '16px 16px 8px', display: 'flex', gap: 14, alignItems: 'center' }}>
            {/* Avatar */}
            <div style={{
              width: 72, height: 72, borderRadius: 14,
              overflow: 'hidden', flexShrink: 0,
              border: `3px solid ${rango.color}`,
              background: stats.avatar ? 'transparent' : rango.marcoGradient,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30, fontWeight: 900, color: '#fff',
              boxShadow: `0 0 12px ${rango.color}44`,
            }}>
              {stats.avatar
                ? <img src={stats.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : inicial}
            </div>

            {/* Overall rating */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 44, fontWeight: 900, color: overallColor, lineHeight: 1 }}>
                {overall}
              </div>
              <div style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                OVR
              </div>
            </div>
          </div>

          {/* Nombre */}
          <div style={{ padding: '4px 16px 6px' }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1.2 }}>
              {stats.nombre}
            </div>
            {(stats.universidad || stats.carrera) && (
              <div style={{ fontSize: 10, color: '#888', marginTop: 3 }}>
                {stats.carrera && <span>{stats.carrera}</span>}
                {stats.carrera && stats.universidad && <span> · </span>}
                {stats.universidad && <span>{stats.universidad}</span>}
              </div>
            )}
          </div>

          {/* Separador */}
          <div style={{ height: 1, background: `${rango.color}33`, margin: '6px 16px' }} />

          {/* Stat bars */}
          <div style={{ padding: '4px 16px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 7, justifyContent: 'center' }}>
            {statBars.map((bar, i) => {
              const pct = Math.min(100, (bar.value / bar.max) * 100);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#aaa', fontWeight: 700, width: 90, flexShrink: 0 }}>
                    {bar.label}
                  </span>
                  <div style={{ flex: 1, height: 6, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: bar.color,
                      borderRadius: 3,
                      transition: 'width 1s ease',
                      boxShadow: `0 0 6px ${bar.color}66`,
                    }} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, color: bar.color, minWidth: 32, textAlign: 'right' }}>
                    {bar.value.toLocaleString()}{bar.suffix || ''}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{
            padding: '8px 16px',
            background: 'rgba(0,0,0,0.3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            <span style={{ fontSize: 9, color: '#555', fontWeight: 600 }}>STUDYAL PLAYER CARD</span>
            <span style={{ fontSize: 9, color: '#555' }}>Toca para voltear →</span>
          </div>
        </div>

        {/* ── REVERSO ── */}
        <div style={{
          position: 'absolute', inset: 0,
          backfaceVisibility: 'hidden',
          transform: 'rotateY(180deg)',
          borderRadius: 20,
          background: 'linear-gradient(145deg, #0a0a1a 0%, #111827 100%)',
          border: `2px solid ${rango.color}66`,
          overflow: 'hidden',
          boxShadow: `0 8px 32px rgba(0,0,0,0.5)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 16,
        }}>
          {/* QR Code */}
          <div style={{
            background: '#fff',
            borderRadius: 16,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/u/${stats.userId || stats.nombre}` : '')}&bgcolor=ffffff&color=000000&format=svg`}
              alt="QR"
              style={{ width: 160, height: 160 }}
            />
          </div>

          {/* Info */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 4 }}>
              {stats.nombre}
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: rango.marcoGradient,
              borderRadius: 8, padding: '4px 12px',
            }}>
              <span style={{ fontSize: 14 }}>{rango.emoji}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                {rango.nombre} {rango.id !== 'himmy' ? rango.division : ''}
              </span>
            </div>
          </div>

          {/* Stats resumen */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
            {[
              { label: 'OVR', value: overall, color: overallColor },
              { label: 'Rank', value: `#${stats.rank}`, color: rango.color },
              { label: 'XP', value: stats.xpTotal.toLocaleString(), color: '#f5c842' },
              { label: 'Precisión', value: `${stats.precision}%`, color: '#4ade80' },
            ].map((s, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 10, padding: '8px 6px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 9, color: '#888', fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Scan text */}
          <p style={{ fontSize: 11, color: '#555', margin: 0 }}>
            Escanea para ver mi perfil · Toca para voltear
          </p>
        </div>
      </div>
    </div>
  );
}
