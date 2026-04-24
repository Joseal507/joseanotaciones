'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BloqueImagen } from './types';

interface Props {
  bloque: BloqueImagen;
  temaColor: string;
  onUpdate: (changes: Partial<BloqueImagen>) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
}

export default function ImageBlock({ bloque, temaColor, onUpdate, onDelete, onDuplicate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
  const [pos, setPos] = useState({ x: bloque.x, y: bloque.y });
  const [width, setWidth] = useState(bloque.width);
  const [rotation, setRotation] = useState((bloque as any).rotation || 0);
  const [showMenu, setShowMenu] = useState(false);

  const posRef = useRef(pos);
  const widthRef = useRef(width);
  const dragging = useRef(false);
  const resizing = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, mx: 0, my: 0 });
  const resizeStart = useRef({ w: 0, mx: 0 });
  const longPress = useRef<any>(null);

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { widthRef.current = width; }, [width]);

  useEffect(() => {
    setPos({ x: bloque.x, y: bloque.y });
    setWidth(bloque.width);
    setRotation((bloque as any).rotation || 0);
  }, [bloque.x, bloque.y, bloque.width]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragging.current) {
        setPos({
          x: Math.max(0, dragStart.current.x + e.clientX - dragStart.current.mx),
          y: Math.max(0, dragStart.current.y + e.clientY - dragStart.current.my),
        });
      }
      if (resizing.current) {
        setWidth(Math.max(60, resizeStart.current.w + e.clientX - resizeStart.current.mx));
      }
    };
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        onUpdate({ x: posRef.current.x, y: posRef.current.y });
      }
      if (resizing.current) {
        resizing.current = false;
        onUpdate({ width: widthRef.current });
      }
      if (longPress.current) clearTimeout(longPress.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onUpdate]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setSelected(false);
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setSelected(true);
    const startX = posRef.current.x;
    const startY = posRef.current.y;
    const mx = e.clientX;
    const my = e.clientY;

    longPress.current = setTimeout(() => {
      dragging.current = true;
      dragStart.current = { x: startX, y: startY, mx, my };
    }, 150);
  };

  const rotateLeft = () => {
    const r = ((rotation - 90) + 360) % 360;
    setRotation(r);
    onUpdate({ rotation: r } as any);
  };

  const rotateRight = () => {
    const r = (rotation + 90) % 360;
    setRotation(r);
    onUpdate({ rotation: r } as any);
  };

  const flipH = () => {
    const curr = (bloque as any).flipH || false;
    onUpdate({ flipH: !curr } as any);
  };

  const aspectRatio = bloque.width / (bloque.width || 1);

  return (
    <div
      ref={containerRef}
      data-image="true"
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: width,
        zIndex: selected ? 30 : (bloque.zIndex || 2),
        cursor: dragging.current ? 'grabbing' : 'grab',
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={e => { e.stopPropagation(); setShowMenu(true); }}
    >
      {/* Image */}
      <div style={{
        transform: `rotate(${rotation}deg) scaleX(${(bloque as any).flipH ? -1 : 1})`,
        transformOrigin: 'center center',
        border: selected ? `2px solid ${temaColor}` : '2px solid transparent',
        borderRadius: '6px',
        overflow: 'hidden',
        boxShadow: selected ? `0 0 0 3px ${temaColor}30` : 'none',
        transition: 'border 0.1s',
      }}>
        <img
          src={bloque.src}
          alt={bloque.label || 'Image'}
          draggable={false}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Label */}
      {bloque.label && (
        <div style={{ textAlign: 'center', fontSize: '11px', color: temaColor, fontWeight: 700, marginTop: '4px' }}>
          {bloque.label}
        </div>
      )}

      {/* Selected controls */}
      {selected && (
        <>
          {/* Resize handle */}
          <div
            data-resize="true"
            onPointerDown={e => {
              e.stopPropagation();
              e.preventDefault();
              if (longPress.current) clearTimeout(longPress.current);
              resizing.current = true;
              resizeStart.current = { w: widthRef.current, mx: e.clientX };
            }}
            style={{
              position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
              width: 14, height: 30, background: temaColor, borderRadius: 7,
              cursor: 'ew-resize', zIndex: 50,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
            }}
          >
            {[0,1,2].map(i => <div key={i} style={{ width: 2, height: 2, borderRadius: '50%', background: '#000' }} />)}
          </div>

          {/* Quick action toolbar */}
          <div
            onPointerDown={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: -44,
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#1c1c28',
              borderRadius: 10,
              border: '1px solid rgba(245,200,66,0.2)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '4px 6px',
              zIndex: 200,
              whiteSpace: 'nowrap',
            }}
          >
            {/* Rotate left */}
            <button onClick={rotateLeft} title="Rotate left" style={btnStyle}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f5c842" strokeWidth="2.5"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>
            </button>
            {/* Rotate right */}
            <button onClick={rotateRight} title="Rotate right" style={btnStyle}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f5c842" strokeWidth="2.5"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/></svg>
            </button>
            {/* Flip horizontal */}
            <button onClick={flipH} title="Flip horizontal" style={btnStyle}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f5c842" strokeWidth="2"><path d="M12 3v18M4 7l4 5-4 5M20 7l-4 5 4 5"/></svg>
            </button>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
            {/* Duplicate */}
            {onDuplicate && (
              <button onClick={onDuplicate} title="Duplicate" style={btnStyle}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              </button>
            )}
            {/* Size down */}
            <button onClick={() => { const w = Math.max(60, width - 40); setWidth(w); onUpdate({ width: w }); }} title="Smaller" style={btnStyle}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            {/* Size up */}
            <button onClick={() => { const w = width + 40; setWidth(w); onUpdate({ width: w }); }} title="Larger" style={btnStyle}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
            {/* Delete */}
            <button onClick={onDelete} title="Delete" style={btnStyle}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 7, border: 'none',
  background: 'transparent', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
