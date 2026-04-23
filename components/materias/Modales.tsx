'use client';

import { useState } from 'react';
import { COLORES, EMOJIS } from '../../lib/storage';
import { useIdioma } from '../../hooks/useIdioma';

interface ModalProps {
  onClose: () => void;
  onConfirm: (data: any) => void;
}

export function ModalMateria({ onClose, onConfirm }: ModalProps) {
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState(COLORES[0]);
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const { tr, idioma } = useIdioma();

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '440px', border: '1px solid var(--border-color)' }}>
        <div style={{ height: '4px', background: color, borderRadius: '2px', marginBottom: '24px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 24px 0' }}>
          {idioma === 'en' ? 'New Subject' : 'Nueva Materia'}
        </h2>

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
          {tr('nombre').toUpperCase()}
        </label>
        <input value={nombre} onChange={e => setNombre(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && nombre.trim() && onConfirm({ nombre, color, emoji })}
          placeholder={idioma === 'en' ? 'e.g. Math, History...' : 'Ej: Matemáticas, Historia...'}
          autoFocus
          style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', boxSizing: 'border-box', outline: 'none', marginBottom: '16px' }}
        />

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>EMOJI</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => setEmoji(e)}
              style={{ width: '40px', height: '40px', borderRadius: '10px', border: `2px solid ${emoji === e ? color : 'var(--border-color)'}`, background: emoji === e ? color + '30' : 'transparent', fontSize: '20px', cursor: 'pointer' }}>
              {e}
            </button>
          ))}
        </div>

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
          {tr('color').toUpperCase()}
        </label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {COLORES.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: '36px', height: '36px', borderRadius: '50%', background: c, border: color === c ? '3px solid var(--text-primary)' : '3px solid transparent', cursor: 'pointer' }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            {tr('cancelar')}
          </button>
          <button onClick={() => nombre.trim() && onConfirm({ nombre, color, emoji })}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: color, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
            {idioma === 'en' ? 'Create Subject' : 'Crear Materia'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModalTema({ onClose, onConfirm, colorMateria }: ModalProps & { colorMateria: string }) {
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState(COLORES[2]);
  const { tr, idioma } = useIdioma();

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '400px', border: '1px solid var(--border-color)' }}>
        <div style={{ height: '4px', background: colorMateria, borderRadius: '2px', marginBottom: '24px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 24px 0' }}>
          {idioma === 'en' ? 'New Topic' : 'Nuevo Tema'}
        </h2>

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
          {tr('nombre').toUpperCase()}
        </label>
        <input value={nombre} onChange={e => setNombre(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && nombre.trim() && onConfirm({ nombre, color })}
          placeholder={idioma === 'en' ? 'e.g. Topic 1 - Introduction...' : 'Ej: Tema 1 - Introducción...'}
          autoFocus
          style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', boxSizing: 'border-box', outline: 'none', marginBottom: '16px' }}
        />

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
          {tr('color').toUpperCase()}
        </label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {COLORES.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: '36px', height: '36px', borderRadius: '50%', background: c, border: color === c ? '3px solid var(--text-primary)' : '3px solid transparent', cursor: 'pointer' }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            {tr('cancelar')}
          </button>
          <button onClick={() => nombre.trim() && onConfirm({ nombre, color })}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: color, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
            {idioma === 'en' ? 'Create Topic' : 'Crear Tema'}
          </button>
        </div>
      </div>
    </div>
  );
}


export function ModalApunte({ onClose, onConfirm, colorTema }: ModalProps & { colorTema: string }) {
  const [titulo, setTitulo] = useState('');
  const [paperColor, setPaperColor] = useState<'white' | 'dark' | 'yellow'>('white');
  const [paperStyle, setPaperStyle] = useState<'lined' | 'grid' | 'dotted' | 'blank'>('lined');
  const [paperSize, setPaperSize] = useState('normal');
  const { tr, idioma } = useIdioma();

  const PAPER_COLORS: { id: 'white' | 'dark' | 'yellow'; label: string; bg: string; fg: string }[] = [
    { id: 'white', label: idioma === 'en' ? 'White paper' : 'Papel blanco', bg: '#ffffff', fg: '#e5e7eb' },
    { id: 'dark', label: idioma === 'en' ? 'Dark paper' : 'Papel oscuro', bg: '#1e1e2e', fg: '#313146' },
    { id: 'yellow', label: idioma === 'en' ? 'Yellow paper' : 'Papel amarillo', bg: '#fef7d7', fg: '#e7ddb0' },
  ];

  const PAPER_STYLES: { id: 'lined' | 'grid' | 'dotted' | 'blank'; label: string }[] = [
    { id: 'lined', label: idioma === 'en' ? 'Lined' : 'Con líneas' },
    { id: 'grid', label: idioma === 'en' ? 'Grid' : 'Cuadriculado' },
    { id: 'dotted', label: idioma === 'en' ? 'Dotted' : 'Puntos' },
    { id: 'blank', label: idioma === 'en' ? 'Blank' : 'Limpio' },
  ];

  const PAPER_SIZES = [
    { id: 'normal', label: idioma === 'en' ? 'JoseAnotaciones Paper' : 'Papel normal de JoseAnotaciones', desc: 'Default' },
    { id: 'a7', label: 'A7', desc: '74 × 105 mm' },
    { id: 'a6', label: 'A6', desc: '105 × 148 mm' },
    { id: 'a5', label: 'A5', desc: '148 × 210 mm' },
    { id: 'a4', label: 'A4', desc: '210 × 297 mm' },
    { id: 'a3', label: 'A3', desc: '297 × 420 mm' },
    { id: 'letter', label: 'Letter', desc: '8.5 × 11 in' },
    { id: 'tabloid', label: idioma === 'en' ? 'Tabloid' : 'Tabloide', desc: '11 × 17 in' },
    { id: 'board', label: idioma === 'en' ? 'Whiteboard' : 'Pizarra', desc: idioma === 'en' ? 'Infinite style board' : 'Tablero estilo ilimitado' },
  ];

  const selectedPaper = PAPER_COLORS.find(c => c.id === paperColor) || PAPER_COLORS[0];

  const renderPaperPattern = () => {
    if (paperStyle === 'blank') return null;

    if (paperStyle === 'lined') {
      return (
        <>
          {[18, 36, 54, 72, 90, 108, 126].map((y) => (
            <div
              key={y}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: y,
                height: '1px',
                background: selectedPaper.fg,
                opacity: paperColor === 'dark' ? 0.35 : 0.7,
              }}
            />
          ))}
        </>
      );
    }

    if (paperStyle === 'grid') {
      return (
        <>
          {[20, 40, 60, 80, 100].map((x) => (
            <div
              key={`v${x}`}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${x}px`,
                width: '1px',
                background: selectedPaper.fg,
                opacity: paperColor === 'dark' ? 0.25 : 0.55,
              }}
            />
          ))}
          {[20, 40, 60, 80, 100, 120, 140].map((y) => (
            <div
              key={`h${y}`}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${y}px`,
                height: '1px',
                background: selectedPaper.fg,
                opacity: paperColor === 'dark' ? 0.25 : 0.55,
              }}
            />
          ))}
        </>
      );
    }

    if (paperStyle === 'dotted') {
      return (
        <>
          {[20, 40, 60, 80, 100].flatMap((x) =>
            [20, 40, 60, 80, 100, 120, 140].map((y) => (
              <div
                key={`${x}-${y}`}
                style={{
                  position: 'absolute',
                  left: `${x}px`,
                  top: `${y}px`,
                  width: '2px',
                  height: '2px',
                  borderRadius: '50%',
                  background: selectedPaper.fg,
                  opacity: paperColor === 'dark' ? 0.45 : 0.7,
                }}
              />
            ))
          )}
        </>
      );
    }

    return null;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: '24px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '92vh',
          overflow: 'auto',
          border: '1px solid var(--border-color)',
          boxShadow: '0 20px 80px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ height: '4px', background: `linear-gradient(90deg, ${colorTema}, #f5c842)`, borderRadius: '24px 24px 0 0' }} />
        <div style={{ padding: '28px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 24px 0' }}>
            ✏️ {idioma === 'en' ? 'Create new note' : 'Crear nuevo apunte'}
          </h2>

          {/* Título */}
          <label style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {idioma === 'en' ? 'Title' : 'Título'}
          </label>
          <input
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder={idioma === 'en' ? 'Example: Class 1, Summary...' : 'Ej: Clase 1, Resumen...'}
            autoFocus
            style={{
              width: '100%',
              padding: '13px 16px',
              borderRadius: '12px',
              border: `2px solid ${colorTema}30`,
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '15px',
              boxSizing: 'border-box',
              outline: 'none',
              marginBottom: '24px',
            }}
          />

          {/* Todos los papeles */}
          <h3 style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 12px' }}>
            {idioma === 'en' ? 'All paper colors' : 'Todos los papeles'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '24px' }}>
            {PAPER_COLORS.map(c => (
              <button
                key={c.id}
                onClick={() => setPaperColor(c.id)}
                style={{
                  padding: '12px',
                  borderRadius: '14px',
                  border: paperColor === c.id ? `2px solid ${colorTema}` : '2px solid var(--border-color)',
                  background: paperColor === c.id ? `${colorTema}10` : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: '54px',
                    height: '74px',
                    margin: '0 auto 8px',
                    borderRadius: '8px',
                    background: c.bg,
                    border: `1px solid ${c.fg}`,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                />
                <div style={{ fontSize: '11px', fontWeight: 700, color: paperColor === c.id ? colorTema : 'var(--text-muted)' }}>
                  {c.label}
                </div>
              </button>
            ))}
          </div>

          {/* Estilo */}
          <h3 style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 12px' }}>
            {idioma === 'en' ? 'Paper style' : 'Tipo de papel'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '24px' }}>
            {PAPER_STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => setPaperStyle(s.id)}
                style={{
                  padding: '12px 8px',
                  borderRadius: '12px',
                  border: paperStyle === s.id ? `2px solid ${colorTema}` : '2px solid var(--border-color)',
                  background: paperStyle === s.id ? `${colorTema}10` : 'transparent',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: paperStyle === s.id ? colorTema : 'var(--text-muted)',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Tamaños */}
          <h3 style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 12px' }}>
            {idioma === 'en' ? 'Paper size' : 'Tamaño'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '24px' }}>
            {PAPER_SIZES.map(s => (
              <button
                key={s.id}
                onClick={() => setPaperSize(s.id)}
                style={{
                  padding: '10px 8px',
                  borderRadius: '12px',
                  border: paperSize === s.id ? `2px solid ${colorTema}` : '2px solid var(--border-color)',
                  background: paperSize === s.id ? `${colorTema}10` : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 800, color: paperSize === s.id ? colorTema : 'var(--text-primary)' }}>
                  {s.label}
                </div>
                <div style={{ fontSize: '9px', color: 'var(--text-faint)', marginTop: '2px' }}>
                  {s.desc}
                </div>
              </button>
            ))}
          </div>

          {/* Preview */}
          <h3 style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 12px' }}>
            Preview
          </h3>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '28px' }}>
            <div
              style={{
                width: '140px',
                height: '180px',
                borderRadius: '10px',
                background: selectedPaper.bg,
                border: `1px solid ${selectedPaper.fg}`,
                boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {renderPaperPattern()}
              <div
                style={{
                  position: 'absolute',
                  bottom: '6px',
                  right: '8px',
                  fontSize: '8px',
                  color: selectedPaper.fg,
                  fontWeight: 700,
                }}
              >
                {PAPER_SIZES.find(s => s.id === paperSize)?.label}
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: '13px',
                borderRadius: '12px',
                border: '2px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {tr('cancelar')}
            </button>

            <button
              onClick={() => titulo.trim() && onConfirm({ titulo, paperColor, paperStyle, paperSize })}
              disabled={!titulo.trim()}
              style={{
                flex: 2,
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: titulo.trim() ? colorTema : 'var(--bg-card2)',
                color: titulo.trim() ? '#000' : 'var(--text-faint)',
                fontSize: '14px',
                fontWeight: 900,
                cursor: titulo.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              ✏️ {idioma === 'en' ? 'Create Note' : 'Crear Apunte'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
