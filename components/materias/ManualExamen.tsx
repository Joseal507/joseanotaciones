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

interface ExamQuestion {
  id: string;
  pregunta: string;
  respuestaSugerida?: string;
  puntos: number;
}

interface ExamenState {
  questions: ExamQuestion[];
  respuestas: Record<string, string>;
  durationMinutes: number;
  startedAt: number | null;
  submittedAt: number | null;
  submissionsCount: number;
}

const initial: ExamenState = {
  questions: [],
  respuestas: {},
  durationMinutes: 30,
  startedAt: null,
  submittedAt: null,
  submissionsCount: 0,
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export default function ManualExamen({
  sessionId, sourceSelection, onBack, onProgressReport,
}: Props) {
  const [state, setState] = useState<ExamenState>(initial);
  const [mode, setMode] = useState<'setup' | 'edit' | 'take' | 'done'>('setup');
  const [editing, setEditing] = useState<ExamQuestion | null>(null);
  const [draft, setDraft] = useState<Omit<ExamQuestion, 'id'>>({
    pregunta: '', respuestaSugerida: '', puntos: 10,
  });
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const restored = readManualToolState<ExamenState>(sessionId, sourceSelection.fingerprint, 'examen');
    if (restored?.state) {
      setState(restored.state);
      if (restored.state.submittedAt) setMode('done');
      else if (restored.state.startedAt) setMode('take');
      else if (restored.state.questions.length > 0) setMode('edit');
    }
  }, [sessionId, sourceSelection.fingerprint]);

  const persist = useCallback((next: ExamenState) => {
    setState(next);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      if (sessionId) writeManualToolState(sessionId, sourceSelection.fingerprint, 'examen', next);
    }, 250);
  }, [sessionId, sourceSelection.fingerprint]);

  useEffect(() => {
    if (!onProgressReport) return;
    if (state.questions.length === 0) { onProgressReport(0); return; }
    let pct = 3; // primera pregunta creada
    pct += Math.min(6, state.questions.length - 1);
    if (state.startedAt) pct += 2;
    if (state.submittedAt) pct += 4;
    onProgressReport(Math.min(15, pct));
  }, [state.questions.length, state.startedAt, state.submittedAt, onProgressReport]);

  const saveQuestion = () => {
    if (!draft.pregunta.trim()) return;
    if (editing) {
      persist({
        ...state,
        questions: state.questions.map(q => q.id === editing.id ? { ...q, ...draft } : q),
      });
    } else {
      persist({ ...state, questions: [...state.questions, { id: uid(), ...draft }] });
    }
    setDraft({ pregunta: '', respuestaSugerida: '', puntos: 10 });
    setEditing(null);
  };

  const deleteQ = (id: string) => persist({ ...state, questions: state.questions.filter(q => q.id !== id) });

  const startExam = () => {
    if (state.questions.length === 0) return;
    persist({ ...state, startedAt: Date.now(), submittedAt: null, respuestas: {} });
    setMode('take');
  };

  const submitExam = () => {
    persist({ ...state, submittedAt: Date.now(), submissionsCount: state.submissionsCount + 1 });
    setMode('done');
  };

  const resetExam = () => {
    persist({ ...state, startedAt: null, submittedAt: null, respuestas: {} });
    setMode('edit');
  };

  const totalPoints = state.questions.reduce((sum, q) => sum + q.puntos, 0);

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
          border: '2px solid #f87171', background: 'transparent',
          color: '#f87171', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>← volver al mapa</button>
        <div style={{ fontSize: 18, fontWeight: 800 }}>🔴 Examen Manual</div>
        {state.questions.length > 0 && mode !== 'take' && (
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {state.questions.length} pregunta{state.questions.length !== 1 ? 's' : ''} · {totalPoints} pts
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 32 }}>
        {(mode === 'setup' || mode === 'edit') && (
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            {state.questions.length === 0 && mode === 'setup' ? (
              <div style={{
                textAlign: 'center', padding: 60,
                border: '2px dashed var(--border-color2)', borderRadius: 16,
              }}>
                <div style={{ fontSize: 60, marginBottom: 20 }}>🔴</div>
                <h2 style={{ margin: '0 0 12px' }}>Crea tu examen</h2>
                <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 14 }}>
                  Construye tus propias preguntas de examen. Puedes agregar tantas como quieras.
                </p>
                <button onClick={() => setMode('edit')} style={{
                  padding: '12px 28px', borderRadius: 12, border: 'none',
                  background: '#f87171', color: '#000', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}>Empezar a crear</button>
              </div>
            ) : (
              <>
                <h2 style={{ marginBottom: 20 }}>Editor de examen</h2>

                {/* Lista de preguntas existentes */}
                {state.questions.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 700, marginBottom: 10, letterSpacing: 0.5 }}>
                      PREGUNTAS ACTUALES ({state.questions.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {state.questions.map((q, i) => (
                        <div key={q.id} style={{
                          padding: 14, background: 'var(--bg-card)', borderRadius: 10,
                          border: '1px solid var(--border-color2)',
                          display: 'flex', gap: 12, alignItems: 'flex-start',
                        }}>
                          <div style={{
                            background: '#f87171', color: '#000', fontSize: 12, fontWeight: 900,
                            padding: '4px 10px', borderRadius: 6, flexShrink: 0,
                          }}>Q{i + 1}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, marginBottom: 4 }}>{q.pregunta}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{q.puntos} puntos</div>
                          </div>
                          <button onClick={() => { setEditing(q); setDraft(q); }} style={{
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
                      ))}
                    </div>
                  </div>
                )}

                {/* Formulario nueva/editar */}
                <div style={{
                  padding: 20, background: 'var(--bg-card)', borderRadius: 14,
                  border: '1.5px solid var(--border-color2)', marginBottom: 20,
                }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>
                    {editing ? 'Editar pregunta' : 'Añadir pregunta'}
                  </h3>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 6, letterSpacing: 0.5 }}>PREGUNTA</label>
                    <textarea
                      value={draft.pregunta}
                      onChange={e => setDraft({ ...draft, pregunta: e.target.value })}
                      placeholder="Escribe la pregunta del examen..."
                      style={{
                        width: '100%', minHeight: 80, padding: 12, borderRadius: 8,
                        border: '1.5px solid var(--border-color2)', background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)', fontSize: 13, fontFamily: BODY,
                        resize: 'vertical', outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 6, letterSpacing: 0.5 }}>RESPUESTA SUGERIDA (opcional, para autoevaluación)</label>
                    <textarea
                      value={draft.respuestaSugerida}
                      onChange={e => setDraft({ ...draft, respuestaSugerida: e.target.value })}
                      placeholder="Cómo debería verse una buena respuesta..."
                      style={{
                        width: '100%', minHeight: 60, padding: 12, borderRadius: 8,
                        border: '1.5px solid var(--border-color2)', background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)', fontSize: 12, fontFamily: BODY,
                        resize: 'vertical', outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 6, letterSpacing: 0.5 }}>PUNTOS</label>
                    <input
                      type="number" min={1} max={100}
                      value={draft.puntos}
                      onChange={e => setDraft({ ...draft, puntos: Math.max(1, Math.min(100, Number(e.target.value) || 10)) })}
                      style={{
                        width: 100, padding: 10, borderRadius: 8,
                        border: '1.5px solid var(--border-color2)', background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)', fontSize: 13, fontFamily: BODY, outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {editing && (
                      <button onClick={() => { setEditing(null); setDraft({ pregunta: '', respuestaSugerida: '', puntos: 10 }); }} style={{
                        padding: '10px 20px', borderRadius: 10,
                        border: '1.5px solid var(--border-color2)', background: 'transparent',
                        color: 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      }}>Cancelar</button>
                    )}
                    <button onClick={saveQuestion} disabled={!draft.pregunta.trim()} style={{
                      flex: 1, padding: '10px 20px', borderRadius: 10, border: 'none',
                      background: draft.pregunta.trim() ? '#f87171' : '#555',
                      color: '#000', fontSize: 13, fontWeight: 800,
                      cursor: draft.pregunta.trim() ? 'pointer' : 'not-allowed',
                    }}>{editing ? 'Guardar cambios' : '+ Añadir al examen'}</button>
                  </div>
                </div>

                {/* Configuración examen + botón iniciar */}
                {state.questions.length > 0 && (
                  <div style={{
                    padding: 20, background: 'var(--bg-card)', borderRadius: 14,
                    border: '1.5px solid #f87171',
                  }}>
                    <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>Configurar examen</h3>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 6, letterSpacing: 0.5 }}>DURACIÓN (minutos, 0 = sin límite)</label>
                      <input
                        type="number" min={0} max={240}
                        value={state.durationMinutes}
                        onChange={e => persist({ ...state, durationMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })}
                        style={{
                          width: 100, padding: 10, borderRadius: 8,
                          border: '1.5px solid var(--border-color2)', background: 'var(--bg-secondary)',
                          color: 'var(--text-primary)', fontSize: 13, fontFamily: BODY, outline: 'none',
                        }}
                      />
                    </div>
                    <button onClick={startExam} style={{
                      width: '100%', padding: '14px 20px', borderRadius: 12, border: 'none',
                      background: '#f87171', color: '#000', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                    }}>▶ Comenzar examen</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {mode === 'take' && (
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <div style={{
              padding: '12px 20px', background: 'var(--bg-card)', borderRadius: 10,
              border: '1.5px solid #f87171', marginBottom: 20,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>📝 Examen en curso</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {Object.keys(state.respuestas).length} / {state.questions.length} respondidas
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {state.questions.map((q, i) => (
                <div key={q.id} style={{
                  padding: 20, background: 'var(--bg-card)', borderRadius: 12,
                  border: '1.5px solid var(--border-color2)',
                }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{
                      background: '#f87171', color: '#000', fontSize: 12, fontWeight: 900,
                      padding: '4px 10px', borderRadius: 6, flexShrink: 0,
                    }}>Q{i + 1} · {q.puntos}pts</div>
                    <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{q.pregunta}</div>
                  </div>
                  <textarea
                    value={state.respuestas[q.id] || ''}
                    onChange={e => persist({ ...state, respuestas: { ...state.respuestas, [q.id]: e.target.value } })}
                    placeholder="Tu respuesta..."
                    style={{
                      width: '100%', minHeight: 100, padding: 12, borderRadius: 8,
                      border: '1.5px solid var(--border-color2)', background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)', fontSize: 13, fontFamily: BODY,
                      resize: 'vertical', outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>
            <button onClick={submitExam} style={{
              marginTop: 20, width: '100%', padding: '14px 20px', borderRadius: 12, border: 'none',
              background: '#f87171', color: '#000', fontSize: 14, fontWeight: 800, cursor: 'pointer',
            }}>✓ Entregar examen</button>
          </div>
        )}

        {mode === 'done' && (
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <div style={{
              padding: 40, background: 'var(--bg-card)', borderRadius: 14,
              border: '1.5px solid #f87171', marginBottom: 20, textAlign: 'center',
            }}>
              <div style={{ fontSize: 60, marginBottom: 12 }}>🎯</div>
              <h2 style={{ margin: '0 0 8px' }}>Examen completado</h2>
              <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
                Revisa tus respuestas y compáralas con las sugeridas.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {state.questions.map((q, i) => (
                <div key={q.id} style={{
                  padding: 20, background: 'var(--bg-card)', borderRadius: 12,
                  border: '1.5px solid var(--border-color2)',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Q{i + 1}. {q.pregunta}</div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: '#f87171', fontWeight: 700, marginBottom: 4 }}>TU RESPUESTA</div>
                    <div style={{ padding: 10, background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 13, color: 'var(--text-secondary)', minHeight: 40 }}>
                      {state.respuestas[q.id] || <em style={{ color: 'var(--text-faint)' }}>Sin respuesta</em>}
                    </div>
                  </div>
                  {q.respuestaSugerida && (
                    <div>
                      <div style={{ fontSize: 10, color: '#4ade80', fontWeight: 700, marginBottom: 4 }}>RESPUESTA SUGERIDA</div>
                      <div style={{ padding: 10, background: 'rgba(74,222,128,0.05)', borderRadius: 6, fontSize: 13, color: 'var(--text-secondary)', border: '1px solid rgba(74,222,128,0.2)' }}>
                        {q.respuestaSugerida}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button onClick={() => setMode('edit')} style={{
                padding: '10px 24px', borderRadius: 10,
                border: '1.5px solid var(--border-color2)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Editar examen</button>
              <button onClick={resetExam} style={{
                padding: '10px 24px', borderRadius: 10, border: 'none',
                background: '#f87171', color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer',
              }}>↻ Volver a tomar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
