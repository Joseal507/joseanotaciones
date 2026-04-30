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
    maxScale = 5,
    allowSingleFingerPan = false,
  } = opts;

  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);

  const ptr1 = useRef<{ id: number; x: number; y: number } | null>(null);
  const ptr2 = useRef<{ id: number; x: number; y: number } | null>(null);
  const lastDistRef = useRef<number | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const isZoomingRef = useRef(false);

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

    const getDist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(b.x - a.x, b.y - a.y);

    const getMid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });

    const onPointerDown = (e: PointerEvent) => {
      // Solo procesar touch — el pen lo maneja el gesture manager del canvas
      if (e.pointerType === 'pen') return;

      if (!ptr1.current) {
        ptr1.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      } else if (!ptr2.current && e.pointerId !== ptr1.current.id) {
        ptr2.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        // Iniciar pinch
        isZoomingRef.current = true;
        lastDistRef.current = getDist(ptr1.current, ptr2.current);
        lastMidRef.current = getMid(ptr1.current, ptr2.current);
        e.preventDefault();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'pen') return;

      // Actualizar posición del pointer
      if (ptr1.current && e.pointerId === ptr1.current.id) {
        ptr1.current = { ...ptr1.current, x: e.clientX, y: e.clientY };
      } else if (ptr2.current && e.pointerId === ptr2.current.id) {
        ptr2.current = { ...ptr2.current, x: e.clientX, y: e.clientY };
      } else {
        return;
      }

      // Pinch zoom con 2 dedos
      if (ptr1.current && ptr2.current && isZoomingRef.current) {
        e.preventDefault();

        const newDist = getDist(ptr1.current, ptr2.current);
        const newMid = getMid(ptr1.current, ptr2.current);

        if (lastDistRef.current === null || !lastMidRef.current) {
          lastDistRef.current = newDist;
          lastMidRef.current = newMid;
          return;
        }

        const rect = el.getBoundingClientRect();
        // Punto focal relativo al wrapper
        const focalX = newMid.x - rect.left;
        const focalY = newMid.y - rect.top;

        const prevScale = scaleRef.current;
        const rawScale = prevScale * (newDist / lastDistRef.current);
        const nextScale = Math.min(maxScale, Math.max(minScale, rawScale));

        // Zoom matemáticamente estable:
        // el punto world bajo el focal se mantiene fijo
        const worldX = (focalX - txRef.current) / prevScale;
        const worldY = (focalY - tyRef.current) / prevScale;

        scaleRef.current = nextScale;
        txRef.current = focalX - worldX * nextScale;
        tyRef.current = focalY - worldY * nextScale;

        // Pan del midpoint
        txRef.current += newMid.x - lastMidRef.current.x;
        tyRef.current += newMid.y - lastMidRef.current.y;

        lastDistRef.current = newDist;
        lastMidRef.current = newMid;

        // Notify inmediato — sin RAF para zoom fluido
        notify();
        return;
      }

      // Pan con 1 dedo cuando hay zoom
      if (
        allowSingleFingerPan &&
        ptr1.current &&
        !ptr2.current &&
        scaleRef.current > 1 &&
        lastMidRef.current &&
        !isZoomingRef.current
      ) {
        e.preventDefault();
        const dx = e.clientX - lastMidRef.current.x;
        const dy = e.clientY - lastMidRef.current.y;
        txRef.current += dx;
        tyRef.current += dy;
        lastMidRef.current = { x: e.clientX, y: e.clientY };
        notify();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'pen') return;

      if (ptr1.current?.id === e.pointerId) {
        ptr1.current = ptr2.current;
        ptr2.current = null;
      } else if (ptr2.current?.id === e.pointerId) {
        ptr2.current = null;
      }

      if (!ptr2.current) {
        isZoomingRef.current = false;
        lastDistRef.current = null;

        if (ptr1.current && allowSingleFingerPan && scaleRef.current > 1) {
          lastMidRef.current = { x: ptr1.current.x, y: ptr1.current.y };
        } else {
          lastMidRef.current = null;
        }

        // Snap a scale=1 si casi en identidad
        if (scaleRef.current < 1.05) {
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

    // Prevenir scroll del browser durante pinch
    const preventScroll = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };

    el.addEventListener('pointerdown', onPointerDown, { passive: false });
    el.addEventListener('pointermove', onPointerMove, { passive: false });
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchmove', preventScroll, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', preventScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [wrapperRef, enabled, minScale, maxScale, allowSingleFingerPan, notify, scheduleNotify]);

  return scaleRef;
}
