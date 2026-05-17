'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

const HAND = "'Caveat',cursive";

interface Notif {
  id: string;
  tipo: 'chat' | 'partner' | 'comunidad' | 'news' | 'logro' | 'daily';
  titulo: string;
  desc: string;
  emoji: string;
  color: string;
  href: string;
  fecha: string;
  leida: boolean;
}

const STORAGE_KEY = 'studyal_notif_leidas';

function getLeidas(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function setLeidas(ids: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids])); } catch {}
}

export default function NotificacionesPanel() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  const cargar = async () => {
    setLoading(true);
    const out: Notif[] = [];
    const leidas = getLeidas();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setNotifs([]); setLoading(false); return; }

      // 1) Chats — mensajes de partners no leídos
      try {
        const { data: msgs } = await supabase
          .from('partner_messages')
          .select('id, contenido, remitente_id, created_at')
          .neq('remitente_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5);
        if (msgs) msgs.forEach((m: any) => {
          out.push({
            id: `chat-${m.id}`,
            tipo: 'chat',
            titulo: '💬 Nuevo mensaje',
            desc: (m.contenido || '').substring(0, 60),
            emoji: '💬',
            color: 'var(--blue)',
            href: '/partners',
            fecha: m.created_at,
            leida: leidas.has(`chat-${m.id}`),
          });
        });
      } catch {}

      // 2) Solicitudes de amistad partners
      try {
        const { data: reqs } = await supabase
          .from('partner_requests')
          .select('id, sender_id, sender_nombre, created_at, status')
          .eq('receiver_id', user.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(5);
        if (reqs) reqs.forEach((r: any) => {
          out.push({
            id: `req-${r.id}`,
            tipo: 'partner',
            titulo: '🤝 Solicitud de partner',
            desc: `${r.sender_nombre || 'Alguien'} quiere ser tu partner`,
            emoji: '🤝',
            color: '#22c55e',
            href: '/partners',
            fecha: r.created_at,
            leida: leidas.has(`req-${r.id}`),
          });
        });
      } catch {}

      // 3) Comentarios en mis posts de comunidad
      try {
        const { data: posts } = await supabase
          .from('comunidad_posts')
          .select('id')
          .eq('user_id', user.id)
          .limit(20);
        if (posts && posts.length > 0) {
          const postIds = posts.map((p: any) => p.id);
          const { data: comments } = await supabase
            .from('comunidad_comentarios')
            .select('id, post_id, usuario_nombre, contenido, created_at')
            .in('post_id', postIds)
            .neq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(5);
          if (comments) comments.forEach((c: any) => {
            out.push({
              id: `com-${c.id}`,
              tipo: 'comunidad',
              titulo: '💬 Comentario nuevo',
              desc: `${c.usuario_nombre}: ${(c.contenido || '').substring(0, 50)}`,
              emoji: '💬',
              color: '#a855f7',
              href: `/comunidad/${c.post_id}`,
              fecha: c.created_at,
              leida: leidas.has(`com-${c.id}`),
            });
          });
        }
      } catch {}

      // 4) News recientes
      try {
        const { data: news } = await supabase
          .from('news_articulos')
          .select('id, titulo, created_at')
          .order('created_at', { ascending: false })
          .limit(3);
        if (news) news.forEach((n: any) => {
          out.push({
            id: `news-${n.id}`,
            tipo: 'news',
            titulo: '📰 Nueva noticia',
            desc: n.titulo,
            emoji: '📰',
            color: '#f97316',
            href: '/news',
            fecha: n.created_at,
            leida: leidas.has(`news-${n.id}`),
          });
        });
      } catch {}

      // 5) Daily reward disponible
      try {
        const DAILY_KEY = 'studyal_daily_reward_date';
        const last = localStorage.getItem(DAILY_KEY);
        const hoy = new Date().toDateString();
        if (last !== hoy) {
          out.push({
            id: `daily-${hoy}`,
            tipo: 'daily',
            titulo: '🎁 Recompensa diaria',
            desc: '¡Tu daily reward está listo!',
            emoji: '🎁',
            color: 'var(--gold)',
            href: '/',
            fecha: new Date().toISOString(),
            leida: leidas.has(`daily-${hoy}`),
          });
        }
      } catch {}

    } catch {}

    // Ordenar por fecha desc
    out.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    setNotifs(out.slice(0, 15));
    setLoading(false);
  };

  useEffect(() => {
    cargar();
    const iv = setInterval(cargar, 60000); // refrescar cada minuto
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const noLeidas = notifs.filter(n => !n.leida).length;

  const abrirNotif = (n: Notif) => {
    const leidas = getLeidas();
    leidas.add(n.id);
    setLeidas(leidas);
    setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, leida: true } : x));
    setAbierto(false);
    try { (window as any).__showNavLoader?.(n.href); } catch {}
    try { router.push(n.href); } catch { window.location.href = n.href; }
  };

  const marcarTodas = () => {
    const leidas = getLeidas();
    notifs.forEach(n => leidas.add(n.id));
    setLeidas(leidas);
    setNotifs(prev => prev.map(n => ({ ...n, leida: true })));
  };

  const tiempoRelativo = (fecha: string) => {
    const diff = Date.now() - new Date(fecha).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  };

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Botón campana */}
      <button
        onClick={() => setAbierto(!abierto)}
        style={{
          width: 42, height: 42, borderRadius: 10,
          border: '2.5px solid var(--text-primary)',
          background: noLeidas > 0 ? 'var(--gold)' : 'var(--bg-card)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
          boxShadow: abierto ? '3px 4px 0 var(--gold)' : '2px 2px 0 var(--text-primary)',
          transform: abierto ? 'rotate(0)' : 'rotate(2deg)',
          transition: 'all .2s',
          position: 'relative',
          padding: 0,
        }}
        title="Notificaciones"
      >
        🔔
        {noLeidas > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6,
            background: 'var(--red)', color: '#fff',
            fontFamily: HAND, fontSize: 11, fontWeight: 900,
            minWidth: 18, height: 18, padding: '0 5px',
            borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--bg-primary)',
            animation: 'notifBounce 1.4s ease-in-out infinite',
          }}>
            {noLeidas > 9 ? '9+' : noLeidas}
          </span>
        )}
      </button>

      {abierto && (
        <>
          <div onClick={() => setAbierto(false)} style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(0,0,0,.3)', backdropFilter: 'blur(4px)',
          }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 12px)', right: 0,
            width: 340, maxHeight: 480,
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 14,
            boxShadow: '6px 7px 0 var(--gold), 0 16px 50px rgba(0,0,0,.4)',
            zIndex: 9999,
            display: 'flex', flexDirection: 'column',
            transform: 'rotate(-.5deg)',
            animation: 'notifSlide .25s cubic-bezier(.34,1.4,.64,1)',
            overflow: 'hidden',
          }}>
            {/* Cinta */}
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(-3deg)',
              width: 80, height: 18,
              background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
              border: '1px solid color-mix(in srgb, var(--gold) 35%, transparent)',
              boxShadow: '0 2px 5px rgba(0,0,0,.18)',
              zIndex: 5,
            }}/>

            {/* Header */}
            <div style={{
              padding: '14px 16px 10px',
              borderBottom: '2px dashed var(--border-color)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h3 style={{
                fontFamily: HAND, fontSize: 22, fontWeight: 900,
                color: 'var(--text-primary)', margin: 0,
                transform: 'rotate(-1deg)',
              }}>
                🔔 Notificaciones
              </h3>
              {noLeidas > 0 && (
                <button onClick={marcarTodas} style={{
                  background: 'transparent',
                  border: '1.5px dashed var(--gold)',
                  borderRadius: 6, padding: '3px 8px',
                  fontFamily: HAND, fontSize: 12, fontWeight: 700,
                  color: 'var(--gold)', cursor: 'pointer',
                }}>
                  ✓ todas leídas
                </button>
              )}
            </div>

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {loading ? (
                <p style={{ fontFamily: HAND, fontSize: 15, color: 'var(--text-muted)', textAlign: 'center', padding: 20, fontStyle: 'italic' }}>
                  ~ cargando... ~
                </p>
              ) : notifs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 20px' }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>🌟</div>
                  <p style={{ fontFamily: HAND, fontSize: 17, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
                    ~ todo al día ~
                  </p>
                </div>
              ) : (
                notifs.map((n, i) => (
                  <div key={n.id}
                    onClick={() => abrirNotif(n)}
                    style={{
                      padding: '10px 12px', marginBottom: 6,
                      borderRadius: 9,
                      border: `2px dashed ${n.leida ? 'transparent' : n.color}`,
                      background: n.leida ? 'transparent' : `color-mix(in srgb, ${n.color} 10%, transparent)`,
                      cursor: 'pointer',
                      display: 'flex', gap: 10,
                      transition: 'all .2s',
                      transform: `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                    }}
                    onMouseEnter={(e: any) => {
                      e.currentTarget.style.transform = 'rotate(0deg) translateX(2px)';
                      e.currentTarget.style.background = `color-mix(in srgb, ${n.color} 18%, transparent)`;
                    }}
                    onMouseLeave={(e: any) => {
                      e.currentTarget.style.transform = `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`;
                      e.currentTarget.style.background = n.leida ? 'transparent' : `color-mix(in srgb, ${n.color} 10%, transparent)`;
                    }}
                  >
                    <div style={{ fontSize: 22, flexShrink: 0 }}>{n.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', gap: 6,
                      }}>
                        <p style={{
                          fontFamily: HAND, fontSize: 16, fontWeight: 800,
                          color: n.color, margin: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{n.titulo}</p>
                        <span style={{
                          fontFamily: HAND, fontSize: 12, color: 'var(--text-faint)',
                          flexShrink: 0, fontStyle: 'italic',
                        }}>{tiempoRelativo(n.fecha)}</span>
                      </div>
                      <p style={{
                        fontFamily: HAND, fontSize: 14,
                        color: 'var(--text-muted)', margin: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      }}>{n.desc}</p>
                    </div>
                    {!n.leida && (
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: n.color, marginTop: 6, flexShrink: 0,
                      }}/>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes notifBounce {
          0%, 100% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.15) rotate(-5deg); }
        }
        @keyframes notifSlide {
          0% { opacity: 0; transform: translateY(-12px) rotate(0deg) scale(.96); }
          100% { opacity: 1; transform: translateY(0) rotate(-.5deg) scale(1); }
        }
      `}</style>
    </div>
  );
}
