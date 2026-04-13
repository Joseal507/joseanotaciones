'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getHorarioDB, saveHorarioDB, Horario, ClaseHorario } from '../../lib/db';
import { useIsMobile } from '../../hooks/useIsMobile';
import NavbarMobile from '../../components/NavbarMobile';

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'] as const;
const DIAS_LABELS = { lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves', viernes: 'Viernes' };
const DIAS_SHORT = { lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie' };

const HORAS: string[] = [];
for (let h = 6; h <= 22; h++) {
  for (let m = 0; m < 60; m += 15) {
    HORAS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}
HORAS.push('23:00');

const COLORES = ['#f5c842', '#ff4d6d', '#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#a78bfa', '#e879f9'];
const HORARIO_VACIO: Horario = { lunes: [], martes: [], miercoles: [], jueves: [], viernes: [] };
const genId = () => Math.random().toString(36).substr(2, 9);

const formatHora = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  const periodo = h >= 12 ? 'PM' : 'AM';
  const hora12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hora12}:${String(m).padStart(2, '0')} ${periodo}`;
};

export default function HorarioPage() {
  const [horario, setHorario] = useState<Horario>(HORARIO_VACIO);
  const [userId, setUserId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [diaSeleccionado, setDiaSeleccionado] = useState<typeof DIAS[number]>('lunes');
  const [claseEditando, setClaseEditando] = useState<ClaseHorario | null>(null);
  const [diaActivoMobile, setDiaActivoMobile] = useState<typeof DIAS[number]>('lunes');
  const isMobile = useIsMobile();

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
    // Set día activo mobile al día de hoy si es día de semana
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
    if (!confirm('¿Eliminar esta clase?')) return;
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
        <p style={{ color: 'var(--text-muted)' }}>Cargando horario...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {/* NAVBAR */}
      {isMobile ? (
        <NavbarMobile />
      ) : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', height: '68px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => window.location.href = '/'}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ← Inicio
              </button>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>🗓️ Mi Horario</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>Horario de clases semanal</p>
              </div>
            </div>
            {guardando && <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>💾 Guardando...</span>}
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            <div style={{ flex: 1, background: 'var(--gold)' }} />
            <div style={{ flex: 1, background: 'var(--red)' }} />
            <div style={{ flex: 1, background: 'var(--blue)' }} />
            <div style={{ flex: 1, background: 'var(--pink)' }} />
          </div>
        </>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '16px' : '32px 40px' }}>

        {/* Banner clase actual */}
        {claseActual && (
          <div style={{ background: claseActual.color + '20', border: `2px solid ${claseActual.color}`, borderRadius: '16px', padding: '14px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: claseActual.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: claseActual.color, margin: '0 0 2px', textTransform: 'uppercase' }}>🔴 En curso ahora</p>
              <p style={{ fontSize: isMobile ? '16px' : '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {claseActual.nombre}
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                {formatHora(claseActual.horaInicio)} - {formatHora(claseActual.horaFin)}
                {claseActual.aula && ` · Aula ${claseActual.aula}`}
              </p>
            </div>
          </div>
        )}

        {/* Banner próxima clase */}
        {!claseActual && proximaClase && (
          <div style={{ background: 'var(--blue-dim)', border: '2px solid var(--blue-border)', borderRadius: '16px', padding: '14px 20px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ fontSize: '20px' }}>⏰</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--blue)', margin: '0 0 2px', textTransform: 'uppercase' }}>Próxima clase hoy</p>
              <p style={{ fontSize: isMobile ? '16px' : '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{proximaClase.nombre}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>A las {formatHora(proximaClase.horaInicio)}</p>
            </div>
          </div>
        )}

        {/* MOBILE: tabs de días */}
        {isMobile && (
          <>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
              {DIAS.map(dia => {
                const esHoy = dia === diaHoy;
                const esActivo = dia === diaActivoMobile;
                const clases = horario[dia] || [];
                return (
                  <button key={dia}
                    onClick={() => setDiaActivoMobile(dia)}
                    style={{
                      flexShrink: 0,
                      padding: '10px 14px',
                      borderRadius: '12px',
                      border: `2px solid ${esActivo ? 'var(--gold)' : esHoy ? 'var(--gold-border)' : 'var(--border-color)'}`,
                      background: esActivo ? 'var(--gold)' : esHoy ? 'var(--gold-dim)' : 'var(--bg-card)',
                      color: esActivo ? '#000' : esHoy ? 'var(--gold)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '13px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '2px',
                    }}>
                    <span>{DIAS_SHORT[dia]}</span>
                    <span style={{ fontSize: '10px', opacity: 0.7 }}>{clases.length} cl.</span>
                  </button>
                );
              })}
            </div>

            {/* Día activo en mobile */}
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `2px solid ${diaActivoMobile === diaHoy ? 'var(--gold)' : 'var(--border-color)'}`, overflow: 'hidden' }}>
              <div style={{ height: '4px', background: diaActivoMobile === diaHoy ? 'var(--gold)' : 'var(--border-color)' }} />
              <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                  {DIAS_LABELS[diaActivoMobile]}
                  {diaActivoMobile === diaHoy && <span style={{ marginLeft: '8px', fontSize: '11px', background: 'var(--gold)', color: '#000', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>HOY</span>}
                </h3>
                <button onClick={() => abrirModal(diaActivoMobile)}
                  style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                  + Clase
                </button>
              </div>

              <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '100px' }}>
                {(horario[diaActivoMobile] || []).length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-faint)', fontSize: '14px' }}>
                    <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
                    Sin clases este día
                  </div>
                ) : (
                  (horario[diaActivoMobile] || []).map(clase => {
                    const estaEnCurso = diaActivoMobile === diaHoy && clase.horaInicio <= horaActual && clase.horaFin > horaActual;
                    return (
                      <div key={clase.id} style={{ borderRadius: '12px', border: `2px solid ${clase.color}`, background: clase.color + (estaEnCurso ? '30' : '15'), padding: '14px 16px', boxShadow: estaEnCurso ? `0 4px 16px ${clase.color}44` : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <p style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{clase.nombre}</p>
                          {estaEnCurso && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: clase.color, flexShrink: 0, marginTop: '4px' }} />}
                        </div>
                        <p style={{ fontSize: '13px', color: clase.color, fontWeight: 700, margin: '0 0 6px' }}>
                          {formatHora(clase.horaInicio)} - {formatHora(clase.horaFin)}
                        </p>
                        {clase.profesor && <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 2px' }}>👤 {clase.profesor}</p>}
                        {clase.aula && <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px' }}>📍 Aula {clase.aula}</p>}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => abrirModal(diaActivoMobile, clase)}
                            style={{ flex: 1, padding: '8px', borderRadius: '8px', border: `1px solid ${clase.color}44`, background: 'transparent', color: clase.color, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                            ✏️ Editar
                          </button>
                          <button onClick={() => eliminarClase(diaActivoMobile, clase.id)}
                            style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '13px', cursor: 'pointer' }}>
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}

        {/* DESKTOP: grid de 5 columnas */}
        {!isMobile && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '16px' }}>
            {DIAS.map(dia => {
              const esHoy = dia === diaHoy;
              const clases = horario[dia] || [];
              return (
                <div key={dia} style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `2px solid ${esHoy ? 'var(--gold)' : 'var(--border-color)'}`, overflow: 'hidden' }}>
                  <div style={{ height: '4px', background: esHoy ? 'var(--gold)' : 'var(--border-color)' }} />
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: esHoy ? 'var(--gold-dim)' : 'transparent' }}>
                    <div>
                      <h3 style={{ fontSize: '14px', fontWeight: 900, color: esHoy ? 'var(--gold)' : 'var(--text-primary)', margin: 0 }}>
                        {DIAS_LABELS[dia]}
                      </h3>
                      {esHoy && <p style={{ fontSize: '10px', color: 'var(--gold)', margin: 0, fontWeight: 700 }}>HOY</p>}
                    </div>
                    <button onClick={() => abrirModal(dia)}
                      style={{ width: '28px', height: '28px', borderRadius: '8px', border: 'none', background: esHoy ? 'var(--gold)' : 'var(--bg-secondary)', color: esHoy ? '#000' : 'var(--text-muted)', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, flexShrink: 0 }}>
                      +
                    </button>
                  </div>

                  <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '200px' }}>
                    {clases.length === 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100px', color: 'var(--text-faint)', fontSize: '13px', flexDirection: 'column', gap: '8px' }}>
                        <span style={{ fontSize: '24px' }}>📭</span>
                        Sin clases
                      </div>
                    ) : (
                      clases.map(clase => {
                        const estaEnCurso = esHoy && clase.horaInicio <= horaActual && clase.horaFin > horaActual;
                        return (
                          <div key={clase.id} style={{ borderRadius: '10px', border: `2px solid ${clase.color}`, background: clase.color + (estaEnCurso ? '35' : '15'), padding: '10px 12px', position: 'relative', boxShadow: estaEnCurso ? `0 4px 16px ${clase.color}44` : 'none' }}>
                            {estaEnCurso && (
                              <div style={{ position: 'absolute', top: 8, right: 8, width: '8px', height: '8px', borderRadius: '50%', background: clase.color }} />
                            )}
                            <p style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 3px', paddingRight: '12px' }}>
                              {clase.nombre}
                            </p>
                            <p style={{ fontSize: '11px', color: clase.color, fontWeight: 700, margin: '0 0 3px' }}>
                              {formatHora(clase.horaInicio)} - {formatHora(clase.horaFin)}
                            </p>
                            {clase.profesor && <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 2px' }}>👤 {clase.profesor}</p>}
                            {clase.aula && <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>📍 {clase.aula}</p>}
                            <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                              <button onClick={() => abrirModal(dia, clase)}
                                style={{ flex: 1, padding: '4px', borderRadius: '6px', border: `1px solid ${clase.color}44`, background: 'transparent', color: clase.color, fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                                ✏️
                              </button>
                              <button onClick={() => eliminarClase(dia, clase.id)}
                                style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '11px', cursor: 'pointer' }}>
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
            })}
          </div>
        )}

        {/* Resumen semanal - solo desktop */}
        {!isMobile && (
          <div style={{ marginTop: '32px', background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: 'var(--blue)' }} />
            <div style={{ padding: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 16px' }}>📊 Resumen semanal</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
                {DIAS.map(dia => {
                  const clases = horario[dia] || [];
                  const esHoy = dia === diaHoy;
                  return (
                    <div key={dia} style={{ textAlign: 'center', padding: '12px', background: esHoy ? 'var(--gold-dim)' : 'var(--bg-secondary)', borderRadius: '10px', border: `1px solid ${esHoy ? 'var(--gold-border)' : 'var(--border-color)'}` }}>
                      <p style={{ fontSize: '12px', fontWeight: 700, color: esHoy ? 'var(--gold)' : 'var(--text-muted)', margin: '0 0 6px' }}>
                        {DIAS_LABELS[dia].slice(0, 3).toUpperCase()}
                      </p>
                      <p style={{ fontSize: '28px', fontWeight: 900, color: esHoy ? 'var(--gold)' : 'var(--text-primary)', margin: '0 0 4px' }}>
                        {clases.length}
                      </p>
                      <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>
                        clase{clases.length !== 1 ? 's' : ''}
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '460px', border: '1px solid var(--border-color)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ height: '4px', background: formColor, borderRadius: '2px', marginBottom: '20px' }} />
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 20px' }}>
              {claseEditando ? '✏️ Editar' : '+ Nueva clase'} — {DIAS_LABELS[diaSeleccionado]}
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Nombre *</label>
                <input value={formNombre} onChange={e => setFormNombre(e.target.value)}
                  placeholder="Ej: Matemáticas..."
                  autoFocus
                  style={{ width: '100%', padding: '11px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => e.currentTarget.style.borderColor = formColor}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Inicio</label>
                  <select value={formInicio} onChange={e => setFormInicio(e.target.value)}
                    style={{ width: '100%', padding: '11px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}>
                    {HORAS.map(h => <option key={h} value={h}>{formatHora(h)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Fin</label>
                  <select value={formFin} onChange={e => setFormFin(e.target.value)}
                    style={{ width: '100%', padding: '11px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}>
                    {HORAS.map(h => <option key={h} value={h}>{formatHora(h)}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Profesor (opcional)</label>
                <input value={formProfesor} onChange={e => setFormProfesor(e.target.value)}
                  placeholder="Nombre del profesor"
                  style={{ width: '100%', padding: '11px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }} />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Aula (opcional)</label>
                <input value={formAula} onChange={e => setFormAula(e.target.value)}
                  placeholder="Ej: 101, Lab 3..."
                  style={{ width: '100%', padding: '11px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }} />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>Color</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {COLORES.map(c => (
                    <button key={c} onClick={() => setFormColor(c)}
                      style={{ width: '36px', height: '36px', borderRadius: '50%', background: c, border: formColor === c ? '3px solid var(--text-primary)' : '3px solid transparent', cursor: 'pointer', transform: formColor === c ? 'scale(1.2)' : 'scale(1)', transition: 'all 0.15s' }} />
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => setModalAbierto(false)}
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={guardarClase} disabled={!formNombre.trim()}
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: formNombre.trim() ? formColor : 'var(--bg-card2)', color: formNombre.trim() ? '#000' : 'var(--text-faint)', fontSize: '14px', fontWeight: 800, cursor: formNombre.trim() ? 'pointer' : 'not-allowed' }}>
                {claseEditando ? '✅ Guardar' : '+ Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}