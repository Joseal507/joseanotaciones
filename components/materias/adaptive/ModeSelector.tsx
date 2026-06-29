'use client'

interface Props {
  onSelectMode: (mode: 'free' | 'adaptive') => void
  onCancel: () => void
}

export default function ModeSelector({ onSelectMode, onCancel }: Props) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 999,
      background: 'rgba(0,0,0,0.85)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: 'min(680px, 100%)',
        background: 'var(--bg-card)',
        border: '2px solid var(--gold)',
        borderRadius: 20,
        boxShadow: '0 32px 80px rgba(0,0,0,.5)',
        padding: 32,
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 800,
            color: 'var(--gold)',
            letterSpacing: 1,
            marginBottom: 8,
          }}>
            ELIGE TU MODO DE ESTUDIO
          </div>
          <div style={{
            fontSize: 22,
            fontWeight: 900,
            color: 'var(--text-primary)',
            marginBottom: 6,
          }}>
            ¿Cómo quieres estudiar hoy?
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Esta decisión cambia toda tu experiencia.
          </div>
        </div>

        {/* Opciones */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          marginBottom: 24,
        }}>
          {/* MODO LIBRE */}
          <button
            onClick={() => onSelectMode('free')}
            style={{
              padding: '20px 18px',
              borderRadius: 16,
              border: '2px solid var(--border-color2)',
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 12,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#38bdf8'
              e.currentTarget.style.background = 'color-mix(in srgb, #38bdf8 6%, transparent)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color2)'
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <div style={{ fontSize: 38 }}>🧰</div>
            <div style={{
              fontSize: 17,
              fontWeight: 900,
              color: 'var(--text-primary)',
            }}>
              Modo Libre
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}>
              Tú decides qué herramienta usar. El círculo completo está disponible: Repasar, Análisis, Flashcards, Quiz, Examen y más.
            </div>
            <div style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              marginTop: 4,
              paddingTop: 10,
              borderTop: '1px solid var(--border-color2)',
              width: '100%',
            }}>
              ✓ Total libertad<br />
              ✓ Sin preguntas previas<br />
              ✓ Mide progreso por uso
            </div>
          </button>

          {/* MODO ADAPTATIVO */}
          <button
            onClick={() => onSelectMode('adaptive')}
            style={{
              padding: '20px 18px',
              borderRadius: 16,
              border: '2px solid var(--gold)',
              background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 12,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'color-mix(in srgb, var(--gold) 14%, transparent)'
              e.currentTarget.style.transform = 'translateY(-2px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'color-mix(in srgb, var(--gold) 8%, transparent)'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            <div style={{ fontSize: 38 }}>🤖</div>
            <div style={{
              fontSize: 17,
              fontWeight: 900,
              color: 'var(--gold)',
            }}>
              Modo Adaptativo
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}>
              ALAI te hace 4 preguntas y diseña un programa personalizado de sesiones para llegar a tu objetivo.
            </div>
            <div style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              marginTop: 4,
              paddingTop: 10,
              borderTop: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
              width: '100%',
            }}>
              ✓ Programa personalizado<br />
              ✓ Se adapta a tu progreso<br />
              ✓ Mide dominio real
            </div>
          </button>
        </div>

        {/* Cancel */}
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-faint)',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '8px 16px',
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
