'use client';
import React from 'react';
import MathText from '../MathText';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Props {
  flashcards: any[];
  currentCard: number;
  flipped: boolean;
  addCount: number;
  addingMore: boolean;
  flashcardsMessage: string;
  recommendedCount: number | null;
  recommendedReason: string;
  tema: any;
  isMobile: boolean;
  idioma: string;
  esImagen: boolean;
  analizando: boolean;
  tr: (key: string) => string;
  onFlip: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSetCard: (i: number) => void;
  onSetAddCount: (n: number) => void;
  onAddMore: () => void;
  onAnalizar: () => void;
  onEstudio: () => void;
  onQuiz: () => void;
  onEditor: () => void;
  onGuardar: () => void;
}

export default function TabFlashcards({
  flashcards, currentCard, flipped, addCount, addingMore, flashcardsMessage,
  recommendedCount, recommendedReason, tema, isMobile, idioma, esImagen, analizando, tr,
  onFlip, onPrev, onNext, onSetCard, onSetAddCount, onAddMore, onAnalizar,
  onEstudio, onQuiz, onEditor, onGuardar,
}: Props) {

  React.useEffect(() => {
    if (flashcards.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
      if (e.key === ' ') { e.preventDefault(); onFlip(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flashcards.length, onNext, onPrev, onFlip]);

  const Indicadores = () => {
    if (flashcards.length <= 15) {
      return (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 5,
          flexWrap: 'wrap', maxWidth: 400,
          margin: '0 auto 16px',
        }}>
          {flashcards.map((_: any, i: number) => (
            <div key={i} onClick={() => onSetCard(i)}
              style={{
                width: i === currentCard ? 28 : 10,
                height: 10,
                borderRadius: 5,
                background: i === currentCard ? tema.color : 'var(--border-color2)',
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
                flexShrink: 0,
                border: i === currentCard ? '1.5px solid var(--text-primary)' : 'none',
                boxShadow: i === currentCard ? `1px 2px 0 var(--text-primary)` : 'none',
              }} />
          ))}
        </div>
      );
    }
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 4,
        flexWrap: 'wrap', maxWidth: 600,
        margin: '0 auto 16px',
      }}>
        {flashcards.map((_: any, i: number) => (
          <button key={i} onClick={() => onSetCard(i)}
            style={{
              width: 34, height: 34, borderRadius: 8,
              border: i === currentCard ? '2px solid var(--text-primary)' : '1.5px dashed var(--border-color)',
              background: i === currentCard ? tema.color : 'var(--bg-secondary)',
              color: i === currentCard ? '#000' : 'var(--text-faint)',
              fontFamily: HAND,
              fontSize: 15, fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
              flexShrink: 0,
              boxShadow: i === currentCard ? '2px 2px 0 var(--text-primary)' : 'none',
              transform: i === currentCard ? `rotate(${(i % 2 === 0 ? -3 : 3)}deg)` : 'none',
            }}>
            {i + 1}
          </button>
        ))}
      </div>
    );
  };

  // ─── EMPTY ──
  if (flashcards.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '50px 20px',
        background: 'var(--bg-card)',
        border: '2.5px dashed var(--border-color)',
        borderRadius: 14,
        transform: 'rotate(-0.5deg)',
        position: 'relative', overflow: 'hidden',
      }}>
        {[35, 55, 75].map(pct => (
          <div key={pct} style={{
            position: 'absolute', left: '8%', right: '8%',
            top: `${pct}%`, height: 1,
            background: 'var(--border-color)', opacity: 0.4,
            pointerEvents: 'none',
          }}/>
        ))}
        <div style={{ fontSize: 60, marginBottom: 12, position: 'relative' }}>🎴</div>
        <h3 style={{
          fontFamily: HAND, fontSize: 26, fontWeight: 900,
          color: 'var(--text-primary)', margin: '0 0 8px',
          transform: 'rotate(-1deg)', display: 'inline-block',
          position: 'relative',
        }}>
          {tr('noHayFlashcards')}
        </h3>
        <p style={{
          fontFamily: BODY, fontSize: 17,
          color: 'var(--text-muted)', margin: '0 0 18px',
          position: 'relative',
        }}>
          ~ {esImagen
            ? (idioma === 'en' ? 'analyze the image first' : 'primero analiza la imagen')
            : (idioma === 'en' ? 'analyze the document first' : 'primero analiza el documento')} ~
        </p>
        <button onClick={onAnalizar} disabled={analizando}
          style={{
            padding: '12px 28px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--gold)', color: '#000',
            fontFamily: HAND, fontSize: 20, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-1.5deg)',
            position: 'relative',
          }}
        >
          {analizando ? '⏳ ' + tr('analizando') : esImagen ? '🖼️ ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + (idioma === 'en' ? 'Analyze & Generate' : 'Analizar y Generar')}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Banner recomendación */}
      {recommendedCount && (
        <div style={{
          background: 'color-mix(in srgb,#4ade80 14%,transparent)',
          border: '2.5px dashed #4ade80',
          borderRadius: 12,
          padding: '12px 16px',
          marginBottom: 18,
          display: 'flex', alignItems: 'center', gap: 10,
          transform: 'rotate(-0.3deg)',
        }}>
          <span style={{ fontSize: 22 }}>🤖</span>
          <div>
            <p style={{
              fontFamily: HAND, fontSize: 17, fontWeight: 800,
              color: '#16a34a', margin: 0, lineHeight: 1.2,
            }}>
              {idioma === 'en' ? `AI generated ${recommendedCount} flashcards covering 100% of content` : `La AI generó ${recommendedCount} flashcards cubriendo el 100% del contenido`}
            </p>
            {recommendedReason && (
              <p style={{
                fontFamily: BODY, fontSize: 14,
                color: 'var(--text-faint)', margin: '2px 0 0',
              }}>
                ~ {recommendedReason} ~
              </p>
            )}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 22,
        flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ToolbarBtn onClick={onEstudio} color={tema.color} primary>
            🎯 {tr('modoEstudio')}
          </ToolbarBtn>
          {!esImagen && (
            <ToolbarBtn onClick={onQuiz} color="#a78bfa">
              🤓 {tr('quiz')}
            </ToolbarBtn>
          )}
          <ToolbarBtn onClick={onEditor} color="var(--text-faint)">
            ✏️ {tr('editar')}
          </ToolbarBtn>
          <ToolbarBtn onClick={onGuardar} color="#4ade80">
            💾 {tr('guardarDeck')}
          </ToolbarBtn>
        </div>
        <span style={{
          fontFamily: BODY, fontSize: 16, fontWeight: 700,
          color: 'var(--text-faint)',
        }}>
          ~ {flashcards.length} {tr('tarjetas')} ~
        </span>
      </div>

      <Indicadores />

      {/* Contador */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <span style={{
          background: tema.color, color: '#000',
          border: '2.5px solid var(--text-primary)',
          boxShadow: '2px 3px 0 var(--text-primary)',
          padding: '4px 14px', borderRadius: 8,
          fontFamily: HAND, fontSize: 17, fontWeight: 800,
          transform: 'rotate(-1.5deg)',
          display: 'inline-block',
        }}>
          {currentCard + 1} / {flashcards.length}
        </span>
      </div>

      {/* Flashcard tipo papel rotado */}
      <div onClick={onFlip}
        className={`flip-card ${flipped ? 'flipped' : ''}`}
        style={{
          height: 320, cursor: 'pointer',
          maxWidth: 640, margin: '0 auto',
          perspective: 1500,
        }}>
        <div className="flip-card-inner" style={{
          position: 'relative', width: '100%', height: '100%',
          transformStyle: 'preserve-3d',
          transition: 'transform 0.6s cubic-bezier(.34,1.4,.64,1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}>
          {/* FRONT */}
          <div className="flip-card-front" style={{
            position: 'absolute',
            width: '100%', height: '100%',
            backfaceVisibility: 'hidden',
          }}>
            <div style={{
              background: 'var(--bg-card)',
              border: '2.5px solid var(--text-primary)',
              borderRadius: 16,
              boxShadow: '5px 6px 0 var(--gold), 0 12px 36px rgba(0,0,0,0.35)',
              padding: '40px 44px',
              height: '100%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box',
              position: 'relative', overflow: 'hidden',
              transform: 'rotate(-0.6deg)',
            }}>
              {/* Cinta scotch arriba */}
              <div style={{
                position: 'absolute',
                top: -10, left: '50%',
                transform: 'translateX(-50%) rotate(-4deg)',
                width: 80, height: 18,
                background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
                border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
                boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
                zIndex: 5,
              }}/>

              {/* Banda dorada arriba */}
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                height: 6, background: 'var(--gold)',
                borderBottom: '2px solid var(--text-primary)',
              }} />

              {/* Tag pregunta */}
              <div style={{
                position: 'absolute', top: 18, left: 18,
                background: 'var(--gold)', color: '#000',
                border: '2px solid var(--text-primary)',
                boxShadow: '2px 2px 0 var(--text-primary)',
                padding: '3px 12px', borderRadius: 6,
                fontFamily: HAND, fontSize: 15, fontWeight: 800,

                transform: 'rotate(-3deg)',
              }}>
                ✏️ {tr('pregunta')}
              </div>

              {/* margen rojo cuaderno */}
              <div style={{
                position: 'absolute', top: 30, bottom: 30,
                left: 48, width: 1.5,
                background: '#ef4444', opacity: 0.22,
                pointerEvents: 'none',
              }}/>

              <div style={{
                fontFamily: HAND,
                fontSize: 26, fontWeight: 700,
                textAlign: 'center',
                color: 'var(--text-primary)',
                lineHeight: 1.4, margin: '24px 0 0',
              }}>
                <MathText text={flashcards[currentCard]?.question || ""} />
              </div>

              <p style={{
                fontFamily: BODY, fontSize: 14,
                color: 'var(--text-faint)',
                margin: '14px 0 0', position: 'absolute', bottom: 14,
              }}>
                {isMobile ? '~ toca para ver respuesta ~' : (idioma === 'en' ? '← → keys · Space to flip' : '~ ← → flechas · espacio voltear ~')}
              </p>
            </div>
          </div>

          {/* BACK */}
          <div className="flip-card-back" style={{
            position: 'absolute',
            width: '100%', height: '100%',
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}>
            <div style={{
              background: 'var(--bg-card)',
              border: '2.5px solid var(--text-primary)',
              borderRadius: 16,
              boxShadow: '5px 6px 0 var(--red), 0 12px 36px rgba(0,0,0,0.35)',
              padding: '40px 44px',
              height: '100%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box',
              position: 'relative', overflow: 'hidden',
              transform: 'rotate(0.6deg)',
            }}>
              <div style={{
                position: 'absolute',
                top: -10, left: '50%',
                transform: 'translateX(-50%) rotate(3deg)',
                width: 80, height: 18,
                background: 'color-mix(in srgb, var(--red) 55%, transparent)',
                border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
                boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
                zIndex: 5,
              }}/>

              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                height: 6, background: 'var(--red)',
                borderBottom: '2px solid var(--text-primary)',
              }} />

              <div style={{
                position: 'absolute', top: 18, left: 18,
                background: 'var(--red)', color: '#fff',
                border: '2px solid var(--text-primary)',
                boxShadow: '2px 2px 0 var(--text-primary)',
                padding: '3px 12px', borderRadius: 6,
                fontFamily: HAND, fontSize: 15, fontWeight: 800,

                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                transform: 'rotate(-3deg)',
              }}>
                💡 {tr('respuesta')}
              </div>

              <div style={{
                position: 'absolute', top: 30, bottom: 30,
                left: 48, width: 1.5,
                background: '#ef4444', opacity: 0.22,
                pointerEvents: 'none',
              }}/>

              <div style={{
                fontFamily: HAND,
                fontSize: 23, fontWeight: 600,
                textAlign: 'center',
                color: 'var(--text-primary)',
                lineHeight: 1.45, margin: '24px 0 0',
              }}>
                <MathText text={flashcards[currentCard]?.answer || ""} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navegación */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 12,
        marginTop: 22,
      }}>
        <button onClick={onPrev}
          style={{
            padding: '10px 24px',
            borderRadius: 10,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontFamily: HAND, fontSize: 18, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '2px 3px 0 var(--text-primary)',
            transform: 'rotate(-1.5deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
          onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1.5deg)';}}
        >
          ⬅️ {tr('anterior')}
        </button>
        <button onClick={onNext}
          style={{
            padding: '10px 24px',
            borderRadius: 10,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontFamily: HAND, fontSize: 18, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '2px 3px 0 var(--text-primary)',
            transform: 'rotate(1.5deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
          onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(1.5deg)';}}
        >
          {tr('siguiente')} ➡️
        </button>
      </div>

      {!isMobile && (
        <p style={{
          textAlign: 'center',
          fontFamily: BODY, fontSize: 14,
          color: 'var(--text-faint)', margin: '10px 0 0',
        }}>
          ~ ⌨️ ← → para navegar · espacio para voltear ~
        </p>
      )}

      {/* AÑADIR MÁS */}
      <div style={{
        marginTop: 28,
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 14,
        boxShadow: '4px 5px 0 var(--blue)',
        transform: 'rotate(-0.4deg)',
        overflow: 'hidden',
        maxWidth: 640,
        marginLeft: 'auto', marginRight: 'auto',
      }}>
        <div style={{
          background: 'var(--blue)',
          padding: '6px 16px',
          borderBottom: '2px solid var(--text-primary)',
        }}>
          <span style={{
            fontFamily: HAND, fontSize: 16, fontWeight: 800,
            color: '#000',
          }}>
            ➕ {tr('anadirMas')}
          </span>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <p style={{
            fontFamily: BODY, fontSize: 15,
            color: 'var(--text-faint)', margin: '0 0 12px',
            textAlign: 'center',
          }}>
            ~ {idioma === 'en' ? 'new ones will never repeat existing questions' : 'las nuevas nunca repetirán las preguntas existentes'} ~
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
            <button onClick={onAddMore} disabled={addingMore}
              style={{
                padding: '12px 28px',
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: addingMore ? 'var(--bg-card2)' : 'var(--gold)',
                color: addingMore ? 'var(--text-faint)' : '#000',
                fontFamily: HAND, fontSize: 20, fontWeight: 800,
                cursor: addingMore ? 'not-allowed' : 'pointer',
                boxShadow: addingMore ? 'none' : '3px 4px 0 var(--text-primary)',
                transform: 'rotate(-1deg)',
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{
                if (!addingMore) {
                  e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
                  e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
                }
              }}
              onMouseLeave={(e:any)=>{
                e.currentTarget.style.transform = 'rotate(-1deg)';
                if (!addingMore) e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
              }}
            >
              {addingMore
                ? (idioma === 'en' ? '⏳ Analyzing what is missing...' : '⏳ Analizando lo que falta...')
                : (idioma === 'en' ? '✨ Generate more flashcards' : '✨ Generar más flashcards')}
            </button>
          </div>

          {flashcardsMessage && (
            <div style={{
              marginTop: 14,
              padding: '10px 14px',
              borderRadius: 10,
              background: flashcardsMessage.toLowerCase().includes('100%') || flashcardsMessage.toLowerCase().includes('analizado') || flashcardsMessage.toLowerCase().includes('repetir')
                ? 'color-mix(in srgb,var(--gold) 14%,transparent)'
                : 'color-mix(in srgb,#4ade80 14%,transparent)',
              border: flashcardsMessage.toLowerCase().includes('100%') || flashcardsMessage.toLowerCase().includes('analizado') || flashcardsMessage.toLowerCase().includes('repetir')
                ? '2.5px dashed var(--gold)'
                : '2.5px dashed #4ade80',
              textAlign: 'center',
              transform: 'rotate(0.3deg)',
            }}>
              <p style={{
                margin: 0,
                fontFamily: BODY, fontSize: 17, fontWeight: 700,
                color: 'var(--text-primary)', lineHeight: 1.4,
              }}>
                {flashcardsMessage}
              </p>
            </div>
          )}

          <p style={{
            fontFamily: BODY, fontSize: 14,
            color: 'var(--text-faint)',
            margin: '10px 0 0', textAlign: 'center',
          }}>
            ~ {tr('total')}: {flashcards.length} {tr('tarjetas')} ~
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Toolbar button helper ──
function ToolbarBtn({ children, onClick, color, primary }: {
  children: React.ReactNode;
  onClick: () => void;
  color: string;
  primary?: boolean;
}) {
  const rot = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 0.5);
  return (
    <button onClick={onClick}
      style={{
        padding: '8px 16px',
        borderRadius: 10,
        border: primary ? '2.5px solid var(--text-primary)' : `2.5px dashed ${color}`,
        background: primary ? color : 'transparent',
        color: primary ? '#000' : color,
        fontFamily: HAND, fontSize: 17, fontWeight: 800,
        cursor: 'pointer',
        boxShadow: primary ? '2px 3px 0 var(--text-primary)' : 'none',
        transform: `rotate(${rot}deg)`,
        transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
      }}
      onMouseEnter={(e:any)=>{
        e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
        if (!primary) {
          e.currentTarget.style.background = `color-mix(in srgb,${color} 14%,transparent)`;
          e.currentTarget.style.borderStyle = 'solid';
        }
      }}
      onMouseLeave={(e:any)=>{
        e.currentTarget.style.transform = `rotate(${rot}deg)`;
        if (!primary) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderStyle = 'dashed';
        }
      }}
    >
      {children}
    </button>
  );
}