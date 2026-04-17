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
  const [paperStyle, setPaperStyle] = useState<PaperStyle>('lined');
  const [newBlockId, setNewBlockId] = useState<string | null>(null);
  const [zoomState, setZoomState] = useState({ scale: 1, tx: 0, ty: 0 });

  const paginasRef = useRef<Pagina[]>(paginas);
  const zoomScaleRef = useRef(1);
  const textRefs = useRef<{ [id: string]: HTMLDivElement | null }>({});
  const htmlCache = useRef<{ [id: string]: string }>({});
  const canvasExporters = useRef<{ [paginaId: string]: () => string | null }>({});
  const canvasUndoRedo = useRef<{ [paginaId: string]: { undo: () => void; redo: () => void } }>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const isDrawing = ['boligrafo', 'marcador', 'lapiz', 'borrador'].includes(herramienta);
  const isSelecting = herramienta === 'seleccion';
  const isDrawingMode = isDrawing || isSelecting;

  const BASE_PAGE_WIDTH = isMobile ? 390 : 1000;
  const BASE_PAGE_HEIGHT = isMobile ? 600 : 900;
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

  const getPaginasParaGuardar = useCallback(() => {
    return paginasRef.current.map((pg) => ({
      bloques: pg.bloques,
      canvasData: canvasExporters.current[pg.id]?.() || pg.canvasData || null,
      backgroundImage: pg.backgroundImage || undefined,
    }));
  }, []);

  const { guardar, guardarAhora, triggerAutoSave } = useGuardar({
    getPaginas: getPaginasParaGuardar,
    syncCache,
    onGuardar,
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
    const x = (e.clientX - rect.left) / zoomState.scale;
    const y = (e.clientY - rect.top) / zoomState.scale;

    const paginaActual = paginasRef.current.find((pg) => pg.id === paginaId);
    if (paginaActual?.bloques.some((b) => b.tipo === 'texto' && Math.abs(b.x - x) < 300 && Math.abs(b.y - y) < 40)) return;

    const id = genId();
    setPaginasSync((prev) => prev.map((pg) =>
      pg.id === paginaId
        ? { ...pg, bloques: [...pg.bloques, { id, tipo: 'texto' as const, html: '', x: Math.max(4, x), y: Math.max(4, y), width: 300 }] }
        : pg
    ));
    setNewBlockId(id);
    triggerAutoSave();
  }, [isDrawingMode, newBlockId, triggerAutoSave, zoomState.scale, setPaginasSync]);

  const handleTextInsert = useCallback((text: string, canvasY: number, paginaId: string) => {
    if (!text.trim()) return;
    const htmlContent = text.split('\n').filter((l) => l.trim()).map((l) => `<p>${l}</p>`).join('');
    const id = genId();
    setPaginasSync((prev) => prev.map((pg) =>
      pg.id === paginaId
        ? { ...pg, bloques: [...pg.bloques, { id, tipo: 'texto' as const, html: htmlContent, x: 80, y: canvasY / zoomState.scale, width: 500 }] }
        : pg
    ));
    triggerAutoSave();
  }, [setPaginasSync, triggerAutoSave, zoomState.scale]);

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
      {showDrawingCanvas && <DrawingCanvas color={tema.color} onSave={(d) => addImagen(d, '🎨 Dibujo')} onClose={() => setShowDrawingCanvas(false)} />}
      {showImage && <ImageInserter color={tema.color} onInsert={(src) => addImagen(src)} onClose={() => setShowImage(false)} />}
      {showPdfFondo && <PdfBackgroundInserter temaColor={tema.color} onInsert={handleInsertPdfFondo} onClose={() => setShowPdfFondo(false)} />}

      <div style={{ maxWidth: '1080px', margin: '0 auto' }}>

        {/* BREADCRUMB */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
            📚 {!isMobile && 'Materias'}
          </button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackMateria} style={{ background: 'none', border: 'none', color: materia.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px', maxWidth: isMobile ? '90px' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {materia.emoji} {materia.nombre}
          </button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackTema} style={{ background: 'none', border: 'none', color: tema.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px', maxWidth: isMobile ? '90px' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📁 {tema.nombre}
          </button>
          {!isMobile && <><span style={{ color: 'var(--text-faint)' }}>/</span><span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>✏️ {apunte.titulo}</span></>}
        </div>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
            <div style={{ width: '4px', height: '28px', background: tema.color, borderRadius: '2px', flexShrink: 0 }} />
            <h1 style={{ fontSize: isMobile ? '16px' : '22px', fontWeight: 900, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {apunte.titulo}
            </h1>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
            <PaperStyleSelector value={paperStyle} onChange={setPaperStyle} />
            {zoomState.scale !== 1 && (
              <button onClick={() => handleScaleChange(1, 0, 0)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
                {Math.round(zoomState.scale * 100)}% ✕
              </button>
            )}
            <span style={{ fontSize: '11px', color: guardando ? 'var(--gold)' : guardado ? '#22c55e' : 'var(--gold)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
              {guardando
                ? <><div style={{ width: '8px', height: '8px', border: '1.5px solid var(--gold)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Guardando</>
                : guardado ? '✓' : '●'}
            </span>
            <ExportMenu bloques={todosLosBloques} titulo={apunte.titulo} temaColor={tema.color} textRefs={textRefs} htmlCache={htmlCache} canvasExporters={canvasExporters} />
            <button onClick={guardar} style={{ padding: isMobile ? '8px 14px' : '9px 18px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontSize: isMobile ? '12px' : '13px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                <polyline points="17,21 17,13 7,13 7,21" />
                <polyline points="7,3 7,8 15,8" />
              </svg>
              {!isMobile && 'Guardar'}
            </button>
          </div>
        </div>

        {/* TOOLBAR */}
        <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid #e5e7eb', marginBottom: '12px', overflow: 'hidden' }}>
          <div style={{ height: '3px', background: isSelecting ? '#6366f1' : tema.color }} />
          <div style={{ overflowX: isMobile ? 'auto' : 'visible' }}>
            <div style={{ minWidth: isMobile ? 'max-content' : 'auto' }}>
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
          .ebloque:empty:before { content: 'Escribe aquí...'; color: #d1d5db; font-style: italic; pointer-events: none; }
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

        {/* Wrapper zoom/pan */}
        <div ref={wrapperRef} style={{ position: 'relative', touchAction: 'pan-x pan-y', userSelect: 'none', WebkitUserSelect: 'none', overflow: 'hidden' }}>
          <div style={{ transform: `translate(${zoomState.tx}px, ${zoomState.ty}px)`, transformOrigin: '0 0', willChange: 'transform' }}>
            {paginas.map((pagina, idx) => (
              <PaginaEditor
                key={pagina.id}
                pagina={pagina}
                paginaIdx={idx}
                totalPaginas={paginas.length}
                temaColor={tema.color}
                paperStyle={paperStyle}
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
                registerUndoRedo={(paginaId, undo, redo) => { canvasUndoRedo.current[paginaId] = { undo, redo }; }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}