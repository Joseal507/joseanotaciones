import { useRef, useCallback } from 'react';
import { Point, Stroke, genStrokeId } from '../components/editor/canvasUtils';

/**
 * Catmull-Rom → Bezier conversion for smooth strokes
 * Converts 4 control points to cubic bezier cp1, cp2
 */
function catmullToBezier(
  p0: Point, p1: Point, p2: Point, p3: Point, alpha = 0.5
): { cp1: Point; cp2: Point } {
  const t01 = Math.pow(Math.hypot(p1.x - p0.x, p1.y - p0.y), alpha);
  const t12 = Math.pow(Math.hypot(p2.x - p1.x, p2.y - p1.y), alpha);
  const t23 = Math.pow(Math.hypot(p3.x - p2.x, p3.y - p2.y), alpha);

  const eps = 1e-4;
  const m1x = (t12 === 0) ? 0 : (p2.x - p1.x + t12 * ((p1.x - p0.x) / (t01 + eps) - (p2.x - p0.x) / (t01 + t12 + eps)));
  const m1y = (t12 === 0) ? 0 : (p2.y - p1.y + t12 * ((p1.y - p0.y) / (t01 + eps) - (p2.y - p0.y) / (t01 + t12 + eps)));
  const m2x = (t12 === 0) ? 0 : (p2.x - p1.x + t12 * ((p3.x - p2.x) / (t23 + eps) - (p3.x - p1.x) / (t12 + t23 + eps)));
  const m2y = (t12 === 0) ? 0 : (p2.y - p1.y + t12 * ((p3.y - p2.y) / (t23 + eps) - (p3.y - p1.y) / (t12 + t23 + eps)));

  return {
    cp1: { x: p1.x + m1x / 3, y: p1.y + m1y / 3, pressure: p1.pressure },
    cp2: { x: p2.x - m2x / 3, y: p2.y - m2y / 3, pressure: p2.pressure },
  };
}

/**
 * Douglas-Peucker simplification to reduce point count
 * without losing visual quality
 */
function simplifyPoints(points: Point[], epsilon = 0.5): Point[] {
  if (points.length <= 2) return points;

  const sqDist = (p: Point, a: Point, b: Point): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = sqDist(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPoints(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

export interface StrokeEngineState {
  currentStroke: React.MutableRefObject<Stroke | null>;
  pointBuffer: React.MutableRefObject<Point[]>;
  isActive: React.MutableRefObject<boolean>;
}

export function useStrokeEngine() {
  const currentStroke = useRef<Stroke | null>(null);
  const pointBuffer = useRef<Point[]>([]);
  const isActive = useRef(false);
  // Predict next point for latency reduction
  const lastVelocity = useRef({ vx: 0, vy: 0 });
  const lastTimestamp = useRef(0);

  const begin = useCallback((
    point: Point,
    color: string,
    size: number,
    tipo: string,
  ) => {
    isActive.current = true;
    pointBuffer.current = [point];
    lastVelocity.current = { vx: 0, vy: 0 };
    lastTimestamp.current = performance.now();
    currentStroke.current = {
      id: genStrokeId(),
      points: [point],
      color,
      size,
      tipo,
    };
    return currentStroke.current;
  }, []);

  const addPoint = useCallback((point: Point): {
    shouldRender: boolean;
    renderPoints: Point[];
  } => {
    if (!isActive.current || !currentStroke.current) {
      return { shouldRender: false, renderPoints: [] };
    }

    const now = performance.now();
    const dt = now - lastTimestamp.current;
    lastTimestamp.current = now;

    const pts = currentStroke.current.points;
    const last = pts[pts.length - 1];

    // Velocity for prediction
    if (dt > 0) {
      lastVelocity.current = {
        vx: (point.x - last.x) / dt,
        vy: (point.y - last.y) / dt,
      };
    }

    // Min distance threshold to reduce jitter
    const dist = Math.hypot(point.x - last.x, point.y - last.y);
    const minDist = 0.5;
    if (dist < minDist) return { shouldRender: false, renderPoints: [] };

    pts.push(point);
    pointBuffer.current.push(point);

    // Return last 4 points for Catmull-Rom rendering
    const len = pts.length;
    if (len >= 4) {
      return {
        shouldRender: true,
        renderPoints: [pts[len - 4], pts[len - 3], pts[len - 2], pts[len - 1]],
      };
    }

    return { shouldRender: true, renderPoints: pts.slice(-4) };
  }, []);

  const end = useCallback((): Stroke | null => {
    if (!currentStroke.current || !isActive.current) return null;
    isActive.current = false;

    // Simplify stroke on completion for storage efficiency
    // Solo simplificar trazos muy largos y con epsilon más alto para no perder calidad
    const stroke = currentStroke.current;
    if (stroke.points.length > 50) {
      const simplified = simplifyPoints(stroke.points, 0.8);
      stroke.points = simplified;
    }

    currentStroke.current = null;
    pointBuffer.current = [];
    return stroke;
  }, []);

  const getPredictedPoint = useCallback((dt = 16): Point | null => {
    if (!isActive.current || !currentStroke.current) return null;
    const pts = currentStroke.current.points;
    if (pts.length === 0) return null;
    const last = pts[pts.length - 1];
    const { vx, vy } = lastVelocity.current;
    return {
      x: last.x + vx * dt,
      y: last.y + vy * dt,
      pressure: last.pressure,
    };
  }, []);

  return {
    begin,
    addPoint,
    end,
    getPredictedPoint,
    currentStroke,
    isActive,
  };
}

export { catmullToBezier, simplifyPoints };
