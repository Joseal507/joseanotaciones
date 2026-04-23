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

const G = '#f5c842';
const BG = '#1c1c28';
const BD = 'rgba(245,200,66,0.12)';
const FONTS = ['Georgia','Arial','Helvetica','Times New Roman','Courier New','Verdana','Trebuchet MS','Palatino','Garamond','System UI'];
const SIZES = [10,12,14,16,18,20,24,28,32,36,48];
const TC = ['#1f2937','#ef4444','#2563eb','#16a34a','#9333ea','#ea580c','#000','#fff'];
const HC = ['transparent','#fef08a','#bbf7d0','#bfdbfe','#fecaca','#e9d5ff','#fed7aa'];

type Sub = 'none'|'font'|'size'|'tc'|'hl';

export default function TextBlock({ bloque, temaColor, isNew, onUpdate, onDelete, onFinishNew }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(!!isNew);
  const [selected, setSelected] = useState(false);
  const [pos, setPos] = useState({ x: bloque.x, y: bloque.y });
  const [w, setW] = useState(bloque.width);
  const [sub, setSub] = useState<Sub>('none');
  const [above, setAbove] = useState(false);
  const pRef = useRef(pos); const wRef = useRef(w);
  const drag = useRef(false); const rsz = useRef(false);
  const ds = useRef({ mx:0, my:0, ex:0, ey:0 });
  const rs = useRef({ mx:0, w:0 });
  const lpt = useRef<any>(null);
  const jc = useRef(!!isNew);
  const html = useRef(bloque.html || '');

  useEffect(() => { pRef.current = pos; }, [pos]);
  useEffect(() => { wRef.current = w; }, [w]);
  useEffect(() => { html.current = bloque.html||''; if (!editing && ref.current) ref.current.innerHTML = html.current; }, [bloque.html, editing]);
  useEffect(() => { if (ref.current && !editing) ref.current.innerHTML = html.current; }, []);
  useEffect(() => { if (isNew && ref.current) { ref.current.innerHTML = ''; setTimeout(() => ref.current?.focus(), 30); } }, [isNew]);

  // Check placement
  useEffect(() => {
    if (!editing) return;
    const check = () => {
      if (!ref.current) return;
      const lines = ref.current.scrollHeight / (16 * 1.6);
      setAbove(lines >= 5);
    };
    check();
    const ro = new ResizeObserver(check);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [editing]);

  const save = useCallback(() => { if (ref.current) { html.current = ref.current.innerHTML||''; onUpdate({ html: html.current }); } }, [onUpdate]);

  const exit = useCallback(() => {
    if (!(ref.current?.innerText?.trim())) { onDelete(); return; }
    save(); setEditing(false); setSub('none');
    if (jc.current) { jc.current = false; onFinishNew(); }
  }, [onDelete, save, onFinishNew]);

  useEffect(() => {
    const h = (ev: MouseEvent) => {
      if (!cRef.current?.contains(ev.target as Node)) {
        if (editing) exit();
        setSelected(false); setSub('none');
        if (lpt.current) clearTimeout(lpt.current);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [editing, exit]);

  useEffect(() => {
    const mv = (e: MouseEvent) => {
      if (drag.current) setPos({ x: Math.max(0, ds.current.ex+e.clientX-ds.current.mx), y: Math.max(0, ds.current.ey+e.clientY-ds.current.my) });
      if (rsz.current) setW(Math.max(120, rs.current.w+e.clientX-rs.current.mx));
    };
    const up = () => {
      if (drag.current) { drag.current=false; onUpdate({x:pRef.current.x,y:pRef.current.y}); }
      if (rsz.current) { rsz.current=false; onUpdate({width:wRef.current}); }
      if (lpt.current) clearTimeout(lpt.current);
    };
    document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    return () => { document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); };
  }, [onUpdate]);

  const md = (e: React.MouseEvent) => {
    if (editing) return;
    if ((e.target as HTMLElement).dataset.resize||(e.target as HTMLElement).dataset.del) return;
    e.stopPropagation(); setSelected(true);
    const sx=e.clientX,sy=e.clientY,px=pRef.current.x,py=pRef.current.y;
    lpt.current = setTimeout(() => { drag.current=true; ds.current={mx:sx,my:sy,ex:px,ey:py}; }, 180);
  };

  const edit = useCallback(() => {
    setEditing(true); setSelected(true);
    setTimeout(() => {
      if (!ref.current) return;
      ref.current.innerHTML = html.current; ref.current.focus();
      const s=window.getSelection(),r=document.createRange();
      r.selectNodeContents(ref.current); r.collapse(false);
      s?.removeAllRanges(); s?.addRange(r);
    }, 20);
  }, []);

  const ex = (cmd: string, val?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, val);
    html.current = ref.current?.innerHTML||'';
    onUpdate({ html: html.current });
  };

  const fontSize = (px: number) => {
    ref.current?.focus();
    const s = window.getSelection();
    if (s && s.rangeCount > 0 && !s.isCollapsed) {
      try {
        const r = s.getRangeAt(0), sp = document.createElement('span');
        sp.style.fontSize = `${px}px`;
        sp.appendChild(r.extractContents());
        r.insertNode(sp);
        const nr = document.createRange();
        nr.selectNodeContents(sp); s.removeAllRanges(); s.addRange(nr);
      } catch {}
    }
    html.current = ref.current?.innerHTML||'';
    onUpdate({ html: html.current }); setSub('none');
  };

  const has = !!(html.current?.trim());
  const tog = (s: Sub) => setSub(p => p===s ? 'none' : s);

  const Mb = ({fn,ch,t,on}:{fn:()=>void;ch:React.ReactNode;t:string;on?:boolean}) => (
    <button onMouseDown={e=>{e.preventDefault();fn();}} title={t}
      style={{width:26,height:26,minWidth:26,borderRadius:6,border:'none',background:on?'rgba(245,200,66,0.12)':'transparent',color:on?G:'#888',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flexShrink:0}}
      onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.06)';e.currentTarget.style.color=G;}}
      onMouseLeave={e=>{e.currentTarget.style.background=on?'rgba(245,200,66,0.12)':'transparent';e.currentTarget.style.color=on?G:'#888';}}
    >{ch}</button>
  );

  const D = () => <div style={{width:1,height:14,background:BD,margin:'0 2px',flexShrink:0}} />;

  const Drop = ({children}:{children:React.ReactNode}) => {
    // Calcular si el dropdown se sale por la derecha
    const dropRef = useRef<HTMLDivElement>(null);
    const [adjust, setAdjust] = useState({left: 0});
    
    useEffect(() => {
      if (!dropRef.current) return;
      const rect = dropRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        setAdjust({left: -(rect.right - window.innerWidth + 16)});
      }
      if (rect.left < 8) {
        setAdjust({left: -rect.left + 8});
      }
    }, []);

    return (
      <div ref={dropRef} style={{
        position:'absolute', top:'100%',
        left: adjust.left,
        marginTop:4, background:BG, borderRadius:10,
        border:`1px solid ${BD}`, boxShadow:'0 8px 28px rgba(0,0,0,0.6)',
        zIndex:500, padding:8, maxWidth:'min(85vw, 300px)',
      }}>
        {children}
      </div>
    );
  };

  return (
    <div ref={cRef} data-textblock="true" onMouseDown={md}
      onDoubleClick={e=>{e.stopPropagation();if(lpt.current)clearTimeout(lpt.current);drag.current=false;if(!editing)edit();}}
      style={{position:'absolute',left:pos.x,top:pos.y,width:editing||has?w:'auto',minWidth:editing?120:0,zIndex:editing?50:selected?40:10,cursor:editing?'text':drag.current?'grabbing':selected?'grab':'default',userSelect:editing?'text':'none',visibility:has||editing||selected?'visible':'hidden',pointerEvents:'auto'}}>

      {/* TOOLBAR — absolute, never fixed */}
      {editing && (
        <div onMouseDown={e=>e.preventDefault()} style={{
          position:'absolute', left:0,
          ...(above ? {bottom:'calc(100% + 6px)'} : {top:'calc(100% + 6px)'}),
          background:BG, borderRadius:11, border:`1px solid ${BD}`,
          boxShadow:'0 6px 28px rgba(0,0,0,0.5)',
          display:'flex', alignItems:'center', gap:1, padding:'3px 5px', zIndex:200,
          flexWrap:'wrap',
        }}>
          {/* Font */}
          <div style={{position:'relative'}}>
            <Mb fn={()=>tog('font')} ch={<span style={{fontSize:10,fontWeight:800}}>Aa</span>} t="Font" on={sub==='font'} />
            {sub==='font' && <Drop><div style={{maxHeight:200,overflowY:'auto',minWidth:140}}>
              {FONTS.map(f=><button key={f} onMouseDown={e=>{e.preventDefault();ex('fontName',f);setSub('none');}}
                style={{display:'block',width:'100%',padding:'6px 10px',border:'none',background:'transparent',color:'#ccc',cursor:'pointer',fontSize:12,textAlign:'left',fontFamily:f,borderRadius:5}}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(245,200,66,0.1)';e.currentTarget.style.color=G;}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='#ccc';}}
              >{f}</button>)}
            </div></Drop>}
          </div>

          {/* Size */}
          <div style={{position:'relative'}}>
            <Mb fn={()=>tog('size')} ch={<span style={{fontSize:9,fontWeight:800}}>16</span>} t="Size" on={sub==='size'} />
            {sub==='size' && <Drop>
              <div style={{display:'flex',flexWrap:'wrap',gap:3,width:160,marginBottom:6}}>
                {SIZES.map(s=><button key={s} onMouseDown={e=>{e.preventDefault();fontSize(s);}}
                  style={{width:42,height:24,borderRadius:5,border:'none',background:'transparent',color:'#ccc',cursor:'pointer',fontSize:11,fontWeight:700}}
                  onMouseEnter={e=>{e.currentTarget.style.background='rgba(245,200,66,0.1)';e.currentTarget.style.color=G;}}
                  onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='#ccc';}}
                >{s}</button>)}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4,borderTop:`1px solid ${BD}`,paddingTop:6}}>
                <span style={{fontSize:9,color:'#666'}}>Custom</span>
                <input type="number" min={8} max={100} defaultValue={16}
                  onKeyDown={e=>{if(e.key==='Enter')fontSize(parseInt((e.target as HTMLInputElement).value)||16);}}
                  style={{width:50,height:22,borderRadius:5,border:`1px solid ${BD}`,background:'#16161f',color:G,fontSize:11,fontWeight:700,textAlign:'center',outline:'none'}} />
                <span style={{fontSize:9,color:'#555'}}>px</span>
              </div>
            </Drop>}
          </div>

          <D />
          <Mb fn={()=>ex('bold')} ch={<b>B</b>} t="Bold" />
          <Mb fn={()=>ex('italic')} ch={<i>I</i>} t="Italic" />
          <Mb fn={()=>ex('underline')} ch={<u>U</u>} t="Underline" />
          <Mb fn={()=>ex('strikeThrough')} ch={<s style={{opacity:.5}}>S</s>} t="Strike" />
          <D />
          <Mb fn={()=>ex('insertUnorderedList')} ch="•" t="Bullets" />
          <Mb fn={()=>ex('insertOrderedList')} ch={<span style={{fontSize:10}}>1.</span>} t="Numbers" />
          <Mb fn={()=>ex('justifyLeft')} ch={<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M3 12h12M3 18h16"/></svg>} t="Left" />
          <Mb fn={()=>ex('justifyCenter')} ch={<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M6 12h12M4 18h16"/></svg>} t="Center" />
          <D />

          {/* Text color */}
          <div style={{position:'relative'}}>
            <Mb fn={()=>tog('tc')} ch={<span style={{fontSize:12,fontWeight:900,color:G}}>A</span>} t="Color" on={sub==='tc'} />
            {sub==='tc' && <Drop>
              <div style={{display:'flex',flexWrap:'wrap',gap:5,width:130,marginBottom:6}}>
                {TC.map(c=><button key={c} onMouseDown={e=>{e.preventDefault();ex('foreColor',c);setSub('none');}}
                  style={{width:22,height:22,borderRadius:'50%',background:c,border:c==='#fff'?'1.5px solid #555':'1.5px solid transparent',cursor:'pointer',transition:'transform .1s'}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='scale(1.2)';}} onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)';}} />)}
              </div>
              <label style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer',borderTop:`1px solid ${BD}`,paddingTop:6}}>
                <span style={{fontSize:9,color:'#666'}}>Custom</span>
                <input type="color" defaultValue="#1f2937" onChange={e=>{ex('foreColor',e.target.value);setSub('none');}}
                  style={{width:20,height:20,borderRadius:4,border:`1px solid ${BD}`,cursor:'pointer',padding:0}} />
              </label>
            </Drop>}
          </div>

          {/* Highlight */}
          <div style={{position:'relative'}}>
            <Mb fn={()=>tog('hl')} ch={<span style={{fontSize:9,background:'#fef08a',color:'#000',padding:'1px 3px',borderRadius:2,fontWeight:800}}>ab</span>} t="Highlight" on={sub==='hl'} />
            {sub==='hl' && <Drop>
              <div style={{display:'flex',flexWrap:'wrap',gap:5,width:130,marginBottom:6}}>
                {HC.map(c=><button key={c} onMouseDown={e=>{e.preventDefault();ex('hiliteColor',c);setSub('none');}}
                  style={{width:22,height:22,borderRadius:4,background:c==='transparent'?'repeating-conic-gradient(#555 0% 25%,#333 0% 50%) 50%/8px 8px':c,border:`1.5px solid ${BD}`,cursor:'pointer',transition:'transform .1s'}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='scale(1.2)';}} onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)';}} />)}
              </div>
              <label style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer',borderTop:`1px solid ${BD}`,paddingTop:6}}>
                <span style={{fontSize:9,color:'#666'}}>Custom</span>
                <input type="color" defaultValue="#fef08a" onChange={e=>{ex('hiliteColor',e.target.value);setSub('none');}}
                  style={{width:20,height:20,borderRadius:4,border:`1px solid ${BD}`,cursor:'pointer',padding:0}} />
              </label>
            </Drop>}
          </div>

          <D />
          <Mb fn={onDelete} ch={<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>} t="Delete" />
        </div>
      )}

      {/* TEXT */}
      <div style={{
        border: editing ? `2px solid ${temaColor}` : selected ? `1.5px solid ${temaColor}66` : '1.5px solid transparent',
        borderRadius:6, background: editing ? 'rgba(255,255,255,0.98)' : 'transparent',
        boxShadow: editing ? '0 4px 20px rgba(0,0,0,0.12)' : 'none',
        transition:'border .12s,background .12s',
      }}>
        <div ref={ref} contentEditable={editing} suppressContentEditableWarning
          onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')exit();}}
          onBlur={()=>{setTimeout(()=>{if(cRef.current?.contains(document.activeElement))return;exit();},150);}}
          onInput={()=>{html.current=ref.current?.innerHTML||'';onUpdate({html:html.current});}}
          className="ebloque"
          style={{minHeight:editing?'24px':'auto',padding:'4px 8px',fontFamily:'Georgia,serif',fontSize:'16px',color:'#1f2937',outline:'none',lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-word',caretColor:temaColor}}
        />
      </div>

      {/* Resize */}
      {selected && <div data-resize="true" onMouseDown={e=>{e.preventDefault();e.stopPropagation();if(lpt.current)clearTimeout(lpt.current);rsz.current=true;rs.current={mx:e.clientX,w:wRef.current};}}
        style={{position:'absolute',right:-8,top:'50%',transform:'translateY(-50%)',width:14,height:30,background:temaColor,borderRadius:7,cursor:'ew-resize',zIndex:60,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3}}>
        {[0,1,2].map(i=><div key={i} style={{width:2,height:2,borderRadius:'50%',background:'#000'}} />)}
      </div>}

      {/* Delete */}
      {selected && !editing && <div data-del="true" onMouseDown={e=>{e.stopPropagation();if(lpt.current)clearTimeout(lpt.current);}} onClick={()=>onDelete()}
        style={{position:'absolute',top:-14,right:-8,background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:6,padding:'2px 6px',cursor:'pointer',zIndex:9999}}>
        <span style={{fontSize:11,color:'#ef4444'}}>✕</span>
      </div>}
    </div>
  );
}
