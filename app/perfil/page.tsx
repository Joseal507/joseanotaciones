'use client';

import { useState, useEffect } from 'react';
import { getPerfil, getMaterias, PerfilEstudio } from '../../lib/storage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import { useXP } from '../../hooks/useXP';
import NavbarMobile from '../../components/NavbarMobile';
import ReporteSemanal from '../../components/ReporteSemanal';
import RangoDisplay from '../../components/RangoDisplay';
import MarcoAvatar from '../../components/MarcoAvatar';
import LogrosPanel from '../../components/LogrosPanel';
import TablaRangos from '../../components/TablaRangos';
import { getRango, getLogrosObtenidos, LogroStats } from '../../lib/xpSystem';

export default function PerfilPage() {
  const [perfil, setPerfil] = useState<PerfilEstudio | null>(null);
  const [tabActivo, setTabActivo] = useState<'stats' | 'rangos' | 'logros'>('stats');
  const [nombre, setNombre] = useState('');
  const [fotoPerfil, setFotoPerfil] = useState('');
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();
  const { xpTotal, nivel, progreso, xpEnNivel, xpParaSiguiente, titulo, cargando: xpCargando } = useXP();

  useEffect(() => {
    const cargar = async () => {
      let perfilLocal = getPerfil();
      const tieneDataLocal =
        Object.keys(perfilLocal.flashcardsAcertadas || {}).length > 0 ||
        Object.keys(perfilLocal.flashcardsFalladas || {}).length > 0 ||
        Object.keys(perfilLocal.materiasStats || {}).length > 0;

      if (tieneDataLocal) {
        setPerfil(perfilLocal);
      } else {
        try {
          const { cargarPerfilDesdeDB } = await import('../../lib/storage');
          const perfilDB = await cargarPerfilDesdeDB();
          setPerfil(perfilDB || perfilLocal);
        } catch {
          setPerfil(perfilLocal);
        }
      }

      // Cargar nombre y foto
      const { supabase } = await import('../../lib/supabase');
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setNombre(data.user.user_metadata?.nombre || data.user.email?.split('@')[0] || 'Estudiante');
      }
      const { getSettings } = await import('../../lib/settings');
      const settings = getSettings();
      setFotoPerfil(settings.fotoPerfil || '');
    };
    cargar();
    getMaterias();
  }, []);

  if (!perfil) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text-faint)' }}>{tr('cargando')}</p>
    </div>
  );

  const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce((a, b) => a + b, 0);
  const totalFalladas = Object.values(perfil.flashcardsFalladas || {}).reduce((a, b) => a + b, 0);
  const total = totalAcertadas + totalFalladas;
  const porcentajeGlobal = total > 0 ? Math.round((totalAcertadas / total) * 100) : 0;

  const topFalladas = Object.entries(perfil.flashcardsFalladas || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 6);

  const materiasOrdenadas = Object.entries(perfil.materiasStats || {})
    .map(([id, stats]) => ({ id, ...stats }))
    .sort((a, b) => b.totalFlashcards - a.totalFlashcards);

  const materiaDificil = materiasOrdenadas
    .filter(m => m.totalFlashcards > 0)
    .sort((a, b) => (b.falladas / b.totalFlashcards) - (a.falladas / a.totalFlashcards))[0];

  const materiaFuerte = materiasOrdenadas
    .filter(m => m.totalFlashcards > 0)
    .sort((a, b) => (b.acertadas / b.totalFlashcards) - (a.acertadas / a.totalFlashcards))[0];

  const quizzesTotales = Object.values(perfil.materiasStats || {}).reduce((a: number, m: any) => a + (m.quizzes || 0), 0);

  const rango = getRango(xpTotal);

  const logroStats: LogroStats = {
    xpTotal,
    flashcardsEstudiadas: total,
    quizzesCompletados: quizzesTotales,
    rachaActual: 0,
    mejorRacha: 0,
    precision: porcentajeGlobal,
    materiasCreadas: materiasOrdenadas.length,
    postsCreados: 0,
    rangoId: rango.id,
  };

  const logrosObtenidos = getLogrosObtenidos(logroStats);

  const tabs = [
    { id: 'stats' as const, label: '📊 Stats', emoji: '📊' },
    { id: 'rangos' as const, label: '🏆 Rangos', emoji: '🏆' },
    { id: 'logros' as const, label: `🎖️ Logros (${logrosObtenidos.length})`, emoji: '🎖️' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {isMobile ? <NavbarMobile /> : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', height: '68px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button onClick={() => window.location.href = '/'}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                ← {tr('inicio')}
              </button>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>Mis Stats</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: 0 }}>{tr('tuProgresoYStats')}</p>
              </div>
            </div>
            <button onClick={() => window.location.href = '/chat'}
              style={{ padding: '8px 16px', borderRadius: 8, border: '2px solid var(--pink)', background: 'transparent', color: 'var(--pink)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              🤖 JeffreyBot
            </button>
          </header>
          <div style={{ display: 'flex', height: 3 }}>
            <div style={{ flex: 1, background: 'var(--gold)' }} />
            <div style={{ flex: 1, background: 'var(--red)' }} />
            <div style={{ flex: 1, background: 'var(--blue)' }} />
            <div style={{ flex: 1, background: 'var(--pink)' }} />
          </div>
        </>
      )}

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? 16 : 40 }}>

        {/* ── HERO: Avatar + Rango ── */}
        <div style={{
          background: `linear-gradient(135deg, ${rango.color}15, var(--bg-card))`,
          border: `2px solid ${rango.color}44`,
          borderRadius: 20,
          padding: isMobile ? '20px 16px' : '28px 32px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
          boxShadow: `0 0 40px ${rango.color}22`,
        }}>
          <MarcoAvatar
            xpTotal={xpTotal}
            fotoPerfil={fotoPerfil}
            nombre={nombre}
            size={isMobile ? 72 : 96}
          />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
              {nombre}
            </div>
            <div style={{ marginBottom: 12 }}>
              <RangoDisplay xpTotal={xpTotal} size={isMobile ? 'sm' : 'md'} mostrarProgreso />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, background: 'var(--bg-secondary)', borderRadius: 8, padding: '3px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>
                Nivel {nivel} · {titulo.emoji} {titulo.titulo}
              </span>
              <span style={{ fontSize: 11, background: rango.color + '22', borderRadius: 8, padding: '3px 10px', color: rango.color, fontWeight: 700 }}>
                {xpTotal.toLocaleString()} XP totales
              </span>
              <span style={{ fontSize: 11, background: '#a78bfa22', borderRadius: 8, padding: '3px 10px', color: '#a78bfa', fontWeight: 600 }}>
                🎖️ {logrosObtenidos.length} logros
              </span>
            </div>
          </div>

          {/* Botón perfil público */}
          <button
            onClick={async () => {
              const { supabase } = await import('../../lib/supabase');
              const { data } = await supabase.auth.getUser();
              if (data.user?.id) window.location.href = '/u/' + data.user.id;
            }}
            style={{
              padding: '10px 18px', borderRadius: 12,
              border: `2px solid ${rango.color}`,
              background: rango.color + '15',
              color: rango.color, fontWeight: 700, fontSize: 13,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            🌐 Ver Perfil Público
          </button>
        </div>

        {/* ── TABS ── */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border-color)' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setTabActivo(tab.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: tabActivo === tab.id ? `3px solid ${rango.color}` : '3px solid transparent',
                padding: '10px 20px', fontSize: 14,
                fontWeight: tabActivo === tab.id ? 700 : 500,
                color: tabActivo === tab.id ? rango.color : 'var(--text-muted)',
                marginBottom: -2,
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── TAB: STATS ── */}
        {tabActivo === 'stats' && (
          <div>
            {/* Stats globales */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 1, background: 'var(--border-color)', borderRadius: 16, overflow: 'hidden', marginBottom: 24 }}>
              {[
                { label: tr('totalEstudiadas'), value: total, color: 'var(--gold)', emoji: '📚' },
                { label: tr('acertadas'), value: totalAcertadas, color: '#4ade80', emoji: '✅' },
                { label: tr('falladas'), value: totalFalladas, color: 'var(--red)', emoji: '❌' },
                { label: tr('precision'), value: `${porcentajeGlobal}%`, color: 'var(--blue)', emoji: '🎯' },
              ].map((s, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', padding: isMobile ? '16px 12px' : '24px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: isMobile ? 20 : 24, marginBottom: 4 }}>{s.emoji}</div>
                  <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: isMobile ? 9 : 12, color: 'var(--text-muted)', fontWeight: 600, marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* XP Card */}
            <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: `1px solid ${rango.color}44`, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ height: 4, background: rango.marcoGradient }} />
              <div style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: rango.color, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {rango.emoji} Progreso de XP
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Nivel {nivel} · {xpEnNivel}/{xpParaSiguiente} XP
                  </span>
                </div>
                <div style={{ height: 10, background: 'var(--bg-secondary)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    height: '100%', width: `${progreso}%`,
                    background: rango.marcoGradient,
                    borderRadius: 10, transition: 'width 0.6s ease',
                    boxShadow: `0 0 8px ${rango.color}`,
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>{progreso}% del nivel {nivel}</span>
                  <span>→ Nivel {nivel + 1}</span>
                </div>
              </div>
            </div>

            {/* Materias + Falladas */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 24 }}>
              {/* Precisión por materia */}
              <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: 4, background: 'var(--gold)' }} />
                <div style={{ padding: 20 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px' }}>
                    {tr('precisionPorMateria')}
                  </h2>
                  {materiasOrdenadas.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-faint)', fontSize: 13 }}>
                      📚 {tr('estudiaFlashcards')}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {materiasOrdenadas.map((m, i) => {
                        const prec = m.totalFlashcards > 0 ? Math.round((m.acertadas / m.totalFlashcards) * 100) : 0;
                        return (
                          <div key={i}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <div style={{ width: 9, height: 9, borderRadius: '50%', background: m.color }} />
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{m.nombre}</span>
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 800, color: prec >= 70 ? '#4ade80' : prec >= 50 ? 'var(--gold)' : 'var(--red)' }}>
                                {prec}%
                              </span>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, height: 7, overflow: 'hidden' }}>
                              <div style={{ width: `${prec}%`, height: '100%', background: prec >= 70 ? '#4ade80' : prec >= 50 ? 'var(--gold)' : 'var(--red)', borderRadius: 6, transition: 'width 0.8s ease' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Temas que más fallas */}
              <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: 4, background: 'var(--red)' }} />
                <div style={{ padding: 20 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px' }}>
                    {tr('temasQueFallas')}
                  </h2>
                  {topFalladas.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-faint)', fontSize: 13 }}>
                      🎉 {tr('sinFallas')}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {topFalladas.map(([pregunta, veces], i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--red-border)' }}>
                          <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#000', flexShrink: 0 }}>
                            {veces}x
                          </div>
                          <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                            {pregunta.length > 80 ? pregunta.substring(0, 80) + '...' : pregunta}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <ReporteSemanal />

            {/* Acciones */}
            <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
              <button onClick={() => window.location.href = '/materias'}
                style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: 'var(--gold)', color: '#000', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                {tr('irAEstudiar')}
              </button>
              <button onClick={() => window.location.href = '/chat'}
                style={{ padding: '12px 24px', borderRadius: 12, border: '2px solid var(--pink)', background: 'transparent', color: 'var(--pink)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                {tr('hablarJeffreyBot')}
              </button>
              <button onClick={() => {
                if (!confirm(tr('limpiarRachaStats'))) return;
                localStorage.removeItem('josea_racha');
                localStorage.removeItem('josea_perfil');
                window.location.reload();
              }}
                style={{ padding: '12px 24px', borderRadius: 12, border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                {tr('limpiarStats')}
              </button>
            </div>
          </div>
        )}

        {/* ── TAB: RANGOS ── */}
        {tabActivo === 'rangos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{
              background: 'var(--bg-card)', borderRadius: 16,
              border: `2px solid ${rango.color}44`, padding: 24,
              textAlign: 'center',
            }}>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                Tu rango actual
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <RangoDisplay xpTotal={xpTotal} size="lg" mostrarProgreso />
              </div>
            </div>
            <TablaRangos xpTotal={xpTotal} />
          </div>
        )}

        {/* ── TAB: LOGROS ── */}
        {tabActivo === 'logros' && (
          <LogrosPanel stats={logroStats} colorAccent={rango.color} />
        )}
      </div>
    </div>
  );
}
