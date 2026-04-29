'use client';

import { RANGOS, getRango } from '../lib/xpSystem';

interface Props {
  xpTotal: number;
}

export default function TablaRangos({ xpTotal }: Props) {
  const rangoActual = getRango(xpTotal);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
        🗺️ Tabla de Rangos
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {RANGOS.map(rango => {
          const esActual = rango.id === rangoActual.id;
          const esAlcanzado = xpTotal >= rango.xpMinimo;
          const esHimmy = rango.id === 'himmy';

          return (
            <div
              key={rango.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 10,
                background: esActual ? rango.color + '20' : 'var(--bg-secondary)',
                border: `1.5px solid ${esActual ? rango.color : 'var(--border-color)'}`,
                opacity: esAlcanzado ? 1 : 0.5,
                boxShadow: esActual ? `0 0 12px ${rango.color}44` : 'none',
              }}
            >
              {/* Emoji */}
              <span style={{ fontSize: 20, filter: esAlcanzado ? 'none' : 'grayscale(1)' }}>
                {rango.emoji}
              </span>

              {/* Nombre */}
              <div style={{ flex: 1 }}>
                <span style={{
                  fontSize: 13,
                  fontWeight: esActual ? 800 : 600,
                  color: esActual ? rango.color : 'var(--text-primary)',
                }}>
                  {rango.nombre} {esHimmy ? '' : rango.division}
                </span>
                {esActual && (
                  <span style={{
                    marginLeft: 8,
                    fontSize: 10,
                    background: rango.color,
                    color: '#000',
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontWeight: 700,
                  }}>
                    ACTUAL
                  </span>
                )}
              </div>

              {/* XP requerido */}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                {esHimmy ? '75,000+' : `${rango.xpMinimo.toLocaleString()} XP`}
              </span>

              {/* Check */}
              {esAlcanzado && (
                <span style={{ fontSize: 14, color: rango.color }}>✓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
