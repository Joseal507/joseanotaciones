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
  const [cards, setCards] = useState<Flashcard[]>((flashcards || []).map(f => ({ ...f })));
  const [editando, setEditando] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');

  const abrirEditar = (idx: number) => {
    setEditando(idx);
    setEditQuestion(cards[idx].question);
    setEditAnswer(cards[idx].answer);
  };

  const guardarEdicion = (idx: number) => {
    setCards(prev => prev.map((c, i) =>
      i === idx ? { question: editQuestion, answer: editAnswer } : c
    ));
    setEditando(null);
  };

  const cancelarEdicion = () => {
    setEditando(null);
    setEditQuestion('');
    setEditAnswer('');
  };

  const eliminar = (idx: number) => {
    if (!confirm('¿Eliminar esta flashcard?')) return;
    setCards(prev => prev.filter((_, i) => i !== idx));
    if (editando === idx) setEditando(null);
  };

  const agregar = () => {
    const newIdx = cards.length;
    setCards(prev => [...prev, { question: '', answer: '' }]);
    setTimeout(() => {
      setEditando(newIdx);
      setEditQuestion('');
      setEditAnswer('');
    }, 50);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.95)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 2000,
      fontFamily: '-apple-system, sans-serif',
      overflow: 'hidden',
    }}>

      {/* Header fijo */}
      <div style={{
        padding: '16px 24px',
        background: '#1a1a2e',
        borderBottom: `3px solid ${temaColor}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#ffffff', margin: 0 }}>
            ✏️ Editar Flashcards
          </h2>
          <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
            {cards.length} tarjetas · Toca ✏️ Editar en cada una
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={agregar}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: temaColor, color: '#000', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            + Nueva
          </button>
          <button onClick={() => onSave(cards.filter(c => c.question.trim() && c.answer.trim()))}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#4ade80', color: '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
            💾 Guardar todo
          </button>
          <button onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #444', background: 'transparent', color: '#aaa', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Área scrolleable */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '20px',
      }}>
        <div style={{
          maxWidth: '720px',
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          paddingBottom: '20px',
        }}>

          {cards.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎴</div>
              <p style={{ fontSize: '16px', color: '#555' }}>No hay flashcards.</p>
              <button onClick={agregar}
                style={{ marginTop: '12px', padding: '10px 24px', borderRadius: '10px', border: 'none', background: temaColor, color: '#000', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                + Crear primera
              </button>
            </div>
          )}

          {cards.map((card, i) => (
            <div
              key={i}
              style={{
                background: '#0d0d1a',
                borderRadius: '14px',
                border: `2px solid ${editando === i ? temaColor : '#1e1e35'}`,
                boxShadow: editando === i ? `0 0 0 3px ${temaColor}30` : 'none',
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box',
                flexShrink: 0,
                minHeight: editando === i ? 'auto' : '110px',
                transition: 'border 0.2s, box-shadow 0.2s',
              }}
            >
              {/* Barra top */}
              <div style={{ height: '3px', background: editando === i ? temaColor : '#1e1e35', flexShrink: 0 }} />

              {/* MODO VISTA */}
              {editando !== i && (
                <div style={{
                  padding: '14px 16px',
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                  width: '100%',
                  boxSizing: 'border-box',
                  height: '107px',
                  overflow: 'hidden',
                }}>

                  {/* Número */}
                  <div style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '7px',
                    background: temaColor + '20',
                    border: `1px solid ${temaColor}44`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 900,
                    color: temaColor,
                    flexShrink: 0,
                    marginTop: '2px',
                  }}>
                    {i + 1}
                  </div>

                  {/* Pregunta y Respuesta */}
                  <div style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    overflow: 'hidden',
                  }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <p style={{ fontSize: '9px', fontWeight: 700, color: '#f5c842', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 2px' }}>
                        Pregunta
                      </p>
                      <p style={{ fontSize: '13px', color: '#ddd', margin: 0, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                        {card.question || <span style={{ color: '#444', fontStyle: 'italic' }}>Sin pregunta</span>}
                      </p>
                    </div>

                    <div style={{ height: '1px', background: '#1e1e35', flexShrink: 0 }} />

                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <p style={{ fontSize: '9px', fontWeight: 700, color: '#ff4d6d', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 2px' }}>
                        Respuesta
                      </p>
                      <p style={{ fontSize: '13px', color: '#bbb', margin: 0, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                        {card.answer || <span style={{ color: '#444', fontStyle: 'italic' }}>Sin respuesta</span>}
                      </p>
                    </div>
                  </div>

                  {/* Botones */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flexShrink: 0 }}>
                    <button
                      onClick={() => abrirEditar(i)}
                      style={{ padding: '6px 12px', borderRadius: '7px', border: `1px solid ${temaColor}44`, background: temaColor + '15', color: temaColor, fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}
                      onMouseEnter={(e: any) => { e.currentTarget.style.background = temaColor; e.currentTarget.style.color = '#000'; }}
                      onMouseLeave={(e: any) => { e.currentTarget.style.background = temaColor + '15'; e.currentTarget.style.color = temaColor; }}>
                      ✏️ Editar
                    </button>
                    <button
                      onClick={() => eliminar(i)}
                      style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid #ff4d6d44', background: 'rgba(255,77,109,0.1)', color: '#ff4d6d', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}
                      onMouseEnter={(e: any) => { e.currentTarget.style.background = '#ff4d6d'; e.currentTarget.style.color = '#000'; }}
                      onMouseLeave={(e: any) => { e.currentTarget.style.background = 'rgba(255,77,109,0.1)'; e.currentTarget.style.color = '#ff4d6d'; }}>
                      🗑️ Borrar
                    </button>
                  </div>
                </div>
              )}

              {/* MODO EDITAR */}
              {editando === i && (
                <div style={{ padding: '20px', width: '100%', boxSizing: 'border-box' }}>

                  {/* Pregunta */}
                  <div style={{ marginBottom: '14px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: '#f5c842', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      📌 Pregunta
                    </label>
                    <textarea
                      value={editQuestion}
                      onChange={e => setEditQuestion(e.target.value)}
                      placeholder="Escribe la pregunta..."
                      autoFocus
                      rows={3}
                      style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '2px solid #f5c84244', background: '#111122', color: '#ffffff', fontSize: '15px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.6, transition: 'border 0.2s' }}
                      onFocus={e => e.currentTarget.style.borderColor = '#f5c842'}
                      onBlur={e => e.currentTarget.style.borderColor = '#f5c84244'}
                    />
                  </div>

                  {/* Respuesta */}
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: '#ff4d6d', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      ✅ Respuesta
                    </label>
                    <textarea
                      value={editAnswer}
                      onChange={e => setEditAnswer(e.target.value)}
                      placeholder="Escribe la respuesta..."
                      rows={3}
                      style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '2px solid #ff4d6d44', background: '#111122', color: '#ffffff', fontSize: '15px', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.6, transition: 'border 0.2s' }}
                      onFocus={e => e.currentTarget.style.borderColor = '#ff4d6d'}
                      onBlur={e => e.currentTarget.style.borderColor = '#ff4d6d44'}
                    />
                  </div>

                  {/* Botones */}
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button onClick={cancelarEdicion}
                      style={{ padding: '9px 18px', borderRadius: '8px', border: '2px solid #333', background: 'transparent', color: '#888', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      Cancelar
                    </button>
                    <button
                      onClick={() => guardarEdicion(i)}
                      disabled={!editQuestion.trim() || !editAnswer.trim()}
                      style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: editQuestion.trim() && editAnswer.trim() ? temaColor : '#333', color: editQuestion.trim() && editAnswer.trim() ? '#000' : '#555', fontSize: '13px', fontWeight: 800, cursor: editQuestion.trim() && editAnswer.trim() ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}>
                      ✅ Guardar tarjeta
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Botón agregar */}
          {cards.length > 0 && (
            <button
              onClick={agregar}
              style={{ padding: '16px', borderRadius: '14px', border: `2px dashed ${temaColor}44`, background: 'transparent', color: temaColor, fontSize: '14px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s', width: '100%', flexShrink: 0 }}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = temaColor + '10'; e.currentTarget.style.borderColor = temaColor; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = temaColor + '44'; }}>
              ➕ Agregar nueva flashcard
            </button>
          )}
        </div>
      </div>

      {/* Footer fijo */}
      <div style={{
        padding: '12px 24px',
        background: '#111118',
        borderTop: '1px solid #222',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '12px', color: '#555' }}>
          {cards.filter(c => c.question.trim() && c.answer.trim()).length} válidas de {cards.length}
        </span>
        <button
          onClick={() => onSave(cards.filter(c => c.question.trim() && c.answer.trim()))}
          style={{ padding: '10px 24px', borderRadius: '10px', border: 'none', background: '#4ade80', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
          💾 Guardar y cerrar
        </button>
      </div>
    </div>
  );
}