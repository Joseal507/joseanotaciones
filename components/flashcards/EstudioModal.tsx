'use client';

import { useState } from 'react';
import { registrarEstudioHoy } from '../../lib/racha';
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
}

const NIVEL_INFO = {
  INSANE: { emoji: '🔥', label: 'INSANE', color: '#f5c842', bg: '#f5c84220' },
  correcta: { emoji: '✅', label: 'Correcta', color: '#4ade80', bg: '#4ade8020' },
  medio_correcta: { emoji: '🟡', label: 'Medio correcta', color: '#fb923c', bg: '#fb923c20' },
  incorrecta: { emoji: '❌', label: 'Incorrecta', color: '#ff4d6d', bg: '#ff4d6d20' },
  muy_incorrecta: { emoji: '💀', label: 'Muy incorrecta', color: '#888', bg: '#88888820' },
};

type Modo = 'seleccionar' | 'estudio' | 'repaso' | 'fin';
type ModoEstudio = 'lineal' | 'bucle';

export default function EstudioModal({ flashcards, onClose, temaColor }: Props) {
  const [modo, setModo] = useState<Modo>('seleccionar');
  const [modoEstudio, setModoEstudio] = useState<ModoEstudio>('lineal');
  const [orden, setOrden] = useState<number[]>([]);
  const [cola, setCola] = useState<number[]>([]);
  const [idx, setIdx] = useState(0);
  const [fase, setFase] = useState<'pregunta' | 'escribir' | 'resultado'>('pregunta');
  const [respuesta, setRespuesta] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [mostrarRespuesta, setMostrarRespuesta] = useState(false);
  const [stats, setStats] = useState<{ [nivel: string]: number }>({
    INSANE: 0, correcta: 0, medio_correcta: 0, incorrecta: 0, muy_incorrecta: 0,
  });
  const [repasoIdx, setRepasoIdx] = useState(0);
  const [repasoFlipped, setRepasoFlipped] = useState(false);

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
    setModo('estudio');
  };

  const iniciarRepaso = () => {
    const indices = flashcards.map((_, i) => i);
    setOrden(indices);
    setRepasoIdx(0);
    setRepasoFlipped(false);
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
        }),
      });
      const data = await res.json();
      if (data.success) {
        const r = data.resultado;
        setResultado(r);
        setStats(prev => ({ ...prev, [r.nivel]: (prev[r.nivel] || 0) + 1 }));
        setFase('resultado');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  };

  const siguiente = () => {
    if (!resultado) return;
    const esMala = resultado.nivel === 'incorrecta' || resultado.nivel === 'muy_incorrecta';
    const cidx = cardActualIdx();

    if (cola.length > 0) {
      const nuevaCola = cola.slice(1);
      if (esMala && modoEstudio === 'bucle') nuevaCola.push(cidx);
      setCola(nuevaCola);
      if (nuevaCola.length === 0 && idx >= orden.length) {
        setModo('fin');
        return;
      }
    } else {
      if (esMala && modoEstudio === 'bucle') setCola(prev => [...prev, cidx]);
      const newIdx = idx + 1;
      setIdx(newIdx);
      if (newIdx >= orden.length && cola.length === 0 && !(esMala && modoEstudio === 'bucle')) {
        setModo('fin');
        return;
      }
    }

    setRespuesta('');
    setResultado(null);
    setMostrarRespuesta(false);
    setFase('pregunta');
  };

  const reiniciar = () => setModo('seleccionar');

  const card = cardActual();
  const progreso = orden.length > 0 ? Math.round((idx / orden.length) * 100) : 0;

  // ===== PANTALLA SELECCIONAR =====
  if (modo === 'seleccionar') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000, alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '560px', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 900, color: '#fff', margin: 0 }}>🧠 Modo Estudio</h2>
              <p style={{ color: '#888', margin: 0, fontSize: '14px' }}>{flashcards.length} flashcards disponibles</p>
            </div>
            <button onClick={onClose}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              ✕ Salir
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Estudio con escritura */}
            <div style={{ background: '#0d0d1a', borderRadius: '20px', border: `2px solid ${temaColor}44`, overflow: 'hidden' }}>
              <div style={{ height: '4px', background: temaColor }} />
              <div style={{ padding: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '32px' }}>✍️</div>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', margin: 0 }}>Estudio con escritura</h3>
                    <p style={{ color: '#888', margin: 0, fontSize: '13px' }}>Escribe tu respuesta y la AI la evalúa</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  {([
                    { id: 'lineal', label: '➡️ Lineal', desc: 'Una vez cada card' },
                    { id: 'bucle', label: '🔁 Bucle', desc: 'Repite las que falles' },
                  ] as const).map(m => (
                    <button key={m.id} onClick={() => setModoEstudio(m.id)}
                      style={{ flex: 1, padding: '12px', borderRadius: '12px', border: `2px solid ${modoEstudio === m.id ? temaColor : '#333'}`, background: modoEstudio === m.id ? temaColor + '20' : 'transparent', cursor: 'pointer', transition: 'all 0.2s' }}>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: modoEstudio === m.id ? temaColor : '#aaa' }}>{m.label}</div>
                      <div style={{ fontSize: '11px', color: modoEstudio === m.id ? temaColor + 'cc' : '#555', marginTop: '2px' }}>{m.desc}</div>
                    </button>
                  ))}
                </div>

                {modoEstudio === 'bucle' && (
                  <div style={{ background: '#1a1a2e', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
                      🔁 Las flashcards que falles se repiten al final hasta dominarlas todas.
                    </p>
                  </div>
                )}

                <button onClick={iniciarEstudio}
                  style={{ width: '100%', padding: '14px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                  🚀 Empezar estudio
                </button>
              </div>
            </div>

            {/* Repaso rápido */}
            <div style={{ background: '#0d0d1a', borderRadius: '20px', border: '2px solid #38bdf844', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: '#38bdf8' }} />
              <div style={{ padding: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '32px' }}>⚡</div>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#fff', margin: 0 }}>Repaso rápido</h3>
                    <p style={{ color: '#888', margin: 0, fontSize: '13px' }}>Voltea las cards linealmente, una sola vez</p>
                  </div>
                </div>
                <div style={{ background: '#1a1a2e', borderRadius: '10px', padding: '10px 14px', marginBottom: '16px', border: '1px solid #333' }}>
                  <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
                    ⚡ Ve todas las flashcards en orden, voltéalas para ver la respuesta.
                  </p>
                </div>
                <button onClick={iniciarRepaso}
                  style={{ width: '100%', padding: '14px', borderRadius: '12px', border: 'none', background: '#38bdf8', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                  ⚡ Empezar repaso
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== REPASO RÁPIDO =====
  if (modo === 'repaso') {
    const cardRepaso = flashcards[orden[repasoIdx]];
    const progRepa = Math.round((repasoIdx / orden.length) * 100);

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>
        <div style={{ padding: '14px 24px', background: '#1a1a2e', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#fff', margin: 0 }}>⚡ Repaso Rápido</h2>
            <span style={{ fontSize: '13px', color: '#888' }}>{repasoIdx + 1} / {orden.length}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={reiniciar}
              style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
              ← Volver
            </button>
            <button onClick={onClose}
              style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
              ✕
            </button>
          </div>
        </div>

        <div style={{ height: '4px', background: '#1a1a2e', flexShrink: 0 }}>
          <div style={{ width: `${progRepa}%`, height: '100%', background: '#38bdf8', transition: 'width 0.4s ease' }} />
        </div>

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
          <div style={{ maxWidth: '640px', width: '100%' }}>
            <div
              onClick={() => setRepasoFlipped(!repasoFlipped)}
              className={`flip-card ${repasoFlipped ? 'flipped' : ''}`}
              style={{ height: '320px', cursor: 'pointer' }}>
              <div className="flip-card-inner" style={{ position: 'relative', width: '100%', height: '100%' }}>
                <div className="flip-card-front" style={{ position: 'absolute', width: '100%', height: '100%' }}>
                  <div style={{ background: '#0d0d1a', borderRadius: '20px', padding: '40px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px solid #38bdf844', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: '#38bdf8' }} />
                    <div style={{ position: 'absolute', top: '16px', left: '16px', background: '#38bdf8', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>PREGUNTA</div>
                    <h3 style={{ fontSize: '20px', fontWeight: 700, textAlign: 'center', color: '#fff', lineHeight: 1.6, margin: '20px 0 0' }}>{cardRepaso?.question}</h3>
                    <p style={{ color: '#555', fontSize: '12px', margin: '20px 0 0' }}>👆 Toca para ver respuesta</p>
                  </div>
                </div>
                <div className="flip-card-back" style={{ position: 'absolute', width: '100%', height: '100%' }}>
                  <div style={{ background: '#0d0d1a', borderRadius: '20px', padding: '40px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px solid #4ade8044', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: '#4ade80' }} />
                    <div style={{ position: 'absolute', top: '16px', left: '16px', background: '#4ade80', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>RESPUESTA</div>
                    <p style={{ fontSize: '18px', textAlign: 'center', color: '#fff', lineHeight: 1.7, margin: '20px 0 0' }}>{cardRepaso?.answer}</p>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '24px' }}>
              <button
                onClick={() => {
                  if (repasoIdx + 1 >= orden.length) {
                    setModo('fin');
                  } else {
                    setRepasoIdx(i => i + 1);
                    setRepasoFlipped(false);
                  }
                }}
                style={{ padding: '14px 40px', borderRadius: '12px', border: 'none', background: repasoFlipped ? '#38bdf8' : '#333', color: repasoFlipped ? '#000' : '#666', fontSize: '15px', fontWeight: 800, cursor: repasoFlipped ? 'pointer' : 'default', transition: 'all 0.3s' }}>
                {repasoIdx + 1 >= orden.length ? '🎉 Terminar' : 'Siguiente →'}
              </button>
            </div>
            <p style={{ textAlign: 'center', fontSize: '12px', color: '#555', marginTop: '12px' }}>
              {repasoFlipped ? 'Puedes avanzar' : 'Voltea la card primero'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ===== FIN =====
  if (modo === 'fin') {
    const puntuacion = completados > 0
      ? Math.round(((stats.INSANE * 100 + stats.correcta * 80 + stats.medio_correcta * 55 + stats.incorrecta * 30) / completados))
      : 100;

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '24px' }}>
        <div style={{ maxWidth: '560px', width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
          <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#fff', margin: '0 0 8px' }}>¡Sesión completada!</h2>
          <p style={{ color: '#888', marginBottom: '32px' }}>
            {completados > 0 ? `Completaste ${completados} flashcards` : `Repasaste ${flashcards.length} flashcards`}
          </p>

          {completados > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '24px' }}>
                {Object.entries(NIVEL_INFO).map(([key, info]) => (
                  <div key={key} style={{ background: info.bg, border: `1px solid ${info.color}44`, borderRadius: '12px', padding: '12px 8px' }}>
                    <div style={{ fontSize: '22px' }}>{info.emoji}</div>
                    <div style={{ fontSize: '22px', fontWeight: 900, color: '#ffffff' }}>{stats[key]}</div>
                    <div style={{ fontSize: '9px', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>{info.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: '#0d0d1a', borderRadius: '16px', padding: '20px', marginBottom: '24px', border: `1px solid ${temaColor}44` }}>
                <div style={{ fontSize: '40px', fontWeight: 900, color: temaColor }}>{puntuacion}%</div>
                <div style={{ color: '#888', fontSize: '14px' }}>Puntuación final</div>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button onClick={reiniciar}
              style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
              🔄 Otra sesión
            </button>
            <button onClick={onClose}
              style={{ padding: '14px 28px', borderRadius: '12px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
              Salir
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== ESTUDIO CON ESCRITURA =====
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>

      {/* Header */}
      <div style={{ padding: '14px 24px', background: '#1a1a2e', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#fff', margin: 0 }}>
            {modoEstudio === 'bucle' ? '🔁 Estudio en Bucle' : '➡️ Estudio Lineal'}
          </h2>
          <span style={{ fontSize: '13px', color: '#888' }}>
            {completados} hechas
            {cola.length > 0 && <span style={{ color: '#ff4d6d', marginLeft: '8px' }}>· {cola.length} por repetir</span>}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={reiniciar}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            ← Volver
          </button>
          <button onClick={onClose}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Progreso */}
      <div style={{ height: '4px', background: '#1a1a2e', flexShrink: 0 }}>
        <div style={{ width: `${progreso}%`, height: '100%', background: temaColor, transition: 'width 0.4s ease' }} />
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', padding: '8px', background: '#111', flexWrap: 'wrap', flexShrink: 0 }}>
        {Object.entries(NIVEL_INFO).map(([key, info]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: stats[key] > 0 ? 1 : 0.25, transition: 'opacity 0.3s' }}>
            <span style={{ fontSize: '14px' }}>{info.emoji}</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>{stats[key]}</span>
          </div>
        ))}
      </div>

      {/* Contenido */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', overflow: 'auto' }}>
        <div style={{ maxWidth: '680px', width: '100%' }}>

          {!card && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
              <h3 style={{ color: '#fff', fontSize: '22px', margin: '0 0 16px' }}>¡Completado!</h3>
              <button onClick={() => setModo('fin')}
                style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                Ver resultados
              </button>
            </div>
          )}

          {card && (
            <>
              {/* Pregunta */}
              <div style={{ background: '#0d0d1a', borderRadius: '20px', border: `2px solid ${temaColor}44`, overflow: 'hidden', marginBottom: '20px' }}>
                <div style={{ height: '4px', background: temaColor }} />
                <div style={{ padding: '28px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <p style={{ fontSize: '11px', color: temaColor, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>
                      Pregunta
                    </p>
                    {cola.length > 0 && cola[0] === cardActualIdx() && (
                      <span style={{ fontSize: '11px', background: '#ff4d6d20', color: '#ff4d6d', padding: '3px 8px', borderRadius: '6px', fontWeight: 700 }}>
                        🔁 Repetición
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.5 }}>
                    {card.question}
                  </h3>
                </div>
              </div>

              {/* Escribir */}
              {(fase === 'pregunta' || fase === 'escribir') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <textarea
                    value={respuesta}
                    onChange={e => { setRespuesta(e.target.value); setFase('escribir'); }}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) evaluar(); }}
                    placeholder="Escribe tu respuesta... (Cmd+Enter para evaluar)"
                    autoFocus
                    style={{ width: '100%', minHeight: '110px', padding: '16px', borderRadius: '14px', border: `2px solid ${respuesta ? temaColor : '#333'}`, background: '#0d0d1a', color: '#fff', fontSize: '16px', fontFamily: 'Georgia, serif', lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' }}
                  />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={evaluar} disabled={!respuesta.trim() || cargando}
                      style={{ flex: 1, padding: '14px', borderRadius: '12px', border: 'none', background: respuesta.trim() && !cargando ? temaColor : '#333', color: respuesta.trim() && !cargando ? '#000' : '#666', fontSize: '15px', fontWeight: 800, cursor: respuesta.trim() && !cargando ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}>
                      {cargando ? '⏳ Evaluando...' : '🧠 Evaluar respuesta'}
                    </button>
                    <button onClick={() => setMostrarRespuesta(!mostrarRespuesta)}
                      style={{ padding: '14px 20px', borderRadius: '12px', border: '2px solid #333', background: 'transparent', color: '#888', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                      {mostrarRespuesta ? '🙈 Ocultar' : '👁️ Ver'}
                    </button>
                  </div>
                  {mostrarRespuesta && (
                    <div style={{ background: '#f5c84215', border: '1px solid #f5c84244', borderRadius: '12px', padding: '14px 16px' }}>
                      <p style={{ fontSize: '10px', color: '#f5c842', fontWeight: 800, margin: '0 0 6px', textTransform: 'uppercase' }}>Respuesta correcta</p>
                      <p style={{ fontSize: '15px', color: '#fff', margin: 0, lineHeight: 1.6 }}>{card.answer}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Resultado */}
              {fase === 'resultado' && resultado && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                  {/* Nivel */}
                  <div style={{ background: NIVEL_INFO[resultado.nivel].bg, border: `2px solid ${NIVEL_INFO[resultado.nivel].color}`, borderRadius: '16px', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ fontSize: '44px' }}>{NIVEL_INFO[resultado.nivel].emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '20px', fontWeight: 900, color: '#ffffff' }}>
                        {NIVEL_INFO[resultado.nivel].label}
                      </div>
                      <div style={{ fontSize: '13px', color: '#aaaaaa' }}>{resultado.porcentaje}% correcto</div>
                    </div>
                    <div style={{ flex: 1, background: '#1a1a2e', borderRadius: '8px', height: '10px', overflow: 'hidden' }}>
                      <div style={{ width: `${resultado.porcentaje}%`, height: '100%', background: NIVEL_INFO[resultado.nivel].color, transition: 'width 1s ease' }} />
                    </div>
                  </div>

                  {/* Tu respuesta */}
                  <div style={{ background: '#0d0d1a', borderRadius: '12px', padding: '14px 16px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '10px', color: '#555', fontWeight: 700, margin: '0 0 6px', textTransform: 'uppercase' }}>Tu respuesta</p>
                    <p style={{ fontSize: '14px', color: '#cccccc', margin: 0, lineHeight: 1.6 }}>{respuesta}</p>
                  </div>

                  {/* Respuesta correcta */}
                  <div style={{ background: '#4ade8015', borderRadius: '12px', padding: '14px 16px', border: '1px solid #4ade8044' }}>
                    <p style={{ fontSize: '10px', color: '#4ade80', fontWeight: 700, margin: '0 0 6px', textTransform: 'uppercase' }}>Respuesta correcta</p>
                    <p style={{ fontSize: '14px', color: '#ffffff', margin: 0, lineHeight: 1.6 }}>{card.answer}</p>
                  </div>

                  {/* Explicación */}
                  <div style={{ background: '#0d0d1a', borderRadius: '12px', padding: '14px 16px', border: '1px solid #333' }}>
                    <p style={{ fontSize: '10px', color: temaColor, fontWeight: 700, margin: '0 0 6px', textTransform: 'uppercase' }}>💡 Explicación</p>
                    <p style={{ fontSize: '14px', color: '#cccccc', margin: '0 0 10px', lineHeight: 1.6 }}>{resultado.explicacion}</p>
                    <p style={{ fontSize: '10px', color: '#555', fontWeight: 700, margin: '0 0 4px', textTransform: 'uppercase' }}>🎯 Consejo</p>
                    <p style={{ fontSize: '13px', color: '#aaaaaa', margin: 0, lineHeight: 1.6 }}>{resultado.consejo}</p>
                  </div>

                  {modoEstudio === 'bucle' && (resultado.nivel === 'incorrecta' || resultado.nivel === 'muy_incorrecta') && (
                    <div style={{ background: '#ff4d6d15', borderRadius: '10px', padding: '10px 14px', border: '1px solid #ff4d6d44', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>🔁</span>
                      <p style={{ fontSize: '12px', color: '#ff4d6d', margin: 0, fontWeight: 600 }}>
                        Esta card se repetirá al final de la sesión
                      </p>
                    </div>
                  )}

                  <button onClick={siguiente}
                    style={{ padding: '14px', borderRadius: '12px', border: 'none', background: temaColor, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                    Siguiente →
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