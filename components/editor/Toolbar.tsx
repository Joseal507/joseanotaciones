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
  onInsertPdfFondo: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const COLORES = [
  '#0f172a', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
];

export default function Toolbar({
  temaColor, herramientaActiva, onHerramienta,
  brushColor, onBrushColor, brushSize, onBrushSize,
  onExecCmd, onInsertHtml, onInsertImagen, onInsertDibujo, onInsertPdfFondo,
  onUndo, onRedo,
}: Props) {

  const isDrawing = ['boligrafo', 'marcador', 'lapiz', 'borrador'].includes(herramientaActiva);
  const isSelecting = herramientaActiva === 'seleccion';
  const isDrawingMode = isDrawing || isSelecting;

  const insertLatex = () => {
    const formula = prompt('Formula LaTeX (ej: x^2 + y^2 = z^2):');
    if (!formula) return;
    onInsertHtml(`<span class="latex-formula" contenteditable="false" style="display:inline-block;background:#f0f4ff;border:1px solid #c7d2fe;border-radius:6px;padding:2px 8px;font-family:monospace;font-size:13px;color:#4338ca;cursor:default;user-select:none;">📐 ${formula}</span>`);
  };

  const Div = ({ dark }: { dark?: boolean }) => (
    <div style={{ width: '1px', height: '20px', background: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)', margin: '0 4px', flexShrink: 0 }} />
  );

  return (
    <div style={{ userSelect: 'none' }}>
      {/* ══════ FILA 1 — Herramientas ══════ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '2px', padding: '6px 12px', flexWrap: 'wrap',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        borderBottom: `2px solid ${temaColor}`,
        boxShadow: `0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.05)`,
        position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, transparent, ${temaColor}88, ${temaColor}, ${temaColor}88, transparent)`, opacity: 0.6 }} />

        {/* MODO TEXTO / SELECCIÓN */}
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
          <button onClick={() => onHerramienta('texto')} title="Modo texto" style={{
            height: '32px', padding: '0 12px', borderRadius: '8px',
            border: herramientaActiva === 'texto' ? `1.5px solid ${temaColor}` : '1.5px solid rgba(255,255,255,0.12)',
            background: herramientaActiva === 'texto' ? `linear-gradient(135deg, ${temaColor}33, ${temaColor}11)` : 'rgba(255,255,255,0.05)',
            color: herramientaActiva === 'texto' ? temaColor : 'rgba(255,255,255,0.6)',
            fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, transition: 'all 0.15s',
            boxShadow: herramientaActiva === 'texto' ? `0 0 12px ${temaColor}30` : 'none',
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z"/></svg>
            Texto
          </button>
          <button onClick={() => onHerramienta('seleccion')} title="Seleccionar trazos" style={{
            height: '32px', padding: '0 10px', borderRadius: '8px',
            border: isSelecting ? '1.5px solid #6366f1' : '1.5px solid rgba(255,255,255,0.12)',
            background: isSelecting ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
            color: isSelecting ? '#818cf8' : 'rgba(255,255,255,0.6)',
            fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, transition: 'all 0.15s',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 3l14 9-7 1-3 7L5 3z"/></svg>
            Sel.
          </button>
        </div>

        <Div dark />

        {/* HERRAMIENTAS DIBUJO */}
        <div style={{ display: 'flex', gap: '2px' }}>
          {[
            { id: 'boligrafo' as Herramienta, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>, color: '#fb923c' },
            { id: 'lapiz' as Herramienta, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>, color: '#a3e635' },
            { id: 'marcador' as Herramienta, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 22v-3l11-11"/><path d="M11.5 5.5l7 7"/><path d="M14 3l3 3-9 9-3-3 9-9z" fill="currentColor" fillOpacity="0.2"/></svg>, color: '#facc15' },
            { id: 'borrador' as Herramienta, icon: <svg width="17" height="12" viewBox="0 0 28 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="2" width="26" height="16" rx="3"/><rect x="1" y="2" width="9" height="16" rx="3" fill="rgba(255,255,255,0.15)"/><line x1="10" y1="2" x2="10" y2="18" strokeOpacity="0.4"/></svg>, color: '#94a3b8' },
          ].map(({ id, icon, color }) => {
            const active = herramientaActiva === id;
            return (
              <button key={id} onClick={() => onHerramienta(id)} title={id} style={{
                height: '32px', width: '36px', borderRadius: '8px',
                border: active ? `1.5px solid ${color}66` : '1.5px solid transparent',
                background: active ? `${color}20` : 'transparent',
                color: active ? color : 'rgba(255,255,255,0.5)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s',
                boxShadow: active ? `0 0 10px ${color}30` : 'none',
              }}
                onMouseEnter={(e: any) => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = color; } }}
                onMouseLeave={(e: any) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; } }}
              >{icon}</button>
            );
          })}
        </div>

        {/* COLORES PINCEL */}
        {isDrawingMode && (
          <>
            <Div dark />
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              {COLORES.map(c => (
                <button key={c} onClick={() => onBrushColor(c)} title={c} style={{
                  width: brushColor === c ? '22px' : '16px', height: brushColor === c ? '22px' : '16px',
                  borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', flexShrink: 0,
                  boxShadow: brushColor === c ? `0 0 0 2px #1e293b, 0 0 0 4px ${c}, 0 0 12px ${c}60` : '0 1px 4px rgba(0,0,0,0.4)',
                  transition: 'all 0.15s',
                }} />
              ))}
              <input type="color" value={brushColor} onChange={e => onBrushColor(e.target.value)} title="Color personalizado"
                style={{ width: '24px', height: '24px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', cursor: 'pointer', padding: 0, flexShrink: 0, background: 'transparent' }} />
            </div>
            <Div dark />
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              {[1, 3, 6, 12, 20].map(s => (
                <button key={s} onClick={() => onBrushSize(s)} title={`${s}px`} style={{
                  width: '28px', height: '28px', borderRadius: '7px',
                  border: brushSize === s ? `1.5px solid ${temaColor}88` : '1.5px solid rgba(255,255,255,0.1)',
                  background: brushSize === s ? `${temaColor}20` : 'rgba(255,255,255,0.05)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.12s',
                }}>
                  <div style={{
                    width: `${Math.min(s * 1.6, 18)}px`, height: `${Math.min(s * 1.6, 18)}px`, borderRadius: '50%',
                    background: herramientaActiva === 'borrador' ? '#94a3b8' : brushColor,
                    opacity: herramientaActiva === 'lapiz' ? 0.6 : herramientaActiva === 'marcador' ? 0.4 : 1,
                    boxShadow: brushSize === s ? `0 0 6px ${brushColor}80` : 'none',
                  }} />
                </button>
              ))}
              <input type="number" min={1} max={60} value={brushSize} onChange={e => onBrushSize(Math.min(60, Math.max(1, parseInt(e.target.value) || 1)))}
                style={{ width: '44px', height: '28px', padding: '0 6px', borderRadius: '7px', border: '1.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)', fontSize: '11px', fontWeight: 700, textAlign: 'center', flexShrink: 0, outline: 'none' }} />
            </div>
          </>
        )}

        <Div dark />

        {/* UNDO / REDO */}
        <div style={{ display: 'flex', gap: '2px' }}>
          {[
            { fn: onUndo, title: '⌘Z', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg> },
            { fn: onRedo, title: '⌘Y', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/></svg> },
          ].map(({ fn, title, icon }) => (
            <button key={title} onClick={fn} title={title} style={{
              height: '32px', width: '32px', borderRadius: '8px', border: '1.5px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
            }}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'white'; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
            >{icon}</button>
          ))}
        </div>

        <Div dark />

        {/* INSERTAR */}
        <div style={{ display: 'flex', gap: '2px' }}>
          {[
            { fn: onInsertImagen, label: 'Imagen', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>, color: '#38bdf8' },
            { fn: onInsertDibujo, label: 'Lienzo', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M7 14c1-3 3-5 5-5s4 2 5 5"/></svg>, color: '#a78bfa' },
            { fn: onInsertPdfFondo, label: '📋 Fondo', icon: null, color: '#f472b6' },
            { fn: insertLatex, label: '∑ Math', icon: null, color: '#34d399' },
          ].map(({ fn, label, icon, color }) => (
            <button key={label} onClick={fn} title={label} style={{
              height: '32px', padding: '0 10px', borderRadius: '8px', border: `1.5px solid ${color}30`, background: `${color}12`,
              color: color, fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
              flexShrink: 0, transition: 'all 0.15s', letterSpacing: '0.3px',
            }}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = `${color}22`; e.currentTarget.style.borderColor = `${color}60`; e.currentTarget.style.boxShadow = `0 0 12px ${color}25`; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = `${color}12`; e.currentTarget.style.borderColor = `${color}30`; e.currentTarget.style.boxShadow = 'none'; }}
            >{icon}{label}</button>
          ))}
        </div>

        <Div dark />

        {/* BLOQUES */}
        <div style={{ display: 'flex', gap: '2px' }}>
          {[
            { label: '📌 Nota', color: temaColor, fn: () => onInsertHtml(`<div style="background:${temaColor}0d;border-left:3px solid ${temaColor};padding:10px 14px;border-radius:0 8px 8px 0;margin:8px 0"><strong style="color:${temaColor}">📌 Nota:</strong> escribe aquí...</div>`) },
            { label: '⚠️', color: '#eab308', fn: () => onInsertHtml('<div style="background:#fef9c3;border-left:3px solid #eab308;padding:10px 14px;border-radius:0 8px 8px 0;margin:8px 0"><strong style="color:#854d0e">⚠️ Importante:</strong> escribe aquí...</div>') },
            { label: '💡', color: '#22c55e', fn: () => onInsertHtml('<div style="background:#f0fdf4;border-left:3px solid #22c55e;padding:10px 14px;border-radius:0 8px 8px 0;margin:8px 0"><strong style="color:#15803d">💡 Tip:</strong> escribe aquí...</div>') },
            { label: '—', color: '#64748b', fn: () => onInsertHtml('<hr style="border:none;border-top:1.5px solid #e2e8f0;margin:12px 0"/>') },
          ].map(({ label, color, fn }) => (
            <button key={label} onClick={fn} title={label} style={{
              height: '32px', padding: '0 9px', borderRadius: '8px', border: `1.5px solid rgba(255,255,255,0.08)`,
              background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.65)', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0, transition: 'all 0.15s',
            }}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = `${color}20`; e.currentTarget.style.borderColor = `${color}50`; e.currentTarget.style.color = color; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; }}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* ══════ FILA 2 — Formato texto ══════ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 12px', flexWrap: 'wrap', background: 'linear-gradient(to bottom, #f8fafc, #f1f5f9)', borderBottom: '1px solid #e2e8f0' }}>
        <select onChange={e => onExecCmd('fontName', e.target.value)} style={{ height: '26px', padding: '0 8px', borderRadius: '6px', border: '1.5px solid #e2e8f0', background: 'white', color: '#374151', fontSize: '11px', cursor: 'pointer', outline: 'none', flexShrink: 0, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          {['Georgia', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana'].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select onChange={e => onExecCmd('fontSize', e.target.value)} style={{ height: '26px', width: '60px', padding: '0 4px', borderRadius: '6px', border: '1.5px solid #e2e8f0', background: 'white', color: '#374151', fontSize: '11px', cursor: 'pointer', outline: 'none', flexShrink: 0, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          {[{ val: '1', l: '10' }, { val: '2', l: '12' }, { val: '3', l: '14' }, { val: '4', l: '16' }, { val: '5', l: '20' }, { val: '6', l: '28' }, { val: '7', l: '36' }].map(s => <option key={s.val} value={s.val}>{s.l}px</option>)}
        </select>
        <Div />
        {[
          { cmd: 'bold', label: 'B', style: { fontWeight: 900, fontSize: '13px' } as any },
          { cmd: 'italic', label: 'I', style: { fontStyle: 'italic', fontWeight: 600, fontSize: '13px' } as any },
          { cmd: 'underline', label: 'U', style: { textDecoration: 'underline', fontWeight: 600, fontSize: '13px' } as any },
          { cmd: 'strikeThrough', label: 'S', style: { textDecoration: 'line-through', fontWeight: 600, fontSize: '13px' } as any },
        ].map(({ cmd, label, style: s }) => (
          <button key={cmd} onClick={() => onExecCmd(cmd)} title={cmd} style={{
            height: '26px', width: '28px', borderRadius: '6px', border: '1.5px solid transparent', background: 'transparent',
            color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s', flexShrink: 0, ...s,
          }}
            onMouseEnter={(e: any) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
          >{label}</button>
        ))}
        <Div />
        {[
          { cmd: 'h1', label: 'H1', color: temaColor, fw: 900, fs: '13px' },
          { cmd: 'h2', label: 'H2', color: '#1e293b', fw: 800, fs: '12px' },
          { cmd: 'h3', label: 'H3', color: '#475569', fw: 700, fs: '11px' },
          { cmd: 'p', label: 'P', color: '#94a3b8', fw: 500, fs: '11px' },
        ].map(h => (
          <button key={h.cmd} onClick={() => onExecCmd('formatBlock', h.cmd)} title={h.cmd} style={{
            height: '26px', padding: '0 7px', borderRadius: '6px', border: '1.5px solid transparent', background: 'transparent',
            color: h.color, fontSize: h.fs, fontWeight: h.fw, cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0, transition: 'all 0.12s',
          }}
            onMouseEnter={(e: any) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
          >{h.label}</button>
        ))}
        <Div />
        {[
          { cmd: 'insertUnorderedList', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.2" fill="currentColor"/><circle cx="3" cy="12" r="1.2" fill="currentColor"/><circle cx="3" cy="18" r="1.2" fill="currentColor"/></svg> },
          { cmd: 'insertOrderedList', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg> },
          { cmd: 'justifyLeft', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M3 12h12M3 18h15"/></svg> },
          { cmd: 'justifyCenter', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M6 12h12M4 18h16"/></svg> },
          { cmd: 'justifyRight', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M9 12h12M6 18h15"/></svg> },
          { cmd: 'indent', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/><line x1="9" y1="12" x2="21" y2="12"/><polyline points="3,9 6,12 3,15"/></svg> },
          { cmd: 'outdent', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/><line x1="9" y1="12" x2="21" y2="12"/><polyline points="7,9 4,12 7,15"/></svg> },
        ].map(({ cmd, icon }) => (
          <button key={cmd} onClick={() => onExecCmd(cmd)} title={cmd} style={{
            height: '26px', width: '28px', borderRadius: '6px', border: '1.5px solid transparent', background: 'transparent',
            color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.12s',
          }}
            onMouseEnter={(e: any) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
          >{icon}</button>
        ))}
        <Div />
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }} title="Color del texto">
            <span style={{ fontSize: '13px', fontWeight: 900, color: '#111827' }}>A</span>
            <input type="color" defaultValue="#000000" onChange={e => onExecCmd('foreColor', e.target.value)} style={{ width: '18px', height: '18px', borderRadius: '4px', border: '1.5px solid #e2e8f0', cursor: 'pointer', padding: 0 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '2px', cursor: 'pointer' }} title="Resaltar texto">
            <span style={{ fontSize: '12px' }}>🖊</span>
            <input type="color" defaultValue="#fef08a" onChange={e => onExecCmd('hiliteColor', e.target.value)} style={{ width: '18px', height: '18px', borderRadius: '4px', border: '1.5px solid #e2e8f0', cursor: 'pointer', padding: 0 }} />
          </label>
        </div>
      </div>
    </div>
  );
}