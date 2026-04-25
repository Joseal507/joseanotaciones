'use client';

import { useState, useEffect } from 'react';
import UserMenu from './UserMenu';
import RachaWidget from './RachaWidget';
import { useDarkMode } from '../hooks/useDarkMode';
import { useIdioma } from '../hooks/useIdioma';
import { BetaBadge } from './BetaBanner';

interface Props {
  darkMode?: boolean;
  onToggleDark?: () => void;
}

export default function NavbarMobile({ darkMode: darkModeProp, onToggleDark }: Props) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const { darkMode: currentDark, toggle } = useDarkMode();
  const { tr } = useIdioma();

  const isDark = darkModeProp !== undefined ? darkModeProp : currentDark;
  const handleToggle = onToggleDark || toggle;

  const links = [
    { label: '🏠 ' + tr('inicio'), href: '/' },
    { label: '📚 ' + tr('misMaterias'), href: '/materias' },
    { label: '🌍 Comunidad', href: '/comunidad', color: '#22c55e' },
    { label: '👥 Partners', href: '/amigos', color: '#06b6d4' },
    { label: '🗓️ ' + tr('horario'), href: '/horario' },
    { label: '📅 ' + tr('agenda'), href: '/agenda' },
    { label: '🤖 JeffreyBot', href: '/chat' },
    { label: '🎓 ' + tr('quizzes'), href: '/quizzes' },
    { label: '👤 Mi Perfil Social', href: '/mi-perfil', color: '#a78bfa' },
    { label: '👤 Mi Perfil Social', href: '/mi-perfil', color: '#a78bfa' },
    { label: '📊 Stats de Estudio', href: '/perfil' },
    { label: '⚙️ ' + tr('configuracion'), href: '/settings' },
  ];

  return (
    <>
      <header style={{
        background: 'var(--bg-card)',
        borderBottom: '3px solid var(--gold)',
        padding: '0 16px',
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        height: '60px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          onClick={() => window.location.href = '/'}>
          <img src="/logo.png" alt="Logo"
            style={{ width: '34px', height: '34px', borderRadius: '8px', objectFit: 'cover' }}
            onError={(e: any) => { e.target.style.display = 'none'; }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '16px', fontWeight: 900 }}>
              <span style={{ fontSize: '85%', fontWeight: 700, color: 'var(--text-primary)' }}>Study</span>
              <span style={{ color: 'var(--gold)' }}>AL</span>
            </span>
            <BetaBadge size="sm" />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RachaWidget compact />
          <button onClick={handleToggle}
            style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', padding: '4px' }}>
            {isDark ? '☀️' : '🌙'}
          </button>
          <UserMenu />
          <button onClick={() => setMenuAbierto(!menuAbierto)}
            style={{ background: 'none', border: '2px solid var(--border-color)', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '18px' }}>
            {menuAbierto ? '✕' : '☰'}
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', height: '3px' }}>
        {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
          <div key={i} style={{ flex: 1, background: c }} />
        ))}
      </div>

      {menuAbierto && (
        <div style={{
          position: 'fixed', top: '63px', left: 0, right: 0,
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-color)',
          zIndex: 99, padding: '8px 16px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          maxHeight: 'calc(100vh - 63px)', overflowY: 'auto',
        }}>
          {links.map((link, i) => (
            <button key={i}
              onClick={() => { window.location.href = link.href; setMenuAbierto(false); }}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: '10px',
                border: 'none', background: 'transparent',
                color: (link as any).color || 'var(--text-primary)',
                fontSize: '15px', fontWeight: 600, cursor: 'pointer',
                textAlign: 'left', display: 'block', marginBottom: '2px',
              }}>
              {link.label}
            </button>
          ))}
        </div>
      )}

      {menuAbierto && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 98, top: '63px' }}
          onClick={() => setMenuAbierto(false)} />
      )}
    </>
  );
}
