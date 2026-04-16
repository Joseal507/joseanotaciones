'use client';

interface Props {
  menuPos: { x: number; y: number };
  converting: boolean;
  onMove: () => void;
  onConvert: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export default function SelectionMenu({ menuPos, converting, onMove, onConvert, onSave, onDelete }: Props) {
  return (
    <div style={{
      position: 'absolute',
      left: menuPos.x,
      top: menuPos.y,
      transform: 'translateX(-50%)',
      background: 'white',
      borderRadius: '14px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
      border: '1px solid #e5e7eb',
      display: 'flex',
      overflow: 'hidden',
      zIndex: 100,
    }}>
      {/* Mover */}
      <button
        onPointerDown={e => { e.stopPropagation(); onMove(); }}
        style={{ padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'grab', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#374151', fontWeight: 600, borderRight: '1px solid #f3f4f6' }}
        onMouseEnter={(e: any) => e.currentTarget.style.background = '#f9fafb'}
        onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
          <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M3 12h18M12 3v18"/>
        </svg>
        Mover
      </button>

      {/* → Texto */}
      <button
        onClick={onConvert}
        disabled={converting}
        style={{ padding: '10px 14px', border: 'none', background: converting ? '#f5f3ff' : 'transparent', cursor: converting ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#6366f1', fontWeight: 600, borderRight: '1px solid #f3f4f6', minWidth: '76px' }}
        onMouseEnter={(e: any) => { if (!converting) e.currentTarget.style.background = '#f5f3ff'; }}
        onMouseLeave={(e: any) => { if (!converting) e.currentTarget.style.background = 'transparent'; }}
      >
        {converting ? (
          <>
            <div style={{ width: '18px', height: '18px', border: '2px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            Leyendo...
          </>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            → Texto
          </>
        )}
      </button>

      {/* Guardar imagen */}
      <button
        onClick={onSave}
        style={{ padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#374151', fontWeight: 600, borderRight: '1px solid #f3f4f6' }}
        onMouseEnter={(e: any) => e.currentTarget.style.background = '#f9fafb'}
        onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
        </svg>
        Guardar
      </button>

      {/* Borrar */}
      <button
        onClick={onDelete}
        style={{ padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#ef4444', fontWeight: 600 }}
        onMouseEnter={(e: any) => e.currentTarget.style.background = '#fef2f2'}
        onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
          <polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
        </svg>
        Borrar
      </button>
    </div>
  );
}