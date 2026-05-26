from pathlib import Path

# ══════════════════════════════════════════════
# 1) QuizPage.tsx — reescribir completo
# ══════════════════════════════════════════════
quiz_page = Path("components/materias/QuizPage.tsx")

new_quiz = """'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { detectContentLanguage } from '../../lib/detectLanguage';
import MathText from '../MathText';

const HAND = "'Caveat', cursive";
const BODY = "'Inter', system-ui, sans-serif";

interface Pregunta {
  pregunta: string;
  opciones: string[];
  correcta: number;
  explicacion: string;
}

interface SeleccionItem {
  materialId: string;
  materialIndex: number;
  pages: number[];
  text?: string;
}

interface Props {
  materiales: any[];
  seleccion?: SeleccionItem[];
  tema: any;
  materia: any;
  onBack: () => void;
}

type Fase = 'config' | 'generando' | 'jugando' | 'resultado';
type NivelQuiz = 'facil' | 'intermedio' | 'dificil';

const NIVELES = [
  { id: 'facil'      as NivelQuiz, emoji: '🟢', label: 'Fácil',      desc: 'Definiciones y reconocimiento', color: '#4ade80' },
  { id: 'intermedio' as NivelQuiz, emoji: '🟡', label: 'Intermedio', desc: 'Comprensión y aplicación',      color: '#f5c842' },
  { id: 'dificil'    as NivelQuiz, emoji: '🔴', label: 'Difícil',    desc: 'Análisis y casos especiales',   color: '#ef4444' },
];

// ── Separar texto por páginas ──
function filterTextByPages(fullText: string, pages: number[]): string {
  if (!pages || pages.length === 0) return fullText;
  let parts: string[] = [];

  if (fullText.includes('\\f')) {
    parts = fullText.split('\\f').map(t => t.trim()).filter(Boolean);
  }
  if (parts.length <= 1 && (fullText.includes('[Página ') || fullText.includes('[Pagina '))) {
    parts = fullText.split(/(?=\\[P[áa]gina \\d+\\])/g).map(t => t.trim()).filter(Boolean);
  }
  if (parts.length <= 1 && fullText.includes('[Page ')) {
    parts = fullText.split(/(?=\\[Page \\d+\\])/gi).map(t => t.trim()).filter(Boolean);
  }

  if (parts.length <= 1) return fullText; // sin separadores → usar todo

  const selected = pages.map(p => parts[p - 1]).filter(Boolean);
  return selected.length > 0 ? selected.join('\\n\\n') : fullText;
}

export default function QuizPage({ materiales, seleccion, tema, materia, onBack }: Props) {
  const themeColor = tema?.color || '#f5c842';

  const [fase, setFase]       = useState<Fase>('config');
  const [nivel, setNivel]     = useState<NivelQuiz>('intermedio');
  const [count, setCount]     = useState(10);
  const [error, setError]     = useState('');

  const [preguntas, setPreguntas]       = useState<Pregunta[]>([]);
  const [idx, setIdx]                   = useState(0);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [respondida, setRespondida]     = useState(false);
  const [puntos, setPuntos]             = useState(0);
  const [resultados, setResultados]     = useState<boolean[]>([]);

  const nivelActual  = NIVELES.find(n => n.id === nivel) || NIVELES[1];
  const preguntaActual = preguntas[idx];
  const progreso     = preguntas.length > 0 ? ((idx + 1) / preguntas.length) * 100 : 0;
  const porcentaje   = preguntas.length > 0 ? Math.round((puntos / preguntas.length) * 100) : 0;

  // ── Info de materiales seleccionados ──
  const matsUsados = materiales.length > 0 ? materiales : [];
  const tieneSeleccion = Array.isArray(seleccion) && seleccion.length > 0;
  const totalPaginas = tieneSeleccion
    ? seleccion.reduce((acc, s) => acc + (s.pages?.length || 0), 0)
    : 0;

  // ── Teclado ──
  useEffect(() => {
    if (fase !== 'jugando') return;
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (!respondida) {
        if (e.key === '1') responder(0);
        if (e.key === '2') responder(1);
        if (e.key === '3') responder(2);
        if (e.key === '4') responder(3);
      } else {
        if (e.key === 'ArrowRight' || e.key === 'Enter') siguiente();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fase, respondida, idx, preguntas]);

  // ── Extraer texto de todos los materiales ──
  const extractAllText = async (): Promise<string> => {
    const session = (await supabase.auth.getSession()).data.session;
    const texts: string[] = [];

    const mats = matsUsados.length > 0 ? matsUsados : [];

    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      const matId = mat?.materialId || mat?.id;
      const sel = tieneSeleccion
        ? seleccion.find(s => s.materialIndex === i || s.materialId === String(matId))
        : null;

      // Si ya viene texto pre-extraído
      if (sel?.text) {
        texts.push(sel.text);
        continue;
      }

      // Si hay contenido directo
      const raw = mat?.contenido || mat?.content || '';
      if (raw.trim()) {
        const pages = sel?.pages || [];
        texts.push(pages.length > 0 ? filterTextByPages(raw, pages) : raw);
        continue;
      }

      // Extraer desde API
      if (!matId || !session) continue;
      try {
        const res = await fetch('/api/enfoques/teorico/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ materialIds: [matId] }),
        });
        const data = await res.json();
        const fullText = data.materials?.[matId]?.text || '';
        if (!fullText) continue;

        const pages = sel?.pages || [];
        texts.push(pages.length > 0 ? filterTextByPages(fullText, pages) : fullText);
      } catch (e) {
        console.warn('Error extrayendo material', matId, e);
      }
    }

    return texts.join('\\n\\n---\\n\\n');
  };

  // ── Generar quiz ──
  const generate = async () => {
    setError('');
    setFase('generando');

    try {
      const texto = await extractAllText();
      if (!texto.trim()) {
        setError('No se pudo extraer texto de los materiales.');
        setFase('config');
        return;
      }

      const lang = detectContentLanguage(texto, 'es');
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: texto, count, idioma: lang, nivel }),
      });

      const data = await res.json();
      if (!data.success || !data.quiz?.length) {
        setError(data.error || 'No se pudo generar el quiz.');
        setFase('config');
        return;
      }

      setPreguntas(data.quiz);
      setIdx(0);
      setSeleccionada(null);
      setRespondida(false);
      setPuntos(0);
      setResultados([]);
      setFase('jugando');
    } catch (e: any) {
      setError(e.message);
      setFase('config');
    }
  };

  const responder = (i: number) => {
    if (respondida || !preguntaActual) return;
    setSeleccionada(i);
    setRespondida(true);
    const ok = i === preguntaActual.correcta;
    if (ok) setPuntos(p => p + 1);
    setResultados(prev => [...prev, ok]);
  };

  const siguiente = () => {
    if (idx + 1 >= preguntas.length) setFase('resultado');
    else {
      setIdx(i => i + 1);
      setSeleccionada(null);
      setRespondida(false);
    }
  };

  const reiniciar = () => {
    setIdx(0); setSeleccionada(null);
    setRespondida(false); setPuntos(0);
    setResultados([]); setFase('jugando');
  };

  // ══════════════════════════════
  // BASE LAYOUT
  // ══════════════════════════════
  const Base = ({ children }: { children: React.ReactNode }) => (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column',
      fontFamily: HAND, overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `linear-gradient(to bottom, transparent 47px, color-mix(in srgb, var(--text-primary) 5%, transparent) 47px, color-mix(in srgb, var(--text-primary) 5%, transparent) 48px, transparent 48px)`,
        backgroundSize: '100% 48px',
      }}/>
      <div style={{ position: 'absolute', left: 72, top: 0, bottom: 0, width: 1.5, background: 'rgba(239,68,68,0.35)', pointerEvents: 'none' }}/>
      {children}
    </div>
  );

  // ══════════════════════════════
  // HEADER
  // ══════════════════════════════
  const Header = ({ right }: { right?: React.ReactNode }) => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 24px',
      borderBottom: '2px solid var(--border-color)',
      position: 'relative', zIndex: 10, flexShrink: 0,
      background: 'var(--bg-primary)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{
          background: 'var(--bg-card)', border: '2px solid var(--text-primary)',
          padding: '8px 18px', borderRadius: 10, cursor: 'pointer',
          fontFamily: HAND, fontSize: 18, fontWeight: 700,
          color: 'var(--text-primary)', boxShadow: '2px 3px 0 var(--text-primary)',
        }}>← volver</button>
        <div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: 'var(--text-primary)' }}>
            🎯 Quiz
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            {tema.nombre} · {materia.nombre}
            {tieneSeleccion && totalPaginas > 0 && (
              <span style={{ marginLeft: 8, color: themeColor }}>
                · {totalPaginas} págs seleccionadas
              </span>
            )}
          </p>
        </div>
      </div>
      {right}
    </div>
  );

  // ══════════════════════════════
  // CONFIG / GENERANDO
  // ══════════════════════════════
  if (fase === 'config' || fase === 'generando') {
    return (
      <Base>
        <Header/>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, position: 'relative', zIndex: 1, overflow: 'auto',
        }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 16, padding: '36px 40px',
            boxShadow: '5px 6px 0 var(--text-primary)',
            maxWidth: 540, width: '100%',
            transform: 'rotate(0.4deg)',
            position: 'relative',
          }}>
            {/* Cinta scotch */}
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(2deg)',
              width: 80, height: 16,
              background: `color-mix(in srgb, ${themeColor} 55%, transparent)`,
              border: '1px solid color-mix(in srgb, var(--text-primary) 15%, transparent)',
            }}/>

            {/* Info materiales seleccionados */}
            {matsUsados.length > 0 && (
              <div style={{
                marginBottom: 24,
                padding: '12px 16px',
                background: `color-mix(in srgb, ${themeColor} 10%, var(--bg-secondary))`,
                border: `2px dashed ${themeColor}`,
                borderRadius: 10,
              }}>
                <p style={{ margin: '0 0 6px', fontFamily: HAND, fontSize: 15, fontWeight: 800, color: themeColor }}>
                  📂 {matsUsados.length} material{matsUsados.length > 1 ? 'es' : ''} seleccionado{matsUsados.length > 1 ? 's' : ''}
                </p>
                {matsUsados.map((m: any, i: number) => {
                  const sel = tieneSeleccion
                    ? seleccion.find(s => s.materialIndex === i)
                    : null;
                  const pages = sel?.pages || [];
                  return (
                    <div key={i} style={{
                      fontFamily: HAND, fontSize: 13,
                      color: 'var(--text-muted)', fontStyle: 'italic',
                      marginTop: 2,
                    }}>
                      · {m.nombre || m.name || `Material ${i + 1}`}
                      {pages.length > 0 && (
                        <span style={{ color: themeColor, marginLeft: 6 }}>
                          ({pages.length} págs)
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Dificultad */}
            <p style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 900, color: 'var(--text-primary)' }}>
              Dificultad
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 28, flexWrap: 'wrap' }}>
              {NIVELES.map(n => (
                <button key={n.id} onClick={() => setNivel(n.id)} style={{
                  flex: 1, minWidth: 120, padding: '14px 12px', borderRadius: 12,
                  border: `2.5px solid ${nivel === n.id ? n.color : 'var(--border-color)'}`,
                  background: nivel === n.id
                    ? `color-mix(in srgb, ${n.color} 15%, var(--bg-card))`
                    : 'transparent',
                  cursor: 'pointer', textAlign: 'center',
                  boxShadow: nivel === n.id ? '2px 3px 0 var(--text-primary)' : 'none',
                  transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 26, marginBottom: 4 }}>{n.emoji}</div>
                  <div style={{ fontFamily: HAND, fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
                    {n.label}
                  </div>
                  <div style={{ fontFamily: HAND, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {n.desc}
                  </div>
                </button>
              ))}
            </div>

            {/* Cantidad */}
            <p style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 900, color: 'var(--text-primary)' }}>
              Preguntas
            </p>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
              {[5, 10, 15, 20, 30, 50].map(n => (
                <button key={n} onClick={() => setCount(n)} style={{
                  padding: '9px 15px', borderRadius: 9,
                  border: `2px solid ${count === n ? themeColor : 'var(--border-color)'}`,
                  background: count === n ? themeColor : 'transparent',
                  color: count === n ? '#000' : 'var(--text-muted)',
                  fontFamily: HAND, fontSize: 19, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: count === n ? '2px 2px 0 var(--text-primary)' : 'none',
                  transition: 'all 0.15s',
                }}>{n}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
              <span style={{ fontSize: 15, color: 'var(--text-muted)' }}>Otro:</span>
              <input type="number" min={1} max={100} value={count}
                onChange={e => setCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                style={{
                  width: 72, padding: '7px 10px', borderRadius: 8,
                  border: '2px solid var(--border-color)',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  fontFamily: HAND, fontSize: 19, fontWeight: 800, textAlign: 'center',
                }}
              />
            </div>

            {error && (
              <div style={{
                padding: '12px 14px', marginBottom: 16,
                background: 'color-mix(in srgb, #f87171 12%, var(--bg-secondary))',
                border: '1.5px solid #f87171', borderRadius: 10,
                color: '#f87171', fontSize: 14, fontWeight: 700,
              }}>{error}</div>
            )}

            <button onClick={generate} disabled={fase === 'generando'} style={{
              width: '100%', padding: '16px',
              background: fase === 'generando' ? 'var(--bg-secondary)' : themeColor,
              color: fase === 'generando' ? 'var(--text-faint)' : '#000',
              border: '2.5px solid var(--text-primary)',
              borderRadius: 12, cursor: fase === 'generando' ? 'not-allowed' : 'pointer',
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              boxShadow: fase === 'generando' ? 'none' : '3px 4px 0 var(--text-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'all 0.2s',
            }}>
              {fase === 'generando' ? (
                <>
                  <div style={{ width: 16, height: 16, border: '2px solid var(--text-faint)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
                  Generando quiz...
                </>
              ) : `🚀 Empezar · ${count} preguntas · ${nivelActual.label}`}
            </button>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </Base>
    );
  }

  // ══════════════════════════════
  // RESULTADO
  // ══════════════════════════════
  if (fase === 'resultado') {
    const emoji = porcentaje >= 80 ? '🏆' : porcentaje >= 60 ? '💪' : porcentaje >= 40 ? '📚' : '😅';
    const msg   = porcentaje >= 80 ? '¡Excelente dominio!'
      : porcentaje >= 60 ? '¡Buen trabajo! Repasa lo que fallaste.'
      : 'Necesitas repasar más el material.';

    return (
      <Base>
        <Header/>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 24, gap: 20, position: 'relative', zIndex: 1, overflow: 'auto',
        }}>
          <div style={{ fontSize: 80 }}>{emoji}</div>
          <h1 style={{ fontSize: 72, fontWeight: 900, color: themeColor, margin: 0, lineHeight: 1 }}>
            {porcentaje}%
          </h1>
          <p style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {puntos} de {preguntas.length} correctas
          </p>
          <p style={{ fontSize: 18, color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
            {msg}
          </p>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 420 }}>
            {resultados.map((ok, i) => (
              <div key={i} style={{
                width: 38, height: 38, borderRadius: 8,
                background: ok
                  ? 'color-mix(in srgb, #4ade80 18%, var(--bg-card))'
                  : 'color-mix(in srgb, #f87171 18%, var(--bg-card))',
                border: `2px solid ${ok ? '#4ade80' : '#f87171'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 900,
                color: ok ? '#4ade80' : '#f87171',
              }}>
                {ok ? '✓' : '✗'}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={reiniciar} style={{
              padding: '14px 28px', borderRadius: 12,
              background: themeColor, color: '#000',
              border: '2.5px solid var(--text-primary)',
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              cursor: 'pointer', boxShadow: '3px 4px 0 var(--text-primary)',
            }}>🔄 Repetir quiz</button>
            <button onClick={() => setFase('config')} style={{
              padding: '14px 28px', borderRadius: 12,
              background: 'var(--bg-card)', color: 'var(--text-primary)',
              border: '2.5px solid var(--text-primary)',
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              cursor: 'pointer', boxShadow: '3px 4px 0 var(--text-primary)',
            }}>⚙️ Nuevo quiz</button>
          </div>
        </div>
      </Base>
    );
  }

  // ══════════════════════════════
  // JUGANDO
  // ══════════════════════════════
  if (!preguntaActual) return null;

  return (
    <Base>
      <Header right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontFamily: HAND, fontSize: 14, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            {nivelActual.emoji} {nivelActual.label}
          </div>
          <div style={{ fontFamily: HAND, fontSize: 22, fontWeight: 900, color: themeColor }}>
            {puntos} pts
          </div>
          <button onClick={() => setFase('resultado')} style={{
            background: 'transparent', border: '1.5px solid var(--border-color)',
            padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
            fontFamily: HAND, fontSize: 14, color: 'var(--text-muted)',
          }}>ver resultado</button>
        </div>
      }/>

      {/* Barra progreso */}
      <div style={{ height: 5, background: 'var(--border-color)', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${progreso}%`, background: themeColor, transition: 'width 0.4s ease' }}/>
      </div>

      {/* Indicadores */}
      <div style={{
        padding: '10px 24px', display: 'flex', gap: 4,
        flexWrap: 'wrap', flexShrink: 0, position: 'relative', zIndex: 1,
      }}>
        {preguntas.map((_, i) => (
          <div key={i} style={{
            width: i === idx ? 28 : 10, height: 10, borderRadius: 5,
            background: resultados[i] === true ? '#4ade80'
              : resultados[i] === false ? '#f87171'
              : i === idx ? themeColor
              : 'var(--border-color)',
            border: i === idx ? '1.5px solid var(--text-primary)' : 'none',
            transition: 'all 0.25s',
          }}/>
        ))}
        <span style={{ marginLeft: 'auto', fontFamily: HAND, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
          {idx + 1} / {preguntas.length}
        </span>
      </div>

      {/* Contenido */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '16px 24px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 16,
        position: 'relative', zIndex: 1,
      }}>
        {/* Pregunta */}
        <div style={{
          width: '100%', maxWidth: 700,
          background: 'var(--bg-card)',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 14, padding: '24px 28px',
          boxShadow: '4px 5px 0 var(--text-primary)',
          transform: 'rotate(-0.3deg)',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: -11, left: 20,
            transform: 'rotate(-2deg)',
            background: themeColor,
            padding: '2px 14px', borderRadius: 4,
            fontFamily: HAND, fontSize: 14, fontWeight: 800, color: '#000',
          }}>
            Pregunta {idx + 1}
          </div>
          <p style={{
            fontFamily: BODY, fontSize: 18, fontWeight: 600,
            color: 'var(--text-primary)', margin: '8px 0 0', lineHeight: 1.65,
          }}>
            <MathText text={preguntaActual.pregunta} />
          </p>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic', fontFamily: HAND }}>
            💡 Teclas 1-4 para responder · Enter para continuar
          </div>
        </div>

        {/* Opciones */}
        <div style={{ width: '100%', maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {preguntaActual.opciones.map((opcion, i) => {
            const esCorrecta    = i === preguntaActual.correcta;
            const esSeleccionada = i === seleccionada;
            let bg     = 'var(--bg-card)';
            let border = 'var(--border-color)';
            let color  = 'var(--text-primary)';
            let shadow = '2px 3px 0 var(--text-primary)';

            if (respondida) {
              if (esCorrecta) {
                bg = 'color-mix(in srgb, #4ade80 18%, var(--bg-card))';
                border = '#4ade80'; color = '#4ade80'; shadow = '2px 3px 0 #4ade80';
              } else if (esSeleccionada) {
                bg = 'color-mix(in srgb, #f87171 18%, var(--bg-card))';
                border = '#f87171'; color = '#f87171'; shadow = '2px 3px 0 #f87171';
              } else {
                color = 'var(--text-faint)';
              }
            }

            return (
              <button key={i} onClick={() => responder(i)} disabled={respondida} style={{
                width: '100%', padding: '14px 20px',
                background: bg, border: `2.5px solid ${border}`,
                borderRadius: 12, cursor: respondida ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 14,
                boxShadow: shadow, transition: 'all 0.2s',
              }}>
                <span style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: respondida && esCorrecta ? '#4ade80'
                    : respondida && esSeleccionada ? '#f87171'
                    : 'var(--bg-secondary)',
                  border: `2px solid ${border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: HAND, fontSize: 17, fontWeight: 900,
                  color: respondida && (esCorrecta || esSeleccionada) ? '#000' : color,
                  flexShrink: 0,
                }}>
                  {respondida && esCorrecta ? '✓' : respondida && esSeleccionada ? '✗' : String.fromCharCode(65 + i)}
                </span>
                <span style={{ fontFamily: BODY, fontSize: 16, fontWeight: 500, color, textAlign: 'left', lineHeight: 1.4 }}>
                  <MathText text={opcion} />
                </span>
              </button>
            );
          })}
        </div>

        {/* Explicación */}
        {respondida && (
          <div style={{
            width: '100%', maxWidth: 700,
            background: seleccionada === preguntaActual.correcta
              ? 'color-mix(in srgb, #4ade80 10%, var(--bg-card))'
              : 'color-mix(in srgb, #f87171 10%, var(--bg-card))',
            border: `2px solid ${seleccionada === preguntaActual.correcta ? '#4ade80' : '#f87171'}`,
            borderRadius: 12, padding: '16px 20px',
            boxShadow: '3px 4px 0 var(--text-primary)',
            animation: 'fadeIn 0.3s ease',
          }}>
            <div style={{
              fontFamily: HAND, fontSize: 20, fontWeight: 900,
              color: seleccionada === preguntaActual.correcta ? '#4ade80' : '#f87171',
              marginBottom: 8,
            }}>
              {seleccionada === preguntaActual.correcta ? '✅ ¡Correcto!' : '❌ Incorrecto'}
            </div>
            <p style={{ fontFamily: BODY, fontSize: 15, lineHeight: 1.65, color: 'var(--text-primary)', margin: 0 }}>
              <MathText text={preguntaActual.explicacion} />
            </p>
          </div>
        )}

        <div style={{ height: 80 }}/>
      </div>

      {/* Botón siguiente fijo abajo */}
      {respondida && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '16px 24px',
          background: 'var(--bg-primary)',
          borderTop: '2px solid var(--border-color)',
          display: 'flex', justifyContent: 'center', zIndex: 20,
        }}>
          <button onClick={siguiente} style={{
            padding: '14px 56px', borderRadius: 12,
            background: themeColor, color: '#000',
            border: '2.5px solid var(--text-primary)',
            fontFamily: HAND, fontSize: 22, fontWeight: 900,
            cursor: 'pointer', boxShadow: '3px 4px 0 var(--text-primary)',
          }}>
            {idx + 1 >= preguntas.length ? 'Ver resultado →' : 'Siguiente →'}
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeIn  { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </Base>
  );
}
"""

quiz_page.write_text(new_quiz, encoding='utf-8')
print("✅ QuizPage.tsx reescrito")

# ══════════════════════════════════════════════
# 2) TemaView.tsx — conectar quiz igual que flashcards
# ══════════════════════════════════════════════
tema_view = Path("components/materias/TemaView.tsx")
tv = tema_view.read_text(encoding='utf-8')

# Cambiar onOpenQuiz para pasar materiales + seleccion igual que flashcards
old_quiz_call = """      onOpenQuiz={() => onOpenQuiz?.()}"""

new_quiz_call = """      onOpenQuiz={() => {
              const matsSeleccionados = tema.documentos.filter((d: any) => selectedIds.includes(d.id));
              const rawSel = Array.isArray(seleccionResult) ? seleccionResult : [];

              const normalizePages = (value: any): number[] => {
                if (Array.isArray(value)) {
                  return Array.from(new Set(
                    value.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
                  )).sort((a: number, b: number) => a - b);
                }
                if (value && typeof value === 'object') {
                  const start = Number(value.start ?? value.from ?? value.startPage ?? value.paginaInicial);
                  const end   = Number(value.end   ?? value.to   ?? value.endPage   ?? value.paginaFinal);
                  if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
                    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
                  }
                }
                return [];
              };

              const normalizedSel = matsSeleccionados
                .map((mat: any, idx: number) => {
                  const matMaterialId = String(mat?.materialId || mat?.material_id || mat?.id || '');
                  const matDocumentId = String(mat?.id || '');
                  const rawByIndex = rawSel.find((c: any) => Number(c?.materialIndex) === idx) || null;
                  const rawById    = rawSel.find((c: any) => {
                    const ids = [c?.materialId, c?.material_id, c?.documentId, c?.id]
                      .filter(Boolean).map((v: any) => String(v));
                    return ids.includes(matMaterialId) || ids.includes(matDocumentId);
                  }) || null;
                  const item: any = rawByIndex ?? rawById ?? rawSel[idx] ?? null;
                  if (!item) return null;
                  const pages = [item?.pages, item?.selectedPages, item?.paginas, item?.range]
                    .map(normalizePages)
                    .find((arr: any) => Array.isArray(arr) && arr.length > 0) || [];
                  const text = item?.text || item?.texto || item?.content || undefined;
                  if (!pages.length && !text) return null;
                  return { materialId: matMaterialId, documentId: matDocumentId, materialIndex: idx, pages, text };
                })
                .filter(Boolean);

              onOpenQuiz?.(matsSeleccionados, normalizedSel.length ? normalizedSel : undefined);
            }}"""

if old_quiz_call in tv:
    tv = tv.replace(old_quiz_call, new_quiz_call, 1)
    print("✅ TemaView: onOpenQuiz actualizado")
else:
    print("❌ TemaView: no matcheó onOpenQuiz")

# También actualizar onConfirm para que abra quiz cuando enfoqueElegido === 'practico'
old_confirm = """          onConfirm={(resultado) => {
            setSeleccionResult(resultado);
            setShowSeleccion(false);
            if (enfoqueElegido === 'teorico') {
              setOpenTeorico(true);
            }
          }}"""

new_confirm = """          onConfirm={(resultado) => {
            setSeleccionResult(resultado);
            setShowSeleccion(false);
            if (enfoqueElegido === 'teorico') {
              setOpenTeorico(true);
            } else if (enfoqueElegido === 'practico') {
              // Quiz: abrir directamente con la selección
              const matsSeleccionados = tema.documentos.filter((d: any) => selectedIds.includes(d.id));
              onOpenQuiz?.(matsSeleccionados, resultado as any);
            }
          }}"""

if old_confirm in tv:
    tv = tv.replace(old_confirm, new_confirm, 1)
    print("✅ TemaView: onConfirm conecta practico → quiz")
else:
    print("❌ TemaView: no matcheó onConfirm")

tema_view.write_text(tv, encoding='utf-8')

# ══════════════════════════════════════════════
# 3) app/materias/page.tsx — pasar seleccion a QuizPage
# ══════════════════════════════════════════════
page = Path("app/materias/page.tsx")
pt = page.read_text(encoding='utf-8')

# Añadir estado quizSeleccion
old_state = """  const [flashcardsSessionId, setFlashcardsSessionId] = useState<string | null>(null);"""
new_state = """  const [flashcardsSessionId, setFlashcardsSessionId] = useState<string | null>(null);
  const [quizMateriales, setQuizMateriales]   = useState<any[]>([]);
  const [quizSeleccion,  setQuizSeleccion]    = useState<any[] | undefined>(undefined);"""

if old_state in pt and 'quizMateriales' not in pt:
    pt = pt.replace(old_state, new_state, 1)
    print("✅ page.tsx: estados quiz añadidos")
else:
    print("⚠️ page.tsx: estado ya existe o no matcheó")

# Actualizar onOpenQuiz para recibir materiales + seleccion
old_open_quiz = """            onOpenQuiz={() => setVista('quiz')}"""
new_open_quiz = """            onOpenQuiz={(mats?: any[], sel?: any[]) => {
              setQuizMateriales(mats || temaActual?.documentos || []);
              setQuizSeleccion(sel);
              setVista('quiz');
            }}"""

if old_open_quiz in pt:
    pt = pt.replace(old_open_quiz, new_open_quiz, 1)
    print("✅ page.tsx: onOpenQuiz actualizado")
else:
    print("❌ page.tsx: no matcheó onOpenQuiz")

# Pasar props a QuizPage
old_quiz_page = """          <QuizPage
            materiales={temaActual.documentos}
            tema={temaActual}
            materia={materiaActual}
            onBack={() => setVista('tema')}
          />"""

new_quiz_page = """          <QuizPage
            materiales={quizMateriales.length > 0 ? quizMateriales : temaActual.documentos}
            seleccion={quizSeleccion}
            tema={temaActual}
            materia={materiaActual}
            onBack={() => { setVista('tema'); setQuizMateriales([]); setQuizSeleccion(undefined); }}
          />"""

if old_quiz_page in pt:
    pt = pt.replace(old_quiz_page, new_quiz_page, 1)
    print("✅ page.tsx: QuizPage recibe seleccion")
else:
    print("❌ page.tsx: no matcheó QuizPage props")

page.write_text(pt, encoding='utf-8')

# ══════════════════════════════════════════════
# 4) EnfoqueWheel — añadir enfoque 'practico'
# ══════════════════════════════════════════════
# Buscar el componente EnfoqueWheel
wheel_candidates = [
    Path("components/materias/TeoricoWorkspace.tsx"),
    Path("components/EnfoqueWheel.tsx"),
    Path("components/materias/EnfoqueWheel.tsx"),
]
wheel_path = None
for c in wheel_candidates:
    if c.exists():
        content = c.read_text(encoding='utf-8')
        if 'EnfoqueWheel' in content or 'enfoque' in content.lower():
            wheel_path = c
            print(f"✅ EnfoqueWheel encontrado en: {c}")
            break

if not wheel_path:
    print("⚠️ EnfoqueWheel no encontrado — buscar manualmente")

print("\\n🎉 Listo. El quiz ahora recibe los materiales y páginas seleccionados.")
