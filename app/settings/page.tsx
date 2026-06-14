'use client';

import { useRouter } from 'next/navigation';

import { useState, useEffect, useRef } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
import { getSettings, saveSettings, applyTheme, limpiarDatosEstudio, AppSettings, DEFAULT_SETTINGS } from '../../lib/settings';
import { getSettingsDB, saveSettingsDB } from '../../lib/db';
import BackupManager from '../../components/BackupManager';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

type Seccion = 'perfil' | 'seguridad' | 'personalizacion' | 'notificaciones' | 'datos' | 'cuenta';

const TEMAS: { id: AppSettings['tema']; labelEs: string; labelEn: string; descEs: string; descEn: string; colors: string[] }[] = [
  { id: 'default', labelEs: '⭐ Clásico', labelEn: '⭐ Classic', descEs: 'Dorado, rojo, celeste y rosado', descEn: 'Gold, red, sky blue and pink', colors: ['#d6b26f', '#8a120c', '#38bdf8', '#f472b6'] },
  { id: 'playa', labelEs: '🏖️ Playa', labelEn: '🏖️ Beach', descEs: 'Celeste, arena, rojo y naranja', descEn: 'Sky blue, sand, red and orange', colors: ['#38bdf8', '#ef4444', '#d4a96a', '#fb923c'] },
  { id: 'executive', labelEs: '💼 Ejecutivo', labelEn: '💼 Executive', descEs: 'Gris, verde, azul y blanco', descEn: 'Gray, green, blue and white', colors: ['#a3a3a3', '#4ade80', '#60a5fa', '#e2e8f0'] },
  { id: 'sunset', labelEs: '🌅 Atardecer', labelEn: '🌅 Sunset', descEs: 'Naranja, rojo, dorado y fuego', descEn: 'Orange, red, gold and fire', colors: ['#fb923c', '#ef4444', '#fbbf24', '#f97316'] },
  { id: 'neon', labelEs: '⚡ Eléctrico', labelEn: '⚡ Electric', descEs: 'Verde neón, rosa, azul y morado', descEn: 'Neon green, pink, blue and purple', colors: ['#00f5d4', '#f72585', '#4361ee', '#7b2ff6'] },
];

export default function SettingsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
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
    gold: settings.customTheme?.gold || '#d6b26f',
    red: settings.customTheme?.red || 'var(--red)',
    blue: settings.customTheme?.blue || '#38bdf8',
    pink: settings.customTheme?.pink || '#f472b6',
  });

  useEffect(() => {
    const cargar = async () => {
      if (status === 'loading') return;

      const nextUser = session?.user as any;
      if (!nextUser) {
        router.replace('/landing');
        return;
      }

      const data = {
        user: {
          id: nextUser.id,
          email: nextUser.email,
          user_metadata: {
            nombre: nextUser.name,
            avatar_url: nextUser.image,
          },
        },
      };

      setUsuario(data.user);
      setUserId(data.user.id);
      setNombre(data.user.user_metadata?.nombre || data.user.email?.split('@')[0] || '');

      try {
        const res = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
        const json = await res.json();
        const lb = (json.data || []).find((x: any) => x.user_id === data.user.id);
        if (lb) {
          setDescripcion(lb.descripcion || '');
          setGenero(lb.genero || '');
          setTipoEstudiante(lb.tipo_estudiante || '');
          setVisibleLeaderboard(lb.visible_leaderboard !== false && lb.visible_leaderboard !== 0);
          if (lb.tipo_estudiante === 'universitario') {
            setUniversidad(lb.universidad || '');
            setCarrera(lb.carrera || '');
          } else if (lb.tipo_estudiante === 'escuela') {
            setEscuela(lb.universidad || '');
          }
        }
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

      try {
        const res = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
        const json = await res.json();
        const lb = (json.data || []).find((x: any) => x.user_id === data.user.id);
        if (lb?.avatar_url) {
          setSettings(prev => ({ ...prev, fotoPerfil: lb.avatar_url }));
          saveSettings({ ...localSettings, fotoPerfil: lb.avatar_url });
        }
      } catch {}
      setCargando(false);
    };
    cargar();
  }, [session, status, router]);

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
      {

        const universidadFinal = tipoEstudiante === 'universitario'
          ? (universidad === 'Otra universidad' ? uniCustom : universidad)
          : tipoEstudiante === 'escuela'
          ? (escuela === 'Otra escuela' ? escuelaCustom : escuela)
          : undefined;
        const carreraFinal = carrera === 'Otra carrera' ? carreraCustom : carrera;

        await fetch('/api/perfil-publico', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json',  },
          body: JSON.stringify({
            nombre, descripcion, genero,
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

      await updateSettings({ fotoPerfil: comprimida });
      setMensajePerfil('⏳ Subiendo foto...');

      try {
        {

          const [r1, r2] = await Promise.all([
            fetch('/api/leaderboard', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ avatar_url: comprimida }),
            }),
            fetch('/api/perfil-publico', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ avatar_url: comprimida }),
            }),
          ]);
          if (r1.ok && r2.ok) {
            setMensajePerfil('✅ Foto actualizada correctamente');
          } else {
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
      setMensajePassword('El cambio de contraseña por email se activará en la siguiente fase. Por ahora tu acceso principal es Google.');
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
      setMensajeReset('La recuperación por email se activará en la siguiente fase. Por ahora entra con Google.');
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
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    await signOut({ callbackUrl: '/auth' });
  };

  if (cargando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontFamily: HAND, fontSize: 22, color: 'var(--text-muted)', fontStyle: 'italic' }}>~ {tr('cargando')} ~</p>
      </div>
    );
  }

  const nombre_usuario = usuario?.user_metadata?.nombre || usuario?.email?.split('@')[0] || 'Usuario';
  const inicial = nombre_usuario.charAt(0).toUpperCase();

  const secciones = [
    { id: 'perfil',          label: tr('perfilSettings'),    desc: tr('nombreImagen'),         emoji: '👤', color: 'var(--gold)' },
    { id: 'seguridad',       label: tr('seguridad'),          desc: tr('contrasenaAcceso'),     emoji: '🔒', color: 'var(--blue)' },
    { id: 'personalizacion', label: tr('personalizacion'),    desc: tr('temaColoresNombre'),    emoji: '🎨', color: 'var(--pink)' },
    { id: 'notificaciones',  label: tr('notificaciones'),     desc: tr('alertasRecordatorios'), emoji: '🔔', color: '#a78bfa' },
    { id: 'datos',           label: tr('datos'),              desc: tr('limpiarGestionar'),     emoji: '💾', color: '#4ade80' },
    { id: 'cuenta',          label: tr('cuenta'),             desc: tr('infoSesion'),           emoji: '⚙️', color: 'var(--red)' },
  ] as const;

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
                ⚙️ {tr('configuracion')}
              </h1>
              <svg width="180" height="6" style={{ display: 'block', marginTop: 2 }}>
                <path d="M2 3 Q 90 0 178 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
              </svg>
            </div>
          </div>
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

      <div style={{
        maxWidth: 1000, margin: '0 auto',
        padding: isMobile ? '16px' : '28px 36px 60px',
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '260px 1fr',
        gap: 24, alignItems: 'flex-start',
      }}>

        {/* SIDEBAR */}
        <div>
          {/* Card usuario */}
          <div style={{
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 14,
            padding: 20,
            textAlign: 'center',
            marginBottom: 14,
            boxShadow: '4px 5px 0 var(--gold)',
            transform: 'rotate(-1deg)',
            position: 'relative',
          }}>
            {/* Cinta scotch */}
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(-3deg)',
              width: 70, height: 16,
              background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
              border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
              boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
            }}/>

            <div onClick={() => fotoRef.current?.click()}
              style={{
                width: 80, height: 80, borderRadius: '50%',
                margin: '0 auto 12px',
                cursor: 'pointer', overflow: 'hidden',
                border: '3px solid var(--text-primary)',
                boxShadow: '3px 3px 0 var(--gold)',
                transform: 'rotate(-3deg)',
              }}>
              {settings.fotoPerfil ? (
                <img src={settings.fotoPerfil} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  background: 'var(--gold)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: HAND, fontSize: 36, fontWeight: 900, color: '#000',
                }}>{inicial}</div>
              )}
            </div>
            <input ref={fotoRef} type="file" accept="image/*" onChange={handleFotoPerfil} style={{ display: 'none' }} />
            <p style={{
              fontFamily: HAND, fontSize: 20, fontWeight: 900,
              color: 'var(--text-primary)', margin: '0 0 2px', lineHeight: 1.05,
            }}>{nombre_usuario}</p>
            <p style={{
              fontFamily: BODY, fontSize: 13, fontStyle: 'italic',
              color: 'var(--text-faint)', margin: '0 0 8px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{usuario?.email}</p>
            <p style={{
              fontFamily: HAND, fontSize: 14, fontWeight: 700,
              color: 'var(--gold)', fontStyle: 'italic',
              margin: 0, cursor: 'pointer',
            }} onClick={() => fotoRef.current?.click()}>
              ~ {tr('cambiarFoto')} ~
            </p>
          </div>

          {/* Menu secciones */}
          <div style={{
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '4px 5px 0 var(--text-primary)',
            transform: 'rotate(0.4deg)',
          }}>
            {secciones.map((s, i) => {
              const active = seccion === s.id;
              return (
                <button key={s.id} onClick={() => setSeccion(s.id as Seccion)}
                  style={{
                    width: '100%', padding: '11px 16px',
                    border: 'none',
                    borderBottom: i < secciones.length - 1 ? '1.5px dashed var(--border-color)' : 'none',
                    background: active ? `color-mix(in srgb,${s.color} 18%,transparent)` : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 10,
                    transition: 'all 0.2s',
                    borderLeft: `4px solid ${active ? s.color : 'transparent'}`,
                  }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{s.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: HAND, fontSize: 17, fontWeight: 800,
                      color: active ? s.color : 'var(--text-primary)',
                      lineHeight: 1.1,
                    }}>{s.label}</div>
                    <div style={{
                      fontFamily: BODY, fontSize: 13, fontStyle: 'italic',
                      color: 'var(--text-faint)',
                    }}>{s.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* CONTENIDO */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* ===== PERFIL ===== */}
          {seccion === 'perfil' && (
            <NotebookCard color="var(--gold)" emoji="👤" title={tr('publicProfile')} rot={-0.4}>
              <Texto>{tr('publicProfileDesc')}</Texto>

              {/* Foto */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 18,
                padding: 14,
                background: 'var(--bg-secondary)',
                border: '2.5px dashed var(--gold)',
                borderRadius: 12,
                transform: 'rotate(-0.5deg)',
              }}>
                <div onClick={() => fotoRef.current?.click()}
                  style={{
                    width: 72, height: 72, borderRadius: '50%',
                    cursor: 'pointer', overflow: 'hidden',
                    border: '3px solid var(--text-primary)',
                    boxShadow: '2px 3px 0 var(--gold)',
                    transform: 'rotate(-4deg)',
                    flexShrink: 0,
                  }}>
                  {settings.fotoPerfil
                    ? <img src={settings.fotoPerfil} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HAND, fontSize: 32, fontWeight: 900, color: '#000' }}>{inicial}</div>
                  }
                </div>
                <div>
                  <p style={{ fontFamily: HAND, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>
                    {tr('fotoDePerfil')}
                  </p>
                  <p style={{ fontFamily: HAND, fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                    ~ JPG, PNG · Max 5MB ~
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <MiniBtn onClick={() => fotoRef.current?.click()} color="var(--gold)">
                      {tr('cambiarFoto')}
                    </MiniBtn>
                    {settings.fotoPerfil && (
                      <MiniBtn onClick={async () => {
                        await updateSettings({ fotoPerfil: '' });
                        try {
                          {

                            await Promise.all([
                              fetch('/api/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_url: null }) }),
                              fetch('/api/perfil-publico', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar_url: null }) }),
                            ]);
                          }
                        } catch {}
                      }} color="var(--text-faint)">
                        {tr('quitar')}
                      </MiniBtn>
                    )}
                  </div>
                </div>
              </div>

              <Field label={tr('nombre')}>
                <Input value={nombre} onChange={(e: any) => setNombre(e.target.value)} placeholder={tr('nombre')} />
              </Field>

              <Field label={tr('email')}>
                <Input value={usuario?.email || ''} disabled />
              </Field>

              <Field label={`${tr('descripcion')} (${descripcion.length}/300)`}>
                <textarea
                  value={descripcion}
                  onChange={(e: any) => setDescripcion(e.target.value.slice(0, 300))}
                  placeholder={tr('descripcionPlaceholder')}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: 10,
                    border: '2.5px solid var(--text-primary)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontFamily: BODY, fontSize: 17, fontWeight: 600,
                    outline: 'none', boxSizing: 'border-box',
                    resize: 'vertical', minHeight: 80, lineHeight: 1.4,
                    boxShadow: '3px 3px 0 var(--text-primary)',
                    transform: 'rotate(-0.3deg)',
                  }}
                />
              </Field>

              <Field label={tr('genero')}>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { id: 'hombre', label: tr('hombre') },
                    { id: 'mujer',  label: tr('mujer')  },
                    { id: 'otro',   label: tr('otro')   },
                  ].map((g, i) => (
                    <ToggleBtn key={g.id} active={genero === g.id} color="var(--gold)" onClick={() => setGenero(g.id)} rot={(i - 1) * 1.2}>
                      {g.label}
                    </ToggleBtn>
                  ))}
                </div>
              </Field>

              <Field label={tr('tipoEstudiante')}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { id: 'escuela',        label: tr('escuela') },
                    { id: 'universitario',  label: tr('universitario') },
                    { id: 'profesional',    label: tr('profesional') },
                    { id: 'autodidacta',    label: tr('autodidacta') },
                  ].map((t, i) => (
                    <ToggleBtn key={t.id} active={tipoEstudiante === t.id} color="var(--blue)" onClick={() => setTipoEstudiante(t.id)} rot={(i % 2 === 0 ? -1 : 1) * 1.2}>
                      {t.label}
                    </ToggleBtn>
                  ))}
                </div>
              </Field>

              {tipoEstudiante === 'universitario' && (
                <>
                  <Field label={`🏫 ${tr('universidad').replace('🏫 ', '')}`}>
                    <Select value={universidad} onChange={(e: any) => setUniversidad(e.target.value)}>
                      <option value="">{tr('sinEspecificar')}</option>
                      {['ULAT','USMA','UTP','UP (Universidad de Panamá)','UDELAS','ISAE Universidad','Universidad Latina de Panamá','Columbus University','Universidad del Istmo','UMECIT','Harvard','MIT','Stanford','TEC de Monterrey','Otra universidad'].map(u => <option key={u} value={u}>{u}</option>)}
                    </Select>
                    {universidad === 'Otra universidad' && (
                      <Input value={uniCustom} onChange={(e: any) => setUniCustom(e.target.value)} placeholder={tr('otraUniversidad')} style={{ marginTop: 8 }} />
                    )}
                  </Field>
                  <Field label={`📚 ${tr('carreraMajor').replace('📚 ', '')}`}>
                    <Select value={carrera} onChange={(e: any) => setCarrera(e.target.value)}>
                      <option value="">{tr('sinEspecificar')}</option>
                      {['Ingeniería en Sistemas / Informática','Ingeniería Civil','Medicina','Enfermería','Psicología','Derecho','Administración de Empresas','Contaduría / Contabilidad','Arquitectura','Diseño Gráfico','Marketing / Publicidad','Biología','Química','Física','Matemáticas','Otra carrera'].map(c => <option key={c} value={c}>{c}</option>)}
                    </Select>
                    {carrera === 'Otra carrera' && (
                      <Input value={carreraCustom} onChange={(e: any) => setCarreraCustom(e.target.value)} placeholder={tr('otraCarrera')} style={{ marginTop: 8 }} />
                    )}
                  </Field>
                </>
              )}

              {tipoEstudiante === 'escuela' && (
                <Field label={`🏫 ${idioma === 'en' ? 'School' : 'Escuela'}`}>
                  <Select value={escuela} onChange={(e: any) => setEscuela(e.target.value)}>
                    <option value="">{tr('sinEspecificar')}</option>
                    <optgroup label="🏛️ Públicas">
                      {['Instituto Nacional (El Nacio)','Instituto Fermín Naudeau','Instituto Profesional y Técnico de Panamá (IPTP)'].map(e => <option key={e} value={e}>{e}</option>)}
                    </optgroup>
                    <optgroup label="🏫 Particulares">
                      {['Colegio Brader','AIP (Academia Internacional de Panamá)','Balboa Academy','Metropolitan School','Oxford School','Colegio Javier','Colegio La Salle','Isaac Rabin','Instituto Episcopal San Cristóbal','Saint Mary School','Colegio San Viator','Instituto Panamericano (IPA)','St. George School','Otra escuela'].map(e => <option key={e} value={e}>{e}</option>)}
                    </optgroup>
                  </Select>
                  {escuela === 'Otra escuela' && (
                    <Input value={escuelaCustom} onChange={(e: any) => setEscuelaCustom(e.target.value)} placeholder={tr('otraEscuela')} style={{ marginTop: 8 }} />
                  )}
                </Field>
              )}

              <Alert msg={mensajePerfil} />

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <PrimaryBtn onClick={guardarPerfil} disabled={guardandoPerfil} color="var(--gold)">
                  {guardandoPerfil ? '⏳ ' + tr('cargando') : '💾 ' + tr('guardarCambios')}
                </PrimaryBtn>
                <SecondaryBtn onClick={async () => {
                  if (userId) { const uid = userId; (window as any).__showNavLoader?.(`/u/${uid}`); router.push(`/u/${uid}`); }
                }} color="var(--blue)">
                  🌐 {tr('verPerfilPublico')}
                </SecondaryBtn>
              </div>
            </NotebookCard>
          )}

          {/* ===== SEGURIDAD ===== */}
          {seccion === 'seguridad' && (
            <>
              <NotebookCard color="var(--blue)" emoji="🔒" title={tr('cambiarContrasena')} rot={-0.4}>
                <Field label={tr('nuevaContrasena')}>
                  <div style={{ position: 'relative' }}>
                    <input
                      ref={passwordNuevaRef}
                      type={showPasswordNueva ? 'text' : 'password'}
                      placeholder="Min 6"
                      autoComplete="new-password"
                      onChange={(e: any) => setPasswordNueva(e.target.value)}
                      onKeyDown={(e: any) => e.key === 'Enter' && cambiarPassword()}
                      style={{
                        width: '100%', padding: '11px 48px 11px 14px',
                        borderRadius: 10,
                        border: '2.5px solid var(--text-primary)',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        fontFamily: HAND, fontSize: 18, fontWeight: 600,
                        outline: 'none', boxSizing: 'border-box',
                        boxShadow: '3px 3px 0 var(--text-primary)',
                        transform: 'rotate(-0.3deg)',
                      }}
                    />
                    <button type="button" onClick={() => setShowPasswordNueva(!showPasswordNueva)} tabIndex={-1}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, padding: 4 }}>
                      {showPasswordNueva ? '🙈' : '👁️'}
                    </button>
                  </div>
                </Field>
                <Field label={tr('confirmarContrasena')}>
                  <input
                    ref={passwordConfirmRef}
                    type="password"
                    placeholder={tr('confirmarContrasena')}
                    autoComplete="new-password"
                    onChange={(e: any) => setPasswordConfirm(e.target.value)}
                    onKeyDown={(e: any) => e.key === 'Enter' && cambiarPassword()}
                    style={{
                      width: '100%', padding: '11px 14px',
                      borderRadius: 10,
                      border: '2.5px solid var(--text-primary)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontFamily: HAND, fontSize: 18, fontWeight: 600,
                      outline: 'none', boxSizing: 'border-box',
                      boxShadow: '3px 3px 0 var(--text-primary)',
                      transform: 'rotate(-0.3deg)',
                    }}
                  />
                  {passwordConfirm && passwordNueva !== passwordConfirm && (
                    <p style={{ fontFamily: HAND, fontSize: 14, fontStyle: 'italic', color: 'var(--red)', margin: '4px 0 0' }}>
                      ~ {tr('noCoinciden')} ~
                    </p>
                  )}
                  {passwordConfirm && passwordNueva === passwordConfirm && passwordNueva.length >= 6 && (
                    <p style={{ fontFamily: HAND, fontSize: 14, fontStyle: 'italic', color: '#4ade80', margin: '4px 0 0' }}>
                      ~ ✓ {tr('coinciden')} ~
                    </p>
                  )}
                </Field>
                <Alert msg={errorPassword} />
                <Alert msg={mensajePassword} />
                <PrimaryBtn onClick={cambiarPassword} disabled={guardandoPassword || !passwordNueva || !passwordConfirm} color="var(--blue)">
                  {guardandoPassword ? '⏳ ' + tr('cargando') : '🔐 ' + tr('cambiarContrasena')}
                </PrimaryBtn>
              </NotebookCard>

              <NotebookCard color="var(--pink)" emoji="🔑" title={tr('olvidasteContrasena')} rot={0.4}>
                <Texto>{usuario?.email}</Texto>
                <Alert msg={mensajeReset} />
                <PrimaryBtn onClick={enviarReset} disabled={enviandoReset} color="var(--pink)">
                  {enviandoReset ? '⏳ ' + tr('cargando') : '📧 ' + tr('enviarReset')}
                </PrimaryBtn>
              </NotebookCard>
            </>
          )}

          {/* ===== PERSONALIZACIÓN ===== */}
          {seccion === 'personalizacion' && (
            <>
              <NotebookCard color="#4ade80" emoji="🌍" title={tr('idiomaApp')} rot={-0.4}>
                <Texto>{tr('cambiaIdioma')}</Texto>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[
                    { id: 'es' as const, flag: '🇪🇸', label: 'Español' },
                    { id: 'en' as const, flag: '🇺🇸', label: 'English' },
                  ].map((lang, i) => {
                    const active = idioma === lang.id;
                    return (
                      <button key={lang.id} onClick={() => { setIdioma(lang.id); window.location.reload(); }}
                        style={{
                          flex: 1, padding: 16,
                          borderRadius: 12,
                          border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? '#4ade80' : 'var(--border-color)'}`,
                          background: active ? 'color-mix(in srgb,#4ade80 18%,transparent)' : 'var(--bg-secondary)',
                          cursor: 'pointer', textAlign: 'center',
                          boxShadow: active ? '3px 3px 0 #4ade80' : 'none',
                          transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
                          transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                        }}>
                        <div style={{ fontSize: 36, marginBottom: 6 }}>{lang.flag}</div>
                        <p style={{
                          fontFamily: HAND, fontSize: 19, fontWeight: 800,
                          color: active ? '#4ade80' : 'var(--text-primary)',
                          margin: 0, lineHeight: 1.05,
                        }}>{lang.label}</p>
                        {active && (
                          <p style={{
                            fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                            color: '#4ade80', margin: '4px 0 0', fontWeight: 700,
                          }}>~ ✓ {tr('activo')} ~</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </NotebookCard>

              <NotebookCard color="var(--pink)" emoji="🎨" title={tr('temaColores')} rot={0.4}>
                <Texto>{tr('tocaTema')}</Texto>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {TEMAS.map((tema, i) => {
                    const isActive = settings.tema === tema.id;
                    return (
                      <button key={tema.id} onClick={() => updateSettings({ tema: tema.id })}
                        style={{
                          padding: '14px 16px',
                          borderRadius: 12,
                          border: `2.5px ${isActive ? 'solid' : 'dashed'} ${isActive ? tema.colors[0] : 'var(--border-color)'}`,
                          background: isActive ? tema.colors[0] + '20' : 'var(--bg-secondary)',
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 12,
                          boxShadow: isActive ? `2px 3px 0 ${tema.colors[0]}` : 'none',
                          transform: isActive ? `rotate(${i % 2 === 0 ? -1 : 1}deg)` : `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                          transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                          textAlign: 'left', width: '100%',
                        }}>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {tema.colors.map((c, j) => (
                            <div key={j} style={{
                              width: 22, height: 22, borderRadius: '50%',
                              background: c,
                              border: '2px solid var(--text-primary)',
                              transform: `rotate(${(j - 1.5) * 8}deg)`,
                            }} />
                          ))}
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{
                            fontFamily: HAND, fontSize: 19, fontWeight: 800,
                            color: isActive ? tema.colors[0] : 'var(--text-primary)',
                            margin: '0 0 2px', lineHeight: 1.05,
                          }}>{idioma === 'en' ? tema.labelEn : tema.labelEs}</p>
                          <p style={{
                            fontFamily: BODY, fontSize: 14, fontStyle: 'italic',
                            color: 'var(--text-faint)', margin: 0,
                          }}>~ {idioma === 'en' ? tema.descEn : tema.descEs} ~</p>
                        </div>
                        {isActive && <span style={{ fontSize: 24, flexShrink: 0 }}>✓</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Tema personalizado */}
                <div style={{
                  marginTop: 12,
                  padding: 18,
                  background: 'var(--bg-secondary)',
                  border: `2.5px ${settings.tema === 'custom' ? 'solid var(--gold)' : 'dashed var(--border-color)'}`,
                  borderRadius: 14,
                  boxShadow: settings.tema === 'custom' ? '3px 3px 0 var(--gold)' : 'none',
                  transform: 'rotate(-0.4deg)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <p style={{
                        fontFamily: HAND, fontSize: 19, fontWeight: 800,
                        color: 'var(--text-primary)', margin: '0 0 2px',
                      }}>
                        🎨 {tr('temaPersonalizado').replace('🎨 ', '')}
                      </p>
                      <p style={{
                        fontFamily: BODY, fontSize: 14, fontStyle: 'italic',
                        color: 'var(--text-muted)', margin: 0,
                      }}>
                        ~ {tr('temaPersonalizadoDesc')} ~
                      </p>
                    </div>
                    {settings.tema === 'custom' && (
                      <span style={{
                        fontFamily: HAND, fontSize: 13, fontWeight: 800,
                        background: 'var(--gold)', color: '#000',
                        border: '2px solid var(--text-primary)',
                        boxShadow: '2px 2px 0 var(--text-primary)',
                        padding: '2px 10px', borderRadius: 6,
                        transform: 'rotate(3deg)',
                      }}>{tr('activo')}</span>
                    )}
                  </div>

                  <Field label={tr('nombreTema')}>
                    <Input value={customName} onChange={(e: any) => setCustomName(e.target.value.slice(0, 20))} placeholder={tr('miTema')} />
                  </Field>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
                    {[
                      { key: 'gold' as const, label: tr('principal') },
                      { key: 'red'  as const, label: tr('acento') },
                      { key: 'blue' as const, label: tr('secundario') },
                      { key: 'pink' as const, label: tr('resalte') },
                    ].map((c, i) => (
                      <div key={c.key} style={{ textAlign: 'center' }}>
                        <label style={{
                          fontFamily: BODY, fontSize: 13, fontWeight: 700,
                          color: 'var(--text-muted)', fontStyle: 'italic',
                          display: 'block', marginBottom: 6,
                        }}>{c.label}</label>
                        <input
                          type="color"
                          value={customColors[c.key]}
                          onChange={(e: any) => setCustomColors(prev => ({ ...prev, [c.key]: e.target.value }))}
                          style={{
                            width: 46, height: 46, borderRadius: 12,
                            border: '3px solid var(--text-primary)',
                            cursor: 'pointer', padding: 0, background: 'transparent',
                            boxShadow: '2px 2px 0 var(--text-primary)',
                            transform: `rotate(${(i % 2 === 0 ? -3 : 3)}deg)`,
                          }}
                        />
                        <p style={{
                          fontFamily: BODY, fontSize: 11, fontStyle: 'italic',
                          color: 'var(--text-faint)', margin: '4px 0 0',
                        }}>{customColors[c.key]}</p>
                      </div>
                    ))}
                  </div>

                  <div style={{
                    display: 'flex', gap: 4, justifyContent: 'center',
                    marginBottom: 14, padding: 8,
                    background: 'var(--bg-card)',
                    border: '1.5px solid var(--text-primary)',
                    borderRadius: 10,
                  }}>
                    {Object.values(customColors).map((c, i) => (
                      <div key={i} style={{ flex: 1, height: 8, borderRadius: 3, background: c }} />
                    ))}
                  </div>

                  <button onClick={() => {
                    const theme = { name: customName || nombre_usuario, ...customColors };
                    updateSettings({ tema: 'custom', customTheme: theme });
                  }}
                    style={{
                      width: '100%', padding: 12,
                      borderRadius: 12,
                      border: '2.5px solid var(--text-primary)',
                      background: `linear-gradient(90deg, ${customColors.gold}, ${customColors.red}, ${customColors.blue}, ${customColors.pink})`,
                      color: '#000',
                      fontFamily: HAND, fontSize: 19, fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '3px 4px 0 var(--text-primary)',
                      transform: 'rotate(-1deg)',
                    }}
                  >
                    🎨 {tr('aplicarTema')}
                  </button>
                </div>
              </NotebookCard>

              <NotebookCard color="#a78bfa" emoji="🌙" title={tr('modoPantalla')} rot={-0.3}>
                <Toggle label={isDark ? tr('modoOscuro') : tr('modoClaro')} desc={tr('cambiaFondo')} value={isDark} onChange={toggleDark} color="#a78bfa" />
              </NotebookCard>
            </>
          )}

          {/* ===== NOTIFICACIONES ===== */}
          {seccion === 'notificaciones' && (
            <>
              <NotebookCard color="var(--pink)" emoji="🤖" title="ChapBot flotante" rot={-0.4}>
                <Texto>{tr('chapbotFlotanteDesc')}</Texto>
                <Toggle label={tr('mostrar')} desc="" value={settings.chatEnabled !== false} onChange={() => updateSettings({ chatEnabled: !settings.chatEnabled })} color="var(--pink)" />
              </NotebookCard>

              <NotebookCard color="#ef4444" emoji="⏱️" title="Pomodoro Timer" rot={0.4}>
                <Texto>{tr('pomodoroDesc')}</Texto>
                <Toggle label={tr('mostrar')} desc="" value={settings.timerEnabled !== false} onChange={() => updateSettings({ timerEnabled: !settings.timerEnabled })} color="#ef4444" />
              </NotebookCard>

              <NotebookCard color="var(--gold)" emoji="🏆" title="Leaderboard" rot={-0.3}>
                <Texto>{tr('leaderboardDesc')}</Texto>
                <Toggle label={tr('visibleLeaderboard')} desc={tr('puedesCambiar')} value={visibleLeaderboard} onChange={async () => {
                  const newVal = !visibleLeaderboard;
                  setVisibleLeaderboard(newVal);
                  try {
                    await fetch('/api/leaderboard', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'same-origin',
                      body: JSON.stringify({ visible_leaderboard: newVal }),
                    });
                  } catch {}
                }} color="var(--gold)" />
              </NotebookCard>

              <NotebookCard color="var(--blue)" emoji="🔔" title={tr('notificaciones')} rot={0.4}>
                {'Notification' in window && Notification.permission !== 'granted' && (
                  <div style={{
                    padding: 14,
                    background: 'color-mix(in srgb,var(--blue) 16%,transparent)',
                    border: '2.5px dashed var(--blue)',
                    borderRadius: 10,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: 12, flexWrap: 'wrap',
                    transform: 'rotate(-0.4deg)',
                  }}>
                    <div>
                      <p style={{ fontFamily: HAND, fontSize: 18, fontWeight: 800, color: 'var(--blue)', margin: '0 0 2px' }}>
                        {tr('activarNotif')}
                      </p>
                      <p style={{ fontFamily: HAND, fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>
                        ~ {tr('permisoNavegador')} ~
                      </p>
                    </div>
                    <PrimaryBtn onClick={solicitarNotificaciones} color="var(--blue)">
                      {tr('activar')}
                    </PrimaryBtn>
                  </div>
                )}
                {'Notification' in window && Notification.permission === 'granted' && (
                  <div style={{
                    padding: '10px 14px',
                    background: 'color-mix(in srgb,#4ade80 16%,transparent)',
                    border: '2.5px solid #4ade80',
                    borderRadius: 10,
                    boxShadow: '2px 3px 0 #4ade80',
                    transform: 'rotate(-0.3deg)',
                  }}>
                    <p style={{ fontFamily: HAND, fontSize: 17, fontWeight: 800, color: '#16a34a', margin: 0 }}>
                      ✅ {tr('notifActivadas')}
                    </p>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Toggle label={tr('asigPendientes')} desc={tr('avisoTareas')} value={settings.notifAsignaciones} onChange={() => updateSettings({ notifAsignaciones: !settings.notifAsignaciones })} color="var(--blue)" />
                  <Toggle label={tr('rachaRiesgo')} desc={tr('alertaRacha')} value={settings.notifRacha} onChange={() => updateSettings({ notifRacha: !settings.notifRacha })} color="var(--red)" />
                  <Toggle label={tr('nuevosLogros')} desc={tr('cuandoDesbloqueas')} value={settings.notifLogros} onChange={() => updateSettings({ notifLogros: !settings.notifLogros })} color="var(--gold)" />
                </div>
                <p style={{ fontFamily: BODY, fontSize: 14, fontStyle: 'italic', color: 'var(--text-faint)', margin: 0 }}>
                  ~ {tr('soloNavegador')} ~
                </p>
              </NotebookCard>
            </>
          )}

          {/* ===== DATOS ===== */}
          {seccion === 'datos' && (
            <>
              <BackupManager temaColor="var(--gold)" onRestored={() => window.location.reload()} />

              <NotebookCard color="var(--blue)" emoji="💾" title={tr('almacenamiento')} rot={-0.4}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { label: '☁️ ' + tr('materias'), desc: 'Cloudflare D1 ✅' },
                    { label: '📸 ' + tr('fotoPerfil'), desc: 'Cloudflare D1 ✅' },
                    { label: '🎨 ' + tr('temaColores'), desc: 'Cloudflare D1 ✅' },
                    { label: '📊 Stats', desc: 'Cloudflare D1 ✅' },
                    { label: '🔥 Streak', desc: 'localStorage' },
                    { label: '🎓 Quizzes & decks', desc: 'localStorage' },
                  ].map((item, i) => (
                    <div key={i} style={{
                      padding: '10px 14px',
                      background: 'var(--bg-secondary)',
                      border: '1.5px dashed var(--border-color)',
                      borderRadius: 10,
                      transform: `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                    }}>
                      <p style={{ fontFamily: HAND, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{item.label}</p>
                      <p style={{ fontFamily: HAND, fontSize: 13, fontStyle: 'italic', color: 'var(--text-faint)', margin: 0 }}>~ {item.desc} ~</p>
                    </div>
                  ))}
                </div>
              </NotebookCard>

              <NotebookCard color="var(--gold)" emoji="🧹" title={tr('limpiarDatosEstudio')} rot={0.4}>
                <Texto>{tr('resetRachaStats')}</Texto>
                <SecondaryBtn onClick={() => { if (!confirm(tr('limpiarRachaStats'))) return; limpiarDatosEstudio(); alert('✅'); }} color="var(--gold)">
                  🧹 {tr('limpiarStats')}
                </SecondaryBtn>
              </NotebookCard>

              <NotebookCard color="var(--blue)" emoji="🗑️" title={tr('limpiarQuizzesDecks')} rot={-0.4}>
                <Texto>{tr('eliminarTodos')}</Texto>
                <SecondaryBtn onClick={() => { if (!confirm('?')) return; localStorage.removeItem('studyal_quizzes_guardados'); localStorage.removeItem('studyal_flashcard_decks'); alert('✅'); }} color="var(--blue)">
                  🗑️ {tr('limpiarStats')}
                </SecondaryBtn>
              </NotebookCard>
            </>
          )}

          {/* ===== CUENTA ===== */}
          {seccion === 'cuenta' && (
            <>
              <NotebookCard color="var(--blue)" emoji="ℹ️" title={tr('infoCuenta')} rot={-0.4}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { label: 'Email', value: usuario?.email },
                    { label: 'ID', value: usuario?.id?.substring(0, 12) + '...' },
                    { label: tr('creada'), value: usuario?.created_at ? new Date(usuario.created_at).toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES') : 'N/A' },
                    { label: tr('ultimoAcceso'), value: usuario?.last_sign_in_at ? new Date(usuario.last_sign_in_at).toLocaleDateString(idioma === 'en' ? 'en-US' : 'es-ES') : 'N/A' },
                  ].map((item, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'var(--bg-secondary)',
                      border: '1.5px dashed var(--border-color)',
                      borderRadius: 10,
                      transform: `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                    }}>
                      <span style={{ fontFamily: HAND, fontSize: 16, fontWeight: 700, color: 'var(--text-muted)', fontStyle: 'italic' }}>{item.label}</span>
                      <span style={{ fontFamily: HAND, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </NotebookCard>

              <NotebookCard color="var(--gold)" emoji="🚪" title={tr('cerrarSesionBtn')} rot={0.4}>
                <Texto>{tr('cierraSesion')}</Texto>
                <SecondaryBtn onClick={cerrarSesion} color="var(--gold)">
                  🚪 {tr('cerrarSesion')}
                </SecondaryBtn>
              </NotebookCard>

              <div style={{
                background: 'var(--bg-card)',
                border: '2.5px solid var(--red)',
                borderRadius: 14,
                boxShadow: '4px 5px 0 var(--red)',
                transform: 'rotate(-0.4deg)',
                overflow: 'hidden',
              }}>
                <div style={{
                  background: 'var(--red)',
                  padding: '8px 18px',
                  borderBottom: '2px solid var(--text-primary)',
                }}>
                  <h2 style={{
                    fontFamily: HAND, fontSize: 22, fontWeight: 900,
                    color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.35)',
                    margin: 0, fontStyle: 'italic',
                  }}>
                    ⚠️ {tr('zonaPeligrosa')}
                  </h2>
                </div>
                <div style={{ padding: 18 }}>
                  <div style={{
                    padding: 14,
                    background: 'color-mix(in srgb,var(--red) 16%,transparent)',
                    border: '2.5px dashed var(--red)',
                    borderRadius: 10,
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', flexWrap: 'wrap', gap: 12,
                    transform: 'rotate(0.3deg)',
                  }}>
                    <div>
                      <p style={{ fontFamily: HAND, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>
                        {tr('eliminarCuenta')}
                      </p>
                      <p style={{ fontFamily: HAND, fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>
                        ~ {tr('eliminaCuenta')} ~
                      </p>
                    </div>
                    <button onClick={() => alert(tr('contactaSoporte'))}
                      style={{
                        padding: '10px 18px',
                        borderRadius: 10,
                        border: '2.5px solid var(--text-primary)',
                        background: 'var(--red)', color: '#fff',
                        fontFamily: HAND, fontSize: 17, fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: '3px 3px 0 var(--text-primary)',
                        textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                        transform: 'rotate(-1deg)',
                      }}>
                      🗑️ {tr('eliminar')}
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
          color: '#000',
          margin: 0, fontStyle: 'italic',
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        fontFamily: HAND, fontSize: 15, fontWeight: 800,
        color: 'var(--text-muted)',
        display: 'block', marginBottom: 6,
        fontStyle: 'italic',
        transform: 'rotate(-0.5deg)', transformOrigin: 'left',
      }}>
        ✏️ {label}
      </label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, disabled, style }: any) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={type === 'password' ? 'new-password' : 'off'}
      style={{
        width: '100%',
        padding: '11px 14px',
        borderRadius: 10,
        border: '2.5px solid var(--text-primary)',
        background: 'var(--bg-secondary)',
        color: disabled ? 'var(--text-faint)' : 'var(--text-primary)',
        fontFamily: BODY, fontSize: 18, fontWeight: 600,
        outline: 'none', boxSizing: 'border-box',
        cursor: disabled ? 'not-allowed' : 'text',
        boxShadow: '3px 3px 0 var(--text-primary)',
        transform: 'rotate(-0.3deg)',
        ...style,
      }}
    />
  );
}

function Select({ value, onChange, children }: any) {
  return (
    <select value={value} onChange={onChange}
      style={{
        width: '100%',
        padding: '11px 14px',
        borderRadius: 10,
        border: '2.5px solid var(--text-primary)',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        fontFamily: BODY, fontSize: 17, fontWeight: 600,
        outline: 'none', boxSizing: 'border-box',
        cursor: 'pointer',
        boxShadow: '3px 3px 0 var(--text-primary)',
        transform: 'rotate(-0.3deg)',
      }}>
      {children}
    </select>
  );
}

function Texto({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: BODY, fontSize: 17, fontStyle: 'italic',
      color: 'var(--text-muted)', margin: 0,
    }}>
      ~ {children} ~
    </p>
  );
}

function Alert({ msg }: { msg: string }) {
  if (!msg) return null;
  const isOk = msg.includes('✅');
  const color = isOk ? '#4ade80' : 'var(--red)';
  return (
    <div style={{
      padding: '10px 14px',
      borderRadius: 10,
      background: `color-mix(in srgb,${color} 16%,transparent)`,
      border: `2.5px solid ${color}`,
      boxShadow: `2px 3px 0 ${color}`,
      transform: 'rotate(-0.4deg)',
    }}>
      <p style={{
        fontFamily: HAND, fontSize: 17, fontWeight: 800,
        color: isOk ? '#16a34a' : 'var(--red)',
        margin: 0,
      }}>
        {msg}
      </p>
    </div>
  );
}

function Toggle({ label, desc, value, onChange, color }: { label: string; desc: string; value: boolean; onChange: () => void; color: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 14px',
      background: 'var(--bg-secondary)',
      border: `2px dashed ${value ? color : 'var(--border-color)'}`,
      borderRadius: 12,
      gap: 12,
      transform: 'rotate(-0.3deg)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: HAND, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px', lineHeight: 1.1 }}>
          {label}
        </p>
        {desc && (
          <p style={{ fontFamily: BODY, fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>
            ~ {desc} ~
          </p>
        )}
      </div>
      <button onClick={onChange}
        style={{
          width: 54, height: 30,
          borderRadius: 15,
          border: '2px solid var(--text-primary)',
          background: value ? color : 'var(--border-color2)',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.3s',
          flexShrink: 0,
          boxShadow: '2px 2px 0 var(--text-primary)',
        }}>
        <div style={{
          width: 22, height: 22,
          borderRadius: '50%',
          background: '#fff',
          border: '1.5px solid var(--text-primary)',
          position: 'absolute', top: 2, left: value ? 27 : 2,
          transition: 'left 0.3s cubic-bezier(.25,.8,.25,1)',
        }} />
      </button>
    </div>
  );
}

function ToggleBtn({ children, active, color, onClick, rot }: any) {
  return (
    <button onClick={onClick}
      style={{
        flex: 1, padding: '10px 14px',
        borderRadius: 10,
        border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? color : 'var(--border-color)'}`,
        background: active ? `color-mix(in srgb,${color} 18%,transparent)` : 'var(--bg-secondary)',
        color: active ? color : 'var(--text-muted)',
        fontFamily: HAND, fontSize: 16, fontWeight: 800,
        cursor: 'pointer',
        boxShadow: active ? `2px 3px 0 ${color}` : 'none',
        transform: active ? `rotate(${rot < 0 ? -1.5 : 1.5}deg)` : `rotate(${rot}deg)`,
        transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
      }}>
      {children}
    </button>
  );
}

function PrimaryBtn({ children, onClick, disabled, color }: any) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: '12px 22px',
        borderRadius: 12,
        border: '2.5px solid var(--text-primary)',
        background: disabled ? 'var(--bg-card2)' : color,
        color: disabled ? 'var(--text-faint)' : '#000',
        fontFamily: HAND, fontSize: 19, fontWeight: 800,
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled ? 'none' : '3px 4px 0 var(--text-primary)',
        transform: 'rotate(-1deg)',
        transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
      }}
      onMouseEnter={(e:any)=>{if(!disabled){e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='4px 6px 0 var(--text-primary)';}}}
      onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';if(!disabled)e.currentTarget.style.boxShadow='3px 4px 0 var(--text-primary)';}}
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
        alignSelf: 'flex-start',
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

function MiniBtn({ children, onClick, color }: any) {
  return (
    <button onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 8,
        border: `2px dashed ${color}`,
        background: 'transparent',
        color,
        fontFamily: HAND, fontSize: 15, fontWeight: 800,
        cursor: 'pointer',
        transform: 'rotate(-1deg)',
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e:any)=>{e.currentTarget.style.background=`color-mix(in srgb,${color} 14%,transparent)`;e.currentTarget.style.borderStyle='solid';}}
      onMouseLeave={(e:any)=>{e.currentTarget.style.background='transparent';e.currentTarget.style.borderStyle='dashed';}}
    >
      {children}
    </button>
  );
}