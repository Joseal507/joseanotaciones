'use client';

import { useState, useRef } from 'react';
import { Materia } from '../../lib/storage';
import { useIdioma } from '../../hooks/useIdioma';

const HAND = "'Caveat',cursive";

interface Props {
  materias: Materia[];
  onAbrir: (m: Materia) => void;
  onEliminar: (id: string) => void;
  onNueva: () => void;
  onReordenar: (materias: Materia[]) => void;
  onEditar: (materia: Materia) => void;
}

const COLORES = [
  'var(--gold)','var(--red)','#38bdf8','#f472b6','#4ade80','#fb923c',
  '#a78bfa','#34d399','#f87171','#60a5fa','#fbbf24','#e879f9',
];

const EMOJIS = [
  '📚','📖','✏️','🔬','🧪','🧬','💻','🖥️','📐','📏','🔭',
  '🎨','🎭','🎵','🏛️','⚽','🧮','📊','📈','🌍','🧠','💡',
  '🔥','⚡','🚀','🎯','💎','🏆','🌟','❤️','🦁','🐯','🦊',
];

export default function MateriasList({ materias, onAbrir, onEliminar, onNueva, onReordenar, onEditar }: Props) {
  const { tr, idioma } = useIdioma();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [editando, setEditando] = useState<Materia | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const dragItem = useRef<number | null>(null);

  const handleDragStart = (i: number) => { dragItem.current = i; setDragIndex(i); };
  const handleDragEnter = (i: number) => setDragOver(i);
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOver === null || dragItem.current === dragOver) {
      setDragIndex(null); setDragOver(null); dragItem.current = null; return;
    }
    const newMaterias = [...materias];
    const [removed] = newMaterias.splice(dragItem.current, 1);
    newMaterias.splice(dragOver, 0, removed);
    onReordenar(newMaterias);
    setDragIndex(null); setDragOver(null); dragItem.current = null;
  };

  const abrirEditar = (e: React.MouseEvent, m: Materia) => {
    e.stopPropagation();
    setEditando(m); setEditNombre(m.nombre); setEditColor(m.color); setEditEmoji(m.emoji);
  };

  const guardarEditar = () => {
    if (!editando || !editNombre.trim()) return;
    onEditar({ ...editando, nombre: editNombre.trim(), color: editColor, emoji: editEmoji });
    setEditando(null);
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* MODAL EDITAR */}
      {editando && (
        <div onClick={() => setEditando(null)} style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.78)',
          backdropFilter: 'blur(6px)',
          zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
          animation: 'modalFadeML 0.25s ease',
        }}>
          <div onClick={(e: any) => e.stopPropagation()} style={{
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 16,
            width: '100%', maxWidth: 480,
            boxShadow: '6px 7px 0 var(--text-primary), 0 16px 50px rgba(0,0,0,0.45)',
            transform: 'rotate(-0.5deg)',
            position: 'relative',
            overflow: 'hidden',
            animation: 'modalPopML 0.4s cubic-bezier(.34,1.4,.64,1)',
          }}>
            {/* Cinta scotch */}
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(-4deg)',
              width: 80, height: 18,
              background: `color-mix(in srgb,${editColor} 55%,transparent)`,
              border: `1px solid color-mix(in srgb,${editColor} 30%,transparent)`,
              boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
              zIndex: 5,
            }}/>

            {/* Banda título */}
            <div style={{
              background: editColor,
              padding: '12px 28px',
              borderBottom: '2px solid var(--text-primary)',
            }}>
              <h2 style={{
                fontFamily: HAND, fontSize: 26, fontWeight: 900,
                color: '#000', margin: 0, lineHeight: 1.1,
                transform: 'rotate(-0.8deg)', display: 'inline-block',
                fontStyle: 'italic',
              }}>
                ✏️ {idioma === 'en' ? 'Edit Subject' : 'Editar Materia'}
              </h2>
            </div>

            <div style={{ padding: 24 }}>
              {/* Preview */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--bg-secondary)',
                border: `2.5px dashed ${editColor}`,
                marginBottom: 20,
                transform: 'rotate(-0.5deg)',
              }}>
                <div style={{
                  width: 50, height: 50, borderRadius: 12,
                  background: editColor,
                  border: '2px solid var(--text-primary)',
                  boxShadow: `2px 2px 0 var(--text-primary)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 24, transform: 'rotate(-3deg)',
                }}>
                  {editEmoji}
                </div>
                <div>
                  <p style={{
                    fontFamily: HAND, fontSize: 22, fontWeight: 900,
                    color: 'var(--text-primary)', margin: 0, lineHeight: 1.05,
                  }}>{editNombre || '...'}</p>
                  <p style={{
                    fontFamily: HAND, fontSize: 13,
                    color: 'var(--text-muted)', fontStyle: 'italic',
                    margin: '2px 0 0',
                  }}>~ preview ~</p>
                </div>
              </div>

              {/* Nombre */}
              <Field label={idioma === 'en' ? 'Name' : 'Nombre'}>
                <input
                  value={editNombre}
                  onChange={(e: any) => setEditNombre(e.target.value)}
                  onKeyDown={(e: any) => e.key === 'Enter' && guardarEditar()}
                  style={inputStyle}
                />
              </Field>

              {/* Emoji */}
              <Field label="Emoji">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {EMOJIS.map(em => (
                    <button key={em} onClick={() => setEditEmoji(em)}
                      style={{
                        width: 38, height: 38, borderRadius: 8,
                        border: `2px ${em === editEmoji ? 'solid' : 'dashed'} ${em === editEmoji ? editColor : 'var(--border-color)'}`,
                        background: em === editEmoji ? editColor + '22' : 'transparent',
                        fontSize: 19, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: em === editEmoji ? `2px 2px 0 ${editColor}` : 'none',
                        transform: em === editEmoji ? 'rotate(-5deg) scale(1.08)' : 'rotate(0deg)',
                        transition: 'all 0.2s',
                      }}>
                      {em}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Color */}
              <Field label="Color">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {COLORES.map(c => (
                    <button key={c} onClick={() => setEditColor(c)}
                      style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: c,
                        border: c === editColor ? '3px solid var(--text-primary)' : '2px dashed var(--border-color)',
                        cursor: 'pointer',
                        boxShadow: c === editColor ? `2px 2px 0 ${c}` : 'none',
                        transform: c === editColor ? 'rotate(-8deg) scale(1.15)' : 'rotate(0deg)',
                        transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
                      }} />
                  ))}
                </div>
              </Field>

              <div style={{
                display: 'flex', gap: 10, marginTop: 20,
                paddingTop: 14, borderTop: '1.5px dashed var(--border-color)',
              }}>
                <button onClick={() => setEditando(null)}
                  style={{
                    flex: 1, padding: 12,
                    borderRadius: 12,
                    border: '2.5px dashed var(--text-faint)',
                    background: 'transparent', color: 'var(--text-muted)',
                    fontFamily: HAND, fontSize: 19, fontWeight: 800,
                    cursor: 'pointer',
                    transform: 'rotate(1deg)',
                  }}>
                  ✕ {idioma === 'en' ? 'Cancel' : 'Cancelar'}
                </button>
                <button onClick={guardarEditar}
                  style={{
                    flex: 2, padding: 12,
                    borderRadius: 12,
                    border: '2.5px solid var(--text-primary)',
                    background: editColor, color: '#000',
                    fontFamily: HAND, fontSize: 20, fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '3px 4px 0 var(--text-primary)',
                    transform: 'rotate(-1deg)',
                    transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                  }}
                  onMouseEnter={(e:any)=>{
                    e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
                    e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
                  }}
                  onMouseLeave={(e:any)=>{
                    e.currentTarget.style.transform = 'rotate(-1deg)';
                    e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
                  }}
                >
                  💾 {idioma === 'en' ? 'Save' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
          <style>{`
            @keyframes modalFadeML { from{opacity:0} to{opacity:1} }
            @keyframes modalPopML {
              0% { transform: rotate(0deg) scale(0.85); opacity: 0; }
              60% { transform: rotate(-0.5deg) scale(1.02); opacity: 1; }
              100% { transform: rotate(-0.5deg) scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {/* HEADER */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-end', marginBottom: 28, gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{
            fontFamily: HAND, fontSize: 42, fontWeight: 900,
            color: 'var(--text-primary)', margin: 0, lineHeight: 1,
            transform: 'rotate(-1.5deg)', display: 'inline-block',
          }}>
            📚 {tr('misMaterias')}
            <span style={{
              fontSize: 22, color: 'var(--gold)',
              marginLeft: 12, fontStyle: 'italic', fontWeight: 700,
            }}>
              ({materias.length})
            </span>
          </h1>
          <svg width="220" height="6" style={{ display: 'block', marginTop: 2 }}>
            <path d="M2 3 Q 110 0 218 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
          </svg>
          {materias.length > 1 && (
            <p style={{
              fontFamily: HAND, fontSize: 16,
              color: 'var(--text-faint)', fontStyle: 'italic',
              margin: '6px 0 0',
            }}>
              ~ arrastra para reordenar ↕ ~
            </p>
          )}
        </div>

        <button onClick={onNueva}
          style={{
            padding: '12px 22px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--gold)', color: '#000',
            fontFamily: HAND, fontSize: 20, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(2deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseEnter={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
            e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
          }}
          onMouseLeave={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(2deg)';
            e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
          }}
        >
          + {idioma === 'en' ? 'New Subject' : 'Nueva Materia'}
        </button>
      </div>

      {/* EMPTY */}
      {materias.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 24px',
          background: 'var(--bg-card)',
          border: '2.5px dashed var(--border-color)',
          borderRadius: 16,
          transform: 'rotate(-0.5deg)',
          position: 'relative', overflow: 'hidden',
        }}>
          {[35, 55, 75].map(pct => (
            <div key={pct} style={{
              position: 'absolute', left: '8%', right: '8%',
              top: `${pct}%`, height: 1,
              background: 'var(--border-color)', opacity: 0.5,
              pointerEvents: 'none',
            }}/>
          ))}
          <div style={{ fontSize: 64, marginBottom: 12, position: 'relative' }}>📚</div>
          <p style={{
            fontFamily: HAND, fontSize: 22,
            color: 'var(--text-faint)', fontStyle: 'italic',
            margin: '0 0 20px', position: 'relative',
          }}>
            ~ {tr('sinMaterias')} ~
          </p>
          <button onClick={onNueva}
            style={{
              padding: '12px 28px',
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--gold)', color: '#000',
              fontFamily: HAND, fontSize: 20, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 4px 0 var(--text-primary)',
              position: 'relative',
            }}
          >
            + {idioma === 'en' ? 'Create first subject' : 'Crear primera materia'}
          </button>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
          gap: 22,
        }}>
          {materias.map((materia, i) => {
            const rot = (i % 3 === 0 ? -1.2 : i % 3 === 1 ? 0.8 : -0.4);
            return (
              <div
                key={materia.id}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragEnter={() => handleDragEnter(i)}
                onDragEnd={handleDragEnd}
                onDragOver={(e: any) => e.preventDefault()}
                style={{
                  background: 'var(--bg-card)',
                  border: dragOver === i && dragIndex !== i
                    ? `2.5px dashed ${materia.color}`
                    : '2.5px solid var(--text-primary)',
                  borderRadius: 14,
                  overflow: 'hidden',
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                  opacity: dragIndex === i ? 0.5 : 1,
                  cursor: 'grab',
                  boxShadow: `4px 5px 0 ${materia.color}`,
                  transform: dragOver === i && dragIndex !== i ? 'scale(1.04)' : `rotate(${rot}deg)`,
                  position: 'relative',
                }}
                onMouseEnter={(e: any) => {
                  if (dragIndex !== null) return;
                  (e.currentTarget as HTMLDivElement).style.transform = 'rotate(0deg) translateY(-4px)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow = `5px 7px 0 ${materia.color}`;
                }}
                onMouseLeave={(e: any) => {
                  if (dragIndex !== null) return;
                  (e.currentTarget as HTMLDivElement).style.transform = `rotate(${rot}deg)`;
                  (e.currentTarget as HTMLDivElement).style.boxShadow = `4px 5px 0 ${materia.color}`;
                }}
              >
                {/* Banda color */}
                <div style={{
                  height: 6, background: materia.color,
                  borderBottom: '2px solid var(--text-primary)',
                }} />

                <div style={{ padding: 18, position: 'relative' }}>
                  {/* margen rojo cuaderno */}
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: 28, width: 1.5,
                    background: '#ef4444', opacity: 0.18,
                    pointerEvents: 'none',
                  }}/>

                  {/* Drag handle + actions */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 12,
                    position: 'relative',
                  }}>
                    <span style={{
                      color: 'var(--text-faint)',
                      fontSize: 16, cursor: 'grab',
                      userSelect: 'none',
                      fontFamily: HAND, fontWeight: 700,
                    }}>⠿ drag</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={(e: any) => abrirEditar(e, materia)}
                        title={idioma === 'en' ? 'Edit' : 'Editar'}
                        style={{
                          background: 'transparent',
                          border: '1.5px dashed var(--text-faint)',
                          borderRadius: 6,
                          color: 'var(--text-faint)',
                          cursor: 'pointer',
                          fontSize: 14, padding: '3px 8px',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e: any) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = materia.color;
                          (e.currentTarget as HTMLButtonElement).style.color = materia.color;
                          (e.currentTarget as HTMLButtonElement).style.background = materia.color + '14';
                        }}
                        onMouseLeave={(e: any) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-faint)';
                          (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)';
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={(e: any) => { e.stopPropagation(); onEliminar(materia.id); }}
                        title={idioma === 'en' ? 'Delete' : 'Eliminar'}
                        style={{
                          background: 'transparent',
                          border: '1.5px dashed var(--text-faint)',
                          borderRadius: 6,
                          color: 'var(--text-faint)',
                          cursor: 'pointer',
                          fontSize: 14, padding: '3px 8px',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e: any) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--red)';
                          (e.currentTarget as HTMLButtonElement).style.color = 'var(--red)';
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--red-dim)';
                        }}
                        onMouseLeave={(e: any) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-faint)';
                          (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)';
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* Info materia */}
                  <div onClick={() => onAbrir(materia)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                      <div style={{
                        width: 56, height: 56, borderRadius: 14,
                        background: materia.color,
                        border: '2.5px solid var(--text-primary)',
                        boxShadow: '2px 3px 0 var(--text-primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 26, flexShrink: 0,
                        transform: 'rotate(-4deg)',
                      }}>
                        {materia.emoji}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{
                          fontFamily: HAND, fontSize: 24, fontWeight: 900,
                          color: 'var(--text-primary)', margin: '0 0 2px',
                          lineHeight: 1.05,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {materia.nombre}
                        </h3>
                        <p style={{
                          fontFamily: HAND, fontSize: 14,
                          color: 'var(--text-muted)', fontStyle: 'italic',
                          margin: 0,
                        }}>
                          {materia.temas.length} {tr('temas')}
                        </p>
                      </div>
                    </div>

                    {/* Stats */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[
                        { label: idioma === 'en' ? 'Topics' : 'Temas', val: materia.temas.length, rot: -1.5 },
                        { label: idioma === 'en' ? 'Notes' : 'Apuntes', val: materia.temas.reduce((a, t) => a + t.apuntes.length, 0), rot: 1 },
                        { label: 'Docs', val: materia.temas.reduce((a, t) => a + t.documentos.length, 0), rot: -1 },
                      ].map((s, j) => (
                        <div key={j} style={{
                          flex: 1,
                          background: 'var(--bg-secondary)',
                          border: `2px dashed ${materia.color}55`,
                          borderRadius: 8,
                          padding: '6px 4px',
                          textAlign: 'center',
                          transform: `rotate(${s.rot}deg)`,
                          transition: 'transform 0.25s',
                        }}>
                          <div style={{
                            fontFamily: HAND, fontSize: 22, fontWeight: 900,
                            color: materia.color, lineHeight: 1,
                          }}>{s.val}</div>
                          <div style={{
                            fontFamily: HAND, fontSize: 12, fontWeight: 700,
                            color: 'var(--text-faint)', fontStyle: 'italic',
                          }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button onClick={() => onAbrir(materia)}
                    style={{
                      width: '100%', marginTop: 14,
                      padding: '8px',
                      borderRadius: 10,
                      border: `2.5px dashed ${materia.color}`,
                      background: materia.color + '12',
                      color: materia.color,
                      fontFamily: HAND, fontSize: 17, fontWeight: 800,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e:any)=>{
                      e.currentTarget.style.background = materia.color + '22';
                      e.currentTarget.style.borderStyle = 'solid';
                    }}
                    onMouseLeave={(e:any)=>{
                      e.currentTarget.style.background = materia.color + '12';
                      e.currentTarget.style.borderStyle = 'dashed';
                    }}
                  >
                    {idioma === 'en' ? 'open subject →' : 'abrir materia →'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        fontFamily: HAND, fontSize: 16, fontWeight: 800,
        color: 'var(--text-muted)',
        display: 'block', marginBottom: 6,
        fontStyle: 'italic',
        transform: 'rotate(-0.5deg)', transformOrigin: 'left',
      }}>
        ✏️ {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '2.5px solid var(--text-primary)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontFamily: HAND,
  fontSize: 19, fontWeight: 600,
  outline: 'none',
  boxSizing: 'border-box',
  boxShadow: '3px 3px 0 var(--text-primary)',
  transform: 'rotate(-0.3deg)',
  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
};