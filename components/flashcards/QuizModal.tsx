'use client';

import { useState } from 'react';
import { registrarEstudioHoy } from '../../lib/racha';
import { guardarQuiz, guardarQuizTemporal, getQuizzesGuardados, eliminarQuizGuardado, QuizGuardado, NivelQuiz } from '../../lib/quizStorage';
import { useIdioma } from '../../hooks/useIdioma';
import AIExhausted from '../../components/AIExhausted';
import { getIdioma } from '../../lib/i18n';

interface PreguntaQuiz {
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
}

interface Props {
  contenido: string;
  temaColor: string;
  onClose: () => void;
  materiaNombre?: string;
  materiaColor?: string;
}

export default function QuizModal({ contenido, temaColor, onClose, materiaNombre, materiaColor }: Props) {
  const { tr, idioma } = useIdioma();

  const [fase, setFase] = useState<'config' | 'quiz' | 'fin' | 'guardados'>('config');
  const [preguntas, setPreguntas] = useState<PreguntaQuiz[]>([]);
  const [cantidad, setCantidad] = useState(10);
  const [cantidadPersonalizada, setCantidadPersonalizada] = useState(10);
  const [nivel, setNivel] = useState<NivelQuiz>('intermedio');
  const [cargando, setCargando] = useState(false);
  const [idx, setIdx] = useState(0);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [respondida, setRespondida] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [resultados, setResultados] = useState<{ correcta: boolean; seleccionada: number }[]>([]);
  const [nombreQuiz, setNombreQuiz] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [guardadoExito, setGuardadoExito] = useState(false);
  const [guardadoTemporal, setGuardadoTemporal] = useState(false);
  const [aiExhausted, setAiExhausted] = useState(false);
  const [quizzesGuardados, setQuizzesGuardados] = useState<QuizGuardado[]>(() => getQuizzesGuardados());
  const [quizSeleccionado, setQuizSeleccionado] = useState<QuizGuardado | null>(null);

  const generarQuiz = async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contenido, count: cantidad, idioma: getIdioma(), nivel }),
      });
      const data = await res.json();
      if (data.success && data.quiz.length > 0) {
        setPreguntas(data.quiz);
        setIdx(0); setSeleccionada(null); setRespondida(false);
        setPuntos(0); setResultados([]); setGuardadoExito(false); setGuardadoTemporal(false);
        setFase('quiz');
      }
    } catch (err: any) {
      if (err?.message === 'AI_EXHAUSTED' || err?.message?.includes('All providers')) setAiExhausted(true);
      console.error(err);
    } finally { setCargando(false); }
  };

  const cargarQuizGuardado = (quiz: QuizGuardado) => {
    setPreguntas(quiz.preguntas);
    setIdx(0); setSeleccionada(null); setRespondida(false);
    setPuntos(0); setResultados([]); setGuardadoExito(false); setGuardadoTemporal(false);
    setFase('quiz'); setQuizSeleccionado(quiz);
  };

  const responder = (opcionIdx: number) => {
    if (respondida) return;
    setSeleccionada(opcionIdx);
    setRespondida(true);
    const esCorrecta = opcionIdx === preguntas[idx].correcta;
    if (esCorrecta) setPuntos(p => p + 1);
    setResultados(prev => [...prev, { correcta: esCorrecta, seleccionada: opcionIdx }]);
    registrarEstudioHoy();
  };

  const siguiente = () => {
    if (idx + 1 >= preguntas.length) {
      const porcentajeFinal = preguntas.length > 0 ? Math.round((puntos / preguntas.length) * 100) : 0;
      try {
        const materiaId = materiaNombre?.toLowerCase().replace(/\s+/g, '_') || 'sin_materia';
        import('../../lib/storage').then(({ registrarQuiz }) => {
          registrarQuiz(materiaId, materiaNombre || 'Quiz', materiaColor || '#f5c842', porcentajeFinal);
        });
      } catch {}
      setFase('fin');
    } else {
      setIdx(i => i + 1);
      setSeleccionada(null);
      setRespondida(false);
    }
  };

  const handleGuardarPermanente = () => {
    if (!nombreQuiz.trim()) return;
    setGuardando(true);
    guardarQuiz({ nombre: nombreQuiz, preguntas, materiaNombre, materiaColor, nivel });
    setQuizzesGuardados(getQuizzesGuardados());
    setGuardando(false); setGuardadoExito(true); setNombreQuiz('');
  };

  const handleGuardarTemporal = () => {
    guardarQuizTemporal({
      nombre: materiaNombre ? `Quiz ${nivel} - ${materiaNombre}` : `Quiz ${nivel}`,
      preguntas, materiaNombre, materiaColor, nivel,
    });
    setGuardadoTemporal(true);
  };

  const handleEliminarGuardado = (id: string) => {
    if (!confirm(idioma === 'en' ? 'Delete this quiz?' : 'Eliminar este quiz guardado?')) return;
    eliminarQuizGuardado(id);
    setQuizzesGuardados(getQuizzesGuardados());
  };

  const reiniciar = () => {
    setFase('config'); setPreguntas([]); setIdx(0);
    setSeleccionada(null); setRespondida(false);
    setPuntos(0); setResultados([]); setQuizSeleccionado(null);
  };

  const preguntaActual = preguntas[idx];
  const progreso = preguntas.length > 0 ? (idx / preguntas.length) * 100 : 0;
  const porcentaje = preguntas.length > 0 ? Math.round((puntos / preguntas.length) * 100) : 0;

  const getOpcionStyle = (i: number) => {
    if (!respondida) return { border: '2px solid #333', background: 'transparent', color: '#fff' };
    if (i === preguntaActual.correcta) return { border: '2px solid #4ade80', background: 'rgba(74,222,128,0.12)', color: '#fff' };
    if (i === seleccionada) return { border: '2px solid #ff4d6d', background: 'rgba(255,77,109,0.12)', color: '#fff' };
    return { border: '2px solid #222', background: 'transparent', color: '#555' };
  };

  const getLetraStyle = (i: number) => {
    if (!respondida) return { background: 'transparent', border: '2px solid #555', color: '#fff' };
    if (i === preguntaActual.correcta) return { background: '#4ade80', border: '2px solid #4ade80', color: '#000' };
    if (i === seleccionada) return { background: '#ff4d6d', border: '2px solid #ff4d6d', color: '#000' };
    return { background: 'transparent', border: '2px solid #333', color: '#444' };
  };

  const getLetra = (i: number) => {
    if (!respondida) return ['A', 'B', 'C', 'D'][i];
    if (i === preguntaActual.correcta) return '✓';
    if (i === seleccionada) return '✗';
    return ['A', 'B', 'C', 'D'][i];
  };

  const NIVELES = [
    { id: 'facil' as NivelQuiz,      emoji: '🟢', label: 'Facil',      desc: 'Definiciones basicas',         color: '#4ade80', presets: [5, 10, 15, 20, 25, 35] },
    { id: 'intermedio' as NivelQuiz, emoji: '🟡', label: 'Intermedio', desc: 'Comprension y aplicacion',     color: '#f5c842', presets: [5, 10, 15, 20, 35, 50] },
    { id: 'dificil' as NivelQuiz,    emoji: '🔴', label: 'Dificil',    desc: 'Analisis y casos especiales',  color: '#ff4d6d', presets: [5, 10, 20, 35, 50] },
  ];

  const nivelActual = NIVELES.find(n => n.id === nivel) || NIVELES[1];

  return (
    <>
      {aiExhausted && <AIExhausted onClose={() => setAiExhausted(false)} />}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000, fontFamily: '-apple-system, sans-serif' }}>

        <div style={{ padding: '14px 24px', background: '#1a1a2e', borderBottom: `3px solid ${temaColor}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', margin: 0 }}>🤓 Quiz</h2>
            {fase === 'quiz' && (
              <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
                Pregunta {idx + 1} / {preguntas.length} · {puntos} correctas
                {quizSeleccionado && <span style={{ color: temaColor }}> · {quizSeleccionado.nombre}</span>}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {quizzesGuardados.length > 0 && fase === 'config' && (
              <button onClick={() => setFase('guardados')}
                style={{ padding: '8px 14px', borderRadius: '8px', border: `2px solid ${temaColor}`, background: 'transparent', color: temaColor, fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                📂 Mis quizzes ({quizzesGuardados.length})
              </button>
            )}
            {fase === 'guardados' && (
              <button onClick={() => setFase('config')}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ← Volver
              </button>
            )}
            <button onClick={onClose}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              ✕ Cerrar
            </button>
          </div>
        </div>

        {fase === 'quiz' && (
          <div style={{ height: '4px', background: '#1a1a2e', flexShrink: 0 }}>
            <div style={{ width: `${progreso}%`, height: '100%', background: temaColor, transition: 'width 0.4s ease' }} />
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', overflow: 'auto' }}>
          <div style={{ maxWidth: '640px', width: '100%' }}>

            {/* GUARDADOS */}
            {fase === 'guardados' && (
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#fff', margin: '0 0 20px' }}>📂 Mis quizzes guardados</h3>
                {quizzesGuardados.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
                    <p style={{ color: '#666' }}>Sin quizzes guardados</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {quizzesGuardados.map(quiz => (
                      <div key={quiz.id} style={{ background: '#0d0d1a', borderRadius: '16px', border: `1px solid ${quiz.materiaColor || temaColor}44`, overflow: 'hidden' }}>
                        <div style={{ height: '3px', background: quiz.materiaColor || temaColor }} />
                        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <h4 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: '0 0 4px' }}>{quiz.nombre}</h4>
                            <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
                              {quiz.preguntas.length} preguntas · {quiz.fechaCreacion}
                              {quiz.nivel && <span style={{ marginLeft: '6px', padding: '1px 6px', borderRadius: '4px', background: quiz.nivel === 'facil' ? '#4ade8022' : quiz.nivel === 'dificil' ? '#ff4d6d22' : '#f5c84222', color: quiz.nivel === 'facil' ? '#4ade80' : quiz.nivel === 'dificil' ? '#ff4d6d' : '#f5c842', fontSize: '11px', fontWeight: 700 }}>{quiz.nivel}</span>}
                              {quiz.materiaNombre && <span style={{ color: quiz.materiaColor || temaColor }}> · {quiz.materiaNombre}</span>}
                            </p>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => cargarQuizGuardado(quiz)}
                              style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: quiz.materiaColor || temaColor, color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                              ▶ Jugar
                            </button>
                            <button onClick={() => handleEliminarGuardado(quiz.id)}
                              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #ff4d6d44', background: 'transparent', color: '#ff4d6d', fontSize: '14px', cursor: 'pointer' }}>
                              🗑️
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* CONFIG */}
            {fase === 'config' && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '64px', marginBottom: '12px' }}>🤓</div>
                <h2 style={{ fontSize: '24px', fontWeight: 900, color: '#fff', margin: '0 0 6px' }}>Quiz de Opcion Multiple</h2>
                <p style={{ color: '#888', marginBottom: '28px', fontSize: '14px' }}>4 opciones · La IA genera las incorrectas desde el documento</p>

                {/* NIVEL */}
                <div style={{ background: '#0d0d1a', borderRadius: '20px', padding: '22px', border: '1px solid #333', marginBottom: '14px', textAlign: 'left' }}>
                  <p style={{ fontSize: '12px', fontWeight: 700, color: '#888', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '1px' }}>Nivel de dificultad</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                    {NIVELES.map(n => (
                      <button key={n.id} onClick={() => { setNivel(n.id); setCantidad(n.presets[1]); setCantidadPersonalizada(n.presets[1]); }}
                        style={{ padding: '14px 8px', borderRadius: '14px', border: `2px solid ${nivel === n.id ? n.color : '#333'}`, background: nivel === n.id ? n.color + '18' : 'transparent', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s' }}>
                        <div style={{ fontSize: '22px', marginBottom: '6px' }}>{n.emoji}</div>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: nivel === n.id ? n.color : '#fff', marginBottom: '4px' }}>{n.label}</div>
                        <div style={{ fontSize: '11px', color: '#666', lineHeight: 1.3 }}>{n.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* CANTIDAD */}
                <div style={{ background: '#0d0d1a', borderRadius: '20px', padding: '22px', border: '1px solid #333', marginBottom: '22px', textAlign: 'left' }}>
                  <p style={{ fontSize: '12px', fontWeight: 700, color: '#888', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '1px' }}>Cantidad de preguntas</p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    {nivelActual.presets.map(n => (
                      <button key={n} onClick={() => { setCantidad(n); setCantidadPersonalizada(n); }}
                        style={{ padding: '9px 16px', borderRadius: '10px', border: `2px solid ${cantidad === n ? temaColor : '#333'}`, background: cantidad === n ? temaColor + '20' : 'transparent', color: cantidad === n ? temaColor : '#888', fontSize: '14px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: '#111', borderRadius: '10px', border: '1px solid #222' }}>
                    <span style={{ fontSize: '12px', color: '#666', whiteSpace: 'nowrap' }}>Personalizado:</span>
                    <input type="number" min={1} max={100} value={cantidadPersonalizada}
                      onChange={e => { const val = Math.min(100, Math.max(1, parseInt(e.target.value) || 1)); setCantidadPersonalizada(val); setCantidad(val); }}
                      style={{ width: '65px', padding: '7px 10px', borderRadius: '8px', border: `2px solid ${temaColor}44`, background: '#1a1a2e', color: '#fff', fontSize: '15px', fontWeight: 700, textAlign: 'center', outline: 'none' }} />
                    <span style={{ fontSize: '12px', color: '#666' }}>max 100</span>
                  </div>
                  <p style={{ fontSize: '12px', color: '#555', margin: '10px 0 0' }}>
                    Se generaran <strong style={{ color: temaColor }}>{cantidad} preguntas</strong> · nivel <strong style={{ color: nivelActual.color }}>{nivelActual.label}</strong>
                  </p>
                </div>

                <button onClick={generarQuiz} disabled={cargando}
                  style={{ width: '100%', padding: '18px', borderRadius: '14px', border: 'none', background: cargando ? '#333' : temaColor, color: cargando ? '#666' : '#000', fontSize: '16px', fontWeight: 800, cursor: cargando ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
                  {cargando ? 'Generando quiz...' : `🚀 Iniciar Quiz · ${cantidad} preguntas`}
                </button>
              </div>
            )}

            {/* QUIZ */}
            {fase === 'quiz' && preguntaActual && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
                  {preguntas.map((_, i) => (
                    <div key={i} style={{ width: i === idx ? '24px' : '10px', height: '10px', borderRadius: '5px', background: i < idx ? (resultados[i]?.correcta ? '#4ade80' : '#ff4d6d') : i === idx ? temaColor : '#333', transition: 'all 0.3s', flexShrink: 0 }} />
                  ))}
                </div>

                <div style={{ background: '#0d0d1a', borderRadius: '20px', border: `2px solid ${temaColor}44`, overflow: 'hidden', marginBottom: '20px' }}>
                  <div style={{ height: '4px', background: temaColor }} />
                  <div style={{ padding: '24px' }}>
                    <span style={{ fontSize: '11px', color: temaColor, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px' }}>Pregunta {idx + 1} / {preguntas.length}</span>
                    <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: '12px 0 0', lineHeight: 1.5 }}>{preguntaActual.pregunta}</h3>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                  {preguntaActual.opciones.map((opcion, i) => {
                    const s = getOpcionStyle(i);
                    const ls = getLetraStyle(i);
                    return (
                      <button key={`${idx}-${i}`} onClick={() => responder(i)} disabled={respondida}
                        style={{ padding: '16px 20px', borderRadius: '14px', border: s.border, background: s.background, color: s.color, fontSize: '15px', fontWeight: 500, cursor: respondida ? 'default' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '14px', lineHeight: 1.4, width: '100%' }}>
                        <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: ls.background, border: ls.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, color: ls.color, flexShrink: 0 }}>{getLetra(i)}</span>
                        <span style={{ flex: 1, color: '#fff' }}>{opcion}</span>
                      </button>
                    );
                  })}
                </div>

                {respondida && (
                  <>
                    <div style={{ background: seleccionada === preguntaActual.correcta ? 'rgba(74,222,128,0.1)' : 'rgba(255,77,109,0.1)', border: `2px solid ${seleccionada === preguntaActual.correcta ? '#4ade8066' : '#ff4d6d66'}`, borderRadius: '14px', padding: '16px 20px', marginBottom: '16px' }}>
                      <p style={{ fontSize: '13px', fontWeight: 800, color: '#fff', margin: '0 0 8px' }}>{seleccionada === preguntaActual.correcta ? '✅ Correcto!' : '❌ Incorrecto'}</p>
                      <p style={{ fontSize: '14px', color: '#ccc', margin: 0, lineHeight: 1.6 }}>{preguntaActual.explicacion}</p>
                    </div>
                    <button onClick={siguiente}
                      style={{ width: '100%', padding: '16px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                      {idx + 1 >= preguntas.length ? 'Ver Resultados' : 'Siguiente →'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* FIN */}
            {fase === 'fin' && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '64px', marginBottom: '16px' }}>{porcentaje >= 80 ? '🏆' : porcentaje >= 60 ? '👍' : '📚'}</div>
                <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#fff', margin: '0 0 8px' }}>Quiz completado!</h2>
                <p style={{ color: '#888', marginBottom: '28px' }}>{puntos} de {preguntas.length} correctas</p>

                <div style={{ background: '#0d0d1a', borderRadius: '20px', padding: '28px', border: `2px solid ${temaColor}44`, marginBottom: '20px' }}>
                  <div style={{ fontSize: '60px', fontWeight: 900, color: temaColor, lineHeight: 1 }}>{puntos}/{preguntas.length}</div>
                  <div style={{ fontSize: '36px', fontWeight: 900, color: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d', marginTop: '8px' }}>{porcentaje}%</div>
                  <div style={{ color: '#888', fontSize: '14px', marginTop: '8px' }}>{porcentaje >= 80 ? 'Excelente! 🔥' : porcentaje >= 60 ? 'Bien, sigue 💪' : 'Repasa mas 📖'}</div>
                  <div style={{ background: '#1a1a2e', borderRadius: '10px', height: '12px', overflow: 'hidden', marginTop: '20px' }}>
                    <div style={{ width: `${porcentaje}%`, height: '100%', background: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d', borderRadius: '10px', transition: 'width 1s ease' }} />
                  </div>
                </div>

                {/* Guardar temporal (rapido, 24h) */}
                {!guardadoTemporal && !guardadoExito && (
                  <div style={{ background: '#0d0d1a', borderRadius: '14px', padding: '16px 20px', border: '1px solid #f5c84244', marginBottom: '14px', textAlign: 'left' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 800, color: '#f5c842', margin: '0 0 2px' }}>⏳ Guardar por 24 horas</p>
                        <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>Aparecera en "Por Guardar". Luego decides si lo pones en tu biblioteca.</p>
                      </div>
                      <button onClick={handleGuardarTemporal}
                        style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: '#f5c842', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Guardar 24h
                      </button>
                    </div>
                  </div>
                )}
                {guardadoTemporal && !guardadoExito && (
                  <div style={{ padding: '12px 16px', background: '#f5c84215', borderRadius: '10px', border: '1px solid #f5c84244', marginBottom: '14px' }}>
                    <p style={{ fontSize: '13px', color: '#f5c842', margin: 0, fontWeight: 600 }}>⏳ Guardado por 24h. Ve a "Por Guardar" en /quizzes para conservarlo.</p>
                  </div>
                )}

                {/* Guardar permanente */}
                <div style={{ background: '#0d0d1a', borderRadius: '14px', padding: '16px 20px', border: `1px solid ${temaColor}44`, marginBottom: '20px', textAlign: 'left' }}>
                  <p style={{ fontSize: '12px', fontWeight: 800, color: temaColor, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '1px' }}>💾 Guardar permanentemente</p>
                  {guardadoExito ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: '#4ade8015', borderRadius: '10px', border: '1px solid #4ade8044' }}>
                      <span>✅</span>
                      <p style={{ fontSize: '13px', color: '#4ade80', margin: 0, fontWeight: 600 }}>Quiz guardado en tu biblioteca!</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="text" value={nombreQuiz} onChange={e => setNombreQuiz(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleGuardarPermanente()}
                        placeholder="Nombre del quiz... ej: Tema 1"
                        style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '2px solid #333', background: '#111', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
                        onFocus={e => e.currentTarget.style.borderColor = temaColor}
                        onBlur={e => e.currentTarget.style.borderColor = '#333'} />
                      <button onClick={handleGuardarPermanente} disabled={!nombreQuiz.trim() || guardando}
                        style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: nombreQuiz.trim() ? temaColor : '#333', color: nombreQuiz.trim() ? '#000' : '#555', fontWeight: 800, fontSize: '13px', cursor: nombreQuiz.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                        Guardar
                      </button>
                    </div>
                  )}
                </div>

                {/* Detalle */}
                <div style={{ background: '#0d0d1a', borderRadius: '14px', padding: '18px', border: '1px solid #333', marginBottom: '20px', textAlign: 'left', maxHeight: '220px', overflowY: 'auto' }}>
                  <p style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>Detalle pregunta por pregunta</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {preguntas.map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 12px', background: resultados[i]?.correcta ? 'rgba(74,222,128,0.05)' : 'rgba(255,77,109,0.05)', borderRadius: '8px', border: `1px solid ${resultados[i]?.correcta ? '#4ade8022' : '#ff4d6d22'}` }}>
                        <span style={{ fontSize: '14px', flexShrink: 0 }}>{resultados[i]?.correcta ? '✅' : '❌'}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: '13px', color: '#ccc', margin: '0 0 2px', lineHeight: 1.4 }}>{p.pregunta}</p>
                          {!resultados[i]?.correcta && <p style={{ fontSize: '11px', color: '#4ade80', margin: 0 }}>✓ {p.opciones[p.correcta]}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button onClick={reiniciar} style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>🔄 Nuevo quiz</button>
                  <button onClick={() => window.location.href = '/quizzes'} style={{ padding: '14px 28px', borderRadius: '12px', border: `2px solid ${temaColor}`, background: 'transparent', color: temaColor, fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>📚 Mis quizzes</button>
                  <button onClick={onClose} style={{ padding: '14px 28px', borderRadius: '12px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>Cerrar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
