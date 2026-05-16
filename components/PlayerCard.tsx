'use client';

import { useRef, useState } from 'react';
import { getRango, getProgresoRango } from '../lib/xpSystem';

const HAND = "'Caveat',cursive";

interface Stats {
  nombre: string; xpTotal: number; flashcards: number;
  precision: number; rachaActual: number; mejorRacha: number;
  rank: number; totalUsers: number; userId?: string;
  quizzes?: number; avatar?: string;
  universidad?: string; carrera?: string;
}

export default function PlayerCard({ stats }: { stats: Stats }) {
  const [flipped, setFlipped] = useState(false);
  const rango = getRango(stats.xpTotal);
  const inicial = (stats.nombre||'U')[0].toUpperCase();

  const bars = [
    { l:'🎴 Flash',  v:stats.flashcards,   max:1000, c:'#f5c842' },
    { l:'🎯 Prec.',  v:stats.precision,    max:100,  c:'#4ade80', s:'%' },
    { l:'⚡ XP',     v:stats.xpTotal,      max:75000,c:'#38bdf8' },
    { l:'🔥 Racha',  v:stats.rachaActual,  max:100,  c:'#f97316', s:'d' },
    { l:'🏆 Mejor',  v:stats.mejorRacha,   max:365,  c:'#a78bfa', s:'d' },
    { l:'🤓 Quiz',   v:stats.quizzes||0,   max:100,  c:'#f472b6' },
  ];

  const ovr = Math.min(99, Math.round(
    Math.min(stats.flashcards/1000,1)*25 +
    (stats.precision/100)*25 +
    Math.min(stats.xpTotal/75000,1)*25 +
    Math.min(stats.mejorRacha/100,1)*25
  ));
  const ovrC = ovr>=80?'#f5c842':ovr>=60?'#4ade80':ovr>=40?'#38bdf8':'#94a3b8';

  return (
    <div style={{perspective:1000,cursor:'pointer',width:'100%',maxWidth:260}}
      onClick={()=>setFlipped(!flipped)}>
      <div style={{
        position:'relative',width:'100%',paddingBottom:'148%',
        transformStyle:'preserve-3d',
        transition:'transform .7s cubic-bezier(.34,1.56,.64,1)',
        transform:flipped?'rotateY(180deg)':'rotateY(0)',
      }}>

        {/* ── FRENTE ── */}
        <div style={{
          position:'absolute',inset:0,
          backfaceVisibility:'hidden',
          borderRadius:14,
          background:'var(--bg-card)',
          border:'2.5px solid var(--text-primary)',
          overflow:'hidden',
          boxShadow:'5px 6px 0 var(--text-primary)',
          display:'flex',flexDirection:'column',
        }}>
          {/* Banda rango */}
          <div style={{
            padding:'5px 10px',
            background:rango.marcoGradient,
            borderBottom:'2px solid var(--text-primary)',
            display:'flex',justifyContent:'space-between',alignItems:'center',
            flexShrink:0,
          }}>
            <div style={{display:'flex',alignItems:'center',gap:5}}>
              <span style={{fontSize:16}}>{rango.emoji}</span>
              <span style={{fontFamily:HAND,fontSize:15,fontWeight:900,color:'#fff',textShadow:'0 1px 3px rgba(0,0,0,.5)',lineHeight:1,fontStyle:'italic'}}>
                {rango.nombre} {rango.id!=='himmy'?rango.division:''}
              </span>
            </div>
            <div style={{background:'rgba(0,0,0,.4)',border:'1.5px solid rgba(255,255,255,.4)',borderRadius:5,padding:'1px 7px',fontFamily:HAND,fontSize:14,fontWeight:900,color:'#fff',transform:'rotate(3deg)',boxShadow:'1px 1px 0 rgba(0,0,0,.3)'}}>
              #{stats.rank}
            </div>
          </div>

          {/* Avatar + OVR */}
          <div style={{padding:'8px 10px 4px',display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
            <div style={{
              width:52,height:52,borderRadius:9,
              overflow:'hidden',flexShrink:0,
              border:'2.5px solid var(--text-primary)',
              background:stats.avatar?'transparent':rango.marcoGradient,
              display:'flex',alignItems:'center',justifyContent:'center',
              fontFamily:HAND,fontSize:26,fontWeight:900,color:'#fff',
              boxShadow:`2px 3px 0 ${rango.color}`,
              transform:'rotate(-3deg)',
            }}>
              {stats.avatar
                ?<img src={stats.avatar} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                :inicial}
            </div>
            <div>
              <div style={{fontFamily:HAND,fontSize:46,fontWeight:900,color:ovrC,lineHeight:.85,textShadow:`0 0 10px ${ovrC}55`,transform:'rotate(-2deg)',display:'inline-block'}}>
                {ovr}
              </div>
              <div style={{fontFamily:HAND,fontSize:11,fontWeight:800,color:'var(--text-muted)',fontStyle:'italic',transform:'rotate(-2deg)',display:'inline-block',marginTop:-2,marginLeft:2}}>
                OVR
              </div>
            </div>
          </div>

          {/* Nombre */}
          <div style={{padding:'0 10px 3px',flexShrink:0}}>
            <div style={{fontFamily:HAND,fontSize:21,fontWeight:900,color:'var(--text-primary)',lineHeight:1,transform:'rotate(-1deg)',display:'inline-block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'100%'}}>
              {stats.nombre}
            </div>
            {(stats.universidad||stats.carrera)&&(
              <div style={{fontFamily:HAND,fontSize:11,fontStyle:'italic',color:'var(--text-faint)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {[stats.carrera,stats.universidad].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{margin:'3px 10px',borderTop:'1.5px dashed var(--border-color)',flexShrink:0}}/>

          {/* Bars */}
          <div style={{padding:'3px 10px 8px',flex:1,display:'flex',flexDirection:'column',gap:5,justifyContent:'center'}}>
            {bars.map((b,i)=>{
              const pct = Math.min(100,(b.v/b.max)*100);
              return (
                <div key={i} style={{display:'flex',alignItems:'center',gap:5}}>
                  <span style={{fontFamily:HAND,fontSize:11,fontWeight:700,color:'var(--text-muted)',width:64,flexShrink:0}}>{b.l}</span>
                  <div style={{flex:1,height:6,background:'var(--bg-secondary)',border:'1.5px solid var(--text-primary)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{width:`${pct}%`,height:'100%',background:b.c,borderRadius:2,transition:'width 1s',boxShadow:`inset 0 1px 0 rgba(255,255,255,.3)`}}/>
                  </div>
                  <span style={{fontFamily:HAND,fontSize:11,fontWeight:800,color:b.c,minWidth:36,textAlign:'right'}}>
                    {b.v.toLocaleString()}{b.s||''}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{padding:'3px 10px',background:'var(--bg-secondary)',borderTop:'1.5px dashed var(--border-color)',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
            <span style={{fontFamily:HAND,fontSize:10,fontWeight:700,color:'var(--text-faint)',fontStyle:'italic'}}>✦ STUDYAL CARD ✦</span>
            <span style={{fontFamily:HAND,fontSize:11,fontWeight:700,color:'var(--gold)',fontStyle:'italic'}}>voltear →</span>
          </div>
        </div>

        {/* ── REVERSO ── */}
        <div style={{
          position:'absolute',inset:0,
          backfaceVisibility:'hidden',
          transform:'rotateY(180deg)',
          borderRadius:14,
          background:'var(--bg-card)',
          border:'2.5px solid var(--text-primary)',
          overflow:'hidden',
          boxShadow:'5px 6px 0 var(--text-primary)',
          display:'flex',flexDirection:'column',
          alignItems:'center',
          padding:'0 14px 14px',
        }}>
          {/* Banda top */}
          <div style={{
            background:rango.marcoGradient,
            width:'calc(100% + 28px)',marginLeft:-14,
            padding:'6px',
            borderBottom:'2px solid var(--text-primary)',
            textAlign:'center',marginBottom:12,flexShrink:0,
          }}>
            <span style={{fontFamily:HAND,fontSize:14,fontWeight:800,color:'#fff',textShadow:'0 1px 3px rgba(0,0,0,.5)',fontStyle:'italic'}}>
              📲 escanea mi perfil
            </span>
          </div>

          {/* QR */}
          <div style={{
            background:'#fff',borderRadius:6,padding:7,
            border:'2.5px solid var(--text-primary)',
            boxShadow:`3px 3px 0 ${rango.color}`,
            transform:'rotate(-2deg)',marginBottom:10,flexShrink:0,
          }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(typeof window!=='undefined'?`${window.location.origin}/u/${stats.userId||stats.nombre}`:'')}&bgcolor=ffffff&color=000000&format=svg`}
              alt="QR" style={{width:120,height:120,display:'block'}}
            />
          </div>

          {/* Nombre + rango */}
          <div style={{textAlign:'center',marginBottom:10,flexShrink:0}}>
            <div style={{fontFamily:HAND,fontSize:19,fontWeight:900,color:'var(--text-primary)',transform:'rotate(-1deg)',display:'inline-block',marginBottom:4}}>
              {stats.nombre}
            </div>
            <div style={{display:'inline-flex',alignItems:'center',gap:5,background:rango.marcoGradient,border:'2px solid var(--text-primary)',boxShadow:'1px 2px 0 var(--text-primary)',borderRadius:7,padding:'2px 10px',transform:'rotate(2deg)'}}>
              <span style={{fontSize:13}}>{rango.emoji}</span>
              <span style={{fontFamily:HAND,fontSize:13,fontWeight:800,color:'#fff',textShadow:'0 1px 2px rgba(0,0,0,.4)',fontStyle:'italic'}}>
                {rango.nombre} {rango.id!=='himmy'?rango.division:''}
              </span>
            </div>
          </div>

          {/* Mini stats */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,width:'100%',flexShrink:0}}>
            {[
              {l:'OVR', v:ovr,                        c:ovrC,    r:-1.5},
              {l:'Rank',v:`#${stats.rank}`,            c:rango.color,r:1.5},
              {l:'XP',  v:stats.xpTotal.toLocaleString(),c:'#f5c842',r:-1},
              {l:'Prec',v:`${stats.precision}%`,       c:'#4ade80',r:1},
            ].map((s,i)=>(
              <div key={i} style={{background:'var(--bg-secondary)',border:`2px dashed ${s.c}`,borderRadius:8,padding:'4px',textAlign:'center',transform:`rotate(${s.r}deg)`}}>
                <div style={{fontFamily:HAND,fontSize:16,fontWeight:900,color:s.c,lineHeight:1}}>{s.v}</div>
                <div style={{fontFamily:HAND,fontSize:10,fontWeight:700,color:'var(--text-faint)',fontStyle:'italic',marginTop:1}}>{s.l}</div>
              </div>
            ))}
          </div>

          <p style={{fontFamily:HAND,fontSize:11,color:'var(--text-muted)',margin:'10px 0 0',fontStyle:'italic',textAlign:'center',flexShrink:0}}>
            ~ toca para voltear ~
          </p>
        </div>
      </div>
    </div>
  );
}