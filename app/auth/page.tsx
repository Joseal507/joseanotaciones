'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import OnboardingModal from '../../components/OnboardingModal';

export default function AuthPage() {
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
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
      const res = await fetch(`/api/user-profile?userId=${userId}`);
      const data = await res.json();
      if (!data.data || !data.data.onboarding_completo) {
        // Necesita onboarding
        setNombreUsuario(nombre);
        setShowOnboarding(true);
      } else {
        window.location.href = '/';
      }
    } catch {
      window.location.href = '/';
    }
  };

  const handleLogin = async () => {
    if (!email || !password) { setError('Completa todos los campos'); return; }
    setCargando(true);
    setError('');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login')) {
        setError('Email o contraseña incorrectos');
      } else if (error.message.includes('Email not confirmed')) {
        setError('Confirma tu email primero');
      } else {
        setError(error.message);
      }
    } else if (data.session) {
      // Al hacer login, chequear si ya completó onboarding
      await checkOnboarding(
        data.session.user.id,
        data.session.user.user_metadata?.nombre || '',
      );
    }
    setCargando(false);
  };

  const handleRegistro = async () => {
    if (!email || !password || !nombre) { setError('Completa todos los campos'); return; }
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return; }
    setCargando(true);
    setError('');
    setMensaje('');

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nombre } },
    });

    if (error) {
      if (error.message.includes('rate limit')) {
        setError('Demasiados intentos. Espera unos minutos.');
      } else if (error.message.includes('already registered')) {
        setError('Este email ya está registrado.');
        setModo('login');
      } else {
        setError(error.message);
      }
    } else if (data.session) {
      // Registro exitoso con sesión → mostrar onboarding
      setNombreUsuario(nombre);
      setShowOnboarding(true);
    } else {
      setMensaje('✅ Revisa tu email para confirmar tu cuenta.');
    }
    setCargando(false);
  };

  // Mostrar onboarding
  if (showOnboarding) {
    return (
      <OnboardingModal
        nombre={nombreUsuario}
        onComplete={() => {
          window.location.href = '/';
        }}
      />
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, sans-serif',
      padding: '20px',
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '80px', height: '80px',
            borderRadius: '20px',
            border: '3px solid var(--gold)',
            overflow: 'hidden',
            margin: '0 auto 16px',
            background: 'var(--bg-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '36px',
          }}>
            <img src="/logo.png" alt="Logo"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e: any) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '📚'; }}
            />
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            <span style={{ fontSize: '85%', fontWeight: 700, color: 'var(--text-primary)' }}>Study</span><span style={{ color: 'var(--gold)' }}>AL</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
            Tu plataforma de estudio definitiva
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '20px',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}>
          <div style={{ height: '4px', background: 'var(--gold)' }} />
          <div style={{ padding: '32px' }}>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '28px', background: 'var(--bg-secondary)', borderRadius: '12px', padding: '4px' }}>
              {[
                { id: 'login', label: '🔑 Iniciar sesión' },
                { id: 'registro', label: '✨ Registrarse' },
              ].map(tab => (
                <button key={tab.id}
                  onClick={() => { setModo(tab.id as any); setError(''); setMensaje(''); }}
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

            {mensaje && (
              <div style={{ background: '#4ade8020', border: '1px solid #4ade8044', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px' }}>
                <p style={{ fontSize: '14px', color: '#4ade80', margin: 0, fontWeight: 600 }}>{mensaje}</p>
              </div>
            )}

            {error && (
              <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red-border)', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px' }}>
                <p style={{ fontSize: '14px', color: 'var(--red)', margin: 0, fontWeight: 600 }}>{error}</p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {modo === 'registro' && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Nombre
                  </label>
                  <input
                    type="text" value={nombre} onChange={e => setNombre(e.target.value)}
                    placeholder="Tu nombre"
                    style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' }}
                    onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                    onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                  />
                </div>
              )}

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                  Email
                </label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  onKeyDown={e => e.key === 'Enter' && (modo === 'login' ? handleLogin() : handleRegistro())}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' }}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                  Contraseña
                </label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={modo === 'registro' ? 'Mínimo 6 caracteres' : '••••••••'}
                  onKeyDown={e => e.key === 'Enter' && (modo === 'login' ? handleLogin() : handleRegistro())}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' }}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                />
              </div>

              <button
                onClick={modo === 'login' ? handleLogin : handleRegistro}
                disabled={cargando}
                style={{
                  width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
                  background: cargando ? 'var(--bg-card2)' : 'var(--gold)',
                  color: cargando ? 'var(--text-faint)' : '#000',
                  fontSize: '16px', fontWeight: 800,
                  cursor: cargando ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s', marginTop: '4px',
                }}>
                {cargando ? '⏳ Cargando...' : modo === 'login' ? '🚀 Iniciar sesión' : '✨ Crear cuenta'}
              </button>
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