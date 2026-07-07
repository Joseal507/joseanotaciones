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
    setTimeout(() => setViewState('closed'), 800)
  }

  const goToSpread = (idx: number) => {
    if (idx < 0 || idx >= spreads.length || flippingPage) return
    const direction = idx > currentSpread ? 'next' : 'prev'
    setFlipDirection(direction)
    setFlippingPage(true)
    setTimeout(() => {
      setCurrentSpread(idx)
      setTimeout(() => { setFlippingPage(false); setFlipDirection(null) }, 50)
    }, 700)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
      zIndex: 100, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', perspective: '3000px',
    }}>
      <style>{`
        @keyframes pageFlipNext {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(-180deg); }
        }
        @keyframes pageFlipPrev {
          0% { transform: rotateY(180deg); }
          100% { transform: rotateY(0deg); }
        }
        @keyframes stampImpact {
          0% { transform: scale(4) rotate(-25deg); opacity: 0; }
          40% { transform: scale(1.3) rotate(-12deg); opacity: 0.9; }
          70% { transform: scale(0.95) rotate(-8deg); opacity: 0.8; }
          100% { transform: scale(1) rotate(-10deg); opacity: 0.75; }
        }
        @keyframes shimmer { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
        @keyframes floatParticle {
          0%, 100% { transform: translateY(0px); opacity: 0.3; }
          50% { transform: translateY(-20px); opacity: 0.6; }
        }
        @keyframes coverOpen {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(-180deg); }
        }
        @keyframes fadeInPage { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes pulseGold {
          0%, 100% { box-shadow: 0 0 0 0 rgba(214,178,111,0.4); }
          50% { box-shadow: 0 0 0 8px rgba(214,178,111,0); }
        }
        .stamp-leido { animation: stampImpact 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .btn-start-session:hover { transform: translateY(-2px) !important; box-shadow: 0 8px 24px rgba(214,178,111,0.5) !important; }
        .btn-repeat-session:hover { transform: translateY(-2px) !important; }
      `}</style>

      <button onClick={onClose} style={{
        position: 'absolute', top: 20, left: 24,
        background: 'rgba(214,178,111,0.08)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(214,178,111,0.3)', color: 'rgba(214,178,111,0.9)',
        padding: '10px 18px', borderRadius: 999, fontSize: 11,
        cursor: 'pointer', letterSpacing: 1.5, fontFamily: 'Georgia, serif', zIndex: 200,
      }}>
        ← Volver al tema
      </button>

      {[...Array(8)].map((_, i) => (
        <div key={i} style={{
          position: 'absolute', width: 2, height: 2, background: '#d6b26f',
          borderRadius: '50%', left: `${10 + i * 11}%`, top: `${20 + (i % 3) * 25}%`,
          animation: `floatParticle ${4 + i % 3}s ease-in-out infinite`,
          animationDelay: `${i * 0.5}s`, opacity: 0.3,
        }} />
      ))}

      {viewState === 'closed' && (
        <BookClosedView
          materialTitle={materialTitle}
          totalSessions={program.sessions.length}
          completedSessions={program.sessions.filter(s => s.status === 'completed').length}
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
        <div style={{ animation: 'shimmer 0.8s ease-out forwards', opacity: 0 }}>
          <BookCover materialTitle={materialTitle} interactive={false} />
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// LIBRO CERRADO
// ═══════════════════════════════════════════════════════════════
function BookClosedView({ materialTitle, totalSessions, completedSessions, onOpen, isReady, loadingMessage }: {
  materialTitle: string; totalSessions: number; completedSessions: number;
  onOpen: () => void; isReady?: boolean; loadingMessage?: string
}) {
  const progress = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
      <BookCover materialTitle={materialTitle} onClick={onOpen} interactive />

      {completedSessions > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 180, height: 3, background: 'rgba(214,178,111,0.2)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#d6b26f', borderRadius: 2, transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: 'rgba(214,178,111,0.7)', letterSpacing: 1 }}>
            {completedSessions}/{totalSessions} sesiones
          </div>
        </div>
      )}

      <button
        onClick={isReady ? onOpen : undefined}
        disabled={!isReady}
        style={{
          padding: '14px 36px', borderRadius: 999,
          background: isReady ? 'linear-gradient(135deg, #d6b26f 0%, #a8854a 100%)' : 'rgba(214,178,111,0.3)',
          border: 'none', color: isReady ? '#1a130d' : 'rgba(26,19,13,0.5)',
          fontSize: 14, fontWeight: 800, letterSpacing: 1.5,
          cursor: isReady ? 'pointer' : 'wait',
          boxShadow: isReady ? '0 6px 25px rgba(214,178,111,0.4)' : 'none',
          transition: 'all 0.3s ease',
        }}
      >
        {isReady ? (completedSessions > 0 ? 'CONTINUAR' : 'ABRIR EL LIBRO') : 'PREPARANDO...'}
      </button>

      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 1.5 }}>
        {isReady ? `${totalSessions} sesiones · Adaptado para ti` : (loadingMessage || 'ALAI está analizando tu material...')}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ANIMACIÓN APERTURA
// ═══════════════════════════════════════════════════════════════
function OpeningAnimation({ materialTitle, firstSpread, startIndex }: {
  materialTitle: string; firstSpread: AdaptiveSession[]; startIndex: number
}) {
  return (
    <div style={{
      width: '100%', maxWidth: 1000, height: 600, position: 'relative',
      transformStyle: 'preserve-3d', background: '#0a0806',
      borderRadius: 8, boxShadow: '0 40px 100px rgba(0,0,0,0.8)', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', right: 0, top: 0, width: '50%', height: '100%',
        background: 'linear-gradient(135deg, #e8d9b0 0%, #f5ecd5 100%)',
      }}>
        <BookPageContent session={firstSpread[1]} sessionIndex={startIndex + 1} side="right" onStartSession={() => {}} isReady={true} />
      </div>
      <div style={{
        position: 'absolute', left: 0, top: 0, width: '50%', height: '100%',
        background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
        opacity: 0, animation: 'fadeInPage 0.3s ease-out 1.1s forwards',
      }}>
        <BookPageContent session={firstSpread[0]} sessionIndex={startIndex} side="left" onStartSession={() => {}} isReady={true} />
      </div>
      <div style={{
        position: 'absolute', right: 0, top: 0, width: '50%', height: '100%',
        transformOrigin: 'left center', transformStyle: 'preserve-3d',
        animation: 'coverOpen 1.2s cubic-bezier(0.7, 0, 0.3, 1) forwards', zIndex: 20,
      }}>
        <div style={{
          position: 'absolute', inset: 0, backfaceVisibility: 'hidden',
          background: 'linear-gradient(135deg, #0d0a08 0%, #1a130d 50%, #0d0a08 100%)',
          borderRadius: '0 12px 12px 0', padding: '40px 36px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <BookCoverContent materialTitle={materialTitle} />
        </div>
        <div style={{
          position: 'absolute', inset: 0, backfaceVisibility: 'hidden',
          transform: 'rotateY(180deg)',
          background: 'linear-gradient(135deg, #1a1410 0%, #0d0a08 100%)',
        }} />
      </div>
      <div style={{
        position: 'absolute', left: '50%', top: 0, bottom: 0, width: 40,
        transform: 'translateX(-50%)',
        background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.5) 50%, transparent 100%)',
        pointerEvents: 'none', zIndex: 30,
      }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PORTADA
// ═══════════════════════════════════════════════════════════════
function BookCover({ materialTitle, onClick, interactive }: {
  materialTitle: string; onClick?: () => void; interactive: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        width: 340, height: 480, borderRadius: '4px 12px 12px 4px',
        background: 'linear-gradient(135deg, #0d0a08 0%, #1a130d 50%, #0d0a08 100%)',
        boxShadow: hover
          ? '0 40px 100px rgba(0,0,0,0.8), 0 0 80px rgba(214,178,111,0.2), inset 0 0 0 1px rgba(214,178,111,0.3)'
          : '0 30px 80px rgba(0,0,0,0.7), 0 0 60px rgba(214,178,111,0.1), inset 0 0 0 1px rgba(214,178,111,0.2)',
        cursor: interactive ? 'pointer' : 'default',
        position: 'relative', padding: '48px 36px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
        textAlign: 'center', overflow: 'hidden',
        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        transform: hover ? 'translateY(-8px) rotateX(2deg) rotateY(-2deg)' : 'translateY(0)',
      }}
    >
      <BookCoverContent materialTitle={materialTitle} />
    </div>
  )
}

function BookCoverContent({ materialTitle }: { materialTitle: string }) {
  return (
    <>
      <div style={{ position: 'absolute', inset: 18, border: '1.5px solid rgba(214,178,111,0.35)', borderRadius: 4, pointerEvents: 'none' }} />
      <div style={{ width: 90, height: 90, marginTop: 24, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(214,178,111,0.25) 0%, transparent 70%)',
        border: '1px solid rgba(214,178,111,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, color: '#d6b26f',
      }}>📖</div>
      <div style={{ fontFamily: 'Georgia, serif', color: '#d6b26f', textAlign: 'center' }}>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 1, lineHeight: 1.15 }}>
          The<br/><span style={{ fontStyle: 'italic', fontWeight: 600 }}>StudyAL</span><br/>Process
        </div>
        <div style={{ fontSize: 9, color: 'rgba(214,178,111,0.65)', letterSpacing: 2.5, marginTop: 14, fontWeight: 500 }}>
          TU CAMINO ADAPTATIVO<br/>HACIA EL DOMINIO DEL TEMA
        </div>
      </div>
      <div style={{
        background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(214,178,111,0.4)',
        borderRadius: 4, padding: '14px 22px', maxWidth: '88%', backdropFilter: 'blur(5px)',
      }}>
        <div style={{ fontSize: 9, color: 'rgba(214,178,111,0.6)', letterSpacing: 2.5, marginBottom: 6, fontWeight: 600 }}>TEMA</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#d6b26f', fontStyle: 'italic', lineHeight: 1.3 }}>{materialTitle}</div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// LIBRO ABIERTO
// ═══════════════════════════════════════════════════════════════
function BookOpenView({
  spreads, currentSpread, onGoToSpread, onStartSession, onClose,
  materialTitle, flippingPage, flipDirection, isReady, loadingMessage, currentSessionIndex,
}: {
  spreads: AdaptiveSession[][]; currentSpread: number;
  onGoToSpread: (idx: number) => void; onStartSession: () => void; onClose: () => void;
  materialTitle: string; flippingPage: boolean; flipDirection: 'next' | 'prev' | null;
  isReady?: boolean; loadingMessage?: string; currentSessionIndex?: number;
}) {
  const spread = spreads[currentSpread] || []
  const leftSession = spread[0]
  const rightSession = spread[1]
  const nextSpread = spreads[currentSpread + 1]
  const prevSpread = spreads[currentSpread - 1]

  return (
    <div style={{ width: '100%', maxWidth: 1100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <div style={{ color: 'rgba(214,178,111,0.7)', fontFamily: 'Georgia, serif', fontSize: 14, fontStyle: 'italic' }}>
        {materialTitle}
      </div>

      <div style={{
        position: 'relative', display: 'flex', width: '100%', maxWidth: 1000, height: 620,
        background: '#0a0806', borderRadius: 8,
        boxShadow: '0 40px 100px rgba(0,0,0,0.8), 0 0 80px rgba(214,178,111,0.08)',
        overflow: 'visible', transformStyle: 'preserve-3d',
      }}>
        {/* Lomo */}
        <div style={{
          position: 'absolute', left: '50%', top: 0, bottom: 0, width: 40,
          transform: 'translateX(-50%)',
          background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.5) 50%, transparent 100%)',
          pointerEvents: 'none', zIndex: 5,
        }} />

        <BookPageStatic session={leftSession} sessionIndex={currentSpread * 2} side="left" onStartSession={onStartSession} isReady={isReady ?? true} />
        <BookPageStatic session={rightSession} sessionIndex={currentSpread * 2 + 1} side="right" onStartSession={onStartSession} isReady={isReady ?? true} />

        {/* FLIP NEXT */}
        {flippingPage && flipDirection === 'next' && nextSpread && (
          <div style={{
            position: 'absolute', top: 0, right: 0, width: '50%', height: '100%',
            transformStyle: 'preserve-3d', transformOrigin: 'left center',
            animation: 'pageFlipNext 0.7s cubic-bezier(0.45, 0, 0.55, 1) forwards', zIndex: 50,
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #e8d9b0 0%, #f5ecd5 100%)', backfaceVisibility: 'hidden' }}>
              <BookPageContent session={rightSession} sessionIndex={currentSpread * 2 + 1} side="right" onStartSession={onStartSession} isReady={isReady ?? true} />
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)', backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
              <BookPageContent session={nextSpread[0]} sessionIndex={(currentSpread + 1) * 2} side="left" onStartSession={onStartSession} isReady={isReady ?? true} />
            </div>
          </div>
        )}

        {/* FLIP PREV */}
        {flippingPage && flipDirection === 'prev' && prevSpread && (
          <div style={{
            position: 'absolute', top: 0, left: 0, width: '50%', height: '100%',
            transformStyle: 'preserve-3d', transformOrigin: 'right center',
            animation: 'pageFlipPrev 0.7s cubic-bezier(0.45, 0, 0.55, 1) forwards', zIndex: 50,
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)', backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
              <BookPageContent session={leftSession} sessionIndex={currentSpread * 2} side="left" onStartSession={onStartSession} isReady={isReady ?? true} />
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #e8d9b0 0%, #f5ecd5 100%)', backfaceVisibility: 'hidden' }}>
              <BookPageContent session={prevSpread[1]} sessionIndex={(currentSpread - 1) * 2 + 1} side="right" onStartSession={onStartSession} isReady={isReady ?? true} />
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ position: 'absolute', right: -32, top: 60, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {spreads.map((spreadItem, i) => {
            const colors = ['#d6b26f', '#1a3a6e', '#5a8a3a', '#6b7280', '#1a3a6e', '#5a8a3a', '#8b1a1a', '#6b7280']
            const color = colors[i % colors.length]
            const isActive = i === currentSpread
            const isDone = spreadItem.every(s => s.status === 'completed')
            return (
              <button key={i} onClick={() => onGoToSpread(i)} disabled={flippingPage} style={{
                width: 32, height: 38, background: color, border: 'none',
                borderRadius: '0 6px 6px 0', color: '#fff', fontSize: 11, fontWeight: 700,
                cursor: flippingPage ? 'wait' : 'pointer',
                opacity: isActive ? 1 : 0.55,
                transform: isActive ? 'translateX(4px)' : 'translateX(0)',
                boxShadow: isActive ? `0 4px 12px ${color}80` : '2px 2px 4px rgba(0,0,0,0.3)',
                transition: 'all 0.3s ease',
                position: 'relative',
              }}>
                {isDone ? '✓' : String(i + 1).padStart(2, '0')}
              </button>
            )
          })}
        </div>
      </div>

      {/* Navegación */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <button onClick={() => onGoToSpread(currentSpread - 1)} disabled={currentSpread === 0 || flippingPage} style={{
          background: 'rgba(214,178,111,0.05)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(214,178,111,0.25)', color: 'rgba(214,178,111,0.8)',
          padding: '10px 20px', borderRadius: 999,
          cursor: (currentSpread === 0 || flippingPage) ? 'not-allowed' : 'pointer',
          opacity: (currentSpread === 0 || flippingPage) ? 0.3 : 1, fontSize: 12,
        }}>← Página anterior</button>

        <div style={{ color: 'rgba(214,178,111,0.6)', fontSize: 11, letterSpacing: 1.5, fontFamily: 'Georgia, serif' }}>
          {currentSpread * 2 + 1}–{Math.min(currentSpread * 2 + 2, spreads.length * 2)} de {spreads.length * 2}
        </div>

        <button onClick={() => onGoToSpread(currentSpread + 1)} disabled={currentSpread === spreads.length - 1 || flippingPage} style={{
          background: 'rgba(214,178,111,0.05)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(214,178,111,0.25)', color: 'rgba(214,178,111,0.8)',
          padding: '10px 20px', borderRadius: 999,
          cursor: (currentSpread === spreads.length - 1 || flippingPage) ? 'not-allowed' : 'pointer',
          opacity: (currentSpread === spreads.length - 1 || flippingPage) ? 0.3 : 1, fontSize: 12,
        }}>Página siguiente →</button>
      </div>
    </div>
  )
}

function BookPageStatic(props: {
  session: AdaptiveSession | undefined; sessionIndex: number; side: 'left' | 'right';
  onStartSession: () => void; isReady: boolean;
}) {
  return (
    <div style={{
      flex: 1, position: 'relative', overflow: 'hidden',
      background: props.side === 'left'
        ? 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)'
        : 'linear-gradient(135deg, #e8d9b0 0%, #f5ecd5 100%)',
    }}>
      <BookPageContent {...props} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CONTENIDO DE PÁGINA — con botón integrado
// ═══════════════════════════════════════════════════════════════
function BookPageContent({ session, sessionIndex, side, onStartSession, isReady }: {
  session: AdaptiveSession | undefined; sessionIndex: number; side: 'left' | 'right';
  onStartSession: () => void; isReady: boolean;
}) {
  if (!session) {
    return (
      <div style={{ height: '100%', padding: '40px 50px', position: 'relative' }}>
        <div style={{
          fontSize: 10, color: 'rgba(58,46,31,0.3)', textAlign: 'center',
          marginTop: '40%', fontStyle: 'italic', fontFamily: 'Georgia, serif',
        }}>~ fin del libro ~</div>
      </div>
    )
  }

  const purposeLabel = SESSION_PURPOSE_LABELS[session.purpose] || 'Estudiar'
  const isCompleted = session.status === 'completed'
  const isAvailable = session.status === 'available'
  const isLocked = session.status === 'locked'
  // Detectar si esta sesión YA tiene progreso (aunque no esté marcada in_progress)
  const hasProgress = (session as any).status === 'in_progress' ||
                      ((session as any).domainAfter !== undefined && (session as any).domainAfter !== 0) ||
                      (Array.isArray((session as any).conceptsImproved) && (session as any).conceptsImproved.length > 0)
  const mainTitle = session.topicTitle || session.title || `Sesión ${sessionIndex + 1}`

  // Score de la sesión completada
  const sessionScore = isCompleted
    ? (session.domainAfter !== undefined && session.domainBefore !== undefined
        ? Math.min(100, Math.round(((session.domainAfter - session.domainBefore) / Math.max(1, session.expectedDomainGain)) * 100))
        : null)
    : null

  return (
    <div style={{
      height: '100%', padding: '32px 44px', position: 'relative',
      overflow: 'hidden', fontFamily: 'Georgia, serif', color: '#3a2e1f',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Textura de fondo */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(139,69,19,0.04) 0%, transparent 50%)',
        pointerEvents: 'none',
      }} />

      {/* Sello COMPLETADO */}
      {isCompleted && (
        <div className="stamp-leido" style={{
          position: 'absolute', top: 55, right: 30, width: 110, height: 110,
          borderRadius: '50%', border: '4px solid #8b1a1a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#8b1a1a', fontSize: 14, fontWeight: 900,
          fontFamily: 'Georgia, serif', letterSpacing: 2,
          transform: 'rotate(-10deg)', opacity: 0.75,
          boxShadow: 'inset 0 0 0 2px #8b1a1a',
          pointerEvents: 'none', zIndex: 30, filter: 'contrast(1.1)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 18, letterSpacing: 3 }}>LEÍDO</span>
            <div style={{ width: 50, height: 1, background: '#8b1a1a', opacity: 0.5 }} />
            <span style={{ fontSize: 8, letterSpacing: 2, opacity: 0.7 }}>COMPLETADO</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ fontSize: 8, letterSpacing: 3, color: 'rgba(58,46,31,0.45)', marginBottom: 18, fontWeight: 600 }}>
        THE STUDYAL PROCESS
      </div>

      {/* Número + título */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-start' }}>
        <div style={{
          background: isCompleted ? '#5a8a3a' : isAvailable ? '#3a2e1f' : 'rgba(58,46,31,0.3)',
          color: '#f5ecd5', padding: '6px 12px', borderRadius: 4,
          textAlign: 'center', minWidth: 54, boxShadow: '2px 2px 6px rgba(58,46,31,0.2)',
          transition: 'all 0.3s ease',
        }}>
          <div style={{ fontSize: 7, letterSpacing: 2, opacity: 0.75 }}>SESIÓN</div>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>
            {String(sessionIndex + 1).padStart(2, '0')}
          </div>
        </div>
        <div style={{ flex: 1, paddingTop: 2 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#3a2e1f', lineHeight: 1.2, marginBottom: 3 }}>
            {mainTitle}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(58,46,31,0.6)', fontStyle: 'italic' }}>
            {purposeLabel}
            {(session as any).sessionFormat && (
              <span style={{ marginLeft: 6, fontSize: 8, letterSpacing: 1, color: 'rgba(58,46,31,0.4)', fontStyle: 'normal' }}>
                · {(session as any).sessionFormat.replace('_', ' ')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Objetivo */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 8, letterSpacing: 2.5, color: 'rgba(58,46,31,0.5)', marginBottom: 6, fontWeight: 600 }}>OBJETIVO</div>
        <div style={{ fontSize: 11, color: '#3a2e1f', lineHeight: 1.5 }}>{session.objective}</div>
      </div>

      {/* ── SI COMPLETADA: mostrar resultados ── */}
      {isCompleted && (
        <div style={{
          background: 'rgba(90,138,58,0.08)', border: '1px solid rgba(90,138,58,0.25)',
          borderRadius: 6, padding: '12px 14px', marginBottom: 12,
        }}>
          <div style={{ fontSize: 8, letterSpacing: 2, color: '#5a8a3a', fontWeight: 700, marginBottom: 8 }}>
            ✓ CÓMO TE FUE
          </div>

          {/* Dominio ganado */}
          {session.domainAfter !== undefined && session.domainBefore !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: 'rgba(58,46,31,0.6)' }}>Dominio:</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#3a5a1e' }}>
                {session.domainBefore}% → {session.domainAfter}%
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700, color: '#5a8a3a',
                background: 'rgba(90,138,58,0.15)', borderRadius: 4, padding: '1px 6px',
              }}>
                +{Math.max(0, session.domainAfter - session.domainBefore)} pts
              </div>
            </div>
          )}

          {/* Conceptos dominados */}
          {session.conceptsImproved && session.conceptsImproved.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: 'rgba(58,46,31,0.5)', marginBottom: 4 }}>Dominaste:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {session.conceptsImproved.slice(0, 4).map((c, i) => (
                  <span key={i} style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 999,
                    background: 'rgba(90,138,58,0.15)', color: '#3a5a1e',
                    border: '1px solid rgba(90,138,58,0.3)', fontWeight: 600,
                  }}>✓ {c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SI DISPONIBLE: conceptos objetivo ── */}
      {isAvailable && session.targetConcepts && session.targetConcepts.length > 0 && (
        <div style={{
          background: 'rgba(245,236,213,0.7)', border: '1px dashed rgba(58,46,31,0.3)',
          borderRadius: 4, padding: '10px 12px', marginBottom: 12, fontSize: 10,
        }}>
          <div style={{ fontSize: 8, letterSpacing: 2.5, color: 'rgba(58,46,31,0.6)', marginBottom: 6, fontWeight: 600 }}>
            ENFOQUE ADAPTATIVO
          </div>
          <div style={{ color: '#3a2e1f', lineHeight: 1.5 }}>
            Priorizamos: <strong>{session.targetConcepts.slice(0, 3).join(', ')}</strong>
          </div>
        </div>
      )}

      {/* ── SI BLOQUEADA: info de actividades ── */}
      {isLocked && session.targetConcepts && session.targetConcepts.length > 0 && (
        <div style={{
          background: 'rgba(58,46,31,0.04)', border: '1px dashed rgba(58,46,31,0.2)',
          borderRadius: 4, padding: '10px 12px', marginBottom: 12, fontSize: 10,
        }}>
          <div style={{ fontSize: 8, letterSpacing: 2.5, color: 'rgba(58,46,31,0.4)', marginBottom: 6, fontWeight: 600 }}>
            CONTENIDO
          </div>
          <div style={{ color: 'rgba(58,46,31,0.6)', lineHeight: 1.5 }}>
            {session.targetConcepts.slice(0, 3).join(', ')}
          </div>
        </div>
      )}

      {/* ── BOTÓN INTEGRADO EN LA PÁGINA ── */}
      <div style={{ marginTop: 'auto', paddingTop: 8 }}>
        {isAvailable && (
          <button
            className="btn-start-session"
            onClick={onStartSession}
            disabled={!isReady}
            style={{
              width: '100%', padding: '11px 16px',
              background: isReady
                ? 'linear-gradient(135deg, #3a2e1f 0%, #5a4a2f 100%)'
                : 'rgba(58,46,31,0.3)',
              border: 'none', borderRadius: 6,
              color: isReady ? '#f5ecd5' : 'rgba(245,236,213,0.5)',
              fontFamily: 'Georgia, serif', fontSize: 12, fontWeight: 800,
              letterSpacing: 1.5, cursor: isReady ? 'pointer' : 'wait',
              transition: 'all 0.2s ease',
              boxShadow: isReady ? '0 4px 16px rgba(58,46,31,0.3)' : 'none',
              animation: isReady ? 'pulseGold 2s ease infinite' : 'none',
            }}
          >
            {isReady ? (hasProgress ? '▶ CONTINUAR ESTA SESIÓN' : '▶ EMPEZAR ESTA SESIÓN') : '⏳ PREPARANDO...'}
          </button>
        )}

        {isCompleted && (
          <button
            className="btn-repeat-session"
            onClick={onStartSession}
            style={{
              width: '100%', padding: '10px 16px',
              background: 'transparent',
              border: '1.5px solid rgba(58,46,31,0.3)',
              borderRadius: 6, color: 'rgba(58,46,31,0.6)',
              fontFamily: 'Georgia, serif', fontSize: 11, fontWeight: 700,
              letterSpacing: 1, cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            🔁 Repetir sesión
          </button>
        )}

        {isLocked && (
          <div style={{
            textAlign: 'center', padding: '10px 16px',
            background: 'rgba(58,46,31,0.04)', borderRadius: 6,
            fontSize: 10, color: 'rgba(58,46,31,0.45)', fontStyle: 'italic',
            border: '1px dashed rgba(58,46,31,0.2)',
          }}>
            🔒 Completa la sesión anterior para desbloquear
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 7, letterSpacing: 2.5, color: 'rgba(58,46,31,0.4)', marginBottom: 6, fontWeight: 600 }}>PROGRESO</div>
        <div style={{ display: 'flex', gap: 3 }}>
          {(session.steps.length > 0 ? session.steps : Array(4).fill(null)).map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: isCompleted ? '#5a8a3a' : isAvailable && i === 0 ? '#d6b26f' : 'rgba(58,46,31,0.12)',
              boxShadow: isCompleted ? '0 0 4px rgba(90,138,58,0.4)' : 'none',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>
      </div>

      {/* Número de página */}
      <div style={{
        position: 'absolute', bottom: 10,
        [side === 'left' ? 'left' : 'right']: 44,
        fontSize: 9, color: 'rgba(58,46,31,0.3)', fontStyle: 'italic',
      }}>
        {sessionIndex + 1}
      </div>
    </div>
  )
}
