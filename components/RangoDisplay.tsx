'use client';

import { getRango, getProgresoRango, RANGOS } from '../lib/xpSystem';

interface Props {
  xpTotal: number;
  size?: 'sm' | 'md' | 'lg';
  mostrarProgreso?: boolean;
  mostrarNombre?: boolean;
}

export default function RangoDisplay({ xpTotal, size = 'md', mostrarProgreso = true, mostrarNombre = true }: Props) {
  const { rango, xpEnRango, xpRangoTotal, porcentaje, siguienteRango } = getProgresoRango(xpTotal);

  const sizes = {
    sm: { emoji: 20, nombre: 11, barra: 4, padding: '4px 10px' },
    md: { emoji: 28, nombre: 13, barra: 6, padding: '8px 16px' },
    lg: { emoji: 40, nombre: 16, barra: 8, padding: '12px 20px' },
  };

  const s = sizes[size];
  const esHimmy = rango.id === 'himmy';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: rango.marcoGradient,
        borderRadius: 12,
        padding: s.padding,
        boxShadow: `0 0 12px ${rango.color}44`,
      }}>
        <span style={{ fontSize: s.emoji }}>{rango.emoji}</span>
        {mostrarNombre && (
          <div>
            <div style={{ fontSize: s.nombre, fontWeight: 800, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
              {rango.nombre} {esHimmy ? '' : `${rango.division}`}
            </div>
            <div style={{ fontSize: s.nombre - 2, color: 'rgba(255,255,255,0.8)' }}>
              {xpTotal.toLocaleString()} XP
            </div>
          </div>
        )}
      </div>

      {mostrarProgreso && !esHimmy && siguienteRango && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{
            height: s.barra,
            background: 'var(--bg-tertiary, #1e293b)',
            borderRadius: s.barra,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${porcentaje}%`,
              background: rango.marcoGradient,
              borderRadius: s.barra,
              transition: 'width 0.6s ease',
              boxShadow: `0 0 8px ${rango.color}`,
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
            <span>{xpEnRango.toLocaleString()} / {xpRangoTotal.toLocaleString()} XP</span>
            <span>{siguienteRango.emoji} {siguienteRango.nombre} {siguienteRango.division}</span>
          </div>
        </div>
      )}

      {mostrarProgreso && esHimmy && (
        <div style={{
          fontSize: 12,
          color: '#f5c842',
          fontWeight: 700,
          textAlign: 'center',
          textShadow: '0 0 8px #f5c842',
        }}>
          👑 Rango máximo alcanzado
        </div>
      )}
    </div>
  );
}