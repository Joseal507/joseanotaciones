'use client';

import { useState, useEffect } from 'react';
import {
  Asignacion, ObjetivoAgenda,
  getAsignaciones, saveAsignaciones,
  getObjetivos, saveObjetivos,
} from '../../lib/agenda';
import { getMaterias } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { getAgendaDB, saveAgendaDB } from '../../lib/db';
import Calendario from '../../components/agenda/Calendario';
import Objetivos from '../../components/agenda/Objetivos';
import PendientesSidebar from '../../components/agenda/PendientesSidebar';
import { ModalAsignacion, ModalObjetivo } from '../../components/agenda/ModalesAgenda';

export default function AgendaPage() {
  const [tab, setTab] = useState<'calendario' | 'agenda'>('calendario');
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  const [objetivos, setObjetivos] = useState<ObjetivoAgenda[]>([]);
  const [materias, setMaterias] = useState<any[]>([]);
  const [hoy] = useState(new Date());
  const [mes, setMes] = useState(hoy.getMonth());
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);
  const [modalAsig, setModalAsig] = useState(false);
  const [modalObj, setModalObj] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

  // Cargar datos
  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          setUserId(data.user.id);
          // Cargar desde Supabase
          const agendaDB = await getAgendaDB(data.user.id);
          if (agendaDB.asignaciones.length > 0 || agendaDB.objetivos.length > 0) {
            setAsignaciones(agendaDB.asignaciones);
            setObjetivos(agendaDB.objetivos);
          } else {
            // Migrar desde localStorage si hay datos
            const localAsig = getAsignaciones();
            const localObj = getObjetivos();
            if (localAsig.length > 0 || localObj.length > 0) {
              setAsignaciones(localAsig);
              setObjetivos(localObj);
              await saveAgendaDB(data.user.id, localAsig, localObj);
            }
          }
        } else {
          // Sin cuenta - usar localStorage
          setAsignaciones(getAsignaciones());
          setObjetivos(getObjetivos());
        }
      } catch {
        setAsignaciones(getAsignaciones());
        setObjetivos(getObjetivos());
      }
      setMaterias(getMaterias());
    };
    cargar();
  }, []);

  const xpTotal = objetivos.filter(o => o.completado).reduce((acc, o) => acc + o.xp, 0);
  const nivel = Math.floor(xpTotal / 100) + 1;
  const xpNivel = xpTotal % 100;

  // Guardar asignaciones en Supabase + localStorage
  const saveAsig = async (lista: Asignacion[]) => {
    setAsignaciones(lista);
    saveAsignaciones(lista);
    if (userId) {
      await saveAgendaDB(userId, lista, objetivos);
    }
  };

  // Guardar objetivos en Supabase + localStorage
  const saveObj = async (lista: ObjetivoAgenda[]) => {
    setObjetivos(lista);
    saveObjetivos(lista);
    if (userId) {
      await saveAgendaDB(userId, asignaciones, lista);
    }
  };

  const handleMes = (dir: 1 | -1) => {
    if (dir === -1) {
      if (mes === 0) { setMes(11); setAnio(a => a - 1); }
      else setMes(m => m - 1);
    } else {
      if (mes === 11) { setMes(0); setAnio(a => a + 1); }
      else setMes(m => m + 1);
    }
  };

  const handleSelectDia = (fecha: string) => {
    setDiaSeleccionado(fecha || null);
    if (fecha) {
      const d = new Date(fecha + 'T12:00:00');
      setMes(d.getMonth());
      setAnio(d.getFullYear());
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '32px 40px', fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={() => window.location.href = '/'}
              style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              ← Inicio
            </button>
            <div style={{ width: '4px', height: '40px', background: 'var(--gold)', borderRadius: '3px' }} />
            <div>
              <h1 style={{ fontSize: '26px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>📅 Agenda</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>Calendario y objetivos</p>
            </div>
          </div>

          {/* XP Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {userId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-faint)' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80' }} />
                Sincronizado ☁️
              </div>
            )}
            <div style={{ background: 'var(--bg-card)', borderRadius: '14px', padding: '12px 18px', border: '1px solid var(--gold-border)', minWidth: '200px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold)' }}>⭐ Nivel {nivel}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{xpTotal} XP</span>
              </div>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
                <div style={{ width: `${xpNivel}%`, height: '100%', background: 'var(--gold)', borderRadius: '8px', transition: 'width 0.5s' }} />
              </div>
            </div>
          </div>
        </div>

        {/* TABS */}
        <div style={{ display: 'flex', marginBottom: '28px', borderBottom: '2px solid var(--border-color)' }}>
          {[
            { id: 'calendario', label: '📅 Calendario', color: 'var(--blue)' },
            { id: 'agenda', label: '✅ Objetivos', color: 'var(--pink)' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              style={{ padding: '12px 28px', border: 'none', background: 'transparent', borderBottom: tab === t.id ? `3px solid ${t.color}` : '3px solid transparent', color: tab === t.id ? t.color : 'var(--text-muted)', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginBottom: '-2px' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* CALENDARIO */}
        {tab === 'calendario' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'flex-start' }}>
            <Calendario
              asignaciones={asignaciones}
              mes={mes}
              anio={anio}
              hoyStr={hoyStr}
              diaSeleccionado={diaSeleccionado}
              onDia={setDiaSeleccionado}
              onMes={handleMes}
            />
            <PendientesSidebar
              asignaciones={asignaciones}
              objetivos={objetivos}
              hoyStr={hoyStr}
              diaSeleccionado={diaSeleccionado}
              onToggleAsig={id => saveAsig(asignaciones.map(a => a.id === id ? { ...a, completada: !a.completada } : a))}
              onEliminarAsig={id => saveAsig(asignaciones.filter(a => a.id !== id))}
              onNuevaAsig={() => setModalAsig(true)}
              onSelectDia={handleSelectDia}
            />
          </div>
        )}

        {/* OBJETIVOS */}
        {tab === 'agenda' && (
          <Objetivos
            objetivos={objetivos}
            xpTotal={xpTotal}
            nivel={nivel}
            xpNivel={xpNivel}
            onToggle={id => saveObj(objetivos.map(o => o.id === id ? { ...o, completado: !o.completado } : o))}
            onEliminar={id => saveObj(objetivos.filter(o => o.id !== id))}
            onNuevo={() => setModalObj(true)}
          />
        )}
      </div>

      {/* MODALES */}
      {modalAsig && (
        <ModalAsignacion
          materias={materias}
          fechaInicial={diaSeleccionado || hoyStr}
          onCrear={a => { saveAsig([...asignaciones, a]); setModalAsig(false); }}
          onClose={() => setModalAsig(false)}
        />
      )}
      {modalObj && (
        <ModalObjetivo
          onCrear={o => { saveObj([...objetivos, o]); setModalObj(false); }}
          onClose={() => setModalObj(false)}
        />
      )}
    </div>
  );
}