'use client';

export default function ComingSoonModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          padding: 40,
          borderRadius: 16,
          border: '3px solid var(--gold)',
          textAlign: 'center',
        }}
      >
        <h2 style={{ fontSize: 28, marginBottom: 10 }}>🚧 Coming Soon</h2>
        <p style={{ opacity: 0.7 }}>Disponible próximamente.</p>
      </div>
    </div>
  );
}
