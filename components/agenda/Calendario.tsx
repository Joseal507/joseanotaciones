'use client';

import { Asignacion } from '../../lib/agenda';
import { useIdioma } from '../../hooks/useIdioma';

const HAND = "'Caveat',cursive";

const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DIAS_ES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const DIAS_EN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const TIPOS_ES = [
  { id: 'tarea',    label: '📝 Tarea',    color: '#38bdf8' },
  { id: 'examen',   label: '📋 Examen',   color: 'var(--red)' },
  { id: 'proyecto', label: '🛠️ Proyecto', color: 'var(--gold)' },
  { id: 'otro',     label: '📌 Otro',     color: '#a78bfa' },
];

const TIPOS_EN = [
  { id: 'tarea',    label: '📝 Homework', color: '#38bdf8' },
  { id: 'examen',   label: '📋 Exam',     color: 'var(--red)' },
  { id: 'proyecto', label: '🛠️ Project',  color: 'var(--gold)' },
  { id: 'otro',     label: '📌 Other',    color: '#a78bfa' },
];

interface Props {
  asignaciones: Asignacion[];
  mes: number;
  anio: number;
  hoyStr: string;
  diaSeleccionado: string | null;
  onDia: (fecha: string) => void;
  onMes: (dir: 1 | -1) => void;
}

export default function Calendario({ asignaciones, mes, anio, hoyStr, diaSeleccionado, onDia, onMes }: Props) {
  const { idioma } = useIdioma();
  const MESES = idioma === 'en' ? MESES_EN : MESES_ES;
  const DIAS = idioma === 'en' ? DIAS_EN : DIAS_ES;
  const TIPOS = idioma === 'en' ? TIPOS_EN : TIPOS_ES;

  const primerDia = new Date(anio, mes, 1).getDay();
  const diasEnMes = new Date(anio, mes + 1, 0).getDate();
  const diasCalendario: (number | null)[] = [
    ...Array(primerDia).fill(null),
    ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
  ];

  const fechaStr = (dia: number) =>
    `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

  const asigsDia = (dia: number) =>
    asignaciones.filter(a => a.fecha === fechaStr(dia));

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '2.5px solid var(--text-primary)',
      borderRadius: 14,
      boxShadow: '5px 6px 0 var(--text-primary)',
      transform: 'rotate(-0.4deg)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Línea margen rojo cuaderno */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        left: 56, width: 1.5,
        background: '#ef4444', opacity: 0.3,
        pointerEvents: 'none', zIndex: 0,
      }}/>

      {/* Banda título tipo cinta */}
      <div style={{
        background: 'linear-gradient(90deg, var(--blue) 0%, color-mix(in srgb,var(--blue) 70%,var(--pink)) 100%)',
        padding: '6px 24px',
        borderBottom: '2px solid var(--text-primary)',
      }}>
        <span style={{
          fontFamily: HAND, fontSize: 16, fontWeight: 800,
          color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.25)',
          fontStyle: 'italic',
        }}>
          ✦ Calendario de estudio ✦
        </span>
      </div>

      <div style={{ padding: '22px 26px 26px', position: 'relative', zIndex: 1 }}>

        {/* Navegación mes */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 22,
          gap: 12,
        }}>
          <button onClick={() => onMes(-1)} style={navBtn('left')}>
            ← {idioma === 'en' ? 'prev' : 'ant'}
          </button>

          <h2 style={{
            fontFamily: HAND,
            fontSize: 36, fontWeight: 900,
            color: 'var(--text-primary)',
            margin: 0, lineHeight: 1,
            transform: 'rotate(-1deg)',
            textAlign: 'center',
            position: 'relative',
          }}>
            {MESES[mes]} <span style={{ color: 'var(--gold)' }}>{anio}</span>
            <svg width="200" height="6" style={{ display: 'block', margin: '4px auto 0' }}>
              <path d="M2 3 Q 100 0 198 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
            </svg>
          </h2>

          <button onClick={() => onMes(1)} style={navBtn('right')}>
            {idioma === 'en' ? 'next' : 'sig'} →
          </button>
        </div>

        {/* Cabecera días */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 4,
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: '1.5px dashed var(--border-color)',
        }}>
          {DIAS.map((d, i) => (
            <div key={d} style={{
              textAlign: 'center',
              fontFamily: HAND,
              fontSize: 16, fontWeight: 800,
              color: i === 0 || i === 6 ? 'var(--red)' : 'var(--text-primary)',
              padding: '4px 0',
              transform: `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* Días */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 5,
        }}>
          {diasCalendario.map((dia, i) => {
            if (!dia) return <div key={i} />;
            const fStr = fechaStr(dia);
            const asigs = asigsDia(dia);
            const esHoy = fStr === hoyStr;
            const esSel = fStr === diaSeleccionado;
            const tieneAsigs = asigs.length > 0;
            const todasCompletas = tieneAsigs && asigs.every(a => a.completada);

            // rotación pseudo-aleatoria estable por día
            const rot = ((dia * 13) % 7 - 3) * 0.3;

            return (
              <div
                key={i}
                onClick={() => onDia(esSel ? '' : fStr)}
                style={{
                  position: 'relative',
                  borderRadius: 10,
                  padding: '6px 4px 8px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: esHoy
                    ? 'var(--gold)'
                    : esSel
                      ? 'color-mix(in srgb,var(--blue) 18%,var(--bg-secondary))'
                      : 'var(--bg-secondary)',
                  border: esHoy
                    ? '2.5px solid var(--text-primary)'
                    : esSel
                      ? '2.5px solid var(--blue)'
                      : '1.5px dashed var(--border-color)',
                  boxShadow: esHoy
                    ? '3px 3px 0 var(--text-primary)'
                    : esSel
                      ? '2px 3px 0 var(--blue)'
                      : 'none',
                  transform: esHoy
                    ? 'rotate(-2deg)'
                    : esSel
                      ? 'rotate(1deg)'
                      : `rotate(${rot}deg)`,
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                  minHeight: 56,
                }}
                onMouseEnter={(e:any)=>{
                  if (!esHoy && !esSel) {
                    e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
                    e.currentTarget.style.background = 'var(--bg-card)';
                  }
                }}
                onMouseLeave={(e:any)=>{
                  if (!esHoy && !esSel) {
                    e.currentTarget.style.transform = `rotate(${rot}deg)`;
                    e.currentTarget.style.background = 'var(--bg-secondary)';
                  }
                }}
              >
                {/* Número */}
                <span style={{
                  fontFamily: HAND,
                  fontSize: 18, fontWeight: esHoy ? 900 : 700,
                  color: esHoy ? '#000' : 'var(--text-primary)',
                  lineHeight: 1,
                  display: 'block',
                }}>
                  {dia}
                </span>

                {/* Indicador de hoy */}
                {esHoy && (
                  <span style={{
                    fontFamily: HAND, fontSize: 9, fontWeight: 800,
                    color: '#000', fontStyle: 'italic',
                    display: 'block', marginTop: 1, lineHeight: 1,
                  }}>
                    hoy
                  </span>
                )}

                {/* Asignaciones */}
                {tieneAsigs && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: 3,
                    marginTop: 4,
                    flexWrap: 'wrap',
                  }}>
                    {asigs.slice(0, 4).map((a, j) => (
                      <div key={j} style={{
                        width: 7, height: 7,
                        borderRadius: '50%',
                        background: a.completada ? 'var(--text-faint)' : a.materiaColor,
                        opacity: a.completada ? 0.5 : 1,
                        border: '1px solid rgba(0,0,0,0.2)',
                        boxShadow: a.completada ? 'none' : `0 0 4px ${a.materiaColor}88`,
                      }} />
                    ))}
                    {asigs.length > 4 && (
                      <span style={{
                        fontFamily: HAND, fontSize: 10, fontWeight: 700,
                        color: 'var(--text-muted)', lineHeight: 1,
                      }}>
                        +{asigs.length - 4}
                      </span>
                    )}
                  </div>
                )}

                {/* Marca de completado */}
                {todasCompletas && (
                  <div style={{
                    position: 'absolute',
                    top: 2, right: 4,
                    fontSize: 10,
                    color: 'var(--gold)',
                  }}>
                    ✓
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Leyenda tipos */}
        <div style={{
          marginTop: 22,
          paddingTop: 16,
          borderTop: '1.5px dashed var(--border-color)',
        }}>
          <p style={{
            fontFamily: HAND, fontSize: 14,
            color: 'var(--text-muted)', fontStyle: 'italic',
            margin: '0 0 8px',
          }}>
            ~ tipos de asignaciones ~
          </p>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {TIPOS.map((t, i) => (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                transform: `rotate(${i % 2 === 0 ? -1 : 1}deg)`,
              }}>
                <div style={{
                  width: 12, height: 12,
                  borderRadius: '50%',
                  background: t.color,
                  border: '1.5px solid var(--text-primary)',
                  boxShadow: `0 0 6px ${t.color}66`,
                }} />
                <span style={{
                  fontFamily: HAND, fontSize: 16, fontWeight: 700,
                  color: 'var(--text-primary)',
                }}>
                  {t.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Botones de navegación estilo cuaderno ──
function navBtn(side: 'left' | 'right'): React.CSSProperties {
  const rot = side === 'left' ? -2 : 2;
  return {
    padding: '8px 16px',
    borderRadius: 10,
    border: '2.5px solid var(--text-primary)',
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    fontFamily: HAND,
    fontSize: 16, fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '3px 3px 0 var(--text-primary)',
    transform: `rotate(${rot}deg)`,
    transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
    fontStyle: 'italic',
  };
}