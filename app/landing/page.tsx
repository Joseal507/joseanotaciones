'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import Footer from '../../components/Footer';
import { useIsMobile } from '../../hooks/useIsMobile';

const HAND = "'Caveat',cursive";

export default function LandingPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        ((window as any).__showNavLoader?.('/'), router.replace('/'));
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <p style={{ fontFamily: HAND, fontSize: 22, color: 'var(--text-muted)', fontStyle: 'italic' }}>~ cargando ~</p>
      </div>
    );
  }

  const features = [
    { emoji: '📚', title: 'Materias', desc: 'organiza apuntes, docs y temas', color: 'var(--gold)', rot: -1.5 },
    { emoji: '🎴', title: 'Flashcards', desc: 'genera tarjetas con AI', color: '#a78bfa', rot: 1.5 },
    { emoji: '🤓', title: 'Quizzes', desc: 'pon a prueba tu conocimiento', color: '#34d399', rot: -1 },
    { emoji: '🤖', title: 'ChapBot', desc: 'tu IA para resolver dudas', color: 'var(--pink)', rot: 1 },
    { emoji: '⏱️', title: 'Timer', desc: 'enfócate con pomodoro integrado', color: '#ef4444', rot: -1.5 },
    { emoji: '📅', title: 'Agenda', desc: 'planifica tareas y objetivos', color: 'var(--blue)', rot: 1.5 },
    { emoji: '🗓️', title: 'Horario', desc: 'tu horario de clases siempre a mano', color: '#fb923c', rot: -1 },
    { emoji: '🌍', title: 'Comunidad', desc: 'comparte apuntes y aprende juntos', color: '#34d399', rot: 1 },
    { emoji: '🏆', title: 'Leaderboard', desc: 'compite con otros estudiantes', color: 'var(--gold)', rot: -1.5 },
    { emoji: '👥', title: 'Partners', desc: 'chatea con tus compañeros', color: 'var(--blue)', rot: 1.5 },
    { emoji: '🎥', title: 'Blinks', desc: 'reels de estudio tipo TikTok', color: 'var(--red)', rot: -1 },
    { emoji: '✨', title: 'XP & Rangos', desc: 'sube de nivel estudiando', color: 'var(--pink)', rot: 1 },
  ];

  const testimonios = [
    { name: 'Jose Alberto de Obaldía', carrera: 'Medicina · ULAT', emoji: '👦', text: '~ subí mi GPA con las flashcards de la IA ~', rot: -1.5 },
    { name: 'Luis Manzanares', carrera: 'Economía Cuantitativa', emoji: '👦', text: '~ el ChapBot me salva en mate todos los días ~', rot: 1.5 },
    { name: 'Shia Páez', carrera: 'Escuela · AIP', emoji: '👧', text: '~ los blinks me ayudan a repasar antes de dormir ~', rot: -1 },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative', overflow: 'hidden' }}>

      {/* Header simple */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
        backdropFilter: 'blur(14px)',
        borderBottom: '2.5px solid var(--text-primary)',
        padding: '12px 24px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div id="header-logo-target" style={{ position: 'relative', width: 40, height: 40 }}>
            <svg viewBox="0 0 200 200" style={{ position: 'absolute', inset: -10, width: 60, height: 60, pointerEvents: 'none', overflow: 'visible' }}>
              <circle cx="100" cy="100" r="92" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--gold) 55%, transparent)) drop-shadow(0 0 14px color-mix(in srgb, var(--gold) 30%, transparent))' }}/>
              {/* Destello quitado — solo círculo dorado fijo arriba */}
            </svg>
            <img src="/logo.png" alt="Logo" style={{
              position: 'absolute', left: '55%', top: '48%',
              width: '100%', height: '100%',
              objectFit: 'contain', objectPosition: 'center',
              transform: 'translate(-50%, -50%) scale(2.2)',
              pointerEvents: 'none', zIndex: 1,
            }}/>
          </div>
          <h1 style={{
            margin: 0,
            fontFamily: HAND, fontSize: 28, fontWeight: 900,
            color: 'var(--text-primary)', lineHeight: 1,
            transform: 'rotate(-1deg)', display: 'inline-block',
          }}>
            Study<span style={{ color: 'var(--red)' }}>A</span>L
          </h1>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => ((window as any).__showNavLoader?.('/auth'), router.push('/auth'))}
            style={{
              padding: '8px 18px',
              borderRadius: 10,
              border: '2.5px dashed var(--text-faint)',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 17, fontWeight: 800,
              cursor: 'pointer',
              transform: 'rotate(-1deg)',
              transition: 'all 0.25s',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.borderStyle='solid';e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.borderStyle='dashed';e.currentTarget.style.transform='rotate(-1deg)';}}
          >
            Iniciar sesión
          </button>
          <button onClick={() => ((window as any).__showNavLoader?.('/auth?modo=registro'), router.push('/auth?modo=registro'))}
            style={{
              padding: '8px 20px',
              borderRadius: 10,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--gold)', color: '#000',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 3px 0 var(--text-primary)',
              transform: 'rotate(1.5deg)',
              transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='4px 5px 0 var(--text-primary)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(1.5deg)';e.currentTarget.style.boxShadow='3px 3px 0 var(--text-primary)';}}
          >
            ✨ Empezar gratis
          </button>
        </div>
      </header>

      {/* Línea rasgada */}
      <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{
        display: 'block', width: '100%', height: 14,
      }}>
        <path
          d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
          fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.45"
        />
      </svg>

      {/* HERO */}
      <section style={{
        maxWidth: 1100, margin: '0 auto',
        padding: isMobile ? '40px 20px' : '80px 36px',
        textAlign: 'center',
      }}>
        {/* Logo idéntico al home — box/scale/ringInset iguales */}
        <LogoConParticulas isMobile={isMobile} />
        {false && (() => {
          const box       = isMobile ? 220 : 340;
          const scale     = isMobile ? 2.05 : 2.7;
          const ringInset = isMobile ? 50  : 75;
          return (
            <div style={{
              position: 'relative',
              width: box + 'px',
              height: box + 'px',
              margin: '0 auto 40px',
              overflow: 'visible',
              flexShrink: 0,
            }}>
              <svg
                viewBox="0 0 200 200"
                style={{
                  position: 'absolute',
                  top: -ringInset,
                  left: -ringInset,
                  width: box + ringInset * 2,
                  height: box + ringInset * 2,
                  pointerEvents: 'none',
                  overflow: 'visible',
                  zIndex: 0,
                }}
              >
                <defs>
                  <linearGradient id="landShineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%"   stopColor="#fff8d1" stopOpacity="0"/>
                    <stop offset="40%"  stopColor="#fff8d1" stopOpacity="1"/>
                    <stop offset="60%"  stopColor="#ffffff" stopOpacity="1"/>
                    <stop offset="100%" stopColor="#fff8d1" stopOpacity="0"/>
                  </linearGradient>
                </defs>

                {/* Círculo dorado base */}
                <circle cx="100" cy="100" r="92"
                  fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round"
                  style={{ filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--gold) 55%, transparent)) drop-shadow(0 0 14px color-mix(in srgb, var(--gold) 30%, transparent))' }}
                />

                {/* Destello brillante */}
                <circle cx="100" cy="100" r="92"
                  fill="none" stroke="#fffbe0" strokeWidth="3.2" strokeLinecap="round" pathLength={100}
                  style={{
                    strokeDasharray: '18 82',
                    strokeDashoffset: 0,
                    animation: 'landShine 3.2s linear 5 forwards',
                    filter: 'drop-shadow(0 0 6px #fff8c5) drop-shadow(0 0 12px rgba(255,243,170,0.85)) drop-shadow(0 0 22px color-mix(in srgb, var(--gold) 60%, transparent))',
                    opacity: 0.95,
                  }}
                />

                {/* Segundo destello desfasado */}
                <circle cx="100" cy="100" r="92"
                  fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" pathLength={100}
                  style={{
                    strokeDasharray: '6 94',
                    strokeDashoffset: -45,
                    animation: 'landShine 3.2s linear 5 forwards',
                    filter: 'drop-shadow(0 0 4px #fff)',
                    opacity: 0.7,
                  }}
                />
              </svg>

              <img
                src="/logo.png"
                alt="StudyAL"
                style={{
                  position: 'absolute',
                  left: '55%',
                  top: '48%',
                  width: '100%',
                  height: '100%',
                  maxWidth: 'none',
                  maxHeight: 'none',
                  objectFit: 'contain',
                  objectPosition: 'center',
                  display: 'block',
                  transform: 'translate(-50%, -50%) scale(' + scale + ')',
                  transformOrigin: 'center',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  zIndex: 1,
                }}
              />

              <style>{`
                @keyframes landShine {
                  from { stroke-dashoffset: 0; }
                  to   { stroke-dashoffset: -100; }
                }
              `}</style>
            </div>
          );
        })()}

        <p style={{
          fontFamily: HAND,
          fontSize: isMobile ? 22 : 30, fontWeight: 700,
          color: 'var(--text-primary)',
          margin: '60px auto 8px',
          fontStyle: 'italic',
          maxWidth: 700,
        }}>
          tu plataforma de estudio definitiva
        </p>
        <p style={{
          fontFamily: HAND,
          fontSize: isMobile ? 17 : 21, fontStyle: 'italic',
          color: 'var(--text-muted)',
          margin: '0 auto 36px',
          maxWidth: 600,
        }}>
          ~ apuntes, flashcards, quizzes, AI, comunidad y más ~
          <br/>
          ~ todo en un solo lugar 🎯 ~
        </p>

        <div style={{
          display: 'flex', gap: 14,
          justifyContent: 'center', flexWrap: 'wrap',
          marginBottom: 24,
        }}>
          <button onClick={() => ((window as any).__showNavLoader?.('/auth?modo=registro'), router.push('/auth?modo=registro'))}
            style={{
              padding: '14px 32px',
              borderRadius: 14,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--gold)', color: '#000',
              fontFamily: HAND, fontSize: 24, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '4px 5px 0 var(--text-primary)',
              transform: 'rotate(-1deg)',
              transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-3px)';e.currentTarget.style.boxShadow='5px 7px 0 var(--text-primary)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';e.currentTarget.style.boxShadow='4px 5px 0 var(--text-primary)';}}
          >
            🚀 Empezar gratis
          </button>
          <button onClick={() => ((window as any).__showNavLoader?.('/auth'), router.push('/auth'))}
            style={{
              padding: '14px 28px',
              borderRadius: 14,
              border: '2.5px dashed var(--text-primary)',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 22, fontWeight: 800,
              cursor: 'pointer',
              transform: 'rotate(1.5deg)',
              transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{
              e.currentTarget.style.borderStyle='solid';
              e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';
              e.currentTarget.style.background='var(--bg-card)';
            }}
            onMouseLeave={(e:any)=>{
              e.currentTarget.style.borderStyle='dashed';
              e.currentTarget.style.transform='rotate(1.5deg)';
              e.currentTarget.style.background='transparent';
            }}
          >
            🔑 Iniciar sesión
          </button>
        </div>

        <p style={{
          fontFamily: HAND, fontSize: 16, fontStyle: 'italic',
          color: 'var(--text-faint)', margin: 0,
        }}>
          ~ ✦ 100% gratis · sin tarjeta · sin trucos ✦ ~
        </p>
      </section>

      {/* FEATURES grid */}
      <section style={{
        maxWidth: 1200, margin: '0 auto',
        padding: isMobile ? '20px 16px 40px' : '20px 36px 60px',
      }}>
        <h2 style={{
          fontFamily: HAND,
          fontSize: isMobile ? 36 : 48, fontWeight: 900,
          color: 'var(--text-primary)',
          margin: '0 0 8px', textAlign: 'center',
          transform: 'rotate(-1deg)', display: 'inline-block',
          width: '100%',
        }}>
          ✨ todo lo que tendrás
        </h2>
        <svg width="280" height="6" style={{ display: 'block', margin: '4px auto 36px' }}>
          <path d="M2 3 Q 140 0 278 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
        </svg>

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 18,
        }}>
          {features.map((f, i) => (
            <div key={i} style={{
              background: 'var(--bg-card)',
              border: '2.5px solid var(--text-primary)',
              borderRadius: 14,
              padding: '20px 16px',
              textAlign: 'center',
              boxShadow: `4px 5px 0 ${f.color}`,
              transform: `rotate(${f.rot}deg)`,
              transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
              cursor: 'default',
            }}
              onMouseEnter={(e:any)=>{
                e.currentTarget.style.transform = 'rotate(0deg) translateY(-4px)';
                e.currentTarget.style.boxShadow = `5px 7px 0 ${f.color}`;
              }}
              onMouseLeave={(e:any)=>{
                e.currentTarget.style.transform = `rotate(${f.rot}deg)`;
                e.currentTarget.style.boxShadow = `4px 5px 0 ${f.color}`;
              }}
            >
              <div style={{
                fontSize: 44, marginBottom: 8,
                filter: `drop-shadow(0 2px 4px ${f.color}55)`,
              }}>
                {f.emoji}
              </div>
              <h3 style={{
                fontFamily: HAND, fontSize: 22, fontWeight: 900,
                color: f.color, margin: '0 0 6px', lineHeight: 1,
                transform: 'rotate(-0.5deg)', display: 'inline-block',
              }}>
                {f.title}
              </h3>
              <p style={{
                fontFamily: HAND, fontSize: 15, fontStyle: 'italic',
                color: 'var(--text-muted)',
                margin: 0, lineHeight: 1.3,
              }}>
                ~ {f.desc} ~
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* TESTIMONIOS */}
      <section style={{
        maxWidth: 1100, margin: '0 auto',
        padding: isMobile ? '20px 16px 40px' : '20px 36px 60px',
      }}>
        <h2 style={{
          fontFamily: HAND,
          fontSize: isMobile ? 32 : 42, fontWeight: 900,
          color: 'var(--text-primary)',
          margin: '0 0 36px', textAlign: 'center',
          transform: 'rotate(-1deg)', display: 'inline-block',
          width: '100%',
        }}>
          💬 lo que dicen los estudiantes
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: 22,
        }}>
          {testimonios.map((t, i) => (
            <div key={i} style={{
              background: 'var(--bg-card)',
              border: '2.5px solid var(--text-primary)',
              borderRadius: 14,
              padding: 20,
              boxShadow: '4px 5px 0 var(--gold)',
              transform: `rotate(${t.rot}deg)`,
              position: 'relative',
            }}>
              {/* Cinta scotch */}
              <div style={{
                position: 'absolute', top: -10, left: '50%',
                transform: 'translateX(-50%) rotate(-3deg)',
                width: 70, height: 16,
                background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
                border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
              }}/>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 50, height: 50, borderRadius: '50%',
                  background: 'var(--gold)',
                  border: '2.5px solid var(--text-primary)',
                  boxShadow: '2px 2px 0 var(--text-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26,
                  transform: 'rotate(-4deg)',
                  flexShrink: 0,
                }}>
                  {t.emoji}
                </div>
                <div>
                  <p style={{
                    fontFamily: HAND, fontSize: 19, fontWeight: 900,
                    color: 'var(--text-primary)', margin: 0, lineHeight: 1.05,
                  }}>{t.name}</p>
                  <p style={{
                    fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
                    color: 'var(--text-faint)', margin: '2px 0 0',
                  }}>{t.carrera}</p>
                </div>
              </div>

              <p style={{
                fontFamily: HAND, fontSize: 18, fontStyle: 'italic',
                color: 'var(--text-primary)',
                margin: 0, lineHeight: 1.4,
              }}>
                {t.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* STATS */}
      <section style={{
        maxWidth: 900, margin: '0 auto',
        padding: isMobile ? '20px 16px' : '20px 36px',
      }}>
        <div style={{
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 16,
          padding: isMobile ? '24px 16px' : '32px',
          boxShadow: '5px 6px 0 var(--gold)',
          transform: 'rotate(-0.4deg)',
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: isMobile ? 14 : 20,
        }}>
          {[
            { value: '100%', label: 'gratis',         color: '#34d399', rot: -2 },
            { value: '12+',  label: 'herramientas',   color: 'var(--gold)', rot: 1.5 },
            { value: 'AI',   label: 'integrada',      color: '#a78bfa', rot: -1.5 },
            { value: '24/7', label: 'disponible',     color: 'var(--blue)', rot: 2 },
          ].map((s, i) => (
            <div key={i} style={{
              textAlign: 'center',
              transform: `rotate(${s.rot}deg)`,
              padding: 10,
            }}>
              <div style={{
                fontFamily: HAND, fontSize: 44, fontWeight: 900,
                color: s.color, lineHeight: 1,
                textShadow: `0 0 12px ${s.color}33`,
              }}>
                {s.value}
              </div>
              <div style={{
                fontFamily: HAND, fontSize: 17, fontStyle: 'italic',
                color: 'var(--text-muted)', marginTop: 4,
              }}>
                ~ {s.label} ~
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <section style={{
        maxWidth: 700, margin: '0 auto',
        padding: isMobile ? '40px 16px' : '60px 36px',
        textAlign: 'center',
      }}>
        <div style={{
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 16,
          padding: isMobile ? '32px 20px' : '48px 32px',
          boxShadow: '5px 6px 0 var(--pink)',
          transform: 'rotate(0.4deg)',
          position: 'relative',
        }}>
          {/* Cinta scotch */}
          <div style={{
            position: 'absolute', top: -12, left: '50%',
            transform: 'translateX(-50%) rotate(-4deg)',
            width: 90, height: 20,
            background: 'rgba(244,114,182,0.55)',
            border: '1px solid rgba(244,114,182,0.3)',
            boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          }}/>

          <div style={{ fontSize: 60, marginBottom: 12 }}>🎯</div>
          <h2 style={{
            fontFamily: HAND,
            fontSize: isMobile ? 32 : 42, fontWeight: 900,
            color: 'var(--text-primary)',
            margin: '0 0 8px', lineHeight: 1.1,
            transform: 'rotate(-1deg)', display: 'inline-block',
          }}>
            ¿Listo para tirar estudio?
          </h2>
          <p style={{
            fontFamily: HAND, fontSize: 20, fontStyle: 'italic',
            color: 'var(--text-muted)', margin: '8px 0 28px',
          }}>
            ~ únete a miles de estudiantes que ya están usando StudyAL ~
          </p>
          <button onClick={() => ((window as any).__showNavLoader?.('/auth?modo=registro'), router.push('/auth?modo=registro'))}
            style={{
              padding: '16px 40px',
              borderRadius: 14,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--gold)', color: '#000',
              fontFamily: HAND, fontSize: 26, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '4px 5px 0 var(--text-primary)',
              transform: 'rotate(-1.5deg)',
              transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-3px)';e.currentTarget.style.boxShadow='5px 7px 0 var(--text-primary)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1.5deg)';e.currentTarget.style.boxShadow='4px 5px 0 var(--text-primary)';}}
          >
            ✨ Crear cuenta gratis
          </button>
          <p style={{
            fontFamily: HAND, fontSize: 15, fontStyle: 'italic',
            color: 'var(--text-faint)', margin: '14px 0 0',
          }}>
            ~ toma menos de 1 minuto ⏱️ ~
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
function LogoConParticulas({ isMobile }: { isMobile: boolean }) {
  const box       = isMobile ? 220 : 340;
  const scale     = isMobile ? 2.05 : 2.7;
  const ringInset = isMobile ? 50  : 75;

  const [particles, setParticles] = useState<{ id: number; dx: number; dy: number; size: number; emoji: string; rot: number; delay: number }[]>([]);
  const [exploding, setExploding] = useState(false);
  const [finished, setFinished] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const totalDuration = 3.2 * 5 * 1000;
    const t = setTimeout(() => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const headerLogo = document.getElementById('header-logo-target');
      let targetX = 60, targetY = 30;
      if (headerLogo) {
        const tRect = headerLogo.getBoundingClientRect();
        targetX = tRect.left + tRect.width / 2;
        targetY = tRect.top + tRect.height / 2;
      }

      const emojis = ['✨', '⭐', '🌟', '💫', '✦', '✧', '⚡'];
      const newParticles = Array.from({ length: 22 }, (_, i) => ({
        id: i,
        dx: targetX - centerX + (Math.random() - 0.5) * 50,
        dy: targetY - centerY + (Math.random() - 0.5) * 50,
        size: 16 + Math.random() * 20,
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
        rot: Math.random() * 720 - 360,
        delay: Math.random() * 200,
      }));
      setExploding(true);
      setParticles(newParticles);
      setFinished(true);
      setTimeout(() => { setParticles([]); setExploding(false); }, 2200);
    }, totalDuration);
    return () => clearTimeout(t);
  }, []);

  return (
    <div ref={containerRef} style={{
      position: 'relative',
      width: box + 'px',
      height: box + 'px',
      margin: '0 auto 40px',
      overflow: 'visible',
      flexShrink: 0,
    }}>
      {/* Partículas */}
      {particles.map(p => {
        const rect = containerRef.current?.getBoundingClientRect();
        const cx = (rect?.left || 0) + box/2;
        const cy = (rect?.top || 0) + box/2;
        return (
          <span key={p.id} style={{
            position: 'fixed',
            left: cx + 'px',
            top: cy + 'px',
            fontSize: p.size,
            pointerEvents: 'none',
            zIndex: 9999,
            animation: 'particleFly 2s cubic-bezier(.4,1.2,.5,1) forwards',
            animationDelay: p.delay + 'ms',
            ['--dx' as any]: p.dx + 'px',
            ['--dy' as any]: p.dy + 'px',
            ['--rot' as any]: p.rot + 'deg',
            filter: 'drop-shadow(0 0 6px #fff8c5) drop-shadow(0 0 14px var(--gold))',
            opacity: 0,
          }}>
            {p.emoji}
          </span>
        );
      })}

      {/* Pulso */}
      {exploding && (
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 80, height: 80,
          marginLeft: -40, marginTop: -40,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--gold) 0%, transparent 70%)',
          animation: 'centerPulse 1s ease-out forwards',
          pointerEvents: 'none',
          zIndex: 5,
        }}/>
      )}

      <style>{`
        @keyframes particleFly {
          0% { transform: translate(-50%, -50%) scale(0.4) rotate(0deg); opacity: 0; }
          15% { transform: translate(-50%, -50%) scale(1.4) rotate(calc(var(--rot) * 0.2)); opacity: 1; }
          100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.3) rotate(var(--rot)); opacity: 0; }
        }
        @keyframes centerPulse {
          0% { transform: scale(0.2); opacity: 0; }
          30% { transform: scale(2.5); opacity: 0.85; }
          100% { transform: scale(5); opacity: 0; }
        }
        @keyframes landShine {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: -100; }
        }
      `}</style>

      <svg
        viewBox="0 0 200 200"
        style={{
          position: 'absolute',
          top: -ringInset,
          left: -ringInset,
          width: box + ringInset * 2,
          height: box + ringInset * 2,
          pointerEvents: 'none',
          overflow: 'visible',
          zIndex: 0,
        }}
      >
        <defs>
          <linearGradient id="landShineGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#fff8d1" stopOpacity="0"/>
            <stop offset="40%"  stopColor="#fff8d1" stopOpacity="1"/>
            <stop offset="60%"  stopColor="#ffffff" stopOpacity="1"/>
            <stop offset="100%" stopColor="#fff8d1" stopOpacity="0"/>
          </linearGradient>
        </defs>

        {/* Círculo dorado base */}
        <circle cx="100" cy="100" r="92"
          fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--gold) 55%, transparent)) drop-shadow(0 0 14px color-mix(in srgb, var(--gold) 30%, transparent))' }}
        />

        {/* Destello brillante */}
        <circle cx="100" cy="100" r="92"
          fill="none" stroke="#fffbe0" strokeWidth="3.2" strokeLinecap="round" pathLength={100}
          style={{
            strokeDasharray: '18 82',
            strokeDashoffset: 0,
            animation: 'landShine 3.2s linear 5 forwards',
            filter: 'drop-shadow(0 0 6px #fff8c5) drop-shadow(0 0 12px rgba(255,243,170,0.85)) drop-shadow(0 0 22px color-mix(in srgb, var(--gold) 60%, transparent))',
            opacity: finished ? 0 : 0.95,
            transition: 'opacity 1.2s ease-out',
          }}
        />

        {/* Segundo destello */}
        <circle cx="100" cy="100" r="92"
          fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" pathLength={100}
          style={{
            strokeDasharray: '6 94',
            strokeDashoffset: -45,
            animation: 'landShine 3.2s linear 5 forwards',
            filter: 'drop-shadow(0 0 4px #fff)',
            opacity: finished ? 0 : 0.7,
            transition: 'opacity 1.2s ease-out',
          }}
        />
      </svg>

      <img
        src="/logo.png"
        alt="StudyAL"
        style={{
          position: 'absolute',
          left: '55%',
          top: '48%',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: 'center',
          transform: 'translate(-50%, -50%) scale(' + scale + ')',
          transformOrigin: 'center',
          pointerEvents: 'none',
          userSelect: 'none',
          zIndex: 1,
        }}
      />
    </div>
  );
}
