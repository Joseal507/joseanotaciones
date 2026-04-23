'use client';

import { useState } from 'react';
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

const G = '#f5c842';
const INKS = ['#000000','#1e40af','#dc2626','#16a34a','#9333ea','#ea580c','#0d9488','#be185d','#ffffff'];

export default function Toolbar(p: Props) {
  const { temaColor, herramientaActiva: h, onHerramienta: go, brushColor: bc, onBrushColor: setBC, brushSize: bs, onBrushSize: setBS, onExecCmd: ex, onInsertHtml: html, onInsertImagen, onInsertDibujo, onInsertPdfFondo, onUndo, onRedo } = p;
  const [open, setOpen] = useState<string>('');
  const tog = (k: string) => setOpen(o => o === k ? '' : k);

  const draw = ['boligrafo','lapiz','marcador','borrador','borrador_trazo','regla','forma_rect','forma_circulo','forma_triangulo'].includes(h);
  const sel = h === 'seleccion' || h === 'lasso';
  const eraser = h === 'borrador' || h === 'borrador_trazo';

  const TB = ({ id, ch, tit }: { id: Herramienta; ch: React.ReactNode; tit: string }) => {
    const on = h === id;
    return <button onClick={() => { go(id); setOpen(''); }} title={tit} style={{
      width: 40, height: 40, borderRadius: 11, border: on ? `2px solid ${G}` : '2px solid transparent',
      background: on ? `${G}15` : 'transparent', color: on ? G : '#6b7280',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s',
    }}>{ch}</button>;
  };

  const S = () => <div style={{ width: 1, height: 24, background: '#2a2a3a', margin: '0 4px', flexShrink: 0 }} />;

  const SmBtn = ({ fn, ch, tit }: { fn: () => void; ch: React.ReactNode; tit: string }) =>
    <button onClick={fn} title={tit} style={{ width: 36, height: 36, borderRadius: 9, border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{ch}</button>;

  return (
    <div style={{ userSelect: 'none', position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '5px 10px',
        background: '#18181b', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
      }}>
        {/* ── Cursor / Text ── */}
        <TB id="texto" tit="Text mode" ch={
          <svg width="16" height="16" viewBox="0 0 24 24" fill={h==='texto'?G:'currentColor'}><path d="M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z"/></svg>
        } />
        <TB id="seleccion" tit="Rectangle select" ch={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={h==='seleccion'?'#818cf8':'currentColor'} strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="4 2"/></svg>
        } />
        <TB id="lasso" tit="Lasso select" ch={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={h==='lasso'?'#818cf8':'currentColor'} strokeWidth="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.5 0 3-.3 4.3-.9" strokeDasharray="4 2"/><circle cx="18" cy="18" r="3" fill="none"/><line x1="20" y1="20" x2="22" y2="22"/></svg>
        } />

        <S />

        {/* ── Draw tools ── */}
        <TB id="boligrafo" tit="Pen" ch={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
        } />
        <TB id="lapiz" tit="Pencil" ch={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/></svg>
        } />
        <TB id="marcador" tit="Highlighter" ch={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15.5 4.5l4 4L8 20H4v-4z"/><path d="M18 2l4 4" strokeOpacity=".3"/></svg>
        } />

        <S />

        {/* ── Erasers ── */}
        <TB id="borrador" tit="Stroke eraser" ch={
          <svg width="18" height="13" viewBox="0 0 28 18" fill="none" stroke={h==='borrador'?'#f87171':'currentColor'} strokeWidth="1.5"><rect x="1" y="1" width="26" height="16" rx="3"/><rect x="1" y="1" width="9" height="16" rx="3" fill={h==='borrador'?'#f8717130':'currentColor'} fillOpacity=".1"/><line x1="10" y1="1" x2="10" y2="17" strokeOpacity=".3"/></svg>
        } />
        <TB id="borrador_trazo" tit="Pixel eraser" ch={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={h==='borrador_trazo'?'#f87171':'currentColor'} strokeWidth="2"><circle cx="12" cy="12" r="8"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
        } />

        <S />

        {/* ── Shapes ── */}
        <TB id="regla" tit="Line" ch={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={h==='regla'?'#a78bfa':'currentColor'} strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="19" x2="19" y2="5"/></svg>
        } />
        <TB id="forma_rect" tit="Rectangle" ch={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={h==='forma_rect'?'#a78bfa':'currentColor'} strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="1.5"/></svg>
        } />
        <TB id="forma_circulo" tit="Ellipse" ch={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={h==='forma_circulo'?'#a78bfa':'currentColor'} strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg>
        } />
        <TB id="forma_triangulo" tit="Triangle" ch={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={h==='forma_triangulo'?'#a78bfa':'currentColor'} strokeWidth="2"><path d="M12 4L21 20H3z"/></svg>
        } />

        <S />

        {/* ── Color picker (draw only) ── */}
        {draw && !eraser && (
          <button onClick={() => tog('clr')} title="Ink color" style={{
            width: 40, height: 40, borderRadius: 11, border: open==='clr' ? `2px solid ${G}` : '2px solid transparent',
            background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: bc, border: bc==='#ffffff'||bc==='#000000' ? '2px solid #555' : 'none', boxShadow: `0 2px 8px ${bc}40` }} />
          </button>
        )}

        {/* ── Size picker (draw only) ── */}
        {draw && (
          <button onClick={() => tog('sz')} title="Brush size" style={{
            width: 40, height: 40, borderRadius: 11, border: open==='sz' ? `2px solid ${G}` : '2px solid transparent',
            background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <div style={{ width: Math.min(bs*1.5,20), height: Math.min(bs*1.5,20), borderRadius: '50%', background: eraser ? '#888' : bc, opacity: h==='marcador'?.4:1 }} />
          </button>
        )}

        <S />

        {/* ── Undo / Redo ── */}
        <SmBtn fn={onUndo} tit="Undo ⌘Z" ch={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>
        } />
        <SmBtn fn={onRedo} tit="Redo ⌘Y" ch={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/></svg>
        } />

        <S />

        {/* ── Insert ── */}
        <button onClick={() => tog('ins')} title="Insert" style={{
          height: 36, padding: '0 12px', borderRadius: 10,
          background: open==='ins' ? `${G}15` : 'transparent', border: open==='ins' ? `1.5px solid ${G}40` : '1.5px solid transparent',
          color: open==='ins' ? G : '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>

        {/* ── Text format auto-shows in text mode ── */}
      </div>

      {/* ════════ SUB-PANELS ════════ */}

      {open === 'clr' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: '#111116', borderTop: '1px solid #222' }}>
          {INKS.map(c => (
            <button key={c} onClick={() => setBC(c)} style={{
              width: bc===c ? 28 : 21, height: bc===c ? 28 : 21, borderRadius: '50%', background: c, flexShrink: 0,
              border: bc===c ? `3px solid ${G}` : c==='#ffffff' ? '2px solid #444' : c==='#000000' ? '2px solid #444' : '2px solid transparent',
              cursor: 'pointer', transition: 'all .12s', boxShadow: bc===c ? `0 0 12px ${c}50` : 'none',
            }} />
          ))}
          <input type="color" value={bc} onChange={e => setBC(e.target.value)}
            style={{ width: 26, height: 26, borderRadius: '50%', border: '2px solid #333', cursor: 'pointer', padding: 0 }} />
        </div>
      )}

      {open === 'sz' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#111116', borderTop: '1px solid #222' }}>
          {[1,2,4,8,14,22].map(s => (
            <button key={s} onClick={() => setBS(s)} style={{
              width: 36, height: 36, borderRadius: 10,
              border: bs===s ? `2px solid ${G}` : '2px solid transparent', background: bs===s ? `${G}12` : 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <div style={{ width: Math.min(s*1.5,22), height: Math.min(s*1.5,22), borderRadius: '50%', background: eraser ? '#888' : bc, opacity: h==='marcador'?.35:1 }} />
            </button>
          ))}
        </div>
      )}

      {open === 'ins' && (
        <div style={{ display: 'flex', gap: 5, padding: '8px 14px', background: '#111116', borderTop: '1px solid #222', flexWrap: 'wrap' }}>
          {[
            { fn: () => { onInsertImagen(); setOpen(''); }, l: '🖼 Image', c: '#38bdf8' },
            { fn: () => { onInsertDibujo(); setOpen(''); }, l: '🎨 Canvas', c: '#a78bfa' },
            { fn: () => { onInsertPdfFondo(); setOpen(''); }, l: '📄 PDF', c: '#f472b6' },
            { fn: () => { html(`<div style="background:${temaColor}0d;border-left:3px solid ${temaColor};padding:10px 14px;border-radius:0 8px 8px 0;margin:8px 0"><strong style="color:${temaColor}">📌 Note:</strong> ...</div>`); setOpen(''); }, l: '📌 Note', c: G },
            { fn: () => { html('<hr style="border:none;border-top:1.5px solid #ddd;margin:12px 0"/>'); setOpen(''); }, l: '— Line', c: '#64748b' },
          ].map(i => (
            <button key={i.l} onClick={i.fn} style={{
              padding: '6px 14px', borderRadius: 9, border: `1px solid ${i.c}30`, background: `${i.c}10`,
              color: i.c, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{i.l}</button>
          ))}
        </div>
      )}

      {false && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '6px 12px', background: '#111116', borderTop: '1px solid #222', overflowX: 'auto' }}>
          <select onChange={e => ex('fontName', e.target.value)} style={{ height: 28, padding: '0 6px', borderRadius: 7, border: '1px solid #333', background: '#1a1a1a', color: '#ccc', fontSize: 11, cursor: 'pointer', outline: 'none' }}>
            {['Georgia','Arial','Helvetica','Times New Roman','Courier New','Verdana'].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select onChange={e => ex('fontSize', e.target.value)} style={{ height: 28, width: 50, borderRadius: 7, border: '1px solid #333', background: '#1a1a1a', color: '#ccc', fontSize: 11, cursor: 'pointer', outline: 'none' }}>
            {[{v:'1',l:'10'},{v:'2',l:'12'},{v:'3',l:'14'},{v:'4',l:'16'},{v:'5',l:'20'},{v:'6',l:'28'},{v:'7',l:'36'}].map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
          <S />
          {[{c:'bold',l:'B',s:{fontWeight:900}},{c:'italic',l:'I',s:{fontStyle:'italic'}},{c:'underline',l:'U',s:{textDecoration:'underline'}},{c:'strikeThrough',l:'S',s:{textDecoration:'line-through',opacity:.5}}].map(x => (
            <button key={x.c} onClick={() => ex(x.c)} style={{ height: 28, width: 28, borderRadius: 7, border: 'none', background: 'transparent', color: G, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, ...(x.s as any) }}>{x.l}</button>
          ))}
          <S />
          {[{c:'h1',l:'H1',w:900},{c:'h2',l:'H2',w:800},{c:'h3',l:'H3',w:700},{c:'p',l:'P',w:500}].map(x => (
            <button key={x.c} onClick={() => ex('formatBlock', x.c)} style={{ height: 28, padding: '0 5px', borderRadius: 7, border: 'none', background: 'transparent', color: '#888', fontSize: 11, fontWeight: x.w, cursor: 'pointer' }}>{x.l}</button>
          ))}
          <S />
          <button onClick={() => ex('insertUnorderedList')} style={{ height: 28, width: 28, borderRadius: 7, border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 14 }}>•</button>
          <button onClick={() => ex('insertOrderedList')} style={{ height: 28, width: 28, borderRadius: 7, border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 12 }}>1.</button>
          <S />
          <label style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: G }}>A</span>
            <input type="color" defaultValue="#000000" onChange={e => ex('foreColor', e.target.value)} style={{ width: 18, height: 18, borderRadius: 4, border: '1px solid #444', cursor: 'pointer', padding: 0 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
            <span style={{ fontSize: 11, color: '#666' }}>bg</span>
            <input type="color" defaultValue="#fef08a" onChange={e => ex('hiliteColor', e.target.value)} style={{ width: 18, height: 18, borderRadius: 4, border: '1px solid #444', cursor: 'pointer', padding: 0 }} />
          </label>
        </div>
      )}
    </div>
  );
}
