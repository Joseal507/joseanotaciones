'use client';

import { useRouter } from 'next/navigation';

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
import { getObjetivos } from '../../lib/agenda';
import { getRacha } from '../../lib/racha';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

export default function PerfilPage() {
  const router = useRouter();
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
      <p style={{ fontFamily: HAND, fontSize: 22, color: 'var(--text-faint)', fontStyle: 'italic' }}>~ {tr('cargando')} ~</p>
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

  const quizzesTotales = Object.values(perfil.materiasStats || {}).reduce((a: number, m: any) => a + (m.quizzes || 0), 0);

  const rachaData = getRacha();
  const objetivos = getObjetivos();
  const rango = getRango(xpTotal);

  const logroStats: LogroStats = {
    xpTotal,
    flashcardsEstudiadas: total,
    quizzesCompletados: quizzesTotales,
    rachaActual: rachaData.rachaActual,
    mejorRacha: rachaData.mejorRacha,
    precision: porcentajeGlobal,
    materiasCreadas: materiasOrdenadas.length,
    postsCreados: 0,
    rangoId: rango.id,
  };

  const logrosObtenidos = getLogrosObtenidos(logroStats);

  const tabs = [
    { id: 'stats'  as const, label: tr('tabs_stats'),  emoji: '📊', color: 'var(--gold)' },
    { id: 'rangos' as const, label: tr('tabs_rangos'), emoji: '🏆', color: rango.color },
    { id: 'logros' as const, label: `${tr('tabs_logros')} (${logrosObtenidos.length})`, emoji: '🎖️', color: '#a78bfa' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>

      {isMobile ? <NavbarMobile /> : (
        <header style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
          backdropFilter: 'blur(14px)',
          borderBottom: '2.5px solid var(--text-primary)',
          padding: '12px 36px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1.5deg)';}}
            >
              ← {tr('inicio')}
            </button>
            <div>
              <h1 style={{
                fontFamily: HAND, fontSize: 32, fontWeight: 900,
                color: 'var(--text-primary)', margin: 0, lineHeight: 1,
                transform: 'rotate(-1deg)', display: 'inline-block',
              }}>
                📊 {tr('misStats')}
              </h1>
              <svg width="160" height="6" style={{ display: 'block', marginTop: 2 }}>
                <path d="M2 3 Q 80 0 158 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
              </svg>
            </div>
          </div>
          <button onClick={() => ((window as any).__showNavLoader?.('/chat'), router.push('/chat'))}
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              border: '2.5px solid var(--pink)',
              background: 'transparent',
              color: 'var(--pink)',
              fontFamily: HAND, fontSize: 17, fontWeight: 800,
              cursor: 'pointer',
              transform: 'rotate(1.5deg)',
              transition: 'all 0.25s',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.background='color-mix(in srgb,var(--pink) 14%,transparent)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(1.5deg)';e.currentTarget.style.background='transparent';}}
          >
            🤖 ChapBot
          </button>
        </header>
      )}

      {/* Línea rasgada */}
      <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{
        display: 'block', width: '100%', height: 14,
      }}>
        <path
          d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
          fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.45"
        />
      </svg>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? 16 : '28px 36px 60px' }}>

        {/* HERO: Avatar + Rango */}
        <div style={{
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 16,
          padding: isMobile ? '20px 16px' : '24px 28px',
          marginBottom: 22,
          display: 'flex', alignItems: 'center', gap: 22,
          flexWrap: 'wrap',
          boxShadow: `5px 6px 0 ${rango.color}`,
          transform: 'rotate(-0.4deg)',
          position: 'relative',
        }}>
          {/* Cinta scotch */}
          <div style={{
            position: 'absolute', top: -10, left: '50%',
            transform: 'translateX(-50%) rotate(-3deg)',
            width: 90, height: 18,
            background: `color-mix(in srgb,${rango.color} 55%,transparent)`,
            border: `1px solid color-mix(in srgb,${rango.color} 30%,transparent)`,
            boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          }}/>

          <MarcoAvatar
            xpTotal={xpTotal}
            fotoPerfil={fotoPerfil}
            nombre={nombre}
            size={isMobile ? 76 : 100}
          />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{
              fontFamily: HAND,
              fontSize: isMobile ? 28 : 36, fontWeight: 900,
              color: 'var(--text-primary)', marginBottom: 4,
              transform: 'rotate(-0.8deg)', display: 'inline-block',
              lineHeight: 1.05,
            }}>
              {nombre}
            </div>
            <div style={{ marginBottom: 12 }}>
              <RangoDisplay xpTotal={xpTotal} size={isMobile ? 'sm' : 'md'} mostrarProgreso />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { txt: `${tr('nivel')} ${nivel} · ${titulo.emoji} ${titulo.titulo}`, color: 'var(--text-muted)', rot: -1.5 },
                { txt: `${xpTotal.toLocaleString()} ${tr('xpTotales')}`,             color: rango.color,          rot: 1.5 },
                { txt: `🎖️ ${logrosObtenidos.length} ${idioma === 'en' ? 'achievements' : 'logros'}`, color: '#a78bfa', rot: -1 },
                { txt: `🔥 ${rachaData.rachaActual} ${idioma === 'en' ? 'day streak' : 'días de racha'}`, color: '#ef4444', rot: 1 },
              ].map((badge, i) => (
                <span key={i} style={{
                  fontFamily: HAND, fontSize: 14, fontWeight: 800,
                  background: `color-mix(in srgb,${badge.color} 16%,transparent)`,
                  color: badge.color,
                  border: `1.5px dashed ${badge.color}`,
                  padding: '3px 10px',
                  borderRadius: 8,
                  transform: `rotate(${badge.rot}deg)`,
                  fontStyle: 'italic',
                }}>
                  {badge.txt}
                </span>
              ))}
            </div>
          </div>

          <button onClick={async () => {
            const { supabase } = await import('../../lib/supabase');
            const { data } = await supabase.auth.getUser();
            if (data.user?.id) { const uid = data.user.id; (window as any).__showNavLoader?.(`/u/${uid}`); router.push(`/u/${uid}`); }
          }}
            style={{
              padding: '10px 18px',
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: rango.color, color: '#000',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              cursor: 'pointer', whiteSpace: 'nowrap',
              boxShadow: '3px 4px 0 var(--text-primary)',
              transform: 'rotate(2deg)',
              transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='4px 6px 0 var(--text-primary)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(2deg)';e.currentTarget.style.boxShadow='3px 4px 0 var(--text-primary)';}}
          >
            🌐 {tr('verPerfilPublicoBtn').replace('🌐 ','')}
          </button>
        </div>

        {/* TABS estilo pestañas */}
        <div style={{
          display: 'flex', gap: 8, marginBottom: 22,
          flexWrap: 'wrap', justifyContent: 'flex-start',
        }}>
          {tabs.map((tab, i) => {
            const active = tabActivo === tab.id;
            return (
              <button key={tab.id} onClick={() => setTabActivo(tab.id)}
                style={{
                  padding: '10px 20px',
                  background: active ? tab.color : 'var(--bg-card)',
                  color: active ? '#000' : 'var(--text-muted)',
                  border: `2.5px solid ${active ? tab.color : 'var(--border-color)'}`,
                  borderRadius: 12,
                  cursor: 'pointer',
                  fontFamily: HAND, fontSize: 19, fontWeight: 800,
                  display: 'flex', alignItems: 'center', gap: 8,
                  boxShadow: active ? '3px 4px 0 var(--text-primary)' : 'none',
                  transform: active
                    ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                    : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
                  transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
                }}
                onMouseEnter={(e:any)=>{ if (!active) e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)'; }}
                onMouseLeave={(e:any)=>{
                  e.currentTarget.style.transform = active
                    ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                    : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`;
                }}
              >
                <span style={{ fontSize: 20 }}>{tab.emoji}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB STATS */}
        {tabActivo === 'stats' && (
          <div>
            {/* Stats globales */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)',
              gap: 14, marginBottom: 22,
            }}>
              {[
                { label: tr('totalEstudiadas'), value: total,           color: 'var(--gold)', emoji: '📚', rot: -2 },
                { label: tr('acertadas'),       value: totalAcertadas,  color: '#4ade80',     emoji: '✅', rot: 1.5 },
                { label: tr('falladas'),        value: totalFalladas,   color: 'var(--red)',  emoji: '❌', rot: -1.5 },
                { label: tr('precision'),       value: `${porcentajeGlobal}%`, color: 'var(--blue)', emoji: '🎯', rot: 2 },
              ].map((s, i) => (
                <div key={i} style={{
                  background: 'var(--bg-card)',
                  border: '2.5px solid var(--text-primary)',
                  borderRadius: 12,
                  padding: isMobile ? '14px 12px' : '18px 14px',
                  textAlign: 'center',
                  boxShadow: `3px 4px 0 ${s.color}`,
                  transform: `rotate(${s.rot}deg)`,
                  transition: 'transform 0.25s',
                }}
                  onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) translateY(-2px)'}
                  onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${s.rot}deg)`}
                >
                  <div style={{ fontSize: isMobile ? 22 : 26, marginBottom: 4 }}>{s.emoji}</div>
                  <div style={{
                    fontFamily: HAND, fontSize: isMobile ? 26 : 32, fontWeight: 900,
                    color: s.color, lineHeight: 1,
                  }}>{s.value}</div>
                  <div style={{
                    fontFamily: BODY, fontSize: isMobile ? 12 : 14, fontWeight: 700,
                    color: 'var(--text-muted)', fontStyle: 'italic',
                    marginTop: 4,
                  }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* XP Card */}
            <div style={{
              background: 'var(--bg-card)',
              border: '2.5px solid var(--text-primary)',
              borderRadius: 14,
              boxShadow: `4px 5px 0 ${rango.color}`,
              transform: 'rotate(-0.3deg)',
              marginBottom: 22,
              overflow: 'hidden',
            }}>
              <div style={{
                background: rango.marcoGradient,
                padding: '8px 18px',
                borderBottom: '2px solid var(--text-primary)',
              }}>
                <span style={{
                  fontFamily: HAND, fontSize: 18, fontWeight: 900,
                  color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.35)',
                  fontStyle: 'italic',
                }}>
                  {rango.emoji} {tr('progresoXP')}
                </span>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', marginBottom: 14,
                  flexWrap: 'wrap', gap: 12,
                }}>
                  <span style={{
                    fontFamily: BODY, fontSize: 17, fontStyle: 'italic',
                    color: 'var(--text-muted)',
                  }}>
                    ~ {tr('nivel')} {nivel} · {xpEnNivel}/{xpParaSiguiente} XP ~
                  </span>
                </div>
                <div style={{
                  height: 14,
                  background: 'var(--bg-secondary)',
                  border: '2px solid var(--text-primary)',
                  borderRadius: 7,
                  overflow: 'hidden', marginBottom: 8,
                }}>
                  <div style={{
                    height: '100%', width: `${progreso}%`,
                    background: rango.marcoGradient,
                    borderRadius: 5,
                    transition: 'width 0.6s ease',
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3)`,
                  }} />
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontFamily: BODY, fontSize: 14, fontStyle: 'italic',
                  color: 'var(--text-faint)',
                }}>
                  <span>~ {progreso}% {tr('delNivel')} {nivel} ~</span>
                  <span>→ {tr('nivel')} {nivel + 1}</span>
                </div>
              </div>
            </div>

            {/* Materias + Falladas */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              gap: 18, marginBottom: 22,
            }}>
              {/* Stats por materia */}
              <NotebookCard color="var(--gold)" emoji="📚" title={idioma === 'en' ? 'Stats by Subject' : 'Estadísticas por materia'} rot={-0.4}>
                {materiasOrdenadas.length === 0 ? (
                  <Texto>📚 {idioma === 'en' ? 'Study flashcards, quizzes & goals to see stats' : 'Estudia flashcards, quizzes y objetivos para ver tus estadísticas'}</Texto>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {materiasOrdenadas.map((m: any, i) => {
                      const prec = m.totalFlashcards > 0 ? Math.round((m.acertadas / m.totalFlashcards) * 100) : 0;
                      const objsMateria = objetivos.filter(o => o.materiaColor === m.color);
                      const objsCompletados = objsMateria.filter(o => o.completado).length;

                      return (
                        <div key={i} style={{
                          background: 'var(--bg-secondary)',
                          padding: 12,
                          borderRadius: 12,
                          border: `2px dashed ${m.color}`,
                          transform: `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                width: 12, height: 12, borderRadius: '50%',
                                background: m.color,
                                border: '1.5px solid var(--text-primary)',
                                boxShadow: `0 0 6px ${m.color}88`,
                              }} />
                              <span style={{
                                fontFamily: HAND, fontSize: 19, fontWeight: 800,
                                color: 'var(--text-primary)',
                              }}>{m.nombre}</span>
                            </div>
                            <span style={{
                              fontFamily: HAND, fontSize: 15, fontWeight: 800,
                              color: prec >= 70 ? '#4ade80' : prec >= 50 ? 'var(--gold)' : 'var(--red)',
                              background: 'var(--bg-primary)',
                              border: `1.5px solid ${prec >= 70 ? '#4ade80' : prec >= 50 ? 'var(--gold)' : 'var(--red)'}`,
                              padding: '1px 10px', borderRadius: 6,
                              transform: 'rotate(-2deg)',
                            }}>
                              {prec}% {tr('precision')}
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
                            {[
                              { v: m.totalFlashcards, l: '🎴 Cards', c: 'var(--text-primary)' },
                              { v: m.quizzes || 0,    l: '📝 Quizzes', c: 'var(--gold)' },
                              { v: `${objsCompletados}/${objsMateria.length}`, l: '🎯 ' + (idioma === 'en' ? 'Goals' : 'Objetivos'), c: '#3b82f6' },
                            ].map((stat, j) => (
                              <div key={j} style={{
                                textAlign: 'center',
                                padding: '4px 0',
                                background: 'var(--bg-card)',
                                border: '1.5px dashed var(--border-color)',
                                borderRadius: 8,
                                transform: `rotate(${(j % 2 === 0 ? -0.5 : 0.5)}deg)`,
                              }}>
                                <div style={{ fontFamily: HAND, fontSize: 18, fontWeight: 900, color: stat.c }}>{stat.v}</div>
                                <div style={{ fontFamily: HAND, fontSize: 12, fontStyle: 'italic', color: 'var(--text-muted)' }}>{stat.l}</div>
                              </div>
                            ))}
                          </div>

                          <div style={{
                            background: 'var(--bg-primary)',
                            border: '1.5px solid var(--text-primary)',
                            borderRadius: 5, height: 7,
                            overflow: 'hidden', marginTop: 10,
                          }}>
                            <div style={{
                              width: `${prec}%`, height: '100%',
                              background: m.color,
                              borderRadius: 3,
                              transition: 'width 0.8s ease',
                              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </NotebookCard>

              {/* Temas falladas */}
              <NotebookCard color="var(--red)" emoji="❌" title={tr('temasQueFallas')} rot={0.4}>
                {topFalladas.length === 0 ? (
                  <Texto>🎉 {tr('sinFallas')}</Texto>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {topFalladas.map(([pregunta, veces], i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        padding: '8px 12px',
                        background: 'color-mix(in srgb,var(--red) 10%,transparent)',
                        border: '2px dashed var(--red)',
                        borderRadius: 10,
                        transform: `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 7,
                          background: 'var(--red)',
                          border: '2px solid var(--text-primary)',
                          boxShadow: '2px 2px 0 var(--text-primary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: HAND, fontSize: 14, fontWeight: 900, color: '#fff',
                          flexShrink: 0,
                          transform: 'rotate(-5deg)',
                        }}>
                          {veces}×
                        </div>
                        <p style={{
                          fontFamily: BODY, fontSize: 15, fontWeight: 600,
                          color: 'var(--text-secondary)',
                          margin: 0, lineHeight: 1.35,
                        }}>
                          {pregunta.length > 80 ? pregunta.substring(0, 80) + '...' : pregunta}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </NotebookCard>
            </div>

            <ReporteSemanal />

            {/* Acciones */}
            <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
              <PrimaryBtn onClick={() => ((window as any).__showNavLoader?.('/materias'), router.push('/materias'))} color="var(--gold)">
                📚 {tr('irAEstudiar')}
              </PrimaryBtn>
              <SecondaryBtn onClick={() => ((window as any).__showNavLoader?.('/chat'), router.push('/chat'))} color="var(--pink)">
                🤖 {tr('hablarChapBot')}
              </SecondaryBtn>
              <SecondaryBtn onClick={() => {
                if (!confirm(tr('limpiarRachaStats'))) return;
                localStorage.removeItem('josea_racha');
                localStorage.removeItem('josea_perfil');
                window.location.reload();
              }} color="var(--text-faint)">
                🗑️ {tr('limpiarStats')}
              </SecondaryBtn>
            </div>
          </div>
        )}

        {/* TAB RANGOS */}
        {tabActivo === 'rangos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <NotebookCard color={rango.color} emoji={rango.emoji} title={tr('tuRangoActual')} rot={-0.4}>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                <RangoDisplay xpTotal={xpTotal} size="lg" mostrarProgreso />
              </div>
            </NotebookCard>
            <TablaRangos xpTotal={xpTotal} />
          </div>
        )}

        {/* TAB LOGROS */}
        {tabActivo === 'logros' && (
          <LogrosPanel stats={logroStats} colorAccent={rango.color} />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function NotebookCard({ children, color, emoji, title, rot }: {
  children: React.ReactNode;
  color: string;
  emoji: string;
  title: string;
  rot: number;
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '2.5px solid var(--text-primary)',
      borderRadius: 14,
      boxShadow: `4px 5px 0 ${color}`,
      transform: `rotate(${rot}deg)`,
      overflow: 'hidden',
    }}>
      <div style={{
        background: color,
        padding: '8px 18px',
        borderBottom: '2px solid var(--text-primary)',
      }}>
        <h2 style={{
          fontFamily: HAND, fontSize: 22, fontWeight: 900,
          color: '#000', margin: 0, fontStyle: 'italic',
          transform: 'rotate(-0.5deg)', display: 'inline-block',
        }}>
          {emoji} {title}
        </h2>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Texto({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: BODY, fontSize: 17, fontStyle: 'italic',
      color: 'var(--text-muted)', margin: 0, textAlign: 'center',
      padding: '14px 0',
    }}>
      ~ {children} ~
    </p>
  );
}

function PrimaryBtn({ children, onClick, color }: any) {
  return (
    <button onClick={onClick}
      style={{
        padding: '12px 22px',
        borderRadius: 12,
        border: '2.5px solid var(--text-primary)',
        background: color, color: '#000',
        fontFamily: HAND, fontSize: 19, fontWeight: 800,
        cursor: 'pointer',
        boxShadow: '3px 4px 0 var(--text-primary)',
        transform: 'rotate(-1deg)',
        transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
      }}
      onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='4px 6px 0 var(--text-primary)';}}
      onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';e.currentTarget.style.boxShadow='3px 4px 0 var(--text-primary)';}}
    >
      {children}
    </button>
  );
}

function SecondaryBtn({ children, onClick, color }: any) {
  return (
    <button onClick={onClick}
      style={{
        padding: '11px 20px',
        borderRadius: 12,
        border: `2.5px dashed ${color}`,
        background: 'transparent',
        color,
        fontFamily: HAND, fontSize: 18, fontWeight: 800,
        cursor: 'pointer',
        transform: 'rotate(1deg)',
        transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
      }}
      onMouseEnter={(e:any)=>{
        e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';
        e.currentTarget.style.borderStyle='solid';
        e.currentTarget.style.background=`color-mix(in srgb,${color} 14%,transparent)`;
      }}
      onMouseLeave={(e:any)=>{
        e.currentTarget.style.transform='rotate(1deg)';
        e.currentTarget.style.borderStyle='dashed';
        e.currentTarget.style.background='transparent';
      }}
    >
      {children}
    </button>
  );
}