'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Materia } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { getMateriasDB } from '../lib/db';
import { getObjetivos, ObjetivoAgenda } from '../lib/agenda';
import UserMenu from '../components/UserMenu';
import Buscador from '../components/Buscador';
import NavbarMobile from '../components/NavbarMobile';
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

const HAND = "'Caveat',cursive";

/* ─── LoadScreen con mensajes dinámicos y partículas ─── */
const NAV_MESSAGES: Record<string, string[]> = {
  '/': ['Cargando StudyAL...', 'Llevándote al inicio...', 'Preparando tu espacio...', 'De vuelta al inicio...'],
  '/leaderboard': ['Cargando ranking...', 'Buscando a los mejores...', '¿Estarás en el top?...', 'Preparando el podio...'],
  '/agenda': ['Abriendo tu agenda...', 'Organizando tu día...', 'Cargando pendientes...', 'Revisando tareas...'],
  '/chap': ['Conectando con El Chap...', 'Despertando la IA...', 'El Chap te espera...', 'Iniciando chat...'],
  '/pomodoro': ['Preparando el timer...', 'Modo focus activado...', 'A estudiar se ha dicho...', 'Cargando Pomodoro...'],
  '/materias': ['Abriendo tus materias...', 'Cargando apuntes...', 'Preparando el estudio...', 'Buscando tus notas...'],
  '/settings': ['Abriendo ajustes...', 'Cargando preferencias...'],
  '/perfil': ['Cargando tu perfil...', 'Preparando estadísticas...'],
  '/comunidad': ['Entrando a la comunidad...', 'Cargando posts...', 'Conectando estudiantes...'],
  '_default': ['Cargando...', 'Un momento...', 'Ya casi...', 'Preparando todo...'],
  '_loading': ['Cargando materias...', 'Preparando tu espacio...', 'Casi listo...', 'Organizando todo...'],
};

function getNavMessage(href?: string): string {
  const key = href && NAV_MESSAGES[href] ? href : '_default';
  const msgs = NAV_MESSAGES[key];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

function LoadScreen({ label, color, emoji, href }: { label: string; color: string; emoji: string; href?: string }) {
  const [displayed, setDisplayed] = useState('');
  const [charIdx, setCharIdx] = useState(0);
  const [particles, setParticles] = useState<{id:number;x:number;y:number;dx:number;dy:number;s:number;o:number}[]>([]);
  const [msg] = useState(() => href ? getNavMessage(href) : label);
  const frameRef = React.useRef(0);

  useEffect(() => { setDisplayed(''); setCharIdx(0); }, [msg]);

  useEffect(() => {
    if (charIdx < msg.length) {
      const t = setTimeout(() => {
        setDisplayed(msg.slice(0, charIdx + 1));
        setCharIdx(c => c + 1);
      }, 38);
      return () => clearTimeout(t);
    }
  }, [charIdx, msg]);

  // Partículas del logo
  useEffect(() => {
    let id = 0;
    const iv = setInterval(() => {
      setParticles(prev => {
        const next = prev
          .map(p => ({ ...p, x: p.x + p.dx, y: p.y + p.dy, o: p.o - 0.015, s: p.s * 0.98 }))
          .filter(p => p.o > 0);
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 1.5;
        next.push({
          id: id++,
          x: 50, y: 50,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          s: 3 + Math.random() * 4,
          o: 0.7 + Math.random() * 0.3,
        });
        return next.slice(-20);
      });
    }, 80);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:99999,
      background:'var(--bg-primary)',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      gap:24, overflow:'hidden',
    }}>
      {/* Logo con partículas */}
      <div style={{ position:'relative', width:120, height:120 }}>
        {particles.map(p => (
          <div key={p.id} style={{
            position:'absolute',
            left:`${p.x}%`, top:`${p.y}%`,
            width:p.s, height:p.s,
            borderRadius:'50%',
            background: color,
            opacity: p.o,
            transform:'translate(-50%,-50%)',
            pointerEvents:'none',
            transition:'none',
          }}/>
        ))}
        <div style={{
          width:100, height:100,
          position:'absolute', left:10, top:10,
          borderRadius:'50%',
          background:'var(--bg-card)',
          border:`3px solid ${color}`,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:48,
          boxShadow:`0 0 32px ${color}55`,
          animation:'lsPulse 1.4s ease-in-out infinite',
          zIndex:2,
        }}>
          {emoji}
        </div>
      </div>

      {/* Texto typewriter */}
      <div style={{
        fontFamily:HAND, fontSize:20, fontWeight:700,
        color:'var(--text-primary)',
        minHeight:32,
        display:'flex', alignItems:'center', gap:4,
      }}>
        <span>{displayed}</span>
        <span style={{
          display:'inline-block', width:2, height:20,
          background:color, borderRadius:2,
          animation:'lsBlink .55s step-end infinite',
        }}/>
      </div>

      {/* Barra de progreso */}
      <div style={{
        width:220, height:5,
        background:'var(--bg-card)',
        borderRadius:99, overflow:'hidden',
        border:'1px solid var(--text-faint)',
      }}>
        <div style={{
          height:'100%',
          background:`linear-gradient(90deg,${color},#f3ca4c)`,
          borderRadius:99,
          animation:'lsBar 1.8s ease-in-out infinite',
        }}/>
      </div>

      <p style={{
        fontFamily:HAND, fontSize:13,
        color:'var(--text-faint)', margin:0,
      }}>StudyAL ✦ Tu espacio de estudio</p>

      <style>{`
        @keyframes lsBlink  { 50% { opacity:0 } }
        @keyframes lsPulse  { 0%,100%{transform:scale(1);box-shadow:0 0 32px ${color}55} 50%{transform:scale(1.07);box-shadow:0 0 48px ${color}88} }
        @keyframes lsBar    { 0%{width:4%} 60%{width:80%} 100%{width:96%} }
      `}</style>
    </div>
  );
}

/* ─── Buscador modal ─── */
function BuscadorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,.55)',backdropFilter:'blur(4px)',display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:80 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width:'100%',maxWidth:620,padding:'0 16px' }}>
        <Buscador onClose={onClose}/>
      </div>
    </div>
  );
}

/* ─── DiaFecha + WelcomeUser ─── */
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
      fontFamily:HAND,
      fontSize:15,
      color:'var(--text-faint)',
      margin:0,
      letterSpacing:.3,
    }}>
      {dias[hoy.getDay()]} {hoy.getDate()} {lang==='en'?'of':'de'} {meses[hoy.getMonth()]}
    </p>
  );
}

function WelcomeUser({ name }: { name: string }) {
  return (
    <div>
      <div style={{ fontFamily:HAND,fontSize:18,color:'var(--text-muted)',fontWeight:600,lineHeight:1,fontStyle:'italic' }}>welcome back</div>
      <div style={{ fontFamily:HAND,fontSize:30,fontWeight:900,color:'var(--text-primary)',lineHeight:1.05,marginTop:2 }}>{name||'estudiante'}</div>
      <svg width="120" height="6" style={{ display:'block',marginTop:2 }}>
        <path d="M2 3 Q 60 0 118 4" stroke="var(--gold)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".7"/>
      </svg>
    </div>
  );
}

/* ─── HorarioFlecha (scroll a horario abajo) ─── */
function HorarioFlecha({ targetId, mob }: { targetId: string; mob: boolean }) {
  const click = () => {
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
  };
  return (
    <button onClick={click} className="hover3d" style={{
      background:'color-mix(in srgb,var(--gold) 22%,var(--bg-card))',
      border:'3px solid var(--gold)',
      borderRadius:14,padding:mob?'12px 20px':'14px 24px',
      cursor:'pointer',display:'flex',alignItems:'center',gap:14,
      boxShadow:'5px 5px 0 var(--gold), 0 10px 24px rgba(245,200,66,.35)',
      transform:'rotate(-2deg)',
    }}>
      <div style={{ display:'flex',flexDirection:'column',alignItems:'flex-start',gap:0 }}>
        <span style={{ fontFamily:HAND,fontSize:mob?16:18,fontWeight:700,color:'var(--text-muted)',fontStyle:'italic',lineHeight:1 }}>ir a</span>
        <span style={{ fontFamily:HAND,fontSize:mob?28:34,fontWeight:900,color:'var(--text-primary)',lineHeight:1.1 }}>📅 horario</span>
      </div>
      <svg width="32" height="50" viewBox="0 0 32 50">
        <path d="M16 4 L 16 38" stroke="var(--gold)" strokeWidth="4" fill="none" strokeLinecap="round"/>
        <path d="M6 30 L 16 44 L 26 30" stroke="var(--gold)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

/* ─── CosasPorHacer (objetivos) ─── */
function CosasPorHacer({ onClick, mob }: { onClick: () => void; mob: boolean }) {
  const [tasks, setTasks] = useState<ObjetivoAgenda[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
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
        <p style={{ fontFamily:HAND,fontSize:14,color:'var(--text-faint)',fontStyle:'italic',margin:0 }}>cargando...</p>
      ) : tasks.length===0 ? (
        <p style={{ fontFamily:HAND,fontSize:15,color:'var(--text-faint)',fontStyle:'italic',margin:0 }}>✨ ¡todo al día!</p>
      ) : (
        <ul style={{ listStyle:'none',padding:0,margin:0,display:'flex',flexDirection:'column',gap:5 }}>
          {tasks.map((t,i)=>(
            <li key={i} style={{ display:'flex',alignItems:'flex-start',gap:6,fontFamily:HAND,fontSize:mob?15:17,color:'var(--text-primary)',lineHeight:1.2 }}>
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

/* ─── Logo central (sin título) ─── */
/* ─── Logo central con trazos suaves animados (NO gira) ─── */
/* ─── Logo central con trazo dorado que se dibuja (NO gira) ─── */
/* ─── Logo central con círculo dorado fijo + destello brillante ─── */
function StudyALCenter({ mob }: { mob: boolean }) {
  const box = mob ? 180 : 260;
  const scale = mob ? 2.2 : 2.8;
  const ringInset = mob ? 40 : 55;

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, overflow:'visible', marginTop: mob ? 40 : 70 }}>
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
            {/* Gradiente brillante para el destello */}
            <linearGradient id="shineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#fff8d1" stopOpacity="0"/>
              <stop offset="40%"  stopColor="#fff8d1" stopOpacity="1"/>
              <stop offset="60%"  stopColor="#ffffff" stopOpacity="1"/>
              <stop offset="100%" stopColor="#fff8d1" stopOpacity="0"/>
            </linearGradient>
          </defs>

          {/* Círculo dorado base — SIEMPRE visible */}
          <circle
            cx="100"
            cy="100"
            r="92"
            fill="none"
            stroke="#f3ca4c"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{
              filter:'drop-shadow(0 0 6px rgba(243,202,76,0.55)) drop-shadow(0 0 14px rgba(243,202,76,0.3))',
            }}
          />

          {/* Destello brillante que recorre el círculo */}
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
              animation: 'nbShine 3.2s linear infinite',
              filter:'drop-shadow(0 0 6px #fff8c5) drop-shadow(0 0 12px rgba(255,243,170,0.85)) drop-shadow(0 0 22px rgba(243,202,76,0.6))',
              opacity: 0.95,
            }}
          />

          {/* Segundo destello más sutil, desfasado */}
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
              animation: 'nbShine 3.2s linear infinite',
              filter:'drop-shadow(0 0 4px #fff)',
              opacity: 0.7,
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

      <svg width="36" height="50" viewBox="0 0 36 50" style={{ marginTop:4 }}>
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

function TopPodio({ onClick, mob }: { onClick: () => void; mob: boolean }) {
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
  const heights = mob ? [44, 64, 86, 56, 38] : [56, 80, 105, 70, 48];
  const colors  = ['#f5c842','#cbd5e1','#cd7f32','#94a3b8','#94a3b8'];
  const medals  = ['🥇','🥈','🥉','',''];

  return (
    <div onClick={onClick} style={{
      position:'relative',cursor:'pointer',
      border:'2px solid var(--text-primary)',borderRadius:6,
      padding:mob?'14px 12px 10px':'18px 16px 12px',
      boxShadow:'5px 6px 0 rgba(0,0,0,.25), 0 12px 28px rgba(0,0,0,.18)',
      transform:'rotate(2.5deg)',transition:'all .25s',
      minWidth:mob?210:255,
    }}
      onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translate(-2px,-3px)';e.currentTarget.style.boxShadow='7px 8px 0 rgba(0,0,0,.3),0 14px 32px rgba(0,0,0,.22)';}}
      onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(2.5deg)';e.currentTarget.style.boxShadow='5px 6px 0 rgba(0,0,0,.25),0 12px 28px rgba(0,0,0,.18)';}}
    >
      {/* Cinta scotch arriba */}
      <div style={{ position:'absolute',top:-12,left:'50.8%',transform:'translateX(-50%) rotate(-3deg)',width:70,height:18,background:'rgba(245,200,66,.55)',borderRadius:1,boxShadow:'0 1px 3px rgba(0,0,0,.18)',zIndex:5 }}/>
      <div style={{ position:'absolute',top:-8,right:14,transform:'rotate(8deg)',width:28,height:10,background:'rgba(245,200,66,.45)',borderRadius:1,zIndex:5 }}/>

      <div style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginBottom:8 }}>
        <span style={{ fontSize:18 }}>🏆</span>
        <span style={{ fontFamily:HAND,fontSize:mob?20:24,fontWeight:900,color:'var(--text-primary)' }}>Top 5</span>
      </div>

      {loading ? (
        <div style={{ height:120,display:'flex',alignItems:'center',justifyContent:'center',color:'#666',fontSize:13,fontStyle:'italic',fontFamily:HAND }}>cargando...</div>
      ) : top.length===0 ? (
        <div style={{ height:120,display:'flex',alignItems:'center',justifyContent:'center',color:'#666',fontSize:13,fontStyle:'italic',fontFamily:HAND,textAlign:'center' }}>sin datos aún<br/>¡a estudiar!</div>
      ) : (
        <div style={{ display:'flex',justifyContent:'center',alignItems:'flex-end',gap:mob?3:5,height:mob?150:170,padding:'0 2px' }}>
          {order.map((idx, vi) => {
            const u = top[idx];
            if (!u) return <div key={vi} style={{ flex:1 }}/>;
            const h = heights[vi];
            const c = colors[idx];
            const ini = (u.nombre || '?').charAt(0).toUpperCase();
            return (
              <div key={vi} style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2 }}>
                <div style={{ width:mob?22:26,height:mob?22:26,borderRadius:'50%',background:c,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:10,fontWeight:800,overflow:'hidden',border:'1.5px solid var(--text-primary)' }}>
                  {u.avatar_url ? <img src={u.avatar_url} alt="" style={{ width:'100%',height:'100%',objectFit:'cover' }}/> : ini}
                </div>
                <span style={{ fontSize:9,fontWeight:700,color:'var(--text-primary)',maxWidth:mob?40:50,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textAlign:'center',lineHeight:1 }}>{u.nombre}</span>
                <span style={{ fontSize:8,color:'#666',fontFamily:HAND,lineHeight:1 }}>{u.xp_total}xp</span>
                <div style={{
                  width:'100%',height:h,
                  borderRadius:'4px 4px 0 0',border:'1.5px solid var(--text-primary)',borderBottom:'none',
                  display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:5,
                  position:'relative',
                }}>
                  <span style={{ fontFamily:HAND,fontSize:mob?18:22,fontWeight:900,color:'#fff',textShadow:'0 1px 2px rgba(0,0,0,.4)',lineHeight:1 }}>{idx+1}</span>
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

/* ─── MateriasHoja (hoja apuntes que se abre) ─── */
function MateriasHoja({ materias, onOpen, onCreate, mob, lang }: {
  materias: Materia[]; onOpen: (materiaId?: string) => void; onCreate: () => void; mob: boolean; lang: string;
}) {
  const [open, setOpen] = useState(false);
  const tiene = materias.length > 0;
  console.log('📚 [MateriasHoja] render:', { tiene, count: materias.length, open });

  return (
    <div style={{ position:'relative',width:'100%',maxWidth:mob?340:520 }}>
      {/* Banda título con espirales */}
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

      {/* Cuerpo libreta */}
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
                <button onClick={(e)=>{e.stopPropagation();onCreate();}} style={{
                  padding:'10px 22px',borderRadius:10,border:'none',background:'var(--gold)',color:'var(--text-primary)',
                  cursor:'pointer',fontFamily:HAND,fontSize:18,fontWeight:800,
                  boxShadow:'0 4px 0 rgba(200,160,30,.5)',
                }}>+ Crear primera materia</button>
              </div>
            ) : (
              <>
                <div style={{ display:'grid',gridTemplateColumns:mob?'1fr':'1fr 1fr',gap:10 }}>
                  {materias.slice(0,8).map((m,idx)=>(
                    <div key={m.id} onClick={(e)=>{e.stopPropagation();onOpen(m.id);}} style={{
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
                  <button onClick={(e)=>{e.stopPropagation();onOpen();}} style={{
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

/* ─── HorarioTabla (mostrar día + clases o "configurar") ─── */
function HorarioTabla({ mob, lang, onConfig }: { mob: boolean; lang: string; onConfig: () => void }) {
  const [clases, setClases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    try {
      const raw = localStorage.getItem('josea_horario') || localStorage.getItem('horario');
      if (raw) {
        const data = JSON.parse(raw);
        const hoy = new Date().getDay(); // 0=dom
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
      {/* Flecha apunta */}
      <div style={{ paddingTop:30,flexShrink:0 }}>
        <svg width="50" height="40" viewBox="0 0 50 40">
          <path d="M2 20 Q 25 8 42 20" stroke="var(--text-primary)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
          <path d="M36 12 L 46 20 L 36 28" stroke="var(--text-primary)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
        </svg>
      </div>

      {/* Tabla cuaderno */}
      <div style={{
        flex:1,position:'relative',
        border:'1.5px solid var(--border-color)',borderRadius:10,
        boxShadow:'4px 5px 0 rgba(0,0,0,.22)',
        transform:'rotate(-1deg)',
        overflow:'hidden',
        maxWidth:mob?'100%':480,
      }}>
        {/* Header día */}
        <div style={{
          padding:'8px 14px',background:'var(--gold)',
          borderBottom:'2px solid var(--text-primary)',
          fontFamily:HAND,fontSize:mob?20:24,fontWeight:900,color:'var(--text-primary)',textAlign:'center',
        }}>
          {diaActual}
        </div>

        {/* Filas */}
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

/* ─── MapaProgreso (XP graph + OVR + Posición) ─── */
function MiniXPChart({ days = 7, color = 'var(--blue)', xpTotal = 0 }: { days?: number; color?: string; xpTotal?: number }) {
  // Datos reales de XP diario (localStorage)
  const [data, setData] = useState<number[]>(Array(days).fill(0));
  useEffect(() => {
    import('../lib/xpDiario').then(mod => {
      const d = mod.getXpUltimosDias(days);
      setData(d.map(x => x.xp));
    });
  }, [days]);
  const max = Math.max(...data, 1);
  const W = 180, H = 70;
  const stepX = W/(days-1);
  const points = data.map((v,i)=>`${i*stepX},${H-(v/max)*H}`).join(' ');

  return (
    <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:4 }}>
      <span style={{ fontFamily:HAND,fontSize:14,fontWeight:700,color:'var(--text-muted)',fontStyle:'italic' }}>📈 XP esta semana</span>
      <svg width={W} height={H+10} style={{ overflow:'visible' }}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        {data.map((v,i)=>(
          <circle key={i} cx={i*stepX} cy={H-(v/max)*H} r="3" fill={color} stroke="var(--bg-card)" strokeWidth="1.5"/>
        ))}
      </svg>
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
  const genero = playerStats?.genero || '';
  const himHer = genero==='masculino' ? 'him' : genero==='femenino' ? 'her' : '';

  return (
    <div style={{ position:'relative' }}>
      {/* Título */}
      <div style={{ textAlign:'center',marginBottom:20 }}>
        <h2 style={{ fontFamily:HAND,fontSize:mob?32:42,fontWeight:900,color:'var(--text-primary)',margin:0,lineHeight:1,transform:'rotate(-1deg)',display:'inline-block' }}>
          Mi Progreso
        </h2>
        <svg width={mob?180:240} height="6" style={{ display:'block',margin:'2px auto 0' }}>
          <path d={mob?"M2 3 Q 90 0 178 4":"M2 3 Q 120 0 238 4"} stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".6"/>
        </svg>
      </div>

      <div style={{
        display:'grid',
        gridTemplateColumns: mob ? '1fr' : '260px 1fr 200px',
        gap:mob?28:40,
        alignItems:'center',justifyItems:'center',
        position:'relative',
      }}>
        {/* IZQ — XP graph */}
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:6,position:'relative' }}>
          <div style={{
            border:'2px solid var(--text-primary)',borderRadius:10,
            padding:'14px 18px',boxShadow:'2px 3px 0 var(--nb-shadow-stroke), 0 8px 18px rgba(0,0,0,0.12)',
            transform:'rotate(-2deg)',
          }}>
            <div style={{ fontFamily:HAND,fontSize:18,fontWeight:900,color:'var(--text-primary)',marginBottom:2,textAlign:'center' }}>
              ⚡ XP
            </div>
            <div style={{ fontFamily:HAND,fontSize:24,fontWeight:900,color:'var(--blue)',textAlign:'center',lineHeight:1,marginBottom:4 }}>
              {(playerStats?.xpTotal||0).toLocaleString()}
            </div>
            <MiniXPChart days={7} color="var(--blue)" xpTotal={playerStats?.xpTotal || 0}/>
          </div>
          {/* anotación him/her */}
          {himHer && (
            <div style={{ position:'absolute',top:-14,right:-12,fontFamily:HAND,fontSize:18,fontWeight:800,color:'var(--pink)',transform:'rotate(8deg)',background:'var(--bg-secondary)',padding:'2px 8px',border:'1.5px dashed var(--pink)',borderRadius:6 }}>
              {himHer}!
            </div>
          )}
        </div>

        {/* CENTRO — OVR Card */}
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:6 }}>
          <span style={{ fontFamily:HAND,fontSize:14,fontWeight:700,color:'var(--text-faint)',fontStyle:'italic',transform:'rotate(-2deg)' }}>tu carta 🎴</span>
          <div style={{ width:mob?280:320,maxWidth:'100%' }}>
            {playerStats
              ? <PlayerCard stats={playerStats}/>
              : <div style={{ aspectRatio:'5/7',background:'var(--bg-card)',borderRadius:18,border:'2px dashed var(--border-color)',display:'flex',alignItems:'center',justifyContent:'center' }}>
                  <span style={{ fontFamily:HAND,fontSize:15,color:'var(--text-faint)',fontStyle:'italic' }}>cargando carta...</span>
                </div>
            }
          </div>
        </div>

        {/* DER — Posición */}
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:8 }}>
          <PosicionPostit pos={myRank} totalUsers={totalUsers} onClick={onLeaderboard} mob={mob}/>
          <span style={{ fontFamily:HAND,fontSize:13,color:'var(--text-faint)',fontStyle:'italic',transform:'rotate(3deg)' }}>leaderboard global ↑</span>
        </div>


      </div>
    </div>
  );
}


/* ─── GraficasPanel: 4 vistas (Total / Semanal / Materia / Racha) ─── */
/* ─── GraficasPanel: 4 vistas con vibra cuaderno ─── */
function GraficasPanel({ materias, mob, xpTotal }: { materias: Materia[]; mob: boolean; xpTotal: number }) {
  const [tab, setTab] = useState<'total'|'semanal'|'materia'|'racha'>('total');
  const [xpDiario, setXpDiario] = useState<{ fecha: string; xp: number; diaCorto: string; diaCompleto: string; esHoy: boolean }[]>([]);
  const [xpAcum, setXpAcum] = useState<{ fecha: string; xpAcumulado: number; xpDia: number }[]>([]);

  useEffect(() => {
    import('../lib/xpDiario').then(mod => {
      setXpDiario(mod.getXpUltimosDias(7));
      setXpAcum(mod.getXpAcumuladoUltimosDias(30));
    });
  }, []);

  // Stats agregados
  const totalApuntes = materias.reduce((s,m)=>s+m.temas.reduce((ss,t)=>ss+(t.apuntes?.length||0),0),0);
  const totalDocs    = materias.reduce((s,m)=>s+m.temas.reduce((ss,t)=>ss+(t.documentos?.length||0),0),0);
  const totalFlash   = materias.reduce((s,m)=>s+m.temas.reduce((ss,t)=>ss+(t.flashcards?.length||0),0),0);
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
      {/* línea margen rojo cuaderno */}
      <div style={{
        position:'absolute', top:0, bottom:0,
        left: mob ? 38 : 56,
        width:1.5, background:'#ef4444', opacity:0.35,
        pointerEvents:'none',
      }}/>

      {/* Tabs estilo pestañas de cuaderno */}
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

      {/* CONTENIDO */}
      <div style={{ position:'relative', zIndex:1 }}>

        {/* ═══ TOTAL: Gráfica lineal de XP acumulado ═══ */}
        {tab==='total' && (
          <div>
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:12, flexWrap:'wrap', marginBottom:14,
            }}>
              <p style={{ fontFamily:HAND, fontSize:17, color:'var(--text-muted)', margin:0, fontStyle:'italic' }}>
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
                <div style={{ fontFamily:HAND, fontSize:13, color:'var(--text-muted)', fontStyle:'italic', lineHeight:1 }}>XP total</div>
                <div style={{ fontFamily:HAND, fontSize:28, fontWeight:900, color:'var(--blue)', lineHeight:1.1 }}>
                  ⚡ {(xpTotal || 0).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Mini stats arriba */}
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
                  <div style={{ fontFamily:HAND, fontSize:12, color:'var(--text-muted)', fontStyle:'italic' }}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Gráfica lineal */}
            <LineChartXP data={xpAcum} mob={mob}/>
          </div>
        )}

        {/* ═══ SEMANAL: Barras XP últimos 7 días ═══ */}
        {tab==='semanal' && (
          <div>
            <p style={{ fontFamily:HAND, fontSize:17, color:'var(--text-muted)', margin:'0 0 14px', fontStyle:'italic' }}>
              📅 XP ganado los últimos 7 días {' '}
              <span style={{ color:'var(--gold)', fontWeight:800 }}>(dorado = hoy)</span>
            </p>
            <BarrasSemanales data={xpDiario} mob={mob}/>
          </div>
        )}

        {/* ═══ MATERIA: Barras horizontales por materia ═══ */}
        {tab==='materia' && (
          <div>
            <p style={{ fontFamily:HAND, fontSize:17, color:'var(--text-muted)', margin:'0 0 14px', fontStyle:'italic' }}>
              📚 Contenido por materia (apuntes + documentos + flashcards)
            </p>
            {materias.length === 0 ? (
              <p style={{ fontFamily:HAND, fontSize:18, color:'var(--text-faint)', fontStyle:'italic', textAlign:'center', padding:30 }}>
                ~ aún no hay materias ~
              </p>
            ) : (
              <BarrasMaterias materias={materias} mob={mob}/>
            )}
          </div>
        )}

        {/* ═══ RACHA: Calendario y stats ═══ */}
        {tab==='racha' && (
          <RachaPanel racha={racha} mejorRacha={mejorRacha} diasEstudiados={diasEstudiados} mob={mob}/>
        )}
      </div>
    </div>
  );
}

/* ─── Sub: Gráfica lineal estilo cuaderno ─── */
function LineChartXP({ data, mob }: { data: { fecha: string; xpAcumulado: number; xpDia: number }[]; mob: boolean }) {
  if (!data.length) {
    return (
      <div style={{ textAlign:'center', padding:30 }}>
        <p style={{ fontFamily:HAND, fontSize:18, color:'var(--text-faint)', fontStyle:'italic' }}>
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

  // path suave (curvas)
  let pathD = '';
  points.forEach((p, i) => {
    if (i === 0) pathD += `M ${p.x} ${p.y}`;
    else {
      const prev = points[i-1];
      const cpx = (prev.x + p.x) / 2;
      pathD += ` Q ${cpx} ${prev.y}, ${cpx} ${(prev.y + p.y) / 2} T ${p.x} ${p.y}`;
    }
  });

  // ticks Y
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
                style={{ fontFamily: HAND, fontSize: 12, fill: 'var(--text-faint)' }}>
                {v}
              </text>
            </g>
          );
        })}

        {/* área bajo la curva */}
        <path
          d={`${pathD} L ${points[points.length-1].x} ${pad.top + innerH} L ${points[0].x} ${pad.top + innerH} Z`}
          fill="var(--blue)"
          opacity="0.12"
        />

        {/* línea principal */}
        <path
          d={pathD}
          fill="none"
          stroke="var(--blue)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* puntos */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="var(--bg-card)" stroke="var(--blue)" strokeWidth="2"/>
            {/* label cada N puntos */}
            {(i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 6) === 0) && (
              <text
                x={p.x} y={H - 8} textAnchor="middle"
                style={{ fontFamily: HAND, fontSize: 11, fill: 'var(--text-muted)' }}
              >
                {p.fecha.slice(5).replace('-', '/')}
              </text>
            )}
          </g>
        ))}

        {/* dato más alto */}
        <text x={pad.left} y={pad.top - 2}
          style={{ fontFamily: HAND, fontSize: 13, fontWeight: 800, fill: 'var(--blue)' }}>
          📈 {data[data.length-1].xpAcumulado} XP totales
        </text>
      </svg>
    </div>
  );
}

/* ─── Sub: Barras semanales ─── */
function BarrasSemanales({ data, mob }: { data: { fecha: string; xp: number; diaCorto: string; diaCompleto: string; esHoy: boolean }[]; mob: boolean }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.xp), 50);
  const totalSemana = data.reduce((s,d)=>s+d.xp, 0);
  const promedio = Math.round(totalSemana / data.length);

  return (
    <div>
      {/* Stats arriba */}
      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{
          background:'color-mix(in srgb,var(--gold) 14%,var(--bg-secondary))',
          border:'2px dashed var(--gold)', borderRadius:10,
          padding:'6px 14px', transform:'rotate(-1deg)',
        }}>
          <div style={{ fontFamily:HAND, fontSize:13, color:'var(--text-muted)', fontStyle:'italic' }}>total semana</div>
          <div style={{ fontFamily:HAND, fontSize:24, fontWeight:900, color:'var(--gold)', lineHeight:1 }}>{totalSemana} XP</div>
        </div>
        <div style={{
          background:'color-mix(in srgb,var(--blue) 14%,var(--bg-secondary))',
          border:'2px dashed var(--blue)', borderRadius:10,
          padding:'6px 14px', transform:'rotate(1deg)',
        }}>
          <div style={{ fontFamily:HAND, fontSize:13, color:'var(--text-muted)', fontStyle:'italic' }}>promedio/día</div>
          <div style={{ fontFamily:HAND, fontSize:24, fontWeight:900, color:'var(--blue)', lineHeight:1 }}>{promedio} XP</div>
        </div>
      </div>

      {/* Barras */}
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
          const color = d.esHoy ? 'var(--gold)' : 'var(--blue)';
          return (
            <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4, minWidth:0 }}>
              <span style={{
                fontFamily:HAND, fontSize:13, fontWeight:800,
                color: d.esHoy ? 'var(--gold)' : 'var(--text-primary)',
              }}>
                {d.xp}
              </span>
              <div style={{
                width:'100%', maxWidth:36,
                height: Math.max(h, 4),
                background: d.esHoy
                  ? 'linear-gradient(180deg, var(--gold) 0%, #b8860b 100%)'
                  : 'linear-gradient(180deg, var(--blue) 0%, #1e88e5 100%)',
                borderRadius:'4px 4px 0 0',
                border:`1.5px solid ${color}`,
                boxShadow:'inset 0 2px 0 rgba(255,255,255,0.25), 1px 2px 0 rgba(0,0,0,0.15)',
                transition:'height 0.4s cubic-bezier(.25,.8,.25,1)',
              }}/>
              <span style={{
                fontFamily:HAND, fontSize:15, fontWeight:800,
                color: d.esHoy ? 'var(--gold)' : 'var(--text-primary)',
                lineHeight:1,
              }}>
                {d.diaCorto}
              </span>
              {d.esHoy && (
                <span style={{ fontFamily:HAND, fontSize:11, color:'var(--gold)', fontStyle:'italic', lineHeight:1 }}>hoy</span>
              )}
            </div>
          );
        })}
      </div>

      {totalSemana === 0 && (
        <p style={{ fontFamily:HAND, fontSize:15, color:'var(--text-faint)', fontStyle:'italic', textAlign:'center', marginTop:10 }}>
          ~ aún no has ganado XP esta semana ~
        </p>
      )}
    </div>
  );
}

/* ─── Sub: Barras por materia ─── */
function BarrasMaterias({ materias, mob }: { materias: Materia[]; mob: boolean }) {
  const stats = materias.map(m => {
    const aps = m.temas.reduce((s,t)=>s+(t.apuntes?.length||0),0);
    const docs = m.temas.reduce((s,t)=>s+(t.documentos?.length||0),0);
    const fls = m.temas.reduce((s,t)=>s+(t.flashcards?.length||0),0);
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
                  fontFamily:HAND, fontSize:18, fontWeight:700,
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
              {/* desglose */}
              <div style={{ display:'flex', gap:8, marginTop:3 }}>
                {m.aps > 0 && <span style={{ fontFamily:HAND, fontSize:12, color:'var(--text-faint)' }}>📝 {m.aps}</span>}
                {m.docs > 0 && <span style={{ fontFamily:HAND, fontSize:12, color:'var(--text-faint)' }}>📄 {m.docs}</span>}
                {m.fls > 0 && <span style={{ fontFamily:HAND, fontSize:12, color:'var(--text-faint)' }}>🎴 {m.fls}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ─── Sub: Panel racha estilo calendario ─── */
function RachaPanel({ racha, mejorRacha, diasEstudiados, mob }: {
  racha: number; mejorRacha: number; diasEstudiados: string[]; mob: boolean
}) {
  // Generar últimos 35 días (5 semanas) tipo calendario
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
      {/* Stats principales */}
      <div style={{
        display:'flex', gap:14, alignItems:'center', justifyContent:'center', flexWrap:'wrap',
      }}>
        <div style={{
          textAlign:'center', padding:'14px 22px',
          background:'color-mix(in srgb,var(--red) 16%,var(--bg-secondary))',
          border:'2.5px solid var(--red)',
          borderRadius:14,
          boxShadow:'4px 4px 0 var(--text-primary)',
          transform:'rotate(-2deg)',
        }}>
          <div style={{ fontSize:38, lineHeight:1 }}>🔥</div>
          <div style={{ fontFamily:HAND, fontSize:48, fontWeight:900, color:'var(--red)', lineHeight:1 }}>
            {racha}
          </div>
          <div style={{ fontFamily:HAND, fontSize:14, color:'var(--text-muted)', fontStyle:'italic' }}>
            días consecutivos
          </div>
        </div>

        <div style={{
          textAlign:'center', padding:'14px 22px',
          background:'color-mix(in srgb,var(--gold) 16%,var(--bg-secondary))',
          border:'2.5px solid var(--gold)',
          borderRadius:14,
          boxShadow:'4px 4px 0 var(--text-primary)',
          transform:'rotate(2deg)',
        }}>
          <div style={{ fontSize:38, lineHeight:1 }}>🏆</div>
          <div style={{ fontFamily:HAND, fontSize:48, fontWeight:900, color:'var(--gold)', lineHeight:1 }}>
            {mejorRacha}
          </div>
          <div style={{ fontFamily:HAND, fontSize:14, color:'var(--text-muted)', fontStyle:'italic' }}>
            tu récord
          </div>
        </div>
      </div>

      {/* Calendario últimos 35 días */}
      <div>
        <p style={{ fontFamily:HAND, fontSize:17, color:'var(--text-muted)', margin:'0 0 8px', fontStyle:'italic', textAlign:'center' }}>
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

      {/* Mensaje motivacional */}
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

/* ════════════ HOME ════════════ */
export default function Home() {
  const [materias, setMaterias]     = useState<Materia[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadLabel, setLoadLabel]   = useState('Cargando…');
  const [loadColor, setLoadColor]   = useState('#f5c842');
  const [loadEmoji, setLoadEmoji]   = useState('📚');
  const [navigating, setNavigating] = useState(false);
  const [navLabel, setNavLabel]     = useState('');
  const [navColor, setNavColor]     = useState('#f5c842');
  const [navEmoji, setNavEmoji]     = useState('📚');
  const [navHref, setNavHref]       = useState('/');
  const [showDailyReward, setShowDailyReward] = useState(false);
  const [playerStats, setPlayerStats] = useState<any>(null);
  const [myRank, setMyRank]         = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [buscadorOpen, setBuscadorOpen] = useState(false);
  const [userName, setUserName]     = useState('');

  const mob = useIsMobile();
  const { idioma } = useIdioma();
  const lang = idioma || 'es';
  const router = useRouter();

  const nav = (href: string, label: string, color: string, emoji: string) => {
    if (navigating) return;
    setNavLabel(label);
    setNavColor(color);
    setNavEmoji(emoji);
    setNavHref(href);
    setNavigating(true);

    setTimeout(() => {
      try { router.push(href); }
      catch { window.location.href = href; }
    }, 280);
  };

  const navMateria = (materiaId?: string) => {
    if (materiaId) {
      try { localStorage.setItem('josea_open_materia', materiaId); } catch {}
    }
    nav('/materias','Materias','#f5c842','📚');
  };

  useEffect(() => {
    const labels = [
      { label:'Cargando materias…',     color:'#f5c842', emoji:'📚' },
      { label:'Preparando tu espacio…', color:'#f472b6', emoji:'✨' },
      { label:'Casi listo…',            color:'#38bdf8', emoji:'🚀' },
    ];
    let i = 0;
    const iv = setInterval(() => { i=(i+1)%labels.length; setLoadLabel(labels[i].label); setLoadColor(labels[i].color); setLoadEmoji(labels[i].emoji); }, 900);

    (async () => {
      try {
        const { data:{ user } } = await supabase.auth.getUser();
        if (user) {
          const nombre = user.user_metadata?.nombre || user.email?.split('@')[0] || '';
          setUserName(nombre);

          // ── Cargar materias con userId correcto ──
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

            /* ✅ Stats vienen del leaderboard si user-profile falla */
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
              /* fallback solo con leaderboard */
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
      clearInterval(iv);
      setLoading(false);
    })();

    return () => clearInterval(iv);
  }, []);

  if (loading)    return <LoadScreen label={loadLabel} color={loadColor} emoji={loadEmoji} href='_loading'/>;
  if (navigating) return <LoadScreen label={navLabel}  color={navColor}  emoji={navEmoji}  href={navHref}/>;

  /* ═════════ MOBILE ═════════ */
  if (mob) return (
    <div style={{ minHeight:'100vh',paddingBottom:90,position:'relative' }}>
      <OnboardingCheck/>
      {showDailyReward && <DailyReward onClose={() => setShowDailyReward(false)} onClaim={async () => { await darXP(15,'daily_reward'); setShowDailyReward(false); }}/>}
      <BuscadorModal open={buscadorOpen} onClose={() => setBuscadorOpen(false)}/>
      <NavbarMobile/>

      {/* fondo cuaderno */}
      

      <div style={{ position:'relative',zIndex:1,padding:'14px 14px',display:'flex',flexDirection:'column',gap:18 }}>

        {/* HEADER mobile: día/welcome arriba, logo center */}
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8 }}>
          <DiaFecha lang={lang}/>
          <button onClick={() => setBuscadorOpen(true)} style={{ padding:'6px 12px',background:'var(--bg-card)',border:'2px solid var(--text-primary)',borderRadius:8,cursor:'pointer',fontFamily:HAND,fontSize:14,fontWeight:700,color:'var(--text-primary)' }}>🔍</button>
        </div>

        <WelcomeUser name={userName}/>

        <HorarioFlecha targetId="horario-section" mob={true}/>

        {/* StudyAL center + logo */}
        <div style={{ display:'flex',justifyContent:'center',padding:'10px 0' }}>
          <StudyALCenter mob={true}/>
        </div>

        {/* Top podio (debajo del logo en mobile) */}
        <div style={{ display:'flex',justifyContent:'center',marginTop:-6 }}>
          <TopPodio onClick={() => nav('/leaderboard','Leaderboard','#f5c842','🏆')} mob={true}/>
        </div>

        {/* Materias */}
        <div style={{ display:'flex',justifyContent:'center',marginTop:6 }}>
          <MateriasHoja materias={materias} onOpen={(id) => navMateria(id)} onCreate={() => navMateria()} mob={true} lang={lang}/>
        </div>

        {/* Cosas por hacer + Frase Chap lado a lado */}
        <div style={{ display:'flex',gap:14,alignItems:'flex-start',justifyContent:'space-between' }}>
          <div style={{ flex:1,minWidth:0 }}>
            <CosasPorHacer onClick={() => nav('/agenda','Agenda','#f472b6','📋')} mob={true}/>
          </div>
          <FraseChapBot onClick={() => nav('/chap','ChapBot','#f472b6','🤖')} mob={true} lang={lang}/>
        </div>

        {/* Timer separado */}
        <div style={{ display:'flex',justifyContent:'center' }}>
          <TimerButton onClick={() => nav('/pomodoro','Timer','#ef4444','⏱️')} mob={true}/>
        </div>

        {/* Racha */}
        <RachaWidget/>

        {/* Horario sección */}
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

        {/* Mi Progreso */}
        <div style={{ marginTop:20 }}>
          <MapaProgreso playerStats={playerStats} myRank={myRank} totalUsers={totalUsers} onLeaderboard={() => nav('/leaderboard','Leaderboard','#f5c842','🏆')} mob={true}/>
        </div>

        {/* Notas */}
        <NotasRapidas/>

        {/* Gráficas */}
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
      {showDailyReward && <DailyReward onClose={() => setShowDailyReward(false)} onClaim={async () => { await darXP(15,'daily_reward'); setShowDailyReward(false); }}/>}
      <BuscadorModal open={buscadorOpen} onClose={() => setBuscadorOpen(false)}/>

      {/* fondo cuaderno rayado azul */}
      

      {/* HEADER */}
      <header style={{
        position:'sticky',top:0,zIndex:100,
        background:'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
        backdropFilter:'blur(14px)',borderBottom:'2.5px solid var(--text-primary)',
        padding:'10px 36px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,
      }}>
        <div style={{ display:'flex',alignItems:'center',gap:10,cursor:'pointer' }} onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}>
          <img src="/logo.png" alt="StudyAL" style={{ width:36,height:36,objectFit:'contain',flexShrink:0 }}/>
          <span style={{ fontFamily:HAND,fontSize:26,fontWeight:900,color:'var(--text-primary)',lineHeight:1 }}>StudyAL</span>
          <BetaBadge/>
        </div>
        <button onClick={() => setBuscadorOpen(true)} style={{
          flex:1,maxWidth:440,padding:'9px 16px',background:'var(--bg-card)',
          border:'2px solid var(--text-primary)',borderRadius:10,cursor:'pointer',
          textAlign:'left',color:'var(--text-faint)',
          fontFamily:HAND,fontSize:17,display:'flex',alignItems:'center',gap:8,
          boxShadow:'2px 2px 0 var(--text-primary)',
        }}>
          <span>🔍</span><span>{lang==='en'?'Search anything…':'Buscar materias, apuntes…'}</span>
          <span style={{ marginLeft:'auto',fontSize:11,opacity:.6 }}>⌘K</span>
        </button>
        <UserMenu/>
      </header>

      <main style={{ position:'relative',zIndex:1,maxWidth:1240,margin:'0 auto',padding:'28px 40px 60px' }}>

        {/* ═══ ZONA 1: Hero — día/welcome | StudyAL+logo | top podio ═══ */}
        <div style={{ display:'grid',gridTemplateColumns:'1fr auto 1fr',gap:32,alignItems:'flex-start',marginBottom:32 }}>

          {/* IZQ */}
          <div style={{ display:'flex',flexDirection:'column',gap:18,alignItems:'flex-start' }}>
            <DiaFecha lang={lang}/>
            <WelcomeUser name={userName}/>
            <HorarioFlecha targetId="horario-section" mob={false}/>
          </div>

          {/* CENTRO */}
          <div style={{ display:'flex',justifyContent:'center' }}>
            <StudyALCenter mob={false}/>
          </div>

          {/* DER — Top podio */}
          <div style={{ display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8 }}>
            <span style={{ fontFamily:HAND,fontSize:18,color:'var(--text-muted)',fontStyle:'italic',transform:'rotate(-3deg)',display:'inline-block',marginRight:30 }}>→ improve</span>
            <TopPodio onClick={() => nav('/leaderboard','Leaderboard','#f5c842','🏆')} mob={false}/>
          </div>
        </div>

        {/* ═══ ZONA 2: Materias centrada ═══ */}
        <div style={{ display:'flex',justifyContent:'center',marginBottom:36 }}>
          <MateriasHoja materias={materias} onOpen={(id) => navMateria(id)} onCreate={() => navMateria()} mob={false} lang={lang}/>
        </div>

        {/* ═══ ZONA 3: Cosas por hacer (izq) | Racha (centro) | Frase+Chap+Timer (der) ═══ */}
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:32,alignItems:'flex-start',marginBottom:40 }}>
          {/* IZQ */}
          <div style={{ background:'var(--bg-card)',border:'2px dashed var(--border-color)',borderRadius:14,padding:'16px 20px' }}>
            <CosasPorHacer onClick={() => nav('/agenda','Agenda','#f472b6','📋')} mob={false}/>
          </div>

          {/* CENTRO */}
          <div style={{ display:'flex',justifyContent:'center' }}>
            <RachaWidget/>
          </div>

          {/* DER */}
          <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:18 }}>
            <FraseChapBot onClick={() => nav('/chap','ChapBot','#f472b6','🤖')} mob={false} lang={lang}/>
            <TimerButton onClick={() => nav('/pomodoro','Timer','#ef4444','⏱️')} mob={false}/>
          </div>
        </div>

        {/* ═══ ZONA 4: Horario tabla + Widget ═══ */}
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
            <div style={{ position:'relative',zIndex:1,filter:'drop-shadow(0 1px 0 rgba(0,0,0,.05))' }}>
              <HorarioWidget/>
            </div>
          </div>
        </div>

        {/* ═══ ZONA 5: Mapa Progreso ═══ */}
        <div style={{ marginBottom:40 }}>
          <MapaProgreso playerStats={playerStats} myRank={myRank} totalUsers={totalUsers} onLeaderboard={() => nav('/leaderboard','Leaderboard','#f5c842','🏆')} mob={false}/>
        </div>

        {/* ═══ ZONA 6: Notas + Gráficas ═══ */}
        <div style={{ display:'grid',gridTemplateColumns:'1fr 2fr',gap:28,alignItems:'flex-start',marginBottom:36 }}>
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
