'use client';

import { useState } from 'react';
import { Documento, Materia, Tema } from '../../lib/storage';
import ChatDocumento from '../flashcards/ChatDocumento';
import EstudioModal from '../flashcards/EstudioModal';
import FlashcardEditor from '../flashcards/FlashcardEditor';
import QuizModal from '../flashcards/QuizModal';
import VisorDocumento from '../VisorDocumento';
import { guardarDeck } from '../../lib/quizStorage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import { getIdioma } from '../../lib/i18n';

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
  const [tab, setTab] = useState<'leer' | 'analisis' | 'flashcards'>('leer');
  const [addCount, setAddCount] = useState(5);
  const [addingMore, setAddingMore] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showEstudio, setShowEstudio] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [showGuardarDeck, setShowGuardarDeck] = useState(false);
  const [nombreDeck, setNombreDeck] = useState('');
  const [deckGuardado, setDeckGuardado] = useState(false);
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  const analizar = async () => {
    setAnalizando(true);
    const idiomaActual = getIdioma();
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: documento.contenido, idioma: idiomaActual }),
        }),
        fetch('/api/flashcards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: documento.contenido, count: flashcardCount, idioma: idiomaActual }),
        }),
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
    const idiomaActual = getIdioma();
    try {
      const res = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: documento.contenido, count: addCount, idioma: idiomaActual }),
      });
      const data = await res.json();
      if (data.success) {
        const nuevas = [...flashcards, ...data.flashcards];
        setFlashcards(nuevas);
        onActualizar({ ...documento, flashcards: nuevas });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setAddingMore(false);
    }
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

  const Indicadores = () => {
    if (flashcards.length <= 15) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', flexWrap: 'wrap', maxWidth: '400px', margin: '0 auto 16px' }}>
          {flashcards.map((_: any, i: number) => (
            <div key={i} onClick={() => { setCurrentCard(i); setFlipped(false); }}
              style={{ width: i === currentCard ? '24px' : '8px', height: '8px', borderRadius: '4px', background: i === currentCard ? tema.color : 'var(--border-color2)', cursor: 'pointer', transition: 'all 0.3s', flexShrink: 0 }} />
          ))}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', flexWrap: 'wrap', maxWidth: '600px', margin: '0 auto 16px' }}>
        {flashcards.map((_: any, i: number) => (
          <button key={i} onClick={() => { setCurrentCard(i); setFlipped(false); }}
            style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: i === currentCard ? tema.color : 'var(--bg-secondary)', color: i === currentCard ? '#000' : 'var(--text-faint)', fontSize: '11px', fontWeight: i === currentCard ? 800 : 400, cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0 }}>
            {i + 1}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div>
      {showChat && <ChatDocumento contexto={documento.contenido} nombreDoc={documento.nombre} temaColor={tema.color} onClose={() => setShowChat(false)} />}
      {showEstudio && flashcards.length > 0 && <EstudioModal flashcards={flashcards} temaColor={tema.color} onClose={() => setShowEstudio(false)} />}
      {showEditor && (
        <FlashcardEditor flashcards={flashcards} temaColor={tema.color}
          onSave={(cards: any) => { setFlashcards(cards); onActualizar({ ...documento, flashcards: cards }); setShowEditor(false); }}
          onClose={() => setShowEditor(false)} />
      )}
      {showQuiz && (
        <QuizModal contenido={documento.contenido} temaColor={tema.color}
          materiaNombre={materia.nombre} materiaColor={materia.color}
          onClose={() => setShowQuiz(false)} />
      )}

      {showGuardarDeck && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '420px', border: '1px solid var(--border-color)' }}>
            <div style={{ height: '4px', background: tema.color, borderRadius: '2px', marginBottom: '24px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              💾 {tr('guardarDeck')}
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
              {flashcards.length} {tr('tarjetas')} &quot;{documento.nombre}&quot;
            </p>
            {deckGuardado ? (
              <div style={{ background: '#4ade8015', border: '1px solid #4ade8044', borderRadius: '10px', padding: '14px', marginBottom: '20px' }}>
                <p style={{ fontSize: '14px', color: '#4ade80', margin: 0, fontWeight: 600 }}>✅ {tr('deckGuardado')}</p>
              </div>
            ) : (
              <div style={{ marginBottom: '20px' }}>
                <input value={nombreDeck} onChange={e => setNombreDeck(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGuardarDeck()}
                  placeholder={tr('nombreDeck')} autoFocus
                  style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setShowGuardarDeck(false); setDeckGuardado(false); }}
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                {deckGuardado ? tr('cerrar') : tr('cancelar')}
              </button>
              {!deckGuardado && (
                <button onClick={handleGuardarDeck} disabled={!nombreDeck.trim()}
                  style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: nombreDeck.trim() ? tema.color : 'var(--bg-card2)', color: nombreDeck.trim() ? '#000' : 'var(--text-faint)', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                  💾 {tr('guardar')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>📚 {tr('materias')}</button>
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
            <div style={{ width: '4px', height: '32px', background: tema.color, borderRadius: '2px' }} />
            <div>
              <h1 style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{documento.nombre}</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
                {tr('subido')}: {documento.fechaSubida}
                {documento.analisis && <span style={{ color: '#4ade80', marginLeft: '8px', fontWeight: 700 }}>✓ {tr('analizado')}</span>}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setShowChat(true)}
              style={{ padding: '9px 14px', borderRadius: '10px', border: `2px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              {tr('chat')}
            </button>
            <button onClick={() => setShowQuiz(true)}
              style={{ padding: '9px 14px', borderRadius: '10px', border: '2px solid #a78bfa', background: 'transparent', color: '#a78bfa', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              {tr('quiz')}
            </button>
            {!documento.analisis && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>FC:</span>
                <select value={flashcardCount} onChange={e => setFlashcardCount(parseInt(e.target.value))}
                  style={{ padding: '5px 8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px' }}>
                  {[5, 8, 10, 15, 20, 25, 30].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            <button onClick={analizar} disabled={analizando}
              style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', background: analizando ? 'var(--bg-card2)' : 'var(--gold)', color: analizando ? 'var(--text-faint)' : '#000', fontSize: '12px', fontWeight: 800, cursor: analizando ? 'not-allowed' : 'pointer' }}>
              {analizando ? tr('analizando') : documento.analisis ? tr('reAnalizar') : tr('analizar')}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '24px', overflowX: 'auto' }}>
          {[
            { id: 'leer', label: `📖 ${documento.archivoUrl || (documento as any).archivoBase64 ? tr('verDocumento') : tr('leerTexto')}` },
            { id: 'analisis', label: `🔍 ${tr('analisisAI')}${documento.analisis ? ' ✓' : ''}` },
            { id: 'flashcards', label: `🎴 ${tr('flashcards')}${flashcards.length > 0 ? ` (${flashcards.length})` : ''}` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              style={{ padding: '12px 20px', border: 'none', background: 'transparent', borderBottom: tab === t.id ? `3px solid ${tema.color}` : '3px solid transparent', color: tab === t.id ? tema.color : 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', marginBottom: '-2px', whiteSpace: 'nowrap' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB LEER */}
        {tab === 'leer' && (
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: tema.color }} />
            <VisorDocumento
              contenido={documento.contenido}
              tipo={documento.tipo}
              nombre={documento.nombre}
              archivoUrl={documento.archivoUrl}
              archivoBase64={(documento as any).archivoBase64}
              archivoMime={(documento as any).archivoMime}
              analisis={documento.analisis}
              temaColor={tema.color}
            />
          </div>
        )}

        {/* TAB ANÁLISIS */}
        {tab === 'analisis' && (
          <div>
            {!documento.analisis ? (
              <div style={{ textAlign: 'center', padding: '60px 0' }}>
                <div style={{ fontSize: '60px', marginBottom: '16px' }}>🔍</div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{tr('sinAnalisis')}</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>{tr('tocaAnalizar')}</p>
                <button onClick={analizar} disabled={analizando}
                  style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                  {analizando ? tr('analizando') : tr('analizarDocumento')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `2px solid ${tema.color}44`, overflow: 'hidden' }}>
                  <div style={{ height: '4px', background: tema.color }} />
                  <div style={{ padding: '24px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 800, color: tema.color, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>{tr('resumenDocumento')}</h3>
                    <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{documento.analisis.summary}</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                  <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: 'var(--blue)' }} />
                    <div style={{ padding: '20px' }}>
                      <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 14px' }}>
                        {tr('palabrasClave')} ({documento.analisis.keywords?.length || 0})
                      </h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {documento.analisis.keywords?.map((k: string, i: number) => (
                          <span key={i} style={{ background: 'var(--blue)', color: '#000', padding: '5px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 700 }}>{k}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `2px solid ${tema.color}44`, overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: tema.color }} />
                    <div style={{ padding: '20px' }}>
                      <h3 style={{ fontSize: '14px', fontWeight: 800, color: tema.color, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 14px' }}>
                        {tr('frasesImportantes')} ({documento.analisis.important_phrases?.length || 0})
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {documento.analisis.important_phrases?.map((p: string, i: number) => (
                          <div key={i} style={{ background: tema.color, color: '#000', padding: '10px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, lineHeight: 1.5 }}>
                            &quot;{p}&quot;
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <button onClick={() => setTab('leer')}
                    style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: tema.color, color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                    {tr('leerConHighlights')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB FLASHCARDS */}
        {tab === 'flashcards' && (
          <div>
            {flashcards.length > 0 ? (
              <div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => setShowEstudio(true)}
                      style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                      {tr('modoEstudio')}
                    </button>
                    <button onClick={() => setShowQuiz(true)}
                      style={{ padding: '10px 14px', borderRadius: '10px', border: '2px solid #a78bfa', background: 'transparent', color: '#a78bfa', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      {tr('quiz')}
                    </button>
                    <button onClick={() => setShowEditor(true)}
                      style={{ padding: '10px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      ✏️ {tr('editar')}
                    </button>
                    <button onClick={() => { setShowGuardarDeck(true); setDeckGuardado(false); }}
                      style={{ padding: '10px 14px', borderRadius: '10px', border: '2px solid #4ade80', background: 'transparent', color: '#4ade80', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      💾 {tr('guardarDeck')}
                    </button>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{flashcards.length} {tr('tarjetas')}</span>
                </div>

                <Indicadores />

                <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                  <span style={{ background: tema.color, color: '#000', padding: '5px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 800 }}>
                    {currentCard + 1} / {flashcards.length}
                  </span>
                </div>

                <div onClick={() => setFlipped(!flipped)}
                  className={`flip-card ${flipped ? 'flipped' : ''}`}
                  style={{ height: '300px', cursor: 'pointer', maxWidth: '640px', margin: '0 auto' }}>
                  <div className="flip-card-inner" style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <div className="flip-card-front" style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '36px 44px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--gold)' }} />
                        <div style={{ position: 'absolute', top: '16px', left: '16px', background: 'var(--gold)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>{tr('pregunta')}</div>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.6, margin: '16px 0 0' }}>{flashcards[currentCard]?.question}</h3>
                        <p style={{ color: 'var(--text-faint)', fontSize: '11px', margin: '16px 0 0' }}>{tr('tocaVerRespuesta')}</p>
                      </div>
                    </div>
                    <div className="flip-card-back" style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '36px 44px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--red)' }} />
                        <div style={{ position: 'absolute', top: '16px', left: '16px', background: 'var(--red)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>{tr('respuesta')}</div>
                        <p style={{ fontSize: '16px', textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.7, margin: '16px 0 0' }}>{flashcards[currentCard]?.answer}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '20px' }}>
                  <button onClick={() => { setFlipped(false); setCurrentCard((currentCard - 1 + flashcards.length) % flashcards.length); }}
                    style={{ padding: '10px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    ⬅️ {tr('anterior')}
                  </button>
                  <button onClick={() => { setFlipped(false); setCurrentCard((currentCard + 1) % flashcards.length); }}
                    style={{ padding: '10px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    {tr('siguiente')} ➡️
                  </button>
                </div>

                <div style={{ marginTop: '28px', background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', maxWidth: '640px', margin: '28px auto 0' }}>
                  <div style={{ height: '3px', background: 'var(--blue)' }} />
                  <div style={{ padding: '18px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>
                      {tr('anadirMas')}
                    </p>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {[3, 5, 10, 15].map(n => (
                        <button key={n} onClick={() => setAddCount(n)}
                          style={{ padding: '7px 13px', borderRadius: '7px', border: `2px solid ${addCount === n ? 'var(--blue)' : 'var(--border-color)'}`, cursor: 'pointer', fontSize: '13px', fontWeight: 700, background: addCount === n ? 'var(--blue)' : 'transparent', color: addCount === n ? '#000' : 'var(--text-muted)' }}>
                          +{n}
                        </button>
                      ))}
                      <button onClick={addMore} disabled={addingMore}
                        style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', cursor: addingMore ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 800, color: addingMore ? 'var(--text-faint)' : '#000', background: addingMore ? 'var(--bg-card2)' : 'var(--blue)' }}>
                        {addingMore ? '⏳...' : `➕ ${addCount}`}
                      </button>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '8px 0 0' }}>
                      {tr('total')}: {flashcards.length} {tr('tarjetas')}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px 0' }}>
                <div style={{ fontSize: '60px', marginBottom: '12px' }}>🎴</div>
                <p style={{ fontSize: '16px', color: 'var(--text-faint)', marginBottom: '20px' }}>
                  {tr('noHayFlashcards')}
                </p>
                <button onClick={analizar} disabled={analizando}
                  style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                  {analizando ? tr('analizando') : tr('analizarGenerar')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}