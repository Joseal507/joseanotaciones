'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Apunte, Materia, Tema } from '../../lib/storage';
import { Bloque, BloqueImagen, BloqueTexto, Herramienta, genId } from '../editor/types';
import Toolbar from '../editor/Toolbar';
import EditorCanvas from '../editor/EditorCanvas';
import DrawingCanvas from '../editor/DrawingCanvas';
import ImageInserter from '../editor/ImageInserter';
import ExportMenu from '../editor/ExportMenu';
import PaperBackground from '../editor/PaperBackground';
import PaperStyleSelector from '../editor/PaperStyleSelector';
import TextBlock from '../editor/TextBlock';
import { useIsMobile } from '../../hooks/useIsMobile';

type PaperStyle = 'blank' | 'lined' | 'grid' | 'dotted';

// ✅ Cada página tiene sus propios bloques y canvas
interface Pagina {
  id: string;
  bloques: Bloque[];
  canvasData: string | null;
}

interface Props {
  apunte: Apunte;
  materia: Materia;
  tema: Tema;
  onBack: () => void;
  onBackMateria: () => void;
  onBackTema: () => void;
  onGuardar: (contenido: string) => void;
}

const parsePaginas = (contenido: string): Pagina[] => {
  if (!contenido) return [{ id: genId(), bloques: [], canvasData: null }];
  try {
    const p = JSON.parse(contenido);

    // ✅ Nuevo formato: array de páginas
    if (p && p.paginas && Array.isArray(p.paginas)) {
      return p.paginas.map((pg: any) => ({
        id: genId(),
        canvasData: pg.canvasData || null,
        bloques: (pg.bloques || []).map((b: any) => ({
          ...b,
          id: genId(),
          x: b.x ?? 80,
          y: b.y ?? 20,
          width: b.width ?? 600,
        })),
      }));
    }

    // ✅ Formato viejo: { bloques, canvasData } → convertir a 1 página
    if (p && p.bloques && Array.isArray(p.bloques)) {
      return [{
        id: genId(),
        canvasData: p.canvasData || null,
        bloques: p.bloques.map((b: any) => ({
          ...b,
          id: genId(),
          x: b.x ?? 80,
          y: b.y ?? 20,
          width: b.width ?? 600,
        })),
      }];
    }

    // ✅ Formato muy viejo: array de bloques
    if (Array.isArray(p)) {
      return [{
        id: genId(),
        canvasData: null,
        bloques: p.map((b: any) => ({
          ...b,
          id: genId(),
          x: b.x ?? 80,
          y: b.y ?? 20,
          width: b.width ?? 600,
        })),
      }];
    }
  } catch {}

  // ✅ Texto plano
  if (contenido.trim()) {
    return [{
      id: genId(),
      canvasData: null,
      bloques: [{ id: genId(), tipo: 'texto', html: contenido, x: 80, y: 20, width: 600 }],
    }];
  }

  return [{ id: genId(), bloques: [], canvasData: null }];
};

// ✅ Componente para UNA página
function PaginaEditor({
  pagina,
  paginaIdx,
  totalPaginas,
  temaColor,
  paperStyle,
  herramienta,
  brushColor,
  brushSize,
  isDrawingMode,
  isDrawing,
  isSelecting,
  newBlockId,
  isMobile,
  onBloques,
  onCanvasChange,
  onEliminarBloque,
  onFinishNew,
  onEliminarPagina,
  onAgregarPagina,
  onClickEditor,
  onTextInsert,
  registerCanvasExport,
  textRefs,
  htmlCache,
}: {
  pagina: Pagina;
  paginaIdx: number;
  totalPaginas: number;
  temaColor: string;
  paperStyle: PaperStyle;
  herramienta: Herramienta;
  brushColor: string;
  brushSize: number;
  isDrawingMode: boolean;
  isDrawing: boolean;
  isSelecting: boolean;
  newBlockId: string | null;
  isMobile: boolean;
  onBloques: (id: string, bloques: Bloque[]) => void;
  onCanvasChange: () => void;
  onEliminarBloque: (paginaId: string, bloqueId: string) => void;
  onFinishNew: () => void;
  onEliminarPagina: (id: string) => void;
  onAgregarPagina: (despuesDeIdx: number) => void;
  onClickEditor: (e: React.MouseEvent<HTMLDivElement>, paginaId: string) => void;
  onTextInsert: (text: string, canvasY: number, paginaId: string) => void;
  registerCanvasExport: (paginaId: string, fn: () => string | null) => void;
  textRefs: React.MutableRefObject<{ [id: string]: HTMLDivElement | null }>;
  htmlCache: React.MutableRefObject<{ [id: string]: string }>;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const PAGE_HEIGHT = isMobile ? 600 : 900;

  return (
    <div style={{ marginBottom: '0px' }}>

      {/* Número de página */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '6px',
        paddingLeft: '4px',
      }}>
        <span style={{
          fontSize: '11px',
          color: 'var(--text-faint)',
          fontWeight: 600,
          letterSpacing: '1px',
        }}>
          Página {paginaIdx + 1}
        </span>
        {totalPaginas > 1 && (
          <button
            onClick={() => onEliminarPagina(pagina.id)}
            style={{
              background: 'none',
              border: '1px solid #fca5a5',
              color: '#ef4444',
              borderRadius: '6px',
              padding: '1px 8px',
              fontSize: '10px',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕ Eliminar
          </button>
        )}
      </div>

      {/* Área de la página */}
      <div
        ref={editorRef}
        className="editor-area-principal"
        style={{
          position: 'relative',
          height: `${PAGE_HEIGHT}px`,
          background: 'white',
          borderRadius: '12px',
          border: isSelecting ? '2px solid #6366f1' : isDrawing ? `2px solid ${temaColor}` : '1px solid #e5e7eb',
          overflow: 'hidden',
          boxShadow: isSelecting
            ? '0 0 0 3px #6366f120'
            : isDrawing
              ? `0 0 0 3px ${temaColor}20`
              : '0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        {/* Fondo papel */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <PaperBackground style={paperStyle} temaColor={temaColor} />
        </div>

        {/* Canvas dibujo */}
        <EditorCanvas
          herramienta={herramienta}
          brushColor={brushColor}
          brushSize={brushSize}
          temaColor={temaColor}
          onChange={onCanvasChange}
          initialCanvasData={pagina.canvasData}
          onTextInsert={(text, y) => onTextInsert(text, y, pagina.id)}
          onRegisterExport={(fn) => registerCanvasExport(pagina.id, fn)}
        />

        {/* Capa bloques */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            pointerEvents: isDrawingMode ? 'none' : 'all',
          }}
          onClick={(e) => onClickEditor(e, pagina.id)}
        >
          {pagina.bloques.map(b => {
            if (b.tipo === 'texto') {
              return (
                <TextBlock
                  key={b.id}
                  bloque={b as BloqueTexto}
                  temaColor={temaColor}
                  isNew={newBlockId === b.id}
                  onUpdate={(changes) => {
                    onBloques(pagina.id, pagina.bloques.map(bl =>
                      bl.id === b.id ? { ...bl, ...changes } as Bloque : bl
                    ));
                  }}
                  onDelete={() => onEliminarBloque(pagina.id, b.id)}
                  onFinishNew={onFinishNew}
                />
              );
            }
            if (b.tipo === 'imagen') {
              const img = b as BloqueImagen;
              return (
                <div
                  key={b.id}
                  data-image="true"
                  style={{
                    position: 'absolute',
                    left: img.x,
                    top: img.y,
                    zIndex: img.zIndex ?? 2,
                  }}
                >
                  <img
                    src={img.src}
                    draggable={false}
                    style={{
                      width: img.width,
                      maxWidth: '100%',
                      borderRadius: '10px',
                      border: '1px solid #e5e7eb',
                      display: 'block',
                    }}
                  />
                  {img.label && (
                    <div style={{
                      position: 'absolute', top: 8, left: 8,
                      background: temaColor, color: '#000',
                      padding: '2px 8px', borderRadius: '6px',
                      fontSize: '10px', fontWeight: 800,
                    }}>
                      {img.label}
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>

        {/* Número de página en esquina */}
        <div style={{
          position: 'absolute',
          bottom: 8,
          right: 12,
          fontSize: '11px',
          color: '#d1d5db',
          fontWeight: 600,
          pointerEvents: 'none',
          zIndex: 5,
        }}>
          {paginaIdx + 1} / {totalPaginas}
        </div>
      </div>

      {/* ✅ Botón agregar página ENTRE páginas */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        margin: '12px 0',
      }}>
        <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
        <button
          onClick={() => onAgregarPagina(paginaIdx)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 16px',
            borderRadius: '20px',
            border: `2px dashed ${temaColor}`,
            background: 'transparent',
            color: temaColor,
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = temaColor + '15';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          + Agregar página
        </button>
        <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
      </div>
    </div>
  );
}

export default function ApunteEditor({ apunte, materia, tema, onBack, onBackMateria, onBackTema, onGuardar }: Props) {
  const [paginas, setPaginas] = useState<Pagina[]>(() => parsePaginas(apunte.contenido));
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(true);
  const [herramienta, setHerramienta] = useState<Herramienta>('texto');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(3);
  const [showDrawingCanvas, setShowDrawingCanvas] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [paperStyle, setPaperStyle] = useState<PaperStyle>('lined');
  const [newBlockId, setNewBlockId] = useState<string | null>(null);

  const textRefs = useRef<{ [id: string]: HTMLDivElement | null }>({});
  const htmlCache = useRef<{ [id: string]: string }>({});
  const autoSaveTimer = useRef<any>(null);
  const canvasExporters = useRef<{ [paginaId: string]: () => string | null }>({});
  const isMobile = useIsMobile();

  const isDrawing = ['boligrafo', 'marcador', 'lapiz', 'borrador'].includes(herramienta);
  const isSelecting = herramienta === 'seleccion';
  const isDrawingMode = isDrawing || isSelecting;

  const syncCache = useCallback(() => {
    Object.keys(textRefs.current).forEach(id => {
      const el = textRefs.current[id];
      if (el) htmlCache.current[id] = el.innerHTML;
    });
  }, []);

  const guardar = useCallback(() => {
    syncCache();
    const paginasConCanvas = paginas.map(pg => ({
      bloques: pg.bloques,
      canvasData: canvasExporters.current[pg.id]?.() || pg.canvasData || null,
    }));
    const contenidoFinal = JSON.stringify({ paginas: paginasConCanvas });
    setGuardando(true);
    onGuardar(contenidoFinal);
    setTimeout(() => { setGuardando(false); setGuardado(true); }, 600);
  }, [paginas, onGuardar, syncCache]);

  const triggerAutoSave = useCallback(() => {
    setGuardado(false);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => guardar(), 3000);
  }, [guardar]);

  useEffect(() => {
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); guardar(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [guardar]);

  // ✅ Actualizar bloques de una página
  const handleBloques = useCallback((paginaId: string, bloques: Bloque[]) => {
    setPaginas(prev => prev.map(pg => pg.id === paginaId ? { ...pg, bloques } : pg));
    triggerAutoSave();
  }, [triggerAutoSave]);

  // ✅ Eliminar bloque de una página
  const handleEliminarBloque = useCallback((paginaId: string, bloqueId: string) => {
    setPaginas(prev => prev.map(pg =>
      pg.id === paginaId
        ? { ...pg, bloques: pg.bloques.filter(b => b.id !== bloqueId) }
        : pg
    ));
    setNewBlockId(null);
    triggerAutoSave();
  }, [triggerAutoSave]);

  // ✅ Agregar página después de un índice
  const handleAgregarPagina = useCallback((despuesDeIdx: number) => {
    const nueva: Pagina = { id: genId(), bloques: [], canvasData: null };
    setPaginas(prev => {
      const nuevas = [...prev];
      nuevas.splice(despuesDeIdx + 1, 0, nueva);
      return nuevas;
    });
    triggerAutoSave();
    // Scroll a la nueva página
    setTimeout(() => {
      window.scrollBy({ top: 960, behavior: 'smooth' });
    }, 100);
  }, [triggerAutoSave]);

  // ✅ Eliminar página
  const handleEliminarPagina = useCallback((paginaId: string) => {
    if (paginas.length <= 1) return;
    if (!confirm('¿Eliminar esta página? Se perderá el contenido.')) return;
    setPaginas(prev => prev.filter(pg => pg.id !== paginaId));
    triggerAutoSave();
  }, [paginas.length, triggerAutoSave]);

  // ✅ Click en área de una página para crear bloque
  const handleClickEditor = useCallback((e: React.MouseEvent<HTMLDivElement>, paginaId: string) => {
    if (isDrawingMode) return;
    if (newBlockId) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('[contenteditable="true"]') ||
      target.closest('[data-textblock]') ||
      target.closest('[data-image]') ||
      target.closest('button') ||
      target.closest('canvas') ||
      target.closest('img')
    ) return;

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const id = genId();
    setPaginas(prev => prev.map(pg =>
      pg.id === paginaId
        ? {
          ...pg, bloques: [...pg.bloques, {
            id,
            tipo: 'texto' as const,
            html: '',
            x: Math.max(4, x),
            y: Math.max(4, y),
            width: 300,
          }]
        }
        : pg
    ));
    setNewBlockId(id);
    triggerAutoSave();
  }, [isDrawingMode, newBlockId, triggerAutoSave]);

  // ✅ Insertar texto desde canvas en una página
  const handleTextInsert = useCallback((text: string, canvasY: number, paginaId: string) => {
    if (!text.trim()) return;
    const htmlContent = text.split('\n').filter(l => l.trim()).map(l => `<p>${l}</p>`).join('');
    const id = genId();
    setPaginas(prev => prev.map(pg =>
      pg.id === paginaId
        ? { ...pg, bloques: [...pg.bloques, { id, tipo: 'texto' as const, html: htmlContent, x: 80, y: canvasY, width: 500 }] }
        : pg
    ));
    triggerAutoSave();
  }, [triggerAutoSave]);

  // ✅ Agregar imagen a la página activa (última o primera)
  const addImagen = (src: string, label?: string) => {
    const paginaId = paginas[paginas.length - 1].id;
    setPaginas(prev => prev.map(pg =>
      pg.id === paginaId
        ? {
          ...pg, bloques: [...pg.bloques, {
            id: genId(),
            tipo: 'imagen' as const,
            src,
            width: isMobile ? 280 : 400,
            x: 100,
            y: 100,
            label,
            align: 'center' as const,
            floating: false,
            zIndex: 2,
          }]
        }
        : pg
    ));
    triggerAutoSave();
    setShowImage(false);
    setShowDrawingCanvas(false);
  };

  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); triggerAutoSave(); };
  const insertHtml = (html: string) => { document.execCommand('insertHTML', false, html); triggerAutoSave(); };
  const handleHerramienta = (h: Herramienta) => { syncCache(); setHerramienta(h); };

  // Para ExportMenu - aplanar todos los bloques
  const todosLosBloques = paginas.flatMap(pg => pg.bloques);

  return (
    <>
      {showDrawingCanvas && (
        <DrawingCanvas
          color={tema.color}
          onSave={(d) => addImagen(d, '🎨 Dibujo')}
          onClose={() => setShowDrawingCanvas(false)}
        />
      )}
      {showImage && (
        <ImageInserter
          color={tema.color}
          onInsert={(src) => addImagen(src)}
          onClose={() => setShowImage(false)}
        />
      )}

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
          {!isMobile && (
            <>
              <span style={{ color: 'var(--text-faint)' }}>/</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>✏️ {apunte.titulo}</span>
            </>
          )}
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

            {isDrawingMode && (
              <div style={{ background: isSelecting ? '#eef2ff' : tema.color + '18', padding: '5px 10px', borderRadius: '8px', border: `1.5px solid ${isSelecting ? '#6366f1' : tema.color}`, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: isSelecting ? '#6366f1' : tema.color, fontWeight: 700 }}>
                  {isSelecting ? '🎯 Seleccionando' : '🎨 Dibujando'}
                </span>
                <button onClick={() => handleHerramienta('texto')} style={{ background: isSelecting ? '#6366f1' : tema.color, border: 'none', color: '#fff', padding: '2px 8px', borderRadius: '5px', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>✕</button>
              </div>
            )}

            <span style={{ fontSize: '11px', color: guardando ? 'var(--gold)' : guardado ? '#22c55e' : 'var(--gold)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
              {guardando
                ? <><div style={{ width: '8px', height: '8px', border: '1.5px solid var(--gold)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Guardando</>
                : guardado ? '✓' : '●'}
            </span>

            <ExportMenu
              bloques={todosLosBloques}
              titulo={apunte.titulo}
              temaColor={tema.color}
              textRefs={textRefs}
              htmlCache={htmlCache}
            />

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

        {/* TOOLBAR - sticky */}
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'var(--bg-primary)',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          marginBottom: '12px',
          overflow: 'hidden',
        }}>
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
                onUndo={() => (window as any).__editorUndo?.()}
                onRedo={() => (window as any).__editorRedo?.()}
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
        `}</style>

        {/* ✅ PÁGINAS */}
        <div>
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
              onBloques={handleBloques}
              onCanvasChange={triggerAutoSave}
              onEliminarBloque={handleEliminarBloque}
              onFinishNew={() => setNewBlockId(null)}
              onEliminarPagina={handleEliminarPagina}
              onAgregarPagina={handleAgregarPagina}
              onClickEditor={handleClickEditor}
              onTextInsert={handleTextInsert}
              registerCanvasExport={(paginaId, fn) => { canvasExporters.current[paginaId] = fn; }}
              textRefs={textRefs}
              htmlCache={htmlCache}
            />
          ))}
        </div>
      </div>
    </>
  );
}