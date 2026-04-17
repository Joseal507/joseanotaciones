import { useRef, useEffect } from 'react';

export function usePinchZoom(
  wrapperRef: React.RefObject<HTMLDivElement>,
  onScaleChange: (scale: number, tx: number, ty: number) => void,
): React.MutableRefObject<number> {
  const scale = useRef(1);
  const translateX = useRef(0);
  const translateY = useRef(0);
  const lastDist = useRef<number | null>(null);
  const lastMidX = useRef(0);
  const lastMidY = useRef(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const getDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const getMid = (t: TouchList) => ({
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        lastDist.current = getDist(e.touches);
        const mid = getMid(e.touches);
        lastMidX.current = mid.x;
        lastMidY.current = mid.y;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || lastDist.current === null) return;
      e.preventDefault();
      const newDist = getDist(e.touches);
      const mid = getMid(e.touches);
      const ratio = newDist / lastDist.current;
      const prevScale = scale.current;
      scale.current = Math.min(5, Math.max(0.3, scale.current * ratio));
      const rect = wrapper.getBoundingClientRect();
      const ox = mid.x - rect.left;
      const oy = mid.y - rect.top;
      translateX.current = ox - (ox - translateX.current) * (scale.current / prevScale);
      translateY.current = oy - (oy - translateY.current) * (scale.current / prevScale);
      translateX.current += mid.x - lastMidX.current;
      translateY.current += mid.y - lastMidY.current;
      lastDist.current = newDist;
      lastMidX.current = mid.x;
      lastMidY.current = mid.y;
      onScaleChange(scale.current, translateX.current, translateY.current);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) lastDist.current = null;
    };

    let lastTap = 0;
    const onTouchEndDouble = (e: TouchEvent) => {
      onTouchEnd(e);
      if (e.touches.length === 0) {
        const now = Date.now();
        if (now - lastTap < 300) {
          scale.current = 1;
          translateX.current = 0;
          translateY.current = 0;
          onScaleChange(1, 0, 0);
        }
        lastTap = now;
      }
    };

    wrapper.addEventListener('touchstart', onTouchStart, { passive: true });
    wrapper.addEventListener('touchmove', onTouchMove, { passive: false });
    wrapper.addEventListener('touchend', onTouchEndDouble, { passive: true });
    wrapper.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      wrapper.removeEventListener('touchstart', onTouchStart);
      wrapper.removeEventListener('touchmove', onTouchMove);
      wrapper.removeEventListener('touchend', onTouchEndDouble);
      wrapper.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [wrapperRef, onScaleChange]);

  return scale;
}