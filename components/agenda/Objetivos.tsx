'use client';

import { ObjetivoAgenda } from '../../lib/agenda';
import { useIsMobile } from '../../hooks/useIsMobile';

interface Props {
  objetivos: ObjetivoAgenda[];
  xpTotal: number;
  nivel: number;
  xpNivel: number;
  onToggle: (id: string) => void;
  onEliminar: (id: string) => void;
  onNuevo: () => void;
}

export default function Objetivos({ objetivos, xpTotal, nivel, xpNivel, onToggle, onEliminar, onNuevo }: Props) {
  const completados = objetivos.filter(o => o.completado).length;
  const isMobile = useIsMobile();

  const CATS = [
    { id: 'estudio', label: '📚 Estudio', color: 'var(--blue)' },
    { id: 'personal', label: '🌟 Personal', color: 'var(--gold)' },
    { id: 'materia', label: '📖 Materia', color: 'var(--pink)' },
  ] as const;

  const LOGROS = [
    { emoji: '🌱', label: 'Primer objetivo', xp: 10, obtenido: objetivos.length >= 1 },
    { emoji: '⚡', label: '5 completados', xp: 50, obtenido: completados >= 5 },
    { emoji: '🔥', label: '10 completados', xp: 100, obtenido: completados >= 10 },
    { emoji: '💎', label: 'Nivel 5', xp: 200, obtenido: nivel >= 5 },
    { emoji: '👑', label: 'Nivel 10', xp: 500, obtenido: nivel >= 10 },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '1fr 290px',
      gap: '24px',
      alignItems: 'flex-start',
    }}>

      {/* Lista objetivos */}
      <div>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          marginTop: isMobile ? '4px' : '0px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '4px', height: '32px', background: 'var(--pink)', borderRadius: '2px' }} />
            <div>
              <h2 style={{ fontSize: isMobile ? '18px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                Objetivos
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
                {completados}/{objetivos.length} completados
              </p>
            </div>
          </div>
          <button onClick={onNuevo}
            style={{ padding: isMobile ? '10px 16px' : '10px 20px', borderRadius: '12px', border: 'none', background: 'var(--pink)', color: '#000', fontSize: isMobile ? '13px' : '13px', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            + Nuevo objetivo
          </button>
        </div>

        {/* Sin objetivos */}
        {objetivos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: '56px', marginBottom: '12px' }}>🎯</div>
            <p style={{ fontSize: '16px', color: 'var(--text-faint)', fontWeight: 600, marginBottom: '20px' }}>
              No hay objetivos todavía
            </p>
            <button onClick={onNuevo}
              style={{ padding: '10px 24px', borderRadius: '10px', border: 'none', background: 'var(--pink)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
              + Crear primer objetivo
            </button>
          </div>
        ) : (
          CATS.map(cat => {
            const objs = objetivos.filter(o => o.categoria === cat.id);
            if (objs.length === 0) return null;
            return (
              <div key={cat.id} style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <div style={{ width: '3px', height: '18px', background: cat.color, borderRadius: '2px' }} />
                  <h3 style={{ fontSize: '13px', fontWeight: 800, color: cat.color, margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>
                    {cat.label}
                  </h3>
                  <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                    {objs.filter(o => o.completado).length}/{objs.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {objs.map(obj => (
                    <div key={obj.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: isMobile ? '12px 14px' : '14px 16px',
                      background: 'var(--bg-card)',
                      borderRadius: '14px',
                      border: `1px solid ${obj.completado ? 'var(--border-color)' : cat.color + '33'}`,
                      transition: 'all 0.2s',
                      opacity: obj.completado ? 0.6 : 1,
                    }}>

                      {/* Checkbox videojuego */}
                      <div
                        onClick={() => onToggle(obj.id)}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '8px',
                          border: `3px solid ${obj.completado ? cat.color : 'var(--border-color2)'}`,
                          background: obj.completado ? cat.color : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '16px',
                          transition: 'all 0.2s',
                          flexShrink: 0,
                          color: '#000',
                          fontWeight: 900,
                        }}>
                        {obj.completado && '✓'}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: isMobile ? '14px' : '15px',
                          fontWeight: 700,
                          color: obj.completado ? 'var(--text-faint)' : 'var(--text-primary)',
                          margin: 0,
                          textDecoration: obj.completado ? 'line-through' : 'none',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: isMobile ? 'nowrap' : 'normal',
                        }}>
                          {obj.titulo}
                        </p>
                        <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '2px 0 0' }}>
                          {obj.fechaCreacion}
                        </p>
                      </div>

                      {/* XP Badge */}
                      <div style={{
                        background: obj.completado ? 'var(--gold)' : 'var(--gold-dim)',
                        border: '1px solid var(--gold-border)',
                        color: obj.completado ? '#000' : 'var(--gold)',
                        padding: '4px 8px',
                        borderRadius: '8px',
                        fontSize: '11px',
                        fontWeight: 800,
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}>
                        ⭐ {obj.xp} XP
                      </div>

                      <button onClick={() => onEliminar(obj.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '14px', flexShrink: 0, padding: '4px' }}>
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Panel stats + logros - solo desktop o abajo en mobile */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* XP y nivel - solo en desktop (en mobile está en la page) */}
        {!isMobile && (
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--gold-border)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: 'var(--gold)' }} />
            <div style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 16px' }}>
                ⭐ Tu Progreso
              </h3>
              <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                <div style={{ fontSize: '52px', fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>{nivel}</div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>Nivel actual</div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', height: '12px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ width: `${xpNivel}%`, height: '100%', background: 'var(--gold)', borderRadius: '10px', transition: 'width 0.5s' }} />
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0, textAlign: 'center' }}>
                {xpNivel}/100 XP → Nivel {nivel + 1}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '14px' }}>
                {[
                  { label: 'Completados', val: completados, color: 'var(--pink)' },
                  { label: 'Pendientes', val: objetivos.length - completados, color: 'var(--blue)' },
                  { label: 'XP total', val: xpTotal, color: 'var(--gold)' },
                  { label: 'Total', val: objetivos.length, color: 'var(--text-muted)' },
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

        {/* Stats rápidas en mobile */}
        {isMobile && objetivos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '8px' }}>
            {[
              { label: 'Hechos', val: completados, color: 'var(--pink)' },
              { label: 'Pendientes', val: objetivos.length - completados, color: 'var(--blue)' },
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

        {/* Logros */}
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: '#a78bfa' }} />
          <div style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 14px' }}>
              🏆 Logros
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {LOGROS.map((logro, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 12px',
                  background: logro.obtenido ? '#a78bfa18' : 'var(--bg-secondary)',
                  borderRadius: '10px',
                  border: `1px solid ${logro.obtenido ? '#a78bfa44' : 'var(--border-color)'}`,
                  opacity: logro.obtenido ? 1 : 0.4,
                  transition: 'all 0.2s',
                }}>
                  <span style={{ fontSize: '18px' }}>{logro.emoji}</span>
                  <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, flex: 1 }}>
                    {logro.label}
                  </p>
                  <span style={{ fontSize: '11px', color: '#a78bfa', fontWeight: 800, whiteSpace: 'nowrap' }}>
                    +{logro.xp} XP
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}