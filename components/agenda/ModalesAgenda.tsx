'use client';

import { useState } from 'react';
import { Asignacion, ObjetivoAgenda, XP_TAMAÑO, TamañoObjetivo, genId } from '../../lib/agenda';
import { useIdioma } from '../../hooks/useIdioma';

// ══════════════════════════════════════════════════════════════
// MODAL ASIGNACIÓN
// ══════════════════════════════════════════════════════════════
interface ModalAsigProps {
  materias: any[];
  fechaInicial: string;
  onCrear: (a: Asignacion) => void;
  onClose: () => void;
}

export function ModalAsignacion({ materias, fechaInicial, onCrear, onClose }: ModalAsigProps) {
  const [titulo,  setTitulo]  = useState('');
  const [materia, setMateria] = useState('');
  const [fecha,   setFecha]   = useState(fechaInicial);
  const [tipo,    setTipo]    = useState<Asignacion['tipo']>('tarea');
  const [tamaño,  setTamaño]  = useState<TamañoObjetivo>('mediano');
  const { idioma } = useIdioma();

  const TIPOS = idioma === 'en'
    ? [
        { id: 'tarea',    label: '📝 Homework', color: '#38bdf8' },
        { id: 'examen',   label: '📋 Exam',     color: '#ff4d6d' },
        { id: 'proyecto', label: '🛠️ Project',  color: '#f5c842' },
        { id: 'otro',     label: '📌 Other',    color: '#a78bfa' },
      ]
    : [
        { id: 'tarea',    label: '📝 Tarea',    color: '#38bdf8' },
        { id: 'examen',   label: '📋 Examen',   color: '#ff4d6d' },
        { id: 'proyecto', label: '🛠️ Proyecto', color: '#f5c842' },
        { id: 'otro',     label: '📌 Otro',     color: '#a78bfa' },
      ];

  const TAMAÑOS: { id: TamañoObjetivo; label: string; desc: string; color: string }[] = idioma === 'en'
    ? [
        { id: 'pequeño', label: '🟢 Small',  desc: '50 XP · Quick task',       color: '#22c55e' },
        { id: 'mediano', label: '🟡 Medium', desc: '120 XP · Regular effort',   color: '#f5c842' },
        { id: 'grande',  label: '🔴 Large',  desc: '250 XP · Major challenge',  color: '#ff4d6d' },
      ]
    : [
        { id: 'pequeño', label: '🟢 Pequeño', desc: '50 XP · Tarea rápida',       color: '#22c55e' },
        { id: 'mediano', label: '🟡 Mediano', desc: '120 XP · Esfuerzo normal',   color: '#f5c842' },
        { id: 'grande',  label: '🔴 Grande',  desc: '250 XP · Gran desafío',      color: '#ff4d6d' },
      ];

  const crear = () => {
    if (!titulo.trim() || !fecha) return;
    const mat = materias.find(m => m.id === materia);
    onCrear({
      id: genId(),
      titulo: titulo.trim(),
      materia: mat?.nombre || (idioma === 'en' ? 'No subject' : 'Sin materia'),
      materiaColor: mat?.color || '#555',
      fecha,
      completada: false,
      tipo,
      tamaño,
      xp: XP_TAMAÑO[tamaño],
      vencida: false,
    });
  };

  const tamañoSel = TAMAÑOS.find(t => t.id === tamaño)!;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '460px', border: '1px solid var(--border-color)', maxHeight: '90vh', overflowY: 'auto' }}>
        
        <div style={{ height: '4px', background: 'var(--blue)', borderRadius: '2px', marginBottom: '24px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 24px' }}>
          {idioma === 'en' ? '📋 New Assignment' : '📋 Nueva Asignación'}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Título */}
          <div>
            <label style={labelStyle}>{idioma === 'en' ? 'Title' : 'Título'}</label>
            <input
              value={titulo} onChange={e => setTitulo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && crear()}
              placeholder={idioma === 'en' ? 'e.g. Calculus exam...' : 'Ej: Examen de Cálculo...'}
              autoFocus
              style={inputStyle}
            />
          </div>

          {/* Tipo */}
          <div>
            <label style={labelStyle}>{idioma === 'en' ? 'Type' : 'Tipo'}</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {TIPOS.map(t => (
                <button key={t.id} onClick={() => setTipo(t.id as any)}
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: `2px solid ${tipo === t.id ? t.color : 'var(--border-color)'}`,
                    background: tipo === t.id ? t.color + '25' : 'transparent',
                    color: tipo === t.id ? t.color : 'var(--text-muted)',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tamaño / XP */}
          <div>
            <label style={labelStyle}>
              {idioma === 'en' ? 'Size & XP reward' : 'Tamaño y recompensa XP'}
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {TAMAÑOS.map(t => (
                <button key={t.id} onClick={() => setTamaño(t.id)}
                  style={{
                    padding: '10px 14px', borderRadius: '10px',
                    border: `2px solid ${tamaño === t.id ? t.color : 'var(--border-color)'}`,
                    background: tamaño === t.id ? t.color + '15' : 'var(--bg-secondary)',
                    cursor: 'pointer', textAlign: 'left',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: tamaño === t.id ? t.color : 'var(--text-primary)' }}>
                    {t.label}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{t.desc}</span>
                </button>
              ))}
            </div>

            {/* Preview XP */}
            <div style={{ marginTop: '8px', padding: '10px 14px', background: tamañoSel.color + '15', borderRadius: '10px', border: `1px solid ${tamañoSel.color}44`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>⭐</span>
              <div>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: tamañoSel.color }}>
                  +{XP_TAMAÑO[tamaño]} XP {idioma === 'en' ? 'if completed on time' : 'si se completa a tiempo'}
                </p>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>
                  {idioma === 'en'
                    ? '⛔ 0 XP if you miss the deadline'
                    : '⛔ 0 XP si vence sin completar'}
                </p>
              </div>
            </div>
          </div>

          {/* Materia */}
          <div>
            <label style={labelStyle}>{idioma === 'en' ? 'Subject' : 'Materia'}</label>
            <select value={materia} onChange={e => setMateria(e.target.value)} style={selectStyle}>
              <option value="">{idioma === 'en' ? 'No subject' : 'Sin materia'}</option>
              {materias.map(m => (
                <option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>
              ))}
            </select>
          </div>

          {/* Fecha límite */}
          <div>
            <label style={labelStyle}>{idioma === 'en' ? 'Deadline' : 'Fecha límite'}</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputStyle} />
          </div>

        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
          <button onClick={onClose} style={btnSecondary}>
            {idioma === 'en' ? 'Cancel' : 'Cancelar'}
          </button>
          <button onClick={crear} disabled={!titulo.trim() || !fecha}
            style={{ ...btnPrimary, opacity: (!titulo.trim() || !fecha) ? 0.4 : 1 }}>
            {idioma === 'en' ? '+ Add Assignment' : '+ Agregar Asignación'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MODAL OBJETIVO LIBRE
// ══════════════════════════════════════════════════════════════
interface ModalObjProps {
  onCrear: (o: ObjetivoAgenda) => void;
  onClose: () => void;
}

export function ModalObjetivo({ onCrear, onClose }: ModalObjProps) {
  const [titulo,    setTitulo]    = useState('');
  const [categoria, setCategoria] = useState<ObjetivoAgenda['categoria']>('estudio');
  const [tamaño,    setTamaño]    = useState<TamañoObjetivo>('mediano');
  const { idioma } = useIdioma();

  const CATS = idioma === 'en'
    ? [
        { id: 'estudio',  label: '📚 Study',    color: 'var(--blue)' },
        { id: 'personal', label: '🌟 Personal',  color: 'var(--gold)' },
        { id: 'materia',  label: '📖 Subject',   color: 'var(--pink)' },
      ]
    : [
        { id: 'estudio',  label: '📚 Estudio',   color: 'var(--blue)' },
        { id: 'personal', label: '🌟 Personal',  color: 'var(--gold)' },
        { id: 'materia',  label: '📖 Materia',   color: 'var(--pink)' },
      ];

  const TAMAÑOS: { id: TamañoObjetivo; label: string; xp: number }[] = [
    { id: 'pequeño', label: idioma === 'en' ? '🟢 Small'  : '🟢 Pequeño', xp: 50  },
    { id: 'mediano', label: idioma === 'en' ? '🟡 Medium' : '🟡 Mediano', xp: 120 },
    { id: 'grande',  label: idioma === 'en' ? '🔴 Large'  : '🔴 Grande',  xp: 250 },
  ];

  const crear = () => {
    if (!titulo.trim()) return;
    onCrear({
      id: genId(),
      titulo: titulo.trim(),
      completado: false,
      xp: XP_TAMAÑO[tamaño],
      categoria,
      fechaCreacion: new Date().toISOString().slice(0, 10),
      tamaño,
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '420px', border: '1px solid var(--border-color)' }}>
        
        <div style={{ height: '4px', background: 'var(--pink)', borderRadius: '2px', marginBottom: '24px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 24px' }}>
          {idioma === 'en' ? '🎯 New Goal' : '🎯 Nuevo Objetivo'}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          <div>
            <label style={labelStyle}>{idioma === 'en' ? 'Goal' : 'Objetivo'}</label>
            <input
              value={titulo} onChange={e => setTitulo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && crear()}
              placeholder={idioma === 'en' ? 'e.g. Study 50 flashcards...' : 'Ej: Estudiar 50 flashcards...'}
              autoFocus style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>{idioma === 'en' ? 'Category' : 'Categoría'}</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {CATS.map(c => (
                <button key={c.id} onClick={() => setCategoria(c.id as any)}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: '8px',
                    border: `2px solid ${categoria === c.id ? c.color : 'var(--border-color)'}`,
                    background: categoria === c.id ? c.color + '20' : 'transparent',
                    color: categoria === c.id ? c.color : 'var(--text-muted)',
                    fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                  }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>{idioma === 'en' ? 'Size' : 'Tamaño'}</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {TAMAÑOS.map(t => (
                <button key={t.id} onClick={() => setTamaño(t.id)}
                  style={{
                    flex: 1, padding: '10px 6px', borderRadius: '8px',
                    border: `2px solid ${tamaño === t.id ? 'var(--gold)' : 'var(--border-color)'}`,
                    background: tamaño === t.id ? 'var(--gold-dim)' : 'transparent',
                    color: tamaño === t.id ? 'var(--gold)' : 'var(--text-muted)',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer', textAlign: 'center',
                  }}>
                  <div>{t.label}</div>
                  <div style={{ fontSize: '10px', marginTop: '2px' }}>⭐ {t.xp} XP</div>
                </button>
              ))}
            </div>
          </div>

        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
          <button onClick={onClose} style={btnSecondary}>
            {idioma === 'en' ? 'Cancel' : 'Cancelar'}
          </button>
          <button onClick={crear} disabled={!titulo.trim()}
            style={{ ...btnPrimary, background: 'var(--pink)', opacity: !titulo.trim() ? 0.4 : 1 }}>
            {idioma === 'en' ? '+ Add Goal' : '+ Agregar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Estilos compartidos ──────────────────────────────────────
const labelStyle: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)',
  display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '10px',
  border: '2px solid var(--border-color)', background: 'var(--bg-secondary)',
  color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box', outline: 'none',
};
const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  flex: 1, padding: '12px', borderRadius: '10px',
  border: '2px solid var(--border-color)', background: 'transparent',
  color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  flex: 2, padding: '12px', borderRadius: '10px',
  border: 'none', background: 'var(--blue)',
  color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer',
};
