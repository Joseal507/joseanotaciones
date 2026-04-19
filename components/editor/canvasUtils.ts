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

export const genStrokeId = () => Math.random().toString(36).substr(2, 9);

export const calcBounds = (points: Point[]) => {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  points.forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  return { x: minX - 4, y: minY - 4, w: maxX - minX + 8, h: maxY - minY + 8 };
};

const pointToSegmentDistance = (
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

export const isPointNearStroke = (
  px: number, py: number, stroke: Stroke, threshold = 15,
): boolean => {
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    if (pointToSegmentDistance(px, py, a.x, a.y, b.x, b.y) < threshold) return true;
  }
  if (stroke.points.length === 1) {
    if (Math.hypot(px - stroke.points[0].x, py - stroke.points[0].y) < threshold) return true;
  }
  return false;
};

export const getStrokeWidth = (stroke: Stroke): number => {
  const avgP = stroke.points.length > 0
    ? stroke.points.reduce((a, p) => a + (p.pressure || 1), 0) / stroke.points.length
    : 1;
  const p = 0.5 + avgP * 0.5;
  if (stroke.tipo === 'marcador') return stroke.size * 5 * p;
  if (stroke.tipo === 'lapiz') return stroke.size * p;
  if (stroke.tipo === 'borrador') return stroke.size * 6 * p;
  if (stroke.tipo === 'borrador_trazo') return stroke.size * 3 * p;
  return stroke.size * 0.8 + avgP * stroke.size * 0.4;
};

export const applyStrokeStyle = (
  ctx: CanvasRenderingContext2D,
  tipo: string,
  color: string,
  size: number,
  pressure: number = 1,
  isSelected: boolean = false,
) => {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const p = 0.5 + pressure * 0.5;

  if (tipo === 'borrador') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = size * 6 * p;
    ctx.globalAlpha = 1;
  } else if (tipo === 'borrador_trazo') {
    // ✅ Borra pixels reales donde pases — como borrador de lápiz
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = size * 3 * p;
    ctx.globalAlpha = 1;
  } else if (tipo === 'marcador') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = isSelected ? 0.5 : 0.3;
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 5 * p;
  } else if (tipo === 'lapiz') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = isSelected ? 1 : (0.6 + pressure * 0.3);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * p;
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.8 + pressure * size * 0.4;
  }
};

// ═══════════════════════════════════════════════════════
// FORMAS DIBUJADAS A MANO
// ═══════════════════════════════════════════════════════

const seededRng = (seed: number) => {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 0xffffffff;
  };
};

const hashStr = (str: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const drawSmoothPts = (ctx: CanvasRenderingContext2D, pts: Point[]) => {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
};

const handLine = (
  x1: number, y1: number,
  x2: number, y2: number,
  amp: number,
  seed: number,
): Point[] => {
  const rnd = seededRng(seed);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const freq1 = 1.0 + rnd() * 0.7;
  const freq2 = 2.5 + rnd() * 0.8;
  const phase1 = rnd() * Math.PI * 2;
  const phase2 = rnd() * Math.PI * 2;
  const bowAmp = (rnd() - 0.5) * amp * 0.35;
  const steps = Math.max(14, Math.ceil(len / 6));
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const fade = Math.sin(Math.PI * t);
    const wave =
      Math.sin(t * Math.PI * 2 * freq1 + phase1) * amp * 0.55 +
      Math.sin(t * Math.PI * 2 * freq2 + phase2) * amp * 0.25;
    const bow = bowAmp * Math.sin(Math.PI * t);
    const offset = wave * fade + bow;
    pts.push({
      x: x1 + dx * t + nx * offset,
      y: y1 + dy * t + ny * offset,
      pressure: 1,
    });
  }
  return pts;
};

const handEllipse = (
  cx: number, cy: number,
  rx: number, ry: number,
  amp: number,
  seed: number,
): Point[] => {
  const rnd = seededRng(seed);
  const freq1 = 2 + rnd() * 0.5;
  const freq2 = 4 + rnd() * 0.7;
  const phase1 = rnd() * Math.PI * 2;
  const phase2 = rnd() * Math.PI * 2;
  const squishX = 1 + (rnd() - 0.5) * 0.04;
  const squishY = 1 + (rnd() - 0.5) * 0.04;
  const steps = Math.max(60, Math.ceil((rx + ry) / 2.5));
  const totalAngle = Math.PI * 2.06;
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * totalAngle;
    const radial =
      Math.sin(a * freq1 + phase1) * amp * 0.4 +
      Math.sin(a * freq2 + phase2) * amp * 0.15;
    pts.push({
      x: cx + Math.cos(a) * (rx + radial) * squishX,
      y: cy + Math.sin(a) * (ry + radial * 0.85) * squishY,
      pressure: 1,
    });
  }
  return pts;
};

export const drawShape = (
  ctx: CanvasRenderingContext2D,
  tipo: string,
  start: Point,
  end: { x: number; y: number },
  color: string,
  size: number,
  isSelected = false,
  strokeId?: string,
) => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = isSelected ? 0.65 : 1;
  ctx.lineWidth = size;

  if (isSelected) {
    ctx.shadowColor = '#3b82f6';
    ctx.shadowBlur = 5;
  }

  const minDim = Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const amp = Math.max(0.3, Math.min(1.6, size * 0.2 + minDim * 0.008));
  const seed = hashStr(strokeId || `${tipo}${start.x}${start.y}${end.x}${end.y}`);

  if (tipo === 'regla') {
    const pts = handLine(start.x, start.y, end.x, end.y, amp * 0.3, seed);
    drawSmoothPts(ctx, pts);
  }

  if (tipo === 'forma_rect') {
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    drawSmoothPts(ctx, handLine(x1, y1, x2, y1, amp, seed + 1));
    drawSmoothPts(ctx, handLine(x2, y1, x2, y2, amp, seed + 2));
    drawSmoothPts(ctx, handLine(x2, y2, x1, y2, amp, seed + 3));
    drawSmoothPts(ctx, handLine(x1, y2, x1, y1, amp, seed + 4));
  }

  if (tipo === 'forma_circulo') {
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const rx = Math.abs(end.x - start.x) / 2;
    const ry = Math.abs(end.y - start.y) / 2;
    const pts = handEllipse(cx, cy, rx, ry, amp, seed + 10);
    drawSmoothPts(ctx, pts);
  }

  if (tipo === 'forma_triangulo') {
    const tipX = (start.x + end.x) / 2;
    const tipY = Math.min(start.y, end.y);
    const baseY = Math.max(start.y, end.y);
    const leftX = Math.min(start.x, end.x);
    const rightX = Math.max(start.x, end.x);
    drawSmoothPts(ctx, handLine(tipX, tipY, rightX, baseY, amp, seed + 20));
    drawSmoothPts(ctx, handLine(rightX, baseY, leftX, baseY, amp, seed + 21));
    drawSmoothPts(ctx, handLine(leftX, baseY, tipX, tipY, amp, seed + 22));
  }

  ctx.restore();
};

export const drawShapePreview = (
  ctx: CanvasRenderingContext2D,
  tipo: string,
  start: Point,
  end: { x: number; y: number },
  color: string,
  size: number,
) => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.8);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.38;
  ctx.setLineDash([7, 5]);

  const x1 = Math.min(start.x, end.x);
  const y1 = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  ctx.beginPath();

  if (tipo === 'regla') {
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = color;
    ctx.font = 'bold 11px system-ui, sans-serif';
    const dist = Math.round(Math.hypot(end.x - start.x, end.y - start.y));
    const angle = Math.round(Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI);
    ctx.fillText(`${dist}px  ${angle}°`, (start.x + end.x) / 2 + 8, (start.y + end.y) / 2 - 8);
  } else if (tipo === 'forma_rect') {
    ctx.strokeRect(x1, y1, w, h);
  } else if (tipo === 'forma_circulo') {
    ctx.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tipo === 'forma_triangulo') {
    const tipX = (start.x + end.x) / 2;
    const tipY = Math.min(start.y, end.y);
    const baseY = Math.max(start.y, end.y);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(Math.max(start.x, end.x), baseY);
    ctx.lineTo(Math.min(start.x, end.x), baseY);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
};

// ═══════════════════════════════════════════════
// Dibujar trazos
// ═══════════════════════════════════════════════

export const drawStrokeOnCtx = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  isSelected: boolean = false,
): void => {
  const { points, color, size, tipo } = stroke;
  if (!points || points.length === 0) return;

  // Formas y regla
  if (['regla', 'forma_rect', 'forma_circulo', 'forma_triangulo'].includes(tipo)) {
    if (stroke.shapeEnd) {
      drawShape(ctx, tipo, points[0], stroke.shapeEnd, color, size, isSelected, stroke.id);
    }
    return;
  }

  ctx.save();

  if (isSelected) {
    ctx.shadowColor = '#3b82f6';
    ctx.shadowBlur = 6;
  }

  // Punto único
  if (points.length === 1) {
    const avgP = points[0].pressure || 1;
    applyStrokeStyle(ctx, tipo, color, size, avgP, isSelected);
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Dos puntos
  if (points.length === 2) {
    const avgP = (points[0].pressure + points[1].pressure) / 2 || 1;
    applyStrokeStyle(ctx, tipo, color, size, avgP, isSelected);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // ✅ Bolígrafo, lápiz y borrador_trazo: segmentos con grosor variable
  if (tipo === 'boligrafo' || tipo === 'lapiz' || tipo === 'borrador_trazo') {
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segPressure = ((p1.pressure || 1) + (p2.pressure || 1)) / 2;
      applyStrokeStyle(ctx, tipo, color, size, segPressure, isSelected);
      ctx.beginPath();
      if (i === 0) {
        ctx.moveTo(p1.x, p1.y);
      } else {
        const prev = points[i - 1];
        ctx.moveTo((prev.x + p1.x) / 2, (prev.y + p1.y) / 2);
      }
      if (i < points.length - 2) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
      } else {
        ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      }
      ctx.stroke();
    }
  } else {
    // Marcador / borrador clásico: Catmull-Rom suave
    const avgP = points.reduce((a, p) => a + (p.pressure || 1), 0) / points.length;
    applyStrokeStyle(ctx, tipo, color, size, avgP, isSelected);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const t = 0.4;
      const cp1x = p1.x + ((p2.x - p0.x) * t) / 3;
      const cp1y = p1.y + ((p2.y - p0.y) * t) / 3;
      const cp2x = p2.x - ((p3.x - p1.x) * t) / 3;
      const cp2y = p2.y - ((p3.y - p1.y) * t) / 3;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
  }

  ctx.restore();
};

export const drawStrokeErasePreview = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
) => {
  if (stroke.points.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = '#ff4d6d';
  ctx.lineWidth = stroke.size + 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length - 1; i++) {
    const mx = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
    const my = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
    ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mx, my);
  }
  const last = stroke.points[stroke.points.length - 1];
  const prev = stroke.points[stroke.points.length - 2];
  ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
  ctx.stroke();
  ctx.restore();
};

export const drawSelectionRect = (
  ctx: CanvasRenderingContext2D,
  rect: SelectionRect,
) => {
  ctx.save();
  ctx.fillStyle = 'rgba(99, 102, 241, 0.06)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.setLineDash([]);
  const hs = 7;
  [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
   { x: rect.x, y: rect.y + rect.h }, { x: rect.x + rect.w, y: rect.y + rect.h }]
    .forEach(c => {
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
      ctx.fillStyle = 'white';
      ctx.fillRect(c.x - hs / 2 + 1.5, c.y - hs / 2 + 1.5, hs - 3, hs - 3);
    });
  ctx.restore();
};

export const getPosFromPointer = (
  e: PointerEvent,
  canvas: HTMLCanvasElement,
): Point => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    pressure: e.pressure > 0 ? e.pressure : 1,
  };
};