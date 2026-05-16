'use client';

import { useState } from 'react';
import { guardarQuiz, guardarQuizTemporal, NivelQuiz } from '../../lib/quizStorage';
import MathText from '../MathText';

const HAND = "'Caveat',cursive";

interface PreguntaQuiz {
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
}

interface Props {
  contenido: string;
  temaColor: string;
  materiaNombre?: string;
  materiaColor?: string;
  idioma: string;
  esImagen?: boolean;
  onQuizGenerado?: (preguntas: PreguntaQuiz[]) => void;
}

const NIVELES: { id: NivelQuiz; emoji: string; label: string; desc: string; color: string; presets: number[] }[] = [
  { id: 'facil',      emoji: '🟢', label: 'Fácil',      desc: 'Definiciones',         color: '#4ade80', presets: [5, 10, 15, 20, 25, 35] },
  { id: 'intermedio', emoji: '🟡', label: 'Intermedio', desc: 'Comprensión',           color: '#f5c842', presets: [5, 10, 15, 20, 35, 50] },
  { id: 'dificil',    emoji: '🔴', label: 'Difícil',    desc: 'Análisis',              color: '#ff4d6d', presets: [5, 10, 20, 35, 50] },
];

export default function TabQuiz({ contenido, temaColor, materiaNombre, materiaColor, idioma, esImagen, onQuizGenerado }: Props) {
  const [fase, setFase] = useState<'config' | 'jugando' | 'fin'>('config');
  const [nivel, setNivel] = useState<NivelQuiz>('intermedio');
  const [cantidad, setCantidad] = useState(10);
  const [cantidadPersonalizada, setCantidadPersonalizada] = useState(10);
  const [cargando, setCargando] = useState(false);

  const [preguntas, setPreguntas] = useState<PreguntaQuiz[]>([]);
  const [idx, setIdx] = useState(0);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [respondida, setRespondida] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [resultados, setResultados] = useState<{ correcta: boolean }[]>([]);

  const [nombreQuiz, setNombreQuiz] = useState('');
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [guardadoTempOk, setGuardadoTempOk] = useState(false);

  const nivelActual = NIVELES.find(n => n.id === nivel) || NIVELES[1];
  const preguntaActual = preguntas[idx];
  const porcentaje = preguntas.length > 0 ? Math.round((puntos / preguntas.length) * 100) : 0;
  const progreso = preguntas.length > 0 ? (idx / preguntas.length) * 100 : 0;

  const generarQuiz = async () => {
    if (!contenido?.trim() && !esImagen) return;
    setCargando(true);
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contenido, count: cantidad, idioma: idioma === 'en' ? 'en' : 'es', nivel }),
      });
      const data = await res.json();
      if (data.success && data.quiz.length > 0) {
        onQuizGenerado?.(data.quiz);
        setPreguntas(data.quiz);
        setIdx(0); setSeleccionada(null); setRespondida(false);
        setPuntos(0); setResultados([]);
        setGuardadoOk(false); setGuardadoTempOk(false);
        setFase('jugando');
      }
    } catch (e) { console.error(e); }
    finally { setCargando(false); }
  };

  const responder = (i: number) => {
    if (respondida) return;
    setSeleccionada(i); setRespondida(true);
    const ok = i === preguntaActual.correcta;
    if (ok) setPuntos(p => p + 1);
    setResultados(prev => [...prev, { correcta: ok }]);
  };

  const siguiente = () => {
    if (idx + 1 >= preguntas.length) {
      setFase('fin');
      guardarQuizTemporal({
        nombre: materiaNombre ? `Quiz ${nivel} - ${materiaNombre}` : `Quiz ${nivel}`,
        preguntas, materiaNombre, materiaColor, nivel,
      });
      setGuardadoTempOk(true);
    } else {
      setIdx(i => i + 1); setSeleccionada(null); setRespondida(false);
    }
  };

  const reiniciar = () => {
    setFase('config'); setPreguntas([]); setIdx(0);
    setSeleccionada(null); setRespondida(false); setPuntos(0); setResultados([]);
    setGuardadoOk(false); setGuardadoTempOk(false);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  if (fase === 'config') return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>🤓</div>
        <h2 style={{
          fontFamily: HAND, fontSize: 38, fontWeight: 900,
          color: 'var(--text-primary)', margin: 0, lineHeight: 1,
          transform: 'rotate(-1.5deg)', display: 'inline-block',
        }}>
          Generar Quiz
        </h2>
        <svg width="200" height="6" style={{ display: 'block', margin: '4px auto 0' }}>
          <path d="M2 3 Q 100 0 198 4" stroke="#a78bfa" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
        </svg>
        <p style={{
          fontFamily: HAND, fontSize: 17, fontStyle: 'italic',
          color: 'var(--text-muted)', margin: '8px 0 0',
        }}>
          ~ {idioma === 'en'
            ? '4 options · AI generates wrong ones from the document'
            : '4 opciones · la IA genera las incorrectas desde el documento'} ~
        </p>
      </div>

      {/* NIVEL */}
      <NotebookCard color={nivelActual.color} bandaEmoji="🎯" bandaTexto={idioma === 'en' ? 'Difficulty level' : 'Nivel de dificultad'} rot={-0.5}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {NIVELES.map((n, i) => {
            const active = nivel === n.id;
            return (
              <button key={n.id}
                onClick={() => { setNivel(n.id); setCantidad(n.presets[1]); setCantidadPersonalizada(n.presets[1]); }}
                style={{
                  padding: '12px 8px',
                  borderRadius: 12,
                  border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? n.color : 'var(--border-color)'}`,
                  background: active ? n.color + '18' : 'var(--bg-secondary)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  boxShadow: active ? `2px 3px 0 ${n.color}` : 'none',
                  transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.5 : 0.5}deg)`,
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{n.emoji}</div>
                <div style={{
                  fontFamily: HAND, fontSize: 18, fontWeight: 800,
                  color: active ? n.color : 'var(--text-primary)',
                  marginBottom: 2,
                }}>{n.label}</div>
                <div style={{
                  fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                  color: 'var(--text-faint)', lineHeight: 1.2,
                }}>{n.desc}</div>
              </button>
            );
          })}
        </div>
      </NotebookCard>

      {/* CANTIDAD */}
      <div style={{ marginTop: 16 }}>
        <NotebookCard color={temaColor} bandaEmoji="🔢" bandaTexto={idioma === 'en' ? 'Number of questions' : 'Cantidad de preguntas'} rot={0.4}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {nivelActual.presets.map((n, i) => {
              const active = cantidad === n;
              return (
                <button key={n} onClick={() => { setCantidad(n); setCantidadPersonalizada(n); }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 10,
                    border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? temaColor : 'var(--border-color)'}`,
                    background: active ? temaColor + '20' : 'transparent',
                    color: active ? temaColor : 'var(--text-muted)',
                    fontFamily: HAND, fontSize: 18, fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: active ? `2px 3px 0 ${temaColor}` : 'none',
                    transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                    transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                  }}>
                  {n}
                </button>
              );
            })}
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px',
            background: 'var(--bg-secondary)',
            border: '2px dashed var(--border-color)',
            borderRadius: 10,
            transform: 'rotate(-0.3deg)',
          }}>
            <span style={{
              fontFamily: HAND, fontSize: 15, fontWeight: 700,
              color: 'var(--text-muted)', fontStyle: 'italic',
              whiteSpace: 'nowrap',
            }}>
              ✏️ {idioma === 'en' ? 'custom:' : 'personalizado:'}
            </span>
            <input type="number" min={1} max={100} value={cantidadPersonalizada}
              onChange={e => {
                const v = Math.min(100, Math.max(1, parseInt(e.target.value) || 1));
                setCantidadPersonalizada(v); setCantidad(v);
              }}
              style={{
                width: 70, padding: '6px 10px',
                borderRadius: 8,
                border: `2.5px solid ${temaColor}`,
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontFamily: HAND, fontSize: 19, fontWeight: 800,
                textAlign: 'center', outline: 'none',
                boxShadow: `2px 2px 0 ${temaColor}55`,
              }} />
            <span style={{
              fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
              color: 'var(--text-faint)',
            }}>
              ~ máx. 100 ~
            </span>
          </div>

          <p style={{
            fontFamily: HAND, fontSize: 15, fontStyle: 'italic',
            color: 'var(--text-faint)', margin: '12px 0 0', textAlign: 'center',
          }}>
            ~ {idioma === 'en' ? `${cantidad} questions · level` : `${cantidad} preguntas · nivel`} <strong style={{ color: nivelActual.color }}>{nivelActual.label}</strong> ~
          </p>
        </NotebookCard>
      </div>

      {/* Botón generar */}
      <button onClick={generarQuiz} disabled={cargando || (!contenido?.trim() && !esImagen)}
        style={{
          width: '100%', padding: 16,
          marginTop: 22,
          borderRadius: 14,
          border: '2.5px solid var(--text-primary)',
          background: (cargando || (!contenido?.trim() && !esImagen)) ? 'var(--bg-card2)' : temaColor,
          color: (cargando || (!contenido?.trim() && !esImagen)) ? 'var(--text-faint)' : '#000',
          fontFamily: HAND, fontSize: 22, fontWeight: 800,
          cursor: (cargando || (!contenido?.trim() && !esImagen)) ? 'not-allowed' : 'pointer',
          boxShadow: (cargando || (!contenido?.trim() && !esImagen)) ? 'none' : '4px 5px 0 var(--text-primary)',
          transform: 'rotate(-1deg)',
          transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
        }}
        onMouseEnter={(e:any)=>{
          if (!cargando && (contenido?.trim() || esImagen)) {
            e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
            e.currentTarget.style.boxShadow = '5px 7px 0 var(--text-primary)';
          }
        }}
        onMouseLeave={(e:any)=>{
          e.currentTarget.style.transform = 'rotate(-1deg)';
          if (!cargando && (contenido?.trim() || esImagen)) e.currentTarget.style.boxShadow = '4px 5px 0 var(--text-primary)';
        }}>
        {cargando
          ? (idioma === 'en' ? '⏳ Generating...' : '⏳ Generando quiz...')
          : `🚀 ${idioma === 'en' ? 'Start Quiz' : 'Iniciar Quiz'} · ${cantidad} ${idioma === 'en' ? 'questions' : 'preguntas'}`}
      </button>

      {(!contenido?.trim() && !esImagen) && (
        <p style={{
          textAlign: 'center',
          fontFamily: HAND, fontSize: 16, fontStyle: 'italic',
          color: 'var(--red)', margin: '12px 0 0',
        }}>
          ⚠️ {idioma === 'en' ? '~ analyze the document first to generate a quiz ~' : '~ analiza el documento primero para generar un quiz ~'}
        </p>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // JUGANDO
  // ═══════════════════════════════════════════════════════════════════════════
  if (fase === 'jugando' && preguntaActual) return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '16px' }}>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 14, gap: 8, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              padding: '3px 12px', borderRadius: 8,
              fontFamily: HAND, fontSize: 15, fontWeight: 800,
              background: nivelActual.color + '22',
              color: nivelActual.color,
              border: `2px solid ${nivelActual.color}`,
              boxShadow: `1px 2px 0 ${nivelActual.color}55`,
              transform: 'rotate(-1.5deg)',
              display: 'inline-block',
              fontStyle: 'italic',
            }}>
              {nivelActual.emoji} {nivelActual.label}
            </span>
          </div>
          <p style={{
            fontFamily: HAND, fontSize: 16, fontStyle: 'italic',
            color: 'var(--text-muted)', margin: 0,
          }}>
            ~ {idioma === 'en' ? 'Question' : 'pregunta'} {idx + 1} / {preguntas.length} · {puntos} {idioma === 'en' ? 'correct' : 'correctas'} ~
          </p>
        </div>
        <button onClick={reiniciar}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '2px dashed var(--text-faint)',
            background: 'transparent',
            color: 'var(--text-faint)',
            fontFamily: HAND, fontSize: 15, fontWeight: 800,
            cursor: 'pointer',
            transform: 'rotate(1.5deg)',
            fontStyle: 'italic',
          }}>
          ✕ {idioma === 'en' ? 'exit' : 'salir'}
        </button>
      </div>

      {/* Barra progreso */}
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1.5px solid var(--text-primary)',
        borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: 12,
      }}>
        <div style={{
          width: `${progreso}%`, height: '100%',
          background: temaColor,
          borderRadius: 4,
          transition: 'width 0.4s cubic-bezier(.25,.8,.25,1)',
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.3)`,
        }} />
      </div>

      {/* Indicadores */}
      <div style={{
        display: 'flex', gap: 4,
        marginBottom: 16, flexWrap: 'wrap', justifyContent: 'center',
      }}>
        {preguntas.map((_, i) => (
          <div key={i} style={{
            width: i === idx ? 22 : 10,
            height: 10,
            borderRadius: 5,
            background: i < idx ? (resultados[i]?.correcta ? '#4ade80' : '#ff4d6d') : i === idx ? temaColor : 'var(--border-color)',
            border: i === idx ? '1.5px solid var(--text-primary)' : 'none',
            boxShadow: i === idx ? '1px 1px 0 var(--text-primary)' : 'none',
            transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
            flexShrink: 0,
          }} />
        ))}
      </div>

      {/* Pregunta — card cuaderno */}
      <div style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 14,
        boxShadow: `4px 5px 0 ${temaColor}`,
        transform: 'rotate(-0.4deg)',
        overflow: 'hidden',
        marginBottom: 16,
        position: 'relative',
      }}>
        {/* Cinta scotch */}
        <div style={{
          position: 'absolute',
          top: -8, left: '50%',
          transform: 'translateX(-50%) rotate(-3deg)',
          width: 70, height: 16,
          background: `color-mix(in srgb,${temaColor} 55%,transparent)`,
          border: `1px solid color-mix(in srgb,${temaColor} 30%,transparent)`,
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          zIndex: 5,
        }}/>

        <div style={{
          background: temaColor,
          padding: '8px 18px',
          borderBottom: '2px solid var(--text-primary)',
        }}>
          <span style={{
            fontFamily: HAND, fontSize: 16, fontWeight: 800,
            color: '#000', fontStyle: 'italic',
          }}>
            ✏️ {idioma === 'en' ? 'Question' : 'Pregunta'} {idx + 1}
          </span>
        </div>

        <div style={{ padding: '20px 24px', position: 'relative' }}>
          {/* margen rojo cuaderno */}
          <div style={{
            position: 'absolute', top: 12, bottom: 12,
            left: 32, width: 1.5,
            background: '#ef4444', opacity: 0.22,
            pointerEvents: 'none',
          }}/>

          <div style={{
            fontFamily: HAND,
            fontSize: 22, fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
            paddingLeft: 16,
          }}>
            <MathText text={preguntaActual.pregunta} />
          </div>
        </div>
      </div>

      {/* Opciones */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {preguntaActual.opciones.map((opcion, i) => {
          let borderColor = 'var(--text-primary)';
          let bgColor = 'var(--bg-card)';
          let shadowColor = 'var(--text-primary)';
          let textColor = 'var(--text-primary)';

          if (respondida) {
            if (i === preguntaActual.correcta) {
              borderColor = '#4ade80';
              bgColor = 'color-mix(in srgb,#4ade80 18%,var(--bg-card))';
              shadowColor = '#4ade80';
              textColor = '#16a34a';
            } else if (i === seleccionada) {
              borderColor = '#ff4d6d';
              bgColor = 'color-mix(in srgb,#ff4d6d 18%,var(--bg-card))';
              shadowColor = '#ff4d6d';
              textColor = '#ff4d6d';
            }
          }

          const letra = respondida
            ? (i === preguntaActual.correcta ? '✓' : i === seleccionada ? '✗' : ['A', 'B', 'C', 'D'][i])
            : ['A', 'B', 'C', 'D'][i];

          return (
            <button key={`${idx}-${i}`} onClick={() => responder(i)} disabled={respondida}
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                border: `2.5px solid ${borderColor}`,
                background: bgColor,
                color: textColor,
                fontFamily: HAND, fontSize: 18, fontWeight: 700,
                cursor: respondida ? 'default' : 'pointer',
                textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%',
                boxShadow: respondida && (i === preguntaActual.correcta || i === seleccionada)
                  ? `3px 4px 0 ${shadowColor}`
                  : '2px 3px 0 var(--text-primary)',
                transform: `rotate(${(i % 2 === 0 ? -0.4 : 0.4)}deg)`,
                transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{
                if (!respondida) {
                  e.currentTarget.style.transform = 'rotate(0deg) translateX(4px)';
                  e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
                }
              }}
              onMouseLeave={(e:any)=>{
                if (!respondida) {
                  e.currentTarget.style.transform = `rotate(${(i % 2 === 0 ? -0.4 : 0.4)}deg)`;
                  e.currentTarget.style.boxShadow = '2px 3px 0 var(--text-primary)';
                }
              }}
            >
              <span style={{
                width: 34, height: 34, borderRadius: '50%',
                border: `2.5px solid ${respondida && (i === preguntaActual.correcta || i === seleccionada) ? shadowColor : 'var(--text-primary)'}`,
                background: respondida && (i === preguntaActual.correcta || i === seleccionada) ? shadowColor : 'var(--bg-secondary)',
                color: respondida && (i === preguntaActual.correcta || i === seleccionada) ? '#fff' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: HAND, fontSize: 18, fontWeight: 900,
                flexShrink: 0,
                boxShadow: '1px 2px 0 var(--text-primary)',
                transform: 'rotate(-3deg)',
              }}>
                {letra}
              </span>
              <span style={{ flex: 1, lineHeight: 1.35 }}>{opcion}</span>
            </button>
          );
        })}
      </div>

      {/* Feedback */}
      {respondida && (
        <>
          <div style={{
            background: seleccionada === preguntaActual.correcta
              ? 'color-mix(in srgb,#4ade80 14%,transparent)'
              : 'color-mix(in srgb,#ff4d6d 14%,transparent)',
            border: `2.5px dashed ${seleccionada === preguntaActual.correcta ? '#4ade80' : '#ff4d6d'}`,
            borderRadius: 12,
            padding: '12px 16px',
            marginBottom: 12,
            transform: 'rotate(0.3deg)',
          }}>
            <p style={{
              fontFamily: HAND, fontSize: 19, fontWeight: 900,
              color: seleccionada === preguntaActual.correcta ? '#16a34a' : '#ff4d6d',
              margin: '0 0 5px',
              fontStyle: 'italic',
            }}>
              {seleccionada === preguntaActual.correcta ? '✅ ¡Correcto!' : '❌ Incorrecto'}
            </p>
            <p style={{
              fontFamily: HAND, fontSize: 16, fontWeight: 600,
              color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4,
            }}>
              <MathText text={preguntaActual.explicacion} />
            </p>
          </div>
          <button onClick={siguiente}
            style={{
              width: '100%', padding: 14,
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: temaColor, color: '#000',
              fontFamily: HAND, fontSize: 20, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 4px 0 var(--text-primary)',
              transform: 'rotate(-1deg)',
              transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{
              e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
              e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
            }}
            onMouseLeave={(e:any)=>{
              e.currentTarget.style.transform = 'rotate(-1deg)';
              e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
            }}>
            {idx + 1 >= preguntas.length
              ? (idioma === 'en' ? '🏁 See Results' : '🏁 Ver Resultados')
              : (idioma === 'en' ? 'Next →' : 'Siguiente →')}
          </button>
        </>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // FIN
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 10 }}>
        {porcentaje >= 80 ? '🏆' : porcentaje >= 60 ? '👍' : '📚'}
      </div>
      <h2 style={{
        fontFamily: HAND, fontSize: 38, fontWeight: 900,
        color: 'var(--text-primary)', margin: 0, lineHeight: 1,
        transform: 'rotate(-1.5deg)', display: 'inline-block',
      }}>
        {idioma === 'en' ? '¡Quiz completed!' : '¡Quiz completado!'}
      </h2>
      <svg width="220" height="6" style={{ display: 'block', margin: '4px auto 0' }}>
        <path d="M2 3 Q 110 0 218 4" stroke={temaColor} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
      </svg>
      <p style={{
        fontFamily: HAND, fontSize: 19, fontStyle: 'italic',
        color: 'var(--text-muted)', margin: '8px 0 22px',
      }}>
        ~ {puntos} {idioma === 'en' ? 'of' : 'de'} {preguntas.length} {idioma === 'en' ? 'correct' : 'correctas'} ~
      </p>

      {/* Score */}
      <div style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 16,
        padding: 24,
        boxShadow: `5px 6px 0 ${temaColor}`,
        transform: 'rotate(-0.5deg)',
        marginBottom: 18,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-3deg)',
          width: 70, height: 16,
          background: `color-mix(in srgb,${temaColor} 55%,transparent)`,
          border: `1px solid color-mix(in srgb,${temaColor} 30%,transparent)`,
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
        }}/>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{
            fontFamily: HAND, fontSize: 54, fontWeight: 900,
            color: temaColor, lineHeight: 1,
            textShadow: `0 0 10px ${temaColor}33`,
          }}>
            {puntos}/{preguntas.length}
          </span>
          <span style={{
            padding: '3px 12px', borderRadius: 8,
            fontFamily: HAND, fontSize: 16, fontWeight: 800,
            background: nivelActual.color + '22',
            color: nivelActual.color,
            border: `2px solid ${nivelActual.color}`,
            boxShadow: `1px 2px 0 ${nivelActual.color}55`,
            transform: 'rotate(3deg)',
            fontStyle: 'italic',
          }}>
            {nivelActual.emoji} {nivelActual.label}
          </span>
        </div>
        <div style={{
          fontFamily: HAND, fontSize: 42, fontWeight: 900,
          color: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d',
          lineHeight: 1, marginBottom: 4,
        }}>
          {porcentaje}%
        </div>
        <div style={{
          fontFamily: HAND, fontSize: 17, fontStyle: 'italic',
          color: 'var(--text-muted)',
        }}>
          {porcentaje >= 80 ? '~ ¡excelente! 🔥 ~' : porcentaje >= 60 ? (idioma === 'en' ? '~ good job 💪 ~' : '~ bien, sigue 💪 ~') : (idioma === 'en' ? '~ study more 📖 ~' : '~ repasa más 📖 ~')}
        </div>

        <div style={{
          background: 'var(--bg-secondary)',
          border: '1.5px solid var(--text-primary)',
          borderRadius: 6,
          height: 10,
          overflow: 'hidden',
          marginTop: 16,
        }}>
          <div style={{
            width: `${porcentaje}%`, height: '100%',
            background: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d',
            borderRadius: 4,
            transition: 'width 1s cubic-bezier(.25,.8,.25,1)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
          }} />
        </div>
      </div>

      {/* Auto-guardado */}
      {!guardadoOk && (
        <div style={{
          padding: '12px 16px',
          background: 'color-mix(in srgb,var(--gold) 14%,transparent)',
          border: '2.5px dashed var(--gold)',
          borderRadius: 12,
          marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10,
          transform: 'rotate(0.4deg)',
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>⏳</span>
          <div style={{ textAlign: 'left' }}>
            <p style={{
              fontFamily: HAND, fontSize: 17, fontWeight: 800,
              color: 'var(--gold)', margin: '0 0 2px',
              fontStyle: 'italic',
            }}>
              {idioma === 'en' ? 'Auto-saved for 24 hours' : 'Guardado automáticamente por 24 horas'}
            </p>
            <p style={{
              fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
              color: 'var(--text-faint)', margin: 0,
            }}>
              ~ {idioma === 'en' ? 'go to Quiz Library → "Pending" and save it before it expires' : 've a Biblioteca de Quizzes → "Por Guardar" y guárdalo antes de que expire'} ~
            </p>
          </div>
        </div>
      )}

      {/* Guardar permanente */}
      <NotebookCard color={temaColor} bandaEmoji="💾" bandaTexto={idioma === 'en' ? 'Save permanently' : 'Guardar permanentemente'} rot={-0.4}>
        {guardadoOk ? (
          <div style={{
            padding: 14,
            background: 'color-mix(in srgb,#4ade80 18%,transparent)',
            border: '2.5px solid #4ade80',
            borderRadius: 10,
            transform: 'rotate(-0.3deg)',
            boxShadow: '2px 3px 0 #4ade80',
          }}>
            <p style={{
              fontFamily: HAND, fontSize: 20, fontWeight: 900,
              color: '#16a34a', margin: 0,
            }}>
              ✅ {idioma === 'en' ? '¡Saved to your library!' : '¡Guardado en tu biblioteca!'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" value={nombreQuiz} onChange={e => setNombreQuiz(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && nombreQuiz.trim()) {
                  guardarQuiz({ nombre: nombreQuiz, preguntas, materiaNombre, materiaColor, nivel });
                  setGuardadoOk(true); setNombreQuiz('');
                }
              }}
              placeholder={idioma === 'en' ? 'Quiz name... e.g. Topic 1' : 'Nombre del quiz... ej: Tema 1'}
              style={{
                flex: 1, padding: '10px 14px',
                borderRadius: 10,
                border: `2.5px solid var(--text-primary)`,
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontFamily: HAND, fontSize: 17, fontWeight: 600,
                outline: 'none', boxSizing: 'border-box',
                boxShadow: '2px 3px 0 var(--text-primary)',
                transform: 'rotate(-0.3deg)',
              }} />
            <button onClick={() => {
              if (!nombreQuiz.trim()) return;
              guardarQuiz({ nombre: nombreQuiz, preguntas, materiaNombre, materiaColor, nivel });
              setGuardadoOk(true); setNombreQuiz('');
            }} disabled={!nombreQuiz.trim()}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: '2.5px solid var(--text-primary)',
                background: nombreQuiz.trim() ? temaColor : 'var(--bg-card2)',
                color: nombreQuiz.trim() ? '#000' : 'var(--text-faint)',
                fontFamily: HAND, fontSize: 17, fontWeight: 800,
                cursor: nombreQuiz.trim() ? 'pointer' : 'not-allowed',
                whiteSpace: 'nowrap',
                boxShadow: nombreQuiz.trim() ? '2px 3px 0 var(--text-primary)' : 'none',
                transform: 'rotate(1deg)',
              }}>
              💾 {idioma === 'en' ? 'Save' : 'Guardar'}
            </button>
          </div>
        )}
      </NotebookCard>

      {/* Detalle */}
      <div style={{ marginTop: 16 }}>
        <NotebookCard color="var(--text-muted)" bandaEmoji="📋" bandaTexto={idioma === 'en' ? 'Question by question' : 'Detalle pregunta por pregunta'} rot={0.3}>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 7,
            maxHeight: 240, overflowY: 'auto',
            paddingRight: 4,
          }}>
            {preguntas.map((p, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '8px 10px',
                background: resultados[i]?.correcta ? 'color-mix(in srgb,#4ade80 8%,transparent)' : 'color-mix(in srgb,#ff4d6d 8%,transparent)',
                borderRadius: 8,
                border: `1.5px dashed ${resultados[i]?.correcta ? '#4ade80' : '#ff4d6d'}`,
                transform: `rotate(${(i % 2 === 0 ? -0.2 : 0.2)}deg)`,
                textAlign: 'left',
              }}>
                <span style={{ fontSize: 15, flexShrink: 0 }}>
                  {resultados[i]?.correcta ? '✅' : '❌'}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{
                    fontFamily: HAND, fontSize: 15, fontWeight: 600,
                    color: 'var(--text-secondary)', margin: '0 0 2px',
                    lineHeight: 1.3,
                  }}>
                    {p.pregunta}
                  </p>
                  {!resultados[i]?.correcta && (
                    <p style={{
                      fontFamily: HAND, fontSize: 14, fontWeight: 700,
                      color: '#16a34a', margin: 0,
                      fontStyle: 'italic',
                    }}>
                      ✓ {p.opciones[p.correcta]}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </NotebookCard>
      </div>

      {/* Acciones */}
      <div style={{
        display: 'flex', gap: 10,
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginTop: 20,
      }}>
        <button onClick={reiniciar}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: temaColor, color: '#000',
            fontFamily: HAND, fontSize: 19, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-1.5deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
          onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1.5deg)';}}>
          🔄 {idioma === 'en' ? 'New Quiz' : 'Nuevo Quiz'}
        </button>
        <button onClick={() => window.location.href = '/quizzes'}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            border: '2.5px dashed #a78bfa',
            background: 'color-mix(in srgb,#a78bfa 14%,transparent)',
            color: '#a78bfa',
            fontFamily: HAND, fontSize: 19, fontWeight: 800,
            cursor: 'pointer',
            transform: 'rotate(1.5deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseEnter={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
            e.currentTarget.style.borderStyle = 'solid';
          }}
          onMouseLeave={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(1.5deg)';
            e.currentTarget.style.borderStyle = 'dashed';
          }}>
          🎓 {idioma === 'en' ? 'My Quizzes' : 'Mis Quizzes'}
        </button>
      </div>
    </div>
  );
}

// ── Card cuaderno reutilizable ──
function NotebookCard({ children, color, bandaEmoji, bandaTexto, rot }: {
  children: React.ReactNode;
  color: string;
  bandaEmoji: string;
  bandaTexto: string;
  rot: number;
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '2.5px solid var(--text-primary)',
      borderRadius: 12,
      boxShadow: `4px 5px 0 ${color}`,
      transform: `rotate(${rot}deg)`,
      overflow: 'hidden',
    }}>
      <div style={{
        background: color,
        padding: '6px 14px',
        borderBottom: '2px solid var(--text-primary)',
      }}>
        <span style={{
          fontFamily: HAND, fontSize: 16, fontWeight: 800,
          color: '#000', fontStyle: 'italic',
        }}>
          {bandaEmoji} {bandaTexto}
        </span>
      </div>
      <div style={{ padding: '16px 18px' }}>
        {children}
      </div>
    </div>
  );
}
