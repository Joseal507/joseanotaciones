'use client';

import { useRouter } from 'next/navigation';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useIdioma } from '../../hooks/useIdioma';
import { useIsMobile } from '../../hooks/useIsMobile';
import NavbarMobile from '../../components/NavbarMobile';
import { PartnerInfo, Partner, ChatPreview } from '../../components/partners/types';
import { Av, fmtTime } from '../../components/partners/helpers';
import { QRModal, ReportModal } from '../../components/partners/Modals';
import ChatView from '../../components/partners/ChatView';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

export default function PartnersPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();
  const { data: session, status } = useSession();
  const [miUserId, setMiUserId] = useState('');
  const [miInfo, setMiInfo] = useState<PartnerInfo>({ user_id: '', nombre: '' });
  const [token, setToken] = useState('nextauth');
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
    if (status === 'loading') return;
    const u: any = session?.user;
    if (!u?.id) {
      try { (window as any).__showNavLoader?.('/landing'); } catch {}
      router.push('/landing');
      return;
    }

    setMiUserId(u.id);
    setToken('nextauth');
    setMiInfo({
      user_id: u.id,
      nombre: u.name || u.email?.split('@')[0] || '',
      avatar_url: u.image || undefined,
    });

    fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        const lb = (d.data || []).find((x: any) => x.user_id === u.id);
        if (lb) setMiInfo(p => ({
          ...p,
          nombre: lb.nombre || p.nombre,
          avatar_url: lb.avatar_url || p.avatar_url,
          carrera: lb.carrera || p.carrera,
        }));
      })
      .catch(() => {});
  }, [session, status, router]);

  const cargarTodo = useCallback(async () => {
    if (!token) return;
    const [rP, rC] = await Promise.all([
      fetch('/api/partners', { credentials: 'same-origin' }),
      fetch('/api/partner-chats', { credentials: 'same-origin' }),
    ]);
    const dP = await rP.json(); const dC = await rC.json();
    if (dP.success) { setPartners(dP.partners || []); setSolicitudes(dP.solicitudes || []); setEnviadas(dP.enviadas || []); }
    if (dC.success) setChats(dC.chats || []);
    setCargando(false);
  }, [token]);

  useEffect(() => {
    if (token) cargarTodo();
    const iv = setInterval(() => { if (token) cargarTodo(); }, 8000);
    return () => clearInterval(iv);
  }, [token, cargarTodo]);

  useEffect(() => {
    if (!miUserId) return;
    fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        const users = (d.data || [])
          .filter((u: any) => u.visible_leaderboard !== false && u.visible_leaderboard !== 0 && u.user_id !== miUserId)
          .sort((a: any, b: any) => Number(b.xp_total || 0) - Number(a.xp_total || 0))
          .slice(0, 50);
        setTodosUsers(users);
      })
      .catch(() => {});
  }, [miUserId]);

  const buscar = useCallback(async (q: string) => {
    if (!q.trim()) { setResultados([]); return; }
    setBuscando(true);
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
      const d = await res.json();
      const term = q.trim().toLowerCase();
      const users = (d.data || [])
        .filter((u: any) =>
          u.visible_leaderboard !== false &&
          u.visible_leaderboard !== 0 &&
          u.user_id !== miUserId &&
          String(u.nombre || '').toLowerCase().includes(term)
        )
        .slice(0, 20);
      setResultados(users);
    } catch {
      setResultados([]);
    }
    setBuscando(false);
  }, [miUserId]);

  useEffect(() => { const t = setTimeout(() => buscar(busqueda), 350); return () => clearTimeout(t); }, [busqueda, buscar]);

  const enviarSolicitud = async (id: string) => {
    setAccionando(id);
    const r = await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ receiver_id: id }) });
    const d = await r.json();
    showNotif(d.success ? '✅ ' + tr('solicitudEnviadaLabel') : '❌ ' + d.error);
    if (d.success) await cargarTodo();
    setAccionando(null);
  };

  const responder = async (id: string, a: 'accept' | 'reject') => {
    setAccionando(id);
    await fetch('/api/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ partner_id: id, action: a }) });
    showNotif(a === 'accept' ? '✅ ' + tr('partnersLabel') : '✕ ' + tr('rechazadoLabel'));
    await cargarTodo();
    if (a === 'accept') setVista('chats');
    setAccionando(null);
  };

  const eliminar = async (id: string) => {
    if (!confirm(tr('eliminarConfirm'))) return;
    setAccionando(id);
    await fetch('/api/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ partner_id: id, action: 'remove' }) });
    showNotif('🗑️ ' + tr('eliminadoLabel'));
    await cargarTodo();
    setAccionando(null);
  };

  const bloquear = async (p: Partner) => {
    setAccionando(p.id);
    await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'block', blocked_id: p.partner.user_id }) });
    showNotif('🚫 ' + tr('bloqueadoLabel'));
    setBlockConfirm(null);
    await cargarTodo();
    setAccionando(null);
  };

  const getEstado = (uid: string) => {
    if (partners.find(p => p.partner.user_id === uid)) return 'partner';
    if (enviadas.find(p => p.partner.user_id === uid)) return 'enviada';
    if (solicitudes.find(p => p.partner.user_id === uid)) return 'recibida';
    return 'ninguno';
  };

  const chatsFiltrados = chats.filter(c => c.partner.nombre.toLowerCase().includes(busqChat.toLowerCase()));
  const listaUsuarios = busqueda ? resultados : todosUsers;
  const TABS = [
    { id: 'chats',       label: tr('chatsTab'),       count: chats.filter(c => c.unread > 0).length, color: '#38bdf8', emoji: '💬' },
    { id: 'partners',    label: tr('partnersTab'),    count: partners.length,                        color: 'var(--gold)', emoji: '👥' },
    { id: 'solicitudes', label: tr('solicitudesTab'), count: solicitudes.length,                     color: '#a78bfa', emoji: '📬' },
    { id: 'buscar',      label: tr('buscarTab'),      count: 0,                                      color: 'var(--blue)', emoji: '🔍' },
  ];

  if (isMobile && chatActivo) return (
    <ChatView partner={chatActivo.partner} chatId={chatActivo.id} wallpaper={chatActivo.wallpaper_url}
      miUserId={miUserId} miInfo={miInfo}
      onBack={() => setChatActivo(null)}
      onChatDeleted={() => { setChatActivo(null); cargarTodo(); }}
      token={token} isMobile />
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>

      {showQR && <QRModal url={profileUrl} onClose={() => setShowQR(false)} />}
      {showReport && <ReportModal partner={showReport} token={token} onClose={() => setShowReport(null)} />}

      {blockConfirm && (
        <div onClick={() => setBlockConfirm(null)} style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.78)',
          backdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={(e: any) => e.stopPropagation()} style={{
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 16,
            padding: 28, maxWidth: 400, width: '100%',
            textAlign: 'center',
            boxShadow: '6px 7px 0 var(--red), 0 16px 50px rgba(0,0,0,0.4)',
            transform: 'rotate(-0.5deg)',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(-4deg)',
              width: 80, height: 18,
              background: 'color-mix(in srgb, var(--red) 55%, transparent)',
              border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
              boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
            }}/>
            <div style={{ fontSize: 54, marginBottom: 12 }}>🚫</div>
            <h3 style={{
              fontFamily: HAND, fontSize: 26, fontWeight: 900,
              color: 'var(--text-primary)', margin: '0 0 18px',
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              ¿Bloquear a {blockConfirm.partner.nombre}?
            </h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => bloquear(blockConfirm)}
                style={{
                  flex: 1, padding: 12,
                  borderRadius: 12,
                  border: '2.5px solid var(--text-primary)',
                  background: 'var(--red)', color: '#fff',
                  fontFamily: HAND, fontSize: 19, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '3px 4px 0 var(--text-primary)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                  transform: 'rotate(-1deg)',
                }}>
                🚫 Bloquear
              </button>
              <button onClick={() => setBlockConfirm(null)}
                style={{
                  padding: '12px 18px',
                  borderRadius: 12,
                  border: '2.5px dashed var(--text-faint)',
                  background: 'transparent', color: 'var(--text-muted)',
                  fontFamily: HAND, fontSize: 18, fontWeight: 800,
                  cursor: 'pointer',
                  transform: 'rotate(1deg)',
                }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {notif && (
        <div style={{
          position: 'fixed', top: 80, left: '50%',
          transform: 'translateX(-50%) rotate(-1.5deg)',
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 12,
          padding: '10px 22px',
          zIndex: 9998,
          fontFamily: HAND, fontSize: 17, fontWeight: 800,
          color: 'var(--text-primary)',
          boxShadow: '3px 4px 0 var(--gold)',
          whiteSpace: 'nowrap',
        }}>
          {notif}
        </div>
      )}

      {!isMobile && (
        <>
          <header style={{
            position: 'sticky', top: 0, zIndex: 100,
            background: 'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
            backdropFilter: 'blur(14px)',
            borderBottom: '2.5px solid var(--text-primary)',
            padding: '12px 28px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button onClick={() => {
                try { (window as any).__showNavLoader?.('/'); } catch {}
                const fallback = setTimeout(() => { if (window.location.pathname !== '/') window.location.href = '/'; }, 700);
                try { router.push('/'); setTimeout(() => clearTimeout(fallback), 750); }
                catch { clearTimeout(fallback); window.location.href = '/'; }
              }}
                style={{
                  background: 'var(--bg-card)',
                  border: '2.5px solid var(--text-primary)',
                  color: 'var(--text-primary)',
                  padding: '8px 16px',
                  borderRadius: 10,
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '3px 3px 0 var(--text-primary)',
                  transform: 'rotate(-1.5deg)',
                }}>
                ← {tr('inicio')}
              </button>
              <div>
                <h1 style={{
                  fontFamily: HAND, fontSize: 30, fontWeight: 900,
                  color: 'var(--text-primary)', margin: 0, lineHeight: 1,
                  transform: 'rotate(-1deg)', display: 'inline-block',
                }}>
                  👥 {tr('partners')}
                </h1>
                <svg width="160" height="6" style={{ display: 'block', marginTop: 2 }}>
                  <path d="M2 3 Q 80 0 158 4" stroke="#38bdf8" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
                </svg>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowQR(true)}
                style={{
                  padding: '8px 16px', borderRadius: 10,
                  border: '2.5px dashed #38bdf8',
                  background: 'transparent', color: '#38bdf8',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  cursor: 'pointer',
                  transform: 'rotate(1deg)',
                }}>
                📱 Mi QR
              </button>
              <button onClick={() => { navigator.clipboard.writeText(profileUrl); showNotif('📋 Copiado'); }}
                style={{
                  padding: '8px 14px', borderRadius: 10,
                  border: '2.5px dashed var(--text-faint)',
                  background: 'transparent', color: '#38bdf8',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  cursor: 'pointer',
                  transform: 'rotate(-1deg)',
                }}>
                🔗
              </button>
            </div>
          </header>
          <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 14 }}>
            <path d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
              fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.45"/>
          </svg>
        </>
      )}
      {isMobile && <NavbarMobile />}

      <div style={{ display: 'flex', height: isMobile ? 'calc(100vh - 60px)' : 'calc(100vh - 78px)', overflow: 'hidden' }}>
        <div style={{
          width: isMobile ? '100%' : 340,
          flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          borderRight: isMobile ? 'none' : '2.5px solid var(--text-primary)',
          background: 'var(--bg-card)',
          height: '100%',
        }}>
          {/* Tabs */}
          <div style={{
            display: 'flex', gap: 4,
            padding: '10px 10px 6px',
            borderBottom: '2px dashed var(--border-color)',
            flexShrink: 0,
          }}>
            {TABS.map((t, i) => {
              const active = vista === t.id;
              return (
                <button key={t.id} onClick={() => setVista(t.id as any)}
                  style={{
                    flex: 1, padding: '8px 4px',
                    borderRadius: 10,
                    border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? t.color : 'var(--border-color)'}`,
                    background: active ? `color-mix(in srgb,${t.color} 18%,transparent)` : 'transparent',
                    color: active ? t.color : 'var(--text-faint)',
                    fontFamily: HAND, fontSize: 15, fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    boxShadow: active ? `2px 2px 0 ${t.color}` : 'none',
                    transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                    transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                  }}>
                  <span style={{ fontSize: 18 }}>{t.emoji}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {t.label}
                    {t.count > 0 && (
                      <span style={{
                        background: t.color, color: '#000',
                        border: '1.5px solid var(--text-primary)',
                        borderRadius: 6,
                        padding: '0 6px',
                        fontFamily: HAND, fontSize: 13, fontWeight: 900,
                      }}>
                        {t.count}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* CHATS */}
          {vista === 'chats' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '2px dashed var(--border-color)', flexShrink: 0 }}>
                <input value={busqChat} onChange={(e: any) => setBusqChat(e.target.value)} placeholder="🔍 buscar partner..."
                  style={{
                    width: '100%', padding: '8px 14px',
                    borderRadius: 10,
                    border: '2.5px solid var(--text-primary)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontFamily: HAND, fontSize: 16, fontWeight: 600,
                    outline: 'none', boxSizing: 'border-box',
                    boxShadow: '2px 2px 0 var(--text-primary)',
                    transform: 'rotate(-0.3deg)',
                  }}
                />
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {cargando ? (
                  <p style={{ textAlign: 'center', padding: 40, fontFamily: BODY, fontSize: 19, color: 'var(--text-faint)' }}>
                    ~ ⏳ cargando ~
                  </p>
                ) : chatsFiltrados.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <div style={{ fontSize: 50, marginBottom: 10 }}>💬</div>
                    <p style={{
                      fontFamily: HAND, fontSize: 18,
                      color: 'var(--text-faint)', margin: '0 0 14px',
                    }}>
                      ~ {busqChat ? tr('sinResultados') : tr('sinChats')} ~
                    </p>
                    {!busqChat && (
                      <button onClick={() => setVista('buscar')}
                        style={{
                          padding: '8px 18px',
                          borderRadius: 10,
                          border: '2.5px solid var(--text-primary)',
                          background: '#38bdf8', color: '#000',
                          fontFamily: HAND, fontSize: 17, fontWeight: 800,
                          cursor: 'pointer',
                          boxShadow: '2px 3px 0 var(--text-primary)',
                          transform: 'rotate(-1deg)',
                        }}>
                        👥 {tr('buscarTab')}
                      </button>
                    )}
                  </div>
                ) : chatsFiltrados.map((chat, i) => (
                  <div key={chat.id} onClick={() => setChatActivo(chat)}
                    style={{
                      padding: '12px 16px',
                      display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer',
                      background: chatActivo?.id === chat.id ? 'color-mix(in srgb,#38bdf8 18%,transparent)' : 'transparent',
                      borderLeft: chatActivo?.id === chat.id ? '4px solid #38bdf8' : '4px solid transparent',
                      borderBottom: '1.5px dashed var(--border-color)',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e:any)=>{if(chatActivo?.id !== chat.id) e.currentTarget.style.background='var(--bg-secondary)';}}
                    onMouseLeave={(e:any)=>{if(chatActivo?.id !== chat.id) e.currentTarget.style.background='transparent';}}
                  >
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <Av user={chat.partner} size={46} />
                      {chat.unread > 0 && (
                        <span style={{
                          position: 'absolute', top: -3, right: -3,
                          background: '#38bdf8', color: '#000',
                          border: '2px solid var(--text-primary)',
                          borderRadius: 6,
                          padding: '0 6px',
                          fontFamily: HAND, fontSize: 12, fontWeight: 900,
                          boxShadow: '1px 1px 0 var(--text-primary)',
                          transform: 'rotate(8deg)',
                        }}>
                          {chat.unread}
                        </span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{
                          fontFamily: HAND, fontSize: 18, fontWeight: chat.unread ? 900 : 700,
                          color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                          lineHeight: 1,
                        }}>{chat.partner.nombre}</span>
                        <span style={{
                          fontFamily: BODY, fontSize: 12,
                          color: 'var(--text-faint)',
                          marginLeft: 8, flexShrink: 0,
                        }}>{fmtTime(chat.last_message_at)}</span>
                      </div>
                      <p style={{
                        fontFamily: BODY, fontSize: 15,
                        color: chat.unread ? 'var(--text-primary)' : 'var(--text-faint)',
                        fontWeight: chat.unread ? 700 : 600,
                        fontStyle: chat.unread ? 'normal' : 'italic',
                        margin: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {chat.last_message || (idioma === 'en' ? '~ no messages ~' : '~ sin mensajes ~')}
                      </p>
                    </div>
                    {chat.savedCount > 0 && (
                      <span style={{
                        fontFamily: HAND, fontSize: 14, fontWeight: 800,
                        color: 'var(--gold)',
                      }}>📌{chat.savedCount}</span>
                    )}
                    <button onClick={(e: any) => {
                      e.stopPropagation();
                      if (confirm(idioma === 'en' ? 'Delete?' : '¿Borrar?')) {
                        fetch(`/api/partner-chat?chatId=${chat.id}`, { method: 'DELETE', credentials: 'same-origin' })
                          .then(() => { cargarTodo(); if (chatActivo?.id === chat.id) setChatActivo(null); });
                      }
                    }}
                      style={{
                        padding: '4px 7px', borderRadius: 6,
                        border: 'none', background: 'transparent',
                        color: 'var(--text-faint)',
                        fontSize: 13, cursor: 'pointer',
                        opacity: 0.5, flexShrink: 0,
                      }}>
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PARTNERS */}
          {vista === 'partners' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {partners.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ fontSize: 50, marginBottom: 10 }}>👥</div>
                  <p style={{
                    fontFamily: HAND, fontSize: 18,
                    color: 'var(--text-faint)', margin: '0 0 14px',
                  }}>
                    ~ sin partners aún ~
                  </p>
                  <button onClick={() => setVista('buscar')}
                    style={{
                      padding: '8px 18px',
                      borderRadius: 10,
                      border: '2.5px solid var(--text-primary)',
                      background: '#38bdf8', color: '#000',
                      fontFamily: HAND, fontSize: 17, fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '2px 3px 0 var(--text-primary)',
                      transform: 'rotate(-1deg)',
                    }}>
                    🔍 Buscar
                  </button>
                </div>
              ) : partners.map((p, i) => (
                <div key={p.id} style={{
                  padding: '10px 14px',
                  display: 'flex', gap: 10, alignItems: 'center',
                  borderBottom: '1.5px dashed var(--border-color)',
                }}>
                  <Av user={p.partner} size={44} onClick={() => router.push(`/u/${p.partner.user_id}`)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontFamily: HAND, fontSize: 18, fontWeight: 800,
                      color: 'var(--text-primary)',
                      margin: '0 0 1px', lineHeight: 1.05,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{p.partner.nombre}</p>
                    {p.partner.carrera && (
                      <p style={{
                        fontFamily: HAND, fontSize: 13,
                        color: 'var(--gold)', margin: 0,
                      }}>~ 🎓 {p.partner.carrera} ~</p>
                    )}
                  </div>
                  <button onClick={() => {
                    const c = chats.find(ch => ch.partner.user_id === p.partner.user_id);
                    setChatActivo(c || ({ id: '', partner: p.partner, unread: 0, savedCount: 0, user1_id: '', user2_id: '' } as any));
                    setVista('chats');
                  }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      border: '2px solid var(--text-primary)',
                      background: '#38bdf8', color: '#000',
                      fontFamily: HAND, fontSize: 15, fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '1px 2px 0 var(--text-primary)',
                      transform: 'rotate(-2deg)',
                    }}>
                    💬
                  </button>
                  <button onClick={() => setShowReport(p.partner)}
                    style={{
                      padding: '6px 8px', borderRadius: 8,
                      border: '1.5px dashed var(--red)',
                      background: 'transparent', color: 'var(--red)',
                      fontSize: 13, cursor: 'pointer',
                      transform: 'rotate(2deg)',
                    }}>🚨</button>
                  <button onClick={() => setBlockConfirm(p)}
                    style={{
                      padding: '6px 8px', borderRadius: 8,
                      border: '1.5px dashed var(--red)',
                      background: 'transparent', color: 'var(--red)',
                      fontSize: 13, cursor: 'pointer',
                      transform: 'rotate(-2deg)',
                    }}>🚫</button>
                  <button onClick={() => eliminar(p.id)}
                    style={{
                      padding: '6px 8px', borderRadius: 8,
                      border: '1.5px dashed var(--text-faint)',
                      background: 'transparent', color: 'var(--text-faint)',
                      fontSize: 13, cursor: 'pointer',
                      transform: 'rotate(2deg)',
                    }}>🗑️</button>
                </div>
              ))}
            </div>
          )}

          {/* SOLICITUDES */}
          {vista === 'solicitudes' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {solicitudes.length === 0 && enviadas.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 50, marginBottom: 10 }}>📬</div>
                  <p style={{
                    fontFamily: HAND, fontSize: 18,
                    color: 'var(--text-faint)', margin: 0,
                  }}>~ sin solicitudes ~</p>
                </div>
              ) : (
                <>
                  {solicitudes.length > 0 && (
                    <>
                      <p style={{
                        fontFamily: HAND, fontSize: 16, fontWeight: 900,
                        color: '#a78bfa', margin: '14px 16px 8px',

                        transform: 'rotate(-1deg)', display: 'inline-block',
                      }}>
                        📥 {idioma === 'en' ? 'Received' : 'Recibidas'}
                      </p>
                      {solicitudes.map(s => (
                        <div key={s.id} style={{
                          padding: '10px 14px',
                          display: 'flex', gap: 10, alignItems: 'center',
                          borderBottom: '1.5px dashed var(--border-color)',
                        }}>
                          <Av user={s.partner} size={42} onClick={() => router.push(`/u/${s.partner.user_id}`)} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{
                              fontFamily: HAND, fontSize: 17, fontWeight: 800,
                              color: 'var(--text-primary)', margin: '0 0 1px',
                            }}>{s.partner.nombre}</p>
                            <p style={{
                              fontFamily: BODY, fontSize: 12,
                              color: 'var(--text-faint)', margin: 0,
                            }}>~ {fmtTime(s.created_at)} ~</p>
                          </div>
                          <button onClick={() => responder(s.id, 'accept')} disabled={accionando === s.id}
                            style={{
                              padding: '6px 14px',
                              borderRadius: 8,
                              border: '2px solid var(--text-primary)',
                              background: '#4ade80', color: '#000',
                              fontFamily: HAND, fontSize: 15, fontWeight: 800,
                              cursor: 'pointer',
                              boxShadow: '1px 2px 0 var(--text-primary)',
                              transform: 'rotate(-2deg)',
                            }}>✅</button>
                          <button onClick={() => responder(s.id, 'reject')} disabled={accionando === s.id}
                            style={{
                              padding: '6px 10px', borderRadius: 8,
                              border: '1.5px dashed var(--red)',
                              background: 'transparent', color: 'var(--red)',
                              fontFamily: HAND, fontSize: 15, fontWeight: 800,
                              cursor: 'pointer',
                              transform: 'rotate(2deg)',
                            }}>✕</button>
                        </div>
                      ))}
                    </>
                  )}
                  {enviadas.length > 0 && (
                    <>
                      <p style={{
                        fontFamily: HAND, fontSize: 16, fontWeight: 900,
                        color: 'var(--text-faint)', margin: '14px 16px 8px',

                        transform: 'rotate(-1deg)', display: 'inline-block',
                      }}>
                        📤 {idioma === 'en' ? 'Sent' : 'Enviadas'}
                      </p>
                      {enviadas.map(s => (
                        <div key={s.id} style={{
                          padding: '10px 14px',
                          display: 'flex', gap: 10, alignItems: 'center',
                          borderBottom: '1.5px dashed var(--border-color)',
                          opacity: 0.7,
                        }}>
                          <Av user={s.partner} size={42} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{
                              fontFamily: HAND, fontSize: 17, fontWeight: 800,
                              color: 'var(--text-primary)', margin: '0 0 1px',
                            }}>{s.partner.nombre}</p>
                            <p style={{
                              fontFamily: BODY, fontSize: 12,
                              color: 'var(--text-faint)', margin: 0,
                            }}>~ ⏳ pendiente ~</p>
                          </div>
                          <button onClick={() => eliminar(s.id)}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 8,
                              border: '1.5px dashed var(--text-faint)',
                              background: 'transparent', color: 'var(--text-faint)',
                              fontFamily: HAND, fontSize: 14, fontWeight: 800,
                              cursor: 'pointer',
                              transform: 'rotate(1deg)',
                            }}>
                            cancelar
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* BUSCAR */}
          {vista === 'buscar' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '2px dashed var(--border-color)', flexShrink: 0 }}>
                <input autoFocus value={busqueda} onChange={(e: any) => setBusqueda(e.target.value)} placeholder="🔍 buscar usuarios..."
                  style={{
                    width: '100%', padding: '8px 14px',
                    borderRadius: 10,
                    border: '2.5px solid var(--text-primary)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontFamily: HAND, fontSize: 16, fontWeight: 600,
                    outline: 'none', boxSizing: 'border-box',
                    boxShadow: '2px 2px 0 var(--text-primary)',
                    transform: 'rotate(-0.3deg)',
                  }}
                />
                <p style={{
                  fontFamily: BODY, fontSize: 13,
                  color: 'var(--text-faint)', margin: '6px 0 0',
                }}>
                  {buscando ? '~ ⏳ buscando ~' : busqueda ? `~ ${listaUsuarios.length} resultados ~` : `~ 🌍 ${todosUsers.length} usuarios ~`}
                </p>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {listaUsuarios.map(u => {
                  const est = getEstado(u.user_id);
                  return (
                    <div key={u.user_id} style={{
                      padding: '10px 14px',
                      display: 'flex', gap: 10, alignItems: 'center',
                      borderBottom: '1.5px dashed var(--border-color)',
                    }}>
                      <Av user={u} size={42} onClick={() => router.push(`/u/${u.user_id}`)} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontFamily: HAND, fontSize: 17, fontWeight: 800,
                          color: 'var(--text-primary)',
                          margin: '0 0 1px',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{u.nombre}</p>
                        {u.carrera && (
                          <p style={{
                            fontFamily: HAND, fontSize: 13,
                            color: 'var(--blue)', margin: 0,
                          }}>~ 🎓 {u.carrera} ~</p>
                        )}
                      </div>
                      <button onClick={() => router.push(`/u/${u.user_id}`)}
                        style={{
                          padding: '6px 8px', borderRadius: 8,
                          border: '1.5px dashed var(--text-faint)',
                          background: 'transparent', color: 'var(--text-muted)',
                          fontSize: 14, cursor: 'pointer',
                          transform: 'rotate(-1deg)',
                        }}>🌐</button>
                      {est === 'ninguno' && (
                        <button onClick={() => enviarSolicitud(u.user_id)} disabled={accionando === u.user_id}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '2px solid var(--text-primary)',
                            background: '#38bdf8', color: '#000',
                            fontFamily: HAND, fontSize: 15, fontWeight: 800,
                            cursor: 'pointer',
                            boxShadow: '1px 2px 0 var(--text-primary)',
                            transform: 'rotate(-2deg)',
                          }}>
                          {accionando === u.user_id ? '⏳' : '👥 +'}
                        </button>
                      )}
                      {est === 'partner' && (
                        <span style={{
                          padding: '5px 10px', borderRadius: 8,
                          background: 'color-mix(in srgb,#4ade80 18%,transparent)',
                          border: '1.5px solid #4ade80',
                          color: '#16a34a',
                          fontFamily: HAND, fontSize: 14, fontWeight: 800,
                          transform: 'rotate(1deg)',
                        }}>✅</span>
                      )}
                      {est === 'enviada' && (
                        <span style={{
                          padding: '5px 10px', borderRadius: 8,
                          background: 'var(--bg-secondary)',
                          border: '1.5px dashed var(--text-faint)',
                          color: 'var(--text-faint)',
                          fontFamily: HAND, fontSize: 14, fontWeight: 800,

                          transform: 'rotate(-1deg)',
                        }}>⏳</span>
                      )}
                      {est === 'recibida' && (
                        <button onClick={() => { const s = solicitudes.find(x => x.partner.user_id === u.user_id); if (s) responder(s.id, 'accept'); }}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '2px solid var(--text-primary)',
                            background: '#4ade80', color: '#000',
                            fontFamily: HAND, fontSize: 15, fontWeight: 800,
                            cursor: 'pointer',
                            boxShadow: '1px 2px 0 var(--text-primary)',
                            transform: 'rotate(-2deg)',
                          }}>✅</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Vista chat desktop */}
        {!isMobile && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
            {chatActivo ? (
              <ChatView partner={chatActivo.partner} chatId={chatActivo.id} wallpaper={chatActivo.wallpaper_url}
                miUserId={miUserId} miInfo={miInfo}
                onBack={() => setChatActivo(null)}
                onChatDeleted={() => { setChatActivo(null); cargarTodo(); }}
                token={token} isMobile={false} />
            ) : (
              <div style={{
                flex: 1, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 16,
              }}>
                <div style={{
                  background: 'var(--bg-card)',
                  border: '2.5px dashed var(--border-color)',
                  borderRadius: 16,
                  padding: '40px 30px',
                  textAlign: 'center',
                  transform: 'rotate(-0.5deg)',
                  maxWidth: 380,
                }}>
                  <div style={{ fontSize: 72, marginBottom: 12 }}>👥</div>
                  <p style={{
                    fontFamily: HAND, fontSize: 24, fontWeight: 900,
                    color: 'var(--text-primary)',
                    margin: '0 0 6px',
                    transform: 'rotate(-1deg)', display: 'inline-block',
                  }}>
                    Selecciona una conversación
                  </p>
                  <p style={{
                    fontFamily: BODY, fontSize: 16,
                    color: 'var(--text-muted)', margin: '0 0 20px',
                  }}>
                    ~ o busca nuevos partners ~
                  </p>
                  <button onClick={() => setVista('buscar')}
                    style={{
                      padding: '10px 22px',
                      borderRadius: 12,
                      border: '2.5px solid var(--text-primary)',
                      background: '#38bdf8', color: '#000',
                      fontFamily: HAND, fontSize: 19, fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '3px 4px 0 var(--text-primary)',
                      transform: 'rotate(-1deg)',
                    }}>
                    🔍 Buscar Partners
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}