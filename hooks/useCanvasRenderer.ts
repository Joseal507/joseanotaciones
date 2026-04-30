import { useRef, useCallback, useEffect } from 'react';
import { Stroke, Point, applyStrokeStyle, drawStrokeOnCtx } from '../components/editor/canvasUtils';
import { catmullToBezier } from './useStrokeEngine';

export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: { dpr?: number } = {},
) {
  const dprRef = useRef(1);
  const rafRef = useRef<number | null>(null);

  const getDpr = () => {
    if (typeof window === 'undefined') return 1;
    return Math.min(window.devicePixelRatio || 1, 3);
  };

  const setup = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = getDpr();
    dprRef.current = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
  }, [canvasRef]);

  const applyDpr = useCallback((ctx: CanvasRenderingContext2D) => {
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }, []);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    applyDpr(ctx);
  }, [canvasRef, applyDpr]);

  const clearLive = clear;

  // ─── Full redraw desde vectores ─────────────────────────────────────────
  const renderStrokes = useCallback((
    strokes: Stroke[],
    selectedIds: Set<string>,
    erasingIds: Set<string>,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Limpiar
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    applyDpr(ctx);

    for (const stroke of strokes) {
      if (stroke.tipo === 'borrador_trazo') {
        _applyEraserStroke(ctx, stroke);
        continue;
      }
      if (erasingIds.has(stroke.id)) {
        _drawErasingHighlight(ctx, stroke);
      } else {
        drawStrokeOnCtx(ctx, stroke, selectedIds.has(stroke.id));
      }
    }
  }, [canvasRef, applyDpr]);

  // ─── Segmento en tiempo real — INMEDIATO, sin RAF ───────────────────────
  // Se llama en cada pointermove, dibuja al canvas directamente
  const renderStrokeSegment = useCallback((
    points: Point[],
    color: string,
    size: number,
    tipo: string,
    ctx?: CanvasRenderingContext2D | null,
  ) => {
    const canvas = canvasRef.current;
    const c = ctx ?? canvas?.getContext('2d');
    if (!c) return;

    const len = points.length;
    if (len < 1) return;

    c.save();
    applyDpr(c);

    if (len === 1) {
      const p = points[0];
      applyStrokeStyle(c, tipo, color, size, p.pressure ?? 1);
      c.beginPath();
      c.arc(p.x, p.y, Math.max(c.lineWidth / 2, 0.5), 0, Math.PI * 2);
      c.fill();
      c.restore();
      return;
    }

    // Dibujar solo el segmento más reciente (los últimos 2-4 puntos)
    // NUNCA redibujar todo el path — solo el trozo nuevo
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

    c.restore();
  }, [canvasRef, applyDpr]);

  // ─── Borrador de píxeles en tiempo real ─────────────────────────────────
  const renderEraserSegment = useCallback((
    points: Point[],
    size: number,
    ctx?: CanvasRenderingContext2D | null,
  ) => {
    const canvas = canvasRef.current;
    const c = ctx ?? canvas?.getContext('2d');
    if (!c || points.length < 1) return;

    c.save();
    applyDpr(c);
    c.globalCompositeOperation = 'destination-out';
    c.strokeStyle = 'rgba(0,0,0,1)';
    c.fillStyle = 'rgba(0,0,0,1)';
    c.lineWidth = size * 3;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalAlpha = 1;

    if (points.length === 1) {
      c.beginPath();
      c.arc(points[0].x, points[0].y, size * 1.5, 0, Math.PI * 2);
      c.fill();
    } else {
      const len = points.length;
      const p0 = points[Math.max(0, len - 3)];
      const p1 = points[Math.max(0, len - 2)];
      const p2 = points[len - 1];
      c.beginPath();
      c.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      c.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      c.stroke();
    }
    c.restore();
  }, [canvasRef, applyDpr]);

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
  };
}

// ─── Helpers internos ────────────────────────────────────────────────────────
function _applyEraserStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points;
  if (pts.length === 0) return;
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
      const prev = pts[i - 1];
      const curr = pts[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
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
