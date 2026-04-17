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
      if (file.type === 'application/pdf') {
        setProgress('Cargando motor PDF...');
        const pdfjs = await loadLib();
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const pages: string[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          setProgress(`Renderizando pág ${i}/${pdf.numPages}...`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          
          await page.render({ canvasContext: ctx, viewport }).promise;
          pages.push(canvas.toDataURL('image/png'));
        }
        setPreview(pages);
      } else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => setPreview([e.target?.result as string]);
        reader.readAsDataURL(file);
      }
    } catch (err) {
      console.error(err);
      alert('Error: Prueba con otro archivo PDF');
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(10px)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '24px', border: `2px solid ${temaColor}`, padding: '30px', width: '90%', maxWidth: '500px', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
        <h2 style={{ marginTop: 0, color: 'var(--text-primary)' }}>📋 Insertar Fondo</h2>
        
        {!preview.length ? (
          <div 
            onClick={() => !loading && inputRef.current?.click()}
            style={{ border: `2px dashed ${temaColor}66`, borderRadius: '15px', padding: '50px 20px', textAlign: 'center', cursor: 'pointer', background: `${temaColor}08` }}
          >
            {loading ? (
              <div>
                <div style={{ width: '30px', height: '30px', border: `3px solid ${temaColor}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 10px' }} />
                <p>{progress}</p>
              </div>
            ) : (
              <p>Haz clic o arrastra un PDF/Imagen aquí</p>
            )}
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '14px' }}>✅ {fileName} ({preview.length} págs)</p>
            <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', padding: '10px 0' }}>
              {preview.map((p, i) => <img key={i} src={p} style={{ height: '100px', borderRadius: '5px', border: '1px solid #ddd' }} />)}
            </div>
            <button 
              onClick={() => { onInsert(preview); onClose(); }}
              style={{ width: '100%', padding: '12px', background: temaColor, border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', marginTop: '15px' }}
            >
              Insertar como fondo
            </button>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".pdf,image/*" hidden onChange={e => handleFile(e.target.files?.[0]!)} />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}