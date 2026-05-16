'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { syncLeaderboard } from '../lib/syncLeaderboard';

const HAND = "'Caveat',cursive";

interface LeaderEntry {
  user_id: string; nombre: string; xp_total: number;
  flashcards_estudiadas: number; racha_actual: number;
  mejor_racha: number; precision_global: number;
  updated_at: string; created_at?: string;
  avatar_url?: string; carrera?: string;
  universidad?: string; tipo_estudiante?: string;
  genero?: string;
}

// ── MODAL ──────────────────────────────────────────────────────────────────
function Modal({ entry, rank, onClose }: { entry: LeaderEntry; rank: number; onClose: () => void }) {
  const router = useRouter();
  const COLORS = ['','#f5c842','#cbd5e1','#cd7f32'];
  const color  = COLORS[rank] || '#64748b';
  const medal  = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':`#${rank}`;

  return (
    <div onClick={onClose} style={{
      position:'fixed',inset:0,zIndex:99999,
      background:'rgba(0,0,0,.88)',backdropFilter:'blur(10px)',
      display:'flex',alignItems:'center',justifyContent:'center',
      padding:20,animation:'mFade .25s ease',
    }}>
      <style>{`
        @keyframes mFade{from{opacity:0}to{opacity:1}}
        @keyframes mPop{0%{transform:rotate(0)scale(.8);opacity:0}60%{transform:rotate(-1deg)scale(1.03);opacity:1}100%{transform:rotate(-1deg)scale(1);opacity:1}}
        @keyframes mSway{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}
      `}</style>
      <div onClick={(e: any) =>e.stopPropagation()} style={{
        width:'100%',maxWidth:400,
        background:'#0f0f14',border:`2.5px solid ${color}`,
        borderRadius:18,overflow:'hidden',
        boxShadow:`5px 6px 0 ${color}, 0 20px 60px rgba(0,0,0,.6)`,
        transform:'rotate(-1deg)',
        animation:'mPop .4s cubic-bezier(.34,1.4,.64,1)',
        position:'relative',
      }}>
        {/* Scotch */}
        <div style={{position:'absolute',top:-11,left:'50%',transform:'translateX(-50%) rotate(-4deg)',width:90,height:20,background:`${color}99`,border:`1px solid ${color}55`,zIndex:5}}/>
        {/* Header grad */}
        <div style={{
          height:90,position:'relative',
          background:`linear-gradient(135deg,${color} 0%,color-mix(in srgb,${color} 35%,#0f0f14) 100%)`,
          borderBottom:`2px solid ${color}`,
          display:'flex',alignItems:'center',justifyContent:'center',
        }}>
          <span style={{
            position:'absolute',top:14,left:18,
            fontSize:rank<=3?42:0,
            fontFamily:HAND,fontWeight:900,color:'#fff',
            textShadow:'0 2px 6px rgba(0,0,0,.5)',
            transform:rank<=3?'rotate(-8deg)':'rotate(-4deg)',
            filter:rank<=3?`drop-shadow(0 4px 10px ${color}aa)`:'none',
            animation:rank<=3?'mSway 3s ease-in-out infinite':'none',
            display:'inline-block',zIndex:3,
          }}>{rank<=3 ? medal : `#${rank}`}</span>
          <button onClick={onClose} style={{position:'absolute',top:10,right:12,background:'rgba(0,0,0,.5)',border:'2px solid #fff',color:'#fff',width:30,height:30,borderRadius:7,cursor:'pointer',fontFamily:HAND,fontSize:16,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'2px 2px 0 rgba(0,0,0,.4)'}}>✕</button>
        </div>

        {/* Avatar */}
        <div style={{display:'flex',justifyContent:'center',marginTop:-38,marginBottom:10}}>
          <div style={{
            width:76,height:76,borderRadius:'50%',
            border:'3px solid #fff',background:'#1a1a1f',
            boxShadow:`3px 4px 0 ${color}`,
            overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',
            fontFamily:HAND,fontSize:34,fontWeight:900,color:'#fff',
            transform:'rotate(-4deg)',position:'relative',zIndex:2,
          }}>
            {entry.avatar_url
              ?<img src={entry.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
              :(entry.nombre||'?')[0].toUpperCase()}
          </div>
        </div>

        <div style={{padding:'0 20px 20px'}}>
          <h2 style={{fontFamily:HAND,fontSize:28,fontWeight:900,color:'#fff',margin:'0 0 12px',textAlign:'center',transform:'rotate(-1deg)'}}>
            {entry.nombre}
          </h2>

          {/* Info */}
          <div style={{background:'rgba(255,255,255,.04)',border:'2px dashed rgba(255,255,255,.12)',borderRadius:10,padding:'10px 12px',marginBottom:12,display:'flex',flexDirection:'column',gap:7,transform:'rotate(-.4deg)'}}>
            {entry.carrera && <Row emoji="📚" label="Carrera" val={entry.carrera} c={color}/>}
            {entry.universidad && <Row emoji="🏫" label="Universidad" val={entry.universidad} c="#fff"/>}
            {entry.tipo_estudiante && <Row emoji="🎓" label="Tipo" val={entry.tipo_estudiante==='universitario'?'Universitario':'Bachillerato'} c="#fff"/>}
            {entry.created_at && <Row emoji="📅" label="Registro" val={fmtFecha(entry.created_at)} c="#fff"/>}
          </div>

          {/* Stats */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:14}}>
            {[
              {l:'XP',       v:entry.xp_total,              e:'⚡',c:'#f5c842', r:-1.5},
              {l:'Cards',    v:entry.flashcards_estudiadas,  e:'🎴',c:'#f472b6', r:1.5},
              {l:'Racha',    v:entry.racha_actual,           e:'🔥',c:'#ef4444', r:-1},
              {l:'Mejor',    v:entry.mejor_racha,            e:'🏆',c:'#f5c842', r:1},
              {l:'Precisión',v:`${entry.precision_global}%`, e:'🎯',c:'#38bdf8', r:-1.5},
              {l:'Puesto',   v:medal,                        e:'',  c:color,      r:1.5},
            ].map((s,i)=>(
              <div key={i} style={{
                background:`color-mix(in srgb,${s.c} 14%,#1a1a1f)`,
                border:`2px dashed ${s.c}`,borderRadius:9,
                padding:'7px 4px',textAlign:'center',
                transform:`rotate(${s.r}deg)`,
                transition:'transform .2s',cursor:'default',
              }}
                onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0) scale(1.05)'}
                onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${s.r}deg)`}
              >
                {s.e&&<div style={{fontSize:13,marginBottom:1}}>{s.e}</div>}
                <div style={{fontFamily:HAND,fontSize:19,fontWeight:900,color:s.c,lineHeight:1}}>{s.v}</div>
                <div style={{fontFamily:HAND,fontSize:10,fontStyle:'italic',color:'rgba(255,255,255,.45)',marginTop:2}}>{s.l}</div>
              </div>
            ))}
          </div>

          <div style={{display:'flex',gap:8,paddingTop:10,borderTop:'1.5px dashed rgba(255,255,255,.12)'}}>
            <button onClick={()=>{ onClose(); if(typeof window!=='undefined'){ router.push(`/u/${entry.user_id}`); } }} style={{
              flex:1,padding:11,borderRadius:10,
              border:'2.5px solid #fff',background:color,color:'#000',
              fontFamily:HAND,fontSize:18,fontWeight:800,cursor:'pointer',
              boxShadow:'3px 4px 0 rgba(255,255,255,.2)',transform:'rotate(-1deg)',
            }}>🌐 Ver Perfil</button>
            <button onClick={onClose} style={{
              padding:'11px 16px',borderRadius:10,
              border:'2px dashed rgba(255,255,255,.25)',background:'transparent',
              color:'rgba(255,255,255,.5)',fontFamily:HAND,fontSize:17,fontWeight:800,
              cursor:'pointer',transform:'rotate(1deg)',
            }}>✕</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({emoji,label,val,c}:{emoji:string;label:string;val:string;c:string}){
  return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <span style={{fontSize:16}}>{emoji}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:HAND,fontSize:11,fontWeight:700,color:'rgba(255,255,255,.4)',textTransform:'uppercase',letterSpacing:.5}}>{label}</div>
        <div style={{fontFamily:HAND,fontSize:16,fontWeight:800,color:c,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{val}</div>
      </div>
    </div>
  );
}

function fmtFecha(f?:string){
  if(!f)return'';
  const d=new Date(f);
  return`${d.getDate()} ${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getMonth()]} ${d.getFullYear()}`;
}

// ── PODIO ──────────────────────────────────────────────────────────────────
function Podio({ top3, myName, onClick }: {
  top3: LeaderEntry[];
  myName: string;
  onClick: (e: LeaderEntry, r: number) => void;
}) {
  // Orden visual: 2° izq, 1° centro, 3° der
  const order = [1, 0, 2];
  const colors = ['#f5c842','#cbd5e1','#cd7f32'];
  const medals = ['🥇','🥈','🥉'];
  const heights = [130, 90, 70];   // pedestal heights: centro más alto
  const avatarSizes = [80, 64, 56];

  return (
    <div style={{padding:'32px 0 0',marginBottom:16,position:'relative'}}>
      {/* Título */}
      <div style={{textAlign:'center',marginBottom:20}}>
        <span style={{fontFamily:HAND,fontSize:13,fontWeight:800,color:'rgba(255,255,255,.4)',fontStyle:'italic',display:'block',transform:'rotate(-1deg)'}}>~ top 3 estudiantes ~</span>
      </div>

      {/* Podio */}
      <div style={{display:'flex',justifyContent:'center',alignItems:'flex-end',gap:8}}>
        {order.map(realIdx => {
          const entry = top3[realIdx];
          const visPos = realIdx === 0 ? 1 : realIdx === 1 ? 2 : 3; // posición real 1/2/3
          const color  = colors[realIdx];
          const medal  = medals[realIdx];
          const h      = heights[realIdx];
          const avSize = avatarSizes[realIdx];
          const isMe   = entry?.nombre?.toLowerCase() === myName.toLowerCase();
          const isCenter = realIdx === 0;
          const rot    = realIdx===1?-2:realIdx===2?2:0;

          if (!entry) return <div key={realIdx} style={{flex:1,maxWidth:130}}/>;

          return (
            <div key={realIdx}
              onClick={()=>onClick(entry, visPos)}
              style={{
                flex:1,maxWidth:isCenter?140:120,
                display:'flex',flexDirection:'column',alignItems:'center',
                cursor:'pointer',
                transform:`rotate(${rot}deg)`,
                transition:'transform .25s',
              }}
              onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0) translateY(-5px)'}
              onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${rot}deg)`}
            >
              {/* Medal flotante */}
              <div style={{
                fontSize:isCenter?48:38,marginBottom:6,
                filter:`drop-shadow(0 4px 10px ${color}88)`,
                animation:isCenter?'p1bounce 2s ease-in-out infinite':'none',
                display:'inline-block',
              }}>{medal}</div>

              {/* Avatar */}
              <div style={{
                width:avSize,height:avSize,borderRadius:'50%',
                background:`color-mix(in srgb,${color} 40%,#1a1a1f)`,
                border:'3px solid #fff',
                boxShadow:`3px 4px 0 #000, 0 0 18px ${color}66`,
                overflow:'hidden',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:HAND,fontSize:isCenter?30:24,fontWeight:900,color:'#fff',
                marginBottom:8,transform:'rotate(-3deg)',position:'relative',
              }}>
                {entry.avatar_url
                  ?<img src={entry.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                  :(entry.nombre||'?')[0].toUpperCase()}
                {isMe && (
                  <span style={{
                    position:'absolute',top:-7,right:-7,
                    background:'#f5c842',color:'#000',
                    border:'2px solid #000',borderRadius:5,
                    fontFamily:HAND,fontSize:10,fontWeight:900,
                    padding:'1px 5px',
                    boxShadow:'1px 1px 0 #000',
                    transform:'rotate(8deg)',
                  }}>TÚ</span>
                )}
              </div>

              {/* Nombre */}
              <p style={{
                fontFamily:HAND,fontSize:isCenter?17:15,fontWeight:900,
                color:'#fff',margin:'0 0 2px',lineHeight:1.05,
                textAlign:'center',maxWidth:'100%',
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                textShadow:`0 0 10px ${color}66`,
              }}>{entry.nombre}</p>

              {/* XP */}
              <p style={{
                fontFamily:HAND,fontSize:isCenter?15:13,fontWeight:800,
                color:color,fontStyle:'italic',margin:'0 0 10px',
                textShadow:`0 0 8px ${color}44`,
              }}>⚡ {entry.xp_total.toLocaleString()}</p>

              {/* Pedestal */}
              <div style={{
                width:'100%',height:h,
                background:`linear-gradient(180deg,${color} 0%,color-mix(in srgb,${color} 50%,#000) 100%)`,
                border:'2.5px solid #fff',borderBottom:'none',
                borderRadius:'10px 10px 0 0',
                boxShadow:`inset 0 2px 0 rgba(255,255,255,.35),3px 0 0 #000`,
                display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:HAND,fontSize:isCenter?56:44,fontWeight:900,
                color:'rgba(0,0,0,.35)',
                userSelect:'none',
              }}>
                {visPos}°
              </div>
            </div>
          );
        })}
      </div>

      {/* Base del podio */}
      <div style={{
        height:8,
        background:'linear-gradient(90deg,transparent 0%,rgba(255,255,255,.15) 50%,transparent 100%)',
        borderTop:'2.5px solid rgba(255,255,255,.2)',
        marginTop:0,
      }}/>

      <style>{`
        @keyframes p1bounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-8px) scale(1.06)}}
      `}</style>
    </div>
  );
}

// ── FILA RESTO ─────────────────────────────────────────────────────────────
function EntryRow({ entry, rank, isMe, onClick }: {
  entry: LeaderEntry; rank: number; isMe: boolean; onClick: () => void;
}) {
  const rot = isMe ? 0 : rank%2===0 ? -.3 : .3;
  return (
    <div onClick={onClick} style={{
      display:'flex',alignItems:'center',gap:10,
      padding:'9px 12px',borderRadius:11,
      background:isMe?'color-mix(in srgb,#f5c842 16%,#1a1a1f)':'rgba(255,255,255,.03)',
      border:isMe?'2.5px solid #f5c842':'1.5px dashed rgba(255,255,255,.1)',
      boxShadow:isMe?'3px 4px 0 #f5c842':'none',
      transform:`rotate(${rot}deg)`,
      cursor:'pointer',transition:'all .25s',
    }}
      onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0) translateX(3px)';if(!isMe)e.currentTarget.style.background='rgba(255,255,255,.06)';}}
      onMouseLeave={(e:any)=>{e.currentTarget.style.transform=`rotate(${rot}deg)`;if(!isMe)e.currentTarget.style.background='rgba(255,255,255,.03)';}}
    >
      {/* Rank badge */}
      <div style={{
        width:36,height:36,borderRadius:9,
        background:'#1a1a1f',border:'2px solid rgba(255,255,255,.2)',
        boxShadow:'2px 2px 0 rgba(255,255,255,.08)',
        display:'flex',alignItems:'center',justifyContent:'center',
        fontFamily:HAND,fontSize:15,fontWeight:900,color:'rgba(255,255,255,.45)',
        flexShrink:0,transform:'rotate(-3deg)',
      }}>#{rank}</div>

      {/* Avatar */}
      <div style={{
        width:40,height:40,borderRadius:'50%',
        background:'rgba(255,255,255,.08)',border:'2px solid rgba(255,255,255,.2)',
        overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',
        fontFamily:HAND,fontSize:16,fontWeight:900,color:'#fff',
        flexShrink:0,transform:'rotate(-4deg)',
      }}>
        {entry.avatar_url
          ?<img src={entry.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
          :(entry.nombre||'?')[0].toUpperCase()}
      </div>

      {/* Info */}
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
          <p style={{fontFamily:HAND,fontSize:17,fontWeight:900,color:'#fff',margin:0,lineHeight:1.05,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {entry.nombre}
          </p>
          {isMe && <span style={{fontFamily:HAND,fontSize:11,fontWeight:900,background:'#f5c842',color:'#000',border:'1.5px solid #000',borderRadius:4,padding:'1px 6px',transform:'rotate(-2deg)',flexShrink:0}}>TÚ</span>}
        </div>
        {entry.carrera && <p style={{fontFamily:HAND,fontSize:12,fontWeight:700,color:'rgba(255,255,255,.4)',fontStyle:'italic',margin:'1px 0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>📚 {entry.carrera}</p>}
        <div style={{display:'flex',gap:7,fontFamily:HAND,fontSize:11,fontWeight:700,color:'rgba(255,255,255,.35)'}}>
          <span>🎴 {entry.flashcards_estudiadas}</span>
          <span>🔥 {entry.racha_actual}</span>
          <span>🎯 {entry.precision_global}%</span>
        </div>
      </div>

      {/* XP */}
      <div style={{
        textAlign:'right',flexShrink:0,
        padding:'5px 10px',
        background:'rgba(245,200,66,.1)',
        border:'2px dashed #f5c842',borderRadius:8,
        transform:'rotate(-2deg)',
      }}>
        <p style={{fontFamily:HAND,fontSize:18,fontWeight:900,color:'#f5c842',margin:0,lineHeight:1}}>
          {entry.xp_total.toLocaleString()}
        </p>
        <p style={{fontFamily:HAND,fontSize:10,fontStyle:'italic',color:'rgba(245,200,66,.6)',margin:0}}>XP</p>
      </div>
    </div>
  );
}

// ── MAIN ───────────────────────────────────────────────────────────────────
export default function Leaderboard() {
  const [entries,  setEntries]  = useState<LeaderEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [myName,   setMyName]   = useState('');
  const [myRank,   setMyRank]   = useState<number|null>(null);
  const [syncing,  setSyncing]  = useState(false);
  const [selected, setSelected] = useState<{entry:LeaderEntry;rank:number}|null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      if (data.success) {
        setEntries(data.data||[]);
        const { data: sd } = await supabase.auth.getUser();
        if (sd.user) {
          const name = sd.user.user_metadata?.nombre || sd.user.email?.split('@')[0] || '';
          setMyName(name);
          const idx = (data.data||[]).findIndex((e:LeaderEntry)=>e.nombre.toLowerCase()===name.toLowerCase());
          if (idx>=0) setMyRank(idx+1);
        }
      }
    } catch(e){ console.error(e); }
    setLoading(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    try { await syncLeaderboard(); await load(); } catch(e){ console.error(e); }
    setSyncing(false);
  };

  useEffect(()=>{ syncLeaderboard().then(load); },[]);

  const top3 = entries.slice(0,3);
  const rest  = entries.slice(3);

  return (
    <>
      {selected && <Modal entry={selected.entry} rank={selected.rank} onClose={()=>setSelected(null)}/>}

      <div style={{
        background:'#0f0f14',
        border:'2.5px solid #f5c842',
        borderRadius:16,
        boxShadow:'5px 6px 0 #f5c842',
        transform:'rotate(-.3deg)',
        overflow:'hidden',position:'relative',
      }}>
        {/* Scotch */}
        <div style={{position:'absolute',top:-10,left:'50%',transform:'translateX(-50%) rotate(-3deg)',width:90,height:19,background:'rgba(245,200,66,.55)',border:'1px solid rgba(245,200,66,.3)',zIndex:10}}/>

        {/* Header */}
        <div style={{
          background:'linear-gradient(135deg,#f5c842 0%,#ff8c00 55%,#ef4444 100%)',
          padding:'14px 20px',
          borderBottom:'2.5px solid #fff',
          display:'flex',justifyContent:'space-between',alignItems:'center',
          gap:10,flexWrap:'wrap',
        }}>
          <div>
            <h3 style={{fontFamily:HAND,fontSize:30,fontWeight:900,color:'#fff',margin:0,lineHeight:1,textShadow:'0 2px 6px rgba(0,0,0,.35)',fontStyle:'italic',transform:'rotate(-1deg)',display:'inline-block'}}>
              🏆 Leaderboard
            </h3>
            <p style={{fontFamily:HAND,fontSize:14,fontStyle:'italic',color:'rgba(255,255,255,.85)',margin:'2px 0 0',textShadow:'0 1px 3px rgba(0,0,0,.3)'}}>
              ~ top estudiantes
              {myRank&&<strong> · #{myRank}</strong>} ~
            </p>
          </div>
          <button onClick={handleSync} disabled={syncing} style={{
            padding:'6px 14px',borderRadius:9,
            border:'2.5px solid #fff',background:'rgba(255,255,255,.95)',
            color:'#000',fontFamily:HAND,fontSize:16,fontWeight:800,
            cursor:syncing?'not-allowed':'pointer',
            boxShadow:'2px 3px 0 rgba(0,0,0,.2)',transform:'rotate(3deg)',
            transition:'all .25s',
          }}
            onMouseEnter={(e:any)=>{if(!syncing){e.currentTarget.style.transform='rotate(0) translateY(-2px)';}}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(3deg)';}}>
            {syncing?'⏳':'🔄 Sync'}
          </button>
        </div>

        <div style={{padding:'0 16px 20px',position:'relative',background:'#0f0f14'}}>
          {/* Margen rojo cuaderno */}
          <div style={{position:'absolute',top:0,bottom:0,left:38,width:1.5,background:'#ef4444',opacity:.15,pointerEvents:'none'}}/>

          {loading ? (
            <div style={{textAlign:'center',padding:'50px 0'}}>
              <div style={{fontSize:40,marginBottom:8,animation:'spin 1.2s linear infinite'}}>⏳</div>
              <p style={{fontFamily:HAND,fontSize:18,fontStyle:'italic',color:'rgba(255,255,255,.4)',margin:0}}>~ cargando ranking ~</p>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : entries.length===0 ? (
            <div style={{textAlign:'center',padding:'40px 20px'}}>
              <div style={{fontSize:56,marginBottom:8}}>🏆</div>
              <p style={{fontFamily:HAND,fontSize:22,fontStyle:'italic',color:'rgba(255,255,255,.35)',margin:0}}>~ ¡sé el primero! ~</p>
            </div>
          ) : (
            <>
              {/* PODIO */}
              {top3.length>0 && <Podio top3={top3} myName={myName} onClick={(e,r)=>setSelected({entry:e,rank:r})}/>}

              {/* Separador */}
              {rest.length>0 && (
                <div style={{display:'flex',alignItems:'center',gap:10,margin:'12px 0 14px'}}>
                  <div style={{flex:1,height:1.5,background:'repeating-linear-gradient(90deg,rgba(255,255,255,.2) 0,rgba(255,255,255,.2) 6px,transparent 6px,transparent 12px)'}}/>
                  <span style={{fontFamily:HAND,fontSize:14,fontWeight:800,color:'rgba(255,255,255,.3)',fontStyle:'italic',whiteSpace:'nowrap'}}>~ resto del ranking ~</span>
                  <div style={{flex:1,height:1.5,background:'repeating-linear-gradient(90deg,rgba(255,255,255,.2) 0,rgba(255,255,255,.2) 6px,transparent 6px,transparent 12px)'}}/>
                </div>
              )}

              {/* Lista */}
              <div style={{display:'flex',flexDirection:'column',gap:7}}>
                {rest.map((entry,i)=>{
                  const rank = i+4;
                  const isMe = entry.nombre.toLowerCase()===myName.toLowerCase();
                  return <EntryRow key={entry.user_id} entry={entry} rank={rank} isMe={isMe} onClick={()=>setSelected({entry,rank})}/>;
                })}
              </div>
            </>
          )}

          <p style={{fontFamily:HAND,fontSize:13,fontStyle:'italic',color:'rgba(255,255,255,.25)',margin:'18px 0 0',textAlign:'center'}}>
            ~ toca cualquier estudiante para ver más ~
          </p>
        </div>
      </div>
    </>
  );
}