'use client';

import { useState } from 'react';

interface Flashcard {
  question: string;
  answer: string;
}

interface Props {
  flashcards: Flashcard[];
  onSave: (cards: Flashcard[]) => void;
  onClose: () => void;
  temaColor: string;
}

export default function FlashcardEditor({ flashcards, onSave, onClose, temaColor }: Props) {
  const [cards, setCards] = useState<Flashcard[]>(flashcards.map(f => ({ ...f })));

  const update = (idx: number, field: 'question' | 'answer', val: string) => {
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, [field]: val } : c));
  };

  const eliminar = (idx: number) => {
    setCards(prev => prev.filter((_, i) => i !== idx));
  };

  const agregar = () => {
    setCards(prev => [...prev, { question: '', answer: '' }]);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>

      {/* Header */}
      <div style={{ padding: '16px 24px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          ✏️ Editar Flashcards ({cards.length})
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={agregar}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: temaColor, color: '#000', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            + Agregar
          </button>
          <button onClick={() => onSave(cards.filter(c => c.question.trim() && c.answer.trim()))}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#4ade80', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
            💾 Guardar
          </button>
          <button onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
        {cards.map((card, i) => (
          <div key={i} style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ height: '3px', background: temaColor }} />
            <div style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: temaColor, textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Tarjeta {i + 1}
                </span>
                <button onClick={() => eliminar(i)}
                  style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '16px' }}>
                  🗑️
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Pregunta
                  </label>
                  <textarea
                    value={card.question}
                    onChange={e => update(i, 'question', e.target.value)}
                    style={{ width: '100%', minHeight: '80px', padding: '10px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Respuesta
                  </label>
                  <textarea
                    value={card.answer}
                    onChange={e => update(i, 'answer', e.target.value)}
                    style={{ width: '100%', minHeight: '80px', padding: '10px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}

        <button onClick={agregar}
          style={{ padding: '16px', borderRadius: '12px', border: `2px dashed ${temaColor}`, background: 'transparent', color: temaColor, fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
          + Agregar flashcard
        </button>
      </div>
    </div>
  );
}