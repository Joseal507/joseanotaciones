'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useIdioma } from '../hooks/useIdioma';

export default function UserMenu() {
  const [usuario, setUsuario] = useState<any>(null);
  const [abierto, setAbierto] = useState(false);
  const [perfil, setPerfil] = useState<any>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { tr } = useIdioma();

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user) return;
        setUsuario(data.user);

        try {
          const stored = localStorage.getItem('josea_perfil');
          if (stored) {
            const p = JSON.parse(stored);
            if (p && p.nombre) { setPerfil(p); return; }
          }
        } catch {}

        try {
          const res = await fetch('/api/user-profile');
          const json = await res.json();
          if (json.success && json.perfil) {
            setPerfil(json.perfil);
            localStorage.setItem('josea_perfil', JSON.stringify(json.perfil));
          }
        } catch {}
      } catch (err: any) {
        // Supabase lock conflict — retry silently after delay
        if (err?.message?.includes('lock') || err?.message?.includes('stole')) {
          setTimeout(async () => {
            try {
              const { data } = await supabase.auth.getSession();
              if (data.session?.user) setUsuario(data.session.user);
            } catch {}
          }, 800);
        }
      }
    };
    cargar();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const cerrarSesion = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/auth';
  };

  const nombre = perfil?.nombre || usuario?.user_metadata?.nombre || usuario?.email?.split('@')[0] || '?';
  const inicial = nombre.charAt(0).toUpperCase();
  const avatarUrl = perfil?.avatar_url || usuario?.user_metadata?.avatar_url;

  if (!usuario) return null;

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setAbierto(!abierto)}
        style={{
          width: '34px', height: '34px', borderRadius: '10px',
          border: '2px solid var(--gold-border)',
          background: avatarUrl ? 'transparent' : 'var(--gold-dim)',
          cursor: 'pointer', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '13px', fontWeight: 900, color: 'var(--gold)',
          transition: 'all .15s',
          padding: 0,
        }}
        onMouseEnter={(e: any) => e.currentTarget.style.borderColor = 'var(--gold)'}
        onMouseLeave={(e: any) => e.currentTarget.style.borderColor = 'var(--gold-border)'}
      >
        {avatarUrl
          ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none'; }} />
          : inicial
        }
      </button>

      {abierto && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'var(--bg-card)', border: '1px solid var(--border-color)',
          borderRadius: '14px', padding: '6px',
          minWidth: '200px', zIndex: 9999,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          animation: 'fadeInDown .15s ease',
        }}>
          {/* User info */}
          <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border-color)', marginBottom: '4px' }}>
            <p style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</p>
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{usuario.email}</p>
          </div>

          {/* Links */}
          {[
            { label: '📊 ' + tr('perfil'), href: '/perfil' },
            { label: '⚙️ ' + tr('configuracion'), href: '/settings' },
            { label: '📚 ' + tr('misMaterias'), href: '/materias' },
          ].map((item, i) => (
            <button key={i}
              onClick={() => { window.location.href = item.href; setAbierto(false); }}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: '8px',
                border: 'none', background: 'transparent',
                color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600,
                cursor: 'pointer', textAlign: 'left', display: 'block',
                transition: 'background .15s',
              }}
              onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}
            >
              {item.label}
            </button>
          ))}

          <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />

          <button
            onClick={cerrarSesion}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: '8px',
              border: 'none', background: 'transparent',
              color: 'var(--red)', fontSize: '13px', fontWeight: 700,
              cursor: 'pointer', textAlign: 'left', display: 'block',
              transition: 'background .15s',
            }}
            onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--red-dim)'}
            onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}
          >
            🚪 {tr('cerrarSesion') || 'Cerrar sesión'}
          </button>
        </div>
      )}

      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
