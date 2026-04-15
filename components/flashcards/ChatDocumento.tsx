'use client';

import { useState, useRef, useEffect } from 'react';
import { useIdioma } from '../../hooks/useIdioma';

interface Mensaje {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  contexto: string;
  nombreDoc: string;
  temaColor: string;
  onClose: () => void;
}

export default function ChatDocumento({ contexto, nombreDoc, temaColor, onClose }: Props) {
  const { tr, idioma } = useIdioma();
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      role: 'assistant',
      content: idioma === 'en'
        ? `Hi! I'm AlciBot 🤖 You can ask me anything about the document **${nombreDoc}**. I will only respond based on its content.`
        : `¡Hola! Soy AlciBot 🤖 Puedes preguntarme cualquier cosa sobre el documento **${nombreDoc}**. Solo responderé basándome en su contenido.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [cargando, setCargando] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: userMsg,
          contexto,
          historial: mensajes.slice(-6).map(m => ({ role: m.role, content: m.content })),
          idioma,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMensajes(prev => [...prev, { role: 'assistant', content: data.respuesta }]);
      }
    } catch (err) {
      setMensajes(prev => [...prev, { role: 'assistant', content: idioma === 'en' ? 'Connection error.' : 'Error al conectar.' }]);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>
      <div style={{ padding: '16px 24px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            💬 AlciBot — {idioma === 'en' ? 'Chat with document' : 'Chat con el documento'}
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>📄 {nombreDoc}</p>
        </div>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
          ✕ {tr('cerrar')}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '800px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {mensajes.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%', padding: '14px 18px',
              borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: msg.role === 'user' ? temaColor : 'var(--bg-card)',
              color: msg.role === 'user' ? '#000' : 'var(--text-primary)',
              fontSize: '15px', lineHeight: 1.6,
              border: msg.role === 'assistant' ? '1px solid var(--border-color)' : 'none',
              fontWeight: msg.role === 'user' ? 600 : 400, whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
            </div>
          </div>
        ))}
        {cargando && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '14px 18px', borderRadius: '18px 18px 18px 4px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', gap: '6px', alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: temaColor, animation: `bounce 1s ${i * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '16px 24px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', gap: '10px' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && enviar()}
            placeholder={idioma === 'en' ? 'Ask something about the document...' : 'Pregunta algo sobre el documento...'}
            disabled={cargando}
            style={{ flex: 1, padding: '12px 16px', borderRadius: '12px', border: `2px solid ${input ? temaColor : 'var(--border-color)'}`, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', transition: 'border 0.2s' }}
          />
          <button onClick={enviar} disabled={!input.trim() || cargando}
            style={{ padding: '12px 20px', borderRadius: '12px', border: 'none', background: input.trim() && !cargando ? temaColor : 'var(--bg-card2)', color: input.trim() && !cargando ? '#000' : 'var(--text-faint)', fontWeight: 800, fontSize: '14px', cursor: input.trim() && !cargando ? 'pointer' : 'not-allowed' }}>
            {tr('enviar')}
          </button>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '8px auto 0', maxWidth: '800px', textAlign: 'center' }}>
          {idioma === 'en' ? 'AlciBot only responds based on the document content' : 'AlciBot solo responde basándose en el contenido del documento'}
        </p>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}