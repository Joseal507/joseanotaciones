'use client';
import StudyLoader from '../components/StudyLoader';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Materia } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { getMateriasDB } from '../lib/db';
import { getObjetivos, ObjetivoAgenda } from '../lib/agenda';
import UserMenu from '../components/UserMenu';
import NotificacionesPanel from '../components/NotificacionesPanel';
import Buscador from '../components/Buscador';
import RachaWidget from '../components/RachaWidget';
import NotasRapidas from '../components/NotasRapidas';
import GraficasEstudio from '../components/GraficasEstudio';
import HorarioWidget from '../components/HorarioWidget';
import OnboardingCheck from '../components/OnboardingCheck';
import Footer from '../components/Footer';
import PlayerCard from '../components/PlayerCard';
import { BetaBadge } from '../components/BetaBanner';
import { useIsMobile } from '../hooks/useIsMobile';
import { useIdioma } from '../hooks/useIdioma';
import DailyReward, { shouldShowDailyReward } from '../components/DailyReward';
import { darXP } from '../lib/xpClient';

interface LeaderEntry {
  user_id: string;
  nombre: string;
  xp_total: number;
  flashcards_estudiadas?: number;
  racha_actual?: number;
  mejor_racha?: number;
  precision_global?: number;
  avatar_url?: string;
  carrera?: string;
  universidad?: string;
}

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

/* ─── Buscador modal ─── */
function BuscadorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,.55)',backdropFilter:'blur(4px)',display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:80 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ width:'100%',maxWidth:620,padding:'0 16px' }}>
        <Buscador onClose={onClose}/>
      </div>
    </div>
  );
}

/* ─── DiaFecha + WelcomeUser REDISEÑO SANS-SERIF ULTRA-NEGRITA ─── */
function DiaFecha({ lang }: { lang: string }) {
  const hoy = new Date();
  const dias = lang==='en'
    ? ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    : ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const meses = lang==='en'
    ? ['January','February','March','April','May','June','July','August','September','October','November','December']
    : ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  return (
    <p style={{
      fontFamily:BODY,
      fontSize: 13,
      fontWeight: 700,
      color: 'var(--text-faint)',
      textTransform: 'uppercase',
      letterSpacing: '1.5px',
      margin: 0,
    }}>
      {dias[hoy.getDay()]}, {hoy.getDate()} {lang==='en'?'OF':'DE'} {meses[hoy.getMonth()]}
    </p>
  );
}

function WelcomeUser({ name }: { name: string }) {
  return (
    <div>
      <div style={{
        fontFamily: BODY,
        fontSize: 13,
        color: 'var(--text-faint)',
        fontWeight: 800,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        lineHeight: 1,
        marginTop: 6,
      }}>
        welcome back
      </div>
      <div style={{
        fontFamily: BODY,
        fontSize: 42,
        fontWeight: 900,
        color: 'var(--text-primary)',
        lineHeight: 1,
        marginTop: 6,
        letterSpacing: '-1.5px',
      }}>
        {name || 'estudiante'}
      </div>
      <svg width="120" height="6" style={{ display:'block',marginTop:4 }}>
        <path d="M2 3 Q 60 0 118 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
      </svg>
    </div>
  );
}

/* ─── HorarioFlecha ─── */
function HorarioFlecha({ targetId, mob }: { targetId: string; mob: boolean }) {
  const click = () => {
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
  };
  return (
    <button onClick={click} className="hover3d" style={{
      background:'color-mix(in srgb,var(--gold) 22%,var(--bg-card))',
      border:'3px solid var(--gold)',
      borderRadius:14,padding:mob?'12px 20px':'clamp(8px,1.2vw,14px) clamp(10px,1.4vw,22px)',
      cursor:'pointer',display:'flex',alignItems:'center',gap:14,
      boxShadow:'5px 5px 0 var(--gold), 0 10px 24px color-mix(in srgb, var(--gold) 35%, transparent)',
      transform:'rotate(-2deg)',
      marginTop: mob ? 40 : 60,
      maxWidth:'100%',
    }}>
      <div style={{ display:'flex',flexDirection:'column',alignItems:'flex-start',gap:0 }}>
        <span style={{ fontFamily:BODY,fontSize:mob?16:'clamp(12px,1.2vw,18px)',fontWeight:700,color:'var(--text-muted)',fontStyle:'italic',lineHeight:1 }}>ir a</span>
        <span style={{ fontFamily:BODY,fontSize:mob?28:'clamp(20px,2.2vw,32px)',fontWeight:900,color:'var(--text-primary)',lineHeight:1.1,whiteSpace:'nowrap' }}>📅 horario</span>
      </div>
      <svg width="32" height="50" viewBox="0 0 32 50">
        <path d="M16 4 L 16 38" stroke="var(--gold)" strokeWidth="4" fill="none" strokeLinecap="round"/>
        <path d="M6 30 L 16 44 L 26 30" stroke="var(--gold)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

/* ─── CosasPorHacer ─── */
function CosasPorHacer({ onClick, mob }: { onClick: () => void; mob: boolean }) {
  const [tasks, setTasks] = useState<ObjetivoAgenda[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cargar = () => {
      try {
        const objs = getObjetivos().filter(o => !o.completado);
        objs.sort((a:any,b:any) => {
          const fa = a.fechaLimite || a.fecha_limite || '';
          const fb = b.fechaLimite || b.fecha_limite || '';
          if (!fa && !fb) return 0;
          if (!fa) return 1;
          if (!fb) return -1;
          return fa.localeCompare(fb);
        });
        setTasks(objs.slice(0, 5));
      } catch {}
      setLoading(false);
    };

    cargar();

    const onFocus = () => cargar();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'josea_objetivos') cargar();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') cargar(); };
    const onObjsChange = () => cargar();

    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('objetivos:changed', onObjsChange);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('objetivos:changed', onObjsChange);
    };
  }, []);
  return (
    <div onClick={onClick} style={{ cursor:'pointer',transition:'all .25s' }}
      onMouseEnter={(e:any)=>{e.currentTarget.style.transform='translateY(-2px)';}}
      onMouseLeave={(e:any)=>{e.currentTarget.style.transform='';}}
    >
      <h3 style={{ fontFamily:HAND,fontSize:mob?22:26,fontWeight:800,color:'var(--text-primary)',margin:'0 0 4px',lineHeight:1 }}>Cosas por hacer</h3>
      <svg width="140" height="5" style={{ display:'block',marginBottom:8 }}>
        <path d="M0 2.5Q70 .5 140 3" stroke="var(--red)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".7"/>
      </svg>
      {loading ? (
        <p style={{ fontFamily:BODY,fontSize:14,color:'var(--text-faint)',fontStyle:'italic',margin:0 }}>cargando...</p>
      ) : tasks.length===0 ? (
        <p style={{ fontFamily:BODY,fontSize:15,color:'var(--text-faint)',fontStyle:'italic',margin:0 }}>✨ ¡todo al día!</p>
      ) : (
        <ul style={{ listStyle:'none',padding:0,margin:0,display:'flex',flexDirection:'column',gap:5 }}>
          {tasks.map((t,i)=>(
            <li key={i} style={{ display:'flex',alignItems:'flex-start',gap:6,fontFamily:BODY,fontSize:mob?15:17,color:'var(--text-primary)',lineHeight:1.2 }}>
              <span style={{ color:'var(--red)',fontWeight:900,fontSize:18,lineHeight:1.05,flexShrink:0 }}>✱</span>
              <span style={{ flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textDecoration:'underline',textDecorationColor:'var(--text-faint)',textDecorationStyle:'dotted',textUnderlineOffset:2 }}>
                {t.titulo}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── FraseChapBot ─── */
function FraseChapBot({ onClick, mob, lang }: { onClick: () => void; mob: boolean; lang: string }) {
  return (
    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:6 }}>
      <div style={{
        position:'relative',background:'var(--pink-dim)',padding:'10px 14px',
        borderRadius:'2px 14px 2px 14px',fontFamily:HAND,
        fontSize:mob?15:18,color:'#831843',fontStyle:'italic',textAlign:'center',
        maxWidth:mob?160:200,transform:'rotate(3deg)',
        boxShadow:'2px 3px 8px rgba(0,0,0,.18)',lineHeight:1.2,fontWeight:700,
      }}>
        <div style={{ position:'absolute',top:-7,left:'56%',transform:'translateX(-50%) rotate(-3deg)',width:36,height:11,background:'rgba(244,114,182,.4)',borderRadius:1 }}/>
        {lang==='en'?'Ask the Chap!':'¡Pregúntale al Chap!'}
      </div>
      <svg width="34" height="20" viewBox="0 0 34 20">
        <path d="M17 2 Q 24 10 17 17" stroke="var(--pink)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".6"/>
        <path d="M11 13 L 17 19 L 23 13" stroke="var(--pink)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".6"/>
      </svg>
      <button onClick={onClick} style={{
        position:'relative',display:'flex',flexDirection:'column',alignItems:'center',gap:2,
        padding:mob?'12px 20px':'16px 28px',background:'var(--pink)',border:'none',
        borderRadius:'18px 18px 18px 4px',cursor:'pointer',
        boxShadow:'0 6px 0 #db2777,0 10px 28px rgba(244,114,182,.45)',
        transform:'rotate(-2deg)',transition:'all .22s cubic-bezier(.2,.8,.2,1)',
      }}
        onMouseOver={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-3px) scale(1.04)';}}
        onMouseOut={(e:any)=>{e.currentTarget.style.transform='rotate(-2deg)';}}
        onMouseDown={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(2px)';}}
        onMouseUp={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-3px) scale(1.04)';}}
      >
        <span style={{ fontSize:mob?28:34 }}>🤖</span>
        <span style={{ fontFamily:HAND,fontSize:mob?20:24,fontWeight:800,color:'#fff',textShadow:'0 1px 2px rgba(0,0,0,.3)' }}>ChapBot</span>
      </button>
    </div>
  );
}

/* ─── TimerButton ─── */
function TimerButton({ onClick, mob }: { onClick: () => void; mob: boolean }) {
  return (
    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:4 }}>
      <span style={{ fontFamily:HAND,fontSize:mob?14:16,color:'var(--text-muted)',fontStyle:'italic',transform:'rotate(-2deg)',display:'inline-block' }}>timer ↓</span>
      <button onClick={onClick} style={{
        width:mob?72:88,height:mob?72:88,borderRadius:'50%',
        background:'color-mix(in srgb,var(--bg-card) 88%,var(--red) 12%)',
        border:'2.5px solid var(--red)',cursor:'pointer',
        display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2,
        boxShadow:'0 5px 0 rgba(239,68,68,.45),0 8px 20px rgba(239,68,68,.2)',
        transform:'rotate(2deg)',transition:'all .2s cubic-bezier(.2,.8,.2,1)',
      }}
        onMouseOver={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-3px) scale(1.05)';}}
        onMouseOut={(e:any)=>{e.currentTarget.style.transform='rotate(2deg)';}}
      >
        <span style={{ fontSize:mob?24:30 }}>⏱️</span>
        <span style={{ fontFamily:HAND,fontSize:mob?12:14,fontWeight:800,color:'var(--red)',lineHeight:1 }}>Lock In</span>
      </button>
    </div>
  );
}

/* ─── Logo central con círculo de luz fijo ─── */
function StudyALCenter({ mob, tablet = false }: { mob: boolean; tablet?: boolean }) {
  const box = mob ? 220 : (tablet ? 280 : 340);
  const scale = mob ? 2.75 : (tablet ? 2.7 : 2.7);
  const ringInset = mob ? 50 : (tablet ? 62 : 75);

  const [particles, setParticles] = useState<{ id: number; dx: number; dy: number; size: number; emoji: string; rot: number; delay: number }[]>([]);
  const [exploding, setExploding] = useState(false);
  const [finished, setFinished] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const totalDuration = 3.2 * 5 * 1000;
    const t = setTimeout(() => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const headerLogo = document.getElementById('header-logo-target');
      let targetX = 60, targetY = 30;
      if (headerLogo) {
        const tRect = headerLogo.getBoundingClientRect();
        targetX = tRect.left + tRect.width / 2;
        targetY = tRect.top + tRect.height / 2;
      }

      const emojis = ['✨', '⭐', '🌟', '💫', '✦', '✧', '⚡'];
      const newParticles = Array.from({ length: 22 }, (_, i) => ({
        id: i,
        dx: targetX - centerX + (Math.random() - 0.5) * 50,
        dy: targetY - centerY + (Math.random() - 0.5) * 50,
        size: 16 + Math.random() * 20,
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
        rot: Math.random() * 720 - 360,
        delay: Math.random() * 200,
      }));
      setExploding(true);
      setParticles(newParticles);
      setFinished(true);
      setTimeout(() => { setParticles([]); setExploding(false); }, 2200);
    }, totalDuration);
    return () => clearTimeout(t);
  }, []);

  return (
    <div ref={containerRef} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, overflow:'visible', marginTop: mob ? 40 : (tablet ? 44 : 70), position:'relative' }}>
      {particles.map(p => {
        const rect = containerRef.current?.getBoundingClientRect();
        const cx = (rect?.left || 0) + box/2;
        const cy = (rect?.top || 0) + box/2;
        return (
          <span key={p.id} style={{
            position: 'fixed',
            left: cx + 'px',
            top: cy + 'px',
            fontSize: p.size,
            pointerEvents: 'none',
            zIndex: 9999,
            animation: 'particleFly 2s cubic-bezier(.4,1.2,.5,1) forwards',
            animationDelay: p.delay + 'ms',
            ['--dx' as any]: p.dx + 'px',
            ['--dy' as any]: p.dy + 'px',
            ['--rot' as any]: p.rot + 'deg',
            filter: 'drop-shadow(0 0 6px #fff8c5) drop-shadow(0 0 14px var(--gold))',
            opacity: 0,
          }}>
            {p.emoji}
          </span>
        );
      })}

      {exploding && (
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 80, height: 80,
          marginLeft: -40, marginTop: -40,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--gold) 0%, transparent 70%)',
          animation: 'centerPulse 1s ease-out forwards',
          pointerEvents: 'none',
          zIndex: 5,
        }}/>
      )}

      <style>{`
        @keyframes particleFly {
          0% {
            transform: translate(-50%, -50%) scale(0.4) rotate(0deg);
            opacity: 0;
          }
          15% {
            transform: translate(-50%, -50%) scale(1.4) rotate(calc(var(--rot) * 0.2));
            opacity: 1;
          }
          100% {
            transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.3) rotate(var(--rot));
            opacity: 0;
          }
        }
        @keyframes centerPulse {
          0% { transform: scale(0.2); opacity: 0; }
          30% { transform: scale(2.5); opacity: 0.85; }
          100% { transform: scale(5); opacity: 0; }
        }
      `}</style>

      <div style={{
        position:'relative',
        width: box + 'px',
        height: box + 'px',
        overflow:'visible',
        flexShrink:0,
      }}>
        <svg
          viewBox="0 0 200 200"
          style={{
            position:'absolute',
            top: -ringInset,
            left: -ringInset,
            width: box + ringInset * 2,
            height: box + ringInset * 2,
            pointerEvents:'none',
            overflow:'visible',
            zIndex: 0,
          }}
        >
          <defs>
            <linearGradient id="shineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#fff8d1" stopOpacity="0"/>
              <stop offset="40%"  stopColor="#fff8d1" stopOpacity="1"/>
              <stop offset="60%"  stopColor="#ffffff" stopOpacity="1"/>
              <stop offset="100%" stopColor="#fff8d1" stopOpacity="0"/>
            </linearGradient>
          </defs>

          <circle
            cx="100"
            cy="100"
            r="92"
            fill="none"
            stroke="var(--gold)"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{
              filter:'drop-shadow(0 0 6px color-mix(in srgb, var(--gold) 55%, transparent)) drop-shadow(0 0 14px color-mix(in srgb, var(--gold) 30%, transparent))',
            }}
          />

          <circle
            cx="100"
            cy="100"
            r="92"
            fill="none"
            stroke="#fffbe0"
            strokeWidth="3.2"
            strokeLinecap="round"
            pathLength={100}
            style={{
              strokeDasharray: '18 82',
              strokeDashoffset: 0,
              animation: 'nbShine 3.2s linear 5 forwards',
              filter:'drop-shadow(0 0 6px #fff8c5) drop-shadow(0 0 12px rgba(255,243,170,0.85)) drop-shadow(0 0 22px color-mix(in srgb, var(--gold) 60%, transparent))',
              opacity: finished ? 0 : 0.95,
              transition: 'opacity 1.2s ease-out',
            }}
          />

          <circle
            cx="100"
            cy="100"
            r="92"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            pathLength={100}
            style={{
              strokeDasharray: '6 94',
              strokeDashoffset: -45,
              animation: 'nbShine 3.2s linear 5 forwards',
              filter:'drop-shadow(0 0 4px #fff)',
              opacity: finished ? 0 : 0.7,
              transition: 'opacity 1.2s ease-out',
            }}
          />
        </svg>

        <img
          src="/logo.png"
          alt="StudyAL"
          style={{
            position:'absolute',
            left:'55%',
            top:'48%',
            width:'100%',
            height:'100%',
            maxWidth:'none',
            maxHeight:'none',
            objectFit:'contain',
            objectPosition:'center',
            display:'block',
            transform:'translate(-50%, -50%) scale(' + scale + ')',
            transformOrigin:'center',
            pointerEvents:'none',
            userSelect:'none',
            zIndex: 1,
          }}
        />
      </div>

      <svg width="36" height="50" viewBox="0 0 36 50" style={{ marginTop:88 }}>
        <path d="M18 4 Q 14 24 18 40" stroke="var(--text-primary)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
        <path d="M10 34 L 18 46 L 26 34" stroke="var(--text-primary)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
      </svg>

      <style>{`
        @keyframes nbShine {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: -100; }
        }
      `}</style>
    </div>
  );
}

function TopPodio({ onClick, mob, tablet = false }: { onClick: () => void; mob: boolean; tablet?: boolean }) {
  const [top, setTop] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async()=>{
      try {
        const r = await fetch('/api/leaderboard');
        const d = await r.json();
        if (d.success && d.data) setTop(d.data.slice(0,5));
      } catch {}
      setLoading(false);
    })();
  }, []);

  const order   = [3, 1, 0, 2, 4];
  const heights = mob ? [44, 64, 86, 56, 38] : (tablet ? [52, 76, 102, 66, 44] : [56, 80, 105, 70, 48]);
  const colors  = ['var(--gold)','#cbd5e1','#cd7f32','#94a3b8','#94a3b8'];
  const medals  = ['🥇','🥈','🥉','',''];

  return (
    <div onClick={onClick} style={{
      position:'relative',cursor:'pointer',
      border:'2px solid var(--text-primary)',borderRadius:6,
      padding:mob?'14px 12px 10px':(tablet?'10px 8px 6px':'18px 16px 12px'),
      boxShadow:'5px 6px 0 var(--text-primary), 0 12px 28px rgba(0,0,0,.18)',
      transform:'rotate(2.5deg)',transition:'all .25s',
      minWidth:mob?210:(tablet?170:255),
      width:tablet?170:'auto',
      maxWidth:tablet?170:'none',
      zIndex:10,
    }}
      onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translate(-2px,-3px)';e.currentTarget.style.boxShadow='7px 8px 0 var(--text-primary),0 14px 32px rgba(0,0,0,.22)';}}
      onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(2.5deg)';e.currentTarget.style.boxShadow='5px 6px 0 var(--text-primary),0 12px 28px rgba(0,0,0,.18)';}}
    >
      <div style={{ position:'absolute',top:-12,left:'50.8%',transform:'translateX(-50%) rotate(-3deg)',width:70,height:18,background:'color-mix(in srgb, var(--gold) 55%, transparent)',borderRadius:1,boxShadow:'0 1px 3px rgba(0,0,0,.18)',zIndex:5 }}/>
      <div style={{ position:'absolute',top:-8,right:14,transform:'rotate(8deg)',width:28,height:10,background:'color-mix(in srgb, var(--gold) 45%, transparent)',borderRadius:1,zIndex:5 }}/>

      <div style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginBottom:8 }}>
        <span style={{ fontSize:18 }}>🏆</span>
        <span style={{ fontFamily:HAND,fontSize:mob?20:(tablet?16:24),fontWeight:900,color:'var(--text-primary)' }}>Top 5</span>
      </div>

      {loading ? (
        <div style={{ height:120,display:'flex',alignItems:'center',justifyContent:'center',color:'#666',fontSize:13,fontStyle:'italic',fontFamily:HAND }}>cargando...</div>
      ) : top.length===0 ? (
        <div style={{ height:120,display:'flex',alignItems:'center',justifyContent:'center',color:'#666',fontSize:13,fontStyle:'italic',fontFamily:HAND,textAlign:'center' }}>sin datos aún<br/>¡a estudiar!</div>
      ) : (
        <div style={{ display:'flex',justifyContent:'center',alignItems:'flex-end',gap:mob?3:(tablet?1:5),height:mob?150:(tablet?165:170),padding:'0 2px' }}>
          {order.map((idx, vi) => {
            const u = top[idx];
            if (!u) return <div key={vi} style={{ flex:1 }}/>;
            const h = heights[vi];
            const c = colors[idx];
            const ini = (u.nombre || '?').charAt(0).toUpperCase();
            return (
              <div key={vi} style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2 }}>
                <div style={{ width:mob?22:(tablet?22:26),height:mob?22:(tablet?22:26),borderRadius:'50%',background:c,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:10,fontWeight:800,overflow:'hidden',border:'1.5px solid var(--text-primary)' }}>
                  {u.avatar_url ? <img src={u.avatar_url} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/> : ini}
                </div>
                <span style={{ fontSize:9,fontWeight:700,color:'var(--text-primary)',maxWidth:mob?40:(tablet?32:50),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textAlign:'center',lineHeight:1 }}>{u.nombre}</span>
                <span style={{ fontSize:8,color:'#666',fontFamily:HAND,lineHeight:1 }}>{u.xp_total}xp</span>
                <div style={{
                  width:'100%',height:h,
                  borderRadius:'4px 4px 0 0',border:'1.5px solid var(--text-primary)',borderBottom:'none',
                  display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:5,
                  position:'relative',
                }}>
                  <span style={{ fontFamily:HAND,fontSize:mob?18:(tablet?16:22),fontWeight:900,color:'#fff',textShadow:'0 1px 2px rgba(0,0,0,.4)',lineHeight:1 }}>{idx+1}</span>
                  {medals[idx] && <div style={{ position:'absolute',top:-13,fontSize:14 }}>{medals[idx]}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ marginTop:6,paddingTop:5,borderTop:'1px dashed #aaa',textAlign:'center',fontFamily:HAND,fontSize:13,color:'#b8860b',fontWeight:700,fontStyle:'italic' }}>
        ver leaderboard →
      </div>
    </div>
  );
}

/* ─── MateriasHoja ─── */
function MateriasHoja({ materias, onOpen, onCreate, mob, lang }: {
  materias: Materia[]; onOpen: (materiaId?: string) => void; onCreate: () => void; mob: boolean; lang: string;
}) {
  const [open, setOpen] = useState(false);
  const tiene = materias.length > 0;
  console.log('📚 [MateriasHoja] render:', { tiene, count: materias.length, open });

  return (
    <div style={{ position:'relative',width:'100%',maxWidth:mob?340:520 }}>
      <button onClick={()=>setOpen(!open)} className="hover3d" style={{
        position:'relative',width:'100%',
        padding:mob?'16px 20px':'20px 32px',
        border:'1.5px solid var(--border-color)',
        borderRadius:'10px 10px 4px 4px',cursor:'pointer',
        boxShadow:'5px 6px 0 var(--text-primary)',
        transform:open?'rotate(0deg)':'rotate(-.5deg)',
        transition:'all .3s cubic-bezier(.2,.8,.2,1)',
        display:'flex',alignItems:'center',justifyContent:'center',gap:14,zIndex:5,
      }}>
        <div style={{ position:'absolute',top:-7,left:0,right:0,display:'flex',justifyContent:'space-around',pointerEvents:'none' }}>
          {Array.from({ length: 8 }).map((_,i)=>(
            <div key={i} style={{ width:11,height:11,borderRadius:'50%',background:'var(--bg-secondary)',border:'2px solid var(--text-primary)' }}/>
          ))}
        </div>
        <span style={{ fontSize:mob?28:38 }}>📚</span>
        <div style={{ display:'flex',flexDirection:'column',alignItems:'flex-start',lineHeight:1 }}>
          <span style={{ fontFamily:HAND,fontSize:mob?32:44,fontWeight:900,color:'var(--text-primary)',lineHeight:1 }}>{lang==='en'?'Subjects':'Materias'}</span>
          <span style={{ fontFamily:HAND,fontSize:mob?14:16,color:'#888',fontStyle:'italic',marginTop:2 }}>
            {tiene ? `${materias.length} ${materias.length===1?'materia':'materias'} · click para abrir` : 'click para crear tu primera'}
          </span>
        </div>
        <span style={{ fontSize:mob?20:26,color:'var(--text-primary)',transition:'transform .3s',transform:open?'rotate(180deg)':'rotate(0)' }}>▾</span>
      </button>

      <div style={{ position:'relative' }}>
        {open && (
          <div style={{
            position:'relative',border:'1.5px solid var(--border-color)',borderTop:'none',
            borderRadius:'0 0 12px 12px',padding:mob?'18px 12px':'22px 24px',
            boxShadow:'4px 5px 0 rgba(0,0,0,.22)',
          }}>
            <div style={{ position:'absolute',top:0,bottom:0,left:mob?28:46,width:1.5,background:'#ef4444',opacity:.45,pointerEvents:'none' }}/>
            {!tiene ? (
              <div style={{ textAlign:'center',padding:'18px 12px' }}>
                <p style={{ fontFamily:HAND,fontSize:18,color:'#666',margin:'0 0 12px',fontStyle:'italic' }}>~ aún no hay materias ~</p>
                <button onClick={(e: any)=>{e.stopPropagation();onCreate();}} style={{
                  padding:'10px 22px',borderRadius:10,border:'none',background:'var(--gold)',color:'var(--text-primary)',
                  cursor:'pointer',fontFamily:HAND,fontSize:18,fontWeight:800,
                  boxShadow:'0 4px 0 rgba(200,160,30,.5)',
                }}>+ Crear primera materia</button>
              </div>
            ) : (
              <>
                <div style={{ display:'grid',gridTemplateColumns:mob?'1fr':'1fr 1fr',gap:10 }}>
                  {materias.slice(0,8).map((m,idx)=>(
                    <div key={m.id} onClick={(e: any)=>{e.stopPropagation();onOpen(m.id);}} style={{
                      display:'flex',alignItems:'center',gap:10,padding:'8px 12px',
                      background:`color-mix(in srgb,${m.color} 12%,transparent)`,
                      border:`1.5px dashed ${m.color}`,borderRadius:10,cursor:'pointer',
                      transform:`rotate(${[-.7,.7,-.4,.4,-.5,.5,-.3,.3][idx]||0}deg)`,
                      transition:'all .2s',
                    }}
                      onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateX(3px)';}}
                      onMouseLeave={(e:any)=>{e.currentTarget.style.transform=`rotate(${[-.7,.7,-.4,.4,-.5,.5,-.3,.3][idx]||0}deg)`;}}
                    >
                      <div style={{ width:32,height:32,borderRadius:'50%',background:m.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0 }}>{m.emoji}</div>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontFamily:HAND,fontSize:18,fontWeight:700,color:'var(--text-primary)',lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{m.nombre}</div>
                        <div style={{ fontSize:10,color:'#888',fontStyle:'italic' }}>{m.temas.length} temas</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop:14,textAlign:'center' }}>
                  <button onClick={(e: any)=>{e.stopPropagation();onOpen();}} style={{
                    padding:'8px 18px',borderRadius:10,border:'1.5px dashed var(--gold)',
                    background:'transparent',color:'var(--gold)',cursor:'pointer',
                    fontFamily:HAND,fontSize:16,fontWeight:700,
                  }}>{lang==='en'?'see all':'ver todas'} →</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── HorarioTabla ─── */
function HorarioTabla({ mob, lang, onConfig }: { mob: boolean; lang: string; onConfig: () => void }) {
  const [clases, setClases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    try {
      const raw = localStorage.getItem('josea_horario') || localStorage.getItem('horario');
      if (raw) {
        const data = JSON.parse(raw);
        const hoy = new Date().getDay();
        const dias = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
        const diaKey = dias[hoy];
        let hoyClases: any[] = [];
        if (Array.isArray(data)) {
          hoyClases = data.filter((c:any)=>(c.dia||'').toLowerCase().includes(diaKey));
        } else if (data && typeof data==='object') {
          hoyClases = data[diaKey] || data[diaKey.charAt(0).toUpperCase()+diaKey.slice(1)] || [];
        }
        setClases(hoyClases);
      }
    } catch {}
    setLoading(false);
  },[]);

  const dias = lang==='en'
    ? ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    : ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const diaActual = dias[new Date().getDay()];

  return (
    <div style={{ display:'flex',gap:14,alignItems:'flex-start' }}>
      <div style={{ paddingTop:30,flexShrink:0 }}>
        <svg width="50" height="40" viewBox="0 0 50 40">
          <path d="M2 20 Q 25 8 42 20" stroke="var(--text-primary)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
          <path d="M36 12 L 46 20 L 36 28" stroke="var(--text-primary)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
        </svg>
      </div>

      <div style={{
        flex:1,position:'relative',
        border:'1.5px solid var(--border-color)',borderRadius:10,
        boxShadow:'4px 5px 0 rgba(0,0,0,.22)',
        transform:'rotate(-1deg)',
        overflow:'hidden',
        maxWidth:mob?'100%':480,
      }}>
        <div style={{
          padding:'8px 14px',background:'var(--gold)',
          borderBottom:'2px solid var(--text-primary)',
          fontFamily:HAND,fontSize:mob?20:24,fontWeight:900,color:'var(--text-primary)',textAlign:'center',
        }}>
          {diaActual}
        </div>

        {loading ? (
          <div style={{ padding:20,textAlign:'center',fontFamily:HAND,fontSize:15,color:'#888',fontStyle:'italic' }}>cargando...</div>
        ) : clases.length===0 ? (
          <div style={{ padding:'20px 16px',textAlign:'center' }}>
            <p style={{ fontFamily:HAND,fontSize:16,color:'#666',margin:'0 0 12px',fontStyle:'italic' }}>~ no hay clases registradas ~</p>
            <button onClick={onConfig} style={{
              padding:'8px 18px',borderRadius:8,border:'2px solid var(--text-primary)',
              background:'var(--bg-secondary)',color:'var(--text-primary)',cursor:'pointer',fontFamily:HAND,fontSize:16,fontWeight:800,
              boxShadow:'2px 2px 0 var(--text-primary)',
            }}>+ Configurar horario</button>
          </div>
        ) : (
          <ul style={{ listStyle:'none',margin:0,padding:0 }}>
            {clases.slice(0,6).map((c:any,i)=>(
              <li key={i} style={{
                display:'flex',alignItems:'center',gap:10,padding:'8px 14px',
                borderBottom:'1px dashed rgba(0,0,0,.15)',
                fontFamily:HAND,fontSize:mob?16:18,color:'var(--text-primary)',
              }}>
                <span style={{ fontWeight:700,color:'#b8860b',minWidth:55 }}>{c.hora||c.inicio||'--'}</span>
                <span style={{ flex:1,fontWeight:600 }}>{c.nombre||c.materia||c.titulo||'(clase)'}</span>
                {c.aula&&<span style={{ fontSize:12,color:'#666',fontStyle:'italic' }}>{c.aula}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─── MapaProgreso ─── */
function MiniXPChart({ days = 7, color = 'var(--blue)', xpTotal = 0 }: { days?: number; color?: string; xpTotal?: number }) {
  const [data, setData] = useState<number[]>(Array(days).fill(0));
  useEffect(() => {
    const cargar = () => {
      import('../lib/xpDiario').then(mod => {
        const d = mod.getXpUltimosDias(days);
        setData(d.map(x => x.xp));
      });
    };
    cargar();
    const handler = () => cargar();
    window.addEventListener('xp:ganada', handler);
    return () => window.removeEventListener('xp:ganada', handler);
  }, [days]);
  const max = Math.max(...data, 1);
  const W = 180, H = 70;
  const stepX = W/(days-1);
  const points = data.map((v,i)=>`${i*stepX},${H-(v/max)*H}`).join(' ');

  return (
    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:4 }}>
      <svg width={W} height={H+10} style={{ overflow:'visible' }}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        {data.map((v,i)=>(
          <circle key={i} cx={i*stepX} cy={H-(v/max)*H} r="3" fill={color} stroke="var(--bg-card)" strokeWidth="1.5"/>
        ))}
      </svg>
      <span style={{ fontFamily:BODY,fontSize:13,fontWeight:700,color:'var(--text-faint)',fontStyle:'italic',marginTop:2 }}>~ últimos 7 días ~</span>
    </div>
  );
}

function PosicionPostit({ pos, totalUsers, onClick, mob }: { pos: number; totalUsers: number; onClick: () => void; mob: boolean }) {
  const bueno = pos>0&&(pos<=10||(totalUsers>0&&pos/totalUsers<=0.25));
  const c = bueno?'var(--gold)':'var(--red)';
  return (
    <div onClick={onClick} style={{
      cursor:'pointer',background:bueno?'#fff8d6':'#ffe2e2',
      border:'2px solid var(--text-primary)',borderRadius:6,
      padding:mob?'12px 16px':'14px 20px',
      boxShadow:'4px 4px 0 var(--text-primary)',
      transform:'rotate(2deg)',transition:'all .2s',textAlign:'center',
      minWidth:140,
    }}
      onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translate(-2px,-2px)';e.currentTarget.style.boxShadow='6px 6px 0 var(--text-primary)';}}
      onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(2deg)';e.currentTarget.style.boxShadow='4px 4px 0 var(--text-primary)';}}
    >
      <div style={{ fontFamily:HAND,fontSize:mob?18:22,fontWeight:800,color:'var(--text-primary)',marginBottom:2 }}>posición</div>
      <div style={{ fontFamily:HAND,fontSize:mob?38:48,fontWeight:900,color:c,lineHeight:1 }}>#{pos||'?'}</div>
      <div style={{ fontSize:11,color:'#666',fontStyle:'italic',marginTop:2 }}>de {totalUsers}</div>
      <div style={{ marginTop:8,fontFamily:HAND,fontSize:14,fontWeight:800,color:c,fontStyle:'italic' }}>
        {bueno?'🔥 insane!':'💪 a mejorar'}
      </div>
    </div>
  );
}

function MapaProgreso({ playerStats, myRank, totalUsers, onLeaderboard, mob }: {
  playerStats: any; myRank: number; totalUsers: number; onLeaderboard: () => void; mob: boolean;
}) {
  const [xpUltimos7, setXpUltimos7] = useState(0);
  useEffect(() => {
    const cargar = () => {
      import('../lib/xpDiario').then(mod => {
        const dias = mod.getXpUltimosDias(7);
        const suma = dias.reduce((acc: number, d: any) => acc + (d.xp || 0), 0);
        setXpUltimos7(suma);
      }).catch(() => {});
    };
    cargar();
    const handler = () => cargar();
    window.addEventListener('xp:ganada', handler);
    return () => window.removeEventListener('xp:ganada', handler);
  }, [playerStats?.xpTotal]);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <h2 style={{
          fontFamily: HAND,
          fontSize: mob ? 30 : 36, fontWeight: 900,
          color: 'var(--text-primary)',
          margin: 0, lineHeight: 1,
          transform: 'rotate(-1deg)',
          display: 'inline-block',
        }}>
          ✨ Mi Progreso
        </h2>
        <svg width={mob ? 180 : 220} height="6" style={{ display: 'block', margin: '4px auto 0' }}>
          <path
            d={mob ? "M2 3 Q 90 0 178 4" : "M2 3 Q 110 0 218 4"}
            stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"
          />
        </svg>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: mob ? '1fr' : '230px 1fr 180px',
        gap: mob ? 18 : 24,
        alignItems: 'center',
        justifyItems: 'center',
        position: 'relative',
      }}>
        <div style={{
          position: 'relative',
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 12,
          padding: '10px 14px',
          boxShadow: '3px 4px 0 var(--text-primary)',
          transform: 'rotate(-2deg)',
          width: '100%',
          maxWidth: 230,
        }}>
          <div style={{
            position: 'absolute', top: -8, left: '50%',
            transform: 'translateX(-50%) rotate(-3deg)',
            width: 50, height: 14,
            background: 'rgba(56,189,248,0.45)',
            border: '1px solid rgba(56,189,248,0.3)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
          }}/>

          <div style={{
            fontFamily: HAND, fontSize: 17, fontWeight: 900,
            color: 'var(--text-primary)', marginBottom: 2,
            textAlign: 'center',
          }}>
            ⚡ XP semana
          </div>
          <div style={{
            fontFamily: HAND, fontSize: 26, fontWeight: 900,
            color: 'var(--blue)', textAlign: 'center',
            lineHeight: 1, marginBottom: 6,
            textShadow: '0 0 8px rgba(56,189,248,0.3)',
          }}>
            {(xpUltimos7 || 0).toLocaleString()}
          </div>
          <MiniXPChart days={7} color="var(--blue)" xpTotal={playerStats?.xpTotal || 0}/>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontFamily: HAND, fontSize: 14, fontWeight: 700,
            color: 'var(--text-faint)', fontStyle: 'italic',
            transform: 'rotate(-2deg)',
          }}>
            ✦ tu carta 🎴 ✦
          </span>
          <div style={{ width: mob ? 230 : 260, maxWidth: '100%' }}>
            {playerStats
              ? <PlayerCard stats={playerStats}/>
              : (
                <div style={{
                  aspectRatio: '5/7',
                  background: 'var(--bg-card)',
                  border: '2.5px dashed var(--border-color)',
                  borderRadius: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{
                    fontFamily: BODY, fontSize: 16,
                    color: 'var(--text-faint)', fontStyle: 'italic',
                  }}>
                    ~ cargando ~
                  </span>
                </div>
              )
            }
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <PosicionPostit pos={myRank} totalUsers={totalUsers} onClick={onLeaderboard} mob={mob}/>
          <span style={{
            fontFamily: BODY, fontSize: 13,
            color: 'var(--text-faint)', fontStyle: 'italic',
            transform: 'rotate(2deg)', marginTop: 2,
          }}>
            leaderboard ↑
          </span>
        </div>
      </div>
    </div>
  );
}

function GraficasPanel({ materias, mob, xpTotal }: { materias: Materia[]; mob: boolean; xpTotal: number }) {
  const [tab, setTab] = useState<'total'|'semanal'|'materia'|'racha'>('total');
  const [xpDiario, setXpDiario] = useState<{ fecha: string; xp: number; diaCorto: string; diaCompleto: string; esHoy: boolean }[]>([]);
  const [xpAcum, setXpAcum] = useState<{ fecha: string; xpAcumulado: number; xpDia: number }[]>([]);

  useEffect(() => {
    const cargar = () => {
      import('../lib/xpDiario').then(mod => {
        setXpDiario(mod.getXpUltimosDias(7));
        setXpAcum(mod.getXpAcumuladoConTotal(xpTotal || 0, 30));
      });
    };
    cargar();
    const handler = () => cargar();
    window.addEventListener('xp:ganada', handler);
    return () => window.removeEventListener('xp:ganada', handler);
  }, [xpTotal]);

  const totalApuntes = materias.reduce((s,m)=>s+m.temas.reduce((ss,t)=>ss+(t.apuntes?.length||0),0),0);
  const totalDocs    = materias.reduce((s,m)=>s+m.temas.reduce((ss,t)=>ss+(t.documentos?.length||0),0),0);
  const totalFlash   = materias.reduce((s,m)=>s+m.temas.reduce((ss,t)=>ss+((t as any).flashcards?.length||0),0),0);
  const totalTemas   = materias.reduce((s,m)=>s+m.temas.length,0);

  let racha = 0;
  let mejorRacha = 0;
  let diasEstudiados: string[] = [];
  try {
    const r = localStorage.getItem('josea_racha');
    if (r) {
      const parsed = JSON.parse(r);
      racha = parsed.rachaActual || 0;
      mejorRacha = parsed.mejorRacha || 0;
      diasEstudiados = parsed.diasEstudiados || [];
    }
  } catch {}

  const tabs = [
    { id:'total',   label:'Total',   emoji:'📈', color:'var(--blue)' },
    { id:'semanal', label:'Semanal', emoji:'📅', color:'var(--gold)' },
    { id:'materia', label:'Materia', emoji:'📚', color:'var(--pink)' },
    { id:'racha',   label:'Racha',   emoji:'🔥', color:'var(--red)'  },
  ] as const;

  return (
    <div style={{
      background:'var(--bg-card)',
      border:'2.5px solid var(--text-primary)',
      borderRadius:14,
      padding:mob?'16px 14px':'22px 24px',
      boxShadow:'5px 6px 0 var(--text-primary)',
      transform:'rotate(-0.4deg)',
      position:'relative',
    }}>
      <div style={{
        position:'absolute', top:0, bottom:0,
        left: mob ? 38 : 56,
        width:1.5, background:'#ef4444', opacity:0.35,
        pointerEvents:'none',
      }}/>

      <div style={{ display:'flex', gap:6, marginBottom:18, flexWrap:'wrap', position:'relative', zIndex:1 }}>
        {tabs.map((t, i)=>(
          <button
            key={t.id}
            onClick={()=>setTab(t.id)}
            style={{
              padding: mob?'7px 14px':'9px 18px',
              background: tab===t.id ? t.color : 'transparent',
              color: tab===t.id ? '#000' : 'var(--text-muted)',
              border: `2px solid ${tab===t.id ? t.color : 'var(--border-color)'}`,
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: HAND,
              fontSize: mob?17:19,
              fontWeight: 800,
              display:'flex', alignItems:'center', gap:6,
              boxShadow: tab===t.id ? `2px 3px 0 var(--text-primary)` : 'none',
              transform: tab===t.id ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
              transition:'all 0.3s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{
              if (tab !== t.id) e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
            }}
            onMouseLeave={(e:any)=>{
              e.currentTarget.style.transform = tab===t.id
                ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`;
            }}
          >
            <span style={{ fontSize:18 }}>{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ position:'relative', zIndex:1 }}>
        {tab==='total' && (
          <div>
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:12, flexWrap:'wrap', marginBottom:14,
            }}>
              <p style={{ fontFamily:BODY, fontSize:17, color:'var(--text-muted)', margin:0, fontStyle:'italic' }}>
                📈 Tu evolución de XP
              </p>
              <div style={{
                background:'color-mix(in srgb,var(--blue) 16%,var(--bg-secondary))',
                border:'2.5px solid var(--blue)',
                borderRadius:12,
                padding:'8px 18px',
                boxShadow:'3px 3px 0 var(--text-primary)',
                transform:'rotate(1.5deg)',
                textAlign:'center',
              }}>
                <div style={{ fontFamily: BODY, fontSize:13, color:'var(--text-muted)', fontStyle:'italic', lineHeight:1 }}>XP total</div>
                <div style={{ fontFamily:BODY, fontSize:28, fontWeight:900, color:'var(--blue)', lineHeight:1.1 }}>
                  ⚡ {(xpTotal || 0).toLocaleString()}
                </div>
              </div>
            </div>

            <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
              {[
                { v: materias.length, l:'materias', c:'var(--gold)', e:'📚', rot:-2 },
                { v: totalTemas,      l:'temas',    c:'var(--blue)', e:'📑', rot:1.5 },
                { v: totalApuntes,    l:'apuntes',  c:'var(--pink)', e:'📝', rot:-1 },
                { v: totalDocs,       l:'docs',     c:'#a78bfa',     e:'📄', rot:2 },
                { v: totalFlash,      l:'cards',    c:'var(--red)',  e:'🎴', rot:-1.5 },
              ].map((s,i)=>(
                <div key={i} style={{
                  background:`color-mix(in srgb,${s.c} 14%,var(--bg-secondary))`,
                  border:`2px dashed ${s.c}`,
                  borderRadius:10,
                  padding:'6px 12px',
                  textAlign:'center',
                  flex:'1 1 80px',
                  transform:`rotate(${s.rot}deg)`,
                  transition:'transform 0.3s',
                }}
                  onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.05)'}
                  onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${s.rot}deg)`}
                >
                  <div style={{ fontSize:18, lineHeight:1 }}>{s.e}</div>
                  <div style={{ fontFamily:HAND, fontSize:24, fontWeight:900, color:s.c, lineHeight:1 }}>{s.v}</div>
                  <div style={{ fontFamily:BODY, fontSize:12, color:'var(--text-muted)', fontStyle:'italic' }}>{s.l}</div>
                </div>
              ))}
            </div>

            <LineChartXP data={xpAcum} mob={mob}/>
          </div>
        )}

        {tab==='semanal' && (
          <div>
            <p style={{ fontFamily:BODY, fontSize:17, color:'var(--text-muted)', margin:'0 0 14px', fontStyle:'italic' }}>
              📅 XP ganado los últimos 7 días
            </p>
            <BarrasSemanales data={xpDiario} mob={mob}/>
          </div>
        )}

        {tab==='materia' && (
          <div>
            <p style={{ fontFamily:BODY, fontSize:17, color:'var(--text-muted)', margin:'0 0 14px', fontStyle:'italic' }}>
              📚 Contenido por materia (apuntes + documentos + flashcards)
            </p>
            {materias.length === 0 ? (
              <p style={{ fontFamily:BODY, fontSize:18, color:'var(--text-faint)', fontStyle:'italic', textAlign:'center', padding:30 }}>
                ~ aún no hay materias ~
              </p>
            ) : (
              <BarrasMaterias materias={materias} mob={mob}/>
            )}
          </div>
        )}

        {tab==='racha' && (
          <RachaPanel racha={racha} mejorRacha={mejorRacha} diasEstudiados={diasEstudiados} mob={mob}/>
        )}
      </div>
    </div>
  );
}

function LineChartXP({ data, mob }: { data: { fecha: string; xpAcumulado: number; xpDia: number }[]; mob: boolean }) {
  if (!data.length) {
    return (
      <div style={{ textAlign:'center', padding:30 }}>
        <p style={{ fontFamily:BODY, fontSize:18, color:'var(--text-faint)', fontStyle:'italic' }}>
          ~ empieza a estudiar para ver tu evolución ~
        </p>
      </div>
    );
  }
  const W = mob ? 320 : 580;
  const H = 180;
  const pad = { top: 14, right: 16, bottom: 30, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const max = Math.max(...data.map(d => d.xpAcumulado), 100);
  const min = 0;
  const stepX = innerW / Math.max(data.length - 1, 1);

  const points = data.map((d, i) => ({
    x: pad.left + i * stepX,
    y: pad.top + innerH - ((d.xpAcumulado - min) / (max - min || 1)) * innerH,
    ...d,
  }));

  let pathD = '';
  points.forEach((p, i) => {
    if (i === 0) pathD += `M ${p.x} ${p.y}`;
    else {
      const prev = points[i-1];
      const cpx = (prev.x + p.x) / 2;
      pathD += ` Q ${cpx} ${prev.y}, ${cpx} ${(prev.y + p.y) / 2} T ${p.x} ${p.y}`;
    }
  });

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => Math.round((max / ticks) * i));

  return (
    <div style={{
      background:'var(--bg-secondary)',
      border:'1.5px dashed var(--border-color)',
      borderRadius:10,
      padding:'10px 12px',
      overflow:'auto',
    }}>
      <svg width={W} height={H} style={{ display:'block', maxWidth:'100%' }}>
        {/* grid horizontal */}
        {tickValues.map((v, i) => {
          const y = pad.top + innerH - (v / max) * innerH;
          return (
            <g key={i}>
              <line
                x1={pad.left} x2={W - pad.right}
                y1={y} y2={y}
                stroke="var(--border-color)"
                strokeWidth="1"
                strokeDasharray="3 4"
                opacity="0.5"
              />
              <text x={pad.left - 6} y={y + 4} textAnchor="end"
                style={{ fontFamily: BODY, fontSize: 12, fill: 'var(--text-faint)' }}>
                {v}
              </text>
            </g>
          );
        })}

        <path
          d={`${pathD} L ${points[points.length-1].x} ${pad.top + innerH} L ${points[0].x} ${pad.top + innerH} Z`}
          fill="var(--blue)"
          opacity="0.12"
        />

        <path
          d={pathD}
          fill="none"
          stroke="var(--blue)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="var(--bg-card)" stroke="var(--blue)" strokeWidth="2"/>
            {(i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 6) === 0) && (
              <text
                x={p.x} y={H - 8} textAnchor="middle"
                style={{ fontFamily: BODY, fontSize: 11, fill: 'var(--text-muted)' }}
              >
                {p.fecha.slice(5).replace('-', '/')}
              </text>
            )}
          </g>
        ))}

        <text x={pad.left} y={pad.top - 2}
          style={{ fontFamily: HAND, fontSize: 13, fontWeight: 800, fill: 'var(--blue)' }}>
          📈 {data[data.length-1].xpAcumulado} XP totales
        </text>
      </svg>
    </div>
  );
}

function BarrasSemanales({ data, mob }) {
  const [themeKey, setThemeKey] = useState(0);
  useEffect(() => {
    const handler = () => setThemeKey(k => k + 1);
    window.addEventListener('theme:changed', handler);
    const obs = new MutationObserver(() => setThemeKey(k => k + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => {
      window.removeEventListener('theme:changed', handler);
      obs.disconnect();
    };
  }, []);
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.xp), 50);
  const totalSemana = data.reduce((s,d)=>s+d.xp, 0);
  const promedio = Math.round(totalSemana / data.length);

  return (
    <div>
      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{
          background:'color-mix(in srgb,var(--gold) 14%,var(--bg-secondary))',
          border:'2px dashed var(--gold)', borderRadius:10,
          padding:'6px 14px', transform:'rotate(-1deg)',
        }}>
          <div style={{ fontFamily: BODY, fontSize:13, color:'var(--text-muted)', fontStyle:'italic' }}>total semana</div>
          <div style={{ fontFamily:HAND, fontSize:24, fontWeight:900, color:'var(--gold)', lineHeight:1 }}>{totalSemana} XP</div>
        </div>
        <div style={{
          background:'color-mix(in srgb,var(--blue) 14%,var(--bg-secondary))',
          border:'2px dashed var(--blue)', borderRadius:10,
          padding:'6px 14px', transform:'rotate(1deg)',
        }}>
          <div style={{ fontFamily: BODY, fontSize:13, color:'var(--text-muted)', fontStyle:'italic' }}>promedio/día</div>
          <div style={{ fontFamily:HAND, fontSize:24, fontWeight:900, color:'var(--blue)', lineHeight:1 }}>{promedio} XP</div>
        </div>
      </div>

      <div style={{
        display:'flex', alignItems:'flex-end', justifyContent:'space-around',
        height:180, gap:8, padding:'0 4px',
        background:'var(--bg-secondary)',
        border:'1.5px dashed var(--border-color)',
        borderRadius:10,
        paddingTop:14, paddingBottom:6,
      }}>
        {data.map((d,i)=>{
          const h = (d.xp / max) * 130;
          const colorHoy = 'var(--gold)';
          const color = d.esHoy ? colorHoy : 'var(--blue)';
          return (
            <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4, minWidth:0 }}>
              <span style={{
                fontFamily:HAND, fontSize:13, fontWeight:800,
                color: d.esHoy ? colorHoy : 'var(--text-primary)',
              }}>
                {d.xp}
              </span>
              <div style={{
                width:'100%', maxWidth:36,
                height: Math.max(h, 4),
                background: d.esHoy
                  ? `linear-gradient(180deg, ${colorHoy} 0%, color-mix(in srgb, ${colorHoy} 70%, #000) 100%)`
                  : 'gradient',
                borderRadius:'4px 4px 0 0',
                border:`1.5px solid ${color}`,
                boxShadow:'inset 0 2px 0 rgba(255,255,255,0.25), 1px 2px 0 rgba(0,0,0,0.15)',
                transition:'height 0.4s cubic-bezier(.25,.8,.25,1)',
              }}/>
              <span style={{
                fontFamily:HAND, fontSize:15, fontWeight:800,
                color: d.esHoy ? colorHoy : 'var(--text-primary)',
                lineHeight:1,
              }}>
                {d.diaCorto}
              </span>
              {d.esHoy && (
                <span style={{ fontFamily:HAND, fontSize:11, color:colorHoy, fontStyle:'italic', lineHeight:1 }}>hoy</span>
              )}
            </div>
          );
        })}
      </div>

      {totalSemana === 0 && (
        <p style={{ fontFamily:BODY, fontSize:15, color:'var(--text-faint)', fontStyle:'italic', marginTop:10 }}>
          ~ aún no has ganado XP esta semana ~
        </p>
      )}
    </div>
  );
}

function BarrasMaterias({ materias, mob }) {
  const stats = materias.map(m => {
    const aps = m.temas.reduce((s,t)=>s+(t.apuntes?.length||0),0);
    const docs = m.temas.reduce((s,t)=>s+(t.documentos?.length||0),0);
    const fls = m.temas.reduce((s,t)=>s+((t as any).flashcards?.length||0),0);
    return { ...m, aps, docs, fls, total: aps+docs+fls };
  }).sort((a,b)=>b.total - a.total);

  const max = Math.max(...stats.map(s=>s.total), 1);

  return (
    <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:14 }}>
      {stats.slice(0,8).map((m,i)=>{
        const pct = (m.total / max) * 100;
        return (
          <li key={m.id} style={{
            display:'flex', alignItems:'center', gap:12,
            padding:'4px 0',
            transform:`rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
          }}>
            <div style={{
              width:42, height:42, borderRadius:'50%',
              background:m.color, display:'flex',
              alignItems:'center', justifyContent:'center',
              fontSize:20, flexShrink:0,
              border:'2px solid var(--text-primary)',
              boxShadow:'2px 2px 0 var(--text-primary)',
            }}>
              {m.emoji}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{
                  fontFamily:BODY, fontSize:15, fontWeight:700,
                  color:'var(--text-primary)',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                }}>
                  {m.nombre}
                </span>
                <span style={{
                  fontFamily:HAND, fontSize:16, fontWeight:800, color:m.color,
                }}>
                  {m.total} {m.total === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div style={{
                height:14,
                background:'var(--bg-secondary)',
                borderRadius:7,
                overflow:'hidden',
                border:'1.5px solid var(--text-primary)',
                position:'relative',
              }}>
                <div style={{
                  width:`${pct}%`, height:'100%',
                  background:`linear-gradient(90deg, ${m.color} 0%, ${m.color}dd 100%)`,
                  borderRadius:5,
                  transition:'width 0.6s cubic-bezier(.25,.8,.25,1)',
                  boxShadow:'inset 0 1px 0 rgba(255,255,255,0.3)',
                }}/>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:3 }}>
                {m.aps > 0 && <span style={{ fontFamily:BODY, fontSize:12, color:'var(--text-faint)' }}>📝 {m.aps}</span>}
                {m.docs > 0 && <span style={{ fontFamily:BODY, fontSize:12, color:'var(--text-faint)' }}>📄 {m.docs}</span>}
                {m.fls > 0 && <span style={{ fontFamily:BODY, fontSize:12, color:'var(--text-faint)' }}>🎴 {m.fls}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RachaPanel({ racha, mejorRacha, diasEstudiados, mob }) {
  const hoy = new Date();
  const dias: { fecha: string; estudiado: boolean; esHoy: boolean }[] = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    const fecha = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    dias.push({
      fecha,
      estudiado: diasEstudiados.includes(fecha),
      esHoy: i === 0,
    });
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      <div style={{
        display:'flex', gap:14, alignItems:'center', justifyContent:'center', flexWrap:'wrap',
      }}>
        <div style={{
          textAlign:'center', padding:'14px 22px',
          background:'color-mix(in srgb,var(--red) 16%,var(--bg-secondary))',
          border:'2.5px solid var(--text-primary)',
          borderRadius:14,
          boxShadow:'4px 4px 0 var(--text-primary)',
          transform:'rotate(-2deg)',
        }}>
          <div style={{ fontSize:38, lineHeight:1 }}>🔥</div>
          <div style={{ fontFamily:HAND, fontSize:48, fontWeight:900, color:'var(--red)', lineHeight:1 }}>
            {racha}
          </div>
          <div style={{ fontFamily:BODY, fontSize:14, color:'var(--text-muted)', fontStyle:'italic' }}>
            días consecutivos
          </div>
        </div>

        <div style={{
          textAlign:'center', padding:'14px 22px',
          background:'color-mix(in srgb,var(--gold) 16%,var(--bg-secondary))',
          border:'2.5px solid var(--text-primary)',
          borderRadius:14,
          boxShadow:'4px 4px 0 var(--text-primary)',
          transform:'rotate(2deg)',
        }}>
          <div style={{ fontSize:38, lineHeight:1 }}>🏆</div>
          <div style={{ fontFamily:HAND, fontSize:48, fontWeight:900, color:'var(--gold)', lineHeight:1 }}>
            {mejorRacha}
          </div>
          <div style={{ fontFamily:BODY, fontSize:14, color:'var(--text-muted)', fontStyle:'italic' }}>
            tu récord
          </div>
        </div>
      </div>

      <div>
        <p style={{ fontFamily:BODY, fontSize:17, color:'var(--text-muted)', margin:'0 0 8px', fontStyle:'italic', textAlign:'center' }}>
          📆 Últimos 35 días {' '}
          <span style={{ color:'var(--red)' }}>🔥 = estudiaste</span>
        </p>
        <div style={{
          display:'grid',
          gridTemplateColumns:'repeat(7, 1fr)',
          gap:6,
          maxWidth:340,
          margin:'0 auto',
          padding:'12px',
          background:'var(--bg-secondary)',
          border:'1.5px dashed var(--border-color)',
          borderRadius:10,
        }}>
          {dias.map((d,i)=>(
            <div
              key={i}
              title={d.fecha}
              style={{
                aspectRatio:'1',
                borderRadius:6,
                background: d.estudiado
                  ? 'color-mix(in srgb,var(--red) 70%,transparent)'
                  : 'var(--bg-card)',
                border: d.esHoy
                  ? '2.5px solid var(--gold)'
                  : '1.5px solid var(--border-color)',
                boxShadow: d.esHoy ? '2px 2px 0 var(--gold)' : 'none',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:14,
                cursor:'help',
                transition:'transform 0.2s',
              }}
              onMouseEnter={(e:any)=>e.currentTarget.style.transform='scale(1.15)'}
              onMouseLeave={(e:any)=>e.currentTarget.style.transform='scale(1)'}
            >
              {d.estudiado ? '🔥' : ''}
            </div>
          ))}
        </div>
      </div>

      <p style={{
        fontFamily:HAND, fontSize:18, color:'var(--text-muted)',
        textAlign:'center', margin:0, fontStyle:'italic',
        transform:'rotate(-0.5deg)',
      }}>
        {racha === 0
          ? '~ estudia hoy para empezar tu racha 🚀 ~'
          : racha < 7
            ? `~ ¡vas bien! sigue así 💪 ~`
            : racha < 30
              ? `~ ¡imparable! 🔥 ~`
              : '~ leyenda viviente 👑 ~'}
      </p>
    </div>
  );
}

export default function Home() {
  const [materias, setMaterias]     = useState<Materia[]>([]);
  const [loading, setLoading]       = useState(false);

  const [themeKey, setThemeKey] = useState(0);
  const [showDailyReward, setShowDailyReward] = useState(false);
  const [playerStats, setPlayerStats] = useState<any>(null);
  const [myRank, setMyRank]         = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [buscadorOpen, setBuscadorOpen] = useState(false);
  const [userName, setUserName]     = useState('');

  const mob = useIsMobile();
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    const checkTablet = () => setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1180);
    checkTablet();
    window.addEventListener('resize', checkTablet);
    return () => window.removeEventListener('resize', checkTablet);
  }, []);
  const { idioma } = useIdioma();
  const lang = idioma || 'es';
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const authKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      if (authKey) {
        const raw = localStorage.getItem(authKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.access_token || parsed?.[0]?.access_token) {
            setAuthChecked(true);
          }
        }
      }
    } catch {}
  }, []);
  const pathname = usePathname();

  useEffect(() => {
    const rutas = ['/materias', '/agenda', '/horario', '/partners', '/comunidad', '/news', '/chat', '/chap', '/settings', '/perfil', '/leaderboard'];
    rutas.forEach(r => { try { router.prefetch(r); } catch {} });
  }, []);

  useEffect(() => {
    let alive = true;

    try {
      const authKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      if (authKey) {
        const raw = localStorage.getItem(authKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.access_token || parsed?.[0]?.access_token) {
            setAuthChecked(true);
            supabase.auth.getSession().then(({ data }) => {
              if (!alive) return;
              if (!data.session && !parsed?.refresh_token) {
                try { router.replace('/landing'); } catch { window.location.href = '/landing'; }
              }
            }).catch(() => {});
            return () => { alive = false; };
          }
        }
      }
    } catch {}

    (async () => {
      try {
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000));
        const result: any = await Promise.race([sessionPromise, timeoutPromise]);
        if (!alive) return;

        if (!result?.data?.session) {
          try { (window as any).__showNavLoader?.('/landing'); } catch {}
          try { router.replace('/landing'); } catch { window.location.href = '/landing'; }
          return;
        }
        setAuthChecked(true);
      } catch {
        if (alive) setAuthChecked(true);
      }
    })();

    return () => { alive = false; };
  }, [router]);

  const nav = (href: string, _label: string, _color: string, _emoji: string) => {
    try { (window as any).__showNavLoader?.(href); } catch {}
    let navigated = false;
    const fallback = setTimeout(() => {
      if (!navigated && typeof window !== 'undefined' && window.location.pathname !== href.split('?')[0]) {
        try { window.location.href = href; } catch {}
      }
    }, 800);
    try {
      router.push(href);
      navigated = true;
      setTimeout(() => clearTimeout(fallback), 850);
    } catch {
      clearTimeout(fallback);
      window.location.href = href;
    }
  };

  const navMateria = (materiaId?: string) => {
    if (materiaId) {
      try { localStorage.setItem('josea_open_materia', materiaId); } catch {}
      const href = `/materias?open=${encodeURIComponent(materiaId)}`;
      try { (window as any).__showNavLoader?.(href); } catch {}
      const fallback = setTimeout(() => {
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/materias')) {
          window.location.href = href;
        }
      }, 800);
      try {
        router.push(href);
        setTimeout(() => clearTimeout(fallback), 850);
      } catch {
        clearTimeout(fallback);
        window.location.href = href;
      }
      return;
    }
    nav('/materias','Materias','var(--gold)','📚');
  };

  useEffect(() => {
    const labels = [
      { label:'Cargando materias…',     color:'var(--gold)', emoji:'📚' },
      { label:'Preparando tu espacio…', color:'#f472b6', emoji:'✨' },
      { label:'Casi listo…',            color:'#38bdf8', emoji:'🚀' },
    ];
    let i = 0;

    (async () => {
      try {
        const { data:{ user } } = await supabase.auth.getUser();
        if (user) {
          const nombre = user.user_metadata?.nombre || user.email?.split('@')[0] || '';
          setUserName(nombre);

          try {
            const ms = await getMateriasDB(user.id);
            console.log('🔍 [HOME] Materias cargadas:', ms?.length || 0);
            setMaterias(ms || []);
          } catch (e) {
            console.error('❌ [HOME] Error cargando materias:', e);
            setMaterias([]);
          }

          const [profRes, lbRes] = await Promise.all([
            fetch(`/api/user-profile?userId=${user.id}`),
            fetch('/api/leaderboard'),
          ]);
          const profData = await profRes.json();
          const lbData   = await lbRes.json();

          let rank = 0;
          let total = 0;
          if (lbData.success && lbData.data) {
            const entries = lbData.data as any[];
            total = entries.length;
            setTotalUsers(total);
            const idx = entries.findIndex(e => e.user_id === user.id || e.nombre?.toLowerCase() === nombre.toLowerCase());
            rank = idx >= 0 ? idx + 1 : 0;
            setMyRank(rank);

            const meLb = entries.find(e => e.user_id === user.id);

            if (profData.success && profData.data) {
              const p = profData.data;
              setPlayerStats({
                nombre:      p.nombre || nombre,
                xpTotal:     meLb?.xp_total || 0,
                flashcards:  meLb?.flashcards_estudiadas || 0,
                precision:   Math.round(meLb?.precision_global || 0),
                rachaActual: meLb?.racha_actual || 0,
                mejorRacha:  meLb?.mejor_racha || 0,
                rank,
                totalUsers:  total,
                userId:      user.id,
                quizzes:     p.quizzes_completados || 0,
                avatar:      p.avatar_url || meLb?.avatar_url || '',
                universidad: p.universidad || meLb?.universidad || '',
                carrera:     p.carrera || meLb?.carrera || '',
                genero:      p.genero || meLb?.genero || '',
              });
            } else if (meLb) {
              setPlayerStats({
                nombre:      meLb.nombre || nombre,
                xpTotal:     meLb.xp_total || 0,
                flashcards:  meLb.flashcards_estudiadas || 0,
                precision:   Math.round(meLb.precision_global || 0),
                rachaActual: meLb.racha_actual || 0,
                mejorRacha:  meLb.mejor_racha || 0,
                rank,
                totalUsers:  total,
                userId:      user.id,
                quizzes:     0,
                avatar:      meLb.avatar_url || '',
                universidad: meLb.universidad || '',
                carrera:     meLb.carrera || '',
                genero:      meLb.genero || '',
              });
            }
          }
        }
      } catch (e) { console.error('home init err', e); }

      if (shouldShowDailyReward()) setShowDailyReward(true);
      setLoading(false);
    })();

  }, []);

  if (!authChecked) return <StudyLoader label="Inicio" />;

  /* ═════════ MOBILE ═════════ */
  if (mob) return (
    <div style={{ minHeight:'100vh',paddingBottom:90,position:'relative' }}>
      <OnboardingCheck/>
      {showDailyReward && <DailyReward onClose={() => setShowDailyReward(false)} onClaim={async () => { await darXP('daily_reward', 15); setShowDailyReward(false); }}/>}
      <BuscadorModal open={buscadorOpen} onClose={() => setBuscadorOpen(false)}/>

      <div style={{ position:'relative',zIndex:1,padding:'14px 14px',display:'flex',flexDirection:'column',gap:18 }}>

        {/* HEADER mobile sticky */}
        <div style={{
          position:'sticky',top:0,zIndex:100,
          background:'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
          backdropFilter:'blur(14px)',
          borderBottom:'2.5px solid var(--text-primary)',
          margin:'0 -14px',
          padding:'10px 14px',
          display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,
        }}>
          <div style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer',flexShrink:0 }} onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>
            <div id="header-logo-target" style={{ position:'relative',width:34,height:34,flexShrink:0 }}>
              <img src="/logo.png" alt="StudyAL" style={{
                position:'absolute',left:'55%',top:'48%',
                width:'100%',height:'100%',
                objectFit:'contain',objectPosition:'center',
                transform:'translate(-50%,-50%) scale(2.2)',
                pointerEvents:'none',zIndex:1,
              }}/>
            </div>
            <span className="brand-studyal" style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)' }}>
              <span className="brand-study" style={{ fontSize: '85%', color: 'var(--text-primary)' }}>Study</span><span className="brand-al">AL</span>
            </span>
          </div>

          <button onClick={() => setBuscadorOpen(true)} style={{
            flex:1,minWidth:0,padding:'7px 10px',
            background:'var(--bg-card)',
            border:'2px solid var(--text-primary)',borderRadius:10,cursor:'pointer',
            textAlign:'left',color:'var(--text-faint)',
            fontFamily:BODY,fontSize:14,display:'flex',alignItems:'center',gap:6,
            boxShadow:'2px 2px 0 var(--text-primary)',
          }}>
            <span>🔍</span>
            <span style={{ overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
              {lang==='en'?'Search…':'Buscar…'}
            </span>
          </button>

          <div style={{ display:'flex',alignItems:'center',gap:6,flexShrink:0 }}>
            <button
              onClick={()=>((window as any).__showNavLoader?.('/news'), router.push('/news'))}
              title="News"
              style={{
                width:36,height:36,borderRadius:8,
                background:'var(--bg-card)',
                border:'2px solid var(--text-primary)',
                boxShadow:'2px 2px 0 var(--text-primary)',
                cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:17,flexShrink:0,
              }}
            >📰</button>

            <button
              onClick={()=>{
                const isLight = document.documentElement.classList.contains('light');
                if (isLight) {
                  document.documentElement.classList.remove('light');
                  try { localStorage.setItem('studyal_darkmode','dark'); } catch {}
                } else {
                  document.documentElement.classList.add('light');
                  try { localStorage.setItem('studyal_darkmode','light'); } catch {}
                }
                setThemeKey(k=>k+1);
              }}
              title="Tema"
              style={{
                width:36,height:36,borderRadius:8,
                background:'var(--bg-card)',
                border:'2px solid var(--text-primary)',
                boxShadow:'2px 2px 0 var(--gold)',
                cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:17,flexShrink:0,
              }}
            >
              <span suppressHydrationWarning key={themeKey}>
                {typeof window !== 'undefined' && document.documentElement.classList.contains('light') ? '☀️' : '🌙'}
              </span>
            </button>

            <NotificacionesPanel/>
            <UserMenu/>
          </div>
        </div>

        <div style={{ display:'flex',flexDirection:'column',gap:2,paddingTop:4 }}>
          <DiaFecha lang={lang}/>
          <WelcomeUser name={userName}/>
        </div>

        <div style={{ display:'flex',justifyContent:'center',padding:'10px 0' }}>
          <StudyALCenter mob={true}/>
        </div>

        <div style={{ display:'flex',justifyContent:'center',marginTop:6 }}>
          <MateriasHoja materias={materias} onOpen={(id) => navMateria(id)} onCreate={() => navMateria()} mob={true} lang={lang}/>
        </div>

        <div style={{ display:'flex',justifyContent:'center',marginTop:10 }}>
          <TopPodio onClick={() => nav('/leaderboard','Leaderboard','var(--gold)','🏆')} mob={true}/>
        </div>

        <div style={{ display:'flex',gap:14,alignItems:'flex-start',justifyContent:'space-between' }}>
          <div style={{ flex:1,minWidth:0 }}>
            <CosasPorHacer onClick={() => nav('/agenda','Agenda','#f472b6','📋')} mob={true}/>
          </div>
          <FraseChapBot onClick={() => nav('/chap','ChapBot','#f472b6','🤖')} mob={true} lang={lang}/>
        </div>

        <div style={{ display:'flex',justifyContent:'center' }}>
          <TimerButton onClick={() => nav('/pomodoro','Timer','#ef4444','⏱️')} mob={true}/>
        </div>

        <RachaWidget/>

        <div id="horario-section">
          <h2 style={{ fontFamily:HAND,fontSize:26,fontWeight:900,color:'var(--text-primary)',margin:'0 0 10px',transform:'rotate(-1deg)',display:'inline-block' }}>📅 Horario</h2>
          <div style={{
            border:'1.5px solid var(--border-color)',borderRadius:12,
            padding:'14px 16px',boxShadow:'4px 5px 0 var(--text-primary)',
            position:'relative',
          }}>
            <div style={{ position:'absolute',top:0,bottom:0,left:32,width:1.5,background:'#ef4444',opacity:.4,pointerEvents:'none' }}/>
            <div style={{ position:'relative',zIndex:1 }}><HorarioWidget/></div>
          </div>
        </div>

        <div style={{ marginTop:20 }}>
          <MapaProgreso playerStats={playerStats} myRank={myRank} totalUsers={totalUsers} onLeaderboard={() => nav('/leaderboard','Leaderboard','var(--gold)','🏆')} mob={true}/>
        </div>

        <NotasRapidas/>

        <div>
          <h2 style={{ fontFamily:HAND,fontSize:26,fontWeight:900,color:'var(--text-primary)',margin:'0 0 10px',transform:'rotate(-1deg)',display:'inline-block' }}>📊 Gráficas</h2>
          <GraficasPanel materias={materias} mob={mob} xpTotal={playerStats?.xpTotal || 0}/>
        </div>

        <Footer/>
      </div>

      <style>{`
        @keyframes spin-slow{to{transform:rotate(360deg)}}
        .hover3d{transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s,filter .25s}
        .hover3d:hover{transform:translateY(-3px) scale(1.02);filter:brightness(1.05)}
        .hover3d:active{transform:translateY(1px) scale(.99)}
      `}</style>
    </div>
  );

  /* ═════════ DESKTOP ═════════ */
  return (
    <div style={{ minHeight:'100vh',position:'relative' }}>
      <OnboardingCheck/>
      {showDailyReward && <DailyReward onClose={() => setShowDailyReward(false)} onClaim={async () => { await darXP('daily_reward', 15); setShowDailyReward(false); }}/>}
      <BuscadorModal open={buscadorOpen} onClose={() => setBuscadorOpen(false)}/>

      {/* HEADER */}
      <header style={{
        position:'sticky',top:0,zIndex:100,
        background:'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
        backdropFilter:'blur(14px)',borderBottom:'2.5px solid var(--text-primary)',
        padding:'10px clamp(14px,3vw,36px)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'clamp(10px,2vw,16px)',flexWrap:'wrap',
      }}>
        <div style={{ display:'flex',alignItems:'center',gap:10,cursor:'pointer',minWidth:0,flexShrink:0 }} onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>
          <div id="header-logo-target" style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
            <img src="/logo.png" alt="StudyAL" style={{
              position: 'absolute', left: '55%', top: '48%',
              width: '100%', height: '100%',
              objectFit: 'contain', objectPosition: 'center',
              transform: 'translate(-50%, -50%) scale(2.2)',
              pointerEvents: 'none', zIndex: 1,
            }}/>
          </div>
          <h1 style={{ margin: 0, fontFamily: HAND, fontSize: 'clamp(22px,2.4vw,28px)', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1, transform: 'rotate(-1deg)', display: 'inline-block' }}>
            <span className="brand-study">Study</span><span className="brand-al"><span style={{ color: '#ef4444' }}>A</span><span style={{ color: 'var(--text-primary)' }}>L</span></span>
          </h1>
          <BetaBadge/>
        </div>
        <button onClick={() => setBuscadorOpen(true)} style={{
          flex:'1 1 280px',minWidth:220,maxWidth:'min(440px, 100%)',padding:'9px 16px',background:'var(--bg-card)',
          border:'2px solid var(--text-primary)',borderRadius:10,cursor:'pointer',
          textAlign:'left',color:'var(--text-faint)',
          fontFamily:BODY,fontSize:17,display:'flex',alignItems:'center',gap:8,
          boxShadow:'2px 2px 0 var(--text-primary)',
        }}>
          <span>🔍</span><span>{lang==='en'?'Search anything…':'Buscar materias, apuntes…'}</span>
          <span style={{ marginLeft:'auto',fontSize:11,opacity:.6 }}>⌘K</span>
        </button>
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0,marginLeft:'auto'}}>
          <button
            onClick={()=>((window as any).__showNavLoader?.('/news'), router.push('/news'))}
            title="📰 News - The StudyAL Times"
            style={{
              width:42,height:42,borderRadius:10,
              background:'var(--bg-card)',
              border:'2px solid var(--text-primary)',
              boxShadow:'2px 2px 0 var(--text-primary)',
              cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:20,
              transform:'rotate(-3deg)',
              transition:'all .25s',
              position:'relative',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0) translateY(-2px)';e.currentTarget.style.boxShadow='3px 4px 0 var(--text-primary)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-3deg)';e.currentTarget.style.boxShadow='2px 2px 0 var(--text-primary)';}}
          >
            📰
          </button>

          <button
            onClick={()=>{
              const isLight = document.documentElement.classList.contains('light');
              if (isLight) {
                document.documentElement.classList.remove('light');
                try { localStorage.setItem('studyal_darkmode', 'dark'); } catch {}
              } else {
                document.documentElement.classList.add('light');
                try { localStorage.setItem('studyal_darkmode', 'light'); } catch {}
              }
              setThemeKey(k=>k+1);
            }}
            title="Cambiar tema"
            style={{
              width:42,height:42,borderRadius:10,
              background:'var(--bg-card)',
              border:'2px solid var(--text-primary)',
              boxShadow:'2px 2px 0 var(--gold)',
              cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:20,
              transform:'rotate(2deg)',
              transition:'all .25s',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0) translateY(-2px)';e.currentTarget.style.boxShadow='3px 4px 0 var(--gold)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(2deg)';e.currentTarget.style.boxShadow='2px 2px 0 var(--gold)';}}
          >
            <span suppressHydrationWarning key={themeKey}>
              {typeof window !== 'undefined' && document.documentElement.classList.contains('light') ? '☀️' : '🌙'}
            </span>
          </button>

          <NotificacionesPanel/>
          <UserMenu/>
        </div>
      </header>

      <main style={{ position:'relative',zIndex:1,maxWidth:1240,margin:'0 auto',padding:'28px clamp(14px,3vw,40px) 60px' }}>

        <div style={{ display:'grid',gridTemplateColumns:isTablet ? '115px 1fr 185px' : 'minmax(0,1fr) auto minmax(0,1fr)',gap:isTablet ? 12 : 32,alignItems:'flex-start',justifyItems:isTablet?'center':'stretch',marginBottom:32,width:'100%',overflow:'visible' }}>

          {/* IZQ */}
          <div style={{ display:'flex',flexDirection:'column',gap:18,alignItems:'flex-start' }}>
            <div style={{ display:'flex',flexDirection:'column',gap:2,alignItems:'flex-start' }}>
              <DiaFecha lang={lang}/>
              <WelcomeUser name={userName}/>
            </div>
            <HorarioFlecha targetId="horario-section" mob={false}/>
          </div>

          {/* CENTRO */}
          <div style={{ display:'flex',justifyContent:'center' }}>
            <div style={{ display:'flex', justifyContent:'center', alignItems:'flex-start', width:'100%' }}><StudyALCenter mob={false} tablet={isTablet}/></div>
          </div>

          {/* DER */}
          <div style={{ display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8,minWidth:0,maxWidth:'100%',overflow:'visible',position:'relative',zIndex:5 }}>
            <span style={{ fontFamily:HAND,fontSize:'clamp(14px,1.4vw,18px)',color:'var(--text-muted)',fontStyle:'italic',transform:'rotate(-3deg)',display:'inline-block',marginRight:isTablet?14:30 }}>→ improve</span>
            <TopPodio onClick={() => nav('/leaderboard','Leaderboard','var(--gold)','🏆')} mob={false} tablet={isTablet}/>
          </div>
        </div>

        <div style={{ display:'flex',justifyContent:'center',marginBottom:36 }}>
          <MateriasHoja materias={materias} onOpen={(id) => navMateria(id)} onCreate={() => navMateria()} mob={false} lang={lang}/>
        </div>

        <div style={{ display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',gap:isTablet?16:32,alignItems:'flex-start',marginBottom:40 }}>
          <div style={{ background:'var(--bg-card)',border:'2px dashed var(--border-color)',borderRadius:14,padding:'16px 20px' }}>
            <CosasPorHacer onClick={() => nav('/agenda','Agenda','#f472b6','📋')} mob={false}/>
          </div>

          <div style={{ display:'flex',justifyContent:'center' }}>
            <RachaWidget/>
          </div>

          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:18 }}>
            <FraseChapBot onClick={() => nav('/chap','ChapBot','#f472b6','🤖')} mob={false} lang={lang}/>
            <TimerButton onClick={() => nav('/pomodoro','Timer','#ef4444','⏱️')} mob={false}/>
          </div>
        </div>

        <div id="horario-section" style={{ marginBottom:40 }}>
          <h2 style={{ fontFamily:HAND,fontSize:36,fontWeight:900,color:'var(--text-primary)',margin:'0 0 16px',transform:'rotate(-1deg)',display:'inline-block' }}>📅 Horario</h2>
          <div style={{
            border:'1.5px solid var(--border-color)',
            borderRadius:14,
            padding:'18px 22px',
            boxShadow:'5px 6px 0 var(--text-primary)',
            transform:'rotate(-.4deg)',
            position:'relative',
          }}>
            <div style={{ position:'absolute',top:0,bottom:0,left:46,width:1.5,background:'#ef4444',opacity:.4,pointerEvents:'none' }}/>
            <div style={{ relative:true,zIndex:1,filter:'drop-shadow(0 1px 0 rgba(0,0,0,.05))' }}>
              <HorarioWidget/>
            </div>
          </div>
        </div>

        <div style={{ marginBottom:40 }}>
          <MapaProgreso playerStats={playerStats} myRank={myRank} totalUsers={totalUsers} onLeaderboard={() => nav('/leaderboard','Leaderboard','var(--gold)','🏆')} mob={false}/>
        </div>

        <div style={{ display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,2fr)',gap:isTablet?18:28,alignItems:'flex-start',marginBottom:36 }}>
          <NotasRapidas/>
          <div>
            <h2 style={{ fontFamily:HAND,fontSize:32,fontWeight:900,color:'var(--text-primary)',margin:'0 0 12px',transform:'rotate(-1deg)',display:'inline-block' }}>📊 Gráficas</h2>
            <GraficasPanel materias={materias} mob={mob} xpTotal={playerStats?.xpTotal || 0}/>
          </div>
        </div>

        <Footer/>
      </main>

      <style>{`
        @keyframes spin-slow{to{transform:rotate(360deg)}}
        .hover3d{transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s,filter .25s}
        .hover3d:hover{transform:translateY(-3px) scale(1.02);filter:brightness(1.05)}
        .hover3d:active{transform:translateY(1px) scale(.99)}
      `}</style>
    </div>
  );
}
