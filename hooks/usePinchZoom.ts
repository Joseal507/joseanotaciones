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
    minScale = 1,
    maxScale = 4,
    allowSingleFingerPan = true,
  } = opts;

  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);

  const lastDistRef = useRef<number | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const lastPanPointRef = useRef<{ x: number; y: number } | null>(null);

  const clampScale = useCallback((v: number) => {
    return Math.min(maxScale, Math.max(minScale, v));
  }, [minScale, maxScale]);

  const notify = useCallback(() => {
    onScaleChange(scaleRef.current, txRef.current, tyRef.current);
  }, [onScaleChange]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !enabled) return;

    const getContentEl = () => el.firstElementChild as HTMLElement | null;

    const getMetrics = () => {
      const content = getContentEl();
      return {
        viewportW: el.clientWidth,
        viewportH: el.clientHeight,
        contentW: content?.offsetWidth ?? el.clientWidth,
        contentH: content?.offsetHeight ?? el.clientHeight,
        baseLeft: content?.offsetLeft ?? 0,
        baseTop: content?.offsetTop ?? 0,
      };
    };

    const clampTransform = (nextScale: number, nextTx: number, nextTy: number) => {
      if (nextScale <= 1.001) {
        return { scale: 1, tx: 0, ty: 0 };
      }

      const { viewportW, viewportH, contentW, contentH, baseLeft, baseTop } = getMetrics();
      const scaledW = contentW * nextScale;
      const scaledH = contentH * nextScale;
      const margin = 40;

      let minTx = viewportW - baseLeft - scaledW - margin;
      let maxTx = -baseLeft + margin;
      let minTy = viewportH - baseTop - scaledH - margin;
      let maxTy = -baseTop + margin;

      if (scaledW + margin * 2 <= viewportW) {
        minTx = 0;
        maxTx = 0;
      }
      if (scaledH + margin * 2 <= viewportH) {
        minTy = 0;
        maxTy = 0;
      }

      return {
        scale: nextScale,
        tx: Math.min(maxTx, Math.max(minTx, nextTx)),
        ty: Math.min(maxTy, Math.max(minTy, nextTy)),
      };
    };

    const toLocal = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    };

    const zoomAroundClientPoint = (clientX: number, clientY: number, rawNextScale: number) => {
      const { baseLeft, baseTop } = getMetrics();
      const local = toLocal(clientX, clientY);

      const prevScale = scaleRef.current;
      const nextScale = clampScale(rawNextScale);

      const worldX = (local.x - baseLeft - txRef.current) / prevScale;
      const worldY = (local.y - baseTop - tyRef.current) / prevScale;

      const nextTx = local.x - baseLeft - worldX * nextScale;
      const nextTy = local.y - baseTop - worldY * nextScale;

      const clamped = clampTransform(nextScale, nextTx, nextTy);
      scaleRef.current = clamped.scale;
      txRef.current = clamped.tx;
      tyRef.current = clamped.ty;
    };

    const panBy = (dx: number, dy: number) => {
      const clamped = clampTransform(
        scaleRef.current,
        txRef.current + dx,
        tyRef.current + dy,
      );
      scaleRef.current = clamped.scale;
      txRef.current = clamped.tx;
      tyRef.current = clamped.ty;
    };

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
        const ratio = newDist / lastDistRef.current;

        zoomAroundClientPoint(newMid.x, newMid.y, scaleRef.current * ratio);

        lastDistRef.current = newDist;
        lastMidRef.current = newMid;
        notify();
        return;
      }

      if (allowSingleFingerPan && e.touches.length === 1 && scaleRef.current > 1) {
        const touch = e.touches[0];

        if (!lastPanPointRef.current) {
          lastPanPointRef.current = { x: touch.clientX, y: touch.clientY };
          return;
        }

        e.preventDefault();
        panBy(
          touch.clientX - lastPanPointRef.current.x,
          touch.clientY - lastPanPointRef.current.y,
        );

        lastPanPointRef.current = { x: touch.clientX, y: touch.clientY };
        notify();
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
      const isZoom = e.ctrlKey || e.metaKey;

      if (isZoom) {
        e.preventDefault();
        e.stopPropagation();

        const factor = e.deltaY > 0 ? 0.93 : 1.08;
        zoomAroundClientPoint(e.clientX, e.clientY, scaleRef.current * factor);
        notify();
        return;
      }

      if (scaleRef.current > 1) {
        e.preventDefault();
        e.stopPropagation();

        const panSpeed = 1.15;
        panBy(-e.deltaX * panSpeed, -e.deltaY * panSpeed);
        notify();
      }
    };

    const onResize = () => {
      const clamped = clampTransform(scaleRef.current, txRef.current, tyRef.current);
      scaleRef.current = clamped.scale;
      txRef.current = clamped.tx;
      tyRef.current = clamped.ty;
      notify();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    };
  }, [wrapperRef, enabled, clampScale, allowSingleFingerPan, notify]);

  return scaleRef;
}
