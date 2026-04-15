'use client';

import { useState, useEffect } from 'react';
import { getNotas, crearNota, eliminarNota, actualizarNota, NotaRapida } from '../lib/notas';
import { useIdioma } from '../hooks/useIdioma';

export default function NotasRapidas() {
  const [notas, setNotas] = useState<NotaRapida[]>([]);
  const [nueva, setNueva] = useState('');
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState('');
  const [expandido, setExpandido] = useState(false);
  const { tr } = useIdioma();

  useEffect(() => {
    setNotas(getNotas());
  }, []);

  const handleCrear = () => {
    if (!nueva.trim()) return;
    const nota = crearNota(nueva.trim());
    setNotas(prev => [nota, ...prev]);
    setNueva('');
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

  const notasVisibles = expandido ? notas : notas.slice(0, 3);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '4px', height: '28px', background: 'var(--gold)', borderRadius: '2px' }} />
          <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
            {tr('notasRapidas')}
          </h2>
          {notas.length > 0 && (
            <span style={{ background: 'var(--gold)', color: '#000', padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 800 }}>
              {notas.length}
            </span>
          )}
        </div>
        {notas.length > 3 && (
          <button onClick={() => setExpandido(!expandido)}
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', padding: '5px 12px' }}>
            {expandido ? tr('verMenos') : `${tr('verTodasNotas')} (${notas.length})`}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          value={nueva}
          onChange={e => setNueva(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCrear()}
          placeholder={tr('escribirNota')}
          style={{ flex: 1, padding: '12px 16px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', fontFamily: 'inherit', transition: 'border 0.2s' }}
          onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
          onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
        />
        <button onClick={handleCrear} disabled={!nueva.trim()}
          style={{ padding: '12px 20px', borderRadius: '12px', border: 'none', background: nueva.trim() ? 'var(--gold)' : 'var(--bg-card)', color: nueva.trim() ? '#000' : 'var(--text-faint)', fontSize: '13px', fontWeight: 800, cursor: nueva.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
          {tr('agregarNota')}
        </button>
      </div>

      {notas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px', background: 'var(--bg-card)', borderRadius: '16px', border: '2px dashed var(--border-color)' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>📝</div>
          <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: 0 }}>
            {tr('sinNotas')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
          {notasVisibles.map(nota => (
            <div key={nota.id} style={{ background: 'var(--bg-card)', borderRadius: '14px', border: `1px solid ${nota.color}44`, overflow: 'hidden', position: 'relative', transition: 'all 0.2s' }}
              onMouseEnter={(e: any) => e.currentTarget.style.borderColor = nota.color}
              onMouseLeave={(e: any) => e.currentTarget.style.borderColor = nota.color + '44'}
            >
              <div style={{ height: '3px', background: nota.color }} />
              <div style={{ padding: '14px 16px' }}>
                {editandoId === nota.id ? (
                  <div>
                    <textarea value={editTexto} onChange={e => setEditTexto(e.target.value)} autoFocus
                      style={{ width: '100%', minHeight: '80px', padding: '8px', borderRadius: '8px', border: `2px solid ${nota.color}`, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <button onClick={handleGuardarEdicion}
                        style={{ flex: 1, padding: '6px', borderRadius: '7px', border: 'none', background: nota.color, color: '#000', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
                        {tr('guardar')}
                      </button>
                      <button onClick={() => setEditandoId(null)}
                        style={{ padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }}>
                        {tr('cancelar')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: '14px', color: 'var(--text-primary)', margin: '0 0 10px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {nota.contenido}
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{nota.fecha}</span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={() => handleEditar(nota)}
                          style={{ padding: '4px 8px', borderRadius: '6px', border: `1px solid ${nota.color}44`, background: 'transparent', color: nota.color, fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                          ✏️
                        </button>
                        <button onClick={() => handleEliminar(nota.id)}
                          style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '11px', cursor: 'pointer' }}>
                          🗑️
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}