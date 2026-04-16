'use client';

import { useState } from 'react';
import { registrarEstudioHoy } from '../../lib/racha';
import { registrarResultado } from '../../lib/storage';
import { useIdioma } from '../../hooks/useIdioma';
import { getIdioma } from '../../lib/i18n';

registrarEstudioHoy();

interface Flashcard {
  question: string;
  answer: string;
}

interface Resultado {
  nivel: 'INSANE' | 'correcta' | 'medio_correcta' | 'incorrecta' | 'muy_incorrecta';
  porcentaje: number;
  explicacion: string;
  consejo: string;
}

interface Props {
  flashcards: Flashcard[];
  onClose: () => void;
  temaColor: string;
  onModoExamen?: () => void;
  materiaId?: string;
  materiaNombre?: string;
  materiaColor?: string;
}

const getNivelInfo = (idioma: string) => ({
  INSANE: { emoji: '🔥', label: 'INSANE', color: '#f5c842', bg: '#f5c84220' },
  correcta: { emoji: '✅', label: idioma === 'en' ? 'Correct' : 'Correcta', color: '#4ade80', bg: '#4ade8020' },
  medio_correcta: { emoji: '🟡', label: idioma === 'en' ? 'Half correct' : 'Medio correcta', color: '#fb923c', bg: '#fb923c20' },
  incorrecta: { emoji: '❌', label: idioma === 'en' ? 'Incorrect' : 'Incorrecta', color: '#ff4d6d', bg: '#ff4d6d20' },
  muy_incorrecta: { emoji: '💀', label: idioma === 'en' ? 'Very wrong' : 'Muy incorrecta', color: '#888', bg: '#88888820' },
});

type Modo = 'seleccionar' | 'estudio' | 'repaso' | 'fin';
type ModoEstudio = 'lineal' | 'bucle';

export default function EstudioModal({ flashcards, onClose, temaColor, onModoExamen, materiaId, materiaNombre, materiaColor }: Props) {
  const { tr, idioma } = useIdioma();
  const NIVEL_INFO = getNivelInfo(idioma);

  const [modo, setModo] = useState<Modo>('seleccionar');
  const [modoEstudio, setModoEstudio] = useState<ModoEstudio>('lineal');

  const [orden, setOrden] = useState<number[]>([]);
  const [cola, setCola] = useState<number[]>([]);
  const [idx, setIdx] = useState(0);
  const [fase, setFase] = useState<'pregunta' | 'resultado'>('pregunta');
  const [respuesta, setRespuesta] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [mostrarRespuesta, setMostrarRespuesta] = useState(false);
  const [stats, setStats] = useState<{ [nivel: string]: number }>({
    INSANE: 0, correcta: 0, medio_correcta: 0, incorrecta: 0, muy_incorrecta: 0,
  });

  const [repasoIdx, setRepasoIdx] = useState(0);
  const [repasoOrden, setRepasoOrden] = useState<number[]>([]);
  const [repasoRespuesta, setRepasoRespuesta] = useState('');
  const [repasoResultado, setRepasoResultado] = useState<Resultado | null>(null);
  const [repasoCargando, setRepasoCargando] = useState(false);
  const [repasoMostrarRespuesta, setRepasoMostrarRespuesta] = useState(false);
  const [repasoStats, setRepasoStats] = useState<{ [nivel: string]: number }>({
    INSANE: 0, correcta: 0, medio_correcta: 0, incorrecta: 0, muy_incorrecta: 0,
  });
  const [repasoFase, setRepasoFase] = useState<'pregunta' | 'resultado'>('pregunta');
  const [esRepaso, setEsRepaso] = useState(false);

  const mezclar = (arr: number[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const iniciarEstudio = () => {
    const indices = mezclar(flashcards.map((_, i) => i));
    setOrden(indices);
    setCola([]);
    setIdx(0);
    setFase('pregunta');
    setStats({ INSANE: 0, correcta: 0, medio_correcta: 0, incorrecta: 0, muy_incorrecta: 0 });
    setEsRepaso(false);
    setModo('estudio');
    setRespuesta('');
    setResultado(null);
    setMostrarRespuesta(false);
  };

  const iniciarRepaso = () => {
    const indices = mezclar(flashcards.map((_, i) => i));
    setRepasoOrden(indices);
    setRepasoIdx(0);
    setRepasoRespuesta('');
    setRepasoResultado(null);
    setRepasoMostrarRespuesta(false);
    setRepasoStats({ INSANE: 0, correcta: 0, medio_correcta: 0, incorrecta: 0, muy_incorrecta: 0 });
    setRepasoFase('pregunta');
    setEsRepaso(true);
    setModo('repaso');
  };

  const cardActual = () => {
    if (cola.length > 0) return flashcards[cola[0]];
    if (idx < orden.length) return flashcards[orden[idx]];
    return null;
  };

  const cardActualIdx = () => {
    if (cola.length > 0) return cola[0];
    return orden[idx];
  };

  const completados = Object.values(stats).reduce((a, b) => a + b, 0);

  // ✅ Helper para registrar resultado en perfil
  const registrarEnPerfil = (pregunta: string, nivel: string) => {
    if (!materiaId) return;
    const acerto = nivel === 'INSANE' || nivel === 'correcta' || nivel === 'medio_correcta';
    registrarResultado(
      pregunta,
      acerto,
      materiaId,
      materiaNombre || 'Estudio',
      materiaColor || temaColor,
    );
  };

  const evaluar = async () => {
    const card = cardActual();
    if (!respuesta.trim() || !card) return;
    setCargando(true);
    try {
      const res = await fetch('/api/evaluar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pregunta: card.question,
          respuestaCorrecta: card.answer,
          respuestaUsuario: respuesta,
          idioma: getIdioma(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const r = data.resultado;
        setResultado(r);
        setStats(prev => ({ ...prev, [r.nivel]: (prev[r.nivel] || 0) + 1 }));
        setFase('resultado');

        // ✅ Registrar en perfil
        registrarEnPerfil(card.question, r.nivel);
      }
    } catch (err) { console.error(err); }
    finally { setCargando(false); }
  };

  const siguiente = () => {
    if (!resultado) return;
    const esMala = resultado.nivel === 'incorrecta' || resultado.nivel === 'muy_incorrecta';
    const cidx = cardActualIdx();

    if (cola.length > 0) {
      const nuevaCola = cola.slice(1);
      if (esMala && modoEstudio === 'bucle') nuevaCola.push(cidx);
      setCola(nuevaCola);
      if (nuevaCola.length === 0 && idx >= orden.length) { setModo('fin'); return; }
    } else {
      if (esMala && modoEstudio === 'bucle') setCola(prev => [...prev, cidx]);
      const newIdx = idx + 1;
      setIdx(newIdx);
      if (newIdx >= orden.length && !(esMala && modoEstudio === 'bucle') && cola.length === 0) {
        setModo('fin'); return;
      }
    }

    setRespuesta('');
    setResultado(null);
    setMostrarRespuesta(false);
    setFase('pregunta');
  };

  const repasoCardActual = () => {
    if (repasoIdx < repasoOrden.length) return flashcards[repasoOrden[repasoIdx]];
    return null;
  };

  const repasoCompletados = Object.values(repasoStats).reduce((a, b) => a + b, 0);

  const evaluarRepaso = async () => {
    const card = repasoCardActual();
    if (!repasoRespuesta.trim() || !card) return;
    setRepasoCargando(true);
    try {
      const res = await fetch('/api/evaluar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pregunta: card.question,
          respuestaCorrecta: card.answer,
          respuestaUsuario: repasoRespuesta,
          idioma: getIdioma(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const r = data.resultado;
        setRepasoResultado(r);
        setRepasoStats(prev => ({ ...prev, [r.nivel]: (prev[r.nivel] || 0) + 1 }));
        setRepasoFase('resultado');

        // ✅ Registrar en perfil
        registrarEnPerfil(card.question, r.nivel);
      }
    } catch (err) { console.error(err); }
    finally { setRepasoCargando(false); }
  };

  const siguienteRepaso = () => {
    const newIdx = repasoIdx + 1;
    if (newIdx >= repasoOrden.length) {
      setModo('fin');
      return;
    }
    setRepasoIdx(newIdx);
    setRepasoRespuesta('');
    setRepasoResultado(null);
    setRepasoMostrarRespuesta(false);
    setRepasoFase('pregunta');
  };

  const reiniciar = () => {
    setModo('seleccionar');
    setEsRepaso(false);
  };

  const card = cardActual();
  const progreso = orden.length > 0 ? Math.round((idx / orden.length) * 100) : 0;
  const repasoCard = repasoCardActual();
  const repasoProgreso = repasoOrden.length > 0 ? Math.round((repasoIdx / repasoOrden.length) * 100) : 0;

  // ===== PANTALLA SELECCIONAR =====
  if (modo === 'seleccionar') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000, alignItems: 'center', justifyContent: 'center', padding: '24px', overflowY: 'auto' }}>
        <div style={{ maxWidth: '560px', width: '100%', paddingTop: '20px', paddingBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 900, color: '#fff', margin: 0 }}>{tr('modoEstudioTitle')}</h2>
              <p style={{ color: '#888', margin: 0, fontSize: '14px' }}>{flashcards.length} {tr('disponibles')}</p>
            </div>
            <button onClick={onClose}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              ✕ {tr('salir')}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

            <div style={{ background: '#0d0d1a', borderRadius: '20px', border: `2px solid ${temaColor}44`, overflow: 'hidden' }}>
              <div style={{ height: '4px', background: temaColor }} />
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '26px' }}>✍️</div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: 0 }}>{tr('escritura')}</h3>
                    <p style={{ color: '#888', margin: 0, fontSize: '12px' }}>{tr('escribeTuRespuesta')}</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  {([
                    { id: 'lineal', label: tr('lineal'), desc: tr('unaVez') },
                    { id: 'bucle', label: tr('bucle'), desc: tr('repiteFalles') },
                  ] as const).map(m => (
                    <button key={m.id} onClick={() => setModoEstudio(m.id)}
                      style={{ flex: 1, padding: '10px', borderRadius: '10px', border: `2px solid ${modoEstudio === m.id ? temaColor : '#333'}`, background: modoEstudio === m.id ? temaColor + '20' : 'transparent', cursor: 'pointer', transition: 'all 0.2s' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: modoEstudio === m.id ? temaColor : '#aaa' }}>{m.label}</div>
                      <div style={{ fontSize: '10px', color: modoEstudio === m.id ? temaColor + 'cc' : '#555', marginTop: '2px' }}>{m.desc}</div>
                    </button>
                  ))}
                </div>

                {modoEstudio === 'bucle' && (
                  <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>
                      🔁 {idioma === 'en' ? 'Failed cards repeat until mastered.' : 'Las flashcards que falles se repiten hasta dominarlas.'}
                    </p>
                  </div>
                )}

                <button onClick={iniciarEstudio}
                  style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: temaColor, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                  🚀 {tr('empezarEstudio')}
                </button>
              </div>
            </div>

            <div style={{ background: '#0d0d1a', borderRadius: '20px', border: '2px solid #38bdf844', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: '#38bdf8' }} />
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <div style={{ fontSize: '26px' }}>⚡</div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: 0 }}>{tr('repasoRapido')}</h3>
                    <p style={{ color: '#888', margin: 0, fontSize: '12px' }}>
                      {idioma === 'en'
                        ? 'Write your answer — each card exactly once, no repeats'
                        : 'Escribe tu respuesta — cada card exactamente una vez, sin repetir'}
                    </p>
                  </div>
                </div>
                <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', border: '1px solid #333' }}>
                  <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>
                    ⚡ {idioma === 'en'
                      ? 'Unlike study mode, failed cards are NOT repeated. Every card appears exactly once.'
                      : 'A diferencia del modo estudio, las cards falladas NO se repiten. Cada card aparece una sola vez.'}
                  </p>
                </div>
                <button onClick={iniciarRepaso}
                  style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: '#38bdf8', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                  ⚡ {tr('empezarRepaso')}
                </button>
              </div>
            </div>

            {onModoExamen && (
              <div style={{ background: '#0d0d1a', borderRadius: '20px', border: '2px solid #a78bfa44', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: '#a78bfa' }} />
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                    <div style={{ fontSize: '26px' }}>📚</div>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: 0 }}>
                        {idioma === 'en' ? 'Exam Mode' : 'Modo Examen'}
                      </h3>
                      <p style={{ color: '#888', margin: 0, fontSize: '12px' }}>
                        {idioma === 'en'
                          ? 'All flashcards from ALL your subjects — written answers'
                          : 'Todas las flashcards de TODAS tus materias — respuestas escritas'}
                      </p>
                    </div>
                  </div>
                  <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>
                      📚 {idioma === 'en'
                        ? 'Combines flashcards from ALL subjects. Choose linear or loop mode. Perfect for exam prep.'
                        : 'Combina flashcards de TODAS las materias. Elige modo lineal o bucle. Perfecto para preparar exámenes.'}
                    </p>
                  </div>
                  <button
                    onClick={() => { onClose(); onModoExamen(); }}
                    style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: '#a78bfa', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                    📚 {idioma === 'en' ? 'Start Exam Mode' : 'Iniciar Modo Examen'}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    );
  }

  // ===== REPASO RÁPIDO =====
  if (modo === 'repaso') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>
        <div style={{ padding: '12px 20px', background: '#1a1a2e', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: 0 }}>⚡ {tr('repasoRapido')}</h2>
            <span style={{ fontSize: '12px', color: '#888' }}>
              {repasoIdx + 1} / {repasoOrden.length} · {idioma === 'en' ? 'no repeats' : 'sin repetir'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={reiniciar}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
              ← {tr('volver')}
            </button>
            <button onClick={onClose}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
              ✕
            </button>
          </div>
        </div>

        <div style={{ height: '4px', background: '#1a1a2e', flexShrink: 0 }}>
          <div style={{ width: `${repasoProgreso}%`, height: '100%', background: '#38bdf8', transition: 'width 0.4s' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', padding: '6px', background: '#111', flexShrink: 0 }}>
          {Object.entries(NIVEL_INFO).map(([key, info]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '3px', opacity: repasoStats[key] > 0 ? 1 : 0.2 }}>
              <span style={{ fontSize: '12px' }}>{info.emoji}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff' }}>{repasoStats[key]}</span>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflow: 'auto' }}>
          <div style={{ maxWidth: '680px', width: '100%' }}>

            {!repasoCard ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '60px', marginBottom: '16px' }}>🎉</div>
                <h3 style={{ color: '#fff', fontSize: '22px', margin: '0 0 8px' }}>
                  {idioma === 'en' ? 'Quick review done!' : '¡Repaso rápido completado!'}
                </h3>
                <p style={{ color: '#888', marginBottom: '20px' }}>{repasoCompletados} {idioma === 'en' ? 'cards reviewed' : 'cards repasadas'}</p>
                <button onClick={() => setModo('fin')}
                  style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: '#38bdf8', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                  {idioma === 'en' ? 'See results' : 'Ver resultados'}
                </button>
              </div>
            ) : (
              <>
                <div style={{ background: '#0d0d1a', borderRadius: '20px', border: '2px solid #38bdf844', overflow: 'hidden', marginBottom: '16px' }}>
                  <div style={{ height: '4px', background: '#38bdf8' }} />
                  <div style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <p style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>
                        {idioma === 'en' ? 'Question' : 'Pregunta'} {repasoIdx + 1}/{repasoOrden.length}
                      </p>
                      <span style={{ fontSize: '10px', background: '#38bdf820', color: '#38bdf8', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                        ⚡ {idioma === 'en' ? '1 time only' : '1 sola vez'}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.5 }}>{repasoCard.question}</h3>
                  </div>
                </div>

                {repasoFase === 'pregunta' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <textarea
                      value={repasoRespuesta}
                      onChange={e => setRepasoRespuesta(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) evaluarRepaso(); }}
                      placeholder={idioma === 'en' ? 'Write your answer... (Cmd+Enter to evaluate)' : 'Escribe tu respuesta... (Cmd+Enter para evaluar)'}
                      autoFocus
                      style={{ width: '100%', minHeight: '100px', padding: '16px', borderRadius: '14px', border: `2px solid ${repasoRespuesta ? '#38bdf8' : '#333'}`, background: '#0d0d1a', color: '#fff', fontSize: '16px', fontFamily: 'inherit', lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' }}
                    />
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={evaluarRepaso} disabled={!repasoRespuesta.trim() || repasoCargando}
                        style={{ flex: 1, padding: '13px', borderRadius: '12px', border: 'none', background: repasoRespuesta.trim() && !repasoCargando ? '#38bdf8' : '#333', color: repasoRespuesta.trim() && !repasoCargando ? '#000' : '#666', fontSize: '14px', fontWeight: 800, cursor: repasoRespuesta.trim() && !repasoCargando ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}>
                        {repasoCargando ? '⏳ ...' : (idioma === 'en' ? '🧠 Evaluate' : '🧠 Evaluar')}
                      </button>
                      <button onClick={() => setRepasoMostrarRespuesta(!repasoMostrarRespuesta)}
                        style={{ padding: '13px 18px', borderRadius: '12px', border: '2px solid #333', background: 'transparent', color: '#888', fontSize: '14px', cursor: 'pointer' }}>
                        {repasoMostrarRespuesta ? '🙈' : '👁️'}
                      </button>
                    </div>
                    {repasoMostrarRespuesta && (
                      <div style={{ background: '#f5c84215', border: '1px solid #f5c84244', borderRadius: '12px', padding: '14px 16px' }}>
                        <p style={{ fontSize: '10px', color: '#f5c842', fontWeight: 800, margin: '0 0 6px', textTransform: 'uppercase' }}>{tr('respuesta')}</p>
                        <p style={{ fontSize: '15px', color: '#fff', margin: 0, lineHeight: 1.6 }}>{repasoCard.answer}</p>
                      </div>
                    )}
                  </div>
                )}

                {repasoFase === 'resultado' && repasoResultado && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ background: NIVEL_INFO[repasoResultado.nivel].bg, border: `2px solid ${NIVEL_INFO[repasoResultado.nivel].color}`, borderRadius: '16px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ fontSize: '32px' }}>{NIVEL_INFO[repasoResultado.nivel].emoji}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '16px', fontWeight: 900, color: '#fff' }}>{NIVEL_INFO[repasoResultado.nivel].label}</div>
                        <div style={{ fontSize: '12px', color: '#aaa' }}>{repasoResultado.porcentaje}% {idioma === 'en' ? 'correct' : 'correcto'}</div>
                      </div>
                      <div style={{ width: '80px', background: '#1a1a2e', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
                        <div style={{ width: `${repasoResultado.porcentaje}%`, height: '100%', background: NIVEL_INFO[repasoResultado.nivel].color, transition: 'width 1s' }} />
                      </div>
                    </div>

                    <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                      <p style={{ fontSize: '10px', color: '#555', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase' }}>{idioma === 'en' ? 'Your answer' : 'Tu respuesta'}</p>
                      <p style={{ fontSize: '13px', color: '#ccc', margin: 0, lineHeight: 1.5 }}>{repasoRespuesta}</p>
                    </div>

                    <div style={{ background: '#4ade8015', borderRadius: '10px', padding: '12px 14px', border: '1px solid #4ade8044' }}>
                      <p style={{ fontSize: '10px', color: '#4ade80', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase' }}>{idioma === 'en' ? 'Correct answer' : 'Respuesta correcta'}</p>
                      <p style={{ fontSize: '13px', color: '#fff', margin: 0, lineHeight: 1.5 }}>{repasoCard.answer}</p>
                    </div>

                    <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                      <p style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase' }}>💡 {tr('explicacion')}</p>
                      <p style={{ fontSize: '12px', color: '#ccc', margin: 0, lineHeight: 1.5 }}>{repasoResultado.explicacion}</p>
                    </div>

                    <div style={{ background: '#38bdf815', borderRadius: '8px', padding: '8px 12px', border: '1px solid #38bdf844', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>⚡</span>
                      <p style={{ fontSize: '11px', color: '#38bdf8', margin: 0, fontWeight: 600 }}>
                        {idioma === 'en' ? 'Quick review: this card will NOT repeat' : 'Repaso rápido: esta card NO se repetirá'}
                      </p>
                    </div>

                    <button onClick={siguienteRepaso}
                      style={{ padding: '13px', borderRadius: '12px', border: 'none', background: '#38bdf8', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                      {repasoIdx + 1 >= repasoOrden.length
                        ? (idioma === 'en' ? '🎉 See results' : '🎉 Ver resultados')
                        : (idioma === 'en' ? 'Next →' : 'Siguiente →')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===== FIN =====
  if (modo === 'fin') {
    const statsUsados = esRepaso ? repasoStats : stats;
    const completadosUsados = esRepaso ? repasoCompletados : completados;

    const puntuacion = completadosUsados > 0
      ? Math.round(((statsUsados.INSANE * 100 + statsUsados.correcta * 80 + statsUsados.medio_correcta * 55 + statsUsados.incorrecta * 30) / completadosUsados))
      : 0;

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '24px' }}>
        <div style={{ maxWidth: '560px', width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
          <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#fff', margin: '0 0 6px' }}>{tr('sesionCompletada')}</h2>
          <p style={{ color: '#888', marginBottom: '8px' }}>
            {completadosUsados} {idioma === 'en' ? 'cards studied' : 'cards estudiadas'}
          </p>
          {esRepaso && (
            <div style={{ display: 'inline-block', background: '#38bdf820', border: '1px solid #38bdf844', borderRadius: '8px', padding: '3px 12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 700 }}>
                ⚡ {idioma === 'en' ? 'Quick review — no repeats' : 'Repaso rápido — sin repetir'}
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '20px' }}>
            {Object.entries(NIVEL_INFO).map(([key, info]) => (
              <div key={key} style={{ background: info.bg, border: `1px solid ${info.color}44`, borderRadius: '12px', padding: '10px 6px' }}>
                <div style={{ fontSize: '20px' }}>{info.emoji}</div>
                <div style={{ fontSize: '20px', fontWeight: 900, color: '#fff' }}>{statsUsados[key]}</div>
                <div style={{ fontSize: '9px', color: '#888', fontWeight: 600 }}>{info.label}</div>
              </div>
            ))}
          </div>

          <div style={{ background: '#0d0d1a', borderRadius: '16px', padding: '20px', marginBottom: '20px', border: `1px solid ${esRepaso ? '#38bdf844' : temaColor + '44'}` }}>
            <div style={{ fontSize: '44px', fontWeight: 900, color: esRepaso ? '#38bdf8' : temaColor }}>{puntuacion}%</div>
            <div style={{ color: '#888', fontSize: '13px' }}>{idioma === 'en' ? 'Final score' : 'Puntuación final'}</div>
            <div style={{ background: '#1a1a2e', borderRadius: '8px', height: '10px', overflow: 'hidden', marginTop: '12px' }}>
              <div style={{ width: `${puntuacion}%`, height: '100%', background: puntuacion >= 80 ? '#4ade80' : puntuacion >= 60 ? (esRepaso ? '#38bdf8' : temaColor) : '#ff4d6d', borderRadius: '8px', transition: 'width 1s' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={reiniciar}
              style={{ padding: '13px 24px', borderRadius: '12px', border: 'none', background: esRepaso ? '#38bdf8' : temaColor, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
              {tr('otraSesion')}
            </button>
            <button onClick={onClose}
              style={{ padding: '13px 24px', borderRadius: '12px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
              {tr('salir')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== ESTUDIO CON ESCRITURA =====
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>

      <div style={{ padding: '12px 20px', background: '#1a1a2e', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: 0 }}>
            {modoEstudio === 'bucle' ? '🔁' : '➡️'} {tr('escritura')}
          </h2>
          <span style={{ fontSize: '12px', color: '#888' }}>
            {completados} {idioma === 'en' ? 'done' : 'hechas'}
            {cola.length > 0 && <span style={{ color: '#ff4d6d', marginLeft: '8px' }}>· {cola.length} {idioma === 'en' ? 'to repeat' : 'por repetir'}</span>}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={reiniciar}
            style={{ padding: '6px 12px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            ← {tr('volver')}
          </button>
          <button onClick={onClose}
            style={{ padding: '6px 12px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      </div>

      <div style={{ height: '4px', background: '#1a1a2e', flexShrink: 0 }}>
        <div style={{ width: `${progreso}%`, height: '100%', background: temaColor, transition: 'width 0.4s' }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', padding: '6px', background: '#111', flexShrink: 0 }}>
        {Object.entries(NIVEL_INFO).map(([key, info]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '3px', opacity: stats[key] > 0 ? 1 : 0.2 }}>
            <span style={{ fontSize: '12px' }}>{info.emoji}</span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff' }}>{stats[key]}</span>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflow: 'auto' }}>
        <div style={{ maxWidth: '680px', width: '100%' }}>

          {!card ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '60px', marginBottom: '16px' }}>🎉</div>
              <button onClick={() => setModo('fin')}
                style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                {idioma === 'en' ? 'See results' : 'Ver resultados'}
              </button>
            </div>
          ) : (
            <>
              <div style={{ background: '#0d0d1a', borderRadius: '20px', border: `2px solid ${temaColor}44`, overflow: 'hidden', marginBottom: '16px' }}>
                <div style={{ height: '4px', background: temaColor }} />
                <div style={{ padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <p style={{ fontSize: '11px', color: temaColor, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>{tr('pregunta')}</p>
                    {cola.length > 0 && cola[0] === cardActualIdx() && (
                      <span style={{ fontSize: '11px', background: '#ff4d6d20', color: '#ff4d6d', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>🔁 {tr('repeticion')}</span>
                    )}
                  </div>
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.5 }}>{card.question}</h3>
                </div>
              </div>

              {fase === 'pregunta' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <textarea
                    value={respuesta}
                    onChange={e => setRespuesta(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) evaluar(); }}
                    placeholder={idioma === 'en' ? 'Write your answer... (Cmd+Enter to evaluate)' : 'Escribe tu respuesta... (Cmd+Enter para evaluar)'}
                    autoFocus
                    style={{ width: '100%', minHeight: '100px', padding: '16px', borderRadius: '14px', border: `2px solid ${respuesta ? temaColor : '#333'}`, background: '#0d0d1a', color: '#fff', fontSize: '16px', fontFamily: 'inherit', lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' }}
                  />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={evaluar} disabled={!respuesta.trim() || cargando}
                      style={{ flex: 1, padding: '13px', borderRadius: '12px', border: 'none', background: respuesta.trim() && !cargando ? temaColor : '#333', color: respuesta.trim() && !cargando ? '#000' : '#666', fontSize: '14px', fontWeight: 800, cursor: respuesta.trim() && !cargando ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}>
                      {cargando ? '⏳ ...' : (idioma === 'en' ? '🧠 Evaluate' : '🧠 Evaluar')}
                    </button>
                    <button onClick={() => setMostrarRespuesta(!mostrarRespuesta)}
                      style={{ padding: '13px 18px', borderRadius: '12px', border: '2px solid #333', background: 'transparent', color: '#888', fontSize: '14px', cursor: 'pointer' }}>
                      {mostrarRespuesta ? '🙈' : '👁️'}
                    </button>
                  </div>
                  {mostrarRespuesta && (
                    <div style={{ background: '#f5c84215', border: '1px solid #f5c84244', borderRadius: '12px', padding: '14px 16px' }}>
                      <p style={{ fontSize: '10px', color: '#f5c842', fontWeight: 800, margin: '0 0 6px', textTransform: 'uppercase' }}>{tr('respuesta')}</p>
                      <p style={{ fontSize: '15px', color: '#fff', margin: 0, lineHeight: 1.6 }}>{card.answer}</p>
                    </div>
                  )}
                </div>
              )}

              {fase === 'resultado' && resultado && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ background: NIVEL_INFO[resultado.nivel].bg, border: `2px solid ${NIVEL_INFO[resultado.nivel].color}`, borderRadius: '16px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ fontSize: '32px' }}>{NIVEL_INFO[resultado.nivel].emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '16px', fontWeight: 900, color: '#fff' }}>{NIVEL_INFO[resultado.nivel].label}</div>
                      <div style={{ fontSize: '12px', color: '#aaa' }}>{resultado.porcentaje}% {idioma === 'en' ? 'correct' : 'correcto'}</div>
                    </div>
                    <div style={{ width: '80px', background: '#1a1a2e', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
                      <div style={{ width: `${resultado.porcentaje}%`, height: '100%', background: NIVEL_INFO[resultado.nivel].color, transition: 'width 1s' }} />
                    </div>
                  </div>

                  <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '10px', color: '#555', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase' }}>{idioma === 'en' ? 'Your answer' : 'Tu respuesta'}</p>
                    <p style={{ fontSize: '13px', color: '#ccc', margin: 0, lineHeight: 1.5 }}>{respuesta}</p>
                  </div>

                  <div style={{ background: '#4ade8015', borderRadius: '10px', padding: '12px 14px', border: '1px solid #4ade8044' }}>
                    <p style={{ fontSize: '10px', color: '#4ade80', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase' }}>{idioma === 'en' ? 'Correct answer' : 'Respuesta correcta'}</p>
                    <p style={{ fontSize: '13px', color: '#fff', margin: 0, lineHeight: 1.5 }}>{card.answer}</p>
                  </div>

                  <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '10px', color: temaColor, fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase' }}>💡 {tr('explicacion')}</p>
                    <p style={{ fontSize: '12px', color: '#ccc', margin: '0 0 8px', lineHeight: 1.5 }}>{resultado.explicacion}</p>
                    <p style={{ fontSize: '10px', color: '#555', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase' }}>🎯 {tr('consejo')}</p>
                    <p style={{ fontSize: '11px', color: '#aaa', margin: 0, lineHeight: 1.5 }}>{resultado.consejo}</p>
                  </div>

                  {modoEstudio === 'bucle' && (resultado.nivel === 'incorrecta' || resultado.nivel === 'muy_incorrecta') && (
                    <div style={{ background: '#ff4d6d15', borderRadius: '8px', padding: '8px 12px', border: '1px solid #ff4d6d44', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>🔁</span>
                      <p style={{ fontSize: '11px', color: '#ff4d6d', margin: 0, fontWeight: 600 }}>{tr('seRepetira')}</p>
                    </div>
                  )}

                  <button onClick={siguiente}
                    style={{ padding: '13px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                    {tr('siguiente')} →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}