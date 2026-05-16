'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { getPerfil, getMaterias } from '../../lib/storage';
import { getSettings } from '../../lib/settings';
import { useIsMobile } from '../../hooks/useIsMobile';
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

// ─── Limpiar texto para TTS ───────────────────────────────────────────────
function limpiarTTS(texto: string, maxLen = 600): string {
  return texto
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,6}\s?/g, '')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-•]/g, ',')
    .replace(/[_~]/g, '')
    .replace(/\n+/g, '. ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .substring(0, maxLen);
}

// ─── speechSynthesis helper — funciona en iOS si se llama sincrónicamente ──
function hablarConSynthesis(
  texto: string,
  lang: string,
  onEnd: () => void,
): () => void {
  const synth = window.speechSynthesis;
  synth.cancel();

  const utter = new SpeechSynthesisUtterance(texto);
  utter.lang = lang;
  utter.rate = 0.9;
  utter.pitch = 1.0;
  utter.volume = 1.0;

  // No forzar voz en iOS — usar la del sistema
  const voices = synth.getVoices();
  const voz = voices.find(v => v.lang.startsWith(lang.split('-')[0]) && v.localService);
  if (voz) utter.voice = voz;

  // keepalive iOS
  const timer = setInterval(() => {
    if (!synth.speaking) { clearInterval(timer); return; }
    synth.pause(); synth.resume();
  }, 5000);

  utter.onend = () => { clearInterval(timer); onEnd(); };
  utter.onerror = () => { clearInterval(timer); onEnd(); };

  synth.speak(utter);

  // Si iOS no empieza en 300ms forzar resume
  setTimeout(() => { if (synth.paused) synth.resume(); }, 300);

  return () => { clearInterval(timer); synth.cancel(); };
}

export default function ChatPage() {
  const { tr, idioma } = useIdioma();
  const isMobile = useIsMobile();
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
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [modoLlamada, setModoLlamada] = useState(false);
  const [aiExhausted, setAiExhausted] = useState(false);
  const [llamandoAI, setLlamandoAI] = useState(false);
  const [llamadaEscuchando, setLlamadaEscuchando] = useState(false);
  const [llamadaHablando, setLlamadaHablando] = useState(false);
  const [llamadaProcesando, setLlamadaProcesando] = useState(false);

  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const llamadaMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const llamadaStreamRef = useRef<MediaStream | null>(null);
  const modoLlamadaRef = useRef(false);
  const mensajesRef = useRef<Mensaje[]>([]);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const langCode = idioma === 'en' ? 'en-US' : 'es-ES';

  useEffect(() => {
    const saludo = idioma === 'en'
      ? "Hi! I'm El Chap 🤖 Your AI on StudyAL. How can I help?"
      : '¡Hola! Soy El Chap 🤖 Tu IA en StudyAL. ¿En qué te ayudo?';
    setMensajes([{ role: 'assistant', content: saludo }]);
    setPerfil(getPerfil());
    setFotoPerfil(getSettings().fotoPerfil || '');

    import('../../lib/supabase').then(({ supabase }) => {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) {
          const n = data.user.user_metadata?.nombre || data.user.email?.split('@')[0] || '';
          setNombreUsuario(n);
        }
      });
    });

    const materias = getMaterias();
    const docs: any[] = [];
    materias.forEach(m => m.temas.forEach(t => t.documentos.forEach(d => {
      if (d.contenido) docs.push({ nombre: d.nombre, materia: m.nombre, contenido: d.contenido });
    })));
    setTodosDocumentos(docs);

    // Pre-cargar voces
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, [idioma]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    mensajesRef.current = mensajes;
  }, [mensajes]);

  useEffect(() => {
    modoLlamadaRef.current = modoLlamada;
  }, [modoLlamada]);

  // ─── Parar voz ────────────────────────────────────────────────────────────
  const stopVoz = useCallback(() => {
    stopSpeakRef.current?.();
    stopSpeakRef.current = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setLlamandoAI(false);
    setLlamadaHablando(false);
  }, []);

  // ─── Hablar — SIEMPRE usa speechSynthesis sincrónicamente ────────────────
  const hablar = useCallback((texto: string, onEnd?: () => void) => {
    if (!('speechSynthesis' in window)) { onEnd?.(); return; }
    stopVoz();
    setLlamandoAI(true);
    setLlamadaHablando(true);
    const textoLimpio = limpiarTTS(texto);
    const stop = hablarConSynthesis(textoLimpio, langCode, () => {
      setLlamandoAI(false);
      setLlamadaHablando(false);
      onEnd?.();
    });
    stopSpeakRef.current = stop;
  }, [langCode, stopVoz]);

  // ─── Sonidos de llamada con AudioContext ──────────────────────────────────
  const getCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback((ctx: AudioContext, freq: number, start: number, dur: number) => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + start + 0.02);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + start + dur - 0.02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    } catch {}
  }, []);

  // ─── Enviar ───────────────────────────────────────────────────────────────
  const enviar = async (textoOverride?: string, imgData?: ImageData) => {
    const texto = textoOverride || input.trim();
    const imgToSend = imgData || selectedImage;
    if (!texto && !imgToSend) return;
    if (cargando) return;

    setMensajes(prev => [...prev, {
      role: 'user',
      content: texto || (idioma === 'en' ? '(image sent)' : '(imagen enviada)'),
      imageUrl: imgToSend?.preview,
    }]);
    setInput('');
    setSelectedImage(null);
    setCargando(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: texto || 'Analiza esta imagen',
          contexto: null,
          historial: mensajes.slice(-8).map(m => ({ role: m.role, content: m.content })),
          perfil, todosDocumentos: usarDocumentos ? todosDocumentos : [],
          idioma: getIdioma(), imageBase64: imgToSend?.base64,
          imageMime: imgToSend?.mime, nombreUsuario, enLlamada: modoLlamada,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMensajes(prev => [...prev, { role: 'assistant', content: data.respuesta }]);
        if (audioEnabled || modoLlamada) hablar(data.respuesta);
      } else if (data.error === 'AI_EXHAUSTED') {
        setAiExhausted(true);
      }
    } catch {
      setMensajes(prev => [...prev, {
        role: 'assistant',
        content: idioma === 'en' ? 'Connection error.' : 'Error de conexión.',
      }]);
    } finally {
      setCargando(false);
    }
  };

  // ─── Grabación ────────────────────────────────────────────────────────────
  const iniciarGrabacion = async () => {
    try {
      if (audioGrabado) { URL.revokeObjectURL(audioGrabado.url); setAudioGrabado(null); }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const mr = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setAudioGrabado({ blob, url: URL.createObjectURL(blob) });
        streamRef.current?.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setGrabando(true);
    } catch {
      alert(idioma === 'en' ? 'Could not access microphone.' : 'No se pudo acceder al micrófono.');
    }
  };

  const detenerGrabacion = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setGrabando(false);
  };

  const descartarAudio = () => {
    if (audioGrabado) { URL.revokeObjectURL(audioGrabado.url); setAudioGrabado(null); }
  };

  const transcribirYEnviar = async (blob: Blob, mimeType: string) => {
    const formData = new FormData();
    const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
    formData.append('audio', blob, `audio.${ext}`);
    formData.append('idioma', getIdioma());
    const res = await fetch('/api/audio/transcribe', { method: 'POST', body: formData });
    const data = await res.json();
    return data.success ? data.text : null;
  };

  const enviarAudioGrabado = async () => {
    if (!audioGrabado) return;
    setTranscribiendo(true);
    try {
      const mimeType = audioGrabado.blob.type || 'audio/webm';
      const text = await transcribirYEnviar(audioGrabado.blob, mimeType);
      if (text) {
        setMensajes(prev => [...prev, { role: 'user', content: text, isAudio: true }]);
        descartarAudio();
        await enviar(text);
      } else {
        alert(idioma === 'en' ? 'Could not transcribe.' : 'No se pudo transcribir.');
      }
    } catch (e) { console.error(e); }
    finally { setTranscribiendo(false); }
  };

  const handleAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTranscribiendo(true);
    try {
      const text = await transcribirYEnviar(file, file.type);
      if (text) {
        setMensajes(prev => [...prev, { role: 'user', content: text, isAudio: true }]);
        await enviar(text);
      }
    } catch (e) { console.error(e); }
    finally { setTranscribiendo(false); e.target.value = ''; }
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

  // ─── Modo llamada ─────────────────────────────────────────────────────────
  const toggleModoLlamada = () => {
    // SÍNCRONO — crear AudioContext aquí mismo antes de cualquier async
    const ctx = getCtx();

    if (modoLlamada) {
      // Colgar
      playTone(ctx, 480, 0, 0.3);
      playTone(ctx, 340, 0.3, 0.3);
      stopVoz();
      setModoLlamada(false);
      modoLlamadaRef.current = false;
      setAudioEnabled(false);
      setLlamadaEscuchando(false);
      setLlamadaHablando(false);
      setLlamadaProcesando(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (llamadaMediaRecorderRef.current?.state === 'recording') llamadaMediaRecorderRef.current.stop();
      llamadaStreamRef.current?.getTracks().forEach(t => t.stop());
      return;
    }

    // Iniciar llamada — ring SÍNCRONO
    playTone(ctx, 440, 0, 0.4); playTone(ctx, 480, 0, 0.4);
    playTone(ctx, 440, 0.6, 0.4); playTone(ctx, 480, 0.6, 0.4);
    playTone(ctx, 440, 1.2, 0.4); playTone(ctx, 480, 1.2, 0.4);

    setModoLlamada(true);
    modoLlamadaRef.current = true;
    setAudioEnabled(true);

    // Saludo después del ring — hablar() usa speechSynthesis sincrónicamente
    setTimeout(() => {
      // connect tone
      playTone(ctx, 520, 0, 0.15);
      const saludo = idioma === 'en'
        ? "Hey! I'm The Chap. Go ahead!"
        : '¡Hey! Soy El Chap. Dale, te escucho.';
      // hablar() es síncrono — llama speechSynthesis sin awaits
      hablar(saludo, () => {
        setLlamadaHablando(false);
        iniciarEscuchaLlamada();
      });
    }, 1900);
  };

  const interrumpir = () => {
    stopVoz();
    setTimeout(() => { if (modoLlamadaRef.current) iniciarEscuchaLlamada(); }, 300);
  };

  // ─── Escucha en llamada ───────────────────────────────────────────────────
  const iniciarEscuchaLlamada = async () => {
    if (!modoLlamadaRef.current) return;
    setLlamadaEscuchando(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      llamadaStreamRef.current = stream;
      const chunks: Blob[] = [];

      let mimeType = 'audio/mp4';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';

      const mr = new MediaRecorder(stream, { mimeType });
      llamadaMediaRecorderRef.current = mr;

      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setLlamadaEscuchando(false);
        if (!modoLlamadaRef.current) return;

        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 500) { if (modoLlamadaRef.current) iniciarEscuchaLlamada(); return; }

        setLlamadaProcesando(true);
        try {
          const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
          const formData = new FormData();
          formData.append('audio', blob, `llamada.${ext}`);
          formData.append('idioma', getIdioma());

          const res = await fetch('/api/audio/transcribe', { method: 'POST', body: formData });
          const data = await res.json();

          if (data.success && data.text?.trim().length > 2) {
            setMensajes(prev => [...prev, { role: 'user', content: data.text, isAudio: true }]);
            setCargando(true);

            const chatRes = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mensaje: data.text, contexto: null,
                historial: mensajesRef.current.slice(-6).map(m => ({ role: m.role, content: m.content })),
                perfil, todosDocumentos: usarDocumentos ? todosDocumentos : [],
                idioma: getIdioma(), nombreUsuario, enLlamada: true,
              }),
            });
            const chatData = await chatRes.json();
            setCargando(false);
            setLlamadaProcesando(false);

            if (chatData.success && modoLlamadaRef.current) {
              setMensajes(prev => [...prev, { role: 'assistant', content: chatData.respuesta }]);
              // hablar() es síncrono
              hablar(chatData.respuesta, () => {
                if (modoLlamadaRef.current) iniciarEscuchaLlamada();
              });
            }
          } else {
            setLlamadaProcesando(false);
            if (modoLlamadaRef.current) iniciarEscuchaLlamada();
          }
        } catch {
          setLlamadaProcesando(false);
          if (modoLlamadaRef.current) iniciarEscuchaLlamada();
        }
      };

      mr.start();
      silenceTimerRef.current = setTimeout(() => {
        if (mr.state === 'recording') mr.stop();
      }, 10000);
    } catch {
      setLlamadaEscuchando(false);
      alert(idioma === 'en' ? 'Cannot access microphone' : 'No se puede acceder al micrófono');
    }
  };

  // ─── Render helpers ───────────────────────────────────────────────────────
  const renderInline = (t: string): any[] =>
    t.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2,-2)}</strong>;
      if (p.startsWith('*') && p.endsWith('*')) return <em key={i}>{p.slice(1,-1)}</em>;
      if (p.startsWith('`') && p.endsWith('`')) return <code key={i} style={{background:'rgba(0,0,0,0.2)',padding:'1px 6px',borderRadius:'4px',fontFamily:'monospace',fontSize:'13px'}}>{p.slice(1,-1)}</code>;
      return p;
    });

  const renderMensaje = (texto: string) =>
    texto.split('\n').map((l, i) => {
      if (l.startsWith('### ')) return <h3 key={i} style={{fontSize:'16px',fontWeight:800,color:'var(--gold)',margin:'12px 0 6px'}}>{l.slice(4)}</h3>;
      if (l.startsWith('## ')) return <h2 key={i} style={{fontSize:'18px',fontWeight:800,color:'var(--gold)',margin:'14px 0 8px'}}>{l.slice(3)}</h2>;
      if (l.startsWith('# ')) return <h1 key={i} style={{fontSize:'20px',fontWeight:900,color:'var(--gold)',margin:'16px 0 8px'}}>{l.slice(2)}</h1>;
      const numM = l.match(/^(\d+)\.\s+(.+)/);
      if (numM) return <div key={i} style={{display:'flex',gap:'10px',margin:'6px 0',alignItems:'flex-start'}}><span style={{background:'var(--gold)',color:'#000',width:'22px',height:'22px',borderRadius:'50%',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:800,flexShrink:0,marginTop:'2px'}}>{numM[1]}</span><span style={{lineHeight:1.6}}>{renderInline(numM[2])}</span></div>;
      if (l.startsWith('- ')) return <div key={i} style={{display:'flex',gap:'8px',margin:'4px 0',alignItems:'flex-start'}}><span style={{color:'var(--gold)',fontWeight:900,flexShrink:0}}>•</span><span style={{lineHeight:1.6}}>{renderInline(l.slice(2))}</span></div>;
      if (l.trim() === '') return <div key={i} style={{height:'8px'}}/>;
      return <p key={i} style={{margin:'4px 0',lineHeight:1.7}}>{renderInline(l)}</p>;
    });

  const UserAvatar = ({ size = 36 }: { size?: number }) => (
    <div style={{width:size,height:size,borderRadius:'50%',overflow:'hidden',flexShrink:0,background:fotoPerfil?'transparent':'var(--blue)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:size*0.5}}>
      {fotoPerfil ? <img src={fotoPerfil} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : '👤'}
    </div>
  );

  const sugerencias = idioma === 'en'
    ? ['How does photosynthesis work?',"Explain Newton's laws",'What is a derivative?','Tips to memorize better']
    : ['¿Cómo funciona la fotosíntesis?','Explícame las leyes de Newton','¿Qué es la derivada?','Técnicas para memorizar'];

  return (
    <>
      {aiExhausted && <AIExhausted onClose={() => setAiExhausted(false)} />}
      <div style={{minHeight:'100vh',background:'var(--bg-primary)',display:'flex',flexDirection:'column',fontFamily:'-apple-system, sans-serif'}}>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} style={{display:'none'}}/>
        <input ref={audioInputRef} type="file" accept="audio/*" onChange={handleAudioFile} style={{display:'none'}}/>

        {/* Header */}
        <header style={{background:'var(--bg-card)',borderBottom:'3px solid var(--gold)',padding:isMobile?'0 12px':'0 24px',height:isMobile?'56px':'68px',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:100}}>
          <div style={{display:'flex',alignItems:'center',gap:isMobile?'8px':'12px'}}>
            <button onClick={() => window.location.href='/'} style={{background:'none',border:'2px solid var(--gold)',color:'var(--gold)',padding:isMobile?'6px 10px':'7px 14px',borderRadius:'8px',fontWeight:700,fontSize:isMobile?'12px':'13px',cursor:'pointer'}}>←</button>
            <div>
              <h1 style={{fontSize:isMobile?'15px':'18px',fontWeight:900,color:'var(--text-primary)',margin:0,display:'flex',alignItems:'center',gap:'6px'}}>
                🤖 {isMobile?'El Chap':'ChapBot'}
                {modoLlamada && <span style={{fontSize:'10px',background:'#4ade80',color:'#000',padding:'2px 6px',borderRadius:'6px',fontWeight:800}}>📞 EN LLAMADA</span>}
                {llamandoAI && !modoLlamada && <span style={{fontSize:'10px',background:'var(--gold)',color:'#000',padding:'2px 6px',borderRadius:'6px',fontWeight:800}}>🔊</span>}
              </h1>
              {!isMobile && <p style={{color:'var(--text-muted)',fontSize:'11px',margin:0}}>{usarDocumentos?`${todosDocumentos.length} docs`:idioma==='en'?'Your AI on StudyAL':'Tu IA en StudyAL'}</p>}
            </div>
          </div>
          <div style={{display:'flex',gap:isMobile?'4px':'6px',alignItems:'center'}}>
            <button
              onClick={() => alert(idioma === 'en' ? '📞 Call mode is under maintenance. Coming soon!' : '📞 El modo llamada está en mantenimiento. ¡Próximamente!')}
              title={idioma === 'en' ? 'Under maintenance' : 'En mantenimiento'}
              style={{padding:isMobile?'7px 10px':'7px 14px',borderRadius:'8px',border:'2px solid var(--border-color)',background:'rgba(255,255,255,0.03)',color:'var(--text-muted)',fontSize:isMobile?'14px':'12px',fontWeight:700,cursor:'not-allowed',opacity:0.5,position:'relative'}}>
              📞 {!isMobile && <span style={{fontSize:'9px',background:'#f59e0b',color:'#000',padding:'1px 4px',borderRadius:'4px',marginLeft:'4px',fontWeight:800}}>WIP</span>}
            </button>
            <button onClick={() => setAudioEnabled(!audioEnabled)} style={{padding:isMobile?'7px 10px':'7px 14px',borderRadius:'8px',border:`2px solid ${audioEnabled?'var(--gold)':'var(--border-color)'}`,background:audioEnabled?'var(--gold-dim)':'transparent',color:audioEnabled?'var(--gold)':'var(--text-muted)',fontSize:isMobile?'14px':'12px',fontWeight:700,cursor:'pointer'}}>
              {audioEnabled?'🔊':'🔇'}
            </button>
            <button onClick={() => setUsarDocumentos(!usarDocumentos)} style={{padding:isMobile?'7px 10px':'7px 14px',borderRadius:'8px',border:`2px solid ${usarDocumentos?'var(--blue)':'var(--border-color)'}`,background:usarDocumentos?'var(--blue-dim)':'transparent',color:usarDocumentos?'var(--blue)':'var(--text-muted)',fontSize:isMobile?'13px':'12px',fontWeight:700,cursor:'pointer'}}>
              {isMobile?(usarDocumentos?'📚✓':'📚'):`📚 ${usarDocumentos?`ON (${todosDocumentos.length})`:tr('usarDocs')}`}
            </button>
            {!isMobile && <button onClick={() => window.location.href='/perfil'} style={{padding:'7px 14px',borderRadius:'8px',border:'2px solid var(--gold)',background:'transparent',color:'var(--gold)',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>📊</button>}
            <button onClick={() => setMensajes([{role:'assistant',content:idioma==='en'?"Hi! I'm El Chap 🤖":'¡Hola! Soy El Chap 🤖'}])} style={{padding:isMobile?'7px 10px':'7px 14px',borderRadius:'8px',border:'2px solid var(--border-color)',background:'transparent',color:'var(--text-muted)',fontSize:isMobile?'14px':'12px',fontWeight:700,cursor:'pointer'}}>🗑️</button>
          </div>
        </header>

        <div style={{display:'flex',height:'3px'}}>
          <div style={{flex:1,background:'var(--gold)'}}/><div style={{flex:1,background:'var(--red)'}}/><div style={{flex:1,background:'var(--blue)'}}/><div style={{flex:1,background:'var(--pink)'}}/>
        </div>

        {/* MODO LLAMADA */}
        {modoLlamada && (
          <div style={{position:'fixed',inset:0,zIndex:200,background:'linear-gradient(180deg,#0a0a1a 0%,#0f1629 40%,#1a1a3e 100%)',display:'flex',flexDirection:'column',alignItems:'center',paddingTop:'10vh'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,padding:'12px 24px',display:'flex',justifyContent:'center'}}>
              <span style={{fontSize:12,color:'#4ade80',fontWeight:700,letterSpacing:1}}>
                {llamadaHablando?'🔊 HABLANDO':llamadaEscuchando?'🎤 ESCUCHANDO':llamadaProcesando?'⏳ PENSANDO':'📞 EN LLAMADA'}
              </span>
            </div>

            <div style={{textAlign:'center',marginBottom:40}}>
              <p style={{fontSize:14,color:'#64748b',margin:'0 0 12px',fontWeight:600,textTransform:'uppercase',letterSpacing:2}}>
                {nombreUsuario?`${nombreUsuario} ↔ El Chap`:'StudyAL'}
              </p>
              <p style={{fontSize:32,fontWeight:900,color:'#fff',margin:'0 0 6px'}}>El Chap</p>
              <p style={{fontSize:14,fontWeight:600,margin:0,color:llamadaHablando?'#f5c842':llamadaEscuchando?'#4ade80':llamadaProcesando?'#a78bfa':'#64748b',transition:'color 0.3s'}}>
                {llamadaHablando?(idioma==='en'?'Speaking...':'Hablando...'):llamadaEscuchando?(idioma==='en'?'Listening...':'Escuchándote...'):llamadaProcesando?(idioma==='en'?'Thinking...':'Pensando...'):(idioma==='en'?'Connected':'Conectado')}
              </p>
            </div>

            {/* Bola con ondas */}
            <div style={{position:'relative',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:40}}>
              {(llamadaEscuchando||llamadaHablando)&&[1,2,3,4].map(r=>(
                <div key={r} style={{position:'absolute',width:(isMobile?80:100)+r*(isMobile?35:50),height:(isMobile?80:100)+r*(isMobile?35:50),borderRadius:'50%',border:`1.5px solid ${llamadaHablando?'#f5c842':'#4ade80'}`,opacity:0.3/r,animation:`llamada-ring ${1+r*0.4}s ease-out infinite`,animationDelay:`${r*0.2}s`}}/>
              ))}
              {llamadaProcesando&&<div style={{position:'absolute',width:180,height:180,borderRadius:'50%',border:'2px solid transparent',borderTopColor:'#a78bfa',borderRightColor:'#6366f1',animation:'llamada-spin 1s linear infinite'}}/>}
              <div
                onClick={llamadaHablando?interrumpir:undefined}
                style={{width:isMobile?110:140,height:isMobile?110:140,borderRadius:'50%',background:llamadaHablando?'radial-gradient(circle at 40% 35%,#f5c842,#f97316)':llamadaEscuchando?'radial-gradient(circle at 40% 35%,#4ade80,#22d3ee)':llamadaProcesando?'radial-gradient(circle at 40% 35%,#a78bfa,#6366f1)':'radial-gradient(circle at 40% 35%,#334155,#1e293b)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:64,cursor:llamadaHablando?'pointer':'default',boxShadow:llamadaHablando?'0 0 60px rgba(245,200,66,0.4)':llamadaEscuchando?'0 0 60px rgba(74,222,128,0.4)':'0 0 20px rgba(0,0,0,0.3)',transition:'all 0.5s ease',animation:(llamadaEscuchando||llamadaHablando)?'llamada-pulse 2s ease-in-out infinite':'none',userSelect:'none'}}>
                🤖
              </div>
              {llamadaHablando&&<p style={{position:'absolute',bottom:-28,fontSize:11,color:'#f5c842',whiteSpace:'nowrap',fontWeight:700}}>{idioma==='en'?'👆 Tap to interrupt':'👆 Toca para interrumpir'}</p>}
            </div>

            {mensajes.length>1&&(
              <div style={{maxWidth:340,padding:'12px 16px',marginBottom:40,background:'rgba(255,255,255,0.04)',borderRadius:14,border:'1px solid rgba(255,255,255,0.08)',textAlign:'center'}}>
                <p style={{fontSize:12,color:'#94a3b8',margin:0,lineHeight:1.5}}>
                  {mensajes[mensajes.length-1].content.slice(0,100)}{mensajes[mensajes.length-1].content.length>100?'...':''}
                </p>
              </div>
            )}

            <div style={{position:'absolute',bottom:isMobile?'12vh':'10vh',display:'flex',gap:isMobile?24:40,alignItems:'center'}}>
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                <div style={{width:52,height:52,borderRadius:'50%',background:llamadaEscuchando?'rgba(74,222,128,0.15)':'rgba(255,255,255,0.08)',border:llamadaEscuchando?'1.5px solid #4ade80':'1.5px solid transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,transition:'all 0.3s'}}>
                  {llamadaEscuchando?'🎤':llamadaHablando?'🔊':llamadaProcesando?'⏳':'🎤'}
                </div>
                <span style={{fontSize:10,fontWeight:600,color:llamadaEscuchando?'#4ade80':'#64748b'}}>
                  {llamadaEscuchando?(idioma==='en'?'listening':'escuchando'):llamadaHablando?(idioma==='en'?'speaking':'hablando'):llamadaProcesando?(idioma==='en'?'thinking':'pensando'):(idioma==='en'?'ready':'listo')}
                </span>
              </div>

              <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                <button onClick={toggleModoLlamada} style={{width:72,height:72,borderRadius:'50%',background:'#ef4444',border:'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:30,cursor:'pointer',boxShadow:'0 0 30px rgba(239,68,68,0.5)'}}>
                  📵
                </button>
                <span style={{fontSize:10,color:'#ef4444',fontWeight:700}}>{idioma==='en'?'Hang up':'Colgar'}</span>
              </div>

              <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                <div style={{width:52,height:52,borderRadius:'50%',background:'rgba(255,255,255,0.08)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>🔊</div>
                <span style={{fontSize:10,color:'#64748b'}}>speaker</span>
              </div>
            </div>

            <style>{`
              @keyframes llamada-ring{0%{transform:scale(0.85);opacity:0.4}100%{transform:scale(1.5);opacity:0}}
              @keyframes llamada-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
              @keyframes llamada-spin{to{transform:rotate(360deg)}}
            `}</style>
          </div>
        )}

        {/* Mensajes */}
        <div style={{flex:1,overflowY:'auto',padding:'24px',display:'flex',flexDirection:'column',gap:'16px',maxWidth:'800px',margin:'0 auto',width:'100%',boxSizing:'border-box'}}>
          {mensajes.length===1&&(
            <div style={{display:'flex',flexWrap:'wrap',gap:'8px',justifyContent:'center',marginBottom:'16px'}}>
              {sugerencias.map((s,i)=>(
                <button key={i} onClick={()=>enviar(s)} style={{padding:'8px 14px',borderRadius:'20px',border:'1px solid var(--border-color)',background:'var(--bg-card)',color:'var(--text-muted)',fontSize:'13px',cursor:'pointer'}}>{s}</button>
              ))}
            </div>
          )}

          {mensajes.map((msg,i)=>(
            <div key={i} style={{display:'flex',justifyContent:msg.role==='user'?'flex-end':'flex-start',alignItems:'flex-end',gap:'8px'}}>
              {msg.role==='assistant'&&<div style={{width:'36px',height:'36px',borderRadius:'50%',background:'var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',flexShrink:0}}>🤖</div>}
              <div style={{maxWidth:'75%',padding:'12px 16px',borderRadius:msg.role==='user'?'18px 18px 4px 18px':'18px 18px 18px 4px',background:msg.role==='user'?'var(--gold)':'var(--bg-card)',color:msg.role==='user'?'#000':'var(--text-primary)',fontSize:'15px',lineHeight:1.7,border:msg.role==='assistant'?'1px solid var(--border-color)':'none'}}>
                {msg.imageUrl&&<img src={msg.imageUrl} alt="" style={{maxWidth:'100%',borderRadius:'10px',marginBottom:'8px',display:'block'}}/>}
                {msg.isAudio&&<div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'4px',opacity:0.8}}><span>🎤</span><span style={{fontSize:'11px',fontWeight:600}}>{idioma==='en'?'Voice message':'Mensaje de voz'}</span></div>}
                {msg.role==='assistant'?renderMensaje(msg.content):<span>{msg.content}</span>}
                {msg.role==='assistant'&&i>0&&(
                  <button onClick={()=>hablar(msg.content)} disabled={llamandoAI} style={{marginTop:'8px',padding:'4px 10px',borderRadius:'6px',border:'1px solid var(--border-color)',background:'transparent',color:'var(--text-muted)',fontSize:'11px',cursor:llamandoAI?'not-allowed':'pointer',display:'inline-flex',alignItems:'center',gap:'4px'}}>
                    🔊 {idioma==='en'?'Listen':'Escuchar'}
                  </button>
                )}
              </div>
              {msg.role==='user'&&<UserAvatar size={36}/>}
            </div>
          ))}

          {(cargando||transcribiendo)&&(
            <div style={{display:'flex',justifyContent:'flex-start',alignItems:'flex-end',gap:'8px'}}>
              <div style={{width:'36px',height:'36px',borderRadius:'50%',background:'var(--gold)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px'}}>🤖</div>
              <div style={{padding:'14px 18px',borderRadius:'18px 18px 18px 4px',background:'var(--bg-card)',border:'1px solid var(--border-color)',display:'flex',gap:'6px',alignItems:'center'}}>
                {transcribiendo&&<span style={{fontSize:'12px',color:'var(--text-muted)',marginRight:'4px'}}>🎤 {idioma==='en'?'Transcribing...':'Transcribiendo...'}</span>}
                {[0,1,2].map(j=><div key={j} style={{width:'8px',height:'8px',borderRadius:'50%',background:'var(--gold)',animation:`bounce 1s ${j*0.2}s infinite`}}/>)}
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {selectedImage&&(
          <div style={{padding:'10px 24px',background:'var(--bg-secondary)',borderTop:'1px solid var(--border-color)',maxWidth:'800px',margin:'0 auto',width:'100%',boxSizing:'border-box'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <img src={selectedImage.preview} alt="" style={{width:'56px',height:'56px',objectFit:'cover',borderRadius:'8px',border:'2px solid var(--gold)'}}/>
              <div style={{flex:1}}><p style={{fontSize:'13px',color:'var(--text-primary)',margin:0,fontWeight:600}}>{idioma==='en'?'🖼️ Image ready':'🖼️ Imagen lista'}</p></div>
              <button onClick={()=>setSelectedImage(null)} style={{padding:'6px 12px',borderRadius:'8px',border:'1px solid var(--red)',background:'transparent',color:'var(--red)',cursor:'pointer',fontWeight:700}}>✕</button>
            </div>
          </div>
        )}

        {audioGrabado&&(
          <div style={{padding:'14px 24px',background:'var(--bg-card)',borderTop:'2px solid var(--gold)',maxWidth:'800px',margin:'0 auto',width:'100%',boxSizing:'border-box'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
              <audio src={audioGrabado.url} controls style={{flex:1,minWidth:'200px',height:'36px'}}/>
              <button onClick={enviarAudioGrabado} disabled={transcribiendo} style={{padding:'10px 20px',borderRadius:'10px',border:'none',background:transcribiendo?'var(--bg-card2)':'var(--gold)',color:transcribiendo?'var(--text-faint)':'#000',fontSize:'13px',fontWeight:800,cursor:transcribiendo?'not-allowed':'pointer'}}>
                {transcribiendo?(idioma==='en'?'⏳ Transcribing...':'⏳ Transcribiendo...'):(idioma==='en'?'📤 Send':'📤 Enviar')}
              </button>
              <button onClick={descartarAudio} style={{padding:'10px 16px',borderRadius:'10px',border:'2px solid var(--red)',background:'transparent',color:'var(--red)',fontSize:'13px',fontWeight:700,cursor:'pointer'}}>🗑️</button>
            </div>
          </div>
        )}

        {/* Input */}
        <div style={{padding:'16px 24px',background:'var(--bg-card)',borderTop:'1px solid var(--border-color)'}}>
          <div style={{maxWidth:'800px',margin:'0 auto'}}>
            {!audioGrabado&&(
              <div style={{display:'flex',gap:'6px',marginBottom:'10px',flexWrap:'wrap'}}>
                <button onClick={()=>fileInputRef.current?.click()} style={{padding:'7px 14px',borderRadius:'8px',border:`1px solid ${selectedImage?'var(--gold)':'var(--border-color)'}`,background:selectedImage?'var(--gold-dim)':'transparent',color:selectedImage?'var(--gold)':'var(--text-muted)',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>🖼️ {idioma==='en'?'Image':'Imagen'}</button>
                <button onClick={()=>audioInputRef.current?.click()} style={{padding:'7px 14px',borderRadius:'8px',border:'1px solid var(--border-color)',background:'transparent',color:'var(--text-muted)',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>🎵 Audio</button>
                {!grabando
                  ? <button onClick={iniciarGrabacion} style={{padding:'7px 14px',borderRadius:'8px',border:'1px solid var(--border-color)',background:'transparent',color:'var(--text-muted)',fontSize:'12px',fontWeight:700,cursor:'pointer'}}>🎤 {idioma==='en'?'Record':'Grabar'}</button>
                  : <button onClick={detenerGrabacion} style={{padding:'7px 14px',borderRadius:'8px',border:'2px solid var(--red)',background:'var(--red-dim)',color:'var(--red)',fontSize:'12px',fontWeight:800,cursor:'pointer',display:'flex',alignItems:'center',gap:'6px'}}>⏹️ {idioma==='en'?'Stop':'Parar'} <span style={{fontSize:'10px',background:'var(--red)',color:'#fff',padding:'1px 6px',borderRadius:'4px'}}>REC</span></button>
                }
                {llamandoAI&&(
                  <button onClick={stopVoz} style={{padding:'7px 14px',borderRadius:'8px',border:'2px solid var(--red)',background:'rgba(239,68,68,0.1)',color:'var(--red)',fontSize:'12px',fontWeight:800,cursor:'pointer'}}>🔇 {idioma==='en'?'Stop':'Parar'}</button>
                )}
              </div>
            )}
            {!audioGrabado&&(
              <div style={{display:'flex',gap:'10px',alignItems:'flex-end'}}>
                <UserAvatar size={36}/>
                <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();enviar();}}} placeholder={grabando?(idioma==='en'?'🔴 Recording...':'🔴 Grabando...'):(idioma==='en'?'Type or record voice...':'Escribe o graba voz...')} disabled={cargando||grabando} rows={2}
                  style={{flex:1,padding:'14px 16px',borderRadius:'14px',border:`2px solid ${grabando?'var(--red)':(input||selectedImage)?'var(--gold)':'var(--border-color)'}`,background:'var(--bg-secondary)',color:'var(--text-primary)',fontSize:'15px',resize:'none',outline:'none',transition:'border 0.2s',fontFamily:'inherit',lineHeight:1.5}}
                />
                <button onClick={()=>enviar()} disabled={(!input.trim()&&!selectedImage)||cargando||grabando}
                  style={{padding:'14px 24px',borderRadius:'14px',border:'none',background:(input.trim()||selectedImage)&&!cargando&&!grabando?'var(--gold)':'var(--bg-card2)',color:(input.trim()||selectedImage)&&!cargando&&!grabando?'#000':'var(--text-faint)',fontWeight:800,fontSize:'15px',cursor:(input.trim()||selectedImage)&&!cargando&&!grabando?'pointer':'not-allowed'}}>
                  {tr('enviar')}
                </button>
              </div>
            )}
          </div>
        </div>

        <style>{`@keyframes bounce{0%,100%{transform:translateY(0);opacity:0.5}50%{transform:translateY(-6px);opacity:1}}`}</style>
      </div>
    </>
  );
}
