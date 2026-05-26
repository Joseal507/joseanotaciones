'use client';

type PaperStyle = 'blank' | 'lined' | 'grid' | 'dotted';

interface Props {
  value: PaperStyle;
  onChange: (s: PaperStyle) => void;
}

const OPTIONS: { id: PaperStyle; label: string; icon: React.ReactNode }[] = [
  {
    id: 'blank',
    label: 'Sin fondo',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    id: 'lined',
    label: 'Rayado',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="4" y1="1" x2="4" y2="15" stroke="#fca5a5" strokeWidth="1.5"/>
        {[5, 8, 11].map(y => (
          <line key={y} x1="4" y1={y} x2="15" y2={y} stroke="#e2e8f0" strokeWidth="1"/>
        ))}
      </svg>
    ),
  },
  {
    id: 'grid',
    label: 'Cuadrícula',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        {[5, 9].map(x => <line key={`v${x}`} x1={x} y1="1" x2={x} y2="15" stroke="#e2e8f0" strokeWidth="0.8"/>)}
        {[5, 9].map(y => <line key={`h${y}`} x1="1" y1={y} x2="15" y2={y} stroke="#e2e8f0" strokeWidth="0.8"/>)}
      </svg>
    ),
  },
  {
    id: 'dotted',
    label: 'Puntos',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        {[5, 9].flatMap(x => [5, 9].map(y => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" fill="#c7d2e8"/>
        )))}
      </svg>
    ),
  },
];

export default function PaperStyleSelector({ value, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: '2px', background: '#f3f4f6', borderRadius: '8px', padding: '3px' }}>
      {OPTIONS.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} title={o.label}
          style={{
            padding: '5px 8px', borderRadius: '6px', border: 'none',
            background: value === o.id ? 'white' : 'transparent',
            color: value === o.id ? '#374151' : '#9ca3af',
            cursor: 'pointer',
            boxShadow: value === o.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.15s',
            display: 'flex', alignItems: 'center',
          }}>
          {o.icon}
        </button>
      ))}
    </div>
  );
}