'use client';

import { useIdioma } from '../hooks/useIdioma';

interface Props {
  onClose?: () => void;
}

export default function AIExhausted({ onClose }: Props) {
  const { idioma } = useIdioma();

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: '24px',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '24px',
        padding: '40px 32px',
        maxWidth: '420px',
        width: '100%',
        textAlign: 'center',
        border: '2px solid #ff4d6d44',
        boxShadow: '0 20px 80px rgba(255,77,109,0.3)',
      }}>

        {/* Termómetro con fiebre animado */}
        <div style={{ fontSize: '80px', marginBottom: '8px', animation: 'shake 0.5s infinite' }}>
          🤒
        </div>
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>
          🌡️
        </div>

        <h2 style={{
          fontSize: '22px', fontWeight: 900,
          color: '#ff4d6d', margin: '0 0 12px',
          lineHeight: 1.3,
        }}>
          {idioma === 'en'
            ? 'The AI has a fever! 🔥'
            : '¡La IA tiene fiebre! 🔥'}
        </h2>

        <div style={{
          background: 'rgba(255,77,109,0.1)',
          border: '1px solid #ff4d6d33',
          borderRadius: '14px',
          padding: '16px',
          marginBottom: '20px',
        }}>
          <p style={{
            fontSize: '16px', color: 'var(--text-primary)',
            margin: '0 0 8px', fontWeight: 700, lineHeight: 1.5,
          }}>
            {idioma === 'en'
              ? 'Bro... everyone studied SO much today 😤'
              : 'Bro... la gente estudió DEMASIADO hoy 😤'}
          </p>
          <p style={{
            fontSize: '14px', color: 'var(--text-muted)',
            margin: 0, lineHeight: 1.6,
          }}>
            {idioma === 'en'
              ? 'All the AIs are exhausted. My bad, come back tomorrow and we go again 💪'
              : 'Todas las IAs están agotadas. Mala mía, vuelve mañana y la seguimos 💪'}
          </p>
        </div>

        {/* Barra de "tokens" estilo vida de videojuego */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: '11px', color: 'var(--text-muted)',
            fontWeight: 700, marginBottom: '6px',
          }}>
            <span>⚡ {idioma === 'en' ? 'Daily AI Energy' : 'Energía IA del día'}</span>
            <span>0%</span>
          </div>
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: '8px', height: '12px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: '3%', height: '100%',
              background: 'linear-gradient(90deg, #ff4d6d, #ff8c69)',
              borderRadius: '8px',
              animation: 'pulse 1s infinite',
            }} />
          </div>
          <p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: '6px 0 0', textAlign: 'right' }}>
            {idioma === 'en' ? 'Resets at midnight 🌙' : 'Se recarga a medianoche 🌙'}
          </p>
        </div>

        {/* Emojis de IAs exhaustas */}
        <div style={{
          display: 'flex', justifyContent: 'center',
          gap: '8px', flexWrap: 'wrap',
          marginBottom: '24px',
          fontSize: '22px',
        }}>
          {['🤖', '🧠', '💻', '⚡', '🦙', '☁️'].map((emoji, i) => (
            <div key={i} style={{
              background: 'var(--bg-secondary)',
              borderRadius: '10px', padding: '8px',
              opacity: 0.5,
              position: 'relative',
            }}>
              {emoji}
              <div style={{
                position: 'absolute', top: '-4px', right: '-4px',
                fontSize: '10px',
              }}>😵</div>
            </div>
          ))}
        </div>

        <p style={{
          fontSize: '12px', color: 'var(--text-faint)',
          margin: '0 0 20px', fontStyle: 'italic',
        }}>
          {idioma === 'en'
            ? '"Never thought you guys would study this much" - The AI'
            : '"Nunca pensé que estudiarían tanto" - La IA'}
        </p>

        {onClose && (
          <button onClick={onClose} style={{
            width: '100%', padding: '14px',
            borderRadius: '12px', border: 'none',
            background: 'linear-gradient(135deg, #ff4d6d, #ff8c69)',
            color: '#fff', fontSize: '15px', fontWeight: 800,
            cursor: 'pointer',
          }}>
            {idioma === 'en' ? 'Ok, see you tomorrow 👋' : 'Ok, hasta mañana 👋'}
          </button>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
