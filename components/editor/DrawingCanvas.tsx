'use client';

import { useRef, useState, useEffect } from 'react';

interface Props {
  onSave: (dataUrl: string) => void;
  onClose: () => void;
  color: string;
}

export default function DrawingCanvas({ onSave, onClose, color }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [brushSize, setBrushSize] = useState(3);
  const [brushColor, setBrushColor] = useState('#ffffff');
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: ((e as React.MouseEvent).clientX - rect.left) * scaleX,
      y: ((e as React.MouseEvent).clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    lastPos.current = getPos(e);
    setDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = tool === 'eraser' ? '#0d0d1a' : brushColor;
    ctx.lineWidth = tool === 'eraser' ? brushSize * 5 : brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
  };

  const stopDraw = () => setDrawing(false);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL('image/png'));
  };

  const colors = ['#ffffff', '#f5c842', '#ff4d6d', '#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#a78bfa', '#000000'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', zIndex: 3000 }}>

      {/* Header */}
      <div style={{ padding: '12px 20px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontWeight: 800, color: 'var(--text-primary)', fontSize: '16px' }}>🎨 Crear Dibujo</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={clear}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--red)', background: 'transparent', color: 'var(--red)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            🗑️ Limpiar
          </button>
          <button onClick={save}
            style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: color, color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
            ✅ Insertar dibujo
          </button>
          <button onClick={onClose}
            style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            ✕ Cancelar
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ padding: '10px 20px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {[{ id: 'pen', label: '✏️ Pluma' }, { id: 'eraser', label: '🧹 Borrador' }].map(t => (
            <button key={t.id} onClick={() => setTool(t.id as any)}
              style={{ padding: '7px 14px', borderRadius: '8px', border: `2px solid ${tool === t.id ? color : 'var(--border-color)'}`, background: tool === t.id ? color : 'transparent', color: tool === t.id ? '#000' : 'var(--text-muted)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 700 }}>COLOR:</span>
          {colors.map(c => (
            <button key={c} onClick={() => { setBrushColor(c); setTool('pen'); }}
              style={{ width: '22px', height: '22px', borderRadius: '50%', background: c, border: brushColor === c ? '3px solid white' : '2px solid var(--border-color)', cursor: 'pointer', transform: brushColor === c ? 'scale(1.2)' : 'scale(1)', transition: 'transform 0.15s' }} />
          ))}
          <input type="color" value={brushColor} onChange={e => { setBrushColor(e.target.value); setTool('pen'); }}
            style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0 }} />
        </div>

        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 700 }}>TAMAÑO:</span>
          {[2, 4, 8, 14, 22].map(s => (
            <button key={s} onClick={() => setBrushSize(s)}
              style={{ width: '34px', height: '34px', borderRadius: '8px', border: `2px solid ${brushSize === s ? color : 'var(--border-color)'}`, background: brushSize === s ? color + '25' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: Math.min(s * 2.5, 24) + 'px', height: Math.min(s * 2.5, 24) + 'px', borderRadius: '50%', background: tool === 'pen' ? brushColor : '#888' }} />
            </button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={1200}
          height={700}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
          style={{ borderRadius: '12px', border: `2px solid ${color}`, cursor: tool === 'eraser' ? 'cell' : 'crosshair', maxWidth: '100%', maxHeight: '100%', touchAction: 'none' }}
        />
      </div>
    </div>
  );
}