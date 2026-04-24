'use client';

import { useRef, useState } from 'react';

interface Props {
  temaColor: string;
  onInsert: (pages: string[]) => void;
  onClose: () => void;
}

export default function PdfBackgroundInserter({ temaColor, onInsert, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState('');

  const loadLib = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if ((window as any).pdfjsLib) return resolve((window as any).pdfjsLib);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      s.onload = () => {
        const lib = (window as any).pdfjsLib;
        lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        resolve(lib);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  };

  const handleFile = async (file: File) => {
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setProgress('Iniciando...');

    try {
      let pagesBase64: string[] = [];

      if (file.type === 'application/pdf') {
        setProgress('Cargando motor PDF...');
        const pdfjs = await loadLib();
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

        for (let i = 1; i <= pdf.numPages; i++) {
          setProgress(`Renderizando pág ${i}/${pdf.numPages}...`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: ctx, viewport }).promise;
          pagesBase64.push(canvas.toDataURL('image/png'));
        }
      } else if (file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')) {
        // Word → convertir a imagen via mammoth + canvas
        setProgress('Procesando Word...');
        try {
          const mammoth = await import('mammoth');
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          const html = result.value;
          // Renderizar HTML en un canvas
          const div = document.createElement('div');
          div.innerHTML = html;
          div.style.cssText = 'width:816px;padding:60px;background:white;font-family:Times New Roman,serif;font-size:12pt;position:fixed;left:-9999px;top:0';
          document.body.appendChild(div);
          await new Promise(r => setTimeout(r, 200));
          const html2canvas = (await import('html2canvas')).default;
          const canvas = await html2canvas(div, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' });
          document.body.removeChild(div);
          pagesBase64 = [canvas.toDataURL('image/png')];
        } catch (e) {
          console.error('Word error:', e);
          alert('Error procesando Word. Intenta convertirlo a PDF primero.');
        }
      } else if (file.type.startsWith('image/')) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        });
        pagesBase64 = [base64];
      }

      // ✅ Usar directamente base64 como preview/fondo
      // Esto hace que el fondo funcione sin depender del storage
      setPreview(pagesBase64);
    } catch (err) {
      console.error(err);
      alert('Error procesando el archivo');
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(10px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--bg-card)', borderRadius: '24px', border: `2px solid ${temaColor}`, padding: '30px', width: '90%', maxWidth: '500px', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
        <h2 style={{ marginTop: 0, color: 'var(--text-primary)' }}>📋 Insertar Fondo (PDF, Word, Imagen)</h2>

        {!preview.length ? (
          <div
            onClick={() => !loading && inputRef.current?.click()}
            style={{ border: `2px dashed ${temaColor}66`, borderRadius: '15px', padding: '50px 20px', textAlign: 'center', cursor: loading ? 'default' : 'pointer', background: `${temaColor}08` }}
          >
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '30px', height: '30px', border: `3px solid ${temaColor}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>{progress}</p>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>📄</div>
                <p style={{ color: 'var(--text-primary)', fontWeight: 700, margin: '0 0 6px' }}>
                  Haz clic o arrastra un PDF/Imagen aquí
                </p>
                <p style={{ color: 'var(--text-faint)', fontSize: '12px', margin: 0 }}>
                  PDF, Word (.docx), PNG, JPG, WEBP
                </p>
              </>
            )}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                ✅ {fileName} — {preview.length} pág{preview.length > 1 ? 's' : ''}
              </p>
              <button
                onClick={() => { setPreview([]); setFileName(''); }}
                style={{ background: 'none', border: '1px solid #fca5a5', borderRadius: '6px', color: '#ef4444', fontSize: '11px', padding: '2px 8px', cursor: 'pointer' }}
              >
                Cambiar
              </button>
            </div>
            <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', padding: '10px 0', marginBottom: '12px' }}>
              {preview.map((p, i) => (
                <img key={i} src={p} alt={`Página ${i + 1}`}
                  style={{ height: '100px', borderRadius: '5px', border: '1px solid var(--border-color)', flexShrink: 0 }} />
              ))}
            </div>
            <button
              onClick={() => { onInsert(preview); onClose(); }}
              style={{ width: '100%', padding: '12px', background: temaColor, border: 'none', borderRadius: '10px', fontWeight: 800, cursor: 'pointer', fontSize: '14px' }}
            >
              ✅ Insertar como fondo ({preview.length} pág{preview.length > 1 ? 's' : ''})
            </button>
          </div>
        )}

        <input ref={inputRef} type="file" accept=".pdf,.doc,.docx,image/*" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}