'use client';
import { getLevelFromXp, getLevelProgress, getXpInCurrentLevel, getXpNeededForNextLevel } from '../../lib/xpSystem';
import { darXP } from '../../lib/xpClient';
import { dispararXPToast } from '../../components/XPToast';

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

  const hoyStr = hoyISO();
  const xpObjetivos = objetivos.filter(o => o.completado).reduce((s, o) => s + o.xp, 0);
  const [xpReal, setXpReal] = useState(0);

  useEffect(() => {
    const cargarXP = async () => {
      try {
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        if (!token) { setXpReal(xpObjetivos); return; }
        const res = await fetch('/api/xp', { headers: { Authorization: 'Bearer ' + token } });
        if (res.ok) {
          const data = await res.json();
          if (data.ok && typeof data.xp_total === 'number') {
            setXpReal(data.xp_total);
            return;
          }
        }
        setXpReal(xpObjetivos);
      } catch {
        setXpReal(xpObjetivos);
      }
    };
    cargarXP();
  }, []);

  const nivel = getLevelFromXp(xpReal);
  const xpNivel = getXpInCurrentLevel(xpReal);
  const xpParaSiguiente = getXpNeededForNextLevel(xpReal);

  // ── Carga inicial ────────────────────────────────────────────
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

  // ── Toast helper ─────────────────────────────────────────────
  const showToast = (msg: string, xp: number) => {
    setToast({ msg, xp });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Persistir ────────────────────────────────────────────────
  const persist = useCallback(async (a: Asignacion[], o: ObjetivoAgenda[]) => {
    setAsignaciones(a); saveAsignaciones(a);
    setObjetivos(o);    saveObjetivos(o);
    if (userId) {
      await saveAgendaDB(userId, a, o);
      await syncLeaderboard();
    }
  }, [userId]);

  // ── Crear asignación → también crea objetivo vinculado ───────
  const crearAsignacion = useCallback(async (asig: Asignacion) => {
    const obj = objetivoDesdeAsignacion(asig);
    await persist([...asignaciones, asig], [...objetivos, obj]);
    showToast(idioma === 'en' ? 'Assignment created' : 'Asignación creada', asig.xp);
  }, [asignaciones, objetivos, persist, idioma]);

  // ── Toggle asignación → sincroniza objetivo ──────────────────
  const toggleAsignacion = useCallback(async (id: string) => {
    const asig = asignaciones.find(a => a.id === id);
    if (!asig) return;
    if (asig.vencida && !asig.completada) {
      showToast(idioma === 'en' ? '⛔ Expired! No XP awarded' : '⛔ ¡Vencida! No se otorga XP', 0);
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

  // ── Eliminar asignación → también elimina su objetivo ────────
  const eliminarAsignacion = useCallback(async (id: string) => {
    await persist(
      asignaciones.filter(a => a.id !== id),
      objetivos.filter(o => o.asignacionId !== id),
    );
  }, [asignaciones, objetivos, persist]);

  // ── Toggle objetivo libre ────────────────────────────────────
  const toggleObjetivo = useCallback(async (id: string) => {
    const obj = objetivos.find(o => o.id === id);
    if (!obj) return;
    // Si está vinculado a asignación, redirigir al toggle de asignación
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

  // ── Eliminar objetivo (libre o vinculado) ──────────────────
  const eliminarObjetivo = useCallback(async (id: string) => {
    const obj = objetivos.find(o => o.id === id);
    if (!obj) return;
    if (obj.asignacionId) {
      // Borrar también la asignación vinculada
      await persist(
        asignaciones.filter(a => a.id !== obj.asignacionId),
        objetivos.filter(o => o.id !== id && o.asignacionId !== obj.asignacionId),
      );
    } else {
      await persist(asignaciones, objetivos.filter(o => o.id !== id));
    }
    showToast(`🗑️ Eliminado`, 0);
  }, [objetivos, asignaciones, persist]);

  // ── Cambiar mes ──────────────────────────────────────────────
  const cambiarMes = (dir: 1 | -1) => {
    let m = mes + dir, a = anio;
    if (m < 0) { m = 11; a--; }
    if (m > 11) { m = 0; a++; }
    setMes(m); setAnio(a);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '80px', right: '20px', zIndex: 9999,
          background: toast.xp > 0 ? 'var(--gold)' : '#ff4d6d',
          color: '#000', padding: '12px 20px', borderRadius: '14px',
          fontWeight: 900, fontSize: '15px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          animation: 'slideIn 0.3s ease',
          maxWidth: '260px',
        }}>
          {toast.msg}{toast.xp > 0 && ` · ⭐ +${toast.xp} XP`}
        </div>
      )}

      {isMobile && <NavbarMobile />}

      {/* Header desktop */}
      {!isMobile && (
        <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 32px', height: '62px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={() => window.location.href = '/'}
              style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '7px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              ← StudyAL
            </button>
            <h1 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>📅 Agenda</h1>
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>⭐ {xpObjetivos} XP total</span>
        </header>
      )}

      {/* Barra de colores */}
      <div style={{ display: 'flex', height: '3px' }}>
        {['var(--gold)','var(--red)','var(--blue)','var(--pink)'].map((c,i) => (
          <div key={i} style={{ flex: 1, background: c }} />
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', background: 'var(--bg-card)', padding: '0 24px' }}>
        {[
          { id: 'calendario', label: `📅 ${idioma === 'en' ? 'Calendar' : 'Calendario'}` },
          { id: 'agenda',     label: `✅ ${idioma === 'en' ? 'Goals' : 'Objetivos'}` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{
              padding: '14px 20px', border: 'none', background: 'transparent',
              borderBottom: tab === t.id ? '3px solid var(--gold)' : '3px solid transparent',
              color: tab === t.id ? 'var(--gold)' : 'var(--text-muted)',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer', marginBottom: '-2px',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      <div style={{ display: 'flex', gap: '24px', padding: isMobile ? '16px' : '24px', maxWidth: '1400px', margin: '0 auto' }}>

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
          <div style={{ width: '300px', flexShrink: 0 }}>
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

      {/* FAB mobile */}
      {isMobile && (
        <button
          onClick={() => tab === 'calendario' ? setModalAsig(true) : setModalObj(true)}
          style={{ position: 'fixed', bottom: '90px', right: '20px', width: '56px', height: '56px', borderRadius: '50%', background: 'var(--gold)', border: 'none', fontSize: '24px', cursor: 'pointer', zIndex: 200, boxShadow: '0 4px 20px rgba(245,200,66,0.4)' }}>
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
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
