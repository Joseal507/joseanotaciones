'use client'

// ═══════════════════════════════════════════════════════════════
// AdaptiveV2Bootstrap
// 
// Componente que orquesta el flujo v2 completo:
// 1. Muestra loading con progreso
// 2. Llama a analyze + create-plan
// 3. Cuando el plan está listo, muestra el libro con sesiones reales
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react'
import { useAdaptiveV2Flow, type V2FlowPhase } from '../../../../hooks/useAdaptiveV2Flow'
import type { StoredPlan } from '../../../../lib/adaptive/v2/storage/plan'
import type { MaterialIntelligence, SessionBlueprint } from '../../../../lib/adaptive/v2/types'

interface Props {
  userId: string
  materialId: string
  materialTitle: string
  materialText: string
  totalPages?: number
  profile: any
  setup: any
  onReady: (plan: StoredPlan, intelligence: MaterialIntelligence) => void
  onError: (error: string) => void
  onCancel: () => void
}

export default function AdaptiveV2Bootstrap({
  userId,
  materialId,
  materialTitle,
  materialText,
  totalPages,
  profile,
  setup,
  onReady,
  onError,
  onCancel,
}: Props) {
  const flow = useAdaptiveV2Flow()
  const hasStarted = useRef(false)

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true

    flow.runFullFlow({
      userId,
      materialId,
      materialTitle,
      materialText,
      totalPages,
      profile,
      setup,
    })
  }, [])

  useEffect(() => {
    if (flow.phase === 'ready' && flow.plan && flow.intelligence) {
      onReady(flow.plan, flow.intelligence)
    }
    if (flow.phase === 'error' && flow.error) {
      onError(flow.error)
    }
  }, [flow.phase, flow.plan, flow.intelligence, flow.error])

  // ─── Renderers según fase ─────────────────────────────────
  if (flow.phase === 'error') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>😓</div>
        <div style={{ fontSize: 16, color: '#f5e6b8', marginBottom: 8, textAlign: 'center' }}>
          Algo salió mal
        </div>
        <div style={{ fontSize: 13, color: '#a8854a', marginBottom: 24, maxWidth: 400, textAlign: 'center' }}>
          {flow.error}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => {
              hasStarted.current = false
              flow.reset()
              setTimeout(() => {
                hasStarted.current = true
                flow.runFullFlow({
                  userId, materialId, materialTitle, materialText, totalPages, profile, setup,
                })
              }, 100)
            }}
            style={btnGold}
          >
            🔄 Reintentar
          </button>
          <button onClick={onCancel} style={btnOutline}>← Volver</button>
        </div>
      </div>
    )
  }

  return (
    <div style={overlayStyle}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        {/* Icono grande */}
        <div style={{
          fontSize: 60,
          marginBottom: 24,
          animation: 'pulse 2s ease-in-out infinite',
        }}>
          {flow.phase === 'analyzing' && '🔍'}
          {flow.phase === 'planning' && '📋'}
          {flow.phase === 'ready' && '✓'}
          {flow.phase === 'idle' && '📖'}
        </div>

        {/* Título de fase */}
        <div style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#f5e6b8',
          fontFamily: 'Georgia, serif',
          marginBottom: 12,
          letterSpacing: 1,
        }}>
          {getPhaseTitle(flow.phase)}
        </div>

        {/* Mensaje detallado */}
        {flow.loadingMessage && (
          <div style={{
            fontSize: 14,
            color: '#a8854a',
            marginBottom: 32,
            lineHeight: 1.6,
          }}>
            {flow.loadingMessage}
          </div>
        )}

        {/* Barra de progreso */}
        <div style={{
          width: '100%',
          height: 4,
          background: 'rgba(214, 178, 111, 0.15)',
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 24,
        }}>
          <div style={{
            width: `${flow.progress}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #d6b26f, #f5e6b8)',
            transition: 'width 0.6s ease',
            borderRadius: 2,
          }} />
        </div>

        {/* Detalles de progreso */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          <PhaseStep
            label="Analizar material"
            active={flow.phase === 'analyzing'}
            done={['planning', 'ready'].includes(flow.phase)}
            cached={flow.stats.fromCacheAnalysis}
            duration={flow.stats.analysisMs}
          />
          <PhaseStep
            label="Diseñar plan de estudio"
            active={flow.phase === 'planning'}
            done={flow.phase === 'ready'}
            cached={flow.stats.fromCachePlan}
            duration={flow.stats.planMs}
          />
        </div>

        {/* Stats de intelligence si está listo */}
        {flow.intelligence && (
          <div style={{
            padding: '12px 16px',
            background: 'rgba(214, 178, 111, 0.08)',
            border: '1px solid rgba(214, 178, 111, 0.2)',
            borderRadius: 8,
            fontSize: 12,
            color: '#a8854a',
          }}>
            <div>📚 {flow.intelligence.topics.length} temas identificados</div>
            {flow.intelligence.formulas.length > 0 && (
              <div>🧮 {flow.intelligence.formulas.length} fórmulas</div>
            )}
            {flow.intelligence.procedures.length > 0 && (
              <div>⚙️ {flow.intelligence.procedures.length} procedimientos</div>
            )}
          </div>
        )}

        {/* Botón cancelar */}
        {flow.phase !== 'ready' && (
          <button
            onClick={onCancel}
            style={{
              marginTop: 24,
              padding: '8px 20px',
              background: 'transparent',
              border: '1px solid rgba(168, 133, 74, 0.3)',
              color: 'rgba(168, 133, 74, 0.8)',
              borderRadius: 999,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'Georgia, serif',
              letterSpacing: 1,
            }}
          >
            Cancelar
          </button>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.05); }
        }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PHASE STEP INDICATOR
// ═══════════════════════════════════════════════════════════════
function PhaseStep({
  label, active, done, cached, duration,
}: {
  label: string
  active: boolean
  done: boolean
  cached?: boolean
  duration?: number
}) {
  const color = done ? '#5a8a3a' : active ? '#d6b26f' : 'rgba(168, 133, 74, 0.4)'
  const icon = done ? '✓' : active ? '●' : '○'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 14px',
      background: active ? 'rgba(214, 178, 111, 0.08)' : 'transparent',
      borderRadius: 6,
      border: `1px solid ${active ? 'rgba(214, 178, 111, 0.3)' : 'transparent'}`,
    }}>
      <span style={{
        fontSize: 16,
        color,
        fontWeight: 'bold',
        animation: active ? 'pulse 1.5s ease-in-out infinite' : 'none',
      }}>
        {icon}
      </span>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div style={{ fontSize: 13, color: done ? '#5a8a3a' : active ? '#f5e6b8' : '#a8854a' }}>
          {label}
        </div>
      </div>
      {done && cached && (
        <span style={{
          fontSize: 9,
          color: '#5a8a3a',
          background: 'rgba(90, 138, 58, 0.15)',
          padding: '2px 6px',
          borderRadius: 999,
          letterSpacing: 1,
        }}>
          CACHE
        </span>
      )}
      {done && duration && (
        <span style={{ fontSize: 10, color: 'rgba(168, 133, 74, 0.6)' }}>
          {(duration / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  )
}

function getPhaseTitle(phase: V2FlowPhase): string {
  switch (phase) {
    case 'idle': return 'Preparando'
    case 'analyzing': return 'Analizando material'
    case 'planning': return 'Diseñando plan de estudio'
    case 'ready': return 'Listo'
    case 'error': return 'Error'
  }
}

// ═══════════════════════════════════════════════════════════════
// ESTILOS
// ═══════════════════════════════════════════════════════════════
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  fontFamily: 'Georgia, serif',
}

const btnGold: React.CSSProperties = {
  padding: '12px 24px',
  borderRadius: 8,
  border: '1.5px solid #d4a544',
  background: '#d4a544',
  color: '#1a1410',
  fontFamily: 'Georgia, serif',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
}

const btnOutline: React.CSSProperties = {
  padding: '12px 24px',
  borderRadius: 8,
  border: '1.5px solid #a8854a',
  background: 'transparent',
  color: '#a8854a',
  fontFamily: 'Georgia, serif',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
}
