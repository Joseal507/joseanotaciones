import { useRef, useEffect } from 'react';

interface Opts {
  enabled?: boolean;
}

export function usePinchZoom(
  wrapperRef: React.RefObject<HTMLDivElement>,
  onScaleChange: (scale: number, tx: number, ty: number) => void,
  opts: Opts = {},
): React.MutableRefObject<number> {
  const { enabled = true } = opts;

  const scale = useRef(1);
  const translateX = useRef(0);
  const translateY = useRef(0);
  const lastDist = useRef<number | null>(null);
  const lastMidX = useRef(0);
  const lastMidY = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !enabled) return;

    const getDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const getMid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });

    const applyChange = (nextScale: number, nextTx: number, nextTy: number) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        onScaleChange(nextScale, nextTx, nextTy);
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      lastDist.current = getDist(e.touches);
      const mid = getMid(e.touches);
      lastMidX.current = mid.x;
      lastMidY.current = mid.y;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || lastDist.current === null) return;

      e.preventDefault();

      const newDist = getDist(e.touches);
      const mid = getMid(e.touches);
      const ratio = newDist / lastDist.current;
      const prevScale = scale.current;

      const nextScale = Math.min(4, Math.max(0.6, prevScale * ratio));

      const rect = wrapper.getBoundingClientRect();
      const ox = mid.x - rect.left;
      const oy = mid.y - rect.top;

      let nextTx = ox - (ox - translateX.current) * (nextScale / prevScale);
      let nextTy = oy - (oy - translateY.current) * (nextScale / prevScale);

      nextTx += mid.x - lastMidX.current;
      nextTy += mid.y - lastMidY.current;

      scale.current = nextScale;
      translateX.current = nextTx;
      translateY.current = nextTy;
      lastDist.current = newDist;
      lastMidX.current = mid.x;
      lastMidY.current = mid.y;

      applyChange(nextScale, nextTx, nextTy);
    };

    const resetGesture = () => {
      lastDist.current = null;
    };

    wrapper.addEventListener('touchstart', onTouchStart, { passive: true });
    wrapper.addEventListener('touchmove', onTouchMove, { passive: false });
    wrapper.addEventListener('touchend', resetGesture, { passive: true });
    wrapper.addEventListener('touchcancel', resetGesture, { passive: true });

    return () => {
      wrapper.removeEventListener('touchstart', onTouchStart);
      wrapper.removeEventListener('touchmove', onTouchMove);
      wrapper.removeEventListener('touchend', resetGesture);
      wrapper.removeEventListener('touchcancel', resetGesture);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [wrapperRef, onScaleChange, enabled]);

  return scale;
}
