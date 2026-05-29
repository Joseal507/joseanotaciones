'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useMultiContent } from '../../lib/materials/useContent';

const HAND = "'Caveat', cursive";
const BODY = "'Inter', system-ui, sans-serif";

const RepasarViewer = dynamic(() => import('./RepasarViewer'), { ssr: false });

type Phase = 'preview' | 'lectura' | 'explicar' | 'analisis';

type ExplainMode = 'nino' | 'universitario' | 'profesor' | 'libre';

interface Props {
  materiales: any[];
  seleccion?: any[] | null;
  tema: any;
  materia: any;
  onBack: () => void;
}

interface AnalysisResult {
  score: number;
  level: string;
  metrics?: {
    coverage: number;
    clarity: number;
    depth: number;
    connections: number;
  };
  strengths: string[];
  missingConcepts: string[];
  confusions: string[];
  weakConcepts?: string[];
  followUpQuestions?: string[];
  feedback: string;
  nextStep: string;
}

interface Attempt {
  id: string;
  createdAt: number;
  mode: ExplainMode;
  explanation: string;
  analysis: AnalysisResult;
}

function clampText(text: string, max = 22000) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n\n[Contenido recortado para análisis]';
}

function extractSelectionText(seleccion: any[] | null | undefined) {
  if (!Array.isArray(seleccion)) return '';
  return seleccion
    .map((s: any) => s?.text || s?.texto || s?.content || s?.contenido || s?.selectedText || '')
    .filter(Boolean)
    .join('\n\n---\n\n');
}

export default function RepasarWorkspace({ materiales, seleccion, tema, materia, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>('preview');
  const [notes, setNotes] = useState('');
  const [explanation, setExplanation] = useState('');
  const [mode, setMode] = useState<ExplainMode>('nino');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [followUpAnswer, setFollowUpAnswer] = useState('');
  const [activeRepasarColor, setActiveRepasarColor] = useState('rgba(250, 204, 21, 0.48)');
  const [error, setError] = useState('');

  const { texts: contenidos, status: contentStatus, totalChars } = useMultiContent(
    materiales.map((m: any) => ({
      id: m.id,
      contenido: m.contenido,
      kind: m.kind ?? m.tipo,
      materialId: m.materialId,
    })),
    true,
  );

  const storageKey = useMemo(() => {
    const temaId = tema?.id || tema?.nombre || 'tema';
    const matIds = materiales.map((m: any) => m?.materialId || m?.id).filter(Boolean).join('_') || 'material';
    return `studyal_repasar_${temaId}_${matIds}`;
  }, [tema, materiales]);

  const selectedText = useMemo(() => extractSelectionText(seleccion), [seleccion]);

  const materialText = useMemo(() => {
    if (selectedText.trim()) return selectedText.trim();

    return materiales
      .map((m: any) => {
        const text = contenidos[m.id] ?? m.contenido ?? '';
        const name = m.nombre || m.name || m.titulo || 'Material';
        return text ? `### ${name}\n${text}` : '';
      })
      .filter(Boolean)
      .join('\n\n---\n\n');
  }, [selectedText, materiales, contenidos]);

  const preview = useMemo(() => {
    const clean = materialText.replace(/\s+/g, ' ').trim();
    return clean.slice(0, 1400);
  }, [materialText]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.phase) setPhase(saved.phase);
      if (typeof saved?.notes === 'string') setNotes(saved.notes);
      if (typeof saved?.explanation === 'string') setExplanation(saved.explanation);
      if (saved?.mode) setMode(saved.mode);
      if (Array.isArray(saved?.attempts)) setAttempts(saved.attempts);
      if (saved?.analysis) setAnalysis(saved.analysis);
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        phase,
        notes,
        explanation,
        mode,
        attempts,
        analysis,
        updatedAt: Date.now(),
      }));
    } catch {}
  }, [storageKey, phase, notes, explanation, mode, attempts, analysis]);

  const weakConcepts = useMemo(() => {
    const values = attempts.flatMap((a) => a.analysis.weakConcepts || a.analysis.missingConcepts || []);
    return Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean))).slice(0, 12);
  }, [attempts]);

  const resetSession = () => {
    setPhase('preview');
    setNotes('');
    setExplanation('');
    setMode('nino');
    setAnalysis(null);
    setAttempts([]);
    setFollowUpAnswer('');
    setError('');
    try {
      localStorage.removeItem(storageKey);
    } catch {}
  };

  const evaluate = async () => {
    if (!explanation.trim()) {
      setError('Escribe primero lo que entendiste.');
      return;
    }

    setLoading(true);
    setError('');
    setAnalysis(null);

    try {
      const res = await fetch('/api/repasar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materia: materia?.nombre || materia?.name || '',
          tema: tema?.nombre || tema?.name || '',
          mode,
          notes,
          explanation,
          materialText: clampText(materialText),
          previousWeakConcepts: weakConcepts,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudo analizar.');

      setAnalysis(data.analysis);
      setAttempts((prev) => [
        {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          createdAt: Date.now(),
          mode,
          explanation,
          analysis: data.analysis,
        },
        ...prev,
      ].slice(0, 8));
      setPhase('analisis');
    } catch (err: any) {
      setError(err?.message || 'No se pudo analizar.');
    } finally {
      setLoading(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: 'rgba(13,14,22,0.72)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 18,
    boxShadow: '0 18px 50px rgba(0,0,0,0.34)',
    padding: 24,
  };

  const buttonStyle: React.CSSProperties = {
    border: '2px solid var(--text-primary)',
    borderRadius: 14,
    background: 'var(--gold)',
    color: '#111',
    fontFamily: HAND,
    fontSize: 22,
    fontWeight: 900,
    padding: '12px 22px',
    cursor: 'pointer',
    boxShadow: '3px 4px 0 var(--text-primary)',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontFamily: BODY,
      padding: '26px 28px 42px',
      backgroundImage: `linear-gradient(to bottom, transparent 0, transparent 47px, color-mix(in srgb, var(--text-primary) 7%, transparent) 47px, color-mix(in srgb, var(--text-primary) 7%, transparent) 48px, transparent 48px)`,
      backgroundSize: '100% 48px',
    }}>
      <div style={{
        maxWidth: 1480,
        margin: '0 auto',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 18,
          marginBottom: 26,
        }}>
          <button onClick={onBack} style={{
            ...buttonStyle,
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontSize: 20,
          }}>
            ← volver al enfoque
          </button>

          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: HAND,
              color: 'var(--text-faint)',
              fontSize: 18,
              fontStyle: 'italic',
            }}>
              método activo
            </div>
            <h1 style={{
              fontFamily: HAND,
              fontSize: 52,
              margin: 0,
              lineHeight: 1,
            }}>
              🧠 Repasar
            </h1>
          </div>

          <div style={{
            fontFamily: HAND,
            fontSize: 20,
            color: 'var(--text-muted)',
            textAlign: 'right',
            minWidth: 160,
          }}>
            <div>{contentStatus === 'loading' ? 'cargando texto…' : `${totalChars.toLocaleString()} chars`}</div>
            <button onClick={resetSession} style={{
              marginTop: 8,
              background: 'transparent',
              border: '1px dashed var(--border-color)',
              color: 'var(--text-muted)',
              borderRadius: 10,
              padding: '5px 9px',
              cursor: 'pointer',
              fontFamily: BODY,
              fontSize: 12,
              fontWeight: 800,
            }}>
              reset sesión
            </button>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 10,
          marginBottom: 18,
        }}>
          {[
            ['preview', '1', 'Prelectura'],
            ['lectura', '2', 'Lectura activa'],
            ['explicar', '3', 'Explicar'],
            ['analisis', '4', 'Feedback AI'],
          ].map(([id, num, label]) => {
            const active = phase === id;
            return (
              <button
                key={id}
                onClick={() => setPhase(id as Phase)}
                style={{
                  border: `2px solid ${active ? 'var(--gold)' : 'var(--border-color)'}`,
                  background: active ? 'color-mix(in srgb, var(--gold) 18%, var(--bg-card))' : 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  borderRadius: 16,
                  padding: '11px 10px',
                  cursor: 'pointer',
                  fontFamily: HAND,
                  fontSize: 17,
                  fontWeight: 900,
                }}
              >
                {num}. {label}
              </button>
            );
          })}
        </div>

        {phase === 'preview' || phase === 'lectura' ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 360px',
            gap: 18,
            alignItems: 'stretch',
            minHeight: 'calc(100vh - 205px)',
          }}>
            <RepasarViewer
              materiales={materiales}
              seleccion={seleccion}
              phase={phase}
              themeColor="var(--gold)"
              activeColor={activeRepasarColor}
            />

            <div style={{ minWidth: 0 }}>
        {phase === 'preview' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: HAND, fontSize: 38, margin: '0 0 10px' }}>Prelectura rápida</h2>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 16 }}>
              Antes de subrayar, mira la estructura general. Tu objetivo aquí no es memorizar: es saber de qué trata el material.
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 18,
              marginTop: 22,
            }}>
              <div style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 18,
                padding: 18,
              }}>
                <h3 style={{ fontFamily: HAND, fontSize: 28, margin: '0 0 10px' }}>Checklist</h3>
                {[
                  'Mira títulos y subtítulos.',
                  'Detecta palabras repetidas.',
                  'Ubica definiciones, procesos o fórmulas.',
                  'Identifica qué parece importante para examen.',
                  'Lee primero introducción y cierre si existen.',
                ].map(item => (
                  <label key={item} style={{ display: 'block', marginBottom: 10, color: 'var(--text-primary)' }}>
                    <input type="checkbox" style={{ marginRight: 10 }} />
                    {item}
                  </label>
                ))}
              </div>

              <div style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 18,
                padding: 18,
                lineHeight: 1.7,
                color: 'var(--text-muted)',
              }}>
                Haz una primera lectura limpia. No subrayes todavía. Solo mira estructura, títulos, subtítulos, ideas repetidas y páginas clave.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22 }}>
              <button onClick={() => setPhase('lectura')} style={buttonStyle}>seguir a lectura activa →</button>
            </div>
          </div>
        )}

        {phase === 'lectura' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: HAND, fontSize: 38, margin: '0 0 10px' }}>Lectura activa</h2>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 16 }}>
              Lee con intención. Escribe highlights, dudas, conexiones y mini-resúmenes. Esta V1 usa anotaciones textuales; luego metemos highlights visuales sobre PDF.
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 18,
              marginTop: 20,
            }}>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ejemplo: 🟡 idea principal..., 🟢 definición..., 🔴 no entiendo..., conexión con..."
                style={{
                  minHeight: 520,
                  resize: 'vertical',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '2px solid var(--border-color)',
                  borderRadius: 18,
                  padding: 18,
                  fontFamily: BODY,
                  fontSize: 16,
                  lineHeight: 1.7,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22 }}>
              <button onClick={() => setPhase('preview')} style={{ ...buttonStyle, background: 'var(--bg-card)', color: 'var(--text-primary)' }}>← prelectura</button>
              <button onClick={() => setPhase('explicar')} style={buttonStyle}>explicar lo entendido →</button>
            </div>
          </div>
        )}
            </div>
          </div>
        ) : null}

        {phase === 'explicar' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: HAND, fontSize: 38, margin: '0 0 10px' }}>Escribe lo que entendiste</h2>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.7, fontSize: 16 }}>
              No busques responder exacto. Explica con tus palabras. La IA evaluará dominio real del tema.
            </p>

            <div style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              margin: '18px 0',
            }}>
              {[
                ['nino', 'Explícalo como a un niño'],
                ['universitario', 'Como universitario'],
                ['profesor', 'Como profesor'],
                ['libre', 'Libre'],
              ].map(([id, label]) => {
                const active = mode === id;
                return (
                  <button
                    key={id}
                    onClick={() => setMode(id as ExplainMode)}
                    style={{
                      border: `2px solid ${active ? 'var(--gold)' : 'var(--border-color)'}`,
                      background: active ? 'var(--gold)' : 'var(--bg-primary)',
                      color: active ? '#111' : 'var(--text-primary)',
                      borderRadius: 999,
                      padding: '10px 15px',
                      cursor: 'pointer',
                      fontWeight: 800,
                      fontFamily: BODY,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Escribe aquí tu explicación..."
              style={{
                width: '100%',
                minHeight: 360,
                resize: 'vertical',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '2px solid var(--border-color)',
                borderRadius: 18,
                padding: 18,
                fontFamily: BODY,
                fontSize: 16,
                lineHeight: 1.7,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />

            {error && (
              <div style={{
                marginTop: 14,
                color: '#f87171',
                fontWeight: 800,
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22 }}>
              <button onClick={() => setPhase('lectura')} style={{ ...buttonStyle, background: 'var(--bg-card)', color: 'var(--text-primary)' }}>← lectura</button>
              <button onClick={evaluate} disabled={loading} style={{
                ...buttonStyle,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? 'wait' : 'pointer',
              }}>
                {loading ? 'analizando…' : 'analizar comprensión'}
              </button>
            </div>
          </div>
        )}

        {phase === 'analisis' && (
          <div style={cardStyle}>
            <h2 style={{ fontFamily: HAND, fontSize: 38, margin: '0 0 10px' }}>Feedback AI</h2>

            {!analysis ? (
              <p style={{ color: 'var(--text-muted)' }}>Todavía no hay análisis.</p>
            ) : (
              <div style={{ display: 'grid', gap: 18 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 18,
                  padding: 18,
                }}>
                  <div style={{
                    width: 96,
                    height: 96,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--gold)',
                    color: '#111',
                    fontFamily: HAND,
                    fontSize: 38,
                    fontWeight: 900,
                    border: '3px solid var(--text-primary)',
                    boxShadow: '3px 4px 0 var(--text-primary)',
                  }}>
                    {analysis.score}
                  </div>
                  <div>
                    <h3 style={{ fontFamily: HAND, fontSize: 32, margin: 0 }}>{analysis.level}</h3>
                    <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', lineHeight: 1.6 }}>{analysis.feedback}</p>
                  </div>
                </div>


                {analysis.metrics && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 12,
                  }}>
                    {[
                      ['Cobertura', analysis.metrics.coverage],
                      ['Claridad', analysis.metrics.clarity],
                      ['Profundidad', analysis.metrics.depth],
                      ['Conexiones', analysis.metrics.connections],
                    ].map(([label, value]: any) => (
                      <div key={label} style={{
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 16,
                        padding: 14,
                      }}>
                        <div style={{ fontFamily: HAND, fontSize: 23, fontWeight: 900 }}>{label}</div>
                        <div style={{
                          marginTop: 8,
                          height: 10,
                          background: 'var(--bg-card)',
                          borderRadius: 999,
                          overflow: 'hidden',
                          border: '1px solid var(--border-color)',
                        }}>
                          <div style={{
                            width: `${value}%`,
                            height: '100%',
                            background: 'var(--gold)',
                          }} />
                        </div>
                        <div style={{ marginTop: 6, color: 'var(--text-muted)', fontWeight: 800 }}>{value}/100</div>
                      </div>
                    ))}
                  </div>
                )}

                {[
                  ['✅ Entendiste bien', analysis.strengths],
                  ['🧩 Te faltó cubrir', analysis.missingConcepts],
                  ['⚠️ Posibles confusiones', analysis.confusions],
                ].map(([title, items]: any) => (
                  <div key={title} style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 18,
                    padding: 18,
                  }}>
                    <h3 style={{ fontFamily: HAND, fontSize: 28, margin: '0 0 10px' }}>{title}</h3>
                    {Array.isArray(items) && items.length ? (
                      <ul style={{ margin: 0, paddingLeft: 22, lineHeight: 1.8 }}>
                        {items.map((item: string, i: number) => <li key={i}>{item}</li>)}
                      </ul>
                    ) : (
                      <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nada crítico detectado.</p>
                    )}
                  </div>
                ))}

                <div style={{
                  background: 'color-mix(in srgb, var(--gold) 12%, var(--bg-card))',
                  border: '1px dashed var(--gold)',
                  borderRadius: 18,
                  padding: 18,
                  lineHeight: 1.7,
                }}>
                  <strong>Siguiente paso:</strong> {analysis.nextStep}
                </div>

                {Array.isArray(analysis.followUpQuestions) && analysis.followUpQuestions.length > 0 && (
                  <div style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 18,
                    padding: 18,
                  }}>
                    <h3 style={{ fontFamily: HAND, fontSize: 30, margin: '0 0 10px' }}>Preguntas de seguimiento</h3>
                    <ol style={{ marginTop: 0, lineHeight: 1.8 }}>
                      {analysis.followUpQuestions.map((q, i) => <li key={i}>{q}</li>)}
                    </ol>
                    <textarea
                      value={followUpAnswer}
                      onChange={(e) => setFollowUpAnswer(e.target.value)}
                      placeholder="Responde una o varias preguntas aquí para preparar tu siguiente intento..."
                      style={{
                        width: '100%',
                        minHeight: 120,
                        resize: 'vertical',
                        background: 'var(--bg-card)',
                        color: 'var(--text-primary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: 16,
                        padding: 14,
                        fontFamily: BODY,
                        fontSize: 15,
                        lineHeight: 1.6,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <button
                      onClick={() => {
                        setExplanation((prev) => `${prev.trim()}\n\nRespuesta de seguimiento:\n${followUpAnswer.trim()}`.trim());
                        setFollowUpAnswer('');
                        setPhase('explicar');
                      }}
                      disabled={!followUpAnswer.trim()}
                      style={{
                        ...buttonStyle,
                        marginTop: 12,
                        opacity: followUpAnswer.trim() ? 1 : 0.5,
                      }}
                    >
                      usar en siguiente intento
                    </button>
                  </div>
                )}

                {attempts.length > 0 && (
                  <div style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 18,
                    padding: 18,
                  }}>
                    <h3 style={{ fontFamily: HAND, fontSize: 30, margin: '0 0 10px' }}>Historial</h3>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {attempts.map((attempt, index) => (
                        <button
                          key={attempt.id}
                          onClick={() => {
                            setAnalysis(attempt.analysis);
                            setExplanation(attempt.explanation);
                            setMode(attempt.mode);
                          }}
                          style={{
                            textAlign: 'left',
                            background: 'var(--bg-card)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 14,
                            padding: 12,
                            cursor: 'pointer',
                            fontFamily: BODY,
                          }}
                        >
                          <strong>Intento {attempts.length - index}</strong> · {attempt.analysis.score}/100 · {attempt.analysis.level}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22 }}>
              <button onClick={() => setPhase('explicar')} style={{ ...buttonStyle, background: 'var(--bg-card)', color: 'var(--text-primary)' }}>← mejorar explicación</button>
              <button onClick={onBack} style={buttonStyle}>terminar repaso</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
