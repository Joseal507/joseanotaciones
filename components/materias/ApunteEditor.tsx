'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Apunte, Materia, Tema } from '../../lib/storage';
import { Bloque, BloqueImagen, Herramienta, genId } from '../editor/types';
import Toolbar from '../editor/Toolbar';
import ImageBlock from '../editor/ImageBlock';
import EditorCanvas from '../editor/EditorCanvas';
import DrawingCanvas from '../editor/DrawingCanvas';
import ImageInserter from '../editor/ImageInserter';
import ExportMenu from '../editor/ExportMenu';
import { useIsMobile } from '../../hooks/useIsMobile';

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
  if (!contenido) return [{ id: genId(), tipo: 'texto', html: '' }];
  try {
    const p = JSON.parse(contenido);
    if (p && p.bloques && Array.isArray(p.bloques)) return p.bloques.map((b: any) => ({ ...b, id: genId() }));
    if (Array.isArray(p)) return p.map(b => ({ ...b, id: genId() }));
  } catch {}
  return [{ id: genId(), tipo: 'texto', html: contenido }];
};

const parseCanvasData = (contenido: string): string | null => {
  if (!contenido) return null;
  try {
    const p = JSON.parse(contenido);
    if (p && p.canvasData) return p.canvasData;
  } catch {}
  return null;
};

const BLOQUES_POR_PAGINA = 5;

function ImagenMobile({ bloque, temaColor, onUpdate, onDelete }: {
  bloque: BloqueImagen; temaColor: string;
  onUpdate: (changes: Partial<BloqueImagen>) => void; onDelete: () => void;
}) {
  const [width, setWidth] = useState(bloque.width);
  const [selected, setSelected] = useState(false);
  const [floating, setFloating] = useState(bloque.floating ?? false);
  const [pos, setPos] = useState({ x: bloque.x ?? 0, y: bloque.y ?? 0 });
  const [dragging, setDragging] = useState(false);
  const touchStart = useRef<{ x: number; w: number } | null>(null);
  const dragStart = useRef<{ touchX: number; touchY: number; elX: number; elY: number } | null>(null);
  const longPressTimer = useRef<any>(null);
  const posRef = useRef(pos);

  useEffect(() => { posRef.current = pos; }, [pos]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && !floating) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      touchStart.current = { x: dist, w: width };
    } else if (e.touches.length === 1 && floating) {
      dragStart.current = { touchX: e.touches[0].clientX, touchY: e.touches[0].clientY, elX: posRef.current.x, elY: posRef.current.y };
    } else if (e.touches.length === 1 && !floating) {
      longPressTimer.current = setTimeout(() => {
        setFloating(true);
        onUpdate({ floating: true, x: posRef.current.x, y: posRef.current.y });
        setDragging(true);
        dragStart.current = { touchX: e.touches[0].clientX, touchY: e.touches[0].clientY, elX: posRef.current.x, elY: posRef.current.y };
      }, 600);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 2 && touchStart.current) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setWidth(Math.max(80, Math.min(700, Math.round(touchStart.current.w * (dist / touchStart.current.x)))));
    } else if (e.touches.length === 1 && (dragging || floating) && dragStart.current) {
      const newPos = { x: dragStart.current.elX + e.touches[0].clientX - dragStart.current.touchX, y: dragStart.current.elY + e.touches[0].clientY - dragStart.current.touchY };
      setPos(newPos); posRef.current = newPos;
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (touchStart.current) { onUpdate({ width }); touchStart.current = null; }
    if (dragging || floating) { onUpdate({ x: posRef.current.x, y: posRef.current.y, floating: true }); setDragging(false); dragStart.current = null; }
  };

  const screenW = typeof window !== 'undefined' ? window.innerWidth : 400;
  const containerStyle: React.CSSProperties = floating
    ? { position: 'absolute', left: pos.x, top: pos.y, width: Math.min(width, screenW - 40), zIndex: 20, touchAction: 'none' }
    : { margin: '12px 0', textAlign: bloque.align === 'left' ? 'left' : bloque.align === 'right' ? 'right' : 'center', touchAction: 'none' };

  return (
    <div contentEditable={false} style={floating ? { position: 'relative' } : {}}>
      <div style={containerStyle} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onClick={() => setSelected(!selected)}>
        <div style={{ display: 'inline-block', maxWidth: '100%', position: 'relative' }}>
          <img src={bloque.src} draggable={false}
            style={{ width: floating ? '100%' : Math.min(width, screenW - 40) + 'px', maxWidth: '100%', borderRadius: '10px', border: selected ? `3px solid ${temaColor}` : `2px solid ${temaColor}44`, display: 'block' }} />
          {bloque.label && <div style={{ position: 'absolute', top: 8, left: 8, background: temaColor, color: '#000', padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 800 }}>{bloque.label}</div>}
        </div>
      </div>
      {selected && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => { setFloating(false); setPos({ x: 0, y: 0 }); onUpdate({ floating: false, x: 0, y: 0 }); setSelected(false); }}
            style={{ padding: '6px 12px', borderRadius: '8px', border: `2px solid ${temaColor}`, background: 'transparent', color: temaColor, fontSize: '12px', cursor: 'pointer', fontWeight: 700 }}>📄</button>
          <button onClick={() => { const nw = Math.max(80, width - 40); setWidth(nw); onUpdate({ width: nw }); }}
            style={{ padding: '6px 12px', borderRadius: '8px', border: `2px solid ${temaColor}`, background: 'transparent', color: temaColor, fontSize: '16px', cursor: 'pointer' }}>−</button>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{width}px</span>
          <button onClick={() => { const nw = Math.min(700, width + 40); setWidth(nw); onUpdate({ width: nw }); }}
            style={{ padding: '6px 12px', borderRadius: '8px', border: `2px solid ${temaColor}`, background: 'transparent', color: temaColor, fontSize: '16px', cursor: 'pointer' }}>+</button>
          <button onClick={onDelete}
            style={{ padding: '6px 14px', borderRadius: '8px', border: '2px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: '13px', cursor: 'pointer', fontWeight: 700 }}>🗑️</button>
        </div>
      )}
    </div>
  );
}

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
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [hojasRaya, setHojasRaya] = useState(false);
  const [tipoHoja, setTipoHoja] = useState<'raya' | 'cuadricula' | 'puntos'>('raya');
  const [mostrarPaginas, setMostrarPaginas] = useState(true);

  const textRefs = useRef<{ [id: string]: HTMLDivElement | null }>({});
  const htmlCache = useRef<{ [id: string]: string }>({});
  const editorRef = useRef<HTMLDivElement>(null);
  const autoSaveTimer = useRef<any>(null);
  const isMobile = useIsMobile();

  const isDrawing = ['boligrafo', 'marcador', 'lapiz', 'borrador'].includes(herramienta);
  const totalPaginas = Math.max(1, Math.ceil(bloques.length / BLOQUES_POR_PAGINA));

  // Margen izquierdo cuando hay rayas (espacio para la línea roja)
  const MARGEN_RAYA = isMobile ? 44 : 72;

  useEffect(() => {
    const renderKatex = async () => {
      try {
        const katex = (await import('katex')).default;
        document.querySelectorAll('.latex-formula[data-formula]').forEach(el => {
          const formula = el.getAttribute('data-formula') || '';
          try { el.innerHTML = katex.renderToString(formula, { throwOnError: false, displayMode: false }); } catch {}
        });
      } catch {}
    };
    const timer = setTimeout(renderKatex, 500);
    return () => clearTimeout(timer);
  }, [bloques]);

  const syncCache = useCallback(() => {
    Object.keys(textRefs.current).forEach(id => {
      const el = textRefs.current[id];
      if (el) htmlCache.current[id] = el.innerHTML;
    });
  }, []);

  const guardar = useCallback(() => {
    syncCache();
    const synced = bloques.map(b => {
      if (b.tipo === 'texto') return { ...b, html: htmlCache.current[b.id] ?? (b as any).html ?? '' };
      return b;
    });
    const canvasData = (window as any).__canvasExport?.() || null;
    const contenidoFinal = JSON.stringify({ bloques: synced, canvasData });
    setGuardando(true);
    onGuardar(contenidoFinal);
    setTimeout(() => { setGuardando(false); setGuardado(true); }, 600);
  }, [bloques, onGuardar, syncCache]);

  const triggerAutoSave = useCallback(() => {
    setGuardado(false);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { guardar(); }, 3000);
  }, [guardar]);

  useEffect(() => {
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, []);

  const eliminarBloque = useCallback((id: string) => {
    syncCache();
    setBloques(prev => {
      const f = prev.filter(b => b.id !== id);
      return f.length === 0 ? [{ id: genId(), tipo: 'texto', html: '' }] : f;
    });
    triggerAutoSave();
  }, [syncCache, triggerAutoSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); guardar(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !isDrawing) { (window as any).__editorUndo?.(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y' && !isDrawing) { (window as any).__editorRedo?.(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedImageId) {
        const active = document.activeElement;
        const isEditable = active?.getAttribute('contenteditable') === 'true' || ['INPUT', 'TEXTAREA'].includes(active?.tagName || '');
        if (!isEditable) { e.preventDefault(); eliminarBloque(selectedImageId); setSelectedImageId(null); }
      }
      if (e.key === 'Escape') setSelectedImageId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [guardar, selectedImageId, isDrawing, eliminarBloque]);

  const addTexto = (afterIdx: number) => {
    syncCache();
    const id = genId();
    htmlCache.current[id] = '';
    setBloques(prev => { const next = [...prev]; next.splice(afterIdx + 1, 0, { id, tipo: 'texto', html: '' }); return next; });
    triggerAutoSave();
    setTimeout(() => textRefs.current[id]?.focus(), 50);
  };

  const addImagen = (src: string, label?: string) => {
    syncCache();
    setBloques(prev => [
      ...prev,
      { id: genId(), tipo: 'imagen', src, width: isMobile ? 300 : 500, align: 'center', label, floating: false, zIndex: 2, x: 0, y: 0 } as BloqueImagen,
      { id: genId(), tipo: 'texto', html: '' },
    ]);
    triggerAutoSave();
    setShowImage(false);
    setShowDrawingCanvas(false);
  };

  const updateImagen = (id: string, changes: Partial<BloqueImagen>) => {
    setBloques(prev => prev.map(b => b.id === id ? { ...b, ...changes } as Bloque : b));
    triggerAutoSave();
  };

  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); triggerAutoSave(); };
  const insertHtml = (html: string) => { document.execCommand('insertHTML', false, html); triggerAutoSave(); };
  const handleHerramienta = (h: Herramienta) => { syncCache(); setHerramienta(h); };

  const getBackgroundImage = () => {
    if (!hojasRaya) return 'none';
    if (tipoHoja === 'raya') return 'repeating-linear-gradient(transparent, transparent 31px, #b8cfe0 31px, #b8cfe0 32px)';
    if (tipoHoja === 'cuadricula') return 'repeating-linear-gradient(transparent, transparent 31px, #b8cfe0 31px, #b8cfe0 32px), repeating-linear-gradient(90deg, transparent, transparent 31px, #b8cfe0 31px, #b8cfe0 32px)';
    return 'radial-gradient(circle, #94b4cc 1.2px, transparent 1.2px)';
  };

  const getBackgroundSize = () => {
    if (!hojasRaya) return 'auto';
    if (tipoHoja === 'puntos') return '32px 32px';
    return '100% 32px';
  };

  const renderBloques = () => {
    const resultado: React.ReactNode[] = [];

    bloques.forEach((bloque, idx) => {
      if (mostrarPaginas && idx > 0 && idx % BLOQUES_POR_PAGINA === 0) {
        const numPagina = Math.floor(idx / BLOQUES_POR_PAGINA);
        resultado.push(
          <div key={`page-${idx}`} style={{
            margin: '32px 0',
            position: 'relative',
            pointerEvents: 'none',
            userSelect: 'none',
          }}>
            <div style={{
              width: '100%',
              borderTop: '2px dashed #ccc',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{
                position: 'absolute',
                background: '#f0f4f8',
                border: '1px solid #ccc',
                borderRadius: '20px',
                padding: '3px 14px',
                fontSize: '11px',
                color: '#888',
                fontWeight: 700,
                letterSpacing: '0.5px',
                top: '-11px',
              }}>
                📄 Página {numPagina} · {numPagina + 1} de {totalPaginas}
              </span>
            </div>
            <div style={{
              height: '18px',
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.04), transparent)',
              marginTop: '18px',
            }} />
          </div>
        );
      }

      resultado.push(
        <div key={bloque.id} style={{ position: 'relative', zIndex: bloque.tipo === 'imagen' ? ((bloque as BloqueImagen).zIndex ?? 2) : 1 }}>
          {bloque.tipo === 'texto' && (
            <div
              ref={el => {
                textRefs.current[bloque.id] = el;
                if (el && el.innerHTML === '') el.innerHTML = htmlCache.current[bloque.id] ?? (bloque as any).html ?? '';
              }}
              contentEditable
              suppressContentEditableWarning
              className="ebloque"
              onInput={e => { htmlCache.current[bloque.id] = (e.currentTarget as HTMLDivElement).innerHTML; triggerAutoSave(); }}
              onFocus={() => setSelectedImageId(null)}
              style={{
                fontFamily: 'Georgia, serif',
                fontSize: isMobile ? '15px' : '16px',
                lineHeight: hojasRaya ? '32px' : '1.8',
                color: '#222',
                padding: '2px 0',
                width: '100%',
                WebkitUserSelect: 'text',
                userSelect: 'text',
                // ✅ Sangría: cuando hay raya, el texto empieza después de la línea roja
                paddingLeft: hojasRaya && tipoHoja === 'raya' ? `${MARGEN_RAYA - (isMobile ? 16 : 44) + 16}px` : '0px',
                boxSizing: 'border-box',
              }}
            />
          )}

          {bloque.tipo === 'imagen' && (
            <div
              onClick={(e) => { e.stopPropagation(); setSelectedImageId(bloque.id === selectedImageId ? null : bloque.id); }}
              style={{ outline: selectedImageId === bloque.id ? `3px solid ${tema.color}` : 'none', borderRadius: '12px', transition: 'outline 0.15s' }}
            >
              {isMobile ? (
                <ImagenMobile bloque={bloque as BloqueImagen} temaColor={tema.color}
                  onUpdate={(changes) => updateImagen(bloque.id, changes)}
                  onDelete={() => { eliminarBloque(bloque.id); setSelectedImageId(null); }} />
              ) : (
                <div>
                  <ImageBlock bloque={bloque as BloqueImagen} temaColor={tema.color}
                    onUpdate={(changes) => updateImagen(bloque.id, changes)}
                    onDelete={() => { eliminarBloque(bloque.id); setSelectedImageId(null); }} />
                  {selectedImageId === bloque.id && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '8px' }}>
                      <button onClick={(e) => { e.stopPropagation(); eliminarBloque(bloque.id); setSelectedImageId(null); }}
                        style={{ padding: '7px 18px', borderRadius: '8px', border: '2px solid var(--red)', background: 'var(--red-dim)', color: 'var(--red)', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                        🗑️ Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    });

    return resultado;
  };

  return (
    <>
      {showDrawingCanvas && <DrawingCanvas color={tema.color} onSave={(d) => addImagen(d, '🎨 Dibujo')} onClose={() => setShowDrawingCanvas(false)} />}
      {showImage && <ImageInserter color={tema.color} onInsert={(src) => addImagen(src)} onClose={() => setShowImage(false)} />}

      <div style={{ maxWidth: '1080px', margin: '0 auto' }}>

        {/* BREADCRUMB */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>📚 {!isMobile && 'Materias'}</button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackMateria} style={{ background: 'none', border: 'none', color: materia.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px', maxWidth: isMobile ? '90px' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{materia.emoji} {materia.nombre}</button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackTema} style={{ background: 'none', border: 'none', color: tema.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px', maxWidth: isMobile ? '90px' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {tema.nombre}</button>
          {!isMobile && <><span style={{ color: 'var(--text-faint)' }}>/</span><span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>✏️ {apunte.titulo}</span></>}
        </div>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
            <div style={{ width: '4px', height: '28px', background: tema.color, borderRadius: '2px', flexShrink: 0 }} />
            <h1 style={{ fontSize: isMobile ? '16px' : '22px', fontWeight: 900, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{apunte.titulo}</h1>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
            {isDrawing && (
              <div style={{ background: tema.color + '25', padding: '5px 10px', borderRadius: '8px', border: `1px solid ${tema.color}`, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: tema.color, fontWeight: 700 }}>{isMobile ? '🎨' : '🎨 Dibujando'}</span>
                <button onClick={() => handleHerramienta('texto')}
                  style={{ background: tema.color, border: 'none', color: '#000', padding: '2px 8px', borderRadius: '5px', fontWeight: 800, fontSize: '11px', cursor: 'pointer' }}>✅ Texto</button>
              </div>
            )}

            {/* BOTÓN HOJAS DE RAYA */}
            <button
              onClick={() => setHojasRaya(!hojasRaya)}
              title={hojasRaya ? 'Quitar rayas' : 'Hojas de raya'}
              style={{
                padding: isMobile ? '8px' : '8px 12px', borderRadius: '10px',
                border: `2px solid ${hojasRaya ? tema.color : 'var(--border-color)'}`,
                background: hojasRaya ? tema.color + '20' : 'transparent',
                color: hojasRaya ? tema.color : 'var(--text-muted)',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
              📓 {!isMobile && (hojasRaya ? 'Rayas ON' : 'Rayas')}
            </button>

            {/* BOTÓN PÁGINAS */}
            <button
              onClick={() => setMostrarPaginas(!mostrarPaginas)}
              title={mostrarPaginas ? 'Ocultar páginas' : 'Mostrar páginas'}
              style={{
                padding: isMobile ? '8px' : '8px 12px', borderRadius: '10px',
                border: `2px solid ${mostrarPaginas ? tema.color : 'var(--border-color)'}`,
                background: mostrarPaginas ? tema.color + '20' : 'transparent',
                color: mostrarPaginas ? tema.color : 'var(--text-muted)',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
              📄 {!isMobile && `Pág ${totalPaginas}`}
            </button>

            <span style={{ fontSize: '11px', color: guardando ? 'var(--gold)' : guardado ? '#4ade80' : 'var(--gold)', fontWeight: 600 }}>
              {guardando ? '💾...' : guardado ? '✓' : '●'}
            </span>
            <ExportMenu bloques={bloques} titulo={apunte.titulo} temaColor={tema.color} textRefs={textRefs} htmlCache={htmlCache} />
            <button onClick={guardar}
              style={{ padding: isMobile ? '8px 14px' : '9px 20px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontSize: isMobile ? '12px' : '13px', fontWeight: 800, cursor: 'pointer' }}>
              💾 {!isMobile && 'Guardar'}
            </button>
          </div>
        </div>

        {/* EDITOR */}
        <div style={{
          background: 'var(--bg-card)', borderRadius: '16px',
          border: `2px solid ${isDrawing ? tema.color : 'var(--border-color)'}`,
          overflow: 'hidden',
          boxShadow: isDrawing ? `0 0 0 3px ${tema.color}30` : '0 4px 20px rgba(0,0,0,0.1)',
          transition: 'border 0.3s, box-shadow 0.3s',
        }}>
          <div style={{ height: '4px', background: tema.color }} />

          {/* TOOLBAR */}
          <div style={{ overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch' as any }}>
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

          {/* Selector tipo hoja */}
          {hojasRaya && (
            <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>Tipo de hoja:</span>
              {([
                { key: 'raya', label: '📓 Raya' },
                { key: 'cuadricula', label: '📐 Cuadrícula' },
                { key: 'puntos', label: '⠿ Puntos' },
              ] as const).map(t => (
                <button key={t.key} onClick={() => setTipoHoja(t.key)}
                  style={{
                    padding: '5px 12px', borderRadius: '8px',
                    border: `2px solid ${tipoHoja === t.key ? tema.color : '#e2e8f0'}`,
                    background: tipoHoja === t.key ? tema.color + '20' : 'white',
                    color: tipoHoja === t.key ? tema.color : '#64748b',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <style>{`
            .ebloque { outline: none; min-height: 28px; }
            .ebloque:empty:before { content: 'Escribe aquí...'; color: #999; font-style: italic; pointer-events: none; }
            .ebloque h1 { font-size: ${isMobile ? '22px' : '28px'}; font-weight: 900; color: ${tema.color}; margin: 12px 0 6px; }
            .ebloque h2 { font-size: ${isMobile ? '18px' : '22px'}; font-weight: 800; color: #111; margin: 10px 0 5px; padding-bottom: 4px; border-bottom: 3px solid ${tema.color}44; }
            .ebloque h3 { font-size: ${isMobile ? '15px' : '17px'}; font-weight: 800; color: #111; margin: 8px 0 4px; }
            .ebloque p { margin: 4px 0; line-height: 1.7; color: #222; font-size: ${isMobile ? '15px' : '16px'}; }
            .ebloque ul { padding-left: 20px; margin: 6px 0; list-style-type: disc; }
            .ebloque ol { padding-left: 20px; margin: 6px 0; list-style-type: decimal; }
            .ebloque li { color: #222 !important; padding: 2px 0; line-height: 1.6; font-size: ${isMobile ? '15px' : '16px'}; }
            .ebloque li::marker { color: ${tema.color}; }
            .ebloque b, .ebloque strong { color: #111; font-weight: 800; }
            .ebloque i, .ebloque em { color: #333; }
            .ebloque u { text-decoration-color: ${tema.color}; color: #222; }
            .ebloque s { color: #555; }
            .ebloque hr { border: none; border-top: 2px solid #ddd; margin: 16px 0; }
            .ebloque blockquote { border-left: 4px solid ${tema.color}; padding: 8px 14px; margin: 8px 0; color: #555; font-style: italic; border-radius: 0 8px 8px 0; background: #f8f8f8; }
            .ebloque span { color: inherit; }
            .ebloque a { color: #06c; text-decoration: underline; }
            .latex-formula { display: inline-block; background: #f0f4ff; border: 1px solid #d0d8ff; border-radius: 6px; padding: 2px 10px; font-size: 14px; cursor: default; user-select: none; }
          `}</style>

          {/* ÁREA PRINCIPAL */}
          <div ref={editorRef} style={{ position: 'relative', minHeight: isMobile ? '60vh' : '600px' }}>

            <EditorCanvas
              herramienta={herramienta}
              brushColor={brushColor}
              brushSize={brushSize}
              temaColor={tema.color}
              onChange={() => triggerAutoSave()}
              initialCanvasData={initialCanvasData}
            />

            {/* Contenido */}
            <div
              style={{
                // ✅ Padding izquierdo extra cuando hay línea roja de raya
                paddingTop: isMobile ? '16px' : '28px',
                paddingBottom: isMobile ? '16px' : '28px',
                paddingRight: isMobile ? '16px' : '44px',
                paddingLeft: hojasRaya && tipoHoja === 'raya'
                  ? `${MARGEN_RAYA}px`
                  : isMobile ? '16px' : '44px',
                pointerEvents: isDrawing ? 'none' : 'all',
                position: 'relative', zIndex: 1,
                background: '#ffffff',
                backgroundImage: getBackgroundImage(),
                backgroundSize: getBackgroundSize(),
                minHeight: isMobile ? '60vh' : '600px',
                transition: 'padding-left 0.3s, background-image 0.3s',
                boxSizing: 'border-box',
              }}
              onClick={() => { if (!isDrawing) setSelectedImageId(null); }}
            >
              {/* Línea roja de margen */}
              {hojasRaya && tipoHoja === 'raya' && (
                <div style={{
                  position: 'absolute',
                  left: `${MARGEN_RAYA - 12}px`,
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  background: '#ff9999',
                  pointerEvents: 'none',
                  zIndex: 0,
                }} />
              )}

              {renderBloques()}

              {/* Botones agregar */}
              {isMobile ? (
                <div style={{ display: 'flex', gap: '8px', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #eee' }}>
                  <button onClick={() => addTexto(bloques.length - 1)} style={{ flex: 1, padding: '11px', borderRadius: '10px', border: `2px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>+ Texto</button>
                  <button onClick={() => { syncCache(); setShowImage(true); }} style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer' }}>🖼️</button>
                  <button onClick={() => { syncCache(); setShowDrawingCanvas(true); }} style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer' }}>🎨</button>
                </div>
              ) : (
                <div style={{ marginTop: '40px', display: 'flex', alignItems: 'center', gap: '8px', opacity: 0, transition: 'opacity 0.3s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '0'}>
                  <div style={{ flex: 1, height: '1px', background: '#ddd' }} />
                  <button onClick={() => addTexto(bloques.length - 1)} style={{ padding: '4px 12px', borderRadius: '8px', border: `1px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>+ texto</button>
                  <button onClick={() => { syncCache(); setShowImage(true); }} style={{ padding: '4px 12px', borderRadius: '8px', border: '1px solid #ccc', background: 'transparent', color: '#888', fontSize: '12px', cursor: 'pointer' }}>+ imagen</button>
                  <button onClick={() => { syncCache(); setShowDrawingCanvas(true); }} style={{ padding: '4px 12px', borderRadius: '8px', border: '1px solid #ccc', background: 'transparent', color: '#888', fontSize: '12px', cursor: 'pointer' }}>+ dibujo</button>
                  <div style={{ flex: 1, height: '1px', background: '#ddd' }} />
                </div>
              )}
            </div>
          </div>

          {/* FOOTER */}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
              {bloques.length} bloques · {bloques.filter(b => b.tipo === 'imagen').length} imágenes · 📄 {totalPaginas} pág.
              {(window as any).__canvasHasStrokes?.() && ' · 🎨 trazos'}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
              {isDrawing
                ? '🎨 Dibujando · ✅ para volver a texto'
                : isMobile ? 'Auto-guardado ✓' : 'Auto-guardado · Cmd+S · Delete para borrar imágenes'}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}