'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { BloqueTexto } from './types';

interface Props {
  bloque: BloqueTexto;
  temaColor: string;
  isNew?: boolean;
  onUpdate: (changes: Partial<BloqueTexto>) => void;
  onDelete: () => void;
  onFinishNew: () => void;
}

export default function TextBlock({ bloque, temaColor, isNew, onUpdate, onDelete, onFinishNew }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(!!isNew);
  const [selected, setSelected] = useState(false);
  const [pos, setPos] = useState({ x: bloque.x, y: bloque.y });
  const [width, setWidth] = useState(bloque.width);
  const posRef = useRef(pos);
  const widthRef = useRef(width);
  const dragging = useRef(false);
  const resizing = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, ex: 0, ey: 0 });
  const resizeStart = useRef({ mx: 0, w: 0 });
  const justCreated = useRef(!!isNew);
  // ✅ Guardamos el HTML internamente para no perderlo
  const htmlRef = useRef(bloque.html || '');

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { widthRef.current = width; }, [width]);

  // ✅ Sincronizar cuando el bloque cambia desde fuera
  useEffect(() => {
    htmlRef.current = bloque.html || '';
    // Solo actualizar el DOM si NO estamos editando
    if (!editing && ref.current) {
      ref.current.innerHTML = htmlRef.current;
    }
  }, [bloque.html, editing]);

  // ✅ Al montar o cuando isNew, poner el HTML inicial
  useEffect(() => {
    if (ref.current && !editing) {
      ref.current.innerHTML = htmlRef.current;
    }
  }, []);

  // Auto focus cuando es nuevo
  useEffect(() => {
    if (isNew && ref.current) {
      ref.current.innerHTML = '';
      setTimeout(() => ref.current?.focus(), 30);
    }
  }, [isNew]);

  const saveContent = useCallback(() => {
    if (ref.current) {
      htmlRef.current = ref.current.innerHTML || '';
      onUpdate({ html: htmlRef.current });
    }
  }, [onUpdate]);

  const exitEditing = useCallback(() => {
    const text = ref.current?.innerText?.trim() || '';
    if (!text) {
      onDelete();
      return;
    }
    saveContent();
    setEditing(false);
    if (justCreated.current) {
      justCreated.current = false;
      onFinishNew();
    }
  }, [onDelete, saveContent, onFinishNew]);

  // Click fuera
  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      if (!containerRef.current?.contains(ev.target as Node)) {
        if (editing) {
          exitEditing();
        }
        setSelected(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editing, exitEditing]);

  // Drag + resize global
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        setPos({
          x: Math.max(0, dragStart.current.ex + e.clientX - dragStart.current.mx),
          y: Math.max(0, dragStart.current.ey + e.clientY - dragStart.current.my),
        });
      }
      if (resizing.current) {
        setWidth(Math.max(100, resizeStart.current.w + e.clientX - resizeStart.current.mx));
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
    setSelected(true);
    const target = e.target as HTMLElement;
    if (target.getAttribute('data-drag') === 'true') {
      e.preventDefault();
      dragging.current = true;
      dragStart.current = {
        mx: e.clientX, my: e.clientY,
        ex: posRef.current.x, ey: posRef.current.y,
      };
    }
  };

  const startEdit = useCallback(() => {
    setEditing(true);
    setSelected(true);
    setTimeout(() => {
      if (!ref.current) return;
      // ✅ CLAVE: poner el HTML guardado antes de hacer focus
      ref.current.innerHTML = htmlRef.current;
      ref.current.focus();
      // Poner cursor al final
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, 20);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      exitEditing();
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (containerRef.current?.contains(document.activeElement)) return;
      exitEditing();
    }, 150);
  };

  const hasContent = !!(htmlRef.current?.trim());
  const showBox = editing || selected || hasContent;

  return (
    <div
      ref={containerRef}
      data-textblock="true"
      onMouseDown={handleMouseDown}
      onDoubleClick={(e) => { e.stopPropagation(); if (!editing) startEdit(); }}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: editing || hasContent ? width : 'auto',
        minWidth: editing ? 100 : 0,
        zIndex: editing ? 50 : selected ? 40 : 10,
        cursor: editing ? 'text' : 'default',
        userSelect: editing ? 'text' : 'none',
        visibility: showBox ? 'visible' : 'hidden',
      }}
    >
      {/* Drag handle */}
      {(selected || editing) && (
        <div
          data-drag="true"
          style={{
            position: 'absolute',
            top: -14, left: 0, right: 0,
            height: '14px',
            cursor: 'grab',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div style={{
            width: '40px', height: '4px',
            background: temaColor,
            borderRadius: '2px',
            opacity: 0.5,
          }} />
        </div>
      )}

      <div style={{
        border: editing
          ? `2px solid ${temaColor}`
          : selected
            ? `1.5px solid ${temaColor}66`
            : '1.5px solid transparent',
        borderRadius: '4px',
        background: editing ? 'rgba(255,255,255,0.97)' : 'transparent',
        boxShadow: editing ? `0 2px 12px ${temaColor}22` : 'none',
        transition: 'border 0.1s, background 0.1s',
      }}>
        <div
          ref={ref}
          contentEditable={editing}
          suppressContentEditableWarning
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onInput={() => {
            // ✅ Guardar cada cambio en htmlRef
            htmlRef.current = ref.current?.innerHTML || '';
            onUpdate({ html: htmlRef.current });
          }}
          className="ebloque"
          style={{
            minHeight: editing ? '24px' : 'auto',
            padding: '2px 6px',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            color: '#1f2937',
            outline: 'none',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        />
      </div>

      {/* Resize handle */}
      {selected && (
        <div
          onMouseDown={(e) => {
            e.preventDefault(); e.stopPropagation();
            resizing.current = true;
            resizeStart.current = { mx: e.clientX, w: widthRef.current };
          }}
          style={{
            position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
            width: '14px', height: '30px', background: temaColor, borderRadius: '7px',
            cursor: 'ew-resize', zIndex: 60,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: '3px',
          }}
        >
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: '2px', height: '2px', borderRadius: '50%', background: '#000',
            }} />
          ))}
        </div>
      )}

      {/* Delete */}
      {selected && !editing && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: -14, right: -8,
            background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px',
            padding: '2px 6px', cursor: 'pointer', zIndex: 9999,
          }}
          onClick={() => onDelete()}
        >
          <span style={{ fontSize: '11px', color: '#ef4444' }}>✕</span>
        </div>
      )}
    </div>
  );
}