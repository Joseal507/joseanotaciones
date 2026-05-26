'use client';

import { useRouter } from 'next/navigation';

import { useState, useEffect } from 'react';
import DailyReward, { shouldShowDailyReward } from '../DailyReward';
import { darXP } from '@/lib/xpClient';

type Screen = 'home' | 'upload' | 'document' | 'flashcards';

interface Analysis {
  keywords: string[];
  important_phrases: string[];
  summary: string;
}

interface Props {
  documentContent: string;
  flashcards: any[];
  analysis: Analysis | null;
  onSetScreen: (s: Screen) => void;
}

export default function HomeScreen({ documentContent, flashcards, analysis, onSetScreen }: Props) {
  const router = useRouter();
  const [showDaily, setShowDaily] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (shouldShowDailyReward()) {
        setShowDaily(true);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleXPGained = async (xp: number) => {
    if (xp > 0) {
      await darXP('racha', xp, { source: 'daily_reward', type: 'spin_win' });
    } else if (xp < 0) {
      await darXP('racha', 1, { source: 'daily_reward', type: 'spin_loss', xp_perdido: xp });
    }
  };

  const cards = [
    { color: 'var(--gold)', emoji: '📄', title: 'Analizar Documentos', desc: 'Sube un PDF, Word o TXT y la IA lo analiza, encuentra palabras clave y frases importantes.', btn: 'Subir documento →', action: () => onSetScreen('upload') },
    { color: 'var(--pink)', emoji: '🎴', title: 'Flashcards', desc: 'Genera tarjetas de estudio automáticamente desde tu documento. Elige cuántas quieres.', btn: 'Ver flashcards →', action: () => onSetScreen('flashcards') },
    { color: 'var(--blue)', emoji: '📖', title: 'Ver Documento', desc: 'Visualiza tu documento con highlights de palabras clave y frases importantes marcadas.', btn: 'Ver documento →', action: () => onSetScreen('document') },
    { color: 'var(--red)', emoji: '📚', title: 'Materias', desc: 'Organiza tus materias, temas, apuntes y documentos en un solo lugar estructurado.', btn: 'Mis materias →', action: () => ((window as any).__showNavLoader?.('/materias'), router.push('/materias')) },
  ];

  const stats = [
    { label: 'Documentos', value: documentContent ? '1' : '0', color: 'var(--gold)' },
    { label: 'Flashcards', value: flashcards.length.toString(), color: 'var(--pink)' },
    { label: 'Palabras clave', value: analysis?.keywords?.length?.toString() || '0', color: 'var(--blue)' },
    { label: 'Frases', value: analysis?.important_phrases?.length?.toString() || '0', color: 'var(--red)' },
  ];

  const features = [
    { icon: '🔍', text: 'Análisis inteligente', color: 'var(--gold)' },
    { icon: '✍️', text: 'Highlights automáticos', color: 'var(--blue)' },
    { icon: '🎴', text: 'Flashcards ilimitadas', color: 'var(--pink)' },
    { icon: '📊', text: 'Resumen del contenido', color: 'var(--red)' },
  ];

  return (
    <>
      {showDaily && (
        <DailyReward
          onClose={() => setShowDaily(false)}
          onXPGained={handleXPGained}
        />
      )}

      <style>{`
        @keyframes notebook-draw {
          0%   { stroke-dashoffset: 1200; opacity: 0.3; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 0.85; }
        }
        @keyframes notebook-loop {
          0%   { stroke-dashoffset: 1200; }
          60%  { stroke-dashoffset: 0; }
          85%  { stroke-dashoffset: 0; opacity: 1; }
          100% { stroke-dashoffset: 1200; opacity: 0.4; }
        }
        .nb-ring-1 {
          stroke-dasharray: 1200;
          animation: notebook-loop 4s cubic-bezier(0.4,0,0.2,1) infinite;
        }
        .nb-ring-2 {
          stroke-dasharray: 1200;
          animation: notebook-loop 4s cubic-bezier(0.4,0,0.2,1) infinite;
          animation-delay: 1.3s;
        }
        .nb-ring-3 {
          stroke-dasharray: 1200;
          animation: notebook-loop 4s cubic-bezier(0.4,0,0.2,1) infinite;
          animation-delay: 2.6s;
        }
        @keyframes logo-breathe {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.03); }
        }
        .logo-breathe {
          animation: logo-breathe 3s ease-in-out infinite;
        }
        .notebook-card {
          position: relative;
          background: var(--bg-card);
          border-radius: 16px;
          border: 1.5px solid var(--border-color);
          overflow: hidden;
          cursor: pointer;
          transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
          text-align: left;
        }
        .notebook-card::before {
          content: '';
          position: absolute;
          left: 32px;
          top: 0; bottom: 0;
          width: 1px;
          background: var(--card-accent, var(--gold));
          opacity: 0.25;
        }
        .notebook-card:hover {
          transform: translateY(-5px) rotate(-0.4deg);
          box-shadow: 3px 6px 20px rgba(0,0,0,0.18);
        }
        .notebook-stat {
          flex: 1;
          background: var(--bg-card);
          padding: 18px 12px;
          text-align: center;
          position: relative;
        }
        .notebook-stat::after {
          content: '';
          position: absolute;
          bottom: 6px; left: 50%;
          transform: translateX(-50%);
          width: 60%;
          height: 1px;
          background: var(--stat-color, var(--gold));
          opacity: 0.3;
          border-radius: 1px;
        }
      `}</style>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '70px 40px 60px', textAlign: 'center'
      }}>

        {/* Logo con trazos de cuaderno */}
        <div className="logo-breathe" style={{ position: 'relative', width: '130px', height: '130px', marginBottom: '28px' }}>
          {/* SVG trazos continuos */}
          <svg
            width="130" height="130"
            viewBox="0 0 130 130"
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
          >
            {/* Trazo 1 - dorado */}
            <rect
              className="nb-ring-1"
              x="6" y="6" width="118" height="118" rx="28"
              fill="none"
              stroke="var(--gold)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Trazo 2 - pink, ligeramente desplazado */}
            <rect
              className="nb-ring-2"
              x="10" y="10" width="110" height="110" rx="24"
              fill="none"
              stroke="var(--pink)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.6"
            />
            {/* Trazo 3 - blue, más pequeño */}
            <rect
              className="nb-ring-3"
              x="3" y="3" width="124" height="124" rx="32"
              fill="none"
              stroke="var(--blue)"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.4"
            />
          </svg>

          {/* Logo real */}
          <div style={{
            position: 'absolute', top: '14px', left: '14px',
            width: '102px', height: '102px',
            borderRadius: '22px',
            overflow: 'hidden',
            background: 'var(--bg-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '44px',
          }}>
            <img
              src="/logo.png"
              alt="Logo"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e: any) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '📚'; }}
            />
          </div>
        </div>

        {/* Título */}
        <h1 style={{
          fontSize: '60px', fontWeight: 900, color: 'var(--text-primary)',
          margin: '0 0 8px 0', letterSpacing: '-2px', lineHeight: 1
        }}>
          JOSEANOTACIONES
        </h1>

        {/* Línea colores - estilo subrayado lápiz */}
        <div style={{ display: 'flex', gap: '6px', margin: '16px 0 20px', alignItems: 'center' }}>
          {[
            { c: 'var(--gold)', w: 48 },
            { c: 'var(--red)', w: 32 },
            { c: 'var(--blue)', w: 40 },
            { c: 'var(--pink)', w: 28 },
          ].map((item, i) => (
            <div key={i} style={{
              width: `${item.w}px`, height: '3px',
              background: item.c, borderRadius: '2px',
              opacity: 0.85,
            }} />
          ))}
        </div>

        <p style={{ fontSize: '20px', color: 'var(--text-muted)', margin: '0 0 52px 0', maxWidth: '460px' }}>
          Mi plataforma para tirar estudio 💪
        </p>

        {/* Cards estilo cuaderno */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          gap: '20px', maxWidth: '920px', width: '100%', marginBottom: '52px'
        }}>
          {cards.map((card, i) => (
            <div
              key={i}
              className="notebook-card"
              onClick={card.action}
              style={{ '--card-accent': card.color } as any}
              onMouseEnter={(e: any) => {
                e.currentTarget.style.borderColor = card.color;
              }}
              onMouseLeave={(e: any) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            >
              <div style={{ height: '4px', background: card.color, opacity: 0.9 }} />
              <div style={{ padding: '24px 24px 24px 40px' }}>
                <div style={{
                  width: '46px', height: '46px', borderRadius: '12px',
                  background: card.color + '22',
                  border: `1.5px solid ${card.color}55`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '22px', marginBottom: '14px',
                }}>
                  {card.emoji}
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px 0' }}>
                  {card.title}
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 18px 0', lineHeight: 1.6 }}>
                  {card.desc}
                </p>
                <div style={{
                  display: 'inline-flex', alignItems: 'center',
                  background: card.color + '18',
                  color: card.color,
                  border: `1px solid ${card.color}44`,
                  padding: '6px 14px', borderRadius: '8px',
                  fontSize: '12px', fontWeight: 800,
                }}>
                  {card.btn}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div style={{
          display: 'flex', gap: '1px', background: 'var(--border-color)',
          borderRadius: '16px', overflow: 'hidden',
          maxWidth: '680px', width: '100%', marginBottom: '40px'
        }}>
          {stats.map((stat, i) => (
            <div
              key={i}
              className="notebook-stat"
              style={{ '--stat-color': stat.color } as any}
            >
              <div style={{ fontSize: '26px', fontWeight: 900, color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '4px' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Botón */}
        <button
          onClick={() => onSetScreen('upload')}
          style={{
            padding: '16px 44px', borderRadius: '14px', border: '2px solid var(--gold)',
            background: 'var(--gold)', color: '#000',
            fontSize: '17px', fontWeight: 900, cursor: 'pointer',
            letterSpacing: '0.5px', transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e: any) => e.currentTarget.style.transform = 'scale(1.05)'}
          onMouseLeave={(e: any) => e.currentTarget.style.transform = 'scale(1)'}
        >
          🚀 EMPEZAR AHORA
        </button>

        {/* Features */}
        <div style={{ display: 'flex', gap: '28px', marginTop: '40px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {features.map((feat, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: feat.color }} />
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>
                {feat.icon} {feat.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}