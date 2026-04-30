import { useRef, useCallback, useEffect } from 'react';

export type GestureIntent = 'idle' | 'drawing' | 'panning' | 'zooming';

export interface GestureState {
  intent: GestureIntent;
  activePointers: Map<number, { x: number; y: number; type: string; width: number; height: number }>;
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
  isLargeTouchDevice: boolean;
}

// Palm rejection: detect if a touch is likely a palm/hand resting on screen
function isPalmTouch(e: PointerEvent): boolean {
  if (e.pointerType !== 'touch') return false;

  const w = (e as any).width ?? 0;
  const h = (e as any).height ?? 0;

  // Palm: large contact area (> ~25px on either axis)
  if (w > 25 || h > 25) return true;

  // Palm: very wide aspect ratio contact
  if (w > 0 && h > 0) {
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (ratio > 4 && (w > 15 || h > 15)) return true;
  }

  // Palm: near edge of screen (common rest position for hand)
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const edgeMargin = 30;
  if (
    e.clientX < edgeMargin ||
    e.clientX > screenW - edgeMargin ||
    e.clientY > screenH - edgeMargin
  ) {
    // Only reject if also has some size
    if (w > 10 || h > 10) return true;
  }

  return false;
}

// Detect if this is likely an accidental touch while pen is nearby
function isPenProximityTouch(
  e: PointerEvent,
  penActive: boolean,
  lastPenTime: number,
): boolean {
  if (e.pointerType !== 'touch') return false;

  // If pen was used recently (within 300ms), reject new touches
  if (penActive || (Date.now() - lastPenTime < 300)) return true;

  return false;
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
  const lastPenTimestamp = useRef(0);
  const rejectedPointers = useRef<Set<number>>(new Set());

  const getPinchInfo = useCallback((pointers: Map<number, { x: number; y: number; type: string; width: number; height: number }>) => {
    // Only use non-rejected touch pointers for pinch
    const pts = Array.from(pointers.entries())
      .filter(([id]) => !rejectedPointers.current.has(id))
      .map(([, v]) => v);
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }, []);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      const s = state.current;

      // === PALM REJECTION ===
      if (isPalmTouch(e)) {
        rejectedPointers.current.add(e.pointerId);
        return;
      }

      // === PEN PROXIMITY REJECTION ===
      if (isPenProximityTouch(e, drawingWithPen.current, lastPenTimestamp.current)) {
        rejectedPointers.current.add(e.pointerId);
        return;
      }

      // Track pointer
      s.activePointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType,
        width: (e as any).width ?? 0,
        height: (e as any).height ?? 0,
      });

      const touchPointers = Array.from(s.activePointers.entries())
        .filter(([id, p]) => p.type === 'touch' && !rejectedPointers.current.has(id));

      // === PEN / STYLUS: always draw ===
      if (e.pointerType === 'pen') {
        if (!options.isDrawingEnabled) return;
        s.activePenId = e.pointerId;
        drawingWithPen.current = true;
        lastPenTimestamp.current = Date.now();
        intentLockRef.current = 'drawing';
        s.intent = 'drawing';
        callbacks.onDrawStart(e);
        try { (el as any).setPointerCapture?.(e.pointerId); } catch {}
        return;
      }

      // === TOUCH ===
      if (e.pointerType === 'touch') {
        // 2+ valid touch pointers = zoom (always)
        if (touchPointers.length >= 2) {
          if (intentLockRef.current === 'drawing' && !drawingWithPen.current) {
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

        // If pen is currently drawing, reject all finger touches
        if (drawingWithPen.current) {
          rejectedPointers.current.add(e.pointerId);
          s.activePointers.delete(e.pointerId);
          return;
        }

        // 1 finger on tablet = pan
        if (options.isLargeTouchDevice && touchPointers.length === 1) {
          intentLockRef.current = 'panning';
          s.intent = 'panning';
          lastPinchMid.current = { x: e.clientX, y: e.clientY };
          callbacks.onPanStart({ x: e.clientX, y: e.clientY });
          return;
        }

        // 1 finger on phone/touch-laptop = draw
        if (!options.isLargeTouchDevice && touchPointers.length === 1 && options.isDrawingEnabled) {
          if (intentLockRef.current === 'idle') {
            intentLockRef.current = 'drawing';
            s.intent = 'drawing';
            callbacks.onDrawStart(e);
            try { (el as any).setPointerCapture?.(e.pointerId); } catch {}
            return;
          }
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

      // Skip rejected pointers
      if (rejectedPointers.current.has(e.pointerId)) return;

      // Update pointer position
      if (s.activePointers.has(e.pointerId)) {
        s.activePointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          type: e.pointerType,
          width: (e as any).width ?? 0,
          height: (e as any).height ?? 0,
        });
      }

      // Track pen timestamp for proximity rejection
      if (e.pointerType === 'pen') {
        lastPenTimestamp.current = Date.now();
      }

      const intent = intentLockRef.current;

      // Drawing
      if (intent === 'drawing') {
        if (e.pointerId === s.activePenId || e.pointerType !== 'pen') {
          const events = (e as any).getCoalescedEvents?.() ?? [e];
          for (const ce of events) {
            callbacks.onDrawMove(ce);
          }
        }
        return;
      }

      // Panning (1 finger on tablet)
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

      // Clean up rejected pointer
      if (rejectedPointers.current.has(e.pointerId)) {
        rejectedPointers.current.delete(e.pointerId);
        s.activePointers.delete(e.pointerId);
        return;
      }

      const intent = intentLockRef.current;

      if (intent === 'drawing') {
        callbacks.onDrawEnd(e);
        if (e.pointerType === 'pen') {
          drawingWithPen.current = false;
          lastPenTimestamp.current = Date.now();
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
        if (options.isLargeTouchDevice) {
          intentLockRef.current = 'panning';
          const ptr = Array.from(s.activePointers.values())[0];
          lastPinchMid.current = { x: ptr.x, y: ptr.y };
        } else {
          intentLockRef.current = 'idle';
          s.intent = 'idle';
        }
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      rejectedPointers.current.delete(e.pointerId);
      state.current.activePointers.delete(e.pointerId);
      if (intentLockRef.current === 'drawing') {
        callbacks.onDrawEnd(e);
        drawingWithPen.current = false;
        lastPenTimestamp.current = Date.now();
        state.current.activePenId = null;
      }
      if (state.current.activePointers.size === 0) {
        intentLockRef.current = 'idle';
        state.current.intent = 'idle';
        lastPinchDist.current = null;
        lastPinchMid.current = null;
      }
    };

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
  ]);

  return state;
}
