'use client';
import { darXP } from '../../lib/xpClient';
import { dispararXPToast } from '../../components/XPToast';
import { useXP } from '../../hooks/useXP';

import { useState, useEffect, useCallback } from 'react';
import {
  Asignacion, ObjetivoAgenda,
  getAsignaciones, saveAsignaciones,
  getObjetivos, saveObjetivos,
  objetivoDesdeAsignacion, procesarVencidas,
  XP_TAMAÑO, genId,
} from '../../lib/agenda';
import { getMaterias } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { getAgendaDB, saveAgendaDB } from '../../lib/db';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
import Calendario from '../../components/agenda/Calendario';
import Objetivos from '../../components/agenda/Objetivos';
import PendientesSidebar from '../../components/agenda/PendientesSidebar';
import { ModalAsignacion, ModalObjetivo } from '../../components/agenda/ModalesAgenda';
import { syncLeaderboard } from '../../lib/syncLeaderboard';

const HAND = "'Caveat',cursive";

const hoyISO = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')}`;
};

export default function AgendaPage() {
  const [tab, setTab] = useState<'calendario'|'agenda'>('calendario');
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  const [objetivos,    setObjetivos]    = useState<ObjetivoAgenda[]>([]);
  const [materias,     setMaterias]     = useState<any[]>([]);
  const [hoy]  = useState(new Date());
  const [mes,  setMes]  = useState(hoy.getMonth());
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [diaSeleccionado, setDiaSeleccionado] = useState<string|null>(null);
  const [modalAsig, setModalAsig] = useState(false);
  const [modalObj,  setModalObj]  = useState(false);
  const [userId, setUserId] = useState<string|null>(null);
  const [toast,  setToast]  = useState<{msg: string; xp: number}|null>(null);
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  const { xpTotal: xpReal, nivel, xpEnNivel: xpNivel, xpParaSiguiente } = useXP();

  const hoyStr = hoyISO();

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          setUserId(data.user.id);
          const db = await getAgendaDB(data.user.id);
          let asigs = db.asignaciones.length ? db.asignaciones : getAsignaciones();
          let objs  = db.objetivos.length    ? db.objetivos    : getObjetivos();
          const { asigs: a2, objs: o2, cambio } = procesarVencidas(asigs, objs);
          setAsignaciones(a2); setObjetivos(o2);
          if (cambio) await saveAgendaDB(data.user.id, a2, o2);
        } else {
          const asigs = getAsignaciones();
          const objs  = getObjetivos();
          const { asigs: a2, objs: o2 } = procesarVencidas(asigs, objs);
          setAsignaciones(a2); setObjetivos(o2);
        }
      } catch {
        setAsignaciones(getAsignaciones());
        setObjetivos(getObjetivos());
      }
      setMaterias(getMaterias());
    };
    cargar();
  }, []);

  const showToast = (msg: string, xp: number) => {
    setToast({ msg, xp });
    setTimeout(() => setToast(null), 3000);
  };

  const persist = useCallback(async (a: Asignacion[], o: ObjetivoAgenda[]) => {
    setAsignaciones(a); saveAsignaciones(a);
    setObjetivos(o);    saveObjetivos(o);
    if (userId) {
      await saveAgendaDB(userId, a, o);
      await syncLeaderboard();
    }
  }, [userId]);

  const crearAsignacion = useCallback(async (asig: Asignacion) => {
    const obj = objetivoDesdeAsignacion(asig);
    await persist([...asignaciones, asig], [...objetivos, obj]);
    showToast(tr('agendaCreada'), asig.xp);
  }, [asignaciones, objetivos, persist, idioma]);

  const toggleAsignacion = useCallback(async (id: string) => {
    const asig = asignaciones.find(a => a.id === id);
    if (!asig) return;
    if (asig.vencida && !asig.completada) {
      showToast(tr('agendaVencida'), 0);
      return;
    }
    const ahoraCompleta = !asig.completada;
    const nuevasAsigs = asignaciones.map(a =>
      a.id === id ? { ...a, completada: ahoraCompleta, fechaCompletada: ahoraCompleta ? new Date().toISOString() : undefined } : a
    );
    const nuevosObjs = objetivos.map(o =>
      o.asignacionId === id ? { ...o, completado: ahoraCompleta } : o
    );
    await persist(nuevasAsigs, nuevosObjs);
    if (ahoraCompleta) {
      showToast(`✅ ${asig.titulo}`, asig.xp);
      darXP('objetivo', asig.xp, { tipo: 'asignacion', titulo: asig.titulo }).then(res => {
        dispararXPToast({
          xp: res.ok ? res.xpGanado : asig.xp,
          fuente: '📋 Asignación completada',
          emoji: '✅',
          color: '#4ade80',
          descripcion: asig.titulo,
        });
      });
    }
  }, [asignaciones, objetivos, persist, idioma]);

  const eliminarAsignacion = useCallback(async (id: string) => {
    await persist(
      asignaciones.filter(a => a.id !== id),
      objetivos.filter(o => o.asignacionId !== id),
    );
  }, [asignaciones, objetivos, persist]);

  const toggleObjetivo = useCallback(async (id: string) => {
    const obj = objetivos.find(o => o.id === id);
    if (!obj) return;
    if (obj.asignacionId) {
      await toggleAsignacion(obj.asignacionId);
      return;
    }
    const nuevo = !obj.completado;
    const nuevosObjs = objetivos.map(o => o.id === id ? { ...o, completado: nuevo } : o);
    await persist(asignaciones, nuevosObjs);
    if (nuevo) {
      showToast(`✅ ${obj.titulo}`, obj.xp);
      darXP('objetivo', obj.xp, { tipo: 'objetivo', titulo: obj.titulo }).then(res => {
        dispararXPToast({
          xp: res.ok ? res.xpGanado : obj.xp,
          fuente: '🎯 Objetivo completado',
          emoji: obj.xp >= 250 ? '🏆' : obj.xp >= 120 ? '⭐' : '✅',
          color: obj.xp >= 250 ? '#fbbf24' : obj.xp >= 120 ? '#a78bfa' : '#4ade80',
          descripcion: obj.titulo,
        });
      });
    }
  }, [objetivos, asignaciones, persist, toggleAsignacion]);

  const eliminarObjetivo = useCallback(async (id: string) => {
    const obj = objetivos.find(o => o.id === id);
    if (!obj) return;
    if (obj.asignacionId) {
      await persist(
        asignaciones.filter(a => a.id !== obj.asignacionId),
        objetivos.filter(o => o.id !== id && o.asignacionId !== obj.asignacionId),
      );
    } else {
      await persist(asignaciones, objetivos.filter(o => o.id !== id));
    }
    showToast(`🗑️ Eliminado`, 0);
  }, [objetivos, asignaciones, persist]);

  const cambiarMes = (dir: 1 | -1) => {
    let m = mes + dir, a = anio;
    if (m < 0) { m = 11; a--; }
    if (m > 11) { m = 0; a++; }
    setMes(m); setAnio(a);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position:'relative' }}>

      {toast && (
        <div style={{
          position: 'fixed', top: '80px', right: '20px', zIndex: 9999,
          background: toast.xp > 0 ? 'var(--gold)' : 'var(--red)',
          color: '#000', padding: '14px 22px',
          borderRadius: '14px',
          border: '2.5px solid var(--text-primary)',
          fontFamily: HAND, fontWeight: 800, fontSize: '18px',
          boxShadow: '4px 5px 0 var(--text-primary), 0 12px 28px rgba(0,0,0,0.3)',
          animation: 'slideIn 0.35s cubic-bezier(.34,1.4,.64,1)',
          maxWidth: '300px',
          transform: 'rotate(-1.5deg)',
        }}>
          {toast.msg}{toast.xp > 0 && ` · ⭐ +${toast.xp} XP`}
        </div>
      )}

      {isMobile && <NavbarMobile />}

      {!isMobile && (
        <header style={{
          background: 'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
          backdropFilter: 'blur(14px)',
          borderBottom: '2.5px solid var(--text-primary)',
          padding: '0 36px', height: '64px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button onClick={() => window.location.href = '/'}
              style={{
                background: 'var(--bg-card)',
                border: '2px solid var(--text-primary)',
                color: 'var(--text-primary)',
                padding: '8px 16px', borderRadius: '10px',
                fontFamily: HAND, fontWeight: 800, fontSize: '17px',
                cursor: 'pointer',
                boxShadow: '2px 2px 0 var(--text-primary)',
                transform: 'rotate(-1deg)',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-1px)';}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';}}
            >
              ← StudyAL
            </button>
            <h1 style={{
              fontFamily: HAND, fontSize: '32px', fontWeight: 900,
              color: 'var(--text-primary)', margin: 0, lineHeight:1,
              transform:'rotate(-1deg)', display:'inline-block',
            }}>
              📅 {tr('agenda')}
            </h1>
          </div>
          <div style={{
            background: 'color-mix(in srgb,var(--gold) 16%,var(--bg-secondary))',
            border: '2px dashed var(--gold)',
            borderRadius: 10,
            padding: '6px 14px',
            transform: 'rotate(1.5deg)',
          }}>
            <span style={{ fontFamily:HAND, fontSize:'18px', color:'var(--gold)', fontWeight:800 }}>
              ⭐ {xpReal.toLocaleString()} XP
            </span>
          </div>
        </header>
      )}

      {/* Tabs estilo cuaderno */}
      <div style={{
        display: 'flex', gap: 8, padding: '14px 24px 0',
        background: 'var(--bg-primary)',
        position:'relative',
      }}>
        {[
          { id: 'calendario', label: tr('calendario'), emoji: '📅', color: 'var(--blue)' },
          { id: 'agenda',     label: tr('objetivos'),  emoji: '🎯', color: 'var(--pink)' },
        ].map((t, i) => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{
              padding: '10px 20px',
              background: tab === t.id ? t.color : 'var(--bg-card)',
              color: tab === t.id ? '#000' : 'var(--text-muted)',
              border: `2.5px solid ${tab === t.id ? t.color : 'var(--border-color)'}`,
              borderRadius: '12px 12px 4px 4px',
              fontFamily: HAND, fontSize: '20px', fontWeight: 800,
              cursor: 'pointer',
              boxShadow: tab===t.id ? '3px 3px 0 var(--text-primary)' : 'none',
              transform: tab===t.id
                ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg) translateY(-2px)`
                : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
              transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
              display:'flex', alignItems:'center', gap:6,
            }}>
            <span>{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{
        display: 'flex', gap: '24px',
        padding: isMobile ? '16px' : '24px',
        maxWidth: '1400px', margin: '0 auto',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {tab === 'calendario' && (
            <Calendario
              asignaciones={asignaciones}
              mes={mes} anio={anio} hoyStr={hoyStr}
              diaSeleccionado={diaSeleccionado}
              onDia={f => setDiaSeleccionado(prev => prev === f ? null : f)}
              onMes={cambiarMes}
            />
          )}
          {tab === 'agenda' && (
            <Objetivos
              objetivos={objetivos}
              asignaciones={asignaciones}
              xpTotal={xpReal}
              nivel={nivel}
              xpNivel={xpNivel}
              onToggle={toggleObjetivo}
              onEliminar={id => persist(asignaciones, objetivos.filter(o => o.id !== id))}
              onNuevo={() => setModalObj(true)}
            />
          )}
        </div>

        {!isMobile && (
          <div style={{ width: '320px', flexShrink: 0 }}>
            <PendientesSidebar
              asignaciones={asignaciones}
              objetivos={objetivos}
              hoyStr={hoyStr}
              diaSeleccionado={diaSeleccionado}
              onToggleAsig={toggleAsignacion}
              onEliminarAsig={eliminarAsignacion}
              onNuevaAsig={() => setModalAsig(true)}
              onSelectDia={f => setDiaSeleccionado(f)}
            />
          </div>
        )}
      </div>

      {isMobile && (
        <button
          onClick={() => tab === 'calendario' ? setModalAsig(true) : setModalObj(true)}
          style={{
            position: 'fixed', bottom: '90px', right: '20px',
            width: '60px', height: '60px', borderRadius: '50%',
            background: 'var(--gold)',
            border: '2.5px solid var(--text-primary)',
            fontFamily:HAND, fontSize: '32px', fontWeight: 900,
            cursor: 'pointer', zIndex: 200,
            boxShadow: '3px 4px 0 var(--text-primary), 0 8px 24px rgba(245,200,66,0.5)',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={(e:any)=>{e.currentTarget.style.transform='scale(1.1) rotate(8deg)';}}
          onMouseLeave={(e:any)=>{e.currentTarget.style.transform='scale(1) rotate(0deg)';}}
        >
          +
        </button>
      )}

      {modalAsig && (
        <ModalAsignacion
          materias={materias}
          fechaInicial={diaSeleccionado || hoyStr}
          onCrear={a => { crearAsignacion(a); setModalAsig(false); }}
          onClose={() => setModalAsig(false)}
        />
      )}
      {modalObj && (
        <ModalObjetivo
          onCrear={o => { persist(asignaciones, [...objetivos, o]); setModalObj(false); }}
          onClose={() => setModalObj(false)}
        />
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(110%) rotate(-1.5deg); opacity: 0; }
          to   { transform: translateX(0) rotate(-1.5deg);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
