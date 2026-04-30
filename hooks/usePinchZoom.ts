import { useRef, useEffect, useCallback } from 'react';

interface PinchZoomOptions {
  enabled?: boolean;
  minScale?: number;
  maxScale?: number;
  allowSingleFingerPan?: boolean;
}

export function usePinchZoom(
  wrapperRef: React.RefObject<HTMLElement>,
  onScaleChange: (scale: number, tx: number, ty: number) => void,
  opts: PinchZoomOptions = {},
): React.MutableRefObject<number> {
  const { enabled = true, minScale = 1, maxScale = 5, allowSingleFingerPan = true } = opts;

  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const lastDistRef = useRef<number | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const notify = useCallback(() => {
    onScaleChange(scaleRef.current, txRef.current, tyRef.current);
  }, [onScaleChange]);

  const scheduleNotify = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      notify();
    });
  }, [notify]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !enabled) return;

    const onPointerDown = (e: PointerEvent) => {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const pts = Array.from(activePointersRef.current.values());

      if (pts.length === 2) {
        const [a, b] = pts;
        lastDistRef.current = Math.hypot(b.x - a.x, b.y - a.y);
        lastMidRef.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        lastPanRef.current = null;
      } else if (pts.length === 1 && allowSingleFingerPan && scaleRef.current > 1) {
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        lastDistRef.current = null;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!activePointersRef.current.has(e.pointerId)) return;
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const pts = Array.from(activePointersRef.current.values());

      if (pts.length === 2 && lastDistRef.current !== null && lastMidRef.current) {
        e.preventDefault();

        const [a, b] = pts;
        const newDist = Math.hypot(b.x - a.x, b.y - a.y);
        const newMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

        const rect = el.getBoundingClientRect();
        // Punto focal en coordenadas del wrapper
        const focalX = newMid.x - rect.left;
        const focalY = newMid.y - rect.top;

        const prevScale = scaleRef.current;
        const rawScale = prevScale * (newDist / lastDistRef.current);
        const nextScale = Math.min(maxScale, Math.max(minScale, rawScale));

        // Zoom alrededor del punto focal
        // El punto en "world space" bajo el focal debe mantenerse igual
        const worldX = (focalX - txRef.current) / prevScale;
        const worldY = (focalY - tyRef.current) / prevScale;

        scaleRef.current = nextScale;
        txRef.current = focalX - worldX * nextScale;
        tyRef.current = focalY - worldY * nextScale;

        // Pan del midpoint
        const panDx = newMid.x - lastMidRef.current.x;
        const panDy = newMid.y - lastMidRef.current.y;
        txRef.current += panDx;
        tyRef.current += panDy;

        lastDistRef.current = newDist;
        lastMidRef.current = newMid;

        notify(); // inmediato, sin RAF para zoom
        return;
      }

      if (pts.length === 1 && allowSingleFingerPan && scaleRef.current > 1 && lastPanRef.current) {
        e.preventDefault();
        const dx = e.clientX - lastPanRef.current.x;
        const dy = e.clientY - lastPanRef.current.y;
        txRef.current += dx;
        tyRef.current += dy;
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        notify();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      activePointersRef.current.delete(e.pointerId);
      const pts = Array.from(activePointersRef.current.values());

      if (pts.length < 2) {
        lastDistRef.current = null;
        lastMidRef.current = null;
      }

      if (pts.length === 1 && allowSingleFingerPan && scaleRef.current > 1) {
        lastPanRef.current = { x: pts[0].x, y: pts[0].y };
      } else if (pts.length === 0) {
        lastPanRef.current = null;
        // Snap a scale=1 si está muy cerca
        if (Math.abs(scaleRef.current - 1) < 0.05) {
          scaleRef.current = 1;
          txRef.current = 0;
          tyRef.current = 0;
          notify();
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const focalX = e.clientX - rect.left;
      const focalY = e.clientY - rect.top;

      const prevScale = scaleRef.current;
      const delta = e.deltaY > 0 ? 0.93 : 1.07;
      const nextScale = Math.min(maxScale, Math.max(minScale, prevScale * delta));

      const worldX = (focalX - txRef.current) / prevScale;
      const worldY = (focalY - tyRef.current) / prevScale;

      scaleRef.current = nextScale;
      txRef.current = focalX - worldX * nextScale;
      tyRef.current = focalY - worldY * nextScale;

      if (Math.abs(scaleRef.current - 1) < 0.02) {
        scaleRef.current = 1;
        txRef.current = 0;
        tyRef.current = 0;
      }

      notify();
    };

    // Pan con scroll cuando hay zoom
    const onScroll = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (scaleRef.current <= 1) return;
      e.preventDefault();
      txRef.current -= e.deltaX;
      tyRef.current -= e.deltaY;
      notify();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove, { passive: false });
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [wrapperRef, enabled, minScale, maxScale, allowSingleFingerPan, notify, scheduleNotify]);

  return scaleRef;
}
