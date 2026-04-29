'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import OnboardingModal from '../../components/OnboardingModal';

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

      if (entry?.genero && entry?.tipo_estudiante) { window.location.href = '/'; return; }
      if (entry?.onboarding_completo) { window.location.href = '/'; return; }

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
        window.location.href = '/'; return;
      }

      const localDone = localStorage.getItem(`josea_onboarding_done_${userId}`);
      if (localDone === 'true') { window.location.href = '/'; return; }

      setNombreUsuario(nombre);
      setShowOnboarding(true);
    } catch {
      window.location.href = '/';
    }
  };

  const handleLogin = async () => {
    if (!email || !password) { setError('Completa todos los campos'); return; }
    setCargando(true); setError('');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login')) setError('Email o contraseña incorrectos');
      else if (error.message.includes('Email not confirmed')) setError('Confirma tu email primero');
      else setError(error.message);
    } else if (data.session) {
      await checkOnboarding(data.session.user.id, data.session.user.user_metadata?.nombre || '');
    }
    setCargando(false);
  };

  const handleRegistro = async () => {
    if (!email || !password || !nombre) { setError('Completa todos los campos'); return; }
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return; }
    setCargando(true); setError(''); setMensaje('');
    const { data, error } = await supabase.auth.signUp({
      email, password, options: { data: { nombre } },
    });
    if (error) {
      if (error.message.includes('rate limit')) setError('Demasiados intentos. Espera unos minutos.');
      else if (error.message.includes('already registered')) { setError('Este email ya está registrado.'); setModo('login'); }
      else setError(error.message);
    } else if (data.session) {
      setNombreUsuario(nombre); setShowOnboarding(true);
    } else {
      setMensaje('✅ Revisa tu email para confirmar tu cuenta.');
    }
    setCargando(false);
  };

  const handleReset = async () => {
    if (!email) { setError('Escribe tu email para recuperar la contraseña'); return; }
    setCargando(true); setError(''); setMensaje('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== 'undefined' ? window.location.origin + '/auth' : undefined,
    });
    if (error) {
      if (error.message.includes('rate limit')) setError('Demasiados intentos. Espera unos minutos.');
      else setError(error.message);
    } else {
      setMensaje('✅ Te enviamos un email para restablecer tu contraseña. Revisa tu bandeja de entrada.');
    }
    setCargando(false);
  };

  const handleSubmit = () => {
    if (modo === 'login') handleLogin();
    else if (modo === 'registro') handleRegistro();
    else handleReset();
  };

  if (showOnboarding) {
    return <OnboardingModal nombre={nombreUsuario} onComplete={() => { window.location.href = '/'; }} />;
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: '10px',
    border: '2px solid var(--border-color)', background: 'var(--bg-secondary)',
    color: 'var(--text-primary)', fontSize: '15px', outline: 'none',
    boxSizing: 'border-box', transition: 'border 0.2s', fontFamily: 'inherit',
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, sans-serif', padding: '20px',
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '20px',
            border: '3px solid var(--gold)', overflow: 'hidden',
            margin: '0 auto 16px', background: 'var(--bg-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px',
          }}>
            <img src="/logo.png" alt="Logo"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e: any) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '📚'; }}
            />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            <span style={{ fontSize: '85%', fontWeight: 700, color: 'var(--text-primary)' }}>Study</span>
            <span style={{ color: 'var(--gold)' }}>AL</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
            Tu plataforma de estudio definitiva
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--bg-card)', borderRadius: '20px',
          border: '1px solid var(--border-color)', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}>
          <div style={{ height: '4px', background: 'var(--gold)' }} />
          <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Tabs — solo login y registro */}
            {modo !== 'reset' && (
              <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', borderRadius: '12px', padding: '4px' }}>
                {[
                  { id: 'login' as const, label: '🔑 Iniciar sesión' },
                  { id: 'registro' as const, label: '✨ Registrarse' },
                ].map(tab => (
                  <button key={tab.id}
                    onClick={() => { setModo(tab.id); setError(''); setMensaje(''); }}
                    style={{
                      flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                      background: modo === tab.id ? 'var(--gold)' : 'transparent',
                      color: modo === tab.id ? '#000' : 'var(--text-muted)',
                      fontSize: '14px', fontWeight: modo === tab.id ? 800 : 600,
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}>
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {/* Header modo reset */}
            {modo === 'reset' && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '40px', marginBottom: '10px' }}>🔑</div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>
                  Recuperar contraseña
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                  Te enviaremos un enlace para restablecer tu contraseña
                </p>
              </div>
            )}

            {/* Alertas */}
            {mensaje && (
              <div style={{ background: '#4ade8020', border: '1px solid #4ade8044', borderRadius: '10px', padding: '12px 16px' }}>
                <p style={{ fontSize: '14px', color: '#4ade80', margin: 0, fontWeight: 600 }}>{mensaje}</p>
              </div>
            )}
            {error && (
              <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red-border)', borderRadius: '10px', padding: '12px 16px' }}>
                <p style={{ fontSize: '14px', color: 'var(--red)', margin: 0, fontWeight: 600 }}>{error}</p>
              </div>
            )}

            {/* Campos */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* Nombre — solo registro */}
              {modo === 'registro' && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={nombre}
                    onChange={e => setNombre(e.target.value)}
                    placeholder="Tu nombre"
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    style={inputStyle}
                    onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                    onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                  />
                </div>
              )}

              {/* Email — siempre */}
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                />
              </div>

              {/* Contraseña — solo login y registro */}
              {modo !== 'reset' && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Contraseña
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={modo === 'registro' ? 'Mínimo 6 caracteres' : '••••••••'}
                      autoComplete={modo === 'registro' ? 'new-password' : 'current-password'}
                      onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                      style={{ ...inputStyle, paddingRight: '48px' }}
                      onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                      onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute', right: '12px', top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-muted)', fontSize: '16px', padding: '4px',
                        lineHeight: 1,
                      }}
                      tabIndex={-1}
                    >
                      {showPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
              )}

              {/* Botón principal */}
              <button
                onClick={handleSubmit}
                disabled={cargando}
                style={{
                  width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
                  background: cargando ? 'var(--bg-card2)' : 'var(--gold)',
                  color: cargando ? 'var(--text-faint)' : '#000',
                  fontSize: '16px', fontWeight: 800, cursor: cargando ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s', marginTop: '4px',
                }}>
                {cargando
                  ? '⏳ Cargando...'
                  : modo === 'login'
                  ? '🚀 Iniciar sesión'
                  : modo === 'registro'
                  ? '✨ Crear cuenta'
                  : '📧 Enviar email de recuperación'}
              </button>

              {/* Link: ¿Olvidaste tu contraseña? — solo en login */}
              {modo === 'login' && (
                <button
                  onClick={() => { setModo('reset'); setError(''); setMensaje(''); }}
                  style={{
                    width: '100%', padding: '8px', border: 'none',
                    background: 'transparent', color: 'var(--text-muted)',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    textDecoration: 'underline', textDecorationColor: 'transparent',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--gold)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  🔑 ¿Olvidaste tu contraseña?
                </button>
              )}

              {/* Link: volver al login — solo en reset */}
              {modo === 'reset' && (
                <button
                  onClick={() => { setModo('login'); setError(''); setMensaje(''); }}
                  style={{
                    width: '100%', padding: '8px', border: 'none',
                    background: 'transparent', color: 'var(--text-muted)',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--gold)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  ← Volver a iniciar sesión
                </button>
              )}
            </div>
          </div>
        </div>

        <p style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: '12px', marginTop: '20px' }}>
          Tus datos están seguros y encriptados 🔒
        </p>
      </div>
    </div>
  );
}
