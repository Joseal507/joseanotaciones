"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { SourceSelectionSnapshot } from "../../lib/adaptive/sourceSelection";
import {
  readManualToolState,
  writeManualToolState,
} from "../../lib/manualToolState";

const BODY = "var(--font-body)";

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

interface ManualQuestion {
  id: string;
  pregunta: string;
  opciones: string[];
  respuestaCorrectaIndex: number;
  explicacion?: string;
}

interface QuizzesState {
  questions: ManualQuestion[];
  playIndex: number;
  playAnswers: Record<string, number>; // questionId -> chosen index
  playRoundsCompleted: number;
}

const initial: QuizzesState = {
  questions: [],
  playIndex: 0,
  playAnswers: {},
  playRoundsCompleted: 0,
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export default function ManualQuizzes({
  sessionId, sourceSelection, onBack, onProgressReport,
}: Props) {
  const [state, setState] = useState<QuizzesState>(initial);
  const [mode, setMode] = useState<'list' | 'create' | 'play' | 'results'>('list');
  const [editing, setEditing] = useState<ManualQuestion | null>(null);
  const [draft, setDraft] = useState<Omit<ManualQuestion, 'id'>>({
    pregunta: '', opciones: ['', '', '', ''], respuestaCorrectaIndex: 0, explicacion: '',
  });
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const restored = readManualToolState<QuizzesState>(sessionId, sourceSelection.fingerprint, 'quizzes');
    if (restored?.state) setState(restored.state);
  }, [sessionId, sourceSelection.fingerprint]);

  const persist = useCallback((next: QuizzesState) => {
    setState(next);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      if (sessionId) writeManualToolState(sessionId, sourceSelection.fingerprint, 'quizzes', next);
    }, 250);
  }, [sessionId, sourceSelection.fingerprint]);

  useEffect(() => {
    if (!onProgressReport) return;
    if (state.questions.length === 0) { onProgressReport(0); return; }
    let pct = 3;
    pct += Math.min(8, state.questions.length - 1) * 1;
    pct += Math.min(9, state.playRoundsCompleted * 3);
    onProgressReport(Math.min(20, pct));
  }, [state.questions.length, state.playRoundsCompleted, onProgressReport]);

  const saveQuestion = () => {
    if (!draft.pregunta.trim() || draft.opciones.filter(o => o.trim()).length < 2) return;
    const cleanOpts = draft.opciones.map(o => o.trim()).filter(Boolean);
    if (draft.respuestaCorrectaIndex >= cleanOpts.length) return;
    if (editing) {
      persist({
        ...state,
        questions: state.questions.map(q => q.id === editing.id
          ? { ...q, ...draft, opciones: cleanOpts }
          : q),
      });
    } else {
      const newQ: ManualQuestion = { id: uid(), ...draft, opciones: cleanOpts };
      persist({ ...state, questions: [...state.questions, newQ] });
    }
    setDraft({ pregunta: '', opciones: ['', '', '', ''], respuestaCorrectaIndex: 0, explicacion: '' });
    setEditing(null); setMode('list');
  };

  const deleteQ = (id: string) => persist({ ...state, questions: state.questions.filter(q => q.id !== id) });

  const startEdit = (q: ManualQuestion) => {
    setEditing(q);
    setDraft({
      pregunta: q.pregunta,
      opciones: [...q.opciones, '', '', '', ''].slice(0, 4),
      respuestaCorrectaIndex: q.respuestaCorrectaIndex,
      explicacion: q.explicacion || '',
    });
    setMode('create');
  };

  const startPlay = () => {
    if (state.questions.length === 0) return;
    persist({ ...state, playIndex: 0, playAnswers: {} });
    setMode('play');
  };

  const answer = (qid: string, optIndex: number) => {
    const nextAnswers = { ...state.playAnswers, [qid]: optIndex };
    if (state.playIndex + 1 >= state.questions.length) {
      persist({ ...state, playAnswers: nextAnswers, playRoundsCompleted: state.playRoundsCompleted + 1 });
      setMode('results');
    } else {
      persist({ ...state, playAnswers: nextAnswers, playIndex: state.playIndex + 1 });
    }
  };

  const currentQ = state.questions[state.playIndex];

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
          border: '2px solid #4ade80', background: 'transparent',
          color: '#4ade80', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>← volver al mapa</button>
        <div style={{ fontSize: 18, fontWeight: 800 }}>🟢 Quizzes Manual</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {mode !== 'create' && mode !== 'play' && (
            <button onClick={() => { setEditing(null); setDraft({ pregunta: '', opciones: ['','','',''], respuestaCorrectaIndex: 0, explicacion: '' }); setMode('create'); }} style={{
              padding: '8px 14px', borderRadius: 10, border: '1.5px solid #4ade80',
              background: 'rgba(74,222,128,0.1)', color: '#4ade80',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>+ Crear pregunta</button>
          )}
          {state.questions.length > 0 && mode === 'list' && (
            <button onClick={startPlay} style={{
              padding: '8px 14px', borderRadius: 10, border: '1.5px solid #4ade80',
              background: '#4ade80', color: '#000',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>▶ Jugar ({state.questions.length})</button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 32 }}>
        {mode === 'list' && (
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            {state.questions.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: 60, color: 'var(--text-muted)',
                border: '2px dashed var(--border-color2)', borderRadius: 16,
              }}>
                <div style={{ fontSize: 60, marginBottom: 20 }}>🟢</div>
                <h2 style={{ margin: '0 0 12px', color: 'var(--text-primary)' }}>Aún no tienes preguntas</h2>
                <p style={{ margin: '0 0 24px', fontSize: 14 }}>Crea tus propios quizzes escribiendo pregunta, opciones y respuesta correcta.</p>
                <button onClick={() => setMode('create')} style={{
                  padding: '12px 28px', borderRadius: 12, border: 'none',
                  background: '#4ade80', color: '#000', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}>+ Crear primera pregunta</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {state.questions.map((q, i) => (
                  <div key={q.id} style={{
                    background: 'var(--bg-card)', borderRadius: 12,
                    border: '1.5px solid var(--border-color2)', padding: 16,
                  }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{
                        background: '#4ade80', color: '#000', fontSize: 12, fontWeight: 900,
                        padding: '4px 10px', borderRadius: 6, flexShrink: 0,
                      }}>Q{i + 1}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{q.pregunta}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {q.opciones.map((op, oi) => (
                            <div key={oi} style={{
                              fontSize: 12, color: oi === q.respuestaCorrectaIndex ? '#4ade80' : 'var(--text-muted)',
                              display: 'flex', gap: 6, alignItems: 'center',
                            }}>
                              {oi === q.respuestaCorrectaIndex ? '✓' : '○'} {op}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button onClick={() => startEdit(q)} style={{
                          padding: '6px 10px', borderRadius: 8,
                          border: '1px solid var(--border-color2)', background: 'transparent',
                          color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
                        }}>Editar</button>
                        <button onClick={() => deleteQ(q.id)} style={{
                          padding: '6px 10px', borderRadius: 8,
                          border: '1px solid rgba(239,68,68,0.3)', background: 'transparent',
                          color: '#ef4444', fontSize: 11, cursor: 'pointer',
                        }}>🗑</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'create' && (
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            <h2 style={{ marginBottom: 24 }}>{editing ? 'Editar pregunta' : 'Nueva pregunta'}</h2>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 8, letterSpacing: 0.5 }}>PREGUNTA</label>
              <textarea
                value={draft.pregunta}
                onChange={e => setDraft({ ...draft, pregunta: e.target.value })}
                placeholder="¿Cuál es la pregunta?"
                style={{
                  width: '100%', minHeight: 80, padding: 14, borderRadius: 10,
                  border: '1.5px solid var(--border-color2)', background: 'var(--bg-card)',
                  color: 'var(--text-primary)', fontSize: 14, fontFamily: BODY,
                  resize: 'vertical', outline: 'none',
                }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 8, letterSpacing: 0.5 }}>OPCIONES (marca la correcta)</label>
              {draft.opciones.map((op, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                  <input
                    type="radio"
                    checked={draft.respuestaCorrectaIndex === i}
                    onChange={() => setDraft({ ...draft, respuestaCorrectaIndex: i })}
                    style={{ width: 20, height: 20, cursor: 'pointer', accentColor: '#4ade80' }}
                  />
                  <input
                    value={op}
                    onChange={e => {
                      const next = [...draft.opciones];
                      next[i] = e.target.value;
                      setDraft({ ...draft, opciones: next });
                    }}
                    placeholder={`Opción ${i + 1}`}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 10,
                      border: `1.5px solid ${draft.respuestaCorrectaIndex === i ? '#4ade80' : 'var(--border-color2)'}`,
                      background: 'var(--bg-card)', color: 'var(--text-primary)',
                      fontSize: 13, fontFamily: BODY, outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 8, letterSpacing: 0.5 }}>EXPLICACIÓN (opcional)</label>
              <textarea
                value={draft.explicacion}
                onChange={e => setDraft({ ...draft, explicacion: e.target.value })}
                placeholder="Explica por qué esa es la respuesta correcta..."
                style={{
                  width: '100%', minHeight: 60, padding: 14, borderRadius: 10,
                  border: '1.5px solid var(--border-color2)', background: 'var(--bg-card)',
                  color: 'var(--text-primary)', fontSize: 13, fontFamily: BODY,
                  resize: 'vertical', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => { setMode('list'); setEditing(null); }} style={{
                padding: '10px 20px', borderRadius: 10,
                border: '1.5px solid var(--border-color2)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Cancelar</button>
              <button onClick={saveQuestion} disabled={!draft.pregunta.trim() || draft.opciones.filter(o => o.trim()).length < 2} style={{
                flex: 1, padding: '10px 20px', borderRadius: 10, border: 'none',
                background: (draft.pregunta.trim() && draft.opciones.filter(o => o.trim()).length >= 2) ? '#4ade80' : '#555',
                color: '#000', fontSize: 13, fontWeight: 800,
                cursor: (draft.pregunta.trim() && draft.opciones.filter(o => o.trim()).length >= 2) ? 'pointer' : 'not-allowed',
              }}>{editing ? 'Guardar cambios' : 'Guardar pregunta'}</button>
            </div>
          </div>
        )}

        {mode === 'play' && currentQ && (
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 20 }}>
              Pregunta {state.playIndex + 1} de {state.questions.length}
            </div>
            <div style={{
              padding: 24, background: 'var(--bg-card)', borderRadius: 14,
              border: '1.5px solid var(--border-color2)', marginBottom: 20,
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>{currentQ.pregunta}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {currentQ.opciones.map((op, i) => (
                  <button key={i} onClick={() => answer(currentQ.id, i)} style={{
                    padding: '14px 18px', borderRadius: 10, textAlign: 'left',
                    border: '1.5px solid var(--border-color2)', background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)', fontSize: 14, fontFamily: BODY, cursor: 'pointer',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#4ade80'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color2)'; }}
                  >
                    {String.fromCharCode(65 + i)}. {op}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {mode === 'results' && (
          <div style={{ maxWidth: 700, margin: '0 auto' }}>
            <h2 style={{ marginBottom: 20 }}>Resultados</h2>
            {(() => {
              const correct = state.questions.filter(q => state.playAnswers[q.id] === q.respuestaCorrectaIndex).length;
              const total = state.questions.length;
              const pct = Math.round((correct / total) * 100);
              return (
                <div style={{
                  padding: 24, background: 'var(--bg-card)', borderRadius: 14,
                  border: '1.5px solid var(--border-color2)', marginBottom: 20, textAlign: 'center',
                }}>
                  <div style={{ fontSize: 48, fontWeight: 900, color: '#4ade80', marginBottom: 8 }}>{pct}%</div>
                  <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{correct} de {total} correctas</div>
                </div>
              );
            })()}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {state.questions.map((q, i) => {
                const chosen = state.playAnswers[q.id];
                const isCorrect = chosen === q.respuestaCorrectaIndex;
                return (
                  <div key={q.id} style={{
                    padding: 14, borderRadius: 10, background: 'var(--bg-card)',
                    borderLeft: `4px solid ${isCorrect ? '#4ade80' : '#ef4444'}`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                      Q{i + 1}. {q.pregunta}
                    </div>
                    <div style={{ fontSize: 12, color: isCorrect ? '#4ade80' : '#ef4444' }}>
                      {isCorrect ? '✓ Correcta' : `✗ Tu respuesta: ${q.opciones[chosen] || '—'} · Correcta: ${q.opciones[q.respuestaCorrectaIndex]}`}
                    </div>
                    {q.explicacion && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                        💡 {q.explicacion}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button onClick={() => setMode('list')} style={{
                padding: '10px 24px', borderRadius: 10,
                border: '1.5px solid var(--border-color2)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Volver a la lista</button>
              <button onClick={startPlay} style={{
                padding: '10px 24px', borderRadius: 10, border: 'none',
                background: '#4ade80', color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer',
              }}>↻ Jugar otra vez</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
