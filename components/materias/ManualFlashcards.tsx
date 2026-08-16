"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { SourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection";
import {
  readManualToolState,
  writeManualToolState,
} from "../../lib/manualToolState";

const BODY = "'Plus Jakarta Sans', system-ui, sans-serif";

interface Props {
  materiales: any[];
  seleccion?: any[] | null;
  tema?: any;
  materia?: any;
  sessionId: string | null;
  sourceSelection: SourceSelectionSnapshot;
  onBack: () => void;
  onProgressReport?: (pct: number) => void;
}

interface ManualCard {
  id: string;
  front: string;
  back: string;
  createdAt: number;
}

interface FlashcardsState {
  cards: ManualCard[];
  studyIndex: number;
  studyFlipped: boolean;
  studyRoundsCompleted: number;
}

const initial: FlashcardsState = {
  cards: [],
  studyIndex: 0,
  studyFlipped: false,
  studyRoundsCompleted: 0,
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export default function ManualFlashcards({
  sessionId, sourceSelection, onBack, onProgressReport,
}: Props) {
  const [state, setState] = useState<FlashcardsState>(initial);
  const [mode, setMode] = useState<'list' | 'create' | 'study'>('list');
  const [editingCard, setEditingCard] = useState<ManualCard | null>(null);
  const [draftFront, setDraftFront] = useState('');
  const [draftBack, setDraftBack] = useState('');
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const restored = readManualToolState<FlashcardsState>(sessionId, sourceSelection.fingerprint, 'flashcards');
    if (restored?.state) setState(restored.state);
  }, [sessionId, sourceSelection.fingerprint]);

  const persist = useCallback((next: FlashcardsState) => {
    setState(next);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      if (sessionId) writeManualToolState(sessionId, sourceSelection.fingerprint, 'flashcards', next);
    }, 250);
  }, [sessionId, sourceSelection.fingerprint]);

  // Progreso: 3 al crear la primera, +interacción según cards y rondas
  useEffect(() => {
    if (!onProgressReport) return;
    if (state.cards.length === 0) { onProgressReport(0); return; }
    let pct = 3; // primera card creada
    // +1 por cada card adicional hasta 8 cards
    pct += Math.min(8, state.cards.length - 1) * 1;
    // +hasta 9 puntos por rondas completadas
    pct += Math.min(9, state.studyRoundsCompleted * 3);
    onProgressReport(Math.min(20, pct));
  }, [state.cards.length, state.studyRoundsCompleted, onProgressReport]);

  const saveCard = () => {
    if (!draftFront.trim() || !draftBack.trim()) return;
    if (editingCard) {
      const next: FlashcardsState = {
        ...state,
        cards: state.cards.map(c => c.id === editingCard.id
          ? { ...c, front: draftFront.trim(), back: draftBack.trim() }
          : c),
      };
      persist(next);
    } else {
      const newCard: ManualCard = {
        id: uid(), front: draftFront.trim(), back: draftBack.trim(), createdAt: Date.now(),
      };
      persist({ ...state, cards: [...state.cards, newCard] });
    }
    setDraftFront(''); setDraftBack(''); setEditingCard(null); setMode('list');
  };

  const deleteCard = (id: string) => {
    persist({ ...state, cards: state.cards.filter(c => c.id !== id) });
  };

  const startEdit = (card: ManualCard) => {
    setEditingCard(card); setDraftFront(card.front); setDraftBack(card.back); setMode('create');
  };

  const startStudy = () => {
    if (state.cards.length === 0) return;
    persist({ ...state, studyIndex: 0, studyFlipped: false });
    setMode('study');
  };

  const nextStudy = () => {
    if (state.studyIndex + 1 >= state.cards.length) {
      persist({ ...state, studyIndex: 0, studyFlipped: false, studyRoundsCompleted: state.studyRoundsCompleted + 1 });
      setMode('list');
    } else {
      persist({ ...state, studyIndex: state.studyIndex + 1, studyFlipped: false });
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column', fontFamily: BODY, zIndex: 9999,
      color: 'var(--text-primary)',
    }}>
      <div style={{
        padding: '14px 24px', borderBottom: '1px solid var(--border-color2)',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <button onClick={onBack} style={{
          padding: '8px 14px', borderRadius: 10,
          border: '2px solid #f472b6', background: 'transparent',
          color: '#f472b6', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>← volver al mapa</button>
        <div style={{ fontSize: 18, fontWeight: 800 }}>🩷 Flashcards Manual</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {mode !== 'create' && (
            <button onClick={() => { setEditingCard(null); setDraftFront(''); setDraftBack(''); setMode('create'); }} style={{
              padding: '8px 14px', borderRadius: 10, border: '1.5px solid #f472b6',
              background: 'rgba(244,114,182,0.1)', color: '#f472b6',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>+ Crear tarjeta</button>
          )}
          {state.cards.length > 0 && mode !== 'study' && (
            <button onClick={startStudy} style={{
              padding: '8px 14px', borderRadius: 10, border: '1.5px solid #f472b6',
              background: '#f472b6', color: '#000',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>▶ Estudiar ({state.cards.length})</button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 32 }}>
        {mode === 'list' && (
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {state.cards.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: 60, color: 'var(--text-muted)',
                border: '2px dashed var(--border-color2)', borderRadius: 16,
              }}>
                <div style={{ fontSize: 60, marginBottom: 20 }}>🩷</div>
                <h2 style={{ margin: '0 0 12px', color: 'var(--text-primary)' }}>Aún no tienes tarjetas</h2>
                <p style={{ margin: '0 0 24px', fontSize: 14 }}>
                  Crea tus propias flashcards escribiendo pregunta y respuesta.
                </p>
                <button onClick={() => setMode('create')} style={{
                  padding: '12px 28px', borderRadius: 12,
                  border: 'none', background: '#f472b6', color: '#000',
                  fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}>+ Crear primera tarjeta</button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {state.cards.map((card, i) => (
                  <div key={card.id} style={{
                    background: 'var(--bg-card)', borderRadius: 14,
                    border: '1.5px solid var(--border-color2)', padding: 16,
                    position: 'relative',
                  }}>
                    <div style={{
                      position: 'absolute', top: -8, right: 12,
                      background: '#f472b6', color: '#000',
                      fontSize: 10, fontWeight: 900, padding: '3px 8px',
                      borderRadius: 6,
                    }}>#{i + 1}</div>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, color: '#f472b6', fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>PREGUNTA</div>
                      <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.4 }}>{card.front}</div>
                    </div>
                    <div style={{ padding: 10, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>RESPUESTA</div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{card.back}</div>
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                      <button onClick={() => startEdit(card)} style={{
                        flex: 1, padding: '6px 10px', borderRadius: 8,
                        border: '1px solid var(--border-color2)', background: 'transparent',
                        color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                      }}>Editar</button>
                      <button onClick={() => deleteCard(card.id)} style={{
                        padding: '6px 10px', borderRadius: 8,
                        border: '1px solid rgba(239,68,68,0.3)', background: 'transparent',
                        color: '#ef4444', fontSize: 12, cursor: 'pointer',
                      }}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'create' && (
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <h2 style={{ marginBottom: 24 }}>{editingCard ? 'Editar tarjeta' : 'Nueva tarjeta'}</h2>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#f472b6', marginBottom: 8, letterSpacing: 0.5 }}>PREGUNTA / FRENTE</label>
              <textarea
                value={draftFront}
                onChange={e => setDraftFront(e.target.value)}
                placeholder="Escribe la pregunta o concepto..."
                style={{
                  width: '100%', minHeight: 100, padding: 14, borderRadius: 10,
                  border: '1.5px solid var(--border-color2)', background: 'var(--bg-card)',
                  color: 'var(--text-primary)', fontSize: 14, fontFamily: BODY,
                  resize: 'vertical', outline: 'none',
                }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#f472b6', marginBottom: 8, letterSpacing: 0.5 }}>RESPUESTA / REVERSO</label>
              <textarea
                value={draftBack}
                onChange={e => setDraftBack(e.target.value)}
                placeholder="Escribe la respuesta..."
                style={{
                  width: '100%', minHeight: 100, padding: 14, borderRadius: 10,
                  border: '1.5px solid var(--border-color2)', background: 'var(--bg-card)',
                  color: 'var(--text-primary)', fontSize: 14, fontFamily: BODY,
                  resize: 'vertical', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => { setMode('list'); setEditingCard(null); setDraftFront(''); setDraftBack(''); }} style={{
                padding: '10px 20px', borderRadius: 10,
                border: '1.5px solid var(--border-color2)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Cancelar</button>
              <button onClick={saveCard} disabled={!draftFront.trim() || !draftBack.trim()} style={{
                flex: 1, padding: '10px 20px', borderRadius: 10, border: 'none',
                background: draftFront.trim() && draftBack.trim() ? '#f472b6' : '#555',
                color: '#000', fontSize: 13, fontWeight: 800,
                cursor: draftFront.trim() && draftBack.trim() ? 'pointer' : 'not-allowed',
              }}>{editingCard ? 'Guardar cambios' : 'Guardar tarjeta'}</button>
            </div>
          </div>
        )}

        {mode === 'study' && state.cards.length > 0 && (
          <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 20 }}>
              Tarjeta {state.studyIndex + 1} de {state.cards.length}
            </div>
            <div
              onClick={() => persist({ ...state, studyFlipped: !state.studyFlipped })}
              style={{
                minHeight: 300, padding: 40, borderRadius: 16,
                background: 'var(--bg-card)',
                border: `2px solid ${state.studyFlipped ? '#4ade80' : '#f472b6'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: 18, lineHeight: 1.5, color: 'var(--text-primary)',
                transition: 'border-color 0.3s',
              }}
            >
              {state.studyFlipped ? state.cards[state.studyIndex].back : state.cards[state.studyIndex].front}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 12 }}>
              {state.studyFlipped ? '↻ click para ver pregunta' : '👆 click para ver respuesta'}
            </div>
            <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button onClick={() => { setMode('list'); }} style={{
                padding: '10px 20px', borderRadius: 10,
                border: '1.5px solid var(--border-color2)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Terminar</button>
              <button onClick={nextStudy} style={{
                padding: '10px 28px', borderRadius: 10, border: 'none',
                background: '#f472b6', color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer',
              }}>{state.studyIndex + 1 >= state.cards.length ? 'Finalizar ronda' : 'Siguiente →'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
