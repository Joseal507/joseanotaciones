'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { BloqueTexto } from './types';
import { useTextSelection } from '../../hooks/useTextSelection';
import TextToolbar from './TextToolbar';

interface Props {
  bloque: BloqueTexto;
  temaColor: string;
  isNew?: boolean;
  onUpdate: (changes: Partial<BloqueTexto>) => void;
  onDelete: () => void;
  onFinishNew: () => void;
}

export default function TextBlock({ bloque, temaColor, isNew, onUpdate, onDelete, onFinishNew }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const [editing, setEditing] = useState(!!isNew);
  const [selected, setSelected] = useState(!!isNew);
  const [pos, setPos] = useState({ x: bloque.x, y: bloque.y });
  const [w, setW] = useState(bloque.width);
  const [toolbarSide, setToolbarSide] = useState<'top'|'bottom'>('bottom');
  const [dragging, setDragging] = useState(false);

  const posRef = useRef(pos);
  const wRef = useRef(w);
  const htmlRef = useRef(bloque.html || '');
  const isDrag = useRef(false);
  const isRsz = useRef(false);
  const dOrig = useRef({ mx:0, my:0, ex:0, ey:0 });
  const rOrig = useRef({ mx:0, w:0 });
  const lp = useRef<any>(null);
  const justCreated = useRef(!!isNew);

  const { save, exec, applyFontSize, applyFontFamily, applyColor, applyHighlight } =
    useTextSelection(contentRef, editing);

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { wRef.current = w; }, [w]);

  useEffect(() => {
    if (!editing) {
      htmlRef.current = bloque.html || '';
      if (contentRef.current) contentRef.current.innerHTML = htmlRef.current;
    }
  }, [bloque.html, editing]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.innerHTML = htmlRef.current;
  }, []); // eslint-disable-line

  useEffect(() => {
    if (isNew) setTimeout(() => {
      if (!contentRef.current) return;
      contentRef.current.innerHTML = '';
      htmlRef.current = '';
      contentRef.current.focus();
      calcSide();
    }, 50);
  }, []); // eslint-disable-line

  const calcSide = useCallback(() => {
    if (!containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    setToolbarSide(r.top > 90 ? 'top' : 'bottom');
  }, []);

  useEffect(() => {
    if (!editing) return;
    calcSide();
    window.addEventListener('resize', calcSide);
    window.addEventListener('scroll', calcSide, true);
    return () => {
      window.removeEventListener('resize', calcSide);
      window.removeEventListener('scroll', calcSide, true);
    };
  }, [editing, calcSide]);

  const saveHtml = useCallback(() => {
    if (contentRef.current) {
      htmlRef.current = contentRef.current.innerHTML || '';
      onUpdate({ html: htmlRef.current });
    }
  }, [onUpdate]);

  const exitEditing = useCallback(() => {
    if (!contentRef.current?.innerText?.trim()) { onDelete(); return; }
    saveHtml();
    setEditing(false);
    setSelected(false);
    if (justCreated.current) { justCreated.current = false; onFinishNew(); }
  }, [onDelete, saveHtml, onFinishNew]);

  const startEdit = useCallback(() => {
    setEditing(true);
    setSelected(true);
    setTimeout(() => {
      if (!contentRef.current) return;
      contentRef.current.innerHTML = htmlRef.current;
      contentRef.current.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(contentRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      save();
      calcSide();
    }, 30);
  }, [save, calcSide]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (toolbarRef.current?.contains(t)) return;
      if (containerRef.current?.contains(t)) return;
      if (editing) exitEditing();
      else setSelected(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [editing, exitEditing]);

  useEffect(() => {
    const mv = (e: MouseEvent) => {
      if (isDrag.current) {
        setPos({ x: Math.max(0, dOrig.current.ex + e.clientX - dOrig.current.mx), y: Math.max(0, dOrig.current.ey + e.clientY - dOrig.current.my) });
        setDragging(true);
      }
      if (isRsz.current) setW(Math.max(100, rOrig.current.w + e.clientX - rOrig.current.mx));
    };
    const up = () => {
      if (isDrag.current) { isDrag.current = false; setDragging(false); onUpdate({ x: posRef.current.x, y: posRef.current.y }); }
      if (isRsz.current) { isRsz.current = false; onUpdate({ width: wRef.current }); }
      if (lp.current) clearTimeout(lp.current);
    };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
    return () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
  }, [onUpdate]);

  useEffect(() => {
    if (editing) return;
    const el = containerRef.current;
    if (!el) return;
    let sx=0,sy=0,ox=0,oy=0,moved=false;
    const ts = (e: TouchEvent) => {
      if ((e.target as HTMLElement).dataset.resize) return;
      const t=e.touches[0]; sx=t.clientX; sy=t.clientY; ox=posRef.current.x; oy=posRef.current.y; moved=false;
    };
    const tm = (e: TouchEvent) => {
      const t=e.touches[0]; const dx=t.clientX-sx,dy=t.clientY-sy;
      if (Math.abs(dx)>5||Math.abs(dy)>5) { moved=true; setPos({x:Math.max(0,ox+dx),y:Math.max(0,oy+dy)}); setDragging(true); }
    };
    const te = () => { if (moved) { onUpdate({x:posRef.current.x,y:posRef.current.y}); setDragging(false); } };
    el.addEventListener('touchstart',ts,{passive:true});
    el.addEventListener('touchmove',tm,{passive:false});
    el.addEventListener('touchend',te);
    return () => { el.removeEventListener('touchstart',ts); el.removeEventListener('touchmove',tm); el.removeEventListener('touchend',te); };
  }, [editing, onUpdate]);

  const handleExec = useCallback((cmd: string, val?: string) => {
    exec(cmd, val);
    setTimeout(saveHtml, 30);
  }, [exec, saveHtml]);

  const handleFontSize = useCallback((px: number) => {
    applyFontSize(px);
    setTimeout(saveHtml, 30);
  }, [applyFontSize, saveHtml]);

  const handleFontFamily = useCallback((f: string) => {
    applyFontFamily(f);
    setTimeout(saveHtml, 30);
  }, [applyFontFamily, saveHtml]);

  const handleColor = useCallback((color: string) => {
    applyColor(color);
    setTimeout(saveHtml, 30);
  }, [applyColor, saveHtml]);

  const handleHighlight = useCallback((color: string) => {
    applyHighlight(color);
    setTimeout(saveHtml, 30);
  }, [applyHighlight, saveHtml]);

  const handleHeading = useCallback((tag: string) => {
    exec('formatBlock', tag);
    setTimeout(saveHtml, 30);
  }, [exec, saveHtml]);

  const hasContent = !!(htmlRef.current?.trim());

  return (
    <div
      ref={containerRef}
      data-textblock="true"
      onMouseDown={e => {
        if (editing) return;
        if ((e.target as HTMLElement).dataset.resize || (e.target as HTMLElement).dataset.del) return;
        e.stopPropagation();
        setSelected(true);
        const sx=e.clientX,sy=e.clientY,px=posRef.current.x,py=posRef.current.y;
        lp.current = setTimeout(() => { isDrag.current=true; dOrig.current={mx:sx,my:sy,ex:px,ey:py}; }, 150);
      }}
      onDoubleClick={e => {
        e.stopPropagation();
        if (lp.current) clearTimeout(lp.current);
        isDrag.current=false; setDragging(false);
        if (!editing) startEdit();
      }}
      style={{
        position: 'absolute', left: pos.x, top: pos.y,
        width: (editing || hasContent) ? w : 'auto',
        minWidth: editing ? 120 : 0,
        zIndex: editing ? 200 : selected ? 100 : 10,
        cursor: editing ? 'text' : dragging ? 'grabbing' : selected ? 'grab' : 'default',
        userSelect: editing ? 'text' : 'none',
        visibility: (hasContent || editing || selected) ? 'visible' : 'hidden',
        pointerEvents: 'auto',
      }}
    >

      {editing && (
        <div ref={toolbarRef}>
          <TextToolbar
            side={toolbarSide}
            onExec={handleExec}
            onFontSize={handleFontSize}
            onFontFamily={handleFontFamily}
            onColor={handleColor}
            onHighlight={handleHighlight}
            onHeading={handleHeading}
            onDelete={onDelete}
            onSaveSelection={save}
          />
        </div>
      )}

      <div style={{
        borderRadius: 8,
        border: editing ? `2px solid ${temaColor}` : selected ? `2px solid ${temaColor}55` : '2px solid transparent',
        background: editing ? 'rgba(255,255,255,0.99)' : 'transparent',
        boxShadow: editing ? `0 4px 24px rgba(0,0,0,0.15), 0 0 0 4px ${temaColor}15` : 'none',
        transition: 'border .12s, background .12s, box-shadow .12s',
      }}>
        <div
          ref={contentRef}
          contentEditable={editing}
          suppressContentEditableWarning
          className="ebloque"
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') exitEditing(); }}
          onBlur={() => {
            setTimeout(() => {
              if (toolbarRef.current?.contains(document.activeElement)) return;
              if (containerRef.current?.contains(document.activeElement)) return;
              exitEditing();
            }, 250);
          }}
          onInput={() => {
            htmlRef.current = contentRef.current?.innerHTML || '';
            onUpdate({ html: htmlRef.current });
            setTimeout(calcSide, 30);
          }}
          style={{
            minHeight: editing ? 28 : 'auto',
            padding: '6px 10px',
            fontFamily: 'Georgia, serif',
            fontSize: 16,
            color: '#1f2937',
            outline: 'none',
            lineHeight: 1.2,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            caretColor: temaColor,
          }}
        />
      </div>

      {(selected || editing) && (
        <div
          data-resize="true"
          onMouseDown={e => {
            e.preventDefault(); e.stopPropagation();
            if (lp.current) clearTimeout(lp.current);
            isRsz.current=true; rOrig.current={mx:e.clientX,w:wRef.current};
          }}
          style={{
            position: 'absolute', right: -10, top: '50%', transform: 'translateY(-50%)',
            width: 16, height: 36, background: temaColor, borderRadius: 8,
            cursor: 'ew-resize', zIndex: 999,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          {[0,1,2].map(i=><div key={i} style={{width:2,height:2,borderRadius:'50%',background:'#000',opacity:0.5}}/>)}
        </div>
      )}

      {selected && !editing && (
        <div data-del="true"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          onMouseDown={e => { e.stopPropagation(); if (lp.current) clearTimeout(lp.current); }}
          style={{
            position: 'absolute', top: -14, right: -6,
            background: '#fef2f2', border: '1px solid #fca5a5',
            borderRadius: 6, padding: '2px 7px', cursor: 'pointer', zIndex: 9999,
          }}
        >
          <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>✕</span>
        </div>
      )}
    </div>
  );
}
