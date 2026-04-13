'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { getMaterias, Materia } from '../lib/storage';
import { supabase } from '../lib/supabase';
import UserMenu from '../components/UserMenu';

export default function Home() {
  const [darkMode, setDarkMode] = useState(true);
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [verificando, setVerificando] = useState(true);

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
    document.documentElement.classList.toggle('light', !darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (!verificando) {
      const cargarMaterias = async () => {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const { getMateriasDB } = await import('../lib/db');
          const materiasDB = await getMateriasDB(data.user.id);
          setMaterias(materiasDB);
        }
      };
      cargarMaterias();
    }
  }, [verificando]);

  const totalApuntes = materias.reduce((acc, m) =>
    acc + m.temas.reduce((a, t) => a + t.apuntes.length, 0), 0);
  const totalDocs = materias.reduce((acc, m) =>
    acc + m.temas.reduce((a, t) => a + t.documentos.length, 0), 0);
  const totalFlashcards = materias.reduce((acc, m) =>
    acc + m.temas.reduce((a, t) =>
      a + t.documentos.reduce((b, d) => b + (d.flashcards?.length || 0), 0), 0), 0);

  if (verificando) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '16px',
        fontFamily: '-apple-system, sans-serif',
      }}>
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '20px',
          border: '3px solid var(--gold)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-card)',
          fontSize: '36px',
        }}>
          <img
            src="/logo.png"
            alt="Logo"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e: any) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '📚'; }}
          />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 600 }}>
          Cargando JoseAnotaciones...
        </p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {/* NAVBAR */}
      <header style={{
        background: 'var(--bg-card)',
        borderBottom: '3px solid var(--gold)',
        padding: '0 40px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '68px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <img
            src="/logo.png"
            alt="Logo"
            style={{ width: '42px', height: '42px', borderRadius: '10px', objectFit: 'cover' }}
            onError={(e: any) => { e.target.style.display = 'none'; }}
          />
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
              JoseAnotaciones
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
              Tu plataforma de estudio
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => window.location.href = '/chat'}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--pink)', background: 'transparent', color: 'var(--pink)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            🤖 AlciBot
          </button>
          <button
            onClick={() => window.location.href = '/agenda'}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            📅 Agenda
          </button>
          <button
            onClick={() => window.location.href = '/materias'}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
            📚 Mis Materias
          </button>
          <button
            onClick={() => setDarkMode(!darkMode)}
            style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          <UserMenu />
        </div>
      </header>

      {/* Barra colores */}
      <div style={{ display: 'flex', height: '3px' }}>
        <div style={{ flex: 1, background: 'var(--gold)' }} />
        <div style={{ flex: 1, background: 'var(--red)' }} />
        <div style={{ flex: 1, background: 'var(--blue)' }} />
        <div style={{ flex: 1, background: 'var(--pink)' }} />
      </div>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '48px 40px' }}>

        {/* HERO */}
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <div style={{
            width: '280px',
            height: '280px',
            borderRadius: '48px',
            border: '4px solid var(--gold)',
            overflow: 'hidden',
            margin: '0 auto 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-card)',
            fontSize: '120px',
            boxShadow: '0 20px 80px rgba(245,200,66,0.35)',
          }}>
            <img
              src="/logo.png"
              alt="Logo"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e: any) => {
                e.target.style.display = 'none';
                e.target.parentElement.innerHTML = '📚';
              }}
            />
          </div>

          <h1 style={{
            fontSize: '56px',
            fontWeight: 900,
            color: 'var(--text-primary)',
            margin: '0 0 8px',
            letterSpacing: '-2px',
            lineHeight: 1,
          }}>
            JOSEANOTACIONES
          </h1>

          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', margin: '16px 0 20px' }}>
            {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
              <div key={i} style={{ width: '36px', height: '4px', background: c, borderRadius: '2px' }} />
            ))}
          </div>

          <p style={{
            fontSize: '18px',
            color: 'var(--text-muted)',
            margin: '0 0 36px',
            maxWidth: '460px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Mi plataforma para tirar estudio 💪
          </p>

          <button
            onClick={() => window.location.href = '/materias'}
            style={{
              padding: '16px 44px',
              borderRadius: '14px',
              border: 'none',
              background: 'var(--gold)',
              color: '#000',
              fontSize: '17px',
              fontWeight: 900,
              cursor: 'pointer',
              letterSpacing: '0.5px',
              transition: 'transform 0.2s',
            }}
            onMouseEnter={(e: any) => e.currentTarget.style.transform = 'scale(1.05)'}
            onMouseLeave={(e: any) => e.currentTarget.style.transform = 'scale(1)'}>
            🚀 IR A MIS MATERIAS
          </button>
        </div>

        {/* STATS */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1px',
          background: 'var(--border-color)',
          borderRadius: '16px',
          overflow: 'hidden',
          marginBottom: '48px',
        }}>
          {[
            { label: 'Materias', value: materias.length, color: 'var(--gold)', emoji: '📚' },
            { label: 'Apuntes', value: totalApuntes, color: 'var(--pink)', emoji: '✏️' },
            { label: 'Documentos', value: totalDocs, color: 'var(--blue)', emoji: '📄' },
            { label: 'Flashcards', value: totalFlashcards, color: 'var(--red)', emoji: '🎴' },
          ].map((stat, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', padding: '24px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>{stat.emoji}</div>
              <div style={{ fontSize: '32px', fontWeight: 900, color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '4px' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* MATERIAS RECIENTES */}
        {materias.length > 0 && (
          <div style={{ marginBottom: '48px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '4px', height: '28px', background: 'var(--gold)', borderRadius: '2px' }} />
                <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                  Mis Materias
                </h2>
              </div>
              <button
                onClick={() => window.location.href = '/materias'}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--gold-border)', background: 'var(--gold-dim)', color: 'var(--gold)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                Ver todas →
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
              {materias.slice(0, 6).map(materia => (
                <div
                  key={materia.id}
                  onClick={() => window.location.href = '/materias'}
                  style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = materia.color; }}
                  onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                >
                  <div style={{ height: '4px', background: materia.color }} />
                  <div style={{ padding: '18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                      <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: materia.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                        {materia.emoji}
                      </div>
                      <div>
                        <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                          {materia.nombre}
                        </h3>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                          {materia.temas.length} temas
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {[
                        { label: 'Apuntes', val: materia.temas.reduce((a, t) => a + t.apuntes.length, 0) },
                        { label: 'Docs', val: materia.temas.reduce((a, t) => a + t.documentos.length, 0) },
                      ].map((s, i) => (
                        <div key={i} style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                          <div style={{ fontSize: '16px', fontWeight: 900, color: materia.color }}>{s.val}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              <div
                onClick={() => window.location.href = '/materias'}
                style={{ background: 'transparent', borderRadius: '16px', border: '2px dashed var(--border-color)', padding: '18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s', minHeight: '130px' }}
                onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'var(--gold-dim)'; }}
                onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ fontSize: '28px' }}>➕</div>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 700, margin: 0 }}>
                  Nueva materia
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Sin materias */}
        {materias.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0 60px' }}>
            <div style={{ fontSize: '72px', marginBottom: '16px' }}>📚</div>
            <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              ¡Empieza creando tu primera materia!
            </h2>
            <p style={{ fontSize: '15px', color: 'var(--text-muted)', margin: '0 0 28px' }}>
              Organiza tus apuntes, documentos y flashcards por materia
            </p>
            <button
              onClick={() => window.location.href = '/materias'}
              style={{ padding: '16px 40px', borderRadius: '14px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '16px', fontWeight: 900, cursor: 'pointer' }}>
              📚 Crear primera materia
            </button>
          </div>
        )}

        {/* ACCESOS RÁPIDOS */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '4px', height: '28px', background: 'var(--blue)', borderRadius: '2px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
              Accesos rápidos
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px' }}>
            {[
              { emoji: '📚', label: 'Mis Materias', desc: 'Apuntes y temas', color: 'var(--gold)', href: '/materias' },
              { emoji: '📅', label: 'Agenda', desc: 'Calendario y objetivos', color: 'var(--blue)', href: '/agenda' },
              { emoji: '🤖', label: 'AlciBot', desc: 'Chat con AI', color: 'var(--pink)', href: '/chat' },
              { emoji: '📊', label: 'Mi Perfil', desc: 'Stats de estudio', color: 'var(--red)', href: '/perfil' },
            ].map((item, i) => (
              <div
                key={i}
                onClick={() => window.location.href = item.href}
                style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = item.color; }}
                onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              >
                <div style={{ height: '4px', background: item.color }} />
                <div style={{ padding: '20px' }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>{item.emoji}</div>
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                    {item.label}
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}