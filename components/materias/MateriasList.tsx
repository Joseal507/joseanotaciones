'use client';

import { useState, useRef } from 'react';
import { Materia } from '../../lib/storage';
import { useIdioma } from '../../hooks/useIdioma';

interface Props {
  materias: Materia[];
  onAbrir: (m: Materia) => void;
  onEliminar: (id: string) => void;
  onNueva: () => void;
  onReordenar: (materias: Materia[]) => void;
  onEditar: (materia: Materia) => void;
}

const COLORES = [
  '#f5c842','#ff4d6d','#38bdf8','#f472b6','#4ade80','#fb923c',
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

  // ── DRAG & DROP ──────────────────────────────
  const handleDragStart = (i: number) => {
    dragItem.current = i;
    setDragIndex(i);
  };

  const handleDragEnter = (i: number) => {
    setDragOver(i);
  };

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOver === null || dragItem.current === dragOver) {
      setDragIndex(null);
      setDragOver(null);
      dragItem.current = null;
      return;
    }
    const newMaterias = [...materias];
    const [removed] = newMaterias.splice(dragItem.current, 1);
    newMaterias.splice(dragOver, 0, removed);
    onReordenar(newMaterias);
    setDragIndex(null);
    setDragOver(null);
    dragItem.current = null;
  };

  // ── EDITAR ───────────────────────────────────
  const abrirEditar = (e: React.MouseEvent, m: Materia) => {
    e.stopPropagation();
    setEditando(m);
    setEditNombre(m.nombre);
    setEditColor(m.color);
    setEditEmoji(m.emoji);
  };

  const guardarEditar = () => {
    if (!editando || !editNombre.trim()) return;
    onEditar({ ...editando, nombre: editNombre.trim(), color: editColor, emoji: editEmoji });
    setEditando(null);
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>

      {/* MODAL EDITAR */}
      {editando && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: `2px solid ${editColor}`, width: '100%', maxWidth: '460px', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: editColor }} />
            <div style={{ padding: '28px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                  ✏️ {idioma === 'en' ? 'Edit Subject' : 'Editar Materia'}
                </h2>
                <button onClick={() => setEditando(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer' }}>✕</button>
              </div>

              {/* Preview */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', borderRadius: '12px', background: 'var(--bg-secondary)', marginBottom: '20px', border: `2px solid ${editColor}` }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: editColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                  {editEmoji}
                </div>
                <div>
                  <p style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{editNombre || '...'}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>Preview</p>
                </div>
              </div>

              {/* Nombre */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '6px' }}>
                  {idioma === 'en' ? 'Name' : 'Nombre'}
                </label>
                <input
                  value={editNombre}
                  onChange={e => setEditNombre(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && guardarEditar()}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: `2px solid ${editColor}`, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 700, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Emoji */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '8px' }}>
                  Emoji
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {EMOJIS.map(em => (
                    <button key={em} onClick={() => setEditEmoji(em)}
                      style={{ width: '36px', height: '36px', borderRadius: '8px', border: `2px solid ${em === editEmoji ? editColor : 'var(--border-color)'}`, background: em === editEmoji ? editColor + '30' : 'transparent', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {em}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '8px' }}>
                  Color
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {COLORES.map(c => (
                    <button key={c} onClick={() => setEditColor(c)}
                      style={{ width: '32px', height: '32px', borderRadius: '50%', background: c, border: c === editColor ? '3px solid var(--text-primary)' : '3px solid transparent', cursor: 'pointer', boxShadow: c === editColor ? `0 0 0 2px ${c}` : 'none' }} />
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setEditando(null)}
                  style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: '14px' }}>
                  {idioma === 'en' ? 'Cancel' : 'Cancelar'}
                </button>
                <button onClick={guardarEditar}
                  style={{ flex: 2, padding: '12px', borderRadius: '10px', border: 'none', background: editColor, color: '#000', fontWeight: 900, cursor: 'pointer', fontSize: '14px' }}>
                  💾 {idioma === 'en' ? 'Save changes' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '6px', height: '40px', background: 'var(--gold)', borderRadius: '3px' }} />
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{tr('misMaterias')}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
              {materias.length} {tr('materias').toLowerCase()}
              {materias.length > 1 && (
                <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-faint)' }}>
                  · {idioma === 'en' ? 'drag to reorder' : 'arrastra para reordenar'} ↕
                </span>
              )}
            </p>
          </div>
        </div>
        <button onClick={onNueva}
          style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
          + {idioma === 'en' ? 'New Subject' : 'Nueva Materia'}
        </button>
      </div>

      {materias.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: '72px', marginBottom: '16px' }}>📚</div>
          <p style={{ fontSize: '20px', color: 'var(--text-faint)', fontWeight: 600, marginBottom: '24px' }}>{tr('sinMaterias')}</p>
          <button onClick={onNueva}
            style={{ padding: '14px 32px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
            + {idioma === 'en' ? 'Create first subject' : 'Crear primera materia'}
          </button>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px',
        }}>
          {materias.map((materia, i) => (
            <div
              key={materia.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragEnter={() => handleDragEnter(i)}
              onDragEnd={handleDragEnd}
              onDragOver={e => e.preventDefault()}
              style={{
                background: 'var(--bg-card)',
                borderRadius: '20px',
                border: dragOver === i && dragIndex !== i
                  ? `2px dashed ${materia.color}`
                  : '1px solid var(--border-color)',
                overflow: 'hidden',
                transition: 'all 0.2s ease',
                opacity: dragIndex === i ? 0.5 : 1,
                cursor: 'grab',
                transform: dragOver === i && dragIndex !== i ? 'scale(1.02)' : 'scale(1)',
              }}
              onMouseEnter={e => {
                if (dragIndex !== null) return;
                (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)';
                (e.currentTarget as HTMLDivElement).style.borderColor = materia.color;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-color)';
              }}
            >
              <div style={{ height: '5px', background: materia.color }} />
              <div style={{ padding: '20px' }}>

                {/* Drag handle + actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: 'var(--text-faint)', fontSize: '14px', cursor: 'grab', userSelect: 'none' }}>⠿</span>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      onClick={e => abrirEditar(e, materia)}
                      title={idioma === 'en' ? 'Edit' : 'Editar'}
                      style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '15px', padding: '4px 6px', borderRadius: '6px', transition: 'all 0.2s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-secondary)'; (e.currentTarget as HTMLButtonElement).style.color = materia.color; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'; }}>
                      ✏️
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); onEliminar(materia.id); }}
                      title={idioma === 'en' ? 'Delete' : 'Eliminar'}
                      style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '15px', padding: '4px 6px', borderRadius: '6px', transition: 'all 0.2s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--red-dim)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--red)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-faint)'; }}>
                      🗑️
                    </button>
                  </div>
                </div>

                {/* Info materia */}
                <div onClick={() => onAbrir(materia)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                    <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: materia.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }}>
                      {materia.emoji}
                    </div>
                    <div>
                      <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 3px' }}>{materia.nombre}</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{materia.temas.length} {tr('temas')}</p>
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {[
                      { label: idioma === 'en' ? 'Topics' : 'Temas', val: materia.temas.length },
                      { label: idioma === 'en' ? 'Notes' : 'Apuntes', val: materia.temas.reduce((a, t) => a + t.apuntes.length, 0) },
                      { label: 'Docs', val: materia.temas.reduce((a, t) => a + t.documentos.length, 0) },
                    ].map((s, j) => (
                      <div key={j} style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: 900, color: materia.color }}>{s.val}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={() => onAbrir(materia)}
                  style={{ width: '100%', marginTop: '14px', padding: '10px', borderRadius: '10px', border: `2px solid ${materia.color}`, background: 'transparent', color: materia.color, fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                  {idioma === 'en' ? 'Open subject →' : 'Abrir materia →'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
