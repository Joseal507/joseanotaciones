'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { Herramienta } from './types';
import {
  Point, Stroke, SelectionRect, genStrokeId, calcBounds,
  drawStrokeOnCtx, drawSelectionRect, isPointNearStroke,
  drawStrokeErasePreview, drawShapePreview, drawShape,
} from './canvasUtils';
import { useStrokeEngine } from '../../hooks/useStrokeEngine';
import { useCanvasRenderer } from '../../hooks/useCanvasRenderer';
import { useGestureManager } from '../../hooks/useGestureManager';
import SelectionMenu from './SelectionMenu';

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

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
  onRegisterExport, onRegisterStrokesExport, onRegisterUndoRedo,
  externalScale, onPeterSauPeter,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputLayerRef = useRef<HTMLDivElement>(null);

  const strokesRef = useRef<Stroke[]>([]);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const initialized = useRef(false);
  const clipboardRef = useRef<Stroke[]>([]);

  const selectionRectRef = useRef<SelectionRect | null>(null);
  const selectedIdsRef = useRef<string[]>([]);
  const erasingIdsRef = useRef<Set<string>>(new Set());

  const shapeStartRef = useRef<Point | null>(null);
  const shapeEndRef = useRef<{ x: number; y: number } | null>(null);
  const isShapeActiveRef = useRef(false);

  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
  const isLassoActiveRef = useRef(false);

  const isMovingRef = useRef(false);
  const moveStartRef = useRef<Point | null>(null);

  const selectStartRef = useRef<{ x: number; y: number } | null>(null);
  const isSelectingRef = useRef(false);

  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [converting, setConverting] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);

  const strokeEngine = useStrokeEngine();
  const mainRenderer = useCanvasRenderer(mainCanvasRef);
  const liveRenderer = useCanvasRenderer(liveCanvasRef);
  const overlayRenderer = useCanvasRenderer(overlayCanvasRef);

  // Track si el usuario está dibujando activamente
  const isDrawingActiveRef = useRef(false);
  const drawingIdleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isDrawingTool = [
    'boligrafo', 'marcador', 'lapiz', 'borrador', 'borrador_trazo',
    'regla', 'forma_rect', 'forma_circulo', 'forma_triangulo',
  ].includes(herramienta);
  const isSelecting = herramienta === 'seleccion' || herramienta === 'lasso';
  const isLasso = herramienta === 'lasso';
  const isShapeTool = ['regla', 'forma_rect', 'forma_circulo', 'forma_triangulo'].includes(herramienta);
  const isEraser = herramienta === 'borrador';
  const isCanvasActive = isDrawingTool || isSelecting;

  const isLargeTouch = typeof window !== 'undefined'
    && navigator.maxTouchPoints > 0
    && typeof window.matchMedia === 'function'
    && !window.matchMedia('(any-pointer: fine)').matches;

  const saveSnapshot = useCallback(() => {
    const snap = JSON.stringify(strokesRef.current);
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > 80) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
  }, []);

  const syncSelectionUI = useCallback((rect: SelectionRect | null, ids: string[]) => {
    selectionRectRef.current = rect;
    selectedIdsRef.current = ids;
    setSelectionRect(rect);
    setSelectedIds(ids);
    setMenuPos(rect && ids.length > 0
      ? { x: rect.x + rect.w / 2, y: rect.y + rect.h + 14 }
      : null
    );
  }, []);

  const setupAllCanvases = useCallback((w: number, h: number) => {
    mainRenderer.setup(w, h);
    liveRenderer.setup(w, h);
    overlayRenderer.setup(w, h);
  }, [mainRenderer, liveRenderer, overlayRenderer]);

  const redrawMain = useCallback(() => {
    mainRenderer.renderStrokes(
      strokesRef.current,
      new Set(selectedIdsRef.current),
      erasingIdsRef.current,
    );
  }, [mainRenderer]);

  // IMPORTANTE:
  // El overlay (selección/lasso/cursor borrador) NO debe pasar por el renderer buffered,
  // porque el commit async puede limpiarlo y hacerlo "invisible".
  const clearOverlayDirect = () => {
    const canvas = overlayCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    overlayRenderer.applyDpr(ctx);
  };

  // Full redraw sin highlights de erasing — para uso interno
  const redrawClean = useCallback(() => {
    mainRenderer.renderStrokes(
      strokesRef.current,
      new Set(selectedIdsRef.current),
      new Set(),
    );
  }, [mainRenderer]);

  const redrawOverlay = useCallback((
    rect?: SelectionRect | null,
    shapePreview?: { tipo: string; start: Point; end: { x: number; y: number } } | null,
  ) => {
    clearOverlayDirect();
    const canvas = overlayCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    overlayRenderer.applyDpr(ctx);
    if (rect) drawSelectionRect(ctx, rect);
    if (shapePreview) {
      drawShapePreview(ctx, shapePreview.tipo, shapePreview.start, shapePreview.end, brushColor, brushSize);
    }
  }, [overlayRenderer, brushColor, brushSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const w = container.clientWidth || 816;
    const h = container.clientHeight || 1056;
    setupAllCanvases(w, h);

    if (!initialized.current) {
      initialized.current = true;
      if (initialStrokesData) {
        try {
          const parsed = JSON.parse(initialStrokesData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            strokesRef.current = parsed;
            setStrokeCount(parsed.length);
            requestAnimationFrame(() => { redrawMain(); saveSnapshot(); });
            return;
          }
        } catch {}
      }
      if (initialCanvasData) {
        const img = new Image();
        img.onload = () => {
          const ctx = mainCanvasRef.current?.getContext('2d');
          if (ctx) { mainRenderer.applyDpr(ctx); ctx.drawImage(img, 0, 0, w, h); }
        };
        img.src = initialCanvasData;
      }
    }

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setupAllCanvases(width, height);
        redrawMain();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [setupAllCanvases, redrawMain, saveSnapshot, initialCanvasData, initialStrokesData, mainRenderer]);

  // eventToPoint: convierte coordenadas del evento a coordenadas del canvas
  // getBoundingClientRect incluye el CSS transform del padre (zoom)
  // Dividir por la relación rendered/logical da coordenadas correctas
  const eventToPoint = useCallback((e: PointerEvent): Point => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return { x: 0, y: 0, pressure: 1 };
    const rect = canvas.getBoundingClientRect();

    // rect.width = tamaño renderizado con CSS transform
    // canvas.offsetWidth = tamaño lógico sin transform
    const scaleX = rect.width > 0 ? canvas.offsetWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.offsetHeight / rect.height : 1;

    let pressure = e.pressure ?? 0.5;
    if (e.pointerType === 'pen') {
      pressure = Math.max(0.1, Math.min(1, pressure));
    } else if (e.pointerType === 'mouse') {
      pressure = 0.6;
    } else {
      pressure = Math.max(0.3, Math.min(1, pressure));
    }

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      pressure,
    };
  }, []);

  const clientToCanvas = useCallback((cx: number, cy: number): Point => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return { x: 0, y: 0, pressure: 1 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.offsetWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.offsetHeight / rect.height : 1;
    return {
      x: (cx - rect.left) * scaleX,
      y: (cy - rect.top) * scaleY,
      pressure: 1,
    };
  }, []);

  // ─── Eraser cursor overlay ────────────────────────────────────────────────
  const eraserPosRef = useRef<{ x: number; y: number } | null>(null);

  const drawEraserCursor = useCallback((x: number, y: number) => {
    const canvas = overlayCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    clearOverlayDirect();
    overlayRenderer.applyDpr(ctx);
    ctx.save();
    // Círculo sólido semitransparente
    const r = brushSize * 2 + 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239,68,68,0.12)';
    ctx.fill();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.stroke();
    // Cruz en el centro
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
    ctx.stroke();
    ctx.restore();
  }, [overlayRenderer, brushSize]);

  // ─── Draw handlers ────────────────────────────────────────────────────────
  const handleDrawStart = useCallback((e: PointerEvent) => {
    const pos = eventToPoint(e);

    if (isEraser || e.button === 5 || e.buttons === 32) {
      erasingIdsRef.current = new Set();
      const radius = brushSize * 4 + 8;
      strokesRef.current.forEach(s => {
        if (isPointNearStroke(pos.x, pos.y, s, radius)) {
          erasingIdsRef.current.add(s.id);
        }
      });
      // Redibujar inmediatamente para mostrar highlight rojo
      mainRenderer.renderStrokes(
        strokesRef.current,
        new Set(selectedIdsRef.current),
        erasingIdsRef.current,
      );
      drawEraserCursor(pos.x, pos.y);
      return;
    }

    if (herramienta === 'borrador_trazo') {
      strokeEngine.begin(pos, '#000000', brushSize, 'borrador_trazo');
      drawEraserCursor(pos.x, pos.y);
      return;
    }

    if (isShapeTool) {
      isShapeActiveRef.current = true;
      shapeStartRef.current = pos;
      shapeEndRef.current = { x: pos.x, y: pos.y };
      return;
    }

    if (isSelecting) {
      const rect = selectionRectRef.current;
      if (rect && selectedIdsRef.current.length > 0) {
        if (pos.x >= rect.x && pos.x <= rect.x + rect.w
          && pos.y >= rect.y && pos.y <= rect.y + rect.h) {
          isMovingRef.current = true;
          moveStartRef.current = pos;
          return;
        }
      }
      syncSelectionUI(null, []);
      redrawMain();
      redrawOverlay(null);
      if (isLasso) {
        isLassoActiveRef.current = true;
        lassoPointsRef.current = [{ x: pos.x, y: pos.y }];
      } else {
        isSelectingRef.current = true;
        selectStartRef.current = { x: pos.x, y: pos.y };
      }
      return;
    }

    syncSelectionUI(null, []);
    redrawOverlay(null);
    // Marcar como dibujando activamente — bloquear autosave
    isDrawingActiveRef.current = true;
    if (drawingIdleTimerRef.current) clearTimeout(drawingIdleTimerRef.current);
    // Limpiar SOLO el live buffer al inicio del trazo
    liveRenderer.clearLive();
    strokeEngine.begin(pos, brushColor, brushSize, herramienta);
  }, [
    eventToPoint, isEraser, isShapeTool, isSelecting, isLasso,
    brushColor, brushSize, herramienta, strokeEngine, redrawMain,
    redrawOverlay, syncSelectionUI, liveRenderer, drawEraserCursor,
  ]);

  const handleDrawMove = useCallback((e: PointerEvent) => {
    const pos = eventToPoint(e);

    // Borrador por trazo (stroke eraser)
    if (isEraser) {
      const radius = brushSize * 4 + 8;
      let changed = false;
      strokesRef.current.forEach(s => {
        if (!erasingIdsRef.current.has(s.id) && isPointNearStroke(pos.x, pos.y, s, radius)) {
          erasingIdsRef.current.add(s.id);
          changed = true;
        }
      });
      // Redibujar INMEDIATAMENTE sin RAF para mostrar highlight fluido
      if (changed) {
        mainRenderer.renderStrokes(
          strokesRef.current,
          new Set(selectedIdsRef.current),
          erasingIdsRef.current,
        );
      }
      drawEraserCursor(pos.x, pos.y);
      return;
    }

    if (isShapeActiveRef.current && shapeStartRef.current) {
      shapeEndRef.current = { x: pos.x, y: pos.y };
      clearOverlayDirect();
      const canvas = overlayCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        overlayRenderer.applyDpr(ctx);
        drawShapePreview(ctx, herramienta, shapeStartRef.current, pos, brushColor, brushSize);
      }
      return;
    }

    if (isMovingRef.current && moveStartRef.current) {
      const rect = selectionRectRef.current;
      if (!rect) return;
      const dx = pos.x - moveStartRef.current.x;
      const dy = pos.y - moveStartRef.current.y;
      moveStartRef.current = pos;
      strokesRef.current = strokesRef.current.map(s => {
        if (!selectedIdsRef.current.includes(s.id)) return s;
        return {
          ...s,
          points: s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })),
          bounds: s.bounds ? { x: s.bounds.x + dx, y: s.bounds.y + dy, w: s.bounds.w, h: s.bounds.h } : undefined,
          shapeEnd: s.shapeEnd ? { x: s.shapeEnd.x + dx, y: s.shapeEnd.y + dy } : undefined,
        };
      });
      const newRect = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
      selectionRectRef.current = newRect;
      setSelectionRect(newRect);
      setMenuPos({ x: newRect.x + newRect.w / 2, y: newRect.y + newRect.h + 14 });
      mainRenderer.scheduleRender(() => {
        redrawMain();
        redrawOverlay(newRect);
      });
      return;
    }

    if (isLassoActiveRef.current) {
      lassoPointsRef.current.push({ x: pos.x, y: pos.y });
      const canvas = overlayCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        clearOverlayDirect();
        overlayRenderer.applyDpr(ctx);
        ctx.save();
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        const lp = lassoPointsRef.current;
        ctx.moveTo(lp[0].x, lp[0].y);
        for (let i = 1; i < lp.length; i++) ctx.lineTo(lp[i].x, lp[i].y);
        ctx.stroke();
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = '#818cf8';
        ctx.fill();
        ctx.restore();
      }
      return;
    }

    if (isSelectingRef.current && selectStartRef.current) {
      const start = selectStartRef.current;
      const rect: SelectionRect = {
        x: Math.min(start.x, pos.x),
        y: Math.min(start.y, pos.y),
        w: Math.abs(pos.x - start.x),
        h: Math.abs(pos.y - start.y),
      };
      selectionRectRef.current = rect;
      setSelectionRect(rect);
      clearOverlayDirect();
      const canvas = overlayCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        overlayRenderer.applyDpr(ctx);
        drawSelectionRect(ctx, rect);
      }
      return;
    }

    if (!strokeEngine.isActive.current) return;
    const { shouldRender, renderPoints } = strokeEngine.addPoint(pos);
    if (!shouldRender || renderPoints.length < 2) return;

    const tipo = strokeEngine.currentStroke.current?.tipo ?? herramienta;

    if (tipo === 'borrador_trazo') {
      // INMEDIATO — borrar en backBuffer directamente sin RAF
      mainRenderer.renderEraserSegment(
        renderPoints,
        strokeEngine.currentStroke.current?.size ?? brushSize,
      );
      drawEraserCursor(pos.x, pos.y);
    } else {
      // Dibujar en liveBuffer — acumula sin borrar, commit via RAF
      liveRenderer.renderStrokeSegment(
        renderPoints,
        strokeEngine.currentStroke.current?.color ?? brushColor,
        strokeEngine.currentStroke.current?.size ?? brushSize,
        tipo,
      );
    }
  }, [
    eventToPoint, isEraser, isShapeTool, isSelecting, isLasso,
    brushColor, brushSize, herramienta, strokeEngine,
    mainRenderer, liveRenderer, overlayRenderer,
    redrawMain, redrawOverlay, syncSelectionUI, drawEraserCursor,
  ]);

  const handleDrawEnd = useCallback((e: PointerEvent) => {
    // Limpiar cursor borrador
    if (isEraser) {
      clearOverlayDirect();
    }

    if (isEraser) {
      if (erasingIdsRef.current.size > 0) {
        strokesRef.current = strokesRef.current.filter(s => !erasingIdsRef.current.has(s.id));
        setStrokeCount(strokesRef.current.length);
        saveSnapshot();
        onChange();
      }
      erasingIdsRef.current = new Set();
      // Forzar redraw limpio sin highlights
      mainRenderer.renderStrokes(
        strokesRef.current,
        new Set(selectedIdsRef.current),
        new Set(),
      );
      return;
    }

    if (isShapeActiveRef.current && shapeStartRef.current && shapeEndRef.current) {
      isShapeActiveRef.current = false;
      const start = shapeStartRef.current;
      const end = shapeEndRef.current;
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
        redrawMain();
      }
      shapeStartRef.current = null;
      shapeEndRef.current = null;
      redrawOverlay(null);
      return;
    }

    if (isMovingRef.current) {
      isMovingRef.current = false;
      moveStartRef.current = null;
      saveSnapshot();
      onChange();
      return;
    }

    if (isLassoActiveRef.current) {
      isLassoActiveRef.current = false;
      const poly = lassoPointsRef.current;
      if (poly.length > 5) {
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
          const b = s.bounds ?? calcBounds(s.points);
          return pointInPoly(b.x + b.w / 2, b.y + b.h / 2);
        }).map(s => s.id);
        lassoPointsRef.current = [];
        let lx = Infinity, ly = Infinity, lmx = -Infinity, lmy = -Infinity;
        poly.forEach(p => { lx = Math.min(lx, p.x); ly = Math.min(ly, p.y); lmx = Math.max(lmx, p.x); lmy = Math.max(lmy, p.y); });
        const lassoRect: SelectionRect = { x: lx, y: ly, w: lmx - lx, h: lmy - ly };
        if (found.length > 0) {
          syncSelectionUI(lassoRect, found);
          redrawMain();
          redrawOverlay(lassoRect);
        } else {
          syncSelectionUI(null, []);
          redrawOverlay(null);
        }
      } else {
        lassoPointsRef.current = [];
        syncSelectionUI(null, []);
        redrawOverlay(null);
      }
      return;
    }

    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      selectStartRef.current = null;
      const rect = selectionRectRef.current;
      if (!rect || rect.w < 8 || rect.h < 8) {
        syncSelectionUI(null, []);
        redrawOverlay(null);
        return;
      }
      const found = strokesRef.current.filter(s => {
        const b = s.bounds ?? calcBounds(s.points);
        return b.x < rect.x + rect.w && b.x + b.w > rect.x
          && b.y < rect.y + rect.h && b.y + b.h > rect.y;
      }).map(s => s.id);
      syncSelectionUI(found.length > 0 ? rect : null, found);
      redrawMain();
      if (found.length === 0) redrawOverlay(null);
      return;
    }

    if (!strokeEngine.isActive.current) return;
    const stroke = strokeEngine.end();
    if (!stroke) return;

    // Limpiar live buffer y overlay
    liveRenderer.clearLive();
    clearOverlayDirect();

    if (stroke.tipo === 'borrador_trazo') {
      stroke.bounds = calcBounds(stroke.points);
      strokesRef.current.push(stroke);
      setStrokeCount(strokesRef.current.length);
      saveSnapshot();
      // Full redraw limpio desde vectores
      mainRenderer.renderStrokes(
        strokesRef.current,
        new Set(selectedIdsRef.current),
        new Set(),
      );
      onChange();
      return;
    }

    stroke.bounds = calcBounds(stroke.points);
    strokesRef.current.push(stroke);
    setStrokeCount(strokesRef.current.length);
    saveSnapshot();
    // Full redraw desde vectores — garantiza que el trazo queda completo
    mainRenderer.renderStrokes(
      strokesRef.current,
      new Set(selectedIdsRef.current),
      new Set(),
    );
    // Marcar idle después de 2s — permitir autosave
    if (drawingIdleTimerRef.current) clearTimeout(drawingIdleTimerRef.current);
    drawingIdleTimerRef.current = setTimeout(() => {
      isDrawingActiveRef.current = false;
      onChange(); // trigger autosave ahora que está idle
    }, 2000);
  }, [
    isEraser, isShapeTool, isSelecting, isLasso,
    brushColor, brushSize, herramienta, strokeEngine,
    mainRenderer, liveRenderer, overlayRenderer, redrawMain, redrawOverlay,
    syncSelectionUI, saveSnapshot, onChange,
  ]);

  const viewRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 });

  const gestureCallbacks = useRef({
    onDrawStart: handleDrawStart,
    onDrawMove: handleDrawMove,
    onDrawEnd: handleDrawEnd,
    onPanStart: (_mid: { x: number; y: number }) => {},
    onPanMove: (_mid: { x: number; y: number }, _delta: { dx: number; dy: number }) => {},
    onPanEnd: () => {},
    onZoom: (_center: { x: number; y: number }, _scaleDelta: number, _panDelta: { dx: number; dy: number }) => {},
    onZoomEnd: () => {},
  });

  useEffect(() => {
    gestureCallbacks.current.onDrawStart = handleDrawStart;
    gestureCallbacks.current.onDrawMove = handleDrawMove;
    gestureCallbacks.current.onDrawEnd = handleDrawEnd;
  }, [handleDrawStart, handleDrawMove, handleDrawEnd]);

  const stableCallbacks = useRef({
    onDrawStart: (e: PointerEvent) => gestureCallbacks.current.onDrawStart(e),
    onDrawMove: (e: PointerEvent) => gestureCallbacks.current.onDrawMove(e),
    onDrawEnd: (e: PointerEvent) => gestureCallbacks.current.onDrawEnd(e),
    onPanStart: (mid: { x: number; y: number }) => gestureCallbacks.current.onPanStart(mid),
    onPanMove: (mid: { x: number; y: number }, delta: { dx: number; dy: number }) => gestureCallbacks.current.onPanMove(mid, delta),
    onPanEnd: () => gestureCallbacks.current.onPanEnd(),
    onZoom: (c: { x: number; y: number }, sd: number, pd: { dx: number; dy: number }) => gestureCallbacks.current.onZoom(c, sd, pd),
    onZoomEnd: () => gestureCallbacks.current.onZoomEnd(),
  });

  useGestureManager(
    inputLayerRef as React.RefObject<HTMLElement>,
    stableCallbacks.current,
    {
      isDrawingEnabled: isCanvasActive,
      // Pan/zoom solo cuando no hay herramienta de dibujo activa
      // En iPad: siempre permitir 2 dedos para zoom aunque se esté dibujando
      isPanZoomEnabled: !isCanvasActive || isLargeTouch,
      isLargeTouchDevice: isLargeTouch,
    },
  );

  const undo = useCallback(() => {
    if (historyIdxRef.current > 0) {
      historyIdxRef.current--;
      try { strokesRef.current = JSON.parse(historyRef.current[historyIdxRef.current]); } catch { return; }
    } else {
      if (strokesRef.current.length === 0) return;
      strokesRef.current.pop();
    }
    setStrokeCount(strokesRef.current.length);
    syncSelectionUI(null, []);
    redrawMain();
    redrawOverlay(null);
    onChange();
  }, [redrawMain, redrawOverlay, syncSelectionUI, onChange]);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    try { strokesRef.current = JSON.parse(historyRef.current[historyIdxRef.current]); } catch { return; }
    setStrokeCount(strokesRef.current.length);
    redrawMain();
    onChange();
  }, [redrawMain, onChange]);

  const deleteSelection = useCallback(() => {
    strokesRef.current = strokesRef.current.filter(s => !selectedIdsRef.current.includes(s.id));
    syncSelectionUI(null, []);
    redrawMain();
    redrawOverlay(null);
    setStrokeCount(strokesRef.current.length);
    saveSnapshot();
    onChange();
  }, [redrawMain, redrawOverlay, syncSelectionUI, saveSnapshot, onChange]);

  const copySelection = useCallback(() => {
    clipboardRef.current = JSON.parse(JSON.stringify(
      strokesRef.current.filter(s => selectedIdsRef.current.includes(s.id))
    ));
  }, []);

  const cutSelection = useCallback(() => { copySelection(); deleteSelection(); }, [copySelection, deleteSelection]);

  const duplicateSelection = useCallback(() => {
    const offset = 20;
    const dupes = strokesRef.current
      .filter(s => selectedIdsRef.current.includes(s.id))
      .map(s => ({
        ...JSON.parse(JSON.stringify(s)),
        id: genStrokeId(),
        points: s.points.map(p => ({ ...p, x: p.x + offset, y: p.y + offset })),
        bounds: s.bounds ? { x: s.bounds.x + offset, y: s.bounds.y + offset, w: s.bounds.w, h: s.bounds.h } : undefined,
        shapeEnd: s.shapeEnd ? { x: s.shapeEnd.x + offset, y: s.shapeEnd.y + offset } : undefined,
      }));
    strokesRef.current.push(...dupes);
    setStrokeCount(strokesRef.current.length);
    const ids = dupes.map(d => d.id);
    const rect = selectionRectRef.current;
    syncSelectionUI(
      rect ? { x: rect.x + offset, y: rect.y + offset, w: rect.w, h: rect.h } : null,
      ids
    );
    redrawMain();
    saveSnapshot();
    onChange();
  }, [redrawMain, syncSelectionUI, saveSnapshot, onChange]);

  const getCroppedCanvas = (): string | null => {
    const rect = selectionRectRef.current;
    if (!rect || !mainCanvasRef.current) return null;
    const src = mainCanvasRef.current;
    const dpr = mainRenderer.dpr.current;
    const pad = 12;
    const crop = document.createElement('canvas');
    crop.width = Math.round((rect.w + pad * 2) * dpr);
    crop.height = Math.round((rect.h + pad * 2) * dpr);
    const ctx = crop.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, crop.width, crop.height);
    ctx.drawImage(
      src,
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
          mensaje: `Read this handwritten content carefully. Return ONLY the transcribed content.
Rules:
1. Plain text → return as written
2. Math → use unicode: x² √(x) π ∫ Σ ≤ ≥ ≠ ≈ ±
3. Mix → format naturally
4. Never add explanations. If unclear: [?]`,
          contexto: null, historial: [], perfil: null, todosDocumentos: [],
          idioma: 'auto', imageBase64: base64, imageMime: 'image/png',
        }),
      });
      const data = await res.json();
      if (data.success && data.respuesta) {
        onTextInsert?.(data.respuesta.trim(), rect.y);
        deleteSelection();
      }
    } catch (err) { console.error('convertToText error:', err); }
    finally { setConverting(false); }
  };

  const solveMath = () => {
    const imageData = getCroppedCanvas();
    if (!imageData || !onPeterSauPeter) return;
    onPeterSauPeter(imageData.split(',')[1], 'image/png');
  };

  useEffect(() => {
    if (onRegisterExport) {
      onRegisterExport(() => {
        const c = mainCanvasRef.current;
        if (!c || strokesRef.current.length === 0) return null;
        return c.toDataURL('image/png');
      });
    }
    if (onRegisterStrokesExport) {
      onRegisterStrokesExport(() => {
        if (strokesRef.current.length === 0) return null;
        return JSON.stringify(strokesRef.current.map(s => ({
          id: s.id,
          points: s.points.map(p => ({
            x: Math.round(p.x * 10) / 10,
            y: Math.round(p.y * 10) / 10,
            pressure: Math.round((p.pressure ?? 1) * 100) / 100,
          })),
          color: s.color,
          size: s.size,
          tipo: s.tipo,
          ...(s.shapeEnd ? { shapeEnd: s.shapeEnd } : {}),
          ...(s.bounds ? { bounds: s.bounds } : {}),
        })));
      });
    }
    if (onRegisterUndoRedo) onRegisterUndoRedo(undo, redo);
    (window as any).__editorUndo = undo;
    (window as any).__editorRedo = redo;
  }, [undo, redo, onRegisterExport, onRegisterStrokesExport, onRegisterUndoRedo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isDrawingTool && !isSelecting) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.length > 0) {
        const ae = document.activeElement;
        if (!ae || (ae.getAttribute('contenteditable') !== 'true' && !['INPUT', 'TEXTAREA'].includes(ae.tagName))) {
          e.preventDefault(); deleteSelection();
        }
      }
      if (meta && e.key === 'c' && selectedIdsRef.current.length > 0) { e.preventDefault(); copySelection(); }
      if (meta && e.key === 'x' && selectedIdsRef.current.length > 0) { e.preventDefault(); cutSelection(); }
      if (meta && e.key === 'v' && clipboardRef.current.length > 0) {
        e.preventDefault();
        const off = 30;
        const pasted = clipboardRef.current.map(s => ({
          ...JSON.parse(JSON.stringify(s)),
          id: genStrokeId(),
          points: s.points.map((p: any) => ({ ...p, x: p.x + off, y: p.y + off })),
          bounds: s.bounds ? { x: s.bounds.x + off, y: s.bounds.y + off, w: s.bounds.w, h: s.bounds.h } : undefined,
          shapeEnd: s.shapeEnd ? { x: s.shapeEnd.x + off, y: s.shapeEnd.y + off } : undefined,
        }));
        strokesRef.current.push(...pasted);
        setStrokeCount(strokesRef.current.length);
        redrawMain();
        onChange();
      }
      if (meta && e.key === 'd' && selectedIdsRef.current.length > 0) { e.preventDefault(); duplicateSelection(); }
      if (e.key === 'Escape') {
        syncSelectionUI(null, []);
        redrawOverlay(null);
        isShapeActiveRef.current = false;
        shapeStartRef.current = null;
        shapeEndRef.current = null;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [
    isDrawingTool, isSelecting, undo, redo, deleteSelection,
    copySelection, cutSelection, duplicateSelection, syncSelectionUI,
    redrawMain, redrawOverlay, onChange,
  ]);

  useEffect(() => { redrawMain(); }, [selectedIds, redrawMain]);

  const getCursor = (): string => {
    if (isMovingRef.current) return 'grabbing';
    if (isSelecting && selectionRect && selectedIds.length > 0) return 'grab';
    if (isSelecting) return 'crosshair';
    if (isShapeTool) return 'crosshair';
    if (herramienta === 'borrador_trazo') {
      const r = Math.min(Math.max(brushSize * 2, 8), 24);
      const sz = r * 2 + 4;
      return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${sz}' height='${sz}'%3E%3Ccircle cx='${sz/2}' cy='${sz/2}' r='${r}' fill='none' stroke='%23ef4444' stroke-width='2' stroke-dasharray='4 2'/%3E%3Ccircle cx='${sz/2}' cy='${sz/2}' r='2' fill='%23ef4444'/%3E%3C/svg%3E") ${sz/2} ${sz/2}, cell`;
    }
    if (isEraser) return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='20'%3E%3Crect x='1' y='1' width='26' height='18' rx='3' fill='white' stroke='%23d1d5db' stroke-width='1.5'/%3E%3C/svg%3E") 14 10, cell`;
    if (isDrawingTool) return 'crosshair';
    return 'default';
  };

  const canvasStyle: React.CSSProperties = {
    position: 'absolute', top: 0, left: 0,
    touchAction: 'none', background: 'transparent',
    imageRendering: 'auto',
    // Prevenir selección de texto al dibujar
    userSelect: 'none',
    WebkitUserSelect: 'none',
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: isCanvasActive ? 'all' : 'none',
        zIndex: isCanvasActive ? 20 : 1,
        overflow: 'hidden',
        // Bloquear selección de texto en todo el contenedor
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
      } as React.CSSProperties}
    >
      <canvas ref={mainCanvasRef} style={{ ...canvasStyle, zIndex: 1, pointerEvents: 'none' }} />
      <canvas ref={liveCanvasRef} style={{ ...canvasStyle, zIndex: 2, pointerEvents: 'none' }} />
      <canvas ref={overlayCanvasRef} style={{ ...canvasStyle, zIndex: 3, pointerEvents: 'none' }} />

      {/* Input layer: captura todos los eventos, bloquea selección */}
      <div
        ref={inputLayerRef}
        onDragStart={e => e.preventDefault()}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          zIndex: 4,
          touchAction: 'none',
          cursor: getCursor(),
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          // Evitar highlight azul en iOS/Android
          WebkitTapHighlightColor: 'transparent',
        } as React.CSSProperties}
      />

      {menuPos && selectedIds.length > 0 && (
        <SelectionMenu
          menuPos={menuPos}
          converting={converting}
          onMove={() => { isMovingRef.current = true; moveStartRef.current = null; setMenuPos(null); }}
          onConvert={convertToText}
          onCopy={copySelection}
          onCut={cutSelection}
          onDuplicate={duplicateSelection}
          onSave={() => {
            const img = getCroppedCanvas();
            if (!img) return;
            const a = document.createElement('a');
            a.download = 'selection.png'; a.href = img; a.click();
          }}
          onDelete={deleteSelection}
          onPeterSauPeter={onPeterSauPeter ? solveMath : undefined}
        />
      )}

      {isCanvasActive && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          display: 'flex', gap: 6, zIndex: 30,
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}>
          {[
            { fn: undo, icon: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11', title: 'Undo' },
            { fn: redo, icon: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13', title: 'Redo' },
          ].map(({ fn, icon, title }) => (
            <button key={title} onClick={fn} title={title} style={{
              padding: '7px 10px', borderRadius: 8,
              border: '1.5px solid #e5e7eb',
              background: 'rgba(255,255,255,0.96)',
              color: '#374151', cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              display: 'flex', alignItems: 'center',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            } as React.CSSProperties}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d={icon} />
              </svg>
            </button>
          ))}
          {strokeCount > 0 && (
            <div style={{
              padding: '7px 10px', borderRadius: 8,
              background: 'rgba(255,255,255,0.96)',
              color: '#9ca3af', fontSize: 11,
              backdropFilter: 'blur(8px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              display: 'flex', alignItems: 'center',
              userSelect: 'none',
            }}>{strokeCount}</div>
          )}
        </div>
      )}
    </div>
  );
}
