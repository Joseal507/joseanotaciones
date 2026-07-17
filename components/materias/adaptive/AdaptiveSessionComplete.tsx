'use client'

import type { AdaptiveSession } from '../../../lib/adaptive'
import { SESSION_PURPOSE_EMOJI } from '../../../lib/adaptive'

interface Props {
  session: AdaptiveSession
  domainBefore: number
  domainAfter: number
  nextSession: AdaptiveSession | null
  onContinue: () => void
}

export default function AdaptiveSessionComplete({
  session,
  domainBefore,
  domainAfter,
  nextSession,
  onContinue,
}: Props) {
  const gain = domainAfter - domainBefore
  const gainPositive = gain > 0
  const conceptsImproved = session.conceptsImproved || []
  const conceptsWeak = session.conceptsStillWeak || []

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--bg-primary)',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      overflow: 'auto',
    }}>
      {/* Fondo sutil */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        background: gainPositive
          ? 'radial-gradient(circle at 50% 40%, color-mix(in srgb, #4ade80 6%, transparent), transparent 55%)'
          : 'radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--gold) 6%, transparent), transparent 55%)',
      }} />

      <div style={{
        width: 'min(480px, 100%)',
        position: 'relative',
        zIndex: 5,
      }}>
        {/* Ícono y título */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>
            {gainPositive ? '✅' : '📝'}
          </div>
          <div style={{
            fontSize: 24,
            fontWeight: 900,
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}>
            Sesión completada
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {SESSION_PURPOSE_EMOJI[session.purpose]} {session.title}
          </div>
        </div>

        {/* Dominio antes → después */}
        <div style={{
          background: 'var(--bg-card)',
          border: `2px solid ${gainPositive ? '#4ade80' : 'var(--border-color2)'}`,
          borderRadius: 16,
          padding: '20px 24px',
          marginBottom: 16,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', marginBottom: 16, letterSpacing: 0.5 }}>
            DOMINIO
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <div>
              <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--text-faint)', lineHeight: 1 }}>
                {domainBefore}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                Antes
              </div>
            </div>
            <div style={{ fontSize: 24, color: gainPositive ? '#4ade80' : 'var(--text-faint)' }}>
              →
            </div>
            <div>
              <div style={{ fontSize: 36, fontWeight: 900, color: gainPositive ? '#4ade80' : 'var(--gold)', lineHeight: 1 }}>
                {domainAfter}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                Después
              </div>
            </div>
          </div>
          {gain !== 0 && (
            <div style={{
              marginTop: 16,
              padding: '6px 14px',
              borderRadius: 999,
              display: 'inline-block',
              background: gainPositive
                ? 'color-mix(in srgb, #4ade80 15%, transparent)'
                : 'color-mix(in srgb, #f87171 15%, transparent)',
              fontSize: 13,
              fontWeight: 900,
              color: gainPositive ? '#4ade80' : '#f87171',
            }}>
              {gainPositive ? '+' : ''}{gain} puntos
            </div>
          )}
        </div>

        {/* Conceptos mejorados */}
        {conceptsImproved.length > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-color2)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#4ade80', marginBottom: 8 }}>
              ✅ Mejoraste en
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {conceptsImproved.slice(0, 4).map((c) => (
                <div key={c} style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 700 }}>
                  • {c}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conceptos débiles */}
        {conceptsWeak.length > 0 && (
          <div style={{
            background: 'var(--bg-card)',
            border: '1.5px solid var(--border-color2)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fbbf24', marginBottom: 8 }}>
              ⚠️ Todavía necesitas trabajar
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {conceptsWeak.slice(0, 4).map((c) => (
                <div key={c} style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 700 }}>
                  • {c}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Siguiente sesión */}
        {nextSession && (
          <div style={{
            background: 'color-mix(in srgb, var(--gold) 8%, var(--bg-card))',
            border: '1.5px solid color-mix(in srgb, var(--gold) 40%, transparent)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 20,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', marginBottom: 6, letterSpacing: 0.5 }}>
              SIGUIENTE SESIÓN
            </div>
            <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--gold)' }}>
              {SESSION_PURPOSE_EMOJI[nextSession.purpose]} {nextSession.title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              ~{nextSession.estimatedMinutes} minutos
            </div>
          </div>
        )}

        {!nextSession && (
          <div style={{
            background: 'color-mix(in srgb, #4ade80 8%, var(--bg-card))',
            border: '1.5px solid #4ade80',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 20,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>🎉</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#4ade80' }}>
              Programa completado
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Completaste todas las sesiones de tu programa.
            </div>
          </div>
        )}

        {/* Botón */}
        <button
          onClick={onContinue}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: 12,
            border: '2px solid var(--gold)',
            background: 'var(--gold)',
            color: '#111',
            fontWeight: 900,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Volver al libro →
        </button>
      </div>
    </div>
  )
}
