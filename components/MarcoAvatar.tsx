'use client';

import { getRango, MARCOS } from '../lib/xpSystem';

interface Props {
  xpTotal: number;
  fotoPerfil?: string;
  nombre?: string;
  size?: number;
  marcoPersonalizado?: string; // id del marco elegido por el user
}

export default function MarcoAvatar({ xpTotal, fotoPerfil, nombre, size = 64, marcoPersonalizado }: Props) {
  const rango = getRango(xpTotal);
  const esHimmy = rango.id === 'himmy';

  // Usar marco personalizado si existe, sino el del rango
  const marco = marcoPersonalizado && MARCOS[marcoPersonalizado]
    ? MARCOS[marcoPersonalizado]
    : null;

  const gradiente = marco ? marco.gradient : rango.marcoGradient;
  const borderSize = Math.max(3, Math.round(size * 0.06));
  const glowColor = rango.color;

  const iniciales = nombre
    ? nombre.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <div style={{
      position: 'relative',
      width: size,
      height: size,
      flexShrink: 0,
    }}>
      {/* Marco exterior */}
      <div style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        background: gradiente,
        boxShadow: esHimmy
          ? `0 0 20px ${glowColor}, 0 0 40px ${glowColor}44`
          : `0 0 10px ${glowColor}66`,
        animation: (esHimmy || (marco?.animado)) ? 'spin-slow 4s linear infinite' : 'none',
      }} />

      {/* Foto o iniciales */}
      <div style={{
        position: 'absolute',
        inset: borderSize,
        borderRadius: '50%',
        overflow: 'hidden',
        background: 'var(--bg-secondary, #1e293b)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {fotoPerfil ? (
          <img src={fotoPerfil} alt={nombre || 'avatar'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{
            fontSize: size * 0.35,
            fontWeight: 800,
            color: 'var(--text-primary)',
          }}>
            {iniciales}
          </span>
        )}
      </div>

      {/* Badge del rango (esquina inferior derecha) */}
      {size >= 48 && (
        <div style={{
          position: 'absolute',
          bottom: -2,
          right: -2,
          width: size * 0.32,
          height: size * 0.32,
          borderRadius: '50%',
          background: gradiente,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.17,
          border: '2px solid var(--bg-primary, #0a0a0f)',
          boxShadow: `0 0 6px ${glowColor}`,
        }}>
          {rango.emoji}
        </div>
      )}
    </div>
  );
}
