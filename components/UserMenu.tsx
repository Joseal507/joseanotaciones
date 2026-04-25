'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useIdioma } from '../hooks/useIdioma';
import { getSettings } from '../lib/settings';

export default function UserMenu() {
  const [usuario, setUsuario] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [fotoPerfil, setFotoPerfil] = useState('');
  const { tr } = useIdioma();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUsuario(data.user);
    });
    const settings = getSettings();
    setFotoPerfil(settings.fotoPerfil || '');
  }, []);

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth';
  };

  if (!usuario) return null;

  const nombre = usuario.user_metadata?.nombre || usuario.email?.split('@')[0] || 'Usuario';
  const inicial = nombre.charAt(0).toUpperCase();

  const Avatar = ({ size = 28 }: { size?: number }) => (
    <div style={{
      width: size + 'px', height: size + 'px', borderRadius: '50%',
      overflow: 'hidden', flexShrink: 0,
      background: fotoPerfil ? 'transparent' : 'var(--gold)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.46) + 'px', fontWeight: 900, color: '#000',
    }}>
      {fotoPerfil ? (
        <img src={fotoPerfil} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        inicial
      )}
    </div>
  );

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '6px 12px', borderRadius: '10px',
          border: '2px solid var(--border-color)',
          background: 'transparent', cursor: 'pointer', transition: 'all 0.2s',
        }}
        onMouseEnter={(e: any) => e.currentTarget.style.borderColor = 'var(--gold)'}
        onMouseLeave={(e: any) => e.currentTarget.style.borderColor = 'var(--border-color)'}
      >
        <Avatar size={28} />
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nombre}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>▼</span>
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '8px',
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: '14px', padding: '8px', minWidth: '210px', zIndex: 999,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Avatar size={36} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{usuario.email}</p>
                </div>
              </div>
            </div>

            {[
              { label: '👤 Mi Perfil Social', href: '/mi-perfil' },
              { label: '📊 Stats de Estudio', href: '/perfil' },
              { label: '📚 ' + tr('misMaterias'), href: '/materias' },
              { label: '📅 ' + tr('agenda'), href: '/agenda' },
              { label: '🎓 ' + tr('quizzes'), href: '/quizzes' },
              { label: '⚙️ ' + tr('configuracion'), href: '/settings' },
            ].map((item, i) => (
              <button key={i}
                onClick={() => { window.location.href = item.href; setOpen(false); }}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', display: 'block' }}
                onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}>
                {item.label}
              </button>
            ))}

            <div style={{ height: '1px', background: 'var(--border-color)', margin: '6px 0' }} />

            <button onClick={cerrarSesion}
              style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--red)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
              onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--red-dim)'}
              onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}>
              🚪 {tr('cerrarSesion')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}