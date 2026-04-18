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

  // ✅ Capturar páginas combinando múltiples estrategias
  const capturarPaginas = async (): Promise<string[]> => {
    const imagenes: string[] = [];
    const paginaElements = document.querySelectorAll('.editor-area-principal');

    if (paginaElements.length === 0) {
      console.warn('No se encontraron elementos .editor-area-principal');
      return [];
    }

    // Intentar con html2canvas primero
    let html2canvasMod: any = null;
    try {
      html2canvasMod = (await import('html2canvas')).default;
    } catch (err) {
      console.error('No se pudo cargar html2canvas:', err);
    }

    for (let i = 0; i < paginaElements.length; i++) {
      const el = paginaElements[i] as HTMLElement;
      let captured = false;

      // ═══ Estrategia 1: Composición manual (canvas + html2canvas del contenido) ═══
      try {
        const paginaId = paginas?.[i]?.id;
        const canvasData = paginaId && canvasExporters?.current[paginaId]?.();
        const bgImage = paginas?.[i]?.backgroundImage;

        // Obtener dimensiones reales del elemento
        const elW = el.scrollWidth || el.clientWidth || 1000;
        const elH = el.scrollHeight || el.clientHeight || 900;
        const scale = 2;

        // Crear canvas de composición
        const compCanvas = document.createElement('canvas');
        compCanvas.width = elW * scale;
        compCanvas.height = elH * scale;
        const compCtx = compCanvas.getContext('2d')!;
        compCtx.scale(scale, scale);

        // 1) Fondo blanco
        compCtx.fillStyle = '#ffffff';
        compCtx.fillRect(0, 0, elW, elH);

        // 2) Fondo imagen/PDF si existe
        if (bgImage) {
          try {
            const bgImg = await loadImage(bgImage);
            const bgRatio = bgImg.naturalWidth / bgImg.naturalHeight;
            const elRatio = elW / elH;
            let drawW = elW;
            let drawH = elH;
            let drawX = 0;
            let drawY = 0;

            if (bgRatio > elRatio) {
              drawH = elW / bgRatio;
            } else {
              drawW = elH * bgRatio;
              drawX = (elW - drawW) / 2;
            }

            compCtx.globalAlpha = 0.92;
            compCtx.drawImage(bgImg, drawX, drawY, drawW, drawH);
            compCtx.globalAlpha = 1;
          } catch {}
        }

        // 3) Canvas de dibujo (strokes)
        if (canvasData) {
          try {
            const strokeImg = await loadImage(canvasData);
            compCtx.drawImage(strokeImg, 0, 0, elW, elH);
          } catch {}
        }

        // 4) Capturar bloques de texto/imágenes con html2canvas
        if (html2canvasMod) {
          // Buscar el div de bloques (zIndex 10)
          const blockLayer = el.querySelector('[style*="z-index: 10"], [style*="zIndex"]') as HTMLElement;

          if (blockLayer && blockLayer.children.length > 0) {
            try {
              const blockCanvas = await html2canvasMod(blockLayer, {
                scale: scale,
                useCORS: true,
                allowTaint: true,
                backgroundColor: null, // transparente
                logging: false,
                width: elW,
                height: elH,
                x: 0,
                y: 0,
                scrollX: 0,
                scrollY: 0,
                ignoreElements: (element: Element) => {
                  if (element.tagName === 'BUTTON') return true;
                  if (element.tagName === 'STYLE') return true;
                  return false;
                },
              });

              compCtx.drawImage(blockCanvas, 0, 0, elW, elH);
            } catch (err) {
              console.warn('Error capturando bloques:', err);
            }
          }
        }

        imagenes.push(compCanvas.toDataURL('image/png'));
        captured = true;
      } catch (err) {
        console.warn(`Composición manual falló para página ${i + 1}:`, err);
      }

      // ═══ Estrategia 2: html2canvas directo como fallback ═══
      if (!captured && html2canvasMod) {
        try {
          // Guardar posición
          const scrollX = window.scrollX;
          const scrollY = window.scrollY;

          el.scrollIntoView({ block: 'start' });
          await sleep(150);

          const canvas = await html2canvasMod(el, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            logging: false,
            width: el.scrollWidth,
            height: el.scrollHeight,
            x: 0,
            y: 0,
            scrollX: -window.scrollX,
            scrollY: -window.scrollY,
            ignoreElements: (element: Element) => {
              if (element.tagName === 'BUTTON') return true;
              if (element.tagName === 'STYLE') return true;
              const text = element.textContent || '';
              if (text.match(/^\d+ \/ \d+$/)) return true;
              return false;
            },
          });

          imagenes.push(canvas.toDataURL('image/png'));
          captured = true;

          // Restaurar
          window.scrollTo(scrollX, scrollY);
        } catch (err) {
          console.error(`html2canvas falló para página ${i + 1}:`, err);
        }
      }

      // ═══ Estrategia 3: Solo canvas de dibujo ═══
      if (!captured) {
        const paginaId = paginas?.[i]?.id;
        const canvasData = paginaId && canvasExporters?.current[paginaId]?.();

        if (canvasData) {
          imagenes.push(canvasData);
        } else {
          // Página vacía — crear imagen blanca
          const emptyCanvas = document.createElement('canvas');
          emptyCanvas.width = 1000;
          emptyCanvas.height = 900;
          const emptyCtx = emptyCanvas.getContext('2d')!;
          emptyCtx.fillStyle = '#ffffff';
          emptyCtx.fillRect(0, 0, 1000, 900);
          emptyCtx.fillStyle = '#d1d5db';
          emptyCtx.font = '16px system-ui';
          emptyCtx.textAlign = 'center';
          emptyCtx.fillText(`Página ${i + 1} (vacía)`, 500, 450);
          imagenes.push(emptyCanvas.toDataURL('image/png'));
        }
      }
    }

    return imagenes;
  };

  const addWatermark = async (pdf: any, pageWidth: number, pageHeight: number, margin: number) => {
  try {
    // ✅ Cargar logo
    let logoData: string | null = null;
    try {
      const logoImg = await loadImage('/logo.png');
      const c = document.createElement('canvas');
      c.width = logoImg.naturalWidth;
      c.height = logoImg.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(logoImg, 0, 0);
      logoData = c.toDataURL('image/png');
    } catch {}

    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);

      // ✅ Logo chiquito arriba a la derecha
      if (logoData) {
        const logoSize = 12;
        pdf.addImage(logoData, 'PNG', pageWidth - margin - logoSize, 4, logoSize, logoSize);
      }

      // Footer con número de página
      pdf.setFont('helvetica', 'normal');
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
        alert('No se pudo capturar ninguna página. Intenta guardar primero.');
        setLoading(null);
        return;
      }

      const firstImg = await loadImage(imagenes[0]);
      const imgRatio = firstImg.naturalWidth / firstImg.naturalHeight;
      const isLandscape = imgRatio > 1;

      const pdf = new jsPDF(isLandscape ? 'l' : 'p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;

      for (let i = 0; i < imagenes.length; i++) {
        if (i > 0) pdf.addPage();

        const imgData = imagenes[i];
        const img = await loadImage(imgData);
        const ratio = img.naturalWidth / img.naturalHeight;

        const maxW = pageWidth - margin * 2;
        const maxH = pageHeight - margin * 2 - 10;

        let drawW = maxW;
        let drawH = drawW / ratio;

        if (drawH > maxH) {
          drawH = maxH;
          drawW = drawH * ratio;
        }

        const x = margin + (maxW - drawW) / 2;
        const y = margin + 5;

        pdf.addImage(imgData, 'PNG', x, y, drawW, drawH);
      }

      await addWatermark(pdf, pageWidth, pageHeight, margin);
      pdf.save(`${titulo}.pdf`);
    } catch (err) {
      console.error('Error exportando PDF:', err);
      alert('Error al exportar PDF. Verifica la consola para más detalles.');
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
        alert('No se pudo capturar ninguna página. Intenta guardar primero.');
        setLoading(null);
        return;
      }

      const children: any[] = [];

      children.push(
        new Paragraph({
          text: titulo,
          heading: HeadingLevel.TITLE,
          spacing: { after: 300 },
        }),
      );

      for (let i = 0; i < imagenes.length; i++) {
        try {
          const base64 = imagenes[i].split(',')[1];
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }

          const img = await loadImage(imagenes[i]);
          const ratio = img.naturalWidth / img.naturalHeight;
          const maxWidth = 600;
          const width = maxWidth;
          const height = Math.round(width / ratio);

          if (i > 0) {
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
                margin: { top: 720, right: 720, bottom: 720, left: 720 },
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
      alert('Error al exportar Word. Verifica la consola.');
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
        {loading ? (
          <>
            <div
              style={{
                width: '12px',
                height: '12px',
                border: '2px solid var(--text-muted)',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            Exportando...
          </>
        ) : (
          <>📤 Export <span style={{ fontSize: '10px' }}>▼</span></>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9998,
            }}
          />
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
                e.currentTarget.style.background = `${temaColor}15`;
                e.currentTarget.style.color = temaColor;
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
                e.currentTarget.style.background = `${temaColor}15`;
                e.currentTarget.style.color = temaColor;
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
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}