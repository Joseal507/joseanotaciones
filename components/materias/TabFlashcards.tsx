'use client';
import { useState } from 'react';
import MathText from '../MathText';
import PublicarModal from '../comunidad/PublicarModal';

interface Props {
  flashcards: any[];
  currentCard: number;
  flipped: boolean;
  addCount: number;
  addingMore: boolean;
  recommendedCount: number | null;
  recommendedReason: string;
  tema: any;
  materia: any;
  documento: any;
  isMobile: boolean;
  idioma: string;
  esImagen: boolean;
  analizando: boolean;
  tr: (key: string) => string;
  onFlip: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSetCard: (i: number) => void;
  onSetAddCount: (n: number) => void;
  onAddMore: () => void;
  onAnalizar: () => void;
  onEstudio: () => void;
  onQuiz: () => void;
  onEditor: () => void;
  onGuardar: () => void;
}

export default function TabFlashcards({ flashcards, currentCard, flipped, addCount, addingMore, recommendedCount, recommendedReason, tema, materia, documento, isMobile, idioma, esImagen, analizando, tr, onFlip, onPrev, onNext, onSetCard, onSetAddCount, onAddMore, onAnalizar, onEstudio, onQuiz, onEditor, onGuardar }: Props) {
  const [showPublicar, setShowPublicar] = useState(false);

  const Indicadores = () => {
    if (flashcards.length <= 15) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', flexWrap: 'wrap', maxWidth: '400px', margin: '0 auto 16px' }}>
          {flashcards.map((_: any, i: number) => (
            <div key={i} onClick={() => onSetCard(i)} style={{ width: i === currentCard ? '24px' : '8px', height: '8px', borderRadius: '4px', background: i === currentCard ? tema.color : 'var(--border-color2)', cursor: 'pointer', transition: 'all 0.3s', flexShrink: 0 }} />
          ))}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', flexWrap: 'wrap', maxWidth: '600px', margin: '0 auto 16px' }}>
        {flashcards.map((_: any, i: number) => (
          <button key={i} onClick={() => onSetCard(i)} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: i === currentCard ? tema.color : 'var(--bg-secondary)', color: i === currentCard ? '#000' : 'var(--text-faint)', fontSize: '11px', fontWeight: i === currentCard ? 800 : 400, cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0 }}>
            {i + 1}
          </button>
        ))}
      </div>
    );
  };

  if (flashcards.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div style={{ fontSize: '60px', marginBottom: '16px' }}>🎴</div>
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>{tr('noHayFlashcards')}</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '8px', fontSize: '14px' }}>
          {esImagen ? (idioma === 'en' ? 'Analyze the image first.' : 'Primero analiza la imagen.') : (idioma === 'en' ? 'Analyze the document first.' : 'Primero analiza el documento.')}
        </p>
        <button onClick={onAnalizar} disabled={analizando} style={{ padding: '14px 32px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer', marginTop: '8px' }}>
          {analizando ? tr('analizando') : esImagen ? '🖼️ ' + (idioma === 'en' ? 'Analyze Image' : 'Analizar Imagen') : '🔍 ' + (idioma === 'en' ? 'Analyze & Generate' : 'Analizar y Generar')}
        </button>
      </div>
    );
  }

  return (
    <div>
      {showPublicar && (
        <PublicarModal
          onClose={() => setShowPublicar(false)}
          onPublicado={() => setShowPublicar(false)}
          tipoInicial="flashcard"
          directPost={{
            tipo: 'flashcard',
            titulo: documento?.nombre || 'Flashcards',
            materia: materia?.nombre || 'General',
            color: materia?.color || tema?.color || '#f5c842',
            emoji: materia?.emoji || '🎴',
            contenido: {
              tipo: 'flashcard',
              nombre: documento?.nombre || 'Flashcards',
              flashcards,
              total: flashcards.length,
              materiaNombre: materia?.nombre,
              materiaColor: materia?.color,
              materiaEmoji: materia?.emoji,
            },
          }}
        />
      )}

      {recommendedCount && (
        <div style={{ background: '#4ade8015', border: '1px solid #4ade8044', borderRadius: '12px', padding: '12px 18px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🤖</span>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#4ade80', margin: 0 }}>
              {idioma === 'en' ? `AI generated ${recommendedCount} flashcards covering 100% of content` : `La AI generó ${recommendedCount} flashcards cubriendo el 100% del contenido`}
            </p>
            {recommendedReason && <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '2px 0 0' }}>{recommendedReason}</p>}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={onEstudio} style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>{tr('modoEstudio')}</button>
          {!esImagen && <button onClick={onQuiz} style={{ padding: '10px 14px', borderRadius: '10px', border: '2px solid #a78bfa', background: 'transparent', color: '#a78bfa', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{tr('quiz')}</button>}
          <button onClick={onEditor} style={{ padding: '10px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>✏️ {tr('editar')}</button>
          <button onClick={onGuardar} style={{ padding: '10px 14px', borderRadius: '10px', border: '2px solid #4ade80', background: 'transparent', color: '#4ade80', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>💾 {tr('guardarDeck')}</button>
          <button onClick={() => setShowPublicar(true)} style={{ padding: '10px 14px', borderRadius: '10px', border: 'none', background: '#f5c842', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>🚀 Comunidad</button>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{flashcards.length} {tr('tarjetas')}</span>
      </div>

      <Indicadores />

      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <span style={{ background: tema.color, color: '#000', padding: '5px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 800 }}>
          {currentCard + 1} / {flashcards.length}
        </span>
      </div>

      <div onClick={onFlip} className={`flip-card ${flipped ? 'flipped' : ''}`} style={{ height: '300px', cursor: 'pointer', maxWidth: '640px', margin: '0 auto' }}>
        <div className="flip-card-inner" style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div className="flip-card-front" style={{ position: 'absolute', width: '100%', height: '100%' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '36px 44px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--gold)' }} />
              <div style={{ position: 'absolute', top: '16px', left: '16px', background: 'var(--gold)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>{tr('pregunta')}</div>
              <div style={{ fontSize: '18px', fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.6, margin: '16px 0 0' }}><MathText text={flashcards[currentCard]?.question || ""} /></div>
              <p style={{ color: 'var(--text-faint)', fontSize: '11px', margin: '12px 0 0' }}>{isMobile ? tr('tocaVerRespuesta') : (idioma === 'en' ? '← → keys · Space to flip' : '← → flechas · Espacio voltear')}</p>
            </div>
          </div>
          <div className="flip-card-back" style={{ position: 'absolute', width: '100%', height: '100%' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '36px 44px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: 'var(--red)' }} />
              <div style={{ position: 'absolute', top: '16px', left: '16px', background: 'var(--red)', color: '#000', padding: '3px 10px', borderRadius: '5px', fontSize: '10px', fontWeight: 800 }}>{tr('respuesta')}</div>
              <div style={{ fontSize: '16px', textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.7, margin: '16px 0 0' }}><MathText text={flashcards[currentCard]?.answer || ""} /></div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '20px' }}>
        <button onClick={onPrev} style={{ padding: '10px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>⬅️ {tr('anterior')}</button>
        <button onClick={onNext} style={{ padding: '10px 28px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>{tr('siguiente')} ➡️</button>
      </div>

      {!isMobile && <p style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-faint)', marginTop: '8px' }}>{idioma === 'en' ? '⌨️ ← → arrow keys · Space to flip' : '⌨️ Flechas ← → para navegar · Espacio para voltear'}</p>}

      <div style={{ marginTop: '28px', background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden', maxWidth: '640px', margin: '28px auto 0' }}>
        <div style={{ height: '3px', background: 'var(--blue)' }} />
        <div style={{ padding: '18px' }}>
          <p style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>➕ {tr('anadirMas')}</p>
          <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '0 0 10px' }}>{idioma === 'en' ? '🔄 New ones will never repeat existing questions' : '🔄 Las nuevas nunca repetirán las preguntas existentes'}</p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            {[5, 10, 20, 50].map(n => (
              <button key={n} onClick={() => onSetAddCount(n)} style={{ padding: '7px 13px', borderRadius: '7px', border: `2px solid ${addCount === n ? 'var(--blue)' : 'var(--border-color)'}`, cursor: 'pointer', fontSize: '13px', fontWeight: 700, background: addCount === n ? 'var(--blue)' : 'transparent', color: addCount === n ? '#000' : 'var(--text-muted)' }}>+{n}</button>
            ))}
            <input type="number" min={1} max={500} value={addCount} onChange={e => onSetAddCount(Math.max(1, parseInt(e.target.value) || 1))} style={{ width: '60px', padding: '7px 10px', borderRadius: '7px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', textAlign: 'center' }} />
            <button onClick={onAddMore} disabled={addingMore} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', cursor: addingMore ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 800, color: addingMore ? 'var(--text-faint)' : '#000', background: addingMore ? 'var(--bg-card2)' : 'var(--blue)' }}>
              {addingMore ? '⏳...' : `➕ ${addCount}`}
            </button>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '8px 0 0' }}>{tr('total')}: {flashcards.length} {tr('tarjetas')}</p>
        </div>
      </div>
    </div>
  );
}
