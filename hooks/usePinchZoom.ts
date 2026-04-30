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
  const { enabled = true, minScale = 1, maxScale = 5 } = opts;

  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);

  // Touch-based pinch (iOS/iPad) — usa TouchEvent, no PointerEvent
  // así NO interfiere con el PointerEvent del canvas
  const lastTouchDistRef = useRef<number | null>(null);
  const lastTouchMidRef = useRef<{ x: number; y: number } | null>(null);

  const notify = useCallback(() => {
    onScaleChange(scaleRef.current, txRef.current, tyRef.current);
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
      if (e.touches.length === 2) {
        lastTouchDistRef.current = getDist(e.touches);
        lastTouchMidRef.current = getMid(e.touches);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      if (lastTouchDistRef.current === null || !lastTouchMidRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      const newDist = getDist(e.touches);
      const newMid = getMid(e.touches);
      const rect = el.getBoundingClientRect();

      // Punto focal relativo al wrapper
      const focalX = newMid.x - rect.left;
      const focalY = newMid.y - rect.top;

      const prevScale = scaleRef.current;
      const rawScale = prevScale * (newDist / lastTouchDistRef.current);
      const nextScale = Math.min(maxScale, Math.max(minScale, rawScale));

      // Zoom matemáticamente estable
      const worldX = (focalX - txRef.current) / prevScale;
      const worldY = (focalY - tyRef.current) / prevScale;

      scaleRef.current = nextScale;
      txRef.current = focalX - worldX * nextScale;
      tyRef.current = focalY - worldY * nextScale;

      // Pan del midpoint
      const lastMid = lastTouchMidRef.current;
      txRef.current += newMid.x - lastMid.x;
      tyRef.current += newMid.y - lastMid.y;

      lastTouchDistRef.current = newDist;
      lastTouchMidRef.current = newMid;

      // Snap a identity si muy cerca
      if (Math.abs(scaleRef.current - 1) < 0.03) {
        scaleRef.current = 1;
        txRef.current = 0;
        tyRef.current = 0;
      }

      notify();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        lastTouchDistRef.current = null;
        lastTouchMidRef.current = null;
      }
    };

    // Wheel zoom para trackpad/mouse (desktop)
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const focalX = e.clientX - rect.left;
      const focalY = e.clientY - rect.top;

      const prevScale = scaleRef.current;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const nextScale = Math.min(maxScale, Math.max(minScale, prevScale * factor));

      const worldX = (focalX - txRef.current) / prevScale;
      const worldY = (focalY - tyRef.current) / prevScale;

      scaleRef.current = nextScale;
      txRef.current = focalX - worldX * nextScale;
      tyRef.current = focalY - worldY * nextScale;

      if (scaleRef.current < 1.02) {
        scaleRef.current = 1;
        txRef.current = 0;
        tyRef.current = 0;
      }

      notify();
    };

    // TouchEvent — no interfiere con PointerEvent del canvas
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
    };
  }, [wrapperRef, enabled, minScale, maxScale, notify]);

  return scaleRef;
}
