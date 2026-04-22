'use client';

import { useState, useRef, useEffect } from 'react';
import { getPerfil, getMaterias } from '../lib/storage';
import { getIdioma } from '../lib/i18n';

interface Mensaje {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatFlotante() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState('');
  const [cargando, setCargando] = useState(false);
  const [inicializado, setInicializado] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (abierto && !inicializado) {
      const idioma = getIdioma();
      const saludo = idioma === 'en'
        ? "Hi! I'm JeffreyBot 🤖 How can I help you study?"
        : '¡Hola! Soy JeffreyBot 🤖 ¿En qué te ayudo con el estudio?';
      setMensajes([{ role: 'assistant', content: saludo }]);
      setInicializado(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [abierto, inicializado]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: userMsg,
          historial: mensajes.slice(-8).map(m => ({ role: m.role, content: m.content })),
          perfil,
          todosDocumentos: docs.slice(0, 3),
          idioma,
        }),
      });
      const data = await res.json();
      setMensajes(prev => [...prev, {
        role: 'assistant',
        content: data.respuesta || data.message || (idioma === 'en' ? 'Error, try again.' : 'Error, intenta de nuevo.'),
      }]);
    } catch {
      setMensajes(prev => [...prev, { role: 'assistant', content: '❌ Error de conexión.' }]);
    } finally {
      setCargando(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setAbierto(!abierto)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '90px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: abierto ? 'var(--red)' : 'var(--pink)',
          border: 'none',
          cursor: 'pointer',
          fontSize: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          zIndex: 9999,
          transition: 'all 0.3s ease',
          transform: abierto ? 'rotate(180deg)' : 'rotate(0deg)',
        }}
        title="JeffreyBot"
      >
        {abierto ? '✕' : '🤖'}
      </button>

      {/* Ventana del chat */}
      {abierto && (
        <div style={{
          position: 'fixed',
          bottom: '90px',
          right: '90px',
          width: '340px',
          height: '460px',
          background: 'var(--bg-card)',
          borderRadius: '20px',
          border: '2px solid var(--pink)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          zIndex: 9998,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: '-apple-system, sans-serif',
          animation: 'slideUp 0.3s ease',
        }}>

          {/* Header */}
          <div style={{
            padding: '14px 16px',
            background: 'var(--bg-secondary)',
            borderBottom: '2px solid var(--pink)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%',
              background: 'var(--pink)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px',
            }}>🤖</div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>JeffreyBot</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {cargando ? '✍️ Escribiendo...' : '🟢 En línea'}
              </div>
            </div>
            <button
              onClick={() => window.location.href = '/chat'}
              style={{
                marginLeft: 'auto',
                padding: '6px 10px',
                borderRadius: '8px',
                border: '1px solid var(--pink)',
                background: 'transparent',
                color: 'var(--pink)',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Abrir completo ↗
            </button>
          </div>

          {/* Mensajes */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            {mensajes.map((msg, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '80%',
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: msg.role === 'user' ? 'var(--pink)' : 'var(--bg-secondary)',
                  color: msg.role === 'user' ? '#000' : 'var(--text-primary)',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  fontWeight: msg.role === 'user' ? 600 : 400,
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {cargando && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  padding: '8px 14px',
                  borderRadius: '14px 14px 14px 4px',
                  background: 'var(--bg-secondary)',
                  fontSize: '16px',
                  letterSpacing: '2px',
                }}>
                  ●●●
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '10px 12px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            gap: '8px',
            flexShrink: 0,
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviar()}
              placeholder="Pregunta algo..."
              disabled={cargando}
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: '10px',
                border: '2px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <button
              onClick={enviar}
              disabled={cargando || !input.trim()}
              style={{
                width: '38px', height: '38px',
                borderRadius: '10px',
                border: 'none',
                background: input.trim() ? 'var(--pink)' : 'var(--border-color)',
                color: '#000',
                fontSize: '16px',
                cursor: input.trim() ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
