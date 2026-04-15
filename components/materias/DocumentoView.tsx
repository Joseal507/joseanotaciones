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
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  const esImagen = documento.tipo === 'imagen';
  const docBase64 = (documento as any).archivoBase64;
  const docMime = (documento as any).archivoMime;

  // Navegación con teclado
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
    const idiomaActual = getIdioma();
    try {
      // Paso 1: Análisis completo (con imagen si aplica)
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

      // Paso 2: Recomendación de flashcards
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
      const reason = d2.success ? d2.reason : '';
      setRecommendedCount(recommended);
      setRecommendedReason(reason);

      // Paso 3: Generar flashcards
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

      const docActualizado = {
        ...documento,
        analisis: d1.success ? d1.analysis : documento.analisis,
        flashcards: d3.success ? d3.flashcards : documento.flashcards,
      };
      if (d3.success) setFlashcards(d3.flashcards);
      onActualizar(docActualizado);
      setTab('flashcards');
      setCurrentCard(0);
      setFlipped(false);
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
      {showEstudio && flashcards.length > 0 && (
        <EstudioModal
          flashcards={flashcards}
          temaColor={tema.color}
          onClose={() => setShowEstudio(false)}
          onModoExamen={() => { setShowEstudio(false); setShowModoExamen(true); }}
        />
      )}
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
      {showModoExamen && (
        <ModoExamen
          flashcards={flashcards}
          contenido={documento.contenido}
          nombreDoc={documento.nombre}
          temaColor={tema.color}
          onClose={() => setShowModoExamen(false)}
        />
      )}

      {/* Modal guardar deck */}
      {showGuardarDeck && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '420px', border: '1px solid var(--border-color)' }}>
            <div style={{ height: '4px', background: tema.color, borderRadius: '2px', marginBottom: '24px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>💾 {tr('guardarDeck')}</h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
              {flashcards.length} {tr('tarjetas')} · &quot;{documento.nombre}&quot;
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
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            {esImagen ? '🖼️' : '📄'} {documento.nombre}
          </span>
        </div>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '4px', height: '32px', background: tema.color, borderRadius: '2px' }} />
            <div>
              <h1 style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>{documento.nombre}</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
                {tr('subido')}: {documento.fechaSubida}
                {' '}·{' '}
                <span style={{ background: esImagen ? 'var(--pink-dim)' : 'var(--blue-dim)', color: esImagen ? 'var(--pink)' : 'var(--blue)', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                  {documento.tipo.toUpperCase()}
                </span>
                {documento.analisis && <span style={{ color: '#4ade80', marginLeft: '8px', fontWeight: 700 }}>✓ {tr('analizado')}</span>}
                {recommendedCount && <span style={{ color: tema.color, marginLeft: '8px', fontWeight: 700 }}>· {recommendedCount} {idioma === 'en' ? 'recommended' : 'recomendadas'}</span>}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setShowChat(true)}
              style={{ padding: '9px 14px', borderRadius: '10px', border: `2px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              {tr('chat')}
            </button>
            {!esImagen && (
              <button onClick={() => setShowQuiz(true)}
                style={{ padding: '9px 14px', borderRadius: '10px', border: '2px solid #a78bfa', background: 'transparent', color: '#a78bfa', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                {tr('quiz')}
              </button>
            )}
            <button onClick={analizar} disabled={analizando}
              style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', background: analizando ? 'var(--bg-card2)' : 'var(--gold)', color: analizando ? 'var(--text-faint)' : '#000', fontSize: '12px', fontWeight: 800, cursor: analizando ? 'not-allowed' : 'pointer', minWidth: '130px' }}>
              {analizando ? '⏳ ...' : documento.analisis ? '🔄 ' + tr('reAnalizar') : esImagen ? '🔍 ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + tr('analizar')}
            </button>
          </div>
        </div>

        {/* Banner cargando */}
        {analizando && (
          <div style={{ background: 'var(--bg-card)', borderRadius: '14px', border: `2px solid ${tema.color}44`, padding: '20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                esImagen
                  ? (idioma === 'en' ? '🖼️ Extracting text and visual elements from image...' : '🖼️ Extrayendo texto y elementos visuales de la imagen...')
                  : (idioma === 'en' ? '🔍 Analyzing document with deep AI...' : '🔍 Analizando documento con AI profunda...'),
                idioma === 'en' ? '🤖 AI calculating optimal flashcard count...' : '🤖 AI calculando el número óptimo de flashcards...',
                idioma === 'en' ? '🎴 Generating unique flashcards...' : '🎴 Generando flashcards únicas...',
              ].map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: tema.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, color: '#000', flexShrink: 0 }}>{i + 1}</div>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{label}</p>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '14px', background: 'var(--bg-secondary)', borderRadius: '8px', height: '6px', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: tema.color, borderRadius: '8px', width: '100%', animation: 'pulse 1.5s ease-in-out infinite' }} />
            </div>
            <style>{`@keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }`}</style>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '24px', overflowX: 'auto' }}>
          {[
            { id: 'leer', label: esImagen ? `🖼️ ${idioma === 'en' ? 'Image' : 'Imagen'}` : `📖 ${documento.archivoUrl || docBase64 ? tr('verDocumento') : tr('leerTexto')}` },
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

            {/* ✅ Si es imagen mostrarla directamente */}
            {esImagen && docBase64 ? (
              <div style={{ padding: '20px', textAlign: 'center' }}>
                <img
                  src={`data:${docMime};base64,${docBase64}`}
                  alt={documento.nombre}
                  style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', objectFit: 'contain' }}
                />
                {documento.contenido && (
                  <div style={{ marginTop: '16px', background: 'var(--bg-secondary)', borderRadius: '10px', padding: '14px', textAlign: 'left' }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', margin: '0 0 8px' }}>
                      {idioma === 'en' ? '🤖 Extracted text' : '🤖 Texto extraído'}
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6, maxHeight: '200px', overflowY: 'auto' }}>
                      {documento.contenido}
                    </p>
                  </div>
                )}
                {!documento.analisis && !analizando && (
                  <div style={{ marginTop: '20px' }}>
                    <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                      {idioma === 'en'
                        ? '🤖 Analyze this image — AI will extract text, describe visual elements and generate flashcards'
                        : '🤖 Analiza esta imagen — la AI extraerá texto, describirá elementos visuales y generará flashcards'}
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
                  analisis={documento.analisis}
                  temaColor={tema.color}
                />
                {!documento.analisis && !analizando && (
                  <div style={{ padding: '24px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)', textAlign: 'center' }}>
                    <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '0 0 12px' }}>
                      {idioma === 'en'
                        ? '🤖 Analyze to extract keywords, summary and generate the perfect number of flashcards using deep AI'
                        : '🤖 Analiza para extraer palabras clave, resumen y generar el número exacto de flashcards usando AI profunda'}
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
          <div>
            {!documento.analisis ? (
              <div style={{ textAlign: 'center', padding: '60px 0' }}>
                <div style={{ fontSize: '60px', marginBottom: '16px' }}>{esImagen ? '🖼️' : '🔍'}</div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{tr('sinAnalisis')}</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>
                  {esImagen
                    ? (idioma === 'en' ? 'AI will extract text, describe visual elements and identify key concepts' : 'La AI extraerá texto, describirá elementos visuales e identificará conceptos clave')
                    : tr('tocaAnalizar')}
                </p>
                <p style={{ color: 'var(--text-faint)', fontSize: '13px', marginBottom: '24px' }}>
                  {idioma === 'en'
                    ? '💡 Uses llama-3.3-70b (deep reasoning) + llama-4-scout (vision) for comprehensive analysis'
                    : '💡 Usa llama-3.3-70b (razonamiento profundo) + llama-4-scout (visión) para análisis completo'}
                </p>
                <button onClick={analizar} disabled={analizando}
                  style={{ padding: '14px 28px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
                  {analizando ? tr('analizando') : esImagen ? '🖼️ ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + tr('analizarDocumento')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* Banner recomendación */}
                {recommendedCount && (
                  <div style={{ background: tema.color + '15', border: `2px solid ${tema.color}44`, borderRadius: '16px', padding: '20px', display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                    <div style={{ fontSize: '36px' }}>🤖</div>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontSize: '15px', fontWeight: 800, color: tema.color, margin: '0 0 6px' }}>
                        {idioma === 'en' ? 'AI Recommendation' : 'Recomendación de la AI'}
                      </h3>
                      <p style={{ fontSize: '14px', color: 'var(--text-primary)', margin: '0 0 6px', fontWeight: 700 }}>
                        {idioma === 'en'
                          ? `${recommendedCount} unique flashcards generated to cover 100% of the content`
                          : `${recommendedCount} flashcards únicas generadas para cubrir el 100% del contenido`}
                      </p>
                      {recommendedReason && <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{recommendedReason}</p>}
                      <button onClick={() => setTab('flashcards')}
                        style={{ marginTop: '10px', padding: '7px 18px', borderRadius: '8px', border: 'none', background: tema.color, color: '#000', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
                        🎴 {idioma === 'en' ? 'View Flashcards' : 'Ver Flashcards'} ({flashcards.length})
                      </button>
                    </div>
                  </div>
                )}

                {/* Resumen */}
                <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `2px solid ${tema.color}44`, overflow: 'hidden' }}>
                  <div style={{ height: '4px', background: tema.color }} />
                  <div style={{ padding: '20px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 800, color: tema.color, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 10px' }}>{tr('resumenDocumento')}</h3>
                    <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{documento.analisis.summary}</p>
                  </div>
                </div>

                {/* Keywords y frases */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                  <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: 'var(--blue)' }} />
                    <div style={{ padding: '18px' }}>
                      <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
                        {tr('palabrasClave')} ({documento.analisis.keywords?.length || 0})
                      </h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {documento.analisis.keywords?.map((k: string, i: number) => (
                          <span key={i} style={{ background: 'var(--blue)', color: '#000', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700 }}>{k}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: `2px solid ${tema.color}44`, overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: tema.color }} />
                    <div style={{ padding: '18px' }}>
                      <h3 style={{ fontSize: '13px', fontWeight: 800, color: tema.color, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
                        {tr('frasesImportantes')} ({documento.analisis.important_phrases?.length || 0})
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {documento.analisis.important_phrases?.map((p: string, i: number) => (
                          <div key={i} style={{ background: tema.color, color: '#000', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, lineHeight: 1.4 }}>
                            &quot;{p}&quot;
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Conceptos clave y dificultad */}
                {((documento.analisis as any).key_concepts?.length > 0 || (documento.analisis as any).difficulty_level) && (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                    {(documento.analisis as any).key_concepts?.length > 0 && (
                      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                        <div style={{ height: '4px', background: '#f472b6' }} />
                        <div style={{ padding: '18px' }}>
                          <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#f472b6', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
                            🧠 {idioma === 'en' ? 'Key Concepts' : 'Conceptos Clave'}
                          </h3>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {(documento.analisis as any).key_concepts?.map((c: string, i: number) => (
                              <span key={i} style={{ background: '#f472b620', border: '1px solid #f472b644', color: '#f472b6', padding: '4px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}>{c}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {((documento.analisis as any).difficulty_level || (documento.analisis as any).topics?.length > 0) && (
                      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                        <div style={{ height: '4px', background: '#a78bfa' }} />
                        <div style={{ padding: '18px' }}>
                          <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
                            📊 {idioma === 'en' ? 'Level & Topics' : 'Nivel y Temas'}
                          </h3>
                          {(documento.analisis as any).difficulty_level && (
                            <span style={{ display: 'inline-block', background: '#a78bfa', color: '#000', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
                              {(documento.analisis as any).difficulty_level}
                            </span>
                          )}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {(documento.analisis as any).topics?.map((t: string, i: number) => (
                              <span key={i} style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)', padding: '3px 8px', borderRadius: '6px', fontSize: '11px', border: '1px solid var(--border-color)' }}>{t}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Study tips */}
                {(documento.analisis as any).study_tips?.length > 0 && (
                  <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: '#4ade80' }} />
                    <div style={{ padding: '18px' }}>
                      <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
                        💡 {idioma === 'en' ? 'Study Tips' : 'Consejos de Estudio'}
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {(documento.analisis as any).study_tips?.map((tip: string, i: number) => (
                          <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                            <span style={{ color: '#4ade80', fontWeight: 900, flexShrink: 0 }}>•</span>
                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{tip}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Elementos visuales (solo imágenes) */}
                {(documento.analisis as any).visual_elements?.length > 0 && (
                  <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: 'var(--gold)' }} />
                    <div style={{ padding: '18px' }}>
                      <h3 style={{ fontSize: '13px', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
                        🖼️ {idioma === 'en' ? 'Visual Elements' : 'Elementos Visuales'}
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {(documento.analisis as any).visual_elements?.map((v: string, i: number) => (
                          <div key={i} style={{ background: 'var(--gold-dim)', border: '1px solid var(--gold-border)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '8px', fontSize: '13px' }}>
                            {v}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Conexiones entre conceptos */}
                {(documento.analisis as any).connections?.length > 0 && (
                  <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: '#38bdf8' }} />
                    <div style={{ padding: '18px' }}>
                      <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
                        🔗 {idioma === 'en' ? 'Connections' : 'Conexiones entre conceptos'}
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {(documento.analisis as any).connections?.map((c: string, i: number) => (
                          <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                            <span style={{ color: '#38bdf8', fontWeight: 900, flexShrink: 0 }}>→</span>
                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{c}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ textAlign: 'center' }}>
                  <button onClick={() => setTab('leer')}
                    style={{ padding: '12px 28px', borderRadius: '12px', border: 'none', background: tema.color, color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                    {esImagen ? (idioma === 'en' ? '🖼️ View Image' : '🖼️ Ver Imagen') : tr('leerConHighlights')}
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
                {/* Banner recomendación */}
                {recommendedCount && (
                  <div style={{ background: '#4ade8015', border: '1px solid #4ade8044', borderRadius: '12px', padding: '12px 18px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '18px' }}>🤖</span>
                    <div>
                      <p style={{ fontSize: '13px', fontWeight: 700, color: '#4ade80', margin: 0 }}>
                        {idioma === 'en'
                          ? `AI generated ${recommendedCount} unique flashcards covering 100% of the content`
                          : `La AI generó ${recommendedCount} flashcards únicas cubriendo el 100% del contenido`}
                      </p>
                      {recommendedReason && <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '2px 0 0' }}>{recommendedReason}</p>}
                    </div>
                  </div>
                )}

                {/* Botones acción */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => setShowEstudio(true)}
                      style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                      {tr('modoEstudio')}
                    </button>
                    {!esImagen && (
                      <button onClick={() => setShowQuiz(true)}
                        style={{ padding: '10px 14px', borderRadius: '10px', border: '2px solid #a78bfa', background: 'transparent', color: '#a78bfa', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                        {tr('quiz')}
                      </button>
                    )}
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

                {/* Tarjeta */}
                <div onClick={() => setFlipped(!flipped)}
                  className={`flip-card ${flipped ? 'flipped' : ''}`}
                  style={{ height: '300px', cursor: 'pointer', maxWidth: '640px', margin: '0 auto' }}>
                  <div className="flip-card-inner" style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <div className="flip-card-front" style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '36px 44px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--gold)' }} />
                        <div style={{ position: 'absolute', top: '16px', left: '16px', background: 'var(--gold)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>{tr('pregunta')}</div>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.6, margin: '16px 0 0' }}>{flashcards[currentCard]?.question}</h3>
                        <p style={{ color: 'var(--text-faint)', fontSize: '11px', margin: '12px 0 0' }}>
                          {isMobile ? tr('tocaVerRespuesta') : (idioma === 'en' ? '← → keys · Space to flip' : '← → flechas · Espacio voltear')}
                        </p>
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

                {/* Navegación */}
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

                {!isMobile && (
                  <p style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-faint)', marginTop: '8px' }}>
                    {idioma === 'en' ? '⌨️ ← → arrow keys · Space to flip' : '⌨️ Flechas ← → para navegar · Espacio para voltear'}
                  </p>
                )}

                {/* Añadir más */}
                <div style={{ marginTop: '28px', background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', maxWidth: '640px', margin: '28px auto 0' }}>
                  <div style={{ height: '3px', background: 'var(--blue)' }} />
                  <div style={{ padding: '18px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>➕ {tr('anadirMas')}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '0 0 10px' }}>
                      {idioma === 'en' ? '🔄 New ones will never repeat existing questions' : '🔄 Las nuevas nunca repetirán las preguntas existentes'}
                    </p>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {[5, 10, 20, 50].map(n => (
                        <button key={n} onClick={() => setAddCount(n)}
                          style={{ padding: '7px 13px', borderRadius: '7px', border: `2px solid ${addCount === n ? 'var(--blue)' : 'var(--border-color)'}`, cursor: 'pointer', fontSize: '13px', fontWeight: 700, background: addCount === n ? 'var(--blue)' : 'transparent', color: addCount === n ? '#000' : 'var(--text-muted)' }}>
                          +{n}
                        </button>
                      ))}
                      <input type="number" min={1} max={500} value={addCount}
                        onChange={e => setAddCount(Math.max(1, parseInt(e.target.value) || 1))}
                        style={{ width: '60px', padding: '7px 10px', borderRadius: '7px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', textAlign: 'center' }} />
                      <button onClick={addMore} disabled={addingMore}
                        style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', cursor: addingMore ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 800, color: addingMore ? 'var(--text-faint)' : '#000', background: addingMore ? 'var(--bg-card2)' : 'var(--blue)' }}>
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
                <div style={{ fontSize: '60px', marginBottom: '16px' }}>🎴</div>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{tr('noHayFlashcards')}</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '8px', fontSize: '14px' }}>
                  {esImagen
                    ? (idioma === 'en' ? 'Analyze the image first. AI will extract content and generate flashcards.' : 'Primero analiza la imagen. La AI extraerá el contenido y generará flashcards.')
                    : (idioma === 'en' ? 'Analyze the document first. AI will determine the exact number of flashcards needed.' : 'Primero analiza el documento. La AI determinará el número exacto de flashcards necesarias.')}
                </p>
                <button onClick={analizar} disabled={analizando}
                  style={{ padding: '14px 32px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer', marginTop: '8px' }}>
                  {analizando ? tr('analizando') : esImagen ? '🖼️ ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + (idioma === 'en' ? 'Analyze & Generate' : 'Analizar y Generar')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}