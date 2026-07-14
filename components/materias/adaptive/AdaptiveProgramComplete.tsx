'use client'

// ═══════════════════════════════════════════════════════════════
// AdaptiveProgramComplete
// Pantalla final cuando el usuario completa TODAS las sesiones
// del programa adaptativo. Muestra readiness report completo.
// ═══════════════════════════════════════════════════════════════

import type { AdaptiveProgram } from '../../../lib/adaptive'
import { useEffect, useState } from 'react'

interface Props {
  program: AdaptiveProgram
  finalDomain: number
  targetScore: number
  materialCoveragePercent: number
  studiedMicros: number
  totalMicros: number
  weakMicroNames: string[]
  onClose: () => void
  onRepeat: () => void
}

export default function AdaptiveProgramComplete({
  program,
  finalDomain,
  targetScore,
  materialCoveragePercent,
  studiedMicros,
  totalMicros,
  weakMicroNames,
  onClose,
  onRepeat,
}: Props) {
  const completedSessions = program.sessions.filter(s => s.status === 'completed')
  const totalSessions = program.sessions.length

  // Calcular accuracy promedio de las sesiones completadas
  const sessionsWithGain = completedSessions.filter(
    s => s.domainAfter !== undefined && s.domainBefore !== undefined
  )
  const avgGain = sessionsWithGain.length > 0
    ? Math.round(sessionsWithGain.reduce((sum, s) => sum + ((s.domainAfter ?? 0) - (s.domainBefore ?? 0)), 0) / sessionsWithGain.length)
    : 0

  // Todos los conceptos dominados
  const allConceptsImproved = [...new Set(
    completedSessions.flatMap(s => s.conceptsImproved || [])
  )]

  // Conceptos todavía débiles
  const allConceptsWeak = weakMicroNames.length > 0
    ? weakMicroNames
    : [...new Set(
        completedSessions.flatMap(s => s.conceptsStillWeak || [])
      )].filter(c => !allConceptsImproved.includes(c))

  // Readiness
  const reachedTarget = finalDomain >= targetScore
  const readinessPercent = Math.round((finalDomain / targetScore) * 100)
  const clampedReadiness = Math.min(100, readinessPercent)

  // Mensaje según resultado
  const getReadinessMessage = () => {
    if (finalDomain >= 90) return { emoji: '🏆', title: '¡Dominio excepcional!', sub: 'Estás completamente listo para el examen.' }
    if (finalDomain >= 75) return { emoji: '⭐', title: '¡Muy bien preparado!', sub: 'Tienes una base sólida para el examen.' }
    if (finalDomain >= 60) return { emoji: '✅', title: 'Listo para el examen', sub: 'Completaste el programa con buen desempeño.' }
    if (finalDomain >= 40) return { emoji: '📚', title: 'Progreso sólido', sub: 'Repasa los puntos débiles antes del examen.' }
    return { emoji: '💪', title: '¡Comenzaste el camino!', sub: 'Vuelve a repasar las sesiones para consolidar.' }
  }

  const readiness = getReadinessMessage()

  // Probabilidad estimada de éxito en examen
  const examProb = Math.min(99, Math.round(finalDomain * 0.9 + (reachedTarget ? 10 : 0)))

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
      zIndex: 200,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24, overflow: 'auto',
      fontFamily: 'Georgia, serif',
    }}>
      {/* Partículas de fondo */}
      {[...Array(6)].map((_, i) => (
        <div key={i} style={{
          position: 'fixed', width: 2, height: 2, background: '#d6b26f',
          borderRadius: '50%', left: `${15 + i * 15}%`, top: `${20 + (i % 3) * 25}%`,
          opacity: 0.3, animation: `floatParticle ${4 + i % 3}s ease-in-out infinite`,
          animationDelay: `${i * 0.5}s`, pointerEvents: 'none',
        }} />
      ))}

      <style>{`
        @keyframes floatParticle { 0%,100%{transform:translateY(0);opacity:.3} 50%{transform:translateY(-20px);opacity:.7} }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes countUp { from{opacity:0;transform:scale(.8)} to{opacity:1;transform:scale(1)} }
      `}</style>

      <div style={{
        width: 'min(520px, 100%)', position: 'relative', zIndex: 5,
        animation: 'fadeInUp .6s ease-out',
      }}>

        {/* Header con emoji y título */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>{readiness.emoji}</div>
          <div style={{
            fontSize: 26, fontWeight: 700, color: '#f5ecd5',
            marginBottom: 8, lineHeight: 1.2,
          }}>
            {readiness.title}
          </div>
          <div style={{ fontSize: 14, color: 'rgba(245,236,213,0.6)', lineHeight: 1.5 }}>
            {readiness.sub}
          </div>
        </div>

        {/* Cobertura real del material */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(74,222,128,0.12), rgba(74,222,128,0.04))',
          border: '1.5px solid rgba(74,222,128,0.35)',
          borderRadius: 16, padding: '20px 24px', marginBottom: 16,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, color: 'rgba(74,222,128,0.8)', letterSpacing: 2, marginBottom: 10 }}>
            COBERTURA ESTUDIADA DEL MATERIAL
          </div>
          <div style={{
            fontSize: 52, fontWeight: 900, color: '#4ade80', lineHeight: 1,
          }}>
            {materialCoveragePercent}%
          </div>
          <div style={{ fontSize: 12, color: 'rgba(245,236,213,0.55)', marginTop: 8 }}>
            Microconceptos estudiados: {studiedMicros}/{totalMicros || '—'}
          </div>
        </div>

        {/* Dominio final grande */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(214,178,111,0.12), rgba(214,178,111,0.04))',
          border: '1.5px solid rgba(214,178,111,0.35)',
          borderRadius: 16, padding: '24px', marginBottom: 16,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, color: 'rgba(214,178,111,0.6)', letterSpacing: 2, marginBottom: 12 }}>
            DOMINIO DEMOSTRADO
          </div>
          <div style={{
            fontSize: 72, fontWeight: 900,
            color: finalDomain >= targetScore ? '#4ade80' : '#d6b26f',
            lineHeight: 1, animation: 'countUp .5s ease-out',
          }}>
            {finalDomain}%
          </div>
          <div style={{ fontSize: 12, color: 'rgba(245,236,213,0.5)', marginTop: 8 }}>
            Objetivo: {targetScore}% — {reachedTarget ? '✅ Alcanzado' : `Faltaron ${targetScore - finalDomain} pts`}
          </div>

          {/* Barra de progreso */}
          <div style={{
            marginTop: 16, height: 8, background: 'rgba(245,236,213,0.1)',
            borderRadius: 999, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${clampedReadiness}%`,
              background: finalDomain >= targetScore
                ? 'linear-gradient(90deg, #4ade80, #22c55e)'
                : 'linear-gradient(90deg, #d6b26f, #a8854a)',
              borderRadius: 999,
              transition: 'width 1s ease',
            }} />
          </div>
        </div>

        {/* Stats de la sesión */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10, marginBottom: 16,
        }}>
          {[
            { label: 'SESIONES', value: `${completedSessions.length}/${totalSessions}`, color: '#d6b26f' },
            { label: 'OBJETIVO', value: `${targetScore}%`, color: '#d6b26f' },
            { label: 'PROB. EXAMEN', value: `${examProb}%`, color: finalDomain >= 60 ? '#4ade80' : '#fbbf24' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: 'rgba(245,236,213,0.04)',
              border: '1px solid rgba(245,236,213,0.1)',
              borderRadius: 10, padding: '12px 8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, color }}>{value}</div>
              <div style={{ fontSize: 8, color: 'rgba(245,236,213,0.4)', letterSpacing: 1.5, marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Conceptos dominados */}
        {allConceptsImproved.length > 0 && (
          <div style={{
            background: 'rgba(74,222,128,0.06)',
            border: '1px solid rgba(74,222,128,0.25)',
            borderRadius: 12, padding: '14px 16px', marginBottom: 12,
          }}>
            <div style={{ fontSize: 10, color: '#4ade80', fontWeight: 800, letterSpacing: 1.5, marginBottom: 10 }}>
              ✅ YA DOMINAS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allConceptsImproved.slice(0, 8).map((c, i) => (
                <span key={i} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 999,
                  background: 'rgba(74,222,128,0.12)', color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.25)', fontWeight: 600,
                }}>
                  ✓ {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Conceptos débiles */}
        {allConceptsWeak.length > 0 && (
          <div style={{
            background: 'rgba(251,191,36,0.06)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 12, padding: '14px 16px', marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 800, letterSpacing: 1.5, marginBottom: 10 }}>
              ⚠️ REPASA ANTES DEL EXAMEN
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allConceptsWeak.slice(0, 5).map((c, i) => (
                <span key={i} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 999,
                  background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                  border: '1px solid rgba(251,191,36,0.25)', fontWeight: 600,
                }}>
                  • {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Recomendación final */}
        <div style={{
          background: 'rgba(214,178,111,0.06)',
          border: '1px solid rgba(214,178,111,0.2)',
          borderRadius: 12, padding: '14px 16px', marginBottom: 20,
          fontSize: 13, color: 'rgba(245,236,213,0.7)', lineHeight: 1.6,
        }}>
          {finalDomain >= 80
            ? '🎯 Estás en excelente forma. Descansa bien, confía en tu preparación y ve seguro al examen.'
            : finalDomain >= 60
            ? '📖 Buen trabajo. Repasa los puntos débiles identificados arriba y practica con el Examen ALAI.'
            : '💪 Completaste el programa. Te recomendamos repetir las sesiones donde tuviste más dificultad.'}
        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '14px',
              background: 'linear-gradient(135deg, #d6b26f, #a8854a)',
              border: 'none', borderRadius: 10,
              color: '#1a130d', fontFamily: 'Georgia, serif',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
              letterSpacing: 0.5,
            }}
          >
            Volver al material →
          </button>
          <button
            onClick={onRepeat}
            style={{
              width: '100%', padding: '12px',
              background: 'transparent',
              border: '1.5px solid rgba(214,178,111,0.3)',
              borderRadius: 10,
              color: 'rgba(214,178,111,0.7)', fontFamily: 'Georgia, serif',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            🔁 Repetir programa desde el inicio
          </button>
        </div>
      </div>
    </div>
  )
}
