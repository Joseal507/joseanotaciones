'use client';

import React, { useState } from 'react';

const G = '#f5c842';
const BG = '#1c1c28';
const BD = 'rgba(245,200,66,0.18)';

const FONTS = ['Georgia','Arial','Helvetica','Times New Roman','Courier New','Verdana','Trebuchet MS','Palatino','Garamond','System UI'];
const SIZES = [10,12,14,16,18,20,24,28,32,36,48,64];
const TCOLORS = ['#1f2937','#ef4444','#f97316','#eab308','#22c55e','#2563eb','#9333ea','#ec4899','#000','#fff'];
const HCOLORS = ['transparent','#fef08a','#bbf7d0','#bfdbfe','#fecaca','#e9d5ff','#fed7aa','#99f6e4'];

type Sub = 'none'|'font'|'size'|'color'|'highlight'|'align'|'heading';

interface Props {
  side: 'top' | 'bottom';
  onExec: (cmd: string, val?: string) => void;
  onFontSize: (px: number) => void;
  onFontFamily: (f: string) => void;
  onHeading: (tag: string) => void;
  onDelete: () => void;
  onSaveSelection: () => void;
}

// Prevent focus steal on ANY interaction
const noFocus = (e: React.MouseEvent | React.TouchEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

function Btn({ onClick, children, title, active, danger }: {
  onClick: () => void; children: React.ReactNode; title: string; active?: boolean; danger?: boolean;
}) {
  return (
    <button
      onMouseDown={noFocus}
      onTouchStart={noFocus}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      title={title}
      style={{
        width: 28, height: 28, minWidth: 28, borderRadius: 7, border: 'none',
        background: active ? 'rgba(245,200,66,0.15)' : 'transparent',
        color: danger ? '#ef4444' : active ? G : 'rgba(255,255,255,0.7)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, flexShrink: 0,
      }}
    >{children}</button>
  );
}

function Drop({ side, children }: { side: 'top'|'bottom'; children: React.ReactNode }) {
  return (
    <div
      onMouseDown={noFocus}
      onTouchStart={noFocus}
      style={{
        position: 'absolute',
        ...(side === 'top' ? { top: 'calc(100% + 6px)' } : { bottom: 'calc(100% + 6px)' }),
        left: 0, background: '#16161f', borderRadius: 12,
        border: `1px solid ${BD}`, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
        zIndex: 99999, padding: 8, minWidth: 160, maxWidth: 'min(90vw, 280px)',
      }}
    >{children}</div>
  );
}

export default function TextToolbar({ side, onExec, onFontSize, onFontFamily, onHeading, onDelete, onSaveSelection }: Props) {
  const [sub, setSub] = useState<Sub>('none');
  const tog = (s: Sub) => setSub(p => p === s ? 'none' : s);

  const Sep = () => <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 3px' }} />;

  return (
    <div
      onMouseDown={noFocus}
      onTouchStart={noFocus}
      style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        ...(side === 'top' ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }),
        background: BG, borderRadius: 12, border: `1px solid ${BD}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', gap: 2,
        padding: '4px 6px', zIndex: 99999,
      }}
    >
      {/* HEADING */}
      <div style={{ position: 'relative' }}>
        <Btn onClick={() => tog('heading')} title="Heading" active={sub==='heading'}>
          <span style={{ fontSize: 10, fontWeight: 900 }}>H</span>
        </Btn>
        {sub === 'heading' && (
          <Drop side={side}>
            {[{t:'h1',l:'Título 1',s:18},{t:'h2',l:'Título 2',s:15},{t:'h3',l:'Título 3',s:13},{t:'p',l:'Normal',s:12}].map(h=>(
              <button key={h.t} onMouseDown={noFocus}
                onClick={(e)=>{e.preventDefault();e.stopPropagation();onHeading(h.t);setSub('none');}}
                style={{display:'block',width:'100%',padding:'7px 10px',border:'none',background:'transparent',
                  color:'rgba(255,255,255,0.8)',cursor:'pointer',fontSize:h.s,fontWeight:800,textAlign:'left',borderRadius:7}}
              >{h.l}</button>
            ))}
          </Drop>
        )}
      </div>

      {/* FONT */}
      <div style={{ position: 'relative' }}>
        <Btn onClick={() => tog('font')} title="Fuente" active={sub==='font'}>
          <span style={{ fontSize: 10, fontWeight: 800 }}>Aa</span>
        </Btn>
        {sub === 'font' && (
          <Drop side={side}>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {FONTS.map(f=>(
                <button key={f} onMouseDown={noFocus}
                  onClick={(e)=>{e.preventDefault();e.stopPropagation();onFontFamily(f);setSub('none');}}
                  style={{display:'block',width:'100%',padding:'7px 10px',border:'none',background:'transparent',
                    color:'rgba(255,255,255,0.75)',cursor:'pointer',fontSize:13,textAlign:'left',fontFamily:f,borderRadius:7}}
                >{f}</button>
              ))}
            </div>
          </Drop>
        )}
      </div>

      {/* SIZE */}
      <div style={{ position: 'relative' }}>
        <Btn onClick={() => tog('size')} title="Tamaño" active={sub==='size'}>
          <span style={{ fontSize: 9, fontWeight: 900 }}>16</span>
        </Btn>
        {sub === 'size' && (
          <Drop side={side}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {SIZES.map(s=>(
                <button key={s} onMouseDown={noFocus}
                  onClick={(e)=>{e.preventDefault();e.stopPropagation();onFontSize(s);setSub('none');}}
                  style={{width:40,height:28,borderRadius:7,border:`1px solid ${BD}`,background:'transparent',
                    color:'rgba(255,255,255,0.75)',cursor:'pointer',fontSize:11,fontWeight:700}}
                >{s}</button>
              ))}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6,borderTop:`1px solid ${BD}`,paddingTop:8}}>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>Custom:</span>
              <input type="number" min={6} max={200} defaultValue={16}
                onMouseDown={e=>e.stopPropagation()}
                onClick={e=>e.stopPropagation()}
                onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){onFontSize(parseInt((e.target as HTMLInputElement).value)||16);setSub('none');}}}
                style={{width:56,height:26,borderRadius:7,border:`1px solid ${BD}`,background:'#111118',
                  color:G,fontSize:12,fontWeight:700,textAlign:'center',outline:'none'}}
              />
            </div>
          </Drop>
        )}
      </div>

      <Sep />

      {/* FORMAT */}
      <Btn onClick={()=>onExec('bold')} title="Negrita"><b>B</b></Btn>
      <Btn onClick={()=>onExec('italic')} title="Cursiva"><i>I</i></Btn>
      <Btn onClick={()=>onExec('underline')} title="Subrayado"><u>U</u></Btn>
      <Btn onClick={()=>onExec('strikeThrough')} title="Tachado"><s style={{opacity:0.7}}>S</s></Btn>

      <Sep />

      {/* LISTS */}
      <Btn onClick={()=>onExec('insertUnorderedList')} title="Viñetas">•</Btn>
      <Btn onClick={()=>onExec('insertOrderedList')} title="Numerada"><span style={{fontSize:10}}>1.</span></Btn>

      <Sep />

      {/* ALIGN */}
      <div style={{ position: 'relative' }}>
        <Btn onClick={() => tog('align')} title="Alinear" active={sub==='align'}>
          <span style={{fontSize:10}}>≡</span>
        </Btn>
        {sub === 'align' && (
          <Drop side={side}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{c:'justifyLeft',l:'←'},{c:'justifyCenter',l:'↔'},{c:'justifyRight',l:'→'},{c:'justifyFull',l:'⇔'}].map(a=>(
                <button key={a.c} onMouseDown={noFocus}
                  onClick={(e)=>{e.preventDefault();e.stopPropagation();onExec(a.c);setSub('none');}}
                  style={{width:36,height:36,borderRadius:8,border:`1px solid ${BD}`,background:'transparent',
                    color:'rgba(255,255,255,0.7)',cursor:'pointer',fontSize:16,
                    display:'flex',alignItems:'center',justifyContent:'center'}}
                >{a.l}</button>
              ))}
            </div>
          </Drop>
        )}
      </div>

      <Sep />

      {/* COLOR */}
      <div style={{ position: 'relative' }}>
        <Btn onClick={() => tog('color')} title="Color" active={sub==='color'}>
          <span style={{fontWeight:900,fontSize:13,color:G}}>A</span>
        </Btn>
        {sub === 'color' && (
          <Drop side={side}>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
              {TCOLORS.map(c=>(
                <button key={c} onMouseDown={noFocus}
                  onClick={(e)=>{e.preventDefault();e.stopPropagation();onExec('foreColor',c);setSub('none');}}
                  style={{width:24,height:24,borderRadius:'50%',background:c,
                    border:c==='#fff'?'2px solid #555':'2px solid transparent',
                    cursor:'pointer',boxShadow:'0 2px 6px rgba(0,0,0,0.3)'}}
                />
              ))}
            </div>
            <label onMouseDown={e=>e.stopPropagation()}
              style={{display:'flex',alignItems:'center',gap:8,borderTop:`1px solid ${BD}`,paddingTop:8,cursor:'pointer'}}>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Custom</span>
              <input type="color" defaultValue="#1f2937"
                onMouseDown={e=>e.stopPropagation()}
                onChange={e=>{onExec('foreColor',e.target.value);setSub('none');}}
                style={{width:24,height:24,borderRadius:6,border:`1px solid ${BD}`,cursor:'pointer',padding:0}}
              />
            </label>
          </Drop>
        )}
      </div>

      {/* HIGHLIGHT */}
      <div style={{ position: 'relative' }}>
        <Btn onClick={() => tog('highlight')} title="Resaltado" active={sub==='highlight'}>
          <span style={{fontSize:10,fontWeight:900,background:'#fef08a',color:'#000',padding:'1px 4px',borderRadius:3}}>ab</span>
        </Btn>
        {sub === 'highlight' && (
          <Drop side={side}>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
              {HCOLORS.map(c=>(
                <button key={c} onMouseDown={noFocus}
                  onClick={(e)=>{e.preventDefault();e.stopPropagation();onExec('hiliteColor',c);setSub('none');}}
                  style={{width:24,height:24,borderRadius:6,
                    background:c==='transparent'?'repeating-conic-gradient(#444 0% 25%,#222 0% 50%) 50%/8px 8px':c,
                    border:`2px solid ${BD}`,cursor:'pointer'}}
                />
              ))}
            </div>
            <label onMouseDown={e=>e.stopPropagation()}
              style={{display:'flex',alignItems:'center',gap:8,borderTop:`1px solid ${BD}`,paddingTop:8,cursor:'pointer'}}>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>Custom</span>
              <input type="color" defaultValue="#fef08a"
                onMouseDown={e=>e.stopPropagation()}
                onChange={e=>{onExec('hiliteColor',e.target.value);setSub('none');}}
                style={{width:24,height:24,borderRadius:6,border:`1px solid ${BD}`,cursor:'pointer',padding:0}}
              />
            </label>
          </Drop>
        )}
      </div>

      <Sep />

      {/* LINK */}
      <Btn onClick={()=>{onSaveSelection();const u=prompt('URL:');if(u)onExec('createLink',u);}} title="Enlace">
        <span style={{fontSize:11}}>🔗</span>
      </Btn>

      {/* QUOTE */}
      <Btn onClick={()=>onHeading('blockquote')} title="Cita">
        <span style={{fontSize:12}}>❝</span>
      </Btn>

      <Sep />

      {/* DELETE */}
      <Btn onClick={onDelete} title="Eliminar" danger>
        <span style={{fontSize:11}}>🗑</span>
      </Btn>
    </div>
  );
}
