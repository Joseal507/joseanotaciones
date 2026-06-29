'use client'

import { useState } from 'react'

export type ProcessStyle = 'book' | 'classic'

interface Props {
  onSelect: (style: ProcessStyle) => void
}

export default function ProcessStyleSelector({ onSelect }: Props) {
  const [hovered, setHovered] = useState<ProcessStyle | null>(null)

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
      padding: 32,
    }}>
      <div style={{
        textAlign: 'center',
        marginBottom: 48,
        fontFamily: 'Georgia, serif',
      }}>
        <div style={{
          fontSize: 11,
          color: 'rgba(214,178,111,0.6)',
          letterSpacing: 3,
          marginBottom: 12,
        }}>
          ÚLTIMA PREGUNTA
        </div>
        <h1 style={{
          fontSize: 32,
          color: '#d6b26f',
          fontWeight: 700,
          margin: 0,
          lineHeight: 1.2,
        }}>
          ¿Cómo quieres ver tu proceso?
        </h1>
        <div style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.5)',
          marginTop: 12,
        }}>
          Elige la experiencia visual que más te guste
        </div>
      </div>

      <div style={{
        display: 'flex',
        gap: 32,
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        {/* Opción: Libro */}
        <button
          onClick={() => onSelect('book')}
          onMouseEnter={() => setHovered('book')}
          onMouseLeave={() => setHovered(null)}
          style={{
            width: 280,
            height: 360,
            background: 'linear-gradient(135deg, #0d0a08 0%, #1a130d 100%)',
            border: hovered === 'book'
              ? '2px solid rgba(214,178,111,0.6)'
              : '2px solid rgba(214,178,111,0.15)',
            borderRadius: 16,
            padding: 28,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#d6b26f',
            transition: 'all 0.3s ease',
            transform: hovered === 'book' ? 'translateY(-6px)' : 'translateY(0)',
            boxShadow: hovered === 'book'
              ? '0 20px 60px rgba(214,178,111,0.2)'
              : '0 10px 30px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{
            fontSize: 11,
            letterSpacing: 2,
            color: 'rgba(214,178,111,0.5)',
          }}>
            RECOMENDADO
          </div>

          <div style={{ fontSize: 72 }}>📖</div>

          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'Georgia, serif',
              marginBottom: 8,
            }}>
              Como un libro
            </div>
            <div style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.5)',
              lineHeight: 1.5,
            }}>
              Tu proceso se vuelve una historia.<br/>
              Cada página es una sesión.<br/>
              Inmersivo y elegante.
            </div>
          </div>
        </button>

        {/* Opción: Clásico (próximamente) */}
        <button
          disabled
          style={{
            width: 280,
            height: 360,
            background: 'linear-gradient(135deg, #0d0a08 0%, #1a130d 100%)',
            border: '2px solid rgba(255,255,255,0.05)',
            borderRadius: 16,
            padding: 28,
            cursor: 'not-allowed',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: 'rgba(255,255,255,0.3)',
            opacity: 0.5,
          }}
        >
          <div style={{
            fontSize: 11,
            letterSpacing: 2,
            color: 'rgba(255,255,255,0.3)',
          }}>
            PRÓXIMAMENTE
          </div>

          <div style={{ fontSize: 72, filter: 'grayscale(1)' }}>📋</div>

          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'Georgia, serif',
              marginBottom: 8,
            }}>
              Vista clásica
            </div>
            <div style={{
              fontSize: 12,
              lineHeight: 1.5,
            }}>
              Lista de sesiones simple<br/>
              y minimalista.
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}
