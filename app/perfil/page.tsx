'use client';

import { useState, useEffect } from 'react';
import { getPerfil, getMaterias, PerfilEstudio } from '../../lib/storage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
import ReporteSemanal from '../../components/ReporteSemanal';

export default function PerfilPage() {
  const [perfil, setPerfil] = useState<PerfilEstudio | null>(null);
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  useEffect(() => {
    setPerfil(getPerfil());
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
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const materiasOrdenadas = Object.entries(perfil.materiasStats || {})
    .map(([id, stats]) => ({ id, ...stats }))
    .sort((a, b) => b.totalFlashcards - a.totalFlashcards);

  const materiaDificil = materiasOrdenadas
    .filter(m => m.totalFlashcards > 0)
    .sort((a, b) => (b.falladas / b.totalFlashcards) - (a.falladas / a.totalFlashcards))[0];

  const materiaFuerte = materiasOrdenadas
    .filter(m => m.totalFlashcards > 0)
    .sort((a, b) => (b.acertadas / b.totalFlashcards) - (a.acertadas / a.totalFlashcards))[0];

  const xpTotal = Object.values(perfil.materiasStats || {}).reduce((acc, m: any) => acc + m.totalFlashcards, 0);
  const nivel = Math.floor(xpTotal / 50) + 1;

  const logros = [
    { emoji: '🌱', label: idioma === 'en' ? 'First flashcard' : 'Primera flashcard', obtenido: total >= 1 },
    { emoji: '⚡', label: idioma === 'en' ? '50 studied' : '50 estudiadas', obtenido: total >= 50 },
    { emoji: '🔥', label: idioma === 'en' ? '100 studied' : '100 estudiadas', obtenido: total >= 100 },
    { emoji: '💎', label: idioma === 'en' ? 'Level 5' : 'Nivel 5', obtenido: nivel >= 5 },
    { emoji: '👑', label: idioma === 'en' ? 'Level 10' : 'Nivel 10', obtenido: nivel >= 10 },
    { emoji: '🎯', label: idioma === 'en' ? '80% accuracy' : '80% precisión', obtenido: porcentajeGlobal >= 80 && total > 10 },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {isMobile ? <NavbarMobile /> : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', height: '68px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => window.location.href = '/'}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ← {tr('inicio')}
              </button>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{tr('perfilEstudio')}</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>{tr('tuProgresoYStats')}</p>
              </div>
            </div>
            <button onClick={() => window.location.href = '/chat'}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--pink)', background: 'transparent', color: 'var(--pink)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              🤖 AlciBot
            </button>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            <div style={{ flex: 1, background: 'var(--gold)' }} />
            <div style={{ flex: 1, background: 'var(--red)' }} />
            <div style={{ flex: 1, background: 'var(--blue)' }} />
            <div style={{ flex: 1, background: 'var(--pink)' }} />
          </div>
        </>
      )}

      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: isMobile ? '16px' : '40px' }}>

        {/* Stats globales */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '1px', background: 'var(--border-color)', borderRadius: '16px', overflow: 'hidden', marginBottom: '24px' }}>
          {[
            { label: tr('totalEstudiadas'), value: total, color: 'var(--gold)', emoji: '📚' },
            { label: tr('acertadas'), value: totalAcertadas, color: '#4ade80', emoji: '✅' },
            { label: tr('falladas'), value: totalFalladas, color: 'var(--red)', emoji: '❌' },
            { label: tr('precision'), value: `${porcentajeGlobal}%`, color: 'var(--blue)', emoji: '🎯' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', padding: isMobile ? '16px 12px' : '24px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: isMobile ? '20px' : '24px', marginBottom: '4px' }}>{s.emoji}</div>
              <div style={{ fontSize: isMobile ? '22px' : '28px', fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: isMobile ? '9px' : '12px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '4px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Cards resumen */}
        {(materiaDificil || materiaFuerte) && (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
            {materiaDificil && (
              <div style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--red-border)', padding: '18px', display: 'flex', gap: '14px', alignItems: 'center' }}>
                <div style={{ fontSize: '36px' }}>😰</div>
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', margin: '0 0 4px' }}>{tr('materiaDificil')}</p>
                  <p style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{materiaDificil.nombre}</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                    {Math.round((materiaDificil.acertadas / materiaDificil.totalFlashcards) * 100)}% {tr('precision').toLowerCase()}
                  </p>
                </div>
              </div>
            )}
            {materiaFuerte && (
              <div style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid #4ade8044', padding: '18px', display: 'flex', gap: '14px', alignItems: 'center' }}>
                <div style={{ fontSize: '36px' }}>💪</div>
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', margin: '0 0 4px' }}>{tr('materiaFuerte')}</p>
                  <p style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{materiaFuerte.nombre}</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                    {Math.round((materiaFuerte.acertadas / materiaFuerte.totalFlashcards) * 100)}% {tr('precision').toLowerCase()}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Grid principal */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 290px', gap: '24px', alignItems: 'flex-start', marginBottom: '24px' }}>

          <div>
            {/* Precisión por materia */}
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', marginBottom: '20px' }}>
              <div style={{ height: '4px', background: 'var(--gold)' }} />
              <div style={{ padding: '20px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 20px' }}>
                  {tr('precisionPorMateria')}
                </h2>
                {materiasOrdenadas.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 0' }}>
                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>📚</div>
                    <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: 0 }}>{tr('estudiaFlashcards')}</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {materiasOrdenadas.map((m, i) => {
                      const precision = m.totalFlashcards > 0 ? Math.round((m.acertadas / m.totalFlashcards) * 100) : 0;
                      return (
                        <div key={i}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{m.nombre}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: 600 }}>✓ {m.acertadas}</span>
                              <span style={{ fontSize: '11px', color: 'var(--red)', fontWeight: 600 }}>✗ {m.falladas}</span>
                              <span style={{ fontSize: '13px', fontWeight: 800, color: precision >= 70 ? '#4ade80' : precision >= 50 ? 'var(--gold)' : 'var(--red)' }}>
                                {precision}%
                              </span>
                            </div>
                          </div>
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
                            <div style={{ width: `${precision}%`, height: '100%', background: precision >= 70 ? '#4ade80' : precision >= 50 ? 'var(--gold)' : 'var(--red)', borderRadius: '6px', transition: 'width 0.8s ease' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Temas más fallados */}
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: 'var(--red)' }} />
              <div style={{ padding: '20px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px' }}>
                  {tr('temasQueFallas')}
                </h2>
                {topFalladas.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <div style={{ fontSize: '36px', marginBottom: '8px' }}>🎉</div>
                    <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: 0 }}>{tr('sinFallas')}</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {topFalladas.map(([pregunta, veces], i) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: '10px', border: '1px solid var(--red-border)' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 900, color: '#000', flexShrink: 0 }}>
                          {veces}x
                        </div>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                          {pregunta.length > 90 ? pregunta.substring(0, 90) + '...' : pregunta}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Panel lateral */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* XP y nivel */}
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--gold-border)', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: 'var(--gold)' }} />
              <div style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 14px' }}>
                  {tr('tuProgreso')}
                </h3>
                <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                  <div style={{ fontSize: '48px', fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>{nivel}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>{tr('nivelActual')}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', height: '10px', overflow: 'hidden', marginBottom: '8px' }}>
                  <div style={{ width: `${(xpTotal % 50) * 2}%`, height: '100%', background: 'var(--gold)', borderRadius: '10px', transition: 'width 0.5s' }} />
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0, textAlign: 'center' }}>
                  {xpTotal % 50}/50 XP → {idioma === 'en' ? 'Level' : 'Nivel'} {nivel + 1}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '14px' }}>
                  {[
                    { label: tr('totalEstudiadas'), val: total, color: 'var(--gold)' },
                    { label: tr('precision'), val: `${porcentajeGlobal}%`, color: 'var(--blue)' },
                    { label: tr('materias'), val: materiasOrdenadas.length, color: 'var(--pink)' },
                    { label: idioma === 'en' ? 'Level' : 'Nivel', val: nivel, color: 'var(--gold)' },
                  ].map((s, i) => (
                    <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '16px', fontWeight: 900, color: s.color }}>{s.val}</div>
                      <div style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Logros */}
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: '#a78bfa' }} />
              <div style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '12px', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 14px' }}>
                  {tr('logros')}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  {logros.map((logro, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: logro.obtenido ? '#a78bfa18' : 'var(--bg-secondary)', borderRadius: '10px', border: `1px solid ${logro.obtenido ? '#a78bfa44' : 'var(--border-color)'}`, opacity: logro.obtenido ? 1 : 0.4 }}>
                      <span style={{ fontSize: '18px' }}>{logro.emoji}</span>
                      <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, flex: 1 }}>{logro.label}</p>
                      {logro.obtenido && <span style={{ fontSize: '14px' }}>✓</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quizzes */}
            {materiasOrdenadas.filter(m => m.quizzes > 0).length > 0 && (
              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: '#a78bfa' }} />
                <div style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '12px', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
                    🤓 {tr('quizzes')}
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {materiasOrdenadas.filter(m => m.quizzes > 0).map((m, i) => {
                      const avgQuiz = m.quizzes > 0 ? Math.round(m.quizPuntuacion / m.quizzes) : 0;
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color }} />
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{m.nombre}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{m.quizzes} {tr('quizzes').toLowerCase()}</span>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: avgQuiz >= 80 ? '#4ade80' : avgQuiz >= 60 ? 'var(--gold)' : 'var(--red)' }}>
                              {avgQuiz}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Reporte semanal */}
        <ReporteSemanal />

        {/* Botones acción */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <button onClick={() => window.location.href = '/materias'}
            style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
            {tr('irAEstudiar')}
          </button>
          <button onClick={() => window.location.href = '/chat'}
            style={{ padding: '12px 24px', borderRadius: '12px', border: '2px solid var(--pink)', background: 'transparent', color: 'var(--pink)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            {tr('hablarAlciBot')}
          </button>
          <button onClick={() => {
            if (!confirm(tr('limpiarRachaStats'))) return;
            localStorage.removeItem('josea_racha');
            localStorage.removeItem('josea_perfil');
            window.location.reload();
          }}
            style={{ padding: '12px 24px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            {tr('limpiarStats')}
          </button>
        </div>
      </div>
    </div>
  );
}