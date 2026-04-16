'use client';

import { useState } from 'react';
import { registrarEstudioHoy } from '../../lib/racha';
import { guardarQuiz, getQuizzesGuardados, eliminarQuizGuardado, QuizGuardado } from '../../lib/quizStorage';
import { useIdioma } from '../../hooks/useIdioma';
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
  const [cantidad, setCantidad] = useState(5);
  const [cantidadPersonalizada, setCantidadPersonalizada] = useState(5);
  const [cargando, setCargando] = useState(false);
  const [idx, setIdx] = useState(0);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [respondida, setRespondida] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [resultados, setResultados] = useState<{ correcta: boolean; seleccionada: number }[]>([]);
  const [nombreQuiz, setNombreQuiz] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [guardadoExito, setGuardadoExito] = useState(false);
  const [quizzesGuardados, setQuizzesGuardados] = useState<QuizGuardado[]>(() => getQuizzesGuardados());
  const [quizSeleccionado, setQuizSeleccionado] = useState<QuizGuardado | null>(null);

  const generarQuiz = async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contenido, count: cantidad, idioma: getIdioma() }),
      });
      const data = await res.json();
      if (data.success && data.quiz.length > 0) {
        setPreguntas(data.quiz);
        setIdx(0); setSeleccionada(null); setRespondida(false);
        setPuntos(0); setResultados([]); setGuardadoExito(false);
        setFase('quiz');
      }
    } catch (err) { console.error(err); }
    finally { setCargando(false); }
  };

  const cargarQuizGuardado = (quiz: QuizGuardado) => {
    setPreguntas(quiz.preguntas);
    setIdx(0); setSeleccionada(null); setRespondida(false);
    setPuntos(0); setResultados([]); setGuardadoExito(false);
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
      // ✅ Registrar quiz en perfil al terminar
      const porcentajeFinal = preguntas.length > 0 ? Math.round((puntos / preguntas.length) * 100) : 0;
      try {
        const materiaId = materiaNombre?.toLowerCase().replace(/\s+/g, '_') || 'sin_materia';
        import('../../lib/storage').then(({ registrarQuiz }) => {
          registrarQuiz(
            materiaId,
            materiaNombre || 'Quiz',
            materiaColor || '#f5c842',
            porcentajeFinal,
          );
        });
      } catch {}
      setFase('fin');
    } else {
      setIdx(i => i + 1);
      setSeleccionada(null);
      setRespondida(false);
    }
  };

  const handleGuardarQuiz = () => {
    if (!nombreQuiz.trim()) return;
    setGuardando(true);
    guardarQuiz({ nombre: nombreQuiz, preguntas, materiaNombre, materiaColor });
    setQuizzesGuardados(getQuizzesGuardados());
    setGuardando(false); setGuardadoExito(true); setNombreQuiz('');
  };

  const handleEliminarGuardado = (id: string) => {
    if (!confirm(idioma === 'en' ? 'Delete this quiz?' : '¿Eliminar este quiz guardado?')) return;
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000, fontFamily: '-apple-system, sans-serif' }}>

      <div style={{ padding: '14px 24px', background: '#1a1a2e', borderBottom: `3px solid ${temaColor}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', margin: 0 }}>🤓 {tr('quizzes')}</h2>
          {fase === 'quiz' && (
            <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
              {idioma === 'en' ? 'Question' : 'Pregunta'} {idx + 1} / {preguntas.length} · {puntos} {idioma === 'en' ? 'correct' : 'correctas'}
              {quizSeleccionado && <span style={{ color: temaColor }}> · {quizSeleccionado.nombre}</span>}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {quizzesGuardados.length > 0 && fase === 'config' && (
            <button onClick={() => setFase('guardados')}
              style={{ padding: '8px 14px', borderRadius: '8px', border: `2px solid ${temaColor}`, background: 'transparent', color: temaColor, fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              📂 {idioma === 'en' ? 'My quizzes' : 'Mis quizzes'} ({quizzesGuardados.length})
            </button>
          )}
          {fase === 'guardados' && (
            <button onClick={() => setFase('config')}
              style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              ← {tr('volver')}
            </button>
          )}
          <button onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            ✕ {tr('cerrar')}
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
              <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#fff', margin: '0 0 20px' }}>
                📂 {idioma === 'en' ? 'My saved quizzes' : 'Mis quizzes guardados'}
              </h3>
              {quizzesGuardados.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
                  <p style={{ color: '#666' }}>{tr('sinQuizzes')}</p>
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
                            {quiz.preguntas.length} {tr('preguntas').toLowerCase()} · {quiz.fechaCreacion}
                            {quiz.materiaNombre && <span style={{ color: quiz.materiaColor || temaColor }}> · {quiz.materiaNombre}</span>}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => cargarQuizGuardado(quiz)}
                            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: quiz.materiaColor || temaColor, color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                            ▶ {tr('jugar')}
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
              <div style={{ fontSize: '72px', marginBottom: '16px' }}>🤓</div>
              <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#fff', margin: '0 0 8px' }}>
                {tr('quizOpcionMultiple')}
              </h2>
              <p style={{ color: '#888', marginBottom: '36px', fontSize: '14px' }}>
                {idioma === 'en' ? '4 options · AI generates wrong ones from the document' : '4 opciones · La AI genera las incorrectas desde el documento'}
              </p>

              <div style={{ background: '#0d0d1a', borderRadius: '20px', padding: '28px', border: '1px solid #333', marginBottom: '24px', textAlign: 'left' }}>
                <p style={{ fontSize: '13px', fontWeight: 700, color: '#888', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  {tr('cuantasPreguntas')}
                </p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {[3, 5, 8, 10, 15, 20].map(n => (
                    <button key={n} onClick={() => { setCantidad(n); setCantidadPersonalizada(n); }}
                      style={{ padding: '10px 18px', borderRadius: '10px', border: `2px solid ${cantidad === n ? temaColor : '#333'}`, background: cantidad === n ? temaColor + '20' : 'transparent', color: cantidad === n ? temaColor : '#888', fontSize: '14px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
                      {n}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '13px', color: '#555' }}>{tr('personalizado')}</span>
                  <input type="number" min={1} max={30} value={cantidadPersonalizada}
                    onChange={e => { const val = Math.min(30, Math.max(1, parseInt(e.target.value) || 1)); setCantidadPersonalizada(val); setCantidad(val); }}
                    style={{ width: '80px', padding: '8px 12px', borderRadius: '8px', border: '2px solid #333', background: '#111', color: '#fff', fontSize: '14px', fontWeight: 700, textAlign: 'center', outline: 'none' }} />
                  <span style={{ fontSize: '13px', color: '#555' }}>{tr('preguntas').toLowerCase()}</span>
                </div>
                <div style={{ padding: '12px 16px', background: '#111', borderRadius: '10px', border: '1px solid #222' }}>
                  <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>
                    {idioma === 'en' ? `${cantidad} questions will be generated based on the document` : `Se generarán ${cantidad} preguntas basadas en el documento`}
                  </p>
                </div>
              </div>

              <button onClick={generarQuiz} disabled={cargando}
                style={{ width: '100%', padding: '18px', borderRadius: '14px', border: 'none', background: cargando ? '#333' : temaColor, color: cargando ? '#666' : '#000', fontSize: '16px', fontWeight: 800, cursor: cargando ? 'not-allowed' : 'pointer' }}>
                {cargando ? tr('generandoQuiz') : `🚀 ${tr('iniciarQuiz')} ${cantidad}`}
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
                  <span style={{ fontSize: '11px', color: temaColor, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px' }}>
                    {idioma === 'en' ? 'Question' : 'Pregunta'} {idx + 1} / {preguntas.length}
                  </span>
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: '12px 0 0', lineHeight: 1.5 }}>
                    {preguntaActual.pregunta}
                  </h3>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {preguntaActual.opciones.map((opcion, i) => {
                  const s = getOpcionStyle(i);
                  const ls = getLetraStyle(i);
                  return (
                    <button key={`${idx}-${i}`} onClick={() => responder(i)} disabled={respondida}
                      style={{ padding: '16px 20px', borderRadius: '14px', border: s.border, background: s.background, color: s.color, fontSize: '15px', fontWeight: 500, cursor: respondida ? 'default' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '14px', lineHeight: 1.4, width: '100%' }}>
                      <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: ls.background, border: ls.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, color: ls.color, flexShrink: 0 }}>
                        {getLetra(i)}
                      </span>
                      <span style={{ flex: 1, color: '#fff' }}>{opcion}</span>
                    </button>
                  );
                })}
              </div>

              {respondida && (
                <>
                  <div style={{ background: seleccionada === preguntaActual.correcta ? 'rgba(74,222,128,0.1)' : 'rgba(255,77,109,0.1)', border: `2px solid ${seleccionada === preguntaActual.correcta ? '#4ade8066' : '#ff4d6d66'}`, borderRadius: '14px', padding: '16px 20px', marginBottom: '16px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 800, color: '#fff', margin: '0 0 8px' }}>
                      {seleccionada === preguntaActual.correcta ? tr('correcto') : tr('incorrecto')}
                    </p>
                    <p style={{ fontSize: '14px', color: '#ccc', margin: 0, lineHeight: 1.6 }}>{preguntaActual.explicacion}</p>
                  </div>
                  <button onClick={siguiente}
                    style={{ width: '100%', padding: '16px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                    {idx + 1 >= preguntas.length ? tr('verResultados') : `${tr('siguiente')} →`}
                  </button>
                </>
              )}
            </div>
          )}

          {/* FIN */}
          {fase === 'fin' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '64px', marginBottom: '16px' }}>
                {porcentaje >= 80 ? '🏆' : porcentaje >= 60 ? '👍' : '📚'}
              </div>
              <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#fff', margin: '0 0 8px' }}>
                {idioma === 'en' ? 'Quiz completed!' : '¡Quiz completado!'}
              </h2>
              <p style={{ color: '#888', marginBottom: '28px' }}>
                {puntos} {idioma === 'en' ? 'of' : 'de'} {preguntas.length} {idioma === 'en' ? 'correct' : 'correctas'}
              </p>

              <div style={{ background: '#0d0d1a', borderRadius: '20px', padding: '28px', border: `2px solid ${temaColor}44`, marginBottom: '24px' }}>
                <div style={{ fontSize: '60px', fontWeight: 900, color: temaColor, lineHeight: 1 }}>{puntos}/{preguntas.length}</div>
                <div style={{ fontSize: '36px', fontWeight: 900, color: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d', marginTop: '8px' }}>{porcentaje}%</div>
                <div style={{ color: '#888', fontSize: '14px', marginTop: '8px' }}>
                  {porcentaje >= 80
                    ? (idioma === 'en' ? 'Excellent! 🔥' : '¡Excelente! 🔥')
                    : porcentaje >= 60
                      ? (idioma === 'en' ? 'Good, keep going 💪' : 'Bien, sigue 💪')
                      : (idioma === 'en' ? 'Study more 📖' : 'Repasa más 📖')}
                </div>
                <div style={{ background: '#1a1a2e', borderRadius: '10px', height: '12px', overflow: 'hidden', marginTop: '20px' }}>
                  <div style={{ width: `${porcentaje}%`, height: '100%', background: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d', borderRadius: '10px', transition: 'width 1s ease' }} />
                </div>
              </div>

              {/* Guardar quiz */}
              <div style={{ background: '#0d0d1a', borderRadius: '16px', padding: '20px', border: `1px solid ${temaColor}44`, marginBottom: '24px', textAlign: 'left' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 800, color: temaColor, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  💾 {idioma === 'en' ? 'Save this quiz to repeat it' : 'Guardar este quiz para repetirlo'}
                </h3>
                {guardadoExito ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: '#4ade8015', borderRadius: '10px', border: '1px solid #4ade8044' }}>
                    <span>✅</span>
                    <p style={{ fontSize: '13px', color: '#4ade80', margin: 0, fontWeight: 600 }}>{tr('quizGuardado')}</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input type="text" value={nombreQuiz} onChange={e => setNombreQuiz(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleGuardarQuiz()}
                      placeholder={idioma === 'en' ? 'Quiz name... e.g. Topic 1' : 'Nombre del quiz... ej: Tema 1'}
                      style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '2px solid #333', background: '#111', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
                      onFocus={e => e.currentTarget.style.borderColor = temaColor}
                      onBlur={e => e.currentTarget.style.borderColor = '#333'}
                    />
                    <button onClick={handleGuardarQuiz} disabled={!nombreQuiz.trim() || guardando}
                      style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: nombreQuiz.trim() ? temaColor : '#333', color: nombreQuiz.trim() ? '#000' : '#555', fontWeight: 800, fontSize: '13px', cursor: nombreQuiz.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                      {tr('guardarQuiz')}
                    </button>
                  </div>
                )}
              </div>

              <div style={{ background: '#0d0d1a', borderRadius: '16px', padding: '20px', border: '1px solid #333', marginBottom: '24px', textAlign: 'left', maxHeight: '250px', overflowY: 'auto' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 14px' }}>
                  {idioma === 'en' ? 'Question by question' : 'Detalle pregunta por pregunta'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {preguntas.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 12px', background: resultados[i]?.correcta ? 'rgba(74,222,128,0.05)' : 'rgba(255,77,109,0.05)', borderRadius: '8px', border: `1px solid ${resultados[i]?.correcta ? '#4ade8022' : '#ff4d6d22'}` }}>
                      <span style={{ fontSize: '14px', flexShrink: 0 }}>{resultados[i]?.correcta ? '✅' : '❌'}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: '13px', color: '#ccc', margin: '0 0 2px', lineHeight: 1.4 }}>{p.pregunta}</p>
                        {!resultados[i]?.correcta && (
                          <p style={{ fontSize: '11px', color: '#4ade80', margin: 0 }}>✓ {p.opciones[p.correcta]}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button onClick={reiniciar}
                  style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                  🔄 {idioma === 'en' ? 'New quiz' : 'Nuevo quiz'}
                </button>
                {quizzesGuardados.length > 0 && (
                  <button onClick={() => setFase('guardados')}
                    style={{ padding: '14px 28px', borderRadius: '12px', border: `2px solid ${temaColor}`, background: 'transparent', color: temaColor, fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
                    📂 {idioma === 'en' ? 'My quizzes' : 'Mis quizzes'}
                  </button>
                )}
                <button onClick={onClose}
                  style={{ padding: '14px 28px', borderRadius: '12px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
                  {tr('cerrar')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}