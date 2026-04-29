'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import {
  getQuizzesGuardados, eliminarQuizGuardado, QuizGuardado,
  getFlashcardDecks, eliminarDeck, FlashcardDeck,
  cargarQuizzesDesdeDB, cargarDecksDesdeDB,
  getQuizzesTemporales, eliminarQuizTemporal,
  pasarTemporalADeck, getTiempoRestante, NivelQuiz,
} from '../../lib/quizStorage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
import EstudioModal from '../../components/flashcards/EstudioModal';
import ModoExamen from '../../components/flashcards/ModoExamen';
import MathText from '../../components/MathText';

const NIVEL_META: Record<NivelQuiz, { label: string; emoji: string; color: string; bg: string }> = {
  facil:      { label: 'Facil',       emoji: '🟢', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  intermedio: { label: 'Intermedio',  emoji: '🟡', color: '#f5c842', bg: 'rgba(245,200,66,0.12)' },
  dificil:    { label: 'Dificil',     emoji: '🔴', color: '#ff4d6d', bg: 'rgba(255,77,109,0.12)' },
};

function NivelBadge({ nivel }: { nivel?: NivelQuiz }) {
  const meta = NIVEL_META[nivel || 'intermedio'];
  return (
    <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}44` }}>
      {meta.emoji} {meta.label}
    </span>
  );
}

function CountdownTimer({ expiraEn }: { expiraEn: number }) {
  const [tiempo, setTiempo] = useState(getTiempoRestante(expiraEn));
  useEffect(() => {
    const id = setInterval(() => setTiempo(getTiempoRestante(expiraEn)), 30000);
    return () => clearInterval(id);
  }, [expiraEn]);
  const urgente = expiraEn - Date.now() < 3 * 60 * 60 * 1000;
  return <span style={{ fontSize: '11px', color: urgente ? '#ff4d6d' : '#f5c842', fontWeight: 700 }}>⏳ {tiempo}</span>;
}

function EmptyState({ emoji, titulo, desc, boton }: { emoji: string; titulo: string; desc: string; boton?: { label: string; href: string } }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ fontSize: '64px', marginBottom: '16px' }}>{emoji}</div>
      <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>{titulo}</p>
      <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: '0 auto 24px', maxWidth: '360px' }}>{desc}</p>
      {boton && (
        <button onClick={() => window.location.href = boton.href}
          style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
          {boton.label}
        </button>
      )}
    </div>
  );
}

function QuizCard({ quiz, onJugar, onEliminar }: { quiz: QuizGuardado; onJugar: () => void; onEliminar: () => void }) {
  const meta = NIVEL_META[quiz.nivel || 'intermedio'];
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: '18px', border: `1px solid ${quiz.materiaColor || '#a78bfa'}33`, overflow: 'hidden' }}>
      <div style={{ height: '4px', background: quiz.materiaColor || '#a78bfa' }} />
      <div style={{ padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quiz.nombre}</h3>
            <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}44`, flexShrink: 0 }}>{meta.emoji} {meta.label}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>🤓 {quiz.preguntas.length} preguntas</span>
            {quiz.materiaNombre && <span style={{ fontSize: '12px', color: quiz.materiaColor || '#a78bfa', fontWeight: 600 }}>· {quiz.materiaNombre}</span>}
            <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>· {quiz.fechaCreacion}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={onJugar} style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: quiz.materiaColor || '#a78bfa', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>▶ {tr('jugar')}</button>
          <button onClick={onEliminar} style={{ padding: '10px 13px', borderRadius: '10px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '14px', cursor: 'pointer' }}>🗑️</button>
        </div>
      </div>
    </div>
  );
}

function TemporalCard({ quiz, guardadoOk, onJugar, onGuardar, onEliminar }: {
  quiz: QuizGuardado; guardadoOk: boolean;
  onJugar: () => void; onGuardar: () => void; onEliminar: () => void;
}) {
  const meta = NIVEL_META[quiz.nivel || 'intermedio'];
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: '18px', border: '1px solid #f5c84244', overflow: 'hidden', opacity: guardadoOk ? 0.6 : 1 }}>
      <div style={{ height: '4px', background: 'linear-gradient(90deg, #f5c842, #ff9f43)' }} />
      <div style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{quiz.nombre || 'Quiz sin nombre'}</h3>
              <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}44`, flexShrink: 0 }}>{meta.emoji} {meta.label}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>🤓 {quiz.preguntas.length} preguntas</span>
              {quiz.materiaNombre && <span style={{ fontSize: '12px', color: quiz.materiaColor || '#a78bfa', fontWeight: 600 }}>· {quiz.materiaNombre}</span>}
              {quiz.expiraEn && <CountdownTimer expiraEn={quiz.expiraEn} />}
            </div>
          </div>
          {guardadoOk ? (
            <span style={{ fontSize: '13px', color: '#4ade80', fontWeight: 700 }}>✅ Guardado</span>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
              <button onClick={onJugar} style={{ padding: '10px 16px', borderRadius: '10px', border: '2px solid #f5c84244', background: 'transparent', color: '#f5c842', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>▶ {tr('jugar')}</button>
              <button onClick={onGuardar} style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: '#f5c842', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>💾 Guardar</button>
              <button onClick={onEliminar} style={{ padding: '10px 13px', borderRadius: '10px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '14px', cursor: 'pointer' }}>🗑️</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeckCard({ deck, onVer, onEstudiar, onEliminar }: {
  deck: FlashcardDeck; onVer: () => void; onEstudiar: () => void; onEliminar: () => void;
}) {
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: '18px', border: `1px solid ${deck.materiaColor || 'var(--gold)'}33`, overflow: 'hidden' }}>
      <div style={{ height: '4px', background: deck.materiaColor || 'var(--gold)' }} />
      <div style={{ padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deck.nombre}</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>🎴 {deck.flashcards.length} flashcards</span>
            {deck.materiaNombre && <span style={{ fontSize: '12px', color: deck.materiaColor || 'var(--gold)', fontWeight: 600 }}>· {deck.materiaNombre}</span>}
            <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>· {deck.fechaCreacion}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
          <button onClick={onVer} style={{ padding: '10px 14px', borderRadius: '10px', border: `2px solid ${deck.materiaColor || 'var(--gold)'}`, background: 'transparent', color: deck.materiaColor || 'var(--gold)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>🎴 {tr('ver')}</button>
          <button onClick={onEstudiar} style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: deck.materiaColor || 'var(--gold)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>🧠 {tr('estudiar')}</button>
          <button onClick={onEliminar} style={{ padding: '10px 13px', borderRadius: '10px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '14px', cursor: 'pointer' }}>🗑️</button>
        </div>
      </div>
    </div>
  );
}

function DeckVisor({ deck, currentCard, flipped, onSetCard, onFlip, onEstudiar, onClose }: {
  deck: FlashcardDeck; currentCard: number; flipped: boolean;
  onSetCard: (i: number) => void; onFlip: () => void; onEstudiar: () => void; onClose: () => void;
}) {
  const card = deck.flashcards[currentCard];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>
      <div style={{ padding: '16px 24px', background: 'var(--bg-card)', borderBottom: `3px solid ${deck.materiaColor || 'var(--gold)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{deck.nombre}</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{currentCard + 1} / {deck.flashcards.length}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onEstudiar} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: deck.materiaColor || 'var(--gold)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>🧠 {tr('estudiar')}</button>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>✕</button>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
        <div style={{ maxWidth: '640px', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {deck.flashcards.map((_, i) => (
              <div key={i} onClick={() => onSetCard(i)} style={{ width: i === currentCard ? '24px' : '8px', height: '8px', borderRadius: '4px', background: i === currentCard ? (deck.materiaColor || 'var(--gold)') : 'var(--border-color2)', cursor: 'pointer', transition: 'all 0.3s', flexShrink: 0 }} />
            ))}
          </div>
          <div onClick={onFlip} style={{ height: '300px', cursor: 'pointer', perspective: '1000px' }}>
            <div style={{ position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d', transition: 'transform 0.5s', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
              <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', background: 'var(--bg-card)', borderRadius: '18px', padding: '36px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: `2px solid ${deck.materiaColor || 'var(--gold)'}44`, boxSizing: 'border-box', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: deck.materiaColor || 'var(--gold)' }} />
                <div style={{ position: 'absolute', top: '14px', left: '16px', background: deck.materiaColor || 'var(--gold)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>PREGUNTA</div>
                <h3 style={{ fontSize: '20px', fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.6, margin: '16px 0 0' }}><MathText text={card?.question || ''} /></h3>
                <p style={{ color: 'var(--text-faint)', fontSize: '12px', margin: '16px 0 0' }}>Toca para ver la respuesta</p>
              </div>
              <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', background: 'var(--bg-card)', borderRadius: '18px', padding: '36px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--red-border)', boxSizing: 'border-box', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--red)' }} />
                <div style={{ position: 'absolute', top: '14px', left: '16px', background: 'var(--red)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>RESPUESTA</div>
                <p style={{ fontSize: '18px', textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.7, margin: '16px 0 0' }}><MathText text={card?.answer || ''} /></p>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '24px' }}>
            <button onClick={() => onSetCard((currentCard - 1 + deck.flashcards.length) % deck.flashcards.length)} style={{ padding: '12px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>⬅️ Anterior</button>
            <button onClick={() => onSetCard((currentCard + 1) % deck.flashcards.length)} style={{ padding: '12px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>Siguiente ➡️</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QuizzesPage() {
  const { tr, idioma } = useIdioma();
  const isMobile = useIsMobile();

  const [quizzes,    setQuizzes]    = useState<QuizGuardado[]>([]);
  const [temporales, setTemporales] = useState<QuizGuardado[]>([]);
  const [decks,      setDecks]      = useState<FlashcardDeck[]>([]);
  const [tab,        setTab]        = useState<'quizzes' | 'temporal' | 'decks'>('quizzes');
  const [busqueda,   setBusqueda]   = useState('');
  const [guardandoId,    setGuardandoId]    = useState<string | null>(null);
  const [nombreTemporal, setNombreTemporal] = useState('');
  const [guardandoOk,    setGuardandoOk]    = useState<string | null>(null);
  const [quizActivo,   setQuizActivo]   = useState<QuizGuardado | null>(null);
  const [fase,         setFase]         = useState<'lista' | 'jugando' | 'fin'>('lista');
  const [idx,          setIdx]          = useState(0);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [respondida,   setRespondida]   = useState(false);
  const [puntos,       setPuntos]       = useState(0);
  const [resultados,   setResultados]   = useState<{ correcta: boolean }[]>([]);
  const [deckActivo,     setDeckActivo]     = useState<FlashcardDeck | null>(null);
  const [currentCard,    setCurrentCard]    = useState(0);
  const [flipped,        setFlipped]        = useState(false);
  const [showEstudio,    setShowEstudio]    = useState(false);
  const [showModoExamen, setShowModoExamen] = useState(false);

  const recargar = useCallback(() => {
    setQuizzes(getQuizzesGuardados());
    setTemporales(getQuizzesTemporales());
    setDecks(getFlashcardDecks());
  }, []);

  useEffect(() => {
    recargar();
    cargarQuizzesDesdeDB().then(q => setQuizzes(q)).catch(() => {});
    cargarDecksDesdeDB().then(d => setDecks(d)).catch(() => {});
  }, [recargar]);

  const bq = busqueda.toLowerCase();
  const quizzesFiltrados    = quizzes.filter(q => q.nombre.toLowerCase().includes(bq) || (q.materiaNombre || '').toLowerCase().includes(bq));
  const temporalesFiltrados = temporales.filter(q => q.nombre.toLowerCase().includes(bq) || (q.materiaNombre || '').toLowerCase().includes(bq));
  const decksFiltrados      = decks.filter(d => d.nombre.toLowerCase().includes(bq) || (d.materiaNombre || '').toLowerCase().includes(bq));

  const iniciarQuiz = (quiz: QuizGuardado) => {
    setQuizActivo(quiz); setIdx(0); setSeleccionada(null);
    setRespondida(false); setPuntos(0); setResultados([]); setFase('jugando');
  };

  const responder = (i: number) => {
    if (respondida || !quizActivo) return;
    setSeleccionada(i); setRespondida(true);
    const ok = i === quizActivo.preguntas[idx].correcta;
    if (ok) setPuntos(p => p + 1);
    setResultados(prev => [...prev, { correcta: ok }]);
  };

  const siguiente = () => {
    if (!quizActivo) return;
    if (idx + 1 >= quizActivo.preguntas.length) setFase('fin');
    else { setIdx(i => i + 1); setSeleccionada(null); setRespondida(false); }
  };

  const preguntaActual = quizActivo?.preguntas[idx];
  const porcentaje = quizActivo ? Math.round((puntos / quizActivo.preguntas.length) * 100) : 0;
  const progreso   = quizActivo ? (idx / quizActivo.preguntas.length) * 100 : 0;

  const getOpcionStyle = (i: number) => {
    if (!respondida || !preguntaActual) return { border: '1px solid var(--border-color)', background: 'transparent' };
    if (i === preguntaActual.correcta) return { border: '2px solid #4ade80', background: 'rgba(74,222,128,0.1)' };
    if (i === seleccionada) return { border: '2px solid #ff4d6d', background: 'rgba(255,77,109,0.1)' };
    return { border: '1px solid var(--border-color)', background: 'transparent' };
  };

  const getLetra = (i: number) => {
    if (!respondida || !preguntaActual) return ['A','B','C','D'][i];
    if (i === preguntaActual.correcta) return '✓';
    if (i === seleccionada) return '✗';
    return ['A','B','C','D'][i];
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {showEstudio && deckActivo && (
        <EstudioModal flashcards={deckActivo.flashcards}
          temaColor={deckActivo.temaColor || deckActivo.materiaColor || 'var(--gold)'}
          onClose={() => setShowEstudio(false)}
          onModoExamen={() => { setShowEstudio(false); setShowModoExamen(true); }} />
      )}
      {showModoExamen && deckActivo && (
        <ModoExamen flashcards={deckActivo.flashcards} contenido=""
          nombreDoc={deckActivo.nombre}
          temaColor={deckActivo.temaColor || deckActivo.materiaColor || 'var(--gold)'}
          onClose={() => setShowModoExamen(false)} />
      )}

      {guardandoId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', maxWidth: '420px', width: '100%', border: '2px solid #a78bfa44' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{tr('guardarEnDeck')}</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 20px' }}>{tr('guardarEnDeckDesc')}</p>
            <input autoFocus value={nombreTemporal} onChange={e => setNombreTemporal(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter' && nombreTemporal.trim()) {
                  await pasarTemporalADeck(guardandoId, nombreTemporal.trim());
                  setGuardandoOk(guardandoId); setGuardandoId(null); setNombreTemporal(''); recargar();
                }
              }}
              placeholder="ej: Tema 3 - Biologia celular"
              style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', border: '2px solid #a78bfa', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', marginBottom: '16px' }} />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={async () => {
                if (!nombreTemporal.trim()) return;
                await pasarTemporalADeck(guardandoId, nombreTemporal.trim());
                setGuardandoOk(guardandoId); setGuardandoId(null); setNombreTemporal(''); recargar();
              }} disabled={!nombreTemporal.trim()}
                style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: nombreTemporal.trim() ? '#a78bfa' : '#333', color: nombreTemporal.trim() ? '#000' : '#666', fontWeight: 800, fontSize: '14px', cursor: nombreTemporal.trim() ? 'pointer' : 'not-allowed' }}>
                Guardar
              </button>
              <button onClick={() => { setGuardandoId(null); setNombreTemporal(''); }}
                style={{ padding: '12px 20px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {isMobile ? <NavbarMobile /> : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', height: '68px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => fase !== 'lista' ? setFase('lista') : window.location.href = '/'}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                {fase !== 'lista' ? '← {tr('volver')}' : '← {tr('inicio')}'}
              </button>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>🎓 {tr('materialesEstudioTitulo')}</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
                  {quizzes.length} quizzes · {temporales.length > 0 ? `${temporales.length} por guardar · ` : ''}{decks.length} decks
                </p>
              </div>
            </div>
            <button onClick={() => window.location.href = '/materias'}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              📚 {tr('misMaterias')}
            </button>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}
          </div>
        </>
      )}

      {fase === 'lista' && (
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: isMobile ? '16px' : '40px' }}>
          {isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <button onClick={() => window.location.href = '/'} style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>←</button>
              <h1 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>🎓 {tr('materialesEstudioTitulo')}</h1>
            </div>
          )}

          <div style={{ position: 'relative', marginBottom: '24px' }}>
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="{tr('buscarNombreMateria')}"
              style={{ width: '100%', padding: '13px 16px 13px 46px', borderRadius: '14px', border: '2px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => e.currentTarget.style.borderColor = '#a78bfa'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'} />
            <span style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', fontSize: '18px' }}>🔍</span>
          </div>

          <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '28px', gap: '4px' }}>
            {[
              { id: 'quizzes',  label: tr('tabQuizzes'),        count: quizzes.length,    color: '#a78bfa' },
              { id: 'temporal', label: tr('tabPorGuardar'),     count: temporales.length, color: '#f5c842' },
              { id: 'decks',    label: tr('tabDecks'), count: decks.length,      color: 'var(--gold)' },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id as any)}
                style={{ flex: 1, padding: '12px 8px', border: 'none', background: 'transparent', borderBottom: tab === t.id ? `3px solid ${t.color}` : '3px solid transparent', color: tab === t.id ? t.color : 'var(--text-muted)', fontSize: isMobile ? '12px' : '14px', fontWeight: 700, cursor: 'pointer', marginBottom: '-2px', position: 'relative' }}>
                {t.label}
                <span style={{ marginLeft: '6px', background: tab === t.id ? t.color + '22' : 'var(--bg-secondary)', color: tab === t.id ? t.color : 'var(--text-faint)', padding: '2px 7px', borderRadius: '10px', fontSize: '12px', fontWeight: 800 }}>{t.count}</span>
                {t.id === 'temporal' && t.count > 0 && <span style={{ position: 'absolute', top: '8px', right: '8px', width: '8px', height: '8px', borderRadius: '50%', background: '#f5c842' }} />}
              </button>
            ))}
          </div>

          {tab === 'quizzes' && (
            quizzesFiltrados.length === 0
              ? <EmptyState emoji="🤓" titulo={busqueda ? tr('sinResultados') : tr('sinQuizzesGuardados')} desc={busqueda ? tr('pruebaOtroNombre') : tr('generaQuizzesDesc')} boton={!busqueda ? { label: tr('irAMateriasBTN2'), href: '/materias' } : undefined} />
              : <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {quizzesFiltrados.map(quiz => (
                    <QuizCard key={quiz.id} quiz={quiz}
                      onJugar={() => iniciarQuiz(quiz)}
                      onEliminar={async () => { if (!confirm(tr('eliminarQuizConfirm'))) return; await eliminarQuizGuardado(quiz.id); recargar(); }} />
                  ))}
                </div>
          )}

          {tab === 'temporal' && (
            temporalesFiltrados.length === 0
              ? <EmptyState emoji="⏳" titulo="No hay quizzes pendientes" desc="Cuando generes un quiz desde una materia, aparecera aqui. Tienes 24 horas para guardarlo." boton={{ label: tr('irAMateriasBTN2'), href: '/materias' }} />
              : <>
                  <div style={{ background: 'rgba(245,200,66,0.08)', border: '1px solid #f5c84244', borderRadius: '14px', padding: '14px 18px', marginBottom: '20px', display: 'flex', gap: '12px' }}>
                    <span style={{ fontSize: '20px', flexShrink: 0 }}>⚠️</span>
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: 700, color: '#f5c842', margin: '0 0 4px' }}>Guardalos antes de que expiren</p>
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Estos quizzes se borran automaticamente a las 24 horas. Presiona 💾 Guardar para añadirlos a tu biblioteca permanente.</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {temporalesFiltrados.map(quiz => (
                      <TemporalCard key={quiz.id} quiz={quiz}
                        guardadoOk={guardandoOk === quiz.id}
                        onJugar={() => iniciarQuiz(quiz)}
                        onGuardar={() => { setGuardandoId(quiz.id); setNombreTemporal(quiz.nombre || ''); }}
                        onEliminar={() => { if (!confirm(tr('descartarQuizConfirm'))) return; eliminarQuizTemporal(quiz.id); recargar(); }} />
                    ))}
                  </div>
                </>
          )}

          {tab === 'decks' && (
            decksFiltrados.length === 0
              ? <EmptyState emoji="🎴" titulo={busqueda ? tr('sinResultados') : tr('sinDecksGuardados')} desc="Guarda flashcards desde tus materias para estudiarlas aqui" boton={!busqueda ? { label: tr('irAMateriasBTN2'), href: '/materias' } : undefined} />
              : <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {decksFiltrados.map(deck => (
                    <DeckCard key={deck.id} deck={deck}
                      onVer={() => { setDeckActivo(deck); setCurrentCard(0); setFlipped(false); }}
                      onEstudiar={() => { setDeckActivo(deck); setShowEstudio(true); }}
                      onEliminar={async () => { if (!confirm(tr('eliminarDeckConfirm'))) return; await eliminarDeck(deck.id); recargar(); }} />
                  ))}
                </div>
          )}
        </div>
      )}

      {fase === 'lista' && deckActivo && !showEstudio && !showModoExamen && (
        <DeckVisor deck={deckActivo} currentCard={currentCard} flipped={flipped}
          onSetCard={i => { setCurrentCard(i); setFlipped(false); }}
          onFlip={() => setFlipped(f => !f)}
          onEstudiar={() => setShowEstudio(true)}
          onClose={() => setDeckActivo(null)} />
      )}

      {fase === 'jugando' && quizActivo && preguntaActual && (
        <div style={{ maxWidth: '720px', margin: '0 auto', padding: isMobile ? '16px' : '40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{quizActivo.nombre}</h2>
                <NivelBadge nivel={quizActivo.nivel} />
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{tr('preguntaLabel')} {idx + 1} / {quizActivo.preguntas.length} · {puntos} {tr('correctasLabel')}</p>
            </div>
            <button onClick={() => setFase('lista')} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer' }}>✕ Salir</button>
          </div>

          <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', height: '6px', overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ width: `${progreso}%`, height: '100%', background: quizActivo.materiaColor || '#a78bfa', borderRadius: '8px', transition: 'width 0.4s' }} />
          </div>

          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {quizActivo.preguntas.map((_, i) => (
              <div key={i} style={{ width: i === idx ? '22px' : '9px', height: '9px', borderRadius: '5px', background: i < idx ? (resultados[i]?.correcta ? '#4ade80' : '#ff4d6d') : i === idx ? (quizActivo.materiaColor || '#a78bfa') : 'var(--border-color)', transition: 'all 0.3s', flexShrink: 0 }} />
            ))}
          </div>

          <div style={{ background: 'var(--bg-card)', borderRadius: '18px', border: `2px solid ${quizActivo.materiaColor || '#a78bfa'}44`, overflow: 'hidden', marginBottom: '20px' }}>
            <div style={{ height: '4px', background: quizActivo.materiaColor || '#a78bfa' }} />
            <div style={{ padding: '24px 28px' }}>
              <span style={{ fontSize: '11px', color: quizActivo.materiaColor || '#a78bfa', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px' }}>Pregunta {idx + 1}</span>
              <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', margin: '12px 0 0', lineHeight: 1.5 }}><MathText text={preguntaActual.pregunta} /></div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
            {preguntaActual.opciones.map((opcion, i) => {
              const s = getOpcionStyle(i);
              return (
                <button key={`${idx}-${i}`} onClick={() => responder(i)} disabled={respondida}
                  style={{ padding: '14px 18px', borderRadius: '14px', ...s, color: 'var(--text-primary)', fontSize: '15px', fontWeight: 500, cursor: respondida ? 'default' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
                  <span style={{ width: '32px', height: '32px', borderRadius: '50%', border: '2px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, color: 'var(--text-muted)', flexShrink: 0 }}>{getLetra(i)}</span>
                  <span style={{ flex: 1 }}>{opcion}</span>
                </button>
              );
            })}
          </div>

          {respondida && (
            <>
              <div style={{ background: seleccionada === preguntaActual.correcta ? 'rgba(74,222,128,0.1)' : 'rgba(255,77,109,0.1)', border: `2px solid ${seleccionada === preguntaActual.correcta ? '#4ade8066' : '#ff4d6d66'}`, borderRadius: '14px', padding: '16px 20px', marginBottom: '14px' }}>
                <p style={{ fontSize: '13px', fontWeight: 800, color: seleccionada === preguntaActual.correcta ? '#4ade80' : '#ff4d6d', margin: '0 0 6px' }}>{seleccionada === preguntaActual.correcta ? '✅ Correcto!' : '❌ Incorrecto'}</p>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}><MathText text={preguntaActual.explicacion} /></p>
              </div>
              <button onClick={siguiente} style={{ width: '100%', padding: '15px', borderRadius: '14px', border: 'none', background: quizActivo.materiaColor || '#a78bfa', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                {idx + 1 >= quizActivo.preguntas.length ? tr('verResultadosBtn') : tr('siguienteFlecha')}
              </button>
            </>
          )}
        </div>
      )}

      {fase === 'fin' && quizActivo && (
        <div style={{ maxWidth: '640px', margin: '0 auto', padding: isMobile ? '16px' : '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>{porcentaje >= 80 ? '🏆' : porcentaje >= 60 ? '👍' : '📚'}</div>
          <h2 style={{ fontSize: '28px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px' }}>Quiz completado!</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '28px' }}>{puntos} {tr('de')} {quizActivo.preguntas.length} {tr('correctasLabel')}</p>

          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '28px', border: `2px solid ${quizActivo.materiaColor || '#a78bfa'}44`, marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '8px' }}>
              <div style={{ fontSize: '52px', fontWeight: 900, color: quizActivo.materiaColor || '#a78bfa', lineHeight: 1 }}>{puntos}/{quizActivo.preguntas.length}</div>
              <NivelBadge nivel={quizActivo.nivel} />
            </div>
            <div style={{ fontSize: '36px', fontWeight: 900, color: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d', marginTop: '4px' }}>{porcentaje}%</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '6px' }}>{porcentaje >= 80 ? tr('excelente') : porcentaje >= 60 ? tr('bienSigue') : tr('repasaMas')}</div>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', height: '10px', overflow: 'hidden', marginTop: '18px' }}>
              <div style={{ width: `${porcentaje}%`, height: '100%', background: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? '#f5c842' : '#ff4d6d', borderRadius: '10px', transition: 'width 1s' }} />
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', border: '1px solid var(--border-color)', marginBottom: '24px', textAlign: 'left', maxHeight: '260px', overflowY: 'auto' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 14px' }}>Detalle pregunta por pregunta</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {quizActivo.preguntas.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 12px', background: resultados[i]?.correcta ? 'rgba(74,222,128,0.05)' : 'rgba(255,77,109,0.05)', borderRadius: '8px', border: `1px solid ${resultados[i]?.correcta ? '#4ade8022' : '#ff4d6d22'}` }}>
                  <span style={{ fontSize: '14px', flexShrink: 0 }}>{resultados[i]?.correcta ? '✅' : '❌'}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 2px', lineHeight: 1.4 }}>{p.pregunta}</p>
                    {!resultados[i]?.correcta && <p style={{ fontSize: '11px', color: '#4ade80', margin: 0 }}>✓ {p.opciones[p.correcta]}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => iniciarQuiz(quizActivo)} style={{ padding: '13px 24px', borderRadius: '12px', border: 'none', background: quizActivo.materiaColor || '#a78bfa', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>🔄 Repetir</button>
            <button onClick={() => setFase('lista')} style={{ padding: '13px 24px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>← {tr('volver')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
