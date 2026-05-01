'use client';

import { useEffect, useRef, useState } from 'react';
import { getRacha } from '../lib/racha';
import { dispararXPToast } from './XPToast';
import { darXP } from '../lib/xpClient';

const DAILY_KEY = 'studyal_daily_reward_date';

export function shouldShowDailyReward(): boolean {
  if (typeof window === 'undefined') return false;
  const racha = getRacha();
  if (racha.rachaActual < 2) return false;
  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  return localStorage.getItem(DAILY_KEY) !== hoyStr;
}

export function markDailyRewardShown(): void {
  if (typeof window === 'undefined') return;
  const hoy = new Date();
  const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  localStorage.setItem(DAILY_KEY, hoyStr);
}

interface Prize {
  label: string;
  xp: number;
  lineColor: string;
  isNegative?: boolean;
}

function getPrizesForRacha(rachaActual: number): Prize[] {
  if (rachaActual >= 30) {
    return [
      { label: '+100 XP', xp: 100,  lineColor: '#f5c842' },
      { label: '-50 XP',  xp: -50,  lineColor: '#dc2626', isNegative: true },
      { label: '+200 XP', xp: 200,  lineColor: '#3b82f6' },
      { label: '+150 XP', xp: 150,  lineColor: '#a855f7' },
      { label: '+500 XP', xp: 500,  lineColor: '#22c55e' },
      { label: '-25 XP',  xp: -25,  lineColor: '#ef4444', isNegative: true },
      { label: '+300 XP', xp: 300,  lineColor: '#f97316' },
      { label: '+100 XP', xp: 100,  lineColor: '#06b6d4' },
    ];
  }
  if (rachaActual >= 14) {
    return [
      { label: '+50 XP',  xp: 50,   lineColor: '#f5c842' },
      { label: '-25 XP',  xp: -25,  lineColor: '#dc2626', isNegative: true },
      { label: '+100 XP', xp: 100,  lineColor: '#3b82f6' },
      { label: '+75 XP',  xp: 75,   lineColor: '#a855f7' },
      { label: '+200 XP', xp: 200,  lineColor: '#22c55e' },
      { label: '-10 XP',  xp: -10,  lineColor: '#ef4444', isNegative: true },
      { label: '+150 XP', xp: 150,  lineColor: '#f97316' },
      { label: '+75 XP',  xp: 75,   lineColor: '#06b6d4' },
    ];
  }
  if (rachaActual >= 5) {
    return [
      { label: '+25 XP',  xp: 25,   lineColor: '#f5c842' },
      { label: '-10 XP',  xp: -10,  lineColor: '#ef4444', isNegative: true },
      { label: '+50 XP',  xp: 50,   lineColor: '#3b82f6' },
      { label: '+75 XP',  xp: 75,   lineColor: '#a855f7' },
      { label: '+100 XP', xp: 100,  lineColor: '#22c55e' },
      { label: '-25 XP',  xp: -25,  lineColor: '#dc2626', isNegative: true },
      { label: '+50 XP',  xp: 50,   lineColor: '#f97316' },
      { label: '+25 XP',  xp: 25,   lineColor: '#06b6d4' },
    ];
  }
  // 2-4 días
  return [
    { label: '+10 XP',  xp: 10,   lineColor: '#f5c842' },
    { label: '-10 XP',  xp: -10,  lineColor: '#ef4444', isNegative: true },
    { label: '+25 XP',  xp: 25,   lineColor: '#3b82f6' },
    { label: '+10 XP',  xp: 10,   lineColor: '#a855f7' },
    { label: '+50 XP',  xp: 50,   lineColor: '#22c55e' },
    { label: '-10 XP',  xp: -10,  lineColor: '#dc2626', isNegative: true },
    { label: '+25 XP',  xp: 25,   lineColor: '#f97316' },
    { label: '+10 XP',  xp: 10,   lineColor: '#06b6d4' },
  ];
}

function getTierLabel(rachaActual: number): { label: string; color: string } {
  if (rachaActual >= 30) return { label: 'HIM', color: '#f5c842' };
  if (rachaActual >= 14) return { label: 'PRIME',      color: '#a855f7' };
  if (rachaActual >= 5)  return { label: 'MID',        color: '#3b82f6' };
  return                        { label: 'ROOKIE',     color: '#6b7280' };
}

interface Props {
  onClose: () => void;
  onXPGained: (xp: number) => void;
}

export default function DailyReward({ onClose, onXPGained }: Props) {
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult]     = useState<Prize | null>(null);
  const [phase, setPhase]       = useState<'idle' | 'spinning' | 'result'>('idle');
  const [claiming, setClaiming] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const racha  = getRacha();
  const prizes = getPrizesForRacha(racha.rachaActual);
  const tier   = getTierLabel(racha.rachaActual);

  const drawWheel = (rotDeg: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr  = window.devicePixelRatio || 1;
    const size = 280;
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width  = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx    = size / 2;
    const cy    = size / 2;
    const R     = size / 2 - 8;
    const n     = prizes.length;
    const slice = (Math.PI * 2) / n;
    const rot   = (rotDeg * Math.PI) / 180;

    ctx.clearRect(0, 0, size, size);

    for (let i = 0; i < n; i++) {
      const start = rot + i * slice;
      const end   = start + slice;
      const mid   = start + slice / 2;
      const p     = prizes[i];

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, start, end);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? '#151517' : '#111113';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, start, end);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(start) * R, cy + Math.sin(start) * R);
      ctx.strokeStyle = p.lineColor;
      ctx.lineWidth   = 2;
      ctx.shadowColor = p.lineColor;
      ctx.shadowBlur  = 12;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R - 2, start + 0.04, end - 0.04);
      ctx.strokeStyle = p.lineColor;
      ctx.lineWidth   = 3;
      ctx.globalAlpha = 0.55;
      ctx.shadowColor = p.lineColor;
      ctx.shadowBlur  = 8;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);
      ctx.translate(R * 0.6, 0);
      ctx.rotate(Math.PI / 2);
      ctx.font         = '800 13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      if (p.isNegative) {
        ctx.fillStyle   = '#ef4444';
        ctx.shadowColor = 'rgba(239,68,68,0.6)';
        ctx.shadowBlur  = 10;
      } else {
        ctx.fillStyle   = '#ffffff';
        ctx.shadowColor = 'rgba(255,255,255,0.1)';
        ctx.shadowBlur  = 4;
      }
      ctx.fillText(p.label, 0, 0);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    const hub = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
    hub.addColorStop(0, '#222225');
    hub.addColorStop(1, '#0e0e10');
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle   = hub;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    ctx.font         = '800 10px -apple-system, sans-serif';
    ctx.fillStyle    = 'rgba(255,255,255,0.7)';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPIN', cx, cy + 1);
  };

  useEffect(() => { drawWheel(rotation); }, [rotation]);

  useEffect(() => {
    if (!spinning) return;
    let current  = rotation;
    let velocity = 26 + Math.random() * 10;
    let raf      = 0;

    const animate = () => {
      velocity *= 0.984;
      current  += velocity;
      setRotation(current);
      if (velocity > 0.08) { raf = requestAnimationFrame(animate); return; }

      const finalRad = ((current % 360) * Math.PI) / 180;
      const n        = prizes.length;
      const slice    = (Math.PI * 2) / n;
      const pointer  = (Math.PI * 3) / 2;
      const norm     = ((pointer - finalRad) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const idx      = Math.floor(norm / slice) % n;
      const prize    = prizes[idx];

      setResult(prize);
      setSpinning(false);
      setPhase('result');
      markDailyRewardShown();
      onXPGained(prize.xp);
    };

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [spinning]);

  const handleClaim = async () => {
    if (!result || claiming) return;
    setClaiming(true);

    try {
      await darXP('racha', result.xp, {
        source: 'daily_reward',
        type: result.isNegative ? 'spin_loss' : 'spin_win',
      });
    } catch {}

    if (result.isNegative) {
      dispararXPToast({
        xp:          Math.abs(result.xp),
        fuente:      '💀 Penalización',
        emoji:       '☠️',
        color:       '#ef4444',
        descripcion: `Perdiste ${Math.abs(result.xp)} XP — ¡estudia más!`,
      });
    } else {
      dispararXPToast({
        xp:          result.xp,
        fuente:      '🎰 Daily Reward',
        emoji:       '🏆',
        color:       result.lineColor,
        descripcion: `¡Ganaste ${result.xp} XP en la ruleta!`,
      });
    }

    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px', fontFamily: '-apple-system, sans-serif',
    }}>
      <style>{`
        @keyframes drIn  { from { opacity:0; transform:translateY(24px) scale(0.96) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes drPop { 0% { transform:scale(0.5) } 60% { transform:scale(1.05) } 100% { transform:scale(1) } }
      `}</style>

      <div style={{
        width: '100%', maxWidth: '380px', borderRadius: '24px',
        background: 'linear-gradient(180deg, #141416 0%, #0c0c0e 100%)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 40px 100px rgba(0,0,0,0.7)',
        padding: '28px 24px 22px',
        animation: 'drIn 0.32s cubic-bezier(0.34,1.56,0.64,1)',
      }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{
            fontSize: '10px', fontWeight: 800, letterSpacing: '3px',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: '8px',
          }}>
            Daily Reward
          </div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>
            Ruleta del día
          </h2>

          {/* Tier + racha */}
          <div style={{
            marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          }}>
            <div style={{
              padding: '4px 10px', borderRadius: '6px',
              background: `${tier.color}18`, border: `1px solid ${tier.color}40`,
              fontSize: '10px', fontWeight: 900, letterSpacing: '1.5px',
              color: tier.color, textTransform: 'uppercase',
            }}>
              {tier.label}
            </div>
            <div style={{
              padding: '5px 14px', borderRadius: '999px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <span>🔥</span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>
                {racha.rachaActual} días
              </span>
            </div>
          </div>
        </div>

        {/* Wheel */}
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{ position: 'absolute', top: '2px', left: '50%', transform: 'translateX(-50%)', zIndex: 3 }}>
            <div style={{
              width: 0, height: 0,
              borderLeft: '9px solid transparent', borderRight: '9px solid transparent',
              borderTop: '18px solid #fff',
              filter: 'drop-shadow(0 2px 8px rgba(255,255,255,0.25))',
            }} />
          </div>
          <div style={{
            borderRadius: '999px', padding: '10px',
            background: 'linear-gradient(145deg, #1a1a1d, #0a0a0c)',
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: spinning
              ? '0 0 40px rgba(255,255,255,0.05), inset 0 0 30px rgba(0,0,0,0.3)'
              : 'inset 0 0 30px rgba(0,0,0,0.3)',
            transition: 'box-shadow 0.3s',
          }}>
            <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '999px' }} />
          </div>
        </div>

        {/* Result */}
        {phase === 'result' && result && (
          <div style={{
            marginBottom: '16px', padding: '16px', borderRadius: '16px',
            background: result.isNegative ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${result.isNegative ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)'}`,
            textAlign: 'center', animation: 'drPop 0.4s ease',
          }}>
            <div style={{
              fontSize: '10px', fontWeight: 800, letterSpacing: '2px',
              textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: '6px',
            }}>
              Resultado
            </div>
            <div style={{
              fontSize: '32px', fontWeight: 900, letterSpacing: '-1px',
              color: result.isNegative ? '#ef4444' : '#fff',
            }}>
              {result.label}
            </div>
            <div style={{
              marginTop: '4px', fontSize: '13px', fontWeight: 600,
              color: result.isNegative ? 'rgba(239,68,68,0.8)' : 'rgba(255,255,255,0.45)',
            }}>
              {result.isNegative ? 'Penalización — ¡sigue estudiando!' : '¡Toca Reclamar para obtener tu XP!'}
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {phase === 'idle' && (
            <>
              <button
                onClick={() => { setResult(null); setPhase('spinning'); setSpinning(true); }}
                style={{
                  flex: 1, height: '50px', borderRadius: '14px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'linear-gradient(180deg, #1e1e22 0%, #141418 100%)',
                  color: '#fff', fontSize: '16px', fontWeight: 800, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e: any) => {
                  e.currentTarget.style.background = 'linear-gradient(180deg, #252529 0%, #1a1a1e 100%)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)';
                }}
                onMouseLeave={(e: any) => {
                  e.currentTarget.style.background = 'linear-gradient(180deg, #1e1e22 0%, #141418 100%)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                }}
              >
                Girar
              </button>
              <button onClick={onClose} style={{
                width: '80px', height: '50px', borderRadius: '14px',
                border: '1px solid rgba(255,255,255,0.06)', background: 'transparent',
                color: 'rgba(255,255,255,0.35)', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              }}>
                Cerrar
              </button>
            </>
          )}

          {phase === 'spinning' && (
            <div style={{
              flex: 1, height: '50px', borderRadius: '14px',
              border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.03)',
              color: 'rgba(255,255,255,0.3)', fontSize: '15px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              Girando...
            </div>
          )}

          {phase === 'result' && (
            <button
              onClick={handleClaim}
              disabled={claiming}
              style={{
                flex: 1, height: '50px', borderRadius: '14px',
                border: `1px solid ${result?.isNegative ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`,
                background: result?.isNegative
                  ? 'linear-gradient(180deg, #2a0808 0%, #1a0404 100%)'
                  : 'linear-gradient(180deg, #1e1e22 0%, #141418 100%)',
                color: result?.isNegative ? '#ef4444' : '#fff',
                fontSize: '15px', fontWeight: 800,
                cursor: claiming ? 'not-allowed' : 'pointer',
                opacity: claiming ? 0.6 : 1,
              }}
            >
              {claiming ? 'Procesando...' : result?.isNegative ? '☠️ Aceptar' : '🏆 Reclamar XP'}
            </button>
          )}
        </div>

        <p style={{
          textAlign: 'center', margin: '14px 0 0', fontSize: '11px',
          color: 'rgba(255,255,255,0.15)', fontWeight: 500,
        }}>
          Vuelve mañana por otra recompensa
        </p>
      </div>
    </div>
  );
}
