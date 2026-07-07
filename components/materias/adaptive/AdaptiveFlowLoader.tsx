'use client'

import { useEffect, useState } from 'react'

interface Props {
  phase: string
  message?: string
  materialTitle?: string
  coverageUnitsFound?: number
}

const PHASE_MESSAGES: Record<string, string[]> = {
  analyzing: [
    'Leyendo el material completo...',
    'Identificando conceptos clave...',
    'Mapeando dependencias entre temas...',
    'Verificando cobertura del 100%...',
    'Casi listo...',
  ],
  evaluating: [
    'Evaluando tus respuestas...',
    'Detectando lo que ya sabes...',
    'Calibrando el punto de partida...',
  ],
  planning: [
    'Diseñando tu plan personalizado...',
    'Distribuyendo el material en sesiones...',
    'Verificando que ningún tema quede fuera...',
    'Ajustando según tu nivel y tiempo...',
    'Casi listo...',
  ],
}

export default function AdaptiveFlowLoader({ phase, message, materialTitle, coverageUnitsFound }: Props) {
  const [msgIdx, setMsgIdx] = useState(0)
  const messages = PHASE_MESSAGES[phase] || ['Preparando...']

  useEffect(() => {
    setMsgIdx(0)
    const interval = setInterval(() => {
      setMsgIdx(prev => (prev + 1) % messages.length)
    }, 2200)
    return () => clearInterval(interval)
  }, [phase])

  const displayMsg = message || messages[msgIdx]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 24, fontFamily: 'Georgia, serif',
    }}>
      {/* Libro animado */}
      <div style={{ fontSize: 64, animation: 'bookPulse 2s ease-in-out infinite' }}>
        📖
      </div>

      {/* Título */}
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{
          fontSize: 11, letterSpacing: 3, color: 'rgba(214,178,111,.6)',
          fontWeight: 700, marginBottom: 12,
        }}>
          {phase === 'analyzing' ? 'ANALIZANDO MATERIAL' :
           phase === 'evaluating' ? 'EVALUANDO DIAGNÓSTICO' :
           phase === 'planning' ? 'CREANDO TU PLAN' : 'PREPARANDO'}
        </div>

        {materialTitle && (
          <div style={{
            fontSize: 15, fontWeight: 600, color: '#d6b26f',
            fontStyle: 'italic', marginBottom: 16, lineHeight: 1.3,
          }}>
            "{materialTitle}"
          </div>
        )}

        <div style={{
          fontSize: 14, color: 'rgba(245,236,213,.7)',
          lineHeight: 1.6, minHeight: 48,
          transition: 'opacity .3s ease',
        }}>
          {displayMsg}
        </div>
      </div>

      {/* Coverage units encontradas */}
      {coverageUnitsFound !== undefined && coverageUnitsFound > 0 && (
        <div style={{
          padding: '10px 20px',
          background: 'rgba(214,178,111,.08)',
          border: '1px solid rgba(214,178,111,.2)',
          borderRadius: 8,
          fontSize: 12, color: 'rgba(214,178,111,.8)',
          fontWeight: 700,
        }}>
          {coverageUnitsFound} conceptos identificados
        </div>
      )}

      {/* Barra de progreso indeterminada */}
      <div style={{
        width: 280, height: 3,
        background: 'rgba(214,178,111,.15)',
        borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          background: 'linear-gradient(90deg, transparent, #d6b26f, transparent)',
          animation: 'shimmer 1.8s ease infinite',
          borderRadius: 2,
        }} />
      </div>

      <div style={{
        fontSize: 10, letterSpacing: 2,
        color: 'rgba(214,178,111,.35)',
        fontWeight: 700,
      }}>
        ALAI · MODO ADAPTATIVO
      </div>

      <style>{`
        @keyframes bookPulse {
          0%, 100% { transform: scale(1) rotate(-3deg); opacity: .9; }
          50% { transform: scale(1.08) rotate(3deg); opacity: 1; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  )
}
