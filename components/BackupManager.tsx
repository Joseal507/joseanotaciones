'use client';

import { useState, useRef } from 'react';
import { exportarBackup, importarBackup, getLastSync } from '../lib/storage';

interface Props {
  temaColor?: string;
  onRestored?: () => void;
}

export default function BackupManager({ temaColor = '#f5c842', onRestored }: Props) {
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const lastSync = getLastSync();

  const handleImport = async (file: File) => {
    setImporting(true);
    setMsg('');
    const ok = await importarBackup(file);
    setImporting(false);
    if (ok) {
      setMsg('✅ Backup restaurado correctamente. Recarga la página.');
      onRestored?.();
    } else {
      setMsg('❌ Error al leer el archivo. Asegúrate de que sea un backup válido.');
    }
  };

  const formatSync = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '16px',
      padding: '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
          🔒 Seguridad y Backup
        </h3>
        <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          Tus datos se guardan automáticamente en la nube. También puedes hacer un backup manual.
        </p>
      </div>

      {/* Estado sync */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '12px 16px', borderRadius: '10px',
        background: lastSync ? '#f0fdf4' : '#fef9c3',
        border: lastSync ? '1px solid #86efac' : '1px solid #fde68a',
      }}>
        <span style={{ fontSize: '18px' }}>{lastSync ? '☁️' : '⚠️'}</span>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: lastSync ? '#15803d' : '#92400e' }}>
            {lastSync ? 'Sincronizado con la nube' : 'Sin sincronización reciente'}
          </div>
          <div style={{ fontSize: '11px', color: lastSync ? '#16a34a' : '#b45309' }}>
            {lastSync ? `Último sync: ${formatSync(lastSync)}` : 'Guarda algo para sincronizar'}
          </div>
        </div>
      </div>

      {/* Botones */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {/* Exportar */}
        <button
          onClick={exportarBackup}
          style={{
            padding: '10px 20px', borderRadius: '10px',
            border: `2px solid ${temaColor}`,
            background: 'transparent', color: temaColor,
            fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e: any) => { e.currentTarget.style.background = temaColor + '15'; }}
          onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}
        >
          📥 Descargar backup (.json)
        </button>

        {/* Importar */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          style={{
            padding: '10px 20px', borderRadius: '10px',
            border: '2px solid #6366f1',
            background: 'transparent', color: '#6366f1',
            fontSize: '13px', fontWeight: 700,
            cursor: importing ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e: any) => { if (!importing) e.currentTarget.style.background = '#6366f115'; }}
          onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {importing ? '⏳ Restaurando...' : '📤 Restaurar backup'}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }}
      />

      {msg && (
        <div style={{
          padding: '10px 14px', borderRadius: '8px',
          background: msg.startsWith('✅') ? '#f0fdf4' : '#fef2f2',
          border: msg.startsWith('✅') ? '1px solid #86efac' : '1px solid #fca5a5',
          fontSize: '13px', fontWeight: 600,
          color: msg.startsWith('✅') ? '#15803d' : '#dc2626',
        }}>
          {msg}
        </div>
      )}

      <div style={{ fontSize: '11px', color: 'var(--text-faint)', lineHeight: '1.6' }}>
        💡 <strong>¿Qué incluye el backup?</strong> Todas tus materias, temas, apuntes, flashcards y estadísticas de estudio.
        <br />
        🔄 Los datos se sincronizan automáticamente con tu cuenta cada vez que guardas.
      </div>
    </div>
  );
}