'use client';

interface Props {
  menuPos: { x: number; y: number };
  converting: boolean;
  solving?: boolean;
  onMove: () => void;
  onConvert: () => void;
  onSave: () => void;
  onDelete: () => void;
  onPeterSauPeter?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onDuplicate?: () => void;
}

export default function SelectionMenu({
  menuPos, converting, solving,
  onMove, onConvert, onSave, onDelete, onPeterSauPeter,
  onCopy, onCut, onDuplicate,
}: Props) {
  const G = '#f5c842';

  const btn = (
    onClick: () => void,
    icon: React.ReactNode,
    label: string,
    color: string,
    disabled = false,
    loading = false,
  ) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 10px', border: 'none', background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
        fontSize: '9px', color, fontWeight: 700, minWidth: '48px',
        transition: 'background 0.12s', borderRadius: '8px',
      }}
      onMouseEnter={(e: any) => { if (!disabled) e.currentTarget.style.background = color + '12'; }}
      onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {loading ? (
        <div style={{ width: '16px', height: '16px', border: `2px solid ${color}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      ) : icon}
      {label}
    </button>
  );

  return (
    <>
      <div style={{
        position: 'absolute',
        left: menuPos.x, top: menuPos.y,
        transform: 'translateX(-50%)',
        background: '#1e1e2e',
        borderRadius: '14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)',
        display: 'flex', padding: '4px',
        zIndex: 100, gap: '1px',
      }}>
        {/* Move */}
        {btn(onMove,
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M3 12h18M12 3v18"/></svg>,
          'Move', '#818cf8'
        )}

        {/* Copy */}
        {onCopy && btn(onCopy,
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
          'Copy', G
        )}

        {/* Cut */}
        {onCut && btn(onCut,
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>,
          'Cut', '#f87171'
        )}

        {/* Duplicate */}
        {onDuplicate && btn(onDuplicate,
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16V4a2 2 0 012-2h12"/><line x1="15" y1="12" x2="15" y2="18"/><line x1="12" y1="15" x2="18" y2="15"/></svg>,
          'Duplicate', '#34d399'
        )}

        {/* → Text */}
        {btn(onConvert,
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>,
          converting ? '...' : '→ Text', '#818cf8', converting, converting
        )}

        {/* 🧮 Peter SauPeter */}
        {onPeterSauPeter && btn(onPeterSauPeter,
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f5c842" strokeWidth="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>,
          solving ? '...' : 'Solve', '#d97706', solving, solving
        )}

        {/* Save image */}
        {btn(onSave,
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
          'Save', '#64748b'
        )}

        {/* Delete */}
        {btn(onDelete,
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
          'Delete', '#ef4444'
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  );
}
