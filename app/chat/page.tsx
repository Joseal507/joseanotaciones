'use client';

import { useState, useRef, useEffect } from 'react';
import { getPerfil, getMaterias } from '../../lib/storage';

interface Mensaje {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      role: 'assistant',
      content: '¡Hola! Soy AlciBot 🤖 Tu asistente de estudio personal. Puedo explicarte conceptos, ayudarte a estudiar, resolver dudas y más. ¿En qué te puedo ayudar hoy?',
    },
  ]);
  const [input, setInput] = useState('');
  const [cargando, setCargando] = useState(false);
  const [perfil, setPerfil] = useState<any>(null);
  const [todosDocumentos, setTodosDocumentos] = useState<any[]>([]);
  const [usarDocumentos, setUsarDocumentos] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Cargar perfil
    setPerfil(getPerfil());

    // Cargar todos los documentos de todas las materias
    const materias = getMaterias();
    const docs: any[] = [];
    materias.forEach(m => {
      m.temas.forEach(t => {
        t.documentos.forEach(d => {
          if (d.contenido) {
            docs.push({
              nombre: d.nombre,
              materia: m.nombre,
              contenido: d.contenido,
            });
          }
        });
      });
    });
    setTodosDocumentos(docs);
  }, []);

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
          contexto: null,
          historial: mensajes.slice(-10).map(m => ({ role: m.role, content: m.content })),
          perfil,
          todosDocumentos: usarDocumentos ? todosDocumentos : [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMensajes(prev => [...prev, { role: 'assistant', content: data.respuesta }]);
      }
    } catch (err) {
      setMensajes(prev => [...prev, { role: 'assistant', content: 'Error al conectar. Intenta de nuevo.' }]);
    } finally {
      setCargando(false);
    }
  };

  const renderInline = (texto: string): any[] => {
    const partes = texto.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    return partes.map((parte, i) => {
      if (parte.startsWith('**') && parte.endsWith('**')) {
        return <strong key={i} style={{ fontWeight: 800, color: 'inherit' }}>{parte.slice(2, -2)}</strong>;
      }
      if (parte.startsWith('*') && parte.endsWith('*')) {
        return <em key={i}>{parte.slice(1, -1)}</em>;
      }
      if (parte.startsWith('`') && parte.endsWith('`')) {
        return <code key={i} style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '13px' }}>{parte.slice(1, -1)}</code>;
      }
      return parte;
    });
  };

  const renderMensaje = (texto: string) => {
    const lineas = texto.split('\n');
    return lineas.map((linea, i) => {
      if (linea.startsWith('### ')) return <h3 key={i} style={{ fontSize: '16px', fontWeight: 800, color: 'var(--gold)', margin: '12px 0 6px' }}>{linea.slice(4)}</h3>;
      if (linea.startsWith('## ')) return <h2 key={i} style={{ fontSize: '18px', fontWeight: 800, color: 'var(--gold)', margin: '14px 0 8px' }}>{linea.slice(3)}</h2>;
      if (linea.startsWith('# ')) return <h1 key={i} style={{ fontSize: '20px', fontWeight: 900, color: 'var(--gold)', margin: '16px 0 8px' }}>{linea.slice(2)}</h1>;
      if (linea.match(/^\d+\. /)) {
        const num = linea.match(/^(\d+)\./)?.[1];
        const content = linea.replace(/^\d+\. /, '');
        return (
          <div key={i} style={{ display: 'flex', gap: '10px', margin: '6px 0', alignItems: 'flex-start' }}>
            <span style={{ background: 'var(--gold)', color: '#000', width: '22px', height: '22px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, flexShrink: 0, marginTop: '2px' }}>
              {num}
            </span>
            <span style={{ lineHeight: 1.6 }}>{renderInline(content)}</span>
          </div>
        );
      }
      if (linea.startsWith('- ')) {
        return (
          <div key={i} style={{ display: 'flex', gap: '8px', margin: '4px 0', alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--gold)', fontWeight: 900, flexShrink: 0 }}>•</span>
            <span style={{ lineHeight: 1.6 }}>{renderInline(linea.slice(2))}</span>
          </div>
        );
      }
      if (linea.trim() === '') return <div key={i} style={{ height: '8px' }} />;
      return <p key={i} style={{ margin: '4px 0', lineHeight: 1.7 }}>{renderInline(linea)}</p>;
    });
  };

  const sugerencias = [
    '¿Cómo funciona la fotosíntesis?',
    'Explícame las leyes de Newton',
    '¿Qué es la derivada en cálculo?',
    'Dame técnicas para memorizar mejor',
    '¿Cómo hago un resumen efectivo?',
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, sans-serif' }}>

      {/* Header */}
      <header style={{
        background: 'var(--bg-card)',
        borderBottom: '3px solid var(--gold)',
        padding: '0 40px',
        height: '68px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            onClick={() => window.location.href = '/'}
            style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            ← Inicio
          </button>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
              🤖 AlciBot
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
              {usarDocumentos
                ? `Usando ${todosDocumentos.length} documentos de tus materias`
                : 'Asistente de estudio AI'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Toggle usar documentos */}
          <button
            onClick={() => setUsarDocumentos(!usarDocumentos)}
            title={usarDocumentos ? 'Desactivar acceso a mis documentos' : `Activar acceso a ${todosDocumentos.length} documentos`}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: `2px solid ${usarDocumentos ? 'var(--blue)' : 'var(--border-color)'}`,
              background: usarDocumentos ? 'var(--blue-dim)' : 'transparent',
              color: usarDocumentos ? 'var(--blue)' : 'var(--text-muted)',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
            📚 {usarDocumentos ? `Docs ON (${todosDocumentos.length})` : 'Usar mis docs'}
          </button>

          {/* Ver perfil */}
          <button
            onClick={() => window.location.href = '/perfil'}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            📊 Mi perfil
          </button>

          {/* Limpiar */}
          <button
            onClick={() => setMensajes([{ role: 'assistant', content: '¡Hola! Soy AlciBot 🤖 ¿En qué te puedo ayudar hoy?' }])}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            🗑️ Limpiar
          </button>
        </div>
      </header>

      {/* Barra colores */}
      <div style={{ display: 'flex', height: '3px' }}>
        <div style={{ flex: 1, background: 'var(--gold)' }} />
        <div style={{ flex: 1, background: 'var(--red)' }} />
        <div style={{ flex: 1, background: 'var(--blue)' }} />
        <div style={{ flex: 1, background: 'var(--pink)' }} />
      </div>

      {/* Banner docs activos */}
      {usarDocumentos && todosDocumentos.length > 0 && (
        <div style={{ background: 'var(--blue-dim)', borderBottom: '1px solid var(--blue-border)', padding: '8px 40px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--blue)', fontWeight: 600 }}>
            📚 AlciBot tiene acceso a {todosDocumentos.length} documento{todosDocumentos.length !== 1 ? 's' : ''} de tus materias.
            Puedes preguntarle sobre cualquier cosa que hayas subido.
          </span>
        </div>
      )}

      {/* Mensajes */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        maxWidth: '800px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
      }}>

        {/* Sugerencias iniciales */}
        {mensajes.length === 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '16px' }}>
            {sugerencias.map((s, i) => (
              <button
                key={i}
                onClick={() => setInput(s)}
                style={{ padding: '8px 14px', borderRadius: '20px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.color = 'var(--gold)'; }}
                onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Mensajes */}
        {mensajes.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            alignItems: 'flex-end',
            gap: '8px',
          }}>
            {msg.role === 'assistant' && (
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                🤖
              </div>
            )}
            <div style={{
              maxWidth: '75%',
              padding: '14px 18px',
              borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: msg.role === 'user' ? 'var(--gold)' : 'var(--bg-card)',
              color: msg.role === 'user' ? '#000' : 'var(--text-primary)',
              fontSize: '15px',
              lineHeight: 1.7,
              border: msg.role === 'assistant' ? '1px solid var(--border-color)' : 'none',
              fontWeight: msg.role === 'user' ? 600 : 400,
            }}>
              {msg.role === 'assistant' ? renderMensaje(msg.content) : msg.content}
            </div>
            {msg.role === 'user' && (
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                👤
              </div>
            )}
          </div>
        ))}

        {/* Cargando */}
        {cargando && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-end', gap: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
              🤖
            </div>
            <div style={{ padding: '14px 18px', borderRadius: '18px 18px 18px 4px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', gap: '6px', alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: `bounce 1s ${i * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '20px 40px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', gap: '10px' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder="Escribe tu pregunta... (Enter para enviar, Shift+Enter nueva línea)"
            disabled={cargando}
            rows={2}
            style={{
              flex: 1,
              padding: '14px 16px',
              borderRadius: '14px',
              border: `2px solid ${input ? 'var(--gold)' : 'var(--border-color)'}`,
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '15px',
              resize: 'none',
              outline: 'none',
              transition: 'border 0.2s',
              fontFamily: 'inherit',
              lineHeight: 1.5,
            }}
          />
          <button
            onClick={enviar}
            disabled={!input.trim() || cargando}
            style={{
              padding: '14px 24px',
              borderRadius: '14px',
              border: 'none',
              background: input.trim() && !cargando ? 'var(--gold)' : 'var(--bg-card2)',
              color: input.trim() && !cargando ? '#000' : 'var(--text-faint)',
              fontWeight: 800,
              fontSize: '15px',
              cursor: input.trim() && !cargando ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              alignSelf: 'flex-end',
            }}>
            Enviar →
          </button>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '8px auto 0', maxWidth: '800px', textAlign: 'center' }}>
          {usarDocumentos
            ? `AlciBot tiene acceso a tus ${todosDocumentos.length} documentos y conoce tu perfil de estudio`
            : 'AlciBot responde con conocimiento general · Activa "Usar mis docs" para que acceda a tus materias'}
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