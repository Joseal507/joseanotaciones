'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import OnboardingModal from '../../components/OnboardingModal';
import { useIdioma } from '../../hooks/useIdioma';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

export default function AuthPage() {
  const [modo, setModo] = useState<'login' | 'registro' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [nombreUsuario, setNombreUsuario] = useState('');
  const { tr } = useIdioma();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        checkOnboarding(data.session.user.id, data.session.user.user_metadata?.nombre || '');
      }
    });
  }, []);

  const checkOnboarding = async (userId: string, nombre: string) => {
    try {
      const { data: entry } = await supabase
        .from('leaderboard')
        .select('genero, tipo_estudiante, onboarding_completo')
        .eq('user_id', userId)
        .single();

      if (entry?.genero && entry?.tipo_estudiante) { (window as any).__showNavLoader?.('/'); window.location.href = '/'; return; }
      if (entry?.onboarding_completo) { (window as any).__showNavLoader?.('/'); window.location.href = '/'; return; }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('onboarding_completo, genero, tipo_estudiante')
        .eq('id', userId)
        .single();

      if (profile?.onboarding_completo || (profile?.genero && profile?.tipo_estudiante)) {
        if (profile?.genero && profile?.tipo_estudiante) {
          await supabase.from('leaderboard').upsert({
            user_id: userId, genero: profile.genero,
            tipo_estudiante: profile.tipo_estudiante, onboarding_completo: true,
          }, { onConflict: 'user_id' });
        }
        (window as any).__showNavLoader?.('/'); window.location.href = '/'; return;
      }

      const localDone = localStorage.getItem(`josea_onboarding_done_${userId}`);
      if (localDone === 'true') { (window as any).__showNavLoader?.('/'); window.location.href = '/'; return; }

      setNombreUsuario(nombre);
      setShowOnboarding(true);
    } catch {
      (window as any).__showNavLoader?.('/'); window.location.href = '/';
    }
  };

  const handleLogin = async () => {
    if (!email || !password) { setError(tr('completaCampos')); return; }
    setCargando(true); setError('');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login')) setError(tr('emailOPassIncorrectos'));
      else if (error.message.includes('Email not confirmed')) setError(tr('confirmaTuEmail'));
      else setError(error.message);
    } else if (data.session) {
      await checkOnboarding(data.session.user.id, data.session.user.user_metadata?.nombre || '');
    }
    setCargando(false);
  };

  const handleRegistro = async () => {
    if (!email || !password || !nombre) { setError(tr('completaCampos')); return; }
    if (password.length < 6) { setError(tr('contrasenaMin6')); return; }
    setCargando(true); setError(''); setMensaje('');
    const { data, error } = await supabase.auth.signUp({
      email, password, options: { data: { nombre } },
    });
    if (error) {
      if (error.message.includes('rate limit')) setError(tr('demasiadosIntentos'));
      else if (error.message.includes('already registered')) { setError(tr('emailYaRegistrado')); setModo('login'); }
      else setError(error.message);
    } else if (data.session) {
      setNombreUsuario(nombre); setShowOnboarding(true);
    } else {
      setMensaje(tr('revisaTuEmail'));
    }
    setCargando(false);
  };

  const handleReset = async () => {
    if (!email) { setError(tr('completaCampos')); return; }
    setCargando(true); setError(''); setMensaje('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== 'undefined' ? window.location.origin + '/auth' : undefined,
    });
    if (error) {
      if (error.message.includes('rate limit')) setError(tr('demasiadosIntentos'));
      else setError(error.message);
    } else {
      setMensaje(tr('emailRecuperacion'));
    }
    setCargando(false);
  };

  const handleSubmit = () => {
    if (modo === 'login') handleLogin();
    else if (modo === 'registro') handleRegistro();
    else handleReset();
  };

  if (showOnboarding) {
    return <OnboardingModal nombre={nombreUsuario} onComplete={() => { (window as any).__showNavLoader?.('/'); window.location.href = '/'; }} />;
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px', borderRadius: 8,
    border: '2px dashed var(--border-color)', background: 'var(--bg-secondary)',
    color: 'var(--text-primary)', fontSize: 15, outline: 'none',
    boxSizing: 'border-box', transition: 'border 0.2s',
    fontFamily: HAND, fontWeight: 700,
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, position: 'relative', overflow: 'hidden',
    }}>
      {/* Stickers flotantes */}
      {['📚', '✏️', '🎯', '💡', '⭐', '🔥'].map((e, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: `${15 + i * 14}%`,
          left: i % 2 === 0 ? `${5 + i * 3}%` : 'auto',
          right: i % 2 !== 0 ? `${5 + i * 3}%` : 'auto',
          fontSize: 28, opacity: 0.15,
          transform: `rotate(${-20 + i * 12}deg)`,
          pointerEvents: 'none',
        }}>{e}</div>
      ))}

      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>

        {/* Logo idéntico al home */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 2, marginBottom: 24,
        }}>
          <div style={{
            position: 'relative', width: 100, height: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="100" height="100" viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0 }}>
              <circle cx="50" cy="50" r="46" fill="none"
                stroke="var(--gold)" strokeWidth="2.5" opacity="0.7"
                strokeDasharray="6 4" strokeLinecap="round"
                style={{ filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--gold) 40%, transparent))' }}
              />
              <circle cx="50" cy="50" r="40" fill="none"
                stroke="var(--gold)" strokeWidth="1.5" opacity="0.3"
                strokeDasharray="3 5"
              />
            </svg>
            <img src="/logo.png" alt="StudyAL" style={{
              width: 62, height: 62, objectFit: 'contain',
              filter: 'drop-shadow(0 4px 12px color-mix(in srgb, var(--gold) 50%, transparent))',
            }} />
          </div>
          <h1 style={{
            fontFamily: HAND, fontSize: 34, fontWeight: 900,
            color: 'var(--text-primary)', margin: 0,
            transform: 'rotate(-1.5deg)',
          }}>
            Study<span style={{ color: 'var(--red)' }}>A</span>L
          </h1>
          <p style={{
            fontFamily: HAND, fontSize: 15, fontStyle: 'italic',
            color: 'var(--text-muted)', margin: 0,
            transform: 'rotate(0.5deg)',
          }}>
            ~ {tr('tuPlataformaEstudio')} ~
          </p>
        </div>

        {/* Hoja de cuaderno = formulario */}
        <div style={{
          position: 'relative',
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 8,
          boxShadow: '5px 6px 0 var(--gold), 0 16px 50px rgba(0,0,0,0.25)',
          transform: 'rotate(-0.5deg)',
          overflow: 'hidden',
        }}>
          {/* Cinta adhesiva arriba */}
          <div style={{
            position: 'absolute', top: -10, left: '50%',
            transform: 'translateX(-50%) rotate(-3deg)',
            width: 80, height: 18,
            background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
            border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
            boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
            zIndex: 10,
          }} />

          {/* Margen rojo */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: 32,
            width: 1.5, background: '#ef4444', opacity: 0.3,
          }} />

          {/* Líneas del cuaderno */}
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} style={{
              position: 'absolute', left: 24, right: 24,
              top: 20 + i * 28, height: 1,
              background: 'var(--blue)', opacity: 0.06,
            }} />
          ))}

          <div style={{ padding: '28px 28px 24px', position: 'relative', zIndex: 1 }}>

            {/* Tabs login / registro */}
            {modo !== 'reset' && (
              <div style={{
                display: 'flex', gap: 0, marginBottom: 20,
                border: '2px dashed var(--border-color)', borderRadius: 10,
                overflow: 'hidden',
              }}>
                {[
                  { id: 'login' as const, label: '🔑 ' + tr('iniciaSesionTab') },
                  { id: 'registro' as const, label: '✨ ' + tr('registrarse') },
                ].map(tab => (
                  <button key={tab.id}
                    onClick={() => { setModo(tab.id); setError(''); setMensaje(''); }}
                    style={{
                      flex: 1, padding: '10px 8px', border: 'none',
                      background: modo === tab.id ? 'var(--gold)' : 'transparent',
                      color: modo === tab.id ? '#000' : 'var(--text-muted)',
                      fontFamily: HAND, fontSize: 17, fontWeight: modo === tab.id ? 900 : 700,
                      cursor: 'pointer', transition: 'all 0.2s',
                      transform: modo === tab.id ? 'rotate(-0.5deg)' : 'none',
                    }}>
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {modo === 'reset' && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 36, marginBottom: 6 }}>🔑</div>
                <h2 style={{ fontFamily: HAND, fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                  {tr('recuperarContrasena')}
                </h2>
                <p style={{ fontFamily: BODY, fontSize: 14, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
                  ~ {tr('recuperarDesc')} ~
                </p>
              </div>
            )}

            {/* Mensajes */}
            {mensaje && (
              <div style={{
                background: 'rgba(74,222,128,0.1)', border: '2px dashed #4ade80',
                borderRadius: 8, padding: '10px 14px', marginBottom: 14,
                transform: 'rotate(0.3deg)',
              }}>
                <p style={{ fontFamily: HAND, fontSize: 15, color: '#4ade80', margin: 0, fontWeight: 700 }}>☘️ {mensaje}</p>
              </div>
            )}
            {error && (
              <div style={{
                background: 'rgba(239,68,68,0.08)', border: '2px dashed #ef4444',
                borderRadius: 8, padding: '10px 14px', marginBottom: 14,
                transform: 'rotate(-0.3deg)',
              }}>
                <p style={{ fontFamily: HAND, fontSize: 15, color: '#ef4444', margin: 0, fontWeight: 700 }}>⚠️ {error}</p>
              </div>
            )}

            {/* Campos */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {modo === 'registro' && (
                <div>
                  <label style={{
                    fontFamily: HAND, fontSize: 14, fontWeight: 800,
                    color: 'var(--text-muted)', display: 'block', marginBottom: 4,
                    transform: 'rotate(-0.5deg)',
                  }}>
                    ✏️ {tr('nombre')}
                  </label>
                  <input
                    type="text" value={nombre}
                    onChange={(e: any) => setNombre(e.target.value)}
                    placeholder={tr('tuNombre')}
                    onKeyDown={(e: any) => e.key === 'Enter' && handleSubmit()}
                    style={inputStyle}
                    onFocus={(e: any) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.borderStyle = 'solid'; }}
                    onBlur={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.borderStyle = 'dashed'; }}
                  />
                </div>
              )}

              <div>
                <label style={{
                  fontFamily: HAND, fontSize: 14, fontWeight: 800,
                  color: 'var(--text-muted)', display: 'block', marginBottom: 4,
                  transform: 'rotate(0.3deg)',
                }}>
                  📧 {tr('email')}
                </label>
                <input
                  type="email" value={email}
                  onChange={(e: any) => setEmail(e.target.value)}
                  placeholder={tr('tuEmail')}
                  onKeyDown={(e: any) => e.key === 'Enter' && handleSubmit()}
                  style={inputStyle}
                  onFocus={(e: any) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.borderStyle = 'solid'; }}
                  onBlur={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.borderStyle = 'dashed'; }}
                />
              </div>

              {modo !== 'reset' && (
                <div>
                  <label style={{
                    fontFamily: HAND, fontSize: 14, fontWeight: 800,
                    color: 'var(--text-muted)', display: 'block', marginBottom: 4,
                    transform: 'rotate(-0.3deg)',
                  }}>
                    🔒 {tr('contrasena')}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e: any) => setPassword(e.target.value)}
                      placeholder={modo === 'registro' ? tr('minimo6') : '••••••••'}
                      autoComplete={modo === 'registro' ? 'new-password' : 'current-password'}
                      onKeyDown={(e: any) => e.key === 'Enter' && handleSubmit()}
                      style={{ ...inputStyle, paddingRight: 44 }}
                      onFocus={(e: any) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.borderStyle = 'solid'; }}
                      onBlur={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.borderStyle = 'dashed'; }}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute', right: 10, top: '50%',
                        transform: 'translateY(-50%)', background: 'none',
                        border: 'none', cursor: 'pointer', fontSize: 16,
                        color: 'var(--text-muted)', padding: 4,
                      }} tabIndex={-1}>
                      {showPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
              )}

              {/* Botón principal */}
              <button onClick={handleSubmit} disabled={cargando}
                style={{
                  width: '100%', padding: '13px 16px', borderRadius: 10,
                  border: '2.5px solid var(--text-primary)',
                  background: cargando ? 'var(--bg-secondary)' : 'var(--gold)',
                  color: cargando ? 'var(--text-faint)' : '#000',
                  fontFamily: HAND, fontSize: 20, fontWeight: 900,
                  cursor: cargando ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s', marginTop: 4,
                  boxShadow: cargando ? 'none' : '3px 4px 0 var(--text-primary)',
                  transform: cargando ? 'none' : 'rotate(-0.5deg)',
                }}>
                {cargando
                  ? '⏳ ' + tr('cargando') + '...'
                  : modo === 'login'
                  ? '🚀 ' + tr('iniciandoSesion')
                  : modo === 'registro'
                  ? '✨ ' + tr('creandoCuenta')
                  : '📧 ' + tr('enviandoEmail')}
              </button>

              {/* Links secundarios */}
              {modo === 'login' && (
                <button
                  onClick={() => { setModo('reset'); setError(''); setMensaje(''); }}
                  style={{
                    width: '100%', padding: 8, border: 'none',
                    background: 'transparent', fontFamily: BODY,
                    fontSize: 15, fontWeight: 700, cursor: 'pointer',
                    color: 'var(--text-muted)', fontStyle: 'italic',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={(e: any) => e.currentTarget.style.color = 'var(--gold)'}
                  onMouseLeave={(e: any) => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  🔑 {tr('olvidasteContrasenaLink')}
                </button>
              )}

              {modo === 'reset' && (
                <button
                  onClick={() => { setModo('login'); setError(''); setMensaje(''); }}
                  style={{
                    width: '100%', padding: 8, border: 'none',
                    background: 'transparent', fontFamily: BODY,
                    fontSize: 15, fontWeight: 700, cursor: 'pointer',
                    color: 'var(--text-muted)', fontStyle: 'italic',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={(e: any) => e.currentTarget.style.color = 'var(--gold)'}
                  onMouseLeave={(e: any) => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  ← {tr('volverIniciarSesion')}
                </button>
              )}
            </div>
          </div>

          {/* Sticker esquina */}
          <div style={{
            position: 'absolute', top: 12, right: 12, fontSize: 20,
            transform: 'rotate(12deg)', opacity: 0.6,
          }}>☘️</div>

          <div style={{
            position: 'absolute', bottom: 10, left: 38, fontSize: 16,
            transform: 'rotate(-8deg)', opacity: 0.5,
          }}>⭐</div>
        </div>

        {/* Texto seguridad */}
        <p style={{
          textAlign: 'center', fontFamily: HAND,
          fontSize: 13, fontStyle: 'italic',
          color: 'var(--text-faint)', marginTop: 16,
          transform: 'rotate(0.5deg)',
        }}>
          🔒 ~ {tr('datosSegurosCifrados')} ~
        </p>
      </div>
    </div>
  );
}
