'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import NavbarMobile from '../../components/NavbarMobile';
import { PartnerInfo, Partner, ChatPreview } from '../../components/partners/types';
import { Av, fmtTime } from '../../components/partners/helpers';
import { QRModal, ReportModal } from '../../components/partners/Modals';
import ChatView from '../../components/partners/ChatView';

export default function PartnersPage() {
  const isMobile = useIsMobile();
  const [miUserId, setMiUserId] = useState('');
  const [miInfo, setMiInfo] = useState<PartnerInfo>({ user_id: '', nombre: '' });
  const [token, setToken] = useState('');
  const [vista, setVista] = useState<'chats' | 'partners' | 'solicitudes' | 'buscar'>('chats');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [solicitudes, setSolicitudes] = useState<Partner[]>([]);
  const [enviadas, setEnviadas] = useState<Partner[]>([]);
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [todosUsers, setTodosUsers] = useState<PartnerInfo[]>([]);
  const [resultados, setResultados] = useState<PartnerInfo[]>([]);
  const [chatActivo, setChatActivo] = useState<ChatPreview | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [busqChat, setBusqChat] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [accionando, setAccionando] = useState<string | null>(null);
  const [notif, setNotif] = useState('');
  const [blockConfirm, setBlockConfirm] = useState<Partner | null>(null);
  const [showReport, setShowReport] = useState<PartnerInfo | null>(null);

  const profileUrl = typeof window !== 'undefined' ? `${window.location.origin}/u/${miUserId}` : '';
  const showNotif = (m: string) => { setNotif(m); setTimeout(() => setNotif(''), 3000); };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { window.location.href = '/auth'; return; }
      const u = data.session.user;
      setMiUserId(u.id); setToken(data.session.access_token);
      const n = u.user_metadata?.nombre || u.email?.split('@')[0] || '';
      setMiInfo({ user_id: u.id, nombre: n });
      const { data: lb } = await supabase.from('leaderboard').select('avatar_url,carrera').eq('user_id', u.id).maybeSingle();
      if (lb) setMiInfo(p => ({ ...p, avatar_url: lb.avatar_url || undefined, carrera: lb.carrera }));
    });
  }, []);

  const cargarTodo = useCallback(async () => {
    if (!token) return;
    const [rP, rC] = await Promise.all([
      fetch('/api/partners', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/partner-chats', { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const dP = await rP.json(); const dC = await rC.json();
    if (dP.success) { setPartners(dP.partners || []); setSolicitudes(dP.solicitudes || []); setEnviadas(dP.enviadas || []); }
    if (dC.success) setChats(dC.chats || []);
    setCargando(false);
  }, [token]);

  useEffect(() => { if (token) cargarTodo(); const iv = setInterval(() => { if (token) cargarTodo(); }, 8000); return () => clearInterval(iv); }, [token, cargarTodo]);

  useEffect(() => {
    if (!miUserId) return;
    supabase.from('leaderboard').select('user_id,nombre,avatar_url,carrera,xp_total,racha_actual,flashcards_estudiadas').eq('visible_leaderboard', true).neq('user_id', miUserId).order('xp_total', { ascending: false }).limit(50).then(({ data }) => { if (data) setTodosUsers(data); });
  }, [miUserId]);

  const buscar = useCallback(async (q: string) => {
    if (!q.trim()) { setResultados([]); return; }
    setBuscando(true);
    const { data } = await supabase.from('leaderboard').select('user_id,nombre,avatar_url,carrera,xp_total,racha_actual,flashcards_estudiadas').ilike('nombre', `%${q.trim()}%`).eq('visible_leaderboard', true).neq('user_id', miUserId).limit(20);
    setResultados(data || []); setBuscando(false);
  }, [miUserId]);

  useEffect(() => { const t = setTimeout(() => buscar(busqueda), 350); return () => clearTimeout(t); }, [busqueda, buscar]);

  const enviarSolicitud = async (id: string) => { setAccionando(id); const r = await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ receiver_id: id }) }); const d = await r.json(); showNotif(d.success ? '👥 Enviada' : '❌ ' + d.error); if (d.success) await cargarTodo(); setAccionando(null); };
  const responder = async (id: string, a: 'accept' | 'reject') => { setAccionando(id); await fetch('/api/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ partner_id: id, action: a }) }); showNotif(a === 'accept' ? '🎉 Partners!' : '👋 Rechazado'); await cargarTodo(); if (a === 'accept') setVista('chats'); setAccionando(null); };
  const eliminar = async (id: string) => { if (!confirm('¿Eliminar?')) return; setAccionando(id); await fetch('/api/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ partner_id: id, action: 'remove' }) }); showNotif('👋 Eliminado'); await cargarTodo(); setAccionando(null); };
  const bloquear = async (p: Partner) => { setAccionando(p.id); await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'block', blocked_id: p.partner.user_id }) }); showNotif('🚫 Bloqueado'); setBlockConfirm(null); await cargarTodo(); setAccionando(null); };

  const getEstado = (uid: string) => {
    if (partners.find(p => p.partner.user_id === uid)) return 'partner';
    if (enviadas.find(p => p.partner.user_id === uid)) return 'enviada';
    if (solicitudes.find(p => p.partner.user_id === uid)) return 'recibida';
    return 'ninguno';
  };

  const chatsFiltrados = chats.filter(c => c.partner.nombre.toLowerCase().includes(busqChat.toLowerCase()));
  const listaUsuarios = busqueda ? resultados : todosUsers;
  const TABS = [
    { id: 'chats', label: '💬', count: chats.filter(c => c.unread > 0).length, color: '#38bdf8' },
    { id: 'partners', label: '👥', count: partners.length, color: 'var(--gold)' },
    { id: 'solicitudes', label: '📬', count: solicitudes.length, color: '#a78bfa' },
    { id: 'buscar', label: '🔍', count: 0, color: 'var(--blue)' },
  ];

  if (isMobile && chatActivo) return (
    <ChatView partner={chatActivo.partner} chatId={chatActivo.id} wallpaper={chatActivo.wallpaper_url} miUserId={miUserId} miInfo={miInfo} onBack={() => setChatActivo(null)} onChatDeleted={() => { setChatActivo(null); cargarTodo(); }} token={token} isMobile />
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>
      {showQR && <QRModal url={profileUrl} onClose={() => setShowQR(false)} />}
      {showReport && <ReportModal partner={showReport} token={token} onClose={() => setShowReport(null)} />}
      {blockConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(8px)' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '28px', maxWidth: '380px', width: '100%', border: '1px solid var(--red-border)', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🚫</div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>¿Bloquear a {blockConfirm.partner.nombre}?</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => bloquear(blockConfirm)} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: 'var(--red)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>🚫 Bloquear</button>
              <button onClick={() => setBlockConfirm(null)} style={{ padding: '12px 20px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {notif && <div style={{ position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '10px 20px', zIndex: 9998, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>{notif}</div>}

      {!isMobile && (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 24px', height: '62px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button onClick={() => window.location.href = '/'} style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '7px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>← Inicio</button>
              <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>👥 Partners</h1>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowQR(true)} style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid #38bdf8', background: 'transparent', color: '#38bdf8', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>📱 Mi QR</button>
              <button onClick={() => { navigator.clipboard.writeText(profileUrl); showNotif('🔗 Link copiado'); }} style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid #38bdf844', background: 'transparent', color: '#38bdf8', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>🔗</button>
            </div>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>{['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}</div>
        </>
      )}
      {isMobile && <NavbarMobile />}

      <div style={{ display: 'flex', height: isMobile ? 'calc(100vh - 60px)' : 'calc(100vh - 65px)', overflow: 'hidden' }}>
        <div style={{ width: isMobile ? '100%' : '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: isMobile ? 'none' : '1px solid var(--border-color)', background: 'var(--bg-card)', height: '100%' }}>
          <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', flexShrink: 0 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setVista(t.id as any)} style={{ flex: 1, padding: '11px 4px', border: 'none', background: 'transparent', borderBottom: vista === t.id ? `3px solid ${t.color}` : '3px solid transparent', color: vista === t.id ? t.color : 'var(--text-faint)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', marginBottom: '-2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                {t.label}{t.count > 0 && <span style={{ background: t.color, color: '#000', borderRadius: '10px', padding: '1px 6px', fontSize: '10px', fontWeight: 900 }}>{t.count}</span>}
              </button>
            ))}
          </div>

          {vista === 'chats' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
                <input value={busqChat} onChange={e => setBusqChat(e.target.value)} placeholder="Buscar chats..." style={{ width: '100%', padding: '8px 12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} onFocus={e => e.currentTarget.style.borderColor = '#38bdf8'} onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {cargando ? <p style={{ textAlign: 'center', padding: '40px', color: 'var(--text-faint)' }}>⏳</p>
                : chatsFiltrados.length === 0 ? <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-faint)' }}><div style={{ fontSize: '40px', marginBottom: '8px' }}>💬</div><p style={{ fontSize: '13px', margin: '0 0 12px' }}>{busqChat ? 'Sin resultados' : 'Sin chats'}</p>{!busqChat && <button onClick={() => setVista('buscar')} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: '#38bdf8', color: '#000', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>👥 Buscar</button>}</div>
                : chatsFiltrados.map(chat => (
                  <div key={chat.id} onClick={() => setChatActivo(chat)} style={{ padding: '12px 16px', display: 'flex', gap: '10px', alignItems: 'center', cursor: 'pointer', background: chatActivo?.id === chat.id ? '#38bdf815' : 'transparent', borderLeft: chatActivo?.id === chat.id ? '3px solid #38bdf8' : '3px solid transparent' }} onMouseEnter={e => { if (chatActivo?.id !== chat.id) e.currentTarget.style.background = 'var(--bg-secondary)'; }} onMouseLeave={e => { if (chatActivo?.id !== chat.id) e.currentTarget.style.background = 'transparent'; }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}><Av user={chat.partner} size={44} />{chat.unread > 0 && <span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#38bdf8', color: '#000', borderRadius: '10px', padding: '1px 5px', fontSize: '10px', fontWeight: 900 }}>{chat.unread}</span>}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}><span style={{ fontSize: '14px', fontWeight: chat.unread ? 800 : 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{chat.partner.nombre}</span><span style={{ fontSize: '10px', color: 'var(--text-faint)', marginLeft: '8px', flexShrink: 0 }}>{fmtTime(chat.last_message_at)}</span></div>
                      <p style={{ fontSize: '12px', color: chat.unread ? 'var(--text-primary)' : 'var(--text-faint)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: chat.unread ? 600 : 400 }}>{chat.last_message || 'Sin mensajes'}</p>
                    </div>
                    {chat.savedCount > 0 && <span style={{ fontSize: '11px', color: '#f5c842' }}>📌{chat.savedCount}</span>}
                    <button onClick={e => { e.stopPropagation(); if (confirm('¿Borrar?')) { fetch(`/api/partner-chat?chatId=${chat.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).then(() => { cargarTodo(); if (chatActivo?.id === chat.id) setChatActivo(null); }); } }} style={{ padding: '3px 6px', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--text-faint)', fontSize: '11px', cursor: 'pointer', opacity: 0.5, flexShrink: 0 }} onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--red)'; }} onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-faint)'; }}>🗑️</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {vista === 'partners' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {partners.length === 0 ? <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-faint)' }}><div style={{ fontSize: '40px', marginBottom: '8px' }}>👥</div><button onClick={() => setVista('buscar')} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: '#38bdf8', color: '#000', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>🔍 Buscar</button></div>
              : partners.map(p => (
                <div key={p.id} style={{ padding: '10px 14px', display: 'flex', gap: '10px', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                  <Av user={p.partner} size={42} onClick={() => window.location.href = `/u/${p.partner.user_id}`} />
                  <div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.partner.nombre}</p>{p.partner.carrera && <p style={{ fontSize: '11px', color: 'var(--gold)', margin: 0, fontWeight: 600 }}>🎓 {p.partner.carrera}</p>}</div>
                  <button onClick={() => { const c = chats.find(ch => ch.partner.user_id === p.partner.user_id); setChatActivo(c || ({ id: '', partner: p.partner, unread: 0, savedCount: 0, user1_id: '', user2_id: '' } as any)); setVista('chats'); }} style={{ padding: '6px 10px', borderRadius: '8px', border: 'none', background: '#38bdf8', color: '#000', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>💬</button>
                  <button onClick={() => setShowReport(p.partner)} style={{ padding: '6px 7px', borderRadius: '8px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '11px', cursor: 'pointer' }}>🚨</button>
                  <button onClick={() => setBlockConfirm(p)} style={{ padding: '6px 7px', borderRadius: '8px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '11px', cursor: 'pointer' }}>🚫</button>
                  <button onClick={() => eliminar(p.id)} style={{ padding: '6px 7px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-faint)', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                </div>
              ))}
            </div>
          )}

          {vista === 'solicitudes' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {solicitudes.length === 0 && enviadas.length === 0 ? <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-faint)' }}><div style={{ fontSize: '40px', marginBottom: '8px' }}>📬</div><p style={{ fontSize: '13px' }}>Sin solicitudes</p></div> : <>
                {solicitudes.length > 0 && <><p style={{ fontSize: '11px', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px', margin: '12px 14px 8px' }}>📥 Recibidas</p>{solicitudes.map(s => <div key={s.id} style={{ padding: '10px 14px', display: 'flex', gap: '10px', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}><Av user={s.partner} size={40} onClick={() => window.location.href = `/u/${s.partner.user_id}`} /><div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1px' }}>{s.partner.nombre}</p><p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: 0 }}>{fmtTime(s.created_at)}</p></div><button onClick={() => responder(s.id, 'accept')} disabled={accionando === s.id} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#4ade80', color: '#000', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>✅</button><button onClick={() => responder(s.id, 'reject')} disabled={accionando === s.id} style={{ padding: '6px 7px', borderRadius: '8px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '12px', cursor: 'pointer' }}>✕</button></div>)}</>}
                {enviadas.length > 0 && <><p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '12px 14px 8px' }}>📤 Enviadas</p>{enviadas.map(s => <div key={s.id} style={{ padding: '10px 14px', display: 'flex', gap: '10px', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}><Av user={s.partner} size={40} /><div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1px' }}>{s.partner.nombre}</p><p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: 0 }}>⏳ Pendiente</p></div><button onClick={() => eliminar(s.id)} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-faint)', fontSize: '11px', cursor: 'pointer' }}>Cancelar</button></div>)}</>}
              </>}
            </div>
          )}

          {vista === 'buscar' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
                <input autoFocus value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar usuarios..." style={{ width: '100%', padding: '8px 12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} onFocus={e => e.currentTarget.style.borderColor = '#38bdf8'} onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
                <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '6px 0 0' }}>{buscando ? '⏳' : busqueda ? `${listaUsuarios.length} resultados` : `🌍 ${todosUsers.length} usuarios`}</p>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {listaUsuarios.map(u => {
                  const est = getEstado(u.user_id);
                  return (
                    <div key={u.user_id} style={{ padding: '10px 14px', display: 'flex', gap: '10px', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                      <Av user={u} size={40} onClick={() => window.location.href = `/u/${u.user_id}`} />
                      <div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nombre}</p>{u.carrera && <p style={{ fontSize: '11px', color: 'var(--blue)', margin: 0, fontWeight: 600 }}>🎓 {u.carrera}</p>}</div>
                      <button onClick={() => window.location.href = `/u/${u.user_id}`} style={{ padding: '6px 7px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }}>🌐</button>
                      {est === 'ninguno' && <button onClick={() => enviarSolicitud(u.user_id)} disabled={accionando === u.user_id} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#38bdf8', color: '#000', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>{accionando === u.user_id ? '⏳' : '👥 +'}</button>}
                      {est === 'partner' && <span style={{ padding: '6px 10px', borderRadius: '8px', background: '#4ade8022', color: '#4ade80', fontSize: '11px', fontWeight: 700 }}>✅</span>}
                      {est === 'enviada' && <span style={{ padding: '6px 10px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-faint)', fontSize: '11px', fontWeight: 700 }}>⏳</span>}
                      {est === 'recibida' && <button onClick={() => { const s = solicitudes.find(x => x.partner.user_id === u.user_id); if (s) responder(s.id, 'accept'); }} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#4ade80', color: '#000', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>✅</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {!isMobile && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            {chatActivo ? (
              <ChatView partner={chatActivo.partner} chatId={chatActivo.id} wallpaper={chatActivo.wallpaper_url} miUserId={miUserId} miInfo={miInfo} onBack={() => setChatActivo(null)} onChatDeleted={() => { setChatActivo(null); cargarTodo(); }} token={token} isMobile={false} />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', color: 'var(--text-faint)' }}>
                <div style={{ fontSize: '72px' }}>👥</div>
                <p style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--text-muted)' }}>Selecciona una conversación</p>
                <button onClick={() => setVista('buscar')} style={{ padding: '10px 24px', borderRadius: '12px', border: 'none', background: '#38bdf8', color: '#000', fontWeight: 800, fontSize: '14px', cursor: 'pointer' }}>🔍 Buscar Partners</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
