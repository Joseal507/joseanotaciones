import { useRef, useCallback, useEffect } from 'react';
import { Stroke, Point, applyStrokeStyle, drawStrokeOnCtx, drawShape } from '../components/editor/canvasUtils';
import { catmullToBezier } from './useStrokeEngine';

interface RendererOptions {
  dpr?: number;
}

export interface RenderTransform {
  scale: number;
  tx: number;
  ty: number;
}

export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: RendererOptions = {},
) {
  const dprRef = useRef(Math.min((options.dpr ?? window.devicePixelRatio ?? 1) * 1.5, 3));
  const rafRef = useRef<number | null>(null);
  const isDirty = useRef(false);
  const transformRef = useRef<RenderTransform>({ scale: 1, tx: 0, ty: 0 });

  /**
   * Setup canvas with correct DPR
   */
  const setup = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    }
  }, [canvasRef]);

  const applyDpr = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
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

  /**
   * Render all strokes with culling (skip off-screen strokes)
   */
  const renderStrokes = useCallback((
    strokes: Stroke[],
    selectedIds: Set<string>,
    erasingIds: Set<string>,
    viewport?: { x: number; y: number; w: number; h: number },
  ) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    clear();
    applyDpr(ctx);

    for (const stroke of strokes) {
      // Culling: skip strokes outside viewport
      if (viewport && stroke.bounds) {
        const b = stroke.bounds;
        const pad = stroke.size * 4;
        if (
          b.x + b.w + pad < viewport.x ||
          b.x - pad > viewport.x + viewport.w ||
          b.y + b.h + pad < viewport.y ||
          b.y - pad > viewport.y + viewport.h
        ) continue;
      }

      if (erasingIds.has(stroke.id)) {
        // Preview erase
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = '#ff4d6d';
        ctx.lineWidth = stroke.size + 2;
        ctx.lineCap = 'round';
        drawStrokeOnCtx(ctx, stroke, false);
        ctx.restore();
      } else {
        drawStrokeOnCtx(ctx, stroke, selectedIds.has(stroke.id));
      }
    }
  }, [canvasRef, clear, applyDpr]);

  /**
   * Draw a single stroke segment incrementally (during drawing)
   * Uses Catmull-Rom → Bezier for smooth curves
   */
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
      c.arc(p.x, p.y, c.lineWidth / 2, 0, Math.PI * 2);
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

    // Catmull-Rom for 3+ points
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

  /**
   * Schedule a render with RAF (batching)
   */
  const scheduleRender = useCallback((fn: () => void) => {
    isDirty.current = true;
    if (rafRef.current) return; // Already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (isDirty.current) {
        isDirty.current = false;
        fn();
      }
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
    applyDpr,
    renderStrokes,
    renderStrokeSegment,
    scheduleRender,
    dpr: dprRef,
  };
}
