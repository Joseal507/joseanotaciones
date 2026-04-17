'use client';

import { useState } from 'react';
import { Bloque, Pagina } from './types';

interface Props {
  bloques: Bloque[];
  paginas?: Pagina[];
  titulo: string;
  temaColor: string;
  textRefs: React.MutableRefObject<{ [id: string]: HTMLDivElement | null }>;
  htmlCache: React.MutableRefObject<{ [id: string]: string }>;
  canvasExporters?: React.MutableRefObject<{ [paginaId: string]: () => string | null }>;
}

export default function ExportMenu({
  bloques,
  paginas,
  titulo,
  temaColor,
  textRefs,
  htmlCache,
  canvasExporters,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<'pdf' | 'word' | null>(null);

  // ✅ Capturar cada página del editor como imagen usando html2canvas
  const capturarPaginas = async (): Promise<string[]> => {
  const html2canvas = (await import('html2canvas')).default;
  const paginaElements = document.querySelectorAll('.editor-area-principal');
  const imagenes: string[] = [];

  for (let i = 0; i < paginaElements.length; i++) {
    const el = paginaElements[i] as HTMLElement;

    // Guardar scroll actual
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Scroll al elemento para que esté visible
    el.scrollIntoView({ block: 'start' });
    await new Promise(r => setTimeout(r, 100));

    try {
      const rect = el.getBoundingClientRect();

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: el.scrollWidth,
        height: el.scrollHeight,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
        ignoreElements: (element) => {
          // Ignorar botones de undo/redo y contadores
          if (element.tagName === 'BUTTON') return true;
          if (element.tagName === 'STYLE') return true;
          // Ignorar el número de página
          const text = element.textContent || '';
          if (text.match(/^\d+ \/ \d+$/)) return true;
          return false;
        },
      });

      imagenes.push(canvas.toDataURL('image/png'));
    } catch (err) {
      console.error(`Error capturando página ${i + 1}:`, err);
    }

    // Restaurar scroll
    window.scrollTo(scrollX, scrollY);
  }

  return imagenes;
};

  const addWatermark = async (pdf: any, pageWidth: number, pageHeight: number, margin: number) => {
    try {
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        // Texto marca de agua
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(200, 200, 200);
        pdf.text('JoseAnotaciones', pageWidth - margin, 10, { align: 'right' });
        // Footer
        pdf.setFontSize(8);
        pdf.setTextColor(180, 180, 180);
        pdf.text(`${titulo} — ${i}/${totalPages}`, margin, pageHeight - 8);
      }
    } catch {}
  };

  const exportPDF = async () => {
    setLoading('pdf');
    setOpen(false);

    try {
      const { default: jsPDF } = await import('jspdf');
      const imagenes = await capturarPaginas();

      if (imagenes.length === 0) {
        alert('No se pudo capturar ninguna página');
        setLoading(null);
        return;
      }

      // Crear PDF con la proporción de la primera imagen
      const firstImg = await new Promise<HTMLImageElement>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = imagenes[0];
      });

      const imgRatio = firstImg.naturalWidth / firstImg.naturalHeight;
      const isLandscape = imgRatio > 1;

      const pdf = new jsPDF(isLandscape ? 'l' : 'p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;

      for (let i = 0; i < imagenes.length; i++) {
        if (i > 0) pdf.addPage();

        const imgData = imagenes[i];

        // Calcular dimensiones para que quepa en la página
        const maxW = pageWidth - margin * 2;
        const maxH = pageHeight - margin * 2 - 10; // espacio para watermark

        let drawW = maxW;
        let drawH = drawW / imgRatio;

        if (drawH > maxH) {
          drawH = maxH;
          drawW = drawH * imgRatio;
        }

        const x = margin + (maxW - drawW) / 2;
        const y = margin + 5;

        pdf.addImage(imgData, 'PNG', x, y, drawW, drawH);
      }

      await addWatermark(pdf, pageWidth, pageHeight, margin);
      pdf.save(`${titulo}.pdf`);
    } catch (err) {
      console.error('Error exportando PDF:', err);
      alert('Error al exportar PDF');
    } finally {
      setLoading(null);
    }
  };

  const exportWord = async () => {
    setLoading('word');
    setOpen(false);

    try {
      const {
        Document,
        Packer,
        Paragraph,
        TextRun,
        HeadingLevel,
        ImageRun,
        AlignmentType,
      } = await import('docx');

      const imagenes = await capturarPaginas();

      if (imagenes.length === 0) {
        alert('No se pudo capturar ninguna página');
        setLoading(null);
        return;
      }

      const children: any[] = [];

      // Título
      children.push(
        new Paragraph({
          text: titulo,
          heading: HeadingLevel.TITLE,
          spacing: { after: 300 },
        }),
      );

      // Cada página como imagen
      for (let i = 0; i < imagenes.length; i++) {
        try {
          const base64 = imagenes[i].split(',')[1];
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }

          // Obtener dimensiones reales
          const img = await new Promise<HTMLImageElement>((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.src = imagenes[i];
          });

          const ratio = img.naturalWidth / img.naturalHeight;
          const maxWidth = 600;
          const width = maxWidth;
          const height = Math.round(width / ratio);

          if (i > 0) {
            // Separador entre páginas
            children.push(
              new Paragraph({
                children: [new TextRun({ text: '', size: 2 })],
                spacing: { before: 100 },
              }),
            );
          }

          children.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: bytes,
                  transformation: { width, height },
                  type: 'png',
                } as any),
              ],
              spacing: { before: 100, after: 200 },
            }),
          );
        } catch (err) {
          console.error(`Error añadiendo página ${i + 1} al Word:`, err);
        }
      }

      // Marca de agua
      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({
              text: 'JoseAnotaciones',
              size: 14,
              color: 'CCCCCC',
              italics: true,
            }),
          ],
          spacing: { before: 300 },
        }),
      );

      const docxDoc = new Document({
        sections: [
          {
            children,
            properties: {
              page: {
                margin: {
                  top: 720,
                  right: 720,
                  bottom: 720,
                  left: 720,
                },
              },
            },
          },
        ],
      });

      const blob = await Packer.toBlob(docxDoc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${titulo}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exportando Word:', err);
      alert('Error al exportar Word');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={!!loading}
        style={{
          padding: '9px 18px',
          borderRadius: '10px',
          border: '2px solid var(--border-color)',
          background: 'transparent',
          color: 'var(--text-muted)',
          fontSize: '13px',
          fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e: any) => {
          if (!loading) {
            e.currentTarget.style.borderColor = temaColor;
            e.currentTarget.style.color = temaColor;
          }
        }}
        onMouseLeave={(e: any) => {
          e.currentTarget.style.borderColor = 'var(--border-color)';
          e.currentTarget.style.color = 'var(--text-muted)';
        }}
      >
        {loading ? '⏳ Exportando...' : '📤 Export'}
        {!loading && <span style={{ fontSize: '10px' }}>▼</span>}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '8px',
            background: 'var(--bg-card)',
            border: `2px solid ${temaColor}`,
            borderRadius: '14px',
            padding: '8px',
            zIndex: 9999,
            minWidth: '220px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          <button
            onClick={exportPDF}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              textAlign: 'left',
            }}
            onMouseEnter={(e: any) => {
              e.currentTarget.style.background = 'var(--red-dim)';
              e.currentTarget.style.color = 'var(--red)';
            }}
            onMouseLeave={(e: any) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
          >
            <span style={{ fontSize: '18px' }}>📄</span>
            <div>
              <div style={{ fontWeight: 800 }}>Export PDF</div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                Exactamente como se ve
              </div>
            </div>
          </button>

          <button
            onClick={exportWord}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              textAlign: 'left',
            }}
            onMouseEnter={(e: any) => {
              e.currentTarget.style.background = 'var(--blue-dim)';
              e.currentTarget.style.color = 'var(--blue)';
            }}
            onMouseLeave={(e: any) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
          >
            <span style={{ fontSize: '18px' }}>📝</span>
            <div>
              <div style={{ fontWeight: 800 }}>Export Word</div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                Exactamente como se ve
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}