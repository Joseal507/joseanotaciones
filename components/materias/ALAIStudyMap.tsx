'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import katex from 'katex';
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
  type StudyMapGroundingMetadata,
} from '../../lib/freeStudyMapState';
import {
  isBrainEnrichingResponse, shouldContinuePreparation, toolPreparationMessage,
  TOOL_PREPARATION_POLL_MS,
} from '../../lib/materialBrain/toolPreparation';

// Stable fallback identity — a fresh `{}` literal inline in JSX would be
// a new object every render, which is exactly the kind of unstable prop
// identity STUDYMAP_NODE_PROVIDER_LOOP was caused by.
const EMPTY_EXPLANATIONS_BY_NODE_ID: Record<string, StudyMapExplanationState> = {};

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
  grounding?: StudyMapGroundingMetadata;
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
  // STUDYMAP_SMOOTH_LOCAL_NAVIGATION perf fix: transform/bounds are now
  // REFS, not raw values. Before this fix, passing the raw `transform`
  // object (recreated by every setTransform call) as a normal parameter
  // put it in this effect's dependency array — during a camera
  // animation that meant this ENTIRE effect tore down and rebuilt on
  // EVERY animation frame (cancelling+restarting the rAF loop, removing
  // +re-adding a window resize listener, and — worst of all — calling
  // resize()'s canvas.parentElement.getBoundingClientRect(), a
  // synchronous forced layout reflow, up to 60 times per second). The
  // loop already redraws every frame on its own; it only ever needed
  // the LATEST transform/bounds value at draw time, never a reason to
  // restart. Reading through refs decouples "value changes" from
  // "effect re-runs" entirely — confirmed root cause of the reported
  // jank (see STUDYMAP_SMOOTH_LOCAL_NAVIGATION final report).
  transformRef: React.MutableRefObject<{ x: number; y: number; scale: number }>,
  boundsRef: React.MutableRefObject<{ minX: number; minY: number }>,
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

    const toScreen = (x: number, y: number) => {
      const t = transformRef.current;
      const b = boundsRef.current;
      return { x: t.x + (x - b.minX) * t.scale, y: t.y + (y - b.minY) * t.scale };
    };

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
  // transformRef/boundsRef are stable ref OBJECTS (their .current mutates,
  // but the ref itself never changes identity) — correctly excluded from
  // this effect's re-run triggers; only `lines` (a genuinely new node/edge
  // set) should ever restart the loop.
  }, [lines, canvasRef, chargeState, transformRef, boundsRef]);
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

// STUDYMAP_UX_PHASE1: ~15-18% more compact than before (was
// {0:320,1:280,2:260,3:220} / {0:130,1:110,2:95,3:75} / H_GAP:120 /
// V_GAP_BRANCH:60 / V_GAP_LEAF:18 / V_GAP_DETAIL:12) — pure presentation
// constants, no effect on node identity/topology. Tune further only
// after a live visual check; kept conservative here to avoid text
// wrapping regressions.
const NODE_WIDTHS = { 0: 270, 1: 235, 2: 215, 3: 185 };
const NODE_HEIGHTS = { 0: 112, 1: 95, 2: 82, 3: 66 };
const H_GAP = 100;
const V_GAP_LEAF = 15;
const V_GAP_BRANCH = 50;
const V_GAP_DETAIL = 10;

export interface FitTransform { x: number; y: number; scale: number }
export interface ViewportRect { width: number; height: number }

/**
 * GUIDED_STUDYMAP: stable, readable study-zoom target PER NODE TYPE
 * (level 0=root, 1=branch, 2=leaf, 3=detail) — deliberately fixed
 * constants, never derived from svgW/svgH/bounds, so a node's
 * readability never depends on how many other branches have already
 * been revealed elsewhere in the map. Exported for direct contract
 * testing (no rendering needed).
 */
export const READABLE_SCALE_BY_LEVEL: Record<0 | 1 | 2 | 3, number> = {
  0: 0.85, // root/category overview — medium zoom
  1: 1.0,  // branch — medium-close zoom
  2: 1.25, // leaf/concept — close, readable zoom
  3: 1.3,  // detail — closest, readable zoom
};

// STUDYMAP_NAVIGABLE_VIEWPORT_FIT: MAX_GUIDED_SCALE still caps over-zoom
// (a sparse neighborhood must never zoom in tighter than this just
// because it technically fits). MIN_GUIDED_SCALE is now a PREFERENCE,
// not a hard floor — navigation completeness has priority: if the local
// navigable set does not fit at MIN_GUIDED_SCALE with the current
// (possibly panel-narrowed) viewport, computeGuidedFramingTransform
// goes BELOW it rather than clip a navigable node. Exported so both the
// preference and the override are directly contract-testable.
export const MIN_GUIDED_SCALE = 0.85;
export const MAX_GUIDED_SCALE = 1.3;

// STUDYMAP_NAVIGABLE_VIEWPORT_FIT: fixed-pixel safety margin around the
// navigable bounds (distinct from the multiplicative `padding` factor
// below) — a node whose edge lands EXACTLY at the viewport boundary is
// "inside" by the numbers but reads as visually clipped (shadow/stroke
// overhang, rounding). This margin is subtracted from the viewport
// before fitting, not from the final render, so it applies uniformly
// regardless of chosen scale.
export const NAVIGABLE_EDGE_PADDING_PX = 24;

export interface GuidedNeighborhoodMember { id: string; x: number; y: number; width: number; height: number }

/**
 * STUDYMAP_NAVIGABLE_VIEWPORT_FIT: replaces the old single-node fixed-
 * readable-scale target. Instead of framing ONLY the selected node,
 * computes the transform that keeps the selected node PLUS its local
 * navigable neighborhood (parent/siblings/children/rendered relation-
 * detail children — whatever the caller passed in `members`, see
 * getNavigableNeighborhoodIds) inside `viewport`.
 *
 * Anchors on the selected node's OWN position (not the neighborhood's
 * bounding-box centroid) — a neighborhood member can extend more on one
 * side than the other, and centering on the bbox centroid would then
 * fail to keep the selected node visually dominant/centered. Instead
 * this computes, per axis, the largest symmetric half-extent any member
 * needs around the selected node (`maxDX`/`maxDY`) and picks the
 * largest scale for which that whole symmetric extent still fits (minus
 * NAVIGABLE_EDGE_PADDING_PX of safety margin) — a deliberately
 * conservative (never-clips) fit, not a tight bbox fit.
 *
 * The result is then capped at this node's own stylistic per-level
 * scale (READABLE_SCALE_BY_LEVEL) — a sparse neighborhood must never
 * zoom in CLOSER than the node's normal readable scale just because it
 * technically could (contract G) — and capped at MAX_GUIDED_SCALE so an
 * unusually dense neighborhood still zooms out only as far as
 * readability allows it to. MIN_GUIDED_SCALE, unlike MAX, is applied
 * ONLY when the neighborhood still fits at that scale — if even
 * MIN_GUIDED_SCALE would clip a navigable node (a dense neighborhood
 * with the panel open, say), the smaller fit-driven scale wins instead
 * (contract F) — navigation completeness always beats a readability
 * preference, never the whole-graph-fit scale though.
 *
 * Pure — no DOM, no layout/topology mutation, no provider work. Members
 * NOT included by the caller (e.g. distant previously-expanded
 * branches) never enter this computation at all, which is what makes
 * them structurally unable to affect guided scale (contract H).
 */
export function computeGuidedFramingTransform(
  members: readonly GuidedNeighborhoodMember[],
  selectedNodeId: string,
  selectedLevel: 0 | 1 | 2 | 3,
  boundsOrigin: { minX: number; minY: number },
  viewport: ViewportRect,
  padding = 0.92,
): FitTransform | null {
  const selected = members.find(m => m.id === selectedNodeId);
  if (!selected || viewport.width <= 0 || viewport.height <= 0) return null;

  let maxDX = 0;
  let maxDY = 0;
  for (const m of members) {
    maxDX = Math.max(maxDX, Math.abs(m.x - selected.x) + m.width / 2);
    maxDY = Math.max(maxDY, Math.abs(m.y - selected.y) + m.height / 2);
  }
  const neededW = Math.max(1, maxDX * 2);
  const neededH = Math.max(1, maxDY * 2);
  const paddedViewportW = Math.max(1, viewport.width - NAVIGABLE_EDGE_PADDING_PX * 2);
  const paddedViewportH = Math.max(1, viewport.height - NAVIGABLE_EDGE_PADDING_PX * 2);
  const fitScale = Math.min(paddedViewportW / neededW, paddedViewportH / neededH) * padding;

  const rawScale = Math.min(READABLE_SCALE_BY_LEVEL[selectedLevel], fitScale);
  // Navigation completeness has priority over the readable-scale floor:
  // only lift a too-small rawScale up to MIN_GUIDED_SCALE when the
  // neighborhood actually fits there — otherwise keep the smaller,
  // fit-driven scale so nothing gets clipped.
  const scale = Math.min(MAX_GUIDED_SCALE, fitScale >= MIN_GUIDED_SCALE ? Math.max(MIN_GUIDED_SCALE, rawScale) : rawScale);

  return {
    x: viewport.width / 2 - (selected.x - boundsOrigin.minX) * scale,
    y: viewport.height / 2 - (selected.y - boundsOrigin.minY) * scale,
    scale,
  };
}

/** Pure — computes the transform that frames an svgW×svgH content box inside a viewport rect. Exported for direct contract testing (STUDYMAP_UX_PHASE1). */
export function computeFitTransform(rect: ViewportRect, svgW: number, svgH: number, maxScale = 1.2, padding = 0.92): FitTransform {
  const scaleX = rect.width / svgW;
  const scaleY = rect.height / svgH;
  const scale = Math.min(scaleX, scaleY, maxScale) * padding;
  return {
    x: (rect.width - svgW * scale) / 2,
    y: (rect.height - svgH * scale) / 2,
    scale,
  };
}

/** Pure — true when the content box (under the given transform) is fully visible inside rect plus a margin. Exported for direct contract testing (STUDYMAP_UX_PHASE1). */
export function isBoundsComfortable(transform: FitTransform, svgW: number, svgH: number, rect: ViewportRect, marginRatio = 0.08): boolean {
  const marginX = rect.width * marginRatio;
  const marginY = rect.height * marginRatio;
  const screenMinX = transform.x;
  const screenMinY = transform.y;
  const screenMaxX = transform.x + svgW * transform.scale;
  const screenMaxY = transform.y + svgH * transform.scale;
  return screenMinX >= -marginX && screenMinY >= -marginY
    && screenMaxX <= rect.width + marginX && screenMaxY <= rect.height + marginY;
}

/**
 * Pure — word-wraps text into at most maxLines lines of at most maxChars
 * each, truncating with an ellipsis where needed (including a single
 * unbroken token longer than a whole line). Exported for direct
 * contract testing (STUDYMAP_LIVE_UX_HARDENING text-overflow fix) — the
 * SVG node renderer additionally clips with an actual <clipPath> so no
 * text can ever escape its node rect regardless of what this returns.
 */
export function wrapNodeText(text: string, maxChars: number, maxLines: number): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const rawWord of words) {
    const w = rawWord.length > maxChars ? rawWord.slice(0, maxChars - 1) + '…' : rawWord;
    if ((current + ' ' + w).trim().length <= maxChars) {
      current = (current + ' ' + w).trim();
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length + 3 && !lines[maxLines - 1].endsWith('…')) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + '…';
  }
  return lines;
}

/**
 * Pure — the exact same tree-layout algorithm previously inlined as
 * MindMap's own useMemo hooks (measureSubtree/layout/bounds), extracted
 * unchanged so it can be contract-tested directly (STUDYMAP_UX_PHASE1).
 * Topology (which nodes/edges exist, their IDs) is entirely determined
 * by `data`/`expandedSet` — this function only computes WHERE to draw
 * them, never what exists.
 */
export function computeMindMapLayout(data: MindMapData, expandedSet: Set<string>): { layout: PositionedNode[]; bounds: { minX: number; maxX: number; minY: number; maxY: number } } {
  const measureSubtree = (node: MapNode, level: number): number => {
    const baseHeight = NODE_HEIGHTS[level as 0 | 1 | 2 | 3] || 80;
    const isExpanded = expandedSet.has(node.id);
    const children = node.children || [];
    if (!isExpanded || children.length === 0) return baseHeight;

    const gap = level === 0 ? V_GAP_BRANCH : level === 1 ? V_GAP_LEAF : V_GAP_DETAIL;
    const childrenHeight = children.reduce((sum, child, i) => {
      return sum + measureSubtree(child, level + 1) + (i > 0 ? gap : 0);
    }, 0);

    return Math.max(baseHeight, childrenHeight);
  };

  const result: PositionedNode[] = [];
  const rootExpanded = expandedSet.has(data.root.id);
  const branches = rootExpanded ? (data.root.children || []) : [];

  const mid = Math.ceil(branches.length / 2);
  const rightBranches = branches.slice(0, mid);
  const leftBranches = branches.slice(mid);

  const totalRightHeight = rightBranches.reduce((sum, b, i) =>
    sum + measureSubtree(b, 1) + (i > 0 ? V_GAP_BRANCH : 0), 0);
  const totalLeftHeight = leftBranches.reduce((sum, b, i) =>
    sum + measureSubtree(b, 1) + (i > 0 ? V_GAP_BRANCH : 0), 0);

  const maxHeight = Math.max(totalRightHeight, totalLeftHeight, NODE_HEIGHTS[0]);
  const centerY = Math.max(maxHeight / 2, 400);
  const centerX = 800;

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

  const placeSubtree = (
    node: MapNode, level: number, side: 'left' | 'right', color: string,
    startY: number, parentX: number, parentY: number,
  ): number => {
    const subtreeHeight = measureSubtree(node, level);
    const nodeY = startY + subtreeHeight / 2;
    const nodeW = NODE_WIDTHS[level as 0 | 1 | 2 | 3] || 220;
    const parentW = NODE_WIDTHS[(level - 1) as 0 | 1 | 2 | 3] || 280;

    const nodeX = side === 'right'
      ? parentX + parentW / 2 + H_GAP + nodeW / 2
      : parentX - parentW / 2 - H_GAP - nodeW / 2;

    result.push({
      node, x: nodeX, y: nodeY, level, side, color, parentX, parentY,
      width: nodeW, height: NODE_HEIGHTS[level as 0 | 1 | 2 | 3] || 80,
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

  let yCursor = centerY - totalRightHeight / 2;
  rightBranches.forEach((branch, i) => {
    if (i > 0) yCursor += V_GAP_BRANCH;
    const color = BRANCH_COLORS[i % BRANCH_COLORS.length];
    const h = placeSubtree(branch, 1, 'right', color, yCursor, centerX, centerY);
    yCursor += h;
  });

  yCursor = centerY - totalLeftHeight / 2;
  leftBranches.forEach((branch, i) => {
    if (i > 0) yCursor += V_GAP_BRANCH;
    const color = BRANCH_COLORS[(i + rightBranches.length) % BRANCH_COLORS.length];
    const h = placeSubtree(branch, 1, 'left', color, yCursor, centerX, centerY);
    yCursor += h;
  });

  const layout = result;
  let bounds: { minX: number; maxX: number; minY: number; maxY: number };
  if (layout.length === 0) {
    bounds = { minX: 0, maxX: 1600, minY: 0, maxY: 800 };
  } else {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    layout.forEach(n => {
      minX = Math.min(minX, n.x - n.width / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
      minY = Math.min(minY, n.y - n.height / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    });
    bounds = { minX: minX - 80, maxX: maxX + 80, minY: minY - 80, maxY: maxY + 80 };
  }

  return { layout, bounds };
}

function MindMap({
  data,
  selectedId,
  onSelect,
  expandedSet,
  onToggleExpand,
  focusNodeId,
  studiedSet,
  reserveRight = 0,
  reserveBottom = 0,
  guidedMode = true,
  previousNodeId = null,
  onGuidedBack,
}: {
  data: MindMapData;
  selectedId: string | null;
  onSelect: (n: MapNode) => void;
  expandedSet: Set<string>;
  onToggleExpand: (id: string) => void;
  focusNodeId?: string | null;
  studiedSet: Set<string>;
  // STUDYMAP_PATH_NAVIGATION: the node the student navigated FROM (top
  // of the guided navigation stack) — rendered as a compact, screen-
  // space "back anchor" overlay, NEVER as a graph-space camera-bounds
  // member (see getNavigableNeighborhoodIds — this is exactly what was
  // removed from the bounds computation to fix the ~20% zoom-out bug).
  previousNodeId?: string | null;
  onGuidedBack?: () => void;
  // STUDYMAP_UX_PHASE2: pixels of the container's own rect currently
  // covered by a floating/overlay inspector panel (medium-screen
  // floating variant, or a future partial mobile sheet) — the
  // containerRef rect itself does NOT shrink for an overlay panel (it's
  // position:absolute/fixed, not a flex sibling), so without this the
  // focus-camera effect would center a node behind the panel. A
  // desktop sidebar panel (flex sibling) already shrinks the measured
  // rect on its own, so reserveRight/reserveBottom stay 0 for it.
  reserveRight?: number;
  reserveBottom?: number;
  // GUIDED_STUDYMAP: default ON — Study Map is a guided study surface,
  // not a freely pannable technical graph. Disables drag/wheel/manual
  // zoom/fit-to-screen so camera movement is exclusively programmatic
  // (the focus-camera effect below). The manual-camera plumbing itself
  // (manualCameraRef, onMouseDown/onWheel/fitToScreen,
  // computeFitTransform) is intentionally NOT removed — it stays
  // reusable/reachable by setting guidedMode={false} — this prop only
  // gates whether user input can reach it.
  guidedMode?: boolean;
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
  // Layout/bounds computation lives in the pure, exported
  // computeMindMapLayout() (STUDYMAP_UX_PHASE1) — same algorithm as
  // before, just relocated so it's directly contract-testable.
  // STUDYMAP_SMOOTH_LOCAL_NAVIGATION: DEV-only performance diagnostic —
  // counts, never material content. Proves (rather than merely claims)
  // that layout/tree recomputation is per-NAVIGATION, not per-frame, and
  // that a guided animation performs exactly one React state sync.
  const perfRef = useRef({ layoutComputations: 0, transformStateSyncs: 0, activeGuidedAnimations: 0 });
  const { layout, bounds } = useMemo(() => {
    if (process.env.NODE_ENV !== 'production') perfRef.current.layoutComputations++;
    return computeMindMapLayout(data, expandedSet);
  }, [data, expandedSet]);

  // GUIDED_STUDYMAP visual context: presentation-only proximity set for
  // the focused node — itself, its immediate parent, and its direct
  // children. Never removes/hides academic structure (computeMindMapLayout/
  // expandedSet are untouched) — only drives an opacity multiplier below,
  // so "distant" nodes read as de-emphasized while remaining fully present
  // in the DOM/data.
  const focusEmphasisIds = useMemo(
    () => (focusNodeId ? getNavigableNeighborhoodIds(data.root, focusNodeId) : null),
    [data.root, focusNodeId],
  );

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

  // STUDYMAP_SMOOTH_LOCAL_NAVIGATION: the imperative "live" camera value.
  // `transform` (React state) remains the source of truth at REST
  // (drag/wheel/+/-/fitToScreen/smart-fit, and the one sync at the end
  // of a guided animation); `transformRef`/`contentRef` are the hot path
  // DURING a guided animation, written directly every rAF tick with no
  // React state update and therefore no MindMap re-render — see the
  // focus-camera effect below. Kept in sync with `transform` state here
  // so any consumer reading transformRef.current between animations
  // always sees the correct settled value.
  const transformRef = useRef(transform);
  const boundsRef = useRef(bounds);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    transformRef.current = transform;
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    }
  }, [transform.x, transform.y, transform.scale]);
  useLayoutEffect(() => { boundsRef.current = bounds; }, [bounds]);

  useEnergyLines(canvasRef, chargeState, energyLines, transformRef, boundsRef);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // STUDYMAP_UX_PHASE1 smart fit — replaces the old "fit exactly once"
  // guard. Two concerns, handled separately:
  //
  // 1. COORDINATE COMPENSATION: the SVG/canvas draw every node at
  //    (n.x - bounds.minX, n.y - bounds.minY) — expanding/collapsing a
  //    branch anywhere can shift bounds.minX/minY, which would silently
  //    slide EVERY already-visible node under a held-still transform.
  //    Whenever bounds.minX/minY change, we shift transform.x/y by the
  //    exact opposite delta first, so content the user is already
  //    looking at never drifts on its own.
  // 2. COMFORT-ZONE RE-FIT: only actually recenter/rescale the camera
  //    when the (now coordinate-compensated) content no longer fits
  //    comfortably inside the viewport — never blindly on every
  //    expandedSet change — and never at all once the user has taken
  //    manual control (drag/wheel), so their camera is always respected.
  const manualCameraRef = useRef(false);
  const prevBoundsOriginRef = useRef<{ minX: number; minY: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || layout.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const prevOrigin = prevBoundsOriginRef.current;
    prevBoundsOriginRef.current = { minX: bounds.minX, minY: bounds.minY };

    if (prevOrigin === null) {
      // First layout ever rendered — always fit, showing everything
      // currently visible (root + its expanded branches) framed
      // comfortably, never just the root alone.
      setTransform(computeFitTransform(rect, svgW, svgH));
      return;
    }

    if (focusNodeId) {
      // STUDYMAP_LIVE_UX_HARDENING: a selected/focused node owns the
      // camera — the dedicated focus-camera effect below recenters on
      // it explicitly on every layout change. Two effects independently
      // calling setTransform for the same layout change was the exact
      // cause of the selected node ending up awkwardly positioned after
      // branch expansion (this effect's fit and the focus effect's
      // recenter animation racing/overwriting each other). Bounds-origin
      // bookkeeping above is still updated; just don't move the camera here.
      return;
    }

    if (manualCameraRef.current) {
      // The user is in control — only compensate for the coordinate
      // shift (so their current view doesn't silently drift), never
      // recenter/rescale on their behalf.
      const dx = (bounds.minX - prevOrigin.minX)
      const dy = (bounds.minY - prevOrigin.minY)
      if (dx !== 0 || dy !== 0) {
        setTransform(t => ({ ...t, x: t.x - dx * t.scale, y: t.y - dy * t.scale }));
      }
      return;
    }

    setTransform(t => {
      const dx = bounds.minX - prevOrigin.minX;
      const dy = bounds.minY - prevOrigin.minY;
      const compensated = (dx !== 0 || dy !== 0) ? { ...t, x: t.x - dx * t.scale, y: t.y - dy * t.scale } : t;

      // Comfort-zone check: is the ENTIRE content box still visible
      // inside the viewport (with a margin), under the compensated
      // transform? If yes, leave the camera exactly as-is.
      return isBoundsComfortable(compensated, svgW, svgH, rect) ? compensated : computeFitTransform(rect, svgW, svgH);
    });
  }, [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, svgW, svgH, layout.length, focusNodeId]);

  // GUIDED_LOCAL_FRAMING: cámara animada hacia el nodo enfocado — la
  // ÚNICA fuente de verdad para centrar cuando hay un nodo seleccionado
  // (ver el bypass del smart-fit arriba). Ya NO encuadra solo el nodo
  // seleccionado: encuadra el nodo + su vecindario navegable local
  // (focusEmphasisIds — el mismo set que ya maneja la atenuación visual
  // arriba), para que el estudiante siempre vea sus próximas opciones de
  // navegación sin tener que cerrar el panel. Nodos lejanos/expandidos
  // en otras ramas NUNCA entran en `neighborhoodMembers`, así que NUNCA
  // pueden influir en la escala guiada (contrato E). Anima x/y Y scale
  // juntos — nunca hacia un fit-to-all. Se re-ejecuta en cada cambio de
  // layout (expand/collapse) para que el nodo seleccionado siga
  // encuadrado una vez el layout se asienta.
  useEffect(() => {
    if (!focusNodeId || !containerRef.current) return;
    if (manualCameraRef.current) return; // el usuario tiene el control — no le quitamos la cámara
    const node = layout.find(n => n.node.id === focusNodeId);
    if (!node) return;
    const rect = containerRef.current.getBoundingClientRect();
    // "Usable viewport" != el contenedor completo: reserva espacio para
    // la barra de estado inferior y los controles de zoom (siempre
    // presentes, superpuestos dentro de este mismo contenedor) para que
    // el nodo centrado no quede tapado detrás de ellos.
    const BOTTOM_CHROME_RESERVE = 72;
    // STUDYMAP_UX_PHASE2: reserveRight/reserveBottom cover the case the
    // sidebar variant never needed — a floating/overlay inspector that
    // visually covers part of this SAME rect without shrinking it. A
    // sidebar panel (flex sibling) already shrinks rect.width on its
    // own, so both reserves stay 0 for it and this reduces to the
    // original centering behavior.
    const effectiveWidth = Math.max(200, rect.width - reserveRight);
    const effectiveHeight = Math.max(200, rect.height - BOTTOM_CHROME_RESERVE - reserveBottom);

    let targetX: number;
    let targetY: number;
    let nodeTargetScale: number;
    if (guidedMode) {
      // GUIDED_LOCAL_FRAMING: neighborhood = focusEmphasisIds (selected
      // node + immediate parent + direct children — the SAME set the
      // opacity/visual-emphasis logic already uses, so "what looks
      // emphasized" and "what the camera frames" are always the same
      // set by construction). Rendered relation-detail nodes are
      // already ordinary tree children for a leaf (see
      // projectStudyMapToTree), so they are already included here as
      // direct children — no separate relation-edge lookup needed.
      const neighborhoodIds = focusEmphasisIds || new Set([focusNodeId]);
      const neighborhoodMembers: GuidedNeighborhoodMember[] = layout
        .filter(n => neighborhoodIds.has(n.node.id))
        .map(n => ({ id: n.node.id, x: n.x, y: n.y, width: n.width, height: n.height }));
      const framing = computeGuidedFramingTransform(
        neighborhoodMembers, focusNodeId, node.level as 0 | 1 | 2 | 3,
        { minX: bounds.minX, minY: bounds.minY }, { width: effectiveWidth, height: effectiveHeight },
      );
      targetX = framing ? framing.x : effectiveWidth / 2 - (node.x - bounds.minX) * READABLE_SCALE_BY_LEVEL[node.level as 0 | 1 | 2 | 3];
      targetY = framing ? framing.y : effectiveHeight / 2 - (node.y - bounds.minY) * READABLE_SCALE_BY_LEVEL[node.level as 0 | 1 | 2 | 3];
      nodeTargetScale = framing ? framing.scale : READABLE_SCALE_BY_LEVEL[node.level as 0 | 1 | 2 | 3];
    } else {
      nodeTargetScale = transform.scale;
      targetX = effectiveWidth / 2 - (node.x - bounds.minX) * nodeTargetScale;
      targetY = effectiveHeight / 2 - (node.y - bounds.minY) * nodeTargetScale;
    }

    // Animar suavemente. STUDYMAP_SMOOTH_LOCAL_NAVIGATION: read the start
    // point from transformRef (the live imperative value), never from
    // `transform` React state — if a PREVIOUS guided animation was
    // interrupted mid-flight by this same effect re-running (a new
    // navigation started before the old one finished), state only ever
    // gets synced at an animation's natural completion, so it can lag
    // behind exactly where the camera visually stopped. The ref is
    // always current.
    const startX = transformRef.current.x;
    const startY = transformRef.current.y;
    const startScale = transformRef.current.scale;

    // CAMERA_FOCUS_UX: si el nodo ya está prácticamente en la posición
    // Y escala objetivo (re-selección del mismo nodo, o ya estaba bien
    // encuadrado), no animamos nada — evita saltos/parpadeos innecesarios
    // de cámara, y evita un "pulso" de zoom cuando dos nodos vecinos
    // comparten exactamente el mismo nivel/escala objetivo.
    if (Math.abs(targetX - startX) < 1 && Math.abs(targetY - startY) < 1 && Math.abs(nodeTargetScale - startScale) < 0.01) return;
    const dur = 600;
    const t0 = performance.now();
    let raf = 0;
    const isDev = process.env.NODE_ENV !== 'production';
    let frameCount = 0;
    if (isDev) perfRef.current.activeGuidedAnimations++;
    // STUDYMAP_SMOOTH_LOCAL_NAVIGATION perf fix: this used to call
    // setTransform() (React state) on EVERY frame — a full MindMap
    // re-render (re-running the entire layout.map(...) node/edge JSX,
    // recomputing wrapText/colors/emphasis for every rendered node) up
    // to 60 times per second, the dominant cause of the reported jank.
    // The hot path now writes ONLY to transformRef + the DOM node
    // directly (contentRef), completely bypassing React for every
    // intermediate frame. React state is synchronized exactly ONCE, on
    // the final frame — needed for the info-bar %, drag-start baseline,
    // and so the NEXT effect run (next navigation) sees a settled value.
    const tick = (now: number) => {
      if (isDev) frameCount++;
      const t = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      const nx = startX + (targetX - startX) * ease;
      const ny = startY + (targetY - startY) * ease;
      const ns = startScale + (nodeTargetScale - startScale) * ease;
      transformRef.current = { x: nx, y: ny, scale: ns };
      if (contentRef.current) {
        contentRef.current.style.transform = `translate(${nx}px, ${ny}px) scale(${ns})`;
      }
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setTransform({ x: nx, y: ny, scale: ns });
        if (isDev) {
          perfRef.current.transformStateSyncs++;
          // DEV-only diagnostic — counts only, never material content.
          // Proves: layout/tree recompute count stays flat across an
          // animation (no per-frame recompute), exactly one React state
          // sync happens per navigation, and at most one guided
          // animation is ever active at a time.
          console.info('[studymap-camera-perf]', JSON.stringify({
            frames: frameCount,
            renderedNodeCount: layout.length,
            expandedNodeCount: expandedSet.size,
            layoutComputationsTotal: perfRef.current.layoutComputations,
            transformStateSyncsTotal: perfRef.current.transformStateSyncs,
            activeGuidedAnimations: perfRef.current.activeGuidedAnimations,
          }));
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (isDev) perfRef.current.activeGuidedAnimations--;
    };
  }, [focusNodeId, layout, reserveRight, reserveBottom, guidedMode, focusEmphasisIds]);

  // GUIDED_STUDYMAP: in guided mode (the default), every user-driven
  // camera entry point below is a no-op — camera movement becomes
  // exclusively programmatic (the focus-camera effect). The functions
  // themselves are kept intact (not deleted) so a future guidedMode={false}
  // consumer still gets full free-pan/zoom behavior for free.
  const onMouseDown = (e: React.MouseEvent) => {
    if (guidedMode) return;
    if ((e.target as Element).closest('.node-clickable, .expand-btn')) return;
    manualCameraRef.current = true; // user takes control — smart-fit stops recentering on its own
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (guidedMode || !dragging) return;
    setTransform(t => ({
      ...t,
      x: dragStart.current.tx + (e.clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.clientY - dragStart.current.y),
    }));
  };

  const onMouseUp = () => setDragging(false);

  const onWheel = (e: React.WheelEvent) => {
    if (guidedMode) return;
    manualCameraRef.current = true; // user takes control — smart-fit stops recentering on its own
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(t => ({ ...t, scale: Math.max(0.2, Math.min(3, t.scale * delta)) }));
  };

  const fitToScreen = () => {
    if (guidedMode) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    // Explicit ask from the user to reframe — resume smart auto-fit
    // afterward, and resync the compensation baseline so the NEXT
    // bounds change doesn't compute a stale delta against pre-fit state.
    manualCameraRef.current = false;
    prevBoundsOriginRef.current = { minX: bounds.minX, minY: bounds.minY };
    setTransform(computeFitTransform(rect, svgW, svgH, 1));
  };

  const wrapText = wrapNodeText;

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

      {/* STUDYMAP_SMOOTH_LOCAL_NAVIGATION: `transform` is deliberately NOT
          in this style object — it is driven imperatively (see
          contentRef/transformRef above and the focus-camera rAF tick
          below) so a camera animation never needs a React re-render to
          move, and an unrelated incidental re-render (e.g. hover) mid-
          animation can never stomp the in-flight imperative value with a
          stale declarative one. */}
      <div ref={contentRef} style={{
        position: 'absolute', top: 0, left: 0,
        transformOrigin: '0 0',
        // STUDYMAP_SMOOTH_LOCAL_NAVIGATION: hints the browser to promote
        // this layer to its own GPU compositing layer, so the imperative
        // per-frame transform writes above are pure compositing (move/
        // scale an already-rasterized layer) rather than a repaint.
        willChange: 'transform',
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

            // Reduced in proportion to the STUDYMAP_UX_PHASE1 node-width
            // compaction above, so wrapped text keeps fitting the
            // (now smaller) boxes instead of overflowing them.
            const labelMaxChars = isRoot ? 20 : isBranch ? 19 : isLeaf ? 19 : 17;
            const descMaxChars = isRoot ? 30 : isBranch ? 27 : isLeaf ? 25 : 24;
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
            // GUIDED_STUDYMAP visual context: full emphasis for the
            // focused node and its immediate parent/children, secondary
            // for everything else while a node is focused, unchanged
            // (fully opaque) when nothing is focused. Presentation only.
            // GUIDED_LOCAL_FRAMING: strengthened de-emphasis (was 0.35) —
            // distant rendered nodes (outside the guided-camera's own
            // local neighborhood) must read as clearly secondary, never
            // competing with the current local study neighborhood.
            const nodeOpacity = !focusEmphasisIds || focusEmphasisIds.has(n.node.id) ? 1 : 0.22;
            // STUDYMAP_NAVIGABLE_VIEWPORT_FIT: dominance must survive the
            // camera zooming OUT to fit more navigable options — a subtle
            // glow reinforces "this is where you are" independent of the
            // node's actual on-screen size, never by keeping it
            // geometrically huge at the cost of clipping neighbors.
            const dominanceGlow = isSel ? 'drop-shadow(0 0 10px color-mix(in srgb, var(--gold) 70%, transparent))' : 'none';

            return (
              <g key={n.node.id} className="node-clickable" onClick={() => handleNodeClick(n.node)} onMouseEnter={() => setHoveredId(n.node.id)} onMouseLeave={() => setHoveredId(null)} style={{ cursor: 'pointer', opacity: nodeOpacity, filter: dominanceGlow, transition: 'opacity 400ms ease, filter 400ms ease' }}>
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
                {/* STUDYMAP_FINAL_POLISH: a quiet outer ring marks "nearby
                    navigable options" (in the guided camera's local
                    frame, but not the current node itself) — a subtle,
                    consistent third state between "current" (thick solid
                    stroke + glow above) and "distant" (already
                    de-emphasized via opacity). Presentation only. */}
                {!isSel && focusEmphasisIds && focusEmphasisIds.has(n.node.id) && (
                  <rect
                    x={left - 4} y={top - 4}
                    width={w + 8} height={h + 8}
                    rx={(isRoot ? 22 : isBranch ? 18 : 14) + 4}
                    fill="none"
                    stroke={borderColor}
                    strokeWidth={1.5}
                    strokeDasharray="3 4"
                    opacity={0.55}
                  />
                )}
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

                {/* STUDYMAP_LIVE_UX_HARDENING text-overflow root cause:
                    the group below referenced clipPath={`url(#clip-...)`}
                    but no <clipPath> element with that id was ever
                    defined anywhere in the document — an SVG reference to
                    a nonexistent clip path renders UNCLIPPED, which is
                    exactly why long descriptions/labels visibly escaped
                    their node rectangles. This defines the actual clip
                    region, matching the node's own rect exactly, so
                    nothing can ever render outside it regardless of text
                    length/language/accents/unbroken tokens. */}
                <clipPath id={`clip-${n.node.id}`}>
                  <rect x={left} y={top} width={w} height={h} rx={isRoot ? 22 : isBranch ? 18 : 14} />
                </clipPath>

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
                    fontFamily="var(--font-body)"
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
                    fontFamily="var(--font-body)"
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
                    <text x={24} y={11.5} fontSize={10} fill="#fff" fontWeight={800} textAnchor="middle" fontFamily="var(--font-body)">
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

      {/* Controles — GUIDED_STUDYMAP: manual zoom/fit is a user-driven
          camera override, incompatible with "camera movement becomes
          programmatic only" in guided mode, so the whole control cluster
          is hidden (not merely disabled) while guidedMode is on. */}
      {!guidedMode && <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
      </div>}

      {/* STUDYMAP_PATH_NAVIGATION: back anchor — a compact, SCREEN-SPACE
          overlay (like the info bar/zoom controls), never a graph-space
          node. It represents the previous node in the guided navigation
          stack WITHOUT ever entering the camera's bounds computation —
          this is precisely what keeps it from dragging the scale down
          just because the real previous node might be far away. */}
      {guidedMode && focusNodeId && previousNodeId && onGuidedBack && (() => {
        const previousNode = findNodeById(data.root, previousNodeId);
        if (!previousNode) return null;
        const previousLayout = layout.find(n => n.node.id === previousNodeId);
        const currentLayout = layout.find(n => n.node.id === focusNodeId);
        const side = computeBackAnchorSide(
          previousLayout ? { x: previousLayout.x, y: previousLayout.y } : null,
          currentLayout ? { x: currentLayout.x, y: currentLayout.y } : { x: 0, y: 0 },
        );
        const rawLabel = previousNode.label || '';
        const shortLabel = rawLabel.length > 22 ? `${rawLabel.slice(0, 22)}…` : rawLabel;
        // STUDYMAP_FINAL_POLISH: gold accent (StudyAL's own navigation
        // color, matching the Tour/view-switcher chips) instead of a
        // neutral gray pill, and a separated arrow glyph — reads as
        // "part of map navigation", not a generic floating toast. Same
        // position/side logic, same onClick, same conditions — purely
        // visual.
        return (
          <button
            onClick={onGuidedBack}
            title={rawLabel ? `Volver a ${rawLabel}` : 'Volver'}
            style={{
              position: 'absolute',
              bottom: 76,
              ...(side === 'right' ? { right: 20 } : { left: 20 }),
              maxWidth: 230,
              padding: '7px 14px 7px 12px',
              borderRadius: 999,
              display: 'flex', alignItems: 'center', gap: 6,
              border: '1.5px solid color-mix(in srgb, var(--gold) 55%, var(--border-color2))',
              background: 'color-mix(in srgb, var(--bg-card) 94%, transparent)',
              color: 'var(--text-secondary)',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              boxShadow: '0 4px 14px rgba(0,0,0,0.32)',
              zIndex: 20,
            }}
          >
            <span style={{ color: 'var(--gold)', fontWeight: 900 }}>←</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {shortLabel ? `Regresar a ${shortLabel}` : 'Volver'}
            </span>
          </button>
        );
      })()}

      {/* Info bottom */}
      <div style={{
        position: 'absolute', bottom: 20, left: 20,
        fontSize: 12, color: 'var(--text-faint)', fontFamily: "var(--font-body)",
        background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)',
        padding: '6px 12px', borderRadius: 8,
        border: '1px solid var(--border-color2)',
      }}>
        {guidedMode
          ? `${Math.round(transform.scale * 100)}% · click en un concepto para estudiarlo`
          : `${Math.round(transform.scale * 100)}% · arrastra para mover · scroll para zoom · click en concepto para estudiarlo`}
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
          <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--gold)', fontFamily: "var(--font-body)", marginBottom: 6 }}>
            {data.root.emoji} {data.root.label}
          </div>
          {data.root.description && (
            <div style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.5, fontFamily: "var(--font-body)" }}>
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
                <div style={{ fontSize: 14, fontWeight: 900, color, fontFamily: "var(--font-body)", letterSpacing: 1 }}>
                  {String(bi + 1).padStart(2, '0')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "var(--font-body)" }}>
                    {branch.emoji} {branch.label}
                  </div>
                  {branch.description && (
                    <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5, fontFamily: "var(--font-body)" }}>
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
                        <span style={{ fontSize: 12, color, fontWeight: 700, minWidth: 28, marginTop: 3, fontFamily: "var(--font-body)" }}>
                          {bi + 1}.{li + 1}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "var(--font-body)", display: 'flex', alignItems: 'center', gap: 6 }}>
                            {details.length > 0 && (
                              <span style={{ fontSize: 10, color, transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
                            )}
                            {leaf.label}
                            {leaf.page && <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600 }}>· p.{leaf.page}</span>}
                          </div>
                          {leaf.description && (
                            <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 4, paddingLeft: details.length > 0 ? 14 : 0, fontFamily: "var(--font-body)" }}>
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
                                <div style={{ fontSize: 13.5, fontWeight: 700, color, fontFamily: "var(--font-body)" }}>
                                  {d.label}
                                </div>
                                {d.description && (
                                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2, fontFamily: "var(--font-body)" }}>
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

      <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: "var(--font-body)", fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        {node.type === 'root' ? 'Tema Central' : node.type === 'branch' ? 'Categoría' : node.type === 'leaf' ? 'Concepto' : 'Detalle'}
      </div>

      <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', fontFamily: "var(--font-body)", marginBottom: 12, lineHeight: 1.25 }}>
        {node.label}
      </div>

      {node.description && (
        <p style={{ fontSize: 14.5, color: 'var(--text-secondary)', lineHeight: 1.65, fontFamily: "var(--font-body)", margin: '0 0 16px' }}>
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
          fontFamily: "var(--font-body)", marginBottom: 14,
        }}>
          📄 Página {node.page}
        </div>
      )}

      {node.children && node.children.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: '#888', fontFamily: "var(--font-body)", fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Contiene ({node.children.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {node.children.map(child => (
              <div key={child.id} style={{
                padding: '10px 12px', borderRadius: 10,
                background: `color-mix(in srgb, ${color} 10%, var(--bg-card2))`,
                border: `1.5px solid color-mix(in srgb, ${color} 30%, transparent)`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "var(--font-body)" }}>
                  {child.emoji && <span style={{ marginRight: 6 }}>{child.emoji}</span>}
                  {child.label}
                </div>
                {child.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45, fontFamily: "var(--font-body)" }}>
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

/**
 * Renders a single inline `$...$` LaTeX math span via KaTeX — reuses the
 * SAME existing mature math infrastructure already used elsewhere in the
 * app (components/academic/AcademicContent.tsx: katex + katex/dist/katex.min.css,
 * already globally loaded in app/layout.tsx). ENJOYER_LANGUAGE_MATH_FIDELITY:
 * no new math library added; rendering only ever changes PRESENTATION —
 * it never alters, guesses, or "repairs" the LaTeX source string itself.
 * A malformed/unsupported expression falls back to plain text rather
 * than throwing or inventing notation.
 */
function InlineMath({ latex }: { latex: string }) {
  let html: string | null = null;
  try {
    html = katex.renderToString(latex, { throwOnError: false, displayMode: false, output: 'html' });
  } catch {
    html = null;
  }
  if (html === null) return <span>{`$${latex}$`}</span>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderInline(text: string, key?: string | number): React.ReactNode {
  // **bold** and $inline math$ — math is checked first so a formula
  // containing no asterisks is never accidentally split by the bold pass.
  const parts = text.split(/(\*\*[^*]+\*\*|\$[^$\n]+\$)/g);
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
        if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
          return <InlineMath key={`${key}-${i}`} latex={part.slice(1, -1)} />;
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
              fontFamily: "var(--font-body)",
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
              color: 'var(--text-primary)', fontFamily: "var(--font-body)",
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
                    fontFamily: "var(--font-body)",
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
                  fontFamily: "var(--font-body)",
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
              fontFamily: "var(--font-body)",
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
                fontSize: 12.5, fontFamily: "var(--font-body)",
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

/**
 * STUDYMAP_PATH_NAVIGATION: canonical definition of the guided camera's
 * FORWARD study neighborhood — used BOTH to drive the guided camera's
 * local-fit framing and the visual emphasis/de-emphasis opacity, so
 * "what the camera frames" and "what reads as emphasized" are always
 * the exact same set by construction.
 *
 * Product correction (this phase, superseding STUDYMAP_NAVIGABLE_
 * VIEWPORT_FIT's sibling-inclusion): including the immediate PARENT and
 * ALL its siblings worked for a small branch (a handful of sibling
 * leaves) but broke catastrophically one level up — selecting any of
 * root's ~13 branches made "siblings" mean "every other root branch",
 * forcing the camera to zoom out to fit the entire root neighborhood
 * (~20-30% scale) exactly like the old whole-graph fit this feature
 * exists to avoid. The parent is no longer part of the graph-space
 * camera bounds at all: it is represented ONLY as a compact, fixed-
 * footprint screen-space "back anchor" overlay (see the back-anchor
 * render logic in MindMap) that can never influence scale, however far
 * away it actually sits.
 *
 * This is now a pure FORWARD walk: the selected/current node plus its
 * own direct children only (one level down, never sideways or up).
 * Rendered relation-detail nodes need no separate handling: for a leaf,
 * projectStudyMapToTree (app/api/alai-studyal-map/route.ts) already
 * surfaces its relations as ordinary `type:'detail'` tree CHILDREN, so
 * they are already included via the "children" step below. For root,
 * "direct children" is exactly the set of root branches — the same
 * overview the initial smart-fit already shows, so returning to root
 * via Back reproduces that same accepted overview framing for free.
 *
 * Returns ids only — the CALLER (MindMap) is responsible for
 * intersecting this against `layout` (what's actually currently
 * rendered/expanded).
 */
export function getNavigableNeighborhoodIds(root: MapNode, selectedNodeId: string): Set<string> | null {
  const chain = findParentChain(root, selectedNodeId);
  if (!chain || !chain.length) return null;
  const selectedNode = chain[chain.length - 1];
  const ids = new Set<string>([selectedNodeId]);
  for (const child of selectedNode.children || []) ids.add(child.id);
  return ids;
}

/**
 * STUDYMAP_SMOOTH_LOCAL_NAVIGATION: the canonical "guided visible
 * context" — the MINIMAL expandedSet needed to render the current
 * study location: the structural ancestor path (root down to the
 * current node — computeMindMapLayout only lays out a node's children
 * when the node ITSELF is in expandedSet, so every ancestor must be
 * present for the current node to be positioned/visible at all) plus
 * the current node itself (to reveal ITS OWN immediate forward
 * children/relation-details).
 *
 * Deliberately does NOT reference the navigation stack — a node visited
 * earlier in the session (root's history) has no bearing on what should
 * be expanded NOW; keeping it expanded is exactly the "old unrelated
 * branches accumulate behind the student" bug this fixes. The
 * conceptual signature includes the stack only to document that it was
 * considered and intentionally excluded from the expansion decision;
 * the previous location is represented ONLY by the screen-space back
 * anchor (see MindMap), never by residual graph expansion.
 *
 * Replacing (not merging into) expandedSet with this result on every
 * guided navigation (forward selection AND Back) is what keeps the
 * rendered/expanded node count bounded to "current path + immediate
 * options" instead of growing indefinitely across a session — which is
 * also a direct performance win: fewer simultaneously-rendered SVG
 * nodes/edges makes every camera animation frame cheaper.
 *
 * Never touches studiedSet/explanationsByNodeId — those are entirely
 * separate state, keyed by node id, indifferent to visual expansion.
 */
export function getGuidedVisibleContext(
  root: MapNode,
  currentNodeId: string | null,
  _navigationStack?: readonly string[],
): Set<string> {
  if (!currentNodeId) return new Set();
  const chain = findParentChain(root, currentNodeId);
  if (!chain || !chain.length) return new Set();
  return new Set(chain.map(n => n.id));
}

/**
 * STUDYMAP_EXPAND_COLLAPSE_REGRESSION: the ancestor path REQUIRED to
 * render currentNodeId at all (root down to its PARENT — excludes
 * currentNodeId itself), used ONLY by forward node-selection
 * (onSelect), never by Back.
 *
 * Root cause of the regression this fixes: getGuidedVisibleContext
 * above always includes currentNodeId itself, so calling it from
 * onSelect (which fires BEFORE onToggleExpand in the same click — see
 * handleNodeClick) pre-emptively marked the JUST-CLICKED node as
 * "already expanded" before toggleExpand's own add/remove decision ran.
 * toggleExpand then saw the node as already-expanded on EVERY click
 * (even the very first one on a freshly collapsed branch) and
 * immediately collapsed it again — net effect: branches never
 * appeared to open.
 *
 * Fix: onSelect normalizes ONLY the ancestor path (this function),
 * explicitly preserving whatever expand/collapse state the clicked
 * node already had (via getGuidedForwardExpansion below) — leaving
 * toggleExpand's own pre-click-state add/remove decision authoritative
 * for the clicked node itself, exactly as it always was. Back
 * continues to use the inclusive getGuidedVisibleContext unchanged
 * (see STUDYMAP_SMOOTH_LOCAL_NAVIGATION's final report: Back has no
 * competing toggle-intent to preserve, so always revealing the
 * destination's own children is correct there).
 */
export function getGuidedAncestorPath(root: MapNode, currentNodeId: string | null): Set<string> {
  if (!currentNodeId) return new Set();
  const chain = findParentChain(root, currentNodeId);
  if (!chain || chain.length < 2) return new Set();
  return new Set(chain.slice(0, -1).map(n => n.id));
}

/**
 * STUDYMAP_EXPAND_COLLAPSE_REGRESSION: composes the guided ancestor
 * path with the clicked node's OWN pre-click expansion state —
 * `nextExpandedSet = guidedAncestorPath ∪ (previouslyExpanded ?
 * {currentNodeId} : {})` — never `guidedAncestorPath` alone. This is
 * what lets toggleExpand's own functional update (which runs right
 * after this, in the same click, reading THIS result as its `prev`)
 * correctly see the node's true pre-click membership and decide
 * add-vs-remove itself, while unrelated old branches still collapse
 * away (only the ancestor path + the clicked node's own prior state
 * survive the normalization).
 */
export function getGuidedForwardExpansion(
  root: MapNode,
  currentNodeId: string,
  previousExpandedSet: ReadonlySet<string>,
): Set<string> {
  const next = getGuidedAncestorPath(root, currentNodeId);
  if (previousExpandedSet.has(currentNodeId)) next.add(currentNodeId);
  return next;
}

/**
 * STUDYMAP_PATH_NAVIGATION: lightweight, client-only, UI-navigation
 * stack — deliberately NOT persisted (see final report: session-local
 * only, same lifetime as expandedSet/selectedNode, never written to
 * DurableFreeStudyMapState) and completely independent of studiedSet/
 * explanationsByNodeId/Enjoyer identity. `push` records where the
 * student is navigating FROM (so Back can return there exactly);
 * `pop` is the Back action itself.
 */
export function pushGuidedNavigation(stack: readonly string[], fromNodeId: string | null): string[] {
  if (!fromNodeId) return [...stack];
  return [...stack, fromNodeId];
}

export function popGuidedNavigation(stack: readonly string[]): { stack: string[]; targetNodeId: string | null } {
  if (!stack.length) return { stack: [...stack], targetNodeId: null };
  return { stack: stack.slice(0, -1), targetNodeId: stack[stack.length - 1] };
}

/**
 * STUDYMAP_PATH_NAVIGATION: which side of the current node the back
 * anchor chip should render on, following the actual spatial direction
 * of the previous node when its position is still known (e.g. still
 * rendered in `layout`) — a purely cosmetic, deterministic choice, pure
 * function for direct testing.
 */
export function computeBackAnchorSide(
  previous: { x: number; y: number } | null,
  current: { x: number; y: number },
): 'left' | 'right' | 'top' | 'bottom' {
  if (!previous) return 'left';
  const dx = previous.x - current.x;
  const dy = previous.y - current.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
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

/** Every real Enjoyer leaf-node id (real Enjoyer target) among a node and its descendants — used to scope explain_node grounding for both a single leaf and an entire branch. */
function collectLeafNodeIds(node: MapNode): string[] {
  if (node.type === 'leaf') return [node.id];
  const ids: string[] = [];
  for (const child of node.children || []) ids.push(...collectLeafNodeIds(child));
  return ids;
}

function StudyPanel({
  node,
  mapData,
  onClose,
  onJumpToNode,
  materialText,
  materia,
  tema,
  sessionId,
  explanationsByNodeId,
  onPersistExplanation,
  isMobile,
  isFloating,
  panelRef,
}: {
  node: MapNode | null;
  mapData: MindMapData;
  onClose: () => void;
  onJumpToNode: (n: MapNode) => void;
  materialText: string;
  materia?: string;
  tema?: string;
  sessionId?: string | null;
  explanationsByNodeId: Record<string, StudyMapExplanationState>;
  // STUDYMAP_UX_PHASE2: medium-screen tier — a floating/overlay card
  // instead of either the desktop sidebar (which permanently shrinks
  // the map) or the mobile full-screen drawer. Purely presentational.
  isFloating?: boolean;
  onPersistExplanation: (nodeId: string, explanation: StudyMapExplanationState) => void;
  isMobile?: boolean;
  // STUDYMAP_NAVIGABLE_VIEWPORT_FIT: lets the parent measure the panel's
  // ACTUAL rendered footprint (getBoundingClientRect) instead of relying
  // only on a nominal width+margin constant, which can drift from what
  // is really on screen. Purely a DOM measurement hook — no behavior.
  panelRef?: (el: HTMLElement | null) => void;
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

  // STUDYMAP_NODE_PROVIDER_LOOP root cause: `explanationsByNodeId` and
  // `onPersistExplanation` are props recreated with a NEW identity on
  // every parent render (an inline object fallback and an inline arrow
  // function respectively). They were previously in this effect's own
  // dependency array, so ANY unrelated parent re-render — not just a
  // genuine node selection — re-fired this provider-backed fetch. Mirror
  // them into refs, synced every render but read WITHOUT being effect
  // dependencies, so this component is immune to the parent's prop
  // identity churn regardless of whether the parent ever memoizes them.
  const explanationsByNodeIdRef = useRef(explanationsByNodeId);
  explanationsByNodeIdRef.current = explanationsByNodeId;
  const onPersistExplanationRef = useRef(onPersistExplanation);
  onPersistExplanationRef.current = onPersistExplanation;

  // Single-flight guard for explanation requests, keyed by node id —
  // mirrors the exact pattern already proven for map generation
  // (activeGenerationKeyRef). At most one active explanation request per
  // node identity; rapid re-clicks of the same node cannot duplicate it.
  const activeExplainKeyRef = useRef<string | null>(null);

  /**
   * COST SAFETY INVARIANT (STUDYMAP_NODE_PROVIDER_LOOP, unified in
   * STUDYMAP_LIVE_UX_HARDENING): this function is the ONLY place that
   * calls the grounded explain_node route for the study panel — leaf
   * AND branch/category nodes both go through it (a leaf sends its own
   * id, a branch sends every real Enjoyer id among its descendant
   * leaves). /api/alai-studyal-chat is NEVER called automatically from
   * Study Map node selection anymore — that legacy fallback is gone.
   * Root is never explainable (deterministic-only, see the render).
   */
  const requestNodeExplanation = useCallback(async (
    targetNode: MapNode, parent: MapNode | undefined, signal: AbortSignal, trigger: 'lifecycle' | 'explicit_user',
  ) => {
    const key = targetNode.id;
    if (activeExplainKeyRef.current === key) return;
    const persisted = explanationsByNodeIdRef.current[key];
    if (persisted) {
      setExplicacion(persisted);
      setErrExp('');
      setLoadingExp(false);
      return;
    }

    // STUDYMAP_LIVE_UX_HARDENING unification: ONE explanation path for
    // every explainable node type. A leaf sends its own single real
    // Enjoyer node id; a branch/category sends every real Enjoyer node
    // id among its descendant leaves (computed here, client-side, from
    // the tree StudyPanel already has — never re-derived server-side
    // from anything but real node ids). Root is never explainable here
    // (see the auto-effect and the render below — root content stays
    // fully deterministic, 0 provider calls, ever).
    const leafIds = collectLeafNodeIds(targetNode);
    if (!leafIds.length || !sessionId) return;

    activeExplainKeyRef.current = key;
    const attempt = (attemptRef.current[key] || 0) + 1;
    attemptRef.current[key] = attempt;

    setLoadingExp(true);
    setErrExp('');
    setExplicacion(null);

    // DEV-safe cost-guard diagnostic — never logs material content, only
    // the identity/trigger of a provider-backed action, so an accidental
    // automatic call is immediately visible in the dev console.
    if (process.env.NODE_ENV !== 'production') {
      console.info('[studymap-cost-guard]', JSON.stringify({
        action: 'explain_node', sessionId: sessionId || null, nodeId: key, trigger,
      }));
    }

    try {
      const res = await fetch('/api/alai-studyal-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          mode: 'explain_node',
          sessionId,
          unitIds: leafIds,
          materia: materia || '',
          tema: tema || '',
        }),
        signal,
      });
      const json = await res.json();
      const data = {
        success: json.success, answer: json.explanation?.answer,
        sourcePages: json.explanation?.sourcePages, suggestedFollowups: json.explanation?.suggestedFollowups,
        pedagogicalNote: json.explanation?.pedagogicalNote,
        error: json.error,
      };

      if (signal.aborted) return;

      if (data.success && data.answer) {
        const result: StudyMapExplanationState = {
          answer: data.answer,
          sourcePages: data.sourcePages || [],
          suggestedFollowups: data.suggestedFollowups || [],
          pedagogicalNote: data.pedagogicalNote || '',
        };
        onPersistExplanationRef.current(key, result);
        if (attemptRef.current[key] === attempt) setExplicacion(result);
      } else if (attemptRef.current[key] === attempt) {
        setErrExp(data.error || 'No se pudo generar la explicación');
      }
    } catch (e: any) {
      if (!signal.aborted && attemptRef.current[key] === attempt) {
        setErrExp(e?.message || 'Error de conexión');
      }
    } finally {
      if (activeExplainKeyRef.current === key) activeExplainKeyRef.current = null;
      if (!signal.aborted && attemptRef.current[key] === attempt) setLoadingExp(false);
    }
  }, [sessionId, materia, tema]);

  // Automatic path — EVERY explainable node (leaf AND branch/category).
  // Root never auto-fetches: its content stays fully deterministic (see
  // the render below). Selecting a node is always the trigger — there
  // is no separate "explain this" button anymore (STUDYMAP_LIVE_UX_HARDENING
  // unification: the leaf/branch distinction is an implementation
  // detail, never exposed to the student).
  useEffect(() => {
    if (!current || showingRoot) {
      setExplicacion(null);
      setErrExp('');
      setLoadingExp(false);
      return;
    }

    const persisted = explanationsByNodeIdRef.current[current.id];
    if (persisted) {
      setExplicacion(persisted);
      setErrExp('');
      setLoadingExp(false);
      return;
    }

    setExplicacion(null);
    setErrExp('');
    setLoadingExp(false);

    if (!sessionId || !collectLeafNodeIds(current).length) return;

    const controller = new AbortController();
    void requestNodeExplanation(current, parentNode, controller.signal, 'lifecycle');
    return () => {
      controller.abort();
      if (activeExplainKeyRef.current === current.id) activeExplainKeyRef.current = null;
    };
    // Deliberately NOT depending on explanationsByNodeId/onPersistExplanation
    // (read via refs above) — see the STUDYMAP_NODE_PROVIDER_LOOP comment
    // above requestNodeExplanation.
  }, [current, showingRoot, sessionId, requestNodeExplanation]);

  const Section = ({ icon, title, color: c, children }: any) => (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 800, color: c || color, letterSpacing: 1.2,
        textTransform: 'uppercase', fontFamily: "var(--font-body)",
        marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 13 }}>{icon}</span> {title}
      </div>
      <div style={{
        fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.65,
        fontFamily: "var(--font-body)",
      }}>
        {children}
      </div>
    </div>
  );

  // STUDYMAP_UX_PHASE2: the panel is an inspector for a SELECTED node —
  // with nothing selected it collapses away entirely (on every screen
  // tier) so the map stays the dominant surface, instead of previously
  // showing a permanent root-overview panel on desktop/medium.
  if (!node) return null;

  return (
    <aside ref={panelRef} style={{
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
      } : isFloating ? {
        // Medium screens: a floating card OVER the map — never a flex
        // sibling that permanently shrinks it. Anchored to the nearest
        // positioned ancestor (the map/panel row already has
        // position:relative). Its footprint is reserved from the
        // camera's usable viewport via reserveRight (see MindMap).
        position: 'absolute',
        top: 16,
        right: 16,
        bottom: 16,
        width: 400,
        maxWidth: 'calc(100% - 32px)',
        zIndex: 150,
        background: 'var(--bg-card)',
        border: '1.5px solid var(--border-color2)',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      } : {
        // Desktop: a narrower sidebar (was 440px) that only occupies
        // flex space while a node is selected — collapsing away
        // entirely (see the `if (!node) return null` above) is what
        // makes it "collapsible" rather than a permanent fixture.
        width: 380,
        flexShrink: 0,
        background: 'var(--bg-card)',
        borderLeft: '1.5px solid var(--border-color2)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }),
    }}>
      {/* Header — STUDYMAP_FINAL_POLISH: tighter vertical rhythm, a
          slightly quieter eyebrow/close affordance, and a single
          consistent "pill" style shared by the page badge and the
          source badges further down, so the header reads as one clear
          hierarchy (kind → path → title → page) instead of competing
          bold elements. */}
      <div style={{
        padding: '13px 16px',
        borderBottom: '1px solid var(--border-color2)',
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} 12%, var(--bg-card)), var(--bg-card))`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color, letterSpacing: 1.2,
            textTransform: 'uppercase', fontFamily: "var(--font-body)", opacity: 0.9,
          }}>
            {typeLabel}
          </div>
          {/* STUDYMAP_UX_PHASE2: the panel only ever renders with a real
              selected node now (see the `if (!node) return null` gate
              above) — closing it is always a meaningful action, on
              every screen tier, so the button is no longer conditional
              on `showingRoot`. */}
          <button onClick={onClose} title="Cerrar"
              style={{
                width: 24, height: 24, borderRadius: 7, border: 'none',
                background: 'var(--bg-secondary)', color: 'var(--text-faint)',
                cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>✕</button>
        </div>

        {breadcrumb.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap',
            marginTop: 6, fontSize: 11, color: 'var(--text-faint)',
            fontFamily: "var(--font-body)",
          }}>
            {breadcrumb.map((b) => (
              <span key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <button onClick={() => onJumpToNode(b)} style={{
                  background: 'transparent', border: 'none',
                  color: b.color || 'var(--text-muted)', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, padding: '2px 3px',
                  fontFamily: "var(--font-body)",
                }}>
                  {b.label}
                </button>
                <span style={{ opacity: 0.4 }}>›</span>
              </span>
            ))}
          </div>
        )}

        <div style={{
          fontSize: 19, fontWeight: 800, color: 'var(--text-primary)',
          fontFamily: "var(--font-body)", marginTop: 8, lineHeight: 1.25,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          {current.emoji && <span style={{ fontSize: 24, lineHeight: 1 }}>{current.emoji}</span>}
          <span style={{ flex: 1 }}>{current.label}</span>
        </div>

        {current.page && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 9px', borderRadius: 999, marginTop: 8,
            background: `color-mix(in srgb, ${color} 14%, var(--bg-card))`,
            border: `1px solid color-mix(in srgb, ${color} 55%, transparent)`,
            fontSize: 10.5, fontWeight: 700, color,
            fontFamily: "var(--font-body)",
          }}>
            📄 p.{current.page}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '18px 20px',
        display: 'flex', flexDirection: 'column', gap: 18,
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
              fontFamily: "var(--font-body)", lineHeight: 1.65,
            }}>
              🎯 <strong style={{ color: 'var(--text-primary)' }}>Click en cualquier concepto del mapa</strong> y aquí aparecerá la explicación profunda de ALAI: definición, ejemplo, por qué importa y trucos para recordarlo.
            </div>
          </>
        )}

        {/* Rare edge case: a node with no real Enjoyer leaf descendants
            (e.g. an empty grouping) — nothing to ground an explanation
            in, so no request is ever attempted (see collectLeafNodeIds
            in the auto-effect). Every normal leaf/branch node is
            explained automatically on selection — no button needed. */}
        {!showingRoot && !collectLeafNodeIds(current).length && !explicacion && !loadingExp && !errExp && (
          <div style={{
            padding: '14px 16px', borderRadius: 12,
            background: 'var(--bg-card2)', border: '1.5px dashed var(--text-faint)',
            fontSize: 13, color: 'var(--text-muted)', fontFamily: "var(--font-body)",
          }}>
            Este grupo no tiene contenido del material para explicar.
          </div>
        )}

        {/* Cargando explicación */}
        {!showingRoot && loadingExp && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 14, padding: '40px 20px',
            color: 'var(--text-muted)', fontFamily: "var(--font-body)",
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
            color: '#fca5a5', fontSize: 13, fontFamily: "var(--font-body)",
          }}>
            ⚠️ {errExp}
          </div>
        )}

        {/* Explicación generada por ALAI Chat real */}
        {!showingRoot && explicacion && !loadingExp && (
          <>
            <AlaiMarkdown text={explicacion.answer || ''} color={color} />

            {/* STUDYMAP_FINAL_POLISH: cleaner source presentation — one
                quiet line instead of a bordered/boxed callout, less
                visual competition with the explanation text above it. */}
            {explicacion.sourcePages && explicacion.sourcePages.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
                fontSize: 11, color: 'var(--text-faint)', fontFamily: "var(--font-body)",
              }}>
                <span style={{ fontWeight: 700 }}>Fuentes</span>
                {explicacion.sourcePages.map((p: number) => (
                  <span key={p} style={{
                    padding: '1px 7px', borderRadius: 999,
                    background: `color-mix(in srgb, ${color} 12%, transparent)`,
                    fontWeight: 700, color,
                  }}>
                    p.{p}
                  </span>
                ))}
              </div>
            )}

            {/* Honest provenance (STUDYMAP_FINAL_LIVE_HARDENING): any
                pedagogical enrichment the model added beyond the [UNIT]
                block is shown here, visually distinct and WITHOUT the
                "Fuentes: p.X" badge above — that badge only ever covers
                `explicacion.answer`, never this note. */}
            {explicacion.pedagogicalNote && (
              <div style={{
                padding: '10px 12px', borderRadius: 10,
                background: 'var(--bg-card2)',
                border: '1.5px dashed var(--text-faint)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 700, marginBottom: 4, fontFamily: "var(--font-body)" }}>
                  💡 Para entenderlo mejor (no viene del material)
                </div>
                <AlaiMarkdown text={explicacion.pedagogicalNote} color={color} />
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
        fontFamily: "var(--font-body)",
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

type ViewMode = 'map' | 'outline';

/**
 * STUDYMAP_FINAL_POLISH: Cards mode was removed entirely. A session
 * persisted before this change may still have `view: 'cards'` saved —
 * restoring it verbatim would land on a view that no longer exists and
 * renders nothing. Any value other than the current valid ViewModes
 * (a stale 'cards', or anything else unrecognized) safely falls back
 * to 'map', the primary experience.
 */
function sanitizeViewMode(value: unknown): ViewMode {
  return value === 'outline' ? 'outline' : 'map';
}

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
  // STUDYMAP_PATH_NAVIGATION: session-local guided navigation history —
  // deliberately NOT part of DurableFreeStudyMapState/persistPatch (see
  // final report for the persistence decision). Independent of
  // studiedSet/explanationsByNodeId/Enjoyer identity — pure UI back-
  // stack, reset on remount like expandedSet/selectedNode already are.
  const [guidedNavStack, setGuidedNavStack] = useState<string[]>([]);
  const [materialText, setMaterialText] = useState<string>('');
  const [studiedSet, setStudiedSet] = useState<Set<string>>(new Set());
  const [showGuidedTour, setShowGuidedTour] = useState(false);
  // STUDYMAP_FINAL_POLISH: toolbar overflow menu — houses the
  // secondary/admin-like "Regenerar" action so the primary row (Mapa/
  // Outline, Tour, progress, Exportar) stays uncluttered. Purely
  // presentational local UI state.
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  // Estado de preparación localizada (ver lib/materialBrain/toolPreparation.ts).
  const [preparingMessage, setPreparingMessage] = useState<string | null>(null);
  const preparationAttemptRef = useRef(0);
  const preparationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (preparationTimerRef.current) clearTimeout(preparationTimerRef.current);
  }, []);
  const isMobile = useIsMobile();

  // STUDYMAP_UX_PHASE2: a third, medium-screen tier — its own tiny
  // listener, deliberately NOT folded into the shared useIsMobile hook
  // (used by many unrelated pages/components; this tier is Study-Map-
  // specific). Medium screens get a floating/overlay inspector instead
  // of either the desktop sidebar (permanently shrinks the map) or the
  // mobile full-screen drawer.
  const [isMediumScreen, setIsMediumScreen] = useState(false);
  useEffect(() => {
    const check = () => setIsMediumScreen(window.innerWidth >= 768 && window.innerWidth < 1280);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const isFloatingPanel = isMediumScreen && !isMobile;
  // STUDYMAP_UX_PHASE2 fallback: matches the floating panel's own
  // nominal CSS footprint (width 400 + 16px margin on each side) — used
  // ONLY before a real measurement is available (first paint) or if
  // measurement ever fails, per STUDYMAP_NAVIGABLE_VIEWPORT_FIT's
  // "use the real measured panel footprint where possible" below.
  const FLOATING_PANEL_RESERVE = 400 + 16 + 16;

  // STUDYMAP_NAVIGABLE_VIEWPORT_FIT: measure the floating panel's ACTUAL
  // rendered footprint (its left edge to the right edge of the same
  // positioned ancestor the camera's own container measures against)
  // rather than trusting only the nominal constant above, which could
  // silently drift from a future CSS change (responsive maxWidth, a
  // content-driven width, etc).
  const [floatingPanelEl, setFloatingPanelEl] = useState<HTMLElement | null>(null);
  const floatingPanelRef = useCallback((el: HTMLElement | null) => setFloatingPanelEl(el), []);
  const [measuredFloatingReserve, setMeasuredFloatingReserve] = useState<number | null>(null);
  useEffect(() => {
    if (!floatingPanelEl) { setMeasuredFloatingReserve(null); return; }
    const measure = () => {
      const panelRect = floatingPanelEl.getBoundingClientRect();
      const anchor = floatingPanelEl.offsetParent;
      const anchorRect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null;
      // Distance from the panel's own left edge to the right edge of its
      // positioned ancestor = exactly how much of that ancestor's width
      // is unusable for the map — covers the panel's width AND its own
      // right-side margin in one measurement, whatever they actually are.
      const reserve = anchorRect ? Math.max(0, anchorRect.right - panelRect.left) : panelRect.width + 16;
      setMeasuredFloatingReserve(reserve);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(floatingPanelEl);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [floatingPanelEl]);
  const floatingPanelReserve = measuredFloatingReserve ?? FLOATING_PANEL_RESERVE;

  const effectiveSourceSelection = useMemo(
    () => sourceSelection || buildSourceSelectionFromMaterials(materiales, seleccion),
    [sourceSelection, materiales, seleccion],
  );
  const { result: authorizedSource, status: authorizedStatus, error: authorizedError } = useAuthorizedSource(effectiveSourceSelection, 'ALAIStudyMap');
  const fingerprint = effectiveSourceSelection.fingerprint;
  const generationAttemptRef = useRef(0);
  const persistedStateRef = useRef<DurableFreeStudyMapState>(initialFreeStudyMapState());
  // Single-flight guard for the mount/regeneration effect below, keyed by
  // the EXACT authority identity (session + Enjoyer fingerprint). The
  // effect's dependency array includes authorizedStatus/authorizedSource
  // (fetched only for the unrelated "explain node" feature) and can
  // re-run mid-flight — without this guard that re-run fires a second,
  // fully duplicate POST /api/alai-studyal-map (same root cause already
  // fixed in Truquitos).
  const activeGenerationKeyRef = useRef<string | null>(null);

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

  // Stable identity for StudyPanel's onPersistExplanation prop — defense
  // in depth alongside StudyPanel's own ref-based decoupling
  // (STUDYMAP_NODE_PROVIDER_LOOP): an inline arrow here would still be a
  // new function every render even though StudyPanel no longer depends
  // on it for effect triggering.
  const handlePersistNodeExplanation = useCallback((nodeId: string, explanation: StudyMapExplanationState) => {
    persistPatch({
      explanationsByNodeId: {
        ...(persistedStateRef.current.explanationsByNodeId || {}),
        [nodeId]: explanation,
      },
    });
  }, [persistPatch]);

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
    setView(sanitizeViewMode(state.view));
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
    setGuidedNavStack([]);
    setError(null);
    setLoading(true);
    setReloadToken(value => value + 1);
  }, [sessionId, fingerprint]);

  // Flattened traversal order for the guided tour — computed once per
  // mapData, not per navigation step.
  const tourNodes = useMemo<MapNode[]>(() => {
    if (!mapData) return [];
    const ordered: MapNode[] = [];
    const traverse = (n: MapNode) => { ordered.push(n); (n.children || []).forEach(traverse); };
    traverse(mapData.root);
    return ordered;
  }, [mapData]);

  /**
   * STUDYMAP_UX_PHASE1: progressive tour reveal — expands ONLY the
   * ancestor chain of the target tour node (never the whole tree at
   * once). Fully deterministic, 0 provider calls: it only derives
   * expandedSet from the already-generated mapData.
   */
  const revealTourNode = useCallback((idx: number) => {
    if (!mapData) return;
    const target = tourNodes[idx];
    if (!target) return;
    const chain = findParentChain(mapData.root, target.id) || [target];
    const chainIds = new Set(chain.map(n => n.id));
    setExpandedSet(chainIds);
    setTourIndex(idx);
    setSelectedNode(target);
    setLastExpandedId(target.id);
    persistPatch({
      expandedNodeIds: [...chainIds],
      showGuidedTour: true,
      tourIndex: idx,
      selectedNodeId: target.id,
    });
  }, [mapData, tourNodes, persistPatch]);

  useEffect(() => {
    if (!loading) return;
    const intv = setInterval(() => setStepIdx(i => (i + 1) % LOAD_STEPS.length), 1500);
    return () => clearInterval(intv);
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    let startedAttempt: number | null = null;
    // Hoisted to effect scope (not just inside run()) so the cleanup
    // below can release the SAME key this invocation may have claimed —
    // see the cleanup's own comment for why this matters.
    const generationKey = `${sessionId}::${fingerprint}`;
    // Releasing the guard on an interrupted cleanup (fixed previously) is
    // necessary but NOT sufficient on its own: without also cancelling
    // the actual in-flight fetch, an interrupted invocation's request
    // keeps running to completion in the background, and the next
    // invocation starts a SECOND, fully duplicate request — exactly the
    // "two POST /api/alai-studyal-map ~10s apart" live symptom. The
    // AbortController ties fetch cancellation to the same cleanup that
    // already releases the guard, so at most one request is ever truly
    // in flight for this identity.
    const controller = new AbortController();

    const run = async () => {
      try {
        if (!sessionId) {
          setError('No se pudo identificar la sesión Free para guardar este mapa.');
          setLoading(false);
          return;
        }

        // Single-flight: a generation for this EXACT identity already in
        // flight (started by an earlier run of this same effect) is
        // authoritative — its own completion handler will persist/apply
        // the result. Bail out instead of re-deriving state and firing a
        // duplicate request.
        if (activeGenerationKeyRef.current === generationKey) return;

        // materialText es SOLO para la función "explicar nodo" (chat de
        // dudas) — nunca autoridad del mapa en sí, que ahora viene
        // exclusivamente del StudyalMaterialEnjoyer persistido resuelto
        // server-side.
        const combinedText = authorizedSource?.combinedText || '';
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
          setView(sanitizeViewMode(restoredState.view));
          setShowGuidedTour(Boolean(restoredState.showGuidedTour));
          setTourIndex(Number.isFinite(restoredState.tourIndex) ? restoredState.tourIndex : 0);
          setError(restoredState.error || 'La generación se interrumpió. Puedes reintentar.');
          setLoading(false);
          return;
        }

        const started = beginFreeStudyMap(restoredState);
        generationAttemptRef.current = started.attempt;
        startedAttempt = started.attempt;
        activeGenerationKeyRef.current = generationKey;
        persistState(started);

        setLoading(true);
        setError(null);
        setPreparingMessage(null);
        setMaterialText(combinedText);

        if (process.env.NODE_ENV !== 'production') {
          console.info('[studymap-cost-guard]', JSON.stringify({
            action: 'map_generation', sessionId: sessionId || null, fingerprint, trigger: 'lifecycle',
          }));
        }

        const res = await fetch('/api/alai-studyal-map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            materia: materia?.nombre || materia?.name || '',
            tema: tema?.nombre || tema?.name || '',
          }),
          signal: controller.signal,
        });

        if (cancelled) return;

        const data = await res.json();

        if (cancelled || generationAttemptRef.current !== started.attempt) return;

        // FAST-ENTRY: source ya está listo pero el enriquecimiento rico
        // sigue corriendo en background. NO es un error — el mapa se
        // prepara solo. Mensaje localizado + continuación automática
        // (sin botón Reintentar, sin volver atrás, sin pantalla global
        // de preparación). El resto de Free Mode sigue abierto.
        if (isBrainEnrichingResponse(res.status, data)) {
          const nextAttempt = preparationAttemptRef.current + 1;
          preparationAttemptRef.current = nextAttempt;
          // El intento no falló: se abandona limpiamente (status idle,
          // sin error persistido) para poder reintentarlo solo.
          persistState(abandonFreeStudyMap(persistedStateRef.current, started.attempt));
          startedAttempt = null;
        activeGenerationKeyRef.current = null;
          setPreparingMessage(toolPreparationMessage('studyMap', nextAttempt));
          setError(null);
          if (shouldContinuePreparation(nextAttempt)) {
            preparationTimerRef.current = setTimeout(
              () => setReloadToken(value => value + 1),
              TOOL_PREPARATION_POLL_MS,
            );
          } else {
            // Política acotada agotada: se deja de fingir progreso.
            setLoading(false);
          }
          return;
        }

        if (!data.success || !data.mapa) {
          const failed = failFreeStudyMap(
            persistedStateRef.current,
            started.attempt,
            data.error || 'No se pudo generar el mapa mental.',
          );
          persistState(failed);
          startedAttempt = null;
        activeGenerationKeyRef.current = null;
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

        const mapa: MindMapData = {
          ...data.mapa,
          root: assignIds(data.mapa.root),
          // Additive, backward-compatible: absent for maps generated
          // before this field existed. Lets a resumed session restore
          // coverage/visibility without recomputing anything.
          ...(data.grounding ? { grounding: data.grounding } : {}),
        };

        const completed = completeFreeStudyMap(
          persistedStateRef.current,
          started.attempt,
          mapa as any,
        );
        persistState(completed);
        startedAttempt = null;
        activeGenerationKeyRef.current = null;
        applyPersistedState(completed, combinedText);
        setLoading(false);
      } catch (e: any) {
        if (controller.signal.aborted) {
          // Cleanly interrupted by this effect's own cleanup (React
          // StrictMode's dev double-invoke, or a genuine fast unmount) —
          // never a real failure. The cleanup below already reverts
          // persisted state and releases the single-flight guard; doing
          // either again here would race with (and could clobber) a
          // fresh invocation that has already started its own request.
          return;
        }
        const failed = failFreeStudyMap(
          persistedStateRef.current,
          generationAttemptRef.current,
          e?.message || 'Error de conexión',
        );
        persistState(failed);
        startedAttempt = null;
        activeGenerationKeyRef.current = null;
        if (!cancelled) {
          setError(e?.message || 'Error de conexión');
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
      controller.abort();
      // This effect invocation started a generation but never reached a
      // terminal state (React StrictMode double-invoke, or a genuine fast
      // unmount) — revert the 'generating' write so the next mount starts
      // clean instead of reporting a false "interrupted" error.
      if (startedAttempt !== null) {
        persistState(abandonFreeStudyMap(persistedStateRef.current, startedAttempt));
        // ROOT CAUSE FIX (STUDYMAP_LOADING_LIFECYCLE): every terminal path
        // inside run() clears activeGenerationKeyRef itself, but an
        // invocation interrupted BEFORE reaching one of those paths (e.g.
        // React StrictMode's mount->cleanup->mount dev double-invoke, or a
        // fast unmount while the fetch is still in flight) never did.
        // Without this, the guard is left permanently set to this exact
        // sessionId::fingerprint key, so the NEXT invocation's own
        // single-flight check (`activeGenerationKeyRef.current ===
        // generationKey`) silently bails out forever — zero fetch, zero
        // error, loading stuck at its initial `true`. Only release the
        // key if it still belongs to THIS invocation (never a newer one).
        if (activeGenerationKeyRef.current === generationKey) activeGenerationKeyRef.current = null;
      }
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

  // STUDYMAP_PATH_NAVIGATION: Back is the ONLY thing that pops the
  // guided navigation stack — it deliberately does NOT go through the
  // same code path as onSelect (which pushes), so a Back navigation
  // never re-pushes the node it just left. Independent of studiedSet
  // (never touches it) and of explanationsByNodeId (StudyPanel's own
  // persisted-explanation lookup is keyed by node id, unaffected by how
  // the student arrived at that id). Zero provider calls — this is a
  // pure client-side selection change, identical in kind to any other
  // node selection.
  const handleGuidedBack = useCallback(() => {
    if (!mapData) return;
    setGuidedNavStack(prev => {
      const { stack, targetNodeId } = popGuidedNavigation(prev);
      if (targetNodeId) {
        const target = findNodeById(mapData.root, targetNodeId);
        if (target) {
          setSelectedNode(target);
          setLastExpandedId(targetNodeId);
          // STUDYMAP_SMOOTH_LOCAL_NAVIGATION: Back restores the
          // destination node's OWN local context (its ancestor path +
          // itself) — never whatever happened to still be expanded from
          // later, unrelated exploration. Same normalization as forward
          // navigation, so "walking backward" feels identical to
          // "walking forward" rather than dragging stale state with it.
          setExpandedSet(getGuidedVisibleContext(mapData.root, targetNodeId));
        }
      }
      return stack;
    });
  }, [mapData]);

  // Preparación localizada: mensaje propio del Study Map, continuación
  // automática, sin Reintentar y sin forzar volver atrás.
  if (preparingMessage) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 9999, padding: 24 }}>
        <div style={{ fontSize: 48 }}>🗺️</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-body)', textAlign: 'center' }}>{preparingMessage}</div>
        <button onClick={onBack} style={{ padding: '10px 24px', borderRadius: 12, border: '2px solid var(--text-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>← Volver al proceso</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32, zIndex: 9999 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>🗺️</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--gold)', fontFamily: "var(--font-body)" }}>Generando Study Map</div>
          <div style={{ fontSize: 14, color: 'var(--text-faint)', fontFamily: "var(--font-body)", marginTop: 6 }}>ALAI está leyendo y organizando el 100% del material</div>
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
                <span style={{ fontFamily: "var(--font-body)", fontSize: 14, color: active ? 'var(--gold)' : done ? 'var(--text-faint)' : 'var(--text-faint)', fontWeight: active ? 700 : 500, flex: 1 }}>{s.label}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-faint)', fontFamily: "var(--font-body)" }}>puede tardar 30-60 segundos ✨</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, zIndex: 9999, padding: 24 }}>
        <div style={{ fontSize: 48 }}>😅</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "var(--font-body)" }}>No se pudo generar el mapa</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 420, textAlign: 'center', fontFamily: "var(--font-body)" }}>{error}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={resetAndReload} style={{ padding: '10px 24px', borderRadius: 12, border: '2px solid var(--gold)', background: 'var(--bg-card)', color: 'var(--gold)', fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>↻ Reintentar</button>
          <button onClick={onBack} style={{ padding: '10px 24px', borderRadius: 12, border: '2px solid var(--text-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '3px 4px 0 var(--text-primary)' }}>← Volver al proceso</button>
        </div>
      </div>
    );
  }

  if (!mapData) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f8f6f0', display: 'flex', flexDirection: 'column', zIndex: 9999 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10,
        padding: isMobile ? '8px 10px' : '10px 18px',
        background: 'var(--bg-card)',
        borderBottom: '1.5px solid var(--border-color2)',
        flexShrink: 0, zIndex: 10,
        flexWrap: isMobile ? 'wrap' : 'nowrap',
        rowGap: 6,
      }}>
        <button onClick={onBack} title="Volver al proceso" style={{
          border: '1.5px solid var(--border-color2)', background: 'transparent',
          color: 'var(--text-muted)', borderRadius: 10, padding: isMobile ? '7px 10px' : '7px 12px',
          fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "var(--font-body)",
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>{isMobile ? '←' : '← Volver al proceso'}</button>

        <div style={{ flex: 1, minWidth: 0, order: isMobile ? 3 : 0, flexBasis: isMobile ? '100%' : undefined }}>
          <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 900, color: 'var(--gold)', fontFamily: "var(--font-body)", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            🗺️ {mapData.title}
          </div>
          {mapData.summary && !isMobile && (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: "var(--font-body)", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {mapData.summary}
            </div>
          )}
        </div>

        {/* STUDYMAP_FINAL_POLISH: Mapa is the primary experience — the
            view switcher stays first-class in the toolbar; Cards has
            been removed entirely (see final report). */}
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border-color2)', flexShrink: 0 }}>
          {([
            { key: 'map', label: '🗺️ Mapa' },
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
                fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: "var(--font-body)",
              }}>{v.label}</button>
          ))}
        </div>

        <button
          onClick={() => {
            if (!mapData) return;
            setShowGuidedTour(true);
            revealTourNode(0);
          }}
          title="Lectura guiada"
          style={{
            padding: '7px 11px', borderRadius: 10,
            border: showGuidedTour ? '1.5px solid var(--gold)' : '1.5px solid var(--border-color2)',
            background: showGuidedTour ? 'color-mix(in srgb, var(--gold) 15%, transparent)' : 'transparent',
            color: showGuidedTour ? 'var(--gold)' : 'var(--text-muted)',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "var(--font-body)",
            flexShrink: 0,
          }}
        >🔊{isMobile ? '' : ' Tour'}</button>

        {mapData.totalConcepts && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 999,
            background: studiedSet.size > 0 ? 'color-mix(in srgb, #10b981 15%, var(--bg-card))' : 'color-mix(in srgb, var(--gold) 15%, var(--bg-card))',
            border: studiedSet.size > 0 ? '1.5px solid #10b981' : '1.5px solid var(--gold)',
            fontSize: 12, fontWeight: 700, color: studiedSet.size > 0 ? '#10b981' : 'var(--gold)', fontFamily: "var(--font-body)",
            flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            {studiedSet.size > 0 && <span>✓</span>}
            {studiedSet.size} / {mapData.totalConcepts + 1}
          </div>
        )}

        <button onClick={handleExport} title="Exportar" style={{
          padding: '7px 11px', borderRadius: 10,
          border: '1.5px solid var(--border-color2)', background: 'transparent',
          color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "var(--font-body)",
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>{exportMsg || (isMobile ? '↓' : '↓ Exportar')}</button>

        {/* STUDYMAP_FINAL_POLISH: "Regenerar" is a destructive, admin-
            like action (it discards the current map) — demoted out of
            the primary row into a small overflow menu so it no longer
            competes visually with everyday navigation actions. */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowMoreMenu(v => !v)}
            title="Más opciones"
            style={{
              width: 32, height: 32, borderRadius: 10,
              border: '1.5px solid var(--border-color2)',
              background: showMoreMenu ? 'var(--bg-secondary)' : 'transparent',
              color: 'var(--text-muted)', fontSize: 16, fontWeight: 800, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            }}
          >⋯</button>
          {showMoreMenu && (
            <>
              <div onClick={() => setShowMoreMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
              <div style={{
                position: 'absolute', top: '110%', right: 0, zIndex: 21,
                minWidth: 190, padding: 6, borderRadius: 12,
                background: 'var(--bg-card)', border: '1.5px solid var(--border-color2)',
                boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
              }}>
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    if (!confirm('¿Regenerar el mapa con un análisis nuevo? El actual se perderá.')) return;
                    resetAndReload();
                  }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 8,
                    border: 'none', background: 'transparent', color: 'var(--text-muted)',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "var(--font-body)",
                  }}
                >🔁 Regenerar mapa</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
        {view === 'map' && (
          <div style={{ display: 'flex', width: '100%', height: '100%', overflowX: 'hidden' }}>
            <div style={{ flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden' }}>
              <MindMap
                data={mapData}
                selectedId={selectedNode?.id || null}
                onSelect={(n) => {
                  // STUDYMAP_PATH_NAVIGATION: record where we're
                  // navigating FROM (the current focus, before it
                  // changes) so Back can return exactly there — a real
                  // traversal history, not just "go to tree parent".
                  // Guarded so re-selecting the SAME node (no-op click)
                  // never pushes a redundant history entry.
                  setGuidedNavStack(prev => (lastExpandedId && lastExpandedId !== n.id) ? pushGuidedNavigation(prev, lastExpandedId) : prev);
                  setSelectedNode(n);
                  // STUDYMAP_EXPAND_COLLAPSE_REGRESSION: normalize
                  // (replace, never merge) expandedSet to the new
                  // current node's ANCESTOR PATH ONLY, explicitly
                  // preserving the clicked node's own PRE-CLICK
                  // expand/collapse state (getGuidedForwardExpansion) —
                  // this is what keeps old unrelated branches from
                  // accumulating WITHOUT stomping on the clicked node's
                  // own state before onToggleExpand's functional update
                  // (which runs right after this, in the same click —
                  // see handleNodeClick) gets to decide add-vs-remove
                  // for that node itself. The previous version used the
                  // INCLUSIVE getGuidedVisibleContext here, which always
                  // marked the just-clicked node as already-expanded
                  // before toggleExpand ran — toggleExpand then always
                  // saw "already expanded" and immediately collapsed it
                  // back, so branches never appeared to open. Functional
                  // form is required so this reads the TRUE pre-click
                  // expandedSet, not a stale closure value.
                  if (mapData) setExpandedSet(prev => getGuidedForwardExpansion(mapData.root, n.id, prev));
                  // CAMERA_FOCUS_UX: toggleExpand already sets focusNodeId
                  // for expand/collapse clicks, but a leaf click (or
                  // re-selecting an already-expanded node) only ever
                  // called onSelect — the camera never followed those
                  // selections. Every selection that opens the panel must
                  // drive the same focus-camera effect, not just expand.
                  setLastExpandedId(n.id);
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
                reserveRight={isFloatingPanel && selectedNode ? floatingPanelReserve : 0}
                previousNodeId={guidedNavStack.length ? guidedNavStack[guidedNavStack.length - 1] : null}
                onGuidedBack={handleGuidedBack}
              />
            </div>
            <StudyPanel
              node={selectedNode}
              mapData={mapData}
              onClose={() => {
                setSelectedNode(null);
                // STUDYMAP_UX_PHASE2: release camera focus so the
                // pre-existing smart-fit comfort-zone check (it already
                // re-runs whenever focusNodeId changes — see the effect
                // above) re-measures the NOW-uncovered/regrown viewport
                // and refits only if the current framing is no longer
                // comfortable. Reuses existing camera machinery — no
                // new recentering logic.
                setLastExpandedId(null);
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
              sessionId={sessionId}
              explanationsByNodeId={persistedStateRef.current.explanationsByNodeId || EMPTY_EXPLANATIONS_BY_NODE_ID}
              onPersistExplanation={handlePersistNodeExplanation}
              isMobile={isMobile}
              isFloating={isFloatingPanel}
              panelRef={isFloatingPanel ? floatingPanelRef : undefined}
            />

            {showGuidedTour && mapData && (() => {
              const total = tourNodes.length;
              const current = tourNodes[tourIndex];
              const progress = total > 0 ? Math.round(((tourIndex + 1) / total) * 100) : 0;

              // Progressive reveal (STUDYMAP_UX_PHASE1): expands only the
              // ancestor chain of the target node, never the whole tree.
              const goTo = (idx: number) => {
                if (idx < 0 || idx >= total) return;
                revealTourNode(idx);
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
                      fontFamily: "var(--font-body)", letterSpacing: 1,
                    }}>
                      🔊 LECTURA GUIADA · {tourIndex + 1} / {total}
                    </div>
                    <div style={{
                      fontSize: 13, color: 'var(--text-primary)', fontWeight: 700,
                      fontFamily: "var(--font-body)", marginTop: 2,
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
        {view === 'outline' && <OutlineView data={mapData} />}
      </div>

      <div style={{
        padding: '8px 20px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-color2)',
        display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0,
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: "var(--font-body)" }}>
          {materiales.length} {materiales.length === 1 ? 'material' : 'materiales'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: "var(--font-body)" }}>
          {(mapData.root.children || []).length} ramas
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: "var(--font-body)" }}>
          Generado por ALAI · 100% del contenido
        </div>
      </div>
    </div>
  );
}
