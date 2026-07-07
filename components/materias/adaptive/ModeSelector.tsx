'use client'

// ═══════════════════════════════════════════════════════════════
// ModeSelector v2 — Selector de modo de estudio
// Estilo cinematográfico (misma estética del EnfoqueWheel)
// 3 opciones: Libre, Adaptativo, Manual (próximamente)
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react'

const HAND = "'Caveat', cursive"

interface Props {
  onSelectMode: (mode: 'free' | 'adaptive') => void
  onCancel: () => void
  materialesCount?: number
}

const MODES = [
  {
    id: 'free' as const,
    emoji: '🧰',
    label: 'Modo Libre',
    sub: 'Repasar · Flashcards · Quiz · Mapa · Chat',
    desc: 'Tú decides qué herramienta usar. El círculo completo está disponible.',
    color: '#38bdf8',
    enabled: true,
  },
  {
    id: 'adaptive' as const,
    emoji: '🤖',
    label: 'Modo Adaptativo',
    sub: 'Programa · Sesiones · Dominio',
    desc: 'ALAI diseña un programa personalizado según tu objetivo y nivel.',
    color: '#d6b26f',
    enabled: true,
  },
  {
    id: 'manual' as const,
    emoji: '✏️',
    label: 'Modo Manual',
    sub: 'Próximamente',
    desc: 'Crea tu propio plan de estudio paso a paso.',
    color: '#a78bfa',
    enabled: false,
  },
]

export default function ModeSelector({ onSelectMode, onCancel, materialesCount = 1 }: Props) {
  const [hov, setHov] = useState<string | null>(null)
  const [phase, setPhase] = useState<'enter' | 'idle'>('enter')

  useEffect(() => {
    const t = setTimeout(() => setPhase('idle'), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at center, rgba(15,15,20,0.85), rgba(0,0,0,0.97))',
        backdropFilter: 'blur(20px)',
        // Líneas de cuaderno
        backgroundImage: 'linear-gradient(to bottom, transparent 47px, rgba(255,255,255,0.03) 47px 48px, transparent 48px)',
        backgroundSize: '100% 48px',
        overflow: 'hidden',
      }}
    >
      {/* Línea roja vertical izquierda */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: '8%',
        width: 1, background: 'rgba(239,68,68,0.3)',
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{
        textAlign: 'center', marginBottom: 48,
        transform: phase === 'enter' ? 'translateY(-20px)' : 'translateY(0)',
        opacity: phase === 'enter' ? 0 : 1,
        transition: 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        <div style={{
          fontSize: 18, color: 'rgba(255,255,255,0.5)',
          fontFamily: HAND, marginBottom: 8,
        }}>
          ~ {materialesCount} material{materialesCount !== 1 ? 'es' : ''} seleccionado{materialesCount !== 1 ? 's' : ''} ~
        </div>
        <div style={{
          fontSize: 56, fontWeight: 700, color: '#fff',
          fontFamily: HAND, lineHeight: 1.1,
        }}>
          ¿cómo quieres estudiar?
        </div>
        <div style={{
          fontSize: 20, color: 'rgba(255,255,255,0.6)',
          fontFamily: HAND, fontStyle: 'italic', marginTop: 8,
        }}>
          elige tu modo ↓
        </div>
      </div>

      {/* Cards */}
      <div style={{
        display: 'flex', gap: 28, flexWrap: 'wrap',
        justifyContent: 'center', padding: '0 24px',
      }}>
        {MODES.map((mode, i) => {
          const isHov = hov === mode.id
          const c = mode.color

          return (
            <button
              key={mode.id}
              disabled={!mode.enabled}
              onClick={() => {
                if (mode.enabled && mode.id !== 'manual') {
                  onSelectMode(mode.id as 'free' | 'adaptive')
                }
              }}
              onMouseEnter={() => mode.enabled && setHov(mode.id)}
              onMouseLeave={() => setHov(null)}
              style={{
                width: 280,
                minHeight: 340,
                border: `2px solid ${isHov ? c : c + '33'}`,
                borderRadius: 20,
                background: isHov
                  ? `linear-gradient(160deg, ${c}22, ${c}05)`
                  : 'transparent',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 20,
                padding: '32px 24px',
                cursor: mode.enabled ? 'pointer' : 'not-allowed',
                opacity: mode.enabled ? 1 : 0.35,
                transform: phase === 'enter'
                  ? 'scale(0.85)'
                  : isHov
                  ? 'scale(1.04) translateY(-4px)'
                  : 'scale(1)',
                transition: 'all 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
                transitionDelay: phase === 'enter' ? `${i * 80}ms` : '0ms',
                boxShadow: isHov ? `0 8px 32px ${c}22` : 'none',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Badge PRÓXIMAMENTE */}
              {!mode.enabled && (
                <div style={{
                  position: 'absolute', top: 16, right: -28,
                  background: c, color: '#000',
                  fontSize: 10, fontWeight: 800,
                  padding: '4px 32px',
                  transform: 'rotate(35deg)',
                  letterSpacing: 1.5,
                }}>
                  PRÓXIMAMENTE
                </div>
              )}

              {/* Emoji */}
              <div style={{ fontSize: 64, lineHeight: 1 }}>
                {mode.emoji}
              </div>

              {/* Label */}
              <div style={{
                fontSize: 28, fontWeight: 700,
                fontFamily: HAND, color: '#fff',
                textAlign: 'center',
              }}>
                {mode.label}
              </div>

              {/* Sub */}
              <div style={{
                fontSize: 14, color: 'rgba(255,255,255,0.5)',
                fontFamily: HAND, textAlign: 'center',
              }}>
                {mode.sub}
              </div>

              {/* Desc */}
              <div style={{
                fontSize: 13, color: 'rgba(255,255,255,0.35)',
                textAlign: 'center', lineHeight: 1.5,
                maxWidth: 220,
              }}>
                {mode.desc}
              </div>

              {/* Botón inferior */}
              {mode.enabled && (
                <div style={{
                  marginTop: 'auto',
                  padding: '8px 24px',
                  borderRadius: 999,
                  border: `1.5px solid ${isHov ? c : '#444'}`,
                  color: isHov ? c : 'rgba(255,255,255,0.6)',
                  fontSize: 15, fontFamily: HAND,
                  fontWeight: 600,
                  transition: 'all 0.3s',
                }}>
                  {isHov ? 'seleccionar →' : 'elegir'}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Botón cancelar */}
      <button
        onClick={onCancel}
        style={{
          marginTop: 32,
          background: 'transparent',
          border: '1.5px solid rgba(255,255,255,0.3)',
          padding: '10px 28px',
          borderRadius: 30,
          color: 'rgba(255,255,255,0.8)',
          fontFamily: HAND,
          fontSize: 18,
          cursor: 'pointer',
          transition: 'all 0.3s',
        }}
      >
        ← volver
      </button>
    </div>
  )
}
