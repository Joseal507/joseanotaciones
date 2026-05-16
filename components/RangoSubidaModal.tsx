'use client';

import { useEffect, useState } from 'react';
import { Rango } from '../lib/xpSystem';

interface Props {
  rangoAnterior: Rango;
  rangoNuevo: Rango;
  onClose: () => void;
}

export default function RangoSubidaModal({ rangoAnterior, rangoNuevo, onClose }: Props) {
  const [fase, setFase] = useState<'entrada' | 'show' | 'salida'>('entrada');
  const esHimmy = rangoNuevo.id === 'himmy';

  useEffect(() => {
    const t1 = setTimeout(() => setFase('show'), 100);
    const t2 = setTimeout(() => setFase('salida'), 4500);
    const t3 = setTimeout(() => onClose(), 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: fase === 'entrada' ? 0 : fase === 'salida' ? 0 : 1,
        transition: 'opacity 0.5s ease',
        padding: 24,
      }}
    >
      <div
        onClick={(e: any) => e.stopPropagation()}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 24, textAlign: 'center', maxWidth: 400, width: '100%',
          transform: fase === 'show' ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(40px)',
          transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Partículas */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {[...Array(20)].map((_, i) => (
            <div key={i} style={{
              position: 'absolute',
              width: 8, height: 8,
              borderRadius: '50%',
              background: [rangoNuevo.color, rangoNuevo.colorSecundario, '#fff'][i % 3],
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `float-particle ${1.5 + Math.random() * 2}s ease-out forwards`,
              animationDelay: `${Math.random() * 0.5}s`,
              opacity: 0,
            }} />
          ))}
        </div>

        {/* Texto "RANGO SUBIDO" */}
        <div style={{
          fontSize: 13, fontWeight: 800, letterSpacing: 4,
          color: rangoNuevo.color,
          textTransform: 'uppercase',
          textShadow: `0 0 20px ${rangoNuevo.color}`,
        }}>
          ⬆️ {esHimmy ? '¡RANGO MÁXIMO!' : 'RANGO SUBIDO'}
        </div>

        {/* Rango anterior → nuevo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* Anterior (gris, pequeño) */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            opacity: 0.4,
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: rangoAnterior.marcoGradient,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28,
            }}>
              {rangoAnterior.emoji}
            </div>
            <span style={{ fontSize: 11, color: '#aaa', fontWeight: 700 }}>
              {rangoAnterior.nombre} {rangoAnterior.id !== 'himmy' ? rangoAnterior.division : ''}
            </span>
          </div>

          {/* Flecha */}
          <div style={{ fontSize: 32, color: rangoNuevo.color, fontWeight: 900 }}>→</div>

          {/* Nuevo (grande, brillante) */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 100, height: 100, borderRadius: '50%',
              background: rangoNuevo.marcoGradient,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 48,
              boxShadow: `0 0 30px ${rangoNuevo.color}, 0 0 60px ${rangoNuevo.color}44`,
              animation: 'pulse-rango 1s ease-in-out infinite alternate',
            }}>
              {rangoNuevo.emoji}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>
              {rangoNuevo.nombre} {rangoNuevo.id !== 'himmy' ? rangoNuevo.division : ''}
            </div>
            <div style={{
              fontSize: 12, color: rangoNuevo.color, fontWeight: 700,
              background: rangoNuevo.color + '22',
              borderRadius: 8, padding: '3px 12px',
              border: `1px solid ${rangoNuevo.color}44`,
            }}>
              {rangoNuevo.xpMinimo.toLocaleString()} XP alcanzados
            </div>
          </div>
        </div>

        {esHimmy && (
          <div style={{
            fontSize: 14, color: '#f5c842', fontWeight: 700,
            background: '#f5c84215', borderRadius: 12, padding: '12px 20px',
            border: '1px solid #f5c84244',
          }}>
            👑 Has alcanzado el rango más alto de Studyal
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            padding: '10px 28px', borderRadius: 12, border: 'none',
            background: rangoNuevo.marcoGradient,
            color: '#fff', fontWeight: 800, fontSize: 14,
            cursor: 'pointer',
            boxShadow: `0 4px 20px ${rangoNuevo.color}66`,
          }}
        >
          ¡Genial! 🎉
        </button>
      </div>
    </div>
  );
}