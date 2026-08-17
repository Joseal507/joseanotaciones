'use client';

import { Asignacion, ObjetivoAgenda } from '../../lib/agenda';
import { useIdioma } from '../../hooks/useIdioma';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Props {
  asignaciones: Asignacion[];
  objetivos: ObjetivoAgenda[];
  hoyStr: string;
  diaSeleccionado: string | null;
  onToggleAsig: (id: string) => void;
  onEliminarAsig: (id: string) => void;
  onNuevaAsig: () => void;
  onSelectDia: (fecha: string) => void;
}

export default function PendientesSidebar({
  asignaciones, objetivos, hoyStr,
  diaSeleccionado, onToggleAsig, onEliminarAsig,
  onNuevaAsig, onSelectDia,
}: Props) {
  const { tr, idioma } = useIdioma();

  const TIPOS_ES = [
    { id: 'tarea',    label: '📝 Tarea',    color: '#38bdf8' },
    { id: 'examen',   label: '📋 Examen',   color: 'var(--red)' },
    { id: 'proyecto', label: '🛠️ Proyecto', color: 'var(--gold)' },
    { id: 'otro',     label: '📌 Otro',     color: '#a78bfa' },
  ];

  const TIPOS_EN = [
    { id: 'tarea',    label: '📝 Homework', color: '#38bdf8' },
    { id: 'examen',   label: '📋 Exam',     color: 'var(--red)' },
    { id: 'proyecto', label: '🛠️ Project',  color: 'var(--gold)' },
    { id: 'otro',     label: '📌 Other',    color: '#a78bfa' },
  ];

  const TIPOS = idioma === 'en' ? TIPOS_EN : TIPOS_ES;
  const tipoInfo = (tipo: string) => TIPOS.find(t => t.id === tipo) || TIPOS[3];

  const proximas = asignaciones
    .filter(a => !a.completada && a.fecha >= hoyStr)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .slice(0, 8);

  const objPendientes = objetivos.filter(o => !o.completado).slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      <style>{`
        .nb-sidebar-card {
          position: relative;
          background: var(--bg-card);
          border: 2.5px solid var(--text-primary);
          border-radius: 14px;
          box-shadow: 4px 5px 0 var(--text-primary);
          overflow: hidden;
          transition: transform 0.25s cubic-bezier(.25,.8,.25,1), box-shadow 0.25s;
        }
        .nb-sidebar-card:hover {
          transform: rotate(0deg) translateY(-2px);
          box-shadow: 5px 6px 0 var(--text-primary);
        }
        .nb-pendiente-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: var(--bg-secondary);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(.25,.8,.25,1);
        }
        .nb-pendiente-item:hover {
          transform: translateX(3px);
          background: var(--bg-card);
        }
        .nb-tape-deco {
          position: absolute;
          top: -8px;
          right: 18px;
          width: 50px;
          height: 14px;
          background: color-mix(in srgb, var(--gold) 55%, transparent);
          border: 1px solid color-mix(in srgb, var(--gold) 30%, transparent);
          box-shadow: 0 1px 2px rgba(0,0,0,0.15);
          transform: rotate(8deg);
          z-index: 5;
        }
      `}</style>

      {/* Botón + Nueva Asignación */}
      <button onClick={onNuevaAsig}
        style={{
          padding: '14px 18px',
          borderRadius: 14,
          border: '2.5px solid var(--text-primary)',
          background: 'var(--blue)',
          color: '#000',
          fontFamily: HAND,
          fontSize: 22, fontWeight: 800,
          cursor: 'pointer',
          width: '100%',
          boxShadow: '4px 5px 0 var(--text-primary)',
          transform: 'rotate(-1deg)',
          transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
        }}
        onMouseEnter={(e:any)=>{
          e.currentTarget.style.transform = 'rotate(0deg) translate(-1px, -2px)';
          e.currentTarget.style.boxShadow = '5px 7px 0 var(--text-primary)';
        }}
        onMouseLeave={(e:any)=>{
          e.currentTarget.style.transform = 'rotate(-1deg)';
          e.currentTarget.style.boxShadow = '4px 5px 0 var(--text-primary)';
        }}
        onMouseDown={(e:any)=>{
          e.currentTarget.style.transform = 'rotate(0deg) translate(2px, 2px)';
          e.currentTarget.style.boxShadow = '2px 3px 0 var(--text-primary)';
        }}
        onMouseUp={(e:any)=>{
          e.currentTarget.style.transform = 'rotate(0deg) translate(-1px, -2px)';
          e.currentTarget.style.boxShadow = '5px 7px 0 var(--text-primary)';
        }}
      >
        ✏️ + {tr('nuevaAsignacion')}
      </button>

      {/* DÍA SELECCIONADO */}
      {diaSeleccionado && (
        <div className="nb-sidebar-card" style={{ transform: 'rotate(-0.6deg)' }}>
          {/* Banda azul tipo cinta */}
          <div style={{
            background: 'var(--blue)',
            padding: '6px 16px',
            borderBottom: '2px solid var(--text-primary)',
          }}>
            <span style={{
              fontFamily: HAND, fontSize: 14, fontWeight: 800,
              color: '#000',
            }}>
              📅 día seleccionado
            </span>
          </div>

          <div style={{ padding: '14px 16px', position: 'relative' }}>
            <h3 style={{
              fontFamily: HAND,
              fontSize: 22, fontWeight: 900,
              color: 'var(--text-primary)',
              margin: '0 0 12px',
              lineHeight: 1.1,
              textTransform: 'capitalize',
            }}>
              {new Date(diaSeleccionado + 'T12:00:00').toLocaleDateString(
                idioma === 'en' ? 'en-US' : 'es-ES',
                { weekday: 'long', day: 'numeric', month: 'long' }
              )}
            </h3>

            {asignaciones.filter(a => a.fecha === diaSeleccionado).length === 0 ? (
              <p style={{
                fontFamily: BODY, fontSize: 16,
                color: 'var(--text-faint)',
                margin: 0, textAlign: 'center', padding: '8px 0',
              }}>
                ~ {tr('sinAsignaciones')} ~
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {asignaciones.filter(a => a.fecha === diaSeleccionado).map(a => (
                  <div key={a.id} className="nb-pendiente-item" style={{
                    border: `2px solid ${a.completada ? 'var(--border-color)' : a.materiaColor + '66'}`,
                    opacity: a.completada ? 0.65 : 1,
                  }}>
                    {/* Checkbox custom */}
                    <div
                      onClick={() => onToggleAsig(a.id)}
                      style={{
                        width: 22, height: 22,
                        borderRadius: 6,
                        border: `2.5px solid ${a.completada ? 'var(--text-primary)' : a.materiaColor}`,
                        background: a.completada ? a.materiaColor : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 900, color: '#000',
                        flexShrink: 0,
                        boxShadow: a.completada ? '1px 1px 0 var(--text-primary)' : 'none',
                        cursor: 'pointer',
                      }}>
                      {a.completada && '✓'}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontFamily: BODY, fontSize: 16, fontWeight: 700,
                        color: a.completada ? 'var(--text-faint)' : 'var(--text-primary)',
                        margin: 0,
                        textDecoration: a.completada ? 'line-through' : 'none',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        lineHeight: 1.2,
                      }}>
                        {a.titulo}
                      </p>
                      <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                        <span style={{
                          fontFamily: HAND, fontSize: 11, fontWeight: 700,
                          background: tipoInfo(a.tipo).color + '25',
                          color: tipoInfo(a.tipo).color,
                          padding: '1px 6px',
                          borderRadius: 4,
                          border: `1px solid ${tipoInfo(a.tipo).color}55`,
                        }}>
                          {tipoInfo(a.tipo).label}
                        </span>
                        <span style={{
                          fontFamily: HAND, fontSize: 11, fontWeight: 700,
                          background: a.materiaColor + '25',
                          color: a.materiaColor,
                          padding: '1px 6px',
                          borderRadius: 4,
                          border: `1px solid ${a.materiaColor}55`,
                        }}>
                          {a.materia}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => onEliminarAsig(a.id)}
                      style={{
                        background: 'transparent',
                        border: '1.5px dashed var(--text-faint)',
                        borderRadius: 6,
                        color: 'var(--text-faint)',
                        cursor: 'pointer',
                        fontSize: 13,
                        flexShrink: 0,
                        padding: '3px 6px',
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
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PRÓXIMAS ASIGNACIONES */}
      <div className="nb-sidebar-card" style={{ transform: 'rotate(0.5deg)' }}>
        <div className="nb-tape-deco" />

        <div style={{
          background: 'var(--red)',
          padding: '6px 16px',
          borderBottom: '2px solid var(--text-primary)',
        }}>
          <span style={{
            fontFamily: HAND, fontSize: 16, fontWeight: 800,
            color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)',

          }}>
            🔥 {tr('proximasAsig')}
          </span>
        </div>

        <div style={{ padding: '14px 16px' }}>
          {proximas.length === 0 ? (
            <p style={{
              fontFamily: BODY, fontSize: 16,
              color: 'var(--text-faint)',
              margin: 0, textAlign: 'center', padding: '12px 0',
            }}>
              ~ {tr('sinPendientes')} ~
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {proximas.map((a, i) => {
                const fecha = new Date(a.fecha + 'T12:00:00');
                const diff = Math.ceil((fecha.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                const urgente = diff <= 1;
                const proxima = diff <= 3;
                const rot = (i % 2 === 0 ? -0.4 : 0.4);

                return (
                  <div
                    key={a.id}
                    onClick={() => onSelectDia(a.fecha)}
                    className="nb-pendiente-item"
                    style={{
                      border: urgente
                        ? '2px solid var(--red)'
                        : proxima
                          ? '2px dashed var(--gold)'
                          : '1.5px dashed var(--border-color)',
                      transform: `rotate(${rot}deg)`,
                    }}
                  >
                    <div style={{
                      width: 10, height: 10,
                      borderRadius: '50%',
                      background: a.materiaColor,
                      border: '1.5px solid var(--text-primary)',
                      boxShadow: `0 0 6px ${a.materiaColor}66`,
                      flexShrink: 0,
                    }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontFamily: HAND, fontSize: 16, fontWeight: 700,
                        color: 'var(--text-primary)',
                        margin: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        lineHeight: 1.1,
                      }}>
                        {a.titulo}
                      </p>
                      <p style={{
                        fontFamily: BODY, fontSize: 12, fontWeight: 600,
                        color: 'var(--text-faint)',
                        margin: 0,
                      }}>
                        {a.materia}
                      </p>
                    </div>

                    <span style={{
                      fontFamily: HAND, fontSize: 14, fontWeight: 800,
                      color: urgente ? 'var(--red)' : proxima ? 'var(--gold)' : 'var(--text-muted)',
                      background: urgente
                        ? 'color-mix(in srgb,var(--red) 18%,transparent)'
                        : proxima
                          ? 'color-mix(in srgb,var(--gold) 18%,transparent)'
                          : 'transparent',
                      padding: '3px 8px',
                      borderRadius: 6,
                      border: urgente
                        ? '1.5px solid var(--red)'
                        : proxima
                          ? '1.5px dashed var(--gold)'
                          : 'none',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}>
                      {diff === 0 ? `🔥 ${tr('hoy')}` : diff === 1 ? `⚡ ${tr('manana')}` : `${diff}d`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* OBJETIVOS PENDIENTES */}
      <div className="nb-sidebar-card" style={{ transform: 'rotate(-0.6deg)' }}>
        <div style={{
          background: 'var(--pink)',
          padding: '6px 16px',
          borderBottom: '2px solid var(--text-primary)',
        }}>
          <span style={{
            fontFamily: HAND, fontSize: 16, fontWeight: 800,
            color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)',

          }}>
            🎯 {tr('objetivosPendientes')}
          </span>
        </div>

        <div style={{ padding: '14px 16px' }}>
          {objPendientes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: 30, marginBottom: 4 }}>✨</div>
              <p style={{
                fontFamily: BODY, fontSize: 16,
                color: 'var(--text-faint)',
                margin: 0,
              }}>
                ~ {tr('todoCompletado')} ~
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {objPendientes.map((o, i) => (
                <div key={o.id} className="nb-pendiente-item" style={{
                  border: '2px dashed var(--pink)',
                  transform: `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                }}>
                  <div style={{
                    width: 16, height: 16,
                    borderRadius: 4,
                    border: '2.5px solid var(--pink)',
                    background: 'transparent',
                    flexShrink: 0,
                  }} />
                  <p style={{
                    fontFamily: HAND, fontSize: 16, fontWeight: 700,
                    color: 'var(--text-primary)',
                    margin: 0, flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    lineHeight: 1.1,
                  }}>
                    {o.titulo}
                  </p>
                  <span style={{
                    fontFamily: HAND, fontSize: 14, fontWeight: 800,
                    color: 'var(--gold)',
                    background: 'color-mix(in srgb,var(--gold) 16%,transparent)',
                    border: '1.5px solid var(--gold)',
                    borderRadius: 6,
                    padding: '2px 6px',
                    flexShrink: 0,
                  }}>
                    ⭐ {o.xp}
                  </span>
                </div>
              ))}
              {objetivos.filter(o => !o.completado).length > 5 && (
                <p style={{
                  fontFamily: BODY, fontSize: 14,
                  color: 'var(--text-faint)',
                  margin: '6px 0 0', textAlign: 'center',
                }}>
                  ~ +{objetivos.filter(o => !o.completado).length - 5} {idioma === 'en' ? 'more pending' : 'más pendientes'} ~
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}