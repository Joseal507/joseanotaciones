'use client';

import { useState } from 'react';
import { COLORES, EMOJIS } from '../../lib/storage';

interface ModalProps {
  onClose: () => void;
  onConfirm: (data: any) => void;
}

export function ModalMateria({ onClose, onConfirm }: ModalProps) {
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState(COLORES[0]);
  const [emoji, setEmoji] = useState(EMOJIS[0]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '440px', border: '1px solid var(--border-color)' }}>
        <div style={{ height: '4px', background: color, borderRadius: '2px', marginBottom: '24px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 24px 0' }}>Nueva Materia</h2>

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>NOMBRE</label>
        <input
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && nombre.trim() && onConfirm({ nombre, color, emoji })}
          placeholder="Ej: Matemáticas, Historia..."
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

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>COLOR</label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {COLORES.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: '36px', height: '36px', borderRadius: '50%', background: c, border: color === c ? '3px solid var(--text-primary)' : '3px solid transparent', cursor: 'pointer' }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={() => nombre.trim() && onConfirm({ nombre, color, emoji })}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: color, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
            Crear Materia
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModalTema({ onClose, onConfirm, colorMateria }: ModalProps & { colorMateria: string }) {
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState(COLORES[2]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '400px', border: '1px solid var(--border-color)' }}>
        <div style={{ height: '4px', background: colorMateria, borderRadius: '2px', marginBottom: '24px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 24px 0' }}>Nuevo Tema</h2>

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>NOMBRE</label>
        <input
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && nombre.trim() && onConfirm({ nombre, color })}
          placeholder="Ej: Tema 1 - Introducción..."
          autoFocus
          style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', boxSizing: 'border-box', outline: 'none', marginBottom: '16px' }}
        />

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>COLOR</label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {COLORES.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: '36px', height: '36px', borderRadius: '50%', background: c, border: color === c ? '3px solid var(--text-primary)' : '3px solid transparent', cursor: 'pointer' }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={() => nombre.trim() && onConfirm({ nombre, color })}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: color, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
            Crear Tema
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModalApunte({ onClose, onConfirm, colorTema }: ModalProps & { colorTema: string }) {
  const [titulo, setTitulo] = useState('');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '400px', border: '1px solid var(--border-color)' }}>
        <div style={{ height: '4px', background: colorTema, borderRadius: '2px', marginBottom: '24px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 24px 0' }}>Nuevo Apunte</h2>

        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>TÍTULO</label>
        <input
          value={titulo}
          onChange={e => setTitulo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && titulo.trim() && onConfirm({ titulo })}
          placeholder="Ej: Clase 1, Resumen..."
          autoFocus
          style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', boxSizing: 'border-box', outline: 'none', marginBottom: '24px' }}
        />

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={() => titulo.trim() && onConfirm({ titulo })}
            style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: colorTema, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
            Crear Apunte
          </button>
        </div>
      </div>
    </div>
  );
}