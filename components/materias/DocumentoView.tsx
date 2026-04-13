'use client';

import { useState } from 'react';
import { Documento, Materia, Tema } from '../../lib/storage';
import ChatDocumento from '../flashcards/ChatDocumento';
import EstudioModal from '../flashcards/EstudioModal';
import FlashcardEditor from '../flashcards/FlashcardEditor';
import QuizModal from '../flashcards/QuizModal';
import { guardarQuiz, guardarDeck, getFlashcardDecks, eliminarDeck, FlashcardDeck } from '../../lib/quizStorage';

interface Props {
  documento: Documento;
  materia: Materia;
  tema: Tema;
  onBack: () => void;
  onBackMateria: () => void;
  onBackTema: () => void;
  onActualizar: (doc: Documento) => void;
}

export default function DocumentoView({
  documento, materia, tema,
  onBack, onBackMateria, onBackTema, onActualizar,
}: Props) {
  const [analizando, setAnalizando] = useState(false);
  const [flashcardCount, setFlashcardCount] = useState(8);
  const [flashcards, setFlashcards] = useState(documento.flashcards || []);
  const [currentCard, setCurrentCard] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState<'ver' | 'flashcards'>('ver');
  const [addCount, setAddCount] = useState(5);
  const [addingMore, setAddingMore] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showEstudio, setShowEstudio] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);

  // Guardar deck modal
  const [showGuardarDeck, setShowGuardarDeck] = useState(false);
  const [nombreDeck, setNombreDeck] = useState('');
  const [deckGuardado, setDeckGuardado] = useState(false);

  const analizar = async () => {
    setAnalizando(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: documento.contenido }) }),
        fetch('/api/flashcards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: documento.contenido, count: flashcardCount }) }),
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      const docActualizado = {
        ...documento,
        analisis: d1.success ? d1.analysis : documento.analisis,
        flashcards: d2.success ? d2.flashcards : documento.flashcards,
      };
      if (d2.success) setFlashcards(d2.flashcards);
      onActualizar(docActualizado);
    } catch (err) {
      console.error(err);
    } finally {
      setAnalizando(false);
    }
  };

  const addMore = async () => {
    setAddingMore(true);
    try {
      const res = await fetch('/api/flashcards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: documento.contenido, count: addCount }) });
      const data = await res.json();
      if (data.success) {
        const nuevas = [...flashcards, ...data.flashcards];
        setFlashcards(nuevas);
        onActualizar({ ...documento, flashcards: nuevas });
      }
    } catch (err) { console.error(err); }
    finally { setAddingMore(false); }
  };

  const handleGuardarDeck = () => {
    if (!nombreDeck.trim()) return;
    guardarDeck({
      nombre: nombreDeck,
      flashcards,
      materiaNombre: materia.nombre,
      materiaColor: materia.color,
      temaColor: tema.color,
    });
    setDeckGuardado(true);
    setNombreDeck('');
  };

  const highlightText = (text: string) => {
    if (!documento.analisis) return <span style={{ color: 'var(--text-secondary)' }}>{text}</span>;
    let remaining = text;
    documento.analisis.important_phrases?.forEach(p => {
      remaining = remaining.replace(new RegExp(`(${p})`, 'gi'), `|||PHRASE:$1|||`);
    });
    documento.analisis.keywords?.forEach(k => {
      remaining = remaining.replace(new RegExp(`(${k})`, 'gi'), `|||KEYWORD:$1|||`);
    });
    const parts: { text: string; type: string }[] = [];
    remaining.split('|||').forEach(seg => {
      if (seg.startsWith('PHRASE:')) parts.push({ text: seg.replace('PHRASE:', ''), type: 'phrase' });
      else if (seg.startsWith('KEYWORD:')) parts.push({ text: seg.replace('KEYWORD:', ''), type: 'keyword' });
      else if (seg) parts.push({ text: seg, type: 'normal' });
    });
    return (
      <span>
        {parts.map((p, i) => {
          if (p.type === 'phrase') return <mark key={i} style={{ background: 'var(--gold)', color: '#000', borderRadius: '3px', padding: '0 3px', fontWeight: 700 }}>{p.text}</mark>;
          if (p.type === 'keyword') return <mark key={i} style={{ background: 'var(--blue)', color: '#000', borderRadius: '3px', padding: '0 3px', fontWeight: 600 }}>{p.text}</mark>;
          return <span key={i} style={{ color: 'var(--text-secondary)' }}>{p.text}</span>;
        })}
      </span>
    );
  };

  const Indicadores = () => {
    if (flashcards.length <= 15) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', flexWrap: 'wrap', maxWidth: '400px', margin: '0 auto 16px' }}>
          {flashcards.map((_, i) => (
            <div key={i} onClick={() => { setCurrentCard(i); setFlipped(false); }}
              style={{ width: i === currentCard ? '24px' : '8px', height: '8px', borderRadius: '4px', background: i === currentCard ? tema.color : 'var(--border-color2)', cursor: 'pointer', transition: 'all 0.3s', flexShrink: 0 }} />
          ))}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', flexWrap: 'wrap', maxWidth: '600px', margin: '0 auto 16px' }}>
        {flashcards.map((_, i) => (
          <button key={i} onClick={() => { setCurrentCard(i); setFlipped(false); }}
            style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: i === currentCard ? tema.color : 'var(--bg-secondary)', color: i === currentCard ? '#000' : 'var(--text-faint)', fontSize: '11px', fontWeight: i === currentCard ? 800 : 400, cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0 }}>
            {i + 1}
          </button>
        ))}
      </div>
    );
  };

  return (
    <>
      {showChat && <ChatDocumento contexto={documento.contenido} nombreDoc={documento.nombre} temaColor={tema.color} onClose={() => setShowChat(false)} />}
      {showEstudio && flashcards.length > 0 && <EstudioModal flashcards={flashcards} temaColor={tema.color} onClose={() => setShowEstudio(false)} />}
      {showEditor && (
        <FlashcardEditor flashcards={flashcards} temaColor={tema.color}
          onSave={cards => { setFlashcards(cards); onActualizar({ ...documento, flashcards: cards }); setShowEditor(false); }}
          onClose={() => setShowEditor(false)} />
      )}
      {showQuiz && (
        <QuizModal contenido={documento.contenido} temaColor={tema.color}
          materiaNombre={materia.nombre} materiaColor={materia.color}
          onClose={() => setShowQuiz(false)} />
      )}

      {/* Modal guardar deck */}
      {showGuardarDeck && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '420px', border: '1px solid var(--border-color)' }}>
            <div style={{ height: '4px', background: tema.color, borderRadius: '2px', marginBottom: '24px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              💾 Guardar deck de flashcards
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
              {flashcards.length} flashcards de "{documento.nombre}"
            </p>

            {deckGuardado ? (
              <div style={{ background: '#4ade8015', border: '1px solid #4ade8044', borderRadius: '10px', padding: '14px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>✅</span>
                <p style={{ fontSize: '14px', color: '#4ade80', margin: 0, fontWeight: 600 }}>¡Deck guardado exitosamente!</p>
              </div>
            ) : (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>
                  Nombre del deck
                </label>
                <input
                  value={nombreDeck}
                  onChange={e => setNombreDeck(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGuardarDeck()}
                  placeholder="Ej: Tema 1 - Introducción..."
                  autoFocus
                  style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
                  onFocus={e => e.currentTarget.style.borderColor = tema.color}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setShowGuardarDeck(false); setDeckGuardado(false); }}
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                {deckGuardado ? 'Cerrar' : 'Cancelar'}
              </button>
              {!deckGuardado && (
                <button onClick={handleGuardarDeck} disabled={!nombreDeck.trim()}
                  style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: nombreDeck.trim() ? tema.color : 'var(--bg-card2)', color: nombreDeck.trim() ? '#000' : 'var(--text-faint)', fontSize: '14px', fontWeight: 800, cursor: nombreDeck.trim() ? 'pointer' : 'not-allowed' }}>
                  💾 Guardar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>📚 Materias</button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackMateria} style={{ background: 'none', border: 'none', color: materia.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>{materia.emoji} {materia.nombre}</button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackTema} style={{ background: 'none', border: 'none', color: tema.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>📁 {tema.nombre}</button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>📄 {documento.nombre}</span>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '4px', height: '32px', background: 'var(--blue)', borderRadius: '2px' }} />
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{documento.nombre}</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>Subido: {documento.fechaSubida}</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setShowChat(true)}
              style={{ padding: '10px 16px', borderRadius: '10px', border: `2px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              💬 Chat
            </button>
            <button onClick={() => setShowQuiz(true)}
              style={{ padding: '10px 16px', borderRadius: '10px', border: '2px solid #a78bfa', background: 'transparent', color: '#a78bfa', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              🤓 Quiz
            </button>
            {!documento.analisis && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Flashcards:</span>
                <select value={flashcardCount} onChange={e => setFlashcardCount(parseInt(e.target.value))}
                  style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '13px' }}>
                  {[5, 8, 10, 15, 20, 25, 30].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            <button onClick={analizar} disabled={analizando}
              style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: analizando ? 'var(--bg-card2)' : 'var(--gold)', color: analizando ? 'var(--text-faint)' : '#000', fontSize: '13px', fontWeight: 800, cursor: analizando ? 'not-allowed' : 'pointer' }}>
              {analizando ? '⏳ Analizando...' : documento.analisis ? '🔄 Re-analizar' : '🔍 Analizar'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '24px' }}>
          {[
            { id: 'ver', label: '📖 Ver Documento' },
            { id: 'flashcards', label: `🎴 Flashcards ${flashcards.length > 0 ? `(${flashcards.length})` : ''}` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              style={{ padding: '12px 24px', border: 'none', background: 'transparent', borderBottom: tab === t.id ? `3px solid ${tema.color}` : '3px solid transparent', color: tab === t.id ? tema.color : 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', marginBottom: '-2px' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB VER */}
        {tab === 'ver' && (
          <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ height: '4px', background: 'var(--blue)' }} />
              <div style={{ padding: '24px' }}>
                {documento.analisis && (
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '16px', height: '8px', borderRadius: '2px', background: 'var(--blue)' }} />
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Palabras clave</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '16px', height: '8px', borderRadius: '2px', background: 'var(--gold)' }} />
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Frases importantes</span>
                    </div>
                  </div>
                )}
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '20px', maxHeight: '560px', overflowY: 'auto', border: '1px solid var(--border-color)', lineHeight: 1.9, fontSize: '15px' }}>
                  {documento.contenido.split('\n').map((p, i) => (
                    p.trim() && <p key={i} style={{ marginBottom: '12px' }}>{highlightText(p)}</p>
                  ))}
                </div>
              </div>
            </div>

            {documento.analisis && (
              <div style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  { title: 'Resumen', color: 'var(--pink)', content: <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{documento.analisis.summary}</p> },
                  { title: 'Keywords', color: 'var(--blue)', content: <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>{documento.analisis.keywords?.map((k, i) => <span key={i} style={{ background: 'var(--blue)', color: '#000', padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700 }}>{k}</span>)}</div> },
                  { title: 'Frases', color: 'var(--gold)', content: <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>{documento.analisis.important_phrases?.map((p, i) => <div key={i} style={{ background: 'var(--gold)', color: '#000', padding: '5px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600 }}>{p}</div>)}</div> },
                ].map((panel, i) => (
                  <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ height: '3px', background: panel.color }} />
                    <div style={{ padding: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <div style={{ width: '3px', height: '12px', background: panel.color, borderRadius: '2px' }} />
                        <h3 style={{ fontSize: '10px', fontWeight: 800, color: panel.color, textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>{panel.title}</h3>
                      </div>
                      {panel.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB FLASHCARDS */}
        {tab === 'flashcards' && (
          <div>
            {flashcards.length > 0 ? (
              <>
                {/* Botones acción */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => setShowEstudio(true)}
                      style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                      🧠 Modo Estudio
                    </button>
                    <button onClick={() => setShowQuiz(true)}
                      style={{ padding: '10px 16px', borderRadius: '10px', border: '2px solid #a78bfa', background: 'transparent', color: '#a78bfa', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      🤓 Quiz
                    </button>
                    <button onClick={() => setShowEditor(true)}
                      style={{ padding: '10px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      ✏️ Editar
                    </button>
                    <button onClick={() => { setShowGuardarDeck(true); setDeckGuardado(false); }}
                      style={{ padding: '10px 16px', borderRadius: '10px', border: '2px solid #4ade80', background: 'transparent', color: '#4ade80', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      💾 Guardar deck
                    </button>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{flashcards.length} tarjetas</span>
                </div>

                <Indicadores />

                <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                  <span style={{ background: tema.color, color: '#000', padding: '5px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 800 }}>
                    {currentCard + 1} / {flashcards.length}
                  </span>
                </div>

                {/* Tarjeta */}
                <div onClick={() => setFlipped(!flipped)}
                  className={`flip-card ${flipped ? 'flipped' : ''}`}
                  style={{ height: '300px', cursor: 'pointer', maxWidth: '640px', margin: '0 auto' }}>
                  <div className="flip-card-inner" style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <div className="flip-card-front" style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '36px 44px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--gold)' }} />
                        <div style={{ position: 'absolute', top: '16px', left: '16px', background: 'var(--gold)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>PREGUNTA</div>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.6, margin: '16px 0 0 0' }}>{flashcards[currentCard]?.question}</h3>
                        <p style={{ color: 'var(--text-faint)', fontSize: '11px', margin: '16px 0 0 0' }}>👆 Toca para ver respuesta</p>
                      </div>
                    </div>
                    <div className="flip-card-back" style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '36px 44px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--red)' }} />
                        <div style={{ position: 'absolute', top: '16px', left: '16px', background: 'var(--red)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>RESPUESTA</div>
                        <p style={{ fontSize: '16px', textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.7, margin: '16px 0 0 0' }}>{flashcards[currentCard]?.answer}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Navegación */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '20px' }}>
                  <button onClick={() => { setFlipped(false); setCurrentCard((currentCard - 1 + flashcards.length) % flashcards.length); }}
                    style={{ padding: '10px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    ⬅️ Anterior
                  </button>
                  <button onClick={() => { setFlipped(false); setCurrentCard((currentCard + 1) % flashcards.length); }}
                    style={{ padding: '10px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    Siguiente ➡️
                  </button>
                </div>

                {/* Añadir más */}
                <div style={{ marginTop: '28px', background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', maxWidth: '640px', margin: '28px auto 0' }}>
                  <div style={{ height: '3px', background: 'var(--blue)' }} />
                  <div style={{ padding: '18px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>➕ Añadir más flashcards</p>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {[3, 5, 10, 15].map(n => (
                        <button key={n} onClick={() => setAddCount(n)}
                          style={{ padding: '7px 13px', borderRadius: '7px', border: `2px solid ${addCount === n ? 'var(--blue)' : 'var(--border-color)'}`, cursor: 'pointer', fontSize: '13px', fontWeight: 700, background: addCount === n ? 'var(--blue)' : 'transparent', color: addCount === n ? '#000' : 'var(--text-muted)' }}>
                          +{n}
                        </button>
                      ))}
                      <button onClick={addMore} disabled={addingMore}
                        style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', cursor: addingMore ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 800, color: addingMore ? 'var(--text-faint)' : '#000', background: addingMore ? 'var(--bg-card2)' : 'var(--blue)' }}>
                        {addingMore ? '⏳...' : `➕ ${addCount} tarjetas`}
                      </button>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '8px 0 0' }}>Total: {flashcards.length} tarjetas</p>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px 0' }}>
                <div style={{ fontSize: '60px', marginBottom: '12px' }}>🎴</div>
                <p style={{ fontSize: '16px', color: 'var(--text-faint)', marginBottom: '20px' }}>No hay flashcards todavía</p>
                <button onClick={analizar} disabled={analizando}
                  style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                  {analizando ? '⏳ Analizando...' : '🔍 Analizar y generar flashcards'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}