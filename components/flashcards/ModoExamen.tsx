'use client';

import { useState } from 'react';
import { useIdioma } from '../../hooks/useIdioma';
import { getIdioma } from '../../lib/i18n';
import { registrarEstudioHoy } from '../../lib/racha';
import MathText from '../MathText';

interface Flashcard {
  question: string;
  answer: string;
}

interface PreguntaQuiz {
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
}

interface ResultadoEscrito {
  nivel: 'INSANE' | 'correcta' | 'medio_correcta' | 'incorrecta' | 'muy_incorrecta';
  porcentaje: number;
  explicacion: string;
  consejo: string;
}

interface Props {
  flashcards: Flashcard[];
  contenido: string;
  nombreDoc: string;
  temaColor: string;
  onClose: () => void;
}

type TipoPregunta = 'escrita' | 'opcion_multiple';

interface PreguntaExamen {
  tipo: TipoPregunta;
  // Para escrita (flashcard)
  pregunta?: string;
  respuestaCorrecta?: string;
  // Para opción múltiple (quiz)
  enunciado?: string;
  opciones?: string[];
  correcta?: number;
  explicacion?: string;
}

type Fase = 'config' | 'examen' | 'fin';

const NIVEL_INFO = {
  INSANE: { emoji: '🔥', label: 'INSANE', color: '#f5c842', bg: '#f5c84220' },
  correcta: { emoji: '✅', label: 'Correcta', color: '#4ade80', bg: '#4ade8020' },
  medio_correcta: { emoji: '🟡', label: 'Medio', color: '#fb923c', bg: '#fb923c20' },
  incorrecta: { emoji: '❌', label: 'Incorrecta', color: '#ff4d6d', bg: '#ff4d6d20' },
  muy_incorrecta: { emoji: '💀', label: 'Muy mal', color: '#888', bg: '#88888820' },
};

export default function ModoExamen({ flashcards, contenido, nombreDoc, temaColor, onClose }: Props) {
  const { tr, idioma } = useIdioma();

  const [fase, setFase] = useState<Fase>('config');
  const [cantidadFlashcards, setCantidadFlashcards] = useState(Math.min(5, flashcards.length));
  const [cantidadQuiz, setCantidadQuiz] = useState(5);
  const [cargandoConfig, setCargandoConfig] = useState(false);

  const [preguntas, setPreguntas] = useState<PreguntaExamen[]>([]);
  const [idxActual, setIdxActual] = useState(0);
  const [respuestaEscrita, setRespuestaEscrita] = useState('');
  const [opcionSeleccionada, setOpcionSeleccionada] = useState<number | null>(null);
  const [respondida, setRespondida] = useState(false);
  const [resultadoEscrito, setResultadoEscrito] = useState<ResultadoEscrito | null>(null);
  const [evaluando, setEvaluando] = useState(false);
  const [mostrarRespuesta, setMostrarRespuesta] = useState(false);

  const [stats, setStats] = useState({
    correctas: 0,
    incorrectas: 0,
    INSANE: 0,
    correcta: 0,
    medio_correcta: 0,
    incorrecta: 0,
    muy_incorrecta: 0,
  });
  const [resultadosDetalle, setResultadosDetalle] = useState<{
    pregunta: string;
    tipo: TipoPregunta;
    correcto: boolean;
    nivel?: string;
  }[]>([]);

  const mezclar = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const iniciarExamen = async () => {
    setCargandoConfig(true);
    registrarEstudioHoy();
    try {
      const preguntasExamen: PreguntaExamen[] = [];

      // 1. Flashcards mezcladas (escritas)
      const flashcardsSeleccionadas = mezclar([...flashcards]).slice(0, cantidadFlashcards);
      flashcardsSeleccionadas.forEach(f => {
        preguntasExamen.push({
          tipo: 'escrita',
          pregunta: f.question,
          respuestaCorrecta: f.answer,
        });
      });

      // 2. Preguntas de quiz generadas por AI
      if (cantidadQuiz > 0 && contenido) {
        const res = await fetch('/api/quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: contenido, count: cantidadQuiz, idioma: getIdioma() }),
        });
        const data = await res.json();
        if (data.success && data.quiz) {
          data.quiz.forEach((q: PreguntaQuiz) => {
            preguntasExamen.push({
              tipo: 'opcion_multiple',
              enunciado: q.pregunta,
              opciones: q.opciones,
              correcta: q.correcta,
              explicacion: q.explicacion,
            });
          });
        }
      }

      // Mezclar todo
      setPreguntas(mezclar(preguntasExamen));
      setIdxActual(0);
      setRespuestaEscrita('');
      setOpcionSeleccionada(null);
      setRespondida(false);
      setResultadoEscrito(null);
      setMostrarRespuesta(false);
      setStats({ correctas: 0, incorrectas: 0, INSANE: 0, correcta: 0, medio_correcta: 0, incorrecta: 0, muy_incorrecta: 0 });
      setResultadosDetalle([]);
      setFase('examen');
    } catch (err) {
      console.error(err);
    } finally {
      setCargandoConfig(false);
    }
  };

  const preguntaActual = preguntas[idxActual];
  const progreso = preguntas.length > 0 ? Math.round((idxActual / preguntas.length) * 100) : 0;
  const totalRespondidas = resultadosDetalle.length;

  // Evaluar flashcard escrita
  const evaluarEscrita = async () => {
    if (!respuestaEscrita.trim() || !preguntaActual) return;
    setEvaluando(true);
    try {
      const res = await fetch('/api/evaluar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pregunta: preguntaActual.pregunta,
          respuestaCorrecta: preguntaActual.respuestaCorrecta,
          respuestaUsuario: respuestaEscrita,
          idioma: getIdioma(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const r = data.resultado;
        setResultadoEscrito(r);
        setRespondida(true);
        const esCorrecta = ['INSANE', 'correcta', 'medio_correcta'].includes(r.nivel);
        setStats(prev => ({
          ...prev,
          correctas: esCorrecta ? prev.correctas + 1 : prev.correctas,
          incorrectas: !esCorrecta ? prev.incorrectas + 1 : prev.incorrectas,
          [r.nivel]: (prev[r.nivel as keyof typeof prev] as number) + 1,
        }));
        setResultadosDetalle(prev => [...prev, {
          pregunta: preguntaActual.pregunta || '',
          tipo: 'escrita',
          correcto: esCorrecta,
          nivel: r.nivel,
        }]);
      }
    } catch (err) { console.error(err); }
    finally { setEvaluando(false); }
  };

  // Responder opción múltiple
  const responderOpcion = (i: number) => {
    if (respondida || !preguntaActual) return;
    setOpcionSeleccionada(i);
    setRespondida(true);
    const esCorrecta = i === preguntaActual.correcta;
    setStats(prev => ({
      ...prev,
      correctas: esCorrecta ? prev.correctas + 1 : prev.correctas,
      incorrectas: !esCorrecta ? prev.incorrectas + 1 : prev.incorrectas,
    }));
    setResultadosDetalle(prev => [...prev, {
      pregunta: preguntaActual.enunciado || '',
      tipo: 'opcion_multiple',
      correcto: esCorrecta,
    }]);
  };

  const siguiente = () => {
    if (idxActual + 1 >= preguntas.length) {
      setFase('fin');
      return;
    }
    setIdxActual(i => i + 1);
    setRespuestaEscrita('');
    setOpcionSeleccionada(null);
    setRespondida(false);
    setResultadoEscrito(null);
    setMostrarRespuesta(false);
  };

  const porcentajeFinal = preguntas.length > 0
    ? Math.round((stats.correctas / preguntas.length) * 100)
    : 0;

  // ===== CONFIG =====
  if (fase === 'config') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 3000, alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '540px', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: 900, color: '#fff', margin: 0 }}>
                📚 {idioma === 'en' ? 'Exam Mode' : 'Modo Examen'}
              </h2>
              <p style={{ color: '#888', margin: '4px 0 0', fontSize: '13px' }}>
                📄 {nombreDoc}
              </p>
            </div>
            <button onClick={onClose}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              ✕
            </button>
          </div>

          {/* Descripción */}
          <div style={{ background: temaColor + '15', border: `2px solid ${temaColor}44`, borderRadius: '14px', padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '24px' }}>🎓</span>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 700, color: temaColor, margin: '0 0 4px' }}>
                {idioma === 'en' ? 'Mixed exam from this document' : 'Examen mixto de este documento'}
              </p>
              <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
                {idioma === 'en'
                  ? 'Combines written flashcards + multiple choice questions generated by AI from the document content'
                  : 'Combina flashcards escritas + preguntas de opción múltiple generadas por AI del contenido del documento'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px' }}>

            {/* Flashcards */}
            <div style={{ background: '#0d0d1a', borderRadius: '14px', border: `1px solid ${temaColor}44`, padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 800, color: '#fff', margin: 0 }}>
                    ✍️ {idioma === 'en' ? 'Written flashcards' : 'Flashcards escritas'}
                  </p>
                  <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0' }}>
                    {idioma === 'en' ? 'Write the answer, AI evaluates' : 'Escribe la respuesta, la AI evalúa'}
                  </p>
                </div>
                <div style={{ background: temaColor + '20', border: `1px solid ${temaColor}44`, borderRadius: '8px', padding: '4px 12px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 900, color: temaColor }}>{cantidadFlashcards}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[1, 3, 5, 10, Math.min(flashcards.length, 15)].filter((v, i, a) => a.indexOf(v) === i && v <= flashcards.length).map(n => (
                  <button key={n} onClick={() => setCantidadFlashcards(n)}
                    style={{ padding: '5px 12px', borderRadius: '7px', border: `2px solid ${cantidadFlashcards === n ? temaColor : '#333'}`, background: cantidadFlashcards === n ? temaColor + '20' : 'transparent', color: cantidadFlashcards === n ? temaColor : '#888', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    {n}
                  </button>
                ))}
                <input type="number" min={0} max={flashcards.length} value={cantidadFlashcards}
                  onChange={e => setCantidadFlashcards(Math.min(flashcards.length, Math.max(0, parseInt(e.target.value) || 0)))}
                  style={{ width: '55px', padding: '5px 8px', borderRadius: '7px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '13px', textAlign: 'center' }} />
              </div>
              <p style={{ fontSize: '11px', color: '#555', margin: '8px 0 0' }}>
                {flashcards.length} {idioma === 'en' ? 'available' : 'disponibles'}
              </p>
            </div>

            {/* Quiz */}
            <div style={{ background: '#0d0d1a', borderRadius: '14px', border: '1px solid #a78bfa44', padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 800, color: '#fff', margin: 0 }}>
                    🎯 {idioma === 'en' ? 'Multiple choice' : 'Opción múltiple'}
                  </p>
                  <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0' }}>
                    {idioma === 'en' ? 'AI generates questions from document' : 'La AI genera preguntas del documento'}
                  </p>
                </div>
                <div style={{ background: '#a78bfa20', border: '1px solid #a78bfa44', borderRadius: '8px', padding: '4px 12px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 900, color: '#a78bfa' }}>{cantidadQuiz}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[0, 3, 5, 8, 10].map(n => (
                  <button key={n} onClick={() => setCantidadQuiz(n)}
                    style={{ padding: '5px 12px', borderRadius: '7px', border: `2px solid ${cantidadQuiz === n ? '#a78bfa' : '#333'}`, background: cantidadQuiz === n ? '#a78bfa20' : 'transparent', color: cantidadQuiz === n ? '#a78bfa' : '#888', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    {n === 0 ? (idioma === 'en' ? 'None' : 'Ninguna') : n}
                  </button>
                ))}
                <input type="number" min={0} max={20} value={cantidadQuiz}
                  onChange={e => setCantidadQuiz(Math.min(20, Math.max(0, parseInt(e.target.value) || 0)))}
                  style={{ width: '55px', padding: '5px 8px', borderRadius: '7px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '13px', textAlign: 'center' }} />
              </div>
            </div>
          </div>

          {/* Resumen */}
          {(cantidadFlashcards + cantidadQuiz) > 0 && (
            <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', border: '1px solid #333', textAlign: 'center' }}>
              <p style={{ fontSize: '14px', color: '#888', margin: 0 }}>
                {idioma === 'en' ? 'Total:' : 'Total:'}{' '}
                <span style={{ color: temaColor, fontWeight: 800 }}>{cantidadFlashcards + cantidadQuiz}</span>{' '}
                {idioma === 'en' ? 'questions' : 'preguntas'}
                {cantidadQuiz > 0 && (
                  <span style={{ color: '#888', fontSize: '12px' }}>
                    {' '}({cantidadFlashcards} {idioma === 'en' ? 'written' : 'escritas'} + {cantidadQuiz} {idioma === 'en' ? 'multiple choice' : 'opción múltiple'})
                  </span>
                )}
              </p>
              {cantidadQuiz > 0 && (
                <p style={{ fontSize: '11px', color: '#555', margin: '4px 0 0' }}>
                  ⏳ {idioma === 'en' ? 'AI will generate quiz questions (~10s)' : 'La AI generará las preguntas de quiz (~10s)'}
                </p>
              )}
            </div>
          )}

          <button
            onClick={iniciarExamen}
            disabled={cargandoConfig || (cantidadFlashcards + cantidadQuiz) === 0}
            style={{ width: '100%', padding: '16px', borderRadius: '14px', border: 'none', background: cargandoConfig || (cantidadFlashcards + cantidadQuiz) === 0 ? '#333' : temaColor, color: cargandoConfig || (cantidadFlashcards + cantidadQuiz) === 0 ? '#666' : '#000', fontSize: '16px', fontWeight: 800, cursor: cargandoConfig || (cantidadFlashcards + cantidadQuiz) === 0 ? 'not-allowed' : 'pointer' }}>
            {cargandoConfig
              ? (idioma === 'en' ? '⏳ Generating exam...' : '⏳ Generando examen...')
              : `🎓 ${idioma === 'en' ? 'Start Exam' : 'Iniciar Examen'}`}
          </button>
        </div>
      </div>
    );
  }

  // ===== EXAMEN =====
  if (fase === 'examen' && preguntaActual) {
    const esEscrita = preguntaActual.tipo === 'escrita';
    const esOpcion = preguntaActual.tipo === 'opcion_multiple';

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 3000 }}>

        {/* Header */}
        <div style={{ padding: '12px 20px', background: '#1a1a2e', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 800, color: '#fff', margin: 0 }}>
              🎓 {idioma === 'en' ? 'Exam Mode' : 'Modo Examen'}
            </h2>
            <span style={{ fontSize: '11px', color: '#888' }}>
              {idxActual + 1}/{preguntas.length} · ✅ {stats.correctas} ❌ {stats.incorrectas}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', background: esEscrita ? temaColor + '20' : '#a78bfa20', color: esEscrita ? temaColor : '#a78bfa', padding: '3px 10px', borderRadius: '6px', fontWeight: 700 }}>
              {esEscrita ? '✍️' : '🎯'} {esEscrita ? (idioma === 'en' ? 'Written' : 'Escrita') : (idioma === 'en' ? 'Multiple choice' : 'Opción múltiple')}
            </span>
            <button onClick={() => setFase('fin')}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #444', background: 'transparent', color: '#aaa', fontSize: '12px', cursor: 'pointer' }}>
              {idioma === 'en' ? 'Finish' : 'Terminar'}
            </button>
          </div>
        </div>

        {/* Progreso */}
        <div style={{ height: '4px', background: '#1a1a2e', flexShrink: 0 }}>
          <div style={{ width: `${progreso}%`, height: '100%', background: temaColor, transition: 'width 0.4s' }} />
        </div>

        {/* Indicadores */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', padding: '6px', background: '#111', flexShrink: 0, flexWrap: 'wrap' }}>
          {preguntas.map((p, i) => (
            <div key={i} style={{
              width: i === idxActual ? '20px' : '8px',
              height: '8px',
              borderRadius: '4px',
              flexShrink: 0,
              transition: 'all 0.3s',
              background: i < idxActual
                ? (resultadosDetalle[i]?.correcto ? '#4ade80' : '#ff4d6d')
                : i === idxActual
                  ? temaColor
                  : p.tipo === 'escrita' ? temaColor + '44' : '#a78bfa44',
            }} />
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflow: 'auto' }}>
          <div style={{ maxWidth: '680px', width: '100%' }}>

            {/* Pregunta */}
            <div style={{ background: '#0d0d1a', borderRadius: '18px', border: `2px solid ${esEscrita ? temaColor : '#a78bfa'}44`, overflow: 'hidden', marginBottom: '16px' }}>
              <div style={{ height: '4px', background: esEscrita ? temaColor : '#a78bfa' }} />
              <div style={{ padding: '22px' }}>
                <p style={{ fontSize: '11px', color: esEscrita ? temaColor : '#a78bfa', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', margin: '0 0 10px' }}>
                  {esEscrita ? (idioma === 'en' ? '✍️ Write your answer' : '✍️ Escribe tu respuesta') : (idioma === 'en' ? '🎯 Choose the correct option' : '🎯 Elige la opción correcta')}
                </p>
                <h3 style={{ fontSize: '19px', fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.5 }}>
                  {esEscrita ? preguntaActual.pregunta : preguntaActual.enunciado}
                </h3>
              </div>
            </div>

            {/* ===== ESCRITA ===== */}
            {esEscrita && !respondida && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <textarea
                  value={respuestaEscrita}
                  onChange={e => setRespuestaEscrita(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) evaluarEscrita(); }}
                  placeholder={idioma === 'en' ? 'Write your answer... (Cmd+Enter to evaluate)' : 'Escribe tu respuesta... (Cmd+Enter para evaluar)'}
                  autoFocus
                  style={{ width: '100%', minHeight: '100px', padding: '16px', borderRadius: '12px', border: `2px solid ${respuestaEscrita ? temaColor : '#333'}`, background: '#0d0d1a', color: '#fff', fontSize: '15px', fontFamily: 'inherit', lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' }}
                />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={evaluarEscrita} disabled={!respuestaEscrita.trim() || evaluando}
                    style={{ flex: 1, padding: '13px', borderRadius: '12px', border: 'none', background: respuestaEscrita.trim() && !evaluando ? temaColor : '#333', color: respuestaEscrita.trim() && !evaluando ? '#000' : '#666', fontSize: '14px', fontWeight: 800, cursor: respuestaEscrita.trim() && !evaluando ? 'pointer' : 'not-allowed' }}>
                    {evaluando ? '⏳ ...' : (idioma === 'en' ? '🧠 Evaluate' : '🧠 Evaluar')}
                  </button>
                  <button onClick={() => setMostrarRespuesta(!mostrarRespuesta)}
                    style={{ padding: '13px 16px', borderRadius: '12px', border: '2px solid #333', background: 'transparent', color: '#888', fontSize: '14px', cursor: 'pointer' }}>
                    {mostrarRespuesta ? '🙈' : '👁️'}
                  </button>
                </div>
                {mostrarRespuesta && (
                  <div style={{ background: '#f5c84215', border: '1px solid #f5c84244', borderRadius: '10px', padding: '12px 14px' }}>
                    <p style={{ fontSize: '10px', color: '#f5c842', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase' }}>{idioma === 'en' ? 'Answer' : 'Respuesta'}</p>
                    <p style={{ fontSize: '14px', color: '#fff', margin: 0 }}>{preguntaActual.respuestaCorrecta}</p>
                  </div>
                )}
              </div>
            )}

            {/* Resultado escrita */}
            {esEscrita && respondida && resultadoEscrito && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ background: NIVEL_INFO[resultadoEscrito.nivel].bg, border: `2px solid ${NIVEL_INFO[resultadoEscrito.nivel].color}`, borderRadius: '14px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: '32px' }}>{NIVEL_INFO[resultadoEscrito.nivel].emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '16px', fontWeight: 900, color: '#fff' }}>{NIVEL_INFO[resultadoEscrito.nivel].label}</div>
                    <div style={{ fontSize: '12px', color: '#aaa' }}>{resultadoEscrito.porcentaje}% {idioma === 'en' ? 'correct' : 'correcto'}</div>
                  </div>
                  <div style={{ width: '80px', background: '#1a1a2e', borderRadius: '6px', height: '8px', overflow: 'hidden' }}>
                    <div style={{ width: `${resultadoEscrito.porcentaje}%`, height: '100%', background: NIVEL_INFO[resultadoEscrito.nivel].color, transition: 'width 1s' }} />
                  </div>
                </div>

                <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                  <p style={{ fontSize: '10px', color: '#555', fontWeight: 700, margin: '0 0 3px', textTransform: 'uppercase' }}>{idioma === 'en' ? 'Your answer' : 'Tu respuesta'}</p>
                  <p style={{ fontSize: '13px', color: '#ccc', margin: 0 }}>{respuestaEscrita}</p>
                </div>

                <div style={{ background: '#4ade8015', borderRadius: '10px', padding: '12px 14px', border: '1px solid #4ade8044' }}>
                  <p style={{ fontSize: '10px', color: '#4ade80', fontWeight: 700, margin: '0 0 3px', textTransform: 'uppercase' }}>{idioma === 'en' ? 'Correct answer' : 'Respuesta correcta'}</p>
                  <p style={{ fontSize: '13px', color: '#fff', margin: 0 }}>{preguntaActual.respuestaCorrecta}</p>
                </div>

                <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                  <p style={{ fontSize: '10px', color: temaColor, fontWeight: 700, margin: '0 0 3px', textTransform: 'uppercase' }}>💡 {idioma === 'en' ? 'Explanation' : 'Explicación'}</p>
                  <p style={{ fontSize: '12px', color: '#ccc', margin: 0 }}>{resultadoEscrito.explicacion}</p>
                </div>

                <button onClick={siguiente}
                  style={{ padding: '13px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                  {idxActual + 1 >= preguntas.length ? (idioma === 'en' ? '🎉 See results' : '🎉 Ver resultados') : (idioma === 'en' ? 'Next →' : 'Siguiente →')}
                </button>
              </div>
            )}

            {/* ===== OPCIÓN MÚLTIPLE ===== */}
            {esOpcion && (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                  {preguntaActual.opciones?.map((opcion, i) => {
                    let borderColor = '#333';
                    let bgColor = 'transparent';
                    let textColor = '#fff';

                    if (respondida) {
                      if (i === preguntaActual.correcta) { borderColor = '#4ade80'; bgColor = 'rgba(74,222,128,0.12)'; }
                      else if (i === opcionSeleccionada) { borderColor = '#ff4d6d'; bgColor = 'rgba(255,77,109,0.12)'; textColor = '#ff4d6d'; }
                      else { borderColor = '#222'; textColor = '#555'; }
                    }

                    return (
                      <button key={`${idxActual}-${i}`}
                        onClick={() => responderOpcion(i)}
                        disabled={respondida}
                        style={{ padding: '14px 18px', borderRadius: '12px', border: `2px solid ${borderColor}`, background: bgColor, color: textColor, fontSize: '14px', fontWeight: 500, cursor: respondida ? 'default' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px', width: '100%', transition: 'all 0.15s' }}>
                        <span style={{
                          width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                          border: `2px solid ${respondida && i === preguntaActual.correcta ? '#4ade80' : respondida && i === opcionSeleccionada ? '#ff4d6d' : '#555'}`,
                          background: respondida && i === preguntaActual.correcta ? '#4ade80' : respondida && i === opcionSeleccionada ? '#ff4d6d' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '12px', fontWeight: 800,
                          color: respondida && (i === preguntaActual.correcta || i === opcionSeleccionada) ? '#000' : '#aaa',
                        }}>
                          {respondida && i === preguntaActual.correcta ? '✓' : respondida && i === opcionSeleccionada ? '✗' : ['A', 'B', 'C', 'D'][i]}
                        </span>
                        <span style={{ flex: 1 }}>{opcion}</span>
                      </button>
                    );
                  })}
                </div>

                {respondida && (
                  <>
                    <div style={{ background: opcionSeleccionada === preguntaActual.correcta ? 'rgba(74,222,128,0.1)' : 'rgba(255,77,109,0.1)', border: `2px solid ${opcionSeleccionada === preguntaActual.correcta ? '#4ade8066' : '#ff4d6d66'}`, borderRadius: '12px', padding: '12px 16px', marginBottom: '12px' }}>
                      <p style={{ fontSize: '13px', fontWeight: 800, color: opcionSeleccionada === preguntaActual.correcta ? '#4ade80' : '#ff4d6d', margin: '0 0 6px' }}>
                        {opcionSeleccionada === preguntaActual.correcta ? '✅ ' + (idioma === 'en' ? 'Correct!' : '¡Correcto!') : '❌ ' + (idioma === 'en' ? 'Incorrect' : 'Incorrecto')}
                      </p>
                      <p style={{ fontSize: '13px', color: '#ccc', margin: 0, lineHeight: 1.5 }}><MathText text={preguntaActual.explicacion || ""} /></p>
                    </div>
                    <button onClick={siguiente}
                      style={{ width: '100%', padding: '13px', borderRadius: '12px', border: 'none', background: '#a78bfa', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                      {idxActual + 1 >= preguntas.length ? (idioma === 'en' ? '🎉 See results' : '🎉 Ver resultados') : (idioma === 'en' ? 'Next →' : 'Siguiente →')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===== FIN =====
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '24px', overflowY: 'auto' }}>
      <div style={{ maxWidth: '580px', width: '100%', textAlign: 'center', paddingTop: '20px', paddingBottom: '20px' }}>
        <div style={{ fontSize: '60px', marginBottom: '12px' }}>{porcentajeFinal >= 80 ? '🏆' : porcentajeFinal >= 60 ? '👍' : '📚'}</div>
        <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#fff', margin: '0 0 6px' }}>
          {idioma === 'en' ? 'Exam completed!' : '¡Examen completado!'}
        </h2>
        <p style={{ color: '#888', margin: '0 0 4px', fontSize: '14px' }}>📄 {nombreDoc}</p>
        <p style={{ color: '#666', margin: '0 0 20px', fontSize: '13px' }}>
          {preguntas.filter(p => p.tipo === 'escrita').length} {idioma === 'en' ? 'written' : 'escritas'} + {preguntas.filter(p => p.tipo === 'opcion_multiple').length} {idioma === 'en' ? 'multiple choice' : 'opción múltiple'}
        </p>

        {/* Score */}
        <div style={{ background: '#0d0d1a', borderRadius: '16px', padding: '24px', marginBottom: '20px', border: `1px solid ${temaColor}44` }}>
          <div style={{ fontSize: '52px', fontWeight: 900, color: temaColor, lineHeight: 1 }}>{porcentajeFinal}%</div>
          <div style={{ color: '#888', fontSize: '13px', marginTop: '4px' }}>
            {stats.correctas} / {preguntas.length} {idioma === 'en' ? 'correct' : 'correctas'}
          </div>
          <div style={{ background: '#1a1a2e', borderRadius: '8px', height: '10px', overflow: 'hidden', marginTop: '14px' }}>
            <div style={{ width: `${porcentajeFinal}%`, height: '100%', background: porcentajeFinal >= 80 ? '#4ade80' : porcentajeFinal >= 60 ? temaColor : '#ff4d6d', borderRadius: '8px', transition: 'width 1s' }} />
          </div>
          <p style={{ fontSize: '13px', color: porcentajeFinal >= 80 ? '#4ade80' : porcentajeFinal >= 60 ? temaColor : '#ff4d6d', margin: '12px 0 0', fontWeight: 700 }}>
            {porcentajeFinal >= 80
              ? (idioma === 'en' ? '🔥 Excellent! You are ready!' : '🔥 ¡Excelente! ¡Estás listo!')
              : porcentajeFinal >= 60
                ? (idioma === 'en' ? '💪 Good, keep studying!' : '💪 ¡Bien, sigue estudiando!')
                : (idioma === 'en' ? '📖 Review the document and try again' : '📖 Repasa el documento e intenta de nuevo')}
          </p>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
          <div style={{ background: '#4ade8020', border: '1px solid #4ade8044', borderRadius: '12px', padding: '14px' }}>
            <div style={{ fontSize: '28px', fontWeight: 900, color: '#4ade80' }}>{stats.correctas}</div>
            <div style={{ fontSize: '12px', color: '#888' }}>{idioma === 'en' ? 'Correct' : 'Correctas'}</div>
          </div>
          <div style={{ background: '#ff4d6d20', border: '1px solid #ff4d6d44', borderRadius: '12px', padding: '14px' }}>
            <div style={{ fontSize: '28px', fontWeight: 900, color: '#ff4d6d' }}>{stats.incorrectas}</div>
            <div style={{ fontSize: '12px', color: '#888' }}>{idioma === 'en' ? 'Incorrect' : 'Incorrectas'}</div>
          </div>
        </div>

        {/* Detalle por pregunta */}
        <div style={{ background: '#0d0d1a', borderRadius: '14px', padding: '16px', marginBottom: '20px', border: '1px solid #333', maxHeight: '220px', overflowY: 'auto', textAlign: 'left' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', margin: '0 0 10px' }}>
            {idioma === 'en' ? 'Question by question' : 'Pregunta por pregunta'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {resultadosDetalle.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', background: r.correcto ? 'rgba(74,222,128,0.05)' : 'rgba(255,77,109,0.05)', borderRadius: '8px', border: `1px solid ${r.correcto ? '#4ade8022' : '#ff4d6d22'}` }}>
                <span style={{ fontSize: '13px', flexShrink: 0 }}>{r.correcto ? '✅' : '❌'}</span>
                <span style={{ fontSize: '10px', background: r.tipo === 'escrita' ? temaColor + '20' : '#a78bfa20', color: r.tipo === 'escrita' ? temaColor : '#a78bfa', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, flexShrink: 0, alignSelf: 'flex-start', marginTop: '1px' }}>
                  {r.tipo === 'escrita' ? '✍️' : '🎯'}
                </span>
                <p style={{ fontSize: '12px', color: '#ccc', margin: 0, lineHeight: 1.4, flex: 1 }}>
                  {r.pregunta.length > 80 ? r.pregunta.substring(0, 80) + '...' : r.pregunta}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button onClick={() => setFase('config')}
            style={{ padding: '13px 24px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
            🔄 {idioma === 'en' ? 'Retry' : 'Repetir'}
          </button>
          <button onClick={onClose}
            style={{ padding: '13px 24px', borderRadius: '12px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
            {idioma === 'en' ? 'Close' : 'Cerrar'}
          </button>
        </div>
      </div>
    </div>
  );
}