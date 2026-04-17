'use client';

import { useRef, useEffect } from 'react';

interface Props {
  x: number;
  y: number;
  temaColor: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}

export default function FloatingTextInput({ x, y, temaColor, onSave, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { onCancel(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = ref.current?.innerText || '';
      if (text.trim()) onSave(text.trim());
      else onCancel();
    }
  };

  const handleBlur = () => {
    const text = ref.current?.innerText || '';
    if (text.trim()) onSave(text.trim());
    else onCancel();
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: Math.max(8, x),
        top: Math.max(8, y - 16),
        zIndex: 200,
        pointerEvents: 'all',
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={{
          minWidth: '180px',
          maxWidth: '500px',
          minHeight: '32px',
          padding: '6px 12px',
          background: 'rgba(255,255,255,0.98)',
          border: `2px solid ${temaColor}`,
          borderRadius: '8px',
          fontSize: '16px',
          fontFamily: 'Georgia, serif',
          color: '#1f2937',
          outline: 'none',
          boxShadow: `0 4px 20px rgba(0,0,0,0.15), 0 0 0 3px ${temaColor}20`,
          lineHeight: '32px',
          cursor: 'text',
          whiteSpace: 'pre-wrap',
        }}
      />
      <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '3px', textAlign: 'center' }}>
        Enter · Esc para cancelar
      </div>
    </div>
  );
}