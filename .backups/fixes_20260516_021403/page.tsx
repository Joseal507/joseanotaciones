'use client';

import { useEffect, useState } from 'react';
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
        router.replace('/');
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
    { emoji: '🍅', title: 'Pomodoro', desc: 'enfócate con timer integrado', color: '#ef4444', rot: -1.5 },
    { emoji: '📅', title: 'Agenda', desc: 'planifica tareas y objetivos', color: 'var(--blue)', rot: 1.5 },
    { emoji: '🗓️', title: 'Horario', desc: 'tu horario de clases siempre a mano', color: '#fb923c', rot: -1 },
    { emoji: '🌍', title: 'Comunidad', desc: 'comparte apuntes y aprende juntos', color: '#34d399', rot: 1 },
    { emoji: '🏆', title: 'Leaderboard', desc: 'compite con otros estudiantes', color: 'var(--gold)', rot: -1.5 },
    { emoji: '👥', title: 'Partners', desc: 'chatea con tus compañeros', color: 'var(--blue)', rot: 1.5 },
    { emoji: '🎥', title: 'Blinks', desc: 'reels de estudio tipo TikTok', color: '#ff4d6d', rot: -1 },
    { emoji: '✨', title: 'XP & Rangos', desc: 'sube de nivel estudiando', color: 'var(--pink)', rot: 1 },
  ];

  const testimonios = [
    { name: 'María', carrera: 'Medicina · ULAT', emoji: '👧', text: '~ subí mi GPA con las flashcards de la IA ~', rot: -1.5 },
    { name: 'Carlos', carrera: 'Ingeniería · UTP', emoji: '👦', text: '~ el ChapBot me salva en mate todos los días ~', rot: 1.5 },
    { name: 'Sofía', carrera: 'Psicología · USMA', emoji: '👧', text: '~ los blinks me ayudan a repasar antes de dormir ~', rot: -1 },
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
          <img src="/logo.png" alt="Logo" style={{
            width: 40, height: 40, borderRadius: 10,
            objectFit: 'cover',
            border: '2px solid var(--text-primary)',
            boxShadow: '2px 2px 0 var(--gold)',
            transform: 'rotate(-4deg)',
          }}/>
          <h1 style={{
            margin: 0,
            fontFamily: HAND, fontSize: 28, fontWeight: 900,
            color: 'var(--text-primary)', lineHeight: 1,
            transform: 'rotate(-1deg)', display: 'inline-block',
          }}>
            Study<span style={{ color: 'var(--gold)' }}>AL</span>
          </h1>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => router.push('/auth')}
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
          <button onClick={() => router.push('/auth?modo=registro')}
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
        {/* Logo grande */}
        <div style={{
          width: 120, height: 120,
          borderRadius: 24,
          background: 'var(--bg-card)',
          border: '3px solid var(--text-primary)',
          boxShadow: '5px 6px 0 var(--gold)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 24px',
          transform: 'rotate(-3deg)',
          padding: 12,
        }}>
          <img src="/logo.png" alt="StudyAL" style={{
            width: '100%', height: '100%', objectFit: 'contain',
          }}/>
        </div>

        <h1 style={{
          fontFamily: HAND,
          fontSize: isMobile ? 48 : 80, fontWeight: 900,
          color: 'var(--text-primary)',
          margin: '0 0 12px', lineHeight: 1,
          transform: 'rotate(-1.5deg)', display: 'inline-block',
        }}>
          Study<span style={{ color: 'var(--gold)' }}>AL</span>
        </h1>

        <svg width={isMobile ? 280 : 380} height="8" style={{ display: 'block', margin: '4px auto 0' }}>
          <path
            d={isMobile ? "M2 4 Q 140 0 278 5" : "M2 4 Q 190 0 378 5"}
            stroke="var(--gold)" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".75"
          />
        </svg>

        <p style={{
          fontFamily: HAND,
          fontSize: isMobile ? 24 : 32, fontWeight: 700,
          color: 'var(--text-primary)',
          margin: '20px 0 8px',
          fontStyle: 'italic',
          maxWidth: 700, marginLeft: 'auto', marginRight: 'auto',
        }}>
          tu plataforma de estudio definitiva
        </p>
        <p style={{
          fontFamily: HAND,
          fontSize: isMobile ? 18 : 22, fontStyle: 'italic',
          color: 'var(--text-muted)',
          margin: '0 0 36px',
          maxWidth: 600, marginLeft: 'auto', marginRight: 'auto',
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
          <button onClick={() => router.push('/auth?modo=registro')}
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
          <button onClick={() => router.push('/auth')}
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
                background: 'rgba(245,200,66,0.55)',
                border: '1px solid rgba(245,200,66,0.3)',
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
          <button onClick={() => router.push('/auth?modo=registro')}
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
