'use client';

import { useState } from 'react';
import { Documento, Materia, Tema } from '../../lib/storage';
import ChatDocumento from '../flashcards/ChatDocumento';
import EstudioModal from '../flashcards/EstudioModal';
import FlashcardEditor from '../flashcards/FlashcardEditor';
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
import TabQuiz from './TabQuiz';

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
  const [tab, setTab] = useState<'leer' | 'analisis' | 'flashcards' | 'quiz'>('leer');
  const [addCount, setAddCount] = useState(10);
  const [addingMore, setAddingMore] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showEstudio, setShowEstudio] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
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
          esImagen,
        }),
      });
      const d2 = await r2.json();
      setPasoActual(3);

      const recommended = d2.recommendedCount || 10;
      if (d2.recommendedCount) {
        setRecommendedCount(d2.recommendedCount);
        setRecommendedReason(d2.reason || '');
      }

      const r3 = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: documento.contenido,
          count: recommended,
          idioma: idiomaActual,
          imageBase64: esImagen ? docBase64 : undefined,
          imageMime: esImagen ? docMime : undefined,
          esImagen,
        }),
      });
      const d3 = await r3.json();

      const docActualizado = {
        ...documento,
        analisis: d1.success ? d1.analysis : documento.analisis,
        flashcards: d3.success ? d3.flashcards : documento.flashcards,
      };
      onActualizar(docActualizado);
      if (d3.success) setFlashcards(d3.flashcards);

      setTab('analisis');
    } catch (e: any) {
      if (e?.message === 'AI_EXHAUSTED' || e?.message?.includes('All providers')) setAiExhausted(true);
      console.error(e);
    } finally {
      setAnalizando(false);
      setPasoActual(0);
    }
  };

  const addMore = async () => {
    if (addingMore) return;
    setAddingMore(true);
    try {
      const res = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: documento.contenido,
          count: addCount,
          idioma: getIdioma(),
          existingQuestions: flashcards.map((f: any) => f.question),
        }),
      });
      const data = await res.json();
      if (data.success) {
        const nuevas = [...flashcards, ...data.flashcards];
        setFlashcards(nuevas);
        onActualizar({ ...documento, flashcards: nuevas });
      }
    } catch (e) { console.error(e); }
    finally { setAddingMore(false); }
  };

  const handleGuardarDeck = async () => {
    if (!nombreDeck.trim()) return;
    guardarDeck({ nombre: nombreDeck, flashcards, materiaNombre: materia.nombre, materiaColor: materia.color, temaColor: tema.color });
    setDeckGuardado(true);
  };

  return (
    <div>
      {aiExhausted && <AIExhausted onClose={() => setAiExhausted(false)} />}

      {showEstudio && flashcards.length > 0 && (
        <EstudioModal flashcards={flashcards} temaColor={tema.color} materiaId={materia.id} materiaNombre={materia.nombre} materiaColor={materia.color} onClose={() => setShowEstudio(false)} onModoExamen={() => { setShowEstudio(false); setShowModoExamen(true); }} />
      )}
      {showEditor && (
        <FlashcardEditor flashcards={flashcards} temaColor={tema.color}
          onSave={(cards: any) => { setFlashcards(cards); onActualizar({ ...documento, flashcards: cards }); setShowEditor(false); }}
          onClose={() => setShowEditor(false)} />
      )}
      {showModoExamen && (
        <ModoExamen flashcards={flashcards} contenido={documento.contenido} nombreDoc={documento.nombre} temaColor={documento.nombre} onClose={() => setShowModoExamen(false)} />
      )}

      {/* Modal guardar deck */}
      {showGuardarDeck && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', maxWidth: '420px', width: '100%', border: `2px solid ${tema.color}44` }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>💾 {trAny('guardarDeck')}</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 20px' }}>{flashcards.length} {trAny('tarjetas')} · &quot;{documento.nombre}&quot;</p>
            {deckGuardado ? (
              <div style={{ padding: '14px', background: '#4ade8015', borderRadius: '12px', border: '1px solid #4ade8044', textAlign: 'center' }}>
                <p style={{ color: '#4ade80', fontWeight: 700, margin: 0 }}>✅ {idioma === 'en' ? 'Deck saved!' : '¡Deck guardado!'}</p>
              </div>
            ) : (
              <>
                <input autoFocus value={nombreDeck} onChange={e => setNombreDeck(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGuardarDeck()}
                  placeholder={idioma === 'en' ? 'Deck name...' : 'Nombre del deck...'}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', border: `2px solid ${tema.color}`, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '15px', outline: 'none', boxSizing: 'border-box', marginBottom: '16px' }} />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={handleGuardarDeck} disabled={!nombreDeck.trim()}
                    style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: nombreDeck.trim() ? tema.color : '#333', color: nombreDeck.trim() ? '#000' : '#666', fontWeight: 800, fontSize: '14px', cursor: nombreDeck.trim() ? 'pointer' : 'not-allowed' }}>
                    💾 {trAny('guardar')}
                  </button>
                  <button onClick={() => setShowGuardarDeck(false)}
                    style={{ padding: '12px 20px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>
                    {trAny('cancelar')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Chat flotante */}
      {showChat && (
        <ChatDocumento contenido={documento.contenido} temaColor={tema.color} nombreDoc={documento.nombre} onClose={() => setShowChat(false)} />
      )}

      <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '4px', background: `linear-gradient(90deg, ${tema.color}, ${materia.color})` }} />

        {/* Header documento */}
        <div style={{ padding: isMobile ? '16px' : '24px 28px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '20px' }}>
                  {documento.tipo === 'youtube' ? '🎬' : documento.tipo === 'imagen' ? '🖼️' : documento.tipo === 'pdf' ? '📄' : documento.tipo === 'audio' ? '🎵' : '📝'}
                </span>
                <h2 style={{ fontSize: isMobile ? '16px' : '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile ? '200px' : '400px' }}>
                  {documento.nombre}
                </h2>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{documento.fechaSubida}</span>
                {flashcards.length > 0 && <span style={{ fontSize: '12px', color: tema.color, fontWeight: 600 }}>🎴 {flashcards.length} {trAny('tarjetas')}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
              <button onClick={() => setShowChat(true)}
                style={{ padding: '8px 14px', borderRadius: '8px', border: `2px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                💬 Chat
              </button>
              <button onClick={analizar} disabled={analizando}
                style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', background: analizando ? 'var(--bg-card2)' : 'var(--gold)', color: analizando ? 'var(--text-faint)' : '#000', fontSize: '12px', fontWeight: 800, cursor: analizando ? 'not-allowed' : 'pointer', minWidth: '130px' }}>
                {analizando ? '⏳ ...' : analisisLocal ? '🔄 ' + trAny('reAnalizar') : esImagen ? '🔍 ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + trAny('analizar')}
              </button>
            </div>
          </div>
        </div>

        {/* Banner cargando */}
        {analizando && <BannerCargando pasoActual={pasoActual} temaColor={tema.color} esImagen={esImagen} idioma={idioma} />}

        {/* ── TABS ── */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '24px', overflowX: 'auto' }}>
          {[
            {
              id: 'leer',
              label: esImagen
                ? `🖼️ ${idioma === 'en' ? 'Image' : 'Imagen'}`
                : `📖 ${documento.archivoUrl || docBase64 ? trAny('verDocumento') : trAny('leerTexto')}`,
            },
            { id: 'analisis',   label: `🔍 ${trAny('analisisAI')}${analisisLocal ? ' ✓' : ''}` },
            { id: 'flashcards', label: `🎴 ${trAny('flashcards')}${flashcards.length > 0 ? ` (${flashcards.length})` : ''}` },
            { id: 'quiz',       label: `🤓 Quiz` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              style={{
                padding: '12px 20px',
                border: 'none',
                background: 'transparent',
                borderBottom: tab === t.id ? `3px solid ${t.id === 'quiz' ? '#a78bfa' : tema.color}` : '3px solid transparent',
                color: tab === t.id ? (t.id === 'quiz' ? '#a78bfa' : tema.color) : 'var(--text-muted)',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                marginBottom: '-2px',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
              }}>
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
                  youtubeId={documento.youtubeId}
                  youtubeChannel={documento.youtubeChannel}
                  youtubeWordCount={documento.youtubeWordCount}
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
            onEstudio={() => setShowEstudio(true)} onQuiz={() => setTab('quiz')}
            onEditor={() => setShowEditor(true)} onGuardar={() => { setShowGuardarDeck(true); setDeckGuardado(false); }}
          />
        )}

        {/* TAB QUIZ */}
        {tab === 'quiz' && (
          <TabQuiz
            contenido={documento.contenido}
            temaColor={tema.color}
            materiaNombre={materia.nombre}
            materiaColor={materia.color}
            idioma={idioma}
            esImagen={esImagen}
          />
        )}

      </div>
    </div>
  );
}
