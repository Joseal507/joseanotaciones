// ─── Types ──────────────────────────────────────────────────────────────────
export interface Point {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  size: number;
  tipo: string;
  bounds?: { x: number; y: number; w: number; h: number };
  shapeEnd?: { x: number; y: number };
}

export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
let strokeIdCounter = 0;
export function genStrokeId(): string {
  return `s_${Date.now()}_${++strokeIdCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

export function calcBounds(points: Point[]): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function isPointNearStroke(px: number, py: number, stroke: Stroke, radius: number): boolean {
  const pts = stroke.points;
  if (pts.length === 0) return false;

  // Shape strokes
  if (stroke.shapeEnd) {
    const s = pts[0];
    const e = stroke.shapeEnd;
    const tipo = stroke.tipo;
    const pad = radius + stroke.size;

    if (tipo === 'regla') {
      return distToSegment(px, py, s.x, s.y, e.x, e.y) < pad;
    }
    if (tipo === 'forma_rect') {
      const x1 = Math.min(s.x, e.x), y1 = Math.min(s.y, e.y);
      const x2 = Math.max(s.x, e.x), y2 = Math.max(s.y, e.y);
      return (
        distToSegment(px, py, x1, y1, x2, y1) < pad ||
        distToSegment(px, py, x2, y1, x2, y2) < pad ||
        distToSegment(px, py, x2, y2, x1, y2) < pad ||
        distToSegment(px, py, x1, y2, x1, y1) < pad
      );
    }
    if (tipo === 'forma_circulo') {
      const cx = (s.x + e.x) / 2, cy = (s.y + e.y) / 2;
      const rx = Math.abs(e.x - s.x) / 2, ry = Math.abs(e.y - s.y) / 2;
      const r = Math.max(rx, ry);
      const d = Math.hypot(px - cx, py - cy);
      return Math.abs(d - r) < pad;
    }
    if (tipo === 'forma_triangulo') {
      const x1 = Math.min(s.x, e.x), x2 = Math.max(s.x, e.x);
      const y1 = Math.min(s.y, e.y), y2 = Math.max(s.y, e.y);
      const top = { x: (x1 + x2) / 2, y: y1 };
      const bl = { x: x1, y: y2 };
      const br = { x: x2, y: y2 };
      return (
        distToSegment(px, py, top.x, top.y, bl.x, bl.y) < pad ||
        distToSegment(px, py, bl.x, bl.y, br.x, br.y) < pad ||
        distToSegment(px, py, br.x, br.y, top.x, top.y) < pad
      );
    }
  }

  // Regular stroke
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < radius + stroke.size) {
      return true;
    }
  }
  if (pts.length === 1) {
    return Math.hypot(px - pts[0].x, py - pts[0].y) < radius + stroke.size;
  }
  return false;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ─── Stroke Rendering ───────────────────────────────────────────────────────
export function applyStrokeStyle(
  ctx: CanvasRenderingContext2D,
  tipo: string,
  color: string,
  size: number,
  pressure: number,
) {
  const p = Math.max(0.1, Math.min(1, pressure));

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  switch (tipo) {
    case 'marcador':
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = size * 6 * p;
      ctx.globalCompositeOperation = 'multiply';
      break;

    case 'lapiz':
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5 + p * 0.3;
      ctx.lineWidth = size * 3 * p;
      ctx.globalCompositeOperation = 'source-over';
      break;

    case 'borrador_trazo':
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.globalAlpha = 1;
      ctx.lineWidth = size * 5 * p;
      ctx.globalCompositeOperation = 'destination-out';
      break;

    case 'borrador':
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.globalAlpha = 1;
      ctx.lineWidth = size * p;
      ctx.globalCompositeOperation = 'destination-out';
      break;

    default: // boligrafo
      ctx.strokeStyle = color;
      ctx.globalAlpha = 1;
      ctx.lineWidth = size * 0.8 + pressure * size * 0.4;
      ctx.globalCompositeOperation = 'source-over';
  }
}

export function drawStrokeOnCtx(ctx: CanvasRenderingContext2D, stroke: Stroke, isSelected: boolean) {
  const { points, color, size, tipo, shapeEnd } = stroke;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Shape strokes
  if (shapeEnd && points.length > 0) {
    drawShape(ctx, tipo, points[0], shapeEnd, color, size);
    if (isSelected) {
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      drawShapePath(ctx, tipo, points[0], shapeEnd);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    return;
  }

  if (points.length === 0) {
    ctx.restore();
    return;
  }

  // Single point
  if (points.length === 1) {
    const p = points[0];
    applyStrokeStyle(ctx, tipo, color, size, p.pressure);
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Variable-width stroke with proper pressure
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const pressure = (p1.pressure + p2.pressure) / 2;
    applyStrokeStyle(ctx, tipo, color, size, pressure);

    ctx.beginPath();

    if (i === 0) {
      ctx.moveTo(p1.x, p1.y);
    } else {
      ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    }

    // Smooth curve using quadratic bezier
    ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    ctx.stroke();
  }

  // Selection highlight
  if (isSelected) {
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([6, 4]);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawShapePath(ctx: CanvasRenderingContext2D, tipo: string, start: Point, end: { x: number; y: number }) {
  const x1 = Math.min(start.x, end.x), y1 = Math.min(start.y, end.y);
  const x2 = Math.max(start.x, end.x), y2 = Math.max(start.y, end.y);
  const w = x2 - x1, h = y2 - y1;

  ctx.beginPath();

  if (tipo === 'regla') {
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  } else if (tipo === 'forma_rect') {
    ctx.rect(x1, y1, w, h);
  } else if (tipo === 'forma_circulo') {
    const cx = x1 + w / 2, cy = y1 + h / 2;
    const rx = w / 2, ry = h / 2;
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  } else if (tipo === 'forma_triangulo') {
    const top = { x: x1 + w / 2, y: y1 };
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x2, y2);
    ctx.closePath();
  }
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  tipo: string,
  start: Point,
  end: { x: number; y: number },
  color: string,
  size: number,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.8);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  drawShapePath(ctx, tipo, start, end);
  ctx.stroke();
  ctx.restore();
}

export function drawShapePreview(
  ctx: CanvasRenderingContext2D,
  tipo: string,
  start: Point,
  end: { x: number; y: number },
  color: string,
  size: number,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.8);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setLineDash([8, 4]);
  ctx.globalAlpha = 0.7;

  drawShapePath(ctx, tipo, start, end);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();
}

export function drawSelectionRect(ctx: CanvasRenderingContext2D, rect: SelectionRect) {
  ctx.save();
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.globalAlpha = 0.85;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.stroke();

  ctx.fillStyle = '#6366f1';
  ctx.globalAlpha = 0.08;
  ctx.fill();

  ctx.setLineDash([]);
  ctx.restore();
}

export function drawStrokeErasePreview(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  ctx.save();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = stroke.size + 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.4;
  ctx.setLineDash([4, 4]);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const pts = stroke.points;
  if (pts.length > 0) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.restore();
}
