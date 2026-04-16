'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { Herramienta } from './types';
import {
  Point, Stroke, SelectionRect, genStrokeId, calcBounds,
  applyStrokeStyle, drawStrokeOnCtx, drawSelectionRect, getPosFromPointer,
  isPointNearStroke, drawStrokeErasePreview
} from './canvasUtils';
import SelectionMenu from './SelectionMenu';

interface Props {
  herramienta: Herramienta;
  brushColor: string;
  brushSize: number;
  temaColor: string;
  onChange: () => void;
  onTextInsert?: (text: string, canvasY: number) => void;
  initialCanvasData?: string | null;
  onRegisterExport?: (fn: () => string | null) => void;
}

export default function EditorCanvas({
  herramienta, brushColor, brushSize, temaColor, onChange, onTextInsert, initialCanvasData, onRegisterExport
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[][]>([]);
  const currentStroke = useRef<Stroke | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<Point | null>(null);
  const activePenId = useRef<number | null>(null);
  const initialized = useRef(false);

  const erasingStrokes = useRef<Set<string>>(new Set());
  const isErasingMode = useRef(false);

  const selecting = useRef(false);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const movingRef = useRef(false);
  const moveStart = useRef<{ x: number; y: number } | null>(null);

  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const selectionRectRef = useRef<SelectionRect | null>(null);
  const [selectedStrokes, setSelectedStrokes] = useState<string[]>([]);
  const selectedStrokesRef = useRef<string[]>([]);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [converting, setConverting] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);

  const isDrawingTool = ['boligrafo', 'marcador', 'lapiz', 'borrador'].includes(herramienta);
  const isSelecting = herramienta === 'seleccion';
  const isCanvasActive = isDrawingTool || isSelecting;

  const updateSelectionRect = (r: SelectionRect | null) => {
    selectionRectRef.current = r;
    setSelectionRect(r);
  };
  const updateSelectedStrokes = (ids: string[]) => {
    selectedStrokesRef.current = ids;
    setSelectedStrokes(ids);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !overlay) return;

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    canvas.width = w; canvas.height = h;
    overlay.width = w; overlay.height = h;

    if (initialCanvasData && !initialized.current) {
      initialized.current = true;
      const img = new Image();
      img.onload = () => { canvasRef.current?.getContext('2d')?.drawImage(img, 0, 0, w, h); };
      img.src = initialCanvasData;
    }

    const observer = new ResizeObserver(() => {
      const nW = container.clientWidth;
      const nH = container.clientHeight;
      if (nW === canvas.width && nH === canvas.height) return;
      const ctx = canvas.getContext('2d');
      let data: ImageData | null = null;
      if (ctx && canvas.width > 0) try { data = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch {}
      canvas.width = nW; canvas.height = nH;
      overlay.width = nW; overlay.height = nH;
      if (ctx && data) ctx.putImageData(data, 0, 0);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [initialCanvasData]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach(s => {
      if (erasingStrokes.current.has(s.id)) {
        drawStrokeErasePreview(ctx, s);
      } else {
        drawStrokeOnCtx(ctx, s, selectedStrokesRef.current.includes(s.id));
      }
    });
  }, []);

  const redrawOverlay = useCallback((rect: SelectionRect | null) => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (rect) drawSelectionRect(ctx, rect);
  }, []);

  const getPos = (e: PointerEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, pressure: 1 };
    return getPosFromPointer(e, canvas);
  };

  // ✅ CLAVE: solo ignorar touch (dedos/palma)
  // El pencil SIEMPRE dibuja
  // Los dedos SIEMPRE van al wrapper para scroll/zoom
  const shouldIgnore = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return true;
    if (activePenId.current !== null && e.pointerId !== activePenId.current) return true;
    return false;
  };

  const startDraw = useCallback((e: PointerEvent) => {
    if (!isDrawingTool && !isSelecting) return;
    if (shouldIgnore(e)) return;

    const isEraserBtn = e.button === 5 || e.buttons === 32;
    const efectiveTool = isEraserBtn ? 'borrador' : herramienta;

    if (e.pointerType === 'pen') activePenId.current = e.pointerId;

    e.preventDefault();
    const pos = getPos(e);

    // ✅ Borrador por trazo - SIN confirmación, borra inmediatamente
    if (efectiveTool === 'borrador') {
      isErasingMode.current = true;
      erasingStrokes.current = new Set();
      const found = strokesRef.current.find(s =>
        isPointNearStroke(pos.x, pos.y, s, brushSize * 3 + 10)
      );
      if (found) {
        erasingStrokes.current.add(found.id);
        redraw();
      }
      try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
      return;
    }

    if (isSelecting) {
      const rect = selectionRectRef.current;
      if (rect && selectedStrokesRef.current.length > 0) {
        if (pos.x >= rect.x && pos.x <= rect.x + rect.w &&
          pos.y >= rect.y && pos.y <= rect.y + rect.h) {
          movingRef.current = true;
          moveStart.current = pos;
          return;
        }
      }
      updateSelectionRect(null);
      updateSelectedStrokes([]);
      setMenuPos(null);
      redrawOverlay(null);
      movingRef.current = false;
      moveStart.current = null;
      selecting.current = true;
      selectionStart.current = pos;
      return;
    }

    updateSelectionRect(null);
    updateSelectedStrokes([]);
    setMenuPos(null);
    redrawOverlay(null);
    drawing.current = true;
    lastPoint.current = pos;
    redoRef.current = [];

    currentStroke.current = {
      id: genStrokeId(),
      points: [pos],
      color: brushColor,
      size: brushSize,
      tipo: efectiveTool,
    };
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
  }, [isDrawingTool, isSelecting, herramienta, brushColor, brushSize, redrawOverlay, redraw]);

  const drawMove = useCallback((e: PointerEvent) => {
    if (shouldIgnore(e)) return;
    e.preventDefault();
    const pos = getPos(e);

    // Borrador: marcar trazos mientras se arrastra
    if (isErasingMode.current) {
      const found = strokesRef.current.find(s =>
        isPointNearStroke(pos.x, pos.y, s, brushSize * 3 + 10)
      );
      if (found && !erasingStrokes.current.has(found.id)) {
        erasingStrokes.current.add(found.id);
        redraw();
      }
      return;
    }

    if (movingRef.current && moveStart.current) {
      const rect = selectionRectRef.current;
      if (!rect) return;
      const dx = pos.x - moveStart.current.x;
      const dy = pos.y - moveStart.current.y;
      moveStart.current = pos;
      strokesRef.current = strokesRef.current.map(s => {
        if (!selectedStrokesRef.current.includes(s.id)) return s;
        return {
          ...s,
          points: s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })),
          bounds: s.bounds ? { x: s.bounds.x + dx, y: s.bounds.y + dy, w: s.bounds.w, h: s.bounds.h } : undefined,
        };
      });
      const newRect = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
      updateSelectionRect(newRect);
      redrawOverlay(newRect);
      redraw();
      return;
    }

    if (selecting.current && selectionStart.current) {
      const start = selectionStart.current;
      const rect: SelectionRect = {
        x: Math.min(start.x, pos.x),
        y: Math.min(start.y, pos.y),
        w: Math.abs(pos.x - start.x),
        h: Math.abs(pos.y - start.y),
      };
      updateSelectionRect(rect);
      redrawOverlay(rect);
      return;
    }

    if (!drawing.current || !currentStroke.current) return;
    const last = lastPoint.current;
    if (!last) return;
    const dist = Math.sqrt((pos.x - last.x) ** 2 + (pos.y - last.y) ** 2);
    if (dist < 1) return;

    currentStroke.current.points.push(pos);
    lastPoint.current = pos;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const pts = currentStroke.current.points;
    ctx.save();
    applyStrokeStyle(ctx, currentStroke.current.tipo, currentStroke.current.color, currentStroke.current.size, pos.pressure);
    if (pts.length >= 3) {
      const p1 = pts[pts.length - 3];
      const p2 = pts[pts.length - 2];
      const p3 = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      ctx.quadraticCurveTo(p2.x, p2.y, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    ctx.restore();
  }, [redraw, redrawOverlay, brushSize]);

  const stopDraw = useCallback((e: PointerEvent) => {
    if (e.pointerId === activePenId.current) activePenId.current = null;

    // ✅ Borrador: borra SIN confirmación
    if (isErasingMode.current) {
      isErasingMode.current = false;
      if (erasingStrokes.current.size > 0) {
        const toDelete = new Set(erasingStrokes.current);
        strokesRef.current = strokesRef.current.filter(s => !toDelete.has(s.id));
        erasingStrokes.current = new Set();
        setStrokeCount(strokesRef.current.length);
        redraw();
        onChange();
      }
      erasingStrokes.current = new Set();
      return;
    }

    if (movingRef.current) {
      movingRef.current = false;
      moveStart.current = null;
      redoRef.current = [];
      onChange();
      return;
    }

    if (selecting.current) {
      selecting.current = false;
      const rect = selectionRectRef.current;
      selectionStart.current = null;

      if (!rect || rect.w < 8 || rect.h < 8) {
        updateSelectionRect(null);
        updateSelectedStrokes([]);
        setMenuPos(null);
        redrawOverlay(null);
        return;
      }

      const found = strokesRef.current
        .filter(s => {
          const b = s.bounds || calcBounds(s.points);
          return (
            b.x < rect.x + rect.w && b.x + b.w > rect.x &&
            b.y < rect.y + rect.h && b.y + b.h > rect.y
          );
        })
        .map(s => s.id);

      updateSelectedStrokes(found);
      if (found.length > 0) {
        setMenuPos({ x: rect.x + rect.w / 2, y: rect.y + rect.h + 14 });
      } else {
        updateSelectionRect(null);
        setMenuPos(null);
        redrawOverlay(null);
      }
      return;
    }

    if (!drawing.current || !currentStroke.current) return;
    drawing.current = false;

    if (currentStroke.current.points.length > 1) {
      const stroke = { ...currentStroke.current, bounds: calcBounds(currentStroke.current.points) };
      strokesRef.current.push(stroke);
      setStrokeCount(strokesRef.current.length);
      onChange();
    }
    currentStroke.current = null;
    lastPoint.current = null;
    redraw();
  }, [redraw, redrawOverlay, onChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const target = isSelecting ? overlay : canvas;
    const onDown = (e: PointerEvent) => startDraw(e);
    const onMove = (e: PointerEvent) => drawMove(e);
    const onUp = (e: PointerEvent) => stopDraw(e);
    const onCancel = (e: PointerEvent) => {
      movingRef.current = false;
      selecting.current = false;
      drawing.current = false;
      isErasingMode.current = false;
      erasingStrokes.current = new Set();
      if (e.pointerId === activePenId.current) activePenId.current = null;
    };

    target.addEventListener('pointerdown', onDown, { passive: false });
    target.addEventListener('pointermove', onMove, { passive: false });
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    return () => {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    };
  }, [startDraw, drawMove, stopDraw, isSelecting]);

  const undo = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    redoRef.current.push([strokesRef.current.pop()!]);
    setStrokeCount(strokesRef.current.length);
    updateSelectionRect(null);
    updateSelectedStrokes([]);
    setMenuPos(null);
    redrawOverlay(null);
    redraw();
    onChange();
  }, [redraw, redrawOverlay, onChange]);

  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    strokesRef.current.push(...redoRef.current.pop()!);
    setStrokeCount(strokesRef.current.length);
    redraw();
    onChange();
  }, [redraw, onChange]);

  const deleteSelection = useCallback(() => {
    strokesRef.current = strokesRef.current.filter(s => !selectedStrokesRef.current.includes(s.id));
    updateSelectedStrokes([]);
    updateSelectionRect(null);
    setMenuPos(null);
    redrawOverlay(null);
    redraw();
    setStrokeCount(strokesRef.current.length);
    onChange();
  }, [redraw, redrawOverlay, onChange]);

  const getCroppedCanvas = (): string | null => {
    const rect = selectionRectRef.current;
    if (!rect || !canvasRef.current) return null;
    const src = canvasRef.current;
    const crop = document.createElement('canvas');
    const pad = 12;
    crop.width = rect.w + pad * 2;
    crop.height = rect.h + pad * 2;
    const ctx = crop.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, crop.width, crop.height);
    ctx.drawImage(src, rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2, 0, 0, crop.width, crop.height);
    return crop.toDataURL('image/png');
  };

  const convertToText = async () => {
    const imageData = getCroppedCanvas();
    const rect = selectionRectRef.current;
    if (!imageData || !rect) return;
    setConverting(true);
    try {
      const base64 = imageData.split(',')[1];
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: 'Read and transcribe EXACTLY all the handwritten text in this image. Return ONLY the transcribed text, nothing else. Preserve line breaks. If unclear write [illegible].',
          contexto: null, historial: [], perfil: null, todosDocumentos: [],
          idioma: 'en', imageBase64: base64, imageMime: 'image/png',
        }),
      });
      const data = await res.json();
      if (data.success && data.respuesta) {
        onTextInsert?.(data.respuesta.trim(), rect.y);
        deleteSelection();
      }
    } catch (err) { console.error('Error converting:', err); }
    finally { setConverting(false); }
  };

  useEffect(() => {
    (window as any).__editorUndo = undo;
    (window as any).__editorRedo = redo;
    (window as any).__canvasHasStrokes = () => strokesRef.current.length > 0;
    (window as any).__canvasExport = () => {
      const canvas = canvasRef.current;
      if (!canvas || strokesRef.current.length === 0) return null;
      return canvas.toDataURL('image/png');
    };
    if (onRegisterExport) {
      onRegisterExport(() => {
        const canvas = canvasRef.current;
        if (!canvas || strokesRef.current.length === 0) return null;
        return canvas.toDataURL('image/png');
      });
    }
  }, [undo, redo, onRegisterExport]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isDrawingTool && !isSelecting) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); e.stopPropagation(); redo(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedStrokesRef.current.length > 0) {
        const active = document.activeElement;
        const isEditable = active?.getAttribute('contenteditable') === 'true' || ['INPUT', 'TEXTAREA'].includes(active?.tagName || '');
        if (!isEditable) { e.preventDefault(); deleteSelection(); }
      }
      if (e.key === 'Escape') {
        updateSelectionRect(null); updateSelectedStrokes([]);
        setMenuPos(null); redrawOverlay(null); movingRef.current = false;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isDrawingTool, isSelecting, undo, redo, deleteSelection, redrawOverlay]);

  useEffect(() => { redraw(); }, [selectedStrokes, redraw]);

  const getCursor = () => {
    if (movingRef.current) return 'grabbing';
    if (isSelecting && selectionRect && selectedStrokes.length > 0) return 'grab';
    if (isSelecting) return 'crosshair';
    if (herramienta === 'borrador') return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='20' viewBox='0 0 28 20'%3E%3Crect x='1' y='1' width='26' height='18' rx='3' fill='white' stroke='%23d1d5db' stroke-width='1.5'/%3E%3Crect x='1' y='1' width='9' height='18' rx='3' fill='%23f3f4f6' stroke='%23d1d5db' stroke-width='1.5'/%3E%3C/svg%3E") 14 10, cell`;
    if (isDrawingTool) return 'crosshair';
    return 'default';
  };

  return (
    <div ref={containerRef} style={{
      position: 'absolute', top: 0, left: 0,
      width: '100%', height: '100%',
      pointerEvents: isCanvasActive ? 'all' : 'none',
      zIndex: isCanvasActive ? 20 : 1,
      // ✅ CLAVE: none para capturar Pencil
      // Los dedos (touch) son ignorados en shouldIgnore
      // y pasan al wrapper para scroll/zoom
      touchAction: 'none',
    }}>
      <canvas ref={canvasRef} style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        touchAction: 'none',
        background: 'transparent',
        cursor: isSelecting ? 'default' : getCursor(),
        pointerEvents: (!isCanvasActive) ? 'none' : (isSelecting ? 'none' : 'all'),
      }} />

      <canvas ref={overlayRef} style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        touchAction: 'none',
        background: 'transparent',
        cursor: getCursor(),
        pointerEvents: (!isCanvasActive) ? 'none' : (isSelecting ? 'all' : 'none'),
      }} />

      {menuPos && selectedStrokes.length > 0 && (
        <SelectionMenu
          menuPos={menuPos}
          converting={converting}
          onMove={() => { movingRef.current = true; moveStart.current = null; setMenuPos(null); }}
          onConvert={convertToText}
          onSave={() => {
            const img = getCroppedCanvas();
            if (!img) return;
            const a = document.createElement('a');
            a.download = 'dibujo.png'; a.href = img; a.click();
          }}
          onDelete={deleteSelection}
        />
      )}

      {(isDrawingTool || isSelecting) && (
        <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: '6px', zIndex: 30 }}>
          <button onClick={undo} title="Undo"
            style={{ padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #e5e7eb', background: 'rgba(255,255,255,0.96)', color: '#374151', cursor: 'pointer', backdropFilter: 'blur(8px)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>
          </button>
          <button onClick={redo} title="Redo"
            style={{ padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #e5e7eb', background: 'rgba(255,255,255,0.96)', color: '#374151', cursor: 'pointer', backdropFilter: 'blur(8px)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/></svg>
          </button>
          {strokeCount > 0 && (
            <div style={{ padding: '7px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.96)', color: '#9ca3af', fontSize: '11px', backdropFilter: 'blur(8px)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center' }}>
              {strokeCount}
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}