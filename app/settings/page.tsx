'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useDarkMode } from '../../hooks/useDarkMode';
import NavbarMobile from '../../components/NavbarMobile';
import { getSettings, saveSettings, applyTheme, limpiarDatosEstudio, AppSettings, DEFAULT_SETTINGS } from '../../lib/settings';

type Seccion = 'perfil' | 'seguridad' | 'personalizacion' | 'notificaciones' | 'datos' | 'cuenta';

const TEMAS: { id: AppSettings['tema']; label: string; desc: string; colors: string[] }[] = [
  {
    id: 'default',
    label: '⭐ Default',
    desc: 'Dorado, rojo, celeste y rosado',
    colors: ['#f5c842', '#ff4d6d', '#38bdf8', '#f472b6'],
  },
  {
    id: 'playero',
    label: '🏖️ Playero',
    desc: 'Arena, turquesa y coral',
    colors: ['#e8c87a', '#ff6b6b', '#48cae4', '#f7c59f'],
  },
  {
    id: 'falcons',
    label: '🏈 Falcons',
    desc: 'Rojo Atlanta, negro y plata',
    colors: ['#a71930', '#c8c9c7', '#000000', '#a71930'],
  },
  {
    id: 'raiders',
    label: '🏴‍☠️ El Broder 😐',
    desc: 'Plata, negro y blanco — Las Vegas Raiders',
    colors: ['#a5acaf', '#000000', '#ffffff', '#a5acaf'],
  },
  {
    id: 'math',
    label: '🔢 Peter Saupeter 😏',
    desc: 'Verde neón, azul eléctrico, morado y pink',
    colors: ['#00f5d4', '#4361ee', '#7b2d8b', '#f72585'],
  },
];

export default function SettingsPage() {
  const [seccion, setSeccion] = useState<Seccion>('perfil');
  const [usuario, setUsuario] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const { darkMode: isDark, toggle: toggleDark } = useDarkMode();
  const isMobile = useIsMobile();
  const fotoRef = useRef<HTMLInputElement>(null);
  const nombreAppRef = useRef<HTMLInputElement>(null);

  // Perfil
  const [nombre, setNombre] = useState('');
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);
  const [mensajePerfil, setMensajePerfil] = useState('');

  // Contraseña
  const [passwordNueva, setPasswordNueva] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [guardandoPassword, setGuardandoPassword] = useState(false);
  const [mensajePassword, setMensajePassword] = useState('');
  const [errorPassword, setErrorPassword] = useState('');
  const [mensajeNombreApp, setMensajeNombreApp] = useState('');

  // Reset email
  const [enviandoReset, setEnviandoReset] = useState(false);
  const [mensajeReset, setMensajeReset] = useState('');

  useEffect(() => {
    const cargar = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { window.location.href = '/auth'; return; }
      setUsuario(data.user);
      setNombre(data.user.user_metadata?.nombre || '');
      const s = getSettings();
      setSettings(s);
      applyTheme(s.tema);
      setCargando(false);
    };
    cargar();
  }, []);

  // Cuando carga la seccion personalizacion, setea el input del nombre
  useEffect(() => {
    if (seccion === 'personalizacion' && nombreAppRef.current) {
      nombreAppRef.current.value = settings.nombreApp || 'JoseAnotaciones';
    }
  }, [seccion, settings.nombreApp]);

  const updateSettings = (changes: Partial<AppSettings>) => {
    const nuevas = { ...settings, ...changes };
    setSettings(nuevas);
    saveSettings(nuevas);
    if (changes.tema) applyTheme(changes.tema);
  };

  const guardarNombreApp = () => {
    const valor = nombreAppRef.current?.value?.trim() || 'JoseAnotaciones';
    const nuevas = { ...settings, nombreApp: valor };
    setSettings(nuevas);
    saveSettings(nuevas);
    setMensajeNombreApp('✅ Nombre guardado: ' + valor);
    setTimeout(() => setMensajeNombreApp(''), 3000);
  };

  const restablecerNombreApp = () => {
    if (nombreAppRef.current) nombreAppRef.current.value = 'JoseAnotaciones';
    const nuevas = { ...settings, nombreApp: 'JoseAnotaciones' };
    setSettings(nuevas);
    saveSettings(nuevas);
    setMensajeNombreApp('✅ Nombre restablecido');
    setTimeout(() => setMensajeNombreApp(''), 3000);
  };

  const guardarPerfil = async () => {
    setGuardandoPerfil(true);
    setMensajePerfil('');
    try {
      const { error } = await supabase.auth.updateUser({ data: { nombre } });
      if (error) throw error;
      setMensajePerfil('✅ Perfil actualizado correctamente');
    } catch (err: any) {
      setMensajePerfil('❌ Error: ' + err.message);
    } finally {
      setGuardandoPerfil(false);
    }
  };

  const handleFotoPerfil = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('La imagen debe ser menor a 2MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      updateSettings({ fotoPerfil: result });
    };
    reader.readAsDataURL(file);
  };

  const cambiarPassword = async () => {
    setErrorPassword(''); setMensajePassword('');
    if (!passwordNueva || !passwordConfirm) { setErrorPassword('Completa todos los campos'); return; }
    if (passwordNueva.length < 6) { setErrorPassword('Mínimo 6 caracteres'); return; }
    if (passwordNueva !== passwordConfirm) { setErrorPassword('Las contraseñas no coinciden'); return; }
    setGuardandoPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwordNueva });
      if (error) throw error;
      setMensajePassword('✅ Contraseña cambiada correctamente');
      setPasswordNueva(''); setPasswordConfirm('');
    } catch (err: any) {
      setErrorPassword('❌ Error: ' + err.message);
    } finally {
      setGuardandoPassword(false);
    }
  };

  const enviarReset = async () => {
    if (!usuario?.email) return;
    setEnviandoReset(true); setMensajeReset('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(usuario.email, {
        redirectTo: `${window.location.origin}/settings`,
      });
      if (error) throw error;
      setMensajeReset('✅ Email enviado. Revisa tu bandeja de entrada.');
    } catch (err: any) {
      setMensajeReset('❌ Error: ' + err.message);
    } finally {
      setEnviandoReset(false);
    }
  };

  const solicitarNotificaciones = async () => {
    if (!('Notification' in window)) { alert('Tu navegador no soporta notificaciones'); return; }
    const permiso = await Notification.requestPermission();
    if (permiso === 'granted') {
      new Notification('JoseAnotaciones', { body: '✅ Notificaciones activadas.' });
      updateSettings({ notifAsignaciones: true, notifRacha: true, notifLogros: true });
    } else {
      alert('Permiso denegado. Activa las notificaciones en tu navegador.');
    }
  };

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth';
  };

  if (cargando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Cargando...</p>
      </div>
    );
  }

  const nombre_usuario = usuario?.user_metadata?.nombre || usuario?.email?.split('@')[0] || 'Usuario';
  const inicial = nombre_usuario.charAt(0).toUpperCase();

  const secciones = [
    { id: 'perfil', label: '👤 Perfil', desc: 'Nombre e imagen' },
    { id: 'seguridad', label: '🔒 Seguridad', desc: 'Contraseña y acceso' },
    { id: 'personalizacion', label: '🎨 Personalización', desc: 'Tema, colores y nombre' },
    { id: 'notificaciones', label: '🔔 Notificaciones', desc: 'Alertas y recordatorios' },
    { id: 'datos', label: '🗑️ Datos', desc: 'Limpiar y gestionar' },
    { id: 'cuenta', label: '⚙️ Cuenta', desc: 'Información y sesión' },
  ] as const;

  const Alert = ({ msg }: { msg: string }) => {
    if (!msg) return null;
    const isOk = msg.includes('✅');
    return (
      <div style={{ padding: '12px 16px', borderRadius: '10px', background: isOk ? '#4ade8015' : 'var(--red-dim)', border: `1px solid ${isOk ? '#4ade8044' : 'var(--red-border)'}` }}>
        <p style={{ fontSize: '14px', color: isOk ? '#4ade80' : 'var(--red)', margin: 0, fontWeight: 600 }}>{msg}</p>
      </div>
    );
  };

  const Toggle = ({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: () => void }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)', gap: '12px' }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px' }}>{label}</p>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{desc}</p>
      </div>
      <button onClick={onChange}
        style={{ width: '52px', height: '28px', borderRadius: '14px', border: 'none', background: value ? 'var(--gold)' : 'var(--border-color2)', cursor: 'pointer', position: 'relative', transition: 'background 0.3s', flexShrink: 0 }}>
        <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', left: value ? '27px' : '3px', transition: 'left 0.3s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
      </button>
    </div>
  );

  const Card = ({ color, children }: { color: string; children: React.ReactNode }) => (
    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
      <div style={{ height: '4px', background: color }} />
      <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {children}
      </div>
    </div>
  );

  const InputField = ({ label, value, onChange, type = 'text', placeholder, disabled = false, focusColor = 'var(--gold)' }: any) => (
    <div>
      <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: disabled ? 'var(--text-faint)' : 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s', cursor: disabled ? 'not-allowed' : 'text' }}
        onFocus={e => { if (!disabled) e.currentTarget.style.borderColor = focusColor; }}
        onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
      />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {isMobile ? <NavbarMobile /> : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', height: '68px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => window.location.href = '/'}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ← Inicio
              </button>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>⚙️ Configuración</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>Ajustes de tu cuenta y app</p>
              </div>
            </div>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            <div style={{ flex: 1, background: 'var(--gold)' }} />
            <div style={{ flex: 1, background: 'var(--red)' }} />
            <div style={{ flex: 1, background: 'var(--blue)' }} />
            <div style={{ flex: 1, background: 'var(--pink)' }} />
          </div>
        </>
      )}

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: isMobile ? '16px' : '40px', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '240px 1fr', gap: '24px', alignItems: 'flex-start' }}>

        {/* SIDEBAR */}
        <div>
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', padding: '20px', textAlign: 'center', marginBottom: '12px' }}>
            <div onClick={() => fotoRef.current?.click()}
              style={{ width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto 12px', cursor: 'pointer', overflow: 'hidden', border: '3px solid var(--gold)' }}>
              {settings.fotoPerfil ? (
                <img src={settings.fotoPerfil} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 900, color: '#000' }}>
                  {inicial}
                </div>
              )}
            </div>
            <input ref={fotoRef} type="file" accept="image/*" onChange={handleFotoPerfil} style={{ display: 'none' }} />
            <p style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{nombre_usuario}</p>
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '0 0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{usuario?.email}</p>
            <p style={{ fontSize: '10px', color: 'var(--gold)', margin: 0, cursor: 'pointer' }} onClick={() => fotoRef.current?.click()}>
              📷 Cambiar foto
            </p>
          </div>

          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {secciones.map((s, i) => (
              <button key={s.id} onClick={() => setSeccion(s.id as Seccion)}
                style={{ width: '100%', padding: '12px 16px', border: 'none', borderBottom: i < secciones.length - 1 ? '1px solid var(--border-color)' : 'none', background: seccion === s.id ? 'var(--gold-dim)' : 'transparent', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1px', transition: 'all 0.15s', borderLeft: `3px solid ${seccion === s.id ? 'var(--gold)' : 'transparent'}` }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: seccion === s.id ? 'var(--gold)' : 'var(--text-primary)' }}>{s.label}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* CONTENIDO */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* ===== PERFIL ===== */}
          {seccion === 'perfil' && (
            <Card color="var(--gold)">
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>👤 Perfil</h2>

              <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '20px', background: 'var(--bg-secondary)', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                <div onClick={() => fotoRef.current?.click()}
                  style={{ width: '80px', height: '80px', borderRadius: '50%', cursor: 'pointer', overflow: 'hidden', border: '3px solid var(--gold)', flexShrink: 0 }}>
                  {settings.fotoPerfil ? (
                    <img src={settings.fotoPerfil} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', fontWeight: 900, color: '#000' }}>
                      {inicial}
                    </div>
                  )}
                </div>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>Foto de perfil</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>JPG, PNG · Máx 2MB</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => fotoRef.current?.click()}
                      style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                      📷 Cambiar
                    </button>
                    {settings.fotoPerfil && (
                      <button onClick={() => updateSettings({ fotoPerfil: '' })}
                        style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <InputField label="Nombre" value={nombre} onChange={(e: any) => setNombre(e.target.value)} placeholder="Tu nombre" />
              <InputField label="Email" value={usuario?.email || ''} disabled />
              <Alert msg={mensajePerfil} />
              <button onClick={guardarPerfil} disabled={guardandoPerfil}
                style={{ padding: '13px 24px', borderRadius: '10px', border: 'none', background: guardandoPerfil ? 'var(--bg-card2)' : 'var(--gold)', color: guardandoPerfil ? 'var(--text-faint)' : '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer', alignSelf: 'flex-start' }}>
                {guardandoPerfil ? '⏳ Guardando...' : '💾 Guardar cambios'}
              </button>
            </Card>
          )}

          {/* ===== SEGURIDAD ===== */}
          {seccion === 'seguridad' && (
            <>
              <Card color="var(--blue)">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>🔑 Cambiar contraseña</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Mínimo 6 caracteres</p>
                <InputField label="Nueva contraseña" type="password" value={passwordNueva} onChange={(e: any) => setPasswordNueva(e.target.value)} placeholder="Mínimo 6 caracteres" focusColor="var(--blue)" />
                <div>
                  <InputField label="Confirmar contraseña" type="password" value={passwordConfirm} onChange={(e: any) => setPasswordConfirm(e.target.value)} placeholder="Repite la contraseña" focusColor="var(--blue)" />
                  {passwordConfirm && passwordNueva !== passwordConfirm && (
                    <p style={{ fontSize: '11px', color: 'var(--red)', margin: '4px 0 0' }}>Las contraseñas no coinciden</p>
                  )}
                  {passwordConfirm && passwordNueva === passwordConfirm && passwordNueva.length >= 6 && (
                    <p style={{ fontSize: '11px', color: '#4ade80', margin: '4px 0 0' }}>✓ Coinciden</p>
                  )}
                </div>
                <Alert msg={errorPassword} />
                <Alert msg={mensajePassword} />
                <button onClick={cambiarPassword} disabled={guardandoPassword || !passwordNueva || !passwordConfirm}
                  style={{ padding: '13px 24px', borderRadius: '10px', border: 'none', background: guardandoPassword || !passwordNueva || !passwordConfirm ? 'var(--bg-card2)' : 'var(--blue)', color: guardandoPassword || !passwordNueva || !passwordConfirm ? 'var(--text-faint)' : '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer', alignSelf: 'flex-start' }}>
                  {guardandoPassword ? '⏳...' : '🔑 Cambiar contraseña'}
                </button>
              </Card>

              <Card color="var(--pink)">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>📧 Olvidaste tu contraseña</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                  Enviaremos un link a <strong style={{ color: 'var(--text-primary)' }}>{usuario?.email}</strong>
                </p>
                <Alert msg={mensajeReset} />
                <button onClick={enviarReset} disabled={enviandoReset}
                  style={{ padding: '13px 24px', borderRadius: '10px', border: 'none', background: enviandoReset ? 'var(--bg-card2)' : 'var(--pink)', color: enviandoReset ? 'var(--text-faint)' : '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer', alignSelf: 'flex-start' }}>
                  {enviandoReset ? '⏳ Enviando...' : '📧 Enviar email de reset'}
                </button>
              </Card>
            </>
          )}

          {/* ===== PERSONALIZACIÓN ===== */}
          {seccion === 'personalizacion' && (
            <>
              {/* Nombre app - input NO controlado con ref */}
              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: 'var(--gold)' }} />
                <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                    Nombre de la app
                  </h2>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                    Personaliza cómo se llama tu app en el navbar
                  </p>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Nombre
                    </label>
                    <input
                      ref={nombreAppRef}
                      defaultValue={settings.nombreApp || 'JoseAnotaciones'}
                      placeholder="JoseAnotaciones"
                      type="text"
                      style={{ width: '100%', padding: '14px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '16px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                      onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                      onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                      onKeyDown={e => { if (e.key === 'Enter') guardarNombreApp(); }}
                    />
                    <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: '8px 0 0' }}>
                      Escribe el nombre y presiona Enter o toca "Guardar nombre"
                    </p>
                  </div>

                  <Alert msg={mensajeNombreApp} />

                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <button onClick={guardarNombreApp}
                      style={{ padding: '11px 22px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                      💾 Guardar nombre
                    </button>
                    <button onClick={restablecerNombreApp}
                      style={{ padding: '11px 18px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                      Restablecer
                    </button>
                  </div>
                </div>
              </div>

              {/* Tema colores */}
              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: 'var(--pink)' }} />
                <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>🎨 Tema de colores</h2>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                    Toca un tema para aplicarlo inmediatamente
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {TEMAS.map(tema => {
                      const isActive = settings.tema === tema.id;
                      return (
                        <button
                          key={tema.id}
                          onClick={() => {
                            const nuevas = { ...settings, tema: tema.id };
                            setSettings(nuevas);
                            saveSettings(nuevas);
                            applyTheme(tema.id);
                          }}
                          style={{
                            padding: '16px 18px',
                            borderRadius: '12px',
                            border: `2px solid ${isActive ? tema.colors[0] : 'var(--border-color)'}`,
                            background: isActive ? tema.colors[0] + '25' : 'var(--bg-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '14px',
                            transition: 'all 0.2s',
                            textAlign: 'left',
                            width: '100%',
                          }}>
                          <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                            {tema.colors.map((c, i) => (
                              <div key={i} style={{ width: '22px', height: '22px', borderRadius: '50%', background: c, border: '2px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />
                            ))}
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: '14px', fontWeight: 800, color: isActive ? tema.colors[0] : 'var(--text-primary)', margin: '0 0 2px' }}>
                              {tema.label}
                            </p>
                            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>{tema.desc}</p>
                          </div>
                          {isActive && <span style={{ fontSize: '20px', flexShrink: 0 }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Modo oscuro */}
              <Card color="#a78bfa">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>🌙 Modo de pantalla</h2>
                <Toggle
                  label={isDark ? '🌙 Modo oscuro activo' : '☀️ Modo claro activo'}
                  desc="Cambia entre fondo negro y fondo blanco"
                  value={isDark}
                  onChange={toggleDark}
                />
                <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                  Por defecto la app usa modo oscuro. Se guarda automáticamente.
                </p>
              </Card>
            </>
          )}

          {/* ===== NOTIFICACIONES ===== */}
          {seccion === 'notificaciones' && (
            <Card color="var(--blue)">
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>🔔 Notificaciones</h2>

              {'Notification' in window && Notification.permission !== 'granted' && (
                <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: '12px', border: '1px solid var(--blue-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--blue)', margin: '0 0 2px' }}>Activar notificaciones</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Necesitas dar permiso al navegador</p>
                  </div>
                  <button onClick={solicitarNotificaciones}
                    style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: 'var(--blue)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer', flexShrink: 0 }}>
                    Activar
                  </button>
                </div>
              )}

              {'Notification' in window && Notification.permission === 'granted' && (
                <div style={{ padding: '10px 14px', background: '#4ade8015', borderRadius: '10px', border: '1px solid #4ade8044' }}>
                  <p style={{ fontSize: '13px', color: '#4ade80', margin: 0, fontWeight: 600 }}>✅ Notificaciones activadas</p>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Toggle label="📅 Asignaciones pendientes" desc="Aviso cuando tienes tareas próximas" value={settings.notifAsignaciones} onChange={() => updateSettings({ notifAsignaciones: !settings.notifAsignaciones })} />
                <Toggle label="🔥 Racha en riesgo" desc="Alerta si puedes perder tu racha hoy" value={settings.notifRacha} onChange={() => updateSettings({ notifRacha: !settings.notifRacha })} />
                <Toggle label="🏆 Nuevos logros" desc="Cuando desbloqueas un logro" value={settings.notifLogros} onChange={() => updateSettings({ notifLogros: !settings.notifLogros })} />
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                Solo funcionan con el navegador abierto
              </p>
            </Card>
          )}

          {/* ===== DATOS ===== */}
          {seccion === 'datos' && (
            <>
              <Card color="var(--blue)">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>📊 Almacenamiento</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { label: '☁️ Materias y apuntes', desc: 'Guardado en Supabase (nube)' },
                    { label: '📊 Estadísticas de estudio', desc: 'Guardado en tu navegador (local)' },
                    { label: '🔥 Racha de estudio', desc: 'Guardado en tu navegador (local)' },
                    { label: '⚙️ Configuración', desc: 'Guardado en tu navegador (local)' },
                    { label: '🎓 Quizzes y decks', desc: 'Guardado en tu navegador (local)' },
                  ].map((item, i) => (
                    <div key={i} style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: '10px' }}>
                      <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px' }}>{item.label}</p>
                      <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: 'var(--gold)' }} />
                <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                  <div>
                    <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>🗑️ Limpiar datos de estudio</h2>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Resetea racha y estadísticas. Tus materias NO se borran.</p>
                  </div>
                  <button onClick={() => { if (!confirm('¿Limpiar racha y estadísticas?')) return; limpiarDatosEstudio(); alert('✅ Datos de estudio limpiados.'); }}
                    style={{ padding: '10px 20px', borderRadius: '10px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
                    Limpiar stats
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: 'var(--blue)' }} />
                <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                  <div>
                    <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>🎓 Limpiar quizzes y decks</h2>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Elimina todos los quizzes y flashcard decks guardados</p>
                  </div>
                  <button onClick={() => {
                    if (!confirm('¿Eliminar todos los quizzes y decks?')) return;
                    localStorage.removeItem('josea_quizzes_guardados');
                    localStorage.removeItem('josea_flashcard_decks');
                    alert('✅ Quizzes y decks eliminados.');
                  }}
                    style={{ padding: '10px 20px', borderRadius: '10px', border: '2px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: '13px', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
                    Limpiar
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ===== CUENTA ===== */}
          {seccion === 'cuenta' && (
            <>
              <Card color="var(--blue)">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>ℹ️ Información de cuenta</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { label: 'Email', value: usuario?.email },
                    { label: 'ID', value: usuario?.id?.substring(0, 12) + '...' },
                    { label: 'Creada', value: usuario?.created_at ? new Date(usuario.created_at).toLocaleDateString('es-ES') : 'N/A' },
                    { label: 'Último acceso', value: usuario?.last_sign_in_at ? new Date(usuario.last_sign_in_at).toLocaleDateString('es-ES') : 'N/A' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: '10px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>{item.label}</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 700 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: 'var(--gold)' }} />
                <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>🚪 Cerrar sesión</h2>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Cierra tu sesión en este dispositivo</p>
                  </div>
                  <button onClick={cerrarSesion}
                    style={{ padding: '10px 20px', borderRadius: '10px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                    Cerrar sesión
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '2px solid var(--red-border)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: 'var(--red)' }} />
                <div style={{ padding: '24px' }}>
                  <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--red)', margin: '0 0 8px' }}>⚠️ Zona peligrosa</h2>
                  <div style={{ padding: '14px 18px', background: 'var(--red-dim)', borderRadius: '12px', border: '1px solid var(--red-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px' }}>Eliminar cuenta</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Elimina tu cuenta permanentemente</p>
                    </div>
                    <button onClick={() => alert('Para eliminar tu cuenta contacta soporte por seguridad.')}
                      style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: 'var(--red)', color: '#fff', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}