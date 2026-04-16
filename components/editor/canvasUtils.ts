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

// ✅ Detectar si un punto está cerca de un trazo (para borrador por trazo)
export const isPointNearStroke = (px: number, py: number, stroke: Stroke, threshold: number = 15): boolean => {
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    const dist = pointToSegmentDistance(px, py, a.x, a.y, b.x, b.y);
    if (dist < threshold) return true;
  }
  // También checar punto individual (para trazos de un solo punto)
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    const dist = Math.sqrt((px - p.x) ** 2 + (py - p.y) ** 2);
    if (dist < threshold) return true;
  }
  return false;
};

// ✅ Distancia de un punto a un segmento de línea
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

export const applyStrokeStyle = (
  ctx: CanvasRenderingContext2D,
  tipo: string,
  color: string,
  size: number,
  pressure: number = 1,
  isSelected: boolean = false
) => {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
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

export const drawStrokeOnCtx = (ctx: CanvasRenderingContext2D, stroke: Stroke, isSelected: boolean = false) => {
  if (stroke.points.length < 2) return;
  ctx.save();
  applyStrokeStyle(ctx, stroke.tipo, stroke.color, stroke.size, 1, isSelected);
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length - 1; i++) {
    const midX = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
    const midY = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
    ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, midX, midY);
  }
  const last = stroke.points[stroke.points.length - 1];
  const prev = stroke.points[stroke.points.length - 2];
  ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
  ctx.stroke();

  // ✅ Highlight de trazo seleccionado
  if (isSelected) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
};

// ✅ Dibujar trazo con preview de borrado (rojo semi-transparente)
export const drawStrokeErasePreview = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
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
    const midX = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
    const midY = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
    ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, midX, midY);
  }
  const last = stroke.points[stroke.points.length - 1];
  const prev = stroke.points[stroke.points.length - 2];
  ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
  ctx.stroke();
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
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
    pressure: e.pressure > 0 ? e.pressure : 1,
  };
};