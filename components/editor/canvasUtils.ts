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

export const isPointNearStroke = (px: number, py: number, stroke: Stroke, threshold: number = 15): boolean => {
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    const dist = pointToSegmentDistance(px, py, a.x, a.y, b.x, b.y);
    if (dist < threshold) return true;
  }
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    const dist = Math.sqrt((px - p.x) ** 2 + (py - p.y) ** 2);
    if (dist < threshold) return true;
  }
  return false;
};

const pointToSegmentDistance = (
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
};

// ✅ Suavizar puntos con algoritmo Chaikin para curvas más fluidas
const chaikinSmooth = (points: Point[], iterations: number = 2): Point[] => {
  if (points.length <= 2) return points;
  let pts = [...points];
  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: Point[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      smoothed.push({
        x: p0.x * 0.75 + p1.x * 0.25,
        y: p0.y * 0.75 + p1.y * 0.25,
        pressure: p0.pressure * 0.75 + p1.pressure * 0.25,
      });
      smoothed.push({
        x: p0.x * 0.25 + p1.x * 0.75,
        y: p0.y * 0.25 + p1.y * 0.75,
        pressure: p0.pressure * 0.25 + p1.pressure * 0.75,
      });
    }
    smoothed.push(pts[pts.length - 1]);
    pts = smoothed;
  }
  return pts;
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
  // ✅ Siempre activar anti-aliasing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const p = 0.4 + pressure * 0.6;

  if (tipo === 'borrador') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = size * 6 * p;
    ctx.globalAlpha = 1;
  } else if (tipo === 'marcador') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = isSelected ? 0.5 : 0.28;
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 5 * p;
    ctx.lineCap = 'square'; // Marcador más cuadrado
  } else if (tipo === 'lapiz') {
    ctx.globalCompositeOperation = 'source-over';
    // ✅ Lápiz con textura suave
    ctx.globalAlpha = isSelected ? 1 : (0.55 + pressure * 0.35);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.9 * p;
  } else {
    // Bolígrafo: línea limpia y suave
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    // ✅ Variación de grosor con presión para feel más real
    ctx.lineWidth = size * 0.6 + pressure * size * 0.6;
  }
};

// ✅ Dibujar trazo completo con máxima calidad usando Catmull-Rom splines
export const drawStrokeOnCtx = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  isSelected: boolean = false,
) => {
  if (stroke.points.length === 0) return;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Punto único - dibujar círculo
  if (stroke.points.length === 1) {
    applyStrokeStyle(ctx, stroke.tipo, stroke.color, stroke.size, stroke.points[0].pressure, isSelected);
    ctx.beginPath();
    ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fillStyle = stroke.tipo === 'borrador' ? 'rgba(0,0,0,1)' : stroke.color;
    ctx.fill();
    ctx.restore();
    return;
  }

  // ✅ Suavizar puntos con Chaikin para trazos cortos/medianos
  const pts = stroke.points.length < 100
    ? chaikinSmooth(stroke.points, 2)
    : stroke.points;

  applyStrokeStyle(ctx, stroke.tipo, stroke.color, stroke.size, 1, isSelected);
  ctx.beginPath();

  if (pts.length === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
  } else {
    // ✅ Catmull-Rom to Bezier para curvas perfectas
    ctx.moveTo(pts[0].x, pts[0].y);

    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      // Convertir Catmull-Rom a Bezier cúbico
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
  }

  // ✅ Highlight de selección
  if (isSelected) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
};

// ✅ Preview de borrado en rojo
export const drawStrokeErasePreview = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
  if (stroke.points.length < 1) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#ff4d6d';
  ctx.lineWidth = stroke.size + 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = true;

  const pts = stroke.points;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, stroke.size / 2 + 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ff4d6d';
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
};

export const drawSelectionRect = (ctx: CanvasRenderingContext2D, rect: SelectionRect) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.fillStyle = 'rgba(99, 102, 241, 0.06)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.setLineDash([]);

  const handleSize = 7;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x + rect.w, y: rect.y + rect.h },
  ];
  corners.forEach(c => {
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
    ctx.fillStyle = 'white';
    ctx.fillRect(c.x - handleSize / 2 + 1.5, c.y - handleSize / 2 + 1.5, handleSize - 3, handleSize - 3);
  });
};

export const getPosFromPointer = (e: PointerEvent, canvas: HTMLCanvasElement): Point => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    pressure: e.pressure > 0 ? e.pressure : 1,
  };
};