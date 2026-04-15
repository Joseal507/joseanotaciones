'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getHorarioDB, Horario } from '../lib/db';
import { useIdioma } from '../hooks/useIdioma';

const DIAS_MAP: { [key: number]: keyof Horario } = {
  1: 'lunes', 2: 'martes', 3: 'miercoles', 4: 'jueves', 5: 'viernes'
};

const DIAS_LABELS_ES = { lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves', viernes: 'Viernes' };
const DIAS_LABELS_EN = { lunes: 'Monday', martes: 'Tuesday', miercoles: 'Wednesday', jueves: 'Thursday', viernes: 'Friday' };

const formatHora = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  const periodo = h >= 12 ? 'PM' : 'AM';
  const hora12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hora12}:${String(m).padStart(2, '0')} ${periodo}`;
};

export default function HorarioWidget() {
  const [horario, setHorario] = useState<Horario | null>(null);
  const [ahora, setAhora] = useState(new Date());
  const { idioma } = useIdioma();

  useEffect(() => {
    const cargar = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const h = await getHorarioDB(data.user.id);
      setHorario(h);
    };
    cargar();

    // Actualizar hora cada minuto
    const interval = setInterval(() => setAhora(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  if (!horario) return null;

  const diaSemana = ahora.getDay(); // 0=dom, 1=lun...
  const horaActualStr = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  const diaKey = DIAS_MAP[diaSemana];
  const DIAS_LABELS = idioma === 'en' ? DIAS_LABELS_EN : DIAS_LABELS_ES;

  // Si es fin de semana, buscar el próximo lunes
  const esFinDeSemana = diaSemana === 0 || diaSemana === 6;

  // Clases de hoy
  const clasesHoy = diaKey ? (horario[diaKey] || []) : [];

  // Clase en curso
  const claseEnCurso = clasesHoy.find(c => c.horaInicio <= horaActualStr && c.horaFin > horaActualStr);

  // Próxima clase
  const proximaClase = clasesHoy
    .filter(c => c.horaInicio > horaActualStr)
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))[0];

  // Próximas 3 clases del día
  const restoDia = clasesHoy
    .filter(c => c.horaFin > horaActualStr)
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio))
    .slice(0, 3);

  // Calcular minutos hasta próxima
  const minutosHasta = (hora: string) => {
    const [h, m] = hora.split(':').map(Number);
    const ahMin = ahora.getHours() * 60 + ahora.getMinutes();
    const clMin = h * 60 + m;
    return clMin - ahMin;
  };

  const tieneClasesHoy = clasesHoy.length > 0;

  if (!tieneClasesHoy && esFinDeSemana) {
    return (
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '4px', background: 'var(--gold)' }} />
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🏖️</div>
          <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            {idioma === 'en' ? 'Weekend!' : '¡Fin de semana!'}
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
            {idioma === 'en' ? 'No classes today. Enjoy!' : 'No hay clases hoy. ¡Descansa!'}
          </p>
        </div>
      </div>
    );
  }

  if (!tieneClasesHoy) {
    return (
      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '4px', background: 'var(--gold)' }} />
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
          <p style={{ fontSize: '14px', color: 'var(--text-faint)', margin: 0 }}>
            {idioma === 'en' ? 'No classes scheduled today' : 'Sin clases programadas hoy'}
          </p>
          <button onClick={() => window.location.href = '/horario'}
            style={{ marginTop: '10px', padding: '6px 16px', borderRadius: '8px', border: '1px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            {idioma === 'en' ? 'Set schedule →' : 'Configurar horario →'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
      <div style={{ height: '4px', background: 'var(--gold)' }} />
      <div style={{ padding: '16px 20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🗓️</span>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                {idioma === 'en' ? 'Today\'s Schedule' : 'Horario de hoy'}
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>
                {diaKey ? DIAS_LABELS[diaKey] : ''} · {ahora.toLocaleTimeString(idioma === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
          <button onClick={() => window.location.href = '/horario'}
            style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
            {idioma === 'en' ? 'Full schedule →' : 'Ver todo →'}
          </button>
        </div>

        {/* Clase en curso */}
        {claseEnCurso && (
          <div style={{ background: claseEnCurso.color + '20', border: `2px solid ${claseEnCurso.color}`, borderRadius: '12px', padding: '12px 16px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: claseEnCurso.color, animation: 'pulse-dot 1.5s infinite' }} />
              <span style={{ fontSize: '11px', fontWeight: 800, color: claseEnCurso.color, textTransform: 'uppercase', letterSpacing: '1px' }}>
                {idioma === 'en' ? '🔴 Now' : '🔴 Ahora'}
              </span>
            </div>
            <p style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{claseEnCurso.nombre}</p>
            <p style={{ fontSize: '12px', color: claseEnCurso.color, margin: 0, fontWeight: 600 }}>
              {formatHora(claseEnCurso.horaInicio)} - {formatHora(claseEnCurso.horaFin)}
              {claseEnCurso.aula && ` · ${idioma === 'en' ? 'Room' : 'Aula'} ${claseEnCurso.aula}`}
            </p>
          </div>
        )}

        {/* Próxima clase */}
        {proximaClase && !claseEnCurso && (
          <div style={{ background: 'var(--blue-dim)', border: '1px solid var(--blue-border)', borderRadius: '12px', padding: '12px 16px', marginBottom: '10px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--blue)', margin: '0 0 4px', textTransform: 'uppercase' }}>
              ⏰ {idioma === 'en' ? 'Next class' : 'Próxima clase'} · {minutosHasta(proximaClase.horaInicio)} {idioma === 'en' ? 'min' : 'min'}
            </p>
            <p style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{proximaClase.nombre}</p>
            <p style={{ fontSize: '12px', color: 'var(--blue)', margin: 0, fontWeight: 600 }}>
              {formatHora(proximaClase.horaInicio)} - {formatHora(proximaClase.horaFin)}
            </p>
          </div>
        )}

        {/* Resto del día */}
        {restoDia.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {restoDia.map((clase, i) => {
              const esActual = clase === claseEnCurso;
              const esProxima = clase === proximaClase;
              if (esActual) return null;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: esProxima ? clase.color + '15' : 'var(--bg-secondary)', borderRadius: '10px', border: `1px solid ${esProxima ? clase.color + '44' : 'var(--border-color)'}` }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: clase.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clase.nombre}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>
                      {formatHora(clase.horaInicio)} - {formatHora(clase.horaFin)}
                    </p>
                  </div>
                  {esProxima && (
                    <span style={{ fontSize: '10px', fontWeight: 800, color: clase.color, background: clase.color + '20', padding: '2px 8px', borderRadius: '6px', flexShrink: 0 }}>
                      {minutosHasta(clase.horaInicio)}{idioma === 'en' ? 'min' : 'min'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!restoDia.length && !claseEnCurso && (
          <p style={{ fontSize: '13px', color: 'var(--text-faint)', textAlign: 'center', margin: 0 }}>
            {idioma === 'en' ? '✅ No more classes today' : '✅ No hay más clases hoy'}
          </p>
        )}
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}