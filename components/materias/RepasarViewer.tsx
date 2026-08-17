'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

if (typeof window !== 'undefined' && pdfjs?.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

const BODY = "var(--font-body)";

type Phase = 'preview' | 'lectura' | 'explicar' | 'analisis';
type Tool = 'draw' | 'erase' | 'note' | 'highlight' | 'underline';
type BrushType = 'pen' | 'pencil' | 'highlighter' | 'underline';
type BrushSizeKey = 'xs' | 's' | 'm' | 'l' | 'xl' | 'custom';

type StrokePoint = { x: number; y: number };
type Stroke = {
  id: string;
  color: string;
  points: StrokePoint[];
  brushType?: BrushType;
  size?: number;
};

type TextMarkRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TextMark = {
  id: string;
  kind: 'highlight' | 'underline';
  color: string;
  rects: TextMarkRect[];
};

type StickyNote = {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  width?: number;
  height?: number;
  rotation?: number;
};

interface Props {
  materiales: any[];
  seleccion?: any[] | null;
  phase?: Phase;
  themeColor?: string;
  activeColor?: string;
}

const COLORS = [
  { id: 'yellow', icon: '🟡', label: 'Idea', value: 'rgba(250, 204, 21, 0.48)' },
  { id: 'blue', icon: '🔵', label: 'Ejemplo', value: 'rgba(96, 165, 250, 0.38)' },
  { id: 'green', icon: '🟢', label: 'Definición', value: 'rgba(74, 222, 128, 0.42)' },
  { id: 'red', icon: '🔴', label: 'Duda', value: 'rgba(248, 113, 113, 0.38)' },
  { id: 'purple', icon: '🟣', label: 'Conexión', value: 'rgba(192, 132, 252, 0.38)' },
  { id: 'black', icon: '⚫️', label: 'Libre', value: 'rgba(17, 24, 39, 0.82)' },
];

const BRUSH_TYPES: { id: BrushType; icon: string; label: string }[] = [
  { id: 'pen', icon: '✒️', label: 'Pen' },
  { id: 'pencil', icon: '✏️', label: 'Pencil' },
  { id: 'highlighter', icon: '🖍', label: 'Marker' },
  { id: 'underline', icon: '＿', label: 'Sub' },
];

const BRUSH_SIZES: { id: BrushSizeKey; label: string; value: number }[] = [
  { id: 'xs', label: 'XS', value: 2.2 },
  { id: 's', label: 'S', value: 3.4 },
  { id: 'm', label: 'M', value: 5 },
  { id: 'l', label: 'L', value: 7 },
  { id: 'xl', label: 'XL', value: 10 },
  { id: 'custom', label: 'Custom', value: 5 },
];

function solidColor(color: string): string {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return color;

  const parts = match[1].split(',').map((part) => part.trim());
  const [r, g, b] = parts;

  if (!r || !g || !b) return color;
  return `rgb(${r}, ${g}, ${b})`;
}

function normalizePages(value: any): number[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(Number).filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  }
  if (value && typeof value === 'object') {
    const start = Number(value.start ?? value.from ?? value.startPage ?? value.paginaInicial);
    const end = Number(value.end ?? value.to ?? value.endPage ?? value.paginaFinal);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }
  return [];
}

function selectedPagesFor(mat: any, index: number, seleccion?: any[] | null): number[] {
  if (!Array.isArray(seleccion) || !seleccion.length) return [];

  const matMaterialId = String(mat?.materialId || mat?.material_id || mat?.id || '');
  const matDocumentId = String(mat?.id || '');

  const item =
    seleccion.find((s: any) => Number(s?.materialIndex) === index) ||
    seleccion.find((s: any) => {
      const ids = [s?.materialId, s?.material_id, s?.documentId, s?.document_id, s?.docId, s?.doc_id, s?.id]
        .filter(Boolean)
        .map((v: any) => String(v));
      return ids.includes(matMaterialId) || ids.includes(matDocumentId);
    }) ||
    seleccion[index] ||
    null;

  if (!item) return [];

  return [item?.pages, item?.selectedPages, item?.paginasSeleccionadas, item?.paginas, item?.pageNumbers, item?.range, item?.selection]
    .map(normalizePages)
    .find((arr) => arr.length > 0) || [];
}

function buildSmoothPath(points: StrokePoint[]): string {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }

  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;

  return path;
}

export default function RepasarViewer({ materiales, seleccion, phase = 'preview', themeColor = 'var(--gold)', activeColor }: Props) {
  const isActiveReading = phase === 'lectura';
  const [activeIndex, setActiveIndex] = useState(0);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [urlRefreshTick, setUrlRefreshTick] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [scale, setScale] = useState(1.08);
  const [highlightColor, setHighlightColor] = useState(activeColor || COLORS[0].value);
  const [brushType, setBrushType] = useState<BrushType>('pen');
  const [brushSizeKey, setBrushSizeKey] = useState<BrushSizeKey>('m');
  const [customBrushSize, setCustomBrushSize] = useState(6);
  const [showSizePanel, setShowSizePanel] = useState(false);
  const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
  const [eraserCursor, setEraserCursor] = useState<{ x: number; y: number } | null>(null);
  const [notesCount, setNotesCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [firstPageRendered, setFirstPageRendered] = useState(false);
  const [err, setErr] = useState('');
  const [tool, setTool] = useState<Tool>('highlight');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [textMarks, setTextMarks] = useState<TextMark[]>([]);
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [hoveredMarkId, setHoveredMarkId] = useState<string | null>(null);
  const [hoveredStrokeId, setHoveredStrokeId] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number } | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawInputRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const draggingNoteRef = useRef<string | null>(null);
  const erasingRef = useRef(false);
  const lastUrlRefreshRef = useRef(0);

  useEffect(() => {
    if (activeColor) setHighlightColor(activeColor);
  }, [activeColor]);

  const requestPdfUrlRefresh = () => {
    const now = Date.now();
    if (now - lastUrlRefreshRef.current < 5000) return;
    lastUrlRefreshRef.current = now;
    setUrlRefreshTick((value) => value + 1);
  };

  const activeBrushSize = brushSizeKey === 'custom'
    ? customBrushSize
    : BRUSH_SIZES.find((item) => item.id === brushSizeKey)?.value || 5;

  const mat = materiales[activeIndex] || materiales[0] || null;
  const selectedPages = useMemo(() => mat ? selectedPagesFor(mat, activeIndex, seleccion) : [], [mat, activeIndex, seleccion]);
  const pages = useMemo(() => selectedPages.length ? selectedPages : Array.from({ length: numPages }, (_, i) => i + 1), [selectedPages, numPages]);
  const currentPage = pages[currentPageIndex] || pages[0] || 1;
  const materialKey = String(mat?.materialId || mat?.material_id || mat?.id || 'material');
  const marksKey = `studyal_repasar_marks_${materialKey}_${currentPage}`;

  useEffect(() => setCurrentPageIndex(0), [activeIndex, selectedPages.join(',')]);

  useEffect(() => {
    if (!isActiveReading) return;
    try {
      const raw = localStorage.getItem(marksKey);
      const saved = raw ? JSON.parse(raw) : null;
      setStrokes(Array.isArray(saved?.strokes) ? saved.strokes : []);
      setTextMarks(Array.isArray(saved?.textMarks) ? saved.textMarks : []);
      setStickyNotes(Array.isArray(saved?.stickyNotes) ? saved.stickyNotes : []);
    } catch {
      setStrokes([]);
      setTextMarks([]);
      setStickyNotes([]);
    }
  }, [marksKey, isActiveReading]);

  useEffect(() => {
    if (!isActiveReading) return;
    try {
      localStorage.setItem(marksKey, JSON.stringify({
        strokes,
        textMarks,
        stickyNotes,
        updatedAt: Date.now(),
      }));
    } catch {}
  }, [marksKey, strokes, textMarks, stickyNotes, isActiveReading]);

  useEffect(() => {
    if (!pdfUrl || !mat) return;
    const timer = window.setTimeout(() => {
      requestPdfUrlRefresh();
    }, 45 * 60 * 1000);

    return () => window.clearTimeout(timer);
  }, [pdfUrl, materialKey]);

  useEffect(() => {
    let cancelled = false;

    const cleanup = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    const load = async () => {
      cleanup();
      setPdfUrl(null);
      setNumPages(0);
      setErr('');
      setFirstPageRendered(false);

      if (!mat) return;
      setLoading(true);

      try {
        if (mat.url && typeof mat.url === 'string' && mat.url.startsWith('http')) {
          if (!cancelled) setPdfUrl(mat.url);
          return;
        }

        if (mat.archivo instanceof File) {
          const objectUrl = URL.createObjectURL(mat.archivo);
          objectUrlRef.current = objectUrl;
          if (!cancelled) setPdfUrl(objectUrl);
          return;
        }

        const matId = mat.materialId || mat.id;
        if (!matId) throw new Error('Material sin id.');

        const res = await fetch(`/api/materials/${matId}/download-url`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const data = await res.json();
        if (!res.ok || !data?.url) throw new Error(data?.error || 'No se pudo obtener URL del documento.');
        if (!cancelled) setPdfUrl(data.url);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'No se pudo cargar el documento.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [mat, urlRefreshTick]);

  const applyHighlight = (kind: 'highlight' | 'underline' = tool === 'underline' ? 'underline' : 'highlight') => {
    if (!isActiveReading || (kind !== 'highlight' && kind !== 'underline')) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    const wrap = pageWrapRef.current;
    const anchor = sel.anchorNode;
    if (!wrap || !anchor || !wrap.contains(anchor)) return;

    const pageRect = wrap.getBoundingClientRect();
    const range = sel.getRangeAt(0);

    const rects = Array.from(range.getClientRects())
      .map((rect) => ({
        x: (rect.left - pageRect.left) / pageRect.width,
        y: (rect.top - pageRect.top) / pageRect.height,
        width: rect.width / pageRect.width,
        height: rect.height / pageRect.height,
      }))
      .filter((rect) => rect.width > 0 && rect.height > 0);

    if (!rects.length) return;

    setTextMarks((items) => [
      ...items,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        kind,
        color: solidColor(highlightColor),
        rects,
      },
    ]);

    sel.removeAllRanges();
    setSelectionMenu(null);
    setNotesCount((n) => n + 1);
  };

  const showSelectionMenu = () => {
    if (!isActiveReading || tool === 'draw' || tool === 'erase' || tool === 'note') {
      setSelectionMenu(null);
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelectionMenu(null);
      return;
    }

    const wrap = pageWrapRef.current;
    const anchor = sel.anchorNode;
    if (!wrap || !anchor || !wrap.contains(anchor)) {
      setSelectionMenu(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const pageRect = wrap.getBoundingClientRect();

    setSelectionMenu({
      x: (rect.left + rect.width / 2 - pageRect.left) / pageRect.width,
      y: (rect.top - pageRect.top) / pageRect.height,
    });
  };

  const clearHighlights = () => {
    viewerRef.current?.querySelectorAll('[data-repasar-highlight="1"]').forEach((node) => {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      parent.normalize();
    });
    setStrokes([]);
    setTextMarks([]);
    setStickyNotes([]);
    setCurrentStroke(null);
    drawingRef.current = false;
    setNotesCount(0);
  };

  const setupCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    const layer = drawInputRef.current;
    if (!canvas || !layer) return null;

    const width = Math.max(1, layer.clientWidth);
    const height = Math.max(1, layer.clientHeight);
    const dpr = window.devicePixelRatio || 1;

    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    return { ctx, width, height };
  }, []);

  const drawCanvasStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) => {
    if (!stroke.points.length) return;

    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size || Math.max(2.4, Math.min(7, Math.min(width, height) * 0.005));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = stroke.brushType === 'highlighter' ? 0.42 : stroke.brushType === 'pencil' ? 0.72 : 0.96;

    ctx.beginPath();

    const first = stroke.points[0];
    ctx.moveTo(first.x * width, first.y * height);

    if (stroke.points.length === 1) {
      ctx.lineTo(first.x * width + 0.1, first.y * height + 0.1);
    } else {
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const current = stroke.points[i];
        const next = stroke.points[i + 1];
        ctx.quadraticCurveTo(
          current.x * width,
          current.y * height,
          ((current.x + next.x) / 2) * width,
          ((current.y + next.y) / 2) * height
        );
      }

      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x * width, last.y * height);
    }

    ctx.stroke();
    ctx.restore();
  }, []);

  const redrawDrawCanvas = useCallback(() => {
    const setup = setupCanvas(drawCanvasRef.current);
    if (!setup) return;

    const { ctx, width, height } = setup;
    ctx.clearRect(0, 0, width, height);

    strokes.forEach((stroke) => drawCanvasStroke(ctx, stroke, width, height));
  }, [setupCanvas, strokes, drawCanvasStroke]);

  const clearLiveCanvas = useCallback(() => {
    const setup = setupCanvas(liveCanvasRef.current);
    if (!setup) return;
    setup.ctx.clearRect(0, 0, setup.width, setup.height);
  }, [setupCanvas]);

  const redrawLiveStroke = useCallback((stroke: Stroke | null) => {
    const setup = setupCanvas(liveCanvasRef.current);
    if (!setup) return;

    const { ctx, width, height } = setup;
    ctx.clearRect(0, 0, width, height);

    if (stroke) {
      drawCanvasStroke(ctx, stroke, width, height);
    }
  }, [setupCanvas, drawCanvasStroke]);

  const getCanvasPoint = (e: React.PointerEvent<HTMLDivElement>): StrokePoint | null => {
    const layer = drawInputRef.current;
    if (!layer) return null;

    const rect = layer.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (x < 0 || y < 0 || x > 1 || y > 1) return null;

    return { x, y };
  };

  const distancePointToSegmentPx = (
    point: StrokePoint,
    a: StrokePoint,
    b: StrokePoint,
    width: number,
    height: number
  ) => {
    const px = point.x * width;
    const py = point.y * height;
    const ax = a.x * width;
    const ay = a.y * height;
    const bx = b.x * width;
    const by = b.y * height;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) return Math.hypot(px - ax, py - ay);

    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + t * dx;
    const cy = ay + t * dy;

    return Math.hypot(px - cx, py - cy);
  };

  const strokeTouchesPoint = (stroke: Stroke, point: StrokePoint, width: number, height: number) => {
    if (stroke.points.length < 2) return false;

    const radius = Math.max(14, Math.min(width, height) * 0.018);

    for (let i = 1; i < stroke.points.length; i++) {
      if (distancePointToSegmentPx(point, stroke.points[i - 1], stroke.points[i], width, height) <= radius) {
        return true;
      }
    }

    return false;
  };

  const eraseAtPoint = (point: StrokePoint) => {
    if (!erasingRef.current) return;

    const layer = drawInputRef.current;
    if (!layer) return;

    const width = layer.clientWidth || 1;
    const height = layer.clientHeight || 1;

    setStrokes((items) => items.filter((stroke) => !strokeTouchesPoint(stroke, point, width, height)));

    setTextMarks((items) => items.filter((mark) => {
      return !mark.rects.some((rect) => (
        point.x >= rect.x - 0.006 &&
        point.x <= rect.x + rect.width + 0.006 &&
        point.y >= rect.y - 0.008 &&
        point.y <= rect.y + rect.height + 0.008
      ));
    }));

    setStickyNotes((items) => items.filter((note) => {
      const px = point.x * width;
      const py = point.y * height;
      const left = note.x * width - 14;
      const top = note.y * height - 14;
      return !(px >= left && px <= left + 190 && py >= top && py <= top + 130);
    }));
  };

  const startDraw = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActiveReading || (tool !== 'draw' && tool !== 'erase')) return;

    const point = getCanvasPoint(e);
    if (!point) return;

    e.preventDefault();
    e.stopPropagation();

    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerRef.current = e.pointerId;

    if (tool === 'erase') {
      erasingRef.current = true;
      setEraserCursor(point);
      eraseAtPoint(point);
      return;
    }

    drawingRef.current = true;

    const stroke: Stroke = {
      id: `${Date.now()}_${e.pointerId}_${Math.random().toString(36).slice(2)}`,
      color: highlightColor,
      points: [point],
      brushType,
      size: activeBrushSize,
    };

    currentStrokeRef.current = stroke;
    setCurrentStroke(stroke);
    clearLiveCanvas();
    redrawLiveStroke(stroke);
  };

  const moveDraw = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActiveReading || (tool !== 'draw' && tool !== 'erase')) return;
    if (activePointerRef.current !== null && activePointerRef.current !== e.pointerId) return;

    const point = getCanvasPoint(e);
    if (!point) return;

    e.preventDefault();
    e.stopPropagation();

    if (tool === 'erase') {
      setEraserCursor(point);
      if (erasingRef.current) eraseAtPoint(point);
      return;
    }

    if (!drawingRef.current || !currentStrokeRef.current) return;

    const prev = currentStrokeRef.current;
    const last = prev.points[prev.points.length - 1];
    const distance = Math.hypot(point.x - last.x, point.y - last.y);

    if (distance < 0.0016) return;

    const next = { ...prev, points: [...prev.points, point] };
    currentStrokeRef.current = next;
    setCurrentStroke(next);
    redrawLiveStroke(next);
  };

  const endDraw = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (e && activePointerRef.current !== null && activePointerRef.current !== e.pointerId) return;

    if (e) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }

    activePointerRef.current = null;

    if (tool === 'erase') {
      erasingRef.current = false;
      setEraserCursor(null);
      return;
    }

    if (!drawingRef.current) return;

    drawingRef.current = false;

    const finished = currentStrokeRef.current;
    currentStrokeRef.current = null;
    setCurrentStroke(null);
    clearLiveCanvas();

    if (!finished || finished.points.length < 2) return;

    setStrokes((items) => [...items, finished]);
    setRedoStrokes([]);
    setNotesCount((n) => n + 1);
  };

  const undoLastStroke = () => {
    setStrokes((items) => {
      if (!items.length) return items;
      const last = items[items.length - 1];
      setRedoStrokes((redo) => [last, ...redo]);
      return items.slice(0, -1);
    });
    setNotesCount((n) => Math.max(0, n - 1));
  };

  const redoLastStroke = () => {
    setRedoStrokes((items) => {
      if (!items.length) return items;
      const [first, ...rest] = items;
      setStrokes((strokesNow) => [...strokesNow, first]);
      setNotesCount((n) => n + 1);
      return rest;
    });
  };

  const deleteTextMark = (id: string) => {
    if (tool !== 'erase') return;
    setTextMarks((items) => items.filter((item) => item.id !== id));
    setHoveredMarkId(null);
    setNotesCount((n) => Math.max(0, n - 1));
  };

  const deleteStroke = (id: string) => {
    if (tool !== 'erase') return;
    setStrokes((items) => items.filter((item) => item.id !== id));
    setHoveredStrokeId(null);
    setNotesCount((n) => Math.max(0, n - 1));
  };

  const createStickyNoteAt = (x: number, y: number) => {
    if (!isActiveReading) return;
    if (x < 0 || y < 0 || x > 1 || y > 1) return;

    setStickyNotes((items) => [
      ...items,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        x: Math.max(0.04, Math.min(0.96, x)),
        y: Math.max(0.04, Math.min(0.96, y)),
        color: highlightColor,
        text: '',
        width: 230,
        height: 130,
        rotation: -1.5,
      },
    ]);

    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    setNotesCount((n) => n + 1);
  };

  const createStickyNote = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActiveReading || tool !== 'note') return;

    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-repasar-sticky-note="1"]')) return;

    const wrap = pageWrapRef.current;
    if (!wrap) return;

    const rect = wrap.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const safePadding = 28;

    const nearExistingNote = stickyNotes.some((note) => {
      const noteWidth = note.width || 230;
      const noteHeight = note.height || 130;
      const noteLeft = note.x * rect.width - 18 - safePadding;
      const noteTop = note.y * rect.height - 18 - safePadding;

      return (
        clickX >= noteLeft &&
        clickX <= noteLeft + noteWidth + safePadding * 2 &&
        clickY >= noteTop &&
        clickY <= noteTop + noteHeight + safePadding * 2
      );
    });

    if (nearExistingNote) return;

    createStickyNoteAt(
      clickX / rect.width,
      clickY / rect.height
    );
  };

  const updateStickyNote = (id: string, text: string) => {
    setStickyNotes((items) => items.map((item) => item.id === id ? { ...item, text } : item));
  };

  const updateStickyNoteMeta = (id: string, patch: Partial<StickyNote>) => {
    setStickyNotes((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const deleteStickyNote = (id: string) => {
    setStickyNotes((items) => items.filter((item) => item.id !== id));
    setSelectedNoteId((current) => current === id ? null : current);
    setNotesCount((n) => Math.max(0, n - 1));
  };

  const moveStickyNote = (id: string, x: number, y: number) => {
    setStickyNotes((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              x: Math.max(0.04, Math.min(0.96, x)),
              y: Math.max(0.04, Math.min(0.96, y)),
            }
          : item
      )
    );
  };

  useEffect(() => {
    if (!isActiveReading || !firstPageRendered) return;

    redrawDrawCanvas();
    clearLiveCanvas();

    const layer = drawInputRef.current;
    if (!layer) return;

    const ro = new ResizeObserver(() => {
      redrawDrawCanvas();
      clearLiveCanvas();
    });

    ro.observe(layer);
    return () => ro.disconnect();
  }, [isActiveReading, firstPageRendered, currentPage, activeIndex, scale, redrawDrawCanvas, clearLiveCanvas]);

  return (
    <div style={{
      height: '100%',
      minHeight: 690,
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(13,14,22,0.78)',
      border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0 20px 70px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        height: 58,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'grid',
        gridTemplateColumns: '230px 1fr auto',
        gap: 14,
        alignItems: 'center',
        background: 'rgba(8,9,14,0.86)',
      }}>
        <select
          value={activeIndex}
          onChange={(e) => setActiveIndex(Number(e.target.value))}
          style={{
            background: 'rgba(255,255,255,0.055)',
            color: 'var(--text-primary)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '8px 10px',
            fontWeight: 800,
            outline: 'none',
          }}
        >
          {materiales.map((m, i) => (
            <option key={m?.id || m?.materialId || i} value={i}>
              {m?.nombre || m?.name || m?.titulo || `Material ${i + 1}`}
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 9 }}>
          <button onClick={() => setCurrentPageIndex((v) => Math.max(0, v - 1))} style={toolBtn}>‹</button>
          <div style={{ minWidth: 76, textAlign: 'center', fontWeight: 900 }}>
            {pages.length ? `${currentPageIndex + 1} / ${pages.length}` : '—'}
          </div>
          <button onClick={() => setCurrentPageIndex((v) => Math.min(pages.length - 1, v + 1))} style={toolBtn}>›</button>

          <select value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ ...toolBtn, width: 88 }}>
            <option value={0.95}>95%</option>
            <option value={1.08}>108%</option>
            <option value={1.18}>118%</option>
            <option value={1.3}>130%</option>
          </select>
        </div>

        <button onClick={() => viewerRef.current?.requestFullscreen?.()} style={toolBtn}>↗</button>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: isActiveReading ? '86px 1fr' : '1fr' }}>
        {isActiveReading && (
        <div style={{
          position: 'relative',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.035)',
          padding: '14px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 9,
        }}>
          {[
            ['draw', '✒️', 'Draw'],
            ['note', '🗒', 'Note'],
            ['erase', '◯', 'Erase'],
          ].map(([id, icon, label]) => {
            const active = tool === id;
            return (
              <button
                key={id}
                onClick={() => setTool(id as Tool)}
                style={{
                  ...sideBtn,
                  borderColor: active ? themeColor : 'rgba(255,255,255,0.11)',
                  background: active ? 'rgba(250,204,21,0.18)' : sideBtn.background,
                  color: active ? themeColor : 'var(--text-primary)',
                }}
                title={label}
              >
                <span style={{ fontSize: 17, lineHeight: 1 }}>{icon}</span>
                <span style={{ fontSize: 10, lineHeight: 1, marginTop: 3 }}>{label}</span>
              </button>
            );
          })}

          <button onClick={undoLastStroke} style={sideBtn} title="Undo">
            <span style={{ fontSize: 17, lineHeight: 1 }}>↶</span>
            <span style={{ fontSize: 10, lineHeight: 1, marginTop: 3 }}>Undo</span>
          </button>

          <button onClick={redoLastStroke} style={sideBtn} title="Redo">
            <span style={{ fontSize: 17, lineHeight: 1 }}>↷</span>
            <span style={{ fontSize: 10, lineHeight: 1, marginTop: 3 }}>Redo</span>
          </button>

          {tool === 'draw' && (
            <div style={{
              position: 'absolute',
              left: 76,
              top: 14,
              zIndex: 40,
              display: 'grid',
              gap: 10,
              minWidth: 255,
              padding: 12,
              borderRadius: 16,
              background: 'rgba(8,9,14,0.94)',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 18px 55px rgba(0,0,0,0.45)',
              backdropFilter: 'blur(12px)',
            }}>
              <div style={{ display: 'flex', gap: 7 }}>
                {BRUSH_TYPES.map((item) => {
                  const active = brushType === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setBrushType(item.id)}
                      style={{
                        ...miniBtn,
                        borderColor: active ? themeColor : 'rgba(255,255,255,0.12)',
                        background: active ? 'rgba(250,204,21,0.18)' : miniBtn.background,
                        color: active ? themeColor : 'var(--text-primary)',
                      }}
                      title={item.label}
                    >
                      <span>{item.icon}</span>
                      <small>{item.label}</small>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                {BRUSH_SIZES.map((item) => {
                  const active = brushSizeKey === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setBrushSizeKey(item.id);
                        setShowSizePanel(item.id === 'custom');
                      }}
                      style={{
                        ...sizeBtn,
                        borderColor: active ? themeColor : 'rgba(255,255,255,0.12)',
                        background: active ? 'rgba(250,204,21,0.18)' : sizeBtn.background,
                        color: active ? themeColor : 'var(--text-primary)',
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {(showSizePanel || brushSizeKey === 'custom') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="range"
                    min={2}
                    max={18}
                    step={1}
                    value={customBrushSize}
                    onChange={(e) => {
                      setBrushSizeKey('custom');
                      setCustomBrushSize(Number(e.target.value));
                    }}
                    style={{ width: 180 }}
                  />
                  <span style={{ color: 'var(--text-primary)', fontWeight: 900, fontSize: 12 }}>{customBrushSize}px</span>
                </div>
              )}
            </div>
          )}

          <div style={{
            marginTop: 12,
            width: 68,
            borderRadius: 12,
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.09)',
            color: 'var(--text-primary)',
            textAlign: 'center',
            padding: '8px 0',
            fontSize: 12,
            fontWeight: 900,
          }}>
            <div>{notesCount}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>marks</div>
          </div>
        </div>
        )}

        <div
          ref={viewerRef}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelectedNoteId(null);
          }}
          onMouseUp={() => {
            if (!isActiveReading) return;
            if (tool === 'highlight') applyHighlight('highlight');
            if (tool === 'underline') applyHighlight('underline');
          }}
          style={{
            position: 'relative',
            overflow: 'auto',
            padding: '26px 28px 40px',
            background: 'linear-gradient(90deg, rgba(255,255,255,0.08), transparent 12%, transparent 88%, rgba(255,255,255,0.08)), #07080c',
          }}
        >
          {(loading || (pdfUrl && !firstPageRendered)) && (
            <div style={{
              position: 'absolute',
              inset: 0,
              zIndex: 20,
              display: 'grid',
              placeItems: 'center',
              background: '#07080c',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 70,
                  height: 70,
                  margin: '0 auto 18px',
                  borderRadius: '50%',
                  border: '5px solid rgba(255,255,255,0.08)',
                  borderTopColor: themeColor,
                  animation: 'spinRepasar 1s linear infinite',
                }} />
                <div style={{ fontSize: 18, fontWeight: 900 }}>Cargando documento...</div>
                <div style={{ marginTop: 7, color: 'var(--text-muted)' }}>Preparando lectura</div>
              </div>
            </div>
          )}

          {isActiveReading && firstPageRendered && (
            <div style={{
              position: 'sticky',
              top: 0,
              zIndex: 18,
              margin: '0 auto 16px',
              width: 'fit-content',
              maxWidth: 'calc(100% - 40px)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 999,
              background: 'rgba(8,9,14,0.88)',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 12px 35px rgba(0,0,0,0.35)',
              overflowX: 'auto',
            }}>
              {COLORS.map((c) => {
                const active = highlightColor === c.value;
                return (
                  <button
                    key={c.id}
                    onClick={() => setHighlightColor(c.value)}
                    title={c.label}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      border: active ? `3px solid ${themeColor}` : '1px solid rgba(255,255,255,0.20)',
                      background: c.value,
                      cursor: 'pointer',
                      boxShadow: active ? '0 0 0 3px rgba(250,204,21,0.16)' : 'none',
                    }}
                  />
                );
              })}
            </div>
          )}

          {err && (
            <div style={{
              color: '#f87171',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(248,113,113,0.35)',
              borderRadius: 16,
              padding: 16,
            }}>
              {err}
            </div>
          )}

          {pdfUrl && !err && (
            <Document
              file={pdfUrl}
              onLoadSuccess={({ numPages: total }) => setNumPages(total)}
              onLoadError={() => requestPdfUrlRefresh()}
              loading={null}
              error={<div style={{ color: '#f87171', fontWeight: 800 }}>No se pudo renderizar el PDF.</div>}
            >
              <div style={{
                display: firstPageRendered ? 'flex' : 'none',
                justifyContent: 'center',
                minHeight: '100%',
              }}>
                <div
                  ref={pageWrapRef}
                  onClick={createStickyNote}
 
                  style={{
                  position: 'relative',
                  background: '#fff',
                  borderRadius: 7,
                  padding: 10,
                  boxShadow: '0 24px 80px rgba(0,0,0,0.62)',
                  alignSelf: 'flex-start',
                  touchAction: tool === 'draw' || tool === 'erase' ? 'none' : 'auto',
                  cursor: isActiveReading && tool === 'draw' ? 'crosshair' : isActiveReading && tool === 'erase' ? 'cell' : 'text',
                }}>
                  <Page
                    key={`${activeIndex}-${currentPage}-${scale}`}
                    pageNumber={currentPage}
                    scale={scale}
                    renderTextLayer
                    renderAnnotationLayer
                    onRenderSuccess={() => setFirstPageRendered(true)}
                    loading={null}
                  />

                  {isActiveReading && (
                    <>
                    <div
                      style={{
                        position: 'absolute',
                        inset: 10,
                        zIndex: 3,
                        pointerEvents: 'none',
                      }}
                    >
                      {textMarks.map((mark) => (
                        <div key={mark.id}>
                          {mark.rects.map((rect, index) => {
                            const hovered = hoveredMarkId === mark.id;
                            return (
                              <div
                                key={`${mark.id}_${index}`}
                                onMouseEnter={() => {
                                  setHoveredMarkId(mark.id);
                                  if (tool === 'erase') deleteTextMark(mark.id);
                                }}
                                onMouseLeave={() => setHoveredMarkId(null)}
                                onPointerMove={() => {
                                  if (tool === 'erase') deleteTextMark(mark.id);
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (tool === 'erase') deleteTextMark(mark.id);
                                }}
                                style={{
                                  position: 'absolute',
                                  left: `${rect.x * 100}%`,
                                  top: `${rect.y * 100}%`,
                                  width: `${rect.width * 100}%`,
                                  height: `${rect.height * 100}%`,
                                  background: mark.kind === 'highlight' ? mark.color : 'transparent',
                                  borderBottom: mark.kind === 'underline' ? `3px solid ${mark.color}` : 'none',
                                  borderRadius: mark.kind === 'highlight' ? 4 : 0,
                                  outline: hovered ? '2px solid rgba(255,255,255,0.55)' : 'none',
                                  boxShadow: hovered ? '0 0 14px rgba(255,255,255,0.35)' : 'none',
                                  cursor: tool === 'erase' ? 'cell' : 'default',
                                }}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        position: 'absolute',
                        inset: 10,
                        zIndex: 5,
                        pointerEvents: tool === 'note' ? 'auto' : 'none',
                      }}
                    >
                      {stickyNotes.map((note) => {
                        const noteWidth = note.width || 230;
                        const noteHeight = note.height || 130;
                        const noteRotation = note.rotation ?? -1.5;
                        const selected = selectedNoteId === note.id;

                        return (
                        <div
                          key={note.id}
                          data-repasar-sticky-note="1"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setSelectedNoteId(note.id);
                          }}
                          style={{
                            position: 'absolute',
                            left: `${note.x * 100}%`,
                            top: `${note.y * 100}%`,
                            width: noteWidth,
                            height: noteHeight,
                            transform: `translate(-18px, -18px) rotate(${noteRotation}deg)`,
                            background: solidColor(note.color || 'rgba(250, 204, 21, 0.92)'),
                            color: '#111',
                            borderRadius: 4,
                            boxShadow: selected ? '0 0 0 3px rgba(255,255,255,0.78), 0 20px 42px rgba(0,0,0,0.38)' : '0 18px 34px rgba(0,0,0,0.34)',
                            border: selected ? '2px solid rgba(17,24,39,0.78)' : '1px solid rgba(0,0,0,0.10)',
                            overflow: 'visible',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              top: -11,
                              left: '50%',
                              transform: 'translateX(-50%) rotate(1.5deg)',
                              width: 54,
                              height: 20,
                              background: '#f5e8b8',
                              border: '1px solid rgba(0,0,0,0.08)',
                              boxShadow: '0 3px 8px rgba(0,0,0,0.10)',
                              zIndex: 3,
                              pointerEvents: 'none',
                            }}
                          />

                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteStickyNote(note.id);
                            }}
                            style={{
                              position: 'absolute',
                              top: 8,
                              right: 8,
                              zIndex: 4,
                              width: 24,
                              height: 24,
                              borderRadius: '50%',
                              border: '1px solid rgba(0,0,0,0.16)',
                              background: '#fff7d6',
                              color: '#111',
                              cursor: 'pointer',
                              fontWeight: 900,
                              lineHeight: 1,
                              backdropFilter: 'blur(3px)',
                            }}
                          >
                            ×
                          </button>

                          <div
                            onPointerDown={(e) => {
                              if (tool === 'erase') return;

                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedNoteId(note.id);

                              draggingNoteRef.current = note.id;

                              const wrap = pageWrapRef.current;
                              if (!wrap) return;

                              const move = (ev: PointerEvent) => {
                                if (draggingNoteRef.current !== note.id) return;

                                const rect = wrap.getBoundingClientRect();

                                moveStickyNote(
                                  note.id,
                                  (ev.clientX - rect.left) / rect.width,
                                  (ev.clientY - rect.top) / rect.height
                                );
                              };

                              const up = () => {
                                draggingNoteRef.current = null;
                                window.removeEventListener('pointermove', move);
                                window.removeEventListener('pointerup', up);
                              };

                              window.addEventListener('pointermove', move);
                              window.addEventListener('pointerup', up);
                            }}
                            onClick={(e) => {
                              if (tool === 'erase') {
                                e.stopPropagation();
                                deleteStickyNote(note.id);
                              }
                            }}
                            style={{
                              height: 30,
                              background: 'rgba(0,0,0,0.06)',
                              borderBottom: '1px dashed rgba(0,0,0,0.12)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0 42px 0 14px',
                              cursor: tool === 'erase' ? 'cell' : 'grab',
                              fontSize: 13,
                              fontWeight: 950,
                              letterSpacing: 0.2,
                              userSelect: 'none',
                              fontFamily: BODY,
                            }}
                          >
                            <span>nota</span>
                            <span style={{ opacity: 0.55 }}>⋮⋮</span>
                          </div>

                          <textarea
                            className="repasar-sticky-textarea"
                            value={note.text}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateStickyNote(note.id, e.target.value)}
                            placeholder="Escribe una nota..."
                            style={{
                              width: '100%',
                              height: Math.max(70, noteHeight - 30),
                              resize: 'none',
                              background: 'transparent',
                              border: 'none',
                              outline: 'none',
                              color: '#111',
                              fontFamily: BODY,
                              fontSize: 15,
                              fontWeight: 800,
                              lineHeight: 1.45,
                              padding: '12px 14px 14px',
                              boxSizing: 'border-box',
                            }}
                          />

                          {selected && (
                            <>
                              <div
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();

                                  const wrap = pageWrapRef.current;
                                  if (!wrap) return;

                                  const startX = e.clientX;
                                  const startY = e.clientY;
                                  const startW = noteWidth;
                                  const startH = noteHeight;

                                  const move = (ev: PointerEvent) => {
                                    updateStickyNoteMeta(note.id, {
                                      width: Math.max(150, Math.min(420, startW + (ev.clientX - startX))),
                                      height: Math.max(90, Math.min(360, startH + (ev.clientY - startY))),
                                    });
                                  };

                                  const up = () => {
                                    window.removeEventListener('pointermove', move);
                                    window.removeEventListener('pointerup', up);
                                  };

                                  window.addEventListener('pointermove', move);
                                  window.addEventListener('pointerup', up);
                                }}
                                style={{
                                  position: 'absolute',
                                  right: -10,
                                  bottom: -10,
                                  width: 22,
                                  height: 22,
                                  borderRadius: 6,
                                  background: '#111827',
                                  color: '#fff',
                                  display: 'grid',
                                  placeItems: 'center',
                                  cursor: 'nwse-resize',
                                  fontWeight: 900,
                                  zIndex: 5,
                                }}
                              >
                                ◢
                              </div>

                              <div
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();

                                  const wrap = pageWrapRef.current;
                                  if (!wrap) return;

                                  const rect = wrap.getBoundingClientRect();
                                  const centerX = rect.left + note.x * rect.width;
                                  const centerY = rect.top + note.y * rect.height;
                                  const startRotation = noteRotation;
                                  const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;

                                  const move = (ev: PointerEvent) => {
                                    const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * 180 / Math.PI;
                                    updateStickyNoteMeta(note.id, {
                                      rotation: Math.max(-35, Math.min(35, startRotation + angle - startAngle)),
                                    });
                                  };

                                  const up = () => {
                                    window.removeEventListener('pointermove', move);
                                    window.removeEventListener('pointerup', up);
                                  };

                                  window.addEventListener('pointermove', move);
                                  window.addEventListener('pointerup', up);
                                }}
                                style={{
                                  position: 'absolute',
                                  left: '50%',
                                  top: -42,
                                  transform: 'translateX(-50%)',
                                  width: 28,
                                  height: 28,
                                  borderRadius: '50%',
                                  background: '#111827',
                                  color: '#fff',
                                  display: 'grid',
                                  placeItems: 'center',
                                  cursor: 'grab',
                                  fontWeight: 900,
                                  zIndex: 5,
                                }}
                              >
                                ↻
                              </div>
                            </>
                          )}
                        </div>
                      );
                      })}
                    </div>

                    <canvas
                      ref={drawCanvasRef}
                      style={{
                        position: 'absolute',
                        inset: 10,
                        width: 'calc(100% - 20px)',
                        height: 'calc(100% - 20px)',
                        zIndex: 4,
                        pointerEvents: 'none',
                        touchAction: 'none',
                      }}
                    />
                    <canvas
                      ref={liveCanvasRef}
                      style={{
                        position: 'absolute',
                        inset: 10,
                        width: 'calc(100% - 20px)',
                        height: 'calc(100% - 20px)',
                        zIndex: 5,
                        pointerEvents: 'none',
                        touchAction: 'none',
                      }}
                    />
                    {tool === 'erase' && eraserCursor && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `calc(10px + ${eraserCursor.x * 100}% - ${activeBrushSize * 2}px)`,
                          top: `calc(10px + ${eraserCursor.y * 100}% - ${activeBrushSize * 2}px)`,
                          width: activeBrushSize * 4,
                          height: activeBrushSize * 4,
                          borderRadius: '50%',
                          border: '2px solid rgba(239,68,68,0.95)',
                          background: 'rgba(239,68,68,0.10)',
                          zIndex: 7,
                          pointerEvents: 'none',
                          boxShadow: '0 0 18px rgba(239,68,68,0.22)',
                        }}
                      />
                    )}

                    <div
                      ref={drawInputRef}
                      onPointerDown={startDraw}
                      onPointerMove={moveDraw}
                      onPointerUp={endDraw}
                      onPointerCancel={endDraw}
                      onPointerLeave={endDraw}
                      onDragStart={(e) => e.preventDefault()}
                      style={{
                        position: 'absolute',
                        inset: 10,
                        zIndex: 8,
                        pointerEvents: tool === 'draw' || tool === 'erase' ? 'auto' : 'none',
                        touchAction: 'none',
                        cursor: tool === 'erase' ? 'none' : 'crosshair',
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                        WebkitTouchCallout: 'none',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    />
                    </>
                  )}
                </div>
              </div>
            </Document>
          )}

          {pages.length > 1 && firstPageRendered && (
            <div style={{
              position: 'sticky',
              bottom: 12,
              margin: '18px auto 0',
              width: 'fit-content',
              display: 'flex',
              gap: 7,
              background: 'rgba(8,9,14,0.9)',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 14,
              padding: 8,
              boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
            }}>
              {pages.map((page, i) => (
                <button
                  key={page}
                  onClick={() => setCurrentPageIndex(i)}
                  style={{
                    width: 42,
                    height: 46,
                    borderRadius: 8,
                    border: i === currentPageIndex ? `2px solid ${themeColor}` : '1px solid rgba(255,255,255,0.18)',
                    background: i === currentPageIndex ? 'rgba(250,204,21,0.15)' : 'rgba(255,255,255,0.04)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontWeight: 900,
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}

          <style jsx>{`
            @keyframes spinRepasar {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }

            :global(.react-pdf__Page__textContent span) {
              cursor: text;
            }

            :global(.react-pdf__Page__textContent ::selection) {
              background: rgba(250, 204, 21, 0.35);
            }

            :global(.repasar-sticky-textarea::placeholder) {
              color: rgba(17, 17, 17, 0.82);
              font-weight: 900;
            }
          `}</style>
        </div>
      </div>
    </div>
  );
}

const toolBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.055)',
  color: 'var(--text-primary)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  padding: '8px 12px',
  cursor: 'pointer',
  fontWeight: 900,
};

const sideBtn: React.CSSProperties = {
  width: 68,
  height: 46,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.35)',
  color: 'var(--text-primary)',
  border: '1px solid rgba(255,255,255,0.11)',
  borderRadius: 12,
  cursor: 'pointer',
  fontWeight: 900,
  fontFamily: BODY,
};

const miniBtn: React.CSSProperties = {
  width: 54,
  height: 46,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  background: 'rgba(255,255,255,0.055)',
  color: 'var(--text-primary)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  cursor: 'pointer',
  fontWeight: 900,
  fontFamily: BODY,
};

const sizeBtn: React.CSSProperties = {
  minWidth: 38,
  height: 34,
  background: 'rgba(255,255,255,0.055)',
  color: 'var(--text-primary)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 999,
  cursor: 'pointer',
  fontWeight: 900,
  fontFamily: BODY,
};
