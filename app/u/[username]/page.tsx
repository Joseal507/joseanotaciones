'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useIdioma } from '../../../hooks/useIdioma';
import { getSession } from 'next-auth/react';
import { getRango, getProgresoRango, LOGROS, getLogrosObtenidos, LogroStats, getLevelFromXp, getXpInCurrentLevel, getXpNeededForNextLevel } from '../../../lib/xpSystem';
import MarcoAvatar from '../../../components/MarcoAvatar';
import RangoDisplay from '../../../components/RangoDisplay';
import PlayerCard from '../../../components/PlayerCard';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

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
  quizzes_completados?: number;
  created_at?: string;
  visible_leaderboard?: boolean;
}

const CARRERAS = [
  'Ingeniería en Sistemas / Informática','Ingeniería Civil','Ingeniería Mecánica','Ingeniería Eléctrica',
  'Medicina','Enfermería','Odontología','Psicología','Derecho','Administración de Empresas',
  'Contaduría / Contabilidad','Economía','Arquitectura','Diseño Gráfico','Marketing / Publicidad',
  'Comunicación Social','Educación / Pedagogía','Biología','Química','Física','Matemáticas',
  'Filosofía','Historia','Sociología','Trabajo Social','Nutrición / Dietética','Fisioterapia',
  'Farmacia','Veterinaria','Agronomía','Otra carrera',
];

const UNIVERSIDADES = [
  'ULAT','USMA','UTP','UP (Universidad de Panamá)','UDELAS','ISAE Universidad',
  'Universidad Latina de Panamá','Columbus University','Universidad del Istmo','UMECIT',
  'Harvard','MIT','Stanford','Notre Dame','IE University','UM (Universidad de Miami)',
  'TEC de Monterrey','MU','Otra universidad',
];

const ESCUELAS_PUBLICAS = [
  'Instituto Nacional (El Nacio)','Artes y Oficios Melchor Lasso de la Vega',
  'Instituto Fermín Naudeau','Instituto Profesional y Técnico de Panamá (IPTP)',
  'Escuela Secundaria Pedro Pablo Sánchez','Colegio Secundario de Panamá',
  'Escuela Secundaria de la Chorrera','Escuela Secundaria de Chitré','Colegio Rubiano',
];

const ESCUELAS_PRIVADAS = [
  'Colegio Brader','AIP (Academia Internacional de Panamá)','Balboa Academy','Metropolitan School',
  'International School of Panama (ISP)','Colegio de Panamá (ECP)','Colegio Real de Panamá (CRP)',
  'Colegio San Agustín','Oxford School','Colegio Javier','Colegio La Salle','Colegio De La Salle',
  'Colegio Isaac Rabin','Colegio Hebreo','Instituto Episcopal San Cristóbal',
  'Colegio Internacional de María Inmaculada','Saint Mary School','Colegio Internacional SEK Panamá',
  "King's College",'Colegio San Viator','Instituto Panamericano (IPA)','Colegio Las Esclavas',
  'Colegio María Inmaculada','Colegio Madre Laura','Saint John School',
  'Colegio Bilingüe Punta Pacífica','Colegio Internacional de Panamá','Colegio Alberto Einstein',
  'Boston School International','St. George School','Otra escuela',
];

const GENEROS = ['hombre', 'mujer', 'otro'];

const getNivel = (xp: number) => getLevelFromXp(xp || 0);
const getXpEnNivel = (xp: number) => getXpInCurrentLevel(xp || 0);
const getXpParaSiguiente = (xp: number) => getXpNeededForNextLevel(xp || 0);
const getRankMedal = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;
const getRankColor = (r: number) => r === 1 ? 'var(--gold)' : r === 2 ? '#c0c0c0' : r === 3 ? '#cd7f32' : '#a78bfa';

const getTitulo = (nivel: number) => {
  if (nivel >= 20) return { titulo: 'Maestro del Estudio', color: 'var(--gold)' };
  if (nivel >= 15) return { titulo: 'Estudioso Élite', color: '#38bdf8' };
  if (nivel >= 10) return { titulo: 'Estudiante Pro', color: '#4ade80' };
  if (nivel >= 5)  return { titulo: 'En Progreso', color: '#60a5fa' };
  return { titulo: 'Nuevo Estudiante', color: '#94a3b8' };
};

const calcularLogrosPublicos = (perfil: PerfilPublico): LogroStats => ({
  xpTotal: perfil.xp_total || 0,
  flashcardsEstudiadas: perfil.flashcards_estudiadas || 0,
  quizzesCompletados: 0,
  rachaActual: perfil.racha_actual || 0,
  mejorRacha: perfil.mejor_racha || 0,
  precision: perfil.precision_global || 0,
  materiasCreadas: 0,
  postsCreados: 0,
  rangoId: getRango(perfil.xp_total || 0).id,
});

const generoEmoji: Record<string, string> = {
  hombre: '👦', mujer: '👧', otro: '',
};

// ═══════════════════════════════════════════════════════════════════════════
// EDIT MODAL
// ═══════════════════════════════════════════════════════════════════════════
function EditModal({ perfil, onSave, onClose }: {
  perfil: PerfilPublico;
  onSave: (data: Partial<PerfilPublico>) => Promise<void>;
  onClose: () => void;
}) {
  const { tr, idioma } = useIdioma();
  const [nombre, setNombre] = useState(perfil.nombre?.trim() || '');
  const [descripcion, setDescripcion] = useState(perfil.descripcion || '');
  const [tipo, setTipo] = useState(perfil.tipo_estudiante || '');
  const [genero, setGenero] = useState(perfil.genero || '');

  const [universidad, setUniversidad] = useState(perfil.tipo_estudiante === 'universitario' ? (perfil.universidad || '') : '');
  const [uniCustom, setUniCustom] = useState('');
  const [carrera, setCarrera] = useState(perfil.carrera || '');
  const [carreraCustom, setCarreraCustom] = useState('');

  const [escuela, setEscuela] = useState(perfil.tipo_estudiante === 'escuela' ? (perfil.universidad || '') : '');
  const [escuelaCustom, setEscuelaCustom] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [fotoPreview, setFotoPreview] = useState(perfil.avatar_url || '');
  const [fotoBase64, setFotoBase64] = useState('');
  const fotoRef = useRef<HTMLInputElement>(null);

  const universidadFinal = universidad === 'Otra universidad' ? uniCustom : universidad;
  const carreraFinal = carrera === 'Otra carrera' ? carreraCustom : carrera;
  const escuelaFinal = escuela === 'Otra escuela' ? escuelaCustom : escuela;

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
    if (!nombre.trim()) { setError('El nombre no puede estar vacío'); return; }
    setGuardando(true);
    setError('');
    try {
      const payload: Partial<PerfilPublico> = {
        nombre, descripcion, genero,
        tipo_estudiante: tipo,
        carrera: tipo === 'universitario' ? carreraFinal : undefined,
        universidad: tipo === 'universitario' ? universidadFinal : tipo === 'escuela' ? escuelaFinal : undefined,
      };
      if (fotoBase64) payload.avatar_url = fotoBase64;
      await onSave(payload);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(6px)',
      zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      animation: 'modalFadeUp 0.25s ease',
    }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 16,
        maxWidth: 540, width: '100%',
        boxShadow: '6px 7px 0 var(--text-primary), 0 16px 50px rgba(0,0,0,0.45)',
        maxHeight: '92vh',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        transform: 'rotate(-0.5deg)',
        position: 'relative',
        animation: 'modalPopUp 0.4s cubic-bezier(.34,1.4,.64,1)',
      }}>
        {/* Cinta scotch */}
        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-4deg)',
          width: 90, height: 18,
          background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
          border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          zIndex: 5,
        }}/>

        {/* Header */}
        <div style={{
          background: 'var(--gold)',
          padding: '12px 28px',
          borderBottom: '2px solid var(--text-primary)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <h2 style={{
            fontFamily: HAND, fontSize: 26, fontWeight: 900,
            color: '#000', margin: 0, lineHeight: 1.1,
            transform: 'rotate(-0.8deg)', display: 'inline-block',

          }}>
            ✏️ {tr('editarPerfilPublico')}
          </h2>
          <button onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              color: '#000', fontFamily: HAND, fontSize: 22, fontWeight: 900,
              cursor: 'pointer', padding: 4,
            }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '20px 28px', overflowY: 'auto', flex: 1 }}>
          <p style={{
            fontFamily: BODY, fontSize: 15,
            color: 'var(--text-muted)', margin: '0 0 18px', textAlign: 'center',
          }}>
            ~ {tr('editarPerfilDesc')} ~
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Foto */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div onClick={() => fotoRef.current?.click()}
                style={{
                  width: 96, height: 96, borderRadius: '50%',
                  background: fotoPreview ? 'transparent' : 'var(--gold)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: HAND, fontSize: 36, fontWeight: 900, color: '#000',
                  overflow: 'hidden', cursor: 'pointer',
                  border: '3px solid var(--text-primary)',
                  boxShadow: '3px 4px 0 var(--gold)',
                  transform: 'rotate(-4deg)',
                  transition: 'all 0.2s',
                }}>
                {fotoPreview
                  ? <img src={fotoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : nombre.trim().charAt(0).toUpperCase() || '?'}
              </div>
              <div style={{ textAlign: 'center' }}>
                <button type="button" onClick={() => fotoRef.current?.click()}
                  style={{
                    padding: '6px 14px', borderRadius: 8,
                    border: '2px dashed var(--gold)',
                    background: 'transparent', color: 'var(--gold)',
                    fontFamily: HAND, fontSize: 16, fontWeight: 800,
                    cursor: 'pointer',
                    transform: 'rotate(-1deg)',
                  }}>
                  📸 {tr('cambiarFotoBtn')}
                </button>
                {fotoPreview && fotoPreview !== perfil.avatar_url && (
                  <p style={{
                    fontFamily: HAND, fontSize: 14,
                    color: '#16a34a', margin: '4px 0 0', fontWeight: 700,
                  }}>~ ✓ {tr('nuevaFotoLista')} ~</p>
                )}
                {fotoBase64 && (
                  <button type="button" onClick={() => { setFotoPreview(perfil.avatar_url || ''); setFotoBase64(''); }}
                    style={{
                      display: 'block', margin: '4px auto 0',
                      background: 'none', border: 'none',
                      color: 'var(--text-faint)',
                      fontFamily: BODY, fontSize: 14,
                      cursor: 'pointer',
                    }}>
                    ~ {tr('cancelarCambio')} ~
                  </button>
                )}
              </div>
              <input ref={fotoRef} type="file" accept="image/*" onChange={handleFoto} style={{ display: 'none' }} />
            </div>

            <Field label={tr('nombre')}>
              <Input value={nombre} onChange={(e: any) => setNombre(e.target.value)} placeholder={tr('tuNombre')} />
            </Field>

            <Field label={`${tr('descripcion')} (${descripcion.length}/300)`}>
              <textarea value={descripcion} onChange={(e: any) => setDescripcion(e.target.value.slice(0, 300))}
                placeholder={tr('onbMetaPlaceholder')} rows={3}
                style={{
                  width: '100%', padding: '11px 14px',
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
                {GENEROS.map((g, i) => {
                  const active = genero === g;
                  return (
                    <button key={g} onClick={() => setGenero(g)}
                      style={{
                        flex: 1, padding: '10px',
                        borderRadius: 10,
                        border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? 'var(--gold)' : 'var(--border-color)'}`,
                        background: active ? 'color-mix(in srgb,var(--gold) 18%,transparent)' : 'var(--bg-secondary)',
                        color: active ? 'var(--gold)' : 'var(--text-muted)',
                        fontFamily: HAND, fontSize: 16, fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: active ? '2px 3px 0 var(--gold)' : 'none',
                        transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                        textTransform: 'capitalize',
                      }}>
                      {generoEmoji[g]} {g}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label={tr('tipoEstudiante')}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { id: 'escuela',       label: `🏫 ${tr('escuela')}` },
                  { id: 'universitario', label: `🎓 ${tr('universitario')}` },
                  { id: 'profesional',   label: `💼 ${tr('profesional')}` },
                  { id: 'autodidacta',   label: `🧠 ${tr('autodidacta')}` },
                ].map((t, i) => {
                  const active = tipo === t.id;
                  return (
                    <button key={t.id} onClick={() => setTipo(t.id)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 10,
                        border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? 'var(--blue)' : 'var(--border-color)'}`,
                        background: active ? 'color-mix(in srgb,var(--blue) 18%,transparent)' : 'var(--bg-secondary)',
                        color: active ? 'var(--blue)' : 'var(--text-muted)',
                        fontFamily: HAND, fontSize: 16, fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: active ? '2px 3px 0 var(--blue)' : 'none',
                        transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                      }}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            {tipo === 'universitario' && (
              <>
                <Field label={`🏫 ${tr('universidad')}`}>
                  <Select value={universidad} onChange={(e: any) => setUniversidad(e.target.value)}>
                    <option value="">{tr('sinEspecificarOpt')}</option>
                    {UNIVERSIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </Select>
                  {universidad === 'Otra universidad' && (
                    <div style={{ marginTop: 8 }}>
                      <Input value={uniCustom} onChange={(e: any) => setUniCustom(e.target.value)} placeholder={tr('escribeUniversidad')} />
                    </div>
                  )}
                </Field>
                <Field label={`📚 ${tr('carreraMajor')}`}>
                  <Select value={carrera} onChange={(e: any) => setCarrera(e.target.value)}>
                    <option value="">{tr('sinEspecificarOpt')}</option>
                    {CARRERAS.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                  {carrera === 'Otra carrera' && (
                    <div style={{ marginTop: 8 }}>
                      <Input value={carreraCustom} onChange={(e: any) => setCarreraCustom(e.target.value)} placeholder={tr('escribeCarrera')} />
                    </div>
                  )}
                </Field>
              </>
            )}

            {tipo === 'escuela' && (
              <Field label={`🏫 ${tr('escuela')}`}>
                <Select value={escuela} onChange={(e: any) => setEscuela(e.target.value)}>
                  <option value="">{tr('sinEspecificarOpt')}</option>
                  <optgroup label={`🏛️ ${idioma === 'en' ? 'Public' : 'Públicas'}`}>
                    {ESCUELAS_PUBLICAS.map(e => <option key={e} value={e}>{e}</option>)}
                  </optgroup>
                  <optgroup label={`🏫 ${idioma === 'en' ? 'Private' : 'Particulares'}`}>
                    {ESCUELAS_PRIVADAS.map(e => <option key={e} value={e}>{e}</option>)}
                  </optgroup>
                </Select>
                {escuela === 'Otra escuela' && (
                  <div style={{ marginTop: 8 }}>
                    <Input value={escuelaCustom} onChange={(e: any) => setEscuelaCustom(e.target.value)} placeholder={tr('escribeEscuela')} />
                  </div>
                )}
              </Field>
            )}

            {(tipo === 'profesional' || tipo === 'autodidacta') && (
              <div style={{
                padding: '12px 14px',
                background: 'var(--bg-secondary)',
                border: '2px dashed var(--border-color)',
                borderRadius: 10,
                transform: 'rotate(-0.3deg)',
              }}>
                <p style={{
                  fontFamily: HAND, fontSize: 16,
                  color: 'var(--text-muted)', margin: 0,
                }}>
                  ~ {tipo === 'profesional' ? `💼 ${tr('onbProfesionalInfo')}` : `🧠 ${tr('onbAutodidactaInfo')}`} ~
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 28px',
          borderTop: '2px dashed var(--border-color)',
          flexShrink: 0,
        }}>
          {error && (
            <div style={{
              padding: '8px 12px',
              background: 'color-mix(in srgb,var(--red) 16%,transparent)',
              border: '2px solid var(--red)',
              borderRadius: 8,
              marginBottom: 12,
              transform: 'rotate(-0.3deg)',
            }}>
              <p style={{
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                color: 'var(--red)', margin: 0,
              }}>⚠️ {error}</p>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleGuardar} disabled={guardando}
              style={{
                flex: 2, padding: 12,
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: guardando ? 'var(--bg-secondary)' : 'var(--gold)',
                color: guardando ? 'var(--text-faint)' : '#000',
                fontFamily: HAND, fontSize: 19, fontWeight: 800,
                cursor: guardando ? 'not-allowed' : 'pointer',
                boxShadow: guardando ? 'none' : '3px 4px 0 var(--text-primary)',
                transform: 'rotate(-1deg)',
              }}>
              {guardando ? '⏳ ' + tr('guardandoBtn') : '💾 ' + tr('guardarCambiosBtn')}
            </button>
            <button onClick={onClose}
              style={{
                flex: 1, padding: 12,
                borderRadius: 12,
                border: '2.5px dashed var(--text-faint)',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontFamily: HAND, fontSize: 18, fontWeight: 800,
                cursor: 'pointer',
                transform: 'rotate(1deg)',
              }}>
              ✕ {tr('cancelar')}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes modalFadeUp { from{opacity:0} to{opacity:1} }
        @keyframes modalPopUp {
          0% { transform: rotate(0deg) scale(0.85); opacity: 0; }
          60% { transform: rotate(-0.5deg) scale(1.02); opacity: 1; }
          100% { transform: rotate(-0.5deg) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PERFIL PÚBLICO PAGE
// ═══════════════════════════════════════════════════════════════════════════
export default function PerfilPublicoPage() {
  const router = useRouter();
  const { tr, idioma } = useIdioma();
  const params = useParams();
  const slug = decodeURIComponent(params.username as string);

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [rank, setRank] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [miUserId, setMiUserId] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [partnerStatus, setPartnerStatus] = useState<'ninguno'|'partner'|'enviada'|'recibida'>('ninguno');
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false);
  const [postsUsuario, setPostsUsuario] = useState<any[]>([]);
  const [cargandoPosts, setCargandoPosts] = useState(false);

  useEffect(() => {
    getSession().then((session: any) => {
      setMiUserId(session?.user?.id || '');
    });
  }, []);

  const cargarPostsUsuario = async (userId: string) => {
    setCargandoPosts(true);
    try {
      const res = await fetch(`/api/comunidad/posts?ownerId=${userId}&viewerId=${miUserId || ''}&tipo=all`);
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

  useEffect(() => { if (slug) cargarPerfil(); }, [slug]);

  useEffect(() => {
    const checkPartner = async () => {
      if (!miUserId || !perfil || miUserId === perfil.user_id) return;
      const res = await fetch('/api/partners', { credentials: 'same-origin' });
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
    const session: any = await getSession();
    if (!session?.user?.id) throw new Error('No autenticado');
    const res = await fetch('/api/perfil-publico', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(cambios),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Error al guardar');
    setPerfil(prev => prev ? { ...prev, ...cambios } : prev);
    if (cambios.avatar_url) {
      try {
        const { getSettings, saveSettings } = await import('../../../lib/settings');
        const s = getSettings();
        saveSettings({ ...s, fotoPerfil: cambios.avatar_url });
      } catch {}
    }
    if (cambios.nombre) {
      // NextAuth toma el nombre desde el perfil D1 en esta migración.
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
      <div style={{
        minHeight: '100vh', background: 'var(--bg-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16, padding: 20,
      }}>
        <style>{`@keyframes spinUp{to{transform:rotate(360deg)}}`}</style>
        <div style={{
          width: 56, height: 56,
          border: '3px solid var(--gold)',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spinUp 0.8s linear infinite',
        }} />
        <p style={{
          fontFamily: HAND, fontSize: 22,
          color: 'var(--text-muted)', margin: 0,
        }}>~ {tr('cargandoPerfil')} ~</p>
      </div>
    );
  }

  if (error || !perfil) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16, padding: 20, textAlign: 'center',
      }}>
        <div style={{
          background: 'var(--bg-card)',
          border: '2.5px dashed var(--border-color)',
          borderRadius: 14,
          padding: '40px 32px',
          maxWidth: 420,
          transform: 'rotate(-0.5deg)',
        }}>
          <div style={{ fontSize: 64 }}>🔒</div>
          <h2 style={{
            fontFamily: HAND, fontSize: 28, fontWeight: 900,
            color: 'var(--text-primary)', margin: '8px 0 4px',
            transform: 'rotate(-1deg)', display: 'inline-block',
          }}>{tr('perfilNoDisponible')}</h2>
          <p style={{
            fontFamily: HAND, fontSize: 17,
            color: 'var(--text-muted)', margin: '4px 0 20px',
          }}>~ {error || tr('perfilPrivado')} ~</p>
          <button onClick={() => ((() => {
                try { (window as any).__showNavLoader?.('/'); } catch {}
                const _fb = setTimeout(() => { if (window.location.pathname !== '/') window.location.href = '/'; }, 700);
                try { router.push('/'); setTimeout(() => clearTimeout(_fb), 750); }
                catch { clearTimeout(_fb); window.location.href = '/'; }
              })())}
            style={{
              padding: '12px 26px',
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--gold)', color: '#000',
              fontFamily: HAND, fontSize: 19, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 4px 0 var(--text-primary)',
              transform: 'rotate(-1deg)',
            }}>
            ← {tr('volver')}
          </button>
        </div>
      </div>
    );
  }

  const nivel = getNivel(perfil.xp_total);
  const xpEnNivel = getXpEnNivel(perfil.xp_total);
  const xpParaSiguiente = getXpParaSiguiente(perfil.xp_total);
  const rango = getRango(perfil.xp_total || 0);
  const { titulo, color: tituloColor } = getTitulo(nivel);
  const rankColor = getRankColor(rank);
  const esMiPerfil = miUserId === perfil.user_id;
  const urlPublica = typeof window !== 'undefined' ? `${window.location.origin}/u/${perfil.user_id}` : '';

  const logroStatsPublicos = calcularLogrosPublicos(perfil);
  const logrosObtenidosReal = getLogrosObtenidos(logroStatsPublicos);
  const logrosVisibles = LOGROS.filter(l => !l.secreto || l.condicion(logroStatsPublicos));
  const logrosOk = logrosObtenidosReal.length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>
      {showEdit && <EditModal perfil={perfil} onSave={handleSave} onClose={() => setShowEdit(false)} />}

      {/* HEADER */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
        backdropFilter: 'blur(14px)',
        borderBottom: '2.5px solid var(--text-primary)',
        padding: '12px 30px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 12, flexWrap: 'wrap',
      }}>
        <button onClick={() => ((() => {
                try { (window as any).__showNavLoader?.('/'); } catch {}
                const _fb = setTimeout(() => { if (window.location.pathname !== '/') window.location.href = '/'; }, 700);
                try { router.push('/'); setTimeout(() => clearTimeout(_fb), 750); }
                catch { clearTimeout(_fb); window.location.href = '/'; }
              })())}
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
          }}>
          ← StudyAL
        </button>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {esMiPerfil && (
            <>
              <HeaderBtn onClick={() => setShowEdit(true)} color="#38bdf8" rot={-1}>
                ✏️ {tr('editarPerfil')}
              </HeaderBtn>
              <HeaderBtn onClick={() => (((window as any).__showNavLoader?.('/perfil'), router.push('/perfil')))} color="var(--blue)" rot={1}>
                📊 {tr('misStatsBtn')}
              </HeaderBtn>
            </>
          )}

          <HeaderBtn onClick={copiarLink} color={copiado ? '#4ade80' : 'var(--text-muted)'} rot={-1}>
            {copiado ? `✅ ${tr('copiado')}` : `🔗 ${tr('compartir')}`}
          </HeaderBtn>

          {!esMiPerfil && miUserId && (
            <>
              {partnerStatus === 'ninguno' && (
                <button onClick={async () => {
                  setEnviandoSolicitud(true);
                  if (!perfil) return;
                  await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ receiver_id: perfil.user_id }) });
                  setPartnerStatus('enviada');
                  setEnviandoSolicitud(false);
                }} disabled={enviandoSolicitud}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 10,
                    border: '2.5px solid var(--text-primary)',
                    background: 'var(--gold)', color: '#000',
                    fontFamily: HAND, fontSize: 17, fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '2px 3px 0 var(--text-primary)',
                    transform: 'rotate(1.5deg)',
                  }}>
                  {enviandoSolicitud ? '⏳' : `👥 ${tr('agregarPartner')}`}
                </button>
              )}
              {partnerStatus === 'partner' && (
                <HeaderBtn onClick={() => ((window as any).__showNavLoader?.('/partners'), router.push('/partners'))} color="#4ade80" rot={1}>
                  👥 {tr('partners')}
                </HeaderBtn>
              )}
              {partnerStatus === 'enviada' && (
                <span style={{
                  padding: '8px 16px',
                  borderRadius: 10,
                  border: '2.5px dashed var(--text-faint)',
                  color: 'var(--text-faint)',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,

                  transform: 'rotate(1deg)',
                }}>
                  ⏳ {tr('solicitudEnviada')}
                </span>
              )}
              {partnerStatus === 'recibida' && (
                <button onClick={async () => {
                  const res = await fetch('/api/partners', { credentials: 'same-origin' });
                  const data = await res.json();
                  const sol = data.solicitudes?.find((p: any) => p.partner.user_id === perfil?.user_id);
                  if (sol) {
                    await fetch('/api/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ partner_id: sol.id, action: 'accept' }) });
                    setPartnerStatus('partner');
                  }
                }} style={{
                  padding: '8px 16px',
                  borderRadius: 10,
                  border: '2.5px solid var(--text-primary)',
                  background: '#4ade80', color: '#000',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '2px 3px 0 var(--text-primary)',
                  transform: 'rotate(-1.5deg)',
                }}>
                  ✅ {tr('aceptarPartner')}
                </button>
              )}
            </>
          )}
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

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 48px' }}>

        {/* GRID HERO */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 320px',
          gap: 24, marginBottom: 22,
          alignItems: 'flex-start',
        }}>
          {/* CARD PRINCIPAL */}
          <div style={{
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 16,
            boxShadow: `5px 6px 0 ${rankColor}`,
            transform: 'rotate(-0.4deg)',
            overflow: 'hidden',
            position: 'relative',
          }}>
            {/* Cinta scotch */}
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(-3deg)',
              width: 90, height: 18,
              background: `color-mix(in srgb,${rankColor} 55%,transparent)`,
              border: `1px solid color-mix(in srgb,${rankColor} 30%,transparent)`,
              boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
              zIndex: 5,
            }}/>

            {/* Banner ranking */}
            <div style={{
              background: `linear-gradient(135deg, ${rankColor} 0%, ${tituloColor} 100%)`,
              padding: '14px 22px',
              borderBottom: '2px solid var(--text-primary)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: 12, flexWrap: 'wrap',
            }}>
              {esMiPerfil ? (
                <button onClick={() => setShowEdit(true)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 8,
                    border: '2px solid var(--text-primary)',
                    background: 'rgba(0,0,0,0.3)',
                    color: '#fff',
                    fontFamily: HAND, fontSize: 16, fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '2px 2px 0 var(--text-primary)',
                    transform: 'rotate(-2deg)',
                  }}>
                  ✏️ {tr('editarPerfil')}
                </button>
              ) : <div />}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontFamily: HAND, fontSize: 14, fontWeight: 800,
                    color: 'rgba(255,255,255,0.85)',
                  }}>
                    {tr('rankingGlobal')}
                  </div>
                  <div style={{
                    fontFamily: HAND, fontSize: 22, fontWeight: 900,
                    color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.35)',
                  }}>
                    {rank} {tr('de')} {totalUsers}
                  </div>
                </div>
                <span style={{
                  fontSize: 38,
                  filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
                  transform: 'rotate(-5deg)', display: 'inline-block',
                }}>{getRankMedal(rank)}</span>
              </div>
            </div>

            <div style={{ padding: '20px 28px 24px', position: 'relative' }}>
              {/* Margen rojo cuaderno */}
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: 50, width: 1.5,
                background: '#ef4444', opacity: 0.2,
                pointerEvents: 'none',
              }}/>

              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ transform: 'rotate(-3deg)' }}>
                  <MarcoAvatar xpTotal={perfil.xp_total || 0} fotoPerfil={perfil.avatar_url} nombre={perfil.nombre} size={96} />
                </div>

                <div style={{ flex: 1, minWidth: 0, paddingBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <h1 style={{
                      fontFamily: HAND, fontSize: 34, fontWeight: 900,
                      color: 'var(--text-primary)', margin: 0, lineHeight: 1,
                      transform: 'rotate(-1deg)', display: 'inline-block',
                    }}>
                      {perfil.nombre.trim()}
                    </h1>
                    {perfil.genero && <span style={{ fontSize: 22 }}>{generoEmoji[perfil.genero] || ''}</span>}
                    {esMiPerfil && (
                      <span style={{
                        padding: '3px 10px', borderRadius: 8,
                        background: 'var(--gold)', color: '#000',
                        border: '2px solid var(--text-primary)',
                        boxShadow: '2px 2px 0 var(--text-primary)',
                        fontFamily: HAND, fontSize: 14, fontWeight: 800,
                        transform: 'rotate(3deg)',
                      }}>
                        {tr('tu')}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <Badge color={tituloColor} rot={-1.5}>⭐ {titulo}</Badge>
                    <Badge color="var(--gold)" rot={1.5}>Nivel {nivel}</Badge>
                    {logrosOk > 0 && <Badge color="#a78bfa" rot={-1}>🏅 {logrosOk} {tr('logros')}</Badge>}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {perfil.carrera && <SmallBadge>🎓 {perfil.carrera}</SmallBadge>}
                    {perfil.universidad && <SmallBadge>🏫 {perfil.universidad}</SmallBadge>}
                    {perfil.tipo_estudiante && (
                      <SmallBadge>
                        {perfil.tipo_estudiante === 'universitario' ? '🎓' :
                         perfil.tipo_estudiante === 'escuela' ? '🏫' :
                         perfil.tipo_estudiante === 'profesional' ? '💼' : '🧠'} {perfil.tipo_estudiante}
                      </SmallBadge>
                    )}
                  </div>
                </div>
              </div>

              {perfil.descripcion ? (
                <div style={{
                  background: 'var(--bg-secondary)',
                  border: '2px dashed var(--border-color)',
                  borderRadius: 12,
                  padding: '14px 18px',
                  marginBottom: 16,
                  transform: 'rotate(-0.3deg)',
                }}>
                  <p style={{
                    fontFamily: HAND, fontSize: 18,
                    color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5,
                  }}>
                    "{perfil.descripcion}"
                  </p>
                </div>
              ) : esMiPerfil ? (
                <button onClick={() => setShowEdit(true)}
                  style={{
                    width: '100%', padding: 14,
                    borderRadius: 12,
                    border: '2.5px dashed var(--border-color)',
                    background: 'transparent', color: 'var(--text-faint)',
                    fontFamily: HAND, fontSize: 17,
                    cursor: 'pointer', marginBottom: 16,
                    transform: 'rotate(-0.3deg)',
                  }}>
                  + ~ añade una descripción a tu perfil ~
                </button>
              ) : null}

              {/* Card XP */}
              <div style={{
                background: 'var(--bg-secondary)',
                border: '2px dashed var(--gold)',
                borderRadius: 12,
                padding: '14px 18px',
                transform: 'rotate(0.3deg)',
              }}>
                <div style={{ marginBottom: 12 }}>
                  <RangoDisplay xpTotal={perfil.xp_total || 0} size="sm" mostrarProgreso />
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 8, flexWrap: 'wrap', gap: 8,
                }}>
                  <span style={{
                    fontFamily: HAND, fontSize: 17, fontWeight: 800,
                    color: 'var(--gold)',
                  }}>
                    ⚡ {perfil.xp_total || 0} XP Total
                  </span>
                  <span style={{
                    fontFamily: BODY, fontSize: 14,
                    color: 'var(--text-faint)',
                  }}>
                    ~ {xpEnNivel}/{xpParaSiguiente} XP → Nivel {nivel + 1} ~
                  </span>
                </div>
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1.5px solid var(--text-primary)',
                  borderRadius: 5, height: 10,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${Math.min(100, Math.round((xpEnNivel / xpParaSiguiente) * 100))}%`,
                    height: '100%',
                    background: rango.marcoGradient,
                    borderRadius: 3,
                    transition: 'width 1.2s ease',
                  }} />
                </div>
              </div>
            </div>
          </div>

          {/* PLAYER CARD */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PlayerCard stats={{
              nombre: perfil.nombre.trim(),
              xpTotal: perfil.xp_total || 0,
              flashcards: perfil.flashcards_estudiadas || 0,
              precision: Math.round(perfil.precision_global || 0),
              rachaActual: perfil.racha_actual || 0,
              mejorRacha: perfil.mejor_racha || 0,
              rank, totalUsers,
              avatar: perfil.avatar_url,
              universidad: perfil.universidad,
              carrera: perfil.carrera,
              userId: perfil.user_id,
              quizzes: perfil.quizzes_completados || 0,
            }} />
          </div>
        </div>

        {/* STATS */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 14, marginBottom: 22,
        }}>
          {[
            { emoji: '🎴', label: tr('flashcardsEstudiadas'), value: perfil.flashcards_estudiadas || 0, color: 'var(--gold)', rot: -1.5 },
            { emoji: '🎯', label: tr('precisionGlobal'),       value: `${Math.round(perfil.precision_global || 0)}%`, color: (perfil.precision_global || 0) >= 80 ? '#4ade80' : (perfil.precision_global || 0) >= 60 ? 'var(--gold)' : 'var(--red)', rot: 1.5 },
            { emoji: '🔥', label: tr('rachaActual'),            value: `${perfil.racha_actual || 0} ${tr('dias')}`, color: 'var(--red)', rot: -1 },
            { emoji: '⚡', label: tr('mejorRachaLabel'),         value: `${perfil.mejor_racha || 0} ${tr('dias')}`, color: 'var(--pink)', rot: 1 },
          ].map((s, i) => (
            <div key={i} style={{
              background: 'var(--bg-card)',
              border: '2.5px solid var(--text-primary)',
              borderRadius: 12,
              padding: '18px 14px', textAlign: 'center',
              boxShadow: `3px 4px 0 ${s.color}`,
              transform: `rotate(${s.rot}deg)`,
              transition: 'transform 0.25s',
            }}
              onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) translateY(-2px)'}
              onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${s.rot}deg)`}
            >
              <div style={{ fontSize: 26, marginBottom: 4 }}>{s.emoji}</div>
              <div style={{
                fontFamily: HAND, fontSize: 30, fontWeight: 900,
                color: s.color, lineHeight: 1,
              }}>{s.value}</div>
              <div style={{
                fontFamily: BODY, fontSize: 13,
                color: 'var(--text-faint)', marginTop: 4,
              }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* LOGROS + LATERAL */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 280px',
          gap: 18, alignItems: 'flex-start',
        }}>
          {/* LOGROS */}
          <NotebookCard color="#a78bfa" emoji="🏅" title={tr('logros')} rot={-0.4} extra={
            <span style={{
              fontFamily: HAND, fontSize: 14, fontWeight: 800,
              background: 'var(--bg-card)', color: '#a78bfa',
              border: '2px solid var(--text-primary)',
              boxShadow: '1px 2px 0 var(--text-primary)',
              padding: '2px 10px', borderRadius: 6,
              transform: 'rotate(3deg)', display: 'inline-block',
            }}>
              {logrosOk} / {logrosVisibles.length}
            </span>
          }>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
            }}>
              {logrosVisibles.map((logro, i) => {
                const obtenido = logro.condicion(logroStatsPublicos);
                return (
                  <div key={i}
                    title={obtenido ? logro.recompensa : logro.descripcion}
                    style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', gap: 6,
                      padding: '14px 8px',
                      borderRadius: 12,
                      background: obtenido ? logro.color + '18' : 'var(--bg-secondary)',
                      border: `2px ${obtenido ? 'solid' : 'dashed'} ${obtenido ? logro.color : 'var(--border-color)'}`,
                      opacity: obtenido ? 1 : 0.4,
                      cursor: 'default', textAlign: 'center',
                      boxShadow: obtenido ? `2px 3px 0 ${logro.color}` : 'none',
                      transform: obtenido
                        ? `rotate(${(i % 3 - 1) * 1.5}deg)`
                        : `rotate(${(i % 3 - 1) * 0.5}deg)`,
                      transition: 'transform 0.25s',
                    }}
                    onMouseEnter={(e:any)=>{if(obtenido) e.currentTarget.style.transform='rotate(0deg) translateY(-3px) scale(1.05)';}}
                    onMouseLeave={(e:any)=>{e.currentTarget.style.transform = obtenido ? `rotate(${(i % 3 - 1) * 1.5}deg)` : `rotate(${(i % 3 - 1) * 0.5}deg)`;}}
                  >
                    <span style={{
                      fontSize: 30,
                      filter: obtenido ? 'none' : 'grayscale(1)',
                    }}>{logro.emoji}</span>
                    <span style={{
                      fontFamily: HAND, fontSize: 13, fontWeight: 800,
                      color: obtenido ? logro.color : 'var(--text-faint)',
                      lineHeight: 1.2,
                    }}>{logro.nombre}</span>
                    {obtenido && (
                      <span style={{
                        fontFamily: HAND, fontSize: 14, fontWeight: 900,
                        color: '#16a34a',
                      }}>✓</span>
                    )}
                  </div>
                );
              })}
            </div>
          </NotebookCard>

          {/* LATERAL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Card Nivel */}
            <div style={{
              background: 'var(--bg-card)',
              border: '2.5px solid var(--text-primary)',
              borderRadius: 14,
              boxShadow: `4px 5px 0 ${rango.color}`,
              transform: 'rotate(0.4deg)',
              overflow: 'hidden',
            }}>
              <div style={{
                background: rango.marcoGradient,
                padding: '6px 14px',
                borderBottom: '2px solid var(--text-primary)',
              }}>
                <span style={{
                  fontFamily: HAND, fontSize: 16, fontWeight: 900,
                  color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.35)',

                }}>
                  {rango.emoji} {tr('nivelActualLabel')}
                </span>
              </div>
              <div style={{ padding: 18, textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <RangoDisplay xpTotal={perfil.xp_total || 0} size="sm" mostrarProgreso={false} />
                </div>
                <div style={{
                  fontFamily: HAND, fontSize: 52, fontWeight: 900,
                  color: rango.color, lineHeight: 1,
                  textShadow: `0 0 10px ${rango.color}55`,
                }}>{nivel}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
                  {[
                    { label: 'XP',       val: perfil.xp_total || 0,                        color: rango.color, rot: -1 },
                    { label: 'Ranking',  val: `#${rank}`,                                  color: rankColor,   rot: 1 },
                    { label: 'Racha',    val: `${perfil.racha_actual || 0}🔥`,             color: 'var(--red)', rot: -1 },
                    { label: 'Precisión',val: `${Math.round(perfil.precision_global || 0)}%`, color: '#4ade80', rot: 1 },
                  ].map((s, i) => (
                    <div key={i} style={{
                      background: 'var(--bg-secondary)',
                      border: `1.5px dashed ${s.color}`,
                      borderRadius: 8,
                      padding: '6px 4px',
                      transform: `rotate(${s.rot}deg)`,
                    }}>
                      <div style={{
                        fontFamily: HAND, fontSize: 18, fontWeight: 900,
                        color: s.color,
                      }}>{s.val}</div>
                      <div style={{
                        fontFamily: BODY, fontSize: 12,
                        color: 'var(--text-faint)',
                      }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {perfil.created_at && (
              <div style={{
                background: 'var(--bg-card)',
                border: '2px dashed var(--border-color)',
                borderRadius: 12,
                padding: 14,
                display: 'flex', gap: 10, alignItems: 'center',
                transform: 'rotate(-0.5deg)',
              }}>
                <span style={{ fontSize: 26 }}>📅</span>
                <div>
                  <p style={{
                    fontFamily: HAND, fontSize: 13, fontWeight: 700,
                    color: 'var(--text-faint)',
                    margin: '0 0 2px',
                  }}>~ {tr('miembroDesde')} ~</p>
                  <p style={{
                    fontFamily: HAND, fontSize: 16, fontWeight: 800,
                    color: 'var(--text-primary)', margin: 0,
                  }}>
                    {new Date(perfil.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
            )}

            {!esMiPerfil ? (
              <div style={{
                background: 'var(--bg-secondary)',
                border: '2px dashed var(--gold)',
                borderRadius: 12, padding: 14,
                textAlign: 'center',
                transform: 'rotate(0.4deg)',
              }}>
                <p style={{
                  fontFamily: HAND, fontSize: 16,
                  color: 'var(--text-muted)', margin: '0 0 10px',
                }}>
                  ~ {tr('quieresSuperar')} {perfil.nombre.trim()}? ~
                </p>
                <button onClick={() => (((window as any).__showNavLoader?.('/materias'), router.push('/materias')))}
                  style={{
                    width: '100%', padding: 11,
                    borderRadius: 10,
                    border: '2.5px solid var(--text-primary)',
                    background: 'var(--gold)', color: '#000',
                    fontFamily: HAND, fontSize: 17, fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '2px 3px 0 var(--text-primary)',
                    transform: 'rotate(-1deg)',
                  }}>
                  🚀 {tr('irAEstudiarBtn')}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowEdit(true)}
                style={{
                  width: '100%', padding: 12,
                  borderRadius: 12,
                  border: '2.5px dashed #38bdf8',
                  background: 'transparent', color: '#38bdf8',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  cursor: 'pointer',
                  transform: 'rotate(-1deg)',
                }}>
                ✏️ {tr('editarMiPerfil')}
              </button>
            )}

            <button onClick={() => ((() => {
                try { (window as any).__showNavLoader?.('/'); } catch {}
                const _fb = setTimeout(() => { if (window.location.pathname !== '/') window.location.href = '/'; }, 700);
                try { router.push('/'); setTimeout(() => clearTimeout(_fb), 750); }
                catch { clearTimeout(_fb); window.location.href = '/'; }
              })())}
              style={{
                width: '100%', padding: 12,
                borderRadius: 12,
                border: '2.5px dashed var(--text-faint)',
                background: 'transparent', color: 'var(--text-muted)',
                fontFamily: HAND, fontSize: 17, fontWeight: 800,
                cursor: 'pointer',
                transform: 'rotate(1deg)',
              }}>
              🏆 Ver Leaderboard
            </button>
          </div>
        </div>

        {/* POSTS */}
        <div style={{ marginTop: 24 }}>
          <NotebookCard color="var(--gold)" emoji="🌍" title={esMiPerfil ? (idioma === 'en' ? 'My posts' : 'Mis posts') : (idioma === 'en' ? `Posts by ${perfil.nombre}` : `Posts de ${perfil.nombre}`)} rot={0.3} extra={
            <span style={{
              fontFamily: HAND, fontSize: 14, fontWeight: 800,
              background: 'var(--gold)', color: '#000',
              border: '2px solid var(--text-primary)',
              boxShadow: '1px 2px 0 var(--text-primary)',
              padding: '2px 10px', borderRadius: 6,
              transform: 'rotate(-3deg)', display: 'inline-block',
            }}>
              {postsUsuario.length}
            </span>
          }>
            {cargandoPosts ? (
              <div style={{ textAlign: 'center', padding: 32 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
                <p style={{
                  fontFamily: HAND, fontSize: 16,
                  color: 'var(--text-faint)', margin: 0,
                }}>~ {tr('cargandoPosts')} ~</p>
              </div>
            ) : postsUsuario.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 50, marginBottom: 10 }}>🌵</div>
                <p style={{
                  fontFamily: HAND, fontSize: 18,
                  color: 'var(--text-muted)', margin: 0,
                }}>
                  ~ {esMiPerfil
                    ? (idioma === 'en' ? 'No posts yet' : 'aún no tienes posts')
                    : (idioma === 'en' ? `${perfil.nombre} has not posted yet` : `${perfil.nombre} aún no ha publicado`)} ~
                </p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 14,
              }}>
                {postsUsuario.map((post: any, i: number) => {
                  const tipoEmoji: Record<string, string> = { apunte: '📝', flashcards: '🎴', quiz: '🤓', post: '💬' };
                  const tipoColor: Record<string, string> = { apunte: 'var(--blue)', flashcards: 'var(--gold)', quiz: '#a78bfa', post: '#34d399' };
                  const emoji = tipoEmoji[post.tipo] || '📄';
                  const color = tipoColor[post.tipo] || 'var(--gold)';
                  const rot = (i % 3 === 0 ? -1 : i % 3 === 1 ? 0.6 : -0.4);

                  return (
                    <div key={post.id}
                      onClick={() => router.push(`/comunidad/${post.id}`)}
                      style={{
                        background: 'var(--bg-card)',
                        border: '2.5px solid var(--text-primary)',
                        borderRadius: 12,
                        boxShadow: `3px 4px 0 ${color}`,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        transform: `rotate(${rot}deg)`,
                        transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                      }}
                      onMouseEnter={(e: any) => {
                        (e.currentTarget as HTMLElement).style.transform = 'rotate(0deg) translateY(-3px)';
                        (e.currentTarget as HTMLElement).style.boxShadow = `5px 6px 0 ${color}`;
                      }}
                      onMouseLeave={(e: any) => {
                        (e.currentTarget as HTMLElement).style.transform = `rotate(${rot}deg)`;
                        (e.currentTarget as HTMLElement).style.boxShadow = `3px 4px 0 ${color}`;
                      }}
                    >
                      {post.portada_url ? (
                        <div style={{ width: '100%', paddingBottom: '45%', position: 'relative', overflow: 'hidden', background: 'var(--bg-card)' }}>
                          <img src={post.portada_url} alt={post.titulo}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </div>
                      ) : (
                        <div style={{
                          height: 80,
                          background: `linear-gradient(135deg, ${color}33, ${color}66)`,
                          borderBottom: '2px solid var(--text-primary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 40,
                        }}>
                          {post.materia_emoji || emoji}
                        </div>
                      )}

                      <div style={{ padding: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <span style={{
                            background: color, color: '#000',
                            border: '1.5px solid var(--text-primary)',
                            padding: '2px 8px', borderRadius: 6,
                            fontFamily: HAND, fontSize: 13, fontWeight: 800,
                            transform: 'rotate(-2deg)',
                          }}>
                            {emoji} {post.tipo}
                          </span>
                          {post.materia_nombre && (
                            <span style={{
                              fontFamily: BODY, fontSize: 13,
                              color: 'var(--text-faint)',
                            }}>
                              {post.materia_nombre}
                            </span>
                          )}
                        </div>

                        <p style={{
                          fontFamily: HAND, fontSize: 17, fontWeight: 800,
                          color: 'var(--text-primary)',
                          margin: '0 0 8px', lineHeight: 1.2,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}>
                          {post.titulo}
                        </p>

                        <div style={{
                          display: 'flex', gap: 10,
                          fontFamily: BODY, fontSize: 13, fontWeight: 700,
                          color: 'var(--text-faint)',
                        }}>
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
          </NotebookCard>
        </div>

        {/* COMPARTIR */}
        <div style={{
          marginTop: 22,
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 14,
          padding: '18px 22px',
          boxShadow: '4px 5px 0 var(--gold)',
          transform: 'rotate(-0.3deg)',
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              color: 'var(--text-primary)', margin: '0 0 4px',
            }}>
              🔗 {tr('compartirPerfil')}
            </p>
            <p style={{
              fontFamily: BODY, fontSize: 14,
              color: 'var(--text-faint)', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 420,
            }}>
              ~ {urlPublica} ~
            </p>
          </div>

          <button onClick={copiarLink}
            style={{
              padding: '11px 22px',
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: copiado ? '#4ade80' : 'var(--gold)',
              color: '#000',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              cursor: 'pointer', whiteSpace: 'nowrap',
              boxShadow: '3px 4px 0 var(--text-primary)',
              transform: 'rotate(1.5deg)',
              transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(1.5deg)';}}
          >
            {copiado ? `✅ ${tr('copiado')}` : `📋 ${tr('copiarLink')}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function NotebookCard({ children, color, emoji, title, rot, extra }: {
  children: React.ReactNode;
  color: string;
  emoji: string;
  title: string;
  rot: number;
  extra?: React.ReactNode;
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
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 10, flexWrap: 'wrap',
      }}>
        <h2 style={{
          fontFamily: HAND, fontSize: 22, fontWeight: 900,
          color: '#000', margin: 0,
          transform: 'rotate(-0.5deg)', display: 'inline-block',
        }}>
          {emoji} {title}
        </h2>
        {extra}
      </div>
      <div style={{ padding: 18 }}>
        {children}
      </div>
    </div>
  );
}

function Badge({ children, color, rot }: { children: React.ReactNode; color: string; rot: number }) {
  return (
    <span style={{
      padding: '4px 12px',
      borderRadius: 8,
      background: `color-mix(in srgb,${color} 22%,transparent)`,
      color, border: `1.5px dashed ${color}`,
      fontFamily: HAND, fontSize: 14, fontWeight: 800,

      transform: `rotate(${rot}deg)`,
      display: 'inline-block',
    }}>
      {children}
    </span>
  );
}

function SmallBadge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: BODY, fontSize: 13, fontWeight: 700,
      color: 'var(--text-muted)',
      background: 'var(--bg-secondary)',
      padding: '3px 10px', borderRadius: 6,
      border: '1.5px dashed var(--border-color)',

      textTransform: 'capitalize',
    }}>
      {children}
    </span>
  );
}

function HeaderBtn({ children, onClick, color, rot }: any) {
  return (
    <button onClick={onClick}
      style={{
        padding: '8px 16px',
        borderRadius: 10,
        border: `2.5px dashed ${color}`,
        background: 'transparent', color,
        fontFamily: HAND, fontSize: 17, fontWeight: 800,
        cursor: 'pointer',
        transform: `rotate(${rot}deg)`,
        transition: 'all 0.25s',
      }}
      onMouseEnter={(e:any)=>{
        e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
        e.currentTarget.style.borderStyle = 'solid';
        e.currentTarget.style.background = `color-mix(in srgb,${color} 14%,transparent)`;
      }}
      onMouseLeave={(e:any)=>{
        e.currentTarget.style.transform = `rotate(${rot}deg)`;
        e.currentTarget.style.borderStyle = 'dashed';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        fontFamily: HAND, fontSize: 15, fontWeight: 800,
        color: 'var(--text-muted)',
        display: 'block', marginBottom: 6,

        transform: 'rotate(-0.5deg)', transformOrigin: 'left',
      }}>
        ✏️ {label}
      </label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, disabled }: any) {
  return (
    <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
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
