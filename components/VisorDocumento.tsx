'use client';

import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// ✅ Solo configurar en el cliente
if (typeof window !== 'undefined' && pdfjs?.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

interface Analisis {
  keywords: string[];
  important_phrases: string[];
  summary: string;
}

interface Props {
  contenido: string;
  tipo: string;
  nombre: string;
  archivoUrl?: string;
  archivoBase64?: string;
  archivoMime?: string;
  analisis?: Analisis;
  temaColor: string;
  youtubeId?: string;
  youtubeChannel?: string;
  youtubeWordCount?: number;
}

export default function VisorDocumento({
  contenido, tipo, nombre,
  archivoBase64, archivoMime,
  analisis, temaColor,
  youtubeId, youtubeChannel, youtubeWordCount,
}: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [vistaActiva, setVistaActiva] = useState<'pdf' | 'texto'>('pdf');
  const [fontSize, setFontSize] = useState(14);
  const [mostrarHighlights, setMostrarHighlights] = useState(true);

  useEffect(() => {
    if (archivoBase64 && archivoMime === 'application/pdf') {
      try {
        const byteCharacters = atob(archivoBase64);
        const byteArray = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteArray[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
        return () => URL.revokeObjectURL(url);
      } catch (err) {
        console.error(err);
        setVistaActiva('texto');
      }
    } else {
      setVistaActiva('texto');
    }
  }, [archivoBase64, archivoMime]);

  const textRenderer = (textItem: any) => {
    if (!analisis || !mostrarHighlights) return textItem.str;
    const text = textItem.str;
    if (!text.trim()) return text;
    const isPhrase = analisis.important_phrases?.some(p =>
      text.toLowerCase().includes(p.toLowerCase())
    );
    const isKeyword = analisis.keywords?.some(k =>
      text.toLowerCase().includes(k.toLowerCase())
    );
    if (isPhrase) return `<mark class="hl-phrase">${text}</mark>`;
    if (isKeyword) return `<mark class="hl-keyword">${text}</mark>`;
    return text;
  };

  const renderConHighlights = (texto: string) => {
    if (!analisis || !mostrarHighlights) return <span>{texto}</span>;
    let remaining = texto;
    const phrases = [...(analisis.important_phrases || [])];
    const keywords = [...(analisis.keywords || [])];
    phrases.sort((a, b) => b.length - a.length);
    phrases.forEach(p => {
      try {
        remaining = remaining.replace(
          new RegExp(`(${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
          `|||PHRASE:$1|||`
        );
      } catch {}
    });
    keywords.forEach(k => {
      try {
        remaining = remaining.replace(
          new RegExp(`(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
          `|||KEYWORD:$1|||`
        );
      } catch {}
    });
    const parts: { text: string; type: string }[] = [];
    remaining.split('|||').forEach(seg => {
      if (seg.startsWith('PHRASE:')) parts.push({ text: seg.replace('PHRASE:', ''), type: 'phrase' });
      else if (seg.startsWith('KEYWORD:')) parts.push({ text: seg.replace('KEYWORD:', ''), type: 'keyword' });
      else if (seg) parts.push({ text: seg, type: 'normal' });
    });
    return (
      <>
        {parts.map((p, i) => {
          if (p.type === 'phrase') return (
            <mark key={i} style={{ background: temaColor, color: '#000', borderRadius: '2px', padding: '0 2px', fontWeight: 700 }}>
              {p.text}
            </mark>
          );
          if (p.type === 'keyword') return (
            <mark key={i} style={{ background: '#38bdf8', color: '#000', borderRadius: '2px', padding: '0 2px', fontWeight: 600 }}>
              {p.text}
            </mark>
          );
          return <span key={i}>{p.text}</span>;
        })}
      </>
    );
  };

  const tienePdf = !!pdfUrl && tipo === 'pdf';

  // ── CASO YOUTUBE ──
  if (tipo === 'youtube' && youtubeId) {
    return (
      <div style={{ fontFamily: '-apple-system, sans-serif' }}>
        {/* Video embebido */}
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: '14px', overflow: 'hidden', marginBottom: '16px', border: '2px solid #ff000040' }}>
          <iframe
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            src={`https://www.youtube.com/embed/${youtubeId}?rel=0`}
            title={nombre}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        {/* Info */}
        <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {youtubeChannel && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>📺 {youtubeChannel}</span>
          )}
          {youtubeWordCount && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>📝 {youtubeWordCount.toLocaleString()} palabras transcritas</span>
          )}
          <a href={`https://youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '12px', color: '#ff4444', fontWeight: 700, textDecoration: 'none' }}>
            ▶ Ver en YouTube ↗
          </a>
        </div>
        {/* Transcripción */}
        {contenido && (
          <div style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '16px' }}>
            <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              📜 Transcripción
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.8, margin: 0, maxHeight: '300px', overflowY: 'auto' }}>
              {contenido.substring(0, 3000)}{contenido.length > 3000 ? '...' : ''}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Toolbar */}
      <div style={{ padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        {tienePdf && (
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-card)', borderRadius: '10px', padding: '4px' }}>
            <button onClick={() => setVistaActiva('pdf')}
              style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', background: vistaActiva === 'pdf' ? temaColor : 'transparent', color: vistaActiva === 'pdf' ? '#000' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              ✨ PDF + Highlights
            </button>
            <button onClick={() => setVistaActiva('texto')}
              style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', background: vistaActiva === 'texto' ? temaColor : 'transparent', color: vistaActiva === 'texto' ? '#000' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              📖 Solo texto
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {analisis && (
            <button onClick={() => setMostrarHighlights(!mostrarHighlights)}
              style={{ padding: '5px 12px', borderRadius: '8px', border: `2px solid ${mostrarHighlights ? temaColor : 'var(--border-color)'}`, background: mostrarHighlights ? temaColor + '20' : 'transparent', color: mostrarHighlights ? temaColor : 'var(--text-muted)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
              ✨ {mostrarHighlights ? 'ON' : 'OFF'}
            </button>
          )}
          {vistaActiva === 'pdf' && numPages > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button onClick={() => setPageNumber(p => Math.max(1, p - 1))} disabled={pageNumber <= 1}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}>
                ←
              </button>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{pageNumber} / {numPages}</span>
              <button onClick={() => setPageNumber(p => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages}
                style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}>
                →
              </button>
            </div>
          )}
          {vistaActiva === 'texto' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button onClick={() => setFontSize(f => Math.max(11, f - 1))}
                style={{ padding: '4px 9px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', fontWeight: 700 }}>
                A−
              </button>
              <span style={{ fontSize: '11px', color: 'var(--text-faint)', minWidth: '28px', textAlign: 'center' }}>{fontSize}</span>
              <button onClick={() => setFontSize(f => Math.min(22, f + 1))}
                style={{ padding: '4px 9px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', fontWeight: 700 }}>
                A+
              </button>
            </div>
          )}
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{contenido.split(' ').length} palabras</span>
      </div>

      {/* Leyenda */}
      {analisis && mostrarHighlights && (
        <div style={{ padding: '8px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '20px', height: '10px', borderRadius: '3px', background: temaColor }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Frases importantes</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{ width: '20px', height: '10px', borderRadius: '3px', background: '#38bdf8' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Palabras clave</span>
          </div>
        </div>
      )}

      {/* PDF CON HIGHLIGHTS */}
      {vistaActiva === 'pdf' && tienePdf && (
        <div style={{ background: '#525659', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '80vh', overflowY: 'auto' }}>
          <Document
            file={pdfUrl}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            loading={
              <div style={{ color: '#ccc', padding: '40px', textAlign: 'center' }}>
                <p style={{ fontSize: '40px' }}>⏳</p>
                <p>Cargando PDF...</p>
              </div>
            }
            error={
              <div style={{ color: '#f87171', padding: '40px', textAlign: 'center' }}>
                <p style={{ fontSize: '40px' }}>❌</p>
                <p>Error cargando PDF</p>
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              customTextRenderer={textRenderer}
              renderAnnotationLayer={true}
              renderTextLayer={true}
              scale={1.4}
            />
          </Document>

          {numPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px', background: 'rgba(0,0,0,0.6)', padding: '12px 24px', borderRadius: '14px' }}>
              <button onClick={() => setPageNumber(p => Math.max(1, p - 1))} disabled={pageNumber <= 1}
                style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: pageNumber <= 1 ? 'rgba(255,255,255,0.1)' : temaColor, color: pageNumber <= 1 ? '#666' : '#000', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                ← Anterior
              </button>
              <span style={{ color: '#fff', fontSize: '14px', fontWeight: 600 }}>{pageNumber} / {numPages}</span>
              <button onClick={() => setPageNumber(p => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages}
                style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: pageNumber >= numPages ? 'rgba(255,255,255,0.1)' : temaColor, color: pageNumber >= numPages ? '#666' : '#000', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                Siguiente →
              </button>
            </div>
          )}
        </div>
      )}

      {/* TEXTO CON HIGHLIGHTS */}
      {(vistaActiva === 'texto' || !tienePdf) && (
        <div style={{ background: '#f5f5f0', padding: '40px 20px', minHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ maxWidth: '800px', margin: '0 auto', background: '#ffffff', padding: '50px 60px', boxShadow: '0 2px 20px rgba(0,0,0,0.12)', minHeight: '500px', fontFamily: tipo === 'pdf' ? '"Times New Roman", Times, serif' : 'sans-serif' }}>
            <div style={{ marginBottom: '28px', paddingBottom: '16px', borderBottom: `3px solid ${temaColor}` }}>
              <h1 style={{ fontSize: fontSize + 4, fontWeight: 900, color: '#111', margin: '0 0 4px' }}>
                {nombre.replace(/\.(pdf|docx?|txt|pptx?)$/i, '')}
              </h1>
              <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
                {tipo.toUpperCase()} · {contenido.split(' ').length} palabras
              </p>
            </div>
            {!analisis && (
              <div style={{ background: '#fffbeb', border: '1px solid #f5c842', borderRadius: '8px', padding: '12px 16px', marginBottom: '24px' }}>
                <p style={{ fontSize: '13px', color: '#7a5f00', margin: 0 }}>
                  💡 Haz clic en &quot;🔍 Analizar&quot; para ver highlights
                </p>
              </div>
            )}
            {contenido.split('\n').map((parrafo, i) => (
              parrafo.trim() ? (
                <p key={i} style={{ fontSize, lineHeight: 1.85, color: '#111', margin: '0 0 14px', textAlign: 'justify' }}>
                  {renderConHighlights(parrafo)}
                </p>
              ) : null
            ))}
          </div>
        </div>
      )}

      <style>{`
        .react-pdf__Page { position: relative; }
        .react-pdf__Page__canvas { display: block !important; border-radius: 4px; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
        .react-pdf__Page__textContent { position: absolute !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; }
        .react-pdf__Page__textContent span { color: transparent !important; }
        .react-pdf__Page__textContent .hl-phrase { background: ${temaColor} !important; color: transparent !important; opacity: 0.5; mix-blend-mode: multiply; border-radius: 2px; }
        .react-pdf__Page__textContent .hl-keyword { background: #38bdf8 !important; color: transparent !important; opacity: 0.5; mix-blend-mode: multiply; border-radius: 2px; }
      `}</style>
    </div>
  );
}