'use client';

import { useState } from 'react';
import { guardarQuiz, guardarQuizTemporal, NivelQuiz } from '../../lib/quizStorage';
import { getIdioma } from '../../lib/i18n';
import MathText from '../MathText';

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
  { id: 'facil',      emoji: '🟢', label: 'Fácil',      desc: 'Definiciones básicas',        color: '#4ade80', presets: [5, 10, 15, 20, 25, 35] },
  { id: 'intermedio', emoji: '🟡', label: 'Intermedio', desc: 'Comprensión y aplicación',    color: '#f5c842', presets: [5, 10, 15, 20, 35, 50] },
  { id: 'dificil',    emoji: '🔴', label: 'Difícil',    desc: 'Análisis y casos especiales', color: '#ff4d6d', presets: [5, 10, 20, 35, 50] },
];


// Detectar idioma del contenido del documento
const detectarIdiomaDoc = (texto: string): 'en' | 'es' => {
  if (!texto || texto.length < 30) return 'es';
  const t = texto.toLowerCase().substring(0, 2000);
  const en = ['the','is','are','was','were','have','has','this','that','with','from','they','what','which','when','how','can','will','would','should','could','about','there','their','been','an','of','in','to','for','on','at','by','or','and','but','a','it','its','we','our','us','them','your','who','not','just','now','also','than','more','some','any','do','does','did','be','been','being','each','other','than','then','these','those','both','few','more','most','other','through','during','before','after','above','below','between','out','off','over','under','again','further','once','here','there','when','where','why','how','all','both','each','every','more','most','other','some','such','no','nor','not','only','same','so','too','very','just'];
  const es = ['que','con','para','por','una','los','las','del','está','son','como','pero','más','muy','todo','este','esta','también','hacer','tiene','pueden','cuando','donde','porque','aunque','se','lo','le','su','el','la','de','en','un','es','al','si','ya','me','mi','tu','yo','hay','fue','ser','estar','bien','hoy','aquí','así','algo','nada','puedo','quiero','necesito','ayuda','gracias','bueno','dame','dime','explica','cuál','quién','cuándo','cómo','qué','había','han','sido','tiene','tienen','entre','sobre','hasta','desde','sin','durante','antes','después','igual','mismo','cada','otro','tanto','menos','nunca','siempre','solo','puede','debe','hacer'];
  const words = t.split(/[\s,\.!?;:\-]+/).filter((w: string) => w.length > 1);
  let enC = 0, esC = 0;
  words.forEach((w: string) => {
    if (en.includes(w)) enC++;
    if (es.includes(w)) esC++;
  });
  if (enC === 0 && esC === 0) {
    const tieneAcentos = /[áéíóúüñ¿¡]/i.test(t);
    return tieneAcentos ? 'es' : 'en';
  }
  return enC > esC ? 'en' : 'es';
};

export default function TabQuiz({ contenido, temaColor, materiaNombre, materiaColor, idioma, esImagen, onQuizGenerado }: Props) {
  // ── config ──────────────────────────────────────────────────────────────────
  const [fase, setFase] = useState<'config' | 'jugando' | 'fin'>('config');
  const [nivel, setNivel] = useState<NivelQuiz>('intermedio');
  const [cantidad, setCantidad] = useState(10);
  const [cantidadPersonalizada, setCantidadPersonalizada] = useState(10);
  const [cargando, setCargando] = useState(false);

  // ── quiz ────────────────────────────────────────────────────────────────────
  const [preguntas, setPreguntas] = useState<PreguntaQuiz[]>([]);
  const [idx, setIdx] = useState(0);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [respondida, setRespondida] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [resultados, setResultados] = useState<{ correcta: boolean }[]>([]);

  // ── guardar ─────────────────────────────────────────────────────────────────
  const [nombreQuiz, setNombreQuiz] = useState('');
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [guardadoTempOk, setGuardadoTempOk] = useState(false);

  const nivelActual = NIVELES.find(n => n.id === nivel) || NIVELES[1];
  const preguntaActual = preguntas[idx];
  const porcentaje = preguntas.length > 0 ? Math.round((puntos / preguntas.length) * 100) : 0;
  const progreso = preguntas.length > 0 ? (idx / preguntas.length) * 100 : 0;

  // ── generar ─────────────────────────────────────────────────────────────────
  const generarQuiz = async () => {
    if (!contenido?.trim() && !esImagen) return;
    setCargando(true);
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contenido, count: cantidad, idioma: detectContentLanguage(contenido || '', idioma === 'en' ? 'en' : 'es'), nivel }),
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
    if (idx + 1 >= preguntas.length) { setFase('fin'); guardarQuizTemporal({ nombre: materiaNombre ? `Quiz ${nivel} - ${materiaNombre}` : `Quiz ${nivel}`, preguntas, materiaNombre, materiaColor, nivel }); setGuardadoTempOk(true); }
    else { setIdx(i => i + 1); setSeleccionada(null); setRespondida(false); }
  };

  const reiniciar = () => {
    setFase('config'); setPreguntas([]); setIdx(0);
    setSeleccionada(null); setRespondida(false); setPuntos(0); setResultados([]);
    setGuardadoOk(false); setGuardadoTempOk(false);
  };

  const getOpcionStyle = (i: number) => {
    if (!respondida || !preguntaActual) return { border: '1px solid var(--border-color)', background: 'transparent' };
    if (i === preguntaActual.correcta) return { border: '2px solid #4ade80', background: 'rgba(74,222,128,0.1)' };
    if (i === seleccionada) return { border: '2px solid #ff4d6d', background: 'rgba(255,77,109,0.1)' };
    return { border: '1px solid var(--border-color)', background: 'transparent' };
  };

  const getLetra = (i: number) => {
    if (!respondida || !preguntaActual) return ['A', 'B', 'C', 'D'][i];
    if (i === preguntaActual.correcta) return '✓';
    if (i === seleccionada) return '✗';
    return ['A', 'B', 'C', 'D'][i];
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  if (fase === 'config') return (
    <div style={{ maxWidth: '620px', margin: '0 auto', padding: '32px 16px' }}>

      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{ fontSize: '56px', marginBottom: '12px' }}>🤓</div>
        <h2 style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 6px' }}>
          Generar Quiz
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
          {idioma === 'en'
            ? '4 options · AI generates wrong ones from the document'
            : '4 opciones · La IA genera las incorrectas desde el documento'}
        </p>
      </div>

      {/* NIVEL */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '18px', padding: '22px', marginBottom: '16px', border: '1px solid var(--border-color)' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-faint)', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {idioma === 'en' ? 'Difficulty level' : 'Nivel de dificultad'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {NIVELES.map(n => (
            <button key={n.id} onClick={() => { setNivel(n.id); setCantidad(n.presets[1]); setCantidadPersonalizada(n.presets[1]); }}
              style={{ padding: '14px 8px', borderRadius: '14px', border: `2px solid ${nivel === n.id ? n.color : 'var(--border-color)'}`, background: nivel === n.id ? n.color + '18' : 'transparent', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s' }}>
              <div style={{ fontSize: '20px', marginBottom: '5px' }}>{n.emoji}</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: nivel === n.id ? n.color : 'var(--text-primary)', marginBottom: '3px' }}>{n.label}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)', lineHeight: 1.3 }}>{n.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* CANTIDAD */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '18px', padding: '22px', marginBottom: '24px', border: '1px solid var(--border-color)' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-faint)', margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {idioma === 'en' ? 'Number of questions' : 'Cantidad de preguntas'}
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {nivelActual.presets.map(n => (
            <button key={n} onClick={() => { setCantidad(n); setCantidadPersonalizada(n); }}
              style={{ padding: '9px 16px', borderRadius: '10px', border: `2px solid ${cantidad === n ? temaColor : 'var(--border-color)'}`, background: cantidad === n ? temaColor + '20' : 'transparent', color: cantidad === n ? temaColor : 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
            {idioma === 'en' ? 'Custom:' : 'Personalizado:'}
          </span>
          <input type="number" min={1} max={100} value={cantidadPersonalizada}
            onChange={e => { const v = Math.min(100, Math.max(1, parseInt(e.target.value) || 1)); setCantidadPersonalizada(v); setCantidad(v); }}
            style={{ width: '65px', padding: '7px 10px', borderRadius: '8px', border: `2px solid ${temaColor}44`, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', fontWeight: 700, textAlign: 'center', outline: 'none' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>
            {idioma === 'en' ? 'max 100' : 'máx. 100'}
          </span>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: '10px 0 0' }}>
          {idioma === 'en'
            ? `Generating ${cantidad} questions · level `
            : `Se generarán ${cantidad} preguntas · nivel `}
          <strong style={{ color: nivelActual.color }}>{nivelActual.label}</strong>
        </p>
      </div>

      <button onClick={generarQuiz} disabled={cargando || (!contenido?.trim() && !esImagen)}
        style={{ width: '100%', padding: '18px', borderRadius: '14px', border: 'none', background: (cargando || (!contenido?.trim() && !esImagen)) ? 'var(--bg-card2)' : temaColor, color: (cargando || (!contenido?.trim() && !esImagen)) ? 'var(--text-faint)' : '#000', fontSize: '16px', fontWeight: 800, cursor: (cargando || (!contenido?.trim() && !esImagen)) ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
        {cargando
          ? (idioma === 'en' ? '⏳ Generating...' : '⏳ Generando quiz...')
          : `🚀 ${idioma === 'en' ? 'Start Quiz' : 'Iniciar Quiz'} · ${cantidad} ${idioma === 'en' ? 'questions' : 'preguntas'}`}
      </button>

      {(!contenido?.trim() && !esImagen) && (
        <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-faint)', marginTop: '12px' }}>
          ⚠️ {idioma === 'en' ? 'Analyze the document first to generate a quiz' : 'Analiza el documento primero para generar un quiz'}
        </p>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER JUGANDO
  // ═══════════════════════════════════════════════════════════════════════════
  if (fase === 'jugando' && preguntaActual) return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '24px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: nivelActual.color + '22', color: nivelActual.color, border: `1px solid ${nivelActual.color}44` }}>
              {nivelActual.emoji} {nivelActual.label}
            </span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            {idioma === 'en' ? 'Question' : 'Pregunta'} {idx + 1} / {preguntas.length} · {puntos} {idioma === 'en' ? 'correct' : 'correctas'}
          </p>
        </div>
        <button onClick={reiniciar}
          style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-faint)', fontSize: '12px', cursor: 'pointer' }}>
          ✕ {idioma === 'en' ? 'Exit' : 'Salir'}
        </button>
      </div>

      {/* Barra progreso */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', height: '5px', overflow: 'hidden', marginBottom: '14px' }}>
        <div style={{ width: `${progreso}%`, height: '100%', background: temaColor, borderRadius: '6px', transition: 'width 0.4s' }} />
      </div>

      {/* Indicadores */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '18px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {preguntas.map((_, i) => (
          <div key={i} style={{ width: i === idx ? '20px' : '8px', height: '8px', borderRadius: '4px', background: i < idx ? (resultados[i]?.correcta ? '#4ade80' : '#ff4d6d') : i === idx ? temaColor : 'var(--border-color)', transition: 'all 0.3s', flexShrink: 0 }} />
        ))}
      </div>

      {/* Pregunta */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '16px', border: `2px solid ${temaColor}44`, overflow: 'hidden', marginBottom: '16px' }}>
        <div style={{ height: '3px', background: temaColor }} />
        <div style={{ padding: '20px 24px' }}>
          <span style={{ fontSize: '11px', color: temaColor, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px' }}>
            {idioma === 'en' ? 'Question' : 'Pregunta'} {idx + 1}
          </span>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: '10px 0 0', lineHeight: 1.5 }}>
            <MathText text={preguntaActual.pregunta} />
          </div>
        </div>
      </div>

      {/* Opciones */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '14px' }}>
        {preguntaActual.opciones.map((opcion, i) => {
          const s = getOpcionStyle(i);
          return (
            <button key={`${idx}-${i}`} onClick={() => responder(i)} disabled={respondida}
              style={{ padding: '13px 16px', borderRadius: '12px', ...s, color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500, cursor: respondida ? 'default' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px', width: '100%', transition: 'all 0.15s' }}>
              <span style={{ width: '30px', height: '30px', borderRadius: '50%', border: '2px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800, color: 'var(--text-muted)', flexShrink: 0 }}>
                {getLetra(i)}
              </span>
              <span style={{ flex: 1 }}>{opcion}</span>
            </button>
          );
        })}
      </div>

      {/* Feedback */}
      {respondida && (
        <>
          <div style={{ background: seleccionada === preguntaActual.correcta ? 'rgba(74,222,128,0.1)' : 'rgba(255,77,109,0.1)', border: `2px solid ${seleccionada === preguntaActual.correcta ? '#4ade8066' : '#ff4d6d66'}`, borderRadius: '12px', padding: '14px 18px', marginBottom: '12px' }}>
            <p style={{ fontSize: '13px', fontWeight: 800, color: seleccionada === preguntaActual.correcta ? '#4ade80' : '#ff4d6d', margin: '0 0 5px' }}>
              {seleccionada === preguntaActual.correcta ? '✅ ¡Correcto!' : '❌ Incorrecto'}
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              <MathText text={preguntaActual.explicacion} />
            </p>
          </div>
          <button onClick={siguiente}
            style={{ width: '100%', padding: '14px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
            {idx + 1 >= preguntas.length
              ? (idioma === 'en' ? '🏁 See Results' : '🏁 Ver Resultados')
              : (idioma === 'en' ? 'Next →' : 'Siguiente →')}
          </button>
        </>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER FIN
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: '620px', margin: '0 auto', padding: '32px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: '56px', marginBottom: '12px' }}>
        {porcentaje >= 80 ? '🏆' : porcentaje >= 60 ? '👍' : '📚'}
      </div>
      <h2 style={{ fontSize: '24px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 6px' }}>
        {idioma === 'en' ? 'Quiz completed!' : '¡Quiz completado!'}
      </h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
        {puntos} {idioma === 'en' ? 'of' : 'de'} {preguntas.length} {idioma === 'en' ? 'correct' : 'correctas'}
      </p>

      {/* Score */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '18px', padding: '24px', border: `2px solid ${temaColor}44`, marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '6px' }}>
          <span style={{ fontSize: '44px', fontWeight: 900, color: temaColor, lineHeight: 1 }}>{puntos}/{preguntas.length}</span>
          <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, background: nivelActual.color + '22', color: nivelActual.color, border: `1px solid ${nivelActual.color}44` }}>
            {nivelActual.emoji} {nivelActual.label}
          </span>
        </div>
        <div style={{ fontSize: '32px', fontWeight: 900, color: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d' }}>
          {porcentaje}%
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
          {porcentaje >= 80 ? '¡Excelente! 🔥' : porcentaje >= 60 ? (idioma === 'en' ? 'Good job 💪' : 'Bien, sigue 💪') : (idioma === 'en' ? 'Study more 📖' : 'Repasa más 📖')}
        </div>
        <div style={{ background: 'var(--bg-card)', borderRadius: '8px', height: '8px', overflow: 'hidden', marginTop: '16px' }}>
          <div style={{ width: `${porcentaje}%`, height: '100%', background: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d', borderRadius: '8px', transition: 'width 1s' }} />
        </div>
      </div>

      {/* Auto-guardado temporal confirmación */}
      {!guardadoOk && (
        <div style={{ padding: '12px 16px', background: '#f5c84212', borderRadius: '12px', border: '1px solid #f5c84244', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px', flexShrink: 0 }}>⏳</span>
          <div style={{ textAlign: 'left' }}>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#f5c842', margin: '0 0 2px' }}>
              {idioma === 'en' ? 'Auto-saved for 24 hours' : 'Guardado automáticamente por 24 horas'}
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>
              {idioma === 'en'
                ? 'Go to Quiz Library → "Pending" and save it permanently before it expires.'
                : 'Ve a Biblioteca de Quizzes → "Por Guardar" y guárdalo permanentemente antes de que expire.'}
            </p>
          </div>
        </div>
      )}

      {/* Guardar permanente */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '14px', padding: '16px 18px', border: `1px solid ${temaColor}44`, marginBottom: '20px', textAlign: 'left' }}>
        <p style={{ fontSize: '12px', fontWeight: 800, color: temaColor, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          💾 {idioma === 'en' ? 'Save permanently' : 'Guardar permanentemente'}
        </p>
        {guardadoOk ? (
          <div style={{ padding: '10px 14px', background: '#4ade8015', borderRadius: '10px', border: '1px solid #4ade8044' }}>
            <p style={{ fontSize: '13px', color: '#4ade80', margin: 0, fontWeight: 600 }}>
              ✅ {idioma === 'en' ? 'Saved to your library!' : '¡Guardado en tu biblioteca!'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="text" value={nombreQuiz} onChange={e => setNombreQuiz(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && nombreQuiz.trim()) {
                  guardarQuiz({ nombre: nombreQuiz, preguntas, materiaNombre, materiaColor, nivel });
                  setGuardadoOk(true); setNombreQuiz('');
                }
              }}
              placeholder={idioma === 'en' ? 'Quiz name... e.g. Topic 1' : 'Nombre del quiz... ej: Tema 1'}
              style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: `2px solid var(--border-color)`, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => e.currentTarget.style.borderColor = temaColor}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
            <button onClick={() => {
              if (!nombreQuiz.trim()) return;
              guardarQuiz({ nombre: nombreQuiz, preguntas, materiaNombre, materiaColor, nivel });
              setGuardadoOk(true); setNombreQuiz('');
            }} disabled={!nombreQuiz.trim()}
              style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: nombreQuiz.trim() ? temaColor : 'var(--bg-card2)', color: nombreQuiz.trim() ? '#000' : 'var(--text-faint)', fontWeight: 800, fontSize: '13px', cursor: nombreQuiz.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
              {idioma === 'en' ? 'Save' : 'Guardar'}
            </button>
          </div>
        )}
      </div>

      {/* Detalle */}
      <div style={{ background: 'var(--bg-secondary)', borderRadius: '14px', padding: '16px', border: '1px solid var(--border-color)', marginBottom: '20px', textAlign: 'left', maxHeight: '220px', overflowY: 'auto' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
          {idioma === 'en' ? 'Question by question' : 'Detalle pregunta por pregunta'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {preguntas.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 10px', background: resultados[i]?.correcta ? 'rgba(74,222,128,0.05)' : 'rgba(255,77,109,0.05)', borderRadius: '8px', border: `1px solid ${resultados[i]?.correcta ? '#4ade8022' : '#ff4d6d22'}` }}>
              <span style={{ fontSize: '13px', flexShrink: 0 }}>{resultados[i]?.correcta ? '✅' : '❌'}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 2px', lineHeight: 1.4 }}>{p.pregunta}</p>
                {!resultados[i]?.correcta && <p style={{ fontSize: '11px', color: '#4ade80', margin: 0 }}>✓ {p.opciones[p.correcta]}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={reiniciar}
          style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
          🔄 {idioma === 'en' ? 'New Quiz' : 'Nuevo Quiz'}
        </button>
        <button onClick={() => window.location.href = '/quizzes'}
          style={{ padding: '12px 24px', borderRadius: '12px', border: `2px solid #a78bfa`, background: 'transparent', color: '#a78bfa', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
          🎓 {idioma === 'en' ? 'My Quizzes' : 'Mis Quizzes'}
        </button>
      </div>
    </div>
  );
}
