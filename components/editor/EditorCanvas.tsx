'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { Herramienta } from './types';
import {
  Point, Stroke, SelectionRect, genStrokeId, calcBounds,
  applyStrokeStyle, drawStrokeOnCtx, drawSelectionRect,
  isPointNearStroke, drawStrokeErasePreview, drawShapePreview,
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
  initialStrokesData?: string | null;
  onRegisterExport?: (fn: () => string | null) => void;
  onRegisterStrokesExport?: (fn: () => string | null) => void;
  onRegisterUndoRedo?: (undo: () => void, redo: () => void) => void;
  externalScale?: { current: number };
  onPeterSauPeter?: (imageBase64: string, imageMime: string) => void;
}

export default function EditorCanvas({
  herramienta, brushColor, brushSize, temaColor, onChange, onTextInsert,
  initialCanvasData, initialStrokesData,
  onRegisterExport, onRegisterStrokesExport, onRegisterUndoRedo, externalScale,
  onPeterSauPeter,
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
  const dprRef = useRef(1);

  const erasingStrokes = useRef<Set<string>>(new Set());
  const isErasingMode = useRef(false);

  const isShapeMode = useRef(false);
  const shapeStart = useRef<Point | null>(null);
  const shapeCurrentEnd = useRef<{ x: number; y: number } | null>(null);

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
  const [solving, setSolving] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const clipboardRef = useRef<any[]>([]);
  const lassoPoints = useRef<{x:number,y:number}[]>([]);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);

  const isDrawingTool = ['boligrafo', 'marcador', 'lapiz', 'borrador', 'borrador_trazo', 'regla', 'forma_rect', 'forma_circulo', 'forma_triangulo'].includes(herramienta);
  const isSelecting = herramienta === 'seleccion' || herramienta === 'lasso';
  const isLasso = herramienta === 'lasso';
  const isCanvasActive = isDrawingTool || isSelecting;
  const isShapeTool = ['regla', 'forma_rect', 'forma_circulo', 'forma_triangulo'].includes(herramienta);

  const updateSelectionRect = (r: SelectionRect | null) => { selectionRectRef.current = r; setSelectionRect(r); };
  const updateSelectedStrokes = (ids: string[]) => { selectedStrokesRef.current = ids; setSelectedStrokes(ids); };

  const setupCanvas = useCallback((canvas: HTMLCanvasElement, w: number, h: number) => {
    const baseDpr = window.devicePixelRatio || 1;
    const dpr = Math.min(baseDpr * 2, 4);
    dprRef.current = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
  }, []);

  const applyDpr = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }, []);

  const clearCanvas = useCallback((canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  const saveSnapshot = () => {
    const snap = JSON.stringify(strokesRef.current);
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > 60) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !overlay) return;

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    setupCanvas(canvas, w, h);
    setupCanvas(overlay, w, h);

    if (!initialized.current) {
      initialized.current = true;

      if (initialStrokesData) {
        try {
          const parsed = JSON.parse(initialStrokesData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            strokesRef.current = parsed;
            setStrokeCount(parsed.length);
            setTimeout(() => { redraw(); saveSnapshot(); }, 50);
            return;
          }
        } catch {}
      }

      if (initialCanvasData) {
        const img = new Image();
        img.onload = () => {
          const ctx = canvasRef.current?.getContext('2d');
          if (ctx && canvasRef.current) {
            applyDpr(ctx);
            ctx.drawImage(img, 0, 0, w, h);
          }
        };
        img.src = initialCanvasData;
      }
    }

    const observer = new ResizeObserver(() => {
      const nW = container.clientWidth;
      const nH = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (Math.round(nW * dpr) === canvas.width && Math.round(nH * dpr) === canvas.height) return;
      const tc = document.createElement('canvas');
      tc.width = canvas.width;
      tc.height = canvas.height;
      const tctx = tc.getContext('2d');
      if (tctx) tctx.drawImage(canvas, 0, 0);
      setupCanvas(canvas, nW, nH);
      setupCanvas(overlay, nW, nH);
      const ctx = canvas.getContext('2d');
      if (ctx) { applyDpr(ctx); ctx.drawImage(tc, 0, 0, nW, nH); }
      redraw();
    });
    observer.observe(container);

    const dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDprChange = () => {
      setupCanvas(canvas, container.clientWidth, container.clientHeight);
      setupCanvas(overlay, container.clientWidth, container.clientHeight);
      redraw();
    };
    dprMedia.addEventListener('change', onDprChange);

    return () => {
      observer.disconnect();
      dprMedia.removeEventListener('change', onDprChange);
    };
  }, [initialCanvasData, initialStrokesData, setupCanvas, applyDpr]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    clearCanvas(canvas, ctx);
    applyDpr(ctx);
    strokesRef.current.forEach(s => {
      if (erasingStrokes.current.has(s.id)) drawStrokeErasePreview(ctx, s);
      else drawStrokeOnCtx(ctx, s, selectedStrokesRef.current.includes(s.id));
    });
  }, [applyDpr, clearCanvas]);

  const redrawOverlay = useCallback((
    rect: SelectionRect | null,
    shapePreview?: { tipo: string; start: Point; end: { x: number; y: number } } | null,
  ) => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    clearCanvas(canvas, ctx);
    applyDpr(ctx);
    if (rect) drawSelectionRect(ctx, rect);
    if (shapePreview) drawShapePreview(ctx, shapePreview.tipo, shapePreview.start, shapePreview.end, brushColor, brushSize);
  }, [applyDpr, clearCanvas, brushColor, brushSize]);

  const getPos = (e: PointerEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, pressure: 1 };
    const rect = canvas.getBoundingClientRect();
    const scale = externalScale?.current || 1;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
      pressure: e.pressure > 0 ? e.pressure : 1,
    };
  };

  const shouldIgnore = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return true;
    if (activePenId.current !== null && e.pointerId !== activePenId.current) return true;
    return false;
  };

  // ═══════════════════════════════════════════
  // POINTER DOWN
  // ═══════════════════════════════════════════
  const startDraw = useCallback((e: PointerEvent) => {
    if (!isDrawingTool && !isSelecting) return;
    if (shouldIgnore(e)) return;

    const isEraserBtn = e.button === 5 || e.buttons === 32;
    const efectiveTool = isEraserBtn ? 'borrador' : herramienta;
    if (e.pointerType === 'pen') activePenId.current = e.pointerId;
    e.preventDefault();
    const pos = getPos(e);

    // ✅ Borrador clásico: elimina strokes completos
    if (efectiveTool === 'borrador') {
      isErasingMode.current = true;
      erasingStrokes.current = new Set();
      const radius = brushSize * 3 + 10;
      const found = strokesRef.current.find(s => isPointNearStroke(pos.x, pos.y, s, radius));
      if (found) { erasingStrokes.current.add(found.id); redraw(); }
      try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
      return;
    }

    // ✅ Borrador trazo: borra pixels reales donde pases (destination-out)
    if (efectiveTool === 'borrador_trazo') {
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
        color: '#000000',
        size: brushSize,
        tipo: 'borrador_trazo',
      };
      try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
      return;
    }

    // ✅ Formas y regla
    if (isShapeTool) {
      isShapeMode.current = true;
      shapeStart.current = pos;
      shapeCurrentEnd.current = pos;
      try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
      return;
    }

    // ✅ Selección (rectangular o lasso)
    if (isSelecting) {
      const rect = selectionRectRef.current;
      if (rect && selectedStrokesRef.current.length > 0) {
        if (pos.x >= rect.x && pos.x <= rect.x + rect.w && pos.y >= rect.y && pos.y <= rect.y + rect.h) {
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
      lassoPoints.current = isLasso ? [{ x: pos.x, y: pos.y }] : [];
      return;
    }

    // ✅ Dibujo normal
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
  }, [isDrawingTool, isSelecting, isShapeTool, herramienta, brushColor, brushSize, redrawOverlay, redraw]);

  // ═══════════════════════════════════════════
  // POINTER MOVE
  // ═══════════════════════════════════════════
  const drawMove = useCallback((e: PointerEvent) => {
    if (shouldIgnore(e)) return;
    e.preventDefault();
    const pos = getPos(e);

    // ✅ Borrador clásico — busca más strokes mientras se mueve
    if (isErasingMode.current) {
      const radius = brushSize * 3 + 10;
      const found = strokesRef.current.find(s =>
        isPointNearStroke(pos.x, pos.y, s, radius) && !erasingStrokes.current.has(s.id)
      );
      if (found) {
        erasingStrokes.current.add(found.id);
        redraw();
      }
      return;
    }

    // ✅ Preview de forma
    if (isShapeMode.current && shapeStart.current) {
      shapeCurrentEnd.current = pos;
      redrawOverlay(selectionRectRef.current, { tipo: herramienta, start: shapeStart.current, end: pos });
      return;
    }

    // ✅ Mover selección
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
          shapeEnd: s.shapeEnd ? { x: s.shapeEnd.x + dx, y: s.shapeEnd.y + dy } : undefined,
        };
      });
      const newRect = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
      updateSelectionRect(newRect);
      redrawOverlay(newRect);
      redraw();
      return;
    }

    // ✅ Dibujando selección (rect o lasso)
    if (selecting.current && selectionStart.current) {
      if (isLasso && lassoPoints.current.length > 0) {
        // Lasso: dibujar path libre
        lassoPoints.current.push({ x: pos.x, y: pos.y });
        // Calcular bounding box del lasso para el rect
        let lx = Infinity, ly = Infinity, lmx = -Infinity, lmy = -Infinity;
        lassoPoints.current.forEach(p => { lx = Math.min(lx, p.x); ly = Math.min(ly, p.y); lmx = Math.max(lmx, p.x); lmy = Math.max(lmy, p.y); });
        const rect: SelectionRect = { x: lx, y: ly, w: lmx - lx, h: lmy - ly };
        updateSelectionRect(rect);
        // Dibujar lasso en overlay
        const ov = overlayRef.current;
        const octx = ov?.getContext('2d');
        if (octx && ov) {
          clearCanvas(ov, octx);
          applyDpr(octx);
          octx.save();
          octx.strokeStyle = '#818cf8';
          octx.lineWidth = 1.5;
          octx.setLineDash([6, 4]);
          octx.globalAlpha = 0.8;
          octx.beginPath();
          octx.moveTo(lassoPoints.current[0].x, lassoPoints.current[0].y);
          for (let i = 1; i < lassoPoints.current.length; i++) {
            octx.lineTo(lassoPoints.current[i].x, lassoPoints.current[i].y);
          }
          octx.stroke();
          // Fill semi-transparente
          octx.globalAlpha = 0.04;
          octx.fillStyle = '#818cf8';
          octx.fill();
          octx.restore();
        }
        return;
      }
      // Rectangular selection
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

    // ✅ Dibujo normal (incluye borrador_trazo que dibuja con destination-out)
    if (!drawing.current || !currentStroke.current) return;
    const last = lastPoint.current;
    if (!last) return;
    const dist = Math.sqrt((pos.x - last.x) ** 2 + (pos.y - last.y) ** 2);
    if (dist < 0.5) return;

    currentStroke.current.points.push(pos);
    lastPoint.current = pos;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const pts = currentStroke.current.points;
    ctx.save();
    applyDpr(ctx);
    applyStrokeStyle(ctx, currentStroke.current.tipo, currentStroke.current.color, currentStroke.current.size, pos.pressure);

    if (pts.length >= 3) {
      const p1 = pts[pts.length - 3];
      const p2 = pts[pts.length - 2];
      const p3 = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      ctx.quadraticCurveTo(p2.x, p2.y, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
      ctx.stroke();
    } else if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
    }
    ctx.restore();
  }, [redraw, redrawOverlay, brushSize, applyDpr, herramienta]);

  // ═══════════════════════════════════════════
  // POINTER UP
  // ═══════════════════════════════════════════
  const stopDraw = useCallback((e: PointerEvent) => {
    if (e.pointerId === activePenId.current) activePenId.current = null;

    // ✅ Fin borrador clásico
    if (isErasingMode.current) {
      isErasingMode.current = false;
      if (erasingStrokes.current.size > 0) {
        const toDelete = new Set(erasingStrokes.current);
        strokesRef.current = strokesRef.current.filter(s => !toDelete.has(s.id));
        erasingStrokes.current = new Set();
        setStrokeCount(strokesRef.current.length);
        saveSnapshot();
        redraw();
        onChange();
      }
      erasingStrokes.current = new Set();
      return;
    }

    // ✅ Fin forma
    if (isShapeMode.current && shapeStart.current && shapeCurrentEnd.current) {
      isShapeMode.current = false;
      const start = shapeStart.current;
      const end = shapeCurrentEnd.current;
      if (Math.hypot(end.x - start.x, end.y - start.y) > 5) {
        const stroke: Stroke = {
          id: genStrokeId(),
          points: [start],
          color: brushColor,
          size: brushSize,
          tipo: herramienta,
          shapeEnd: end,
          bounds: {
            x: Math.min(start.x, end.x) - 4,
            y: Math.min(start.y, end.y) - 4,
            w: Math.abs(end.x - start.x) + 8,
            h: Math.abs(end.y - start.y) + 8,
          },
        };
        strokesRef.current.push(stroke);
        setStrokeCount(strokesRef.current.length);
        saveSnapshot();
        onChange();
        redraw();
      }
      shapeStart.current = null;
      shapeCurrentEnd.current = null;
      redrawOverlay(null);
      return;
    }

    // ✅ Fin mover
    if (movingRef.current) {
      movingRef.current = false;
      moveStart.current = null;
      saveSnapshot();
      onChange();
      return;
    }

    // ✅ Fin selección (rect o lasso)
    if (selecting.current) {
      selecting.current = false;
      const rect = selectionRectRef.current;
      selectionStart.current = null;

      if (isLasso && lassoPoints.current.length > 5) {
        // Lasso: point-in-polygon test
        const poly = lassoPoints.current;
        const pointInPoly = (px: number, py: number): boolean => {
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
              inside = !inside;
            }
          }
          return inside;
        };
        const found = strokesRef.current.filter(s => {
          // Check if center of stroke bounds is inside lasso
          const b = s.bounds || calcBounds(s.points);
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          return pointInPoly(cx, cy);
        }).map(s => s.id);
        lassoPoints.current = [];
        if (found.length > 0 && rect) {
          updateSelectedStrokes(found);
          setMenuPos({ x: rect.x + rect.w / 2, y: rect.y + rect.h + 14 });
        } else {
          updateSelectionRect(null);
          updateSelectedStrokes([]);
          setMenuPos(null);
          redrawOverlay(null);
        }
        return;
      }

      // Rectangular
      lassoPoints.current = [];
      if (!rect || rect.w < 8 || rect.h < 8) {
        updateSelectionRect(null);
        updateSelectedStrokes([]);
        setMenuPos(null);
        redrawOverlay(null);
        return;
      }
      const found = strokesRef.current.filter(s => {
        const b = s.bounds || calcBounds(s.points);
        return b.x < rect.x + rect.w && b.x + b.w > rect.x && b.y < rect.y + rect.h && b.y + b.h > rect.y;
      }).map(s => s.id);
      updateSelectedStrokes(found);
      if (found.length > 0) setMenuPos({ x: rect.x + rect.w / 2, y: rect.y + rect.h + 14 });
      else { updateSelectionRect(null); setMenuPos(null); redrawOverlay(null); }
      return;
    }

    // ✅ Fin dibujo normal (incluye borrador_trazo)
    if (!drawing.current || !currentStroke.current) return;
    drawing.current = false;
    if (currentStroke.current.points.length >= 1) {
      const stroke = { ...currentStroke.current, bounds: calcBounds(currentStroke.current.points) };
      strokesRef.current.push(stroke);
      setStrokeCount(strokesRef.current.length);
      saveSnapshot();
      onChange();
      redraw();
    }
    currentStroke.current = null;
    lastPoint.current = null;
  }, [redraw, redrawOverlay, onChange, brushColor, brushSize, herramienta]);

  // ═══════════════════════════════════════════
  // EVENT LISTENERS
  // ═══════════════════════════════════════════
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    const useOverlay = isSelecting || isShapeTool;
    const target = useOverlay ? overlay : canvas;

    const onDown = (e: PointerEvent) => startDraw(e);
    const onMove = (e: PointerEvent) => drawMove(e);
    const onUp = (e: PointerEvent) => stopDraw(e);
    const onCancel = (e: PointerEvent) => {
      movingRef.current = false;
      selecting.current = false;
      drawing.current = false;
      isErasingMode.current = false;
      isShapeMode.current = false;
      erasingStrokes.current = new Set();
      shapeStart.current = null;
      shapeCurrentEnd.current = null;
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
  }, [startDraw, drawMove, stopDraw, isSelecting, isShapeTool]);

  // ═══════════════════════════════════════════
  // UNDO / REDO / DELETE
  // ═══════════════════════════════════════════
  const undo = useCallback(() => {
    if (historyIdxRef.current > 0) {
      historyIdxRef.current--;
      try {
        strokesRef.current = JSON.parse(historyRef.current[historyIdxRef.current]);
      } catch { return; }
    } else {
      if (strokesRef.current.length === 0) return;
      strokesRef.current.pop();
    }
    setStrokeCount(strokesRef.current.length);
    updateSelectionRect(null);
    updateSelectedStrokes([]);
    setMenuPos(null);
    redrawOverlay(null);
    redraw();
    onChange();
  }, [redraw, redrawOverlay, onChange]);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    try {
      strokesRef.current = JSON.parse(historyRef.current[historyIdxRef.current]);
    } catch { return; }
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
    saveSnapshot();
    onChange();
  }, [redraw, redrawOverlay, onChange, saveSnapshot]);

  const copySelection = useCallback(() => {
    const selected = strokesRef.current.filter(s => selectedStrokesRef.current.includes(s.id));
    clipboardRef.current = JSON.parse(JSON.stringify(selected));
  }, []);

  const cutSelection = useCallback(() => {
    copySelection();
    deleteSelection();
  }, [copySelection, deleteSelection]);

  const duplicateSelection = useCallback(() => {
    const selected = strokesRef.current.filter(s => selectedStrokesRef.current.includes(s.id));
    const offset = 20;
    const dupes = selected.map(s => ({
      ...JSON.parse(JSON.stringify(s)),
      id: genStrokeId(),
      points: s.points.map(p => ({ ...p, x: p.x + offset, y: p.y + offset })),
      bounds: s.bounds ? { x: s.bounds.x + offset, y: s.bounds.y + offset, w: s.bounds.w, h: s.bounds.h } : undefined,
      shapeEnd: s.shapeEnd ? { x: s.shapeEnd.x + offset, y: s.shapeEnd.y + offset } : undefined,
    }));
    strokesRef.current.push(...dupes);
    setStrokeCount(strokesRef.current.length);
    updateSelectedStrokes(dupes.map(d => d.id));
    const rect = selectionRectRef.current;
    if (rect) updateSelectionRect({ x: rect.x + offset, y: rect.y + offset, w: rect.w, h: rect.h });
    redraw();
    onChange();
      saveSnapshot();
    redraw();
    onChange();
  }, [redraw, onChange, saveSnapshot]);

  const getCroppedCanvas = (): string | null => {
    const rect = selectionRectRef.current;
    if (!rect || !canvasRef.current) return null;
    const src = canvasRef.current;
    const dpr = dprRef.current;
    const crop = document.createElement('canvas');
    const pad = 12;
    crop.width = Math.round((rect.w + pad * 2) * dpr);
    crop.height = Math.round((rect.h + pad * 2) * dpr);
    const ctx = crop.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, crop.width, crop.height);
    ctx.drawImage(src,
      Math.round((rect.x - pad) * dpr), Math.round((rect.y - pad) * dpr),
      Math.round((rect.w + pad * 2) * dpr), Math.round((rect.h + pad * 2) * dpr),
      0, 0, crop.width, crop.height,
    );
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
          mensaje: `Read this handwritten content carefully. It may contain text, math expressions, or both.

RULES:
1. If it's plain text: return the text exactly as written, preserving line breaks.
2. If it contains math expressions: format them properly using these rules:
   - Fractions: write as a/b or use unicode like ½
   - Square roots: use √ symbol, e.g. √(x+1)
   - Exponents: use superscript unicode: x² x³ or write x^n for higher powers
   - Greek letters: use unicode: π θ α β σ Δ λ
   - Special: use ≤ ≥ ≠ ≈ ± ∞ ∫ Σ ∂
   - Keep expressions on one line when possible: 2x² + 3x - 5 = 0
3. If it's a mix: format naturally, math inline with text.
4. NEVER add explanations. Return ONLY the transcribed/formatted content.
5. If unclear write [?]

Examples of good output:
- "x² + 6x + 9 = (x + 3)²"
- "∫x²dx = x³/3 + C"  
- "f(x) = √(x² + 1)"
- "The area A = πr²"`,
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

  const solveMath = () => {
    const imageData = getCroppedCanvas();
    if (!imageData || !onPeterSauPeter) return;
    const base64 = imageData.split(',')[1];
    onPeterSauPeter(base64, 'image/png');
  };

  // ═══════════════════════════════════════════
  // REGISTER EXPORTERS
  // ═══════════════════════════════════════════
  useEffect(() => {
    (window as any).__editorUndo = undo;
    (window as any).__editorRedo = redo;
    if (onRegisterUndoRedo) onRegisterUndoRedo(undo, redo);

    if (onRegisterExport) {
      onRegisterExport(() => {
        const c = canvasRef.current;
        if (!c || strokesRef.current.length === 0) return null;
        return c.toDataURL('image/png');
      });
    }

    if (onRegisterStrokesExport) {
      onRegisterStrokesExport(() => {
        if (strokesRef.current.length === 0) return null;
        const data = strokesRef.current.map(s => ({
          id: s.id,
          points: s.points.map(p => ({
            x: Math.round(p.x * 10) / 10,
            y: Math.round(p.y * 10) / 10,
            pressure: Math.round(p.pressure * 100) / 100,
          })),
          color: s.color,
          size: s.size,
          tipo: s.tipo,
          ...(s.shapeEnd ? { shapeEnd: s.shapeEnd } : {}),
          ...(s.bounds ? { bounds: s.bounds } : {}),
        }));
        return JSON.stringify(data);
      });
    }
  }, [undo, redo, onRegisterExport, onRegisterStrokesExport, onRegisterUndoRedo]);

  // ═══════════════════════════════════════════
  // KEYBOARD SHORTCUTS
  // ═══════════════════════════════════════════
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isDrawingTool && !isSelecting) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); e.stopPropagation(); redo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedStrokesRef.current.length > 0) {
        const active = document.activeElement;
        const isEditable = active?.getAttribute('contenteditable') === 'true' || ['INPUT', 'TEXTAREA'].includes(active?.tagName || '');
        if (!isEditable) { e.preventDefault(); deleteSelection(); }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedStrokesRef.current.length > 0) {
        e.preventDefault(); copySelection();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'x' && selectedStrokesRef.current.length > 0) {
        e.preventDefault(); cutSelection();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && clipboardRef.current.length > 0) {
        e.preventDefault();
        const offset = 30;
        const pasted = clipboardRef.current.map(s => ({
          ...JSON.parse(JSON.stringify(s)),
          id: genStrokeId(),
          points: s.points.map((p: any) => ({ ...p, x: p.x + offset, y: p.y + offset })),
          bounds: s.bounds ? { x: s.bounds.x + offset, y: s.bounds.y + offset, w: s.bounds.w, h: s.bounds.h } : undefined,
          shapeEnd: s.shapeEnd ? { x: s.shapeEnd.x + offset, y: s.shapeEnd.y + offset } : undefined,
        }));
        strokesRef.current.push(...pasted);
        setStrokeCount(strokesRef.current.length);
        redraw();
        onChange();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selectedStrokesRef.current.length > 0) {
        e.preventDefault(); duplicateSelection();
      }
      if (e.key === 'Escape') {
        updateSelectionRect(null);
        updateSelectedStrokes([]);
        setMenuPos(null);
        redrawOverlay(null);
        movingRef.current = false;
        isShapeMode.current = false;
        shapeStart.current = null;
        shapeCurrentEnd.current = null;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isDrawingTool, isSelecting, undo, redo, deleteSelection, copySelection, cutSelection, duplicateSelection, redrawOverlay]);

  useEffect(() => { redraw(); }, [selectedStrokes, redraw]);

  // ═══════════════════════════════════════════
  // CURSOR
  // ═══════════════════════════════════════════
  const getCursor = () => {
    if (movingRef.current) return 'grabbing';
    if (isSelecting && selectionRect && selectedStrokes.length > 0) return 'grab';
    if (isSelecting) return 'crosshair';
    if (isShapeTool) return 'crosshair';
    if (herramienta === 'borrador_trazo') {
      const r = Math.min(Math.max(brushSize * 2, 8), 24);
      const sz = r * 2 + 4;
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${sz}' height='${sz}' viewBox='0 0 ${sz} ${sz}'%3E%3Ccircle cx='${sz / 2}' cy='${sz / 2}' r='${r}' fill='none' stroke='%23ef4444' stroke-width='2' stroke-dasharray='4 2'/%3E%3Ccircle cx='${sz / 2}' cy='${sz / 2}' r='2' fill='%23ef4444'/%3E%3C/svg%3E") ${sz / 2} ${sz / 2}, cell`;
    }
    if (herramienta === 'borrador')
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='20' viewBox='0 0 28 20'%3E%3Crect x='1' y='1' width='26' height='18' rx='3' fill='white' stroke='%23d1d5db' stroke-width='1.5'/%3E%3Crect x='1' y='1' width='9' height='18' rx='3' fill='%23f3f4f6' stroke='%23d1d5db' stroke-width='1.5'/%3E%3C/svg%3E") 14 10, cell`;
    if (isDrawingTool) return 'crosshair';
    return 'default';
  };

  const useOverlayForEvents = isSelecting || isShapeTool;

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════
  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: isCanvasActive ? 'all' : 'none',
        zIndex: isCanvasActive ? 20 : 1,
        touchAction: 'none',
        overflow: 'hidden',
      }}
    >
      <canvas ref={canvasRef} style={{
        position: 'absolute', top: 0, left: 0,
        touchAction: 'none', background: 'transparent',
        cursor: useOverlayForEvents ? 'default' : getCursor(),
        pointerEvents: !isCanvasActive ? 'none' : useOverlayForEvents ? 'none' : 'all',
        imageRendering: 'auto',
      }} />
      <canvas ref={overlayRef} style={{
        position: 'absolute', top: 0, left: 0,
        touchAction: 'none', background: 'transparent',
        cursor: getCursor(),
        pointerEvents: !isCanvasActive ? 'none' : useOverlayForEvents ? 'all' : 'none',
        imageRendering: 'auto',
      }} />

      {menuPos && selectedStrokes.length > 0 && (
        <SelectionMenu
          menuPos={menuPos}
          converting={converting}
          solving={solving}
          onMove={() => { movingRef.current = true; moveStart.current = null; setMenuPos(null); }}
          onConvert={convertToText}
          onCopy={copySelection}
          onCut={cutSelection}
          onDuplicate={duplicateSelection}
          onSave={() => {
            const img = getCroppedCanvas();
            if (!img) return;
            const a = document.createElement('a');
            a.download = 'dibujo.png';
            a.href = img;
            a.click();
          }}
          onDelete={deleteSelection}
          onPeterSauPeter={onPeterSauPeter ? solveMath : undefined}
        />
      )}

      {(isDrawingTool || isSelecting) && (
        <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: '6px', zIndex: 30 }}>
          <button onClick={undo} title="Undo" style={{
            padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #e5e7eb',
            background: 'rgba(255,255,255,0.96)', color: '#374151', cursor: 'pointer',
            backdropFilter: 'blur(8px)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            display: 'flex', alignItems: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
            </svg>
          </button>
          <button onClick={redo} title="Redo" style={{
            padding: '7px 10px', borderRadius: '8px', border: '1.5px solid #e5e7eb',
            background: 'rgba(255,255,255,0.96)', color: '#374151', cursor: 'pointer',
            backdropFilter: 'blur(8px)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            display: 'flex', alignItems: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
            </svg>
          </button>
          {strokeCount > 0 && (
            <div style={{
              padding: '7px 10px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.96)', color: '#9ca3af',
              fontSize: '11px', backdropFilter: 'blur(8px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              display: 'flex', alignItems: 'center',
            }}>
              {strokeCount}
            </div>
          )}
        </div>
      )}
    </div>
  );
}