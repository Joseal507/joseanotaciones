'use client';

import { useState } from 'react';
import { Pagina } from './types';

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

// ═══ Dibujar paper background directamente en canvas (igual que PaperBackground.tsx) ═══
function dibujarPaperBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  paperStyle: string,
  paperColor: string,
  temaColor: string,
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
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Línea roja vertical
    ctx.strokeStyle = palette.redLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(56, 0);
    ctx.lineTo(56, h);
    ctx.stroke();
  }

  if (paperStyle === 'grid') {
    const cell = 24;
    ctx.strokeStyle = palette.lineColor;
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += cell) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += cell) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }

  if (paperStyle === 'dotted') {
    const cell = 24;
    ctx.fillStyle = palette.dotColor;
    for (let x = cell / 2; x < w; x += cell) {
      for (let y = cell / 2; y < h; y += cell) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // blank → nada
}

export default function ExportMenu({
  bloques, paginas, titulo, temaColor, paperColor = 'white',
  textRefs, htmlCache, canvasExporters,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<'pdf' | 'word' | 'preview' | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  // ═══ Motor de captura: composición manual 100% fiel ═══
  const capturarPaginas = async (): Promise<string[]> => {
    const imagenes: string[] = [];
    const paginaElements = document.querySelectorAll('.editor-area-principal');

    if (paginaElements.length === 0) {
      console.warn('❌ No se encontraron .editor-area-principal');
      return [];
    }

    let html2canvasMod: any = null;
    try {
      html2canvasMod = (await import('html2canvas')).default;
    } catch (err) {
      console.error('❌ html2canvas no cargó:', err);
    }

    for (let i = 0; i < paginaElements.length; i++) {
      const el = paginaElements[i] as HTMLElement;
      const pagina = paginas?.[i];

      try {
        const paginaId = pagina?.id;
        const canvasData = paginaId && canvasExporters?.current[paginaId]?.();
        const bgImage = pagina?.backgroundImage;
        const effectivePaperColor = pagina?.paperColor || paperColor;
        const effectivePaperStyle = pagina?.paperStyle || 'lined';

        const elW = el.scrollWidth || el.clientWidth || 1000;
        const elH = el.scrollHeight || el.clientHeight || 900;
        const scale = 2;

        const compCanvas = document.createElement('canvas');
        compCanvas.width = elW * scale;
        compCanvas.height = elH * scale;
        const compCtx = compCanvas.getContext('2d')!;
        compCtx.scale(scale, scale);

        // ── CAPA 1: Color de fondo del papel ──
        const bgFill = effectivePaperColor === 'dark' ? '#111827'
          : effectivePaperColor === 'yellow' ? '#fef7d7' : '#ffffff';
        compCtx.fillStyle = bgFill;
        compCtx.fillRect(0, 0, elW, elH);

        // ── CAPA 2: Paper background (líneas/grid/puntos) — dibujado en canvas nativo ──
        dibujarPaperBackground(compCtx, elW, elH, effectivePaperStyle, effectivePaperColor, temaColor);

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
            compCtx.globalAlpha = 0.92;
            compCtx.drawImage(bgImg, drawX, drawY, drawW, drawH);
            compCtx.globalAlpha = 1;
          } catch (e) { console.warn('⚠️ No se pudo cargar bgImage:', e); }
        }

        // ── CAPA 4: Bloques de texto e imágenes (html2canvas) ──
        if (html2canvasMod) {
          // Buscar el contenedor de bloques (zIndex 10)
          const blockLayers = el.querySelectorAll('[style*="z-index: 10"], [style*="zIndex: 10"]');
          const blockLayer = blockLayers.length > 0 ? blockLayers[blockLayers.length - 1] as HTMLElement : null;

          if (blockLayer && blockLayer.children.length > 0) {
            try {
              const blockCanvas = await html2canvasMod(blockLayer, {
                scale,
                useCORS: true,
                allowTaint: true,
                backgroundColor: null,
                logging: false,
                width: elW,
                height: elH,
                x: 0,
                y: 0,
                scrollX: 0,
                scrollY: 0,
                onclone: (doc: Document) => {
                  doc.querySelectorAll('button').forEach((b: any) => { b.style.display = 'none'; });
                  doc.querySelectorAll('[contenteditable]').forEach((el: any) => {
                    el.style.outline = 'none';
                    el.style.border = 'none';
                  });
                },
              });
              compCtx.drawImage(blockCanvas, 0, 0, elW, elH);
            } catch (err) {
              console.warn(`⚠️ Error capturando bloques página ${i + 1}:`, err);
            }
          }
        }

        // ── CAPA 5: Strokes/dibujos (siempre encima de todo) ──
        if (canvasData) {
          try {
            const strokeImg = await loadImage(canvasData);
            compCtx.drawImage(strokeImg, 0, 0, elW, elH);
          } catch {}
        }

        imagenes.push(compCanvas.toDataURL('image/png'));
        console.log(`✅ Página ${i + 1} capturada OK (${elW}x${elH}, style=${effectivePaperStyle})`);

      } catch (err) {
        console.error(`❌ Error capturando página ${i + 1}:`, err);
        const empty = document.createElement('canvas');
        empty.width = 1000; empty.height = 900;
        const ectx = empty.getContext('2d')!;
        ectx.fillStyle = '#ffffff';
        ectx.fillRect(0, 0, 1000, 900);
        ectx.fillStyle = '#aaa';
        ectx.font = '14px system-ui';
        ectx.textAlign = 'center';
        ectx.fillText(`Página ${i + 1}`, 500, 450);
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
      for (let i = 1; i <= total; i++) {
        pdf.setPage(i);
        const x = pageWidth - margin - 14;
        if (logoData) pdf.addImage(logoData, 'PNG', x - 9, 5, 18, 18);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(5.5);
        pdf.setTextColor(160, 160, 160);
        pdf.text('StudyAL', x, 28, { align: 'center' });
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(180, 180, 180);
        pdf.text(`${titulo} — ${i}/${total}`, margin, pageHeight - 8);
      }
    } catch {}
  };

  const exportPDF = async () => {
    setLoading('pdf');
    setOpen(false);
    try {
      const { default: jsPDF } = await import('jspdf');
      const imagenes = await capturarPaginas();
      if (imagenes.length === 0) { alert('No se pudo capturar ninguna página.'); setLoading(null); return; }

      const firstImg = await loadImage(imagenes[0]);
      const isLandscape = firstImg.naturalWidth > firstImg.naturalHeight;
      const pdf = new jsPDF(isLandscape ? 'l' : 'p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;

      for (let i = 0; i < imagenes.length; i++) {
        if (i > 0) pdf.addPage();
        const img = await loadImage(imagenes[i]);
        const ratio = img.naturalWidth / img.naturalHeight;
        const maxW = pageWidth - margin * 2;
        const maxH = pageHeight - margin * 2 - 10;
        let drawW = maxW, drawH = drawW / ratio;
        if (drawH > maxH) { drawH = maxH; drawW = drawH * ratio; }
        pdf.addImage(imagenes[i], 'PNG', margin + (maxW - drawW) / 2, margin + 5, drawW, drawH);
      }

      await addWatermark(pdf, pageWidth, pageHeight, margin);
      pdf.save(`${titulo}.pdf`);
    } catch (err) {
      console.error('Error PDF:', err);
      alert('Error al exportar PDF.');
    } finally { setLoading(null); }
  };

  const exportWord = async () => {
    setLoading('word');
    setOpen(false);
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType } = await import('docx');
      const imagenes = await capturarPaginas();
      if (imagenes.length === 0) { alert('No se pudo capturar ninguna página.'); setLoading(null); return; }

      const children: any[] = [
        new Paragraph({ text: titulo, heading: HeadingLevel.TITLE, spacing: { after: 300 } }),
      ];

      for (let i = 0; i < imagenes.length; i++) {
        try {
          const base64 = imagenes[i].split(',')[1];
          const bytes = new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
          const img = await loadImage(imagenes[i]);
          const w = 600, h = Math.round(600 / (img.naturalWidth / img.naturalHeight));
          if (i > 0) children.push(new Paragraph({ children: [new TextRun({ text: '', size: 2 })], spacing: { before: 100 } }));
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
      const a = document.createElement('a');
      a.href = url; a.download = `${titulo}.docx`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error Word:', err);
      alert('Error al exportar Word.');
    } finally { setLoading(null); }
  };

  const abrirPreview = async () => {
    setLoading('preview');
    setOpen(false);
    const imgs = await capturarPaginas();
    setLoading(null);
    if (imgs.length > 0) { setPreview(imgs); setShowPreview(true); }
    else alert('No se pudo generar preview.');
  };

  const btnStyle = {
    width: '100%', padding: '10px 14px', borderRadius: '8px',
    border: 'none', background: 'transparent',
    color: 'var(--text-primary)', fontSize: '13px',
    fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' as const,
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* PREVIEW MODAL */}
      {showPreview && preview.length > 0 && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.93)',
          zIndex: 5000, display: 'flex', flexDirection: 'column',
          alignItems: 'center', padding: '20px', overflowY: 'auto',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', maxWidth: '800px', marginBottom: '16px', flexShrink: 0,
          }}>
            <h2 style={{ color: '#fff', margin: 0, fontWeight: 900, fontSize: '18px' }}>
              👁️ Preview — {titulo}
            </h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => { setShowPreview(false); exportPDF(); }}
                style={{ padding: '8px 18px', borderRadius: '10px', border: 'none', background: '#f5c842', color: '#000', fontWeight: 800, cursor: 'pointer', fontSize: '13px' }}
              >
                📄 Guardar PDF
              </button>
              <button
                onClick={() => setShowPreview(false)}
                style={{ padding: '8px 16px', borderRadius: '10px', border: '1px solid #444', background: 'transparent', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}
              >
                ✕ Cerrar
              </button>
            </div>
          </div>
          <div style={{ width: '100%', maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {preview.map((src, i) => (
              <div key={i} style={{ background: '#222', borderRadius: '8px', overflow: 'hidden' }}>
                <p style={{ color: '#888', fontSize: '11px', margin: '6px 12px', fontWeight: 600 }}>Página {i + 1}</p>
                <img src={src} alt={`Página ${i + 1}`} style={{ width: '100%', display: 'block' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BOTÓN PRINCIPAL */}
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
        }}
        onMouseEnter={(e: any) => { if (!loading) { e.currentTarget.style.borderColor = temaColor; e.currentTarget.style.color = temaColor; } }}
        onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        {loading ? (
          <>
            <div style={{ width: '12px', height: '12px', border: '2px solid #888', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            {loading === 'preview' ? 'Generando...' : 'Exportando...'}
          </>
        ) : (
          <>📤 Export <span style={{ fontSize: '10px' }}>▼</span></>
        )}
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
            <button
              onClick={abrirPreview}
              style={btnStyle}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = `${temaColor}15`; e.currentTarget.style.color = temaColor; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            >
              <span style={{ fontSize: '18px' }}>👁️</span>
              <div>
                <div style={{ fontWeight: 800 }}>Preview</div>
                <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Ver antes de exportar</div>
              </div>
            </button>

            <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />

            <button
              onClick={exportPDF}
              style={btnStyle}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = `${temaColor}15`; e.currentTarget.style.color = temaColor; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            >
              <span style={{ fontSize: '18px' }}>📄</span>
              <div>
                <div style={{ fontWeight: 800 }}>Export PDF</div>
                <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Líneas, texto y dibujos incluidos</div>
              </div>
            </button>

            <button
              onClick={exportWord}
              style={btnStyle}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = `${temaColor}15`; e.currentTarget.style.color = temaColor; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            >
              <span style={{ fontSize: '18px' }}>📝</span>
              <div>
                <div style={{ fontWeight: 800 }}>Export Word</div>
                <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Formato .docx editable</div>
              </div>
            </button>
          </div>
        </>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
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
