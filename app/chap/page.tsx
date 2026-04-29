'use client';

import { useState, useRef, useEffect } from 'react';
import { useIdioma } from '../../hooks/useIdioma';
import { useIsMobile } from '../../hooks/useIsMobile';
import { supabase } from '../../lib/supabase';
import { getSettings } from '../../lib/settings';
import AIExhausted from '../../components/AIExhausted';

interface Mensaje {
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  isMath?: boolean;
}

interface ImageData {
  base64: string;
  mime: string;
  preview: string;
}

export default function ChapPage() {
  const { idioma } = useIdioma();
  const isMobile = useIsMobile();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState('');
  const [cargando, setCargando] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [fotoPerfil, setFotoPerfil] = useState('');
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [aiExhausted, setAiExhausted] = useState(false);
  const [esMath, setEsMath] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saludo = idioma === 'en'
      ? "Hi! I'm El CHAP 🤖 Ask me anything — any subject, any problem. If it's math, physics or chemistry I'll solve it step by step!"
      : '¡Hola! Soy El CHAP 🤖 Pregúntame lo que quieras — cualquier materia o problema. Si es matemáticas, física o química lo resuelvo paso a paso!';
    setMensajes([{ role: 'assistant', content: saludo }]);
    setFotoPerfil(getSettings().fotoPerfil || '');
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        const n = data.user.user_metadata?.nombre || data.user.email?.split('@')[0] || '';
        setNombreUsuario(n);
      }
    });
  }, [idioma]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  const enviar = async () => {
    if ((!input.trim() && !selectedImage) || cargando) return;
    const texto = input.trim();
    setInput('');

    const newMsg: Mensaje = {
      role: 'user',
      content: texto || '(imagen enviada)',
      imageUrl: selectedImage?.preview,
    };

    setMensajes(prev => [...prev, newMsg]);
    setSelectedImage(null);
    setCargando(true);

    try {
      const res = await fetch('/api/chap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: texto,
          historial: mensajes.slice(-10).map(m => ({ role: m.role, content: m.content })),
          idioma,
          imageBase64: selectedImage?.base64,
          imageMime: selectedImage?.mime,
          nombreUsuario,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEsMath(data.esMatematico);
        setMensajes(prev => [...prev, {
          role: 'assistant',
          content: data.respuesta,
          isMath: data.esMatematico,
        }]);
      } else if (data.error === 'AI_EXHAUSTED') {
        setAiExhausted(true);
      }
    } catch {
      setMensajes(prev => [...prev, { role: 'assistant', content: 'Error de conexión. Intenta de nuevo.' }]);
    } finally {
      setCargando(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result as string;
      setSelectedImage({ base64: result.split(',')[1], mime: file.type, preview: result });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const themeColor = esMath ? '#38bdf8' : 'var(--gold)';
  const themeDim   = esMath ? 'rgba(56,189,248,0.10)' : 'rgba(245,200,66,0.10)';

  // Render de línea con negritas
  const renderInline = (texto: string) => {
    const partes = texto.split(/(\*\*[^*]+\*\*)/g);
    return partes.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) {
        return <strong key={i} style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{p.slice(2, -2)}</strong>;
      }
      return <span key={i}>{p}</span>;
    });
  };

  // Render de mensaje completo
  const renderMensaje = (texto: string, isMath?: boolean) => {
    const lineas = texto.split('\n');
    const elementos: JSX.Element[] = [];

    lineas.forEach((linea, i) => {
      const trimmed = linea.trim();

      // Sección especial CHAP (📌🧠✏️✅💡)
      if (/^(📌|🧠|✏️|✅|💡)/.test(trimmed)) {
        elementos.push(
          <div key={i} style={{
            margin: '16px 0 8px',
            padding: '10px 16px',
            borderRadius: '12px',
            background: isMath ? 'rgba(56,189,248,0.08)' : 'rgba(245,200,66,0.08)',
            borderLeft: `4px solid ${isMath ? '#38bdf8' : 'var(--gold)'}`,
          }}>
            <span style={{ fontWeight: 900, fontSize: '15px', color: isMath ? '#38bdf8' : 'var(--gold)' }}>
              {renderInline(trimmed)}
            </span>
          </div>
        );
        return;
      }

      // Títulos ##
      if (trimmed.startsWith('### ')) {
        elementos.push(<h3 key={i} style={{ fontSize: '15px', fontWeight: 800, color: isMath ? '#38bdf8' : 'var(--gold)', margin: '14px 0 6px' }}>{trimmed.slice(4)}</h3>);
        return;
      }
      if (trimmed.startsWith('## ')) {
        elementos.push(<h2 key={i} style={{ fontSize: '17px', fontWeight: 800, color: isMath ? '#38bdf8' : 'var(--gold)', margin: '16px 0 8px' }}>{trimmed.slice(3)}</h2>);
        return;
      }
      if (trimmed.startsWith('# ')) {
        elementos.push(<h1 key={i} style={{ fontSize: '19px', fontWeight: 900, color: isMath ? '#38bdf8' : 'var(--gold)', margin: '18px 0 10px' }}>{trimmed.slice(2)}</h1>);
        return;
      }

      // Lista numerada
      const numMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
      if (numMatch) {
        elementos.push(
          <div key={i} style={{ display: 'flex', gap: '10px', margin: '6px 0', alignItems: 'flex-start' }}>
            <span style={{
              background: isMath ? '#38bdf8' : 'var(--gold)',
              color: '#000',
              minWidth: 24, height: 24,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', fontWeight: 800, flexShrink: 0,
            }}>{numMatch[1]}</span>
            <span style={{ lineHeight: 1.7, flex: 1 }}>{renderInline(numMatch[2])}</span>
          </div>
        );
        return;
      }

      // Lista con guión
      if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
        elementos.push(
          <div key={i} style={{ display: 'flex', gap: '8px', margin: '5px 0', alignItems: 'flex-start' }}>
            <span style={{ color: isMath ? '#38bdf8' : 'var(--gold)', fontWeight: 900, flexShrink: 0 }}>•</span>
            <span style={{ lineHeight: 1.7 }}>{renderInline(trimmed.slice(2))}</span>
          </div>
        );
        return;
      }

      // Línea en blanco
      if (trimmed === '') {
        elementos.push(<div key={i} style={{ height: '8px' }} />);
        return;
      }

      // Párrafo normal
      elementos.push(
        <p key={i} style={{ margin: '4px 0', lineHeight: 1.8, fontSize: '14px' }}>
          {renderInline(trimmed)}
        </p>
      );
    });

    return elementos;
  };

  const UserAvatar = () => (
    <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: fotoPerfil ? 'transparent' : '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
      {fotoPerfil ? <img src={fotoPerfil} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
    </div>
  );

  const sugerencias = idioma === 'en'
    ? ['Explain photosynthesis', 'Solve: x² + 5x + 6 = 0', "Newton's second law", 'Tips to study faster']
    : ['Explica la fotosíntesis', 'Resuelve: x² + 5x + 6 = 0', 'Segunda ley de Newton', 'Técnicas para estudiar mejor'];

  return (
    <>
      {aiExhausted && <AIExhausted onClose={() => setAiExhausted(false)} />}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} />

      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, sans-serif' }}>

        {/* HEADER */}
        <header style={{
          background: 'var(--bg-card)',
          borderBottom: `3px solid ${themeColor}`,
          padding: isMobile ? '0 14px' : '0 28px',
          height: '64px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky', top: 0, zIndex: 100,
          transition: 'border-color 0.4s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={() => window.location.href = '/'}
              style={{ background: 'none', border: `2px solid ${themeColor}`, color: themeColor, padding: '6px 12px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              ←
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>{esMath ? '🧮' : '🤖'}</span>
                <h1 style={{ fontSize: isMobile ? '15px' : '17px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                  {esMath ? 'CHAP Matemático' : 'CHAP General'}
                </h1>
                <span style={{
                  fontSize: '10px', fontWeight: 800,
                  padding: '3px 8px', borderRadius: '20px',
                  background: themeColor, color: '#000',
                  transition: 'background 0.4s',
                }}>
                  {esMath ? 'MODO CIENCIAS' : 'MODO GENERAL'}
                </span>
              </div>
              {!isMobile && (
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                  {esMath ? 'Matemáticas · Física · Química — paso a paso' : 'Cualquier materia · Preguntas generales'}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => { setMensajes([{ role: 'assistant', content: '¡Hola! Soy El CHAP 🤖 ¿En qué te ayudo?' }]); setEsMath(false); }}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            🗑️ {isMobile ? '' : 'Limpiar'}
          </button>
        </header>

        <div style={{ height: '3px', background: `linear-gradient(90deg, ${themeColor}, ${esMath ? '#a78bfa' : 'var(--red)'}, ${esMath ? '#4ade80' : 'var(--blue)'})`, transition: 'all 0.4s' }} />

        {/* MENSAJES */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 12px' : '24px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '820px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

          {mensajes.length === 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '8px' }}>
              {sugerencias.map((s, i) => (
                <button key={i} onClick={() => { setInput(s); }}
                  style={{ padding: '8px 16px', borderRadius: '20px', border: `1px solid ${themeColor}44`, background: themeDim, color: themeColor, fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {mensajes.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '8px' }}>
              {msg.role === 'assistant' && (
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: themeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, transition: 'background 0.4s' }}>
                  {msg.isMath ? '🧮' : '🤖'}
                </div>
              )}
              <div style={{
                maxWidth: isMobile ? '90%' : '80%',
                padding: '13px 17px',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: msg.role === 'user' ? themeColor : 'var(--bg-card)',
                color: msg.role === 'user' ? '#000' : 'var(--text-primary)',
                fontSize: '14px',
                border: msg.role === 'assistant' ? '1px solid var(--border-color)' : 'none',
                boxShadow: msg.role === 'assistant' ? '0 2px 10px rgba(0,0,0,0.08)' : 'none',
                transition: 'background 0.3s',
              }}>
                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: '10px', marginBottom: '10px', display: 'block' }} />
                )}
                {msg.role === 'assistant'
                  ? renderMensaje(msg.content, msg.isMath)
                  : <span style={{ fontWeight: 600 }}>{msg.content}</span>}
              </div>
              {msg.role === 'user' && <UserAvatar />}
            </div>
          ))}

          {cargando && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: themeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                {esMath ? '🧮' : '🤖'}
              </div>
              <div style={{ padding: '14px 18px', borderRadius: '18px 18px 18px 4px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                {[0, 1, 2].map(j => (
                  <div key={j} style={{ width: 8, height: 8, borderRadius: '50%', background: themeColor, animation: `bounce 1s ${j * 0.2}s infinite` }} />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* PREVIEW IMAGEN */}
        {selectedImage && (
          <div style={{ padding: '10px 20px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', maxWidth: '820px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img src={selectedImage.preview} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: '8px', border: `2px solid ${themeColor}` }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>🖼️ Imagen lista para analizar</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '2px 0 0' }}>Agrega un mensaje o envía directamente</p>
              </div>
              <button onClick={() => setSelectedImage(null)} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
            </div>
          </div>
        )}

        {/* INPUT */}
        <div style={{ padding: isMobile ? '12px' : '16px 24px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ maxWidth: '820px', margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
              <button onClick={() => fileInputRef.current?.click()}
                style={{ padding: '6px 13px', borderRadius: '8px', border: `1px solid ${selectedImage ? themeColor : 'var(--border-color)'}`, background: selectedImage ? themeDim : 'transparent', color: selectedImage ? themeColor : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                🖼️ {idioma === 'en' ? 'Image' : 'Imagen'}
              </button>
              <div style={{ padding: '6px 13px', borderRadius: '8px', background: themeDim, border: `1px solid ${themeColor}33`, fontSize: '11px', color: themeColor, fontWeight: 600, display: 'flex', alignItems: 'center', transition: 'all 0.4s' }}>
                {esMath ? '🧮 Modo Ciencias activo' : '🤖 Modo General activo'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
              <UserAvatar />
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder={idioma === 'en' ? 'Ask anything or write a problem...' : 'Pregunta lo que sea o escribe un problema...'}
                disabled={cargando}
                rows={2}
                style={{
                  flex: 1, padding: '13px 16px', borderRadius: '14px',
                  border: `2px solid ${input || selectedImage ? themeColor : 'var(--border-color)'}`,
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  fontSize: '14px', resize: 'none', outline: 'none',
                  fontFamily: 'inherit', lineHeight: 1.5, transition: 'border 0.3s',
                }}
              />
              <button onClick={enviar}
                disabled={(!input.trim() && !selectedImage) || cargando}
                style={{
                  padding: '13px 22px', borderRadius: '14px', border: 'none',
                  background: (input.trim() || selectedImage) && !cargando ? themeColor : 'var(--bg-secondary)',
                  color: (input.trim() || selectedImage) && !cargando ? '#000' : 'var(--text-faint)',
                  fontWeight: 800, fontSize: '14px',
                  cursor: (input.trim() || selectedImage) && !cargando ? 'pointer' : 'not-allowed',
                  transition: 'all 0.3s', whiteSpace: 'nowrap',
                }}>
                {cargando ? '⏳' : (idioma === 'en' ? 'Send' : 'Enviar')}
              </button>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes bounce {
            0%, 100% { transform: translateY(0); opacity: 0.5; }
            50% { transform: translateY(-6px); opacity: 1; }
          }
        `}</style>
      </div>
    </>
  );
}
