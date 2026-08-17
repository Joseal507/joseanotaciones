'use client';

import { useState } from 'react';
import { COLORES, EMOJIS } from '../../lib/storage';
import { useIdioma } from '../../hooks/useIdioma';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface ModalProps {
  onClose: () => void;
  onConfirm: (data: any) => void;
}

// ══════════════════════════════════════════════════════════════
// MODAL MATERIA
// ══════════════════════════════════════════════════════════════
export function ModalMateria({ onClose, onConfirm }: ModalProps) {
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState(COLORES[0]);
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const { tr, idioma } = useIdioma();

  return (
    <ModalShell color={color} emoji="📚" title={idioma === 'en' ? 'New Subject' : 'Nueva Materia'} onClose={onClose}>

      {/* Preview */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 12,
        background: 'var(--bg-secondary)',
        border: `2.5px dashed ${color}`,
        marginBottom: 4,
        transform: 'rotate(-0.5deg)',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: color,
          border: '2px solid var(--text-primary)',
          boxShadow: '2px 2px 0 var(--text-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, transform: 'rotate(-3deg)',
        }}>
          {emoji}
        </div>
        <div>
          <p style={{
            fontFamily: HAND, fontSize: 22, fontWeight: 900,
            color: 'var(--text-primary)', margin: 0, lineHeight: 1.05,
          }}>{nombre || '...'}</p>
          <p style={{
            fontFamily: BODY, fontSize: 13,
            color: 'var(--text-muted)',
            margin: '2px 0 0',
          }}>~ preview ~</p>
        </div>
      </div>

      {/* Nombre */}
      <Field label={tr('nombre')}>
        <input value={nombre} onChange={(e: any) => setNombre(e.target.value)}
          onKeyDown={(e: any) => e.key === 'Enter' && nombre.trim() && onConfirm({ nombre, color, emoji })}
          placeholder={idioma === 'en' ? 'e.g. Math, History...' : 'Ej: Matemáticas, Historia...'}
          autoFocus
          style={inputStyle}
        />
      </Field>

      {/* Emoji */}
      <Field label="Emoji">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => setEmoji(e)}
              style={{
                width: 38, height: 38, borderRadius: 8,
                border: `2px ${emoji === e ? 'solid' : 'dashed'} ${emoji === e ? color : 'var(--border-color)'}`,
                background: emoji === e ? color + '22' : 'transparent',
                fontSize: 19, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: emoji === e ? `2px 2px 0 ${color}` : 'none',
                transform: emoji === e ? 'rotate(-5deg) scale(1.08)' : 'rotate(0deg)',
                transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
              }}>
              {e}
            </button>
          ))}
        </div>
      </Field>

      {/* Color */}
      <Field label={tr('color')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {COLORES.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{
                width: 36, height: 36, borderRadius: '50%',
                background: c,
                border: color === c ? '3px solid var(--text-primary)' : '2px dashed var(--border-color)',
                cursor: 'pointer',
                boxShadow: color === c ? `2px 2px 0 ${c}` : 'none',
                transform: color === c ? 'rotate(-8deg) scale(1.15)' : 'rotate(0deg)',
                transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
              }} />
          ))}
        </div>
      </Field>

      <ButtonRow>
        <ModalBtn variant="secondary" onClick={onClose}>
          ✕ {tr('cancelar')}
        </ModalBtn>
        <ModalBtn variant="primary" color={color} onClick={() => nombre.trim() && onConfirm({ nombre, color, emoji })} disabled={!nombre.trim()}>
          + {idioma === 'en' ? 'Create Subject' : 'Crear Materia'}
        </ModalBtn>
      </ButtonRow>
    </ModalShell>
  );
}

// ══════════════════════════════════════════════════════════════
// MODAL TEMA
// ══════════════════════════════════════════════════════════════
export function ModalTema({ onClose, onConfirm, colorMateria }: ModalProps & { colorMateria: string }) {
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState(COLORES[2]);
  const { tr, idioma } = useIdioma();

  return (
    <ModalShell color={colorMateria} emoji="📁" title={idioma === 'en' ? 'New Topic' : 'Nuevo Tema'} onClose={onClose}>

      <Field label={tr('nombre')}>
        <input value={nombre} onChange={(e: any) => setNombre(e.target.value)}
          onKeyDown={(e: any) => e.key === 'Enter' && nombre.trim() && onConfirm({ nombre, color })}
          placeholder={idioma === 'en' ? 'e.g. Topic 1 - Introduction...' : 'Ej: Tema 1 - Introducción...'}
          autoFocus
          style={inputStyle}
        />
      </Field>

      <Field label={tr('color')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {COLORES.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{
                width: 36, height: 36, borderRadius: '50%',
                background: c,
                border: color === c ? '3px solid var(--text-primary)' : '2px dashed var(--border-color)',
                cursor: 'pointer',
                boxShadow: color === c ? `2px 2px 0 ${c}` : 'none',
                transform: color === c ? 'rotate(-8deg) scale(1.15)' : 'rotate(0deg)',
                transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
              }} />
          ))}
        </div>
      </Field>

      <ButtonRow>
        <ModalBtn variant="secondary" onClick={onClose}>
          ✕ {tr('cancelar')}
        </ModalBtn>
        <ModalBtn variant="primary" color={color} onClick={() => nombre.trim() && onConfirm({ nombre, color })} disabled={!nombre.trim()}>
          + {idioma === 'en' ? 'Create Topic' : 'Crear Tema'}
        </ModalBtn>
      </ButtonRow>
    </ModalShell>
  );
}

// ══════════════════════════════════════════════════════════════
// MODAL APUNTE — más complejo (papel, estilo, tamaño)
// ══════════════════════════════════════════════════════════════
export function ModalApunte({ onClose, onConfirm, colorTema }: ModalProps & { colorTema: string }) {
  const [titulo, setTitulo] = useState('');
  const [paperColor, setPaperColor] = useState<'white' | 'dark' | 'yellow'>('white');
  const [paperStyle, setPaperStyle] = useState<'lined' | 'grid' | 'dotted' | 'blank'>('lined');
  const [paperSize, setPaperSize] = useState('normal');
  const [scrollDirection, setScrollDirection] = useState<'vertical' | 'horizontal'>('vertical');
  const { tr, idioma } = useIdioma();

  const PAPER_COLORS: { id: 'white' | 'dark' | 'yellow'; label: string; bg: string; fg: string }[] = [
    { id: 'white',  label: idioma === 'en' ? 'White' : 'Blanco',   bg: '#ffffff', fg: '#e5e7eb' },
    { id: 'dark',   label: idioma === 'en' ? 'Dark'  : 'Oscuro',   bg: '#1e1e2e', fg: '#313146' },
    { id: 'yellow', label: idioma === 'en' ? 'Yellow': 'Amarillo', bg: '#fef7d7', fg: '#e7ddb0' },
  ];

  const PAPER_STYLES: { id: 'lined' | 'grid' | 'dotted' | 'blank'; label: string; emoji: string }[] = [
    { id: 'lined',  label: idioma === 'en' ? 'Lined'  : 'Líneas',     emoji: '📝' },
    { id: 'grid',   label: idioma === 'en' ? 'Grid'   : 'Cuadros',    emoji: '🔲' },
    { id: 'dotted', label: idioma === 'en' ? 'Dotted' : 'Puntos',     emoji: '⚫' },
    { id: 'blank',  label: idioma === 'en' ? 'Blank'  : 'Limpio',     emoji: '⬜' },
  ];

  const PAPER_SIZES = [
    { id: 'normal',  label: 'StudyAL',    desc: idioma === 'en' ? 'Default' : 'Normal' },
    { id: 'a7',      label: 'A7',         desc: '74 × 105' },
    { id: 'a6',      label: 'A6',         desc: '105 × 148' },
    { id: 'a5',      label: 'A5',         desc: '148 × 210' },
    { id: 'a4',      label: 'A4',         desc: '210 × 297' },
    { id: 'a3',      label: 'A3',         desc: '297 × 420' },
    { id: 'letter',  label: 'Letter',     desc: '8.5 × 11' },
    { id: 'tabloid', label: 'Tabloid',    desc: '11 × 17' },
    { id: 'board',   label: idioma === 'en' ? 'Board' : 'Pizarra', desc: '∞' },
  ];

  const selectedPaper = PAPER_COLORS.find(c => c.id === paperColor) || PAPER_COLORS[0];

  const renderPaperPattern = () => {
    if (paperStyle === 'blank') return null;
    if (paperStyle === 'lined') {
      return [18, 36, 54, 72, 90, 108, 126].map((y) => (
        <div key={y} style={{
          position: 'absolute', left: 0, right: 0, top: y, height: 1,
          background: selectedPaper.fg,
          opacity: paperColor === 'dark' ? 0.35 : 0.7,
        }}/>
      ));
    }
    if (paperStyle === 'grid') {
      return (
        <>
          {[20, 40, 60, 80, 100].map(x => (
            <div key={`v${x}`} style={{
              position: 'absolute', top: 0, bottom: 0,
              left: x, width: 1, background: selectedPaper.fg,
              opacity: paperColor === 'dark' ? 0.25 : 0.55,
            }}/>
          ))}
          {[20, 40, 60, 80, 100, 120, 140].map(y => (
            <div key={`h${y}`} style={{
              position: 'absolute', left: 0, right: 0,
              top: y, height: 1, background: selectedPaper.fg,
              opacity: paperColor === 'dark' ? 0.25 : 0.55,
            }}/>
          ))}
        </>
      );
    }
    if (paperStyle === 'dotted') {
      return [20, 40, 60, 80, 100].flatMap(x =>
        [20, 40, 60, 80, 100, 120, 140].map(y => (
          <div key={`${x}-${y}`} style={{
            position: 'absolute', left: x, top: y,
            width: 2, height: 2, borderRadius: '50%',
            background: selectedPaper.fg,
            opacity: paperColor === 'dark' ? 0.45 : 0.7,
          }}/>
        ))
      );
    }
    return null;
  };

  return (
    <ModalShell color={colorTema} emoji="✏️" title={idioma === 'en' ? 'Create new note' : 'Crear nuevo apunte'} onClose={onClose} maxWidth={680}>

      {/* Título */}
      <Field label={idioma === 'en' ? 'Title' : 'Título'}>
        <input value={titulo} onChange={(e: any) => setTitulo(e.target.value)}
          placeholder={idioma === 'en' ? 'Class 1, Summary...' : 'Clase 1, Resumen...'}
          autoFocus style={inputStyle}
        />
      </Field>

      {/* Color papel */}
      <Field label={idioma === 'en' ? '🎨 Paper color' : '🎨 Color del papel'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {PAPER_COLORS.map((c, i) => (
            <button key={c.id} onClick={() => setPaperColor(c.id)}
              style={{
                padding: 12, borderRadius: 12,
                border: `2.5px ${paperColor === c.id ? 'solid' : 'dashed'} ${paperColor === c.id ? colorTema : 'var(--border-color)'}`,
                background: paperColor === c.id ? colorTema + '14' : 'transparent',
                cursor: 'pointer',
                boxShadow: paperColor === c.id ? `2px 3px 0 ${colorTema}` : 'none',
                transform: paperColor === c.id ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}>
              <div style={{
                width: 50, height: 70, margin: '0 auto 8px',
                borderRadius: 6,
                background: c.bg,
                border: `1.5px solid ${c.fg}`,
                boxShadow: '2px 2px 4px rgba(0,0,0,0.15)',
                transform: 'rotate(-3deg)',
              }}/>
              <div style={{
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                color: paperColor === c.id ? colorTema : 'var(--text-muted)',
              }}>
                {c.label}
              </div>
            </button>
          ))}
        </div>
      </Field>

      {/* Estilo */}
      <Field label={idioma === 'en' ? '📐 Paper style' : '📐 Estilo del papel'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {PAPER_STYLES.map((s, i) => (
            <button key={s.id} onClick={() => setPaperStyle(s.id)}
              style={{
                padding: '12px 6px', borderRadius: 10,
                border: `2.5px ${paperStyle === s.id ? 'solid' : 'dashed'} ${paperStyle === s.id ? colorTema : 'var(--border-color)'}`,
                background: paperStyle === s.id ? colorTema + '14' : 'transparent',
                cursor: 'pointer',
                fontFamily: HAND,
                fontSize: 16, fontWeight: 800,
                color: paperStyle === s.id ? colorTema : 'var(--text-muted)',
                boxShadow: paperStyle === s.id ? `2px 3px 0 ${colorTema}` : 'none',
                transform: paperStyle === s.id ? `rotate(${i % 2 === 0 ? -1.2 : 1.2}deg)` : `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}>
              <div style={{ fontSize: 18, marginBottom: 2 }}>{s.emoji}</div>
              {s.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Tamaño */}
      <Field label={idioma === 'en' ? '📏 Paper size' : '📏 Tamaño'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {PAPER_SIZES.map((s, i) => (
            <button key={s.id} onClick={() => setPaperSize(s.id)}
              style={{
                padding: '8px 6px', borderRadius: 10,
                border: `2.5px ${paperSize === s.id ? 'solid' : 'dashed'} ${paperSize === s.id ? colorTema : 'var(--border-color)'}`,
                background: paperSize === s.id ? colorTema + '14' : 'transparent',
                cursor: 'pointer',
                boxShadow: paperSize === s.id ? `2px 3px 0 ${colorTema}` : 'none',
                transform: paperSize === s.id ? `rotate(${i % 2 === 0 ? -1.2 : 1.2}deg)` : `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}>
              <div style={{
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                color: paperSize === s.id ? colorTema : 'var(--text-primary)',
                lineHeight: 1.05,
              }}>{s.label}</div>
              <div style={{
                fontFamily: BODY, fontSize: 12,
                color: 'var(--text-faint)',
                marginTop: 2,
              }}>{s.desc}</div>
            </button>
          ))}
        </div>
      </Field>

      {/* Dirección */}
      <Field label={idioma === 'en' ? '🔄 Scroll direction' : '🔄 Sentido'}>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { id: 'vertical' as const, label: idioma === 'en' ? 'Vertical' : 'Vertical', emoji: '↕' },
            { id: 'horizontal' as const, label: idioma === 'en' ? 'Horizontal' : 'Horizontal', emoji: '↔' },
          ].map((d, i) => (
            <button key={d.id} onClick={() => setScrollDirection(d.id)}
              style={{
                flex: 1, padding: 12,
                borderRadius: 10,
                border: `2.5px ${scrollDirection === d.id ? 'solid' : 'dashed'} ${scrollDirection === d.id ? colorTema : 'var(--border-color)'}`,
                background: scrollDirection === d.id ? colorTema + '14' : 'transparent',
                cursor: 'pointer',
                fontFamily: HAND,
                fontSize: 17, fontWeight: 800,
                color: scrollDirection === d.id ? colorTema : 'var(--text-muted)',
                boxShadow: scrollDirection === d.id ? `2px 3px 0 ${colorTema}` : 'none',
                transform: scrollDirection === d.id ? `rotate(${i % 2 === 0 ? -1.2 : 1.2}deg)` : `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              <span style={{ fontSize: 20 }}>{d.emoji}</span> {d.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Preview */}
      <Field label={idioma === 'en' ? '👁️ Preview' : '👁️ Vista previa'}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <div style={{
            position: 'relative',
            width: 150, height: 190,
            transform: 'rotate(-2deg)',
          }}>
            {/* Cinta scotch arriba */}
            <div style={{
              position: 'absolute', top: -6, left: '50%',
              transform: 'translateX(-50%) rotate(-3deg)',
              width: 50, height: 14,
              background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
              border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
              zIndex: 5,
            }}/>

            <div style={{
              width: '100%', height: '100%',
              borderRadius: 8,
              background: selectedPaper.bg,
              border: `2.5px solid var(--text-primary)`,
              boxShadow: `4px 5px 0 var(--text-primary)`,
              position: 'relative', overflow: 'hidden',
            }}>
              {renderPaperPattern()}
              <div style={{
                position: 'absolute',
                bottom: 6, right: 8,
                fontFamily: HAND, fontSize: 12, fontWeight: 800,
                color: paperColor === 'dark' ? '#888' : '#666',

              }}>
                {PAPER_SIZES.find(s => s.id === paperSize)?.label}
              </div>
            </div>
          </div>
        </div>
      </Field>

      <ButtonRow>
        <ModalBtn variant="secondary" onClick={onClose}>
          ✕ {tr('cancelar')}
        </ModalBtn>
        <ModalBtn
          variant="primary"
          color={colorTema}
          onClick={() => titulo.trim() && onConfirm({ titulo, paperColor, paperStyle, paperSize, scrollDirection })}
          disabled={!titulo.trim()}
        >
          ✏️ {idioma === 'en' ? 'Create Note' : 'Crear Apunte'}
        </ModalBtn>
      </ButtonRow>
    </ModalShell>
  );
}

// ══════════════════════════════════════════════════════════════
// SHELL DE MODAL VIBRA CUADERNO
// ══════════════════════════════════════════════════════════════
function ModalShell({ children, color, emoji, title, onClose, maxWidth = 480 }: {
  children: React.ReactNode;
  color: string;
  emoji: string;
  title: string;
  onClose: () => void;
  maxWidth?: number;
}) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
      animation: 'modalFadeMd 0.25s ease',
    }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{
        background: 'var(--bg-card)',
        borderRadius: 16,
        width: '100%', maxWidth,
        border: '2.5px solid var(--text-primary)',
        boxShadow: '6px 7px 0 var(--text-primary), 0 16px 50px rgba(0,0,0,0.45)',
        maxHeight: '92vh', overflowY: 'auto',
        transform: 'rotate(-0.5deg)',
        position: 'relative',
        animation: 'modalPopMd 0.4s cubic-bezier(.34,1.4,.64,1)',
      }}>
        {/* Cinta scotch arriba */}
        <div style={{
          position: 'absolute',
          top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-4deg)',
          width: 90, height: 20,
          background: `color-mix(in srgb, ${color} 55%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          zIndex: 5,
        }} />

        {/* Banda título */}
        <div style={{
          padding: '10px 24px',
          background: color,
          borderBottom: '2px solid var(--text-primary)',
        }}>
          <h2 style={{
            fontFamily: HAND, fontSize: 28, fontWeight: 900,
            color: '#000',
            margin: 0, lineHeight: 1.1,
            transform: 'rotate(-0.8deg)', display: 'inline-block',

          }}>
            {emoji} {title}
          </h2>
        </div>

        <div style={{
          padding: '20px 24px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {children}
        </div>
      </div>

      <style>{`
        @keyframes modalFadeMd { from{opacity:0} to{opacity:1} }
        @keyframes modalPopMd {
          0% { transform: rotate(0deg) scale(0.85); opacity: 0; }
          60% { transform: rotate(-0.5deg) scale(1.02); opacity: 1; }
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
        fontFamily: HAND, fontSize: 16, fontWeight: 800,
        color: 'var(--text-muted)',
        display: 'block', marginBottom: 6,

        transform: 'rotate(-0.5deg)', transformOrigin: 'left',
      }}>
        ✏️ {label}
      </label>
      {children}
    </div>
  );
}

// ── Button row ──
function ButtonRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 10,
      marginTop: 8, paddingTop: 12,
      borderTop: '1.5px dashed var(--border-color)',
    }}>
      {children}
    </div>
  );
}

// ── Modal button ──
function ModalBtn({ children, onClick, disabled, variant, color }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant: 'primary' | 'secondary';
  color?: string;
}) {
  const isPrimary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: isPrimary ? 2 : 1,
        padding: '12px 16px',
        borderRadius: 12,
        border: isPrimary ? '2.5px solid var(--text-primary)' : '2.5px dashed var(--text-faint)',
        background: isPrimary ? (color || 'var(--gold)') : 'transparent',
        color: isPrimary ? '#000' : 'var(--text-muted)',
        fontFamily: HAND,
        fontSize: 20, fontWeight: 800,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        boxShadow: isPrimary && !disabled ? '3px 4px 0 var(--text-primary)' : 'none',
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

// ── Estilos input ──
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 10,
  border: '2.5px solid var(--text-primary)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontFamily: BODY,
  fontSize: 19, fontWeight: 600,
  outline: 'none',
  boxSizing: 'border-box',
  boxShadow: '3px 3px 0 var(--text-primary)',
  transform: 'rotate(-0.3deg)',
  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
};