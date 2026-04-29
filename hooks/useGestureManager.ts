import { useRef, useCallback, useEffect } from 'react';

export type GestureIntent = 'idle' | 'drawing' | 'panning' | 'zooming';

export interface GestureState {
  intent: GestureIntent;
  activePointers: Map<number, { x: number; y: number; type: string }>;
  pinchStartDist: number | null;
  pinchStartMid: { x: number; y: number } | null;
  panStart: { x: number; y: number } | null;
  activePenId: number | null;
}

interface GestureCallbacks {
  onDrawStart: (e: PointerEvent) => void;
  onDrawMove: (e: PointerEvent) => void;
  onDrawEnd: (e: PointerEvent) => void;
  onPanStart: (mid: { x: number; y: number }) => void;
  onPanMove: (mid: { x: number; y: number }, delta: { dx: number; dy: number }) => void;
  onPanEnd: () => void;
  onZoom: (
    center: { x: number; y: number },
    scaleDelta: number,
    panDelta: { dx: number; dy: number }
  ) => void;
  onZoomEnd: () => void;
}

interface GestureOptions {
  isDrawingEnabled: boolean;
  isPanZoomEnabled: boolean;
  // Large touch device = iPad/tablet
  isLargeTouchDevice: boolean;
}

export function useGestureManager(
  targetRef: React.RefObject<HTMLElement>,
  callbacks: GestureCallbacks,
  options: GestureOptions,
) {
  const state = useRef<GestureState>({
    intent: 'idle',
    activePointers: new Map(),
    pinchStartDist: null,
    pinchStartMid: null,
    panStart: null,
    activePenId: null,
  });

  const lastPinchDist = useRef<number | null>(null);
  const lastPinchMid = useRef<{ x: number; y: number } | null>(null);
  const intentLockRef = useRef<GestureIntent>('idle');
  const drawingWithPen = useRef(false);

  const getPinchInfo = useCallback((pointers: Map<number, { x: number; y: number; type: string }>) => {
    const pts = Array.from(pointers.values());
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }, []);

  const shouldIgnoreForDrawing = useCallback((e: PointerEvent): boolean => {
    const s = state.current;

    // Apple Pencil / stylus: always draw
    if (e.pointerType === 'pen') return false;

    // On large touch devices (iPad), finger = pan/zoom, not draw
    if (e.pointerType === 'touch' && options.isLargeTouchDevice) return true;

    // Palm rejection: large touch area
    if (e.pointerType === 'touch') {
      const w = (e as any).width ?? 0;
      const h = (e as any).height ?? 0;
      if (w > 50 || h > 50) return true;
    }

    // If pen is actively drawing, ignore other pointers
    if (drawingWithPen.current && e.pointerType !== 'pen') return true;

    // If 2+ touch pointers active, ignore new touches for drawing
    const touchCount = Array.from(s.activePointers.values())
      .filter(p => p.type === 'touch').length;
    if (touchCount >= 2 && e.pointerType === 'touch') return true;

    return false;
  }, [options.isLargeTouchDevice]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      const s = state.current;

      // Track pointer
      s.activePointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType,
      });

      const touchPointers = Array.from(s.activePointers.values())
        .filter(p => p.type === 'touch');
      const penPointers = Array.from(s.activePointers.values())
        .filter(p => p.type === 'pen');

      // === PEN / STYLUS ===
      if (e.pointerType === 'pen') {
        if (!options.isDrawingEnabled) return;
        s.activePenId = e.pointerId;
        drawingWithPen.current = true;
        intentLockRef.current = 'drawing';
        s.intent = 'drawing';
        callbacks.onDrawStart(e);
        try { (el as any).setPointerCapture?.(e.pointerId); } catch {}
        return;
      }

      // === TOUCH ===
      if (e.pointerType === 'touch') {
        // 1 finger on non-large-touch device = draw
        if (!options.isLargeTouchDevice && touchPointers.length === 1 && options.isDrawingEnabled) {
          if (intentLockRef.current === 'idle') {
            intentLockRef.current = 'drawing';
            s.intent = 'drawing';
            callbacks.onDrawStart(e);
            try { (el as any).setPointerCapture?.(e.pointerId); } catch {}
            return;
          }
        }

        // 2 fingers = pan/zoom (cancel any draw in progress)
        if (touchPointers.length === 2 && options.isPanZoomEnabled) {
          if (intentLockRef.current === 'drawing') {
            callbacks.onDrawEnd(e);
          }
          intentLockRef.current = 'zooming';
          s.intent = 'zooming';
          const info = getPinchInfo(s.activePointers);
          if (info) {
            lastPinchDist.current = info.dist;
            lastPinchMid.current = info.mid;
          }
          return;
        }

        // 1 finger on iPad = pan
        if (options.isLargeTouchDevice && touchPointers.length === 1 && options.isPanZoomEnabled) {
          intentLockRef.current = 'panning';
          s.intent = 'panning';
          s.panStart = { x: e.clientX, y: e.clientY };
          lastPinchMid.current = { x: e.clientX, y: e.clientY };
          callbacks.onPanStart({ x: e.clientX, y: e.clientY });
          return;
        }
      }

      // === MOUSE ===
      if (e.pointerType === 'mouse' && options.isDrawingEnabled) {
        const isEraserBtn = e.button === 5 || e.buttons === 32;
        if (!isEraserBtn) {
          intentLockRef.current = 'drawing';
          s.intent = 'drawing';
          callbacks.onDrawStart(e);
          try { (el as any).setPointerCapture?.(e.pointerId); } catch {}
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const s = state.current;

      // Update pointer position
      if (s.activePointers.has(e.pointerId)) {
        s.activePointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          type: e.pointerType,
        });
      }

      const intent = intentLockRef.current;

      // Drawing
      if (intent === 'drawing') {
        if (e.pointerId === s.activePenId || e.pointerType !== 'pen') {
          // Use getCoalescedEvents for sub-frame precision
          const events = (e as any).getCoalescedEvents?.() ?? [e];
          for (const ce of events) {
            callbacks.onDrawMove(ce);
          }
        }
        return;
      }

      // Panning (1 finger iPad)
      if (intent === 'panning') {
        if (lastPinchMid.current) {
          const dx = e.clientX - lastPinchMid.current.x;
          const dy = e.clientY - lastPinchMid.current.y;
          callbacks.onPanMove({ x: e.clientX, y: e.clientY }, { dx, dy });
          lastPinchMid.current = { x: e.clientX, y: e.clientY };
        }
        return;
      }

      // Pinch zoom
      if (intent === 'zooming') {
        const info = getPinchInfo(s.activePointers);
        if (!info || lastPinchDist.current === null || !lastPinchMid.current) return;

        const scaleDelta = info.dist / lastPinchDist.current;
        const dx = info.mid.x - lastPinchMid.current.x;
        const dy = info.mid.y - lastPinchMid.current.y;

        callbacks.onZoom(info.mid, scaleDelta, { dx, dy });

        lastPinchDist.current = info.dist;
        lastPinchMid.current = info.mid;
        e.preventDefault();
        return;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const s = state.current;
      const intent = intentLockRef.current;

      if (intent === 'drawing') {
        callbacks.onDrawEnd(e);
        if (e.pointerType === 'pen') {
          drawingWithPen.current = false;
          s.activePenId = null;
        }
      } else if (intent === 'panning') {
        callbacks.onPanEnd();
      } else if (intent === 'zooming') {
        callbacks.onZoomEnd();
      }

      s.activePointers.delete(e.pointerId);

      const remaining = s.activePointers.size;
      if (remaining === 0) {
        intentLockRef.current = 'idle';
        s.intent = 'idle';
        lastPinchDist.current = null;
        lastPinchMid.current = null;
        drawingWithPen.current = false;
      } else if (remaining === 1 && intentLockRef.current === 'zooming') {
        // Back to panning
        if (options.isLargeTouchDevice) {
          intentLockRef.current = 'panning';
          const remaining_ptr = Array.from(s.activePointers.values())[0];
          lastPinchMid.current = { x: remaining_ptr.x, y: remaining_ptr.y };
        } else {
          intentLockRef.current = 'idle';
          s.intent = 'idle';
        }
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      state.current.activePointers.delete(e.pointerId);
      if (intentLockRef.current === 'drawing') {
        callbacks.onDrawEnd(e);
        drawingWithPen.current = false;
        state.current.activePenId = null;
      }
      if (state.current.activePointers.size === 0) {
        intentLockRef.current = 'idle';
        state.current.intent = 'idle';
      }
    };

    // Prevent context menu on long press (iPad)
    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onPointerDown, { passive: false });
    el.addEventListener('pointermove', onPointerMove, { passive: false });
    el.addEventListener('pointerup', onPointerUp, { passive: true });
    el.addEventListener('pointercancel', onPointerCancel, { passive: true });
    el.addEventListener('contextmenu', onContextMenu);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [
    targetRef,
    callbacks,
    options.isDrawingEnabled,
    options.isPanZoomEnabled,
    options.isLargeTouchDevice,
    getPinchInfo,
    shouldIgnoreForDrawing,
  ]);

  return state;
}
