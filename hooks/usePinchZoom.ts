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
  const {
    enabled = true,
    minScale = 0.5,
    maxScale = 4,
    allowSingleFingerPan = true,
  } = opts;

  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);

  const lastDistRef = useRef<number | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const lastPanPointRef = useRef<{ x: number; y: number } | null>(null);

  const clamp = useCallback((v: number) => Math.min(maxScale, Math.max(minScale, v)), [minScale, maxScale]);

  // Notify inmediatamente — sin RAF throttling para que se sienta instantáneo
  const notify = useCallback(() => {
    onScaleChange(scaleRef.current, txRef.current, tyRef.current);
  }, [onScaleChange]);

  const snapToIdentity = useCallback(() => {
    if (Math.abs(scaleRef.current - 1) < 0.02) {
      scaleRef.current = 1;
      txRef.current = 0;
      tyRef.current = 0;
    }
  }, []);

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
        lastDistRef.current = getDist(e.touches);
        lastMidRef.current = getMid(e.touches);
        lastPanPointRef.current = null;
        return;
      }
      if (allowSingleFingerPan && e.touches.length === 1 && scaleRef.current > 1) {
        lastPanPointRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      // Pinch zoom
      if (e.touches.length === 2 && lastDistRef.current !== null && lastMidRef.current) {
        e.preventDefault();
        const newDist = getDist(e.touches);
        const newMid = getMid(e.touches);
        const rect = el.getBoundingClientRect();

        const prevScale = scaleRef.current;
        const nextScale = clamp(prevScale * (newDist / lastDistRef.current));
        const ratio = nextScale / prevScale;

        const ox = newMid.x - rect.left;
        const oy = newMid.y - rect.top;

        txRef.current = txRef.current * ratio + ox * (1 - ratio) + (newMid.x - lastMidRef.current.x);
        tyRef.current = tyRef.current * ratio + oy * (1 - ratio) + (newMid.y - lastMidRef.current.y);
        scaleRef.current = nextScale;

        lastDistRef.current = newDist;
        lastMidRef.current = newMid;
        snapToIdentity();
        notify();
        return;
      }

      // 1 finger pan
      if (allowSingleFingerPan && e.touches.length === 1 && scaleRef.current > 1) {
        const t = e.touches[0];
        if (!lastPanPointRef.current) {
          lastPanPointRef.current = { x: t.clientX, y: t.clientY };
          return;
        }
        e.preventDefault();
        txRef.current += t.clientX - lastPanPointRef.current.x;
        tyRef.current += t.clientY - lastPanPointRef.current.y;
        lastPanPointRef.current = { x: t.clientX, y: t.clientY };
        notify();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        lastDistRef.current = null;
        lastMidRef.current = null;
      }
      if (allowSingleFingerPan && e.touches.length === 1 && scaleRef.current > 1) {
        lastPanPointRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else {
        lastPanPointRef.current = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      const isZoom = e.ctrlKey || e.metaKey;
      const rect = el.getBoundingClientRect();

      if (isZoom) {
        e.preventDefault();
        e.stopPropagation();

        // Zoom rápido y responsivo
        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        const prevScale = scaleRef.current;
        const nextScale = clamp(prevScale * factor);
        const ratio = nextScale / prevScale;

        const ox = e.clientX - rect.left;
        const oy = e.clientY - rect.top;

        txRef.current = txRef.current * ratio + ox * (1 - ratio);
        tyRef.current = tyRef.current * ratio + oy * (1 - ratio);
        scaleRef.current = nextScale;

        snapToIdentity();
        notify();
        return;
      }

      // Scroll = pan cuando hay zoom
      if (scaleRef.current > 1) {
        e.preventDefault();
        txRef.current -= e.deltaX;
        tyRef.current -= e.deltaY;
        notify();
      }
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
    };
  }, [wrapperRef, enabled, clamp, snapToIdentity, allowSingleFingerPan, notify]);

  return scaleRef;
}
