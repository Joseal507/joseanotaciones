'use client';

import { PartnerInfo } from './types';

const HAND = "'Caveat',cursive";

export function Av({ user, size = 40, onClick }: { user: PartnerInfo; size?: number; onClick?: () => void }) {
  const i = (user.nombre || '?').trim().charAt(0).toUpperCase();
  return (
    <div onClick={onClick} style={{
      width: size, height: size,
      borderRadius: '50%',
      background: user.avatar_url ? 'transparent' : 'var(--gold)',
      border: '2px solid var(--text-primary)',
      boxShadow: '2px 2px 0 var(--gold)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: HAND, fontSize: size * 0.5, fontWeight: 900, color: '#000',
      overflow: 'hidden', flexShrink: 0,
      cursor: onClick ? 'pointer' : 'default',
      transform: 'rotate(-4deg)',
      transition: 'transform 0.2s cubic-bezier(.25,.8,.25,1)',
    }}
      onMouseEnter={onClick ? (e: any) => { e.currentTarget.style.transform = 'rotate(0deg) scale(1.08)'; } : undefined}
      onMouseLeave={onClick ? (e: any) => { e.currentTarget.style.transform = 'rotate(-4deg)'; } : undefined}
    >
      {user.avatar_url
        ? <img src={user.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : i}
    </div>
  );
}

export function fmtTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'ahora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function fmtSize(b?: number) {
  if (!b) return '';
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}

export function getTipoLabel(tipo?: string) {
  if (!tipo) return '';
  const map: Record<string, string> = {
    universitario: '🎓 Universitario',
    escuela: '🏫 Escuela',
    profesional: '💼 Profesional',
    autodidacta: '🧠 Autodidacta',
  };
  return map[tipo] || tipo;
}