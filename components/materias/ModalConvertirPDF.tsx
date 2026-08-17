'use client';

import { useEffect } from 'react';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Props {
  fileName: string;
  fileType: 'pptx' | 'otro';
  onCerrar: () => void;
}

export default function ModalConvertirPDF({ fileName, fileType, onCerrar }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onCerrar]);

  const esPptx = fileType === 'pptx';
  const emoji = esPptx ? '📊' : '📁';
  const tipoNombre = esPptx ? 'PowerPoint' : 'archivo';

  return (
    <div
      onClick={onCerrar}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        zIndex: 99999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-primary)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 18,
          padding: 36,
          maxWidth: 520, width: '100%',
          boxShadow: '6px 8px 0 var(--text-primary)',
          fontFamily: BODY,
          position: 'relative',
          animation: 'popIn 0.25s cubic-bezier(.34,1.56,.64,1)',
        }}
      >
        <button
          onClick={onCerrar}
          style={{
            position: 'absolute', top: 14, right: 14,
            width: 34, height: 34, borderRadius: 8,
            border: '2px solid var(--text-primary)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontFamily: HAND, fontSize: 20, fontWeight: 900,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '2px 2px 0 var(--text-primary)',
          }}
        >✕</button>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            fontSize: 56, marginBottom: 8,
            transform: 'rotate(-5deg)',
            display: 'inline-block',
          }}>{emoji}</div>
          <h2 style={{
            margin: 0,
            fontFamily: HAND, fontSize: 32, fontWeight: 900,
            color: 'var(--text-primary)',
            transform: 'rotate(-1deg)',
          }}>
            ¡Conviértelo a PDF primero!
          </h2>
          <p style={{
            margin: '8px 0 0',
            fontSize: 14, color: 'var(--text-muted)',
            fontFamily: BODY,
          }}>
            ~ es súper rápido, te explico ~
          </p>
        </div>

        <div style={{
          padding: '12px 16px',
          background: 'var(--bg-card)',
          border: '2px dashed var(--border-color)',
          borderRadius: 10,
          marginBottom: 22,
          fontSize: 13, color: 'var(--text-muted)',
          textAlign: 'center',
          fontFamily: BODY,
        }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>archivo detectado</div>
          <div style={{
            fontSize: 16, fontWeight: 700, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {fileName}
          </div>
        </div>

        <p style={{
          margin: '0 0 22px',
          fontSize: 15, lineHeight: 1.5,
          color: 'var(--text-primary)',
          textAlign: 'center',
        }}>
          Para que tu {tipoNombre} se vea <strong>idéntico al original</strong> al estudiarlo,
          súbelo como PDF. Las apps profesionales (Google Drive, Notion) hacen lo mismo.
        </p>

        <div style={{
          background: 'color-mix(in srgb, #3b82f6 8%, var(--bg-card))',
          border: '2px solid #3b82f6',
          borderRadius: 12,
          padding: 18,
          marginBottom: 22,
        }}>
          <div style={{
            fontFamily: HAND, fontSize: 20, fontWeight: 900,
            color: '#3b82f6', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            ✨ Cómo convertirlo {esPptx ? '(10 segundos)' : ''}
          </div>

          {esPptx ? (
            <ol style={{
              margin: 0, paddingLeft: 22,
              fontSize: 14, lineHeight: 1.7,
              color: 'var(--text-primary)',
            }}>
              <li>Abre el PowerPoint en tu computadora</li>
              <li>Click en <strong>Archivo</strong> (arriba a la izquierda)</li>
              <li>Click en <strong>Guardar como</strong> o <strong>Exportar</strong></li>
              <li>Elige formato <strong>PDF</strong></li>
              <li>Guardar y subir aquí 🚀</li>
            </ol>
          ) : (
            <div style={{
              fontSize: 14, lineHeight: 1.6,
              color: 'var(--text-primary)',
            }}>
              La mayoría de programas tienen opción <strong>"Exportar a PDF"</strong> o
              <strong> "Guardar como PDF"</strong>. Si usas Google Docs/Slides, ve a
              <em> Archivo → Descargar → PDF</em>.
            </div>
          )}
        </div>

        <div style={{
          fontSize: 12, color: 'var(--text-muted)',
          textAlign: 'center', marginBottom: 22,

        }}>
          📄 PDF · 📃 Word (.docx) · 🖼️ Imágenes · 📝 Texto
        </div>

        <button
          onClick={onCerrar}
          style={{
            width: '100%',
            padding: '14px 20px',
            background: '#3b82f6',
            color: '#fff',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 12,
            fontFamily: HAND, fontSize: 22, fontWeight: 900,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transition: 'all 0.15s',
          }}
        >
          Entendido, voy a convertirlo 👍
        </button>
      </div>

      <style jsx>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.85) translateY(20px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
