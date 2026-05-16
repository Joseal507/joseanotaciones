'use client';

import { Asignacion } from '../../lib/agenda';
import { useIdioma } from '../../hooks/useIdioma';

const HAND = "'Caveat',cursive";

const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DIAS_ES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const DIAS_EN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const TIPOS_ES = [
  { id: 'tarea', label: '📝 Tarea', color: '#38bdf8' },
  { id: 'examen', label: '📋 Examen', color: '#ff4d6d' },
  { id: 'proyecto', label: '🛠️ Proyecto', color: '#f5c842' },
  { id: 'otro', label: '📌 Otro', color: '#a78bfa' },
];

const TIPOS_EN = [
  { id: 'tarea', label: '📝 Homework', color: '#38bdf8' },
  { id: 'examen', label: '📋 Exam', color: '#ff4d6d' },
  { id: 'proyecto', label: '🛠️ Project', color: '#f5c842' },
  { id: 'otro', label: '📌 Other', color: '#a78bfa' },
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
      borderRadius: 14,
      border: '2.5px solid var(--text-primary)',
      boxShadow: '5px 6px 0 var(--text-primary)',
      transform: 'rotate(-0.4deg)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* línea margen rojo cuaderno */}
      <div style={{
        position:'absolute', top:0, bottom:0, left:54,
        width:1.5, background:'#ef4444', opacity:0.3,
        pointerEvents:'none',
      }}/>

      <div style={{ padding: '22px 24px', position:'relative', zIndex:1 }}>

        {/* Header con navegación */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <button onClick={() => onMes(-1)}
            style={{
              padding: '8px 16px', borderRadius: 10,
              border: '2px solid var(--text-primary)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 22, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '2px 2px 0 var(--text-primary)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='translate(-1px,-1px)';e.currentTarget.style.boxShadow='3px 3px 0 var(--text-primary)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='2px 2px 0 var(--text-primary)';}}
          >
            ←
          </button>
          <h2 style={{
            fontFamily: HAND, fontSize: 36, fontWeight: 900,
            color: 'var(--text-primary)', margin: 0, lineHeight: 1,
            transform: 'rotate(-1.5deg)', display: 'inline-block',
          }}>
            {MESES[mes]} {anio}
          </h2>
          <button onClick={() => onMes(1)}
            style={{
              padding: '8px 16px', borderRadius: 10,
              border: '2px solid var(--text-primary)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 22, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '2px 2px 0 var(--text-primary)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='translate(-1px,-1px)';e.currentTarget.style.boxShadow='3px 3px 0 var(--text-primary)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='2px 2px 0 var(--text-primary)';}}
          >
            →
          </button>
        </div>

        {/* Días de la semana */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
          {DIAS.map(d => (
            <div key={d} style={{
              textAlign: 'center',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              color: 'var(--text-muted)',
              padding: '6px 0',
              borderBottom: '1.5px dashed var(--border-color)',
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* Días del mes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
          {diasCalendario.map((dia, i) => {
            if (!dia) return <div key={i} />;
            const fStr = fechaStr(dia);
            const asigs = asigsDia(dia);
            const esHoy = fStr === hoyStr;
            const esSel = fStr === diaSeleccionado;

            return (
              <div key={i} onClick={() => onDia(esSel ? '' : fStr)}
                style={{
                  borderRadius: 8,
                  padding: '6px 4px', minHeight: 52,
                  textAlign: 'center', cursor: 'pointer',
                  background: esHoy
                    ? 'var(--gold)'
                    : esSel
                      ? 'color-mix(in srgb,var(--blue) 15%,var(--bg-secondary))'
                      : 'var(--bg-secondary)',
                  border: esHoy
                    ? '2.5px solid var(--text-primary)'
                    : esSel
                      ? '2px solid var(--blue)'
                      : '1.5px solid var(--border-color)',
                  boxShadow: esHoy
                    ? '2px 2px 0 var(--text-primary)'
                    : esSel
                      ? '2px 2px 0 var(--blue)'
                      : 'none',
                  transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
                  position: 'relative',
                  transform: esHoy ? 'rotate(-1deg)' : 'none',
                }}
                onMouseEnter={e => {
                  if (!esHoy && !esSel) {
                    (e.currentTarget as HTMLDivElement).style.transform = 'translate(-1px,-1px)';
                    (e.currentTarget as HTMLDivElement).style.boxShadow = '2px 2px 0 var(--text-primary)';
                  }
                }}
                onMouseLeave={e => {
                  if (!esHoy && !esSel) {
                    (e.currentTarget as HTMLDivElement).style.transform = '';
                    (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                  }
                }}
              >
                <span style={{
                  fontFamily: HAND,
                  fontSize: 20, fontWeight: esHoy ? 900 : 700,
                  color: esHoy ? '#000' : 'var(--text-primary)',
                  lineHeight: 1,
                }}>
                  {dia}
                </span>
                {asigs.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 2, marginTop: 4, flexWrap: 'wrap' }}>
                    {asigs.slice(0, 3).map((a, j) => (
                      <div key={j} style={{
                        width: 7, height: 7, borderRadius: 2,
                        background: a.completada ? 'var(--text-faint)' : a.materiaColor,
                        opacity: a.completada ? 0.4 : 1,
                        border: '1px solid rgba(0,0,0,0.15)',
                      }} />
                    ))}
                    {asigs.length > 3 && (
                      <span style={{
                        fontFamily:HAND, fontSize: 10, fontWeight: 700,
                        color: 'var(--text-muted)', lineHeight: 1,
                      }}>
                        +{asigs.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Leyenda con vibra cuaderno */}
        <div style={{
          display: 'flex', gap: 14, marginTop: 18, flexWrap: 'wrap',
          padding: '10px 14px',
          background: 'var(--bg-secondary)',
          border: '1.5px dashed var(--border-color)',
          borderRadius: 10,
        }}>
          {TIPOS.map((t, i) => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              transform: `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: 3,
                background: t.color,
                border: '1px solid var(--text-primary)',
              }} />
              <span style={{
                fontFamily: HAND, fontSize: 15, fontWeight: 600,
                color: 'var(--text-muted)',
              }}>
                {t.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
