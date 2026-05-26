'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#111118',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      gap: '16px',
      padding: '24px',
    }}>
      <div style={{ fontSize: '48px' }}>💥</div>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ color: '#fff', fontSize: '20px', fontWeight: 800, margin: 0 }}>
          Algo salió mal
        </h1>
        <p style={{ color: '#6b7280', fontSize: '13px', margin: '8px 0 0 0' }}>
          {error.message ?? 'Error inesperado'}
        </p>
        {error.digest && (
          <p style={{ color: '#374151', fontSize: '10px', margin: '4px 0 0 0' }}>
            ID: {error.digest}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={reset}
          style={{
            padding: '10px 20px',
            borderRadius: '10px',
            border: 'none',
            background: 'var(--gold)',
            color: '#000',
            fontWeight: 800,
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
        <button
          onClick={() => ((window as any).__showNavLoader?.('/'), window.location.href = '/')}
          style={{
            padding: '10px 20px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.05)',
            color: '#fff',
            fontWeight: 700,
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Ir al inicio
        </button>
      </div>
    </div>
  );
}