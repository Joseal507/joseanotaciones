import { useRef, useCallback, useEffect } from 'react';
import { Stroke, Point, applyStrokeStyle, drawStrokeOnCtx } from '../components/editor/canvasUtils';
import { catmullToBezier } from './useStrokeEngine';

export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: { dpr?: number } = {},
) {
  const dprRef = useRef(1);
  const backBufferRef = useRef<HTMLCanvasElement | null>(null);
  const liveBufferRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const needsCommitRef = useRef(false);

  const getDpr = (): number => {
    if (typeof window === 'undefined') return 1;
    return window.devicePixelRatio || 1;
  };

  const prepCtx = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return null;
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  };

  const clearCanvas = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  };

  // Commit atómico: front = back + live en UNA sola operación
  const commit = useCallback(() => {
    const front = canvasRef.current;
    const back = backBufferRef.current;
    const live = liveBufferRef.current;
    if (!front || !back) return;
    const ctx = front.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, front.width, front.height);
    ctx.drawImage(back, 0, 0);
    if (live) ctx.drawImage(live, 0, 0);
    ctx.restore();
  }, [canvasRef]);

  // Commit inmediato — para borrador y operaciones críticas sin delay
  const commitNow = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    needsCommitRef.current = false;
    commit();
  }, [commit]);

  // Commit via RAF — para dibujo normal sincronizado con display
  const scheduleCommit = useCallback(() => {
    needsCommitRef.current = true;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (needsCommitRef.current) {
        needsCommitRef.current = false;
        commit();
      }
    });
  }, [commit]);

  const setup = useCallback((cssWidth: number, cssHeight: number) => {
    const front = canvasRef.current;
    if (!front) return;
    const dpr = getDpr();
    dprRef.current = dpr;
    const pw = Math.round(cssWidth * dpr);
    const ph = Math.round(cssHeight * dpr);

    front.width = pw;
    front.height = ph;
    front.style.width = `${cssWidth}px`;
    front.style.height = `${cssHeight}px`;
    const fCtx = front.getContext('2d');
    if (fCtx) {
      fCtx.imageSmoothingEnabled = true;
      fCtx.imageSmoothingQuality = 'high';
    }

    if (!backBufferRef.current) backBufferRef.current = document.createElement('canvas');
    backBufferRef.current.width = pw;
    backBufferRef.current.height = ph;

    if (!liveBufferRef.current) liveBufferRef.current = document.createElement('canvas');
    liveBufferRef.current.width = pw;
    liveBufferRef.current.height = ph;

    commitNow();
  }, [canvasRef, commitNow]);

  const applyDpr = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }, []);

  const clear = useCallback(() => {
    if (backBufferRef.current) clearCanvas(backBufferRef.current);
    if (liveBufferRef.current) clearCanvas(liveBufferRef.current);
    commitNow();
  }, [commitNow]);

  const clearLive = useCallback(() => {
    if (liveBufferRef.current) clearCanvas(liveBufferRef.current);
  }, []);

  // Reconstruir backBuffer desde vectores — solo al terminar un stroke
  const renderStrokes = useCallback((
    strokes: Stroke[],
    selectedIds: Set<string>,
    erasingIds: Set<string>,
  ) => {
    const back = backBufferRef.current;
    if (!back) return;
    clearCanvas(back);
    const ctx = prepCtx(back);
    if (!ctx) return;

    for (const stroke of strokes) {
      if (stroke.tipo === 'borrador_trazo') {
        _drawEraserStroke(ctx, stroke);
        continue;
      }
      if (erasingIds.has(stroke.id)) {
        _drawErasingHighlight(ctx, stroke);
      } else {
        drawStrokeOnCtx(ctx, stroke, selectedIds.has(stroke.id));
      }
    }

    commitNow();
  }, [commitNow]);

  // Segmento en tiempo real — dibuja en liveBuffer + front canvas INMEDIATAMENTE
  // El liveBuffer se usa para reconstrucción, el front para latencia cero
  const renderStrokeSegment = useCallback((
    points: Point[],
    color: string,
    size: number,
    tipo: string,
    _ignored?: CanvasRenderingContext2D | null,
  ) => {
    const live = liveBufferRef.current;
    const front = canvasRef.current;
    if (!live) return;
    const liveCtx = prepCtx(live);
    if (!liveCtx) return;

    // También obtener el front canvas para dibujo inmediato sin delay
    const frontCtx = front?.getContext('2d') ?? null;
    if (frontCtx) {
      frontCtx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
      frontCtx.imageSmoothingEnabled = true;
      frontCtx.imageSmoothingQuality = 'high';
      frontCtx.lineCap = 'round';
      frontCtx.lineJoin = 'round';
    }

    const len = points.length;
    if (len < 1) return;

    const drawOn = (c: CanvasRenderingContext2D) => {
      c.save();
      if (len === 1) {
        const p = points[0];
        applyStrokeStyle(c, tipo, color, size, p.pressure ?? 1);
        c.beginPath();
        c.arc(p.x, p.y, Math.max(c.lineWidth / 2, 0.5), 0, Math.PI * 2);
        c.fill();
      } else {
        const p0 = points[Math.max(0, len - 4)];
        const p1 = points[Math.max(0, len - 3)];
        const p2 = points[len - 2];
        const p3 = points[len - 1];
        const pressure = (p2.pressure + p3.pressure) / 2;
        applyStrokeStyle(c, tipo, color, size, pressure);

        if (len >= 4) {
          const { cp1, cp2 } = catmullToBezier(p0, p1, p2, p3);
          c.beginPath();
          c.moveTo((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
          c.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
          c.stroke();
        } else if (len === 3) {
          c.beginPath();
          c.moveTo((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
          c.quadraticCurveTo(p2.x, p2.y, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
          c.stroke();
        } else {
          c.beginPath();
          c.moveTo(p2.x, p2.y);
          c.lineTo(p3.x, p3.y);
          c.stroke();
        }
      }
      c.restore();
    };

    // Dibujar en liveBuffer (para reconstrucción)
    drawOn(liveCtx);
    // Dibujar INMEDIATAMENTE en front canvas (latencia cero, el usuario lo ve al instante)
    if (frontCtx) drawOn(frontCtx);
  }, [canvasRef]);

  // Borrador de píxeles — INMEDIATO sin delay
  const renderEraserSegment = useCallback((
    points: Point[],
    size: number,
    _ignored?: CanvasRenderingContext2D | null,
  ) => {
    const back = backBufferRef.current;
    if (!back || points.length < 1) return;
    const ctx = prepCtx(back);
    if (!ctx) return;

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = size * 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 1;

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, size * 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const len = points.length;
      const p0 = points[Math.max(0, len - 3)];
      const p1 = points[Math.max(0, len - 2)];
      const p2 = points[len - 1];
      ctx.beginPath();
      ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      ctx.stroke();
    }
    ctx.restore();
    commitNow(); // inmediato para borrador sin delay
  }, [commitNow]);

  const scheduleRender = useCallback((fn: () => void) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      fn();
    });
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  return {
    setup, clear, clearLive, applyDpr,
    renderStrokes, renderStrokeSegment,
    renderEraserSegment, scheduleRender,
    dpr: dprRef,
    _commit: commitNow,
    _commitNow: commitNow,
  };
}

function _drawEraserStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points;
  if (!pts.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.lineWidth = stroke.size * 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, stroke.size * 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1].x + pts[i].x) / 2;
      const my = (pts[i - 1].y + pts[i].y) / 2;
      ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  }
  ctx.restore();
}

function _drawErasingHighlight(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points;
  ctx.save();
  ctx.globalAlpha = 0.25;
  drawStrokeOnCtx(ctx, stroke, false);
  ctx.restore();
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = '#be185d';
  ctx.lineWidth = Math.max(stroke.size + 8, 12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}
