'use client';
import { darXP } from '../../lib/xpClient';
import { dispararXPToast } from '../XPToast';
import { calcularXpFlashcards } from '../../lib/xpSystem';

import { useState, useRef } from 'react';
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

// Cuántas tarjetas esperar antes de reinsertar una fallada
const ESPACIADO_MIN = 3;
const ESPACIADO_MAX = 5;
const MAX_REPETICIONES = 999; // sin límite — repite hasta dominar

export default function EstudioModal({ flashcards, onClose, temaColor, onModoExamen, materiaId, materiaNombre, materiaColor }: Props) {
  const { tr, idioma } = useIdioma();
  const NIVEL_INFO = getNivelInfo(idioma);

  const [modo, setModo] = useState<Modo>('seleccionar');
  const [modoEstudio, setModoEstudio] = useState<ModoEstudio>('lineal');

  // Cola única de estudio: array de índices de flashcards
  const [cola, setCola] = useState<number[]>([]);
  const [posicion, setPosicion] = useState(0); // posición actual dentro de la cola
  const [fase, setFase] = useState<'pregunta' | 'resultado'>('pregunta');
  const [respuesta, setRespuesta] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [mostrarRespuesta, setMostrarRespuesta] = useState(false);
  const [stats, setStats] = useState<{ [nivel: string]: number }>({
    INSANE: 0, correcta: 0, medio_correcta: 0, incorrecta: 0, muy_incorrecta: 0,
  });

  // Tracker de repeticiones por card
  const repeticiones = useRef<Map<number, number>>(new Map());
  // Total de cards completadas (para el progreso)
  const [completados, setCompletados] = useState(0);
  const totalOriginal = useRef(0);

  // Repaso rápido (sin repeticiones)
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
    setCola(indices);
    setPosicion(0);
    setFase('pregunta');
    setStats({ INSANE: 0, correcta: 0, medio_correcta: 0, incorrecta: 0, muy_incorrecta: 0 });
    setCompletados(0);
    totalOriginal.current = indices.length;
    repeticiones.current = new Map();
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

  // Card actual del estudio
  const cardActual = posicion < cola.length ? flashcards[cola[posicion]] : null;
  const cardIdx = posicion < cola.length ? cola[posicion] : -1;
  const esRepeticion = cardIdx >= 0 && (repeticiones.current.get(cardIdx) || 0) > 0;

  // Progreso: basado en cards originales completadas
  const progreso = totalOriginal.current > 0
    ? Math.min(100, Math.round((completados / totalOriginal.current) * 100))
    : 0;

  // Cuántas quedan por repetir
  const pendientesRepetir = cola.length - posicion - 1;

  // ── Registrar en perfil ──
  const registrarEnPerfil = (pregunta: string, nivel: string) => {
    if (!materiaId) return;
    const acerto = nivel === 'INSANE' || nivel === 'correcta' || nivel === 'medio_correcta';
    registrarResultado(pregunta, acerto, materiaId, materiaNombre || 'Estudio', materiaColor || temaColor);
  };

  // ── Evaluar respuesta ──
  const evaluar = async () => {
    if (!respuesta.trim() || !cardActual) return;
    setCargando(true);
    try {
      const res = await fetch('/api/evaluar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pregunta: cardActual.question,
          respuestaCorrecta: cardActual.answer,
          respuestaUsuario: respuesta,
          idioma: getIdioma(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const r = data.resultado;
        setResultado(r);
        setStats(prev => ({ ...prev, [r.nivel]: (prev[r.nivel] || 0) + 1 }));
        setCompletados(prev => prev + 1);
        setFase('resultado');
        registrarEnPerfil(cardActual.question, r.nivel);
      }
    } catch (err) { console.error(err); }
    finally { setCargando(false); }
  };

  // ── Siguiente card (con algoritmo de repetición espaciada) ──
  const siguiente = () => {
    if (!resultado) return;
    const esMala = resultado.nivel === 'incorrecta' || resultado.nivel === 'muy_incorrecta' || resultado.nivel === 'medio_correcta';

    if (modoEstudio === 'bucle') {
      if (esMala) {
        // ── FALLÓ: reinsertar 3-5 cards después, siempre ──
        const reps = repeticiones.current.get(cardIdx) || 0;
        repeticiones.current.set(cardIdx, reps + 1);

        const espaciado = ESPACIADO_MIN + Math.floor(Math.random() * (ESPACIADO_MAX - ESPACIADO_MIN + 1));
        const insertPos = Math.min(posicion + 1 + espaciado, cola.length);

        setCola(prev => {
          const nueva = [...prev];
          nueva.splice(insertPos, 0, cardIdx);
          return nueva;
        });
      } else {
        // ── INSANE o correcta: domina la card, se elimina de la cola ──
        if (repeticiones.current.has(cardIdx)) {
          repeticiones.current.delete(cardIdx);
        }
      }
    }

    // Avanzar a la siguiente posición
    const newPos = posicion + 1;
    setPosicion(newPos);

    // ¿Terminamos?
    if (newPos >= cola.length + (modoEstudio === 'bucle' && esMala && (repeticiones.current.get(cardIdx) || 0) <= MAX_REPETICIONES ? 1 : 0)) {
      // Recalcular: si la cola creció por reinserción, puede que no hayamos terminado
    }

    setRespuesta('');
    setResultado(null);
    setMostrarRespuesta(false);
    setFase('pregunta');
  };

  // Verificar si terminamos
  const terminado = posicion >= cola.length;

  // Repaso rápido
  const repasoCard = repasoIdx < repasoOrden.length ? flashcards[repasoOrden[repasoIdx]] : null;
  const repasoCompletados = Object.values(repasoStats).reduce((a, b) => a + b, 0);
  const repasoProgreso = repasoOrden.length > 0 ? Math.round((repasoIdx / repasoOrden.length) * 100) : 0;

  const evaluarRepaso = async () => {
    if (!repasoRespuesta.trim() || !repasoCard) return;
    setRepasoCargando(true);
    try {
      const res = await fetch('/api/evaluar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pregunta: repasoCard.question,
          respuestaCorrecta: repasoCard.answer,
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
        registrarEnPerfil(repasoCard.question, r.nivel);
      }
    } catch (err) { console.error(err); }
    finally { setRepasoCargando(false); }
  };

  const siguienteRepaso = () => {
    const newIdx = repasoIdx + 1;
    if (newIdx >= repasoOrden.length) { setModo('fin'); return; }
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

  // ════════════════════════════════════════════════════════════════════
  // PANTALLA: SELECCIONAR
  // ════════════════════════════════════════════════════════════════════
  if (modo === 'seleccionar') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000, alignItems: 'center', justifyContent: 'center', padding: '24px', overflowY: 'auto' }}>
        <div style={{ maxWidth: '560px', width: '100%', paddingTop: '20px', paddingBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 900, color: '#fff', margin: 0 }}>{tr('modoEstudioTitle')}</h2>
              <p style={{ color: '#888', margin: 0, fontSize: '14px' }}>{flashcards.length} {tr('disponibles')}</p>
            </div>
            <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>✕ {tr('salir')}</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Escritura */}
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
                    { id: 'lineal' as ModoEstudio, label: tr('lineal'), desc: tr('unaVez') },
                    { id: 'bucle' as ModoEstudio, label: tr('bucle'), desc: idioma === 'en' ? 'Repeats until mastered' : 'Se repite hasta dominarla' },
                  ]).map(m => (
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
                      🔁 {idioma === 'en'
                        ? `If you fail a card, it reappears ${ESPACIADO_MIN}-${ESPACIADO_MAX} cards later. It keeps repeating until you answer correctly.`
                        : `Si fallas una card, reaparece ${ESPACIADO_MIN}-${ESPACIADO_MAX} cards despues. Sigue repitiendose hasta que la respondas bien.`}
                    </p>
                  </div>
                )}

                <button onClick={iniciarEstudio}
                  style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: temaColor, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                  🚀 {tr('empezarEstudio')}
                </button>
              </div>
            </div>

            {/* Repaso rápido */}
            <div style={{ background: '#0d0d1a', borderRadius: '20px', border: '2px solid #38bdf844', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: '#38bdf8' }} />
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <div style={{ fontSize: '26px' }}>⚡</div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: 0 }}>{tr('repasoRapido')}</h3>
                    <p style={{ color: '#888', margin: 0, fontSize: '12px' }}>{tr('repasoRapidoDesc')}</p>
                  </div>
                </div>
                <button onClick={iniciarRepaso}
                  style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: '#38bdf8', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                  ⚡ {tr('empezarRepaso')}
                </button>
              </div>
            </div>

            {/* Modo examen */}
            {onModoExamen && (
              <div style={{ background: '#0d0d1a', borderRadius: '20px', border: '2px solid #a78bfa44', overflow: 'hidden' }}>
                <div style={{ height: '4px', background: '#a78bfa' }} />
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                    <div style={{ fontSize: '26px' }}>📚</div>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: 0 }}>{tr('modoExamenLabel').replace('📚 ','')}</h3>
                      <p style={{ color: '#888', margin: 0, fontSize: '12px' }}>{tr('modoExamenDesc')}</p>
                    </div>
                  </div>
                  <button onClick={() => { onClose(); onModoExamen?.(); }}
                    style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: '#a78bfa', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                    📚 {tr('modoExamenBtn').replace('📚 ','')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // PANTALLA: REPASO RÁPIDO
  // ════════════════════════════════════════════════════════════════════
  if (modo === 'repaso') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>
        <div style={{ padding: '12px 20px', background: '#1a1a2e', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: 0 }}>⚡ {tr('repasoRapido')}</h2>
            <span style={{ fontSize: '12px', color: '#888' }}>{repasoIdx + 1} / {repasoOrden.length}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={reiniciar} style={{ padding: '6px 12px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>← {tr('volver')}</button>
            <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>✕</button>
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
                <button onClick={() => setModo('fin')} style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: '#38bdf8', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{tr('verResultadosBtn2')}</button>
              </div>
            ) : (
              <>
                <div style={{ background: '#0d0d1a', borderRadius: '20px', border: '2px solid #38bdf844', overflow: 'hidden', marginBottom: '16px' }}>
                  <div style={{ height: '4px', background: '#38bdf8' }} />
                  <div style={{ padding: '24px' }}>
                    <p style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', margin: '0 0 12px' }}>{tr('pregunta')} {repasoIdx + 1}/{repasoOrden.length}</p>
                    <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.5 }}>{repasoCard.question}</h3>
                  </div>
                </div>

                {repasoFase === 'pregunta' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <textarea value={repasoRespuesta} onChange={(e: any) => setRepasoRespuesta(e.target.value)}
                      onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); evaluarRepaso(); } }}
                      placeholder={tr('escribeTuRespuesta')}
                      autoFocus
                      style={{ width: '100%', minHeight: '100px', padding: '16px', borderRadius: '14px', border: `2px solid ${repasoRespuesta ? '#38bdf8' : '#333'}`, background: '#0d0d1a', color: '#fff', fontSize: '16px', fontFamily: 'inherit', lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={evaluarRepaso} disabled={!repasoRespuesta.trim() || repasoCargando}
                        style={{ flex: 1, padding: '13px', borderRadius: '12px', border: 'none', background: repasoRespuesta.trim() && !repasoCargando ? '#38bdf8' : '#333', color: repasoRespuesta.trim() && !repasoCargando ? '#000' : '#666', fontSize: '14px', fontWeight: 800, cursor: repasoRespuesta.trim() && !repasoCargando ? 'pointer' : 'not-allowed' }}>
                        {repasoCargando ? '⏳ ...' : '🧠 ' + (tr('evaluarBtn').replace('🧠 ',''))}
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
                        <div style={{ fontSize: '12px', color: '#aaa' }}>{repasoResultado.porcentaje}%</div>
                      </div>
                    </div>
                    <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                      <p style={{ fontSize: '10px', color: '#555', fontWeight: 700, margin: '0 0 4px' }}>{tr('tuRespuestaLabel')}</p>
                      <p style={{ fontSize: '13px', color: '#ccc', margin: 0 }}>{repasoRespuesta}</p>
                    </div>
                    <div style={{ background: '#4ade8015', borderRadius: '10px', padding: '12px 14px', border: '1px solid #4ade8044' }}>
                      <p style={{ fontSize: '10px', color: '#4ade80', fontWeight: 700, margin: '0 0 4px' }}>{tr('respuestaCorrectaUp')}</p>
                      <p style={{ fontSize: '13px', color: '#fff', margin: 0 }}>{repasoCard.answer}</p>
                    </div>
                    <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                      <p style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 700, margin: '0 0 4px' }}>💡 {tr('explicacion')}</p>
                      <p style={{ fontSize: '12px', color: '#ccc', margin: 0 }}>{repasoResultado.explicacion}</p>
                    </div>
                    <button onClick={siguienteRepaso}
                      style={{ padding: '13px', borderRadius: '12px', border: 'none', background: '#38bdf8', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                      {repasoIdx + 1 >= repasoOrden.length ? '🎉 ' + (tr('resultadosLabel')) : (tr('siguienteFlecha'))}
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

  // ════════════════════════════════════════════════════════════════════
  // PANTALLA: FIN
  // ════════════════════════════════════════════════════════════════════
  if (modo === 'fin') {
    const statsUsados = esRepaso ? repasoStats : stats;
    const completadosUsados = esRepaso ? repasoCompletados : completados;

    if (completadosUsados > 0) {
      const acertadas2 = (statsUsados.INSANE || 0) + (statsUsados.correcta || 0);
      const xpFlash = calcularXpFlashcards({ tarjetasRevisadas: completadosUsados, correctas: acertadas2 });
      darXP('flashcards', xpFlash.total, { tarjetas: completadosUsados, acertadas: acertadas2 }).then(res => {
        dispararXPToast({ xp: res.ok ? res.xpGanado : xpFlash.total, fuente: '🎴 Flashcards', emoji: '🎴', color: '#f5c842', descripcion: `${completadosUsados} tarjetas estudiadas` });
      });
    }

    const puntuacion = completadosUsados > 0
      ? Math.round(((statsUsados.INSANE * 100 + statsUsados.correcta * 80 + statsUsados.medio_correcta * 55 + statsUsados.incorrecta * 30) / completadosUsados))
      : 0;

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '24px' }}>
        <div style={{ maxWidth: '560px', width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
          <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#fff', margin: '0 0 6px' }}>{tr('sesionCompletada')}</h2>
          <p style={{ color: '#888', marginBottom: '8px' }}>{completadosUsados} {tr('respuestasEvaluadas')}</p>
          {esRepaso && (
            <div style={{ display: 'inline-block', background: '#38bdf820', border: '1px solid #38bdf844', borderRadius: '8px', padding: '3px 12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 700 }}>⚡ {tr('repasoRapidoLabel')}</span>
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
            <div style={{ color: '#888', fontSize: '13px' }}>{tr('puntuacionFinal')}</div>
            <div style={{ background: '#1a1a2e', borderRadius: '8px', height: '10px', overflow: 'hidden', marginTop: '12px' }}>
              <div style={{ width: `${puntuacion}%`, height: '100%', background: puntuacion >= 80 ? '#4ade80' : puntuacion >= 60 ? temaColor : '#ff4d6d', borderRadius: '8px', transition: 'width 1s' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={reiniciar} style={{ padding: '13px 24px', borderRadius: '12px', border: 'none', background: esRepaso ? '#38bdf8' : temaColor, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>{tr('otraSesion')}</button>
            <button onClick={onClose} style={{ padding: '13px 24px', borderRadius: '12px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>{tr('salir')}</button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // PANTALLA: ESTUDIO CON ESCRITURA
  // ════════════════════════════════════════════════════════════════════
  if (terminado) {
    // Auto-ir a resultados
    if (modo === 'estudio') setTimeout(() => setModo('fin'), 0);
    return null;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>
      <div style={{ padding: '12px 20px', background: '#1a1a2e', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#fff', margin: 0 }}>
            {modoEstudio === 'bucle' ? '🔁' : '➡️'} {tr('escritura')}
          </h2>
          <span style={{ fontSize: '12px', color: '#888' }}>
            {completados}/{totalOriginal.current}
            {modoEstudio === 'bucle' && pendientesRepetir > 0 && (
              <span style={{ color: '#ff4d6d', marginLeft: '8px' }}>+{cola.length - posicion - 1} por repetir</span>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={reiniciar} style={{ padding: '6px 12px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>← {tr('volver')}</button>
          <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>✕</button>
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
          {cardActual && (
            <>
              <div style={{ background: '#0d0d1a', borderRadius: '20px', border: `2px solid ${temaColor}44`, overflow: 'hidden', marginBottom: '16px' }}>
                <div style={{ height: '4px', background: temaColor }} />
                <div style={{ padding: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <p style={{ fontSize: '11px', color: temaColor, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>{tr('pregunta')}</p>
                    {esRepeticion && (
                      <span style={{ fontSize: '11px', background: '#ff4d6d20', color: '#ff4d6d', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                        🔁 {tr('intentoLabel')} #{(repeticiones.current.get(cardIdx) || 0) + 1}
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.5 }}>{cardActual.question}</h3>
                </div>
              </div>

              {fase === 'pregunta' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <textarea value={respuesta} onChange={(e: any) => setRespuesta(e.target.value)}
                    onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); evaluar(); } }}
                    placeholder={tr('escribeTuRespuesta')}
                    autoFocus
                    style={{ width: '100%', minHeight: '100px', padding: '16px', borderRadius: '14px', border: `2px solid ${respuesta ? temaColor : '#333'}`, background: '#0d0d1a', color: '#fff', fontSize: '16px', fontFamily: 'inherit', lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={evaluar} disabled={!respuesta.trim() || cargando}
                      style={{ flex: 1, padding: '13px', borderRadius: '12px', border: 'none', background: respuesta.trim() && !cargando ? temaColor : '#333', color: respuesta.trim() && !cargando ? '#000' : '#666', fontSize: '14px', fontWeight: 800, cursor: respuesta.trim() && !cargando ? 'pointer' : 'not-allowed' }}>
                      {cargando ? '⏳ ...' : '🧠 ' + (tr('evaluarBtn').replace('🧠 ',''))}
                    </button>
                    <button onClick={() => setMostrarRespuesta(!mostrarRespuesta)}
                      style={{ padding: '13px 18px', borderRadius: '12px', border: '2px solid #333', background: 'transparent', color: '#888', fontSize: '14px', cursor: 'pointer' }}>
                      {mostrarRespuesta ? '🙈' : '👁️'}
                    </button>
                  </div>
                  {mostrarRespuesta && (
                    <div style={{ background: '#f5c84215', border: '1px solid #f5c84244', borderRadius: '12px', padding: '14px 16px' }}>
                      <p style={{ fontSize: '10px', color: '#f5c842', fontWeight: 800, margin: '0 0 6px', textTransform: 'uppercase' }}>{tr('respuesta')}</p>
                      <p style={{ fontSize: '15px', color: '#fff', margin: 0, lineHeight: 1.6 }}>{cardActual.answer}</p>
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
                      <div style={{ fontSize: '12px', color: '#aaa' }}>{resultado.porcentaje}%</div>
                    </div>
                    <div style={{ width: '80px', background: '#1a1a2e', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
                      <div style={{ width: `${resultado.porcentaje}%`, height: '100%', background: NIVEL_INFO[resultado.nivel].color, transition: 'width 1s' }} />
                    </div>
                  </div>

                  <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '10px', color: '#555', fontWeight: 700, margin: '0 0 4px' }}>{tr('tuRespuestaLabel')}</p>
                    <p style={{ fontSize: '13px', color: '#ccc', margin: 0 }}>{respuesta}</p>
                  </div>

                  <div style={{ background: '#4ade8015', borderRadius: '10px', padding: '12px 14px', border: '1px solid #4ade8044' }}>
                    <p style={{ fontSize: '10px', color: '#4ade80', fontWeight: 700, margin: '0 0 4px' }}>{tr('respuestaCorrectaUp')}</p>
                    <p style={{ fontSize: '13px', color: '#fff', margin: 0 }}>{cardActual.answer}</p>
                  </div>

                  <div style={{ background: '#0d0d1a', borderRadius: '10px', padding: '12px 14px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '10px', color: temaColor, fontWeight: 700, margin: '0 0 4px' }}>💡 {tr('explicacion')}</p>
                    <p style={{ fontSize: '12px', color: '#ccc', margin: '0 0 8px' }}>{resultado.explicacion}</p>
                    {resultado.consejo && (
                      <>
                        <p style={{ fontSize: '10px', color: '#555', fontWeight: 700, margin: '0 0 4px' }}>🎯 {tr('consejo')}</p>
                        <p style={{ fontSize: '11px', color: '#aaa', margin: 0 }}>{resultado.consejo}</p>
                      </>
                    )}
                  </div>

                  {modoEstudio === 'bucle' && (resultado.nivel === 'incorrecta' || resultado.nivel === 'muy_incorrecta' || resultado.nivel === 'medio_correcta') && (
                    <div style={{ background: '#ff4d6d15', borderRadius: '8px', padding: '8px 12px', border: '1px solid #ff4d6d44', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>🔁</span>
                      <p style={{ fontSize: '11px', color: '#ff4d6d', margin: 0, fontWeight: 600 }}>
                        {resultado.nivel === 'medio_correcta'
                          ? (idioma === 'en'
                            ? `Almost! Will reappear in ${ESPACIADO_MIN}-${ESPACIADO_MAX} cards to make sure you fully master it`
                            : `Casi! Reaparecera en ${ESPACIADO_MIN}-${ESPACIADO_MAX} cards para asegurarnos de que la dominas`)
                          : (idioma === 'en'
                            ? `Will reappear in ${ESPACIADO_MIN}-${ESPACIADO_MAX} cards — keeps repeating until you get it right`
                            : `Reaparecera en ${ESPACIADO_MIN}-${ESPACIADO_MAX} cards — seguira hasta que la domines`)}
                      </p>
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