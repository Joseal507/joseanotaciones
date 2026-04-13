'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BloqueImagen } from './types';

interface Props {
  bloque: BloqueImagen;
  temaColor: string;
  onUpdate: (changes: Partial<BloqueImagen>) => void;
  onDelete: () => void;
}

export default function ImageBlock({ bloque, temaColor, onUpdate, onDelete }: Props) {
  const [selected, setSelected] = useState(false);
  const [width, setWidth] = useState(bloque.width);
  const [pos, setPos] = useState({ x: bloque.x ?? 0, y: bloque.y ?? 0 });
  const [floating, setFloating] = useState(bloque.floating ?? false);
  const [zLayer, setZLayer] = useState(bloque.zIndex ?? 2);
  const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, elX: 0, elY: 0 });
  const resizing = useRef(false);
  const resizeSide = useRef<'left' | 'right'>('right');
  const resizeStart = useRef({ x: 0, w: 0 });
  const posRef = useRef(pos);
  const widthRef = useRef(width);

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { widthRef.current = width; }, [width]);

  // Click fuera deselecciona
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inToolbar = toolbarRef.current?.contains(target);
      if (!inContainer && !inToolbar) {
        setSelected(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Mouse global para drag y resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        const dx = e.clientX - dragStart.current.mouseX;
        const dy = e.clientY - dragStart.current.mouseY;
        const newPos = {
          x: dragStart.current.elX + dx,
          y: dragStart.current.elY + dy,
        };
        setPos(newPos);
        posRef.current = newPos;
        updateToolbarPos();
      }
      if (resizing.current) {
        const delta = e.clientX - resizeStart.current.x;
        const finalDelta = resizeSide.current === 'left' ? -delta : delta;
        const newW = Math.max(60, Math.min(1200, resizeStart.current.w + finalDelta));
        setWidth(newW);
        widthRef.current = newW;
        updateToolbarPos();
      }
    };

    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        onUpdate({ x: posRef.current.x, y: posRef.current.y, floating: true });
      }
      if (resizing.current) {
        resizing.current = false;
        onUpdate({ width: widthRef.current });
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const updateToolbarPos = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setToolbarPos({
      top: rect.top + window.scrollY - 62,
      left: rect.left + rect.width / 2,
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.dataset.resize) return;
    // NO hacer preventDefault para no perder foco del texto
    setSelected(true);
    updateToolbarPos();
    if (floating) {
      dragging.current = true;
      dragStart.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        elX: posRef.current.x,
        elY: posRef.current.y,
      };
    }
  };

  const startResize = (e: React.MouseEvent, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeSide.current = side;
    resizeStart.current = { x: e.clientX, w: widthRef.current };
  };

  const handleZLayer = (z: number) => {
    setZLayer(z);
    onUpdate({ zIndex: z });
  };

  const handleWidth = (w: number) => {
    setWidth(w);
    widthRef.current = w;
    onUpdate({ width: w });
  };

  const makeFloating = () => {
    setFloating(true);
    onUpdate({ floating: true, x: posRef.current.x, y: posRef.current.y });
  };

  const makeInline = () => {
    setFloating(false);
    setPos({ x: 0, y: 0 });
    posRef.current = { x: 0, y: 0 };
    onUpdate({ floating: false, x: 0, y: 0 });
  };

  const alignMap = { left: 'flex-start', center: 'center', right: 'flex-end' };

  const containerStyle: React.CSSProperties = floating
    ? {
        position: 'absolute',
        left: pos.x + 'px',
        top: pos.y + 'px',
        width: width + 'px',
        zIndex: zLayer,
        cursor: 'grab',
        userSelect: 'none',
      }
    : {
        position: 'relative',
        width: width + 'px',
        maxWidth: '100%',
        cursor: 'pointer',
        userSelect: 'none',
      };

  const wrapStyle: React.CSSProperties = floating
    ? { position: 'relative', margin: 0, zIndex: zLayer }
    : {
        display: 'flex',
        justifyContent: alignMap[bloque.align ?? 'center'],
        margin: '16px 0',
        position: 'relative',
        zIndex: zLayer,
      };

  const capaLabel = zLayer === 1
    ? '⬇ Fondo'
    : zLayer === 2
      ? '◼ Normal'
      : zLayer === 3
        ? '⬆ Encima'
        : '🔝 Top';

  return (
    <div contentEditable={false} style={{ ...wrapStyle, userSelect: 'none' }}>
      <div
        ref={containerRef}
        style={containerStyle}
        onMouseDown={handleMouseDown}
      >
        {/* Imagen */}
        <img
          src={bloque.src}
          draggable={false}
          style={{
            width: '100%',
            display: 'block',
            borderRadius: '10px',
            border: selected ? `3px solid ${temaColor}` : '2px solid transparent',
            transition: 'border 0.15s, box-shadow 0.15s',
            boxShadow: selected
              ? `0 8px 32px ${temaColor}44`
              : floating
                ? '0 4px 20px rgba(0,0,0,0.4)'
                : 'none',
            pointerEvents: 'none',
          }}
        />

        {/* Label */}
        {bloque.label && (
          <div style={{
            position: 'absolute', top: 8, left: 8,
            background: temaColor, color: '#000',
            padding: '2px 8px', borderRadius: '6px',
            fontSize: '10px', fontWeight: 800,
            pointerEvents: 'none',
          }}>
            {bloque.label}
          </div>
        )}

        {/* Indicador capa */}
        {selected && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(0,0,0,0.75)', color: temaColor,
            padding: '2px 8px', borderRadius: '6px',
            fontSize: '10px', fontWeight: 800,
            pointerEvents: 'none',
          }}>
            {capaLabel}
          </div>
        )}

        {/* Handles resize */}
        {selected && (
          <>
            {/* Derecha */}
            <div
              data-resize="right"
              onMouseDown={e => startResize(e, 'right')}
              style={{
                position: 'absolute', right: -12, top: '50%',
                transform: 'translateY(-50%)',
                width: '22px', height: '60px',
                background: temaColor, borderRadius: '11px',
                cursor: 'ew-resize', zIndex: 30,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '4px',
                boxShadow: `0 2px 10px ${temaColor}66`,
              }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#000' }} />)}
            </div>

            {/* Izquierda */}
            <div
              data-resize="left"
              onMouseDown={e => startResize(e, 'left')}
              style={{
                position: 'absolute', left: -12, top: '50%',
                transform: 'translateY(-50%)',
                width: '22px', height: '60px',
                background: temaColor, borderRadius: '11px',
                cursor: 'ew-resize', zIndex: 30,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '4px',
                boxShadow: `0 2px 10px ${temaColor}66`,
              }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#000' }} />)}
            </div>

            {/* Esquinas */}
            {[
              { s: { top: -6, left: -6 }, side: 'left' as const },
              { s: { top: -6, right: -6 }, side: 'right' as const },
              { s: { bottom: -6, left: -6 }, side: 'left' as const },
              { s: { bottom: -6, right: -6 }, side: 'right' as const },
            ].map(({ s, side }, i) => (
              <div key={i} data-resize={side}
                onMouseDown={e => startResize(e, side)}
                style={{ position: 'absolute', width: '14px', height: '14px', background: temaColor, borderRadius: '4px', cursor: 'nwse-resize', zIndex: 30, ...s }}
              />
            ))}
          </>
        )}

        {/* Dimensión */}
        {selected && (
          <div style={{
            position: 'absolute', bottom: -28, left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '11px', color: temaColor,
            background: 'var(--bg-card)', padding: '2px 10px',
            borderRadius: '6px', border: `1px solid ${temaColor}`,
            whiteSpace: 'nowrap', fontWeight: 700, pointerEvents: 'none',
          }}>
            {Math.round(width)}px · {floating ? '🪟 Flotando' : '📄 Inline'}
          </div>
        )}
      </div>

      {/* ===== TOOLBAR via Portal ===== */}
      {selected && typeof window !== 'undefined' && createPortal(
        <div
          ref={toolbarRef}
          style={{
            position: 'absolute',
            top: toolbarPos.top + 'px',
            left: toolbarPos.left + 'px',
            transform: 'translateX(-50%)',
            background: 'var(--bg-card)',
            border: `2px solid ${temaColor}`,
            borderRadius: '14px',
            padding: '8px 14px',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            zIndex: 9999,
            boxShadow: '0 8px 32px rgba(0,0,0,0.9)',
            whiteSpace: 'nowrap',
            flexWrap: 'wrap',
            maxWidth: '90vw',
          }}
        >
          {/* Modo */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={makeInline}
              style={{ padding: '5px 10px', borderRadius: '7px', border: 'none', background: !floating ? temaColor : 'transparent', color: !floating ? '#000' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', fontWeight: 700 }}>
              📄 Inline
            </button>
            <button
              onClick={makeFloating}
              style={{ padding: '5px 10px', borderRadius: '7px', border: 'none', background: floating ? temaColor : 'transparent', color: floating ? '#000' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', fontWeight: 700 }}>
              🪟 Flotar
            </button>
          </div>

          <div style={{ width: '1px', height: '22px', background: 'var(--border-color)' }} />

          {/* Capas */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 700 }}>CAPA:</span>
            {[
              { z: 1, label: '⬇ Fondo' },
              { z: 2, label: '◼ Normal' },
              { z: 3, label: '⬆ Encima' },
              { z: 4, label: '🔝 Top' },
            ].map(({ z, label }) => (
              <button
                key={z}
                onClick={() => handleZLayer(z)}
                style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: zLayer === z ? temaColor : 'transparent', color: zLayer === z ? '#000' : 'var(--text-muted)', fontSize: '10px', cursor: 'pointer', fontWeight: 700 }}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ width: '1px', height: '22px', background: 'var(--border-color)' }} />

          {/* Alineación solo inline */}
          {!floating && (
            <>
              {(['left', 'center', 'right'] as const).map(a => (
                <button
                  key={a}
                  onClick={() => onUpdate({ align: a })}
                  style={{ padding: '5px 9px', borderRadius: '7px', border: 'none', background: bloque.align === a ? temaColor : 'transparent', color: bloque.align === a ? '#000' : 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', fontWeight: 700 }}>
                  {a === 'left' ? '⬅' : a === 'center' ? '⬛' : '➡'}
                </button>
              ))}
              <div style={{ width: '1px', height: '22px', background: 'var(--border-color)' }} />
            </>
          )}

          {/* Tamaños rápidos */}
          {[150, 300, 500, 700].map(w => (
            <button
              key={w}
              onClick={() => handleWidth(w)}
              style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: Math.abs(width - w) < 20 ? temaColor : 'transparent', color: Math.abs(width - w) < 20 ? '#000' : 'var(--text-muted)', fontSize: '10px', cursor: 'pointer', fontWeight: 700 }}>
              {w}px
            </button>
          ))}

          <div style={{ width: '1px', height: '22px', background: 'var(--border-color)' }} />

          <span style={{ fontSize: '11px', color: temaColor, fontWeight: 800, minWidth: '44px' }}>
            {Math.round(width)}px
          </span>

          <div style={{ width: '1px', height: '22px', background: 'var(--border-color)' }} />

          <button
            onClick={onDelete}
            style={{ padding: '5px 9px', borderRadius: '7px', border: 'none', background: 'transparent', color: 'var(--red)', fontSize: '16px', cursor: 'pointer' }}>
            🗑️
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}