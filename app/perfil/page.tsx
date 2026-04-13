'use client';

import { useState, useEffect } from 'react';
import { getPerfil, getMaterias, PerfilEstudio } from '../../lib/storage';

export default function PerfilPage() {
  const [perfil, setPerfil] = useState<PerfilEstudio | null>(null);

  useEffect(() => {
    setPerfil(getPerfil());
    getMaterias();
  }, []);

  if (!perfil) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text-faint)' }}>Cargando...</p>
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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {/* Header */}
      <header style={{
        background: 'var(--bg-card)',
        borderBottom: '3px solid var(--gold)',
        padding: '0 40px',
        height: '68px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            onClick={() => window.location.href = '/'}
            style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            ← Inicio
          </button>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
              📊 Mi Perfil de Estudio
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
              Tu progreso y estadísticas personalizadas
            </p>
          </div>
        </div>
        <button
          onClick={() => window.location.href = '/chat'}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--pink)', background: 'transparent', color: 'var(--pink)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          🤖 Hablar con AlciBot
        </button>
      </header>

      {/* Barra colores */}
      <div style={{ display: 'flex', height: '3px' }}>
        <div style={{ flex: 1, background: 'var(--gold)' }} />
        <div style={{ flex: 1, background: 'var(--red)' }} />
        <div style={{ flex: 1, background: 'var(--blue)' }} />
        <div style={{ flex: 1, background: 'var(--pink)' }} />
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px' }}>

        {/* Stats globales */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1px',
          background: 'var(--border-color)',
          borderRadius: '16px',
          overflow: 'hidden',
          marginBottom: '32px',
        }}>
          {[
            { label: 'Total estudiadas', value: total, color: 'var(--gold)', emoji: '📚' },
            { label: 'Acertadas', value: totalAcertadas, color: '#4ade80', emoji: '✅' },
            { label: 'Falladas', value: totalFalladas, color: 'var(--red)', emoji: '❌' },
            { label: 'Precisión global', value: `${porcentajeGlobal}%`, color: 'var(--blue)', emoji: '🎯' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', padding: '24px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>{s.emoji}</div>
              <div style={{ fontSize: '28px', fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '4px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Cards resumen */}
        {(materiaDificil || materiaFuerte) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
            {materiaDificil && (
              <div style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--red-border)', padding: '20px', display: 'flex', gap: '14px', alignItems: 'center' }}>
                <div style={{ fontSize: '40px' }}>😰</div>
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', margin: '0 0 4px' }}>Materia más difícil</p>
                  <p style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{materiaDificil.nombre}</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                    {Math.round((materiaDificil.acertadas / materiaDificil.totalFlashcards) * 100)}% de precisión
                  </p>
                </div>
              </div>
            )}
            {materiaFuerte && (
              <div style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid #4ade8044', padding: '20px', display: 'flex', gap: '14px', alignItems: 'center' }}>
                <div style={{ fontSize: '40px' }}>💪</div>
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', margin: '0 0 4px' }}>Materia más fuerte</p>
                  <p style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{materiaFuerte.nombre}</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                    {Math.round((materiaFuerte.acertadas / materiaFuerte.totalFlashcards) * 100)}% de precisión
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

          {/* Stats por materia */}
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: 'var(--gold)' }} />
            <div style={{ padding: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 20px' }}>
                📚 Precisión por materia
              </h2>
              {materiasOrdenadas.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>📚</div>
                  <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: 0 }}>
                    Estudia flashcards para ver tus stats
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {materiasOrdenadas.map((m, i) => {
                    const precision = m.totalFlashcards > 0
                      ? Math.round((m.acertadas / m.totalFlashcards) * 100)
                      : 0;
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
                            <span style={{
                              fontSize: '13px',
                              fontWeight: 800,
                              color: precision >= 70 ? '#4ade80' : precision >= 50 ? 'var(--gold)' : 'var(--red)',
                            }}>
                              {precision}%
                            </span>
                          </div>
                        </div>
                        <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${precision}%`,
                            height: '100%',
                            background: precision >= 70 ? '#4ade80' : precision >= 50 ? 'var(--gold)' : 'var(--red)',
                            borderRadius: '6px',
                            transition: 'width 0.8s ease',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Flashcards más falladas */}
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: 'var(--red)' }} />
            <div style={{ padding: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 20px' }}>
                🔥 Temas que más fallas
              </h2>
              {topFalladas.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>🎉</div>
                  <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: 0 }}>
                    ¡Aún no has fallado ninguna!
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {topFalladas.map(([pregunta, veces], i) => (
                    <div key={i} style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'flex-start',
                      padding: '10px 12px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '10px',
                      border: '1px solid var(--red-border)',
                    }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '8px',
                        background: 'var(--red)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 900,
                        color: '#000',
                        flexShrink: 0,
                      }}>
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

          {/* Quizzes */}
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: '#a78bfa' }} />
            <div style={{ padding: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 20px' }}>
                🤓 Quizzes por materia
              </h2>
              {materiasOrdenadas.filter(m => m.quizzes > 0).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ fontSize: '40px', marginBottom: '8px' }}>🤓</div>
                  <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: 0 }}>
                    Haz algún quiz para ver resultados
                  </p>
                  <button
                    onClick={() => window.location.href = '/materias'}
                    style={{ marginTop: '12px', padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#a78bfa', color: '#000', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    Ir a mis materias
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {materiasOrdenadas.filter(m => m.quizzes > 0).map((m, i) => {
                    const avgQuiz = m.quizzes > 0 ? Math.round(m.quizPuntuacion / m.quizzes) : 0;
                    return (
                      <div key={i} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 14px',
                        background: 'var(--bg-secondary)',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{m.nombre}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                            {m.quizzes} quiz{m.quizzes !== 1 ? 'zes' : ''}
                          </span>
                          <span style={{
                            fontSize: '14px',
                            fontWeight: 800,
                            color: avgQuiz >= 80 ? '#4ade80' : avgQuiz >= 60 ? 'var(--gold)' : 'var(--red)',
                          }}>
                            {avgQuiz}% avg
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recomendaciones */}
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: 'var(--gold)' }} />
            <div style={{ padding: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 20px' }}>
                🤖 Recomendaciones de AlciBot
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {total === 0 && (
                  <div style={{ padding: '14px', background: 'var(--gold-dim)', borderRadius: '10px', border: '1px solid var(--gold-border)' }}>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                      💡 Empieza a estudiar flashcards para recibir recomendaciones personalizadas basadas en tu rendimiento.
                    </p>
                  </div>
                )}

                {topFalladas.length > 0 && (
                  <div style={{ padding: '14px', background: 'var(--red-dim)', borderRadius: '10px', border: '1px solid var(--red-border)' }}>
                    <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--red)', margin: '0 0 6px', textTransform: 'uppercase' }}>
                      🔥 Repasa este tema
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                      Has fallado <strong style={{ color: 'var(--text-primary)' }}>"{topFalladas[0][0].substring(0, 60)}..."</strong> {topFalladas[0][1]} veces. Dedícale tiempo extra.
                    </p>
                  </div>
                )}

                {materiaDificil && (materiaDificil.acertadas / materiaDificil.totalFlashcards) < 0.6 && (
                  <div style={{ padding: '14px', background: 'var(--blue-dim)', borderRadius: '10px', border: '1px solid var(--blue-border)' }}>
                    <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--blue)', margin: '0 0 6px', textTransform: 'uppercase' }}>
                      📚 Materia difícil
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{materiaDificil.nombre}</strong> tiene menos del 60% de precisión. Te recomiendo hacer más sesiones de estudio en bucle.
                    </p>
                  </div>
                )}

                {materiaFuerte && (materiaFuerte.acertadas / materiaFuerte.totalFlashcards) >= 0.85 && (
                  <div style={{ padding: '14px', background: '#4ade8015', borderRadius: '10px', border: '1px solid #4ade8044' }}>
                    <p style={{ fontSize: '11px', fontWeight: 800, color: '#4ade80', margin: '0 0 6px', textTransform: 'uppercase' }}>
                      💪 Punto fuerte
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                      Dominas <strong style={{ color: 'var(--text-primary)' }}>{materiaFuerte.nombre}</strong> con {Math.round((materiaFuerte.acertadas / materiaFuerte.totalFlashcards) * 100)}% de precisión. ¡Sigue así!
                    </p>
                  </div>
                )}

                {porcentajeGlobal >= 80 && total > 10 && (
                  <div style={{ padding: '14px', background: '#4ade8015', borderRadius: '10px', border: '1px solid #4ade8044' }}>
                    <p style={{ fontSize: '13px', color: '#4ade80', margin: 0, fontWeight: 600 }}>
                      🏆 ¡Excelente nivel! {porcentajeGlobal}% de precisión global con {total} flashcards estudiadas.
                    </p>
                  </div>
                )}

                <button
                  onClick={() => window.location.href = '/chat'}
                  style={{ padding: '12px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer', marginTop: '4px', width: '100%' }}>
                  🤖 Hablar con AlciBot sobre mi progreso →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}