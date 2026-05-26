'use client';

import { useRef } from 'react';

interface Props {
  onInsert: (src: string) => void;
  onClose: () => void;
  color: string;
}

export default function ImageInserter({ onInsert, onClose, color }: Props) {
  const urlRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        onInsert(ev.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUrl = () => {
    const url = urlRef.current?.value;
    if (!url) return;
    onInsert(url);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      padding: '20px',
    }}>
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '20px',
        padding: '32px',
        width: '100%',
        maxWidth: '480px',
        border: '1px solid var(--border-color)',
      }}>
        <div style={{
          height: '4px',
          background: color,
          borderRadius: '2px',
          marginBottom: '24px',
        }} />

        <h3 style={{
          fontSize: '20px',
          fontWeight: 800,
          color: 'var(--text-primary)',
          margin: '0 0 24px 0',
        }}>
          🖼️ Insertar Imagen
        </h3>

        {/* Desde archivo */}
        <div style={{ marginBottom: '20px' }}>
          <p style={{
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--text-muted)',
            margin: '0 0 10px 0',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Desde tu computadora
          </p>
          <label htmlFor="img-upload" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px dashed ${color}`,
            borderRadius: '12px',
            padding: '32px',
            cursor: 'pointer',
            background: color + '10',
            transition: 'all 0.2s',
          }}>
            <input
              id="img-upload"
              type="file"
              accept="image/*"
              onChange={handleFile}
              style={{ display: 'none' }}
            />
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>📁</div>
            <p style={{
              color: color,
              fontWeight: 700,
              fontSize: '14px',
              margin: 0,
            }}>
              Haz clic para seleccionar imagen
            </p>
            <p style={{
              color: 'var(--text-faint)',
              fontSize: '12px',
              margin: '4px 0 0',
            }}>
              PNG, JPG, GIF, WebP
            </p>
          </label>
        </div>

        {/* Desde URL */}
        <div style={{ marginBottom: '24px' }}>
          <p style={{
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--text-muted)',
            margin: '0 0 10px 0',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Desde URL
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              ref={urlRef}
              type="url"
              placeholder="https://ejemplo.com/imagen.jpg"
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '10px',
                border: '2px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '14px',
                outline: 'none',
              }}
            />
            <button
              onClick={handleUrl}
              style={{
                padding: '10px 18px',
                borderRadius: '10px',
                border: 'none',
                background: color,
                color: '#000',
                fontWeight: 800,
                fontSize: '13px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}>
              Insertar
            </button>
          </div>
        </div>

        {/* Cancelar */}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '10px',
            border: '2px solid var(--border-color)',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
          }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}