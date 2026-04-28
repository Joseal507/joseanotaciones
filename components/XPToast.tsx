'use client';

import { useEffect, useState, useCallback } from 'react';

export interface XPToastData {
  id: number;
  xp: number;
  fuente: string;
  emoji: string;
  color: string;
  descripcion: string;
}

// ── Sistema de eventos global ──
const EVENTO = 'studyal:xp';

export function dispararXPToast(data: Omit<XPToastData, 'id'>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: data }));
}

export default function XPToast() {
  const [toasts, setToasts] = useState<XPToastData[]>([]);

  const agregar = useCallback((data: Omit<XPToastData, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { ...data, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      agregar((e as CustomEvent).detail);
    };
    window.addEventListener(EVENTO, handler);
    return () => window.removeEventListener(EVENTO, handler);
  }, [agregar]);

  if (toasts.length === 0) return null;

  return (
    <>
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: `translate(-50%, calc(-50% + ${index * 180}px))`,
            zIndex: 999999,
            pointerEvents: 'none',
            animation: 'xpPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          }}
        >
          <div style={{
            background: 'rgba(8,8,18,0.98)',
            border: `3px solid ${toast.color}`,
            borderRadius: '28px',
            padding: '28px 44px',
            textAlign: 'center',
            boxShadow: `0 0 80px ${toast.color}70, 0 24px 80px rgba(0,0,0,0.9)`,
            minWidth: '300px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Glow de fondo */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(circle at center, ${toast.color}15, transparent 70%)`,
              pointerEvents: 'none',
            }} />

            {/* Emoji */}
            <div style={{
              fontSize: '56px',
              lineHeight: 1,
              marginBottom: '12px',
              display: 'block',
              animation: 'xpBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
            }}>
              {toast.emoji}
            </div>

            {/* XP ganado - el número más grande */}
            <div style={{
              fontSize: '64px',
              fontWeight: 900,
              color: toast.color,
              lineHeight: 1,
              marginBottom: '8px',
              fontFamily: '-apple-system, monospace',
              textShadow: `0 0 40px ${toast.color}`,
              letterSpacing: '-2px',
            }}>
              +{toast.xp}
              <span style={{ fontSize: '28px', marginLeft: '6px', opacity: 0.9 }}>XP</span>
            </div>

            {/* Descripción */}
            <div style={{
              fontSize: '15px',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.95)',
              marginBottom: '8px',
              lineHeight: 1.4,
            }}>
              {toast.descripcion}
            </div>

            {/* Badge fuente */}
            <div style={{
              display: 'inline-block',
              padding: '5px 16px',
              borderRadius: '20px',
              background: `${toast.color}25`,
              border: `1px solid ${toast.color}60`,
              fontSize: '12px',
              fontWeight: 800,
              color: toast.color,
              letterSpacing: '0.3px',
            }}>
              {toast.fuente}
            </div>

            {/* Barra de desaparición */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              height: '3px',
              background: toast.color,
              borderRadius: '0 0 28px 28px',
              animation: 'xpBar 3.5s linear forwards',
            }} />
          </div>
        </div>
      ))}

      <style>{`
        @keyframes xpPop {
          0%   { opacity: 0; transform: translate(-50%, calc(-50% + 40px)) scale(0.6); }
          70%  { transform: translate(-50%, -52%) scale(1.05); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes xpBounce {
          0%   { transform: scale(0) rotate(-15deg); }
          60%  { transform: scale(1.25) rotate(5deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        @keyframes xpBar {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </>
  );
}
