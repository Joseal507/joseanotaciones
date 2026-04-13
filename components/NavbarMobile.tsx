'use client';

import { useState, useEffect } from 'react';
import UserMenu from './UserMenu';
import RachaWidget from './RachaWidget';
import { useDarkMode } from '../hooks/useDarkMode';

interface Props {
  darkMode?: boolean;
  onToggleDark?: () => void;
}

export default function NavbarMobile({ darkMode: darkModeProp, onToggleDark }: Props) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [appNombre, setAppNombre] = useState('JoseAnotaciones');
  const { darkMode: currentDark, toggle } = useDarkMode();

  const isDark = darkModeProp !== undefined ? darkModeProp : currentDark;
  const handleToggle = onToggleDark || toggle;

  useEffect(() => {
    try {
      const s = localStorage.getItem('josea_settings');
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed.nombreApp) setAppNombre(parsed.nombreApp);
      }
    } catch {}
  }, []);

  const links = [
    { label: '🏠 Inicio', href: '/' },
    { label: '📚 Mis Materias', href: '/materias' },
    { label: '🗓️ Horario', href: '/horario' },
    { label: '📅 Agenda', href: '/agenda' },
    { label: '🤖 AlciBot', href: '/chat' },
    { label: '🎓 Quizzes y Decks', href: '/quizzes' },
    { label: '📊 Mi Perfil', href: '/perfil' },
    { label: '⚙️ Configuración', href: '/settings' },
  ];

  return (
    <>
      <header style={{
        background: 'var(--bg-card)',
        borderBottom: '3px solid var(--gold)',
        padding: '0 16px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '60px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          onClick={() => window.location.href = '/'}>
          <img src="/logo.png" alt="Logo"
            style={{ width: '34px', height: '34px', borderRadius: '8px', objectFit: 'cover' }}
            onError={(e: any) => { e.target.style.display = 'none'; }}
          />
          <span style={{ fontSize: '16px', fontWeight: 900, color: 'var(--text-primary)' }}>
            {appNombre}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RachaWidget compact />
          <button onClick={handleToggle}
            style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', padding: '4px' }}>
            {isDark ? '☀️' : '🌙'}
          </button>
          <UserMenu />
          <button
            onClick={() => setMenuAbierto(!menuAbierto)}
            style={{ background: 'none', border: '2px solid var(--border-color)', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '18px' }}>
            {menuAbierto ? '✕' : '☰'}
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', height: '3px' }}>
        <div style={{ flex: 1, background: 'var(--gold)' }} />
        <div style={{ flex: 1, background: 'var(--red)' }} />
        <div style={{ flex: 1, background: 'var(--blue)' }} />
        <div style={{ flex: 1, background: 'var(--pink)' }} />
      </div>

      {menuAbierto && (
        <div style={{
          position: 'fixed',
          top: '63px',
          left: 0,
          right: 0,
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-color)',
          zIndex: 99,
          padding: '8px 16px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {links.map((link, i) => (
            <button key={i}
              onClick={() => { window.location.href = link.href; setMenuAbierto(false); }}
              style={{ width: '100%', padding: '14px 16px', borderRadius: '10px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', display: 'block', marginBottom: '2px', transition: 'all 0.15s' }}
              onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}>
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