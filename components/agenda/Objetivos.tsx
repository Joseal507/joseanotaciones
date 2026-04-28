'use client';

import { ObjetivoAgenda, Asignacion } from '../../lib/agenda';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';

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

  const CATS = [
    { id: 'asignacion', label: idioma === 'en' ? '📋 Assignments' : '📋 Asignaciones', color: 'var(--blue)'  },
    { id: 'estudio',    label: idioma === 'en' ? '📚 Study'       : '📚 Estudio',       color: 'var(--blue)'  },
    { id: 'personal',   label: idioma === 'en' ? '🌟 Personal'    : '🌟 Personal',      color: 'var(--gold)'  },
    { id: 'materia',    label: idioma === 'en' ? '📖 Subject'     : '📖 Materia',       color: 'var(--pink)'  },
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
      gridTemplateColumns: isMobile ? '1fr' : '1fr 280px',
      gap: '24px', alignItems: 'flex-start',
    }}>

      {/* ── Lista ── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', marginTop: isMobile ? '4px' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '4px', height: '32px', background: 'var(--pink)', borderRadius: '2px' }} />
            <div>
              <h2 style={{ fontSize: isMobile ? '18px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                {idioma === 'en' ? 'Goals' : 'Objetivos'}
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
                {completados}/{objetivos.length} {idioma === 'en' ? 'completed' : 'completados'}
              </p>
            </div>
          </div>
          <button onClick={onNuevo}
            style={{ padding: '10px 16px', borderRadius: '12px', border: 'none', background: 'var(--pink)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
            + {idioma === 'en' ? 'New goal' : 'Nuevo objetivo'}
          </button>
        </div>

        {objetivos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: '56px', marginBottom: '12px' }}>🎯</div>
            <p style={{ color: 'var(--text-faint)', fontWeight: 600, marginBottom: '20px' }}>
              {idioma === 'en' ? 'No goals yet' : 'No hay objetivos todavía'}
            </p>
            <button onClick={onNuevo}
              style={{ padding: '10px 24px', borderRadius: '10px', border: 'none', background: 'var(--pink)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
              + {idioma === 'en' ? 'Create first goal' : 'Crear primer objetivo'}
            </button>
          </div>
        ) : (
          CATS.map(cat => {
            const objs = objetivos.filter(o => o.categoria === cat.id);
            if (objs.length === 0) return null;
            return (
              <div key={cat.id} style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <div style={{ width: '3px', height: '18px', background: cat.color, borderRadius: '2px' }} />
                  <h3 style={{ fontSize: '12px', fontWeight: 800, color: cat.color, margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>
                    {cat.label}
                  </h3>
                  <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                    {objs.filter(o => o.completado).length}/{objs.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {objs.map(obj => {
                    const asig = getAsig(obj.asignacionId);
                    const bloqueado = asig?.vencida && !asig.completada;
                    const dias = diasRestantes(obj.fechaLimite);
                    const urgente = dias !== null && dias <= 2 && dias >= 0;
                    const vencida = dias !== null && dias < 0;

                    return (
                      <div key={obj.id} style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: isMobile ? '12px 14px' : '14px 16px',
                        background: bloqueado ? 'var(--bg-secondary)' : 'var(--bg-card)',
                        borderRadius: '14px',
                        border: `1px solid ${bloqueado ? '#ff4d6d44' : obj.completado ? 'var(--border-color)' : cat.color + '33'}`,
                        opacity: obj.completado ? 0.7 : bloqueado ? 0.5 : 1,
                        transition: 'all 0.2s',
                      }}>

                        {/* Checkbox */}
                        <div
                          onClick={() => !bloqueado && onToggle(obj.id)}
                          style={{
                            width: '28px', height: '28px', borderRadius: '8px',
                            border: `3px solid ${bloqueado ? '#ff4d6d' : obj.completado ? cat.color : 'var(--border-color2)'}`,
                            background: obj.completado ? cat.color : bloqueado ? '#ff4d6d22' : 'transparent',
                            cursor: bloqueado ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '14px', fontWeight: 900, color: '#000',
                            flexShrink: 0, transition: 'all 0.2s',
                          }}>
                          {obj.completado ? '✓' : bloqueado ? '⛔' : ''}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            fontSize: isMobile ? '14px' : '15px', fontWeight: 700, margin: 0,
                            color: bloqueado ? 'var(--text-faint)' : obj.completado ? 'var(--text-faint)' : 'var(--text-primary)',
                            textDecoration: obj.completado ? 'line-through' : 'none',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: isMobile ? 'nowrap' : 'normal',
                          }}>
                            {obj.titulo}
                          </p>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '3px', flexWrap: 'wrap' }}>
                            {obj.fechaLimite && (
                              <span style={{
                                fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px',
                                background: bloqueado ? '#ff4d6d22' : vencida ? '#ff4d6d22' : urgente ? 'var(--gold-dim)' : 'var(--bg-secondary)',
                                color: bloqueado ? '#ff4d6d' : vencida ? '#ff4d6d' : urgente ? 'var(--gold)' : 'var(--text-faint)',
                              }}>
                                {bloqueado ? (idioma === 'en' ? '⛔ Expired' : '⛔ Vencida') :
                                 vencida    ? (idioma === 'en' ? '⛔ Expired' : '⛔ Vencida') :
                                 dias === 0  ? (idioma === 'en' ? '🔥 Today' : '🔥 Hoy') :
                                 dias === 1  ? (idioma === 'en' ? '⚡ Tomorrow' : '⚡ Mañana') :
                                              `📅 ${dias}d`}
                              </span>
                            )}
                            {obj.tamaño && (
                              <span style={{ fontSize: '10px', color: 'var(--text-faint)', padding: '1px 4px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                                {obj.tamaño}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* XP badge */}
                        <div style={{
                          background: bloqueado ? '#ff4d6d22' : obj.completado ? 'var(--gold)' : 'var(--gold-dim)',
                          border: `1px solid ${bloqueado ? '#ff4d6d44' : 'var(--gold-border)'}`,
                          color: bloqueado ? '#ff4d6d' : obj.completado ? '#000' : 'var(--gold)',
                          padding: '4px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 800,
                          flexShrink: 0, whiteSpace: 'nowrap',
                        }}>
                          {bloqueado ? '⛔ 0 XP' : `⭐ ${obj.xp} XP`}
                        </div>

                        {/* Solo eliminar si NO es de asignación */}
                        {(
                          <button onClick={() => onEliminar(obj.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '14px', flexShrink: 0, padding: '4px' }}>
                            🗑️
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Panel stats ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!isMobile && (
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--gold-border)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: 'var(--gold)' }} />
            <div style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 16px' }}>
                ⭐ {idioma === 'en' ? 'Your Progress' : 'Tu Progreso'}
              </h3>
              <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                <div style={{ fontSize: '52px', fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>{nivel}</div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {idioma === 'en' ? 'Level' : 'Nivel'}
                </div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', height: '12px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ width: `${xpNivel}%`, height: '100%', background: 'var(--gold)', borderRadius: '10px', transition: 'width 0.5s' }} />
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0, textAlign: 'center' }}>
                {xpNivel}/100 XP → {idioma === 'en' ? 'Level' : 'Nivel'} {nivel + 1}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '14px' }}>
                {[
                  { label: idioma === 'en' ? 'Done' : 'Hechos',     val: completados,                   color: 'var(--pink)' },
                  { label: idioma === 'en' ? 'Pending' : 'Pend.',    val: objetivos.length - completados, color: 'var(--blue)' },
                  { label: 'XP',                                      val: xpTotal,                       color: 'var(--gold)' },
                  { label: idioma === 'en' ? 'Total' : 'Total',       val: objetivos.length,              color: 'var(--text-muted)' },
                ].map((s, i) => (
                  <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '18px', fontWeight: 900, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Stats mobile */}
        {isMobile && objetivos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '8px' }}>
            {[
              { label: idioma === 'en' ? 'Done' : 'Hechos', val: completados, color: 'var(--pink)' },
              { label: idioma === 'en' ? 'Pend.' : 'Pend.', val: objetivos.length - completados, color: 'var(--blue)' },
              { label: 'XP', val: xpTotal, color: 'var(--gold)' },
              { label: 'Total', val: objetivos.length, color: 'var(--text-muted)' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '10px', padding: '10px 6px', textAlign: 'center', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '18px', fontWeight: 900, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Leyenda XP */}
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: '#a78bfa' }} />
          <div style={{ padding: '16px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
              💡 {idioma === 'en' ? 'XP Guide' : 'Guía de XP'}
            </h3>
            {[
              { label: idioma === 'en' ? '🟢 Small goal' : '🟢 Objetivo pequeño', xp: 50  },
              { label: idioma === 'en' ? '🟡 Medium goal' : '🟡 Objetivo mediano', xp: 120 },
              { label: idioma === 'en' ? '🔴 Large goal' : '🔴 Objetivo grande',  xp: 250 },
            ].map((g, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < 2 ? '1px solid var(--border-color)' : 'none' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{g.label}</span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)' }}>⭐ {g.xp}</span>
              </div>
            ))}
            <p style={{ fontSize: '11px', color: '#ff4d6d', margin: '10px 0 0', fontWeight: 600 }}>
              ⛔ {idioma === 'en' ? 'Miss deadline = 0 XP' : 'Vence sin completar = 0 XP'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
