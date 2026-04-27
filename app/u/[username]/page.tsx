'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

interface PerfilPublico {
  user_id: string;
  nombre: string;
  xp_total: number;
  flashcards_estudiadas: number;
  racha_actual: number;
  mejor_racha: number;
  precision_global: number;
  avatar_url?: string;
  carrera?: string;
  universidad?: string;
  tipo_estudiante?: string;
  genero?: string;
  descripcion?: string;
  created_at?: string;
  visible_leaderboard?: boolean;
}

const CARRERAS = [
  'Ingeniería en Sistemas / Informática',
  'Ingeniería Civil',
  'Ingeniería Mecánica',
  'Ingeniería Eléctrica',
  'Medicina',
  'Enfermería',
  'Odontología',
  'Psicología',
  'Derecho',
  'Administración de Empresas',
  'Contaduría / Contabilidad',
  'Economía',
  'Arquitectura',
  'Diseño Gráfico',
  'Marketing / Publicidad',
  'Comunicación Social',
  'Educación / Pedagogía',
  'Biología',
  'Química',
  'Física',
  'Matemáticas',
  'Filosofía',
  'Historia',
  'Sociología',
  'Trabajo Social',
  'Nutrición / Dietética',
  'Fisioterapia',
  'Farmacia',
  'Veterinaria',
  'Agronomía',
  'Otra carrera',
];

const UNIVERSIDADES = [
  'ULAT',
  'USMA',
  'UTP',
  'UP (Universidad de Panamá)',
  'UDELAS',
  'ISAE Universidad',
  'Universidad Latina de Panamá',
  'Columbus University',
  'Universidad del Istmo',
  'UMECIT',
  'Harvard',
  'MIT',
  'Stanford',
  'Notre Dame',
  'IE University',
  'UM (Universidad de Miami)',
  'TEC de Monterrey',
  'MU',
  'Otra universidad',
];

const ESCUELAS_PUBLICAS = [
  'Instituto Nacional (El Nacio)',
  'Artes y Oficios Melchor Lasso de la Vega',
  'Instituto Fermín Naudeau',
  'Instituto Profesional y Técnico de Panamá (IPTP)',
  'Escuela Secundaria Pedro Pablo Sánchez',
  'Colegio Secundario de Panamá',
  'Escuela Secundaria de la Chorrera',
  'Escuela Secundaria de Chitré',
  'Colegio Rubiano',
];

const ESCUELAS_PRIVADAS = [
  'Colegio Brader',
  'AIP (Academia Internacional de Panamá)',
  'Balboa Academy',
  'Metropolitan School',
  'International School of Panama (ISP)',
  'Colegio de Panamá (ECP)',
  'Colegio Real de Panamá (CRP)',
  'Colegio San Agustín',
  'Oxford School',
  'Colegio Javier',
  'Colegio La Salle',
  'Colegio De La Salle',
  'Colegio Isaac Rabin',
  'Colegio Hebreo',
  'Instituto Episcopal San Cristóbal',
  'Colegio Internacional de María Inmaculada',
  'Saint Mary School',
  'Colegio Internacional SEK Panamá',
  "King's College",
  'Colegio San Viator',
  'Instituto Panamericano (IPA)',
  'Colegio Las Esclavas',
  'Colegio María Inmaculada',
  'Colegio Madre Laura',
  'Saint John School',
  'Colegio Bilingüe Punta Pacífica',
  'Colegio Internacional de Panamá',
  'Colegio Alberto Einstein',
  'Boston School International',
  'St. George School',
  'Otra escuela',
];

const TIPOS = ['universitario', 'escuela', 'profesional', 'autodidacta'];
const GENEROS = ['hombre', 'mujer', 'otro'];

const getNivel = (xp: number) => Math.floor((xp || 0) / 50) + 1;
const getXpEnNivel = (xp: number) => (xp || 0) % 50;
const getRankMedal = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;
const getRankColor = (r: number) => r === 1 ? '#f5c842' : r === 2 ? '#c0c0c0' : r === 3 ? '#cd7f32' : '#a78bfa';

const getTitulo = (nivel: number) => {
  if (nivel >= 20) return { titulo: 'Maestro del Estudio', color: '#f5c842' };
  if (nivel >= 15) return { titulo: 'Estudioso Élite', color: '#38bdf8' };
  if (nivel >= 10) return { titulo: 'Estudiante Pro', color: '#4ade80' };
  if (nivel >= 5) return { titulo: 'En Progreso', color: '#60a5fa' };
  return { titulo: 'Nuevo Estudiante', color: '#94a3b8' };
};

const generoEmoji: Record<string, string> = {
  hombre: '👦',
  mujer: '👧',
  otro: '🌈',
};

function Avatar({ perfil, size = 80 }: { perfil: PerfilPublico; size?: number }) {
  const inicial = (perfil.nombre || 'U').trim().charAt(0).toUpperCase();

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: perfil.avatar_url ? 'transparent' : 'var(--gold)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 900,
        color: '#000',
        overflow: 'hidden',
        flexShrink: 0,
        border: '3px solid var(--gold)',
        boxShadow: '0 0 0 6px rgba(245,200,66,0.15)',
      }}
    >
      {perfil.avatar_url ? (
        <img src={perfil.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        inicial
      )}
    </div>
  );
}

function Stat({
  emoji,
  label,
  value,
  color,
}: {
  emoji: string;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        borderRadius: '16px',
        padding: '20px 14px',
        border: '1px solid var(--border-color)',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: color }} />
      <div style={{ fontSize: '22px', marginBottom: '8px' }}>{emoji}</div>
      <div style={{ fontSize: '24px', fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600, marginTop: '5px' }}>{label}</div>
    </div>
  );
}

function EditModal({
  perfil,
  onSave,
  onClose,
}: {
  perfil: PerfilPublico;
  onSave: (data: Partial<PerfilPublico>) => Promise<void>;
  onClose: () => void;
}) {
  const [nombre, setNombre] = useState(perfil.nombre?.trim() || '');
  const [descripcion, setDescripcion] = useState(perfil.descripcion || '');
  const [tipo, setTipo] = useState(perfil.tipo_estudiante || '');
  const [genero, setGenero] = useState(perfil.genero || '');

  const [universidad, setUniversidad] = useState(
    perfil.tipo_estudiante === 'universitario' ? (perfil.universidad || '') : ''
  );
  const [uniCustom, setUniCustom] = useState('');
  const [carrera, setCarrera] = useState(perfil.carrera || '');
  const [carreraCustom, setCarreraCustom] = useState('');

  const [escuela, setEscuela] = useState(
    perfil.tipo_estudiante === 'escuela' ? (perfil.universidad || '') : ''
  );
  const [escuelaCustom, setEscuelaCustom] = useState('');

  const [guardando,    setGuardando]    = useState(false);
  const [error,        setError]        = useState('');
  const [fotoPreview,  setFotoPreview]  = useState(perfil.avatar_url || '');
  const [fotoBase64,   setFotoBase64]   = useState('');
  const fotoRef = useRef<HTMLInputElement>(null);

  const universidadFinal = universidad === 'Otra universidad' ? uniCustom : universidad;
  const carreraFinal = carrera === 'Otra carrera' ? carreraCustom : carrera;
  const escuelaFinal = escuela === 'Otra escuela' ? escuelaCustom : escuela;

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '10px',
    border: '2px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  };

  const labelStyle = {
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text-faint)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '6px',
    display: 'block',
  };

  const handleFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Máximo 2MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setFotoPreview(result);
      setFotoBase64(result);
    };
    reader.readAsDataURL(file);
  };

  const handleGuardar = async () => {
    if (!nombre.trim()) {
      setError('El nombre no puede estar vacío');
      return;
    }

    setGuardando(true);
    setError('');

    try {
      const payload: Partial<PerfilPublico> = {
        nombre,
        descripcion,
        genero,
        tipo_estudiante: tipo,
        carrera: tipo === 'universitario' ? carreraFinal : undefined,
        universidad:
          tipo === 'universitario'
            ? universidadFinal
            : tipo === 'escuela'
            ? escuelaFinal
            : undefined,
      };

      // Si cambió la foto, incluirla
      if (fotoBase64) {
        payload.avatar_url = fotoBase64;
      }

      await onSave(payload);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: '24px',
          maxWidth: '520px',
          width: '100%',
          border: '1px solid var(--border-color)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              ✏️ Editar Perfil Público
            </h2>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: '20px', cursor: 'pointer', padding: '4px' }}
            >
              ✕
            </button>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: '4px 0 0' }}>
            Estos datos se muestran públicamente en tu perfil
          </p>
        </div>

        <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Foto de perfil */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div
                onClick={() => fotoRef.current?.click()}
                style={{
                  width: '90px', height: '90px', borderRadius: '50%',
                  background: fotoPreview ? 'transparent' : 'var(--gold)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '32px', fontWeight: 900, color: '#000',
                  overflow: 'hidden', cursor: 'pointer',
                  border: '3px solid var(--gold)',
                  boxShadow: '0 0 0 4px rgba(245,200,66,0.2)',
                  transition: 'all 0.2s',
                }}
              >
                {fotoPreview
                  ? <img src={fotoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : nombre.trim().charAt(0).toUpperCase() || '?'}
              </div>
              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => fotoRef.current?.click()}
                  style={{ padding: '7px 16px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                  📸 Cambiar foto
                </button>
                {fotoPreview && fotoPreview !== perfil.avatar_url && (
                  <p style={{ fontSize: '11px', color: '#4ade80', margin: '4px 0 0', fontWeight: 600 }}>✓ Nueva foto lista</p>
                )}
                {fotoBase64 && (
                  <button
                    type="button"
                    onClick={() => { setFotoPreview(perfil.avatar_url || ''); setFotoBase64(''); }}
                    style={{ display: 'block', margin: '4px auto 0', background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: '11px', cursor: 'pointer' }}>
                    Cancelar cambio
                  </button>
                )}
              </div>
              <input ref={fotoRef} type="file" accept="image/*" onChange={handleFoto} style={{ display: 'none' }} />
            </div>

            <div>
              <label style={labelStyle}>Nombre</label>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Tu nombre"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>
                Descripción <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-faint)' }}>({descripcion.length}/300)</span>
              </label>
              <textarea
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value.slice(0, 300))}
                placeholder="Ej: Me gusta biología celular, química y estudiar por las noches ✨"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', minHeight: '80px', lineHeight: 1.5, fontFamily: 'inherit' }}
              />
            </div>

            <div>
              <label style={labelStyle}>Género</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {GENEROS.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGenero(g)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '10px',
                      border: `2px solid ${genero === g ? 'var(--gold)' : 'var(--border-color)'}`,
                      background: genero === g ? 'rgba(245,200,66,0.15)' : 'transparent',
                      color: genero === g ? 'var(--gold)' : 'var(--text-muted)',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {generoEmoji[g]} {g}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={labelStyle}>Tipo de estudiante</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { id: 'escuela', label: '🏫 Escuela' },
                  { id: 'universitario', label: '🎓 Universitario' },
                  { id: 'profesional', label: '💼 Profesional' },
                  { id: 'autodidacta', label: '🧠 Autodidacta' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTipo(t.id)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: `2px solid ${tipo === t.id ? 'var(--blue)' : 'var(--border-color)'}`,
                      background: tipo === t.id ? 'rgba(56,189,248,0.15)' : 'transparent',
                      color: tipo === t.id ? 'var(--blue)' : 'var(--text-muted)',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {tipo === 'universitario' && (
              <>
                <div>
                  <label style={labelStyle}>🏫 Universidad</label>
                  <select value={universidad} onChange={(e) => setUniversidad(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">Sin especificar</option>
                    {UNIVERSIDADES.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  {universidad === 'Otra universidad' && (
                    <input
                      value={uniCustom}
                      onChange={(e) => setUniCustom(e.target.value)}
                      placeholder="Escribe tu universidad..."
                      style={{ ...inputStyle, marginTop: '8px' }}
                    />
                  )}
                </div>

                <div>
                  <label style={labelStyle}>📚 Carrera</label>
                  <select value={carrera} onChange={(e) => setCarrera(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">Sin especificar</option>
                    {CARRERAS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {carrera === 'Otra carrera' && (
                    <input
                      value={carreraCustom}
                      onChange={(e) => setCarreraCustom(e.target.value)}
                      placeholder="Escribe tu carrera..."
                      style={{ ...inputStyle, marginTop: '8px' }}
                    />
                  )}
                </div>
              </>
            )}

            {tipo === 'escuela' && (
              <div>
                <label style={labelStyle}>🏫 Escuela</label>
                <select value={escuela} onChange={(e) => setEscuela(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">Sin especificar</option>
                  <optgroup label="🏛️ Escuelas Públicas">
                    {ESCUELAS_PUBLICAS.map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </optgroup>
                  <optgroup label="🏫 Escuelas Particulares">
                    {ESCUELAS_PRIVADAS.map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </optgroup>
                </select>
                {escuela === 'Otra escuela' && (
                  <input
                    value={escuelaCustom}
                    onChange={(e) => setEscuelaCustom(e.target.value)}
                    placeholder="Escribe tu escuela..."
                    style={{ ...inputStyle, marginTop: '8px' }}
                  />
                )}
              </div>
            )}

            {(tipo === 'profesional' || tipo === 'autodidacta') && (
              <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                  {tipo === 'profesional'
                    ? '💼 Como profesional no se mostrarán escuela ni universidad.'
                    : '🧠 Como autodidacta no se mostrará escuela ni universidad.'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '20px 28px', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
          {error && (
            <p style={{ fontSize: '13px', color: 'var(--red)', margin: '0 0 12px', fontWeight: 600 }}>
              ⚠️ {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleGuardar}
              disabled={guardando}
              style={{
                flex: 1,
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: guardando ? 'var(--bg-secondary)' : 'var(--gold)',
                color: guardando ? 'var(--text-faint)' : '#000',
                fontWeight: 800,
                fontSize: '14px',
                cursor: guardando ? 'not-allowed' : 'pointer',
              }}
            >
              {guardando ? '⏳ Guardando...' : '✅ Guardar cambios'}
            </button>

            <button
              onClick={onClose}
              style={{
                padding: '13px 22px',
                borderRadius: '12px',
                border: '2px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontWeight: 700,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PerfilPublicoPage() {
  const params = useParams();
  const slug = decodeURIComponent(params.username as string);

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [rank, setRank] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [miUserId, setMiUserId] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [showEdit,           setShowEdit]           = useState(false);
  const [partnerStatus,      setPartnerStatus]      = useState<'ninguno'|'partner'|'enviada'|'recibida'>('ninguno');
  const [enviandoSolicitud,  setEnviandoSolicitud]  = useState(false);
  const [postsUsuario,       setPostsUsuario]       = useState<any[]>([]);
  const [cargandoPosts,      setCargandoPosts]      = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setMiUserId(data.user.id);
    });
  }, []);

  const cargarPostsUsuario = async (userId: string) => {
    setCargandoPosts(true);
    try {
      const res = await fetch(`/api/comunidad/posts?userId=${userId}&tipo=all&filtro=todos`);
      const data = await res.json();
      setPostsUsuario(data.posts || []);
    } catch {}
    finally { setCargandoPosts(false); }
  };

  const cargarPerfil = async () => {
    setCargando(true);
    setError('');
    try {
      const esUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
      const param = esUUID ? `userId=${slug}` : `username=${encodeURIComponent(slug)}`;
      const res = await fetch(`/api/perfil-publico?${param}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Perfil no encontrado');
      } else {
        setPerfil(data.perfil);
        setRank(data.rank);
        setTotalUsers(data.totalUsers);
        cargarPostsUsuario(data.perfil.user_id);
      }
    } catch {
      setError('Error al cargar el perfil');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (slug) cargarPerfil();
  }, [slug]);

  useEffect(() => {
    const checkPartner = async () => {
      if (!miUserId || !perfil || miUserId === perfil.user_id) return;
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/partners', { headers: { Authorization: 'Bearer ' + token } });
      const data = await res.json();
      if (!data.success) return;
      if (data.partners?.find((p: any) => p.partner.user_id === perfil.user_id)) setPartnerStatus('partner');
      else if (data.enviadas?.find((p: any) => p.partner.user_id === perfil.user_id)) setPartnerStatus('enviada');
      else if (data.solicitudes?.find((p: any) => p.partner.user_id === perfil.user_id)) setPartnerStatus('recibida');
      else setPartnerStatus('ninguno');
    };
    checkPartner();
  }, [miUserId, perfil]);

  const handleSave = async (cambios: Partial<PerfilPublico>) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');

    const res = await fetch('/api/perfil-publico', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(cambios),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Error al guardar');

    // Actualizar estado local inmediatamente
    setPerfil((prev) => (prev ? { ...prev, ...cambios } : prev));

    // Si cambió la foto, guardarla también en settings locales
    if (cambios.avatar_url) {
      try {
        const { getSettings, saveSettings } = await import('../../../lib/settings');
        const s = getSettings();
        saveSettings({ ...s, fotoPerfil: cambios.avatar_url });
      } catch {}
    }

    // Si cambió el nombre, actualizar auth metadata local
    if (cambios.nombre) {
      await supabase.auth.updateUser({ data: { nombre: cambios.nombre } }).catch(() => {});
    }
  };

  const copiarLink = () => {
    const url = `${window.location.origin}/u/${perfil?.user_id || slug}`;
    navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  if (cargando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', fontFamily: '-apple-system, sans-serif' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ width: '48px', height: '48px', border: '3px solid var(--gold)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>Cargando perfil...</p>
      </div>
    );
  }

  if (error || !perfil) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', fontFamily: '-apple-system, sans-serif', padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '64px' }}>🔒</div>
        <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Perfil no disponible</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>{error || 'Este perfil es privado o no existe'}</p>
        <button
          onClick={() => (window.location.href = '/')}
          style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, fontSize: '14px', cursor: 'pointer' }}
        >
          ← Volver
        </button>
      </div>
    );
  }

  const nivel = getNivel(perfil.xp_total);
  const xpEnNivel = getXpEnNivel(perfil.xp_total);
  const { titulo, color: tituloColor } = getTitulo(nivel);
  const rankColor = getRankColor(rank);
  const esMiPerfil = miUserId === perfil.user_id;
  const urlPublica = typeof window !== 'undefined' ? `${window.location.origin}/u/${perfil.user_id}` : '';

  const logros = [
    { emoji: '🌱', label: 'Primera flashcard', ok: (perfil.flashcards_estudiadas || 0) >= 1 },
    { emoji: '⚡', label: '50 flashcards', ok: (perfil.flashcards_estudiadas || 0) >= 50 },
    { emoji: '🔥', label: '100 flashcards', ok: (perfil.flashcards_estudiadas || 0) >= 100 },
    { emoji: '💎', label: '500 flashcards', ok: (perfil.flashcards_estudiadas || 0) >= 500 },
    { emoji: '👑', label: 'Nivel 10', ok: nivel >= 10 },
    { emoji: '🌟', label: 'Nivel 20', ok: nivel >= 20 },
    { emoji: '🎯', label: '80% precisión', ok: (perfil.precision_global || 0) >= 80 },
    { emoji: '🔰', label: 'Racha 7 días', ok: (perfil.mejor_racha || 0) >= 7 },
    { emoji: '🏆', label: 'Top 10 mundial', ok: rank <= 10 },
  ];

  const logrosOk = logros.filter((l) => l.ok).length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>
      {showEdit && <EditModal perfil={perfil} onSave={handleSave} onClose={() => setShowEdit(false)} />}

      <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 32px', height: '62px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
        <button onClick={() => (window.location.href = '/')} style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '7px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
          ← StudyAL
        </button>

        <div style={{ display: 'flex', gap: '8px' }}>
          {esMiPerfil && (
            <>
              <button
                onClick={() => setShowEdit(true)}
                style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid #38bdf8', background: 'transparent', color: '#38bdf8', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
              >
                ✏️ Editar perfil
              </button>
              <button
                onClick={() => (window.location.href = '/perfil')}
                style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
              >
                📊 Mis Stats
              </button>
            </>
          )}

          <button
            onClick={copiarLink}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: copiado ? '#4ade8022' : 'transparent', color: copiado ? '#4ade80' : 'var(--text-muted)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
          >
            {copiado ? '✅ ¡Copiado!' : '🔗 Compartir'}
          </button>
          {!esMiPerfil && miUserId && (
            <>
              {partnerStatus === 'ninguno' && (
                <button
                  onClick={async () => {
                    setEnviandoSolicitud(true);
                    const { data: s } = await supabase.auth.getSession();
                    const token = s.session?.access_token;
                    if (!token || !perfil) return;
                    await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ receiver_id: perfil.user_id }) });
                    setPartnerStatus('enviada');
                    setEnviandoSolicitud(false);
                  }}
                  disabled={enviandoSolicitud}
                  style={{ padding: '7px 14px', borderRadius: '8px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                  {enviandoSolicitud ? '⏳' : '👥 Agregar'}
                </button>
              )}
              {partnerStatus === 'partner' && (
                <button onClick={() => window.location.href = '/partners'}
                  style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid #4ade80', background: '#4ade8015', color: '#4ade80', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                  👥 Partners
                </button>
              )}
              {partnerStatus === 'enviada' && (
                <span style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', color: 'var(--text-faint)', fontSize: '13px', fontWeight: 700 }}>
                  ⏳ Enviada
                </span>
              )}
              {partnerStatus === 'recibida' && (
                <button onClick={async () => {
                  const { data: s } = await supabase.auth.getSession();
                  const token = s.session?.access_token;
                  const res = await fetch('/api/partners', { headers: { Authorization: 'Bearer ' + token } });
                  const data = await res.json();
                  const sol = data.solicitudes?.find((p: any) => p.partner.user_id === perfil?.user_id);
                  if (sol && token) {
                    await fetch('/api/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ partner_id: sol.id, action: 'accept' }) });
                    setPartnerStatus('partner');
                  }
                }} style={{ padding: '7px 14px', borderRadius: '8px', border: 'none', background: '#4ade80', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                  ✅ Aceptar
                </button>
              )}
            </>
          )}
        </div>
      </header>

      <div style={{ display: 'flex', height: '3px' }}>
        {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
          <div key={i} style={{ flex: 1, background: c }} />
        ))}
      </div>

      <div style={{ maxWidth: '820px', margin: '0 auto', padding: '32px 16px 48px' }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: '24px', border: `1px solid ${rankColor}33`, overflow: 'hidden', marginBottom: '24px' }}>
          <div style={{ height: '110px', background: `linear-gradient(135deg, ${rankColor}28 0%, ${tituloColor}12 100%)`, position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: '14px 20px' }}>
            {esMiPerfil && (
              <button
                onClick={() => setShowEdit(true)}
                style={{ position: 'absolute', top: '14px', left: '20px', padding: '6px 14px', borderRadius: '8px', border: '2px solid rgba(255,255,255,0.3)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
              >
                ✏️ Editar perfil
              </button>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Ranking Global</div>
                <div style={{ fontSize: '20px', fontWeight: 900, color: rankColor }}>{rank} de {totalUsers}</div>
              </div>
              <span style={{ fontSize: '32px' }}>{getRankMedal(rank)}</span>
            </div>
          </div>

          <div style={{ padding: '0 28px 28px', marginTop: '-50px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '18px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <Avatar perfil={perfil} size={90} />

              <div style={{ flex: 1, minWidth: 0, paddingBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                  <h1 style={{ fontSize: '26px', fontWeight: 900, color: 'var(--text-primary)', margin: 0, lineHeight: 1 }}>
                    {perfil.nombre.trim()}
                  </h1>
                  {perfil.genero && <span style={{ fontSize: '20px' }}>{generoEmoji[perfil.genero] || ''}</span>}
                  {esMiPerfil && (
                    <span style={{ padding: '3px 10px', borderRadius: '20px', background: 'var(--gold)', color: '#000', fontSize: '11px', fontWeight: 800 }}>
                      Tú
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <span style={{ padding: '4px 12px', borderRadius: '20px', background: `${tituloColor}22`, color: tituloColor, fontSize: '12px', fontWeight: 700, border: `1px solid ${tituloColor}44` }}>
                    ⭐ {titulo}
                  </span>
                  <span style={{ padding: '4px 12px', borderRadius: '20px', background: 'rgba(245,200,66,0.15)', color: 'var(--gold)', fontSize: '12px', fontWeight: 700 }}>
                    Nivel {nivel}
                  </span>
                  {logrosOk > 0 && (
                    <span style={{ padding: '4px 12px', borderRadius: '20px', background: '#a78bfa22', color: '#38bdf8', fontSize: '12px', fontWeight: 700 }}>
                      🏅 {logrosOk} logros
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {perfil.carrera && (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '3px 10px', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
                      🎓 {perfil.carrera}
                    </span>
                  )}
                  {perfil.universidad && (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '3px 10px', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
                      🏫 {perfil.universidad}
                    </span>
                  )}
                  {perfil.tipo_estudiante && (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '3px 10px', borderRadius: '20px', border: '1px solid var(--border-color)', textTransform: 'capitalize' }}>
                      {perfil.tipo_estudiante === 'universitario'
                        ? '🎓'
                        : perfil.tipo_estudiante === 'escuela'
                        ? '🏫'
                        : perfil.tipo_estudiante === 'profesional'
                        ? '💼'
                        : '🧠'}{' '}
                      {perfil.tipo_estudiante}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {perfil.descripcion ? (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '14px 18px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.7, fontStyle: 'italic' }}>
                  “{perfil.descripcion}”
                </p>
              </div>
            ) : esMiPerfil ? (
              <button
                onClick={() => setShowEdit(true)}
                style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '2px dashed var(--border-color)', background: 'transparent', color: 'var(--text-faint)', fontSize: '13px', cursor: 'pointer', marginBottom: '16px' }}
              >
                + Añade una descripción a tu perfil
              </button>
            ) : null}

            <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '14px 18px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold)' }}>⚡ {perfil.xp_total || 0} XP Total</span>
                <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{xpEnNivel}/50 XP → Nivel {nivel + 1}</span>
              </div>
              <div style={{ background: 'var(--bg-card)', borderRadius: '8px', height: '10px', overflow: 'hidden' }}>
                <div style={{ width: `${(xpEnNivel / 50) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--gold), #ff9f43)', borderRadius: '8px', transition: 'width 1.2s ease' }} />
              </div>
            </div>

            {/* Acciones de Partners visibles dentro del perfil */}
            {miUserId && (
              <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {esMiPerfil ? (
                  <button
                    onClick={() => window.location.href = '/partners'}
                    style={{ padding: '11px 18px', borderRadius: '12px', border: '2px solid #38bdf8', background: 'transparent', color: '#38bdf8', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                    👥 Ir a Partners
                  </button>
                ) : (
                  <>
                    {partnerStatus === 'ninguno' && (
                      <button
                        onClick={async () => {
                          setEnviandoSolicitud(true);
                          const { data: s } = await supabase.auth.getSession();
                          const token = s.session?.access_token;
                          if (!token || !perfil) return;
                          await fetch('/api/partners', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: 'Bearer ' + token
                            },
                            body: JSON.stringify({ receiver_id: perfil.user_id })
                          });
                          setPartnerStatus('enviada');
                          setEnviandoSolicitud(false);
                        }}
                        disabled={enviandoSolicitud}
                        style={{ padding: '11px 18px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                        {enviandoSolicitud ? '⏳ Enviando...' : '👥 Agregar Partner'}
                      </button>
                    )}

                    {partnerStatus === 'partner' && (
                      <button
                        onClick={() => window.location.href = '/partners'}
                        style={{ padding: '11px 18px', borderRadius: '12px', border: '2px solid #4ade80', background: '#4ade8015', color: '#4ade80', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                        👥 Son Partners · Chat →
                      </button>
                    )}

                    {partnerStatus === 'enviada' && (
                      <span style={{ padding: '11px 18px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-faint)', fontWeight: 700, fontSize: '13px' }}>
                        ⏳ Solicitud enviada
                      </span>
                    )}

                    {partnerStatus === 'recibida' && (
                      <button
                        onClick={async () => {
                          const { data: s } = await supabase.auth.getSession();
                          const token = s.session?.access_token;
                          const res = await fetch('/api/partners', { headers: { Authorization: 'Bearer ' + token } });
                          const data = await res.json();
                          const sol = data.solicitudes?.find((p: any) => p.partner.user_id === perfil?.user_id);
                          if (sol && token) {
                            await fetch('/api/partners', {
                              method: 'PATCH',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: 'Bearer ' + token
                              },
                              body: JSON.stringify({ partner_id: sol.id, action: 'accept' })
                            });
                            setPartnerStatus('partner');
                          }
                        }}
                        style={{ padding: '11px 18px', borderRadius: '12px', border: 'none', background: '#4ade80', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                        👥 Aceptar Partner
                      </button>
                    )}

                    <button
                      onClick={() => window.location.href = '/partners'}
                      style={{ padding: '11px 18px', borderRadius: '12px', border: '2px solid #38bdf8', background: 'transparent', color: '#38bdf8', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                      👥 Ir a Partners
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '24px' }}>
          <Stat emoji="🎴" label="Flashcards estudiadas" value={perfil.flashcards_estudiadas || 0} color="var(--gold)" />
          <Stat emoji="🎯" label="Precisión global" value={`${Math.round(perfil.precision_global || 0)}%`} color={(perfil.precision_global || 0) >= 80 ? '#4ade80' : (perfil.precision_global || 0) >= 60 ? '#f5c842' : '#ff4d6d'} />
          <Stat emoji="🔥" label="Racha actual" value={`${perfil.racha_actual || 0} días`} color="var(--red)" />
          <Stat emoji="⚡" label="Mejor racha" value={`${perfil.mejor_racha || 0} días`} color="var(--pink)" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '20px', alignItems: 'flex-start' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: 'linear-gradient(90deg, #a78bfa, #60a5fa, #4ade80)' }} />
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>🏅 Logros</h2>
                <span style={{ padding: '3px 10px', borderRadius: '20px', background: '#a78bfa22', color: '#38bdf8', fontSize: '12px', fontWeight: 800 }}>
                  {logrosOk} / {logros.length}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                {logros.map((logro, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '14px 8px',
                      borderRadius: '14px',
                      textAlign: 'center',
                      background: logro.ok ? '#a78bfa18' : 'var(--bg-secondary)',
                      border: `1px solid ${logro.ok ? '#a78bfa44' : 'var(--border-color)'}`,
                      opacity: logro.ok ? 1 : 0.35,
                    }}
                  >
                    <span style={{ fontSize: '26px', filter: logro.ok ? 'none' : 'grayscale(1)' }}>{logro.emoji}</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: logro.ok ? 'var(--text-primary)' : 'var(--text-faint)', lineHeight: 1.3 }}>{logro.label}</span>
                    {logro.ok && <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 900 }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '18px', border: '1px solid var(--gold-border)', overflow: 'hidden' }}>
              <div style={{ height: '3px', background: 'var(--gold)' }} />
              <div style={{ padding: '20px', textAlign: 'center' }}>
                <div style={{ fontSize: '52px', fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>{nivel}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>Nivel actual</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { label: 'XP', val: perfil.xp_total || 0, color: 'var(--gold)' },
                    { label: 'Ranking', val: `#${rank}`, color: rankColor },
                    { label: 'Racha', val: `${perfil.racha_actual || 0}🔥`, color: 'var(--red)' },
                    { label: 'Precisión', val: `${Math.round(perfil.precision_global || 0)}%`, color: '#4ade80' },
                  ].map((s, i) => (
                    <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '10px 6px' }}>
                      <div style={{ fontSize: '15px', fontWeight: 900, color: s.color }}>{s.val}</div>
                      <div style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600, marginTop: '2px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {perfil.created_at && (
              <div style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', padding: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '24px' }}>📅</span>
                <div>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 3px' }}>Miembro desde</p>
                  <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    {new Date(perfil.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
            )}

            {!esMiPerfil ? (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '14px', padding: '16px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>¿Quieres superar a {perfil.nombre.trim()}?</p>
                <button onClick={() => (window.location.href = '/materias')} style={{ width: '100%', padding: '11px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                  🚀 Ir a estudiar
                </button>
              </div>
            ) : (
              <button onClick={() => setShowEdit(true)} style={{ width: '100%', padding: '11px', borderRadius: '12px', border: '2px solid #38bdf8', background: 'transparent', color: '#38bdf8', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ✏️ Editar mi perfil
              </button>
            )}

            <button onClick={() => (window.location.href = '/')} style={{ width: '100%', padding: '11px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              🏆 Ver Leaderboard
            </button>
          </div>
        </div>

        {/* ── POSTS DEL USUARIO ── */}
        <div style={{ marginTop: '24px', background: 'var(--bg-card)', borderRadius: '18px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '3px', background: 'var(--gold)' }} />
          <div style={{ padding: '20px 24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🌍 Posts en la Comunidad
              <span style={{ fontSize: '12px', background: 'var(--gold)', color: '#000', padding: '2px 8px', borderRadius: '20px', fontWeight: 700 }}>
                {postsUsuario.length}
              </span>
            </h3>

            {cargandoPosts ? (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-faint)' }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
                <p style={{ margin: 0, fontSize: '13px' }}>Cargando posts...</p>
              </div>
            ) : postsUsuario.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-faint)' }}>
                <div style={{ fontSize: '40px', marginBottom: '8px' }}>📭</div>
                <p style={{ margin: 0, fontSize: '13px' }}>
                  {esMiPerfil ? 'Aún no has publicado nada en la comunidad' : `${perfil.nombre} aún no ha publicado nada`}
                </p>
                {esMiPerfil && (
                  <button
                    onClick={() => window.location.href = '/comunidad'}
                    style={{ marginTop: '12px', padding: '8px 18px', borderRadius: '8px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
                  >
                    🌍 Ir a Comunidad
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
                {postsUsuario.map((post: any) => {
                  const tipoEmoji: Record<string, string> = { apunte: '📝', flashcards: '🎴', quiz: '🤓', post: '💬' };
                  const tipoColor: Record<string, string> = { apunte: 'var(--blue)', flashcards: 'var(--gold)', quiz: '#a78bfa', post: '#34d399' };
                  const emoji = tipoEmoji[post.tipo] || '📄';
                  const color = tipoColor[post.tipo] || 'var(--gold)';

                  return (
                    <div
                      key={post.id}
                      onClick={() => window.location.href = `/comunidad/${post.id}`}
                      style={{
                        background: 'var(--bg-secondary)',
                        borderRadius: '14px',
                        border: '1px solid var(--border-color)',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = color;
                        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)';
                        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                      }}
                    >
                      {post.portada_url ? (
                        <div style={{ width: '100%', paddingBottom: '45%', position: 'relative', overflow: 'hidden', background: 'var(--bg-card)' }}>
                          <img
                            src={post.portada_url}
                            alt={post.titulo}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </div>
                      ) : (
                        <div style={{
                          height: '80px',
                          background: `linear-gradient(135deg, ${color}22, ${color}44)`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '36px',
                        }}>
                          {post.materia_emoji || emoji}
                        </div>
                      )}

                      <div style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                          <span style={{ background: color, color: '#000', padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 800 }}>
                            {emoji} {post.tipo}
                          </span>
                          {post.materia_nombre && (
                            <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 600 }}>
                              {post.materia_nombre}
                            </span>
                          )}
                        </div>

                        <p style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.3,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {post.titulo}
                        </p>

                        <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--text-faint)' }}>
                          <span>👁️ {post.views || 0}</span>
                          <span>❤️ {post.likes_count || 0}</span>
                          <span>📖 {post.estudiados || 0}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: '24px', background: 'var(--bg-card)', borderRadius: '16px', padding: '20px 24px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>🔗 Comparte tu perfil</p>
            <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '420px' }}>
              {urlPublica}
            </p>
          </div>

          <button onClick={copiarLink} style={{ padding: '10px 24px', borderRadius: '10px', border: 'none', background: copiado ? '#4ade80' : 'var(--gold)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {copiado ? '✅ ¡Copiado!' : '📋 Copiar link'}
          </button>
        </div>
      </div>
    </div>
  );
}
