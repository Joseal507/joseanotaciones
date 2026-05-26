'use client';
import { useRef, useEffect, useCallback } from 'react';

export function useTextSelection(
  contentRef: React.RefObject<HTMLDivElement | null>,
  editing: boolean
) {
  const rangeRef = useRef<Range | null>(null);

  const save = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !contentRef.current?.contains(sel.anchorNode)) return;
    rangeRef.current = sel.getRangeAt(0).cloneRange();
  }, [contentRef]);

  const restore = useCallback(() => {
    const el = contentRef.current;
    if (!el || !rangeRef.current) return false;
    el.focus();
    try {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(rangeRef.current);
      return !rangeRef.current.collapsed;
    } catch {
      return false;
    }
  }, [contentRef]);

  const applyStyle = useCallback((styleName: 'fontSize' | 'color' | 'backgroundColor', value: string) => {
    restore();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style[styleName] = value;
    try {
      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
      // Re-seleccionar lo que acabamos de envolver
      const nr = document.createRange();
      nr.selectNodeContents(span);
      sel.removeAllRanges();
      sel.addRange(nr);
      save();
    } catch {}
  }, [restore, save]);

  const exec = useCallback((cmd: string, val?: string) => {
    restore();
    requestAnimationFrame(() => {
      restore();
      document.execCommand(cmd, false, val);
      setTimeout(save, 10);
    });
  }, [restore, save]);

  useEffect(() => {
    if (!editing) return;
    document.addEventListener('selectionchange', save);
    return () => document.removeEventListener('selectionchange', save);
  }, [editing, save]);

  return {
    save,
    restore,
    exec,
    applyFontSize:   (px: number)  => applyStyle('fontSize', `${px}px`),
    applyColor:      (color: string) => applyStyle('color', color),
    applyHighlight:  (color: string) => applyStyle('backgroundColor', color),
    applyFontFamily: (f: string)   => exec('fontName', f),
  };
}
