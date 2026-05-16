'use client';

import { useState } from 'react';
import { LOGROS, getLogrosObtenidos, LogroStats, Logro } from '../lib/xpSystem';

interface Props {
  stats: LogroStats;
  colorAccent?: string;
}

export default function LogrosPanel({ stats, colorAccent = '#f5c842' }: Props) {
  const [filtro, setFiltro] = useState<'todos' | 'obtenidos' | 'pendientes'>('todos');
  const obtenidos = getLogrosObtenidos(stats);
  const obtenidosIds = new Set(obtenidos.map(l => l.id));

  const logrosFiltrados = LOGROS.filter(l => {
    if (filtro === 'obtenidos') return obtenidosIds.has(l.id);
    if (filtro === 'pendientes') return !obtenidosIds.has(l.id);
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
            🏆 Logros
          </h3>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
            {obtenidos.length} / {LOGROS.length} desbloqueados
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['todos', 'obtenidos', 'pendientes'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              style={{
                padding: '4px 12px',
                borderRadius: 8,
                border: `1.5px solid ${filtro === f ? colorAccent : 'var(--border-color)'}`,
                background: filtro === f ? colorAccent + '22' : 'none',
                color: filtro === f ? colorAccent : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {f === 'todos' ? 'Todos' : f === 'obtenidos' ? '✅ Obtenidos' : '🔒 Pendientes'}
            </button>
          ))}
        </div>
      </div>

      {/* Barra de progreso total */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ height: 6, background: 'var(--bg-tertiary, #1e293b)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.round((obtenidos.length / LOGROS.length) * 100)}%`,
            background: colorAccent,
            borderRadius: 6,
            transition: 'width 0.6s ease',
          }} />
        </div>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
          {Math.round((obtenidos.length / LOGROS.length) * 100)}% completado
        </p>
      </div>

      {/* Grid de logros */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {logrosFiltrados.map(logro => {
          const obtenido = obtenidosIds.has(logro.id);
          const esSecreto = logro.secreto && !obtenido;

          return (
            <div
              key={logro.id}
              style={{
                background: obtenido ? logro.color + '15' : 'var(--bg-secondary)',
                border: `1.5px solid ${obtenido ? logro.color + '55' : 'var(--border-color)'}`,
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                opacity: obtenido ? 1 : 0.6,
                transition: 'all 0.2s',
              }}
            >
              {/* Emoji/ícono */}
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: obtenido ? logro.color + '30' : 'var(--bg-tertiary, #1e293b)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
                filter: obtenido ? 'none' : 'grayscale(1)',
              }}>
                {esSecreto ? '🔒' : logro.emoji}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: obtenido ? logro.color : 'var(--text-muted)', marginBottom: 2 }}>
                  {esSecreto ? '???' : logro.nombre}
                  {obtenido && <span style={{ marginLeft: 6, fontSize: 11 }}>✅</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, lineHeight: 1.4 }}>
                  {esSecreto ? 'Logro secreto — sigue estudiando' : logro.descripcion}
                </div>
                {!esSecreto && (
                  <div style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: obtenido ? logro.color : 'var(--text-faint)',
                    background: obtenido ? logro.color + '15' : 'var(--bg-tertiary, #1e293b)',
                    borderRadius: 6,
                    padding: '2px 8px',
                    display: 'inline-block',
                  }}>
                    🎁 {logro.recompensa}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}