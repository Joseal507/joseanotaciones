'use client'

import { useEffect, useState } from 'react'

interface Props {
  stage: 'analyzing' | 'designing' | 'ready'
  topicsCount?: number
  sessionsCount?: number
}

export default function BookPreparation({ stage, topicsCount, sessionsCount }: Props) {
  const [dots, setDots] = useState('')

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.')
    }, 500)
    return () => clearInterval(interval)
  }, [])

  const messages = {
    analyzing: {
      title: 'Analizando tu material',
      sub: 'ALAI está identificando los temas centrales',
    },
    designing: {
      title: 'ALAI está diseñando tu programa',
      sub: topicsCount
        ? `Encontré ${topicsCount} temas. Construyendo el camino...`
        : 'Construyendo el camino de aprendizaje',
    },
    ready: {
      title: 'Listo',
      sub: sessionsCount
        ? `${sessionsCount} sesiones adaptadas para ti`
        : 'Tu programa está listo',
    },
  }

  const msg = messages[stage]

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 32,
    }}>
      {/* Partículas */}
      {[...Array(8)].map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: 3,
          height: 3,
          background: '#d6b26f',
          borderRadius: '50%',
          left: `${10 + (i * 11)}%`,
          top: `${20 + (i % 3) * 25}%`,
          opacity: 0.3,
          animation: `floatParticle ${4 + i % 3}s ease-in-out infinite`,
          animationDelay: `${i * 0.5}s`,
        }} />
      ))}

      <style>{`
        @keyframes floatParticle {
          0%, 100% { transform: translateY(0px); opacity: 0.3; }
          50% { transform: translateY(-20px); opacity: 0.7; }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.1); opacity: 1; }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 40px rgba(214,178,111,0.3); }
          50% { box-shadow: 0 0 80px rgba(214,178,111,0.6); }
        }
      `}</style>

      {/* Libro icon animado */}
      <div style={{
        width: 100,
        height: 100,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(214,178,111,0.2) 0%, transparent 70%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 56,
        color: '#d6b26f',
        animation: 'pulse 2s ease-in-out infinite, glow 2s ease-in-out infinite',
      }}>
        📖
      </div>

      {/* Mensaje */}
      <div style={{
        textAlign: 'center',
        fontFamily: 'Georgia, serif',
        maxWidth: 400,
      }}>
        <div style={{
          fontSize: 24,
          color: '#d6b26f',
          fontWeight: 600,
          marginBottom: 12,
          letterSpacing: 0.3,
        }}>
          {msg.title}{stage !== 'ready' ? dots : ''}
        </div>
        <div style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.5)',
          fontStyle: 'italic',
          lineHeight: 1.6,
        }}>
          {msg.sub}
        </div>
      </div>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 8 }}>
        {['analyzing', 'designing', 'ready'].map((s) => {
          const isCurrent = s === stage
          const isDone = (
            (s === 'analyzing' && (stage === 'designing' || stage === 'ready')) ||
            (s === 'designing' && stage === 'ready')
          )
          return (
            <div key={s} style={{
              width: isCurrent ? 24 : 8,
              height: 8,
              borderRadius: 4,
              background: isDone || isCurrent ? '#d6b26f' : 'rgba(214,178,111,0.2)',
              transition: 'all 0.4s ease',
            }} />
          )
        })}
      </div>
    </div>
  )
}
