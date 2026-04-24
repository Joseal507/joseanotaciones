'use client';

// ✅ BETA MODE — cambiar a false cuando lances oficialmente
export const BETA_MODE = true;

export function BetaBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  if (!BETA_MODE) return null;
  return (
    <span style={{
      background: 'linear-gradient(135deg, #f97316, #ef4444)',
      color: '#fff',
      fontSize: size === 'sm' ? '9px' : '11px',
      fontWeight: 900,
      padding: size === 'sm' ? '2px 6px' : '3px 8px',
      borderRadius: '6px',
      letterSpacing: '0.5px',
      textTransform: 'uppercase' as const,
      flexShrink: 0,
    }}>
      BETA
    </span>
  );
}

export function BetaBanner() {
  if (!BETA_MODE) return null;
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(239,68,68,0.08))',
      border: '1px solid rgba(249,115,22,0.3)',
      borderRadius: '12px',
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      margin: '0 0 20px',
      flexWrap: 'wrap' as const,
    }}>
      <span style={{ fontSize: '16px' }}>🚧</span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#f97316' }}>
          Modo Beta —{' '}
        </span>
        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
          Si algo no funciona, contacta al desarrollador.
        </span>
      </div>
      <a
        href="mailto:jose.alberto.deobaldia@gmail.com"
        style={{
          fontSize: '12px', fontWeight: 700,
          color: '#f97316',
          background: 'rgba(249,115,22,0.12)',
          border: '1px solid rgba(249,115,22,0.3)',
          borderRadius: '8px',
          padding: '5px 12px',
          textDecoration: 'none',
          whiteSpace: 'nowrap' as const,
          flexShrink: 0,
        }}
      >
        📩 Contactar
      </a>
    </div>
  );
}
