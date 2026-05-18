'use client';
export default function Loading() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontFamily: "'Caveat',cursive", fontSize: 22, fontStyle: 'italic', color: 'var(--text-muted)' }}>~ cargando leaderboard ~</p>
    </div>
  );
}
