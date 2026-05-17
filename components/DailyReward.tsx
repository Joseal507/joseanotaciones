'use client';

import { useEffect, useRef, useState } from 'react';
import { getRacha } from '../lib/racha';
import { dispararXPToast } from './XPToast';
import { darXP } from '../lib/xpClient';

const getCssVar = (name: string, fallback = '#d6b26f'): string => {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
};

const HAND = "'Caveat',cursive";
const DAILY_KEY = 'studyal_daily_reward_date';

export function shouldShowDailyReward(): boolean {
  if (typeof window === 'undefined') return false;
  const racha = getRacha();
  if (racha.rachaActual < 2) return false;
  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
  return localStorage.getItem(DAILY_KEY) !== hoyStr;
}

export function markDailyRewardShown(): void {
  if (typeof window === 'undefined') return;
  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
  localStorage.setItem(DAILY_KEY, hoyStr);
}

interface Prize { label: string; xp: number; lineColor: string; isNegative?: boolean; }

function getPrizesForRacha(r: number): Prize[] {
  if (r >= 30) return [
    { label: '+500 XP', xp: 500,  lineColor: getCssVar('--gold') },
    { label: '-100 XP', xp: -100, lineColor: '#ef4444', isNegative: true },
    { label: '+1000 XP',xp: 1000, lineColor: '#a855f7' },
    { label: '+250 XP', xp: 250,  lineColor: '#38bdf8' },
    { label: '+750 XP', xp: 750,  lineColor: '#22c55e' },
    { label: '-200 XP', xp: -200, lineColor: '#dc2626', isNegative: true },
    { label: '+400 XP', xp: 400,  lineColor: '#f97316' },
    { label: '+300 XP', xp: 300,  lineColor: '#06b6d4' },
  ];
  if (r >= 14) return [
    { label: '+150 XP', xp: 150,  lineColor: getCssVar('--gold') },
    { label: '-50 XP',  xp: -50,  lineColor: '#ef4444', isNegative: true },
    { label: '+300 XP', xp: 300,  lineColor: '#a855f7' },
    { label: '+100 XP', xp: 100,  lineColor: '#38bdf8' },
    { label: '+500 XP', xp: 500,  lineColor: '#22c55e' },
    { label: '-75 XP',  xp: -75,  lineColor: '#dc2626', isNegative: true },
    { label: '+200 XP', xp: 200,  lineColor: '#f97316' },
    { label: '+125 XP', xp: 125,  lineColor: '#06b6d4' },
  ];
  if (r >= 5) return [
    { label: '+50 XP',  xp: 50,   lineColor: getCssVar('--gold') },
    { label: '-20 XP',  xp: -20,  lineColor: '#ef4444', isNegative: true },
    { label: '+100 XP', xp: 100,  lineColor: '#a855f7' },
    { label: '+40 XP',  xp: 40,   lineColor: '#38bdf8' },
    { label: '+200 XP', xp: 200,  lineColor: '#22c55e' },
    { label: '-30 XP',  xp: -30,  lineColor: '#dc2626', isNegative: true },
    { label: '+75 XP',  xp: 75,   lineColor: '#f97316' },
    { label: '+60 XP',  xp: 60,   lineColor: '#06b6d4' },
  ];
  return [
    { label: '+15 XP',  xp: 15,   lineColor: getCssVar('--gold') },
    { label: '-10 XP',  xp: -10,  lineColor: '#ef4444', isNegative: true },
    { label: '+30 XP',  xp: 30,   lineColor: '#a855f7' },
    { label: '+20 XP',  xp: 20,   lineColor: '#38bdf8' },
    { label: '+50 XP',  xp: 50,   lineColor: '#22c55e' },
    { label: '-15 XP',  xp: -15,  lineColor: '#dc2626', isNegative: true },
    { label: '+25 XP',  xp: 25,   lineColor: '#f97316' },
    { label: '+10 XP',  xp: 10,   lineColor: '#06b6d4' },
  ];
}

function getTier(r: number) {
  if (r >= 30) return { label: 'HIMMY ☘', color: getCssVar('--gold') };
  if (r >= 14) return { label: 'PRIME ☘', color: '#a855f7' };
  if (r >= 5)  return { label: 'MID ☘',   color: '#38bdf8' };
  return              { label: 'ROOKIE',  color: '#6b7280' };
}

interface Props { onClose: () => void; onXPGained?: (xp: number) => void; onClaim?: (xp: number) => void; }

export default function DailyReward({ onClose, onXPGained, onClaim }: Props) {
  const [spinning,  setSpinning]  = useState(false);
  const [rotation,  setRotation]  = useState(0);
  const [result,    setResult]    = useState<Prize | null>(null);
  const [phase,     setPhase]     = useState<'idle'|'spinning'|'result'>('idle');
  const [claiming,  setClaiming]  = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const racha  = getRacha();
  const prizes = getPrizesForRacha(racha.rachaActual);
  const tier   = getTier(racha.rachaActual);

  const drawWheel = (rotDeg: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 280;
    canvas.width = size * dpr; canvas.height = size * dpr;
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);
    const cx = size/2, cy = size/2, R = size/2 - 8;
    const n = prizes.length, slice = (Math.PI*2)/n;
    const rot = (rotDeg * Math.PI) / 180;
    ctx.clearRect(0, 0, size, size);

    for (let i = 0; i < n; i++) {
      const start = rot + i*slice, end = start + slice, mid = start + slice/2;
      const p = prizes[i];

      // Segmento oscuro
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R,start,end); ctx.closePath();
      ctx.fillStyle = i%2===0 ? '#1a1a1f' : '#141418';
      ctx.fill();

      // Divisor dashed
      ctx.save();
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(start)*R, cy+Math.sin(start)*R);
      ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1; ctx.setLineDash([3,4]); ctx.stroke();
      ctx.restore();

      // Arco glow
      ctx.save();
      ctx.beginPath(); ctx.arc(cx,cy,R-5,start+0.03,end-0.03);
      ctx.strokeStyle=p.lineColor; ctx.lineWidth=5;
      ctx.shadowColor=p.lineColor; ctx.shadowBlur=12; ctx.stroke();
      ctx.restore();

      // Trebol borde
      ctx.save();
      ctx.translate(cx,cy); ctx.rotate(mid); ctx.translate(R*0.82,0);
      ctx.font='13px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle=p.lineColor; ctx.shadowColor=p.lineColor; ctx.shadowBlur=6;
      ctx.fillText('☘',0,0);
      ctx.restore();

      // Texto
      ctx.save();
      ctx.translate(cx,cy); ctx.rotate(mid); ctx.translate(R*0.54,0); ctx.rotate(Math.PI/2);
      ctx.font='900 17px Caveat, cursive';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle = p.isNegative ? '#fca5a5' : '#fff';
      ctx.shadowColor = p.isNegative ? 'rgba(239,68,68,0.6)' : `${p.lineColor}88`;
      ctx.shadowBlur = 6;
      ctx.fillText(p.label, 0, 0);
      ctx.restore();
    }

    // Borde dorado
    ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2);
    ctx.strokeStyle=getCssVar('--gold'); ctx.lineWidth=3;
    ctx.shadowColor=getCssVar('--gold'); ctx.shadowBlur=10; ctx.stroke(); ctx.shadowBlur=0;

    // Centro
    ctx.beginPath(); ctx.arc(cx,cy,28,0,Math.PI*2);
    const g = ctx.createRadialGradient(cx,cy,0,cx,cy,28);
    g.addColorStop(0,'#fde68a'); g.addColorStop(1,getCssVar('--gold'));
    ctx.fillStyle=g; ctx.fill();
    ctx.strokeStyle='#000'; ctx.lineWidth=2.5; ctx.stroke();
    ctx.font='18px serif'; ctx.fillStyle='#000';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('☘',cx,cy+1);
  };

  useEffect(()=>{ drawWheel(rotation); },[rotation, prizes]);

  useEffect(()=>{
    if (!spinning) return;
    let cur = rotation, vel = 26 + Math.random()*10, raf = 0;
    const animate = () => {
      vel *= 0.984; cur += vel; setRotation(cur);
      if (vel > 0.08) { raf = requestAnimationFrame(animate); return; }
      const finalRad = ((cur%360)*Math.PI)/180;
      const n = prizes.length, sliceA = (Math.PI*2)/n;
      const pointer = (Math.PI*3)/2;
      const norm = ((pointer - finalRad) % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
      const idx = Math.floor(norm/sliceA) % n;
      const prize = prizes[idx];
      setResult(prize); setSpinning(false); setPhase('result');
      markDailyRewardShown();
      // ✅ Seguro — solo llama si es función
      if (typeof onXPGained === 'function') onXPGained(prize.xp);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [spinning]);

  const handleClaim = async () => {
    if (!result || claiming) return;
    setClaiming(true);
    try {
      await darXP('racha', Math.abs(result.xp), {
        source: 'daily_reward',
        type: result.isNegative ? 'spin_loss' : 'spin_win',
        xp_real: result.xp,
      });
    } catch(e){ console.error(e); }
    if (result.isNegative) {
      dispararXPToast({ xp: Math.abs(result.xp), fuente: '💀 Penalización', emoji: '☠️',
        color: '#ef4444', descripcion: `Perdiste ${Math.abs(result.xp)} XP` });
    } else {
      dispararXPToast({ xp: result.xp, fuente: '☘ Daily Reward', emoji: '🏆',
        color: result.lineColor, descripcion: `¡Ganaste ${result.xp} XP!` });
    }
    if (typeof onClaim === 'function') onClaim(result.xp);
    onClose();
  };

  return (
    <div style={{
      position:'fixed',inset:0,zIndex:9999,
      background:'rgba(0,0,0,0.88)',
      backdropFilter:'blur(10px)',
      display:'flex',alignItems:'center',justifyContent:'center',
      padding:20,
      animation:'drFade .3s ease',
    }}>
      <style>{`
        @keyframes drFade{from{opacity:0}to{opacity:1}}
        @keyframes drPop{
          0%{transform:rotate(0)scale(.85);opacity:0}
          60%{transform:rotate(-1deg)scale(1.02);opacity:1}
          100%{transform:rotate(-1deg)scale(1);opacity:1}
        }
        @keyframes resPop{
          0%{transform:scale(.5)rotate(-3deg);opacity:0}
          60%{transform:scale(1.08)rotate(0);opacity:1}
          100%{transform:scale(1)rotate(-.5deg);opacity:1}
        }
        @keyframes clvFloat{
          0%,100%{transform:rotate(-10deg)translateY(0)}
          50%{transform:rotate(10deg)translateY(-5px)}
        }
      `}</style>

      <div style={{
        width:'100%',maxWidth:400,
        background:'#0f0f14',
        border:'2.5px solid var(--gold)',
        borderRadius:18,
        boxShadow:'6px 7px 0 var(--gold), 0 24px 60px rgba(0,0,0,.75)',
        padding:'24px 22px 20px',
        transform:'rotate(-1deg)',
        position:'relative',
        animation:'drPop .4s cubic-bezier(.34,1.4,.64,1)',
      }}>
        {/* Scotch */}
        <div style={{
          position:'absolute',top:-12,left:'50%',
          transform:'translateX(-50%) rotate(-4deg)',
          width:100,height:22,
          background:'color-mix(in srgb, var(--gold) 55%, transparent)',
          border:'1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
          boxShadow:'0 2px 5px rgba(0,0,0,.2)',zIndex:5,
        }}/>

        {/* Titulo */}
        <div style={{textAlign:'center',marginBottom:18,marginTop:4}}>
          <div style={{fontFamily:HAND,fontSize:13,fontWeight:800,color:'rgba(255,255,255,.45)',fontStyle:'italic',marginBottom:4,transform:'rotate(-1deg)',display:'inline-block'}}>
            ~ daily reward ~
          </div>
          <h2 style={{margin:0,fontFamily:HAND,fontSize:34,fontWeight:900,color:'#fff',lineHeight:1,transform:'rotate(-1.5deg)',display:'inline-block'}}>
            <span style={{display:'inline-block',animation:'clvFloat 2.5s ease-in-out infinite',marginRight:6}}>☘</span>
            Ruleta del día
          </h2>
          <svg width="180" height="6" style={{display:'block',margin:'4px auto 0'}}>
            <path d="M2 3 Q 90 0 178 4" stroke={getCssVar('--gold')} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
          </svg>
          <div style={{marginTop:12,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
            <div style={{
              padding:'5px 12px',borderRadius:8,
              background:`color-mix(in srgb,${tier.color} 20%,transparent)`,
              border:`2px dashed ${tier.color}`,
              fontFamily:HAND,fontSize:14,fontWeight:900,color:tier.color,fontStyle:'italic',
              transform:'rotate(-3deg)',
            }}>{tier.label}</div>
            <div style={{
              padding:'5px 14px',borderRadius:8,
              background:'rgba(255,255,255,.05)',border:'2px solid rgba(255,255,255,.2)',
              display:'flex',alignItems:'center',gap:6,
              transform:'rotate(2deg)',boxShadow:'2px 2px 0 rgba(255,255,255,.1)',
            }}>
              <span style={{fontSize:16}}>🔥</span>
              <span style={{fontFamily:HAND,fontSize:16,fontWeight:800,color:'#fff'}}>{racha.rachaActual} días</span>
            </div>
          </div>
        </div>

        {/* Ruleta */}
        <div style={{position:'relative',display:'flex',justifyContent:'center',marginBottom:18}}>
          <div style={{position:'absolute',top:-10,left:'50%',transform:'translateX(-50%)',zIndex:3}}>
            <div style={{
              width:0,height:0,
              borderLeft:'14px solid transparent',borderRight:'14px solid transparent',
              borderTop:'26px solid var(--gold)',
              filter:'drop-shadow(0 3px 6px color-mix(in srgb, var(--gold) 60%, transparent))',
            }}/>
          </div>
          <div style={{
            borderRadius:'50%',padding:8,
            background:'#0a0a0e',
            border:'3px solid var(--gold)',
            boxShadow:spinning
              ?'0 0 50px color-mix(in srgb, var(--gold) 70%, transparent),inset 0 0 30px rgba(0,0,0,.5)'
              :'0 0 20px color-mix(in srgb, var(--gold) 30%, transparent),inset 0 0 30px rgba(0,0,0,.5)',
            transition:'box-shadow .3s',
          }}>
            <canvas ref={canvasRef} style={{display:'block',borderRadius:'50%'}}/>
          </div>
        </div>

        {/* Resultado */}
        {phase==='result' && result && (
          <div style={{
            marginBottom:14,padding:'12px 16px',borderRadius:12,
            background:result.isNegative?'rgba(239,68,68,.15)':`color-mix(in srgb,${result.lineColor} 18%,transparent)`,
            border:`2.5px ${result.isNegative?'solid':'dashed'} ${result.isNegative?'#ef4444':result.lineColor}`,
            textAlign:'center',
            boxShadow:`3px 4px 0 ${result.isNegative?'#ef4444':result.lineColor}`,
            transform:'rotate(-.5deg)',
            animation:'resPop .5s cubic-bezier(.34,1.4,.64,1)',
          }}>
            <div style={{fontFamily:HAND,fontSize:14,fontWeight:800,color:'rgba(255,255,255,.45)',fontStyle:'italic',marginBottom:4}}>~ resultado ~</div>
            <div style={{
              fontFamily:HAND,fontSize:42,fontWeight:900,
              color:result.isNegative?'#fca5a5':'#fff',lineHeight:1,
              textShadow:`0 0 14px ${result.isNegative?'rgba(239,68,68,.5)':result.lineColor+'66'}`,
            }}>{result.label}</div>
            <div style={{marginTop:6,fontFamily:HAND,fontSize:15,fontWeight:700,fontStyle:'italic',color:result.isNegative?'#fca5a5':'rgba(255,255,255,.6)'}}>
              {result.isNegative?'~ ¡estudia más! 💪 ~':'~ ¡reclama tu XP! ☘ ~'}
            </div>
          </div>
        )}

        {/* Botones */}
        <div style={{display:'flex',gap:10,paddingTop:phase==='idle'?0:10,borderTop:phase==='idle'?'none':'1.5px dashed rgba(255,255,255,.12)'}}>
          {phase==='idle' && (<>
            <button onClick={()=>{setResult(null);setPhase('spinning');setSpinning(true);}} style={{
              flex:1,padding:14,borderRadius:12,
              border:'2.5px solid var(--gold)',background:getCssVar('--gold'),color:'#000',
              fontFamily:HAND,fontSize:22,fontWeight:800,cursor:'pointer',
              boxShadow:'3px 4px 0 color-mix(in srgb, var(--gold) 40%, transparent)',transform:'rotate(-1deg)',
              transition:'all .25s',
            }}
              onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0)translateY(-2px)';e.currentTarget.style.boxShadow='4px 6px 0 color-mix(in srgb, var(--gold) 50%, transparent)';}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';e.currentTarget.style.boxShadow='3px 4px 0 color-mix(in srgb, var(--gold) 40%, transparent)';}}>
              ☘ Girar
            </button>
            <button onClick={onClose} style={{
              padding:'14px 20px',borderRadius:12,
              border:'2px dashed rgba(255,255,255,.25)',background:'transparent',
              color:'rgba(255,255,255,.5)',fontFamily:HAND,fontSize:18,fontWeight:800,
              cursor:'pointer',transform:'rotate(1deg)',
            }}>✕</button>
          </>)}
          {phase==='spinning' && (
            <div style={{
              flex:1,padding:14,borderRadius:12,
              border:'2px dashed var(--gold)',background:'color-mix(in srgb, var(--gold) 10%, transparent)',
              color:getCssVar('--gold'),fontFamily:HAND,fontSize:20,fontWeight:800,
              textAlign:'center',fontStyle:'italic',transform:'rotate(-.5deg)',
            }}>⏳ ~ girando... ~</div>
          )}
          {phase==='result' && (
            <button onClick={handleClaim} disabled={claiming} style={{
              flex:1,padding:14,borderRadius:12,
              border:'2.5px solid #fff',
              background:result?.isNegative?'#ef4444':getCssVar('--gold'),
              color:result?.isNegative?'#fff':'#000',
              fontFamily:HAND,fontSize:20,fontWeight:800,
              cursor:claiming?'not-allowed':'pointer',
              opacity:claiming?.6:1,
              boxShadow:'3px 4px 0 rgba(255,255,255,.2)',
              transform:'rotate(-1deg)',transition:'all .25s',
            }}
              onMouseEnter={(e:any)=>{if(!claiming){e.currentTarget.style.transform='rotate(0)translateY(-2px)';e.currentTarget.style.boxShadow='4px 6px 0 rgba(255,255,255,.3)';}}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';e.currentTarget.style.boxShadow='3px 4px 0 rgba(255,255,255,.2)';}}>
              {claiming?'⏳ ...':result?.isNegative?'☠️ Aceptar':'☘ Reclamar XP'}
            </button>
          )}
        </div>

        <p style={{textAlign:'center',margin:'14px 0 0',fontFamily:HAND,fontSize:13,fontStyle:'italic',color:'rgba(255,255,255,.35)'}}>
          ~ vuelve mañana por otra recompensa ☘ ~
        </p>
      </div>
    </div>
  );
}