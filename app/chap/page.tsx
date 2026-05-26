'use client';

import { useRouter } from 'next/navigation';

import { useState, useRef, useEffect } from 'react';
import { useIdioma } from '../../hooks/useIdioma';
import { useIsMobile } from '../../hooks/useIsMobile';
import { supabase } from '../../lib/supabase';
import { getSettings } from '../../lib/settings';
import AIExhausted from '../../components/AIExhausted';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

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
  const router = useRouter();
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
  const themeDim   = esMath ? 'rgba(56,189,248,0.15)' : 'color-mix(in srgb, var(--gold) 15%, transparent)';

  // Render línea con negritas
  const renderInline = (texto: string) => {
    const partes = texto.split(/(\*\*[^*]+\*\*)/g);
    return partes.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) {
        return <strong key={i} style={{ fontWeight: 900, color: 'var(--text-primary)' }}>{p.slice(2, -2)}</strong>;
      }
      return <span key={i}>{p}</span>;
    });
  };

  // Render mensaje completo
  const renderMensaje = (texto: string, isMath?: boolean) => {
    const lineas = texto.split('\n');
    const elementos: JSX.Element[] = [];
    const accent = isMath ? '#38bdf8' : 'var(--gold)';

    lineas.forEach((linea, i) => {
      const trimmed = linea.trim();

      if (/^(📌|🧠|✏️|✅|💡)/.test(trimmed)) {
        elementos.push(
          <div key={i} style={{
            margin: '14px 0 8px',
            padding: '10px 14px',
            borderRadius: 10,
            background: `color-mix(in srgb,${accent} 12%,transparent)`,
            border: `2px dashed ${accent}`,
            transform: 'rotate(-0.3deg)',
          }}>
            <span style={{
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              color: accent, fontStyle: 'italic',
            }}>
              {renderInline(trimmed)}
            </span>
          </div>
        );
        return;
      }

      if (trimmed.startsWith('### ')) {
        elementos.push(
          <h3 key={i} style={{
            fontFamily: HAND, fontSize: 22, fontWeight: 900,
            color: accent, margin: '14px 0 6px',
            transform: 'rotate(-0.5deg)', display: 'inline-block',
          }}>
            {trimmed.slice(4)}
          </h3>
        );
        return;
      }
      if (trimmed.startsWith('## ')) {
        elementos.push(
          <h2 key={i} style={{
            fontFamily: HAND, fontSize: 24, fontWeight: 900,
            color: accent, margin: '16px 0 8px',
            transform: 'rotate(-0.7deg)', display: 'inline-block',
          }}>
            {trimmed.slice(3)}
          </h2>
        );
        return;
      }
      if (trimmed.startsWith('# ')) {
        elementos.push(
          <h1 key={i} style={{
            fontFamily: HAND, fontSize: 28, fontWeight: 900,
            color: accent, margin: '18px 0 10px',
            transform: 'rotate(-1deg)', display: 'inline-block',
          }}>
            {trimmed.slice(2)}
          </h1>
        );
        return;
      }

      const numMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
      if (numMatch) {
        elementos.push(
          <div key={i} style={{
            display: 'flex', gap: 10, margin: '6px 0',
            alignItems: 'flex-start',
          }}>
            <span style={{
              background: accent, color: '#000',
              minWidth: 26, height: 26,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: HAND, fontSize: 15, fontWeight: 900,
              flexShrink: 0,
              border: '2px solid var(--text-primary)',
              boxShadow: '1px 2px 0 var(--text-primary)',
              transform: 'rotate(-3deg)',
            }}>{numMatch[1]}</span>
            <span style={{ lineHeight: 1.5, flex: 1, fontSize: 15 }}>
              {renderInline(numMatch[2])}
            </span>
          </div>
        );
        return;
      }

      if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
        elementos.push(
          <div key={i} style={{
            display: 'flex', gap: 8, margin: '5px 0',
            alignItems: 'flex-start',
          }}>
            <span style={{
              color: accent, fontWeight: 900,
              flexShrink: 0, fontSize: 18, lineHeight: 1,
            }}>✦</span>
            <span style={{ lineHeight: 1.5, fontSize: 15 }}>
              {renderInline(trimmed.slice(2))}
            </span>
          </div>
        );
        return;
      }

      if (trimmed === '') {
        elementos.push(<div key={i} style={{ height: 6 }} />);
        return;
      }

      elementos.push(
        <p key={i} style={{
          margin: '4px 0', lineHeight: 1.55,
          fontSize: 15,
        }}>
          {renderInline(trimmed)}
        </p>
      );
    });

    return elementos;
  };

  const UserAvatar = () => (
    <div style={{
      width: 38, height: 38, borderRadius: '50%',
      overflow: 'hidden', flexShrink: 0,
      background: fotoPerfil ? 'transparent' : '#38bdf8',
      border: '2.5px solid var(--text-primary)',
      boxShadow: '2px 2px 0 var(--text-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 18,
      transform: 'rotate(-3deg)',
    }}>
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

      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>

        {/* HEADER */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
          backdropFilter: 'blur(14px)',
          borderBottom: `2.5px solid var(--text-primary)`,
          padding: isMobile ? '10px 14px' : '12px 28px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12,
          transition: 'all 0.4s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => {
                try { (window as any).__showNavLoader?.('/'); } catch {}
                const fallback = setTimeout(() => { if (window.location.pathname !== '/') window.location.href = '/'; }, 700);
                try { router.push('/'); setTimeout(() => clearTimeout(fallback), 750); }
                catch { clearTimeout(fallback); window.location.href = '/'; }
              }}
              style={{
                background: 'var(--bg-card)',
                border: '2.5px solid var(--text-primary)',
                color: 'var(--text-primary)',
                padding: '7px 14px',
                borderRadius: 10,
                fontFamily: HAND, fontSize: 17, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '3px 3px 0 var(--text-primary)',
                transform: 'rotate(-2deg)',
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='4px 4px 0 var(--text-primary)';}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-2deg)';e.currentTarget.style.boxShadow='3px 3px 0 var(--text-primary)';}}
            >
              ←
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 26,
                  animation: 'nbBounce 2s ease-in-out infinite',
                  display: 'inline-block',
                }}>
                  {esMath ? '🧮' : '🤖'}
                </span>
                <h1 style={{
                  fontFamily: HAND,
                  fontSize: isMobile ? 24 : 30, fontWeight: 900,
                  color: 'var(--text-primary)', margin: 0, lineHeight: 1,
                  transform: 'rotate(-1deg)', display: 'inline-block',
                }}>
                  {esMath ? 'CHAP Mate' : 'CHAP General'}
                </h1>
                <span style={{
                  fontFamily: HAND,
                  fontSize: 13, fontWeight: 800,
                  padding: '3px 10px', borderRadius: 8,
                  background: themeColor, color: '#000',
                  border: '2px solid var(--text-primary)',
                  boxShadow: '2px 2px 0 var(--text-primary)',
                  transform: 'rotate(2deg)',
                  transition: 'background 0.4s',
                  fontStyle: 'italic',
                }}>
                  {esMath ? '✦ ciencias' : '✦ general'}
                </span>
              </div>
              {!isMobile && (
                <p style={{
                  fontFamily: BODY, fontSize: 14,
                  color: 'var(--text-muted)', margin: '2px 0 0',
                  fontStyle: 'italic',
                }}>
                  {esMath
                    ? '~ matemáticas · física · química · paso a paso ~'
                    : '~ cualquier materia · cualquier pregunta ~'}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => { setMensajes([{ role: 'assistant', content: '¡Hola! Soy El CHAP 🤖 ¿En qué te ayudo?' }]); setEsMath(false); }}
            style={{
              padding: '7px 14px',
              borderRadius: 10,
              border: '2px dashed var(--text-faint)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontFamily: HAND,
              fontSize: 16, fontWeight: 800,
              cursor: 'pointer',
              transform: 'rotate(1.5deg)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg)';e.currentTarget.style.borderColor='var(--red)';e.currentTarget.style.color='var(--red)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(1.5deg)';e.currentTarget.style.borderColor='var(--text-faint)';e.currentTarget.style.color='var(--text-muted)';}}
          >
            🗑️ {isMobile ? '' : 'limpiar'}
          </button>
        </header>

        {/* Línea rasgada */}
        <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{
          display:'block', width:'100%', height:14,
        }}>
          <path
            d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
            fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.45"
          />
        </svg>

        {/* MENSAJES */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: isMobile ? '16px 12px' : '24px',
          display: 'flex', flexDirection: 'column', gap: 14,
          maxWidth: 820, margin: '0 auto', width: '100%', boxSizing: 'border-box',
          position: 'relative',
        }}>
          {/* margen rojo cuaderno */}
          {!isMobile && (
            <div style={{
              position: 'absolute',
              top: 0, bottom: 0, left: 36,
              width: 1.5,
              background: '#ef4444', opacity: 0.18,
              pointerEvents: 'none',
            }}/>
          )}

          {mensajes.length === 1 && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 8,
              justifyContent: 'center', marginBottom: 8,
            }}>
              {sugerencias.map((s, i) => (
                <button key={i} onClick={() => setInput(s)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 10,
                    border: `2px dashed ${themeColor}`,
                    background: themeDim,
                    color: themeColor,
                    fontFamily: HAND, fontSize: 16, fontWeight: 700,
                    cursor: 'pointer',
                    transform: `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`,
                    transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                  }}
                  onMouseEnter={(e:any)=>{
                    e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px) scale(1.04)';
                  }}
                  onMouseLeave={(e:any)=>{
                    e.currentTarget.style.transform = `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`;
                  }}
                >
                  💡 {s}
                </button>
              ))}
            </div>
          )}

          {mensajes.map((msg, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              alignItems: 'flex-end', gap: 8,
            }}>
              {msg.role === 'assistant' && (
                <div style={{
                  width: 42, height: 42, borderRadius: '50%',
                  background: themeColor,
                  border: '2.5px solid var(--text-primary)',
                  boxShadow: '2px 3px 0 var(--text-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, flexShrink: 0,
                  transform: 'rotate(-3deg)',
                  transition: 'background 0.4s',
                }}>
                  {msg.isMath ? '🧮' : '🤖'}
                </div>
              )}
              <div style={{
                maxWidth: isMobile ? '88%' : '78%',
                padding: '14px 18px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user' ? themeColor : 'var(--bg-card)',
                color: msg.role === 'user' ? '#000' : 'var(--text-primary)',
                fontSize: 15,
                border: '2.5px solid var(--text-primary)',
                boxShadow: msg.role === 'user'
                  ? `3px 4px 0 ${esMath ? 'rgba(56,189,248,0.4)' : 'color-mix(in srgb, var(--gold) 40%, transparent)'}`
                  : '3px 4px 0 var(--text-primary)',
                transform: msg.role === 'user' ? 'rotate(0.3deg)' : 'rotate(-0.3deg)',
                transition: 'background 0.3s',
              }}>
                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt=""
                    style={{
                      maxWidth: '100%', borderRadius: 8,
                      marginBottom: 10, display: 'block',
                      border: '2px solid var(--text-primary)',
                    }} />
                )}
                {msg.role === 'assistant'
                  ? renderMensaje(msg.content, msg.isMath)
                  : <span style={{ fontFamily: BODY, fontSize: 19, fontWeight: 700, lineHeight: 1.3 }}>
                      {msg.content}
                    </span>}
              </div>
              {msg.role === 'user' && <UserAvatar />}
            </div>
          ))}

          {cargando && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <div style={{
                width: 42, height: 42, borderRadius: '50%',
                background: themeColor,
                border: '2.5px solid var(--text-primary)',
                boxShadow: '2px 3px 0 var(--text-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22,
                transform: 'rotate(-3deg)',
              }}>
                {esMath ? '🧮' : '🤖'}
              </div>
              <div style={{
                padding: '14px 18px',
                borderRadius: '16px 16px 16px 4px',
                background: 'var(--bg-card)',
                border: '2.5px solid var(--text-primary)',
                boxShadow: '3px 4px 0 var(--text-primary)',
                display: 'flex', gap: 6, alignItems: 'center',
                transform: 'rotate(-0.3deg)',
              }}>
                <span style={{
                  fontFamily: HAND, fontSize: 16,
                  color: themeColor, fontStyle: 'italic',
                  marginRight: 4,
                }}>
                  {idioma === 'en' ? 'thinking' : 'pensando'}
                </span>
                {[0, 1, 2].map(j => (
                  <div key={j} style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: themeColor,
                    animation: `nbBounce 1s ${j * 0.2}s infinite`,
                  }} />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* PREVIEW IMAGEN */}
        {selectedImage && (
          <div style={{
            padding: '10px 20px',
            background: 'var(--bg-secondary)',
            borderTop: '2px dashed var(--border-color)',
            maxWidth: 820, margin: '0 auto',
            width: '100%', boxSizing: 'border-box',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px',
              background: 'var(--bg-card)',
              border: `2.5px dashed ${themeColor}`,
              borderRadius: 12,
              transform: 'rotate(-0.5deg)',
            }}>
              <img src={selectedImage.preview} alt=""
                style={{
                  width: 56, height: 56, objectFit: 'cover',
                  borderRadius: 8,
                  border: '2.5px solid var(--text-primary)',
                  boxShadow: `2px 2px 0 ${themeColor}`,
                  transform: 'rotate(-3deg)',
                }} />
              <div style={{ flex: 1 }}>
                <p style={{
                  fontFamily: HAND, fontSize: 18, fontWeight: 800,
                  margin: 0, color: 'var(--text-primary)', lineHeight: 1,
                }}>
                  🖼️ Imagen lista
                </p>
                <p style={{
                  fontFamily: BODY, fontSize: 14, color: 'var(--text-muted)',
                  margin: '2px 0 0', fontStyle: 'italic',
                }}>
                  ~ agrega un mensaje o envía directo ~
                </p>
              </div>
              <button onClick={() => setSelectedImage(null)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '2px dashed var(--red)',
                  background: 'transparent',
                  color: 'var(--red)',
                  fontFamily: HAND, fontSize: 16, fontWeight: 800,
                  cursor: 'pointer',
                }}>
                ✕
              </button>
            </div>
          </div>
        )}

        {/* INPUT */}
        <div style={{
          padding: isMobile ? '12px' : '16px 24px',
          background: 'var(--bg-card)',
          borderTop: '2.5px solid var(--text-primary)',
        }}>
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <button onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '6px 14px',
                  borderRadius: 10,
                  border: `2px ${selectedImage ? 'solid' : 'dashed'} ${selectedImage ? themeColor : 'var(--border-color)'}`,
                  background: selectedImage ? themeDim : 'transparent',
                  color: selectedImage ? themeColor : 'var(--text-muted)',
                  fontFamily: HAND, fontSize: 15, fontWeight: 800,
                  cursor: 'pointer',
                  transform: 'rotate(-1deg)',
                  transition: 'all 0.25s',
                }}>
                🖼️ {idioma === 'en' ? 'image' : 'imagen'}
              </button>
              <div style={{
                padding: '6px 14px',
                borderRadius: 10,
                background: themeDim,
                border: `2px solid ${themeColor}`,
                fontFamily: HAND, fontSize: 14,
                color: themeColor, fontWeight: 800,
                display: 'flex', alignItems: 'center',
                fontStyle: 'italic',
                transform: 'rotate(1deg)',
                boxShadow: `1px 2px 0 ${themeColor}55`,
                transition: 'all 0.4s',
              }}>
                {esMath ? '🧮 modo ciencias' : '🤖 modo general'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <UserAvatar />
              <textarea
                value={input}
                onChange={(e: any) => setInput(e.target.value)}
                onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder={idioma === 'en' ? '✏️ Ask anything or write a problem...' : '✏️ Pregunta lo que sea o escribe un problema...'}
                disabled={cargando}
                rows={2}
                style={{
                  flex: 1, padding: '13px 16px', borderRadius: 12,
                  border: `2.5px solid ${input || selectedImage ? themeColor : 'var(--text-primary)'}`,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontFamily: BODY, fontSize: 19, fontWeight: 600,
                  resize: 'none', outline: 'none',
                  lineHeight: 1.4,
                  boxShadow: '3px 3px 0 var(--text-primary)',
                  transition: 'border 0.3s',
                }}
              />
              <button onClick={enviar}
                disabled={(!input.trim() && !selectedImage) || cargando}
                style={{
                  padding: '14px 22px', borderRadius: 12,
                  border: '2.5px solid var(--text-primary)',
                  background: (input.trim() || selectedImage) && !cargando ? themeColor : 'var(--bg-secondary)',
                  color: (input.trim() || selectedImage) && !cargando ? '#000' : 'var(--text-faint)',
                  fontFamily: HAND, fontSize: 20, fontWeight: 800,
                  cursor: (input.trim() || selectedImage) && !cargando ? 'pointer' : 'not-allowed',
                  whiteSpace: 'nowrap',
                  boxShadow: (input.trim() || selectedImage) && !cargando ? '3px 4px 0 var(--text-primary)' : 'none',
                  transform: 'rotate(-1deg)',
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}
                onMouseEnter={(e:any)=>{
                  if ((input.trim() || selectedImage) && !cargando) {
                    e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
                    e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
                  }
                }}
                onMouseLeave={(e:any)=>{
                  e.currentTarget.style.transform = 'rotate(-1deg)';
                  if ((input.trim() || selectedImage) && !cargando) e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
                }}
              >
                {cargando ? '⏳' : `📤 ${idioma === 'en' ? 'send' : 'enviar'}`}
              </button>
            </div>
          </div>
        </div>

        <style>{`
          @keyframes nbBounce {
            0%, 100% { transform: translateY(0) rotate(-3deg); }
            50%      { transform: translateY(-6px) rotate(3deg); }
          }
        `}</style>
      </div>
    </>
  );
}