'use client';

import { Asignacion, ObjetivoAgenda } from '../../lib/agenda';

const TIPOS = [
  { id: 'tarea', label: '📝 Tarea', color: '#38bdf8' },
  { id: 'examen', label: '📋 Examen', color: '#ff4d6d' },
  { id: 'proyecto', label: '🛠️ Proyecto', color: '#f5c842' },
  { id: 'otro', label: '📌 Otro', color: '#a78bfa' },
];

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

  const tipoInfo = (tipo: string) => TIPOS.find(t => t.id === tipo) || TIPOS[3];

  const proximas = asignaciones
    .filter(a => !a.completada && a.fecha >= hoyStr)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .slice(0, 8);

  const objPendientes = objetivos.filter(o => !o.completado).slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Botón nueva asignación */}
      <button
        onClick={onNuevaAsig}
        style={{ padding: '14px', borderRadius: '14px', border: 'none', background: 'var(--blue)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer', width: '100%' }}>
        + Nueva asignación
      </button>

      {/* Día seleccionado */}
      {diaSeleccionado && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--blue-border)', overflow: 'hidden' }}>
          <div style={{ height: '3px', background: 'var(--blue)' }} />
          <div style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--blue)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              📅 {new Date(diaSeleccionado + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            {asignaciones.filter(a => a.fecha === diaSeleccionado).length === 0 ? (
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>Sin asignaciones</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {asignaciones.filter(a => a.fecha === diaSeleccionado).map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: '8px', border: `1px solid ${a.completada ? 'var(--border-color)' : a.materiaColor + '44'}` }}>
                    <input type="checkbox" checked={a.completada} onChange={() => onToggleAsig(a.id)}
                      style={{ width: '15px', height: '15px', accentColor: a.materiaColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '12px', fontWeight: 700, color: a.completada ? 'var(--text-faint)' : 'var(--text-primary)', margin: 0, textDecoration: a.completada ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.titulo}
                      </p>
                      <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                        <span style={{ fontSize: '9px', background: tipoInfo(a.tipo).color + '25', color: tipoInfo(a.tipo).color, padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                          {tipoInfo(a.tipo).label}
                        </span>
                        <span style={{ fontSize: '9px', background: a.materiaColor + '25', color: a.materiaColor, padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                          {a.materia}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => onEliminarAsig(a.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Próximas asignaciones */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '3px', background: 'var(--red)' }} />
        <div style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--red)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            🔔 Próximas asignaciones
          </h3>
          {proximas.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>Sin pendientes 🎉</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {proximas.map(a => {
                const fecha = new Date(a.fecha + 'T12:00:00');
                const diff = Math.ceil((fecha.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <div
                    key={a.id}
                    onClick={() => onSelectDia(a.fecha)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${diff <= 2 ? 'var(--red)' : 'var(--border-color)'}`, transition: 'all 0.15s' }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: a.materiaColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.titulo}</p>
                      <p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: 0 }}>{a.materia}</p>
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 800, color: diff <= 1 ? 'var(--red)' : diff <= 3 ? 'var(--gold)' : 'var(--text-faint)', flexShrink: 0, background: diff <= 1 ? 'var(--red-dim)' : diff <= 3 ? 'var(--gold-dim)' : 'transparent', padding: '2px 6px', borderRadius: '4px' }}>
                      {diff === 0 ? '¡Hoy!' : diff === 1 ? 'Mañana' : `${diff}d`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Objetivos pendientes */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '3px', background: 'var(--pink)' }} />
        <div style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--pink)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            🎯 Objetivos pendientes
          </h3>
          {objPendientes.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>Todo completado 🏆</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {objPendientes.map(o => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '3px', border: '2px solid var(--pink)', flexShrink: 0 }} />
                  <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.titulo}
                  </p>
                  <span style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 800, flexShrink: 0 }}>
                    ⭐{o.xp}
                  </span>
                </div>
              ))}
              {objetivos.filter(o => !o.completado).length > 5 && (
                <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '4px 0 0', textAlign: 'center' }}>
                  +{objetivos.filter(o => !o.completado).length - 5} más pendientes
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}