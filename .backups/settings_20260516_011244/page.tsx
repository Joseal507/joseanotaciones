'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
import { getSettings, saveSettings, applyTheme, limpiarDatosEstudio, AppSettings, DEFAULT_SETTINGS } from '../../lib/settings';
import { getSettingsDB, saveSettingsDB } from '../../lib/db';
import BackupManager from '../../components/BackupManager';

type Seccion = 'perfil' | 'seguridad' | 'personalizacion' | 'notificaciones' | 'datos' | 'cuenta';

const TEMAS: { id: AppSettings['tema']; labelEs: string; labelEn: string; descEs: string; descEn: string; colors: string[] }[] = [
  { id: 'default', labelEs: '⭐ Clásico', labelEn: '⭐ Classic', descEs: 'Dorado, rojo, celeste y rosado', descEn: 'Gold, red, sky blue and pink', colors: ['#f5c842', '#ff4d6d', '#38bdf8', '#f472b6'] },
  { id: 'playa', labelEs: '🏖️ Playa', labelEn: '🏖️ Beach', descEs: 'Celeste, arena, rojo y naranja', descEn: 'Sky blue, sand, red and orange', colors: ['#38bdf8', '#ef4444', '#d4a96a', '#fb923c'] },
  { id: 'executive', labelEs: '💼 Ejecutivo', labelEn: '💼 Executive', descEs: 'Gris, verde, azul y blanco', descEn: 'Gray, green, blue and white', colors: ['#a3a3a3', '#4ade80', '#60a5fa', '#e2e8f0'] },
  { id: 'sunset', labelEs: '🌅 Atardecer', labelEn: '🌅 Sunset', descEs: 'Naranja, rojo, dorado y fuego', descEn: 'Orange, red, gold and fire', colors: ['#fb923c', '#ef4444', '#fbbf24', '#f97316'] },
  { id: 'neon', labelEs: '⚡ Eléctrico', labelEn: '⚡ Electric', descEs: 'Verde neón, rosa, azul y morado', descEn: 'Neon green, pink, blue and purple', colors: ['#00f5d4', '#f72585', '#4361ee', '#7b2ff6'] },
];

export default function SettingsPage() {
  const [seccion, setSeccion] = useState<Seccion>('perfil');
  const [visibleLeaderboard, setVisibleLeaderboard] = useState(true);
  const [usuario, setUsuario] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [userId, setUserId] = useState<string | null>(null);
  const { darkMode: isDark, toggle: toggleDark } = useDarkMode();
  const { idioma, setIdioma, tr } = useIdioma();
  const isMobile = useIsMobile();
  const fotoRef = useRef<HTMLInputElement>(null);

  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [genero, setGenero] = useState('');
  const [tipoEstudiante, setTipoEstudiante] = useState('');
  const [universidad, setUniversidad] = useState('');
  const [uniCustom, setUniCustom] = useState('');
  const [carrera, setCarrera] = useState('');
  const [carreraCustom, setCarreraCustom] = useState('');
  const [escuela, setEscuela] = useState('');
  const [escuelaCustom, setEscuelaCustom] = useState('');
  const [guardandoPerfil, setGuardandoPerfil] = useState(false);
  const [mensajePerfil, setMensajePerfil] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [guardandoPassword, setGuardandoPassword] = useState(false);
  const [showPasswordNueva, setShowPasswordNueva] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [mensajePassword, setMensajePassword] = useState('');
  const [errorPassword, setErrorPassword] = useState('');
  const passwordNuevaRef = useRef<HTMLInputElement>(null);
  const passwordConfirmRef = useRef<HTMLInputElement>(null);
  const [enviandoReset, setEnviandoReset] = useState(false);
  const [mensajeReset, setMensajeReset] = useState('');
  const [customName, setCustomName] = useState(settings.customTheme?.name || '');
  const [customColors, setCustomColors] = useState({
    gold: settings.customTheme?.gold || '#f5c842',
    red: settings.customTheme?.red || '#ff4d6d',
    blue: settings.customTheme?.blue || '#38bdf8',
    pink: settings.customTheme?.pink || '#f472b6',
  });

  useEffect(() => {
    const cargar = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { window.location.href = '/auth'; return; }
      setUsuario(data.user);
      setUserId(data.user.id);
      setNombre(data.user.user_metadata?.nombre || '');

      // Cargar datos del perfil público
      try {
        const { data: lb } = await supabase
          .from('leaderboard')
          .select('descripcion, genero, tipo_estudiante, universidad, carrera')
          .eq('user_id', data.user.id)
          .single();
        if (lb) {
          setDescripcion(lb.descripcion || '');
          setGenero(lb.genero || '');
          setTipoEstudiante(lb.tipo_estudiante || '');
          if (lb.tipo_estudiante === 'universitario') {
            setUniversidad(lb.universidad || '');
            setCarrera(lb.carrera || '');
          } else if (lb.tipo_estudiante === 'escuela') {
            setEscuela(lb.universidad || '');
          }
        }
      } catch {}

      // Cargar visible_leaderboard
      try {
        const { data: lb } = await supabase
          .from('leaderboard')
          .select('visible_leaderboard')
          .eq('user_id', data.user.id)
          .single();
        if (lb !== null) setVisibleLeaderboard(lb?.visible_leaderboard !== false);
      } catch {}

      const localSettings = getSettings();
      try {
        const remoteSettings = await getSettingsDB(data.user.id);
        if (remoteSettings) {
          const merged = { ...DEFAULT_SETTINGS, ...localSettings, ...remoteSettings };
          setSettings(merged);
          saveSettings(merged);
          applyTheme(merged.tema, merged.customTheme);
        } else {
          setSettings(localSettings);
          applyTheme(localSettings.tema, localSettings.customTheme);
          await saveSettingsDB(data.user.id, localSettings);
        }
      } catch {
        setSettings(localSettings);
        applyTheme(localSettings.tema, localSettings.customTheme);
      }

      // Cargar foto desde leaderboard (fuente de verdad)
      try {
        const { data: lb } = await supabase
          .from('leaderboard')
          .select('avatar_url')
          .eq('user_id', data.user.id)
          .single();
        if (lb?.avatar_url) {
          setSettings(prev => ({ ...prev, fotoPerfil: lb.avatar_url }));
          saveSettings({ ...localSettings, fotoPerfil: lb.avatar_url });
        }
      } catch {}
      setCargando(false);
    };
    cargar();
  }, []);



  const updateSettings = async (changes: Partial<AppSettings>) => {
    const nuevas = { ...settings, ...changes };
    setSettings(nuevas);
    saveSettings(nuevas);
    if (changes.tema || changes.customTheme) applyTheme(nuevas.tema, nuevas.customTheme);
    if (userId) {
      try { await saveSettingsDB(userId, nuevas); } catch (err) { console.error(err); }
    }
  };



  const guardarPerfil = async () => {
    setGuardandoPerfil(true);
    setMensajePerfil('');
    try {
      const { error } = await supabase.auth.updateUser({ data: { nombre } });
      if (error) throw error;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) {
        const universidadFinal = tipoEstudiante === 'universitario'
          ? (universidad === 'Otra universidad' ? uniCustom : universidad)
          : tipoEstudiante === 'escuela'
          ? (escuela === 'Otra escuela' ? escuelaCustom : escuela)
          : undefined;
        const carreraFinal = carrera === 'Otra carrera' ? carreraCustom : carrera;

        await fetch('/api/perfil-publico', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            nombre,
            descripcion,
            genero,
            tipo_estudiante: tipoEstudiante,
            universidad: universidadFinal,
            carrera: tipoEstudiante === 'universitario' ? carreraFinal : undefined,
          }),
        });
      }
      setMensajePerfil('✅ ' + (idioma === 'en' ? 'Profile updated!' : '¡Perfil actualizado!'));
    } catch (err: any) {
      setMensajePerfil('❌ Error: ' + err.message);
    } finally {
      setGuardandoPerfil(false);
    }
  };

  const handleFotoPerfil = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert('Max 5MB'); return; }

  const reader = new FileReader();
  reader.onload = async (ev) => {
    const original = ev.target?.result as string;

    // Redimensionar a máximo 400x400px para reducir tamaño
    const comprimida = await new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = original;
    });

    // Guardar local
    await updateSettings({ fotoPerfil: comprimida });
    setMensajePerfil('⏳ Subiendo foto...');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (session) {
        const [r1, r2] = await Promise.all([
          fetch('/api/leaderboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ avatar_url: comprimida }),
          }),
          fetch('/api/perfil-publico', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ avatar_url: comprimida }),
          }),
        ]);
        if (r1.ok && r2.ok) {
          setMensajePerfil('✅ Foto actualizada correctamente');
        } else {
          const err1 = await r1.json().catch(() => ({}));
          const err2 = await r2.json().catch(() => ({}));
          console.error('Leaderboard:', err1, 'Perfil:', err2);
          setMensajePerfil('⚠️ Foto guardada localmente pero no en la nube');
        }
      }
    } catch (err) {
      console.error('Error subiendo foto:', err);
      setMensajePerfil('⚠️ Foto guardada localmente');
    }
    setTimeout(() => setMensajePerfil(''), 3000);
  };
  reader.readAsDataURL(file);
};

  const cambiarPassword = async () => {
    setErrorPassword(''); setMensajePassword('');
    const pNueva = passwordNuevaRef.current?.value || passwordNueva;
    const pConfirm = passwordConfirmRef.current?.value || passwordConfirm;
    if (!pNueva || !pConfirm) { setErrorPassword(tr('noCoinciden')); return; }
    if (pNueva.length < 6) { setErrorPassword('Min 6 chars'); return; }
    if (pNueva !== pConfirm) { setErrorPassword(tr('noCoinciden')); return; }
    setGuardandoPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pNueva });
      if (error) throw error;
      setMensajePassword(tr('contrasenaCambiada'));
      setPasswordNueva(''); setPasswordConfirm('');
      if (passwordNuevaRef.current) passwordNuevaRef.current.value = '';
      if (passwordConfirmRef.current) passwordConfirmRef.current.value = '';
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
      setMensajeReset(tr('emailEnviado'));
    } catch (err: any) {
      setMensajeReset('❌ Error: ' + err.message);
    } finally {
      setEnviandoReset(false);
    }
  };

  const solicitarNotificaciones = async () => {
    if (!('Notification' in window)) { alert('Not supported'); return; }
    const permiso = await Notification.requestPermission();
    if (permiso === 'granted') {
      new Notification('StudyAL', { body: tr('notifActivadas') });
      await updateSettings({ notifAsignaciones: true, notifRacha: true, notifLogros: true });
    }
  };

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth';
  };

  if (cargando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>{tr('cargando')}</p>
      </div>
    );
  }

  const nombre_usuario = usuario?.user_metadata?.nombre || usuario?.email?.split('@')[0] || 'Usuario';
  const inicial = nombre_usuario.charAt(0).toUpperCase();

  const secciones = [
    { id: 'perfil', label: tr('perfilSettings'), desc: tr('nombreImagen') },
    { id: 'seguridad', label: tr('seguridad'), desc: tr('contrasenaAcceso') },
    { id: 'personalizacion', label: tr('personalizacion'), desc: tr('temaColoresNombre') },
    { id: 'notificaciones', label: tr('notificaciones'), desc: tr('alertasRecordatorios') },
    { id: 'datos', label: tr('datos'), desc: tr('limpiarGestionar') },
    { id: 'cuenta', label: tr('cuenta'), desc: tr('infoSesion') },
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
      <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
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
                ← {tr('inicio')}
              </button>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>⚙️ {tr('configuracion')}</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>{tr('ajustesCuenta')}</p>
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
                <div style={{ width: '100%', height: '100%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 900, color: '#000' }}>{inicial}</div>
              )}
            </div>
            <input ref={fotoRef} type="file" accept="image/*" onChange={handleFotoPerfil} style={{ display: 'none' }} />
            <p style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{nombre_usuario}</p>
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '0 0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{usuario?.email}</p>
            <p style={{ fontSize: '10px', color: 'var(--gold)', margin: 0, cursor: 'pointer' }} onClick={() => fotoRef.current?.click()}>
              {tr('cambiarFoto')}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <Card color="var(--gold)">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  👤 {tr('publicProfile')}
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                  {tr('publicProfileDesc')}
                </p>

                {/* Foto */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '16px', background: 'var(--bg-secondary)', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                  <div onClick={() => fotoRef.current?.click()}
                    style={{ width: '72px', height: '72px', borderRadius: '50%', cursor: 'pointer', overflow: 'hidden', border: '3px solid var(--gold)', flexShrink: 0 }}>
                    {settings.fotoPerfil
                      ? <img src={settings.fotoPerfil} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 900, color: '#000' }}>{inicial}</div>
                    }
                  </div>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>{tr('fotoDePerfil')}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 8px' }}>JPG, PNG · Max 2MB</p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => fotoRef.current?.click()}
                        style={{ padding: '6px 12px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                        {tr('cambiarFoto')}
                      </button>
                      {settings.fotoPerfil && (
                        <button onClick={async () => {
                          await updateSettings({ fotoPerfil: '' });
                          try {
                            const { data: s } = await supabase.auth.getSession();
                            if (s.session) {
                              await Promise.all([
                                fetch('/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.session.access_token}` }, body: JSON.stringify({ avatar_url: null }) }),
                                fetch('/api/perfil-publico', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.session.access_token}` }, body: JSON.stringify({ avatar_url: null }) }),
                              ]);
                            }
                          } catch {}
                        }}
                          style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                          {tr('quitar')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Nombre */}
                <InputField label={tr('nombre')} value={nombre} onChange={(e: any) => setNombre(e.target.value)} placeholder={tr('nombre')} />

                {/* Email (solo lectura) */}
                <InputField label={tr('email')} value={usuario?.email || ''} disabled />

                {/* Descripción */}
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    {tr('descripcion')} <span style={{ fontWeight: 400, textTransform: 'none' }}>({descripcion.length}/300)</span>
                  </label>
                  <textarea
                    value={descripcion}
                    onChange={e => setDescripcion(e.target.value.slice(0, 300))}
                    placeholder={tr('descripcionPlaceholder')}
                    rows={3}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', resize: 'vertical', minHeight: '80px', lineHeight: 1.5, fontFamily: 'inherit', transition: 'border 0.2s' }}
                    onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                    onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                  />
                </div>

                {/* Género */}
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    {tr('genero')}
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {[
                      { id: 'hombre', label: tr('hombre') },
                      { id: 'mujer', label: tr('mujer') },
                      { id: 'otro', label: tr('otro') },
                    ].map(g => (
                      <button key={g.id} onClick={() => setGenero(g.id)}
                        style={{ flex: 1, padding: '10px', borderRadius: '10px', border: `2px solid ${genero === g.id ? 'var(--gold)' : 'var(--border-color)'}`, background: genero === g.id ? 'rgba(245,200,66,0.15)' : 'var(--bg-secondary)', color: genero === g.id ? 'var(--gold)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tipo de estudiante */}
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    {tr('tipoEstudiante')}
                  </label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {[
                      { id: 'escuela', label: tr('escuela') },
                      { id: 'universitario', label: tr('universitario') },
                      { id: 'profesional', label: tr('profesional') },
                      { id: 'autodidacta', label: tr('autodidacta') },
                    ].map(t => (
                      <button key={t.id} onClick={() => setTipoEstudiante(t.id)}
                        style={{ padding: '8px 14px', borderRadius: '10px', border: `2px solid ${tipoEstudiante === t.id ? 'var(--blue)' : 'var(--border-color)'}`, background: tipoEstudiante === t.id ? 'rgba(56,189,248,0.15)' : 'var(--bg-secondary)', color: tipoEstudiante === t.id ? 'var(--blue)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Universidad y carrera */}
                {tipoEstudiante === 'universitario' && (
                  <>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>🏫 {tr('universidad').replace('🏫 ', '')}</label>
                      <select value={universidad} onChange={e => setUniversidad(e.target.value)}
                        style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
                        onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                        onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}>
                        <option value="">{tr('sinEspecificar')}</option>
                        {['ULAT','USMA','UTP','UP (Universidad de Panamá)','UDELAS','ISAE Universidad','Universidad Latina de Panamá','Columbus University','Universidad del Istmo','UMECIT','Harvard','MIT','Stanford','TEC de Monterrey','Otra universidad'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      {universidad === 'Otra universidad' && (
                        <input type="text" value={uniCustom} onChange={e => setUniCustom(e.target.value)} placeholder={tr('otraUniversidad')}
                          style={{ width: '100%', padding: '10px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginTop: '8px' }} />
                      )}
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>📚 {tr('carreraMajor').replace('📚 ', '')}</label>
                      <select value={carrera} onChange={e => setCarrera(e.target.value)}
                        style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
                        onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                        onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}>
                        <option value="">{tr('sinEspecificar')}</option>
                        {['Ingeniería en Sistemas / Informática','Ingeniería Civil','Medicina','Enfermería','Psicología','Derecho','Administración de Empresas','Contaduría / Contabilidad','Arquitectura','Diseño Gráfico','Marketing / Publicidad','Biología','Química','Física','Matemáticas','Otra carrera'].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {carrera === 'Otra carrera' && (
                        <input type="text" value={carreraCustom} onChange={e => setCarreraCustom(e.target.value)} placeholder={tr('otraCarrera')}
                          style={{ width: '100%', padding: '10px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginTop: '8px' }} />
                      )}
                    </div>
                  </>
                )}

                {/* Escuela */}
                {tipoEstudiante === 'escuela' && (
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>🏫 {idioma === 'en' ? 'School' : 'Escuela'}</label>
                    <select value={escuela} onChange={e => setEscuela(e.target.value)}
                      style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
                      onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                      onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}>
                      <option value="">{tr('sinEspecificar')}</option>
                      <optgroup label="🏛️ Públicas">
                        {['Instituto Nacional (El Nacio)','Instituto Fermín Naudeau','Instituto Profesional y Técnico de Panamá (IPTP)'].map(e => <option key={e} value={e}>{e}</option>)}
                      </optgroup>
                      <optgroup label="🏫 Particulares">
                        {['Colegio Brader','AIP (Academia Internacional de Panamá)','Balboa Academy','Metropolitan School','Oxford School','Colegio Javier','Colegio La Salle','Isaac Rabin','Instituto Episcopal San Cristóbal','Saint Mary School','Colegio San Viator','Instituto Panamericano (IPA)','St. George School','Otra escuela'].map(e => <option key={e} value={e}>{e}</option>)}
                      </optgroup>
                    </select>
                    {escuela === 'Otra escuela' && (
                      <input type="text" value={escuelaCustom} onChange={e => setEscuelaCustom(e.target.value)} placeholder={tr('otraEscuela')}
                        style={{ width: '100%', padding: '10px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginTop: '8px' }} />
                    )}
                  </div>
                )}

                <Alert msg={mensajePerfil} />

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button onClick={guardarPerfil} disabled={guardandoPerfil}
                    style={{ padding: '13px 24px', borderRadius: '10px', border: 'none', background: guardandoPerfil ? 'var(--bg-card2)' : 'var(--gold)', color: guardandoPerfil ? 'var(--text-faint)' : '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                    {guardandoPerfil ? tr('cargando') : '💾 ' + tr('guardarCambios')}
                  </button>
                  <button onClick={async () => {
                    const { data } = await supabase.auth.getUser();
                    if (data.user?.id) window.location.href = '/u/' + data.user.id;
                  }}
                    style={{ padding: '13px 24px', borderRadius: '10px', border: '2px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                    🌐 {tr('verPerfilPublico')}
                  </button>
                </div>
              </Card>
            </div>
          )}

          {/* ===== SEGURIDAD ===== */}
          {seccion === 'seguridad' && (
            <>
              <Card color="var(--blue)">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{tr('cambiarContrasena')}</h2>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>{tr('nuevaContrasena')}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      ref={passwordNuevaRef}
                      type={showPasswordNueva ? 'text' : 'password'}
                      placeholder="Min 6"
                      autoComplete="new-password"
                      onChange={e => setPasswordNueva(e.target.value)}
                      style={{ width: '100%', padding: '12px 48px 12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' }}
                      onFocus={e => e.currentTarget.style.borderColor = 'var(--blue)'}
                      onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                      onKeyDown={e => e.key === 'Enter' && cambiarPassword()}
                    />
                    <button type="button" onClick={() => setShowPasswordNueva(!showPasswordNueva)} tabIndex={-1}
                      style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '16px', padding: '4px' }}>
                      {showPasswordNueva ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>{tr('confirmarContrasena')}</label>
                  <input
                    ref={passwordConfirmRef}
                    type="password"
                    placeholder={tr('confirmarContrasena')}
                    autoComplete="new-password"
                    onChange={e => setPasswordConfirm(e.target.value)}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' }}
                    onFocus={e => e.currentTarget.style.borderColor = 'var(--blue)'}
                    onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    onKeyDown={e => e.key === 'Enter' && cambiarPassword()}
                  />
                  {passwordConfirm && passwordNueva !== passwordConfirm && (
                    <p style={{ fontSize: '11px', color: 'var(--red)', margin: '4px 0 0' }}>{tr('noCoinciden')}</p>
                  )}
                  {passwordConfirm && passwordNueva === passwordConfirm && passwordNueva.length >= 6 && (
                    <p style={{ fontSize: '11px', color: '#4ade80', margin: '4px 0 0' }}>{tr('coinciden')}</p>
                  )}
                </div>
                <Alert msg={errorPassword} />
                <Alert msg={mensajePassword} />
                <button onClick={cambiarPassword} disabled={guardandoPassword || !passwordNueva || !passwordConfirm}
                  style={{ padding: '13px 24px', borderRadius: '10px', border: 'none', background: guardandoPassword || !passwordNueva || !passwordConfirm ? 'var(--bg-card2)' : 'var(--blue)', color: guardandoPassword || !passwordNueva || !passwordConfirm ? 'var(--text-faint)' : '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer', alignSelf: 'flex-start' }}>
                  {guardandoPassword ? tr('cargando') : tr('cambiarContrasena')}
                </button>
              </Card>
              <Card color="var(--pink)">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{tr('olvidasteContrasena')}</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{usuario?.email}</p>
                <Alert msg={mensajeReset} />
                <button onClick={enviarReset} disabled={enviandoReset}
                  style={{ padding: '13px 24px', borderRadius: '10px', border: 'none', background: enviandoReset ? 'var(--bg-card2)' : 'var(--pink)', color: enviandoReset ? 'var(--text-faint)' : '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer', alignSelf: 'flex-start' }}>
                  {enviandoReset ? tr('cargando') : tr('enviarReset')}
                </button>
              </Card>
            </>
          )}

          {/* ===== PERSONALIZACIÓN ===== */}
          {seccion === 'personalizacion' && (
            <>
              <Card color="#4ade80">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{tr('idiomaApp')}</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{tr('cambiaIdioma')}</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { id: 'es' as const, label: '🇪🇸 Español', flag: '🇪🇸' },
                    { id: 'en' as const, label: '🇺🇸 English', flag: '🇺🇸' },
                  ].map(lang => (
                    <button key={lang.id} onClick={() => { setIdioma(lang.id); window.location.reload(); }}
                      style={{ flex: 1, padding: '16px', borderRadius: '12px', border: `2px solid ${idioma === lang.id ? '#4ade80' : 'var(--border-color)'}`, background: idioma === lang.id ? '#4ade8020' : 'var(--bg-secondary)', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s' }}>
                      <div style={{ fontSize: '32px', marginBottom: '8px' }}>{lang.flag}</div>
                      <p style={{ fontSize: '14px', fontWeight: 800, color: idioma === lang.id ? '#4ade80' : 'var(--text-primary)', margin: 0 }}>{lang.label}</p>
                      {idioma === lang.id && <p style={{ fontSize: '11px', color: '#4ade80', margin: '4px 0 0', fontWeight: 700 }}>✓ {tr('activo')}</p>}
                    </button>
                  ))}
                </div>
              </Card>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: 'var(--pink)' }} />
                <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{tr('temaColores')}</h2>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{tr('tocaTema')}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {TEMAS.map(tema => {
                      const isActive = settings.tema === tema.id;
                      return (
                        <button key={tema.id} onClick={() => updateSettings({ tema: tema.id })}
                          style={{ padding: '16px 18px', borderRadius: '12px', border: `2px solid ${isActive ? tema.colors[0] : 'var(--border-color)'}`, background: isActive ? tema.colors[0] + '25' : 'var(--bg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '14px', transition: 'all 0.2s', textAlign: 'left', width: '100%' }}>
                          <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                            {tema.colors.map((c, i) => (
                              <div key={i} style={{ width: '22px', height: '22px', borderRadius: '50%', background: c, border: '2px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />
                            ))}
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: '14px', fontWeight: 800, color: isActive ? tema.colors[0] : 'var(--text-primary)', margin: '0 0 2px' }}>{idioma === 'en' ? tema.labelEn : tema.labelEs}</p>
                            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>{idioma === 'en' ? tema.descEn : tema.descEs}</p>
                          </div>
                          {isActive && <span style={{ fontSize: '20px', flexShrink: 0 }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Tema personalizado ── */}
                  <div style={{ marginTop: '16px', padding: '18px', background: 'var(--bg-secondary)', borderRadius: '14px', border: settings.tema === 'custom' ? '2px solid var(--gold)' : '2px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <div>
                        <p style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>🎨 {tr('temaPersonalizado').replace('🎨 ', '')}</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{tr('temaPersonalizadoDesc')}</p>
                      </div>
                      {settings.tema === 'custom' && (
                        <span style={{ fontSize: '10px', background: 'var(--gold)', color: '#000', padding: '2px 8px', borderRadius: '20px', fontWeight: 800 }}>{tr('activo')}</span>
                      )}
                    </div>

                    <div style={{ marginBottom: '12px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {tr('nombreTema')}
                      </label>
                      <input
                        type="text"
                        value={customName}
                        onChange={e => setCustomName(e.target.value.slice(0, 20))}
                        placeholder={tr('miTema')}
                        style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
                        onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                        onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '14px' }}>
                      {[
                        { key: 'gold' as const, label: tr('principal') },
                        { key: 'red' as const, label: tr('acento') },
                        { key: 'blue' as const, label: tr('secundario') },
                        { key: 'pink' as const, label: tr('resalte') },
                      ].map(c => (
                        <div key={c.key} style={{ textAlign: 'center' }}>
                          <label style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>{c.label}</label>
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <input
                              type="color"
                              value={customColors[c.key]}
                              onChange={e => setCustomColors(prev => ({ ...prev, [c.key]: e.target.value }))}
                              style={{ width: '44px', height: '44px', borderRadius: '12px', border: '3px solid var(--border-color)', cursor: 'pointer', padding: 0, background: 'transparent' }}
                            />
                          </div>
                          <p style={{ fontSize: '9px', color: 'var(--text-faint)', margin: '4px 0 0', fontFamily: 'monospace' }}>{customColors[c.key]}</p>
                        </div>
                      ))}
                    </div>

                    {/* Preview */}
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginBottom: '14px', padding: '8px', background: 'var(--bg-card)', borderRadius: '10px' }}>
                      {Object.values(customColors).map((c, i) => (
                        <div key={i} style={{ flex: 1, height: '6px', borderRadius: '3px', background: c }} />
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        const theme = { name: customName || nombre_usuario, ...customColors };
                        updateSettings({ tema: 'custom', customTheme: theme });
                      }}
                      style={{
                        width: '100%', padding: '11px', borderRadius: '10px', border: 'none',
                        background: `linear-gradient(90deg, ${customColors.gold}, ${customColors.red}, ${customColors.blue}, ${customColors.pink})`,
                        color: '#000', fontWeight: 800, fontSize: '14px', cursor: 'pointer',
                      }}
                    >
                      🎨 {tr('aplicarTema')}
                    </button>
                  </div>
                </div>
              </div>

              <Card color="#a78bfa">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{tr('modoPantalla')}</h2>
                <Toggle label={isDark ? tr('modoOscuro') : tr('modoClaro')} desc={tr('cambiaFondo')} value={isDark} onChange={toggleDark} />
              </Card>
            </>
          )}

          {/* ===== NOTIFICACIONES ===== */}
          {seccion === 'notificaciones' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* WIDGETS FLOTANTES */}
              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '3px', background: 'var(--pink)' }} />
                <div style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>🤖 ChapBot flotante</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px' }}>{tr('chapbotFlotanteDesc')}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>{tr('mostrar')}</span>
                    <button
                      onClick={() => updateSettings({ chatEnabled: !settings.chatEnabled })}
                      style={{ width: '48px', height: '26px', borderRadius: '13px', border: 'none', background: settings.chatEnabled !== false ? 'var(--pink)' : 'var(--border-color)', cursor: 'pointer', position: 'relative', transition: 'background 0.3s' }}>
                      <div style={{ position: 'absolute', top: '3px', left: settings.chatEnabled !== false ? '24px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.3s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '3px', background: '#ef4444' }} />
                <div style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>⏱️ Pomodoro Timer</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px' }}>{tr('pomodoroDesc')}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>{tr('mostrar')}</span>
                    <button
                      onClick={() => updateSettings({ timerEnabled: !settings.timerEnabled })}
                      style={{ width: '48px', height: '26px', borderRadius: '13px', border: 'none', background: settings.timerEnabled !== false ? '#ef4444' : 'var(--border-color)', cursor: 'pointer', position: 'relative', transition: 'background 0.3s' }}>
                      <div style={{ position: 'absolute', top: '3px', left: settings.timerEnabled !== false ? '24px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.3s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                    </button>
                  </div>

                </div>
              </div>

              {/* LEADERBOARD VISIBILITY */}
              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '3px', background: 'var(--gold)' }} />
                <div style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>🏆 Leaderboard</h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px' }}>
                    {tr('leaderboardDesc')}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {tr('visibleLeaderboard')}
                    </span>
                    <button
                      onClick={async () => {
                        const newVal = !visibleLeaderboard;
                        setVisibleLeaderboard(newVal);
                        if (userId) {
                          try {
                            await supabase
                              .from('leaderboard')
                              .update({ visible_leaderboard: newVal })
                              .eq('user_id', userId);
                          } catch {}
                        }
                      }}
                      style={{ width: '48px', height: '26px', borderRadius: '13px', border: 'none', background: visibleLeaderboard ? 'var(--gold)' : 'var(--border-color)', cursor: 'pointer', position: 'relative', transition: 'background 0.3s' }}>
                      <div style={{ position: 'absolute', top: '3px', left: visibleLeaderboard ? '24px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.3s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                    </button>
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '8px 0 0' }}>
                    {tr('puedesCambiar')}
                  </p>
                </div>
              </div>

              {/* NOTIFICACIONES ORIGINALES */}
            <Card color="var(--blue)">
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{tr('notificaciones')}</h2>
              {'Notification' in window && Notification.permission !== 'granted' && (
                <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: '12px', border: '1px solid var(--blue-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--blue)', margin: '0 0 2px' }}>{tr('activarNotif')}</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{tr('permisoNavegador')}</p>
                  </div>
                  <button onClick={solicitarNotificaciones}
                    style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: 'var(--blue)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer', flexShrink: 0 }}>
                    {tr('activar')}
                  </button>
                </div>
              )}
              {'Notification' in window && Notification.permission === 'granted' && (
                <div style={{ padding: '10px 14px', background: '#4ade8015', borderRadius: '10px', border: '1px solid #4ade8044' }}>
                  <p style={{ fontSize: '13px', color: '#4ade80', margin: 0, fontWeight: 600 }}>{tr('notifActivadas')}</p>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Toggle label={tr('asigPendientes')} desc={tr('avisoTareas')} value={settings.notifAsignaciones} onChange={() => updateSettings({ notifAsignaciones: !settings.notifAsignaciones })} />
                <Toggle label={tr('rachaRiesgo')} desc={tr('alertaRacha')} value={settings.notifRacha} onChange={() => updateSettings({ notifRacha: !settings.notifRacha })} />
                <Toggle label={tr('nuevosLogros')} desc={tr('cuandoDesbloqueas')} value={settings.notifLogros} onChange={() => updateSettings({ notifLogros: !settings.notifLogros })} />
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>{tr('soloNavegador')}</p>
            </Card>
            </div>
          )}

          {/* ===== DATOS ===== */}
          {seccion === 'datos' && (
            <>
              {/* ✅ BACKUP MANAGER */}
              <BackupManager
                temaColor="var(--gold)"
                onRestored={() => window.location.reload()}
              />

              <Card color="var(--blue)">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{tr('almacenamiento')}</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { label: '☁️ ' + tr('materias'), desc: 'Supabase (cloud) ✅' },
                    { label: '📸 ' + tr('fotoPerfil'), desc: 'Supabase (cloud) ✅' },
                    { label: '🎨 ' + tr('temaColores'), desc: 'Supabase (cloud) ✅' },
                    { label: '📊 Stats', desc: 'Supabase (cloud) ✅' },
                    { label: '🔥 Streak', desc: 'localStorage' },
                    { label: '🎓 Quizzes & decks', desc: 'localStorage' },
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
                    <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>{tr('limpiarDatosEstudio')}</h2>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{tr('resetRachaStats')}</p>
                  </div>
                  <button onClick={() => { if (!confirm(tr('limpiarRachaStats'))) return; limpiarDatosEstudio(); alert('✅'); }}
                    style={{ padding: '10px 20px', borderRadius: '10px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
                    {tr('limpiarStats')}
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: 'var(--blue)' }} />
                <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                  <div>
                    <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>{tr('limpiarQuizzesDecks')}</h2>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{tr('eliminarTodos')}</p>
                  </div>
                  <button onClick={() => { if (!confirm('?')) return; localStorage.removeItem('studyal_quizzes_guardados'); localStorage.removeItem('studyal_flashcard_decks'); alert('✅'); }}
                    style={{ padding: '10px 20px', borderRadius: '10px', border: '2px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: '13px', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
                    {tr('limpiarStats')}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ===== CUENTA ===== */}
          {seccion === 'cuenta' && (
            <>
              <Card color="var(--blue)">
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{tr('infoCuenta')}</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { label: 'Email', value: usuario?.email },
                    { label: 'ID', value: usuario?.id?.substring(0, 12) + '...' },
                    { label: tr('creada'), value: usuario?.created_at ? new Date(usuario.created_at).toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES') : 'N/A' },
                    { label: tr('ultimoAcceso'), value: usuario?.last_sign_in_at ? new Date(usuario.last_sign_in_at).toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES') : 'N/A' },
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
                    <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>{tr('cerrarSesionBtn')}</h2>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{tr('cierraSesion')}</p>
                  </div>
                  <button onClick={cerrarSesion}
                    style={{ padding: '10px 20px', borderRadius: '10px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                    {tr('cerrarSesion')}
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '2px solid var(--red-border)', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: 'var(--red)' }} />
                <div style={{ padding: '24px' }}>
                  <h2 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--red)', margin: '0 0 8px' }}>{tr('zonaPeligrosa')}</h2>
                  <div style={{ padding: '14px 18px', background: 'var(--red-dim)', borderRadius: '12px', border: '1px solid var(--red-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px' }}>{tr('eliminarCuenta')}</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{tr('eliminaCuenta')}</p>
                    </div>
                    <button onClick={() => alert(tr('contactaSoporte'))}
                      style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: 'var(--red)', color: '#fff', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                      {tr('eliminar')}
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