'use client';

import { useRef, useEffect, useState } from 'react';
import { BloqueTextoAbsoluto } from './types';

interface Props {
  bloque: BloqueTextoAbsoluto;
  temaColor: string;
  isNew?: boolean;
  onUpdate: (changes: Partial<BloqueTextoAbsoluto>) => void;
  onDelete: () => void;
  onStopEditing: () => void;
}

export default function AbsoluteTextBlock({
  bloque, temaColor, isNew = false, onUpdate, onDelete, onStopEditing
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(isNew);
  const [selected, setSelected] = useState(false);
  const [hasContent, setHasContent] = useState(!!bloque.html);
  const [pos, setPos] = useState({ x: bloque.x, y: bloque.y });
  const [width, setWidth] = useState(bloque.width);
  const posRef = useRef(pos);
  const widthRef = useRef(width);
  const dragging = useRef(false);
  const resizing = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, ex: 0, ey: 0 });
  const resizeStart = useRef({ mx: 0, w: 0 });

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { widthRef.current = width; }, [width]);

  // Focus al crear — sin borde hasta que escribas
  useEffect(() => {
    if (isNew && ref.current) {
      setTimeout(() => {
        ref.current?.focus();
      }, 20);
    }
  }, [isNew]);

  // Click fuera → guardar o eliminar si vacío
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        if (editing) {
          const html = ref.current?.innerHTML || '';
          const text = ref.current?.innerText?.trim() || '';
          if (!text || html === '<br>') {
            onDelete();
            return;
          }
          onUpdate({ html });
          onStopEditing();
        }
        setEditing(false);
        setSelected(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing, onDelete, onUpdate, onStopEditing]);

  // Drag / resize global
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        const newPos = {
          x: Math.max(0, dragStart.current.ex + e.clientX - dragStart.current.mx),
          y: Math.max(0, dragStart.current.ey + e.clientY - dragStart.current.my),
        };
        setPos(newPos);
        posRef.current = newPos;
      }
      if (resizing.current) {
        const newW = Math.max(120, resizeStart.current.w + e.clientX - resizeStart.current.mx);
        setWidth(newW);
        widthRef.current = newW;
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
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [onUpdate]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editing) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(true);
    dragging.current = true;
    dragStart.current = {
      mx: e.clientX, my: e.clientY,
      ex: posRef.current.x, ey: posRef.current.y,
    };
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editing && hasContent) {
      setSelected(true);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditing(true);
    setSelected(true);
    setTimeout(() => {
      if (!ref.current) return;
      ref.current.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, 20);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      const text = ref.current?.innerText?.trim() || '';
      if (!text) { onDelete(); return; }
      onUpdate({ html: ref.current?.innerHTML || '' });
      setEditing(false);
      onStopEditing();
    }
    if (e.key === 'Enter' && !e.shiftKey && !hasContent) {
      // primer enter confirma
    }
  };

  const handleInput = () => {
    const text = ref.current?.innerText?.trim() || '';
    setHasContent(!!text);
    onUpdate({ html: ref.current?.innerHTML || '' });
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (containerRef.current?.contains(document.activeElement)) return;
      const text = ref.current?.innerText?.trim() || '';
      if (!text) { onDelete(); return; }
      onUpdate({ html: ref.current?.innerHTML || '' });
      setEditing(false);
      onStopEditing();
    }, 120);
  };

  // ✅ Si es nuevo y vacío → invisible hasta que escribas
  const isEmptyNew = isNew && !hasContent && editing;

  return (
    <div
      ref={containerRef}
      data-absolute-block="true"
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: hasContent || editing ? width : 0,
        zIndex: selected || editing ? 50 : 10,
        cursor: editing ? 'text' : selected ? 'grab' : 'default',
        userSelect: editing ? 'text' : 'none',
        // ✅ Sin borde feo cuando está vacío
        visibility: (!hasContent && !editing) ? 'hidden' : 'visible',
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div style={{
        position: 'relative',
        border: editing
          ? `2px solid ${temaColor}`
          : selected && hasContent
            ? `2px solid ${temaColor}88`
            : '2px solid transparent',
        borderRadius: '4px',
        padding: editing ? '2px' : '0px',
        background: editing ? 'rgba(255,255,255,0.97)' : 'transparent',
        boxShadow: editing ? `0 2px 12px ${temaColor}22` : 'none',
        transition: 'border 0.1s',
        // ✅ Ancho mínimo solo cuando está editando
        minWidth: editing ? '120px' : '0px',
      }}>

        <div
          ref={ref}
          contentEditable={editing}
          suppressContentEditableWarning
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onInput={handleInput}
          dangerouslySetInnerHTML={!editing ? { __html: bloque.html || '' } : undefined}
          style={{
            minHeight: editing ? '28px' : 'auto',
            padding: '2px 4px',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            color: '#1f2937',
            outline: 'none',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            cursor: editing ? 'text' : 'inherit',
          }}
        />

        {/* Handle resize — solo si tiene contenido y está seleccionado */}
        {selected && hasContent && !editing && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              resizing.current = true;
              resizeStart.current = { mx: e.clientX, w: widthRef.current };
            }}
            style={{
              position: 'absolute',
              right: -8,
              top: '50%',
              transform: 'translateY(-50%)',
              width: '14px',
              height: '32px',
              background: temaColor,
              borderRadius: '7px',
              cursor: 'ew-resize',
              zIndex: 60,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
            }}
          >
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: '2px', height: '2px', borderRadius: '50%', background: '#000' }} />
            ))}
          </div>
        )}
      </div>

      {/* Toolbar — solo si tiene contenido y está seleccionado */}
      {selected && hasContent && !editing && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '4px',
            background: 'white',
            border: `2px solid ${temaColor}`,
            borderRadius: '8px',
            padding: '4px 8px',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            zIndex: 9999,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '10px', color: '#9ca3af' }}>2× editar</span>
          <div style={{ width: '1px', height: '14px', background: '#e5e7eb' }} />
          <button
            onMouseDown={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '13px', padding: 0 }}
          >🗑️</button>
        </div>
      )}
    </div>
  );
}