'use client';

import { useRouter } from 'next/navigation';

import { useState, useEffect } from 'react';
import { useAuthenticatedStudyALUser } from '../hooks/useAuthenticatedStudyALUser';
import { getHorarioDB, Horario } from '../lib/db';
import { useIdioma } from '../hooks/useIdioma';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

const DIAS_MAP: { [key: number]: keyof Horario } = {
  1: 'lunes', 2: 'martes', 3: 'miercoles', 4: 'jueves', 5: 'viernes'
};

const DIAS_LABELS_ES = { lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves', viernes: 'Viernes' };
const DIAS_LABELS_EN = { lunes: 'Monday', martes: 'Tuesday', miercoles: 'Wednesday', jueves: 'Thursday', viernes: 'Friday' };

const formatHora = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  const periodo = h >= 12 ? 'PM' : 'AM';
  const hora12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hora12}:${String(m).padStart(2, '0')} ${periodo}`;
};

const HORARIO_FETCH_TIMEOUT_MS = 15000;

export default function HorarioWidget() {
  const router = useRouter();
  const [horario, setHorario] = useState<Horario | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [retryTick, setRetryTick] = useState(0);
  const [ahora, setAhora] = useState(new Date());
  const { idioma } = useIdioma();
  const { user, status: authStatus } = useAuthenticatedStudyALUser();
  const userId = user?.id ?? null;

  const navHorario = () => {
    try { (window as any).__showNavLoader?.('/horario'); } catch {}
    try {
      router.push('/horario');
      setTimeout(() => {
        try {
          if (window.location.pathname !== '/horario') window.location.href = '/horario';
        } catch {}
      }, 150);
    } catch {
      try { window.location.href = '/horario'; } catch {}
    }
  };

  useEffect(() => {
    const interval = setInterval(() => setAhora(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Dependencia en userId (primitivo estable), no en `user` (objeto nuevo en
  // cada resolución de useSession, aunque sea el mismo usuario) — de lo
  // contrario cada refetch/focus de NextAuth dispara un GET /api/horario
  // nuevo y puede dejar el widget en loops de loading.
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!userId) { setStatus('idle'); return; }

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HORARIO_FETCH_TIMEOUT_MS);

    setStatus('loading');
    getHorarioDB(userId, controller.signal)
      .then(h => {
        if (cancelled) return;
        setHorario(h);
        setStatus('success');
      })
      .catch(err => {
        if (cancelled || (err as any)?.name === 'AbortError') return;
        console.error('[HorarioWidget] fetch failed:', err);
        setStatus('error');
      })
      .finally(() => clearTimeout(timeoutId));

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [authStatus, userId, retryTick]);

  if (status === 'loading' || status === 'idle') return (
    <div style={{
      background: 'var(--bg-card)',
      border: '2.5px solid var(--text-primary)',
      borderRadius: 16,
      padding: '20px 24px',
      textAlign: 'center',
      boxShadow: '3px 3px 0 var(--text-primary)',
    }}>
      <div style={{ fontSize: 36, marginBottom: 8, animation: 'hwPulse 1.4s ease-in-out infinite' }}>📅</div>
      <div style={{ fontFamily: BODY, fontSize: 15, color: 'var(--text-faint)', fontStyle: 'italic' }}>
        ~ {idioma === 'en' ? 'loading schedule' : 'cargando horario'} ~
      </div>
      <style>{`
        @keyframes hwPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.08); }
        }
      `}</style>
    </div>
  );

  if (status === 'error') return (
    <div style={{
      background: 'var(--bg-card)',
      border: '2.5px solid var(--text-primary)',
      borderRadius: 16,
      padding: '20px 24px',
      textAlign: 'center',
      boxShadow: '3px 3px 0 var(--text-primary)',
    }}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontFamily: HAND, fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
        {idioma === 'en' ? "Couldn't load schedule" : 'No se pudo cargar el horario'}
      </div>
      <button
        onClick={() => setRetryTick(t => t + 1)}
        style={{
          fontFamily: HAND, fontSize: 17, fontWeight: 900,
          background: 'var(--gold)', color: '#000',
          border: '2px solid var(--text-primary)',
          borderRadius: 10, padding: '8px 20px',
          cursor: 'pointer', boxShadow: '2px 2px 0 var(--text-primary)',
        }}
      >
        {idioma === 'en' ? '🔄 Retry' : '🔄 Reintentar'}
      </button>
    </div>
  );

  if (!horario) return null;

  if (!Object.values(horario).some(clases => clases.length > 0)) return (
    <div style={{
      background: 'var(--bg-card)',
      border: '2.5px solid var(--text-primary)',
      borderRadius: 16,
      padding: '20px 24px',
      textAlign: 'center',
      boxShadow: '3px 3px 0 var(--text-primary)',
    }}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>📅</div>
      <div style={{ fontFamily: HAND, fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
        {idioma === 'en' ? 'No schedule yet' : 'Sin horario'}
      </div>
      <div style={{ fontFamily: BODY, fontSize: 15, color: 'var(--text-faint)', marginBottom: 14 }}>
        {idioma === 'en' ? 'Set up your weekly schedule' : 'Configura tu horario semanal'}
      </div>
      <button
        onClick={() => { try { (window as any).__showNavLoader?.('/horario'); } catch {} router.push('/horario'); }}
        style={{
          fontFamily: HAND, fontSize: 17, fontWeight: 900,
          background: 'var(--gold)', color: '#000',
          border: '2px solid var(--text-primary)',
          borderRadius: 10, padding: '8px 20px',
          cursor: 'pointer', boxShadow: '2px 2px 0 var(--text-primary)',
        }}
      >
        {idioma === 'en' ? '✏️ Set up schedule' : '✏️ Hacer mi horario'}
      </button>
    </div>
  );

  const diaSemana = ahora.getDay();
  const horaActualStr = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  const diaKey = DIAS_MAP[diaSemana];
  const DIAS_LABELS = idioma === 'en' ? DIAS_LABELS_EN : DIAS_LABELS_ES;

  const esFinDeSemana = diaSemana === 0 || diaSemana === 6;
  const clasesHoy = diaKey ? (horario[diaKey] || []) : [];
  const claseEnCurso = clasesHoy.find(c => c.horaInicio <= horaActualStr && c.horaFin > horaActualStr);
  const proximaClase = clasesHoy
    .filter(c => c.horaInicio > horaActualStr)
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))[0];
  const restoDia = clasesHoy
    .filter(c => c.horaFin > horaActualStr)
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
    .slice(0, 3);

  const minutosHasta = (hora: string) => {
    const [h, m] = hora.split(':').map(Number);
    const ahMin = ahora.getHours() * 60 + ahora.getMinutes();
    const clMin = h * 60 + m;
    return clMin - ahMin;
  };

  const tieneClasesHoy = clasesHoy.length > 0;

  // ─── Empty: Fin de semana ───
  if (!tieneClasesHoy && esFinDeSemana) {
    return (
      <div style={shellStyle('var(--gold)', '-0.5deg')}>
        <BandaTitulo color="var(--gold)" emoji="🏖️" texto={idioma === 'en' ? 'Weekend!' : '¡Fin de semana!'} />
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>🏖️</div>
          <p style={{ fontFamily: HAND, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.1 }}>
            {idioma === 'en' ? 'Free day!' : '¡Día libre!'}
          </p>
          <p style={{ fontFamily: BODY, fontSize: 16, color: 'var(--text-muted)', fontStyle: 'italic', margin: '0 0 14px' }}>
            ~ {idioma === 'en' ? 'No classes today. Enjoy!' : 'No hay clases. ¡Descansa!'} ~
          </p>
          <button
            onClick={navHorario}
            style={{
              fontFamily: HAND, fontSize: 17, fontWeight: 800,
              padding: '8px 18px', borderRadius: 9,
              border: '2px dashed var(--gold)',
              background: 'color-mix(in srgb, var(--gold) 14%, transparent)',
              color: 'var(--text-primary)', cursor: 'pointer',
              transform: 'rotate(-1deg)', transition: 'all .2s',
              boxShadow: '2px 3px 0 var(--gold)',
            }}
            onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)'; e.currentTarget.style.boxShadow = '3px 5px 0 var(--gold)'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'rotate(-1deg)'; e.currentTarget.style.boxShadow = '2px 3px 0 var(--gold)'; }}
          >
            📅 {idioma === 'en' ? 'Set up schedule' : 'Configurar mi horario'}
          </button>
        </div>
      </div>
    );
  }

  // ─── Empty: sin clases programadas ───
  if (!tieneClasesHoy) {
    return (
      <div style={shellStyle('var(--gold)', '-0.5deg')}>
        <BandaTitulo color="var(--gold)" emoji="📅" texto={idioma === 'en' ? "Today's Schedule" : 'Horario de hoy'} />
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🌵</div>
          <p style={{ fontFamily: BODY, fontSize: 16, color: 'var(--text-faint)', fontStyle: 'italic', margin: '0 0 12px' }}>
            ~ {idioma === 'en' ? 'No classes scheduled today' : 'Sin clases programadas hoy'} ~
          </p>
          <button onClick={navHorario}
            style={{
              padding: '8px 18px', borderRadius: 10,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--gold)', color: '#000',
              fontFamily: HAND, fontSize: 17, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 3px 0 var(--text-primary)',
              transform: 'rotate(-2deg)',
            }}
          >
            ✏️ {idioma === 'en' ? 'Set schedule →' : 'Configurar horario →'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyle('var(--gold)', '-0.4deg')}>
      <BandaTitulo color="var(--gold)" emoji="📅" texto={idioma === 'en' ? "Today's Schedule" : 'Horario de hoy'} />

      <div style={{ padding: '14px 18px', position: 'relative' }}>
        {/* margen rojo cuaderno */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: 32, width: 1.5,
          background: '#ef4444', opacity: 0.3,
          pointerEvents: 'none',
        }}/>

        {/* Header con día y hora */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          marginBottom: 12, position: 'relative',
        }}>
          <div>
            <p style={{
              fontFamily: HAND, fontSize: 20, fontWeight: 800,
              color: 'var(--text-primary)', margin: 0, lineHeight: 1,
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              {diaKey ? DIAS_LABELS[diaKey] : ''}
            </p>
            <p style={{
              fontFamily: BODY, fontSize: 14, color: 'var(--text-faint)',
              fontStyle: 'italic', margin: '2px 0 0',
            }}>
              {ahora.toLocaleTimeString(idioma === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <button onClick={navHorario}
            style={{
              fontFamily: HAND, fontSize: 14, fontWeight: 700,
              color: 'var(--gold)',
              background: 'transparent',
              border: '1.5px dashed var(--gold)',
              borderRadius: 8, padding: '4px 10px',
              cursor: 'pointer',
              transform: 'rotate(2deg)',
              transition: 'all 0.25s',
            }}
            onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.05)'}
            onMouseLeave={(e:any)=>e.currentTarget.style.transform='rotate(2deg)'}
          >
            {idioma === 'en' ? 'see all →' : 'ver todo →'}
          </button>
        </div>

        {/* Clase en curso */}
        {claseEnCurso && (
          <div style={{
            background: claseEnCurso.color + '22',
            border: `2.5px solid ${claseEnCurso.color}`,
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 10,
            boxShadow: `3px 3px 0 ${claseEnCurso.color}66`,
            transform: 'rotate(-0.6deg)',
            position: 'relative',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: claseEnCurso.color,
                animation: 'nbPulse 1.5s infinite',
                boxShadow: `0 0 8px ${claseEnCurso.color}`,
              }}/>
              <span style={{
                fontFamily: HAND, fontSize: 13, fontWeight: 800,
                color: claseEnCurso.color, fontStyle: 'italic',
                textTransform: 'lowercase',
              }}>
                {idioma === 'en' ? '🔴 happening now!' : '🔴 ¡ahora mismo!'}
              </span>
            </div>
            <p style={{
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              color: 'var(--text-primary)', margin: '0 0 2px', lineHeight: 1.1,
            }}>
              {claseEnCurso.nombre}
            </p>
            <p style={{
              fontFamily: HAND, fontSize: 14, color: claseEnCurso.color,
              fontWeight: 700, margin: 0,
            }}>
              {formatHora(claseEnCurso.horaInicio)} – {formatHora(claseEnCurso.horaFin)}
              {claseEnCurso.aula && ` · ${idioma === 'en' ? 'Room' : 'Aula'} ${claseEnCurso.aula}`}
            </p>
          </div>
        )}

        {/* Próxima clase */}
        {proximaClase && !claseEnCurso && (
          <div style={{
            background: 'color-mix(in srgb,var(--blue) 16%,transparent)',
            border: '2.5px dashed var(--blue)',
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 10,
            transform: 'rotate(0.5deg)',
          }}>
            <p style={{
              fontFamily: HAND, fontSize: 13, fontWeight: 800,
              color: 'var(--blue)', margin: '0 0 3px',
              fontStyle: 'italic',
            }}>
              ⏰ {idioma === 'en' ? 'next class' : 'próxima clase'} · en {minutosHasta(proximaClase.horaInicio)} min
            </p>
            <p style={{
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              color: 'var(--text-primary)', margin: '0 0 2px', lineHeight: 1.1,
            }}>
              {proximaClase.nombre}
            </p>
            <p style={{
              fontFamily: HAND, fontSize: 14, color: 'var(--blue)',
              fontWeight: 700, margin: 0,
            }}>
              {formatHora(proximaClase.horaInicio)} – {formatHora(proximaClase.horaFin)}
            </p>
          </div>
        )}

        {/* Resto del día */}
        {restoDia.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {restoDia.map((clase, i) => {
              const esActual = clase === claseEnCurso;
              const esProxima = clase === proximaClase;
              if (esActual || esProxima) return null;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 10,
                  border: `1.5px dashed ${clase.color}66`,
                  transform: `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                  transition: 'transform 0.25s',
                }}
                  onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) translateX(3px)'}
                  onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`}
                >
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: clase.color,
                    border: '1.5px solid var(--text-primary)',
                    boxShadow: `0 0 4px ${clase.color}88`,
                    flexShrink: 0,
                  }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontFamily: HAND, fontSize: 17, fontWeight: 700,
                      color: 'var(--text-primary)', margin: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      lineHeight: 1.1,
                    }}>
                      {clase.nombre}
                    </p>
                    <p style={{
                      fontFamily: BODY, fontSize: 13, color: 'var(--text-faint)',
                      fontStyle: 'italic', margin: 0,
                    }}>
                      {formatHora(clase.horaInicio)} – {formatHora(clase.horaFin)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!restoDia.length && !claseEnCurso && !proximaClase && (
          <p style={{
            fontFamily: BODY, fontSize: 17,
            color: 'var(--text-muted)', fontStyle: 'italic',
            textAlign: 'center', margin: '8px 0 0',
          }}>
            ✅ ~ {idioma === 'en' ? 'no more classes today' : 'no hay más clases hoy'} ~
          </p>
        )}
      </div>

      <style>{`
        @keyframes nbPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ──
function shellStyle(color: string, rot: string): React.CSSProperties {
  return {
    background: 'var(--bg-card)',
    border: '2.5px solid var(--text-primary)',
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: '4px 5px 0 var(--text-primary)',
    transform: `rotate(${rot})`,
  };
}

function BandaTitulo({ color, emoji, texto }: { color: string; emoji: string; texto: string }) {
  return (
    <div style={{
      background: color,
      padding: '6px 16px',
      borderBottom: '2px solid var(--text-primary)',
      position: 'relative',
    }}>
      <span style={{
        fontFamily: HAND, fontSize: 16, fontWeight: 800,
        color: '#000', fontStyle: 'italic',
      }}>
        {emoji} {texto}
      </span>
    </div>
  );
}
