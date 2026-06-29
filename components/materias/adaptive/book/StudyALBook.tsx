'use client'

import { useState, useEffect } from 'react'
import type { AdaptiveProgram, AdaptiveSession } from '../../../../lib/adaptive'
import { SESSION_PURPOSE_LABELS } from '../../../../lib/adaptive'

interface Props {
  program: AdaptiveProgram
  materialTitle: string
  onStartSession: () => void
  onClose: () => void
  isReady?: boolean
  loadingMessage?: string
}

type ViewState = 'closed' | 'opening' | 'opened' | 'closing'

export default function StudyALBook({ program, materialTitle, onStartSession, onClose, isReady = true, loadingMessage }: Props) {
  const [viewState, setViewState] = useState<ViewState>('closed')
  const [currentSpread, setCurrentSpread] = useState(0)
  const [flipDirection, setFlipDirection] = useState<'next' | 'prev' | null>(null)
  const [flippingPage, setFlippingPage] = useState(false)

  const spreads: AdaptiveSession[][] = []
  for (let i = 0; i < program.sessions.length; i += 2) {
    spreads.push(program.sessions.slice(i, i + 2))
  }

  useEffect(() => {
    const currentIdx = program.sessions.findIndex(s => s.status === 'available')
    if (currentIdx >= 0) {
      setCurrentSpread(Math.floor(currentIdx / 2))
    }
  }, [program.sessions])

  const handleOpen = () => {
    setViewState('opening')
    setTimeout(() => setViewState('opened'), 1400)
  }

  const handleClose = () => {
    setViewState('closing')
    setTimeout(() => {
      setViewState('closed')
    }, 800)
  }

  // Cerrar completamente (volver al programa)
  const handleExit = () => {
    onClose()
  }

  const goToSpread = (idx: number) => {
    if (idx < 0 || idx >= spreads.length || flippingPage) return
    const direction = idx > currentSpread ? 'next' : 'prev'
    setFlipDirection(direction)
    setFlippingPage(true)
    setTimeout(() => {
      setCurrentSpread(idx)
      setTimeout(() => {
        setFlippingPage(false)
        setFlipDirection(null)
      }, 50)
    }, 700)
  }

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
      overflow: 'hidden',
      perspective: '3000px',
    }}>
      <style>{`
        @keyframes pageFlipNext {
          0% { transform: rotateY(0deg); box-shadow: 0 0 0 rgba(0,0,0,0); }
          40% { box-shadow: -25px 10px 35px rgba(0,0,0,0.45); }
          100% { transform: rotateY(-180deg); box-shadow: 0 0 0 rgba(0,0,0,0); }
        }
        @keyframes pageFlipPrev {
          0% { transform: rotateY(180deg); box-shadow: 0 0 0 rgba(0,0,0,0); }
          40% { box-shadow: 25px 10px 35px rgba(0,0,0,0.45); }
          100% { transform: rotateY(0deg); box-shadow: 0 0 0 rgba(0,0,0,0); }
        }
          100% { transform: rotateY(0deg); }
        }
        @keyframes stampImpact {
          0% { transform: scale(4) rotate(-25deg); opacity: 0; }
          40% { transform: scale(1.3) rotate(-12deg); opacity: 0.9; }
          70% { transform: scale(0.95) rotate(-8deg); opacity: 0.8; }
          100% { transform: scale(1) rotate(-10deg); opacity: 0.75; }
        }
        @keyframes shimmer {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes floatParticle {
          0%, 100% { transform: translateY(0px); opacity: 0.3; }
          50% { transform: translateY(-20px); opacity: 0.6; }
        }

        /* ABRIR LIBRO: portada gira hacia la izquierda revelando páginas */
        @keyframes coverOpen {
          0% {
            transform: rotateY(0deg);
            box-shadow: 0 30px 80px rgba(0,0,0,0.7);
          }
          100% {
            transform: rotateY(-180deg);
            box-shadow: -20px 30px 80px rgba(0,0,0,0.8);
          }
        }
        @keyframes fadeInPage {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes pagesAppear {
          0% { opacity: 0; transform: scaleX(0); }
          60% { opacity: 0; transform: scaleX(0); }
          100% { opacity: 1; transform: scaleX(1); }
        }
        @keyframes bookCloseReverse {
          0% { transform: rotateY(-180deg); }
          100% { transform: rotateY(0deg); }
        }
        @keyframes fadeOutPages {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }

        .stamp-leido {
          animation: stampImpact 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>

      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 20,
          right: 24,
          background: 'rgba(255,255,255,0.05)',
          /* sale completamente */
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.15)',
          color: 'rgba(255,255,255,0.6)',
          fontSize: 14,
          width: 36,
          height: 36,
          borderRadius: '50%',
          cursor: 'pointer',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>

      {/* Partículas */}
      {[...Array(8)].map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: 2,
          height: 2,
          background: '#d6b26f',
          borderRadius: '50%',
          left: `${10 + (i * 11)}%`,
          top: `${20 + (i % 3) * 25}%`,
          animation: `floatParticle ${4 + i % 3}s ease-in-out infinite`,
          animationDelay: `${i * 0.5}s`,
          opacity: 0.3,
        }} />
      ))}

      <div style={{
        position: 'absolute',
        width: '60%',
        height: '60%',
        background: 'radial-gradient(circle, rgba(214,178,111,0.06) 0%, transparent 60%)',
        pointerEvents: 'none',
        animation: 'shimmer 4s ease-in-out infinite',
      }} />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* RENDER SEGÚN ESTADO                                          */}
      {/* ═══════════════════════════════════════════════════════════ */}

      {viewState === 'closed' && (
        <BookClosedView
          materialTitle={materialTitle}
          totalSessions={program.sessions.length}
          onOpen={handleOpen}
          isReady={isReady}
          loadingMessage={loadingMessage}
        />
      )}

      {viewState === 'opening' && (
        <OpeningAnimation
          materialTitle={materialTitle}
          firstSpread={spreads[currentSpread] || []}
          startIndex={currentSpread * 2}
        />
      )}

      {viewState === 'opened' && (
        <BookOpenView
          spreads={spreads}
          currentSpread={currentSpread}
          onGoToSpread={goToSpread}
          onStartSession={onStartSession}
          onClose={handleClose}
          materialTitle={materialTitle}
          isReady={isReady}
          loadingMessage={loadingMessage}
          currentSessionIndex={program.currentSessionIndex}
          flippingPage={flippingPage}
          flipDirection={flipDirection}
        />
      )}

      {viewState === 'closing' && (
        <ClosingAnimation
          materialTitle={materialTitle}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// LIBRO CERRADO (estático)
// ═══════════════════════════════════════════════════════════════
function BookClosedView({
  materialTitle,
  totalSessions,
  onOpen,
  isReady = true,
  loadingMessage,
}: {
  materialTitle: string
  totalSessions: number
  onOpen: () => void
  isReady?: boolean
  loadingMessage?: string
  currentSessionIndex?: number
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 32,
    }}>
      <BookCover
        materialTitle={materialTitle}
        onClick={onOpen}
        interactive
      />

      <button
        onClick={isReady ? onOpen : undefined}
        disabled={!isReady}
        style={{
          padding: '14px 36px',
          borderRadius: 999,
          background: isReady ? 'linear-gradient(135deg, #d6b26f 0%, #a8854a 100%)' : 'rgba(214,178,111,0.3)',
          border: 'none',
          color: isReady ? '#1a130d' : 'rgba(26,19,13,0.5)',
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: 1.5,
          cursor: isReady ? 'pointer' : 'wait',
          boxShadow: isReady ? '0 6px 25px rgba(214,178,111,0.4), inset 0 1px 0 rgba(255,255,255,0.3)' : 'none',
          transition: 'all 0.3s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-3px)'
          e.currentTarget.style.boxShadow = '0 10px 35px rgba(214,178,111,0.6)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 6px 25px rgba(214,178,111,0.4)'
        }}
      >
        {isReady ? 'ABRIR EL LIBRO' : 'PREPARANDO...'}
      </button>

      <div style={{
        fontSize: 11,
        color: 'rgba(255,255,255,0.4)',
        letterSpacing: 1.5,
      }}>
        {isReady ? `${totalSessions} sesiones · Adaptado para ti` : (loadingMessage || 'ALAI está analizando tu material...')}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ANIMACIÓN DE APERTURA (portada gira a la izquierda)
// ═══════════════════════════════════════════════════════════════
function OpeningAnimation({
  materialTitle,
  firstSpread,
  startIndex,
}: {
  materialTitle: string
  firstSpread: AdaptiveSession[]
  startIndex: number
}) {
  return (
    <div style={{
      width: '100%',
      maxWidth: 1000,
      height: 600,
      position: 'relative',
      transformStyle: 'preserve-3d',
      background: '#0a0806',
      borderRadius: 8,
      boxShadow: '0 40px 100px rgba(0,0,0,0.8), 0 0 80px rgba(214,178,111,0.08)',
      overflow: 'hidden',
    }}>
      {/* Página derecha (fondo) — se ve siempre */}
      <div style={{
        position: 'absolute',
        right: 0,
        top: 0,
        width: '50%',
        height: '100%',
        background: 'linear-gradient(135deg, #e8d9b0 0%, #f5ecd5 100%)',
        boxShadow: 'inset 8px 0 20px rgba(0,0,0,0.15)',
      }}>
        <BookPageContent
          session={firstSpread[1]}
          sessionIndex={startIndex + 1}
          side="right"
        />
      </div>

      {/* Página izquierda — aparece DESPUÉS de la rotación de la portada */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '50%',
        height: '100%',
        background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
        boxShadow: 'inset -8px 0 20px rgba(0,0,0,0.15)',
        opacity: 0,
        animation: 'fadeInPage 0.3s ease-out 1.1s forwards',
      }}>
        <BookPageContent
          session={firstSpread[0]}
          sessionIndex={startIndex}
          side="left"
        />
      </div>

      {/* PORTADA — gira hacia la izquierda */}
      <div style={{
        position: 'absolute',
        right: 0,
        top: 0,
        width: '50%',
        height: '100%',
        transformOrigin: 'left center',
        transformStyle: 'preserve-3d',
        animation: 'coverOpen 1.2s cubic-bezier(0.7, 0, 0.3, 1) forwards',
        zIndex: 20,
      }}>
        {/* Cara frontal: portada del libro */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backfaceVisibility: 'hidden',
          background: 'linear-gradient(135deg, #0d0a08 0%, #1a130d 50%, #0d0a08 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(214,178,111,0.2), inset 10px 0 25px rgba(0,0,0,0.5)',
          borderRadius: '0 12px 12px 0',
          padding: '40px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <BookCoverContent materialTitle={materialTitle} />
        </div>

        {/* Cara trasera: cuando rota, se ve este color */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backfaceVisibility: 'hidden',
          transform: 'rotateY(180deg)',
          background: 'linear-gradient(135deg, #1a1410 0%, #0d0a08 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(214,178,111,0.15)',
        }} />
      </div>

      {/* Lomo central */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: 40,
        transform: 'translateX(-50%)',
        background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.5) 50%, transparent 100%)',
        pointerEvents: 'none',
        zIndex: 30,
      }} />
    </div>
  )
}

function ClosingAnimation({ materialTitle }: { materialTitle: string }) {
  return (
    <div style={{
      width: '100%',
      maxWidth: 1000,
      height: 600,
      position: 'relative',
      transformStyle: 'preserve-3d',
      animation: 'fadeOutPages 1s ease-out forwards',
    }}>
      <BookCover materialTitle={materialTitle} interactive={false} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PORTADA REUTILIZABLE
// ═══════════════════════════════════════════════════════════════
function BookCover({
  materialTitle,
  onClick,
  interactive,
}: {
  materialTitle: string
  onClick?: () => void
  interactive: boolean
}) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        width: 340,
        height: 480,
        borderRadius: '4px 12px 12px 4px',
        background: `linear-gradient(135deg, #0d0a08 0%, #1a130d 50%, #0d0a08 100%)`,
        boxShadow: hover
          ? `0 40px 100px rgba(0,0,0,0.8), 0 0 80px rgba(214,178,111,0.2), inset 0 0 0 1px rgba(214,178,111,0.3), inset -10px 0 25px rgba(0,0,0,0.5)`
          : `0 30px 80px rgba(0,0,0,0.7), 0 0 60px rgba(214,178,111,0.1), inset 0 0 0 1px rgba(214,178,111,0.2), inset -10px 0 25px rgba(0,0,0,0.5)`,
        cursor: interactive ? 'pointer' : 'default',
        position: 'relative',
        padding: '48px 36px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        textAlign: 'center',
        overflow: 'hidden',
        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        transform: hover ? 'translateY(-8px) rotateX(2deg) rotateY(-2deg)' : 'translateY(0)',
      }}
    >
      <BookCoverContent materialTitle={materialTitle} />
    </div>
  )
}

// Contenido interno de la portada (separado para reusar)
function BookCoverContent({ materialTitle }: { materialTitle: string }) {
  return (
    <>
      <div style={{
        position: 'absolute',
        inset: 18,
        border: '1.5px solid rgba(214,178,111,0.35)',
        borderRadius: 4,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        inset: 24,
        border: '1px solid rgba(214,178,111,0.15)',
        borderRadius: 2,
        pointerEvents: 'none',
      }} />

      {[{top:30,left:30},{top:30,right:30},{bottom:30,left:30},{bottom:30,right:30}].map((pos, i) => (
        <div key={i} style={{
          position: 'absolute',
          ...pos,
          width: 12,
          height: 12,
          border: '1.5px solid rgba(214,178,111,0.5)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />
      ))}

      <div style={{
        width: 90,
        height: 90,
        marginTop: 24,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(214,178,111,0.25) 0%, transparent 70%)',
        border: '1px solid rgba(214,178,111,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 44,
        color: '#d6b26f',
      }}>
        📖
      </div>

      <div style={{
        fontFamily: 'Georgia, "Times New Roman", serif',
        color: '#d6b26f',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: 1,
          lineHeight: 1.15,
          textShadow: '0 2px 10px rgba(214,178,111,0.3)',
        }}>
          The<br/>
          <span style={{ fontStyle: 'italic', fontWeight: 600 }}>StudyAL</span><br/>
          Process
        </div>
        <div style={{
          fontSize: 9,
          color: 'rgba(214,178,111,0.65)',
          letterSpacing: 2.5,
          marginTop: 14,
          fontWeight: 500,
        }}>
          TU CAMINO ADAPTATIVO<br/>
          HACIA EL DOMINIO DEL TEMA
        </div>
      </div>

      <div style={{
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid rgba(214,178,111,0.4)',
        borderRadius: 4,
        padding: '14px 22px',
        maxWidth: '88%',
        backdropFilter: 'blur(5px)',
      }}>
        <div style={{
          fontSize: 9,
          color: 'rgba(214,178,111,0.6)',
          letterSpacing: 2.5,
          marginBottom: 6,
          fontWeight: 600,
        }}>
          TEMA
        </div>
        <div style={{
          fontSize: 15,
          fontWeight: 600,
          color: '#d6b26f',
          fontStyle: 'italic',
          lineHeight: 1.3,
        }}>
          {materialTitle}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: -36,
        left: '22%',
        width: 28,
        height: 80,
        background: 'linear-gradient(180deg, #8b1a1a 0%, #5a0f0f 100%)',
        boxShadow: '3px 3px 12px rgba(0,0,0,0.6)',
        clipPath: 'polygon(0 0, 100% 0, 100% 85%, 50% 100%, 0 85%)',
      }} />
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// LIBRO ABIERTO
// ═══════════════════════════════════════════════════════════════
function BookOpenView({
  spreads,
  currentSpread,
  onGoToSpread,
  onStartSession,
  onClose,
  materialTitle,
  flippingPage,
  flipDirection,
  isReady = true,
  loadingMessage,
  currentSessionIndex,
}: {
  spreads: AdaptiveSession[][]
  currentSpread: number
  onGoToSpread: (idx: number) => void
  onStartSession: () => void
  onClose: () => void
  materialTitle: string
  flippingPage: boolean
  flipDirection: 'next' | 'prev' | null
  isReady?: boolean
  loadingMessage?: string
  currentSessionIndex?: number
}) {
  const spread = spreads[currentSpread] || []
  const leftSession = spread[0]
  const rightSession = spread[1]
  const nextSpread = spreads[currentSpread + 1]
  const prevSpread = spreads[currentSpread - 1]

  return (
    <div style={{
      width: '100%',
      maxWidth: 1100,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 24,
    }}>
      <div style={{
        color: 'rgba(214,178,111,0.7)',
        fontFamily: 'Georgia, serif',
        fontSize: 14,
        fontStyle: 'italic',
        textAlign: 'center',
      }}>
        {materialTitle}
      </div>

      <div style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        maxWidth: 1000,
        height: 600,
        background: '#0a0806',
        borderRadius: 8,
        boxShadow: `0 40px 100px rgba(0,0,0,0.8), 0 0 80px rgba(214,178,111,0.08), inset 0 0 0 1px rgba(214,178,111,0.15)`,
        overflow: 'visible',
        transformStyle: 'preserve-3d',
      }}>
        {/* Lomo */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          bottom: 0,
          width: 40,
          transform: 'translateX(-50%)',
          background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.5) 50%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 5,
        }} />

        {/* Páginas estáticas */}
        <BookPageStatic session={leftSession} sessionIndex={currentSpread * 2} side="left" />
        <BookPageStatic session={rightSession} sessionIndex={currentSpread * 2 + 1} side="right" />

        {/* FLIP NEXT: página derecha actual gira hacia la izquierda */}
        {flippingPage && flipDirection === 'next' && nextSpread && (
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '50%',
            height: '100%',
            transformStyle: 'preserve-3d',
            transformOrigin: 'left center',
            animation: 'pageFlipNext 0.7s cubic-bezier(0.45, 0, 0.55, 1) forwards',
            zIndex: 50,
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, #e8d9b0 0%, #f5ecd5 100%)',
              backfaceVisibility: 'hidden',
            }}>
              <BookPageContent
                session={rightSession}
                sessionIndex={currentSpread * 2 + 1}
                side="right"
              />
            </div>
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}>
              <BookPageContent
                session={nextSpread[0]}
                sessionIndex={(currentSpread + 1) * 2}
                side="left"
              />
            </div>
          </div>
        )}

        {/* FLIP PREV: página izquierda actual gira hacia la derecha */}
        {flippingPage && flipDirection === 'prev' && prevSpread && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '50%',
            height: '100%',
            transformStyle: 'preserve-3d',
            transformOrigin: 'right center',
            animation: 'pageFlipPrev 0.7s cubic-bezier(0.45, 0, 0.55, 1) forwards',
            zIndex: 50,
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          }}>
            {/* Cara frontal (página actual izquierda) */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}>
              <BookPageContent
                session={leftSession}
                sessionIndex={currentSpread * 2}
                side="left"
              />
            </div>
            {/* Cara trasera (página anterior derecha) */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, #e8d9b0 0%, #f5ecd5 100%)',
              backfaceVisibility: 'hidden',
            }}>
              <BookPageContent
                session={prevSpread[1]}
                sessionIndex={(currentSpread - 1) * 2 + 1}
                side="right"
              />
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{
          position: 'absolute',
          right: -32,
          top: 60,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          {spreads.map((_, i) => {
            const colors = ['#d6b26f', '#1a3a6e', '#5a8a3a', '#6b7280', '#1a3a6e', '#5a8a3a', '#8b1a1a', '#6b7280']
            const color = colors[i % colors.length]
            const isActive = i === currentSpread
            return (
              <button
                key={i}
                onClick={() => onGoToSpread(i)}
                disabled={flippingPage}
                style={{
                  width: 32,
                  height: 38,
                  background: color,
                  border: 'none',
                  borderRadius: '0 6px 6px 0',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: flippingPage ? 'wait' : 'pointer',
                  opacity: isActive ? 1 : 0.55,
                  transform: isActive ? 'translateX(4px)' : 'translateX(0)',
                  boxShadow: isActive ? `0 4px 12px ${color}80` : '2px 2px 4px rgba(0,0,0,0.3)',
                  transition: 'all 0.3s ease',
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
      }}>
        <button
          onClick={() => onGoToSpread(currentSpread - 1)}
          disabled={currentSpread === 0 || flippingPage}
          style={{
            background: 'rgba(214,178,111,0.05)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(214,178,111,0.25)',
            color: 'rgba(214,178,111,0.8)',
            padding: '10px 20px',
            borderRadius: 999,
            cursor: (currentSpread === 0 || flippingPage) ? 'not-allowed' : 'pointer',
            opacity: (currentSpread === 0 || flippingPage) ? 0.3 : 1,
            fontSize: 12,
            transition: 'all 0.2s ease',
          }}
        >
          ← Página anterior
        </button>

        <div style={{
          color: 'rgba(214,178,111,0.6)',
          fontSize: 11,
          letterSpacing: 1.5,
          fontFamily: 'Georgia, serif',
        }}>
          {currentSpread * 2 + 1}–{Math.min(currentSpread * 2 + 2, spreads.length * 2)} de {spreads.length * 2}
        </div>

        <button
          onClick={() => onGoToSpread(currentSpread + 1)}
          disabled={currentSpread === spreads.length - 1 || flippingPage}
          style={{
            background: 'rgba(214,178,111,0.05)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(214,178,111,0.25)',
            color: 'rgba(214,178,111,0.8)',
            padding: '10px 20px',
            borderRadius: 999,
            cursor: (currentSpread === spreads.length - 1 || flippingPage) ? 'not-allowed' : 'pointer',
            opacity: (currentSpread === spreads.length - 1 || flippingPage) ? 0.3 : 1,
            fontSize: 12,
            transition: 'all 0.2s ease',
          }}
        >
          Página siguiente →
        </button>
      </div>

      <button
        onClick={() => {
          if (!isReady) return
          const currentSpreadSessions = spreads[currentSpread] || []
          const hasAvailable = currentSpreadSessions.some(s => s.status === 'available')
          if (!hasAvailable) return
          onStartSession()
        }}
        disabled={!isReady || !(spreads[currentSpread] || []).some(s => s.status === 'available')}
        style={{
          padding: '14px 36px',
          borderRadius: 999,
          background: isReady ? 'linear-gradient(135deg, #d6b26f 0%, #a8854a 100%)' : 'rgba(214,178,111,0.3)',
          border: 'none',
          color: isReady ? '#1a130d' : 'rgba(26,19,13,0.5)',
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: 1.5,
          cursor: isReady ? 'pointer' : 'wait',
          boxShadow: isReady ? '0 6px 25px rgba(214,178,111,0.4)' : 'none',
          transition: 'all 0.3s ease',
        }}
        onMouseEnter={(e) => {
          if (!isReady) return
          e.currentTarget.style.transform = 'translateY(-3px)'
          e.currentTarget.style.boxShadow = '0 10px 35px rgba(214,178,111,0.6)'
        }}
        onMouseLeave={(e) => {
          if (!isReady) return
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 6px 25px rgba(214,178,111,0.4)'
        }}
      >
        {(() => {
          if (!isReady) return loadingMessage || 'PREPARANDO MATERIAL...'

          // Validar que la sesión visible está disponible
          const currentSpreadSessions = spreads[currentSpread] || []
          const visibleAvailable = currentSpreadSessions.find(s => s.status === 'available')
          const visibleCompleted = currentSpreadSessions.filter(s => s.status === 'completed')

          if (!visibleAvailable) {
            if (visibleCompleted.length === currentSpreadSessions.length && currentSpreadSessions.length > 0) {
              return '✓ ESTAS SESIONES YA ESTÁN COMPLETADAS'
            }
            return '🔒 ESTA SESIÓN AÚN ESTÁ BLOQUEADA'
          }

          return '▶ EMPEZAR ESTA SESIÓN'
        })()}
      </button>

      {/* Mensaje contextual debajo del botón */}
      {isReady && (() => {
        const currentSpreadSessions = spreads[currentSpread] || []
        const visibleAvailable = currentSpreadSessions.find(s => s.status === 'available')

        if (!visibleAvailable) {
          const allCompleted = currentSpreadSessions.every(s => s.status === 'completed') && currentSpreadSessions.length > 0
          if (allCompleted) {
            return (
              <div style={{
                marginTop: 12,
                fontSize: 11,
                color: 'rgba(214,178,111,0.6)',
                fontStyle: 'italic',
                textAlign: 'center',
              }}>
                Avanza a la página siguiente para continuar
              </div>
            )
          }
          return (
            <div style={{
              marginTop: 12,
              fontSize: 11,
              color: 'rgba(214,178,111,0.6)',
              fontStyle: 'italic',
              textAlign: 'center',
            }}>
              Completa las sesiones anteriores primero
            </div>
          )
        }
        return null
      })()}
    </div>
  )
}

function BookPageStatic(props: { session: AdaptiveSession | undefined; sessionIndex: number; side: 'left' | 'right' }) {
  return (
    <div style={{
      flex: 1,
      background: props.side === 'left'
        ? 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)'
        : 'linear-gradient(135deg, #e8d9b0 0%, #f5ecd5 100%)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <BookPageContent {...props} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CONTENIDO DE PÁGINA
// ═══════════════════════════════════════════════════════════════
function BookPageContent({
  session,
  sessionIndex,
  side,
}: {
  session: AdaptiveSession | undefined
  sessionIndex: number
  side: 'left' | 'right'
}) {
  if (!session) {
    return (
      <div style={{
        height: '100%',
        padding: '40px 50px',
        position: 'relative',
      }}>
        <div style={{
          fontSize: 10,
          color: 'rgba(58,46,31,0.3)',
          textAlign: 'center',
          marginTop: '40%',
          fontStyle: 'italic',
          fontFamily: 'Georgia, serif',
        }}>
          ~ fin del libro ~
        </div>
      </div>
    )
  }

  const purposeLabel = SESSION_PURPOSE_LABELS[session.purpose] || 'Estudiar'
  const isCompleted = session.status === 'completed'
  const isCurrent = session.status === 'available'

  // ─── TÍTULO REAL: el topic, no el purpose ─────────────────
  const mainTitle = session.topicTitle || session.title || `Sesión ${sessionIndex + 1}`
  const subtitle = purposeLabel // "Repasar", "Análisis", etc.

  return (
    <div style={{
      height: '100%',
      padding: '40px 50px',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: 'Georgia, serif',
      color: '#3a2e1f',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          radial-gradient(circle at 30% 20%, rgba(139,69,19,0.04) 0%, transparent 50%),
          radial-gradient(circle at 70% 80%, rgba(139,69,19,0.05) 0%, transparent 50%),
          radial-gradient(circle at 90% 10%, rgba(139,69,19,0.03) 0%, transparent 30%)
        `,
        pointerEvents: 'none',
      }} />

      {isCompleted && (
        <div className="stamp-leido" style={{
          position: 'absolute',
          top: 70,
          right: 35,
          width: 130,
          height: 130,
          borderRadius: '50%',
          border: '4px solid #8b1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8b1a1a',
          fontSize: 22,
          fontWeight: 900,
          fontFamily: 'Georgia, serif',
          letterSpacing: 2,
          transform: 'rotate(-10deg)',
          opacity: 0.75,
          boxShadow: 'inset 0 0 0 2px #8b1a1a, 0 2px 8px rgba(139,26,26,0.2)',
          pointerEvents: 'none',
          zIndex: 30,
          filter: 'contrast(1.1)',
        }}>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}>
            <span style={{ fontSize: 26, lineHeight: 1, letterSpacing: 3 }}>LEÍDO</span>
            <div style={{
              width: 60,
              height: 1,
              background: '#8b1a1a',
              opacity: 0.5,
            }} />
            <span style={{ fontSize: 9, letterSpacing: 2, opacity: 0.7 }}>COMPLETADO</span>
          </div>
        </div>
      )}

      <div style={{
        fontSize: 8,
        letterSpacing: 3,
        color: 'rgba(58,46,31,0.45)',
        marginBottom: 24,
        fontWeight: 600,
      }}>
        THE STUDYAL PROCESS
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 18, alignItems: 'flex-start' }}>
        <div style={{
          background: '#3a2e1f',
          color: '#f5ecd5',
          padding: '8px 14px',
          borderRadius: 4,
          textAlign: 'center',
          minWidth: 60,
          boxShadow: '2px 2px 6px rgba(58,46,31,0.2)',
        }}>
          <div style={{ fontSize: 8, letterSpacing: 2, opacity: 0.75 }}>SESIÓN</div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
            {String(sessionIndex + 1).padStart(2, '0')}
          </div>
        </div>
        <div style={{ flex: 1, paddingTop: 2 }}>
          {/* TÍTULO PRINCIPAL = TOPIC */}
          <div style={{
            fontSize: 20,
            fontWeight: 700,
            color: '#3a2e1f',
            lineHeight: 1.15,
            marginBottom: 4,
          }}>
            {mainTitle}
          </div>
          {/* SUBTÍTULO = PURPOSE + FORMAT */}
          <div style={{
            fontSize: 11,
            color: 'rgba(58,46,31,0.6)',
            fontStyle: 'italic',
            letterSpacing: 0.5,
          }}>
            {subtitle}
            {(session as any).sessionFormat && (
              <span style={{
                marginLeft: 8,
                fontSize: 9,
                letterSpacing: 1,
                color: 'rgba(58,46,31,0.45)',
                textTransform: 'uppercase',
                fontStyle: 'normal',
              }}>
                · {(session as any).sessionFormat.replace('_', ' ')}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 9,
          letterSpacing: 2.5,
          color: 'rgba(58,46,31,0.55)',
          marginBottom: 8,
          fontWeight: 600,
        }}>
          OBJETIVO
        </div>
        <div style={{
          fontSize: 12,
          color: '#3a2e1f',
          lineHeight: 1.5,
        }}>
          {session.objective}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 9,
          letterSpacing: 2.5,
          color: 'rgba(58,46,31,0.55)',
          marginBottom: 10,
          fontWeight: 600,
        }}>
          ACTIVIDADES
        </div>
        {session.steps.slice(0, 4).map((step, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 11.5,
            color: '#3a2e1f',
            marginBottom: 6,
            lineHeight: 1.4,
          }}>
            <span style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '1.5px solid rgba(58,46,31,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              color: 'rgba(58,46,31,0.5)',
              flexShrink: 0,
            }}>
              {isCompleted ? '✓' : ''}
            </span>
            {step.title}
          </div>
        ))}
      </div>

      {session.targetConcepts && session.targetConcepts.length > 0 && (
        <div style={{
          background: 'rgba(245,236,213,0.7)',
          border: '1px dashed rgba(58,46,31,0.3)',
          borderRadius: 4,
          padding: '14px 16px',
          marginBottom: 16,
          fontSize: 10.5,
        }}>
          <div style={{
            fontSize: 8,
            letterSpacing: 2.5,
            color: 'rgba(58,46,31,0.6)',
            marginBottom: 8,
            fontWeight: 600,
          }}>
            ENFOQUE ADAPTATIVO
          </div>
          <div style={{ color: '#3a2e1f', lineHeight: 1.5 }}>
            Basado en tu nivel actual, priorizamos: <strong>{session.targetConcepts.slice(0, 3).join(', ')}</strong>.
          </div>
          <div style={{ color: 'rgba(58,46,31,0.6)', marginTop: 8, fontStyle: 'italic', fontSize: 10 }}>
            {/* Duración eliminada — cada uno se toma el tiempo que necesite */}
          </div>
        </div>
      )}

      <div style={{
        position: 'absolute',
        bottom: 30,
        left: 50,
        right: 50,
      }}>
        <div style={{
          fontSize: 8,
          letterSpacing: 2.5,
          color: 'rgba(58,46,31,0.5)',
          marginBottom: 10,
          fontWeight: 600,
        }}>
          PROGRESO
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {session.steps.map((_, i) => (
            <div key={i} style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: isCompleted
                ? '#5a8a3a'
                : isCurrent && i === 0
                ? '#d6b26f'
                : 'rgba(58,46,31,0.15)',
              boxShadow: isCompleted ? '0 0 4px rgba(90,138,58,0.5)' : 'none',
            }} />
          ))}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 12,
        [side === 'left' ? 'left' : 'right']: 50,
        fontSize: 10,
        color: 'rgba(58,46,31,0.35)',
        fontStyle: 'italic',
      }}>
        {sessionIndex + 1}
      </div>
    </div>
  )
}
