'use client';

import { Asignacion } from '../../lib/agenda';
import { useIdioma } from '../../hooks/useIdioma';

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
    <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
      <div style={{ height: '4px', background: 'var(--blue)' }} />
      <div style={{ padding: '24px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <button onClick={() => onMes(-1)}
            style={{ padding: '8px 16px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer', fontWeight: 700 }}>
            ←
          </button>
          <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
            {MESES[mes]} {anio}
          </h2>
          <button onClick={() => onMes(1)}
            style={{ padding: '8px 16px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer', fontWeight: 700 }}>
            →
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px' }}>
          {DIAS.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', padding: '4px 0', textTransform: 'uppercase' }}>
              {d}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
          {diasCalendario.map((dia, i) => {
            if (!dia) return <div key={i} />;
            const fStr = fechaStr(dia);
            const asigs = asigsDia(dia);
            const esHoy = fStr === hoyStr;
            const esSel = fStr === diaSeleccionado;

            return (
              <div key={i} onClick={() => onDia(esSel ? '' : fStr)}
                style={{ borderRadius: '10px', padding: '6px 4px', textAlign: 'center', cursor: 'pointer', background: esHoy ? 'var(--gold)' : esSel ? 'var(--blue-dim)' : 'transparent', border: esSel ? '2px solid var(--blue)' : '2px solid transparent', transition: 'all 0.15s', position: 'relative' }}
                onMouseEnter={e => { if (!esHoy && !esSel) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-secondary)'; }}
                onMouseLeave={e => { if (!esHoy && !esSel) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}>
                <span style={{ fontSize: '14px', fontWeight: esHoy ? 900 : 600, color: esHoy ? '#000' : 'var(--text-primary)' }}>
                  {dia}
                </span>
                {asigs.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '2px', marginTop: '3px', flexWrap: 'wrap' }}>
                    {asigs.slice(0, 3).map((a, j) => (
                      <div key={j} style={{ width: '6px', height: '6px', borderRadius: '0px', background: a.completada ? 'var(--text-faint)' : a.materiaColor, opacity: a.completada ? 0.4 : 1, transform: 'rotate(45deg)' }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
          {TIPOS.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: t.color }} />
              <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}