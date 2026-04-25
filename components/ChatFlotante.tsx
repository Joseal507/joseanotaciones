'use client';

import { useState, useRef, useEffect } from 'react';
import { getPerfil, getMaterias } from '../lib/storage';
import { getIdioma } from '../lib/i18n';
import { getSettings } from '../lib/settings';

interface Mensaje { role: 'user' | 'assistant'; content: string; }

export default function ChatFlotante() {
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [minimizado, setMinimizado] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState('');
  const [cargando, setCargando] = useState(false);
  const [inicializado, setInicializado] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ x: 24, y: -1 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  useEffect(() => {
    setMounted(true);
    const s = getSettings();
    // Leer posición guardada del chat
    try {
      const saved = localStorage.getItem('josea_chat_pos');
      if (saved) {
        const p = JSON.parse(saved);
        setPos({ x: Math.min(Math.max(p.x, 0), window.innerWidth - 60), y: Math.min(Math.max(p.y, 0), window.innerHeight - 60) });
      } else {
        setPos({ x: 24, y: window.innerHeight - 80 });
      }
    } catch {
      setPos({ x: 24, y: window.innerHeight - 80 });
    }
    setEnabled(s.chatEnabled !== false);
    const poll = setInterval(() => {
      const s2 = getSettings();
      setEnabled(s2.chatEnabled !== false);
    }, 1000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (abierto && !inicializado) {
      const idioma = getIdioma();
      setMensajes([{ role: 'assistant', content: idioma === 'en' ? "Hi! I'm JeffreyBot 🤖 How can I help?" : '¡Hola! Soy JeffreyBot 🤖 ¿En qué te ayudo?' }]);
      setInicializado(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [abierto, inicializado]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensajes]);

  if (!mounted || !enabled) return null;

  const enviar = async () => {
    if (!input.trim() || cargando) return;
    const userMsg = input.trim();
    setInput('');
    setMensajes(prev => [...prev, { role: 'user', content: userMsg }]);
    setCargando(true);
    try {
      const idioma = getIdioma();
      const perfil = getPerfil();
      const materias = getMaterias();
      const docs: any[] = [];
      materias.forEach(m => m.temas.forEach(t => t.documentos.forEach(d => {
        if (d.contenido) docs.push({ nombre: d.nombre, materia: m.nombre, contenido: d.contenido.substring(0, 500) });
      })));
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: userMsg, historial: mensajes.slice(-8), perfil, todosDocumentos: docs.slice(0, 3), idioma }),
      });
      const data = await res.json();
      setMensajes(prev => [...prev, { role: 'assistant', content: data.respuesta || data.message || 'Error' }]);
    } catch {
      setMensajes(prev => [...prev, { role: 'assistant', content: '❌ Error' }]);
    } finally {
      setCargando(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  return (
    <>
      {/* Botón: draggable */}
      <button
        onMouseDown={(e) => {
          hasMoved.current = false;
          dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          setDragging(true);
          const onMove = (ev: MouseEvent) => {
            hasMoved.current = true;
            const nx = Math.min(Math.max(ev.clientX - dragOffset.current.x, 0), window.innerWidth - 60);
            const ny = Math.min(Math.max(ev.clientY - dragOffset.current.y, 0), window.innerHeight - 60);
            setPos({ x: nx, y: ny });
            localStorage.setItem('josea_chat_pos', JSON.stringify({ x: nx, y: ny }));
          };
          const onUp = () => {
            setDragging(false);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        onTouchStart={(e) => {
          hasMoved.current = false;
          const t = e.touches[0];
          dragOffset.current = { x: t.clientX - pos.x, y: t.clientY - pos.y };
          setDragging(true);
          const onMove = (ev: TouchEvent) => {
            hasMoved.current = true;
            const tc = ev.touches[0];
            const nx = Math.min(Math.max(tc.clientX - dragOffset.current.x, 0), window.innerWidth - 60);
            const ny = Math.min(Math.max(tc.clientY - dragOffset.current.y, 0), window.innerHeight - 60);
            setPos({ x: nx, y: ny });
            localStorage.setItem('josea_chat_pos', JSON.stringify({ x: nx, y: ny }));
          };
          const onUp = () => {
            setDragging(false);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
          };
          window.addEventListener('touchmove', onMove, { passive: true });
          window.addEventListener('touchend', onUp);
        }}
        onClick={() => {
          if (hasMoved.current) return;
          if (minimizado) { setMinimizado(false); return; }
          setAbierto(!abierto);
        }}
        style={{
          position: 'fixed',
          left: pos.x + 'px',
          top: pos.y + 'px',
          width: minimizado ? '32px' : '52px',
          height: minimizado ? '32px' : '52px',
          borderRadius: '50%',
          background: abierto && !minimizado ? 'var(--red)' : 'var(--pink)',
          border: 'none',
          cursor: dragging ? 'grabbing' : 'grab',
          fontSize: minimizado ? '14px' : '22px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          zIndex: 9999,
          transition: dragging ? 'none' : 'width 0.2s, height 0.2s',
          opacity: minimizado ? 0.5 : 1,
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        title="JeffreyBot — arrastra para mover"
      >
        {abierto && !minimizado ? '✕' : '🤖'}
      </button>

      {/* Panel */}
      {abierto && !minimizado && (
        <div style={{
          position: 'fixed', left: pos.x + 'px', top: Math.max(10, pos.y - 450) + 'px',
          width: '320px', height: '440px',
          background: 'var(--bg-card)', borderRadius: '20px',
          border: '2px solid var(--pink)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          zIndex: 9998, display: 'flex', flexDirection: 'column',
          overflow: 'hidden', fontFamily: '-apple-system, sans-serif',
          animation: 'slideUp 0.25s ease',
        }}>
          {/* Header */}
          <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderBottom: '2px solid var(--pink)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--pink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>🤖</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>JeffreyBot</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{cargando ? '✍️...' : '🟢 Online'}</div>
            </div>
            <button onClick={() => window.location.href = '/chat'} style={{ background: 'none', border: '1px solid var(--pink)', borderRadius: '6px', color: 'var(--pink)', fontSize: '10px', fontWeight: 700, cursor: 'pointer', padding: '2px 7px' }}>↗</button>
            <button onClick={() => setMinimizado(true)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>▬</button>
            <button onClick={() => setAbierto(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer', padding: '2px' }}>✕</button>
          </div>

          {/* Mensajes */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {mensajes.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '80%', padding: '7px 11px',
                  borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  background: msg.role === 'user' ? 'var(--pink)' : 'var(--bg-secondary)',
                  color: msg.role === 'user' ? '#000' : 'var(--text-primary)',
                  fontSize: '13px', lineHeight: 1.5, fontWeight: msg.role === 'user' ? 600 : 400,
                }}>{msg.content}</div>
              </div>
            ))}
            {cargando && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '7px 12px', borderRadius: '12px 12px 12px 4px', background: 'var(--bg-secondary)', fontSize: '14px', letterSpacing: '2px' }}>●●●</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '6px', flexShrink: 0 }}>
            <input
              ref={inputRef} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviar()}
              placeholder="Pregunta algo..."
              disabled={cargando}
              style={{ flex: 1, padding: '8px 10px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
            />
            <button onClick={enviar} disabled={cargando || !input.trim()}
              style={{ width: '36px', height: '36px', borderRadius: '8px', border: 'none', background: input.trim() ? 'var(--pink)' : 'var(--border-color)', color: '#000', fontSize: '15px', cursor: input.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              ➤
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </>
  );
}
