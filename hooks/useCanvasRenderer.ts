import { useRef, useCallback, useEffect } from 'react';
import { Stroke, Point, applyStrokeStyle, drawStrokeOnCtx } from '../components/editor/canvasUtils';
import { catmullToBezier } from './useStrokeEngine';

interface RendererOptions {
  dpr?: number;
}

export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: RendererOptions = {},
) {
  const dprRef = useRef(
    options.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) * 2
  );
  const rafRef = useRef<number | null>(null);

  const setup = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    dprRef.current = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) * 2;
    const dpr = dprRef.current;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  }, [canvasRef]);

  const applyDpr = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }, []);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    applyDpr(ctx);
  }, [canvasRef, applyDpr]);

  const clearLive = useCallback(() => {
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

  const renderStrokes = useCallback((
    strokes: Stroke[],
    selectedIds: Set<string>,
    erasingIds: Set<string>,
  ) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    clear();
    for (const stroke of strokes) {
      if (erasingIds.has(stroke.id)) {
        // Dibujar el trazo original con opacidad baja
        ctx.save();
        ctx.globalAlpha = 0.3;
        drawStrokeOnCtx(ctx, stroke, false);
        ctx.restore();
        // Highlight rosa oscuro encima
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#be185d';
        ctx.lineWidth = Math.max(stroke.size + 6, 10);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const pts = stroke.points;
        if (pts.length > 0) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          ctx.stroke();
        }
        ctx.restore();
      } else {
        drawStrokeOnCtx(ctx, stroke, selectedIds.has(stroke.id));
      }
    }
  }, [canvasRef, clear]);

  // Dibuja UN segmento incremental en el live canvas
  // NO limpia — solo añade el segmento nuevo
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

    c.save();
    applyDpr(c);

    const len = points.length;

    if (len === 1) {
      const p = points[0];
      applyStrokeStyle(c, tipo, color, size, p.pressure ?? 1);
      c.beginPath();
      c.arc(p.x, p.y, Math.max(c.lineWidth / 2, 0.5), 0, Math.PI * 2);
      c.fill();
      c.restore();
      return;
    }

    if (len === 2) {
      const [p0, p1] = points;
      applyStrokeStyle(c, tipo, color, size, (p0.pressure + p1.pressure) / 2);
      c.beginPath();
      c.moveTo(p0.x, p0.y);
      c.lineTo(p1.x, p1.y);
      c.stroke();
      c.restore();
      return;
    }

    const p0 = points[Math.max(0, len - 4)];
    const p1 = points[Math.max(0, len - 3)];
    const p2 = points[len - 2];
    const p3 = points[len - 1];

    const pressure = (p2.pressure + p3.pressure) / 2;
    applyStrokeStyle(c, tipo, color, size, pressure);

    if (len >= 4) {
      const { cp1, cp2 } = catmullToBezier(p0, p1, p2, p3);
      c.beginPath();
      c.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      c.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
      c.stroke();
    } else {
      c.beginPath();
      c.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      c.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      c.stroke();
    }

    c.restore();
  }, [canvasRef, applyDpr]);

  // Renderizar borrador_trazo en vivo (destination-out en live canvas)
  const renderEraserSegment = useCallback((
    points: Point[],
    size: number,
    ctx?: CanvasRenderingContext2D | null,
  ) => {
    const canvas = canvasRef.current;
    const c = ctx ?? canvas?.getContext('2d');
    if (!c || points.length < 2) return;

    c.save();
    applyDpr(c);
    c.globalCompositeOperation = 'destination-out';
    c.strokeStyle = 'rgba(0,0,0,1)';
    c.lineWidth = size * 3;
    c.lineCap = 'round';
    c.lineJoin = 'round';

    const len = points.length;
    const p0 = points[Math.max(0, len - 3)];
    const p1 = points[Math.max(0, len - 2)];
    const p2 = points[len - 1];

    c.beginPath();
    c.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    c.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    c.stroke();
    c.restore();
  }, [canvasRef, applyDpr]);

  const scheduleRender = useCallback((fn: () => void) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      fn();
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    setup,
    clear,
    clearLive,
    applyDpr,
    renderStrokes,
    renderStrokeSegment,
    renderEraserSegment,
    scheduleRender,
    dpr: dprRef,
  };
}
