'use client';

import { useState } from 'react';
import { Bloque, BloqueImagen, Pagina } from './types';

interface Props {
  bloques: Bloque[];
  paginas?: Pagina[];
  titulo: string;
  temaColor: string;
  textRefs: React.MutableRefObject<{ [id: string]: HTMLDivElement | null }>;
  htmlCache: React.MutableRefObject<{ [id: string]: string }>;
  canvasExporters?: React.MutableRefObject<{ [paginaId: string]: () => string | null }>;
}

const dataUrlToUint8Array = (dataUrl: string): Uint8Array => {
  const base64 = dataUrl.split(',')[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
};

const fetchImageAsUint8Array = async (src: string): Promise<Uint8Array> => {
  if (src.startsWith('data:')) return dataUrlToUint8Array(src);
  const res = await fetch(src);
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
};

const imageToDataUrl = async (src: string): Promise<string | null> => {
  try {
    if (src.startsWith('data:')) return src;

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
};

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

  const paginasToUse: Pagina[] = paginas && paginas.length > 0
    ? paginas
    : [{ id: 'single', bloques, canvasData: null }];

  const getCanvasForPage = (paginaId: string): string | null => {
    try {
      if (!canvasExporters?.current) return null;
      return canvasExporters.current[paginaId]?.() || null;
    } catch {
      return null;
    }
  };

  const getHtmlBloque = (bloqueId: string, fallbackHtml?: string) => {
    return htmlCache.current[bloqueId]
      ?? textRefs.current[bloqueId]?.innerHTML
      ?? fallbackHtml
      ?? '';
  };

  const renderHtmlToPdf = (
    pdf: any,
    html: string,
    margin: number,
    maxWidth: number,
    pageHeight: number,
    yRef: { value: number },
  ) => {
    if (!html.trim()) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const ensureSpace = (needed = 10) => {
      if (yRef.value + needed > pageHeight - margin) {
        pdf.addPage();
        yRef.value = margin;
      }
    };

    const walk = (node: Node) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = (child.textContent || '').trim();
          if (!text) return;
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(11);
          pdf.setTextColor(50, 50, 50);
          const lines = pdf.splitTextToSize(text, maxWidth);
          lines.forEach((line: string) => {
            ensureSpace(6);
            pdf.text(line, margin, yRef.value);
            yRef.value += 6;
          });
          yRef.value += 2;
          return;
        }

        if (child.nodeType !== Node.ELEMENT_NODE) return;
        const el = child as Element;
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || '').trim();

        if (!text && !['br', 'hr', 'ul', 'ol'].includes(tag)) return;

        if (tag === 'h1') {
          ensureSpace(10);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(18);
          pdf.setTextColor(30, 30, 30);
          const lines = pdf.splitTextToSize(text, maxWidth);
          lines.forEach((line: string) => {
            ensureSpace(8);
            pdf.text(line, margin, yRef.value);
            yRef.value += 8;
          });
          yRef.value += 3;
        } else if (tag === 'h2') {
          ensureSpace(9);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(15);
          pdf.setTextColor(40, 40, 40);
          const lines = pdf.splitTextToSize(text, maxWidth);
          lines.forEach((line: string) => {
            ensureSpace(7);
            pdf.text(line, margin, yRef.value);
            yRef.value += 7;
          });
          yRef.value += 2;
        } else if (tag === 'h3') {
          ensureSpace(8);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(13);
          pdf.setTextColor(50, 50, 50);
          const lines = pdf.splitTextToSize(text, maxWidth);
          lines.forEach((line: string) => {
            ensureSpace(6);
            pdf.text(line, margin, yRef.value);
            yRef.value += 6;
          });
          yRef.value += 2;
        } else if (tag === 'ul' || tag === 'ol') {
          const items = el.querySelectorAll('li');
          let count = 1;
          items.forEach((li) => {
            const prefix = tag === 'ol' ? `${count}. ` : '• ';
            const liText = prefix + (li.textContent || '').trim();
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(11);
            pdf.setTextColor(50, 50, 50);
            const lines = pdf.splitTextToSize(liText, maxWidth);
            lines.forEach((line: string) => {
              ensureSpace(5.5);
              pdf.text(line, margin, yRef.value);
              yRef.value += 5.5;
            });
            yRef.value += 1;
            count++;
          });
        } else if (tag === 'hr') {
          ensureSpace(5);
          pdf.setDrawColor(200, 200, 200);
          pdf.line(margin, yRef.value, margin + maxWidth, yRef.value);
          yRef.value += 5;
        } else if (tag === 'br') {
          yRef.value += 4;
        } else {
          const childText = text;
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(11);
          pdf.setTextColor(50, 50, 50);
          const lines = pdf.splitTextToSize(childText, maxWidth);
          lines.forEach((line: string) => {
            ensureSpace(6);
            pdf.text(line, margin, yRef.value);
            yRef.value += 6;
          });
          yRef.value += 2;
        }
      });
    };

    walk(doc.body);
  };

  const addWatermarkPdf = async (pdf: any, pageWidth: number, margin: number) => {
    try {
      const logoData = await imageToDataUrl('/logo.png');
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        if (logoData) {
          try {
            pdf.addImage(logoData, 'PNG', pageWidth - margin - 10, 5, 10, 10);
          } catch {}
        }
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(200, 200, 200);
        pdf.text('JoseAnotaciones', pageWidth - margin, 19, { align: 'right' });
      }
    } catch {}
  };

  const exportPDF = async () => {
    setLoading('pdf');
    setOpen(false);

    try {
      const { default: jsPDF } = await import('jspdf');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const maxWidth = pageWidth - margin * 2;

      let firstPage = true;

      for (let pageIndex = 0; pageIndex < paginasToUse.length; pageIndex++) {
        const pagina = paginasToUse[pageIndex];

        if (!firstPage) pdf.addPage();
        firstPage = false;

        let y = margin;

        // Título
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(18);
        pdf.setTextColor(40, 40, 40);
        const tituloLines = pdf.splitTextToSize(
          pageIndex === 0 ? titulo : `${titulo} — Página ${pageIndex + 1}`,
          maxWidth,
        );
        pdf.text(tituloLines, margin, y);
        y += tituloLines.length * 8 + 4;

        pdf.setDrawColor(220, 220, 220);
        pdf.setLineWidth(0.5);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 8;

        // ✅ Fondo PDF/imagen
        if (pagina.backgroundImage) {
          try {
            const bgData = await imageToDataUrl(pagina.backgroundImage);
            if (bgData) {
              const bgW = maxWidth;
              const bgH = Math.min(110, bgW * 0.75);
              pdf.addImage(bgData, 'PNG', margin, y, bgW, bgH);
              y += bgH + 8;
            }
          } catch (err) {
            console.error('Error añadiendo fondo al PDF:', err);
          }
        }

        // Bloques de la página
        for (const bloque of pagina.bloques) {
          if (bloque.tipo === 'texto') {
            const html = getHtmlBloque(bloque.id, (bloque as any).html);
            renderHtmlToPdf(pdf, html, margin, maxWidth, pageHeight, { value: y });
            // como renderHtmlToPdf usa objeto local, recalculamos y manualmente:
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const text = (doc.body.textContent || '').trim();
            if (text) {
              const approxLines = pdf.splitTextToSize(text, maxWidth);
              y += approxLines.length * 6 + 8;
              if (y > pageHeight - margin) y = margin;
            }
          } else if (bloque.tipo === 'imagen') {
            try {
              const src = (bloque as BloqueImagen).src;
              const imgData = await imageToDataUrl(src);
              if (imgData) {
                const imgW = Math.min((bloque as BloqueImagen).width * 0.26, maxWidth);
                const imgH = imgW * 0.6;
                if (y + imgH > pageHeight - margin) {
                  pdf.addPage();
                  y = margin;
                }
                pdf.addImage(imgData, 'PNG', margin + (maxWidth - imgW) / 2, y, imgW, imgH);
                y += imgH + 8;
              }
            } catch {}
          }
        }

        // Canvas/dibujo de esa página
        const canvasData = getCanvasForPage(pagina.id);
        if (canvasData) {
          try {
            const drawW = maxWidth;
            const drawH = drawW * 0.55;
            if (y + drawH > pageHeight - margin) {
              pdf.addPage();
              y = margin;
            }
            pdf.addImage(canvasData, 'PNG', margin, y, drawW, drawH);
            y += drawH + 8;
          } catch (err) {
            console.error('Error añadiendo canvas al PDF:', err);
          }
        }
      }

      // Footer
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(180, 180, 180);
        pdf.text(`${titulo} — ${i}/${totalPages}`, margin, pageHeight - 8);
      }

      await addWatermarkPdf(pdf, pageWidth, margin);
      pdf.save(`${titulo}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Error exporting PDF');
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

      const saveAs = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      const children: any[] = [];

      children.push(new Paragraph({
        text: titulo,
        heading: HeadingLevel.TITLE,
        spacing: { after: 400 },
      }));

      for (let pageIndex = 0; pageIndex < paginasToUse.length; pageIndex++) {
        const pagina = paginasToUse[pageIndex];

        children.push(new Paragraph({
          text: `Página ${pageIndex + 1}`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 120 },
        }));

        // ✅ Fondo PDF/imagen
        if (pagina.backgroundImage) {
          try {
            const bgBytes = await fetchImageAsUint8Array(pagina.backgroundImage);
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: bgBytes,
                  transformation: { width: 520, height: 380 },
                  type: 'png',
                } as any),
              ],
              spacing: { before: 80, after: 160 },
            }));
          } catch (err) {
            console.error('Error añadiendo fondo al Word:', err);
          }
        }

        // Bloques
        for (const bloque of pagina.bloques) {
          if (bloque.tipo === 'texto') {
            const html = getHtmlBloque(bloque.id, (bloque as any).html);
            if (!html.trim()) continue;

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            doc.body.childNodes.forEach((node) => {
              const el = node as Element;
              const tagName = el.tagName?.toLowerCase();
              const text = el.textContent || '';
              if (!text.trim() && !['hr', 'br'].includes(tagName)) return;

              if (tagName === 'h1') {
                children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 120 } }));
              } else if (tagName === 'h2') {
                children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 150, after: 100 } }));
              } else if (tagName === 'h3') {
                children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 120, after: 80 } }));
              } else if (tagName === 'ul') {
                el.querySelectorAll('li').forEach((li) => {
                  children.push(new Paragraph({
                    children: [new TextRun({ text: '• ' + (li.textContent || ''), size: 22, color: '333333' })],
                    spacing: { before: 60, after: 60 },
                  }));
                });
              } else if (tagName === 'ol') {
                let count = 1;
                el.querySelectorAll('li').forEach((li) => {
                  children.push(new Paragraph({
                    children: [new TextRun({ text: `${count}. ${li.textContent || ''}`, size: 22, color: '333333' })],
                    spacing: { before: 60, after: 60 },
                  }));
                  count++;
                });
              } else {
                children.push(new Paragraph({
                  children: [new TextRun({ text, size: 22, color: '333333' })],
                  spacing: { before: 80, after: 80 },
                }));
              }
            });
          } else if (bloque.tipo === 'imagen') {
            try {
              const src = (bloque as BloqueImagen).src;
              const imgBytes = await fetchImageAsUint8Array(src);
              const imgWidth = Math.min((bloque as BloqueImagen).width, 500);
              const scale = imgWidth / (bloque as BloqueImagen).width;
              children.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    data: imgBytes,
                    transformation: { width: imgWidth, height: Math.round(300 * scale) },
                    type: 'png',
                  } as any),
                ],
                spacing: { before: 100, after: 180 },
              }));
            } catch (e) {
              console.error('Error adding image to Word:', e);
            }
          }
        }

        // Canvas/dibujo
        const canvasData = getCanvasForPage(pagina.id);
        if (canvasData) {
          try {
            const bytes = dataUrlToUint8Array(canvasData);
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: bytes,
                  transformation: { width: 520, height: 340 },
                  type: 'png',
                } as any),
              ],
              spacing: { before: 100, after: 200 },
            }));
          } catch (err) {
            console.error('Error adding canvas to Word:', err);
          }
        }
      }

      // Marca de agua simple
      children.push(new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'JoseAnotaciones', size: 14, color: 'CCCCCC', italics: true })],
        spacing: { before: 300 },
      }));

      const docxDoc = new Document({
        sections: [{
          children,
          properties: {
            page: {
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
        }],
      });

      const blob = await Packer.toBlob(docxDoc);
      saveAs(blob, `${titulo}.docx`);
    } catch (err) {
      console.error(err);
      alert('Error exporting Word');
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
        {loading ? '⏳ Exporting...' : '📤 Export'}
        {!loading && <span style={{ fontSize: '10px' }}>▼</span>}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '8px',
          background: 'var(--bg-card)',
          border: `2px solid ${temaColor}`,
          borderRadius: '14px',
          padding: '8px',
          zIndex: 9999,
          minWidth: '210px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
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
              <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Text + fondo + drawings</div>
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
              <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Text + fondo + drawings</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}