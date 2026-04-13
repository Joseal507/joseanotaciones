'use client';

import { useState } from 'react';

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
}

export default function QuizModal({ contenido, temaColor, onClose }: Props) {
  const [fase, setFase] = useState<'config' | 'quiz' | 'fin'>('config');
  const [preguntas, setPreguntas] = useState<PreguntaQuiz[]>([]);
  const [cantidad, setCantidad] = useState(5);
  const [cantidadPersonalizada, setCantidadPersonalizada] = useState(5);
  const [cargando, setCargando] = useState(false);
  const [idx, setIdx] = useState(0);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [respondida, setRespondida] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [resultados, setResultados] = useState<{ correcta: boolean; seleccionada: number }[]>([]);

  const generarQuiz = async () => {
    setCargando(true);
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contenido, count: cantidad }),
      });
      const data = await res.json();
      if (data.success && data.quiz.length > 0) {
        setPreguntas(data.quiz);
        setIdx(0);
        setSeleccionada(null);
        setRespondida(false);
        setPuntos(0);
        setResultados([]);
        setFase('quiz');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  };

  const responder = (opcionIdx: number) => {
    if (respondida) return;
    setSeleccionada(opcionIdx);
    setRespondida(true);
    const esCorrecta = opcionIdx === preguntas[idx].correcta;
    if (esCorrecta) setPuntos(p => p + 1);
    setResultados(prev => [...prev, { correcta: esCorrecta, seleccionada: opcionIdx }]);
  };

  const siguiente = () => {
    if (idx + 1 >= preguntas.length) {
      setFase('fin');
    } else {
      setIdx(i => i + 1);
      setSeleccionada(null);
      setRespondida(false);
    }
  };

  const reiniciar = () => {
    setFase('config');
    setPreguntas([]);
    setIdx(0);
    setSeleccionada(null);
    setRespondida(false);
    setPuntos(0);
    setResultados([]);
  };

  const preguntaActual = preguntas[idx];
  const progreso = preguntas.length > 0 ? (idx / preguntas.length) * 100 : 0;
  const porcentaje = preguntas.length > 0 ? Math.round((puntos / preguntas.length) * 100) : 0;

  // Estilos de las opciones
  const getOpcionStyle = (i: number) => {
    // Sin responder todavía
    if (!respondida) {
      return {
        border: '2px solid #333',
        background: 'transparent',
        color: '#ffffff',
      };
    }
    // Es la correcta
    if (i === preguntaActual.correcta) {
      return {
        border: '2px solid #4ade80',
        background: 'rgba(74,222,128,0.12)',
        color: '#ffffff',
      };
    }
    // Es la que seleccioné y está mal
    if (i === seleccionada) {
      return {
        border: '2px solid #ff4d6d',
        background: 'rgba(255,77,109,0.12)',
        color: '#ffffff',
      };
    }
    // Otras opciones
    return {
      border: '2px solid #222',
      background: 'transparent',
      color: '#555',
    };
  };

  const getLetraStyle = (i: number) => {
    if (!respondida) {
      return {
        background: 'transparent',
        border: '2px solid #555',
        color: '#ffffff',
      };
    }
    if (i === preguntaActual.correcta) {
      return {
        background: '#4ade80',
        border: '2px solid #4ade80',
        color: '#000000',
      };
    }
    if (i === seleccionada) {
      return {
        background: '#ff4d6d',
        border: '2px solid #ff4d6d',
        color: '#000000',
      };
    }
    return {
      background: 'transparent',
      border: '2px solid #333',
      color: '#444',
    };
  };

  const getLetra = (i: number) => {
    if (!respondida) return ['A', 'B', 'C', 'D'][i];
    if (i === preguntaActual.correcta) return '✓';
    if (i === seleccionada) return '✗';
    return ['A', 'B', 'C', 'D'][i];
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.97)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 2000,
      fontFamily: '-apple-system, sans-serif',
    }}>

      {/* Header */}
      <div style={{
        padding: '14px 24px',
        background: '#1a1a2e',
        borderBottom: `3px solid ${temaColor}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', margin: 0 }}>
            🤓 Quiz
          </h2>
          {fase === 'quiz' && (
            <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
              Pregunta {idx + 1} de {preguntas.length} · {puntos} correctas
            </p>
          )}
        </div>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
          ✕ Cerrar
        </button>
      </div>

      {/* Barra progreso */}
      {fase === 'quiz' && (
        <div style={{ height: '4px', background: '#1a1a2e', flexShrink: 0 }}>
          <div style={{ width: `${progreso}%`, height: '100%', background: temaColor, transition: 'width 0.4s ease' }} />
        </div>
      )}

      {/* Contenido */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', overflow: 'auto' }}>
        <div style={{ maxWidth: '640px', width: '100%' }}>

          {/* ===== CONFIG ===== */}
          {fase === 'config' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '72px', marginBottom: '16px' }}>🤓</div>
              <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#fff', margin: '0 0 8px' }}>
                Quiz de opción múltiple
              </h2>
              <p style={{ color: '#888', marginBottom: '36px', fontSize: '14px' }}>
                4 opciones por pregunta · La AI genera las opciones incorrectas basándose en el documento
              </p>

              <div style={{ background: '#0d0d1a', borderRadius: '20px', padding: '28px', border: '1px solid #333', marginBottom: '24px', textAlign: 'left' }}>
                <p style={{ fontSize: '13px', fontWeight: 700, color: '#888', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  ¿Cuántas preguntas?
                </p>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {[3, 5, 8, 10, 15, 20].map(n => (
                    <button key={n}
                      onClick={() => { setCantidad(n); setCantidadPersonalizada(n); }}
                      style={{
                        padding: '10px 18px',
                        borderRadius: '10px',
                        border: `2px solid ${cantidad === n ? temaColor : '#333'}`,
                        background: cantidad === n ? temaColor + '20' : 'transparent',
                        color: cantidad === n ? temaColor : '#888',
                        fontSize: '14px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}>
                      {n}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '13px', color: '#555' }}>Personalizado:</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={cantidadPersonalizada}
                    onChange={e => {
                      const val = Math.min(30, Math.max(1, parseInt(e.target.value) || 1));
                      setCantidadPersonalizada(val);
                      setCantidad(val);
                    }}
                    style={{ width: '80px', padding: '8px 12px', borderRadius: '8px', border: '2px solid #333', background: '#111', color: '#fff', fontSize: '14px', fontWeight: 700, textAlign: 'center', outline: 'none' }}
                  />
                  <span style={{ fontSize: '13px', color: '#555' }}>preguntas</span>
                </div>

                <div style={{ padding: '12px 16px', background: '#111', borderRadius: '10px', border: '1px solid #222' }}>
                  <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>
                    Se generarán <span style={{ color: temaColor, fontWeight: 800 }}>{cantidad} preguntas</span> con 4 opciones cada una
                  </p>
                </div>
              </div>

              <button onClick={generarQuiz} disabled={cargando}
                style={{ width: '100%', padding: '18px', borderRadius: '14px', border: 'none', background: cargando ? '#333' : temaColor, color: cargando ? '#666' : '#000', fontSize: '16px', fontWeight: 800, cursor: cargando ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
                {cargando ? '⏳ Generando quiz...' : `🚀 Iniciar quiz de ${cantidad} preguntas`}
              </button>
            </div>
          )}

          {/* ===== QUIZ ===== */}
          {fase === 'quiz' && preguntaActual && (
            <div>
              {/* Indicadores de progreso */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
                {preguntas.map((_, i) => (
                  <div key={i} style={{
                    width: i === idx ? '24px' : '10px',
                    height: '10px',
                    borderRadius: '5px',
                    background: i < idx
                      ? (resultados[i]?.correcta ? '#4ade80' : '#ff4d6d')
                      : i === idx
                        ? temaColor
                        : '#333',
                    transition: 'all 0.3s',
                    flexShrink: 0,
                  }} />
                ))}
              </div>

              {/* Pregunta */}
              <div style={{ background: '#0d0d1a', borderRadius: '20px', border: `2px solid ${temaColor}44`, overflow: 'hidden', marginBottom: '20px' }}>
                <div style={{ height: '4px', background: temaColor }} />
                <div style={{ padding: '24px' }}>
                  <span style={{ fontSize: '11px', color: temaColor, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px' }}>
                    Pregunta {idx + 1} de {preguntas.length}
                  </span>
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#ffffff', margin: '12px 0 0', lineHeight: 1.5 }}>
                    {preguntaActual.pregunta}
                  </h3>
                </div>
              </div>

              {/* Opciones */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {preguntaActual.opciones.map((opcion, i) => {
                  const opcionStyle = getOpcionStyle(i);
                  const letraStyle = getLetraStyle(i);
                  return (
                    <button
                      key={`${idx}-${i}`}
                      onClick={() => responder(i)}
                      disabled={respondida}
                      style={{
                        padding: '16px 20px',
                        borderRadius: '14px',
                        border: opcionStyle.border,
                        background: opcionStyle.background,
                        color: opcionStyle.color,
                        fontSize: '15px',
                        fontWeight: 500,
                        cursor: respondida ? 'default' : 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                        lineHeight: 1.4,
                        width: '100%',
                        transition: respondida ? 'all 0.3s' : 'none',
                      }}
                    >
                      <span style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '50%',
                        background: letraStyle.background,
                        border: letraStyle.border,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '14px',
                        fontWeight: 800,
                        color: letraStyle.color,
                        flexShrink: 0,
                        transition: 'all 0.3s',
                      }}>
                        {getLetra(i)}
                      </span>
                      <span style={{ flex: 1 }}>{opcion}</span>
                    </button>
                  );
                })}
              </div>

              {/* Explicación */}
              {respondida && (
                <>
                  <div style={{
                    background: seleccionada === preguntaActual.correcta ? 'rgba(74,222,128,0.1)' : 'rgba(255,77,109,0.1)',
                    border: `2px solid ${seleccionada === preguntaActual.correcta ? '#4ade8066' : '#ff4d6d66'}`,
                    borderRadius: '14px',
                    padding: '16px 20px',
                    marginBottom: '16px',
                  }}>
                    <p style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff', margin: '0 0 8px' }}>
                      {seleccionada === preguntaActual.correcta ? '✅ ¡Correcto!' : '❌ Incorrecto'}
                    </p>
                    <p style={{ fontSize: '14px', color: '#cccccc', margin: 0, lineHeight: 1.6 }}>
                      {preguntaActual.explicacion}
                    </p>
                  </div>

                  <button onClick={siguiente}
                    style={{ width: '100%', padding: '16px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                    {idx + 1 >= preguntas.length ? '🎉 Ver resultados' : 'Siguiente →'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ===== FIN ===== */}
          {fase === 'fin' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '64px', marginBottom: '16px' }}>
                {porcentaje >= 80 ? '🏆' : porcentaje >= 60 ? '👍' : '📚'}
              </div>
              <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#ffffff', margin: '0 0 8px' }}>
                ¡Quiz completado!
              </h2>
              <p style={{ color: '#888', marginBottom: '28px' }}>
                {puntos} de {preguntas.length} preguntas correctas
              </p>

              {/* Puntuación */}
              <div style={{ background: '#0d0d1a', borderRadius: '20px', padding: '28px', border: `2px solid ${temaColor}44`, marginBottom: '24px' }}>
                <div style={{ fontSize: '60px', fontWeight: 900, color: temaColor, lineHeight: 1 }}>
                  {puntos}/{preguntas.length}
                </div>
                <div style={{ fontSize: '36px', fontWeight: 900, color: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d', marginTop: '8px' }}>
                  {porcentaje}%
                </div>
                <div style={{ color: '#888', fontSize: '14px', marginTop: '8px' }}>
                  {porcentaje >= 80 ? '¡Excelente! Dominas el tema 🔥' : porcentaje >= 60 ? 'Bien, sigue estudiando 💪' : 'Necesitas repasar más 📖'}
                </div>
                <div style={{ background: '#1a1a2e', borderRadius: '10px', height: '12px', overflow: 'hidden', marginTop: '20px' }}>
                  <div style={{ width: `${porcentaje}%`, height: '100%', background: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d', borderRadius: '10px', transition: 'width 1s ease' }} />
                </div>
              </div>

              {/* Detalle */}
              <div style={{ background: '#0d0d1a', borderRadius: '16px', padding: '20px', border: '1px solid #333', marginBottom: '24px', textAlign: 'left', maxHeight: '280px', overflowY: 'auto' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 14px' }}>
                  Detalle pregunta por pregunta
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {preguntas.map((p, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      background: resultados[i]?.correcta ? 'rgba(74,222,128,0.05)' : 'rgba(255,77,109,0.05)',
                      borderRadius: '10px',
                      border: `1px solid ${resultados[i]?.correcta ? '#4ade8022' : '#ff4d6d22'}`,
                    }}>
                      <span style={{ fontSize: '16px', flexShrink: 0 }}>
                        {resultados[i]?.correcta ? '✅' : '❌'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '13px', color: '#cccccc', margin: '0 0 4px', lineHeight: 1.4 }}>
                          {p.pregunta}
                        </p>
                        {!resultados[i]?.correcta && (
                          <p style={{ fontSize: '11px', color: '#4ade80', margin: 0 }}>
                            ✓ Correcta: {p.opciones[p.correcta]}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button onClick={reiniciar}
                  style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                  🔄 Nuevo quiz
                </button>
                <button onClick={onClose}
                  style={{ padding: '14px 28px', borderRadius: '12px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}