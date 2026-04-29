'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Pagina, BloqueTexto, BloqueImagen } from './types';

interface Props {
  bloques: any[];
  paginas?: Pagina[];
  titulo: string;
  temaColor: string;
  paperColor?: 'white' | 'dark' | 'yellow';
  textRefs: React.MutableRefObject<{ [id: string]: HTMLDivElement | null }>;
  htmlCache: React.MutableRefObject<{ [id: string]: string }>;
  canvasExporters?: React.MutableRefObject<{ [paginaId: string]: () => string | null }>;
}

function dibujarPaperBackground(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  paperStyle: string,
  paperColor: string,
) {
  const palette = {
    white:  { lineColor: '#e5e7eb', redLine: '#fca5a5', dotColor: '#cbd5e1' },
    dark:   { lineColor: 'rgba(255,255,255,0.10)', redLine: 'rgba(255,120,120,0.35)', dotColor: 'rgba(255,255,255,0.18)' },
    yellow: { lineColor: '#ded4a6', redLine: '#e69a9a', dotColor: '#cbbf8f' },
  }[paperColor as 'white' | 'dark' | 'yellow'] || { lineColor: '#e5e7eb', redLine: '#fca5a5', dotColor: '#cbd5e1' };

  if (paperStyle === 'lined') {
    const lineH = 28;
    ctx.strokeStyle = palette.lineColor;
    ctx.lineWidth = 0.7;
    for (let y = lineH; y < h; y += lineH) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.strokeStyle = palette.redLine;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(56, 0); ctx.lineTo(56, h); ctx.stroke();
  }
  if (paperStyle === 'grid') {
    const cell = 24;
    ctx.strokeStyle = palette.lineColor;
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += cell) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += cell) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }
  if (paperStyle === 'dotted') {
    const cell = 24;
    ctx.fillStyle = palette.dotColor;
    for (let x = cell / 2; x < w; x += cell) {
      for (let y = cell / 2; y < h; y += cell) {
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}



// Renderizar un contentEditable div directamente en canvas
// Primero highlights, luego texto — nunca se solapan
function renderContentDiv(
  ctx: CanvasRenderingContext2D,
  div: HTMLElement,
  editorRect: DOMRect,
) {
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  const items: { text: string; x: number; y: number; w: number; h: number; font: string; color: string; bg: string | null }[] = [];

  // Recorrer todos los nodos de texto y extraer su geometría real
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    if (!text.trim() && !text.includes(' ')) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();

    const parent = node.parentElement;
    if (!parent) continue;
    const style = window.getComputedStyle(parent);
    const font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) || 16}px ${style.fontFamily || 'Georgia, serif'}`.trim();
    const color = style.color || '#1f2937';

    // Detectar highlight background
    let bg: string | null = null;
    let el: HTMLElement | null = parent;
    while (el && el !== div) {
      const elBg = window.getComputedStyle(el).backgroundColor;
      if (elBg && elBg !== 'transparent' && elBg !== 'rgba(0, 0, 0, 0)') {
        bg = elBg;
        break;
      }
      el = el.parentElement;
    }

    for (const rect of Array.from(rects)) {
      if (rect.width < 1 || rect.height < 1) continue;
      const rx = rect.left - editorRect.left;
      const ry = rect.top - editorRect.top;

      // Extraer texto de este rect específico
      // Para rects múltiples (line wrap), dividir el texto
      items.push({
        text,
        x: rx,
        y: ry,
        w: rect.width,
        h: rect.height,
        font,
        color,
        bg,
      });
      break; // Solo usar el primer rect para este nodo de texto
    }
  }

  // PASO 1: Dibujar todos los highlights PRIMERO
  for (const item of items) {
    if (item.bg) {
      ctx.fillStyle = item.bg;
      ctx.fillRect(item.x, item.y, item.w, item.h);
    }
  }

  // PASO 2: Dibujar todo el texto ENCIMA
  for (const item of items) {
    ctx.font = item.font;
    ctx.fillStyle = item.color;
    ctx.textBaseline = 'top';
    // Ajustar Y para centrar verticalmente en el rect
    const metrics = ctx.measureText(item.text);
    const textH = metrics.actualBoundingBoxDescent + metrics.actualBoundingBoxAscent;
    const offsetY = Math.max(0, (item.h - textH) / 2);
    ctx.fillText(item.text, item.x, item.y + offsetY, item.w + 2);
  }
}

export default function ExportMenu({
  bloques, paginas, titulo, temaColor, paperColor = 'white',
  textRefs, htmlCache, canvasExporters,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<'pdf' | 'word' | 'preview' | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const capturarPaginas = async (): Promise<string[]> => {
    const imagenes: string[] = [];
    const paginaElements = document.querySelectorAll('.editor-area-principal');
    if (paginaElements.length === 0) return [];

    let html2canvasMod: any = null;
    try { html2canvasMod = (await import('html2canvas')).default; } catch {}

    for (let i = 0; i < paginaElements.length; i++) {
      const el = paginaElements[i] as HTMLElement;
      const pagina = paginas?.[i];

      try {
        const paginaId = pagina?.id;
        const canvasData = paginaId && canvasExporters?.current[paginaId]?.();
        const bgImage = pagina?.backgroundImage;
        const effectivePaperColor = pagina?.paperColor || paperColor;
        const effectivePaperStyle = pagina?.paperStyle || 'lined';

        // Usar el tamaño exacto del elemento en pantalla
        const rect = el.getBoundingClientRect();
        const elW = Math.round(rect.width);
        const elH = Math.round(rect.height);
        const scale = 2;

        const compCanvas = document.createElement('canvas');
        compCanvas.width = elW * scale;
        compCanvas.height = elH * scale;
        const ctx = compCanvas.getContext('2d')!;
        ctx.scale(scale, scale);

        // ── CAPA 1: Color de fondo ──
        const bgFill = effectivePaperColor === 'dark' ? '#111827'
          : effectivePaperColor === 'yellow' ? '#fef7d7' : '#ffffff';
        ctx.fillStyle = bgFill;
        ctx.fillRect(0, 0, elW, elH);

        // ── CAPA 2: Líneas/grid/puntos (canvas nativo, NO svg) ──
        dibujarPaperBackground(ctx, elW, elH, effectivePaperStyle, effectivePaperColor);

        // ── CAPA 3: Imagen de fondo (PDF) ──
        if (bgImage) {
          try {
            const bgImg = await loadImage(bgImage);
            const bgRatio = bgImg.naturalWidth / bgImg.naturalHeight;
            const elRatio = elW / elH;
            let drawW = elW, drawH = elH, drawX = 0, drawY = 0;
            if (bgRatio > elRatio) {
              drawH = elW / bgRatio;
            } else {
              drawW = elH * bgRatio;
              drawX = (elW - drawW) / 2;
            }
            ctx.globalAlpha = 0.92;
            ctx.drawImage(bgImg, drawX, drawY, drawW, drawH);
            ctx.globalAlpha = 1;
          } catch {}
        }

        // ── CAPA 4: Bloques de texto e imágenes ──
        // Renderizar directamente desde el DOM sin html2canvas
        const editorRect = el.getBoundingClientRect();
        
        // 4a: Imágenes insertadas (no el fondo)
        const imgElements = el.querySelectorAll('img:not([alt="Fondo"])');
        for (const imgEl of Array.from(imgElements)) {
          const img = imgEl as HTMLImageElement;
          if (!img.src) continue;
          const imgRect = img.getBoundingClientRect();
          const rx = imgRect.left - editorRect.left;
          const ry = imgRect.top - editorRect.top;
          try {
            const loaded = await loadImage(img.src);
            ctx.drawImage(loaded, rx, ry, imgRect.width, imgRect.height);
          } catch {}
        }

        // 4b: Bloques de texto — renderizar nodo por nodo
        const textBlocks = el.querySelectorAll('[data-textblock]');
        for (const tb of Array.from(textBlocks)) {
          const contentDiv = (tb as HTMLElement).querySelector('.ebloque') as HTMLElement;
          if (!contentDiv || !contentDiv.innerText?.trim()) continue;
          renderContentDiv(ctx, contentDiv, editorRect);
        }

        // ── CAPA 5: Dibujos/strokes ──
        if (canvasData) {
          try {
            const strokeImg = await loadImage(canvasData);
            ctx.drawImage(strokeImg, 0, 0, elW, elH);
          } catch {}
        }

        imagenes.push(compCanvas.toDataURL('image/png'));
        console.log(`✅ Página ${i + 1} OK (${elW}x${elH})`);

      } catch (err) {
        console.error(`❌ Error página ${i + 1}:`, err);
        const empty = document.createElement('canvas');
        empty.width = 1000; empty.height = 900;
        const ectx = empty.getContext('2d')!;
        ectx.fillStyle = '#fff'; ectx.fillRect(0, 0, 1000, 900);
        ectx.fillStyle = '#aaa'; ectx.font = '14px system-ui'; ectx.textAlign = 'center';
        ectx.fillText(`Error en página ${i + 1}`, 500, 450);
        imagenes.push(empty.toDataURL('image/png'));
      }
    }
    return imagenes;
  };

  const addWatermark = async (pdf: any, pageWidth: number, pageHeight: number, margin: number) => {
    try {
      let logoData: string | null = null;
      try {
        const logoImg = await loadImage('/logo.png');
        const c = document.createElement('canvas');
        c.width = logoImg.naturalWidth; c.height = logoImg.naturalHeight;
        c.getContext('2d')!.drawImage(logoImg, 0, 0);
        logoData = c.toDataURL('image/png');
      } catch {}
      const total = pdf.getNumberOfPages();
      for (let p = 1; p <= total; p++) {
        pdf.setPage(p);
        const x = pageWidth - margin - 14;
        if (logoData) pdf.addImage(logoData, 'PNG', x - 9, 5, 18, 18);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(5.5); pdf.setTextColor(160, 160, 160);
        pdf.text('StudyAL', x, 28, { align: 'center' });
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(180, 180, 180);
        pdf.text(`${titulo} — ${p}/${total}`, margin, pageHeight - 8);
      }
    } catch {}
  };

  const exportPDF = async () => {
    setLoading('pdf'); setOpen(false);
    try {
      const { default: jsPDF } = await import('jspdf');
      const imagenes = await capturarPaginas();
      if (!imagenes.length) { alert('No se pudo capturar.'); setLoading(null); return; }
      const firstImg = await loadImage(imagenes[0]);
      const landscape = firstImg.naturalWidth > firstImg.naturalHeight;
      const pdf = new jsPDF(landscape ? 'l' : 'p', 'mm', 'a4');
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const m = 10;
      for (let i = 0; i < imagenes.length; i++) {
        if (i > 0) pdf.addPage();
        const img = await loadImage(imagenes[i]);
        const ratio = img.naturalWidth / img.naturalHeight;
        const maxW = pw - m * 2, maxH = ph - m * 2 - 10;
        let dw = maxW, dh = dw / ratio;
        if (dh > maxH) { dh = maxH; dw = dh * ratio; }
        pdf.addImage(imagenes[i], 'PNG', m + (maxW - dw) / 2, m + 5, dw, dh);
      }
      await addWatermark(pdf, pw, ph, m);
      pdf.save(`${titulo}.pdf`);
    } catch (err) { console.error('Error PDF:', err); alert('Error exportando PDF.'); }
    finally { setLoading(null); }
  };

  const exportWord = async () => {
    setLoading('word'); setOpen(false);
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType } = await import('docx');
      const imagenes = await capturarPaginas();
      if (!imagenes.length) { alert('No se pudo capturar.'); setLoading(null); return; }
      const children: any[] = [new Paragraph({ text: titulo, heading: HeadingLevel.TITLE, spacing: { after: 300 } })];
      for (let i = 0; i < imagenes.length; i++) {
        try {
          const base64 = imagenes[i].split(',')[1];
          const bytes = new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
          const img = await loadImage(imagenes[i]);
          const w = 600, h = Math.round(600 / (img.naturalWidth / img.naturalHeight));
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ data: bytes, transformation: { width: w, height: h }, type: 'png' } as any)],
            spacing: { before: 100, after: 200 },
          }));
        } catch {}
      }
      children.push(new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'StudyAL', size: 14, color: 'CCCCCC', italics: true })],
        spacing: { before: 300 },
      }));
      const blob = await Packer.toBlob(new Document({
        sections: [{ children, properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } } }],
      }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${titulo}.docx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Error Word:', err); alert('Error exportando Word.'); }
    finally { setLoading(null); }
  };

  const abrirPreview = async () => {
    setLoading('preview'); setOpen(false);
    const imgs = await capturarPaginas();
    setLoading(null);
    if (imgs.length > 0) { setPreview(imgs); setShowPreview(true); }
    else alert('No se pudo generar preview.');
  };

  const btnStyle = {
    width: '100%' as const, padding: '10px 14px', borderRadius: '8px',
    border: 'none', background: 'transparent',
    color: 'var(--text-primary)', fontSize: '13px',
    fontWeight: 700 as const, cursor: 'pointer' as const,
    display: 'flex' as const, alignItems: 'center' as const, gap: '10px', textAlign: 'left' as const,
  };

  return (
    <div style={{ position: 'relative' }}>

      {/* PREVIEW en portal */}
      {showPreview && preview.length > 0 && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setShowPreview(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)',
          zIndex: 999999, display: 'flex', flexDirection: 'column',
          alignItems: 'center', padding: '20px', overflowY: 'auto',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', maxWidth: '800px', marginBottom: '16px', flexShrink: 0,
          }}>
            <h2 style={{ color: '#fff', margin: 0, fontWeight: 900, fontSize: '18px' }}>
              👁️ Preview — {titulo}
            </h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { setShowPreview(false); exportPDF(); }}
                style={{ padding: '8px 18px', borderRadius: '10px', border: 'none', background: '#f5c842', color: '#000', fontWeight: 800, cursor: 'pointer', fontSize: '13px' }}>
                📄 PDF
              </button>
              <button onClick={() => { setShowPreview(false); exportWord(); }}
                style={{ padding: '8px 18px', borderRadius: '10px', border: 'none', background: '#38bdf8', color: '#000', fontWeight: 800, cursor: 'pointer', fontSize: '13px' }}>
                📝 Word
              </button>
              <button onClick={() => setShowPreview(false)}
                style={{ padding: '8px 16px', borderRadius: '10px', border: '1px solid #444', background: 'transparent', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
                ✕
              </button>
            </div>
          </div>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: '800px', display: 'flex', flexDirection: 'column',
            gap: '20px', paddingBottom: '40px',
          }}>
            {preview.map((src, i) => (
              <div key={i} style={{
                background: '#1a1a2e', borderRadius: '12px', overflow: 'hidden',
                border: '1px solid #333', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              }}>
                <div style={{ padding: '8px 14px', background: '#111', borderBottom: '1px solid #333' }}>
                  <span style={{ color: '#888', fontSize: '12px', fontWeight: 700 }}>
                    Página {i + 1} de {preview.length}
                  </span>
                </div>
                <img src={src} alt={`Página ${i + 1}`} style={{ width: '100%', display: 'block' }} />
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* BOTÓN */}
      <button onClick={() => setOpen(!open)} disabled={!!loading}
        style={{
          padding: '9px 18px', borderRadius: '10px',
          border: '2px solid var(--border-color)',
          background: 'transparent', color: 'var(--text-muted)',
          fontSize: '13px', fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}
        onMouseEnter={(e: any) => { if (!loading) { e.currentTarget.style.borderColor = temaColor; e.currentTarget.style.color = temaColor; } }}
        onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
        {loading ? (
          <><div style={{ width: 12, height: 12, border: '2px solid #888', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          {loading === 'preview' ? 'Generando...' : 'Exportando...'}</>
        ) : (<>📤 Export <span style={{ fontSize: '10px' }}>▼</span></>)}
      </button>

      {/* DROPDOWN */}
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '8px',
            background: 'var(--bg-card)', border: `2px solid ${temaColor}`,
            borderRadius: '14px', padding: '8px', zIndex: 9999,
            minWidth: '220px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            <button onClick={abrirPreview} style={btnStyle}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = `${temaColor}15`; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ fontSize: '18px' }}>👁️</span>
              <div><div style={{ fontWeight: 800 }}>Preview</div><div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Ver antes de exportar</div></div>
            </button>
            <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />
            <button onClick={exportPDF} style={btnStyle}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = `${temaColor}15`; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ fontSize: '18px' }}>📄</span>
              <div><div style={{ fontWeight: 800 }}>Export PDF</div><div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Todo incluido</div></div>
            </button>
            <button onClick={exportWord} style={btnStyle}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = `${temaColor}15`; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ fontSize: '18px' }}>📝</span>
              <div><div style={{ fontWeight: 800 }}>Export Word</div><div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Formato .docx</div></div>
            </button>
          </div>
        </>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
