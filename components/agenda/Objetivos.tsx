'use client';

import { ObjetivoAgenda, Asignacion } from '../../lib/agenda';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import RangoDisplay from '../RangoDisplay';
import { getLevelProgress, getXpInCurrentLevel, getXpNeededForNextLevel, getRango } from '../../lib/xpSystem';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Props {
  objetivos:    ObjetivoAgenda[];
  asignaciones: Asignacion[];
  xpTotal: number;
  nivel:   number;
  xpNivel: number;
  onToggle:   (id: string) => void;
  onEliminar: (id: string) => void;
  onNuevo:    () => void;
}

export default function Objetivos({
  objetivos, asignaciones, xpTotal, nivel, xpNivel, onToggle, onEliminar, onNuevo,
}: Props) {
  const isMobile = useIsMobile();
  const { idioma } = useIdioma();
  const completados = objetivos.filter(o => o.completado).length;

  const rango = getRango(xpTotal);
  const xpParaSiguiente = getXpNeededForNextLevel(xpTotal);
  const xpEnNivel = getXpInCurrentLevel(xpTotal);
  const progreso = getLevelProgress(xpTotal);

  const CATS = [
    { id: 'asignacion', label: idioma === 'en' ? '📋 Assignments' : '📋 Asignaciones', color: 'var(--blue)', emoji:'📋' },
    { id: 'estudio',    label: idioma === 'en' ? '📚 Study'       : '📚 Estudio',       color: 'var(--blue)', emoji:'📚' },
    { id: 'personal',   label: idioma === 'en' ? '🌟 Personal'    : '🌟 Personal',      color: 'var(--gold)', emoji:'🌟' },
    { id: 'materia',    label: idioma === 'en' ? '📖 Subject'     : '📖 Materia',       color: 'var(--pink)', emoji:'📖' },
  ] as const;

  const getAsig = (asigId?: string) =>
    asigId ? asignaciones.find(a => a.id === asigId) : undefined;

  const diasRestantes = (fechaLimite?: string): number | null => {
    if (!fechaLimite) return null;
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const lim = new Date(fechaLimite + 'T00:00:00');
    return Math.ceil((lim.getTime() - hoy.getTime()) / 86400000);
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 300px',
      gap: 24, alignItems: 'flex-start',
    }}>

      <style>{`
        .nb-obj-card {
          position: relative;
          background: var(--bg-card);
          border: 2.5px solid var(--text-primary);
          border-radius: 14px;
          box-shadow: 4px 5px 0 var(--text-primary);
          overflow: hidden;
        }
        .nb-obj-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: var(--bg-card);
          border-radius: 12px;
          transition: all 0.25s cubic-bezier(.25,.8,.25,1);
        }
        .nb-obj-item:hover {
          transform: translateX(3px) rotate(0deg) !important;
          box-shadow: 3px 4px 0 var(--text-primary);
        }
        .nb-check {
          width: 28px; height: 28px;
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; font-weight: 900;
          flex-shrink: 0;
          transition: all 0.2s cubic-bezier(.25,.8,.25,1);
        }
        .nb-check:not(.disabled):hover {
          transform: scale(1.12) rotate(-5deg);
        }
      `}</style>

      {/* ── LISTA OBJETIVOS ── */}
      <div>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-end', marginBottom: 20, gap: 12,
          flexWrap: 'wrap',
        }}>
          <div>
            <h2 style={{
              fontFamily: HAND,
              fontSize: isMobile ? 30 : 36,
              fontWeight: 900,
              color: 'var(--text-primary)',
              margin: 0, lineHeight: 1,
              transform: 'rotate(-1deg)',
              display: 'inline-block',
            }}>
              🎯 {idioma === 'en' ? 'Goals' : 'Objetivos'}
              <span style={{
                fontSize: 18,
                color: 'var(--pink)',
                marginLeft: 10,

                fontWeight: 700,
              }}>
                ({completados}/{objetivos.length})
              </span>
            </h2>
            <svg width="180" height="6" style={{ display: 'block', marginTop: 2 }}>
              <path d="M2 3 Q 90 0 178 4" stroke="var(--pink)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
            </svg>
          </div>

          <button onClick={onNuevo}
            style={{
              padding: '10px 18px',
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--pink)',
              color: '#fff',
              fontFamily: HAND,
              fontSize: 18, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 4px 0 var(--text-primary)',
              transform: 'rotate(2deg)',
              textShadow: '0 1px 2px rgba(0,0,0,0.25)',
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
            + {idioma === 'en' ? 'New goal' : 'Nuevo objetivo'}
          </button>
        </div>

        {/* Vacío */}
        {objetivos.length === 0 ? (
          <div style={{
            background: 'var(--bg-card)',
            border: '2.5px dashed var(--border-color)',
            borderRadius: 14,
            padding: '48px 24px',
            textAlign: 'center',
            transform: 'rotate(-0.5deg)',
            position: 'relative',
          }}>
            {[35, 55, 75].map(pct => (
              <div key={pct} style={{
                position: 'absolute', left: '8%', right: '8%',
                top: `${pct}%`, height: 1,
                background: 'var(--border-color)', opacity: 0.5,
                pointerEvents: 'none',
              }}/>
            ))}
            <div style={{ fontSize: 56, marginBottom: 12, position: 'relative' }}>🎯</div>
            <p style={{
              fontFamily: HAND, fontSize: 20,
              color: 'var(--text-faint)',
              margin: '0 0 18px', position: 'relative',
            }}>
              ~ {idioma === 'en' ? 'No goals yet' : 'No hay objetivos todavía'} ~
            </p>
            <button onClick={onNuevo}
              style={{
                padding: '10px 24px',
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: 'var(--pink)',
                color: '#fff',
                fontFamily: HAND,
                fontSize: 18, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '3px 4px 0 var(--text-primary)',
                textShadow: '0 1px 2px rgba(0,0,0,0.25)',
                position: 'relative',
              }}
            >
              + {idioma === 'en' ? 'Create first goal' : 'Crear primer objetivo'}
            </button>
          </div>
        ) : (
          CATS.map((cat, catIdx) => {
            const objs = objetivos.filter(o => o.categoria === cat.id);
            if (objs.length === 0) return null;
            const completosCat = objs.filter(o => o.completado).length;

            return (
              <div key={cat.id} style={{ marginBottom: 26 }}>
                {/* Cabecera categoría */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  marginBottom: 12,
                  paddingBottom: 6,
                  borderBottom: `2px dashed ${cat.color}`,
                  transform: 'rotate(-0.5deg)',
                  paddingRight: 12,
                }}>
                  <h3 style={{
                    fontFamily: HAND,
                    fontSize: 24, fontWeight: 900,
                    color: cat.color, margin: 0,
                    lineHeight: 1,
                    display: 'inline',
                  }}>
                    {cat.label}
                  </h3>
                  <span style={{
                    fontFamily: BODY, fontSize: 16, fontWeight: 700,
                    color: 'var(--text-faint)',
                    marginLeft: 8,
                  }}>
                    {completosCat}/{objs.length}
                  </span>
                </div>

                {/* Items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {objs.map((obj, i) => {
                    const asig = getAsig(obj.asignacionId);
                    const bloqueado = asig?.vencida && !asig.completada;
                    const dias = diasRestantes(obj.fechaLimite);
                    const urgente = dias !== null && dias <= 2 && dias >= 0;
                    const vencida = dias !== null && dias < 0;
                    const rot = (i % 2 === 0 ? -0.3 : 0.3);

                    return (
                      <div key={obj.id}
                        className="nb-obj-item"
                        style={{
                          border: bloqueado
                            ? '2px solid var(--red)'
                            : obj.completado
                              ? '1.5px dashed var(--border-color)'
                              : `2px dashed ${cat.color}`,
                          opacity: obj.completado ? 0.6 : bloqueado ? 0.55 : 1,
                          transform: `rotate(${rot}deg)`,
                          background: bloqueado ? 'var(--bg-secondary)' : 'var(--bg-card)',
                        }}>
                        {/* Checkbox */}
                        <div
                          onClick={() => !bloqueado && onToggle(obj.id)}
                          className={`nb-check ${bloqueado ? 'disabled' : ''}`}
                          style={{
                            border: `3px solid ${bloqueado ? 'var(--red)' : obj.completado ? cat.color : 'var(--text-primary)'}`,
                            background: obj.completado
                              ? cat.color
                              : bloqueado
                                ? 'color-mix(in srgb,var(--red) 18%,transparent)'
                                : 'var(--bg-secondary)',
                            color: obj.completado ? '#000' : bloqueado ? 'var(--red)' : 'transparent',
                            cursor: bloqueado ? 'not-allowed' : 'pointer',
                            boxShadow: obj.completado ? '1px 2px 0 var(--text-primary)' : 'none',
                          }}>
                          {obj.completado ? '✓' : bloqueado ? '⛔' : ''}
                        </div>

                        {/* Texto */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            fontFamily: BODY, fontSize: isMobile ? 18 : 20,
                            fontWeight: 700, margin: 0,
                            color: bloqueado ? 'var(--text-faint)' : obj.completado ? 'var(--text-faint)' : 'var(--text-primary)',
                            textDecoration: obj.completado ? 'line-through' : 'none',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: isMobile ? 'nowrap' : 'normal',
                            lineHeight: 1.15,
                          }}>
                            {obj.titulo}
                          </p>
                          <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                            {obj.fechaLimite && (
                              <span style={{
                                fontFamily: HAND, fontSize: 13, fontWeight: 800,
                                padding: '1px 8px',
                                borderRadius: 5,
                                background: bloqueado || vencida
                                  ? 'color-mix(in srgb,var(--red) 18%,transparent)'
                                  : urgente
                                    ? 'color-mix(in srgb,var(--gold) 18%,transparent)'
                                    : 'var(--bg-secondary)',
                                color: bloqueado || vencida ? 'var(--red)' : urgente ? 'var(--gold)' : 'var(--text-faint)',
                                border: `1.5px ${bloqueado || vencida || urgente ? 'solid' : 'dashed'} ${bloqueado || vencida ? 'var(--red)' : urgente ? 'var(--gold)' : 'var(--border-color)'}`,
                              }}>
                                {bloqueado ? '⛔ vencida' :
                                 vencida   ? '⛔ vencida' :
                                 dias === 0 ? '🔥 hoy'    :
                                 dias === 1 ? '⚡ mañana'  :
                                              `📅 ${dias}d`}
                              </span>
                            )}
                            {obj.tamaño && (
                              <span style={{
                                fontFamily: BODY, fontSize: 13, fontWeight: 700,
                                color: 'var(--text-faint)',
                                padding: '1px 8px',
                                background: 'var(--bg-secondary)',
                                borderRadius: 5,
                                border: '1.5px dashed var(--border-color)',

                              }}>
                                {obj.tamaño}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* XP postit */}
                        <div style={{
                          background: bloqueado
                            ? 'color-mix(in srgb,var(--red) 16%,transparent)'
                            : obj.completado
                              ? 'var(--gold)'
                              : 'color-mix(in srgb,var(--gold) 16%,transparent)',
                          border: `2px solid ${bloqueado ? 'var(--red)' : 'var(--gold)'}`,
                          color: bloqueado ? 'var(--red)' : obj.completado ? '#000' : 'var(--gold)',
                          padding: '4px 10px',
                          borderRadius: 8,
                          fontFamily: HAND,
                          fontSize: 16, fontWeight: 800,
                          flexShrink: 0,
                          whiteSpace: 'nowrap',
                          transform: 'rotate(2deg)',
                          boxShadow: obj.completado ? '2px 2px 0 var(--text-primary)' : 'none',
                        }}>
                          {bloqueado ? '⛔ 0' : `⭐ ${obj.xp}`}
                        </div>

                        {/* Eliminar */}
                        <button onClick={() => onEliminar(obj.id)}
                          style={{
                            background: 'transparent',
                            border: '1.5px dashed var(--text-faint)',
                            borderRadius: 6,
                            color: 'var(--text-faint)',
                            cursor: 'pointer',
                            fontSize: 14,
                            flexShrink: 0,
                            padding: '4px 6px',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e:any)=>{
                            e.currentTarget.style.borderColor = 'var(--red)';
                            e.currentTarget.style.color = 'var(--red)';
                          }}
                          onMouseLeave={(e:any)=>{
                            e.currentTarget.style.borderColor = 'var(--text-faint)';
                            e.currentTarget.style.color = 'var(--text-faint)';
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── PANEL STATS ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Card progreso (solo desktop) */}
        {!isMobile && (
          <div className="nb-obj-card" style={{ transform: 'rotate(0.5deg)' }}>
            {/* Banda con gradient del rango */}
            <div style={{
              background: rango.marcoGradient,
              padding: '8px 16px',
              borderBottom: '2px solid var(--text-primary)',
            }}>
              <span style={{
                fontFamily: HAND, fontSize: 16, fontWeight: 900,
                color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.4)',

              }}>
                {rango.emoji} {idioma === 'en' ? 'Your Progress' : 'Tu Progreso'}
              </span>
            </div>

            <div style={{ padding: '16px 18px' }}>
              {/* Rango display */}
              <div style={{ marginBottom: 14 }}>
                <RangoDisplay xpTotal={xpTotal} size="sm" mostrarProgreso />
              </div>

              {/* Nivel grande */}
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <div style={{
                  fontFamily: HAND, fontSize: 56, fontWeight: 900,
                  color: rango.color, lineHeight: 0.95,
                  textShadow: `0 0 12px ${rango.color}55`,
                }}>
                  {nivel}
                </div>
                <div style={{
                  fontFamily: BODY, fontSize: 15,
                  color: 'var(--text-muted)',
                  marginTop: 2,
                }}>
                  {idioma === 'en' ? 'Level' : 'Nivel'}
                </div>
              </div>

              {/* Barra de nivel */}
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                height: 12,
                overflow: 'hidden',
                marginBottom: 6,
                border: '1.5px solid var(--text-primary)',
              }}>
                <div style={{
                  width: `${progreso}%`, height: '100%',
                  background: rango.marcoGradient,
                  borderRadius: 6, transition: 'width 0.5s',
                  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3)`,
                }} />
              </div>
              <p style={{
                fontFamily: BODY, fontSize: 13,
                color: 'var(--text-faint)',
                margin: '0 0 14px', textAlign: 'center',
              }}>
                {xpEnNivel}/{xpParaSiguiente} XP → {idioma === 'en' ? 'Lvl' : 'Nivel'} {nivel + 1}
              </p>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { label: idioma === 'en' ? 'Done' : 'Hechos',  val: completados,                     color: 'var(--pink)', rot: -1.5 },
                  { label: idioma === 'en' ? 'Pend' : 'Pend',    val: objetivos.length - completados,  color: 'var(--blue)', rot: 1.5 },
                  { label: 'XP Total',                            val: xpTotal,                         color: rango.color,    rot: -1 },
                  { label: 'Total',                               val: objetivos.length,                color: 'var(--text-muted)', rot: 1 },
                ].map((s, i) => (
                  <div key={i} style={{
                    background: 'var(--bg-secondary)',
                    border: `2px dashed ${s.color}`,
                    borderRadius: 10,
                    padding: '8px 6px',
                    textAlign: 'center',
                    transform: `rotate(${s.rot}deg)`,
                    transition: 'transform 0.25s',
                  }}
                    onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.04)'}
                    onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${s.rot}deg)`}
                  >
                    <div style={{
                      fontFamily: HAND, fontSize: 22, fontWeight: 900,
                      color: s.color, lineHeight: 1,
                    }}>
                      {s.val}
                    </div>
                    <div style={{
                      fontFamily: BODY, fontSize: 12, fontWeight: 700,
                      color: 'var(--text-faint)',
                      marginTop: 2,
                    }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Stats mobile */}
        {isMobile && objetivos.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8, marginTop: 8,
          }}>
            {[
              { label: idioma === 'en' ? 'Done' : 'Hechos', val: completados,                     color: 'var(--pink)', rot: -1 },
              { label: 'Pend',                              val: objetivos.length - completados,  color: 'var(--blue)', rot: 1 },
              { label: 'XP',                                val: xpTotal,                         color: rango.color,   rot: -1 },
              { label: 'Total',                             val: objetivos.length,                color: 'var(--text-muted)', rot: 1 },
            ].map((s, i) => (
              <div key={i} style={{
                background: 'var(--bg-card)',
                border: `2px dashed ${s.color}`,
                borderRadius: 10,
                padding: '10px 6px',
                textAlign: 'center',
                transform: `rotate(${s.rot}deg)`,
              }}>
                <div style={{
                  fontFamily: HAND, fontSize: 22, fontWeight: 900,
                  color: s.color, lineHeight: 1,
                }}>{s.val}</div>
                <div style={{
                  fontFamily: BODY, fontSize: 11, fontWeight: 700,
                  color: 'var(--text-faint)',
                }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Guia XP estilo postit */}
        <div className="nb-obj-card" style={{ transform: 'rotate(-0.5deg)' }}>
          <div style={{
            background: '#a78bfa',
            padding: '6px 16px',
            borderBottom: '2px solid var(--text-primary)',
          }}>
            <span style={{
              fontFamily: HAND, fontSize: 16, fontWeight: 900,
              color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)',

            }}>
              💡 {idioma === 'en' ? 'XP Guide' : 'Guía de XP'}
            </span>
          </div>

          <div style={{ padding: '14px 16px' }}>
            {[
              { label: idioma === 'en' ? '🟢 Small goal'  : '🟢 Objetivo pequeño', xp: 50,  color: '#22c55e' },
              { label: idioma === 'en' ? '🟡 Medium goal' : '🟡 Objetivo mediano', xp: 120, color: 'var(--gold)' },
              { label: idioma === 'en' ? '🔴 Large goal'  : '🔴 Objetivo grande',  xp: 250, color: 'var(--red)' },
            ].map((g, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 0',
                borderBottom: i < 2 ? '1px dashed var(--border-color)' : 'none',
                transform: `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
              }}>
                <span style={{
                  fontFamily: HAND, fontSize: 16, fontWeight: 700,
                  color: 'var(--text-primary)',
                }}>
                  {g.label}
                </span>
                <span style={{
                  fontFamily: HAND, fontSize: 16, fontWeight: 800,
                  color: 'var(--gold)',
                  background: 'color-mix(in srgb,var(--gold) 14%,transparent)',
                  border: '1.5px solid var(--gold)',
                  borderRadius: 6,
                  padding: '1px 8px',
                }}>
                  ⭐ {g.xp}
                </span>
              </div>
            ))}
            <div style={{
              marginTop: 12,
              padding: '8px 10px',
              background: 'color-mix(in srgb,var(--red) 14%,transparent)',
              border: '1.5px dashed var(--red)',
              borderRadius: 8,
              transform: 'rotate(0.5deg)',
            }}>
              <p style={{
                fontFamily: HAND, fontSize: 14, fontWeight: 700,
                color: 'var(--red)', margin: 0,
              }}>
                ⛔ {idioma === 'en' ? 'Miss deadline = 0 XP' : 'Vence sin completar = 0 XP'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}