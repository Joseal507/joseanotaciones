'use client';

import { useRef, useCallback, useEffect } from 'react';
import { Herramienta } from './types';

interface Point { x: number; y: number; }
interface Stroke { points: Point[]; color: string; size: number; tipo: Herramienta; }

interface Props {
  herramienta: Herramienta;
  brushColor: string;
  brushSize: number;
  temaColor: string;
  onChange: () => void;
  initialCanvasData?: string | null;
}

export default function EditorCanvas({
  herramienta, brushColor, brushSize, temaColor, onChange, initialCanvasData
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[][]>([]);
  const currentStroke = useRef<Stroke | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<Point | null>(null);
  const initialized = useRef(false);

  const isDrawingTool = ['boligrafo', 'marcador', 'lapiz', 'borrador'].includes(herramienta);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    canvas.width = w;
    canvas.height = h;

    // Cargar imagen guardada
    if (initialCanvasData && !initialized.current) {
      initialized.current = true;
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          strokesRef.current = [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#000', size: 1, tipo: 'boligrafo' as Herramienta }];
        }
      };
      img.src = initialCanvasData;
    }

    const observer = new ResizeObserver(() => {
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      if (newW === canvas.width && newH === canvas.height) return;

      const ctx = canvas.getContext('2d');
      let imageData: ImageData | null = null;
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        try { imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch {}
      }

      canvas.width = newW;
      canvas.height = newH;

      if (ctx && imageData) {
        ctx.putImageData(imageData, 0, 0);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [initialCanvasData]);

  const applyStyle = (ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (herramienta === 'borrador') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = brushSize * 6;
      ctx.globalAlpha = 1;
    } else if (herramienta === 'marcador') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize * 4;
    } else if (herramienta === 'lapiz') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
    }
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: ((e as React.MouseEvent).clientX - rect.left) * scaleX,
      y: ((e as React.MouseEvent).clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    drawing.current = true;
    lastPoint.current = pos;
    redoRef.current = [];
    currentStroke.current = { points: [pos], color: brushColor, size: brushSize, tipo: herramienta };
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!drawing.current || !currentStroke.current) return;
    const pos = getPos(e);
    const last = lastPoint.current;
    if (!last) return;
    const dist = Math.sqrt((pos.x - last.x) ** 2 + (pos.y - last.y) ** 2);
    if (dist < 1) return;

    currentStroke.current.points.push(pos);
    lastPoint.current = pos;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const pts = currentStroke.current.points;
    ctx.save();
    applyStyle(ctx);

    if (pts.length >= 3) {
      const p1 = pts[pts.length - 3];
      const p2 = pts[pts.length - 2];
      const p3 = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      ctx.quadraticCurveTo(p2.x, p2.y, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    ctx.restore();
  };

  const stopDraw = () => {
    if (!drawing.current || !currentStroke.current) return;
    drawing.current = false;
    if (currentStroke.current.points.length > 1) {
      strokesRef.current.push({ ...currentStroke.current });
      onChange();
    }
    currentStroke.current = null;
    lastPoint.current = null;
  };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (stroke.tipo === 'borrador') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = stroke.size * 6;
        ctx.globalAlpha = 1;
      } else if (stroke.tipo === 'marcador') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size * 4;
      } else if (stroke.tipo === 'lapiz') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
      }
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
    });
  }, []);

  const undo = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    redoRef.current.push([strokesRef.current.pop()!]);
    redraw(); onChange();
  }, [redraw, onChange]);

  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    strokesRef.current.push(...redoRef.current.pop()!);
    redraw(); onChange();
  }, [redraw, onChange]);

  useEffect(() => {
    (window as any).__editorUndo = undo;
    (window as any).__editorRedo = redo;
    (window as any).__canvasHasStrokes = () => strokesRef.current.length > 0;
    (window as any).__canvasExport = () => {
      const canvas = canvasRef.current;
      if (!canvas || strokesRef.current.length === 0) return null;
      return canvas.toDataURL('image/png');
    };
  }, [undo, redo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isDrawingTool) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); e.stopPropagation(); redo(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isDrawingTool, undo, redo]);

  return (
    <div ref={containerRef} style={{
      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
      pointerEvents: isDrawingTool ? 'all' : 'none',
      zIndex: isDrawingTool ? 20 : 5,
      cursor: isDrawingTool ? (herramienta === 'borrador' ? 'cell' : 'crosshair') : 'default',
    }}>
      {isDrawingTool && (
        <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: '6px', zIndex: 30 }}>
          <button onClick={undo}
            style={{ padding: '6px 12px', borderRadius: '8px', border: `1px solid ${temaColor}`, background: 'rgba(255,255,255,0.95)', color: '#333', fontSize: '13px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
            ↩️
          </button>
          <button onClick={redo}
            style={{ padding: '6px 12px', borderRadius: '8px', border: `1px solid ${temaColor}`, background: 'rgba(255,255,255,0.95)', color: '#333', fontSize: '13px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
            ↪️
          </button>
          <span style={{ padding: '6px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.95)', color: '#666', fontSize: '11px', display: 'flex', alignItems: 'center' }}>
            {strokesRef.current.length} trazos
          </span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        onMouseDown={isDrawingTool ? startDraw : undefined}
        onMouseMove={isDrawingTool ? draw : undefined}
        onMouseUp={isDrawingTool ? stopDraw : undefined}
        onMouseLeave={isDrawingTool ? stopDraw : undefined}
        onTouchStart={isDrawingTool ? startDraw : undefined}
        onTouchMove={isDrawingTool ? draw : undefined}
        onTouchEnd={isDrawingTool ? stopDraw : undefined}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          touchAction: 'none', background: 'transparent',
        }}
      />
    </div>
  );
}