'use client';

import { useState, useRef, useCallback } from 'react';
import {
  uploadMaterials,
  type UploadProgress,
  formatBytes,
  kindEmoji,
} from '../../lib/materials/upload';
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE } from '../../lib/materials/types';
import type { MaterialUI } from '../../lib/materials/types';
import ModalConvertirPDF from '../materias/ModalConvertirPDF';

interface Props {
  temaId: string;
  materiaId: string;
  onUploadComplete: (materials: MaterialUI[]) => void;
  onClose?: () => void;
}

const ACCEPT = Object.keys(ALLOWED_EXTENSIONS)
  .map(e => `.${e}`)
  .join(',');

export default function MaterialUploader({
  temaId,
  materiaId,
  onUploadComplete,
  onClose,
}: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<UploadProgress[]>([]);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [modalArchivo, setModalArchivo] = useState<{ nombre: string; tipo: 'pptx' | 'otro' } | null>(null);

  // ─── Selección de archivos ───
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    // Validar PPTX y otros formatos no soportados
    for (const f of arr) {
      const nombre = f.name.toLowerCase();
      const mime = (f.type || '').toLowerCase();
      if (nombre.endsWith('.pptx') || nombre.endsWith('.ppt') || mime.includes('presentationml') || mime.includes('powerpoint')) {
        setModalArchivo({ nombre: f.name, tipo: 'pptx' });
        return;
      }
    }
    const valid = arr.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXTENSIONS[ext]) return false;
      // Validación por tipo en el frontend (mismo criterio que backend)
      const ext3 = f.name.split('.').pop()?.toLowerCase() ?? '';
      const kindMap: Record<string, number> = {
        pdf: 30, jpg: 10, jpeg: 10, png: 10, gif: 10, webp: 10,
        doc: 20, docx: 20, ppt: 20, pptx: 20, txt: 5, md: 5,
        mp3: 25, wav: 25, m4a: 25, ogg: 25, webm: 25,
      };
      const maxMB3 = kindMap[ext3] ?? 30;
      if (f.size > maxMB3 * 1024 * 1024) {
        const fileMB = (f.size / (1024 * 1024)).toFixed(1);
        alert(`"${f.name}" pesa ${fileMB}MB. El límite para este tipo es ${maxMB3}MB.`);
        return false;
      }
      return true;
    });
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))].slice(0, 10);
    });
  }, []);

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name));
  };

  // ─── Drag & Drop ───
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  // ─── Upload ───
  const handleUpload = async () => {
    if (!files.length || uploading) return;
    setUploading(true);
    setDone(false);

    try {
      const uploaded = await uploadMaterials(
        files,
        temaId,
        materiaId,
        (p) => setProgress([...p]),
      );
      setDone(true);
      onUploadComplete(uploaded);
    } catch (err: any) {
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
    }
  };

  const allDone = progress.length > 0 && progress.every(p => p.status === 'done' || p.status === 'error');
  const hasErrors = progress.some(p => p.status === 'error');

  return (
    <div style={{
      background: '#0d0d10',
      border: '1.5px solid rgba(255,255,255,0.12)',
      borderRadius: 16,
      padding: 24,
      maxWidth: 560,
      width: '100%',
      fontFamily: "'Caveat', cursive",
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ color: '#fff', fontSize: 26, fontWeight: 800, margin: 0 }}>
            📎 Subir material
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: '4px 0 0', fontStyle: 'italic' }}>
            El análisis se hace cuando uses un enfoque
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.5)', fontSize: 22,
              cursor: 'pointer', padding: 4,
            }}
          >✕</button>
        )}
      </div>

      {/* Drop Zone */}
      {!uploading && !allDone && (
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? '#f5c842' : 'rgba(255,255,255,0.2)'}`,
            borderRadius: 12,
            padding: '32px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? 'rgba(245,200,66,0.06)' : 'rgba(255,255,255,0.03)',
            transition: 'all 0.2s ease',
            marginBottom: 16,
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            onChange={e => addFiles(e.target.files!)}
            style={{ display: 'none' }}
          />
          <div style={{ fontSize: 40, marginBottom: 10 }}>
            {dragOver ? '⬇️' : '📂'}
          </div>
          <p style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 6px' }}>
            {dragOver ? 'Suelta aquí' : 'Arrastra o haz clic'}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>
            PDF (30MB) · Word/PPT (20MB) · Imagen (10MB) · TXT (5MB)
          </p>
        </div>
      )}

      {/* Lista de archivos seleccionados */}
      {files.length > 0 && !uploading && !allDone && (
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {files.map(file => {
            const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
            const kind = ALLOWED_EXTENSIONS[ext] ?? 'pdf';
            return (
              <div
                key={file.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, padding: '10px 14px',
                }}
              >
                <span style={{ fontSize: 22, flexShrink: 0 }}>{kindEmoji(kind)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    color: '#fff', fontSize: 15, fontWeight: 700,
                    margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {file.name}
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, margin: 0 }}>
                    {formatBytes(file.size)}
                  </p>
                </div>
                <button
                  onClick={() => removeFile(file.name)}
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'rgba(255,100,100,0.7)', fontSize: 18,
                    cursor: 'pointer', flexShrink: 0, padding: 2,
                  }}
                >✕</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Progreso durante upload */}
      {(uploading || allDone) && progress.length > 0 && (
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {progress.map((p, i) => (
            <div
              key={i}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${
                  p.status === 'done' ? 'rgba(74,222,128,0.4)' :
                  p.status === 'error' ? 'rgba(248,113,113,0.4)' :
                  'rgba(255,255,255,0.1)'
                }`,
                borderRadius: 10, padding: '10px 14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>
                  {p.status === 'done' ? '✅' :
                   p.status === 'error' ? '❌' :
                   p.status === 'uploading' ? '⬆️' :
                   p.status === 'completing' ? '⏳' : '⭕'}
                </span>
                <span style={{
                  color: '#fff', fontSize: 14, fontWeight: 700,
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {p.fileName}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                  {p.status === 'done' ? 'listo' :
                   p.status === 'error' ? 'error' :
                   p.status === 'uploading' ? `${p.progress}%` :
                   p.status === 'completing' ? 'verificando...' : 'esperando...'}
                </span>
              </div>

              {/* Barra de progreso */}
              {(p.status === 'uploading' || p.status === 'completing') && (
                <div style={{
                  height: 4, background: 'rgba(255,255,255,0.1)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${p.status === 'completing' ? 100 : p.progress}%`,
                    background: '#f5c842',
                    borderRadius: 2,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              )}

              {p.status === 'error' && p.error && (
                <p style={{ color: '#f87171', fontSize: 12, margin: '4px 0 0', fontStyle: 'italic' }}>
                  {p.error}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Botones */}
      {!allDone && (
        <button
          onClick={handleUpload}
          disabled={!files.length || uploading}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: 12,
            border: 'none',
            background: files.length && !uploading ? '#f5c842' : 'rgba(255,255,255,0.08)',
            color: files.length && !uploading ? '#000' : 'rgba(255,255,255,0.3)',
            fontSize: 18,
            fontWeight: 800,
            fontFamily: "'Caveat', cursive",
            cursor: files.length && !uploading ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s ease',
          }}
        >
          {uploading
            ? '⬆️ Subiendo...'
            : `📎 Subir ${files.length || ''} ${files.length === 1 ? 'archivo' : 'archivos'}`}
        </button>
      )}

      {/* Resultado final */}
      {allDone && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>
            {hasErrors ? '⚠️' : '✅'}
          </div>
          <p style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>
            {hasErrors
              ? 'Algunos archivos fallaron'
              : '¡Material guardado!'}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: '0 0 20px', fontStyle: 'italic' }}>
            {hasErrors
              ? 'Los que subieron correctamente ya están disponibles'
              : 'Se analizará cuando uses un enfoque de estudio'}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  padding: '10px 24px', borderRadius: 10,
                  border: '1.5px solid rgba(255,255,255,0.2)',
                  background: 'transparent', color: '#fff',
                  fontSize: 16, fontWeight: 700,
                  fontFamily: "'Caveat', cursive", cursor: 'pointer',
                }}
              >
                Cerrar
              </button>
            )}
            <button
              onClick={() => {
                setFiles([]);
                setProgress([]);
                setDone(false);
              }}
              style={{
                padding: '10px 24px', borderRadius: 10,
                border: 'none', background: '#f5c842',
                color: '#000', fontSize: 16, fontWeight: 800,
                fontFamily: "'Caveat', cursive", cursor: 'pointer',
              }}
            >
              + Subir más
            </button>
          </div>
        </div>
      )}
      {modalArchivo && (
        <ModalConvertirPDF
          fileName={modalArchivo.nombre}
          fileType={modalArchivo.tipo}
          onCerrar={() => setModalArchivo(null)}
        />
      )}

    </div>
  );
}
