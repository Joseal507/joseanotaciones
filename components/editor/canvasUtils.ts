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

// ✅ Dibujar stroke con Catmull-Rom + segmentos de grosor variable
export const drawStrokeOnCtx = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  isSelected: boolean = false,
): void => {
  const { points, color, size, tipo } = stroke;
  if (!points || points.length === 0) return;

  ctx.save();

  if (isSelected) {
    ctx.shadowColor = '#3b82f6';
    ctx.shadowBlur = 6;
  }

  if (points.length === 1) {
    const avgP = points[0].pressure || 1;
    applyStrokeStyle(ctx, tipo, color, size, avgP, isSelected);
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

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

  // ✅ Para bolígrafo y lápiz: segmentos individuales con grosor variable
  if (tipo === 'boligrafo' || tipo === 'lapiz') {
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segPressure = ((p1.pressure || 1) + (p2.pressure || 1)) / 2;

      applyStrokeStyle(ctx, tipo, color, size, segPressure, isSelected);

      ctx.beginPath();

      // Usar punto medio para curvas suaves entre segmentos
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
    // ✅ Marcador/borrador: un solo path con Catmull-Rom
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

// ✅ NO hacer clearRect aquí - el overlay se limpia en EditorCanvas
export const drawSelectionRect = (
  ctx: CanvasRenderingContext2D,
  rect: SelectionRect,
) => {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = 'rgba(99, 102, 241, 0.06)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.setLineDash([]);

  const hs = 7;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x + rect.w, y: rect.y + rect.h },
  ];
  corners.forEach(c => {
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
    ctx.fillStyle = 'white';
    ctx.fillRect(c.x - hs / 2 + 1.5, c.y - hs / 2 + 1.5, hs - 3, hs - 3);
  });
  ctx.restore();
};

// ✅ Coordenadas CSS simples - DPR se maneja en EditorCanvas con setTransform
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