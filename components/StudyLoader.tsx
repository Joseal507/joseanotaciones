'use client';

import { useEffect, useState, useMemo } from 'react';

const HAND = "'Caveat', cursive";
const STICKERS = ['📚', '✏️', '🎯', '💡', '🧠', '⭐', '🔥', '☘️', '🏆', '📝', '🎨', '💪'];

function Doodle({ i }: { i: number }) {
  const style = useMemo(() => {
    const angle = (i / 8) * 360;
    const radius = 120 + Math.random() * 60;
    const x = Math.cos((angle * Math.PI) / 180) * radius;
    const y = Math.sin((angle * Math.PI) / 180) * radius;
    const rot = -30 + Math.random() * 60;
    const delay = i * 0.15;
    const emoji = STICKERS[i % STICKERS.length];
    return { x, y, rot, delay, emoji };
  }, [i]);

  return (
    <div style={{
      position: 'absolute',
      left: `calc(50% + ${style.x}px)`,
      top: `calc(50% + ${style.y}px)`,
      fontSize: 24,
      transform: `rotate(${style.rot}deg)`,
      animation: `slFloat 3s ease-in-out ${style.delay}s infinite alternate`,
      opacity: 0.5,
      pointerEvents: 'none',
      filter: 'grayscale(0.3)',
    }}>
      {style.emoji}
    </div>
  );
}

function ScribbleSpinner() {
  return (
    <div style={{ position: 'relative', width: 80, height: 80, zIndex: 2 }}>
      {/* 3 líneas curvas girando a diferentes velocidades */}
      <svg width="80" height="80" viewBox="0 0 80 80"
        style={{ position: 'absolute', inset: 0, animation: 'slSpin 1.8s linear infinite' }}>
        <path d="M40 8 C55 8, 72 20, 72 40 C72 55, 60 68, 45 70"
          fill="none" stroke="var(--gold)" strokeWidth="2.5"
          strokeLinecap="round" strokeDasharray="8 6"
          style={{ filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--gold) 50%, transparent))' }} />
      </svg>
      <svg width="80" height="80" viewBox="0 0 80 80"
        style={{ position: 'absolute', inset: 0, animation: 'slSpin2 2.4s linear infinite' }}>
        <path d="M40 6 C58 6, 74 22, 74 40 C74 58, 58 74, 40 74 C22 74, 6 58, 6 40"
          fill="none" stroke="var(--pink)" strokeWidth="2"
          strokeLinecap="round" strokeDasharray="12 8"
          opacity="0.6"
          style={{ filter: 'drop-shadow(0 0 4px rgba(244,114,182,0.4))' }} />
      </svg>
      <svg width="80" height="80" viewBox="0 0 80 80"
        style={{ position: 'absolute', inset: 0, animation: 'slSpin3 3s linear infinite' }}>
        <path d="M20 10 C35 4, 65 10, 70 30 C75 50, 60 72, 40 74 C20 76, 4 55, 8 35"
          fill="none" stroke="var(--blue)" strokeWidth="1.5"
          strokeLinecap="round" strokeDasharray="6 10"
          opacity="0.45"
          style={{ filter: 'drop-shadow(0 0 4px rgba(96,165,250,0.3))' }} />
      </svg>
      {/* Logo centro */}
      <img src="/logo.png" alt="" style={{
        position: 'absolute', inset: 0, margin: 'auto',
        width: 80, height: 80, objectFit: 'contain',
        filter: 'drop-shadow(0 2px 8px color-mix(in srgb, var(--gold) 40%, transparent))',
        animation: 'slPulse 1.6s ease-in-out infinite',
      }} />
    </div>
  );
}

export default function StudyLoader({ label = 'Página' }: { label?: string }) {
  const clean = (label || 'Página').trim();
  const messages = useMemo(() => [
    `Preparando ${clean}...`,
    `Afinando detalles de ${clean}...`,
    `Cargando ${clean}...`,
  ], [clean]);

  const [step, setStep] = useState(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    setStep(0);
    const iv = setInterval(() => {
      setStep(s => (s < 2 ? s + 1 : 2));
    }, 700);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setDots(d => (d.length >= 3 ? '' : d + '.'));
    }, 400);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--bg-primary)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 999999,
      overflow: 'hidden',
    }}>
      {Array.from({ length: 8 }).map((_, i) => <Doodle key={i} i={i} />)}

      <div style={{
        position: 'relative',
        width: 280,
        minHeight: 280,
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 6,
        boxShadow: '6px 8px 0 var(--gold), 0 20px 60px rgba(0,0,0,0.25)',
        transform: 'rotate(-1.5deg)',
        padding: '40px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
        overflow: 'hidden',
      }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute', left: 30, right: 30,
            top: 18 + i * 22, height: 1.5,
            background: 'var(--blue)', opacity: 0.08,
          }} />
        ))}

        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-4deg)',
          width: 90, height: 20,
          background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
          border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          zIndex: 10,
        }} />

        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 38,
          width: 1.5, background: '#ef4444', opacity: 0.35,
        }} />

        <ScribbleSpinner />

        <p style={{
          fontFamily: HAND, fontSize: 26, fontWeight: 800,
          color: 'var(--text-primary)', margin: 0,
          textAlign: 'center', lineHeight: 1.2,
          transform: 'rotate(0.5deg)', zIndex: 2,
        }}>
          {messages[Math.min(step, 2)]}
        </p>

        <p style={{
          fontFamily: HAND, fontSize: 16, fontStyle: 'italic',
          color: 'var(--text-muted)', margin: 0, zIndex: 2,
          transform: 'rotate(-0.8deg)',
        }}>
          ~ un momento{dots} ~
        </p>

        <div style={{
          position: 'absolute', bottom: 8, right: 12,
          fontFamily: HAND, fontSize: 11,
          color: 'var(--text-faint)',
          transform: 'rotate(3deg)', opacity: 0.5, zIndex: 2,
        }}>
          ✎ StudyAL
        </div>

        <div style={{
          position: 'absolute', top: 14, right: 14, fontSize: 22,
          transform: 'rotate(12deg)',
          animation: 'slWiggle 2s ease-in-out infinite', zIndex: 2,
        }}>☘️</div>

        <div style={{
          position: 'absolute', bottom: 16, left: 46, fontSize: 18,
          transform: 'rotate(-8deg)',
          animation: 'slWiggle 2.5s ease-in-out 0.3s infinite',
          opacity: 0.7, zIndex: 2,
        }}>⭐</div>
      </div>

      <style>{`
        @keyframes slSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes slSpin2 {
          from { transform: rotate(360deg); }
          to   { transform: rotate(0deg); }
        }
        @keyframes slSpin3 {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes slPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.7; transform: scale(1.08); }
        }
        @keyframes slFloat {
          from { transform: translateY(0); opacity: 0.4; }
          to   { transform: translateY(-12px); opacity: 0.7; }
        }
        @keyframes slWiggle {
          0%, 100% { transform: rotate(12deg) scale(1); }
          50%      { transform: rotate(-5deg) scale(1.15); }
        }
      `}</style>
    </div>
  );
}
