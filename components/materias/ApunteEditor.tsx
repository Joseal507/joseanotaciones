'use client';

import { useState, useRef, useCallback } from 'react';
import { Apunte, Materia, Tema } from '../../lib/storage';
import { Bloque, Herramienta, Pagina, PaperStyle, parsePaginas, genId } from '../editor/types';
import Toolbar from '../editor/Toolbar';
import DrawingCanvas from '../editor/DrawingCanvas';
import ImageInserter from '../editor/ImageInserter';
import PdfBackgroundInserter from '../editor/PdfBackgroundInserter';
import ExportMenu from '../editor/ExportMenu';
import PaperStyleSelector from '../editor/PaperStyleSelector';
import PaginaEditor from './PaginaEditor';
import { useIsMobile } from '../../hooks/useIsMobile';
import PeterSauPeter from '../editor/PeterSauPeter';
import { usePinchZoom } from '../../hooks/usePinchZoom';
import { useGuardar } from '../../hooks/useGuardar';

interface Props {
  apunte: Apunte;
  materia: Materia;
  tema: Tema;
  onBack: () => void;
  onBackMateria: () => void;
  onBackTema: () => void;
  onGuardar: (contenido: string) => void;
}

export default function ApunteEditor({
  apunte, materia, tema,
  onBack, onBackMateria, onBackTema, onGuardar,
}: Props) {
  const [paginas, setPaginas] = useState<Pagina[]>(() => parsePaginas(apunte.contenido));
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(true);
  const [herramienta, setHerramienta] = useState<Herramienta>('texto');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(3);
  const [showDrawingCanvas, setShowDrawingCanvas] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [showPdfFondo, setShowPdfFondo] = useState(false);
  const [paperStyle, setPaperStyle] = useState<PaperStyle>(() => {
    try {
      const parsed = JSON.parse(apunte.contenido || '{}');
      return (parsed.paperConfig?.paperStyle as PaperStyle) || 'lined';
    } catch {
      return 'lined';
    }
  });
  const [paperColor, setPaperColor] = useState<'white' | 'dark' | 'yellow'>(() => {
    try {
      const parsed = JSON.parse(apunte.contenido || '{}');
      return parsed.paperConfig?.paperColor || 'white';
    } catch {
      return 'white';
    }
  });
  const [paperSize, setPaperSize] = useState<string>(() => {
    try {
      const parsed = JSON.parse(apunte.contenido || '{}');
      return parsed.paperConfig?.paperSize || 'normal';
    } catch {
      return 'normal';
    }
  });
  const [newBlockId, setNewBlockId] = useState<string | null>(null);
  const [zoomState, setZoomState] = useState({ scale: 1, tx: 0, ty: 0 });
  const [showPeterSauPeter, setShowPeterSauPeter] = useState(false);
  const [peterImage, setPeterImage] = useState<{ base64: string; mime: string } | null>(null);

  const paginasRef = useRef<Pagina[]>(paginas);
  const zoomScaleRef = useRef(1);
  const textRefs = useRef<{ [id: string]: HTMLDivElement | null }>({});
  const htmlCache = useRef<{ [id: string]: string }>({});
  const canvasExporters = useRef<{ [paginaId: string]: () => string | null }>({});
  // ✅ NUEVO: exportadores de strokes JSON
  const strokesExporters = useRef<{ [paginaId: string]: () => string | null }>({});
  const canvasUndoRedo = useRef<{ [paginaId: string]: { undo: () => void; redo: () => void } }>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // ✅ Actualizado con nuevas herramientas
const isDrawing = [
  'boligrafo',
  'marcador',
  'lapiz',
  'borrador',
  'borrador_trazo',
  'regla',
  'forma_rect',
  'forma_circulo',
  'forma_triangulo',
].includes(herramienta);
  const isSelecting = herramienta === 'seleccion' || herramienta === 'lasso';
  const isDrawingMode = isDrawing || isSelecting;

  const PAPER_SIZES: Record<string, { w: number; h: number }> = {
    normal: { w: 816, h: 1056 },
    a7: { w: 295, h: 420 },
    a6: { w: 420, h: 595 },
    a5: { w: 595, h: 842 },
    a4: { w: 842, h: 1191 },
    a3: { w: 1191, h: 1684 },
    letter: { w: 816, h: 1056 },
    tabloid: { w: 1056, h: 1632 },
    board: { w: 1400, h: 1000 },
  };

  const selectedSize = PAPER_SIZES[paperSize] || PAPER_SIZES.normal;

  // ✅ Tamaño real según el papel seleccionado
const BASE_PAGE_WIDTH = isMobile ? 390 : selectedSize.w;
const BASE_PAGE_HEIGHT = isMobile ? 600 : selectedSize.h;
  const pageWidth = BASE_PAGE_WIDTH * zoomState.scale;
  const pageHeight = BASE_PAGE_HEIGHT * zoomState.scale;

  const handleScaleChange = useCallback((scale: number, tx: number, ty: number) => {
    zoomScaleRef.current = scale;
    setZoomState({ scale, tx, ty });
  }, []);

  usePinchZoom(wrapperRef, handleScaleChange);

  const syncCache = useCallback(() => {
    Object.keys(textRefs.current).forEach((id) => {
      const el = textRefs.current[id];
      if (el) htmlCache.current[id] = el.innerHTML;
    });
  }, []);

  // ✅ ACTUALIZADO: guardar strokes JSON junto con canvasData
  const getPaginasParaGuardar = useCallback(() => {
    return paginasRef.current.map((pg) => ({
      bloques: pg.bloques,
      canvasData: canvasExporters.current[pg.id]?.() || pg.canvasData || null,
      strokesData: strokesExporters.current[pg.id]?.() || pg.strokesData || null,
      backgroundImage: pg.backgroundImage || undefined,
    }));
  }, []);

  const guardarConConfig = useCallback((contenidoFinal: string) => {
    try {
      const parsed = JSON.parse(contenidoFinal);
      onGuardar(JSON.stringify({
        ...parsed,
        paperConfig: {
          paperStyle,
          paperColor,
          paperSize,
        },
      }));
    } catch {
      onGuardar(contenidoFinal);
    }
  }, [onGuardar, paperStyle, paperColor, paperSize]);

  const { guardar, guardarAhora, triggerAutoSave } = useGuardar({
    getPaginas: getPaginasParaGuardar,
    syncCache,
    onGuardar: guardarConConfig,
    setGuardando,
    setGuardado,
  });

  const setPaginasSync = useCallback((updater: (prev: Pagina[]) => Pagina[]) => {
    setPaginas((prev) => {
      const next = updater(prev);
      paginasRef.current = next;
      return next;
    });
  }, []);

  const handleBloques = useCallback((paginaId: string, bloques: Bloque[]) => {
    setPaginasSync((prev) => prev.map((pg) => pg.id === paginaId ? { ...pg, bloques } : pg));
    triggerAutoSave();
  }, [setPaginasSync, triggerAutoSave]);

  const handleEliminarBloque = useCallback((paginaId: string, bloqueId: string) => {
    setPaginasSync((prev) => prev.map((pg) =>
      pg.id === paginaId ? { ...pg, bloques: pg.bloques.filter((b) => b.id !== bloqueId) } : pg
    ));
    setNewBlockId(null);
    triggerAutoSave();
  }, [setPaginasSync, triggerAutoSave]);

  const handleAgregarPagina = useCallback((despuesDeIdx: number) => {
    const nueva: Pagina = { id: genId(), bloques: [], canvasData: null };
    setPaginasSync((prev) => {
      const n = [...prev];
      n.splice(despuesDeIdx + 1, 0, nueva);
      return n;
    });
    triggerAutoSave();
    setTimeout(() => { window.scrollBy({ top: pageHeight + 60, behavior: 'smooth' }); }, 100);
  }, [setPaginasSync, triggerAutoSave, pageHeight]);

  const handleEliminarPagina = useCallback((paginaId: string) => {
    if (paginasRef.current.length <= 1) return;
    if (!confirm('¿Eliminar esta página?')) return;
    setPaginasSync((prev) => prev.filter((pg) => pg.id !== paginaId));
    delete canvasUndoRedo.current[paginaId];
    delete canvasExporters.current[paginaId];
    delete strokesExporters.current[paginaId];
    triggerAutoSave();
  }, [setPaginasSync, triggerAutoSave]);

  const handleClickEditor = useCallback((e: React.MouseEvent<HTMLDivElement>, paginaId: string) => {
  if (isDrawingMode || newBlockId) return;
  const target = e.target as HTMLElement;
  if (
    target.closest('[data-textblock]') || target.closest('[contenteditable="true"]') ||
    target.closest('[data-image]') || target.closest('button') ||
    target.closest('canvas') || target.closest('img') || target.closest('svg')
  ) return;

  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
  let x = (e.clientX - rect.left) / zoomState.scale;
  let y = (e.clientY - rect.top) / zoomState.scale;

  // ✅ Clampar dentro de la página con margen
  const MARGIN = 12;
  const TEXT_WIDTH = isMobile ? 260 : 300;
  const pageW = BASE_PAGE_WIDTH;
  const pageH = BASE_PAGE_HEIGHT;

  x = Math.max(MARGIN, Math.min(x, pageW - TEXT_WIDTH - MARGIN));
  y = Math.max(MARGIN, Math.min(y, pageH - 40));

  // ✅ Solo evitar crear si tocaste literalmente encima del área principal de otro bloque de texto
  const paginaActual = paginasRef.current.find((pg) => pg.id === paginaId);
  if (paginaActual?.bloques.some((b) => {
    if (b.tipo !== 'texto') return false;
    const bx = b.x ?? 0;
    const by = b.y ?? 0;
    const bw = b.width ?? TEXT_WIDTH;
    const approxH = 42;
    return x >= bx && x <= bx + bw && y >= by && y <= by + approxH;
  })) return;

  const id = genId();
  setPaginasSync((prev) => prev.map((pg) =>
    pg.id === paginaId
      ? {
          ...pg,
          bloques: [...pg.bloques, {
            id,
            tipo: 'texto' as const,
            html: '',
            x: Math.round(x),
            y: Math.round(y),
            width: TEXT_WIDTH,
          }],
        }
      : pg
  ));
  setNewBlockId(id);
  triggerAutoSave();
}, [isDrawingMode, newBlockId, triggerAutoSave, zoomState.scale, setPaginasSync, isMobile]);

  const handleTextInsert = useCallback((text: string, canvasY: number, paginaId: string) => {
  if (!text.trim()) return;
  const htmlContent = text.split('\n').filter((l) => l.trim()).map((l) => `<p>${l}</p>`).join('');
  const id = genId();

  const MARGIN = 20;
  const pageW = isMobile ? 390 : 816;
  const TEXT_WIDTH = isMobile ? 300 : 500;

  // ✅ Clampar posición
  const x = Math.max(MARGIN, Math.min(80, pageW - TEXT_WIDTH - MARGIN));
  const y = Math.max(MARGIN, Math.min(canvasY / zoomState.scale, (isMobile ? 600 : 1056) - 60));

  setPaginasSync((prev) => prev.map((pg) =>
    pg.id === paginaId
      ? { ...pg, bloques: [...pg.bloques, { id, tipo: 'texto' as const, html: htmlContent, x, y, width: TEXT_WIDTH }] }
      : pg
  ));
  triggerAutoSave();
}, [setPaginasSync, triggerAutoSave, zoomState.scale, isMobile]);

  const addImagen = useCallback((src: string, label?: string) => {
    const paginaId = paginasRef.current[paginasRef.current.length - 1].id;
    setPaginasSync((prev) => prev.map((pg) =>
      pg.id === paginaId
        ? { ...pg, bloques: [...pg.bloques, { id: genId(), tipo: 'imagen' as const, src, width: isMobile ? 280 : 400, x: 100, y: 100, label, align: 'center' as const, floating: false, zIndex: 2 }] }
        : pg
    ));
    triggerAutoSave();
    setShowImage(false);
    setShowDrawingCanvas(false);
  }, [setPaginasSync, triggerAutoSave, isMobile]);

  const handleInsertPdfFondo = useCallback((pages: string[]) => {
    setPaginasSync((prev) => {
      const updated = [...prev];
      pages.forEach((pageDataUrl, idx) => {
        if (idx === 0 && updated.length > 0) {
          const lastIdx = updated.length - 1;
          updated[lastIdx] = { ...updated[lastIdx], backgroundImage: pageDataUrl };
        } else {
          updated.push({ id: genId(), bloques: [], canvasData: null, backgroundImage: pageDataUrl });
        }
      });
      return updated;
    });
    setShowPdfFondo(false);
    setTimeout(() => guardarAhora(), 0);
  }, [setPaginasSync, guardarAhora]);

  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); triggerAutoSave(); };
  const insertHtml = (html: string) => { document.execCommand('insertHTML', false, html); triggerAutoSave(); };
  const handleHerramienta = (h: Herramienta) => { syncCache(); setHerramienta(h); };
  const todosLosBloques = paginas.flatMap((pg) => pg.bloques);

  return (
    <>
      {/* MODALS */}
      {showPeterSauPeter && peterImage && (
        <PeterSauPeter
          imageBase64={peterImage.base64}
          imageMime={peterImage.mime}
          temaColor={tema.color}
          onClose={() => { setShowPeterSauPeter(false); setPeterImage(null); }}
          onInsertarSolucion={(html) => insertHtml(html)}
        />
      )}
      {showDrawingCanvas && <DrawingCanvas color={tema.color} onSave={(d) => addImagen(d, '🎨 Dibujo')} onClose={() => setShowDrawingCanvas(false)} />}
      {showImage && <ImageInserter color={tema.color} onInsert={(src) => addImagen(src)} onClose={() => setShowImage(false)} />}
      {showPdfFondo && <PdfBackgroundInserter temaColor={tema.color} onInsert={handleInsertPdfFondo} onClose={() => setShowPdfFondo(false)} />}

      {/* FULLSCREEN EDITOR */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: '#111118',
        display: 'flex', flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}>

        {/* ═══ TOP BAR ═══ */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: isMobile ? '6px 10px' : '6px 16px',
          background: 'rgba(17,17,24,0.95)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          flexShrink: 0, height: isMobile ? '40px' : '44px', zIndex: 60,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
            <button onClick={onBackTema} style={{
              width: '32px', height: '32px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#f5c842', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', flexShrink: 0,
            }}>←</button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 style={{ fontSize: isMobile ? '13px' : '14px', fontWeight: 800, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {apunte.titulo}
              </h1>
              {!isMobile && (
                <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', margin: 0 }}>
                  {materia.emoji} {materia.nombre} / {tema.nombre}
                </p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
            <PaperStyleSelector value={paperStyle} onChange={setPaperStyle} />
            <div style={{
              padding: '3px 8px', borderRadius: '6px',
              background: guardando ? 'rgba(245,200,66,0.12)' : guardado ? 'rgba(34,197,94,0.1)' : 'rgba(245,200,66,0.12)',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              {guardando
                ? <div style={{ width: 6, height: 6, border: '1.5px solid #f5c842', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
                : <div style={{ width: 5, height: 5, borderRadius: '50%', background: guardado ? '#22c55e' : '#f5c842' }} />
              }
              <span style={{ fontSize: '10px', color: guardando ? '#f5c842' : guardado ? '#22c55e' : '#f5c842', fontWeight: 600 }}>
                {guardando ? '...' : guardado ? '✓' : '●'}
              </span>
            </div>
            <ExportMenu bloques={todosLosBloques} paginas={paginas} titulo={apunte.titulo} temaColor={tema.color} textRefs={textRefs} htmlCache={htmlCache} canvasExporters={canvasExporters} />
            <button onClick={guardar} style={{
              padding: isMobile ? '6px 10px' : '6px 14px', borderRadius: '8px', border: 'none',
              background: '#f5c842', color: '#000', fontSize: '11px', fontWeight: 800, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/></svg>
              {!isMobile && 'Save'}
            </button>
          </div>
        </div>

        {/* ═══ PAGE AREA ═══ */}
        <div ref={wrapperRef} style={{
          flex: 1, overflow: 'auto',
          display: 'flex', justifyContent: 'center',
          touchAction: 'pan-x pan-y',
          userSelect: 'none', WebkitUserSelect: 'none',
          paddingBottom: isMobile ? '70px' : '80px',
        }}>
          <div style={{
            transform: `translate(${zoomState.tx}px, ${zoomState.ty}px)`,
            transformOrigin: '0 0', willChange: 'transform',
          }}>
            {paginas.map((pagina, idx) => (
              <PaginaEditor
                key={pagina.id}
                pagina={pagina}
                paginaIdx={idx}
                totalPaginas={paginas.length}
                temaColor={tema.color}
                paperStyle={paperStyle}
                paperColor={paperColor}
                herramienta={herramienta}
                brushColor={brushColor}
                brushSize={brushSize}
                isDrawingMode={isDrawingMode}
                isDrawing={isDrawing}
                isSelecting={isSelecting}
                newBlockId={newBlockId}
                isMobile={isMobile}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                externalScale={zoomScaleRef}
                textRefs={textRefs}
                htmlCache={htmlCache}
                onBloques={handleBloques}
                onCanvasChange={triggerAutoSave}
                onEliminarBloque={handleEliminarBloque}
                onFinishNew={() => setNewBlockId(null)}
                onEliminarPagina={handleEliminarPagina}
                onAgregarPagina={handleAgregarPagina}
                onClickEditor={handleClickEditor}
                onTextInsert={handleTextInsert}
                registerCanvasExport={(paginaId, fn) => { canvasExporters.current[paginaId] = fn; }}
                registerStrokesExport={(paginaId, fn) => { strokesExporters.current[paginaId] = fn; }}
                registerUndoRedo={(paginaId, undo, redo) => { canvasUndoRedo.current[paginaId] = { undo, redo }; }}
                onPeterSauPeter={(b64, mime) => {
                  setPeterImage({ base64: b64, mime });
                  setShowPeterSauPeter(true);
                }}
              />
            ))}
          </div>
        </div>

        {/* ═══ FLOATING TOOLBAR ═══ */}
        <div style={{
          position: 'fixed',
          bottom: isMobile ? '10px' : '16px',
          left: '50%', transform: 'translateX(-50%)',
          zIndex: 100,
          width: isMobile ? 'calc(100vw - 16px)' : 'auto',
          maxWidth: '700px',
        }}>
          <div style={{
            borderRadius: '16px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
            overflow: 'hidden',
          }}>
            <Toolbar
              temaColor={tema.color}
              herramientaActiva={herramienta}
              onHerramienta={handleHerramienta}
              brushColor={brushColor}
              onBrushColor={setBrushColor}
              brushSize={brushSize}
              onBrushSize={setBrushSize}
              onExecCmd={exec}
              onInsertHtml={insertHtml}
              onInsertImagen={() => { syncCache(); setShowImage(true); }}
              onInsertDibujo={() => { syncCache(); setShowDrawingCanvas(true); }}
              onInsertPdfFondo={() => { syncCache(); setShowPdfFondo(true); }}
              onUndo={() => Object.values(canvasUndoRedo.current).forEach(({ undo }) => { try { undo(); } catch {} })}
              onRedo={() => Object.values(canvasUndoRedo.current).forEach(({ redo }) => { try { redo(); } catch {} })}
            />
          </div>
        </div>
      </div>

      <style>{`
        .ebloque { outline: none; }
        .ebloque:empty:before { content: ''; }
        .ebloque h1 { font-size: ${isMobile ? '22px' : '28px'}; font-weight: 900; color: ${tema.color}; margin: 0; }
        .ebloque h2 { font-size: ${isMobile ? '18px' : '22px'}; font-weight: 800; color: #111827; margin: 0; }
        .ebloque h3 { font-size: ${isMobile ? '15px' : '17px'}; font-weight: 700; color: #1f2937; margin: 0; }
        .ebloque p { color: #1f2937; font-size: ${isMobile ? '15px' : '16px'}; margin: 0; }
        .ebloque ul { list-style-type: disc; padding-left: 20px; margin: 0; }
        .ebloque ol { list-style-type: decimal; padding-left: 20px; margin: 0; }
        .ebloque li { color: #1f2937 !important; }
        .ebloque li::marker { color: ${tema.color}; font-weight: 700; }
        .ebloque b, .ebloque strong { color: #111827; font-weight: 800; }
        .ebloque i, .ebloque em { color: #374151; }
        .ebloque u { text-decoration-color: ${tema.color}; }
        .ebloque s { color: #9ca3af; }
        .ebloque blockquote { border-left: 3px solid ${tema.color}; padding: 4px 12px; margin: 4px 0; color: #6b7280; font-style: italic; background: ${tema.color}08; }
        .ebloque a { color: #2563eb; text-decoration: underline; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .editor-area-principal { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; }
        .editor-area-principal [contenteditable="true"] { -webkit-user-select: text !important; user-select: text !important; }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </>
  );
}
