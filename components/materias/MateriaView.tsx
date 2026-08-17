'use client';

import { useState } from 'react';
import { Materia, Tema } from '../../lib/storage';
import { CalificacionesMateria } from '../../lib/calificaciones';
import { useIdioma } from '../../hooks/useIdioma';
import TabCalificaciones from './TabCalificaciones';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Props {
  materia: Materia;
  onBack: () => void;
  onAbrirTema: (t: Tema) => void;
  onEliminarTema: (id: string) => void;
  onNuevoTema: () => void;
  onActualizarMateria?: (m: Materia) => void;
}

type TabActivo = 'temas' | 'calificaciones';

const CAL_DEFAULT: CalificacionesMateria = {
  notaObjetivo: 71,
  evaluaciones: [],
  escala: '1-100',
  configurado: false,
};

export default function MateriaView({
  materia, onBack, onAbrirTema, onEliminarTema, onNuevoTema, onActualizarMateria,
}: Props) {
  const { tr, idioma } = useIdioma();
  const [tabActivo, setTabActivo] = useState<TabActivo>('temas');

  const calificaciones: CalificacionesMateria = materia.calificaciones ?? CAL_DEFAULT;

  const handleCalificacionesChange = (cal: CalificacionesMateria) => {
    if (onActualizarMateria) {
      onActualizarMateria({ ...materia, calificaciones: cal });
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* BREADCRUMB */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 24,
        fontFamily: HAND, fontSize: 17,
      }}>
        <button onClick={onBack}
          style={{
            background: 'transparent',
            border: '1.5px dashed var(--gold)',
            color: 'var(--gold)',
            fontFamily: HAND, fontWeight: 800, fontSize: 17,
            cursor: 'pointer',
            padding: '4px 12px',
            borderRadius: 8,

            transition: 'all 0.2s',
          }}
          onMouseEnter={(e:any)=>{
            e.currentTarget.style.background = 'var(--gold-dim)';
            e.currentTarget.style.borderStyle = 'solid';
          }}
          onMouseLeave={(e:any)=>{
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderStyle = 'dashed';
          }}
        >
          📚 {tr('materias')}
        </button>
        <span style={{ color: 'var(--text-faint)', fontSize: 18, fontWeight: 800 }}>›</span>
        <span style={{
          color: materia.color, fontWeight: 800, fontSize: 19,
          fontFamily: HAND,
        }}>
          {materia.emoji} {materia.nombre}
        </span>
      </div>

      {/* HEADER */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 22,
        flexWrap: 'wrap', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 70, height: 70, borderRadius: 16,
            background: materia.color,
            border: '2.5px solid var(--text-primary)',
            boxShadow: '4px 4px 0 var(--text-primary)',
            display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 32,
            transform: 'rotate(-4deg)',
          }}>
            {materia.emoji}
          </div>
          <div>
            <h1 style={{
              fontFamily: HAND, fontSize: 42, fontWeight: 900,
              color: 'var(--text-primary)', margin: 0, lineHeight: 1,
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              {materia.nombre}
            </h1>
            <svg width="180" height="6" style={{ display: 'block', marginTop: 2 }}>
              <path d="M2 3 Q 90 0 178 4" stroke={materia.color} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
            </svg>
            <p style={{
              fontFamily: BODY, fontSize: 16,
              color: 'var(--text-muted)',
              margin: '4px 0 0',
            }}>
              ~ {materia.temas.length} {tr('temas')} ~
            </p>
          </div>
        </div>

        {tabActivo === 'temas' && (
          <button onClick={onNuevoTema}
            style={{
              padding: '12px 22px',
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: materia.color, color: '#000',
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
            + {idioma === 'en' ? 'New Topic' : 'Nuevo Tema'}
          </button>
        )}
      </div>

      {/* Línea rasgada */}
      <svg viewBox="0 0 1100 12" preserveAspectRatio="none" style={{
        display: 'block', width: '100%', height: 12, marginBottom: 8,
      }}>
        <path
          d="M 0 6 Q 50 2 100 5 T 200 4 T 300 7 T 400 3 T 500 6 T 600 4 T 700 7 T 800 3 T 900 6 T 1000 4 T 1100 6"
          fill="none" stroke="var(--text-primary)" strokeWidth="1.8" strokeLinecap="round" opacity="0.4"
        />
      </svg>

      {/* TABS estilo pestañas de cuaderno */}
      <div style={{
        display: 'flex', gap: 8,
        marginBottom: 24,
        flexWrap: 'wrap',
      }}>
        {([
          { id: 'temas' as TabActivo, label: idioma === 'en' ? 'Topics' : 'Temas', emoji: '📁', color: materia.color },
          { id: 'calificaciones' as TabActivo, label: idioma === 'en' ? 'Grades' : 'Calificaciones', emoji: '📊', color: 'var(--blue)' },
        ]).map((tab, i) => {
          const active = tabActivo === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setTabActivo(tab.id)}
              style={{
                padding: '10px 20px',
                background: active ? tab.color : 'var(--bg-card)',
                color: active ? '#000' : 'var(--text-muted)',
                border: `2.5px solid ${active ? tab.color : 'var(--border-color)'}`,
                borderRadius: 12,
                cursor: 'pointer',
                fontFamily: HAND,
                fontSize: 19, fontWeight: 800,
                display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: active ? '3px 4px 0 var(--text-primary)' : 'none',
                transform: active
                  ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                  : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
                transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{
                if (!active) e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
              }}
              onMouseLeave={(e:any)=>{
                e.currentTarget.style.transform = active
                  ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                  : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`;
              }}
            >
              <span style={{ fontSize: 20 }}>{tab.emoji}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB: TEMAS */}
      {tabActivo === 'temas' && (
        <>
          {materia.temas.length === 0 ? (
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
              <div style={{ fontSize: 60, marginBottom: 12, position: 'relative' }}>📁</div>
              <p style={{
                fontFamily: HAND, fontSize: 22,
                color: 'var(--text-faint)',
                margin: '0 0 20px', position: 'relative',
              }}>
                ~ {idioma === 'en' ? 'No topics yet' : 'No hay temas todavía'} ~
              </p>
              <button onClick={onNuevoTema}
                style={{
                  padding: '12px 28px',
                  borderRadius: 12,
                  border: '2.5px solid var(--text-primary)',
                  background: materia.color, color: '#000',
                  fontFamily: HAND, fontSize: 20, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '3px 4px 0 var(--text-primary)',
                  position: 'relative',
                }}
              >
                + {idioma === 'en' ? 'Create first topic' : 'Crear primer tema'}
              </button>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 18,
            }}>
              {materia.temas.map((tema, i) => {
                const rot = (i % 3 === 0 ? -1 : i % 3 === 1 ? 0.8 : -0.4);
                return (
                  <div
                    key={tema.id}
                    style={{
                      background: 'var(--bg-card)',
                      border: '2.5px solid var(--text-primary)',
                      borderRadius: 14,
                      overflow: 'hidden',
                      transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                      boxShadow: `4px 5px 0 ${tema.color}`,
                      transform: `rotate(${rot}deg)`,
                      position: 'relative',
                    }}
                    onMouseEnter={(e: any) => {
                      (e.currentTarget as HTMLDivElement).style.transform = 'rotate(0deg) translateY(-3px)';
                      (e.currentTarget as HTMLDivElement).style.boxShadow = `5px 7px 0 ${tema.color}`;
                    }}
                    onMouseLeave={(e: any) => {
                      (e.currentTarget as HTMLDivElement).style.transform = `rotate(${rot}deg)`;
                      (e.currentTarget as HTMLDivElement).style.boxShadow = `4px 5px 0 ${tema.color}`;
                    }}
                  >
                    {/* Banda color */}
                    <div style={{
                      height: 5, background: tema.color,
                      borderBottom: '2px solid var(--text-primary)',
                    }}/>

                    <div style={{ padding: 18, position: 'relative' }}>
                      {/* margen rojo cuaderno */}
                      <div style={{
                        position: 'absolute', top: 0, bottom: 0,
                        left: 28, width: 1.5,
                        background: '#ef4444', opacity: 0.18,
                        pointerEvents: 'none',
                      }}/>

                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'flex-start', marginBottom: 12,
                        position: 'relative',
                      }}>
                        <div onClick={() => onAbrirTema(tema)} style={{ cursor: 'pointer', flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                            <div style={{
                              width: 12, height: 12, borderRadius: '50%',
                              background: tema.color,
                              border: '1.5px solid var(--text-primary)',
                              boxShadow: `0 0 6px ${tema.color}88`,
                            }}/>
                            <h3 style={{
                              fontFamily: HAND, fontSize: 22, fontWeight: 900,
                              color: 'var(--text-primary)', margin: 0,
                              lineHeight: 1.05,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {tema.nombre}
                            </h3>
                          </div>
                          <div style={{ display: 'flex', gap: 14, marginLeft: 22 }}>
                            <span style={{
                              fontFamily: BODY, fontSize: 15, fontWeight: 700,
                              color: 'var(--text-muted)',
                            }}>
                              ✏️ {tema.apuntes.length} {idioma === 'en' ? 'notes' : 'apuntes'}
                            </span>
                            <span style={{
                              fontFamily: BODY, fontSize: 15, fontWeight: 700,
                              color: 'var(--text-muted)',
                            }}>
                              📄 {tema.documentos.length}
                            </span>
                          </div>
                        </div>

                        <button onClick={() => onEliminarTema(tema.id)}
                          style={{
                            background: 'transparent',
                            border: '1.5px dashed var(--text-faint)',
                            borderRadius: 6,
                            color: 'var(--text-faint)',
                            cursor: 'pointer',
                            fontSize: 14, padding: '3px 8px',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e:any)=>{
                            e.currentTarget.style.borderColor = 'var(--red)';
                            e.currentTarget.style.color = 'var(--red)';
                            e.currentTarget.style.background = 'var(--red-dim)';
                          }}
                          onMouseLeave={(e:any)=>{
                            e.currentTarget.style.borderColor = 'var(--text-faint)';
                            e.currentTarget.style.color = 'var(--text-faint)';
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          🗑️
                        </button>
                      </div>

                      <button onClick={() => onAbrirTema(tema)}
                        style={{
                          width: '100%', padding: '8px',
                          borderRadius: 10,
                          border: `2.5px dashed ${tema.color}`,
                          background: tema.color + '12',
                          color: tema.color,
                          fontFamily: HAND, fontSize: 17, fontWeight: 800,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e:any)=>{
                          e.currentTarget.style.background = tema.color + '22';
                          e.currentTarget.style.borderStyle = 'solid';
                        }}
                        onMouseLeave={(e:any)=>{
                          e.currentTarget.style.background = tema.color + '12';
                          e.currentTarget.style.borderStyle = 'dashed';
                        }}
                      >
                        {idioma === 'en' ? 'open →' : 'abrir →'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* TAB: CALIFICACIONES */}
      {tabActivo === 'calificaciones' && (
        <TabCalificaciones
          calificaciones={calificaciones}
          colorMateria={materia.color}
          onChange={handleCalificacionesChange}
        />
      )}

    </div>
  );
}