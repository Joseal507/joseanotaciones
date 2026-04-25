'use client';
import { useState, useEffect } from 'react';
import PublicarModal from '../comunidad/PublicarModal';

interface Pregunta {
  id: string;
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
}

interface QuizIntento {
  fecha: string;
  porcentaje: number;
  correctas: number;
  total: number;
}

interface QuizGuardado {
  id: string;
  nombre: string;
  preguntas: Pregunta[];
  intentos: QuizIntento[];
  creadoEn: number;
  expiresAt: number;
  materiaColor?: string;
  materiaNombre?: string;
  dificultad?: string;
}

interface Props {
  contenido: string;
  tema: any;
  materia: any;
  isMobile: boolean;
  idioma: string;
  tr: (k: string) => string;
  documentoId: string;
  onRegistrarQuiz?: (porcentaje: number) => void;
}

const STORAGE_KEY = 'quizzes_v2';
const EXPIRY_MS = 24 * 60 * 60 * 1000;

function getQuizzes(): QuizGuardado[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const all: QuizGuardado[] = JSON.parse(raw);
    const now = Date.now();
    const validos = all.filter(q => q.expiresAt > now);
    if (validos.length !== all.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(validos));
    return validos;
  } catch { return []; }
}
function saveQuizzes(q: QuizGuardado[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(q)); }
function genId() { return Math.random().toString(36).substr(2, 9); }

export default function TabQuiz({ contenido, tema, materia, isMobile, idioma, tr, documentoId, onRegistrarQuiz }: Props) {
  const [vista, setVista] = useState<'lista'|'generando'|'jugando'|'resultado'|'editor'|'historial'>('lista');
  const [quizzes, setQuizzes] = useState<QuizGuardado[]>([]);
  const [quizActivo, setQuizActivo] = useState<QuizGuardado|null>(null);
  const [preguntas, setPreguntas] = useState<Pregunta[]>([]);
  const [idx, setIdx] = useState(0);
  const [seleccionada, setSeleccionada] = useState<number|null>(null);
  const [respondida, setRespondida] = useState(false);
  const [correctas, setCorrectas] = useState(0);
  const [resultados, setResultados] = useState<boolean[]>([]);
  const [cantidad, setCantidad] = useState(5);
  const [dificultad, setDificultad] = useState('medium');
  const [generando, setGenerando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [showGuardar, setShowGuardar] = useState(false);
  const [nombreGuardar, setNombreGuardar] = useState('');
  const [showPublicar, setShowPublicar] = useState(false);
  const [editPreguntas, setEditPreguntas] = useState<Pregunta[]>([]);
  const [editQuizId, setEditQuizId] = useState('');
  const [historialQuiz, setHistorialQuiz] = useState<QuizGuardado|null>(null);
  const [tiemposRestantes, setTiemposRestantes] = useState<Record<string,number>>({});

  useEffect(() => { setQuizzes(getQuizzes()); }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const n: Record<string,number> = {};
      quizzes.forEach(q => { n[q.id] = Math.max(0, q.expiresAt - now); });
      setTiemposRestantes(n);
      const v = getQuizzes();
      if (v.length !== quizzes.length) setQuizzes(v);
    }, 1000);
    return () => clearInterval(interval);
  }, [quizzes]);

  const formatTimer = (ms: number) => {
    const h = Math.floor(ms/3600000); const m = Math.floor((ms%3600000)/60000); const s = Math.floor((ms%60000)/1000);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  };

  const generarQuiz = async () => {
    setGenerando(true); setVista('generando');
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contenido, count: cantidad, idioma, difficulty: dificultad }),
      });
      const data = await res.json();
      if (data.success && data.quiz.length > 0) {
        const np: Pregunta[] = data.quiz.map((p: any) => ({ ...p, id: genId() }));
        const nq: QuizGuardado = {
          id: genId(), nombre: nombreNuevo || 'Quiz ' + new Date().toLocaleDateString(),
          preguntas: np, intentos: [], creadoEn: Date.now(), expiresAt: Date.now() + EXPIRY_MS,
          materiaColor: materia.color, materiaNombre: materia.nombre, dificultad,
        };
        const todos = [...getQuizzes(), nq];
        saveQuizzes(todos); setQuizzes(todos); setQuizActivo(nq); setPreguntas(np);
        setIdx(0); setSeleccionada(null); setRespondida(false); setCorrectas(0); setResultados([]);
        setVista('jugando');
      }
    } catch (e) { console.error(e); setVista('lista'); }
    setGenerando(false);
  };

  const responder = (i: number) => {
    if (respondida) return;
    setSeleccionada(i); setRespondida(true);
    const ok = i === preguntas[idx].correcta;
    if (ok) setCorrectas(c => c + 1);
    setResultados(r => [...r, ok]);
  };

  const siguiente = () => {
    if (idx + 1 >= preguntas.length) {
      const pct = Math.round((correctas / preguntas.length) * 100);
      if (quizActivo) {
        const intento: QuizIntento = { fecha: new Date().toLocaleDateString(), porcentaje: pct, correctas, total: preguntas.length };
        const todos = getQuizzes().map(q => q.id === quizActivo.id ? { ...q, intentos: [...q.intentos, intento] } : q);
        saveQuizzes(todos); setQuizzes(todos);
        setQuizActivo(prev => prev ? { ...prev, intentos: [...prev.intentos, intento] } : prev);
        onRegistrarQuiz?.(pct);
      }
      setVista('resultado');
    } else { setIdx(i => i + 1); setSeleccionada(null); setRespondida(false); }
  };

  const guardarPermanente = (quiz: QuizGuardado, nombre: string) => {
    const todos = getQuizzes().map(q => q.id === quiz.id ? { ...q, nombre, expiresAt: Date.now() + 365*24*60*60*1000 } : q);
    saveQuizzes(todos); setQuizzes(todos); setShowGuardar(false);
  };

  const eliminarQuiz = (id: string) => {
    if (!confirm('¿Eliminar?')) return;
    const todos = getQuizzes().filter(q => q.id !== id);
    saveQuizzes(todos); setQuizzes(todos);
  };

  const iniciarQuiz = (quiz: QuizGuardado) => {
    setQuizActivo(quiz); setPreguntas(quiz.preguntas);
    setIdx(0); setSeleccionada(null); setRespondida(false); setCorrectas(0); setResultados([]);
    setVista('jugando');
  };

  const colorOpcion = (i: number) => {
    if (!respondida) return { bg: 'var(--bg-secondary)', border: '2px solid var(--border-color)', color: 'var(--text-primary)' };
    if (i === preguntas[idx].correcta) return { bg: 'rgba(74,222,128,0.12)', border: '2px solid #4ade80', color: '#fff' };
    if (i === seleccionada) return { bg: 'rgba(255,77,109,0.12)', border: '2px solid #ff4d6d', color: '#fff' };
    return { bg: 'transparent', border: '2px solid var(--border-color)', color: 'var(--text-muted)' };
  };

  const letraOpcion = (i: number) => {
    if (!respondida) return ['A','B','C','D'][i];
    if (i === preguntas[idx].correcta) return '✓';
    if (i === seleccionada) return '✗';
    return ['A','B','C','D'][i];
  };

  const progreso = preguntas.length > 0 ? ((idx + (respondida ? 1 : 0)) / preguntas.length) * 100 : 0;

  const DIFS = [
    { id: 'easy', label: idioma === 'en' ? '🟢 Easy' : '🟢 Fácil', color: '#4ade80' },
    { id: 'medium', label: idioma === 'en' ? '🟡 Medium' : '🟡 Medio', color: '#f5c842' },
    { id: 'hard', label: idioma === 'en' ? '🔴 Hard' : '🔴 Difícil', color: '#ff4d6d' },
  ];
  const difActual = DIFS.find(d => d.id === dificultad) || DIFS[1];

  // ── JUGANDO ──
  if (vista === 'jugando' && preguntas[idx]) {
    const p = preguntas[idx];
    return (
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        {showPublicar && <PublicarModal onClose={() => setShowPublicar(false)} onPublicado={() => setShowPublicar(false)} tipoInicial="quiz" directPost={quizActivo ? {
          tipo: 'quiz',
          titulo: quizActivo.nombre || nombreNuevo || 'Quiz',
          materia: materia?.nombre || 'General',
          color: materia?.color || tema.color,
          emoji: materia?.emoji || '🤓',
          contenido: {
            tipo: 'quiz',
            nombre: quizActivo.nombre || nombreNuevo || 'Quiz',
            preguntas: quizActivo.preguntas || preguntas,
            intentos: quizActivo.intentos || [],
            dificultad: quizActivo.dificultad || dificultad,
            total: (quizActivo.preguntas || preguntas).length,
            materiaNombre: materia?.nombre,
            materiaColor: materia?.color,
            materiaEmoji: materia?.emoji,
          }
        } : undefined} />}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <button onClick={() => setVista('lista')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>← {idioma === 'en' ? 'Back' : 'Volver'}</button>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1} / {preguntas.length}</span>
        </div>
        <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', marginBottom: '24px', overflow: 'hidden' }}>
          <div style={{ width: progreso + '%', height: '100%', background: tema.color, borderRadius: '3px', transition: 'width 0.4s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {preguntas.map((_, i) => (
            <div key={i} style={{ width: i === idx ? '24px' : '10px', height: '10px', borderRadius: '5px', background: i < idx ? (resultados[i] ? '#4ade80' : '#ff4d6d') : i === idx ? tema.color : 'var(--border-color)', transition: 'all 0.3s', flexShrink: 0 }} />
          ))}
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '2px solid ' + tema.color + '33', overflow: 'hidden', marginBottom: '16px' }}>
          <div style={{ height: '4px', background: tema.color }} />
          <div style={{ padding: '28px' }}>
            <span style={{ fontSize: '11px', color: tema.color, fontWeight: 800, textTransform: 'uppercase' as any, letterSpacing: '2px' }}>{idioma === 'en' ? 'Question' : 'Pregunta'} {idx + 1}</span>
            <p style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', margin: '12px 0 0', lineHeight: 1.5 }}>{p.pregunta}</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' as any, gap: '10px', marginBottom: '20px' }}>
          {p.opciones.map((op, i) => {
            const c = colorOpcion(i);
            return (
              <button key={i} onClick={() => responder(i)} disabled={respondida} style={{ padding: '16px 20px', borderRadius: '14px', border: c.border, background: c.bg, color: c.color, fontSize: '15px', fontWeight: 500, cursor: respondida ? 'default' : 'pointer', textAlign: 'left' as any, display: 'flex', alignItems: 'center', gap: '14px', width: '100%' }}>
                <span style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, background: !respondida ? 'var(--bg-secondary)' : i === p.correcta ? '#4ade80' : i === seleccionada ? '#ff4d6d' : 'var(--bg-secondary)', color: !respondida ? 'var(--text-muted)' : (i === p.correcta || i === seleccionada) ? '#000' : 'var(--text-muted)' }}>{letraOpcion(i)}</span>
                <span style={{ flex: 1 }}>{op}</span>
              </button>
            );
          })}
        </div>
        {respondida && (
          <>
            <div style={{ background: seleccionada === p.correcta ? 'rgba(74,222,128,0.08)' : 'rgba(255,77,109,0.08)', border: '2px solid ' + (seleccionada === p.correcta ? '#4ade8044' : '#ff4d6d44'), borderRadius: '14px', padding: '16px 20px', marginBottom: '16px' }}>
              <p style={{ fontSize: '13px', fontWeight: 800, color: seleccionada === p.correcta ? '#4ade80' : '#ff4d6d', margin: '0 0 6px' }}>{seleccionada === p.correcta ? '✓ ' + (idioma === 'en' ? 'Correct!' : '¡Correcto!') : '✗ ' + (idioma === 'en' ? 'Incorrect' : 'Incorrecto')}</p>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{p.explicacion}</p>
            </div>
            <button onClick={siguiente} style={{ width: '100%', padding: '16px', borderRadius: '14px', border: 'none', background: tema.color, color: '#000', fontSize: '16px', fontWeight: 800, cursor: 'pointer' }}>{idx + 1 >= preguntas.length ? (idioma === 'en' ? 'See results' : 'Ver resultados') : (idioma === 'en' ? 'Next →' : 'Siguiente →')}</button>
          </>
        )}
      </div>
    );
  }

  // ── RESULTADO ──
  if (vista === 'resultado') {
    const fp = preguntas.length > 0 ? Math.round((correctas / preguntas.length) * 100) : 0;
    const rc = fp >= 80 ? '#4ade80' : fp >= 60 ? '#f5c842' : '#ff4d6d';
    return (
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        {showPublicar && <PublicarModal onClose={() => setShowPublicar(false)} onPublicado={() => setShowPublicar(false)} tipoInicial="quiz" directPost={quizActivo ? {
          tipo: 'quiz',
          titulo: quizActivo.nombre || nombreNuevo || 'Quiz',
          materia: materia?.nombre || 'General',
          color: materia?.color || tema.color,
          emoji: materia?.emoji || '🤓',
          contenido: {
            tipo: 'quiz',
            nombre: quizActivo.nombre || nombreNuevo || 'Quiz',
            preguntas: quizActivo.preguntas || preguntas,
            intentos: quizActivo.intentos || [],
            dificultad: quizActivo.dificultad || dificultad,
            total: (quizActivo.preguntas || preguntas).length,
            materiaNombre: materia?.nombre,
            materiaColor: materia?.color,
            materiaEmoji: materia?.emoji,
          }
        } : undefined} />}
        {showGuardar && quizActivo && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '380px', border: '1px solid var(--border-color)' }}>
              <h3 style={{ color: 'var(--text-primary)', margin: '0 0 16px', fontWeight: 800 }}>💾 {idioma === 'en' ? 'Save permanently' : 'Guardar permanentemente'}</h3>
              <input value={nombreGuardar} onChange={e => setNombreGuardar(e.target.value)} placeholder={idioma === 'en' ? 'Quiz name...' : 'Nombre...'} style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as any, marginBottom: '12px' }} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setShowGuardar(false)} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>{idioma === 'en' ? 'Cancel' : 'Cancelar'}</button>
                <button onClick={() => guardarPermanente(quizActivo, nombreGuardar || quizActivo.nombre)} style={{ flex: 2, padding: '12px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontWeight: 800, cursor: 'pointer' }}>💾</button>
              </div>
            </div>
          </div>
        )}
        <div style={{ textAlign: 'center' as any, marginBottom: '32px' }}>
          <div style={{ fontSize: '64px', marginBottom: '12px' }}>{fp >= 80 ? '🏆' : fp >= 60 ? '👍' : '📚'}</div>
          <h2 style={{ fontSize: '28px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px' }}>{idioma === 'en' ? 'Quiz completed!' : '¡Quiz completado!'}</h2>
          <div style={{ fontSize: '64px', fontWeight: 900, color: rc, lineHeight: 1 }}>{fp}%</div>
          <p style={{ color: 'var(--text-muted)', margin: '8px 0 0' }}>{correctas} / {preguntas.length} {idioma === 'en' ? 'correct' : 'correctas'}</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '24px' }}>
          {[{ label: idioma === 'en' ? 'Correct' : 'Acertadas', val: correctas, color: '#4ade80', emoji: '✅' }, { label: idioma === 'en' ? 'Wrong' : 'Falladas', val: preguntas.length - correctas, color: '#ff4d6d', emoji: '❌' }, { label: 'Total', val: preguntas.length, color: tema.color, emoji: '📊' }].map((s, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '14px', padding: '16px', textAlign: 'center' as any, border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '20px', marginBottom: '4px' }}>{s.emoji}</div>
              <div style={{ fontSize: '28px', fontWeight: 900, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as any, margin: '0 0 16px' }}>{idioma === 'en' ? 'Per question' : 'Por pregunta'}</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '60px' }}>
            {resultados.map((ok, i) => (<div key={i} style={{ flex: 1, height: ok ? '50px' : '20px', background: ok ? '#4ade80' : '#ff4d6d', borderRadius: '4px 4px 0 0', minWidth: '8px' }} />))}
          </div>
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', border: '1px solid var(--border-color)', marginBottom: '20px', maxHeight: '250px', overflowY: 'auto' as any }}>
          {preguntas.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px', borderRadius: '8px', background: resultados[i] ? 'rgba(74,222,128,0.05)' : 'rgba(255,77,109,0.05)', marginBottom: '6px', border: '1px solid ' + (resultados[i] ? '#4ade8022' : '#ff4d6d22') }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }}>{resultados[i] ? '✅' : '❌'}</span>
              <div><p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 2px' }}>{p.pregunta}</p>{!resultados[i] && <p style={{ fontSize: '11px', color: '#4ade80', margin: 0 }}>✓ {p.opciones[p.correcta]}</p>}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as any }}>
          <button onClick={() => iniciarQuiz(quizActivo!)} style={{ flex: 1, padding: '14px', borderRadius: '12px', border: 'none', background: tema.color, color: '#000', fontWeight: 800, cursor: 'pointer' }}>🔄 {idioma === 'en' ? 'Retry' : 'Repetir'}</button>
          <button onClick={() => { setShowGuardar(true); setNombreGuardar(quizActivo?.nombre || ''); }} style={{ flex: 1, padding: '14px', borderRadius: '12px', border: '2px solid #4ade80', background: 'transparent', color: '#4ade80', fontWeight: 700, cursor: 'pointer' }}>💾</button>
          <button onClick={() => setShowPublicar(true)} style={{ flex: 1, padding: '14px', borderRadius: '12px', border: 'none', background: '#f5c842', color: '#000', fontWeight: 800, cursor: 'pointer' }}>🚀</button>
          <button onClick={() => setVista('lista')} style={{ flex: 1, padding: '14px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>✕</button>
        </div>
      </div>
    );
  }

  if (vista === 'generando') {
    return (<div style={{ textAlign: 'center' as any, padding: '60px 0' }}><div style={{ fontSize: '48px', marginBottom: '16px' }}>🤖</div><p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '16px' }}>{idioma === 'en' ? 'Generating quiz...' : 'Generando quiz...'}</p></div>);
  }

  // ── EDITOR ──
  if (vista === 'editor') {
    return (
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ color: 'var(--text-primary)', margin: 0, fontWeight: 800 }}>✏️ {idioma === 'en' ? 'Edit quiz' : 'Editar quiz'}</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { const t = getQuizzes().map(q => q.id === editQuizId ? { ...q, preguntas: editPreguntas } : q); saveQuizzes(t); setQuizzes(t); setVista('lista'); }} style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontWeight: 800, cursor: 'pointer' }}>💾</button>
            <button onClick={() => setVista('lista')} style={{ padding: '10px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>✕</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' as any, gap: '16px' }}>
          {editPreguntas.map((p, i) => (
            <div key={p.id} style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: tema.color }}>P{i + 1}</span>
                <button onClick={() => setEditPreguntas(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ff4d6d', cursor: 'pointer', fontSize: '14px' }}>🗑️</button>
              </div>
              <input value={p.pregunta} onChange={e => setEditPreguntas(prev => prev.map((q, j) => j === i ? { ...q, pregunta: e.target.value } : q))} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', marginBottom: '10px', boxSizing: 'border-box' as any }} />
              {p.opciones.map((op, oi) => (
                <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <button onClick={() => setEditPreguntas(prev => prev.map((q, j) => j === i ? { ...q, correcta: oi } : q))} style={{ width: '28px', height: '28px', borderRadius: '50%', border: '2px solid ' + (p.correcta === oi ? '#4ade80' : 'var(--border-color)'), background: p.correcta === oi ? '#4ade80' : 'transparent', color: p.correcta === oi ? '#000' : 'var(--text-muted)', fontSize: '11px', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>{['A','B','C','D'][oi]}</button>
                  <input value={op} onChange={e => setEditPreguntas(prev => prev.map((q, j) => j === i ? { ...q, opciones: q.opciones.map((o, k) => k === oi ? e.target.value : o) } : q))} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '2px solid ' + (p.correcta === oi ? '#4ade8044' : 'var(--border-color)'), background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px' }} />
                </div>
              ))}
            </div>
          ))}
          <button onClick={() => setEditPreguntas(prev => [...prev, { id: genId(), pregunta: '', opciones: ['','','',''], correcta: 0, explicacion: '' }])} style={{ padding: '14px', borderRadius: '12px', border: '2px dashed ' + tema.color, background: 'transparent', color: tema.color, fontWeight: 700, cursor: 'pointer' }}>➕ {idioma === 'en' ? 'Add question' : 'Añadir pregunta'}</button>
        </div>
      </div>
    );
  }

  // ── HISTORIAL ──
  if (vista === 'historial' && historialQuiz) {
    return (
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <button onClick={() => setVista('lista')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', fontWeight: 700, marginBottom: '20px' }}>← {idioma === 'en' ? 'Back' : 'Volver'}</button>
        <h3 style={{ color: 'var(--text-primary)', fontWeight: 800, margin: '0 0 20px' }}>📊 {historialQuiz.nombre}</h3>
        {historialQuiz.intentos.length === 0 ? (<p style={{ color: 'var(--text-muted)', textAlign: 'center' as any, padding: '40px 0' }}>{idioma === 'en' ? 'No attempts yet' : 'Sin intentos aún'}</p>) : (
          <>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
              <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' as any, margin: '0 0 16px' }}>{idioma === 'en' ? 'Progress' : 'Progreso'}</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '80px' }}>
                {historialQuiz.intentos.map((intento, i) => { const h = Math.max(8, (intento.porcentaje / 100) * 80); const c = intento.porcentaje >= 80 ? '#4ade80' : intento.porcentaje >= 60 ? '#f5c842' : '#ff4d6d'; return (<div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column' as any, alignItems: 'center', gap: '4px' }}><span style={{ fontSize: '10px', color: c, fontWeight: 700 }}>{intento.porcentaje}%</span><div style={{ width: '100%', height: h + 'px', background: c, borderRadius: '4px 4px 0 0', minWidth: '20px' }} /></div>); })}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as any, gap: '10px' }}>
              {historialQuiz.intentos.map((intento, i) => (
                <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '12px', padding: '16px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px' }}>{idioma === 'en' ? 'Attempt' : 'Intento'} {i + 1}</p><p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{intento.fecha}</p></div>
                  <div style={{ textAlign: 'right' as any }}><div style={{ fontSize: '22px', fontWeight: 900, color: intento.porcentaje >= 80 ? '#4ade80' : intento.porcentaje >= 60 ? '#f5c842' : '#ff4d6d' }}>{intento.porcentaje}%</div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{intento.correctas}/{intento.total}</div></div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── LISTA ──
  return (
    <div style={{ maxWidth: '680px', margin: '0 auto' }}>
      {showPublicar && <PublicarModal onClose={() => setShowPublicar(false)} onPublicado={() => setShowPublicar(false)} tipoInicial="quiz" directPost={quizActivo ? {
          tipo: 'quiz',
          titulo: quizActivo.nombre || nombreNuevo || 'Quiz',
          materia: materia?.nombre || 'General',
          color: materia?.color || tema.color,
          emoji: materia?.emoji || '🤓',
          contenido: {
            tipo: 'quiz',
            nombre: quizActivo.nombre || nombreNuevo || 'Quiz',
            preguntas: quizActivo.preguntas || preguntas,
            intentos: quizActivo.intentos || [],
            dificultad: quizActivo.dificultad || dificultad,
            total: (quizActivo.preguntas || preguntas).length,
            materiaNombre: materia?.nombre,
            materiaColor: materia?.color,
            materiaEmoji: materia?.emoji,
          }
        } : undefined} />}
      {showGuardar && quizActivo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '380px', border: '1px solid var(--border-color)' }}>
            <h3 style={{ color: 'var(--text-primary)', margin: '0 0 16px', fontWeight: 800 }}>💾 {idioma === 'en' ? 'Save permanently' : 'Guardar permanentemente'}</h3>
            <input value={nombreGuardar} onChange={e => setNombreGuardar(e.target.value)} placeholder={idioma === 'en' ? 'Quiz name...' : 'Nombre...'} style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginBottom: '12px' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowGuardar(false)} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>{idioma === 'en' ? 'Cancel' : 'Cancelar'}</button>
              <button onClick={() => guardarPermanente(quizActivo, nombreGuardar || quizActivo.nombre)} style={{ flex: 2, padding: '12px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontWeight: 800, cursor: 'pointer' }}>💾</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '2px solid ' + tema.color + '33', overflow: 'hidden', marginBottom: '24px' }}>
        <div style={{ height: '4px', background: tema.color }} />
        <div style={{ padding: '24px' }}>
          <h3 style={{ color: 'var(--text-primary)', margin: '0 0 20px', fontWeight: 800, fontSize: '18px' }}>🤓 {idioma === 'en' ? 'Create new quiz' : 'Crear nuevo quiz'}</h3>
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>{idioma === 'en' ? 'Quiz name' : 'Nombre del quiz'}</p>
            <input value={nombreNuevo} onChange={e => setNombreNuevo(e.target.value)} placeholder={idioma === 'en' ? 'e.g. Chapter 1 review...' : 'ej. Repaso del tema 1...'} style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>{idioma === 'en' ? 'Difficulty' : 'Dificultad'}</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {DIFS.map(d => (
                <button key={d.id} onClick={() => setDificultad(d.id)} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '2px solid ' + (dificultad === d.id ? d.color : 'var(--border-color)'), background: dificultad === d.id ? d.color + '15' : 'transparent', color: dificultad === d.id ? d.color : 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{d.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>{idioma === 'en' ? 'Number of questions' : 'Número de preguntas'}</p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
              {[3,5,8,10,15,20,25,30,40,50].map(n => (
                <button key={n} onClick={() => setCantidad(n)} style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid ' + (cantidad === n ? tema.color : 'var(--border-color)'), background: cantidad === n ? tema.color + '20' : 'transparent', color: cantidad === n ? tema.color : 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{n}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{idioma === 'en' ? 'Custom:' : 'Personalizado:'}</span>
              <input type="number" min={1} max={100} value={cantidad} onChange={e => setCantidad(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))} style={{ width: '70px', padding: '8px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, textAlign: 'center' }} />
              <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{idioma === 'en' ? 'questions' : 'preguntas'}</span>
            </div>
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: '10px', marginBottom: '16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontSize: '16px' }}>💡</span>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              {cantidad} {idioma === 'en' ? 'questions' : 'preguntas'} · {difActual.label} · {idioma === 'en' ? 'Expires in 24h if not saved.' : 'Expira en 24h si no se guarda.'}
            </p>
          </div>
          <button onClick={generarQuiz} disabled={generando} style={{ width: '100%', padding: '16px', borderRadius: '14px', border: 'none', background: generando ? 'var(--bg-secondary)' : tema.color, color: generando ? 'var(--text-muted)' : '#000', fontSize: '16px', fontWeight: 900, cursor: generando ? 'not-allowed' : 'pointer' }}>
            {generando ? '⏳ ...' : '🚀 ' + (idioma === 'en' ? 'Generate Quiz' : 'Generar Quiz')}
          </button>
        </div>
      </div>

      {quizzes.length > 0 && (
        <div>
          <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>{idioma === 'en' ? 'Saved quizzes' : 'Quizzes guardados'}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {quizzes.map(quiz => {
              const restante = tiemposRestantes[quiz.id] || 0;
              const urgente = restante < 3600000 && restante > 0;
              const mejor = quiz.intentos.length > 0 ? Math.max(...quiz.intentos.map(i => i.porcentaje)) : null;
              return (
                <div key={quiz.id} style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid ' + (urgente ? '#ff4d6d44' : 'var(--border-color)'), overflow: 'hidden' }}>
                  <div style={{ height: '3px', background: quiz.materiaColor || tema.color }} />
                  <div style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                      <div>
                        <h4 style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontWeight: 800, fontSize: '15px' }}>{quiz.nombre}</h4>
                        <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
                          {quiz.preguntas.length} {idioma === 'en' ? 'questions' : 'preguntas'}
                          {quiz.dificultad && ' · ' + (quiz.dificultad === 'easy' ? '🟢' : quiz.dificultad === 'hard' ? '🔴' : '🟡')}
                          {quiz.intentos.length > 0 && ' · ' + quiz.intentos.length + (idioma === 'en' ? ' attempts' : ' intentos')}
                          {mejor !== null && ' · 🏆 ' + mejor + '%'}
                        </p>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: urgente ? '#ff4d6d' : 'var(--text-faint)', background: urgente ? '#ff4d6d15' : 'var(--bg-secondary)', padding: '3px 8px', borderRadius: '6px' }}>
                        {urgente ? '⚠️ ' : '⏱ '}{formatTimer(restante)}
                      </span>
                    </div>
                    {quiz.intentos.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', alignItems: 'flex-end', height: '24px' }}>
                        {quiz.intentos.slice(-8).map((intento, i) => (
                          <div key={i} style={{ flex: 1, height: Math.max(4, (intento.porcentaje/100)*24) + 'px', background: intento.porcentaje >= 80 ? '#4ade80' : intento.porcentaje >= 60 ? '#f5c842' : '#ff4d6d', borderRadius: '2px', minWidth: '6px' }} />
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <button onClick={() => iniciarQuiz(quiz)} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: quiz.materiaColor || tema.color, color: '#000', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>▶ {idioma === 'en' ? 'Play' : 'Jugar'}</button>
                      {quiz.intentos.length > 0 && <button onClick={() => { setHistorialQuiz(quiz); setVista('historial'); }} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>📊</button>}
                      <button onClick={() => { setEditQuizId(quiz.id); setEditPreguntas(quiz.preguntas); setVista('editor'); }} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => { setQuizActivo(quiz); setShowGuardar(true); setNombreGuardar(quiz.nombre); }} style={{ padding: '8px 12px', borderRadius: '8px', border: '2px solid #4ade80', background: 'transparent', color: '#4ade80', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>💾</button>
                      <button onClick={() => { setQuizActivo(quiz); setShowPublicar(true); }} style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: '#f5c842', color: '#000', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>🚀</button>
                      <button onClick={() => eliminarQuiz(quiz.id)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ff4d6d44', background: 'transparent', color: '#ff4d6d', fontSize: '12px', cursor: 'pointer', marginLeft: 'auto' }}>🗑️</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {quizzes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🤓</div>
          <p style={{ fontSize: '14px', fontWeight: 600 }}>{idioma === 'en' ? 'No quizzes yet. Create your first one!' : '¡Aún no hay quizzes. Crea el primero!'}</p>
        </div>
      )}
    </div>
  );
}
