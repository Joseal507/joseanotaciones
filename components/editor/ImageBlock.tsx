'use client';

import { useEffect, useRef, useState } from 'react';
import { BloqueImagen } from './types';

interface Props {
  bloque: BloqueImagen;
  temaColor: string;
  onUpdate: (changes: Partial<BloqueImagen>) => void;
  onDelete: () => void;
}

export default function ImageBlock({ bloque, temaColor, onUpdate, onDelete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pos, setPos] = useState({ x: bloque.x, y: bloque.y });
  const [width, setWidth] = useState(bloque.width);

  const posRef = useRef(pos);
  const widthRef = useRef(width);
  const dragging = useRef(false);
  const resizing = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, mx: 0, my: 0 });
  const resizeStart = useRef({ w: 0, mx: 0 });

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { widthRef.current = width; }, [width]);

  // Sincronizar si el bloque cambia desde fuera
  useEffect(() => {
    setPos({ x: bloque.x, y: bloque.y });
    setWidth(bloque.width);
  }, [bloque.x, bloque.y, bloque.width]);

  // Drag y resize globales
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (dragging.current) {
        const dx = e.clientX - dragStart.current.mx;
        const dy = e.clientY - dragStart.current.my;
        setPos({
          x: Math.max(0, dragStart.current.x + dx),
          y: Math.max(0, dragStart.current.y + dy),
        });
      }
      if (resizing.current) {
        const dx = e.clientX - resizeStart.current.mx;
        setWidth(Math.max(80, resizeStart.current.w + dx));
      }
    };

    const onPointerUp = () => {
      if (dragging.current) {
        dragging.current = false;
        setIsDragging(false);
        onUpdate({ x: posRef.current.x, y: posRef.current.y });
      }
      if (resizing.current) {
        resizing.current = false;
        onUpdate({ width: widthRef.current });
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [onUpdate]);

  // Click fuera = deseleccionar
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setSelected(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-image-delete="true"]')) return;
    if (target.closest('[data-image-resize="true"]')) return;

    e.preventDefault();
    e.stopPropagation();
    setSelected(true);
    dragging.current = true;
    setIsDragging(true);
    dragStart.current = {
      x: posRef.current.x,
      y: posRef.current.y,
      mx: e.clientX,
      my: e.clientY,
    };
  };

  return (
    <div
      ref={containerRef}
      data-image="true"
      onPointerDown={startDrag}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        zIndex: selected ? 30 : (bloque.zIndex ?? 2),
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <div style={{
        position: 'relative',
        display: 'inline-block',
        border: selected
          ? `2px solid ${temaColor}`
          : '1.5px solid #e5e7eb',
        borderRadius: '12px',
        boxShadow: selected
          ? `0 0 0 3px ${temaColor}28, 0 4px 20px rgba(0,0,0,0.12)`
          : '0 2px 8px rgba(0,0,0,0.06)',
        background: '#fff',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}>
        <img
          src={bloque.src}
          draggable={false}
          alt={bloque.label || 'imagen'}
          style={{
            width,
            maxWidth: '100%',
            display: 'block',
            borderRadius: '10px',
            pointerEvents: 'none',
          }}
        />

        {/* Label de la imagen */}
        {bloque.label && (
          <div style={{
            position: 'absolute',
            top: 8,
            left: 8,
            background: temaColor,
            color: '#000',
            padding: '2px 8px',
            borderRadius: '6px',
            fontSize: '10px',
            fontWeight: 800,
            pointerEvents: 'none',
          }}>
            {bloque.label}
          </div>
        )}

        {/* Controles al seleccionar */}
        {selected && (
          <>
            {/* Botón eliminar */}
            <button
              data-image-delete="true"
              onPointerDown={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              style={{
                position: 'absolute',
                top: -10,
                right: -10,
                width: 22,
                height: 22,
                borderRadius: '999px',
                border: '1.5px solid #fca5a5',
                background: '#fff',
                color: '#ef4444',
                fontWeight: 900,
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                zIndex: 10,
              }}
            >
              ✕
            </button>

            {/* Handle de resize (esquina inferior derecha) */}
            <div
              data-image-resize="true"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                resizing.current = true;
                resizeStart.current = {
                  w: widthRef.current,
                  mx: e.clientX,
                };
              }}
              style={{
                position: 'absolute',
                right: -7,
                bottom: -7,
                width: 16,
                height: 16,
                borderRadius: '999px',
                background: temaColor,
                border: '2px solid #fff',
                boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                cursor: 'nwse-resize',
                zIndex: 10,
              }}
            />

            {/* Indicador de tamaño */}
            <div style={{
              position: 'absolute',
              bottom: -22,
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '10px',
              color: '#9ca3af',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}>
              {Math.round(width)}px
            </div>
          </>
        )}
      </div>
    </div>
  );
}