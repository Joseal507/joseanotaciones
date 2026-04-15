'use client';

import { useState } from 'react';
import { Bloque, BloqueImagen } from './types';

interface Props {
  bloques: Bloque[];
  titulo: string;
  temaColor: string;
  textRefs: React.MutableRefObject<{ [id: string]: HTMLDivElement | null }>;
  htmlCache: React.MutableRefObject<{ [id: string]: string }>;
}

export default function ExportMenu({ bloques, titulo, temaColor, textRefs, htmlCache }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<'pdf' | 'word' | null>(null);

  // Extraer texto plano de los bloques
  const getPlainText = (): string => {
    const lines: string[] = [];
    bloques.forEach(bloque => {
      if (bloque.tipo === 'texto') {
        const html = htmlCache.current[bloque.id] ?? textRefs.current[bloque.id]?.innerHTML ?? (bloque as any).html ?? '';
        if (!html.trim()) return;
        // Convertir HTML a texto plano manteniendo estructura
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const extractText = (node: Node): string => {
          let text = '';
          node.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
              text += child.textContent || '';
            } else if (child.nodeType === Node.ELEMENT_NODE) {
              const el = child as Element;
              const tag = el.tagName.toLowerCase();
              if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
                text += '\n\n' + (child.textContent || '') + '\n\n';
              } else if (tag === 'br') {
                text += '\n';
              } else if (tag === 'li') {
                text += '• ' + (child.textContent || '') + '\n';
              } else if (['p', 'div'].includes(tag)) {
                text += '\n' + extractText(child) + '\n';
              } else {
                text += extractText(child);
              }
            }
          });
          return text;
        };
        lines.push(extractText(doc.body));
      }
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  const exportPDF = async () => {
    setLoading('pdf');
    setOpen(false);
    try {
      const { default: jsPDF } = await import('jspdf');

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const maxWidth = pageWidth - margin * 2;
      let y = margin;

      // Título
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.setTextColor(40, 40, 40);
      const tituloLines = pdf.splitTextToSize(titulo, maxWidth);
      pdf.text(tituloLines, margin, y);
      y += tituloLines.length * 10 + 5;

      // Línea decorativa
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.5);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 10;

      // Contenido
      bloques.forEach(bloque => {
        if (bloque.tipo === 'texto') {
          const html = htmlCache.current[bloque.id] ?? textRefs.current[bloque.id]?.innerHTML ?? (bloque as any).html ?? '';
          if (!html.trim()) return;

          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          const processNode = (node: Node) => {
            node.childNodes.forEach(child => {
              if (child.nodeType === Node.TEXT_NODE) {
                const text = (child.textContent || '').trim();
                if (!text) return;

                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(11);
                pdf.setTextColor(50, 50, 50);
                const lines = pdf.splitTextToSize(text, maxWidth);

                lines.forEach((line: string) => {
                  if (y > pageHeight - margin) {
                    pdf.addPage();
                    y = margin;
                  }
                  pdf.text(line, margin, y);
                  y += 6;
                });
                y += 2;

              } else if (child.nodeType === Node.ELEMENT_NODE) {
                const el = child as Element;
                const tag = el.tagName.toLowerCase();
                const text = (el.textContent || '').trim();
                if (!text && !['br', 'hr', 'img'].includes(tag)) return;

                if (tag === 'h1') {
                  y += 4;
                  if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                  pdf.setFont('helvetica', 'bold');
                  pdf.setFontSize(18);
                  pdf.setTextColor(30, 30, 30);
                  const lines = pdf.splitTextToSize(text, maxWidth);
                  lines.forEach((line: string) => {
                    if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                    pdf.text(line, margin, y);
                    y += 8;
                  });
                  y += 3;
                } else if (tag === 'h2') {
                  y += 3;
                  if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                  pdf.setFont('helvetica', 'bold');
                  pdf.setFontSize(15);
                  pdf.setTextColor(40, 40, 40);
                  const lines = pdf.splitTextToSize(text, maxWidth);
                  lines.forEach((line: string) => {
                    if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                    pdf.text(line, margin, y);
                    y += 7;
                  });
                  y += 2;
                } else if (tag === 'h3') {
                  y += 2;
                  if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                  pdf.setFont('helvetica', 'bold');
                  pdf.setFontSize(13);
                  pdf.setTextColor(50, 50, 50);
                  const lines = pdf.splitTextToSize(text, maxWidth);
                  lines.forEach((line: string) => {
                    if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                    pdf.text(line, margin, y);
                    y += 6;
                  });
                  y += 2;
                } else if (tag === 'li') {
                  if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                  pdf.setFont('helvetica', 'normal');
                  pdf.setFontSize(11);
                  pdf.setTextColor(50, 50, 50);
                  const bulletText = '  •  ' + text;
                  const lines = pdf.splitTextToSize(bulletText, maxWidth - 5);
                  lines.forEach((line: string) => {
                    if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                    pdf.text(line, margin, y);
                    y += 5.5;
                  });
                  y += 1;
                } else if (tag === 'hr') {
                  y += 3;
                  if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                  pdf.setDrawColor(200, 200, 200);
                  pdf.line(margin, y, pageWidth - margin, y);
                  y += 5;
                } else if (tag === 'br') {
                  y += 4;
                } else if (['b', 'strong'].includes(tag)) {
                  if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                  pdf.setFont('helvetica', 'bold');
                  pdf.setFontSize(11);
                  pdf.setTextColor(30, 30, 30);
                  const lines = pdf.splitTextToSize(text, maxWidth);
                  lines.forEach((line: string) => {
                    if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                    pdf.text(line, margin, y);
                    y += 6;
                  });
                  pdf.setFont('helvetica', 'normal');
                } else if (['ul', 'ol'].includes(tag)) {
                  processNode(el);
                } else if (['p', 'div', 'span'].includes(tag)) {
                  // Procesar hijos para mantener formato inline
                  const childText = (el.textContent || '').trim();
                  if (childText) {
                    if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                    pdf.setFont('helvetica', 'normal');
                    pdf.setFontSize(11);
                    pdf.setTextColor(50, 50, 50);
                    const lines = pdf.splitTextToSize(childText, maxWidth);
                    lines.forEach((line: string) => {
                      if (y > pageHeight - margin) { pdf.addPage(); y = margin; }
                      pdf.text(line, margin, y);
                      y += 6;
                    });
                    y += 2;
                  }
                } else {
                  processNode(el);
                }
              }
            });
          };

          processNode(doc.body);
          y += 3;
        } else if (bloque.tipo === 'imagen') {
          // Intentar añadir imagen al PDF
          try {
            const imgSrc = (bloque as BloqueImagen).src;
            if (imgSrc.startsWith('data:')) {
              const imgWidth = Math.min((bloque as BloqueImagen).width * 0.26, maxWidth);
              const imgHeight = imgWidth * 0.6;

              if (y + imgHeight > pageHeight - margin) {
                pdf.addPage();
                y = margin;
              }

              const x = margin + (maxWidth - imgWidth) / 2;
              pdf.addImage(imgSrc, 'PNG', x, y, imgWidth, imgHeight);
              y += imgHeight + 8;
            }
          } catch {}
        }
      });

      // Footer en cada página
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(180, 180, 180);
        pdf.text(`${titulo} — ${i}/${totalPages}`, margin, pageHeight - 8);
      }

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
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType } = await import('docx');
      const { saveAs } = await import('file-saver');

      const children: any[] = [];

      children.push(
        new Paragraph({
          text: titulo,
          heading: HeadingLevel.TITLE,
          spacing: { after: 400 },
        })
      );

      for (const bloque of bloques) {
        if (bloque.tipo === 'texto') {
          const html = htmlCache.current[bloque.id] ?? textRefs.current[bloque.id]?.innerHTML ?? (bloque as any).html ?? '';
          if (!html.trim()) continue;

          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          doc.body.childNodes.forEach(node => {
            const el = node as Element;
            const tagName = el.tagName?.toLowerCase();
            const text = el.textContent || '';
            if (!text.trim() && !['hr', 'br'].includes(tagName)) return;

            if (tagName === 'h1') {
              children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } }));
            } else if (tagName === 'h2') {
              children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
            } else if (tagName === 'h3') {
              children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 150, after: 100 } }));
            } else if (tagName === 'ul') {
              el.querySelectorAll('li').forEach(li => {
                children.push(new Paragraph({
                  children: [new TextRun({ text: '• ' + (li.textContent || ''), size: 22, color: '333333' })],
                  spacing: { before: 60, after: 60 },
                }));
              });
            } else if (tagName === 'ol') {
              let count = 1;
              el.querySelectorAll('li').forEach(li => {
                children.push(new Paragraph({
                  children: [new TextRun({ text: `${count}. ${li.textContent || ''}`, size: 22, color: '333333' })],
                  spacing: { before: 60, after: 60 },
                }));
                count++;
              });
            } else {
              const runs: any[] = [];
              el.childNodes.forEach(child => {
                const childEl = child as Element;
                const childTag = childEl.tagName?.toLowerCase();
                const childText = child.textContent || '';
                if (!childText) return;

                runs.push(new TextRun({
                  text: childText,
                  bold: childTag === 'b' || childTag === 'strong',
                  italics: childTag === 'i' || childTag === 'em',
                  underline: childTag === 'u' ? {} : undefined,
                  strike: childTag === 's',
                  size: 22,
                  color: '333333',
                }));
              });

              if (runs.length === 0) {
                runs.push(new TextRun({ text, size: 22, color: '333333' }));
              }

              children.push(new Paragraph({ children: runs, spacing: { before: 80, after: 80 } }));
            }
          });

        } else if (bloque.tipo === 'imagen') {
          try {
            const src = (bloque as BloqueImagen).src;
            if (src.startsWith('data:')) {
              const base64Data = src.split(',')[1];
              const binaryString = atob(base64Data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }

              const imgWidth = Math.min((bloque as BloqueImagen).width, 500);
              const scale = imgWidth / (bloque as BloqueImagen).width;

              children.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new ImageRun({
                      data: bytes,
                      transformation: { width: imgWidth, height: Math.round(300 * scale) },
                      type: 'png',
                    }),
                  ],
                  spacing: { before: 200, after: 200 },
                })
              );
            }
          } catch {}
        }
      }

      const document = new Document({
        sections: [{
          children,
          properties: {
            page: {
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
        }],
      });

      const buffer = await Packer.toBlob(document);
      saveAs(buffer, `${titulo}.docx`);

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
          padding: '9px 18px', borderRadius: '10px',
          border: '2px solid var(--border-color)',
          background: 'transparent', color: 'var(--text-muted)',
          fontSize: '13px', fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: '6px',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e: any) => { if (!loading) { e.currentTarget.style.borderColor = temaColor; e.currentTarget.style.color = temaColor; } }}
        onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        {loading ? '⏳ Exporting...' : '📤 Export'}
        {!loading && <span style={{ fontSize: '10px' }}>▼</span>}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '8px',
          background: 'var(--bg-card)', border: `2px solid ${temaColor}`,
          borderRadius: '14px', padding: '8px', zIndex: 9999,
          minWidth: '180px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <button onClick={exportPDF}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}
            onMouseEnter={(e: any) => { e.currentTarget.style.background = 'var(--red-dim)'; e.currentTarget.style.color = 'var(--red)'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          >
            <span style={{ fontSize: '18px' }}>📄</span>
            <div>
              <div style={{ fontWeight: 800 }}>Export PDF</div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>With real text (analyzable)</div>
            </div>
          </button>

          <button onClick={exportWord}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}
            onMouseEnter={(e: any) => { e.currentTarget.style.background = 'var(--blue-dim)'; e.currentTarget.style.color = 'var(--blue)'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          >
            <span style={{ fontSize: '18px' }}>📝</span>
            <div>
              <div style={{ fontWeight: 800 }}>Export Word</div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Editable .docx file</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}