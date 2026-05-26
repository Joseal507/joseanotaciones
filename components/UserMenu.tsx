'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { useIdioma } from '../hooks/useIdioma';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";
const ADMIN_EMAIL = 'jose.alberto.deobaldia@gmail.com';

export default function UserMenu() {
  const [usuario, setUsuario] = useState<any>(null);
  const [abierto, setAbierto] = useState(false);
  const [perfil, setPerfil] = useState<any>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { tr } = useIdioma();
  const router = useRouter();

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user) return;
        setUsuario(data.user);
        // Cargar del localStorage como cache temporal
        try {
          const stored = localStorage.getItem('josea_perfil');
          if (stored) {
            const p = JSON.parse(stored);
            if (p && p.nombre) setPerfil(p);
          }
        } catch {}

        // SIEMPRE refrescar del servidor (para tener avatar actualizado)
        try {
          const res = await fetch(`/api/user-profile?userId=${data.user.id}`);
          const json = await res.json();
          if (json.success && json.data) {
            setPerfil(json.data);
            localStorage.setItem('josea_perfil', JSON.stringify(json.data));
          }
        } catch {}

        // Fallback: si no hay perfil pero hay avatar en leaderboard
        try {
          const { data: lb } = await supabase
            .from('leaderboard')
            .select('avatar_url, nombre')
            .eq('user_id', data.user.id)
            .single();
          if (lb?.avatar_url) {
            setPerfil((prev: any) => ({ ...(prev || {}), avatar_url: lb.avatar_url, nombre: prev?.nombre || lb.nombre }));
          }
        } catch {}
      } catch {}
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
    try { await supabase.auth.signOut(); } catch {}
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    ((window as any).__showNavLoader?.('/auth'), window.location.replace('/auth'));
  };

  const nombre = perfil?.nombre || usuario?.user_metadata?.nombre || usuario?.email?.split('@')[0] || '?';
  const inicial = nombre.charAt(0).toUpperCase();
  const avatarUrl = perfil?.avatar_url || usuario?.user_metadata?.avatar_url;
  const isAdmin = usuario?.email?.toLowerCase() === ADMIN_EMAIL;

  // Mostrar placeholder mientras carga
  if (!usuario) {
    return (
      <div style={{
        width: 42, height: 42, borderRadius: 10,
        border: '2.5px dashed var(--border-color)',
        background: 'var(--bg-card)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '2px 2px 0 var(--border-color)',
        transform: 'rotate(-2deg)',
        animation: 'umPulse 1.5s ease-in-out infinite',
      }}>
        <span style={{ fontSize: 16, opacity: .4 }}>👤</span>
        <style>{`@keyframes umPulse { 0%,100%{opacity:1} 50%{opacity:.6} }`}</style>
      </div>
    );
  }

  const navTo = (href: string) => {
    try { (window as any).__showNavLoader?.(href); } catch {}
    setAbierto(false);
    try { router.push(href); } catch { window.location.href = href; }
  };

  const links = [
    { label: 'Configuración', emoji: '⚙️', href: '/settings',  color: 'var(--pink)',  rot: -2,  desc: 'Tema, idioma, notificaciones y más' },
    { label: 'Mi Perfil',     emoji: '👤', href: '/perfil',    color: 'var(--gold)',  rot: 1.5, desc: 'Tu información, stats y carta de jugador' },
    { label: 'Mis Materias',  emoji: '📚', href: '/materias',  color: 'var(--blue)',  rot: -1.5,desc: 'Tus materias, apuntes y flashcards' },
    { label: 'Comunidad',     emoji: '💬', href: '/comunidad', color: '#a855f7',      rot: 2,   desc: 'Posts, blinks y comentarios' },
    { label: 'Partners',      emoji: '🤝', href: '/partners',  color: '#22c55e',      rot: -2,  desc: 'Encuentra partners de estudio' },
    { label: 'News',          emoji: '📰', href: '/news',      color: '#f97316',      rot: 1.5, desc: 'Noticias oficiales de StudyAL' },
  ];

  if (isAdmin) {
    links.push({ label: 'Admin Panel', emoji: '👑', href: '/news?admin=1', color: '#dc2626', rot: -1, desc: 'Publicar y gestionar noticias' });
  }

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      {/* Botón avatar (sin tooltip) */}
      <button
        onClick={() => setAbierto(!abierto)}
        style={{
          width: 42, height: 42, borderRadius: 10,
          border: '2.5px solid var(--text-primary)',
          background: avatarUrl ? '#000' : 'var(--gold)',
          cursor: 'pointer', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 900, color: '#000',
          fontFamily: HAND,
          transition: 'all .2s',
          padding: 0,
          boxShadow: abierto ? '3px 4px 0 var(--gold)' : '2px 2px 0 var(--text-primary)',
          transform: abierto ? 'rotate(0)' : 'rotate(-2deg)',
        }}
      >
        {avatarUrl ? (
          <>
            <img
              src={avatarUrl}
              alt={nombre}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e: any) => {
                e.currentTarget.style.display = 'none';
                const fb = e.currentTarget.nextElementSibling;
                if (fb) (fb as HTMLElement).style.display = 'flex';
              }}
            />
            <span style={{
              display: 'none',
              width: '100%', height: '100%',
              alignItems: 'center', justifyContent: 'center',
              background: 'var(--gold)', color: '#000',
              fontFamily: HAND, fontSize: 18, fontWeight: 900,
            }}>{inicial}</span>
          </>
        ) : inicial}
      </button>

      {/* Dropdown */}
      {abierto && (
        <>
          <div onClick={() => setAbierto(false)} style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(0,0,0,.3)', backdropFilter: 'blur(4px)',
          }}/>

          <div style={{
            position: 'absolute', top: 'calc(100% + 12px)', right: 0,
            width: 320,
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 14,
            padding: '14px 14px 12px',
            zIndex: 9999,
            boxShadow: '6px 7px 0 var(--gold), 0 16px 50px rgba(0,0,0,.4)',
            animation: 'umSlide .25s cubic-bezier(.34,1.4,.64,1)',
            transform: 'rotate(-.5deg)',
          }}>
            {/* Cinta scotch */}
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(-3deg)',
              width: 80, height: 18,
              background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
              border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
              boxShadow: '0 2px 5px rgba(0,0,0,.18)',
              zIndex: 5,
            }}/>

            {/* User info */}
            <div style={{
              padding: '10px 12px 12px',
              borderBottom: '2px dashed var(--border-color)',
              marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 10,
                border: '2.5px solid var(--text-primary)',
                background: avatarUrl ? '#000' : 'var(--gold)',
                overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: HAND, fontSize: 22, fontWeight: 900, color: '#000',
                boxShadow: '2px 3px 0 var(--gold)',
                transform: 'rotate(-3deg)',
                flexShrink: 0,
              }}>
                {avatarUrl
                  ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                  : inicial}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontFamily: HAND, fontSize: 20, fontWeight: 900,
                  color: 'var(--text-primary)', margin: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  transform: 'rotate(-1deg)', display: 'inline-block',
                }}>{nombre}</p>
                <p style={{
                  fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                  color: 'var(--text-faint)', margin: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{usuario.email}</p>
                {isAdmin && (
                  <span style={{
                    display: 'inline-block', marginTop: 2,
                    padding: '1px 7px', borderRadius: 5,
                    background: '#dc2626', color: '#fff',
                    border: '1.5px solid var(--text-primary)',
                    fontFamily: HAND, fontSize: 11, fontWeight: 900,
                    boxShadow: '1px 1px 0 var(--text-primary)',
                    transform: 'rotate(-3deg)',
                  }}>👑 ADMIN</span>
                )}
              </div>
            </div>

            {/* Links con descripción tipo postit a la izquierda */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
              {links.map((item, i) => {
                const isHover = hoverIdx === i;
                return (
                  <div key={i} style={{ position: 'relative' }}>
                    {/* Postit descripción a la izquierda */}
                    {isHover && (
                      <div style={{
                        position: 'absolute',
                        right: 'calc(100% + 14px)',
                        top: '50%',
                        transform: 'translateY(-50%) rotate(-2deg)',
                        width: 200,
                        background: `color-mix(in srgb, ${item.color} 22%, var(--bg-card))`,
                        border: `2.5px solid ${item.color}`,
                        boxShadow: `3px 4px 0 ${item.color}`,
                        borderRadius: 9,
                        padding: '8px 12px',
                        fontFamily: HAND,
                        fontSize: 14,
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        fontStyle: 'italic',
                        zIndex: 100,
                        animation: 'umDescPop .15s ease',
                        lineHeight: 1.25,
                      }}>
                        <div style={{
                          fontWeight: 900, fontSize: 16, color: item.color,
                          marginBottom: 2, fontStyle: 'normal',
                        }}>
                          {item.emoji} {item.label}
                        </div>
                        <div style={{ opacity: .85 }}>
                          ~ {item.desc} ~
                        </div>
                        {/* Flecha apuntando a la opción */}
                        <div style={{
                          position: 'absolute',
                          top: '50%', right: -10,
                          transform: 'translateY(-50%)',
                          width: 0, height: 0,
                          borderTop: '8px solid transparent',
                          borderBottom: '8px solid transparent',
                          borderLeft: `10px solid ${item.color}`,
                        }}/>
                      </div>
                    )}

                    <button
                      onClick={() => navTo(item.href)}
                      onMouseEnter={() => setHoverIdx(i)}
                      onMouseLeave={() => setHoverIdx(null)}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 9,
                        border: '2px dashed transparent',
                        background: isHover ? `color-mix(in srgb,${item.color} 14%,transparent)` : 'transparent',
                        borderColor: isHover ? item.color : 'transparent',
                        fontFamily: HAND, fontSize: 17, fontWeight: 700,
                        color: 'var(--text-primary)',
                        cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 10,
                        transition: 'background .15s, border-color .15s, transform .15s',
                        transform: isHover
                          ? `rotate(${item.rot}deg) translateX(4px)`
                          : `rotate(${i % 2 === 0 ? -.2 : .2}deg)`,
                      }}
                    >
                      <span style={{ fontSize: 18 }}>{item.emoji}</span>
                      <span>{item.label}</span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Divider */}
            <div style={{
              height: 2, margin: '10px 4px',
              background: 'repeating-linear-gradient(90deg,var(--text-primary) 0,var(--text-primary) 6px,transparent 6px,transparent 12px)',
            }}/>

            {/* Cerrar sesión */}
            <button
              onClick={cerrarSesion}
              onMouseEnter={(e: any) => {
                e.currentTarget.style.background = 'color-mix(in srgb,var(--red) 14%,transparent)';
                e.currentTarget.style.borderColor = 'var(--red)';
                e.currentTarget.style.transform = 'rotate(-1.5deg) translateX(4px)';
              }}
              onMouseLeave={(e: any) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
                e.currentTarget.style.transform = 'rotate(.3deg)';
              }}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 9,
                border: '2px dashed transparent',
                background: 'transparent',
                fontFamily: HAND, fontSize: 17, fontWeight: 800,
                color: 'var(--red)',
                cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 10,
                transition: 'all .15s',
                transform: 'rotate(.3deg)',
              }}
            >
              <span style={{ fontSize: 18 }}>🚪</span>
              <span>Cerrar sesión</span>
            </button>
          </div>
        </>
      )}

      <style>{`
        @keyframes umSlide {
          0% { opacity: 0; transform: translateY(-12px) rotate(0deg) scale(.96); }
          100% { opacity: 1; transform: translateY(0) rotate(-.5deg) scale(1); }
        }
        @keyframes umDescPop {
          from { opacity: 0; transform: translateY(-50%) rotate(-2deg) translateX(8px); }
          to   { opacity: 1; transform: translateY(-50%) rotate(-2deg) translateX(0); }
        }
      `}</style>
    </div>
  );
}