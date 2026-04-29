import { useRef, useEffect, useCallback } from 'react';

interface PinchZoomOptions {
  enabled?: boolean;
  minScale?: number;
  maxScale?: number;
  onScaleChange?: (scale: number, tx: number, ty: number) => void;
}

/**
 * Handles pinch-to-zoom and two-finger pan on the scroll container.
 * Does NOT conflict with single-finger drawing because the gesture
 * manager in EditorCanvas already gates those events.
 *
 * This hook applies a CSS transform to an inner element for smooth zoom.
 */
export function usePinchZoom(
  wrapperRef: React.RefObject<HTMLElement>,
  onScaleChange: (scale: number, tx: number, ty: number) => void,
  opts: PinchZoomOptions = {},
): React.MutableRefObject<number> {
  const {
    enabled = true,
    minScale = 0.5,
    maxScale = 4,
  } = opts;

  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const lastDistRef = useRef<number | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeTouchCount = useRef(0);

  const scheduleNotify = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onScaleChange(scaleRef.current, txRef.current, tyRef.current);
    });
  }, [onScaleChange]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !enabled) return;

    const getDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const getMid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });

    const onTouchStart = (e: TouchEvent) => {
      activeTouchCount.current = e.touches.length;
      if (e.touches.length !== 2) return;
      lastDistRef.current = getDist(e.touches);
      lastMidRef.current = getMid(e.touches);
    };

    const onTouchMove = (e: TouchEvent) => {
      activeTouchCount.current = e.touches.length;
      if (e.touches.length !== 2 || lastDistRef.current === null || !lastMidRef.current) return;

      e.preventDefault();

      const newDist = getDist(e.touches);
      const newMid = getMid(e.touches);
      const ratio = newDist / lastDistRef.current;
      const prevScale = scaleRef.current;
      const nextScale = Math.min(maxScale, Math.max(minScale, prevScale * ratio));

      const rect = el.getBoundingClientRect();
      const ox = newMid.x - rect.left + el.scrollLeft;
      const oy = newMid.y - rect.top + el.scrollTop;

      // Zoom around pinch midpoint
      const scaleRatio = nextScale / prevScale;
      let nextTx = txRef.current + ox * (1 - scaleRatio);
      let nextTy = tyRef.current + oy * (1 - scaleRatio);

      // Pan delta from mid movement
      nextTx += newMid.x - lastMidRef.current.x;
      nextTy += newMid.y - lastMidRef.current.y;

      scaleRef.current = nextScale;
      txRef.current = nextTx;
      tyRef.current = nextTy;
      lastDistRef.current = newDist;
      lastMidRef.current = newMid;

      scheduleNotify();
    };

    const onTouchEnd = (e: TouchEvent) => {
      activeTouchCount.current = e.touches.length;
      if (e.touches.length < 2) {
        lastDistRef.current = null;
        lastMidRef.current = null;
      }
    };

    // Wheel zoom (trackpad / mouse)
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.05 : 0.95;
      const prevScale = scaleRef.current;
      const nextScale = Math.min(maxScale, Math.max(minScale, prevScale * delta));
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left + el.scrollLeft;
      const oy = e.clientY - rect.top + el.scrollTop;
      const scaleRatio = nextScale / prevScale;
      scaleRef.current = nextScale;
      txRef.current = txRef.current + ox * (1 - scaleRatio);
      tyRef.current = tyRef.current + oy * (1 - scaleRatio);
      scheduleNotify();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [wrapperRef, enabled, minScale, maxScale, scheduleNotify]);

  return scaleRef;
}
