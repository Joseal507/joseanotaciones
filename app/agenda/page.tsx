'use client';

import { useRouter } from 'next/navigation';
import { awardXPEvent } from '../../lib/xpClient';
import { xpEventId } from '../../lib/xpEvents';
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
import { useAuthenticatedStudyALUser } from '../../hooks/useAuthenticatedStudyALUser';
import { getAgendaDB, saveAgendaDB } from '../../lib/db';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
import Calendario from '../../components/agenda/Calendario';
import Objetivos from '../../components/agenda/Objetivos';
import PendientesSidebar from '../../components/agenda/PendientesSidebar';
import { ModalAsignacion, ModalObjetivo } from '../../components/agenda/ModalesAgenda';
import { syncLeaderboard } from '../../lib/syncLeaderboard';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

const hoyISO = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')}`;
};

export default function AgendaPage() {
  const router = useRouter();
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
  const { user, status: authStatus } = useAuthenticatedStudyALUser();

  const hoyStr = hoyISO();

  useEffect(() => {
    const cargar = async () => {
      try {
        if (user) {
          setUserId(user.id);
          const db = await getAgendaDB(user.id);
          let asigs = db.asignaciones.length ? db.asignaciones : getAsignaciones();
          let objs  = db.objetivos.length    ? db.objetivos    : getObjetivos();
          const { asigs: a2, objs: o2, cambio } = procesarVencidas(asigs, objs);
          setAsignaciones(a2); setObjetivos(o2);
          if (cambio) await saveAgendaDB(user.id, a2, o2);
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
    if (authStatus !== 'loading') cargar();
  }, [authStatus, user]);

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
      awardXPEvent({ eventId: xpEventId('assignment_completed', asig.id), action: 'assignment_completed', entityType: 'assignment', entityId: asig.id, metadata: { size: asig.tamaño } }).then(res => {
        dispararXPToast({
          xp: res.success ? res.awardedXP : 0,
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
      awardXPEvent({ eventId: xpEventId('objective_completed', obj.id), action: 'objective_completed', entityType: 'objective', entityId: obj.id, metadata: { size: obj.tamaño || 'pequeño' } }).then(res => {
        dispararXPToast({
          xp: res.success ? res.awardedXP : 0,
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

      {/* Toast con vibra cuaderno */}
      {toast && (
        <div style={{
          position: 'fixed', top: '80px', right: '20px', zIndex: 9999,
          background: toast.xp > 0 ? 'var(--gold)' : 'var(--red)',
          color: '#000',
          padding: '12px 20px',
          borderRadius: '12px',
          fontFamily: HAND,
          fontWeight: 800, fontSize: '17px',
          border: '2.5px solid var(--text-primary)',
          boxShadow: '4px 5px 0 var(--text-primary), 0 8px 32px rgba(0,0,0,0.3)',
          transform: 'rotate(-2deg)',
          animation: 'slideInToast 0.4s cubic-bezier(.34,1.56,.64,1)',
          maxWidth: '280px',
        }}>
          {toast.msg}{toast.xp > 0 && ` · ⭐ +${toast.xp} XP`}
        </div>
      )}

      {isMobile && <NavbarMobile />}

      {/* HEADER vibra cuaderno desktop */}
      {!isMobile && (
        <header style={{
          position:'sticky', top:0, zIndex:100,
          background:'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
          backdropFilter:'blur(14px)',
          borderBottom:'2.5px solid var(--text-primary)',
          padding:'12px 36px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          gap:16,
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:14 }}>
            <button onClick={() => {
                try { (window as any).__showNavLoader?.('/'); } catch {}
                const fallback = setTimeout(() => { if (window.location.pathname !== '/') window.location.href = '/'; }, 700);
                try { router.push('/'); setTimeout(() => clearTimeout(fallback), 750); }
                catch { clearTimeout(fallback); window.location.href = '/'; }
              }}
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
              ← StudyAL
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
                📅 {tr('agenda')}
              </h1>
              <svg width="120" height="6" style={{ display:'block', marginTop:2 }}>
                <path d="M2 3 Q 60 0 118 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
              </svg>
            </div>
          </div>

          <div style={{
            background: 'color-mix(in srgb,var(--gold) 16%,var(--bg-card))',
            border: '2.5px solid var(--gold)',
            borderRadius: 10,
            padding: '6px 14px',
            boxShadow: '3px 3px 0 var(--text-primary)',
            transform: 'rotate(1.5deg)',
          }}>
            <div style={{ fontFamily: BODY, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1 }}>
              XP total
            </div>
            <div style={{ fontFamily: HAND, fontSize: 22, fontWeight: 900, color: 'var(--gold)', lineHeight: 1.1 }}>
              ⭐ {xpReal.toLocaleString()}
            </div>
          </div>
        </header>
      )}

      {/* Línea rasgada debajo del header */}
      <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{
        display:'block', width:'100%', height:14,
      }}>
        <path
          d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
          fill="none"
          stroke="var(--text-primary)"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.45"
        />
      </svg>

      {/* TABS estilo pestañas de cuaderno */}
      <div style={{
        display: 'flex', gap: 8,
        padding: isMobile ? '14px 16px 4px' : '18px 32px 4px',
        maxWidth: 1400, margin: '0 auto',
        flexWrap: 'wrap',
      }}>
        {[
          { id: 'calendario', label: tr('calendario'), emoji: '📅', color: 'var(--blue)' },
          { id: 'agenda',     label: tr('objetivos'),  emoji: '🎯', color: 'var(--pink)' },
        ].map((t, i) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              style={{
                padding: '10px 22px',
                background: active ? t.color : 'var(--bg-card)',
                color: active ? '#000' : 'var(--text-muted)',
                border: `2.5px solid ${active ? t.color : 'var(--border-color)'}`,
                borderRadius: 12,
                cursor: 'pointer',
                fontFamily: HAND,
                fontSize: 20, fontWeight: 800,
                display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: active ? '3px 4px 0 var(--text-primary)' : 'none',
                transform: active
                  ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                  : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
                transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{
                if (!active) e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
              }}
              onMouseLeave={(e:any)=>{
                e.currentTarget.style.transform = active
                  ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                  : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`;
              }}
            >
              <span style={{ fontSize: 20 }}>{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* CONTENIDO */}
      <div style={{
        display: 'flex', gap: 24,
        padding: isMobile ? '16px' : '24px 32px 60px',
        maxWidth: 1400, margin: '0 auto',
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
          <div style={{ width: 300, flexShrink: 0 }}>
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

      {/* FAB mobile vibra cuaderno */}
      {isMobile && (
        <button
          onClick={() => tab === 'calendario' ? setModalAsig(true) : setModalObj(true)}
          style={{
            position: 'fixed', bottom: 90, right: 20,
            width: 60, height: 60, borderRadius: '50%',
            background: 'var(--gold)',
            border: '2.5px solid var(--text-primary)',
            fontSize: 28,
            cursor: 'pointer',
            zIndex: 200,
            boxShadow: '4px 5px 0 var(--text-primary), 0 8px 24px color-mix(in srgb, var(--gold) 40%, transparent)',
            transform: 'rotate(-3deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseDown={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) scale(0.95)';}}
          onMouseUp={(e:any)=>{e.currentTarget.style.transform='rotate(-3deg)';}}
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
        @keyframes slideInToast {
          from { transform: rotate(0deg) translateX(110%); opacity: 0; }
          to   { transform: rotate(-2deg) translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
