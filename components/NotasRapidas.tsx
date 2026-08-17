'use client';

import { useState, useEffect } from 'react';
import { getNotas, crearNota, eliminarNota, actualizarNota, NotaRapida } from '../lib/notas';
import { useIdioma } from '../hooks/useIdioma';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

const ROTS = [-3.5, 2.5, -1.8, 3.2, -2.6, 1.4, -3.1, 2.0, -1.2, 2.8];
function rotForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ROTS[h % ROTS.length];
}

export default function NotasRapidas() {
  const [notas, setNotas] = useState<NotaRapida[]>([]);
  const [nueva, setNueva] = useState('');
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState('');
  const [expandido, setExpandido] = useState(false);
  const [nuevaId, setNuevaId] = useState<string | null>(null);
  const { tr } = useIdioma();

  useEffect(() => {
    setNotas(getNotas());
  }, []);

  const handleCrear = () => {
    if (!nueva.trim()) return;
    const nota = crearNota(nueva.trim());
    setNotas(prev => [nota, ...prev]);
    setNueva('');
    setNuevaId(nota.id);
    // limpiar la marca después de la animación
    setTimeout(() => setNuevaId(null), 700);
  };

  const handleEliminar = (id: string) => {
    eliminarNota(id);
    setNotas(prev => prev.filter(n => n.id !== id));
  };

  const handleEditar = (nota: NotaRapida) => {
    setEditandoId(nota.id);
    setEditTexto(nota.contenido);
  };

  const handleGuardarEdicion = () => {
    if (!editandoId || !editTexto.trim()) return;
    actualizarNota(editandoId, editTexto.trim());
    setNotas(prev => prev.map(n => n.id === editandoId ? { ...n, contenido: editTexto.trim() } : n));
    setEditandoId(null);
  };

  const notasVisibles = expandido ? notas : notas.slice(0, 6);

  return (
    <div>
      <style>{`
        /* Animación de aparición — la rotación final se hace DENTRO del keyframe */
        @keyframes notaPop {
          0% {
            transform: scale(0.6) rotate(0deg) translateY(-30px);
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
          70% {
            transform: scale(1.06) rotate(var(--final-rot)) translateY(2px);
          }
          100% {
            transform: scale(1) rotate(var(--final-rot)) translateY(0);
            opacity: 1;
          }
        }

        .nb-stickynote {
          position: relative;
          padding: 28px 16px 16px;
          min-height: 130px;
          border-radius: 2px;
          box-shadow:
            3px 4px 0 rgba(0,0,0,0.18),
            0 8px 22px rgba(0,0,0,0.22);
          transition:
            transform 0.45s cubic-bezier(.25,.8,.25,1),
            box-shadow 0.4s ease;
          cursor: default;
          /* rotación base — usada también por el keyframe */
          transform: rotate(var(--final-rot));
          animation: notaPop 0.55s cubic-bezier(.34, 1.4, .64, 1) both;
          will-change: transform;
        }
        .nb-stickynote:hover {
          transform: rotate(0deg) translate(-2px, -4px) scale(1.04);
          box-shadow:
            5px 6px 0 rgba(0,0,0,0.22),
            0 14px 32px rgba(0,0,0,0.28);
          z-index: 10;
        }

        /* Animación más exagerada para nota recién creada */
        .nb-stickynote.is-new {
          animation: notaPop 0.65s cubic-bezier(.34, 1.5, .64, 1) both;
        }

        .nb-tape {
          position: absolute;
          top: -10px;
          left: 50%;
          transform: translateX(-50%) rotate(-3deg);
          width: 64px;
          height: 18px;
          background: rgba(255, 255, 255, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.4);
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
          z-index: 5;
        }
        .nb-tape::before, .nb-tape::after {
          content: '';
          position: absolute;
          top: 0; bottom: 0;
          width: 1px;
          background: rgba(0,0,0,0.08);
        }
        .nb-tape::before { left: 30%; }
        .nb-tape::after  { left: 65%; }

        .nb-nota-text {
          font-family: ${HAND};
          font-size: 17px;
          line-height: 1.3;
          color: rgba(40, 30, 20, 0.92);
          white-space: pre-wrap;
          word-break: break-word;
          margin: 0 0 8px;
          font-weight: 600;
        }
        .nb-nota-fecha {
          font-family: ${HAND};
          font-size: 12px;
          color: rgba(40, 30, 20, 0.55);
        }
        .nb-nota-btn {
          width: 26px; height: 26px;
          border-radius: 50%;
          border: 1.5px solid rgba(40, 30, 20, 0.3);
          background: rgba(255, 255, 255, 0.4);
          cursor: pointer;
          font-size: 12px;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.25s ease;
        }
        .nb-nota-btn:hover {
          background: rgba(255, 255, 255, 0.85);
          transform: scale(1.15);
        }

        /* Input suavizado */
        .nb-input-wrap {
          position: relative;
          background: var(--bg-card);
          border: 2.5px solid var(--text-primary);
          border-radius: 12px;
          padding: 6px 6px 6px 16px;
          display: flex;
          gap: 8px;
          align-items: center;
          box-shadow: 4px 4px 0 var(--text-primary);
          transform: rotate(-0.6deg);
          transition:
            transform 0.45s cubic-bezier(.25,.8,.25,1),
            box-shadow 0.45s cubic-bezier(.25,.8,.25,1),
            border-color 0.3s ease;
          will-change: transform, box-shadow;
        }
        .nb-input-wrap:hover {
          transform: rotate(-0.2deg) translate(-1px, -1px);
          box-shadow: 5px 5px 0 var(--text-primary);
        }
        .nb-input-wrap:focus-within {
          transform: rotate(0deg) translate(-2px, -2px);
          box-shadow: 6px 6px 0 var(--text-primary);
          border-color: var(--gold);
        }
        .nb-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          font-family: ${HAND};
          font-size: 19px;
          font-weight: 600;
          color: var(--text-primary);
          padding: 8px 4px;
          min-width: 0;
        }
        .nb-input::placeholder {
          color: var(--text-faint);
        }
        .nb-add-btn {
          padding: 9px 18px;
          border-radius: 8px;
          border: none;
          font-family: ${HAND};
          font-size: 18px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
          transition:
            transform 0.3s cubic-bezier(.25,.8,.25,1),
            background 0.3s ease,
            color 0.3s ease,
            box-shadow 0.3s ease;
        }
        .nb-add-btn:not(:disabled):hover {
          transform: translateY(-2px) rotate(-1deg);
        }
        .nb-add-btn:not(:disabled):active {
          transform: translateY(1px) rotate(0deg);
        }

        .nb-empty {
          text-align: center;
          padding: 40px 20px;
          background: var(--bg-card);
          border: 2px dashed var(--border-color);
          border-radius: 14px;
          transform: rotate(-0.6deg);
        }
      `}</style>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:14, gap:10, flexWrap:'wrap' }}>
        <div>
          <h2 style={{
            fontFamily: HAND,
            fontSize: 32,
            fontWeight: 900,
            color: 'var(--text-primary)',
            margin: 0,
            transform: 'rotate(-1.5deg)',
            display: 'inline-block',
            lineHeight: 1,
          }}>
            📝 {tr('notasRapidas')}
            {notas.length > 0 && (
              <span style={{
                fontSize: 16,
                color: 'var(--gold)',
                marginLeft: 8,

                fontWeight: 700,
              }}>
                ({notas.length})
              </span>
            )}
          </h2>
          <svg width="160" height="6" style={{ display:'block', marginTop:2 }}>
            <path d="M2 3 Q 80 0 158 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
          </svg>
        </div>
        {notas.length > 6 && (
          <button onClick={() => setExpandido(!expandido)}
            style={{
              fontFamily: HAND,
              fontSize: 16,
              fontWeight: 700,

              background: 'transparent',
              border: '1.5px dashed var(--text-faint)',
              borderRadius: 8,
              padding: '4px 12px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              transform: 'rotate(1deg)',
              transition: 'transform 0.3s ease',
            }}
            onMouseEnter={(e: any) => e.currentTarget.style.transform = 'rotate(0deg) scale(1.04)'}
            onMouseLeave={(e: any) => e.currentTarget.style.transform = 'rotate(1deg)'}
          >
            {expandido ? `~ ${tr('verMenos')} ~` : `~ ${tr('verTodasNotas')} (${notas.length}) ~`}
          </button>
        )}
      </div>

      {/* Input */}
      <div className="nb-input-wrap" style={{ marginBottom: 24 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>✏️</span>
        <input
          className="nb-input"
          value={nueva}
          onChange={(e: any) => setNueva(e.target.value)}
          onKeyDown={(e: any) => e.key === 'Enter' && handleCrear()}
          placeholder={tr('escribirNota')}
        />
        <button
          className="nb-add-btn"
          onClick={handleCrear}
          disabled={!nueva.trim()}
          style={{
            background: nueva.trim() ? 'var(--gold)' : 'transparent',
            color: nueva.trim() ? '#000' : 'var(--text-faint)',
            cursor: nueva.trim() ? 'pointer' : 'not-allowed',
            boxShadow: nueva.trim() ? '0 3px 0 rgba(184,134,11,.5)' : 'none',
          }}
        >
          + {tr('agregarNota')}
        </button>
      </div>

      {/* Notas */}
      {notas.length === 0 ? (
        <div className="nb-empty">
          <div style={{ fontSize: 44, marginBottom: 6 }}>📌</div>
          <p style={{
            fontFamily: HAND,
            fontSize: 18,
            color: 'var(--text-faint)',

            margin: 0,
          }}>
            ~ {tr('sinNotas')} ~
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 22,
          padding: '10px 4px',
        }}>
          {notasVisibles.map((nota) => {
            const rot = rotForId(nota.id);
            const isEditing = editandoId === nota.id;
            const isNew = nota.id === nuevaId;
            const bg = nota.color || '#fef9c3';
            const noteBg = `linear-gradient(135deg, ${bg} 0%, ${bg}dd 100%)`;

            return (
              <div
                key={nota.id}
                className={`nb-stickynote ${isNew ? 'is-new' : ''}`}
                style={{
                  background: noteBg,
                  ['--final-rot' as any]: `${rot}deg`,
                }}
              >
                <div className="nb-tape" />

                {isEditing ? (
                  <div>
                    <textarea
                      value={editTexto}
                      onChange={(e: any) => setEditTexto(e.target.value)}
                      autoFocus
                      style={{
                        width: '100%',
                        minHeight: 80,
                        padding: 8,
                        borderRadius: 6,
                        border: `2px dashed rgba(40,30,20,0.4)`,
                        background: 'rgba(255,255,255,0.5)',
                        color: 'rgba(40,30,20,0.9)',
                        fontSize: 17,
                        fontFamily: BODY,
                        fontWeight: 600,
                        resize: 'vertical',
                        outline: 'none',
                        boxSizing: 'border-box',
                        lineHeight: 1.3,
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button
                        onClick={handleGuardarEdicion}
                        style={{
                          flex: 1,
                          padding: '6px',
                          borderRadius: 6,
                          border: '1.5px solid rgba(40,30,20,0.6)',
                          background: 'rgba(40,30,20,0.85)',
                          color: '#fff',
                          fontFamily: HAND,
                          fontSize: 15,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        ✓ {tr('guardar')}
                      </button>
                      <button
                        onClick={() => setEditandoId(null)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: '1.5px dashed rgba(40,30,20,0.4)',
                          background: 'transparent',
                          color: 'rgba(40,30,20,0.7)',
                          fontFamily: HAND,
                          fontSize: 14,
                          cursor: 'pointer',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="nb-nota-text">{nota.contenido}</p>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: 'auto',
                      paddingTop: 6,
                      borderTop: '1px dashed rgba(40,30,20,0.18)',
                    }}>
                      <span className="nb-nota-fecha">{nota.fecha}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="nb-nota-btn"
                          onClick={() => handleEditar(nota)}
                          title="editar"
                        >
                          ✏️
                        </button>
                        <button
                          className="nb-nota-btn"
                          onClick={() => handleEliminar(nota.id)}
                          title="eliminar"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}