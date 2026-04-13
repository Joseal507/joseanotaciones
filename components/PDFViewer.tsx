'use client';

import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.js',
  import.meta.url,
).toString();

interface PDFViewerProps {
  fileUrl: string;
  keywords: string[];
  importantPhrases: string[];
}

export default function PDFViewer({ fileUrl, keywords, importantPhrases }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.2);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const textRenderer = useCallback((textItem: any) => {
    const text = textItem.str;
    if (!text.trim()) return text;

    const isPhrase = importantPhrases.some(p =>
      text.toLowerCase().includes(p.toLowerCase())
    );

    const isKeyword = keywords.some(k =>
      text.toLowerCase().includes(k.toLowerCase())
    );

    if (isPhrase) {
      return `<mark style="
        background: rgba(139,92,246,0.5);
        color: inherit;
        border-radius: 3px;
        padding: 0 2px;
        border-bottom: 2px solid #8b5cf6;
      ">${text}</mark>`;
    }

    if (isKeyword) {
      return `<mark style="
        background: rgba(59,130,246,0.5);
        color: inherit;
        border-radius: 3px;
        padding: 0 2px;
        border-bottom: 2px solid #3b82f6;
      ">${text}</mark>`;
    }

    return text;
  }, [keywords, importantPhrases]);

  return (
    <div>
      {/* CONTROLES */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        flexWrap: 'wrap',
        gap: '12px',
      }}>

        {/* Paginación */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              border: '1px solid #1a1a2e',
              background: currentPage <= 1 ? '#0a0a15' : 'rgba(59,130,246,0.15)',
              color: currentPage <= 1 ? '#333' : '#60a5fa',
              cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '14px',
            }}
          >
            ← Anterior
          </button>

          <span style={{
            color: '#555',
            fontSize: '13px',
            background: '#0a0a15',
            padding: '8px 16px',
            borderRadius: '10px',
            border: '1px solid #1a1a2e',
          }}>
            {currentPage} / {numPages}
          </span>

          <button
            onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
            disabled={currentPage >= numPages}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              border: '1px solid #1a1a2e',
              background: currentPage >= numPages ? '#0a0a15' : 'rgba(59,130,246,0.15)',
              color: currentPage >= numPages ? '#333' : '#60a5fa',
              cursor: currentPage >= numPages ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '14px',
            }}
          >
            Siguiente →
          </button>
        </div>

        {/* Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setZoom(z => Math.max(0.6, parseFloat((z - 0.1).toFixed(1))))}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: '1px solid #1a1a2e',
              background: 'rgba(255,255,255,0.03)',
              color: '#aaa',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
            }}
          >
            −
          </button>
          <span style={{ color: '#555', fontSize: '13px', minWidth: '50px', textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(2.5, parseFloat((z + 0.1).toFixed(1))))}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: '1px solid #1a1a2e',
              background: 'rgba(255,255,255,0.03)',
              color: '#aaa',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* LEYENDA */}
      <div style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '14px', height: '14px', borderRadius: '3px',
            background: 'rgba(59,130,246,0.5)',
            border: '1px solid #3b82f6',
          }} />
          <span style={{ fontSize: '12px', color: '#555' }}>Palabras clave</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: '14px', height: '14px', borderRadius: '3px',
            background: 'rgba(139,92,246,0.5)',
            border: '1px solid #8b5cf6',
          }} />
          <span style={{ fontSize: '12px', color: '#555' }}>Frases importantes</span>
        </div>
      </div>

      {/* PDF */}
      <div style={{
        background: '#1a1a1a',
        borderRadius: '16px',
        padding: '24px',
        border: '1px solid #1a1a2e',
        overflow: 'auto',
        maxHeight: '700px',
        display: 'flex',
        justifyContent: 'center',
      }}>
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div style={{
              color: '#555',
              padding: '60px 40px',
              textAlign: 'center',
              fontSize: '16px',
            }}>
              ⏳ Cargando PDF...
            </div>
          }
          error={
            <div style={{
              color: '#f87171',
              padding: '60px 40px',
              textAlign: 'center',
              fontSize: '16px',
            }}>
              ❌ No se pudo cargar el PDF
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            scale={zoom}
            customTextRenderer={textRenderer}
            renderAnnotationLayer={true}
            renderTextLayer={true}
          />
        </Document>
      </div>
    </div>
  );
}