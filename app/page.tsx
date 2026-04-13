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
import { useDarkMode } from '../hooks/useDarkMode';
import { useIsMobile } from '../hooks/useIsMobile';

export default function Home() {
  const { darkMode, toggle: toggleDark } = useDarkMode();
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [verificando, setVerificando] = useState(true);
  const [showBuscador, setShowBuscador] = useState(false);
  const [appNombre, setAppNombre] = useState('JoseAnotaciones');
  const isMobile = useIsMobile();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/auth';
      } else {
        setVerificando(false);
      }
    });
  }, []);

  useEffect(() => {
    // Leer nombre de la app desde settings
    try {
      const s = localStorage.getItem('josea_settings');
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed.nombreApp) setAppNombre(parsed.nombreApp);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!verificando) {
      const cargarMaterias = async () => {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const materiasDB = await getMateriasDB(data.user.id);
          setMaterias(materiasDB);
        }
      };
      cargarMaterias();
    }
  }, [verificando]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowBuscador(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const totalApuntes = materias.reduce((acc, m) =>
    acc + m.temas.reduce((a, t) => a + t.apuntes.length, 0), 0);
  const totalDocs = materias.reduce((acc, m) =>
    acc + m.temas.reduce((a, t) => a + t.documentos.length, 0), 0);
  const totalFlashcards = materias.reduce((acc, m) =>
    acc + m.temas.reduce((a, t) =>
      a + t.documentos.reduce((b, d) => b + (d.flashcards?.length || 0), 0), 0), 0);

  if (verificando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', fontFamily: '-apple-system, sans-serif' }}>
        <div style={{ width: '80px', height: '80px', borderRadius: '20px', border: '3px solid var(--gold)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', fontSize: '36px' }}>
          <img src="/logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e: any) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '📚'; }} />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 600 }}>Cargando {appNombre}...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {showBuscador && <Buscador onClose={() => setShowBuscador(false)} />}

      {/* NAVBAR */}
      {isMobile ? (
        <NavbarMobile darkMode={darkMode} onToggleDark={toggleDark} />
      ) : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', position: 'sticky', top: 0, zIndex: 100, display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '68px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <img src="/logo.png" alt="Logo" style={{ width: '42px', height: '42px', borderRadius: '10px', objectFit: 'cover' }}
                onError={(e: any) => { e.target.style.display = 'none'; }} />
              <div>
                <h1 style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                  {appNombre}
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>Tu plataforma de estudio</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => setShowBuscador(true)}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🔍 <span style={{ fontSize: '11px', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>⌘K</span>
              </button>
              <button onClick={() => window.location.href = '/horario'}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                🗓️ Horario
              </button>
              <button onClick={() => window.location.href = '/chat'}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--pink)', background: 'transparent', color: 'var(--pink)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                🤖 AlciBot
              </button>
              <button onClick={() => window.location.href = '/agenda'}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                📅 Agenda
              </button>
              <button onClick={() => window.location.href = '/materias'}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                📚 Materias
              </button>
              <button onClick={toggleDark}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>
                {darkMode ? '☀️' : '🌙'}
              </button>
              <UserMenu />
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
          <div style={{
            width: isMobile ? '160px' : '350px',
            height: isMobile ? '160px' : '350px',
            borderRadius: '200px',
            border: '4px solid var(--gold)',
            overflow: 'hidden',
            margin: '0 auto 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-card)',
            fontSize: isMobile ? '60px' : '120px',
            boxShadow: '0 20px 80px rgba(245,200,66,0.35)',
          }}>
            <img src="/logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e: any) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '📚'; }} />
          </div>

          <h1 style={{ fontSize: isMobile ? '28px' : '56px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px', letterSpacing: isMobile ? '-1px' : '-2px', lineHeight: 1 }}>
            {appNombre.toUpperCase()}
          </h1>

          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', margin: '12px 0 16px' }}>
            {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
              <div key={i} style={{ width: isMobile ? '24px' : '36px', height: '4px', background: c, borderRadius: '2px' }} />
            ))}
          </div>

          <p style={{ fontSize: isMobile ? '15px' : '18px', color: 'var(--text-muted)', margin: '0 0 24px', maxWidth: '460px', marginLeft: 'auto', marginRight: 'auto' }}>
            Mi plataforma para tirar estudio 💪
          </p>

          <button onClick={() => window.location.href = '/materias'}
            style={{ padding: isMobile ? '14px 32px' : '16px 44px', borderRadius: '14px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: isMobile ? '15px' : '17px', fontWeight: 900, cursor: 'pointer' }}>
            🚀 IR A MIS MATERIAS
          </button>

          {isMobile && (
            <button onClick={() => setShowBuscador(true)}
              style={{ display: 'block', width: '100%', marginTop: '12px', padding: '14px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '15px', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
              🔍 Buscar apuntes, materias...
            </button>
          )}
        </div>

        {/* STATS */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '1px', background: 'var(--border-color)', borderRadius: '16px', overflow: 'hidden', marginBottom: isMobile ? '28px' : '48px' }}>
          {[
            { label: 'Materias', value: materias.length, color: 'var(--gold)', emoji: '📚' },
            { label: 'Apuntes', value: totalApuntes, color: 'var(--pink)', emoji: '✏️' },
            { label: 'Documentos', value: totalDocs, color: 'var(--blue)', emoji: '📄' },
            { label: 'Flashcards', value: totalFlashcards, color: 'var(--red)', emoji: '🎴' },
          ].map((stat, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', padding: isMobile ? '16px 12px' : '24px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: isMobile ? '20px' : '24px', marginBottom: '4px' }}>{stat.emoji}</div>
              <div style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: 900, color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: isMobile ? '10px' : '12px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '4px' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* RACHA */}
        <div style={{ marginBottom: isMobile ? '28px' : '48px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <div style={{ width: '4px', height: '28px', background: 'var(--red)', borderRadius: '2px' }} />
            <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
              🔥 Racha de estudio
            </h2>
          </div>
          <RachaWidget />
        </div>

        {/* MATERIAS */}
        {materias.length > 0 && (
          <div style={{ marginBottom: isMobile ? '28px' : '48px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '4px', height: '28px', background: 'var(--gold)', borderRadius: '2px' }} />
                <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>Mis Materias</h2>
              </div>
              <button onClick={() => window.location.href = '/materias'}
                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--gold-border)', background: 'var(--gold-dim)', color: 'var(--gold)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                Ver todas →
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: isMobile ? '10px' : '16px' }}>
              {materias.slice(0, isMobile ? 4 : 6).map(materia => (
                <div key={materia.id}
                  onClick={() => window.location.href = '/materias'}
                  style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = materia.color; }}
                  onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                >
                  <div style={{ height: '4px', background: materia.color }} />
                  <div style={{ padding: isMobile ? '12px' : '18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                      <div style={{ width: isMobile ? '34px' : '44px', height: isMobile ? '34px' : '44px', borderRadius: '10px', background: materia.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? '16px' : '20px', flexShrink: 0 }}>
                        {materia.emoji}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ fontSize: isMobile ? '13px' : '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {materia.nombre}
                        </h3>
                        <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: 0 }}>{materia.temas.length} temas</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {[
                        { label: 'Apuntes', val: materia.temas.reduce((a, t) => a + t.apuntes.length, 0) },
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

              <div onClick={() => window.location.href = '/materias'}
                style={{ background: 'transparent', borderRadius: '14px', border: '2px dashed var(--border-color)', padding: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', minHeight: '100px', transition: 'all 0.2s' }}
                onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'var(--gold-dim)'; }}
                onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ fontSize: '24px' }}>➕</div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700, margin: 0 }}>Nueva materia</p>
              </div>
            </div>
          </div>
        )}

        {/* Sin materias */}
        {materias.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: '60px', marginBottom: '16px' }}>📚</div>
            <h2 style={{ fontSize: isMobile ? '20px' : '24px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              ¡Empieza creando tu primera materia!
            </h2>
            <p style={{ fontSize: '15px', color: 'var(--text-muted)', margin: '0 0 24px' }}>
              Organiza tus apuntes, documentos y flashcards
            </p>
            <button onClick={() => window.location.href = '/materias'}
              style={{ padding: '14px 32px', borderRadius: '14px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '16px', fontWeight: 900, cursor: 'pointer' }}>
              📚 Crear primera materia
            </button>
          </div>
        )}

        {/* ACCESOS RÁPIDOS */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <div style={{ width: '4px', height: '28px', background: 'var(--blue)', borderRadius: '2px' }} />
            <h2 style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>Accesos rápidos</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(180px, 1fr))', gap: isMobile ? '10px' : '14px' }}>
            {[
              { emoji: '📚', label: 'Mis Materias', desc: 'Apuntes y temas', color: 'var(--gold)', href: '/materias' },
              { emoji: '🗓️', label: 'Horario', desc: 'Clases de la semana', color: 'var(--gold)', href: '/horario' },
              { emoji: '📅', label: 'Agenda', desc: 'Calendario y objetivos', color: 'var(--blue)', href: '/agenda' },
              { emoji: '🤖', label: 'AlciBot', desc: 'Chat con AI', color: 'var(--pink)', href: '/chat' },
              { emoji: '🎓', label: 'Quizzes', desc: 'Quizzes y flashcard decks', color: '#a78bfa', href: '/quizzes' },
              { emoji: '📊', label: 'Mi Perfil', desc: 'Stats de estudio', color: 'var(--red)', href: '/perfil' },
              { emoji: '⚙️', label: 'Configuración', desc: 'Ajustes de cuenta', color: 'var(--text-muted)', href: '/settings' },
            ].map((item, i) => (
              <div key={i}
                onClick={() => window.location.href = item.href}
                style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = item.color; }}
                onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              >
                <div style={{ height: '4px', background: item.color }} />
                <div style={{ padding: isMobile ? '14px 12px' : '20px' }}>
                  <div style={{ fontSize: isMobile ? '22px' : '28px', marginBottom: '6px' }}>{item.emoji}</div>
                  <h3 style={{ fontSize: isMobile ? '13px' : '15px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 3px' }}>{item.label}</h3>
                  <p style={{ fontSize: isMobile ? '11px' : '12px', color: 'var(--text-muted)', margin: 0 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}