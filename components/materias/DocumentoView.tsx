'use client';

import { useState, useEffect } from 'react';
import { Documento, Materia, Tema } from '../../lib/storage';
import ChatDocumento from '../flashcards/ChatDocumento';
import EstudioModal from '../flashcards/EstudioModal';
import FlashcardEditor from '../flashcards/FlashcardEditor';
import ModoExamen from '../flashcards/ModoExamen';
import VisorDocumento from '../VisorDocumento';
import { guardarDeck } from '../../lib/quizStorage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useIdioma } from '../../hooks/useIdioma';
import { detectContentLanguage } from '../../lib/detectLanguage';
import BannerCargando from './BannerCargando';
import AIExhausted from '../AIExhausted';
import TabAnalisis from './TabAnalisis';
import TabFlashcards from './TabFlashcards';
import TabQuiz from './TabQuiz';
import PublicarComunidad from '../PublicarComunidad';

const HAND = "'Caveat',cursive";

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
  const [showPublicarComunidad, setShowPublicarComunidad] = useState(false);
  const [tipoPublicar, setTipoPublicar] = useState<'flashcards' | 'quiz'>('flashcards');
  const [preguntasParaPublicar, setPreguntasParaPublicar] = useState<any[]>([]);
  const [recommendedCount, setRecommendedCount] = useState<number | null>(null);
  const [recommendedReason, setRecommendedReason] = useState('');
  const [flashcardsMessage, setFlashcardsMessage] = useState('');
  const [analisisLocal, setAnalisisLocal] = useState(documento.analisis);
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();

  const trAny = (key: string) => tr(key as any);
  const esImagen = documento.tipo === 'imagen';
  const docBase64 = (documento as any).archivoBase64;
  const docMime = (documento as any).archivoMime;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (tab !== 'flashcards' || flashcards.length === 0) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'ArrowRight') { setFlipped(false); setCurrentCard(prev => (prev + 1) % flashcards.length); }
      if (e.key === 'ArrowLeft') { setFlipped(false); setCurrentCard(prev => (prev - 1 + flashcards.length) % flashcards.length); }
      if (e.key === ' ') { e.preventDefault(); setFlipped(prev => !prev); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tab, flashcards.length]);

  const analizar = async () => {
    setAnalizando(true);
    setPasoActual(1);
    const idiomaActual = detectContentLanguage(documento.contenido || '', idioma === 'en' ? 'en' : 'es');
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

      const recommended = d2.recommended || d2.recommendedCount || 30;
      if (d2.recommended || d2.recommendedCount) {
        setRecommendedCount(d2.recommended || d2.recommendedCount);
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
    setFlashcardsMessage('');

    try {
      const res = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: documento.contenido,
          count: addCount,
          idioma: detectContentLanguage(documento.contenido || '', idioma === 'en' ? 'en' : 'es'),
          existingQuestions: flashcards.map((f: any) => f.question),
        }),
      });

      const data = await res.json();

      if (data.exhausted) {
        setFlashcardsMessage(
          data.message ||
          (idioma === 'en'
            ? 'This document has already been analyzed 100%. No more flashcards can be generated.'
            : 'Este documento ya fue analizado al 100%. No se pueden generar más flashcards.')
        );
        return;
      }

      if (!data.success || !data.flashcards) {
        setFlashcardsMessage(
          idioma === 'en'
            ? 'No more unique flashcards could be generated.'
            : 'No se pudieron generar más flashcards únicas.'
        );
        return;
      }

      // 🛡️ FILTRO DE SEGURIDAD POR PALABRAS CLAVE (60% similarity)
      const getKeywords = (str: string) => {
        return new Set(
          str.toLowerCase()
            .replace(/[¿?¡!.,;]/g, '')
            .split(/\s+/)
            .filter((word: string) => word.length > 3)
        );
      };

      const nuevasUnicas = data.flashcards.filter((nueva: any) => {
        const keysNueva = getKeywords(nueva.question);
        return !flashcards.some((vieja: any) => {
          const keysVieja = getKeywords(vieja.question);
          let coincidencias = 0;
          keysNueva.forEach((word: string) => { if (keysVieja.has(word)) coincidencias++; });
          const ratio = coincidencias / Math.max(keysNueva.size, 1);
          return ratio > 0.6;
        });
      });

      if (nuevasUnicas.length === 0) {
        setFlashcardsMessage(
          idioma === 'en'
            ? 'AI tried to repeat concepts. No duplicates added.'
            : 'La IA intentó repetir conceptos. No se agregaron duplicados.'
        );
      } else {
        const finalDeck = [...flashcards, ...nuevasUnicas];
        setFlashcards(finalDeck);
        onActualizar({ ...documento, flashcards: finalDeck });
        setCurrentCard(flashcards.length);
        setFlipped(false);
        setFlashcardsMessage(
          idioma === 'en'
            ? `✅ ${nuevasUnicas.length} new unique flashcards added.`
            : `✅ Se añadieron ${nuevasUnicas.length} tarjetas nuevas sin repeticiones.`
        );
      }
    } catch (err) {
      console.error(err);
      setFlashcardsMessage(
        idioma === 'en' ? 'Error generating more flashcards.' : 'Error al generar más flashcards.'
      );
    } finally {
      setAddingMore(false);
    }
  };

  const handleGuardarDeck = async () => {
    if (!nombreDeck.trim()) return;
    guardarDeck({ nombre: nombreDeck, flashcards, materiaNombre: materia.nombre, materiaColor: materia.color, temaColor: tema.color });
    setDeckGuardado(true);
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
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

      {showPublicarComunidad && (
        <PublicarComunidad
          tipo={tipoPublicar}
          titulo={documento.nombre}
          contenido={tipoPublicar === 'flashcards' ? { flashcards } : { quiz: preguntasParaPublicar }}
          materiaColor={materia.color}
          materiaEmoji={materia.emoji}
          materiaNombre={materia.nombre}
          onClose={() => setShowPublicarComunidad(false)}
          onPublicado={() => setShowPublicarComunidad(false)}
        />
      )}

      {/* MODAL Guardar deck — vibra cuaderno */}
      {showGuardarDeck && (
        <div onClick={() => setShowGuardarDeck(false)} style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.78)',
          backdropFilter: 'blur(6px)',
          zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
          animation: 'modalFadeDv 0.25s ease',
        }}>
          <div onClick={(e: any) => e.stopPropagation()} style={{
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 16,
            padding: 0,
            width: '100%', maxWidth: 440,
            boxShadow: '6px 7px 0 var(--text-primary), 0 16px 50px rgba(0,0,0,0.45)',
            transform: 'rotate(-0.5deg)',
            position: 'relative',
            overflow: 'hidden',
            animation: 'modalPopDv 0.4s cubic-bezier(.34,1.4,.64,1)',
          }}>
            <div style={{
              position: 'absolute', top: -10, left: '50%',
              transform: 'translateX(-50%) rotate(-4deg)',
              width: 80, height: 18,
              background: `color-mix(in srgb,${tema.color} 55%,transparent)`,
              border: `1px solid color-mix(in srgb,${tema.color} 30%,transparent)`,
              boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
              zIndex: 5,
            }}/>

            <div style={{
              background: tema.color,
              padding: '10px 24px',
              borderBottom: '2px solid var(--text-primary)',
            }}>
              <h3 style={{
                fontFamily: HAND, fontSize: 26, fontWeight: 900,
                color: '#000', margin: 0, lineHeight: 1.1,
                transform: 'rotate(-0.8deg)', display: 'inline-block',
                fontStyle: 'italic',
              }}>
                💾 {trAny('guardarDeck')}
              </h3>
            </div>

            <div style={{ padding: '20px 24px' }}>
              <p style={{
                fontFamily: HAND, fontSize: 17,
                color: 'var(--text-muted)', margin: '0 0 16px',
                fontStyle: 'italic',
              }}>
                ~ {flashcards.length} {trAny('tarjetas')} · "{documento.nombre}" ~
              </p>

              {deckGuardado ? (
                <div style={{
                  padding: 16,
                  background: 'color-mix(in srgb,#4ade80 18%,transparent)',
                  border: '2.5px solid #4ade80',
                  borderRadius: 12,
                  textAlign: 'center',
                  transform: 'rotate(-0.5deg)',
                  boxShadow: '3px 3px 0 #4ade80',
                }}>
                  <p style={{
                    fontFamily: HAND, fontSize: 22, fontWeight: 900,
                    color: '#16a34a', margin: 0,
                  }}>
                    ✅ {idioma === 'en' ? 'Deck saved!' : '¡Deck guardado!'}
                  </p>
                </div>
              ) : (
                <>
                  <input autoFocus value={nombreDeck} onChange={(e: any) => setNombreDeck(e.target.value)}
                    onKeyDown={(e: any) => e.key === 'Enter' && handleGuardarDeck()}
                    placeholder={idioma === 'en' ? 'Deck name...' : 'Nombre del deck...'}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      border: `2.5px solid var(--text-primary)`,
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontFamily: HAND, fontSize: 19, fontWeight: 600,
                      outline: 'none',
                      boxSizing: 'border-box',
                      boxShadow: '3px 3px 0 var(--text-primary)',
                      transform: 'rotate(-0.3deg)',
                      marginBottom: 16,
                    }}/>

                  <div style={{
                    display: 'flex', gap: 10,
                    paddingTop: 14,
                    borderTop: '1.5px dashed var(--border-color)',
                  }}>
                    <button onClick={() => setShowGuardarDeck(false)}
                      style={{
                        flex: 1, padding: 12,
                        borderRadius: 12,
                        border: '2.5px dashed var(--text-faint)',
                        background: 'transparent', color: 'var(--text-muted)',
                        fontFamily: HAND, fontSize: 18, fontWeight: 800,
                        cursor: 'pointer',
                        transform: 'rotate(1deg)',
                      }}>
                      ✕ {trAny('cancelar')}
                    </button>
                    <button onClick={handleGuardarDeck} disabled={!nombreDeck.trim()}
                      style={{
                        flex: 2, padding: 12,
                        borderRadius: 12,
                        border: '2.5px solid var(--text-primary)',
                        background: nombreDeck.trim() ? tema.color : 'var(--bg-card2)',
                        color: nombreDeck.trim() ? '#000' : 'var(--text-faint)',
                        fontFamily: HAND, fontSize: 19, fontWeight: 800,
                        cursor: nombreDeck.trim() ? 'pointer' : 'not-allowed',
                        boxShadow: nombreDeck.trim() ? '3px 4px 0 var(--text-primary)' : 'none',
                        transform: 'rotate(-1deg)',
                      }}>
                      💾 {trAny('guardar')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <style>{`
            @keyframes modalFadeDv { from{opacity:0} to{opacity:1} }
            @keyframes modalPopDv {
              0% { transform: rotate(0deg) scale(0.85); opacity: 0; }
              60% { transform: rotate(-0.5deg) scale(1.02); opacity: 1; }
              100% { transform: rotate(-0.5deg) scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {showChat && (
        <ChatDocumento contexto={documento.contenido} temaColor={tema.color} nombreDoc={documento.nombre} onClose={() => setShowChat(false)} />
      )}

      {/* BREADCRUMB */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 16, fontFamily: HAND,
        flexWrap: 'wrap',
      }}>
        <button onClick={onBack} style={breadBtn}>📚 {trAny('materias')}</button>
        <span style={breadSep}>›</span>
        <button onClick={onBackMateria} style={{ ...breadBtn, color: materia.color }}>{materia.emoji} {materia.nombre}</button>
        <span style={breadSep}>›</span>
        <button onClick={onBackTema} style={{ ...breadBtn, color: tema.color }}>📁 {tema.nombre}</button>
        <span style={breadSep}>›</span>
        <span style={{
          fontSize: 17, fontWeight: 800, color: 'var(--text-primary)',
          fontStyle: 'italic',
        }}>
          {documento.nombre.length > 30 ? documento.nombre.slice(0, 30) + '…' : documento.nombre}
        </span>
      </div>

      {/* CARD PRINCIPAL */}
      <div style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 14,
        boxShadow: `5px 6px 0 ${tema.color}`,
        transform: 'rotate(-0.3deg)',
        overflow: 'hidden',
      }}>
        {/* Banda título */}
        <div style={{
          background: `linear-gradient(90deg, ${tema.color} 0%, ${materia.color} 100%)`,
          padding: '10px 22px',
          borderBottom: '2.5px solid var(--text-primary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 28 }}>
              {documento.tipo === 'youtube' ? '🎬'
                : documento.tipo === 'imagen' ? '🖼️'
                : documento.tipo === 'pdf' ? '📄'
                : documento.tipo === 'audio' ? '🎵'
                : '📝'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{
                fontFamily: HAND, fontSize: isMobile ? 22 : 26, fontWeight: 900,
                color: '#000', margin: 0, lineHeight: 1.05,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textShadow: '0 1px 2px rgba(255,255,255,0.25)',
              }}>
                {documento.nombre}
              </h2>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                <span style={{
                  fontFamily: HAND, fontSize: 14, fontWeight: 700,
                  color: 'rgba(0,0,0,0.7)', fontStyle: 'italic',
                }}>
                  {documento.fechaSubida}
                </span>
                {flashcards.length > 0 && (
                  <span style={{
                    fontFamily: HAND, fontSize: 14, fontWeight: 800,
                    color: '#000',
                    background: 'rgba(0,0,0,0.18)',
                    padding: '0 8px', borderRadius: 6,
                  }}>
                    🎴 {flashcards.length} {trAny('tarjetas')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setShowChat(true)}
              style={{
                padding: '7px 14px',
                borderRadius: 10,
                border: '2.5px solid var(--text-primary)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '2px 3px 0 var(--text-primary)',
                transform: 'rotate(-1.5deg)',
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1.5deg)';}}
            >
              💬 chat
            </button>
            <button onClick={analizar} disabled={analizando}
              style={{
                padding: '7px 16px',
                borderRadius: 10,
                border: '2.5px solid var(--text-primary)',
                background: analizando ? 'var(--bg-card2)' : 'var(--gold)',
                color: analizando ? 'var(--text-faint)' : '#000',
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                cursor: analizando ? 'not-allowed' : 'pointer',
                boxShadow: analizando ? 'none' : '2px 3px 0 var(--text-primary)',
                transform: 'rotate(1.5deg)',
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{
                if (!analizando) e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';
              }}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(1.5deg)';}}
            >
              {analizando
                ? '⏳ ...'
                : analisisLocal
                  ? '🔄 ' + trAny('reAnalizar')
                  : esImagen ? '🔍 ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + trAny('analizar')}
            </button>
          </div>
        </div>

        {analizando && <BannerCargando pasoActual={pasoActual} temaColor={tema.color} esImagen={esImagen} idioma={idioma} />}

        {/* TABS */}
        <div style={{
          display: 'flex', gap: 6,
          padding: '14px 18px 4px',
          borderBottom: '2px dashed var(--border-color)',
          overflowX: 'auto', flexWrap: 'wrap',
          background: 'var(--bg-card)',
        }}>
          {[
            {
              id: 'leer',
              label: esImagen
                ? `🖼️ ${idioma === 'en' ? 'Image' : 'Imagen'}`
                : documento.tipo === 'youtube' ? '▶️ Video' : `📖 ${documento.archivoUrl || docBase64 ? trAny('verDocumento') : trAny('leerTexto')}`,
              color: tema.color,
            },
            { id: 'analisis',   label: `🔍 ${trAny('analisisAI')}${analisisLocal ? ' ✓' : ''}`, color: tema.color },
            { id: 'flashcards', label: `🎴 ${trAny('flashcards')}${flashcards.length > 0 ? ` (${flashcards.length})` : ''}`, color: tema.color },
            { id: 'quiz',       label: `🤓 Quiz`, color: '#a78bfa' },
          ].map((t, i) => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id as any)}
                style={{
                  padding: '8px 16px',
                  background: active ? t.color : 'var(--bg-secondary)',
                  color: active ? '#000' : 'var(--text-muted)',
                  border: `2.5px solid ${active ? t.color : 'var(--border-color)'}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  whiteSpace: 'nowrap',
                  boxShadow: active ? '2px 3px 0 var(--text-primary)' : 'none',
                  transform: active
                    ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                    : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}>
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ padding: 18 }}>
          {/* TAB LEER */}
          {tab === 'leer' && (
            <div style={{
              background: 'var(--bg-secondary)',
              border: '2.5px solid var(--text-primary)',
              borderRadius: 12,
              boxShadow: `3px 4px 0 ${tema.color}`,
              overflow: 'hidden',
            }}>
              {esImagen && docBase64 ? (
                <div style={{ padding: 20, textAlign: 'center' }}>
                  <div style={{
                    display: 'inline-block',
                    padding: 12,
                    background: '#fff',
                    border: '2.5px solid var(--text-primary)',
                    boxShadow: '4px 5px 0 var(--text-primary)',
                    transform: 'rotate(-1.5deg)',
                    marginBottom: 16,
                  }}>
                    <img src={`data:${docMime};base64,${docBase64}`} alt={documento.nombre}
                      style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block', objectFit: 'contain' }} />
                  </div>
                  {documento.contenido && (
                    <div style={{
                      background: 'var(--bg-card)',
                      border: '2px dashed var(--border-color)',
                      borderRadius: 10,
                      padding: 14,
                      textAlign: 'left',
                      marginTop: 8,
                      transform: 'rotate(0.3deg)',
                    }}>
                      <p style={{
                        fontFamily: HAND, fontSize: 14, fontWeight: 800,
                        color: 'var(--text-faint)', fontStyle: 'italic',
                        margin: '0 0 6px',
                      }}>
                        ✏️ {idioma === 'en' ? 'extracted text' : 'texto extraído'}
                      </p>
                      <p style={{
                        fontSize: 14, color: 'var(--text-secondary)',
                        margin: 0, lineHeight: 1.6,
                        maxHeight: 200, overflowY: 'auto',
                      }}>
                        {documento.contenido}
                      </p>
                    </div>
                  )}
                  {!analisisLocal && !analizando && (
                    <AnalyzeCTA tema={tema} onAnalizar={analizar} idioma={idioma} esImagen={esImagen} />
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
                    <div style={{ borderTop: '2px dashed var(--border-color)', padding: 20 }}>
                      <AnalyzeCTA tema={tema} onAnalizar={analizar} idioma={idioma} esImagen={esImagen} />
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
            <div>
              {flashcards.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <button
                    onClick={() => { setTipoPublicar('flashcards'); setShowPublicarComunidad(true); }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 10,
                      border: '2.5px solid #a78bfa',
                      background: 'color-mix(in srgb,#a78bfa 16%,var(--bg-card))',
                      color: '#a78bfa',
                      fontFamily: HAND, fontSize: 16, fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '2px 3px 0 #a78bfa',
                      transform: 'rotate(1.5deg)',
                      transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                    }}
                    onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
                    onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(1.5deg)';}}
                  >
                    🌍 publicar en comunidad
                  </button>
                </div>
              )}
              <TabFlashcards
                flashcards={flashcards} currentCard={currentCard} flipped={flipped}
                addCount={addCount} addingMore={addingMore} flashcardsMessage={flashcardsMessage} recommendedCount={recommendedCount}
                recommendedReason={recommendedReason} tema={tema} isMobile={isMobile}
                idioma={idioma} esImagen={esImagen} analizando={analizando} tr={trAny}
                onFlip={() => setFlipped(!flipped)}
                onPrev={() => { setFlipped(false); setCurrentCard((currentCard - 1 + flashcards.length) % flashcards.length); }}
                onNext={() => { setFlipped(false); setCurrentCard((currentCard + 1) % flashcards.length); }}
                onSetCard={(i: number) => { setCurrentCard(i); setFlipped(false); }}
                onSetAddCount={setAddCount} onAddMore={addMore} onAnalizar={analizar}
                onEstudio={() => setShowEstudio(true)} onQuiz={() => setTab('quiz')}
                onEditor={() => setShowEditor(true)} onGuardar={() => { setShowGuardarDeck(true); setDeckGuardado(false); }}
              />
            </div>
          )}

          {/* TAB QUIZ */}
          {tab === 'quiz' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button
                  onClick={() => { setTipoPublicar('quiz'); setShowPublicarComunidad(true); }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 10,
                    border: '2.5px solid #34d399',
                    background: 'color-mix(in srgb,#34d399 16%,var(--bg-card))',
                    color: '#34d399',
                    fontFamily: HAND, fontSize: 16, fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '2px 3px 0 #34d399',
                    transform: 'rotate(1.5deg)',
                  }}>
                  🌍 publicar en comunidad
                </button>
              </div>
              <TabQuiz
                contenido={documento.contenido}
                temaColor={tema.color}
                materiaNombre={materia.nombre}
                materiaColor={materia.color}
                idioma={idioma}
                esImagen={esImagen}
                onQuizGenerado={setPreguntasParaPublicar}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CTA Analyze ──
function AnalyzeCTA({ tema, onAnalizar, idioma, esImagen }: { tema: any; onAnalizar: () => void; idioma: string; esImagen: boolean }) {
  return (
    <div style={{
      textAlign: 'center', padding: '20px 16px',
      background: `color-mix(in srgb,${tema.color} 10%,transparent)`,
      border: `2.5px dashed ${tema.color}`,
      borderRadius: 12,
      transform: 'rotate(-0.5deg)',
    }}>
      <p style={{
        fontFamily: HAND, fontSize: 19, fontWeight: 700,
        color: 'var(--text-muted)', fontStyle: 'italic',
        margin: '0 0 12px',
      }}>
        🤖 ~ {esImagen
          ? (idioma === 'en' ? 'analyze this image' : 'analiza esta imagen')
          : (idioma === 'en' ? 'analyze to extract keywords & generate flashcards' : 'analiza para extraer palabras clave y generar flashcards')} ~
      </p>
      <button onClick={onAnalizar}
        style={{
          padding: '10px 26px',
          borderRadius: 12,
          border: '2.5px solid var(--text-primary)',
          background: 'var(--gold)', color: '#000',
          fontFamily: HAND, fontSize: 19, fontWeight: 800,
          cursor: 'pointer',
          boxShadow: '3px 4px 0 var(--text-primary)',
          transform: 'rotate(-1.5deg)',
          transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
        }}
        onMouseEnter={(e:any)=>{
          e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
          e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
        }}
        onMouseLeave={(e:any)=>{
          e.currentTarget.style.transform = 'rotate(-1.5deg)';
          e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
        }}
      >
        🔍 {esImagen
          ? (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen')
          : (idioma === 'en' ? 'Analyze & Generate Flashcards' : 'Analizar y Generar Flashcards')}
      </button>
    </div>
  );
}

// ── Helpers ──
const breadBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1.5px dashed var(--border-color)',
  color: 'var(--text-muted)',
  fontFamily: HAND, fontSize: 16, fontWeight: 800,
  cursor: 'pointer',
  padding: '4px 10px', borderRadius: 8,
  fontStyle: 'italic',
  transition: 'all 0.2s',
};

const breadSep: React.CSSProperties = {
  color: 'var(--text-faint)',
  fontSize: 18, fontWeight: 800,
};