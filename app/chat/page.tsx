'use client';

import { useState, useRef, useEffect } from 'react';
import { getPerfil, getMaterias } from '../../lib/storage';
import { getSettings } from '../../lib/settings';
import { useIdioma } from '../../hooks/useIdioma';
import { getIdioma } from '../../lib/i18n';
import AIExhausted from '../../components/AIExhausted';

interface Mensaje {
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  isAudio?: boolean;
}

interface ImageData {
  base64: string;
  mime: string;
  preview: string;
}

export default function ChatPage() {
  const { tr, idioma } = useIdioma();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState('');
  const [cargando, setCargando] = useState(false);
  const [perfil, setPerfil] = useState<any>(null);
  const [todosDocumentos, setTodosDocumentos] = useState<any[]>([]);
  const [usarDocumentos, setUsarDocumentos] = useState(false);
  const [fotoPerfil, setFotoPerfil] = useState('');
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [audioGrabado, setAudioGrabado] = useState<{ blob: Blob; url: string } | null>(null);
  const [transcribiendo, setTranscribiendo] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [modoLlamada, setModoLlamada] = useState(false);
  const [aiExhausted, setAiExhausted] = useState(false);
  const [llamandoAI, setLlamandoAI] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const saludo = idioma === 'en'
      ? "Hi! I'm JeffreyBot 🤖 Disciple of José Alberto de Obaldia. I can help you with text, images or voice messages! How can I help?"
      : '¡Hola! Soy JeffreyBot 🤖 Discípulo de José Alberto de Obaldia. ¡Puedes enviarme texto, imágenes o mensajes de voz! ¿En qué te ayudo?';
    setMensajes([{ role: 'assistant', content: saludo }]);
    setPerfil(getPerfil());
    setFotoPerfil(getSettings().fotoPerfil || '');

    const materias = getMaterias();
    const docs: any[] = [];
    materias.forEach(m => m.temas.forEach(t => t.documentos.forEach(d => {
      if (d.contenido) docs.push({ nombre: d.nombre, materia: m.nombre, contenido: d.contenido });
    })));
    setTodosDocumentos(docs);
  }, [idioma]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes]);

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
    return () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  // ===== ENVIAR =====
  const enviar = async (textoOverride?: string, imgData?: ImageData) => {
    const texto = textoOverride || input.trim();
    const imgToSend: ImageData | null = imgData || selectedImage;

    if (!texto && !imgToSend) return;
    if (cargando) return;

    const newMsg: Mensaje = {
      role: 'user',
      content: texto || (idioma === 'en' ? '(image sent)' : '(imagen enviada)'),
      imageUrl: imgToSend?.preview,
    };

    setMensajes(prev => [...prev, newMsg]);
    setInput('');
    setSelectedImage(null);
    setCargando(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: texto || (idioma === 'en' ? 'Analyze this image' : 'Analiza esta imagen'),
          contexto: null,
          historial: mensajes.slice(-8).map(m => ({ role: m.role, content: m.content })),
          perfil,
          todosDocumentos: usarDocumentos ? todosDocumentos : [],
          idioma: getIdioma(),
          imageBase64: imgToSend?.base64 || undefined,
          imageMime: imgToSend?.mime || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMensajes(prev => [...prev, { role: 'assistant', content: data.respuesta }]);
        if (audioEnabled || modoLlamada) await reproducirRespuesta(data.respuesta);
      }
    } catch (err: any) {
      if (err?.message === "AI_EXHAUSTED" || err?.message?.includes("All providers")) {
        setAiExhausted(true);
      } else {
        setMensajes(prev => [...prev, {
          role: 'assistant',
          content: idioma === 'en' ? 'Connection error. Try again.' : 'Error de conexión. Intenta de nuevo.',
        }]);
      }
    } finally {
      setCargando(false);
    }
  };

  // ===== TTS =====
  const reproducirRespuesta = async (texto: string) => {
    if (!('speechSynthesis' in window)) return;
    try {
      setLlamandoAI(true);
      window.speechSynthesis.cancel();

      const textoLimpio = texto
        .replace(/#{1,3}\s/g, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[-•]/g, ',')
        .substring(0, 1000);

      const utterance = new SpeechSynthesisUtterance(textoLimpio);
      const idiomaActual = getIdioma();
      utterance.lang = idiomaActual === 'en' ? 'en-US' : 'es-MX';
      utterance.rate = 0.92;
      utterance.pitch = 1.25;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      let bestVoice;
      if (idiomaActual === 'en') {
        bestVoice =
          voices.find(v => v.name === 'Daniel') ||
          voices.find(v => v.name === 'Alex') ||
          voices.find(v => v.lang.startsWith('en') && !['Karen', 'Samantha', 'Moira', 'Tessa', 'Veena', 'Victoria'].includes(v.name));
      } else {
        bestVoice =
          voices.find(v => v.name === 'Juan') ||
          voices.find(v => v.name === 'Jorge') ||
          voices.find(v => v.lang.startsWith('es') && !['Monica', 'Paulina'].includes(v.name));
      }
      if (bestVoice) utterance.voice = bestVoice;

      await new Promise<void>((resolve) => {
        const keepAlive = setInterval(() => {
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          } else clearInterval(keepAlive);
        }, 10000);
        utterance.onend = () => { clearInterval(keepAlive); resolve(); };
        utterance.onerror = () => { clearInterval(keepAlive); resolve(); };
        window.speechSynthesis.speak(utterance);
      });
    } catch (err) {
      console.error('TTS error:', err);
    } finally {
      setLlamandoAI(false);
    }
  };

  // ===== IMAGEN =====
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      const base64 = result.split(',')[1];
      setSelectedImage({ base64, mime: file.type, preview: result });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ===== GRABACIÓN =====
  const iniciarGrabacion = async () => {
    try {
      if (audioGrabado) { URL.revokeObjectURL(audioGrabado.url); setAudioGrabado(null); }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioGrabado({ blob, url });
        streamRef.current?.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      setGrabando(true);
    } catch {
      alert(idioma === 'en' ? 'Could not access microphone.' : 'No se pudo acceder al micrófono.');
    }
  };

  const detenerGrabacion = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setGrabando(false);
  };

  const descartarAudio = () => {
    if (audioGrabado) { URL.revokeObjectURL(audioGrabado.url); setAudioGrabado(null); }
  };

  const enviarAudioGrabado = async () => {
    if (!audioGrabado) return;
    setTranscribiendo(true);
    const formData = new FormData();
    formData.append('audio', audioGrabado.blob, 'recording.webm');
    formData.append('idioma', getIdioma());
    try {
      const res = await fetch('/api/audio/transcribe', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.text) {
        setMensajes(prev => [...prev, { role: 'user', content: data.text, isAudio: true }]);
        descartarAudio();
        await enviarTextoAlAI(data.text);
      } else {
        alert(idioma === 'en' ? 'Could not transcribe audio.' : 'No se pudo transcribir el audio.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTranscribiendo(false);
    }
  };

  const enviarTextoAlAI = async (texto: string) => {
    setCargando(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: texto,
          contexto: null,
          historial: mensajes.slice(-8).map(m => ({ role: m.role, content: m.content })),
          perfil,
          todosDocumentos: usarDocumentos ? todosDocumentos : [],
          idioma: getIdioma(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMensajes(prev => [...prev, { role: 'assistant', content: data.respuesta }]);
        if (audioEnabled || modoLlamada) await reproducirRespuesta(data.respuesta);
      }
    } catch (err) { console.error(err); }
    finally { setCargando(false); }
  };

  const handleAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTranscribiendo(true);
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('idioma', getIdioma());
    try {
      const res = await fetch('/api/audio/transcribe', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.text) {
        setMensajes(prev => [...prev, { role: 'user', content: data.text, isAudio: true }]);
        await enviarTextoAlAI(data.text);
      }
    } catch (err) { console.error(err); }
    finally { setTranscribiendo(false); e.target.value = ''; }
  };

  const toggleModoLlamada = async () => {
    if (modoLlamada) {
      window.speechSynthesis?.cancel();
      setModoLlamada(false);
      setAudioEnabled(false);
    } else {
      setModoLlamada(true);
      setAudioEnabled(true);
      const saludo = idioma === 'en'
        ? "Hi! I'm JeffreyBot, disciple of José Alberto de Obaldia. I'm listening!"
        : '¡Hola! Soy JeffreyBot, discípulo de José Alberto de Obaldia. ¡Te escucho!';
      await reproducirRespuesta(saludo);
    }
  };

  const renderInline = (texto: string): any[] => {
    const partes = texto.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    return partes.map((parte, i) => {
      if (parte.startsWith('**') && parte.endsWith('**')) return <strong key={i}>{parte.slice(2, -2)}</strong>;
      if (parte.startsWith('*') && parte.endsWith('*')) return <em key={i}>{parte.slice(1, -1)}</em>;
      if (parte.startsWith('`') && parte.endsWith('`')) return <code key={i} style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '13px' }}>{parte.slice(1, -1)}</code>;
      return parte;
    });
  };

  const renderMensaje = (texto: string) => {
    return texto.split('\n').map((linea, i) => {
      if (linea.startsWith('### ')) return <h3 key={i} style={{ fontSize: '16px', fontWeight: 800, color: 'var(--gold)', margin: '12px 0 6px' }}>{linea.slice(4)}</h3>;
      if (linea.startsWith('## ')) return <h2 key={i} style={{ fontSize: '18px', fontWeight: 800, color: 'var(--gold)', margin: '14px 0 8px' }}>{linea.slice(3)}</h2>;
      if (linea.startsWith('# ')) return <h1 key={i} style={{ fontSize: '20px', fontWeight: 900, color: 'var(--gold)', margin: '16px 0 8px' }}>{linea.slice(2)}</h1>;
      if (linea.match(/^\d+\. /)) {
        const num = linea.match(/^(\d+)\./)?.[1];
        const content = linea.replace(/^\d+\. /, '');
        return (
          <div key={i} style={{ display: 'flex', gap: '10px', margin: '6px 0', alignItems: 'flex-start' }}>
            <span style={{ background: 'var(--gold)', color: '#000', width: '22px', height: '22px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, flexShrink: 0, marginTop: '2px' }}>{num}</span>
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

  const UserAvatar = ({ size = 36 }: { size?: number }) => (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: fotoPerfil ? 'transparent' : 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.5 }}>
      {fotoPerfil ? <img src={fotoPerfil} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
    </div>
  );

  const sugerencias = idioma === 'en'
    ? ['How does photosynthesis work?', "Explain Newton's laws", 'What is a derivative?', 'Tips to memorize better']
    : ['¿Cómo funciona la fotosíntesis?', 'Explícame las leyes de Newton', '¿Qué es la derivada?', 'Técnicas para memorizar'];

  return (
    <>
    {aiExhausted && <AIExhausted onClose={() => setAiExhausted(false)} />}
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, sans-serif' }}>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} />
      <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm" onChange={handleAudioFile} style={{ display: 'none' }} />

      {/* Header */}
      <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 24px', height: '68px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => window.location.href = '/'}
            style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '7px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            ← {tr('inicio')}
          </button>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              🤖 JeffreyBot
              {modoLlamada && (
                <span style={{ fontSize: '11px', background: '#4ade80', color: '#000', padding: '2px 8px', borderRadius: '6px', fontWeight: 800 }}>
                  📞 {idioma === 'en' ? 'CALL' : 'LLAMADA'}
                </span>
              )}
              {llamandoAI && (
                <span style={{ fontSize: '11px', background: 'var(--gold)', color: '#000', padding: '2px 8px', borderRadius: '6px', fontWeight: 800 }}>
                  🔊 {idioma === 'en' ? 'Speaking...' : 'Hablando...'}
                </span>
              )}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
              {usarDocumentos ? `${todosDocumentos.length} docs` : idioma === 'en' ? 'Disciple of José Alberto de Obaldia' : 'Discípulo de José Alberto de Obaldia'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={toggleModoLlamada}
            style={{ padding: '7px 14px', borderRadius: '8px', border: `2px solid ${modoLlamada ? '#4ade80' : 'var(--border-color)'}`, background: modoLlamada ? '#4ade8020' : 'transparent', color: modoLlamada ? '#4ade80' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            {modoLlamada ? '📞 Colgar' : '📞 Llamar'}
          </button>
          <button onClick={() => setAudioEnabled(!audioEnabled)}
            style={{ padding: '7px 14px', borderRadius: '8px', border: `2px solid ${audioEnabled ? 'var(--gold)' : 'var(--border-color)'}`, background: audioEnabled ? 'var(--gold-dim)' : 'transparent', color: audioEnabled ? 'var(--gold)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            {audioEnabled ? '🔊 ON' : '🔇 OFF'}
          </button>
          <button onClick={() => setUsarDocumentos(!usarDocumentos)}
            style={{ padding: '7px 14px', borderRadius: '8px', border: `2px solid ${usarDocumentos ? 'var(--blue)' : 'var(--border-color)'}`, background: usarDocumentos ? 'var(--blue-dim)' : 'transparent', color: usarDocumentos ? 'var(--blue)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            📚 {usarDocumentos ? `ON (${todosDocumentos.length})` : tr('usarDocs')}
          </button>
          <button onClick={() => window.location.href = '/perfil'}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            📊
          </button>
          <button onClick={() => setMensajes([{ role: 'assistant', content: idioma === 'en' ? "Hi! I'm JeffreyBot 🤖" : '¡Hola! Soy JeffreyBot 🤖' }])}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            🗑️
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', height: '3px' }}>
        <div style={{ flex: 1, background: 'var(--gold)' }} />
        <div style={{ flex: 1, background: 'var(--red)' }} />
        <div style={{ flex: 1, background: 'var(--blue)' }} />
        <div style={{ flex: 1, background: 'var(--pink)' }} />
      </div>

      {/* Mensajes */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '800px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {mensajes.length === 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '16px' }}>
            {sugerencias.map((s, i) => (
              <button key={i} onClick={() => enviar(s)}
                style={{ padding: '8px 14px', borderRadius: '20px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.color = 'var(--gold)'; }}
                onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {mensajes.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '8px' }}>
            {msg.role === 'assistant' && (
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🤖</div>
            )}
            <div style={{
              maxWidth: '75%', padding: '12px 16px',
              borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: msg.role === 'user' ? 'var(--gold)' : 'var(--bg-card)',
              color: msg.role === 'user' ? '#000' : 'var(--text-primary)',
              fontSize: '15px', lineHeight: 1.7,
              border: msg.role === 'assistant' ? '1px solid var(--border-color)' : 'none',
            }}>
              {msg.imageUrl && (
                <img src={msg.imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: '10px', marginBottom: '8px', display: 'block' }} />
              )}
              {msg.isAudio && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', opacity: 0.8 }}>
                  <span>🎤</span>
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>{idioma === 'en' ? 'Voice message' : 'Mensaje de voz'}</span>
                </div>
              )}
              {msg.role === 'assistant' ? renderMensaje(msg.content) : <span>{msg.content}</span>}
              {msg.role === 'assistant' && i > 0 && (
                <button onClick={() => reproducirRespuesta(msg.content)} disabled={llamandoAI}
                  style={{ marginTop: '8px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', cursor: llamandoAI ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  🔊 {idioma === 'en' ? 'Listen' : 'Escuchar'}
                </button>
              )}
            </div>
            {msg.role === 'user' && <UserAvatar size={36} />}
          </div>
        ))}

        {(cargando || transcribiendo) && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-end', gap: '8px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🤖</div>
            <div style={{ padding: '14px 18px', borderRadius: '18px 18px 18px 4px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', display: 'flex', gap: '6px', alignItems: 'center' }}>
              {transcribiendo && (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginRight: '4px' }}>
                  🎤 {idioma === 'en' ? 'Transcribing...' : 'Transcribiendo...'}
                </span>
              )}
              {[0, 1, 2].map(j => (
                <div key={j} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: `bounce 1s ${j * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Preview imagen */}
      {selectedImage && (
        <div style={{ padding: '10px 24px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', maxWidth: '800px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src={selectedImage.preview} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px', border: '2px solid var(--gold)' }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0, fontWeight: 600 }}>
                {idioma === 'en' ? '🖼️ Image ready to send' : '🖼️ Imagen lista para enviar'}
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                {idioma === 'en' ? 'Add a message or send directly' : 'Agrega un mensaje o envía directamente'}
              </p>
            </div>
            <button onClick={() => setSelectedImage(null)}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: '13px', cursor: 'pointer', fontWeight: 700 }}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Panel audio grabado */}
      {audioGrabado && (
        <div style={{ padding: '14px 24px', background: 'var(--bg-card)', borderTop: '2px solid var(--gold)', maxWidth: '800px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gold)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            🎤 {idioma === 'en' ? 'Voice message recorded' : 'Mensaje de voz grabado'}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <audio src={audioGrabado.url} controls style={{ flex: 1, minWidth: '200px', height: '36px' }} />
            <button onClick={enviarAudioGrabado} disabled={transcribiendo}
              style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: transcribiendo ? 'var(--bg-card2)' : 'var(--gold)', color: transcribiendo ? 'var(--text-faint)' : '#000', fontSize: '13px', fontWeight: 800, cursor: transcribiendo ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
              {transcribiendo ? (idioma === 'en' ? '⏳ Transcribing...' : '⏳ Transcribiendo...') : (idioma === 'en' ? '📤 Send' : '📤 Enviar')}
            </button>
            <button onClick={descartarAudio} disabled={transcribiendo}
              style={{ padding: '10px 16px', borderRadius: '10px', border: '2px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: '13px', fontWeight: 700, cursor: transcribiendo ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
              🗑️
            </button>
            <button onClick={() => { descartarAudio(); iniciarGrabacion(); }} disabled={transcribiendo}
              style={{ padding: '10px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: transcribiendo ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
              🔄
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '16px 24px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {!audioGrabado && (
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <button onClick={() => fileInputRef.current?.click()}
                style={{ padding: '7px 14px', borderRadius: '8px', border: `1px solid ${selectedImage ? 'var(--gold)' : 'var(--border-color)'}`, background: selectedImage ? 'var(--gold-dim)' : 'transparent', color: selectedImage ? 'var(--gold)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                🖼️ {idioma === 'en' ? 'Image' : 'Imagen'}
              </button>
              <button onClick={() => audioInputRef.current?.click()}
                style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                🎵 {idioma === 'en' ? 'Audio file' : 'Archivo audio'}
              </button>
              {!grabando ? (
                <button onClick={iniciarGrabacion}
                  style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  🎤 {idioma === 'en' ? 'Record' : 'Grabar'}
                </button>
              ) : (
                <button onClick={detenerGrabacion}
                  style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid var(--red)', background: 'var(--red-dim)', color: 'var(--red)', fontSize: '12px', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ⏹️ {idioma === 'en' ? 'Stop' : 'Parar'}
                  <span style={{ fontSize: '10px', background: 'var(--red)', color: '#fff', padding: '1px 6px', borderRadius: '4px' }}>REC</span>
                </button>
              )}
              {llamandoAI && (
                <button onClick={() => { window.speechSynthesis?.cancel(); setLlamandoAI(false); }}
                  style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid var(--red)', background: 'rgba(239,68,68,0.1)', color: 'var(--red)', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
                  🔇 {idioma === 'en' ? 'Stop voice' : 'Parar voz'}
                </button>
              )}
            </div>
          )}

          {!audioGrabado && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
              <UserAvatar size={36} />
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder={
                  grabando
                    ? (idioma === 'en' ? '🔴 Recording...' : '🔴 Grabando...')
                    : (idioma === 'en' ? 'Type, send an image or record voice...' : 'Escribe, envía imagen o graba voz...')
                }
                disabled={cargando || grabando}
                rows={2}
                style={{
                  flex: 1, padding: '14px 16px', borderRadius: '14px',
                  border: `2px solid ${grabando ? 'var(--red)' : (input || selectedImage) ? 'var(--gold)' : 'var(--border-color)'}`,
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  fontSize: '15px', resize: 'none', outline: 'none',
                  transition: 'border 0.2s', fontFamily: 'inherit', lineHeight: 1.5,
                }}
              />
              <button onClick={() => enviar()}
                disabled={(!input.trim() && !selectedImage) || cargando || grabando}
                style={{
                  padding: '14px 24px', borderRadius: '14px', border: 'none',
                  background: (input.trim() || selectedImage) && !cargando && !grabando ? 'var(--gold)' : 'var(--bg-card2)',
                  color: (input.trim() || selectedImage) && !cargando && !grabando ? '#000' : 'var(--text-faint)',
                  fontWeight: 800, fontSize: '15px',
                  cursor: (input.trim() || selectedImage) && !cargando && !grabando ? 'pointer' : 'not-allowed',
                }}>
                {tr('enviar')}
              </button>
            </div>
          )}

          <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '8px 0 0', textAlign: 'center' }}>
            {idioma === 'en'
              ? '🖼️ Images · 🎤 Voice · 🎵 Audio · 📞 Call mode · 🔊 AI voice'
              : '🖼️ Imágenes · 🎤 Voz · 🎵 Audio · 📞 Llamada · 🔊 Respuesta en voz'}
          </p>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes pulse-red {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
    </>
  );
}