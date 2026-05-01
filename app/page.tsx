'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Materia } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { getMateriasDB } from '../lib/db';
import UserMenu from '../components/UserMenu';
import Buscador from '../components/Buscador';
import NavbarMobile from '../components/NavbarMobile';
import OnboardingCheck from '../components/OnboardingCheck';
import { BetaBadge } from '../components/BetaBanner';
import { useDarkMode } from '../hooks/useDarkMode';
import { useIsMobile } from '../hooks/useIsMobile';
import { useIdioma } from '../hooks/useIdioma';
import DailyReward, { shouldShowDailyReward } from '../components/DailyReward';
import { darXP } from '../lib/xpClient';
import Footer from '../components/Footer';

interface Vec2 { x: number; y: number; }

interface MapNode {
  id: string; x: number; y: number;
  emoji: string; label: string; sublabel?: string;
  color: string; href?: string;
  w: number; h: number;
  type: 'brand' | 'nav' | 'stat' | 'leaderboard' | 'footer' | 'materia' | 'label';
  ring?: number;
}

interface Connection { from: string; to: string; color?: string; solid?: boolean; }

export default function Home() {
  const { darkMode, toggle: toggleDark } = useDarkMode();
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [verificando, setVerificando] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [showBuscador, setShowBuscador] = useState(false);
  const [showDaily, setShowDaily] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const isDragging = useRef(false);
  const lastPos = useRef<Vec2>({ x: 0, y: 0 });
  const tPan = useRef<Vec2>({ x: 0, y: 0 });
  const tZoom = useRef(1);
  const cPan = useRef<Vec2>({ x: 0, y: 0 });
  const cZoom = useRef(1);
  const animRef = useRef<number>();
  const fitted = useRef(false);

  const [showFooter, setShowFooter] = useState(false);
  const [showSugerencia, setShowSugerencia] = useState(false);
  const [sugerencia, setSugerencia] = useState('');
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setLoggedIn(true); setVerificando(false);
        const user = data.session.user;
        const nombre = user.user_metadata?.nombre || user.email?.split('@')[0] || '';
        const loginKey = `studyal_login_notified_${new Date().toDateString()}`;
        if (!sessionStorage.getItem(loginKey)) {
          sessionStorage.setItem(loginKey, 'true');
          fetch('/api/notify-new-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, email: user.email, es_login: true }) }).catch(() => {});
        }
        import('../lib/racha').then(({ cargarRachaDesdeDB }) => cargarRachaDesdeDB())
          .then(() => { if (shouldShowDailyReward()) setShowDaily(true); })
          .catch(() => { if (shouldShowDailyReward()) setShowDaily(true); });
      } else { setLoggedIn(false); setVerificando(false); }
    });
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) getMateriasDB(data.user.id).then(setMaterias);
    }).catch(() => {});
    fetch('/api/leaderboard').then(r => r.json()).then(d => {
      if (d.success && d.data) setLeaderboard(d.data.slice(0, 5));
    }).catch(() => {});
  }, [loggedIn]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (loggedIn) setShowBuscador(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loggedIn]);

  // Animation loop
  useEffect(() => {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const tick = () => {
      cPan.current.x = lerp(cPan.current.x, tPan.current.x, 0.12);
      cPan.current.y = lerp(cPan.current.y, tPan.current.y, 0.12);
      cZoom.current = lerp(cZoom.current, tZoom.current, 0.12);
      if (Math.abs(cPan.current.x - tPan.current.x) > 0.05 || Math.abs(cPan.current.y - tPan.current.y) > 0.05 || Math.abs(cZoom.current - tZoom.current) > 0.0005) {
        setPan({ x: cPan.current.x, y: cPan.current.y });
        setZoom(cZoom.current);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  // Auto-fit on load
  useEffect(() => {
    if (fitted.current || verificando || isMobile) return;
    const timer = setTimeout(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight - 62;
      const mapW = 1400;
      const mapH = 1100;
      const fitZoom = Math.min(vw / mapW, vh / mapH, 1) * 0.88;
      tZoom.current = fitZoom;
      cZoom.current = fitZoom * 0.5;
      tPan.current = { x: 0, y: -20 };
      fitted.current = true;
    }, 100);
    return () => clearTimeout(timer);
  }, [verificando, isMobile]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-clickable]')) return;
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    tPan.current = { x: tPan.current.x + e.clientX - lastPos.current.x, y: tPan.current.y + e.clientY - lastPos.current.y };
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerUp = useCallback(() => { isDragging.current = false; }, []);
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    tZoom.current = Math.min(Math.max(tZoom.current * (e.deltaY > 0 ? 0.93 : 1.07), 0.25), 2.5);
  }, []);

  const goAuth = () => { window.location.href = '/auth'; };
  const go = (href: string) => loggedIn ? (window.location.href = href) : goAuth();
  const handleXPGained = async (xp: number) => { if (xp !== 0) await darXP('racha', xp, { source: 'daily_reward' }); };
  const resetView = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight - 62;
    tZoom.current = Math.min(vw / 1400, vh / 1100, 1) * 0.88;
    tPan.current = { x: 0, y: -20 };
  };

  const totalAp = materias.reduce((a, m) => a + m.temas.reduce((b, t) => b + t.apuntes.length, 0), 0);
  const totalDoc = materias.reduce((a, m) => a + m.temas.reduce((b, t) => b + t.documentos.length, 0), 0);
  const totalFl = materias.reduce((a, m) => a + m.temas.reduce((b, t) => b + t.documentos.reduce((c, d) => c + (d.flashcards?.length || 0), 0), 0), 0);

  const enviarSug = async () => {
    if (!sugerencia.trim()) return;
    try { await fetch('/api/sugerencia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje: sugerencia }) }); } catch {}
    setEnviado(true); setSugerencia('');
    setTimeout(() => { setEnviado(false); setShowSugerencia(false); setShowFooter(false); }, 2000);
  };

  if (verificando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <div style={{ width: '72px', height: '72px', borderRadius: '18px', border: '2px solid var(--gold-border)', overflow: 'hidden', background: 'var(--bg-card)', animation: 'pulse 1.5s infinite' }}>
          <img src="/logo.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.parentElement.innerHTML = '📚'; }} />
        </div>
        <p style={{ color: 'var(--text-faint)', fontSize: '13px', fontWeight: 600 }}>Cargando StudyAL...</p>
      </div>
    );
  }

  if (isMobile) {
    const items = [
      { emoji: '📚', label: tr('misMaterias'), color: 'var(--gold)', href: '/materias' },
      { emoji: '🤖', label: 'ChapBot', color: 'var(--pink)', href: '/chat' },
      { emoji: '🎴', label: 'Flashcards', color: 'var(--red)', href: '/quizzes' },
      { emoji: '📅', label: tr('agenda'), color: 'var(--blue)', href: '/agenda' },
      { emoji: '🗓️', label: tr('horario'), color: 'var(--gold)', href: '/horario' },
      { emoji: '🌍', label: tr('comunidad'), color: '#34d399', href: '/comunidad' },
      { emoji: '👥', label: 'Partners', color: '#38bdf8', href: '/partners' },
      { emoji: '⏱️', label: 'Pomodoro', color: '#ef4444', href: '/pomodoro' },
      { emoji: '📊', label: tr('perfil'), color: '#a78bfa', href: '/perfil' },
      { emoji: '⚙️', label: tr('configuracion'), color: 'var(--text-faint)', href: '/settings' },
    ];
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        {showDaily && <DailyReward onClose={() => setShowDaily(false)} onXPGained={handleXPGained} />}
        {loggedIn && <OnboardingCheck />}
        {loggedIn ? <NavbarMobile darkMode={darkMode} onToggleDark={toggleDark} /> : (
          <header style={{ height: '56px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', padding: '0 16px', position: 'sticky', top: 0, zIndex: 100, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="brand-studyal" style={{ fontSize: '18px' }}><span className="brand-study">Study</span><span className="brand-al">AL</span></span>
            <button onClick={goAuth} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>Entrar</button>
          </header>
        )}
        {loggedIn && showBuscador && <Buscador onClose={() => setShowBuscador(false)} />}
        <div style={{ padding: '24px 16px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ width: '72px', height: '72px', borderRadius: '18px', border: '2px solid var(--gold-border)', overflow: 'hidden', margin: '0 auto 14px', background: 'var(--bg-card)' }}>
              <img src="/logo.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.parentElement.innerHTML = '📚'; }} />
            </div>
            <h1 style={{ fontSize: '28px', fontWeight: 900, margin: '0 0 6px' }}><span className="brand-studyal"><span className="brand-study-hero">Study</span><span className="brand-al-hero">AL</span></span></h1>
            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', margin: '8px 0 12px' }}>{['var(--gold)','var(--red)','var(--blue)','var(--pink)'].map((c,i)=><div key={i} style={{width:'20px',height:'3px',background:c,borderRadius:'2px'}}/>)}</div>
            <button onClick={() => go('/materias')} style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 900, cursor: 'pointer' }}>🚀 {loggedIn ? tr('irAMaterias') : 'Comenzar'}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '10px' }}>
            {items.map((item,i) => (
              <div key={i} onClick={() => go(item.href)} style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer' }}>
                <div style={{ height: '3px', background: item.color }} /><div style={{ padding: '16px 14px' }}><div style={{ fontSize: '24px', marginBottom: '6px' }}>{item.emoji}</div><div style={{ fontSize: '13px', fontWeight: 800 }}>{item.label}</div></div>
              </div>
            ))}
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // ═══ BUILD MAP ═══
  // Layout:
  //                    [Comunidad]
  //                        |
  //          [Horario]─[MATERIAS]─[Flashcards]
  //                  \     |     /
  //                   [STUDYAL]
  //                  /     |     \
  //          [Partners]─[AGENDA]─[Pomodoro]
  //                        |
  //                    [Chat AI]
  //
  // Left cluster: Stats    Right cluster: Leaderboard
  // Bottom: Materias row + Settings/Perfil + Footer

  const nodes: MapNode[] = [];
  const conns: Connection[] = [];

  // ── BRAND CENTER ──
  nodes.push({ id: 'brand', x: 0, y: 0, emoji: '', label: 'StudyAL', color: 'var(--gold)', w: 180, h: 180, type: 'brand' });

  // ── RING 1: 4 cardinal directions ──
  // UP = Materias (main action)
  // RIGHT = Chat AI
  // DOWN = Agenda
  // LEFT = Comunidad
  const R1 = 240;
  const core = [
    { id: 'materias',  emoji: '📚', label: tr('misMaterias'),  sublabel: idioma==='en'?'Notes & topics':'Apuntes y temas', color: 'var(--gold)', href: '/materias',  x: 0,   y: -R1 },
    { id: 'chat',      emoji: '🤖', label: 'ChapBot AI',      sublabel: idioma==='en'?'AI tutor':'Tutor IA',               color: 'var(--pink)', href: '/chat',      x: R1,  y: 0 },
    { id: 'agenda',    emoji: '📅', label: tr('agenda'),       sublabel: idioma==='en'?'Goals':'Objetivos',                 color: 'var(--blue)', href: '/agenda',    x: 0,   y: R1 },
    { id: 'comunidad', emoji: '🌍', label: tr('comunidad'),    sublabel: idioma==='en'?'Community':'Comparte',              color: '#34d399',     href: '/comunidad', x: -R1, y: 0 },
  ];
  core.forEach(c => {
    nodes.push({ ...c, w: 125, h: 125, type: 'nav', ring: 1 });
    conns.push({ from: 'brand', to: c.id, color: c.color, solid: true });
  });

  // ── RING 2: each child hangs from its logical parent ──
  const R2 = 180;
  const secondary = [
    { id: 'horario',    emoji: '🗓️', label: tr('horario'),  sublabel: idioma==='en'?'Schedule':'Clases',     color: 'var(--gold)', href: '/horario',   parent: 'materias',  dx: -R2, dy: 0 },
    { id: 'flashcards', emoji: '🎴', label: 'Flashcards',   sublabel: idioma==='en'?'Cards':'Tarjetas',      color: 'var(--red)',  href: '/quizzes',   parent: 'materias',  dx: R2,  dy: 0 },
    { id: 'partners',   emoji: '👥', label: 'Partners',     sublabel: idioma==='en'?'Buddies':'Compañeros',  color: '#38bdf8',     href: '/partners',  parent: 'comunidad', dx: 0,   dy: -R2*0.7 },
    { id: 'pomodoro',   emoji: '⏱️', label: 'Pomodoro',     sublabel: 'Timer',                                color: '#ef4444',     href: '/pomodoro',  parent: 'agenda',    dx: R2,  dy: 0 },
  ];
  secondary.forEach(s => {
    const parentNode = core.find(c => c.id === s.parent)!;
    const { parent, dx, dy, ...rest } = s;
    nodes.push({ ...rest, x: parentNode.x + dx, y: parentNode.y + dy, w: 100, h: 100, type: 'nav', ring: 2 });
    conns.push({ from: parent, to: s.id, color: s.color });
  });

  // ── STATS CLUSTER (upper-left) ──
  if (loggedIn) {
    const sx = -480, sy = -320;
    nodes.push({ id: 'lbl-stats', x: sx, y: sy - 75, emoji: '', label: idioma==='en'?'📊 My Stats':'📊 Mis Stats', color: '', w: 110, h: 24, type: 'label' });
    const stats = [
      { id: 's-mat', emoji: '📚', label: tr('materias'), sublabel: String(materias.length), color: 'var(--gold)' },
      { id: 's-ap',  emoji: '✏️', label: tr('apuntes'),  sublabel: String(totalAp),         color: 'var(--pink)' },
      { id: 's-doc', emoji: '📄', label: 'Docs',         sublabel: String(totalDoc),        color: 'var(--blue)' },
      { id: 's-fl',  emoji: '🎴', label: 'Flash',        sublabel: String(totalFl),         color: 'var(--red)' },
    ];
    stats.forEach((s, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      nodes.push({ ...s, x: sx + col * 100 - 50, y: sy + row * 100 - 50, w: 88, h: 88, type: 'stat' });
    });
    conns.push({ from: 'brand', to: 's-mat', color: 'var(--gold)' });
    conns.push({ from: 's-mat', to: 's-ap' });
    conns.push({ from: 's-mat', to: 's-doc' });
    conns.push({ from: 's-ap', to: 's-fl' });
    conns.push({ from: 's-doc', to: 's-fl' });
  }

  // ── LEADERBOARD (upper-right) ──
  if (loggedIn) {
    const lx = 480, ly = -300;
    nodes.push({ id: 'lbl-lb', x: lx, y: ly - 95, emoji: '', label: '🏆 Leaderboard', color: '', w: 120, h: 24, type: 'label' });
    nodes.push({ id: 'leaderboard', x: lx, y: ly, emoji: '🏆', label: 'Top 5', color: 'var(--gold)', w: 240, h: 210, type: 'leaderboard', href: '/perfil' });
    conns.push({ from: 'brand', to: 'leaderboard', color: 'var(--gold)' });
  }

  // ── MATERIAS ROW (bottom) ──
  if (loggedIn && materias.length > 0) {
    const my = 420;
    nodes.push({ id: 'lbl-mat', x: 0, y: my - 65, emoji: '', label: idioma==='en'?'🗂️ My Subjects':'🗂️ Mis Materias', color: '', w: 140, h: 24, type: 'label' });
    const max = Math.min(materias.length, 7);
    const gap = Math.min(110, 700 / max);
    materias.slice(0, max).forEach((m, i) => {
      const mx = (i - (max - 1) / 2) * gap;
      nodes.push({
        id: `m-${m.id}`, emoji: m.emoji,
        label: m.nombre.length > 11 ? m.nombre.slice(0,11)+'…' : m.nombre,
        sublabel: `${m.temas.length} ${tr('temas')}`,
        color: m.color, href: '/materias',
        x: mx, y: my, w: 88, h: 88, type: 'materia',
      });
      conns.push({ from: 'materias', to: `m-${m.id}`, color: m.color });
      if (i > 0) conns.push({ from: `m-${materias[i-1].id}`, to: `m-${m.id}` });
    });
  }

  // ── SETTINGS + PERFIL (lower corners) ──
  nodes.push({ id: 'perfil',   emoji: '📊', label: tr('perfil'),         sublabel: 'Stats',                                color: '#a78bfa',         href: '/perfil',   x: 400,  y: 330, w: 85, h: 85, type: 'nav', ring: 3 });
  nodes.push({ id: 'settings', emoji: '⚙️', label: tr('configuracion'), sublabel: idioma==='en'?'Preferences':'Ajustes', color: 'var(--text-faint)', href: '/settings', x: -400, y: 330, w: 85, h: 85, type: 'nav', ring: 3 });
  conns.push({ from: 'agenda', to: 'perfil', color: '#a78bfa' });
  conns.push({ from: 'comunidad', to: 'settings' });

  // ── FOOTER NODE (bottom center) ──
  nodes.push({ id: 'footer', x: 0, y: 520, emoji: '💛', label: 'StudyAL', sublabel: `© ${new Date().getFullYear()}`, color: 'var(--text-faint)', w: 90, h: 75, type: 'footer' });
  conns.push({ from: 'brand', to: 'footer' });

  // ═══ RENDER ═══
  const renderNode = (n: MapNode) => {
    const isH = hoveredNode === n.id;

    if (n.type === 'label') return (
      <div key={n.id} style={{ position: 'absolute', left: n.x - n.w/2, top: n.y - n.h/2, width: n.w, textAlign: 'center', pointerEvents: 'none', zIndex: 1 }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-faint)', letterSpacing: '0.5px', textTransform: 'uppercase', opacity: 0.5 }}>{n.label}</span>
      </div>
    );

    if (n.type === 'brand') return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} onClick={resetView}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: n.h, borderRadius: '40px',
          background: 'var(--bg-card)', border: `2px solid ${isH?'var(--gold)':'var(--border-color)'}`,
          boxShadow: '0 0 80px var(--gold-dim), 0 0 140px rgba(245,200,66,0.06), 0 8px 40px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
          cursor: 'pointer', transition: 'all .25s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.05)':'scale(1)', zIndex: 20, overflow: 'hidden',
        }}>
        <div style={{ position: 'absolute', inset: '-10px', borderRadius: '50px', border: '2px solid var(--gold)', opacity: .12, animation: 'ring 3s ease-in-out infinite', pointerEvents: 'none' }} />
        <div style={{ width: '50px', height: '50px', borderRadius: '14px', border: '2px solid var(--gold-border)', overflow: 'hidden', background: 'var(--bg-card2)' }}>
          <img src="/logo.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.parentElement.innerHTML = '📚'; }} />
        </div>
        <span className="brand-studyal" style={{ fontSize: '24px' }}><span className="brand-study-hero">Study</span><span className="brand-al-hero">AL</span></span>
        <div style={{ display: 'flex', gap: '3px' }}>{['var(--gold)','var(--red)','var(--blue)','var(--pink)'].map((c,i) => <div key={i} style={{ width: '14px', height: '3px', background: c, borderRadius: '2px' }} />)}</div>
        <span style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600, maxWidth: '120px', textAlign: 'center', lineHeight: 1.3 }}>{tr('miPlataforma')}</span>
      </div>
    );

    if (n.type === 'leaderboard') return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} onClick={() => go('/perfil')}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: 'auto', minHeight: n.h*0.6,
          borderRadius: '20px', background: isH?'color-mix(in srgb, var(--gold) 8%, var(--bg-card))':'var(--bg-card)',
          border: `${isH?2:1.5}px solid ${isH?'var(--gold)':'var(--border-color)'}`,
          boxShadow: isH?'0 0 0 3px var(--gold-dim), 0 12px 36px rgba(245,200,66,0.12)':'0 3px 16px rgba(0,0,0,0.25)',
          cursor: 'pointer', transition: 'all .22s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.04) translateY(-3px)':'scale(1)', zIndex: isH?15:5, overflow: 'hidden',
        }}>
        <div style={{ height: '4px', background: 'var(--gold)' }} />
        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '20px' }}>🏆</span><span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--gold)' }}>Top 5</span>
          </div>
          {leaderboard.length > 0 ? leaderboard.map((u: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '8px', background: i===0?'var(--gold-dim)':'transparent', border: i===0?'1px solid var(--gold-border)':'1px solid transparent', marginBottom: '3px' }}>
              <span style={{ fontSize: '13px', fontWeight: 900, color: i===0?'var(--gold)':i===1?'var(--text-secondary)':'var(--text-faint)', width: '18px', textAlign: 'center' }}>{i===0?'👑':i===1?'🥈':i===2?'🥉':`${i+1}`}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nombre||'Anon'}</span>
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--gold)', background: 'var(--gold-dim)', padding: '2px 7px', borderRadius: '8px' }}>{u.xp_total?.toLocaleString()||0}</span>
            </div>
          )) : <p style={{ fontSize: '10px', color: 'var(--text-faint)', textAlign: 'center', padding: '8px 0' }}>...</p>}
        </div>
      </div>
    );

    if (n.type === 'stat') return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: n.h, borderRadius: '18px',
          background: isH?`color-mix(in srgb, ${n.color} 12%, var(--bg-card))`:'var(--bg-card)',
          border: `${isH?2:1.5}px solid ${isH?n.color:'var(--border-color)'}`,
          boxShadow: isH?`0 0 0 3px ${n.color}12, 0 8px 24px rgba(0,0,0,0.3)`:'0 2px 10px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
          transition: 'all .22s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.1)':'scale(1)', zIndex: isH?10:2,
        }}>
        <span style={{ fontSize: '15px' }}>{n.emoji}</span>
        <span style={{ fontSize: '20px', fontWeight: 900, color: n.color, lineHeight: 1 }}>{n.sublabel}</span>
        <span style={{ fontSize: '8px', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{n.label}</span>
      </div>
    );

    if (n.type === 'footer') return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} onClick={() => setShowFooter(true)}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: n.h, borderRadius: '18px',
          background: isH?'color-mix(in srgb, var(--gold) 8%, var(--bg-card))':'var(--bg-card)',
          border: `1.5px solid ${isH?'var(--gold-border)':'var(--border-color)'}`, boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', cursor: 'pointer',
          transition: 'all .22s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.1)':'scale(1)', zIndex: isH?10:2,
        }}>
        <span style={{ fontSize: '18px' }}>💛</span>
        <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-muted)' }}>StudyAL</span>
        <span style={{ fontSize: '7px', color: 'var(--text-faint)' }}>© {new Date().getFullYear()}</span>
      </div>
    );

    // NAV + MATERIA (same renderer)
    const isMat = n.type === 'materia';
    return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} onClick={() => go(n.href||'/')}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: n.h,
          borderRadius: n.w > 110 ? '26px' : '20px',
          background: isH?`color-mix(in srgb, ${n.color} 14%, var(--bg-card))`:'var(--bg-card)',
          border: `${isH?2:1.5}px solid ${isH?n.color:'var(--border-color)'}`,
          boxShadow: isH?`0 0 0 3px ${n.color}12, 0 10px 32px ${n.color}18, 0 4px 14px rgba(0,0,0,0.3)`:'0 2px 12px rgba(0,0,0,0.22)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '4px', padding: '8px 6px', cursor: 'pointer', overflow: 'hidden',
          transition: 'all .22s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.1) translateY(-3px)':'scale(1)',
          zIndex: isH?10: n.ring===1?5 : n.ring===2?3 : 2,
        }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: n.ring===1?'4px':'3px', background: n.color }} />
        {n.id === 'materias' && <div style={{ position: 'absolute', inset: '-6px', borderRadius: '32px', border: `1.5px solid ${n.color}`, opacity: isH?.4:.12, animation: 'ring 2.5s ease-in-out infinite', pointerEvents: 'none' }} />}
        <span style={{ fontSize: n.w > 110 ? '30px' : isMat ? '22px' : '24px', lineHeight: 1 }}>{n.emoji}</span>
        <span style={{ fontSize: n.w > 110 ? '12px' : '10px', fontWeight: 800, color: isH?n.color:'var(--text-primary)', textAlign: 'center', lineHeight: 1.2, transition: 'color .2s' }}>{n.label}</span>
        {isH && n.sublabel && <span style={{ fontSize: '9px', color: 'var(--text-faint)', textAlign: 'center', animation: 'fadeIn .15s' }}>{n.sublabel}</span>}
        {n.id === 'materias' && loggedIn && <span style={{ fontSize: '8px', background: 'var(--gold-dim)', color: 'var(--gold)', padding: '1px 6px', borderRadius: '8px', fontWeight: 700, border: '1px solid var(--gold-border)', opacity: isH?1:.5 }}>{materias.length}</span>}
      </div>
    );
  };

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)', position: 'relative', fontFamily: '-apple-system, sans-serif' }}>
      {showDaily && <DailyReward onClose={() => setShowDaily(false)} onXPGained={handleXPGained} />}
      {loggedIn && <OnboardingCheck />}
      {loggedIn && showBuscador && <Buscador onClose={() => setShowBuscador(false)} />}

      {/* NAVBAR */}
      <header style={{
        position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 200,
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'color-mix(in srgb, var(--bg-card) 88%, transparent)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--border-color)', borderRadius: '14px', padding: '7px 14px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      }}>
        <img src="/logo.png" alt="" style={{ width: '26px', height: '26px', borderRadius: '7px', objectFit: 'cover', border: '1px solid var(--gold-border)', cursor: 'pointer' }} onClick={resetView} onError={(e: any) => { e.target.style.display = 'none'; }} />
        <span className="brand-studyal" style={{ fontSize: '15px', cursor: 'pointer' }} onClick={resetView}><span className="brand-study">Study</span><span className="brand-al">AL</span></span>
        <BetaBadge />
        <div style={{ width: '1px', height: '18px', background: 'var(--border-color)', margin: '0 2px' }} />
        {loggedIn ? (<>
          <button data-clickable onClick={() => setShowBuscador(true)} style={{ padding: '4px 9px', borderRadius: '7px', border: '1px solid var(--border-color2)', background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>🔍<span style={{ fontSize: '9px', background: 'var(--bg-secondary)', padding: '1px 3px', borderRadius: '3px' }}>⌘K</span></button>
          <button data-clickable onClick={toggleDark} style={{ padding: '4px 7px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>{darkMode?'☀️':'🌙'}</button>
          <UserMenu />
        </>) : (<>
          <button data-clickable onClick={toggleDark} style={{ padding: '4px 7px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>{darkMode?'☀️':'🌙'}</button>
          <button data-clickable onClick={goAuth} style={{ padding: '4px 12px', borderRadius: '7px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>{idioma==='en'?'Get Started':'Comenzar'}</button>
        </>)}
      </header>

      {/* CANVAS */}
      <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onWheel={onWheel}
        style={{ width: '100%', height: '100%', cursor: isDragging.current?'grabbing':'grab', userSelect: 'none', touchAction: 'none' }}>

        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs><pattern id="dots" x={((pan.x%(22*zoom))+22*zoom)%(22*zoom)} y={((pan.y%(22*zoom))+22*zoom)%(22*zoom)} width={22*zoom} height={22*zoom} patternUnits="userSpaceOnUse"><circle cx={1} cy={1} r={0.6} fill="var(--border-color2)" opacity="0.35" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>

        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 55%, var(--bg-primary) 100%)', opacity: 0.45 }} />

        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`, transformOrigin: '0 0', willChange: 'transform' }}>
          <svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none', top: 0, left: 0 }}>
            {conns.map((c, i) => {
              const f = nodes.find(n => n.id === c.from), t = nodes.find(n => n.id === c.to);
              if (!f || !t) return null;
              const isH = hoveredNode === c.from || hoveredNode === c.to;
              const ang = Math.atan2(t.y-f.y, t.x-f.x);
              const mx = (f.x+t.x)/2, my = (f.y+t.y)/2;
              const dist = Math.sqrt((t.x-f.x)**2+(t.y-f.y)**2);
              const curve = Math.min(dist*0.1, 40);
              const cx = mx - Math.sin(ang)*curve, cy = my + Math.cos(ang)*curve;
              return <path key={i} d={`M ${f.x} ${f.y} Q ${cx} ${cy} ${t.x} ${t.y}`} fill="none" stroke={isH?(c.color||f.color):'var(--border-color2)'} strokeWidth={isH?(c.solid?2.5:2):(c.solid?1.2:0.8)} strokeDasharray={c.solid?'none':(isH?'6 4':'4 6')} opacity={isH?0.7:(c.solid?0.3:0.2)} style={{ transition: 'all .3s' }} />;
            })}
          </svg>
          {nodes.map(renderNode)}
        </div>
      </div>

      {/* CONTROLS */}
      <div style={{ position: 'absolute', bottom: '18px', right: '18px', zIndex: 100, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {[{l:'+',a:()=>{tZoom.current=Math.min(tZoom.current*1.2,2.5)}},{l:'−',a:()=>{tZoom.current=Math.max(tZoom.current*.8,.25)}},{l:'⌖',a:resetView}].map((b,i) => (
          <button key={i} data-clickable onClick={b.a} style={{ width: '34px', height: '34px', borderRadius: '9px', border: '1.5px solid var(--border-color2)', background: 'color-mix(in srgb, var(--bg-card) 92%, transparent)', backdropFilter: 'blur(12px)', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.borderColor='var(--gold)';e.currentTarget.style.color='var(--gold)'}} onMouseLeave={(e:any)=>{e.currentTarget.style.borderColor='var(--border-color2)';e.currentTarget.style.color='var(--text-primary)'}}>{b.l}</button>
        ))}
      </div>

      <div style={{ position: 'absolute', bottom: '18px', left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-color)', borderRadius: '18px', padding: '3px 12px', fontSize: '10px', color: 'var(--text-faint)', fontWeight: 600 }}>{Math.round(zoom*100)}%</div>

      <div style={{ position: 'absolute', bottom: '18px', left: '18px', zIndex: 100, display: 'flex', gap: '5px' }}>
        {['Drag → mover','Scroll → zoom'].map((h,i) => <span key={i} style={{ padding: '3px 9px', borderRadius: '18px', background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-color)', fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600 }}>{h}</span>)}
      </div>

      {!loggedIn && (
        <div style={{ position: 'absolute', bottom: '70px', left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: '8px' }}>
          <button data-clickable onClick={goAuth} style={{ padding: '11px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 900, cursor: 'pointer', boxShadow: '0 4px 20px rgba(245,200,66,0.3)' }}>🚀 {idioma==='en'?'Get Started':'Comenzar Gratis'}</button>
          <button data-clickable onClick={goAuth} style={{ padding: '11px 20px', borderRadius: '12px', border: '2px solid var(--border-color2)', background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)', backdropFilter: 'blur(12px)', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>{idioma==='en'?'Sign in':'Iniciar sesión'}</button>
        </div>
      )}

      {/* FOOTER MODAL */}
      {showFooter && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} onClick={() => setShowFooter(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: '22px', border: '1px solid var(--border-color)', width: '90%', maxWidth: '560px', maxHeight: '80vh', overflow: 'auto', padding: '28px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', animation: 'scaleIn .2s ease', position: 'relative' }}>
            <button onClick={() => setShowFooter(false)} style={{ position: 'absolute', top: '14px', right: '14px', width: '28px', height: '28px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
              <img src="/logo.png" alt="" style={{ width: '32px', height: '32px', borderRadius: '8px', objectFit: 'cover' }} onError={(e:any)=>{e.target.style.display='none'}} />
              <div><span className="brand-studyal" style={{ fontSize: '17px' }}><span className="brand-study">Study</span><span className="brand-al">AL</span></span><p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: 0 }}>{idioma==='en'?'AI-powered study platform':'Tu plataforma de estudio'}</p></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '20px', marginBottom: '18px' }}>
              <div>
                <p style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 6px' }}>{idioma==='en'?'Product':'Producto'}</p>
                {[{l:tr('misMaterias'),h:'/materias'},{l:'ChapBot',h:'/chat'},{l:tr('horario'),h:'/horario'},{l:tr('agenda'),h:'/agenda'}].map((lk,i)=><a key={i} href={lk.h} style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '4px', fontWeight: 600 }}>{lk.l}</a>)}
              </div>
              <div>
                <p style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 6px' }}>Legal</p>
                {[{l:idioma==='en'?'Terms':'Términos',h:'/legal'},{l:idioma==='en'?'Privacy':'Privacidad',h:'/legal'}].map((lk,i)=><a key={i} href={lk.h} style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '4px', fontWeight: 600 }}>{lk.l}</a>)}
              </div>
              <div>
                <p style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 6px' }}>{idioma==='en'?'Social':'Síguenos'}</p>
                <a href="https://www.tiktok.com/@studyal.app" target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '4px', fontWeight: 600 }}>TikTok</a>
                <a href="https://www.instagram.com/studyal.app" target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '4px', fontWeight: 600 }}>Instagram</a>
              </div>
            </div>
            {!showSugerencia ? (
              <button onClick={() => setShowSugerencia(true)} style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid var(--gold-border)', background: 'var(--gold-dim)', color: 'var(--gold)', fontSize: '12px', fontWeight: 800, cursor: 'pointer', marginBottom: '12px' }}>💡 {idioma==='en'?'Suggestion Box':'Buzón de sugerencias'}</button>
            ) : enviado ? (
              <div style={{ textAlign: 'center', padding: '12px 0', marginBottom: '12px' }}><span style={{ fontSize: '24px' }}>✅</span><p style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '12px', margin: '4px 0 0' }}>{idioma==='en'?'Thanks!':'¡Gracias!'}</p></div>
            ) : (
              <div style={{ marginBottom: '12px' }}>
                <textarea value={sugerencia} onChange={e=>setSugerencia(e.target.value)} placeholder={idioma==='en'?'How can we improve?':'¿Cómo podemos mejorar?'} rows={3} style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <button onClick={()=>setShowSugerencia(false)} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: '12px' }}>{idioma==='en'?'Cancel':'Cancelar'}</button>
                  <button onClick={enviarSug} disabled={!sugerencia.trim()} style={{ flex: 2, padding: '8px', borderRadius: '8px', border: 'none', background: sugerencia.trim()?'var(--gold)':'var(--bg-card2)', color: sugerencia.trim()?'#000':'var(--text-faint)', fontWeight: 800, cursor: sugerencia.trim()?'pointer':'not-allowed', fontSize: '12px' }}>📤 {idioma==='en'?'Send':'Enviar'}</button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
              <a href="mailto:studyal496@gmail.com" style={{ fontSize: '10px', color: 'var(--text-faint)', textDecoration: 'none' }}>📧 studyal496@gmail.com</a>
              <p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: 0 }}>{idioma==='en'?'Made with':'Hecho con'} 💛</p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes ring{0%,100%{transform:scale(1);opacity:.12}50%{transform:scale(1.06);opacity:.3}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.97)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
      `}</style>
    </div>
  );
}
ENDOFFILEcat > app/page.tsx << 'ENDOFFILE'
'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Materia } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { getMateriasDB } from '../lib/db';
import UserMenu from '../components/UserMenu';
import Buscador from '../components/Buscador';
import NavbarMobile from '../components/NavbarMobile';
import OnboardingCheck from '../components/OnboardingCheck';
import { BetaBadge } from '../components/BetaBanner';
import { useDarkMode } from '../hooks/useDarkMode';
import { useIsMobile } from '../hooks/useIsMobile';
import { useIdioma } from '../hooks/useIdioma';
import DailyReward, { shouldShowDailyReward } from '../components/DailyReward';
import { darXP } from '../lib/xpClient';
import Footer from '../components/Footer';

interface Vec2 { x: number; y: number; }

interface MapNode {
  id: string; x: number; y: number;
  emoji: string; label: string; sublabel?: string;
  color: string; href?: string;
  w: number; h: number;
  type: 'brand' | 'nav' | 'stat' | 'leaderboard' | 'footer' | 'materia' | 'label';
  ring?: number;
}

interface Connection { from: string; to: string; color?: string; solid?: boolean; }

export default function Home() {
  const { darkMode, toggle: toggleDark } = useDarkMode();
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [verificando, setVerificando] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [showBuscador, setShowBuscador] = useState(false);
  const [showDaily, setShowDaily] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const isDragging = useRef(false);
  const lastPos = useRef<Vec2>({ x: 0, y: 0 });
  const tPan = useRef<Vec2>({ x: 0, y: 0 });
  const tZoom = useRef(1);
  const cPan = useRef<Vec2>({ x: 0, y: 0 });
  const cZoom = useRef(1);
  const animRef = useRef<number>();
  const fitted = useRef(false);

  const [showFooter, setShowFooter] = useState(false);
  const [showSugerencia, setShowSugerencia] = useState(false);
  const [sugerencia, setSugerencia] = useState('');
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setLoggedIn(true); setVerificando(false);
        const user = data.session.user;
        const nombre = user.user_metadata?.nombre || user.email?.split('@')[0] || '';
        const loginKey = `studyal_login_notified_${new Date().toDateString()}`;
        if (!sessionStorage.getItem(loginKey)) {
          sessionStorage.setItem(loginKey, 'true');
          fetch('/api/notify-new-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, email: user.email, es_login: true }) }).catch(() => {});
        }
        import('../lib/racha').then(({ cargarRachaDesdeDB }) => cargarRachaDesdeDB())
          .then(() => { if (shouldShowDailyReward()) setShowDaily(true); })
          .catch(() => { if (shouldShowDailyReward()) setShowDaily(true); });
      } else { setLoggedIn(false); setVerificando(false); }
    });
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) getMateriasDB(data.user.id).then(setMaterias);
    }).catch(() => {});
    fetch('/api/leaderboard').then(r => r.json()).then(d => {
      if (d.success && d.data) setLeaderboard(d.data.slice(0, 5));
    }).catch(() => {});
  }, [loggedIn]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (loggedIn) setShowBuscador(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loggedIn]);

  // Animation loop
  useEffect(() => {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const tick = () => {
      cPan.current.x = lerp(cPan.current.x, tPan.current.x, 0.12);
      cPan.current.y = lerp(cPan.current.y, tPan.current.y, 0.12);
      cZoom.current = lerp(cZoom.current, tZoom.current, 0.12);
      if (Math.abs(cPan.current.x - tPan.current.x) > 0.05 || Math.abs(cPan.current.y - tPan.current.y) > 0.05 || Math.abs(cZoom.current - tZoom.current) > 0.0005) {
        setPan({ x: cPan.current.x, y: cPan.current.y });
        setZoom(cZoom.current);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  // Auto-fit on load
  useEffect(() => {
    if (fitted.current || verificando || isMobile) return;
    const timer = setTimeout(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight - 62;
      const mapW = 1400;
      const mapH = 1100;
      const fitZoom = Math.min(vw / mapW, vh / mapH, 1) * 0.88;
      tZoom.current = fitZoom;
      cZoom.current = fitZoom * 0.5;
      tPan.current = { x: 0, y: -20 };
      fitted.current = true;
    }, 100);
    return () => clearTimeout(timer);
  }, [verificando, isMobile]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-clickable]')) return;
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    tPan.current = { x: tPan.current.x + e.clientX - lastPos.current.x, y: tPan.current.y + e.clientY - lastPos.current.y };
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerUp = useCallback(() => { isDragging.current = false; }, []);
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    tZoom.current = Math.min(Math.max(tZoom.current * (e.deltaY > 0 ? 0.93 : 1.07), 0.25), 2.5);
  }, []);

  const goAuth = () => { window.location.href = '/auth'; };
  const go = (href: string) => loggedIn ? (window.location.href = href) : goAuth();
  const handleXPGained = async (xp: number) => { if (xp !== 0) await darXP('racha', xp, { source: 'daily_reward' }); };
  const resetView = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight - 62;
    tZoom.current = Math.min(vw / 1400, vh / 1100, 1) * 0.88;
    tPan.current = { x: 0, y: -20 };
  };

  const totalAp = materias.reduce((a, m) => a + m.temas.reduce((b, t) => b + t.apuntes.length, 0), 0);
  const totalDoc = materias.reduce((a, m) => a + m.temas.reduce((b, t) => b + t.documentos.length, 0), 0);
  const totalFl = materias.reduce((a, m) => a + m.temas.reduce((b, t) => b + t.documentos.reduce((c, d) => c + (d.flashcards?.length || 0), 0), 0), 0);

  const enviarSug = async () => {
    if (!sugerencia.trim()) return;
    try { await fetch('/api/sugerencia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje: sugerencia }) }); } catch {}
    setEnviado(true); setSugerencia('');
    setTimeout(() => { setEnviado(false); setShowSugerencia(false); setShowFooter(false); }, 2000);
  };

  if (verificando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <div style={{ width: '72px', height: '72px', borderRadius: '18px', border: '2px solid var(--gold-border)', overflow: 'hidden', background: 'var(--bg-card)', animation: 'pulse 1.5s infinite' }}>
          <img src="/logo.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.parentElement.innerHTML = '📚'; }} />
        </div>
        <p style={{ color: 'var(--text-faint)', fontSize: '13px', fontWeight: 600 }}>Cargando StudyAL...</p>
      </div>
    );
  }

  if (isMobile) {
    const items = [
      { emoji: '📚', label: tr('misMaterias'), color: 'var(--gold)', href: '/materias' },
      { emoji: '🤖', label: 'ChapBot', color: 'var(--pink)', href: '/chat' },
      { emoji: '🎴', label: 'Flashcards', color: 'var(--red)', href: '/quizzes' },
      { emoji: '📅', label: tr('agenda'), color: 'var(--blue)', href: '/agenda' },
      { emoji: '🗓️', label: tr('horario'), color: 'var(--gold)', href: '/horario' },
      { emoji: '🌍', label: tr('comunidad'), color: '#34d399', href: '/comunidad' },
      { emoji: '👥', label: 'Partners', color: '#38bdf8', href: '/partners' },
      { emoji: '⏱️', label: 'Pomodoro', color: '#ef4444', href: '/pomodoro' },
      { emoji: '📊', label: tr('perfil'), color: '#a78bfa', href: '/perfil' },
      { emoji: '⚙️', label: tr('configuracion'), color: 'var(--text-faint)', href: '/settings' },
    ];
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        {showDaily && <DailyReward onClose={() => setShowDaily(false)} onXPGained={handleXPGained} />}
        {loggedIn && <OnboardingCheck />}
        {loggedIn ? <NavbarMobile darkMode={darkMode} onToggleDark={toggleDark} /> : (
          <header style={{ height: '56px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', padding: '0 16px', position: 'sticky', top: 0, zIndex: 100, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="brand-studyal" style={{ fontSize: '18px' }}><span className="brand-study">Study</span><span className="brand-al">AL</span></span>
            <button onClick={goAuth} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>Entrar</button>
          </header>
        )}
        {loggedIn && showBuscador && <Buscador onClose={() => setShowBuscador(false)} />}
        <div style={{ padding: '24px 16px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ width: '72px', height: '72px', borderRadius: '18px', border: '2px solid var(--gold-border)', overflow: 'hidden', margin: '0 auto 14px', background: 'var(--bg-card)' }}>
              <img src="/logo.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.parentElement.innerHTML = '📚'; }} />
            </div>
            <h1 style={{ fontSize: '28px', fontWeight: 900, margin: '0 0 6px' }}><span className="brand-studyal"><span className="brand-study-hero">Study</span><span className="brand-al-hero">AL</span></span></h1>
            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', margin: '8px 0 12px' }}>{['var(--gold)','var(--red)','var(--blue)','var(--pink)'].map((c,i)=><div key={i} style={{width:'20px',height:'3px',background:c,borderRadius:'2px'}}/>)}</div>
            <button onClick={() => go('/materias')} style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 900, cursor: 'pointer' }}>🚀 {loggedIn ? tr('irAMaterias') : 'Comenzar'}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '10px' }}>
            {items.map((item,i) => (
              <div key={i} onClick={() => go(item.href)} style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer' }}>
                <div style={{ height: '3px', background: item.color }} /><div style={{ padding: '16px 14px' }}><div style={{ fontSize: '24px', marginBottom: '6px' }}>{item.emoji}</div><div style={{ fontSize: '13px', fontWeight: 800 }}>{item.label}</div></div>
              </div>
            ))}
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  // ═══ BUILD MAP ═══
  // Layout:
  //                    [Comunidad]
  //                        |
  //          [Horario]─[MATERIAS]─[Flashcards]
  //                  \     |     /
  //                   [STUDYAL]
  //                  /     |     \
  //          [Partners]─[AGENDA]─[Pomodoro]
  //                        |
  //                    [Chat AI]
  //
  // Left cluster: Stats    Right cluster: Leaderboard
  // Bottom: Materias row + Settings/Perfil + Footer

  const nodes: MapNode[] = [];
  const conns: Connection[] = [];

  // ── BRAND CENTER ──
  nodes.push({ id: 'brand', x: 0, y: 0, emoji: '', label: 'StudyAL', color: 'var(--gold)', w: 180, h: 180, type: 'brand' });

  // ── RING 1: 4 cardinal directions ──
  // UP = Materias (main action)
  // RIGHT = Chat AI
  // DOWN = Agenda
  // LEFT = Comunidad
  const R1 = 240;
  const core = [
    { id: 'materias',  emoji: '📚', label: tr('misMaterias'),  sublabel: idioma==='en'?'Notes & topics':'Apuntes y temas', color: 'var(--gold)', href: '/materias',  x: 0,   y: -R1 },
    { id: 'chat',      emoji: '🤖', label: 'ChapBot AI',      sublabel: idioma==='en'?'AI tutor':'Tutor IA',               color: 'var(--pink)', href: '/chat',      x: R1,  y: 0 },
    { id: 'agenda',    emoji: '📅', label: tr('agenda'),       sublabel: idioma==='en'?'Goals':'Objetivos',                 color: 'var(--blue)', href: '/agenda',    x: 0,   y: R1 },
    { id: 'comunidad', emoji: '🌍', label: tr('comunidad'),    sublabel: idioma==='en'?'Community':'Comparte',              color: '#34d399',     href: '/comunidad', x: -R1, y: 0 },
  ];
  core.forEach(c => {
    nodes.push({ ...c, w: 125, h: 125, type: 'nav', ring: 1 });
    conns.push({ from: 'brand', to: c.id, color: c.color, solid: true });
  });

  // ── RING 2: each child hangs from its logical parent ──
  const R2 = 180;
  const secondary = [
    { id: 'horario',    emoji: '🗓️', label: tr('horario'),  sublabel: idioma==='en'?'Schedule':'Clases',     color: 'var(--gold)', href: '/horario',   parent: 'materias',  dx: -R2, dy: 0 },
    { id: 'flashcards', emoji: '🎴', label: 'Flashcards',   sublabel: idioma==='en'?'Cards':'Tarjetas',      color: 'var(--red)',  href: '/quizzes',   parent: 'materias',  dx: R2,  dy: 0 },
    { id: 'partners',   emoji: '👥', label: 'Partners',     sublabel: idioma==='en'?'Buddies':'Compañeros',  color: '#38bdf8',     href: '/partners',  parent: 'comunidad', dx: 0,   dy: -R2*0.7 },
    { id: 'pomodoro',   emoji: '⏱️', label: 'Pomodoro',     sublabel: 'Timer',                                color: '#ef4444',     href: '/pomodoro',  parent: 'agenda',    dx: R2,  dy: 0 },
  ];
  secondary.forEach(s => {
    const parentNode = core.find(c => c.id === s.parent)!;
    const { parent, dx, dy, ...rest } = s;
    nodes.push({ ...rest, x: parentNode.x + dx, y: parentNode.y + dy, w: 100, h: 100, type: 'nav', ring: 2 });
    conns.push({ from: parent, to: s.id, color: s.color });
  });

  // ── STATS CLUSTER (upper-left) ──
  if (loggedIn) {
    const sx = -480, sy = -320;
    nodes.push({ id: 'lbl-stats', x: sx, y: sy - 75, emoji: '', label: idioma==='en'?'📊 My Stats':'📊 Mis Stats', color: '', w: 110, h: 24, type: 'label' });
    const stats = [
      { id: 's-mat', emoji: '📚', label: tr('materias'), sublabel: String(materias.length), color: 'var(--gold)' },
      { id: 's-ap',  emoji: '✏️', label: tr('apuntes'),  sublabel: String(totalAp),         color: 'var(--pink)' },
      { id: 's-doc', emoji: '📄', label: 'Docs',         sublabel: String(totalDoc),        color: 'var(--blue)' },
      { id: 's-fl',  emoji: '🎴', label: 'Flash',        sublabel: String(totalFl),         color: 'var(--red)' },
    ];
    stats.forEach((s, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      nodes.push({ ...s, x: sx + col * 100 - 50, y: sy + row * 100 - 50, w: 88, h: 88, type: 'stat' });
    });
    conns.push({ from: 'brand', to: 's-mat', color: 'var(--gold)' });
    conns.push({ from: 's-mat', to: 's-ap' });
    conns.push({ from: 's-mat', to: 's-doc' });
    conns.push({ from: 's-ap', to: 's-fl' });
    conns.push({ from: 's-doc', to: 's-fl' });
  }

  // ── LEADERBOARD (upper-right) ──
  if (loggedIn) {
    const lx = 480, ly = -300;
    nodes.push({ id: 'lbl-lb', x: lx, y: ly - 95, emoji: '', label: '🏆 Leaderboard', color: '', w: 120, h: 24, type: 'label' });
    nodes.push({ id: 'leaderboard', x: lx, y: ly, emoji: '🏆', label: 'Top 5', color: 'var(--gold)', w: 240, h: 210, type: 'leaderboard', href: '/perfil' });
    conns.push({ from: 'brand', to: 'leaderboard', color: 'var(--gold)' });
  }

  // ── MATERIAS ROW (bottom) ──
  if (loggedIn && materias.length > 0) {
    const my = 420;
    nodes.push({ id: 'lbl-mat', x: 0, y: my - 65, emoji: '', label: idioma==='en'?'🗂️ My Subjects':'🗂️ Mis Materias', color: '', w: 140, h: 24, type: 'label' });
    const max = Math.min(materias.length, 7);
    const gap = Math.min(110, 700 / max);
    materias.slice(0, max).forEach((m, i) => {
      const mx = (i - (max - 1) / 2) * gap;
      nodes.push({
        id: `m-${m.id}`, emoji: m.emoji,
        label: m.nombre.length > 11 ? m.nombre.slice(0,11)+'…' : m.nombre,
        sublabel: `${m.temas.length} ${tr('temas')}`,
        color: m.color, href: '/materias',
        x: mx, y: my, w: 88, h: 88, type: 'materia',
      });
      conns.push({ from: 'materias', to: `m-${m.id}`, color: m.color });
      if (i > 0) conns.push({ from: `m-${materias[i-1].id}`, to: `m-${m.id}` });
    });
  }

  // ── SETTINGS + PERFIL (lower corners) ──
  nodes.push({ id: 'perfil',   emoji: '📊', label: tr('perfil'),         sublabel: 'Stats',                                color: '#a78bfa',         href: '/perfil',   x: 400,  y: 330, w: 85, h: 85, type: 'nav', ring: 3 });
  nodes.push({ id: 'settings', emoji: '⚙️', label: tr('configuracion'), sublabel: idioma==='en'?'Preferences':'Ajustes', color: 'var(--text-faint)', href: '/settings', x: -400, y: 330, w: 85, h: 85, type: 'nav', ring: 3 });
  conns.push({ from: 'agenda', to: 'perfil', color: '#a78bfa' });
  conns.push({ from: 'comunidad', to: 'settings' });

  // ── FOOTER NODE (bottom center) ──
  nodes.push({ id: 'footer', x: 0, y: 520, emoji: '💛', label: 'StudyAL', sublabel: `© ${new Date().getFullYear()}`, color: 'var(--text-faint)', w: 90, h: 75, type: 'footer' });
  conns.push({ from: 'brand', to: 'footer' });

  // ═══ RENDER ═══
  const renderNode = (n: MapNode) => {
    const isH = hoveredNode === n.id;

    if (n.type === 'label') return (
      <div key={n.id} style={{ position: 'absolute', left: n.x - n.w/2, top: n.y - n.h/2, width: n.w, textAlign: 'center', pointerEvents: 'none', zIndex: 1 }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-faint)', letterSpacing: '0.5px', textTransform: 'uppercase', opacity: 0.5 }}>{n.label}</span>
      </div>
    );

    if (n.type === 'brand') return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} onClick={resetView}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: n.h, borderRadius: '40px',
          background: 'var(--bg-card)', border: `2px solid ${isH?'var(--gold)':'var(--border-color)'}`,
          boxShadow: '0 0 80px var(--gold-dim), 0 0 140px rgba(245,200,66,0.06), 0 8px 40px rgba(0,0,0,0.35)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
          cursor: 'pointer', transition: 'all .25s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.05)':'scale(1)', zIndex: 20, overflow: 'hidden',
        }}>
        <div style={{ position: 'absolute', inset: '-10px', borderRadius: '50px', border: '2px solid var(--gold)', opacity: .12, animation: 'ring 3s ease-in-out infinite', pointerEvents: 'none' }} />
        <div style={{ width: '50px', height: '50px', borderRadius: '14px', border: '2px solid var(--gold-border)', overflow: 'hidden', background: 'var(--bg-card2)' }}>
          <img src="/logo.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.parentElement.innerHTML = '📚'; }} />
        </div>
        <span className="brand-studyal" style={{ fontSize: '24px' }}><span className="brand-study-hero">Study</span><span className="brand-al-hero">AL</span></span>
        <div style={{ display: 'flex', gap: '3px' }}>{['var(--gold)','var(--red)','var(--blue)','var(--pink)'].map((c,i) => <div key={i} style={{ width: '14px', height: '3px', background: c, borderRadius: '2px' }} />)}</div>
        <span style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600, maxWidth: '120px', textAlign: 'center', lineHeight: 1.3 }}>{tr('miPlataforma')}</span>
      </div>
    );

    if (n.type === 'leaderboard') return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} onClick={() => go('/perfil')}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: 'auto', minHeight: n.h*0.6,
          borderRadius: '20px', background: isH?'color-mix(in srgb, var(--gold) 8%, var(--bg-card))':'var(--bg-card)',
          border: `${isH?2:1.5}px solid ${isH?'var(--gold)':'var(--border-color)'}`,
          boxShadow: isH?'0 0 0 3px var(--gold-dim), 0 12px 36px rgba(245,200,66,0.12)':'0 3px 16px rgba(0,0,0,0.25)',
          cursor: 'pointer', transition: 'all .22s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.04) translateY(-3px)':'scale(1)', zIndex: isH?15:5, overflow: 'hidden',
        }}>
        <div style={{ height: '4px', background: 'var(--gold)' }} />
        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '20px' }}>🏆</span><span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--gold)' }}>Top 5</span>
          </div>
          {leaderboard.length > 0 ? leaderboard.map((u: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '8px', background: i===0?'var(--gold-dim)':'transparent', border: i===0?'1px solid var(--gold-border)':'1px solid transparent', marginBottom: '3px' }}>
              <span style={{ fontSize: '13px', fontWeight: 900, color: i===0?'var(--gold)':i===1?'var(--text-secondary)':'var(--text-faint)', width: '18px', textAlign: 'center' }}>{i===0?'👑':i===1?'🥈':i===2?'🥉':`${i+1}`}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nombre||'Anon'}</span>
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--gold)', background: 'var(--gold-dim)', padding: '2px 7px', borderRadius: '8px' }}>{u.xp_total?.toLocaleString()||0}</span>
            </div>
          )) : <p style={{ fontSize: '10px', color: 'var(--text-faint)', textAlign: 'center', padding: '8px 0' }}>...</p>}
        </div>
      </div>
    );

    if (n.type === 'stat') return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: n.h, borderRadius: '18px',
          background: isH?`color-mix(in srgb, ${n.color} 12%, var(--bg-card))`:'var(--bg-card)',
          border: `${isH?2:1.5}px solid ${isH?n.color:'var(--border-color)'}`,
          boxShadow: isH?`0 0 0 3px ${n.color}12, 0 8px 24px rgba(0,0,0,0.3)`:'0 2px 10px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
          transition: 'all .22s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.1)':'scale(1)', zIndex: isH?10:2,
        }}>
        <span style={{ fontSize: '15px' }}>{n.emoji}</span>
        <span style={{ fontSize: '20px', fontWeight: 900, color: n.color, lineHeight: 1 }}>{n.sublabel}</span>
        <span style={{ fontSize: '8px', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{n.label}</span>
      </div>
    );

    if (n.type === 'footer') return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} onClick={() => setShowFooter(true)}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: n.h, borderRadius: '18px',
          background: isH?'color-mix(in srgb, var(--gold) 8%, var(--bg-card))':'var(--bg-card)',
          border: `1.5px solid ${isH?'var(--gold-border)':'var(--border-color)'}`, boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', cursor: 'pointer',
          transition: 'all .22s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.1)':'scale(1)', zIndex: isH?10:2,
        }}>
        <span style={{ fontSize: '18px' }}>💛</span>
        <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-muted)' }}>StudyAL</span>
        <span style={{ fontSize: '7px', color: 'var(--text-faint)' }}>© {new Date().getFullYear()}</span>
      </div>
    );

    // NAV + MATERIA (same renderer)
    const isMat = n.type === 'materia';
    return (
      <div key={n.id} data-clickable onMouseEnter={() => setHoveredNode(n.id)} onMouseLeave={() => setHoveredNode(null)} onClick={() => go(n.href||'/')}
        style={{
          position: 'absolute', left: n.x-n.w/2, top: n.y-n.h/2, width: n.w, height: n.h,
          borderRadius: n.w > 110 ? '26px' : '20px',
          background: isH?`color-mix(in srgb, ${n.color} 14%, var(--bg-card))`:'var(--bg-card)',
          border: `${isH?2:1.5}px solid ${isH?n.color:'var(--border-color)'}`,
          boxShadow: isH?`0 0 0 3px ${n.color}12, 0 10px 32px ${n.color}18, 0 4px 14px rgba(0,0,0,0.3)`:'0 2px 12px rgba(0,0,0,0.22)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '4px', padding: '8px 6px', cursor: 'pointer', overflow: 'hidden',
          transition: 'all .22s cubic-bezier(.34,1.56,.64,1)', transform: isH?'scale(1.1) translateY(-3px)':'scale(1)',
          zIndex: isH?10: n.ring===1?5 : n.ring===2?3 : 2,
        }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: n.ring===1?'4px':'3px', background: n.color }} />
        {n.id === 'materias' && <div style={{ position: 'absolute', inset: '-6px', borderRadius: '32px', border: `1.5px solid ${n.color}`, opacity: isH?.4:.12, animation: 'ring 2.5s ease-in-out infinite', pointerEvents: 'none' }} />}
        <span style={{ fontSize: n.w > 110 ? '30px' : isMat ? '22px' : '24px', lineHeight: 1 }}>{n.emoji}</span>
        <span style={{ fontSize: n.w > 110 ? '12px' : '10px', fontWeight: 800, color: isH?n.color:'var(--text-primary)', textAlign: 'center', lineHeight: 1.2, transition: 'color .2s' }}>{n.label}</span>
        {isH && n.sublabel && <span style={{ fontSize: '9px', color: 'var(--text-faint)', textAlign: 'center', animation: 'fadeIn .15s' }}>{n.sublabel}</span>}
        {n.id === 'materias' && loggedIn && <span style={{ fontSize: '8px', background: 'var(--gold-dim)', color: 'var(--gold)', padding: '1px 6px', borderRadius: '8px', fontWeight: 700, border: '1px solid var(--gold-border)', opacity: isH?1:.5 }}>{materias.length}</span>}
      </div>
    );
  };

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)', position: 'relative', fontFamily: '-apple-system, sans-serif' }}>
      {showDaily && <DailyReward onClose={() => setShowDaily(false)} onXPGained={handleXPGained} />}
      {loggedIn && <OnboardingCheck />}
      {loggedIn && showBuscador && <Buscador onClose={() => setShowBuscador(false)} />}

      {/* NAVBAR */}
      <header style={{
        position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 200,
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'color-mix(in srgb, var(--bg-card) 88%, transparent)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--border-color)', borderRadius: '14px', padding: '7px 14px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      }}>
        <img src="/logo.png" alt="" style={{ width: '26px', height: '26px', borderRadius: '7px', objectFit: 'cover', border: '1px solid var(--gold-border)', cursor: 'pointer' }} onClick={resetView} onError={(e: any) => { e.target.style.display = 'none'; }} />
        <span className="brand-studyal" style={{ fontSize: '15px', cursor: 'pointer' }} onClick={resetView}><span className="brand-study">Study</span><span className="brand-al">AL</span></span>
        <BetaBadge />
        <div style={{ width: '1px', height: '18px', background: 'var(--border-color)', margin: '0 2px' }} />
        {loggedIn ? (<>
          <button data-clickable onClick={() => setShowBuscador(true)} style={{ padding: '4px 9px', borderRadius: '7px', border: '1px solid var(--border-color2)', background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>🔍<span style={{ fontSize: '9px', background: 'var(--bg-secondary)', padding: '1px 3px', borderRadius: '3px' }}>⌘K</span></button>
          <button data-clickable onClick={toggleDark} style={{ padding: '4px 7px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>{darkMode?'☀️':'🌙'}</button>
          <UserMenu />
        </>) : (<>
          <button data-clickable onClick={toggleDark} style={{ padding: '4px 7px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>{darkMode?'☀️':'🌙'}</button>
          <button data-clickable onClick={goAuth} style={{ padding: '4px 12px', borderRadius: '7px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>{idioma==='en'?'Get Started':'Comenzar'}</button>
        </>)}
      </header>

      {/* CANVAS */}
      <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onWheel={onWheel}
        style={{ width: '100%', height: '100%', cursor: isDragging.current?'grabbing':'grab', userSelect: 'none', touchAction: 'none' }}>

        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs><pattern id="dots" x={((pan.x%(22*zoom))+22*zoom)%(22*zoom)} y={((pan.y%(22*zoom))+22*zoom)%(22*zoom)} width={22*zoom} height={22*zoom} patternUnits="userSpaceOnUse"><circle cx={1} cy={1} r={0.6} fill="var(--border-color2)" opacity="0.35" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>

        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 55%, var(--bg-primary) 100%)', opacity: 0.45 }} />

        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`, transformOrigin: '0 0', willChange: 'transform' }}>
          <svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none', top: 0, left: 0 }}>
            {conns.map((c, i) => {
              const f = nodes.find(n => n.id === c.from), t = nodes.find(n => n.id === c.to);
              if (!f || !t) return null;
              const isH = hoveredNode === c.from || hoveredNode === c.to;
              const ang = Math.atan2(t.y-f.y, t.x-f.x);
              const mx = (f.x+t.x)/2, my = (f.y+t.y)/2;
              const dist = Math.sqrt((t.x-f.x)**2+(t.y-f.y)**2);
              const curve = Math.min(dist*0.1, 40);
              const cx = mx - Math.sin(ang)*curve, cy = my + Math.cos(ang)*curve;
              return <path key={i} d={`M ${f.x} ${f.y} Q ${cx} ${cy} ${t.x} ${t.y}`} fill="none" stroke={isH?(c.color||f.color):'var(--border-color2)'} strokeWidth={isH?(c.solid?2.5:2):(c.solid?1.2:0.8)} strokeDasharray={c.solid?'none':(isH?'6 4':'4 6')} opacity={isH?0.7:(c.solid?0.3:0.2)} style={{ transition: 'all .3s' }} />;
            })}
          </svg>
          {nodes.map(renderNode)}
        </div>
      </div>

      {/* CONTROLS */}
      <div style={{ position: 'absolute', bottom: '18px', right: '18px', zIndex: 100, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {[{l:'+',a:()=>{tZoom.current=Math.min(tZoom.current*1.2,2.5)}},{l:'−',a:()=>{tZoom.current=Math.max(tZoom.current*.8,.25)}},{l:'⌖',a:resetView}].map((b,i) => (
          <button key={i} data-clickable onClick={b.a} style={{ width: '34px', height: '34px', borderRadius: '9px', border: '1.5px solid var(--border-color2)', background: 'color-mix(in srgb, var(--bg-card) 92%, transparent)', backdropFilter: 'blur(12px)', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.borderColor='var(--gold)';e.currentTarget.style.color='var(--gold)'}} onMouseLeave={(e:any)=>{e.currentTarget.style.borderColor='var(--border-color2)';e.currentTarget.style.color='var(--text-primary)'}}>{b.l}</button>
        ))}
      </div>

      <div style={{ position: 'absolute', bottom: '18px', left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-color)', borderRadius: '18px', padding: '3px 12px', fontSize: '10px', color: 'var(--text-faint)', fontWeight: 600 }}>{Math.round(zoom*100)}%</div>

      <div style={{ position: 'absolute', bottom: '18px', left: '18px', zIndex: 100, display: 'flex', gap: '5px' }}>
        {['Drag → mover','Scroll → zoom'].map((h,i) => <span key={i} style={{ padding: '3px 9px', borderRadius: '18px', background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-color)', fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600 }}>{h}</span>)}
      </div>

      {!loggedIn && (
        <div style={{ position: 'absolute', bottom: '70px', left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: '8px' }}>
          <button data-clickable onClick={goAuth} style={{ padding: '11px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 900, cursor: 'pointer', boxShadow: '0 4px 20px rgba(245,200,66,0.3)' }}>🚀 {idioma==='en'?'Get Started':'Comenzar Gratis'}</button>
          <button data-clickable onClick={goAuth} style={{ padding: '11px 20px', borderRadius: '12px', border: '2px solid var(--border-color2)', background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)', backdropFilter: 'blur(12px)', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>{idioma==='en'?'Sign in':'Iniciar sesión'}</button>
        </div>
      )}

      {/* FOOTER MODAL */}
      {showFooter && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} onClick={() => setShowFooter(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', borderRadius: '22px', border: '1px solid var(--border-color)', width: '90%', maxWidth: '560px', maxHeight: '80vh', overflow: 'auto', padding: '28px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', animation: 'scaleIn .2s ease', position: 'relative' }}>
            <button onClick={() => setShowFooter(false)} style={{ position: 'absolute', top: '14px', right: '14px', width: '28px', height: '28px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
              <img src="/logo.png" alt="" style={{ width: '32px', height: '32px', borderRadius: '8px', objectFit: 'cover' }} onError={(e:any)=>{e.target.style.display='none'}} />
              <div><span className="brand-studyal" style={{ fontSize: '17px' }}><span className="brand-study">Study</span><span className="brand-al">AL</span></span><p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: 0 }}>{idioma==='en'?'AI-powered study platform':'Tu plataforma de estudio'}</p></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '20px', marginBottom: '18px' }}>
              <div>
                <p style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 6px' }}>{idioma==='en'?'Product':'Producto'}</p>
                {[{l:tr('misMaterias'),h:'/materias'},{l:'ChapBot',h:'/chat'},{l:tr('horario'),h:'/horario'},{l:tr('agenda'),h:'/agenda'}].map((lk,i)=><a key={i} href={lk.h} style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '4px', fontWeight: 600 }}>{lk.l}</a>)}
              </div>
              <div>
                <p style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 6px' }}>Legal</p>
                {[{l:idioma==='en'?'Terms':'Términos',h:'/legal'},{l:idioma==='en'?'Privacy':'Privacidad',h:'/legal'}].map((lk,i)=><a key={i} href={lk.h} style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '4px', fontWeight: 600 }}>{lk.l}</a>)}
              </div>
              <div>
                <p style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 6px' }}>{idioma==='en'?'Social':'Síguenos'}</p>
                <a href="https://www.tiktok.com/@studyal.app" target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '4px', fontWeight: 600 }}>TikTok</a>
                <a href="https://www.instagram.com/studyal.app" target="_blank" rel="noopener noreferrer" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', marginBottom: '4px', fontWeight: 600 }}>Instagram</a>
              </div>
            </div>
            {!showSugerencia ? (
              <button onClick={() => setShowSugerencia(true)} style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid var(--gold-border)', background: 'var(--gold-dim)', color: 'var(--gold)', fontSize: '12px', fontWeight: 800, cursor: 'pointer', marginBottom: '12px' }}>💡 {idioma==='en'?'Suggestion Box':'Buzón de sugerencias'}</button>
            ) : enviado ? (
              <div style={{ textAlign: 'center', padding: '12px 0', marginBottom: '12px' }}><span style={{ fontSize: '24px' }}>✅</span><p style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '12px', margin: '4px 0 0' }}>{idioma==='en'?'Thanks!':'¡Gracias!'}</p></div>
            ) : (
              <div style={{ marginBottom: '12px' }}>
                <textarea value={sugerencia} onChange={e=>setSugerencia(e.target.value)} placeholder={idioma==='en'?'How can we improve?':'¿Cómo podemos mejorar?'} rows={3} style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <button onClick={()=>setShowSugerencia(false)} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: '12px' }}>{idioma==='en'?'Cancel':'Cancelar'}</button>
                  <button onClick={enviarSug} disabled={!sugerencia.trim()} style={{ flex: 2, padding: '8px', borderRadius: '8px', border: 'none', background: sugerencia.trim()?'var(--gold)':'var(--bg-card2)', color: sugerencia.trim()?'#000':'var(--text-faint)', fontWeight: 800, cursor: sugerencia.trim()?'pointer':'not-allowed', fontSize: '12px' }}>📤 {idioma==='en'?'Send':'Enviar'}</button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
              <a href="mailto:studyal496@gmail.com" style={{ fontSize: '10px', color: 'var(--text-faint)', textDecoration: 'none' }}>📧 studyal496@gmail.com</a>
              <p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: 0 }}>{idioma==='en'?'Made with':'Hecho con'} 💛</p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes ring{0%,100%{transform:scale(1);opacity:.12}50%{transform:scale(1.06);opacity:.3}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.97)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
      `}</style>
    </div>
  );
}
