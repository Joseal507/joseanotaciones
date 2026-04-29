'use client';

import { useState } from 'react';
import {
  CalificacionesMateria,
  Evaluacion,
  Nota,
  EscalaNotas,
  ESCALAS,
  getEscalaInfo,
  calcularResumen,
  promedioEvaluacion,
  contribucionEvaluacion,
  getFeedback,
  validarPorcentajes,
  valorALetra,
  letraAValor,
  genId,
} from '../../lib/calificaciones';

interface Props {
  calificaciones: CalificacionesMateria;
  colorMateria: string;
  onChange: (cal: CalificacionesMateria) => void;
}

// ────────────────────────────────────────────────────────
// Formateador de nota segun escala
// ────────────────────────────────────────────────────────
function formatNota(val: number | null, escala: EscalaNotas): string {
  if (val === null) return '—';
  if (escala === 'letras') return valorALetra(val);
  return String(Math.round(val * 10) / 10);
}

function colorNota(val: number, escala: EscalaNotas): string {
  const info = getEscalaInfo(escala);
  const ratio = val / info.max;
  if (ratio >= 0.8) return '#4ade80';
  if (ratio >= 0.6) return '#fbbf24';
  return '#f87171';
}

// ────────────────────────────────────────────────────────
// Barra de progreso
// ────────────────────────────────────────────────────────
function BarraProgreso({ valor, maximo, color, altura = 8 }: { valor: number; maximo: number; color: string; altura?: number }) {
  const pct = Math.min(100, Math.max(0, maximo > 0 ? (valor / maximo) * 100 : 0));
  return (
    <div style={{ width: '100%', height: altura, background: 'var(--bg-tertiary, #1e293b)', borderRadius: altura, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: altura, transition: 'width 0.4s ease' }} />
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Chip de nota
// ────────────────────────────────────────────────────────
function ChipNota({ nota, escala, onEliminar }: { nota: Nota; escala: EscalaNotas; onEliminar: () => void }) {
  const col = colorNota(nota.valor, escala);
  const display = escala === 'letras'
    ? `${valorALetra(nota.valor)} (${nota.valor})`
    : String(nota.valor);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: col + '22', border: `1.5px solid ${col}55`,
      borderRadius: 8, padding: '4px 10px', fontSize: 14, fontWeight: 700, color: col,
    }}>
      {display}
      {nota.etiqueta && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>{nota.etiqueta}</span>}
      <button onClick={onEliminar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 0 0 2px' }}>×</button>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Tarjeta de evaluacion
// ────────────────────────────────────────────────────────
function TarjetaEvaluacion({ evaluacion, colorMateria, escala, onAgregarNota, onEliminarNota, onEliminar }: {
  evaluacion: Evaluacion;
  colorMateria: string;
  escala: EscalaNotas;
  onAgregarNota: (ev: Evaluacion, valor: number, etiqueta: string) => void;
  onEliminarNota: (ev: Evaluacion, notaId: string) => void;
  onEliminar: () => void;
}) {
  const [inputValor, setInputValor] = useState('');
  const [inputEtiqueta, setInputEtiqueta] = useState('');
  const [errInput, setErrInput] = useState('');

  const info = getEscalaInfo(escala);
  const prom = promedioEvaluacion(evaluacion);
  const contrib = contribucionEvaluacion(evaluacion);
  const colProm = prom === null ? '#94a3b8' : colorNota(prom, escala);

  const handleAgregar = () => {
    if (escala === 'letras') {
      const numVal = letraAValor(inputValor);
      if (numVal === null) {
        setErrInput('Usa: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F');
        return;
      }
      setErrInput('');
      onAgregarNota(evaluacion, numVal, inputEtiqueta.trim());
      setInputValor('');
      setInputEtiqueta('');
      return;
    }

    const val = parseFloat(inputValor.replace(',', '.'));
    if (isNaN(val) || val < info.min || val > info.max) {
      setErrInput(`Ingresa una nota entre ${info.min} y ${info.max}`);
      return;
    }
    setErrInput('');
    onAgregarNota(evaluacion, val, inputEtiqueta.trim());
    setInputValor('');
    setInputEtiqueta('');
  };

  return (
    <div style={{
      background: 'var(--bg-secondary, #0f172a)',
      border: '1.5px solid var(--border-color, #1e293b)',
      borderRadius: 14, padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{evaluacion.nombre}</span>
          <span style={{
            fontSize: 12, fontWeight: 600, background: colorMateria + '22',
            color: colorMateria, borderRadius: 6, padding: '2px 8px', alignSelf: 'flex-start',
          }}>
            {evaluacion.porcentaje}% del total
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          {prom !== null ? (
            <>
              <span style={{ fontSize: 26, fontWeight: 800, color: colProm, lineHeight: 1 }}>
                {formatNota(prom, escala)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                aporta {contrib !== null ? (Math.round(contrib * 10) / 10).toFixed(1) : '—'} pts
              </span>
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sin notas</span>
          )}
          <button onClick={onEliminar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 12, padding: 0 }}>
            Eliminar
          </button>
        </div>
      </div>

      {prom !== null && <BarraProgreso valor={prom} maximo={info.max} color={colProm} />}

      {evaluacion.notas.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {evaluacion.notas.map(n => (
            <ChipNota key={n.id} nota={n} escala={escala} onEliminar={() => onEliminarNota(evaluacion, n.id)} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <input
          type={escala === 'letras' ? 'text' : 'number'}
          min={0}
          max={escala === 'letras' ? undefined : info.max}
          step={0.1}
          placeholder={escala === 'letras' ? 'Ej: A, B+, C-' : `Nota (${info.min}-${info.max})`}
          value={inputValor}
          onChange={e => { setInputValor(e.target.value); setErrInput(''); }}
          onKeyDown={e => e.key === 'Enter' && handleAgregar()}
          style={{
            width: escala === 'letras' ? 130 : 110, padding: '7px 10px', borderRadius: 8,
            border: errInput ? '1.5px solid #f87171' : '1.5px solid var(--border-color)',
            background: 'var(--bg-tertiary, #1e293b)', color: 'var(--text-primary)',
            fontSize: 14, fontWeight: 600, outline: 'none',
          }}
        />
        <input
          type="text" placeholder="Etiqueta (opcional)"
          value={inputEtiqueta}
          onChange={e => setInputEtiqueta(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAgregar()}
          style={{
            flex: 1, minWidth: 110, padding: '7px 10px', borderRadius: 8,
            border: '1.5px solid var(--border-color)',
            background: 'var(--bg-tertiary, #1e293b)', color: 'var(--text-primary)',
            fontSize: 14, outline: 'none',
          }}
        />
        <button onClick={handleAgregar} style={{
          background: colorMateria, border: 'none', borderRadius: 8,
          padding: '7px 14px', color: '#fff', fontWeight: 700, fontSize: 14,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          + Agregar
        </button>
      </div>
      {errInput && <span style={{ fontSize: 12, color: '#f87171' }}>{errInput}</span>}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Pantalla de configuracion inicial
// ────────────────────────────────────────────────────────
function PantallaSetup({ colorMateria, onConfirm }: {
  colorMateria: string;
  onConfirm: (escala: EscalaNotas, objetivo: number) => void;
}) {
  const [escala, setEscala] = useState<EscalaNotas>('1-100');
  const [objetivo, setObjetivo] = useState('');
  const [err, setErr] = useState('');

  const info = getEscalaInfo(escala);

  const handleConfirm = () => {
    if (escala === 'letras') {
      const val = letraAValor(objetivo);
      if (val === null) { setErr('Usa una letra valida: A+, A, B+, B, C, D, F...'); return; }
      onConfirm(escala, val);
      return;
    }
    const val = parseFloat(objetivo.replace(',', '.'));
    if (isNaN(val) || val < info.min || val > info.max) {
      setErr(`Ingresa un valor entre ${info.min} y ${info.max}`);
      return;
    }
    onConfirm(escala, val);
  };

  return (
    <div style={{
      maxWidth: 480, margin: '0 auto',
      background: 'var(--bg-secondary)', border: '1.5px solid var(--border-color)',
      borderRadius: 20, padding: '36px 32px',
      display: 'flex', flexDirection: 'column', gap: 28,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>
          Configurar calificaciones
        </h2>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
          Elige la escala de tu universidad y tu nota objetivo
        </p>
      </div>

      {/* Selector de escala */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          Escala de calificacion
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ESCALAS.map(e => (
            <button
              key={e.id}
              onClick={() => { setEscala(e.id); setObjetivo(''); setErr(''); }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px', borderRadius: 12,
                border: escala === e.id ? `2px solid ${colorMateria}` : '2px solid var(--border-color)',
                background: escala === e.id ? colorMateria + '15' : 'var(--bg-primary)',
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              <span style={{
                fontSize: 14, fontWeight: escala === e.id ? 700 : 500,
                color: escala === e.id ? colorMateria : 'var(--text-primary)',
              }}>
                {e.label}
              </span>
              {escala === e.id && (
                <span style={{ fontSize: 16, color: colorMateria }}>✓</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Input de nota objetivo */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          Nota objetivo (minima para aprobar)
        </label>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          {escala === 'letras'
            ? 'Ej: C, B-, A (la nota minima que quieres lograr)'
            : `Un valor entre ${info.min} y ${info.max}. Ej: ${info.aprobatorio}`
          }
        </p>
        <input
          type={escala === 'letras' ? 'text' : 'number'}
          min={escala === 'letras' ? undefined : info.min}
          max={escala === 'letras' ? undefined : info.max}
          step={0.1}
          placeholder={escala === 'letras' ? 'Ej: C' : `Ej: ${info.aprobatorio}`}
          value={objetivo}
          onChange={e => { setObjetivo(e.target.value); setErr(''); }}
          onKeyDown={e => e.key === 'Enter' && handleConfirm()}
          autoFocus
          style={{
            padding: '12px 16px', borderRadius: 12, fontSize: 18, fontWeight: 700,
            border: err ? '2px solid #f87171' : '2px solid var(--border-color)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)',
            outline: 'none', textAlign: 'center',
          }}
        />
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      <button
        onClick={handleConfirm}
        style={{
          padding: '14px', borderRadius: 14, border: 'none',
          background: colorMateria, color: '#fff', fontSize: 16,
          fontWeight: 800, cursor: 'pointer',
        }}
      >
        Comenzar seguimiento
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ────────────────────────────────────────────────────────
export default function TabCalificaciones({ calificaciones, colorMateria, onChange }: Props) {
  const [modalNuevaEv, setModalNuevaEv] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoPct, setNuevoPct] = useState('');
  const [errModal, setErrModal] = useState('');
  const [editandoObjetivo, setEditandoObjetivo] = useState(false);
  const [inputObjetivo, setInputObjetivo] = useState(String(calificaciones.notaObjetivo));
  const [editandoEscala, setEditandoEscala] = useState(false);

  // Si no esta configurado, mostrar setup
  if (!calificaciones.configurado) {
    return (
      <PantallaSetup
        colorMateria={colorMateria}
        onConfirm={(escala, objetivo) => {
          onChange({
            ...calificaciones,
            escala,
            notaObjetivo: objetivo,
            configurado: true,
          });
        }}
      />
    );
  }

  const escala = calificaciones.escala || '0-100';
  const info = getEscalaInfo(escala);
  const resumen = calcularResumen(calificaciones);
  const feedback = getFeedback(resumen);
  const pctUsado = resumen.totalPorcentaje;

  const guardarObjetivo = () => {
    if (escala === 'letras') {
      const val = letraAValor(inputObjetivo);
      if (val === null) return;
      onChange({ ...calificaciones, notaObjetivo: val });
      setEditandoObjetivo(false);
      return;
    }
    const val = parseFloat(inputObjetivo.replace(',', '.'));
    if (isNaN(val) || val < info.min || val > info.max) return;
    onChange({ ...calificaciones, notaObjetivo: val });
    setEditandoObjetivo(false);
  };

  const cambiarEscala = (nuevaEscala: EscalaNotas) => {
    const nuevaInfo = getEscalaInfo(nuevaEscala);
    // Ajustar objetivo si excede la nueva escala
    let nuevoObjetivo = calificaciones.notaObjetivo;
    if (nuevoObjetivo > nuevaInfo.max) nuevoObjetivo = nuevaInfo.aprobatorio;
    onChange({ ...calificaciones, escala: nuevaEscala, notaObjetivo: nuevoObjetivo });
    setEditandoEscala(false);
  };

  const crearEvaluacion = () => {
    if (!nuevoNombre.trim()) { setErrModal('El nombre es obligatorio'); return; }
    const pct = parseFloat(nuevoPct.replace(',', '.'));
    if (isNaN(pct) || pct <= 0 || pct > 100) { setErrModal('Porcentaje debe ser entre 1 y 100'); return; }
    const usados = validarPorcentajes(calificaciones.evaluaciones);
    if (usados + pct > 100) {
      setErrModal(`Solo quedan ${100 - usados}% disponibles`);
      return;
    }
    const nueva: Evaluacion = { id: genId(), nombre: nuevoNombre.trim(), porcentaje: pct, notas: [] };
    onChange({ ...calificaciones, evaluaciones: [...calificaciones.evaluaciones, nueva] });
    setNuevoNombre(''); setNuevoPct(''); setErrModal(''); setModalNuevaEv(false);
  };

  const eliminarEvaluacion = (id: string) => {
    if (!confirm('Eliminar esta evaluacion y todas sus notas?')) return;
    onChange({ ...calificaciones, evaluaciones: calificaciones.evaluaciones.filter(e => e.id !== id) });
  };

  const agregarNota = (ev: Evaluacion, valor: number, etiqueta: string) => {
    const nueva: Nota = { id: genId(), valor, fecha: new Date().toLocaleDateString('es-ES'), etiqueta: etiqueta || undefined };
    onChange({ ...calificaciones, evaluaciones: calificaciones.evaluaciones.map(e => e.id === ev.id ? { ...e, notas: [...e.notas, nueva] } : e) });
  };

  const eliminarNota = (ev: Evaluacion, notaId: string) => {
    onChange({ ...calificaciones, evaluaciones: calificaciones.evaluaciones.map(e => e.id === ev.id ? { ...e, notas: e.notas.filter(n => n.id !== notaId) } : e) });
  };

  const resetearConfig = () => {
    if (!confirm('Esto borrara todas las evaluaciones y notas. Continuar?')) return;
    onChange({ notaObjetivo: 71, evaluaciones: [], escala: '0-100', configurado: false });
  };

  const objetivoDisplay = escala === 'letras'
    ? valorALetra(calificaciones.notaObjetivo)
    : calificaciones.notaObjetivo;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* BANNER RESUMEN */}
      <div style={{
        background: feedback.color + '15',
        border: `2px solid ${feedback.color}44`,
        borderRadius: 16, padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {/* Escala + reset (arriba) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Escala:</span>
            {editandoEscala ? (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {ESCALAS.map(e => (
                  <button
                    key={e.id}
                    onClick={() => cambiarEscala(e.id)}
                    style={{
                      padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      border: escala === e.id ? `1.5px solid ${colorMateria}` : '1.5px solid var(--border-color)',
                      background: escala === e.id ? colorMateria + '22' : 'var(--bg-primary)',
                      color: escala === e.id ? colorMateria : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {e.label}
                  </button>
                ))}
                <button onClick={() => setEditandoEscala(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            ) : (
              <button
                onClick={() => setEditandoEscala(true)}
                style={{
                  background: colorMateria + '22', border: `1px solid ${colorMateria}44`,
                  borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 700,
                  color: colorMateria, cursor: 'pointer',
                }}
              >
                {info.label} ✏️
              </button>
            )}
          </div>
          <button onClick={resetearConfig} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-faint)', fontSize: 11,
          }}>
            Reconfigurar
          </button>
        </div>

        {/* Promedio + Objetivo */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
              Promedio actual
            </span>
            <span style={{ fontSize: 42, fontWeight: 900, color: feedback.color, lineHeight: 1 }}>
              {formatNota(resumen.promedioActual, escala)}
            </span>
            {escala === 'letras' && resumen.promedioActual !== null && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({resumen.promedioActual} pts)</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
              Nota objetivo
            </span>
            {editandoObjetivo ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type={escala === 'letras' ? 'text' : 'number'}
                  value={inputObjetivo} autoFocus
                  onChange={e => setInputObjetivo(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && guardarObjetivo()}
                  placeholder={escala === 'letras' ? 'Ej: C' : `Max: ${info.max}`}
                  style={{
                    width: 80, padding: '4px 8px', borderRadius: 8,
                    border: '1.5px solid var(--border-color)',
                    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                    fontSize: 20, fontWeight: 700, textAlign: 'center', outline: 'none',
                  }}
                />
                <button onClick={guardarObjetivo} style={{ background: colorMateria, border: 'none', borderRadius: 6, padding: '4px 10px', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>✓</button>
                <button onClick={() => setEditandoObjetivo(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setInputObjetivo(escala === 'letras' ? valorALetra(calificaciones.notaObjetivo) : String(calificaciones.notaObjetivo));
                  setEditandoObjetivo(true);
                }}
                style={{
                  background: 'none', border: '1.5px dashed var(--border-color)',
                  borderRadius: 8, padding: '4px 16px',
                  color: 'var(--text-primary)', fontSize: 28, fontWeight: 800, cursor: 'pointer',
                }}
                title="Editar nota objetivo"
              >
                {objetivoDisplay}
              </button>
            )}
          </div>
        </div>

        {/* Barra */}
        {resumen.promedioActual !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <BarraProgreso valor={resumen.promedioActual} maximo={calificaciones.notaObjetivo} color={feedback.color} altura={10} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
              <span>0</span>
              <span>Objetivo: {objetivoDisplay}</span>
            </div>
          </div>
        )}

        {/* Feedback */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{feedback.emoji}</span>
          <span style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>{feedback.mensaje}</span>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '8px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Cubierto</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: colorMateria }}>{resumen.porcentajeCubierto}%</div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '8px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Pendiente</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{resumen.porcentajePendiente}%</div>
          </div>
          {resumen.necesitaParaAprobar !== null && !resumen.yaAprobado && (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '8px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Necesitas en lo que falta</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: resumen.imposibleAprobar ? '#f87171' : '#fbbf24' }}>
                {formatNota(resumen.necesitaParaAprobar, escala)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* HEADER EVALUACIONES */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Evaluaciones</h3>
          <span style={{ fontSize: 12, color: pctUsado > 100 ? '#f87171' : 'var(--text-muted)' }}>
            {pctUsado}% asignado
            {pctUsado < 100 ? ` — quedan ${100 - pctUsado}%` : pctUsado === 100 ? ' — completo ✓' : ' — supera 100% ⚠️'}
          </span>
        </div>
        <button onClick={() => setModalNuevaEv(true)} style={{
          background: colorMateria, border: 'none', borderRadius: 10,
          padding: '8px 16px', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}>
          + Nueva evaluacion
        </button>
      </div>

      {/* LISTA */}
      {calificaciones.evaluaciones.length === 0 ? (
        <div style={{
          background: 'var(--bg-secondary)', borderRadius: 14,
          padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>No hay evaluaciones todavia</p>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>Agrega examenes, tareas u otros componentes</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {calificaciones.evaluaciones.map(ev => (
            <TarjetaEvaluacion
              key={ev.id}
              evaluacion={ev}
              colorMateria={colorMateria}
              escala={escala}
              onAgregarNota={agregarNota}
              onEliminarNota={eliminarNota}
              onEliminar={() => eliminarEvaluacion(ev.id)}
            />
          ))}
        </div>
      )}

      {/* MODAL NUEVA EVALUACION */}
      {modalNuevaEv && (
        <div
          onClick={() => { setModalNuevaEv(false); setErrModal(''); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '0 16px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', border: '1.5px solid var(--border-color)',
              borderRadius: 16, padding: '28px', width: '100%', maxWidth: 420,
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Nueva evaluacion</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Nombre</label>
              <input
                autoFocus type="text"
                placeholder="Ej: Examen parcial, Tarea 1..."
                value={nuevoNombre}
                onChange={e => { setNuevoNombre(e.target.value); setErrModal(''); }}
                onKeyDown={e => e.key === 'Enter' && crearEvaluacion()}
                style={{
                  padding: '10px 14px', borderRadius: 10,
                  border: '1.5px solid var(--border-color)',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  fontSize: 15, outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
                Porcentaje — quedan {100 - pctUsado}% disponibles
              </label>
              <input
                type="number" min={1} max={100 - pctUsado}
                placeholder={`Maximo ${100 - pctUsado}%`}
                value={nuevoPct}
                onChange={e => { setNuevoPct(e.target.value); setErrModal(''); }}
                onKeyDown={e => e.key === 'Enter' && crearEvaluacion()}
                style={{
                  padding: '10px 14px', borderRadius: 10,
                  border: '1.5px solid var(--border-color)',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  fontSize: 15, outline: 'none',
                }}
              />
            </div>

            {errModal && (
              <div style={{ background: '#f8717122', border: '1.5px solid #f8717155', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#f87171' }}>
                {errModal}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Sugerencias:</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { nombre: 'Examen final', pct: 40 },
                  { nombre: 'Parcial', pct: 30 },
                  { nombre: 'Tareas', pct: 20 },
                  { nombre: 'Participacion', pct: 10 },
                  { nombre: 'Quizzes', pct: 15 },
                  { nombre: 'Proyecto', pct: 25 },
                  { nombre: 'Laboratorio', pct: 15 },
                ].filter(s => s.pct <= 100 - pctUsado).map(s => (
                  <button
                    key={s.nombre}
                    onClick={() => { setNuevoNombre(s.nombre); setNuevoPct(String(s.pct)); setErrModal(''); }}
                    style={{
                      background: colorMateria + '22', border: `1.5px solid ${colorMateria}44`,
                      borderRadius: 8, padding: '4px 10px', color: colorMateria,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {s.nombre} ({s.pct}%)
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setModalNuevaEv(false); setErrModal(''); setNuevoNombre(''); setNuevoPct(''); }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10,
                  border: '1.5px solid var(--border-color)', background: 'none',
                  color: 'var(--text-muted)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={crearEvaluacion}
                style={{
                  flex: 2, padding: '10px', borderRadius: 10, border: 'none',
                  background: colorMateria, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}
              >
                Crear evaluacion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
