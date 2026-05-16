'use client';

import { useState } from 'react';
import { Asignacion, ObjetivoAgenda, XP_TAMAÑO, TamañoObjetivo, genId } from '../../lib/agenda';
import { useIdioma } from '../../hooks/useIdioma';

const HAND = "'Caveat',cursive";

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
    <ModalShell color="var(--blue)" emoji="📋" title={idioma === 'en' ? 'New Assignment' : 'Nueva Asignación'} onClose={onClose}>

      {/* Título */}
      <Field label={idioma === 'en' ? 'Title' : 'Título'}>
        <input
          value={titulo}
          onChange={(e: any) => setTitulo(e.target.value)}
          onKeyDown={(e: any) => e.key === 'Enter' && crear()}
          placeholder={idioma === 'en' ? 'e.g. Calculus exam...' : 'Ej: Examen de Cálculo...'}
          autoFocus
          style={inputStyle}
        />
      </Field>

      {/* Tipo */}
      <Field label={idioma === 'en' ? 'Type' : 'Tipo'}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TIPOS.map((t, i) => {
            const active = tipo === t.id;
            return (
              <button key={t.id} onClick={() => setTipo(t.id as any)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 10,
                  border: `2.5px solid ${active ? t.color : 'var(--border-color)'}`,
                  background: active ? t.color + '22' : 'var(--bg-secondary)',
                  color: active ? t.color : 'var(--text-muted)',
                  fontFamily: HAND,
                  fontSize: 16, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: active ? `2px 3px 0 ${t.color}` : 'none',
                  transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}
                onMouseEnter={(e:any)=>{ if (!active) e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)'; }}
                onMouseLeave={(e:any)=>{ e.currentTarget.style.transform = active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`; }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Tamaño y XP */}
      <Field label={idioma === 'en' ? 'Size & XP reward' : 'Tamaño y recompensa XP'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {TAMAÑOS.map((t, i) => {
            const active = tamaño === t.id;
            return (
              <button key={t.id} onClick={() => setTamaño(t.id)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: `2.5px solid ${active ? t.color : 'var(--border-color)'}`,
                  background: active ? t.color + '18' : 'var(--bg-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  boxShadow: active ? `3px 3px 0 ${t.color}` : 'none',
                  transform: active ? 'rotate(-0.5deg)' : `rotate(${i % 2 === 0 ? -0.2 : 0.2}deg)`,
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}
              >
                <span style={{
                  fontFamily: HAND,
                  fontSize: 18, fontWeight: 800,
                  color: active ? t.color : 'var(--text-primary)',
                }}>
                  {t.label}
                </span>
                <span style={{
                  fontFamily: HAND,
                  fontSize: 14, fontStyle: 'italic',
                  color: 'var(--text-muted)',
                }}>
                  {t.desc}
                </span>
              </button>
            );
          })}
        </div>

        {/* Preview XP estilo postit */}
        <div style={{
          marginTop: 12,
          padding: '10px 14px',
          background: tamañoSel.color + '18',
          borderRadius: 10,
          border: `2px dashed ${tamañoSel.color}`,
          display: 'flex', alignItems: 'center', gap: 10,
          transform: 'rotate(0.5deg)',
        }}>
          <span style={{ fontSize: 24 }}>⭐</span>
          <div>
            <p style={{
              margin: 0,
              fontFamily: HAND, fontSize: 17, fontWeight: 800,
              color: tamañoSel.color, lineHeight: 1.1,
            }}>
              +{XP_TAMAÑO[tamaño]} XP {idioma === 'en' ? 'if completed on time' : 'si se completa a tiempo'}
            </p>
            <p style={{
              margin: 0,
              fontFamily: HAND, fontSize: 14,
              color: 'var(--text-muted)', fontStyle: 'italic',
            }}>
              ⛔ {idioma === 'en' ? '0 XP if you miss the deadline' : '0 XP si vence sin completar'}
            </p>
          </div>
        </div>
      </Field>

      {/* Materia */}
      <Field label={idioma === 'en' ? 'Subject' : 'Materia'}>
        <select value={materia} onChange={(e: any) => setMateria(e.target.value)} style={selectStyle}>
          <option value="">{idioma === 'en' ? '— No subject —' : '— Sin materia —'}</option>
          {materias.map(m => (
            <option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>
          ))}
        </select>
      </Field>

      {/* Fecha */}
      <Field label={idioma === 'en' ? 'Deadline' : 'Fecha límite'}>
        <input type="date" value={fecha} onChange={(e: any) => setFecha(e.target.value)} style={inputStyle} />
      </Field>

      {/* Botones */}
      <ButtonRow>
        <ModalBtn variant="secondary" onClick={onClose}>
          ✕ {idioma === 'en' ? 'Cancel' : 'Cancelar'}
        </ModalBtn>
        <ModalBtn variant="primary" color="var(--blue)" onClick={crear} disabled={!titulo.trim() || !fecha}>
          + {idioma === 'en' ? 'Add Assignment' : 'Agregar Asignación'}
        </ModalBtn>
      </ButtonRow>
    </ModalShell>
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
        { id: 'estudio',  label: '📚 Study',    color: '#38bdf8' },
        { id: 'personal', label: '🌟 Personal', color: '#f5c842' },
        { id: 'materia',  label: '📖 Subject',  color: '#f472b6' },
      ]
    : [
        { id: 'estudio',  label: '📚 Estudio',  color: '#38bdf8' },
        { id: 'personal', label: '🌟 Personal', color: '#f5c842' },
        { id: 'materia',  label: '📖 Materia',  color: '#f472b6' },
      ];

  const TAMAÑOS: { id: TamañoObjetivo; label: string; xp: number; color: string }[] = [
    { id: 'pequeño', label: idioma === 'en' ? '🟢 Small'  : '🟢 Pequeño', xp: 50,  color: '#22c55e' },
    { id: 'mediano', label: idioma === 'en' ? '🟡 Medium' : '🟡 Mediano', xp: 120, color: '#f5c842' },
    { id: 'grande',  label: idioma === 'en' ? '🔴 Large'  : '🔴 Grande',  xp: 250, color: '#ff4d6d' },
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
    <ModalShell color="var(--pink)" emoji="🎯" title={idioma === 'en' ? 'New Goal' : 'Nuevo Objetivo'} onClose={onClose}>

      <Field label={idioma === 'en' ? 'Goal' : 'Objetivo'}>
        <input
          value={titulo}
          onChange={(e: any) => setTitulo(e.target.value)}
          onKeyDown={(e: any) => e.key === 'Enter' && crear()}
          placeholder={idioma === 'en' ? 'e.g. Study 50 flashcards...' : 'Ej: Estudiar 50 flashcards...'}
          autoFocus
          style={inputStyle}
        />
      </Field>

      <Field label={idioma === 'en' ? 'Category' : 'Categoría'}>
        <div style={{ display: 'flex', gap: 8 }}>
          {CATS.map((c, i) => {
            const active = categoria === c.id;
            return (
              <button key={c.id} onClick={() => setCategoria(c.id as any)}
                style={{
                  flex: 1,
                  padding: '10px 6px',
                  borderRadius: 10,
                  border: `2.5px solid ${active ? c.color : 'var(--border-color)'}`,
                  background: active ? c.color + '22' : 'var(--bg-secondary)',
                  color: active ? c.color : 'var(--text-muted)',
                  fontFamily: HAND,
                  fontSize: 16, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: active ? `2px 3px 0 ${c.color}` : 'none',
                  transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={idioma === 'en' ? 'Size' : 'Tamaño'}>
        <div style={{ display: 'flex', gap: 8 }}>
          {TAMAÑOS.map((t, i) => {
            const active = tamaño === t.id;
            return (
              <button key={t.id} onClick={() => setTamaño(t.id)}
                style={{
                  flex: 1,
                  padding: '12px 6px',
                  borderRadius: 10,
                  border: `2.5px solid ${active ? t.color : 'var(--border-color)'}`,
                  background: active ? t.color + '20' : 'var(--bg-secondary)',
                  color: active ? t.color : 'var(--text-muted)',
                  fontFamily: HAND,
                  cursor: 'pointer',
                  textAlign: 'center',
                  boxShadow: active ? `2px 3px 0 ${t.color}` : 'none',
                  transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>{t.label}</div>
                <div style={{ fontSize: 14, marginTop: 3, fontWeight: 700, fontStyle: 'italic' }}>⭐ {t.xp} XP</div>
              </button>
            );
          })}
        </div>
      </Field>

      <ButtonRow>
        <ModalBtn variant="secondary" onClick={onClose}>
          ✕ {idioma === 'en' ? 'Cancel' : 'Cancelar'}
        </ModalBtn>
        <ModalBtn variant="primary" color="var(--pink)" onClick={crear} disabled={!titulo.trim()}>
          + {idioma === 'en' ? 'Add Goal' : 'Agregar'}
        </ModalBtn>
      </ButtonRow>
    </ModalShell>
  );
}

// ══════════════════════════════════════════════════════════════
// SHELL DE MODAL CUADERNO
// ══════════════════════════════════════════════════════════════
function ModalShell({ children, color, emoji, title, onClose }: {
  children: React.ReactNode;
  color: string;
  emoji: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
        animation: 'modalFade 0.25s ease',
      }}
    >
      <div
        onClick={(e: any) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          borderRadius: 16,
          padding: '24px 28px',
          width: '100%',
          maxWidth: 480,
          border: '2.5px solid var(--text-primary)',
          boxShadow: '6px 7px 0 var(--text-primary), 0 16px 50px rgba(0,0,0,0.45)',
          maxHeight: '92vh',
          overflowY: 'auto',
          transform: 'rotate(-0.5deg)',
          position: 'relative',
          animation: 'modalPop 0.4s cubic-bezier(.34,1.4,.64,1)',
        }}
      >
        {/* Cinta scotch arriba */}
        <div style={{
          position: 'absolute',
          top: -12, left: '50%',
          transform: 'translateX(-50%) rotate(-4deg)',
          width: 90, height: 22,
          background: `color-mix(in srgb, ${color} 55%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          zIndex: 5,
        }} />

        {/* Banda título */}
        <div style={{
          margin: '8px -28px 18px',
          padding: '10px 28px',
          background: color,
          borderTop: '2px solid var(--text-primary)',
          borderBottom: '2px solid var(--text-primary)',
        }}>
          <h2 style={{
            fontFamily: HAND,
            fontSize: 28, fontWeight: 900,
            color: '#fff',
            textShadow: '0 1px 3px rgba(0,0,0,0.35)',
            margin: 0, lineHeight: 1.1,
            transform: 'rotate(-0.8deg)',
            display: 'inline-block',
          }}>
            {emoji} {title}
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {children}
        </div>
      </div>

      <style>{`
        @keyframes modalFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes modalPop {
          0%   { transform: rotate(0deg) scale(0.85); opacity: 0; }
          60%  { transform: rotate(-0.5deg) scale(1.02); opacity: 1; }
          100% { transform: rotate(-0.5deg) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Field ──
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        fontFamily: HAND,
        fontSize: 16, fontWeight: 800,
        color: 'var(--text-muted)',
        display: 'block',
        marginBottom: 6,
        fontStyle: 'italic',
        transform: 'rotate(-0.5deg)',
        transformOrigin: 'left',
      }}>
        ✏️ {label}
      </label>
      {children}
    </div>
  );
}

// ── Botones ──
function ButtonRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 10,
      marginTop: 8,
      paddingTop: 12,
      borderTop: '1.5px dashed var(--border-color)',
    }}>
      {children}
    </div>
  );
}

function ModalBtn({ children, onClick, disabled, variant, color }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant: 'primary' | 'secondary';
  color?: string;
}) {
  const isPrimary = variant === 'primary';
  const bg = isPrimary ? (color || 'var(--blue)') : 'transparent';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: isPrimary ? 2 : 1,
        padding: '12px 16px',
        borderRadius: 12,
        border: isPrimary ? '2.5px solid var(--text-primary)' : '2.5px dashed var(--text-faint)',
        background: bg,
        color: isPrimary ? '#fff' : 'var(--text-muted)',
        fontFamily: HAND,
        fontSize: 20, fontWeight: 800,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        boxShadow: isPrimary && !disabled ? '3px 4px 0 var(--text-primary)' : 'none',
        textShadow: isPrimary ? '0 1px 2px rgba(0,0,0,0.25)' : 'none',
        transform: isPrimary ? 'rotate(-1deg)' : 'rotate(1deg)',
        transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
      }}
      onMouseEnter={(e:any)=>{
        if (!disabled) {
          e.currentTarget.style.transform = isPrimary ? 'rotate(0deg) translateY(-2px)' : 'rotate(0deg) translateY(-1px)';
          if (isPrimary) e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
        }
      }}
      onMouseLeave={(e:any)=>{
        e.currentTarget.style.transform = isPrimary ? 'rotate(-1deg)' : 'rotate(1deg)';
        if (isPrimary && !disabled) e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
      }}
    >
      {children}
    </button>
  );
}

// ── Estilos input/select ──
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '2.5px solid var(--text-primary)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontFamily: HAND,
  fontSize: 19,
  fontWeight: 600,
  boxSizing: 'border-box',
  outline: 'none',
  boxShadow: '3px 3px 0 var(--text-primary)',
  transform: 'rotate(-0.3deg)',
  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  fontSize: 18,
};