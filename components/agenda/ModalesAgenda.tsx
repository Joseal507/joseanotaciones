'use client';

import { useState } from 'react';
import { Asignacion, ObjetivoAgenda, genId } from '../../lib/agenda';

const TIPOS = [
  { id: 'tarea', label: '📝 Tarea', color: '#38bdf8' },
  { id: 'examen', label: '📋 Examen', color: '#ff4d6d' },
  { id: 'proyecto', label: '🛠️ Proyecto', color: '#f5c842' },
  { id: 'otro', label: '📌 Otro', color: '#a78bfa' },
];

interface ModalAsigProps {
  materias: any[];
  fechaInicial: string;
  onCrear: (a: Asignacion) => void;
  onClose: () => void;
}

export function ModalAsignacion({ materias, fechaInicial, onCrear, onClose }: ModalAsigProps) {
  const [titulo, setTitulo] = useState('');
  const [materia, setMateria] = useState('');
  const [fecha, setFecha] = useState(fechaInicial);
  const [tipo, setTipo] = useState<Asignacion['tipo']>('tarea');

  const crear = () => {
    if (!titulo.trim() || !fecha) return;
    const mat = materias.find(m => m.id === materia);
    onCrear({
      id: genId(),
      titulo,
      materia: mat?.nombre || 'Sin materia',
      materiaColor: mat?.color || '#555',
      fecha,
      completada: false,
      tipo,
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '440px', border: '1px solid var(--border-color)' }}>
        <div style={{ height: '4px', background: 'var(--blue)', borderRadius: '2px', marginBottom: '24px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 24px' }}>
          Nueva Asignación
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>TÍTULO</label>
            <input
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && crear()}
              placeholder="Ej: Examen de Cálculo..."
              autoFocus
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>TIPO</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {TIPOS.map(t => (
                <button key={t.id} onClick={() => setTipo(t.id as any)}
                  style={{ padding: '6px 12px', borderRadius: '8px', border: `2px solid ${tipo === t.id ? t.color : 'var(--border-color)'}`, background: tipo === t.id ? t.color + '25' : 'transparent', color: tipo === t.id ? t.color : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>MATERIA</label>
            <select value={materia} onChange={e => setMateria(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}>
              <option value="">Sin materia</option>
              {materias.map(m => <option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>FECHA</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={crear}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: 'var(--blue)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModalObjProps {
  onCrear: (o: ObjetivoAgenda) => void;
  onClose: () => void;
}

export function ModalObjetivo({ onCrear, onClose }: ModalObjProps) {
  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState<ObjetivoAgenda['categoria']>('estudio');
  const [xp, setXp] = useState(10);

  const crear = () => {
    if (!titulo.trim()) return;
    onCrear({
      id: genId(),
      titulo,
      completado: false,
      xp,
      categoria,
      fechaCreacion: new Date().toLocaleDateString('es-ES'),
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '400px', border: '1px solid var(--border-color)' }}>
        <div style={{ height: '4px', background: 'var(--pink)', borderRadius: '2px', marginBottom: '24px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 24px' }}>
          Nuevo Objetivo
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>OBJETIVO</label>
            <input
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && crear()}
              placeholder="Ej: Estudiar capítulo 3..."
              autoFocus
              style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>CATEGORÍA</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { id: 'estudio', label: '📚 Estudio', color: 'var(--blue)' },
                { id: 'personal', label: '🌟 Personal', color: 'var(--gold)' },
                { id: 'materia', label: '📖 Materia', color: 'var(--pink)' },
              ].map(c => (
                <button key={c.id} onClick={() => setCategoria(c.id as any)}
                  style={{ flex: 1, padding: '8px', borderRadius: '8px', border: `2px solid ${categoria === c.id ? c.color : 'var(--border-color)'}`, background: categoria === c.id ? c.color + '25' : 'transparent', color: categoria === c.id ? c.color : 'var(--text-muted)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
              XP: <span style={{ color: 'var(--gold)' }}>⭐ {xp} XP</span>
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[5, 10, 20, 30, 50, 100].map(x => (
                <button key={x} onClick={() => setXp(x)}
                  style={{ padding: '6px 12px', borderRadius: '8px', border: `2px solid ${xp === x ? 'var(--gold)' : 'var(--border-color)'}`, background: xp === x ? 'var(--gold-dim)' : 'transparent', color: xp === x ? 'var(--gold)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  {x}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={crear}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: 'var(--pink)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
            ⭐ Crear
          </button>
        </div>
      </div>
    </div>
  );
}