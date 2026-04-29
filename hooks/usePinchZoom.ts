import { useRef, useEffect, useCallback } from 'react';

interface PinchZoomOptions {
  enabled?: boolean;
  minScale?: number;
  maxScale?: number;
}

export function usePinchZoom(
  wrapperRef: React.RefObject<HTMLElement>,
  onScaleChange: (scale: number, tx: number, ty: number) => void,
  opts: PinchZoomOptions = {},
): React.MutableRefObject<number> {
  const { enabled = true, minScale = 0.5, maxScale = 4 } = opts;

  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const lastDistRef = useRef<number | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

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
      if (e.touches.length !== 2) return;
      lastDistRef.current = getDist(e.touches);
      lastMidRef.current = getMid(e.touches);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || lastDistRef.current === null || !lastMidRef.current) return;
      e.preventDefault();

      const newDist = getDist(e.touches);
      const newMid = getMid(e.touches);
      const prevScale = scaleRef.current;
      const nextScale = Math.min(maxScale, Math.max(minScale, prevScale * (newDist / lastDistRef.current)));

      const rect = el.getBoundingClientRect();
      const ox = newMid.x - rect.left;
      const oy = newMid.y - rect.top;
      const ratio = nextScale / prevScale;

      txRef.current = txRef.current + ox * (1 - ratio) + (newMid.x - lastMidRef.current.x);
      tyRef.current = tyRef.current + oy * (1 - ratio) + (newMid.y - lastMidRef.current.y);
      scaleRef.current = nextScale;
      lastDistRef.current = newDist;
      lastMidRef.current = newMid;

      scheduleNotify();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        lastDistRef.current = null;
        lastMidRef.current = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const prevScale = scaleRef.current;
      const nextScale = Math.min(maxScale, Math.max(minScale, prevScale * (e.deltaY < 0 ? 1.05 : 0.95)));
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const ratio = nextScale / prevScale;
      txRef.current = txRef.current + ox * (1 - ratio);
      tyRef.current = tyRef.current + oy * (1 - ratio);
      scaleRef.current = nextScale;
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
