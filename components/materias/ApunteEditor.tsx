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

interface Props {
  apunte: Apunte;
  materia: Materia;
  tema: Tema;
  onBack: () => void;
  onBackMateria: () => void;
  onBackTema: () => void;
  onGuardar: (contenido: string) => void;
}

const parseBloques = (contenido: string): Bloque[] => {
  if (!contenido) return [];
  try {
    const p = JSON.parse(contenido);
    if (p && p.bloques && Array.isArray(p.bloques)) {
      return p.bloques.map((b: any) => ({
        ...b,
        id: genId(),
        x: b.x ?? 80,
        y: b.y ?? 20,
        width: b.width ?? 600,
      }));
    }
    if (Array.isArray(p)) return p.map(b => ({ ...b, id: genId(), x: b.x ?? 80, y: b.y ?? 20, width: b.width ?? 600 }));
  } catch {}
  if (contenido.trim()) {
    return [{ id: genId(), tipo: 'texto', html: contenido, x: 80, y: 20, width: 600 }];
  }
  return [];
};

const parseCanvasData = (contenido: string): string | null => {
  if (!contenido) return null;
  try {
    const p = JSON.parse(contenido);
    if (p && p.canvasData) return p.canvasData;
  } catch {}
  return null;
};

export default function ApunteEditor({ apunte, materia, tema, onBack, onBackMateria, onBackTema, onGuardar }: Props) {
  const [bloques, setBloques] = useState<Bloque[]>(() => parseBloques(apunte.contenido));
  const [initialCanvasData] = useState<string | null>(() => parseCanvasData(apunte.contenido));
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
  const editorRef = useRef<HTMLDivElement>(null);
  const autoSaveTimer = useRef<any>(null);
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
    const canvasData = (window as any).__canvasExport?.() || null;
    const contenidoFinal = JSON.stringify({ bloques, canvasData });
    setGuardando(true);
    onGuardar(contenidoFinal);
    setTimeout(() => { setGuardando(false); setGuardado(true); }, 600);
  }, [bloques, onGuardar, syncCache]);

  const triggerAutoSave = useCallback(() => {
    setGuardado(false);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => guardar(), 3000);
  }, [guardar]);

  useEffect(() => {
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, []);

  // ✅ Siempre limpia newBlockId al eliminar
  const eliminarBloque = useCallback((id: string) => {
    setBloques(prev => prev.filter(b => b.id !== id));
    setNewBlockId(null);
    triggerAutoSave();
  }, [triggerAutoSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); guardar(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !isDrawingMode) (window as any).__editorUndo?.();
      if ((e.metaKey || e.ctrlKey) && e.key === 'y' && !isDrawingMode) (window as any).__editorRedo?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [guardar, isDrawingMode]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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

    const editorEl = editorRef.current;
    if (!editorEl) return;
    const rect = editorEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const id = genId();
    setBloques(prev => [...prev, {
      id,
      tipo: 'texto' as const,
      html: '',
      x: Math.max(4, x),
      y: Math.max(4, y),
      width: 300,
    }]);
    setNewBlockId(id);
    triggerAutoSave();
  }, [isDrawingMode, newBlockId, triggerAutoSave]);

  const handleTextInsert = useCallback((text: string, canvasY: number) => {
    if (!text.trim()) return;
    const htmlContent = text.split('\n').filter(l => l.trim()).map(l => `<p>${l}</p>`).join('');
    const id = genId();
    setBloques(prev => [...prev, { id, tipo: 'texto' as const, html: htmlContent, x: 80, y: canvasY, width: 500 }]);
    triggerAutoSave();
  }, [triggerAutoSave]);

  const addImagen = (src: string, label?: string) => {
    const editorEl = editorRef.current;
    const centerX = editorEl ? editorEl.clientWidth / 2 - 150 : 100;
    setBloques(prev => [...prev, {
      id: genId(), tipo: 'imagen' as const, src,
      width: isMobile ? 280 : 400,
      x: centerX, y: 100, label,
      align: 'center' as const, floating: false, zIndex: 2,
    }]);
    triggerAutoSave();
    setShowImage(false);
    setShowDrawingCanvas(false);
  };

  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); triggerAutoSave(); };
  const insertHtml = (html: string) => { document.execCommand('insertHTML', false, html); triggerAutoSave(); };
  const handleHerramienta = (h: Herramienta) => { syncCache(); setHerramienta(h); };

  return (
    <>
      {showDrawingCanvas && (
        <DrawingCanvas color={tema.color} onSave={(d) => addImagen(d, '🎨 Dibujo')} onClose={() => setShowDrawingCanvas(false)} />
      )}
      {showImage && (
        <ImageInserter color={tema.color} onInsert={(src) => addImagen(src)} onClose={() => setShowImage(false)} />
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

            <ExportMenu bloques={bloques} titulo={apunte.titulo} temaColor={tema.color} textRefs={textRefs} htmlCache={htmlCache} />

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

        {/* EDITOR CARD */}
        <div style={{
          background: 'white',
          borderRadius: '16px',
          border: isSelecting ? '2px solid #6366f1' : isDrawing ? `2px solid ${tema.color}` : '1px solid #e5e7eb',
          overflow: 'hidden',
          boxShadow: isSelecting ? '0 0 0 3px #6366f120' : isDrawing ? `0 0 0 3px ${tema.color}20` : '0 1px 4px rgba(0,0,0,0.06)',
          transition: 'border 0.2s, box-shadow 0.2s',
        }}>
          <div style={{ height: '3px', background: isSelecting ? '#6366f1' : tema.color }} />

          {/* TOOLBAR */}
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

          {/* ÁREA PRINCIPAL */}
          <div
            ref={editorRef}
            className="editor-area-principal"
            style={{
              position: 'relative',
              minHeight: isMobile ? '60vh' : '700px',
              background: 'white',
            }}
          >
            {/* Fondo papel */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, pointerEvents: 'none' }}>
              <PaperBackground style={paperStyle} temaColor={tema.color} />
            </div>

            {/* Canvas dibujo */}
            <EditorCanvas
              herramienta={herramienta}
              brushColor={brushColor}
              brushSize={brushSize}
              temaColor={tema.color}
              onChange={() => triggerAutoSave()}
              initialCanvasData={initialCanvasData}
              onTextInsert={handleTextInsert}
            />

            {/* ✅ CAPA BLOQUES + CLICK */}
            <div
              style={{
                position: 'absolute',
                top: 0, left: 0,
                width: '100%', height: '100%',
                zIndex: 10,
                pointerEvents: isDrawingMode ? 'none' : 'all',
              }}
              onClick={handleClick}
            >
              {bloques.map(b => {
                if (b.tipo === 'texto') {
                  return (
                    <TextBlock
                      key={b.id}
                      bloque={b as BloqueTexto}
                      temaColor={tema.color}
                      isNew={newBlockId === b.id}
                      onUpdate={(changes) => {
                        setBloques(prev => prev.map(bl =>
                          bl.id === b.id ? { ...bl, ...changes } : bl
                        ));
                        triggerAutoSave();
                      }}
                      onDelete={() => eliminarBloque(b.id)}
                      onFinishNew={() => setNewBlockId(null)}
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
                          background: tema.color, color: '#000',
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
          </div>

          {/* FOOTER */}
          <div style={{ padding: '8px 16px', borderTop: '1px solid #f3f4f6', background: '#fafafa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
              {bloques.length} bloques · {paperStyle === 'lined' ? '📋 Rayado' : paperStyle === 'grid' ? '⊞ Grid' : paperStyle === 'dotted' ? '⁚ Puntos' : '⬜ Libre'}
            </span>
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
              {isSelecting ? '🎯 Selecciona trazos' : isDrawing ? '🎨 Dibujando' : 'Click para escribir'}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}