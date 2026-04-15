'use client';

import { Herramienta } from './types';

interface Props {
  temaColor: string;
  herramientaActiva: Herramienta;
  onHerramienta: (h: Herramienta) => void;
  brushColor: string;
  onBrushColor: (c: string) => void;
  brushSize: number;
  onBrushSize: (s: number) => void;
  onExecCmd: (cmd: string, val?: string) => void;
  onInsertHtml: (html: string) => void;
  onInsertImagen: () => void;
  onInsertDibujo: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const COLORES = [
  '#000000', '#ffffff', '#f5c842', '#ff4d6d',
  '#38bdf8', '#f472b6', '#4ade80', '#fb923c', '#a78bfa',
];

export default function Toolbar({
  temaColor, herramientaActiva, onHerramienta,
  brushColor, onBrushColor, brushSize, onBrushSize,
  onExecCmd, onInsertHtml, onInsertImagen, onInsertDibujo,
  onUndo, onRedo,
}: Props) {

  const modoEscritura = ['boligrafo', 'marcador', 'lapiz', 'borrador'].includes(herramientaActiva);

  const Sep = () => (
    <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 3px', flexShrink: 0 }} />
  );

  const Btn = ({ label, title, active, onClick, style = {} }: {
    label: any; title: string; active?: boolean; onClick: () => void; style?: any;
  }) => (
    <button onClick={onClick} title={title}
      style={{
        padding: '5px 9px', borderRadius: '7px',
        border: active ? `2px solid ${temaColor}` : '1px solid var(--border-color)',
        background: active ? temaColor + '25' : 'var(--bg-card)',
        color: active ? temaColor : 'var(--text-primary)',
        fontSize: '12px', fontWeight: active ? 800 : 500,
        cursor: 'pointer', whiteSpace: 'nowrap',
        transition: 'all 0.15s', flexShrink: 0, ...style,
      }}
      onMouseEnter={(e: any) => { if (!active) { e.currentTarget.style.background = temaColor; e.currentTarget.style.color = '#000'; e.currentTarget.style.borderColor = temaColor; } }}
      onMouseLeave={(e: any) => { if (!active) { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; } }}>
      {label}
    </button>
  );

  const insertLatex = () => {
    const formula = prompt('Formula LaTeX (ej: x^2 + y^2 = z^2):');
    if (!formula) return;
    // Render simple sin librería pesada
    onInsertHtml(`<span class="latex-formula" contenteditable="false" style="display:inline-block;background:#f0f4ff;border:1px solid #d0d8ff;border-radius:6px;padding:3px 10px;font-family:monospace;font-size:14px;color:#1a1a6e;cursor:default;user-select:none;" title="${formula}">📐 ${formula}</span>`);
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>

      {/* ===== FILA 1: Dibujo + Insertar ===== */}
      <div style={{ padding: '7px 12px', display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>

        {/* Herramientas dibujo */}
        <span style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Draw</span>
        <Btn label="🖊️" title="Bolígrafo" active={herramientaActiva === 'boligrafo'} onClick={() => onHerramienta('boligrafo')} />
        <Btn label="🖌️" title="Marcador" active={herramientaActiva === 'marcador'} onClick={() => onHerramienta('marcador')} />
        <Btn label="✏️" title="Lápiz" active={herramientaActiva === 'lapiz'} onClick={() => onHerramienta('lapiz')} />
        <Btn label="🧹" title="Borrador" active={herramientaActiva === 'borrador'} onClick={() => onHerramienta('borrador')} />

        <Sep />

        {/* Colores cuando dibuja */}
        {modoEscritura && (
          <>
            {COLORES.map(c => (
              <button key={c} onClick={() => onBrushColor(c)} title={c}
                style={{
                  width: '18px', height: '18px', borderRadius: '50%', background: c,
                  cursor: 'pointer', flexShrink: 0,
                  border: brushColor === c ? '3px solid var(--text-primary)' : '2px solid var(--border-color)',
                  transform: brushColor === c ? 'scale(1.25)' : 'scale(1)',
                  transition: 'all 0.15s',
                }} />
            ))}
            <input type="color" value={brushColor} onChange={e => onBrushColor(e.target.value)} title="Color personalizado"
              style={{ width: '22px', height: '22px', borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }} />
            <Sep />
            {/* Tamaño trazo */}
            {[1, 2, 4, 7, 12, 20].map(s => (
              <button key={s} onClick={() => onBrushSize(s)} title={`${s}px`}
                style={{
                  width: '30px', height: '30px', borderRadius: '7px',
                  border: `2px solid ${brushSize === s ? temaColor : 'var(--border-color)'}`,
                  background: brushSize === s ? temaColor + '20' : 'transparent',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s', flexShrink: 0,
                }}>
                <div style={{
                  width: Math.min(s * 2.5, 22) + 'px', height: Math.min(s * 2.5, 22) + 'px',
                  borderRadius: '50%', background: brushColor,
                  opacity: herramientaActiva === 'lapiz' ? 0.75 : herramientaActiva === 'marcador' ? 0.4 : 1,
                }} />
              </button>
            ))}
            <input type="number" min={1} max={50} value={brushSize}
              onChange={e => onBrushSize(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{ width: '44px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700, textAlign: 'center', flexShrink: 0 }} />
            <Sep />
          </>
        )}

        {/* Undo/Redo */}
        <Btn label="↩️" title="Deshacer (Cmd+Z)" onClick={onUndo} />
        <Btn label="↪️" title="Rehacer (Cmd+Y)" onClick={onRedo} />

        <Sep />

        {/* Insertar */}
        <span style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Insert</span>
        <Btn label="🖼️" title="Insertar imagen" onClick={onInsertImagen} />
        <Btn label="🎨" title="Insertar dibujo" onClick={onInsertDibujo} />
        <Btn label="📐 Math" title="Insertar fórmula LaTeX" onClick={insertLatex} />
        <Btn label="—" title="Separador horizontal" onClick={() => onInsertHtml('<hr style="border:none;border-top:2px solid #ddd;margin:16px 0"/>')} />
        <Btn label="📌" title="Caja de nota" onClick={() => onInsertHtml(`<div style="background:${temaColor}18;border-left:4px solid ${temaColor};padding:12px 16px;border-radius:0 10px 10px 0;margin:12px 0;display:flex;gap:10px"><span>📌</span><div><strong style="color:${temaColor}">NOTA:</strong> escribe aquí...</div></div>`)} />
        <Btn label="⚠️" title="Aviso importante" onClick={() => onInsertHtml('<div style="background:#ff4d6d18;border-left:4px solid #ff4d6d;padding:12px 16px;border-radius:0 10px 10px 0;margin:12px 0;display:flex;gap:10px"><span>⚠️</span><div><strong style="color:#ff4d6d">IMPORTANTE:</strong> escribe aquí...</div></div>')} />
        <Btn label="💡" title="Tip / Consejo" onClick={() => onInsertHtml('<div style="background:#38bdf818;border-left:4px solid #38bdf8;padding:12px 16px;border-radius:0 10px 10px 0;margin:12px 0;display:flex;gap:10px"><span>💡</span><div><strong style="color:#38bdf8">TIP:</strong> escribe aquí...</div></div>')} />
      </div>

      {/* ===== FILA 2: Formato texto ===== */}
      <div style={{ padding: '5px 12px', display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>Text</span>

        {/* Fuente */}
        <select onChange={e => onExecCmd('fontName', e.target.value)}
          style={{ padding: '4px 7px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', cursor: 'pointer', flexShrink: 0 }}>
          {['Georgia', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana'].map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>

        {/* Tamaño */}
        <select onChange={e => onExecCmd('fontSize', e.target.value)}
          style={{ padding: '4px 7px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', cursor: 'pointer', width: '60px', flexShrink: 0 }}>
          {[
            { val: '1', label: '10px' }, { val: '2', label: '13px' }, { val: '3', label: '16px' },
            { val: '4', label: '18px' }, { val: '5', label: '24px' }, { val: '6', label: '32px' }, { val: '7', label: '48px' },
          ].map(s => <option key={s.val} value={s.val}>{s.label}</option>)}
        </select>

        <Sep />

        {/* Formato básico */}
        <Btn label={<b style={{ fontSize: '13px' }}>B</b>} title="Negrita (Cmd+B)" onClick={() => onExecCmd('bold')} />
        <Btn label={<i style={{ fontSize: '13px' }}>I</i>} title="Cursiva (Cmd+I)" onClick={() => onExecCmd('italic')} />
        <Btn label={<u style={{ fontSize: '13px' }}>U</u>} title="Subrayado (Cmd+U)" onClick={() => onExecCmd('underline')} />
        <Btn label={<s style={{ fontSize: '13px' }}>S</s>} title="Tachado" onClick={() => onExecCmd('strikeThrough')} />

        <Sep />

        {/* Títulos */}
        <Btn label="H1" title="Título 1" onClick={() => onExecCmd('formatBlock', 'h1')} style={{ fontWeight: 900, fontSize: '11px' }} />
        <Btn label="H2" title="Título 2" onClick={() => onExecCmd('formatBlock', 'h2')} style={{ fontWeight: 800, fontSize: '11px' }} />
        <Btn label="H3" title="Título 3" onClick={() => onExecCmd('formatBlock', 'h3')} style={{ fontWeight: 700, fontSize: '11px' }} />
        <Btn label="P" title="Párrafo normal" onClick={() => onExecCmd('formatBlock', 'p')} />

        <Sep />

        {/* Listas */}
        <Btn label="• Lista" title="Lista sin orden" onClick={() => onExecCmd('insertUnorderedList')} />
        <Btn label="1. Lista" title="Lista numerada" onClick={() => onExecCmd('insertOrderedList')} />

        <Sep />

        {/* Alineación */}
        <Btn label="⬅" title="Izquierda" onClick={() => onExecCmd('justifyLeft')} />
        <Btn label="⬛" title="Centrar" onClick={() => onExecCmd('justifyCenter')} />
        <Btn label="➡" title="Derecha" onClick={() => onExecCmd('justifyRight')} />
        <Btn label="☰" title="Justificar" onClick={() => onExecCmd('justifyFull')} />

        <Sep />

        {/* Color texto */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>A</span>
          <input type="color" defaultValue="#000000" onChange={e => onExecCmd('foreColor', e.target.value)} title="Color del texto"
            style={{ width: '24px', height: '24px', borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'pointer', padding: 0, flexShrink: 0 }} />
        </div>

        {/* Resaltado */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>🖊</span>
          <input type="color" defaultValue="#f5c842" onChange={e => onExecCmd('hiliteColor', e.target.value)} title="Resaltar texto"
            style={{ width: '24px', height: '24px', borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'pointer', padding: 0, flexShrink: 0 }} />
        </div>

        <Sep />

        {/* Sangría */}
        <Btn label="⇥" title="Aumentar sangría" onClick={() => onExecCmd('indent')} />
        <Btn label="⇤" title="Reducir sangría" onClick={() => onExecCmd('outdent')} />
      </div>
    </div>
  );
}