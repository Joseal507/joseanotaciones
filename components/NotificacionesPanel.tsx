'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from 'next-auth/react';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Notif {
  id: string;
  tipo: 'chat' | 'partner' | 'comunidad' | 'news' | 'daily';
  titulo: string;
  desc: string;
  emoji: string;
  color: string;
  href: string;
  fecha: string;
  leida: boolean;
}

const STORAGE_KEY = 'studyal_notif_leidas';
const DAILY_KEY = 'studyal_daily_reward_date';

function getLeidas(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch { return new Set(); }
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
      const session: any = await getSession();
      const user = session?.user;
      if (!user?.id) { setNotifs([]); setLoading(false); return; }

      // (daily reward removido del buzón)

      // ── 2) Partners via API (/api/partners) ──
      let partnersApi: any = null;
      try {
        {
          const res = await fetch('/api/partners', { credentials: 'same-origin' });
          if (res.ok) {
            partnersApi = await res.json();

            // Solicitudes que me llegaron
            (partnersApi?.solicitudes || []).forEach((r: any) => {
              const id = 'req-' + r.id;
              const nombre = r.partner?.nombre || 'Alguien';
              out.push({
                id,
                tipo: 'partner',
                titulo: '🤝 Solicitud de partner',
                desc: nombre + ' quiere ser tu partner de estudio',
                emoji: '🤝',
                color: '#22c55e',
                href: '/partners',
                fecha: r.created_at,
                leida: leidas.has(id),
              });
            });

            // Solicitudes enviadas por mí que siguen pendientes
            (partnersApi?.enviadas || []).forEach((r: any) => {
              const id = 'sent-' + r.id;
              const nombre = r.partner?.nombre || 'alguien';
              out.push({
                id,
                tipo: 'partner',
                titulo: '🕓 Solicitud pendiente',
                desc: 'Tu solicitud a ' + nombre + ' sigue pendiente',
                emoji: '🕓',
                color: '#16a34a',
                href: '/partners',
                fecha: r.created_at,
                leida: leidas.has(id),
              });
            });

            // Partners aceptados recientemente
            const hace7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
            (partnersApi?.partners || []).forEach((r: any) => {
              const fecha = r.updated_at || r.created_at;
              if (!fecha) return;
              if (new Date(fecha).getTime() < hace7d) return;

              const id = 'accepted-' + r.id;
              const nombre = r.partner?.nombre || 'Tu partner';
              out.push({
                id,
                tipo: 'partner',
                titulo: '✅ Nuevo partner',
                desc: nombre + ' ahora es tu partner de estudio',
                emoji: '✅',
                color: '#22c55e',
                href: '/partners',
                fecha,
                leida: leidas.has(id),
              });
            });
          }
        }
      } catch {}

      // ── 3) Mensajes no leídos via API dedicada ──
      try {
        {
          const res = await fetch('/api/notif-unread', { credentials: 'same-origin' });
          if (res.ok) {
            const payload = await res.json();
            const unread = Array.isArray(payload?.unread) ? payload.unread : [];
            unread.forEach((u: any) => {
              const id = 'chat-' + u.chat_id + '-' + u.last_at;
              out.push({
                id,
                tipo: 'chat',
                titulo: '💬 ' + u.sender_nombre,
                desc: u.count === 1
                  ? (u.last_content || '').substring(0, 60)
                  : u.count + ' mensajes nuevos',
                emoji: '💬',
                color: 'var(--blue)',
                href: '/partners',
                fecha: u.last_at,
                leida: leidas.has(id),
              });
            });
          }
        }
      } catch {}

      // ── 4) Comentarios en mis posts ──
      try {
        const postsRes = await fetch('/api/comunidad/posts?ownerId=' + encodeURIComponent(user.id), { credentials: 'same-origin' });
        const postsPayload = await postsRes.json().catch(() => ({}));
        const misPosts = postsPayload.posts || [];

        for (const post of misPosts.slice(0, 30)) {
          const commentsRes = await fetch('/api/comunidad/comentarios?post_id=' + encodeURIComponent(post.id), { credentials: 'same-origin' });
          const commentsPayload = await commentsRes.json().catch(() => ({}));
          const comments = commentsPayload.comentarios || [];

          comments
            .filter((c: any) => c.user_id !== user.id)
            .slice(0, 20)
            .forEach((c: any) => {
              const id = 'com-' + c.id;
              const nombreComentador = c.user_nombre || c.usuario_nombre || 'Alguien';
              out.push({
                id, tipo: 'comunidad',
                titulo: '💬 ' + nombreComentador + ' comentó',
                desc: 'En "' + (post.titulo || 'tu post') + '": ' + (c.contenido || '').substring(0, 50),
                emoji: '💬', color: '#a855f7',
                href: '/comunidad/' + post.id, fecha: c.created_at,
                leida: leidas.has(id),
              });
            });
        }
      } catch {}

      // ── 5) Posts de mis partners (últimas 72h) ──
      try {
        const partnerRows = partnersApi?.partners || [];
        if (partnerRows.length > 0) {
          const partnerIds = partnerRows.map((p: any) =>
            p.sender_id === user.id ? p.receiver_id : p.sender_id
          );

          const hace3d = new Date();
          hace3d.setDate(hace3d.getDate() - 3);

          const postsRes = await fetch('/api/comunidad/posts?filtro=all', { credentials: 'same-origin' });
          const postsPayload = await postsRes.json().catch(() => ({}));
          const posts = (postsPayload.posts || [])
            .filter((p: any) => partnerIds.includes(p.user_id))
            .filter((p: any) => new Date(p.created_at).getTime() >= hace3d.getTime())
            .slice(0, 5);

          if (posts && posts.length > 0) {
            const partnerNombres: Record<string, string> = {};
            partnerRows.forEach((p: any) => {
              const pid = p.sender_id === user.id ? p.receiver_id : p.sender_id;
              partnerNombres[pid] = p.partner?.nombre || 'Tu partner';
            });

            posts.forEach((post: any) => {
              const id = 'post-' + post.id;
              out.push({
                id,
                tipo: 'comunidad',
                titulo: '📝 ' + (partnerNombres[post.user_id] || 'Tu partner') + ' publicó',
                desc: post.titulo || 'Nuevo post',
                emoji: '📝',
                color: '#a855f7',
                href: '/comunidad/' + post.id,
                fecha: post.created_at,
                leida: leidas.has(id),
              });
            });
          }
        }
      } catch {}

      // ── 6) News recientes (48h) ──
      try {
        const hace48h = new Date();
        hace48h.setHours(hace48h.getHours() - 48);
        const newsRes = await fetch('/api/news', { credentials: 'same-origin' });
        const newsPayload = await newsRes.json().catch(() => ({}));
        const news = (newsPayload.news || [])
          .filter((n: any) => new Date(n.created_at).getTime() >= hace48h.getTime())
          .slice(0, 3);

        news.forEach((n: any) => {
          const id = 'news-' + n.id;
          out.push({
            id, tipo: 'news',
            titulo: '📰 Nueva noticia',
            desc: n.titulo || 'Actualización de StudyAL',
            emoji: '📰', color: '#f97316',
            href: '/news', fecha: n.created_at,
            leida: leidas.has(id),
          });
        });
      } catch {}

    } catch {}

    out.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    const top20 = out.slice(0, 20);

    // Detectar notifs nuevas (no leídas, no vistas antes) y emitir toas
    try {
      const vistasKey = 'studyal_notif_vistas';
      const vistasRaw = localStorage.getItem(vistasKey);
      const vistas = new Set<string>(vistasRaw ? JSON.parse(vistasRaw) : []);
      const nuevas = top20.filter(n => !n.leida && !vistas.has(n.id));

      if (nuevas.length > 0) {
        // emitir evento global con la primera nueva
        const evt = new CustomEvent('studyal:newNotif', { detail: nuevas[0] });
        window.dispatchEvent(evt);
      }

      // marcar todas como vistas (para no disparar de nuevo)
      top20.forEach(n => vistas.add(n.id));
      localStorage.setItem(vistasKey, JSON.stringify([...vistas].slice(-200)));
    } catch {}

    setNotifs(top20);
    setLoading(false);
  };

  useEffect(() => { cargar(); const iv = setInterval(cargar, 60000); return () => clearInterval(iv); }, []);
  useEffect(() => { if (abierto) cargar(); }, [abierto]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const noLeidas = notifs.filter(n => !n.leida).length;

  const abrirNotif = (n: Notif) => {
    const l = getLeidas(); l.add(n.id); setLeidas(l);
    setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, leida: true } : x));
    setAbierto(false);
    try { (window as any).__showNavLoader?.(n.href); } catch {}
    try { router.push(n.href); } catch { window.location.href = n.href; }
  };

  const marcarTodas = () => {
    const l = getLeidas(); notifs.forEach(n => l.add(n.id)); setLeidas(l);
    setNotifs(prev => prev.map(n => ({ ...n, leida: true })));
  };

  const tiempo = (f: string) => {
    const min = Math.floor((Date.now() - new Date(f).getTime()) / 60000);
    if (min < 1) return 'ahora';
    if (min < 60) return min + 'm';
    const h = Math.floor(min / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  };

  const TIPO: Record<string, string> = { chat:'Chat', partner:'Partners', comunidad:'Comunidad', news:'News' };

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button onClick={() => setAbierto(!abierto)} style={{
        width: 42, height: 42, borderRadius: 10,
        border: '2.5px solid var(--text-primary)',
        background: noLeidas > 0 ? 'var(--gold)' : 'var(--bg-card)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, boxShadow: abierto ? '3px 4px 0 var(--gold)' : '2px 2px 0 var(--text-primary)',
        transform: abierto ? 'rotate(0)' : 'rotate(2deg)', transition: 'all .2s',
        position: 'relative', padding: 0,
      }} title="Notificaciones">
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
          }}>{noLeidas > 9 ? '9+' : noLeidas}</span>
        )}
      </button>

      {abierto && (<>
        <div onClick={() => setAbierto(false)} style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,.3)', backdropFilter: 'blur(4px)',
        }}/>
        <div style={{
          position: 'absolute', top: 'calc(100% + 12px)', right: 0,
          width: 350, maxHeight: 500,
          background: 'var(--bg-card)', border: '2.5px solid var(--text-primary)',
          borderRadius: 14, boxShadow: '6px 7px 0 var(--gold), 0 16px 50px rgba(0,0,0,.4)',
          zIndex: 9999, display: 'flex', flexDirection: 'column',
          transform: 'rotate(-.5deg)', animation: 'notifSlide .25s cubic-bezier(.34,1.4,.64,1)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 16px 10px', borderBottom: '2px dashed var(--border-color)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
          }}>
            <h3 style={{
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              color: 'var(--text-primary)', margin: 0, transform: 'rotate(-1deg)',
            }}>
              🔔 Buzón
              {noLeidas > 0 && <span style={{ marginLeft: 8, fontSize: 14, color: 'var(--red)' }}>({noLeidas})</span>}
            </h3>
            {noLeidas > 0 && (
              <button onClick={marcarTodas} style={{
                background: 'transparent', border: '1.5px dashed var(--gold)',
                borderRadius: 6, padding: '3px 8px',
                fontFamily: HAND, fontSize: 12, fontWeight: 700,
                color: 'var(--gold)', cursor: 'pointer',
              }}>✓ leídas</button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {loading ? (
              <p style={{ fontFamily: BODY, fontSize: 15, color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>~ cargando... ~</p>
            ) : notifs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 20px' }}>
                <div style={{ fontSize: 44, marginBottom: 8 }}>🌟</div>
                <p style={{ fontFamily: HAND, fontSize: 17, color: 'var(--text-muted)', margin: 0 }}>~ todo al día ~</p>
              </div>
            ) : notifs.map((n, i) => (
              <div key={n.id} onClick={() => abrirNotif(n)} style={{
                padding: '10px 12px', marginBottom: 5, borderRadius: 9,
                border: '2px ' + (n.leida ? 'dashed var(--border-color)' : 'solid ' + n.color),
                background: n.leida ? 'transparent' : 'color-mix(in srgb, ' + n.color + ' 10%, transparent)',
                cursor: 'pointer', display: 'flex', gap: 10,
                transition: 'all .15s', transform: 'rotate(' + (i % 2 === 0 ? -0.3 : 0.3) + 'deg)',
              }}
              onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'rotate(0) translateX(3px)'; e.currentTarget.style.background = 'color-mix(in srgb, ' + n.color + ' 18%, transparent)'; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'rotate(' + (i % 2 === 0 ? -0.3 : 0.3) + 'deg)'; e.currentTarget.style.background = n.leida ? 'transparent' : 'color-mix(in srgb, ' + n.color + ' 10%, transparent)'; }}
              >
                <div style={{ fontSize: 22, flexShrink: 0 }}>{n.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <p style={{ fontFamily: HAND, fontSize: 15, fontWeight: 800, color: n.color, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.titulo}</p>
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ fontFamily: HAND, fontSize: 10, color: '#fff', background: n.color, borderRadius: 4, padding: '1px 5px', opacity: .85 }}>{TIPO[n.tipo]}</span>
                      <span style={{ fontFamily: BODY, fontSize: 12, color: 'var(--text-faint)' }}>{tiempo(n.fecha)}</span>
                    </span>
                  </div>
                  <p style={{ fontFamily: BODY, fontSize: 13, color: 'var(--text-muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>{n.desc}</p>
                </div>
                {!n.leida && <div style={{ width: 8, height: 8, borderRadius: '50%', background: n.color, marginTop: 6, flexShrink: 0, boxShadow: '0 0 6px ' + n.color }}/>}
              </div>
            ))}
          </div>

          <div style={{ padding: '8px 12px', borderTop: '2px dashed var(--border-color)', textAlign: 'center' }}>
            <button onClick={() => { setAbierto(false); cargar(); }} style={{
              fontFamily: BODY, fontSize: 13, color: 'var(--text-faint)',
              background: 'transparent', border: 'none', cursor: 'pointer',
            }}>↻ actualizar</button>
          </div>
        </div>
      </>)}

      <style>{`
        @keyframes notifBounce { 0%,100%{transform:scale(1) rotate(0)} 50%{transform:scale(1.2) rotate(-8deg)} }
        @keyframes notifSlide { 0%{opacity:0;transform:translateY(-10px) rotate(0) scale(.95)} 100%{opacity:1;transform:translateY(0) rotate(-.5deg) scale(1)} }
      `}</style>
    </div>
  );
}
