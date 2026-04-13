'use client';

import { useState, useEffect } from 'react';
import { verificarRacha, getHoyStr, RachaData } from '../lib/racha';

interface Props {
  compact?: boolean;
}

export default function RachaWidget({ compact = false }: Props) {
  const [racha, setRacha] = useState<RachaData | null>(null);
  const hoy = getHoyStr();

  useEffect(() => {
    setRacha(verificarRacha());
  }, []);

  if (!racha) return null;

  const estudióHoy = racha.ultimoDia === hoy;

  const ultimos7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    ultimos7.push({
      fecha: str,
      dia: dias[d.getDay()],
      esHoy: str === hoy,
      estudió: racha.diasEstudiados.includes(str),
    });
  }

  if (compact) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '10px',
        background: racha.rachaActual > 0 ? 'var(--gold-dim)' : 'var(--bg-secondary)',
        border: `1px solid ${racha.rachaActual > 0 ? 'var(--gold-border)' : 'var(--border-color)'}`,
      }}>
        <span style={{ fontSize: '16px' }}>🔥</span>
        <span style={{ fontSize: '15px', fontWeight: 900, color: racha.rachaActual > 0 ? 'var(--gold)' : 'var(--text-faint)' }}>
          {racha.rachaActual}
        </span>
        {!estudióHoy && racha.rachaActual > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--red)', fontWeight: 700 }}>!</span>
        )}
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: '16px',
      border: `1px solid ${racha.rachaActual > 0 ? 'var(--gold-border)' : 'var(--border-color)'}`,
      overflow: 'hidden',
    }}>
      <div style={{ height: '4px', background: racha.rachaActual > 0 ? 'var(--gold)' : 'var(--border-color)' }} />
      <div style={{ padding: '20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '32px' }}>🔥</span>
            <div>
              <div style={{ fontSize: '28px', fontWeight: 900, color: racha.rachaActual > 0 ? 'var(--gold)' : 'var(--text-faint)', lineHeight: 1 }}>
                {racha.rachaActual}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                {racha.rachaActual === 1 ? 'día de racha' : 'días de racha'}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-faint)' }}>Mejor racha</div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)' }}>🏆 {racha.mejorRacha}</div>
          </div>
        </div>

        {/* Alerta */}
        {!estudióHoy && racha.rachaActual > 0 && (
          <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red-border)', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>⚠️</span>
            <p style={{ fontSize: '13px', color: 'var(--red)', margin: 0, fontWeight: 600 }}>
              ¡Estudia hoy para no perder tu racha de {racha.rachaActual} días!
            </p>
          </div>
        )}

        {estudióHoy && (
          <div style={{ background: '#4ade8015', border: '1px solid #4ade8044', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>✅</span>
            <p style={{ fontSize: '13px', color: '#4ade80', margin: 0, fontWeight: 600 }}>
              ¡Ya estudiaste hoy! Racha asegurada 💪
            </p>
          </div>
        )}

        {/* Últimos 7 días */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px', marginBottom: '16px' }}>
          {ultimos7.map((d, i) => (
            <div key={i} style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: '10px', color: d.esHoy ? 'var(--gold)' : 'var(--text-faint)', fontWeight: 700, marginBottom: '6px' }}>
                {d.dia}
              </div>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                background: d.estudió ? 'var(--gold)' : d.esHoy ? 'var(--gold-dim)' : 'var(--bg-secondary)',
                border: d.esHoy && !d.estudió ? '2px dashed var(--gold)' : d.esHoy ? '2px solid var(--gold)' : '2px solid transparent',
                color: d.estudió ? '#000' : 'var(--text-faint)',
                fontWeight: 800,
              }}>
                {d.estudió ? '🔥' : d.esHoy ? '❓' : '·'}
              </div>
            </div>
          ))}
        </div>

        {/* Milestones */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[
            { dias: 3, emoji: '⭐', label: '3 días' },
            { dias: 7, emoji: '🌟', label: '1 semana' },
            { dias: 14, emoji: '💫', label: '2 semanas' },
            { dias: 30, emoji: '🏆', label: '1 mes' },
            { dias: 60, emoji: '👑', label: '2 meses' },
            { dias: 100, emoji: '💎', label: '100 días' },
          ].map(m => (
            <div key={m.dias} style={{
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              background: racha.rachaActual >= m.dias ? 'var(--gold)' : 'var(--bg-secondary)',
              color: racha.rachaActual >= m.dias ? '#000' : 'var(--text-faint)',
              border: `1px solid ${racha.rachaActual >= m.dias ? 'var(--gold)' : 'var(--border-color)'}`,
              opacity: racha.rachaActual >= m.dias ? 1 : 0.5,
            }}>
              {m.emoji} {m.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}