import { useRef, useCallback, useEffect } from 'react';
import { Stroke, Point, applyStrokeStyle, drawStrokeOnCtx } from '../components/editor/canvasUtils';
import { catmullToBezier } from './useStrokeEngine';

export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: { dpr?: number } = {},
) {
  const dprRef = useRef(1);
  // backBuffer: donde se dibuja todo — nunca visible directamente
  const backBufferRef = useRef<HTMLCanvasElement | null>(null);
  // liveBuffer: solo el trazo actual en progreso
  const liveBufferRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const needsCommitRef = useRef(false);
  const isRenderingRef = useRef(false);

  const getDpr = () => {
    if (typeof window === 'undefined') return 1;
    // DPR exacto del dispositivo — sin multiplicar para evitar blur
    return Math.min(window.devicePixelRatio || 1, 3);
  };

  // ─── Crear/resize offscreen buffers ─────────────────────────────────────
  const ensureBuffers = useCallback((w: number, h: number) => {
    if (!backBufferRef.current) {
      backBufferRef.current = document.createElement('canvas');
    }
    if (!liveBufferRef.current) {
      liveBufferRef.current = document.createElement('canvas');
    }
    if (backBufferRef.current.width !== w || backBufferRef.current.height !== h) {
      // Preservar contenido del backBuffer al redimensionar
      const tmp = document.createElement('canvas');
      tmp.width = backBufferRef.current.width;
      tmp.height = backBufferRef.current.height;
      const tmpCtx = tmp.getContext('2d');
      tmpCtx?.drawImage(backBufferRef.current, 0, 0);

      backBufferRef.current.width = w;
      backBufferRef.current.height = h;
      const bbCtx = backBufferRef.current.getContext('2d');
      if (bbCtx) {
        bbCtx.drawImage(tmp, 0, 0);
      }
    }
    liveBufferRef.current.width = w;
    liveBufferRef.current.height = h;
  }, []);

  // ─── Commit: copiar back+live → front en UNA SOLA operación atómica ─────
  // El usuario NUNCA ve un estado intermedio
  const commit = useCallback(() => {
    const front = canvasRef.current;
    const back = backBufferRef.current;
    const live = liveBufferRef.current;
    if (!front || !back) return;

    const ctx = front.getContext('2d');
    if (!ctx) return;

    // Una sola operación visible: clear + composición
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, front.width, front.height);
    ctx.drawImage(back, 0, 0); // trazos finales
    if (live) ctx.drawImage(live, 0, 0); // trazo en progreso
    ctx.restore();
  }, [canvasRef]);

  // ─── Commit via RAF — sincronizado con el display ────────────────────────
  const scheduleCommit = useCallback(() => {
    needsCommitRef.current = true;
    if (rafRef.current) return; // ya hay uno pendiente
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (needsCommitRef.current) {
        needsCommitRef.current = false;
        commit();
      }
    });
  }, [commit]);

  // ─── Setup ───────────────────────────────────────────────────────────────
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

    // Configurar front canvas — solo recibe drawImage, nunca se dibuja directo
    const ctx = canvas.getContext('2d', { alpha: true });
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    ensureBuffers(w, h);
    commit();
  }, [canvasRef, ensureBuffers, commit]);

  const applyDpr = useCallback((ctx: CanvasRenderingContext2D) => {
    const dpr = dprRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }, []);

  // ─── Obtener contexto del backBuffer ─────────────────────────────────────
  const getBackCtx = useCallback((): CanvasRenderingContext2D | null => {
    const back = backBufferRef.current;
    if (!back) return null;
    const ctx = back.getContext('2d');
    if (!ctx) return null;
    applyDpr(ctx);
    return ctx;
  }, [applyDpr]);

  // ─── Obtener contexto del liveBuffer ─────────────────────────────────────
  const getLiveCtx = useCallback((): CanvasRenderingContext2D | null => {
    const live = liveBufferRef.current;
    if (!live) return null;
    const ctx = live.getContext('2d');
    if (!ctx) return null;
    applyDpr(ctx);
    return ctx;
  }, [applyDpr]);

  // ─── Clear: limpiar backBuffer + liveBuffer ───────────────────────────────
  const clear = useCallback(() => {
    const back = backBufferRef.current;
    const live = liveBufferRef.current;
    if (back) {
      const ctx = back.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, back.width, back.height);
        ctx.restore();
      }
    }
    if (live) {
      const ctx = live.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, live.width, live.height);
        ctx.restore();
      }
    }
    scheduleCommit();
  }, [scheduleCommit]);

  // ─── clearLive: solo limpiar el live buffer ───────────────────────────────
  const clearLive = useCallback(() => {
    const live = liveBufferRef.current;
    if (!live) return;
    const ctx = live.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, live.width, live.height);
      ctx.restore();
    }
  }, []);

  // ─── renderStrokes: reconstruir backBuffer desde vectores ────────────────
  // Solo se llama al TERMINAR un stroke, nunca durante el dibujo
  const renderStrokes = useCallback((
    strokes: Stroke[],
    selectedIds: Set<string>,
    erasingIds: Set<string>,
  ) => {
    const back = backBufferRef.current;
    if (!back) return;

    const ctx = back.getContext('2d');
    if (!ctx) return;

    // Limpiar backBuffer
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, back.width, back.height);
    ctx.restore();
    applyDpr(ctx);

    // Dibujar todos los strokes en el backBuffer
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

    // Commit atómico al front canvas
    scheduleCommit();
  }, [applyDpr, scheduleCommit]);

  // ─── renderStrokeSegment: dibujar segmento en liveBuffer — INMEDIATO ─────
  // Se llama en cada pointermove — dibuja solo en liveBuffer
  // Luego commit via RAF para sincronizar con display
  const renderStrokeSegment = useCallback((
    points: Point[],
    color: string,
    size: number,
    tipo: string,
    _ctx?: CanvasRenderingContext2D | null, // ignorado — usamos liveBuffer
  ) => {
    const ctx = getLiveCtx();
    if (!ctx) return;

    const len = points.length;
    if (len < 1) return;

    ctx.save();

    if (len === 1) {
      const p = points[0];
      applyStrokeStyle(ctx, tipo, color, size, p.pressure ?? 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(ctx.lineWidth / 2, 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      scheduleCommit();
      return;
    }

    // Solo dibujar el segmento más reciente — nunca redibujar todo el path
    const p0 = points[Math.max(0, len - 4)];
    const p1 = points[Math.max(0, len - 3)];
    const p2 = points[len - 2];
    const p3 = points[len - 1];

    const pressure = (p2.pressure + p3.pressure) / 2;
    applyStrokeStyle(ctx, tipo, color, size, pressure);

    if (len >= 4) {
      const { cp1, cp2 } = catmullToBezier(p0, p1, p2, p3);
      ctx.beginPath();
      ctx.moveTo((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
      ctx.stroke();
    } else if (len === 3) {
      ctx.beginPath();
      ctx.moveTo((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      ctx.quadraticCurveTo(p2.x, p2.y, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.stroke();
    }

    ctx.restore();

    // Commit via RAF — sincronizado con display, sin parpadeo
    scheduleCommit();
  }, [getLiveCtx, scheduleCommit]);

  // ─── renderEraserSegment: borrar en backBuffer en tiempo real ────────────
  const renderEraserSegment = useCallback((
    points: Point[],
    size: number,
    _ctx?: CanvasRenderingContext2D | null,
  ) => {
    const ctx = getBackCtx();
    if (!ctx || points.length < 1) return;

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

    scheduleCommit();
  }, [getBackCtx, scheduleCommit]);

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
    // Exponer para uso interno en EditorCanvas
    _commit: commit,
    _getBackCtx: getBackCtx,
    _getLiveCtx: getLiveCtx,
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
