'use client';

import { useRouter } from 'next/navigation';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getHorarioDB, saveHorarioDB, Horario, ClaseHorario } from '../../lib/db';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';

const HAND = "'Caveat',cursive";

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'] as const;

const HORAS: string[] = [];
for (let h = 6; h <= 22; h++) {
  for (let m = 0; m < 60; m += 15) {
    HORAS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}
HORAS.push('23:00');

const COLORES = ['#d6b26f', '#8a120c', '#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#a78bfa', '#e879f9'];
const HORARIO_VACIO: Horario = { lunes: [], martes: [], miercoles: [], jueves: [], viernes: [] };
const genId = () => Math.random().toString(36).substr(2, 9);

const formatHora = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  const periodo = h >= 12 ? 'PM' : 'AM';
  const hora12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hora12}:${String(m).padStart(2, '0')} ${periodo}`;
};

export default function HorarioPage() {
  const router = useRouter();
  const [horario, setHorario] = useState<Horario>(HORARIO_VACIO);
  const [userId, setUserId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [diaSeleccionado, setDiaSeleccionado] = useState<typeof DIAS[number]>('lunes');
  const [claseEditando, setClaseEditando] = useState<ClaseHorario | null>(null);
  const [diaActivoMobile, setDiaActivoMobile] = useState<typeof DIAS[number]>('lunes');
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  const DIAS_LABELS_I18N = {
    lunes: tr('lunes'), martes: tr('martes'), miercoles: tr('miercoles'),
    jueves: tr('jueves'), viernes: tr('viernes'),
  };
  const DIAS_SHORT_I18N = {
    lunes: tr('lun'), martes: tr('mar'), miercoles: tr('mie'),
    jueves: tr('jue'), viernes: tr('vie'),
  };

  const [formNombre, setFormNombre] = useState('');
  const [formProfesor, setFormProfesor] = useState('');
  const [formAula, setFormAula] = useState('');
  const [formColor, setFormColor] = useState(COLORES[0]);
  const [formInicio, setFormInicio] = useState('08:00');
  const [formFin, setFormFin] = useState('09:00');

  const hoy = new Date();
  const diaHoy = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][hoy.getDay()] as typeof DIAS[number];
  const horaActual = `${String(hoy.getHours()).padStart(2, '0')}:${String(hoy.getMinutes()).padStart(2, '0')}`;

  useEffect(() => {
    const cargar = async () => {
      setCargando(true);
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          setUserId(data.user.id);
          const h = await getHorarioDB(data.user.id);
          setHorario(h);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setCargando(false);
      }
    };
    cargar();
    if (DIAS.includes(diaHoy as any)) {
      setDiaActivoMobile(diaHoy as typeof DIAS[number]);
    }
  }, []);

  const guardar = async (nuevoHorario: Horario) => {
    setHorario(nuevoHorario);
    setGuardando(true);
    if (userId) await saveHorarioDB(userId, nuevoHorario);
    setGuardando(false);
  };

  const abrirModal = (dia: typeof DIAS[number], clase?: ClaseHorario) => {
    setDiaSeleccionado(dia);
    if (clase) {
      setClaseEditando(clase);
      setFormNombre(clase.nombre);
      setFormProfesor(clase.profesor || '');
      setFormAula(clase.aula || '');
      setFormColor(clase.color);
      setFormInicio(clase.horaInicio);
      setFormFin(clase.horaFin);
    } else {
      setClaseEditando(null);
      setFormNombre('');
      setFormProfesor('');
      setFormAula('');
      setFormColor(COLORES[0]);
      setFormInicio('08:00');
      setFormFin('09:00');
    }
    setModalAbierto(true);
  };

  const guardarClase = async () => {
    if (!formNombre.trim()) return;
    const nueva: ClaseHorario = {
      id: claseEditando?.id || genId(),
      nombre: formNombre,
      profesor: formProfesor,
      aula: formAula,
      color: formColor,
      horaInicio: formInicio,
      horaFin: formFin,
    };
    const nuevoHorario = { ...horario };
    if (claseEditando) {
      nuevoHorario[diaSeleccionado] = nuevoHorario[diaSeleccionado].map(c => c.id === claseEditando.id ? nueva : c);
    } else {
      nuevoHorario[diaSeleccionado] = [...nuevoHorario[diaSeleccionado], nueva].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
    }
    await guardar(nuevoHorario);
    setModalAbierto(false);
  };

  const eliminarClase = async (dia: typeof DIAS[number], id: string) => {
    if (!confirm(tr('eliminarClaseConfirm'))) return;
    const nuevoHorario = { ...horario };
    nuevoHorario[dia] = nuevoHorario[dia].filter(c => c.id !== id);
    await guardar(nuevoHorario);
  };

  const claseActual = DIAS.includes(diaHoy as any)
    ? (horario[diaHoy as typeof DIAS[number]] || []).find(c => c.horaInicio <= horaActual && c.horaFin > horaActual)
    : null;

  const proximaClase = DIAS.includes(diaHoy as any)
    ? (horario[diaHoy as typeof DIAS[number]] || []).find(c => c.horaInicio > horaActual)
    : null;

  if (cargando) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontFamily: HAND, fontSize: 22, color: 'var(--text-muted)', fontStyle: 'italic' }}>~ {tr('cargandoHorario')} ~</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>

      {isMobile ? (
        <NavbarMobile />
      ) : (
        <>
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
              <button onClick={() => ((window as any).__showNavLoader?.('/'), router.push('/'))}
                style={{
                  background: 'var(--bg-card)',
                  border: '2.5px solid var(--text-primary)',
                  color: 'var(--text-primary)',
                  padding: '8px 16px',
                  borderRadius: 10,
                  fontFamily: HAND,
                  fontWeight: 800, fontSize: 17,
                  cursor: 'pointer',
                  boxShadow: '3px 3px 0 var(--text-primary)',
                  transform: 'rotate(-1.5deg)',
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}
                onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='4px 4px 0 var(--text-primary)';}}
                onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1.5deg)';e.currentTarget.style.boxShadow='3px 3px 0 var(--text-primary)';}}
              >
                ← {tr('inicio')}
              </button>
              <div>
                <h1 style={{
                  fontFamily: HAND,
                  fontSize: 32, fontWeight: 900,
                  color: 'var(--text-primary)',
                  margin: 0, lineHeight: 1,
                  transform: 'rotate(-1deg)',
                  display: 'inline-block',
                }}>
                  🗓️ {tr('miHorarioTitulo')}
                </h1>
                <svg width="160" height="6" style={{ display: 'block', marginTop: 2 }}>
                  <path d="M2 3 Q 80 0 158 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
                </svg>
              </div>
            </div>
            {guardando && (
              <span style={{
                fontFamily: HAND, fontSize: 16,
                color: 'var(--gold)', fontStyle: 'italic',
                animation: 'nbBlink 1s infinite',
              }}>
                ✏️ {tr('guardando')}...
              </span>
            )}
          </header>
        </>
      )}

      {/* Línea rasgada */}
      <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{
        display:'block', width:'100%', height:14,
      }}>
        <path
          d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
          fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.45"
        />
      </svg>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '16px' : '28px 40px 60px' }}>

        {/* Banner clase actual */}
        {claseActual && (
          <div style={{
            background: claseActual.color + '22',
            border: `2.5px solid ${claseActual.color}`,
            borderRadius: 14,
            padding: '12px 18px',
            marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 14,
            boxShadow: `4px 4px 0 ${claseActual.color}66`,
            transform: 'rotate(-0.4deg)',
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              background: claseActual.color,
              animation: 'nbPulse 1.5s infinite',
              boxShadow: `0 0 10px ${claseActual.color}`,
              flexShrink: 0,
            }}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontFamily: HAND, fontSize: 14, fontWeight: 800,
                color: claseActual.color, margin: '0 0 2px',
                fontStyle: 'italic', textTransform: 'lowercase',
              }}>
                🔴 {tr('enCursoAhora')}
              </p>
              <p style={{
                fontFamily: HAND, fontSize: isMobile ? 22 : 26, fontWeight: 900,
                color: 'var(--text-primary)', margin: 0, lineHeight: 1.1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {claseActual.nombre}
              </p>
              <p style={{
                fontFamily: HAND, fontSize: 15, color: claseActual.color,
                margin: 0, fontWeight: 700,
              }}>
                {formatHora(claseActual.horaInicio)} – {formatHora(claseActual.horaFin)}
                {claseActual.aula && ` · Aula ${claseActual.aula}`}
              </p>
            </div>
          </div>
        )}

        {/* Banner próxima */}
        {!claseActual && proximaClase && (
          <div style={{
            background: 'color-mix(in srgb,var(--blue) 16%,transparent)',
            border: '2.5px dashed var(--blue)',
            borderRadius: 14,
            padding: '12px 18px',
            marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 14,
            transform: 'rotate(0.3deg)',
          }}>
            <div style={{ fontSize: 26 }}>⏰</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontFamily: HAND, fontSize: 14, fontWeight: 800,
                color: 'var(--blue)', margin: '0 0 2px',
                fontStyle: 'italic', textTransform: 'lowercase',
              }}>
                {tr('proximaClaseHoy')}
              </p>
              <p style={{
                fontFamily: HAND, fontSize: isMobile ? 22 : 26, fontWeight: 900,
                color: 'var(--text-primary)', margin: 0, lineHeight: 1.1,
              }}>
                {proximaClase.nombre}
              </p>
              <p style={{
                fontFamily: HAND, fontSize: 15, color: 'var(--blue)',
                margin: 0, fontWeight: 700,
              }}>
                a las {formatHora(proximaClase.horaInicio)}
              </p>
            </div>
          </div>
        )}

        {/* MOBILE: tabs */}
        {isMobile && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', paddingBottom: 4 }}>
              {DIAS.map((dia, i) => {
                const esHoy = dia === diaHoy;
                const esActivo = dia === diaActivoMobile;
                const clases = horario[dia] || [];
                return (
                  <button key={dia}
                    onClick={() => setDiaActivoMobile(dia)}
                    style={{
                      flexShrink: 0,
                      padding: '10px 14px',
                      borderRadius: 12,
                      border: `2.5px solid ${esActivo ? 'var(--gold)' : esHoy ? 'var(--gold)' : 'var(--border-color)'}`,
                      background: esActivo ? 'var(--gold)' : esHoy ? 'color-mix(in srgb,var(--gold) 18%,var(--bg-card))' : 'var(--bg-card)',
                      color: esActivo ? '#000' : esHoy ? 'var(--gold)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      fontFamily: HAND,
                      fontSize: 17, fontWeight: 800,
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      gap: 2,
                      boxShadow: esActivo ? '2px 3px 0 var(--text-primary)' : 'none',
                      transform: esActivo ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
                      transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                    }}>
                    <span>{DIAS_SHORT_I18N[dia]}</span>
                    <span style={{ fontSize: 12, fontStyle: 'italic', opacity: 0.85 }}>{clases.length} cl</span>
                  </button>
                );
              })}
            </div>

            <DayCard
              dia={diaActivoMobile}
              esHoy={diaActivoMobile === diaHoy}
              clases={horario[diaActivoMobile] || []}
              label={DIAS_LABELS_I18N[diaActivoMobile]}
              onAdd={() => abrirModal(diaActivoMobile)}
              onEdit={c => abrirModal(diaActivoMobile, c)}
              onDelete={id => eliminarClase(diaActivoMobile, id)}
              horaActual={horaActual}
              tr={tr}
              isMobile
              rot={0}
            />
          </>
        )}

        {/* DESKTOP: 5 columnas */}
        {!isMobile && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 14 }}>
            {DIAS.map((dia, i) => (
              <DayCard
                key={dia}
                dia={dia}
                esHoy={dia === diaHoy}
                clases={horario[dia] || []}
                label={DIAS_LABELS_I18N[dia]}
                onAdd={() => abrirModal(dia)}
                onEdit={c => abrirModal(dia, c)}
                onDelete={id => eliminarClase(dia, id)}
                horaActual={horaActual}
                tr={tr}
                isMobile={false}
                rot={(i % 2 === 0 ? -0.5 : 0.5)}
              />
            ))}
          </div>
        )}

        {/* Resumen semanal desktop */}
        {!isMobile && (
          <div style={{
            marginTop: 32,
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 14,
            boxShadow: '4px 5px 0 var(--text-primary)',
            transform: 'rotate(-0.3deg)',
            overflow: 'hidden',
          }}>
            <div style={{
              background: 'var(--blue)',
              padding: '6px 18px',
              borderBottom: '2px solid var(--text-primary)',
            }}>
              <span style={{
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                fontStyle: 'italic',
              }}>
                📊 {tr('resumenSemanalLabel')}
              </span>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                {DIAS.map((dia, i) => {
                  const clases = horario[dia] || [];
                  const esHoy = dia === diaHoy;
                  return (
                    <div key={dia} style={{
                      textAlign: 'center', padding: '14px 8px',
                      background: esHoy ? 'color-mix(in srgb,var(--gold) 18%,var(--bg-secondary))' : 'var(--bg-secondary)',
                      borderRadius: 12,
                      border: `2px ${esHoy ? 'solid' : 'dashed'} ${esHoy ? 'var(--gold)' : 'var(--border-color)'}`,
                      transform: `rotate(${i % 2 === 0 ? -1 : 1}deg)`,
                      transition: 'transform 0.25s',
                    }}
                      onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.05)'}
                      onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${i % 2 === 0 ? -1 : 1}deg)`}
                    >
                      <p style={{
                        fontFamily: HAND, fontSize: 16, fontWeight: 800,
                        color: esHoy ? 'var(--gold)' : 'var(--text-muted)',
                        margin: '0 0 4px',
                      }}>
                        {DIAS_LABELS_I18N[dia].slice(0, 3)}
                      </p>
                      <p style={{
                        fontFamily: HAND, fontSize: 36, fontWeight: 900,
                        color: esHoy ? 'var(--gold)' : 'var(--text-primary)',
                        margin: '0 0 2px', lineHeight: 1,
                      }}>
                        {clases.length}
                      </p>
                      <p style={{
                        fontFamily: HAND, fontSize: 13, color: 'var(--text-faint)',
                        margin: 0, fontStyle: 'italic',
                      }}>
                        {clases.length !== 1 ? tr('clasesLabel') : tr('claseLabel')}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL */}
      {modalAbierto && (
        <div onClick={() => setModalAbierto(false)} style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.78)',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20,
          animation: 'modalFade 0.25s ease',
        }}>
          <div onClick={(e: any) => e.stopPropagation()} style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            padding: '24px 28px',
            width: '100%', maxWidth: 480,
            border: '2.5px solid var(--text-primary)',
            boxShadow: '6px 7px 0 var(--text-primary), 0 16px 50px rgba(0,0,0,0.45)',
            maxHeight: '92vh', overflowY: 'auto',
            transform: 'rotate(-0.5deg)',
            position: 'relative',
            animation: 'modalPop 0.4s cubic-bezier(.34,1.4,.64,1)',
          }}>
            {/* Cinta scotch */}
            <div style={{
              position: 'absolute', top: -12, left: '50%',
              transform: 'translateX(-50%) rotate(-4deg)',
              width: 90, height: 22,
              background: `color-mix(in srgb, ${formColor} 55%, transparent)`,
              border: `1px solid color-mix(in srgb, ${formColor} 30%, transparent)`,
              boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
              zIndex: 5,
            }}/>

            <div style={{
              margin: '8px -28px 18px',
              padding: '10px 28px',
              background: formColor,
              borderTop: '2px solid var(--text-primary)',
              borderBottom: '2px solid var(--text-primary)',
            }}>
              <h2 style={{
                fontFamily: HAND, fontSize: 26, fontWeight: 900,
                color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.35)',
                margin: 0, lineHeight: 1.1,
                transform: 'rotate(-0.8deg)', display: 'inline-block',
              }}>
                {claseEditando ? `✏️ ${tr('editarClaseBtn')}` : `📅 + Nueva clase`} <span style={{ fontSize: 18, fontStyle: 'italic', opacity: 0.95 }}>· {DIAS_LABELS_I18N[diaSeleccionado]}</span>
              </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label={tr('nombreClaseLabel')}>
                <input value={formNombre} onChange={(e: any) => setFormNombre(e.target.value)}
                  placeholder="Cálculo I, Inglés..."
                  autoFocus
                  style={inputStyle(formColor)}
                />
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label={idioma === 'en' ? 'Start' : 'Inicio'}>
                  <select value={formInicio} onChange={(e: any) => setFormInicio(e.target.value)} style={inputStyle(formColor)}>
                    {HORAS.map(h => <option key={h} value={h}>{formatHora(h)}</option>)}
                  </select>
                </Field>
                <Field label={idioma === 'en' ? 'End' : 'Fin'}>
                  <select value={formFin} onChange={(e: any) => setFormFin(e.target.value)} style={inputStyle(formColor)}>
                    {HORAS.map(h => <option key={h} value={h}>{formatHora(h)}</option>)}
                  </select>
                </Field>
              </div>

              <Field label={tr('profesorLabel')}>
                <input value={formProfesor} onChange={(e: any) => setFormProfesor(e.target.value)}
                  placeholder={idioma === 'en' ? 'Teacher name' : 'Nombre del profesor'}
                  style={inputStyle(formColor)}
                />
              </Field>

              <Field label={tr('aulaLabel')}>
                <input value={formAula} onChange={(e: any) => setFormAula(e.target.value)}
                  placeholder={idioma === 'en' ? 'Room' : 'Aula'}
                  style={inputStyle(formColor)}
                />
              </Field>

              <Field label="Color">
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {COLORES.map(c => (
                    <button key={c} onClick={() => setFormColor(c)}
                      style={{
                        width: 38, height: 38, borderRadius: '50%',
                        background: c,
                        border: formColor === c ? '3px solid var(--text-primary)' : '2px solid var(--border-color)',
                        cursor: 'pointer',
                        transform: formColor === c ? 'scale(1.2) rotate(-5deg)' : 'scale(1)',
                        boxShadow: formColor === c ? `2px 3px 0 ${c}` : 'none',
                        transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
                      }}/>
                  ))}
                </div>
              </Field>
            </div>

            <div style={{
              display: 'flex', gap: 10,
              marginTop: 20, paddingTop: 14,
              borderTop: '1.5px dashed var(--border-color)',
            }}>
              <button onClick={() => setModalAbierto(false)}
                style={{
                  flex: 1, padding: '12px',
                  borderRadius: 12,
                  border: '2.5px dashed var(--text-faint)',
                  background: 'transparent', color: 'var(--text-muted)',
                  fontFamily: HAND, fontSize: 19, fontWeight: 800,
                  cursor: 'pointer',
                  transform: 'rotate(1deg)',
                }}>
                ✕ {tr('cancelar')}
              </button>
              <button onClick={guardarClase} disabled={!formNombre.trim()}
                style={{
                  flex: 2, padding: '12px',
                  borderRadius: 12,
                  border: '2.5px solid var(--text-primary)',
                  background: formNombre.trim() ? formColor : 'var(--bg-card2)',
                  color: formNombre.trim() ? '#000' : 'var(--text-faint)',
                  fontFamily: HAND, fontSize: 20, fontWeight: 800,
                  cursor: formNombre.trim() ? 'pointer' : 'not-allowed',
                  boxShadow: formNombre.trim() ? '3px 4px 0 var(--text-primary)' : 'none',
                  transform: 'rotate(-1deg)',
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}
                onMouseEnter={(e:any)=>{
                  if (formNombre.trim()) {
                    e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
                    e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
                  }
                }}
                onMouseLeave={(e:any)=>{
                  e.currentTarget.style.transform = 'rotate(-1deg)';
                  if (formNombre.trim()) e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
                }}
              >
                {claseEditando ? `💾 ${tr('guardarClaseBtn')}` : `+ ${tr('agregarClaseBtn')}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes nbPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.6; transform: scale(1.3); }
        }
        @keyframes nbBlink {
          50% { opacity: 0.4; }
        }
        @keyframes modalFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes modalPop {
          0%   { transform: rotate(0deg) scale(0.85); opacity: 0; }
          60%  { transform: rotate(-0.5deg) scale(1.02); opacity: 1; }
          100% { transform: rotate(-0.5deg) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// DAY CARD
// ══════════════════════════════════════════════════════════════
function DayCard({ dia, esHoy, clases, label, onAdd, onEdit, onDelete, horaActual, tr, isMobile, rot }: {
  dia: string; esHoy: boolean; clases: ClaseHorario[]; label: string;
  onAdd: () => void; onEdit: (c: ClaseHorario) => void; onDelete: (id: string) => void;
  horaActual: string; tr: any; isMobile: boolean; rot: number;
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `2.5px solid ${esHoy ? 'var(--gold)' : 'var(--text-primary)'}`,
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: esHoy ? '4px 5px 0 var(--gold)' : '4px 5px 0 var(--text-primary)',
      transform: `rotate(${rot}deg)`,
      transition: 'transform 0.25s',
    }}>
      {/* Banda título */}
      <div style={{
        background: esHoy ? 'var(--gold)' : 'var(--bg-secondary)',
        padding: '8px 14px',
        borderBottom: '2px solid var(--text-primary)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <h3 style={{
            fontFamily: HAND, fontSize: isMobile ? 22 : 20, fontWeight: 900,
            color: esHoy ? '#000' : 'var(--text-primary)',
            margin: 0, lineHeight: 1,
          }}>
            {label}
          </h3>
          {esHoy && (
            <p style={{
              fontFamily: HAND, fontSize: 12, fontWeight: 800,
              color: '#000', margin: 0, fontStyle: 'italic',
            }}>
              ✦ {tr('hoyCap')} ✦
            </p>
          )}
        </div>
        <button onClick={onAdd}
          style={{
            width: 32, height: 32, borderRadius: 8,
            border: '2px solid var(--text-primary)',
            background: esHoy ? 'var(--bg-card)' : 'var(--gold)',
            color: esHoy ? 'var(--text-primary)' : '#000',
            fontSize: 20, fontWeight: 900,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '2px 2px 0 var(--text-primary)',
            transform: 'rotate(-3deg)',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.1)'}
          onMouseLeave={(e:any)=>e.currentTarget.style.transform='rotate(-3deg)'}
        >
          +
        </button>
      </div>

      <div style={{
        padding: 12,
        display: 'flex', flexDirection: 'column', gap: 8,
        minHeight: isMobile ? 120 : 200,
        position: 'relative',
      }}>
        {/* margen rojo */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: 28, width: 1.5,
          background: '#ef4444', opacity: 0.25,
          pointerEvents: 'none',
        }}/>

        {clases.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 6,
            padding: '24px 0',
            color: 'var(--text-faint)',
          }}>
            <span style={{ fontSize: 28 }}>🌵</span>
            <span style={{
              fontFamily: HAND, fontSize: 15,
              fontStyle: 'italic',
            }}>
              ~ {tr('sinClasesDesktop')} ~
            </span>
          </div>
        ) : (
          clases.map((clase, i) => {
            const enCurso = esHoy && clase.horaInicio <= horaActual && clase.horaFin > horaActual;
            return (
              <div key={clase.id} style={{
                position: 'relative',
                borderRadius: 10,
                border: `2.5px ${enCurso ? 'solid' : 'dashed'} ${clase.color}`,
                background: clase.color + (enCurso ? '30' : '15'),
                padding: '10px 12px',
                boxShadow: enCurso ? `3px 3px 0 ${clase.color}66` : 'none',
                transform: `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                transition: 'transform 0.25s',
              }}
                onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) translateY(-1px)'}
                onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`}
              >
                {enCurso && (
                  <div style={{
                    position: 'absolute', top: 8, right: 8,
                    width: 8, height: 8, borderRadius: '50%',
                    background: clase.color,
                    animation: 'nbPulse 1.5s infinite',
                    boxShadow: `0 0 6px ${clase.color}`,
                  }}/>
                )}
                <p style={{
                  fontFamily: HAND, fontSize: isMobile ? 18 : 17, fontWeight: 800,
                  color: 'var(--text-primary)', margin: '0 0 3px',
                  paddingRight: enCurso ? 14 : 0, lineHeight: 1.1,
                }}>
                  {clase.nombre}
                </p>
                <p style={{
                  fontFamily: HAND, fontSize: 14, color: clase.color,
                  fontWeight: 700, margin: '0 0 3px',
                }}>
                  {formatHora(clase.horaInicio)} – {formatHora(clase.horaFin)}
                </p>
                {clase.profesor && (
                  <p style={{
                    fontFamily: HAND, fontSize: 13, color: 'var(--text-muted)',
                    margin: '0 0 1px', fontStyle: 'italic',
                  }}>
                    👤 {clase.profesor}
                  </p>
                )}
                {clase.aula && (
                  <p style={{
                    fontFamily: HAND, fontSize: 13, color: 'var(--text-muted)',
                    margin: 0, fontStyle: 'italic',
                  }}>
                    📍 {clase.aula}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
                  <button onClick={() => onEdit(clase)}
                    style={{
                      flex: 1, padding: '5px',
                      borderRadius: 6,
                      border: `1.5px dashed ${clase.color}`,
                      background: 'transparent',
                      color: clase.color,
                      fontFamily: HAND, fontSize: 14, fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e:any)=>{e.currentTarget.style.background = clase.color + '22';}}
                    onMouseLeave={(e:any)=>{e.currentTarget.style.background = 'transparent';}}
                  >
                    ✏️ editar
                  </button>
                  <button onClick={() => onDelete(clase.id)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1.5px dashed var(--red)',
                      background: 'transparent',
                      color: 'var(--red)',
                      fontFamily: HAND, fontSize: 14,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e:any)=>{e.currentTarget.style.background = 'color-mix(in srgb,var(--red) 14%,transparent)';}}
                    onMouseLeave={(e:any)=>{e.currentTarget.style.background = 'transparent';}}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// FIELD
// ══════════════════════════════════════════════════════════════
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        fontFamily: HAND, fontSize: 16, fontWeight: 800,
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

const inputStyle = (color: string): React.CSSProperties => ({
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '2.5px solid var(--text-primary)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontFamily: HAND,
  fontSize: 18, fontWeight: 600,
  outline: 'none',
  boxSizing: 'border-box',
  boxShadow: '3px 3px 0 var(--text-primary)',
  transform: 'rotate(-0.3deg)',
  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
});