'use client';

import { useState } from 'react';
import { Documento, Materia, Tema } from '../../lib/storage';
import ChatDocumento from '../flashcards/ChatDocumento';
import EstudioModal from '../flashcards/EstudioModal';
import FlashcardEditor from '../flashcards/FlashcardEditor';
import QuizModal from '../flashcards/QuizModal';
import ModoExamen from '../flashcards/ModoExamen';
import VisorDocumento from '../VisorDocumento';
import { guardarDeck } from '../../lib/quizStorage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import { getIdioma } from '../../lib/i18n';
import BannerCargando from './BannerCargando';
import AIExhausted from '../AIExhausted';
import TabAnalisis from './TabAnalisis';
import TabFlashcards from './TabFlashcards';

interface Props {
  documento: Documento;
  materia: Materia;
  tema: Tema;
  onBack: () => void;
  onBackMateria: () => void;
  onBackTema: () => void;
  onActualizar: (doc: Documento) => void;
}

export default function DocumentoView({ documento, materia, tema, onBack, onBackMateria, onBackTema, onActualizar }: Props) {
  const [analizando, setAnalizando] = useState(false);
  const [aiExhausted, setAiExhausted] = useState(false);
  const [pasoActual, setPasoActual] = useState(0);
  const [flashcards, setFlashcards] = useState(documento.flashcards || []);
  const [currentCard, setCurrentCard] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tab, setTab] = useState<'leer' | 'analisis' | 'flashcards'>('leer');
  const [addCount, setAddCount] = useState(10);
  const [addingMore, setAddingMore] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showEstudio, setShowEstudio] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [showModoExamen, setShowModoExamen] = useState(false);
  const [showGuardarDeck, setShowGuardarDeck] = useState(false);
  const [nombreDeck, setNombreDeck] = useState('');
  const [deckGuardado, setDeckGuardado] = useState(false);
  const [recommendedCount, setRecommendedCount] = useState<number | null>(null);
  const [recommendedReason, setRecommendedReason] = useState('');
  const [analisisLocal, setAnalisisLocal] = useState(documento.analisis);
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  const trAny = (key: string) => tr(key as any);
  const esImagen = documento.tipo === 'imagen';
  const docBase64 = (documento as any).archivoBase64;
  const docMime = (documento as any).archivoMime;

  useState(() => {
    const handler = (e: KeyboardEvent) => {
      if (tab !== 'flashcards' || flashcards.length === 0) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'ArrowRight') { setFlipped(false); setCurrentCard(prev => (prev + 1) % flashcards.length); }
      if (e.key === 'ArrowLeft') { setFlipped(false); setCurrentCard(prev => (prev - 1 + flashcards.length) % flashcards.length); }
      if (e.key === ' ') { e.preventDefault(); setFlipped(prev => !prev); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const analizar = async () => {
    setAnalizando(true);
    setPasoActual(1);
    const idiomaActual = getIdioma();
    try {
      const r1 = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: documento.contenido,
          idioma: idiomaActual,
          imageBase64: esImagen ? docBase64 : undefined,
          imageMime: esImagen ? docMime : undefined,
          esImagen,
        }),
      });
      const d1 = await r1.json();
      setPasoActual(2);

      if (d1.success && d1.analysis) {
        setAnalisisLocal(d1.analysis);
      }

      const r2 = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: documento.contenido,
          getRecommendation: true,
          idioma: idiomaActual,
          imageBase64: esImagen ? docBase64 : undefined,
          imageMime: esImagen ? docMime : undefined,
        }),
      });
      const d2 = await r2.json();
      const recommended = d2.success ? d2.recommended : 10;
      setRecommendedCount(recommended);
      setRecommendedReason(d2.success ? d2.reason : '');
      setPasoActual(3);

      const r3 = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: documento.contenido,
          count: recommended,
          idioma: idiomaActual,
          existingQuestions: [],
          imageBase64: esImagen ? docBase64 : undefined,
          imageMime: esImagen ? docMime : undefined,
        }),
      });
      const d3 = await r3.json();
      setPasoActual(4);

      const docActualizado = {
        ...documento,
        analisis: d1.success ? d1.analysis : documento.analisis,
        flashcards: d3.success ? d3.flashcards : documento.flashcards,
      };

      if (d3.success) setFlashcards(d3.flashcards);
      onActualizar(docActualizado);
      setTab('analisis');
      setCurrentCard(0);
      setFlipped(false);

    } catch (err: any) {
      if (err?.message === "AI_EXHAUSTED" || err?.message?.includes("All providers")) setAiExhausted(true);
      console.error(err);
    } finally {
      setAnalizando(false);
      setPasoActual(0);
    }
  };

  const addMore = async () => {
    setAddingMore(true);
    const idiomaActual = getIdioma();
    try {
      const res = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: documento.contenido,
          count: addCount,
          idioma: idiomaActual,
          existingQuestions: flashcards.map((f: any) => f.question),
          imageBase64: esImagen ? docBase64 : undefined,
          imageMime: esImagen ? docMime : undefined,
        }),
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
    guardarDeck({ nombre: nombreDeck, flashcards, materiaNombre: materia.nombre, materiaColor: materia.color, temaColor: tema.color });
    setDeckGuardado(true);
    setNombreDeck('');
  };

  return (
    <div>
      {showChat && <ChatDocumento contexto={documento.contenido} nombreDoc={documento.nombre} temaColor={tema.color} onClose={() => setShowChat(false)} />}
      {showEstudio && flashcards.length > 0 && (
        <EstudioModal flashcards={flashcards} temaColor={tema.color} materiaId={materia.id} materiaNombre={materia.nombre} materiaColor={materia.color} onClose={() => setShowEstudio(false)} onModoExamen={() => { setShowEstudio(false); setShowModoExamen(true); }} />
      )}
      {showEditor && (
        <FlashcardEditor flashcards={flashcards} temaColor={tema.color}
          onSave={(cards: any) => { setFlashcards(cards); onActualizar({ ...documento, flashcards: cards }); setShowEditor(false); }}
          onClose={() => setShowEditor(false)} />
      )}
      {showQuiz && (
        <QuizModal contenido={documento.contenido} temaColor={tema.color} materiaNombre={materia.nombre} materiaColor={materia.color} onClose={() => setShowQuiz(false)} />
      )}
      {showModoExamen && (
        <ModoExamen flashcards={flashcards} contenido={documento.contenido} nombreDoc={documento.nombre} temaColor={documento.nombre} onClose={() => setShowModoExamen(false)} />
      )}

      {/* Modal guardar deck */}
      {showGuardarDeck && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '420px', border: '1px solid var(--border-color)' }}>
            <div style={{ height: '4px', background: tema.color, borderRadius: '2px', marginBottom: '24px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>💾 {trAny('guardarDeck')}</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
              {flashcards.length} {trAny('tarjetas')} · &quot;{documento.nombre}&quot;
            </p>
            {deckGuardado ? (
              <div style={{ background: '#4ade8015', border: '1px solid #4ade8044', borderRadius: '10px', padding: '14px', marginBottom: '20px' }}>
                <p style={{ fontSize: '14px', color: '#4ade80', margin: 0, fontWeight: 600 }}>✅ {trAny('deckGuardado')}</p>
              </div>
            ) : (
              <div style={{ marginBottom: '20px' }}>
                <input value={nombreDeck} onChange={e => setNombreDeck(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGuardarDeck()}
                  placeholder={trAny('nombreDeck')} autoFocus
                  style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setShowGuardarDeck(false); setDeckGuardado(false); }}
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                {deckGuardado ? trAny('cerrar') : trAny('cancelar')}
              </button>
              {!deckGuardado && (
                <button onClick={handleGuardarDeck} disabled={!nombreDeck.trim()}
                  style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: nombreDeck.trim() ? tema.color : 'var(--bg-card2)', color: nombreDeck.trim() ? '#000' : 'var(--text-faint)', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                  💾 {trAny('guardar')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>📚 {trAny('materias')}</button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackMateria} style={{ background: 'none', border: 'none', color: materia.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>{materia.emoji} {materia.nombre}</button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackTema} style={{ background: 'none', border: 'none', color: tema.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>📁 {tema.nombre}</button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{esImagen ? '🖼️' : '📄'} {documento.nombre}</span>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '4px', height: '32px', background: tema.color, borderRadius: '2px' }} />
            <div>
              <h1 style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{documento.nombre}</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
                {trAny('subido')}: {documento.fechaSubida}
                {' · '}
                <span style={{ background: esImagen ? 'var(--pink-dim)' : 'var(--blue-dim)', color: esImagen ? 'var(--pink)' : 'var(--blue)', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                  {documento.tipo.toUpperCase()}
                </span>
                {analisisLocal && <span style={{ color: '#4ade80', marginLeft: '8px', fontWeight: 700 }}>✓ {trAny('analizado')}</span>}
                {recommendedCount && <span style={{ color: tema.color, marginLeft: '8px', fontWeight: 700 }}>· {recommendedCount} {idioma === 'en' ? 'recommended' : 'recomendadas'}</span>}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setShowChat(true)}
              style={{ padding: '9px 14px', borderRadius: '10px', border: `2px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              {trAny('chat')}
            </button>
            {!esImagen && (
              <button onClick={() => setShowQuiz(true)}
                style={{ padding: '9px 14px', borderRadius: '10px', border: '2px solid #a78bfa', background: 'transparent', color: '#a78bfa', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                {trAny('quiz')}
              </button>
            )}
            <button onClick={analizar} disabled={analizando}
              style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', background: analizando ? 'var(--bg-card2)' : 'var(--gold)', color: analizando ? 'var(--text-faint)' : '#000', fontSize: '12px', fontWeight: 800, cursor: analizando ? 'not-allowed' : 'pointer', minWidth: '130px' }}>
              {analizando ? '⏳ ...' : analisisLocal ? '🔄 ' + trAny('reAnalizar') : esImagen ? '🔍 ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + trAny('analizar')}
            </button>
          </div>
        </div>

        {/* Banner cargando */}
        {analizando && <BannerCargando pasoActual={pasoActual} temaColor={tema.color} esImagen={esImagen} idioma={idioma} />}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '24px', overflowX: 'auto' }}>
          {[
            { id: 'leer', label: esImagen ? `🖼️ ${idioma === 'en' ? 'Image' : 'Imagen'}` : `📖 ${documento.archivoUrl || docBase64 ? trAny('verDocumento') : trAny('leerTexto')}` },
            { id: 'analisis', label: `🔍 ${trAny('analisisAI')}${analisisLocal ? ' ✓' : ''}` },
            { id: 'flashcards', label: `🎴 ${trAny('flashcards')}${flashcards.length > 0 ? ` (${flashcards.length})` : ''}` },
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
            {esImagen && docBase64 ? (
              <div style={{ padding: '20px', textAlign: 'center' }}>
                <img src={`data:${docMime};base64,${docBase64}`} alt={documento.nombre}
                  style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', objectFit: 'contain' }} />
                {documento.contenido && (
                  <div style={{ marginTop: '16px', background: 'var(--bg-secondary)', borderRadius: '10px', padding: '14px', textAlign: 'left' }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', margin: '0 0 8px' }}>
                      {idioma === 'en' ? '🤖 Extracted text' : '🤖 Texto extraído'}
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6, maxHeight: '200px', overflowY: 'auto' }}>{documento.contenido}</p>
                  </div>
                )}
                {!analisisLocal && !analizando && (
                  <div style={{ marginTop: '20px' }}>
                    <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                      {idioma === 'en' ? '🤖 Analyze this image' : '🤖 Analiza esta imagen'}
                    </p>
                    <button onClick={analizar}
                      style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                      🔍 {idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <VisorDocumento
                  contenido={documento.contenido}
                  tipo={documento.tipo}
                  nombre={documento.nombre}
                  archivoUrl={documento.archivoUrl}
                  archivoBase64={docBase64}
                  archivoMime={docMime}
                  analisis={analisisLocal}
                  temaColor={tema.color}
                />
                {!analisisLocal && !analizando && (
                  <div style={{ padding: '24px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)', textAlign: 'center' }}>
                    <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 12px' }}>
                      {idioma === 'en' ? '🤖 Analyze to extract keywords and generate flashcards' : '🤖 Analiza para extraer palabras clave y generar flashcards'}
                    </p>
                    <button onClick={analizar} disabled={analizando}
                      style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                      🔍 {idioma === 'en' ? 'Analyze & Generate Flashcards' : 'Analizar y Generar Flashcards'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB ANÁLISIS */}
        {tab === 'analisis' && (
          <TabAnalisis
            documento={{ ...documento, analisis: analisisLocal }}
            tema={tema}
            idioma={idioma}
            isMobile={isMobile}
            analizando={analizando}
            recommendedCount={recommendedCount}
            recommendedReason={recommendedReason}
            flashcardsLength={flashcards.length}
            tr={trAny}
            onAnalizar={analizar}
            onVerFlashcards={() => setTab('flashcards')}
            onVerDoc={() => setTab('leer')}
            esImagen={esImagen}
          />
        )}

        {/* TAB FLASHCARDS */}
        {tab === 'flashcards' && (
          <TabFlashcards
            flashcards={flashcards} currentCard={currentCard} flipped={flipped}
            addCount={addCount} addingMore={addingMore} recommendedCount={recommendedCount}
            recommendedReason={recommendedReason} tema={tema} isMobile={isMobile}
            idioma={idioma} esImagen={esImagen} analizando={analizando} tr={trAny}
            onFlip={() => setFlipped(!flipped)}
            onPrev={() => { setFlipped(false); setCurrentCard((currentCard - 1 + flashcards.length) % flashcards.length); }}
            onNext={() => { setFlipped(false); setCurrentCard((currentCard + 1) % flashcards.length); }}
            onSetCard={(i) => { setCurrentCard(i); setFlipped(false); }}
            onSetAddCount={setAddCount} onAddMore={addMore} onAnalizar={analizar}
            onEstudio={() => setShowEstudio(true)} onQuiz={() => setShowQuiz(true)}
            onEditor={() => setShowEditor(true)} onGuardar={() => { setShowGuardarDeck(true); setDeckGuardado(false); }}
          />
        )}
      </div>
    </div>
  );
    </>
  );
}