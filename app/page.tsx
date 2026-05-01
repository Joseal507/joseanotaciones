'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Materia } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { getMateriasDB } from '../lib/db';
import UserMenu from '../components/UserMenu';
import Buscador from '../components/Buscador';
import NavbarMobile from '../components/NavbarMobile';
import RachaWidget from '../components/RachaWidget';
import NotasRapidas from '../components/NotasRapidas';
import GraficasEstudio from '../components/GraficasEstudio';
import HorarioWidget from '../components/HorarioWidget';
import Leaderboard from '../components/Leaderboard';
import OnboardingCheck from '../components/OnboardingCheck';
import Footer from '../components/Footer';
import { BetaBadge, BetaBanner } from '../components/BetaBanner';
import { useDarkMode } from '../hooks/useDarkMode';
import { useIsMobile } from '../hooks/useIsMobile';
import { useIdioma } from '../hooks/useIdioma';
import DailyReward, { shouldShowDailyReward } from '../components/DailyReward';
import { darXP } from '../lib/xpClient';
import { cargarRachaDesdeDB } from '../lib/racha';

export default function Home() {
  const { darkMode, toggle: toggleDark } = useDarkMode();
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [verificando, setVerificando] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [showBuscador, setShowBuscador] = useState(false);
  const [showDaily, setShowDaily] = useState(false);
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setLoggedIn(true);
        setVerificando(false);

        const user = data.session.user;
        const nombre = user.user_metadata?.nombre || user.email?.split('@')[0] || '';
        const loginKey = `studyal_login_notified_${new Date().toDateString()}`;
        if (!sessionStorage.getItem(loginKey)) {
          sessionStorage.setItem(loginKey, 'true');
          fetch('/api/notify-new-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, email: user.email, es_login: true }),
          }).catch(() => {});
        }

        // ✅ Mostrar daily reward — cargar DB primero
        import('../lib/racha').then(({ cargarRachaDesdeDB }) => {
          return cargarRachaDesdeDB();
        }).then(() => {
          if (shouldShowDailyReward()) {
            setShowDaily(true);
          }
        }).catch(() => {
          if (shouldShowDailyReward()) {
            setShowDaily(true);
          }
        });

      } else {
        setLoggedIn(false);
        setVerificando(false);
      }
    });
  }, []);

  useEffect(() => {
    if (loggedIn) {
      const cargarMaterias = async () => {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const materiasDB = await getMateriasDB(data.user.id);
          setMaterias(materiasDB);
        }
      };
      cargarMaterias();
    }
  }, [loggedIn]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (loggedIn) setShowBuscador(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loggedIn]);

  const handleXPGained = async (xp: number) => {
    if (xp !== 0) {
      await darXP('racha', xp, { source: 'daily_reward', type: xp > 0 ? 'spin_win' : 'spin_loss' });
    }
  };


  const goAuth = () => { window.location.href = '/auth'; };
  const requireAuth = (fn: () => void) => loggedIn ? fn() : goAuth();

  const totalApuntes = materias.reduce((acc, m) => acc + m.temas.reduce((a, t) => a + t.apuntes.length, 0), 0);
  const totalDocs = materias.reduce((acc, m) => acc + m.temas.reduce((a, t) => a + t.documentos.length, 0), 0);
  const totalFlashcards = materias.reduce((acc, m) => acc + m.temas.reduce((a, t) => a + t.documentos.reduce((b, d) => b + (d.flashcards?.length || 0), 0), 0), 0);

  if (verificando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', fontFamily: '-apple-system, sans-serif' }}>
        <div style={{ width: '80px', height: '80px', borderRadius: '20px', border: '3px solid var(--gold)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', fontSize: '36px' }}>
          <img src="/logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '📚'; }} />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 600 }}>{tr('cargando')} StudyAL...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {/* ✅ DAILY REWARD */}
      {showDaily && (
        <DailyReward
          onClose={() => setShowDaily(false)}
          onXPGained={handleXPGained}
        />
      )}

      {loggedIn && <OnboardingCheck />}
      {loggedIn && <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '12px 40px 0' }}><BetaBanner /></div>}
      {loggedIn && showBuscador && <Buscador onClose={() => setShowBuscador(false)} />}

      {/* NAVBAR */}
      {isMobile ? (
        loggedIn ? (
          <NavbarMobile darkMode={darkMode} onToggleDark={toggleDark} />
        ) : (
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 16px', position: 'sticky', top: 0, zIndex: 100, display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '60px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src="/logo.png" alt="Logo" style={{ width: '36px', height: '36px', borderRadius: '10px', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none'; }} />
              <span style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)' }}><span className="brand-studyal"><span className="brand-study">Study</span><span className="brand-al">AL</span></span></span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={goAuth} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>Entrar</button>
            </div>
          </header>
        )
      ) : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', position: 'sticky', top: 0, zIndex: 100, display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '68px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <img src="/logo.png" alt="Logo" style={{ width: '42px', height: '42px', borderRadius: '10px', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none'; }} />
              <div>
                <h1 style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span className="brand-studyal"><span className="brand-study">Study</span><span className="brand-al">AL</span></span><BetaBadge /></span>
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>{tr('tuPlataforma')}</p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {loggedIn ? (
                <>
                  <button onClick={() => setShowBuscador(true)} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    🔍 <span style={{ fontSize: '10px', background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '4px' }}>⌘K</span>
                  </button>
                  <button onClick={() => window.location.href = '/materias'} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>📚 {tr('materias')}</button>
                  <button onClick={() => window.location.href = '/horario'} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>🗓️</button>
                  <button onClick={() => window.location.href = '/pomodoro'} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>⏱️</button>
                  <button onClick={() => window.location.href = '/agenda'} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>📅</button>
                  <button onClick={() => window.location.href = '/comunidad'} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid #34d399', background: 'transparent', color: '#34d399', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>🌍</button>
                  <button onClick={() => window.location.href = '/partners'} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid #38bdf8', background: 'transparent', color: '#38bdf8', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>👥</button>
                  <button onClick={() => window.location.href = '/chat'} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid var(--pink)', background: 'transparent', color: 'var(--pink)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>🤖</button>
                  <button onClick={toggleDark} style={{ padding: '8px 10px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}>{darkMode ? '☀️' : '🌙'}</button>
                  <UserMenu />
                </>
              ) : (
                <>
                  <button onClick={toggleDark} style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>{darkMode ? '☀️' : '🌙'}</button>
                  <button onClick={goAuth} style={{ padding: '8px 20px', borderRadius: '10px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>Iniciar Sesión</button>
                  <button onClick={goAuth} style={{ padding: '8px 20px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>Registro</button>
                </>
              )}
            </div>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            <div style={{ flex: 1, background: 'var(--gold)' }} />
            <div style={{ flex: 1, background: 'var(--red)' }} />
            <div style={{ flex: 1, background: 'var(--blue)' }} />
            <div style={{ flex: 1, background: 'var(--pink)' }} />
          </div>
        </>
      )}

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: isMobile ? '24px 16px' : '48px 40px' }}>

        {/* HERO */}
        <div style={{ textAlign: 'center', marginBottom: isMobile ? '32px' : '56px' }}>
          <div style={{ width: isMobile ? '160px' : '350px', height: isMobile ? '160px' : '350px', borderRadius: '200px', border: '4px solid var(--gold)', overflow: 'hidden', margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', fontSize: isMobile ? '60px' : '120px', boxShadow: '0 20px 80px rgba(245,200,66,0.35)' }}>
            <img src="/logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '📚'; }} />
          </div>

          <h1 style={{ fontSize: isMobile ? '28px' : '56px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px', letterSpacing: isMobile ? '-1px' : '-2px', lineHeight: 1 }}>
            <span className="brand-studyal"><span className="brand-study-hero">Study</span><span className="brand-al-hero">AL</span></span>
          </h1>

          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', margin: '12px 0 16px' }}>
            {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
              <div key={i} style={{ width: isMobile ? '24px' : '36px', height: '4px', background: c, borderRadius: '2px' }} />
            ))}
          </div>

          <p style={{ fontSize: isMobile ? '15px' : '18px', color: 'var(--text-muted)', margin: '0 0 24px', maxWidth: '460px', marginLeft: 'auto', marginRight: 'auto' }}>
            {tr('miPlataforma')}
          </p>

          <button onClick={() => requireAuth(() => window.location.href = '/materias')}
            style={{ padding: isMobile ? '14px 32px' : '16px 44px', borderRadius: '14px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: isMobile ? '15px' : '17px', fontWeight: 900, cursor: 'pointer' }}>
            🚀 {loggedIn ? tr('irAMaterias') : (idioma === 'en' ? 'Get Started Free' : 'Comenzar Gratis')}
          </button>

          {!loggedIn && (
            <p style={{ fontSize: '13px', color: 'var(--text-faint)', marginTop: '12px' }}>
              {idioma === 'en' ? 'Already have an account?' : '¿Ya tienes cuenta?'} <span onClick={goAuth} style={{ color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>{idioma === 'en' ? 'Sign in' : 'Inicia sesión'}</span>
            </p>
          )}

          {isMobile && loggedIn && (
            <button onClick={() => setShowBuscador(true)}
              style={{ display: 'block', width: '100%', marginTop: '12px', padding: '14px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '15px', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
              🔍 {tr('buscarApuntes')}
            </button>
          )}
        </div>

        {!loggedIn && (
          <div style={{ marginBottom: '56px' }}>
            <h2 style={{ textAlign: 'center', fontSize: isMobile ? '20px' : '28px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 32px' }}>
              {idioma === 'en' ? 'Everything you need to study 🎯' : 'Todo lo que necesitas para estudiar 🎯'}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '16px' }}>
              {[
                { emoji: '📚', title: idioma === 'en' ? 'Subjects & Notes' : 'Materias y Apuntes', desc: idioma === 'en' ? 'Organize your subjects, topics and notes in one place' : 'Organiza tus materias, temas y apuntes en un solo lugar', color: 'var(--gold)' },
                { emoji: '🤖', title: 'ChapBot AI', desc: idioma === 'en' ? 'An AI tutor that helps you study' : 'Un tutor de inteligencia artificial que te ayuda a estudiar', color: 'var(--pink)' },
                { emoji: '🎴', title: 'Flashcards', desc: idioma === 'en' ? 'Auto-generate flashcards from your documents' : 'Genera flashcards automáticas de tus documentos', color: 'var(--red)' },
                { emoji: '📅', title: idioma === 'en' ? 'Planner & Schedule' : 'Agenda y Horario', desc: idioma === 'en' ? 'Plan your week with schedules and goals' : 'Planifica tu semana con horarios y objetivos', color: 'var(--blue)' },
                { emoji: '👥', title: 'Study Partners', desc: idioma === 'en' ? 'Connect with other students and share content' : 'Conecta con otros estudiantes y comparte material', color: '#38bdf8' },
                { emoji: '📊', title: idioma === 'en' ? 'Statistics' : 'Estadísticas', desc: idioma === 'en' ? 'Track your progress with streaks, XP and leaderboard' : 'Mide tu progreso con rachas, XP y leaderboard', color: '#a78bfa' },
              ].map((f, i) => (
                <div key={i} onClick={goAuth}
                  style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = f.color; }}
                  onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}>
                  <div style={{ height: '4px', background: f.color }} />
                  <div style={{ padding: '24px 20px' }}>
                    <div style={{ fontSize: '32px', marginBottom: '12px' }}>{f.emoji}</div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>{f.title}</h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: '32px' }}>
              <button onClick={goAuth}
                style={{ padding: '14px 40px', borderRadius: '14px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '16px', fontWeight: 900, cursor: 'pointer' }}>
                {idioma === 'en' ? '✨ Create Free Account' : '✨ Crear Cuenta Gratis'}
              </button>
            </div>
          </div>
        )}

        {loggedIn && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '1px', background: 'var(--border-color)', borderRadius: '16px', overflow: 'hidden', marginBottom: isMobile ? '28px' : '48px' }}>
              {[
                { label: tr('materias'), value: materias.length, color: 'var(--gold)', emoji: '📚' },
                { label: tr('apuntes'), value: totalApuntes, color: 'var(--pink)', emoji: '✏️' },
                { label: tr('documentos'), value: totalDocs, color: 'var(--blue)', emoji: '📄' },
                { label: tr('flashcards'), value: totalFlashcards, color: 'var(--red)', emoji: '🎴' },
              ].map((stat, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', padding: isMobile ? '16px 12px' : '24px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: isMobile ? '20px' : '24px', marginBottom: '4px' }}>{stat.emoji}</div>
                  <div style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: 900, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: isMobile ? '10px' : '12px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '4px' }}>{stat.label}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: isMobile ? '28px' : '48px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{ width: '4px', height: '28px', background: 'var(--gold)', borderRadius: '2px' }} />
                <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>🗓️ {tr('hoy').replace('¡','').replace('!','')}</h2>
              </div>
              <HorarioWidget />
            </div>

            <div style={{ marginBottom: isMobile ? '28px' : '48px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{ width: '4px', height: '28px', background: 'var(--red)', borderRadius: '2px' }} />
                <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{tr('rachaEstudio')}</h2>
              </div>
              <RachaWidget />
            </div>

            <div style={{ marginBottom: isMobile ? '28px' : '48px' }}><GraficasEstudio /></div>

            <div style={{ marginBottom: isMobile ? '28px' : '48px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{ width: '4px', height: '28px', background: 'var(--gold)', borderRadius: '2px' }} />
                <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>🏆 Leaderboard</h2>
              </div>
              <Leaderboard />
            </div>

            <div style={{ marginBottom: isMobile ? '28px' : '48px' }}><NotasRapidas /></div>

            {materias.length > 0 && (
              <div style={{ marginBottom: isMobile ? '28px' : '48px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '4px', height: '28px', background: 'var(--gold)', borderRadius: '2px' }} />
                    <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{tr('misMaterias')}</h2>
                  </div>
                  <button onClick={() => window.location.href = '/materias'} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--gold-border)', background: 'var(--gold-dim)', color: 'var(--gold)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>{tr('verTodas')}</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: isMobile ? '10px' : '16px' }}>
                  {materias.slice(0, isMobile ? 4 : 6).map(materia => (
                    <div key={materia.id} onClick={() => window.location.href = '/materias'}
                      style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s ease' }}
                      onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = materia.color; }}
                      onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}>
                      <div style={{ height: '4px', background: materia.color }} />
                      <div style={{ padding: isMobile ? '12px' : '18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                          <div style={{ width: isMobile ? '34px' : '44px', height: isMobile ? '34px' : '44px', borderRadius: '10px', background: materia.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? '16px' : '20px', flexShrink: 0 }}>{materia.emoji}</div>
                          <div style={{ minWidth: 0 }}>
                            <h3 style={{ fontSize: isMobile ? '13px' : '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{materia.nombre}</h3>
                            <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: 0 }}>{materia.temas.length} {tr('temas')}</p>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {[
                            { label: tr('apuntes'), val: materia.temas.reduce((a, t) => a + t.apuntes.length, 0) },
                            { label: 'Docs', val: materia.temas.reduce((a, t) => a + t.documentos.length, 0) },
                          ].map((s, i) => (
                            <div key={i} style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: '6px', padding: '6px', textAlign: 'center' }}>
                              <div style={{ fontSize: isMobile ? '14px' : '16px', fontWeight: 900, color: materia.color }}>{s.val}</div>
                              <div style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {materias.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <div style={{ fontSize: '60px', marginBottom: '16px' }}>📚</div>
                <h2 style={{ fontSize: isMobile ? '20px' : '24px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{tr('crearPrimeraMateria')}</h2>
                <p style={{ fontSize: '15px', color: 'var(--text-muted)', margin: '0 0 24px' }}>{tr('organizaApuntes')}</p>
                <button onClick={() => window.location.href = '/materias'} style={{ padding: '14px 32px', borderRadius: '14px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '16px', fontWeight: 900, cursor: 'pointer' }}>{tr('crearPrimera')}</button>
              </div>
            )}
          </>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <div style={{ width: '4px', height: '28px', background: 'var(--blue)', borderRadius: '2px' }} />
            <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{loggedIn ? tr('accesosRapidos') : (idioma === 'en' ? 'Explore features' : 'Explora las funciones')}</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: isMobile ? '10px' : '14px' }}>
            {[
              { emoji: '📚', label: tr('misMaterias'), desc: idioma === 'en' ? 'Notes & topics' : 'Apuntes y temas', color: 'var(--gold)', href: '/materias' },
              { emoji: '🗓️', label: tr('horario'), desc: idioma === 'en' ? 'Weekly schedule' : 'Clases de la semana', color: 'var(--gold)', href: '/horario' },
              { emoji: '📅', label: tr('agenda'), desc: tr('calendarioYObjetivos'), color: 'var(--blue)', href: '/agenda' },
              { emoji: '🤖', label: 'ChapBot', desc: idioma === 'en' ? 'AI chat' : 'Chat con AI', color: 'var(--pink)', href: '/chat' },
              { emoji: '🎓', label: tr('quizzes'), desc: idioma === 'en' ? 'Saved materials' : 'Materiales guardados', color: '#a78bfa', href: '/quizzes' },
              { emoji: '📊', label: tr('perfil'), desc: idioma === 'en' ? 'Study stats' : 'Stats de estudio', color: 'var(--red)', href: '/perfil' },
              { emoji: '⏱️', label: 'Timer', desc: idioma === 'en' ? 'Focus timer' : 'Método Pomodoro', color: '#ef4444', href: '/pomodoro' },
              { emoji: '⚙️', label: tr('configuracion'), desc: idioma === 'en' ? 'Settings' : 'Ajustes', color: 'var(--text-muted)', href: '/settings' },
            ].map((item, i) => (
              <div key={i}
                onClick={() => requireAuth(() => window.location.href = item.href)}
                style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = item.color; }}
                onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}>
                <div style={{ height: '4px', background: item.color }} />
                <div style={{ padding: isMobile ? '14px 12px' : '18px' }}>
                  <div style={{ fontSize: isMobile ? '22px' : '26px', marginBottom: '6px' }}>{item.emoji}</div>
                  <h3 style={{ fontSize: isMobile ? '12px' : '14px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 3px' }}>{item.label}</h3>
                  <p style={{ fontSize: isMobile ? '10px' : '11px', color: 'var(--text-muted)', margin: 0 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
