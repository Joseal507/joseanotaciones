'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { buildSourceSelectionFromMaterials, type SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { useAuthorizedSource } from '../../lib/materials/useAuthorizedSource';
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState';
import {
  abandonFreeStudyMap,
  beginFreeStudyMap,
  completeFreeStudyMap,
  failFreeStudyMap,
  initialFreeStudyMapState,
  recoverInterruptedFreeStudyMap,
  updateFreeStudyMapState,
  type DurableFreeStudyMapState,
  type StudyMapExplanationState,
} from '../../lib/freeStudyMapState';

interface MapNode {
  id: string;
  label: string;
  type: 'root' | 'branch' | 'leaf' | 'detail';
  children?: MapNode[];
  color?: string;
  emoji?: string;
  page?: number;
  description?: string;
}

interface MindMapData {
  title: string;
  root: MapNode;
  summary?: string;
  totalConcepts?: number;
}

interface Props {
  materiales: any[];
  seleccion?: any[] | null;
  tema?: any;
  materia?: any;
  onBack: () => void;
  onMasteryEvent?: (event: any) => void;
  masteryContext?: any;
  sessionId?: string | null;
  sourceSelection?: SourceSelectionSnapshot;
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function normalizePages(value: any): number[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
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

function getSelectionPages(item: any): number[] {
  if (!item) return [];
  for (const c of [item?.pages, item?.paginasSeleccionadas, item?.selectedPages, item?.paginas, item?.pageNumbers, item?.range, item?.selection]) {
    const p = normalizePages(c);
    if (p.length) return p;
  }
  return [];
}

function getSelectionText(item: any): string {
  return String(item?.text ?? item?.texto ?? item?.content ?? item?.contenido ?? item?.selectedText ?? '').trim();
}

function getIds(item: any): string[] {
  const nested = item?.material || item?.documento || item?.doc || item?.source || item?.file || null;
  return [item?.materialId, item?.material_id, item?.documentId, item?.document_id, item?.docId, item?.doc_id, item?.id, nested?.materialId, nested?.material_id, nested?.id].filter(Boolean).map((v: any) => String(v));
}

function findSelectionForMaterial(materiales: any[], mat: any, index: number, seleccion?: any[] | null): any | null {
  if (!Array.isArray(seleccion) || !seleccion.length || !mat) return null;
  const matIds = getIds(mat);
  return seleccion.find((s: any) => Number(s?.materialIndex) === index)
    || seleccion.find((s: any) => getIds(s).some((id: string) => matIds.includes(id)))
    || seleccion[index] || null;
}

function filterTextByPages(fullText: string, pages: number[]): string {
  if (!fullText || !pages.length) return fullText || '';
  const sorted = Array.from(new Set(pages.map(Number).filter(n => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  if (!sorted.length) return fullText;
  const result: string[] = [];
  const markerRegex = /(?:^|\n)\s*(?:\[\s*(?:P[aá]gina|Pagina|Page)\s+(\d+)\s*\]|---\s*(?:p[aá]gina|page)\s*(\d+)\s*---)\s*/gi;
  const matches = Array.from(fullText.matchAll(markerRegex));
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const page = Number(m[1] || m[2]);
      if (!sorted.includes(page)) continue;
      const start = (m.index || 0) + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index || fullText.length : fullText.length;
      const chunk = fullText.slice(start, end).trim();
      if (chunk) result.push(`[Pagina ${page}]\n${chunk}`);
    }
    if (result.length > 0) return result.join('\n\n');
  }
  return fullText;
}

const BRANCH_COLORS = ['#d6b26f', '#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#a78bfa', '#f87171', '#34d399', '#fbbf24', '#60a5fa'];


// ════════════════════════════════════════════════
// MOTOR DE LÍNEAS DE ENERGÍA (estilo TemaView)
// ════════════════════════════════════════════════

function toRgbaColor(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map(h => h + h).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function pointOnCurve(p0: {x:number,y:number}, p1: {x:number,y:number}, p2: {x:number,y:number}, p3: {x:number,y:number}, t: number) {
  const u = 1 - t;
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
  };
}

function drawCurveUntil(
  ctx: CanvasRenderingContext2D,
  p0: {x:number,y:number}, p1: {x:number,y:number}, p2: {x:number,y:number}, p3: {x:number,y:number},
  progress: number,
  toScreen: (x: number, y: number) => { x: number; y: number }
) {
  if (progress <= 0) return;
  const STEPS = 32;
  const target = Math.max(0, Math.min(1, progress));

  const start = toScreen(p0.x, p0.y);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);

  for (let i = 1; i <= STEPS; i++) {
    const t = (i / STEPS) * target;
    const pt = pointOnCurve(p0, p1, p2, p3, t);
    const sc = toScreen(pt.x, pt.y);
    ctx.lineTo(sc.x, sc.y);
    if (i / STEPS >= target) break;
  }
}

interface EnergyLine {
  key: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  ctrl1X: number;
  ctrl1Y: number;
  ctrl2X: number;
  ctrl2Y: number;
  color: string;
  active: boolean;
}

function useEnergyLines(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  chargeState: React.MutableRefObject<Map<string, number>>,
  lines: EnergyLine[],
  transform: { x: number; y: number; scale: number },
  bounds: { minX: number; minY: number },
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    window.addEventListener('resize', resize);
    resize();

    const toScreen = (x: number, y: number) => ({
      x: transform.x + (x - bounds.minX) * transform.scale,
      y: transform.y + (y - bounds.minY) * transform.scale,
    });

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      lines.forEach(line => {
        const current = chargeState.current.get(line.key) || 0;
        let next = current;

        if (line.active) next = Math.min(1, current + 0.05);
        else next = Math.max(0, current - 0.04);

        chargeState.current.set(line.key, next);
        if (next <= 0.001) return;

        const p0 = { x: line.fromX, y: line.fromY };
        const p1 = { x: line.ctrl1X, y: line.ctrl1Y };
        const p2 = { x: line.ctrl2X, y: line.ctrl2Y };
        const p3 = { x: line.toX, y: line.toY };

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Capa exterior: glow ancho difuso
        drawCurveUntil(ctx, p0, p1, p2, p3, next, toScreen);
        ctx.strokeStyle = toRgbaColor(line.color, 0.22 * next);
        ctx.lineWidth = 9;
        ctx.shadowBlur = 18;
        ctx.shadowColor = line.color;
        ctx.stroke();

        // Capa media: color sólido
        drawCurveUntil(ctx, p0, p1, p2, p3, next, toScreen);
        ctx.strokeStyle = toRgbaColor(line.color, 0.78 * next);
        ctx.lineWidth = 2.4;
        ctx.shadowBlur = 10;
        ctx.shadowColor = line.color;
        ctx.stroke();

        // Capa interna: línea blanca brillante
        drawCurveUntil(ctx, p0, p1, p2, p3, next, toScreen);
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * next})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 5;
        ctx.shadowColor = '#fff';
        ctx.stroke();

        // Cabeza luminosa cuando aún está cargando
        if (next < 1 && line.active) {
          const head = pointOnCurve(p0, p1, p2, p3, next);
          const hs = toScreen(head.x, head.y);
          const grad = ctx.createRadialGradient(hs.x, hs.y, 0, hs.x, hs.y, 20);
          grad.addColorStop(0, 'rgba(255,255,255,1)');
          grad.addColorStop(0.3, toRgbaColor(line.color, 0.95));
          grad.addColorStop(1, toRgbaColor(line.color, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(hs.x, hs.y, 20, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });

      raf = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [lines, transform, bounds, canvasRef, chargeState]);
}

// ════════════════════════════════════════════════
// MAPA MENTAL HORIZONTAL (estilo árbol)
// ════════════════════════════════════════════════

interface PositionedNode {
  node: MapNode;
  x: number;
  y: number;
  level: number;
  side: 'left' | 'right';
  color: string;
  parentX?: number;
  parentY?: number;
  width: number;
  height: number;
  expanded: boolean;
}

const NODE_WIDTHS = { 0: 320, 1: 280, 2: 260, 3: 220 };
const NODE_HEIGHTS = { 0: 130, 1: 110, 2: 95, 3: 75 };
const H_GAP = 120;
const V_GAP_LEAF = 18;
const V_GAP_BRANCH = 60;
const V_GAP_DETAIL = 12;

function MindMap({
  data,
  selectedId,
  onSelect,
  expandedSet,
  onToggleExpand,
  focusNodeId,
  studiedSet,
}: {
  data: MindMapData;
  selectedId: string | null;
  onSelect: (n: MapNode) => void;
  expandedSet: Set<string>;
  onToggleExpand: (id: string) => void;
  focusNodeId?: string | null;
  studiedSet: Set<string>;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chargeState = useRef<Map<string, number>>(new Map());
  const lastClickRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });

  const handleNodeClick = useCallback((node: MapNode) => {
    const now = Date.now();
    // Debounce: ignorar clicks muy rápidos al mismo nodo (< 350ms)
    if (lastClickRef.current.id === node.id && now - lastClickRef.current.time < 350) {
      return;
    }
    lastClickRef.current = { id: node.id, time: now };

    const hasChildren = (node.children || []).length > 0;
    const isAlreadySelected = selectedId === node.id;
    const isAlreadyExpanded = expandedSet.has(node.id);

    if (hasChildren) {
      if (!isAlreadyExpanded) {
        // Primer click: expandir + seleccionar
        onSelect(node);
        onToggleExpand(node.id);
      } else if (isAlreadyExpanded && !isAlreadySelected) {
        // Ya expandido pero no seleccionado: solo seleccionar (no colapsar)
        onSelect(node);
      } else {
        // Ya expandido y seleccionado: colapsar + deseleccionar
        onSelect(node);
        onToggleExpand(node.id);
      }
    } else {
      // Hoja sin hijos: solo seleccionar/deseleccionar
      onSelect(node);
    }
  }, [selectedId, expandedSet, onSelect, onToggleExpand]);
  // ─── Calcular altura total de un subárbol ───
  const measureSubtree = useCallback((node: MapNode, level: number): number => {
    const baseHeight = NODE_HEIGHTS[level as 0|1|2|3] || 80;
    const isExpanded = expandedSet.has(node.id);
    const children = node.children || [];
    if (!isExpanded || children.length === 0) return baseHeight;

    const gap = level === 0 ? V_GAP_BRANCH : level === 1 ? V_GAP_LEAF : V_GAP_DETAIL;
    const childrenHeight = children.reduce((sum, child, i) => {
      return sum + measureSubtree(child, level + 1) + (i > 0 ? gap : 0);
    }, 0);

    return Math.max(baseHeight, childrenHeight);
  }, [expandedSet]);

  // ─── Layout horizontal: izquierda/derecha desde el root ───
  const layout = useMemo<PositionedNode[]>(() => {
    const result: PositionedNode[] = [];
    const rootExpanded = expandedSet.has(data.root.id);
    const branches = rootExpanded ? (data.root.children || []) : [];

    // Dividir ramas: mitad izquierda, mitad derecha
    const mid = Math.ceil(branches.length / 2);
    const rightBranches = branches.slice(0, mid);
    const leftBranches = branches.slice(mid);

    // Calcular altura total de cada lado
    const totalRightHeight = rightBranches.reduce((sum, b, i) =>
      sum + measureSubtree(b, 1) + (i > 0 ? V_GAP_BRANCH : 0), 0);
    const totalLeftHeight = leftBranches.reduce((sum, b, i) =>
      sum + measureSubtree(b, 1) + (i > 0 ? V_GAP_BRANCH : 0), 0);

    const maxHeight = Math.max(totalRightHeight, totalLeftHeight, NODE_HEIGHTS[0]);
    const centerY = Math.max(maxHeight / 2, 400);
    const centerX = 800;

    // Root
    result.push({
      node: data.root,
      x: centerX,
      y: centerY,
      level: 0,
      side: 'right',
      color: '#d6b26f',
      width: NODE_WIDTHS[0],
      height: NODE_HEIGHTS[0],
      expanded: true,
    });

    // ─── Función recursiva para posicionar subárbol ───
    const placeSubtree = (
      node: MapNode,
      level: number,
      side: 'left' | 'right',
      color: string,
      startY: number,
      parentX: number,
      parentY: number
    ): number => {
      const subtreeHeight = measureSubtree(node, level);
      const nodeY = startY + subtreeHeight / 2;
      const nodeW = NODE_WIDTHS[level as 0|1|2|3] || 220;
      const parentW = NODE_WIDTHS[(level - 1) as 0|1|2|3] || 280;

      const nodeX = side === 'right'
        ? parentX + parentW / 2 + H_GAP + nodeW / 2
        : parentX - parentW / 2 - H_GAP - nodeW / 2;

      result.push({
        node,
        x: nodeX,
        y: nodeY,
        level,
        side,
        color,
        parentX,
        parentY,
        width: nodeW,
        height: NODE_HEIGHTS[level as 0|1|2|3] || 80,
        expanded: expandedSet.has(node.id),
      });

      const isExpanded = expandedSet.has(node.id);
      const children = node.children || [];
      if (!isExpanded || children.length === 0) return subtreeHeight;

      const gap = level === 0 ? V_GAP_BRANCH : level === 1 ? V_GAP_LEAF : V_GAP_DETAIL;
      let childStartY = nodeY - subtreeHeight / 2;
      children.forEach((child, i) => {
        if (i > 0) childStartY += gap;
        const childHeight = placeSubtree(child, level + 1, side, color, childStartY, nodeX, nodeY);
        childStartY += childHeight;
      });

      return subtreeHeight;
    };

    // Posicionar ramas derechas
    let yCursor = centerY - totalRightHeight / 2;
    rightBranches.forEach((branch, i) => {
      if (i > 0) yCursor += V_GAP_BRANCH;
      const color = BRANCH_COLORS[i % BRANCH_COLORS.length];
      const h = placeSubtree(branch, 1, 'right', color, yCursor, centerX, centerY);
      yCursor += h;
    });

    // Posicionar ramas izquierdas
    yCursor = centerY - totalLeftHeight / 2;
    leftBranches.forEach((branch, i) => {
      if (i > 0) yCursor += V_GAP_BRANCH;
      const color = BRANCH_COLORS[(i + rightBranches.length) % BRANCH_COLORS.length];
      const h = placeSubtree(branch, 1, 'left', color, yCursor, centerX, centerY);
      yCursor += h;
    });

    return result;
  }, [data, expandedSet, measureSubtree]);

  // Calcular dimensiones del SVG
  const bounds = useMemo(() => {
    if (layout.length === 0) return { minX: 0, maxX: 1600, minY: 0, maxY: 800 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    layout.forEach(n => {
      minX = Math.min(minX, n.x - n.width / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
      minY = Math.min(minY, n.y - n.height / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    });
    return {
      minX: minX - 80,
      maxX: maxX + 80,
      minY: minY - 80,
      maxY: maxY + 80,
    };
  }, [layout]);

  const svgW = bounds.maxX - bounds.minX;
  const svgH = bounds.maxY - bounds.minY;

  // ─── Construir líneas de energía ───
  const energyLines = useMemo<EnergyLine[]>(() => {
    const lines: EnergyLine[] = [];
    layout.filter(n => n.parentX !== undefined).forEach(n => {
      const px = n.parentX!;
      const py = n.parentY!;
      const parentW = NODE_WIDTHS[(n.level - 1) as 0|1|2|3] || 280;
      const startX = n.side === 'right' ? px + parentW / 2 : px - parentW / 2;
      const endX = n.side === 'right' ? n.x - n.width / 2 : n.x + n.width / 2;
      const midX = (startX + endX) / 2;

      // Activa si: el nodo está expandido, o si el padre está siendo hovereado, o si este nodo está hovereado
      const parentNode = layout.find(l => l.x === px && l.y === py)?.node;
      const isActive =
        hoveredId === n.node.id ||
        (parentNode && hoveredId === parentNode.id) ||
        expandedSet.has(n.node.id) ||
        (parentNode ? expandedSet.has(parentNode.id) && expandedSet.has(n.node.id) : false);

      lines.push({
        key: `edge-${n.node.id}`,
        fromX: startX,
        fromY: py,
        toX: endX,
        toY: n.y,
        ctrl1X: midX,
        ctrl1Y: py,
        ctrl2X: midX,
        ctrl2Y: n.y,
        color: n.color,
        active: !!isActive,
      });
    });
    return lines;
  }, [layout, hoveredId, expandedSet]);

  // ─── Pan & Zoom ───
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);

  useEnergyLines(canvasRef, chargeState, energyLines, transform, bounds);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-fit inicial
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (!containerRef.current || didInitialFit.current) return;
    if (layout.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / svgW;
    const scaleY = rect.height / svgH;
    const scale = Math.min(scaleX, scaleY, 1.2) * 0.92;
    const x = (rect.width - svgW * scale) / 2;
    const y = (rect.height - svgH * scale) / 2;
    setTransform({ x, y, scale });
    didInitialFit.current = true;
  }, [svgW, svgH, layout.length]);

  // Cámara animada hacia el nodo enfocado
  useEffect(() => {
    if (!focusNodeId || !containerRef.current) return;
    const node = layout.find(n => n.node.id === focusNodeId);
    if (!node) return;
    const rect = containerRef.current.getBoundingClientRect();
    // Centrar el nodo en pantalla manteniendo escala actual
    const targetX = rect.width / 2 - (node.x - bounds.minX) * transform.scale;
    const targetY = rect.height / 2 - (node.y - bounds.minY) * transform.scale;

    // Animar suavemente
    const startX = transform.x;
    const startY = transform.y;
    const dur = 600;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      setTransform(prev => ({
        ...prev,
        x: startX + (targetX - startX) * ease,
        y: startY + (targetY - startY) * ease,
      }));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [focusNodeId, layout]);

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.node-clickable, .expand-btn')) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setTransform(t => ({
      ...t,
      x: dragStart.current.tx + (e.clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.clientY - dragStart.current.y),
    }));
  };

  const onMouseUp = () => setDragging(false);

  const onWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(t => ({ ...t, scale: Math.max(0.2, Math.min(3, t.scale * delta)) }));
  };

  const fitToScreen = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / svgW;
    const scaleY = rect.height / svgH;
    const scale = Math.min(scaleX, scaleY, 1) * 0.92;
    const x = (rect.width - svgW * scale) / 2;
    const y = (rect.height - svgH * scale) / 2;
    setTransform({ x, y, scale });
  };

  const wrapText = (text: string, maxChars: number, maxLines: number): string[] => {
    const words = (text || '').split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      if ((current + ' ' + w).trim().length <= maxChars) {
        current = (current + ' ' + w).trim();
      } else {
        if (current) lines.push(current);
        current = w;
        if (lines.length >= maxLines) break;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length + 3) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + '…';
    }
    return lines;
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--bg-primary)' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      {/* Fondo papel */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `
          radial-gradient(circle at 20% 30%, color-mix(in srgb, var(--gold) 8%, transparent), transparent 50%),
          radial-gradient(circle at 80% 70%, color-mix(in srgb, var(--blue) 5%, transparent), transparent 50%),
          radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--red) 4%, transparent), transparent 50%)
        `,
      }} />
      {/* Grid sutil */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.5,
        backgroundImage: `
          linear-gradient(color-mix(in srgb, var(--text-primary) 6%, transparent) 1px, transparent 1px),
          linear-gradient(90deg, color-mix(in srgb, var(--text-primary) 6%, transparent) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
      }} />

      <div style={{
        position: 'absolute', top: 0, left: 0,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        transformOrigin: '0 0',
        cursor: dragging ? 'grabbing' : 'grab',
        width: svgW, height: svgH,
      }}>
        <svg
          width={svgW} height={svgH}
          viewBox={`${bounds.minX} ${bounds.minY} ${svgW} ${svgH}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {/* Conexiones dibujadas por canvas overlay */}

          {/* Nodos */}
          {layout.map(n => {
            const isSel = selectedId === n.node.id;
            const isRoot = n.level === 0;
            const isBranch = n.level === 1;
            const isLeaf = n.level === 2;
            const isDetail = n.level === 3;
            const hasChildren = (n.node.children || []).length > 0;
            const isExpanded = n.expanded;

            const labelMaxChars = isRoot ? 24 : isBranch ? 22 : isLeaf ? 22 : 20;
            const descMaxChars = isRoot ? 36 : isBranch ? 32 : isLeaf ? 30 : 28;
            const labelMaxLines = 2;
            const descMaxLines = isRoot ? 3 : isBranch ? 3 : isLeaf ? 2 : 2;

            const labelLines = wrapText(n.node.label, labelMaxChars, labelMaxLines);
            const descLines = n.node.description ? wrapText(n.node.description, descMaxChars, descMaxLines) : [];

            const labelFS = isRoot ? 22 : isBranch ? 18 : isLeaf ? 16 : 14;
            const descFS = isRoot ? 14 : isBranch ? 13 : isLeaf ? 12 : 11.5;

            const w = n.width;
            const h = n.height;
            const left = n.x - w / 2;
            const top = n.y - h / 2;

            // Colores
            const bgColor = isRoot
              ? 'var(--bg-card)'
              : isBranch
              ? `color-mix(in srgb, ${n.color} 18%, var(--bg-card))`
              : isLeaf
              ? 'var(--bg-card)'
              : `color-mix(in srgb, ${n.color} 10%, var(--bg-card))`;
            const borderColor = n.color;
            const textColor = 'var(--text-primary)';
            const descColor = 'var(--text-muted)';

            return (
              <g key={n.node.id} className="node-clickable" onClick={() => handleNodeClick(n.node)} onMouseEnter={() => setHoveredId(n.node.id)} onMouseLeave={() => setHoveredId(null)} style={{ cursor: 'pointer' }}>
                {/* Sombra */}
                <rect
                  x={left + 3} y={top + 5}
                  width={w} height={h}
                  rx={isRoot ? 22 : isBranch ? 18 : 14}
                  fill="rgba(0,0,0,0.45)"
                />
                {/* Card */}
                <rect
                  x={left} y={top}
                  width={w} height={h}
                  rx={isRoot ? 22 : isBranch ? 18 : 14}
                  fill={bgColor}
                  stroke={borderColor}
                  strokeWidth={isSel ? 4 : isRoot ? 3.5 : isBranch ? 3 : 2}
                />
                {/* Acento lateral */}
                {!isRoot && (
                  <rect
                    x={n.side === 'right' ? left : left + w - 6}
                    y={top}
                    width={6} height={h}
                    rx={3}
                    fill={borderColor}
                  />
                )}

                {/* Contenido con clip */}
                <g clipPath={`url(#clip-${n.node.id})`}>
                {/* Emoji */}
                {n.node.emoji && (
                  <text
                    x={left + 18}
                    y={top + 32}
                    fontSize={isRoot ? 26 : isBranch ? 22 : 18}
                  >
                    {n.node.emoji}
                  </text>
                )}

                {/* Label */}
                {labelLines.map((line, i) => (
                  <text
                    key={`l-${i}`}
                    x={left + (n.node.emoji ? (isRoot ? 52 : 46) : 18)}
                    y={top + 26 + i * (labelFS * 1.2)}
                    fontSize={labelFS}
                    fill={textColor}
                    fontWeight={900}
                    fontFamily="'Inter', system-ui, sans-serif"
                    style={{ pointerEvents: 'none' }}
                  >
                    {line}
                  </text>
                ))}

                {/* Description */}
                {descLines.map((line, i) => (
                  <text
                    key={`d-${i}`}
                    x={left + 18}
                    y={top + 26 + labelLines.length * (labelFS * 1.2) + 12 + i * (descFS * 1.4)}
                    fontSize={descFS}
                    fill={descColor}
                    fontWeight={500}
                    fontFamily="'Inter', system-ui, sans-serif"
                    style={{ pointerEvents: 'none' }}
                  >
                    {line}
                  </text>
                ))}

                </g>
                {/* Página (fuera del clip) */}
                {n.node.page && (
                  <g transform={`translate(${left + w - 56}, ${top + h - 22})`}>
                    <rect x={0} y={0} width={48} height={16} rx={4} fill={borderColor} opacity={0.85} />
                    <text x={24} y={11.5} fontSize={10} fill="#fff" fontWeight={800} textAnchor="middle" fontFamily="'Inter', sans-serif">
                      p.{n.node.page}
                    </text>
                  </g>
                )}

                {/* Checkmark si ya fue estudiado */}
                {studiedSet.has(n.node.id) && (
                  <g transform={`translate(${left - 8}, ${top - 8})`}>
                    <circle cx={10} cy={10} r={10} fill="#10b981" stroke="#fff" strokeWidth={2} />
                    <text x={10} y={14} fontSize={11} fill="#fff" fontWeight={900} textAnchor="middle">✓</text>
                  </g>
                )}

              </g>
            );
          })}
        </svg>
      </div>

      {/* Canvas overlay para líneas de energía animadas */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      />

      {/* Controles */}
      <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { label: '+', action: () => setTransform(t => ({ ...t, scale: Math.min(3, t.scale * 1.2) })) },
          { label: '⊙', action: fitToScreen, title: 'Ajustar a pantalla' },
          { label: '−', action: () => setTransform(t => ({ ...t, scale: Math.max(0.2, t.scale * 0.85) })) },
        ].map(btn => (
          <button
            key={btn.label}
            onClick={btn.action}
            title={btn.title}
            style={{
              width: 40, height: 40, borderRadius: 10,
              border: '1.5px solid var(--border-color2)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)', fontSize: 20, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Info bottom */}
      <div style={{
        position: 'absolute', bottom: 20, left: 20,
        fontSize: 12, color: 'var(--text-faint)', fontFamily: "'Inter', sans-serif",
        background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)',
        padding: '6px 12px', borderRadius: 8,
        border: '1px solid var(--border-color2)',
      }}>
        {Math.round(transform.scale * 100)}% · arrastra para mover · scroll para zoom · click en concepto para estudiarlo
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// VISTA CARDS
// ════════════════════════════════════════════════

function CardsView({ data }: { data: MindMapData }) {
  const branches = data.root.children || [];
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set(branches.map(b => b.id)));

  const toggleBranch = (id: string) => {
    setExpandedBranches(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)', padding: '24px 32px 60px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{
          padding: 24, borderRadius: 16, marginBottom: 28,
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 18%, var(--bg-card)), color-mix(in srgb, var(--gold) 8%, var(--bg-card)))',
          border: '2px solid var(--gold)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ fontSize: 40 }}>{data.root.emoji || '🎯'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--gold)', fontFamily: "'Inter', sans-serif", marginBottom: 6 }}>
                {data.root.label}
              </div>
              {data.root.description && (
                <div style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, fontFamily: "'Inter', sans-serif" }}>
                  {data.root.description}
                </div>
              )}
            </div>
          </div>
        </div>

        {branches.map((branch, bi) => {
          const color = branch.color || BRANCH_COLORS[bi % BRANCH_COLORS.length];
          const isExpanded = expandedBranches.has(branch.id);
          const leaves = branch.children || [];

          return (
            <div key={branch.id} style={{ marginBottom: 20 }}>
              <button
                onClick={() => toggleBranch(branch.id)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '14px 18px', borderRadius: 14,
                  background: 'var(--bg-card)',
                  borderLeft: `6px solid ${color}`,
                  border: `2px solid color-mix(in srgb, ${color} 40%, transparent)`,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  marginBottom: isExpanded ? 12 : 0,
                  boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
                }}
              >
                <span style={{ fontSize: 24 }}>{branch.emoji || '●'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: color, fontFamily: "'Inter', sans-serif" }}>
                    {branch.label}
                  </div>
                  {branch.description && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, fontFamily: "'Inter', sans-serif" }}>
                      {branch.description}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 700, marginRight: 8 }}>
                  {leaves.length} concepto{leaves.length !== 1 ? 's' : ''}
                </div>
                <span style={{ color, fontSize: 14, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▶</span>
              </button>

              {isExpanded && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, paddingLeft: 16 }}>
                  {leaves.map((leaf) => {
                    const details = leaf.children || [];
                    return (
                      <div key={leaf.id} style={{
                        padding: '14px 16px', borderRadius: 12,
                        background: 'var(--bg-card)',
                        border: `1.5px solid color-mix(in srgb, ${color} 35%, transparent)`,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                      }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontFamily: "'Inter', sans-serif", lineHeight: 1.3 }}>
                          {leaf.label}
                        </div>
                        {leaf.description && (
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: details.length || leaf.page ? 10 : 0, fontFamily: "'Inter', sans-serif" }}>
                            {leaf.description}
                          </div>
                        )}
                        {details.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: leaf.page ? 8 : 0 }}>
                            {details.map(d => (
                              <div key={d.id} style={{
                                padding: '7px 10px', borderRadius: 8,
                                background: `color-mix(in srgb, ${color} 12%, var(--bg-card2))`,
                                borderLeft: `3px solid ${color}`,
                              }}>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 1, fontFamily: "'Inter', sans-serif" }}>
                                  {d.label}
                                </div>
                                {d.description && (
                                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4, fontFamily: "'Inter', sans-serif" }}>
                                    {d.description}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {leaf.page && (
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 999,
                            background: `color-mix(in srgb, ${color} 20%, var(--bg-card2))`,
                            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
                            fontSize: 10, fontWeight: 700, color,
                            fontFamily: "'Inter', sans-serif",
                          }}>
                            📄 p.{leaf.page}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// VISTA OUTLINE
// ════════════════════════════════════════════════

function OutlineView({ data }: { data: MindMapData }) {
  const branches = data.root.children || [];
  const [openLeaves, setOpenLeaves] = useState<Set<string>>(new Set());

  const toggleLeaf = (id: string) => {
    setOpenLeaves(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)', padding: '24px 32px 60px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '3px solid var(--gold)' }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--gold)', fontFamily: "'Inter', sans-serif", marginBottom: 6 }}>
            {data.root.emoji} {data.root.label}
          </div>
          {data.root.description && (
            <div style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.5, fontFamily: "'Inter', sans-serif" }}>
              {data.root.description}
            </div>
          )}
        </div>

        {branches.map((branch, bi) => {
          const color = branch.color || BRANCH_COLORS[bi % BRANCH_COLORS.length];
          const leaves = branch.children || [];
          return (
            <div key={branch.id} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid color-mix(in srgb, ${color} 50%, transparent)` }}>
                <div style={{ fontSize: 14, fontWeight: 900, color, fontFamily: "'Inter', sans-serif", letterSpacing: 1 }}>
                  {String(bi + 1).padStart(2, '0')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif" }}>
                    {branch.emoji} {branch.label}
                  </div>
                  {branch.description && (
                    <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5, fontFamily: "'Inter', sans-serif" }}>
                      {branch.description}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {leaves.map((leaf, li) => {
                  const isOpen = openLeaves.has(leaf.id);
                  const details = leaf.children || [];
                  return (
                    <div key={leaf.id}>
                      <button
                        onClick={() => details.length > 0 ? toggleLeaf(leaf.id) : null}
                        style={{
                          width: '100%', textAlign: 'left',
                          background: 'transparent', border: 'none',
                          padding: '6px 0', cursor: details.length > 0 ? 'pointer' : 'default',
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                        }}
                      >
                        <span style={{ fontSize: 12, color, fontWeight: 700, minWidth: 28, marginTop: 3, fontFamily: "'Inter', sans-serif" }}>
                          {bi + 1}.{li + 1}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: 6 }}>
                            {details.length > 0 && (
                              <span style={{ fontSize: 10, color, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
                            )}
                            {leaf.label}
                            {leaf.page && <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600 }}>· p.{leaf.page}</span>}
                          </div>
                          {leaf.description && (
                            <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 4, paddingLeft: details.length > 0 ? 14 : 0, fontFamily: "'Inter', sans-serif" }}>
                              {leaf.description}
                            </div>
                          )}
                        </div>
                      </button>
                      {isOpen && details.length > 0 && (
                        <div style={{ paddingLeft: 48, marginTop: 6, marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {details.map(d => (
                            <div key={d.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                              <span style={{ color, fontSize: 14, marginTop: 2 }}>•</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700, color, fontFamily: "'Inter', sans-serif" }}>
                                  {d.label}
                                </div>
                                {d.description && (
                                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2, fontFamily: "'Inter', sans-serif" }}>
                                    {d.description}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// DETAIL PANEL
// ════════════════════════════════════════════════

function DetailPanel({ node, onClose }: { node: MapNode | null; onClose: () => void }) {
  if (!node) return null;
  const color = node.color || '#d6b26f';
  return (
    <div style={{
      position: 'absolute', right: 16, top: 16, bottom: 16,
      width: 360,
      background: 'var(--bg-card)',
      border: `2px solid ${color}`,
      borderRadius: 16,
      padding: 22,
      boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      zIndex: 20,
      overflowY: 'auto',
    }}>
      <button onClick={onClose} style={{
        position: 'absolute', top: 12, right: 12,
        width: 30, height: 30, borderRadius: 8,
        border: 'none', background: 'var(--bg-secondary)',
        color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, fontWeight: 700,
      }}>✕</button>

      {node.emoji && <div style={{ fontSize: 40, marginBottom: 10 }}>{node.emoji}</div>}

      <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: "'Inter', sans-serif", fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        {node.type === 'root' ? 'Tema Central' : node.type === 'branch' ? 'Categoría' : node.type === 'leaf' ? 'Concepto' : 'Detalle'}
      </div>

      <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", marginBottom: 12, lineHeight: 1.25 }}>
        {node.label}
      </div>

      {node.description && (
        <p style={{ fontSize: 14.5, color: 'var(--text-secondary)', lineHeight: 1.65, fontFamily: "'Inter', sans-serif", margin: '0 0 16px' }}>
          {node.description}
        </p>
      )}

      {node.page && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', borderRadius: 999,
          background: `color-mix(in srgb, ${color} 20%, var(--bg-card))`,
          border: `1.5px solid ${color}`,
          fontSize: 13, fontWeight: 700, color: color,
          fontFamily: "'Inter', sans-serif", marginBottom: 14,
        }}>
          📄 Página {node.page}
        </div>
      )}

      {node.children && node.children.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: '#888', fontFamily: "'Inter', sans-serif", fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Contiene ({node.children.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {node.children.map(child => (
              <div key={child.id} style={{
                padding: '10px 12px', borderRadius: 10,
                background: `color-mix(in srgb, ${color} 10%, var(--bg-card2))`,
                border: `1.5px solid color-mix(in srgb, ${color} 30%, transparent)`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif" }}>
                  {child.emoji && <span style={{ marginRight: 6 }}>{child.emoji}</span>}
                  {child.label}
                </div>
                {child.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45, fontFamily: "'Inter', sans-serif" }}>
                    {child.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ════════════════════════════════════════════════
// STUDY PANEL (panel derecho estilo NotebookLM)
// ════════════════════════════════════════════════


// ════════════════════════════════════════════════
// RENDERIZADOR MARKDOWN ESTILO ALAI CHAT
// ════════════════════════════════════════════════

function renderInline(text: string, key?: string | number): React.ReactNode {
  // **bold**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={`${key}-${i}`} style={{ color: 'var(--text-primary)', fontWeight: 800 }}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={`${key}-${i}`}>{part}</span>;
      })}
    </>
  );
}

function AlaiMarkdown({ text, color }: { text: string; color: string }) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return null;

  const allLines = normalized.split('\n');
  const blocks: { type: string; lines: string[] }[] = [];
  let i = 0;

  // Parser por bloques
  while (i < allLines.length) {
    const line = allLines[i];

    // Línea vacía: separador
    if (!line.trim()) { i++; continue; }

    // Heading ## o ###
    if (/^#{1,3}\s+/.test(line)) {
      blocks.push({ type: 'heading', lines: [line] });
      i++;
      continue;
    }

    // Tabla markdown
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < allLines.length && allLines[i].trim().startsWith('|') && allLines[i].trim().endsWith('|')) {
        tableLines.push(allLines[i]);
        i++;
      }
      blocks.push({ type: 'table', lines: tableLines });
      continue;
    }

    // Blockquote ">"
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < allLines.length && allLines[i].trim().startsWith('>')) {
        quoteLines.push(allLines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', lines: quoteLines });
      continue;
    }

    // Lista numerada (varias líneas seguidas)
    if (/^\d+[\).:]?\s+/.test(line.trim())) {
      const listLines: string[] = [];
      while (i < allLines.length && /^\d+[\).:]?\s+/.test(allLines[i].trim())) {
        listLines.push(allLines[i].trim());
        i++;
      }
      blocks.push({ type: 'ol', lines: listLines });
      continue;
    }

    // Lista con bullets
    if (/^[-•*]\s+/.test(line.trim())) {
      const listLines: string[] = [];
      while (i < allLines.length && /^[-•*]\s+/.test(allLines[i].trim())) {
        listLines.push(allLines[i].trim().replace(/^[-•*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', lines: listLines });
      continue;
    }

    // Párrafo (junta líneas hasta línea vacía o cambio de tipo)
    const paraLines: string[] = [];
    while (
      i < allLines.length &&
      allLines[i].trim() &&
      !/^#{1,3}\s+/.test(allLines[i]) &&
      !allLines[i].trim().startsWith('|') &&
      !allLines[i].trim().startsWith('>') &&
      !/^\d+[\).:]?\s+/.test(allLines[i].trim()) &&
      !/^[-•*]\s+/.test(allLines[i].trim())
    ) {
      paraLines.push(allLines[i]);
      i++;
    }
    if (paraLines.length > 0) blocks.push({ type: 'p', lines: paraLines });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {blocks.map((block, bi) => {
        if (block.type === 'heading') {
          const raw = block.lines[0];
          const level = raw.match(/^(#{1,3})/)?.[1].length || 2;
          const txt = raw.replace(/^#{1,3}\s+/, '');
          const fontSize = level === 1 ? 18 : level === 2 ? 15 : 13.5;
          return (
            <div key={bi} style={{
              fontSize, fontWeight: 900, color: 'var(--text-primary)',
              fontFamily: "'Inter', sans-serif",
              marginTop: bi > 0 ? 6 : 0,
              display: 'flex', alignItems: 'center', gap: 8,
              paddingBottom: 6,
              borderBottom: level === 2 ? `1.5px solid color-mix(in srgb, ${color} 25%, transparent)` : 'none',
            }}>
              {renderInline(txt, bi)}
            </div>
          );
        }

        if (block.type === 'p') {
          return (
            <p key={bi} style={{
              margin: 0, fontSize: 14, lineHeight: 1.65,
              color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif",
            }}>
              {block.lines.map((line, li) => (
                <span key={li}>
                  {renderInline(line, `${bi}-${li}`)}
                  {li < block.lines.length - 1 && <br />}
                </span>
              ))}
            </p>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={bi} style={{
              margin: 0, padding: 0, listStyle: 'none',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              {block.lines.map((line, li) => {
                const m = line.match(/^(\d+)[\).:]?\s+(.+)/);
                const num = m ? m[1] : String(li + 1);
                const txt = m ? m[2] : line;
                return (
                  <li key={li} style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)',
                    fontFamily: "'Inter', sans-serif",
                  }}>
                    <span style={{
                      minWidth: 22, height: 22, borderRadius: '50%',
                      background: `color-mix(in srgb, ${color} 25%, transparent)`,
                      border: `1.5px solid ${color}`,
                      color: color, fontWeight: 900, fontSize: 11,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, marginTop: 1,
                    }}>{num}</span>
                    <span style={{ flex: 1 }}>{renderInline(txt, bi)}</span>
                  </li>
                );
              })}
            </ol>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={bi} style={{
              margin: 0, padding: 0, listStyle: 'none',
              display: 'flex', flexDirection: 'column', gap: 5,
            }}>
              {block.lines.map((line, li) => (
                <li key={li} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)',
                  fontFamily: "'Inter', sans-serif",
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: color, marginTop: 8, flexShrink: 0,
                  }} />
                  <span style={{ flex: 1 }}>{renderInline(line, bi)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'quote') {
          return (
            <div key={bi} style={{
              padding: '10px 14px',
              borderLeft: `4px solid ${color}`,
              background: 'var(--bg-card2)',
              borderRadius: '0 8px 8px 0',
              fontSize: 13.5, color: 'var(--text-muted)',
              fontStyle: 'italic', fontFamily: "'Inter', sans-serif",
              lineHeight: 1.6,
            }}>
              {block.lines.map((line, li) => (
                <div key={li}>{renderInline(line, `${bi}-${li}`)}</div>
              ))}
            </div>
          );
        }

        if (block.type === 'table') {
          const dataRows = block.lines.filter(l => !l.trim().match(/^\|[-:\s|]+\|$/));
          const headers = dataRows[0]?.split('|').map(c => c.trim()).filter(Boolean) || [];
          const bodyRows = dataRows.slice(1);
          return (
            <div key={bi} style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse',
                fontSize: 12.5, fontFamily: "'Inter', sans-serif",
                background: 'var(--bg-card2)', borderRadius: 8, overflow: 'hidden',
                border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
              }}>
                <thead>
                  <tr>
                    {headers.map((h, hi) => (
                      <th key={hi} style={{
                        textAlign: 'left', padding: '8px 10px',
                        background: `color-mix(in srgb, ${color} 22%, var(--bg-card2))`,
                        color: 'var(--text-primary)', fontWeight: 800,
                        borderBottom: `1.5px solid ${color}`,
                      }}>
                        {renderInline(h, `h-${hi}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, ri) => {
                    const cells = row.split('|').map(c => c.trim()).filter((_, i, arr) => arr.length > 0);
                    const trimmedCells = row.split('|').slice(1, -1).map(c => c.trim());
                    return (
                      <tr key={ri} style={{ borderTop: '1px solid var(--border-color2)' }}>
                        {trimmedCells.map((cell, ci) => (
                          <td key={ci} style={{
                            padding: '8px 10px',
                            color: 'var(--text-secondary)',
                            verticalAlign: 'top',
                          }}>
                            {renderInline(cell, `c-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}


function findParentChain(root: MapNode, targetId: string, chain: MapNode[] = []): MapNode[] | null {
  if (root.id === targetId) return [...chain, root];
  for (const child of root.children || []) {
    const found = findParentChain(child, targetId, [...chain, root]);
    if (found) return found;
  }
  return null;
}


function findNodeById(root: MapNode, targetId: string | null | undefined): MapNode | null {
  if (!targetId) return null;
  if (root.id === targetId) return root;
  for (const child of root.children || []) {
    const found = findNodeById(child, targetId);
    if (found) return found;
  }
  return null;
}

function StudyPanel({
  node,
  mapData,
  onClose,
  onJumpToNode,
  materialText,
  materia,
  tema,
  explanationsByNodeId,
  onPersistExplanation,
  isMobile,
}: {
  node: MapNode | null;
  mapData: MindMapData;
  onClose: () => void;
  onJumpToNode: (n: MapNode) => void;
  materialText: string;
  materia?: string;
  tema?: string;
  explanationsByNodeId: Record<string, StudyMapExplanationState>;
  onPersistExplanation: (nodeId: string, explanation: StudyMapExplanationState) => void;
  isMobile?: boolean;
}) {
  const showingRoot = !node || node.id === mapData.root.id;
  const current = node || mapData.root;
  const color = current.color || '#d6b26f';
  const chain = findParentChain(mapData.root, current.id) || [current];
  const breadcrumb = chain.slice(0, -1);
  const parentNode = breadcrumb[breadcrumb.length - 1];

  const typeLabel =
    current.type === 'root' ? 'Tema Central'
    : current.type === 'branch' ? 'Categoría'
    : current.type === 'leaf' ? 'Concepto'
    : 'Detalle';

  const [explicacion, setExplicacion] = useState<StudyMapExplanationState | null>(null);
  const [loadingExp, setLoadingExp] = useState(false);
  const [errExp, setErrExp] = useState('');
  const attemptRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!current || showingRoot) {
      setExplicacion(null);
      setErrExp('');
      setLoadingExp(false);
      return;
    }

    const persisted = explanationsByNodeId[current.id];
    if (persisted) {
      setExplicacion(persisted);
      setErrExp('');
      setLoadingExp(false);
      return;
    }

    let cancelled = false;
    const attempt = (attemptRef.current[current.id] || 0) + 1;
    attemptRef.current[current.id] = attempt;

    setLoadingExp(true);
    setErrExp('');
    setExplicacion(null);

    const pregunta = `Eres un profesor enseñando el concepto "${current.label}"${parentNode ? ` dentro de la categoría "${parentNode.label}"` : ''}.

═══════════════════════════════════════════
TU MISIÓN
═══════════════════════════════════════════
Enseñar este concepto al estudiante usando SOLO el material disponible. Tu objetivo es que entienda profundamente, no solo memorizar.

═══════════════════════════════════════════
REGLA #1 — ELIGE LAS SECCIONES INTELIGENTEMENTE
═══════════════════════════════════════════
NO uses una plantilla fija. Analiza qué TIPO de concepto es y elige entre 3 y 6 secciones del catálogo de abajo, las que MEJOR se adapten a este concepto específico.

CATÁLOGO DE SECCIONES (elige solo las útiles):

📝 PARA TODOS LOS CONCEPTOS (casi siempre útil):
- "## 💡 Lo esencial" — Definición clara en 2-3 oraciones (úsalo casi siempre)
- "## ✨ Para recordarlo" — Truco mnemónico, palabra clave, asociación memorable (úsalo casi siempre)

📅 PARA PERSONAS, EVENTOS, FECHAS HISTÓRICAS:
- "## 📅 Cuándo y dónde" — Fechas, lugares, contexto temporal
- "## 👤 Quién fue / quiénes participaron" — Personas involucradas
- "## 🌍 Contexto de la época" — Situación histórica/cultural

🔬 PARA TEORÍAS, MODELOS, CONCEPTOS CIENTÍFICOS:
- "## 🔬 Cómo funciona" — Mecanismo, proceso interno
- "## ⚗️ Fórmula o estructura" — Ecuaciones, diagramas verbales, componentes
- "## 🧪 Postulados / Principios" — Reglas o leyes que define
- "## 🔢 Datos clave" — Números, constantes, valores específicos

⚙️ PARA PROCESOS, PROCEDIMIENTOS, MÉTODOS:
- "## 📋 Pasos" — Lista ordenada
- "## ⚙️ Cómo se aplica" — Casos de uso reales
- "## ⚠️ Errores comunes" — Qué evitar

💼 PARA APLICACIONES, IMPACTO, RESULTADOS:
- "## 🎯 Por qué importa" — Relevancia en el tema o el mundo
- "## 💥 Impacto / consecuencias" — Qué cambió
- "## 🚀 Aplicaciones reales" — Dónde se usa hoy

🧩 PARA CONCEPTOS RELACIONALES:
- "## 🔗 Cómo se conecta" — Relación con otros conceptos del material
- "## ⚖️ Comparación" — Si el material compara con algo (usa tabla markdown si aplica)
- "## 🆚 Diferencias clave" — Distinciones importantes

💬 SECCIONES OPCIONALES (úsalas si suman):
- "## 🧩 Ejemplo del material" — SOLO si el material da un ejemplo concreto
- "## 💬 Cita textual" — SOLO si hay una frase memorable del material para citar (usa formato > "cita")
- "## ⚠️ Confusión común" — SOLO si el concepto se suele confundir con otra cosa
- "## 🎓 Para profundizar" — Conexiones avanzadas si el material las menciona

═══════════════════════════════════════════
REGLA #2 — EJEMPLOS DE BUENA SELECCIÓN
═══════════════════════════════════════════

CONCEPTO: "Nacimiento de una figura histórica" (dato biográfico)
✅ Secciones: 💡 Lo esencial → 📅 Cuándo y dónde → 🌍 Contexto de la época → ✨ Para recordarlo
❌ NO uses: Fórmula, Pasos, Cómo funciona

CONCEPTO: "Modelo científico específico" (teoría científica)
✅ Secciones: 💡 Lo esencial → 🔬 Cómo funciona → 🧪 Postulados → ⚗️ Estructura → 🎯 Por qué importa → ✨ Para recordarlo
❌ NO uses: Quién fue, Contexto de la época

CONCEPTO: "Mitosis celular" (proceso biológico)
✅ Secciones: 💡 Lo esencial → 📋 Pasos → 🔬 Cómo funciona → 🧩 Ejemplo → ✨ Para recordarlo

CONCEPTO: "Super Bowl LI" (evento)
✅ Secciones: 💡 Lo esencial → 📅 Cuándo y dónde → 💥 Impacto → 🔢 Datos clave → ✨ Para recordarlo

CONCEPTO: "Estrategia de marketing de Apple" (caso de negocio)
✅ Secciones: 💡 Lo esencial → 🚀 Aplicaciones reales → 💥 Impacto → 🎯 Por qué importa → ✨ Para recordarlo

CONCEPTO: "Teorema de Pitágoras" (fórmula matemática)
✅ Secciones: 💡 Lo esencial → ⚗️ Fórmula → 🧩 Ejemplo → ⚙️ Cómo se aplica → ✨ Para recordarlo

═══════════════════════════════════════════
REGLA #3 — CALIDAD DEL CONTENIDO
═══════════════════════════════════════════
- USA ÚNICAMENTE el material como fuente. NO inventes.
- Datos REALES: nombres, fechas, números, citas EXACTAS del material.
- Si el material no cubre algo, OMITE esa sección entera (no rellenes con humo).
- Cada sección debe aportar información DIFERENTE (no repitas lo mismo en distintas secciones).
- Sé claro, directo, pedagógico. Como un profesor real, no como un robot de plantilla.

═══════════════════════════════════════════
REGLA #4 — FORMATO
═══════════════════════════════════════════
- Cada sección empieza con "## emoji Título" en línea propia
- Después del título, salto de línea, y el contenido en párrafo natural
- Entre secciones, DOBLE salto de línea
- Si una sección tiene lista de pasos: usa "1. Paso uno." en líneas separadas
- Si una sección tiene tabla comparativa: usa markdown | ... | ... |
- Si citas el material: usa formato > "cita textual"
- Usa **negrita** para términos clave dentro del texto

═══════════════════════════════════════════
CONCEPTO A ENSEÑAR
═══════════════════════════════════════════
Concepto: "${current.label}"
Categoría: "${parentNode?.label || 'General'}"
Pista breve previa: "${current.description || 'Sin descripción previa'}"

Ahora: analiza qué tipo de concepto es, elige las 3-6 secciones MÁS ÚTILES del catálogo, y enseña este concepto usando SOLO el material. NO sigas una plantilla fija. Adapta tu respuesta al concepto específico.`;

    fetch('/api/alai-studyal-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        message: pregunta,
        materialText: materialText,
        history: [],
        materia: materia || '',
        tema: tema || '',
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled || attemptRef.current[current.id] !== attempt) return;
        if (data.success && data.answer) {
          const result: StudyMapExplanationState = {
            answer: data.answer,
            inMaterial: data.inMaterial,
            outsideMaterialNote: data.outsideMaterialNote || '',
            sourcePages: data.sourcePages || [],
            suggestedFollowups: data.suggestedFollowups || [],
          };
          onPersistExplanation(current.id, result);
          setExplicacion(result);
        } else {
          setErrExp(data.error || 'No se pudo generar la explicación');
        }
      })
      .catch(e => {
        if (!cancelled && attemptRef.current[current.id] === attempt) {
          setErrExp(e?.message || 'Error de conexión');
        }
      })
      .finally(() => {
        if (!cancelled && attemptRef.current[current.id] === attempt) {
          setLoadingExp(false);
        }
      });

    return () => { cancelled = true; };
  }, [current.id, current.label, current.description, parentNode?.label, showingRoot, materialText, materia, tema, explanationsByNodeId, onPersistExplanation]);

  const Section = ({ icon, title, color: c, children }: any) => (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 800, color: c || color, letterSpacing: 1.2,
        textTransform: 'uppercase', fontFamily: "'Inter', sans-serif",
        marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 13 }}>{icon}</span> {title}
      </div>
      <div style={{
        fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.65,
        fontFamily: "'Inter', sans-serif",
      }}>
        {children}
      </div>
    </div>
  );

  // Mobile: overlay drawer when node selected, hidden otherwise
  if (isMobile && !node) return null;

  return (
    <aside style={{
      ...(isMobile ? {
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        width: '100%',
        maxWidth: '100vw',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        overflowX: 'hidden',
      } : {
        width: 440,
        flexShrink: 0,
        background: 'var(--bg-card)',
        borderLeft: '1.5px solid var(--border-color2)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }),
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--border-color2)',
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} 14%, var(--bg-card)), var(--bg-card))`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color, letterSpacing: 1.5,
            textTransform: 'uppercase', fontFamily: "'Inter', sans-serif",
          }}>
            📚 {typeLabel}
          </div>
          {(isMobile || !showingRoot) && (
            <button onClick={onClose} title="Cerrar"
              style={{
                width: 26, height: 26, borderRadius: 6, border: 'none',
                background: 'var(--bg-secondary)', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 14, fontWeight: 700,
              }}>✕</button>
          )}
        </div>

        {breadcrumb.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
            marginTop: 8, fontSize: 11, color: 'var(--text-faint)',
            fontFamily: "'Inter', sans-serif",
          }}>
            {breadcrumb.map((b) => (
              <span key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => onJumpToNode(b)} style={{
                  background: 'transparent', border: 'none',
                  color: b.color || 'var(--text-muted)', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, padding: '2px 4px',
                  fontFamily: "'Inter', sans-serif",
                }}>
                  {b.emoji} {b.label}
                </button>
                <span style={{ opacity: 0.5 }}>›</span>
              </span>
            ))}
          </div>
        )}

        <div style={{
          fontSize: 22, fontWeight: 900, color: 'var(--text-primary)',
          fontFamily: "'Inter', sans-serif", marginTop: 10, lineHeight: 1.2,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          {current.emoji && <span style={{ fontSize: 28, lineHeight: 1 }}>{current.emoji}</span>}
          <span style={{ flex: 1 }}>{current.label}</span>
        </div>

        {current.page && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 10px', borderRadius: 999, marginTop: 10,
            background: `color-mix(in srgb, ${color} 18%, var(--bg-card))`,
            border: `1px solid ${color}`,
            fontSize: 11, fontWeight: 700, color,
            fontFamily: "'Inter', sans-serif",
          }}>
            📄 Página {current.page}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '20px 22px',
        display: 'flex', flexDirection: 'column', gap: 22,
      }}>
        {/* Root: estado introductorio */}
        {showingRoot && (
          <>
            {current.description && (
              <Section icon="✨" title="Sobre este tema">
                {current.description}
              </Section>
            )}
            <div style={{
              padding: '14px 16px', borderRadius: 12,
              background: 'color-mix(in srgb, var(--gold) 8%, var(--bg-card2))',
              border: '1.5px dashed var(--gold)',
              fontSize: 13, color: 'var(--text-muted)',
              fontFamily: "'Inter', sans-serif", lineHeight: 1.65,
            }}>
              🎯 <strong style={{ color: 'var(--text-primary)' }}>Click en cualquier concepto del mapa</strong> y aquí aparecerá la explicación profunda de ALAI: definición, ejemplo, por qué importa y trucos para recordarlo.
            </div>
          </>
        )}

        {/* Cargando explicación */}
        {!showingRoot && loadingExp && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 14, padding: '40px 20px',
            color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif",
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              border: `3px solid ${color}33`,
              borderTopColor: color,
              animation: 'sm-spin 0.8s linear infinite',
            }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>ALAI está preparando la explicación...</div>
            <style>{`@keyframes sm-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Error */}
        {!showingRoot && errExp && !loadingExp && (
          <div style={{
            padding: '14px 16px', borderRadius: 12,
            background: 'rgba(239,68,68,0.1)',
            border: '1.5px solid rgba(239,68,68,0.4)',
            color: '#fca5a5', fontSize: 13, fontFamily: "'Inter', sans-serif",
          }}>
            ⚠️ {errExp}
          </div>
        )}

        {/* Explicación generada por ALAI Chat real */}
        {!showingRoot && explicacion && !loadingExp && (
          <>
            <AlaiMarkdown text={explicacion.answer || ''} color={color} />

            {explicacion.sourcePages && explicacion.sourcePages.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                padding: '8px 12px', borderRadius: 10,
                background: `color-mix(in srgb, ${color} 8%, var(--bg-card2))`,
                border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
              }}>
                <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>
                  📄 Fuentes:
                </span>
                {explicacion.sourcePages.map((p: number) => (
                  <span key={p} style={{
                    padding: '2px 8px', borderRadius: 999,
                    background: `color-mix(in srgb, ${color} 18%, var(--bg-card))`,
                    border: `1px solid ${color}`,
                    fontSize: 11, fontWeight: 700, color,
                    fontFamily: "'Inter', sans-serif",
                  }}>
                    p.{p}
                  </span>
                ))}
              </div>
            )}


          </>
        )}


      </div>

      {/* Footer */}
      <div style={{
        padding: '10px 18px',
        borderTop: '1px solid var(--border-color2)',
        background: 'var(--bg-card2)',
        fontSize: 11, color: 'var(--text-faint)',
        fontFamily: "'Inter', sans-serif",
        textAlign: 'center',
        flexShrink: 0,
      }}>
        💬 Pregúntale a ALAI sobre este tema en el chat
      </div>
    </aside>
  );
}

// ════════════════════════════════════════════════
// LOADING
// ════════════════════════════════════════════════

const LOAD_STEPS = [
  { emoji: '📄', label: 'Leyendo materiales...' },
  { emoji: '🧩', label: 'Identificando conceptos clave...' },
  { emoji: '🌿', label: 'Construyendo ramas temáticas...' },
  { emoji: '✍️', label: 'Escribiendo explicaciones...' },
  { emoji: '✨', label: 'Finalizando mapa mental...' },
];

// ════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════

type ViewMode = 'map' | 'cards' | 'outline';

export default function ALAIStudyMap({ materiales, seleccion, tema, materia, onBack, masteryContext, sessionId, sourceSelection }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapData, setMapData] = useState<MindMapData | null>(null);
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [view, setView] = useState<ViewMode>('map');
  const [exportMsg, setExportMsg] = useState('');
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const [lastExpandedId, setLastExpandedId] = useState<string | null>(null);
  const [materialText, setMaterialText] = useState<string>('');
  const [studiedSet, setStudiedSet] = useState<Set<string>>(new Set());
  const [showGuidedTour, setShowGuidedTour] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const isMobile = useIsMobile();

  const effectiveSourceSelection = useMemo(
    () => sourceSelection || buildSourceSelectionFromMaterials(materiales, seleccion),
    [sourceSelection, materiales, seleccion],
  );
  const { result: authorizedSource, status: authorizedStatus, error: authorizedError } = useAuthorizedSource(effectiveSourceSelection, 'ALAIStudyMap');
  const fingerprint = effectiveSourceSelection.fingerprint;
  const generationAttemptRef = useRef(0);
  const persistedStateRef = useRef<DurableFreeStudyMapState>(initialFreeStudyMapState());

  const persistState = useCallback((nextState: DurableFreeStudyMapState) => {
    persistedStateRef.current = nextState;
    writeFreeToolState(sessionId, fingerprint, 'studymap', nextState);
  }, [sessionId, fingerprint]);

  const persistPatch = useCallback((patch: Partial<Pick<
    DurableFreeStudyMapState,
    'studiedNodeIds' | 'expandedNodeIds' | 'selectedNodeId' | 'view' | 'showGuidedTour' | 'tourIndex' | 'explanationsByNodeId'
  >>) => {
    const nextState = updateFreeStudyMapState(persistedStateRef.current, patch);
    persistState(nextState);
  }, [persistState]);

  const applyPersistedState = useCallback((state: DurableFreeStudyMapState, combinedText: string) => {
    persistedStateRef.current = state;
    setMaterialText(combinedText);
    setMapData((state.mapData as MindMapData | null) || null);

    const rootId = state.mapData?.root?.id;
    const expandedIds = state.expandedNodeIds.length > 0
      ? state.expandedNodeIds
      : rootId
      ? [rootId]
      : [];
    setExpandedSet(new Set(expandedIds));
    setStudiedSet(new Set(state.studiedNodeIds || []));
    setView((state.view || 'map') as ViewMode);
    setShowGuidedTour(Boolean(state.showGuidedTour));
    setTourIndex(Number.isFinite(state.tourIndex) ? state.tourIndex : 0);

    const restoredSelected = state.mapData
      ? findNodeById(state.mapData.root as MapNode, state.selectedNodeId)
      : null;
    setSelectedNode(restoredSelected);
    setError(state.status === 'recoverable' ? state.error || null : null);
  }, []);

  const resetAndReload = useCallback(() => {
    const cleared = initialFreeStudyMapState();
    persistedStateRef.current = cleared;
    writeFreeToolState(sessionId, fingerprint, 'studymap', cleared);
    setMapData(null);
    setSelectedNode(null);
    setExpandedSet(new Set());
    setStudiedSet(new Set());
    setShowGuidedTour(false);
    setTourIndex(0);
    setLastExpandedId(null);
    setError(null);
    setLoading(true);
    setReloadToken(value => value + 1);
  }, [sessionId, fingerprint]);

  useEffect(() => {
    if (!loading) return;
    const intv = setInterval(() => setStepIdx(i => (i + 1) % LOAD_STEPS.length), 1500);
    return () => clearInterval(intv);
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    let startedAttempt: number | null = null;

    const run = async () => {
      try {
        if (authorizedStatus === 'loading' || authorizedStatus === 'idle') return;
        if (authorizedStatus === 'error' || !authorizedSource) {
          setError(authorizedError || 'No se pudo resolver la fuente autorizada.');
          setLoading(false);
          return;
        }

        const combinedText = authorizedSource.combinedText;
        let restoredState = initialFreeStudyMapState();
        const restoredEnvelope = readFreeToolState<DurableFreeStudyMapState>(sessionId, fingerprint, 'studymap');

        if (restoredEnvelope?.state) {
          restoredState = recoverInterruptedFreeStudyMap(restoredEnvelope.state);
          if (restoredState !== restoredEnvelope.state) {
            persistState(restoredState);
          } else {
            persistedStateRef.current = restoredState;
          }
        } else {
          persistedStateRef.current = restoredState;
        }

        if (cancelled) return;

        if (restoredState.mapData) {
          applyPersistedState(restoredState, combinedText);
          setLoading(false);
          return;
        }

        if (restoredState.status === 'recoverable' && !restoredState.mapData) {
          persistedStateRef.current = restoredState;
          setMaterialText(combinedText);
          setMapData(null);
          setSelectedNode(null);
          setExpandedSet(new Set());
          setStudiedSet(new Set(restoredState.studiedNodeIds || []));
          setView((restoredState.view || 'map') as ViewMode);
          setShowGuidedTour(Boolean(restoredState.showGuidedTour));
          setTourIndex(Number.isFinite(restoredState.tourIndex) ? restoredState.tourIndex : 0);
          setError(restoredState.error || 'La generación se interrumpió. Puedes reintentar.');
          setLoading(false);
          return;
        }

        const started = beginFreeStudyMap(restoredState);
        generationAttemptRef.current = started.attempt;
        startedAttempt = started.attempt;
        persistState(started);

        setLoading(true);
        setError(null);
        setMaterialText(combinedText);

        const res = await fetch('/api/alai-studyal-map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            texto: combinedText,
            materia: materia?.nombre || materia?.name || '',
            tema: tema?.nombre || tema?.name || '',
            masteryContext,
          }),
        });

        if (cancelled) return;

        const data = await res.json();

        if (cancelled || generationAttemptRef.current !== started.attempt) return;

        if (!data.success || !data.mapa) {
          const failed = failFreeStudyMap(
            persistedStateRef.current,
            started.attempt,
            data.error || 'No se pudo generar el mapa mental.',
          );
          persistState(failed);
          startedAttempt = null;
          setError(data.error || 'No se pudo generar el mapa mental.');
          setLoading(false);
          return;
        }

        const assignIds = (node: any, level = 0, colorIndex = 0): MapNode => {
          const color = level === 0 ? '#d6b26f' : BRANCH_COLORS[colorIndex % BRANCH_COLORS.length];
          return {
            ...node,
            id: node.id || uid(),
            color: node.color || color,
            children: (node.children || []).map((child: any, ci: number) =>
              assignIds(child, level + 1, level === 0 ? ci : colorIndex)
            ),
          };
        };

        const mapa: MindMapData = { ...data.mapa, root: assignIds(data.mapa.root) };

        const completed = completeFreeStudyMap(
          persistedStateRef.current,
          started.attempt,
          mapa as any,
        );
        persistState(completed);
        startedAttempt = null;
        applyPersistedState(completed, combinedText);
        setLoading(false);
      } catch (e: any) {
        const failed = failFreeStudyMap(
          persistedStateRef.current,
          generationAttemptRef.current,
          e?.message || 'Error de conexión',
        );
        persistState(failed);
        startedAttempt = null;
        if (!cancelled) {
          setError(e?.message || 'Error de conexión');
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
      // This effect invocation started a generation but never reached a
      // terminal state (React StrictMode double-invoke, or a genuine fast
      // unmount) — revert the 'generating' write so the next mount starts
      // clean instead of reporting a false "interrupted" error.
      if (startedAttempt !== null) persistState(abandonFreeStudyMap(persistedStateRef.current, startedAttempt));
    };
  }, [
    sessionId,
    fingerprint,
    authorizedStatus,
    authorizedSource,
    authorizedError,
    materia?.nombre,
    materia?.name,
    tema?.nombre,
    tema?.name,
    masteryContext,
    reloadToken,
    persistState,
    applyPersistedState,
  ]);

  const handleExport = () => {
    if (!mapData) return;
    const text = JSON.stringify(mapData, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studymap-${(mapData.title || 'mapa').toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMsg('✓ Exportado');
    setTimeout(() => setExportMsg(''), 2000);
  };

  const toggleExpand = useCallback((id: string) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        const findAndRemoveDescendants = (node: MapNode) => {
          next.delete(node.id);
          (node.children || []).forEach(findAndRemoveDescendants);
        };
        if (mapData) {
          const target = findNodeById(mapData.root, id);
          if (target) findAndRemoveDescendants(target);
        } else {
          next.delete(id);
        }
      } else {
        next.add(id);
      }
      persistPatch({ expandedNodeIds: [...next] });
      return next;
    });
    setLastExpandedId(id);
  }, [mapData, persistPatch]);

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32, zIndex: 9999 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>🗺️</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--gold)', fontFamily: "'Inter', sans-serif" }}>Generando Study Map</div>
          <div style={{ fontSize: 14, color: 'var(--text-faint)', fontFamily: "'Inter', sans-serif", marginTop: 6 }}>ALAI está leyendo y organizando el 100% del material</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 320 }}>
          {LOAD_STEPS.map((s, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 16px', borderRadius: 12,
                background: active ? 'color-mix(in srgb, var(--gold) 15%, transparent)' : 'transparent',
                border: active ? '1.5px solid var(--gold)' : '1px solid transparent',
              }}>
                <span style={{ fontSize: 20, opacity: done ? 0.5 : 1 }}>{done ? '✅' : active ? s.emoji : '⬜'}</span>
                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: active ? 'var(--gold)' : done ? 'var(--text-faint)' : 'var(--text-faint)', fontWeight: active ? 700 : 500, flex: 1 }}>{s.label}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-faint)', fontFamily: "'Inter', sans-serif", fontStyle: 'italic' }}>puede tardar 30-60 segundos ✨</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, zIndex: 9999, padding: 24 }}>
        <div style={{ fontSize: 48 }}>😅</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif" }}>No se pudo generar el mapa</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 420, textAlign: 'center', fontFamily: "'Inter', sans-serif" }}>{error}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={resetAndReload} style={{ padding: '10px 24px', borderRadius: 12, border: '2px solid var(--gold)', background: 'var(--bg-card)', color: 'var(--gold)', fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>↻ Reintentar</button>
          <button onClick={onBack} style={{ padding: '10px 24px', borderRadius: 12, border: '2px solid var(--text-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '3px 4px 0 var(--text-primary)' }}>← Volver al proceso</button>
        </div>
      </div>
    );
  }

  if (!mapData) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f8f6f0', display: 'flex', flexDirection: 'column', zIndex: 9999 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14,
        padding: isMobile ? '8px 12px' : '12px 20px',
        background: 'var(--bg-card)',
        borderBottom: '1.5px solid var(--border-color2)',
        flexShrink: 0, zIndex: 10,
        overflowX: 'hidden',
        flexWrap: 'nowrap',
      }}>
        <button onClick={onBack} style={{
          border: '2px solid var(--text-primary)', background: 'var(--bg-card)',
          color: 'var(--text-primary)', borderRadius: 12, padding: '8px 14px',
          fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
          boxShadow: '3px 4px 0 var(--text-primary)',
        }}>← volver al proceso</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--gold)', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            🗺️ {mapData.title}
          </div>
          {mapData.summary && (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {mapData.summary}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border-color2)' }}>
          {([
            { key: 'map', label: '🗺️ Mapa' },
            { key: 'cards', label: '🎴 Cards' },
            { key: 'outline', label: '📋 Outline' },
          ] as { key: ViewMode; label: string }[]).map(v => (
            <button key={v.key} onClick={() => {
              setView(v.key);
              setSelectedNode(null);
              persistPatch({ view: v.key, selectedNodeId: null });
            }}
              style={{
                padding: '6px 12px', borderRadius: 9, border: 'none',
                background: view === v.key ? 'var(--gold)' : 'transparent',
                color: view === v.key ? '#0a0a0c' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
              }}>{v.label}</button>
          ))}
        </div>

        <button
          onClick={() => {
            if (!mapData) return;
            const allNodes: MapNode[] = [];
            const traverse = (n: MapNode) => {
              allNodes.push(n);
              (n.children || []).forEach(traverse);
            };
            traverse(mapData.root);
            const all = new Set<string>();
            allNodes.forEach(n => all.add(n.id));
            const first = allNodes[0] || null;
            setExpandedSet(all);
            setShowGuidedTour(true);
            setTourIndex(0);
            if (first) {
              setSelectedNode(first);
              setLastExpandedId(first.id);
            }
            persistPatch({
              expandedNodeIds: [...all],
              showGuidedTour: true,
              tourIndex: 0,
              selectedNodeId: first?.id || null,
            });
          }}
          title="Lectura guiada"
          style={{
            padding: '7px 13px', borderRadius: 10,
            border: showGuidedTour ? '1.5px solid var(--gold)' : '1.5px solid var(--border-color2)',
            background: showGuidedTour ? 'color-mix(in srgb, var(--gold) 15%, transparent)' : 'transparent',
            color: showGuidedTour ? 'var(--gold)' : 'var(--text-muted)',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
          }}
        >🔊 Tour</button>

        <button
          onClick={() => {
            if (!confirm('¿Regenerar el mapa con un análisis nuevo? El actual se perderá.')) return;
            resetAndReload();
          }}
          title="Regenerar mapa"
          style={{
            padding: '7px 13px', borderRadius: 10,
            border: '1.5px solid var(--border-color2)',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
          }}
        >🔁 Regenerar</button>

        {mapData.totalConcepts && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 999,
            background: studiedSet.size > 0 ? 'color-mix(in srgb, #10b981 15%, var(--bg-card))' : 'color-mix(in srgb, var(--gold) 15%, var(--bg-card))',
            border: studiedSet.size > 0 ? '1.5px solid #10b981' : '1.5px solid var(--gold)',
            fontSize: 12, fontWeight: 700, color: studiedSet.size > 0 ? '#10b981' : 'var(--gold)', fontFamily: "'Inter', sans-serif",
          }}>
            {studiedSet.size > 0 && <span>✓</span>}
            {studiedSet.size} / {mapData.totalConcepts + 1}
          </div>
        )}

        <button onClick={handleExport} style={{
          padding: '7px 13px', borderRadius: 10,
          border: '1.5px solid var(--border-color2)', background: 'transparent',
          color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
        }}>{exportMsg || '↓ Exportar'}</button>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
        {view === 'map' && (
          <div style={{ display: 'flex', width: '100%', height: '100%', overflowX: 'hidden' }}>
            <div style={{ flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden' }}>
              <MindMap
                data={mapData}
                selectedId={selectedNode?.id || null}
                onSelect={(n) => {
                  setSelectedNode(n);
                  setStudiedSet(prev => {
                    const next = new Set(prev);
                    next.add(n.id);
                    persistPatch({
                      selectedNodeId: n.id,
                      studiedNodeIds: [...next],
                    });
                    return next;
                  });
                }}
                expandedSet={expandedSet}
                onToggleExpand={toggleExpand}
                focusNodeId={lastExpandedId}
                studiedSet={studiedSet}
              />
            </div>
            <StudyPanel
              node={selectedNode}
              mapData={mapData}
              onClose={() => {
                setSelectedNode(null);
                persistPatch({ selectedNodeId: null });
              }}
              onJumpToNode={(n) => {
                setSelectedNode(n);
                setLastExpandedId(n.id);
                persistPatch({ selectedNodeId: n.id });
              }}
              materialText={materialText}
              materia={materia?.nombre || materia?.name || ''}
              tema={tema?.nombre || tema?.name || ''}
              explanationsByNodeId={persistedStateRef.current.explanationsByNodeId || {}}
              onPersistExplanation={(nodeId, explanation) => {
                persistPatch({
                  explanationsByNodeId: {
                    ...(persistedStateRef.current.explanationsByNodeId || {}),
                    [nodeId]: explanation,
                  },
                });
              }}
              isMobile={isMobile}
            />

            {showGuidedTour && mapData && (() => {
              const allNodes: MapNode[] = [];
              const traverse = (n: MapNode) => {
                allNodes.push(n);
                (n.children || []).forEach(traverse);
              };
              traverse(mapData.root);
              const total = allNodes.length;
              const current = allNodes[tourIndex];
              const progress = Math.round(((tourIndex + 1) / total) * 100);

              const goTo = (idx: number) => {
                if (idx < 0 || idx >= total) return;
                setTourIndex(idx);
                const n = allNodes[idx];
                if (n) {
                  setSelectedNode(n);
                  setLastExpandedId(n.id);
                  persistPatch({
                    tourIndex: idx,
                    showGuidedTour: true,
                    selectedNodeId: n.id,
                  });
                }
              };

              return (
                <div style={{
                  position: 'absolute',
                  bottom: 24, left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--bg-card)',
                  border: '2px solid var(--gold)',
                  borderRadius: 16,
                  padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.5), 0 0 20px color-mix(in srgb, var(--gold) 30%, transparent)',
                  zIndex: 100,
                }}>
                  <button onClick={() => goTo(tourIndex - 1)} disabled={tourIndex === 0}
                    style={{
                      width: 32, height: 32, borderRadius: 8,
                      border: '1.5px solid var(--border-color2)',
                      background: 'transparent', color: tourIndex === 0 ? 'var(--text-faint)' : 'var(--text-primary)',
                      cursor: tourIndex === 0 ? 'default' : 'pointer',
                      fontSize: 14, fontWeight: 800, opacity: tourIndex === 0 ? 0.4 : 1,
                    }}>←</button>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 180 }}>
                    <div style={{
                      fontSize: 10, color: 'var(--text-faint)', fontWeight: 700,
                      fontFamily: "'Inter', sans-serif", letterSpacing: 1,
                    }}>
                      🔊 LECTURA GUIADA · {tourIndex + 1} / {total}
                    </div>
                    <div style={{
                      fontSize: 13, color: 'var(--text-primary)', fontWeight: 700,
                      fontFamily: "'Inter', sans-serif", marginTop: 2,
                      maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {current?.emoji} {current?.label}
                    </div>
                    <div style={{
                      width: '100%', height: 3, background: 'var(--bg-secondary)',
                      borderRadius: 999, marginTop: 6, overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${progress}%`, height: '100%',
                        background: 'var(--gold)', transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>

                  <button onClick={() => goTo(tourIndex + 1)} disabled={tourIndex >= total - 1}
                    style={{
                      width: 32, height: 32, borderRadius: 8,
                      border: '1.5px solid var(--gold)',
                      background: 'color-mix(in srgb, var(--gold) 20%, transparent)',
                      color: tourIndex >= total - 1 ? 'var(--text-faint)' : 'var(--gold)',
                      cursor: tourIndex >= total - 1 ? 'default' : 'pointer',
                      fontSize: 14, fontWeight: 800, opacity: tourIndex >= total - 1 ? 0.4 : 1,
                    }}>→</button>

                  <button onClick={() => {
                    setShowGuidedTour(false);
                    setTourIndex(0);
                    persistPatch({ showGuidedTour: false, tourIndex: 0 });
                  }}
                    title="Salir del tour"
                    style={{
                      width: 32, height: 32, borderRadius: 8,
                      border: '1.5px solid var(--border-color2)',
                      background: 'transparent', color: 'var(--text-muted)',
                      cursor: 'pointer', fontSize: 14, fontWeight: 700, marginLeft: 4,
                    }}>✕</button>
                </div>
              );
            })()}
          </div>
        )}
        {view === 'cards' && <CardsView data={mapData} />}
        {view === 'outline' && <OutlineView data={mapData} />}
      </div>

      <div style={{
        padding: '8px 20px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-color2)',
        display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0,
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: "'Inter', sans-serif" }}>
          {materiales.length} {materiales.length === 1 ? 'material' : 'materiales'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: "'Inter', sans-serif" }}>
          {(mapData.root.children || []).length} ramas
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: "'Inter', sans-serif", fontStyle: 'italic' }}>
          Generado por ALAI · 100% del contenido
        </div>
      </div>
    </div>
  );
}
