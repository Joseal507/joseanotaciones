'use client';

interface Props {
  flashcards: { question: string; answer: string }[];
  currentCard: number;
  flipped: boolean;
  addCount: number;
  addingMore: boolean;
  flashcardCount: number;
  documentContent: string;
  onFlip: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSetCard: (i: number) => void;
  onSetAddCount: (n: number) => void;
  onAddMore: () => void;
  onRegenerate: () => void;
  onGoUpload: () => void;
}

export default function FlashcardsScreen({
  flashcards, currentCard, flipped, addCount, addingMore, flashcardCount,
  documentContent, onFlip, onNext, onPrev, onSetCard, onSetAddCount,
  onAddMore, onRegenerate, onGoUpload,
}: Props) {

  if (flashcards.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <div style={{ fontSize: '72px', marginBottom: '16px' }}>🎴</div>
        <p style={{ fontSize: '18px', color: 'var(--text-faint)', fontWeight: 600, marginBottom: '24px' }}>Sube un documento para generar flashcards</p>
        <button onClick={onGoUpload} style={{ padding: '14px 32px', borderRadius: '12px', border: 'none', background: 'var(--pink)', color: '#000', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
          📤 Subir documento
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '6px', height: '40px', background: 'var(--pink)', borderRadius: '3px' }} />
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Flashcards</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>{flashcards.length} tarjetas</p>
          </div>
        </div>
        <button onClick={onRegenerate} disabled={addingMore}
          style={{ padding: '10px 20px', borderRadius: '10px', border: '2px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: '13px', fontWeight: 700, cursor: addingMore ? 'not-allowed' : 'pointer' }}>
          🔄 Regenerar {flashcardCount}
        </button>
      </div>

      {/* Indicadores */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {flashcards.map((_, i) => (
          <div key={i} onClick={() => onSetCard(i)}
            style={{ width: i === currentCard ? '28px' : '8px', height: '8px', borderRadius: '4px', background: i === currentCard ? 'var(--pink)' : 'var(--border-color2)', cursor: 'pointer', transition: 'all 0.3s ease' }} />
        ))}
      </div>

      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <span style={{ background: 'var(--pink)', color: '#000', padding: '6px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 800 }}>
          {currentCard + 1} / {flashcards.length}
        </span>
      </div>

      {/* Tarjeta */}
      <div onClick={onFlip} className={`flip-card ${flipped ? 'flipped' : ''}`}
        style={{ height: '320px', cursor: 'pointer', maxWidth: '680px', margin: '0 auto' }}>
        <div className="flip-card-inner" style={{ position: 'relative', width: '100%', height: '100%' }}>

          {/* Frente */}
          <div className="flip-card-front" style={{ position: 'absolute', width: '100%', height: '100%' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '40px 48px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '5px', background: 'var(--gold)' }} />
              <div style={{ position: 'absolute', top: '20px', left: '20px', background: 'var(--gold)', color: '#000', padding: '4px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 800, letterSpacing: '1px' }}>PREGUNTA</div>
              <h3 style={{ fontSize: '20px', fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.6, margin: '20px 0 0 0' }}>
                {flashcards[currentCard]?.question}
              </h3>
              <p style={{ color: 'var(--text-faint)', fontSize: '12px', margin: '20px 0 0 0', fontWeight: 600 }}>👆 Toca para ver respuesta</p>
            </div>
          </div>

          {/* Reverso */}
          <div className="flip-card-back" style={{ position: 'absolute', width: '100%', height: '100%' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '40px 48px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '5px', background: 'var(--red)' }} />
              <div style={{ position: 'absolute', top: '20px', left: '20px', background: 'var(--red)', color: '#000', padding: '4px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 800, letterSpacing: '1px' }}>RESPUESTA</div>
              <p style={{ fontSize: '18px', textAlign: 'center', color: 'var(--text-primary)', lineHeight: 1.7, margin: '20px 0 0 0' }}>
                {flashcards[currentCard]?.answer}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Navegación */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '28px' }}>
        <button onClick={onPrev}
          style={{ padding: '12px 32px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
          ⬅️ Anterior
        </button>
        <button onClick={onNext}
          style={{ padding: '12px 32px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
          Siguiente ➡️
        </button>
      </div>

      {/* Añadir más */}
      <div style={{ marginTop: '40px', background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', maxWidth: '680px', margin: '40px auto 0' }}>
        <div style={{ height: '4px', background: 'var(--blue)' }} />
        <div style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <div style={{ width: '4px', height: '20px', background: 'var(--blue)', borderRadius: '2px' }} />
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Añadir más flashcards</h3>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {[3, 5, 10, 15, 20].map(num => (
              <button key={num} onClick={() => onSetAddCount(num)}
                style={{ padding: '8px 14px', borderRadius: '8px', border: `2px solid ${addCount === num ? 'var(--blue)' : 'var(--border-color)'}`, cursor: 'pointer', fontSize: '14px', fontWeight: 700, background: addCount === num ? 'var(--blue)' : 'transparent', color: addCount === num ? '#000' : 'var(--text-muted)', transition: 'all 0.15s' }}>
                +{num}
              </button>
            ))}
            <input type="number" min={1} max={30} value={addCount}
              onChange={e => onSetAddCount(Math.min(30, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{ width: '65px', padding: '8px 10px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, textAlign: 'center' }} />
            <button onClick={onAddMore} disabled={addingMore || !documentContent}
              style={{ padding: '10px 22px', borderRadius: '10px', border: 'none', cursor: addingMore || !documentContent ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 800, color: addingMore || !documentContent ? 'var(--text-faint)' : '#000', background: addingMore || !documentContent ? 'var(--bg-card2)' : 'var(--blue)', whiteSpace: 'nowrap' }}>
              {addingMore ? '⏳ Generando...' : `➕ Añadir ${addCount} tarjetas`}
            </button>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: '12px 0 0 0', fontWeight: 600 }}>
            Total actual: {flashcards.length} tarjetas
          </p>
        </div>
      </div>
    </div>
  );
}