'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { getQuizzesGuardados, eliminarQuizGuardado, QuizGuardado, getFlashcardDecks, eliminarDeck, FlashcardDeck } from '../../lib/quizStorage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import NavbarMobile from '../../components/NavbarMobile';
import EstudioModal from '../../components/flashcards/EstudioModal';
import ModoExamen from '../../components/flashcards/ModoExamen';

export default function QuizzesPage() {
  const [tab, setTab] = useState<'quizzes' | 'decks'>('quizzes');
  const [quizzes, setQuizzes] = useState<QuizGuardado[]>([]);
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [quizActivo, setQuizActivo] = useState<QuizGuardado | null>(null);
  const [deckActivo, setDeckActivo] = useState<FlashcardDeck | null>(null);
  const [showEstudio, setShowEstudio] = useState(false);
  const [showModoExamen, setShowModoExamen] = useState(false);
  const { tr, idioma } = useIdioma();

  // Quiz state
  const [idx, setIdx] = useState(0);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [respondida, setRespondida] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [resultados, setResultados] = useState<{ correcta: boolean }[]>([]);
  const [fase, setFase] = useState<'lista' | 'jugando' | 'fin'>('lista');

  // Deck viewer state
  const [currentCard, setCurrentCard] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const isMobile = useIsMobile();

  useEffect(() => {
    setQuizzes(getQuizzesGuardados());
    setDecks(getFlashcardDecks());
  }, []);

  const quizzesFiltrados = quizzes.filter(q =>
    q.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    q.materiaNombre?.toLowerCase().includes(busqueda.toLowerCase())
  );

  const decksFiltrados = decks.filter(d =>
    d.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    d.materiaNombre?.toLowerCase().includes(busqueda.toLowerCase())
  );

  const iniciarQuiz = (quiz: QuizGuardado) => {
    setQuizActivo(quiz);
    setIdx(0); setSeleccionada(null); setRespondida(false);
    setPuntos(0); setResultados([]);
    setFase('jugando');
  };

  const eliminarQuiz = (id: string) => {
    if (!confirm(idioma === 'en' ? 'Delete this quiz?' : '¿Eliminar este quiz?')) return;
    eliminarQuizGuardado(id);
    setQuizzes(getQuizzesGuardados());
  };

  const eliminarDeckFn = (id: string) => {
    if (!confirm(idioma === 'en' ? 'Delete this deck?' : '¿Eliminar este deck?')) return;
    eliminarDeck(id);
    setDecks(getFlashcardDecks());
  };

  const responder = (i: number) => {
    if (respondida || !quizActivo) return;
    setSeleccionada(i);
    setRespondida(true);
    const esCorrecta = i === quizActivo.preguntas[idx].correcta;
    if (esCorrecta) setPuntos(p => p + 1);
    setResultados(prev => [...prev, { correcta: esCorrecta }]);
  };

  const siguiente = () => {
    if (!quizActivo) return;
    if (idx + 1 >= quizActivo.preguntas.length) { setFase('fin'); }
    else { setIdx(i => i + 1); setSeleccionada(null); setRespondida(false); }
  };

  const preguntaActual = quizActivo?.preguntas[idx];
  const porcentaje = quizActivo ? Math.round((puntos / quizActivo.preguntas.length) * 100) : 0;
  const progreso = quizActivo ? (idx / quizActivo.preguntas.length) * 100 : 0;

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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {/* EstudioModal del deck activo */}
      {showEstudio && deckActivo && (
        <EstudioModal
          flashcards={deckActivo.flashcards}
          temaColor={deckActivo.temaColor || deckActivo.materiaColor || 'var(--gold)'}
          onClose={() => { setShowEstudio(false); }}
          onModoExamen={() => {
            setShowEstudio(false);
            setShowModoExamen(true);
          }}
        />
      )}

      {/* ModoExamen del deck activo */}
      {showModoExamen && deckActivo && (
        <ModoExamen
          flashcards={deckActivo.flashcards}
          contenido=""
          nombreDoc={deckActivo.nombre}
          temaColor={deckActivo.temaColor || deckActivo.materiaColor || 'var(--gold)'}
          onClose={() => setShowModoExamen(false)}
        />
      )}

      {/* NAVBAR */}
      {isMobile ? <NavbarMobile /> : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', height: '68px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => fase !== 'lista' ? setFase('lista') : window.location.href = '/'}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                {fase !== 'lista' ? `← ${tr('volver')}` : `← ${tr('inicio')}`}
              </button>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>🎓 {tr('materialesEstudio')}</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
                  {quizzes.length} {tr('quizzes').toLowerCase()} · {decks.length} decks
                </p>
              </div>
            </div>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            <div style={{ flex: 1, background: 'var(--gold)' }} />
            <div style={{ flex: 1, background: 'var(--red)' }} />
            <div style={{ flex: 1, background: 'var(--blue)' }} />
            <div style={{ flex: 1, background: 'var(--pink)' }} />
          </div>
        </>
      )}

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: isMobile ? '16px' : '40px' }}>

        {/* ===== LISTA ===== */}
        {fase === 'lista' && (
          <div>
            {isMobile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <button onClick={() => window.location.href = '/'}
                  style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>←</button>
                <h1 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>🎓 {tr('materialesEstudio')}</h1>
              </div>
            )}

            {/* Buscador */}
            <div style={{ position: 'relative', marginBottom: '20px' }}>
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                placeholder={idioma === 'en' ? 'Search by name or subject...' : 'Buscar por nombre o materia...'}
                style={{ width: '100%', padding: '12px 16px 12px 44px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
              />
              <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '18px' }}>🔍</span>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '24px' }}>
              <button onClick={() => setTab('quizzes')}
                style={{ flex: 1, padding: '12px', border: 'none', background: 'transparent', borderBottom: tab === 'quizzes' ? '3px solid #a78bfa' : '3px solid transparent', color: tab === 'quizzes' ? '#a78bfa' : 'var(--text-muted)', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginBottom: '-2px' }}>
                🤓 {tr('quizzes')} ({quizzes.length})
              </button>
              <button onClick={() => setTab('decks')}
                style={{ flex: 1, padding: '12px', border: 'none', background: 'transparent', borderBottom: tab === 'decks' ? '3px solid var(--gold)' : '3px solid transparent', color: tab === 'decks' ? 'var(--gold)' : 'var(--text-muted)', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginBottom: '-2px' }}>
                🎴 {tr('flashcardDecks')} ({decks.length})
              </button>
            </div>

            {/* QUIZZES */}
            {tab === 'quizzes' && (
              <div>
                {quizzesFiltrados.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0' }}>
                    <div style={{ fontSize: '60px', marginBottom: '12px' }}>🤓</div>
                    <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                      {busqueda ? (idioma === 'en' ? 'No results' : 'Sin resultados') : tr('sinQuizzes')}
                    </p>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{tr('creaQuiz')}</p>
                    {!busqueda && (
                      <button onClick={() => window.location.href = '/materias'}
                        style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                        📚 {tr('misMaterias')}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {quizzesFiltrados.map(quiz => (
                      <div key={quiz.id} style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `1px solid ${quiz.materiaColor || '#a78bfa'}44`, overflow: 'hidden' }}>
                        <div style={{ height: '4px', background: quiz.materiaColor || '#a78bfa' }} />
                        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quiz.nombre}</h3>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>🤓 {quiz.preguntas.length} {tr('preguntas').toLowerCase()}</span>
                              {quiz.materiaNombre && <span style={{ fontSize: '12px', color: quiz.materiaColor || '#a78bfa', fontWeight: 600 }}>· {quiz.materiaNombre}</span>}
                              <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>· {quiz.fechaCreacion}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                            <button onClick={() => iniciarQuiz(quiz)}
                              style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: quiz.materiaColor || '#a78bfa', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                              ▶ {tr('jugar')}
                            </button>
                            <button onClick={() => eliminarQuiz(quiz.id)}
                              style={{ padding: '9px 12px', borderRadius: '10px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '14px', cursor: 'pointer' }}>
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

            {/* DECKS */}
            {tab === 'decks' && (
              <div>
                {decksFiltrados.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0' }}>
                    <div style={{ fontSize: '60px', marginBottom: '12px' }}>🎴</div>
                    <p style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                      {busqueda ? (idioma === 'en' ? 'No results' : 'Sin resultados') : tr('sinDecks')}
                    </p>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{tr('guardaDeck')}</p>
                    {!busqueda && (
                      <button onClick={() => window.location.href = '/materias'}
                        style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                        📚 {tr('misMaterias')}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {decksFiltrados.map(deck => (
                      <div key={deck.id} style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `1px solid ${deck.materiaColor || 'var(--gold)'}44`, overflow: 'hidden' }}>
                        <div style={{ height: '4px', background: deck.materiaColor || 'var(--gold)' }} />
                        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deck.nombre}</h3>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>🎴 {deck.flashcards.length} flashcards</span>
                              {deck.materiaNombre && <span style={{ fontSize: '12px', color: deck.materiaColor || 'var(--gold)', fontWeight: 600 }}>· {deck.materiaNombre}</span>}
                              <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>· {deck.fechaCreacion}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                            <button onClick={() => { setDeckActivo(deck); setCurrentCard(0); setFlipped(false); }}
                              style={{ padding: '9px 14px', borderRadius: '10px', border: `2px solid ${deck.materiaColor || 'var(--gold)'}`, background: 'transparent', color: deck.materiaColor || 'var(--gold)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                              🎴 {tr('ver')}
                            </button>
                            <button onClick={() => { setDeckActivo(deck); setShowEstudio(true); }}
                              style={{ padding: '9px 14px', borderRadius: '10px', border: 'none', background: deck.materiaColor || 'var(--gold)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                              🧠 {tr('estudiar')}
                            </button>
                            <button onClick={() => eliminarDeckFn(deck.id)}
                              style={{ padding: '9px 12px', borderRadius: '10px', border: '1px solid var(--red-border)', background: 'transparent', color: 'var(--red)', fontSize: '14px', cursor: 'pointer' }}>
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
          </div>
        )}

        {/* ===== VER DECK ===== */}
        {fase === 'lista' && deckActivo && !showEstudio && !showModoExamen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>
            <div style={{ padding: '16px 24px', background: 'var(--bg-card)', borderBottom: `3px solid ${deckActivo.materiaColor || 'var(--gold)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{deckActivo.nombre}</h2>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{currentCard + 1} / {deckActivo.flashcards.length}</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setShowEstudio(true)}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: deckActivo.materiaColor || 'var(--gold)', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                  🧠 {tr('estudiar')}
                </button>
                <button onClick={() => setDeckActivo(null)}
                  style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                  ✕
                </button>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px' }}>
              <div style={{ maxWidth: '640px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
                  {deckActivo.flashcards.map((_, i) => (
                    <div key={i} onClick={() => { setCurrentCard(i); setFlipped(false); }}
                      style={{ width: i === currentCard ? '24px' : '8px', height: '8px', borderRadius: '4px', background: i === currentCard ? (deckActivo.materiaColor || 'var(--gold)') : 'var(--border-color2)', cursor: 'pointer', transition: 'all 0.3s', flexShrink: 0 }} />
                  ))}
                </div>

                <div onClick={() => setFlipped(!flipped)}
                  className={`flip-card ${flipped ? 'flipped' : ''}`}
                  style={{ height: '300px', cursor: 'pointer' }}>
                  <div className="flip-card-inner" style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <div className="flip-card-front" style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '40px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: `2px solid ${deckActivo.materiaColor || 'var(--gold)'}44`, boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: deckActivo.materiaColor || 'var(--gold)' }} />
                        <div style={{ position: 'absolute', top: '16px', left: '16px', background: deckActivo.materiaColor || 'var(--gold)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>{tr('pregunta').toUpperCase()}</div>
                        <h3 style={{ fontSize: '20px', fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.6, margin: '16px 0 0' }}>
                          {deckActivo.flashcards[currentCard]?.question}
                        </h3>
                        <p style={{ color: 'var(--text-faint)', fontSize: '12px', margin: '16px 0 0' }}>{tr('tocaVerRespuesta')}</p>
                      </div>
                    </div>
                    <div className="flip-card-back" style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '40px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--red-border)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--red)' }} />
                        <div style={{ position: 'absolute', top: '16px', left: '16px', background: 'var(--red)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>{tr('respuesta').toUpperCase()}</div>
                        <p style={{ fontSize: '18px', textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.7, margin: '16px 0 0' }}>
                          {deckActivo.flashcards[currentCard]?.answer}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '24px' }}>
                  <button onClick={() => { setFlipped(false); setCurrentCard((currentCard - 1 + deckActivo.flashcards.length) % deckActivo.flashcards.length); }}
                    style={{ padding: '12px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                    ⬅️ {tr('anterior')}
                  </button>
                  <button onClick={() => { setFlipped(false); setCurrentCard((currentCard + 1) % deckActivo.flashcards.length); }}
                    style={{ padding: '12px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                    {tr('siguiente')} ➡️
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== JUGANDO QUIZ ===== */}
        {fase === 'jugando' && quizActivo && preguntaActual && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>{quizActivo.nombre}</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                  {idioma === 'en' ? 'Question' : 'Pregunta'} {idx + 1} / {quizActivo.preguntas.length} · {puntos} {idioma === 'en' ? 'correct' : 'correctas'}
                </p>
              </div>
              <button onClick={() => setFase('lista')}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', height: '8px', overflow: 'hidden', marginBottom: '20px' }}>
              <div style={{ width: `${progreso}%`, height: '100%', background: quizActivo.materiaColor || '#a78bfa', borderRadius: '8px', transition: 'width 0.4s' }} />
            </div>

            <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {quizActivo.preguntas.map((_, i) => (
                <div key={i} style={{ width: i === idx ? '24px' : '10px', height: '10px', borderRadius: '5px', background: i < idx ? (resultados[i]?.correcta ? '#4ade80' : '#ff4d6d') : i === idx ? (quizActivo.materiaColor || '#a78bfa') : 'var(--border-color)', transition: 'all 0.3s', flexShrink: 0 }} />
              ))}
            </div>

            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `2px solid ${quizActivo.materiaColor || '#a78bfa'}44`, overflow: 'hidden', marginBottom: '20px' }}>
              <div style={{ height: '4px', background: quizActivo.materiaColor || '#a78bfa' }} />
              <div style={{ padding: '24px' }}>
                <span style={{ fontSize: '11px', color: quizActivo.materiaColor || '#a78bfa', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px' }}>
                  {idioma === 'en' ? 'Question' : 'Pregunta'} {idx + 1}
                </span>
                <h3 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', margin: '12px 0 0', lineHeight: 1.5 }}>{preguntaActual.pregunta}</h3>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {preguntaActual.opciones.map((opcion, i) => {
                const s = getOpcionStyle(i);
                return (
                  <button key={`${idx}-${i}`} onClick={() => responder(i)} disabled={respondida}
                    style={{ padding: '14px 18px', borderRadius: '12px', ...s, color: 'var(--text-primary)', fontSize: '15px', fontWeight: 500, cursor: respondida ? 'default' : 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
                    <span style={{ width: '30px', height: '30px', borderRadius: '50%', border: '2px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 800, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {getLetra(i)}
                    </span>
                    <span style={{ flex: 1 }}>{opcion}</span>
                  </button>
                );
              })}
            </div>

            {respondida && (
              <>
                <div style={{ background: seleccionada === preguntaActual.correcta ? 'rgba(74,222,128,0.1)' : 'rgba(255,77,109,0.1)', border: `2px solid ${seleccionada === preguntaActual.correcta ? '#4ade8066' : '#ff4d6d66'}`, borderRadius: '12px', padding: '14px 18px', marginBottom: '14px' }}>
                  <p style={{ fontSize: '13px', fontWeight: 800, color: seleccionada === preguntaActual.correcta ? '#4ade80' : '#ff4d6d', margin: '0 0 6px' }}>
                    {seleccionada === preguntaActual.correcta ? tr('correcto') : tr('incorrecto')}
                  </p>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{preguntaActual.explicacion}</p>
                </div>
                <button onClick={siguiente}
                  style={{ width: '100%', padding: '14px', borderRadius: '12px', border: 'none', background: quizActivo.materiaColor || '#a78bfa', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                  {idx + 1 >= quizActivo.preguntas.length ? tr('verResultados') : `${tr('siguiente')} →`}
                </button>
              </>
            )}
          </div>
        )}

        {/* ===== FIN QUIZ ===== */}
        {fase === 'fin' && quizActivo && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '64px', marginBottom: '16px' }}>{porcentaje >= 80 ? '🏆' : porcentaje >= 60 ? '👍' : '📚'}</div>
            <h2 style={{ fontSize: '26px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              {idioma === 'en' ? 'Quiz completed!' : '¡Quiz completado!'}
            </h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
              {puntos} {idioma === 'en' ? 'of' : 'de'} {quizActivo.preguntas.length} {idioma === 'en' ? 'correct' : 'correctas'}
            </p>

            <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '28px', border: `2px solid ${quizActivo.materiaColor || '#a78bfa'}44`, marginBottom: '24px' }}>
              <div style={{ fontSize: '56px', fontWeight: 900, color: quizActivo.materiaColor || '#a78bfa', lineHeight: 1 }}>{puntos}/{quizActivo.preguntas.length}</div>
              <div style={{ fontSize: '32px', fontWeight: 900, color: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? 'var(--gold)' : 'var(--red)', marginTop: '8px' }}>{porcentaje}%</div>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', height: '10px', overflow: 'hidden', marginTop: '16px' }}>
                <div style={{ width: `${porcentaje}%`, height: '100%', background: porcentaje >= 80 ? '#4ade80' : porcentaje >= 60 ? 'var(--gold)' : 'var(--red)', borderRadius: '10px', transition: 'width 1s' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => iniciarQuiz(quizActivo)}
                style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: quizActivo.materiaColor || '#a78bfa', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                {tr('repetir')}
              </button>
              <button onClick={() => setFase('lista')}
                style={{ padding: '12px 24px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                {tr('volver')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}