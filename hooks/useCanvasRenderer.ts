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
  const dprRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  // Offscreen buffer — fuente de verdad visual
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const getDpr = () => {
    if (typeof window === 'undefined') return 1;
    return Math.min(window.devicePixelRatio || 1, 3);
  };

  const setup = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = getDpr();
    dprRef.current = dpr;

    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // Crear/redimensionar offscreen buffer
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    offscreenRef.current.width = w;
    offscreenRef.current.height = h;

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

  // Limpiar canvas completamente
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

    // También limpiar offscreen
    const off = offscreenRef.current;
    if (off) {
      const offCtx = off.getContext('2d');
      if (offCtx) {
        offCtx.save();
        offCtx.setTransform(1, 0, 0, 1, 0, 0);
        offCtx.clearRect(0, 0, off.width, off.height);
        offCtx.restore();
      }
    }
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

  // ─── Render completo desde datos vectoriales ────────────────────────────
  // Siempre reconstruye desde cero — nunca pierde trazos
  const renderStrokes = useCallback((
    strokes: Stroke[],
    selectedIds: Set<string>,
    erasingIds: Set<string>,
  ) => {
    const canvas = canvasRef.current;
    const off = offscreenRef.current;
    if (!canvas || !off) return;

    const dpr = dprRef.current;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;

    // 1) Dibujar todo en el offscreen buffer
    offCtx.save();
    offCtx.setTransform(1, 0, 0, 1, 0, 0);
    offCtx.clearRect(0, 0, off.width, off.height);
    offCtx.restore();
    offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    offCtx.imageSmoothingEnabled = true;
    offCtx.imageSmoothingQuality = 'high';

    for (const stroke of strokes) {
      if (stroke.tipo === 'borrador_trazo') {
        // Borrador de píxeles — destination-out
        offCtx.save();
        offCtx.globalCompositeOperation = 'destination-out';
        offCtx.strokeStyle = 'rgba(0,0,0,1)';
        offCtx.lineWidth = stroke.size * 3;
        offCtx.lineCap = 'round';
        offCtx.lineJoin = 'round';
        offCtx.globalAlpha = 1;
        const pts = stroke.points;
        if (pts.length === 1) {
          offCtx.beginPath();
          offCtx.arc(pts[0].x, pts[0].y, stroke.size * 1.5, 0, Math.PI * 2);
          offCtx.fill();
        } else if (pts.length > 1) {
          offCtx.beginPath();
          offCtx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1];
            const curr = pts[i];
            const mx = (prev.x + curr.x) / 2;
            const my = (prev.y + curr.y) / 2;
            offCtx.quadraticCurveTo(prev.x, prev.y, mx, my);
          }
          offCtx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          offCtx.stroke();
        }
        offCtx.restore();
        continue;
      }

      if (erasingIds.has(stroke.id)) {
        // Highlight rosa oscuro para borrador stroke
        offCtx.save();
        offCtx.globalAlpha = 0.25;
        drawStrokeOnCtx(offCtx, stroke, false);
        offCtx.restore();

        offCtx.save();
        offCtx.globalAlpha = 0.6;
        offCtx.strokeStyle = '#be185d';
        offCtx.lineWidth = Math.max(stroke.size + 8, 12);
        offCtx.lineCap = 'round';
        offCtx.lineJoin = 'round';
        offCtx.globalCompositeOperation = 'source-over';
        const pts = stroke.points;
        if (pts.length > 1) {
          offCtx.beginPath();
          offCtx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            offCtx.lineTo(pts[i].x, pts[i].y);
          }
          offCtx.stroke();
        }
        offCtx.restore();
      } else {
        drawStrokeOnCtx(offCtx, stroke, selectedIds.has(stroke.id));
      }
    }

    // 2) Copiar offscreen → canvas visible en un solo blit (sin parpadeo)
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(off, 0, 0);
      ctx.restore();
      applyDpr(ctx);
    }
  }, [canvasRef, applyDpr]);

  // ─── Segmento incremental durante el dibujo ─────────────────────────────
  // Dibuja sobre el offscreen Y el canvas visible simultáneamente
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
