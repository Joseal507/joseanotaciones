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

  const rafRef = useRef<number | null>(null);

  const scheduleNotify = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      onScaleChange(scaleRef.current, txRef.current, tyRef.current);
    });
  }, [onScaleChange]);

  const clampScale = useCallback((v: number) => {
    return Math.min(maxScale, Math.max(minScale, v));
  }, [minScale, maxScale]);

  const normalizeIfNearIdentity = useCallback(() => {
    if (Math.abs(scaleRef.current - 1) < 0.01) {
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

    const toLocal = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    };

    const zoomAroundPoint = (localX: number, localY: number, nextScale: number) => {
      const prevScale = scaleRef.current;
      const worldX = (localX - txRef.current) / prevScale;
      const worldY = (localY - tyRef.current) / prevScale;

      scaleRef.current = clampScale(nextScale);
      txRef.current = localX - worldX * scaleRef.current;
      tyRef.current = localY - worldY * scaleRef.current;

      normalizeIfNearIdentity();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        lastDistRef.current = getDist(e.touches);
        lastMidRef.current = getMid(e.touches);
        lastPanPointRef.current = null;
        return;
      }

      if (allowSingleFingerPan && e.touches.length === 1 && scaleRef.current > 1) {
        lastPanPointRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastDistRef.current !== null && lastMidRef.current) {
        e.preventDefault();

        const newDist = getDist(e.touches);
        const newMid = getMid(e.touches);

        const prevScale = scaleRef.current;
        const nextScale = clampScale(prevScale * (newDist / lastDistRef.current));

        const prevLocal = toLocal(lastMidRef.current.x, lastMidRef.current.y);
        const newLocal = toLocal(newMid.x, newMid.y);

        const worldX = (prevLocal.x - txRef.current) / prevScale;
        const worldY = (prevLocal.y - tyRef.current) / prevScale;

        scaleRef.current = nextScale;
        txRef.current = newLocal.x - worldX * nextScale;
        tyRef.current = newLocal.y - worldY * nextScale;

        lastDistRef.current = newDist;
        lastMidRef.current = newMid;

        normalizeIfNearIdentity();
        scheduleNotify();
        return;
      }

      if (allowSingleFingerPan && e.touches.length === 1 && scaleRef.current > 1) {
        const touch = e.touches[0];

        if (!lastPanPointRef.current) {
          lastPanPointRef.current = { x: touch.clientX, y: touch.clientY };
          return;
        }

        e.preventDefault();

        const dx = touch.clientX - lastPanPointRef.current.x;
        const dy = touch.clientY - lastPanPointRef.current.y;

        txRef.current += dx;
        tyRef.current += dy;

        lastPanPointRef.current = { x: touch.clientX, y: touch.clientY };
        scheduleNotify();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        lastDistRef.current = null;
        lastMidRef.current = null;
      }

      if (allowSingleFingerPan && e.touches.length === 1 && scaleRef.current > 1) {
        lastPanPointRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      } else {
        lastPanPointRef.current = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      const isZoomGesture = e.ctrlKey || e.metaKey;

      if (isZoomGesture) {
        e.preventDefault();

        const zoomFactor = Math.exp(-e.deltaY * 0.002);
        const local = toLocal(e.clientX, e.clientY);
        const nextScale = clampScale(scaleRef.current * zoomFactor);

        zoomAroundPoint(local.x, local.y, nextScale);
        scheduleNotify();
        return;
      }

      if (scaleRef.current > 1 && (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0)) {
        e.preventDefault();
        txRef.current -= e.deltaX;
        tyRef.current -= e.deltaY;
        scheduleNotify();
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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [wrapperRef, enabled, clampScale, normalizeIfNearIdentity, allowSingleFingerPan, scheduleNotify]);

  return scaleRef;
}
