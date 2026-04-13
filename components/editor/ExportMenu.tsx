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

  const exportPDF = async () => {
    setLoading('pdf');
    setOpen(false);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: html2canvas } = await import('html2canvas');

      // Crear contenedor temporal con todo el contenido
      const container = document.createElement('div');
      container.style.cssText = `
        width: 800px;
        padding: 60px;
        background: white;
        color: #111;
        font-family: Georgia, serif;
        font-size: 16px;
        line-height: 1.8;
        position: fixed;
        top: -9999px;
        left: -9999px;
      `;

      // Título
      const titleEl = document.createElement('h1');
      titleEl.textContent = titulo;
      titleEl.style.cssText = `
        font-size: 32px;
        font-weight: 900;
        color: ${temaColor};
        margin: 0 0 32px;
        padding-bottom: 12px;
        border-bottom: 3px solid ${temaColor};
      `;
      container.appendChild(titleEl);

      // Contenido de bloques
      bloques.forEach(bloque => {
        if (bloque.tipo === 'texto') {
          const html = htmlCache.current[bloque.id] ?? textRefs.current[bloque.id]?.innerHTML ?? (bloque as any).html ?? '';
          if (!html.trim()) return;
          const div = document.createElement('div');
          div.innerHTML = html;
          div.style.cssText = 'margin-bottom: 16px; color: #222;';

          // Estilos para los elementos internos
          div.querySelectorAll('h1').forEach((el: any) => { el.style.color = temaColor; el.style.fontSize = '28px'; });
          div.querySelectorAll('h2').forEach((el: any) => { el.style.color = '#111'; el.style.fontSize = '22px'; });
          div.querySelectorAll('h3').forEach((el: any) => { el.style.color = '#111'; el.style.fontSize = '18px'; });
          div.querySelectorAll('p, li').forEach((el: any) => { el.style.color = '#333'; });
          container.appendChild(div);
        } else if (bloque.tipo === 'imagen') {
          const img = document.createElement('img');
          img.src = (bloque as BloqueImagen).src;
          img.style.cssText = `
            max-width: 100%;
            width: ${(bloque as BloqueImagen).width}px;
            border-radius: 8px;
            display: block;
            margin: 16px auto;
          `;
          container.appendChild(img);
        }
      });

      document.body.appendChild(container);

      // Esperar a que carguen las imágenes
      const images = container.querySelectorAll('img');
      await Promise.all(Array.from(images).map(img =>
        new Promise(resolve => {
          if (img.complete) resolve(null);
          else { img.onload = resolve; img.onerror = resolve; }
        })
      ));

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });

      document.body.removeChild(container);

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const totalPages = Math.ceil(imgHeight / pageHeight);

      for (let i = 0; i < totalPages; i++) {
        if (i > 0) pdf.addPage();
        pdf.addImage(
          canvas.toDataURL('image/jpeg', 0.95),
          'JPEG',
          0,
          -(i * pageHeight),
          imgWidth,
          imgHeight
        );
      }

      pdf.save(`${titulo}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Error al exportar PDF');
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

      // Título
      children.push(
        new Paragraph({
          text: titulo,
          heading: HeadingLevel.TITLE,
          spacing: { after: 400 },
        })
      );

      // Procesar bloques
      for (const bloque of bloques) {
        if (bloque.tipo === 'texto') {
          const html = htmlCache.current[bloque.id] ?? textRefs.current[bloque.id]?.innerHTML ?? (bloque as any).html ?? '';
          if (!html.trim()) continue;

          // Parsear HTML básico
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');

          doc.body.childNodes.forEach(node => {
            const el = node as Element;
            const tagName = el.tagName?.toLowerCase();
            const text = el.textContent || '';
            if (!text.trim()) return;

            if (tagName === 'h1') {
              children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } }));
            } else if (tagName === 'h2') {
              children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
            } else if (tagName === 'h3') {
              children.push(new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 150, after: 100 } }));
            } else if (tagName === 'ul') {
              el.querySelectorAll('li').forEach(li => {
                children.push(new Paragraph({
                  text: `• ${li.textContent || ''}`,
                  spacing: { before: 60, after: 60 },
                }));
              });
            } else if (tagName === 'ol') {
              let count = 1;
              el.querySelectorAll('li').forEach(li => {
                children.push(new Paragraph({
                  text: `${count}. ${li.textContent || ''}`,
                  spacing: { before: 60, after: 60 },
                }));
                count++;
              });
            } else {
              // Párrafo con formato inline
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
                  size: 24,
                }));
              });

              if (runs.length === 0) {
                runs.push(new TextRun({ text, size: 24 }));
              }

              children.push(new Paragraph({ children: runs, spacing: { before: 80, after: 80 } }));
            }
          });

        } else if (bloque.tipo === 'imagen') {
          try {
            const src = (bloque as BloqueImagen).src;
            // Convertir imagen a buffer
            const response = await fetch(src);
            const arrayBuffer = await response.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuffer);

            const imgWidth = Math.min((bloque as BloqueImagen).width, 600);
            const scale = imgWidth / (bloque as BloqueImagen).width;

            children.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    data: uint8,
                    transformation: {
                      width: imgWidth,
                      height: Math.round(300 * scale),
                    },
                    type: 'png',
                  }),
                ],
                spacing: { before: 200, after: 200 },
              })
            );
          } catch {
            // Si falla la imagen, saltar
          }
        }
      }

      const document = new Document({
        sections: [{
          children,
          properties: {
            page: {
              margin: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
            },
          },
        }],
      });

      const buffer = await Packer.toBlob(document);
      saveAs(buffer, `${titulo}.docx`);

    } catch (err) {
      console.error(err);
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
        onMouseEnter={(e: any) => { if (!loading) { e.currentTarget.style.borderColor = temaColor; e.currentTarget.style.color = temaColor; } }}
        onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        {loading ? '⏳ Exportando...' : '📤 Exportar'}
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
          minWidth: '180px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <button
            onClick={exportPDF}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}
            onMouseEnter={(e: any) => { e.currentTarget.style.background = 'var(--red-dim)'; e.currentTarget.style.color = 'var(--red)'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          >
            <span style={{ fontSize: '18px' }}>📄</span>
            <div>
              <div style={{ fontWeight: 800 }}>Exportar PDF</div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Con imágenes y formato</div>
            </div>
          </button>

          <button
            onClick={exportWord}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}
            onMouseEnter={(e: any) => { e.currentTarget.style.background = 'var(--blue-dim)'; e.currentTarget.style.color = 'var(--blue)'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          >
            <span style={{ fontSize: '18px' }}>📝</span>
            <div>
              <div style={{ fontWeight: 800 }}>Exportar Word</div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)'  }}>Archivo .docx editable</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}