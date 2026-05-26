'use client';

interface RadialItem {
  id: string;
  label: string;
  enabled?: boolean;
  onClick?: () => void;
}

export default function RadialMenu({
  items,
  radius = 140,
}: {
  items: RadialItem[];
  radius?: number;
}) {
  const angleStep = (2 * Math.PI) / items.length;

  return (
    <div style={{ position: 'relative', width: 400, height: 400 }}>
      {items.map((item, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);

        return (
          <button
            key={item.id}
            onClick={() => item.enabled !== false && item.onClick?.()}
            style={{
              position: 'absolute',
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              transform: 'translate(-50%, -50%)',
              padding: '10px 18px',
              borderRadius: 12,
              border: '2px solid var(--text-primary)',
              background: item.enabled === false ? 'var(--bg-secondary)' : 'var(--gold)',
              color: item.enabled === false ? 'var(--text-faint)' : '#000',
              cursor: item.enabled === false ? 'not-allowed' : 'pointer',
              fontWeight: 800,
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
